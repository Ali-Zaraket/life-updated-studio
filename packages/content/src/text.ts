/**
 * Reviewed phrase lists and text helpers shared by the evidence gate and the
 * creative rules. Everything here is pure and deterministic.
 *
 * Design stance: these lists are deliberately conservative. A false positive
 * costs an editor a rewrite; a false negative can publish a misleading Reel.
 * Each list is a reviewed artifact: change it with a test that shows the new
 * pattern firing and the known false-positive cases still passing.
 */

/** A named, reviewed pattern. `label` is what the owner sees in a blocker. */
export interface PhrasePattern {
  label: string;
  re: RegExp;
}

/** Fold typographic quotes/dashes so patterns see one spelling. */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-');
}

/** Lowercase, fold, and collapse every non-alphanumeric run into one space. */
export function normalizeForContainment(text: string): string {
  return foldText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when `needle` appears in `haystack` on word boundaries, ignoring case and punctuation. */
export function containsPhrase(haystack: string, needle: string): boolean {
  const n = normalizeForContainment(needle);
  if (n === '') return false;
  return ` ${normalizeForContainment(haystack)} `.includes(` ${n} `);
}

/** All pattern labels whose regex matches the text, with the matched text. */
export function findPatterns(text: string, patterns: readonly PhrasePattern[]): { label: string; match: string }[] {
  const folded = foldText(text);
  const hits: { label: string; match: string }[] = [];
  for (const p of patterns) {
    const m = p.re.exec(folded);
    if (m) hits.push({ label: p.label, match: m[0] });
  }
  return hits;
}

const w = (label: string, source: string): PhrasePattern => ({ label, re: new RegExp(source, 'iu') });

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * Text that carries digits but is not a quantitative claim: episode codes
 * (reconciliation marker), ISO dates (source-list retrieval dates) and URLs.
 * Bare years are NOT stripped: "in 2024, half of…" is a claim.
 */
const NON_CLAIM_DIGITS: readonly RegExp[] = [
  /\bLU-[A-Z]{2,6}-\d{3,}\b/g,
  /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?\b/g,
  /\bhttps?:\/\/\S+/gi,
];

/**
 * Number words that state a quantity. "one" is excluded on purpose: it is far
 * more often a pronoun ("which one", "no one") than a count, and "one in three"
 * is still caught by "three". Ordinals are excluded ("a second mechanism").
 */
export const NUMBER_WORDS: readonly string[] = [
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'hundred', 'hundreds', 'thousand', 'thousands', 'million', 'millions', 'billion', 'billions', 'trillion',
  'dozen', 'dozens', 'percent', 'per cent', 'half', 'twice', 'thrice', 'double', 'triple', 'quadruple',
];
const NUMBER_WORD_RE = new RegExp(`\\b(?:${NUMBER_WORDS.map((x) => x.replace(' ', '\\s+')).join('|')})\\b`, 'iu');

/** Returns the first numeric token found (digit or number word), or null. */
export function findNumber(text: string): string | null {
  let t = foldText(text);
  for (const re of NON_CLAIM_DIGITS) t = t.replace(re, ' ');
  const digit = /\d+(?:[.,]\d+)*\s*%?/u.exec(t);
  if (digit) return digit[0].trim();
  const word = NUMBER_WORD_RE.exec(t);
  return word ? word[0] : null;
}

// ---------------------------------------------------------------------------
// Causal and certainty language
// ---------------------------------------------------------------------------

export const CAUSAL_PATTERNS: readonly PhrasePattern[] = [
  w('causes', String.raw`\bcaus(?:e|es|ed|ing)\b`),
  w('proves', String.raw`\bprov(?:e|es|ed|en|ing)\b`),
  w('proof', String.raw`\bproof\b`),
  w('cures', String.raw`\bcur(?:e|es|ed|ing)\b`),
  w('prevents', String.raw`\bprevent(?:s|ed|ing|ion)?\b`),
  w('guarantees', String.raw`\bguarantee(?:s|d|ing)?\b`),
  w('will make you', String.raw`\bwill\s+make\s+you\b`),
  w('leads to', String.raw`\b(?:leads?|led)\s+to\b`),
  w('results in', String.raw`\bresult(?:s|ed)?\s+in\b`),
  w('is responsible for', String.raw`\b(?:is|are|was|were)\s+responsible\s+for\b`),
  w('eliminates', String.raw`\beliminat(?:e|es|ed|ing)\b`),
  w('boosts', String.raw`\bboost(?:s|ed|ing)?\b`),
  w('definitely', String.raw`\bdefinitely\b`),
  w('certainly', String.raw`\bcertainly\b`),
  w('without a doubt', String.raw`\bwithout\s+(?:a\s+)?doubt\b`),
  w('undeniable', String.raw`\bundeniabl[ey]\b`),
  w('100%', String.raw`\b100\s*(?:%|percent\b)`),
];

export function findCausalLanguage(text: string): string | null {
  return findPatterns(text, CAUSAL_PATTERNS)[0]?.match ?? null;
}

// ---------------------------------------------------------------------------
// Expert badges / appeals to authority
// ---------------------------------------------------------------------------

const AUTH = String.raw`(?:doctors?|physicians?|experts?|scientists?|dermatologists?|dentists?|nutritionists?|pharmacists?)`;

export const BADGE_PATTERNS: readonly PhrasePattern[] = [
  w('doctor approved', String.raw`\b(?:doctor|physician|dermatologist|dentist)s?'?[\s-]+(?:approved|recommended|verified|endorsed|tested)\b`),
  w('expert verified', String.raw`\b(?:expert|scientist)s?'?[\s-]+(?:approved|verified|recommended|endorsed|reviewed)\b`),
  w('clinically proven', String.raw`\bclinically[\s-]+(?:proven|tested|approved|validated)\b`),
  w('medically reviewed', String.raw`\bmedically[\s-]+(?:reviewed|approved|verified)\b`),
  w('approved by experts', String.raw`\b(?:approved|verified|endorsed|reviewed|checked)\s+by\s+(?:an?\s+|our\s+)?${AUTH}\b`),
  w('fact-checked by experts', String.raw`\bfact[\s-]+checked\s+by\s+(?:an?\s+)?${AUTH}\b`),
];

/** Appeals to authority with no badge wording; still need a documented review. */
export const AUTHORITY_APPEAL_PATTERNS: readonly PhrasePattern[] = [
  w('experts agree', String.raw`\b${AUTH}\s+(?:all\s+)?(?:agree|say|recommend|confirm)\b`),
  w('science says', String.raw`\b(?:science|research|studies)\s+(?:says|say|confirms?|shows?\s+for\s+sure)\b`),
];

// ---------------------------------------------------------------------------
// Engagement begging
// ---------------------------------------------------------------------------

/**
 * Imperative engagement appeals. Bare "like", "share", "follow" and "comment"
 * are NOT matched alone: they are ordinary words ("works like this", "apps
 * share data", "follow these steps", "comment on the study"). Each pattern
 * needs the appeal shape around the verb.
 */
export const ENGAGEMENT_PATTERNS: readonly PhrasePattern[] = [
  w('like', String.raw`\b(?:give|leave|drop)\s+(?:it|this|us|me)\s+a\s+like\b|\b(?:hit|smash|tap|press)\s+(?:that\s+|the\s+)?like\b|\blike\s+(?:and|&|\+)\s+(?:follow|subscribe|share|comment|save)\b|\blike\s+(?:this|the|my|our)\s+(?:video|reel|post)\b|\blike\s+if\s+you\b`),
  w('follow', String.raw`\bfollow\s+(?:us|me|for\s+more|along|the\s+(?:account|page|series)|@\w+)\b|\bfollow\s+@`),
  w('subscribe', String.raw`\bsubscrib(?:e|ed|ing)\b`),
  w('share', String.raw`\bshare\s+(?:this|it)\s+(?:video|reel|post|with\s+(?:a\s+friend|someone|your))\b|\bshare\s+with\s+(?:a\s+friend|someone\s+who)\b|\bsend\s+(?:this|it)\s+to\s+(?:a\s+friend|someone)\b`),
  w('comment', String.raw`\bcomment\s+(?:below|down\s+below|if|your|what|with|['"]\w+)\b|\b(?:in|to)\s+the\s+comments\b|\b(?:drop|leave)\s+(?:a|your)\s+comment\b`),
  w('save this', String.raw`\bsave\s+(?:this|it)(?:\s+(?:video|reel|post))?(?:\s+for\s+later)?\b`),
  // "tap the location button" is a legitimate instruction; only engagement buttons, or "hit/smash", count.
  w('hit the button', String.raw`\b(?:hit|smash)\s+(?:the|that|this)\s+(?:\w+\s+)?(?:button|bell)\b|\b(?:tap|press|click)\s+(?:the|that|this)\s+(?:like|follow|subscribe|share|save|notification|notifications)\s+(?:button|icon)\b|\b(?:ring|tap|press|click)\s+(?:the|that)\s+bell\b`),
  w('turn on notifications', String.raw`\bturn\s+on\s+(?:post\s+)?notifications\b`),
  w('link in bio', String.raw`\blink\s+in\s+(?:my\s+|our\s+|the\s+)?bio\b`),
  w('double tap', String.raw`\bdouble[\s-]+tap\b`),
  w('tag a friend', String.raw`\btag\s+(?:a\s+friend|someone)\b`),
];

// ---------------------------------------------------------------------------
// Withholding / "part two for the answer"
// ---------------------------------------------------------------------------

export const WITHHOLDING_PATTERNS: readonly PhrasePattern[] = [
  w('part two', String.raw`\bpart\s+(?:two|2|ii|three|3)\b`),
  w('for the answer', String.raw`\bfor\s+the\s+(?:answer|rest|reveal|full\s+story)\b`),
  w('answer in the next', String.raw`\b(?:answer|reveal|rest)\s+(?:is\s+)?in\s+(?:the|my|our)\s+next\b`),
  w('watch the next', String.raw`\b(?:watch|see|check\s+out)\s+(?:the\s+|my\s+|our\s+)?next\s+(?:one|video|reel|episode|part)\b`),
  w('stay tuned', String.raw`\bstay\s+tuned\b`),
  w("you'll have to watch", String.raw`\byou'?ll\s+have\s+to\s+watch\b`),
  w('find out in', String.raw`\bfind\s+out\s+in\s+(?:the|my|our)\b`),
];

/** Narration that explicitly points at another Reel. */
export const RELATED_REFERENCE_PATTERNS: readonly PhrasePattern[] = [
  w('points to another episode', String.raw`\b(?:in|see|watch|check\s+out)\s+(?:our|the|my)\s+(?:next|previous|last|other|linked|related|earlier)\s+(?:episode|reel|video|part)\b`),
  w('points to another episode', String.raw`\b(?:episode|reel|video)\s+(?:on|about)\s+(?:that|this|it)\b\s+(?:is\s+)?(?:linked|pinned|up|live)\b`),
];

// ---------------------------------------------------------------------------
// Caveat retention
// ---------------------------------------------------------------------------

/**
 * Hedge words that count as a retained caveat when the claim has no
 * `permittedWording`. When `permittedWording` is set it is required verbatim
 * (case/punctuation-insensitive): a generic hedge elsewhere does not replace it.
 */
export const CAVEAT_KEYWORDS: readonly string[] = [
  'may', 'might', 'can sometimes', 'sometimes', 'often', 'varies', 'vary', 'depends', 'depending',
  'not always', 'in some cases', 'limited evidence', 'early research', 'estimated', 'approximate',
  'not every', 'not all', 'usually', 'typically', 'on average', 'in general',
];

export function findCaveatKeyword(text: string): string | null {
  for (const k of CAVEAT_KEYWORDS) if (containsPhrase(text, k)) return k;
  return null;
}

/** Episode code pattern from contracts (LU-TECH-001). */
export const EPISODE_CODE_RE = /\bLU-[A-Z]{2,6}-\d{3,}\b/;
