import { DomainError } from '@life/db';
import { redirect } from 'next/navigation';

/** Redirects back to `path` with a notice. Only DomainError messages (written for humans, no secrets) pass through. */
export function done(path: string, notice: string): never {
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=${encodeURIComponent(notice)}`);
}

export function fail(path: string, e: unknown): never {
  // redirect() throws a control-flow error that must propagate.
  if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_')) throw e;
  const msg = e instanceof DomainError ? `${e.code}: ${e.message}` : e instanceof UserError ? e.message : 'The action failed. Nothing was changed.';
  redirect(`${path}${path.includes('?') ? '&' : '?'}err=${encodeURIComponent(msg)}`);
}

export class UserError extends Error {
  override readonly name = 'UserError';
}
