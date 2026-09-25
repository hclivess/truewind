// Race management (windward-leeward course, start sequence, OCS, roundings, finish), free-sail
// waypoints, and AI crews that sail the same physics with a helm + tactician model.
import { DEG, KT } from './env.js';
import { autoTrim, wrap, clamp, lerp } from './physics.js';

export const LEGS = ['Start', 'Windward mark', 'Leeward gate', 'Windward mark', 'Finish'];

export class Course {
  constructor(world, windDir, opts = {}) {
    this.windDir = windDir;
    const Lwant = opts.length ?? 800;
    const spot = world ? world.findCourse(windDir, Lwant) : { x: 0, z: 0, len: Lwant };
    const L = clamp(Math.min(Lwant, spot.len ?? Lwant), 250, Lwant);
    this.L = L;
    const ux = Math.sin(windDir), uz = -Math.cos(windDir);  // unit vector pointing upwind
    const rx = -uz, rz = ux;                                 // to the right when facing upwind
    this.ux = ux; this.uz = uz; this.rx = rx; this.rz = rz;
    const cx = spot.x, cz = spot.z;
    const half = (opts.lineLength ?? 120) / 2;
    this.origin = { x: cx, z: cz };
    this.committee = { x: cx + rx * half, z: cz + rz * half, kind: 'committee', heading: Math.atan2(-rz, rx) + Math.PI / 2 };
    this.pin = { x: cx - rx * half, z: cz - rz * half, kind: 'pin' };
    this.windward = { x: cx + ux * L, z: cz + uz * L, kind: 'mark', name: 'W' };
    const gOff = L * 0.1, gHalf = 28;
    this.gateL = { x: cx + ux * gOff - rx * gHalf, z: cz + uz * gOff - rz * gHalf, kind: 'mark', name: 'G-P', color: 0xffc21a };
    this.gateR = { x: cx + ux * gOff + rx * gHalf, z: cz + uz * gOff + rz * gHalf, kind: 'mark', name: 'G-S', color: 0xffc21a };
    this.laps = opts.laps ?? 1;
    // leg list: start, then (W, gate) * laps with the last gate replaced by the finish
    this.legs = [{ type: 'start' }];
    for (let i = 0; i < this.laps; i++) {
      this.legs.push({ type: 'mark', mark: this.windward, name: 'Windward mark' });
      this.legs.push(i === this.laps - 1 ? { type: 'finish', name: 'Finish' } : { type: 'gate', name: 'Leeward gate' });
    }
  }
  marks() { return [this.pin, this.windward, this.gateL, this.gateR]; }
  // wind-frame coords relative to a point: a = upwind distance, c = distance to the right
  frame(px, pz, ox, oz) { const dx = px - ox, dz = pz - oz; return [dx * this.ux + dz * this.uz, dx * this.rx + dz * this.rz]; }
  target(leg, boat) {
    if (leg.type === 'start') return { x: (this.pin.x + this.committee.x) / 2, z: (this.pin.z + this.committee.z) / 2 };
    if (leg.type === 'mark') return { x: leg.mark.x, z: leg.mark.z };
    if (leg.type === 'gate') {
      // pick the nearer / favoured gate mark
      const dl = Math.hypot(boat.x - this.gateL.x, boat.z - this.gateL.z), dr = Math.hypot(boat.x - this.gateR.x, boat.z - this.gateR.z);
      return dl < dr ? { x: (this.gateL.x * 3 + this.gateR.x) / 4, z: (this.gateL.z * 3 + this.gateR.z) / 4 } : { x: (this.gateL.x + this.gateR.x * 3) / 4, z: (this.gateL.z + this.gateR.z * 3) / 4 };
    }
    return { x: (this.pin.x + this.committee.x) / 2, z: (this.pin.z + this.committee.z) / 2 };
  }
}

// Per-boat race progress
export class Racer {
  constructor(boat) {
    this.boat = boat; this.leg = 0; this.ocs = false; this.started = false; this.finished = false;
    this.finishTime = null; this.prev = null; this.belowSeen = false; this.penalty = 0; this.touches = 0;
  }
}

