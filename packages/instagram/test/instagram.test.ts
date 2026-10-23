import { describe, expect, it } from 'vitest';
import { MetricSnapshot, PublisherError, type CreateReelContainerInput } from '@life/contracts';
import {
  MOCK_API_VERSION,
  MockInsightsReader,
  MockInstagramPublisher,
  reconcileAmbiguousPublish,
  waitForContainer,
  type MockPublisherScript,
} from '../src/index';

const ACCOUNT = 'acct_1';
const input = (caption: string): CreateReelContainerInput => ({
  accountId: ACCOUNT,
  videoUrl: 'https://example.invalid/v.mp4',
  coverUrl: null,
  caption,
  shareToFeed: true,
});
const fastWait = { pollIntervalMs: 10, deadlineMs: 1000, sleep: async () => {} };

async function catchErr(p: Promise<unknown>): Promise<PublisherError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PublisherError);
    return e as PublisherError;
  }
  throw new Error('expected rejection');
}

function pub(script?: MockPublisherScript) {
  let t = Date.parse('2026-01-01T00:00:00Z');
  return new MockInstagramPublisher({ script, clock: () => new Date((t += 60_000)) });
}

describe('MockInstagramPublisher', () => {
  it('publishes happy path with deterministic ids and mock permalinks', async () => {
    const p = pub();
    expect(p.mode).toBe('mock');
    expect(p.supportsPlatformAiLabel).toBe(false);
    const { containerId } = await p.createReelContainer(input('Hello LU-TECH-001'));
    expect(containerId).toBe('mock_container_1');
    expect((await p.getContainerStatus(containerId)).status).toBe('IN_PROGRESS');
    await waitForContainer(p, containerId, fastWait);
    const { remoteMediaId } = await p.publishContainer(ACCOUNT, containerId);
    expect(remoteMediaId).toBe('mock_media_1');
    const m = await p.getMedia(remoteMediaId);
    expect(m.permalink).toBe('https://mock-instagram.invalid/reel/mock_media_1');
    expect(p.publishCount()).toBe(1);
    expect((await p.getContainerStatus(containerId)).status).toBe('PUBLISHED');
  });

  it('rejects publishing unfinished or already published containers', async () => {
    const p = pub();
    const { containerId } = await p.createReelContainer(input('x'));
    expect((await catchErr(p.publishContainer(ACCOUNT, containerId))).code).toBe('container_error');
    await waitForContainer(p, containerId, fastWait);
    await p.publishContainer(ACCOUNT, containerId);
    expect((await catchErr(p.publishContainer(ACCOUNT, containerId))).code).toBe('container_error');
    expect(p.publishCount()).toBe(1);
  });

  it('surfaces container ERROR and EXPIRED through waitForContainer', async () => {
    for (const [outcome, code] of [
      ['ERROR', 'container_error'],
      ['EXPIRED', 'container_expired'],
    ] as const) {
      const p = pub({ containerOutcome: outcome });
      const { containerId } = await p.createReelContainer(input('x'));
      expect((await catchErr(waitForContainer(p, containerId, fastWait))).code).toBe(code);
      expect((await catchErr(p.publishContainer(ACCOUNT, containerId))).code).toBe('container_error');
    }
  });

  it('rate limit carries retryAfterSec and is retryable; then succeeds', async () => {
    const p = pub({ createErrors: ['rate_limited'] });
    const e = await catchErr(p.createReelContainer(input('x')));
    expect(e.code).toBe('rate_limited');
    expect(e.retryAfterSec).toBeGreaterThan(0);
    expect(e.retryable).toBe(true);
    await expect(p.createReelContainer(input('x'))).resolves.toEqual({ containerId: 'mock_container_1' });
  });

  it('expired token is not retryable', async () => {
    const p = pub({ createErrors: ['token_expired'] });
    const e = await catchErr(p.createReelContainer(input('x')));
    expect(e.code).toBe('token_expired');
    expect(e.retryable).toBe(false);
  });

  it('publishBehavior sequence: last entry repeats', async () => {
    const p = pub({ publishBehavior: ['rate_limited', 'transient', 'ok'], processingPolls: 0 });
    const { containerId } = await p.createReelContainer(input('x'));
    const e1 = await catchErr(p.publishContainer(ACCOUNT, containerId));
    expect(e1.code).toBe('rate_limited');
    expect(e1.retryAfterSec).toBe(60);
    expect((await catchErr(p.publishContainer(ACCOUNT, containerId))).code).toBe('transient');
    await p.publishContainer(ACCOUNT, containerId);
    expect(p.publishCount()).toBe(1);
  });

  it('token_expired on publish', async () => {
    const p = pub({ publishBehavior: ['token_expired'], processingPolls: 0 });
    const { containerId } = await p.createReelContainer(input('x'));
    expect((await catchErr(p.publishContainer(ACCOUNT, containerId))).code).toBe('token_expired');
    expect(p.publishCount()).toBe(0);
  });

  it('listRecentMedia respects since/limit and is newest first', async () => {
    const p = pub({ processingPolls: 0 });
    for (const c of ['a', 'b', 'c']) {
      const { containerId } = await p.createReelContainer(input(c));
      await p.publishContainer(ACCOUNT, containerId);
    }
    const all = await p.listRecentMedia(ACCOUNT, { since: new Date(0), limit: 10 });
    expect(all.map((m) => m.caption)).toEqual(['c', 'b', 'a']);
    expect((await p.listRecentMedia(ACCOUNT, { since: new Date(0), limit: 2 })).length).toBe(2);
    const second = Date.parse(all[1]!.timestamp);
    const recent = await p.listRecentMedia(ACCOUNT, { since: new Date(second), limit: 10 });
    expect(recent.map((m) => m.caption)).toEqual(['c', 'b']);
    expect(await p.listRecentMedia('other', { since: new Date(0), limit: 10 })).toEqual([]);
  });

  it('reports quota', async () => {
    expect(await pub({ quota: { used: 24, limit: 25 } }).getPublishingQuota(ACCOUNT)).toMatchObject({
      used: 24,
      limit: 25,
    });
  });
});

