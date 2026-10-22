import { redirect } from 'next/navigation';
import { currentOwner } from '@/lib/auth';
import { loginAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  if (await currentOwner()) redirect('/');
  const { err } = await searchParams;
  return (
    <main className="narrow">
      <h1>LIFE: UPDATED. studio</h1>
      <form action={loginAction} className="card stack">
        <label>
          Owner passphrase
          <input type="password" name="passphrase" autoComplete="current-password" required autoFocus />
        </label>
        {err === 'locked' ? <p className="error">Too many attempts. Wait and try again.</p> : null}
        {err === 'invalid' ? <p className="error">Sign-in failed.</p> : null}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
