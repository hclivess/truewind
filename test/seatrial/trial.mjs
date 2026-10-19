// One sea trial: a class, a condition, a helmsman. Runs the real game loop for the player's boat headless
// (js/main.js Game.step: the crew through js/crew.js and autoTrim, the autopilot, js/damage.js and js/fatigue.js
// around Boat.step, the environment's wind field and sea) over a scripted short sail, and returns raw metrics.
// The judging against reference ranges is test/seatrial/judge.mjs; the orchestration test/seatrial.mjs.
//
// The script (sim seconds at SCALE 1; QUICK shortens every leg):
//   leave   close reach, TWA 60 on starboard                       25 s
//   beat1   close-hauled (the polar's VMG angle)                    25 s
//   tack1   tack onto port, beat2 on                                30 s
//   tack2   tack back onto starboard, beat3 on                      30 s
//   beam    bear away to a beam reach (TWA 90) and hold the course  45 s
//   broad   broad reach, TWA 145 (kite or gennaker up if she has one and the wind allows)   35 s
//   gybe    gybe onto port at 145                                   25 s
//   heave   drop the kite, round up and heave to                    25 s
// Helmsmen: 'ap' the game's autopilot (js/autopilot.js: its wind vane for the legs, its heave-to at a waypoint),
// 'helm' a scripted competent helmsman (PID on heading, a human's reaction lag and hand speed, the default crew
// trimming), 'probe' the directional-stability probe (settled on a beam reach by the helmsman, then the tiller held
// fixed for 30 s).
import { makeBoat, CLASSES, autoTrim, solvePolar, vmgTargets, wrap, clamp, autoReefFor } from '../../js/physics.js';
import '../../js/sail/sailsim.js';
import { loadBakedPolars, bakedPolarAngle } from '../../js/sail/surrogate.js';
import { Environment, KT, DEG } from '../../js/env.js';
import { VENUES, World } from '../../js/world.js';
import { decodeBathy } from '../../js/bathy.js';
import { Tide } from '../../js/tide.js';
import { Autopilot } from '../../js/autopilot.js';
import { AIHelm, waterTwd } from '../../js/race.js';
import { Crew } from '../../js/crew.js';
import { Damage } from '../../js/damage.js';
import { Fatigue } from '../../js/fatigue.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DT = 1 / 120;
const sq = (x) => x * x;

// ------------------------------------------------------------------ venues
// open: the game's Open Water (no land; the sea fetch-unlimited, duration-limited: js/main.js makeEnv).
// solent: the real chart, bathymetry and harmonic tide (streams and level) at a fixed date and time, sailed in the
// widest deep water of the eastern Solent (the spot with the most sea room: found on the chart), the wind from the
// venue's prevailing south-west, sheltered by the land as the game shelters it, the sea raised over the real fetch.
const VCACHE = {};
// a fixed spring-tide morning (deterministic: the stream at the spot is printed in the report)
export const TIDE_CLOCK = Date.UTC(2026, 5, 10, 9);
export function venue(id) {
  if (VCACHE[id]) return VCACHE[id];
  const v = VENUES.find((x) => x.id === id);
  if (!v) throw new Error('no venue ' + id);
  if (v.open) return (VCACHE[id] = { v, world: new World(v, null), tide: null, x: 0, z: 0, twd: 0 });
  const geo = JSON.parse(readFileSync(`${ROOT}data/venues/${id}.json`));
  const world = new World(v, geo);
  let tide = null;
  if (existsSync(`${ROOT}data/venues/${id}.tide.json`)) {
    tide = new Tide(JSON.parse(readFileSync(`${ROOT}data/venues/${id}.tide.json`)));
    if (v.residual) tide.residual = v.residual;
    tide.still = false;
  }
  const bb = readFileSync(`${ROOT}data/venues/${id}.bathy.bin`);
  world.setBathy(decodeBathy(bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength)), tide);
  // the spot with the most sea room (distance to shore) in water at least 8 m deep at chart datum
  let best = null;
  const R = (v.R || 6000) * 0.9;
  for (let x = -R; x <= R; x += 150) for (let z = -R; z <= R; z += 150) {
    const s = world.sdfAt(x, z); if (!(s > 0)) continue;
    const d = world.chartDepthAt ? world.chartDepthAt(x, z) : world.depthAt(x, z);
    if (!(d > 8)) continue;
    if (!best || s > best.s) best = { x, z, s, d };
  }
  return (VCACHE[id] = { v, world, tide, x: best.x, z: best.z, room: best.s, depth: best.d, twd: (v.wind ?? 225) * DEG });
}

