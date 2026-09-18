// Verification step for a venue: renders OpenStreetMap's own map tiles for the area next to the
// simulator's interpretation (land / water / depth / labelled structures). Nothing ships until the
// two agree. Usage: node tools/verify-venue.mjs <venueId> [zoom]  -> writes verify/<id>.png
import { VENUES, World, makeProjection } from '../js/world.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const id = process.argv[2], zoom = +(process.argv[3] ?? 13);
const v = VENUES.find(x => x.id === id);
const geo = JSON.parse(readFileSync(`data/venues/${id}.json`));
const man = existsSync(`data/venues/${id}.features.json`) ? JSON.parse(readFileSync(`data/venues/${id}.features.json`)) : null;
const w = new World(v, geo);
const R = w.R, P = makeProjection(v.lat, v.lon);
const [latN, lonW] = P.inv(-R, -R), [latS, lonE] = P.inv(R, R);
const t2 = (lat, lon) => { const n = 2 ** zoom; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n]; };
const [x0, y0] = t2(latN, lonW), [x1, y1] = t2(latS, lonE);
mkdirSync('verify/tiles', { recursive: true });
const tiles = [];
for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
  const f = `verify/tiles/${zoom}-${tx}-${ty}.png`;
  if (!existsSync(f)) {
    const r = await fetch(`https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`, { headers: { 'User-Agent': 'TrueWind sailing sim venue verification (github.com/hclivess/truewind)' } });
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    await new Promise(r => setTimeout(r, 150));
  }
  tiles.push({ tx, ty, f });
}
// simulator interpretation as a PGM, same geographic box
const S = 600, img = Buffer.alloc(S * S * 3);
const labelled = new Set(); for (const f of man?.features || []) for (const o of f.osm) labelled.add(o);
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const x = -R + (i + 0.5) * 2 * R / S, z = -R + (j + 0.5) * 2 * R / S, s = w.sdfAt(x, z), k = (j * S + i) * 3;
  if (s < 0) { img[k] = 235; img[k + 1] = 228; img[k + 2] = 210; }
  else { const dp = Math.min(1, w.depthAt(x, z) / 12); img[k] = 150 - 110 * dp; img[k + 1] = 200 - 100 * dp; img[k + 2] = 225 - 60 * dp; }
}
const plot = (pts, col) => { for (let q = 0; q + 3 < pts.length; q += 2) { const n = 40; for (let u = 0; u <= n; u++) { const x = pts[q] + (pts[q + 2] - pts[q]) * u / n, z = pts[q + 1] + (pts[q + 3] - pts[q + 1]) * u / n; const i = Math.floor((x + R) / (2 * R) * S), j = Math.floor((z + R) / (2 * R) * S); if (i >= 0 && j >= 0 && i < S && j < S) { const k = (j * S + i) * 3; img[k] = col[0]; img[k + 1] = col[1]; img[k + 2] = col[2]; } } } };
for (const c of geo.coast) if (labelled.has(c.id)) plot(c.pts, [220, 40, 40]);
for (const p of geo.piers) plot(p.pts, labelled.has(p.id) ? [220, 40, 40] : p.kind === 'bridge' ? [120, 120, 120] : [40, 40, 40]);
writeFileSync(`verify/${id}-sim.ppm`, Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), img]));
writeFileSync(`verify/${id}-tiles.json`, JSON.stringify({ zoom, x0, y0, x1, y1, tiles }));
execFileSync('python3', ['-c', `
import json
from PIL import Image
m = json.load(open('verify/${id}-tiles.json'))
tx0, ty0 = int(m['x0']), int(m['y0'])
cols = int(m['x1']) - tx0 + 1; rows = int(m['y1']) - ty0 + 1
big = Image.new('RGB', (cols * 256, rows * 256))
for t in m['tiles']: big.paste(Image.open(t['f']).convert('RGB'), ((t['tx'] - tx0) * 256, (t['ty'] - ty0) * 256))
box = ((m['x0'] - tx0) * 256, (m['y0'] - ty0) * 256, (m['x1'] - tx0) * 256, (m['y1'] - ty0) * 256)
ref = big.crop(tuple(int(b) for b in box)).resize((600, 600))
sim = Image.open('verify/${id}-sim.ppm')
out = Image.new('RGB', (1210, 600), (255, 255, 255)); out.paste(ref, (0, 0)); out.paste(sim, (610, 0)); out.save('verify/${id}.png')
`]);
console.log(`verify/${id}.png  (left: OpenStreetMap rendering, right: simulator; red = features labelled in the manifest)`);
