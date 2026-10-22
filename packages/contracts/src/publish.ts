import { z } from 'zod';
import { DataSource, Id, IsoDateTime } from './common';

export const PUBLISH_JOB_STATES = [
  'queued',
  'gate_check',
  'creating_container',
  'processing',
  'publishing',
  'confirming',
  'published',
  'needs_reconciliation',
  'retry_wait',
  'failed',
  'cancelled',
] as const;
export const PublishJobState = z.enum(PUBLISH_JOB_STATES);
export type PublishJobState = z.infer<typeof PublishJobState>;

/** States in which a job still counts as the live attempt for its package (see the partial unique index). */
export const LIVE_PUBLISH_JOB_STATES: readonly PublishJobState[] = PUBLISH_JOB_STATES.filter(
  (s) => s !== 'failed' && s !== 'cancelled',
);

export const PUBLISH_TRANSITIONS: Readonly<Record<PublishJobState, readonly PublishJobState[]>> = {
  queued: ['gate_check', 'cancelled'],
  gate_check: ['creating_container', 'failed', 'cancelled', 'retry_wait'],
  creating_container: ['processing', 'retry_wait', 'failed'],
  processing: ['publishing', 'retry_wait', 'failed'],
  // A publish call that times out may have succeeded remotely: reconcile, never blind-retry.
  publishing: ['confirming', 'needs_reconciliation', 'retry_wait', 'failed'],
  confirming: ['published', 'needs_reconciliation'],
  needs_reconciliation: ['published', 'retry_wait', 'failed'],
  // Retries re-run the gate (approval, pause, evidence freshness, quota) from the start.
  retry_wait: ['gate_check', 'cancelled', 'failed'],
  published: [],
  failed: [],
  cancelled: [],
};

/** Revocation and cancellation are only possible before anything was sent to the remote publish endpoint. */
export const CANCELLABLE_PUBLISH_STATES: readonly PublishJobState[] = ['queued', 'gate_check', 'retry_wait'];

export function canTransitionPublishJob(from: PublishJobState, to: PublishJobState): boolean {
  return PUBLISH_TRANSITIONS[from].includes(to);
}

export const PublishJob = z
  .object({
    id: Id,
    releasePackageId: Id,
    approvalId: Id,
    episodeId: Id,
    accountId: Id,
    adapterMode: z.enum(['mock', 'live']),
    state: PublishJobState,
    stateReason: z.string().nullable(),
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().positive(),
    scheduledFor: IsoDateTime,
    nextAttemptAt: IsoDateTime.nullable(),
    containerId: z.string().nullable(),
    containerCreatedAt: IsoDateTime.nullable(),
    remoteMediaId: z.string().nullable(),
    permalink: z.string().nullable(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .refine((j) => !['failed', 'cancelled', 'needs_reconciliation', 'retry_wait'].includes(j.state) || !!j.stateReason, {
    message: 'failed/cancelled/needs_reconciliation/retry_wait require stateReason',
  })
  .refine((j) => j.state !== 'published' || (!!j.remoteMediaId && !!j.permalink), {
    message: 'published requires remoteMediaId and permalink',
  });
export type PublishJob = z.infer<typeof PublishJob>;

export const InstagramMedia = z.object({
  id: Id,
  publishJobId: Id,
  accountId: Id,
  remoteMediaId: z.string().min(1),
  permalink: z.string().min(1),
  publishedAt: IsoDateTime,
  source: DataSource,
});
export type InstagramMedia = z.infer<typeof InstagramMedia>;
