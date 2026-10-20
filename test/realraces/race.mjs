// One real race, sailed headless: a Cowes Week course (test/realdata/<id>.json: the marks, the start and finish
// lines, the gun) on the Solent's chart, depths and harmonic tide at the race's own date and time, in the wind
// measured on the Bramble pile through the race, the game's autopilot sailing the class from the gun to the finish
// (mark to mark, as passages.mjs sails A to B), on the strip sail model at the game's 120 Hz step. Also an
// estimate from the class's polar alone (a VMG router through the same marks in the same wind and tide). The judging
// is test/realraces.mjs.
//
// The wind: the Environment's own field (puffs, shifts, the land's shelter) about a mean that follows the measured
// series: its speed and direction interpolated between the 5 min readings (as vectors), given to the weather's
// synoptic trend (js/env.js Weather.synoptic, which every wind sample and the sea read). The pile stands in open
// water 2-4 km off the shores; the game's shelter is divided out there, so the sim's wind at the pile is the measured
// wind. Gustiness from the readings' own gust factor (max 3 s gust / 5 min mean; the field's gust factor is about
// 1 + 0.8 g: js/env.js), the oscillating shifts small (the 5 min directions carry the slow ones): est.
import { makeBoat, CLASSES, autoTrim, wrap, clamp } from '../../js/physics.js';
import '../../js/sail/sailsim.js';
import { KT, DEG } from '../../js/env.js';
import { makeProjection } from '../../js/world.js';
import { Autopilot } from '../../js/autopilot.js';
import { Crew } from '../../js/crew.js';
import { Damage } from '../../js/damage.js';
import { Fatigue } from '../../js/fatigue.js';
import { venue, makeEnv, startReef, primeClass } from '../seatrial/trial.mjs';
import { stripPolar } from '../passages/passage.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DT = 1 / 120;
const DATA = fileURLToPath(new URL('../realdata/', import.meta.url));
export const POLAR_KN = [5, 8, 11, 14, 17, 21];
export const loadCase = (id) => JSON.parse(readFileSync(`${DATA}${id}.json`, 'utf8'));

// the measured wind at t (s from the gun): speed (kn) and from-direction (deg), interpolated as a vector
export function windOf(series) {
  const S = series.map(([t, kn, deg]) => ({ t, u: kn * Math.sin(deg * DEG), v: kn * Math.cos(deg * DEG), kn }));
  return (t) => {
    let i = 0; while (i < S.length - 2 && t > S[i + 1].t) i++;
    const a = S[i], b = S[Math.min(i + 1, S.length - 1)], f = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    const u = a.u + (b.u - a.u) * f, v = a.v + (b.v - a.v) * f, kn = a.kn + (b.kn - a.kn) * f;   // (speed: the scalar mean, not the vector's)
    return { kn, deg: ((Math.atan2(u, v) / DEG) % 360 + 360) % 360 };
  };
}

// the course in the venue's metres: start line, marks, finish (a line, or a mark)
export function courseXZ(R, P) {
  const p = ([la, lo]) => { const [x, z] = P.fwd(la, lo); return { x, z }; };
  const line = (L) => ({ a: p(L.a), b: p(L.b), mid: p([(L.a[0] + L.b[0]) / 2, (L.a[1] + L.b[1]) / 2]) });
  return {
    start: line(R.start),
    marks: R.course.map((m) => ({ ...p([m.lat, m.lon]), name: m.name })),
    finish: R.finish.kind === 'line' ? { ...line(R.finish), kind: 'line', name: R.finish.name } : { ...p(R.finish.at), kind: 'mark', name: R.finish.name },
  };
}
// does the step p-q cross the finish line a-b onto its far side (where the goal is), between its ends with 500 m
// to spare: a committee vessel's end is not charted, and the autopilot beating to the goal past the line can tack
// round an end; she has sailed the course all the same (the few hundred metres round the end are hers to lose)
const cross = (p, q, a, b, far) => {
  const d = (u, v, w) => (v.x - u.x) * (w.z - u.z) - (v.z - u.z) * (w.x - u.x);
  if (Math.sign(d(a, b, q)) !== far || Math.sign(d(a, b, p)) === far) return false;
  const L = Math.hypot(b.x - a.x, b.z - a.z), s = ((q.x - a.x) * (b.x - a.x) + (q.z - a.z) * (b.z - a.z)) / L;
  return s > -500 && s < L + 500;
};

