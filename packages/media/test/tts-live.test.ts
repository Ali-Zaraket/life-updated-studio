import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AUDITION_SCRIPT_EN_US,
  CartesiaTtsProvider,
  ElevenLabsTtsProvider,
  GoogleChirpTtsProvider,
  TtsError,
  buildWavFromPcm16,
  parseWav,
  planAuditions,
  type TtsProvider,
  type VoiceProfile,
} from '../src/index';

const KEY = 'sk-test-SECRET-1234567890';
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tts-live-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function profile(provider: string, voiceId: string, modelVersion: string): VoiceProfile {
  return {
    id: 'p1', version: 1, provider, voiceId, modelVersion, accent: 'en-US',
    pronunciationDictionary: {}, wpmRange: [135, 165], expressiveSettings: {},
    approvedReferenceClipSha256: null, approvedByOwnerAt: null,
  };
}

const pcm = (rate: number, seconds = 0.5) => Buffer.alloc(Math.round(rate * seconds) * 2, 1);
type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  });
  return { f: f as unknown as typeof fetch, calls, spy: f };
}
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, any>;

interface Case {
  name: string;
  make: (f: typeof fetch) => TtsProvider;
  profile: VoiceProfile;
  ok: (rate: number) => Response;
}
const cases: Case[] = [
  {
    name: 'elevenlabs',
    make: (f) => new ElevenLabsTtsProvider({ apiKey: KEY, fetch: f }),
    profile: profile('elevenlabs', 'VOICE_X', 'model_x'),
    ok: () => new Response(pcm(48000), { status: 200, headers: { 'request-id': 'req-el-1' } }),
  },
  {
    name: 'google-chirp',
    make: (f) => new GoogleChirpTtsProvider({ apiKey: KEY, fetch: f }),
    profile: profile('google-chirp', 'en-US-Chirp3-HD-Test', 'chirp-3-hd'),
    ok: (rate) =>
      new Response(JSON.stringify({ audioContent: buildWavFromPcm16(pcm(rate), rate).toString('base64') }), {
        status: 200, headers: { 'x-goog-request-id': 'req-g-1' },
      }),
  },
  {
    name: 'cartesia',
    make: (f) => new CartesiaTtsProvider({ apiKey: KEY, fetch: f }),
    profile: profile('cartesia', 'uuid-voice', 'sonic-x'),
    ok: (rate) => new Response(buildWavFromPcm16(pcm(rate), rate), { status: 200, headers: { 'x-request-id': 'req-c-1' } }),
  },
];

const input = (c: Case, name: string) => ({ text: 'Hello there.', profile: c.profile, outPath: join(dir, `${name}.wav`), sampleRateHz: 48000 as const });