// the environment for a condition, built the way js/main.js makeEnv builds it for the venue
// (opts: clock, the tide's UTC ms at t = 0; at {x, z}, where the fetch and the sea's stream are taken; twd, rad)
export function makeEnv(cond, V, seed, opts = {}) {
  const world = V.world, twd = opts.twd ?? V.twd, twdDeg = twd / DEG, at = opts.at || V;
  const fetchM = world.open ? 60000 : world.fetchAt(at.x, at.z, twd, 6000);
  const fetchKm = world.open ? 2000 : fetchM >= 6000 ? 25 : Math.max(0.4, fetchM / 1000);
  if (!world.open) world.updateShelter(twd);
  const env = new Environment({
    tide: V.tide, tideMode: V.tide ? 'real' : 'steady', tideClock0: opts.clock ?? TIDE_CLOCK,
    tws: cond.tws * KT, twd: twdDeg, gust: cond.gusty ? 0.5 : 0, shift: cond.gusty ? 7 : 0, seed, weather: 'steady',
    fetchKm, swellH: 0, swellT: 6, currentKt: 0, currentDir: 90, hemi: V.v.lat < 0 ? -1 : 1, thermal: null,
    wavesOn: !!cond.sea,
  });
  if (!world.open) {
    const base = env.wind.sample.bind(env.wind);
    env.wind.sample = (x, z, t, o = {}) => { base(x, z, t, o); o.speed *= world.shelterAt(x, z); return o; };
    env.waves.scaleFn = (x, z) => clamp(world.sdfAt(x, z) / (env.waves.coastal ? 12 : 60), 0.08, 1);
    env.waves.buildDepthField(world);
  }
  env.focus = { x: at.x, z: at.z };
  env.tick(0);
  return env;
}

// the reef the crew ties in at the dock (js/main.js startReef)
export function startReef(C, kn) {
  const max = (C.sails.find((s) => s.key === 'main') || {}).reefs || 0, R = C.reefWind || [17, 24];
  return Math.min(max, kn > R[1] ? 2 : kn > R[0] ? 1 : 0);
}
// a seamanlike crew does not set a kite in a blow (est.: most crews drop or never hoist above ~22 kn true for a
// coastal sail; racing crews push to ~25)
export const KITE_MAX_KN = 22;

// The first Boat of a class built in a process is not the same as every later one: its inertias (massProps) are
// computed before its HullHydro has calibrated the class's hull (js/physics.js Boat constructor; js/hull.js
// calibrate caches C._fullness / C._depthScale on the class), so the dinghy's zG comes out 0.437 m against 0.462,
// and a trial's track diverges from the same trial run second. The game builds one for its sail benchmark before the
// player's boat (js/main.js sailLevelFor): so here too, once per class, a throwaway boat first, and every trial is
// the same whatever ran before it in its worker.
const PRIMED = new Set();
export function primeClass(C) { if (!PRIMED.has(C.id)) { PRIMED.add(C.id); makeBoat(C, { sailModel: 'strip', lod: 2 }); } }

// ------------------------------------------------------------------ the competent helmsman
// PID on heading through a human's limits: reaction lag 0.25 s (what he sees), hands moving the tiller or wheel at
// most 1.5 of its travel per second, no more than 60% of the helm on a straight leg and 85% in a manoeuvre (up to
// 90% once she is 25 deg off where he wants her), an
// integral term only near the course (no wind-up through a tack), and a little more helm when she is slow (he feels
// her go soft). Gains in helm travel per radian: 10 deg of heading error -> a quarter of the helm.
export class Helmsman {
  constructor(b, uRef) {
    this.b = b; this.uRef = Math.max(1, uRef); this.I = 0; this.out = 0;
    this.lag = Math.round(0.25 / DT); this.buf = []; this.Kp = 1.4; this.Kd = 1.1; this.Ki = 0.25; this.rate = 1.5;
  }
  step(dt, target, maxCmd) {
    const b = this.b;
    this.buf.push([b.psi, b.r]); if (this.buf.length > this.lag) this.buf.shift();
    const [psi, r] = this.buf[0];
    const err = wrap(target - psi);
    if (Math.abs(err) < 10 * DEG) this.I = clamp(this.I + this.Ki * err * dt, -0.3, 0.3); else this.I *= Math.exp(-dt / 2);
    const k = clamp(Math.sqrt(this.uRef / Math.max(0.3, b.u)), 0.75, 1.6);
    // (more helm when she is getting away from him: up to 90% of the travel at 25 deg off)
    const lim = Math.max(maxCmd, Math.min(0.9, maxCmd + (0.9 - maxCmd) * (Math.abs(err) - 10 * DEG) / (15 * DEG)));
    const cmd = clamp(k * (this.Kp * err - this.Kd * r) + this.I, -lim, lim);
    this.out += clamp(cmd - this.out, -this.rate * dt, this.rate * dt);
    b.ctrl.helm = this.out;
  }
}

