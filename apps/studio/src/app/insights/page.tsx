import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { loadAccountSnapshots, loadMediaSnapshots, loadPublished } from '@/lib/insights-data';
import {
  RATE_LABEL, WINDOWS, compare, describeValue, fmtCount, fmtPct, fmtWatch, latest, rateView,
  type Comparison, type EpisodeData, type RateKey, type Source,
} from '@/lib/insights';
import { Badge, SourceBadge, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

const SOURCES: { key: Source; param: string; label: string }[] = [
  { key: 'live', param: 'live', label: 'LIVE' },
  { key: 'manual_import', param: 'manual', label: 'MANUAL IMPORT' },
  { key: 'mock', param: 'mock', label: 'MOCK' },
];

type SP = { f?: string; live?: string; manual?: string; mock?: string; window?: string };

function Cmp({ c, dim }: { c: Comparison; dim: string }) {
  if (c.buckets.length === 0) return <p className="muted">No episodes with both {RATE_LABEL[c.rate]} sides available at {c.window}.</p>;
  return (
    <>
      {c.definitionWarnings.length > 0 ? (
        <p className="notice err" role="alert">Warning: definitions or API versions differ within {c.definitionWarnings.join(', ')} data. They are shown separately and must not be compared with each other.</p>
      ) : null}
      {c.buckets.map((b) => (
        <div key={`${b.source}${b.definitionKey}`} className="card">
          <h3><SourceBadge source={b.source} /> {RATE_LABEL[c.rate]} at {c.window} by {dim}</h3>
          <p className="muted mono">{b.definitions}</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>{dim}</th><th>n (episodes)</th><th>Combined reach</th><th>Median</th><th>Range</th><th>Evidence</th></tr></thead>
              <tbody>
                {b.groups.map((g, i) => (
                  <tr key={g.label}>
                    <td>{b.ranked ? `${i + 1}. ` : ''}{g.label}</td>
                    <td>{g.n}</td>
                    <td>{fmtCount(g.combinedReach)}</td>
                    <td>{g.median === null ? '—' : fmtPct(g.median)}</td>
                    <td>{g.min === null || g.max === null ? '—' : `${fmtPct(g.min)} – ${fmtPct(g.max)}`}</td>
                    <td>{g.sufficient ? 'meets minimum' : <span className="muted">insufficient ({g.shortfall})</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><strong>{b.verdict}</strong></p>
        </div>
      ))}
    </>
  );
}

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireOwner();
  const sp = await searchParams;
  const submitted = sp.f === '1';
  const enabled = new Set<Source>(
    submitted ? SOURCES.filter((s) => sp[s.param as 'live' | 'manual' | 'mock'] === '1').map((s) => s.key) : ['live'],
  );
  const window = (WINDOWS as readonly string[]).includes(sp.window ?? '') ? sp.window! : '24h';

  const db = await getDb();
  const published = await loadPublished(db);
  const snaps = await loadMediaSnapshots(db, published.map((p) => p.mediaId));
  const account = (await loadAccountSnapshots(db)).filter((s) => enabled.has(s.source));

  const present = new Set<Source>();
  for (const p of published) {
    present.add(p.mediaSource);
    for (const s of snaps.get(p.mediaId) ?? []) present.add(s.source);
  }
  for (const s of await loadAccountSnapshots(db)) present.add(s.source);
  const onlyMock = present.size > 0 && [...present].every((s) => s === 'mock');

  // One entry per (episode, source): sources are never merged.
  const entries: (EpisodeData & { mediaId: string; title: string; publishedAt: string })[] = [];
  for (const p of published) {
    const all = snaps.get(p.mediaId) ?? [];
    const srcs = new Set<Source>(all.map((s) => s.source));
    if (srcs.size === 0) srcs.add(p.mediaSource);
    for (const source of srcs) {
      if (!enabled.has(source)) continue;
      entries.push({ code: p.code, pillar: p.pillar, format: p.format, source, snapshots: all.filter((s) => s.source === source), mediaId: p.mediaId, title: p.title, publishedAt: p.publishedAt });
    }
  }

  const rates: RateKey[] = ['saves', 'shares'];
  return (
    <main>
      <h1>Insights</h1>
      {onlyMock ? <div className="banner">Only MOCK data exists. Nothing here reflects real audience behaviour or a live launch.</div> : null}
      {!onlyMock && enabled.size === 0 ? <p className="notice err">No source selected.</p> : null}

      <form method="get" className="card">
        <input type="hidden" name="f" value="1" />
        <strong>Sources</strong> (never combined in one aggregate):{' '}
        {SOURCES.map((s) => (
          <label key={s.key} style={{ display: 'inline-block', marginRight: 14, fontWeight: 400 }}>
            <input type="checkbox" name={s.param} value="1" defaultChecked={enabled.has(s.key)} style={{ display: 'inline', width: 'auto', marginRight: 4 }} />{s.label}
          </label>
        ))}
        <label style={{ maxWidth: 220, marginTop: 8 }}>Comparison window
          <select name="window" defaultValue={window}>{WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}</select>
        </label>
        <p><button type="submit">Apply</button></p>
      </form>

      <h2>Published episodes</h2>
      {entries.length === 0 ? <p className="muted">No published episodes for the selected sources.</p> : (
        <div className="card tablewrap">
          <table>
            <thead>
              <tr><th>Episode</th><th>Pillar / format</th><th>Published</th><th>Source</th>{WINDOWS.map((w) => <th key={w}>{w}</th>)}</tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.code}${e.source}`}>
                  <td><Link href={`/insights/${encodeURIComponent(e.code)}`}>{e.code}</Link><br />{e.title}</td>
                  <td>{e.pillar}<br /><span className="muted">{e.format}</span></td>
                  <td className="muted">{when(e.publishedAt)}</td>
                  <td><SourceBadge source={e.source} /></td>
                  {WINDOWS.map((w) => {
                    const g = (k: Parameters<typeof latest>[1]) => latest(e.snapshots, k, w, e.source);
                    return (
                      <td key={w}>
                        <div>reach {describeValue(g('reach'))}</div>
                        <div>views {describeValue(g('views'))}</div>
                        <div>saves {describeValue(g('saves'))}</div>
                        <div>shares {describeValue(g('shares'))}</div>
                        <div>avg watch {fmtWatch(g('watch'))}</div>
                        <div>saves/reach {rateView(g('saves'), g('reach'), 'saves').text}</div>
                        <div>shares/reach {rateView(g('shares'), g('reach'), 'shares').text}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Each cell shows the latest snapshot for that window. Average watch time is a proxy and can be distorted by replays; it is not a completion rate. A dash is a missing value, never zero.</p>
        </div>
      )}

      <h2>Matching-age comparison ({window})</h2>
      <p className="muted">Only {window} snapshots, within one source and one definition/API version. Minimum heuristic: at least 5 comparable episodes and 1,000 combined reach per group; below that, no ranking is given. Differences are observational, not causal.</p>
      {rates.map((r) => <Cmp key={r} c={compare(entries, r, window, null)} dim="all episodes" />)}

      <h2>By pillar</h2>
      {rates.map((r) => <Cmp key={r} c={compare(entries, r, window, 'pillar')} dim="pillar" />)}

      <h2>By format</h2>
      {rates.map((r) => <Cmp key={r} c={compare(entries, r, window, 'format')} dim="format" />)}

      <h2>Account-level metrics</h2>
      <p className="muted">Account scope only. These are never attributed to a single Reel (for example, follower change is not caused by one Reel).</p>
      {account.length === 0 ? <p className="muted">No account-level rows for the selected sources.</p> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Account</th><th>Metric</th><th>Window</th><th>Value</th><th>Definition</th><th>API</th><th>Retrieved</th><th>Source</th></tr></thead>
            <tbody>
              {account.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.accountId}</td><td>{s.metric}</td><td>{s.window}</td>
                  <td>{s.value === null ? `— (${s.unavailabilityReason})` : `${fmtCount(s.value)} ${s.unit}`}</td>
                  <td>{s.definition}</td><td>{s.apiVersion}</td><td className="muted">{when(s.retrievedAt)}</td><td><SourceBadge source={s.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted"><Badge>read-only</Badge> No recommendation here changes approved or published artifacts.</p>
    </main>
  );
}
