import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { Actor, EpisodeState, PublishJobState } from '@life/contracts';
import type { Db } from './client';
import { DomainError, applyTransition, audit, revokeInTx, setPublishingPaused, type Tx } from './repo';
import * as t from './schema';

/**
 * Executes plans from @life/content's planCorrection. The planner is passed in
 * so this package does not depend on the content package.
 */
export const CORRECTIONS_ACTOR: Actor = { kind: 'system', component: 'corrections' };

export type CorrectionTriggerInput = { kind: 'claim'; claimId: string } | { kind: 'source'; sourceId: string } | { kind: 'origin'; originId: string };

/** Structural subset of the planner's operations that this module executes. */
type Operation =
  | { kind: 'cancel_publish_job'; automatic: true; episodeId: string; jobId: string; fromState: PublishJobState; reason: string }
  | { kind: 'revoke_unused_approvals'; automatic: true; episodeId: string; reason: string }
  | { kind: 'transition_episode'; automatic: true; episodeId: string; from: EpisodeState; to: EpisodeState; heldFrom: string | null; reason: string }
  | { kind: string; automatic: false; [k: string]: unknown };

export interface PlanLike {
  planSha256: string;
  operations: Operation[];
  globalPause: { recommended: boolean; reasons: string[] };
  summary: string;
}

export type Planner<P extends PlanLike> = (trigger: CorrectionTriggerInput, inputs: Awaited<ReturnType<typeof loadCorrectionInputs>>, now: Date) => P;

/** Every row the planner may need, including the version each job/post carries. */
export async function loadCorrectionInputs(db: Db | Tx) {
  const [claims, evidence, sources, episodes, versions, links, jobs, media] = await Promise.all([
    db.select().from(t.claims),
    db.select().from(t.claimEvidence),
    db.select().from(t.sources),
    db.select({ id: t.episodes.id, code: t.episodes.code, state: t.episodes.state, currentVersionId: t.episodes.currentVersionId }).from(t.episodes),
    db.select({ id: t.episodeVersions.id, episodeId: t.episodeVersions.episodeId, content: t.episodeVersions.content }).from(t.episodeVersions),
    db.select().from(t.episodeLinks),
    db
      .select({ id: t.publishJobs.id, episodeId: t.publishJobs.episodeId, state: t.publishJobs.state, episodeVersionId: t.releasePackages.episodeVersionId })
      .from(t.publishJobs)
      .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.publishJobs.releasePackageId)),
    db
      .select({ episodeId: t.publishJobs.episodeId, permalink: t.instagramMedia.permalink, source: t.instagramMedia.source, episodeVersionId: t.releasePackages.episodeVersionId, publishJobId: t.instagramMedia.publishJobId })
      .from(t.instagramMedia)
      .innerJoin(t.publishJobs, eq(t.publishJobs.id, t.instagramMedia.publishJobId))
      .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.publishJobs.releasePackageId)),
  ]);
  return {
    claims: claims as never[],
    evidence: evidence as never[],
    sources: sources as never[],
    episodes: episodes as Array<{ id: string; code: string; state: EpisodeState; currentVersionId: string | null }>,
    versions: versions as never[],
    links: links as never[],
    publishJobs: jobs as Array<{ id: string; episodeId: string; state: PublishJobState; episodeVersionId: string }>,
    liveMedia: media as Array<{ episodeId: string; permalink: string; source: 'mock' | 'manual_import' | 'live'; episodeVersionId: string; publishJobId: string }>,
  };
}

/** Plans without changing anything, for the owner to review. */
export async function previewCorrection<P extends PlanLike>(db: Db, trigger: CorrectionTriggerInput, planner: Planner<P>, now = new Date()): Promise<P> {
  return planner(trigger, await loadCorrectionInputs(db), now);
}

const IN_FLIGHT_OR_DONE: PublishJobState[] = ['creating_container', 'processing', 'publishing', 'confirming', 'needs_reconciliation', 'published'];

/**
 * Flags a problem: re-plans from fresh state (refusing if it no longer matches
 * what was shown), then runs the automatic operations — cancel queued jobs,
 * revoke unused approvals, hold episodes — and, when the plan recommends it,
 * pauses publishing. Nothing live is edited and nothing is approved.
 */
