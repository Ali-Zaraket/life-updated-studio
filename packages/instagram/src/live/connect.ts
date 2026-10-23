/**
 * Connecting the owner's account (Instagram API with Instagram Login).
 * Every URL and field here is UNVERIFIED until the first live connect; see
 * docs/research/instagram-capability-record.md §2–4 and §11.
 */
import { PublisherError } from '@life/contracts';
import { GRAPH_ASSUMPTIONS as G } from './assumptions';
import { isTimeoutLike, mapGraphError, readBody, redact } from './http';

export const CONNECT_ASSUMPTIONS = {
  /** UNVERIFIED: authorize page for Business Login for Instagram. */
  authorizeUrl: 'https://www.instagram.com/oauth/authorize',
  /** UNVERIFIED: code → short-lived token (form POST, needs the app secret). */
  codeExchangeUrl: 'https://api.instagram.com/oauth/access_token',
  /** UNVERIFIED: short-lived → long-lived (60 days), token in the query. */
  longLivedPath: '/access_token',
  longLivedGrant: 'ig_exchange_token',
  /** Scopes the studio needs: publishing and insights. Insights scope name still to confirm (rec §8). */
  scopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
  /** UNVERIFIED: identity check for a pasted or exchanged token. */
  mePath: '/me',
  meFields: 'user_id,username,account_type',
} as const;

export interface ConnectedIdentity {
  igUserId: string;
  username: string | null;
  accountType: string | null;
}

/** Builds the owner's consent URL. `state` must come from createOAuthState and be checked on return. */
export function buildAuthorizeUrl(i: { appId: string; redirectUri: string; state: string; scopes?: readonly string[] }): string {
  const redirect = new URL(i.redirectUri);
  if (redirect.protocol !== 'https:') throw new Error('Instagram requires an https redirect URI');
  const url = new URL(CONNECT_ASSUMPTIONS.authorizeUrl);
  url.searchParams.set('client_id', i.appId);
  url.searchParams.set('redirect_uri', i.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', (i.scopes ?? CONNECT_ASSUMPTIONS.scopes).join(','));
  url.searchParams.set('state', i.state);
  return url.toString();
}

async function call(fetchFn: typeof fetch, input: string | URL, init: RequestInit, op: string, secrets: string[], timeoutMs: number) {
  let res: Response;
  try {
    res = await fetchFn(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e), ...secrets);
    throw new PublisherError('transient', `${op}: ${isTimeoutLike(e) ? 'timed out' : msg}`);
  }
  const body = await readBody(res);
  if (!res.ok) {
    const err = mapGraphError({ status: res.status, headers: res.headers, body }, op, secrets[0] ?? '');
    throw new PublisherError(err.code, redact(err.message, ...secrets), err.retryAfterSec);
  }
  return body as Record<string, unknown>;
}

/** Code → short-lived token → long-lived token. The secret and tokens never appear in errors. */
export async function exchangeCodeForLongLivedToken(
  fetchFn: typeof fetch,
  i: { appId: string; appSecret: string; redirectUri: string; code: string; timeoutMs?: number },
): Promise<{ accessToken: string; expiresInSec: number; igUserId: string }> {
  const timeout = i.timeoutMs ?? 30_000;
  const form = new URLSearchParams({ client_id: i.appId, client_secret: i.appSecret, grant_type: 'authorization_code', redirect_uri: i.redirectUri, code: i.code });
  const short = await call(fetchFn, CONNECT_ASSUMPTIONS.codeExchangeUrl, { method: 'POST', body: form }, 'code exchange', [i.appSecret, i.code], timeout);
  const shortToken = typeof short.access_token === 'string' ? short.access_token : null;
  const userId = short.user_id !== undefined ? String(short.user_id) : null;
  if (!shortToken || !userId) throw new PublisherError('invalid_request', 'code exchange: response missing access_token or user_id');

  const url = new URL(`https://${G.host}${CONNECT_ASSUMPTIONS.longLivedPath}`);
  url.searchParams.set('grant_type', CONNECT_ASSUMPTIONS.longLivedGrant);
  url.searchParams.set('client_secret', i.appSecret);
  url.searchParams.set('access_token', shortToken);
  const long = await call(fetchFn, url, { method: 'GET' }, 'long-lived exchange', [shortToken, i.appSecret], timeout);
  const accessToken = typeof long.access_token === 'string' ? long.access_token : null;
  const expiresInSec = typeof long.expires_in === 'number' ? long.expires_in : null;
  if (!accessToken || expiresInSec === null) throw new PublisherError('invalid_request', 'long-lived exchange: response missing access_token or expires_in');
  return { accessToken, expiresInSec, igUserId: userId };
}

/** Confirms a token works and says whose it is. Used for pasted tokens and after every exchange. */
export async function verifyAccessToken(fetchFn: typeof fetch, token: string, opts: { timeoutMs?: number; apiVersion?: string } = {}): Promise<ConnectedIdentity> {
  const url = new URL(`https://${G.host}/${opts.apiVersion ?? G.apiVersion}${CONNECT_ASSUMPTIONS.mePath}`);
  url.searchParams.set('fields', CONNECT_ASSUMPTIONS.meFields);
  const me = await call(fetchFn, url, { method: 'GET', headers: { Authorization: G.auth.graphHeader(token) } }, 'verify token', [token], opts.timeoutMs ?? 30_000);
  const id = me.user_id ?? me.id;
  if (id === undefined || id === null) throw new PublisherError('invalid_request', 'verify token: response has no user id');
  return { igUserId: String(id), username: typeof me.username === 'string' ? me.username : null, accountType: typeof me.account_type === 'string' ? me.account_type : null };
}
