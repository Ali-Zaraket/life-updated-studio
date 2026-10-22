import {
  PublisherError,
  SignedApproval,
  evaluatePublishGate,
  type Actor,
  type EvidenceGateSummary,
  type InstagramPublisher,
  type PublishJobState,
  type TrustedApprovalKeys,
} from '@life/contracts';
import {
  DomainError,
  getApproval,
  getEpisode,
  getEpisodeVersion,
  getPublishJob,
  getReleasePackage,
  getSettings,
  recordInstagramMedia,
  transitionEpisode,
  transitionPublishJob,
  type Db,
  type PublishJobRow,
} from '@life/db';
import { reconcileAmbiguousPublish, waitForContainer } from '@life/instagram';
import { sha256File } from '@life/media';
import type { LocalStorage } from './storage';

export interface PublishDeps {
  db: Db;
  publisher: InstagramPublisher;
  storage: LocalStorage;
  trustedKeys: TrustedApprovalKeys;
  ownerId: string;
  targetAccountId: string;
  /** Re-runs the evidence gate (including freshness) for the package's version at `now`. */
  evidenceCheck: (input: { topicId: string; episodeVersionId: string; now: Date }) => Promise<EvidenceGateSummary>;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  processingDeadlineMs?: number;
}

export type PublishOutcome =
  | { kind: 'published'; remoteMediaId: string; permalink: string }
  | { kind: 'retry'; reason: string; retryAfterMs: number | null }
  | { kind: 'failed'; reason: string }
  | { kind: 'cancelled'; reason: string };

const actor: Actor = { kind: 'system', component: 'worker.publish' };
const TERMINAL: ReadonlySet<PublishJobState> = new Set(['published', 'failed', 'cancelled']);
/** Gate rejections that should wait rather than fail: they can clear without a new approval. */
const WAITABLE = new Set(['publishing_paused', 'spending_stopped']);

/**
 * Drives one publish job from its stored state to a terminal state or a
 * retry. Each step is a compare-and-set transition, so a crash resumes from
 * the last recorded step and a racing worker gets a conflict and stops.
 */
export async function runPublishJob(deps: PublishDeps, jobId: string): Promise<PublishOutcome> {
  let job = await getPublishJob(deps.db, jobId);
  try {
    for (let guard = 0; guard < 20; guard++) {
      if (TERMINAL.has(job.state as PublishJobState)) return terminalOutcome(job);
      const step = await stepOnce(deps, job);
      if ('outcome' in step) return step.outcome;
      job = step.job;
    }
    throw new Error('publish state machine did not settle');
  } catch (err) {
    if (err instanceof DomainError && err.code === 'conflict') {
      // Another worker moved this job; it owns the next step.
      return { kind: 'retry', reason: 'job advanced by another worker', retryAfterMs: null };
    }
    throw err;
  }
}

function terminalOutcome(job: PublishJobRow): PublishOutcome {
  if (job.state === 'published') return { kind: 'published', remoteMediaId: job.remoteMediaId!, permalink: job.permalink! };
  if (job.state === 'cancelled') return { kind: 'cancelled', reason: job.stateReason ?? 'cancelled' };
  return { kind: 'failed', reason: job.stateReason ?? 'failed' };
}

type Step = { job: PublishJobRow } | { outcome: PublishOutcome };

async function move(deps: PublishDeps, job: PublishJobRow, to: PublishJobState, reason: string | null, patch?: Parameters<typeof transitionPublishJob>[1]['patch']) {
  return transitionPublishJob(deps.db, { id: job.id, from: job.state as PublishJobState, to, reason, patch, actor, now: deps.now() });
}

async function failJob(deps: PublishDeps, job: PublishJobRow, reason: string): Promise<Step> {
  await move(deps, job, 'failed', reason);
  const ep = await getEpisode(deps.db, job.episodeId);
  if (ep.state === 'scheduled' || ep.state === 'publishing') {
    await transitionEpisode(deps.db, { episodeId: ep.id, to: 'failed', reason: `publish failed: ${reason}`, actor, now: deps.now() });
  }
  return { outcome: { kind: 'failed', reason } };
}

