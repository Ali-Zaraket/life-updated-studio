/**
 * pnpm pilot:recheck <dir>
 * Re-fetches every source, confirms each quoted passage is still on the page,
 * and refreshes lastCheckedAt (which does not void reviews). A missing passage
 * marks its claim `unresolved` — a real ledger change that blocks the episode
 * and needs a fresh review.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { checkPassages, fetchPageText, normalize } from './source-check';

const dir = resolve(process.argv[2] ?? '.');
const file = join(dir, 'packet.json');
const packet = JSON.parse(await readFile(file, 'utf8'));
const now = new Date().toISOString();
const missing = new Map<string, string[]>();
const checkedClaims = new Set<string>();

for (const source of packet.sources) {
  const evidence = packet.evidence.filter((e: { sourceId: string }) => e.sourceId === source.id);
  try {
    const page = await fetchPageText(source.url);
    source.retrievedAt = now;
    source.available = true;
    // Hash the normalised text, not the raw HTML: the same page's bytes differ between requests.
    const textSha = createHash('sha256').update(normalize(page.text)).digest('hex');
    if (source.contentSha256 && textSha !== source.contentSha256) console.log(`  ${source.id}: page text changed since last check (passages checked below)`);
    source.contentSha256 = textSha;
    for (const r of checkPassages(page.text, evidence)) {
      if (r.found) checkedClaims.add(r.claimId);
      else missing.set(r.claimId, [...(missing.get(r.claimId) ?? []), r.evidenceId]);
    }
    console.log(`  ${source.id}: ${evidence.length} passage(s) checked (${page.text.length} chars from ${new URL(page.finalUrl).pathname})`);
  } catch (e) {
    source.available = false;
    console.log(`  ${source.id}: UNAVAILABLE (${e instanceof Error ? e.message : String(e)})`);
    for (const ev of evidence) missing.set(ev.claimId, [...(missing.get(ev.claimId) ?? []), ev.id]);
  }
}

for (const claim of packet.claims) {
  if (missing.has(claim.id)) {
    claim.status = 'unresolved';
    claim.statusReason = `recheck ${now}: passage(s) ${missing.get(claim.id)!.join(', ')} no longer found or source unavailable`;
    console.log(`  BLOCKED ${claim.id}: ${claim.statusReason}`);
  } else if (checkedClaims.has(claim.id)) {
    claim.lastCheckedAt = now;
  }
}
if (packet.provenance) {
  packet.provenance.lastRecheckAt = now;
  packet.provenance.pageSha256 = Object.fromEntries(packet.sources.map((s: { id: string; contentSha256: string }) => [s.id, s.contentSha256]));
  packet.provenance.pageSha256Note = 'sha256 of the normalised extracted page text (stable across requests), set by pilot:recheck.';
}
await writeFile(file, `${JSON.stringify(packet, null, 2)}\n`);
console.log(missing.size ? `${missing.size} claim(s) need attention; the episode stays blocked until fixed and re-reviewed.` : `All passages still present. Claims fresh until 24 h after ${now}.`);
process.exitCode = missing.size ? 1 : 0;
