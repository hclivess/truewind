// The sail system of one boat for the vortex-lattice sail models, run inside Boat.step at 120 Hz.
//
//   'vlm'   the sails keep the shapes the rig gives them (Boat.shapeSail: depth, draft, twist per height);
//           the forces come from one vortex lattice over all of them (js/sail/vlm.js) with a viscous
//           correction per spanwise strip, instead of three independent strips per sail.
//   'cloth' as 'vlm', but the sails' shapes come from the cloth simulation (js/sail/cloth.js) under the
//           lattice's pressure and the rig's tensions (see ClothRig below).
//
// What the lattice supplies that strips could not: the headsail's downwash on the main and the main's
// upwash on the headsail (the slot), a backed headsail pushing on the main, induced drag and the span load
// from the real planform, twist and heel, and the water surface as a mirror under the foot.
// What it does not: separated flow. Each spanwise strip's lift is pulled onto a 2-D section polar at its
// effective angle of attack (decambering: Mukherjee & Gopalarathnam 2006), and the polar's profile drag
// is added along the local wind.
import { clamp, lerp, sstep, shapeCoef, STRIP_F, STRIP_W, reefAt, sailHooks } from '../physics.js';
import { DEG } from '../env.js';
import { SailLattice } from './vlm.js';
import { latticeSize } from './specs.js';
import { BoomSailRig, JibRig, SpinRig, chordAt } from './rigsim.js';

const TWO_PI = 2 * Math.PI;
// cloth substeps per 120 Hz step (js/sail/cloth.js)
export const CLOTH_SUB = 4;

export function attachSails(boat, model = 'vlm', lod = 0) {
  boat.sailModel = model; boat.lod = lod;
  boat.sailSys = model === 'strip' || lod >= 2 ? null : new SailSystem(boat, model, lod);
  return boat.sailSys;
}
sailHooks.make = (boat, model, lod) => (model === 'strip' || lod >= 2 ? null : new SailSystem(boat, model, lod));

// shape of a sail at height fraction fv, interpolated between the three shape strips as the renderer does
function shapeAt(fv, sh, base, o) {
  const F = STRIP_F;
  if (fv <= F[0]) { const k = fv / F[0]; o.a = lerp(base, sh[0].ang, k); o.d = sh[0].d; o.f = sh[0].f; }
  else if (fv <= F[1]) { const k = (fv - F[0]) / (F[1] - F[0]); o.a = lerp(sh[0].ang, sh[1].ang, k); o.d = lerp(sh[0].d, sh[1].d, k); o.f = lerp(sh[0].f, sh[1].f, k); }
  else if (fv <= F[2]) { const k = (fv - F[1]) / (F[2] - F[1]); o.a = lerp(sh[1].ang, sh[2].ang, k); o.d = lerp(sh[1].d, sh[2].d, k); o.f = lerp(sh[1].f, sh[2].f, k); }
  else { const k = (fv - F[2]) / (1 - F[2]); o.a = sh[2].ang + (sh[2].ang - sh[1].ang) * k * 0.5; o.d = sh[2].d; o.f = sh[2].f; }
  return o;
}
export class SailSystem {
  constructor(boat, model, lod) {
    this.boat = boat; this.model = model; this.lod = lod;
    const C = boat.cls;
    this.sails = C.sails.map((s) => ({ s, key: s.key, ...latticeSize(C, s, lod), rg: {}, flogging: 0, blanket: 1, side: 0, torque: 0, F: 0 }));
    this.L = new SailLattice(this.sails.map((x) => ({ nc: x.nc, ns: x.ns })), { wakeLeg: 0.25 });
    const NS = this.L.NS, N = this.L.N;
    this.sails.forEach((x, i) => { x.part = this.L.parts[i]; });
    // cloth sails (the rest keep the rig-set shapes)
    for (const x of this.sails) x.rig = model !== 'cloth' ? null : x.s.kind === 'boom' ? new BoomSailRig(boat, x.s, lod) : x.s.kind === 'loose' ? new JibRig(boat, x.s, lod) : new SpinRig(boat, x.s, lod);
    this.fr = { u: 0, v: 0, r: 0, p: 0, ud: 0, vd: 0, rd: 0, pd: 0, hd: 0, cphi: 1, sphi: 0, hv: 0, first: true };
    // per strip: polar inputs and outputs
    this.pd = new Float64Array(NS); this.pf = new Float64Array(NS);
    this.Vm = new Float64Array(NS); this.ag = new Float64Array(NS); this.ae = new Float64Array(NS);
    this.cl = new Float64Array(NS); this.clT = new Float64Array(NS); this.cd = new Float64Array(NS); this.wet = new Float64Array(NS);
    this.state = new Uint8Array(NS); this.sep = new Float64Array(NS); this.sdir = new Float64Array(3 * NS); this.wakeSrc = new Int32Array(NS); this.flog = new Float64Array(NS); this.alf = new Float64Array(NS); this.ast = new Float64Array(NS);
    this.owner = new Int32Array(NS);
    this.sails.forEach((x, i) => { for (let j = 0; j < x.ns; j++) this.owner[x.part.soff + j] = i; });
    this.Vc = new Float64Array(3 * N);                  // air velocity relative to the sail at each collocation point
    this.Fp = new Float64Array(3 * N);                  // force on each panel (rig frame), at its bound midpoint
    this.Fl = new Float64Array(3 * N);                  // its Kutta-Joukowski (inviscid) part
    this.steps = 0;
    this.rebuildEvery = lod === 0 ? 8 : 12;          // steps per influence rebuild (15 Hz at L0, 10 Hz at L1)
    this._sc = {}; this._o = {}; this._p = {};
    this.stats = { rebuilds: 0 };
  }
  active(b) { return b.lod < 2 && this.lod < 2; }
  reset() { for (const x of this.sails) if (x.rig) x.rig.needPose = true; this.fr.first = true; }
  cloth(key) { for (const x of this.sails) if (x.key === key && x.rig) return x.rig; return null; }
  owns(key) { return !!this.cloth(key) && this.active(this.boat); }

