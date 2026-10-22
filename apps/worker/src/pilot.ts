import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claimLedgerSha256, evaluateCreativeRules, evaluateEvidenceGate } from '@life/content';
import { Claim, ClaimEvidence, EpisodeFormat, ReviewRecord, ScriptBeat, Source, Topic, type Actor } from '@life/contracts';
import { createEpisode, createEpisodeVersion, eq, getEpisode, loadEvidencePacket, saveEpisodeLink, saveEvidencePacket, tables as t, transitionEpisode, type Db } from '@life/db';
import { z } from 'zod';

const PacketFile = z.object({
  topic: Topic,
  sources: z.array(Source),
  claims: z.array(Claim),
  evidence: z.array(ClaimEvidence),
  reviews: z.array(ReviewRecord),
});
const ScriptFile = z.object({
  beats: z.array(ScriptBeat).min(1),
  caption: z.string().min(1),
  sourceList: z.array(z.string()),
  claimIds: z.array(z.string()),
  format: EpisodeFormat,
  code: z.string(),
  link: z.object({
    parentQuestion: z.string().nullable(),
    resolvedQuestion: z.string(),
    nextQuestion: z.string().nullable(),
    relatedEpisodeId: z.string().nullable(),
    relationshipReason: z.string().nullable(),
    endingReferencesRelated: z.boolean(),
  }),
});

/**
 * Loads a reviewed pilot directory (packet.json, script.json, optional
 * reviews.json) into the database and runs the gates. Re-running after new
 * reviews or edits adds a new version; it never skips a gate or approves.
 */
export async function loadPilot(db: Db, dir: string, now = new Date()): Promise<{ episodeId: string; state: string; blockers: string[] }> {
  const packet = PacketFile.parse(JSON.parse(await readFile(join(dir, 'packet.json'), 'utf8')));
  const script = ScriptFile.parse(JSON.parse(await readFile(join(dir, 'script.json'), 'utf8')));
  const reviews = await readFile(join(dir, 'reviews.json'), 'utf8')
    .then((s) => z.array(ReviewRecord).parse(JSON.parse(s)))
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
  const actor: Actor = { kind: 'system', component: 'pilot-loader' };
  await saveEvidencePacket(db, { ...packet, reviews: [...packet.reviews, ...reviews] });

  const [existing] = await db.select().from(t.episodes).where(eq(t.episodes.code, script.code));
  const episodeId = existing?.id ?? (await createEpisode(db, { code: script.code, topicId: packet.topic.id, format: script.format, actor, now }));
  if (!existing) {
    await transitionEpisode(db, { episodeId, to: 'researching', actor, now });
    await transitionEpisode(db, { episodeId, to: 'evidence_ready', actor, now });
  }
  const ep = await getEpisode(db, episodeId);
  if (!['evidence_ready', 'scripted', 'blocked'].includes(ep.state)) {
    return { episodeId, state: ep.state, blockers: [`episode is ${ep.state}; not reloading`] };
  }
  if (ep.state === 'blocked') await transitionEpisode(db, { episodeId, to: 'scripted', actor, now });

  const version = await createEpisodeVersion(db, {
    episodeId,
    content: { beats: script.beats, caption: script.caption, sourceList: script.sourceList, claimIds: script.claimIds, claimLedgerSha256: claimLedgerSha256(packet.claims, packet.evidence) },
    actor,
    now,
  });
  await saveEpisodeLink(db, { ...script.link, episodeId });
  if ((await getEpisode(db, episodeId)).state === 'evidence_ready') await transitionEpisode(db, { episodeId, to: 'scripted', actor, now });

  const fresh = await loadEvidencePacket(db, packet.topic.id);
  const evidence = evaluateEvidenceGate({ packet: fresh, version, now });
  const creative = evaluateCreativeRules({ version, link: { ...script.link, episodeId }, relatedEpisodeLive: false, reviews: fresh.reviews });
  const blockers = [...evidence.blockers, ...creative.blockers];
  if (blockers.length === 0) {
    await transitionEpisode(db, { episodeId, to: 'verified', actor, now });
    return { episodeId, state: 'verified', blockers };
  }
  await transitionEpisode(db, { episodeId, to: 'blocked', reason: blockers.slice(0, 5).join('; '), actor, now });
  return { episodeId, state: 'blocked', blockers };
}
