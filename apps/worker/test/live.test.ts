import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureOwner, getInstagramCredential, openPgliteDb, saveInstagramCredential, tables as t, type Db, type SealingKey } from '@life/db';
import { liveModeProblems, refreshTokenIfDue } from '../src/index';

const key: SealingKey = { keyId: 'k', key: randomBytes(32) };
const T0 = new Date('2026-10-01T00:00:00Z');
const DAY = 86_400_000;
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await openPgliteDb());
  await ensureOwner(db, { id: 'owner', displayName: 'Owner' });
});
afterEach(async () => close());

const connect = (issuedAt = T0) =>
  saveInstagramCredential(db, { accountId: 'ig', igUserId: '1789', username: 'lu', accessToken: 'OLD-TOKEN', scopes: ['instagram_business_basic'], issuedAt, expiresAt: new Date(issuedAt.getTime() + 60 * DAY), key, actor: { kind: 'owner', ownerId: 'owner' }, now: issuedAt });

function fakeFetch(body: unknown, status = 200) {
  const urls: string[] = [];
  const fn = (async (u: string | URL) => {
    urls.push(String(u));
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, urls };
}

describe('token refresh', () => {
  it('does nothing until a week has passed', async () => {
    await connect();
    const f = fakeFetch({});
    expect(await refreshTokenIfDue(db, { accountId: 'ig', key, fetch: f.fn, now: new Date(T0.getTime() + 2 * DAY) })).toEqual({ kind: 'not_due', alert: null });
    expect(f.urls).toHaveLength(0);
  });

  it('refreshes weekly and stores the new token sealed', async () => {
    await connect();
    const f = fakeFetch({ access_token: 'NEW-TOKEN', expires_in: 60 * 86400, token_type: 'bearer' });
    const now = new Date(T0.getTime() + 8 * DAY);
    const r = await refreshTokenIfDue(db, { accountId: 'ig', key, fetch: f.fn, now });
    expect(r.kind).toBe('refreshed');
    expect((await getInstagramCredential(db, 'ig', key))!.accessToken()).toBe('NEW-TOKEN');
    expect(JSON.stringify(await db.select().from(t.auditEvents))).not.toMatch(/NEW-TOKEN|OLD-TOKEN/);
  });

  it('alerts near expiry and records failures without the token', async () => {
    await connect();
    const f = fakeFetch({ error: { message: 'boom OLD-TOKEN', code: 2 } }, 500);
    const r = await refreshTokenIfDue(db, { accountId: 'ig', key, fetch: f.fn, now: new Date(T0.getTime() + 50 * DAY) });
    expect(r.kind).toBe('failed');
    const audits = await db.select().from(t.auditEvents);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['instagram.token_alert_14d', 'instagram.token_refresh_failed']));
    expect(JSON.stringify(audits)).not.toContain('OLD-TOKEN');
  });

  it('reports an expired token instead of calling Meta', async () => {
    await connect();
    const f = fakeFetch({});
    expect((await refreshTokenIfDue(db, { accountId: 'ig', key, fetch: f.fn, now: new Date(T0.getTime() + 61 * DAY) })).kind).toBe('expired');
    expect(f.urls).toHaveLength(0);
  });
});

describe('live mode gate', () => {
  it('lists every missing condition', () => {
    expect(liveModeProblems({ env: {}, hasCredential: false })).toHaveLength(4);
    expect(liveModeProblems({ env: { LIVE_PUBLISHING_AUTHORIZED: 'yes', INSTAGRAM_CAPABILITIES_VERIFIED: 'yes', INSTAGRAM_TOKEN_KEY: 'x' }, hasCredential: true })).toEqual([]);
    expect(liveModeProblems({ env: { LIVE_PUBLISHING_AUTHORIZED: 'true', INSTAGRAM_CAPABILITIES_VERIFIED: 'yes', INSTAGRAM_TOKEN_KEY: 'x' }, hasCredential: true })).toHaveLength(1);
  });
});
