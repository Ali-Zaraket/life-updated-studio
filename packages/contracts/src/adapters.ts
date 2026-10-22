import type { MetricSnapshot } from './metrics';

/** Every adapter declares whether it is a mock; mocks are labelled in data, logs and UI. */
export type AdapterMode = 'mock' | 'live';

export type PublisherErrorCode =
  | 'rate_limited'
  | 'token_expired'
  | 'permission_denied'
  | 'invalid_request'
  | 'container_error'
  | 'container_expired'
  /** The request may or may not have taken effect remotely; reconcile before retrying. */
  | 'timeout_ambiguous'
  | 'transient';

export class PublisherError extends Error {
  override readonly name = 'PublisherError';
  constructor(
    readonly code: PublisherErrorCode,
    message: string,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'transient';
  }
}

export interface CreateReelContainerInput {
  accountId: string;
  /** Publicly fetchable URL that stays valid for the whole processing window. */
  videoUrl: string;
  /**
   * Local delivery file. When set, a live adapter may upload the bytes directly
   * (resumable upload) instead of asking Instagram to fetch `videoUrl`, which a
   * localhost studio cannot serve publicly.
   */
  videoFilePath?: string | null;
  coverUrl: string | null;
  caption: string;
  shareToFeed: boolean;
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

export interface RemoteMediaSummary {
  remoteMediaId: string;
  permalink: string;
  caption: string | null;
  timestamp: string;
  mediaType: string;
}

export interface PublishingQuota {
  used: number;
  limit: number;
  windowSec: number;
}

export interface InstagramPublisher {
  readonly mode: AdapterMode;
  /** Whether this publisher can apply a required platform AI label. */
  readonly supportsPlatformAiLabel: boolean;
  createReelContainer(input: CreateReelContainerInput): Promise<{ containerId: string }>;
  getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; errorMessage: string | null }>;
  publishContainer(accountId: string, containerId: string): Promise<{ remoteMediaId: string }>;
  getMedia(remoteMediaId: string): Promise<RemoteMediaSummary>;
  /** Used to reconcile an ambiguous publish: find media whose caption carries the episode code. */
  listRecentMedia(accountId: string, opts: { since: Date; limit: number }): Promise<RemoteMediaSummary[]>;
  getPublishingQuota(accountId: string): Promise<PublishingQuota | null>;
}

export type MetricSnapshotDraft = Omit<MetricSnapshot, 'id' | 'rawResponseId'>;

export interface InsightsReadResult {
  snapshots: MetricSnapshotDraft[];
  /** The unmodified provider response, stored for provenance. */
  raw: unknown;
}

export interface InsightsReader {
  readonly mode: AdapterMode;
  readMediaInsights(input: {
    accountId: string;
    instagramMediaId: string;
    remoteMediaId: string;
    publishedAt: Date;
    metrics: readonly string[];
    now: Date;
  }): Promise<InsightsReadResult>;
}
