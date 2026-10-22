export type TtsErrorKind = 'auth' | 'rate_limit' | 'transient' | 'client' | 'bad_response' | 'sample_rate';

/** Provider failure. Messages are already redacted: never contains the API key. */
export class TtsError extends Error {
  constructor(
    readonly kind: TtsErrorKind,
    message: string,
    readonly details: { provider: string; status?: number; retryAfterSec?: number | null } = { provider: 'unknown' },
  ) {
    super(message);
    this.name = 'TtsError';
  }
  get provider(): string {
    return this.details.provider;
  }
  get status(): number | undefined {
    return this.details.status;
  }
  /** Seconds to wait before retrying (rate_limit only), or null if the provider did not say. */
  get retryAfterSec(): number | null {
    return this.details.retryAfterSec ?? null;
  }
  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'transient';
  }
}

export function redact(text: string, secret: string): string {
  if (!secret) return text;
  let out = text.split(secret).join('[REDACTED]');
  const enc = encodeURIComponent(secret);
  if (enc !== secret) out = out.split(enc).join('[REDACTED]');
  return out;
}

export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : null;
}