// the polar estimate: every 20 s the boat takes the heading whose speed over the ground (the polar at the wind of
// the moment, sheltered as the game shelters it, plus the tide's stream there and then) makes the most toward the
// next mark (test/passages/routing.mjs, with the wind and the tide following the clock), among the headings that keep
// her in water she floats in for the next minute (her draft and half a metre under the keel, at 10, 30 and 60 s along
// the track; none clear, the best of all). (Without it the router beat from Cowes straight across the Island, at the
// half wind the land's shelter leaves there: half an hour of the Friday's first beat over Gurnard.)
export function routeRealEstimate({ world, env, tide, legs, wind, polar, shelter0, L, draft = 1, dt = 20, maxT = 8 * 3600 }) {
  let x = legs[0].x, z = legs[0].z, t = 0, k = 1, dist = 0;
  const c = {};
  const clear = (x0, z0, vx, vz) => { for (const s of [10, 30, 60]) if (world.depthAt(x0 + vx * s, z0 + vz * s) < draft + 0.5) return false; return true; };
  while (t < maxT) {
    const G = legs[k]; let dx = G.x - x, dz = G.z - z; const d = Math.hypot(dx, dz);
    if (d < Math.max(2 * L + 5, 20)) { if (k === legs.length - 1) return { t, dist }; k++; continue; }
    dx /= d; dz /= d;
    if (tide) tide.setTime(t);
    env.current.at(x, z, c);
    const w = wind(t), twd = w.deg * DEG, U = w.kn * KT * world.shelterAt(x, z) / shelter0;
    let best = -Infinity, bvx = 0, bvz = 0;
    for (let pass = 0; pass < 2 && best === -Infinity; pass++) for (let h = 0; h < 360; h += 2) {
      const ps = h * DEG, v = polar(U, Math.abs(wrap(twd - ps)) / DEG);
      const vx = v * Math.sin(ps) + c.x, vz = -v * Math.cos(ps) + c.z, m = vx * dx + vz * dz;
      if (m > best && (pass || clear(x, z, vx, vz))) { best = m; bvx = vx; bvz = vz; }
    }
    const step = Math.min(dt, d / Math.max(best, 0.05));
    x += bvx * step; z += bvz * step; dist += Math.hypot(bvx, bvz) * step; t += step;
  }
  return { t: Infinity, dist };
}

// the strip model's polar tables for a class (cached on disk: test/out/polar-cache): a job of its own, so the
// workers bake them once before the races
export async function bakePolar(job) { const t0 = performance.now(); stripPolar(job.cls, POLAR_KN); return { cls: job.cls, secs: (performance.now() - t0) / 1000 }; }

