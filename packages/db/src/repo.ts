import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, max } from 'drizzle-orm';
import {
  CANCELLABLE_PUBLISH_STATES,
  EpisodeVersionContent,
  ReleasePackageContent,
  canTransitionPublishJob,
  checkTransition,
  hashCanonical,
  releasePackageHash,
  verifyApprovalSignature,
  SignedApproval,
  type Actor,
  type ClaimEvidence,
  type Claim,
  type EpisodeFormat,
  type EpisodeLink,
  type EpisodeState,
  type EpisodeVersion,
  type MainState,
  type MetricSnapshotDraft,
  type PublishJobState,
  type ReleasePackage,
  type ReviewRecord,
  type Source,
  type StudioSettings,
  type Topic,
  type TrustedApprovalKeys,
} from '@life/contracts';
import type { Db } from './client';
import * as t from './schema';

export const newId = (prefix: string) => `${prefix}_${randomUUID()}`;
const iso = (d: Date) => d.toISOString();
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Conn = Db | Tx;

export class DomainError extends Error {
  override readonly name = 'DomainError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function audit(
  db: Conn,
  e: { actor: Actor; action: string; entityType: string; entityId: string; details?: Record<string, unknown>; now?: Date },
): Promise<void> {
  await db.insert(t.auditEvents).values({
    id: newId('aud'),
    at: iso(e.now ?? new Date()),
    actor: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    details: e.details ?? {},
  });
}

// ---------------------------------------------------------------- owner & settings

export async function ensureOwner(db: Db, owner: { id: string; displayName: string }): Promise<void> {
  const [existing] = await db.select().from(t.owners);
  if (existing && existing.id !== owner.id) throw new DomainError('owner_exists', 'a different owner is already configured');
  if (!existing) await db.insert(t.owners).values({ id: owner.id, displayName: owner.displayName });
}

export async function getOwner(db: Db): Promise<{ id: string; displayName: string } | null> {
  const [row] = await db.select().from(t.owners);
  return row ? { id: row.id, displayName: row.displayName } : null;
}

export async function getSettings(db: Conn): Promise<StudioSettings> {
  const [s] = await db.select().from(t.settings);
  if (!s) throw new DomainError('settings_missing', 'settings row missing; run migrations');
  return {
    publishingPaused: s.publishingPaused,
    pausedReason: s.pausedReason,
    spendingStopped: s.spendingStopped,
    spendingCapMicroUsd: s.spendingCapMicroUsd,
    updatedAt: s.updatedAt,
  };
}

/** Anyone may pause (it only makes things safer); only the owner may resume. */
export async function setPublishingPaused(
  db: Db,
  input: { paused: boolean; reason: string | null; actor: Actor; now?: Date },
): Promise<void> {
  if (!input.paused && input.actor.kind !== 'owner') throw new DomainError('owner_only', 'only the owner can resume publishing');
  if (input.paused && !input.reason) throw new DomainError('reason_required', 'pausing requires a reason');
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(t.settings)
      .set({ publishingPaused: input.paused, pausedReason: input.paused ? input.reason : null, updatedAt: iso(now), updatedBy: input.actor });
    await audit(tx, { actor: input.actor, action: input.paused ? 'publishing.paused' : 'publishing.resumed', entityType: 'settings', entityId: 'settings', details: { reason: input.reason }, now });
  });
}

/** Anyone may stop spending; only the owner may lift the stop or set the cap. */
export async function setSpending(
  db: Db,
  input: { stopped?: boolean; capMicroUsd?: number | null; actor: Actor; now?: Date },
): Promise<void> {
  const loosens = input.stopped === false || input.capMicroUsd !== undefined;
  if (loosens && input.actor.kind !== 'owner') throw new DomainError('owner_only', 'only the owner can lift the spending stop or set a cap');
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx.update(t.settings).set({
      ...(input.stopped !== undefined ? { spendingStopped: input.stopped } : {}),
      ...(input.capMicroUsd !== undefined ? { spendingCapMicroUsd: input.capMicroUsd } : {}),
      updatedAt: iso(now),
      updatedBy: input.actor,
    });
    await audit(tx, { actor: input.actor, action: 'spending.updated', entityType: 'settings', entityId: 'settings', details: { stopped: input.stopped, capMicroUsd: input.capMicroUsd }, now });
  });
}

