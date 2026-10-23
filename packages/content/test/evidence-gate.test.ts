import {
  Claim,
  ClaimEvidence,
  EpisodeLink,
  EpisodeVersionContent,
  ReviewRecord,
  Source,
  Topic,
  type EvidenceGateSummary,
} from '@life/contracts';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_ISSUE_CODES, claimLedgerSha256, fixturePacket, listEvidenceAllowances } from '../src/index';
import {
  C,
  HOUR,
  NOW,
  beat,
  claim,
  codes,
  creative,
  evidence,
  expectBlocked,
  humanReview,
  iso,
  proven,
  reseal,
  world,
} from './helpers';

describe('fixture', () => {
  it('passes the evidence gate and the creative rules at the given now', () => {
    const w = world();
    const e = evidence(w);
    const cr = creative(w);
    expect(e.issues).toEqual([]);
    expect(e).toEqual({ ok: true, blockers: [], issues: [] });
    expect(cr.issues).toEqual([]);
    expect(cr.ok).toBe(true);
    expect(listEvidenceAllowances({ packet: w.packet, version: w.version })).toEqual([]);
  });

  it('passes at any now, because its timestamps are relative', () => {
    const later = new Date('2031-03-01T08:00:00.000Z');
    expect(evidence(world(later), later).ok).toBe(true);
  });

  it('matches every contract schema', () => {
    const w = world();
    expect(() => Topic.parse(w.packet.topic)).not.toThrow();
    for (const s of w.packet.sources) Source.parse(s);
    for (const c of w.packet.claims) Claim.parse(c);
    for (const e of w.packet.evidence) ClaimEvidence.parse(e);
    for (const r of w.packet.reviews) ReviewRecord.parse(r);
    EpisodeVersionContent.parse(w.version);
    EpisodeLink.parse(w.link);
  });

  it('is clearly labelled and cannot pass for real citations', () => {
    const { packet, version, link } = fixturePacket(NOW);
    expect(packet.topic.isFixture).toBe(true);
    expect(packet.topic.pillar).toBe('technology');
    expect(packet.topic.riskTier).toBe('low');
    expect(packet.topic.question).toBe('How does your phone decide which apps can see your location?');
    for (const s of packet.sources) {
      expect(new URL(s.url).protocol).toBe('https:');
      expect(new URL(s.url).hostname.endsWith('.invalid')).toBe(true);
      expect(s.title.startsWith('[FIXTURE]')).toBe(true);
      expect(s.doi).toBeNull();
    }
    for (const e of packet.evidence) expect(e.supportingPassage).toContain('[FIXTURE]');
    for (const r of packet.reviews) {
      expect(r.reviewerKind).toBe('ai_verification');
      expect(r.reviewer).toBe('fixture');
    }
    expect(packet.claims.length).toBeGreaterThanOrEqual(3);
    expect(packet.claims.length).toBeLessThanOrEqual(5);
    expect(version.caption).toContain('LU-TECH-001');
    expect(version.caption).toContain('[FIXTURE');
    expect(version.caption).toMatch(/Sources/);
    expect(version.beats.map((b) => b.role)).toEqual(['hook', 'problem', 'mechanism', 'takeaway', 'twist']);
    const total = version.beats.reduce((s, b) => s + (b.endSec - b.startSec), 0);
    expect(total).toBeGreaterThanOrEqual(30);
    expect(total).toBeLessThanOrEqual(40);
    expect(link.endingReferencesRelated).toBe(false);
    expect(link.nextQuestion).toBeTruthy();
  });

  it('gives the consequential claims at least two independent origins', () => {
    const w = world();
    for (const c of w.packet.claims.filter((x) => x.isConsequential)) {
      const origins = new Set(
        w.packet.evidence
          .filter((e) => e.claimId === c.id && e.stance === 'supports')
          .map((e) => w.packet.sources.find((s) => s.id === e.sourceId)?.originId),
      );
      expect(origins.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('is deterministic', () => {
    expect(fixturePacket(NOW)).toEqual(fixturePacket(NOW));
    expect(evidence(world())).toEqual(evidence(world()));
  });

  it('returns a report that is a valid EvidenceGateSummary', () => {
    const summary: EvidenceGateSummary = evidence(world());
    expect(summary.ok).toBe(true);
  });
});

describe('claim ledger hash', () => {
  it('is order-independent and lowercase hex', () => {
    const w = world();
    const a = claimLedgerSha256(w.packet.claims, w.packet.evidence);
    const b = claimLedgerSha256([...w.packet.claims].reverse(), [...w.packet.evidence].reverse());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any claim or evidence field changes', () => {
    const w = world();
    const before = claimLedgerSha256(w.packet.claims, w.packet.evidence);
    claim(w, C.gate).text += ' ';
    expect(claimLedgerSha256(w.packet.claims, w.packet.evidence)).not.toBe(before);
    const w2 = world();
    w2.packet.evidence[0]!.locator = 'p. 2';
    expect(claimLedgerSha256(w2.packet.claims, w2.packet.evidence)).not.toBe(before);
  });

  it('does not mutate its inputs', () => {
    const w = world();
    const ids = w.packet.claims.map((c) => c.id);
    claimLedgerSha256(w.packet.claims, w.packet.evidence);
    expect(w.packet.claims.map((c) => c.id)).toEqual(ids);
  });

  it('blocks when the ledger changed after verification (material evidence edit)', () => {
    const w = world();
    claim(w, C.settings).limitations = 'quietly edited after verification';
    expectBlocked(evidence(w), 'ledger_hash_mismatch', { only: true });
  });
});

describe('evidence gate: claim existence and status', () => {
  it('blocks a claim id the packet does not contain', () => {
    const w = world();
    w.version.claimIds.push('ghost-claim');
    beat(w, 'mechanism').claimIds.push('ghost-claim');
    expectBlocked(evidence(w), 'unknown_claim', { only: true, claimId: 'ghost-claim' });
  });

  it('blocks a beat claim missing from version.claimIds', () => {
    const w = world();
    w.version.claimIds = w.version.claimIds.filter((id) => id !== C.settings);
    expectBlocked(evidence(w), 'beat_claim_not_in_version', { claimId: C.settings });
  });

  it('blocks a claim from another topic', () => {
    const w = world();
    claim(w, C.settings).topicId = 'some-other-topic';
    expectBlocked(evidence(reseal(w)), 'claim_topic_mismatch', { only: true, claimId: C.settings });
  });

  it.each(['unresolved', 'rejected'] as const)('blocks a %s claim', (status) => {
    const w = world();
    claim(w, C.settings).status = status;
    expectBlocked(evidence(reseal(w)), 'claim_not_publishable', { only: true, claimId: C.settings });
  });

  it('blocks schema-invalid rows and duplicate ids', () => {
    const w = world();
    (w.packet.sources[0] as { url: string }).url = 'http://fixture-source-1.invalid/x';
    w.packet.claims.push({ ...claim(w, C.settings) });
    const r = evidence(reseal(w));
    expectBlocked(r, 'schema_invalid');
    expectBlocked(r, 'duplicate_id');
  });
});

describe('evidence gate: fabricated or unknown citations', () => {
  it('blocks evidence citing a source that is not in the packet', () => {
    const w = world();
    w.packet.evidence[4]!.sourceId = 'made-up-journal-2025';
    expectBlocked(evidence(reseal(w)), 'unknown_source', { claimId: C.settings });
  });

  it('blocks a claim with no supporting evidence', () => {
    const w = world();
    w.packet.evidence = w.packet.evidence.filter((e) => e.claimId !== C.settings);
    expectBlocked(evidence(reseal(w)), 'claim_without_support', { only: true, claimId: C.settings });
  });

  it('does not count context-only evidence as support', () => {
    const w = world();
    w.packet.evidence.find((e) => e.claimId === C.settings)!.stance = 'context';
    expectBlocked(evidence(reseal(w)), 'claim_without_support', { only: true, claimId: C.settings });
  });

  it('blocks evidence with a blank passage or locator', () => {
    const w = world();
    w.packet.evidence[4]!.supportingPassage = '   ';
    expectBlocked(evidence(reseal(w)), 'evidence_missing_passage', { only: true, claimId: C.settings });
    const w2 = world();
    w2.packet.evidence[4]!.locator = '';
    const r = evidence(reseal(w2));
    expectBlocked(r, 'evidence_missing_passage');
    expect(codes(r)).toContain('schema_invalid'); // contract min(1) also fails
  });
});

describe('evidence gate: source availability and retraction', () => {
  it('blocks a claim backed by an unavailable source', () => {
    const w = world();
    w.packet.sources[0]!.available = false;
    const r = evidence(w);
    expectBlocked(r, 'source_unavailable', { claimId: C.settings });
    // The only source for the settings claim no longer counts as an origin, and the
    // consequential permission claim loses one of its two origins.
    expect(codes(r)).toContain('insufficient_independent_origins');
  });

  it('blocks a claim backed by a retracted source', () => {
    const w = world();
    w.packet.sources[2]!.retracted = true;
    const r = evidence(w);
    expectBlocked(r, 'source_retracted', { claimId: C.inference });
    expect(codes(r)).toContain('insufficient_independent_origins');
  });

  it('blocks elevated/high claims whose sources were never checked for retraction', () => {
    const w = world();
    w.packet.sources[0]!.retractionCheckedAt = null;
    expect(evidence(w).ok).toBe(true); // low-risk: allowed
    claim(w, C.settings).riskTier = 'elevated';
    claim(w, C.settings).limitations = 'Placeholder limitation.';
    expectBlocked(evidence(reseal(w)), 'retraction_unchecked', { only: true, claimId: C.settings });
  });

  it('treats an elevated topic as elevated for every claim', () => {
    const w = world();
    w.packet.sources[0]!.retractionCheckedAt = null;
    w.packet.topic.riskTier = 'elevated';
    const r = evidence(w);
    expectBlocked(r, 'retraction_unchecked');
    expectBlocked(r, 'limitations_missing', { claimId: C.settings });
  });
});

describe('evidence gate: origin independence', () => {
  it('treats two sources repeating one press release as one origin', () => {
    const w = world();
    w.packet.sources[1]!.originId = w.packet.sources[0]!.originId;
    expectBlocked(evidence(w), 'insufficient_independent_origins', { only: true, claimId: C.gate });
  });

  it.each(['isNumeric', 'isCausal', 'isConsequential'] as const)('requires two origins for a %s claim', (flag) => {
    const w = world();
    claim(w, C.settings)[flag] = true;
    expectBlocked(evidence(reseal(w)), 'insufficient_independent_origins', { only: true, claimId: C.settings });
  });

  it('allows a single origin when a justification is recorded, and reports the allowance', () => {
    const w = world();
    const c = claim(w, C.settings);
    c.isConsequential = true;
    c.singleOriginJustification = 'Platform documentation is authoritative for its own settings screen.';
    reseal(w);
    expect(evidence(w).ok).toBe(true);
    expect(listEvidenceAllowances({ packet: w.packet, version: w.version })).toEqual([
      expect.objectContaining({ code: 'single_origin_justified', claimId: C.settings }),
    ]);
  });

  it('does not accept a whitespace justification', () => {
    const w = world();
    const c = claim(w, C.settings);
    c.isCausal = true;
    c.singleOriginJustification = '  ';
    expectBlocked(evidence(reseal(w)), 'insufficient_independent_origins');
  });
});

describe('evidence gate: contradictions and limitations', () => {
  const addContradiction = (w: ReturnType<typeof world>, claimId: string) => {
    w.packet.evidence.push({
      ...w.packet.evidence[0]!,
      id: 'fixture-evidence-contra',
      claimId,
      sourceId: 'fixture-source-3',
      stance: 'contradicts',
    });
  };

  it('blocks a "supported" claim that has contradicting evidence', () => {
    const w = world();
    addContradiction(w, C.settings);
    expectBlocked(evidence(reseal(w)), 'contradiction_unaddressed', { only: true, claimId: C.settings });
  });

  it('allows contradicting evidence once the claim is supported_with_limits with limitations shown', () => {
    const w = world();
    addContradiction(w, C.inference);
    expect(evidence(reseal(w)).ok).toBe(true);
  });

  it('blocks supported_with_limits with empty limitations', () => {
    const w = world();
    claim(w, C.options).limitations = ' ';
    expectBlocked(evidence(reseal(w)), 'limitations_missing', { only: true, claimId: C.options });
  });

  it('blocks an elevated claim with no limitations', () => {
    const w = world();
    claim(w, C.settings).riskTier = 'elevated';
    expectBlocked(evidence(reseal(w)), 'limitations_missing', { only: true, claimId: C.settings });
  });
});

describe('evidence gate: freshness', () => {
  it('blocks a changing (policy/product) claim not rechecked within 24h', () => {
    const w = world();
    claim(w, C.gate).lastCheckedAt = iso(-25 * HOUR);
    expectBlocked(evidence(reseal(w)), 'changing_claim_not_rechecked', { only: true, claimId: C.gate });
  });

  it('accepts a recheck exactly 24h old and rejects one never checked or dated in the future', () => {
    const w = world();
    claim(w, C.gate).lastCheckedAt = iso(-24 * HOUR);
    expect(evidence(reseal(w)).ok).toBe(true);
    claim(w, C.gate).lastCheckedAt = null;
    expectBlocked(evidence(reseal(w)), 'changing_claim_not_rechecked');
    claim(w, C.gate).lastCheckedAt = iso(HOUR);
    expectBlocked(evidence(reseal(w)), 'changing_claim_not_rechecked');
  });

  it('blocks a claim at or past freshUntil', () => {
    const w = world();
    claim(w, C.settings).freshUntil = NOW.toISOString();
    expectBlocked(evidence(reseal(w)), 'claim_stale', { only: true, claimId: C.settings });
  });

  it('the same packet goes stale as time passes', () => {
    const w = world();
    const later = new Date(NOW.getTime() + 13 * HOUR);
    const r = evidence(w, later);
    expectBlocked(r, 'claim_stale', { claimId: C.gate });
    expect(evidence(w, new Date(NOW.getTime() + 25 * HOUR)).issues.some((i) => i.code === 'changing_claim_not_rechecked')).toBe(true);
  });
});

describe('evidence gate: unsupported numbers', () => {
  it('blocks a digit in narration when none of the beat claims is numeric', () => {
    const w = world();
    beat(w, 'problem').narration = 'Most people tap through 9 out of 10 prompts.';
    expectBlocked(evidence(w), 'unsupported_number', { only: true });
  });

  it('blocks number words and percentages', () => {
    for (const text of ['Half of all apps ask for location.', 'Apps ask three times a day.', 'It is 40% faster.', 'Millions of users allow it.']) {
      const w = world();
      beat(w, 'problem').narration = text;
      expectBlocked(evidence(w), 'unsupported_number');
    }
  });

  it('allows a number when an attached claim is numeric (and well sourced)', () => {
    const w = world();
    beat(w, 'mechanism').narration += ' There are two main options.';
    claim(w, C.options).isNumeric = true;
    expect(evidence(reseal(w)).ok).toBe(true);
  });

  it('a numeric claim on another beat does not license a number here', () => {
    const w = world();
    claim(w, C.options).isNumeric = true;
    beat(w, 'takeaway').narration = 'So check your settings twice a year.';
    expectBlocked(evidence(reseal(w)), 'unsupported_number');
  });

  it('blocks a number in the caption when no version claim is numeric', () => {
    const w = world();
    w.version.caption += '\n80% of apps do this.';
    expectBlocked(evidence(w), 'unsupported_number', { only: true });
  });

  it('ignores the episode code, ISO dates and URLs, and pronoun "one"', () => {
    const w = world();
    w.version.caption += '\nSee https://fixture-source-9.invalid/a1 (retrieved 2026-10-01). Which one is yours? LU-TECH-002';
    beat(w, 'hook').narration = 'Which one of your apps can see where you are?';
    expect(evidence(w).ok).toBe(true);
  });
});

describe('evidence gate: causal overclaim', () => {
  it.each([
    'Turning this off prevents tracking.',
    'Turning this off guarantees privacy.',
    'This setting will make you invisible.',
    'Location sharing causes data leaks.',
    'Research proves apps spy on you.',
    'This definitely stops tracking.',
  ])('blocks "%s" when no attached claim is causal', (text) => {
    const w = world();
    beat(w, 'takeaway').narration = text;
    expectBlocked(evidence(w), 'causal_overclaim');
  });

  it('allows causal language when an attached claim is causal (and has two origins)', () => {
    const w = world();
    beat(w, 'mechanism').narration += ' Denying it prevents the app reading location services.';
    claim(w, C.gate).isCausal = true;
    expect(evidence(reseal(w)).ok).toBe(true);
  });

  it('blocks causal language in the caption', () => {
    const w = world();
    w.version.caption += '\nThis one setting cures tracking.';
    expectBlocked(evidence(w), 'causal_overclaim', { only: true });
  });

  it('does not flag ordinary words that contain causal stems', () => {
    const w = world();
    beat(w, 'problem').narration = 'Apps provide prompts that approve nothing by themselves, so be curious and secure.';
    expect(evidence(w).ok).toBe(true);
  });
});

describe('evidence gate: caveat retention for supported_with_limits', () => {
  it('blocks a limited claim when its permitted wording is dropped from beat and caption', () => {
    const w = world();
    beat(w, 'mechanism').narration = 'The operating system sits in between: an app can read location services only after you grant permission. Every phone lets you choose approximate or precise location.';
    w.version.caption = w.version.caption.replace('the exact options vary by phone', 'it is simple');
    expectBlocked(evidence(w), 'caveat_missing', { only: true, claimId: C.options });
  });

  it('a generic hedge does not replace specific permitted wording', () => {
    const w = world();
    beat(w, 'twist').narration = 'But your location may be known without that permission. That is a question worth asking next.';
    w.version.caption = w.version.caption.replace('can sometimes be estimated', 'is known');
    expectBlocked(evidence(w), 'caveat_missing', { claimId: C.inference });
  });

  it('without permitted wording, a reviewed hedge keyword is required', () => {
    const w = world();
    claim(w, C.inference).permittedWording = null;
    reseal(w);
    expect(evidence(w).ok).toBe(true); // "can sometimes" present
    beat(w, 'twist').narration = 'But your location is known without that permission, from your network. That is a question worth asking next.';
    // The caption still says "vary by phone" about a different claim; that must not count.
    expectBlocked(evidence(w), 'caveat_missing', { only: true, claimId: C.inference });
  });

  it('checks limited claims that sit on no beat against the caption', () => {
    const w = world();
    for (const b of w.version.beats) b.claimIds = b.claimIds.filter((id) => id !== C.options);
    w.version.caption = w.version.caption.replace('the exact options vary by phone', 'it is simple');
    expectBlocked(evidence(w), 'caveat_missing', { claimId: C.options });
  });
});

describe('evidence gate: risk tiers and reviews', () => {
  it('blocks a claim with no AI verification pass', () => {
    const w = world();
    w.packet.reviews = w.packet.reviews.filter((r) => r.claimId !== C.settings);
    expectBlocked(evidence(w), 'missing_ai_verification', { only: true, claimId: C.settings });
  });

  it('a later failed AI verification overrides an earlier pass; a later pass supersedes a fail', () => {
    const w = world();
    const pass = w.packet.reviews.find((r) => r.claimId === C.settings)!;
    w.packet.reviews.push({ ...pass, id: 'fixture-review-fail', verdict: 'fail', createdAt: iso(-HOUR / 2) });
    expectBlocked(evidence(w), 'missing_ai_verification', { claimId: C.settings });
    // pass_with_changes is not a pass: the changes must be made and re-reviewed.
    w.packet.reviews.push({ ...pass, id: 'fixture-review-changes', verdict: 'pass_with_changes', createdAt: iso(-HOUR / 4) });
    expectBlocked(evidence(w), 'missing_ai_verification', { claimId: C.settings });
    w.packet.reviews.push({ ...pass, id: 'fixture-review-repass', verdict: 'pass', createdAt: iso(-HOUR / 8) });
    expect(evidence(w).ok).toBe(true);
  });

  it('a qualified human review does not substitute for the AI verification pass', () => {
    const w = world();
    w.packet.reviews = w.packet.reviews.filter((r) => r.claimId !== C.settings);
    w.packet.reviews.push(humanReview({ id: 'h1', claimId: C.settings }));
    expectBlocked(evidence(w), 'missing_ai_verification');
  });

  it('holds a high-risk claim without a documented qualified human review', () => {
    const w = world();
    const c = claim(w, C.settings);
    c.riskTier = 'high';
    c.limitations = 'Placeholder limitation.';
    reseal(w);
    expectBlocked(evidence(w), 'missing_qualified_review', { only: true, claimId: C.settings });

    w.packet.reviews.push(humanReview({ id: 'h-nodoc', claimId: C.settings, documentRef: null }));
    expectBlocked(evidence(w), 'missing_qualified_review');

    w.packet.reviews.push(humanReview({ id: 'h-fail', claimId: C.settings, verdict: 'fail', createdAt: iso(-HOUR / 2) }));
    expectBlocked(evidence(w), 'missing_qualified_review');

    w.packet.reviews.push(humanReview({ id: 'h-pass', claimId: C.settings, createdAt: iso(-HOUR / 4) }));
    expect(evidence(w).ok).toBe(true);
  });

  it('a high-risk topic holds every claim', () => {
    const w = world();
    w.packet.topic.riskTier = 'high';
    const r = evidence(w);
    expectBlocked(r, 'missing_qualified_review');
    expect(r.issues.filter((i) => i.code === 'missing_qualified_review').map((i) => i.claimId).sort()).toEqual(
      [C.gate, C.inference, C.options, C.settings].sort(),
    );
  });
});

describe('evidence gate: expert badges', () => {
  it.each(['Doctor approved privacy tip.', 'Expert-verified advice.', 'A clinically proven setting.', 'Verified by experts.'])(
    'blocks "%s" in the caption without an authorizing review',
    (text) => {
      const w = world();
      w.version.caption += `\n${text}`;
      expectBlocked(evidence(w), 'unauthorized_badge');
    },
  );

  it('blocks a badge in a visual overlay or narration too', () => {
    const w = world();
    beat(w, 'hook').visual = 'On-screen stamp: EXPERT VERIFIED';
    expectBlocked(evidence(w), 'unauthorized_badge', { only: true });
  });

  it('allows the badge only with a documented, passing review authorizing that exact wording', () => {
    const w = world();
    w.version.caption += '\nExpert verified.';
    w.packet.reviews.push(humanReview({ id: 'h-ok', authorizedDisplayWording: 'Reviewed and expert verified by [FIXTURE] reviewer' }));
    expect(evidence(w).ok).toBe(true);

    const w2 = world();
    w2.version.caption += '\nDoctor approved.';
    w2.packet.reviews.push(humanReview({ id: 'h-other', authorizedDisplayWording: 'expert verified' }));
    expectBlocked(evidence(w2), 'unauthorized_badge');

    const w3 = world();
    w3.version.caption += '\nExpert verified.';
    w3.packet.reviews.push(humanReview({ id: 'h-nodoc', documentRef: null, authorizedDisplayWording: 'expert verified' }));
    expectBlocked(evidence(w3), 'unauthorized_badge');

    const w4 = world();
    w4.version.caption += '\nExpert verified.';
    w4.packet.reviews.push({ ...humanReview({ id: 'ai-badge', authorizedDisplayWording: 'expert verified' }), reviewerKind: 'ai_verification' });
    expectBlocked(evidence(w4), 'unauthorized_badge');
  });
});

describe('evidence gate coverage', () => {
  it('every evidence issue code is exercised by a test in this file', () => {
    expect([...EVIDENCE_ISSUE_CODES].filter((c) => !proven.has(c))).toEqual([]);
  });
});
