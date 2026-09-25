// The rig around a cloth sail: where the cloth is held (tack, head, luff on the mast or stay), the boom as a
// particle on its gooseneck, and the lines as ropes (sheet to the traveller car, vang, topping lift, outhaul,
// cunningham, halyard). The crew's controls set the ropes' lengths and the pins' positions; twist, boom lift,
// leech tension, mast-bend flattening and the depth the cloth takes under load come out of the cloth.
//
// All positions are in the boat's rig frame (x forward, y starboard, z up along the mast, from the centre of
// gravity at the waterline), as physics.js uses.
import { clamp, lerp, sstep, STRIP_F, reefAt } from '../physics.js';
import { G as GRAV } from '../env.js';
import { Cloth } from './cloth.js';
import { clothSize, clothMaterial, battens } from './specs.js';
import { camberStats } from './vlm.js';

// chord of the drawn sail at height fraction fv (before scaling to the rated area), as the renderer draws it
export function chordAt(s, fv, roach = true) {
  let c = s.foot * (1 - fv) + s.head * fv;
  if (s.key === 'main' && roach) c += s.foot * 0.07 * Math.sin(Math.PI * fv * 0.85);
  if (s.kind === 'spin') c *= 0.9 + 0.25 * Math.sin(Math.PI * fv);
  return c;
}
// chord scale that makes the drawn planform carry the rated area
export function areaScale(s, luff, area, roach = true) {
  let A0 = 0; const n = 40;
  for (let j = 0; j < n; j++) A0 += 0.5 * (chordAt(s, j / n, roach) + chordAt(s, (j + 1) / n, roach)) / n;
  return area / Math.max(1e-6, A0 * luff);
}
const depthAt = (s, fv) => {
  const d = s.depth, F = STRIP_F;
  if (fv <= F[0]) return d[0];
  if (fv <= F[1]) return lerp(d[0], d[1], (fv - F[0]) / (F[1] - F[0]));
  if (fv <= F[2]) return lerp(d[1], d[2], (fv - F[1]) / (F[2] - F[1]));
  return d[2];
};
const camb = (u, f) => (u < f ? 1 - (1 - u / f) ** 2 : 1 - ((u - f) / (1 - f)) ** 2);

