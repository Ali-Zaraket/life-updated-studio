import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { Badge, MockBadge, Notice, shortHash, when } from '@/components/ui';
import { usd } from '@/lib/money';
import { listAuditionClips, mediaUrl } from '@/lib/voice';
import { chooseNarratorAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function VoicePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; m?: string; c?: string }> }) {
  await requireOwner();
  const { ok, err, m, c } = await searchParams;
  const db = await getDb();
  const profiles = await db.query.voiceProfiles.findMany();
  const approved = profiles
    .filter((p) => p.approvedByOwnerAt)
    .sort((a, b) => (b.approvedByOwnerAt ?? '').localeCompare(a.approvedByOwnerAt ?? ''))[0];
  const ap = approved?.profile as { provider?: string; voiceLabel?: string; voiceId?: string; approvedReferenceClipSha256?: string } | undefined;

  const clips = await listAuditionClips();
  const byProvider = new Map<string, typeof clips>();
  for (const clip of clips) byProvider.set(clip.provider, [...(byProvider.get(clip.provider) ?? []), clip]);
  const pending = m && c !== undefined ? clips.find((x) => x.manifestRel === m && String(x.index) === c) : undefined;

  return (
    <main>
      <h1>Narrator voice</h1>
      <Notice ok={ok} err={err} />
      {approved ? (
        <section className="card stack">
          <h3>Approved narrator <Badge kind="good">APPROVED</Badge></h3>
          <p><strong>{ap?.voiceLabel ?? approved.id}</strong> ({ap?.provider ?? '—'}, voiceId <span className="mono">{ap?.voiceId ?? '—'}</span>)</p>
          <p className="muted">Profile {approved.id} v{approved.version}, approved {when(approved.approvedByOwnerAt)}, reference clip <span className="mono">{shortHash(ap?.approvedReferenceClipSha256)}</span></p>
          <p className="muted">Choosing a different voice replaces this narrator and requires re-approval of future episodes.</p>
        </section>
      ) : (
        <div className="banner">MOCK VOICE IN USE: no narrator has been approved. <MockBadge /> Audio in episodes is placeholder only.</div>
      )}

      {pending ? (
        <section className="card stack" style={{ borderColor: 'var(--warn)' }}>
          <h3>Confirm narrator</h3>
          <p>Make <strong>{pending.voiceLabel}</strong> ({pending.provider}, <span className="mono">{pending.voiceId}</span>) the narrator, with clip <span className="mono">{shortHash(pending.sha256)}</span> as the approved reference.</p>
          {approved ? <p><strong>This replaces the current narrator and requires re-approval of future episodes.</strong></p> : null}
          <form action={chooseNarratorAction} className="stack">
            <input type="hidden" name="manifest" value={pending.manifestRel} />
            <input type="hidden" name="index" value={pending.index} />
            <label style={{ fontWeight: 400 }}><input type="checkbox" name="confirm" value="yes" required style={{ display: 'inline', width: 'auto', marginRight: 8 }} />I have listened to this clip and choose this voice.</label>
            <div><button type="submit">Approve this narrator</button> <Link href="/voice">Cancel</Link></div>
          </form>
        </section>
      ) : null}

      <h2>Audition clips</h2>
      {clips.length === 0 ? (
        <section className="card stack">
          <p>No audition clips found under <span className="mono">storage/auditions/**/manifest.json</span>.</p>
          <p className="muted">On the owner&apos;s machine run <span className="mono">pnpm audition</span> (a dry run that spends nothing), then <span className="mono">pnpm audition --confirm-spend</span> once the spending cap is set in Settings.</p>
        </section>
      ) : null}
      {[...byProvider.entries()].map(([provider, list]) => (
        <section className="card stack" key={provider}>
          <h3>{provider}</h3>
          <div className="grid">
            {list.map((clip) => (
              <div className="card stack" key={`${clip.manifestRel}#${clip.index}`}>
                <strong>{clip.voiceLabel}</strong> {clip.mock ? <MockBadge /> : null}
                <audio controls preload="none" src={mediaUrl(clip.fileRel)} style={{ width: '100%' }} />
                <div className="muted">voiceId <span className="mono">{clip.voiceId}</span></div>
                <div className="muted">
                  {clip.durationSeconds === null ? 'duration unknown' : `${clip.durationSeconds.toFixed(1)} s`} · est. cost {clip.costEstimateMicroUsd === null ? 'unknown' : usd(clip.costEstimateMicroUsd)} · sha256 <span className="mono">{shortHash(clip.sha256)}</span>
                </div>
                {clip.mock ? (
                  <span className="muted">Mock clips cannot be chosen.</span>
                ) : (
                  <Link href={`/voice?m=${encodeURIComponent(clip.manifestRel)}&c=${clip.index}`}>Choose this narrator</Link>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
