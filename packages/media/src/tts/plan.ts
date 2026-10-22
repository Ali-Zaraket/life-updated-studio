import { z } from 'zod';
import { DEFAULT_MICRO_USD_PER_CHAR, DEFAULT_MODEL_VERSION, TTS_PROVIDER_IDS, estimateCostMicroUsd, type TtsProviderId } from './assumptions';

export const AuditionVoiceEntry = z.object({
  provider: z.enum(TTS_PROVIDER_IDS as unknown as [TtsProviderId, ...TtsProviderId[]]),
  voiceId: z.string().min(1),
  label: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'label must be filename-safe: letters, digits, _ and -'),
  /** Optional override of the default model id/version recorded in the voice profile. */
  modelVersion: z.string().min(1).optional(),
});
export type AuditionVoiceEntry = z.infer<typeof AuditionVoiceEntry>;
export const AuditionVoices = z.array(AuditionVoiceEntry);

export const API_KEY_ENV: Record<TtsProviderId, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  'google-chirp': 'GOOGLE_TTS_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
};

export interface PlannedClip {
  provider: TtsProviderId;
  voiceId: string;
  label: string;
  modelVersion: string;
  characters: number;
  estimatedMicroUsd: number;
  /** storage-relative path: auditions/<provider>/<label>.wav */
  relPath: string;
  action: 'run' | 'skip';
  skipReason: string | null;
}

export interface AuditionPlan {
  clips: PlannedClip[];
  runnable: number;
  totalMicroUsd: number;
}

const PLACEHOLDER = /^(REPLACE|PLACEHOLDER|YOUR)[_-]/i;

/** Pure: no network, no env, no filesystem. `keysPresent` says which providers have an API key. */
export function planAuditions(input: {
  voices: unknown;
  script: string;
  keysPresent: Partial<Record<TtsProviderId, boolean>>;
  pricesMicroUsdPerChar?: Partial<Record<TtsProviderId, number>>;
}): AuditionPlan {
  const voices = AuditionVoices.parse(input.voices);
  const seen = new Set<string>();
  const characters = Array.from(input.script).length;
  const clips: PlannedClip[] = voices.map((v) => {
    const relPath = `auditions/${v.provider}/${v.label}.wav`;
    if (seen.has(relPath)) throw new Error(`duplicate provider/label in voices file: ${v.provider}/${v.label}`);
    seen.add(relPath);
    let skipReason: string | null = null;
    if (!input.keysPresent[v.provider]) skipReason = `${API_KEY_ENV[v.provider]} is not set`;
    else if (PLACEHOLDER.test(v.voiceId)) skipReason = 'voiceId is still a placeholder';
    const price = input.pricesMicroUsdPerChar?.[v.provider] ?? DEFAULT_MICRO_USD_PER_CHAR[v.provider];
    return {
      provider: v.provider,
      voiceId: v.voiceId,
      label: v.label,
      modelVersion: v.modelVersion ?? DEFAULT_MODEL_VERSION[v.provider],
      characters,
      estimatedMicroUsd: estimateCostMicroUsd(v.provider, input.script, price),
      relPath,
      action: skipReason ? 'skip' : 'run',
      skipReason,
    };
  });
  const run = clips.filter((c) => c.action === 'run');
  return { clips, runnable: run.length, totalMicroUsd: run.reduce((s, c) => s + c.estimatedMicroUsd, 0) };
}
