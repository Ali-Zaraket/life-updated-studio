/**
 * Final production of a verified episode:
 * approved narrator → narration (paid, needs confirmSpend) → full render → release package.
 *
 * It stops at awaiting_user_approval; only the owner approves, in the studio. Without
 * confirmSpend it is a dry run that calls nothing and writes nothing. Paid narration is
 * kept in storage and reused, so a failed render never pays for the same audio twice.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { evaluateCreativeRules, evaluateEvidenceGate } from '@life/content';
import type { Actor, Disclosure, EpisodeFormat } from '@life/contracts';
import {
  authorizeSpend,
  createReleasePackage,
  eq,
  getEpisode,
  getEpisodeLink,
  getEpisodeVersion,
  loadEvidencePacket,
  recordCost,
  recordRender,
  spendStatus,
  tables as t,
  transitionEpisode,
  type Db,
  type RenderFileInput,
} from '@life/db';
import { TTS_PROVIDER_IDS, VoiceProfile, estimateCostMicroUsd, sha256File, type TtsProvider, type TtsProviderId } from '@life/media';
import type { RenderEpisodeInput, RenderResult, TemplateName } from '@life/render';
import type { LocalStorage } from './storage';

const pipeline: Actor = { kind: 'system', component: 'pilot.produce' };

export const TEMPLATE_FOR_FORMAT: Record<EpisodeFormat, TemplateName> = {
  everyday_mystery: 'EverydayMystery',
  update: 'TheUpdate',
  decision_test: 'DecisionTest',
};

/**
 * The narration is realistic synthetic speech. The brief requires the platform AI label for that unless
 * shown otherwise, and the API field for it is unverified (docs/research/instagram-capability-record.md §10),
 * so the owner applies the label in the Instagram app. The publish gate holds API publishing
 * (`disclosure_unsupported`) until the field is confirmed.
 */
export const SYNTHETIC_VOICE_DISCLOSURE: Disclosure = {
  aiGeneratedVisuals: false,
  syntheticVoice: true,
  platformLabelRequired: true,
  platformLabelMethod: 'owner_manual',
  captionNote: 'Narration uses a synthetic voice.',
};

export type ProduceRender = (input: RenderEpisodeInput) => Promise<Pick<RenderResult, 'ok' | 'paths' | 'validation' | 'manifest'>>;

export interface ProduceDeps {
  db: Db;
  storage: LocalStorage;
  /** Live TTS client for the approved voice. Built only with confirmSpend, before any spend is authorized. */
  tts: (profile: VoiceProfile) => TtsProvider;
  render: ProduceRender;
  now: () => Date;
  log: (line: string) => void;
}

export interface ProduceOptions {
  code: string;
  accountId: string;
  confirmSpend: boolean;
  /**
   * The owner accepts narration longer than the script's planned length. Beats scale with the audio and the reviewed
   * text is unchanged; the owner judges the result before approving.
   */
  acceptLonger?: boolean;
}

export interface ProduceResult {
  state: 'refused' | 'dry_run' | 'needs_retime' | 'render_failed' | 'awaiting_user_approval';
  message: string;
  /** Live cost recorded by this run (estimated, micro-USD). */
  costMicroUsd: number;
  releasePackageId?: string;
}

