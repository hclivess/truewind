// Bakes OpenStreetMap coastline/water geometry for the built-in venues into data/venues/*.json
// Usage: node tools/fetch-venues.mjs [venueId...]
import { VENUES, overpassQuery, processOSM } from '../js/world.js';
import { writeFileSync } from 'node:fs';
const want = process.argv.slice(2);
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
