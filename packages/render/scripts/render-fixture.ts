/**
 * Renders the content fixture with EverydayMystery using MOCK narration.
 * Everything it produces is labelled MOCK (file names and manifest). Not for publication.
 * Usage: pnpm --filter @life/render render:fixture   (set REMOTION_BROWSER_EXECUTABLE where a browser is preinstalled)
 */
import { join, resolve } from 'node:path';
import { MockTtsProvider, type VoiceProfile } from '@life/media';
import { hashCanonical } from '@life/contracts';
import { claimLedgerSha256, fixturePacket, FIXTURE_EPISODE_CODE } from '../../content/src/index';
import { renderEpisode } from '../src/render';
import { RenderError } from '../src/errors';
import { TEMPLATE_VERSION } from '../src/theme';

const template = 'EverydayMystery' as const;
const storage = resolve(process.env.LIFE_STORAGE_DIR ?? '../../storage');
const outDir = join(storage, 'renders', FIXTURE_EPISODE_CODE, `${template}-v${TEMPLATE_VERSION}`);

const profile: VoiceProfile = {
  id: 'mock-voice',
  version: 1,
  provider: 'mock',
  voiceId: 'mock',
  modelVersion: 'mock',
  accent: 'en-US',
  pronunciationDictionary: {},
  wpmRange: [135, 165],
  expressiveSettings: {},
  approvedReferenceClipSha256: null,
  approvedByOwnerAt: null,
};

const bundle = fixturePacket(new Date());
const text = bundle.version.beats.map((b) => b.narration).join(' ');
const tts = await new MockTtsProvider().synthesize({ text, profile, outPath: join(outDir, 'MOCK_narration.wav'), sampleRateHz: 48000 });

try {
  const r = await renderEpisode({
    template,
    episodeCode: FIXTURE_EPISODE_CODE,
    title: bundle.packet.topic.title,
    script: { versionId: 'fixture-v1', sha256: hashCanonical(bundle.version), beats: bundle.version.beats },
    claimLedgerSha256: claimLedgerSha256(bundle.packet.claims, bundle.packet.evidence),
    narration: { audioPath: tts.audioPath, durationSec: tts.durationSec, source: 'mock', voiceProfile: null },
    outDir,
    options: {
      concurrency: process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : undefined,
      onProgress: (s, f) => {
        if (Math.round(f * 100) % 10 === 0) process.stderr.write(`\r[${s}] ${Math.round(f * 100)}%   `);
      },
    },
  });
  const m = r.manifest;
  const v = m.probes.delivery.video!;
  const mv = m.probes.master.video!;
  console.log('\nMOCK render (narration is mock; not for publication)');
  console.log(`out: ${r.outDir}`);
  console.log(`master:   ${mv.codec} ${mv.width}x${mv.height} @${mv.fps} fps, ${m.master.kind}${m.master.nonProRes ? ' (NON-PRORES FALLBACK)' : ''}, ${m.probes.master.durationSec.toFixed(2)}s`);
  console.log(`delivery: ${v.codec} ${v.width}x${v.height} @${v.fps} fps ${v.pixFmt}, audio ${m.probes.delivery.audio?.codec} ${m.probes.delivery.audio?.sampleRateHz} Hz, ${m.probes.delivery.durationSec.toFixed(2)}s, ${m.probes.delivery.bytes} bytes`);
  console.log(`loudness: ${m.validation.loudness.integratedLufs} LUFS, true peak ${m.validation.loudness.truePeakDbtp} dBTP`);
  for (const k of ['master', 'delivery', 'loudness', 'captions', 'cover'] as const) {
    const val = r.validation[k];
    console.log(`validate ${k}: ${val.ok ? 'ok' : 'FAILED'}${val.issues.length ? ` ${JSON.stringify(val.issues)}` : ''}`);
  }
  console.log(`timing ms: ${JSON.stringify(m.timing)}`);
  console.log(`inputsSha256: ${m.inputsSha256}`);
  console.log(`overall: ${r.ok ? 'OK' : 'FAILED'}`);
  process.exitCode = r.ok ? 0 : 1;
} catch (e) {
  if (e instanceof RenderError) console.error(`RenderError stage=${e.stage}: ${e.message}`);
  else console.error(e);
  process.exitCode = 1;
}