interface NarrationRecord {
  key: string;
  sha256: string;
  durationSec: number;
  provider: string;
  voiceId: string;
  modelVersion: string;
  profileId: string;
  profileVersion: number;
  providerRequestId: string | null;
  estimatedCostMicroUsd: number;
  source: 'live';
  createdAt: string;
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');

/** The narrator the owner approved most recently (same rule as the studio's Voice page). */
async function approvedVoice(db: Db): Promise<{ profile: VoiceProfile } | { error: string }> {
  const rows = (await db.select().from(t.voiceProfiles)).filter((r) => r.approvedByOwnerAt);
  rows.sort((a, b) => (b.approvedByOwnerAt ?? '').localeCompare(a.approvedByOwnerAt ?? ''));
  const row = rows[0];
  if (!row) return { error: 'no narrator is approved: choose one in the studio (Voice page) first' };
  const parsed = VoiceProfile.safeParse(row.profile);
  if (!parsed.success) return { error: `approved voice ${row.id}@${row.version} is not a complete voice profile (provider, model, accent…); re-run the audition and approve its clip` };
  const p = parsed.data;
  if (!(TTS_PROVIDER_IDS as readonly string[]).includes(p.provider)) return { error: `approved voice uses provider "${p.provider}", which has no live adapter` };
  if (!p.approvedReferenceClipSha256) return { error: `approved voice ${p.id}@${p.version} has no approved reference clip` };
  return { profile: p };
}

async function readNarration(wavPath: string, key: string): Promise<NarrationRecord | null> {
  try {
    const rec = JSON.parse(await readFile(`${wavPath}.json`, 'utf8')) as NarrationRecord;
    if (rec.key !== key) return null;
    return (await sha256File(wavPath)) === rec.sha256 ? rec : null;
  } catch {
    return null;
  }
}

export async function producePilot(deps: ProduceDeps, o: ProduceOptions): Promise<ProduceResult> {
  const { db, storage, log } = deps;
  const now = deps.now();
  const refused = (message: string): ProduceResult => ({ state: 'refused', message, costMicroUsd: 0 });

  // 1. The episode, its current version, and the gates as of now (freshness included), before anything is spent.
  const [row] = await db.select().from(t.episodes).where(eq(t.episodes.code, o.code));
  if (!row) return refused(`episode ${o.code} is not in the database; run pilot:load first`);
  const ep = await getEpisode(db, row.id);
  if (ep.state !== 'verified' && ep.state !== 'preview_ready') {
    return refused(`episode ${o.code} is ${ep.state}; production needs a verified episode (a package may already be waiting for approval)`);
  }
  if (!ep.currentVersionId) return refused(`episode ${o.code} has no script version`);
  const version = await getEpisodeVersion(db, ep.currentVersionId);
  const packet = await loadEvidencePacket(db, ep.topicId);
  const link = await getEpisodeLink(db, ep.id);
  if (!link) return refused(`episode ${o.code} has no episode link; run pilot:load again`);
  const evidence = evaluateEvidenceGate({ packet, version, now });
  const creative = evaluateCreativeRules({ version, link, relatedEpisodeLive: false, reviews: packet.reviews });
  const blockers = [...evidence.blockers, ...creative.blockers];
  if (blockers.length > 0) {
    return refused(`gates do not pass now, nothing was spent: ${blockers.join('; ')}. If a recheck is due, run pilot:recheck and pilot:load, then try again.`);
  }
  log(`${o.code} v${version.versionNumber} (${ep.state}): evidence gate and creative rules pass now`);

  // 2. The owner's narrator.
  const voice = await approvedVoice(db);
  if ('error' in voice) return refused(voice.error);
  const profile = voice.profile;
  const provider = profile.provider as TtsProviderId;
  log(`Narrator: ${profile.id} v${profile.version} (${provider}, voice ${profile.voiceId}, model ${profile.modelVersion}), approved ${profile.approvedByOwnerAt}`);

  const text = version.beats.map((b) => b.narration).join(' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = Array.from(text).length;
  const plannedSec = version.beats.at(-1)!.endSec;
  const [wpmLo, wpmHi] = profile.wpmRange;
  log(`Narration: ${words} words, ${chars} characters; about ${((words / wpmHi) * 60).toFixed(0)}–${((words / wpmLo) * 60).toFixed(0)} s at ${wpmLo}–${wpmHi} wpm (script planned for ${plannedSec} s)`);

  const base = `episodes/${o.code}/v${version.versionNumber}`;
  const narrationRel = `${base}/narration/${safeName(profile.id)}_v${profile.version}.wav`;
  const narrationPath = storage.resolve(`storage://${narrationRel}`);
  const key = createHash('sha256')
    .update(JSON.stringify({ text, provider, voiceId: profile.voiceId, modelVersion: profile.modelVersion, profileId: profile.id, profileVersion: profile.version }))
    .digest('hex');
  let narration = await readNarration(narrationPath, key);
  const template = TEMPLATE_FOR_FORMAT[ep.format as EpisodeFormat];
  const estimate = estimateCostMicroUsd(provider, text);

  if (!o.confirmSpend) {
    if (narration) {
      log(`Narration already recorded (${narration.durationSec.toFixed(1)} s): the next run reuses it, no provider call`);
    } else {
      const s = await spendStatus(db, now);
      log(`One ${provider} call, estimated ${usd(estimate)} (UNVERIFIED price). This month: ${usd(s.monthToDateMicroUsd)} of ${s.capMicroUsd === null ? 'no cap (paid calls disabled)' : usd(s.capMicroUsd)}`);
    }
    log(`Then: ${template} render (4K master, 1080×1920 delivery, first-frame cover, captions) and a release package for the owner's approval`);
    return { state: 'dry_run', message: 'DRY RUN: nothing was called or written. Add --confirm-spend to run.', costMicroUsd: 0 };
  }

  // 3. Narration with the approved voice: paid once, then reused.
  let costMicroUsd = 0;
  if (narration) {
    log(`Reusing recorded narration (${narration.durationSec.toFixed(1)} s, no provider call)`);
  } else {
    const tts = deps.tts(profile);
    const decision = await authorizeSpend(db, { provider, operation: 'narration_tts', estimatedMicroUsd: estimate, now });
    if (!decision.ok) return refused(`spend refused (${decision.reason}): ${decision.message}`);
    if (decision.warning) log(`WARNING: ${decision.warning}`);
    log(`Calling ${provider} for the narration (estimated ${usd(estimate)}) ...`);
    let r;
    try {
      await mkdir(dirname(narrationPath), { recursive: true });
      r = await tts.synthesize({ text, profile, outPath: narrationPath, sampleRateHz: 48000 });
    } catch (e) {
      return refused(`narration failed, nothing was recorded or charged: ${e instanceof Error ? e.message : String(e)}`);
    }
    await recordCost(db, { provider, operation: 'narration_tts', units: chars, unitType: 'characters', amountMicroUsd: r.estimatedCostMicroUsd, estimated: true, source: 'live', episodeId: ep.id, now });
    costMicroUsd = r.estimatedCostMicroUsd;
    narration = {
      key,
      sha256: await sha256File(narrationPath),
      durationSec: r.durationSec,
      provider,
      voiceId: profile.voiceId,
      modelVersion: profile.modelVersion,
      profileId: profile.id,
      profileVersion: profile.version,
      providerRequestId: r.providerRequestId,
      estimatedCostMicroUsd: r.estimatedCostMicroUsd,
      source: 'live',
      createdAt: now.toISOString(),
    };
    await writeFile(`${narrationPath}.json`, `${JSON.stringify(narration, null, 2)}\n`);
    log(`Narration recorded: ${narration.durationSec.toFixed(1)} s, ~${usd(costMicroUsd)}`);
  }

  if (narration.durationSec > plannedSec) {
    if (!o.acceptLonger) {
      return {
        state: 'needs_retime',
        message: `the narration runs ${narration.durationSec.toFixed(1)} s, longer than the script's planned ${plannedSec} s. The audio is kept (no new charge next time). Re-run with --accept-longer to render at this length (beats scale with the audio; the reviewed text is unchanged), or re-time the script.`,
        costMicroUsd,
      };
    }
    log(`Narration runs ${narration.durationSec.toFixed(1)} s, over the planned ${plannedSec} s: rendering at that length (accepted by the owner)`);
  }

  // 4. Full render, written straight into storage (the master is hundreds of MB).
  const outRel = `${base}/final`;
  let lastStage = '';
  const r = await deps.render({
    template,
    episodeCode: o.code,
    title: packet.topic.title,
    script: { versionId: version.id, sha256: version.contentSha256, beats: version.beats },
    claimLedgerSha256: version.claimLedgerSha256,
    narration: { audioPath: narrationPath, durationSec: narration.durationSec, source: 'live', voiceProfile: { id: profile.id, version: profile.version } },
    outDir: storage.resolve(`storage://${outRel}`),
    options: {
      onProgress: (stage) => {
        if (stage !== lastStage) log(`  render: ${(lastStage = stage)}`);
      },
    },
  });
  if (!r.ok) {
    const failed = Object.entries(r.validation).filter(([, v]) => !v.ok).map(([k, v]) => `${k} (${v.issues.map((i) => i.code).join(', ')})`);
    return { state: 'render_failed', message: `render finished but failed validation: ${failed.join('; ')}. Files are left in storage/${outRel} for inspection; nothing was recorded.`, costMicroUsd };
  }

  const uriOf = (path: string) => `storage://${outRel}/${basename(path)}`;
  const fileRecord = async (kind: RenderFileInput['kind'], uri: string, mimeType: string): Promise<RenderFileInput> => {
    const path = storage.resolve(uri);
    return { kind, uri, sha256: await sha256File(path), bytes: (await stat(path)).size, mimeType };
  };
  const delivery = await fileRecord('delivery', uriOf(r.paths.delivery), 'video/mp4');
  const cover = await fileRecord('cover', uriOf(r.paths.cover), 'image/jpeg');
  await recordRender(db, {
    episodeVersionId: version.id,
    kind: 'full',
    source: 'live',
    manifest: r.manifest,
    validation: r.validation,
    files: [
      delivery,
      cover,
      await fileRecord('master', uriOf(r.paths.master), r.paths.master.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
      await fileRecord('subtitles_srt', uriOf(r.paths.srt), 'application/x-subrip'),
      await fileRecord('subtitles_vtt', uriOf(r.paths.vtt), 'text/vtt'),
      await fileRecord('manifest', uriOf(r.paths.manifest), 'application/json'),
      await fileRecord('narration', `storage://${narrationRel}`, 'audio/wav'),
    ],
    now,
  });
  if (ep.state === 'verified') await transitionEpisode(db, { episodeId: ep.id, to: 'preview_ready', actor: pipeline, now });
  log(`${template} render recorded: master, delivery, cover and captions pass validation`);

  // 5. Release package: the exact thing the owner approves.
  const ref = (f: RenderFileInput) => ({ uri: f.uri, sha256: f.sha256, bytes: f.bytes, mimeType: f.mimeType });
  const pkg = await createReleasePackage(db, {
    actor: pipeline,
    now,
    content: {
      episodeId: ep.id,
      episodeCode: o.code,
      episodeVersionId: version.id,
      episodeVersionSha256: version.contentSha256,
      accountId: o.accountId,
      deliveryMedia: ref(delivery),
      cover: ref(cover),
      coverSource: 'first_frame',
      caption: version.caption,
      disclosure: SYNTHETIC_VOICE_DISCLOSURE,
      shareToFeed: true,
    },
  });
  await transitionEpisode(db, { episodeId: ep.id, to: 'awaiting_user_approval', actor: pipeline, now });
  return {
    state: 'awaiting_user_approval',
    message: `release package ${pkg.id} (sha256 ${pkg.packageSha256.slice(0, 12)}…) is ready for the owner's approval in the studio`,
    costMicroUsd,
    releasePackageId: pkg.id,
  };
}
