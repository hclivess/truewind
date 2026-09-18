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
      if (racer.ocs) { // dip back below the line
        dest = { x: b.x - course.ux * 60, z: b.z - course.uz * 60 };
      } else dest = { x: (course.pin.x + course.committee.x) / 2 + course.ux * 20, z: (course.pin.z + course.committee.z) / 2 + course.uz * 20 };
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
      if (tack > 0 && rel > up - this.overstand * 0.2 + 2 * DEG) want = -1;
      if (tack < 0 && rel < -up + this.overstand * 0.2 - 2 * DEG) want = 1;
      const header = tack > 0 ? wrap(twd - this.twdMean) : -wrap(twd - this.twdMean);
      if (want === tack && header < -8 * DEG && Math.abs(rel) < up - 15 * DEG && t - this.lastTack > 25) want = -tack;
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
    } else desired = brg;
    // keep off the rocks: probe ahead along the desired and current headings
    if (sim.world && !sim.world.open) {
      const look = 25 + b.u * 8;
      const px = b.x + Math.sin(b.psi) * look, pz = b.z - Math.cos(b.psi) * look;
      if (sim.world.depthAt(px, pz) < b.cls.draft + 0.6) {
        if (mode === 'beat' && t - this.lastTack > 6) { this.lastTack = t; desired = twd + tack * up; }
        else desired = b.psi + (sim.world.depthAt(b.x + Math.sin(b.psi + 0.6) * look, b.z - Math.cos(b.psi + 0.6) * look) > sim.world.depthAt(b.x + Math.sin(b.psi - 0.6) * look, b.z - Math.cos(b.psi - 0.6) * look) ? 0.6 : -0.6);
      }
    }
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
      const hold = { x: spot.x - course.ux * 90, z: spot.z - course.uz * 90 };
      const dx = hold.x - b.x, dz = hold.z - b.z;
      if (Math.hypot(dx, dz) > 35) desired = Math.atan2(dx, -dz);
      else { desired = twd + Math.PI / 2 * (Math.sin(t * 0.05 + this.startFrac * 6) > 0 ? 1 : -1); luff = true; }
    } else {
      // time the run to the line on starboard tack
      desired = twd - up;
      if (distToLine < 8 && -clock > 4) luff = true;
    }
    autoTrim(b, dt, this.bias);
    this.steer(dt, desired);
    if (luff) { b.ctrl.main = 1; b.ctrl.jib = 1; b.ctrl.stay = 1; }
    if (b.sailBy.gennaker) b.ctrl.gen = false;
    this.mode = 'prestart';
  }

  steer(dt, desired) {
    const b = this.b, d = b.diag;
    const twd = d.twd ?? 0;
    const up = (this.upAngle ?? 40 * DEG) * 0.95;
    // never aim into the no-go zone: pinch at most to close-hauled on the nearer tack
    let rel = wrap(twd - desired);
    if (Math.abs(rel) < up) desired = twd - (Math.sign(wrap(twd - b.psi)) || 1) * up;
    // no tacking from a standstill: bear away on the present tack and build speed first
    const tackNow = Math.sign(wrap(twd - b.psi)) || 1;
    if ((Math.sign(wrap(twd - desired)) || 1) !== tackNow && b.u < 1.2 && Math.abs(wrap(twd - b.psi)) > 25 * DEG) desired = twd - tackNow * (up + 30 * DEG);
    let err = wrap(desired - b.psi);
    const kp = 2.4 * this.skill, kd = 1.6;
    let cmd = clamp(kp * err - kd * b.r, -0.8, 0.8);
    const twa = wrap(twd - b.psi);
    // in irons / going astern: the rudder works backwards; the jib is backed by hauling the lazy sheet
    // across on the other winch (a una-rig pushes the boom out by hand)
    if (b.u < 0.4 && Math.abs(twa) < 45 * DEG) {
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
