import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export interface VideoSpec {
  name: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  pixFmt?: string;
  container: string;
  audioCodec: string;
  audioSampleRateHz: number;
  minDurationSec: number;
  maxDurationSec: number;
  maxBytes: number;
  maxVideoBitrateBps?: number;
}

/** Archive/production master (BRIEF §5). Limits are studio defaults, not platform limits. */
export const MASTER_SPEC: VideoSpec = {
  name: 'master',
  width: 2160,
  height: 3840,
  fps: 30,
  videoCodec: 'prores',
  container: 'mov',
  audioCodec: 'pcm', // any pcm_* variant
  audioSampleRateHz: 48000,
  minDurationSec: 1,
  maxDurationSec: 600,
  maxBytes: 50 * 1024 ** 3,
};

/**
 * Instagram delivery file.
 * PROVISIONAL: minDurationSec, maxDurationSec, maxBytes, maxVideoBitrateBps and pixFmt are placeholders
 * until docs/research/instagram-capability-record.md is verified against the current Meta API version.
 */
export const DELIVERY_SPEC: VideoSpec = {
  name: 'instagram-delivery',
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  container: 'mp4',
  audioCodec: 'aac',
  audioSampleRateHz: 48000,
  minDurationSec: 3, // PROVISIONAL
  maxDurationSec: 90, // PROVISIONAL
  maxBytes: 300 * 1024 ** 2, // PROVISIONAL
  maxVideoBitrateBps: 25_000_000, // PROVISIONAL
};

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

export interface ProbeResult {
  formatName: string;
  durationSec: number;
  bytes: number;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    avgFps: number;
    pixFmt: string;
    profile: string | null;
    bitrateBps: number | null;
  } | null;
  audio: { codec: string; sampleRateHz: number; channels: number } | null;
}

function parseFraction(s: unknown): number {
  if (typeof s !== 'string') return 0;
  const [n, d] = s.split('/');
  const num = Number(n);
  const den = d === undefined ? 1 : Number(d);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === 'N/A') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  profile?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
}

