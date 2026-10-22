import { ensureOwner, openPostgresDb, type Db } from '@life/db';
import { requiredEnv } from './env';

const g = globalThis as unknown as { __lifeStudioDb?: Promise<Db> };

/** Module-level singleton (kept on globalThis so dev reloads reuse the pool). Ensures the owner row on first use. */
export function getDb(): Promise<Db> {
  g.__lifeStudioDb ??= (async () => {
    const { db } = await openPostgresDb(requiredEnv('DATABASE_URL'));
    await ensureOwner(db, { id: requiredEnv('LIFE_OWNER_ID'), displayName: process.env.LIFE_OWNER_NAME || 'Owner' });
    return db;
  })().catch((e) => {
    delete g.__lifeStudioDb;
    throw e;
  });
  return g.__lifeStudioDb;
}
