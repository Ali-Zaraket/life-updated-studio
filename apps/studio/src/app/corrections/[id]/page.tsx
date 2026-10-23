import { notFound } from 'next/navigation';
import type { CorrectionPlan } from '@life/content';
import { tables as t, eq } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';
import { PlanView } from '@/components/plan-view';
import { resolveAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function CorrectionDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { id } = await params;
  const { ok, err } = await searchParams;
  const [c] = await (await getDb()).select().from(t.corrections).where(eq(t.corrections.id, id));
  if (!c) notFound();
  const plan = c.plan as CorrectionPlan;
  return (
    <main>
      <h1>Correction <span className="mono">{c.id}</span></h1>
      <Notice ok={ok} err={err} />
      <p><Badge kind={c.status === 'open' ? 'warn' : 'good'}>{c.status}</Badge> created {when(c.createdAt)} · trigger <span className="mono">{JSON.stringify(c.trigger)}</span></p>
      <p className="notice err">Live posts are never edited automatically. Any change to a live post needs a new owner approval for the exact wording.</p>
      <section className="card"><h3>Stored plan (as it was when flagged)</h3><PlanView plan={plan} /></section>
      {c.status === 'open' ? (
        <form action={resolveAction} className="card stack">
          <h3>Close this correction</h3>
          <input type="hidden" name="id" value={c.id} />
          <label>Outcome
            <select name="status" defaultValue="resolved"><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select>
          </label>
          <label>Resolution note (required)<textarea name="resolution" required rows={4} maxLength={2000} /></label>
          <button type="submit">Close correction</button>
        </form>
      ) : (
        <section className="card"><h3>Closed {when(c.resolvedAt)}</h3><p>{c.resolution}</p></section>
      )}
    </main>
  );
}
