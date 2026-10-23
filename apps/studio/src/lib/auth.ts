import { createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requiredEnv } from './env';
import { safeEqual } from './passphrase';

export const SESSION_COOKIE = 'life_studio_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const b64u = (b: Buffer) => b.toString('base64url');

function secret(): Buffer {
  const s = requiredEnv('STUDIO_SESSION_SECRET');
  if (s.length < 32) throw new Error('STUDIO_SESSION_SECRET must be at least 32 characters');
  return Buffer.from(s, 'utf8');
}

function mac(body: string): Buffer {
  return createHmac('sha256', secret()).update(body).digest();
}

export function createSessionToken(ownerId: string, now = Date.now()): { token: string; expires: Date } {
  const exp = now + SESSION_TTL_MS;
  const body = b64u(Buffer.from(JSON.stringify({ sub: ownerId, iat: now, exp }), 'utf8'));
  return { token: `${body}.${b64u(mac(body))}`, expires: new Date(exp) };
}

export function verifySessionToken(token: string | undefined, now = Date.now()): { ownerId: string } | null {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!safeEqual(Buffer.from(sig, 'base64url'), mac(body))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { sub?: unknown; exp?: unknown };
    if (typeof data.sub !== 'string' || typeof data.exp !== 'number' || data.exp <= now) return null;
    if (data.sub !== requiredEnv('LIFE_OWNER_ID')) return null;
    return { ownerId: data.sub };
  } catch {
    return null;
  }
}

export async function setSessionCookie(ownerId: string): Promise<void> {
  const { token, expires } = createSessionToken(ownerId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
}

/** The signed-in owner, or null. Never throws on a bad cookie. */
export async function currentOwner(): Promise<{ ownerId: string } | null> {
  try {
    return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * Call at the top of EVERY page, route handler and server action that reads or
 * writes data. Redirects to /login when there is no valid owner session.
 */
export async function requireOwner(): Promise<{ ownerId: string }> {
  const owner = await currentOwner();
  if (!owner) redirect('/login');
  return owner;
}
