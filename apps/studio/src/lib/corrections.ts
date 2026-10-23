import type { CorrectionTriggerInput } from '@life/db';

/** The preview is bound to the instant it was computed (planSha256 hashes generatedAt). Older than this, re-preview. */
export const PREVIEW_MAX_AGE_MS = 15 * 60_000;

export type TriggerParse = { ok: true; trigger: CorrectionTriggerInput } | { ok: false; reason: string };

export function parseTrigger(kind: unknown, id: unknown): TriggerParse {
  const v = typeof id === 'string' ? id.trim() : '';
  if (!v || v.length > 200) return { ok: false, reason: 'Choose what to flag.' };
  if (kind === 'claim') return { ok: true, trigger: { kind: 'claim', claimId: v } };
  if (kind === 'source') return { ok: true, trigger: { kind: 'source', sourceId: v } };
  if (kind === 'origin') return { ok: true, trigger: { kind: 'origin', originId: v } };
  return { ok: false, reason: 'Choose claim, source or origin.' };
}

/** Validates the generatedAt echoed back from the preview form. */
export function parsePreviewTime(raw: unknown, now: Date): { ok: true; at: Date } | { ok: false; reason: string } {
  const s = typeof raw === 'string' ? raw : '';
  const at = new Date(s);
  if (!s || Number.isNaN(at.getTime())) return { ok: false, reason: 'The preview is missing its timestamp. Preview again.' };
  const age = now.getTime() - at.getTime();
  if (age < -60_000) return { ok: false, reason: 'The preview timestamp is in the future. Preview again.' };
  if (age > PREVIEW_MAX_AGE_MS) return { ok: false, reason: 'The preview is older than 15 minutes. Preview again.' };
  return { ok: true, at };
}

export const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
