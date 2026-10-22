import { PublisherError } from '@life/contracts';
import { GRAPH_ASSUMPTIONS as G } from './assumptions';
import { isTimeoutLike, mapGraphError, readBody, redact } from './http';

const DAY_MS = 24 * 3600 * 1000;

export interface TokenRefreshPlan {
  /** UNVERIFIED (rec §4): at least 24h old and not yet expired. */
  refreshEligible: boolean;
  /** Owner alert level: 14 or 7 days before expiry, or expired. */
  alert: null | '14d' | '7d' | 'expired';
}

export function tokenRefreshPlan(i: { issuedAt: Date; expiresAt: Date; now: Date }): TokenRefreshPlan {
  const now = i.now.getTime();
  const expired = now >= i.expiresAt.getTime();
  const old = now - i.issuedAt.getTime() >= DAY_MS;
  const remaining = i.expiresAt.getTime() - now;
  const alert = expired ? 'expired' : remaining <= 7 * DAY_MS ? '7d' : remaining <= 14 * DAY_MS ? '14d' : null;
  return { refreshEligible: old && !expired, alert };
}

export interface RefreshedToken {
  accessToken: string;
  expiresInSec: number;
  tokenType: string | null;
}

/**
 * Refresh a long-lived Instagram User token. The documented endpoint takes the token in the
 * query string (rec §4), so every error is redacted. Callers must store the new token and
 * never log it.
 */
export async function refreshLongLivedToken(
  fetchFn: typeof fetch,
  token: string,
  opts: { timeoutMs?: number } = {},
): Promise<RefreshedToken> {
  const url = new URL(`https://${G.host}${G.endpoints.refreshToken}`);
  url.searchParams.set('grant_type', G.params.refreshGrantType);
  url.searchParams.set('access_token', token);
  let res: Response;
  try {
    res = await fetchFn(url.toString(), { method: 'GET', signal: AbortSignal.timeout(opts.timeoutMs ?? G.limits.requestTimeoutMs) });
  } catch (e) {
    throw new PublisherError(
      'transient',
      `token refresh: ${isTimeoutLike(e) ? 'timed out' : 'network error'} (${redact(e instanceof Error ? e.message : String(e), token)})`,
    );
  }
  const body = await readBody(res).catch(() => null);
  if (!res.ok) throw mapGraphError({ status: res.status, headers: res.headers, body }, 'token refresh', token);
  const b = body as { access_token?: unknown; expires_in?: unknown; token_type?: unknown } | null;
  if (typeof b?.access_token !== 'string' || typeof b.expires_in !== 'number') {
    throw new PublisherError('transient', 'token refresh: response missing access_token or expires_in');
  }
  return { accessToken: b.access_token, expiresInSec: b.expires_in, tokenType: typeof b.token_type === 'string' ? b.token_type : null };
}
