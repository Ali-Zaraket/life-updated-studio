import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  PublisherError,
  type ContainerStatus,
  type CreateReelContainerInput,
  type InstagramPublisher,
  type PublishingQuota,
  type RemoteMediaSummary,
} from '@life/contracts';
import { GRAPH_ASSUMPTIONS as G } from './assumptions';
import { isTimeoutLike, mapGraphError, readBody, redact, type GraphResponse, type TokenSource } from './http';

export interface LiveInstagramPublisherOptions {
  igUserId: string;
  tokens: TokenSource;
  fetch?: typeof fetch;
  now?: () => Date;
  apiVersion?: string;
  /** Per-request timeout. */
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
  /** Largest local file we will upload. PROVISIONAL default 300 MiB (see GRAPH_ASSUMPTIONS.limits). */
  maxUploadBytes?: number;
  /** Frame (ms) used for the cover when no usable cover_url exists. Default 0. */
  thumbOffsetMs?: number;
}

const STATUS_SET = new Set<string>(G.containerStatusCodes);

export class LiveInstagramPublisher implements InstagramPublisher {
  readonly mode = 'live' as const;
  /** Stays false: is_ai_generated is third-party-only (rec §10). Reels needing the label are held upstream. */
  readonly supportsPlatformAiLabel = false;

  private readonly igUserId: string;
  private readonly tokens: TokenSource;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;
  readonly apiVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly maxUploadBytes: number;
  private readonly thumbOffsetMs: number;

  constructor(o: LiveInstagramPublisherOptions) {
    this.igUserId = o.igUserId;
    this.tokens = o.tokens;
    this.fetchFn = o.fetch ?? globalThis.fetch;
    this.now = o.now ?? (() => new Date());
    this.apiVersion = o.apiVersion ?? G.apiVersion;
    this.requestTimeoutMs = o.requestTimeoutMs ?? G.limits.requestTimeoutMs;
    this.uploadTimeoutMs = o.uploadTimeoutMs ?? G.limits.uploadTimeoutMs;
    this.maxUploadBytes = o.maxUploadBytes ?? G.limits.maxUploadBytes;
    this.thumbOffsetMs = o.thumbOffsetMs ?? 0;
    if (!/^\d+$/.test(this.igUserId)) throw new PublisherError('invalid_request', 'igUserId must be numeric');
  }

  /**
   * Note: `accountId` arguments in the InstagramPublisher contract are the studio's own
   * account id; the Instagram user id for URLs always comes from the constructor.
   */
  async createReelContainer(input: CreateReelContainerInput): Promise<{ containerId: string }> {
    const form = new URLSearchParams();
    form.set('media_type', G.params.mediaType);
    form.set('caption', input.caption);
    form.set('share_to_feed', String(input.shareToFeed));

    // Cover: cover_url must be a public https URL Instagram can fetch. A local file, a mock
    // host (*.invalid, mock-*) or a private-network host cannot be one, so fall back to
    // thumb_offset (a frame of the video itself, in ms).
    if (input.coverUrl && isPublicHttps(input.coverUrl)) form.set('cover_url', input.coverUrl);
    else form.set('thumb_offset', String(this.thumbOffsetMs));

    let fileSize = 0;
    const filePath = input.videoFilePath ?? null;
    if (filePath) {
      const st = await stat(filePath).catch(() => null);
      if (!st || !st.isFile()) throw new PublisherError('invalid_request', 'videoFilePath is not a readable file');
      if (st.size <= 0) throw new PublisherError('invalid_request', 'video file is empty');
      if (st.size > this.maxUploadBytes) {
        throw new PublisherError('invalid_request', `video file is ${st.size} bytes, over the ${this.maxUploadBytes} byte upload limit`);
      }
      fileSize = st.size;
      form.set('upload_type', G.params.uploadTypeResumable);
    } else {
      if (!isPublicHttps(input.videoUrl)) {
        throw new PublisherError('invalid_request', 'videoUrl must be a public https URL (or supply videoFilePath)');
      }
      form.set('video_url', input.videoUrl);
    }

    const res = await this.call('POST', G.endpoints.createContainer(this.igUserId), 'create container', { form });
    const body = res.body as { id?: unknown; uri?: unknown };
    if (typeof body?.id !== 'string' || !body.id) {
      throw new PublisherError('transient', 'create container: response had no container id');
    }
    const containerId = body.id;
    if (filePath) {
      const uri = typeof body.uri === 'string' && body.uri ? body.uri : this.defaultUploadUri(containerId);
      await this.upload(uri, containerId, filePath, fileSize);
    }
    return { containerId };
  }