// What every cloth sail shares: the cloth cut to its moulded shape, its tapes and headboard, and the maps between
// the cloth and the lattice (positions, velocities, loads), the frame's fictitious forces, the loads handed to the
// hull, and the three sections the rest of the game reads.
class ClothRig {
  // o: { extra (rig particles), px, pz (tack), rake (luff rake over its height), footRise, luffRound (m, main) }
  constructor(boat, s, lod, o) {
    const C = boat.cls;
    this.boat = boat; this.s = s; this.lod = lod;
    const { nu, nv } = clothSize(C, s, lod);
    this.nu = nu; this.nv = nv;
    const cloth = this.cloth = new Cloth(nu, nv, o.extra);
    const mat = this.mat = clothMaterial(C, s);
    this.px = o.px; this.pz = o.pz; this.rake = o.rake || 0; this.footRise = o.footRise || 0;
    this.luff0 = s.luff;
    // the cloth is cut with a straight leech: a roach needs its battens to hold it out, and a roach the cloth
    // cannot hold folds and bows the leech to windward
    this.kc = areaScale(s, s.luff, s.area, false);
    this.footLen = s.foot * this.kc;
    const lr0 = o.luffRound || 0;
    // rest shape: the sailmaker's moulded sail, chord along -x, camber to starboard, luff round cut in
    const rest = this.rest = new Float64Array(3 * nu * nv);
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1), c = chordAt(s, v, false) * this.kc, d = depthAt(s, v), lr = lr0 * Math.sin(Math.PI * v);
      for (let i = 0; i < nu; i++) {
        const u = i / (nu - 1), k = 3 * (j * nu + i);
        rest[k] = this.px - this.rake * v + lr * (1 - u) - c * u;
        rest[k + 1] = d * c * camb(u, 0.45);
        rest[k + 2] = this.pz + v * s.luff + this.footRise * u * (1 - v);
      }
    }
    const H = [rest[3 * ((nv - 1) * nu)], 0, rest[3 * ((nv - 1) * nu) + 2]], Cl = [rest[3 * (nu - 1)], 0, rest[3 * (nu - 1) + 2]], Tk = [rest[0], 0, rest[2]];
    const radial = mat.layout === 'radial';
    const dir = (i, j, e) => {
      const k = 3 * (j * nu + i), u = i / (nu - 1), v = j / (nv - 1), P = [rest[k], rest[k + 1], rest[k + 2]];
      if (!radial) {
        // cross-cut: the fill runs along the leech, the warp across it
        let lx = H[0] - Cl[0], lz = H[2] - Cl[2]; const ll = Math.hypot(lx, lz); lx /= ll; lz /= ll;
        e[0] = lz; e[1] = 0; e[2] = -lx;
        return;
      }
      // tri-radial: the warp follows the load paths out of the head, the clew and the tack
      let ex = 0, ez = 0;
      for (const [Q, w] of [[H, v ** 1.5], [Cl, u * (1 - v)], [Tk, 0.5 * (1 - u) * (1 - v)]]) {
        let dx = Q[0] - P[0], dz = Q[2] - P[2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        if (dz < 0 || (Math.abs(dz) < 1e-6 && dx < 0)) { dx = -dx; dz = -dz; }
        ex += w * dx; ez += w * dz;
      }
      const l = Math.hypot(ex, ez) || 1; e[0] = ex / l; e[1] = 0; e[2] = ez / l;
    };
    // the air a sail carries with it (added mass ~ rho c pi/8 per unit area, a 3-D reduction of the 2-D pi/4)
    const airMass = (i, j) => Math.max(0.3, 1.225 * Math.PI / 8 * chordAt(s, j / (nv - 1), false) * this.kc);
    cloth.setRest(rest, dir, mat, mat.rho, airMass);
    cloth.curvDamp = 20;                                      // grid-scale wrinkle / flutter damping (cloth.js)
    this.ma = new Float64Array(cloth.n);
    for (let i = cloth.off; i < cloth.n; i++) this.ma[i] = cloth.m[i] - cloth.mg[i];
    // luff on its mast or stay: every luff node held by its slider or hank
    for (let j = 0; j < nv; j++) cloth.setKinematic(cloth.node(0, j), true);
    // headboard: stiff bars along the head row (it swings with the sail, it does not fold)
    for (let i = 0; i < nu - 1; i++) {
      const a = cloth.node(i, nv - 1), b = cloth.node(i + 1, nv - 1); cloth.addDistance(a, b, this._rd(a, b), 3e5);
      if (i + 2 < nu) { const c2 = cloth.node(i + 2, nv - 1); cloth.addDistance(a, c2, this._rd(a, c2), 3e5); }
    }
    // leech and foot tapes: the sail's edges are bound with tape that carries the leech and foot tension
    this.tapeEA = 1.5e5;
    for (let j = 0; j < nv - 1; j++) { const a = cloth.node(nu - 1, j), b = cloth.node(nu - 1, j + 1); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    for (let i = 0; i < nu - 1; i++) { const a = cloth.node(i, 0), b = cloth.node(i + 1, 0); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    this.needPose = true; this.side = 1; this.sincePose = 0;
    this._p = [0, 0, 0]; this._q = [0, 0, 0];
  }
  _rd(a, b) { const r = this.rest, o = this.cloth.off, i = 3 * (a - o), j = 3 * (b - o); return Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1], r[j + 2] - r[i + 2]); }
  // the cloth at its rest shape, its chord swung to angle a about the tack's vertical (camber to leeward), at rest
  poseCloth(a) {
    const c = this.cloth, { nu, nv } = this, side = Math.sign(a) || 1, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = 3 * (j * nu + i), n = 3 * c.node(i, j);
      const v = j / (nv - 1), lx = this.px - this.rake * v;          // the luff at this height
      const back = lx - this.rest[k], off = this.rest[k + 1];        // distance aft of the luff, camber offset
      // chord (-cos a, sin a), camber along (sin a, cos a) * side (to leeward)
      c.x[n] = lx - back * ca + off * sa * side; c.x[n + 1] = back * sa + off * ca * side; c.x[n + 2] = this.rest[k + 2];
    }
    c.v.fill(0); c.v0.fill(0); c.f.fill(0);
    this.side = side; this.needPose = false; this.sincePose = 0;
  }
  // lattice surface sampled from the cloth
  latticeSurface(q) {
    const { nc, ns } = q, W = nc + 1, S = q.surf, p = this._p;
    for (let j = 0; j <= ns; j++) for (let i = 0; i <= nc; i++) {
      this.cloth.sample(this.cloth.x, i / nc, j / ns, p);
      const k = 3 * (j * W + i); S[k] = p[0]; S[k + 1] = p[1]; S[k + 2] = p[2];
    }
  }
  velocityAt(u, v, out) { return this.cloth.sample(this.cloth.v, u, v, out); }
  // one step of the cloth; fr = frame kinematics { u, v, r, p, ud, vd, rd, pd, hd, cphi, sphi }
  stepCloth(dt, nsub, fr) {
    const c = this.cloth, g = c.grav;
    g[0] = 0; g[1] = GRAV * fr.sphi; g[2] = -GRAV * fr.cphi;
    this.fr = fr;
    const acc = this._acc || (this._acc = (i, x, v, o) => this.fict(x[3 * i], x[3 * i + 1], x[3 * i + 2], o));
    this.sincePose = (this.sincePose || 0) + dt;
    c.step(dt, nsub, acc);
  }
  // the frame's fictitious acceleration at rig point (x, y, z) -> o (rig axes): minus the acceleration of a
  // point fixed to the hull (surge/sway, yaw and roll, heave), level axes converted to rig axes
  fict(x, y, z, o) {
    const f = this.fr, c = f.cphi, s = f.sphi;
    const X = x, Y = y * c + z * s, Hh = z * c - y * s;
    const A1 = f.ud - f.r * f.v - f.rd * Y - 2 * f.r * f.p * Hh - f.r * f.r * X;
    const A2 = f.vd + f.pd * Hh - f.p * f.p * Y + f.rd * X + f.r * f.u - f.r * f.r * Y;
    const A3 = -f.pd * Y - f.p * f.p * Hh + f.hd;
    o[0] = -A1; o[1] = -(A2 * c - A3 * s); o[2] = -(A2 * s + A3 * c);
    return o;
  }
  // loads the rig hands the hull over the last step: aero on every particle minus the inertia of its motion
  // relative to the hull (a boom snatched by its sheet hands its momentum over), plus the reaction of the
  // air the cloth carries when the hull accelerates it. Rig frame force, applied at the particle.
  loads(dt, cb) {
    const c = this.cloth, x = c.x, v = c.v, v0 = c.v0, f = c.f, m = c.m, ma = this.ma, o = this._q, idt = 1 / dt;
    for (let i = 0; i < c.n; i++) {
      const i3 = 3 * i;
      let Fx = f[i3] - m[i] * (v[i3] - v0[i3]) * idt, Fy = f[i3 + 1] - m[i] * (v[i3 + 1] - v0[i3 + 1]) * idt, Fz = f[i3 + 2] - m[i] * (v[i3 + 2] - v0[i3 + 2]) * idt;
      if (ma[i] > 0) { this.fict(x[i3], x[i3 + 1], x[i3 + 2], o); Fx += ma[i] * o[0]; Fy += ma[i] * o[1]; Fz += ma[i] * o[2]; }
      cb(x[i3], x[i3 + 1], x[i3 + 2], Fx, Fy, Fz);
    }
  }
  // the three sections the rest of the game reads: depth, draft, chord angle and twist at STRIP_F heights
  measure(sh, baseAngle) {
    const c = this.cloth, N = 9, xs = this._xs || (this._xs = new Float64Array(N)), zs = this._zs || (this._zs = new Float64Array(N)), p = this._p, cs = this._cs || (this._cs = {});
    // twist opens to leeward: the side the sail's camber is on (a traveller can pull the boom past the centreline)
    let side = Math.sign(sh[1].dSigned ?? 0) || Math.sign(baseAngle) || 1;
    for (let k = 0; k < 3; k++) {
      const v = STRIP_F[k];
      c.sample(c.x, 0, v, p); const lx = p[0], ly = p[1], lz = p[2];
      c.sample(c.x, 1, v, p);
      let tx = p[0] - lx, ty = p[1] - ly, tz = p[2] - lz; const L = Math.hypot(tx, ty, tz) || 1e-6; tx /= L; ty /= L; tz /= L;
      const nx = ty, ny = -tx, nl = Math.hypot(nx, ny) || 1;              // horizontal normal (starboard for a centred chord)
      for (let i = 0; i < N; i++) {
        c.sample(c.x, i / (N - 1), v, p);
        const dx = p[0] - lx, dy = p[1] - ly, dz = p[2] - lz;
        xs[i] = Math.min(1, Math.max(i ? xs[i - 1] + 1e-6 : 0, (dx * tx + dy * ty + dz * tz) / L)); zs[i] = (dx * nx + dy * ny) / nl / L;
      }
      camberStats(xs, zs, N - 1, cs);
      const o = sh[k];
      o.d = Math.abs(cs.d); o.f = clamp(cs.f, 0.2, 0.8); o.dSigned = cs.d;
      o.ang = Math.atan2(ty, -tx); o.tw = (o.ang - baseAngle) * side;
      if (k === 1 && Math.sign(cs.d)) side = Math.sign(cs.d);
    }
    for (let k = 0; k < 3; k++) sh[k].tw = (sh[k].ang - baseAngle) * side;
  }
}
const wrapA = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