export async function runRealRace(job) {
  const t0w = performance.now();
  const R = loadCase(job.id), seed = job.seed ?? 11;
  const C = CLASSES[R.sim], V = venue(R.venue), world = V.world, P = makeProjection(V.v.lat, V.v.lon);
  const K = courseXZ(R, P), L = C.loa;
  const gun = Date.parse(R.gunUtc), wind = windOf(R.wind.series);
  const meanKn = R.wind.series.reduce((s, w) => s + w[1], 0) / R.wind.series.length;
  const G3 = R.wind.series.filter((w) => w[3] > 0), gf = G3.length ? G3.reduce((s, w) => s + w[3] / w[1], 0) / G3.length : 1.2;
  const w0 = wind(0);
  const env = makeEnv({ venue: R.venue, tws: meanKn, sea: job.sea ?? true, gusty: false }, V, seed, { clock: gun, at: K.start.mid, twd: w0.deg * DEG });
  env.wind.gust = clamp((gf - 1) / 0.8, 0.1, 0.8); env.wind.shift = 3 * DEG;
  if (job.gust !== undefined) env.wind.gust = job.gust;            // (diagnostics: the puffs, the shifts, the stream)
  if (job.shift !== undefined) env.wind.shift = job.shift * DEG;
  if (job.noTide) env.current.at = (x, z, o = {}) => { o.x = 0; o.z = 0; return o; };
  const [bx, bz] = P.fwd(R.wind.lat, R.wind.lon);
  let shelterDir = w0.deg * DEG; world.updateShelter(shelterDir);
  let shelter0 = world.shelterAt(bx, bz);
  const W = env.weather, tws0 = W.tws0, twd0 = W.twd0;
  W.synoptic = (t) => { const w = wind(t); return { f: w.kn * KT / tws0 / shelter0, d: wrap(w.deg * DEG - twd0) }; };
  // (the sea was raised for the mean wind; the sheltering follows the measured direction: below)
  const pol = stripPolar(R.sim, POLAR_KN);
  const vtAt = (kn) => { let i = 0; while (i < POLAR_KN.length - 1 && kn > (POLAR_KN[i] + POLAR_KN[i + 1]) / 2) i++; return pol.vt[i]; };
  primeClass(C);
  const b = makeBoat(C, { id: 0, name: R.class, sailModel: 'strip', lod: 2 });
  b.auto.trim = true; b.auto.hike = true;
  b.ctrl.reef = startReef(C, meanKn); b.reefPos = b.ctrl.reef | 0;
  const A = K.start.mid, M1 = K.marks[0] || K.finish;
  const psi0 = Math.atan2(M1.x - A.x, -(M1.z - A.z));
  b.reset(A.x, A.z, psi0);
  const u0 = 0.8 * pol.at(w0.kn * KT, Math.abs(wrap(w0.deg * DEG - psi0)) / DEG);
  for (let i = 0; i < 480; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0, world); b.x = A.x; b.z = A.z; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  b.ext = { X: 0, Y: 0, N: 0, K: 0 };
  const D = new Damage(b, { seed: seed * 131 }); b.dmg = D; b.fat = new Fatigue(b);
  const crew = new Crew(), ap = new Autopilot(b);
  let vt = vtAt(w0.kn); ap.helm.targetsUpBsp = vt.up.bsp;
  let targets = { up: vt.up.twa, dn: vt.dn.twa };
  const sim = { boats: [b], world, env };
  // (a finish line's goal: its middle carried 60 m on through the line, away from the last mark, so the autopilot
  // sails across it; aimed at the middle itself it hove to there, a boat length short of the line)
  const finGoal = () => {
    const F = K.finish, P0 = K.marks.length ? K.marks[K.marks.length - 1] : A;
    let nx = -(F.b.z - F.a.z), nz = F.b.x - F.a.x; const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    if (nx * (F.mid.x - P0.x) + nz * (F.mid.z - P0.z) < 0) { nx = -nx; nz = -nz; }
    return { x: F.mid.x + 60 * nx, z: F.mid.z + 60 * nz, label: F.name };
  };
  const farSide = (() => { const F = K.finish; if (F.kind !== 'line') return 0; const g = finGoal(); return Math.sign((F.b.x - F.a.x) * (g.z - F.a.z) - (F.b.z - F.a.z) * (g.x - F.a.x)); })();
  const goals = [...K.marks.map((m) => ({ x: m.x, z: m.z, label: m.name })), K.finish.kind === 'line' ? finGoal() : { x: K.finish.x, z: K.finish.z, label: K.finish.name }];
  // the estimate from the polar alone, through the same marks
  const est = routeRealEstimate({ world, env, tide: V.tide, legs: [A, ...goals], wind, polar: pol.at, shelter0, L, draft: C.draft });
  if (V.tide) V.tide.setTime(0);
  env.tick(0);
  ap.engage(0);
  const out = { id: R.id, cls: R.sim, est: est.t, estDist: est.dist, finished: null, marks: [], tacks: 0, gybes: 0, aground: 0, minUK: Infinity, events: [], capsized: false, nan: false, trace: [] };
  const maxT = job.maxT ?? Math.max(2 * R.results.median, R.results.worst + 1800);
  const rMark = Math.max(2 * L + 5, 20);
  let gi = 0, t = 0, sailed = 0, px = b.x, pz = b.z, side = 0, lx = b.x, lz = b.z;
  for (let i = 0; t < maxT; i++, t += DT) {
    if (i % 12 === 0) { env.focus.x = b.x; env.focus.z = b.z; env.tick(t); }
    if (i % 7200 === 0) {          // each minute: the shelter for the wind's direction now, the autopilot's angles for its speed
      const w = wind(t);
      if (Math.abs(wrap(w.deg * DEG - shelterDir)) > 5 * DEG) { shelterDir = w.deg * DEG; world.updateShelter(shelterDir); shelter0 = world.shelterAt(bx, bz); }
      vt = vtAt(w.kn); targets = { up: vt.up.twa, dn: vt.dn.twa }; ap.helm.targetsUpBsp = vt.up.bsp;
    }
    const G = goals[gi];
    crew.pre(b); crew.begin(b);
    ap.update(DT, t, sim, { target: G, targets });
    crew.end(b, DT);
    if (!ap.engaged) { ap.engage(t); out.events.push({ t: Math.round(t), type: 'ap-off' }); }
    crew.post(b, DT, true);
    const E = b.ext; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    D.pre(DT, E, env, t);
    b.step(DT, env, t, world);
    D.post(DT, { world, env, t, seabed: () => 'sand' });
    b.fat.post(DT, 0);
    if (!Number.isFinite(b.x + b.z + b.psi + b.u)) { out.nan = true; break; }
    for (const ev of D.events.splice(0)) out.events.push({ t: Math.round(t), type: ev.type, msg: ev.msg });
    ap.events.length = 0;
    if (b.aground > 0.05) out.aground += DT;
    if (i % 60 === 0) out.minUK = Math.min(out.minUK, world.depthAt(b.x, b.z) - C.draft);
    if (b.capsized || Math.abs(b.phi) > 85 * DEG) out.capsized = true;
    const twdNow = wind(t).deg * DEG, s = Math.sign(wrap(twdNow - b.psi)) || side;
    if (side && s !== side) { if (Math.abs(wrap(twdNow - b.psi)) < Math.PI / 2) out.tacks++; else out.gybes++; }
    side = s;
    // rounding a mark: within two boat lengths (and 5 m) of it; finishing: across the line, or at the finishing mark
    const last = gi === goals.length - 1;
    if (i % 12 === 0) {
      const p = { x: lx, z: lz }, q = { x: b.x, z: b.z };
      if (last && K.finish.kind === 'line' ? cross(p, q, K.finish.a, K.finish.b, farSide) && t > 300 : Math.hypot(G.x - b.x, G.z - b.z) < rMark) {
        out.marks.push({ name: G.label, t: Math.round(t) });
        if (last) { out.finished = t; break; }
        gi++;
      }
      lx = b.x; lz = b.z;
    }
    if (i % 120 === 0) { sailed += Math.hypot(b.x - px, b.z - pz); px = b.x; pz = b.z; }
    if (i % (120 * 30) === 0) { const c = env.current.at(b.x, b.z, {}); out.trace.push([Math.round(t), Math.round(b.x), Math.round(b.z), Math.round(b.psi / DEG), +(b.u / KT).toFixed(2), +((b.diag.tws || 0) / KT).toFixed(1), Math.round(wrap(twdNow - b.psi) / DEG), ap.mode, gi, +(Math.hypot(c.x, c.z) / KT).toFixed(2)]); }
    if (job.debug && i % 1200 === 0 && t >= job.debug[0] && t <= job.debug[1]) (out.debug ||= []).push({ t: Math.round(t), x: Math.round(b.x), z: Math.round(b.z), psi: Math.round(b.psi / DEG), u: +(b.u / KT).toFixed(1), mode: ap.mode, dest: ap.helm.dest && [Math.round(ap.helm.dest.x), Math.round(ap.helm.dest.z)], route: ap.route && ap.route.map(([x, z]) => [Math.round(x), Math.round(z)]), shoal: ap.helm.shoal && Math.round(ap.helm.shoal.off / DEG), depth: +world.depthAt(b.x, b.z).toFixed(2) });
    if (job.onStep && i % 120 === 0) job.onStep({ b, t, env, ap, world, wind: wind(t), gi });   // (a probe for diagnostics)
    if (D.rig.down || b.sunk) break;
  }
  out.t = t; out.sailed = sailed;
  out.toGo = gi < goals.length ? Math.hypot(goals[gi].x - b.x, goals[gi].z - b.z) : 0;
  out.rigDown = D.rig.down; out.rigWhy = D.rig.why;
  out.wallSec = (performance.now() - t0w) / 1000;
  if (!Number.isFinite(out.minUK)) out.minUK = null;
  return out;
}
