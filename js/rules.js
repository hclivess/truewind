// The Racing Rules of Sailing 2025–2028, Part 2 (When Boats Meet), for fleet racing under an on-the-water umpire.
// Every pair of racing boats near each other gets a relationship each tick: who keeps clear and under which rule
// (10 opposite tacks, 11 windward/leeward, 12 clear astern, 13 tacking, 22 returning/taking a penalty, 23
// capsized/aground), who owes whom room (18 mark-room at the zone, 18.3 tacking in the zone, 19 an obstruction, 20
// a hail for room to tack), with 15 (acquiring right of way), 16 (changing course) and 17 (proper course) limiting
// the right-of-way boat. An infringement is contact, or a keep-clear boat leaving the right-of-way boat no way to
// sail her course (both boats' present motion closes to contact within two seconds: she must take avoiding action),
// or an overlapped one so close that the right-of-way boat cannot change course either way. The umpire acts at
// once on contact (14) and touching a mark (31); otherwise the boat infringed against protests (the AI always, the
// player with B) and the umpire decides on what it saw. A penalty is two turns (each one tack and one gybe, promptly,
// in the same direction: 44.2; one turn for rule 31) taken straight away; not taken in time, or still owed at the
// finish, is DSQ. Deterministic from the boats' state: every browser in an online race computes the same.
import { clamp, wrap } from './physics.js';

const DEG = Math.PI / 180;
export const RULE_TEXT = {
  '10': 'Opposite tacks: port keeps clear of starboard', '11': 'Same tack, overlapped: windward keeps clear',
  '12': 'Same tack, not overlapped: clear astern keeps clear', '13': 'While tacking: keep clear until close-hauled',
  '14': 'Avoiding contact', '15': 'Acquiring right of way: give room to keep clear', '16.1': 'Changing course: give room to keep clear',
  '17': 'Proper course: overlapped to leeward from astern', '18.2': 'Mark-room', '18.3': 'Tacking in the zone', '18.4': 'Gybing at a mark',
  '19': 'Room to pass an obstruction', '20': 'Room to tack at an obstruction', '20.1': 'Hailing for room to tack', '20.2': 'Responding to a hail',
  '22': 'Returning to start / taking a penalty: keep clear', '23': 'Capsized or aground: avoid her', '29.1': 'Individual recall (OCS)', '31': 'Touching a mark',
};
export const RULE_SHORT = { '10': 'port–starboard', '11': 'windward–leeward', '12': 'clear astern', '13': 'tacking', '14': 'contact', '15': 'acquiring right of way',
  '16.1': 'changing course', '17': 'proper course', '18.2': 'mark-room', '18.3': 'tacking in the zone', '18.4': 'gybing at the mark', '19': 'obstruction room',
  '20': 'room to tack', '20.1': 'hail', '20.2': 'hail not answered', '22': 'keep clear while returning / turning', '23': 'capsized boat', '29.1': 'OCS', '31': 'mark touched' };

const RANGE = 48;              // m: boats farther apart than this have nothing to settle between them
const CELL = 50;
// closest distance between segments AB and CD (Ericson, Real-Time Collision Detection 5.1.9)
export function segDist(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz, rx = ax - cx, rz = az - cz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s, t;
  if (a < 1e-9 && e < 1e-9) return Math.hypot(rx, rz);
  if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1x * rx + d1z * rz;
    if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const bb = d1x * d2x + d1z * d2z, den = a * e - bb * bb;
      s = den > 1e-9 ? clamp((bb * f - c * e) / den, 0, 1) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / a, 0, 1); }
    }
  }
  return Math.hypot(ax + d1x * s - cx - d2x * t, az + d1z * s - cz - d2z * t);
}
// hull and equipment in normal position: stem (plus a bowsprit: a retractable one only while it is out) to stern
const spritOf = (b) => { const C = b.cls; return C.bowsprit ? (b.sailBy && b.sailBy.gennaker ? (b.genDeploy > 0.05 ? C.bowsprit : 0) : C.bowsprit) : 0; };
// the hull as a capsule (a segment and a radius) at pose (x, z, psi)
function capsule(b, x, z, psi, o) {
  const C = b.cls, fx = Math.sin(psi), fz = -Math.cos(psi), r = C.beam * 0.47;
  const fw = C.bowX + spritOf(b) - r * 0.7, aft = C.sternX + r * 0.7;
  o.ax = x + fx * fw; o.az = z + fz * fw; o.bx = x + fx * aft; o.bz = z + fz * aft; o.r = r; return o;
}
const capDist = (p, q) => segDist(p.ax, p.az, p.bx, p.bz, q.ax, q.az, q.bx, q.bz) - p.r - q.r;
const _c1 = {}, _c2 = {};
// a boat's motion from now: ground velocity, turning as it is now but easing off (τ 1.5 s), sampled every dt to H
function track(b, H, dt, out = []) {
  let x = b.x, z = b.z, psi = b.psi, vx = b.vgx ?? b.u * Math.sin(b.psi), vz = b.vgz ?? -b.u * Math.cos(b.psi), t = 0, turned = 0;
  const r0 = clamp(b.r || 0, -0.6, 0.6);
  out.length = 0;
  for (let k = 0; t <= H + 1e-6; k++, t += dt) {
    out.push(x, z, psi);
    let dp = r0 * Math.exp(-t / 1.5) * dt;
    if (Math.abs(turned + dp) > Math.PI / 2) dp = 0;
    turned += dp; psi += dp;
    const c = Math.cos(dp), s = Math.sin(dp), nx = vx * c - vz * s, nz = vx * s + vz * c; vx = nx; vz = nz;
    x += vx * dt; z += vz * dt;
  }
  return out;
}
// least hull clearance between two sampled tracks (and when)
// (stop: give up once it is below that; samples whose centres are too far apart to matter are skipped)
const reach = (b) => Math.max(b.cls.bowX + spritOf(b), -b.cls.sternX) + b.cls.beam * 0.5;
function trackClear(a, ta, b, tb, dt, stop = -1e9) {
  let best = 1e9, when = 0;
  const n = Math.min(ta.length, tb.length), R2 = reach(a) + reach(b);
  for (let i = 0; i < n; i += 3) {
    const ex = ta[i] - tb[i], ez = ta[i + 1] - tb[i + 1], lim = best + R2;
    if (ex * ex + ez * ez > lim * lim) continue;
    const d = capDist(capsule(a, ta[i], ta[i + 1], ta[i + 2], _c1), capsule(b, tb[i], tb[i + 1], tb[i + 2], _c2));
    if (d < best) { best = d; when = (i / 3) * dt; if (best < stop) break; }
  }
  _when = when;
  return best;
}
let _when = 0;   // (when trackClear's least clearance comes, seconds ahead)

