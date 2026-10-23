/**
 * EVERY value here is UNVERIFIED-until-first-live-call.
 *
 * It was written from memory of each vendor's REST API, in a session with no network access to
 * vendor sites and no API keys (see docs/research/tts-candidates.md, "Read this first"). The owner's first
 * `--confirm-spend` audition is the verification. If a provider returns 4xx/5xx or a different sample rate,
 * fix the constant here (one place) and re-run; do not work around it in the adapters.
 *
 * Prices are indicative, per character, in micro-USD (1e-6 USD), and also UNVERIFIED.
 */
export const PROVIDER_API_ASSUMPTIONS = {
  elevenlabs: {
    status: 'UNVERIFIED-until-first-live-call',
    baseUrl: 'https://api.elevenlabs.io', // UNVERIFIED
    path: '/v1/text-to-speech/{voice_id}', // UNVERIFIED
    outputFormatQuery: 'output_format=pcm_48000', // UNVERIFIED; docs research says pcm_48000 exists, tier needed unknown
    authHeader: 'xi-api-key', // UNVERIFIED
    bodyFields: ['text', 'model_id'], // UNVERIFIED
    defaultModelId: 'eleven_multilingual_v2', // UNVERIFIED: newest stable model must be chosen by the owner
    responseIs: 'raw 16-bit little-endian mono PCM at 48 kHz, no header', // UNVERIFIED; rate cannot be checked from the response
    requestIdHeaders: ['request-id', 'x-request-id'], // UNVERIFIED
    apiVersion: 'v1', // UNVERIFIED
    // Placeholder: derived from plan prices in docs/research/tts-candidates.md (Starter $6 / 30,000 credits = 200 micro-USD
    // per credit) and rounded up to the most expensive reading. UNVERIFIED; 1 credit == 1 character is assumed.
    microUsdPerChar: 200,
  },
  google: {
    status: 'UNVERIFIED-until-first-live-call',
    baseUrl: 'https://texttospeech.googleapis.com', // UNVERIFIED
    path: '/{apiVersion}/text:synthesize', // UNVERIFIED
    apiVersion: 'v1', // UNVERIFIED
    authHeader: 'X-Goog-Api-Key', // UNVERIFIED (API key sent as header, never in the URL)
    bodyFields: ['input.text', 'voice.languageCode', 'voice.name', 'audioConfig.audioEncoding', 'audioConfig.sampleRateHertz'], // UNVERIFIED
    languageCode: 'en-US',
    audioEncoding: 'LINEAR16', // UNVERIFIED
    defaultVoiceNameShape: 'en-US-Chirp3-HD-<Name>', // UNVERIFIED
    defaultModelVersion: 'chirp-3-hd', // label only
    responseIs: 'JSON {audioContent: base64 WAV (LINEAR16 with header)}; whether Chirp 3 HD honors 48000 is UNVERIFIED',
    requestIdHeaders: ['x-goog-request-id', 'x-request-id'], // UNVERIFIED
    // docs/research/tts-candidates.md: $30 per 1M characters (read from Google's pricing page via search summary).
    microUsdPerChar: 30,
  },
  cartesia: {
    status: 'UNVERIFIED-until-first-live-call',
    baseUrl: 'https://api.cartesia.ai', // UNVERIFIED
    path: '/tts/bytes', // UNVERIFIED
    apiVersion: '2025-04-16', // UNVERIFIED: the Cartesia-Version header date
    authHeader: 'X-API-Key', // UNVERIFIED
    versionHeader: 'Cartesia-Version', // UNVERIFIED
    bodyFields: ['model_id', 'transcript', 'voice.mode', 'voice.id', 'output_format.container', 'output_format.encoding', 'output_format.sample_rate', 'language'], // UNVERIFIED
    defaultModelId: 'sonic-3', // UNVERIFIED (research mentions sonic-3 / sonic-3.5)
    outputFormat: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 48000 }, // UNVERIFIED
    requestIdHeaders: ['x-request-id', 'request-id'], // UNVERIFIED
    // Placeholder: research prices are plan-based and in conflict; credits per character unknown. Deliberately high.
    microUsdPerChar: 100,
  },
} as const;

export type TtsProviderId = 'elevenlabs' | 'google-chirp' | 'cartesia';

export const TTS_PROVIDER_IDS: readonly TtsProviderId[] = ['elevenlabs', 'google-chirp', 'cartesia'];

/** Default per-character prices (micro-USD). UNVERIFIED; see PROVIDER_API_ASSUMPTIONS. */
export const DEFAULT_MICRO_USD_PER_CHAR: Record<TtsProviderId, number> = {
  elevenlabs: PROVIDER_API_ASSUMPTIONS.elevenlabs.microUsdPerChar,
  'google-chirp': PROVIDER_API_ASSUMPTIONS.google.microUsdPerChar,
  cartesia: PROVIDER_API_ASSUMPTIONS.cartesia.microUsdPerChar,
};

export const DEFAULT_MODEL_VERSION: Record<TtsProviderId, string> = {
  elevenlabs: PROVIDER_API_ASSUMPTIONS.elevenlabs.defaultModelId,
  'google-chirp': PROVIDER_API_ASSUMPTIONS.google.defaultModelVersion,
  cartesia: PROVIDER_API_ASSUMPTIONS.cartesia.defaultModelId,
};

export function estimateCostMicroUsd(providerId: TtsProviderId, text: string, microUsdPerChar = DEFAULT_MICRO_USD_PER_CHAR[providerId]): number {
  return Math.ceil(Array.from(text).length * microUsdPerChar);
}
