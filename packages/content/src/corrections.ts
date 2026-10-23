/**
 * Corrections workflow planner (brief §3, last paragraph):
 *   flag the issue → suspend affected queued content automatically → identify
 *   related claims and episodes → prepare a correction for the owner → record
 *   the resolution. Changes to a live post require owner approval.
 *
 * `planCorrection` is pure and deterministic: no DB, no network, no clock except
 * the `now` argument. It never approves, never publishes and never edits a live
 * post. It produces a plan that the studio shows to the owner and that the DB
 * layer executes:
 *   - operations with `automatic: true` only ever *reduce* exposure (cancel a
 *     cancellable publish job, revoke an unused approval, hold or rework an
 *     unpublished episode) and may run without the owner;
 *   - operations with `automatic: false` are owner decisions (live corrections,
 *     in-flight publishes, the global pause) and must not run on their own.
 *
 * Input rows are treated as untrusted data. Source titles/URLs/notes are
 * flattened to a single line and length-capped before they enter any draft.
 *
 * Determinism: every input array is normalised (sorted by id, then by canonical
 * JSON) before use, and every output list is sorted, so `planSha256` depends only
 * on the trigger, the input *contents* and `now` — never on row order.
 */
import {
  CANCELLABLE_PUBLISH_STATES,
  MAIN_STATES,
  PUBLISHABLE_CLAIM_STATUSES,
  canonicalJson,
  checkTransition,
  hashCanonical,
  isHoldState,
  type Actor,
  type Claim,
  type ClaimEvidence,
  type ClaimStatus,
  type DataSource,
  type EpisodeLink,
  type EpisodeState,
  type EpisodeVersionContent,
  type MainState,
  type PublishJobState,
  type RiskTier,
  type Source,
} from '@life/contracts';
import { requiresIndependentOrigins, supportOrigins, versionClaimIds } from './gate';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type CorrectionTrigger =
  /** A claim was found wrong or its status was downgraded. */
  | { kind: 'claim'; claimId: string }
  /** A source was retracted, corrected or became unavailable. */
  | { kind: 'source'; sourceId: string }
  /** A whole evidence origin was discredited (every source sharing the originId). */
  | { kind: 'origin'; originId: string };

