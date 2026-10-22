import { PublisherError, type PublisherErrorCode } from '@life/contracts';
import { GRAPH_ASSUMPTIONS as G } from './assumptions';

export interface TokenSource {
  getAccessToken(): Promise<string>;
}

/** Remove the token and any token-looking material from text destined for errors or logs. */
export function redact(text: string, ...secrets: Array<string | null | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  }
  return out
    .replace(/(access_token=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._\-|]{8,}/g, '$1 [REDACTED]');
}

export interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

export interface GraphResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export function isTimeoutLike(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const name = (e as { name?: string }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** Map an HTTP failure to a PublisherError. Never includes URLs or tokens. */
export function mapGraphError(res: GraphResponse, op: string, token: string): PublisherError {
  const err = (res.body as GraphErrorBody | null)?.error;
  const code = err?.code;
  const sub = err?.error_subcode;
  const rawMsg = err?.message ?? `HTTP ${res.status}`;
  const msg = `${op}: ${redact(rawMsg, token)} (http ${res.status}${code !== undefined ? `, code ${code}` : ''}${sub !== undefined ? `, subcode ${sub}` : ''})`;
  const E = G.errors;
  let kind: PublisherErrorCode;
  if (code !== undefined && (E.tokenExpiredCodes as readonly number[]).includes(code)) kind = 'token_expired';
  else if (res.status === 401 && code === undefined) kind = 'token_expired';
  else if (res.status === 429 || (code !== undefined && (E.rateLimitCodes as readonly number[]).includes(code))) kind = 'rate_limited';
  else if (
    code !== undefined &&
    ((E.permissionCodes as readonly number[]).includes(code) ||
      (code >= E.permissionCodeRange[0] && code <= E.permissionCodeRange[1]))
  )
    kind = 'permission_denied';
  else if (res.status === 403 && code === undefined) kind = 'permission_denied';
  else if (code !== undefined && (E.invalidParamCodes as readonly number[]).includes(code)) kind = 'invalid_request';
  else if (res.status >= 500 || (code !== undefined && (E.transientCodes as readonly number[]).includes(code))) kind = 'transient';
  else kind = 'invalid_request';
  return new PublisherError(kind, msg, kind === 'rate_limited' ? retryAfterSec(res.headers) : null);
}

function retryAfterSec(h: Headers): number {
  const ra = h.get('retry-after');
  if (ra) {
    const n = Number(ra);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
    const d = Date.parse(ra);
    if (!Number.isNaN(d)) return Math.max(1, Math.ceil((d - Date.now()) / 1000));
  }
  const buc = h.get(G.errors.bucHeader);
  if (buc) {
    try {
      const parsed = JSON.parse(buc) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>;
      let minutes = 0;
      for (const arr of Object.values(parsed)) for (const u of arr) minutes = Math.max(minutes, u.estimated_time_to_regain_access ?? 0);
      if (minutes > 0) return Math.ceil(minutes * 60);
    } catch {
      /* fall through to default */
    }
  }
  return G.errors.defaultRetryAfterSec;
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}