function segCross(p0, p1, a, b) {
  // does segment p0->p1 cross segment a->b? returns t along a->b or -1
  const d1x = p1.x - p0.x, d1z = p1.z - p0.z, d2x = b.x - a.x, d2z = b.z - a.z;
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return -1;
  const s = ((a.x - p0.x) * d2z - (a.z - p0.z) * d2x) / den;
  const u = ((a.x - p0.x) * d1z - (a.z - p0.z) * d1x) / den;
  return s >= 0 && s <= 1 && u >= 0 && u <= 1 ? u : -1;
}

export class Race {
  constructor(course, boats, opts = {}) {
    this.course = course;
    this.racers = boats.map(b => new Racer(b));
    this.startIn = opts.countdown ?? 120; // seconds to gun at t=0
    this.t = 0;
    this.gun = this.startIn;
    this.events = [];
    this.signals = new Set();
  }
  get clock() { return this.t - this.gun; } // negative before the start

  update(dt) {
    this.t += dt;
    const C = this.course;
    const clock = this.clock;
    // sound signals: 5? we use warning at -60 (or full), prep -30? (scaled), 1-minute, start
    for (const s of [-60, -30, -10, 0]) {
      if (clock >= s && !this.signals.has(s) && this.gun >= -s) { this.signals.add(s); this.events.push({ type: 'signal', s }); }
    }
    for (const r of this.racers) {
      const b = r.boat;
      const cur = { x: b.x, z: b.z };
      if (!r.prev) { r.prev = cur; continue; }
      const leg = C.legs[r.leg];
      if (r.finished) { r.prev = cur; continue; }
      if (leg.type === 'start') {
        const [a] = C.frame(b.x, b.z, C.pin.x, C.pin.z);
        const [aC] = C.frame(b.x, b.z, C.committee.x, C.committee.z);
        const lineA = (a + aC) / 2;
        if (clock < 0) { r.ocs = false; }
        else {
          if (Math.abs(clock) < 1e-6 || (clock > 0 && clock - dt <= 0)) {
            if (lineA > 0.5) { r.ocs = true; this.events.push({ type: 'ocs', boat: b }); }
          }
          if (r.ocs && lineA < -1) { r.ocs = false; r.cleared = true; this.events.push({ type: 'cleared', boat: b }); }
          if (!r.ocs && segCross(r.prev, cur, C.pin, C.committee) >= 0) {
            const [ap] = C.frame(r.prev.x, r.prev.z, C.pin.x, C.pin.z);
            if (a > ap) { r.leg++; r.started = true; r.startTime = clock; this.events.push({ type: 'started', boat: b, t: clock }); }
          }
        }
      } else if (leg.type === 'mark') {
        const m = leg.mark;
        const [a0, c0] = C.frame(r.prev.x, r.prev.z, m.x, m.z);
        const [a1, c1] = C.frame(b.x, b.z, m.x, m.z);
        if (a1 < 0) r.belowSeen = true;
        // leave to port: cross the upwind ray from right to left
        if (r.belowSeen && a1 > 0 && c0 >= 0 && c1 < 0 && Math.hypot(a1, c1) < 90) {
          r.leg++; r.belowSeen = false; this.events.push({ type: 'rounded', boat: b, name: leg.name, t: clock });
        }
      } else if (leg.type === 'gate') {
        if (segCross(r.prev, cur, C.gateL, C.gateR) >= 0) {
          const [ap] = C.frame(r.prev.x, r.prev.z, C.gateL.x, C.gateL.z);
          const [a1] = C.frame(b.x, b.z, C.gateL.x, C.gateL.z);
          if (a1 < ap) { r.leg++; this.events.push({ type: 'rounded', boat: b, name: 'Leeward gate', t: clock }); }
        }
      } else if (leg.type === 'finish') {
        if (segCross(r.prev, cur, C.pin, C.committee) >= 0) {
          const [ap] = C.frame(r.prev.x, r.prev.z, C.pin.x, C.pin.z);
          const [a1] = C.frame(b.x, b.z, C.pin.x, C.pin.z);
          if (a1 < ap) {
            r.finished = true; r.finishTime = clock + r.penalty;
            r.place = this.racers.filter(q => q.finished).length;
            this.events.push({ type: 'finished', boat: b, t: r.finishTime, place: r.place });
          }
        }
      }
      r.prev = cur;
    }
  }

