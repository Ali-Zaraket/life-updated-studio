import {
  checkTransition,
  hashCanonical,
  type Claim,
  type ClaimEvidence,
  type EpisodeVersionContent,
  type Source,
} from '@life/contracts';
import { describe, expect, it } from 'vitest';
import {
  CORRECTION_ACTIONS,
  CORRECTION_OPERATION_KINDS,
  CORRECTIONS_ACTOR,
  planCorrection,
  type CorrectionInputs,
  type CorrectionPlan,
  type CorrectionTrigger,
  type EpisodeCorrection,
} from '../src/index';
import { C, HOUR, NOW, world } from './helpers';

/*
 * World (fixture packet + extras):
 *   sources: 1 (origin platform-a), 2 (platform-b), 3 (research),
 *            4 (platform-a again: a second article repeating source 1's origin)
 *   claims:  fixture gate/options/settings/inference, plus X (consequential,
 *            supported by source 4 [origin a] and source 3)
 *
 *   E1  LU-TECH-001 published   v1 = fixture version (all fixture claims)   live media (LIVE)
 *   E2  LU-TECH-002 scheduled   v2 uses gate                                job j2 queued
 *   E3  LU-TECH-003 publishing  v3 uses gate                                job j3 needs_reconciliation, j3b queued
 *   E4  LU-TECH-004 scripted    v4 uses settings in a beat only (not in claimIds)
 *   E5  LU-TECH-005 published   v5 uses gate                                media (MOCK)
 *   E6  LU-TECH-006 measuring   v6a (past) uses gate; v6b (current) inference; media of v6b (LIVE)
 *   E7  LU-TECH-007 approved    v7 uses nothing affected; ending → E2
 *   E8  LU-TECH-008 verified    v8 uses nothing affected; ending → E7
 *   E9  LU-TECH-009 scripted    link to E2 but ending does NOT reference it
 *   E10 LU-TECH-010 published   v10 uses options                            media (MANUAL IMPORT)
 *   E11 LU-TECH-011 scripted    v11 uses X
 */

const X = 'x-claim-press-release';
const ORIGIN_A = 'fixture-origin-platform-a';

