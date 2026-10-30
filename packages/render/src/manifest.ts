import { hashCanonical } from '@life/contracts';
import { COLOR_SETTINGS, FONT, TEMPLATE_VERSION, type TemplateName } from './theme';
import type { CaptionCue } from './captions';
import type { ProbeResult, SpecIssue } from '@life/media';

export interface FontRecord {
  family: string;
  weight: number;
  file: string;
  sha256: string;
  license: 'OFL-1.1';
}

export interface ValidationRecord {
  ok: boolean;
  issues: SpecIssue[];
}

export interface RenderManifest {
  schema: 'life.render-manifest.v1';
  mock: boolean;
  /** Which fixed label to show wherever this manifest is displayed. */
  label: 'MOCK' | 'LIVE';
  sample: { seconds: number } | null;
  episodeCode: string;
  script: { versionId: string; sha256: string };
  claimLedgerSha256: string;
  /** 'external-cut': the picture was made outside the templates (e.g. Blender) and packaged by packageExternalCut. */
  template: { name: TemplateName | 'external-cut'; version: number };
  fonts: FontRecord[];
  voice: { profileId: string; profileVersion: number | null } | 'mock';
  narration: { sha256: string; durationSec: number; source: 'mock' | 'live' };
  captions: { cuesSha256: string; cueCount: number; wordsPerMinute: number };
  color: typeof COLOR_SETTINGS;
  remotionVersion: string;
  master: { kind: 'prores-422' | 'h264-mezzanine' | 'external-cut-1080'; nonProRes: boolean; fallbackReason: string | null; codecProfile: string };
  timing: { startedAt: string; bundleMs: number; masterMs: number; deliveryMs: number; coverMs: number; totalMs: number };
  outputs: Record<'master' | 'delivery' | 'cover' | 'srt' | 'vtt', { path: string; sha256: string; bytes: number }>;
  probes: { master: ProbeResult; delivery: ProbeResult };
  validation: {
    master: ValidationRecord;
    delivery: ValidationRecord;
    loudness: ValidationRecord & { integratedLufs: number; truePeakDbtp: number };
    captions: { ok: boolean; issues: { code: string; cueIndex: number; message: string }[] };
  };
  /** Present only for external cuts: what made the picture, and the hash of the cut file that was packaged. */
  externalCut?: { tool: string; sourceSha256: string; sourceBytes: number };
  /** Hash of the deterministic inputs only (excludes timing, paths and outputs). */
  inputsSha256: string;
}

export interface ManifestInputs {
  mock: boolean;
  episodeCode: string;
  scriptVersionId: string;
  scriptSha256: string;
  claimLedgerSha256: string;
  template: TemplateName;
  fonts: FontRecord[];
  voice: RenderManifest['voice'];
  narrationSha256: string;
  captionCues: CaptionCue[];
  wordsPerMinute: number;
  remotionVersion: string;
  sampleSeconds: number | null;
}

export const cuesSha256 = (cues: CaptionCue[]): string => hashCanonical(cues);

/** Deterministic: same inputs (any key order) give the same hash; timing and paths never enter it. */
export function inputsSha256(i: ManifestInputs): string {
  return hashCanonical({
    mock: i.mock,
    episodeCode: i.episodeCode,
    script: { versionId: i.scriptVersionId, sha256: i.scriptSha256 },
    claimLedgerSha256: i.claimLedgerSha256,
    template: { name: i.template, version: TEMPLATE_VERSION },
    fonts: [...i.fonts].sort((a, b) => a.weight - b.weight),
    fontFamily: FONT.family,
    voice: i.voice,
    narrationSha256: i.narrationSha256,
    cuesSha256: cuesSha256(i.captionCues),
    wordsPerMinute: i.wordsPerMinute,
    color: COLOR_SETTINGS,
    remotionVersion: i.remotionVersion,
    sampleSeconds: i.sampleSeconds,
  });
}
