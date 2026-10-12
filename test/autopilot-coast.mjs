// The autopilot along real coasts (js/autopilot.js, the AI helm's shallows in js/race.js), on the baked charts with
// their bathymetry under the tide (streams and level) at a fixed date: each case sails to a waypoint close in to
// the shore and checks that she
//   - never touches the bottom (and keeps her keel's depth under her the whole way),
//   - arrives (heaves to by the waypoint, or by the nearest water she floats in when it is too shallow),
//   - tacks / gybes a bounded number of times (no tack into the shallows and straight back out),
//   - holds a steady heading: no swinging off and back by 20+ degrees within a few seconds (the shallows'
//     hysteresis), and no kite hoisted and dropped over and over,
//   - and that the coach says what she does near the shore without a flood of lines.
// (a) the Solent: dead to windward along the shore, to a waypoint 50 m off it in 1.9 m (too shallow for her)
// (b) Sydney Harbour: dead downwind along the shore to a waypoint 50 m off it
// (c) San Francisco Bay: a broad reach round the land to a waypoint 25 m off a beach in 2 m
// (d) Hauraki Gulf: a beat to a waypoint on a drying bank (no water at all there)
// CASES=a,b: a subset. CLS=class (sportboat). LOD=sail model level (2: the cheapest). V=1: a trace.
// Run: node test/autopilot-coast.mjs   (slow: several simulated kilometres at 120 Hz)
import { Boat, solvePolar, vmgTargets, makeSteadyEnv, autoTrim, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { decodeBathy } from '../js/bathy.js';
import { Tide } from '../js/tide.js';
import { Autopilot } from '../js/autopilot.js';
import { readFileSync, existsSync } from 'node:fs';
const KT = 0.514444, DEG = Math.PI / 180;
const CLS = process.env.CLS || 'sportboat', LOD = +(process.env.LOD ?? 2), V = !!process.env.V;
const CASES = (process.env.CASES || 'a,b,c,d').split(',');
await loadBakedPolars(CLS);
const tws = 12 * KT, polar = solvePolar(CLS, tws), vt = vmgTargets(polar), targets = { up: vt.up.twa, dn: vt.dn.twa };
const polarAt = (a) => { const d = a / DEG; let p = polar[0]; for (const q of polar) if (Math.abs(q.twa - d) < Math.abs(p.twa - d)) p = q; return p.bsp; };
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

function venue(id) {
  const v = VENUES.find(x => x.id === id), world = new World(v, JSON.parse(readFileSync(`data/venues/${id}.json`)));
  let tide = null;
  if (existsSync(`data/venues/${id}.tide.json`)) { tide = new Tide(JSON.parse(readFileSync(`data/venues/${id}.tide.json`))); tide.setClock(Date.UTC(2026, 5, 10, 6)); tide.setTime(0); }
  const bb = readFileSync(`data/venues/${id}.bathy.bin`);
  world.setBathy(decodeBathy(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)), tide);
  return { world, tide };
}

