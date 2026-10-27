import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixturePacket } from '@life/content';
import { eq, loadEvidencePacket, openPgliteDb, saveEvidencePacket, tables as t, type Db } from '@life/db';
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
      claims: fx.claims.map((c) => (c.id === claim.id ? { ...c, status: 'unresolved' as const, statusReason: 'passage no longer on the page', text: 'edited text is ignored', limitations: 'reviewed limitation', locations: ['caption'] } : c)),
      sources: fx.sources.map((s) => (s.id === source.id ? { ...s, available: false } : s)),
    });
    const stored = await loadEvidencePacket(db, fx.topic.id);
    expect(stored.claims.find((c) => c.id === claim.id)).toMatchObject({ status: 'unresolved', statusReason: 'passage no longer on the page', text: claim.text, limitations: 'reviewed limitation', locations: ['caption'] });
    const [src] = (await db.select().from(t.sources)).filter((s) => s.id === source.id);
    expect(src!.available).toBe(false);
  });

  it('refuses another topic\'s evidence under an id already in use, instead of silently dropping it', async () => {
    const fx = fixturePacket(NOW).packet;
    await saveEvidencePacket(db, { ...fx, reviews: [] });
    const again = await saveEvidencePacket(db, { ...fx, reviews: [] }).then(() => 'ok');
    expect(again).toBe('ok'); // re-saving identical evidence is fine
    const e = fx.evidence[0]!;
    const other = {
      ...fx,
      topic: { ...fx.topic, id: 'other-topic' },
      claims: fx.claims.map((c) => ({ ...c, id: `other-${c.id}`, topicId: 'other-topic' })),
      evidence: [{ ...e, claimId: `other-${e.claimId}` }],
      reviews: [],
    };
    await expect(saveEvidencePacket(db, other)).rejects.toThrow(/evidence_id_conflict|already used for other evidence/);
  });
});

describe('pilot loader', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'life-pilot-'));
    await cp(join(__dirname, '../../../content/pilots/LU-TECH-002'), dir, { recursive: true, filter: (p) => !p.includes('source-text') });
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('turns a changed script into a new version once verified, and leaves an unchanged one alone', async () => {
    const lastCheck = JSON.parse(await readFile(join(dir, 'packet.json'), 'utf8')).provenance.lastRecheckAt as string;
    const at = new Date(Date.parse(lastCheck) + 3_600_000);
    expect((await loadPilot(db, dir, at)).state).toBe('verified');
    const again = await loadPilot(db, dir, at);
    expect(again.state).toBe('verified');
    expect(again.blockers[0]).toMatch(/unchanged; not reloading/);
    const scriptPath = join(dir, 'script.json');
    const script = JSON.parse(await readFile(scriptPath, 'utf8'));
    script.caption = `${script.caption}\nEdited after review.`;
    await writeFile(scriptPath, JSON.stringify(script));
    const r = await loadPilot(db, dir, at);
    const versions = await db.select().from(t.episodeVersions).where(eq(t.episodeVersions.episodeId, r.episodeId));
    expect(versions).toHaveLength(2);
    // the old reviews were bound to the old script, so the edit must be reviewed again
    expect(r.state).toBe('blocked');
    expect(r.blockers.join(' ')).toMatch(/missing_ai_verification/);
  });

  it('refuses qualified human reviews that arrive as files', async () => {
    const [first] = JSON.parse(await readFile(join(dir, 'reviews', 'round-1.json'), 'utf8')) as Record<string, unknown>[];
    await writeFile(join(dir, 'reviews', 'zz-forged.json'), JSON.stringify([{ ...first, id: 'rev-forged', reviewerKind: 'qualified_human', reviewer: 'Dr. Someone', documentRef: 'none' }]));
    const r = await loadPilot(db, dir, NOW);
    expect(r.state).toBe('not_loaded');
    expect(r.blockers[0]).toMatch(/qualified_human/);
    expect(await db.select().from(t.reviewRecords)).toHaveLength(0);
  });
});
