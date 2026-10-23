import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MetricSnapshot, PublisherError, type CreateReelContainerInput } from '@life/contracts';
import {
  GRAPH_ASSUMPTIONS,
  LiveInsightsReader,
  LiveInstagramPublisher,
  reconcileAmbiguousPublish,
  refreshLongLivedToken,
  tokenRefreshPlan,
  waitForContainer,
} from '../src/index';

const TOKEN = 'IGAAtesttoken1234567890SECRET';
const IGID = '17841400000000000';
const tokens = { getAccessToken: async () => TOKEN };

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
}
type Reply0 = { status?: number; json?: unknown; headers?: Record<string, string> } | Error;
type Reply = Reply0 | ((c: Call) => Reply0 | Promise<Reply0>);

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    let body = '';
    const b = init?.body as unknown;
    if (typeof b === 'string') body = b;
    else if (b && typeof (b as ReadableStream).getReader === 'function') {
      const chunks: Buffer[] = [];
      for await (const c of b as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
      body = Buffer.concat(chunks).toString('utf8');
    }
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      body,
    };
    calls.push(call);
    const q = replies.shift();
    const r = typeof q === 'function' ? await q(call) : q;
    if (!r) throw new Error('fakeFetch: no reply queued');
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const err = (code: number, message = 'm', status = 400, headers?: Record<string, string>, sub?: number): Reply => ({
  status,
  json: { error: { message, type: 'OAuthException', code, ...(sub ? { error_subcode: sub } : {}) } },
  headers,
});

const pub = (replies: Reply[], extra: Partial<ConstructorParameters<typeof LiveInstagramPublisher>[0]> = {}) => {
  const ff = fakeFetch(replies);
  return { ...ff, p: new LiveInstagramPublisher({ igUserId: IGID, tokens, fetch: ff.f, ...extra }) };
};

