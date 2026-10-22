import { claimLedgerSha256, evaluateCreativeRules, evaluateEvidenceGate } from '@life/content';
import type { Actor, EpisodeFormat } from '@life/contracts';
import {
  authorizeSpend,
  createEpisode,
  createEpisodeVersion,
  loadEvidencePacket,
  recordCost,
  saveEpisodeLink,
  saveEvidencePacket,
  transitionEpisode,
  type Db,
} from '@life/db';
import { draftScriptTask, runWithBudget, verificationToReviews, verifyScriptTask, type BudgetHooks, type ReasoningClient } from '@life/reasoning';

export interface DraftDeps {
  db: Db;
  reasoning: ReasoningClient;
  now: () => Date;
  log: (line: string) => void;
}

export interface DraftOutcome {
  episodeId: string;
  versionId: string;
  state: 'verified' | 'blocked';
  blockers: string[];
  costMicroUsd: number;
}

/**
 * topic with evidence → Claude draft (Opus) → new episode version → independent
 * Claude challenge (Opus, fresh request) → AI verification records → the
 * deterministic evidence and creative gates. Ends `verified` or `blocked` with
 * every reason; never further. Each paid call goes through the spending cap.
 */
export async function draftAndVerifyEpisode(deps: DraftDeps, i: { topicId: string; format: EpisodeFormat; code: string }): Promise<DraftOutcome> {
  const { db } = deps;
  const pipeline: Actor = { kind: 'system', component: 'draft-pipeline' };
  let episodeId = '';
  let spent = 0;
  const hooks: BudgetHooks = {
    authorize: (estimateMicroUsd, t) => authorizeSpend(db, { provider: 'anthropic', operation: `${t.name}:${t.model}`, estimatedMicroUsd: estimateMicroUsd, now: deps.now() }),
    record: async (r, t) => {
      spent += r.costMicroUsd;
      await recordCost(db, {
        provider: r.source === 'mock' ? 'mock-reasoning' : 'anthropic',
        operation: `${t.name}:${r.model}`,
        units: r.usage.inputTokens + r.usage.outputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens,
        unitType: 'tokens',
        amountMicroUsd: r.costMicroUsd,
        estimated: false,
        source: r.source,
        episodeId: episodeId || null,
        now: deps.now(),
      });
    },
    log: deps.log,
  };

  const packet = await loadEvidencePacket(db, i.topicId);
  const usable = packet.claims.filter((c) => c.status === 'supported' || c.status === 'supported_with_limits');
  if (usable.length === 0) throw new Error(`topic ${i.topicId} has no supported claims; research first`);

  episodeId = await createEpisode(db, { code: i.code, topicId: i.topicId, format: i.format, actor: pipeline, now: deps.now() });
  await transitionEpisode(db, { episodeId, to: 'researching', actor: pipeline, now: deps.now() });
  await transitionEpisode(db, { episodeId, to: 'evidence_ready', actor: pipeline, now: deps.now() });

  const draft = await runWithBudget(deps.reasoning, draftScriptTask({ packet, format: i.format, episodeCode: i.code }), hooks);
  deps.log(`[${draft.source.toUpperCase()}] drafted with ${draft.model}`);
  const claimIds = [...new Set(draft.output.beats.flatMap((b) => b.claimIds))];
  const writer: Actor = { kind: 'agent', agentName: 'drafter', model: draft.model };
  const version = await createEpisodeVersion(db, {
    episodeId,
    content: { beats: draft.output.beats, caption: draft.output.caption, sourceList: draft.output.sourceList, claimIds, claimLedgerSha256: claimLedgerSha256(packet.claims, packet.evidence) },
    actor: writer,
    now: deps.now(),
  });
  await saveEpisodeLink(db, { episodeId, parentQuestion: null, resolvedQuestion: packet.topic.question, nextQuestion: draft.output.nextQuestion, relatedEpisodeId: null, relationshipReason: null, endingReferencesRelated: false });
  await transitionEpisode(db, { episodeId, to: 'scripted', actor: pipeline, now: deps.now() });

  // Independent challenge: a separate request that never saw the drafting conversation.
  const verification = await runWithBudget(deps.reasoning, verifyScriptTask({ packet, beats: version.beats, caption: version.caption }), hooks);
  const reviews = verificationToReviews(verification.output, { model: verification.model, now: deps.now(), idPrefix: `rev-${version.id}` });
  await saveEvidencePacket(db, { topic: packet.topic, sources: [], claims: [], evidence: [], reviews });

  const fresh = await loadEvidencePacket(db, i.topicId);
  const evidence = evaluateEvidenceGate({ packet: fresh, version, now: deps.now() });
  const creative = evaluateCreativeRules({ version, link: null, relatedEpisodeLive: false, reviews: fresh.reviews });
  const blockers = [
    ...(verification.output.overall === 'fail' ? [`ai_verification: ${verification.output.summary}`] : []),
    ...verification.output.beatProblems.map((p) => `ai_verification beat ${p.beatIndex}: ${p.problem}`),
    ...evidence.blockers,
    ...creative.blockers,
  ];
  const verifier: Actor = { kind: 'agent', agentName: 'verifier', model: verification.model };
  if (blockers.length === 0) {
    await transitionEpisode(db, { episodeId, to: 'verified', actor: verifier, now: deps.now() });
    return { episodeId, versionId: version.id, state: 'verified', blockers, costMicroUsd: spent };
  }
  await transitionEpisode(db, { episodeId, to: 'blocked', reason: blockers.slice(0, 5).join('; '), actor: verifier, now: deps.now() });
  return { episodeId, versionId: version.id, state: 'blocked', blockers, costMicroUsd: spent };
}
