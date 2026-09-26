// Bakes OpenStreetMap coastline/water geometry for the built-in venues into data/venues/*.json
// Usage: node tools/fetch-venues.mjs [venueId...]
//        node tools/fetch-venues.mjs --land [venueId...]   (buildings, roads, land use -> data/venues/<id>.land.json)
//        node tools/fetch-venues.mjs --seamarks [venueId...]   (lighthouses, lights, buoys, beacons -> data/venues/<id>.seamarks.json)
//        node tools/fetch-venues.mjs --traffic [venueId...]   (marinas, pontoons, moorings, anchorages, ferry routes -> data/venues/<id>.traffic.json)
import { VENUES, overpassQuery, processOSM, landQueries, processLand, World, MAP_RADIUS } from '../js/world.js';
import { seamarksQuery, processSeamarks } from '../js/seamarks.js';
import { trafficQuery, processTraffic } from '../js/traffic.js';
import { writeFileSync, readFileSync } from 'node:fs';
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
if (LAND) {
  for (const v of VENUES) {
    if (v.open || (want.length && !want.includes(v.id))) continue;
    const geo = JSON.parse(readFileSync(`data/venues/${v.id}.json`, 'utf8'));
    const world = new World(v, geo);
    const Q = landQueries(v.lat, v.lon, world.R);
    const osm = {};
    for (const k of ['buildings', 'roads', 'areas']) { osm[k] = await overpass(Q[k]); console.log(v.id, k, osm[k].elements.length, 'elements'); await sleep(4000); }
    let tolB = 1.5, maxB = 25000, out, s;
    for (let pass = 0; pass < 4; pass++) {
      out = processLand(osm, v.lat, v.lon, world, { tolB, maxBuildings: maxB });
      s = JSON.stringify({ id: v.id, lat: v.lat, lon: v.lon, source: 'OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString().slice(0, 10), unit: 0.5, B: out.B, R: out.R, A: out.A });
      if (s.length < 1.5e6) break;
      maxB = Math.round(maxB * 0.75); tolB += 0.5;                // too big: fewer, simpler footprints
    }
    writeFileSync(`data/venues/${v.id}.land.json`, s);
    console.log(v.id, JSON.stringify(out.counts), (s.length / 1024).toFixed(0) + ' KB');
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
