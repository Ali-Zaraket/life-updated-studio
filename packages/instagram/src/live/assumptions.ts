/**
 * Everything the live Instagram adapter believes about the Graph API, in one place.
 *
 * EVERY ENTRY IS UNVERIFIED until the first live call. No official Meta page could be
 * fetched when this was written (docs/research/instagram-capability-record.md, "Read this
 * first"). The "rec §N" tags point at the research-record section each value came from.
 * When a live call confirms or contradicts an entry, change it HERE and nowhere else, and
 * record the date.
 *
 * Login path (rec §2, ADR 0002): Instagram API with Instagram Login ONLY. The adapter must
 * never talk to graph.facebook.com (Facebook Login path). The one facebook.com host used is
 * the resumable-upload host, which the record says is where upload URIs point (rec §5.6);
 * it is only ever sent a URI the Graph API returned, and only if it matches `uploadHost`.
 */
export const GRAPH_ASSUMPTIONS = {
  /** UNVERIFIED (rec §2): "All endpoints can be accessed via the graph.instagram.com host". */
  host: 'graph.instagram.com',
  /** UNVERIFIED (rec §1): v26.0 released 2026-07-29. Re-read the v26.0 changelog (2026-10-27 change). */
  apiVersion: 'v26.0',
  /** UNVERIFIED (rec §2): the adapter refuses hosts and scopes of the other login path. */
  loginPath: 'instagram',
  forbiddenHosts: ['graph.facebook.com'],

  auth: {
    /** UNVERIFIED (not in rec): Graph endpoints accept `Authorization: Bearer <token>`. Fallback is access_token in the query (redacted in every error). */
    graphHeader: (token: string) => `Bearer ${token}`,
    /** UNVERIFIED (rec §5.6 says header details unknown): resumable upload uses `Authorization: OAuth <token>`. */
    uploadHeader: (token: string) => `OAuth ${token}`,
  },

  endpoints: {
    /** UNVERIFIED (rec §5.1): POST /{ig-user-id}/media */
    createContainer: (igUserId: string) => `/${igUserId}/media`,
    /** UNVERIFIED (rec §5.2): GET /{container-id}?fields=status_code */
    containerStatus: (containerId: string) => `/${containerId}`,
    /** UNVERIFIED (rec §5.3): POST /{ig-user-id}/media_publish (creation_id) */
    publish: (igUserId: string) => `/${igUserId}/media_publish`,
    /** UNVERIFIED (rec §5.4): GET /{media-id}?fields=... */
    media: (mediaId: string) => `/${mediaId}`,
    /** UNVERIFIED (not in rec; standard Graph edge): GET /{ig-user-id}/media */
    listMedia: (igUserId: string) => `/${igUserId}/media`,
    /** UNVERIFIED (rec §6): GET /{ig-user-id}/content_publishing_limit */
    quota: (igUserId: string) => `/${igUserId}/content_publishing_limit`,
    /** UNVERIFIED (rec §9): GET /{media-id}/insights?metric=... */
    mediaInsights: (mediaId: string) => `/${mediaId}/insights`,
    /** UNVERIFIED (rec §4): unversioned path, GET with grant_type=ig_refresh_token. Token must be in the query here. */
    refreshToken: '/refresh_access_token',
  },

  params: {
    /** UNVERIFIED (rec §5.1) */
    mediaType: 'REELS',
    /** UNVERIFIED (rec §5.6) */
    uploadTypeResumable: 'resumable',
    /** UNVERIFIED (rec §5.1): milliseconds per a third-party guide. */
    thumbOffsetUnit: 'milliseconds',
    /** UNVERIFIED (rec §4) */
    refreshGrantType: 'ig_refresh_token',
    /** UNVERIFIED (rec §10): is_ai_generated is third-party only. supportsPlatformAiLabel stays false; we never send it. */
    aiLabelField: null as string | null,
  },

  fields: {
    /** UNVERIFIED (rec §5.2) */
    containerStatus: 'status_code,status',
    /** UNVERIFIED (rec §5.4; media_type reads back VIDEO after publishing) */
    media: 'id,permalink,caption,timestamp,media_type',
    /** UNVERIFIED (rec §6): field names unverified this session. */
    quota: 'quota_usage,config',
    /** UNVERIFIED (rec §9; saves/shares field names, total_interactions and avg watch time unit unconfirmed). */
    reelsMetrics: [
      'reach',
      'views',
      'likes',
      'comments',
      'saved',
      'shares',
      'total_interactions',
      'ig_reels_avg_watch_time',
    ],
    /** Studio metric names -> API metric names. UNVERIFIED (rec §9: "saved" vs "saves"). */
    metricAliases: { saves: 'saved', avg_watch_time_ms: 'ig_reels_avg_watch_time' } as Record<string, string>,
  },

  /** UNVERIFIED (rec §5.2). Anything else is treated as a transient/unknown status. */
  containerStatusCodes: ['EXPIRED', 'ERROR', 'FINISHED', 'IN_PROGRESS', 'PUBLISHED'],

  resumableUpload: {
    /** UNVERIFIED (rec §5.6): upload URIs look like rupload.facebook.com/ig-api-upload/<version>/<container-id>. */
    uploadHost: 'rupload.facebook.com',
    uploadPath: (version: string, containerId: string) => `/ig-api-upload/${version}/${containerId}`,
    /** UNVERIFIED (rec §5.6: "Header and offset details unverified"). Values are strings. */
    offsetHeader: 'offset',
    fileSizeHeader: 'file_size',
    /** UNVERIFIED: whole file sent in one POST at offset 0 (no chunking). */
    singleRequestFromOffset0: true,
  },

  errors: {
    /** UNVERIFIED (rec §5/6 plus general Graph API conventions; app-level BUC codes per rec §6 third-party). */
    tokenExpiredCodes: [190],
    /** 4 app, 17 user, 32 page, 613 custom, 80001-80006 Business Use Case, 9 + subcode 2207042 = publishing limit (rec §6 third-party). */
    rateLimitCodes: [4, 9, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006],
    /** 10 = permission denied, 200-299 = permissions (general Graph convention). */
    permissionCodes: [10],
    permissionCodeRange: [200, 299] as [number, number],
    invalidParamCodes: [100],
    /** 1 unknown, 2 service temporarily unavailable. */
    transientCodes: [1, 2],
    /** Fallback wait when a rate limit gives no hint. Conservative; provisional. */
    defaultRetryAfterSec: 1800,
    /** UNVERIFIED (rec §6 third-party): header carrying BUC usage, estimated_time_to_regain_access in MINUTES. */
    bucHeader: 'x-business-use-case-usage',
  },

  limits: {
    /** UNVERIFIED conflict (rec §8): Meta summary says 300 MB, older guides say 100 MB. PROVISIONAL default. */
    maxUploadBytes: 300 * 1024 * 1024,
    /** UNVERIFIED conflict (rec §6): 100 vs 50 posts per 24h. Quota is read live; this is not used for decisions. */
    quotaWindowSecFallback: 24 * 3600,
    /** UNVERIFIED (rec §9): data may lag up to 48 hours; below one hour nothing is requested. */
    insightsMinAgeSec: 3600,
    /** Provisional client-side timeouts (ms). */
    requestTimeoutMs: 30_000,
    uploadTimeoutMs: 10 * 60_000,
    pageSize: 50,
  },
} as const;
