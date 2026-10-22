import {
  Claim as ClaimSchema,
  ClaimEvidence as ClaimEvidenceSchema,
  EpisodeVersionContent as EpisodeVersionContentSchema,
  PUBLISHABLE_CLAIM_STATUSES,
  ReviewRecord as ReviewRecordSchema,
  Source as SourceSchema,
  Topic as TopicSchema,
  type Claim,
  type ClaimEvidence,
  type EpisodeVersionContent,
  type ReviewRecord,
  type RiskTier,
  type Source,
} from '@life/contracts';
import type { z } from 'zod';
import { claimLedgerSha256 } from './ledger';
import {
  BADGE_PATTERNS,
  containsPhrase,
  findCausalLanguage,
  findCaveatKeyword,
  findNumber,
  findPatterns,
} from './text';
import { IssueList, type EvidencePacket, type GateIssue, type GateReport } from './types';

/** Changing product/policy/news facts must be rechecked within this window (brief §3.9). */
export const CHANGING_CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Every evidence-gate issue code. Each one blocks publication; there are no warnings.
 * Allowed exceptions (a justified single origin) are reported by `listEvidenceAllowances`.
 */
export const EVIDENCE_ISSUE_CODES = [
  'schema_invalid',
  'duplicate_id',
  'ledger_hash_mismatch',
  'unknown_claim',
  'claim_topic_mismatch',
  'beat_claim_not_in_version',
  'claim_not_publishable',
  'unknown_source',
  'claim_without_support',
  'evidence_missing_passage',
  'source_unavailable',
  'source_retracted',
  'retraction_unchecked',
  'insufficient_independent_origins',
  'contradiction_unaddressed',
  'limitations_missing',
  'changing_claim_not_rechecked',
  'claim_stale',
  'unsupported_number',
  'causal_overclaim',
  'caveat_missing',
  'missing_ai_verification',
  'missing_qualified_review',
  'unauthorized_badge',
] as const;
export type EvidenceIssueCode = (typeof EVIDENCE_ISSUE_CODES)[number];

const TIER_RANK: Record<RiskTier, number> = { low: 0, elevated: 1, high: 2 };
const PASSING = new Set<ReviewRecord['verdict']>(['pass', 'pass_with_changes']);

const blank = (s: string | null | undefined): boolean => s === null || s === undefined || s.trim() === '';

export interface EvidenceGateInput {
  packet: EvidencePacket;
  version: EpisodeVersionContent;
  now: Date;
}

/** The claim ids a version uses, in first-seen order (version list, then beats). */
export function versionClaimIds(version: EpisodeVersionContent): string[] {
  const ids = new Set<string>(version.claimIds);
  for (const b of version.beats) for (const id of b.claimIds) ids.add(id);
  return [...ids];
}

/**
 * The latest review of one kind for a claim, by `createdAt` then `id`. A later
 * `fail` overrides an earlier `pass`; a later `pass` supersedes an earlier `fail`.
 */
function latestReview(reviews: readonly ReviewRecord[], claimId: string, kind: ReviewRecord['reviewerKind']): ReviewRecord | null {
  let best: ReviewRecord | null = null;
  for (const r of reviews) {
    if (r.claimId !== claimId || r.reviewerKind !== kind) continue;
    if (!best) {
      best = r;
      continue;
    }
    const a = Date.parse(r.createdAt);
    const b = Date.parse(best.createdAt);
    if (a > b || (a === b && r.id > best.id)) best = r;
  }
  return best;
}

/** A qualified human review that passed and is backed by owner-supplied documentation. */
function isDocumentedHumanPass(r: ReviewRecord | null): r is ReviewRecord {
  return !!r && r.reviewerKind === 'qualified_human' && PASSING.has(r.verdict) && !blank(r.documentRef);
}

interface Ctx {
  packet: EvidencePacket;
  version: EpisodeVersionContent;
  now: number;
  claims: Map<string, Claim>;
  sources: Map<string, Source>;
  evidenceByClaim: Map<string, ClaimEvidence[]>;
  used: Claim[];
  issues: IssueList;
}

