// The player's autopilot (js/autopilot.js): the AI crews' tactician and helm sailing to a waypoint, with its coach.
// (a) 800 m dead to windward in 12 kn, open water: arrives, tacking on the laylines (2+ tacks), in about the time the
//     polar's upwind VMG gives (within 25%); the coach's layline call comes where the other tack lays the waypoint
// (b) 800 m dead downwind: arrives, gybing; the gennaker goes up (the coach says so) with the wind aft
// (c) a reach: arrives with no tack or gybe, close to the straight line
// (d) San Francisco Bay: a waypoint behind Alcatraz (the real chart and depths): arrives by a water route, never aground
// (e) manual helm input disengages it; with no waypoint it holds the wind angle
// CASES=a,b,...: a subset. CLS=class (sportboat). LOD=0/1/2 the sail model's level (1: the AI fleet's). V=1: a trace
import { Boat, solvePolar, vmgTargets, makeSteadyEnv, autoTrim, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World, makeProjection } from '../js/world.js';
import { decodeBathy } from '../js/bathy.js';
import { Autopilot } from '../js/autopilot.js';
import { readFileSync } from 'node:fs';
const KT = 0.514444, DEG = Math.PI / 180;
const CLS = process.env.CLS || 'sportboat', LOD = +(process.env.LOD ?? 1), V = !!process.env.V;
const CASES = (process.env.CASES || 'a,b,c,d,e').split(',');
await loadBakedPolars(CLS);
const tws = 12 * KT, polar = solvePolar(CLS, tws), vt = vmgTargets(polar), targets = { up: vt.up.twa, dn: vt.dn.twa };
console.log(`${CLS} 12 kn: upwind ${vt.up.twa}° ${(vt.up.bsp / KT).toFixed(2)} kn (VMG ${(vt.up.vmg / KT).toFixed(2)}), downwind ${vt.dn.twa}° ${(vt.dn.bsp / KT).toFixed(2)} kn (VMG ${(-vt.dn.vmg / KT).toFixed(2)})`);
const polarAt = (a) => { const d = a / DEG; let p = polar[0]; for (const q of polar) if (Math.abs(q.twa - d) < Math.abs(p.twa - d)) p = q; return p.bsp; };
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };
const openW = new World(VENUES.find(v => v.id === 'open'), null);

// sail from (x0, z0) on heading psi0 with the autopilot engaged; returns what happened
function sail({ world = openW, env = makeSteadyEnv(tws), x0 = 0, z0 = 0, psi0, target, maxT = 1500, twd = 0, onStep }) {
  const b = new Boat(CLS, { id: 0, lod: LOD }); b.reset(x0, z0, psi0);
  // (the crew sets the sails, sailing along at the polar's speed: a flying start)
  const u0 = 0.9 * polarAt(Math.abs(wrap(twd - psi0)));
  for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0, world); b.x = x0; b.z = z0; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  const ap = new Autopilot(b); ap.helm.targetsUpBsp = vt.up.bsp;
  const sim = { boats: [b], world, env };
  ap.engage(0);
  const dt = 1 / 120, out = { b, ap, events: [], tacks: 0, gybes: 0, aground: 0, arrived: null, maxOff: 0 };
  let side = Math.sign(wrap(twd - b.psi)) || 1, t = 0;
  for (let i = 0; i < maxT / dt; i++, t += dt) {
    ap.update(dt, t, sim, { target, targets });
    if (onStep && onStep(t, b, ap, out) === false) break;
    b.step(dt, env, t, world);
    if (b.aground > 0.05) out.aground += dt;
    for (const e of ap.events.splice(0)) {
      const twa = wrap(twd - b.psi);
      out.events.push({ ...e, twa, x: b.x, z: b.z, psi: b.psi, awa: b.diag.awaMid ?? b.diag.awa });
      if (V) console.log(`    t ${t.toFixed(0).padStart(4)}  ${e.kind.padEnd(6)} ${e.text}`);
      if (e.kind === 'arrive' && out.arrived === null) out.arrived = t;
    }
    const s = Math.sign(wrap(twd - b.psi)) || side;
    if (s !== side) { if (Math.abs(wrap(twd - b.psi)) < Math.PI / 2) out.tacks++; else out.gybes++; side = s; }
    if (V && i % (120 * 20) === 0) console.log(`    t ${t.toFixed(0).padStart(4)}  x ${b.x.toFixed(0)} z ${b.z.toFixed(0)} hdg ${(b.psi / DEG).toFixed(0)} twa ${(wrap(twd - b.psi) / DEG).toFixed(0)} u ${(b.u / KT).toFixed(1)} kn  ${ap.info?.label} ${ap.info?.next ?? ''}`);
    if (out.arrived !== null && t > out.arrived + 20) break;   // (and lies hove to a while)
  }
  out.t = t; out.dist = target ? Math.hypot(target.x - b.x, target.z - b.z) : 0;
  return out;
}