// ---------------------------------------------------------------- evidence

export async function saveEvidencePacket(
  db: Db,
  p: { topic: Topic; sources: Source[]; claims: Claim[]; evidence: ClaimEvidence[]; reviews: ReviewRecord[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(t.topics).values(p.topic).onConflictDoNothing();
    if (p.sources.length) await tx.insert(t.sources).values(p.sources).onConflictDoNothing();
    if (p.claims.length) await tx.insert(t.claims).values(p.claims).onConflictDoNothing();
    if (p.evidence.length) await tx.insert(t.claimEvidence).values(p.evidence).onConflictDoNothing();
    if (p.reviews.length) await tx.insert(t.reviewRecords).values(p.reviews).onConflictDoNothing();
  });
}

export async function loadEvidencePacket(db: Conn, topicId: string) {
  const [topicRow] = await db.select().from(t.topics).where(eq(t.topics.id, topicId));
  if (!topicRow) throw new DomainError('not_found', `topic ${topicId}`);
  const claims = await db.select().from(t.claims).where(eq(t.claims.topicId, topicId));
  const claimIds = claims.map((c) => c.id);
  const evidence = claimIds.length ? await db.select().from(t.claimEvidence).where(inArray(t.claimEvidence.claimId, claimIds)) : [];
  const sourceIds = [...new Set(evidence.map((e) => e.sourceId))];
  const sources = sourceIds.length ? await db.select().from(t.sources).where(inArray(t.sources.id, sourceIds)) : [];
  const reviews = claimIds.length ? await db.select().from(t.reviewRecords).where(inArray(t.reviewRecords.claimId, claimIds)) : [];
  return {
    topic: topicRow as unknown as Topic,
    claims: claims as unknown as Claim[],
    evidence: evidence as unknown as ClaimEvidence[],
    sources: sources as unknown as Source[],
    reviews: reviews as unknown as ReviewRecord[],
  };
}

// ---------------------------------------------------------------- episodes

export async function createEpisode(
  db: Db,
  input: { id?: string; code: string; topicId: string; format: EpisodeFormat; actor: Actor; now?: Date },
): Promise<string> {
  const id = input.id ?? newId('ep');
  await db.transaction(async (tx) => {
    await tx.insert(t.episodes).values({ id, code: input.code, topicId: input.topicId, format: input.format, state: 'idea' });
    await audit(tx, { actor: input.actor, action: 'episode.created', entityType: 'episode', entityId: id, details: { code: input.code }, now: input.now });
  });
  return id;
}

export async function getEpisode(db: Conn, id: string) {
  const [row] = await db.select().from(t.episodes).where(eq(t.episodes.id, id));
  if (!row) throw new DomainError('not_found', `episode ${id}`);
  return row;
}

export async function applyTransition(
  tx: Tx,
  ep: typeof t.episodes.$inferSelect,
  to: EpisodeState,
  actor: Actor,
  reason: string | null,
  now: Date,
): Promise<void> {
  const from = ep.state as EpisodeState;
  const check = checkTransition({ from, to, actor, reason, heldFrom: ep.heldFrom as MainState | null });
  if (!check.ok) throw new DomainError('invalid_transition', check.error);
  if ((from === 'blocked' || from === 'failed') && (to === 'approved' || to === 'scheduled')) {
    // Resuming into the publish path needs a live approval for the current version (e.g. after a correction revoked it).
    const live = await tx
      .select({ id: t.approvals.id })
      .from(t.approvals)
      .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.approvals.releasePackageId))
      .where(and(eq(t.releasePackages.episodeId, ep.id), eq(t.releasePackages.episodeVersionId, ep.currentVersionId ?? ''), isNull(t.approvals.revokedAt)));
    if (live.length === 0) throw new DomainError('approval_required', `cannot resume to ${to}: no live approval for the current version`);
  }
  const entersHold = to === 'blocked' || to === 'failed' || to === 'cancelled';
  const leavesHold = from === 'blocked' || from === 'failed' || from === 'cancelled';
  const heldFrom = entersHold ? (leavesHold ? ep.heldFrom : from) : null;
  const updated = await tx
    .update(t.episodes)
    .set({ state: to, stateReason: reason, heldFrom, updatedAt: iso(now) })
    .where(and(eq(t.episodes.id, ep.id), eq(t.episodes.state, from)))
    .returning({ id: t.episodes.id });
  if (updated.length !== 1) throw new DomainError('conflict', `episode ${ep.id} changed concurrently`);
  await tx.insert(t.episodeTransitions).values({ id: newId('tr'), episodeId: ep.id, fromState: from, toState: to, reason, actor, at: iso(now) });
  await audit(tx, { actor, action: 'episode.transition', entityType: 'episode', entityId: ep.id, details: { from, to, reason }, now });
}

