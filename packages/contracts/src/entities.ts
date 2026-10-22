import { z } from 'zod';
import { hashCanonical } from './canonical';
import { Actor, EpisodeCode, EpisodeFormat, Id, IsoDateTime, Pillar, RiskTier, Sha256 } from './common';
import { EpisodeState, MainState } from './workflow';

/** The five questions every episode must answer internally (brief §2). */
export const EditorialIntent = z.object({
  whoThisHelps: z.string().min(1),
  whatTheyLearn: z.string().min(1),
  whatTheyCanDo: z.string().min(1),
  whyEvidenceSupportsIt: z.string().min(1),
  whatEvidenceDoesNotEstablish: z.string().min(1),
});
export type EditorialIntent = z.infer<typeof EditorialIntent>;

export const Topic = z.object({
  id: Id,
  pillar: Pillar,
  title: z.string().min(1),
  question: z.string().min(1),
  riskTier: RiskTier,
  intent: EditorialIntent,
  isFixture: z.boolean(),
  createdAt: IsoDateTime,
});
export type Topic = z.infer<typeof Topic>;

export const SourceType = z.enum([
  'guideline',
  'consensus_report',
  'systematic_review',
  'primary_research',
  'official_documentation',
  'expert_interpretation',
  'news',
  'other',
]);
export type SourceType = z.infer<typeof SourceType>;

export const Source = z.object({
  id: Id,
  url: z.url({ protocol: /^https$/ }),
  doi: z.string().nullable(),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)),
  institution: z.string().nullable(),
  sourceType: SourceType,
  publishedAt: IsoDateTime.nullable(),
  retrievedAt: IsoDateTime,
  /**
   * Evidence-origin grouping. Two articles repeating one press release share an
   * originId and count as one origin for corroboration.
   */
  originId: Id,
  /** Whether the source was reachable when last checked. */
  available: z.boolean(),
  retractionCheckedAt: IsoDateTime.nullable(),
  retracted: z.boolean(),
  correctionNote: z.string().nullable(),
  contentSha256: Sha256.nullable(),
});
export type Source = z.infer<typeof Source>;

export const ClaimStatus = z.enum(['supported', 'supported_with_limits', 'unresolved', 'rejected']);
export type ClaimStatus = z.infer<typeof ClaimStatus>;
export const PUBLISHABLE_CLAIM_STATUSES: readonly ClaimStatus[] = ['supported', 'supported_with_limits'];

export const ClaimLocation = z.enum(['hook', 'narration', 'visual', 'caption', 'analogy', 'ending', 'cover']);
export const TimeSensitivity = z.enum(['changing', 'stable']);

export const Claim = z.object({
  id: Id,
  topicId: Id,
  text: z.string().min(1),
  locations: z.array(ClaimLocation).min(1),
  status: ClaimStatus,
  statusReason: z.string().nullable(),
  riskTier: RiskTier,
  timeSensitivity: TimeSensitivity,
  /** Recheck before publication after this instant. */
  freshUntil: IsoDateTime.nullable(),
  lastCheckedAt: IsoDateTime.nullable(),
  permittedWording: z.string().nullable(),
  limitations: z.string().nullable(),
  isNumeric: z.boolean(),
  isCausal: z.boolean(),
  isConsequential: z.boolean(),
  /** Why one authoritative origin is enough, when it is. */
  singleOriginJustification: z.string().nullable(),
});
export type Claim = z.infer<typeof Claim>;

export const EvidenceStance = z.enum(['supports', 'contradicts', 'context']);
export const ClaimEvidence = z.object({
  id: Id,
  claimId: Id,
  sourceId: Id,
  stance: EvidenceStance,
  supportingPassage: z.string().min(1),
  locator: z.string().min(1),
  studyType: z.string().nullable(),
  population: z.string().nullable(),
  limitations: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type ClaimEvidence = z.infer<typeof ClaimEvidence>;

export const ReviewerKind = z.enum(['ai_verification', 'qualified_human']);
export const ReviewRecord = z.object({
  id: Id,
  claimId: Id.nullable(),
  episodeVersionId: Id.nullable(),
  reviewerKind: ReviewerKind,
  /** For AI passes: the model ID. For humans: name/role as supplied by the owner. */
  reviewer: z.string().min(1),
  verdict: z.enum(['pass', 'pass_with_changes', 'fail']),
  notes: z.string(),
  /** Reference to documentation the owner supplied for a qualified review. */
  documentRef: z.string().nullable(),
  /** Exact public wording this review authorizes, if any (e.g. never "doctor approved" without it). */
  authorizedDisplayWording: z.string().nullable(),
  /**
   * For script reviews: reviewSubjectSha256 of the exact beats + caption reviewed.
   * An AI verification only counts while the script still matches it.
   */
  subjectSha256: Sha256.nullable().optional(),
  createdAt: IsoDateTime,
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/** What an AI script review is bound to: the beats and caption, exactly. */
export function reviewSubjectSha256(version: { beats: readonly unknown[]; caption: string }): string {
  return hashCanonical({ beats: version.beats, caption: version.caption });
}

export const Episode = z.object({
  id: Id,
  code: EpisodeCode,
  topicId: Id,
  format: EpisodeFormat,
  state: EpisodeState,
  stateReason: z.string().nullable(),
  heldFrom: MainState.nullable(),
  currentVersionId: Id.nullable(),
  createdAt: IsoDateTime,
});
export type Episode = z.infer<typeof Episode>;

export const ScriptBeat = z.object({
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  role: z.enum(['hook', 'problem', 'mechanism', 'takeaway', 'twist']),
  narration: z.string().min(1),
  visual: z.string().min(1),
  claimIds: z.array(Id),
});
export type ScriptBeat = z.infer<typeof ScriptBeat>;

/** The content of a version; its hash is the version's identity for approvals. */
export const EpisodeVersionContent = z.object({
  episodeId: Id,
  versionNumber: z.number().int().positive(),
  beats: z.array(ScriptBeat).min(1),
  caption: z.string().min(1),
  sourceList: z.array(z.string().min(1)),
  claimIds: z.array(Id),
  /** Hash of the claim ledger rows (claims + evidence) this version was verified against. */
  claimLedgerSha256: Sha256,
});
export type EpisodeVersionContent = z.infer<typeof EpisodeVersionContent>;

export const EpisodeVersion = EpisodeVersionContent.extend({
  id: Id,
  contentSha256: Sha256,
  supersedesVersionId: Id.nullable(),
  createdBy: Actor,
  createdAt: IsoDateTime,
});
export type EpisodeVersion = z.infer<typeof EpisodeVersion>;

export const EpisodeLink = z.object({
  episodeId: Id,
  parentQuestion: z.string().nullable(),
  resolvedQuestion: z.string().min(1),
  nextQuestion: z.string().nullable(),
  relatedEpisodeId: Id.nullable(),
  relationshipReason: z.string().nullable(),
  /** True when the ending explicitly points to the related episode, which must then be live. */
  endingReferencesRelated: z.boolean(),
});
export type EpisodeLink = z.infer<typeof EpisodeLink>;