export function evaluateEvidenceGate(input: EvidenceGateInput): GateReport {
  const { packet, version } = input;
  const issues = new IssueList();
  const now = input.now.getTime();

  checkSchemas(packet, version, issues);

  const claims = indexById(packet.claims, 'claim', issues);
  const sources = indexById(packet.sources, 'source', issues);
  indexById(packet.evidence, 'evidence', issues);
  indexById(packet.reviews, 'review', issues);

  const evidenceByClaim = new Map<string, ClaimEvidence[]>();
  for (const e of packet.evidence) {
    const list = evidenceByClaim.get(e.claimId) ?? [];
    list.push(e);
    evidenceByClaim.set(e.claimId, list);
  }

  const expectedLedger = claimLedgerSha256(packet.claims, packet.evidence);
  if (version.claimLedgerSha256 !== expectedLedger) {
    issues.add(
      'ledger_hash_mismatch',
      null,
      'the claim ledger changed after this version was verified; re-verify and create a new version',
    );
  }

  const listed = new Set(version.claimIds);
  const used: Claim[] = [];
  for (const id of versionClaimIds(version)) {
    const c = claims.get(id);
    if (!c) issues.add('unknown_claim', id, `claim ${id} is referenced by the version but is not in the evidence packet`);
    else used.push(c);
  }
  version.beats.forEach((b, i) => {
    for (const id of b.claimIds) {
      if (!listed.has(id)) issues.add('beat_claim_not_in_version', id, `beat ${i} (${b.role}) uses claim ${id}, which is missing from version.claimIds`);
    }
  });

  const ctx: Ctx = { packet, version, now, claims, sources, evidenceByClaim, used, issues };
  for (const c of used) checkClaim(ctx, c);
  checkScriptText(ctx);
  checkBadges(ctx);

  return issues.report();
}

function checkSchemas(packet: EvidencePacket, version: EpisodeVersionContent, issues: IssueList): void {
  const check = (label: string, schema: z.ZodType, value: unknown, claimId: string | null) => {
    const r = schema.safeParse(value);
    if (!r.success) {
      const first = r.error.issues[0];
      const where = first ? `${first.path.map(String).join('.') || '(root)'}: ${first.message}` : 'invalid';
      issues.add('schema_invalid', claimId, `${label} does not match the contract (${where})`);
    }
  };
  check('topic', TopicSchema, packet.topic, null);
  for (const s of packet.sources) check(`source ${s.id}`, SourceSchema, s, null);
  for (const c of packet.claims) check(`claim ${c.id}`, ClaimSchema, c, c.id);
  for (const e of packet.evidence) check(`evidence ${e.id}`, ClaimEvidenceSchema, e, e.claimId);
  for (const r of packet.reviews) check(`review ${r.id}`, ReviewRecordSchema, r, r.claimId);
  check('episode version', EpisodeVersionContentSchema, version, null);
}

function indexById<T extends { id: string }>(rows: readonly T[], label: string, issues: IssueList): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows) {
    if (map.has(r.id)) issues.add('duplicate_id', null, `${label} id ${r.id} appears more than once; lookups would be ambiguous`);
    else map.set(r.id, r);
  }
  return map;
}

function effectiveTier(ctx: Ctx, c: Claim): RiskTier {
  return TIER_RANK[ctx.packet.topic.riskTier] > TIER_RANK[c.riskTier] ? ctx.packet.topic.riskTier : c.riskTier;
}

