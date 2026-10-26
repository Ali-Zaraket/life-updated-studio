import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { approveVoiceProfile, eq, ensureOwner, getEpisode, openPgliteDb, saveVoiceProfile, setSpending, tables as t, type Db } from '@life/db';
import { buildWavFromPcm16, type TtsProvider, type TtsResult } from '@life/media';
import type { RenderEpisodeInput, RenderResult } from '@life/render';
import { LocalStorage, loadPilot, producePilot, type ProduceRender } from '../src/index';

const PILOT = fileURLToPath(new URL('../../../content/pilots/LU-TECH-002', import.meta.url));
const CODE = 'LU-TECH-002';
// An hour after the packet's last source recheck, so the 24 h freshness rule passes whatever date that was.
const NOW = new Date(Date.parse(JSON.parse(readFileSync(join(PILOT, 'packet.json'), 'utf8')).provenance.lastRecheckAt) + 3_600_000);
const owner = { kind: 'owner', ownerId: 'owner' } as const;

/** Stands in for the provider: counts calls, never touches the network. */
class FakeTts implements TtsProvider {
  readonly mode = 'live' as const;
  readonly providerId = 'elevenlabs';
  calls = 0;
  constructor(private readonly durationSec = 46) {}
  async synthesize(i: { outPath: string }): Promise<TtsResult> {
    this.calls++;
    await mkdir(dirname(i.outPath), { recursive: true });
    await writeFile(i.outPath, buildWavFromPcm16(Buffer.alloc(9600), 48000));
    return { audioPath: i.outPath, sampleRateHz: 48000, durationSec: this.durationSec, source: 'live', providerRequestId: 'req-1', estimatedCostMicroUsd: 150_000 };
  }
}

function fakeRender(ok = true) {
  const calls: RenderEpisodeInput[] = [];
  const render: ProduceRender = async (input) => {
    calls.push(input);
    await mkdir(input.outDir, { recursive: true });
    const p = (name: string) => join(input.outDir, name);
    const paths = { master: p('master.mov'), delivery: p('delivery.mp4'), cover: p('cover.jpg'), srt: p('captions.srt'), vtt: p('captions.vtt'), manifest: p('manifest.json') };
    for (const f of Object.values(paths)) await writeFile(f, `fake ${basename(f)}`);
    const pass = { ok: true, issues: [] };
    const validation = { master: pass, delivery: ok ? pass : { ok: false, issues: [{ code: 'duration_too_long', message: 'x' }] }, loudness: { ...pass, integratedLufs: -14, truePeakDbtp: -2 }, captions: pass, cover: pass };
    return { ok, paths, validation: validation as RenderResult['validation'], manifest: { label: 'LIVE' } as unknown as RenderResult['manifest'] };
  };
  return { render, calls };
}

async function setup(o: { voice?: boolean; cap?: boolean } = {}) {
  const h = await openPgliteDb();
  await ensureOwner(h.db, { id: 'owner', displayName: 'Owner' });
  const loaded = await loadPilot(h.db, PILOT, NOW);
  expect(loaded.state).toBe('verified');
  if (o.voice ?? true) await approveVoice(h.db);
  if (o.cap ?? true) await setSpending(h.db, { capMicroUsd: 100_000_000, actor: owner, now: NOW });
  const root = await mkdtemp(join(tmpdir(), 'life-produce-test-'));
  return { ...h, root, episodeId: loaded.episodeId, storage: new LocalStorage(root) };
}

async function approveVoice(db: Db) {
  const profile = {
    id: 'audition-elevenlabs-test', version: 1, provider: 'elevenlabs', voiceId: 'VOICE', modelVersion: 'eleven_multilingual_v2', accent: 'en-US',
    pronunciationDictionary: {}, wpmRange: [135, 165], expressiveSettings: {}, approvedReferenceClipSha256: null, approvedByOwnerAt: null,
  };
  await saveVoiceProfile(db, { id: profile.id, version: 1, profile, actor: { kind: 'system', component: 'audition' }, now: NOW });
  await approveVoiceProfile(db, { id: profile.id, version: 1, referenceClipSha256: 'a'.repeat(64), actor: owner, now: NOW });
}

const run = (s: Awaited<ReturnType<typeof setup>>, tts: FakeTts, render: ProduceRender, confirmSpend: boolean, now = NOW) =>
  producePilot({ db: s.db, storage: s.storage, tts: () => tts, render, now: () => now, log: () => {} }, { code: CODE, accountId: 'mock-account', confirmSpend });