// ------------------------------------------------------------------ the script
const LEGS = [
  ['leave', 25], ['beat1', 25], ['tack1', 30], ['tack2', 30], ['beam', 45], ['broad', 35], ['gybe', 25], ['heave', 25],
];

// the true wind speed over the water (as waterTwd: the stream's own wind taken out)
function waterTws(b) {
  const d = b.diag, tw = d.twd ?? 0, s = d.tws ?? 0;
  if (b.vgx === undefined || !s) return s || null;
  const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
  const cx = b.vgx - (b.u * fx + b.v * sx), cz = b.vgz - (b.u * fz + b.v * sz);
  return Math.hypot(Math.sin(tw) * s + cx, Math.cos(tw) * s - cz);
}
// angle-aware low-pass of the wind direction
function lpAngle(prev, a, k) { return prev === null ? a : prev + wrap(a - prev) * k; }

export async function runTrial(job) {
  const { cls, cond, mode } = job;
  const scale = job.scale ?? 1, sails = job.sails ?? 'cloth', lod = job.lod ?? 1;
  const t0wall = performance.now();
  await loadBakedPolars(cls);
  const C = CLASSES[cls];
  const V = venue(cond.venue);
  const env = makeEnv(cond, V, job.seed);
  const world = V.world, twd0 = V.twd;
  const tws = cond.tws * KT;
  // the targets the game gives the autopilot (js/main.js: the polar for the wind of the session)
  const polar = solvePolar(cls, tws), vt = vmgTargets(polar), up = vt.up.twa * DEG;
  const polarBsp = (twsMS, twaDeg) => { const p = bakedPolarAngle(cls, twsMS, twaDeg); return p ? p.bsp : null; };
  primeClass(C);
  const b = makeBoat(C, { id: 0, name: 'Trial', sailModel: sails, lod: sails === 'strip' ? 2 : lod });
  b.auto.trim = true; b.auto.hike = true;
  const reef0 = C.autoReef ? autoReefFor(C, cond.tws, 60 * DEG) : startReef(C, cond.tws);
  b.ctrl.reef = reef0;
  const probe = mode === 'probe';
  const twa0 = (probe ? 90 : 60) * DEG;               // starboard tack: the wind over the starboard side, twa > 0
  const psi0 = twd0 - twa0;
  b.reset(V.x, V.z, psi0);
  b.reefPos = b.ctrl.reef | 0;
  // the crew sets the sails for the heading before handing over (js/main.js presetTrim), here sailing along at 90% of
  // the polar's speed (a flying start, as test/autopilot.mjs)
  const u0 = 0.9 * (polarBsp(tws, twa0 / DEG) ?? 2);
  for (let i = 0; i < 480; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0, world); b.x = V.x; b.z = V.z; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.stay = b.ctrl.stay; b.lines.lazy = b.ctrl.lazy = 1;
  // what js/gear.js attaches to every boat
  b.ext = { X: 0, Y: 0, N: 0, K: 0 };
  const D = new Damage(b, { seed: job.seed * 131, mode: 'realistic' });
  b.dmg = D; b.fat = new Fatigue(b);
  const crew = new Crew();
  const ap = new Autopilot(b); ap.helm.targetsUpBsp = vt.up.bsp;
  const sim = { boats: [b], world, env };
  const targets = { up: vt.up.twa, dn: vt.dn.twa };
  const helm = new Helmsman(b, vt.up.bsp);
  const rescue = new AIHelm(b, { seed: 0, skill: 1, startFrac: 0.5 }); rescue.targetsUpBsp = vt.up.bsp; rescue.upAngle = up;
  const kite = !!b.sailBy.gennaker && cond.tws <= KITE_MAX_KN;
  // the turn rate a competent crew asks of her in a tack or gybe (est.: a dinghy ~35 deg/s, a 24-footer ~25, a
  // 40-footer ~18, a 40 m yacht ~10; the boat's own response limits it further)
  const turnRate = clamp(36 / Math.sqrt(C.loa / 4), 6, 40) * DEG;

  const legs = probe ? [['settle', 25], ['fixed', 30]] : LEGS;
  const out = {
    cls, cond: cond.id, mode, seed: job.seed, sails, lod: sails === 'strip' ? 2 : lod, name: C.name,
    loa: C.loa, targetHeel: C.targetHeel / DEG, canCapsize: !!C.canCapsize, multihull: !!C.multihull, hasKite: !!b.sailBy.gennaker,
    upTwa: vt.up.twa, upBsp: vt.up.bsp / KT, upVmg: vt.up.vmg / KT, reef0, kite, Hs: env.wavesOn ? env.waves.Hs : 0, Tp: env.wavesOn ? env.waves.Tp : 0,
    legs: {}, tacks: [], events: [], nan: null, capsized: false, maxHeel: 0, aground: 0,
  };
  if (V.tide) { const c = env.current.at(V.x, V.z, {}); out.stream = Math.hypot(c.x, c.z) / KT; out.room = V.room; out.depth = V.depth; }

  // ---- online accumulators
  const ring = (n) => ({ a: new Float64Array(n), i: 0, n: 0, s: 0 });
  const rpush = (R, v) => { if (R.n === R.a.length) R.s -= R.a[R.i]; else R.n++; R.a[R.i] = v; R.s += v; R.i = (R.i + 1) % R.a.length; return R.s / R.n; };
  const loadKeys = ['mainLoad', 'jibLoad'];
  const L = {};
  for (const k of [...loadKeys, 'rig']) L[k] = { ring: ring(120), prev: [null, null], ext: 0, steps: 0, spike: 0, spikeT: 0, mean: 0, n: 0 };
  const struct = { maxR: 0, worstPart: null, worstT: 0, sailR: 0, sailWorst: null, boomR: 0, fatigueD: 0, partsPeak: {} };
  let twdS = null, side = 1, tacking = null;
  const S = (D.sails);
  let t = 0, step = 0, legIdx = -1, legT = 0, leg = null, legData = null;
  let target = psi0, desiredTwa = twa0, ramp = null, fixedHelm = null;
  let prevSign = Math.sign(wrap(twd0 - b.psi)) || 1;
  let manoeuvre = null;

  const startLeg = (k) => {
    legIdx = k; legT = 0; leg = legs[k][0];
    legData = out.legs[leg] = { t0: t, dur: legs[k][1] * scale, samples: [] };
    // (the tack the script is on: starboard from the start, changed only by its own tacks and gybe; read off the
    // heading instead, a boat swinging after a tack was sent back through the wind by the next leg)
    // If she is not on it (a tack that failed and fell back, or one she made unbidden) the script carries on from the
    // tack she is on, as a crew would: a failed tack is scored once, on its own leg, not again in every leg after it
    // (her side read off the wind angle held over the last 3 s, clear of a swing through the wind)
    if (twaHist.length >= 30) { let m = 0; for (let i = twaHist.length - 30; i < twaHist.length; i++) m += twaHist[i]; m /= 30; if (Math.abs(m) > 20 * DEG && Math.sign(m) !== side) { out.events.push({ t: +t.toFixed(1), type: 'script-resync', msg: `on the other tack at the start of ${leg}: the script carries on from it`, leg }); side = Math.sign(m); } }
    const sgn = side;
    // the angle this leg sails, signed by tack (+ starboard)
    const A = { leave: 60 * DEG, beat1: up, tack1: up, tack2: up, beam: 90 * DEG, broad: 145 * DEG, gybe: 145 * DEG, heave: 50 * DEG, settle: 90 * DEG, fixed: 90 * DEG }[leg];
    const newSide = leg === 'tack1' || leg === 'tack2' || leg === 'gybe' ? -sgn : sgn;
    desiredTwa = newSide * A; side = newSide;
    if (leg === 'tack1' || leg === 'tack2' || leg === 'gybe') {
      manoeuvre = { kind: leg === 'gybe' ? 'gybe' : 'tack', leg, t0: t, from: sgn, crossed: null, end: null, uPre: legData.uPre = meanRecent(5), uMin: Infinity, minTwa: Infinity, ironsT: 0 };
      out.tacks.push(manoeuvre);
    }
    if (mode === 'ap') {
      if (leg === 'heave') ap.heaveTarget = { x: b.x + Math.sin(b.psi) * 2, z: b.z - Math.cos(b.psi) * 2, label: 'Waypoint' };
      else ap.vaneTwa = desiredTwa;
    } else {
      ramp = { from: b.psi };
      if (leg === 'broad' && kite) b.ctrl.gen = true;
      if (leg === 'heave' && b.sailBy.gennaker) b.ctrl.gen = false;
      if (leg === 'fixed') {
        let s = 0; for (const v of helmHist) s += v; fixedHelm = s / Math.max(1, helmHist.length);
      }
    }
  };
  const uHist = []; const helmHist = []; const twaHist = [];
  const meanRecent = (secs) => { const n = Math.min(uHist.length, Math.round(secs * 10)); if (!n) return b.u; let s = 0; for (let i = uHist.length - n; i < uHist.length; i++) s += uHist[i]; return s / n; };

  if (mode === 'ap') ap.engage(0);
  startLeg(0);
  const total = legs.reduce((s, l) => s + l[1] * scale, 0);
  const maxSteps = Math.round(total / DT);
  for (step = 0; step < maxSteps; step++, t += DT) {
    if (legT >= legData.dur && legIdx < legs.length - 1) startLeg(legIdx + 1);
    if (step % 12 === 0) env.tick(t);
    const d = b.diag;
    // the wind as the boat sails in it: over the water (the tide's stream taken out, js/race.js waterTwd), smoothed
    // over ~6 s as a helmsman reads it off the telltales and the instruments
    const twW = d.twd === undefined ? twd0 : waterTwd(b), twsW = waterTws(b);
    twdS = lpAngle(twdS, twW, clamp(DT / 6, 0, 1));
    // ---- the helmsman and the crew (js/main.js Game.step order)
    crew.pre(b);
    if (mode === 'ap') {
      ap.helm.noTrim = false;
      crew.begin(b);
      ap.update(DT, t, sim, { target: leg === 'heave' ? ap.heaveTarget : null, targets });
      crew.end(b, DT);
      if (!ap.engaged) { out.events.push({ t, type: 'ap-off', msg: 'autopilot disengaged' }); ap.engage(t); ap.vaneTwa = desiredTwa; }
    } else {
      crew.begin(b); autoTrim(b, DT, 0, true); crew.end(b, DT);
      if (leg === 'heave') {
        // round up and heave to: helm to luff to ~50 deg, every sheet eased (js/autopilot.js heaveTo's seamanship)
        const c = b.ctrl; c.main = 1; if (b.sailBy.jib) c.jib = 1; if (b.sailBy.stay) c.stay = 1; if ('mizzen' in c) c.mizzen = 1; c.gen = false;
      }
      if (leg === 'fixed') b.ctrl.helm = fixedHelm;
      else {
        const goal = twdS - desiredTwa;
        let tgt = goal, maxCmd = 0.6;
        if (ramp) {
          const e = wrap(goal - ramp.from), stepA = (manoeuvre && manoeuvre.leg === leg ? turnRate : 8 * DEG) * DT;
          ramp.from = Math.abs(e) <= stepA ? goal : ramp.from + Math.sign(e) * stepA;
          tgt = ramp.from; if (ramp.from === goal) ramp = null;
          maxCmd = manoeuvre && manoeuvre.leg === leg ? 0.85 : 0.7;
        }
        // stuck in irons (or stopped short of the wind): the AI crew's recovery (backing the jib, bearing away)
        if (manoeuvre && manoeuvre.leg === leg && manoeuvre.crossed === null && t - manoeuvre.t0 > 15) { rescue.steer(DT, goal); manoeuvre.rescued = true; }
        else helm.step(DT, tgt, maxCmd);
        helmHist.push(b.ctrl.helm); if (helmHist.length > 600) helmHist.shift();
      }
    }
    crew.post(b, DT, mode === 'ap');
    // ---- js/gear.js preStep, the physics, postStep
    const E = b.ext; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    D.pre(DT, E, env, t);
    b.step(DT, env, t, world);
    D.post(DT, { world, env, t, seabed: () => 'sand' });
    b.fat.post(DT, 0);
    for (const ev of D.events.splice(0)) out.events.push({ t: +t.toFixed(1), type: ev.type, msg: ev.msg, bad: ev.bad, leg });
    for (const ev of ap.events.splice(0)) if (ev.kind === 'reef' || ev.kind === 'gen') out.events.push({ t: +t.toFixed(1), type: 'ap-' + ev.kind, msg: ev.text.slice(0, 90), leg });
    legT += DT;
    // ---- NaN
    if (![b.u, b.v, b.r, b.psi, b.phi, b.x, b.z, b.heave, b.pitch, b.p].every(Number.isFinite)) { out.nan = { t, leg }; break; }
    // ---- whole-run
    const heelAbs = Math.abs(b.phi) / DEG;
    if (heelAbs > out.maxHeel) out.maxHeel = heelAbs;
    if (b.capsized || heelAbs > 85) { if (!out.capsized) out.events.push({ t, type: 'capsize', msg: `capsized/knocked down (heel ${heelAbs.toFixed(0)} deg)`, leg }); out.capsized = true; }
    if (b.aground > 0.05) out.aground += DT;
    // structure: every rig part's load / its strength (js/damage.js parts), the sails' cloth, the boom
    if (D.age > 3) {
      for (const k in D.parts) {
        const p = D.parts[k]; if (!(p.r >= 0)) continue;
        if (!(struct.partsPeak[k] >= p.r)) struct.partsPeak[k] = p.r;
        if (p.r > struct.maxR) { struct.maxR = p.r; struct.worstPart = k; struct.worstT = t; struct.worstLeg = leg; }
        if (p.D > struct.fatigueD) struct.fatigueD = p.D;
      }
      for (const k in S) if (S[k].ratio > struct.sailR) { struct.sailR = S[k].ratio; struct.sailWorst = k; struct.sailLeg = leg; }
    }
    // smoothness: spikes against the 1 s mean and local extrema per second (chatter) in the sheet loads and the
    // worst rig part's load
    const sig = { mainLoad: d.rig ? d.rig.mainLoad : 0, jibLoad: d.rig ? d.rig.jibLoad : 0, rig: D.age > 3 ? D.maxR : 0 };
    for (const k in sig) {
      const v = sig[k]; if (!Number.isFinite(v)) continue;
      const A = L[k], m = rpush(A.ring, Math.abs(v));
      A.mean += Math.abs(v); A.n++;
      const [p1, p2] = A.prev;
      if (p1 !== null && p2 !== null && m > 0) {
        const d1 = v - p1, d0 = p1 - p2;
        if (d1 * d0 < 0 && Math.min(Math.abs(d1), Math.abs(d0)) > 0.002 * m) A.ext++;
        A.steps++;
        // (against the 1 s mean, once that mean is a working load: a quarter of the run's mean so far, and past the
        // damage model's first seconds; a rig part only when it carries 15% of its strength)
        if (A.ring.n === A.ring.a.length && D.age > 5 && m > 0.25 * A.mean / A.n && Math.abs(v) > 0.5 * A.mean / A.n) { const sp = Math.abs(v) / m; if (k !== 'rig' || Math.abs(v) > 0.15) { if (sp > A.spike) { A.spike = sp; A.spikeT = +t.toFixed(1); A.spikeLeg = leg; } const bl = A.byLeg || (A.byLeg = {}); if (!(bl[leg] >= sp)) bl[leg] = +sp.toFixed(2); } }
      }
      A.prev = [v, p1];
    }
    // ---- the manoeuvre
    const twaNow = wrap((twdS ?? twd0) - b.psi), sNow = Math.sign(twaNow) || prevSign;
    if (manoeuvre && manoeuvre.end === null) {
      const M = manoeuvre;
      M.uMin = Math.min(M.uMin, b.u); M.minTwa = Math.min(M.minTwa, Math.abs(twaNow));
      if (M.kind === 'tack' && b.u < 0.3 && Math.abs(twaNow) < 35 * DEG) M.ironsT += DT;
      if (M.crossed === null && sNow !== M.from && (M.kind === 'tack' ? Math.abs(twaNow) < 90 * DEG : Math.abs(twaNow) > 90 * DEG)) M.crossed = t;
      const settled = M.kind === 'tack' ? Math.abs(twaNow) > Math.abs(desiredTwa) - 5 * DEG : Math.abs(twaNow) < Math.abs(desiredTwa) + 8 * DEG;
      if (M.crossed !== null && sNow !== M.from && settled) { M.end = t; M.turnTime = t - M.t0; }
    }
    if (manoeuvre && manoeuvre.end !== null && manoeuvre.recover === undefined && b.u > 0.9 * manoeuvre.uPre) manoeuvre.recover = t - manoeuvre.t0;
    if (sNow !== prevSign && !(manoeuvre && manoeuvre.leg === leg)) out.events.push({ t: +t.toFixed(1), type: Math.abs(twaNow) < 90 * DEG ? 'unplanned-tack' : 'unplanned-gybe', msg: `crossed the wind unbidden on ${leg}`, leg });
    prevSign = sNow;
    // ---- 10 Hz samples for the legs
    if (step % 12 === 0) {
      uHist.push(b.u); if (uHist.length > 600) uHist.shift();
      twaHist.push(wrap((twdS ?? twd0) - b.psi)); if (twaHist.length > 60) twaHist.shift();
      const lee = -Math.sign(d.awaMid ?? 0) || 1;
      legData.samples.push([
        +(legT).toFixed(2), b.u, wrap(b.psi - ((twdS ?? twd0) - desiredTwa)), twaNow, b.phi * lee, b.pitch, b.heave, b.rudder * -Math.sign(twaNow),
        twsW ?? tws, b.p, b.r, b.ctrl.helm, b.reefPos ?? 0, b.genDeploy ?? 0,
      ]);
    }
  }
  if (manoeuvre && manoeuvre.end === null) manoeuvre.turnTime = null;
  out.struct = struct;
  out.smooth = {};
  for (const k in L) { const A = L[k]; out.smooth[k] = { meanLoad: A.n ? A.mean / A.n : 0, extremaPerS: A.steps ? A.ext / (A.steps * DT) : 0, spike: A.spike, spikeT: A.spikeT, spikeLeg: A.spikeLeg, byLeg: A.byLeg || {} }; }
  out.rigDown = D.rig.down; out.rigWhy = D.rig.why; out.boomBroken = !!D.boomBroken;
  out.sailTorn = Object.entries(S).filter(([, s]) => s.tear > 0).map(([k, s]) => ({ k, tear: s.tear, blown: s.blown }));
  out.wallSec = (performance.now() - t0wall) / 1000;
  out.simSec = t;
  out.polarAt = {};
  // the polar at each leg's sailed angle and wind: the speed check's reference
  summarise(out, polarBsp, C);
  for (const k in out.legs) delete out.legs[k].samples;
  return out;
}

