import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashCanonical, type ScriptBeat } from '@life/contracts';
import { DELIVERY_SPEC, MASTER_SPEC, checkLoudness, extractFirstFrame, measureLoudness, probeMedia, sha256File, validateAgainstSpec, type VideoSpec } from '@life/media';
import { CAPTION_STYLE, COLOR_SETTINGS } from './theme';
import { checkCaptionLayout, toSrt, toVtt, type CaptionCue } from './captions';
import { RenderError, type RenderStage } from './errors';
import { cuesSha256, type RenderManifest } from './manifest';
import { LOUDNORM_TP, STEREO_48K, loudnormPass1, run, type RenderResult } from './render';

export const EXTERNAL_CUT_VERSION = 1;

/**
 * The master for an external cut is the finished cut itself: 1080x1920 H.264/AAC at 30 fps. It is not upscaled to
 * the 4K template master, and the manifest says so (master.kind 'external-cut-1080', nonProRes true).
 */
export const EXTERNAL_MASTER_SPEC: VideoSpec = {
  ...MASTER_SPEC,
  name: 'external-cut-master-1080',
  width: 1080,
  height: 1920,
  videoCodec: 'h264',
  container: 'mp4',
  audioCodec: 'aac',
};

export interface PackageCutInput {
  episodeCode: string;
  script: { versionId: string; sha256: string; beats: ScriptBeat[] };
  claimLedgerSha256: string;
  narration: { audioPath: string; durationSec: number; source: 'mock' | 'live'; voiceProfile: { id: string; version: number } | null };
  /** The finished cut (picture, burned-in captions and the full mix), made outside the templates. */
  cutPath: string;
  /** The captions burned into the cut, with their real times, for the SRT/VTT files. */
  cues: CaptionCue[];
  /** What made the picture, e.g. "Blender 5.2.2 Cycles, assemble_lu_tech_003.py, finish.sh". */
  tool: string;
  outDir: string;
}

async function stage<T>(name: RenderStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RenderError) throw e;
    throw new RenderError(name, (e instanceof Error ? e.message : String(e)).slice(0, 2000), { cause: e });
  }
}

/**
 * Packages a finished external cut the same way renderEpisode packages a template render: master (the cut, copied),
 * Instagram delivery MP4 (loudness-normalised to -14 LUFS from the cut's own mix), first-frame cover, SRT and VTT from
 * the burned-in captions, every file validated, and manifest.json. Never alters the picture.
 * Throws RenderError when a stage fails; returns ok=false when a validation fails.
 */
