import type { EpisodeLink, EpisodeVersionContent, ReviewRecord } from '@life/contracts';
import {
  AUTHORITY_APPEAL_PATTERNS,
  ENGAGEMENT_PATTERNS,
  EPISODE_CODE_RE,
  RELATED_REFERENCE_PATTERNS,
  WITHHOLDING_PATTERNS,
  findPatterns,
} from './text';
import { IssueList, type GateReport } from './types';

export const CREATIVE_ISSUE_CODES = [
  'engagement_bait',
  'withholding_phrase',
  'missing_takeaway',
  'twist_before_takeaway',
  'twist_not_last',
  'multiple_twists',
  'beat_without_claims',
  'beat_invalid_timing',
  'beat_overlap',
  'related_episode_missing',
  'related_episode_not_live',
  'undeclared_related_reference',
  'authority_appeal',
  'caption_missing_episode_code',
] as const;
export type CreativeIssueCode = (typeof CREATIVE_ISSUE_CODES)[number];

/** Beats that make factual statements and so must cite at least one claim. The hook may be a pure question. */
const BEATS_NEEDING_CLAIMS = new Set(['mechanism', 'takeaway', 'twist']);

export interface CreativeRulesInput {
  version: EpisodeVersionContent;
  link: EpisodeLink | null;
  /** Whether `link.relatedEpisodeId` is currently live and accessible on the account. */
  relatedEpisodeLive: boolean;
  reviews: ReviewRecord[];
}

/**
 * Creative and structural rules (brief §4, CLAUDE.md editorial rules).
 * Caveat retention needs claim data, so it lives in the evidence gate (`caveat_missing`).
 */
export function evaluateCreativeRules(input: CreativeRulesInput): GateReport {
  const { version, link } = input;
  const issues = new IssueList();

  const texts: [string, string][] = [
    ...version.beats.map((b, i): [string, string] => [`beat ${i} (${b.role}) narration`, b.narration]),
    ...version.beats.map((b, i): [string, string] => [`beat ${i} (${b.role}) visual`, b.visual]),
    ...version.beats.flatMap((b, i) => (b.onScreenText ?? []).map((t, k): [string, string] => [`beat ${i} (${b.role}) on-screen ${k}`, t])),
    ['caption', version.caption],
  ];

  // --- Engagement begging and withholding -----------------------------------
  for (const [where, text] of texts) {
    for (const hit of findPatterns(text, ENGAGEMENT_PATTERNS)) {
      issues.add('engagement_bait', null, `${where} asks viewers to engage ("${hit.match}"); never ask to ${hit.label}`);
    }
    for (const hit of findPatterns(text, WITHHOLDING_PATTERNS)) {
      issues.add('withholding_phrase', null, `${where} withholds the answer to force another view ("${hit.match}")`);
    }
  }

  // --- Beat structure: resolve the promise, then at most one final twist ----
  const roles = version.beats.map((b) => b.role);
  const twistIdx = roles.flatMap((r, i) => (r === 'twist' ? [i] : []));
  const firstTakeaway = roles.indexOf('takeaway');
  if (firstTakeaway === -1) {
    issues.add('missing_takeaway', null, 'the script has no takeaway beat; the main promise is never resolved');
  }
  if (twistIdx.length > 1) {
    issues.add('multiple_twists', null, `the script has ${twistIdx.length} twist beats; at most one is allowed`);
  }
  const firstTwist = twistIdx[0];
  if (firstTwist !== undefined) {
    if (firstTakeaway === -1 || firstTakeaway > firstTwist) {
      issues.add('twist_before_takeaway', null, 'the twist opens a new question before the takeaway resolves the main promise');
    }
    if (twistIdx[twistIdx.length - 1] !== roles.length - 1) {
      issues.add('twist_not_last', null, 'the twist must be the final beat');
    }
  }
  version.beats.forEach((b, i) => {
    if (BEATS_NEEDING_CLAIMS.has(b.role) && b.claimIds.length === 0) {
      issues.add('beat_without_claims', null, `beat ${i} (${b.role}) makes statements but cites no claim; a twist or takeaway must follow from the evidence`);
    }
  });

  // --- Timing -------------------------------------------------------------
  version.beats.forEach((b, i) => {
    if (!(b.endSec > b.startSec)) {
      issues.add('beat_invalid_timing', null, `beat ${i} (${b.role}) ends at ${b.endSec}s, not after its start at ${b.startSec}s`);
    }
    const prev = version.beats[i - 1];
    if (prev && b.startSec < prev.endSec) {
      issues.add('beat_overlap', null, `beat ${i} (${b.role}) starts at ${b.startSec}s, before beat ${i - 1} ends at ${prev.endSec}s`);
    }
  });

  // --- Connected endings ----------------------------------------------------
  if (link?.endingReferencesRelated) {
    if (link.relatedEpisodeId === null || link.relatedEpisodeId.trim() === '') {
      issues.add('related_episode_missing', null, 'the ending points to a related episode but no relatedEpisodeId is set');
    } else if (!input.relatedEpisodeLive) {
      issues.add('related_episode_not_live', null, `the ending points to episode ${link.relatedEpisodeId}, which is not live; use a self-contained ending`);
    }
  } else {
    for (const [where, text] of texts) {
      for (const hit of findPatterns(text, RELATED_REFERENCE_PATTERNS)) {
        issues.add(
          'undeclared_related_reference',
          null,
          `${where} points to another Reel ("${hit.match}") but the link does not declare endingReferencesRelated`,
        );
      }
    }
  }

  // --- Appeals to authority without a documented review ----------------------
  const authorized = input.reviews
    .filter((r) => r.reviewerKind === 'qualified_human' && (r.verdict === 'pass' || r.verdict === 'pass_with_changes') && !!r.documentRef?.trim())
    .map((r) => (r.authorizedDisplayWording ?? '').toLowerCase().replace(/\s+/g, ' '))
    .filter((s) => s.trim() !== '');
  for (const [where, text] of texts) {
    for (const hit of findPatterns(text, AUTHORITY_APPEAL_PATTERNS)) {
      const phrase = hit.match.toLowerCase().replace(/\s+/g, ' ');
      if (!authorized.some((a) => a.includes(phrase))) {
        issues.add('authority_appeal', null, `${where} claims "${hit.match}" without a documented review authorizing that wording`);
      }
    }
  }

  // --- Reconciliation marker -------------------------------------------------
  if (!EPISODE_CODE_RE.test(version.caption)) {
    issues.add('caption_missing_episode_code', null, 'the caption must carry the episode code (e.g. LU-TECH-001) for series lookup and publish reconciliation');
  }

  return issues.report();
}