describe('waitForContainer', () => {
  it('throws transient on deadline with fake clock', async () => {
    const p = pub({ processingPolls: 1000 });
    const { containerId } = await p.createReelContainer(input('x'));
    let t = 0;
    const sleeps: number[] = [];
    const e = await catchErr(
      waitForContainer(p, containerId, {
        pollIntervalMs: 100,
        deadlineMs: 450,
        sleep: async (ms) => {
          sleeps.push(ms);
          t += ms;
        },
        now: () => t,
      }),
    );
    expect(e.code).toBe('transient');
    expect(e.message).toMatch(/deadline/);
    expect(sleeps.length).toBe(5);
  });
});

describe('timeout reconciliation', () => {
  const since = new Date('2025-12-31T00:00:00Z');
  async function run(script: MockPublisherScript, caption = 'Great reel LU-TECH-001 #x') {
    const p = pub({ processingPolls: 0, ...script });
    const { containerId } = await p.createReelContainer(input(caption));
    const e = await catchErr(p.publishContainer(ACCOUNT, containerId));
    expect(e.code).toBe('timeout_ambiguous');
    return p;
  }

  it('timeout after success: reconciliation finds exactly one media', async () => {
    const p = await run({ publishBehavior: ['timeout_after_success'] });
    expect(p.publishCount()).toBe(1);
    const r = await reconcileAmbiguousPublish({ publisher: p, accountId: ACCOUNT, episodeCode: 'LU-TECH-001', since });
    expect(r.outcome).toBe('found');
    if (r.outcome === 'found') expect(r.media.remoteMediaId).toBe('mock_media_1');
  });

  it('timeout before success: not_found', async () => {
    const p = await run({ publishBehavior: ['timeout_before_success'] });
    expect(p.publishCount()).toBe(0);
    expect(
      await reconcileAmbiguousPublish({ publisher: p, accountId: ACCOUNT, episodeCode: 'LU-TECH-001', since }),
    ).toEqual({ outcome: 'not_found' });
  });

  it('duplicate code: multiple', async () => {
    const p = pub({ processingPolls: 0 });
    for (let k = 0; k < 2; k++) {
      const { containerId } = await p.createReelContainer(input('LU-TECH-001 take'));
      await p.publishContainer(ACCOUNT, containerId);
    }
    const r = await reconcileAmbiguousPublish({ publisher: p, accountId: ACCOUNT, episodeCode: 'LU-TECH-001', since });
    expect(r.outcome).toBe('multiple');
    if (r.outcome === 'multiple') expect(r.candidates).toHaveLength(2);
  });

  it('matches whole tokens only', async () => {
    const p = pub({ processingPolls: 0 });
    for (const c of ['LU-TECH-0012 other', 'XLU-TECH-001', 'no code here']) {
      const { containerId } = await p.createReelContainer(input(c));
      await p.publishContainer(ACCOUNT, containerId);
    }
    expect(
      (await reconcileAmbiguousPublish({ publisher: p, accountId: ACCOUNT, episodeCode: 'LU-TECH-001', since })).outcome,
    ).toBe('not_found');
  });

  it('ignores media older than since', async () => {
    const p = await run({ publishBehavior: ['timeout_after_success'] });
    const r = await reconcileAmbiguousPublish({
      publisher: p,
      accountId: ACCOUNT,
      episodeCode: 'LU-TECH-001',
      since: new Date('2030-01-01T00:00:00Z'),
    });
    expect(r.outcome).toBe('not_found');
  });
});

