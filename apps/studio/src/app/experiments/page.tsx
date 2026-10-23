import { desc, tables as t } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';
import { DECISIONS, RESULTS } from '@/lib/experiments';
import { createExperimentAction, recordDecisionAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ExperimentsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  const rows = await (await getDb()).select().from(t.experiments).orderBy(desc(t.experiments.createdAt));
  return (
    <main>
      <h1>Experiments</h1>
      <Notice ok={ok} err={err} />
      <p className="muted">Change one major variable at a time. Organic Reel comparisons are observational, not randomized causal tests. Proposed promotion gate (a heuristic, not a statistical guarantee): at least five comparable posts and 1,000 combined reached accounts per variant, then a confound check. With less, the honest result is "insufficient evidence" and you keep collecting.</p>
      <form action={createExperimentAction} className="card stack">
        <h3>New experiment</h3>
        <label>Hypothesis<textarea name="hypothesis" required rows={2} maxLength={1000} /></label>
        <label>The one variable changed<input name="variable" required maxLength={200} /></label>
        <label>Evaluation window<input name="window" required maxLength={200} placeholder="e.g. 6 posts per variant, 14 days after posting" /></label>
        <label>Baseline template<input name="baseline" required maxLength={300} /></label>
        <button type="submit">Record experiment</button>
      </form>
      {rows.length === 0 ? <p className="muted">No experiments yet.</p> : rows.map((e) => (
        <section key={e.id} className="card stack">
          <h3><span className="mono">{e.id}</span> {e.decision ? <Badge kind="good">{e.decision}</Badge> : <Badge kind="warn">NO DECISION</Badge>}</h3>
          <p className="muted">Created {when(e.createdAt)} · window: {e.evaluationWindow}</p>
          <p><strong>Hypothesis:</strong> {e.hypothesis}</p>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.change}</pre>
          {e.decision ? (
            <>
              <p><strong>Result:</strong> {e.result}</p>
              <p><strong>Rollback:</strong> {e.rollback}</p>
            </>
          ) : (
            <form action={recordDecisionAction} className="stack">
              <input type="hidden" name="id" value={e.id} />
              <label>Result<select name="result" defaultValue="insufficient_evidence">{RESULTS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></label>
              <label>Decision<select name="decision" defaultValue="continue_collecting">{DECISIONS.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select></label>
              <label>Evidence summary (required to promote; type it yourself)<textarea name="evidence" rows={2} maxLength={1000} /></label>
              <label>Rollback<input name="rollback" required maxLength={500} /></label>
              <button type="submit">Record decision</button>
            </form>
          )}
        </section>
      ))}
    </main>
  );
}
