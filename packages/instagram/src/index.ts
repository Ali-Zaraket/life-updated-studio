import { createHash } from 'node:crypto';
import {
  PublisherError,
  type ContainerStatus,
  type CreateReelContainerInput,
  type InsightsReadResult,
  type InsightsReader,
  type InstagramPublisher,
  type MetricSnapshotDraft,
  type MetricWindow,
  type PublisherErrorCode,
  type PublishingQuota,
  type RemoteMediaSummary,
  type UnavailabilityReason,
} from '@life/contracts';

import { windowForAge } from './live/window';

export * from './live/index';

export const MOCK_API_VERSION = 'mock-v0';
const MOCK_HOST = 'https://mock-instagram.invalid/reel/';

// ---------------------------------------------------------------------------
// Mock publisher
// ---------------------------------------------------------------------------

export interface MockPublisherScript {
  /** Thrown by successive createReelContainer calls, then calls succeed. */
  createErrors?: PublisherErrorCode[];
  /** IN_PROGRESS polls before the final status (default 1). */
  processingPolls?: number;
  containerOutcome?: 'FINISHED' | 'ERROR' | 'EXPIRED';
  /** Per successive publish call; the last entry repeats. Default ['ok']. */
  publishBehavior?: Array<
    'ok' | 'timeout_after_success' | 'timeout_before_success' | 'rate_limited' | 'token_expired' | 'transient'
  >;
  quota?: { used: number; limit: number };
}

interface MockContainer {
  id: string;
  accountId: string;
  caption: string;
  pollsLeft: number;
  outcome: 'FINISHED' | 'ERROR' | 'EXPIRED';
  published: boolean;
}

interface MockMedia extends RemoteMediaSummary {
  accountId: string;
  seq: number;
}

const QUOTA_WINDOW_SEC = 24 * 3600;

export class MockInstagramPublisher implements InstagramPublisher {
  readonly mode = 'mock' as const;
  readonly supportsPlatformAiLabel = false;

  private readonly script: MockPublisherScript;
  private readonly clock: () => Date;
  private readonly prefix: string;
  private readonly containers = new Map<string, MockContainer>();
  private readonly media: MockMedia[] = [];
  private readonly createErrorQueue: PublisherErrorCode[];
  private containerSeq = 0;
  private mediaSeq = 0;
  private publishCalls = 0;

  constructor(opts: { script?: MockPublisherScript; clock?: () => Date; idPrefix?: string } = {}) {
    this.script = opts.script ?? {};
    this.clock = opts.clock ?? (() => new Date());
    this.prefix = opts.idPrefix ?? 'mock';
    this.createErrorQueue = [...(this.script.createErrors ?? [])];
  }

  /** Inspectable remote state, for tests. */
  get published(): ReadonlyArray<RemoteMediaSummary> {
    return this.media.map(({ accountId: _a, seq: _s, ...m }) => m);
  }

  publishCount(): number {
    return this.media.length;
  }

  async createReelContainer(input: CreateReelContainerInput): Promise<{ containerId: string }> {
    const code = this.createErrorQueue.shift();
    if (code) throw mockError(code, 'create');
    const id = `${this.prefix}_container_${++this.containerSeq}`;
    this.containers.set(id, {
      id,
      accountId: input.accountId,
      caption: input.caption,
      pollsLeft: Math.max(0, this.script.processingPolls ?? 1),
      outcome: this.script.containerOutcome ?? 'FINISHED',
      published: false,
    });
    return { containerId: id };
  }

