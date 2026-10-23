import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadMediaSnapshots, loadPublished, loadRawResponses } from '@/lib/insights-data';
import { describeValue, fmtDuration, redactJson } from '@/lib/insights';
import { SourceBadge, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function InsightEpisode({ params }: { params: Promise<{ code: string }> }) {
  await requireOwner();
  const code = decodeURIComponent((await params).code);
  const db = await getDb();
  const ep = (await loadPublished(db)).find((p) => p.code === code);
  if (!ep) notFound();
  const snaps = (await loadMediaSnapshots(db, [ep.mediaId])).get(ep.mediaId) ?? [];
  snaps.sort((a, b) => a.window.localeCompare(b.window) || a.metric.localeCompare(b.metric) || Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt));
  const rawIds = [...new Set(snaps.map((s) => s.rawResponseId).filter((x): x is string => !!x))];
  const raws = await loadRawResponses(db, rawIds);

  return (
    <main>
      <p><Link href="/insights">&larr; Insights</Link></p>
      <h1>{ep.code} <span className="muted">{ep.title}</span></h1>
      <p>{ep.pillar} / {ep.format} · published {when(ep.publishedAt)} · media source <SourceBadge source={ep.mediaSource} /> · <span className="mono">{ep.permalink}</span></p>

      <h2>Snapshots</h2>
      {snaps.length === 0 ? <p className="muted">No snapshots collected yet.</p> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Metric</th><th>Definition</th><th>Unit</th><th>Window</th><th>Media age</th><th>API</th><th>Retrieved</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>
              {snaps.map((s) => (
                <tr key={s.id}>
                  <td>{s.metric}</td><td>{s.definition}</td><td>{s.unit}</td><td>{s.window}</td>
                  <td>{fmtDuration(s.mediaAgeSec)}</td><td>{s.apiVersion}</td><td className="muted">{when(s.retrievedAt)}</td>
                  <td>{describeValue(s)}</td><td><SourceBadge source={s.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Raw responses (provenance)</h2>
      {rawIds.length === 0 ? <p className="muted">No raw responses linked.</p> : rawIds.map((id) => {
        const r = raws.get(id);
        return (
          <details key={id} className="card">
            <summary><span className="mono">{id}</span> {r ? <>{<SourceBadge source={r.source} />} api {r.apiVersion} · {when(r.retrievedAt)}</> : '(missing)'}</summary>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{r ? JSON.stringify(redactJson(r.body), null, 2) : 'not found'}</pre>
          </details>
        );
      })}
    </main>
  );
}
