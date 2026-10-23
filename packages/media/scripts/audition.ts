/**
 * Owner's local TTS audition runner. Stock voices only. No cloning.
 *
 *   pnpm audition                 dry run: prints planned clips and estimated cost, makes NO request
 *   pnpm audition --confirm-spend real calls (needs API keys in env, DATABASE_URL, a spending cap set in the studio)
 *
 * Options: --voices <file>  (default: <repo>/auditions/voices.json; see packages/media/scripts/voices.example.json)
 *
 * Costs are estimates from UNVERIFIED per-character prices. Keys are read from env only and never printed.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_KEY_ENV,
  AUDITION_SCRIPT_EN_US,
  CartesiaTtsProvider,
  ElevenLabsTtsProvider,
  GoogleChirpTtsProvider,
  TtsError,
  VoiceProfile,
  planAuditions,
  sha256File,
  type PlannedClip,
  type TtsProvider,
  type TtsProviderId,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;

function parseArgs(argv: string[]): { confirmSpend: boolean; voicesPath: string } {
  let confirmSpend = false;
  let voicesPath = join(repoRoot, 'auditions', 'voices.json');
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k]!;
    if (a === '--confirm-spend') confirmSpend = true;
    else if (a === '--voices') voicesPath = resolve(argv[++k] ?? '');
    else throw new Error(`unknown argument: ${a}`);
  }
  return { confirmSpend, voicesPath };
}

function makeProvider(id: TtsProviderId, apiKey: string): TtsProvider & { estimateCostMicroUsd(t: string): number } {
  if (id === 'elevenlabs') return new ElevenLabsTtsProvider({ apiKey });
  if (id === 'google-chirp') return new GoogleChirpTtsProvider({ apiKey });
  return new CartesiaTtsProvider({ apiKey });
}

function printPlan(plan: ReturnType<typeof planAuditions>): void {
  console.log(`Script: ${AUDITION_SCRIPT_EN_US.split(/\s+/).length} words, ${Array.from(AUDITION_SCRIPT_EN_US).length} characters (FIXTURE / not for publication)`);
  for (const c of plan.clips) {
    const status = c.action === 'run' ? 'PLAN' : `SKIP (${c.skipReason})`;
    console.log(`  [${status}] ${c.provider} / ${c.label} voice=${c.voiceId} model=${c.modelVersion} ~${usd(c.estimatedMicroUsd)} (estimate, UNVERIFIED price)`);
  }
  console.log(`Runnable clips: ${plan.runnable}. Estimated total: ${usd(plan.totalMicroUsd)}`);
}

interface ManifestEntry {
  provider: string;
  voiceId: string;
  label: string;
  file: string;
  sha256: string;
  durationSec: number;
  sampleRateHz: number;
  profileId: string;
  profileVersion: number;
  modelVersion: string;
  providerRequestId: string | null;
  characters: number;
  estimatedCostMicroUsd: number;
  costEstimated: true;
  source: 'live';
  createdAt: string;
}

async function main(): Promise<number> {
  const { confirmSpend, voicesPath } = parseArgs(process.argv.slice(2));

  let rawVoices: unknown;
  try {
    rawVoices = JSON.parse(await readFile(voicesPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read voices file ${voicesPath}: ${e instanceof Error ? e.message : String(e)}`);
    console.error('Copy packages/media/scripts/voices.example.json to auditions/voices.json and fill in real stock voice IDs.');
    return 2;
  }

  const keysPresent = Object.fromEntries((Object.keys(API_KEY_ENV) as TtsProviderId[]).map((p) => [p, Boolean(process.env[API_KEY_ENV[p]])]));
  const plan = planAuditions({ voices: rawVoices, script: AUDITION_SCRIPT_EN_US, keysPresent });
  printPlan(plan);

  if (!confirmSpend) {
    console.log('\nDRY RUN: no request was made and nothing was recorded. Add --confirm-spend to run for real.');
    return 0;
  }
  if (plan.runnable === 0) {
    console.error('Nothing runnable: set API keys in env and replace placeholder voice IDs.');
    return 2;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required with --confirm-spend (spend is checked and recorded in the studio database).');
    return 2;
  }

  // Relative import: @life/db is not a dependency of @life/media (lead may wire it).
  const dbm = await import('../../db/src/index');
  const { db, close } = await dbm.openPostgresDb(databaseUrl);
  const storageRoot = resolve(process.env.LIFE_STORAGE_DIR ?? join(repoRoot, 'storage'));
  const actor = { kind: 'system' as const, component: 'audition' };
  const manifest: ManifestEntry[] = [];
  const blockedProviders = new Set<string>();
  let exitCode = 0;

  try {
    for (const clip of plan.clips as PlannedClip[]) {
      if (clip.action !== 'run') continue;
      if (blockedProviders.has(clip.provider)) {
        console.log(`  skip ${clip.provider}/${clip.label}: provider stopped earlier in this run`);
        continue;
      }
      const provider = makeProvider(clip.provider, process.env[API_KEY_ENV[clip.provider]]!);
      const estimate = provider.estimateCostMicroUsd(AUDITION_SCRIPT_EN_US);

      const decision = await dbm.authorizeSpend(db, { provider: clip.provider, operation: 'audition_tts', estimatedMicroUsd: estimate });
      if (!decision.ok) {
        console.error(`STOP: spend refused (${decision.reason}): ${decision.message}`);
        exitCode = 3;
        break;
      }
      if (decision.warning) console.warn(`WARNING: ${decision.warning}`);

      const version = Math.floor(Date.now() / 1000);
      const profileId = `audition-${clip.provider}-${clip.label}`;
      const profile = VoiceProfile.parse({
        id: profileId,
        version,
        provider: clip.provider,
        voiceId: clip.voiceId,
        modelVersion: clip.modelVersion,
        accent: 'en-US',
        pronunciationDictionary: {},
        wpmRange: [135, 165],
        expressiveSettings: {},
        approvedReferenceClipSha256: null,
        approvedByOwnerAt: null,
      });
      const outPath = join(storageRoot, clip.relPath);

      try {
        console.log(`  calling ${clip.provider}/${clip.label} ...`);
        const r = await provider.synthesize({ text: AUDITION_SCRIPT_EN_US, profile, outPath, sampleRateHz: 48000 });
        const now = new Date();
        await dbm.recordCost(db, {
          provider: clip.provider,
          operation: 'audition_tts',
          units: Array.from(AUDITION_SCRIPT_EN_US).length,
          unitType: 'characters',
          amountMicroUsd: r.estimatedCostMicroUsd,
          estimated: true,
          source: 'live',
          now,
        });
        await dbm.saveVoiceProfile(db, { id: profileId, version, profile, actor, now });
        manifest.push({
          provider: clip.provider,
          voiceId: clip.voiceId,
          label: clip.label,
          file: clip.relPath,
          sha256: await sha256File(outPath),
          durationSec: r.durationSec,
          sampleRateHz: r.sampleRateHz,
          profileId,
          profileVersion: version,
          modelVersion: clip.modelVersion,
          providerRequestId: r.providerRequestId,
          characters: Array.from(AUDITION_SCRIPT_EN_US).length,
          estimatedCostMicroUsd: r.estimatedCostMicroUsd,
          costEstimated: true,
          source: 'live',
          createdAt: now.toISOString(),
        });
        console.log(`    ok: ${r.durationSec.toFixed(1)} s, ~${usd(r.estimatedCostMicroUsd)} -> ${outPath}`);
      } catch (e) {
        exitCode = 1;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`    FAILED ${clip.provider}/${clip.label}: ${msg}`);
        if (e instanceof TtsError && (e.kind === 'auth' || e.kind === 'rate_limit' || e.kind === 'sample_rate')) {
          blockedProviders.add(clip.provider);
        }
      }
    }
  } finally {
    await close();
    if (manifest.length > 0) {
      const manifestPath = join(storageRoot, 'auditions', 'manifest.json');
      let prior: unknown[] = [];
      try {
        const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (Array.isArray(parsed)) prior = parsed;
      } catch {
        /* first run */
      }
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify([...prior, ...manifest], null, 2));
      console.log(`Manifest: ${manifestPath}`);
    }
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);