export async function transitionEpisode(
  db: Db,
  input: { episodeId: string; to: EpisodeState; actor: Actor; reason?: string | null; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, input.episodeId)).for('update');
    if (!ep) throw new DomainError('not_found', `episode ${input.episodeId}`);
    await applyTransition(tx, ep, input.to, input.actor, input.reason ?? null, now);
  });
}

const POST_SCRIPT_STATES = new Set(['verified', 'preview_ready', 'awaiting_user_approval', 'approved', 'scheduled']);

/**
 * Every material edit is a new immutable version. Approvals for older packages
 * are revoked, unsent publish jobs are cancelled, and the episode returns to
 * `scripted` for re-verification.
 */
export async function createEpisodeVersion(
  db: Db,
  input: { episodeId: string; content: Omit<EpisodeVersionContent, 'episodeId' | 'versionNumber'>; actor: Actor; now?: Date },
): Promise<EpisodeVersion> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, input.episodeId)).for('update');
    if (!ep) throw new DomainError('not_found', `episode ${input.episodeId}`);
    if (ep.state === 'publishing' || ep.state === 'published' || ep.state === 'measuring') {
      throw new DomainError('immutable_episode', `episode is ${ep.state}; use the corrections workflow`);
    }
    const [{ n } = { n: 0 }] = await tx
      .select({ n: max(t.episodeVersions.versionNumber) })
      .from(t.episodeVersions)
      .where(eq(t.episodeVersions.episodeId, ep.id));
    const content = EpisodeVersionContent.parse({ ...input.content, episodeId: ep.id, versionNumber: (n ?? 0) + 1 });
    const version: EpisodeVersion = {
      ...content,
      id: newId('ev'),
      contentSha256: hashCanonical(content),
      supersedesVersionId: ep.currentVersionId,
      createdBy: input.actor,
      createdAt: iso(now),
    };
    await tx.insert(t.episodeVersions).values({
      id: version.id,
      episodeId: ep.id,
      versionNumber: content.versionNumber,
      content,
      contentSha256: version.contentSha256,
      claimLedgerSha256: content.claimLedgerSha256,
      supersedesVersionId: version.supersedesVersionId,
      createdBy: input.actor,
      createdAt: version.createdAt,
    });
    await tx.update(t.episodes).set({ currentVersionId: version.id, updatedAt: iso(now) }).where(eq(t.episodes.id, ep.id));
    await audit(tx, { actor: input.actor, action: 'episode.version_created', entityType: 'episode', entityId: ep.id, details: { versionId: version.id, versionNumber: content.versionNumber, sha256: version.contentSha256 }, now });

    const system: Actor = { kind: 'system', component: 'versioning' };
    await revokeApprovalsForEpisode(tx, ep.id, `superseded by version ${content.versionNumber}`, system, now);
    if (POST_SCRIPT_STATES.has(ep.state)) {
      await applyTransition(tx, { ...ep, currentVersionId: version.id }, 'scripted', system, `material edit: version ${content.versionNumber}`, now);
    }
    return version;
  });
}

export async function getEpisodeVersion(db: Conn, id: string): Promise<EpisodeVersion> {
  const [row] = await db.select().from(t.episodeVersions).where(eq(t.episodeVersions.id, id));
  if (!row) throw new DomainError('not_found', `episode version ${id}`);
  return {
    ...(row.content as EpisodeVersionContent),
    id: row.id,
    contentSha256: row.contentSha256,
    supersedesVersionId: row.supersedesVersionId,
    createdBy: row.createdBy as Actor,
    createdAt: row.createdAt,
  };
}

