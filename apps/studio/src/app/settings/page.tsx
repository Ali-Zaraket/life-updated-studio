import { getSettings } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';
import { pauseAction, resumeAction, spendingStopAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  const s = await getSettings(await getDb());
  const cap = s.spendingCapMicroUsd;
  return (
    <main>
      <h1>Settings</h1>
      <Notice ok={ok} err={err} />
      <section className="card stack">
        <h3>Publishing {s.publishingPaused ? <Badge kind="bad">PAUSED</Badge> : <Badge kind="good">ACTIVE</Badge>}</h3>
        {s.publishingPaused ? (
          <>
            <p>Paused: {s.pausedReason}</p>
            <form action={resumeAction}><button type="submit">Resume publishing</button></form>
          </>
        ) : (
          <form action={pauseAction} className="stack">
            <label>Reason (required)<input name="reason" required minLength={3} maxLength={500} /></label>
            <button type="submit" className="danger">Pause all publishing</button>
          </form>
        )}
      </section>
      <section className="card stack">
        <h3>Spending {s.spendingStopped ? <Badge kind="bad">STOPPED</Badge> : <Badge kind="good">NOT STOPPED</Badge>}</h3>
        <p>
          Cap:{' '}
          {cap === null ? <strong>no cap authorized — paid generation disabled</strong> : <strong>${(cap / 1_000_000).toFixed(2)} USD</strong>}
        </p>
        <form action={spendingStopAction}>
          <input type="hidden" name="stopped" value={s.spendingStopped ? 'false' : 'true'} />
          <button type="submit" className={s.spendingStopped ? '' : 'danger'}>{s.spendingStopped ? 'Lift spending stop' : 'Stop all spending'}</button>
        </form>
      </section>
      <p className="muted">Last updated {when(s.updatedAt)}</p>
    </main>
  );
}
