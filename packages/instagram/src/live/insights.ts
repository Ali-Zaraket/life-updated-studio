import {
  PublisherError,
  type InsightsReadResult,
  type InsightsReader,
  type MetricSnapshotDraft,
  type UnavailabilityReason,
} from '@life/contracts';
import { GRAPH_ASSUMPTIONS as G } from './assumptions';
import { isTimeoutLike, mapGraphError, readBody, redact, type TokenSource } from './http';
import { windowForAge } from './window';

type Unit = 'count' | 'seconds' | 'milliseconds' | 'ratio';

/** All UNVERIFIED (rec §9). Definitions quote Meta only where the record quotes it. */
const DEFS: Record<string, { definition: string; unit: Unit }> = {
  reach: { definition: 'Number of unique Instagram users that have seen the reel at least once (Meta, rec §9)', unit: 'count' },
  views: { definition: 'Number of times the reel was viewed; replaces plays/impressions (UNVERIFIED definition)', unit: 'count' },
  likes: { definition: 'Number of likes on the reel (UNVERIFIED definition)', unit: 'count' },
  comments: { definition: 'Number of comments on the reel (UNVERIFIED definition)', unit: 'count' },
  saved: { definition: 'Number of times the reel was saved (UNVERIFIED definition and field name)', unit: 'count' },
  shares: { definition: 'Number of times the reel was shared (UNVERIFIED definition)', unit: 'count' },
  total_interactions: { definition: 'Total interactions on the reel (UNVERIFIED metric and definition)', unit: 'count' },
  ig_reels_avg_watch_time: {
    definition: 'The average amount of time spent playing the reel (Meta, rec §9); unit milliseconds is UNVERIFIED (third-party)',
    unit: 'milliseconds',
  },
};

export interface LiveInsightsReaderOptions {
  tokens: TokenSource;
  fetch?: typeof fetch;
  apiVersion?: string;
  /** API metric names this reader may request. */
  allowedMetrics?: readonly string[];
  /** Media younger than this returns not_yet_available without a call. */
  minAgeSec?: number;
  requestTimeoutMs?: number;
}

export class LiveInsightsReader implements InsightsReader {
  readonly mode = 'live' as const;
  private readonly tokens: TokenSource;
  private readonly fetchFn: typeof fetch;
  private readonly apiVersion: string;
  private readonly allowed: ReadonlySet<string>;
  private readonly minAgeSec: number;
  private readonly timeoutMs: number;

  constructor(o: LiveInsightsReaderOptions) {
    this.tokens = o.tokens;
    this.fetchFn = o.fetch ?? globalThis.fetch;
    this.apiVersion = o.apiVersion ?? G.apiVersion;
    this.allowed = new Set(o.allowedMetrics ?? G.fields.reelsMetrics);
    this.minAgeSec = o.minAgeSec ?? G.limits.insightsMinAgeSec;
    this.timeoutMs = o.requestTimeoutMs ?? G.limits.requestTimeoutMs;
  }

  async readMediaInsights(input: {
    accountId: string;
    instagramMediaId: string;
    remoteMediaId: string;
    publishedAt: Date;
    metrics: readonly string[];
    now: Date;
  }): Promise<InsightsReadResult> {
    const ageSec = Math.max(0, Math.floor((input.now.getTime() - input.publishedAt.getTime()) / 1000));
    const window = windowForAge(ageSec);
    const retrievedAt = input.now.toISOString();
    const raw: Array<{ metric: string; apiMetric: string; httpStatus: number | null; body: unknown; skipped?: string }> = [];
    const snapshots: MetricSnapshotDraft[] = [];

    for (const metric of input.metrics) {
      const apiMetric = G.fields.metricAliases[metric] ?? metric;
      const def = DEFS[apiMetric];
      let value: number | null = null;
      let reason: UnavailabilityReason | null = null;

      if (!this.allowed.has(apiMetric) || !def) {
        reason = 'not_supported_by_api_version';
        raw.push({ metric, apiMetric, httpStatus: null, body: null, skipped: 'not in the Reels metric allow-list; not requested' });
      } else if (ageSec < this.minAgeSec) {
        reason = 'not_yet_available';
        raw.push({ metric, apiMetric, httpStatus: null, body: null, skipped: 'media too young; not requested' });
      } else {
        const r = await this.fetchMetric(input.remoteMediaId, apiMetric);
        raw.push({ metric, apiMetric, httpStatus: r.httpStatus, body: r.body });
        value = r.value;
        reason = r.reason;
      }

      snapshots.push({
        scope: 'media',
        accountId: input.accountId,
        instagramMediaId: input.instagramMediaId,
        metric,
        definition: def?.definition ?? `Metric "${metric}" is not in the live allow-list`,
        unit: def?.unit ?? 'count',
        window,
        mediaAgeSec: ageSec,
        apiVersion: this.apiVersion,
        retrievedAt,
        value,
        unavailabilityReason: value === null ? (reason ?? 'not_returned') : null,
        source: 'live',
      });
    }
    return { snapshots, raw: { source: 'live', apiVersion: this.apiVersion, responses: raw } };
  }

  private async fetchMetric(
    mediaId: string,
    apiMetric: string,
  ): Promise<{ value: number | null; reason: UnavailabilityReason | null; httpStatus: number | null; body: unknown }> {
    const token = await this.tokens.getAccessToken();
    const url = new URL(`https://${G.host}/${this.apiVersion}${G.endpoints.mediaInsights(mediaId)}`);
    url.searchParams.set('metric', apiMetric);
    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), {
        method: 'GET',
        headers: { Authorization: G.auth.graphHeader(token), Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return {
        value: null,
        reason: 'api_error',
        httpStatus: null,
        body: { error: redact(`${isTimeoutLike(e) ? 'timeout' : 'network error'}: ${e instanceof Error ? e.message : String(e)}`, token) },
      };
    }
    const body = await readBody(res).catch(() => null);
    if (!res.ok) {
      const err = mapGraphError({ status: res.status, headers: res.headers, body }, `insights ${apiMetric}`, token);
      if (err.code === 'token_expired') throw err;
      const text = ((body as { error?: { message?: string } } | null)?.error?.message ?? '').toLowerCase();
      let reason: UnavailabilityReason = 'api_error';
      if (err.code === 'permission_denied') reason = 'permission_missing';
      else if (/not support|unsupported|no longer|deprecated|not available for|does not exist|invalid metric/.test(text)) reason = 'not_supported_by_api_version';
      return { value: null, reason, httpStatus: res.status, body };
    }
    const entry = (body as { data?: Array<{ values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> } | null)?.data?.[0];
    const v = entry?.values?.[0]?.value ?? entry?.total_value?.value;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      // Absent or empty data is "not returned", never zero (rec §9: empty data set instead of 0).
      return { value: null, reason: 'not_returned', httpStatus: res.status, body };
    }
    return { value: v, reason: null, httpStatus: res.status, body };
  }
}

