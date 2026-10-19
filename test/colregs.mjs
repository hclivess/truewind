// The autopilot's lookout (js/colregs.js) against vessels that hold their course and speed whatever she does (the worst
// case: none of them keeps a lookout), in open water, 12 kn of wind from the north:
// (a) a car ferry (82 m, 13 kn) crossing ahead from starboard: a ship that cannot turn for a yacht, so she gives way
//     early, passing astern of it
// (b) a ship (130 m, 11 kn) overtaking from astern on a near-parallel course: the overtaking vessel keeps clear (13),
//     so she stands on, then acts herself when it does not (17(b))
// (c) a yacht on starboard tack crossing her bow while she beats on port: she keeps clear (12), bearing away astern
// (d) a motor cruiser crossing from port at 16 kn: power gives way to sail, she stands on, then acts as it closes
// Each: no contact, the closest approach (between centres, less half the two lengths) above a safe minimum, she
// arrives at her waypoint, and the coach said why. CASES=a,c: a subset. V=1: the coach's lines.
import { Boat, solvePolar, vmgTargets, makeSteadyEnv, autoTrim, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { Autopilot } from '../js/autopilot.js';
import { AIHelm } from '../js/race.js';
import { VESSELS } from '../js/traffic.js';
const KT = 0.514444, DEG = Math.PI / 180, DT = 1 / 120;
const CLS = process.env.CLS || 'sportboat', V = !!process.env.V;
const CASES = (process.env.CASES || 'a,b,c,d').split(',');
await loadBakedPolars(CLS);
const tws = 12 * KT, polar = solvePolar(CLS, tws), vt = vmgTargets(polar), targets = { up: vt.up.twa, dn: vt.dn.twa };
const polarAt = (a) => { const d = Math.abs(a) / DEG; let p = polar[0]; for (const q of polar) if (Math.abs(q.twa - d) < Math.abs(p.twa - d)) p = q; return p.bsp; };
const world = new World(VENUES.find((v) => v.id === 'open'), null);
let bad = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

function boatAt(x, z, psi) {
  const env = makeSteadyEnv(tws), b = new Boat(CLS, { id: 0, lod: 2 }); b.reset(x, z, psi);
  const u0 = 0.9 * polarAt(wrap(0 - psi));
  for (let i = 0; i < 480; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0, world); b.x = x; b.z = z; b.psi = psi; b.r = 0; b.u = u0; b.v = 0; }
  return { b, env, u0 };
}
// a vessel of the traffic on a straight course at a steady speed (no lookout)
function vessel(type, x, z, psi, kn, o = {}) {
  const T = VESSELS[type];
  return { type, T, L: T.L, B: T.B, H: T.H, x, z, psi, u: kn * KT, sails: false, twa: 0, name: o.name || '', transit: !!o.transit };
}
// run: own boat from (0,0) on psi0 to target; the others step on; returns the closest approach to each
function run({ psi0, target, traffic = [], yachts = [], maxT = 900 }) {
  const { b, env } = boatAt(0, 0, psi0);
  const ap = new Autopilot(b); ap.helm.targetsUpBsp = vt.up.bsp;
  const others = yachts.map((y) => { const o = boatAt(y.x, y.z, y.psi); o.b.id = 1; o.b.name = y.name; const h = new AIHelm(o.b, { seed: 1, skill: 1 }); h.targetsUpBsp = vt.up.bsp; return { ...o, h, psi: y.psi }; });
  const sim = { boats: [b, ...others.map((o) => o.b)], world, env, traffic: { vessels: traffic } };
  ap.engage(0);
  const near = new Map(), said = [];
  let t = 0, arrived = null;
  for (let i = 0; i < maxT / DT; i++, t += DT) {
    ap.update(DT, t, sim, { target, targets });
    b.step(DT, env, t, world);
    for (const o of others) { o.h.steer(DT, o.psi); autoTrim(o.b, DT, 0, true); o.b.step(DT, env, t, world); }
    for (const v of traffic) { v.x += Math.sin(v.psi) * v.u * DT; v.z -= Math.cos(v.psi) * v.u * DT; }
    const all = [...traffic.map((v) => ({ k: v.type, x: v.x, z: v.z, L: v.L })), ...others.map((o) => ({ k: o.b.name, x: o.b.x, z: o.b.z, L: o.b.cls.loa }))];
    for (const c of all) { const d = Math.hypot(c.x - b.x, c.z - b.z) - 0.5 * (c.L + b.cls.loa); if (!near.has(c.k) || d < near.get(c.k)) near.set(c.k, d); }
    for (const e of ap.events.splice(0)) { said.push(e); if (V) console.log(`    t ${t.toFixed(0).padStart(4)} ${e.kind.padEnd(8)} ${e.text}`); if (e.kind === 'arrive' && arrived === null) arrived = t; }
    if (arrived !== null) break;
  }
  return { near, said, arrived, t };
}
const report = (r, k, min) => { const d = r.near.get(k); check(d >= min, `${k}: closest ${d.toFixed(0)} m hull to hull (>= ${min} m)`); };
const saidAny = (r, re) => r.said.some((e) => e.kind === 'colregs' && re.test(e.text));