export async function saveEpisodeLink(db: Db, link: EpisodeLink): Promise<void> {
  await db.insert(t.episodeLinks).values(link).onConflictDoUpdate({ target: t.episodeLinks.episodeId, set: link });
}

export async function getEpisodeLink(db: Conn, episodeId: string): Promise<EpisodeLink | null> {
  const [row] = await db.select().from(t.episodeLinks).where(eq(t.episodeLinks.episodeId, episodeId));
  return row ?? null;
}

// ---------------------------------------------------------------- release packages & approvals

export async function createReleasePackage(db: Db, input: { content: ReleasePackageContent; actor: Actor; now?: Date }): Promise<ReleasePackage> {
  const now = input.now ?? new Date();
  const content = ReleasePackageContent.parse(input.content);
  const pkg: ReleasePackage = { ...content, id: newId('pkg'), packageSha256: releasePackageHash(content), createdAt: iso(now) };
  await db.transaction(async (tx) => {
    const ep = await getEpisode(tx, content.episodeId);
    if (ep.currentVersionId !== content.episodeVersionId) throw new DomainError('stale_version', 'package must use the current episode version');
    const version = await getEpisodeVersion(tx, content.episodeVersionId);
    if (version.contentSha256 !== content.episodeVersionSha256) throw new DomainError('version_hash_mismatch', 'episode version hash mismatch');
    await tx.insert(t.releasePackages).values({ id: pkg.id, episodeId: pkg.episodeId, episodeVersionId: pkg.episodeVersionId, content, packageSha256: pkg.packageSha256, createdAt: pkg.createdAt });
    await audit(tx, { actor: input.actor, action: 'release_package.created', entityType: 'release_package', entityId: pkg.id, details: { sha256: pkg.packageSha256 }, now });
  });
  return pkg;
}

export async function getReleasePackage(db: Conn, id: string): Promise<ReleasePackage> {
  const [row] = await db.select().from(t.releasePackages).where(eq(t.releasePackages.id, id));
  if (!row) throw new DomainError('not_found', `release package ${id}`);
  return { ...(row.content as ReleasePackageContent), id: row.id, packageSha256: row.packageSha256, createdAt: row.createdAt };
}

export async function latestReleasePackage(db: Conn, episodeId: string): Promise<ReleasePackage | null> {
  const [row] = await db.select({ id: t.releasePackages.id }).from(t.releasePackages).where(eq(t.releasePackages.episodeId, episodeId)).orderBy(desc(t.releasePackages.createdAt)).limit(1);
  return row ? getReleasePackage(db, row.id) : null;
}

/**
 * Stores an owner approval the studio has signed. The signature is verified
 * here as well, so an unsigned or foreign-signed row never lands in the table.
 */
export async function recordApproval(
  db: Db,
  input: { signed: SignedApproval; trustedKeys: TrustedApprovalKeys; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  const sig = verifyApprovalSignature(input.signed, input.trustedKeys);
  if (!sig.ok) throw new DomainError('approval_signature', sig.reason);
  const { payload } = SignedApproval.parse(input.signed);
  const owner = await getOwner(db);
  if (!owner || owner.id !== payload.approver.ownerId) throw new DomainError('approver_not_owner', 'approval not signed for the configured owner');
  const actor: Actor = { kind: 'owner', ownerId: owner.id };
  await db.transaction(async (tx) => {
    const pkg = await getReleasePackage(tx, payload.releasePackageId);
    if (pkg.packageSha256 !== payload.releasePackageSha256) throw new DomainError('package_mismatch', 'approval does not match the stored package');
    await tx.insert(t.approvals).values({
      id: payload.approvalId,
      releasePackageId: pkg.id,
      approverKind: 'owner',
      approverId: owner.id,
      signedApproval: input.signed,
      keyId: payload.keyId,
      expiresAt: payload.expiresAt,
      createdAt: iso(now),
    });
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, pkg.episodeId)).for('update');
    if (!ep) throw new DomainError('not_found', 'episode');
    await applyTransition(tx, ep, 'approved', actor, null, now);
    await audit(tx, { actor, action: 'approval.recorded', entityType: 'approval', entityId: payload.approvalId, details: { releasePackageId: pkg.id, window: payload.publishWindow, expiresAt: payload.expiresAt }, now });
  });
  return payload.approvalId;
}

