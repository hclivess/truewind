// Bakes OpenStreetMap coastline/water geometry for the built-in venues into data/venues/*.json
// Usage: node tools/fetch-venues.mjs [venueId...]
//        node tools/fetch-venues.mjs --land [venueId...]   (buildings, roads, land use, places over the venue's whole area
//                                                           -> data/venues/<id>.land.json, .land.bin, .land/<i>_<j>.bin)
//        node tools/fetch-venues.mjs --seamarks [venueId...]   (lighthouses, lights, buoys, beacons -> data/venues/<id>.seamarks.json)
//        node tools/fetch-venues.mjs --traffic [venueId...]   (marinas, pontoons, moorings, anchorages, ferry routes -> data/venues/<id>.traffic.json)
import { VENUES, overpassQuery, processOSM, landQueries, landBoxQuery, processLand, townDensity, splitByChunk, chunkOf, encodeLandBin, LAND_CHUNK, World, MAP_RADIUS } from '../js/world.js';
import { seamarksQuery, processSeamarks } from '../js/seamarks.js';
import { trafficQuery, processTraffic } from '../js/traffic.js';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const LAND = process.argv.includes('--land'), MARKS = process.argv.includes('--seamarks'), TRAFFIC = process.argv.includes('--traffic');
const want = process.argv.slice(2).filter(a => !a.startsWith('--'));
const UA = 'truewind-sailing-sim/1.0 (https://github.com/hclivess/truewind)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function overpass(q) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark.slice(0, 120));
      return j;
    } catch (e) { const w = 10000 * (attempt + 1); console.log('  overpass retry', url.split('/')[2], e.message, `waiting ${w / 1000}s`); await sleep(w); }
  }
  throw new Error('overpass failed');
}
// marinas, pontoons, moorings, anchorages and ferry routes for the harbour traffic (js/traffic.js)
if (TRAFFIC) {
  for (const v of VENUES) {
    if (v.open || (want.length && !want.includes(v.id))) continue;
    const R = (v.R ?? 6000) + 600, out = processTraffic(await overpass(trafficQuery(v.lat, v.lon, R)), v.lat, v.lon, R);
    const s = JSON.stringify({ id: v.id, lat: v.lat, lon: v.lon, source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), ...out });
    writeFileSync(`data/venues/${v.id}.traffic.json`, s);
    console.log(v.id, Object.entries(out).map(([k, a]) => `${k} ${a.length}`).join(', '), (s.length / 1024).toFixed(0) + ' KB');
    await sleep(5000);
  }
  process.exit(0);
}
if (MARKS) {
  for (const v of VENUES) {
    if (v.open || (want.length && !want.includes(v.id))) continue;
    const R = (v.R ?? MAP_RADIUS) + 600;
    const osm = await overpass(seamarksQuery(v.lat, v.lon, R));
    const { region, marks } = processSeamarks(osm, v.lat, v.lon, R);
    const s = JSON.stringify({ id: v.id, source: 'OpenStreetMap / OpenSeaMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), region, marks });
    writeFileSync(`data/venues/${v.id}.seamarks.json`, s);
    const by = {}; for (const m of marks) by[m.t] = (by[m.t] || 0) + 1;
    console.log(v.id, osm.elements.length, 'elements ->', marks.length, 'marks,', marks.filter(m => m.L).length, 'lit,', (s.length / 1024).toFixed(0) + ' KB', JSON.stringify(by));
    await sleep(4000);
  }
  process.exit(0);
}
// land: the venue's whole square. Land cover and places in one go; buildings and streets per 8 km box (skipping
// boxes of open water), merged by way id, then split into 4 km chunk files (js/scenery.js streams them)
if (LAND) {
  const CACHE = join(tmpdir(), 'truewind-overpass');
  mkdirSync(CACHE, { recursive: true });
  const cached = async (q) => {
    const f = join(CACHE, createHash('sha1').update(q).digest('hex') + '.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    const j = await overpass(q); writeFileSync(f, JSON.stringify(j)); await sleep(4000); return j;
  };
  for (const v of VENUES) {
    if (v.open || (want.length && !want.includes(v.id))) continue;
    const geo = JSON.parse(readFileSync(`data/venues/${v.id}.json`, 'utf8'));
    const world = new World(v, geo), R = world.R, C = LAND_CHUNK;
    const Q = landQueries(v.lat, v.lon, R);
    const osm = { areas: await cached(Q.areas), places: await cached(Q.places), buildings: { elements: [] } };
    console.log(v.id, 'areas', osm.areas.elements.length, 'places', osm.places.elements.length);
    const QB = R > 8000 ? 8000 : R, nq = Math.ceil(2 * R / QB);
    for (let j = 0; j < nq; j++) for (let i = 0; i < nq; i++) {
      const box = [-R + i * QB, -R + j * QB, Math.min(R, -R + (i + 1) * QB), Math.min(R, -R + (j + 1) * QB)];
      let land = false;
      for (let b = 0; b <= 16 && !land; b++) for (let a = 0; a <= 16; a++) if (world.sdfAt(box[0] + (box[2] - box[0]) * a / 16, box[1] + (box[3] - box[1]) * b / 16) < 300) { land = true; break; }
      if (!land) continue;
      const r = await cached(landBoxQuery(v.lat, v.lon, ...box));
      for (const el of r.elements) osm.buildings.elements.push(el);
      console.log(v.id, 'box', i, j, r.elements.length, 'ways');
    }
    // budget: simpler footprints and a narrower band inland until the venue fits
    let opts = { tolB: 1.2, maxShore: 2500, tolA: R > 10000 ? 12 : 8, minArea: R > 10000 ? 1500 : 400 }, out, files, total;
    for (let pass = 0; pass < 5; pass++) {
      out = processLand(osm, v.lat, v.lon, world, opts);
      const byChunk = new Map(), put = (k, b) => { let a = byChunk.get(k); if (!a) byChunk.set(k, a = []); a.push(b); };
      for (const b of out.buildings) {
        let cx = 0, cz = 0; for (let k = 0; k < b.pts.length; k += 2) { cx += b.pts[k]; cz += b.pts[k + 1]; }
        put(chunkOf(cx / (b.pts.length / 2), cz / (b.pts.length / 2), R).join(','), b);
      }
      const roadsBy = splitByChunk(out.roads, R);
      files = new Map(); total = 0;
      for (const k of new Set([...byChunk.keys(), ...roadsBy.keys()])) {
        // (sorted along rows of 32 m, so each footprint starts a short step from the last)
        const B = (byChunk.get(k) || []).sort((a, b) => Math.floor(a.pts[1] / 32) - Math.floor(b.pts[1] / 32) || a.pts[0] - b.pts[0]);
        const bin = encodeLandBin({ id: v.id, chunk: k }, { buildings: B, roads: roadsBy.get(k) || [] });
        files.set(k, { bin, nB: B.length, nR: (roadsBy.get(k) || []).length }); total += bin.length;
      }
      const base = encodeLandBin({ id: v.id }, { areas: out.areas, town: townDensity(out.roads, R) });
      files.set('base', { bin: base }); total += base.length;
      console.log(v.id, 'pass', pass, JSON.stringify(out.counts), (total / 1024).toFixed(0) + ' KB');
      if (total < 4.8e6) break;
      opts = { ...opts, tolB: opts.tolB + 0.4, maxShore: Math.round(opts.maxShore * 0.85) };
    }
    const dir = `data/venues/${v.id}.land`;
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const chunks = {};
    for (const [k, f] of files) {
      if (k === 'base') { writeFileSync(`data/venues/${v.id}.land.bin`, f.bin); continue; }
      writeFileSync(`${dir}/${k.replace(',', '_')}.bin`, f.bin);
      chunks[k] = [f.bin.length, f.nB, f.nR];
    }
    const man = { id: v.id, lat: v.lat, lon: v.lon, v: 2, R, chunk: C, source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10),
      counts: out.counts, band: opts.maxShore, bytes: total, chunks, places: out.places.map(p => [p.t, p.x, p.z, p.name, p.pop]) };
    writeFileSync(`data/venues/${v.id}.land.json`, JSON.stringify(man));
    console.log(v.id, JSON.stringify(out.counts), Object.keys(chunks).length, 'chunks', (total / 1024).toFixed(0) + ' KB');
  }
  process.exit(0);
}
for (const v of VENUES) {
  if (v.open || (want.length && !want.includes(v.id))) continue;
  const q = overpassQuery(v.lat, v.lon, (v.R ?? 6000) + 600);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'SailSim venue baker (github pages sailing simulator)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const geo = processOSM(j, v.lat, v.lon, (v.R ?? 6000) + 600);
      const out = { id: v.id, lat: v.lat, lon: v.lon, source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), ...geo };
      const s = JSON.stringify(out);
      writeFileSync(`data/venues/${v.id}.json`, s);
      console.log(v.id, 'coast lines', geo.coast.length, 'water polys', geo.water.length, (s.length / 1024).toFixed(0) + ' KB');
      break;
    } catch (e) { console.log(v.id, 'retry', e.message); await new Promise(r => setTimeout(r, 8000)); }
  }
  await new Promise(r => setTimeout(r, 3000));
}