describe('MockInsightsReader', () => {
  const publishedAt = new Date('2026-03-01T00:00:00Z');
  const at = (sec: number) => new Date(publishedAt.getTime() + sec * 1000);
  const read = (ageSec: number, metrics: string[], seed = 7) =>
    new MockInsightsReader({ seed }).readMediaInsights({
      accountId: ACCOUNT,
      instagramMediaId: 'im_1',
      remoteMediaId: 'mock_media_1',
      publishedAt,
      metrics,
      now: at(ageSec),
    });

  it('under one hour: every metric null not_yet_available', async () => {
    const r = await read(1800, ['reach', 'views', 'saves']);
    expect(r.snapshots).toHaveLength(3);
    for (const s of r.snapshots) {
      expect(s.value).toBeNull();
      expect(s.unavailabilityReason).toBe('not_yet_available');
      expect(s.source).toBe('mock');
      expect(s.apiVersion).toBe(MOCK_API_VERSION);
    }
  });

  it('missing is null, never a stand-in zero; avg_watch_time_ms null before 24h', async () => {
    const r = await read(2 * 3600, ['reach', 'avg_watch_time_ms']);
    const reach = r.snapshots[0]!;
    const watch = r.snapshots[1]!;
    expect(reach.value).toBeGreaterThan(0);
    expect(reach.unavailabilityReason).toBeNull();
    expect(watch.value).toBeNull();
    expect(watch.unavailabilityReason).toBe('not_yet_available');
    expect((await read(25 * 3600, ['avg_watch_time_ms'])).snapshots[0]!.value).toBeGreaterThan(0);
  });

  it('unknown metric: null not_supported_by_api_version', async () => {
    const s = (await read(3 * 24 * 3600, ['follower_attribution'])).snapshots[0]!;
    expect(s.value).toBeNull();
    expect(s.unavailabilityReason).toBe('not_supported_by_api_version');
  });

  it('chooses window from age', async () => {
    const w = async (h: number) => (await read(h * 3600, ['reach'])).snapshots[0]!.window;
    expect(await w(2)).toBe('1h');
    expect(await w(30)).toBe('24h');
    expect(await w(80)).toBe('72h');
    expect(await w(24 * 8)).toBe('7d');
  });

  it('is deterministic, seed-dependent, and passes the contract schema', async () => {
    const a = await read(8 * 24 * 3600, ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'avg_watch_time_ms']);
    const b = await read(8 * 24 * 3600, ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'avg_watch_time_ms']);
    expect(a.snapshots).toEqual(b.snapshots);
    const c = await read(8 * 24 * 3600, ['reach'], 99);
    expect(c.snapshots[0]!.value).not.toBe(a.snapshots[0]!.value);
    for (const s of a.snapshots) {
      expect(s.definition.length).toBeGreaterThan(0);
      expect(() => MetricSnapshot.parse({ ...s, id: 'x', rawResponseId: null })).not.toThrow();
    }
    expect(a.raw).toMatchObject({ mock: true, source: 'mock' });
  });
});
