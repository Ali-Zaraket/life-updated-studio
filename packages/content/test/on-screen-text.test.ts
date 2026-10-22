import { describe, expect, it } from 'vitest';
import { beat, codes, creative, evidence, world } from './helpers';

describe('on-screen text is gated like narration', () => {
  it('passes plain labels', () => {
    const w = world();
    beat(w, 'mechanism').onScreenText = ['App asks', 'System decides', 'You choose'];
    expect(evidence(w).ok).toBe(true);
    expect(creative(w).ok).toBe(true);
  });

  it('blocks an unsupported number shown on screen', () => {
    const w = world();
    beat(w, 'takeaway').onScreenText = ['Takes 90% less battery'];
    expect(codes(evidence(w))).toContain('unsupported_number');
  });

  it('blocks engagement bait shown on screen', () => {
    const w = world();
    beat(w, 'twist').onScreenText = ['Follow for part two'];
    expect(codes(creative(w))).toEqual(expect.arrayContaining(['engagement_bait']));
  });

  it('blocks an unauthorized expert badge shown on screen', () => {
    const w = world();
    beat(w, 'hook').onScreenText = ['Doctor approved'];
    expect(codes(evidence(w))).toContain('unauthorized_badge');
  });
});
