import { execFileSync, execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DELIVERY_SPEC,
  MASTER_SPEC,
  MockTtsProvider,
  VoiceProfile,
  checkLoudness,
  measureLoudness,
  probeMedia,
  renderMockPreview,
  sha256File,
  validateAgainstSpec,
  type ProbeResult,
} from '../src/index';

const run = promisify(execFile);

function has(cmd: string): boolean {
  try {
    execFileSync(cmd, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const hasFfmpeg = has('ffmpeg') && has('ffprobe');

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'life-media-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const good: ProbeResult = {
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationSec: 30,
  bytes: 10_000_000,
  video: { codec: 'h264', width: 1080, height: 1920, fps: 30, avgFps: 30, pixFmt: 'yuv420p', profile: 'High', bitrateBps: 5_000_000 },
  audio: { codec: 'aac', sampleRateHz: 48000, channels: 2 },
};
const codes = (p: ProbeResult) => validateAgainstSpec(p, DELIVERY_SPEC).issues.map((i) => i.code);
const withVideo = (v: Partial<NonNullable<ProbeResult['video']>>): ProbeResult => ({ ...good, video: { ...good.video!, ...v } });

describe('validateAgainstSpec', () => {
  it('accepts a conforming file', () => {
    expect(validateAgainstSpec(good, DELIVERY_SPEC)).toEqual({ ok: true, issues: [] });
  });
  it('flags wrong dimensions', () => expect(codes(withVideo({ width: 720, height: 1280 }))).toContain('wrong_dimensions'));
  it('flags wrong fps', () => expect(codes(withVideo({ fps: 25, avgFps: 25 }))).toEqual(['wrong_fps']));
  it('flags VFR', () => expect(codes(withVideo({ avgFps: 27.4 }))).toEqual(['variable_frame_rate']));
  it('flags wrong video codec', () => expect(codes(withVideo({ codec: 'hevc' }))).toContain('wrong_video_codec'));
  it('flags 44.1k audio', () => expect(codes({ ...good, audio: { codec: 'aac', sampleRateHz: 44100, channels: 2 } })).toEqual(['wrong_audio_sample_rate']));
  it('flags missing streams', () => {
    expect(codes({ ...good, audio: null })).toContain('no_audio');
    expect(codes({ ...good, video: null })).toContain('no_video');
  });
  it('flags too long / short / big / bitrate', () => {
    expect(codes({ ...good, durationSec: 500 })).toContain('too_long');
    expect(codes({ ...good, durationSec: 0.5 })).toContain('too_short');
    expect(codes({ ...good, bytes: 5 * 1024 ** 3 })).toContain('too_large');
    expect(codes(withVideo({ bitrateBps: 80_000_000 }))).toContain('bitrate_too_high');
  });
  it('master spec accepts prores/pcm and rejects h264 mp4', () => {
    const master: ProbeResult = {
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationSec: 30,
      bytes: 1e9,
      video: { codec: 'prores', width: 2160, height: 3840, fps: 30, avgFps: 30, pixFmt: 'yuv422p10le', profile: '422', bitrateBps: null },
      audio: { codec: 'pcm_s24le', sampleRateHz: 48000, channels: 2 },
    };
    expect(validateAgainstSpec(master, MASTER_SPEC).ok).toBe(true);
    expect(validateAgainstSpec(good, MASTER_SPEC).ok).toBe(false);
  });
});

describe('checkLoudness', () => {
  it('passes on target and fails otherwise', () => {
    expect(checkLoudness({ integratedLufs: -14.3, truePeakDbtp: -1.5 }).ok).toBe(true);
    expect(checkLoudness({ integratedLufs: -18, truePeakDbtp: -1.5 }).issues[0]?.code).toBe('loudness_off_target');
    expect(checkLoudness({ integratedLufs: -14, truePeakDbtp: -0.2 }).issues[0]?.code).toBe('true_peak_too_high');
    expect(checkLoudness({ integratedLufs: -Infinity, truePeakDbtp: -Infinity }).ok).toBe(false);
  });
});

const profile: VoiceProfile = {
  id: 'vp_mock',
  version: 1,
  provider: 'mock',
  voiceId: 'mock-voice',
  modelVersion: 'mock-1',
  accent: 'en-GB',
  pronunciationDictionary: {},
  wpmRange: [135, 165],
  expressiveSettings: {},
  approvedReferenceClipSha256: null,
  approvedByOwnerAt: null,
};

describe('VoiceProfile', () => {
  it('validates and rejects a reversed wpm range', () => {
    expect(VoiceProfile.safeParse(profile).success).toBe(true);
    expect(VoiceProfile.safeParse({ ...profile, wpmRange: [165, 135] }).success).toBe(false);
  });
});

describe('MockTtsProvider', () => {
  it('writes a valid 48k mono 16-bit WAV with duration words/150wpm', async () => {
    const text = Array.from({ length: 75 }, (_, k) => `w${k}`).join(' '); // 75 words = 30 s
    const out = join(dir, 'nested', 'v.wav');
    const r = await new MockTtsProvider().synthesize({ text, profile, outPath: out, sampleRateHz: 48000 });
    expect(r).toMatchObject({ source: 'mock', estimatedCostMicroUsd: 0, providerRequestId: null, sampleRateHz: 48000 });
    expect(r.durationSec).toBeCloseTo(30, 5);
    const b = await readFile(out);
    expect(b.toString('ascii', 0, 4)).toBe('RIFF');
    expect(b.toString('ascii', 8, 12)).toBe('WAVE');
    expect(b.readUInt16LE(20)).toBe(1);
    expect(b.readUInt16LE(22)).toBe(1);
    expect(b.readUInt32LE(24)).toBe(48000);
    expect(b.readUInt16LE(34)).toBe(16);
    const dataBytes = b.readUInt32LE(40);
    expect(dataBytes).toBe(b.length - 44);
    expect(b.readUInt32LE(4)).toBe(b.length - 8);
    expect(dataBytes / 2 / 48000).toBeCloseTo(30, 5);
  });
  it('rejects empty text', async () => {
    await expect(
      new MockTtsProvider().synthesize({ text: '  ', profile, outPath: join(dir, 'e.wav'), sampleRateHz: 48000 }),
    ).rejects.toThrow();
  });
});

describe('sha256File', () => {
  it('hashes known content', async () => {
    const { writeFile } = await import('node:fs/promises');
    const p = join(dir, 'abc.txt');
    await writeFile(p, 'abc');
    expect(await sha256File(p)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe.skipIf(!hasFfmpeg)('ffmpeg-backed', () => {
  it('renderMockPreview output passes DELIVERY_SPEC, MOCK in names, cover is 1080x1920', async () => {
    const out = join(dir, 'prev');
    const { videoPath, coverPath } = await renderMockPreview({ outDir: out, durationSec: 4 });
    expect(videoPath).toContain('MOCK');
    expect(coverPath).toContain('MOCK');
    const p = await probeMedia(videoPath);
    const v = validateAgainstSpec(p, DELIVERY_SPEC);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(p.durationSec).toBeGreaterThan(3.5);
    expect(p.durationSec).toBeLessThan(4.5);
    const c = await probeMedia(coverPath);
    expect(c.video).toMatchObject({ width: 1080, height: 1920 });
    expect((await stat(coverPath)).size).toBeGreaterThan(0);
  });

  it('uses a supplied audio file', async () => {
    const wav = join(dir, 'voice.wav');
    const text = Array.from({ length: 10 }, (_, k) => `w${k}`).join(' '); // 4 s
    await new MockTtsProvider().synthesize({ text, profile, outPath: wav, sampleRateHz: 48000 });
    const { videoPath } = await renderMockPreview({ outDir: join(dir, 'prev2'), durationSec: 4, audioPath: wav });
    expect(validateAgainstSpec(await probeMedia(videoPath), DELIVERY_SPEC).ok).toBe(true);
  });

  it('a deliberately wrong encode (25fps, 720 wide, 44.1k) fails', async () => {
    const bad = join(dir, 'bad.mp4');
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', bad,
    ]);
    const r = validateAgainstSpec(await probeMedia(bad), DELIVERY_SPEC);
    expect(r.ok).toBe(false);
    const c = r.issues.map((i) => i.code);
    expect(c).toContain('wrong_dimensions');
    expect(c).toContain('wrong_fps');
    expect(c).toContain('wrong_audio_sample_rate');
  });

  it('measureLoudness returns finite numbers for a tone; silence yields very low loudness', async () => {
    const { videoPath } = await renderMockPreview({ outDir: join(dir, 'prev3'), durationSec: 4 });
    const m = await measureLoudness(videoPath);
    expect(Number.isFinite(m.integratedLufs)).toBe(true);
    expect(Number.isFinite(m.truePeakDbtp)).toBe(true);
    expect(m.integratedLufs).toBeLessThan(0);
    // 0.1-amplitude sine is far below -14 LUFS, so the loudness check must flag it
    expect(checkLoudness(m).ok).toBe(false);
  });
});
