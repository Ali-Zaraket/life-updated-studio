// Fetches a block of OpenStreetMap standard tiles (default 3x6 at zoom 16) around a point, politely and once.
// Map data © OpenStreetMap contributors (ODbL); credit is required wherever the map is shown.
// usage: node osm-tiles.mjs <outDir> <lat> <lon> [zoom=16] [cols=3] [rows=6]
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const [out, lat, lon] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const z = Number(process.argv[5] ?? 16), n = 2 ** z;
const [W, Hh] = [Number(process.argv[6] ?? 3), Number(process.argv[7] ?? 6)];
const cx = Math.floor(((lon + 180) / 360) * n);
const r = (lat * Math.PI) / 180;
const cy = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
await mkdir(out, { recursive: true });
for (let dy = -Math.floor(Hh / 2); dy < Hh - Math.floor(Hh / 2); dy++) {
  for (let dx = -Math.floor(W / 2); dx < W - Math.floor(W / 2); dx++) {
    const [x, y] = [cx + dx, cy + dy];
    const path = join(out, `${dy + Math.floor(Hh / 2)}_${dx + Math.floor(W / 2)}.png`);
    try { await access(path); continue; } catch {}
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: { 'user-agent': 'life-updated-studio/0.1 (single owner, local render; few tiles)' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    await new Promise((s) => setTimeout(s, 700)); // stay well under any rate limit
  }
}
console.log(`tiles z${z} ${W}x${Hh} around ${cx},${cy} saved`);