  async getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; errorMessage: string | null }> {
    const c = this.mustGet(containerId);
    if (c.published) return { status: 'PUBLISHED', errorMessage: null };
    if (c.pollsLeft > 0) {
      c.pollsLeft -= 1;
      return { status: 'IN_PROGRESS', errorMessage: null };
    }
    if (c.outcome === 'ERROR') return { status: 'ERROR', errorMessage: 'MOCK: media processing failed' };
    if (c.outcome === 'EXPIRED') return { status: 'EXPIRED', errorMessage: 'MOCK: container expired' };
    return { status: 'FINISHED', errorMessage: null };
  }

  async publishContainer(accountId: string, containerId: string): Promise<{ remoteMediaId: string }> {
    const c = this.mustGet(containerId);
    if (c.published) throw new PublisherError('container_error', `MOCK: container ${containerId} is already PUBLISHED`);
    if (c.pollsLeft > 0 || c.outcome !== 'FINISHED') {
      throw new PublisherError('container_error', `MOCK: container ${containerId} is not FINISHED`);
    }
    const behaviors = this.script.publishBehavior ?? ['ok'];
    const behavior = behaviors[Math.min(this.publishCalls, behaviors.length - 1)] ?? 'ok';
    this.publishCalls += 1;

    switch (behavior) {
      case 'rate_limited':
        throw mockError('rate_limited', 'publish');
      case 'token_expired':
        throw mockError('token_expired', 'publish');
      case 'transient':
        throw mockError('transient', 'publish');
      case 'timeout_before_success':
        throw new PublisherError('timeout_ambiguous', 'MOCK: publish timed out (nothing was published)');
      case 'timeout_after_success': {
        this.record(accountId, c);
        throw new PublisherError('timeout_ambiguous', 'MOCK: publish timed out (it did take effect remotely)');
      }
      case 'ok':
        return { remoteMediaId: this.record(accountId, c).remoteMediaId };
    }
  }

  async getMedia(remoteMediaId: string): Promise<RemoteMediaSummary> {
    const m = this.media.find((x) => x.remoteMediaId === remoteMediaId);
    if (!m) throw new PublisherError('invalid_request', `MOCK: unknown media ${remoteMediaId}`);
    return strip(m);
  }

  async listRecentMedia(accountId: string, opts: { since: Date; limit: number }): Promise<RemoteMediaSummary[]> {
    const sinceMs = opts.since.getTime();
    return this.media
      .filter((m) => m.accountId === accountId && Date.parse(m.timestamp) >= sinceMs)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq)
      .slice(0, Math.max(0, opts.limit))
      .map(strip);
  }

  async getPublishingQuota(_accountId: string): Promise<PublishingQuota | null> {
    const q = this.script.quota;
    return { used: q ? q.used : this.media.length, limit: q ? q.limit : 100, windowSec: QUOTA_WINDOW_SEC };
  }

  private mustGet(id: string): MockContainer {
    const c = this.containers.get(id);
    if (!c) throw new PublisherError('invalid_request', `MOCK: unknown container ${id}`);
    return c;
  }

  private record(accountId: string, c: MockContainer): MockMedia {
    const seq = ++this.mediaSeq;
    const id = `${this.prefix}_media_${seq}`;
    const m: MockMedia = {
      remoteMediaId: id,
      permalink: `${MOCK_HOST}${id}`,
      caption: c.caption,
      timestamp: this.clock().toISOString(),
      mediaType: 'REELS',
      accountId,
      seq,
    };
    this.media.push(m);
    c.published = true;
    return m;
  }
}

function strip({ accountId: _a, seq: _s, ...m }: MockMedia): RemoteMediaSummary {
  return m;
}

function mockError(code: PublisherErrorCode, op: string): PublisherError {
  const retryAfter = code === 'rate_limited' ? 60 : null;
  return new PublisherError(code, `MOCK: scripted ${code} during ${op}`, retryAfter);
}

// ---------------------------------------------------------------------------
// Container polling
// ---------------------------------------------------------------------------

export async function waitForContainer(
  p: InstagramPublisher,
  containerId: string,
  o: {
    pollIntervalMs: number;
    deadlineMs: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  },
): Promise<'FINISHED'> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const start = now();
  for (;;) {
    const { status, errorMessage } = await p.getContainerStatus(containerId);
    if (status === 'FINISHED') return 'FINISHED';
    if (status === 'ERROR') {
      throw new PublisherError('container_error', errorMessage ?? `container ${containerId} failed processing`);
    }
    if (status === 'EXPIRED') {
      throw new PublisherError('container_expired', errorMessage ?? `container ${containerId} expired`);
    }
    if (status === 'PUBLISHED') {
      throw new PublisherError('container_error', `container ${containerId} is already published`);
    }
    if (now() - start >= o.deadlineMs) {
      throw new PublisherError(
        'transient',
        `container ${containerId} still IN_PROGRESS after ${o.deadlineMs}ms (processing deadline exceeded)`,
      );
    }
    await sleep(o.pollIntervalMs);
  }
}

// ---------------------------------------------------------------------------
// Reconciliation of ambiguous publishes
// ---------------------------------------------------------------------------

export type ReconcileOutcome =
  | { outcome: 'found'; media: RemoteMediaSummary }
  | { outcome: 'not_found' }
  | { outcome: 'multiple'; candidates: RemoteMediaSummary[] };

const RECONCILE_SCAN_LIMIT = 100;