function inputs(): CorrectionInputs {
  const w = world();
  const sources: Source[] = structuredClone(w.packet.sources);
  const s1 = sources.find((s) => s.id === 'fixture-source-1')!;
  sources.push({ ...structuredClone(s1), id: 'fixture-source-4', url: 'https://fixture-source-4.invalid/repeat', title: '[FIXTURE] Article repeating platform A' });

  const claims: Claim[] = structuredClone(w.packet.claims);
  claims.push({ ...structuredClone(claims[0]!), id: X, text: '[FIXTURE] A consequential claim backed by a repeated press release and research.' });

  const evidence: ClaimEvidence[] = structuredClone(w.packet.evidence);
  const ev = (id: string, claimId: string, sourceId: string, stance: ClaimEvidence['stance'] = 'supports'): ClaimEvidence => ({
    ...structuredClone(evidence[0]!),
    id,
    claimId,
    sourceId,
    stance,
  });
  evidence.push(ev('x-ev-1', X, 'fixture-source-4'), ev('x-ev-2', X, 'fixture-source-3'));

  const base = w.version;
  const ver = (id: string, episodeId: string, n: number, listed: string[], beatClaims: string[] = listed) => ({
    id,
    episodeId,
    content: {
      ...structuredClone(base),
      episodeId,
      versionNumber: n,
      claimIds: listed,
      beats: [{ ...structuredClone(base.beats[0]!), claimIds: beatClaims }],
    } satisfies EpisodeVersionContent,
  });

  const versions = [
    { id: 'v1', episodeId: 'E1', content: structuredClone(base) },
    ver('v2', 'E2', 1, [C.gate]),
    ver('v3', 'E3', 1, [C.gate]),
    ver('v4', 'E4', 1, [], [C.settings]),
    ver('v5', 'E5', 1, [C.gate]),
    ver('v6a', 'E6', 1, [C.gate]),
    ver('v6b', 'E6', 2, [C.inference]),
    ver('v7', 'E7', 1, []),
    ver('v8', 'E8', 1, []),
    ver('v9', 'E9', 1, []),
    ver('v10', 'E10', 1, [C.options]),
    ver('v11', 'E11', 1, [X]),
  ];
  versions[0]!.content.episodeId = 'E1';

  const ep = (n: number, state: CorrectionInputs['episodes'][number]['state'], currentVersionId: string) => ({
    id: `E${n}`,
    code: `LU-TECH-${String(n).padStart(3, '0')}`,
    state,
    currentVersionId,
  });
  const episodes: CorrectionInputs['episodes'] = [
    ep(1, 'published', 'v1'),
    ep(2, 'scheduled', 'v2'),
    ep(3, 'publishing', 'v3'),
    ep(4, 'scripted', 'v4'),
    ep(5, 'published', 'v5'),
    ep(6, 'measuring', 'v6b'),
    ep(7, 'approved', 'v7'),
    ep(8, 'verified', 'v8'),
    ep(9, 'scripted', 'v9'),
    ep(10, 'published', 'v10'),
    ep(11, 'scripted', 'v11'),
  ];

  const link = (episodeId: string, relatedEpisodeId: string | null, endingReferencesRelated: boolean) => ({
    ...structuredClone(w.link),
    episodeId,
    relatedEpisodeId,
    endingReferencesRelated,
  });

  return {
    claims,
    evidence,
    sources,
    episodes,
    versions,
    links: [link('E1', null, false), link('E7', 'E2', true), link('E8', 'E7', true), link('E9', 'E2', false)],
    publishJobs: [
      { id: 'j1', episodeId: 'E1', state: 'published', episodeVersionId: 'v1' },
      { id: 'j2', episodeId: 'E2', state: 'queued', episodeVersionId: 'v2' },
      { id: 'j3', episodeId: 'E3', state: 'needs_reconciliation', episodeVersionId: 'v3' },
      { id: 'j3b', episodeId: 'E3', state: 'queued', episodeVersionId: 'v3' },
      { id: 'j5', episodeId: 'E5', state: 'published', episodeVersionId: 'v5' },
      { id: 'j7', episodeId: 'E7', state: 'retry_wait', episodeVersionId: 'v7' },
      { id: 'j-old', episodeId: 'E2', state: 'cancelled', episodeVersionId: 'v2' },
    ],
    liveMedia: [
      { episodeId: 'E1', permalink: 'https://instagram.invalid/p/e1', source: 'live', episodeVersionId: 'v1', publishJobId: 'j1' },
      { episodeId: 'E5', permalink: 'https://mock.invalid/p/e5', source: 'mock', episodeVersionId: 'v5', publishJobId: 'j5' },
      { episodeId: 'E6', permalink: 'https://instagram.invalid/p/e6', source: 'live', episodeVersionId: 'v6b', publishJobId: null },
      { episodeId: 'E10', permalink: 'https://instagram.invalid/p/e10', source: 'manual_import', episodeVersionId: 'v10', publishJobId: null },
    ],
  };
}

const allPlans: CorrectionPlan[] = [];
function plan(trigger: CorrectionTrigger, inp: CorrectionInputs = inputs(), now: Date = NOW): CorrectionPlan {
  const p = planCorrection(trigger, inp, now);
  allPlans.push(p);
  return p;
}
const epOf = (p: CorrectionPlan, id: string): EpisodeCorrection => {
  const e = p.episodes.find((x) => x.episodeId === id);
  if (!e) throw new Error(`episode ${id} not in plan; have ${p.episodes.map((x) => x.episodeId).join(',')}`);
  return e;
};
const claimOf = (p: CorrectionPlan, id: string) => {
  const c = p.affectedClaims.find((x) => x.claimId === id);
  if (!c) throw new Error(`claim ${id} not affected`);
  return c;
};

function retract(inp: CorrectionInputs, sourceId: string, note: string | null = null): CorrectionInputs {
  const s = inp.sources.find((x) => x.id === sourceId)!;
  s.retracted = true;
  s.correctionNote = note;
  return inp;
}

