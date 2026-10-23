import { describe, expect, it } from 'vitest';
import { PublisherError } from '@life/contracts';
import { buildAuthorizeUrl, exchangeCodeForLongLivedToken, verifyAccessToken } from '../src/index';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
type Call = { url: string; init: RequestInit };
function fake(responses: Response[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const r = responses.shift();
    if (!r) throw new Error('unexpected call');
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('connect helpers (fake fetch only)', () => {
  it('builds an https-only consent URL carrying the state', () => {
    const u = new URL(buildAuthorizeUrl({ appId: '123', redirectUri: 'https://studio.example/auth/instagram/callback', state: 's'.repeat(43) }));
    expect(u.searchParams.get('state')).toBe('s'.repeat(43));
    expect(u.searchParams.get('scope')).toContain('instagram_business_content_publish');
    expect(() => buildAuthorizeUrl({ appId: '1', redirectUri: 'http://localhost:3100/cb', state: 'x' })).toThrow(/https/);
  });

  it('exchanges a code for a long-lived token without leaking secrets', async () => {
    const { fn, calls } = fake([json(200, { access_token: 'SHORT-TOKEN-1', user_id: 1789 }), json(200, { access_token: 'LONG-TOKEN-1', expires_in: 5183944 })]);
    const r = await exchangeCodeForLongLivedToken(fn, { appId: '1', appSecret: 'APP-SECRET', redirectUri: 'https://x.example/cb', code: 'CODE' });
    expect(r).toEqual({ accessToken: 'LONG-TOKEN-1', expiresInSec: 5183944, igUserId: '1789' });
    expect(calls[0]!.url).toBe('https://api.instagram.com/oauth/access_token');
    expect(calls[1]!.url).toMatch(/^https:\/\/graph\.instagram\.com\/access_token\?grant_type=ig_exchange_token/);
  });

  it('redacts the secret and code from errors', async () => {
    const { fn } = fake([json(400, { error: { message: 'bad code CODE for secret APP-SECRET', code: 100 } })]);
    const err = await exchangeCodeForLongLivedToken(fn, { appId: '1', appSecret: 'APP-SECRET', redirectUri: 'https://x.example/cb', code: 'CODE' }).catch((e) => e);
    expect(err).toBeInstanceOf(PublisherError);
    expect(err.message).not.toContain('APP-SECRET');
    expect(err.message).not.toMatch(/\bCODE\b/);
  });

  it('verifies a pasted token with a header, not the URL', async () => {
    const { fn, calls } = fake([json(200, { user_id: '1789', username: 'lifeupdated', account_type: 'MEDIA_CREATOR' })]);
    expect(await verifyAccessToken(fn, 'PASTED-TOKEN')).toEqual({ igUserId: '1789', username: 'lifeupdated', accountType: 'MEDIA_CREATOR' });
    expect(calls[0]!.url).not.toContain('PASTED-TOKEN');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer PASTED-TOKEN');
  });

  it('maps an expired token', async () => {
    const { fn } = fake([json(401, { error: { message: 'Session has expired PASTED-TOKEN', code: 190 } })]);
    const err = await verifyAccessToken(fn, 'PASTED-TOKEN').catch((e) => e);
    expect(err.code).toBe('token_expired');
    expect(err.message).not.toContain('PASTED-TOKEN');
  });
});
