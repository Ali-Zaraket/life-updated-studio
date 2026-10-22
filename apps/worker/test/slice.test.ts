import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openPgliteDb } from '@life/db';
import { runVerticalSlice } from '../src/index';

describe('mock vertical slice', () => {
  it('takes the fixture topic all the way to mock insights', async () => {
    const { db, close } = await openPgliteDb();
    const root = await mkdtemp(join(tmpdir(), 'life-slice-test-'));
    try {
      const r = await runVerticalSlice({ db, storageRoot: root, ownerId: 'owner', accountId: 'mock-account', simulateOwnerApproval: true, persistentDb: false, start: new Date('2026-10-23T09:00:00Z') });
      expect(r.stoppedAt).toBe('measuring');
      expect(r.permalink).toMatch(/^https:\/\/mock-instagram\.invalid\//);
      expect(r.metrics!.every((m) => m.source === 'mock')).toBe(true);
      expect(r.metrics!.some((m) => m.value === null && m.reason === 'not_yet_available')).toBe(true);
    } finally {
      await close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('refuses to simulate an owner approval against a persistent database', async () => {
    const { db, close } = await openPgliteDb();
    await expect(runVerticalSlice({ db, storageRoot: tmpdir(), ownerId: 'o', accountId: 'a', simulateOwnerApproval: true, persistentDb: true })).rejects.toThrow(/refusing/);
    await close();
  });
});