async function retryJob(deps: PublishDeps, job: PublishJobRow, reason: string, retryAfterMs: number | null): Promise<Step> {
  await move(deps, job, 'retry_wait', reason);
  return { outcome: { kind: 'retry', reason, retryAfterMs } };
}

function classify(err: unknown): PublisherError {
  return err instanceof PublisherError ? err : new PublisherError('transient', err instanceof Error ? err.message : String(err));
}

async function onPublisherError(deps: PublishDeps, job: PublishJobRow, err: unknown, during: string): Promise<Step> {
  const e = classify(err);
  const reason = `${during}: ${e.code}: ${redact(e.message)}`;
  if (e.code === 'timeout_ambiguous') return { job: await move(deps, job, 'needs_reconciliation', reason) };
  if (e.retryable || e.code === 'container_expired') return retryJob(deps, job, reason, e.retryAfterSec ? e.retryAfterSec * 1000 : null);
  return failJob(deps, job, reason);
}

async function stepOnce(deps: PublishDeps, job: PublishJobRow): Promise<Step> {
  const { db, publisher } = deps;
  switch (job.state as PublishJobState) {
    case 'queued':
    case 'retry_wait':
      return { job: await move(deps, job, 'gate_check', null) };

    case 'gate_check': {
      const gate = await checkGate(deps, job);
      if (!gate.ok) {
        const reason = `gate rejected: ${gate.rejections.join(', ')}${gate.details.length ? ` (${gate.details.join('; ')})` : ''}`;
        return gate.rejections.every((r) => WAITABLE.has(r)) ? retryJob(deps, job, reason, null) : failJob(deps, job, reason);
      }
      const quota = await publisher.getPublishingQuota(job.accountId).catch(() => null);
      if (quota && quota.used >= quota.limit) return retryJob(deps, job, `publishing quota reached (${quota.used}/${quota.limit})`, quota.windowSec * 1000);

      const ep = await getEpisode(db, job.episodeId);
      if (ep.state === 'scheduled') await transitionEpisode(db, { episodeId: ep.id, to: 'publishing', actor, now: deps.now() });
      return { job: await move(deps, job, 'creating_container', null, { attempts: job.attempts + 1 }) };
    }

    case 'creating_container': {
      // Resuming here after a crash may orphan an unpublished container; those expire harmlessly.
      const pkg = await getReleasePackage(db, job.releasePackageId);
      try {
        const { containerId } = await publisher.createReelContainer({
          accountId: job.accountId,
          videoUrl: deps.storage.mockPublicUrl(pkg.deliveryMedia.uri),
          videoFilePath: deps.storage.resolve(pkg.deliveryMedia.uri),
          coverUrl: deps.storage.mockPublicUrl(pkg.cover.uri),
          caption: pkg.caption,
          shareToFeed: pkg.shareToFeed,
        });
        return { job: await move(deps, job, 'processing', null, { containerId, containerCreatedAt: deps.now().toISOString() }) };
      } catch (err) {
        return onPublisherError(deps, job, err, 'create container');
      }
    }

    case 'processing': {
      try {
        await waitForContainer(publisher, job.containerId!, {
          pollIntervalMs: deps.pollIntervalMs ?? 5_000,
          deadlineMs: deps.processingDeadlineMs ?? 10 * 60_000,
          sleep: deps.sleep,
          now: () => deps.now().getTime(),
        });
      } catch (err) {
        return onPublisherError(deps, job, err, 'processing');
      }
      // Last check before the irreversible call: the owner may have revoked or paused meanwhile.
      const gate = await checkGate(deps, job);
      if (!gate.ok) {
        const reason = `gate rejected before publish: ${gate.rejections.join(', ')}`;
        return gate.rejections.every((r) => WAITABLE.has(r)) ? retryJob(deps, job, reason, null) : failJob(deps, job, reason);
      }
      // Record intent first, then make the irreversible call in this same step.
      const publishing = await move(deps, job, 'publishing', null);
      try {
        const { remoteMediaId } = await publisher.publishContainer(job.accountId, job.containerId!);
        return { job: await move(deps, publishing, 'confirming', null, { remoteMediaId }) };
      } catch (err) {
        return onPublisherError(deps, publishing, err, 'publish');
      }
    }

    case 'publishing':
      // Only reachable when a previous run stopped mid-publish: it may have succeeded remotely.
      return { job: await move(deps, job, 'needs_reconciliation', 'resumed after interruption during publish') };

    case 'confirming': {
      const pkg = await getReleasePackage(db, job.releasePackageId);
      const media = await publisher.getMedia(job.remoteMediaId!);
      if (!media.caption?.includes(pkg.episodeCode)) {
        return { job: await move(deps, job, 'needs_reconciliation', 'remote caption does not carry the episode code') };
      }
      return finishPublished(deps, job, media.remoteMediaId, media.permalink, media.timestamp);
    }

    case 'needs_reconciliation': {
      const pkg = await getReleasePackage(db, job.releasePackageId);
      const since = new Date(Date.parse(job.containerCreatedAt ?? job.createdAt) - 60_000);
      const result = await reconcileAmbiguousPublish({ publisher, accountId: job.accountId, episodeCode: pkg.episodeCode, since });
      if (result.outcome === 'found') return finishPublished(deps, job, result.media.remoteMediaId, result.media.permalink, result.media.timestamp);
      if (result.outcome === 'multiple') {
        return failJob(deps, job, `reconciliation found ${result.candidates.length} remote media with ${pkg.episodeCode}; owner must resolve`);
      }
      return retryJob(deps, job, 'reconciled: not published remotely; safe to retry', null);
    }

    default:
      throw new Error(`unexpected state ${job.state}`);
  }
}

