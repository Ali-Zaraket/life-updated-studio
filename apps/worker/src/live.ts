import { PublisherError, type Actor, type InsightsReader, type InstagramPublisher } from '@life/contracts';
import { audit, getInstagramCredential, saveInstagramCredential, type Db, type SealingKey } from '@life/db';
import { LiveInsightsReader, LiveInstagramPublisher, refreshLongLivedToken, tokenRefreshPlan, type TokenSource } from '@life/instagram';

const refreshActor: Actor = { kind: 'system', component: 'token-refresh' };
const DAY_MS = 86_400_000;

/** Reads the sealed token from the database for each request; nothing is cached in plaintext. */
export function credentialTokenSource(db: Db, accountId: string, key: SealingKey): TokenSource {
  return {
    async getAccessToken() {
      const cred = await getInstagramCredential(db, accountId, key);
      if (!cred) throw new PublisherError('token_expired', 'Instagram is not connected (connect it in the studio settings)');
      if (Date.parse(cred.expiresAt) <= Date.now()) throw new PublisherError('token_expired', 'the Instagram token has expired; reconnect in the studio');
      return cred.accessToken();
    },
  };
}

/**
 * Every condition for live publishing, checked at worker start. Any failure
 * keeps the worker on the mock adapter's side of the line: it refuses to run.
 */
export interface LiveGateInput {
  env: NodeJS.ProcessEnv;
  hasCredential: boolean;
}

export function liveModeProblems({ env, hasCredential }: LiveGateInput): string[] {
  const problems: string[] = [];
  if (env.LIVE_PUBLISHING_AUTHORIZED !== 'yes') problems.push('LIVE_PUBLISHING_AUTHORIZED=yes is not set (the owner sets this once they authorize live publishing)');
  if (env.INSTAGRAM_CAPABILITIES_VERIFIED !== 'yes') problems.push('INSTAGRAM_CAPABILITIES_VERIFIED=yes is not set (docs/research/instagram-capability-record.md must be re-verified first)');
  if (!hasCredential) problems.push('no Instagram credential stored (connect in the studio: Settings → Instagram)');
  if (!env.INSTAGRAM_TOKEN_KEY) problems.push('INSTAGRAM_TOKEN_KEY is not set');
  return problems;
}

export async function createLiveAdapters(db: Db, accountId: string, key: SealingKey): Promise<{ publisher: InstagramPublisher; insights: InsightsReader }> {
  const cred = await getInstagramCredential(db, accountId, key);
  if (!cred) throw new Error('Instagram is not connected');
  const tokens = credentialTokenSource(db, accountId, key);
  return { publisher: new LiveInstagramPublisher({ igUserId: cred.igUserId, tokens }), insights: new LiveInsightsReader({ tokens }) };
}

export type RefreshOutcome = { kind: 'not_connected' } | { kind: 'not_due'; alert: string | null } | { kind: 'refreshed'; expiresAt: string } | { kind: 'expired' } | { kind: 'failed'; reason: string };

/**
 * Weekly refresh of the long-lived token, with owner alerts at 14 and 7 days.
 * The new token is sealed again before storage; nothing is logged.
 */
export async function refreshTokenIfDue(db: Db, i: { accountId: string; key: SealingKey; fetch?: typeof fetch; now: Date; refreshEveryDays?: number }): Promise<RefreshOutcome> {
  const cred = await getInstagramCredential(db, i.accountId, i.key);
  if (!cred) return { kind: 'not_connected' };
  const plan = tokenRefreshPlan({ issuedAt: new Date(cred.issuedAt), expiresAt: new Date(cred.expiresAt), now: i.now });
  if (plan.alert) {
    await audit(db, { actor: refreshActor, action: `instagram.token_alert_${plan.alert}`, entityType: 'instagram_account', entityId: i.accountId, details: { expiresAt: cred.expiresAt }, now: i.now });
  }
  if (plan.alert === 'expired') return { kind: 'expired' };
  const age = i.now.getTime() - Date.parse(cred.issuedAt);
  const due = age >= (i.refreshEveryDays ?? 7) * DAY_MS || plan.alert !== null;
  if (!plan.refreshEligible || !due) return { kind: 'not_due', alert: plan.alert };
  try {
    const r = await refreshLongLivedToken(i.fetch ?? globalThis.fetch, cred.accessToken());
    const expiresAt = new Date(i.now.getTime() + r.expiresInSec * 1000);
    await saveInstagramCredential(db, {
      accountId: cred.accountId, igUserId: cred.igUserId, username: cred.username, accessToken: r.accessToken, scopes: cred.scopes,
      issuedAt: i.now, expiresAt, key: i.key, actor: refreshActor, now: i.now,
    });
    return { kind: 'refreshed', expiresAt: expiresAt.toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e); // already redacted by the adapter
    await audit(db, { actor: refreshActor, action: 'instagram.token_refresh_failed', entityType: 'instagram_account', entityId: i.accountId, details: { reason }, now: i.now });
    return { kind: 'failed', reason };
  }
}
