import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimLedgerSha256, fixturePacket, FIXTURE_EPISODE_CODE } from '@life/content';
import { buildApprovalPayload, signApproval, type Actor } from '@life/contracts';
import {
  createEpisode,
  createEpisodeVersion,
  createPublishJob,
  createReleasePackage,
  ensureOwner,
  eq,
  getEpisode,
  getPublishJob,
  openPgliteDb,
  recordApproval,
  revokeApproval,
  saveEvidencePacket,
  setPublishingPaused,
  tables as t,
  transitionEpisode,
  transitionPublishJob,
  type Db,
} from '@life/db';
import { MockInsightsReader, MockInstagramPublisher, type MockPublisherScript } from '@life/instagram';
import { sha256File } from '@life/media';
import { approvedFixture } from './fixtures';
import { LocalStorage, collectInsights, coverBindable, evidenceCheckFor, runPublishJob, scheduleApproved, workerTick, type TickDeps } from '../src/index';

const OWNER = 'owner';
const ACCOUNT = 'mock-account';
const owner: Actor = { kind: 'owner', ownerId: OWNER };
const sys: Actor = { kind: 'system', component: 'test' };
const T0 = new Date('2026-10-23T09:00:00.000Z');

let db: Db;
let close: () => Promise<void>;
let root: string;
let clock: Date;
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

beforeEach(async () => {
  ({ db, close } = await openPgliteDb());
  root = await mkdtemp(join(tmpdir(), 'life-worker-test-'));
  clock = T0;
});
afterEach(async () => {
  await close();
  await rm(root, { recursive: true, force: true });
});

const approvedPackage = () => approvedFixture(db, root, T0);

function makeDeps(ctx: Awaited<ReturnType<typeof approvedPackage>>, script: MockPublisherScript = {}, workerId = 'w1'): TickDeps & { publisher: MockInstagramPublisher } {
  return {
    db,
    publisher: new MockInstagramPublisher({ script, clock: () => clock }),
    insights: new MockInsightsReader({ seed: 3 }),
    storage: ctx.storage,
    trustedKeys: ctx.trustedKeys,
    ownerId: OWNER,
    targetAccountId: ACCOUNT,
    evidenceCheck: evidenceCheckFor(db),
    now: () => clock,
    sleep: async (ms) => void advance(ms),
    pollIntervalMs: 1_000,
    workerId,
    log: () => {},
  };
}

