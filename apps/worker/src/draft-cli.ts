/**
 *   pnpm draft --topic <topicId> --code LU-TECH-002 [--format everyday_mystery|update|decision_test]
 *       Dry run: prints the worst-case cost of the two Claude calls. Calls nothing.
 *   ... --confirm-spend   Runs it with ANTHROPIC_API_KEY against DATABASE_URL, inside the spending cap.
 */
import { estimateMaxCostMicroUsd, AnthropicReasoningClient, draftScriptTask, verifyScriptTask } from '@life/reasoning';
import { loadEvidencePacket, openPostgresDb, spendStatus } from '@life/db';
import type { EpisodeFormat } from '@life/contracts';
import { draftAndVerifyEpisode } from './draft';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const topicId = arg('topic');
const code = arg('code');
const format = (arg('format') ?? 'everyday_mystery') as EpisodeFormat;
if (!topicId || !code) throw new Error('usage: pnpm draft --topic <topicId> --code <LU-XXX-NNN> [--format ...] [--confirm-spend]');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const usd = (m: number) => `$${(m / 1e6).toFixed(2)}`;

const { db, close } = await openPostgresDb(url);
try {
  const packet = await loadEvidencePacket(db, topicId);
  const d = draftScriptTask({ packet, format, episodeCode: code });
  const v = verifyScriptTask({ packet, beats: [], caption: '' });
  const worst = estimateMaxCostMicroUsd(d.tier, d.system.length + d.user.length, d.maxTokens) + estimateMaxCostMicroUsd(v.tier, v.system.length + v.user.length * 2, v.maxTokens);
  const s = await spendStatus(db, new Date());
  console.log(`Topic: ${packet.topic.title}${packet.topic.isFixture ? ' [FIXTURE]' : ''}`);
  console.log(`Two Claude Opus 5.5 calls (draft + independent check). Worst case ${usd(worst)}; usually far less.`);
  console.log(`This month: ${usd(s.monthToDateMicroUsd)} of ${s.capMicroUsd === null ? 'no cap (paid calls disabled)' : usd(s.capMicroUsd)}.`);
  if (!process.argv.includes('--confirm-spend')) {
    console.log('Dry run only. Add --confirm-spend to run.');
  } else {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env.local');
    const r = await draftAndVerifyEpisode({ db, reasoning: new AnthropicReasoningClient(), now: () => new Date(), log: console.log }, { topicId, format, code });
    console.log(`${code}: ${r.state} (actual cost ${usd(r.costMicroUsd)})`);
    for (const b of r.blockers) console.log(`  - ${b}`);
  }
} finally {
  await close();
}
