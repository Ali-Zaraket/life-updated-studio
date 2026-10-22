import { describe, expect, it } from 'vitest';
import { parsePreviewTime, parseTrigger } from './corrections';

describe('parseTrigger', () => {
  it('accepts the three kinds', () => {
    expect(parseTrigger('claim', 'c1')).toEqual({ ok: true, trigger: { kind: 'claim', claimId: 'c1' } });
    expect(parseTrigger('source', ' s1 ')).toEqual({ ok: true, trigger: { kind: 'source', sourceId: 's1' } });
    expect(parseTrigger('origin', 'o1')).toEqual({ ok: true, trigger: { kind: 'origin', originId: 'o1' } });
  });
  it('rejects unknown kinds and empty ids', () => {
    expect(parseTrigger('episode', 'x').ok).toBe(false);
    expect(parseTrigger('claim', '').ok).toBe(false);
    expect(parseTrigger('claim', null).ok).toBe(false);
  });
});

describe('parsePreviewTime', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  it('accepts a recent time', () => expect(parsePreviewTime('2026-01-01T11:50:00.000Z', now).ok).toBe(true));
  it('rejects stale, future and garbage', () => {
    expect(parsePreviewTime('2026-01-01T11:00:00Z', now).ok).toBe(false);
    expect(parsePreviewTime('2026-01-01T13:00:00Z', now).ok).toBe(false);
    expect(parsePreviewTime('nope', now).ok).toBe(false);
    expect(parsePreviewTime(undefined, now).ok).toBe(false);
  });
});
