/**
 * Local development Postgres without Docker (embedded-postgres). Data lives in
 * .data/pg (git-ignored). Prints the DATABASE_URL to put in .env.local.
 *   pnpm db:start
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.LIFE_PG_PORT ?? 54329);
const dataDir = resolve(process.cwd(), '.data/pg');
const fresh = !existsSync(dataDir);

// Postgres refuses to run as root; embedded-postgres then runs initdb as a
// dedicated `postgres` user, which needs to be able to create the data dir.
// Only happens in Linux containers; a normal dev account skips this.
const isRoot = process.getuid?.() === 0;
if (isRoot && fresh) {
  mkdirSync(dirname(dataDir), { recursive: true });
  chmodSync(dirname(dataDir), 0o777);
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'life',
  password: process.env.LIFE_PG_PASSWORD ?? 'life-local-dev',
  port,
  persistent: true,
  createPostgresUser: isRoot,
});

if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('life');

console.log(`[db] embedded Postgres on port ${port}, data in ${dataDir}`);
console.log(`[db] DATABASE_URL=postgres://life:<password>@127.0.0.1:${port}/life`);
console.log('[db] Ctrl+C to stop');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