// sail from S to the waypoint T in a steady wind from twd (deg) and the venue's tide; returns what happened
function sail({ id, S, T, twd, maxT }) {
  const { world, tide } = venue(id), tw = twd * DEG, draft = new Boat(CLS).cls.draft;
  const env = makeSteadyEnv(tws); env.wind.sample = (x, z, t, o) => { o.speed = tws; o.dir = tw; o.puff = 0; return o; };
  if (tide) env.current.at = (x, z, o) => tide.streamAt(x, z, o);
  const b = new Boat(CLS, { id: 0, lod: LOD }), psi0 = Math.atan2(T.x - S.x, -(T.z - S.z)) + 0.3;
  b.reset(S.x, S.z, psi0);
  const u0 = 0.9 * polarAt(Math.abs(wrap(tw - psi0)));
  for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0, world); b.x = S.x; b.z = S.z; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  const ap = new Autopilot(b); ap.helm.targetsUpBsp = vt.up.bsp;
  const sim = { boats: [b], world, env }, target = { x: T.x, z: T.z, label: 'Waypoint' };
  ap.engage(0);
  const dt = 1 / 120, o = { b, ap, world, aground: 0, tacks: 0, gybes: 0, arrived: null, minUK: 1e9, ev: [], kinds: {}, des: [] };
  let side = Math.sign(wrap(tw - b.psi)) || 1, t = 0;
  for (let i = 0; i < maxT / dt; i++, t += dt) {
    if (tide && i % 120 === 0) tide.setTime(t);
    ap.update(dt, t, sim, { target, targets });
    b.step(dt, env, t, world);
    if (b.aground > 0.05) o.aground += dt;
    o.minUK = Math.min(o.minUK, world.depthAt(b.x, b.z) - draft);
    for (const e of ap.events.splice(0)) {
      o.ev.push({ t, ...e }); o.kinds[e.kind] = (o.kinds[e.kind] || 0) + 1;
      if (V) console.log(`    t ${t.toFixed(0).padStart(4)}  ${e.kind.padEnd(10)} ${e.text}`);
      if (e.kind === 'arrive' && o.arrived === null) o.arrived = t;
    }
    const s = Math.sign(wrap(tw - b.psi)) || side;
    if (s !== side) { if (Math.abs(wrap(tw - b.psi)) < Math.PI / 2) o.tacks++; else o.gybes++; side = s; }
    if (i % 120 === 0) o.des.push(ap.helm.desired ?? b.psi);
    if (V && i % (120 * 20) === 0) console.log(`    t ${t.toFixed(0).padStart(4)}  x ${b.x.toFixed(0)} z ${b.z.toFixed(0)} hdg ${(b.psi / DEG).toFixed(0)} u ${(b.u / KT).toFixed(1)} kn  shore ${world.sdfAt(b.x, b.z).toFixed(0)} m  depth ${world.depthAt(b.x, b.z).toFixed(1)} m  ${ap.info?.label ?? ''} ${ap.info?.next ?? ''}`);
    if (o.arrived !== null && t > o.arrived + 10) break;
  }
  // the heading she wants, second by second: a swing of 10+ degrees in a second undone (the other way) within 8 s
  const D = o.des; o.rev = 0;
  for (let i = 1; i + 8 < D.length; i++) {
    const a = wrap(D[i] - D[i - 1]); if (Math.abs(a) < 10 * DEG) continue;
    for (let k = i + 1; k < i + 8; k++) { const c = wrap(D[k] - D[k - 1]); if (Math.abs(c) > 10 * DEG && Math.sign(c) !== Math.sign(a)) { o.rev++; i = k; break; } }
  }
  o.t = t; o.T = ap.T; o.dist = Math.hypot(ap.T.x - b.x, ap.T.z - b.z); o.draft = draft;
  // the coach: lines a minute, and the most in any one minute
  o.perMin = o.ev.length / (t / 60); o.burst = 0;
  for (const e of o.ev) o.burst = Math.max(o.burst, o.ev.filter(f => f.t >= e.t && f.t < e.t + 60).length);
  console.log(`   ${o.arrived !== null ? `arrived in ${o.arrived.toFixed(0)} s` : `not there after ${t.toFixed(0)} s (${o.dist.toFixed(0)} m to go)`}; aground ${o.aground.toFixed(1)} s, least under the keel ${o.minUK.toFixed(1)} m; ${o.tacks} tacks, ${o.gybes} gybes; ${o.rev} heading swings; coach ${o.ev.length} lines (${o.perMin.toFixed(1)}/min, at most ${o.burst} in a minute) ${JSON.stringify(o.kinds)}`);
  return o;
}
const common = (o, { tacks = 99, gybes = 99 } = {}) => {
  check(o.aground === 0 && o.minUK > 0, `never aground (least ${o.minUK.toFixed(1)} m under the keel)`);
  check(o.arrived !== null, 'arrives');
  check(o.tacks <= tacks && o.gybes <= gybes, `${o.tacks} tacks (at most ${tacks}), ${o.gybes} gybes (at most ${gybes})`);
  check(o.rev <= 3, `a steady heading: ${o.rev} swings off and back (at most 3)`);
  check(o.perMin < 2.5 && o.burst <= 8, `the coach without a flood: ${o.perMin.toFixed(1)} lines a minute, at most ${o.burst} in any one`);
  check((o.kinds.gen || 0) <= 3, `the kite not hoisted and dropped over and over (${o.kinds.gen || 0} calls)`);
  check((o.kinds.leg || 0) <= 10 && (o.kinds.shoal || 0) <= 6 && (o.kinds.shoalClear || 0) <= 4, 'no kind of line said over and over (legs, shallows)');
};

if (CASES.includes('a')) {
  console.log('(a) the Solent: dead to windward along the shore, to a waypoint 50 m off it in 1.9 m of water');
  const o = sail({ id: 'solent', S: { x: -2890.87, z: 732.13 }, T: { x: -1490.01, z: 485.34 }, twd: 78.67, maxT: 1800 });
  common(o, { tacks: 14 });
  check(o.ev.some(e => e.kind === 'shallowWp') && o.world.depthAt(o.T.x, o.T.z) > o.draft + 0.5, `stops short where she floats (${o.world.depthAt(o.T.x, o.T.z).toFixed(1)} m there)`);
  check(o.ev.some(e => e.kind === 'tack' && /shallows/.test(e.text)), 'coach: "Tacking away from the shallows"');
}
if (CASES.includes('b')) {
  console.log('(b) Sydney Harbour: dead downwind along the shore to a waypoint 50 m off it');
  const o = sail({ id: 'sydney', S: { x: 3452.92, z: 903.06 }, T: { x: 2723.61, z: 2297.86 }, twd: 30.48, maxT: 1500 });
  common(o, { gybes: 8 });
}
if (CASES.includes('c')) {
  console.log('(c) San Francisco Bay: round the land on a broad reach to a waypoint 25 m off a beach in 2 m');
  const o = sail({ id: 'sfbay', S: { x: 737.44, z: 514.99 }, T: { x: 446.28, z: 1489.86 }, twd: 69.52, maxT: 1200 });
  common(o, { tacks: 2, gybes: 4 });
  check(o.ev.some(e => e.kind === 'route'), 'coach: routes round the land');
}
if (CASES.includes('d')) {
  console.log('(d) Hauraki Gulf: a beat to a waypoint on a drying bank');
  const o = sail({ id: 'auckland', S: { x: 103.21, z: -3794.45 }, T: { x: 2009.03, z: -2617.3 }, twd: 137.75, maxT: 2000 });
  common(o, { tacks: 12 });
  check(o.ev.some(e => e.kind === 'shallowWp' && /no water/.test(e.text)), 'coach: "The waypoint is in no water … we stop … short"');
}
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
