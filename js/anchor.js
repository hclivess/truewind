// Anchoring (pure logic, no three.js): the anchor, its rode as a catenary, holding by the bottom, dragging,
// setting, swinging to wind and tide, snubbing in waves, weighing.
//
//  * RODE. Chain from the anchor (submerged weight w = 0.87 x its weight in air), then nylon rope to the bow
//    roller (weightless in water, elastic: EA from its stretch, ~12% at 20% of its breaking load). The chain is
//    a catenary, a = H / w: from the touch-down point, x = a asinh(s / a), y = sqrt(a^2 + s^2) - a; the rope a
//    straight line along the chain's top tangent, stretched by its tension. With the chain lifted off the
//    bottom the anchor is pulled up at an angle: its shank angle eats the holding. Given the horizontal
//    distance from the anchor to the roller and its height (depth + roller + the sea at the bow, so a wave
//    snubs the rode), the horizontal tension H is found by bisection. The boat feels H toward the anchor and
//    the vertical load at her bow, through js/physics.js ext; the rode's drag damps her surging.
//  * HOLDING = k x anchor weight, k by type and bottom (US Navy NCEL tests, Fortress / SAIL magazine pull
//    tests, order of magnitude): a plough (Delta) holds ~25x its weight in sand, ~12x in mud, ~3x on rock; a
//    claw (Bruce) ~15x / 8x / 5x; a fluke (Danforth, Fortress) ~50x in sand, ~40x in mud, ~2x on rock. Reduced by
//    the angle the rode lifts the shank (half at ~10 deg) and until the anchor is set: it sets by dragging a
//    couple of metres under load. Loaded past its holding it drags (at a rate set by the excess), and may reset
//    after a few metres of good bottom; on rock it only hooks.
//  * The crew pays out to a scope of 5:1 (chain and rope) of depth + freeboard, drops the sails while she lies to
//    it, and hauls it in at hand-hauling / windlass speed (less when tired: js/fatigue.js), which pulls her up to
//    it; at up-and-down it breaks out and comes aboard. The anchor light (all-round white) flag is b.lights.anchor.
import { G, DEG } from './env.js';
import { RHO_W, clamp } from './physics.js';

// anchors per class (none on the dinghies): type, mass (kg), chain (length m, kg/m in air, MBL N), rope (length m,
// diameter mm, MBL N, EA N), bow roller (x fwd of CG, z above the waterline)
export const ANCHOR = {
  // ~1 t cruiser: a 7 kg Delta on 10 m of 6 mm chain and 35 m of 12 mm nylon
  blackwatch: { type: 'delta', name: 'Delta 7 kg', mass: 7, chain: { L: 10, w: 0.8, mbl: 18e3 }, rope: { L: 35, d: 12, mbl: 24e3, EA: 40e3 }, x: 2.95, z: 0.85 },
  // J/70-size racer: a Fortress FX-7 (1.8 kg) on 3 m of 5 mm chain and 30 m of 10 mm line (class-legal ground tackle)
  sportboat: { type: 'fluke', name: 'Fortress FX-7 1.8 kg', mass: 1.8, chain: { L: 3, w: 0.55, mbl: 12e3 }, rope: { L: 30, d: 10, mbl: 17e3, EA: 28e3 }, x: 3.4, z: 0.75 },
};
// holding / anchor weight by type and bottom
export const HOLD_K = {
  delta: { sand: 25, mud: 12, gravel: 10, rock: 3 },
  claw: { sand: 15, mud: 8, gravel: 10, rock: 5 },
  fluke: { sand: 50, mud: 40, gravel: 8, rock: 2 },
};
export function anchorSpec(C) {
  if (C.anchor !== undefined) return C.anchor;                     // (a new class: an object like ANCHOR's, or null)
  if (ANCHOR[C.id]) return ANCHOR[C.id];
  const m = C.massHull + C.crewN * C.crewEach;
  if (m < 450 || C.id === 'dinghy' || C.id === 'cat') return null;
  // rule of thumb: ~1 kg of plough per 150 kg of displacement, 6-8 mm chain, 5 x the depth of rope
  const ma = Math.max(4, Math.round(m / 150));
  return { type: 'delta', name: `Delta ${ma} kg`, mass: ma, chain: { L: 10, w: m > 3000 ? 1.4 : 0.8, mbl: m > 3000 ? 32e3 : 18e3 },
    rope: { L: 40, d: 12, mbl: 24e3, EA: 40e3 }, x: C.bowX + 0.1, z: C.freeboard + 0.1 };
}
export function holding(spec, bed) { return (HOLD_K[spec.type] || HOLD_K.delta)[bed] * spec.mass * G; }

