/**
 *   pnpm db:backup            → backups/life-<timestamp>.json (+ storage file hashes)
 *   pnpm db:restore <file>    → into DATABASE_URL, which must be empty (fresh `pnpm db:migrate`)
 * Backups contain your data and the SEALED Instagram token (useless without
 * INSTAGRAM_TOKEN_KEY). Keep them private; `backups/` is git-ignored.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { exportBackup, openPostgresDb, restoreBackup, verifyBackup, type Backup } from '../src/index';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const [cmd, file] = process.argv.slice(2);

async function hashFile(p: string) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p)) h.update(chunk as Buffer);
  return h.digest('hex');
}
async function storageIndex(root: string): Promise<Record<string, { bytes: number; sha256: string }>> {
  const out: Record<string, { bytes: number; sha256: string }> = {};
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out[relative(root, p).split('\\').join('/')] = { bytes: (await stat(p)).size, sha256: await hashFile(p) };
    }
  }
  await walk(root);
  return out;
}

const { db, close } = await openPostgresDb(url);
try {
  if (cmd === 'backup') {
    const backup = await exportBackup(db);
    const storageRoot = resolve(process.env.LIFE_STORAGE_DIR ?? 'storage');
    const out = { ...backup, storage: { root: 'LIFE_STORAGE_DIR', files: await storageIndex(storageRoot) } };
    await mkdir('backups', { recursive: true });
    const path = join('backups', `life-${backup.createdAt.replace(/[:.]/g, '-')}.json`);
    await writeFile(path, JSON.stringify(out));
    const rows = Object.values(backup.tables).reduce((n, r) => n + r.length, 0);
    console.log(`[backup] ${rows} rows, ${Object.keys(out.storage.files).length} media files indexed → ${path}`);
    console.log('[backup] media files themselves are NOT copied: back up the storage folder alongside this file.');
  } else if (cmd === 'restore') {
    if (!file) throw new Error('usage: pnpm db:restore <backup.json>');
    const backup = JSON.parse(await readFile(file, 'utf8')) as Backup & { storage?: { files: Record<string, { sha256: string }> } };
    const problems = verifyBackup(backup);
    if (problems.length) throw new Error(`backup failed verification: ${problems.join('; ')}`);
    const counts = await restoreBackup(db, backup);
    console.log('[restore] rows restored:', counts);
    if (backup.storage) {
      const now = await storageIndex(resolve(process.env.LIFE_STORAGE_DIR ?? 'storage'));
      const missing = Object.entries(backup.storage.files).filter(([p, f]) => now[p]?.sha256 !== f.sha256).map(([p]) => p);
      console.log(missing.length ? `[restore] ${missing.length} media files missing or changed, e.g. ${missing.slice(0, 3).join(', ')}` : '[restore] all media files present and matching');
    }
  } else {
    throw new Error('usage: backup.ts backup | restore <file>');
  }
} finally {
  await close();
}