export async function packageExternalCut(input: PackageCutInput): Promise<RenderResult> {
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const mock = input.narration.source === 'mock';

  const source = await stage('input', async () => {
    if (!existsSync(input.cutPath)) throw new Error(`cut not found: ${input.cutPath}`);
    if (!existsSync(input.narration.audioPath)) throw new Error(`narration file not found: ${input.narration.audioPath}`);
    if (input.cues.length === 0) throw new Error('no caption cues: the SRT/VTT must match the burned-in captions');
    await mkdir(input.outDir, { recursive: true });
    const probe = await probeMedia(input.cutPath);
    if (!probe.video || !probe.audio) throw new Error('the cut needs both a video and an audio stream');
    return { probe, sha256: await sha256File(input.cutPath), bytes: (await stat(input.cutPath)).size };
  });
  const outputSec = source.probe.durationSec;

  const prefix = mock ? 'MOCK_' : '';
  const base = join(resolve(input.outDir), `${prefix}${input.episodeCode}_external-cut_v${EXTERNAL_CUT_VERSION}`);
  const paths = {
    master: `${base}_master.mp4`,
    delivery: `${base}_delivery.mp4`,
    cover: `${base}_cover.jpg`,
    srt: `${base}.srt`,
    vtt: `${base}.vtt`,
    manifest: join(resolve(input.outDir), 'manifest.json'),
  };

  const tMaster = Date.now();
  await stage('master', () => copyFile(input.cutPath, paths.master));
  const masterMs = Date.now() - tMaster;

  const tDelivery = Date.now();
  const stats = await stage('loudness', () => loudnormPass1(input.cutPath, outputSec));
  await stage('delivery', async () => {
    const ln =
      `loudnorm=I=-14:TP=${LOUDNORM_TP}:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}` +
      `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input.cutPath,
      '-map', '0:v:0', '-map', '0:a:0',
      '-vf', 'scale=1080:1920:flags=lanczos,format=yuv420p',
      '-r', '30', '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2',
      '-maxrate', '14M', '-bufsize', '28M', '-g', '60', '-bf', '2',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-af', `${STEREO_48K},${ln},aresample=48000`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      paths.delivery,
    ]);
  });
  const deliveryMs = Date.now() - tDelivery;

  const tCover = Date.now();
  await stage('cover', () => extractFirstFrame(paths.delivery, paths.cover));
  const coverMs = Date.now() - tCover;

  await stage('subtitles', async () => {
    await writeFile(paths.srt, toSrt(input.cues), 'utf8');
    await writeFile(paths.vtt, toVtt(input.cues), 'utf8');
  });
  const captionIssues = checkCaptionLayout(input.cues, { maxCharsPerLine: CAPTION_STYLE.maxCharsPerLine, maxLines: CAPTION_STYLE.maxLines });

  const validated = await stage('validate', async () => {
    const [masterProbe, deliveryProbe, coverProbe, loud] = await Promise.all([
      probeMedia(paths.master), probeMedia(paths.delivery), probeMedia(paths.cover), measureLoudness(paths.delivery),
    ]);
    const coverIssues: { code: string; message: string }[] = [];
    if (coverProbe.video?.width !== 1080 || coverProbe.video?.height !== 1920) {
      coverIssues.push({ code: 'wrong_dimensions', message: `cover is ${coverProbe.video?.width}x${coverProbe.video?.height}, expected 1080x1920` });
    }
    return { masterProbe, deliveryProbe, loud, coverIssues, dv: validateAgainstSpec(deliveryProbe, DELIVERY_SPEC), mv: validateAgainstSpec(masterProbe, EXTERNAL_MASTER_SPEC), ld: checkLoudness(loud) };
  });

  const { manifest, sha } = await stage('manifest', async () => {
    const outputs = {} as RenderManifest['outputs'];
    const sha = {} as RenderResult['sha256'];
    for (const k of ['master', 'delivery', 'cover', 'srt', 'vtt'] as const) {
      const h = await sha256File(paths[k]);
      sha[k] = h;
      outputs[k] = { path: paths[k], sha256: h, bytes: (await stat(paths[k])).size };
    }
    const narrationSha = await sha256File(input.narration.audioPath);
    const voice: RenderManifest['voice'] =
      mock || !input.narration.voiceProfile ? 'mock' : { profileId: input.narration.voiceProfile.id, profileVersion: input.narration.voiceProfile.version };
    const externalCut = { tool: input.tool, sourceSha256: source.sha256, sourceBytes: source.bytes };
    const manifest: RenderManifest = {
      schema: 'life.render-manifest.v1',
      mock,
      label: mock ? 'MOCK' : 'LIVE',
      sample: null,
      episodeCode: input.episodeCode,
      script: { versionId: input.script.versionId, sha256: input.script.sha256 },
      claimLedgerSha256: input.claimLedgerSha256,
      template: { name: 'external-cut', version: EXTERNAL_CUT_VERSION },
      fonts: [],
      voice,
      narration: { sha256: narrationSha, durationSec: input.narration.durationSec, source: input.narration.source },
      captions: { cuesSha256: cuesSha256(input.cues), cueCount: input.cues.length, wordsPerMinute: 0 },
      color: COLOR_SETTINGS,
      remotionVersion: 'n/a (external cut)',
      master: { kind: 'external-cut-1080', nonProRes: true, fallbackReason: null, codecProfile: 'the finished cut, copied unchanged: H.264/AAC 1080x1920 (NOT A 4K PRORES MASTER)' },
      timing: { startedAt, bundleMs: 0, masterMs, deliveryMs, coverMs, totalMs: Date.now() - t0 },
      outputs,
      probes: { master: validated.masterProbe, delivery: validated.deliveryProbe },
      validation: {
        master: validated.mv,
        delivery: validated.dv,
        loudness: { ...validated.ld, integratedLufs: validated.loud.integratedLufs, truePeakDbtp: validated.loud.truePeakDbtp },
        captions: { ok: captionIssues.length === 0, issues: captionIssues },
      },
      externalCut,
      inputsSha256: hashCanonical({
        mock,
        episodeCode: input.episodeCode,
        script: { versionId: input.script.versionId, sha256: input.script.sha256 },
        claimLedgerSha256: input.claimLedgerSha256,
        template: { name: 'external-cut', version: EXTERNAL_CUT_VERSION },
        voice,
        narrationSha256: narrationSha,
        cuesSha256: cuesSha256(input.cues),
        externalCut: { tool: input.tool, sourceSha256: source.sha256 },
      }),
    };
    await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return { manifest, sha };
  });

  const cover = { ok: validated.coverIssues.length === 0, issues: validated.coverIssues };
  const validation = { ...manifest.validation, cover };
  return {
    ok: validation.master.ok && validation.delivery.ok && validation.loudness.ok && validation.captions.ok && cover.ok,
    mock,
    outDir: resolve(input.outDir),
    paths,
    sha256: sha,
    validation,
    manifest,
  };
}
