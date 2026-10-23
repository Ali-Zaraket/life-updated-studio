import Link from 'next/link';
import { listCorrections } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, Notice, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  const rows = await listCorrections(await getDb());
  return (
    <main>
      <h1>Corrections</h1>
      <Notice ok={ok} err={err} />
      <p><Link href="/corrections/new">Flag a problem</Link></p>
      <p className="muted">Live posts are never edited automatically. Flagging only cancels queued jobs, revokes unused approvals and holds unpublished episodes. Any live change needs a new approval.</p>
      <div className="tablewrap"><table>
        <thead><tr><th>Created</th><th>Status</th><th>Severity</th><th>Summary</th><th>Resolved</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={5} className="muted">No corrections.</td></tr> : rows.map((r) => {
            const p = r.plan as { severity?: string; summary?: string };
            return (
              <tr key={r.id}>
                <td><Link href={`/corrections/${r.id}`}>{when(r.createdAt)}</Link></td>
                <td><Badge kind={r.status === 'open' ? 'warn' : 'good'}>{r.status}</Badge></td>
                <td>{p.severity ?? '—'}</td>
                <td>{p.summary ?? '—'}</td>
                <td>{when(r.resolvedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </main>
  );
}
