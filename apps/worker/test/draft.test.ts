import { describe, expect, it } from 'vitest';
import { fixturePacket } from '@life/content';
import { ensureOwner, getEpisode, openPgliteDb, saveEvidencePacket, setSpending, tables as t } from '@life/db';
import { AnthropicReasoningClient, MockReasoningClient } from '@life/reasoning';
import { draftAndVerifyEpisode } from '../src/index';

const NOW = new Date('2026-10-23T09:00:00Z');

async function setup() {
  const h = await openPgliteDb();
  await ensureOwner(h.db, { id: 'owner', displayName: 'Owner' });
  const fx = fixturePacket(NOW);
  await saveEvidencePacket(h.db, { ...fx.packet, reviews: [] }); // the pipeline must earn its own AI review
  return { ...h, fx };
}
const draftFrom = (fx: ReturnType<typeof fixturePacket>) => ({ beats: fx.version.beats, caption: fx.version.caption, sourceList: fx.version.sourceList, nextQuestion: 'How else can location be estimated?', notes: '' });
const pass = (fx: ReturnType<typeof fixturePacket>) => ({
  claims: fx.packet.claims.map((c) => ({ claimId: c.id, verdict: 'pass', problems: [], suggestedWording: null })),
  beatProblems: [], overall: 'pass', summary: 'ok',
});

describe('draft and verify (MOCK reasoning)', () => {
  it('drafts, records AI reviews, passes the gates and stops at verified', async () => {
    const { db, close, fx } = await setup();
    try {
      const reasoning = new MockReasoningClient({ draft_script: draftFrom(fx), verify_script: pass(fx) });
      const r = await draftAndVerifyEpisode({ db, reasoning, now: () => NOW, log: () => {} }, { topicId: fx.packet.topic.id, format: 'everyday_mystery', code: 'LU-TECH-001' });
      expect(r.state).toBe('verified');
      expect(reasoning.calls).toEqual(['draft_script', 'verify_script']);
      expect((await getEpisode(db, r.episodeId)).state).toBe('verified');
      const reviews = await db.select().from(t.reviewRecords);
      expect(reviews.every((x) => x.reviewerKind === 'ai_verification' && x.reviewer === 'mock')).toBe(true);
      const costs = await db.select().from(t.costEvents);
      expect(costs.every((c) => c.source === 'mock' && c.amountMicroUsd === 0)).toBe(true);
    } finally {
      await close();
    }
  });

  it('blocks with reasons when the independent check fails or the draft begs for engagement', async () => {
    const { db, close, fx } = await setup();
    try {
      const bad = draftFrom(fx);
      bad.beats = bad.beats.map((b, i) => (i === bad.beats.length - 1 ? { ...b, narration: `${b.narration} Follow for part two!` } : b));
      const verdict = { ...pass(fx), overall: 'fail', summary: 'twist overclaims', claims: pass(fx).claims.map((c, i) => (i === 0 ? { ...c, verdict: 'fail', problems: ['overclaim'] } : c)) };
      const r = await draftAndVerifyEpisode({ db, reasoning: new MockReasoningClient({ draft_script: bad, verify_script: verdict }), now: () => NOW, log: () => {} }, { topicId: fx.packet.topic.id, format: 'everyday_mystery', code: 'LU-TECH-001' });
      expect(r.state).toBe('blocked');
      expect(r.blockers.join(' ')).toMatch(/ai_verification/);
      expect(r.blockers.join(' ')).toMatch(/engagement/i);
      expect((await getEpisode(db, r.episodeId)).stateReason).toBeTruthy();
    } finally {
      await close();
    }
  });

  it('refuses a live call when no spending cap is set, before contacting the API', async () => {
    const { db, close, fx } = await setup();
    let called = false;
    const live = new AnthropicReasoningClient({ apiKey: 'sk-ant-test-not-real', fetch: (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch, maxRetries: 0 });
    try {
      await expect(draftAndVerifyEpisode({ db, reasoning: live, now: () => NOW, log: () => {} }, { topicId: fx.packet.topic.id, format: 'update', code: 'LU-TECH-002' })).rejects.toMatchObject({ kind: 'budget' });
      expect(called).toBe(false);
      await setSpending(db, { capMicroUsd: 100, actor: { kind: 'owner', ownerId: 'owner' } }); // $0.0001 cap: still refused
      await expect(draftAndVerifyEpisode({ db, reasoning: live, now: () => NOW, log: () => {} }, { topicId: fx.packet.topic.id, format: 'update', code: 'LU-TECH-003' })).rejects.toMatchObject({ kind: 'budget' });
      expect(called).toBe(false);
    } finally {
      await close();
    }
  });
});
