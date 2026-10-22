import { redact } from '@life/instagram';

export const DAY_MS = 24 * 3600 * 1000;
/** ASSUMED lifetime of a pasted long-lived token; Meta's actual expiry is not read back. */
export const ASSUMED_TOKEN_LIFETIME_DAYS = 60;

export const KEY_COMMAND = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;

export function instagramMode(env: Record<string, string | undefined> = process.env): 'live' | 'mock' {
  return env.INSTAGRAM_MODE === 'live' ? 'live' : 'mock';
}

export function accountId(env: Record<string, string | undefined> = process.env): string {
  return env.INSTAGRAM_ACCOUNT_ID?.trim() || 'instagram-main';
}

export interface OAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** Null unless all three are set and the redirect is https (Meta requires it). */
export function oauthConfig(env: Record<string, string | undefined> = process.env): OAuthConfig | null {
  const appId = env.INSTAGRAM_APP_ID?.trim();
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim();
  const redirectUri = env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri) return null;
  try {
    if (new URL(redirectUri).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { appId, appSecret, redirectUri };
}

export function assumedExpiry(now: Date): Date {
  return new Date(now.getTime() + ASSUMED_TOKEN_LIFETIME_DAYS * DAY_MS);
}

/** Message safe to show: known token strings removed, length capped. */
export function safeMessage(e: unknown, ...secrets: string[]): string {
  const raw = e instanceof Error ? e.message : String(e);
  return redact(raw, ...secrets.filter(Boolean)).slice(0, 300);
}

export const ALERT_TEXT: Record<'14d' | '7d' | 'expired', string> = {
  '14d': 'Token expires within 14 days. Paste a fresh token soon.',
  '7d': 'Token expires within 7 days. Replace it now.',
  expired: 'Token has expired. Publishing and insights will fail until you reconnect.',
};