export async function reconcileAmbiguousPublish(i: {
  publisher: InstagramPublisher;
  accountId: string;
  episodeCode: string;
  since: Date;
}): Promise<ReconcileOutcome> {
  const recent = await i.publisher.listRecentMedia(i.accountId, { since: i.since, limit: RECONCILE_SCAN_LIMIT });
  const token = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(i.episodeCode)}(?![A-Za-z0-9_-])`);
  const matches = recent.filter((m) => m.caption !== null && token.test(m.caption));
  if (matches.length === 0) return { outcome: 'not_found' };
  if (matches.length === 1) return { outcome: 'found', media: matches[0]! };
  return { outcome: 'multiple', candidates: matches };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Mock insights
// ---------------------------------------------------------------------------

type MetricUnitName = 'count' | 'seconds' | 'milliseconds' | 'ratio';

interface MetricDef {
  definition: string;
  unit: MetricUnitName;
  min: number;
  max: number;
  /** Not available before this media age (seconds), with reason not_yet_available. */
  minAgeSec?: number;
}

const HOUR = 3600;

const METRICS: Readonly<Record<string, MetricDef>> = {
  reach: { definition: 'MOCK: unique accounts that saw the Reel at least once', unit: 'count', min: 400, max: 5000 },
  views: { definition: 'MOCK: number of times the Reel was played or replayed', unit: 'count', min: 600, max: 9000 },
  likes: { definition: 'MOCK: number of likes on the Reel', unit: 'count', min: 5, max: 400 },
  comments: { definition: 'MOCK: number of comments on the Reel', unit: 'count', min: 0, max: 40 },
  saves: { definition: 'MOCK: number of times the Reel was saved', unit: 'count', min: 0, max: 150 },
  shares: { definition: 'MOCK: number of times the Reel was shared', unit: 'count', min: 0, max: 80 },
  total_interactions: {
    definition: 'MOCK: likes + comments + saves + shares',
    unit: 'count',
    min: 10,
    max: 600,
  },
  avg_watch_time_ms: {
    definition: 'MOCK: average time a viewer spent watching the Reel',
    unit: 'milliseconds',
    min: 2000,
    max: 9000,
    minAgeSec: 24 * HOUR,
  },
};

const WINDOW_FACTOR: Record<'1h' | '24h' | '72h' | '7d', number> = { '1h': 0.15, '24h': 0.6, '72h': 0.85, '7d': 1 };

export const mockWindowForAge = windowForAge;

export class MockInsightsReader implements InsightsReader {
  readonly mode = 'mock' as const;
  private readonly seed: number;

  constructor(opts: { seed?: number } = {}) {
    this.seed = opts.seed ?? 1;
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
    const window: MetricWindow = mockWindowForAge(ageSec);
    const retrievedAt = input.now.toISOString();
    const rawMetrics: Record<string, { value: number | null; reason: UnavailabilityReason | null }> = {};

    const snapshots: MetricSnapshotDraft[] = input.metrics.map((metric) => {
      const def = METRICS[metric];
      let value: number | null = null;
      let reason: UnavailabilityReason | null = null;
      if (!def) {
        reason = 'not_supported_by_api_version';
      } else if (ageSec < HOUR || (def.minAgeSec !== undefined && ageSec < def.minAgeSec)) {
        reason = 'not_yet_available';
      } else {
        value = this.valueFor(input.remoteMediaId, metric, window, def);
      }
      rawMetrics[metric] = { value, reason };
      return {
        scope: 'media',
        accountId: input.accountId,
        instagramMediaId: input.instagramMediaId,
        metric,
        definition: def?.definition ?? `MOCK: unknown metric "${metric}"`,
        unit: def?.unit ?? 'count',
        window,
        mediaAgeSec: ageSec,
        apiVersion: MOCK_API_VERSION,
        retrievedAt,
        value,
        unavailabilityReason: reason,
        source: 'mock',
      };
    });

    return {
      snapshots,
      raw: {
        mock: true,
        source: 'mock',
        apiVersion: MOCK_API_VERSION,
        note: 'MOCK insights: deterministic synthetic data, not from Instagram',
        remoteMediaId: input.remoteMediaId,
        window,
        mediaAgeSec: ageSec,
        metrics: rawMetrics,
      },
    };
  }

  private valueFor(remoteMediaId: string, metric: string, window: MetricWindow, def: MetricDef): number {
    const h = createHash('sha256').update(`${this.seed}|${remoteMediaId}|${metric}`).digest();
    const u = h.readUInt32BE(0) / 0xffffffff; // stable per (seed, media, metric); scaled by window
    const full = def.min + u * (def.max - def.min);
    const factor = def.unit === 'milliseconds' ? 1 : WINDOW_FACTOR[window as keyof typeof WINDOW_FACTOR];
    return Math.round(full * factor);
  }
}