  standings() {
    const C = this.course;
    const score = (r) => {
      if (r.finished) return 1e9 - r.finishTime;
      const tgt = C.target(C.legs[r.leg], r.boat);
      return r.leg * 1e5 - Math.hypot(r.boat.x - tgt.x, r.boat.z - tgt.z);
    };
    return this.racers.slice().sort((a, b) => score(b) - score(a));
  }
}

// ---------------------------------------------------------------------------------------------
// AI crew: tactician picks the mode (beat / reach / run / pre-start), helm steers to a target TWA or
// heading with a PD controller on yaw, trimmers run autoTrim. They read the wind they actually feel.
export class AIHelm {
  constructor(boat, personality = {}) {
    this.b = boat;
    this.skill = personality.skill ?? 0.9;
    this.startFrac = personality.startFrac ?? Math.random();
    this.lastTack = -100;
    this.overstand = (2 + Math.random() * 4) * DEG;
    this.tackMode = 0;
    this.twdMean = null;
    this.hold = null;
    this.bias = (Math.random() - 0.5) * 2;
  }
  update(dt, t, sim, racer, course, targets) {
    const b = this.b, d = b.diag;
    const twd = d.twd ?? 0;
    // capsized: ease everything and stand on the board / hang on the righting line
    if (b.capsized) { this.capT = (this.capT || 0) + dt; b.ctrl.main = 1; b.ctrl.jib = 1; if (this.capT > 5) b.righting = true; return; }
    this.capT = 0;
    this.twdMean = this.twdMean === null ? twd : this.twdMean + wrap(twd - this.twdMean) * dt / 90;
    const up = (targets?.up ?? 42) * DEG, dn = (targets?.dn ?? 145) * DEG;
    this.upAngle = up;
    let desired = null, mode = 'reach';
    let dest = null;
    const leg = racer ? course.legs[racer.leg] : null;
    const clock = sim.race ? sim.race.clock : 0;
    if (racer && racer.finished) { // sail away gently
      dest = { x: b.x + Math.sin(twd + Math.PI / 2) * 200, z: b.z - Math.cos(twd + Math.PI / 2) * 200 };
      b.ctrl.gen = false;
    } else if (leg && leg.type === 'start' && clock < 0) {
      return this.preStart(dt, t, sim, racer, course, up);
    } else if (leg && leg.type === 'start') {
      // the start only counts when the boat crosses the line itself, upwind, between the ends: aim through
      // the nearest part of the line (inside the ends); a boat that is above it without having started
      // (OCS, late, or carried past an end) goes back below first. Aiming at one point above the middle
      // left boats that were beyond an end, or already above the line, circling there and never starting.
      const cx = (course.pin.x + course.committee.x) / 2, cz = (course.pin.z + course.committee.z) / 2;
      const half = Math.hypot(course.committee.x - course.pin.x, course.committee.z - course.pin.z) / 2;
      const [a, c] = course.frame(b.x, b.z, cx, cz);
      const cc = clamp(c, -half + 12, half - 12);
      if (racer.ocs || a > 1) this.dipping = true;
      else if (a < -12) this.dipping = false;
      const up2 = this.dipping ? -30 : Math.abs(c) > half - 12 ? 5 : 20;
      dest = { x: cx + course.rx * (this.dipping || Math.abs(c) > half - 12 ? cc : 0) + course.ux * up2,
               z: cz + course.rz * (this.dipping || Math.abs(c) > half - 12 ? cc : 0) + course.uz * up2 };
    } else if (leg && leg.type === 'mark') {
      // round it, don't sail at it: lay a point a boat-length and a half to the right of the mark
      // (it is left to port), and once above it bear away across its upwind ray. Aiming at the mark itself
      // piled the fleet onto it, stalled head to wind, bumping it and never crossing the rounding ray.
      const m = leg.mark, [am, cm] = course.frame(b.x, b.z, m.x, m.z);
      if (this.roundLeg !== racer.leg) { this.roundLeg = racer.leg; this.overMark = false; }
      if (am > 3 && cm > 0) this.overMark = true;
      else if (am < -8) this.overMark = false;   // fell back below it without rounding: go round again
      const off = 1.5 * b.cls.loa + 3;
      dest = this.overMark ? { x: m.x - course.rx * 30 + course.ux * 6, z: m.z - course.rz * 30 + course.uz * 6 }
        : { x: m.x + course.rx * off + course.ux * 3, z: m.z + course.rz * off + course.uz * 3 };
    } else if (leg) dest = course.target(leg, b);
    else dest = this.wander || (this.wander = { x: b.x + 500, z: b.z });

    const brg = Math.atan2(dest.x - b.x, -(dest.z - b.z));
    const dist = Math.hypot(dest.x - b.x, dest.z - b.z);
    const rel = wrap(brg - twd); // target bearing relative to the wind (0 = dead upwind)
    const twa = wrap(twd - b.psi); // + = wind from starboard
    const tack = Math.sign(twa) || 1;
    if (Math.abs(rel) < up + 4 * DEG) {
      mode = 'beat';
      // tack on the layline, or on a big header when not near a layline
      let want = tack;
      // laylines are ground tracks: the other tack's heading plus leeway plus the tide (not the heading
      // alone, which in a cross-tide had the fleet overstanding or tacking short of the mark)
      if (mode === 'beat' && Math.abs(d.leeway ?? 0) < 20 * DEG) this.lee = lerp(this.lee ?? 5 * DEG, Math.abs(d.leeway ?? 0), clamp(dt / 20, 0, 1));
      if (tack > 0 && rel > this.trackRel(-1, up) - this.overstand * 0.2 + 2 * DEG) want = -1;
      if (tack < 0 && rel < this.trackRel(1, up) + this.overstand * 0.2 - 2 * DEG) want = 1;
      const header = tack > 0 ? wrap(twd - this.twdMean) : -wrap(twd - this.twdMean);
      if (want === tack && header < -8 * DEG && Math.abs(rel) < up - 15 * DEG && t - this.lastTack > 25) want = -tack;
      // the tide across the course: where the next couple of hundred metres on the other tack carry the
      // boat into water flowing more toward the mark (less against it), that tack pays
      if (want === tack && Math.abs(rel) < up - 10 * DEG && t - this.lastTack > 40 && this.tideGain(sim, -tack, up, dest) - this.tideGain(sim, tack, up, dest) > 0.12) want = -tack;
      if (want !== tack && t - this.lastTack > 12) { this.lastTack = t; }
      else want = tack;
      desired = twd - want * (up + (this.skill < 1 ? (1 - this.skill) * 6 * DEG : 0));
    } else if (Math.abs(rel) > Math.PI - (Math.PI - dn) - 4 * DEG) {
      mode = 'run';
      let want = tack;
      const dnRel = Math.PI - Math.abs(rel);
      if (tack > 0 && rel < -(dn - 2 * DEG)) want = -1;
      if (tack < 0 && rel > (dn - 2 * DEG)) want = 1;
      if (want !== tack && t - this.lastTack > 15) this.lastTack = t; else want = tack;
      desired = twd - want * dn;
    } else {
      // reaching to a point: steer up-tide of it so the ground track, not the bow, points at it (aiming the
      // bow at a mark in a cross-tide sets a slow boat down-tide of it, round and round, never laying it)
      const c = this.curAt(sim, b.x, b.z), V = Math.max(b.u, 1);
      const cross = c.x * Math.cos(brg) + c.z * Math.sin(brg);        // tide to the right of the bearing
      desired = brg - Math.asin(clamp(cross / V, -0.7, 0.7));
    }
    // keep off the rocks and banks
    if (sim.world && !sim.world.open) desired = this.avoidShoals(sim, desired, mode, tack, up, twd, t);
    // simple traffic avoidance
    for (const o of sim.boats) {
      if (o === b) continue;
      const dx = o.x - b.x, dz = o.z - b.z, r = Math.hypot(dx, dz);
      if (r > 18) continue;
      const brgO = Math.atan2(dx, -dz), relO = wrap(brgO - b.psi);
      if (Math.abs(relO) < 0.6) desired = b.psi - Math.sign(relO || 1) * 0.5;
    }
    // gennaker: up on runs and broad reaches, down near the bottom mark
    if (b.sailBy.gennaker) {
      const nearBottom = leg && (leg.type === 'gate' || leg.type === 'finish') && dist < 90;
      b.ctrl.gen = Math.abs(twa) > 100 * DEG && !nearBottom && mode !== 'beat';
    }
    // reefs for the Blackwatch when overpowered
    if (b.sailBy.main.reefs) {
      const tws = (d.tws ?? 0) / KT;
      b.ctrl.reef = tws > 24 ? 2 : tws > 17 ? 1 : 0;
    }
    autoTrim(b, dt, this.bias);          // trim first: steering may override it (backing the jib in irons)
    this.steer(dt, desired);
    this.mode = mode;
  }

