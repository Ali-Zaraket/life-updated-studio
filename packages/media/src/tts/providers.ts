import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { VoiceProfile, type TtsProvider, type TtsResult } from '../index';
import { DEFAULT_MICRO_USD_PER_CHAR, PROVIDER_API_ASSUMPTIONS as A, estimateCostMicroUsd, type TtsProviderId } from './assumptions';
import { TtsError, parseRetryAfter, redact } from './errors';
import { buildWavFromPcm16, parseWav } from './wav';

const TARGET_RATE = 48000;
const REQUEST_TIMEOUT_MS = 90_000;

export interface LiveTtsOptions {
  apiKey: string;
  fetch?: typeof fetch;
  baseUrl?: string;
  apiVersion?: string;
  /** Override the UNVERIFIED default price (micro-USD per character). */
  microUsdPerChar?: number;
}

interface SynthInput {
  text: string;
  profile: VoiceProfile;
  outPath: string;
  sampleRateHz: 48000;
}

interface PreparedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface Decoded {
  pcm: Buffer;
  sampleRateHz: number;
}

abstract class LiveTtsProvider implements TtsProvider {
  readonly mode = 'live' as const;
  abstract readonly providerId: TtsProviderId;
  protected abstract readonly requestIdHeaders: readonly string[];
  protected readonly baseUrl: string;
  protected readonly apiVersion: string;
  protected readonly microUsdPerChar: number;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;

  protected constructor(opts: LiveTtsOptions, defaults: { baseUrl: string; apiVersion: string }, providerId: TtsProviderId) {
    if (!opts.apiKey) throw new Error(`${providerId}: apiKey is required`);
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch;
    this.baseUrl = (opts.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '');
    this.apiVersion = opts.apiVersion ?? defaults.apiVersion;
    this.microUsdPerChar = opts.microUsdPerChar ?? DEFAULT_MICRO_USD_PER_CHAR[providerId];
  }

  /** Conservative estimate for authorizeSpend. Price is UNVERIFIED (see PROVIDER_API_ASSUMPTIONS). */
  estimateCostMicroUsd(text: string): number {
    return estimateCostMicroUsd(this.providerId, text, this.microUsdPerChar);
  }

  protected abstract prepare(i: SynthInput): PreparedRequest;
  protected abstract decode(res: Response): Promise<Decoded>;

  /** Never includes the key, in messages or details. */
  protected secure(text: string): string {
    return redact(text, this.apiKey);
  }

  protected fail(kind: TtsError['kind'], message: string, extra: { status?: number; retryAfterSec?: number | null } = {}): TtsError {
    return new TtsError(kind, `${this.providerId}: ${this.secure(message)}`, { provider: this.providerId, ...extra });
  }