export async function rejectRelease(db: Db, input: { releasePackageId: string; ownerId: string; feedback: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  const actor: Actor = { kind: 'owner', ownerId: input.ownerId };
  await db.transaction(async (tx) => {
    const pkg = await getReleasePackage(tx, input.releasePackageId);
    await tx.insert(t.rejections).values({ id: newId('rej'), releasePackageId: pkg.id, ownerId: input.ownerId, feedback: input.feedback, createdAt: iso(now) });
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, pkg.episodeId)).for('update');
    if (!ep) throw new DomainError('not_found', 'episode');
    await applyTransition(tx, ep, 'scripted', actor, `rejected: ${input.feedback}`, now);
  });
}

async function revokeApprovalsForEpisode(tx: Tx, episodeId: string, reason: string, actor: Actor, now: Date): Promise<string[]> {
  const live = await tx
    .select({ id: t.approvals.id })
    .from(t.approvals)
    .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.approvals.releasePackageId))
    .where(and(eq(t.releasePackages.episodeId, episodeId), isNull(t.approvals.revokedAt)));
  for (const { id } of live) await revokeInTx(tx, id, reason, actor, now);
  return live.map((r) => r.id);
}

export async function revokeInTx(tx: Tx, approvalId: string, reason: string, actor: Actor, now: Date): Promise<void> {
  await tx.update(t.approvals).set({ revokedAt: iso(now), revokedReason: reason }).where(eq(t.approvals.id, approvalId));
  await tx
    .update(t.publishJobs)
    .set({ state: 'cancelled', stateReason: `approval revoked: ${reason}`, updatedAt: iso(now) })
    .where(and(eq(t.publishJobs.approvalId, approvalId), inArray(t.publishJobs.state, [...CANCELLABLE_PUBLISH_STATES])));
  await audit(tx, { actor, action: 'approval.revoked', entityType: 'approval', entityId: approvalId, details: { reason }, now });
}

/** Revocation before dispatch. Jobs that already reached the remote API are not cancelled here. */
export async function revokeApproval(db: Db, input: { approvalId: string; reason: string; actor: Actor; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.approvals).where(eq(t.approvals.id, input.approvalId)).for('update');
    if (!row) throw new DomainError('not_found', `approval ${input.approvalId}`);
    if (row.revokedAt) return;
    await revokeInTx(tx, row.id, input.reason, input.actor, now);
    const pkg = await getReleasePackage(tx, row.releasePackageId);
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, pkg.episodeId)).for('update');
    if (ep && (ep.state === 'approved' || ep.state === 'scheduled')) {
      await applyTransition(tx, ep, 'awaiting_user_approval', input.actor, `approval revoked: ${input.reason}`, now);
    } else if (ep && ep.state === 'publishing') {
      // A job was between attempts; nothing is live, but the episode needs a new package and approval.
      const inFlight = await tx
        .select({ id: t.publishJobs.id })
        .from(t.publishJobs)
        .where(and(eq(t.publishJobs.approvalId, row.id), inArray(t.publishJobs.state, ['creating_container', 'processing', 'publishing', 'confirming', 'needs_reconciliation'])));
      if (inFlight.length === 0) await applyTransition(tx, ep, 'failed', input.actor, `approval revoked during publishing retries: ${input.reason}`, now);
    }
  });
}

export async function getApproval(db: Conn, id: string) {
  const [row] = await db.select().from(t.approvals).where(eq(t.approvals.id, id));
  if (!row) throw new DomainError('not_found', `approval ${id}`);
  return row;
}

// ---------------------------------------------------------------- publishing

export type PublishJobRow = typeof t.publishJobs.$inferSelect;

