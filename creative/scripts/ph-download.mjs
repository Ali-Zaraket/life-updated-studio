// Downloads chosen Poly Haven (CC0) assets at 2k into <out>/<id>/, verifying each file's md5.
// usage: node ph-download.mjs <outDir>
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const out = process.argv[2];
const UA = { 'user-agent': 'life-updated-studio/0.1 (owner local studio)' };
const MODELS = ['ClassicNightstand_01', 'alarm_clock_01', 'decorative_book_set_01', 'GothicBed_01'];
const TEXTURES = ['rough_linen', 'stretch_poplin', 'brown_planks_03', 'beige_wall_001'];
const HDRIS = ['satara_night', 'moonless_golf'];

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((s) => setTimeout(s, 5000 * i));
    }
  }
}
async function save(dir, rel, f) {
  const path = join(dir, rel);
  try { if (createHash('md5').update(await readFile(path)).digest('hex') === f.md5) return 0; } catch {}
  const buf = await get(f.url);
  if (createHash('md5').update(buf).digest('hex') !== f.md5) throw new Error(`md5 mismatch for ${f.url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  return buf.length;
}
let total = 0;
for (const id of [...MODELS, ...TEXTURES, ...HDRIS]) {
  try {
    const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString('utf8'));
    const dir = join(out, id);
    if (files.gltf) {
      const g = files.gltf['2k'].gltf;
      total += await save(dir, `${id}_2k.gltf`, g);
      for (const [rel, f] of Object.entries(g.include)) total += await save(dir, rel, f);
    } else if (files.hdri) {
      total += await save(dir, `${id}_1k.hdr`, files.hdri['1k'].hdr);
    } else {
      for (const map of ['Diffuse', 'nor_gl', 'Rough', 'Displacement']) {
        const f = files[map]?.['2k']?.jpg ?? files[map]?.['2k']?.png;
        if (f) total += await save(dir, `${id}_${map}_2k.${f.url.split('.').pop()}`, f);
      }
    }
    console.log(`ok ${id}`);
  } catch (e) {
    console.log(`FAILED ${id}: ${e.message}`);
  }
}
console.log(`downloaded ${(total / 1e6).toFixed(1)} MB`);