describe('source trigger', () => {
  const inp = retract(inputs(), 'fixture-source-1', 'Publisher notice: the permission section was rewritten.');
  const p = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);

  it('discredits only that source and lists same-origin siblings for review', () => {
    expect(p.discredited).toEqual({ sourceIds: ['fixture-source-1'], originIds: [ORIGIN_A], sameOriginSourceIds: ['fixture-source-4'] });
  });

  it('finds every claim citing it and computes origin loss with the gate rules', () => {
    expect(p.affectedClaims.map((c) => c.claimId)).toEqual([C.gate, C.options, C.settings].sort());
    const gate = claimOf(p, C.gate);
    expect(gate.reasons).toEqual(['cites_discredited_source', 'origin_independence_lost']);
    expect(gate.originsBefore).toEqual([ORIGIN_A, 'fixture-origin-platform-b']);
    expect(gate.originsAfter).toEqual(['fixture-origin-platform-b']);
    expect(gate.supportableAfter).toBe(false);

    const options = claimOf(p, C.options);
    expect(options.reasons).toEqual(['cites_discredited_source']);
    expect(options.requiresIndependentOrigins).toBe(false);
    expect(options.supportableAfter).toBe(true);

    expect(claimOf(p, C.settings).reasons).toEqual(['cites_discredited_source', 'no_remaining_support']);
    // X is backed by source 4 (same origin, not retracted itself) and is not affected by a single-source trigger.
    expect(p.affectedClaims.some((c) => c.claimId === X)).toBe(false);
  });

  it('includes the source correction note as "what is right" in live drafts', () => {
    const d = epOf(p, 'E1').correctionDraft!;
    expect(d.whatIsRight.join('\n')).toContain('Publisher notice: the permission section was rewritten.');
    expect(d.sources.filter((s) => s.role === 'discredited').map((s) => s.sourceId)).toEqual(['fixture-source-1']);
  });

  it('warns when the flagged source is not marked as changed in the ledger', () => {
    const q = plan({ kind: 'source', sourceId: 'fixture-source-1' });
    expect(q.warnings.some((w) => w.includes('available, unretracted and uncorrected'))).toBe(true);
  });
});

describe('origin trigger (transitive origin loss)', () => {
  const p = plan({ kind: 'origin', originId: ORIGIN_A });

  it('discredits every source in the origin', () => {
    expect(p.discredited.sourceIds).toEqual(['fixture-source-1', 'fixture-source-4']);
    expect(p.discredited.sameOriginSourceIds).toEqual([]);
  });

  it('reaches claims that cite a different source row of the same origin', () => {
    const x = claimOf(p, X);
    expect(x.reasons).toEqual(['cites_discredited_origin', 'origin_independence_lost']);
    expect(x.discreditedEvidenceIds).toEqual(['x-ev-1']);
    expect(x.originsBefore).toEqual([ORIGIN_A, 'fixture-origin-research']);
    expect(x.originsAfter).toEqual(['fixture-origin-research']);
    expect(epOf(p, 'E11').action).toBe('rework');
    expect(epOf(p, 'E11').transition).toMatchObject({ from: 'scripted', to: 'researching' });
  });

  it('does not touch claims whose support is independent of the origin', () => {
    expect(p.affectedClaims.some((c) => c.claimId === C.inference)).toBe(false);
  });
});