export class RuleEngine {
  // opts: race, course, world, piers (thick segments), owned(b) (this browser decides her penalties: online, only its
  // own boat), human(b) (sailed by a person: protests with a key, never automatically), raceId (online)
  constructor(opts = {}) {
    this.race = opts.race || null; this.course = opts.course || null; this.world = opts.world || null;
    this.piers = opts.piers || [];
    this.owned = opts.owned || (() => true); this.human = opts.human || (() => false);
    this.st = new Map(); this.pairs = new Map(); this.rels = new Map();
    this.incidents = []; this.events = [];
    this.t = 0; this.acc = 0; this.tick = 0; this.nid = 0; this.touches = [];
    this.hails = [];
  }
  get clock() { return this.race ? this.race.clock : this.t; }
  S(b) {
    let s = this.st.get(b);
    if (!s) {
      const twa = wrap((b.diag.twd ?? 0) - b.psi);
      s = { id: this.nid++, tack: Math.sign(twa) || 1, tacking: false, tackT: -1e9, gybeT: -1e9, changeT: -1e9, lastPsi: b.psi, hist: new Float64Array(72), hi: 0, hAcc: 0,
        pen: null, zone: new Map(), zoneTack: null, obsT: -1, obs: 1e9, r17: null };
      for (let i = 0; i < 72; i += 3) { s.hist[i] = b.psi; s.hist[i + 1] = b.x; s.hist[i + 2] = b.z; }
      this.st.set(b, s);
    }
    return s;
  }
  racerOf(b) {
    if (!this.race) { const m = this._free || (this._free = new Map()); let r = m.get(b); if (!r) m.set(b, r = { leg: 0, finished: false, started: true, boat: b }); return r; }
    if (!this._rmap || this._rmapN !== this.race.racers.length) { this._rmap = new Map(this.race.racers.map(r => [r.boat, r])); this._rmapN = this.race.racers.length; }
    const r = this._rmap.get(b);
    if (r) return r;
    const n = b.netRace;   // an online boat in the same race: her owner reports her leg
    return n && this.raceId && n.id === this.raceId ? { leg: n.leg, finished: !!n.fin, started: n.leg > 0, remote: true, ocs: !!n.ocs } : null;
  }
  // the close-hauled angle the rules use for "on a close-hauled course" (13) and "above close-hauled" (18.3, 20.1)
  // (the fleet's upwind target from the polar when the game has one)
  closeHauled(b) { return clamp(this.upTwa ?? 40, 32, 46) * DEG; }

  // ------------------------------------------------------------------ per step
  step(dt, boats) {
    this.t += dt;
    for (const b of boats) this.boatStep(b, dt);
    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0; this.tick++;
    this.evaluate(boats);
  }

  boatStep(b, dt) {
    const s = this.S(b), twa = wrap((b.diag.twd ?? 0) - b.psi), a = Math.abs(twa);
    // tack = the windward side; head to wind it stays what it was; running by the lee the mainsail's side decides
    let tk = s.tack;
    if (a < 150 * DEG) { if (twa > 2 * DEG) tk = 1; else if (twa < -2 * DEG) tk = -1; }
    else { const bm = b.booms && b.booms.main ? b.booms.main.a : 0; tk = Math.abs(bm) > 0.08 ? -Math.sign(bm) : (Math.sign(twa) || tk); }
    if (tk !== s.tack) {
      const tacked = a < 90 * DEG;
      s.tack = tk; s.changeT = this.t;
      if (tacked) { s.tackT = this.t; s.tacking = true; } else { s.gybeT = this.t; s.tacking = false; }
      if (s.pen) { if (tacked) s.pen.tk++; else s.pen.gy++; }
      // 18.3: passed head to wind from port to starboard inside the zone of a mark left to port
      if (tacked && tk > 0) for (const [m, z] of s.zone) if (z.in && m.side === 'port') s.zoneTack = { m, t: this.t };
      if (tacked) for (const [, z] of s.zone) z.stbd = false;
    }
    // close-hauled on the new tack (or settled just short of it, no longer turning): the tack is complete
    if (s.tacking && (a >= this.closeHauled(b) * 0.95 || (a > 26 * DEG && Math.abs(b.r || 0) < 3 * DEG && this.t - s.tackT > 1.5) || this.t - s.tackT > 40)) s.tacking = false;
    const dpsi = wrap(b.psi - s.lastPsi); s.lastPsi = b.psi;
    s.hAcc += dt;
    if (s.hAcc >= 0.25) { s.hAcc = 0; s.hi = (s.hi + 1) % 24; s.hist[s.hi * 3] = b.psi; s.hist[s.hi * 3 + 1] = b.x; s.hist[s.hi * 3 + 2] = b.z; }
    // penalty turns: the heading turned through in one direction, promptly, counting the tacks and gybes made
    const p = s.pen;
    if (p && !p.done) {
      p.acc += dpsi;
      if (!p.dir && Math.abs(p.acc) > 40 * DEG) p.dir = Math.sign(p.acc);
      if (Math.abs(b.r || 0) > 3 * DEG) p.idle = 0; else p.idle += dt;
      if (p.dir && (p.acc * p.dir < p.max - 100 * DEG || p.idle > 12)) { p.acc = 0; p.dir = 0; p.max = 0; p.tk = 0; p.gy = 0; }   // turned back, or stopped turning
      else if (!p.dir && p.idle > 12) { p.acc = 0; p.tk = 0; p.gy = 0; }
      if (p.dir) p.max = Math.max(p.max, p.acc * p.dir);
      p.made = Math.min(p.turns, Math.floor((p.max + 25 * DEG) / (2 * Math.PI)), p.tk, p.gy);
      if (p.made >= p.turns) this.penaltyDone(b, s);
    }
  }
  // heading (and position) the boat had `sec` seconds ago (a quarter-second record of the last six)
  psiAgo(s, sec, o = 0) { const k = Math.min(23, Math.round(sec / 0.25)); return s.hist[((s.hi - k + 48) % 24) * 3 + o]; }

