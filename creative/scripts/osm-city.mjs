// Fetches building footprints and streets for a small box around a point from the public Overpass API, once.
// Map data © OpenStreetMap contributors (ODbL); credit is required wherever the map is shown.
// usage: node osm-city.mjs <out.json> <lat> <lon> [halfSizeMetres=650]
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const [out, lat, lon] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const half = Number(process.argv[5] ?? 650);
try { await access(out); console.log(`${out} exists; not fetching again`); process.exit(0); } catch {}
const dLat = half / 111_320, dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(6)).join(',');
const query = `[out:json][timeout:90];(way["building"](${bbox});way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|trunk|service)$"](${bbox}););out geom tags;`;
const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'life-updated-studio/0.1 (single owner, local render; one query)' },
  body: `data=${encodeURIComponent(query)}`,
  signal: AbortSignal.timeout(180_000),
});
if (!res.ok) throw new Error(`overpass: HTTP ${res.status}`);
const data = await res.json();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ center: [lat, lon], half, fetchedAt: new Date().toISOString(), elements: data.elements }));
const b = data.elements.filter((e) => e.tags?.building).length;
console.log(`saved ${data.elements.length} ways (${b} buildings) to ${out}`);