  preStart(dt, t, sim, racer, course, up) {
    const b = this.b, clock = sim.race.clock;
    const f = 0.15 + this.startFrac * 0.7;
    const spot = { x: lerp(course.pin.x, course.committee.x, f), z: lerp(course.pin.z, course.committee.z, f) };
    const vmgUp = Math.max(1.5, (this.targetsUpBsp ?? 5 * KT) * Math.cos(up)) * 0.9;
    const [aB] = course.frame(b.x, b.z, spot.x, spot.z);
    const distToLine = -aB;
    const tNeed = distToLine / Math.max(0.8, vmgUp) + 6;
    const twd = b.diag.twd ?? 0;
    let desired, luff = false;
    if (-clock > tNeed + 12) {
      // hold below the line: reach back and forth around a holding point
      // on the starboard-tack layline to the spot: close-hauled from straight below it sails the boat
      // out past the pin end (90 m below at ~45° made good = ~90 m to the left)
      const lay = 90 * Math.tan(up + 6 * DEG);
      const hold = { x: spot.x - course.ux * 90 + course.rx * lay, z: spot.z - course.uz * 90 + course.rz * lay };
      const dx = hold.x - b.x, dz = hold.z - b.z;
      if (Math.hypot(dx, dz) > 35) desired = Math.atan2(dx, -dz);
      else { desired = twd + Math.PI / 2 * (Math.sin(t * 0.05 + this.startFrac * 6) > 0 ? 1 : -1); luff = true; }
    } else {
      // time the run to the line: head for the spot. Inside the no-go zone, beat to it: hold the present
      // tack until the spot is near the other layline, then tack (steer() alone holds the present tack
      // for ever, sailing away past the end of the line)
      desired = Math.atan2(spot.x + course.ux * 10 - b.x, -(spot.z + course.uz * 10 - b.z));
      const rs = wrap(twd - desired), cur = Math.sign(wrap(twd - b.psi)) || 1;
      // the laylines are ground tracks (heading, leeway and tide): stay on this tack until the spot is on the
      // other tack's layline, then tack; outside the laylines just head for it
      const layC = Math.abs(this.trackRel(cur, up)), layO = Math.abs(this.trackRel(-cur, up));
      if (Math.sign(rs) === cur ? Math.abs(rs) < layC : Math.abs(rs) < layO - 4 * DEG) desired = twd - cur * up;
      else if (Math.abs(rs) < up) desired = twd + cur * up;
      if (distToLine < 8 && -clock > 4) luff = true;
    }
    autoTrim(b, dt, this.bias);
    this.steer(dt, desired);
    if (luff) { b.ctrl.main = 1; b.ctrl.jib = 1; b.ctrl.stay = 1; }
    if (b.sailBy.gennaker) b.ctrl.gen = false;
    this.mode = 'prestart';
  }

