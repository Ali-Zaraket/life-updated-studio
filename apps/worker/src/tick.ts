import { randomUUID } from 'node:crypto';
import { evaluateEvidenceGate } from '@life/content';
import { SignedApproval, type Actor, type InsightsReader } from '@life/contracts';
import {
  and,
  completeJob,
  createPublishJob,
  enqueueJob,
  eq,
  failJob,
  getEpisode,
  getEpisodeVersion,
  getPublishJob,
  isNull,
  leaseJobs,
  loadEvidencePacket,
  storeInsights,
  tables as t,
  transitionEpisode,
  transitionPublishJob,
  type Db,
} from '@life/db';
import { runPublishJob, type PublishDeps } from './publish';

const actor: Actor = { kind: 'system', component: 'worker.scheduler' };

export function evidenceCheckFor(db: Db): PublishDeps['evidenceCheck'] {
  return async ({ topicId, episodeVersionId, now }) => {
    const [packet, version] = await Promise.all([loadEvidencePacket(db, topicId), getEpisodeVersion(db, episodeVersionId)]);
    return evaluateEvidenceGate({ packet, version, now });
  };
}

/**
 * Turns each live owner approval into one publish job, queued for the start of
 * its approved window. The approval itself authorizes this; no further prompt.
 */
function enqueuePublish(db: Db, publishJobId: string, runAt: Date, maxAttempts: number) {
  return enqueueJob(db, { id: `job_${randomUUID()}`, kind: 'publish', payload: { publishJobId }, runAt, maxAttempts, idempotencyKey: `publish:${publishJobId}` });
}

export async function scheduleApproved(db: Db, adapterMode: 'mock' | 'live', now: Date, log?: (msg: string) => void): Promise<string[]> {
  const rows = await db
    .select({ approval: t.approvals, episodeState: t.episodes.state })
    .from(t.approvals)
    .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.approvals.releasePackageId))
    .innerJoin(t.episodes, eq(t.episodes.id, t.releasePackages.episodeId))
    .where(and(isNull(t.approvals.revokedAt), eq(t.episodes.state, 'approved')));
  const created: string[] = [];
  for (const { approval } of rows) {
    // One bad row must not stop every other approval from being scheduled.
    try {
      const { payload } = SignedApproval.parse(approval.signedApproval);
      const scheduledFor = new Date(Math.max(now.getTime(), Date.parse(payload.publishWindow.notBefore)));
      const job = await createPublishJob(db, { approvalId: approval.id, adapterMode, scheduledFor, actor, now });
      await enqueuePublish(db, job.id, scheduledFor, job.maxAttempts);
      created.push(job.id);
    } catch (err) {
      log?.(`schedule approval ${approval.id} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // A crash between creating a job and enqueueing it would strand the job; the idempotency key makes this a no-op otherwise.
  const queued = await db.select().from(t.publishJobs).where(eq(t.publishJobs.state, 'queued'));
  for (const pj of queued) await enqueuePublish(db, pj.id, new Date(pj.scheduledFor), pj.maxAttempts);
  return created;
}

export interface TickDeps extends PublishDeps {
  workerId: string;
  insights: InsightsReader;
  log: (msg: string) => void;
}

export async function workerTick(deps: TickDeps): Promise<void> {
  const now = deps.now();
  await scheduleApproved(deps.db, deps.publisher.mode, now, deps.log);
  const leased = await leaseJobs(deps.db, { workerId: deps.workerId, kinds: ['publish', 'insights'], limit: 5, leaseMs: 15 * 60_000, now });
  for (const job of leased) {
    const payload = job.payload as Record<string, string>;
    try {
      if (job.kind === 'publish') {
        const outcome = await runPublishJob(deps, payload.publishJobId!);
        deps.log(`[${deps.publisher.mode.toUpperCase()}] publish ${payload.publishJobId}: ${outcome.kind}${'reason' in outcome ? ` — ${outcome.reason}` : ''}`);
        if (outcome.kind === 'retry') {
          const res = await failJob(deps.db, { id: job.id, workerId: deps.workerId, error: outcome.reason, now: deps.now(), retryAfterMs: outcome.retryAfterMs ?? undefined });
          if (res === 'failed') {
            const pj = await getPublishJob(deps.db, payload.publishJobId!);
            if (pj.state === 'retry_wait') {
              await transitionPublishJob(deps.db, { id: pj.id, from: 'retry_wait', to: 'failed', reason: `retries exhausted: ${outcome.reason}`, actor, now: deps.now() });
              const ep = await getEpisode(deps.db, pj.episodeId);
              if (ep.state === 'scheduled' || ep.state === 'publishing') {
                await transitionEpisode(deps.db, { episodeId: ep.id, to: 'failed', reason: `publish failed: retries exhausted`, actor, now: deps.now() });
              }
            }
          }
          continue;
        }
        if (outcome.kind === 'published') {
          await enqueueInsightCollections(deps.db, payload.publishJobId!, deps.now());
        }
      } else if (job.kind === 'insights') {
        await collectInsights(deps, payload.instagramMediaId!, payload.publishJobId!);
      }
      await completeJob(deps.db, job.id, deps.workerId, deps.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.log(`job ${job.id} (${job.kind}) error: ${message}`);
      await failJob(deps.db, { id: job.id, workerId: deps.workerId, error: message, now: deps.now() });
    }
  }
}

/** Proposed collection windows from the brief: ~1h, 24h, 72h, 7d after publication. */
export const INSIGHT_OFFSETS_MS = [1, 24, 72, 168].map((h) => h * 3_600_000);

async function enqueueInsightCollections(db: Db, publishJobId: string, publishedAt: Date): Promise<void> {
  const [media] = await db.select().from(t.instagramMedia).where(eq(t.instagramMedia.publishJobId, publishJobId));
  if (!media) return;
  for (const offset of INSIGHT_OFFSETS_MS) {
    await enqueueJob(db, {
      id: `job_${randomUUID()}`,
      kind: 'insights',
      payload: { instagramMediaId: media.id, publishJobId },
      runAt: new Date(publishedAt.getTime() + offset),
      idempotencyKey: `insights:${media.id}:${offset}`,
    });
  }
}

export const DEFAULT_METRICS = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions', 'avg_watch_time_ms'] as const;

export async function collectInsights(deps: Pick<TickDeps, 'db' | 'insights' | 'now'>, instagramMediaId: string, _publishJobId?: string) {
  const [media] = await deps.db.select().from(t.instagramMedia).where(eq(t.instagramMedia.id, instagramMediaId));
  if (!media) throw new Error(`instagram media ${instagramMediaId} not found`);
  const now = deps.now();
  const result = await deps.insights.readMediaInsights({
    accountId: media.accountId,
    instagramMediaId: media.id,
    remoteMediaId: media.remoteMediaId,
    publishedAt: new Date(media.publishedAt),
    metrics: DEFAULT_METRICS,
    now,
  });
  const source = deps.insights.mode === 'mock' ? 'mock' : 'live';
  if (media.source !== source) throw new Error(`refusing to mix ${source} insights into ${media.source} media`);
  const apiVersion = result.snapshots[0]?.apiVersion ?? 'unknown';
  return storeInsights(deps.db, { instagramMediaId: media.id, source, apiVersion, raw: result.raw, snapshots: result.snapshots, now });
}
