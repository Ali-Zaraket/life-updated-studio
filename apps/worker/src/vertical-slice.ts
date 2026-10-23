/**
 * The first vertical slice, entirely MOCK:
 * fixture topic → claims/sources → script → preview → owner approval →
 * mock publish → mock insights.
 *
 * With `simulateOwnerApproval`, the owner's approval is SIMULATED with an
 * ephemeral key generated in this process and trusted only by this run's
 * publisher. That mode is refused against a persistent database, where only
 * the studio (holding the owner's key) can approve.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimLedgerSha256, evaluateCreativeRules, evaluateEvidenceGate, fixturePacket, FIXTURE_EPISODE_CODE } from '@life/content';
import { buildApprovalPayload, reviewSubjectSha256, signApproval, type Actor, type TrustedApprovalKeys } from '@life/contracts';
import {
  createEpisode,
  createEpisodeVersion,
  createReleasePackage,
  ensureOwner,
  recordRender,
  type RenderFileInput,
  eq,
  like,
  getEpisode,
  recordApproval,
  recordCost,
  saveEpisodeLink,
  saveEvidencePacket,
  tables as t,
  transitionEpisode,
  type Db,
} from '@life/db';
import { MockInsightsReader, MockInstagramPublisher } from '@life/instagram';
import { renderEpisode, type TemplateName } from '@life/render';
import { DELIVERY_SPEC, MockTtsProvider, probeMedia, renderMockPreview, sha256File, validateAgainstSpec, type VoiceProfile } from '@life/media';
import { LocalStorage } from './storage';
import { collectInsights, evidenceCheckFor, workerTick } from './tick';

const pipeline: Actor = { kind: 'system', component: 'slice.pipeline' };
const verifier: Actor = { kind: 'agent', agentName: 'evidence', model: 'claude-opus-5-5' };

export const MOCK_VOICE: VoiceProfile = {
  id: 'mock-voice',
  version: 1,
  provider: 'mock',
  voiceId: 'MOCK',
  modelVersion: 'mock-0',
  accent: 'unselected',
  pronunciationDictionary: {},
  wpmRange: [135, 165],
  expressiveSettings: {},
  approvedReferenceClipSha256: null,
  approvedByOwnerAt: null,
};

export interface SliceOptions {
  db: Db;
  storageRoot: string;
  ownerId: string;
  accountId: string;
  /** Only allowed with a throwaway in-memory database. */
  simulateOwnerApproval: boolean;
  persistentDb: boolean;
  /** Full Remotion render instead of the quick test-pattern preview. */
  renderTemplate?: TemplateName;
  start?: Date;
  log?: (line: string) => void;
}

export interface SliceResult {
  episodeId: string;
  code: string;
  releasePackageId: string;
  stoppedAt: 'awaiting_user_approval' | 'measuring';
  remoteMediaId?: string;
  permalink?: string;
  metrics?: Array<{ metric: string; window: string; ageMin: number; value: number | null; reason: string | null; source: string }>;
}