function checkClaim(ctx: Ctx, c: Claim): void {
  const { issues, sources, now } = ctx;
  const tier = effectiveTier(ctx, c);

  if (c.topicId !== ctx.packet.topic.id) {
    issues.add('claim_topic_mismatch', c.id, `claim ${c.id} belongs to topic ${c.topicId}, not ${ctx.packet.topic.id}`);
  }

  if (!PUBLISHABLE_CLAIM_STATUSES.includes(c.status)) {
    issues.add('claim_not_publishable', c.id, `claim ${c.id} is ${c.status}; only supported or supported_with_limits claims may be used`);
  }

  // --- Evidence integrity -------------------------------------------------
  const evidence = ctx.evidenceByClaim.get(c.id) ?? [];
  const validSupportOrigins = new Set<string>();
  let supportCount = 0;
  for (const e of evidence) {
    if (blank(e.supportingPassage) || blank(e.locator)) {
      issues.add('evidence_missing_passage', c.id, `evidence ${e.id} for claim ${c.id} has no supporting passage or locator`);
    }
    const s = sources.get(e.sourceId);
    if (!s) {
      issues.add('unknown_source', c.id, `evidence ${e.id} cites source ${e.sourceId}, which is not in the packet (fabricated or unknown citation)`);
      continue;
    }
    if (e.stance === 'context') continue;
    if (!s.available) issues.add('source_unavailable', c.id, `source ${s.id} backing claim ${c.id} was unavailable when last checked`);
    if (s.retracted) issues.add('source_retracted', c.id, `source ${s.id} backing claim ${c.id} is retracted`);
    if (s.retractionCheckedAt === null && TIER_RANK[tier] >= TIER_RANK.elevated) {
      issues.add('retraction_unchecked', c.id, `source ${s.id} was never checked for retraction; claim ${c.id} is ${tier} risk`);
    }
    if (e.stance === 'supports') {
      supportCount++;
      if (s.available && !s.retracted && !blank(e.supportingPassage) && !blank(e.locator)) validSupportOrigins.add(s.originId);
    }
  }
  if (supportCount === 0) {
    issues.add('claim_without_support', c.id, `claim ${c.id} has no supporting evidence`);
  }

  // --- Origin independence -----------------------------------------------
  if ((c.isConsequential || c.isNumeric || c.isCausal) && validSupportOrigins.size < 2 && blank(c.singleOriginJustification)) {
    const kinds = [c.isConsequential && 'consequential', c.isNumeric && 'numeric', c.isCausal && 'causal'].filter(Boolean).join('/');
    issues.add(
      'insufficient_independent_origins',
      c.id,
      `${kinds} claim ${c.id} has ${validSupportOrigins.size} independent evidence origin(s); needs 2 or a recorded single-origin justification`,
    );
  }

  // --- Contradictions and limitations ------------------------------------
  if (evidence.some((e) => e.stance === 'contradicts') && (c.status !== 'supported_with_limits' || blank(c.limitations))) {
    issues.add(
      'contradiction_unaddressed',
      c.id,
      `claim ${c.id} has contradicting evidence; it must be supported_with_limits with stated limitations`,
    );
  }
  if (blank(c.limitations)) {
    if (c.status === 'supported_with_limits') {
      issues.add('limitations_missing', c.id, `claim ${c.id} is supported_with_limits but states no limitations`);
    } else if (TIER_RANK[tier] >= TIER_RANK.elevated) {
      issues.add('limitations_missing', c.id, `claim ${c.id} is ${tier} risk and must state explicit limitations`);
    }
  }

  // --- Freshness ---------------------------------------------------------
  if (c.timeSensitivity === 'changing') {
    const checked = c.lastCheckedAt === null ? Number.NaN : Date.parse(c.lastCheckedAt);
    const age = now - checked;
    if (!Number.isFinite(age) || age < 0 || age > CHANGING_CLAIM_MAX_AGE_MS) {
      issues.add(
        'changing_claim_not_rechecked',
        c.id,
        `changing claim ${c.id} was last checked ${c.lastCheckedAt ?? 'never'}; it must be rechecked within 24h before publication`,
      );
    }
  }
  if (c.freshUntil !== null) {
    const until = Date.parse(c.freshUntil);
    if (!Number.isFinite(until) || until <= now) {
      issues.add('claim_stale', c.id, `claim ${c.id} was fresh until ${c.freshUntil}; recheck the evidence`);
    }
  }

  // --- Reviews and risk tiers ---------------------------------------------
  const ai = latestReview(ctx.packet.reviews, c.id, 'ai_verification');
  if (!ai || !PASSING.has(ai.verdict)) {
    issues.add(
      'missing_ai_verification',
      c.id,
      ai ? `latest AI verification of claim ${c.id} is ${ai.verdict}` : `claim ${c.id} has no independent AI verification pass`,
    );
  }
  if (tier === 'high') {
    const human = latestReview(ctx.packet.reviews, c.id, 'qualified_human');
    if (!isDocumentedHumanPass(human)) {
      issues.add(
        'missing_qualified_review',
        c.id,
        `claim ${c.id} is high risk and is held until a documented qualified human review (pass, with documentRef) is supplied through the owner`,
      );
    }
  }
}

/** Numbers, causal language and caveats in each beat (against that beat's claims) and in the caption (against all version claims). */
function checkScriptText(ctx: Ctx): void {
  const { version, claims, issues } = ctx;
  const versionClaims = version.claimIds.map((id) => claims.get(id)).filter((c): c is Claim => !!c);
  const onBeats = new Set<string>();

  version.beats.forEach((beat, i) => {
    const beatClaims = beat.claimIds.map((id) => claims.get(id)).filter((c): c is Claim => !!c);
    const where = `beat ${i} (${beat.role})`;
    const num = findNumber(beat.narration);
    if (num !== null && !beatClaims.some((c) => c.isNumeric)) {
      issues.add('unsupported_number', null, `${where} narration states "${num}" but none of its claims is numeric`);
    }
    const causal = findCausalLanguage(beat.narration);
    if (causal !== null && !beatClaims.some((c) => c.isCausal)) {
      issues.add('causal_overclaim', null, `${where} narration says "${causal}" but none of its claims is causal`);
    }
    for (const c of beatClaims) {
      onBeats.add(c.id);
      if (c.status === 'supported_with_limits') checkCaveat(ctx, c, beat.narration, where);
    }
  });

  const capNum = findNumber(version.caption);
  if (capNum !== null && !versionClaims.some((c) => c.isNumeric)) {
    issues.add('unsupported_number', null, `caption states "${capNum}" but none of the version's claims is numeric`);
  }
  const capCausal = findCausalLanguage(version.caption);
  if (capCausal !== null && !versionClaims.some((c) => c.isCausal)) {
    issues.add('causal_overclaim', null, `caption says "${capCausal}" but none of the version's claims is causal`);
  }
  // Limited claims that appear on no beat must keep their caveat in the caption.
  for (const c of versionClaims) {
    if (c.status === 'supported_with_limits' && !onBeats.has(c.id)) checkCaveat(ctx, c, '', 'caption');
  }
}