// Catenary with the chain partly lying on the bottom (or lifted clear of it) and a weightless elastic rope on top.
// X: horizontal distance anchor -> roller (m), h: height of the roller above the bottom (m); Lc, w: chain length and
// submerged weight per metre (N/m); Lr, EA: rope paid out and its axial stiffness. Returns { H, V (vertical at the
// roller), T, ang (shank angle at the anchor, rad), lay (chain on the bottom, m), slack }.
// Hmax: the most it can carry (past it: beyond = true, the rode is at full stretch).
// EAc: the chain's own axial stiffness (6 mm short-link: ~5 MN), which only matters once it is bar-tight.
export function rodeSolve(X, h, Lc, w, Lr, EA, out = {}, Hmax = 5e6, EAc = 5e6) {
  h = Math.max(0.2, h);
  // the chain's shape for a horizontal tension H: returns the X it reaches, filling in out
  const shape = (H, o) => {
    const a = H / w;
    // rope (straight, along the chain's top tangent) + chain: find the suspended chain length s (and, with the
    // chain all lifted, the vertical force Va at the anchor) that reaches height h
    const heightAt = (s, Va) => {
      const V = Va + w * s, T = Math.hypot(H, V), Lrs = Lr * (1 + T / EA);
      const yc = a * (Math.sqrt(1 + (V / H) ** 2) - Math.sqrt(1 + (Va / H) ** 2));
      return yc + Lrs * V / T;
    };
    let s, Va = 0;
    if (heightAt(Lc, 0) >= h) {               // part of the chain lies on the bottom
      let lo = 0, hi = Lc;
      for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (heightAt(m, 0) < h) lo = m; else hi = m; }
      s = 0.5 * (lo + hi);
    } else {                                   // all of it lifted: the anchor is pulled up
      s = Lc;
      let lo = 0, hi = 1e7;
      for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (heightAt(Lc, m) < h) lo = m; else hi = m; }
      Va = 0.5 * (lo + hi);
    }
    const V = Va + w * s, T = Math.hypot(H, V), Lrs = Lr * (1 + T / EA);
    const xc = a * (Math.asinh(V / H) - Math.asinh(Va / H));
    o.H = H; o.V = V; o.T = T; o.Va = Va; o.lay = Lc - s; o.ang = Math.atan2(Va, H);
    return (Lc - s) + xc * (1 + T / EAc) + Lrs * H / T;
  };
  const tmp = {};
  // X grows with H: bisect in log H
  let lo = Math.log(0.5), hi = Math.log(Hmax);
  if (shape(Math.exp(lo), tmp) >= X) { Object.assign(out, tmp); out.slack = true; out.beyond = false; out.H = 0; out.T = out.V; return out; }
  const Xmax = shape(Hmax, out);
  if (Xmax < X) { out.slack = false; out.beyond = true; out.over = X - Xmax; return out; }
  out.beyond = false; out.over = 0;
  for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (shape(Math.exp(m), tmp) < X) lo = m; else hi = m; }
  shape(Math.exp(0.5 * (lo + hi)), out);
  out.slack = false;
  return out;
}
// the rode's centreline for drawing: n points from the anchor (0) to the roller, in (x along, y up from the bottom)
export function rodeCurve(st, Lc, w, Lr, EA, n = 24, pts = []) {
  pts.length = 0;
  const H = Math.max(st.H, 1), a = H / w, Va = st.Va || 0;
  const lay = Math.max(0, st.lay || 0), s = Lc - lay;
  const nb = 3, nc = Math.max(4, n - nb - 4);
  for (let i = 0; i <= nb; i++) pts.push([lay * i / nb, 0]);
  const y0 = a * Math.sqrt(1 + (Va / H) ** 2), x0 = a * Math.asinh(Va / H);
  for (let i = 1; i <= nc; i++) {
    const si = s * i / nc, V = Va + w * si;
    pts.push([lay + a * Math.asinh(V / H) - x0, a * Math.sqrt(1 + (V / H) ** 2) - y0]);
  }
  const [xe, ye] = pts[pts.length - 1];
  const V = Va + w * s, T = Math.hypot(H, V), Lrs = Lr * (1 + T / EA);
  for (let i = 1; i <= 4; i++) pts.push([xe + Lrs * H / T * i / 4, ye + Lrs * V / T * i / 4]);
  return pts;
}

