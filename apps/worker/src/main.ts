/**
 * Background worker.   pnpm worker [--once]
 * Holds only the approval PUBLIC keys. INSTAGRAM_MODE=live additionally needs
 * LIVE_PUBLISHING_AUTHORIZED=yes, INSTAGRAM_CAPABILITIES_VERIFIED=yes and a
 * connected account; otherwise the worker refuses to start.
 */
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { InsightsReader, InstagramPublisher } from '@life/contracts';
import { getInstagramCredential, openPostgresDb, sealingKeyFromEnv, type SealingKey } from '@life/db';
import { MockInsightsReader, MockInstagramPublisher } from '@life/instagram';
import { LocalStorage } from './storage';
import { createLiveAdapters, liveModeProblems, refreshTokenIfDue } from './live';
import { evidenceCheckFor, workerTick } from './tick';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const mode = process.env.INSTAGRAM_MODE ?? 'mock';
if (mode !== 'mock' && mode !== 'live') throw new Error(`INSTAGRAM_MODE must be mock or live, got ${mode}`);

const keysPath = process.env.WORKER_APPROVAL_PUBLIC_KEYS_PATH ?? 'secrets/public/approval-public-keys.json';
const trustedKeys = JSON.parse(await readFile(resolve(keysPath), 'utf8')) as Record<string, string>;
for (const pem of Object.values(trustedKeys)) {
  if (pem.includes('PRIVATE KEY')) throw new Error(`${keysPath} contains a private key; the worker must hold public keys only`);
}

const { db, close } = await openPostgresDb(url);
const accountId = process.env.INSTAGRAM_ACCOUNT_ID ?? (mode === 'live' ? 'instagram-main' : 'mock-account');
let adapters: { publisher: InstagramPublisher; insights: InsightsReader } = { publisher: new MockInstagramPublisher(), insights: new MockInsightsReader() };
let sealingKey: SealingKey | null = null;
if (mode === 'live') {
  sealingKey = process.env.INSTAGRAM_TOKEN_KEY ? sealingKeyFromEnv() : null;
  const hasCredential = sealingKey ? (await getInstagramCredential(db, accountId, sealingKey)) !== null : false;
  const problems = liveModeProblems({ env: process.env, hasCredential });
  if (problems.length) {
    await close();
    throw new Error(`refusing to start in live mode:\n- ${problems.join('\n- ')}`);
  }
  adapters = await createLiveAdapters(db, accountId, sealingKey!);
}
const deps = {
  db,
  ...adapters,
  storage: new LocalStorage(process.env.LIFE_STORAGE_DIR ?? 'storage'),
  trustedKeys,
  ownerId: process.env.LIFE_OWNER_ID ?? 'owner',
  targetAccountId: accountId,
  evidenceCheck: evidenceCheckFor(db),
  now: () => new Date(),
  workerId: `${hostname()}:${process.pid}`,
  log: (m: string) => console.log(new Date().toISOString(), m),
};

console.log(mode === 'live' ? '[worker] LIVE Instagram adapter — approved packages WILL be published' : '[worker] MOCK Instagram adapter — nothing is published to a real account');
let lastRefreshCheck = 0;
const once = process.argv.includes('--once');
let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));
do {
  await workerTick(deps).catch((e) => console.error('[worker] tick failed', e));
  if (sealingKey && Date.now() - lastRefreshCheck > 6 * 3_600_000) {
    lastRefreshCheck = Date.now();
    const r = await refreshTokenIfDue(db, { accountId, key: sealingKey, now: new Date() }).catch((e) => ({ kind: 'failed', reason: String(e) }));
    if (r.kind !== 'not_due') console.log('[worker] token check:', r.kind);
  }
  if (!once) await new Promise((r) => setTimeout(r, 5_000));
} while (!once && !stopping);
await close();