  async getContainerStatus(containerId: string): Promise<{ status: ContainerStatus; errorMessage: string | null }> {
    const res = await this.call('GET', G.endpoints.containerStatus(containerId), 'container status', {
      query: { fields: G.fields.containerStatus },
    });
    const b = res.body as { status_code?: unknown; status?: unknown };
    const code = typeof b?.status_code === 'string' ? b.status_code : '';
    if (!STATUS_SET.has(code)) throw new PublisherError('transient', `container status: unrecognised status_code "${code.slice(0, 40)}"`);
    const detail = typeof b.status === 'string' ? b.status : null;
    return { status: code as ContainerStatus, errorMessage: code === 'ERROR' || code === 'EXPIRED' ? (detail ?? null) : null };
  }

  async publishContainer(_accountId: string, containerId: string): Promise<{ remoteMediaId: string }> {
    const form = new URLSearchParams({ creation_id: containerId });
    const res = await this.call('POST', G.endpoints.publish(this.igUserId), 'publish', { form, ambiguousOnTimeout: true });
    const id = (res.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) {
      // 2xx with no id: the publish may have happened. Never retry blindly.
      throw new PublisherError('timeout_ambiguous', 'publish: response had no media id; reconcile before retrying');
    }
    return { remoteMediaId: id };
  }

  async getMedia(remoteMediaId: string): Promise<RemoteMediaSummary> {
    const res = await this.call('GET', G.endpoints.media(remoteMediaId), 'get media', { query: { fields: G.fields.media } });
    const m = toSummary(res.body);
    if (!m) throw new PublisherError('transient', 'get media: response missing required fields');
    return m;
  }

  async listRecentMedia(_accountId: string, opts: { since: Date; limit: number }): Promise<RemoteMediaSummary[]> {
    const limit = Math.max(0, Math.floor(opts.limit));
    if (limit === 0) return [];
    const sinceMs = opts.since.getTime();
    const out: RemoteMediaSummary[] = [];
    let res = await this.call('GET', G.endpoints.listMedia(this.igUserId), 'list media', {
      query: {
        fields: G.fields.media,
        limit: String(Math.min(limit, G.limits.pageSize)),
        since: String(Math.floor(sinceMs / 1000)),
      },
    });
    for (let page = 0; page < 20; page++) {
      const b = res.body as { data?: unknown[]; paging?: { next?: unknown } } | null;
      for (const item of b?.data ?? []) {
        const m = toSummary(item);
        if (m && Date.parse(m.timestamp) >= sinceMs) out.push(m);
        if (out.length >= limit) return out;
      }
      const next = b?.paging?.next;
      if (typeof next !== 'string' || !next) break;
      res = await this.call('GET', this.nextPath(next), 'list media (next page)', { rawQuery: this.nextQuery(next) });
    }
    return out;
  }

  async getPublishingQuota(_accountId: string): Promise<PublishingQuota | null> {
    try {
      const res = await this.call('GET', G.endpoints.quota(this.igUserId), 'publishing quota', {
        query: { fields: G.fields.quota },
      });
      const row = (res.body as { data?: Array<Record<string, unknown>> } | null)?.data?.[0];
      const config = row?.config as { quota_total?: unknown; quota_duration?: unknown } | undefined;
      const used = row?.quota_usage;
      if (typeof used !== 'number' || typeof config?.quota_total !== 'number') return null;
      const windowSec = typeof config.quota_duration === 'number' ? config.quota_duration : G.limits.quotaWindowSecFallback;
      return { used, limit: config.quota_total, windowSec };
    } catch (e) {
      if (e instanceof PublisherError && e.code === 'token_expired') throw e;
      return null; // unavailable: unknown, not zero
    }
  }

  // -------------------------------------------------------------------------

  private defaultUploadUri(containerId: string): string {
    return `https://${G.resumableUpload.uploadHost}${G.resumableUpload.uploadPath(this.apiVersion, containerId)}`;
  }

