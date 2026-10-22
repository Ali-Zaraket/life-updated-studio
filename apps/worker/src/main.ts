/**
 * Background worker.   pnpm worker [--once]
 * Holds only the approval PUBLIC keys. Live Instagram publishing is not
 * implemented and stays disabled until the owner authorizes it.
 */
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { openPostgresDb } from '@life/db';
import { MockInsightsReader, MockInstagramPublisher } from '@life/instagram';
import { LocalStorage } from './storage';
import { evidenceCheckFor, workerTick } from './tick';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const mode = process.env.INSTAGRAM_MODE ?? 'mock';
if (mode !== 'mock') throw new Error(`INSTAGRAM_MODE=${mode}: live publishing is not enabled (requires owner authorization and a verified capability record)`);

const keysPath = process.env.WORKER_APPROVAL_PUBLIC_KEYS_PATH ?? 'secrets/approval-public-keys.json';
const trustedKeys = JSON.parse(await readFile(resolve(keysPath), 'utf8')) as Record<string, string>;
for (const pem of Object.values(trustedKeys)) {
  if (pem.includes('PRIVATE KEY')) throw new Error(`${keysPath} contains a private key; the worker must hold public keys only`);
}

const { db, close } = await openPostgresDb(url);
const deps = {
  db,
  publisher: new MockInstagramPublisher(),
  insights: new MockInsightsReader(),
  storage: new LocalStorage(process.env.LIFE_STORAGE_DIR ?? 'storage'),
  trustedKeys,
  ownerId: process.env.LIFE_OWNER_ID ?? 'owner',
  targetAccountId: process.env.INSTAGRAM_ACCOUNT_ID ?? 'mock-account',
  evidenceCheck: evidenceCheckFor(db),
  now: () => new Date(),
  workerId: `${hostname()}:${process.pid}`,
  log: (m: string) => console.log(new Date().toISOString(), m),
};

console.log('[worker] MOCK Instagram adapter — nothing is published to a real account');
const once = process.argv.includes('--once');
let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));
do {
  await workerTick(deps).catch((e) => console.error('[worker] tick failed', e));
  if (!once) await new Promise((r) => setTimeout(r, 5_000));
} while (!once && !stopping);
await close();
