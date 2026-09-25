// Render a venue's land/water/depth grid to a PGM image for checking
import { VENUES, World } from '../js/world.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// usage: node test/mapimg.mjs [venue] [out.pgm]   (venue defaults to progreso)
const id = process.argv[2] || 'progreso';
const v = VENUES.find(v => v.id === id);
if (!v || v.open) {
  console.error(`usage: node test/mapimg.mjs [venue] [out.pgm]\nvenues: ${VENUES.filter(v => !v.open).map(v => v.id).join(' ')}`);
  process.exit(1);
}
const geo = JSON.parse(readFileSync(`data/venues/${id}.json`));
const t0 = Date.now();
const w = new World(v, geo);
console.log(id, 'build ms', Date.now() - t0, 'piers', (geo.piers||[]).length);
const S = 400, img = Buffer.alloc(S * S);
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const x = -w.R + (i + .5) * 2 * w.R / S, z = -w.R + (j + .5) * 2 * w.R / S;
  const s = w.sdfAt(x, z);
  img[j * S + i] = s < 0 ? 230 : Math.max(20, 160 - w.depthAt(x, z) * 8);
}
for (const p of geo.piers || []) for (let k = 0; k < p.pts.length; k += 2) {
  const i = Math.floor((p.pts[k] + w.R) / (2 * w.R) * S), j = Math.floor((p.pts[k + 1] + w.R) / (2 * w.R) * S);
  if (i >= 0 && j >= 0 && i < S && j < S) img[j * S + i] = 0;
}
const out = process.argv[3] || `${tmpdir()}/${id}.pgm`;
writeFileSync(out, Buffer.concat([Buffer.from(`P5 ${S} ${S} 255\n`), img]));
console.log('wrote', out);
