import { generateKeyPairSync } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEpisodeVersion,
  createPublishJob,
  getEpisode,
  getSettings,
  recordApproval,
  revokeApproval,
  setPublishingPaused,
  setSpending,
  tables as t,
  transitionEpisode,
  type Db,
} from '../src/index';
import { agent, episodeAwaitingApproval, freshDb, owner, signFor, studioKeys, system, versionContent } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

/** Drizzle wraps driver errors; the database's message is on the cause chain. */
async function rejectsWith(p: Promise<unknown>, pattern: RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'expected the database to reject').not.toBeNull();
  const messages: string[] = [];
  for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) messages.push(String(e.message));
  expect(messages.join(' | ')).toMatch(pattern);
}

describe('immutability triggers', () => {
  it('episode versions cannot be updated, deleted or truncated', async () => {
    const { version } = await episodeAwaitingApproval(db);
    await rejectsWith(db.update(t.episodeVersions).set({ contentSha256: 'x' }).where(eq(t.episodeVersions.id, version.id)), /immutable/);
    await rejectsWith(db.delete(t.episodeVersions).where(eq(t.episodeVersions.id, version.id)), /immutable/);
    await rejectsWith(db.execute(sql`truncate episode_versions cascade`), /immutable/);
  });

  it('release packages cannot be edited in place', async () => {
    const { pkg } = await episodeAwaitingApproval(db);
    await rejectsWith(db.update(t.releasePackages).set({ content: { ...pkg, caption: 'edited' } }).where(eq(t.releasePackages.id, pkg.id)), /immutable/);
  });

  it('audit events are append-only', async () => {
    await episodeAwaitingApproval(db);
    await rejectsWith(db.update(t.auditEvents).set({ action: 'x' }), /immutable/);
    await rejectsWith(db.delete(t.auditEvents), /immutable/);
  });
});

describe('approval rows', () => {
  it('can only change by a single revocation', async () => {
    const keys = studioKeys();
    const { pkg } = await episodeAwaitingApproval(db);
    const id = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });

    await rejectsWith(db.update(t.approvals).set({ expiresAt: '2030-01-01T00:00:00Z' }).where(eq(t.approvals.id, id)), /only be changed by revocation/);
    await rejectsWith(
      db.update(t.approvals).set({ expiresAt: '2030-01-01T00:00:00Z', revokedAt: '2026-10-22T11:00:00Z', revokedReason: 'x' }).where(eq(t.approvals.id, id)),
      /may not alter/,
    );
    await rejectsWith(db.delete(t.approvals).where(eq(t.approvals.id, id)), /immutable/);

    await revokeApproval(db, { approvalId: id, reason: 'owner changed mind', actor: owner });
    await rejectsWith(db.update(t.approvals).set({ revokedAt: null, revokedReason: null }).where(eq(t.approvals.id, id)), /already revoked/);
    expect((await getEpisode(db, pkg.episodeId)).state).toBe('awaiting_user_approval');
  });

  it('rejects a non-owner approver kind at the database', async () => {
    const keys = studioKeys();
    const { pkg } = await episodeAwaitingApproval(db);
    await rejectsWith(
      db.insert(t.approvals).values({
        id: 'a-agent', releasePackageId: pkg.id, approverKind: 'agent', approverId: 'owner-1',
        signedApproval: signFor(pkg, keys.privateKey), keyId: 'studio-test', expiresAt: '2026-10-31T00:00:00Z',
      }),
      /approvals_owner_only/,
    );
    await rejectsWith(
      db.insert(t.approvals).values({
        id: 'a-stranger', releasePackageId: pkg.id, approverKind: 'owner', approverId: 'not-the-owner',
        signedApproval: signFor(pkg, keys.privateKey), keyId: 'studio-test', expiresAt: '2026-10-31T00:00:00Z',
      }),
      /foreign key/,
    );
  });

  it('refuses to store an approval signed by an untrusted key', async () => {
    const keys = studioKeys();
    const agentKey = generateKeyPairSync('ed25519').privateKey;
    const { pkg } = await episodeAwaitingApproval(db);
    await expect(recordApproval(db, { signed: signFor(pkg, agentKey), trustedKeys: keys.trusted })).rejects.toThrow(/signature_invalid/);
    expect((await getEpisode(db, pkg.episodeId)).state).toBe('awaiting_user_approval');
  });

  it('a material edit creates a new version, revokes approvals and returns to scripted', async () => {
    const keys = studioKeys();
    const { pkg, episodeId } = await episodeAwaitingApproval(db);
    const id = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });
    const job = await createPublishJob(db, { approvalId: id, adapterMode: 'mock', scheduledFor: new Date(), actor: system });
    expect((await getEpisode(db, episodeId)).state).toBe('scheduled');

    const v2 = await createEpisodeVersion(db, { episodeId, content: versionContent('Edited caption LU-TECH-001'), actor: agent });
    expect(v2.versionNumber).toBe(2);
    const ep = await getEpisode(db, episodeId);
    expect(ep.state).toBe('scripted');
    expect(ep.currentVersionId).toBe(v2.id);
    const [appr] = await db.select().from(t.approvals).where(eq(t.approvals.id, id));
    expect(appr!.revokedReason).toMatch(/superseded by version 2/);
    const [pj] = await db.select().from(t.publishJobs).where(eq(t.publishJobs.id, job.id));
    expect(pj!.state).toBe('cancelled');
  });
});

