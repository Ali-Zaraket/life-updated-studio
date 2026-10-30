import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageExternalCut } from '../src/external-cut';

const has = (cmd: string) => {
  try {
    execFileSync(cmd, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!(has('ffmpeg') && has('ffprobe')))('packageExternalCut (ffmpeg)', () => {
  let dir: string;
  const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'life-cut-'));
    // a 4-second stand-in for a finished Blender cut, and a narration file
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', join(dir, 'cut.mp4'));
    ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000:duration=4', join(dir, 'narration.wav'));
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  const input = () => ({
    episodeCode: 'LU-TEST-001',
    script: { versionId: 'v-1', sha256: 'a'.repeat(64), beats: [] },
    claimLedgerSha256: 'b'.repeat(64),
    narration: { audioPath: join(dir, 'narration.wav'), durationSec: 4, source: 'live' as const, voiceProfile: { id: 'voice', version: 1 } },
    cutPath: join(dir, 'cut.mp4'),
    cues: [
      { index: 0, startSec: 0.2, endSec: 1.8, lines: ['Your phone may be keeping'], beatIndex: 0 },
      { index: 1, startSec: 1.9, endSec: 3.6, lines: ['a map of the places you go.'], beatIndex: 0 },
    ],
    tool: 'test: ffmpeg testsrc2',
    outDir: join(dir, 'out'),
  });

  it('packages a finished cut: unchanged master, loudness-normalised delivery, cover and captions, all validated', async () => {
    const r = await packageExternalCut(input());
    expect(r.validation.delivery).toEqual({ ok: true, issues: [] });
    expect(r.validation.master.ok).toBe(true);
    expect(r.validation.cover.ok).toBe(true);
    expect(r.validation.captions.ok).toBe(true);
    expect(Math.abs(r.manifest.validation.loudness.integratedLufs + 14)).toBeLessThan(1.5);
    expect(r.manifest.template).toEqual({ name: 'external-cut', version: 1 });
    expect(r.manifest.master).toMatchObject({ kind: 'external-cut-1080', nonProRes: true });
    expect(r.manifest.label).toBe('LIVE');
    // the master is the cut itself, byte for byte
    expect(r.sha256.master).toBe(r.manifest.externalCut!.sourceSha256);
    expect(await readFile(r.paths.srt, 'utf8')).toContain('a map of the places you go.');
    expect(r.ok).toBe(true);
  }, 120_000);

  it('refuses a cut without captions instead of shipping SRT/VTT that do not match the picture', async () => {
    await expect(packageExternalCut({ ...input(), cues: [], outDir: join(dir, 'out2') })).rejects.toThrow(/no caption cues/);
  });
});
