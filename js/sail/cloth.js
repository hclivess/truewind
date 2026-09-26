// Sailcloth as an anisotropic membrane, integrated by projective dynamics (Bouaziz et al. 2014): implicit
// Euler, each substep one or more local/global iterations. Local: every constraint projects its current
// state onto its rest set. Global: one linear solve with a constant, prefactored, banded matrix
// M/h^2 + sum w G^T G. Unconditionally stable for stiff cloth, and the static answer is exact.
//
// (Small-step XPBD was tried first: its one Gauss-Seidel sweep per substep cannot carry a static load across
// a stiff sheet, and loaded sailcloth came out 2 to 100 times too stretchy; warm-starting its multipliers
// fixed the statics but went unstable as soon as the sheet billowed.)
//
// Stretch: per triangle, three terms in the cloth's material frame (warp, fill, shear), weight k A, where k is
// the cloth's stiffness per unit width (N/m) in that direction and A the triangle's rest area. The rest metric
// is the sailmaker's moulded shape, so the cloth holds that shape under pressure and nothing else: with no
// pressure it has no shape at all (it luffs, backs and flogs by itself).
//
// Particles: `extra` rig particles first (a boom end), then the cloth nodes (node (i, j) = off + j nu + i), so
// the matrix stays banded (bandwidth nu + 1). Other terms: distances (battens), a node held at a point along a
// segment from a fixed anchor to a particle (the foot on the boom), a particle's distance to a fixed point
// (the boom's length), unilateral ropes from a point on such a segment to a fixed point (sheet, vang, topping
// lift; their stretch gives the line loads), kinematic nodes (tack, head, luff on the mast) and capsules the
// cloth cannot enter (mast, shrouds, stays).
//
// Everything is simulated in the boat's rig frame (x forward, y starboard, z up along the mast): the owner
// supplies gravity rotated by heel and the frame's fictitious accelerations.
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

// banded symmetric positive definite matrix: A[i][i - k] stored at B[i * (bw + 1) + k], k = 0..bw
function bandCholesky(B, n, bw) {
  const W = bw + 1;
  for (let i = 0; i < n; i++) {
    for (let k = Math.min(bw, i); k >= 0; k--) {
      const j = i - k;
      let s = B[i * W + k];
      for (let l = Math.max(0, i - bw); l < j; l++) s -= B[i * W + (i - l)] * B[j * W + (j - l)];
      if (k === 0) B[i * W] = Math.sqrt(Math.max(s, 1e-300));
      else B[i * W + k] = s / B[j * W];
    }
  }
}
function bandSolve(B, n, bw, b) {
  const W = bw + 1;
  for (let i = 0; i < n; i++) { let s = b[i]; for (let l = Math.max(0, i - bw); l < i; l++) s -= B[i * W + (i - l)] * b[l]; b[i] = s / B[i * W]; }
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; const hi = Math.min(n - 1, i + bw); for (let l = i + 1; l <= hi; l++) s -= B[l * W + (l - i)] * b[l]; b[i] = s / B[i * W]; }
  return b;
}

