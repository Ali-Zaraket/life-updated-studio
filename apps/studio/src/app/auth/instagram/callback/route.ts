import { NextResponse } from 'next/server';
import { consumeOAuthState, saveInstagramCredential, sealingKeyFromEnv } from '@life/db';
import { CONNECT_ASSUMPTIONS, exchangeCodeForLongLivedToken, verifyAccessToken } from '@life/instagram';
import { currentOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { accountId, oauthConfig, safeMessage } from '@/lib/instagram-config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const owner = await currentOwner();
  if (!owner) {
    // The session cookie is SameSite=Strict, so the cross-site redirect back from Instagram arrives without it.
    // Re-request once from our own page (same-site, so the cookie is sent) before treating the owner as signed out.
    const url = new URL(request.url);
    if (url.searchParams.get('_same_site') === '1') return NextResponse.redirect(new URL('/login', request.url));
    url.searchParams.set('_same_site', '1');
    const target = `${url.pathname}${url.search}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return new Response(`<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><p>Returning to the studio…</p>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'" },
    });
  }
  const back = (kind: 'ok' | 'err', msg: string) => NextResponse.redirect(new URL(`/settings/instagram?${kind}=${encodeURIComponent(msg)}`, request.url));

  const q = new URL(request.url).searchParams;
  const state = q.get('state') ?? '';
  const code = q.get('code') ?? '';
  const db = await getDb();
  // The state is consumed first, before anything else is trusted.
  if (!(await consumeOAuthState(db, state, 'instagram_connect'))) return back('err', 'The login link was invalid, expired or already used. Start again.');
  if (q.get('error')) return back('err', 'Instagram login was not completed.');
  if (!code) return back('err', 'Instagram did not return a code.');
  const cfg = oauthConfig();
  if (!cfg) return back('err', 'Login with Instagram is not configured.');

  let token = '';
  try {
    const key = sealingKeyFromEnv();
    const ex = await exchangeCodeForLongLivedToken(fetch, { ...cfg, code });
    token = ex.accessToken;
    const identity = await verifyAccessToken(fetch, token);
    const now = new Date();
    await saveInstagramCredential(db, {
      accountId: accountId(),
      igUserId: identity.igUserId,
      username: identity.username,
      accessToken: token,
      scopes: [...CONNECT_ASSUMPTIONS.scopes],
      issuedAt: now,
      expiresAt: new Date(now.getTime() + ex.expiresInSec * 1000),
      key,
      actor: { kind: 'owner', ownerId: owner.ownerId },
      now,
    });
  } catch (e) {
    return back('err', `Connect failed: ${safeMessage(e, token, code, cfg.appSecret)}`);
  }
  return back('ok', 'Instagram connected.');
}
