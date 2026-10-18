// One passage: sail from A to B on a venue's real chart, wind and tide, the game's autopilot navigating (its route
// round land and shallows, its tacks on the laylines, its sails and reefs), steered by the autopilot's own helm or
// by the competent helmsman of the sea trials (test/seatrial/trial.mjs Helmsman) on the autopilot's course; and an
// independent estimate of the time from the class's polar and the tide (routing.mjs). Returns the times and what
// happened on the way. The judging is test/passages.mjs.
//
// Time-accelerated: the game's 120 Hz step on the strip sail model (the model the game itself switches to beyond x2
// time warp: README "Levels and cost"), whose own polar the estimate uses.
import { makeBoat, CLASSES, autoTrim, solvePolarAngle, POLAR_TWAS, vmgTargets, wrap, clamp } from '../../js/physics.js';
import '../../js/sail/sailsim.js';
import { KT, DEG } from '../../js/env.js';
import { makeProjection } from '../../js/world.js';
import { Autopilot } from '../../js/autopilot.js';
import { Crew } from '../../js/crew.js';
import { Damage } from '../../js/damage.js';
import { Fatigue } from '../../js/fatigue.js';
import { venue, makeEnv, startReef, Helmsman } from '../seatrial/trial.mjs';
import { routeEstimate } from './routing.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DT = 1 / 120;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// the nearest water deep enough for her keel, with room round it (as the autopilot picks a waypoint's spot)
function water(world, x, z, keel, L) {
  if (world.open) return { x, z };
  const R0 = Math.max(2 * L, 12);
  const ok = (px, pz) => world.sdfAt(px, pz) > 8 && world.depthAt(px, pz) > keel + 0.5 && [0, 1, 2, 3, 4, 5, 6, 7].every((q) => world.depthAt(px + Math.cos(q * Math.PI / 4) * R0, pz + Math.sin(q * Math.PI / 4) * R0) > keel);
  if (ok(x, z)) return { x, z };
  for (let r = 10; r < 2500; r += 10) for (let a = 0; a < 6.28; a += 12 / r) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (ok(px, pz)) return { x: px, z: pz }; }
  return { x, z };
}