  async synthesize(i: SynthInput): Promise<TtsResult> {
    VoiceProfile.parse(i.profile);
    if (i.sampleRateHz !== TARGET_RATE) throw this.fail('sample_rate', `only ${TARGET_RATE} Hz is supported, got ${String(i.sampleRateHz)}`);
    if (i.text.trim().length === 0) throw this.fail('client', 'text is empty');

    const req = this.prepare(i);
    let res: Response;
    try {
      res = await (this.fetchImpl ?? globalThis.fetch)(req.url, {
        method: 'POST',
        headers: req.headers,
        body: req.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw this.fail('transient', `network error: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!res.ok) {
      const snippet = (await res.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
      const tail = snippet ? `: ${snippet}` : '';
      if (res.status === 401 || res.status === 403) throw this.fail('auth', `authentication/authorization failed (HTTP ${res.status})${tail}`, { status: res.status });
      if (res.status === 429) {
        const retryAfterSec = parseRetryAfter(res.headers.get('retry-after'));
        const wait = retryAfterSec === null ? 'no retry-after given' : `retry after ${retryAfterSec}s`;
        throw this.fail('rate_limit', `rate limited (HTTP 429), ${wait}${tail}`, { status: 429, retryAfterSec });
      }
      if (res.status >= 500) throw this.fail('transient', `provider error (HTTP ${res.status})${tail}`, { status: res.status });
      throw this.fail('client', `request rejected (HTTP ${res.status})${tail}`, { status: res.status });
    }

    const providerRequestId = this.requestIdHeaders.map((h) => res.headers.get(h)).find((v) => v) ?? null;
    let decoded: Decoded;
    try {
      decoded = await this.decode(res);
    } catch (e) {
      if (e instanceof TtsError) throw e;
      throw this.fail('bad_response', `could not decode audio: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (decoded.sampleRateHz !== TARGET_RATE) {
      throw this.fail('sample_rate', `provider returned ${decoded.sampleRateHz} Hz audio; ${TARGET_RATE} Hz required (not resampling)`);
    }
    if (decoded.pcm.length === 0 || decoded.pcm.length % 2 !== 0) {
      throw this.fail('bad_response', `empty or misaligned PCM (${decoded.pcm.length} bytes)`);
    }

    await mkdir(dirname(i.outPath), { recursive: true });
    await writeFile(i.outPath, buildWavFromPcm16(decoded.pcm, TARGET_RATE));
    return {
      audioPath: i.outPath,
      sampleRateHz: TARGET_RATE,
      durationSec: decoded.pcm.length / 2 / TARGET_RATE,
      source: 'live',
      providerRequestId,
      estimatedCostMicroUsd: this.estimateCostMicroUsd(i.text),
    };
  }

  protected wavToDecoded(buf: Buffer): Decoded {
    const w = parseWav(buf);
    if (w.channels !== 1 || w.bitsPerSample !== 16) {
      throw this.fail('bad_response', `expected mono 16-bit PCM, got ${w.channels} ch / ${w.bitsPerSample}-bit`);
    }
    return { pcm: Buffer.from(w.pcm), sampleRateHz: w.sampleRateHz };
  }
}

export class ElevenLabsTtsProvider extends LiveTtsProvider {
  readonly providerId = 'elevenlabs' as const;
  protected readonly requestIdHeaders = A.elevenlabs.requestIdHeaders;
  private readonly key: string;
  constructor(opts: LiveTtsOptions) {
    super(opts, { baseUrl: A.elevenlabs.baseUrl, apiVersion: A.elevenlabs.apiVersion }, 'elevenlabs');
    this.key = opts.apiKey;
  }
  protected prepare(i: SynthInput): PreparedRequest {
    return {
      url: `${this.baseUrl}/${this.apiVersion}/text-to-speech/${encodeURIComponent(i.profile.voiceId)}?output_format=pcm_${TARGET_RATE}`,
      headers: { 'xi-api-key': this.key, 'content-type': 'application/json', accept: 'audio/pcm' },
      body: JSON.stringify({ text: i.text, model_id: i.profile.modelVersion }),
    };
  }
  protected async decode(res: Response): Promise<Decoded> {
    // Raw PCM has no header, so the rate cannot be checked from the response: it is whatever pcm_48000 delivers.
    return { pcm: Buffer.from(await res.arrayBuffer()), sampleRateHz: TARGET_RATE };
  }
}

export class GoogleChirpTtsProvider extends LiveTtsProvider {
  readonly providerId = 'google-chirp' as const;
  protected readonly requestIdHeaders = A.google.requestIdHeaders;
  private readonly key: string;
  constructor(opts: LiveTtsOptions) {
    super(opts, { baseUrl: A.google.baseUrl, apiVersion: A.google.apiVersion }, 'google-chirp');
    this.key = opts.apiKey;
  }
  protected prepare(i: SynthInput): PreparedRequest {
    return {
      url: `${this.baseUrl}/${this.apiVersion}/text:synthesize`,
      headers: { 'X-Goog-Api-Key': this.key, 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text: i.text },
        voice: { languageCode: A.google.languageCode, name: i.profile.voiceId },
        audioConfig: { audioEncoding: A.google.audioEncoding, sampleRateHertz: TARGET_RATE },
      }),
    };
  }
  protected async decode(res: Response): Promise<Decoded> {
    const j = (await res.json()) as { audioContent?: unknown };
    if (typeof j.audioContent !== 'string' || j.audioContent.length === 0) throw this.fail('bad_response', 'response has no audioContent');
    return this.wavToDecoded(Buffer.from(j.audioContent, 'base64'));
  }
}

export class CartesiaTtsProvider extends LiveTtsProvider {
  readonly providerId = 'cartesia' as const;
  protected readonly requestIdHeaders = A.cartesia.requestIdHeaders;
  private readonly key: string;
  constructor(opts: LiveTtsOptions) {
    super(opts, { baseUrl: A.cartesia.baseUrl, apiVersion: A.cartesia.apiVersion }, 'cartesia');
    this.key = opts.apiKey;
  }
  protected prepare(i: SynthInput): PreparedRequest {
    return {
      url: `${this.baseUrl}${A.cartesia.path}`,
      headers: { 'X-API-Key': this.key, 'Cartesia-Version': this.apiVersion, 'content-type': 'application/json' },
      body: JSON.stringify({
        model_id: i.profile.modelVersion,
        transcript: i.text,
        voice: { mode: 'id', id: i.profile.voiceId },
        output_format: { ...A.cartesia.outputFormat, sample_rate: TARGET_RATE },
        language: 'en',
      }),
    };
  }
  protected async decode(res: Response): Promise<Decoded> {
    return this.wavToDecoded(Buffer.from(await res.arrayBuffer()));
  }
}
