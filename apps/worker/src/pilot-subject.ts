/** pnpm pilot:subject <dir> — the hash a reviewer must bind its review to (script + claim ledger). */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { claimLedgerSha256 } from '@life/content';
import { reviewSubjectSha256 } from '@life/contracts';

const dir = resolve(process.argv[2] ?? '.');
const packet = JSON.parse(await readFile(join(dir, 'packet.json'), 'utf8'));
const script = JSON.parse(await readFile(join(dir, 'script.json'), 'utf8'));
console.log(reviewSubjectSha256({ beats: script.beats, caption: script.caption, claimLedgerSha256: claimLedgerSha256(packet.claims, packet.evidence) }));
