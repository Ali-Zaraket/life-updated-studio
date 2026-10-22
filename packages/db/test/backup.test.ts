import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { exportBackup, openPgliteDb, recordApproval, restoreBackup, revokeApproval, tables as t, verifyBackup, type Db } from '../src/index';
import { episodeAwaitingApproval, freshDb, owner, signFor, studioKeys } from './helpers';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await freshDb()));
afterEach(async () => close());

describe('backup and restore', () => {
  it('round-trips every table, keeps guards working, and refuses non-empty targets', async () => {
    const keys = studioKeys();
    const { pkg, episodeId } = await episodeAwaitingApproval(db);
    const id = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });
    await revokeApproval(db, { approvalId: id, reason: 'test', actor: owner });
    const backup = await exportBackup(db);
    expect(verifyBackup(backup)).toEqual([]);

    const target = await openPgliteDb();
    try {
      await restoreBackup(target.db, JSON.parse(JSON.stringify(backup)));
      const again = await exportBackup(target.db);
      expect(again.tableSha256).toEqual(backup.tableSha256);
      const [ep] = await target.db.select().from(t.episodes).where(eq(t.episodes.id, episodeId));
      expect(ep!.currentVersionId).toBe(pkg.episodeVersionId);
      // Immutability triggers still hold after restore.
      await expect(target.db.update(t.episodeVersions).set({ contentSha256: 'x' })).rejects.toThrow();
      await expect(restoreBackup(target.db, backup)).rejects.toThrow(/empty database/);
    } finally {
      await target.close();
    }
  });

  it('detects a tampered backup', async () => {
    await episodeAwaitingApproval(db);
    const backup = await exportBackup(db);
    (backup.tables.episodes as { code: string }[])[0]!.code = 'LU-TECH-999';
    expect(verifyBackup(backup)).toContain('hash mismatch in episodes');
  });
});
