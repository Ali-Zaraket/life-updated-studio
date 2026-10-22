import Link from 'next/link';
import { getSettings, spendStatus } from '@life/db';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { usd } from '@/lib/money';
import { Badge, FixtureBadge, MockBadge, Notice, when } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { ok, err } = await searchParams;
  const db = await getDb();
  const settings = await getSettings(db);
  const sp = await spendStatus(db, new Date());

  const episodes = await db.query.episodes.findMany({ orderBy: (e, { desc }) => desc(e.updatedAt) });
  const topicById = new Map((await db.query.topics.findMany()).map((t) => [t.id, t]));
  const eps = episodes.flatMap((ep) => {
    const topic = topicById.get(ep.topicId);
    return topic ? [{ ep, topic }] : [];
  });

  // Anything whose source/adapterMode is mock gets a permanent badge.
  const mockEpisodes = new Set<string>();
  for (const j of await db.query.publishJobs.findMany({ columns: { episodeId: true, adapterMode: true } })) if (j.adapterMode === 'mock') mockEpisodes.add(j.episodeId);
  const mockVersionIds = new Set((await db.query.renders.findMany({ columns: { episodeVersionId: true, source: true } })).filter((r) => r.source === 'mock').map((r) => r.episodeVersionId));
  if (mockVersionIds.size) for (const v of await db.query.episodeVersions.findMany({ columns: { id: true, episodeId: true } })) if (mockVersionIds.has(v.id)) mockEpisodes.add(v.episodeId);

  return (
    <main>
      <h1>Episodes</h1>
      <Notice ok={ok} err={err} />
      <p>
        <Link href="/settings" className="chip">
          {sp.capMicroUsd === null ? 'No cap: paid generation off' : `Spend ${usd(sp.monthToDateMicroUsd)} / ${usd(sp.capMicroUsd)} (live, this month)`}
        </Link>
      </p>
      {settings.publishingPaused ? (
        <div className="banner">PUBLISHING PAUSED: {settings.pausedReason ?? 'no reason recorded'}. <Link href="/settings">Settings</Link></div>
      ) : null}
      {settings.spendingStopped ? <div className="banner">SPENDING STOPPED: paid generation is disabled. <Link href="/settings">Settings</Link></div> : null}
      <div className="card tablewrap">
        <table>
          <thead>
            <tr><th>Code</th><th>Title</th><th>State</th><th>Reason</th><th>Updated</th></tr>
          </thead>
          <tbody>
            {eps.length === 0 ? <tr><td colSpan={5} className="muted">No episodes yet.</td></tr> : null}
            {eps.map(({ ep, topic }) => (
              <tr key={ep.id}>
                <td><Link href={`/episodes/${encodeURIComponent(ep.code)}`}>{ep.code}</Link></td>
                <td>
                  {topic.title} {topic.isFixture || topic.title.startsWith('[FIXTURE]') ? <FixtureBadge /> : null}
                  {mockEpisodes.has(ep.id) ? <MockBadge /> : null}
                </td>
                <td><Badge kind={ep.state === 'blocked' || ep.state === 'failed' || ep.state === 'cancelled' ? 'bad' : ep.state === 'awaiting_user_approval' ? 'warn' : 'neutral'}>{ep.state}</Badge></td>
                <td>{ep.stateReason ?? <span className="muted">—</span>}</td>
                <td className="muted">{when(ep.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
