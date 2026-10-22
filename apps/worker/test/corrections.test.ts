import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planCorrection } from '@life/content';
import type { Actor } from '@life/contracts';
import {
  flagCorrection,
  getEpisode,
  getSettings,
  openPgliteDb,
  previewCorrection,
  resolveCorrection,
  tables as t,
  transitionEpisode,
  type Db,
} from '@life/db';
import { MockInsightsReader, MockInstagramPublisher } from '@life/instagram';
import { evidenceCheckFor, scheduleApproved, workerTick } from '../src/index';
import { ACCOUNT, OWNER, approvedFixture } from './fixtures';

const owner: Actor = { kind: 'owner', ownerId: OWNER };
const T0 = new Date('2026-10-23T09:00:00.000Z');
const CLAIM = 'fixture-claim-permission-gate';
const planner = planCorrection as never;

let db: Db;
let close: () => Promise<void>;
let root: string;
beforeEach(async () => {
  ({ db, close } = await openPgliteDb());
  root = await mkdtemp(join(tmpdir(), 'life-corr-'));
});
afterEach(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
});

describe('corrections', () => {
  it('suspends a scheduled episode: cancels the job, revokes the approval, holds the episode', async () => {
    const ctx = await approvedFixture(db, root, T0);
    await scheduleApproved(db, 'mock', T0);
    const preview = await previewCorrection(db, { kind: 'claim', claimId: CLAIM }, planner, T0);
    const { plan } = await flagCorrection(db, { trigger: { kind: 'claim', claimId: CLAIM }, planner, expectedPlanSha256: (preview as { planSha256: string }).planSha256, actor: owner, now: T0 });

    expect((plan as unknown as { episodes: { action: string }[] }).episodes[0]!.action).toBe('suspend');
    const [job] = await db.select().from(t.publishJobs);
    expect(job!.state).toBe('cancelled');
    const [appr] = await db.select().from(t.approvals);
    expect(appr!.revokedReason).toMatch(/^correction:/);
    expect((await getEpisode(db, ctx.episodeId)).state).toBe('blocked');

    // It cannot slip back into the publish path without a new approval.
    await expect(transitionEpisode(db, { episodeId: ctx.episodeId, to: 'scheduled', actor: owner, now: T0 })).rejects.toThrow(/no live approval/);
    await transitionEpisode(db, { episodeId: ctx.episodeId, to: 'scripted', actor: owner, now: T0 });

    await resolveCorrection(db, { correctionId: (await db.select().from(t.corrections))[0]!.id, status: 'resolved', resolution: 'claim reworded, new version to follow', actor: owner, now: T0 });
    await expect(resolveCorrection(db, { correctionId: (await db.select().from(t.corrections))[0]!.id, status: 'resolved', resolution: 'again', actor: owner })).rejects.toThrow(/not open/);
  });

  it('refuses to execute a plan that changed since the owner previewed it', async () => {
    await approvedFixture(db, root, T0);
    const preview = (await previewCorrection(db, { kind: 'claim', claimId: CLAIM }, planner, T0)) as { planSha256: string };
    await scheduleApproved(db, 'mock', T0); // a job appears after the preview
    await expect(flagCorrection(db, { trigger: { kind: 'claim', claimId: CLAIM }, planner, expectedPlanSha256: preview.planSha256, actor: owner, now: T0 })).rejects.toThrow(/review the new plan/);
    expect(await db.select().from(t.corrections)).toHaveLength(0);
  });

  it('never edits a published post; it proposes a correction for the owner', async () => {
    const ctx = await approvedFixture(db, root, T0);
    let clock = T0;
    await workerTick({
      db, publisher: new MockInstagramPublisher({ clock: () => clock }), insights: new MockInsightsReader(), storage: ctx.storage,
      trustedKeys: ctx.trustedKeys, ownerId: OWNER, targetAccountId: ACCOUNT, evidenceCheck: evidenceCheckFor(db),
      now: () => clock, sleep: async (ms) => void (clock = new Date(clock.getTime() + ms)), pollIntervalMs: 1000, workerId: 'w', log: () => {},
    });
    expect((await getEpisode(db, ctx.episodeId)).state).toBe('published');
    const { plan } = await flagCorrection(db, { trigger: { kind: 'claim', claimId: CLAIM }, planner, actor: owner, now: clock });
    const ep = (plan as unknown as { episodes: { action: string; correctionDraft: unknown; media: { label: string }[] }[] }).episodes[0]!;
    expect(ep.action).toBe('propose_live_correction');
    expect(ep.correctionDraft).toBeTruthy();
    expect(ep.media[0]!.label).toBe('MOCK');
    expect((await getEpisode(db, ctx.episodeId)).state).toBe('published');
    expect((await db.select().from(t.publishJobs))[0]!.state).toBe('published');
  });

  it('pauses publishing when the plan recommends it, and only the owner can resume', async () => {
    const ctx = await approvedFixture(db, root, T0);
    await db.update(t.claims).set({ riskTier: 'high' });
    await scheduleApproved(db, 'mock', T0);
    await flagCorrection(db, { trigger: { kind: 'claim', claimId: CLAIM }, planner, actor: owner, now: T0 });
    const s = await getSettings(db);
    expect(s.publishingPaused).toBe(true);
    expect(s.pausedReason).toMatch(/high_risk_claim_affected/);
    expect(ctx.episodeId).toBeTruthy();
  });
});