// ------------------------------------------------------------------ leg statistics
const COL = { t: 0, u: 1, herr: 2, twa: 3, heel: 4, pitch: 5, heave: 6, helm: 7, tws: 8, p: 9, r: 10, ctrl: 11, reef: 12, gen: 13 };
function stats(xs) {
  const n = xs.length; if (!n) return { n: 0 };
  let s = 0, s2 = 0, mx = -Infinity, mn = Infinity;
  for (const x of xs) { s += x; s2 += x * x; if (x > mx) mx = x; if (x < mn) mn = x; }
  const m = s / n;
  return { n, mean: m, rms: Math.sqrt(s2 / n), sd: Math.sqrt(Math.max(0, s2 / n - m * m)), max: mx, min: mn };
}
// oscillation in a heading-error trace (10 Hz): detrended, its zero crossings (period), the mean |peak| (amplitude)
// and the autocorrelation's first peak past its first zero (a limit cycle: a regular zig-zag, not random yaw)
export function oscillation(xs, hz = 10) {
  const n = xs.length; if (n < 50) return null;
  let st = 0, sx = 0, stt = 0, stx = 0;
  for (let i = 0; i < n; i++) { st += i; sx += xs[i]; stt += i * i; stx += i * xs[i]; }
  const sl = (n * stx - st * sx) / (n * stt - st * st), ic = (sx - sl * st) / n;
  const y = xs.map((x, i) => x - (ic + sl * i));
  const zc = []; for (let i = 1; i < n; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) zc.push(i);
  const period = zc.length >= 3 ? 2 * (zc[zc.length - 1] - zc[0]) / (zc.length - 1) / hz : null;
  const peaks = []; for (let k = 1; k < zc.length; k++) { let m = 0; for (let i = zc[k - 1]; i < zc[k]; i++) m = Math.max(m, Math.abs(y[i])); peaks.push(m); }
  const amp = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : 0;
  let v0 = 0; for (const v of y) v0 += v * v; v0 /= n;
  let ac = null, acLag = null, pastZero = false, prev = 1;
  for (let lag = 1; lag < Math.min(n / 2, 30 * hz); lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += y[i] * y[i + lag];
    const r = v0 > 0 ? s / (n - lag) / v0 : 0;
    if (r < 0) pastZero = true;
    if (pastZero && r < prev && prev > 0 && ac === null && lag > 1.5 * hz) { ac = prev; acLag = (lag - 1) / hz; break; }
    prev = r;
  }
  return { period, amp, ac, acLag, crossings: zc.length };
}
function summarise(out, polarBsp, C) {
  const DEGc = 180 / Math.PI;
  for (const [name, L] of Object.entries(out.legs)) {
    const S = L.samples; if (!S.length) continue;
    // the steady part of a leg: past its first 10 s (40% for a short QUICK leg), the manoeuvre legs past their manoeuvre
    const man = out.tacks.find((m) => m.leg === name);
    const skip = Math.min(10, 0.4 * L.dur) + (man && man.end ? man.end - man.t0 : 0);
    const st = S.filter((r) => r[COL.t] >= skip);
    const col = (c, rows = st) => rows.map((r) => r[c]);
    const twaS = stats(col(COL.twa).map(Math.abs)), uS = stats(col(COL.u)), twsS = stats(col(COL.tws));
    const heel = col(COL.heel).map((x) => x * DEGc);
    // heel held for 5 s (a 50-sample running mean) beyond target + 10 deg: time
    let over10 = 0, over5 = 0; const w = 50;
    for (let i = w; i <= heel.length; i++) { let s = 0; for (let j = i - w; j < i; j++) s += heel[j]; const m = s / w; if (m > out.targetHeel + 10) over10 += 0.1; if (m > out.targetHeel + 5) over5 += 0.1; }
    const he = col(COL.herr).map((x) => x * DEGc);
    const pol = twaS.n && twsS.n ? polarBsp(twsS.mean, twaS.mean / DEG) : null;
    let vmg = null; if (st.length) { let s = 0; for (const r of st) s += r[COL.u] * Math.cos(r[COL.twa]); vmg = s / st.length; }
    L.st = {
      n: st.length, u: uS.mean / KT, twa: twaS.mean / DEG, tws: twsS.mean / KT, polar: pol ? pol / KT : null, vmg: vmg !== null ? vmg / KT : null,
      heel: stats(heel), over10, over5, herr: stats(he), osc: oscillation(he),
      roll: stats(col(COL.heel).map((x) => x * DEGc)).sd, pitch: stats(col(COL.pitch).map((x) => x * DEGc)).sd, heave: stats(col(COL.heave)).sd,
      helm: stats(col(COL.helm).map((x) => x * DEGc)), yawRate: stats(col(COL.r).map((x) => x * DEGc)).rms,
      uEnd: S.length ? S[S.length - 1][COL.u] / KT : null, uStart: S[0][COL.u] / KT, reef: S[S.length - 1][COL.reef], gen: stats(col(COL.gen)).mean,
    };
    if (name === 'fixed') {
      // the probe: heading change from the moment the helm was fixed, in deg, + = luffing (TWA falling)
      const twa0 = Math.abs(S[0][COL.twa]);
      const at = (sec) => { const r = S.find((q) => q[COL.t] >= sec) || S[S.length - 1]; return (twa0 - Math.abs(r[COL.twa])) * DEGc; };
      let maxRate = 0; for (const r of S) maxRate = Math.max(maxRate, Math.abs(r[COL.r]) * DEGc);
      L.probe = { d5: at(5), d10: at(10), d20: at(20), d30: at(S[S.length - 1][COL.t]), maxRate, helm: S[0][COL.ctrl] };
    }
  }
}