export async function flagCorrection<P extends PlanLike>(
  db: Db,
  input: { trigger: CorrectionTriggerInput; planner: Planner<P>; expectedPlanSha256?: string; actor: Actor; now?: Date },
): Promise<{ correctionId: string; plan: P }> {
  const now = input.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const plan = input.planner(input.trigger, await loadCorrectionInputs(tx), now);
    if (input.expectedPlanSha256 && plan.planSha256 !== input.expectedPlanSha256) {
      throw new DomainError('plan_changed', 'the data changed since this correction was previewed; review the new plan');
    }
    const correctionId = `corr_${randomUUID()}`;
    await tx.insert(t.corrections).values({ id: correctionId, trigger: input.trigger, plan, planSha256: plan.planSha256, flaggedBy: input.actor, createdAt: now.toISOString() });
    await audit(tx, { actor: input.actor, action: 'correction.planned', entityType: 'correction', entityId: correctionId, details: { planSha256: plan.planSha256, summary: plan.summary }, now });

    for (const op of plan.operations) {
      if (!op.automatic) continue;
      await executeOperation(tx, op as Extract<Operation, { automatic: true }>, now);
      await audit(tx, { actor: CORRECTIONS_ACTOR, action: 'correction.op_executed', entityType: 'correction', entityId: correctionId, details: { planSha256: plan.planSha256, op }, now });
    }
    return { correctionId, plan };
  });
  if (result.plan.globalPause.recommended) {
    await setPublishingPaused(db, { paused: true, reason: `correction ${result.correctionId}: ${result.plan.globalPause.reasons.join(', ')}`, actor: CORRECTIONS_ACTOR, now });
  }
  return result;
}

async function executeOperation(tx: Tx, op: Extract<Operation, { automatic: true }>, now: Date): Promise<void> {
  switch (op.kind) {
    case 'cancel_publish_job': {
      const rows = await tx
        .update(t.publishJobs)
        .set({ state: 'cancelled', stateReason: `correction: ${op.reason}`, updatedAt: now.toISOString() })
        .where(and(eq(t.publishJobs.id, op.jobId), eq(t.publishJobs.state, op.fromState)))
        .returning({ id: t.publishJobs.id });
      if (rows.length !== 1) throw new DomainError('plan_changed', `publish job ${op.jobId} is no longer ${op.fromState}; re-plan`);
      return;
    }
    case 'revoke_unused_approvals': {
      const inUse = tx
        .select({ id: t.publishJobs.approvalId })
        .from(t.publishJobs)
        .where(and(eq(t.publishJobs.episodeId, op.episodeId), inArray(t.publishJobs.state, IN_FLIGHT_OR_DONE)));
      const unused = await tx
        .select({ id: t.approvals.id })
        .from(t.approvals)
        .innerJoin(t.releasePackages, eq(t.releasePackages.id, t.approvals.releasePackageId))
        .where(and(eq(t.releasePackages.episodeId, op.episodeId), isNull(t.approvals.revokedAt), notInArray(t.approvals.id, inUse)));
      for (const { id } of unused) await revokeInTx(tx, id, `correction: ${op.reason}`, CORRECTIONS_ACTOR, now);
      return;
    }
    case 'transition_episode': {
      const [ep] = await tx.select().from(t.episodes).where(eq(t.episodes.id, op.episodeId)).for('update');
      if (!ep || ep.state !== op.from) throw new DomainError('plan_changed', `episode ${op.episodeId} is no longer ${op.from}; re-plan`);
      await applyTransition(tx, ep, op.to, CORRECTIONS_ACTOR, `correction: ${op.reason}`, now);
      return;
    }
  }
}

/** Only the owner closes a correction. A live-post change still needs its own approval. */
export async function resolveCorrection(db: Db, input: { correctionId: string; status: 'resolved' | 'dismissed'; resolution: string; actor: Actor; now?: Date }): Promise<void> {
  if (input.actor.kind !== 'owner') throw new DomainError('owner_only', 'only the owner can resolve a correction');
  if (!input.resolution.trim()) throw new DomainError('reason_required', 'a resolution note is required');
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(t.corrections)
      .set({ status: input.status, resolution: input.resolution, resolvedBy: input.actor, resolvedAt: now.toISOString() })
      .where(and(eq(t.corrections.id, input.correctionId), eq(t.corrections.status, 'open')))
      .returning({ planSha256: t.corrections.planSha256 });
    if (rows.length !== 1) throw new DomainError('not_open', 'correction is not open');
    await audit(tx, { actor: input.actor, action: 'correction.resolved', entityType: 'correction', entityId: input.correctionId, details: { status: input.status, resolution: input.resolution, planSha256: rows[0]!.planSha256 }, now });
  });
}

export async function listCorrections(db: Db, limit = 100) {
  return db.select().from(t.corrections).orderBy(desc(t.corrections.createdAt)).limit(limit);
}
