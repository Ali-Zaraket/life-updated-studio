'use server';

import { redirect } from 'next/navigation';
import { clearSessionCookie, requireOwner, setSessionCookie } from '@/lib/auth';
import { verifyPassphrase } from '@/lib/passphrase';
import { requiredEnv } from '@/lib/env';

// Minimal in-process brute-force throttle (single owner, single process).
const state = { fails: 0, lockedUntil: 0 };

export async function loginAction(fd: FormData): Promise<void> {
  const now = Date.now();
  if (now < state.lockedUntil) redirect('/login?err=locked');
  const pass = fd.get('passphrase');
  const ok = typeof pass === 'string' && pass.length > 0 && pass.length < 1024 && verifyPassphrase(pass, process.env.STUDIO_PASSPHRASE_HASH);
  if (!ok) {
    state.fails += 1;
    if (state.fails >= 5) state.lockedUntil = now + Math.min(15 * 60_000, 30_000 * 2 ** (state.fails - 5));
    await new Promise((r) => setTimeout(r, 750));
    redirect('/login?err=invalid');
  }
  state.fails = 0;
  await setSessionCookie(requiredEnv('LIFE_OWNER_ID'));
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await requireOwner();
  await clearSessionCookie();
  redirect('/login');
}
