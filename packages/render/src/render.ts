import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { VERSION as REMOTION_VERSION } from 'remotion';
import type { ScriptBeat } from '@life/contracts';
import {
  DELIVERY_SPEC,
  MASTER_SPEC,
  checkLoudness,
  extractFirstFrame,
  measureLoudness,
  probeMedia,
  sha256File,
  validateAgainstSpec,
  type VideoSpec,
} from '@life/media';
import { CAPTION_STYLE, COLOR_SETTINGS, FONT, TEMPLATE_NAMES, TEMPLATE_VERSION, type TemplateName } from './theme';
import { buildCaptionTimeline, checkCaptionLayout, scaleBeats, toSrt, toVtt } from './captions';
import { RenderError, type RenderStage } from './errors';
import { cuesSha256, inputsSha256, type FontRecord, type RenderManifest } from './manifest';
import { FRAME } from './safe-zones';
import type { EpisodeProps } from './props';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

/** Silence appended after the narration so the last card is readable. */
export const END_HOLD_SEC = 0.5;
export const DEFAULT_WORDS_PER_MINUTE = 150;
/** Loudnorm target true peak is below the -1 dBTP limit to leave headroom for AAC encoding overshoot. */
export const LOUDNORM_TP = -1.5;

/** Documented fallback when ProRes cannot be produced: high-bitrate H.264 in MP4 with AAC audio. */
export const MASTER_FALLBACK_SPEC: VideoSpec = {
  ...MASTER_SPEC,
  name: 'master-h264-mezzanine-fallback',
  videoCodec: 'h264',
  container: 'mp4',
  audioCodec: 'aac',
};

export interface RenderEpisodeInput {
  template: TemplateName;
  episodeCode: string;
  /** Title shown on the cover. */
  title: string;
  script: { versionId: string; sha256: string; beats: ScriptBeat[] };
  claimLedgerSha256: string;
  narration: {
    audioPath: string;
    durationSec: number;
    source: 'mock' | 'live';
    voiceProfile: { id: string; version: number } | null;
  };
  /** Output directory (created). Files are overwritten. */
  outDir: string;
  options?: {
    wordsPerMinute?: number;
    /** Render only the first N seconds (tests and previews). The manifest records it. */
    sampleSeconds?: number;
    concurrency?: number;
    /** Override REMOTION_BROWSER_EXECUTABLE. null = let Remotion pick its normal browser. */
    browserExecutable?: string | null;
    onProgress?: (stage: RenderStage, fraction: number) => void;
  };
}

export interface RenderResult {
  /** True when every validation passed. A false value still leaves the files on disk for inspection. */
  ok: boolean;
  mock: boolean;
  outDir: string;
  paths: { master: string; delivery: string; cover: string; srt: string; vtt: string; manifest: string };
  sha256: { master: string; delivery: string; cover: string; srt: string; vtt: string };
  validation: RenderManifest['validation'] & { cover: { ok: boolean; issues: { code: string; message: string }[] } };
  manifest: RenderManifest;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function run(cmd: string, args: string[], timeoutMs = 30 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, { maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs });
}

async function stage<T>(name: RenderStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RenderError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new RenderError(name, msg.slice(0, 2000), { cause: e });
  }
}

function resolveBrowser(opt: string | null | undefined): string | null {
  if (opt !== undefined) return opt;
  const env = process.env.REMOTION_BROWSER_EXECUTABLE;
  return env && env.length > 0 ? env : null;
}

// Fonts ---------------------------------------------------------------------

const FONT_DIR = join(HERE, '..', 'node_modules', '@fontsource', 'inter', 'files');

export function fontFileNames(): { weight: number; file: string }[] {
  return FONT.weights.map((w) => ({ weight: w, file: `inter-latin-${w}-normal.woff2` }));
}

async function fontRecords(): Promise<FontRecord[]> {
  const out: FontRecord[] = [];
  for (const f of fontFileNames()) {
    const p = join(FONT_DIR, f.file);
    out.push({ family: FONT.family, weight: f.weight, file: f.file, sha256: await sha256File(p), license: 'OFL-1.1' });
  }
  return out;
}

// Bundle (cached per process) -------------------------------------------------

let bundlePromise: Promise<string> | null = null;

