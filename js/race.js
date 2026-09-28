// Race management (windward-leeward course, start sequence, OCS, roundings, finish), free-sail
// waypoints, and AI crews that sail the same physics with a helm + tactician model.
import { DEG, KT, mulberry32 } from './env.js';
import { autoTrim, wrap, clamp, lerp } from './physics.js';
import { aiRules } from './rules.js';

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
    // a long line (a big fleet) must fit the water: slide it across the wind, or shorten it, until both ends and
    // the start box 170 m below them are clear of the shore and the shallows
    let half = (opts.lineLength ?? 120) / 2, ox = cx, oz = cz;
    const ok = (x, z) => !world || world.open || (world.sdfAt(x, z) > 50 && world.depthAt(x, z) > 2.5);
    const fits = (x, z, h) => { for (let f = -1; f <= 1.001; f += 0.25) for (const b of [0, 90, 170]) if (!ok(x + rx * h * f - ux * b, z + rz * h * f - uz * b)) return false; return true; };
    search: for (let k = 0; k < 12 && half > 60; k++, half = Math.max(60, half * 0.85)) {
      for (let s = 0; s <= 300; s += 30) for (const sg of s ? [1, -1] : [1]) if (fits(cx + rx * s * sg, cz + rz * s * sg, half)) { ox = cx + rx * s * sg; oz = cz + rz * s * sg; break search; }
    }
    this.half = half;
    this.origin = { x: ox, z: oz };
    this.committee = { x: ox + rx * half, z: oz + rz * half, kind: 'committee', heading: Math.atan2(-rz, rx) + Math.PI / 2 };
    this.pin = { x: ox - rx * half, z: oz - rz * half, kind: 'pin' };
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
    this.xFlag = false;   // rule 29.1: individual recall, flown while a boat over at the gun has not come back
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
      if (r.finished || r.retired) { r.prev = cur; continue; }   // (retired: e.g. motored after the preparatory signal)
      if (leg.type === 'start') {
        const [a] = C.frame(b.x, b.z, C.pin.x, C.pin.z);
        const [aC] = C.frame(b.x, b.z, C.committee.x, C.committee.z);
        const lineA = (a + aC) / 2;
        if (clock < 0) { r.ocs = false; }
        else {
          if (Math.abs(clock) < 1e-6 || (clock > 0 && clock - dt <= 0)) {
            if (lineA > 0.5) { r.ocs = true; r.ocsAtGun = true; this.xFlag = true; this.events.push({ type: 'ocs', boat: b }); }
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
    // X comes down when every boat over at the gun has returned, or four minutes after the start
    if (this.xFlag && (clock > 240 || !this.racers.some(r => r.ocs))) { this.xFlag = false; this.events.push({ type: 'xflag', up: false }); }
  }

  // one way out of a race for every reason (RRS 42 motoring, damage): RET in the standings, why in the race card
  retire(boat, why) {
    const r = this.racers.find((x) => x.boat === boat);
    if (!r || r.retired || r.finished) return false;
    r.retired = true; r.retiredWhy = why;
    this.events.push({ type: 'retired', boat, why });
    return true;
  }

  standings() {
    const C = this.course;
    const score = (r) => {
      if (r.dsq) return -2e9 + (r.finished ? 1e6 - r.finishTime : r.leg * 1e3);     // disqualified: at the bottom
      if (r.finished) return 1e9 - r.finishTime;
      if (r.retired) return -1e9;                   // (RET: RRS 42, or dismasted, sinking, keel or rudder gone: js/gear.js)
      const tgt = C.target(C.legs[r.leg], r.boat);
      return r.leg * 1e5 - Math.hypot(r.boat.x - tgt.x, r.boat.z - tgt.z);
    };
    return this.racers.slice().sort((a, b) => score(b) - score(a));
  }
}

// ---------------------------------------------------------------------------------------------
// AI crew: tactician picks the mode (beat / reach / run / pre-start), helm steers to a target TWA or
// heading with a PD controller on yaw, trimmers run autoTrim. They read the wind they actually feel.
// an AI crew's own random sequence: seeded by the race (room) seed and the boat's index
export const aiRandom = (seed, i) => mulberry32(Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul((i | 0) + 1, 0xc2b2ae35));

// the wind as a boat sails in it: over the water, not over the ground. The polar's angles are to it; steered by the
// ground wind in a cross-tide one tack pinched and the other footed by the tide's angle (~4 deg for 1.2 kn in 13 kn:
// the Solent fleet's starboard tack sailed at 4 kn to port's 6, its laylines and beats minutes out)
export function waterTwd(b) {
  const d = b.diag, tw = d.twd ?? 0, s = d.tws ?? 0;
  if (b.vgx === undefined || !s) return tw;
  const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
  const cx = b.vgx - (b.u * fx + b.v * sx), cz = b.vgz - (b.u * fz + b.v * sz);
  return Math.atan2(Math.sin(tw) * s + cx, Math.cos(tw) * s - cz);
}

export class AIHelm {
  // personality.seed: the race's seed (the same boat in the same race sails the same way, and every browser in
  // a room agrees); its draws are keyed by that and the boat's id, never Math.random
  constructor(boat, personality = {}) {
    this.b = boat;
    const r = aiRandom(personality.seed ?? 0, boat.id ?? 0);
    this.skill = personality.skill ?? 0.9;
    this.startFrac = r();
    if (personality.startFrac !== undefined) this.startFrac = personality.startFrac;
    this.lastTack = -100;
    this.overstand = (2 + r() * 4) * DEG;
    this.tackMode = 0;
    this.twdMean = null;
    this.hold = null;
    this.bias = (r() - 0.5) * 2;
    this.goal = null;      // sailing free: the point to sail to (the autopilot's waypoint); none, she wanders
    this.log = null;       // an array: every decision as it is taken, with its reason (the autopilot's coach reads it)
    this.noTrim = false;   // the sheets are someone else's (the player trims while the autopilot steers)
  }
  // a decision taken, and why: kept only when someone listens (the fleet's crews keep none)
  note(k, o = {}) { if (!this.log) return; o.k = k; this.log.push(o); if (this.log.length > 64) this.log.shift(); }
  update(dt, t, sim, racer, course, targets) {
    const b = this.b, d = b.diag;
    const twd = waterTwd(b);
    // capsized: ease everything and stand on the board / hang on the righting line
    if (b.capsized) { this.capT = (this.capT || 0) + dt; b.ctrl.main = 1; b.ctrl.jib = 1; if (this.capT > 5) b.righting = true; this.mode = 'capsized'; return; }
    this.capT = 0;
    const R = sim.rules;
    // a penalty flagged by the umpire: two turns (one for a mark) at once, each a tack and a gybe, same way round
    // (22.2: she keeps clear while turning, so first she sails clear of the boats around her and out of the mark's
    // zone, 45 s at most)
    const pen = R && racer && !racer.finished && !racer.retired ? R.penaltyOf(b) : null;
    if (pen) return this.penaltyTurns(dt, pen, sim, t);
    this.penD = 0; this.penBuild = 0; this.penHold = 0; this.penGo = false;
    this.twdMean = this.twdMean === null ? twd : this.twdMean + wrap(twd - this.twdMean) * dt / 90;
    // (an asymmetric kite's polar is flat from 150 deg to dead downwind, and the VMG table's pick of 165 in a sea had
    // the J/70 steering at the finish down there, by the lee half the time, at 3 kn: she runs at 150 and gybes)
    const up = (targets?.up ?? 42) * DEG, dn = Math.min((targets?.dn ?? 145) * DEG, b.sailBy.gennaker ? 150 * DEG : Math.PI);
    this.upAngle = up;
    let desired = null, mode = 'reach';
    let dest = null;
    this.startTack = 0; this.xs = null;
    const leg = racer ? course.legs[racer.leg] : null;
    const clock = sim.race ? sim.race.clock : 0;
    if (racer && (racer.finished || racer.retired)) { // sail away gently (finished, or out of the race)
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
      // below it, she starts wherever her close-hauled track (leeway and tide) crosses it between the ends, and
      // sails on up the beat; only when this tack leaves it outside an end does she tack for the other. (Aimed at
      // the middle, a boat that came up at one end sailed half the line's length below it, then tacked onto port
      // across the starboard boats still starting: late, and fouling them.)
      let x0 = Infinity, x1 = Infinity;
      if (!this.dipping && a < 0) {
        // (her own track made good on this tack, once close-hauled with way on; the other tack's at the speed she
        // will have: a slow boat's track is the tide's more than her heading's)
        const cur = Math.sign(wrap(twd - b.psi)) || 1, Vt = this.targetsUpBsp ?? b.u, gs = Math.hypot(b.vgx ?? 0, b.vgz ?? 0);
        const onWind = Math.abs(wrap(twd - b.psi)) < up + 20 * DEG && gs > 0.7;
        const cross = (s) => {
          const g = s === cur && onWind ? Math.atan2(b.vgx, -b.vgz) : twd + this.trackRel(s, up, clamp(b.u, 0.6 * Vt, Vt));
          const dl = wrap(g - course.windDir);
          return Math.cos(dl) > 0.25 ? c - a * Math.tan(dl) : Infinity;
        };
        x0 = cross(cur); x1 = cross(-cur); this.xs = [x0, x1];
        if (Math.abs(x0) >= half - 8 && Math.abs(x1) < half - 8) this.startTack = -cur;
      }
      if (Math.abs(x0) < half - 8 || Math.abs(x1) < half - 8) dest = course.target(course.legs[racer.leg + 1] || leg, b);
      else {
        const up2 = this.dipping ? -30 : 5;
        dest = { x: cx + course.rx * cc + course.ux * up2, z: cz + course.rz * cc + course.uz * up2 };
      }
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
    else dest = this.goal || this.wander || (this.wander = { x: b.x + 500, z: b.z });
    this.dest = dest; this.dnAngle = dn;

    const brg = Math.atan2(dest.x - b.x, -(dest.z - b.z));
    const dist = Math.hypot(dest.x - b.x, dest.z - b.z);
    const rel = wrap(brg - twd); // target bearing relative to the wind (0 = dead upwind)
    const twa = wrap(twd - b.psi); // + = wind from starboard
    const tack = Math.sign(twa) || 1;
    if (Math.abs(rel) < up + 4 * DEG) {
      mode = 'beat';
      // tack on the layline, or on a big header when not near a layline
      let want = tack, why = null;
      // laylines are ground tracks: the other tack's heading plus leeway plus the tide (not the heading
      // alone, which in a cross-tide had the fleet overstanding or tacking short of the mark)
      if (mode === 'beat' && Math.abs(d.leeway ?? 0) < 20 * DEG) this.lee = lerp(this.lee ?? 5 * DEG, Math.abs(d.leeway ?? 0), clamp(dt / 20, 0, 1));
      // (and at the speed she makes close-hauled, not the polar's: in a sea and the tide a J/70 makes 5 kn to the
      // polar's 6, and at the polar's the tide's share of her track was underrated, her laylines tacked short)
      if (Math.abs(Math.abs(twa) - up) < 8 * DEG) this.vUp = lerp(this.vUp ?? this.targetsUpBsp ?? b.u, b.u, clamp(dt / 30, 0, 1));
      if (tack > 0 && rel > this.trackRel(-1, up) - this.overstand * 0.2 + 2 * DEG) { want = -1; why = 'layline'; }
      if (tack < 0 && rel < this.trackRel(1, up) + this.overstand * 0.2 - 2 * DEG) { want = 1; why = 'layline'; }
      const header = tack > 0 ? wrap(twd - this.twdMean) : -wrap(twd - this.twdMean);
      // (starting: the tack that crosses the line between its ends, never a header's or the tide's)
      const starting = leg && leg.type === 'start';
      if (starting && this.startTack === -tack && t - this.lastTack > 40) { want = -tack; why = 'start'; }
      if (!starting && want === tack && header < -8 * DEG && Math.abs(rel) < up - 15 * DEG && t - this.lastTack > 25) { want = -tack; why = 'header'; }
      // (the autopilot: off the laylines until near the mark, as a coach teaches — back toward the middle once she is
      // `cone` of the way out to one, far from the mark; a wind shift then costs little either way)
      if (this.cone && !starting && want === tack && rel * tack > 0 && t - this.lastTack > 30 && dist * Math.cos(rel) > Math.max(150, 20 * b.cls.loa)
        && Math.abs(Math.tan(rel)) > this.cone * Math.abs(Math.tan(this.trackRel(-tack, up)))) { want = -tack; why = 'cone'; }
      // the tide across the course: where the next couple of hundred metres on the other tack carry the
      // boat into water flowing more toward the mark (less against it), that tack pays
      if (!starting && want === tack && Math.abs(rel) < up - 10 * DEG && t - this.lastTack > 40 && this.tideGain(sim, -tack, up, dest) - this.tideGain(sim, tack, up, dest) > 0.12) { want = -tack; why = 'tide'; }
      // under the rules: no tacking into anyone's way (13, 15); hailed for room to tack (20) she tacks at once, and
      // so does the boat that hailed once answered
      // (a tack of her own choosing only with way on: in this rig a J/70 tacked at 4 kn in the pack's dirty air came
      // out of it stopped, or fell back head to wind; slower, she sails on and the speed comes)
      const vT = Math.max(0.5, Math.min(this.targetsUpBsp ?? 2, 0.45 * (d.tws ?? 5)));
      if (want !== tack && b.u < 0.7 * vT) want = tack;
      if (R && R.on !== false) {
        if (want !== tack && !R.canTurn(b, twd - want * up)) want = tack;
        if (R.hailTo(b) || (R.hailOf(b) && R.hailOf(b).answered && R.S(b).tackT < R.hailOf(b).answered)) { want = -tack; this.lastTack = -100; why = 'hail'; }
      }
      // a tack decided is carried through (the decision stood for one step: the next, inside the twelve seconds, put
      // her back on her old tack, so a beat's tacks came only once the mark was past the layline and outside the
      // no-go zone, as a reach, overstood by the tide's angle, and the header and tide tacks never)
      if (want !== tack && t - this.lastTack > 12) { this.lastTack = t; this.tackTo = want; this.note('tack', { why, to: want, rel, hdr: -header, off: dist * Math.sin(rel) }); }
      else if (this.tackTo === -tack && t - this.lastTack < 10) want = this.tackTo;
      else want = tack;
      desired = twd - want * (up + (this.skill < 1 ? (1 - this.skill) * 6 * DEG : 0));
    } else if (Math.abs(rel) > Math.PI - (Math.PI - dn) - 4 * DEG) {
      mode = 'run';
      let want = tack;
      const dnRel = Math.PI - Math.abs(rel);
      if (tack > 0 && rel < -(dn - 2 * DEG)) want = -1;
      if (tack < 0 && rel > (dn - 2 * DEG)) want = 1;
      if (want !== tack && R && !R.canTurn(b, twd - want * dn, 8)) want = tack;       // gybe only where it is clear
      if (want !== tack && t - this.lastTack > 15) { this.lastTack = t; this.tackTo = want; this.note('gybe', { why: 'layline', to: want, rel }); }
      else if (this.tackTo === -tack && t - this.lastTack < 10) want = this.tackTo;      // (the gybe carried through)
      else want = tack;
      desired = twd - want * dn;
    } else {
      // reaching to a point: steer up-tide of it so the ground track, not the bow, points at it (aiming the
      // bow at a mark in a cross-tide sets a slow boat down-tide of it, round and round, never laying it)
      // (by the speed she should be making, not what she makes: divided by a slowing boat's speed the correction
      // grew, pointed her higher, slowed her more, until she sat head to wind swinging the helm; and never above
      // close-hauled, where a reach turns into a beat)
      const c = this.curAt(sim, b.x, b.z), V = Math.max(b.u, 1.5);
      const cross = c.x * Math.cos(brg) + c.z * Math.sin(brg);        // tide to the right of the bearing
      desired = brg - Math.asin(clamp(cross / V, -0.5, 0.5));
      this.tideCorr = wrap(desired - brg);
      const off = wrap(twd - desired);
      if (Math.abs(off) < up + 2 * DEG) desired = twd - (Math.sign(off) || tack) * (up + 2 * DEG);
      // (just past a beat's or a run's layline, the reach that tacks or gybes onto it: said as the layline turn it is)
      const s = Math.sign(wrap(twd - desired)) || tack;
      if (s !== tack && this.log && t - (this.reachTackT ?? -99) > 12 && t - this.lastTack > 12) { this.reachTackT = t; this.note(Math.abs(twa) < Math.PI / 2 ? 'tack' : 'gybe', { why: 'layline', to: s, rel }); }
    }
    // keep off the rocks and banks
    if (sim.world && !sim.world.open) desired = this.avoidShoals(sim, desired, mode, tack, up, twd, t);
    // traffic: under the racing rules (js/rules.js) when the race has them, else a simple swerve
    if (R) desired = aiRules(this, sim, this.gateTurn(R, desired, twd, up), mode, t, up);
    else for (const o of sim.boats) {
      if (o === b) continue;
      const dx = o.x - b.x, dz = o.z - b.z, r = Math.hypot(dx, dz);
      if (r > 18) continue;
      const brgO = Math.atan2(dx, -dz), relO = wrap(brgO - b.psi);
      if (Math.abs(relO) < 0.6) desired = b.psi - Math.sign(relO || 1) * 0.5;
    }
    this.sails(mode, twa, leg && (leg.type === 'gate' || leg.type === 'finish') && dist < 90);
    if (!this.noTrim) autoTrim(b, dt, this.bias);          // trim first: steering may override it (backing the jib in irons)
    if (this.ease) this.slow();
    this.steer(dt, desired);
    this.mode = mode;
  }
  // the sails for the point of sailing: the gennaker up on runs and broad reaches, down near the bottom mark; reefs
  // when overpowered
  sails(mode, twa, nearBottom) {
    const b = this.b, d = b.diag;
    if (b.sailBy.gennaker) {
      // (in a blow, only on a run or a broad reach: reaching under a kite in 25 kn the cat's bows go under and it
      // trips over them, whatever the sheets do; with the apparent wind aft of the beam the kite can be eased to luff)
      const kiteFrom = (d.tws ?? 0) / KT > 20 ? 125 : 100;
      b.ctrl.gen = Math.abs(twa) > kiteFrom * DEG && !nearBottom && mode !== 'beat';
      if (b.ctrl.gen !== this.genNoted && this.log) { this.genNoted = b.ctrl.gen; this.note('gen', { up: b.ctrl.gen, why: nearBottom ? 'bottom' : mode === 'beat' ? 'beat' : 'angle', twa, from: kiteFrom }); }
    }
    if (b.sailBy.main.reefs) {
      const tws = (d.tws ?? 0) / KT;
      const R = b.cls.reefWind ?? [17, 24], was = b.ctrl.reef | 0;      // (the wind a class reefs at: first, second)
      b.ctrl.reef = tws > R[1] ? 2 : tws > R[0] ? 1 : 0;
      if (b.ctrl.reef !== was) this.note('reef', { to: b.ctrl.reef, from: was, tws });
    }
  }
  // no tack or gybe where it would put her in someone's way (13, 15): the same angle to the wind on this tack
  // (once begun, a tack or gybe is finished: turning back half way leaves her head to wind, stopped, in the way)
  gateTurn(R, desired, twd, up) {
    const b = this.b, cur = Math.sign(wrap(twd - b.psi)) || 1, rel = wrap(twd - desired);
    if ((Math.sign(rel) || 1) === cur) return desired;
    if (R.t < (this.turnGo || 0) || Math.abs(wrap(twd - b.psi)) < up * 0.8) { this.turnGo = Math.max(this.turnGo || 0, R.t + 2); return desired; }
    // (a refusal stands for two seconds before she asks again)
    if (R.t > (this.turnNo || 0)) { if (R.canTurn(b, desired, 8)) { this.turnGo = R.t + 8; return desired; } this.turnNo = R.t + 2; }
    // held on this tack: the heading on it nearest the one wanted (close-hauled, or running by the lee's edge)
    return twd - cur * (Math.abs(rel) < (210 * DEG - up) / 2 ? up : 150 * DEG);
  }
  // keeping clear of a boat ahead with nowhere to go: ease the sheets and slow down
  slow() { const c = this.b.ctrl; c.main = Math.max(c.main, 0.8); if (this.b.sailBy.jib) c.jib = Math.max(c.jib, 0.8); if (this.b.sailBy.gennaker) c.gen = false; }

  // penalty turns (44.2): bear away first (the gybe keeps her speed for the tack), then round and round the same
  // way at a steady helm until the umpire's count says done; she keeps clear of everyone meanwhile (22.2)
  penaltyTurns(dt, pen, sim, t) {
    const b = this.b, twd = waterTwd(b), twa = wrap(twd - b.psi), tack = Math.sign(twa) || 1;
    if (!this.penD) this.penD = pen.dir || -tack;
    if (!this.noTrim) autoTrim(b, dt, this.bias);
    if (b.sailBy.gennaker) b.ctrl.gen = false;
    this.mode = 'penalty';
    const R = sim.rules, L = b.cls.loa, up = this.upAngle ?? 40 * DEG;
    // first out of the traffic (22.2: she keeps clear of everyone meanwhile): a reach away from the boats around
    // her and out of the mark's zone; again whenever a boat comes near while she turns (the turn is lost)
    const crowd = R.relsOf(b).filter(pr => pr.d < 4 * L + 6);
    const C = sim.course, inZone = C && [...C.marks(), C.committee].some(m => Math.hypot(m.x - b.x, m.z - b.z) < 5 * L + 4);
    const near = R.relsOf(b).some(pr => pr.clr < 2 && pr.when <= 2) || (C && [...C.marks(), C.committee].some(m => Math.hypot(m.x - b.x, m.z - b.z) < 2 * L + 3));
    // on the last leg, not over the finish while she turns (finished with the penalty owed is DSQ: a boat turning
    // 60 m above the line drifted down across it): up away from it first, on a close reach
    const rc = sim.race && sim.race.racers.find(r => r.boat === b);
    if (C && rc && C.legs[rc.leg] && C.legs[rc.leg].type === 'finish') {
      const [af, cf] = C.frame(b.x, b.z, (C.pin.x + C.committee.x) / 2, (C.pin.z + C.committee.z) / 2);
      if (af > -5 && af < 70 && Math.abs(cf) < C.half + 30) { this.steer(dt, twd + (cf > 0 ? 1 : -1) * 60 * DEG); return; }
    }
    if (((crowd.length || inZone) && !pen.dir && R.t - pen.t0 < 45) || near) {
      if (!this.awayT || t > this.awayT) {       // (the side with fewer boats, decided every few seconds)
        let lft = 0, rgt = 0;
        for (const pr of R.relsOf(b)) { const o = pr.a === b ? pr.b : pr.a, s = wrap(Math.atan2(o.x - b.x, -(o.z - b.z)) - twd); if (s > 0) rgt += 1 / pr.d; else lft += 1 / pr.d; }
        this.awayS = rgt > lft ? -1 : 1; this.awayT = t + 4;
      }
      this.steer(dt, aiRules(this, sim, twd + this.awayS * 100 * DEG, 'reach', t, up));
      if (this.ease) this.slow();
      return;
    }
    // too slow to come through the wind: first a reach to build speed (a stalled turn ends in irons)
    // (each wait for speed has an end: in a lull or another boat's wind shadow the speed may never come, and a boat
    // holding a reach for it ran out the umpire's time and was disqualified)
    const vT = Math.max(1, Math.min(this.targetsUpBsp ?? 2, 0.45 * (b.diag.tws ?? 5)));
    if (!pen.dir && b.u < 0.7 * vT && (this.penBuild = (this.penBuild || 0) + dt) < 15) { this.steer(dt, twd - tack * 100 * DEG); return; }
    // coming up toward the tack too slow to carry through it: hold a reach until she has way on (a stall head to
    // wind falls back and the turn is lost)
    const upward = (this.penD > 0) === (twa > 0), a = Math.abs(twa);
    // (on a beam reach, not creeping up toward the wind: crept up, she lost the speed she was waiting for; and at
    // last, slow or not, round she goes)
    if (upward && a > 60 * DEG && a < 115 * DEG) {
      const w = (this.penHold = (this.penHold || 0) + dt);
      if (!this.penGo && b.u < (w < 20 ? 0.8 : w < 35 ? 0.55 : 0) * vT) { this.steer(dt, twd - tack * 100 * DEG); return; }
      this.penGo = true;                                       // (once she has gone for it, on round)
    } else { this.penHold = 0; this.penGo = false; }
    this.steer(dt, b.psi + this.penD * 70 * DEG, true);
  }

  preStart(dt, t, sim, racer, course, up) {
    const b = this.b, clock = sim.race.clock, twd = waterTwd(b);
    const f = 0.15 + this.startFrac * 0.7;
    // (made good over the ground: leeway and the tide along the course count, and getting going from a luff; by the
    // speed through the water alone a Solent fleet 150 m below with the tide against it ran for the line a minute late)
    const cu = this.curAt(sim, b.x, b.z), tideUp = cu.x * course.ux + cu.z * course.uz;
    const vmgUp = (this.targetsUpBsp ?? 5 * KT) * Math.cos(up + (this.lee ?? 5 * DEG)) * 0.85 + tideUp;
    const [aB] = course.frame(b.x, b.z, course.pin.x, course.pin.z);
    const distToLine = -aB;
    const tNeed = distToLine / Math.max(0.6, vmgUp) + 12;
    const spot = { x: lerp(course.pin.x, course.committee.x, f), z: lerp(course.pin.z, course.committee.z, f) };
    let desired, luff = false;
    if (-clock > tNeed + 12) {
      // hold below the line: reach back and forth around a holding point
      // on the starboard-tack layline to the spot: close-hauled from straight below it sails the boat
      // out past the pin end (90 m below at ~45° made good = ~90 m to the left)
      // (the layline made good over the ground: a tide along the line lays starboard's track nearly along it, and
      // then she comes in on port, whose track climbs; held at the no-tide layline the fleet started a minute late)
      const Vt = this.targetsUpBsp ?? b.u, trk = (s) => wrap(twd + this.trackRel(s, up, 0.8 * Vt) - course.windDir);
      const dS = trk(1), dP = trk(-1), dl = Math.abs(dP) < Math.abs(dS) - 15 * DEG ? dP : dS;
      const lay = -90 * Math.tan(clamp(dl, -65 * DEG, 65 * DEG));
      const hold = { x: spot.x - course.ux * 90 + course.rx * lay, z: spot.z - course.uz * 90 + course.rz * lay };
      const dx = hold.x - b.x, dz = hold.z - b.z;
      if (Math.hypot(dx, dz) > 35) desired = Math.atan2(dx, -dz);
      else { desired = twd + Math.PI / 2 * (Math.sin(t * 0.05 + this.startFrac * 6) > 0 ? 1 : -1); luff = true; }
      this.psPhase = 'hold';
    } else {
      this.psPhase = 'run'; this.psNeed = tNeed;
      // time the run to the line: head for the spot. Inside the no-go zone, beat to it: hold the present
      // tack until the spot is near the other layline, then tack (steer() alone holds the present tack
      // for ever, sailing away past the end of the line)
      desired = Math.atan2(spot.x + course.ux * 10 - b.x, -(spot.z + course.uz * 10 - b.z));
      const rs = wrap(twd - desired), cur = Math.sign(wrap(twd - b.psi)) || 1;
      // the laylines are ground tracks (heading, leeway and tide): stay on this tack until the spot is on the
      // other tack's layline, then tack; outside the laylines just head for it
      // (the other tack's at the speed she will have out of the tack, and a touch past it: short of it, the tide
      // setting her along the line took the fleet to the pin end below the line at the gun and past it)
      const Vt = this.targetsUpBsp ?? b.u;
      const layC = Math.abs(this.trackRel(cur, up)), layO = Math.abs(this.trackRel(-cur, up, 0.8 * Vt));
      // (tacking only with way on, as on the beat)
      const vT = Math.max(0.5, Math.min(Vt, 0.45 * (b.diag.tws ?? 5)));
      if (Math.sign(rs) === cur ? Math.abs(rs) < layC : Math.abs(rs) < layO + 2 * DEG) desired = twd - cur * up;
      else if (Math.abs(rs) < up) {
        const going = this.psTackTo === -cur && t - this.psTackT < 10;   // (once begun, carried through)
        if (going || b.u >= 0.7 * vT) { if (!going) { this.psTackTo = -cur; this.psTackT = t; } desired = twd + cur * up; }
        else desired = twd - cur * up;
      }
      if (distToLine < 8 && -clock > 4) luff = true;
    }
    if (sim.rules) desired = aiRules(this, sim, this.gateTurn(sim.rules, desired, twd, up), 'prestart', t, up);
    if (!this.noTrim) autoTrim(b, dt, this.bias);
    if (this.ease) this.slow();
    this.steer(dt, desired);
    // (not while keeping clear of someone close: stopped, she only drifts down onto her)
    const R = sim.rules;
    if (luff && R && ((this.kc && this.kc.h !== null) || R.relsOf(b).some(pr => pr.d < 2 * b.cls.loa && R.owes(pr, b)))) luff = false;
    if (luff) { b.ctrl.main = 1; b.ctrl.jib = 1; b.ctrl.stay = 1; }
    if (b.sailBy.gennaker) b.ctrl.gen = false;
    this.mode = 'prestart';
  }

  // ground-track angle (relative to the wind, like rel) the boat would make close-hauled on tack s
  // (+1 starboard): heading, leeway to leeward, and the tide it feels (ground minus water velocity)
  trackRel(s, up, Vs) {
    const [gx, gz] = this.trackVel(s, up, Vs), twd = waterTwd(this.b);
    return wrap(Math.atan2(gx, -gz) - twd);
  }
  // her velocity over the ground close-hauled on tack s at Vs through the water (heading, leeway, the tide she is in)
  trackVel(s, up, Vs) {
    const b = this.b, twd = waterTwd(b);
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const cx = (b.vgx ?? 0) - (b.u * fx + b.v * sx), cz = (b.vgz ?? 0) - (b.u * fz + b.v * sz);
    const Vt = this.targetsUpBsp ?? b.u, V = Math.max(0.5, Vs ?? (this.vUp ? clamp(this.vUp, 0.6 * Vt, Vt) : Vt)), h = twd - s * (up + (this.lee ?? 5 * DEG));
    return [V * Math.sin(h) + cx, -V * Math.cos(h) + cz];
  }

  // the tide at (x, z): the environment's current field when the sim has one, else the tide the boat is in
  curAt(sim, x, z) {
    if (sim.env && sim.env.current) return sim.env.current.at(x, z, this._cur || (this._cur = {}));
    return { x: this.b.diag.curX ?? 0, z: this.b.diag.curZ ?? 0 };
  }
  // the tide's share of the ground made toward dest over the next ~2 minutes close-hauled on tack s: the
  // current where that tack takes the boat, resolved along the bearing to the mark (m/s)
  tideGain(sim, s, up, dest) {
    const b = this.b, twd = waterTwd(b), h = twd - s * (up + (this.lee ?? 5 * DEG));
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
  // the least depth along the track on heading h (what the coach tells: the shallows she steers round)
  shoalDepth(sim, h) {
    if (!this.log) return 0;
    const b = this.b, V = Math.max(b.u, 1.2), c = this.curAt(sim, b.x, b.z), gx = V * Math.sin(h) + c.x, gz = -V * Math.cos(h) + c.z;
    let m = 1e9; for (const s of [5, 12, 22, 40]) m = Math.min(m, sim.world.depthAt(b.x + gx * s, b.z + gz * s));
    return m;
  }
  // keep the desired heading if its track is clear; on a beat tack away from the shallows; otherwise the
  // nearest clear heading either side (or, if nothing is clear, the one with the most water)
  avoidShoals(sim, desired, mode, tack, up, twd, t) {
    if (this.clearance(sim, desired) > 0) return desired;
    if (mode === 'beat' && t - this.lastTack > 6) {
      const other = twd + tack * up, R = sim.rules;
      // a boat on the same tack to windward in the way: hail her for room to tack (20) when the shallows are close
      // (not before: the hail is only for when she will soon have to turn hard), and hold on meanwhile
      let blocked = false;
      if (R && this.clearance(sim, other) > 0 && !R.canTurn(b, other)) {
        let hl = R.hailOf(b);
        if (!hl && R.obstructionAhead(b, b.psi, Math.max(8 * b.cls.loa, 12 * Math.max(b.u, 1.5))) < 1e9) hl = R.hail(b);
        if (!hl || !hl.answered) { if (this.clearance(sim, desired) > -1.5) return desired; blocked = true; }   // (then bear away below)
      }
      if (!blocked && this.clearance(sim, other) > 0) { this.lastTack = t; this.note('tack', { why: 'shoal', to: -tack, depth: this.shoalDepth(sim, desired) }); return other; }
    }
    let best = desired, bestC = -1e9;
    for (let k = 1; k <= 14; k++) for (const s of [1, -1]) {
      const h = desired + s * k * 12 * DEG, c = this.clearance(sim, h);
      if (c > 0) { this.note('shoal', { off: k * 12, depth: this.shoalDepth(sim, desired) }); return h; }
      if (c > bestC) { bestC = c; best = h; }
    }
    this.note('shoal', { off: 180, depth: this.shoalDepth(sim, desired) });
    return best;
  }

  // (free: a penalty turn — no holding out of the no-go zone, no building speed before the tack)
  steer(dt, desired, free = false) {
    const b = this.b, d = b.diag;
    const twd = waterTwd(b);
    // close-hauled, but footing off to build speed when slow (a heavy boat that has stalled at the target
    // angle, in a lull or after a tack, never gets going again there: it only slides sideways)
    // (upwind target speed for the wind blowing now: the race-start polar overstates it in a lull)
    const vT = Math.max(0.5, Math.min(this.targetsUpBsp ?? 2, 0.45 * (d.tws ?? 5)));
    const slow = clamp(1 - b.u / (0.7 * vT), 0, 1);
    const up = (this.upAngle ?? 40 * DEG) * 0.95 + 40 * DEG * slow * slow;   // stopped: bear off to a close reach
    // never aim into the no-go zone: pinch at most to close-hauled on the nearer tack
    let rel = wrap(twd - desired);
    if (Math.abs(rel) < up && !free) desired = twd - (Math.sign(wrap(twd - b.psi)) || 1) * up;
    // no tacking from a standstill: bear away on the present tack and build speed first — but not for ever:
    // in a light patch with the tide under it the speed may never come, and holding on sailed the boat away
    // from the mark and onto the shore. After 25 s of that it goes round the other way, gybing (a slow boat
    // cannot tack, but it can always bear away through the wind astern)
    const tackNow = Math.sign(wrap(twd - b.psi)) || 1;
    if (this.buildTack !== tackNow) { this.buildTack = tackNow; this.buildT = 0; }
    const wantsOther = (Math.sign(wrap(twd - desired)) || 1) !== tackNow;
    if (wantsOther && !free && b.u < 0.5 * vT && Math.abs(wrap(twd - b.psi)) > 25 * DEG) {
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
// onTouch(boat, other): every contact, however light (the racing rules' umpire watches for them)
export function resolveCollisions(boats, marks, piers, onEvent, onTouch) {
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
      if (-vn > 0.4 && onEvent) onEvent(b, other, -vn, nx, nz);   // (nx, nz: the contact normal, for the damage model)
    }
  };
  const S = boats.map(seg);
  for (let i = 0; i < boats.length; i++) for (let j = i + 1; j < boats.length; j++) {
    if (Math.abs(boats[i].x - boats[j].x) > 30 || Math.abs(boats[i].z - boats[j].z) > 30) continue;   // (no hull is 30 m long)
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
      if (onTouch) onTouch(boats[i], boats[j]);
      push(boats[i], nx, nz, pen, boats[j]); push(boats[j], -nx, -nz, pen, boats[i]);
    }
  }
  for (let i = 0; i < boats.length; i++) {
    const s = S[i];
    for (const m of marks) {
      const [qx, qz] = closest(s, m.x, m.z);
      const dd = Math.hypot(qx - m.x, qz - m.z), rr = s.r + (m.kind === 'committee' ? 2.2 : 0.8);
      if (dd < rr) { const nx = (qx - m.x) / (dd || 1), nz = (qz - m.z) / (dd || 1); if (onTouch) onTouch(boats[i], m); push(boats[i], nx, nz, rr - dd, m); }
    }
    for (const p of piers) {
      const pts = p.pts;
      // (a pier's bounding box, once: a fleet near none of them skips the segment walk)
      const bb = p._bb || (p._bb = (() => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let k = 0; k + 1 < pts.length; k += 2) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); z0 = Math.min(z0, pts[k + 1]); z1 = Math.max(z1, pts[k + 1]); } return [x0, x1, z0, z1]; })());
      const pad = 12 + (p.w || 0);
      if (boats[i].x < bb[0] - pad || boats[i].x > bb[1] + pad || boats[i].z < bb[2] - pad || boats[i].z > bb[3] + pad) continue;
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
