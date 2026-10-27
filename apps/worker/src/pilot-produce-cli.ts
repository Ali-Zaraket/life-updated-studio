/**
 *   pnpm pilot:produce LU-TECH-002                   dry run: narrator, cost estimate and what would be made. Calls nothing.
 *   pnpm pilot:produce LU-TECH-002 --confirm-spend   narrates with the approved voice (inside the spending cap), renders,
 *                                                    and creates the release package. Stops at awaiting_user_approval.
 *   ... --accept-longer                              render even if the narration runs past the script's planned length.
 *   ... --narrate-only                               record (or reuse) the narration and stop: no render, no package.
 */
import { resolve } from 'node:path';
import { openPostgresDb } from '@life/db';
import { API_KEY_ENV, CartesiaTtsProvider, ElevenLabsTtsProvider, GoogleChirpTtsProvider, type TtsProviderId, type VoiceProfile } from '@life/media';
import { renderEpisode } from '@life/render';
import { producePilot } from './pilot-produce';
import { LocalStorage } from './storage';

const code = process.argv[2];
if (!code || code.startsWith('--')) throw new Error('usage: pnpm pilot:produce <episode code, e.g. LU-TECH-002> [--confirm-spend]');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

function tts(profile: VoiceProfile) {
  const id = profile.provider as TtsProviderId;
  const apiKey = process.env[API_KEY_ENV[id]];
  if (!apiKey) throw new Error(`${API_KEY_ENV[id]} is not set in .env.local`);
  if (id === 'elevenlabs') return new ElevenLabsTtsProvider({ apiKey });
  if (id === 'google-chirp') return new GoogleChirpTtsProvider({ apiKey });
  return new CartesiaTtsProvider({ apiKey });
}

const { db, close } = await openPostgresDb(url);
try {
  const r = await producePilot(
    { db, storage: new LocalStorage(resolve(process.env.LIFE_STORAGE_DIR ?? 'storage')), tts, render: renderEpisode, now: () => new Date(), log: (line) => console.log(`  ${line}`) },
    {
      code,
      accountId: process.env.INSTAGRAM_ACCOUNT_ID ?? 'mock-account',
      confirmSpend: process.argv.includes('--confirm-spend'),
      acceptLonger: process.argv.includes('--accept-longer'),
      narrateOnly: process.argv.includes('--narrate-only'),
    },
  );
  console.log(`\n${code}: ${r.state} — ${r.message}`);
  if (r.state !== 'dry_run' && r.state !== 'narrated' && r.state !== 'awaiting_user_approval') process.exitCode = 1;
} finally {
  await close();
}