// A sail set on a boom: the main (luff on the mast, boom on the gooseneck, sheet to the traveller car, vang,
// topping lift) or the Blackwatch's self-tacking staysail (luff on the inner forestay, club on the tack).
export class BoomSailRig extends ClothRig {
  // reef: the reef the sail is tied in at (0, 1, 2 or a half-way stage): a reefed main is a smaller sail, so
  // the rig is rebuilt for it (sailsim.js does that as the crew works through the reef)
  constructor(boat, s0, lod, reef = 0) {
    const C = boat.cls, isMain = s0.key === 'main';
    const rf = reefAt(reef), s = reef > 0 ? { ...s0, luff: s0.luff * rf.l, area: s0.area * rf.a } : s0;
    super(boat, s, lod, { extra: 1, px: isMain ? C.mastX - 0.02 : s.tackX, pz: isMain ? C.boomZ : s.tackZ, rake: isMain ? 0 : (s.rake || 0),
      luffRound: isMain ? 0.35 * 0.018 * s.luff : 0 });
    this.isMain = isMain; this.reefLevel = reef; this.s0 = s0;
    const cloth = this.cloth, nu = this.nu, nv = this.nv;
    this.E = 0;
    this.Lb = this.footLen * 1.04;                            // boom length (a little past the clew)
    this.lroundK = isMain ? 0.018 * s.luff : 0;               // bend -> mid-luff deflection (m), as the HUD reports it
    // the boom: a particle on the gooseneck with the boom's moment of inertia and weight moment
    this.Gp = [this.px, 0, this.pz];
    const mE = Math.max(s.Iboom / (this.Lb * this.Lb), 0.5), wE = s.boomMass * 0.45 * s.foot / this.Lb;
    cloth.setParticle(this.E, mE, wE);
    cloth.addLength(this.E, this.Gp, this.Lb, 2e6);
    // clew on the boom (loose-footed: the outhaul sets where)
    this.clewAtt = cloth.addAttach(cloth.node(nu - 1, 0), this.E, 0.95, this.Gp, 5e5);
    // sheet from the boom block to the car, vang to the mast foot, topping lift from the masthead
    this.tb = isMain ? 0.86 : 0.9;
    this.hz = isMain ? Math.max(0.3, C.boomZ - C.freeboard * 0.95) : 0.25;
    this.car = [0, 0, this.pz - this.hz];
    this.sheet = cloth.addRope(this.E, this.tb, this.Gp, this.car, 1, 3e5);
    this.tv = 0.22; this.dv = isMain ? Math.min(0.55, Math.max(0.3, C.boomZ - C.freeboard + 0.1)) : 0.15;
    this.vangBase = [this.px, 0, this.pz - this.dv];
    this.vang = isMain ? cloth.addRope(this.E, this.tv, this.Gp, this.vangBase, 1, 6e5) : null;
    this.mastHead = [this.px, 0, this.pz + s.luff + 0.3];
    this.topping = cloth.addRope(this.E, 1, this.Gp, this.mastHead, 1, 1e5);
    // battens: stiff chains of nodes on the batten rows (full length on a fully battened sail, the aft third
    // otherwise), with the batten's bending stiffness on every second node
    const bt = battens(C, s);
    for (const row of bt.rows) {
      const j = Math.round(row * (nv - 1)); if (j <= 0 || j >= nv - 1) continue;
      const i0 = bt.full ? 0 : Math.max(0, Math.round((nu - 1) * 0.62));
      for (let i = i0; i < nu - 1; i++) {
        const a = cloth.node(i, j), b = cloth.node(i + 1, j);
        cloth.addDistance(a, b, this._rd(a, b), 3e5);
        if (i + 2 < nu) {
          const c = cloth.node(i + 2, j), l = this._rd(a, b);
          cloth.addDistance(a, c, this._rd(a, c), Math.min(2e5, 60 * bt.EI / (l * l * l)));
        }
      }
    }
    // the mast: the cloth wraps round it, it does not pass through it
    if (isMain) cloth.addCapsule([C.mastX + 0.03, 0, 0], [C.mastX + 0.03, 0, C.mastHeight], 0.05, Array.from({ length: nu * nv }, (_, k) => cloth.off + k).filter((k) => (k - cloth.off) % nu > 0));
    this.a = 0; this.rate = 0; this.elev = 0;
  }

