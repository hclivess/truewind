// Bakes each venue's bathymetry into data/venues/<id>.bathy.bin (see js/bathy.js): depth below mean sea level in
// decimetres on a regular grid over the venue ([-R, R]², 50 m cells, 100 m for the big Solent), from the best free
// source (tools/bathy-src.mjs). Lakes (Garda, Meredith) have no public grid: their depths stay estimated.
// Needs data/venues/<id>.tide.json (node tools/tide-gauges.mjs) for the survey datums.
// Usage: node tools/fetch-bathy.mjs [venueId...]
import { VENUES, MAP_RADIUS } from '../js/world.js';
import { encodeBathy } from '../js/bathy.js';
import { sample, SOURCES, z0Field } from './bathy-src.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const want = process.argv.slice(2);
for (const v of VENUES) {
  if (v.open || !SOURCES[v.id] || (want.length && !want.includes(v.id))) continue;
  const R = v.R ?? MAP_RADIUS, dx = R > 10000 ? 100 : 50, n = Math.round(2 * R / dx);
  const tf = `data/venues/${v.id}.tide.json`;
  const gauges = existsSync(tf) ? JSON.parse(readFileSync(tf, 'utf8')).gauges || [] : [];
  const ref = gauges.find(g => g.navd !== undefined);
  const g = { nx: n, nz: n, x0: -R, z0: -R, dx: 2 * R / n };
  const t0 = Date.now();
  const r = await sample(v, g, { z0At: z0Field(gauges), navd: ref ? ref.navd : 0, px: 25 });
  const d = r.data;
  let wet = 0, mx = 0; for (let k = 0; k < d.length; k++) if (d[k] > 0) { wet++; mx = Math.max(mx, d[k]); }
  const h = { ...g, source: r.source, datum: 'MSL', res: r.res, fetched: new Date().toISOString().slice(0, 10) };
  const buf = encodeBathy(h, d);
  writeFileSync(`data/venues/${v.id}.bathy.bin`, buf);
  console.log(v.id, `${n}x${n} @ ${g.dx.toFixed(0)} m, ${(100 * wet / d.length).toFixed(0)}% below MSL, deepest ${(mx / 10).toFixed(1)} m, ${(buf.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
