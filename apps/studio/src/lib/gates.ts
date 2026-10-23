// The only file that touches @life/content gate functions, so integration changes stay local.
import { evaluateCreativeRules, evaluateEvidenceGate, type GateReport } from '@life/content';
import type { EpisodeLink, EpisodeVersionContent, ReviewRecord } from '@life/contracts';
import { getEpisode, getEpisodeLink, loadEvidencePacket, type Db } from '@life/db';

export type { GateReport };

export interface GateResults {
  evidence: GateReport;
  creative: GateReport;
  packet: Awaited<ReturnType<typeof loadEvidencePacket>>;
  link: EpisodeLink | null;
  relatedEpisodeLive: boolean;
}

const LIVE_STATES = new Set(['published', 'measuring']);

export async function evaluateGatesFor(db: Db, episodeId: string, version: EpisodeVersionContent, now = new Date()): Promise<GateResults> {
  const ep = await getEpisode(db, episodeId);
  const packet = await loadEvidencePacket(db, ep.topicId);
  const link = await getEpisodeLink(db, episodeId);
  let relatedEpisodeLive = false;
  if (link?.relatedEpisodeId) {
    const relatedId = link.relatedEpisodeId;
    const rel = await db.query.episodes.findFirst({ columns: { state: true }, where: (e, { eq }) => eq(e.id, relatedId) });
    relatedEpisodeLive = !!rel && LIVE_STATES.has(rel.state);
  }
  const reviews: ReviewRecord[] = packet.reviews;
  return {
    evidence: evaluateEvidenceGate({ packet, version, now }),
    creative: evaluateCreativeRules({ version, link, relatedEpisodeLive, reviews }),
    packet,
    link,
    relatedEpisodeLive,
  };
}
