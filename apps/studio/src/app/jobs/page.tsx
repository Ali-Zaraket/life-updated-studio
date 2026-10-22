import Link from 'next/link';
import { desc, eq, tables as t } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, when } from '@/components/ui';
import { PUBLISH_STATES, QUEUE_STATES, needsAttention, stateFilter } from '@/lib/jobs-view';

export const dynamic = 'force-dynamic';

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ queue?: string; publish?: string }> }) {
  await requireOwner();
  const q = await searchParams;
  const qf = stateFilter(q.queue, QUEUE_STATES);
  const pf = stateFilter(q.publish, PUBLISH_STATES);
  const db = await getDb();
  const [jobs, pubs] = await Promise.all([
    (qf ? db.select().from(t.jobs).where(eq(t.jobs.state, qf)) : db.select().from(t.jobs)).orderBy(desc(t.jobs.createdAt)).limit(200),
    (pf
      ? db.select({ j: t.publishJobs, code: t.episodes.code }).from(t.publishJobs).leftJoin(t.episodes, eq(t.episodes.id, t.publishJobs.episodeId)).where(eq(t.publishJobs.state, pf))
      : db.select({ j: t.publishJobs, code: t.episodes.code }).from(t.publishJobs).leftJoin(t.episodes, eq(t.episodes.id, t.publishJobs.episodeId))
    ).orderBy(desc(t.publishJobs.createdAt)).limit(200),
  ]);
  const kind = (s: string) => (s === 'failed' || s === 'needs_reconciliation' ? 'bad' : s === 'retry_wait' ? 'warn' : s === 'published' || s === 'succeeded' ? 'good' : 'neutral');
  const filterLinks = (param: 'queue' | 'publish', states: readonly string[], cur: string | null) => (
    <p>
      <Link href={param === 'queue' ? `/jobs${pf ? `?publish=${pf}` : ''}` : `/jobs${qf ? `?queue=${qf}` : ''}`}>{cur ? 'all' : <strong>all</strong>}</Link>
      {states.map((s) => {
        const other = param === 'queue' ? (pf ? `&publish=${pf}` : '') : (qf ? `&queue=${qf}` : '');
        return <span key={s}> · <Link href={`/jobs?${param}=${s}${other}`}>{cur === s ? <strong>{s}</strong> : s}</Link></span>;
      })}
    </p>
  );
  return (
    <main>
      <h1>Jobs</h1>
      <p className="muted">Read-only. Rows in needs_reconciliation, failed or retry_wait are highlighted; an ambiguous publish must be reconciled against the remote account before any retry.</p>
      <h2>Publish jobs</h2>
      {filterLinks('publish', PUBLISH_STATES, pf)}
      <div className="tablewrap"><table>
        <thead><tr><th>Episode</th><th>State</th><th>Reason</th><th>Mode</th><th>Attempts</th><th>Container</th><th>Remote</th></tr></thead>
        <tbody>
          {pubs.length === 0 ? <tr><td colSpan={7} className="muted">None.</td></tr> : pubs.map(({ j, code }) => (
            <tr key={j.id} className={needsAttention(j.state) ? 'attn' : undefined}>
              <td>{code ?? j.episodeId}</td>
              <td><Badge kind={kind(j.state)}>{j.state}</Badge></td>
              <td>{j.stateReason ?? '—'}</td>
              <td>{j.adapterMode === 'mock' ? <Badge kind="mock">MOCK</Badge> : <Badge kind="good">LIVE</Badge>}</td>
              <td>{j.attempts}/{j.maxAttempts}</td>
              <td className="mono">{j.containerId ?? '—'}</td>
              <td className="mono">{j.remoteMediaId ?? '—'}{j.permalink ? <><br />{j.permalink}</> : null}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Queue jobs</h2>
      {filterLinks('queue', QUEUE_STATES, qf)}
      <div className="tablewrap"><table>
        <thead><tr><th>Kind</th><th>State</th><th>Run at</th><th>Attempts</th><th>Lease</th><th>Last error</th></tr></thead>
        <tbody>
          {jobs.length === 0 ? <tr><td colSpan={6} className="muted">None.</td></tr> : jobs.map((j) => (
            <tr key={j.id} className={needsAttention(j.state) ? 'attn' : undefined}>
              <td>{j.kind}</td>
              <td><Badge kind={kind(j.state)}>{j.state}</Badge></td>
              <td>{when(j.runAt)}</td>
              <td>{j.attempts}/{j.maxAttempts}</td>
              <td>{j.leaseOwner ? <>{j.leaseOwner}<br />until {when(j.leaseExpiresAt)}</> : '—'}</td>
              <td>{j.lastError ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </main>
  );
}
