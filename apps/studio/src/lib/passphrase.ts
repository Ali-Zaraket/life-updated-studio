import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison; unequal lengths return false without an early data-dependent exit. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

const MAXMEM = 256 * 1024 * 1024;

/** Hash format: scrypt$N$r$p$saltB64$hashB64 */
export function hashPassphrase(passphrase: string, params = { N: 1 << 15, r: 8, p: 1 }): string {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase.normalize('NFKC'), salt, 32, { ...params, maxmem: MAXMEM });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassphrase(passphrase: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![N, r, p].every(Number.isInteger) || N < 2 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
  try {
    const salt = Buffer.from(parts[4]!, 'base64');
    const expected = Buffer.from(parts[5]!, 'base64');
    if (salt.length < 8 || expected.length < 16) return false;
    const actual = scryptSync(passphrase.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: MAXMEM });
    return safeEqual(actual, expected);
  } catch {
    return false;
  }
}