// the strip model's own polar at a few winds (the VPP: js/physics.js solvePolarAngle), interpolated in wind speed
// (kept on disk in test/out/polar-cache, keyed by the newest modification time of the physics' sources: a VPP of
// fifteen angles at four winds takes minutes)
const PCACHE = {};
const SRC_STAMP = (() => { let m = 0; for (const d of ['js', 'js/classes', 'js/sail']) for (const f of readdirSync(ROOT + d)) if (f.endsWith('.js')) m = Math.max(m, statSync(`${ROOT}${d}/${f}`).mtimeMs); return Math.round(m); })();
function polarTable(C, kn) {
  const dir = `${ROOT}test/out/polar-cache/`, f = `${dir}${C.id}-${kn}-${SRC_STAMP}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const tab = POLAR_TWAS.map((a) => { const p = solvePolarAngle(C, kn * KT, a, { sailModel: 'strip' }); return { twa: p.twa, bsp: p.bsp, vmg: p.vmg }; });
  mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(tab));
  return tab;
}
export function stripPolar(cls, kns) {
  const key = cls + ':' + kns.join(',');
  if (PCACHE[key]) return PCACHE[key];
  const C = CLASSES[cls];
  const tabs = kns.map((kn) => polarTable(C, kn));
  const at = (twsMS, twaDeg) => {
    const kn = twsMS / KT; let i = 0; while (i < kns.length - 2 && kn > kns[i + 1]) i++;
    const f = kns.length === 1 ? 0 : clamp((kn - kns[i]) / (kns[i + 1] - kns[i]), 0, 1);
    const a = Math.min(180, Math.abs(twaDeg));
    const row = (tab) => { let j = 0; while (j < POLAR_TWAS.length - 2 && a > POLAR_TWAS[j + 1]) j++; const g = clamp((a - POLAR_TWAS[j]) / (POLAR_TWAS[j + 1] - POLAR_TWAS[j]), 0, 1); return tab[j].bsp + (tab[j + 1].bsp - tab[j].bsp) * g; };
    const lo = row(tabs[i]), hi = kns.length > 1 ? row(tabs[i + 1]) : lo;
    // (below the lightest wind the speed falls with it; under the polar's first angle she is in irons)
    return (lo + (hi - lo) * f) * (kn < kns[0] ? kn / kns[0] : 1) * (a < POLAR_TWAS[0] ? 0 : 1);
  };
  return (PCACHE[key] = { at, tabs, kns, vt: tabs.map((t) => vmgTargets(t)) });
}

// the tide's clock for a fair or a foul stream along the course: the hour (on a fixed spring day) with the most
// stream with her, or against her, along the straight line A -> B
export function tideClock(V, A, B, which) {
  const T = V.tide; if (!T || !which) return null;
  const day = Date.UTC(2026, 5, 10, 0), ux = B.x - A.x, uz = B.z - A.z, L = Math.hypot(ux, uz);
  let best = null;
  for (let h = 0; h < 24; h += 0.5) {
    T.setClock(day + h * 3600e3); T.setTime(0);
    let s = 0; for (let i = 0; i <= 8; i++) { const c = T.streamAt(A.x + ux * i / 8, A.z + uz * i / 8, {}); s += (c.x * ux + c.z * uz) / L; }
    s /= 9;
    if (!best || (which === 'fair' ? s > best.s : s < best.s)) best = { clock: day + h * 3600e3, s, h };
  }
  return best;
}

export async function runPassage(job) {
  const t0w = performance.now();
  const { cls, course, tws, tide, helm = 'ap', seed = 7 } = job;
  const C = CLASSES[cls], V = venue(course.venue), world = V.world;
  const P = world.open ? null : makeProjection(V.v.lat, V.v.lon);
  const pt = (p) => (Array.isArray(p) ? (([x, z]) => ({ x, z }))(P.fwd(p[0], p[1])) : p);
  const keel = C.draft + 1;
  const A = water(world, pt(course.from).x, pt(course.from).z, keel, C.loa), B = water(world, pt(course.to).x, pt(course.to).z, keel, C.loa);
  const twd = (course.twd ?? V.v.wind ?? 0) * DEG;
  const tc = tideClock(V, A, B, tide);
  const env = makeEnv({ venue: course.venue, tws, sea: true, gusty: true }, V, seed, { clock: tc ? tc.clock : undefined, at: A, twd });
  // the polar the boat sails to (and the autopilot's targets): the strip model's, at the wind and below (shelter)
  const tp0 = performance.now();
  const pol = stripPolar(cls, [Math.round(tws * 0.6), Math.round(tws * 0.8), tws, Math.round(tws * 1.2)]);
  const polarSec = (performance.now() - tp0) / 1000;
  const vt = pol.vt[2];
  const b = makeBoat(C, { id: 0, name: 'Passage', sailModel: 'strip', lod: 2 });
  b.auto.trim = true; b.auto.hike = true;
  b.ctrl.reef = startReef(C, tws);
  const psi0 = Math.atan2(B.x - A.x, -(B.z - A.z));
  b.reset(A.x, A.z, psi0); b.reefPos = b.ctrl.reef | 0;
  const u0 = 0.8 * pol.at(tws * KT, Math.abs(wrap(twd - psi0)) / DEG);
  for (let i = 0; i < 480; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0, world); b.x = A.x; b.z = A.z; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  b.ext = { X: 0, Y: 0, N: 0, K: 0 };
  const D = new Damage(b, { seed: seed * 131 }); b.dmg = D; b.fat = new Fatigue(b);
  const crew = new Crew(), ap = new Autopilot(b);
  ap.helm.targetsUpBsp = vt.up.bsp;
  const targets = { up: vt.up.twa, dn: vt.dn.twa }, sim = { boats: [b], world, env }, target = { x: B.x, z: B.z, label: 'B' };
  const H = new Helmsman(b, vt.up.bsp);
  ap.engage(0);
  ap.update(DT, 0, sim, { target, targets });
  // the estimate: from the polar and the tide along the autopilot's planned route (or the straight line)
  const legs = [...(ap.route || []).map(([x, z]) => ({ x, z })), { x: B.x, z: B.z }];
  const est = routeEstimate({ world, env, A, legs, twd, tws: tws * KT, polar: pol.at, L: C.loa, tideT: V.tide });
  if (V.tide) V.tide.setTime(0);
  const out = { cls, course: course.id, tws, tide: tide || null, helm, est: est.t, estDist: est.dist, estTacks: est.tacks, stream: tc ? tc.s / KT : null, tideHour: tc ? tc.h : null,
    distance: Math.hypot(B.x - A.x, B.z - A.z), routeLegs: legs.length, arrived: null, tacks: 0, gybes: 0, aground: 0, minUK: Infinity, events: [], capsized: false, nan: false };
  const maxT = Math.min(job.maxT ?? 6 * 3600, Number.isFinite(est.t) ? Math.max(1.8 * est.t + 600, est.t + 1200) : 4 * 3600);
  let side = Math.sign(wrap(twd - b.psi)) || 1, t = 0, sailed = 0, px = b.x, pz = b.z;
  for (let i = 0; t < maxT; i++, t += DT) {
    if (i % 12 === 0) { env.focus.x = b.x; env.focus.z = b.z; env.tick(t); }
    crew.pre(b); crew.begin(b);
    ap.update(DT, t, sim, { target, targets });
    crew.end(b, DT);
    if (!ap.engaged) { ap.engage(t); out.events.push({ t, type: 'ap-off' }); }
    if (helm === 'helm' && !ap.arrived) { H.step(DT, ap.helm.desired ?? b.psi, 0.6); ap.helmOut = b.ctrl.helm; }
    crew.post(b, DT, true);
    const E = b.ext; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    D.pre(DT, E, env, t);
    b.step(DT, env, t, world);
    D.post(DT, { world, env, t, seabed: () => 'sand' });
    b.fat.post(DT, 0);
    if (!Number.isFinite(b.x + b.z + b.psi + b.u)) { out.nan = true; break; }
    for (const ev of D.events.splice(0)) out.events.push({ t: Math.round(t), type: ev.type, msg: ev.msg });
    for (const ev of ap.events.splice(0)) if (ev.kind === 'arrive' && out.arrived === null) out.arrived = t;
    if (b.aground > 0.05) out.aground += DT;
    if (!world.open && i % 60 === 0) out.minUK = Math.min(out.minUK, world.depthAt(b.x, b.z) - C.draft);
    if (b.capsized || Math.abs(b.phi) > 85 * DEG) out.capsized = true;
    const s = Math.sign(wrap(twd - b.psi)) || side;
    if (s !== side) { if (Math.abs(wrap(twd - b.psi)) < Math.PI / 2) out.tacks++; else out.gybes++; side = s; }
    if (i % 120 === 0) { sailed += Math.hypot(b.x - px, b.z - pz); px = b.x; pz = b.z; }
    if (out.arrived !== null) break;
    if (D.rig.down || b.sunk) break;
  }
  out.t = t; out.sailed = sailed;
  out.endDist = Math.hypot(B.x - b.x, B.z - b.z);
  out.rigDown = D.rig.down; out.rigWhy = D.rig.why;
  out.wallSec = (performance.now() - t0w) / 1000; out.polarSec = polarSec;
  if (!Number.isFinite(out.minUK)) out.minUK = null;
  return out;
}