if (CASES.includes('a')) {
  console.log('(a) a car ferry crossing ahead from starboard (she gives way to a ship)');
  // own boat on a beam reach east; the ferry heading north-west so that both would meet 600 m east in ~100 s
  const U = polarAt(90 * DEG), T = 600 / U, P = [600, 0], psiF = -50 * DEG, vF = 13 * KT;
  const F = vessel('carferry', P[0] - Math.sin(psiF) * vF * T, P[1] + Math.cos(psiF) * vF * T, psiF, 13, { name: 'Red Falcon' });
  const r = run({ psi0: 90 * DEG, target: { x: 1400, z: 0, label: 'Waypoint' }, traffic: [F] });
  report(r, 'carferry', 40);
  check(saidAny(r, /keep clear|do not impede/), 'the coach says she gives way, and why');
  check(r.arrived !== null, `arrives (${r.arrived?.toFixed(0)} s)`);
}
if (CASES.includes('b')) {
  console.log('(b) a ship overtaking from astern (she stands on, then acts when it does not keep clear)');
  const U = polarAt(90 * DEG), vS = 11 * KT, T = 150;
  // the ship 10 m to port of her track, coming up from astern to be abeam of her at T
  const S = vessel('ship', U * T - vS * T, -10, 90 * DEG, 11);
  const r = run({ psi0: 90 * DEG, target: { x: 2400, z: 0, label: 'Waypoint' }, traffic: [S], maxT: 1200 });
  report(r, 'ship', 30);
  check(saidAny(r, /overtaking/), 'the coach names the overtaking ship');
  check(r.arrived !== null, `arrives (${r.arrived?.toFixed(0)} s)`);
}
if (CASES.includes('c')) {
  console.log('(c) a starboard-tack yacht crossing her bow while she beats on port (rule 12: she keeps clear)');
  // own boat close-hauled on port, heading north-east; the other close-hauled on starboard, heading north-west
  const up = vt.up.twa * DEG, U = polarAt(up), T = 70, P = [Math.sin(up) * U * T, -Math.cos(up) * U * T];
  const ps = -up, Y = { x: P[0] - Math.sin(ps) * U * T, z: P[1] + Math.cos(ps) * U * T, psi: ps, name: 'Starboard' };
  const r = run({ psi0: up, target: { x: 300, z: -1200, label: 'Waypoint' }, yachts: [Y], maxT: 700 });
  report(r, 'Starboard', 8);
  check(saidAny(r, /port tack/), 'the coach says she is on port and keeps clear');
  check(r.arrived !== null, `arrives (${r.arrived?.toFixed(0)} s)`);
}
if (CASES.includes('d')) {
  console.log('(d) a motor cruiser crossing from port at 16 kn (she stands on; it does not give way; she acts)');
  const U = polarAt(90 * DEG), T = 80, P = [U * T, 0], psiM = 140 * DEG, vM = 16 * KT;
  const M = vessel('motor', P[0] - Math.sin(psiM) * vM * T, P[1] + Math.cos(psiM) * vM * T, psiM, 16);
  const r = run({ psi0: 90 * DEG, target: { x: 1400, z: 0, label: 'Waypoint' }, traffic: [M] });
  report(r, 'motor', 10);
  check(saidAny(r, /stand on/), 'the coach says she stands on');
  check(r.arrived !== null, `arrives (${r.arrived?.toFixed(0)} s)`);
}
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
