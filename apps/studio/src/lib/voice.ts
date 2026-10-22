import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { storageDir } from './env';
import { resolveInStorage } from './media';

export interface AuditionClip {
  /** manifest path relative to the storage root, '/'-separated */
  manifestRel: string;
  index: number;
  provider: string;
  voiceLabel: string;
  voiceId: string;
  /** clip path relative to the storage root, '/'-separated */
  fileRel: string;
  durationSeconds: number | null;
  costEstimateMicroUsd: number | null;
  sha256: string;
  mock: boolean;
}

const MAX_CLIP_BYTES = 50 * 1024 * 1024;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

async function findManifests(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 4 || out.length > 50) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await findManifests(p, depth + 1, out);
    else if (e.isFile() && e.name === 'manifest.json') out.push(p);
  }
}

/**
 * Manifest shape tolerated: `{ provider?, mock?, clips: [{ provider?, voiceLabel|label, voiceId, file|path,
 * durationSeconds, costEstimateMicroUsd | costEstimateUsd, sha256 }] }` (or a bare array of clips).
 * The format is not yet fixed by the audition script; unknown fields are ignored.
 */
export function parseManifest(manifestRel: string, raw: unknown): AuditionClip[] {
  const top = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(raw) ? raw : Array.isArray(top.clips) ? top.clips : [];
  const baseDir = manifestRel.includes('/') ? manifestRel.slice(0, manifestRel.lastIndexOf('/')) : '';
  const clips: AuditionClip[] = [];
  list.forEach((c, index) => {
    if (!c || typeof c !== 'object') return;
    const r = c as Record<string, unknown>;
    const file = str(r.file) ?? str(r.path);
    const sha256 = str(r.sha256)?.toLowerCase();
    const voiceId = str(r.voiceId);
    const provider = str(r.provider) ?? str(top.provider);
    if (!file || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) || !voiceId || !provider) return;
    if (file.startsWith('/') || file.split(/[\\/]/).includes('..')) return;
    const costUsd = num(r.costEstimateUsd);
    clips.push({
      manifestRel,
      index,
      provider,
      voiceLabel: str(r.voiceLabel) ?? str(r.label) ?? voiceId,
      voiceId,
      fileRel: (baseDir ? `${baseDir}/` : '') + file.replace(/\\/g, '/'),
      durationSeconds: num(r.durationSeconds),
      costEstimateMicroUsd: num(r.costEstimateMicroUsd) ?? (costUsd === null ? null : Math.round(costUsd * 1_000_000)),
      sha256,
      mock: r.mock === true || top.mock === true,
    });
  });
  return clips;
}

/** All clips from storage/auditions/**\/manifest.json. A missing directory yields an empty list. */
export async function listAuditionClips(): Promise<AuditionClip[]> {
  const rootReal = await realpath(storageDir()).catch(() => null);
  if (!rootReal) return [];
  const auditions = await realpath(join(rootReal, 'auditions')).catch(() => null);
  if (!auditions || relative(rootReal, auditions).startsWith('..')) return [];
  const found: string[] = [];
  await findManifests(auditions, 0, found);
  const clips: AuditionClip[] = [];
  for (const m of found.sort()) {
    const rel = relative(rootReal, m).split(sep).join('/');
    try {
      clips.push(...parseManifest(rel, JSON.parse(await readFile(m, 'utf8'))));
    } catch {
      // unreadable manifest: skipped
    }
  }
  return clips;
}

export async function loadClip(manifestRel: string, index: number): Promise<AuditionClip | null> {
  if (!/^auditions\/(?:[^\\:\0]+\/)*manifest\.json$/.test(manifestRel) || manifestRel.split('/').includes('..')) return null;
  // manifest.json has no media type, so it is resolved here rather than via resolveInStorage
  const rootReal = await realpath(storageDir()).catch(() => null);
  if (!rootReal) return null;
  const real = await realpath(join(rootReal, ...manifestRel.split('/'))).catch(() => null);
  if (!real || relative(rootReal, real).startsWith('..') || dirname(real) === rootReal) return null;
  try {
    const clips = parseManifest(manifestRel, JSON.parse(await readFile(real, 'utf8')));
    return clips.find((c) => c.index === index) ?? null;
  } catch {
    return null;
  }
}

/** Recomputes the clip's sha256 from the file inside storage. Null when the file is missing/unsafe/too large. */
export async function hashClipFile(fileRel: string): Promise<string | null> {
  const f = await resolveInStorage(fileRel.split('/'));
  if (!f || f.size > MAX_CLIP_BYTES) return null;
  return createHash('sha256').update(await readFile(f.file)).digest('hex');
}

export const mediaUrl = (fileRel: string) => '/media/' + fileRel.split('/').map(encodeURIComponent).join('/');
