// Land data: the TWL2 codec (footprints, rectangles, streets, land cover, street density) round-trips, OSM ways
// become footprints/streets/places in local metres, streets split into chunk pieces that join up, and every baked
// venue's manifest, base and chunk files decode with footprints inside the venue's square.
// Run: node test/land.mjs
import { encodeLandBin, decodeLandBin, processLand, splitByChunk, townDensity, VENUES, World, LAND_CHUNK } from '../js/world.js';
import { readFileSync, existsSync } from 'node:fs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// codec
{
  const B = [
    { pts: [10, 20, 30, 20, 30, 32, 10, 32], h: 12.5, lv: 3, ty: 2, rf: 1 },                          // a rectangle
    { pts: [-100.25, 50, -90, 51, -91, 60, -97, 64, -101, 58], h: 0, lv: 0, ty: 1, rf: 2 },           // a pentagon
    { pts: [5, 5, 15, 5, 16.5, 12, 5, 12], h: 0, lv: 0, ty: 0, rf: 0 },                                 // a quad, not a rectangle
  ];
  const bin = encodeLandBin({ tag: 'x' }, { buildings: B, roads: [{ cls: 6, pts: [0, 0, 50, 10, 120, -4] }], areas: [{ kind: 5, pts: [0, 0, 100, 0, 100, 80] }], town: { DN: 2, q: new Uint8Array([0, 9, 200, 3]) } });
  const d = decodeLandBin(bin.buffer);
  check(d.header.tag === 'x', 'header');
  let err = 0; B.forEach((b, i) => { for (let k = 0; k < b.pts.length; k++) err = Math.max(err, Math.abs(d.buildings[i].pts[k] - b.pts[k])); });
  check(d.buildings.length === 3 && err <= 0.26, `footprints to the 0.5 m grid (max error ${err.toFixed(2)} m)`);
  check(d.buildings.every((b, i) => b.h === B[i].h && b.lv === B[i].lv && b.ty === B[i].ty && b.rf === B[i].rf), 'height, levels, type, roof');
  check(d.buildings[2].pts.length === 8 && Math.abs(d.buildings[2].pts[4] - 16.5) < 0.3, 'a skewed quad stays a quad');
  check(d.roads[0].cls === 6 && Array.from(d.roads[0].pts).join() === '0,0,50,10,120,-4', 'street');
  check(d.areas[0].kind === 5 && d.areas[0].pts.length === 6, 'land cover');
  check(Array.from(d.town.q).join() === '0,9,200,3', 'street density grid');
}

// OSM -> local lists (a fake world: land everywhere south of z = 0, water north of it)
{
  const world = { R: 6000, sdfAt: (x, z) => z < 0 ? -(-z) : z };
  const lat0 = 50, lon0 = -1, kz = 110540, kx = Math.cos(lat0 * Math.PI / 180) * 111320;
  const ll = (x, z) => ({ lat: lat0 - z / kz, lon: lon0 + x / kx });
  const way = (id, tags, xz) => ({ type: 'way', id, tags, geometry: xz.map(([x, z]) => ll(x, z)) });
  const osm = {
    buildings: { elements: [
      way(1, { building: 'house', 'building:levels': '2' }, [[0, -100], [12, -100], [12, -90], [0, -90], [0, -100]]),
      way(2, { building: 'yes' }, [[0, 100], [12, 100], [12, 110], [0, 110], [0, 100]]),                  // in the water
      way(3, { building: 'yes' }, [[0, -4000], [12, -4000], [12, -3990], [0, -3990], [0, -4000]]),        // beyond the shore band
      way(4, { highway: 'residential' }, [[-500, -50], [0, -60], [500, -40]]),
      way(1, { building: 'house' }, [[0, -100], [12, -100], [12, -90], [0, -90], [0, -100]]),              // again (another box)
    ] },
    places: { elements: [{ type: 'node', id: 9, lat: ll(300, -200).lat, lon: ll(300, -200).lon, tags: { place: 'village', name: 'Testby', population: '1,200' } }] },
  };
  const out = processLand(osm, lat0, lon0, world);
  check(out.buildings.length === 1 && out.buildings[0].lv === 2 && out.buildings[0].ty === 1, 'one footprint on land within the band, tags kept, duplicates merged');
  check(Math.abs(out.buildings[0].pts[0]) < 0.5 && Math.abs(out.buildings[0].pts[1] + 100) < 0.5, 'projected to local metres');
  check(out.roads.length === 1 && out.roads[0].cls === 6, 'street');
  check(out.places.length === 1 && out.places[0].name === 'Testby' && out.places[0].pop === 1200 && Math.abs(out.places[0].x - 300) <= 1, 'named place');
}

// streets split per chunk join up at the boundary
{
  const R = 6000, C = LAND_CHUNK, xb = -R + C;
  const parts = splitByChunk([{ cls: 4, pts: [xb - 300, 0, xb - 100, 0, xb + 100, 0, xb + 300, 0] }], R);
  const all = [...parts.values()].flat();
  check(parts.size === 2 && all.length === 2, 'a street crossing a chunk edge: one piece per chunk');
  const ends = all.map(r => [r.pts[0], r.pts[r.pts.length - 2]]);
  check(ends.some(e => e[1] === xb - 100) && ends.some(e => e[0] === xb - 100), 'the pieces share the vertex before the edge (the crossing segment goes with the chunk holding its middle)');
  const t = townDensity([{ cls: 6, pts: [0, 10, 100, 10] }], R);
  check(t.q[Math.floor(10 / 250 + R / 250) * t.DN + Math.floor(50 / 250 + R / 250)] === 10, 'street density: 100 m in its cell');
}

// baked venues
for (const v of VENUES) {
  if (v.open || !existsSync(`data/venues/${v.id}.land.json`)) continue;
  const man = JSON.parse(readFileSync(`data/venues/${v.id}.land.json`, 'utf8'));
  if (!man.v) { console.log(`     ${v.id}: old single-file land data`); continue; }
  const base = decodeLandBin(readFileSync(`data/venues/${v.id}.land.bin`).buffer.slice(0));
  const R = man.R;
  let nB = 0, out = 0, bytes = 0;
  for (const key of Object.keys(man.chunks)) {
    const buf = readFileSync(`data/venues/${v.id}.land/${key.replace(',', '_')}.bin`); bytes += buf.length;
    const d = decodeLandBin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    nB += d.buildings.length;
    for (const b of d.buildings) if (Math.abs(b.pts[0]) > R + 50 || Math.abs(b.pts[1]) > R + 50) out++;
  }
  check(nB === man.counts.buildings && out === 0 && base.town && base.areas.length > 0,
    `${v.id}: ${nB} footprints in ${Object.keys(man.chunks).length} chunks, ${base.areas.length} areas, ${man.places.length} places, ${((bytes + readFileSync(`data/venues/${v.id}.land.bin`).length) / 1048576).toFixed(2)} MB`);
}
console.log(fails ? `${fails} FAILED` : 'all land checks pass');
process.exit(fails ? 1 : 0);