async function onlyJob() {
  const rows = await db.select().from(t.publishJobs);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('publishing', () => {
  it('publishes an approved package once and records the remote media', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await workerTick(deps);
    const job = await onlyJob();
    expect(job).toMatchObject({ state: 'published', adapterMode: 'mock', remoteMediaId: 'mock_media_1' });
    expect(deps.publisher.publishCount()).toBe(1);
    expect((await getEpisode(db, ctx.episodeId)).state).toBe('published');
    const [media] = await db.select().from(t.instagramMedia);
    expect(media).toMatchObject({ source: 'mock', remoteMediaId: 'mock_media_1' });
  });

  it('fails on a container error and holds the episode with a reason', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { containerOutcome: 'ERROR' });
    await workerTick(deps);
    const job = await onlyJob();
    expect(job.state).toBe('failed');
    expect(job.stateReason).toMatch(/container_error/);
    expect(deps.publisher.publishCount()).toBe(0);
    expect(await getEpisode(db, ctx.episodeId)).toMatchObject({ state: 'failed', heldFrom: 'publishing' });
  });

  it('retries an expired container with a fresh one', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { containerOutcome: 'EXPIRED' });
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('retry_wait');
    (deps.publisher as unknown as { script: MockPublisherScript }).script.containerOutcome = 'FINISHED';
    advance(60 * 60_000);
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('published');
    expect(deps.publisher.publishCount()).toBe(1);
  });

  it('honours rate-limit Retry-After before trying again', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { createErrors: ['rate_limited'] });
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('retry_wait');
    const [queued] = await db.select().from(t.jobs).where(eq(t.jobs.kind, 'publish'));
    expect(Date.parse(queued!.runAt) - clock.getTime()).toBeGreaterThanOrEqual(59_000);
    advance(30_000);
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('retry_wait');
    advance(31_000);
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('published');
  });

  it('fails without publishing when the token has expired', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { publishBehavior: ['token_expired'] });
    await workerTick(deps);
    const job = await onlyJob();
    expect(job.state).toBe('failed');
    expect(job.stateReason).toMatch(/token_expired/);
    expect(deps.publisher.publishCount()).toBe(0);
  });

  it('reconciles a timeout that actually succeeded instead of publishing twice', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { publishBehavior: ['timeout_after_success', 'ok'] });
    await workerTick(deps);
    const job = await onlyJob();
    expect(job.state).toBe('published');
    expect(deps.publisher.publishCount()).toBe(1);
    const transitions = await db.select().from(t.auditEvents).where(eq(t.auditEvents.entityId, job.id));
    expect(transitions.map((a) => (a.details as { to?: string }).to)).toContain('needs_reconciliation');
  });

  it('retries a timeout that did not reach the remote after reconciliation proves it', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx, { publishBehavior: ['timeout_before_success', 'ok'] });
    await workerTick(deps);
    // One "not found" read is not enough: the media list can lag a publish.
    expect(await onlyJob()).toMatchObject({ state: 'needs_reconciliation', stateReason: expect.stringMatching(/not found at/) });
    advance(4 * 60_000);
    await workerTick(deps);
    expect((await onlyJob()).stateReason).toMatch(/not published remotely \(two reads\)/);
    advance(60 * 60_000);
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('published');
    expect(deps.publisher.publishCount()).toBe(1);
  });

  it('fails a job created for live when the running publisher is a mock (never labels a mock post live)', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'live', clock);
    const job = await onlyJob();
    const outcome = await runPublishJob(deps, job.id);
    expect(outcome).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/adapter_mode_mismatch/) });
    expect(deps.publisher.publishCount()).toBe(0);
    expect(await db.select().from(t.instagramMedia)).toHaveLength(0);
  });

  it('never retries once Instagram returned a media ID, even if the caption does not match', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'mock', clock);
    const job = await onlyJob();
    const { containerId } = await deps.publisher.createReelContainer({ accountId: ACCOUNT, videoUrl: 'x', coverUrl: null, caption: 'edited elsewhere', shareToFeed: true });
    await deps.publisher.getContainerStatus(containerId);
    await deps.publisher.getContainerStatus(containerId);
    const { remoteMediaId } = await deps.publisher.publishContainer(ACCOUNT, containerId);
    let state = job.state as Parameters<typeof transitionPublishJob>[1]['from'];
    for (const to of ['gate_check', 'creating_container', 'processing', 'publishing', 'confirming'] as const) {
      const patch = to === 'processing' ? { containerId, containerCreatedAt: clock.toISOString() } : to === 'confirming' ? { remoteMediaId } : undefined;
      await transitionPublishJob(db, { id: job.id, from: state, to, actor: sys, now: clock, patch });
      state = to;
    }
    const outcome = await runPublishJob(deps, job.id);
    expect(outcome).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/not retried/) });
    expect(deps.publisher.publishCount()).toBe(1);
  });

  it('lets a live post use its approved cover only when it is the first frame or publicly hosted', () => {
    expect(coverBindable('live', { coverSource: 'first_frame' }, false)).toBe(true);
    expect(coverBindable('live', { coverSource: 'separate_image' }, false)).toBe(false);
    expect(coverBindable('live', {}, false)).toBe(false);
    expect(coverBindable('live', {}, true)).toBe(true);
    expect(coverBindable('mock', {}, false)).toBe(true);
  });

  it('refuses to upload when the delivery file changed after the gate check', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'mock', clock);
    const job = await onlyJob();
    await transitionPublishJob(db, { id: job.id, from: 'queued', to: 'gate_check', actor: sys, now: clock });
    await transitionPublishJob(db, { id: job.id, from: 'gate_check', to: 'creating_container', actor: sys, now: clock });
    await writeFile(ctx.storage.resolve(ctx.pkg.deliveryMedia.uri), 'swapped bytes');
    const outcome = await runPublishJob(deps, job.id);
    expect(outcome).toMatchObject({ kind: 'failed', reason: expect.stringMatching(/changed after the gate check/) });
    expect(deps.publisher.publishCount()).toBe(0);
  });

  it('recovers after a crash mid-publish without a second publish', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'mock', clock);
    const job = await onlyJob();
    // Simulate a worker that created the container, published, then died before recording it.
    const { containerId } = await deps.publisher.createReelContainer({ accountId: ACCOUNT, videoUrl: 'x', coverUrl: null, caption: ctx.pkg.caption, shareToFeed: true });
    await deps.publisher.getContainerStatus(containerId);
    await deps.publisher.getContainerStatus(containerId);
    await deps.publisher.publishContainer(ACCOUNT, containerId);
    let state = job.state as Parameters<typeof transitionPublishJob>[1]['from'];
    for (const to of ['gate_check', 'creating_container', 'processing', 'publishing'] as const) {
      await transitionPublishJob(db, { id: job.id, from: state, to, actor: sys, now: clock, patch: to === 'processing' ? { containerId, containerCreatedAt: clock.toISOString() } : undefined });
      state = to;
    }
    const outcome = await runPublishJob(deps, job.id);
    expect(outcome.kind).toBe('published');
    expect(deps.publisher.publishCount()).toBe(1);
  });

  it('two racing workers publish exactly once', async () => {
    const ctx = await approvedPackage();
    const publisher = new MockInstagramPublisher({ clock: () => clock });
    const a = { ...makeDeps(ctx, {}, 'worker-a'), publisher };
    const b = { ...makeDeps(ctx, {}, 'worker-b'), publisher };
    await scheduleApproved(db, 'mock', clock);
    await Promise.all([workerTick(a), workerTick(b)]);
    expect((await onlyJob()).state).toBe('published');
    expect(publisher.publishCount()).toBe(1);
  });

  it('refuses a duplicate publish job for the same package', async () => {
    const ctx = await approvedPackage();
    await scheduleApproved(db, 'mock', clock);
    expect(await scheduleApproved(db, 'mock', clock)).toEqual([]);
    await expect(createPublishJob(db, { approvalId: ctx.approvalId, adapterMode: 'mock', scheduledFor: clock, actor: sys })).rejects.toThrow();
    expect(await db.select().from(t.publishJobs)).toHaveLength(1);
  });

  it('a revocation before dispatch cancels the job and nothing is published', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'mock', clock);
    await revokeApproval(db, { approvalId: ctx.approvalId, reason: 'owner changed mind', actor: owner, now: clock });
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('cancelled');
    expect(deps.publisher.publishCount()).toBe(0);
    expect((await getEpisode(db, ctx.episodeId)).state).toBe('awaiting_user_approval');
  });

  it('the global pause holds publication until the owner resumes', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await setPublishingPaused(db, { paused: true, reason: 'correction review', actor: sys, now: clock });
    await workerTick(deps);
    expect((await onlyJob()).stateReason).toMatch(/publishing_paused/);
    expect(deps.publisher.publishCount()).toBe(0);
    await setPublishingPaused(db, { paused: false, reason: null, actor: owner, now: clock });
    advance(60 * 60_000);
    await workerTick(deps);
    expect((await onlyJob()).state).toBe('published');
  });

  it('blocks when the delivery file on disk no longer matches the approval', async () => {
    const ctx = await approvedPackage();
    await writeFile(ctx.storage.resolve(ctx.pkg.deliveryMedia.uri), 'swapped after approval');
    const deps = makeDeps(ctx);
    await workerTick(deps);
    const job = await onlyJob();
    expect(job.state).toBe('failed');
    expect(job.stateReason).toMatch(/delivery_media_mismatch/);
    expect(deps.publisher.publishCount()).toBe(0);
  });

  it('blocks when a time-sensitive claim has gone stale by publish time', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await scheduleApproved(db, 'mock', clock);
    advance(40 * 3_600_000); // still inside the 48h window, but past the 24h freshness rule
    await workerTick(deps);
    const job = await onlyJob();
    expect(job.state).toBe('failed');
    expect(job.stateReason).toMatch(/evidence_blocked/);
    expect(deps.publisher.publishCount()).toBe(0);
  });

  it('never stores mock insights against live media', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await workerTick(deps);
    const [media] = await db.select().from(t.instagramMedia);
    await db.update(t.instagramMedia).set({ source: 'live' }).where(eq(t.instagramMedia.id, media!.id));
    await expect(collectInsights(deps, media!.id)).rejects.toThrow(/refusing to mix/);
  });

  it('stores insights with nulls and reasons, never zero for missing', async () => {
    const ctx = await approvedPackage();
    const deps = makeDeps(ctx);
    await workerTick(deps);
    const [media] = await db.select().from(t.instagramMedia);
    advance(10 * 60_000);
    await collectInsights(deps, media!.id);
    const snaps = await db.select().from(t.metricSnapshots);
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) expect(s).toMatchObject({ value: null, unavailabilityReason: 'not_yet_available', source: 'mock' });
    expect(await getPublishJob(db, (await onlyJob()).id)).toMatchObject({ state: 'published' });
  });
});