export async function createPublishJob(
  db: Db,
  input: { approvalId: string; adapterMode: 'mock' | 'live'; scheduledFor: Date; maxAttempts?: number; actor: Actor; now?: Date },
): Promise<PublishJobRow> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const approval = await getApproval(tx, input.approvalId);
    if (approval.revokedAt) throw new DomainError('approval_revoked', 'approval is revoked');
    const pkg = await getReleasePackage(tx, approval.releasePackageId);
    const [row] = await tx
      .insert(t.publishJobs)
      .values({
        id: newId('pub'),
        releasePackageId: pkg.id,
        approvalId: approval.id,
        episodeId: pkg.episodeId,
        accountId: pkg.accountId,
        adapterMode: input.adapterMode,
        state: 'queued',
        maxAttempts: input.maxAttempts ?? 5,
        scheduledFor: iso(input.scheduledFor),
        createdAt: iso(now),
        updatedAt: iso(now),
      })
      .returning();
    const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, pkg.episodeId)).for('update');
    if (ep?.state === 'approved') await applyTransition(tx, ep, 'scheduled', input.actor, null, now);
    await audit(tx, { actor: input.actor, action: 'publish_job.created', entityType: 'publish_job', entityId: row!.id, details: { mode: input.adapterMode, scheduledFor: iso(input.scheduledFor) }, now });
    return row!;
  });
}

export async function getPublishJob(db: Conn, id: string): Promise<PublishJobRow> {
  const [row] = await db.select().from(t.publishJobs).where(eq(t.publishJobs.id, id));
  if (!row) throw new DomainError('not_found', `publish job ${id}`);
  return row;
}

/** Compare-and-set: fails if another worker moved the job first. */
export async function transitionPublishJob(
  db: Conn,
  input: {
    id: string;
    from: PublishJobState;
    to: PublishJobState;
    reason?: string | null;
    patch?: Partial<Pick<PublishJobRow, 'containerId' | 'containerCreatedAt' | 'remoteMediaId' | 'permalink' | 'nextAttemptAt' | 'attempts'>>;
    actor: Actor;
    now?: Date;
  },
): Promise<PublishJobRow> {
  if (!canTransitionPublishJob(input.from, input.to)) throw new DomainError('invalid_transition', `publish ${input.from} → ${input.to}`);
  const now = input.now ?? new Date();
  const [row] = await db
    .update(t.publishJobs)
    .set({ ...input.patch, state: input.to, stateReason: input.reason ?? null, updatedAt: iso(now) })
    .where(and(eq(t.publishJobs.id, input.id), eq(t.publishJobs.state, input.from)))
    .returning();
  if (!row) throw new DomainError('conflict', `publish job ${input.id} is no longer ${input.from}`);
  await audit(db, { actor: input.actor, action: 'publish_job.transition', entityType: 'publish_job', entityId: input.id, details: { from: input.from, to: input.to, reason: input.reason ?? null }, now });
  return row;
}

export async function recordInstagramMedia(
  db: Conn,
  input: { publishJobId: string; accountId: string; remoteMediaId: string; permalink: string; publishedAt: Date; source: 'mock' | 'live' },
): Promise<string> {
  const id = newId('igm');
  await db.insert(t.instagramMedia).values({ id, ...input, publishedAt: iso(input.publishedAt) });
  return id;
}

export async function storeInsights(
  db: Db,
  input: { instagramMediaId: string; source: 'mock' | 'manual_import' | 'live'; apiVersion: string; raw: unknown; snapshots: MetricSnapshotDraft[]; now: Date },
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const rawId = newId('raw');
    await tx.insert(t.metricRawResponses).values({ id: rawId, instagramMediaId: input.instagramMediaId, source: input.source, apiVersion: input.apiVersion, body: input.raw ?? {}, retrievedAt: iso(input.now) });
    const ids: string[] = [];
    for (const s of input.snapshots) {
      if (s.source !== input.source) throw new DomainError('source_mismatch', 'snapshot source differs from response source');
      const id = newId('met');
      ids.push(id);
      await tx.insert(t.metricSnapshots).values({ ...s, id, rawResponseId: rawId });
    }
    return ids;
  });
}

export async function recordCost(
  db: Conn,
  e: { provider: string; operation: string; units: number; unitType: string; amountMicroUsd: number; estimated: boolean; source: 'mock' | 'manual_import' | 'live'; episodeId?: string | null; jobId?: string | null; now?: Date },
): Promise<void> {
  await db.insert(t.costEvents).values({ ...e, id: newId('cost'), episodeId: e.episodeId ?? null, jobId: e.jobId ?? null, createdAt: iso(e.now ?? new Date()) });
}

// ---------------------------------------------------------------- spending

