/**
 * Races on a real Postgres server (separate connections, real row locks).
 * Runs only when PG_TEST_URL points at a server where the user may create
 * databases; CI provides one. Each run uses a fresh throwaway database.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enqueueJob, leaseJobs, migratePostgres, openPostgresDb, completeJob, type Db } from '../src/index';
import { episodeAwaitingApproval, signFor, studioKeys, OWNER_ID, topic } from './helpers';
import { createPublishJob, ensureOwner, recordApproval, saveEvidencePacket, tables as t } from '../src/index';

const admin = process.env.PG_TEST_URL;
const dbName = `life_race_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
let url: string;
const handles: Array<{ db: Db; close: () => Promise<void> }> = [];

describe.skipIf(!admin)('real Postgres races', () => {
  beforeAll(async () => {
    const c = new pg.Client({ connectionString: admin });
    await c.connect();
    await c.query(`create database ${dbName}`);
    await c.end();
    const u = new URL(admin!);
    u.pathname = `/${dbName}`;
    url = u.toString();
    await migratePostgres(url);
    for (let i = 0; i < 4; i++) handles.push(await openPostgresDb(url));
  }, 120_000);

  afterAll(async () => {
    await Promise.all(handles.map((h) => h.close()));
    if (!admin) return;
    const c = new pg.Client({ connectionString: admin });
    await c.connect();
    await c.query(`drop database if exists ${dbName} with (force)`);
    await c.end();
  });

  it('four workers on separate connections never lease the same job', async () => {
    const db = handles[0]!.db;
    const now = new Date('2026-10-22T10:00:00Z');
    for (let i = 0; i < 200; i++) await enqueueJob(db, { id: `race-${i}`, kind: 'race', payload: {}, runAt: now });
    const seen = new Map<string, string>();
    await Promise.all(
      handles.map(async ({ db: conn }, w) => {
        for (;;) {
          const batch = await leaseJobs(conn, { workerId: `w${w}`, kinds: ['race'], limit: 7, leaseMs: 60_000, now });
          if (batch.length === 0) return;
          for (const j of batch) {
            expect(seen.has(j.id), `job ${j.id} leased twice`).toBe(false);
            seen.set(j.id, `w${w}`);
            expect(await completeJob(conn, j.id, `w${w}`, now)).toBe(true);
          }
        }
      }),
    );
    expect(seen.size).toBe(200);
    expect(new Set(seen.values()).size).toBeGreaterThan(1);
  });

  it('two connections racing to create a publish job for one approval: exactly one wins', async () => {
    const db = handles[0]!.db;
    await ensureOwner(db, { id: OWNER_ID, displayName: 'Owner' });
    await saveEvidencePacket(db, { topic, sources: [], claims: [], evidence: [], reviews: [] });
    const keys = studioKeys();
    const { pkg } = await episodeAwaitingApproval(db, 'LU-TECH-901');
    const approvalId = await recordApproval(db, { signed: signFor(pkg, keys.privateKey), trustedKeys: keys.trusted });
    const sys = { kind: 'system' as const, component: 'race' };
    const results = await Promise.allSettled(
      handles.map(({ db: conn }) => createPublishJob(conn, { approvalId, adapterMode: 'mock', scheduledFor: new Date(), actor: sys })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.select().from(t.publishJobs)).toHaveLength(1);
  });
});