export async function runVerticalSlice(o: SliceOptions): Promise<SliceResult> {
  if (o.simulateOwnerApproval && o.persistentDb) {
    throw new Error('refusing to simulate an owner approval in a persistent database; approve in the studio instead');
  }
  const log = o.log ?? (() => {});
  let clock = o.start ?? new Date();
  const now = () => clock;
  const storage = new LocalStorage(o.storageRoot);
  const db = o.db;

  await ensureOwner(db, { id: o.ownerId, displayName: 'Owner' });

  // 1. Fixture topic, sources, claims, evidence, AI verification records.
  const fixture = fixturePacket(clock);
  const existing = await db.select({ id: t.episodes.id }).from(t.episodes).where(like(t.episodes.code, 'LU-TECH-%'));
  const code = existing.length === 0 ? FIXTURE_EPISODE_CODE : `LU-TECH-${String(existing.length + 1).padStart(3, '0')}`;
  log(`[FIXTURE] topic "${fixture.packet.topic.title}" — ${fixture.packet.claims.length} claims, ${fixture.packet.sources.length} sources`);

  const caption = fixture.version.caption.replaceAll(FIXTURE_EPISODE_CODE, code);
  // FIXTURE ONLY: the placeholder reviews are re-bound to the caption carrying this run's code.
  const subject = reviewSubjectSha256({ beats: fixture.version.beats, caption, claimLedgerSha256: claimLedgerSha256(fixture.packet.claims, fixture.packet.evidence) });
  await saveEvidencePacket(db, { ...fixture.packet, reviews: fixture.packet.reviews.map((r) => ({ ...r, id: `${r.id}-${code}`, subjectSha256: subject })) });

  const episodeId = await createEpisode(db, { code, topicId: fixture.packet.topic.id, format: 'everyday_mystery', actor: pipeline, now: clock });
  await transitionEpisode(db, { episodeId, to: 'researching', actor: pipeline, now: clock });
  await transitionEpisode(db, { episodeId, to: 'evidence_ready', actor: pipeline, now: clock });

  // 2. Script version bound to the ledger it was written against.
  const version = await createEpisodeVersion(db, {
    episodeId,
    content: { ...fixture.version, caption, claimLedgerSha256: claimLedgerSha256(fixture.packet.claims, fixture.packet.evidence) },
    actor: pipeline,
    now: clock,
  });
  await saveEpisodeLink(db, { ...fixture.link, episodeId });
  await transitionEpisode(db, { episodeId, to: 'scripted', actor: pipeline, now: clock });

  // 3. Independent verification gates.
  const evidence = evaluateEvidenceGate({ packet: fixture.packet, version, now: clock });
  const creative = evaluateCreativeRules({ version, link: { ...fixture.link, episodeId }, relatedEpisodeLive: false, reviews: fixture.packet.reviews });
  if (!evidence.ok || !creative.ok) {
    const reason = [...evidence.blockers, ...creative.blockers].join('; ');
    await transitionEpisode(db, { episodeId, to: 'blocked', reason, actor: verifier, now: clock });
    throw new Error(`gates blocked the fixture: ${reason}`);
  }
  await transitionEpisode(db, { episodeId, to: 'verified', actor: verifier, now: clock });
  log('evidence gate: pass · creative rules: pass');

  // 4. MOCK voice + MOCK preview render, validated against the delivery spec.
  const work = await mkdtemp(join(tmpdir(), 'life-slice-'));
  const narration = version.beats.map((b) => b.narration).join(' ');
  const tts = await new MockTtsProvider().synthesize({ text: narration, profile: MOCK_VOICE, outPath: join(work, 'MOCK_narration.wav'), sampleRateHz: 48000 });
  await recordCost(db, { provider: 'mock-tts', operation: 'synthesize', units: narration.length, unitType: 'characters', amountMicroUsd: 0, estimated: false, source: 'mock', episodeId, now: clock });

  const base = `episodes/${code}/v${version.versionNumber}`;
  const fileRecord = async (kind: RenderFileInput['kind'], uri: string, mimeType: string): Promise<RenderFileInput> => {
    const path = storage.resolve(uri);
    return { kind, uri, sha256: await sha256File(path), bytes: (await stat(path)).size, mimeType };
  };
  let deliveryUri: string;
  let coverUri: string;
  if (o.renderTemplate) {
    // Full render: 4K master, delivery, cover, captions (minutes, not seconds).
    const r = await renderEpisode({
      template: o.renderTemplate,
      episodeCode: code,
      title: fixture.packet.topic.title,
      script: { versionId: version.id, sha256: version.contentSha256, beats: version.beats },
      claimLedgerSha256: version.claimLedgerSha256,
      narration: { audioPath: tts.audioPath, durationSec: tts.durationSec, source: 'mock', voiceProfile: null },
      outDir: join(work, 'render'),
    });
    if (!r.ok) throw new Error(`render failed validation: ${JSON.stringify(r.validation)}`);
    const put = (p: string, name: string) => storage.put(p, `${base}/${name}`);
    deliveryUri = await put(r.paths.delivery, 'MOCK_delivery.mp4');
    coverUri = await put(r.paths.cover, 'MOCK_cover.jpg');
    const files = [
      await fileRecord('delivery', deliveryUri, 'video/mp4'),
      await fileRecord('cover', coverUri, 'image/jpeg'),
      await fileRecord('master', await put(r.paths.master, 'MOCK_master.mov'), 'video/quicktime'),
      await fileRecord('subtitles_srt', await put(r.paths.srt, 'MOCK_captions.srt'), 'application/x-subrip'),
      await fileRecord('subtitles_vtt', await put(r.paths.vtt, 'MOCK_captions.vtt'), 'text/vtt'),
    ];
    await recordRender(db, { episodeVersionId: version.id, kind: 'full', source: 'mock', manifest: r.manifest, validation: r.validation, files, now: clock });
    log(`MOCK-narrated ${o.renderTemplate} render: master, delivery and cover pass validation`);
  } else {
    let videoPath: string;
    let coverPath: string;
    let validation: unknown = null;
    try {
      ({ videoPath, coverPath } = await renderMockPreview({ outDir: work, durationSec: Math.ceil(version.beats.at(-1)!.endSec), audioPath: tts.audioPath }));
      const spec = validateAgainstSpec(await probeMedia(videoPath), DELIVERY_SPEC);
      if (!spec.ok) throw new Error(`mock preview failed delivery spec: ${spec.issues.map((i) => i.code).join(', ')}`);
      validation = spec;
      log(`MOCK preview rendered and passes ${DELIVERY_SPEC.name}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      // No ffmpeg on this machine: placeholder bytes, clearly labelled.
      videoPath = join(work, 'MOCK_placeholder_no_ffmpeg.mp4');
      coverPath = join(work, 'MOCK_placeholder_no_ffmpeg.jpg');
      await writeFile(videoPath, 'MOCK placeholder: ffmpeg not installed');
      await writeFile(coverPath, 'MOCK placeholder: ffmpeg not installed');
      log('ffmpeg not found: using labelled placeholder media (not spec-validated)');
    }
    deliveryUri = await storage.put(videoPath, `${base}/MOCK_delivery.mp4`);
    coverUri = await storage.put(coverPath, `${base}/MOCK_cover.jpg`);
    await recordRender(db, {
      episodeVersionId: version.id, kind: 'mock_preview', source: 'mock', manifest: { mock: true, kind: 'test-pattern preview' }, validation,
      files: [await fileRecord('delivery', deliveryUri, 'video/mp4'), await fileRecord('cover', coverUri, 'image/jpeg')], now: clock,
    });
  }
  await transitionEpisode(db, { episodeId, to: 'preview_ready', actor: pipeline, now: clock });

  // 5. Release package: the exact thing the owner approves.
  const fileRef = async (uri: string, mimeType: string) => {
    const path = storage.resolve(uri);
    const { size } = await stat(path);
    return { uri, sha256: await sha256File(path), bytes: size, mimeType };
  };
  const pkg = await createReleasePackage(db, {
    actor: pipeline,
    now: clock,
    content: {
      episodeId,
      episodeCode: code,
      episodeVersionId: version.id,
      episodeVersionSha256: version.contentSha256,
      accountId: o.accountId,
      deliveryMedia: await fileRef(deliveryUri, 'video/mp4'),
      cover: await fileRef(coverUri, 'image/jpeg'),
      coverSource: 'first_frame',
      caption,
      disclosure: {
        aiGeneratedVisuals: false,
        syntheticVoice: true,
        platformLabelRequired: false,
        platformLabelMethod: 'not_applicable',
        captionNote: 'Narration uses a synthetic voice.',
      },
      shareToFeed: true,
    },
  });
  await transitionEpisode(db, { episodeId, to: 'awaiting_user_approval', actor: pipeline, now: clock });
  log(`release package ${pkg.id} ready for owner approval (sha256 ${pkg.packageSha256.slice(0, 12)}…)`);

  if (!o.simulateOwnerApproval) {
    return { episodeId, code, releasePackageId: pkg.id, stoppedAt: 'awaiting_user_approval' };
  }

  // 6. SIMULATED owner approval (ephemeral key, in-memory DB only).
  const ephemeral = generateKeyPairSync('ed25519');
  const trustedKeys: TrustedApprovalKeys = { 'SIMULATED-owner-ephemeral': ephemeral.publicKey };
  const notAfter = new Date(clock.getTime() + 48 * 3_600_000).toISOString();
  const signed = signApproval(
    buildApprovalPayload({
      approvalId: `appr_SIMULATED_${pkg.id}`,
      pkg,
      publishWindow: { notBefore: clock.toISOString(), notAfter },
      approvedAt: clock.toISOString(),
      expiresAt: notAfter,
      ownerId: o.ownerId,
      keyId: 'SIMULATED-owner-ephemeral',
    }),
    ephemeral.privateKey,
  );
  await recordApproval(db, { signed, trustedKeys, now: clock });
  log('SIMULATED owner approval recorded (ephemeral key; not a real approval)');

  // 7. MOCK publish through the real worker path (gate → container → publish → confirm).
  const publisher = new MockInstagramPublisher({ clock: now });
  const insights = new MockInsightsReader({ seed: 7 });
  const deps = {
    db,
    publisher,
    insights,
    storage,
    trustedKeys,
    ownerId: o.ownerId,
    targetAccountId: o.accountId,
    evidenceCheck: evidenceCheckFor(db),
    now,
    sleep: async (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    pollIntervalMs: 1_000,
    workerId: 'slice-worker',
    log,
  };
  await workerTick(deps);
  const [pj] = await db.select().from(t.publishJobs).where(eq(t.publishJobs.episodeId, episodeId));
  if (pj?.state !== 'published') throw new Error(`mock publish did not complete: ${pj?.state} ${pj?.stateReason ?? ''}`);
  log(`[MOCK] published ${pj.remoteMediaId} ${pj.permalink}`);

  // 8. MOCK insights at ~1h and ~25h after publication.
  await transitionEpisode(db, { episodeId, to: 'measuring', actor: pipeline, now: clock });
  const [media] = await db.select().from(t.instagramMedia).where(eq(t.instagramMedia.publishJobId, pj.id));
  clock = new Date(clock.getTime() + 30 * 60_000);
  await collectInsights(deps, media!.id); // too early: every value null with a reason
  clock = new Date(clock.getTime() + 25 * 3_600_000);
  await collectInsights(deps, media!.id);
  const snaps = await db.select().from(t.metricSnapshots).where(eq(t.metricSnapshots.instagramMediaId, media!.id));
  const ep = await getEpisode(db, episodeId);
  log(`episode ${code} is ${ep.state}`);
  return {
    episodeId,
    code,
    releasePackageId: pkg.id,
    stoppedAt: 'measuring',
    remoteMediaId: pj.remoteMediaId!,
    permalink: pj.permalink!,
    metrics: snaps.map((s) => ({ metric: s.metric, window: s.window, ageMin: Math.round((s.mediaAgeSec ?? 0) / 60), value: s.value, reason: s.unavailabilityReason, source: s.source })),
  };
}
