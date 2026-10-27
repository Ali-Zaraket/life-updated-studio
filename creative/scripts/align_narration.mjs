// Times each script sentence in a recorded narration: finds the pauses, then picks the set of pauses that makes every
// sentence's speaking pace (syllables per second of speech) as even as possible.
// usage: node align_narration.mjs <script.json> <narration.wav> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [scriptPath, wavPath, outPath] = process.argv.slice(2);
const b = readFileSync(wavPath);
let o = 12, data, sr = 48000;
while (o < b.length) {
  const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
  if (id === 'fmt ') sr = b.readUInt32LE(o + 12);
  if (id === 'data') { data = b.subarray(o + 8, o + 8 + sz); break; }
  o += 8 + sz;
}
const win = Math.round(sr * 0.02), rms = [];
for (let i = 0; i + win <= data.length / 2; i += win) {
  let s = 0;
  for (let k = 0; k < win; k++) { const v = data.readInt16LE((i + k) * 2) / 32768; s += v * v; }
  rms.push(Math.sqrt(s / win));
}
const thr = 0.012;
const first = rms.findIndex((r) => r > thr) * 0.02, last = (rms.length - 1 - [...rms].reverse().findIndex((r) => r > thr)) * 0.02;
const sil = []; let st = -1;
rms.forEach((r, i) => { if (r < thr) { if (st < 0) st = i; } else { if (st >= 0 && (i - st) * 0.02 >= 0.18) sil.push([st * 0.02, i * 0.02]); st = -1; } });

const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const sents = script.beats.flatMap((bt, bi) => bt.narration.match(/[^.!?]+[.!?]+/g).map((s) => ({ beat: bi, text: s.trim() })));
const syl = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean)
  .reduce((a, w) => a + Math.max(1, (w.match(/[aeiouy]+/g) || []).length - (w.endsWith('e') && w.length > 3 ? 1 : 0)), 0);
const speech = (a, z) => { let d = z - a; for (const [x, y] of sil) if (x >= a && y <= z) d -= y - x; return d; };
const rate = sents.reduce((a, s) => a + syl(s.text), 0) / speech(first, last);
const cost = (a, z, s) => { const d = speech(a, z), e = syl(s.text) / rate; return ((d - e) / e) ** 2; };
const S = sents.length, K = sil.length, INF = 1e9;
const dp = Array.from({ length: S }, () => Array(K).fill(INF)), bk = Array.from({ length: S }, () => Array(K).fill(-1));
for (let j = 0; j < K; j++) dp[0][j] = cost(first, sil[j][0], sents[0]);
for (let i = 1; i < S - 1; i++) for (let j = 0; j < K; j++) for (let p = 0; p < j; p++) {
  const c = dp[i - 1][p] + cost(sil[p][1], sil[j][0], sents[i]);
  if (c < dp[i][j]) { dp[i][j] = c; bk[i][j] = p; }
}
let bestJ = -1, best = INF;
for (let p = 0; p < K; p++) { const c = dp[S - 2][p] + cost(sil[p][1], last, sents[S - 1]); if (c < best) { best = c; bestJ = p; } }
const ends = Array(S); let j = bestJ;
for (let i = S - 2; i >= 0; i--) { ends[i] = j; j = bk[i][j]; }
const out = sents.map((s, i) => ({ ...s, start: i === 0 ? first : sil[ends[i - 1]][1], end: i === S - 1 ? last : sil[ends[i]][0] }));
out.forEach((s, i) => console.log(String(i + 1).padStart(2), `b${s.beat}`, s.start.toFixed(2), '-', s.end.toFixed(2), `${(syl(s.text) / speech(s.start, s.end)).toFixed(1)} syl/s`, '|', s.text.slice(0, 60)));
writeFileSync(outPath, JSON.stringify(out, null, 1));