export interface CorrectionInputs {
  claims: Claim[];
  evidence: ClaimEvidence[];
  sources: Source[];
  episodes: Array<{ id: string; code: string; state: EpisodeState; currentVersionId: string | null }>;
  /** Current AND past versions. */
  versions: Array<{ id: string; episodeId: string; content: EpisodeVersionContent }>;
  links: EpisodeLink[];
  /**
   * `episodeVersionId` (via publish_jobs → release_packages.episode_version_id) is
   * optional. When absent the job is conservatively assumed to carry an affected
   * version whenever any version of the episode is affected.
   */
  publishJobs: Array<{ id: string; episodeId: string; state: PublishJobState; episodeVersionId?: string | null }>;
  /**
   * instagram_media rows. `episodeVersionId` (via publish_job → release_package) is
   * optional; when absent the post is conservatively assumed to show an affected
   * version whenever any version of the episode is affected.
   */
  liveMedia: Array<{
    episodeId: string;
    permalink: string;
    source: DataSource;
    episodeVersionId?: string | null;
    publishJobId?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Plan shape
// ---------------------------------------------------------------------------

export const CORRECTION_PLAN_SCHEMA_VERSION = 1 as const;

/** The actor the DB layer should record for automatic operations. */
export const CORRECTIONS_ACTOR: Actor = { kind: 'system', component: 'corrections' };

export type ClaimImpactReason =
  /** The claim named by a `claim` trigger. */
  | 'trigger_claim'
  /** Has `supports` evidence citing the discredited source. */
  | 'cites_discredited_source'
  /** Has `supports` evidence citing a source in the discredited origin (possibly a different source row). */
  | 'cites_discredited_origin'
  /** Had ≥2 independent origins, now has <2 and needs 2 (gate: insufficient_independent_origins). */
  | 'origin_independence_lost'
  /** Had valid support, now has none (gate: no valid supporting origin). */
  | 'no_remaining_support';

export interface AffectedClaim {
  claimId: string;
  topicId: string;
  text: string;
  status: ClaimStatus;
  statusReason: string | null;
  riskTier: RiskTier;
  reasons: ClaimImpactReason[];
  /** `supports` evidence rows that cite a discredited source. */
  discreditedEvidenceIds: string[];
  /** Valid supporting origins treating the discredited sources as still valid. */
  originsBefore: string[];
  /** Valid supporting origins with the discredited sources removed. */
  originsAfter: string[];
  requiresIndependentOrigins: boolean;
  /**
   * Whether the ledger, after removing the discredited evidence, could still
   * support the claim (publishable status, ≥1 origin, ≥2 if required). A
   * trigger claim the ledger still marks `supported` is treated as not supportable.
   */
  supportableAfter: boolean;
  episodeIds: string[];
  versionIds: string[];
}

export interface RelatedClaim {
  claimId: string;
  /** Informational only; related claims do not drive episode actions. */
  reason: 'shares_source_with_trigger_claim' | 'non_supporting_citation_of_discredited_source';
  sourceIds: string[];
}

export interface AffectedVersion {
  versionId: string;
  episodeId: string;
  versionNumber: number;
  isCurrent: boolean;
  uses: Array<{ claimId: string; inVersionClaimIds: boolean; beats: Array<{ index: number; role: string }> }>;
}

export type CorrectionAction =
  /** Unpublished and queued/approved/scheduled: cancel cancellable jobs, revoke unused approvals, hold as `blocked`. */
  | 'suspend'
  /** A publish is in flight (episode `publishing` or a job past the cancellable states): owner decides; nothing auto-cancelled mid-publish. */
  | 'hold_for_owner'
  /** A published post is affected: draft a correction for owner approval; nothing is edited. */
  | 'propose_live_correction'
  /** Draft states: back to `researching` / `scripted`. */
  | 'rework'
  /** Affected only historically (past version not live/queued) or already cancelled: recorded, no change. */
  | 'record_only';

export const CORRECTION_ACTIONS: readonly CorrectionAction[] = [
  'suspend',
  'hold_for_owner',
  'propose_live_correction',
  'rework',
  'record_only',
];

export type MediaLabel = 'LIVE' | 'MANUAL IMPORT' | 'MOCK';

export interface LabelledMedia {
  permalink: string;
  source: DataSource;
  label: MediaLabel;
  episodeVersionId: string | null;
  publishJobId: string | null;
}

/**
 * `public`: at least one affected live or manual-import post (a real post).
 * `mock_only`: only mock posts — never presented as a live launch.
 * `unknown`: the episode or a job says published but no media row was supplied; treated as public.
 * `none`: nothing posted.
 */
export type Exposure = 'public' | 'mock_only' | 'unknown' | 'none';

export interface CorrectionDraftSource {
  sourceId: string;
  role: 'discredited' | 'remaining_support';
  title: string;
  url: string;
  retracted: boolean;
  available: boolean;
  correctionNote: string | null;
}

export interface CorrectionDraft {
  /** Always this value: the draft has no effect until the owner approves an exact wording. */
  status: 'draft_requires_owner_approval';
  episodeId: string;
  episodeCode: string;
  exposure: Exposure;
  media: LabelledMedia[];
  whatWasWrong: string[];
  /** Only facts present in the ledger (status reasons, permitted wording, source correction notes). Never invented. */
  whatIsRight: string[];
  sources: CorrectionDraftSource[];
  /** A plain-text draft for the owner. Not a caption: the studio must not post it without an owner-approved edit. */
  noteText: string;
}

export interface EpisodeCorrection {
  episodeId: string;
  code: string;
  state: EpisodeState;
  action: CorrectionAction;
  causes: {
    /** Affected claims used by any version of this episode. */
    claimIds: string[];
    affectedVersionIds: string[];
    /** null when the episode has no current version. */
    currentVersionAffected: boolean | null;
    /** Affected episodes this episode's ending references (episode_links.endingReferencesRelated). */
    endingReferences: string[];
    /** n = first reached n ending-links away from a claim-affected episode; null = not reached via links. */
    linkDepth: number | null;
  };
  /** Cancellable (queued/gate_check/retry_wait) affected jobs to cancel automatically. */
  cancelJobIds: string[];
  /** Affected jobs past the cancellable states and not terminal — never auto-cancelled. */
  inFlightJobIds: string[];
  /** Affected jobs in state `published`. */
  publishedJobIds: string[];
  /** Revoke every unrevoked approval of this episode not referenced by an in-flight or published job. */
  revokeUnusedApprovals: boolean;
  /** Automatic state change, already validated with `checkTransition`; null = none. */
  transition: { from: EpisodeState; to: EpisodeState; heldFrom: MainState | null; reason: string } | null;
  exposure: Exposure;
  media: LabelledMedia[];
  correctionDraft: CorrectionDraft | null;
  ownerDecisionRequired: boolean;
  notes: string[];
}

export type CorrectionOperation =
  | { kind: 'cancel_publish_job'; automatic: true; episodeId: string; jobId: string; fromState: PublishJobState; reason: string }
  | { kind: 'revoke_unused_approvals'; automatic: true; episodeId: string; reason: string }
  | {
      kind: 'transition_episode';
      automatic: true;
      episodeId: string;
      from: EpisodeState;
      to: EpisodeState;
      heldFrom: MainState | null;
      reason: string;
    }
  | { kind: 'owner_review_in_flight_publish'; automatic: false; episodeId: string; jobIds: string[]; reason: string }
  | { kind: 'owner_review_live_correction'; automatic: false; episodeId: string; exposure: Exposure; reason: string }
  | { kind: 'owner_review_global_pause'; automatic: false; reasons: GlobalPauseReason[] };

export const CORRECTION_OPERATION_KINDS: readonly CorrectionOperation['kind'][] = [
  'cancel_publish_job',
  'revoke_unused_approvals',
  'transition_episode',
  'owner_review_in_flight_publish',
  'owner_review_live_correction',
  'owner_review_global_pause',
];

export type CorrectionSeverity = 'none' | 'low' | 'elevated' | 'high' | 'critical';
export type GlobalPauseReason = 'high_risk_claim_affected' | 'public_post_affected' | 'publish_in_flight';

export interface CorrectionPlan {
  schemaVersion: typeof CORRECTION_PLAN_SCHEMA_VERSION;
  trigger: CorrectionTrigger;
  generatedAt: string;
  discredited: {
    /** Sources whose evidence is removed for the "after" view. Empty for a claim trigger. */
    sourceIds: string[];
    originIds: string[];
    /** Source trigger only: other sources sharing the origin, which the owner should check (not removed). */
    sameOriginSourceIds: string[];
  };
  affectedClaims: AffectedClaim[];
  relatedClaims: RelatedClaim[];
  affectedVersions: AffectedVersion[];
  episodes: EpisodeCorrection[];
  /** Ordered for execution: per episode cancel → revoke → transition; owner reviews last. */
  operations: CorrectionOperation[];
  severity: CorrectionSeverity;
  maxRiskTier: RiskTier | null;
  globalPause: { recommended: boolean; reasons: GlobalPauseReason[] };
  ownerReviewRequired: boolean;
  warnings: string[];
  summary: string;
  /** hashCanonical of the plan with this field omitted. */
  planSha256: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_RANK: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2 };
const IN_FLIGHT_JOB_STATES: readonly PublishJobState[] = [
  'creating_container',
  'processing',
  'publishing',
  'confirming',
  'needs_reconciliation',
];
const LIVE_EPISODE_STATES: readonly EpisodeState[] = ['published', 'measuring'];
const MEDIA_LABEL: Record<DataSource, MediaLabel> = { live: 'LIVE', manual_import: 'MANUAL IMPORT', mock: 'MOCK' };
const MAX_TEXT = 400;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort(cmp);

/** Sort rows by a key, then by canonical JSON, so duplicates resolve the same way whatever the input order. */
function normalise<T>(rows: readonly T[], key: (r: T) => string): T[] {
  return rows
    .map((r) => ({ r, k: key(r), j: canonicalJson(r) }))
    .sort((a, b) => cmp(a.k, b.k) || cmp(a.j, b.j))
    .map((x) => x.r);
}

/** First row per id after normalisation; duplicates are reported. */
function index<T>(rows: readonly T[], key: (r: T) => string, label: string, warnings: string[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    if (m.has(k)) warnings.push(`duplicate ${label} ${k} in inputs; using one deterministic row`);
    else m.set(k, r);
  }
  return m;
}

/** Untrusted text → one line, capped. */
function flat(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  // eslint-disable-next-line no-control-regex
  const one = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one.length > MAX_TEXT ? `${one.slice(0, MAX_TEXT - 3)}...` : one;
}

const blank = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim() === '';

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planCorrection(trigger: CorrectionTrigger, inputs: CorrectionInputs, now: Date): CorrectionPlan {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('planCorrection: now must be a valid Date');
  const warnings: string[] = [];

  const claimsArr = normalise(inputs.claims, (c) => c.id);
  const evidenceArr = normalise(inputs.evidence, (e) => e.id);
  const sourcesArr = normalise(inputs.sources, (s) => s.id);
  const episodesArr = normalise(inputs.episodes, (e) => e.id);
  const versionsArr = normalise(inputs.versions, (v) => v.id);
  const linksArr = normalise(inputs.links, (l) => l.episodeId);
  const jobsArr = normalise(inputs.publishJobs, (j) => j.id);
  const mediaArr = normalise(inputs.liveMedia, (m) => `${m.episodeId}\u0000${m.permalink}`);

  const claims = index(claimsArr, (c) => c.id, 'claim', warnings);
  index(evidenceArr, (e) => e.id, 'evidence', warnings);
  const sources = index(sourcesArr, (s) => s.id, 'source', warnings);
  const episodes = index(episodesArr, (e) => e.id, 'episode', warnings);
  const versions = index(versionsArr, (v) => v.id, 'version', warnings);
  index(linksArr, (l) => l.episodeId, 'episode link', warnings);
  index(jobsArr, (j) => j.id, 'publish job', warnings);

  const evidenceByClaim = new Map<string, ClaimEvidence[]>();
  for (const e of evidenceArr) {
    const list = evidenceByClaim.get(e.claimId) ?? [];
    list.push(e);
    evidenceByClaim.set(e.claimId, list);
  }

  // --- 1. What is discredited ---------------------------------------------
  const discreditedSourceIds = new Set<string>();
  const discreditedOriginIds = new Set<string>();
  const sameOriginSourceIds = new Set<string>();
  const directClaimIds = new Set<string>();

  if (trigger.kind === 'claim') {
    const c = claims.get(trigger.claimId);
    if (!c) warnings.push(`trigger claim ${trigger.claimId} is not in the inputs; nothing can be traced`);
    else {
      directClaimIds.add(c.id);
      if (c.status === 'supported') {
        warnings.push(`claim ${c.id} is flagged but the ledger still marks it supported; update its status and statusReason`);
      }
    }
  } else if (trigger.kind === 'source') {
    const s = sources.get(trigger.sourceId);
    discreditedSourceIds.add(trigger.sourceId);
    if (!s) warnings.push(`trigger source ${trigger.sourceId} is not in the inputs; evidence citing it is still traced`);
    else {
      discreditedOriginIds.add(s.originId);
      for (const o of sourcesArr) if (o.originId === s.originId && o.id !== s.id) sameOriginSourceIds.add(o.id);
      if (s.available && !s.retracted && blank(s.correctionNote)) {
        warnings.push(`source ${s.id} is flagged but the ledger shows it available, unretracted and uncorrected; record what changed`);
      }
    }
  } else {
    discreditedOriginIds.add(trigger.originId);
    for (const s of sourcesArr) if (s.originId === trigger.originId) discreditedSourceIds.add(s.id);
    if (discreditedSourceIds.size === 0) warnings.push(`no source in the inputs has origin ${trigger.originId}; nothing can be traced`);
  }

  // --- 2. Affected claims (direct, by citation, and by origin loss) --------
  const claimImpacts = new Map<string, { reasons: Set<ClaimImpactReason>; evidenceIds: Set<string> }>();
  const impact = (id: string) => {
    let x = claimImpacts.get(id);
    if (!x) claimImpacts.set(id, (x = { reasons: new Set(), evidenceIds: new Set() }));
    return x;
  };
  for (const id of directClaimIds) impact(id).reasons.add('trigger_claim');

  const relatedClaims = new Map<string, { reason: RelatedClaim['reason']; sourceIds: Set<string> }>();
  if (discreditedSourceIds.size > 0) {
    for (const e of evidenceArr) {
      if (!discreditedSourceIds.has(e.sourceId)) continue;
      if (e.stance === 'supports') {
        const x = impact(e.claimId);
        x.evidenceIds.add(e.id);
        const viaOrigin = trigger.kind === 'origin' || (trigger.kind === 'source' && e.sourceId !== trigger.sourceId);
        x.reasons.add(viaOrigin ? 'cites_discredited_origin' : 'cites_discredited_source');
      } else {
        const r = relatedClaims.get(e.claimId) ?? { reason: 'non_supporting_citation_of_discredited_source', sourceIds: new Set() };
        r.sourceIds.add(e.sourceId);
        relatedClaims.set(e.claimId, r);
      }
    }
  }
  if (trigger.kind === 'claim' && claims.has(trigger.claimId)) {
    const triggerSources = new Set(
      (evidenceByClaim.get(trigger.claimId) ?? []).filter((e) => e.stance === 'supports').map((e) => e.sourceId),
    );
    for (const e of evidenceArr) {
      if (e.claimId === trigger.claimId || e.stance !== 'supports' || !triggerSources.has(e.sourceId)) continue;
      const r = relatedClaims.get(e.claimId) ?? { reason: 'shares_source_with_trigger_claim', sourceIds: new Set() };
      r.sourceIds.add(e.sourceId);
      relatedClaims.set(e.claimId, r);
    }
  }
  for (const id of claimImpacts.keys()) relatedClaims.delete(id);

  // Origin accounting, reusing the evidence gate's rules.
  const claimOrigins = new Map<string, { before: Set<string>; after: Set<string> }>();
  for (const [id, x] of claimImpacts) {
    const c = claims.get(id);
    if (!c) {
      warnings.push(`evidence cites claim ${id}, which is not in the inputs`);
      continue;
    }
    const ev = evidenceByClaim.get(id) ?? [];
    const before = supportOrigins(ev, sources, { assumeValid: discreditedSourceIds });
    const after = supportOrigins(ev, sources, { exclude: discreditedSourceIds });
    claimOrigins.set(id, { before, after });
    if (before.size > 0 && after.size === 0) x.reasons.add('no_remaining_support');
    if (requiresIndependentOrigins(c) && before.size >= 2 && after.size < 2) x.reasons.add('origin_independence_lost');
  }
  const affectedClaimIds = sorted([...claimImpacts.keys()].filter((id) => claims.has(id)));
  const affectedClaimSet = new Set(affectedClaimIds);

  // --- 3. Affected versions (current and past) ---------------------------
  const affectedVersions: AffectedVersion[] = [];
  const versionsByEpisode = new Map<string, Set<string>>();
  const claimsByEpisode = new Map<string, Set<string>>();
  const claimUsage = new Map<string, { episodes: Set<string>; versions: Set<string> }>();
  for (const v of versions.values()) {
    if (v.content.episodeId !== v.episodeId) {
      warnings.push(`version ${v.id} row episode ${v.episodeId} differs from its content episode ${v.content.episodeId}; using the row`);
    }
    const used = versionClaimIds(v.content).filter((id) => affectedClaimSet.has(id));
    if (used.length === 0) continue;
    const ep = episodes.get(v.episodeId);
    if (!ep) warnings.push(`version ${v.id} belongs to episode ${v.episodeId}, which is not in the inputs`);
    const listed = new Set(v.content.claimIds);
    affectedVersions.push({
      versionId: v.id,
      episodeId: v.episodeId,
      versionNumber: v.content.versionNumber,
      isCurrent: !!ep && ep.currentVersionId === v.id,
      uses: sorted(used).map((claimId) => ({
        claimId,
        inVersionClaimIds: listed.has(claimId),
        beats: v.content.beats.flatMap((b, i) => (b.claimIds.includes(claimId) ? [{ index: i, role: b.role }] : [])),
      })),
    });
    for (const id of used) {
      const u = claimUsage.get(id) ?? { episodes: new Set(), versions: new Set() };
      u.episodes.add(v.episodeId);
      u.versions.add(v.id);
      claimUsage.set(id, u);
    }
    if (ep) {
      (versionsByEpisode.get(v.episodeId) ?? versionsByEpisode.set(v.episodeId, new Set()).get(v.episodeId)!).add(v.id);
      const cs = claimsByEpisode.get(v.episodeId) ?? new Set<string>();
      used.forEach((id) => cs.add(id));
      claimsByEpisode.set(v.episodeId, cs);
    }
  }
  affectedVersions.sort((a, b) => cmp(a.episodeId, b.episodeId) || a.versionNumber - b.versionNumber || cmp(a.versionId, b.versionId));

  const affectedClaims: AffectedClaim[] = affectedClaimIds.map((id) => {
    const c = claims.get(id)!;
    const x = claimImpacts.get(id)!;
    const o = claimOrigins.get(id)!;
    const needs = requiresIndependentOrigins(c);
    const flaggedStillSupported = x.reasons.has('trigger_claim') && c.status === 'supported';
    const supportableAfter =
      !flaggedStillSupported && PUBLISHABLE_CLAIM_STATUSES.includes(c.status) && o.after.size >= 1 && (!needs || o.after.size >= 2);
    const u = claimUsage.get(id);
    return {
      claimId: id,
      topicId: c.topicId,
      text: c.text,
      status: c.status,
      statusReason: c.statusReason,
      riskTier: c.riskTier,
      reasons: REASON_ORDER.filter((r) => x.reasons.has(r)),
      discreditedEvidenceIds: sorted(x.evidenceIds),
      originsBefore: sorted(o.before),
      originsAfter: sorted(o.after),
      requiresIndependentOrigins: needs,
      supportableAfter,
      episodeIds: sorted(u?.episodes ?? []),
      versionIds: sorted(u?.versions ?? []),
    };
  });
  const affectedClaimById = new Map(affectedClaims.map((c) => [c.claimId, c]));

  // --- 4. Episode actions, then propagation through linked endings -------
  const jobsByEpisode = new Map<string, CorrectionInputs['publishJobs']>();
  for (const j of jobsArr) (jobsByEpisode.get(j.episodeId) ?? jobsByEpisode.set(j.episodeId, []).get(j.episodeId)!).push(j);
  const mediaByEpisode = new Map<string, CorrectionInputs['liveMedia']>();
  for (const m of mediaArr) (mediaByEpisode.get(m.episodeId) ?? mediaByEpisode.set(m.episodeId, []).get(m.episodeId)!).push(m);

  const ctx: DecideCtx = {
    discreditedSourceIds,
    sources,
    claims,
    evidenceByClaim,
    affectedClaimById,
    episodes,
    jobsByEpisode,
    mediaByEpisode,
    versionsByEpisode,
    claimsByEpisode,
  };

  const results = new Map<string, EpisodeCorrection>();
  const linkInfo = new Map<string, { refs: Set<string>; depth: number }>();
  const queue: Array<{ id: string; depth: number }> = [];
  const propagates = (r: EpisodeCorrection, contentOnly: EpisodeCorrection | null): boolean =>
    r.action === 'suspend' ||
    r.action === 'hold_for_owner' ||
    r.action === 'rework' ||
    (r.action === 'propose_live_correction' && !!contentOnly && contentOnly.action !== 'record_only');

  for (const epId of sorted(claimsByEpisode.keys())) {
    const r = decide(ctx, epId, null);
    results.set(epId, r);
    if (propagates(r, r)) queue.push({ id: epId, depth: 0 });
  }

  // Breadth-first: an episode whose ending references an affected (and not merely historical) episode is affected too.
  for (let qi = 0; qi < queue.length; qi++) {
    const { id: target, depth } = queue[qi]!;
    for (const l of linksArr) {
      if (!l.endingReferencesRelated || l.relatedEpisodeId !== target || l.episodeId === target) continue;
      if (!episodes.has(l.episodeId)) {
        warnings.push(`episode link from ${l.episodeId} references ${target}, but ${l.episodeId} is not in the inputs`);
        continue;
      }
      const prev = linkInfo.get(l.episodeId);
      if (prev) {
        // Same BFS level may add more references; deeper ones do not change the depth.
        if (prev.depth === depth + 1) prev.refs.add(target);
        continue;
      }
      linkInfo.set(l.episodeId, { refs: new Set([target]), depth: depth + 1 });
      const contentOnly = claimsByEpisode.has(l.episodeId) ? decide(ctx, l.episodeId, null) : null;
      const r = decide(ctx, l.episodeId, linkInfo.get(l.episodeId)!);
      results.set(l.episodeId, r);
      if (!(contentOnly && propagates(contentOnly, contentOnly)) && propagates(r, contentOnly)) {
        queue.push({ id: l.episodeId, depth: depth + 1 });
      }
    }
  }
  // Recompute link-affected episodes once all references are known (refs may have grown at the same depth).
  for (const [id, info] of linkInfo) results.set(id, decide(ctx, id, info));

  for (const l of linksArr) {
    if (l.endingReferencesRelated && l.relatedEpisodeId && !episodes.has(l.relatedEpisodeId)) {
      warnings.push(`episode ${l.episodeId}'s ending references ${l.relatedEpisodeId}, which is not in the inputs`);
    }
  }

  const episodeResults = [...results.values()].sort((a, b) => cmp(a.code, b.code) || cmp(a.episodeId, b.episodeId));

  // --- 5. Severity, pause, operations, summary ---------------------------
  let maxTier: RiskTier | null = null;
  for (const c of affectedClaims) if (maxTier === null || TIER_RANK[c.riskTier] > TIER_RANK[maxTier]) maxTier = c.riskTier;

  const publicLive = episodeResults.some(
    (e) => e.action === 'propose_live_correction' && (e.exposure === 'public' || e.exposure === 'unknown'),
  );
  const inFlight = episodeResults.some((e) => e.action === 'hold_for_owner' || e.inFlightJobIds.length > 0);
  const highRisk = maxTier === 'high';

  const pauseReasons: GlobalPauseReason[] = [];
  if (highRisk) pauseReasons.push('high_risk_claim_affected');
  if (publicLive) pauseReasons.push('public_post_affected');
  if (inFlight) pauseReasons.push('publish_in_flight');

  let severity: CorrectionSeverity;
  if (affectedClaims.length === 0 && episodeResults.length === 0) severity = 'none';
  else if (highRisk && publicLive) severity = 'critical';
  else if (highRisk || publicLive) severity = 'high';
  else if (maxTier === 'elevated' || inFlight || episodeResults.some((e) => e.action === 'suspend' || e.action === 'propose_live_correction')) {
    severity = 'elevated';
  } else severity = 'low';

  const operations: CorrectionOperation[] = [];
  for (const e of episodeResults) {
    for (const jobId of e.cancelJobIds) {
      const j = jobsArr.find((x) => x.id === jobId)!;
      operations.push({
        kind: 'cancel_publish_job',
        automatic: true,
        episodeId: e.episodeId,
        jobId,
        fromState: j.state,
        reason: `correction: ${describeTrigger(trigger)}`,
      });
    }
    if (e.revokeUnusedApprovals) {
      operations.push({ kind: 'revoke_unused_approvals', automatic: true, episodeId: e.episodeId, reason: `correction: ${describeTrigger(trigger)}` });
    }
    if (e.transition) operations.push({ kind: 'transition_episode', automatic: true, episodeId: e.episodeId, ...e.transition });
  }
  for (const e of episodeResults) {
    if (e.action === 'hold_for_owner' || e.inFlightJobIds.length > 0) {
      operations.push({
        kind: 'owner_review_in_flight_publish',
        automatic: false,
        episodeId: e.episodeId,
        jobIds: e.inFlightJobIds,
        reason: `a publish for ${e.code} is in flight; reconcile against the account, then decide whether to let it finish and correct, or stop it`,
      });
    }
    if (e.action === 'propose_live_correction') {
      operations.push({
        kind: 'owner_review_live_correction',
        automatic: false,
        episodeId: e.episodeId,
        exposure: e.exposure,
        reason: `review the draft correction for ${e.code}; nothing on the post changes without owner approval`,
      });
    }
  }
  if (pauseReasons.length > 0) operations.push({ kind: 'owner_review_global_pause', automatic: false, reasons: pauseReasons });

  const ownerReviewRequired = operations.some((o) => !o.automatic);

  const body: Omit<CorrectionPlan, 'planSha256'> = {
    schemaVersion: CORRECTION_PLAN_SCHEMA_VERSION,
    trigger: normaliseTrigger(trigger),
    generatedAt: now.toISOString(),
    discredited: {
      sourceIds: sorted(discreditedSourceIds),
      originIds: sorted(discreditedOriginIds),
      sameOriginSourceIds: sorted(sameOriginSourceIds),
    },
    affectedClaims,
    relatedClaims: sorted(relatedClaims.keys()).map((claimId) => ({
      claimId,
      reason: relatedClaims.get(claimId)!.reason,
      sourceIds: sorted(relatedClaims.get(claimId)!.sourceIds),
    })),
    affectedVersions,
    episodes: episodeResults,
    operations,
    severity,
    maxRiskTier: maxTier,
    globalPause: { recommended: pauseReasons.length > 0, reasons: pauseReasons },
    ownerReviewRequired,
    warnings: sorted(warnings),
    summary: summarise(trigger, affectedClaims, episodeResults, severity, maxTier, pauseReasons),
  };
  // The hash covers what the plan does, not when it was computed, so a preview and a later re-plan of the same data match.
  const { generatedAt: _at, ...hashed } = body;
  return { ...body, planSha256: hashCanonical(hashed) };
}

const REASON_ORDER: readonly ClaimImpactReason[] = [
  'trigger_claim',
  'cites_discredited_source',
  'cites_discredited_origin',
  'origin_independence_lost',
  'no_remaining_support',
];

function normaliseTrigger(t: CorrectionTrigger): CorrectionTrigger {
  if (t.kind === 'claim') return { kind: 'claim', claimId: t.claimId };
  if (t.kind === 'source') return { kind: 'source', sourceId: t.sourceId };
  return { kind: 'origin', originId: t.originId };
}

function describeTrigger(t: CorrectionTrigger): string {
  if (t.kind === 'claim') return `claim ${t.claimId} flagged`;
  if (t.kind === 'source') return `source ${t.sourceId} flagged`;
  return `evidence origin ${t.originId} discredited`;
}

// ---------------------------------------------------------------------------
// Per-episode decision
// ---------------------------------------------------------------------------

interface DecideCtx {
  discreditedSourceIds: Set<string>;
  sources: Map<string, Source>;
  claims: Map<string, Claim>;
  evidenceByClaim: Map<string, ClaimEvidence[]>;
  affectedClaimById: Map<string, AffectedClaim>;
  episodes: Map<string, CorrectionInputs['episodes'][number]>;
  jobsByEpisode: Map<string, CorrectionInputs['publishJobs']>;
  mediaByEpisode: Map<string, CorrectionInputs['liveMedia']>;
  versionsByEpisode: Map<string, Set<string>>;
  claimsByEpisode: Map<string, Set<string>>;
}

function decide(ctx: DecideCtx, episodeId: string, link: { refs: Set<string>; depth: number } | null): EpisodeCorrection {
  const ep = ctx.episodes.get(episodeId)!;
  const affectedVer = ctx.versionsByEpisode.get(episodeId) ?? new Set<string>();
  const claimIds = sorted(ctx.claimsByEpisode.get(episodeId) ?? []);
  const linked = !!link;
  const notes: string[] = [];

  /** Whether content carrying this version is affected. Unknown version → affected if any version is. */
  const versionAffected = (vid: string | null | undefined): boolean =>
    linked || (vid ? affectedVer.has(vid) : affectedVer.size > 0);
  const currentAffected = versionAffected(ep.currentVersionId);

  const jobs = (ctx.jobsByEpisode.get(episodeId) ?? []).filter((j) => versionAffected(j.episodeVersionId ?? null));
  const cancelJobIds = sorted(jobs.filter((j) => CANCELLABLE_PUBLISH_STATES.includes(j.state)).map((j) => j.id));
  const inFlightJobIds = sorted(jobs.filter((j) => IN_FLIGHT_JOB_STATES.includes(j.state)).map((j) => j.id));
  const publishedJobIds = sorted(jobs.filter((j) => j.state === 'published').map((j) => j.id));

  const allMedia = ctx.mediaByEpisode.get(episodeId) ?? [];
  const media: LabelledMedia[] = allMedia
    .filter((m) => versionAffected(m.episodeVersionId ?? null))
    .map((m) => ({
      permalink: flat(m.permalink),
      source: m.source,
      label: MEDIA_LABEL[m.source],
      episodeVersionId: m.episodeVersionId ?? null,
      publishJobId: m.publishJobId ?? null,
    }))
    .sort((a, b) => cmp(a.permalink, b.permalink) || cmp(a.source, b.source));

  const liveState = LIVE_EPISODE_STATES.includes(ep.state);
  let exposure: Exposure = 'none';
  if (media.some((m) => m.source !== 'mock')) exposure = 'public';
  else if (media.length > 0) exposure = 'mock_only';
  else if ((liveState && allMedia.length === 0 && currentAffected) || publishedJobIds.length > 0) {
    exposure = 'unknown';
    notes.push('the episode or a publish job says published but no instagram_media row was supplied; treated as a public post until reconciled');
  }

  let action: CorrectionAction;
  if (exposure !== 'none') action = 'propose_live_correction';
  else if (inFlightJobIds.length > 0 || (ep.state === 'publishing' && currentAffected)) action = 'hold_for_owner';
  else if (cancelJobIds.length > 0 || ((ep.state === 'approved' || ep.state === 'scheduled') && currentAffected)) action = 'suspend';
  else if (liveState || ep.state === 'cancelled' || !currentAffected) action = 'record_only';
  else action = 'rework';

  if (action === 'record_only') {
    if (liveState) notes.push('the live post carries a version that does not use an affected claim');
    else if (ep.state === 'cancelled') notes.push('episode is cancelled; recorded for audit only');
    else notes.push('only past versions use an affected claim; the current version is unaffected');
  }

  // Needs research (vs. a script/ending fix) when any of its affected claims cannot be supported any more.
  const needsResearch = claimIds.some((id) => !ctx.affectedClaimById.get(id)?.supportableAfter);
  const reason = linked && claimIds.length === 0
    ? `correction: ending references affected episode(s) ${sorted(link.refs).join(', ')}`
    : `correction: uses affected claim(s) ${claimIds.join(', ')}`;

  let transition: EpisodeCorrection['transition'] = null;
  if (action === 'suspend' || action === 'rework') {
    let candidates: EpisodeState[];
    if (action === 'suspend') candidates = ['blocked'];
    else candidates = needsResearch ? ['researching', 'scripted'] : ['scripted', 'researching'];
    if (isHoldState(ep.state)) {
      notes.push(
        `episode is already ${ep.state}; when resuming, resume only to ${needsResearch ? 'researching' : 'scripted'} (approvals are revoked)`,
      );
    } else {
      for (const to of candidates) {
        if (to === ep.state) {
          notes.push(`episode is already in ${to}`);
          break;
        }
        // Rework only ever moves backwards; it never advances an episode.
        if (action === 'rework' && !isBackward(ep.state, to)) continue;
        const heldFrom = isHoldState(to) ? (ep.state as MainState) : null;
        const ok = checkTransition({ from: ep.state, to, actor: CORRECTIONS_ACTOR, reason, heldFrom });
        if (ok.ok) {
          transition = { from: ep.state, to, heldFrom, reason };
          break;
        }
      }
      if (!transition && !notes.some((n) => n.startsWith('episode is already'))) {
        notes.push(`no allowed automatic transition from ${ep.state}; the owner must move it`);
      }
    }
    if (action === 'suspend') notes.push('approvals are revoked; resume only to researching or scripted, never straight back to approved');
  }
  if (action === 'hold_for_owner') {
    notes.push('a publish is in flight: in-flight jobs are not cancelled automatically; reconcile against the account before any retry');
  }

  const revokeUnusedApprovals = action !== 'record_only';
  const ownerDecisionRequired = action === 'hold_for_owner' || action === 'propose_live_correction';

  const correctionDraft =
    action === 'propose_live_correction' ? draftCorrection(ctx, ep, claimIds, link ? sorted(link.refs) : [], exposure, media) : null;

  return {
    episodeId,
    code: ep.code,
    state: ep.state,
    action,
    causes: {
      claimIds,
      affectedVersionIds: sorted(affectedVer),
      currentVersionAffected: ep.currentVersionId === null ? null : affectedVer.has(ep.currentVersionId),
      endingReferences: link ? sorted(link.refs) : [],
      linkDepth: link ? link.depth : null,
    },
    cancelJobIds,
    inFlightJobIds,
    publishedJobIds,
    revokeUnusedApprovals,
    transition,
    exposure,
    media,
    correctionDraft,
    ownerDecisionRequired,
    notes: sorted(notes),
  };
}

const MAIN_RANK = new Map<string, number>(MAIN_STATES.map((s, i) => [s, i]));
function isBackward(from: EpisodeState, to: EpisodeState): boolean {
  const a = MAIN_RANK.get(from);
  const b = MAIN_RANK.get(to);
  return a !== undefined && b !== undefined && b < a;
}

function draftCorrection(
  ctx: DecideCtx,
  ep: CorrectionInputs['episodes'][number],
  claimIds: string[],
  endingRefs: string[],
  exposure: Exposure,
  media: LabelledMedia[],
): CorrectionDraft {
  const wrong: string[] = [];
  const right: string[] = [];
  const srcRows = new Map<string, CorrectionDraftSource>();
  const addSource = (s: Source, role: CorrectionDraftSource['role']) => {
    const key = `${role}\u0000${s.id}`;
    if (srcRows.has(key)) return;
    srcRows.set(key, {
      sourceId: s.id,
      role,
      title: flat(s.title),
      url: flat(s.url),
      retracted: s.retracted,
      available: s.available,
      correctionNote: blank(s.correctionNote) ? null : flat(s.correctionNote),
    });
  };

  for (const id of claimIds) {
    const a = ctx.affectedClaimById.get(id)!;
    const why: string[] = [];
    if (a.reasons.includes('trigger_claim')) why.push(`the claim is now ${a.status}${blank(a.statusReason) ? '' : ` (${flat(a.statusReason)})`}`);
    if (a.reasons.includes('cites_discredited_source') || a.reasons.includes('cites_discredited_origin')) {
      why.push('it relied on a source that has been retracted, corrected, made unavailable or discredited');
    }
    if (a.reasons.includes('no_remaining_support')) why.push('no valid supporting evidence remains');
    else if (a.reasons.includes('origin_independence_lost')) why.push('it no longer has two independent evidence origins');
    wrong.push(`"${flat(a.text)}": ${why.join('; ')}.`);

    const c = ctx.claims.get(id)!;
    if (a.supportableAfter) {
      right.push(
        `"${flat(c.text)}" remains supported by the remaining evidence${blank(c.permittedWording) ? '' : `; permitted wording: "${flat(c.permittedWording)}"`}${blank(c.limitations) ? '' : `; limits: ${flat(c.limitations)}`}.`,
      );
    }
    for (const e of ctx.evidenceByClaim.get(id) ?? []) {
      const s = ctx.sources.get(e.sourceId);
      if (!s) continue;
      if (ctx.discreditedSourceIds.has(s.id)) {
        if (e.stance === 'supports') addSource(s, 'discredited');
        if (!blank(s.correctionNote)) right.push(`Source "${flat(s.title)}" correction note: ${flat(s.correctionNote)}`);
      } else if (e.stance === 'supports' && s.available && !s.retracted && a.supportableAfter) addSource(s, 'remaining_support');
    }
  }
  for (const ref of endingRefs) {
    const other = ctx.episodes.get(ref);
    wrong.push(`The ending points to ${other ? other.code : ref}, which is itself under correction.`);
  }
  const whatIsRight = [...new Set(right)].sort(cmp);
  if (whatIsRight.length === 0) {
    whatIsRight.push('Not yet established. Research is required before any corrected statement is published.');
  }
  const whatWasWrong = [...new Set(wrong)].sort(cmp);
  const sources = [...srcRows.values()].sort((a, b) => cmp(a.role, b.role) || cmp(a.sourceId, b.sourceId));

  const mediaLine =
    media.length === 0
      ? 'Post: no media record supplied (treat as live until reconciled).'
      : `Post(s): ${media.map((m) => `[${m.label}] ${m.permalink}`).join(', ')}`;
  const lines = [
    '[DRAFT CORRECTION - requires owner approval; nothing on the post has been changed]',
    ...(exposure === 'mock_only' ? ['[MOCK POST - not a live launch; no public correction is needed]'] : []),
    `Episode ${ep.code}`,
    mediaLine,
    'What was wrong:',
    ...whatWasWrong.map((w) => `- ${w}`),
    'What we now know:',
    ...whatIsRight.map((w) => `- ${w}`),
    'Sources:',
    ...(sources.length === 0
      ? ['- (none recorded)']
      : sources.map(
          (s) =>
            `- ${s.role === 'discredited' ? 'Discredited' : 'Remaining support'}: ${s.title} (${s.url})${s.retracted ? ' [retracted]' : ''}${s.available ? '' : ' [unavailable]'}${s.correctionNote ? ` [correction: ${s.correctionNote}]` : ''}`,
        )),
  ];

  return {
    status: 'draft_requires_owner_approval',
    episodeId: ep.id,
    episodeCode: ep.code,
    exposure,
    media,
    whatWasWrong,
    whatIsRight,
    sources,
    noteText: lines.join('\n'),
  };
}

function summarise(
  trigger: CorrectionTrigger,
  claims: AffectedClaim[],
  episodes: EpisodeCorrection[],
  severity: CorrectionSeverity,
  maxTier: RiskTier | null,
  pause: GlobalPauseReason[],
): string {
  const count = (a: CorrectionAction) => episodes.filter((e) => e.action === a).length;
  const live = episodes.filter((e) => e.action === 'propose_live_correction');
  const labels = sorted(live.flatMap((e) => (e.media.length ? e.media.map((m) => m.label) : ['UNKNOWN'])));
  const parts = [
    `Correction plan (${describeTrigger(trigger)}): severity ${severity}.`,
    `${claims.length} claim(s) affected${maxTier ? ` (max risk ${maxTier})` : ''}; ${episodes.length} episode(s) traced.`,
    `Actions: ${count('suspend')} suspend, ${count('hold_for_owner')} hold for owner, ${count('propose_live_correction')} live correction draft(s)${labels.length ? ` [${labels.join(', ')}]` : ''}, ${count('rework')} rework, ${count('record_only')} record only.`,
    pause.length ? `Global publishing pause recommended (${pause.join(', ')}).` : 'Global publishing pause not recommended.',
    'This plan grants no approval and changes no live post; live corrections need the owner.',
  ];
  return parts.join(' ');
}