/** Bundles the compositions once per process. Fonts are served from a local public dir; nothing is fetched. */
export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const publicDir = await mkdtemp(join(tmpdir(), 'life-render-public-'));
      await mkdir(join(publicDir, 'fonts'), { recursive: true });
      for (const f of fontFileNames()) await copyFile(join(FONT_DIR, f.file), join(publicDir, 'fonts', f.file));
      return bundle({ entryPoint: join(HERE, 'entry.tsx'), publicDir });
    })();
    bundlePromise.catch(() => {
      bundlePromise = null;
    });
  }
  return bundlePromise;
}

// Loudness ----------------------------------------------------------------------

export interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo';

export async function loudnormPass1(audioPath: string, durationSec: number): Promise<LoudnormStats> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-t', String(durationSec), '-i', audioPath, '-vn',
    '-af', `${STEREO_48K},loudnorm=I=-14:TP=${LOUDNORM_TP}:LRA=11:print_format=json`,
    '-f', 'null', '-',
  ]);
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(stderr);
  if (!m) throw new Error('could not parse loudnorm pass-1 output');
  const j = JSON.parse(m[0]) as LoudnormStats;
  if (!Number.isFinite(Number(j.input_i))) throw new Error('narration is silent or unmeasurable (input_i not finite)');
  return j;
}

// ---------------------------------------------------------------------------
// renderEpisode
// ---------------------------------------------------------------------------

/**
 * Renders one episode: master (ProRes 422 .mov, or flagged H.264 fallback), Instagram delivery MP4,
 * cover JPG, SRT and VTT, validates all of them and writes manifest.json next to them.
 * Throws RenderError (with .stage) when a stage fails; returns ok=false when a validation fails.
 */