export async function probeMedia(path: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const j = JSON.parse(stdout) as { format?: Record<string, string>; streams?: RawStream[] };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  return {
    formatName: j.format?.format_name ?? '',
    durationSec: numOrNull(j.format?.duration) ?? 0,
    bytes: numOrNull(j.format?.size) ?? 0,
    video: v
      ? {
          codec: v.codec_name ?? '',
          width: v.width ?? 0,
          height: v.height ?? 0,
          fps: parseFraction(v.r_frame_rate),
          avgFps: parseFraction(v.avg_frame_rate),
          pixFmt: v.pix_fmt ?? '',
          profile: v.profile ?? null,
          bitrateBps: numOrNull(v.bit_rate),
        }
      : null,
    audio: a
      ? { codec: a.codec_name ?? '', sampleRateHz: numOrNull(a.sample_rate) ?? 0, channels: a.channels ?? 0 }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Spec validation (pure)
// ---------------------------------------------------------------------------

export interface SpecIssue {
  code: string;
  message: string;
}

const FPS_TOLERANCE = 0.01;
const VFR_TOLERANCE = 0.1;

function codecMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.startsWith(`${expected}_`);
}

export function validateAgainstSpec(p: ProbeResult, spec: VideoSpec): { ok: boolean; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });

  if (!p.formatName.split(',').includes(spec.container)) {
    add('wrong_container', `container "${p.formatName}" does not include "${spec.container}"`);
  }
  if (p.durationSec < spec.minDurationSec) {
    add('too_short', `duration ${p.durationSec.toFixed(2)}s is under ${spec.minDurationSec}s`);
  }
  if (p.durationSec > spec.maxDurationSec) {
    add('too_long', `duration ${p.durationSec.toFixed(2)}s exceeds ${spec.maxDurationSec}s`);
  }
  if (p.bytes > spec.maxBytes) add('too_large', `file is ${p.bytes} bytes; limit ${spec.maxBytes}`);

  const v = p.video;
  if (!v) {
    add('no_video', 'no video stream');
  } else {
    if (!codecMatches(v.codec, spec.videoCodec)) {
      add('wrong_video_codec', `video codec "${v.codec}" is not "${spec.videoCodec}"`);
    }
    if (v.width !== spec.width || v.height !== spec.height) {
      add('wrong_dimensions', `${v.width}x${v.height} is not ${spec.width}x${spec.height}`);
    }
    if (Math.abs(v.fps - spec.fps) > FPS_TOLERANCE) add('wrong_fps', `frame rate ${v.fps} is not ${spec.fps}`);
    if (Math.abs(v.fps - v.avgFps) > VFR_TOLERANCE) {
      add('variable_frame_rate', `r_frame_rate ${v.fps} differs from avg_frame_rate ${v.avgFps}: not constant`);
    }
    if (spec.pixFmt && v.pixFmt !== spec.pixFmt) add('wrong_pix_fmt', `pixel format "${v.pixFmt}" is not "${spec.pixFmt}"`);
    if (spec.maxVideoBitrateBps !== undefined && v.bitrateBps !== null && v.bitrateBps > spec.maxVideoBitrateBps) {
      add('bitrate_too_high', `video bitrate ${v.bitrateBps} exceeds ${spec.maxVideoBitrateBps}`);
    }
  }

  const a = p.audio;
  if (!a) {
    add('no_audio', 'no audio stream');
  } else {
    if (!codecMatches(a.codec, spec.audioCodec)) add('wrong_audio_codec', `audio codec "${a.codec}" is not "${spec.audioCodec}"`);
    if (a.sampleRateHz !== spec.audioSampleRateHz) {
      add('wrong_audio_sample_rate', `audio sample rate ${a.sampleRateHz} Hz is not ${spec.audioSampleRateHz} Hz`);
    }
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Loudness
// ---------------------------------------------------------------------------

function parseDb(s: string): number {
  return /inf/i.test(s) ? -Infinity : Number(s);
}

export async function measureLoudness(path: string): Promise<{ integratedLufs: number; truePeakDbtp: number }> {
  const { stderr } = await execFileAsync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const i = /\bI:\s+(-?inf|-?[\d.]+)\s+LUFS/i.exec(summary);
  const tp = /True peak:\s*\n\s*Peak:\s+(-?inf|-?[\d.]+)\s+dBFS/i.exec(summary);
  if (!i || !tp) throw new Error('could not parse ffmpeg ebur128 summary');
  return { integratedLufs: parseDb(i[1]!), truePeakDbtp: parseDb(tp[1]!) };
}

export function checkLoudness(
  m: { integratedLufs: number; truePeakDbtp: number },
  target: { lufs: number; toleranceLu: number; maxTruePeakDbtp: number } = { lufs: -14, toleranceLu: 1, maxTruePeakDbtp: -1 },
): { ok: boolean; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  if (!Number.isFinite(m.integratedLufs) || Math.abs(m.integratedLufs - target.lufs) > target.toleranceLu) {
    issues.push({
      code: 'loudness_off_target',
      message: `integrated ${m.integratedLufs} LUFS is not within ${target.lufs} ±${target.toleranceLu} LU`,
    });
  }
  if (m.truePeakDbtp > target.maxTruePeakDbtp) {
    issues.push({
      code: 'true_peak_too_high',
      message: `true peak ${m.truePeakDbtp} dBTP exceeds ${target.maxTruePeakDbtp} dBTP`,
    });
  }
  return { ok: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Voice profile + TTS
// ---------------------------------------------------------------------------

export const VoiceProfile = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.string().min(1),
  voiceId: z.string().min(1),
  modelVersion: z.string().min(1),
  accent: z.string().min(1),
  pronunciationDictionary: z.record(z.string(), z.string()),
  wpmRange: z
    .tuple([z.number().positive(), z.number().positive()])
    .refine(([lo, hi]) => lo <= hi, { message: 'wpmRange must be [min, max]' }),
  expressiveSettings: z.record(z.string(), z.unknown()),
  approvedReferenceClipSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  approvedByOwnerAt: z.iso.datetime({ offset: true }).nullable(),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

export interface TtsResult {
  audioPath: string;
  sampleRateHz: number;
  durationSec: number;
  source: 'mock' | 'live';
  providerRequestId: string | null;
  estimatedCostMicroUsd: number;
}

export interface TtsProvider {
  readonly mode: 'mock' | 'live';
  readonly providerId: string;
  synthesize(i: { text: string; profile: VoiceProfile; outPath: string; sampleRateHz: 48000 }): Promise<TtsResult>;
}

const MOCK_WPM = 150;

/** Build a mono 16-bit PCM WAV (44-byte header). */
function buildWav(samples: Int16Array, sampleRateHz: number): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRateHz, 24);
  buf.writeUInt32LE(sampleRateHz * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let k = 0; k < samples.length; k++) buf.writeInt16LE(samples[k]!, 44 + k * 2);
  return buf;
}

export class MockTtsProvider implements TtsProvider {
  readonly mode = 'mock' as const;
  readonly providerId = 'mock-tts';

  async synthesize(i: { text: string; profile: VoiceProfile; outPath: string; sampleRateHz: 48000 }): Promise<TtsResult> {
    VoiceProfile.parse(i.profile);
    const words = i.text.split(/\s+/).filter((w) => w.length > 0).length;
    if (words === 0) throw new Error('MockTtsProvider: text is empty');
    const rate = i.sampleRateHz;
    const n = Math.round((words / MOCK_WPM) * 60 * rate);
    const samples = new Int16Array(n);
    // Low-level 220 Hz tone (about -30 dBFS) so the mock is audible but never loud.
    for (let k = 0; k < n; k++) samples[k] = Math.round(1000 * Math.sin((2 * Math.PI * 220 * k) / rate));
    await mkdir(dirname(i.outPath), { recursive: true });
    await writeFile(i.outPath, buildWav(samples, rate));
    return {
      audioPath: i.outPath,
      sampleRateHz: rate,
      durationSec: n / rate,
      source: 'mock',
      providerRequestId: null,
      estimatedCostMicroUsd: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock preview render (ffmpeg)
// ---------------------------------------------------------------------------

/** Renders a synthetic MOCK preview + cover. No drawtext, so no font dependency. */
export async function renderMockPreview(i: {
  outDir: string;
  durationSec: number;
  audioPath?: string;
}): Promise<{ videoPath: string; coverPath: string }> {
  await mkdir(i.outDir, { recursive: true });
  const d = i.durationSec;
  const videoPath = join(i.outDir, `MOCK_preview_${d}s.mp4`);
  const coverPath = join(i.outDir, 'MOCK_cover.jpg');
  const src = `testsrc2=size=1080x1920:rate=30:duration=${d}`;

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src];
  if (i.audioPath) {
    args.push('-i', i.audioPath, '-af', 'apad');
  } else {
    args.push('-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${d}`, '-af', 'volume=0.1');
  }
  args.push(
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
    '-t', String(d), '-movflags', '+faststart',
    videoPath,
  );
  await execFileAsync('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024, timeout: 180_000 });

  await execFileAsync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-frames:v', '1', '-q:v', '2', coverPath],
    { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
  );
  return { videoPath, coverPath };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}
