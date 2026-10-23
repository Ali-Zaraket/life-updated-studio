import { z } from 'zod';
import { DataSource, Id, IsoDateTime } from './common';

export const UnavailabilityReason = z.enum([
  'not_supported_for_media_type',
  'not_supported_by_api_version',
  'not_yet_available',
  'permission_missing',
  'below_privacy_threshold',
  'deprecated',
  'api_error',
  'not_returned',
]);
export type UnavailabilityReason = z.infer<typeof UnavailabilityReason>;

export const MetricWindow = z.enum(['1h', '24h', '72h', '7d', 'lifetime']);
export type MetricWindow = z.infer<typeof MetricWindow>;

export const MetricUnit = z.enum(['count', 'seconds', 'milliseconds', 'ratio']);

/**
 * One metric value at one retrieval. A missing, delayed or unsupported value is
 * `null` with a reason — never zero.
 */
export const MetricSnapshot = z
  .object({
    id: Id,
    scope: z.enum(['media', 'account']),
    accountId: Id,
    instagramMediaId: Id.nullable(),
    metric: z.string().min(1),
    definition: z.string().min(1),
    unit: MetricUnit,
    window: MetricWindow,
    /** Seconds between publication and retrieval; used for matching-age comparisons. */
    mediaAgeSec: z.number().int().min(0).nullable(),
    apiVersion: z.string().min(1),
    retrievedAt: IsoDateTime,
    value: z.number().finite().min(0).nullable(),
    unavailabilityReason: UnavailabilityReason.nullable(),
    source: DataSource,
    rawResponseId: Id.nullable(),
  })
  .refine((m) => (m.value === null) !== (m.unavailabilityReason === null), {
    message: 'exactly one of value or unavailabilityReason must be set',
  })
  .refine((m) => (m.scope === 'media') === (m.instagramMediaId !== null), {
    message: 'media-scope snapshots need instagramMediaId; account-scope must not have one',
  });
export type MetricSnapshot = z.infer<typeof MetricSnapshot>;

export interface RateWithDenominator {
  numerator: number | null;
  denominator: number | null;
  /** null whenever either side is missing or the denominator is zero. */
  rate: number | null;
}

/** Saves-per-reach style rates. Never divides by zero and never treats missing as zero. */
export function safeRate(numerator: number | null, denominator: number | null): RateWithDenominator {
  const rate = numerator === null || denominator === null || denominator <= 0 ? null : numerator / denominator;
  return { numerator, denominator, rate };
}