describe('claim trigger', () => {
  const inp = inputs();
  const c = inp.claims.find((x) => x.id === C.inference)!;
  c.status = 'rejected';
  c.statusReason = 'Placeholder: re-reading found the cited section describes a different mechanism.';
  const p = plan({ kind: 'claim', claimId: C.inference }, inp);

  it('affects the claim, not its siblings, and lists siblings sharing a source as related only', () => {
    expect(p.affectedClaims.map((x) => x.claimId)).toEqual([C.inference]);
    expect(claimOf(p, C.inference).reasons).toEqual(['trigger_claim']);
    expect(claimOf(p, C.inference).supportableAfter).toBe(false);
    expect(p.relatedClaims.map((r) => r.claimId)).toEqual([C.options, C.gate, X].sort());
    expect(p.relatedClaims.every((r) => r.reason === 'shares_source_with_trigger_claim')).toBe(true);
    expect(p.discredited.sourceIds).toEqual([]);
  });

  it('drafts a live correction that states the reason and invents nothing about what is right', () => {
    const d = epOf(p, 'E1').correctionDraft!;
    expect(d.status).toBe('draft_requires_owner_approval');
    expect(d.whatWasWrong.join(' ')).toContain('now rejected');
    expect(d.whatWasWrong.join(' ')).toContain('describes a different mechanism');
    expect(d.whatIsRight).toEqual(['Not yet established. Research is required before any corrected statement is published.']);
    expect(d.noteText.startsWith('[DRAFT CORRECTION - requires owner approval')).toBe(true);
  });

  it('a live post of the current version that uses the claim gets a correction draft', () => {
    expect(epOf(p, 'E6').action).toBe('propose_live_correction');
    expect(epOf(p, 'E6').causes.currentVersionAffected).toBe(true);
  });

  it('warns when the ledger still says supported and treats the claim as unsupportable', () => {
    const q = plan({ kind: 'claim', claimId: C.settings });
    expect(q.warnings.some((w) => w.includes('still marks it supported'))).toBe(true);
    expect(claimOf(q, C.settings).supportableAfter).toBe(false);
  });

  it('a downgrade to supported_with_limits leaves the claim supportable (script fix, not research)', () => {
    const i2 = inputs();
    const s = i2.claims.find((x) => x.id === C.settings)!;
    s.status = 'supported_with_limits';
    s.limitations = 'Placeholder limitation.';
    const q = plan({ kind: 'claim', claimId: C.settings }, i2);
    expect(claimOf(q, C.settings).supportableAfter).toBe(true);
    expect(epOf(q, 'E4').transition).toBeNull();
    expect(epOf(q, 'E4').notes).toContain('episode is already in scripted');
  });

  it('an unknown trigger id yields an empty plan with a warning', () => {
    const q = plan({ kind: 'claim', claimId: 'nope' });
    expect(q.affectedClaims).toEqual([]);
    expect(q.episodes).toEqual([]);
    expect(q.severity).toBe('none');
    expect(q.warnings.some((w) => w.includes('nope'))).toBe(true);
  });
});