  // ------------------------------------------------------------------ geometry from the rig-set shape
  surface(b, x, rg, sh) {
    const s = x.s, C = b.cls, q = x.part, { nc, ns } = q, W = nc + 1, S = q.surf, o = this._o;
    let px, pz, luff = rg.luff;
    const rake = s.rake || 0;
    if (s.key === 'main') { px = C.mastX - 0.02; pz = C.boomZ; } else { px = s.tackX; pz = s.tackZ; }
    if (s.kind === 'spin' || s.kind === 'loose') luff *= Math.sqrt(rg.areaF);
    // chords scaled so the lattice carries the sail's rated area (times the hoisted / reefed fraction)
    let A0 = 0;
    for (let j = 0; j < ns; j++) A0 += 0.5 * (chordAt(s, j / ns) + chordAt(s, (j + 1) / ns)) / ns;
    const kc = s.area * rg.areaF / Math.max(1e-6, A0 * luff);
    const side = Math.sign(rg.baseAngle || 1), slack = s.key === 'main' ? b.reefSlack : 0;
    for (let j = 0; j <= ns; j++) {
      const fv = j / ns;
      shapeAt(fv, sh, rg.baseAngle ?? 0, o);
      const chord = chordAt(s, fv) * kc;
      const lx = px - rake * fv, lz = pz + fv * luff * (1 - 0.06 * slack);
      const ca = Math.cos(o.a), sa = Math.sin(o.a);
      const cx = -ca, cy = sa, nx = sa * side, ny = ca * side, ff = o.f, depth = o.d;
      for (let i = 0; i <= nc; i++) {
        const fu = i / nc;
        const camb = fu < ff ? 1 - (1 - fu / ff) ** 2 : 1 - ((fu - ff) / (1 - ff)) ** 2;
        const off = depth * chord * camb, k = 3 * (j * W + i);
        S[k] = lx + cx * chord * fu + nx * off; S[k + 1] = cy * chord * fu + ny * off; S[k + 2] = lz + (s.footRise || 0) * fu * (1 - fv);
      }
    }
    for (let j = 0; j < ns; j++) {
      shapeAt((j + 0.5) / ns, sh, rg.baseAngle ?? 0, o);
      this.pd[q.soff + j] = o.d; this.pf[q.soff + j] = o.f;
    }
  }

  // air velocity relative to the sail at rig-frame point (x, y, z) -> this._p (rig frame)
  airAt(b, x, y, z, ax, boom, out) {
    const { cphi, sphi, heaveH, Wbx, Wby, ug, vg, env } = ax;
    const Yl = y * cphi + z * sphi, H = z * cphi - y * sphi;          // level lateral offset and height
    const prof = env.wind.profile(H + 0.4 + heaveH);
    const axl = Wbx * prof - ug + b.r * Yl;
    const ayl = Wby * prof - vg - b.r * x - b.p * H;
    const azl = b.p * Yl;
    let vx = axl, vy = ayl * cphi - azl * sphi, vz = ayl * sphi + azl * cphi;
    if (boom) { const dx = x - boom.px; vx -= boom.rate * y; vy += boom.rate * dx; }
    out.x = vx; out.y = vy; out.z = vz;
    return out;
  }

  // 2-D section polar of strip j at signed effective angle a (flow toward +n positive): signed lift,
  // profile drag (no induced part: the lattice supplies that), state
  polar(b, x, j, a, out) {
    const s = x.s, sc = this._sc;
    let aa = Math.abs(a), rev = 1;
    if (aa > Math.PI / 2) { aa = Math.PI - aa; rev = -1; }
    shapeCoef(aa, Math.abs(this.pd[j]), this.pf[j], s, sc);
    let cl = sc.cl, cd = sc.cd - sc.cl * sc.cl / (Math.PI * s.ARe);
    if (s.kind === 'spin') {
      const alf = sc.alf * (1 - 0.3 * b.ctrl.tackLine);
      if (aa < alf) cl *= (aa / alf) ** 2;
      cl *= b.genFill; cd = lerp(0.35, cd, b.genFill);
    }
    const fl = x.flogging;
    if (fl > 0) { cl *= 1 - fl; cd += 0.15 * fl; }
    out.cl = (a < 0 ? -1 : 1) * rev * cl; out.cd = cd;
    out.state = fl > 0.5 ? 1 : (s.kind === 'spin' && b.genFill < 0.6 ? 1 : sc.state);
    out.flog = Math.max(sc.flog, fl, s.kind === 'spin' ? 1 - b.genFill : 0);
    out.alf = sc.alf; out.ast = sc.ast;
    return out;
  }

