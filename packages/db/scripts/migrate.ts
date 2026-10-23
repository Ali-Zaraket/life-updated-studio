/** Applies migrations to DATABASE_URL.   pnpm db:migrate */
import { migratePostgres } from '../src/client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[db] DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}
await migratePostgres(url);
console.log('[db] migrations applied');
