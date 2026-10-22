import type { CorrectionPlan } from '@life/content';
import { Badge, SourceBadge, shortHash } from '@/components/ui';

const sevKind = (s: string) => (s === 'critical' || s === 'high' ? 'bad' : s === 'elevated' ? 'warn' : 'neutral');
const media = (label: string) => (label === 'MOCK' ? <Badge kind="mock">MOCK</Badge> : label === 'MANUAL IMPORT' ? <Badge kind="warn">MANUAL IMPORT</Badge> : <Badge kind="good">LIVE</Badge>);

export function PlanView({ plan }: { plan: CorrectionPlan }) {
  const cancelJobs = plan.operations.filter((o) => o.kind === 'cancel_publish_job');
  const revokes = plan.operations.filter((o) => o.kind === 'revoke_unused_approvals');
  const ownerOps = plan.operations.filter((o) => !o.automatic);
  return (
    <div className="stack">
      <p>
        <Badge kind={sevKind(plan.severity)}>SEVERITY {plan.severity.toUpperCase()}</Badge>
        {plan.globalPause.recommended ? <Badge kind="bad">GLOBAL PAUSE RECOMMENDED</Badge> : null}
        {plan.ownerReviewRequired ? <Badge kind="warn">OWNER REVIEW REQUIRED</Badge> : null}
        <span className="mono" title={plan.planSha256}> plan {shortHash(plan.planSha256)}</span>
      </p>
      <p><strong>{plan.summary}</strong></p>
      {plan.warnings.length ? <ul className="plain blockers">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}

      <h3>Affected claims ({plan.affectedClaims.length})</h3>
      {plan.affectedClaims.length === 0 ? <p className="muted">None.</p> : (
        <ul className="plain">
          {plan.affectedClaims.map((c) => (
            <li key={c.claimId} className="card">
              <span className="mono">{c.claimId}</span> <Badge>{c.status}</Badge> <Badge>{c.riskTier} risk</Badge>
              <div>{c.text}</div>
              <div className="muted">Reasons: {c.reasons.join(', ')}. Origins before {c.originsBefore.length}, after {c.originsAfter.length}. {c.supportableAfter ? 'Could still be supported.' : 'Not supportable after this change.'}</div>
            </li>
          ))}
        </ul>
      )}

      <h3>Affected episodes ({plan.episodes.length})</h3>
      {plan.episodes.length === 0 ? <p className="muted">None.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Episode</th><th>State</th><th>Action</th><th>Exposure</th><th>Detail</th></tr></thead>
          <tbody>
            {plan.episodes.map((e) => (
              <tr key={e.episodeId}>
                <td>{e.code}</td><td>{e.state}</td>
                <td><Badge kind={e.action === 'propose_live_correction' || e.action === 'hold_for_owner' ? 'warn' : 'neutral'}>{e.action}</Badge></td>
                <td>{e.exposure}</td>
                <td>{e.transition ? <>Move {e.transition.from} to {e.transition.to}. </> : null}{e.cancelJobIds.length ? <>Cancel {e.cancelJobIds.length} job(s). </> : null}{e.revokeUnusedApprovals ? 'Revoke unused approvals. ' : null}{e.notes.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <h3>Automatic steps (only ever reduce exposure)</h3>
      <ul>
        <li>Publish jobs to cancel: {cancelJobs.length}{cancelJobs.length ? <> (<span className="mono">{cancelJobs.map((o) => ('jobId' in o ? o.jobId : '')).join(', ')}</span>)</> : null}</li>
        <li>Episodes whose unused approvals are revoked: {revokes.length}</li>
        <li>Episode state changes: {plan.operations.filter((o) => o.kind === 'transition_episode').length}</li>
        <li>Global pause: {plan.globalPause.recommended ? `recommended and applied by Run automatic steps (${plan.globalPause.reasons.join(', ')})` : 'not recommended'}</li>
      </ul>

      <h3>Owner review items (never automatic)</h3>
      {ownerOps.length === 0 ? <p className="muted">None.</p> : <ul>{ownerOps.map((o, i) => <li key={i}>{o.kind}{'reason' in o ? `: ${o.reason}` : ''}{'reasons' in o ? `: ${o.reasons.join(', ')}` : ''}</li>)}</ul>}

      <h3>Correction drafts for live posts</h3>
      {plan.episodes.filter((e) => e.correctionDraft).length === 0 ? <p className="muted">None.</p> : plan.episodes.filter((e) => e.correctionDraft).map((e) => (
        <div key={e.episodeId} className="card stack">
          <strong>{e.code}</strong> <Badge kind="warn">DRAFT, NOT POSTED</Badge>
          <div>{e.media.map((m) => <span key={m.permalink}>{media(m.label)}<span className="mono">{m.permalink}</span> </span>)}</div>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{e.correctionDraft!.noteText}</pre>
        </div>
      ))}
      <p className="muted">Live posts are never edited automatically. Any change to a live post needs a new owner approval for the exact wording.</p>
    </div>
  );
}

export { SourceBadge };