  // put the cloth at its rest shape swung out to boom angle a (camber to leeward), at rest
  pose(a) {
    this.poseCloth(a);
    const c = this.cloth;
    c.x[0] = this.px - this.Lb * Math.cos(a); c.x[1] = this.Lb * Math.sin(a); c.x[2] = this.pz;
    this.a = a; this.rate = 0;
  }

  // controls -> pins and rope lengths
  setTargets(b, bendRig) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) this.pose(b.booms[s.key].a);
    // luff: cunningham tension stretches it a little; the halyard eased while reefing lets it sag
    const slack = this.isMain ? b.reefSlack : 0;
    const luff = this.luff0 * (1 + 0.006 * ((this.isMain ? ctrl.cunn : 0.3) - 0.3) - 0.06 * slack);
    const bend = this.lroundK * bendRig;
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1), n = c.node(0, j);
      c.pin(n, this.px - this.rake * v + bend * Math.sin(Math.PI * v), 0, this.pz + v * luff);
    }
    // outhaul: the clew's place on the boom
    const out = this.isMain ? ctrl.outhaul : 0.5;
    const tc = this.footLen * (0.965 + 0.05 * out) / this.Lb;
    if (Math.abs(tc - this.clewAtt.t) > 2e-4) { this.clewAtt.t = tc; c._dirty = true; }   // (the matrix holds t: refactor)
    // sheet: the boom may swing out to the angle the sheet and traveller allow (Boat.boomLimit), pulled down
    // onto the car when hard in
    const lim = b.boomLimit(s), ease = clamp(b.lines[s.key] ?? 0.3, 0, 1);
    const travA = s.trav ? lerp(s.trav[0], s.trav[1], clamp(ctrl.trav, 0, 1)) : 0;
    // the car stays on the side the boom is on (with a little hysteresis at the centreline)
    const ey = c.x[1];
    if (Math.abs(ey) > 0.05 * this.Lb) this.side = Math.sign(ey);
    const R = this.tb * this.Lb;
    this.car[0] = this.px - R * Math.cos(travA); this.car[1] = this.side * R * Math.sin(travA);
    const chord = 2 * R * Math.sin(Math.max(0, lim - travA) / 2);
    this.sheet.len = Math.sqrt(chord * chord + this.hz * this.hz) - 0.035 * (1 - sstep(0, 0.25, ease));
    if (this.vang) {
      const L0 = Math.hypot(this.tv * this.Lb, this.dv);
      // hard on, the vang pulls the boom a little below level: that stretch is the leech tension
      const vg = clamp(ctrl.vang, 0, 1);
      this.vang.len = L0 - 0.012 * vg + 0.05 * (1 - vg) ** 1.3;
    }
    this.topping.len = Math.hypot(this.Lb, this.mastHead[2] - this.pz + 0.15 * this.Lb);
  }

  step(b, dt, nsub, fr) {
    const wasTaut = this.sheet.taut, rate0 = this.rate, c = this.cloth;
    this.stepCloth(dt, nsub, fr);
    // boom state for the rest of the game (angle + to starboard, rate, lift)
    const ex = c.x[0] - this.px, ey = c.x[1], ez = c.x[2] - this.pz;
    const a = Math.atan2(ey, -ex);
    this.rate = wrapA(a - this.a) / dt; this.a = a;
    this.elev = Math.atan2(ez, Math.hypot(ex, ey));
    // a slam: the sheet snatching a swinging boom
    if (this.sheet.taut && !wasTaut && Math.abs(rate0) > 1.2 && this.isMain) { b.slam = Math.max(b.slam, Math.abs(rate0)); b.slamEvents++; }
  }
  sheetLoad() { return this.sheet.force; }
}