/**
 * Caveat retention for a `supported_with_limits` claim. Conservative rule:
 * - if the claim has `permittedWording`, that wording must appear (ignoring case
 *   and punctuation) in the beat's narration or the caption;
 * - otherwise a reviewed hedge keyword (see CAVEAT_KEYWORDS) must appear in that
 *   beat's own narration — a hedge in the shared caption may belong to a
 *   different claim, so it only counts for limited claims that sit on no beat.
 * A generic hedge never substitutes for specific permitted wording.
 */
function checkCaveat(ctx: Ctx, c: Claim, narration: string, where: string): void {
  const text = `${narration}\n${ctx.version.caption}`;
  const hedgeText = where === 'caption' ? ctx.version.caption : narration;
  if (!blank(c.permittedWording)) {
    if (!containsPhrase(text, c.permittedWording as string)) {
      ctx.issues.add(
        'caveat_missing',
        c.id,
        `${where} uses limited claim ${c.id} without its permitted wording "${c.permittedWording}" in the narration or caption`,
      );
    }
    return;
  }
  if (findCaveatKeyword(hedgeText) === null) {
    ctx.issues.add('caveat_missing', c.id, `${where} uses limited claim ${c.id} with no caveat (hedge keyword) in its own text`);
  }
}

/** "Doctor approved"-style badges anywhere audience-facing need a documented review that authorizes that exact wording. */
function checkBadges(ctx: Ctx): void {
  const { version, packet, issues } = ctx;
  const authorized = packet.reviews
    .filter(isDocumentedHumanPass)
    .map((r) => (r.authorizedDisplayWording ?? '').toLowerCase().replace(/\s+/g, ' '))
    .filter((s) => s.trim() !== '');
  const texts: [string, string][] = [
    ['caption', version.caption],
    ...version.beats.flatMap((b, i): [string, string][] => [
      [`beat ${i} narration`, b.narration],
      [`beat ${i} visual`, b.visual],
    ]),
    ...version.sourceList.map((s, i): [string, string] => [`source list ${i}`, s]),
  ];
  for (const [where, text] of texts) {
    for (const hit of findPatterns(text, BADGE_PATTERNS)) {
      const phrase = hit.match.toLowerCase().replace(/\s+/g, ' ');
      if (!authorized.some((a) => a.includes(phrase))) {
        issues.add(
          'unauthorized_badge',
          null,
          `${where} displays "${hit.match}" without a documented qualified review authorizing that exact wording`,
        );
      }
    }
  }
}

/** Exceptions the gate accepted, for the owner's review screen (currently: justified single-origin claims). */
export function listEvidenceAllowances(input: { packet: EvidencePacket; version: EpisodeVersionContent }): GateIssue[] {
  const claims = new Map(input.packet.claims.map((c) => [c.id, c]));
  const sources = new Map(input.packet.sources.map((s) => [s.id, s]));
  const out: GateIssue[] = [];
  for (const id of versionClaimIds(input.version)) {
    const c = claims.get(id);
    if (!c || !(c.isConsequential || c.isNumeric || c.isCausal) || blank(c.singleOriginJustification)) continue;
    const origins = new Set(
      input.packet.evidence
        .filter((e) => e.claimId === id && e.stance === 'supports')
        .map((e) => sources.get(e.sourceId))
        .filter((s): s is Source => !!s && s.available && !s.retracted)
        .map((s) => s.originId),
    );
    if (origins.size < 2) {
      out.push({
        code: 'single_origin_justified',
        claimId: id,
        message: `claim ${id} relies on one evidence origin; justification: ${c.singleOriginJustification}`,
      });
    }
  }
  return out;
}
