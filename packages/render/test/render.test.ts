import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockTtsProvider, type VoiceProfile } from '@life/media';
import { claimLedgerSha256, fixturePacket } from '../../content/src/index';
import { renderEpisode } from '../src/render';
import { TEMPLATE_NAMES } from '../src/theme';

// Real renders: 4K frames in headless Chromium plus ffmpeg. Opt in with RENDER_TESTS=1
// (and REMOTION_BROWSER_EXECUTABLE where the browser is preinstalled).
describe.skipIf(process.env.RENDER_TESTS !== '1')('real render of a 3-second sample per template', () => {
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

  for (const template of TEMPLATE_NAMES) {
    it(
      `${template}`,
      async () => {
        const bundle = fixturePacket(new Date());
        const dir = await mkdtemp(join(tmpdir(), 'life-render-test-'));
        try {
          const text = bundle.version.beats.map((b) => b.narration).join(' ');
          const tts = await new MockTtsProvider().synthesize({ text, profile, outPath: join(dir, 'narration.wav'), sampleRateHz: 48000 });
          const t = Date.now();
          const r = await renderEpisode({
            template,
            episodeCode: 'LU-TECH-001',
            title: bundle.packet.topic.title,
            script: { versionId: 'fixture-v1', sha256: 'a'.repeat(64), beats: bundle.version.beats },
            claimLedgerSha256: claimLedgerSha256(bundle.packet.claims, bundle.packet.evidence),
            narration: { audioPath: tts.audioPath, durationSec: tts.durationSec, source: 'mock', voiceProfile: null },
            outDir: join(dir, 'out'),
            options: { sampleSeconds: 3 },
          });
          console.log(`[render-test] ${template}: ${((Date.now() - t) / 1000).toFixed(1)}s`, JSON.stringify(r.manifest.timing), r.manifest.master.kind);
          const m = r.manifest;
          expect(m.mock).toBe(true);
          expect(m.master.kind).toBe('prores-422');
          expect(r.validation.master.issues).toEqual([]);
          expect(r.validation.delivery.issues).toEqual([]);
          expect(r.validation.loudness.issues).toEqual([]);
          expect(r.validation.cover.issues).toEqual([]);
          expect(m.probes.master.video).toMatchObject({ width: 2160, height: 3840, fps: 30 });
          expect(m.probes.delivery.video).toMatchObject({ codec: 'h264', width: 1080, height: 1920, fps: 30, pixFmt: 'yuv420p' });
          expect(m.probes.delivery.audio).toMatchObject({ codec: 'aac', sampleRateHz: 48000 });
          expect(m.probes.delivery.durationSec).toBeCloseTo(3, 1);
          expect(r.paths.delivery).toContain('MOCK_');
          const onDisk = JSON.parse(await readFile(r.paths.manifest, 'utf8'));
          expect(onDisk.outputs.delivery.sha256).toBe(r.sha256.delivery);
          expect(r.ok).toBe(true);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      },
      900_000,
    );
  }
});
