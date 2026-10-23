import { eq, inArray, tables as t } from '@life/db';
import type { Db } from '@life/db';
import type { Snap, Source } from './insights';

export interface PublishedEpisode {
  mediaId: string;
  episodeId: string;
  code: string;
  title: string;
  pillar: string;
  format: string;
  publishedAt: string;
  permalink: string;
  mediaSource: Source;
  accountId: string;
}

const toSnap = (r: typeof t.metricSnapshots.$inferSelect): Snap => ({
  id: r.id, metric: r.metric, definition: r.definition, unit: r.unit, window: r.window, mediaAgeSec: r.mediaAgeSec,
  apiVersion: r.apiVersion, retrievedAt: String(r.retrievedAt), value: r.value, unavailabilityReason: r.unavailabilityReason,
  source: r.source as Source, rawResponseId: r.rawResponseId,
});

export async function loadPublished(db: Db): Promise<PublishedEpisode[]> {
  const rows = await db
    .select({ m: t.instagramMedia, e: t.episodes, tp: t.topics })
    .from(t.instagramMedia)
    .innerJoin(t.publishJobs, eq(t.publishJobs.id, t.instagramMedia.publishJobId))
    .innerJoin(t.episodes, eq(t.episodes.id, t.publishJobs.episodeId))
    .innerJoin(t.topics, eq(t.topics.id, t.episodes.topicId));
  return rows
    .map(({ m, e, tp }) => ({
      mediaId: m.id, episodeId: e.id, code: e.code, title: tp.title, pillar: tp.pillar, format: e.format,
      publishedAt: String(m.publishedAt), permalink: m.permalink, mediaSource: m.source as Source, accountId: m.accountId,
    }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export async function loadMediaSnapshots(db: Db, mediaIds: string[]): Promise<Map<string, Snap[]>> {
  const out = new Map<string, Snap[]>();
  if (!mediaIds.length) return out;
  const rows = await db.select().from(t.metricSnapshots).where(inArray(t.metricSnapshots.instagramMediaId, mediaIds));
  for (const r of rows) {
    if (r.scope !== 'media' || !r.instagramMediaId) continue;
    const a = out.get(r.instagramMediaId) ?? [];
    a.push(toSnap(r));
    out.set(r.instagramMediaId, a);
  }
  return out;
}

export async function loadAccountSnapshots(db: Db): Promise<(Snap & { accountId: string })[]> {
  const rows = await db.select().from(t.metricSnapshots).where(eq(t.metricSnapshots.scope, 'account'));
  return rows.map((r) => ({ ...toSnap(r), accountId: r.accountId }));
}

export async function loadRawResponses(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, { body: unknown; source: string; apiVersion: string; retrievedAt: string }>();
  const rows = await db.select().from(t.metricRawResponses).where(inArray(t.metricRawResponses.id, ids));
  return new Map(rows.map((r) => [r.id, { body: r.body, source: r.source, apiVersion: r.apiVersion, retrievedAt: String(r.retrievedAt) }]));
}