export class Cloth {
  constructor(nu, nv, extra = 0) {
    this.nu = nu; this.nv = nv; this.off = extra; this.nc = nu * nv; this.n = this.nc + extra;
    const n = this.n;
    this.x = new Float64Array(3 * n); this.v = new Float64Array(3 * n); this.xo = new Float64Array(3 * n);
    this.v0 = new Float64Array(3 * n);             // velocity at the start of the step (for the loads)
    this.m = new Float64Array(n);                  // inertial mass (cloth + the air it carries)
    this.mg = new Float64Array(n);                 // mass that weighs
    this.f = new Float64Array(3 * n);              // external force held over the step (aero)
    this.kin = new Uint8Array(n);                  // 1 = placed by the rig (target in kt), not by forces
    this.kt = new Float64Array(3 * n);
    const T = 2 * (nu - 1) * (nv - 1);
    this.T = T; this.tri = new Int32Array(3 * T); this.cf = new Float64Array(6 * T); this.tA = new Float64Array(T);
    this.kw = new Float64Array(T); this.kf = new Float64Array(T); this.kb = new Float64Array(T);
    let t = 0;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = extra + j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      // alternate the diagonal so the mesh has no preferred shear direction
      if ((i + j) & 1) { this.tri.set([a, b, d], 3 * t++); this.tri.set([a, d, c], 3 * t++); }
      else { this.tri.set([a, b, c], 3 * t++); this.tri.set([b, d, c], 3 * t++); }
    }
    this.dist = []; this.att = []; this.lens = []; this.ropes = []; this.caps = [];
    this.damp = 0.5;                               // s^-1, relative to the rig frame
    this.iters = 1;                                // local/global iterations per substep
    this.grav = new Float64Array([0, 0, -9.81]);   // gravity in the rig frame (set by the owner as the boat heels)
    this.bw = 2 * nu + 1;
    // curvature-rate damping (N s/m, per unit of the grid Laplacian): damps wrinkles and flutter at the grid scale
    // (sub-grid wrinkling and the cloth's internal friction) without touching the statics or the large-scale
    // motion; tensionOnly: the cloth carries no compression along the warp or the fill (it wrinkles instead)
    this.curvDamp = 0; this.tensionOnly = true; this.compress = 0;
    this._g = new Float64Array(3); this._h = 0; this._dirty = true;
  }
  node(i, j) { return this.off + j * this.nu + i; }

  // Rest metric from a moulded 3-D shape (rest: 3 nc cloth-node coordinates) and a material direction field:
  // dir(i, j, out3) gives the warp direction near node (i, j); k = { warp, fill, bias } per unit width (N/m);
  // rho kg/m^2 of cloth; airMass(i, j) kg/m^2 of air the membrane carries with it (added mass)
  setRest(rest, dir, k, rho, airMass) {
    const { nu, tri, cf, off } = this;
    for (let i = off; i < this.n; i++) { this.m[i] = 0; this.mg[i] = 0; }
    const e = [0, 0, 0];
    for (let t = 0; t < this.T; t++) {
      const i0 = tri[3 * t], i1 = tri[3 * t + 1], i2 = tri[3 * t + 2];
      const r0 = 3 * (i0 - off), r1 = 3 * (i1 - off), r2 = 3 * (i2 - off);
      const ax = rest[r1] - rest[r0], ay = rest[r1 + 1] - rest[r0 + 1], az = rest[r1 + 2] - rest[r0 + 2];
      const bx = rest[r2] - rest[r0], by = rest[r2 + 1] - rest[r0 + 1], bz = rest[r2 + 2] - rest[r0 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = hyp3(nx, ny, nz) || 1e-12; nx /= nl; ny /= nl; nz /= nl;
      const A = 0.5 * nl;
      const q0 = i0 - off, q1 = i1 - off, q2 = i2 - off;
      const ci = Math.round(((q0 % nu) + (q1 % nu) + (q2 % nu)) / 3), cj = Math.round((Math.floor(q0 / nu) + Math.floor(q1 / nu) + Math.floor(q2 / nu)) / 3);
      dir(ci, cj, e);
      const d = e[0] * nx + e[1] * ny + e[2] * nz;
      let e1x = e[0] - d * nx, e1y = e[1] - d * ny, e1z = e[2] - d * nz;
      const el = hyp3(e1x, e1y, e1z) || 1; e1x /= el; e1y /= el; e1z /= el;
      const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;
      // edge vectors in the (warp, fill) frame: Dm = [a b]; f1 = F e1 = sum c1_a x_a, f2 = sum c2_a x_a
      const a1 = ax * e1x + ay * e1y + az * e1z, a2 = ax * e2x + ay * e2y + az * e2z;
      const b1 = bx * e1x + by * e1y + bz * e1z, b2 = bx * e2x + by * e2y + bz * e2z;
      const det = a1 * b2 - b1 * a2 || 1e-12;
      const d00 = b2 / det, d01 = -b1 / det, d10 = -a2 / det, d11 = a1 / det;
      cf[6 * t] = -(d00 + d10); cf[6 * t + 1] = d00; cf[6 * t + 2] = d10;       // f1 coefficients of nodes 0, 1, 2
      cf[6 * t + 3] = -(d01 + d11); cf[6 * t + 4] = d01; cf[6 * t + 5] = d11;   // f2
      this.tA[t] = A;
      // shear: the orthogonal-pair projection moves each of f1, f2 by ~gamma/2, so weight 2 G A gives G A gamma^2 / 2
      this.kw[t] = k.warp * A; this.kf[t] = k.fill * A; this.kb[t] = 2 * k.bias * A;
      const mt = rho * A / 3, ma = (airMass ? airMass(ci, cj) : 0) * A / 3;
      for (const i of [i0, i1, i2]) { this.m[i] += mt + ma; this.mg[i] += mt; }
    }
    this._dirty = true;
  }
  setParticle(i, mass, weighs = mass) { this.m[i] = mass; this.mg[i] = weighs; this._dirty = true; }
  setKinematic(i, on) { if (!!this.kin[i] !== !!on) this._dirty = true; this.kin[i] = on ? 1 : 0; }
  pin(i, x, y, z) { this.kt[3 * i] = x; this.kt[3 * i + 1] = y; this.kt[3 * i + 2] = z; }

  // distance constraint (a batten); tension: only resists being stretched (a tape or a line)
  addDistance(i, j, rest, w, tension = false) { const c = { i, j, rest, w, tension }; this.dist.push(c); this._dirty = true; return c; }
  // node i held at anchor + t (x_e - anchor): the foot on the boom
  addAttach(i, e, t, anchor, w = 1e6) { const c = { i, e, t, anchor, w }; this.att.push(c); this._dirty = true; return c; }
  // particle e kept at distance len from the fixed point `at` (a boom pivoting on its gooseneck)
  addLength(e, at, len, w = 1e7) { const c = { e, at, len, w }; this.lens.push(c); this._dirty = true; return c; }
  // unilateral rope from the point anchor + t (x_e - anchor) to the fixed point `to`, no longer than len;
  // w is the rope's stiffness (N/m)
  addRope(e, t, anchor, to, len, w = 3e4) { const c = { e, t, anchor, to, len, w, force: 0, taut: false }; this.ropes.push(c); this._dirty = true; return c; }
  addCapsule(a, b, r, nodes) { const c = { a, b, r, nodes }; this.caps.push(c); return c; }

  // the constant system matrix M/h^2 + sum w G^T G (band), with kinematic rows eliminated
  _factor(h) {
    const n = this.n, bw = this.bw, W = bw + 1, B = this.B = new Float64Array(n * W);
    const add = (i, j, v) => { if (i < j) { const t = i; i = j; j = t; } const k = i - j; if (k > bw) throw new Error('cloth: coupling outside the band'); B[i * W + k] += v; };
    for (let i = 0; i < n; i++) add(i, i, this.m[i] / (h * h) + 1e-9);
    const cf = this.cf, tri = this.tri;
    for (let t = 0; t < this.T; t++) {
      const id = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
      for (const [w, o] of [[this.kw[t] + this.kb[t], 0], [this.kf[t] + this.kb[t], 3]])
        for (let a = 0; a < 3; a++) for (let b = 0; b <= a; b++) add(id[a], id[b], w * cf[6 * t + o + a] * cf[6 * t + o + b]);
    }
    if (this.curvDamp > 0) {
      const k = this.curvDamp / h, nu = this.nu, nv = this.nv, off = this.off, co = [], id = [];
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        id.length = 0; co.length = 0;
        const me = off + j * nu + i; let deg = 0;
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nu || b >= nv) continue; id.push(off + b * nu + a); co.push(1); deg++; }
        id.push(me); co.push(-deg);
        for (let p = 0; p < id.length; p++) for (let q = 0; q <= p; q++) add(id[p], id[q], k * co[p] * co[q] * (p === q ? 1 : 1));
      }
    }
    for (const c of this.dist) { add(c.i, c.i, c.w); add(c.j, c.j, c.w); add(c.i, c.j, -c.w); }
    for (const c of this.att) { add(c.i, c.i, c.w); add(c.e, c.e, c.w * c.t * c.t); add(c.i, c.e, -c.w * c.t); }
    for (const c of this.lens) add(c.e, c.e, c.w);
    for (const r of this.ropes) add(r.e, r.e, r.w * r.t * r.t);
    // kinematic nodes: keep their couplings for the right-hand side, then make their rows identity
    const kc = [];
    for (let i = 0; i < n; i++) if (this.kin[i]) {
      for (let j = Math.max(0, i - bw); j <= Math.min(n - 1, i + bw); j++) {
        if (j === i || this.kin[j]) continue;
        const v = j < i ? B[i * W + (i - j)] : B[j * W + (j - i)];
        if (v !== 0) kc.push(j, i, v);
      }
    }
    this.kc = Float64Array.from(kc);
    for (let i = 0; i < n; i++) if (this.kin[i]) {
      for (let k = 1; k <= bw; k++) { if (i - k >= 0) B[i * W + k] = 0; if (i + k < n) B[(i + k) * W + k] = 0; }
      B[i * W] = 1;
    }
    bandCholesky(B, n, bw);
    this.rhs = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
    this._h = h; this._dirty = false;
  }

  // One step of dt in nsub substeps; acc(i, x, v, out3): the frame's fictitious acceleration at particle i
  step(dt, nsub, acc) {
    const h = dt / nsub, n = this.n, x = this.x, v = this.v, f = this.f, m = this.m, mg = this.mg, G = this.grav, g = this._g;
    if (this._dirty || this._h !== h) this._factor(h);
    this.v0.set(v);
    for (const r of this.ropes) { r.force = 0; r.taut = false; }
    const damp = Math.max(0, 1 - this.damp * h), y = this.y || (this.y = new Float64Array(3 * n));
    for (let s = 0; s < nsub; s++) {
      this.xo.set(x);
      // inertial prediction
      for (let i = 0; i < n; i++) {
        const i3 = 3 * i;
        if (this.kin[i]) { y[i3] = this.kt[i3]; y[i3 + 1] = this.kt[i3 + 1]; y[i3 + 2] = this.kt[i3 + 2]; continue; }
        acc(i, x, v, g);
        const im = 1 / m[i], wg = mg[i] * im;
        const vx = (v[i3] + h * (f[i3] * im + g[0] + G[0] * wg)) * damp;
        const vy = (v[i3 + 1] + h * (f[i3 + 1] * im + g[1] + G[1] * wg)) * damp;
        const vz = (v[i3 + 2] + h * (f[i3 + 2] * im + g[2] + G[2] * wg)) * damp;
        y[i3] = x[i3] + h * vx; y[i3 + 1] = x[i3 + 1] + h * vy; y[i3 + 2] = x[i3 + 2] + h * vz;
        // the projections start from where the cloth drifts with its present velocity, without this substep's
        // forces: rigid motion is free, and a static load is an exact fixed point. (Starting from the full
        // prediction, as plain projective dynamics does, tilts every edge next to a pinned node by h^2 F / m;
        // times the cloth's axial stiffness that swamps the small lateral forces a membrane works with, and the
        // sail's sections came out flat-topped and hooked.)
        x[i3] += h * v[i3] * damp; x[i3 + 1] += h * v[i3 + 1] * damp; x[i3 + 2] += h * v[i3 + 2] * damp;
      }
      for (let i = 0; i < n; i++) if (this.kin[i]) { x[3 * i] = y[3 * i]; x[3 * i + 1] = y[3 * i + 1]; x[3 * i + 2] = y[3 * i + 2]; }
      for (let it = 0; it < this.iters; it++) this._iterate(h, y, s === nsub - 1 && it === this.iters - 1);
      this.solveCapsules();
      const ih = 1 / h;
      for (let i = 0; i < 3 * n; i++) v[i] = (x[i] - this.xo[i]) * ih;
    }
  }

  // one local/global iteration: x <- A^-1 (M/h^2 y + sum w G^T p(x))
  _iterate(h, y, last) {
    const n = this.n, x = this.x, m = this.m, ih2 = 1 / (h * h), R = this.rhs, rx = R[0], ry = R[1], rz = R[2];
    for (let i = 0; i < n; i++) { const w = m[i] * ih2; rx[i] = w * y[3 * i]; ry[i] = w * y[3 * i + 1]; rz[i] = w * y[3 * i + 2]; }
    // stretch: warp, fill (unit length) and shear (an orthogonal pair about the bisector)
    const cf = this.cf, tri = this.tri, S = Math.SQRT1_2;
    for (let t = 0; t < this.T; t++) {
      const i0 = tri[3 * t], i1 = tri[3 * t + 1], i2 = tri[3 * t + 2];
      const a0 = 3 * i0, a1 = 3 * i1, a2 = 3 * i2, o = 6 * t;
      const c0 = cf[o], c1 = cf[o + 1], c2 = cf[o + 2], e0 = cf[o + 3], e1 = cf[o + 4], e2 = cf[o + 5];
      const f1x = c0 * x[a0] + c1 * x[a1] + c2 * x[a2], f1y = c0 * x[a0 + 1] + c1 * x[a1 + 1] + c2 * x[a2 + 1], f1z = c0 * x[a0 + 2] + c1 * x[a1 + 2] + c2 * x[a2 + 2];
      const f2x = e0 * x[a0] + e1 * x[a1] + e2 * x[a2], f2y = e0 * x[a0 + 1] + e1 * x[a1 + 1] + e2 * x[a2 + 1], f2z = e0 * x[a0 + 2] + e1 * x[a1 + 2] + e2 * x[a2 + 2];
      const l1 = Math.sqrt(f1x * f1x + f1y * f1y + f1z * f1z) || 1e-12, l2 = Math.sqrt(f2x * f2x + f2y * f2y + f2z * f2z) || 1e-12;
      const u1x = f1x / l1, u1y = f1y / l1, u1z = f1z / l1, u2x = f2x / l2, u2y = f2y / l2, u2z = f2z / l2;
      let bx = u1x + u2x, by = u1y + u2y, bz = u1z + u2z, dx = u1x - u2x, dy = u1y - u2y, dz = u1z - u2z;
      const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1e-12, dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
      bx /= bl; by /= bl; bz /= bl; dx /= dl; dy /= dl; dz /= dl;
      const kw = this.kw[t], kf = this.kf[t], kb = this.kb[t];
      // in compression the cloth wrinkles: a compressed direction keeps only a fraction (compress) of its stiffness
      // (tension only: projects onto itself, no force)
      const cr = this.tensionOnly ? this.compress : 1;
      const p1 = l1 < 1 ? l1 + cr * (1 - l1) : 1, p2 = l2 < 1 ? l2 + cr * (1 - l2) : 1;
      // G^T w p: warp term projects f1 to u1, fill f2 to u2; shear projects (f1, f2) to l1 (b + d)/sqrt2, l2 (b - d)/sqrt2
      const P1x = kw * p1 * u1x + kb * l1 * S * (bx + dx), P1y = kw * p1 * u1y + kb * l1 * S * (by + dy), P1z = kw * p1 * u1z + kb * l1 * S * (bz + dz);
      const P2x = kf * p2 * u2x + kb * l2 * S * (bx - dx), P2y = kf * p2 * u2y + kb * l2 * S * (by - dy), P2z = kf * p2 * u2z + kb * l2 * S * (bz - dz);
      rx[i0] += c0 * P1x + e0 * P2x; ry[i0] += c0 * P1y + e0 * P2y; rz[i0] += c0 * P1z + e0 * P2z;
      rx[i1] += c1 * P1x + e1 * P2x; ry[i1] += c1 * P1y + e1 * P2y; rz[i1] += c1 * P1z + e1 * P2z;
      rx[i2] += c2 * P1x + e2 * P2x; ry[i2] += c2 * P1y + e2 * P2y; rz[i2] += c2 * P1z + e2 * P2z;
    }
    if (this.curvDamp > 0) {
      // (c/h) L^T L x_start: the Laplacian of the positions at the start of the substep, spread back
      const k = this.curvDamp / h, nu = this.nu, nv = this.nv, off = this.off, xo = this.xo;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const me = off + j * nu + i; let lx = 0, ly = 0, lz = 0, deg = 0;
        for (let q = 0; q < 4; q++) {
          const a = i + (q === 0 ? -1 : q === 1 ? 1 : 0), b = j + (q === 2 ? -1 : q === 3 ? 1 : 0);
          if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
          const n2 = 3 * (off + b * nu + a); lx += xo[n2]; ly += xo[n2 + 1]; lz += xo[n2 + 2]; deg++;
        }
        lx = k * (lx - deg * xo[3 * me]); ly = k * (ly - deg * xo[3 * me + 1]); lz = k * (lz - deg * xo[3 * me + 2]);
        for (let q = 0; q < 4; q++) {
          const a = i + (q === 0 ? -1 : q === 1 ? 1 : 0), b = j + (q === 2 ? -1 : q === 3 ? 1 : 0);
          if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
          const n2 = off + b * nu + a; rx[n2] += lx; ry[n2] += ly; rz[n2] += lz;
        }
        rx[me] -= deg * lx; ry[me] -= deg * ly; rz[me] -= deg * lz;
      }
    }
    for (const c of this.dist) {
      const i = 3 * c.i, j = 3 * c.j;
      let dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12, k = c.w * (c.tension && l < c.rest ? 1 : c.rest / l);
      dx *= k; dy *= k; dz *= k;
      rx[c.j] += dx; ry[c.j] += dy; rz[c.j] += dz; rx[c.i] -= dx; ry[c.i] -= dy; rz[c.i] -= dz;
    }
    for (const c of this.att) {
      // w |x_i - t x_e - (1 - t) A|^2: linear, no projection
      const A = c.anchor, k = c.w * (1 - c.t);
      rx[c.i] += k * A[0]; ry[c.i] += k * A[1]; rz[c.i] += k * A[2];
      rx[c.e] -= c.t * k * A[0]; ry[c.e] -= c.t * k * A[1]; rz[c.e] -= c.t * k * A[2];
    }
    for (const c of this.lens) {
      const e = 3 * c.e, P = c.at;
      const dx = x[e] - P[0], dy = x[e + 1] - P[1], dz = x[e + 2] - P[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12, k = c.len / l;
      rx[c.e] += c.w * (P[0] + dx * k); ry[c.e] += c.w * (P[1] + dy * k); rz[c.e] += c.w * (P[2] + dz * k);
    }
    for (const r of this.ropes) {
      // point B = t x_e + (1 - t) A; target: B itself while slack, pulled back onto the rope's reach when taut
      const e = 3 * r.e, A = r.anchor, T = r.to, t = r.t;
      const px = A[0] + t * (x[e] - A[0]), py = A[1] + t * (x[e + 1] - A[1]), pz = A[2] + t * (x[e + 2] - A[2]);
      const dx = px - T[0], dy = py - T[1], dz = pz - T[2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-12;
      let qx = px, qy = py, qz = pz;
      if (l > r.len) { const k = r.len / l; qx = T[0] + dx * k; qy = T[1] + dy * k; qz = T[2] + dz * k; if (last) { r.force = r.w * (l - r.len); r.taut = true; } }
      rx[r.e] += r.w * t * (qx - (1 - t) * A[0]); ry[r.e] += r.w * t * (qy - (1 - t) * A[1]); rz[r.e] += r.w * t * (qz - (1 - t) * A[2]);
    }
    // kinematic nodes: their targets, and their pull on their neighbours
    const kt = this.kt, kc = this.kc;
    for (let q = 0; q < kc.length; q += 3) { const j = kc[q], i = kc[q + 1], v = kc[q + 2]; rx[j] -= v * kt[3 * i]; ry[j] -= v * kt[3 * i + 1]; rz[j] -= v * kt[3 * i + 2]; }
    for (let i = 0; i < n; i++) if (this.kin[i]) { rx[i] = kt[3 * i]; ry[i] = kt[3 * i + 1]; rz[i] = kt[3 * i + 2]; }
    bandSolve(this.B, n, this.bw, rx); bandSolve(this.B, n, this.bw, ry); bandSolve(this.B, n, this.bw, rz);
    for (let i = 0; i < n; i++) { x[3 * i] = rx[i]; x[3 * i + 1] = ry[i]; x[3 * i + 2] = rz[i]; }
  }

  // capsules (a, b, radius): push the listed nodes out (after the solve; the velocity follows)
  solveCapsules() {
    const x = this.x;
    for (const c of this.caps) {
      const a = c.a, b = c.b, bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz || 1e-12;
      for (const n of c.nodes) {
        if (this.kin[n]) continue;
        const i = 3 * n;
        let t = ((x[i] - a[0]) * bx + (x[i + 1] - a[1]) * by + (x[i + 2] - a[2]) * bz) / bb;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x[i] - (a[0] + t * bx), dy = x[i + 1] - (a[1] + t * by), dz = x[i + 2] - (a[2] + t * bz);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= c.r || d < 1e-9) continue;
        const k = (c.r - d) / d;
        x[i] += dx * k; x[i + 1] += dy * k; x[i + 2] += dz * k;
      }
    }
  }
  // bilinear sample of the cloth's positions (or velocities: arr = this.v) at chart coordinates (u, v) in [0, 1]
  sample(arr, u, v, out) {
    const nu = this.nu, nv = this.nv, off = this.off;
    const fu = Math.min(Math.max(u, 0), 1) * (nu - 1), fv = Math.min(Math.max(v, 0), 1) * (nv - 1);
    const i = Math.min(nu - 2, Math.floor(fu)), j = Math.min(nv - 2, Math.floor(fv)), a = fu - i, b = fv - j;
    const k00 = 3 * (off + j * nu + i), k10 = k00 + 3, k01 = k00 + 3 * nu, k11 = k01 + 3;
    const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    out[0] = w00 * arr[k00] + w10 * arr[k10] + w01 * arr[k01] + w11 * arr[k11];
    out[1] = w00 * arr[k00 + 1] + w10 * arr[k10 + 1] + w01 * arr[k01 + 1] + w11 * arr[k11 + 1];
    out[2] = w00 * arr[k00 + 2] + w10 * arr[k10 + 2] + w01 * arr[k01 + 2] + w11 * arr[k11 + 2];
    return out;
  }
  // spread force F at chart point (u, v) onto the four surrounding nodes
  splat(u, v, Fx, Fy, Fz) {
    const nu = this.nu, nv = this.nv, f = this.f, off = this.off;
    const fu = Math.min(Math.max(u, 0), 1) * (nu - 1), fv = Math.min(Math.max(v, 0), 1) * (nv - 1);
    const i = Math.min(nu - 2, Math.floor(fu)), j = Math.min(nv - 2, Math.floor(fv)), a = fu - i, b = fv - j;
    const k00 = 3 * (off + j * nu + i), k10 = k00 + 3, k01 = k00 + 3 * nu, k11 = k01 + 3;
    const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    f[k00] += w00 * Fx; f[k00 + 1] += w00 * Fy; f[k00 + 2] += w00 * Fz;
    f[k10] += w10 * Fx; f[k10 + 1] += w10 * Fy; f[k10 + 2] += w10 * Fz;
    f[k01] += w01 * Fx; f[k01 + 1] += w01 * Fy; f[k01 + 2] += w01 * Fz;
    f[k11] += w11 * Fx; f[k11 + 1] += w11 * Fy; f[k11 + 2] += w11 * Fz;
  }
  finite() { for (let i = 0; i < this.x.length; i++) if (!Number.isFinite(this.x[i]) || !Number.isFinite(this.v[i])) return false; return true; }
}
