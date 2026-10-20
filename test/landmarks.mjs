// The venues' sightseeing landmarks (js/landmarks.js), headless: every predefined venue but the open-water ones has
// at least one; each stands inside its venue's map (the square of half-width R); each model builds (through a small
// three.js stand-in) to finite geometry of a plausible size, a bridge as long as its two ends are apart (within
// 10 %); the triangles and draw calls a venue adds stay modest; on the real charts (the baked venues), the bridges'
// towers in the water are obstacles to the boats and the water under a deck is not, and every landmark that
// carries a charted light stands within metres of that light.
// node test/landmarks.mjs
import { readFileSync, existsSync } from 'node:fs';
import { suite } from './lib/check.mjs';
import { VENUES, World, makeProjection, MAP_RADIUS } from '../js/world.js';
import { LANDMARKS, landmarksOf, placeLandmark, buildLandmarks, landmarkObstacles, Kit } from '../js/landmarks.js';
const S = suite('landmarks');
S.check = (quantity, cond, measured) => S.ok(cond, quantity, { measured: String(measured), expected: 'yes', source: 'js/landmarks.js' });

// ---- a three.js stand-in: just enough for landmarks.js to build its objects
class Attr { constructor(a, n) { this.array = a instanceof Float32Array || a instanceof Uint32Array ? a : Float32Array.from(a); this.itemSize = n; this.count = this.array.length / n; } }
class O3 { constructor() { this.children = []; this.userData = {}; this.position = { x: 0, y: 0, z: 0 }; } add(...o) { this.children.push(...o); return this; } traverse(f) { f(this); for (const c of this.children) c.traverse(f); } }
const THREE = {
  Group: class extends O3 {},
  Mesh: class extends O3 { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } },
  Points: class extends O3 { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isPoints = true; } },
  BufferGeometry: class { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; return this; } setIndex(i) { this.index = i; } },
  Float32BufferAttribute: class extends Attr { constructor(a, n) { super(Float32Array.from(a), n); } },
  Uint32BufferAttribute: class extends Attr { constructor(a, n) { super(Uint32Array.from(a), n); } },
  MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); this.userData = {}; } },
  ShaderMaterial: class { constructor(o) { Object.assign(this, o); } },
  DoubleSide: 2, FrontSide: 0, AdditiveBlending: 2,
};
function bbox(obj) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; let tris = 0, draws = 0, bad = 0;
  obj.traverse((o) => {
    if (!o.geometry) return;
    draws++;
    const p = o.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (!Number.isFinite(v)) bad++; else { b[k] = Math.min(b[k], v); b[k + 3] = Math.max(b[k + 3], v); } }
    if (o.isMesh) {
      tris += o.geometry.index.count / 3;
      const n = o.geometry.attributes.normal.array; for (const v of n) if (!Number.isFinite(v)) bad++;
      for (const i of o.geometry.index.array) if (i >= p.length / 3) bad++;
    }
  });
  return { min: b.slice(0, 3), max: b.slice(3), size: [b[3] - b[0], b[4] - b[1], b[5] - b[2]], tris, draws, bad };
}