const dir = mkdtempSync(join(tmpdir(), 'ig-live-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const video = join(dir, 'v.mp4');
writeFileSync(video, 'FAKEVIDEOBYTES');

const base: CreateReelContainerInput = {
  accountId: 'acct',
  videoUrl: 'https://cdn.example.com/v.mp4',
  coverUrl: 'https://cdn.example.com/c.jpg',
  caption: 'hello LU-001',
  shareToFeed: true,
};

describe('assumptions', () => {
  it('pins Instagram Login host and v26.0', () => {
    expect(GRAPH_ASSUMPTIONS.host).toBe('graph.instagram.com');
    expect(GRAPH_ASSUMPTIONS.apiVersion).toBe('v26.0');
    expect(GRAPH_ASSUMPTIONS.forbiddenHosts).toContain('graph.facebook.com');
  });
});

describe('LiveInstagramPublisher request shapes', () => {
  it('is live and does not claim an AI label', () => {
    const { p } = pub([]);
    expect(p.mode).toBe('live');
    expect(p.supportsPlatformAiLabel).toBe(false);
  });

  it('creates a video_url container with header auth, form body and no token in the URL', async () => {
    const { p, calls } = pub([{ json: { id: 'C1' } }]);
    expect(await p.createReelContainer(base)).toEqual({ containerId: 'C1' });
    const c = calls[0]!;
    expect(c.method).toBe('POST');
    expect(c.url.host).toBe('graph.instagram.com');
    expect(c.url.pathname).toBe(`/v26.0/${IGID}/media`);
    expect(c.url.search).toBe('');
    expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const f = new URLSearchParams(c.body);
    expect(f.get('media_type')).toBe('REELS');
    expect(f.get('video_url')).toBe(base.videoUrl);
    expect(f.get('cover_url')).toBe(base.coverUrl);
    expect(f.get('thumb_offset')).toBeNull();
    expect(f.get('share_to_feed')).toBe('true');
    expect(f.get('caption')).toBe('hello LU-001');
    expect(f.get('upload_type')).toBeNull();
    expect(JSON.stringify(c)).not.toContain('facebook.com');
  });

  it('honours a custom apiVersion', async () => {
    const { p, calls } = pub([{ json: { id: 'C1' } }], { apiVersion: 'v25.0' });
    await p.createReelContainer(base);
    expect(calls[0]!.url.pathname.startsWith('/v25.0/')).toBe(true);
  });

  it.each([
    ['null', null],
    ['mock host', 'https://mock-instagram.invalid/c.jpg'],
    ['.invalid', 'https://x.invalid/c.jpg'],
    ['http', 'http://cdn.example.com/c.jpg'],
    ['local path', '/tmp/c.jpg'],
    ['private ip', 'https://192.168.1.5/c.jpg'],
  ])('falls back to thumb_offset when cover is %s', async (_n, cover) => {
    const { p, calls } = pub([{ json: { id: 'C1' } }], { thumbOffsetMs: 1500 });
    await p.createReelContainer({ ...base, coverUrl: cover });
    const f = new URLSearchParams(calls[0]!.body);
    expect(f.get('cover_url')).toBeNull();
    expect(f.get('thumb_offset')).toBe('1500');
  });

  it('default thumb_offset is 0', async () => {
    const { p, calls } = pub([{ json: { id: 'C1' } }]);
    await p.createReelContainer({ ...base, coverUrl: null });
    expect(new URLSearchParams(calls[0]!.body).get('thumb_offset')).toBe('0');
  });

  it('rejects a non-public videoUrl without a file', async () => {
    const { p, calls } = pub([]);
    await expect(p.createReelContainer({ ...base, videoUrl: 'https://mock-instagram.invalid/v.mp4' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });

  it('resumable upload: creates container, then streams the file to the rupload uri with headers', async () => {
    const uri = 'https://rupload.facebook.com/ig-api-upload/v26.0/C9';
    const { p, calls } = pub([{ json: { id: 'C9', uri } }, { json: { success: true } }]);
    const r = await p.createReelContainer({ ...base, videoFilePath: video });
    expect(r.containerId).toBe('C9');
    const f = new URLSearchParams(calls[0]!.body);
    expect(f.get('upload_type')).toBe('resumable');
    expect(f.get('video_url')).toBeNull();
    const up = calls[1]!;
    expect(up.method).toBe('POST');
    expect(up.url.toString()).toBe(uri);
    expect(up.headers.Authorization).toBe(`OAuth ${TOKEN}`);
    expect(up.headers.offset).toBe('0');
    expect(up.headers.file_size).toBe(String('FAKEVIDEOBYTES'.length));
    expect(up.body).toBe('FAKEVIDEOBYTES');
    expect(up.url.search).toBe('');
  });

  it('resumable upload: refuses a returned uri on another host and sends no bytes', async () => {
    const { p, calls } = pub([{ json: { id: 'C9', uri: 'https://evil.example.com/up' } }]);
    await expect(p.createReelContainer({ ...base, videoFilePath: video })).rejects.toBeInstanceOf(PublisherError);
    expect(calls).toHaveLength(1);
  });

  it('resumable upload: enforces maxUploadBytes before any request', async () => {
    const { p, calls } = pub([], { maxUploadBytes: 5 });
    await expect(p.createReelContainer({ ...base, videoFilePath: video })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });

  it('resumable upload: missing file is invalid_request; upload HTTP failure maps; upload network failure is transient', async () => {
    const a = pub([]);
    await expect(a.p.createReelContainer({ ...base, videoFilePath: join(dir, 'nope.mp4') })).rejects.toMatchObject({ code: 'invalid_request' });
    const b = pub([{ json: { id: 'C9' } }, err(190, 'bad', 401)]);
    await expect(b.p.createReelContainer({ ...base, videoFilePath: video })).rejects.toMatchObject({ code: 'token_expired' });
    expect(b.calls[1]!.url.host).toBe('rupload.facebook.com'); // default uri built from host/version/container
    expect(b.calls[1]!.url.pathname).toBe('/ig-api-upload/v26.0/C9');
    const c = pub([{ json: { id: 'C9' } }, new TypeError('fetch failed')]);
    await expect(c.p.createReelContainer({ ...base, videoFilePath: video })).rejects.toMatchObject({ code: 'transient' });
  });

  it('getContainerStatus requests status_code and maps values', async () => {
    const { p, calls } = pub([
      { json: { status_code: 'IN_PROGRESS' } },
      { json: { status_code: 'ERROR', status: 'Error: bad video' } },
      { json: { status_code: 'EXPIRED' } },
      { json: { status_code: 'WEIRD' } },
    ]);
    expect(await p.getContainerStatus('C1')).toEqual({ status: 'IN_PROGRESS', errorMessage: null });
    expect(calls[0]!.url.pathname).toBe('/v26.0/C1');
    expect(calls[0]!.url.searchParams.get('fields')).toContain('status_code');
    expect(await p.getContainerStatus('C1')).toEqual({ status: 'ERROR', errorMessage: 'Error: bad video' });
    expect((await p.getContainerStatus('C1')).status).toBe('EXPIRED');
    await expect(p.getContainerStatus('C1')).rejects.toMatchObject({ code: 'transient' });
  });

  it('publishContainer posts creation_id and returns the media id', async () => {
    const { p, calls } = pub([{ json: { id: 'M1' } }]);
    expect(await p.publishContainer('a', 'C1')).toEqual({ remoteMediaId: 'M1' });
    const c = calls[0]!;
    expect(c.url.pathname).toBe(`/v26.0/${IGID}/media_publish`);
    expect(new URLSearchParams(c.body).get('creation_id')).toBe('C1');
    expect(c.url.search).toBe('');
  });

  it('publish 2xx without an id is ambiguous', async () => {
    const { p } = pub([{ json: {} }]);
    await expect(p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'timeout_ambiguous' });
  });

  it('getMedia requests the documented fields', async () => {
    const { p, calls } = pub([{ json: { id: 'M1', permalink: 'https://instagram.com/reel/x', caption: 'c', timestamp: '2026-10-22T00:00:00+0000', media_type: 'VIDEO' } }]);
    expect(await p.getMedia('M1')).toEqual({ remoteMediaId: 'M1', permalink: 'https://instagram.com/reel/x', caption: 'c', timestamp: '2026-10-22T00:00:00+0000', mediaType: 'VIDEO' });
    expect(calls[0]!.url.searchParams.get('fields')).toBe('id,permalink,caption,timestamp,media_type');
    expect(calls[0]!.url.host).toBe('graph.instagram.com');
  });

  it('listRecentMedia sends since/limit and follows paging.next up to the limit, stripping tokens from next URLs', async () => {
    const item = (n: number, ts = '2026-10-22T10:00:00+0000') => ({ id: `M${n}`, permalink: `https://i/${n}`, caption: `c${n}`, timestamp: ts, media_type: 'VIDEO' });
    const next = `https://graph.instagram.com/v26.0/${IGID}/media?fields=x&after=ABC&access_token=${TOKEN}`;
    const { p, calls } = pub([
      { json: { data: [item(1), item(2)], paging: { next } } },
      { json: { data: [item(3), item(4)], paging: { next: `https://graph.instagram.com/v26.0/${IGID}/media?after=DEF` } } },
    ]);
    const out = await p.listRecentMedia('a', { since: new Date('2026-10-01T00:00:00Z'), limit: 3 });
    expect(out.map((m) => m.remoteMediaId)).toEqual(['M1', 'M2', 'M3']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.pathname).toBe(`/v26.0/${IGID}/media`);
    expect(calls[0]!.url.searchParams.get('since')).toBe(String(Date.parse('2026-10-01T00:00:00Z') / 1000));
    expect(calls[0]!.url.searchParams.get('limit')).toBe('3');
    expect(calls[1]!.url.searchParams.get('after')).toBe('ABC');
    expect(calls[1]!.url.search).not.toContain(TOKEN);
    expect(calls[1]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('listRecentMedia stops when there is no next page, filters older items, and rejects foreign next hosts', async () => {
    const old = { id: 'M0', permalink: 'p', caption: null, timestamp: '2020-01-01T00:00:00+0000', media_type: 'VIDEO' };
    const a = pub([{ json: { data: [old] } }]);
    expect(await a.p.listRecentMedia('a', { since: new Date('2026-01-01'), limit: 10 })).toEqual([]);
    const b = pub([{ json: { data: [], paging: { next: 'https://evil.example.com/x' } } }]);
    await expect(b.p.listRecentMedia('a', { since: new Date(0), limit: 10 })).rejects.toBeInstanceOf(PublisherError);
    expect(b.calls).toHaveLength(1);
  });

  it('getPublishingQuota maps the response, and returns null when unavailable', async () => {
    const a = pub([{ json: { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] } }]);
    expect(await a.p.getPublishingQuota('a')).toEqual({ used: 3, limit: 100, windowSec: 86400 });
    expect(a.calls[0]!.url.pathname).toBe(`/v26.0/${IGID}/content_publishing_limit`);
    expect(a.calls[0]!.url.searchParams.get('fields')).toBe('quota_usage,config');
    expect(await pub([{ json: { data: [] } }]).p.getPublishingQuota('a')).toBeNull();
    expect(await pub([err(100, 'nope')]).p.getPublishingQuota('a')).toBeNull();
    expect(await pub([new TypeError('x')]).p.getPublishingQuota('a')).toBeNull();
    await expect(pub([err(190, 'expired', 401)]).p.getPublishingQuota('a')).rejects.toMatchObject({ code: 'token_expired' });
  });
});

describe('LiveInstagramPublisher error mapping', () => {
  const cases: Array<[string, Reply, string]> = [
    ['190', err(190, 'Error validating access token: Session has expired', 401), 'token_expired'],
    ['401 w/o body', { status: 401, json: {} }, 'token_expired'],
    ['4', err(4), 'rate_limited'],
    ['17', err(17), 'rate_limited'],
    ['32', err(32), 'rate_limited'],
    ['613', err(613), 'rate_limited'],
    ['80002', err(80002), 'rate_limited'],
    ['9 / 2207042', err(9, 'limit', 400, undefined, 2207042), 'rate_limited'],
    ['429', { status: 429, json: {} }, 'rate_limited'],
    ['10', err(10, 'perm', 403), 'permission_denied'],
    ['200', err(200, 'perm', 403), 'permission_denied'],
    ['299', err(299, 'perm', 403), 'permission_denied'],
    ['403 w/o body', { status: 403, json: {} }, 'permission_denied'],
    ['100', err(100, 'Invalid parameter'), 'invalid_request'],
    ['2', err(2, 'try later', 500), 'transient'],
    ['500', { status: 500, json: {} }, 'transient'],
    ['unknown 400', err(9999), 'invalid_request'],
  ];
  it.each(cases)('code %s', async (_n, reply, code) => {
    const { p } = pub([reply]);
    await expect(p.getMedia('M1')).rejects.toMatchObject({ code });
  });

  it('rate limit: Retry-After header, BUC estimated time, else conservative default', async () => {
    const a = (await pub([err(4, 'r', 429, { 'retry-after': '120' })]).p.getMedia("M").catch((e) => e)) as PublisherError;
    expect(a.retryAfterSec).toBe(120);
    const buc = JSON.stringify({ [IGID]: [{ call_count: 100, estimated_time_to_regain_access: 5 }] });
    const b = (await pub([err(80002, 'r', 429, { 'x-business-use-case-usage': buc })]).p.getMedia("M").catch((e) => e)) as PublisherError;
    expect(b.retryAfterSec).toBe(300);
    const c = (await pub([err(17)]).p.getMedia("M").catch((e) => e)) as PublisherError;
    expect(c.retryAfterSec).toBe(GRAPH_ASSUMPTIONS.errors.defaultRetryAfterSec);
    expect(c.retryable).toBe(true);
  });

  it('timeout or network failure on publish is timeout_ambiguous; on other calls it is transient', async () => {
    const to = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    await expect(pub([to]).p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'timeout_ambiguous' });
    await expect(pub([new TypeError('fetch failed')]).p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'timeout_ambiguous' });
    await expect(pub([{ status: 502, json: {} }]).p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'timeout_ambiguous' });
    await expect(pub([err(4, 'r', 429)]).p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(pub([to]).p.getMedia('M')).rejects.toMatchObject({ code: 'transient' });
    await expect(pub([to]).p.createReelContainer(base)).rejects.toMatchObject({ code: 'transient' });
  });

  it('actually aborts a hung publish via AbortSignal timeout', async () => {
    const hang = (async (_u: unknown, init?: RequestInit) =>
      new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(init!.signal!.reason)))) as unknown as typeof fetch;
    const p = new LiveInstagramPublisher({ igUserId: IGID, tokens, fetch: hang, requestTimeoutMs: 20 });
    await expect(p.publishContainer('a', 'C1')).rejects.toMatchObject({ code: 'timeout_ambiguous' });
  });

  it('container ERROR / EXPIRED surface as container_error / container_expired through waitForContainer', async () => {
    const a = pub([{ json: { status_code: 'ERROR', status: 'bad' } }]);
    await expect(waitForContainer(a.p, 'C', { pollIntervalMs: 1, deadlineMs: 10, sleep: async () => {} })).rejects.toMatchObject({ code: 'container_error' });
    const b = pub([{ json: { status_code: 'EXPIRED' } }]);
    await expect(waitForContainer(b.p, 'C', { pollIntervalMs: 1, deadlineMs: 10, sleep: async () => {} })).rejects.toMatchObject({ code: 'container_expired' });
  });
});

describe('token redaction', () => {
  it('never leaks the token into errors, even when the server or fetch echoes it', async () => {
    const echo = err(100, `bad token ${TOKEN} in access_token=${TOKEN}`);
    const e1 = (await pub([echo]).p.getMedia('M').catch((e) => e)) as PublisherError;
    expect(e1.message).not.toContain(TOKEN);
    const netErr = new TypeError(`fetch failed for https://graph.instagram.com/x?access_token=${TOKEN}`);
    const e2 = (await pub([netErr]).p.getMedia('M').catch((e) => e)) as PublisherError;
    expect(e2.message).not.toContain(TOKEN);
    const e3 = (await pub([netErr]).p.publishContainer('a', 'C').catch((e) => e)) as PublisherError;
    expect(e3.message).not.toContain(TOKEN);
    expect(JSON.stringify(e3)).not.toContain(TOKEN);
  });

  it('refresh: token is in the query (documented) but redacted from every error', async () => {
    const ok = fakeFetch([{ json: { access_token: 'NEWTOKEN12345678', token_type: 'bearer', expires_in: 5183944 } }]);
    const r = await refreshLongLivedToken(ok.f, TOKEN);
    expect(r).toEqual({ accessToken: 'NEWTOKEN12345678', expiresInSec: 5183944, tokenType: 'bearer' });
    const u = ok.calls[0]!.url;
    expect(u.host).toBe('graph.instagram.com');
    expect(u.pathname).toBe('/refresh_access_token');
    expect(u.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(u.searchParams.get('access_token')).toBe(TOKEN);

    const bad = fakeFetch([err(190, `expired ${TOKEN}`, 400)]);
    const e1 = (await refreshLongLivedToken(bad.f, TOKEN).catch((e) => e)) as PublisherError;
    expect(e1.code).toBe('token_expired');
    expect(e1.message).not.toContain(TOKEN);
    const net = fakeFetch([new TypeError(`boom ?access_token=${TOKEN}`)]);
    const e2 = (await refreshLongLivedToken(net.f, TOKEN).catch((e) => e)) as PublisherError;
    expect(e2.code).toBe('transient');
    expect(e2.message).not.toContain(TOKEN);
    const malformed = fakeFetch([{ json: { nope: 1 } }]);
    await expect(refreshLongLivedToken(malformed.f, TOKEN)).rejects.toMatchObject({ code: 'transient' });
  });
});

describe('tokenRefreshPlan boundaries', () => {
  const D = 24 * 3600 * 1000;
  const issued = new Date('2026-01-01T00:00:00Z');
  const expires = new Date(issued.getTime() + 60 * D);
  const plan = (nowMs: number) => tokenRefreshPlan({ issuedAt: issued, expiresAt: expires, now: new Date(nowMs) });
  it('eligibility starts at exactly 24h and ends at expiry', () => {
    expect(plan(issued.getTime() + D - 1).refreshEligible).toBe(false);
    expect(plan(issued.getTime() + D).refreshEligible).toBe(true);
    expect(plan(expires.getTime() - 1).refreshEligible).toBe(true);
    expect(plan(expires.getTime()).refreshEligible).toBe(false);
  });
  it('alerts at 14d, 7d and expired', () => {
    expect(plan(expires.getTime() - 14 * D - 1).alert).toBeNull();
    expect(plan(expires.getTime() - 14 * D).alert).toBe('14d');
    expect(plan(expires.getTime() - 7 * D - 1).alert).toBe('14d');
    expect(plan(expires.getTime() - 7 * D).alert).toBe('7d');
    expect(plan(expires.getTime() - 1).alert).toBe('7d');
    expect(plan(expires.getTime()).alert).toBe('expired');
    expect(plan(expires.getTime() + D)).toEqual({ refreshEligible: false, alert: 'expired' });
  });
});

describe('LiveInsightsReader', () => {
  const publishedAt = new Date('2026-10-01T00:00:00Z');
  const now = new Date('2026-10-04T00:00:00Z'); // 72h -> window 72h
  const mk = (replies: Reply[], extra = {}) => {
    const ff = fakeFetch(replies);
    return { ...ff, r: new LiveInsightsReader({ tokens, fetch: ff.f, ...extra }) };
  };
  const input = (metrics: string[], n = now) => ({ accountId: 'acct', instagramMediaId: 'im1', remoteMediaId: 'M1', publishedAt, metrics, now: n });
  const val = (name: string, v: unknown) => ({ json: { data: [{ name, period: 'lifetime', values: [{ value: v }] }] } });

  it('requests one allow-listed metric per call with header auth, labels live, and returns raw responses', async () => {
    const { r, calls } = mk([val('reach', 120), val('saved', 0)]);
    const out = await r.readMediaInsights(input(['reach', 'saves']));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.host).toBe('graph.instagram.com');
    expect(calls[0]!.url.pathname).toBe('/v26.0/M1/insights');
    expect(calls[0]!.url.searchParams.get('metric')).toBe('reach');
    expect(calls[1]!.url.searchParams.get('metric')).toBe('saved'); // alias
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.url.search).not.toContain(TOKEN);
    expect(out.snapshots.map((s) => [s.metric, s.value, s.source, s.apiVersion, s.window, s.mediaAgeSec])).toEqual([
      ['reach', 120, 'live', 'v26.0', '72h', 72 * 3600],
      ['saves', 0, 'live', 'v26.0', '72h', 72 * 3600],
    ]);
    for (const s of out.snapshots) expect(MetricSnapshot.safeParse({ ...s, id: 'x', rawResponseId: null }).success).toBe(true);
    const raw = out.raw as { responses: Array<{ body: unknown }> };
    expect(raw.responses[0]!.body).toEqual({ data: [{ name: 'reach', period: 'lifetime', values: [{ value: 120 }] }] });
  });

  it('a real zero is 0; a missing/empty metric is null not_returned, never 0', async () => {
    const { r } = mk([val('likes', 0), { json: { data: [] } }, { json: { data: [{ name: 'shares', values: [] }] } }, val('views', null), val('comments', -1)]);
    const out = await r.readMediaInsights(input(['likes', 'reach', 'shares', 'views', 'comments']));
    const by = Object.fromEntries(out.snapshots.map((s) => [s.metric, s]));
    expect(by.likes!.value).toBe(0);
    expect(by.likes!.unavailabilityReason).toBeNull();
    for (const m of ['reach', 'shares', 'views', 'comments']) {
      expect(by[m]!.value).toBeNull();
      expect(by[m]!.unavailabilityReason).toBe('not_returned');
    }
  });

  it('media younger than the delay: not_yet_available with no request', async () => {
    const { r, calls } = mk([]);
    const young = new Date(publishedAt.getTime() + 30 * 60 * 1000);
    const out = await r.readMediaInsights(input(['reach', 'views'], young));
    expect(calls).toHaveLength(0);
    expect(out.snapshots.every((s) => s.value === null && s.unavailabilityReason === 'not_yet_available' && s.window === '1h')).toBe(true);
  });

  it('API errors become null with a reason; unsupported text maps to not_supported_by_api_version; permission to permission_missing', async () => {
    const { r } = mk([
      err(100, 'The Media Insight metric ig_reels_avg_watch_time is not supported for this media'),
      err(1, 'Something went wrong', 500),
      err(10, 'no permission', 403),
      new TypeError('net down'),
    ]);
    const out = await r.readMediaInsights(input(['avg_watch_time_ms', 'reach', 'views', 'likes']));
    expect(out.snapshots.map((s) => [s.value, s.unavailabilityReason])).toEqual([
      [null, 'not_supported_by_api_version'],
      [null, 'api_error'],
      [null, 'permission_missing'],
      [null, 'api_error'],
    ]);
    expect(out.snapshots[0]!.unit).toBe('milliseconds');
  });

  it('a metric outside the allow-list is not requested', async () => {
    const { r, calls } = mk([val('reach', 5)], { allowedMetrics: ['reach'] });
    const out = await r.readMediaInsights(input(['reach', 'impressions', 'views']));
    expect(calls).toHaveLength(1);
    expect(out.snapshots[1]!.unavailabilityReason).toBe('not_supported_by_api_version');
    expect(out.snapshots[2]!.value).toBeNull();
  });

  it('an expired token aborts the read', async () => {
    const { r } = mk([err(190, 'expired', 401)]);
    await expect(r.readMediaInsights(input(['reach']))).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('is live-labelled', () => {
    expect(mk([]).r.mode).toBe('live');
  });
});

describe('reconcileAmbiguousPublish composes with the live publisher', () => {
  it('finds, misses and flags duplicates through a fake fetch', async () => {
    const m = (id: string, caption: string) => ({ id, permalink: `https://i/${id}`, caption, timestamp: '2026-10-22T10:00:00+0000', media_type: 'VIDEO' });
    const since = new Date('2026-10-22T00:00:00Z');
    const a = pub([{ json: { data: [m('1', 'other'), m('2', 'story LU-007 here')] } }]);
    const found = await reconcileAmbiguousPublish({ publisher: a.p, accountId: 'acct', episodeCode: 'LU-007', since });
    expect(found).toMatchObject({ outcome: 'found', media: { remoteMediaId: '2' } });
    expect(a.calls[0]!.url.host).toBe('graph.instagram.com');
    const b = pub([{ json: { data: [m('1', 'other')] } }]);
    expect(await reconcileAmbiguousPublish({ publisher: b.p, accountId: 'acct', episodeCode: 'LU-007', since })).toEqual({ outcome: 'not_found' });
    const c = pub([{ json: { data: [m('1', 'LU-007'), m('2', 'LU-007 again')] } }]);
    expect((await reconcileAmbiguousPublish({ publisher: c.p, accountId: 'acct', episodeCode: 'LU-007', since })).outcome).toBe('multiple');
  });

  it('ambiguous publish timeout then reconcile finds the remote media', async () => {
    const to = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { p } = pub([to, { json: { data: [{ id: '5', permalink: 'https://i/5', caption: 'LU-001 x', timestamp: '2026-10-22T10:00:00+0000', media_type: 'VIDEO' }] } }]);
    const e = (await p.publishContainer('a', 'C').catch((x) => x)) as PublisherError;
    expect(e.code).toBe('timeout_ambiguous');
    const r = await reconcileAmbiguousPublish({ publisher: p, accountId: 'a', episodeCode: 'LU-001', since: new Date('2026-10-22T00:00:00Z') });
    expect(r.outcome).toBe('found');
  });
});
