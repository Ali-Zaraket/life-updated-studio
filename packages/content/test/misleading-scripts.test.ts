/**
 * Adversarial "misleading script" tests: whole rewrites an over-eager writer (or
 * a compromised draft) might produce, mapped to brief §13 Evidence and Creative
 * rows. Each must be blocked, and blocked for the right reason.
 */
import { describe, expect, it } from 'vitest';
import { claimLedgerSha256 } from '../src/index';
import { C, HOUR, beat, claim, codes, creative, evidence, iso, reseal, world } from './helpers';

const both = (w: ReturnType<typeof world>) => {
  const e = evidence(w);
  const c = creative(w);
  return { ok: e.ok && c.ok, codes: [...codes(e), ...codes(c)] };
};

describe('§13 Evidence: misleading scripts', () => {
  it('fabricated citation: an invented journal is added to the caption and ledger', () => {
    const w = world();
    w.packet.evidence.push({
      ...w.packet.evidence[0]!,
      id: 'fake-1',
      claimId: C.settings,
      sourceId: 'journal-of-phone-privacy-2026',
      supportingPassage: 'A landmark study found…',
    });
    w.version.sourceList.push('Journal of Phone Privacy (2026)');
    const r = evidence(reseal(w));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('unknown_source');
  });

  it('fabricated citation: script cites a claim nobody researched', () => {
    const w = world();
    beat(w, 'mechanism').claimIds.push('claim-invented-by-writer');
    w.version.claimIds.push('claim-invented-by-writer');
    expect(codes(evidence(w))).toContain('unknown_claim');
  });

  it('unavailable source: the only page for a claim has gone offline', () => {
    const w = world();
    w.packet.sources[0]!.available = false;
    expect(codes(evidence(w))).toContain('source_unavailable');
  });

  it('unsupported number: "9 in 10 apps track you" with no numeric claim', () => {
    const w = world();
    beat(w, 'hook').narration = '9 in 10 apps track your location. Who actually decides?';
    w.version.caption = w.version.caption.replace('How does', '90% of apps track you. How does');
    const r = evidence(w);
    expect(r.issues.filter((i) => i.code === 'unsupported_number')).toHaveLength(2);
  });

  it('unsupported number: a numeric claim exists but has only one origin', () => {
    const w = world();
    beat(w, 'takeaway').narration = 'So check your settings: it takes about two minutes.';
    claim(w, C.settings).isNumeric = true;
    expect(codes(evidence(reseal(w)))).toEqual(['insufficient_independent_origins']);
  });

  it('causal overclaim: "turning off location guarantees nobody can track you"', () => {
    const w = world();
    beat(w, 'takeaway').narration = 'Turn off location and it guarantees nobody can track you.';
    const r = evidence(w);
    expect(codes(r)).toContain('causal_overclaim');
  });

  it('causal overclaim hiding in the twist contradicts the limited inference claim', () => {
    const w = world();
    beat(w, 'twist').narration = 'But your network definitely reveals exactly where you are.';
    expect(codes(evidence(w))).toEqual(['causal_overclaim']); // caption "Limits:" line still keeps the caveat
    w.version.caption = w.version.caption.replace('can sometimes be estimated', 'is revealed');
    expect(codes(evidence(w))).toEqual(['causal_overclaim', 'caveat_missing']);
  });

  it('stale policy: a platform policy claim last checked a week ago', () => {
    const w = world();
    const c = claim(w, C.gate);
    c.lastCheckedAt = iso(-7 * 24 * HOUR);
    c.freshUntil = iso(-6 * 24 * HOUR);
    expect(codes(evidence(reseal(w)))).toEqual(['changing_claim_not_rechecked', 'claim_stale']);
  });

  it('contradictory evidence: newer source disagrees, writer keeps "supported"', () => {
    const w = world();
    w.packet.evidence.push({ ...w.packet.evidence[0]!, id: 'contra-1', sourceId: 'fixture-source-3', stance: 'contradicts' });
    expect(codes(evidence(reseal(w)))).toEqual(['contradiction_unaddressed']);
  });

  it('missing high-risk review: script pivots to "which medication to take for anxiety about tracking"', () => {
    const w = world();
    const c = claim(w, C.settings);
    c.riskTier = 'high';
    c.limitations = 'Not individual advice.';
    beat(w, 'takeaway').narration = 'So ask about medication for that anxiety, and check your settings.';
    expect(codes(evidence(reseal(w)))).toEqual(['missing_qualified_review']);
  });

  it('fake endorsement: "doctor approved" with no documented review', () => {
    const w = world();
    w.version.caption = `Doctor approved! ${w.version.caption}`;
    expect(codes(evidence(w))).toEqual(['unauthorized_badge']);
  });

  it('material evidence edit after verification invalidates the version', () => {
    const w = world();
    const before = w.version.claimLedgerSha256;
    claim(w, C.inference).limitations = null; // quietly drop the caveat in the ledger
    expect(claimLedgerSha256(w.packet.claims, w.packet.evidence)).not.toBe(before);
    expect(codes(evidence(w))).toEqual(expect.arrayContaining(['ledger_hash_mismatch', 'limitations_missing']));
  });
});

describe('§13 Creative: misleading scripts', () => {
  it('main promise not resolved: the takeaway is withheld for "part two"', () => {
    const w = world();
    w.version.beats = w.version.beats.filter((b) => b.role !== 'takeaway');
    beat(w, 'twist').narration = 'But there is a hidden setting most people miss. Part two for the answer.';
    const r = both(w);
    expect(r.ok).toBe(false);
    expect(r.codes).toEqual(expect.arrayContaining(['missing_takeaway', 'twist_before_takeaway', 'withholding_phrase']));
  });

  it('engagement begging disguised as a tip', () => {
    const w = world();
    beat(w, 'takeaway').narration = "So check your settings, and save this so you don't forget. Follow for more.";
    expect(creative(w).issues.filter((i) => i.code === 'engagement_bait').length).toBeGreaterThanOrEqual(2);
  });

  it('twist not supported: a shock ending with no claim behind it', () => {
    const w = world();
    const t = beat(w, 'twist');
    t.narration = 'But your phone is listening to you right now.';
    t.claimIds = [];
    expect(codes(creative(w))).toContain('beat_without_claims');
  });

  it('linked episode referenced but not live', () => {
    const w = world();
    w.link = { ...w.link, endingReferencesRelated: true, relatedEpisodeId: 'fixture-episode-2' };
    beat(w, 'twist').narration = 'But location can sometimes be estimated another way. Watch our next episode to see how.';
    const r = creative(w);
    expect(codes(r)).toEqual(expect.arrayContaining(['related_episode_not_live', 'withholding_phrase']));
  });

  it('required caveat dropped: the limited inference claim becomes a certainty', () => {
    const w = world();
    beat(w, 'twist').narration = 'But apps always know where you are without that permission. That is a question worth asking next.';
    w.version.caption = w.version.caption.replace('can sometimes be estimated', 'is always known');
    const r = evidence(w);
    expect(codes(r)).toEqual(['caveat_missing']);
    expect(r.issues[0]!.claimId).toBe(C.inference);
  });

  it('a script that only fails creatively still passes the evidence gate (gates are independent)', () => {
    const w = world();
    w.version.caption += '\nLink in bio.';
    expect(evidence(w).ok).toBe(true);
    expect(creative(w).ok).toBe(false);
  });
});