// A headsail hanked to a stay: tack and head on the stay, the luff sagging to leeward with the stay, the clew
// held by two sheets to the jib leads (the working sheet to leeward, the lazy one to windward). Which side the
// clew is on, whether it is backed, when it crosses in a tack: all the cloth's doing.
export class JibRig extends ClothRig {
  constructor(boat, s, lod) {
    const C = boat.cls;
    super(boat, s, lod, { extra: 0, px: s.tackX, pz: s.tackZ, rake: s.rake || 0, footRise: s.footRise || 0 });
    const cloth = this.cloth, nu = this.nu, nv = this.nv;
    this.clew = cloth.node(nu - 1, 0);
    // jib leads on the side decks: fore-and-aft on their track with the jib car control; always well below the
    // clew (a sheet that pulls level leaves the leech with no tension: a low-cut jib leads through the deck or
    // trampoline to a block below it)
    this.leadZ = Math.min(C.freeboard + 0.06, s.tackZ + (s.footRise || 0) - Math.max(0.3, 0.2 * this.footLen));
    const ym = Math.max(0.25, this.footLen * Math.sin(s.min) * 1.05);
    this.leadY = Math.min(ym, C.beam * 0.45);
    this.leads = [[0, this.leadY, this.leadZ], [0, -this.leadY, this.leadZ]];     // starboard, port
    this.sheets = this.leads.map((L) => cloth.addRope(this.clew, 1, [0, 0, 0], L, 10, 1.5e5));
    // what the jib wraps round when it crosses: the mast, and on the Blackwatch the inner forestay (the leech
    // is left out: on a rig whose jib head is at the mast it runs down the mast's front, and caught on the
    // capsule it would pin the clew)
    const nodes = Array.from({ length: nu * nv }, (_, k) => cloth.off + k).filter((k) => { const i = (k - cloth.off) % nu; return i > 0 && i < nu - 2; });
    cloth.addCapsule([C.mastX + 0.03, 0, 0], [C.mastX + 0.03, 0, C.mastHeight], 0.06, nodes);
    const st = boat.sailBy.stay;
    if (st && st !== s) cloth.addCapsule([st.tackX, 0, st.tackZ], [st.tackX - (st.rake || 0), 0, st.tackZ + st.luff], 0.03, nodes);
    this.a = 0.3; this.sideSmooth = 1;
  }
  pose(a) { this.poseCloth(a); this.a = a; }
  // the clew's angle (from the tack, + to starboard) for a sheet eased to e (as the strip model sets the jib)
  _clewAt(a, side, out) {
    out[0] = this.px - this.footLen * Math.cos(a); out[1] = side * this.footLen * Math.sin(a); out[2] = this.pz + this.footRise;
    return out;
  }
  setTargets(b, bendRig, sagM) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) this.pose(b.side.jib * lerp(s.min, s.max, b.lines.jib));
    // the luff on the stay, sagging to leeward and a little aft under load (less with backstay tension)
    const cl = 3 * this.clew, side = Math.sign(c.x[cl + 1]) || this.side;
    const dx = -0.3, dy = 0.95 * side;
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1), sg = (sagM || 0) * 4 * v * (1 - v);
      c.pin(c.node(0, j), this.px - this.rake * v + dx * sg, dy * sg, this.pz + v * this.luff0);
    }
    // leads: the car forward (0) closes the leech and deepens the foot, aft (1) opens the leech, flattens the foot
    const lead = clamp(ctrl.jibLead, 0, 1), cx = this.px - this.footLen * Math.cos(s.min), dz = this.pz + this.footRise - this.leadZ;
    const lx = cx - Math.max(0.1, dz) * Math.tan(lerp(18, 58, lead) * Math.PI / 180);
    this.leads[0][0] = lx; this.leads[1][0] = lx;
    // sheet lengths: the working sheet lets the clew out to the angle the strip model would set it at
    const p = this._p, q = this._q;
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? 1 : -1, working = sd === this.side, e = clamp(working ? b.lines.jib : b.lines.lazy, 0, 1);
      const L = this.leads[k];
      if (!working && e > 0.85) { this.sheets[k].len = 20; continue; }                  // the lazy sheet, slack
      this._clewAt(lerp(s.min, s.max, e), sd, p);
      // (the trimmer pulls the clew a few centimetres past that point: the sheet always carries load, so where the
      // lead is decides whether it pulls the clew aft along the foot or down the leech)
      this.sheets[k].len = Math.hypot(p[0] - L[0], p[1] - L[1], p[2] - L[2]) - (working ? 0.02 + 0.06 * (1 - sstep(0, 0.3, e)) : 0);
    }
    void q;
  }
  step(b, dt, nsub, fr) {
    this.stepCloth(dt, nsub, fr);
    const c = this.cloth, cl = 3 * this.clew, ex = c.x[cl] - this.px, ey = c.x[cl + 1];
    this.a = Math.atan2(ey, -ex);
    // the clew crossing the centreline (with a little hysteresis): the sheets swap roles, as physics.js does
    const lim = 0.04 * this.footLen;
    if ((this.side > 0 && ey < -lim) || (this.side < 0 && ey > lim)) {
      const byLazy = b.lines.lazy < b.lines.jib;
      const ctrl = b.ctrl;
      [ctrl.jib, ctrl.lazy] = [ctrl.lazy, ctrl.jib];
      [b.lines.jib, b.lines.lazy] = [b.lines.lazy, b.lines.jib];
      if (b.locks) [b.locks.jib, b.locks.lazy] = [b.locks.lazy, b.locks.jib];
      this.side = -this.side;
      b.backedByLazy = byLazy && -Math.sign(b.diag.awaMid) !== this.side;
    }
    // side.jib as the game reads it: -1 .. 1 across the boat
    b.side.jib = clamp(ey / Math.max(0.05, this.footLen * Math.sin(this.s.min)), -1, 1);
    if (Math.abs(b.side.jib) < 0.02) b.side.jib = 0.02 * this.side;
  }
  sheetLoad() { const k = this.side > 0 ? 0 : 1; return this.sheets[k].force; }
  lazyLoad() { const k = this.side > 0 ? 1 : 0; return this.sheets[k].force; }
}

