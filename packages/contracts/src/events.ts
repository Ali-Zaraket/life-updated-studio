import { z } from 'zod';
import { Actor, DataSource, Id, IsoDateTime } from './common';

export const CostEvent = z.object({
  id: Id,
  provider: z.string().min(1),
  operation: z.string().min(1),
  units: z.number().finite().min(0),
  unitType: z.string().min(1),
  /** Integer micro-USD to avoid float drift. */
  amountMicroUsd: z.number().int().min(0),
  /** True for pre-call estimates; replaced by actuals when the provider reports them. */
  estimated: z.boolean(),
  source: DataSource,
  episodeId: Id.nullable(),
  jobId: Id.nullable(),
  createdAt: IsoDateTime,
});
export type CostEvent = z.infer<typeof CostEvent>;

export const AuditEvent = z.object({
  id: Id,
  at: IsoDateTime,
  actor: Actor,
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: Id,
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

export const StudioSettings = z
  .object({
    publishingPaused: z.boolean(),
    pausedReason: z.string().nullable(),
    spendingStopped: z.boolean(),
    /** null = no cap authorized, which means paid generation is disabled. */
    spendingCapMicroUsd: z.number().int().min(0).nullable(),
    updatedAt: IsoDateTime,
  })
  .refine((s) => !s.publishingPaused || !!s.pausedReason, { message: 'pause requires a reason' });
export type StudioSettings = z.infer<typeof StudioSettings>;
