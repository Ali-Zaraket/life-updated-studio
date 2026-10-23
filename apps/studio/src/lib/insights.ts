/**
 * Pure insight calculations (no I/O). Rules: missing is null with a reason, never zero; sources are never mixed
 * in one aggregate; comparisons use one window and one definition/apiVersion; thresholds follow brief §7
 * (>= 5 comparable posts and >= 1,000 combined reach per group, otherwise "insufficient evidence").
 * Observational differences are never causal.
 */
import { safeRate, type RateWithDenominator } from '@life/contracts';

export type Source = 'mock' | 'manual_import' | 'live';
export const WINDOWS = ['1h', '24h', '72h', '7d'] as const;
export type Window = (typeof WINDOWS)[number];

export const MIN_N = 5;
export const MIN_REACH = 1000;
export const INSUFFICIENT = 'Insufficient evidence — keep collecting';

export interface Snap {
  id: string;
  metric: string;
  definition: string;
  unit: string;
  window: string;
  mediaAgeSec: number | null;
  apiVersion: string;
  retrievedAt: string;
  value: number | null;
  unavailabilityReason: string | null;
  source: Source;
  rawResponseId: string | null;
}

export const METRICS = {
  reach: ['reach'],
  views: ['views'],
  saves: ['saves', 'saved'],
  shares: ['shares'],
  watch: ['avg_watch_time_ms', 'ig_reels_avg_watch_time'],
} as const;
export type MetricKey = keyof typeof METRICS;

/** Latest (by retrievedAt) snapshot of a metric in a window, optionally restricted to one source. */
export function latest(snaps: readonly Snap[], key: MetricKey, window: string, source?: Source): Snap | null {
  const names: readonly string[] = METRICS[key];
  let best: Snap | null = null;
  for (const s of snaps) {
    if (s.window !== window || !names.includes(s.metric)) continue;
    if (source && s.source !== source) continue;
    if (!best || Date.parse(s.retrievedAt) > Date.parse(best.retrievedAt)) best = s;
  }
  return best;
}

export const fmtCount = (n: number) => n.toLocaleString('en-US');
export const fmtPct = (r: number) => `${(r * 100).toFixed(1)}%`;

/** "—" plus the reason for a missing value; the value itself otherwise. Never renders null as 0. */
export function describeValue(s: Snap | null, fmt: (n: number) => string = fmtCount): string {
  if (!s) return '— (not collected)';
  if (s.value === null) return `— (${s.unavailabilityReason ?? 'unavailable'})`;
  return fmt(s.value);
}