export class Anchor {
  constructor(boat, opts = {}) {
    this.b = boat; this.spec = anchorSpec(boat.cls);
    this.state = 'up';            // up | falling | down | weighing | coming-up
    this.x = 0; this.z = 0; this.y = 0;   // anchor position (world; y = depth below the surface while falling)
    this.paid = 0; this.target = 0;
    this.setF = 0; this.dragged = 0; this.dragging = false;
    this.st = { H: 0, V: 0, T: 0, ang: 0, lay: 0, slack: true };
    this.hold = 0; this.bed = 'sand';
    this.events = [];
    this._X = null;
  }
  get has() { return !!this.spec; }
  get down() { return this.state !== 'up'; }
  get w() { return this.spec.chain.w * G * (1 - RHO_W / 7850); }
  // the roller in world coordinates
  roller(o = {}) { const b = this.b, s = this.spec; o.x = b.x + Math.sin(b.psi) * s.x; o.z = b.z - Math.cos(b.psi) * s.x; return o; }
  drop(world) {
    if (!this.spec || this.state !== 'up') return false;
    const r = this.roller();
    this.x = r.x; this.z = r.z; this.y = 0; this.state = 'falling';
    this.paid = 0; this.setF = 0; this.dragged = 0; this.dragging = false;
    const depth = world ? world.depthAt(r.x, r.z) : 10;
    const rodeMax = this.spec.chain.L + this.spec.rope.L;
    this.target = Math.min(rodeMax, 5 * (depth + this.spec.z));
    this.b.lights = Object.assign(this.b.lights || {}, { anchor: true });
    this.events.push({ msg: depth + this.spec.z > rodeMax / 3 ? `Anchor down in ${depth.toFixed(1)} m — only ${rodeMax} m of rode: short scope` : `Anchor down in ${depth.toFixed(1)} m — paying out ${Math.round(this.target)} m (5:1)` });
    return true;
  }
  weigh() {
    if (this.state === 'up') return false;
    this.state = 'weighing'; this.events.push({ msg: 'Weighing anchor — hauling in the rode' });
    return true;
  }
  // before the physics step: the rode's pull on the bow
  pre(dt, ext, ctx) {
    const b = this.b, s = this.spec;
    if (!s || this.state === 'up') return;
    const world = ctx.world, env = ctx.env;
    const depth = world ? Math.max(0.5, world.depthAt(this.x, this.z)) : 10;
    // (the tide agent may add a tide level: world.tideAt)
    const tide = world && world.tideAt ? world.tideAt(this.x, this.z, ctx.t || 0) : 0;
    const r = this.roller();
    const dx = r.x - this.x, dz = r.z - this.z, X = Math.hypot(dx, dz);
    if (this.state === 'falling') {
      this.y = Math.min(depth + tide, this.y + 1.2 * dt);
      this.paid = Math.min(this.target, Math.max(this.paid, Math.hypot(X, this.y + s.z) + 0.3));   // it runs out as it sinks
      if (this.y >= depth + tide - 1e-3) { this.state = 'down'; }
      return;
    }
    // height of the roller above the bottom: depth + tide + roller height + the sea at the bow (snubbing) + heave
    let eta = 0;
    if (env && env.wavesOn && b._etaAt) eta = b._etaAt(b.cls.bowX) - b.pitch * s.x;
    const h = depth + tide + s.z + eta + b.heave;
    // paying out: the crew lets it run as she falls back, under a light hand, until the scope is out
    if (this.state === 'down' && this.paid < this.target) this.paid = Math.max(this.paid, Math.min(this.target, Math.hypot(X, h) + 0.8));
    const Lc = Math.min(s.chain.L, this.paid), Lr = Math.max(0, this.paid - s.chain.L);
    const mbl = Math.min(s.chain.mbl, this.paid > s.chain.L ? s.rope.mbl : Infinity);
    const st = rodeSolve(X, h, Lc, this.w, Lr, s.rope.EA, this.st, 1.3 * mbl);
    if (st.beyond) {
      // at full stretch: the rode stops her (inelastic), and carries its most
      const ux = dx / (X || 1), uz = dz / (X || 1);
      b.x -= ux * st.over; b.z -= uz * st.over;
      const f = Math.sin(b.psi), gz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
      const vx = b.u * f + b.v * sx, vz = b.u * gz + b.v * sz, vr = vx * ux + vz * uz;
      if (vr > 0) { const nvx = vx - vr * ux, nvz = vz - vr * uz; b.u = nvx * f + nvz * gz; b.v = nvx * sx + nvz * sz; }
      st.T = Math.hypot(st.H, st.V); this.snatch = true;
    }
    // rode drag through the water damps her surging on it
    const Xd = this._X === null ? 0 : (X - this._X) / dt; this._X = X;
    const H = st.slack ? 0 : st.H + (X > 0.5 ? clamp(0.5 * RHO_W * 1.2 * 0.01 * this.paid * Xd * Math.abs(Xd) + 60 * Xd, -st.H * 0.8, 5e3) : 0);
    this.H = H;
    const ux = X > 1e-3 ? -dx / X : 0, uz = X > 1e-3 ? -dz / X : 0;       // from the roller toward the anchor
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const Fb = H * (ux * fx + uz * fz), Fs = H * (ux * sx + uz * sz);
    ext.X += Fb; ext.Y += Fs; ext.N += s.x * Fs; ext.K += Fs * s.z * 0.5;
    this.Fv = st.V;
  }
  // after the step: pay out, haul, set, drag
  post(dt, ctx) {
    const b = this.b, s = this.spec;
    if (!s || this.state === 'up' || this.state === 'falling') return;
    const world = ctx.world;
    this.bed = ctx.seabed ? ctx.seabed(this.x, this.z) : 'sand';
    const rodeMax = s.chain.L + s.rope.L;
    const st = this.st;
    if (this.state === 'down') {
      // paying out as she falls back: the crew lets it run while there is weight on it
      if (this.paid < this.target) this.paid = Math.min(this.target, this.paid + dt * (st.slack ? 0.3 : 0.9));
    } else if (this.state === 'weighing') {
      // hand over hand / manual windlass: ~150 W of crew; the rode comes in slower under load
      const P = 150 * clamp(b.crewPower ?? 1, 0.3, 1.2);
      const rate = Math.min(0.45, P / Math.max(80, st.T || 0));
      const depth = world ? world.depthAt(this.x, this.z) : 5;
      this.paid = Math.max(depth + s.z + 0.3, this.paid - rate * dt);
      this.work = P;
      if (this.paid <= depth + s.z + 0.35) {       // up and down: break it out
        this._bt = (this._bt || 0) + dt;
        if (this._bt > 3) { this.state = 'up'; this._bt = 0; this.paid = 0; this.H = 0; this.st.T = 0; this._X = null; if (b.lights) b.lights.anchor = false; this.events.push({ msg: 'Anchor aweigh' }); }
      }
    }
    // holding: k x weight by the bottom, cut by the shank angle (half at ~10 deg) and until it has set
    const Hmax = holding(s, this.bed) * (this.bed === 'rock' ? 1 : 0.35 + 0.65 * this.setF);
    const angF = clamp(1 - st.ang / (20 * DEG), 0.05, 1);
    this.hold = Hmax * angF;
    const Ha = st.slack ? 0 : st.H;                    // horizontal pull at the anchor = H along the catenary
    if (this.state !== 'weighing' && Ha > this.hold) {
      // dragging: the anchor ploughs toward the boat at a rate set by the excess
      const v = clamp((Ha - this.hold * 0.8) / Math.max(200, this.hold) * 0.6, 0, 1.2);
      const r = this.roller(); const dx = r.x - this.x, dz = r.z - this.z, X = Math.hypot(dx, dz) || 1;
      this.x += dx / X * v * dt; this.z += dz / X * v * dt;
      this.dragged += v * dt;
      if (this.setF < 1 && this.bed !== 'rock') this.setF = Math.min(1, this.setF + v * dt / 2.5);   // it digs in as it drags
      else if (!this.dragging && this.dragged > 1 && this.setF >= 1) { this.dragging = true; this.events.push({ msg: `Anchor dragging — ${Math.round(Ha)} N on it, it holds ${Math.round(this.hold)} N in ${this.bed}`, bad: true }); }
      this._still = 0;
    } else {
      this._still = (this._still || 0) + dt;
      if (this.dragging && this._still > 8) { this.dragging = false; this.events.push({ msg: 'Anchor holding again' }); }
      // (she sets it by lying back on it: the chain's steady pull works it in over a couple of minutes)
      if (this.state === 'down' && this.setF < 1 && this.bed !== 'rock' && Ha > 40) this.setF = Math.min(1, this.setF + dt / 120);
    }
    this.paid = Math.min(this.paid, rodeMax);
    // breaking the rode (a snub past the chain's or the rope's breaking load)
    if ((st.T || 0) > Math.min(s.chain.mbl, s.rope.mbl) && this.state !== 'up') {
      this.events.push({ msg: 'The rode parted! Anchor lost', bad: true });
      this.state = 'up'; this.lost = true; this.spec = null; if (b.lights) b.lights.anchor = false;
    }
  }
  // world-space rode for drawing: [[x, y, z], ...] from the anchor to the roller
  curve(pts = []) {
    const s = this.spec; if (!s || this.state === 'up') return null;
    const Lc = Math.min(s.chain.L, this.paid), Lr = Math.max(0, this.paid - s.chain.L);
    const r = this.roller(), dx = r.x - this.x, dz = r.z - this.z, X = Math.hypot(dx, dz) || 1;
    if (this.state === 'falling') return [[this.x, -this.y, this.z], [r.x, this.b.cls.freeboard, r.z]];
    const loc = rodeCurve(this.st.slack ? { H: 5, Va: 0, lay: Math.max(0, Lc - 2) } : this.st, Lc, this.w, Lr, s.rope.EA, 24, this._loc || (this._loc = []));
    const Xe = loc[loc.length - 1][0] || 1, ye = loc[loc.length - 1][1] || 1;
    pts.length = 0;
    for (const [x, y] of loc) pts.push([this.x + dx / X * x * X / Xe, 0, this.z + dz / X * x * X / Xe, y]);
    return pts;   // [x, (unused), z, height above the bottom]; the renderer puts the bottom at -depth
  }
}