export interface SpendStatus {
  capMicroUsd: number | null;
  monthToDateMicroUsd: number;
  /** Warn at half the cap (owner decision: warn at $50 of a $100 cap). */
  warnAtMicroUsd: number | null;
  stopped: boolean;
}

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Live (real-money) spend for the current UTC calendar month. Mock costs never count. */
export async function spendStatus(db: Conn, now: Date): Promise<SpendStatus> {
  const s = await getSettings(db);
  const rows = await db
    .select({ amount: t.costEvents.amountMicroUsd })
    .from(t.costEvents)
    .where(and(eq(t.costEvents.source, 'live'), gte(t.costEvents.createdAt, monthStart(now))));
  const monthToDateMicroUsd = rows.reduce((sum, r) => sum + r.amount, 0);
  return {
    capMicroUsd: s.spendingCapMicroUsd,
    monthToDateMicroUsd,
    warnAtMicroUsd: s.spendingCapMicroUsd === null ? null : Math.floor(s.spendingCapMicroUsd / 2),
    stopped: s.spendingStopped,
  };
}

export type SpendDecision =
  | { ok: true; warning: string | null; status: SpendStatus }
  | { ok: false; reason: 'no_cap_authorized' | 'spending_stopped' | 'would_exceed_cap'; message: string; status: SpendStatus };

/**
 * Call BEFORE every paid provider request with a conservative estimate.
 * Refuses when no cap is authorized, the stop is on, or the call would cross the cap.
 */
export async function authorizeSpend(
  db: Conn,
  input: { provider: string; operation: string; estimatedMicroUsd: number; now?: Date },
): Promise<SpendDecision> {
  const status = await spendStatus(db, input.now ?? new Date());
  const usd = (m: number) => `$${(m / 1_000_000).toFixed(2)}`;
  if (status.stopped) return { ok: false, reason: 'spending_stopped', message: 'the spending stop is on', status };
  if (status.capMicroUsd === null) return { ok: false, reason: 'no_cap_authorized', message: 'no spending cap authorized; paid generation is disabled', status };
  const after = status.monthToDateMicroUsd + Math.max(0, input.estimatedMicroUsd);
  if (after > status.capMicroUsd) {
    return { ok: false, reason: 'would_exceed_cap', message: `${input.provider} ${input.operation} (~${usd(input.estimatedMicroUsd)}) would take this month to ${usd(after)}, over the ${usd(status.capMicroUsd)} cap`, status };
  }
  const warning = status.warnAtMicroUsd !== null && after >= status.warnAtMicroUsd ? `month-to-date spend ${usd(after)} has reached the ${usd(status.warnAtMicroUsd)} warning level` : null;
  return { ok: true, warning, status };
}

// ---------------------------------------------------------------- voice

/** Stores a voice profile version. Approval is a separate, owner-only step. */
export async function saveVoiceProfile(db: Db, input: { id: string; version: number; profile: unknown; actor: Actor; now?: Date }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(t.voiceProfiles).values({ id: input.id, version: input.version, profile: input.profile, createdAt: iso(input.now ?? new Date()) });
    await audit(tx, { actor: input.actor, action: 'voice_profile.saved', entityType: 'voice_profile', entityId: `${input.id}@${input.version}`, now: input.now });
  });
}

/** The owner selects the narrator. Replacing an approved voice needs this again (brief §5). */
export async function approveVoiceProfile(db: Db, input: { id: string; version: number; referenceClipSha256: string; actor: Actor; now?: Date }): Promise<void> {
  if (input.actor.kind !== 'owner') throw new DomainError('owner_only', 'only the owner can approve a narrator voice');
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(t.voiceProfiles).where(and(eq(t.voiceProfiles.id, input.id), eq(t.voiceProfiles.version, input.version))).for('update');
    if (!row) throw new DomainError('not_found', `voice profile ${input.id}@${input.version}`);
    const profile = { ...(row.profile as Record<string, unknown>), approvedReferenceClipSha256: input.referenceClipSha256, approvedByOwnerAt: iso(now) };
    await tx.update(t.voiceProfiles).set({ profile, approvedByOwnerAt: iso(now) }).where(and(eq(t.voiceProfiles.id, input.id), eq(t.voiceProfiles.version, input.version)));
    await audit(tx, { actor: input.actor, action: 'voice_profile.approved', entityType: 'voice_profile', entityId: `${input.id}@${input.version}`, details: { referenceClipSha256: input.referenceClipSha256 }, now });
  });
}