describe('episode actions', () => {
  const p = plan({ kind: 'source', sourceId: 'fixture-source-1' }, retract(inputs(), 'fixture-source-1'));

  it('suspend: scheduled episode with a queued job', () => {
    const e = epOf(p, 'E2');
    expect(e.action).toBe('suspend');
    expect(e.cancelJobIds).toEqual(['j2']);
    expect(e.revokeUnusedApprovals).toBe(true);
    expect(e.transition).toEqual({ from: 'scheduled', to: 'blocked', heldFrom: 'scheduled', reason: `correction: uses affected claim(s) ${C.gate}` });
    expect(e.ownerDecisionRequired).toBe(false);
  });

  it('hold_for_owner: in-flight publish is not cancelled; only safe sibling jobs are', () => {
    const e = epOf(p, 'E3');
    expect(e.action).toBe('hold_for_owner');
    expect(e.inFlightJobIds).toEqual(['j3']);
    expect(e.cancelJobIds).toEqual(['j3b']);
    expect(e.transition).toBeNull();
    expect(e.ownerDecisionRequired).toBe(true);
    expect(p.operations.some((o) => o.kind === 'cancel_publish_job' && o.jobId === 'j3')).toBe(false);
    expect(p.operations).toContainEqual(expect.objectContaining({ kind: 'owner_review_in_flight_publish', episodeId: 'E3', jobIds: ['j3'], automatic: false }));
  });

  it('propose_live_correction: published episodes get a draft and no transition', () => {
    for (const id of ['E1', 'E5', 'E10']) {
      const e = epOf(p, id);
      expect(e.action).toBe('propose_live_correction');
      expect(e.transition).toBeNull();
      expect(e.correctionDraft).not.toBeNull();
      expect(e.ownerDecisionRequired).toBe(true);
    }
  });

  it('rework: draft episode goes back to researching when a claim has no remaining support; beat-only usage counts', () => {
    const e = epOf(p, 'E4');
    expect(e.action).toBe('rework');
    expect(e.transition).toMatchObject({ from: 'scripted', to: 'researching', heldFrom: null });
    const v = p.affectedVersions.find((x) => x.versionId === 'v4')!;
    expect(v.uses).toEqual([{ claimId: C.settings, inVersionClaimIds: false, beats: [{ index: 0, role: 'hook' }] }]);
  });

  it('rework never advances an episode', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.episodes.find((e) => e.id === 'E4')!.state = 'idea';
    const e = epOf(plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp), 'E4');
    expect(e.action).toBe('rework');
    expect(e.transition).toBeNull();
  });

  it('past-version-only usage: listed, but the live post of the clean current version is record_only', () => {
    const e = epOf(p, 'E6');
    expect(e.action).toBe('record_only');
    expect(e.causes.affectedVersionIds).toEqual(['v6a']);
    expect(e.causes.currentVersionAffected).toBe(false);
    expect(e.revokeUnusedApprovals).toBe(false);
    expect(p.affectedVersions.find((v) => v.versionId === 'v6a')).toMatchObject({ isCurrent: false, episodeId: 'E6' });
    expect(claimOf(p, C.gate).versionIds).toContain('v6a');
  });

  it('past-version-only usage with an unknown live version is treated conservatively', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.liveMedia.find((m) => m.episodeId === 'E6')!.episodeVersionId = null;
    const e = epOf(plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp), 'E6');
    expect(e.action).toBe('propose_live_correction');
  });

  it('a draft whose only affected version is a past one is record_only', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.versions.push({ id: 'v4old', episodeId: 'E4', content: { ...structuredClone(inp.versions[1]!.content), episodeId: 'E4', versionNumber: 0 + 2 } });
    inp.versions = inp.versions.map((v) => (v.id === 'v4' ? { ...v, content: { ...v.content, beats: [{ ...v.content.beats[0]!, claimIds: [] }] } } : v));
    const e = epOf(plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp), 'E4');
    expect(e.action).toBe('record_only');
    expect(e.causes.affectedVersionIds).toEqual(['v4old']);
  });

  it('cancelled episodes are record_only; terminal jobs are ignored', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.episodes.find((e) => e.id === 'E4')!.state = 'cancelled';
    const q = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);
    expect(epOf(q, 'E4').action).toBe('record_only');
    expect(epOf(q, 'E2').cancelJobIds).not.toContain('j-old');
  });

  it('a published episode with no media row is treated as public (unknown) until reconciled', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.liveMedia = inp.liveMedia.filter((m) => m.episodeId !== 'E1');
    const e = epOf(plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp), 'E1');
    expect(e.action).toBe('propose_live_correction');
    expect(e.exposure).toBe('unknown');
    expect(e.correctionDraft!.noteText).toContain('no media record supplied');
  });
});

describe('linked endings', () => {
  const p = plan({ kind: 'source', sourceId: 'fixture-source-1' }, retract(inputs(), 'fixture-source-1'));

  it('an episode whose ending references an affected episode is affected (depth 1)', () => {
    const e = epOf(p, 'E7');
    expect(e.causes.claimIds).toEqual([]);
    expect(e.causes.endingReferences).toEqual(['E2']);
    expect(e.causes.linkDepth).toBe(1);
    expect(e.action).toBe('suspend');
    expect(e.cancelJobIds).toEqual(['j7']);
    expect(e.transition).toMatchObject({ from: 'approved', to: 'blocked', reason: 'correction: ending references affected episode(s) E2' });
  });

  it('propagates transitively through suspended episodes (depth 2)', () => {
    const e = epOf(p, 'E8');
    expect(e.causes.endingReferences).toEqual(['E7']);
    expect(e.causes.linkDepth).toBe(2);
    expect(e.action).toBe('rework');
    expect(e.transition).toMatchObject({ from: 'verified', to: 'scripted' });
  });

  it('links whose ending does not reference the episode do not propagate', () => {
    expect(p.episodes.some((e) => e.episodeId === 'E9')).toBe(false);
  });

  it('a live episode affected only via its ending gets a draft naming the referenced episode', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.links.push({ ...inp.links[0]!, episodeId: 'E9', relatedEpisodeId: 'E2', endingReferencesRelated: true });
    inp.episodes.find((e) => e.id === 'E9')!.state = 'published';
    inp.liveMedia.push({ episodeId: 'E9', permalink: 'https://instagram.invalid/p/e9', source: 'live' });
    const e = epOf(plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp), 'E9');
    expect(e.action).toBe('propose_live_correction');
    expect(e.correctionDraft!.whatWasWrong).toEqual(['The ending points to LU-TECH-002, which is itself under correction.']);
  });

  it('link cycles terminate', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.links.push({ ...inp.links[0]!, episodeId: 'E2', relatedEpisodeId: 'E8', endingReferencesRelated: true });
    const q = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);
    expect(epOf(q, 'E2').action).toBe('suspend');
    expect(epOf(q, 'E8').causes.linkDepth).toBe(2);
  });

  it('record_only episodes do not propagate', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.links.push({ ...inp.links[0]!, episodeId: 'E9', relatedEpisodeId: 'E6', endingReferencesRelated: true });
    const q = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);
    expect(q.episodes.some((e) => e.episodeId === 'E9')).toBe(false);
  });
});

