import type { ScriptBeat } from '@life/contracts';

export interface CaptionCue {
  index: number;
  startSec: number;
  endSec: number;
  /** One or two lines; never split mid-word. */
  lines: string[];
  beatIndex: number;
}

export interface CaptionOptions {
  /** Narration pace used to bound how long speech lasts inside a beat when the real duration is unknown. */
  wordsPerMinute: number;
  /** Real narration length. When given, the beat timeline is stretched/shrunk to end exactly here. */
  narrationDurationSec?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
}

export const DEFAULT_MAX_CHARS_PER_LINE = 32;
export const DEFAULT_MAX_LINES = 2;
const MIN_WORDS_BEFORE_SENTENCE_BREAK = 4;

type TimedBeat = Pick<ScriptBeat, 'startSec' | 'endSec' | 'narration'>;

export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Scale beat times so the last beat ends at narrationDurationSec. Identity when undefined. */
export function scaleBeats<T extends { startSec: number; endSec: number }>(beats: T[], narrationDurationSec?: number): T[] {
  if (narrationDurationSec === undefined || beats.length === 0) return beats.map((b) => ({ ...b }));
  if (!(narrationDurationSec > 0)) throw new RangeError('narrationDurationSec must be positive');
  const last = Math.max(...beats.map((b) => b.endSec));
  const k = narrationDurationSec / last;
  return beats.map((b) => ({ ...b, startSec: round3(b.startSec * k), endSec: round3(b.endSec * k) }));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Greedy line fill. A single word longer than the limit gets its own line (checkCaptionLayout reports it). */
function fillLines(words: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/** Split words into cues of at most maxLines lines; prefers ending a cue at sentence punctuation. */
function splitIntoCues(words: string[], maxChars: number, maxLines: number): string[][] {
  const cues: string[][] = [];
  let i = 0;
  while (i < words.length) {
    // Longest run of words that fits maxLines lines.
    let end = i;
    while (end < words.length && fillLines(words.slice(i, end + 1), maxChars).length <= maxLines) end++;
    if (end === i) end = i + 1; // safety: oversized single word
    // Prefer a sentence break inside the run when it leaves a reasonable cue.
    let cut = end;
    for (let k = i + MIN_WORDS_BEFORE_SENTENCE_BREAK; k <= end; k++) {
      if (/[.!?]["')\]]*$/.test(words[k - 1]!) && k < end) {
        cut = k;
        break;
      }
    }
    // Avoid leaving a 1-word orphan cue at the end of the beat.
    if (words.length - cut === 1 && cut === end && end - i > 1) cut = end - 1;
    cues.push(words.slice(i, cut));
    i = cut;
  }
  return cues.map((c) => c);
}

export function buildCaptionTimeline(beats: TimedBeat[], opts: CaptionOptions): CaptionCue[] {
  if (!(opts.wordsPerMinute > 0)) throw new RangeError('wordsPerMinute must be positive');
  const maxChars = opts.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE;
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES;
  const scaled = scaleBeats(beats, opts.narrationDurationSec);
  const cues: CaptionCue[] = [];

  scaled.forEach((beat, beatIndex) => {
    const words = wordsOf(beat.narration);
    if (words.length === 0) return;
    const span = beat.endSec - beat.startSec;
    // With a real narration duration the beat span is authoritative. Otherwise speech cannot run longer
    // than the words take at the chosen pace, so cues do not linger across silent time.
    const speech = opts.narrationDurationSec !== undefined ? span : Math.min(span, (words.length * 60) / opts.wordsPerMinute);
    const groups = splitIntoCues(words, maxChars, maxLines);
    let t = beat.startSec;
    groups.forEach((g, gi) => {
      const dur = (speech * g.length) / words.length;
      const end = gi === groups.length - 1 ? beat.startSec + speech : t + dur;
      cues.push({
        index: 0,
        startSec: round3(t),
        endSec: round3(end),
        lines: fillLines(g, maxChars),
        beatIndex,
      });
      t = end;
    });
  });
  return cues.map((c, i) => ({ ...c, index: i + 1 }));
}

// ---------------------------------------------------------------------------
// Layout check
// ---------------------------------------------------------------------------

export interface CaptionIssue {
  code: 'too_many_lines' | 'line_too_long' | 'empty_cue' | 'bad_timing' | 'overlap';
  cueIndex: number;
  message: string;
}

export function checkCaptionLayout(
  cues: CaptionCue[],
  limits: { maxCharsPerLine: number; maxLines: number },
): CaptionIssue[] {
  const issues: CaptionIssue[] = [];
  let prevEnd = -Infinity;
  for (const c of cues) {
    if (c.lines.length === 0 || c.lines.every((l) => l.trim() === '')) {
      issues.push({ code: 'empty_cue', cueIndex: c.index, message: 'cue has no text' });
    }
    if (c.lines.length > limits.maxLines) {
      issues.push({ code: 'too_many_lines', cueIndex: c.index, message: `${c.lines.length} lines; limit ${limits.maxLines}` });
    }
    c.lines.forEach((l, li) => {
      if (l.length > limits.maxCharsPerLine) {
        issues.push({
          code: 'line_too_long',
          cueIndex: c.index,
          message: `line ${li + 1} is ${l.length} chars; limit ${limits.maxCharsPerLine}`,
        });
      }
    });
    if (!(c.endSec > c.startSec)) {
      issues.push({ code: 'bad_timing', cueIndex: c.index, message: `end ${c.endSec} is not after start ${c.startSec}` });
    }
    if (c.startSec < prevEnd - 1e-6) {
      issues.push({ code: 'overlap', cueIndex: c.index, message: `starts ${c.startSec} before previous cue ends ${prevEnd}` });
    }
    prevEnd = c.endSec;
  }
  return issues;
}

// ---------------------------------------------------------------------------
// SRT / VTT
// ---------------------------------------------------------------------------

function stamp(sec: number, sep: ',' | '.'): string {
  const totalMs = Math.round(sec * 1000);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

export function toSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.startSec, ',')} --> ${stamp(c.endSec, ',')}\n${c.lines.join('\n')}\n`)
    .join('\n');
}

export function toVtt(cues: CaptionCue[]): string {
  const body = cues.map((c) => `${stamp(c.startSec, '.')} --> ${stamp(c.endSec, '.')}\n${c.lines.join('\n')}\n`).join('\n');
  return `WEBVTT\n\n${body}`;
}