  // ground-track angle (relative to the wind, like rel) the boat would make close-hauled on tack s
  // (+1 starboard): heading, leeway to leeward, and the tide it feels (ground minus water velocity)
  trackRel(s, up) {
    const b = this.b, twd = b.diag.twd ?? 0;
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const cx = (b.vgx ?? 0) - (b.u * fx + b.v * sx), cz = (b.vgz ?? 0) - (b.u * fz + b.v * sz);
    const V = Math.max(0.5, this.targetsUpBsp ?? b.u), h = twd - s * (up + (this.lee ?? 5 * DEG));
    return wrap(Math.atan2(V * Math.sin(h) + cx, V * Math.cos(h) - cz) - twd);
  }

  // the tide at (x, z): the environment's current field when the sim has one, else the tide the boat is in
  curAt(sim, x, z) {
    if (sim.env && sim.env.current) return sim.env.current.at(x, z, this._cur || (this._cur = {}));
    return { x: this.b.diag.curX ?? 0, z: this.b.diag.curZ ?? 0 };
  }
  // the tide's share of the ground made toward dest over the next ~2 minutes close-hauled on tack s: the
  // current where that tack takes the boat, resolved along the bearing to the mark (m/s)
  tideGain(sim, s, up, dest) {
    const b = this.b, twd = b.diag.twd ?? 0, h = twd - s * (up + (this.lee ?? 5 * DEG));
    const run = 120 * Math.max(1, this.targetsUpBsp ?? b.u);
    const c = this.curAt(sim, b.x + Math.sin(h) * run, b.z - Math.cos(h) * run);
    const bx = dest.x - b.x, bz = dest.z - b.z, L = Math.hypot(bx, bz) || 1;
    return (c.x * bx + c.z * bz) / L;
  }
  // Depth along the track the boat will actually make on heading h: speed through the water along the
  // heading plus the tide, which in a cross-tide sets the boat sideways onto a bank that a probe along the
  // bow never sees. Returns the least under-keel clearance (m) over the next ~40 s.
  clearance(sim, h) {
    const b = this.b, V = Math.max(b.u, 1.2), c = this.curAt(sim, b.x, b.z);
    const gx = V * Math.sin(h) + c.x, gz = -V * Math.cos(h) + c.z, need = b.cls.draft + 0.6;
    let worst = 1e9;
    for (const s of [5, 12, 22, 40]) worst = Math.min(worst, sim.world.depthAt(b.x + gx * s, b.z + gz * s) - need);
    return worst;
  }
  // keep the desired heading if its track is clear; on a beat tack away from the shallows; otherwise the
  // nearest clear heading either side (or, if nothing is clear, the one with the most water)
  avoidShoals(sim, desired, mode, tack, up, twd, t) {
    if (this.clearance(sim, desired) > 0) return desired;
    if (mode === 'beat' && t - this.lastTack > 6) {
      const other = twd + tack * up;
      if (this.clearance(sim, other) > 0) { this.lastTack = t; return other; }
    }
    let best = desired, bestC = -1e9;
    for (let k = 1; k <= 14; k++) for (const s of [1, -1]) {
      const h = desired + s * k * 12 * DEG, c = this.clearance(sim, h);
      if (c > 0) return h;
      if (c > bestC) { bestC = c; best = h; }
    }
    return best;
  }

