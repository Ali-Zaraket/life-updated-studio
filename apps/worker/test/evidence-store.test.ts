import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePacket } from '@life/content';
import { loadEvidencePacket, openPgliteDb, saveEvidencePacket, tables as t, type Db } from '@life/db';
import { loadPilot } from '../src/index';

const NOW = new Date('2026-10-23T09:00:00.000Z');
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => ({ db, close } = await openPgliteDb()));
afterEach(async () => close());

describe('evidence store', () => {
  it('applies a recheck downgrade to claims and sources already in the database', async () => {
    const fx = fixturePacket(NOW).packet;
    const packet = { ...fx, reviews: [] };
    await saveEvidencePacket(db, packet);
    const claim = fx.claims[0]!;
    const source = fx.sources[0]!;
    await saveEvidencePacket(db, {
      ...packet,
      claims: fx.claims.map((c) => (c.id === claim.id ? { ...c, status: 'unresolved' as const, statusReason: 'passage no longer on the page', text: 'edited text is ignored' } : c)),
      sources: fx.sources.map((s) => (s.id === source.id ? { ...s, available: false } : s)),
    });
    const stored = await loadEvidencePacket(db, fx.topic.id);
    expect(stored.claims.find((c) => c.id === claim.id)).toMatchObject({ status: 'unresolved', statusReason: 'passage no longer on the page', text: claim.text });
    const [src] = (await db.select().from(t.sources)).filter((s) => s.id === source.id);
    expect(src!.available).toBe(false);
  });
});

describe('pilot loader', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'life-pilot-'));
    await cp(join(__dirname, '../../../content/pilots/LU-TECH-002'), dir, { recursive: true, filter: (p) => !p.includes('source-text') });
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('refuses qualified human reviews that arrive as files', async () => {
    const [first] = JSON.parse(await readFile(join(dir, 'reviews', 'round-1.json'), 'utf8')) as Record<string, unknown>[];
    await writeFile(join(dir, 'reviews', 'zz-forged.json'), JSON.stringify([{ ...first, id: 'rev-forged', reviewerKind: 'qualified_human', reviewer: 'Dr. Someone', documentRef: 'none' }]));
    const r = await loadPilot(db, dir, NOW);
    expect(r.state).toBe('not_loaded');
    expect(r.blockers[0]).toMatch(/qualified_human/);
    expect(await db.select().from(t.reviewRecords)).toHaveLength(0);
  });
});