export async function renderEpisode(input: RenderEpisodeInput): Promise<RenderResult> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const opts = input.options ?? {};
  const wpm = opts.wordsPerMinute ?? DEFAULT_WORDS_PER_MINUTE;
  const mock = input.narration.source === 'mock';
  const browserExecutable = resolveBrowser(opts.browserExecutable);
  const progress = opts.onProgress ?? (() => undefined);

  // --- input -----------------------------------------------------------------
  await stage('input', async () => {
    if (!TEMPLATE_NAMES.includes(input.template)) throw new Error(`unknown template "${input.template}"`);
    if (input.script.beats.length === 0) throw new Error('script has no beats');
    if (!(input.narration.durationSec > 0)) throw new Error('narration duration must be positive');
    if (!existsSync(input.narration.audioPath)) throw new Error(`narration file not found: ${input.narration.audioPath}`);
    if (opts.sampleSeconds !== undefined && !(opts.sampleSeconds > 0)) throw new Error('sampleSeconds must be positive');
    await mkdir(input.outDir, { recursive: true });
  });

  const prefix = mock ? 'MOCK_' : '';
  const base = join(resolve(input.outDir), `${prefix}${input.episodeCode}_${input.template}_v${TEMPLATE_VERSION}`);
  const paths = {
    master: `${base}_master.mov`,
    delivery: `${base}_delivery.mp4`,
    cover: `${base}_cover.jpg`,
    srt: `${base}.srt`,
    vtt: `${base}.vtt`,
    manifest: join(resolve(input.outDir), 'manifest.json'),
  };

  // --- captions ----------------------------------------------------------------
  const narrationSec = input.narration.durationSec;
  const fullDurationSec = narrationSec + END_HOLD_SEC;
  const sampleSec = opts.sampleSeconds === undefined ? null : Math.min(opts.sampleSeconds, fullDurationSec);
  const outputSec = sampleSec ?? fullDurationSec;
  const { cues, props } = await stage('captions', async () => {
    const beatsIn = input.script.beats;
    const scaled = scaleBeats(beatsIn, narrationSec);
    const cues = buildCaptionTimeline(beatsIn, {
      wordsPerMinute: wpm,
      narrationDurationSec: narrationSec,
      maxCharsPerLine: CAPTION_STYLE.maxCharsPerLine,
      maxLines: CAPTION_STYLE.maxLines,
    });
    const props: EpisodeProps = {
      template: input.template,
      episodeCode: input.episodeCode,
      title: input.title,
      mock,
      durationSec: fullDurationSec,
      beats: scaled.map((b) => ({ startSec: b.startSec, endSec: b.endSec, role: b.role, narration: b.narration, visual: b.visual, onScreenText: b.onScreenText })),
      cues,
    };
    return { cues, props };
  });
  const captionIssues = checkCaptionLayout(cues, { maxCharsPerLine: CAPTION_STYLE.maxCharsPerLine, maxLines: CAPTION_STYLE.maxLines });

  // --- bundle ------------------------------------------------------------------
  const tBundle = Date.now();
  progress('bundle', 0);
  const serveUrl = await stage('bundle', () => getBundle());
  const bundleMs = Date.now() - tBundle;

  const baseRenderOpts = { serveUrl, inputProps: props as unknown as Record<string, unknown>, browserExecutable, chromiumOptions: {} };

  // --- master ------------------------------------------------------------------
  const tMaster = Date.now();
  const frames = Math.round(outputSec * FRAME.fps);
  const silentVideo = `${base}_master_video_only.mov`;
  let masterKind: RenderManifest['master']['kind'] = 'prores-422';
  let fallbackReason: string | null = null;
  let masterSpec: VideoSpec = MASTER_SPEC;
  let masterPath = paths.master;

  const composition = await stage('master', () => selectComposition({ ...baseRenderOpts, id: input.template }));
  const common = {
    composition,
    serveUrl,
    inputProps: baseRenderOpts.inputProps,
    browserExecutable,
    concurrency: opts.concurrency ?? null,
    frameRange: [0, frames - 1] as [number, number],
    muted: true,
    colorSpace: 'bt709' as const,
    onProgress: (p: { progress: number }) => progress('master', p.progress),
  };
  try {
    await renderMedia({ ...common, codec: 'prores', proResProfile: 'standard', outputLocation: silentVideo });
  } catch (e) {
    // ProRes unavailable in this Remotion/ffmpeg build: fall back, and say so in the manifest.
    masterKind = 'h264-mezzanine';
    fallbackReason = `ProRes render failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`;
    masterSpec = MASTER_FALLBACK_SPEC;
    masterPath = `${base}_master.mp4`;
    await stage('master', () =>
      renderMedia({ ...common, codec: 'h264', crf: 10, x264Preset: 'slow', pixelFormat: 'yuv420p', outputLocation: silentVideo.replace(/\.mov$/, '.mp4') }),
    );
  }
  const silentActual = masterKind === 'prores-422' ? silentVideo : silentVideo.replace(/\.mov$/, '.mp4');

  // --- mux narration into the master ---------------------------------------------
  await stage('mux', async () => {
    const audioCodec = masterKind === 'prores-422' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '320k'];
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', silentActual, '-i', input.narration.audioPath,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...audioCodec, '-ar', '48000', '-ac', '2',
      '-af', `${STEREO_48K},apad`, '-t', String(outputSec),
      masterPath,
    ]);
  });
  const masterMs = Date.now() - tMaster;

  // --- delivery ----------------------------------------------------------------
  const tDelivery = Date.now();
  progress('delivery', 0);
  const stats = await stage('loudness', () => loudnormPass1(input.narration.audioPath, outputSec));
  await stage('delivery', async () => {
    const ln =
      `loudnorm=I=-14:TP=${LOUDNORM_TP}:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}` +
      `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', silentActual, '-t', String(outputSec), '-i', input.narration.audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-vf', 'scale=1080:1920:flags=lanczos,format=yuv420p',
      '-r', '30', '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2',
      '-maxrate', '14M', '-bufsize', '28M', '-g', '60', '-bf', '2',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-af', `${STEREO_48K},${ln},aresample=48000,apad`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-t', String(outputSec), '-movflags', '+faststart',
      paths.delivery,
    ]);
  });
  const deliveryMs = Date.now() - tDelivery;
  await rm(silentActual, { force: true });

  // --- cover -------------------------------------------------------------------
  // The cover is the delivery's first frame (owner decision): Instagram is told to use frame 0,
  // so the image the owner approves is the one that appears on the grid.
  const tCover = Date.now();
  await stage('cover', () => extractFirstFrame(paths.delivery, paths.cover));
  const coverMs = Date.now() - tCover;

  // --- subtitles ---------------------------------------------------------------
  await stage('subtitles', async () => {
    await writeFile(paths.srt, toSrt(cues), 'utf8');
    await writeFile(paths.vtt, toVtt(cues), 'utf8');
  });

  // --- validate ------------------------------------------------------------------
  const validated = await stage('validate', async () => {
    const [masterProbe, deliveryProbe, coverProbe, loud] = await Promise.all([
      probeMedia(masterPath),
      probeMedia(paths.delivery),
      probeMedia(paths.cover),
      measureLoudness(paths.delivery),
    ]);
    const coverIssues: { code: string; message: string }[] = [];
    if (coverProbe.video?.width !== 1080 || coverProbe.video?.height !== 1920) {
      coverIssues.push({ code: 'wrong_dimensions', message: `cover is ${coverProbe.video?.width}x${coverProbe.video?.height}, expected 1080x1920` });
    }
    // The sample duration may legitimately undercut the provisional minimum, so only check duration for full renders.
    const dv = validateAgainstSpec(deliveryProbe, sampleSec === null ? DELIVERY_SPEC : { ...DELIVERY_SPEC, minDurationSec: 0 });
    const mv = validateAgainstSpec(masterProbe, sampleSec === null ? masterSpec : { ...masterSpec, minDurationSec: 0 });
    const ld = checkLoudness(loud);
    return { masterProbe, deliveryProbe, loud, dv, mv, ld, coverIssues };
  });

  // --- hash + manifest -------------------------------------------------------------
  const manifestResult = await stage('manifest', async () => {
    const outputs = {} as RenderManifest['outputs'];
    const sha = {} as RenderResult['sha256'];
    for (const k of ['master', 'delivery', 'cover', 'srt', 'vtt'] as const) {
      const p = k === 'master' ? masterPath : paths[k];
      const h = await sha256File(p);
      sha[k] = h;
      outputs[k] = { path: p, sha256: h, bytes: (await stat(p)).size };
    }
    const fonts = await fontRecords();
    const narrationSha = await sha256File(input.narration.audioPath);
    const voice: RenderManifest['voice'] =
      mock || !input.narration.voiceProfile
        ? 'mock'
        : { profileId: input.narration.voiceProfile.id, profileVersion: input.narration.voiceProfile.version };
    const manifest: RenderManifest = {
      schema: 'life.render-manifest.v1',
      mock,
      label: mock ? 'MOCK' : 'LIVE',
      sample: sampleSec === null ? null : { seconds: sampleSec },
      episodeCode: input.episodeCode,
      script: { versionId: input.script.versionId, sha256: input.script.sha256 },
      claimLedgerSha256: input.claimLedgerSha256,
      template: { name: input.template, version: TEMPLATE_VERSION },
      fonts,
      voice,
      narration: { sha256: narrationSha, durationSec: narrationSec, source: input.narration.source },
      captions: { cuesSha256: cuesSha256(cues), cueCount: cues.length, wordsPerMinute: wpm },
      color: COLOR_SETTINGS,
      remotionVersion: REMOTION_VERSION,
      master: {
        kind: masterKind,
        nonProRes: masterKind !== 'prores-422',
        fallbackReason,
        codecProfile: masterKind === 'prores-422' ? 'ProRes 422 Standard (prores_ks profile standard), yuv422p10le, bt709' : 'H.264 crf 10 yuv420p, bt709 (NON-PRORES MEZZANINE)',
      },
      timing: { startedAt, bundleMs, masterMs, deliveryMs, coverMs, totalMs: Date.now() - t0 },
      outputs,
      probes: { master: validated.masterProbe, delivery: validated.deliveryProbe },
      validation: {
        master: validated.mv,
        delivery: validated.dv,
        loudness: { ...validated.ld, integratedLufs: validated.loud.integratedLufs, truePeakDbtp: validated.loud.truePeakDbtp },
        captions: { ok: captionIssues.length === 0, issues: captionIssues },
      },
      inputsSha256: inputsSha256({
        mock,
        episodeCode: input.episodeCode,
        scriptVersionId: input.script.versionId,
        scriptSha256: input.script.sha256,
        claimLedgerSha256: input.claimLedgerSha256,
        template: input.template,
        fonts,
        voice,
        narrationSha256: narrationSha,
        captionCues: cues,
        wordsPerMinute: wpm,
        remotionVersion: REMOTION_VERSION,
        sampleSeconds: sampleSec,
      }),
    };
    await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { manifest, sha };
  });

  const { manifest, sha } = manifestResult;
  const coverValidation = { ok: validated.coverIssues.length === 0, issues: validated.coverIssues };
  const validation = { ...manifest.validation, cover: coverValidation };
  return {
    ok: validation.master.ok && validation.delivery.ok && validation.loudness.ok && validation.captions.ok && coverValidation.ok,
    mock,
    outDir: resolve(input.outDir),
    paths: { ...paths, master: masterPath },
    sha256: sha,
    validation,
    manifest,
  };
}
