/**   pnpm pilot:load content/pilots/LU-TECH-002   (DATABASE_URL; in-memory when unset) */
import { resolve } from 'node:path';
import { openPgliteDb, openPostgresDb } from '@life/db';
import { loadPilot } from './pilot';

const dir = process.argv[2];
if (!dir) throw new Error('usage: pnpm pilot:load <pilot dir>');
const url = process.env.DATABASE_URL;
const h = url ? await openPostgresDb(url) : await openPgliteDb();
try {
  const r = await loadPilot(h.db, resolve(dir));
  console.log(`${dir}: ${r.state}${url ? '' : ' (in-memory check only)'}`);
  for (const b of r.blockers) console.log(`  - ${b}`);
  if (r.state !== 'verified') process.exitCode = 1;
} finally {
  await h.close();
}
