import { z } from 'zod';
import type { Actor } from './common';

export const MAIN_STATES = [
  'idea',
  'researching',
  'evidence_ready',
  'scripted',
  'verified',
  'preview_ready',
  'awaiting_user_approval',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'measuring',
] as const;
export const HOLD_STATES = ['blocked', 'failed', 'cancelled'] as const;

export const MainState = z.enum(MAIN_STATES);
export type MainState = z.infer<typeof MainState>;
export const HoldState = z.enum(HOLD_STATES);
export type HoldState = z.infer<typeof HoldState>;
export const EpisodeState = z.enum([...MAIN_STATES, ...HOLD_STATES]);
export type EpisodeState = z.infer<typeof EpisodeState>;

/**
 * Allowed moves between main states. Backward moves to `researching` / `scripted`
 * are how rework and material edits happen (a material edit creates a new
 * version and invalidates approvals). `approved`/`scheduled` → `awaiting_user_approval`
 * is a revocation.
 */
export const MAIN_TRANSITIONS: Readonly<Record<MainState, readonly MainState[]>> = {
  idea: ['researching'],
  researching: ['evidence_ready'],
  evidence_ready: ['scripted', 'researching'],
  scripted: ['verified', 'researching'],
  verified: ['preview_ready', 'scripted', 'researching'],
  preview_ready: ['awaiting_user_approval', 'scripted'],
  awaiting_user_approval: ['approved', 'scripted'],
  approved: ['scheduled', 'awaiting_user_approval', 'scripted'],
  scheduled: ['publishing', 'approved', 'awaiting_user_approval', 'scripted'],
  publishing: ['published'],
  published: ['measuring'],
  measuring: [],
};

/** Live content is changed through the corrections workflow, not by holding the episode. */
const HOLDABLE: ReadonlySet<MainState> = new Set(MAIN_STATES.filter((s) => s !== 'published' && s !== 'measuring'));

/** Only the owner may perform these moves. */
const OWNER_ONLY: ReadonlyArray<[MainState, MainState]> = [['awaiting_user_approval', 'approved']];

export interface TransitionRequest {
  from: EpisodeState;
  to: EpisodeState;
  actor: Actor;
  /** Required when entering a hold state. */
  reason?: string | null;
  /** When leaving a hold state: the main state the episode was in when it was held. */
  heldFrom?: MainState | null;
}

export type TransitionResult = { ok: true } | { ok: false; error: string };

export function isHoldState(s: EpisodeState): s is HoldState {
  return (HOLD_STATES as readonly string[]).includes(s);
}

export function checkTransition(req: TransitionRequest): TransitionResult {
  const { from, to, actor } = req;
  if (from === to) return { ok: false, error: `no-op transition ${from} → ${to}` };
  if (from === 'cancelled') return { ok: false, error: 'cancelled is terminal' };

  if (isHoldState(to)) {
    if (!req.reason || req.reason.trim() === '') return { ok: false, error: `${to} requires a reason` };
    if (isHoldState(from)) {
      // failed/blocked may be cancelled, or a block may escalate to failed.
      return to === 'cancelled' || (from === 'blocked' && to === 'failed')
        ? { ok: true }
        : { ok: false, error: `${from} → ${to} not allowed` };
    }
    return HOLDABLE.has(from) ? { ok: true } : { ok: false, error: `${from} cannot be held; use the corrections workflow` };
  }

  if (isHoldState(from)) {
    // Resume to where it was held, or back to rework.
    const held = req.heldFrom;
    if (!held) return { ok: false, error: `leaving ${from} requires heldFrom` };
    const allowed = new Set<MainState>([held, 'researching', 'scripted']);
    // Never resume straight into the publishing path; the worker re-enters from `approved`/`scheduled` checks.
    if (to === 'publishing' || to === 'published' || to === 'measuring') {
      return { ok: false, error: `cannot resume directly into ${to}` };
    }
    return allowed.has(to) ? { ok: true } : { ok: false, error: `${from} may resume only to ${[...allowed].join(', ')}` };
  }

  if (!MAIN_TRANSITIONS[from].includes(to)) return { ok: false, error: `${from} → ${to} not allowed` };
  if (OWNER_ONLY.some(([f, t]) => f === from && t === to) && actor.kind !== 'owner') {
    return { ok: false, error: `${from} → ${to} requires the owner` };
  }
  return { ok: true };
}
