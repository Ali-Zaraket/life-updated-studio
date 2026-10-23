import { planCorrection, type CorrectionPlan } from '@life/content';
import { previewCorrection, tables as t } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Notice } from '@/components/ui';
import { PlanView } from '@/components/plan-view';
import { clip, parseTrigger } from '@/lib/corrections';
import { flagAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewCorrection({ searchParams }: { searchParams: Promise<{ kind?: string; claimId?: string; sourceId?: string; originId?: string; ok?: string; err?: string }> }) {
  await requireOwner();
  const q = await searchParams;
  const db = await getDb();
  const [claims, sources] = await Promise.all([
    db.select({ id: t.claims.id, text: t.claims.text }).from(t.claims),
    db.select({ id: t.sources.id, title: t.sources.title, originId: t.sources.originId }).from(t.sources),
  ]);
  const origins = [...new Set(sources.map((s) => s.originId))].sort();
  const id = q.kind === 'claim' ? q.claimId : q.kind === 'source' ? q.sourceId : q.kind === 'origin' ? q.originId : undefined;
  const parsed = q.kind && id ? parseTrigger(q.kind, id) : null;
  const plan = parsed?.ok ? ((await previewCorrection(db, parsed.trigger, planCorrection as never)) as unknown as CorrectionPlan) : null;
  const kind = q.kind ?? 'claim';
  return (
    <main>
      <h1>Flag a problem</h1>
      <Notice ok={q.ok} err={q.err} />
      <form method="get" className="card stack">
        <h3>1. What is wrong?</h3>
        <label>Kind
          <select name="kind" defaultValue={kind}>
            <option value="claim">A claim</option><option value="source">A source</option><option value="origin">An evidence origin</option>
          </select>
        </label>
        <p className="muted">Pick a value in the list matching the kind chosen above; the other lists are ignored.</p>
        <label>Claim
          <select name="claimId" defaultValue={q.claimId}>
            <option value="">(choose)</option>
            {claims.map((c) => <option key={c.id} value={c.id}>{clip(c.text)} [{c.id}]</option>)}
          </select>
        </label>
        <label>Source
          <select name="sourceId" defaultValue={q.sourceId}>
            <option value="">(choose)</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{clip(s.title)} [{s.id}]</option>)}
          </select>
        </label>
        <label>Origin
          <select name="originId" defaultValue={q.originId}>
            <option value="">(choose)</option>
            {origins.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <button type="submit">Preview plan</button>
      </form>
      {parsed && !parsed.ok ? <p className="notice err">{parsed.reason}</p> : null}
      {plan && parsed?.ok ? (
        <section className="card stack">
          <h3>2. Preview (nothing has changed yet)</h3>
          <PlanView plan={plan} />
          <form action={flagAction} className="stack">
            <input type="hidden" name="kind" value={parsed.trigger.kind} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="planSha256" value={plan.planSha256} />
            <input type="hidden" name="generatedAt" value={plan.generatedAt} />
            <button type="submit" className="danger">Run automatic steps</button>
            <p className="muted">Cancels the listed queued jobs, revokes unused approvals, holds unpublished episodes and applies a recommended pause. Refused if the data changed since this preview.</p>
          </form>
        </section>
      ) : null}
    </main>
  );
}