  // ------------------------------------------------------------------ marks, zones, obstructions
  // the marks a boat must now leave on a side (rule 18 does not apply at a starting mark while boats start)
  marksOf(b) {
    const r = this.racerOf(b), C = this.course;
    if (!r || !C || r.finished || r.retired) return null;
    const leg = C.legs[Math.min(r.leg, C.legs.length - 1)];
    if (!leg || leg.type === 'start') return null;
    if (leg.type === 'mark') { leg.mark.side = 'port'; return [leg.mark]; }
    if (leg.type === 'gate') {
      C.gateL.side = 'starboard'; C.gateR.side = 'port'; C.gateL.gate = C.gateR.gate = true;
      return [Math.hypot(b.x - C.gateL.x, b.z - C.gateL.z) < Math.hypot(b.x - C.gateR.x, b.z - C.gateR.z) ? C.gateL : C.gateR];
    }
    if (leg.type === 'finish') { C.pin.side = 'starboard'; C.committee.side = 'port'; return [Math.hypot(b.x - C.pin.x, b.z - C.pin.z) < Math.hypot(b.x - C.committee.x, b.z - C.committee.z) ? C.pin : C.committee]; }
    return null;
  }
  // distance to the first obstruction (land, a shoal she cannot sail over, a pier) along heading h, up to range
  obstructionAhead(b, h, range) {
    const W = this.world; if (!W || W.open || !W.depthAt) return 1e9;
    const need = b.cls.draft + 0.3, fx = Math.sin(h), fz = -Math.cos(h);
    for (let d = 4; d <= range; d += 4) if (W.depthAt(b.x + fx * d, b.z + fz * d) < need) return d;
    for (const p of this.piers) {
      const P = p.pts; if (!P) continue;
      for (let k = 0; k + 3 < P.length; k += 2) {
        if (Math.abs(P[k] - b.x) > range + 50 && Math.abs(P[k + 2] - b.x) > range + 50) continue;
        const d = segDist(b.x, b.z, b.x + fx * range, b.z + fz * range, P[k], P[k + 1], P[k + 2], P[k + 3]);
        if (d < (p.w || 2) / 2 + b.cls.beam) return Math.min(range, Math.hypot(P[k] - b.x, P[k + 1] - b.z));
      }
    }
    return 1e9;
  }