  steer(dt, desired) {
    const b = this.b, d = b.diag;
    const twd = d.twd ?? 0;
    // close-hauled, but footing off to build speed when slow (a heavy boat that has stalled at the target
    // angle, in a lull or after a tack, never gets going again there: it only slides sideways)
    // (upwind target speed for the wind blowing now: the race-start polar overstates it in a lull)
    const vT = Math.max(0.5, Math.min(this.targetsUpBsp ?? 2, 0.45 * (d.tws ?? 5)));
    const slow = clamp(1 - b.u / (0.7 * vT), 0, 1);
    const up = (this.upAngle ?? 40 * DEG) * 0.95 + 40 * DEG * slow * slow;   // stopped: bear off to a close reach
    // never aim into the no-go zone: pinch at most to close-hauled on the nearer tack
    let rel = wrap(twd - desired);
    if (Math.abs(rel) < up) desired = twd - (Math.sign(wrap(twd - b.psi)) || 1) * up;
    // no tacking from a standstill: bear away on the present tack and build speed first — but not for ever:
    // in a light patch with the tide under it the speed may never come, and holding on sailed the boat away
    // from the mark and onto the shore. After 25 s of that it goes round the other way, gybing (a slow boat
    // cannot tack, but it can always bear away through the wind astern)
    const tackNow = Math.sign(wrap(twd - b.psi)) || 1;
    if (this.buildTack !== tackNow) { this.buildTack = tackNow; this.buildT = 0; }
    const wantsOther = (Math.sign(wrap(twd - desired)) || 1) !== tackNow;
    if (wantsOther && b.u < 0.5 * vT && Math.abs(wrap(twd - b.psi)) > 25 * DEG) {
      this.buildT += dt;
      desired = this.buildT < 25 ? twd - tackNow * (up + 30 * DEG) : twd + tackNow * 150 * DEG; // (the other gybe)
    }
    let err = wrap(desired - b.psi);
    this.desired = desired;
    // bearing away from slow: ease the main so the rig stops turning the bow into the wind (a sheeted-in
    // main's weather helm beats a rudder with no flow over it — the fleet sat at the windward mark with the
    // helm hard over, pinned at 30-45° by the tide). Only while the bow is not coming round: an eased main
    // on a boat that is already turning just stops it (a una-rig dinghy then sat luffing on a reach)
    const off = Math.abs(wrap(twd - desired)) - Math.abs(wrap(twd - b.psi));
    const sameTack = (Math.sign(wrap(twd - desired)) || 1) === (Math.sign(wrap(twd - b.psi)) || 1);
    const turning = b.r * Math.sign(err) > 2 * DEG;
    if (sameTack && off > 10 * DEG && slow > 0.3 && !turning && b.sailBy.jib && b.sailBy.main) b.ctrl.main = Math.max(b.ctrl.main, 0.35 + 0.5 * slow);
    const kp = 2.4 * this.skill, kd = 1.6;
    let cmd = clamp(kp * err - kd * b.r, -0.8, 0.8);
    const twa = wrap(twd - b.psi);
    // in irons / going astern: the rudder works backwards; the jib is backed by hauling the lazy sheet
    // across on the other winch (a una-rig pushes the boom out by hand)
    // (with hysteresis: a boat merely slow at close-hauled is not in irons — backing its jib there stopped it
    // dead, and the release-and-back cycle kept a Blackwatch drifting sideways on the tide for many minutes)
    const upB = this.upAngle ?? 40 * DEG;
    const irons = this.backing ? b.u < 0.8 && Math.abs(twa) < upB + 10 * DEG : b.u < 0.3 && Math.abs(twa) < 0.75 * upB;
    if (irons) {
      const wantTack = Math.sign(wrap(twd - desired)) || 1;
      if (b.sailBy.jib) {
        const clew = Math.sign(b.side.jib) || 1;
        if (clew !== wantTack) { b.ctrl.lazy = 0.15; b.ctrl.jib = 1; } else { b.ctrl.lazy = 1; b.ctrl.jib = Math.min(b.ctrl.jib, 0.35); }
      } else b.ctrl.pushBoom = wantTack;
      cmd = b.u < 0 ? -wantTack * 0.8 * -1 : cmd;
      this.backing = true;
    } else {
      b.ctrl.pushBoom = 0;
      if (this.backing) { this.backing = false; b.ctrl.lazy = 1; if (b.backedByLazy) { b.ctrl.jib = 1; b.backedByLazy = false; } }
    }
    b.ctrl.helm = lerp(b.ctrl.helm, cmd, clamp(dt * 6, 0, 1));
  }
}