describe('mock vs live labelling, severity and pause', () => {
  const p = plan({ kind: 'source', sourceId: 'fixture-source-1' }, retract(inputs(), 'fixture-source-1'));

  it('labels each post by data source', () => {
    expect(epOf(p, 'E1')).toMatchObject({ exposure: 'public', media: [expect.objectContaining({ label: 'LIVE', source: 'live' })] });
    expect(epOf(p, 'E10')).toMatchObject({ exposure: 'public', media: [expect.objectContaining({ label: 'MANUAL IMPORT' })] });
    const mock = epOf(p, 'E5');
    expect(mock.exposure).toBe('mock_only');
    expect(mock.media).toEqual([expect.objectContaining({ label: 'MOCK', source: 'mock' })]);
    expect(mock.correctionDraft!.noteText).toContain('[MOCK POST - not a live launch');
    expect(mock.correctionDraft!.noteText).toContain('[MOCK] https://mock.invalid/p/e5');
    expect(epOf(p, 'E1').correctionDraft!.noteText).not.toContain('MOCK');
  });

  it('a public post affected → high severity and pause recommended', () => {
    expect(p.severity).toBe('high');
    expect(p.globalPause).toEqual({ recommended: true, reasons: ['public_post_affected', 'publish_in_flight'] });
    expect(p.summary).toContain('Global publishing pause recommended');
    expect(p.ownerReviewRequired).toBe(true);
  });

  it('only a mock post affected → no pause, not reported as live', () => {
    const inp = retract(inputs(), 'fixture-source-1');
    inp.episodes = inp.episodes.filter((e) => e.id === 'E5');
    const q = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);
    expect(q.globalPause.recommended).toBe(false);
    expect(q.severity).toBe('elevated');
    expect(q.summary).toContain('[MOCK]');
    expect(q.summary).not.toContain('LIVE');
  });

  it('a high-risk claim affected → pause recommended even with nothing live; critical if also public', () => {
    const inp = inputs();
    inp.claims.find((c) => c.id === X)!.riskTier = 'high';
    inp.claims.find((c) => c.id === X)!.status = 'unresolved';
    const q = plan({ kind: 'claim', claimId: X }, inp);
    expect(q.maxRiskTier).toBe('high');
    expect(q.globalPause).toEqual({ recommended: true, reasons: ['high_risk_claim_affected'] });
    expect(q.severity).toBe('high');
    expect(epOf(q, 'E11').action).toBe('rework');

    inp.episodes.find((e) => e.id === 'E11')!.state = 'published';
    inp.liveMedia.push({ episodeId: 'E11', permalink: 'https://instagram.invalid/p/e11', source: 'live' });
    expect(plan({ kind: 'claim', claimId: X }, inp).severity).toBe('critical');
  });

  it('a low-risk claim used only in drafts → low severity, no pause, no owner review needed', () => {
    const inp = inputs();
    inp.claims.find((c) => c.id === X)!.status = 'rejected';
    const q = plan({ kind: 'claim', claimId: X }, inp);
    expect(q.severity).toBe('low');
    expect(q.globalPause.recommended).toBe(false);
    expect(q.ownerReviewRequired).toBe(false);
    expect(q.operations.map((o) => o.kind)).toEqual(['revoke_unused_approvals', 'transition_episode']);
  });
});

