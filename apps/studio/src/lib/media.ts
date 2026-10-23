import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { storageDir } from './env';

export const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

export function contentTypeFor(path: string): string | null {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? null;
}

function validSegments(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    segments.every((s) => s !== '' && s !== '.' && s !== '..' && !/[\\\0:]/.test(s)) &&
    !isAbsolute(segments.join('/'))
  );
}

/**
 * Resolves URL path segments to a real file inside LIFE_STORAGE_DIR.
 * Returns null for anything that is not a regular file strictly inside the storage root
 * (traversal, absolute paths, symlink escapes, unknown types).
 */
export async function resolveInStorage(segments: string[]): Promise<{ file: string; size: number; contentType: string } | null> {
  if (!validSegments(segments)) return null;
  const rootReal = await realpath(storageDir()).catch(() => null);
  if (!rootReal) return null;
  const candidate = resolve(rootReal, ...segments);
  const real = await realpath(candidate).catch(() => null);
  if (!real) return null;
  const rel = relative(rootReal, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null;
  const contentType = contentTypeFor(real);
  if (!contentType) return null;
  const st = await stat(real).catch(() => null);
  if (!st?.isFile()) return null;
  return { file: real, size: st.size, contentType };
}

/** Turns a stored media uri into a /media/ URL, or null if it is not a plain storage-relative path. */
export function mediaHref(uri: string): string | null {
  let p = uri.startsWith('storage://') ? uri.slice('storage://'.length) : uri;
  if (isAbsolute(p)) {
    const rel = relative(storageDir(), p);
    if (rel.startsWith('..') || isAbsolute(rel)) return null;
    p = rel;
  }
  const segments = p.split('/');
  if (!validSegments(segments) || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  return '/media/' + segments.map(encodeURIComponent).join('/');
}
