import Link from 'next/link';
import { getSettings, spendStatus } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';
import { usd } from '@/lib/money';
import { pauseAction, removeCapAction, resumeAction, setCapAction, spendingStopAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  const db = await getDb();
  const s = await getSettings(db);
  const sp = await spendStatus(db, new Date());
  const cap = s.spendingCapMicroUsd;
  const pct = sp.capMicroUsd ? Math.min(100, (sp.monthToDateMicroUsd / sp.capMicroUsd) * 100) : 0;
  const warned = sp.warnAtMicroUsd !== null && sp.monthToDateMicroUsd >= sp.warnAtMicroUsd;
  const over = sp.capMicroUsd !== null && sp.monthToDateMicroUsd >= sp.capMicroUsd;
  return (
    <main>
      <h1>Settings</h1>
      <Notice ok={ok} err={err} />
      <p><Link href="/settings/instagram">Instagram connection</Link></p>
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
        <p>
          Month-to-date <Badge kind="good">LIVE</Badge> spend: <strong>{usd(sp.monthToDateMicroUsd)}</strong>
          {sp.capMicroUsd !== null ? <> of {usd(sp.capMicroUsd)} (warning at {usd(sp.warnAtMicroUsd ?? 0)})</> : null}
        </p>
        {sp.capMicroUsd !== null ? <progress className="spend" max={sp.capMicroUsd} value={Math.min(sp.monthToDateMicroUsd, sp.capMicroUsd)} aria-label={`${pct.toFixed(0)}% of monthly cap`} /> : null}
        <p>
          State:{' '}
          {s.spendingStopped ? <Badge kind="bad">STOPPED (manual)</Badge> : over ? <Badge kind="bad">HARD STOP: cap reached</Badge> : cap === null ? <Badge kind="bad">NO CAP: paid generation off</Badge> : warned ? <Badge kind="warn">WARNING LEVEL REACHED</Badge> : <Badge kind="good">OK</Badge>}
        </p>
        <p className="muted">Mock costs are excluded from this total. Only live, real-money cost events count (UTC calendar month).</p>
        <form action={setCapAction} className="stack">
          <label>Monthly cap (US dollars)
            <input name="capUsd" inputMode="decimal" required pattern="\d{1,5}(\.\d{1,2})?" defaultValue={cap === null ? '100.00' : (cap / 1_000_000).toFixed(2)} />
          </label>
          <p className="muted">0 to 10,000, two decimals. Suggested 100.00; warning at half the cap. Paid calls are refused before they would pass the cap.</p>
          <button type="submit">Save monthly cap</button>
        </form>
        {cap !== null ? <form action={removeCapAction}><button type="submit" className="danger">Remove cap (disable paid generation)</button></form> : null}
        <form action={spendingStopAction}>
          <input type="hidden" name="stopped" value={s.spendingStopped ? 'false' : 'true'} />
          <button type="submit" className={s.spendingStopped ? '' : 'danger'}>{s.spendingStopped ? 'Lift spending stop' : 'Stop all spending'}</button>
        </form>
      </section>
      <p className="muted">Last updated {when(s.updatedAt)}</p>
    </main>
  );
}
