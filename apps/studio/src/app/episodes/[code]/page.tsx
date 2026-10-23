import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEpisodeVersion, latestReleasePackage, loadEvidencePacket } from '@life/db';
import { versionClaimIds } from '@life/content';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { evaluateGatesFor, type GateReport } from '@/lib/gates';
import { mediaHref } from '@/lib/media';
import { Badge, FixtureBadge, MockBadge, Notice, SourceBadge, shortHash, tc, when } from '@/components/ui';
import { approveAction, rejectAction, revokeAction } from './actions';

export const dynamic = 'force-dynamic';

function GateCard({ title, report }: { title: string; report: GateReport }) {
  return (
    <div className="card">
      <h3>{title} {report.ok ? <Badge kind="good">PASS</Badge> : <Badge kind="bad">BLOCKED ({report.blockers.length})</Badge>}</h3>
      {report.blockers.length ? (
        <ul className="plain blockers">{report.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
      ) : <p className="muted">No blockers.</p>}
    </div>
  );
}

const iso0 = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

export default async function EpisodePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireOwner();
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const { ok, err } = await searchParams;
  const db = await getDb();

  const ep = await db.query.episodes.findFirst({ where: (e, { eq }) => eq(e.code, code) });
  if (!ep) notFound();

  const packet = await loadEvidencePacket(db, ep.topicId);
  const version = ep.currentVersionId ? await getEpisodeVersion(db, ep.currentVersionId) : null;
  const gates = version ? await evaluateGatesFor(db, ep.id, version) : null;
  const pkg = await latestReleasePackage(db, ep.id);

  const epId = ep.id;
  const versions = await db.query.episodeVersions.findMany({ where: (v, { eq }) => eq(v.episodeId, epId), orderBy: (v, { desc }) => desc(v.versionNumber) });
  const transitions = await db.query.episodeTransitions.findMany({ where: (t, { eq }) => eq(t.episodeId, epId), orderBy: (t, { asc }) => asc(t.at) });
  const pkgIds = (await db.query.releasePackages.findMany({ columns: { id: true }, where: (p, { eq }) => eq(p.episodeId, epId) })).map((r) => r.id);
  const approvals = pkgIds.length ? await db.query.approvals.findMany({ where: (a, { inArray }) => inArray(a.releasePackageId, pkgIds), orderBy: (a, { desc }) => desc(a.createdAt) }) : [];
  const rejections = pkgIds.length ? await db.query.rejections.findMany({ where: (r, { inArray }) => inArray(r.releasePackageId, pkgIds), orderBy: (r, { desc }) => desc(r.createdAt) }) : [];
  const jobs = await db.query.publishJobs.findMany({ where: (j, { eq }) => eq(j.episodeId, epId), orderBy: (j, { desc }) => desc(j.createdAt) });
  const jobIds = jobs.map((j) => j.id);
  const media = jobIds.length ? await db.query.instagramMedia.findMany({ where: (m, { inArray }) => inArray(m.publishJobId, jobIds) }) : [];
  const mediaIds = media.map((m) => m.id);
  const snapshots = mediaIds.length ? await db.query.metricSnapshots.findMany({ where: (m, { inArray }) => inArray(m.instagramMediaId, mediaIds), orderBy: (m, { desc }) => desc(m.retrievedAt) }) : [];
  const versionId = version?.id;
  const renders = versionId ? await db.query.renders.findMany({ columns: { source: true }, where: (r, { eq }) => eq(r.episodeVersionId, versionId) }) : [];

  // MOCK detection for media assets and renders.
  const mediaUris = pkg ? [pkg.deliveryMedia.uri, pkg.cover.uri] : [];
  const mockAssets = mediaUris.length ? await db.query.assets.findMany({ columns: { uri: true, source: true }, where: (a, { inArray }) => inArray(a.uri, mediaUris) }) : [];
  const mediaIsMock = mockAssets.some((a) => a.source === 'mock') || renders.some((r) => r.source === 'mock');
  const hasMock = mediaIsMock || jobs.some((j) => j.adapterMode === 'mock');

  const isFixture = packet.topic.isFixture || packet.topic.title.startsWith('[FIXTURE]');
  const sourceById = new Map(packet.sources.map((s) => [s.id, s]));
  const claimById = new Map(packet.claims.map((c) => [c.id, c]));
  const used = version ? new Set(versionClaimIds(version)) : new Set<string>();
  const now = new Date();

  const gatesPass = !!gates && gates.evidence.ok && gates.creative.ok;
  const pkgCurrent = !!pkg && pkg.episodeVersionId === ep.currentVersionId;
  const canApprove = ep.state === 'awaiting_user_approval' && gatesPass && pkgCurrent;
  const disabledWhy = [
    ep.state !== 'awaiting_user_approval' ? `episode is ${ep.state}` : null,
    !pkg ? 'no release package' : !pkgCurrent ? 'release package is not for the current version' : null,
    !gates ? 'no current version' : null,
    gates && !gates.evidence.ok ? 'evidence gate failing' : null,
    gates && !gates.creative.ok ? 'creative gate failing' : null,
  ].filter(Boolean);

  const defNotAfter = iso0(new Date(now.getTime() + 48 * 3600_000));
  const videoHref = pkg ? mediaHref(pkg.deliveryMedia.uri) : null;
  const coverHref = pkg ? mediaHref(pkg.cover.uri) : null;

  return (
    <main>
      <p><Link href="/">← Dashboard</Link></p>
      <h1>
        {ep.code} · {packet.topic.title} {isFixture ? <FixtureBadge /> : null} {hasMock ? <MockBadge /> : null}
      </h1>
      <Notice ok={ok} err={err} />
      <p>
        <Badge kind={['blocked', 'failed', 'cancelled'].includes(ep.state) ? 'bad' : 'neutral'}>{ep.state}</Badge>
        {ep.stateReason ? <> {ep.stateReason}</> : null} <span className="muted">· format {ep.format} · risk {packet.topic.riskTier}</span>
      </p>
      <p className="muted">{packet.topic.question}</p>

      <h2>Script {version ? <span className="muted">(version {version.versionNumber}, {shortHash(version.contentSha256)})</span> : null}</h2>
      {!version ? <p className="muted">No version yet.</p> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Time</th><th>Role</th><th>Narration</th><th>Visual</th><th>Claims</th></tr></thead>
            <tbody>
              {version.beats.map((b, i) => (
                <tr key={i}>
                  <td>{tc(b.startSec)}–{tc(b.endSec)}</td>
                  <td>{b.role}</td>
                  <td>{b.narration}</td>
                  <td>{b.visual}</td>
                  <td>{b.claimIds.length ? b.claimIds.map((id) => <a key={id} className="claimref mono" href={`#claim-${id}`}>{id}</a>) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p><strong>Caption:</strong> {version.caption}</p>
        </div>
      )}

      <h2>Claims</h2>
      {packet.claims.length === 0 ? <p className="muted">No claims.</p> : null}
      {packet.claims.map((c) => {
        const ev = packet.evidence.filter((e) => e.claimId === c.id);
        const fresh = c.freshUntil ? Date.parse(c.freshUntil) > now.getTime() : null;
        return (
          <div key={c.id} id={`claim-${c.id}`} className="card claim">
            <h3>
              <span className="mono">{c.id}</span>{' '}
              <Badge kind={c.status === 'supported' ? 'good' : c.status === 'supported_with_limits' ? 'warn' : 'bad'}>{c.status}</Badge>
              <Badge>risk {c.riskTier}</Badge>
              {used.has(c.id) ? <Badge kind="neutral">in current version</Badge> : <Badge kind="warn">not in current version</Badge>}
            </h3>
            <p>{c.text}</p>
            <p className="muted">
              Freshness: {c.timeSensitivity}; fresh until {when(c.freshUntil)} {fresh === null ? '' : fresh ? '(fresh)' : '(STALE)'}; last checked {when(c.lastCheckedAt)}
            </p>
            {c.statusReason ? <p>Reason: {c.statusReason}</p> : null}
            {c.permittedWording ? <p>Permitted wording: {c.permittedWording}</p> : null}
            <p>Limitations: {c.limitations ?? <span className="muted">none recorded</span>}</p>
            {ev.length === 0 ? <p className="error">No evidence attached.</p> : (
              <ul className="plain">
                {ev.map((e) => {
                  const s = sourceById.get(e.sourceId);
                  const fx = isFixture || (s?.title.startsWith('[FIXTURE]') ?? false);
                  return (
                    <li key={e.id} className="card">
                      <Badge kind={e.stance === 'contradicts' ? 'bad' : 'neutral'}>{e.stance}</Badge>
                      {fx ? <FixtureBadge /> : null}
                      <blockquote style={{ margin: '6px 0' }}>{e.supportingPassage}</blockquote>
                      <p className="muted">Locator: {e.locator}{e.studyType ? ` · ${e.studyType}` : ''}{e.population ? ` · ${e.population}` : ''}{e.limitations ? ` · limits: ${e.limitations}` : ''}</p>
                      {s ? (
                        <p>
                          <strong>{s.title}</strong> — {s.institution ?? 'institution unknown'} · {s.sourceType} · published {when(s.publishedAt)} · retrieved {when(s.retrievedAt)}
                          {s.retracted ? <> <Badge kind="bad">RETRACTED</Badge></> : null}{!s.available ? <> <Badge kind="warn">UNAVAILABLE</Badge></> : null}
                          <br /><span className="mono">{s.url}</span>
                        </p>
                      ) : <p className="error">Source {e.sourceId} missing.</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <h2>Gates</h2>
      {gates ? (
        <div className="grid">
          <GateCard title="Evidence gate" report={gates.evidence} />
          <GateCard title="Creative rules" report={gates.creative} />
        </div>
      ) : <p className="muted">No version to evaluate.</p>}

      <h2>Release package</h2>
      {!pkg ? <p className="muted">No release package yet.</p> : (
        <div className="card stack">
          <p>
            {hasMock ? <MockBadge /> : null} Account <span className="mono">{pkg.accountId}</span> · created {when(pkg.createdAt)} · share to feed: {String(pkg.shareToFeed)}
          </p>
          <p><strong>Caption:</strong> {pkg.caption}</p>
          <p><strong>Disclosure:</strong> AI visuals {String(pkg.disclosure.aiGeneratedVisuals)}; synthetic voice {String(pkg.disclosure.syntheticVoice)}; platform label {pkg.disclosure.platformLabelRequired ? `required (${pkg.disclosure.platformLabelMethod})` : 'not required'}{pkg.disclosure.captionNote ? `; note: ${pkg.disclosure.captionNote}` : ''}</p>
          <p className="mono">package {shortHash(pkg.packageSha256)} · version {shortHash(pkg.episodeVersionSha256)} · media {shortHash(pkg.deliveryMedia.sha256)} · cover {shortHash(pkg.cover.sha256)}</p>
          <div className="grid">
            <div>
              <h3>Preview video</h3>
              {videoHref ? <video controls preload="metadata" src={videoHref} /> : <p className="muted">Not previewable (uri is not a storage path): <span className="mono">{pkg.deliveryMedia.uri}</span></p>}
            </div>
            <div>
              <h3>Cover</h3>
              {pkg.coverSource === 'first_frame' ? <p className="muted">This is the video&apos;s first frame. Instagram is told to use that frame, so this is the cover that appears.</p> : null}
              {coverHref ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="cover" src={coverHref} alt="Cover" /> : <p className="muted">Not previewable: <span className="mono">{pkg.cover.uri}</span></p>}
            </div>
          </div>
        </div>
      )}

      <h2>Decision</h2>
      <div className="grid">
        <form action={approveAction} className="card stack">
          <h3>Approve</h3>
          <input type="hidden" name="code" value={ep.code} />
          <input type="hidden" name="packageId" value={pkg?.id ?? ''} />
          <label>Window start (UTC, ISO 8601)<input name="notBefore" defaultValue={iso0(now)} required disabled={!canApprove} /></label>
          <label>Window end (UTC, ISO 8601)<input name="notAfter" defaultValue={defNotAfter} required disabled={!canApprove} /></label>
          <label>Approval expiry (defaults to window end)<input name="expiresAt" defaultValue={defNotAfter} required disabled={!canApprove} /></label>
          <button type="submit" disabled={!canApprove}>Approve and sign</button>
          {!canApprove ? <p className="muted">Disabled: {disabledWhy.join('; ') || 'unknown'}.</p> : <p className="muted">Signs the exact package hashes shown above.</p>}
        </form>
        <form action={rejectAction} className="card stack">
          <h3>Reject</h3>
          <input type="hidden" name="code" value={ep.code} />
          <input type="hidden" name="packageId" value={pkg?.id ?? ''} />
          <label>Feedback (required)<textarea name="feedback" required minLength={3} rows={3} disabled={ep.state !== 'awaiting_user_approval' || !pkg} /></label>
          <button type="submit" className="danger" disabled={ep.state !== 'awaiting_user_approval' || !pkg}>Reject with feedback</button>
        </form>
      </div>

      <h3>Approvals</h3>
      {approvals.length === 0 ? <p className="muted">None.</p> : approvals.map((a) => (
        <div key={a.id} className="card">
          <p>
            <span className="mono">{a.id}</span> · package <span className="mono">{shortHash(a.releasePackageId)}</span> · signed {when(a.createdAt)} · expires {when(a.expiresAt)} · key {a.keyId}{' '}
            {a.revokedAt ? <Badge kind="bad">REVOKED {when(a.revokedAt)}: {a.revokedReason}</Badge> : Date.parse(a.expiresAt) <= now.getTime() ? <Badge kind="warn">EXPIRED</Badge> : <Badge kind="good">ACTIVE</Badge>}
          </p>
          {!a.revokedAt ? (
            <form action={revokeAction} className="stack">
              <input type="hidden" name="code" value={ep.code} />
              <input type="hidden" name="approvalId" value={a.id} />
              <label>Revocation reason (required)<input name="reason" required minLength={3} /></label>
              <button type="submit" className="danger">Revoke approval</button>
            </form>
          ) : null}
        </div>
      ))}
      {rejections.length ? (
        <>
          <h3>Rejections</h3>
          <ul>{rejections.map((r) => <li key={r.id}>{when(r.createdAt)}: {r.feedback}</li>)}</ul>
        </>
      ) : null}

      <h2>Publish jobs</h2>
      {jobs.length === 0 ? <p className="muted">None.</p> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Job</th><th>Mode</th><th>State</th><th>Reason</th><th>Remote id</th><th>Permalink</th><th>Scheduled</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="mono">{shortHash(j.id.replace(/^pub_/, ''))}</td>
                  <td>{j.adapterMode === 'mock' ? <MockBadge /> : <Badge kind="good">LIVE</Badge>}</td>
                  <td>{j.state}</td>
                  <td>{j.stateReason ?? '—'}</td>
                  <td className="mono">{j.remoteMediaId ?? '—'}</td>
                  <td className="mono">{j.permalink ?? '—'}</td>
                  <td className="muted">{when(j.scheduledFor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Insights</h2>
      {snapshots.length === 0 ? <p className="muted">No metric snapshots.</p> : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>Metric</th><th>Window</th><th>Value</th><th>Unavailable because</th><th>Source</th><th>Retrieved</th></tr></thead>
            <tbody>
              {snapshots.map((m) => (
                <tr key={m.id}>
                  <td title={m.definition}>{m.metric}</td>
                  <td>{m.window}</td>
                  <td>{m.value === null ? '—' : `${m.value} ${m.unit}`}</td>
                  <td>{m.value === null ? m.unavailabilityReason ?? 'unknown' : ''}</td>
                  <td><SourceBadge source={m.source} /></td>
                  <td className="muted">{when(m.retrievedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Version history</h2>
      <div className="card tablewrap">
        <table>
          <thead><tr><th>#</th><th>Hash</th><th>Created</th><th>By</th><th>Supersedes</th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{v.versionNumber}{v.id === ep.currentVersionId ? ' (current)' : ''}</td>
                <td className="mono">{shortHash(v.contentSha256)}</td>
                <td className="muted">{when(v.createdAt)}</td>
                <td>{(v.createdBy as { kind: string }).kind}</td>
                <td className="mono">{v.supersedesVersionId ? shortHash(v.supersedesVersionId.replace(/^ev_/, '')) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Timeline</h2>
      <ul className="plain">
        {transitions.map((t) => (
          <li key={t.id}>
            <span className="muted">{when(t.at)}</span> {t.fromState} → <strong>{t.toState}</strong> by {(t.actor as { kind: string }).kind}{t.reason ? ` — ${t.reason}` : ''}
          </li>
        ))}
      </ul>
    </main>
  );
}