describe('pilot production (fake TTS and render)', () => {
  it('refuses without an approved narrator and spends nothing', async () => {
    const s = await setup({ voice: false });
    try {
      const tts = new FakeTts();
      const r = await run(s, tts, fakeRender().render, true);
      expect(r.state).toBe('refused');
      expect(r.message).toMatch(/no narrator is approved/);
      expect(tts.calls).toBe(0);
      expect(await s.db.select().from(t.costEvents)).toEqual([]);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('dry run calls nothing, writes nothing and leaves the episode verified', async () => {
    const s = await setup();
    try {
      const tts = new FakeTts();
      const { render, calls } = fakeRender();
      const r = await run(s, tts, render, false);
      expect(r.state).toBe('dry_run');
      expect(tts.calls).toBe(0);
      expect(calls).toEqual([]);
      expect(await s.db.select().from(t.costEvents)).toEqual([]);
      expect((await getEpisode(s.db, s.episodeId)).state).toBe('verified');
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('refuses to spend without a cap', async () => {
    const s = await setup({ cap: false });
    try {
      const tts = new FakeTts();
      const r = await run(s, tts, fakeRender().render, true);
      expect(r.state).toBe('refused');
      expect(r.message).toMatch(/spend refused/);
      expect(tts.calls).toBe(0);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('narrates once, renders LIVE and stops at awaiting_user_approval with a held AI-label disclosure', async () => {
    const s = await setup();
    try {
      const tts = new FakeTts();
      const { render, calls } = fakeRender();
      const r = await run(s, tts, render, true);
      expect(r.state).toBe('awaiting_user_approval');
      expect(tts.calls).toBe(1);
      expect(calls[0]!.narration).toMatchObject({ source: 'live', voiceProfile: { id: 'audition-elevenlabs-test', version: 1 }, durationSec: 46 });
      expect(calls[0]!.template).toBe('EverydayMystery');

      const costs = await s.db.select().from(t.costEvents);
      expect(costs).toHaveLength(1);
      expect(costs[0]).toMatchObject({ provider: 'elevenlabs', operation: 'narration_tts', source: 'live', episodeId: s.episodeId });
      const renders = await s.db.select().from(t.renders);
      expect(renders.map((x) => [x.kind, x.source])).toEqual([['full', 'live']]);

      const [pkg] = await s.db.select().from(t.releasePackages).where(eq(t.releasePackages.id, r.releasePackageId!));
      const content = pkg!.content as { disclosure: { syntheticVoice: boolean; platformLabelRequired: boolean; platformLabelMethod: string }; caption: string; coverSource: string };
      expect(content.disclosure).toMatchObject({ syntheticVoice: true, platformLabelRequired: true, platformLabelMethod: 'owner_manual' });
      expect(content.caption).toContain(CODE);
      expect(content.coverSource).toBe('first_frame');
      expect((await getEpisode(s.db, s.episodeId)).state).toBe('awaiting_user_approval');

      // Nothing approves here, and a second run refuses rather than making another package.
      expect(await s.db.select().from(t.approvals)).toEqual([]);
      expect((await run(s, tts, render, true)).state).toBe('refused');
      expect(tts.calls).toBe(1);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('a failed render keeps the paid narration, and the next run reuses it without a second call', async () => {
    const s = await setup();
    try {
      const tts = new FakeTts();
      const first = await run(s, tts, fakeRender(false).render, true);
      expect(first.state).toBe('render_failed');
      expect(first.message).toMatch(/delivery \(duration_too_long\)/);
      expect(await s.db.select().from(t.renders)).toEqual([]);

      const second = await run(s, tts, fakeRender().render, true);
      expect(second.state).toBe('awaiting_user_approval');
      expect(second.costMicroUsd).toBe(0);
      expect(tts.calls).toBe(1);
      expect(await s.db.select().from(t.costEvents)).toHaveLength(1);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('stale evidence blocks before any spend', async () => {
    const s = await setup();
    try {
      const tts = new FakeTts();
      const r = await run(s, tts, fakeRender().render, true, new Date(NOW.getTime() + 3 * 86_400_000));
      expect(r.state).toBe('refused');
      expect(r.message).toMatch(/gates do not pass now/);
      expect(tts.calls).toBe(0);
      expect(await s.db.select().from(t.costEvents)).toEqual([]);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });

  it('a narration longer than the script plan stops before rendering', async () => {
    const s = await setup();
    try {
      const tts = new FakeTts(55);
      const { render, calls } = fakeRender();
      const r = await run(s, tts, render, true);
      expect(r.state).toBe('needs_retime');
      expect(calls).toEqual([]);
      expect(tts.calls).toBe(1);
      expect((await getEpisode(s.db, s.episodeId)).state).toBe('verified');

      // The owner accepts the length: the kept audio is reused and rendered, with no second call.
      const accepted = await producePilot(
        { db: s.db, storage: s.storage, tts: () => tts, render, now: () => NOW, log: () => {} },
        { code: CODE, accountId: 'mock-account', confirmSpend: true, acceptLonger: true },
      );
      expect(accepted.state).toBe('awaiting_user_approval');
      expect(calls[0]!.narration.durationSec).toBe(55);
      expect(tts.calls).toBe(1);
    } finally {
      await s.close();
      await rm(s.root, { recursive: true, force: true });
    }
  });
});
