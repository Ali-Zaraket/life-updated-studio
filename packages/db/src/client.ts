import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
/** Works with both the PGlite (tests) and node-postgres (dev/deploy) drivers. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export function migrationsFolder(): string {
  // Not `new URL('../migrations', import.meta.url)`: bundlers treat that as an asset import.
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

let template: Promise<Blob | File> | null = null;

/**
 * In-process Postgres for tests: no daemon, no network. Migrated and ready.
 * Without a dataDir, the first call migrates once and later calls clone that
 * snapshot, which keeps the suite fast.
 */
export async function openPgliteDb(dataDir?: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dataDir) {
    const client = new PGlite(dataDir);
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db: db as unknown as Db, close: () => client.close() };
  }
  template ??= (async () => {
    const seed = new PGlite();
    await migrate(drizzle(seed, { schema }), { migrationsFolder: migrationsFolder() });
    const dump = await seed.dumpDataDir('none');
    await seed.close();
    return dump;
  })();
  const client = new PGlite({ loadDataDir: await template });
  const db = drizzle(client, { schema });
  return { db: db as unknown as Db, close: () => client.close() };
}

/** Real Postgres (embedded-postgres locally, managed Postgres in deployment). Does not migrate. */
export async function openPostgresDb(connectionString: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const pool = new pg.default.Pool({ connectionString, max: 5 });
  const db = drizzle(pool, { schema });
  return { db: db as unknown as Db, close: () => pool.end() };
}

export async function migratePostgres(connectionString: string): Promise<void> {
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.default.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool, { schema }), { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}
