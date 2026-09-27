// The rig around a cloth sail: where the cloth is held (tack, head, luff on the mast or stay), the boom as a
// particle on its gooseneck, and the lines as ropes (sheet to the traveller car, vang, topping lift, outhaul,
// cunningham, halyard). The crew's controls set the ropes' lengths and the pins' positions; twist, boom lift,
// leech tension, mast-bend flattening and the depth the cloth takes under load come out of the cloth.
//
// All positions are in the boat's rig frame (x forward, y starboard, z up along the mast, from the centre of
// gravity at the waterline), as physics.js uses.
import { clamp, lerp, sstep, STRIP_F, reefAt, mastXAt } from '../physics.js';
import { rigWires, sheetCar, sheetLen, boomBend } from '../boom.js';
import { G as GRAV } from '../env.js';
import { Cloth } from './cloth.js';
import { clothSize, clothMaterial, battens } from './specs.js';
import { camberStats } from './vlm.js';
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// chord of the drawn sail at height fraction fv (before scaling to the rated area), as the renderer draws it
export function chordAt(s, fv, roach = true) {
  let c = s.foot * (1 - fv) + s.head * fv;
  if (roach && (s.roach ?? (s.key === 'main' ? 0.07 : 0))) c += s.foot * (s.roach ?? 0.07) * Math.sin(Math.PI * fv * 0.85);
  if (s.kind === 'spin') c *= 0.9 + 0.25 * Math.sin(Math.PI * fv);
  return c;
}
// chord scale that makes the drawn planform carry the rated area. A high-cut headsail's foot rises to the clew
// (footRise), which shears every section up at its leech by footRise (1 - v): on a raked luff (rake over its
// height) that takes rake footRise / 2 out of the area the chords times the luff height would give (the
// Blackwatch's yankee came out a third small, 3.3 of its 5.1 m2)
export function areaScale(s, luff, area, roach = true) {
  let A0 = 0; const n = 40;
  for (let j = 0; j < n; j++) A0 += 0.5 * (chordAt(s, j / n, roach) + chordAt(s, (j + 1) / n, roach)) / n;
  const k = (area + 0.5 * (s.rake || 0) * (s.footRise || 0)) / Math.max(1e-6, A0 * luff);
  if (!s.headRise) return k;
  // a gaff, sprit or lateen sail: the head rises aft (the peak above the throat), so the planform is a
  // quadrilateral, not a stack of level chords: its area in the plane of the sail, found by quadrature and
  // solved for the chord scale (the area is near linear in it)
  const A = (kc) => {
    let a = 0; const m = 16, fr = s.footRise || 0, hr = s.headRise, rk = s.rake || 0;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const u = (i + 0.5) / m, v = (j + 0.5) / m, c = chordAt(s, v, roach) * kc, dc = (chordAt(s, v + 1e-3, roach) - chordAt(s, v - 1e-3, roach)) / 2e-3 * kc;
      const xu = -c, zu = hr * v + fr * (1 - v), xv = -rk - dc * u, zv = luff + (hr - fr) * u;
      a += Math.abs(xu * zv - zu * xv) / (m * m);
    }
    return a;
  };
  let k0 = k * 0.7, k1 = k, a0 = A(k0), a1 = A(k1);
  for (let it = 0; it < 6 && Math.abs(a1 - area) > 1e-3 * area; it++) { const k2 = k1 + (area - a1) * (k1 - k0) / (a1 - a0 || 1e-9); k0 = k1; a0 = a1; k1 = k2; a1 = A(k1); }
  return k1;
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
    this.px = o.px; this.pz = o.pz; this.rake = o.rake || 0; this.footRise = o.footRise || 0; this.headRise = s.headRise || 0;
    this.luff0 = s.luff;
    // the cloth is cut with a straight leech: a roach needs its battens to hold it out, and a roach the cloth
    // cannot hold folds and bows the leech to windward
    this.kc = areaScale(s, s.luff, s.area, false);
    this.footLen = chordAt(s, 0, false) * this.kc;           // (the foot as cut: a spinnaker's is 0.9 of its drawn foot)
    const lr0 = o.luffRound || 0;
    // rest shape: the sailmaker's moulded sail, chord along -x, camber to starboard, luff round cut in
    const rest = this.rest = new Float64Array(3 * nu * nv);
    for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1), c = chordAt(s, v, false) * this.kc, d = depthAt(s, v), lr = lr0 * Math.sin(Math.PI * v);
      for (let i = 0; i < nu; i++) {
        const u = i / (nu - 1), k = 3 * (j * nu + i);
        rest[k] = this.px - this.rake * v + lr * (1 - u) - c * u;
        rest[k + 1] = d * c * camb(u, 0.45);
        rest[k + 2] = this.pz + v * s.luff + this.footRise * u * (1 - v) + this.headRise * u * v;
      }
    }
    const H = [rest[3 * ((nv - 1) * nu)], 0, rest[3 * ((nv - 1) * nu) + 2]], Cl = [rest[3 * (nu - 1)], 0, rest[3 * (nu - 1) + 2]], Tk = [rest[0], 0, rest[2]];
    const radial = mat.layout === 'radial';
    const dir = (i, j, e) => {
      const k = 3 * (j * nu + i), u = i / (nu - 1), v = j / (nv - 1), P = [rest[k], rest[k + 1], rest[k + 2]];
      if (!radial) {
        // cross-cut: the fill runs along the leech, the warp across it
        let lx = H[0] - Cl[0], lz = H[2] - Cl[2]; const ll = hyp(lx, lz); lx /= ll; lz /= ll;
        e[0] = lz; e[1] = 0; e[2] = -lx;
        return;
      }
      // tri-radial: the warp follows the load paths out of the head, the clew and the tack
      let ex = 0, ez = 0;
      for (const [Q, w] of [[H, v ** 1.5], [Cl, u * (1 - v)], [Tk, 0.5 * (1 - u) * (1 - v)]]) {
        let dx = Q[0] - P[0], dz = Q[2] - P[2]; const l = hyp(dx, dz) || 1; dx /= l; dz /= l;
        if (dz < 0 || (Math.abs(dz) < 1e-6 && dx < 0)) { dx = -dx; dz = -dz; }
        ex += w * dx; ez += w * dz;
      }
      const l = hyp(ex, ez) || 1; e[0] = ex / l; e[1] = 0; e[2] = ez / l;
    };
    // the air a sail carries with it (added mass ~ rho c pi/8 per unit area, a 3-D reduction of the 2-D pi/4)
    const airMass = (i, j) => Math.max(0.3, 1.225 * Math.PI / 8 * chordAt(s, j / (nv - 1), false) * this.kc);
    cloth.setRest(rest, dir, mat, mat.rho, airMass);
    cloth.curvDamp = 20;                                      // grid-scale wrinkle / flutter damping (cloth.js)
    this.ma = new Float64Array(cloth.n);
    for (let i = cloth.off; i < cloth.n; i++) this.ma[i] = cloth.m[i] - cloth.mg[i];
    // luff on its mast or stay: every luff node held by its slider or hank
    for (let j = 0; j < nv; j++) cloth.setKinematic(cloth.node(0, j), true);
    // headboard: stiff bars along the head row (it swings with the sail, it does not fold); on a gaff sail that
    // is the gaff itself. A spritsail's head is cloth and tape, held out at the peak by the sprit
    if (s.rig === 'sprit') for (let i = 0; i < nu - 1; i++) { const a = cloth.node(i, nv - 1), b = cloth.node(i + 1, nv - 1); cloth.addDistance(a, b, this._rd(a, b), 1.5e5 / this._rd(a, b), true); }
    else for (let i = 0; i < nu - 1; i++) {
      const w = s.rig === 'gaff' ? 1e6 : 3e5;
      const a = cloth.node(i, nv - 1), b = cloth.node(i + 1, nv - 1); cloth.addDistance(a, b, this._rd(a, b), w);
      if (i + 2 < nu) { const c2 = cloth.node(i + 2, nv - 1); cloth.addDistance(a, c2, this._rd(a, c2), w); }
    }
    // leech and foot tapes: the sail's edges are bound with tape that carries the leech and foot tension
    this.tapeEA = 1.5e5;
    for (let j = 0; j < nv - 1; j++) { const a = cloth.node(nu - 1, j), b = cloth.node(nu - 1, j + 1); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    for (let i = 0; i < nu - 1; i++) { const a = cloth.node(i, 0), b = cloth.node(i + 1, 0); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    this.needPose = true; this.side = 1; this.sincePose = 0;
    this._p = [0, 0, 0]; this._q = [0, 0, 0];
  }
  _rd(a, b) { const r = this.rest, o = this.cloth.off, i = 3 * (a - o), j = 3 * (b - o); return hyp3(r[j] - r[i], r[j + 1] - r[i + 1], r[j + 2] - r[i + 2]); }
  // the cloth at its rest shape, its chord swung to angle a about the tack's vertical (camber to leeward), at rest.
  // tw (optional): the twist the sail had at the three STRIP_F heights (rad, + opens to leeward), so a sail set
  // again (a new detail level, a reef) comes back with the shape it had rather than untwisted
  poseCloth(a, tw = null) {
    const c = this.cloth, { nu, nv } = this, side = Math.sign(a) || 1;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = 3 * (j * nu + i), n = 3 * c.node(i, j);
      const v = j / (nv - 1), lx = this.px - this.rake * v;          // the luff at this height
      const F = STRIP_F, t = !tw ? 0 : v <= F[0] ? tw[0] * v / F[0] : v <= F[1] ? lerp(tw[0], tw[1], (v - F[0]) / (F[1] - F[0])) : v <= F[2] ? lerp(tw[1], tw[2], (v - F[1]) / (F[2] - F[1])) : tw[2];
      const av = a + side * t, ca = Math.cos(av), sa = Math.sin(av);
      const back = lx - this.rest[k], off = this.rest[k + 1];        // distance aft of the luff, camber offset
      // chord (-cos a, sin a), camber along (sin a, cos a) * side (to leeward)
      c.x[n] = lx - back * ca + off * sa * side; c.x[n + 1] = back * sa + off * ca * side; c.x[n + 2] = this.rest[k + 2];
    }
    c.v.fill(0); c.v0.fill(0); c.f.fill(0);
    this.side = side; this.needPose = false; this.sincePose = 0; this.warm = false;
  }
  // carry a flying sail over from another detail level (o: the same sail's rig there, or this one): the cloth's
  // shape and motion resampled onto this grid, the rig particles and state as they were; no fresh pose, and the
  // air stays on. still: a cloth set aside a while (the strip model sailed meanwhile) comes back at rest
  adopt(o, still = false) {
    const c = this.cloth, oc = o.cloth, p = this._p, { nu, nv } = this;
    if (o !== this) {
      for (let k = 0; k < 3 * c.off; k++) { c.x[k] = oc.x[k]; c.v[k] = oc.v[k]; }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const n = 3 * c.node(i, j), u = i / (nu - 1), v = j / (nv - 1);
        oc.sample(oc.x, u, v, p); c.x[n] = p[0]; c.x[n + 1] = p[1]; c.x[n + 2] = p[2];
        oc.sample(oc.v, u, v, p); c.v[n] = p[0]; c.v[n + 1] = p[1]; c.v[n + 2] = p[2];
      }
      for (const k of ['a', 'rate', 'elev', 'side', 'sideSmooth', 'windT', 'sincePose']) if (o[k] !== undefined) this[k] = o[k];
      // (resampled onto another grid, the cloth is a little off its new rest metric and springs back into shape over a
      // tenth of a second: numerical, not a motion of the sail, so the hull is not handed its inertia meanwhile)
      this.settleT = 0.15;
    }
    if (still) { c.v.fill(0); this.rate = 0; }
    c.v0.set(c.v); c.f.fill(0);
    this.needPose = false; this.warm = false; this.poseA = undefined;
  }
  // the twist to pose with: the sail's last measured shape (diag.shape), when it was drawing
  // the clew angle to pose a headsail at: where it was (warm), else where the sheet would put it
  _poseAngle(b, sideSign) {
    const a0 = this.poseA; this.poseA = undefined;
    if (this.warm && Number.isFinite(a0) && Math.abs(a0) > 0.02) return a0;
    return sideSign * lerp(this.s.min, this.s.max, b.lines.jib);
  }
  _poseTwist(b) {
    const sh = b.diag.shape[this.s.key];
    if (!this.warm || !sh) return null;
    return [0, 1, 2].map((k) => clamp(sh[k].tw || 0, 0, 0.6));
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
    if (this.settleT > 0) this.settleT -= dt;
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
    const c = this.cloth, x = c.x, v = c.v, v0 = c.v0, f = c.f, m = c.m, ma = this.ma, o = this._q;
    const idt = this.settleT > 0 ? (1 - this.settleT / 0.15) / dt : 1 / dt;
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
      let tx = p[0] - lx, ty = p[1] - ly, tz = p[2] - lz; const L = hyp3(tx, ty, tz) || 1e-6; tx /= L; ty /= L; tz /= L;
      const nx = ty, ny = -tx, nl = hyp(nx, ny) || 1;              // horizontal normal (starboard for a centred chord)
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

// (the standing rigging the cloth meets: js/boom.js rigWires)
export { rigWires };
// the cloth's nodes but for its luff column (on the mast or stay) and, optionally, its top rows (a sail whose head is
// at the mast runs down the mast's front there)
const bodyNodes = (cloth, nu, nv, topRows = 0) => Array.from({ length: nu * nv }, (_, k) => cloth.off + k).filter((k) => (k - cloth.off) % nu > 0 && Math.floor((k - cloth.off) / nu) < nv - topRows);
// the mast below a headsail's head (less a little: the sail runs down its front near the head)
const mastBelow = (W, z) => {
  const [a, b] = W.mast, zt = Math.max(a[2] + 0.5, z - 0.4), t = (zt - a[2]) / (b[2] - a[2]);
  return [a, [a[0] + t * (b[0] - a[0]), 0, zt]];
};

// A sail set on a boom: the main (luff on the mast, boom on the gooseneck, sheet to the traveller car, vang,
// topping lift), a mizzen on its own mast (s.mast) or the Blackwatch's self-tacking staysail (luff on the inner
// forestay, club on the tack). The main may be a gaff sail (s.rig 'gaff': the head on a gaff, its peak held up by
// the peak halyard), a spritsail ('sprit': a sprit from low on the mast pushes the peak up and out) or a lateen
// ('lateen': the luff laced to a yard that swings round the mast with the boom, the tack forward of the mast).
export class BoomSailRig extends ClothRig {
  // reef: the reef the sail is tied in at (0, 1, 2 or a half-way stage): a reefed main is a smaller sail, so
  // the rig is rebuilt for it (sailsim.js does that as the crew works through the reef)
  constructor(boat, s0, lod, reef = 0) {
    const C = boat.cls, isMain = s0.key === 'main', onMast = isMain || !!s0.mast, lateen = s0.rig === 'lateen';
    const rf = reefAt(reef), s = reef > 0 ? { ...s0, luff: s0.luff * rf.l, area: s0.area * rf.a } : s0;
    // (the gooseneck: on the main's mast, on the mizzen's, or the staysail's tack)
    const gx = isMain ? C.mastX - 0.02 : onMast ? s.tackX - 0.02 : s.tackX, gz = isMain ? C.boomZ : s.tackZ;
    super(boat, s, lod, { extra: 1, px: lateen ? gx + s.tackFwd : gx, pz: gz, rake: onMast && !lateen ? (isMain ? s.rake || 0 : 0) : (s.rake || 0),
      luffRound: onMast && !lateen ? (s.luffRoundK ?? 0.35) * 0.018 * s.luff : 0 });
    this.isMain = isMain; this.onMast = onMast; this.lateen = lateen; this.reefLevel = reef; this.s0 = s0;
    const cloth = this.cloth, nu = this.nu, nv = this.nv;
    this.E = 0;
    this.tackFwd = lateen ? s.tackFwd : 0;
    this.Lb = this.footLen * 1.04 - this.tackFwd;             // boom length aft of the gooseneck (a little past the clew)
    this.lroundK = onMast && !lateen ? 0.018 * s.luff : 0;    // bend -> mid-luff deflection (m), as the HUD reports it
    // the boom: a particle on the gooseneck with the boom's moment of inertia and weight moment
    this.Gp = [gx, 0, gz];
    const mE = Math.max(s.Iboom / (this.Lb * this.Lb), 0.5), wE = s.boomMass * 0.45 * s.foot / this.Lb;
    cloth.setParticle(this.E, mE, wE);
    cloth.addLength(this.E, this.Gp, this.Lb, 2e6);
    // clew on the boom (loose-footed: the outhaul sets where)
    this.clewAtt = cloth.addAttach(cloth.node(nu - 1, 0), this.E, 0.95, this.Gp, 5e5);
    // sheet from the boom block to the car, vang to the mast foot, topping lift from the masthead
    this.tb = isMain ? 0.86 : 0.9;
    this.hz = onMast ? Math.max(0.3, gz - C.freeboard * 0.95) : 0.25;
    this.car = [0, 0, this.pz - this.hz];
    this.sheet = cloth.addRope(this.E, this.tb, this.Gp, this.car, 1, 3e5);
    this.tv = 0.22; this.dv = onMast ? Math.min(0.55, Math.max(0.3, gz - C.freeboard + 0.1)) : 0.15;
    this.vangBase = [gx, 0, this.pz - this.dv];
    this.vang = onMast ? cloth.addRope(this.E, this.tv, this.Gp, this.vangBase, 1, 6e5) : null;
    this.mastHead = [gx - (isMain && !lateen ? this.rake : 0), 0, lateen ? (s.mastTop ?? this.pz + 0.6 * s.luff) : this.pz + s.luff + 0.3];
    this.topping = cloth.addRope(this.E, 1, this.Gp, this.mastHead, 1, 1e5);
    const T = isMain ? s0.track : null;
    this.track = T;
    if (T) {
      // the mainsheet from the boom block (T.s from the gooseneck) to the car on a straight track across the boat at
      // T.x, T.z (js/boom.js): the angle it pulls at, and so how much of it holds the leech down, is geometry
      this.tb = clamp(T.s / this.Lb, 0.3, 1);
      this.car = [T.x, 0, T.z];
      this.sheet.anchor = this.Gp; this.sheet.t = this.tb; this.sheet.to = this.car; cloth._dirty = true;
      // the leeward shroud: the boom end can get no further from a point on the centreline 1 m aft of the gooseneck
      // (the distance grows as the boom swings out, either side) than it is when the boom lies on the shroud (s.max,
      // js/boom.js boomContactAngle): a line that stands for the shroud
      this.stopQ = [this.px - 1, 0, this.pz];
      const ea = [this.px - this.Lb * Math.cos(s0.max), this.Lb * Math.sin(s0.max), this.pz];
      this.stop = cloth.addRope(this.E, 1, this.Gp, this.stopQ, hyp3(ea[0] - this.stopQ[0], ea[1], 0), 4e5);
      // preventer: from the boom end forward to the bow on the boom's side (rigged: held at the length it had)
      this.prevAt = [C.bowX - 0.3, 0, C.freeboard + 0.1];
      this.prev = s0.preventer ? cloth.addRope(this.E, 1, this.Gp, this.prevAt, 60, 2e5) : null;
      this.prevOn = false;
      // no vang on the cat (the fully battened main hangs on its sheet); the J/70's rigid kicker holds the boom up
      if (s0.vang === 'none' && this.vang) { this.vang.len = 60; this.noVang = true; }
      if (s0.vang === 'rigid') this.topping.len = 60;
      this.bend = { M: 0, dv: 0, ds: 0, ratio: 0 };
    }
    this.dipF = [0, 0, 0];
    const peak = cloth.node(nu - 1, nv - 1), pk = 3 * (nv * nu - 1);
    if (s.rig === 'gaff') {
      // peak halyard: from the peak to its block on the mast above the throat (it lets the gaff swing round the
      // mast with the sail, and sag off to leeward as far as the leech lets it, but not droop)
      this.peakBlock = [gx, 0, this.pz + s.luff + 0.55 * s.headRise + 0.2];
      this.peakHalyard = cloth.addRope(peak, 1, [0, 0, 0], this.peakBlock, hyp3(this.rest[pk] - gx, this.rest[pk + 1], this.rest[pk + 2] - this.peakBlock[2]), 4e5);
    } else if (s.rig === 'sprit') {
      // the sprit: a strut from its snotter low on the mast to the peak
      this.snotter = [gx + 0.03, 0, this.pz + s.snotterZ];
      this.spritLen = hyp3(this.rest[pk] - this.snotter[0], this.rest[pk + 1], this.rest[pk + 2] - this.snotter[2]);
      cloth.addLength(peak, this.snotter, this.spritLen, 1e6);
    }
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
    const W = rigWires(C, boat.sailBy);
    if (onMast && !lateen) cloth.addCapsule(isMain ? [mastXAt(C, 0) + 0.05, 0, 0] : [gx + 0.05, 0, 0], isMain ? [mastXAt(C, C.mastHeight) + 0.05, 0, C.mastHeight] : [gx + 0.05, 0, s.mast.h], isMain ? 0.05 : 0.04, bodyNodes(cloth, nu, nv));
    // eased right out (running), the main comes up against the leeward shrouds and spreader and lies on them
    if (isMain && !lateen) for (const sh of W.shrouds) cloth.addWire(sh, 0.03, bodyNodes(cloth, nu, nv));
    if (!onMast) cloth.addWire(mastBelow(W, s.tackZ + s.luff), 0.06, bodyNodes(cloth, nu, nv, 2));   // (the staysail round the mast)
    this.a = 0; this.rate = 0; this.elev = 0;
  }

  // put the cloth at its rest shape swung out to boom angle a (camber to leeward), at rest
  pose(a, tw = null) {
    this.poseCloth(a, tw);
    const c = this.cloth, g = this.Gp[0];
    if (this.lateen) {
      // the whole rig turns about the mast: every node (the luff on its yard too) swung by a about the mast's axis
      const side = Math.sign(a) || 1, ca = Math.cos(a), sa = Math.sin(a), { nu, nv } = this;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const k = 3 * (j * nu + i), n = 3 * c.node(i, j), dx = this.rest[k] - g, dy = this.rest[k + 1] * side;
        c.x[n] = g + dx * ca + dy * sa; c.x[n + 1] = -dx * sa + dy * ca; c.x[n + 2] = this.rest[k + 2];
      }
      this.side = side;
    }
    c.x[0] = g - this.Lb * Math.cos(a); c.x[1] = this.Lb * Math.sin(a); c.x[2] = this.pz;
    this.a = a; this.rate = 0;
  }

  // controls -> pins and rope lengths
  setTargets(b, bendRig) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) this.pose(b.booms[s.key].a, this._poseTwist(b));
    // luff: cunningham tension stretches it a little; the halyard eased while reefing lets it sag
    const slack = this.isMain ? b.reefSlack : 0;
    const luff = this.luff0 * (1 + 0.006 * ((this.isMain ? ctrl.cunn : 0.3) - 0.3) - 0.06 * slack);
    const bend = this.lroundK * bendRig;
    if (this.lateen) {
      // the yard swings with the boom: the luff laced to it turns about the mast with the boom's angle
      const g = this.Gp[0], ca = Math.cos(this.a), sa = Math.sin(this.a);
      for (let j = 0; j < nv; j++) { const v = j / (nv - 1), dx = this.px - this.rake * v - g; c.pin(c.node(0, j), g + dx * ca, -dx * sa, this.pz + v * luff); }
    } else for (let j = 0; j < nv; j++) {
      const v = j / (nv - 1), n = c.node(0, j);
      c.pin(n, this.px - this.rake * v + bend * Math.sin(Math.PI * v), 0, this.pz + v * luff);
    }
    // outhaul: the clew's place on the boom
    const out = this.isMain ? ctrl.outhaul : 0.5;
    const tc = (this.footLen * (0.965 + 0.05 * out) - this.tackFwd) / this.Lb;
    if (Math.abs(tc - this.clewAtt.t) > 2e-4) { this.clewAtt.t = tc; c._dirty = true; }   // (the matrix holds t: refactor)
    // sheet: the boom may swing out to the angle the sheet and traveller allow (Boat.boomLimit), pulled down
    // onto the car when hard in
    const ease = clamp(b.lines[s.key] ?? 0.3, 0, 1);
    if (this.track) { this.mainLines(b, ease); return; }
    const lim = b.boomLimit(s);
    const travA = s.trav ? lerp(s.trav[0], s.trav[1], clamp(ctrl.trav, 0, 1)) : 0;
    // the car stays on the side the boom is on (with a little hysteresis at the centreline)
    const ey = c.x[1];
    if (Math.abs(ey) > 0.05 * this.Lb) this.side = Math.sign(ey);
    const R = this.tb * this.Lb;
    this.car[0] = this.Gp[0] - R * Math.cos(travA); this.car[1] = this.side * R * Math.sin(travA);
    const chord = 2 * R * Math.sin(Math.max(0, lim - travA) / 2);
    this.sheet.len = Math.sqrt(chord * chord + this.hz * this.hz) - 0.035 * (1 - sstep(0, 0.25, ease));
    if (this.vang) {
      const L0 = hyp(this.tv * this.Lb, this.dv);
      // hard on, the vang pulls the boom a little below level: that stretch is the leech tension
      const vg = clamp(ctrl.vang, 0, 1);
      this.vang.len = L0 - 0.012 * vg + 0.05 * (1 - vg) ** 1.3;
    }
    this.topping.len = hyp(this.Lb, this.mastHead[2] - this.pz + 0.15 * this.Lb);
  }
  // the main's lines: sheet to the car on its track, vang (less the boom's bend under it), topping lift, preventer
  mainLines(b, ease) {
    const s0 = this.s0, c = this.cloth, ctrl = b.ctrl, C = b.cls, bd = this.bend;
    const ey = c.x[1];
    if (Math.abs(ey) > 0.05 * this.Lb) this.side = Math.sign(ey);
    sheetCar(C, s0, ctrl.trav, this.side, this.a, this.car);
    void bd;
    this.sheet.len = sheetLen(C, s0, ease) - 0.035 * (1 - sstep(0, 0.25, ease));
    if (this.vang && !this.noVang) {
      const L0 = hyp(this.tv * this.Lb, this.dv), vg = clamp(ctrl.vang, 0, 1);
      this.vang.len = L0 - 0.012 * vg + 0.05 * (1 - vg) ** 1.3;
    }
    if (s0.vang !== 'rigid') this.topping.len = hyp(this.Lb, this.mastHead[2] - this.pz + 0.15 * this.Lb);
    // preventer: rigged, it is made fast at the length it has, on the side the boom is on; released, it runs free
    if (this.prev) {
      const on = (ctrl.preventer || 0) > 0.5;
      if (on && !this.prevOn) {
        this.prevAt[1] = this.side * 0.4 * C.beam;
        this.prev.len = hyp3(c.x[0] - this.prevAt[0], c.x[1] - this.prevAt[1], c.x[2] - this.prevAt[2]) + 0.02;
      } else if (!on) this.prev.len = 60;
      this.prevOn = on;
    }
  }

  step(b, dt, nsub, fr) {
    const wasTaut = this.sheet.taut, rate0 = this.rate, c = this.cloth, s0 = this.s0, E3 = 3 * this.E;
    if (this.track) {
      // the boom end in the sea (sailsim.js hands the water's pull over in dipF), and the rigid kicker's gas spring
      // pushing the boom up whenever the strut is shorter than its free length
      c.f[E3] += this.dipF[0]; c.f[E3 + 1] += this.dipF[1]; c.f[E3 + 2] += this.dipF[2];
      if (s0.vangSpring) {
        const vx = this.Gp[0] + this.tv * (c.x[E3] - this.Gp[0]) - this.vangBase[0], vy = this.tv * c.x[E3 + 1], vz = this.Gp[2] + this.tv * (c.x[E3 + 2] - this.Gp[2]) - this.vangBase[2];
        const l = hyp3(vx, vy, vz) || 1, L0 = hyp(this.tv * this.Lb, this.dv), f = s0.vangSpring * clamp((L0 + 0.04 - l) / 0.08, 0, 1) * this.tv;
        c.f[E3] += f * vx / l; c.f[E3 + 1] += f * vy / l; c.f[E3 + 2] += f * vz / l;
      }
    }
    this.stepCloth(dt, nsub, fr);
    if (this.track) {
      // boom brake: friction at the boom's swing, a force at its end that slows it and never reverses it
      const Fb = (b.ctrl.brake || 0) * (s0.brake || 0);
      if (Fb > 0) {
        const ex = c.x[E3] - this.px, ey = c.x[E3 + 1], r = hyp(ex, ey) || 1, tx = -ey / r, ty = ex / r;   // horizontal tangent
        const vt = c.v[E3] * tx + c.v[E3 + 1] * ty, dv = Math.min(Math.abs(vt), Fb * clamp(Math.abs(vt) / 0.1, 0, 1) / c.m[this.E] * dt) * Math.sign(vt);
        c.v[E3] -= dv * tx; c.v[E3 + 1] -= dv * ty;
      }
      // the boom as a beam: the sheet's and the vang's downward pulls, held up by the leech at its end
      // (the cloth's lines are stiff springs held a few millimetres short, and their tension there stands for the leech's;
      // the boom carries what the crew can actually put on them: the vang's rated pull, twice the crew's sheet power)
      const T = this.track, sh = this.sheet, dzS = (this.Gp[2] - T.z) / Math.max(0.1, sh.len);
      const Fv = this.vang && !this.noVang ? Math.min(this.vang.force, s0.vangMax || 0) * this.dv / hyp(this.tv * this.Lb, this.dv) : 0;
      const Fs = Math.min(sh.force, 2 * b.cls.sheetPower) * clamp(dzS, 0, 1);
      boomBend(this.Lb, s0.boomEI || 1e5, this.tv * this.Lb, Fv, Math.min(this.tb, 0.97) * this.Lb, Fs, this.bend);
      this.bend.ratio = this.bend.M / (s0.boomMmax || 1e9);
      b.boomBent(this.bend);
      if (this.prev && this.prevOn) b.preventerLoad(this.prev.force, s0.preventer);
    }
    // boom state for the rest of the game (angle + to starboard, rate, lift)
    const ex = c.x[0] - this.Gp[0], ey = c.x[1], ez = c.x[2] - this.pz;
    const a = Math.atan2(ey, -ex);
    this.rate = wrapA(a - this.a) / dt; this.a = a;
    this.elev = Math.atan2(ez, hyp(ex, ey));
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
    cloth.addCapsule([mastXAt(C, 0) + 0.03, 0, 0], [mastXAt(C, C.mastHeight) + 0.03, 0, C.mastHeight], 0.06, nodes);
    const st = boat.sailBy.stay;
    if (st && st !== s) cloth.addCapsule([st.tackX, 0, st.tackZ], [st.tackX - (st.rake || 0), 0, st.tackZ + st.luff], 0.03, nodes);
    // (and edge-wise, so the mast and the inner stay cannot slip between its nodes as it crosses in a tack)
    if (s.kind === 'loose') {
      const W = rigWires(C, boat.sailBy);
      cloth.addWire(mastBelow(W, s.tackZ + s.luff), 0.06, bodyNodes(cloth, nu, nv, 2));
      if (W.inner && st !== s) cloth.addWire(W.inner, 0.03, bodyNodes(cloth, nu, nv));
    }
    this.a = 0.3; this.sideSmooth = 1;
  }
  pose(a, tw = null) { this.poseCloth(a, tw); this.a = a; }
  // the clew's angle (from the tack, + to starboard) for a sheet eased to e (as the strip model sets the jib)
  _clewAt(a, side, out) {
    out[0] = this.px - this.footLen * Math.cos(a); out[1] = side * this.footLen * Math.sin(a); out[2] = this.pz + this.footRise;
    return out;
  }
  setTargets(b, bendRig, sagM) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) this.pose(this._poseAngle(b, b.side.jib), this._poseTwist(b));
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
      this.sheets[k].len = hyp3(p[0] - L[0], p[1] - L[1], p[2] - L[2]) - (working ? 0.02 + 0.06 * (1 - sstep(0, 0.3, e)) : 0);
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
      if (b.lh) [b.lh.jib, b.lh.lazy] = [b.lh.lazy, b.lh.jib];
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
// How high a spinnaker's clew is cut above its tack. Flying, the clew goes where the sheet, pulling from its block
// on the quarter, balances the foot and the leech: the sheet's line bisects the angle between them. A kite cut
// with its clew level with the tack flies with the clew risen to that point, its leech a few per cent too long
// (slack: the head twists off and the foot, now the only edge the sheet pulls on, is stretched flat and stalls).
// So the sailmaker cuts it for the sheeting angle: the rise at which the sheet bisects foot and leech (side view).
export function spinClewRise(C, s) {
  const Tx = s.tackX, Tz = s.tackZ, Hx = s.tackX - (s.rake || 0), Hz = s.tackZ + s.luff;
  const Lx = C.sternX + 0.35, Lz = Math.min(C.freeboard, s.tackZ - 0.4);
  const c0 = chordAt(s, 0, false) * areaScale(s, s.luff, s.area, false);
  const f = (r) => {
    const Cx = Tx - c0, Cz = Tz + r;
    let ax = Tx - Cx, az = Tz - Cz; const al = hyp(ax, az); ax /= al; az /= al;
    let bx = Hx - Cx, bz = Hz - Cz; const bl = hyp(bx, bz); bx /= bl; bz /= bl;
    return (ax + bx) * (Lz - Cz) - (az + bz) * (Lx - Cx);      // the sheet's line against the (inward) bisector
  };
  let lo = 0, hi = 0.3 * s.luff;
  if (f(lo) * f(hi) > 0) return 0;
  for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}

