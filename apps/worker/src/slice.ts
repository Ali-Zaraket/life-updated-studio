/**
 *   pnpm slice
 *     In-memory database; runs the whole MOCK pipeline including a SIMULATED
 *     owner approval, then prints the mock insights.
 *   LIFE_SLICE_RENDER=EverydayMystery pnpm slice   (full 4K render; takes minutes)
 *   DATABASE_URL=… pnpm slice
 *     Persistent database; stops at awaiting_user_approval. Approve in the
 *     studio, then `pnpm worker --once` publishes through the MOCK adapter.
 */
import { resolve } from 'node:path';
import { migratePostgres, openPgliteDb, openPostgresDb } from '@life/db';
import { runVerticalSlice } from './vertical-slice';

const url = process.env.DATABASE_URL;
const persistent = Boolean(url);
if (url) await migratePostgres(url);
const handle = url ? await openPostgresDb(url) : await openPgliteDb();

try {
  const result = await runVerticalSlice({
    db: handle.db,
    storageRoot: resolve(process.env.LIFE_STORAGE_DIR ?? 'storage'),
    ownerId: process.env.LIFE_OWNER_ID ?? 'owner',
    accountId: process.env.INSTAGRAM_ACCOUNT_ID ?? 'mock-account',
    simulateOwnerApproval: !persistent,
    persistentDb: persistent,
    renderTemplate: (process.env.LIFE_SLICE_RENDER as never) || undefined,
    log: (line) => console.log(`  ${line}`),
  });
  console.log(`\nSLICE (all MOCK) — ${result.code}: stopped at ${result.stoppedAt}`);
  if (result.metrics) {
    console.log(`[MOCK] ${result.permalink}`);
    console.table(result.metrics.map((m) => ({ ...m, value: m.value ?? '— (null)' })));
  } else {
    console.log('Open the studio to review and approve the package; then run `pnpm worker --once`.');
  }
} finally {
  await handle.close();
}
