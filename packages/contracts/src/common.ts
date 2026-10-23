import { z } from 'zod';

export const Id = z.string().min(1).max(128);
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex sha256');
/** Episode code, e.g. LU-TECH-001. Also the series ID and the reconciliation marker in captions. */
export const EpisodeCode = z.string().regex(/^LU-[A-Z]{2,6}-\d{3,}$/);

/** Where a piece of data came from. Mock and manual data are never presented as live. */
export const DataSource = z.enum(['mock', 'manual_import', 'live']);
export type DataSource = z.infer<typeof DataSource>;

export const Actor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner'), ownerId: Id }),
  z.object({ kind: z.literal('agent'), agentName: z.string().min(1), model: z.string().min(1) }),
  z.object({ kind: z.literal('system'), component: z.string().min(1) }),
]);
export type Actor = z.infer<typeof Actor>;

export const RiskTier = z.enum(['low', 'elevated', 'high']);
export type RiskTier = z.infer<typeof RiskTier>;

export const Pillar = z.enum(['body_and_mind', 'technology', 'work_and_learning', 'money', 'everyday_science']);
export type Pillar = z.infer<typeof Pillar>;

export const EpisodeFormat = z.enum(['everyday_mystery', 'update', 'decision_test']);
export type EpisodeFormat = z.infer<typeof EpisodeFormat>;
