// Boats never sail onto the land. A boat is aimed straight at a real shore (the baked charts, the surveyed bottom,
// still water at chart datum) at full speed on a beam reach, sails drawing and trimmed, the helm holding her bow at
// the beach, for 90 s:
//   a keelboat stops where her keel meets the bottom, out in the water (her draught of water under her, give or
//   take the slope of the bed over a few metres of slide), or where her bow meets a steep shore, and stays there;
//   a dinghy (board and blade kick up / the crew lifts them) runs up the beach no further than about half her length
//   (beaching a dinghy at speed, she slides a metre or two up the sand), and never across dry land.
// What is measured: the furthest the boat's reference point got onto the land (the chart's signed distance to the
// shoreline, negative ashore), the depth under her when she stopped and her speed after 90 s.
// node test/aground.mjs [QUICK=1: one venue]
import { readFileSync, existsSync } from 'node:fs';
import { suite } from './lib/check.mjs';
import { Boat, autoTrim, wrap } from '../js/physics.js';
import { VENUES, World } from '../js/world.js';
import { decodeBathy } from '../js/bathy.js';
import '../js/sail/sailsim.js';
const QUICK = !!+(process.env.QUICK || 0), MODEL = process.env.SAILS || 'strip';
const KT = 0.514444, DEG = Math.PI / 180;
const S = suite('aground');

function venue(id) {
  const v = VENUES.find((x) => x.id === id), world = new World(v, JSON.parse(readFileSync(`data/venues/${id}.json`)));
  if (existsSync(`data/venues/${id}.bathy.bin`)) { const bb = readFileSync(`data/venues/${id}.bathy.bin`); world.setBathy(decodeBathy(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)), null); }
  return world;
}
// a straight bit of shore near the venue's centre: a water point `off` m from it, depth enough for the boat, the
// signed distance's gradient steady around it; returns the start and the heading straight at the land
function shoreSpot(world, off, need, seed) {
  const R = world.R * 0.6;
  for (let k = 0; k < 40000; k++) {
    const a = (k * 2.39996 + seed) % (2 * Math.PI), r = R * Math.sqrt(((k * 0.618034) % 1));
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = world.sdfAt(x, z);
    if (Math.abs(s - off) > 3) continue;
    const e = 4, gx = (world.sdfAt(x + e, z) - world.sdfAt(x - e, z)) / (2 * e), gz = (world.sdfAt(x, z + e) - world.sdfAt(x, z - e)) / (2 * e), gl = Math.hypot(gx, gz);
    if (gl < 0.85 || gl > 1.15) continue;
    // the shore straight ahead: the line to it stays clean, the land beyond it is land for 60 m
    const nx = -gx / gl, nz = -gz / gl;
    let ok = world.depthAt(x, z) > need;
    for (let d = 10; d < off + 60 && ok; d += 5) { const sd = world.sdfAt(x + nx * d, z + nz * d); ok = Math.abs(sd - (off - d)) < 12; }
    if (ok) return { x, z, psi: Math.atan2(nx, -nz) };
  }
  return null;
}
function run(world, cls, spot) {
  const b = new Boat(cls, { sailModel: MODEL, lod: 1 }), C = b.cls, tws = 14 * KT, twd = wrap(spot.psi + Math.PI / 2);
  const env = { wind: { sample: (x, z, t, o) => { o.speed = tws; o.dir = twd; o.puff = 0; return o; }, profile: (h) => Math.log(Math.max(h, 0.3) / 2e-4) / Math.log(10 / 2e-4) },
    current: { at: (x, z, o) => { o.x = 0; o.z = 0; return o; } }, wavesOn: false };
  b.reset(spot.x, spot.z, spot.psi);
  for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0); b.x = spot.x; b.z = spot.z; b.psi = spot.psi; b.r = 0; }
  const dt = 1 / 120; let t = 0, minS = 1e9, minBow = 1e9, uMax = 0, tHit = null;
  for (let i = 0; i < 120 * 90; i++, t += dt) {
    autoTrim(b, dt, 0, true);
    b.ctrl.helm = Math.max(-1, Math.min(1, -2.5 * wrap(b.psi - spot.psi) - 2 * b.r));
    b.step(dt, env, t, world);
    if (!Number.isFinite(b.x)) break;
    minS = Math.min(minS, world.sdfAt(b.x, b.z)); uMax = Math.max(uMax, b.u);
    minBow = Math.min(minBow, world.sdfAt(b.x + Math.sin(b.psi) * C.bowX, b.z - Math.cos(b.psi) * C.bowX));
    if (tHit === null && b.aground > 0) tHit = t;
  }
  const un = (b.vgx ?? 0) * Math.sin(spot.psi) - (b.vgz ?? 0) * Math.cos(spot.psi);      // (her speed on toward the land)
  return { b, C, minS, minBow, uMax, tHit, depth: world.depthAt(b.x, b.z), u: Math.hypot(b.u, b.v), un, s: world.sdfAt(b.x, b.z) };
}

const VEN = QUICK ? ['sydney', 'garda'] : ['sydney', 'solent', 'marseille', 'garda'];
const CLS = QUICK ? ['blackwatch', 'dinghy'] : ['sportboat', 'blackwatch', 'j122', 'dinghy', 'cat'];
for (const id of VEN) {
  const world = venue(id);
  for (const cls of CLS) {
    const C = new Boat(cls, { sailModel: 'strip' }).cls, keel = !C.keel.board && !C.multihull;
    const spot = shoreSpot(world, 70, C.draft + 2, cls.length);
    if (!spot) { S.ok(false, `${id}: a clean shore for ${cls}`, { measured: 'none found' }); continue; }
    const r = run(world, cls, spot), tag = `${id} ${cls.padEnd(10)}`;
    const where = `at ${spot.x.toFixed(0)},${spot.z.toFixed(0)} hdg ${(spot.psi / DEG).toFixed(0)}`;
    if (keel) {
      S.within({ quantity: `${tag} furthest onto the land, driven at the beach at ${(r.uMax / KT).toFixed(1)} kn (${where})`, measured: -r.minS, hi: 0, unit: 'm', source: 'a keel stops a keelboat in the water: she grounds where the depth is her draught' });
      S.within({ quantity: `${tag} furthest her stem got onto the land`, measured: -r.minBow, hi: 1, unit: 'm', source: 'at a steep shore or a wall the bow meets it; on a shelving one the keel grounds first (est.: the stem rides up a metre at most)' });
      S.within({ quantity: `${tag} depth where she lies after 90 s`, measured: r.depth, lo: C.draft * 0.5, unit: 'm', source: `her keel on the bottom: depth ~ draught ${C.draft.toFixed(2)} m (half of it allowed for the slide)` });
    } else {
      S.within({ quantity: `${tag} furthest up the beach at ${(r.uMax / KT).toFixed(1)} kn (${where})`, measured: -r.minS, hi: 0.5 * C.loa, unit: 'm', source: 'a dinghy beached at speed slides a metre or two up the sand, not across the land (est.: half her length)' });
    }
    S.within({ quantity: `${tag} speed on toward the land after 90 s aground (she may slide along it)`, measured: r.un / KT, hi: 0.1, unit: 'kn', source: 'aground, she stops going on (the sails still drawing)' });
  }
}
S.done();