  private async upload(uri: string, containerId: string, filePath: string, size: number): Promise<void> {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new PublisherError('transient', 'resumable upload: returned uri is not a URL');
    }
    if (url.protocol !== 'https:' || url.hostname !== G.resumableUpload.uploadHost) {
      // SSRF guard: only send the video to the documented upload host.
      throw new PublisherError('transient', 'resumable upload: returned uri host is not the expected upload host');
    }
    const token = await this.tokens.getAccessToken();
    const stream = createReadStream(filePath);
    try {
      // duplex is required by undici for streamed bodies but absent from the lib types.
      const init = {
        method: 'POST',
        headers: {
          Authorization: G.auth.uploadHeader(token),
          [G.resumableUpload.offsetHeader]: '0',
          [G.resumableUpload.fileSizeHeader]: String(size),
        },
        body: Readable.toWeb(stream),
        duplex: 'half',
        signal: AbortSignal.timeout(this.uploadTimeoutMs),
      };
      const res = await this.fetchFn(url.toString(), init as unknown as RequestInit);
      const body = await readBody(res);
      if (!res.ok) throw mapGraphError({ status: res.status, headers: res.headers, body }, `upload (container ${containerId})`, token);
      const ok = (body as { success?: unknown } | null)?.success;
      if (ok === false) throw new PublisherError('transient', `upload (container ${containerId}): server reported failure`);
    } catch (e) {
      if (e instanceof PublisherError) throw e;
      throw new PublisherError('transient', `upload (container ${containerId}): ${redact(describe(e), token)}`);
    } finally {
      stream.destroy();
    }
  }

  private nextPath(next: string): string {
    return this.validatedNext(next).pathname;
  }

  private nextQuery(next: string): URLSearchParams {
    const q = new URLSearchParams(this.validatedNext(next).search);
    q.delete('access_token'); // paging URLs may embed the token; auth goes in the header
    return q;
  }

  private validatedNext(next: string): URL {
    let u: URL;
    try {
      u = new URL(next);
    } catch {
      throw new PublisherError('transient', 'list media: paging.next is not a URL');
    }
    if (u.protocol !== 'https:' || u.hostname !== G.host) {
      throw new PublisherError('transient', 'list media: paging.next points at an unexpected host');
    }
    return u;
  }

  /** One Graph call. Token goes in the Authorization header, never the URL. */
  private async call(
    method: 'GET' | 'POST',
    path: string,
    op: string,
    o: {
      query?: Record<string, string>;
      rawQuery?: URLSearchParams;
      form?: URLSearchParams;
      ambiguousOnTimeout?: boolean;
    } = {},
  ): Promise<GraphResponse> {
    const token = await this.tokens.getAccessToken();
    const url = new URL(`https://${G.host}`);
    // paging.next paths already carry the version; otherwise add it.
    url.pathname = /^\/v\d+\.\d+\//.test(path) ? path : `/${this.apiVersion}${path}`;
    const q = o.rawQuery ?? new URLSearchParams(o.query ?? {});
    url.search = q.toString();
    const headers: Record<string, string> = { Authorization: G.auth.graphHeader(token), Accept: 'application/json' };
    if (o.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), {
        method,
        headers,
        body: o.form ? o.form.toString() : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (e) {
      const msg = `${op}: ${isTimeoutLike(e) ? 'request timed out' : 'network error'} (${redact(describe(e), token)})`;
      if (o.ambiguousOnTimeout) {
        throw new PublisherError('timeout_ambiguous', `${msg}; the request may have taken effect, reconcile before retrying`);
      }
      throw new PublisherError('transient', msg);
    }
    const body = await readBody(res).catch(() => null);
    const out: GraphResponse = { status: res.status, headers: res.headers, body };
    if (!res.ok) {
      const err = mapGraphError(out, op, token);
      // A 5xx on publish may have been applied remotely: treat as ambiguous, not retryable.
      if (o.ambiguousOnTimeout && err.code === 'transient') {
        throw new PublisherError('timeout_ambiguous', `${err.message}; reconcile before retrying`);
      }
      throw err;
    }
    return out;
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function toSummary(x: unknown): RemoteMediaSummary | null {
  const o = x as { id?: unknown; permalink?: unknown; caption?: unknown; timestamp?: unknown; media_type?: unknown } | null;
  if (!o || typeof o.id !== 'string' || typeof o.permalink !== 'string' || typeof o.timestamp !== 'string') return null;
  return {
    remoteMediaId: o.id,
    permalink: o.permalink,
    caption: typeof o.caption === 'string' ? o.caption : null,
    timestamp: o.timestamp,
    mediaType: typeof o.media_type === 'string' ? o.media_type : 'UNKNOWN',
  };
}

function isPublicHttps(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h.endsWith('.invalid') || h.startsWith('mock') || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h === '[::1]' || h.startsWith('[')) return false;
  return true;
}