// An asymmetric gennaker / spinnaker: tacked on the bowsprit end (the tack line lets it rise), hoisted to the
// masthead, the luff flying free between them (it curls and collapses by itself when the sail is sailed too
// high), sheeted to a block on the quarter. The crew gybes it by trimming the new sheet as the wind comes
// over the other side.
export class SpinRig extends JibRig {
  constructor(boat, s, lod) {
    super(boat, s, lod);
    const C = boat.cls, cloth = this.cloth, nu = this.nu, nv = this.nv;
    for (let j = 1; j < nv - 1; j++) cloth.setKinematic(cloth.node(0, j), false);
    // luff tape: it carries the luff tension between tack and head
    for (let j = 0; j < nv - 1; j++) { const a = cloth.node(0, j), b = cloth.node(0, j + 1); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    cloth.caps.length = 0;
    // sheet blocks on the quarters
    this.leadZ = C.freeboard;
    this.leads[0][0] = this.leads[1][0] = C.sternX + 0.35;
    this.leads[0][1] = C.beam * 0.47; this.leads[1][1] = -C.beam * 0.47;
    this.leads[0][2] = this.leads[1][2] = this.leadZ = Math.min(this.leadZ, s.tackZ - 0.4);   // (well below the clew: leech tension)
    this.windT = 0;
  }
  setTargets(b, bendRig) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) { this.pose((Math.sign(b.side.gennaker) || 1) * lerp(s.min, s.max, b.lines.jib)); this.side = Math.sign(b.side.gennaker) || 1; }
    const up = 0.5 * clamp(ctrl.tackLine, 0, 1);                        // an eased tack line lets the tack rise
    c.pin(c.node(0, 0), this.px, 0, this.pz + up);
    c.pin(c.node(0, nv - 1), this.px - this.rake, 0, this.pz + this.luff0);
    // the crew gybes it: when the wind has been on the other side for a moment, the new sheet is the working one
    const wind = -Math.sign(b.diag.awaMid) || this.side;
    this.windT = wind !== this.side ? this.windT + 1 / 120 : 0;
    if (this.windT > 1.5) { this.side = wind; this.windT = 0; }
    const p = this._p;
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? 1 : -1, L = this.leads[k];
      if (sd !== this.side) { this.sheets[k].len = 30; continue; }
      this._clewAt(lerp(s.min, s.max, clamp(b.lines.jib, 0, 1)), sd, p);
      this.sheets[k].len = Math.hypot(p[0] - L[0], p[1] - L[1], p[2] - L[2]);
    }
  }
  step(b, dt, nsub, fr) {
    this.stepCloth(dt, nsub, fr);
    const c = this.cloth, cl = 3 * this.clew, ex = c.x[cl] - this.px, ey = c.x[cl + 1];
    this.a = Math.atan2(ey, -ex);
    b.side.gennaker = clamp(ey / Math.max(0.1, this.footLen * Math.sin(this.s.min)), -1, 1);
    if (Math.abs(b.side.gennaker) < 0.02) b.side.gennaker = 0.02 * this.side;
  }
  sheetLoad() { return this.sheets[this.side > 0 ? 0 : 1].force; }
  lazyLoad() { return 0; }
}