describe('request shape', () => {
  it('elevenlabs', async () => {
    const c = cases[0]!;
    const { f, calls } = fakeFetch(() => c.ok(48000));
    await c.make(f).synthesize(input(c, 'el'));
    expect(calls[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE_X?output_format=pcm_48000');
    expect(calls[0]!.init.method).toBe('POST');
    expect(hdr(calls[0]!)['xi-api-key']).toBe(KEY);
    expect(body(calls[0]!)).toEqual({ text: 'Hello there.', model_id: 'model_x' });
  });
  it('google', async () => {
    const c = cases[1]!;
    const { f, calls } = fakeFetch(() => c.ok(48000));
    await c.make(f).synthesize(input(c, 'g'));
    expect(calls[0]!.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(calls[0]!.url).not.toContain(KEY);
    expect(hdr(calls[0]!)['X-Goog-Api-Key']).toBe(KEY);
    expect(body(calls[0]!)).toEqual({
      input: { text: 'Hello there.' },
      voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Test' },
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 48000 },
    });
  });
  it('cartesia', async () => {
    const c = cases[2]!;
    const { f, calls } = fakeFetch(() => c.ok(48000));
    await c.make(f).synthesize(input(c, 'c'));
    expect(calls[0]!.url).toBe('https://api.cartesia.ai/tts/bytes');
    expect(hdr(calls[0]!)['X-API-Key']).toBe(KEY);
    expect(hdr(calls[0]!)['Cartesia-Version']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body(calls[0]!)).toMatchObject({
      model_id: 'sonic-x',
      transcript: 'Hello there.',
      voice: { mode: 'id', id: 'uuid-voice' },
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 48000 },
    });
  });
  it('honors baseUrl and apiVersion overrides', async () => {
    const c = cases[1]!;
    const { f, calls } = fakeFetch(() => c.ok(48000));
    await new GoogleChirpTtsProvider({ apiKey: KEY, fetch: f, baseUrl: 'http://x.test/', apiVersion: 'v1beta1' }).synthesize(input(c, 'g2'));
    expect(calls[0]!.url).toBe('http://x.test/v1beta1/text:synthesize');
  });
});

describe.each(cases)('$name output', (c) => {
  it('writes a valid 48 kHz mono 16-bit WAV, labelled live, with request id', async () => {
    const { f } = fakeFetch(() => c.ok(48000));
    const p = c.make(f);
    expect(p.mode).toBe('live');
    const r = await p.synthesize(input(c, `out-${c.name}`));
    expect(r.source).toBe('live');
    expect(r.sampleRateHz).toBe(48000);
    expect(r.providerRequestId).toMatch(/^req-/);
    expect(r.durationSec).toBeCloseTo(0.5, 3);
    expect(r.estimatedCostMicroUsd).toBeGreaterThan(0);
    const w = parseWav(await readFile(r.audioPath));
    expect(w).toMatchObject({ sampleRateHz: 48000, channels: 1, bitsPerSample: 16 });
    expect(w.pcm.length).toBe(48000);
  });

  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [500, 'transient'], [503, 'transient'], [400, 'client'],
  ] as const)('maps HTTP %i to %s and redacts the key', async (status, kind) => {
    const { f } = fakeFetch(
      () => new Response(`bad key ${KEY} and ${encodeURIComponent(KEY)}`, { status, headers: status === 429 ? { 'retry-after': '17' } : {} }),
    );
    const err = await c.make(f).synthesize(input(c, 'err')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TtsError);
    const e = err as TtsError;
    expect(e.kind).toBe(kind);
    expect(e.status).toBe(status);
    expect(e.message).not.toContain(KEY);
    expect(e.message).toContain('[REDACTED]');
    if (status === 429) {
      expect(e.retryAfterSec).toBe(17);
      expect(e.message).toContain('17');
    }
    expect(JSON.stringify(e.details)).not.toContain(KEY);
  });

  it('redacts the key from network errors', async () => {
    const f = (async () => {
      throw new Error(`connect failed using ${KEY}`);
    }) as unknown as typeof fetch;
    const e = (await c.make(f).synthesize(input(c, 'net')).catch((x: unknown) => x)) as TtsError;
    expect(e.kind).toBe('transient');
    expect(e.message).not.toContain(KEY);
  });

  it('rejects a non-48k sampleRateHz request', async () => {
    const { f, spy } = fakeFetch(() => c.ok(48000));
    await expect(c.make(f).synthesize({ ...input(c, 'r'), sampleRateHz: 24000 as unknown as 48000 })).rejects.toMatchObject({ kind: 'sample_rate' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('wrong sample rate', () => {
  it.each([1, 2])('rejects 24 kHz audio loudly instead of resampling (%i)', async (idx) => {
    const c = cases[idx]!;
    const { f } = fakeFetch(() => c.ok(24000));
    const e = (await c.make(f).synthesize(input(c, 'wr')).catch((x: unknown) => x)) as TtsError;
    expect(e.kind).toBe('sample_rate');
    expect(e.message).toMatch(/24000 Hz.*48000 Hz/);
  });
});

describe('cost estimate', () => {
  it('uses overridable per-character prices', () => {
    const f = fakeFetch(() => cases[0]!.ok(48000)).f;
    expect(new ElevenLabsTtsProvider({ apiKey: KEY, fetch: f, microUsdPerChar: 7 }).estimateCostMicroUsd('abcd')).toBe(28);
    expect(new GoogleChirpTtsProvider({ apiKey: KEY, fetch: f }).estimateCostMicroUsd('a'.repeat(1000))).toBe(30_000);
  });
});

describe('audition script and planner', () => {
  it('script is US spelling, about 66 words, with no bracketed tags', () => {
    const words = AUDITION_SCRIPT_EN_US.split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(60);
    expect(words).toBeLessThanOrEqual(72);
    expect(AUDITION_SCRIPT_EN_US).toContain('cubic meter');
    expect(AUDITION_SCRIPT_EN_US).not.toMatch(/metre|\[/);
    expect(AUDITION_SCRIPT_EN_US).toContain('the part that gets me');
  });

  it('plans totals without calling fetch', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const plan = planAuditions({
      voices: [
        { provider: 'google-chirp', voiceId: 'en-US-Chirp3-HD-A', label: 'a' },
        { provider: 'elevenlabs', voiceId: 'abc', label: 'b' },
        { provider: 'cartesia', voiceId: 'REPLACE_ME', label: 'c' },
      ],
      script: 'x'.repeat(100),
      keysPresent: { 'google-chirp': true, elevenlabs: false, cartesia: true },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(plan.clips.map((c) => c.action)).toEqual(['run', 'skip', 'skip']);
    expect(plan.clips[1]!.skipReason).toContain('ELEVENLABS_API_KEY');
    expect(plan.clips[2]!.skipReason).toContain('placeholder');
    expect(plan.runnable).toBe(1);
    expect(plan.totalMicroUsd).toBe(3000);
    expect(plan.clips[0]!.relPath).toBe('auditions/google-chirp/a.wav');
  });

  it('rejects duplicate labels and unsafe labels', () => {
    const keys = { elevenlabs: true };
    const v = { provider: 'elevenlabs', voiceId: 'v', label: 'a' };
    expect(() => planAuditions({ voices: [v, v], script: 'x', keysPresent: keys })).toThrow(/duplicate/);
    expect(() => planAuditions({ voices: [{ ...v, label: '../x' }], script: 'x', keysPresent: keys })).toThrow();
  });
});