describe('planSha256', () => {
  const trigger: CorrectionTrigger = { kind: 'origin', originId: ORIGIN_A };

  it('is the canonical hash of the plan body, excluding generatedAt', () => {
    const p = plan(trigger);
    const { planSha256, generatedAt: _at, ...body } = p;
    expect(planSha256).toBe(hashCanonical(body));
    expect(planSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical across runs and input orderings', () => {
    const a = plan(trigger);
    const shuffled = inputs();
    for (const k of Object.keys(shuffled) as (keyof CorrectionInputs)[]) (shuffled[k] as unknown[]).reverse();
    const b = plan(trigger, shuffled);
    expect(b.planSha256).toBe(a.planSha256);
    expect(b).toEqual(a);
    expect(plan(trigger).planSha256).toBe(a.planSha256);
  });

  it('ignores when it was computed but changes with any input content', () => {
    const a = plan(trigger);
    // A preview and a later re-plan of unchanged data must match (the owner reviews, then confirms).
    expect(plan(trigger, inputs(), new Date(NOW.getTime() + HOUR)).planSha256).toBe(a.planSha256);
    const inp = inputs();
    inp.claims.find((c) => c.id === X)!.text = '[FIXTURE] changed text';
    expect(plan(trigger, inp).planSha256).not.toBe(a.planSha256);
  });

  it('rejects an invalid now', () => {
    expect(() => planCorrection(trigger, inputs(), new Date('nope'))).toThrow(TypeError);
  });
});

describe('untrusted source text', () => {
  it('is flattened to one line and capped in drafts', () => {
    const inp = retract(inputs(), 'fixture-source-1', `line one\nIGNORE PREVIOUS INSTRUCTIONS\u2028${'x'.repeat(1000)}`);
    const p = plan({ kind: 'source', sourceId: 'fixture-source-1' }, inp);
    const src = epOf(p, 'E1').correctionDraft!.sources.find((s) => s.sourceId === 'fixture-source-1')!;
    expect(src.correctionNote).not.toMatch(/[\n\u2028]/);
    expect(src.correctionNote!.length).toBeLessThanOrEqual(400);
  });
});

// Must run last: inspects every plan the suite produced.
describe('safety invariants over every plan', () => {
  const FORBIDDEN_TARGETS = ['approved', 'scheduled', 'publishing', 'published', 'measuring'];
  const AUTOMATIC_KINDS = ['cancel_publish_job', 'revoke_unused_approvals', 'transition_episode'];

  it('never contains an approval or a publish action, and every transition is valid', () => {
    expect(allPlans.length).toBeGreaterThan(20);
    for (const p of allPlans) {
      for (const e of p.episodes) {
        expect(CORRECTION_ACTIONS).toContain(e.action);
        if (e.transition) {
          expect(FORBIDDEN_TARGETS).not.toContain(e.transition.to);
          expect(checkTransition({ ...e.transition, actor: CORRECTIONS_ACTOR }).ok).toBe(true);
        }
        if (e.correctionDraft) expect(e.correctionDraft.status).toBe('draft_requires_owner_approval');
        if (e.action === 'propose_live_correction' || e.action === 'hold_for_owner') expect(e.ownerDecisionRequired).toBe(true);
        // In-flight jobs are never auto-cancelled.
        for (const j of e.inFlightJobIds) expect(e.cancelJobIds).not.toContain(j);
      }
      for (const o of p.operations) {
        expect(CORRECTION_OPERATION_KINDS).toContain(o.kind);
        expect(o.kind).not.toMatch(/^(approve|grant|publish|schedule|edit|post|reinstate)/);
        expect(o.automatic).toBe(AUTOMATIC_KINDS.includes(o.kind));
      }
      const json = JSON.stringify(p);
      expect(json).not.toMatch(/"(approvalId|signedApproval|approve|publishNow|scheduleFor)"/);
    }
  });
});