describe('workflow and publish constraints', () => {
  it('hold states need a reason at the application and database layers', async () => {
    const { episodeId } = await episodeAwaitingApproval(db);
    await expect(transitionEpisode(db, { episodeId, to: 'blocked', actor: agent })).rejects.toThrow(/requires a reason/);
    await rejectsWith(db.update(t.episodes).set({ state: 'blocked', heldFrom: 'scripted' }).where(eq(t.episodes.id, episodeId)), /episodes_hold_reason/);
    await transitionEpisode(db, { episodeId, to: 'blocked', actor: agent, reason: 'source unavailable' });
    expect((await getEpisode(db, episodeId)).heldFrom).toBe('awaiting_user_approval');
  });

  it('an agent cannot move an episode to approved', async () => {
    const { episodeId } = await episodeAwaitingApproval(db);
    await expect(transitionEpisode(db, { episodeId, to: 'approved', actor: agent })).rejects.toThrow(/requires the owner/);
  });

  it('allows only one live publish job per package', async () => {
    const keys = studioKeys();
    const { pkg } = await episodeAwaitingApproval(db);
    const id = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });
    await createPublishJob(db, { approvalId: id, adapterMode: 'mock', scheduledFor: new Date(), actor: system });
    await rejectsWith(createPublishJob(db, { approvalId: id, adapterMode: 'mock', scheduledFor: new Date(), actor: system }), /publish_jobs_one_live/);
  });

  it('metric snapshots keep null and its reason together', async () => {
    const base = { id: 'm1', scope: 'account', accountId: 'ig-1', metric: 'reach', definition: 'd', unit: 'count', window: '24h', apiVersion: 'mock', retrievedAt: '2026-10-22T00:00:00Z', source: 'mock' };
    await rejectsWith(db.insert(t.metricSnapshots).values({ ...base, value: null, unavailabilityReason: null }), /metric_null_xor_reason/);
    await rejectsWith(db.insert(t.metricSnapshots).values({ ...base, id: 'm2', value: 0, unavailabilityReason: 'api_error' }), /metric_null_xor_reason/);
    await db.insert(t.metricSnapshots).values({ ...base, id: 'm3', value: null, unavailabilityReason: 'not_yet_available' });
    await db.insert(t.metricSnapshots).values({ ...base, id: 'm4', value: 0, unavailabilityReason: null });
  });
});

describe('settings', () => {
  it('anyone may pause; only the owner may resume or loosen spending', async () => {
    await setPublishingPaused(db, { paused: true, reason: 'correction pending', actor: system });
    expect((await getSettings(db)).publishingPaused).toBe(true);
    await expect(setPublishingPaused(db, { paused: false, reason: null, actor: agent })).rejects.toThrow(/only the owner/);
    await setPublishingPaused(db, { paused: false, reason: null, actor: owner });
    expect((await getSettings(db)).publishingPaused).toBe(false);

    await setSpending(db, { stopped: true, actor: agent });
    await expect(setSpending(db, { stopped: false, actor: agent })).rejects.toThrow(/only the owner/);
    await expect(setSpending(db, { capMicroUsd: 1_000_000, actor: agent })).rejects.toThrow(/only the owner/);
    await setSpending(db, { stopped: false, capMicroUsd: 5_000_000, actor: owner });
    expect(await getSettings(db)).toMatchObject({ spendingStopped: false, spendingCapMicroUsd: 5_000_000 });
  });
});