// Wind shadow ("dirty air"): each boat blankets a cone downwind along its apparent wind.
export function applyWindShadow(boats) {
  for (const b of boats) b.shadow = 1;
  for (const src of boats) {
    const d = src.diag;
    if (d.aws === undefined) continue;
    const H = src.cls.mastHeight;
    // apparent wind flow direction over ground at the source
    const fa = src.psi + d.awa + Math.PI;
    const fx = Math.sin(fa), fz = -Math.cos(fa);
    const len = 7 * H;
    for (const b of boats) {
      if (b === src) continue;
      const dx = b.x - src.x, dz = b.z - src.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > len) continue;
      const cross = Math.abs(-dx * fz + dz * fx);
      const w = 0.9 * H * (1 + along / len);
      if (cross > 2.5 * w) continue;
      const red = 0.35 * (1 - along / len) * Math.exp(-((cross / w) ** 2)) * (src.cls.mastHeight / 8);
      b.shadow = Math.min(b.shadow, 1 - clamp(red, 0, 0.45));
    }
  }
}

// Hull-hull and hull-obstacle contact: boats as capsules, marks as circles, piers as thick segments.
export function resolveCollisions(boats, marks, piers, onEvent) {
  const seg = (b) => {
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
    const C = b.cls;
    return { ax: b.x + fx * (C.bowX - C.beam * 0.35), az: b.z + fz * (C.bowX - C.beam * 0.35), bx: b.x + fx * (C.sternX + C.beam * 0.35), bz: b.z + fz * (C.sternX + C.beam * 0.35), r: C.beam * 0.45 };
  };
  const closest = (s, px, pz) => {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
    const t = clamp(((px - s.ax) * dx + (pz - s.az) * dz) / L2, 0, 1);
    return [s.ax + dx * t, s.az + dz * t];
  };
  const push = (b, nx, nz, depth, other) => {
    b.x += nx * depth; b.z += nz * depth;
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const vx = b.u * fx + b.v * sx, vz = b.u * fz + b.v * sz;
    const vn = vx * nx + vz * nz;
    if (vn < 0) {
      const nvx = vx - 1.4 * vn * nx, nvz = vz - 1.4 * vn * nz;
      b.u = (nvx * fx + nvz * fz) * 0.8; b.v = (nvx * sx + nvz * sz) * 0.8;
      if (-vn > 0.4 && onEvent) onEvent(b, other, -vn);
    }
  };
  const S = boats.map(seg);
  for (let i = 0; i < boats.length; i++) for (let j = i + 1; j < boats.length; j++) {
    const a = S[i], c = S[j];
    // approximate capsule-capsule by sampling
    let best = null;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const px = a.ax + (a.bx - a.ax) * t, pz = a.az + (a.bz - a.az) * t;
      const [qx, qz] = closest(c, px, pz);
      const dd = Math.hypot(px - qx, pz - qz);
      if (!best || dd < best.d) best = { d: dd, px, pz, qx, qz };
    }
    const rr = a.r + c.r;
    if (best.d < rr) {
      let nx = best.px - best.qx, nz = best.pz - best.qz; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      const pen = (rr - best.d) / 2;
      push(boats[i], nx, nz, pen, boats[j]); push(boats[j], -nx, -nz, pen, boats[i]);
    }
  }
  for (let i = 0; i < boats.length; i++) {
    const s = S[i];
    for (const m of marks) {
      const [qx, qz] = closest(s, m.x, m.z);
      const dd = Math.hypot(qx - m.x, qz - m.z), rr = s.r + (m.kind === 'committee' ? 2.2 : 0.8);
      if (dd < rr) { const nx = (qx - m.x) / (dd || 1), nz = (qz - m.z) / (dd || 1); push(boats[i], nx, nz, rr - dd, m); }
    }
    for (const p of piers) {
      const pts = p.pts;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
        if (Math.abs(ax - boats[i].x) > 400 && Math.abs(bx - boats[i].x) > 400) continue;
        const ps = { ax, az, bx, bz };
        for (const t of [0, 0.5, 1]) {
          const px = s.ax + (s.bx - s.ax) * t, pz = s.az + (s.bz - s.az) * t;
          const [qx, qz] = closest(ps, px, pz);
          const dd = Math.hypot(px - qx, pz - qz), rr = s.r + p.w / 2;
          if (dd < rr) { const nx = (px - qx) / (dd || 1), nz = (pz - qz) / (dd || 1); push(boats[i], nx, nz, rr - dd, p); }
        }
      }
    }
  }
}
