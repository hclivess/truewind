// Checks a venue's bathymetry, as the game lays it out (the baked grid on the OSM shoreline, js/world.js setBathy),
// against the official chart: every NOAA ENC sounding in the area for US venues (ENC Direct, depths below MLLW),
// else the published spot depths in test/bathy.mjs. Prints the error statistics by distance from shore, and the
// soundings the game has much too shallow (where a keel would ground on water the chart says is sailable).
// Usage: node tools/verify-bathy.mjs <venueId> [enc service: harbour|approach|coastal]
import { VENUES, World, makeProjection, MAP_RADIUS } from '../js/world.js';
import { decodeBathy } from '../js/bathy.js';
import { Tide } from '../js/tide.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function loadVenue(id) {
  const v = VENUES.find(x => x.id === id), geo = JSON.parse(readFileSync(`data/venues/${id}.json`, 'utf8'));
  const w = new World(v, geo);
  const tf = `data/venues/${id}.tide.json`, bf = `data/venues/${id}.bathy.bin`;
  const tide = existsSync(tf) ? new Tide(JSON.parse(readFileSync(tf, 'utf8'))) : null;
  w.setBathy(existsSync(bf) ? decodeBathy(readFileSync(bf)) : null, tide);
  return { v, w, P: makeProjection(v.lat, v.lon), R: v.R ?? MAP_RADIUS };
}

// NOAA ENC soundings (m below MLLW) in the venue's box: [{ lat, lon, z }]
async function encSoundings(v, R, svc) {
  const layer = { harbour: 76, approach: 80, coastal: 61 }[svc], P = makeProjection(v.lat, v.lon);
  const [la0, lo0] = P.inv(-R, R), [la1, lo1] = P.inv(R, -R);
  const f = join(tmpdir(), 'truewind-bathy', `enc_${v.id}_${svc}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const out = [];
  for (let off = 0; ; off += 1000) {                    // (the service's page is 1000)
    const url = `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_${svc}/MapServer/${layer}/query?geometry=${lo0},${la0},${lo1},${la1}` +
      `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=Z&returnGeometry=true&orderByFields=OBJECTID&resultOffset=${off}&resultRecordCount=1000&f=json`;
    const j = await (await fetch(url)).json();
    for (const q of j.features || []) out.push({ lat: q.geometry.y, lon: q.geometry.x, z: q.attributes.Z });
    if (!j.exceededTransferLimit) break;
  }
  mkdirSync(join(tmpdir(), 'truewind-bathy'), { recursive: true }); writeFileSync(f, JSON.stringify(out));
  return out;
}

// statistics of the game's charted depth against reference soundings [{ lat, lon, z }] (m below chart datum)
export function compare({ w, P }, pts) {
  const bands = [[0, 100], [100, 300], [300, 1000], [1000, 1e9]].map(([a, b]) => ({ a, b, n: 0, ok: 0, e: [], shallow: 0, deep: 0 }));
  const bad = [];
  for (const p of pts) {
    const [x, z] = P.fwd(p.lat, p.lon), s = w.sdfAt(x, z);
    if (s < 25 || Math.abs(x) > w.R - 100 || Math.abs(z) > w.R - 100) continue;       // (piers, quays and the shoreline's own error)
    const d = w.chartDepthAt(x, z), B = bands.find(q => s >= q.a && s < q.b);
    const tol = Math.max(1, 0.3 * Math.abs(p.z));
    B.n++; B.e.push(d - p.z); if (Math.abs(d - p.z) <= tol) B.ok++;
    if (p.z > 2 && d < p.z - tol) { B.shallow++; bad.push({ ...p, d, s }); }
    if (d > p.z + tol) B.deep++;
  }
  return { bands, bad };
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
export function report(id, { bands, bad }) {
  for (const B of bands) if (B.n) console.log(`${id} ${String(B.a).padStart(5)}-${B.b > 1e8 ? '   ' : String(B.b).padEnd(4)} m from shore: ${String(B.n).padStart(5)} soundings, ${(100 * B.ok / B.n).toFixed(0).padStart(3)}% within 30% or 1 m, median error ${med(B.e).toFixed(2).padStart(6)} m, ${B.shallow} much too shallow, ${B.deep} too deep`);
  bad.sort((a, b) => (a.d - a.z) - (b.d - b.z));
  for (const q of bad.slice(0, 6)) console.log(`   too shallow: ${q.lat.toFixed(5)}, ${q.lon.toFixed(5)} chart ${q.z.toFixed(1)} m, game ${q.d.toFixed(1)} m (${q.s.toFixed(0)} m from shore)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2], svc = process.argv[3] || 'harbour';
  const V = loadVenue(id);
  const pts = await encSoundings(V.v, V.R, svc);
  console.log(`${id}: ${pts.length} NOAA ENC ${svc} soundings; bathymetry: ${V.w.bathySource}`);
  report(id, compare(V, pts));
}
