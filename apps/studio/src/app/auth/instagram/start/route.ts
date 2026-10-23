import { NextResponse } from 'next/server';
import { createOAuthState } from '@life/db';
import { buildAuthorizeUrl } from '@life/instagram';
import { currentOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { oauthConfig } from '@/lib/instagram-config';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (!(await currentOwner())) return NextResponse.redirect(new URL('/login', request.url));
  const cfg = oauthConfig();
  if (!cfg) return NextResponse.redirect(new URL(`/settings/instagram?err=${encodeURIComponent('Login with Instagram is not configured (needs an https redirect).')}`, request.url));
  const state = await createOAuthState(await getDb(), 'instagram_connect');
  return NextResponse.redirect(buildAuthorizeUrl({ appId: cfg.appId, redirectUri: cfg.redirectUri, state }));
}