if (CASES.includes('a')) {
  console.log('(a) upwind: a waypoint 800 m dead to windward');
  const T = { x: 0, z: -800, label: 'Waypoint' };
  const r = sail({ psi0: -vt.up.twa * DEG * 1.1, target: T });   // (starting close-hauled on starboard)
  const pred = 800 / (vt.up.vmg);
  console.log(`   arrived ${r.arrived === null ? 'never' : r.arrived.toFixed(0) + ' s'} (polar VMG: ${pred.toFixed(0)} s), ${r.tacks} tacks, hove to ${r.dist.toFixed(0)} m off`);
  check(r.arrived !== null, 'arrives');
  check(r.tacks >= 2, `tacks on the laylines (${r.tacks} tacks)`);
  check(r.arrived !== null && Math.abs(r.arrived / pred - 1) < 0.25, `time within 25% of the polar's VMG (${r.arrived === null ? '-' : Math.round(100 * (r.arrived / pred - 1)) + '%'})`);
  check(r.dist < 3 * r.b.cls.loa, 'stays hove to near the waypoint');
  // (f) the layline call: when the coach says it, the waypoint lies about along the other tack's close-hauled track
  const lay = r.events.filter(e => e.kind === 'tack' && /reached the \w+ layline/.test(e.text));
  const at = lay.map(e => { const rel = Math.abs(wrap(Math.atan2(T.x - e.x, -(T.z - e.z)) - 0)) / DEG; return rel; });
  console.log(`   layline calls: ${lay.length}, waypoint ${at.map(a => a.toFixed(0) + '°').join(', ')} off the wind (close-hauled ${vt.up.twa}°)`);
  check(lay.length >= 1 && at.every(a => a > vt.up.twa - 6 && a < vt.up.twa + 20), 'coach: "Tacking now: we\'ve reached the layline" where the other tack lays it');
  check(r.events.some(e => e.kind === 'mode' && /^Beating/.test(e.text)), 'coach: "Beating to the waypoint…" on engaging');
  check(r.events.some(e => e.kind === 'arrive'), 'coach: "Arrived: heaving to"');
}

if (CASES.includes('b')) {
  console.log('(b) downwind: a waypoint 800 m dead to leeward');
  const T = { x: 0, z: 800, label: 'Waypoint' };
  const r = sail({ psi0: 180 * DEG + 30 * DEG, target: T });   // (running on starboard)
  const pred = 800 / (-vt.dn.vmg);
  console.log(`   arrived ${r.arrived === null ? 'never' : r.arrived.toFixed(0) + ' s'} (polar VMG: ${pred.toFixed(0)} s), ${r.gybes} gybes, ${r.tacks} tacks`);
  check(r.arrived !== null, 'arrives');
  check(r.gybes >= 1, `gybes on the layline (${r.gybes})`);
  check(r.arrived !== null && Math.abs(r.arrived / pred - 1) < 0.35, `time near the polar's downwind VMG (${r.arrived === null ? '-' : Math.round(100 * (r.arrived / pred - 1)) + '%'})`);
  if (r.b.sailBy.gennaker) {
    const h = r.events.find(e => e.kind === 'gen' && /^Hoisting/.test(e.text));
    check(!!h && Math.abs(h.twa) > 95 * DEG, `coach: "Hoisting the gennaker" with the wind aft (TWA ${h ? (Math.abs(h.twa) / DEG).toFixed(0) : '-'}°)`);
  }
  check(r.events.some(e => e.kind === 'gybe' && /other gybe/.test(e.text)), 'coach: "Gybing: … on the other gybe\'s side"');
}