async function finishPublished(deps: PublishDeps, job: PublishJobRow, remoteMediaId: string, permalink: string, timestamp: string): Promise<Step> {
  const done = await deps.db.transaction(async (tx) => {
    const row = await transitionPublishJob(tx, {
      id: job.id,
      from: job.state as PublishJobState,
      to: 'published',
      patch: { remoteMediaId, permalink },
      actor,
      now: deps.now(),
    });
    await recordInstagramMedia(tx, {
      publishJobId: job.id,
      accountId: job.accountId,
      remoteMediaId,
      permalink,
      publishedAt: new Date(timestamp),
      source: job.adapterMode as 'mock' | 'live',
    });
    return row;
  });
  const ep = await getEpisode(deps.db, job.episodeId);
  if (ep.state === 'publishing') await transitionEpisode(deps.db, { episodeId: ep.id, to: 'published', actor, now: deps.now() });
  return { outcome: { kind: 'published', remoteMediaId: done.remoteMediaId!, permalink: done.permalink! } };
}

async function checkGate(deps: PublishDeps, job: PublishJobRow) {
  const { db } = deps;
  const now = deps.now();
  const pkg = await getReleasePackage(db, job.releasePackageId);
  const approval = await getApproval(db, job.approvalId);
  const ep = await getEpisode(db, job.episodeId);
  const current = ep.currentVersionId ? await getEpisodeVersion(db, ep.currentVersionId) : null;
  const [deliveryMediaSha256, coverSha256] = await Promise.all([
    sha256File(deps.storage.resolve(pkg.deliveryMedia.uri)).catch(() => 'missing'),
    sha256File(deps.storage.resolve(pkg.cover.uri)).catch(() => 'missing'),
  ]);
  const settings = await getSettings(db);
  const evidence = await deps.evidenceCheck({ topicId: ep.topicId, episodeVersionId: pkg.episodeVersionId, now });
  return evaluatePublishGate({
    approval: approval.signedApproval as SignedApproval,
    pkg,
    observed: { deliveryMediaSha256, coverSha256 },
    currentEpisodeVersionSha256: current?.contentSha256 ?? 'none',
    targetAccountId: deps.targetAccountId,
    ownerId: deps.ownerId,
    revoked: approval.revokedAt !== null,
    settings,
    evidence,
    trustedKeys: deps.trustedKeys,
    platformLabelSupported: deps.publisher.supportsPlatformAiLabel,
    now,
  });
}

/** Strips anything token-shaped before it reaches the database or logs. */
export function redact(message: string): string {
  return message
    .replace(/(access_token|token|secret|key)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(EAA|IGQ)[A-Za-z0-9_-]{10,}/g, '[redacted]');
}