// ---- 1. every predefined venue (not the open water) has landmarks, inside its map
for (const v of VENUES) {
  const list = landmarksOf(v.id);
  if (v.open) { S.check(`${v.id}: open water, no landmarks`, list.length === 0, `${list.length}`); continue; }
  S.check(`${v.id}: has landmarks`, list.length >= 1, `${list.length}: ${list.map(l => l.name).join('; ')}`);
  const R = v.R ?? MAP_RADIUS;
  for (const lm of list) {
    const pl = placeLandmark(lm, v);
    const ends = lm.a ? [pl.toWorld(0, pl.L / 2), pl.toWorld(0, -pl.L / 2)] : [[pl.x, pl.z]];
    const far = Math.max(...ends.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
    S.check(`${v.id}: ${lm.name} inside the map`, far < R, `${Math.round(far)} m of ${R} (x ${Math.round(pl.x)}, z ${Math.round(pl.z)})`);
  }
}
S.check('no registry entries for unknown venues', Object.keys(LANDMARKS).every(id => VENUES.some(v => v.id === id)), Object.keys(LANDMARKS).join(','));

// ---- 2. each model builds to finite geometry of a plausible size; a bridge spans its two ends
for (const [id, list] of Object.entries(LANDMARKS)) for (const lm of list) {
  const obj = lm.build(THREE, null, { ground: () => -6 });
  const B = bbox(obj);
  S.check(`${id}: ${lm.name} builds finite`, B.bad === 0 && B.tris > 0 && B.size.every(Number.isFinite), `${B.tris} tris, ${B.draws} draws, ${B.bad} bad`);
  const horiz = Math.max(B.size[0], B.size[2]), top = B.max[1];
  S.check(`${id}: ${lm.name} plausible size`, horiz > 4 && horiz < 4000 && top > 5 && top < 400, `${B.size.map(v => v.toFixed(0)).join(' x ')} m, top ${top.toFixed(0)} m`);
  if (lm.a) {
    const span = B.size[2], L = lm.L;
    S.check(`${id}: ${lm.name} spans its ends`, Math.abs(span - L) / L < 0.1, `model ${span.toFixed(0)} m, ends ${L.toFixed(0)} m apart`);
  }
}
// real heights of a few: the Golden Gate's towers 227 m, the Harbour Bridge's arch 134 m (and its flagpoles), Sydney
// Tower 309 m, the Sky Tower 328 m, the Spinnaker Tower 170 m, the Transamerica Pyramid 260 m
const top = (id, name, g = 0) => { const lm = landmarksOf(id).find(l => l.name.startsWith(name)); return bbox(lm.build(THREE, null, { ground: () => g })).max[1] - Math.max(g, 0.4); };
for (const [id, name, h, tol, g] of [['sfbay', 'Golden Gate', 227, 5, -6], ['sydney', 'Sydney Harbour', 147, 3, -6], ['sydney', 'Sydney Tower', 309, 3, 0], ['auckland', 'Sky Tower', 328, 3, 0], ['solent', 'Spinnaker', 170, 4, 0], ['sfbay', 'Transamerica', 260, 3, 0]]) {
  const t = top(id, name, g); S.check(`${name}: ${h} m high`, Math.abs(t - h) <= tol, `${t.toFixed(1)} m`);
}

// ---- 3. per venue: triangles and draw calls stay modest; there is something lit at night
for (const v of VENUES) {
  if (v.open) continue;
  const { group } = buildLandmarks(THREE, v.id, { ground: () => 0, sdf: () => 10 });
  const B = bbox(group), d = group.userData.landmarks;
  S.check(`${v.id}: modest`, B.tris < 150000 && B.draws <= 40, `${B.tris} tris, ${B.draws} draw calls`);
  S.check(`${v.id}: lit at night`, d.lights > 0 || d.mats.some(m => m.userData.night > 0.3), `${d.lights} lights, ${d.mats.filter(m => m.userData.night > 0).length} floodlit materials`);
}

// ---- 4. on the real charts: obstacles where the towers stand in the water, none in the water under a deck, the
// charted lights at the landmarks' lanterns
function world(id) {
  const v = VENUES.find((x) => x.id === id);
  return new World(v, JSON.parse(readFileSync(`data/venues/${id}.json`)));
}
const segD = (x, z, p) => { const [ax, az, bx, bz] = p.pts, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(ax + dx * t - x, az + dz * t - z) - p.w / 2; };
for (const [id, name, minObs] of [['sfbay', 'Golden Gate', 2], ['sfbay', 'San Francisco–Oakland', 4], ['sydney', 'Sydney Harbour', 0], ['newport', 'Claiborne Pell', 4]]) {
  if (!existsSync(`data/venues/${id}.json`)) continue;
  const w = world(id), v = w.venue, sdf = (x, z) => w.sdfAt(x, z);
  const lm = landmarksOf(id).find(l => l.name.startsWith(name)), pl = placeLandmark(lm, v);
  const obs = landmarkObstacles(id, sdf).filter(o => o.name === lm.name);
  S.check(`${name}: towers in the water are obstacles`, obs.length >= minObs, `${obs.length}`);
  // along the deck: wherever it is over water and clear of every footing by 40 m, a boat passes under it
  let wet = 0, blocked = 0;
  for (let s = 0; s <= pl.L; s += 10) {
    const [x, z] = pl.toWorld(0, pl.L / 2 - s);
    if (sdf(x, z) < 20) continue;
    wet++;
    const near = obs.some(o => Math.hypot(...[0, 1].map(k => (o.pts[k] + o.pts[k + 2]) / 2 - (k ? z : x))) < 45);
    if (!near && obs.some(o => segD(x, z, o) < 0)) blocked++;
  }
  S.check(`${name}: the water under the deck is open`, wet > 10 && blocked === 0, `${wet} wet stations, ${blocked} blocked`);
}
if (existsSync('data/venues/sfbay.json')) {
  const w = world('sfbay'), obs = landmarkObstacles('sfbay', (x, z) => w.sdfAt(x, z)), gg = landmarkObstacles('sfbay', () => 100).filter(o => o.name === 'Golden Gate Bridge');
  const lm = landmarksOf('sfbay')[0], pl = placeLandmark(lm, w.venue), mid = pl.toWorld(0, pl.L / 2 - 1363);
  S.check('Golden Gate: nothing in the middle of the main span', obs.every(o => segD(mid[0], mid[1], o) > 400), `${Math.round(Math.min(...obs.map(o => segD(mid[0], mid[1], o))))} m to the nearest footing`);
  S.check('Golden Gate: its decks are no obstacle even over water everywhere', gg.every(o => Math.hypot(o.pts[2] - o.pts[0], o.pts[3] - o.pts[1]) < 60), `${gg.length} footings, longest ${Math.round(Math.max(...gg.map(o => Math.hypot(o.pts[2] - o.pts[0], o.pts[3] - o.pts[1]))))} m`);
}
for (const [id, list] of Object.entries(LANDMARKS)) {
  if (!existsSync(`data/venues/${id}.seamarks.json`)) continue;
  const v = VENUES.find(x => x.id === id), marks = JSON.parse(readFileSync(`data/venues/${id}.seamarks.json`)).marks.filter(m => m.L && !m.far);
  for (const lm of list) {
    const pl = placeLandmark(lm, v), K = new Kit(); lm.model(K, pl.L);
    for (const [x, , z] of K.lamps) {
      const [wx, wz] = pl.toWorld(x, z), d = Math.min(...marks.map(m => Math.hypot(m.x - wx, m.z - wz)));
      S.check(`${id}: ${lm.name}'s lantern at its charted light`, d < 30, `${d.toFixed(0)} m`);
    }
  }
}
S.done();