if (CASES.includes('c')) {
  console.log('(c) reach: a waypoint 800 m on the beam');
  const T = { x: 800, z: 0, label: 'Waypoint' };
  let maxOff = 0;
  const r = sail({ psi0: 90 * DEG, target: T, onStep: (t, b) => { maxOff = Math.max(maxOff, Math.abs(b.z)); } });
  console.log(`   arrived ${r.arrived === null ? 'never' : r.arrived.toFixed(0) + ' s'}, ${r.tacks} tacks, ${r.gybes} gybes, ${maxOff.toFixed(0)} m off the straight line at most`);
  check(r.arrived !== null, 'arrives');
  check(r.tacks === 0 && r.gybes === 0 && maxOff < 40, 'directly (no tack, no gybe, on the line)');
  check(r.events.some(e => e.kind === 'mode' && /^Reaching/.test(e.text)), 'coach: "Reaching to the waypoint…"');
}

if (CASES.includes('d')) {
  console.log('(d) San Francisco Bay: a waypoint behind Alcatraz');
  const v = VENUES.find(x => x.id === 'sfbay'), geo = JSON.parse(readFileSync('data/venues/sfbay.json'));
  const world = new World(v, geo);
  const bb = readFileSync('data/venues/sfbay.bathy.bin');
  world.setBathy(decodeBathy(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)), null);
  const P = makeProjection(v.lat, v.lon), [ax, az] = P.fwd(37.8267, -122.4229);   // Alcatraz
  const twd = 255 * DEG, env = makeSteadyEnv(tws), base = env.wind.sample;
  env.wind.sample = (x, z, t, o) => { base(x, z, t, o); o.dir = twd; return o; };
  const S = { x: ax + 250, z: az + 1000 }, T = { x: ax - 150, z: az - 900, label: 'Waypoint' };
  let land = 0; for (let i = 0; i <= 100; i++) if (world.sdfAt(S.x + (T.x - S.x) * i / 100, S.z + (T.z - S.z) * i / 100) < 0) land++;
  console.log(`   Alcatraz at ${ax.toFixed(0)}, ${az.toFixed(0)}; start depth ${world.depthAt(S.x, S.z).toFixed(1)} m, waypoint depth ${world.depthAt(T.x, T.z).toFixed(1)} m; the straight line crosses land: ${land > 0}`);
  let minD = 1e9;
  const r = sail({ world, env, twd, x0: S.x, z0: S.z, psi0: twd + 100 * DEG, target: T, maxT: 1800, onStep: (t, b) => { minD = Math.min(minD, world.depthAt(b.x, b.z)); } });
  console.log(`   arrived ${r.arrived === null ? 'never' : r.arrived.toFixed(0) + ' s'}, least depth ${minD.toFixed(1)} m (draft ${r.b.cls.draft} m), aground ${r.aground.toFixed(1)} s; route: ${r.events.filter(e => e.kind === 'route' || e.kind === 'leg').map(e => e.text.split(':')[0]).join(' · ')}`);
  check(land > 0, 'the straight line crosses the island');
  check(r.events.some(e => e.kind === 'route'), 'plans a water route round it');
  check(r.arrived !== null, 'arrives');
  check(r.aground === 0, 'never aground');
}

if (CASES.includes('e')) {
  console.log('(e) manual helm input disengages; no waypoint: a wind vane');
  let hdgOff = 0, off = null;
  const r = sail({ psi0: 100 * DEG, target: null, maxT: 60, onStep: (t, b, ap) => {
    if (t > 20 && t < 40) hdgOff = Math.max(hdgOff, Math.abs(Math.abs(wrap(0 - b.psi)) - 100 * DEG));
    if (t > 40 && off === null) { b.ctrl.helm += 0.4; off = t; }     // (the player's key: the game's applyInput moves the helm)
    if (off !== null && t > off + 0.1) return false;
  } });
  check(r.events.some(e => e.kind === 'vane'), 'coach: "No waypoint: holding the wind angle"');
  check(hdgOff < 6 * DEG, `holds the true wind angle (within ${(hdgOff / DEG).toFixed(1)}°)`);
  check(!r.ap.engaged && r.events.some(e => e.kind === 'override'), 'manual helm input disengages it');
}
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
