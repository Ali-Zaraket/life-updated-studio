import { getInstagramCredential, sealingKeyFromEnv, type InstagramCredential } from '@life/db';
import { tokenRefreshPlan } from '@life/instagram';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';
import { ALERT_TEXT, ASSUMED_TOKEN_LIFETIME_DAYS, KEY_COMMAND, accountId, instagramMode, oauthConfig } from '@/lib/instagram-config';
import { disconnectAction, pasteTokenAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function InstagramPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  let keyOk = true;
  let key: ReturnType<typeof sealingKeyFromEnv> | null = null;
  try { key = sealingKeyFromEnv(); } catch { keyOk = false; }
  let cred: InstagramCredential | null = null;
  let readError: string | null = null;
  if (key) {
    try { cred = await getInstagramCredential(await getDb(), accountId(), key); } catch { readError = 'Could not read the stored credential.'; }
  }
  const plan = cred ? tokenRefreshPlan({ issuedAt: new Date(cred.issuedAt), expiresAt: new Date(cred.expiresAt), now: new Date() }) : null;
  const mode = instagramMode();
  const oauth = oauthConfig();
  return (
    <main>
      <h1>Instagram connection</h1>
      <Notice ok={ok} err={err} />
      {mode !== 'live' ? <p className="banner">MOCK adapter in use (INSTAGRAM_MODE is not "live"). Nothing is published to Instagram.</p> : null}
      <section className="card stack">
        <h3>Status {cred ? <Badge kind="good">CONNECTED</Badge> : <Badge kind="warn">NOT CONNECTED</Badge>}</h3>
        {readError ? <p className="notice err">{readError}</p> : null}
        {cred ? (
          <>
            <p>Account: <strong>{cred.username ? `@${cred.username}` : '(no username returned)'}</strong> · IG user id <span className="mono">{cred.igUserId}</span> · studio account <span className="mono">{cred.accountId}</span></p>
            <p>Scopes <Badge kind="warn">ASSUMED</Badge>: <span className="mono">{cred.scopes.join(', ')}</span></p>
            <p>Issued {when(cred.issuedAt)} · expires {when(cred.expiresAt)} <Badge kind="warn">ASSUMED {ASSUMED_TOKEN_LIFETIME_DAYS} DAYS</Badge></p>
            {plan?.alert ? <p className="notice err" role="alert">{ALERT_TEXT[plan.alert]}</p> : <p className="muted">No expiry alert.</p>}
            <form action={disconnectAction}><button type="submit" className="danger">Disconnect (delete stored token)</button></form>
          </>
        ) : <p className="muted">No token stored.</p>}
      </section>

      {!keyOk ? (
        <section className="card stack">
          <h3>Sealing key missing</h3>
          <p>Tokens are encrypted with INSTAGRAM_TOKEN_KEY from local config. Create one and add it to <span className="mono">.env.local</span>, then restart the studio:</p>
          <pre className="mono">{KEY_COMMAND}</pre>
          <pre className="mono">INSTAGRAM_TOKEN_KEY=&lt;output&gt;</pre>
        </section>
      ) : null}

      <section className="card stack">
        <h3>Paste a token</h3>
        <p>Paste a long-lived Instagram user access token. When you submit, the studio sends it once to Meta to verify it, then stores it encrypted. It is never shown again, logged or placed in a URL.</p>
        <form action={pasteTokenAction} className="stack" autoComplete="off">
          <label>Long-lived access token<input name="token" type="password" autoComplete="off" required minLength={20} spellCheck={false} disabled={!keyOk} /></label>
          <button type="submit" disabled={!keyOk}>Verify and save</button>
        </form>
        <p className="muted">Expiry is assumed to be {ASSUMED_TOKEN_LIFETIME_DAYS} days from now; Meta's real expiry is not read back.</p>
      </section>

      <section className="card stack">
        <h3>Log in with Instagram</h3>
        <p className="muted">Meta requires an https redirect URI, so the localhost studio normally uses the paste path above. This option appears only when INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET and an https INSTAGRAM_REDIRECT_URI are set.</p>
        {oauth && keyOk ? <p><a href="/auth/instagram/start">Log in with Instagram</a></p> : <p className="muted">Not configured.</p>}
      </section>
    </main>
  );
}