export class SpinRig extends JibRig {
  constructor(boat, s0, lod) {
    const s = { ...s0, footRise: spinClewRise(boat.cls, s0) };
    super(boat, s, lod);
    const C = boat.cls, cloth = this.cloth, nu = this.nu, nv = this.nv;
    for (let j = 1; j < nv - 1; j++) cloth.setKinematic(cloth.node(0, j), false);
    // luff tape: it carries the luff tension between tack and head
    for (let j = 0; j < nv - 1; j++) { const a = cloth.node(0, j), b = cloth.node(0, j + 1); cloth.addDistance(a, b, this._rd(a, b), this.tapeEA / this._rd(a, b), true); }
    cloth.caps.length = 0;
    // it flies in front of the forestay (the jib furled on it) and the mast: collapsing, or gybed, it wraps round
    // them rather than passing through
    const W = rigWires(C, boat.sailBy), all = Array.from({ length: nu * nv }, (_, k) => cloth.off + k);
    if (W.forestay) cloth.addWire(W.forestay, 0.03, all);
    cloth.addWire(mastBelow(W, s.tackZ + s.luff), 0.06, all);
    // sheet blocks on the quarters
    this.leadZ = C.freeboard;
    this.leads[0][0] = this.leads[1][0] = C.sternX + 0.35;
    this.leads[0][1] = C.beam * 0.47; this.leads[1][1] = -C.beam * 0.47;
    this.leads[0][2] = this.leads[1][2] = this.leadZ = Math.min(this.leadZ, s.tackZ - 0.4);   // (well below the clew: leech tension)
    this.windT = 0;
  }
  setTargets(b, bendRig) {
    const s = this.s, c = this.cloth, ctrl = b.ctrl, nv = this.nv;
    if (this.needPose) { const sg = Math.sign(b.side.gennaker) || 1; this.pose(this._poseAngle(b, sg), this._poseTwist(b)); this.side = Math.sign(this.a) || sg; this.needPoleSet = true; }
    const up = 0.5 * clamp(ctrl.tackLine, 0, 1);                        // an eased tack line lets the tack rise
    // the crew gybes it: when the wind has been on the other side for a moment, the new sheet is the working one
    const wind = -Math.sign(b.diag.awaMid) || this.side;
    this.windT = wind !== this.side ? this.windT + 1 / 120 : 0;
    if (this.windT > 1.5) { this.side = wind; this.windT = 0; }
    if (s.pole) {
      // a symmetric spinnaker: the tack is the pole end, to windward, the pole squared to the apparent wind (at 90
      // degrees to it, from the forestay on a reach to square across the boat on a run); the tack line is the
      // pole's topping lift / downhaul. (The pole end moves at the foredeck crew's pace.)
      const awa = Math.abs(b.diag.awaMid ?? Math.PI), th = clamp(awa - Math.PI / 2, 12 * Math.PI / 180, 85 * Math.PI / 180);
      const g = b.cls.mastX + 0.05, L = s.pole, ws = -this.side;
      const T = [g + L * Math.cos(th), ws * L * Math.sin(th), this.pz + up], P = this.poleEnd || (this.poleEnd = T.slice());
      if (this.needPoleSet) { P[0] = T[0]; P[1] = T[1]; P[2] = T[2]; this.needPoleSet = false; }
      const dx = T[0] - P[0], dy = T[1] - P[1], dz = T[2] - P[2], dl = hyp3(dx, dy, dz), mv = Math.min(1, 1.2 / 120 / Math.max(dl, 1e-9));
      P[0] += dx * mv; P[1] += dy * mv; P[2] += dz * mv;
      c.pin(c.node(0, 0), P[0], P[1], P[2]);
    } else c.pin(c.node(0, 0), this.px, 0, this.pz + up);
    c.pin(c.node(0, nv - 1), this.px - this.rake, 0, this.pz + this.luff0);
    const p = this._p;
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? 1 : -1, L = this.leads[k];
      if (sd !== this.side) { this.sheets[k].len = 30; continue; }
      this._clewAt(lerp(s.min, s.max, clamp(b.lines.jib, 0, 1)), sd, p);
      this.sheets[k].len = hyp3(p[0] - L[0], p[1] - L[1], p[2] - L[2]);
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