  // Section polar for a cloth strip: the cloth luffs, backs and flattens by itself, so no luffing factor here;
  // thin-airfoil lift on the live camber (zero-lift angle from the section), 10% viscous loss, saturating at
  // the maximum lift the depth allows, stalling past the depth- and draft-dependent angle, flat plate beyond
  clothPolar(b, x, j, a, out) {
    const s = x.s, L = this.L, d = Math.abs(this.pd[j]), f = this.pf[j];
    const clMax = clamp(0.42 + 7.8 * d, 0.7, 1.95), ast = (9 + 85 * d + 8 * (0.55 - f)) * DEG;
    let aa = Math.abs(a), rev = 1, a0 = L.sa0[j];
    if (aa > Math.PI / 2) { aa = Math.PI - aa; rev = -1; a0 = 0; }
    const sg = a < 0 ? -1 : 1;
    const lin = 0.9 * TWO_PI * (rev > 0 ? a - a0 : sg * aa);
    let cl = clMax * Math.tanh(lin / clMax);
    if (aa > ast) {
      const t = sstep(ast, ast + 0.5, aa);
      cl = lerp(cl * (1 - 0.3 * Math.min(1, (aa - ast) / 0.4)), sg * 1.15 * Math.sin(2 * aa), t);
    }
    if (rev < 0) cl = -sg * Math.abs(cl);
    const sep = sstep(ast * 0.8, ast + 0.45, aa);
    out.cl = cl;
    out.cd = s.cd0 + 1.4 * (d - 0.1) ** 2 + 0.03 * clamp(f - 0.45, 0, 1) + 1.25 * Math.sin(aa) ** 2 * sep;
    out.state = aa > ast * 1.08 ? 3 : 2; out.flog = 0; out.alf = 0; out.ast = ast;
    return out;
  }

