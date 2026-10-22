import { describe, expect, it } from 'vitest';
import {
  MetricSnapshot,
  PUBLISH_TRANSITIONS,
  PublishJobState,
  canonicalJson,
  checkTransition,
  safeRate,
  type Actor,
} from '../src/index';

const owner: Actor = { kind: 'owner', ownerId: 'owner-1' };
const agent: Actor = { kind: 'agent', agentName: 'evidence', model: 'claude-opus-5-5' };

describe('canonicalJson', () => {
  it('sorts keys, drops undefined members and normalises -0', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, undefined], c: -0 }, z: undefined })).toBe('{"a":{"c":0,"d":[1,null]},"b":1}');
  });
  it('refuses values with no stable encoding', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
    expect(() => canonicalJson({ a: new Date() })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
  });
});

describe('episode workflow', () => {
  it('walks the happy path', () => {
    const path = [
      'idea', 'researching', 'evidence_ready', 'scripted', 'verified', 'preview_ready',
      'awaiting_user_approval', 'approved', 'scheduled', 'publishing', 'published', 'measuring',
    ] as const;
    for (let i = 1; i < path.length; i++) {
      expect(checkTransition({ from: path[i - 1]!, to: path[i]!, actor: owner })).toEqual({ ok: true });
    }
  });

  it('lets only the owner approve', () => {
    expect(checkTransition({ from: 'awaiting_user_approval', to: 'approved', actor: agent }).ok).toBe(false);
  });

  it('requires reasons for blocked, failed and cancelled', () => {
    for (const to of ['blocked', 'failed', 'cancelled'] as const) {
      expect(checkTransition({ from: 'scripted', to, actor: agent }).ok).toBe(false);
      expect(checkTransition({ from: 'scripted', to, actor: agent, reason: '  ' }).ok).toBe(false);
      expect(checkTransition({ from: 'scripted', to, actor: agent, reason: 'claim c-1 rejected' }).ok).toBe(true);
    }
  });

  it('cannot skip approval or resume straight into publishing', () => {
    expect(checkTransition({ from: 'preview_ready', to: 'approved', actor: owner }).ok).toBe(false);
    expect(checkTransition({ from: 'blocked', to: 'publishing', actor: owner, heldFrom: 'publishing' }).ok).toBe(false);
    expect(checkTransition({ from: 'blocked', to: 'scheduled', actor: owner, heldFrom: 'scheduled' }).ok).toBe(true);
    expect(checkTransition({ from: 'cancelled', to: 'scripted', actor: owner, heldFrom: 'scripted' }).ok).toBe(false);
  });

  it('does not hold live content', () => {
    expect(checkTransition({ from: 'published', to: 'blocked', actor: owner, reason: 'x' }).ok).toBe(false);
  });
});

describe('publish job transitions', () => {
  it('never retries an ambiguous publish without reconciliation', () => {
    expect(PUBLISH_TRANSITIONS.publishing).toContain('needs_reconciliation');
    expect(PUBLISH_TRANSITIONS.needs_reconciliation).not.toContain('publishing');
    for (const s of PublishJobState.options) expect(PUBLISH_TRANSITIONS[s]).not.toContain('queued');
  });
});

describe('metrics', () => {
  const base = {
    id: 'm-1', scope: 'media' as const, accountId: 'a', instagramMediaId: 'im-1', metric: 'saves',
    definition: 'Number of saves', unit: 'count' as const, window: '24h' as const, mediaAgeSec: 86_400,
    apiVersion: 'mock', retrievedAt: '2026-10-23T10:00:00Z', source: 'mock' as const, rawResponseId: null,
  };
  it('keeps missing distinct from zero', () => {
    expect(MetricSnapshot.safeParse({ ...base, value: 0, unavailabilityReason: null }).success).toBe(true);
    expect(MetricSnapshot.safeParse({ ...base, value: null, unavailabilityReason: 'not_yet_available' }).success).toBe(true);
    expect(MetricSnapshot.safeParse({ ...base, value: null, unavailabilityReason: null }).success).toBe(false);
    expect(MetricSnapshot.safeParse({ ...base, value: 0, unavailabilityReason: 'api_error' }).success).toBe(false);
  });
  it('computes denominator-safe rates', () => {
    expect(safeRate(5, 0).rate).toBeNull();
    expect(safeRate(null, 100).rate).toBeNull();
    expect(safeRate(5, 100).rate).toBe(0.05);
  });
});