  // ------------------------------------------------------------------ the pairs
  evaluate(boats) {
    const t = this.t;
    // who is racing: rules of Part 2 apply between boats racing (from the start sequence until they finish)
    const racing = [];
    for (const b of boats) { const r = this.racerOf(b); if (r || !this.race) racing.push(b); }
    // zones: each boat's marks, whether she is in the zone, on starboard since she entered it
    for (const b of racing) {
      const s = this.S(b), ms = this.marksOf(b);
      s.marks = ms;
      for (const [m, z] of s.zone) if (!ms || !ms.includes(m)) s.zone.delete(m);
      if (ms) for (const m of ms) {
        const d = Math.hypot(b.x - m.x, b.z - m.z) - b.cls.loa / 2;
        let z = s.zone.get(m);
        if (!z) { z = { in: false, stbd: false, t: 0, dmin: 1e9, gybed: false }; s.zone.set(m, z); }
        z.d = d; z.dmin = Math.min(z.dmin, d);
        const inNow = d < 3 * b.cls.loa;
        if (inNow && !z.in) { z.t = t; z.stbd = s.tack > 0 && !s.tacking; }
        z.in = inNow;
        if (!inNow && s.zoneTack && s.zoneTack.m === m && d > 4 * b.cls.loa) s.zoneTack = null;
      }
    }
    // OCS at the gun: rule 29.1, the X flag
    if (this.race) for (const r of this.race.racers) if (r.ocs && !r._ocsLogged) { r._ocsLogged = true; this.log({ rule: '29.1', off: r.boat, vic: null, kind: 'ocs', status: 'ocs' }); }
    // spatial hash: only neighbours are paired (a fleet of 30 in a knot is 435 pairs; spread out, a handful)
    const grid = new Map();
    for (const b of racing) {
      const k = (Math.floor(b.x / CELL) + 32768) * 65536 + Math.floor(b.z / CELL) + 32768;
      let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(b);
    }
    this.rels.clear();
    for (const b of racing) this.rels.set(b, []);
    for (const a of racing) {
      const ix = Math.floor(a.x / CELL), iz = Math.floor(a.z / CELL), sa = this.S(a);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const c = grid.get((ix + dx + 32768) * 65536 + iz + dz + 32768); if (!c) continue;
        for (const b of c) {
          const sb = this.S(b);
          if (sb.id <= sa.id) continue;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d > RANGE) continue;
          const key = sa.id * 100003 + sb.id;
          let pr = this.pairs.get(key);
          if (!pr) { pr = { key, a, b, acq: null, give: null, mr: null, r17: null, lastInc: -1e9, contact: false }; this.pairs.set(key, pr); }
          pr.seen = this.tick; pr.d = d;
          this.relate(pr, a, b, sa, sb);
          this.rels.get(a).push(pr); this.rels.get(b).push(pr);
        }
      }
    }
    // a boat between two others that overlaps both makes them overlap too (for rule 18: the chain inside at a mark)
    for (const pr of this.pairs.values()) {
      if (pr.seen !== this.tick || pr.overlap || !pr.mr || pr.d > 25) continue;     // (it matters only at a mark: rule 18)
      for (const q of this.rels.get(pr.a)) {
        if (!q.overlap || q.seen !== this.tick) continue;
        const c = q.a === pr.a ? q.b : q.a;
        if (c === pr.b) continue;
        const q2 = this.pairOf(c, pr.b);
        if (q2 && q2.overlap && q2.seen === this.tick && this.between(c, pr.a, pr.b)) { pr.overlap = true; pr.astern = null; pr.chain = true; this.relate(pr, pr.a, pr.b, this.S(pr.a), this.S(pr.b), true); break; }
      }
    }
    for (const [k, pr] of this.pairs) if (pr.seen !== this.tick) this.pairs.delete(k);
    for (const pr of this.pairs.values()) this.judge(pr);
    this.touches.length = 0;
    this.hailStep();
    this.umpire();
  }
  // a boat's track ahead (12 s, every half second), once per evaluation for every crew that plans around her
  trackOf(b) {
    const c = this._tr || (this._tr = new Map());
    let e = c.get(b);
    if (!e) c.set(b, e = { tick: -1, a: [] });
    if (e.tick !== this.tick) { e.tick = this.tick; track(b, 12, 0.5, e.a); }
    return e.a;
  }
  pairOf(a, b) { const x = this.S(a).id, y = this.S(b).id; return this.pairs.get(Math.min(x, y) * 100003 + Math.max(x, y)); }
  between(c, a, b) { const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1, f = ((c.x - a.x) * ux + (c.z - a.z) * uz) / L2; return f > 0 && f < 1; }

  // the relationship between two boats now: who keeps clear, under which rule; who owes room
  relate(pr, A, B, SA, SB, chained = false) {
    const fA0 = Math.sin(A.psi), fA1 = -Math.cos(A.psi), fB0 = Math.sin(B.psi), fB1 = -Math.cos(B.psi);
    const bowA = A.cls.bowX + spritOf(A), bowB = B.cls.bowX + spritOf(B);
    // clear astern: her hull and equipment behind a line abeam from the other's aftermost point (the transom)
    const sternAx = A.x + fA0 * A.cls.sternX, sternAz = A.z + fA1 * A.cls.sternX, sternBx = B.x + fB0 * B.cls.sternX, sternBz = B.z + fB1 * B.cls.sternX;
    const bAst = (B.x + fB0 * bowB - sternAx) * fA0 + (B.z + fB1 * bowB - sternAz) * fA1;   // < 0: B clear astern of A
    const aAst = (A.x + fA0 * bowA - sternBx) * fB0 + (A.z + fA1 * bowA - sternBz) * fB1;
    const prevOverlap = pr.overlap, prevAstern = pr.astern;
    if (!chained) {
      pr.overlap = !(bAst < 0 || aAst < 0);
      pr.astern = bAst < 0 && aAst < 0 ? (bAst < aAst ? B : A) : bAst < 0 ? B : aAst < 0 ? A : null;
      pr.chain = false;
    }
    pr.sameTack = SA.tack === SB.tack;
    // leeward: on the other's leeward side (the mean heading's frame, so it is one answer for both)
    const sx = Math.cos(A.psi) + Math.cos(B.psi), sz = Math.sin(A.psi) + Math.sin(B.psi);
    const lat = (B.x - A.x) * sx + (B.z - A.z) * sz;   // > 0: B to starboard of A
    pr.leeward = pr.sameTack ? ((lat > 0) === (SA.tack > 0) ? A : B) : null;   // starboard tack: leeward is to port
    const rA = this.racerOf(A), rB = this.racerOf(B);
    const capA = !!(A.capsized || A.aground > 0.05), capB = !!(B.capsized || B.aground > 0.05);
    const penA = !!(SA.pen && !SA.pen.done && SA.pen.dir), penB = !!(SB.pen && !SB.pen.done && SB.pen.dir);
    const retA = !!(rA && rA.ocs && this.race && this.race.clock > 0), retB = !!(rB && rB.ocs && this.race && this.race.clock > 0);
    let give = null, rule = null;
    if (capA !== capB) { give = capA ? B : A; rule = '23'; }
    else if (penA !== penB) { give = penA ? A : B; rule = '22'; }
    else if (retA !== retB) { give = retA ? A : B; rule = '22'; }
    else if (SA.tacking || SB.tacking) {
      rule = '13';
      if (SA.tacking && SB.tacking) give = pr.astern || (lat > 0 ? A : B);   // both: the one astern, or on the other's port side
      else give = SA.tacking ? A : B;
    } else if (!pr.sameTack) { give = SA.tack < 0 ? A : B; rule = '10'; }
    else if (pr.overlap) { give = pr.leeward === A ? B : A; rule = '11'; }
    else { give = pr.astern || (aAst < bAst ? A : B); rule = '12'; }
    // 15: right of way changed hands; did the new keep-clear boat do it herself (tacked, gybed, began turning)?
    if (pr.give && give !== pr.give && rule !== '23') {
      const sg = give === A ? SA : SB;
      // (she caused it herself: a tack or gybe, a sharp turn, or starting a penalty or returning to start)
      pr.acq = { t: this.t, row: give === A ? B : A, own: !(this.t - sg.changeT < 2.5 || rule === '22' || Math.abs(wrap(give.psi - this.psiAgo(sg, 2.5))) > 20 * DEG) };
    }
    pr.give = give; pr.rule = rule;
    // 17: overlapped to leeward from clear astern within two of her lengths: no sailing above her proper course
    if (pr.sameTack && pr.overlap && prevOverlap === false && prevAstern && prevAstern === pr.leeward && Math.abs(lat) / Math.hypot(sx, sz) < 2 * prevAstern.cls.loa && !(this.S(pr.leeward === A ? B : A).tacking)) pr.r17 = pr.leeward;
    if (pr.r17 && (!pr.sameTack || !pr.overlap || Math.abs(lat) / Math.hypot(sx, sz) > 2 * pr.r17.cls.loa)) pr.r17 = null;
    // ---- room
    pr.room = null;
    const ms = SA.marks && SB.marks ? SA.marks.find(m => SB.marks.includes(m)) : null;
    const beating = Math.abs(wrap((A.diag.twd ?? 0) - A.psi)) < 75 * DEG && Math.abs(wrap((B.diag.twd ?? 0) - B.psi)) < 75 * DEG;
    let r18 = false;
    if (ms && !(!pr.sameTack && beating)) {    // 18.1(a): not between boats on opposite tacks on a beat
      const zA = SA.zone.get(ms), zB = SB.zone.get(ms);
      if (zA && zB && (zA.in || zB.in)) {
        r18 = true;
        if (!pr.mr || pr.mr.m !== ms) {
          // 18.2(b): fixed when the first of them reaches the zone: overlapped, the inside boat; else the one clear ahead
          const inside = zA.d < zB.d ? A : B;
          const ent = pr.overlap ? inside : (pr.astern === A ? B : pr.astern === B ? A : inside);
          pr.mr = { m: ms, ent, giver: ent === A ? B : A, t: this.t, over: pr.overlap };
        }
        const se = this.S(pr.mr.ent), ze = pr.mr.ent === A ? zA : zB;
        // 18.2(d): no longer owed once she has passed head to wind or left the zone
        if (se.tackT > pr.mr.t || !ze.in) pr.mr.done = true;
        // (a boat that became overlapped inside later is not owed room: 18.2(b); an overlap from clear astern
        // inside, at a mark, gets it only when she was overlapped at the zone)
        if (!pr.mr.done) pr.room = { ent: pr.mr.ent, giver: pr.mr.giver, rule: '18.2' };
        // 18.3: tacked port to starboard in the zone of a mark left to port, against a boat on starboard since the zone
        const tX = SA.zoneTack && SA.zoneTack.m === ms ? A : SB.zoneTack && SB.zoneTack.m === ms ? B : null;
        if (tX) {
          const Y = tX === A ? B : A, zY = Y === A ? zA : zB;
          if (zY.stbd && this.S(Y).tack > 0 && !(this.S(Y).zoneTack && this.S(Y).zoneTack.m === ms)) { pr.room = null; give = tX; pr.give = tX; pr.rule = rule = '18.3'; }
        }
      }
    }
    if (!r18) pr.mr = null;
    // 19: overlapped at an obstruction they pass on the same side: the outside boat gives the inside one room
    if (!r18 && pr.overlap && pr.sameTack && this.world && !this.world.open) {
      const inner = this.obsSide(A, B);
      if (inner) pr.room = { ent: inner, giver: inner === A ? B : A, rule: '19' };
    }
    // 20: a hail for room to tack (from the hail until the hailing boat has tacked and is clear)
    for (const h of this.hails) if (!h.over && ((h.from === A && h.to === B) || (h.from === B && h.to === A))) pr.room = { ent: h.from, giver: h.to, rule: '20', hail: h };
  }
  // rule 19: is there an obstruction just ahead of one of two overlapped boats, on her side away from the other?
  obsSide(A, B) {
    const W = this.world;
    for (const [P, Q] of [[A, B], [B, A]]) {
      const fx = Math.sin(P.psi), fz = -Math.cos(P.psi), sx = Math.cos(P.psi), sz = Math.sin(P.psi);
      const side = Math.sign((Q.x - P.x) * sx + (Q.z - P.z) * sz) || 1;       // Q on P's starboard (+1) or port side
      const L = P.cls.loa, need = P.cls.draft + 0.3;
      // shoal water ahead on P's far side from Q, none on Q's side: P must bear toward Q to pass it
      let far = false;
      for (const k of [1.5, 3]) if (W.depthAt(P.x + fx * L * k - sx * side * P.cls.beam * 1.5, P.z + fz * L * k - sz * side * P.cls.beam * 1.5) < need) far = true;
      if (far && W.depthAt(Q.x + fx * L * 2, Q.z + fz * L * 2) >= need) return P;
    }
    return null;
  }

  // ------------------------------------------------------------------ infringements
  judge(pr) {
    const A = pr.a, B = pr.b, K = pr.give, R = K === A ? B : A;
    if (!K) return;
    const t = this.t;
    let contact = false;
    for (const [x, y] of this.touches) if ((x === A && y === B) || (x === B && y === A)) contact = true;
    // a couple of seconds ahead on both boats' present motion (she turns as she is turning now)
    const La = A.cls.loa, Lb = B.cls.loa;
    const vA = Math.hypot(A.vgx ?? A.u, A.vgz ?? 0), vB = Math.hypot(B.vgx ?? B.u, B.vgz ?? 0);
    let clr = 1e9, when = 0, now = 1e9;
    // (first the centres' closest approach in a straight line: most pairs are nowhere near touching)
    const rvx = (B.vgx ?? 0) - (A.vgx ?? 0), rvz = (B.vgz ?? 0) - (A.vgz ?? 0), rx = B.x - A.x, rz = B.z - A.z;
    const tc = clamp(-(rx * rvx + rz * rvz) / (rvx * rvx + rvz * rvz || 1), 0, 2), cpa = Math.hypot(rx + rvx * tc, rz + rvz * tc);
    if (cpa < reach(A) + reach(B) + 3) {
      const ta = track(A, 2, 0.25, this._ta || (this._ta = [])), tb = track(B, 2, 0.25, this._tb || (this._tb = []));
      clr = trackClear(A, ta, B, tb, 0.25); when = _when;
      now = capDist(capsule(A, A.x, A.z, A.psi, _c1), capsule(B, B.x, B.z, B.psi, _c2));
    }
    pr.clr = clr; pr.when = when; pr.now = now;
    // keep clear (definition): the right-of-way boat can sail her course with no need to take avoiding action and,
    // overlapped, change course both ways without immediately making contact
    const forced = clr < 0.12 && when <= 2 || (pr.overlap && now < 0.2);
    if (!contact && !forced) return;
    if (t - pr.lastInc < 20) return;       // one incident per encounter
    pr.lastInc = t;
    const rK = this.racerOf(K), rR = this.racerOf(R);
    if (!rK && !rR) return;
    let off = K, vic = R, rule = pr.rule;
    const room = pr.room, SR = this.S(R);
    if (room && room.giver === R && room.ent === K) { off = R; vic = K; rule = room.rule === '20' ? '20.2' : room.rule; }   // 21: exonerated inside her room
    else if (room && room.giver === K) rule = room.rule === '20' ? '20.2' : room.rule;
    else if (pr.acq && pr.acq.row === R && pr.acq.own && t - pr.acq.t < 3) { off = R; vic = K; rule = '15'; }
    else if (rule !== '23' && rule !== '22') {
      // 16.1: the right-of-way boat changed course lately, and on her old course the other was keeping clear
      const old = this.psiAgo(SR, 2.5), turn = wrap(R.psi - old);
      if (Math.abs(turn) > 12 * DEG && !(SR.marks && SR.marks.some(m => SR.zone.get(m)?.in))) {
        // where she would be now, and going, had she held that course
        const vx = (R.vgx ?? 0) * Math.cos(-turn) - (R.vgz ?? 0) * Math.sin(-turn), vz = (R.vgx ?? 0) * Math.sin(-turn) + (R.vgz ?? 0) * Math.cos(-turn);
        const keep = { x: this.psiAgo(SR, 2.5, 1) + vx * 2.5, z: this.psiAgo(SR, 2.5, 2) + vz * 2.5, psi: old, u: R.u, r: 0, vgx: vx, vgz: vz, cls: R.cls, sailBy: R.sailBy, genDeploy: R.genDeploy };
        const c2 = trackClear(keep, track(keep, 2, 0.25, []), K, track(K, 2, 0.25, []), 0.25);
        if (c2 > 0.3) { off = R; vic = K; rule = '16.1'; }
      }
      // 17: sailing above her proper course, overlapped to leeward from clear astern
      if (off === K && pr.r17 === R && this.aboveProper(R, SR)) { off = R; vic = K; rule = '17'; }
      // 18.4: the inside boat owed mark-room carried on past the mark instead of gybing
      const z = room && room.ent === R && SR.marks ? SR.zone.get(SR.marks[0]) : null;
      if (off === K && z && !SR.marks[0].gate && z.d > z.dmin + 2 * R.cls.loa && SR.gybeT < z.t) { off = R; vic = K; rule = '18.4'; }
    }
    this.log({ rule, off, vic, kind: contact ? 'contact' : 'avoid', status: 'pending' });
  }
  // above her proper course: higher than the course to her next mark (close-hauled when that is to windward)
  aboveProper(b, s) {
    const C = this.course, r = this.racerOf(b); if (!C || !r) return false;
    const tgt = C.target(C.legs[Math.min(r.leg, C.legs.length - 1)], b), twd = b.diag.twd ?? 0;
    const want = Math.max(this.closeHauled(b), Math.abs(wrap(Math.atan2(tgt.x - b.x, -(tgt.z - b.z)) - twd)));
    return Math.abs(wrap(twd - b.psi)) < want - 15 * DEG;
  }
  // contact, as the collision pass found it (boats, or a boat and a mark)
  touch(b, other) {
    if (other && other.cls) { this.touches.push([b, other]); return; }
    const C = this.course; if (!C || !other) return;
    if (!(C.marks().includes(other) || other === C.committee)) return;     // (the real buoys around are obstructions, not marks of the course)
    const r = this.racerOf(b); if (!r || r.finished || r.retired) return;
    const s = this.S(b); s.markT = s.markT || new Map();
    if (this.t - (s.markT.get(other) ?? -1e9) < 20) return;
    s.markT.set(other, this.t);
    this.log({ rule: '31', off: b, vic: null, kind: 'mark', status: 'pending', mark: other });
  }

  // ------------------------------------------------------------------ hails (rule 20)
  // b hails for room to tack: the boat on the same tack, overlapped, to windward, close enough to be in the way
  hail(b) {
    if (this.hails.some(h => h.from === b && !h.over)) return this.hails.find(h => h.from === b && !h.over);
    const s = this.S(b); let best = null, bd = 1e9;
    for (const pr of this.rels.get(b) || []) {
      const o = pr.a === b ? pr.b : pr.a;
      if (!pr.sameTack || pr.leeward !== b || (!pr.overlap && pr.astern !== b) || pr.d > 4 * b.cls.loa + 6) continue;
      if (pr.d < bd) { bd = pr.d; best = o; }
    }
    if (!best) return null;
    // 20.1: only when approaching an obstruction she will soon have to turn hard to avoid, and not below close-hauled
    const twa = Math.abs(wrap((b.diag.twd ?? 0) - b.psi));
    const near = this.obstructionAhead(b, b.psi, Math.max(8 * b.cls.loa, 12 * Math.max(b.u, 1.5)));
    const valid = near < 1e9 && twa < this.closeHauled(b) + 12 * DEG;
    const h = { from: b, to: best, t: this.t, valid, answered: null, over: false, pass: false };
    this.hails.push(h);
    this.events.push({ type: 'hail', from: b, to: best, valid });
    if (!valid) this.log({ rule: '20.1', off: b, vic: best, kind: 'hail', status: 'pending' });
    return h;
  }
  hailTo(b) { return this.hails.find(h => h.to === b && !h.over && !h.answered) || null; }
  hailOf(b) { return this.hails.find(h => h.from === b && !h.over) || null; }
  respond(b, youTack = false) { const h = this.hailTo(b); if (h) { h.answered = this.t; h.youTack = youTack; this.events.push({ type: 'respond', from: b, to: h.from, youTack }); } return h; }
  hailStep() {
    const t = this.t;
    for (const h of this.hails) {
      if (h.over) continue;
      const so = this.S(h.to), sf = this.S(h.from), Tr = 3 + h.to.cls.loa * 0.4;
      if (!h.answered && so.changeT > h.t) { h.answered = so.changeT; this.events.push({ type: 'respond', from: h.to, to: h.from }); }
      // 20.2(c): the hailed boat tacks as soon as possible (or says 'You tack' and gives room)
      if (!h.answered && t - h.t > Tr && !h.late) { h.late = true; this.log({ rule: '20.2', off: h.to, vic: h.from, kind: 'hail', status: 'pending' }); }
      // 20.2(d): once answered, the hailing boat tacks as soon as possible
      if (h.answered && sf.tackT < h.answered && t - h.answered > 3 + h.from.cls.loa * 0.4 + 4 && !h.slow) { h.slow = true; this.log({ rule: '20.2', off: h.from, vic: h.to, kind: 'hail', status: 'pending' }); }
      if ((sf.tackT > h.t && t - sf.tackT > 8) || t - h.t > 45) h.over = true;
    }
    this.hails = this.hails.filter(h => !h.over || t - h.t < 60);
  }

  // ------------------------------------------------------------------ incidents, protests, penalties
  log(inc) {
    inc.id = this.incidents.length + 1; inc.t = this.clock; inc.at = this.t;
    this.incidents.push(inc);
    this.events.push({ type: 'incident', inc });
  }
  umpire() {
    const t = this.t;
    for (const inc of this.incidents) {
      if (inc.status !== 'pending') continue;
      const age = t - inc.at;
      // the umpire's own initiative: contact (14) and touching a mark (31)
      if (inc.kind === 'contact') { this.decide(inc, null); continue; }
      if (inc.kind === 'mark' && age > 0.5) {
        // 43.1: pushed onto the mark by another boat's breach, she is exonerated
        if (this.incidents.some(x => x.vic === inc.off && x.kind !== 'mark' && inc.at - x.at < 6 && inc.at - x.at > -2)) inc.status = 'exonerated';
        else this.decide(inc, null);
        continue;
      }
      if (inc.kind === 'mark') continue;
      // the boat infringed against protests: an AI crew at once, a person within 12 s (B)
      // (a crew lets a boat busy with her turns off when it came to nothing: no protest under 22 without contact)
      if (inc.vic && !this.human(inc.vic) && age > 0.8) {
        if (inc.rule === '22') { inc.status = 'noprotest'; continue; }
        this.events.push({ type: 'protest', by: inc.vic, inc }); this.decide(inc, inc.vic); continue;
      }
      if (age > 12) inc.status = 'noprotest';
    }
    for (const [b, s] of this.st) {
      const p = s.pen; if (!p || p.done) continue;
      const r = this.racerOf(b);
      if (r && r.retired && !r.dsq) { s.pen = null; continue; }        // (out of the race for another reason: nothing to take)
      if (p.dir && t > p.deadline && t < p.deadline + 30) continue;    // (turning when time is up: she may finish them)
      if ((r && r.finished) || t > p.deadline) this.dsq(b, s, r && r.finished ? 'finished with the penalty not taken' : 'penalty not taken');
    }
  }
  // the umpire rules on an incident: a penalty for the boat that broke a rule (if she is still racing)
  decide(inc, by) {
    const r = this.racerOf(inc.off);
    if (!r || r.finished || r.dsq || r.retired) { inc.status = 'norace'; return; }
    inc.status = 'penalty'; inc.by = by;
    inc.turns = inc.rule === '31' ? 1 : 2;
    if (this.owned(inc.off)) this.penalize(inc.off, inc);
  }
  penalize(b, inc) {
    const s = this.S(b), turns = inc.turns;
    if (s.pen && !s.pen.done) { s.pen.turns += turns; s.pen.deadline += 50 * turns; s.pen.incs.push(inc); }
    else s.pen = { turns, rule: inc.rule, t0: this.t, deadline: this.t + 60 + 50 * turns, acc: 0, dir: 0, max: 0, tk: 0, gy: 0, idle: 0, made: 0, incs: [inc], done: false };
    const r = this.racerOf(b); if (r && !r.remote) r.pens = (r.pens || 0) + 1;
    this.events.push({ type: 'penalty', boat: b, inc, pen: s.pen });
  }
  penaltyDone(b, s) {
    s.pen.done = true;
    for (const i of s.pen.incs) i.status = 'taken';
    this.events.push({ type: 'penaltyDone', boat: b, pen: s.pen });
    s.pen = null;
  }
  dsq(b, s, why) {
    for (const i of s.pen.incs) i.status = 'dsq';
    // DSQ, and out of the race the one way every retirement goes (Race.retire: she is no longer scored as she sails)
    const r = this.racerOf(b); if (r && !r.remote) { r.dsq = s.pen.rule; r.dsqWhy = why; if (this.race && !r.finished) this.race.retire(b, `DSQ — ${why} (rule ${s.pen.rule})`); }
    this.events.push({ type: 'dsq', boat: b, rule: s.pen.rule, why });
    s.pen = null;
  }
  // a person protests (B): the umpire looks at the last incident against her
  protest(b) {
    const t = this.t;
    let inc = null;
    for (let i = this.incidents.length - 1; i >= 0; i--) {
      const x = this.incidents[i];
      if (t - x.at > 15) break;
      if (x.vic === b && (x.status === 'pending' || x.status === 'noprotest')) { inc = x; break; }
    }
    if (!inc) { this.events.push({ type: 'noPenalty', by: b }); return null; }
    this.events.push({ type: 'protest', by: b, inc });
    this.decide(inc, b);
    return inc;
  }
  // an online penalty from the room: the other sailor protested and her umpire (the same rules) upheld it
  remotePenalty(b, rule) {
    // (the incident as this browser saw it, if it did)
    let inc = this.incidents.slice().reverse().find(i => i.off === b && (i.status === 'pending' || i.status === 'noprotest') && this.t - i.at < 30);
    if (!inc) { inc = { rule, off: b, vic: null, kind: 'avoid', status: 'pending', remote: true }; this.log(inc); }
    this.decide(inc, inc.vic);
  }
  penaltyOf(b) { const s = this.st.get(b); return s && s.pen && !s.pen.done ? s.pen : null; }
  relsOf(b) { return this.rels.get(b) || []; }
  // does b have to keep clear of (or give room to) the other boat of this pair?
  owes(pr, b) {
    if (pr.room && pr.room.ent === b) return false;          // sailing in her room: the other owes it
    return pr.give === b || !!(pr.room && pr.room.giver === b);
  }
  // could b turn onto heading h now without leaving anyone near unable to keep clear, or forcing herself on them
  // (13, 15, 16)? the turn costs speed; the others hold their course
  canTurn(b, h, H = 12) {
    const c = this._ct || (this._ct = new Map()), k = c.get(b);         // (asked every step: a quarter-second answer)
    if (k && this.t - k.t < 0.25 && Math.abs(wrap(h - k.h)) < 8 * DEG && k.H === H) return k.v;
    const v = this.turnClear(b, h, H);
    c.set(b, { t: this.t, h, H, v });
    return v;
  }
  turnClear(b, h, H) {
    // (a slow boat takes longer over it: four seconds at speed, up to ten when she is barely moving)
    const vT = Math.min(3.5, 0.4 * (b.diag.tws ?? 5)), T1 = clamp(4 * vT / Math.max(b.u, 0.4), 4, 10);
    H += T1 - 4;
    const V = Math.max(b.u, 1) * 0.6, dt = 0.5, me = { cls: b.cls, sailBy: b.sailBy, genDeploy: b.genDeploy };
    const tb = [];
    const mid = b.psi + wrap(h - b.psi) / 2;
    let x = b.x, z = b.z;
    for (let t = 0; t <= H + 1e-6; t += dt) {
      const p = t < T1 ? mid + wrap(h - mid) * t / T1 : h, v = t < T1 ? V * 0.35 : V;   // (all but stopped through the wind)
      tb.push(x, z, p);
      x += Math.sin(p) * v * dt + ((b.vgx ?? 0) - b.u * Math.sin(b.psi)) * dt;     // (plus the tide and leeway she makes now)
      z += -Math.cos(p) * v * dt + ((b.vgz ?? 0) + b.u * Math.cos(b.psi)) * dt;
    }
    for (const pr of this.relsOf(b)) {
      const o = pr.a === b ? pr.b : pr.a;
      if (pr.d > 45) continue;
      const need = 2 + b.cls.beam * 0.5, c = trackClear(me, tb, o, this.trackOf(o), dt, need);
      if (c < need) return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The AI crew under the rules: keep clear (duck, head up, slow down, tack when it pays and is safe), give room and
// mark-room, hold course as the right-of-way boat (16) but still avoid contact (14). Called from AIHelm with the
// heading the tactician wants; returns the heading to steer. 5 plans a second, held in between.
export function aiRules(ai, sim, desired, mode, t, up) {
  const R = sim.rules, b = ai.b, twd = b.diag.twd ?? 0;
  ai.ease = false;
  const rels = R.relsOf(b);
  const markList = sim.course ? [...sim.course.marks(), sim.course.committee] : [];
  if (!rels.length && !markList.some(m => Math.abs(m.x - b.x) < 30 && Math.abs(m.z - b.z) < 30)) { ai.kc = null; ai.holdPsi = null; return desired; }
  if (ai.kc && t < ai.kc.until) { ai.ease = ai.kc.ease; return ai.kc.h ?? desired; }
  const plan = { until: t + 0.25, h: null, ease: false };
  ai.kc = plan;
  const H = clamp(4 + b.cls.loa * 0.9, 6, 12), dt = 0.5;
  const give = [], row = [], extra = new Map();
  const Vr = Math.max(b.u, 1.2) + 1, Rb = reach(b);
  for (const pr of rels) {
    const o = pr.a === b ? pr.b : pr.a;
    // (out of reach within the horizon whatever either does: nothing to plan for)
    if (pr.d - (Vr + Math.hypot(o.vgx ?? 0, o.vgz ?? 0)) * H > Rb + reach(o) + 3) continue;
    (R.owes(pr, b) ? give : row).push([o, pr]);
    // (room and mark-room she owes: room to round, not just not to touch — the other's turn is not in her track)
    if (pr.room && pr.room.giver === b && pr.room.ent === o) extra.set(o, o.cls.loa * 0.6);
  }
  // the others' tracks (for the whole plan)
  const tracks = new Map();
  for (const [o] of give) tracks.set(o, R.trackOf(o));
  for (const [o] of row) tracks.set(o, R.trackOf(o));
  const marks = markList.filter(m => Math.hypot(m.x - b.x, m.z - b.z) < 40);
  const V = Math.max(b.u, 1.2), cx = (b.vgx ?? 0) - b.u * Math.sin(b.psi), cz = (b.vgz ?? 0) + b.u * Math.cos(b.psi);
  const me = { cls: b.cls, sailBy: b.sailBy, genDeploy: b.genDeploy };
  const mine = [];
  const clearFor = (h, list, HH = H, stop = -1e9, vf = 1) => {
    // she comes round at ~25°/s (a keelboat less) toward h, then holds it
    // (slow, the rudder has little grip: about 7°/s per m/s of speed)
    const rate = clamp(b.u * 7, 4, b.cls.loa > 6 ? 18 : 28) * DEG;
    let x = b.x, z = b.z, p = b.psi; mine.length = 0;
    for (let tt = 0; tt <= HH + 1e-6; tt += dt) {
      mine.push(x, z, p);
      p += clamp(wrap(h - p), -rate * dt, rate * dt);
      x += (Math.sin(p) * V * vf + cx) * dt; z += (-Math.cos(p) * V * vf + cz) * dt;
    }
    let worst = 1e9;
    for (const [o] of list) { const x = extra.get(o) || 0, c = trackClear(me, mine, o, tracks.get(o), dt, stop + x) - x; worst = Math.min(worst, c); if (worst < stop) return worst; }
    for (const m of marks) for (let i = 0; i < mine.length; i += 3) {
      const cp = capsule(b, mine[i], mine[i + 1], mine[i + 2], _c1);
      worst = Math.min(worst, segDist(cp.ax, cp.az, cp.bx, cp.bz, m.x, m.z, m.x, m.z) - cp.r - (m.kind === 'committee' ? 2.6 : 1.2) + 0.8);
    }
    return worst;
  };
  const margin = 1 + b.cls.beam * 0.5;
  // (headings on the other tack only when she is already turning through the wind: tacks and gybes are chosen
  // above, where they are checked clear)
  const tk = Math.sign(wrap(twd - b.psi)) || 1, midTurn = Math.abs(wrap(twd - b.psi)) < up * 0.8;
  const sailable = (h) => Math.abs(wrap(twd - h)) >= up * 0.9 && (midTurn || (Math.sign(wrap(twd - h)) || 1) === tk);
  let h = desired;
  const search = (list, need, HH) => {
    // turn away from the nearest threat first; the smallest change of course that is clear
    let near = null, nd = 1e9;
    for (const [o, pr] of list) if (pr.d < nd) { nd = pr.d; near = o; }
    // (the side she chose last time while she is still at it: switching sides every plan she goes neither way)
    const s0 = ai.kcSide && t - ai.kcSideT < 1.5 ? ai.kcSide : near ? -(Math.sign(wrap(Math.atan2(near.x - b.x, -(near.z - b.z)) - b.psi)) || 1) : 1;
    let best = null, bc = -1e9;
    // (the other side costs another 35°, so she does not swap sides for a few degrees)
    const cands = [];
    for (let k = 1; k <= 16; k++) for (const s of [s0, -s0]) cands.push([k * 7 + (s === s0 ? 0 : 35), s * k * 7 * DEG]);
    cands.sort((p, q) => p[0] - q[0]);
    for (const [, dh] of cands) {
      const hh = desired + dh;
      if (!sailable(hh)) continue;
      let c = clearFor(hh, list, HH, need);
      if (c >= need && list === give && row.length) c = Math.min(c, clearFor(hh, row, HH, 0.5) + need - 0.5);
      if (c >= need) { if (!sim.world || sim.world.open || !ai.clearance || ai.clearance(sim, hh) > 0) return [hh, c]; }
      if (c > bc) { bc = c; best = hh; }
    }
    return [best, -1];
  };
  // 0. tangled with another boat and all but stopped: bear off away from her (whoever was right), sails drawing
  const stuck = rels.find(pr => pr.now < 0.4 && b.u < 1.2);
  if (stuck) {
    const o = stuck.a === b ? stuck.b : stuck.a, away = Math.atan2(b.x - o.x, -(b.z - o.z));
    const rel = wrap(twd - away), side = Math.sign(wrap(twd - b.psi)) || 1;
    // (the heading away from her on this tack, never into the wind: at least a close reach)
    plan.h = twd - side * clamp(Math.sign(rel) === side ? Math.abs(rel) : Math.PI - Math.abs(rel), up + 25 * DEG, 160 * DEG);
    plan.until = t + 1.5;
    return plan.h;
  }
  // 1. keep clear of the boats she owes it to (and the marks)
  const cD = give.length || marks.length ? clearFor(desired, give) : 1e9;
  if (cD < margin) {
    let [hh, ok] = search(give, margin, H);
    // a port tacker would rather tack than duck far below her course, if the tack itself is clean
    const beating = Math.abs(wrap(twd - b.psi)) < up + 20 * DEG;
    if ((mode === 'beat' || beating) && (ok < 0 || Math.abs(wrap(hh - desired)) > 35 * DEG) && t - ai.lastTack > 8) {
      const other = twd + (Math.sign(wrap(twd - b.psi)) || 1) * up;
      if (R.canTurn(b, other)) { hh = other; ok = 1; ai.lastTack = t; }
    }
    // still nothing clear: would stopping where she is (sheets out, the other boat crossing ahead) do better?
    let stop = false;
    if (ok < 0 && !give.some(([o, pr]) => pr.overlap && pr.sameTack)) {
      const cs = clearFor(b.psi, give, H, -1e9, 0.25), cb = hh !== null ? clearFor(hh, give) : -1e9;
      if (cs > cb) { hh = b.psi; stop = true; }
    }
    if (hh !== null) h = hh;
    if (stop) plan.ease = true;
    // no clear heading (boxed in, or clear astern with nowhere to go): slow down as well
    // (not beside a mark: stopped, she drifts down onto it; nor once slow: she would lose steerage and stall)
    if (b.u > 1.2 && (ok < 0 || give.some(([o, pr]) => pr.rule === '12' && pr.astern === b && pr.d < 2 * b.cls.loa && o.u < b.u)) && !marks.some(m => Math.hypot(m.x - b.x, m.z - b.z) < 3 * b.cls.loa)) plan.ease = true;
  }
  // 2. right of way: hold her course while a keep-clear boat is close (16) — but not into contact (14)
  else if (!row.length) ai.holdPsi = null;
  else {
    let danger = false, close = false;
    for (const [o, pr] of row) {
      if (pr.clr !== undefined && pr.clr < 0.6 && pr.when < 2.5) danger = true;
      if (pr.d < 3 * (b.cls.loa + o.cls.loa) / 2) close = true;
    }
    const s = R.S(b), rounding = s.marks && s.marks.some(m => s.zone.get(m)?.in);
    // (held to within a few degrees of the heading she had when the keep-clear boat came close, not of the
    // heading of the moment: a few degrees each plan is a turn all the same)
    if (!close || rounding || danger) ai.holdPsi = null;
    else if (ai.holdPsi == null) ai.holdPsi = b.psi;
    if (danger) { const [hh] = search(row, 0.3, 3); if (hh !== null) h = hh; }
    else if (ai.holdPsi != null) h = ai.holdPsi + clamp(wrap(desired - ai.holdPsi), -6 * DEG, 6 * DEG);
  }
  plan.h = h === desired ? null : h;
  if (plan.h !== null) { ai.kcSide = Math.sign(wrap(h - desired)) || ai.kcSide; ai.kcSideT = t; }
  ai.ease = plan.ease;
  return h;
}