export function fmtDuration(sec: number | null): string {
  if (sec === null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
}

export function fmtWatch(s: Snap | null): string {
  if (!s) return '— (not collected)';
  if (s.value === null) return `— (${s.unavailabilityReason ?? 'unavailable'})`;
  const sec = s.unit === 'milliseconds' ? s.value / 1000 : s.unit === 'seconds' ? s.value : null;
  return sec === null ? `${s.value} ${s.unit}` : `${sec.toFixed(1)} s`;
}

export interface RateView {
  rate: RateWithDenominator;
  /** "2.1% (27 / 1,280)" or "— (reason)". */
  text: string;
  reason: string | null;
}

function sideReason(label: string, s: Snap | null): string | null {
  if (!s) return `${label} not collected`;
  if (s.value === null) return `${label} unavailable: ${s.unavailabilityReason ?? 'unknown'}`;
  return null;
}

export function rateView(num: Snap | null, den: Snap | null, numLabel: string): RateView {
  const rate = safeRate(num?.value ?? null, den?.value ?? null);
  if (rate.rate !== null) {
    return { rate, reason: null, text: `${fmtPct(rate.rate)} (${fmtCount(rate.numerator!)} / ${fmtCount(rate.denominator!)})` };
  }
  const reasons = [sideReason(numLabel, num), sideReason('reach', den)].filter((x): x is string => x !== null);
  if (reasons.length === 0 && rate.denominator === 0) reasons.push('reach is 0');
  const reason = reasons.join('; ') || 'not computable';
  return { rate, reason, text: `— (${reason})` };
}

export type RateKey = 'saves' | 'shares';
export const RATE_LABEL: Record<RateKey, string> = { saves: 'saves / reach', shares: 'shares / reach' };

/** An episode (per source) with its media snapshots, for comparisons. */
export interface EpisodeData {
  code: string;
  pillar: string;
  format: string;
  source: Source;
  snapshots: Snap[];
}

export interface RatePoint {
  code: string;
  rate: number;
  numerator: number;
  reach: number;
  definitionKey: string;
  definitions: string;
}

/** Rate for one episode at one window, within its own source only; null when not computable. */
export function ratePoint(ep: EpisodeData, key: RateKey, window: string): RatePoint | null {
  const num = latest(ep.snapshots, key, window, ep.source);
  const den = latest(ep.snapshots, 'reach', window, ep.source);
  const r = safeRate(num?.value ?? null, den?.value ?? null);
  if (r.rate === null || !num || !den) return null;
  return {
    code: ep.code,
    rate: r.rate,
    numerator: num.value!,
    reach: den.value!,
    definitionKey: `${num.apiVersion}|${num.definition}||${den.apiVersion}|${den.definition}`,
    definitions: `${key}: "${num.definition}" (api ${num.apiVersion}); reach: "${den.definition}" (api ${den.apiVersion})`,
  };
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface GroupStats {
  label: string;
  n: number;
  combinedReach: number;
  median: number | null;
  min: number | null;
  max: number | null;
  sufficient: boolean;
  /** Why it is insufficient, or null. */
  shortfall: string | null;
}

export function groupStats(label: string, points: readonly RatePoint[]): GroupStats {
  const rates = points.map((p) => p.rate);
  const combinedReach = points.reduce((a, p) => a + p.reach, 0);
  const n = points.length;
  const problems: string[] = [];
  if (n < MIN_N) problems.push(`n=${n} < ${MIN_N}`);
  if (combinedReach < MIN_REACH) problems.push(`combined reach ${fmtCount(combinedReach)} < ${fmtCount(MIN_REACH)}`);
  return {
    label,
    n,
    combinedReach,
    median: median(rates),
    min: n ? Math.min(...rates) : null,
    max: n ? Math.max(...rates) : null,
    sufficient: problems.length === 0,
    shortfall: problems.length ? problems.join('; ') : null,
  };
}

export interface Bucket {
  source: Source;
  definitionKey: string;
  definitions: string;
  groups: GroupStats[];
  /** Ranked only when there are >= 2 groups and every group is sufficient; otherwise alphabetical, unranked. */
  ranked: boolean;
  verdict: string;
}

export interface Comparison {
  rate: RateKey;
  window: string;
  buckets: Bucket[];
  /** More than one definition/apiVersion within a source: shown separately with a warning. */
  definitionWarnings: Source[];
}

/**
 * Compare episodes at one window. Buckets are (source, definition key); a group dimension of null gives one overall group.
 * Episodes are never pooled across sources or definitions.
 */
export function compare(
  episodes: readonly EpisodeData[],
  rate: RateKey,
  window: string,
  dimension: 'pillar' | 'format' | null,
): Comparison {
  const map = new Map<string, { source: Source; key: string; defs: string; byGroup: Map<string, RatePoint[]> }>();
  for (const ep of episodes) {
    const p = ratePoint(ep, rate, window);
    if (!p) continue;
    const id = `${ep.source}##${p.definitionKey}`;
    let b = map.get(id);
    if (!b) map.set(id, (b = { source: ep.source, key: p.definitionKey, defs: p.definitions, byGroup: new Map() }));
    const g = dimension ? ep[dimension] : 'all episodes';
    const arr = b.byGroup.get(g) ?? [];
    arr.push(p);
    b.byGroup.set(g, arr);
  }
  const buckets: Bucket[] = [...map.values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key))
    .map((b) => {
      const groups = [...b.byGroup.entries()].map(([label, pts]) => groupStats(label, pts));
      const allOk = groups.length >= 2 && groups.every((g) => g.sufficient);
      if (allOk) groups.sort((x, y) => (y.median ?? 0) - (x.median ?? 0));
      else groups.sort((x, y) => x.label.localeCompare(y.label));
      const verdict = dimension === null
        ? groups.every((g) => g.sufficient) ? 'Sample meets the minimum heuristic (not a statistical guarantee).' : INSUFFICIENT
        : allOk
          ? 'Ordered by median. Observational only: differences may reflect topic, timing or other confounds, not causes.'
          : groups.length < 2 && groups.every((g) => g.sufficient)
            ? 'Only one group — nothing to compare.'
            : INSUFFICIENT;
      return { source: b.source, definitionKey: b.key, definitions: b.defs, groups, ranked: allOk, verdict };
    });
  const bySource = new Map<Source, number>();
  for (const b of buckets) bySource.set(b.source, (bySource.get(b.source) ?? 0) + 1);
  return { rate, window, buckets, definitionWarnings: [...bySource.entries()].filter(([, c]) => c > 1).map(([s]) => s) };
}

/** Redact secret-looking keys before showing raw provenance JSON. */
export function redactJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactJson);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, /token|secret|authorization|password|key/i.test(k) ? '[redacted]' : redactJson(x)]),
    );
  }
  return v;
}