  step(b, ax) {
    const C = b.cls, d = b.diag, L = this.L, dt = ax.dt;
    const { cphi, sphi, heaveH, waveH, rhoA, awaMid, qMid, bend, sag } = ax;
    const reef = reefAt(b.reefPos);
    let rebuild = !L.built;          // a new geometry (first step, tack, a sail hoisted or doused): rebuild now
    this.steps++;
    // ---- rig -> shapes -> lattice surfaces
    for (const x of this.sails) {
      const s = x.s, key = s.key, ds = d.strips[key], sh = d.shape[key];
      const rg = b.sailRig(s, reef, x.rg);
      ds.areaF = rg.areaF; ds.baseAngle = rg.baseAngle; ds.luff = rg.luff;
      if (x.rig && key === 'main' && x.rig.reefLevel !== Math.round(b.reefPos * 2) / 2) {
        // tying in (or shaking out) a reef: the cloth above the reef points is the sail now
        const a = x.rig.a;
        x.rig = new BoomSailRig(b, s, this.lod, Math.round(b.reefPos * 2) / 2);
        b.booms.main.a = a; rebuild = true;
      }
      if (x.rig) {
        // a cloth sail: the rig sets its lines and pins; its shape is its own. (A headsail furled while the
        // gennaker flies is out of the flow, and set again from its rest shape when it comes back.)
        const on = rg.areaF >= (s.kind === 'spin' ? 0.5 : 0.3);
        if (on !== x.part.on) { x.part.on = on; rebuild = true; if (on) x.rig.needPose = true; }
        if (!on) { for (let i = 0; i < 3; i++) { const st = ds[i]; st.state = 0; st.cl = 0; st.flog = 0; } continue; }
        x.rig.setTargets(b, bend, (s.sagK ?? 1) * sag * s.luff * 0.012);
        x.rig.latticeSurface(x.part);
        x.flogging = 0; x.blanket = 1;
        continue;
      }
      b.shapeSail(s, qMid, bend, sag, sh);
      const side = Math.sign(rg.baseAngle) || 1, lim = Math.max(Math.abs(rg.baseAngle), 90 * DEG);
      for (let i = 0; i < 3; i++) sh[i].ang = clamp(rg.baseAngle + side * sh[i].tw, -lim, lim);
      let fl = rg.flogging;
      if (key === 'main' && b.reefSlack > 0) fl = Math.max(fl, 0.75 * b.reefSlack);
      x.flogging = fl;
      x.blanket = 1;                          // (blanketing comes from the separated strips' wakes, below)
      const on = rg.areaF >= 0.02;
      if (on !== x.part.on) { x.part.on = on; rebuild = true; }
      if (side !== x.side) { x.side = side; rebuild = true; }        // the camber flipped: a new geometry
      if (on) this.surface(b, x, rg, sh);
      else for (let i = 0; i < 3; i++) { const st = ds[i]; st.state = 0; st.cl = 0; st.flog = rg.areaF < 0.02 ? 0 : 1; }
    }
    // ---- influence: rebuilt continuously in the background, spread over rebuildEvery steps (the geometry,
    // the water plane under the rig (a mirror) and the wake directions are frozen at the start of each cycle)
    L.updateGeometry();
    for (const x of this.sails) if (x.rig) {
      const q = x.part;
      for (let j = q.soff; j < q.soff + q.ns; j++) { this.pd[j] = L.sd[j]; this.pf[j] = L.sf[j]; }
      // a cloth sail whose camber has gone over to the other side (tacked, gybed or backed) is a new geometry
      const side = Math.sign(L.sd[q.soff + (q.ns >> 1)]) || x.side || 1;
      if (side !== x.side) { x.side = side; rebuild = true; }
    }
    if (rebuild) { this.beginCycle(b, ax); L.workRebuild(Infinity); this.stats.rebuilds++; }
    else {
      if (!L.rebuilding) this.beginCycle(b, ax);
      if (L.workRebuild(this._budget)) this.stats.rebuilds++;
    }
    // ---- boundary condition: no flow through the sail
    const N = L.N, Vc = this.Vc, p = this._p;
    // Blanketing: a separated strip leaves a wake of slow air along the wind behind it, which a potential-flow
    // lattice does not have. Each strip that was separated last step sheds a Gaussian velocity deficit
    // 1 - 0.6 sep exp(-(d/c)^2) (d: distance from the wake's centreline, c: the strip's chord) onto the other
    // sails' collocation points downstream of it. (It replaces the strip model's fixed 'blanket' factor.)
    const NSl = L.NS, wk = this.wakeSrc;
    let nw = 0;
    for (let j = 0; j < NSl; j++) if (this.sep[j] > 0.3 && this.Vm[j] > 0.5) wk[nw++] = j;
    for (const x of this.sails) {
      const q = x.part, n = q.nc * q.ns;
      if (!q.on) { for (let k = q.off; k < q.off + n; k++) { L.rhs[k] = 0; Vc[3 * k] = Vc[3 * k + 1] = Vc[3 * k + 2] = 0; } continue; }
      const boom = this._boom(b, x), rig = x.rig, cv = this._cv || (this._cv = [0, 0, 0]);
      for (let k = q.off; k < q.off + n; k++) {
        this.airAt(b, L.col[3 * k], L.col[3 * k + 1], L.col[3 * k + 2], ax, boom, p);
        if (nw) {
          let def = 0;
          const cx = L.col[3 * k], cy = L.col[3 * k + 1], cz = L.col[3 * k + 2];
          for (let w = 0; w < nw; w++) {
            const j = wk[w]; if (this.owner[j] === this.owner[L.strip[k]]) continue;
            const ex = this.sdir[3 * j], ey = this.sdir[3 * j + 1], ez = this.sdir[3 * j + 2];
            const rx = cx - L.sp[3 * j], ry = cy - L.sp[3 * j + 1], rz = cz - L.sp[3 * j + 2], al = rx * ex + ry * ey + rz * ez;
            if (al <= 0) continue;
            const d2 = rx * rx + ry * ry + rz * rz - al * al, c = Math.max(0.2, L.sc[j]);
            const dd = 0.6 * this.sep[j] * Math.exp(-d2 / (c * c));
            if (dd > def) def = dd;
          }
          if (def > 0) { p.x *= 1 - def; p.y *= 1 - def; p.z *= 1 - def; }
        }
        if (rig) {
          // the cloth's own motion (luffing, flogging, the boom swinging): relative wind, and aero damping
          const kk = k - q.off, i = kk % q.nc, j = (kk - i) / q.nc;
          rig.velocityAt((i + 0.75) / q.nc, (j + 0.5) / q.ns, cv);
          p.x -= cv[0]; p.y -= cv[1]; p.z -= cv[2];
        }
        Vc[3 * k] = p.x; Vc[3 * k + 1] = p.y; Vc[3 * k + 2] = p.z;
        L.rhs[k] = -(p.x * L.nrm[3 * k] + p.y * L.nrm[3 * k + 1] + p.z * L.nrm[3 * k + 2]);
      }
    }
    L.solveBase();
    // ---- viscous correction: each strip's lift onto its section polar at its effective angle
    const NS = L.NS, po = {};
    for (let j = 0; j < NS; j++) {
      const x = this.sails[this.owner[j]];
      if (!x.part.on) { this.Vm[j] = 0; L.delta[j] = 0; continue; }
      const q = x.part, jj = j - q.soff;
      let vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < q.nc; i++) { const k = 3 * (q.off + jj * q.nc + i); vx += Vc[k]; vy += Vc[k + 1]; vz += Vc[k + 2]; }
      vx /= q.nc; vy /= q.nc; vz /= q.nc;
      const Vm = Math.hypot(vx, vy, vz) + 1e-6;
      this.Vm[j] = Vm;
      this.sdir[3 * j] = vx / Vm; this.sdir[3 * j + 1] = vy / Vm; this.sdir[3 * j + 2] = vz / Vm;
      this.ag[j] = Math.atan2(vx * L.sn[3 * j] + vy * L.sn[3 * j + 1] + vz * L.sn[3 * j + 2], vx * L.st[3 * j] + vy * L.st[3 * j + 1] + vz * L.st[3 * j + 2]);
    }
    // Attached strips: the effective angle follows from the lattice (decambering). Strips well past the stall
    // (or with the flow arriving over the leech) are separated: the lattice's attached-flow physics does not
    // apply, so they take the polar at their geometric angle and the lattice just carries that load.
    for (let j = 0; j < NS; j++) {
      if (this.Vm[j] === 0) continue;
      const a = Math.abs(this.ag[j]), d = Math.abs(this.pd[j]), f = this.pf[j];
      const ast = (9 + 85 * d + 8 * (0.55 - f)) * DEG;
      this.sep[j] = a > Math.PI / 2 ? 1 : sstep(ast + 3 * DEG, ast + 12 * DEG, a);
    }
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < NS; j++) {
        const Vm = this.Vm[j]; if (Vm === 0) continue;
        const x = this.sails[this.owner[j]], c = Math.max(L.sc[j], 0.05), w = this.sep[j];
        const cl = 2 * L.teGamma(j) / (Vm * c);
        const ag = this.ag[j];
        const ae = lerp(ag - Math.sin(ag) + cl / TWO_PI + L.sa0[j] + L.flapK[j] * L.delta[j] / Vm, ag, w);
        const P = x.rig ? this.clothPolar : this.polar;
        P.call(this, b, x, j, ae, po); const C0 = po.cl;
        const h = 0.3 * DEG;
        const dC = (P.call(this, b, x, j, ae + h, po).cl - P.call(this, b, x, j, ae - h, po).cl) / (2 * h);
        const dcl = 2 * L.RT[j * NS + j] / (Vm * c);
        const J = dcl - (1 - w) * Math.max(0, dC) * (dcl / TWO_PI + L.flapK[j] / Vm);
        let stp = J !== 0 ? -(cl - C0) / J : 0;
        stp = clamp(stp, -0.6 * Vm, 0.6 * Vm);
        L.delta[j] += 0.9 * stp;
        if (!Number.isFinite(L.delta[j])) L.delta[j] = 0;
      }
    }
    const g = L.compose(), vi = L.induced(g);
    // ---- forces: Kutta-Joukowski on every bound segment with the local velocity, profile drag per strip
    for (let j = 0; j < NS; j++) {
      const Vm = this.Vm[j]; if (Vm === 0) continue;
      const x = this.sails[this.owner[j]], c = Math.max(L.sc[j], 0.05);
      const cl = 2 * L.teGamma(j) / (Vm * c), ag = this.ag[j];
      const ae = lerp(ag - Math.sin(ag) + cl / TWO_PI + L.sa0[j] + L.flapK[j] * L.delta[j] / Vm, ag, this.sep[j]);
      (x.rig ? this.clothPolar : this.polar).call(this, b, x, j, ae, po);
      this.ae[j] = ae; this.cl[j] = cl; this.clT[j] = po.cl; this.cd[j] = po.cd; this.state[j] = po.state; this.flog[j] = po.flog; this.alf[j] = po.alf; this.ast[j] = po.ast;
      // wet strips (knocked down): no air load
      const px = L.sp[3 * j], py = L.sp[3 * j + 1], pz = L.sp[3 * j + 2];
      this.wet[j] = sstep(0.45, -0.15, pz * cphi - py * sphi + heaveH - waveH);
    }
    const Fp = this.Fp;
    for (let k = 0; k < N; k++) {
      const j = L.strip[k], Vm = this.Vm[j];
      if (Vm === 0) { Fp[3 * k] = Fp[3 * k + 1] = Fp[3 * k + 2] = 0; continue; }
      const x = this.sails[this.owner[j]], w = this.sep[j], keep = x.blanket * (1 - this.wet[j]);
      const pk = L.prevP[k], dG = g[k] - (pk >= 0 ? g[pk] : 0);
      const ux = Vc[3 * k] + vi[3 * k], uy = Vc[3 * k + 1] + vi[3 * k + 1], uz = Vc[3 * k + 2] + vi[3 * k + 2];
      const lx = L.bl[3 * k], ly = L.bl[3 * k + 1], lz = L.bl[3 * k + 2];
      // attached flow: Kutta-Joukowski on the bound segment with the local velocity, plus the profile drag
      // along the strip's wind
      const f = rhoA * dG * keep * (1 - w);
      const q = x.part, jj = j - q.soff;
      let vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < q.nc; i++) { const m = 3 * (q.off + jj * q.nc + i); vx += Vc[m]; vy += Vc[m + 1]; vz += Vc[m + 2]; }
      const qd = 0.5 * rhoA * Vm * this.cd[j] * L.area[k] * keep * (1 - w) / q.nc;
      const Lx = f * (uy * lz - uz * ly), Ly = f * (uz * lx - ux * lz), Lz = f * (ux * ly - uy * lx);
      this.Fl[3 * k] = Lx; this.Fl[3 * k + 1] = Ly; this.Fl[3 * k + 2] = Lz;
      let Fx = Lx + qd * vx, Fy = Ly + qd * vy, Fz = Lz + qd * vz;
      const qA = 0.5 * rhoA * Vm * Vm * L.area[k] * keep;
      if (w > 0) {
        // separated flow: the section's normal and chordwise force coefficients, spread evenly over the strip
        const a = this.ae[j], cl = this.clT[j], cd = this.cd[j], ca = Math.cos(a), sa = Math.sin(a);
        const Cn = cl * ca + cd * sa, Ct = cd * ca - cl * sa, jn = 3 * j;
        Fx += w * qA * (Cn * L.sn[jn] + Ct * L.st[jn]); Fy += w * qA * (Cn * L.sn[jn + 1] + Ct * L.st[jn + 1]); Fz += w * qA * (Cn * L.sn[jn + 2] + Ct * L.st[jn + 2]);
      }
      // (a guard: no panel carries more than a few times its dynamic pressure, whatever the lattice says)
      const Fm = Math.hypot(Fx, Fy, Fz), cap = 4 * qA + 1e-9;
      if (!(Fm <= cap)) {
        if (Number.isFinite(Fm)) { const r = cap / Fm; Fx *= r; Fy *= r; Fz *= r; this.Fl[3 * k] *= r; this.Fl[3 * k + 1] *= r; this.Fl[3 * k + 2] *= r; }
        else { if (!this._nanw) { this._nanw = true; console.warn('sail panel force not finite', k, j, { dG, ae: this.ae[j], cl: this.clT[j], cd: this.cd[j], Vm, vi: vi[3 * k], vc: Vc[3 * k] }); } Fx = Fy = Fz = 0; this.Fl[3 * k] = this.Fl[3 * k + 1] = this.Fl[3 * k + 2] = 0; }
      }
      Fp[3 * k] = Fx; Fp[3 * k + 1] = Fy; Fp[3 * k + 2] = Fz;
    }
    // ---- loads on the hull, boom torques, sheet loads, diagnostics
    let sailX = 0, sailY = 0, sailK = 0, Nm = 0;
    let clHeadSum = 0, clMainMid = 0;
    const load = this._load || (this._load = (X, Y, Z, Fx, Fy, Fz) => {
      const FY = Fy * this._c + Fz * this._s;
      this._sx += Fx; this._sy += FY; this._sk += Z * Fy - Y * Fz; this._sn += X * FY - (Y * this._c + Z * this._s) * Fx;
    });
    this._c = cphi; this._s = sphi; this._sx = 0; this._sy = 0; this._sk = 0; this._sn = 0;
    this.frame(b, ax);
    for (const x of this.sails) {
      const s = x.s, q = x.part, key = s.key, ds = d.strips[key], sh = d.shape[key];
      let torque = 0, Fsum = 0;
      if (x.rig && !q.on) { ds.F = 0; x.F = 0; continue; }
      if (x.rig) {
        // cloth: the panel loads go onto the cloth, the cloth moves, and the rig hands the hull what it carries
        const rig = x.rig, cl = rig.cloth;
        cl.f.fill(0);
        // (the wind comes on gradually after the sail is (re)set, as a crew would hoist it)
        const ramp = Math.min(1, (rig.sincePose || 0) / 0.6);
        for (let jj = 0; jj < q.ns; jj++) {
          let fx = 0, fy = 0, fz = 0;
          for (let i = 0; i < q.nc; i++) {
            const k3 = 3 * (q.off + jj * q.nc + i);
            // a membrane carries the pressure difference normal to itself; the chordwise part of the lattice force
            // (leading-edge suction) acts at the luff, and so goes to the mast / stay, not into the cloth
            const Fl = this.Fl, nx = L.nrm[k3], ny = L.nrm[k3 + 1], nz = L.nrm[k3 + 2];
            const fn = Fl[k3] * nx + Fl[k3 + 1] * ny + Fl[k3 + 2] * nz;
            const tx = Fl[k3] - fn * nx, ty = Fl[k3 + 1] - fn * ny, tz = Fl[k3 + 2] - fn * nz;
            cl.splat((i + 0.5) / q.nc, (jj + 0.5) / q.ns, ramp * (Fp[k3] - tx), ramp * (Fp[k3 + 1] - ty), ramp * (Fp[k3 + 2] - tz));
            cl.splat(0, (jj + 0.5) / q.ns, ramp * tx, ramp * ty, ramp * tz);
            fx += Fp[k3]; fy += Fp[k3 + 1]; fz += Fp[k3 + 2];
          }
          Fsum += Math.hypot(fx, fy, fz);
        }
        this.flutter(b, x, rig, ramp, rhoA);
        rig.step(b, dt, CLOTH_SUB, this.fr);
        if (!cl.finite() || Math.abs(rig.rate) > 50) {
          // numerical trouble: put the sail back to its rest shape at the boom's angle and go on
          if (!this._warned) { console.warn('sail cloth reset', key); this._warned = true; }
          rig.pose(Number.isFinite(rig.a) ? rig.a : 0.3); rig.a = Number.isFinite(rig.a) ? rig.a : 0.3; rig.rate = 0;
        } else rig.loads(dt, load);
        const bm = b.booms[key];
        if (bm) {
          bm.a = rig.a; bm.rate = rig.rate; bm.elev = rig.elev;
          d.rig[key + 'Load'] = lerp(d.rig[key + 'Load'] || 0, rig.sheetLoad(), 0.1);
          d.rig[key + 'Limit'] = b.boomLimit(s);
        } else if (s.kind === 'loose' || b.genDeploy > 0.5) {
          d.rig.jibLoad = lerp(d.rig.jibLoad || 0, rig.sheetLoad(), 0.1);
          d.rig.lazyLoad = lerp(d.rig.lazyLoad || 0, rig.lazyLoad(), 0.1);
        }
        if (s.kind === 'spin') {
          // how full it is (the HUD and the sound read it): its mid-height lift
          let cm = 0; for (let jj = 0; jj < q.ns; jj++) cm += Math.abs(this.cl[q.soff + jj]); cm /= q.ns;
          b.genFill = clamp(b.genFill + (cm > 0.45 ? 1.4 : -2.6) * dt, 0, 1);
        }
        ds.baseAngle = rig.a;
        rig.measure(sh, rig.a);
      } else if (q.on) {
        const boom = s.kind === 'boom' ? this._boom(b, x) : null;
        for (let jj = 0; jj < q.ns; jj++) {
          let fx = 0, fy = 0, fz = 0;
          for (let i = 0; i < q.nc; i++) {
            const k = q.off + jj * q.nc + i, k3 = 3 * k;
            const Fx = Fp[k3], Fy = Fp[k3 + 1], Fz = Fp[k3 + 2];
            const X = L.bm[k3], Y = L.bm[k3 + 1], Z = L.bm[k3 + 2];
            const FY = Fy * cphi + Fz * sphi;
            sailX += Fx; sailY += FY; sailK += Z * Fy - Y * Fz;
            Nm += X * FY - (Y * cphi + Z * sphi) * Fx;
            if (boom) torque += Y * Fx - (X - boom.px) * Fy;
            fx += Fx; fy += Fy; fz += Fz;
          }
          Fsum += Math.hypot(fx, fy, fz);
        }
      }
      ds.F = Fsum;
      // the three strips the rest of the game reads (HUD, telltales, audio, auto trim)
      for (let i = 0; i < 3; i++) {
        const o = ds[i], shp = sh[i];
        // water drag of the sail where it lies in the sea, as the strip model has it
        const f = STRIP_F[i], chord = s.foot * (1 - f) + s.head * f, rg = x.rg;
        const zs = rg.pivotZ + f * rg.luff + (s.footRise || 0) * 0.4 * (1 - f);
        const ca = Math.cos(shp.ang), sa = Math.sin(shp.ang);
        const xce = rg.pivotX - (s.rake || 0) * f - 0.4 * chord * ca, yce = 0.4 * chord * sa;
        const wet = q.on ? b.sailWet(s.area * STRIP_W[i] * rg.areaF, zs * cphi - yce * sphi + heaveH - waveH, zs, xce, ax) : 0;
        o.inWater = wet > 0.5;
        if (!q.on) continue;
        const j = q.soff + clamp(Math.floor(f * q.ns), 0, q.ns - 1);
        o.alpha = this.ae[j]; o.cl = Math.abs(this.cl[j]); o.cd = this.cd[j] + this.cl[j] ** 2 / (Math.PI * s.ARe); o.V = this.Vm[j];
        o.alf = this.alf[j]; o.ast = this.ast[j]; o.state = this.state[j]; o.flog = this.flog[j];
        if (wet > 0.99) { o.state = 0; o.cl = 0; o.flog = 0; }
        if (i === 1) {
          if (key === 'main') clMainMid = o.cl;
          else clHeadSum = Math.max(clHeadSum, o.cl * rg.areaF);
          if (s.kind === 'spin') {
            const target = Math.abs(o.alpha) > o.alf * 0.75 * (1 - 0.3 * b.ctrl.tackLine) && Math.abs(b.side.gennaker) > 0.8 ? 1 : 0;
            b.genFill = clamp(b.genFill + (target ? 1.4 : -2.6) * dt, 0, 1);
          }
        }
      }
      // how far the flow at the sail is turned from the geometric angle (downwash and the other sails'
      // interference), area-weighted: what the crew corrects for when trimming to the telltales
      if (q.on) {
        let ai = 0, aw = 0;
        for (let jj = 0; jj < q.ns; jj++) { const j = q.soff + jj, sg = this.ag[j] < 0 ? -1 : 1; ai += sg * (this.ag[j] - this.ae[j]) * L.sa[j]; aw += L.sa[j]; }
        ds.aInd = lerp(ds.aInd ?? 0, clamp(ai / Math.max(aw, 1e-6), -0.12, 0.12), 0.05);
      }
      x.torque = torque; x.F = Fsum;
      if (s.kind === 'boom' && !x.rig) b.boomDynamics(s, torque, dt, true);
      else if (!x.rig && (s.kind === 'loose' || (s.kind === 'spin' && b.genDeploy > 0.5))) d.rig.jibLoad = lerp(d.rig.jibLoad || 0, Fsum * 0.95 * x.rg.areaF, 0.1);
    }
    b._clHead = lerp(b._clHead, clHeadSum, 0.2);
    b._clMain = lerp(b._clMain, clMainMid, 0.2);
    sailX += this._sx; sailY += this._sy; sailK += this._sk; Nm += this._sn;
    // (as the strip model: ax.X/Y/K carry the water loads only, the sail forces go in ax.sail*; yaw in ax.N)
    ax.N += Nm; ax.sailX += sailX; ax.sailY += sailY; ax.sailK += sailK;
  }
  // Flogging. A strip that carries almost no lift is a sheet in the wind: flag flutter needs the unsteady
  // wake a quasi-steady lattice does not have, so the luffing cloth gets a travelling pressure wave instead,
  // amplitude 0.15 q, frequency 0.2 V / (0.3 c), running aft along the chord. It is triggered by the state
  // (|cl| < 0.3), never by a control, and its phase is a function of the step and the strip only (no
  // randomness: two boats in the same state flog alike).
  flutter(b, x, rig, ramp, rhoA) {
    const L = this.L, q = x.part, cl = rig.cloth, t = b.t || 0;
    for (let jj = 0; jj < q.ns; jj++) {
      const j = q.soff + jj, Vm = this.Vm[j]; if (Vm < 1) continue;
      const w = clamp(1 - Math.abs(this.cl[j]) / 0.3, 0, 1) * (1 - this.wet[j]);
      if (w <= 0) continue;
      const c = Math.max(0.2, L.sc[j]), f = 0.2 * Vm / (0.3 * c), amp = 0.15 * 0.5 * rhoA * Vm * Vm * w * ramp;
      for (let i = 0; i < q.nc; i++) {
        const k = q.off + jj * q.nc + i, k3 = 3 * k, u = (i + 0.5) / q.nc;
        const pr = amp * L.area[k] * Math.sin(2 * Math.PI * (f * t - u / 0.6) + 1.7 * jj);
        cl.splat(u, (jj + 0.5) / q.ns, pr * L.nrm[k3], pr * L.nrm[k3 + 1], pr * L.nrm[k3 + 2]);
      }
      this.flog[j] = Math.max(this.flog[j], w);
    }
  }
  // the hull's motion for the cloth's fictitious forces: rates and their derivatives (last step's change)
  frame(b, ax) {
    const f = this.fr, dt = ax.dt;
    if (f.first) { f.ud = f.vd = f.rd = f.pd = f.hd = 0; f.first = false; }
    else { f.ud = (b.u - f.u) / dt; f.vd = (b.v - f.v) / dt; f.rd = (b.r - f.r) / dt; f.pd = (b.p - f.p) / dt; f.hd = (b.heaveV - f.hv) / dt; }
    // (a clamp: a collision or a reset is not an acceleration the rig should be thrown by)
    f.ud = clamp(f.ud, -30, 30); f.vd = clamp(f.vd, -30, 30); f.rd = clamp(f.rd, -20, 20); f.pd = clamp(f.pd, -20, 20); f.hd = clamp(f.hd, -30, 30);
    f.u = b.u; f.v = b.v; f.r = b.r; f.p = b.p; f.hv = b.heaveV; f.cphi = ax.cphi; f.sphi = ax.sphi;
  }
  beginCycle(b, ax) {
    const L = this.L, im = L.image, { cphi, sphi, heaveH, waveH } = ax;
    im.on = Math.abs(b.phi) < 60 * DEG;
    im.nx = 0; im.ny = -sphi; im.nz = cphi; im.h0 = heaveH - waveH;
    const p = this._p;
    for (const x of this.sails) {
      const q = x.part; if (!q.on) continue;
      const W = q.nc + 1, S = q.surf, boom = this._boom(b, x);
      for (let j = 0; j <= q.ns; j++) {
        const k = 3 * (j * W + q.nc);
        this.airAt(b, S[k], S[k + 1], S[k + 2], ax, boom, p);
        const l = Math.hypot(p.x, p.y, p.z) || 1;
        q.wake[3 * j] = p.x / l; q.wake[3 * j + 1] = p.y / l; q.wake[3 * j + 2] = p.z / l;
      }
    }
    // the forces' induced-velocity matrix every third cycle: it only turns the force a little
    this.cycle = (this.cycle || 0) + 1;
    const withM3 = !this._m3ok || this.cycle % 3 === 0;
    this._m3ok = true;
    L.beginRebuild(withM3);
    this._budget = L.rebuildCost(withM3) / this.rebuildEvery;
  }
  _boom(b, x) {
    if (x.s.kind !== 'boom' || x.rig) return null;
    const o = x._bm || (x._bm = {});
    o.px = x.s.key === 'main' ? b.cls.mastX : x.s.tackX; o.rate = b.booms[x.s.key].rate;
    return o;
  }
}
