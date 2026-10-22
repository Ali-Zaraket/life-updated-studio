import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

let cachedRoot: string | null = null;

/** Repo root (the directory holding pnpm-workspace.yaml), independent of the Next cwd. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return (cachedRoot = dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('cannot locate repo root (pnpm-workspace.yaml)');
}

export function resolveFromRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot(), p);
}

export function storageDir(): string {
  return resolveFromRoot(process.env.LIFE_STORAGE_DIR || 'storage');
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}
