// Vortex-lattice aerodynamics for a set of sails that share one flow (Katz & Plotkin ch. 12), with a
// viscous correction by decambering (Mukherjee & Gopalarathnam 2006).
//
// Each sail is a lattice of vortex rings on its own (u, v) chart: nc panels chordwise (u = 0 luff .. 1 leech)
// by ns panels spanwise (v = 0 foot .. 1 head). The caller writes the sail's surface nodes (nc+1)*(ns+1) into
// part.surf (u fastest) in any right-angled frame (the boat's rig frame here: x forward, y starboard, z up;
// the formulas are reflection-invariant, so the handedness of the frame does not matter). Ring corners sit a
// quarter panel aft of the surface nodes; collocation points at three quarters. The trailing edge sheds a
// frozen wake: a short leg along the leech tangent, then a semi-infinite leg along the local wind. The water
// surface is a symmetry plane: every vortex has a mirror image with the opposite strength.
//
// One linear system covers all the sails, so the headsail's downwash on the main, the main's upwash on the
// headsail (the slot) and a backed headsail's effect on the main all come out of the mutual induction.
//
// Unique segments: rings share their edges, so each edge is evaluated once and scattered into the two rings
// that own it (+1 / -1). Influence and factorisation are rebuilt now and then (rebuild()); every step only
// back-substitutes (solve()).
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

const INV4PI = 1 / (4 * Math.PI);

export function luFactor(A, n, piv) {
  for (let k = 0; k < n; k++) {
    let p = k, m = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > m) { m = v; p = i; } }
    piv[k] = p;
    if (p !== k) for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
    const d = A[k * n + k];
    if (Math.abs(d) < 1e-300) continue;
    const inv = 1 / d;
    for (let i = k + 1; i < n; i++) {
      const row = i * n, f = (A[row + k] *= inv);
      if (f === 0) continue;
      const kr = k * n;
      for (let j = k + 1; j < n; j++) A[row + j] -= f * A[kr + j];
    }
  }
}
export function luSolve(A, n, piv, b) {
  for (let k = 0; k < n; k++) { const p = piv[k]; if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; } }
  for (let i = 1; i < n; i++) { let s = b[i]; const row = i * n; for (let j = 0; j < i; j++) s -= A[row + j] * b[j]; b[i] = s; }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]; const row = i * n;
    for (let j = i + 1; j < n; j++) s -= A[row + j] * b[j];
    const d = A[row + i]; b[i] = Math.abs(d) < 1e-300 ? 0 : s / d;
  }
  return b;
}

// Depth, draft position and thin-airfoil zero-lift angle of a camber line sampled at x[0..n] (x[0] = 0 at the
// luff, x[n] = 1 at the leech, z / chord along the normal). Zero-lift angle by Munk's integral
// a0 = -(2/pi) int_0^pi z(th) / (1 + cos th) dth with x = (1 - cos th) / 2 (exact -2h for a parabola), on
// a camber line interpolated quadratically between nodes. Depth and draft from a parabola through the deepest node and its neighbours.
export function camberStats(x, z, n, out) {
  const M = 32;
  let a0 = 0, i = 1;
  for (let m = 0; m < M; m++) {
    const th = Math.PI * (m + 0.5) / M, xx = 0.5 * (1 - Math.cos(th));
    while (i < n && x[i] < xx) i++;
    // quadratic through three neighbouring nodes (exact for a parabolic section)
    const a = n < 2 ? 0 : Math.min(Math.max(i - 2 + (xx - x[i - 1] < x[i] - xx ? 0 : 1), 0), n - 2);
    let zz;
    const xa0 = x[a], xb0 = x[a + 1], xc0 = x[a + 2];
    if (n < 2 || xb0 - xa0 < 1e-3 || xc0 - xb0 < 1e-3) {
      // (a folded or bunched section: plain linear interpolation)
      const i0 = Math.max(1, Math.min(n, i)), x0 = x[i0 - 1], x1 = x[i0];
      zz = z[i0 - 1] + (x1 > x0 ? (xx - x0) / (x1 - x0) : 0) * (z[i0] - z[i0 - 1]);
    } else {
      const xa = x[a], xb = x[a + 1], xc = x[a + 2];
      zz = z[a] * (xx - xb) * (xx - xc) / ((xa - xb) * (xa - xc)) + z[a + 1] * (xx - xa) * (xx - xc) / ((xb - xa) * (xb - xc))
         + z[a + 2] * (xx - xa) * (xx - xb) / ((xc - xa) * (xc - xb));
    }
    a0 += zz / (1 + Math.cos(th));
  }
  out.a0 = Number.isFinite(a0) ? Math.max(-0.6, Math.min(0.6, -2 / M * a0)) : 0;
  let k = 1;
  for (let m = 2; m < n; m++) if (Math.abs(z[m]) > Math.abs(z[k])) k = m;
  let d = z[k], f = x[k];
  if (n >= 2 && k > 0 && k < n) {
    // vertex of the parabola through (x[k-1], z[k-1]), (x[k], z[k]), (x[k+1], z[k+1])
    const xa = x[k - 1], xb = x[k], xc = x[k + 1], za = z[k - 1], zb = z[k], zc = z[k + 1];
    const den = (xa - xb) * (xa - xc) * (xb - xc);
    if (Math.abs(den) > 1e-12) {
      const A = (xc * (zb - za) + xb * (za - zc) + xa * (zc - zb)) / den;
      const B = (xc * xc * (za - zb) + xb * xb * (zc - za) + xa * xa * (zb - zc)) / den;
      if (A * zb < 0) { const xv = -B / (2 * A); if (xv > xa && xv < xc) { f = xv; d = zb + A * (xv - xb) * (xv - xb) + (2 * A * xb + B) * (xv - xb); } }
    }
  }
  out.d = Number.isFinite(d) ? d : 0; out.f = Number.isFinite(f) ? f : 0.5;
  return out;
}

export class SailLattice {
  // parts: [{ nc, ns }]. opts.core: vortex core radius (m)
  constructor(parts, opts = {}) {
    this.core2 = (opts.core ?? 0.002) ** 2;                    // vortex core radius (m): regularises points on a line
    this.wakeLeg = opts.wakeLeg ?? 0.25;
    this.slopeAt34 = opts.slopeAt34 ?? true;              // boundary condition with the slope at the collocation point                       // first wake leg along the leech tangent, in chords
    this.parts = [];
    let N = 0, NS = 0;
    for (const p of parts) {
      const q = { nc: p.nc, ns: p.ns, off: N, soff: NS, on: true,
        surf: new Float64Array(3 * (p.nc + 1) * (p.ns + 1)),
        wake: new Float64Array(3 * (p.ns + 1)) };          // unit wake direction at each trailing-edge node
      for (let j = 0; j <= p.ns; j++) q.wake[3 * j] = -1;
      this.parts.push(q);
      N += p.nc * p.ns; NS += p.ns;
    }
    this.N = N; this.NS = NS;
    // per panel: collocation point, normal, bound-segment midpoint and vector (all from the live surface)
    this.col = new Float64Array(3 * N); this.nrm = new Float64Array(3 * N);
    this.bm = new Float64Array(3 * N); this.bl = new Float64Array(3 * N);
    this.area = new Float64Array(N); this.strip = new Int32Array(N); this.prevP = new Int32Array(N);
    // The viscous correction acts on each strip as a trailing-edge flap: a uniform normal velocity over the aft
    // half of the chord (the boundary layer decambers a section from the trailing edge; a correction spread over
    // the whole chord would also unload the luff and back it). flapK: the flap's zero-lift angle shift per unit
    // deflection, (pi - th + sin th) / pi with cos th = 1 - 2 x_hinge (thin-airfoil theory).
    this.flap = new Uint8Array(N); this.flapK = new Float64Array(NS);
    for (const q of this.parts) for (let j = 0; j < q.ns; j++) {
      const ih = Math.round(q.nc / 2), xh = ih / q.nc, th = Math.acos(1 - 2 * xh);
      this.flapK[q.soff + j] = (Math.PI - th + Math.sin(th)) / Math.PI;
      for (let i = 0; i < q.nc; i++) {
        const k = q.off + j * q.nc + i; this.strip[k] = q.soff + j; this.prevP[k] = i === 0 ? -1 : k - 1; this.flap[k] = i >= ih ? 1 : 0;
      }
    }
    // per strip: chord, chord direction, normal, span direction, reference point (mid-chord), area, zero-lift angle
    this.sc = new Float64Array(NS); this.st = new Float64Array(3 * NS); this.sn = new Float64Array(3 * NS);
    this.ss = new Float64Array(3 * NS); this.sp = new Float64Array(3 * NS); this.sa = new Float64Array(NS);
    this.sa0 = new Float64Array(NS); this.sd = new Float64Array(NS); this.sf = new Float64Array(NS);
    this.te = new Int32Array(NS);
    for (const q of this.parts) for (let j = 0; j < q.ns; j++) this.te[q.soff + j] = q.off + j * q.nc + q.nc - 1;
    // system
    this.A = new Float64Array(N * N); this.piv = new Int32Array(N);
    this.M3 = new Float64Array(3 * N * N);                    // induced velocity at bound midpoints per unit ring
    this.R = new Float64Array(N * NS);                         // response of every ring to a unit strip correction
    this.RT = new Float64Array(NS * NS);                       // ... at each strip's trailing-edge ring
    this.rhs = new Float64Array(N); this.g0 = new Float64Array(N); this.g = new Float64Array(N);
    this.vind = new Float64Array(3 * N);
    this.delta = new Float64Array(NS);                         // decambering correction (flap normal velocity, m/s)
    // segments (max count: bound nc*ns + trailing nc*(ns+1) + wake 2*(ns+1), doubled for the image)
    let S = 0; for (const q of this.parts) S += q.nc * q.ns + q.nc * (q.ns + 1) + 2 * (q.ns + 1);
    S *= 2;
    this.sA = new Float64Array(3 * S); this.sB = new Float64Array(3 * S); this.sK = new Uint8Array(S);
    this.sP1 = new Int32Array(S); this.sP2 = new Int32Array(S); this.sC = new Float64Array(S);
    this.sPart = new Int32Array(S);                          // sail the segment belongs to
    this.nSeg = 0;
    this.image = { on: false, nx: 0, ny: 0, nz: 1, h0: 0 };    // water plane: height h(p) = n.p + h0
    this.built = false;
    this._v = new Float64Array(3);
  }

  // live geometry per panel and per strip (cheap; call every step after moving the surface)
  updateGeometry() {
    const col = this.col, nrm = this.nrm, bm = this.bm, bl = this.bl;
    for (const q of this.parts) {
      const { nc, ns, surf: S } = q, W = nc + 1;
      for (let j = 0; j < ns; j++) {
        const si = q.soff + j;
        for (let i = 0; i < nc; i++) {
          const k = q.off + j * nc + i;
          const a = 3 * (j * W + i), b = a + 3, c = 3 * ((j + 1) * W + i), d = c + 3; // a=(i,j) b=(i+1,j) c=(i,j+1) d=(i+1,j+1)
          // bound segment: quarter chord of the panel, from (i,j) side to (i,j+1) side
          const ax = S[a] + 0.25 * (S[b] - S[a]), ay = S[a + 1] + 0.25 * (S[b + 1] - S[a + 1]), az = S[a + 2] + 0.25 * (S[b + 2] - S[a + 2]);
          const cx = S[c] + 0.25 * (S[d] - S[c]), cy = S[c + 1] + 0.25 * (S[d + 1] - S[c + 1]), cz = S[c + 2] + 0.25 * (S[d + 2] - S[c + 2]);
          bm[3 * k] = 0.5 * (ax + cx); bm[3 * k + 1] = 0.5 * (ay + cy); bm[3 * k + 2] = 0.5 * (az + cz);
          bl[3 * k] = cx - ax; bl[3 * k + 1] = cy - ay; bl[3 * k + 2] = cz - az;
          // collocation: three-quarter chord, mid-span
          col[3 * k] = 0.5 * (S[a] + 0.75 * (S[b] - S[a]) + S[c] + 0.75 * (S[d] - S[c]));
          col[3 * k + 1] = 0.5 * (S[a + 1] + 0.75 * (S[b + 1] - S[a + 1]) + S[c + 1] + 0.75 * (S[d + 1] - S[c + 1]));
          col[3 * k + 2] = 0.5 * (S[a + 2] + 0.75 * (S[b + 2] - S[a + 2]) + S[c + 2] + 0.75 * (S[d + 2] - S[c + 2]));
          // normal: diagonal cross product (d - a) x (c - b)  (= 2 t x s for a flat panel)
          const p1 = S[d] - S[a], p2 = S[d + 1] - S[a + 1], p3 = S[d + 2] - S[a + 2];
          const q1 = S[c] - S[b], q2 = S[c + 1] - S[b + 1], q3 = S[c + 2] - S[b + 2];
          let nx = p2 * q3 - p3 * q2, ny = p3 * q1 - p1 * q3, nz = p1 * q2 - p2 * q1;
          const nl = hyp3(nx, ny, nz) || 1;
          this.area[k] = 0.5 * nl;
          nrm[3 * k] = nx / nl; nrm[3 * k + 1] = ny / nl; nrm[3 * k + 2] = nz / nl;
        }
        // the panel normal is the mean slope over the panel; the boundary condition wants the slope at the
        // collocation point, a quarter panel aft of the middle: interpolate toward the next panel (extrapolate on
        // the last). Second-order in the panel size, so a cambered section converges with few panels.
        const pn = this._pn || (this._pn = new Float64Array(3 * 64));
        for (let i = 0; i < nc; i++) { const k = 3 * (q.off + j * nc + i); pn[3 * i] = nrm[k]; pn[3 * i + 1] = nrm[k + 1]; pn[3 * i + 2] = nrm[k + 2]; }
        if (nc > 1 && this.slopeAt34) for (let i = 0; i < nc; i++) {
          const k = 3 * (q.off + j * nc + i), o = i < nc - 1 ? 3 * (i + 1) : 3 * (i - 1), w = i < nc - 1 ? 0.25 : -0.25;
          let nx = pn[3 * i] + w * (pn[o] - pn[3 * i]), ny = pn[3 * i + 1] + w * (pn[o + 1] - pn[3 * i + 1]), nz = pn[3 * i + 2] + w * (pn[o + 2] - pn[3 * i + 2]);
          const nl = hyp3(nx, ny, nz) || 1;
          nrm[k] = nx / nl; nrm[k + 1] = ny / nl; nrm[k + 2] = nz / nl;
        }
        // strip: section through mid-span
        const l0 = 3 * (j * W), l1 = 3 * ((j + 1) * W), t0 = l0 + 3 * nc, t1 = l1 + 3 * nc;
        const Lx = 0.5 * (S[l0] + S[l1]), Ly = 0.5 * (S[l0 + 1] + S[l1 + 1]), Lz = 0.5 * (S[l0 + 2] + S[l1 + 2]);
        let tx = 0.5 * (S[t0] + S[t1]) - Lx, ty = 0.5 * (S[t0 + 1] + S[t1 + 1]) - Ly, tz = 0.5 * (S[t0 + 2] + S[t1 + 2]) - Lz;
        const c = hyp3(tx, ty, tz) || 1e-6; tx /= c; ty /= c; tz /= c;
        let sx = S[l1] - S[l0], sy = S[l1 + 1] - S[l0 + 1], sz = S[l1 + 2] - S[l0 + 2];
        const sl = hyp3(sx, sy, sz) || 1e-6; sx /= sl; sy /= sl; sz /= sl;
        let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
        const nl = hyp3(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        // span direction orthogonal to chord and normal
        sx = ny * tz - nz * ty; sy = nz * tx - nx * tz; sz = nx * ty - ny * tx;
        this.sc[si] = c;
        this.st[3 * si] = tx; this.st[3 * si + 1] = ty; this.st[3 * si + 2] = tz;
        this.sn[3 * si] = nx; this.sn[3 * si + 1] = ny; this.sn[3 * si + 2] = nz;
        this.ss[3 * si] = sx; this.ss[3 * si + 1] = sy; this.ss[3 * si + 2] = sz;
        this.sp[3 * si] = Lx + 0.5 * c * tx; this.sp[3 * si + 1] = Ly + 0.5 * c * ty; this.sp[3 * si + 2] = Lz + 0.5 * c * tz;
        // camber line (x along the chord, z along the normal, both / chord)
        const xs = this._xs || (this._xs = new Float64Array(64)), zs = this._zs || (this._zs = new Float64Array(64));
        xs[0] = 0; zs[0] = 0;
        for (let i = 1; i <= nc; i++) {
          const m = 3 * (j * W + i), n2 = 3 * ((j + 1) * W + i);
          const px = 0.5 * (S[m] + S[n2]) - Lx, py = 0.5 * (S[m + 1] + S[n2 + 1]) - Ly, pz = 0.5 * (S[m + 2] + S[n2 + 2]) - Lz;
          xs[i] = Math.min(1, Math.max(xs[i - 1] + 1e-6, (px * tx + py * ty + pz * tz) / c)); zs[i] = (px * nx + py * ny + pz * nz) / c;
        }
        const cm = camberStats(xs, zs, nc, this._cs || (this._cs = {}));
        const a0 = cm.a0, zmax = cm.d, fmax = cm.f;
        this.sa0[si] = a0; this.sd[si] = zmax; this.sf[si] = fmax;
        let A = 0; for (let i = 0; i < nc; i++) A += this.area[q.off + j * nc + i];
        this.sa[si] = A;
      }
    }
  }

  // ------------------------------------------------------------------ influence
  _addSeg(ax, ay, az, bx, by, bz, kind, p1, p2, c) {
    const s = this.nSeg++, A = this.sA, B = this.sB;
    A[3 * s] = ax; A[3 * s + 1] = ay; A[3 * s + 2] = az;
    B[3 * s] = bx; B[3 * s + 1] = by; B[3 * s + 2] = bz;
    this.sK[s] = kind; this.sP1[s] = p1; this.sP2[s] = p2; this.sC[s] = c; this.sPart[s] = this._curPart;
  }
  // ring corners: surface node + a quarter of the way to the next node aft (the last row a quarter panel past the TE)
  _ring(q, i, j, o) {
    const S = q.surf, W = q.nc + 1, a = 3 * (j * W + i);
    const b = i < q.nc ? a + 3 : a - 3, f = i < q.nc ? 0.25 : -0.25;
    o[0] = S[a] + f * (S[b] - S[a]); o[1] = S[a + 1] + f * (S[b + 1] - S[a + 1]); o[2] = S[a + 2] + f * (S[b + 2] - S[a + 2]);
    return o;
  }
  _buildSegments() {
    this.nSeg = 0;
    const P = [0, 0, 0], Q = [0, 0, 0];
    for (let pi = 0; pi < this.parts.length; pi++) {
      const q = this.parts[pi];
      if (!q.on) continue;
      this._curPart = pi;
      const { nc, ns } = q, id = (i, j) => q.off + j * nc + i;
      // bound (spanwise) segments at the front of every ring: strength G(i,j) - G(i-1,j)
      for (let j = 0; j < ns; j++) for (let i = 0; i < nc; i++) {
        this._ring(q, i, j, P); this._ring(q, i, j + 1, Q);
        this._addSeg(P[0], P[1], P[2], Q[0], Q[1], Q[2], 0, id(i, j), i > 0 ? id(i - 1, j) : -1, 1);
      }
      // trailing (chordwise) segments on column line j, running aft: G(i,j-1) - G(i,j)
      for (let j = 0; j <= ns; j++) for (let i = 0; i < nc; i++) {
        this._ring(q, i, j, P); this._ring(q, i + 1, j, Q);
        this._addSeg(P[0], P[1], P[2], Q[0], Q[1], Q[2], 0, j > 0 ? id(i, j - 1) : -1, j < ns ? id(i, j) : -1, j > 0 ? 1 : -1);
        if (j > 0 && j < ns) this.sC[this.nSeg - 1] = 1;        // p1 gets +1, p2 gets -1 (handled in scatter)
      }
      // wake on column line j: short leg along the leech tangent, then semi-infinite along the wind
      const S = q.surf, W = nc + 1;
      for (let j = 0; j <= ns; j++) {
        this._ring(q, nc, j, P);
        const a = 3 * (j * W + nc), b = a - 3;
        let tx = S[a] - S[b], ty = S[a + 1] - S[b + 1], tz = S[a + 2] - S[b + 2];
        const tl = hyp3(tx, ty, tz) || 1;
        const cj = this.sc[q.soff + Math.min(j, ns - 1)] || 1;
        const L = this.wakeLeg * cj / tl;
        const w1x = P[0] + tx * L, w1y = P[1] + ty * L, w1z = P[2] + tz * L;
        const e = q.wake;
        const p1 = j > 0 ? id(nc - 1, j - 1) : -1, p2 = j < ns ? id(nc - 1, j) : -1;
        this._addSeg(P[0], P[1], P[2], w1x, w1y, w1z, 0, p1, p2, p1 >= 0 ? 1 : -1);
        this._addSeg(w1x, w1y, w1z, e[3 * j], e[3 * j + 1], e[3 * j + 2], 1, p1, p2, p1 >= 0 ? 1 : -1);
      }
    }
    // mirror images in the water plane, opposite strength (a sail may have a plane of its own: part.im, the
    // surface its foot is sealed on)
    if (this.image.on) {
      const n0 = this.nSeg, A = this.sA, B = this.sB;
      for (let s = 0; s < n0; s++) {
        const pq = this.parts[this.sPart[s]], im = pq.im && pq.im.on ? pq.im : this.image;
        this._curPart = this.sPart[s];
        const ax = A[3 * s], ay = A[3 * s + 1], az = A[3 * s + 2];
        const ha = 2 * (im.nx * ax + im.ny * ay + im.nz * az + im.h0);
        const bx = B[3 * s], by = B[3 * s + 1], bz = B[3 * s + 2];
        let mx, my, mz;
        if (this.sK[s] === 0) {
          const hb = 2 * (im.nx * bx + im.ny * by + im.nz * bz + im.h0);
          mx = bx - hb * im.nx; my = by - hb * im.ny; mz = bz - hb * im.nz;
        } else { // a direction reflects without the offset
          const hd = 2 * (im.nx * bx + im.ny * by + im.nz * bz);
          mx = bx - hd * im.nx; my = by - hd * im.ny; mz = bz - hd * im.nz;
        }
        this._addSeg(ax - ha * im.nx, ay - ha * im.ny, az - ha * im.nz, mx, my, mz, this.sK[s], this.sP1[s], this.sP2[s], -this.sC[s]);
      }
    }
  }
  // velocity at (px,py,pz) induced by segment s with unit strength -> this._v
  _segVel(s, px, py, pz) {
    const A = this.sA, B = this.sB, v = this._v;
    const ax = A[3 * s], ay = A[3 * s + 1], az = A[3 * s + 2];
    const r1x = px - ax, r1y = py - ay, r1z = pz - az;
    if (this.sK[s] === 0) {
      const r2x = px - B[3 * s], r2y = py - B[3 * s + 1], r2z = pz - B[3 * s + 2];
      const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
      const r0x = r1x - r2x, r0y = r1y - r2y, r0z = r1z - r2z;
      const r0l2 = r0x * r0x + r0y * r0y + r0z * r0z;
      const c2 = cx * cx + cy * cy + cz * cz + this.core2 * r0l2;
      const n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z), n2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
      if (n1 < 1e-9 || n2 < 1e-9 || c2 < 1e-18) { v[0] = v[1] = v[2] = 0; return v; }
      const k = INV4PI * ((r0x * r1x + r0y * r1y + r0z * r1z) / n1 - (r0x * r2x + r0y * r2y + r0z * r2z) / n2) / c2;
      v[0] = k * cx; v[1] = k * cy; v[2] = k * cz;
    } else {
      const ex = B[3 * s], ey = B[3 * s + 1], ez = B[3 * s + 2];
      const cx = ey * r1z - ez * r1y, cy = ez * r1x - ex * r1z, cz = ex * r1y - ey * r1x;
      const c2 = cx * cx + cy * cy + cz * cz + this.core2;
      const n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
      if (n1 < 1e-9) { v[0] = v[1] = v[2] = 0; return v; }
      const k = INV4PI * (1 + (ex * r1x + ey * r1y + ez * r1z) / n1) / c2;
      v[0] = k * cx; v[1] = k * cy; v[2] = k * cz;
    }
    return v;
  }

  // velocity induced at (px, py, pz) by every segment with unit strength -> V[3 s ..]
  _pointField(px, py, pz, V) {
    const A = this.sA, B = this.sB, K = this.sK, nS = this.nSeg, core2 = this.core2, k4 = INV4PI;
    for (let s = 0; s < nS; s++) {
      const i3 = 3 * s;
      const r1x = px - A[i3], r1y = py - A[i3 + 1], r1z = pz - A[i3 + 2];
      const n1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
      if (K[s] === 0) {
        const r2x = px - B[i3], r2y = py - B[i3 + 1], r2z = pz - B[i3 + 2];
        const cx = r1y * r2z - r1z * r2y, cy = r1z * r2x - r1x * r2z, cz = r1x * r2y - r1y * r2x;
        const r0x = r1x - r2x, r0y = r1y - r2y, r0z = r1z - r2z;
        const n2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
        const c2 = cx * cx + cy * cy + cz * cz + core2 * (r0x * r0x + r0y * r0y + r0z * r0z);
        if (n1 < 1e-9 || n2 < 1e-9 || c2 < 1e-18) { V[i3] = V[i3 + 1] = V[i3 + 2] = 0; continue; }
        const k = k4 * ((r0x * r1x + r0y * r1y + r0z * r1z) / n1 - (r0x * r2x + r0y * r2y + r0z * r2z) / n2) / c2;
        V[i3] = k * cx; V[i3 + 1] = k * cy; V[i3 + 2] = k * cz;
      } else {
        const ex = B[i3], ey = B[i3 + 1], ez = B[i3 + 2];
        const cx = ey * r1z - ez * r1y, cy = ez * r1x - ex * r1z, cz = ex * r1y - ey * r1x;
        const c2 = cx * cx + cy * cy + cz * cz + core2;
        if (n1 < 1e-9) { V[i3] = V[i3 + 1] = V[i3 + 2] = 0; continue; }
        const k = k4 * (1 + (ex * r1x + ey * r1y + ez * r1z) / n1) / c2;
        V[i3] = k * cx; V[i3 + 1] = k * cy; V[i3 + 2] = k * cz;
      }
    }
  }

  // influence matrices, factorisation and the strip-correction responses, from the current geometry
  rebuild(withM3 = true) { this.beginRebuild(withM3); this.workRebuild(Infinity); }

  // The same work spread over several steps: beginRebuild() freezes the geometry and the wake, then each
  // workRebuild(budget) does about `budget` rows' worth of it into back buffers (the solver keeps using the
  // current factorisation meanwhile) and swaps them in when complete (returns true). A row = one point's
  // influence from every segment; the factorisation counts N/4 rows, each strip response N/40.
  beginRebuild(withM3 = true) {
    this.updateGeometry();
    this._buildSegments();
    const N = this.N, NS = this.NS;
    if (!this.Ab) {
      this.Ab = new Float64Array(N * N); this.pivb = new Int32Array(N); this.M3b = new Float64Array(3 * N * N);
      this.Rb = new Float64Array(N * NS); this.RTb = new Float64Array(NS * NS);
      this.colS = new Float64Array(3 * N); this.nrmS = new Float64Array(3 * N); this.bmS = new Float64Array(3 * N);
      this.onS = new Uint8Array(N); this.rb = new Float64Array(N);
    }
    this.colS.set(this.col); this.nrmS.set(this.nrm); this.bmS.set(this.bm);
    for (let k = 0; k < N; k++) this.onS[k] = this._partOn(k) ? 1 : 0;
    this.Ab.fill(0);
    for (let k = 0; k < N; k++) if (!this.onS[k]) this.Ab[k * N + k] = 1;
    if (withM3) this.M3b.fill(0);
    this.job = { k: 0, m: withM3 ? 0 : N, withM3, lu: false, r: 0 };
  }
  get rebuilding() { return !!this.job; }
  workRebuild(budget) {
    const J = this.job; if (!J) return true;
    const N = this.N, NS = this.NS, nS = this.nSeg, A = this.Ab, M3 = this.M3b;
    const P1 = this.sP1, P2 = this.sP2, SC = this.sC, col = this.colS, nrm = this.nrmS, bm = this.bmS;
    const V = this._segV && this._segV.length >= 3 * nS ? this._segV : (this._segV = new Float64Array(3 * this.sK.length));
    let spent = 0;
    while (J.k < N && spent < budget) {
      const k = J.k++; if (!this.onS[k]) continue;
      spent++;
      this._pointField(col[3 * k], col[3 * k + 1], col[3 * k + 2], V);
      const nx = nrm[3 * k], ny = nrm[3 * k + 1], nz = nrm[3 * k + 2], row = k * N;
      for (let s = 0; s < nS; s++) {
        // a segment shared by two rings carries G(p1) - G(p2); an edge segment belongs to one ring with sign c
        const vn = SC[s] * (V[3 * s] * nx + V[3 * s + 1] * ny + V[3 * s + 2] * nz), p1 = P1[s], p2 = P2[s];
        if (p1 >= 0) { A[row + p1] += vn; if (p2 >= 0) A[row + p2] -= vn; }
        else if (p2 >= 0) A[row + p2] += vn;
      }
    }
    while (J.m < N && spent < budget) {
      const k = J.m++; if (!this.onS[k]) continue;
      spent++;
      this._pointField(bm[3 * k], bm[3 * k + 1], bm[3 * k + 2], V);
      const r0 = 3 * k * N, r1 = r0 + N, r2 = r1 + N;
      for (let s = 0; s < nS; s++) {
        const c = SC[s], p1 = P1[s], p2 = P2[s], vx = c * V[3 * s], vy = c * V[3 * s + 1], vz = c * V[3 * s + 2];
        if (p1 >= 0) {
          M3[r0 + p1] += vx; M3[r1 + p1] += vy; M3[r2 + p1] += vz;
          if (p2 >= 0) { M3[r0 + p2] -= vx; M3[r1 + p2] -= vy; M3[r2 + p2] -= vz; }
        } else if (p2 >= 0) { M3[r0 + p2] += vx; M3[r1 + p2] += vy; M3[r2 + p2] += vz; }
      }
    }
    if (J.k < N || J.m < N) return false;
    if (!J.lu) { if (spent > 0 && spent + N / 4 > budget) return false; luFactor(A, N, this.pivb); J.lu = true; spent += N / 4; }
    // response of the whole lattice to a unit normal-velocity correction on each strip
    const R = this.Rb, b = this.rb;
    while (J.r < NS) {
      if (spent > 0 && spent + N / 40 > budget) return false;
      const m = J.r++;
      b.fill(0);
      for (let k = 0; k < N; k++) if (this.strip[k] === m && this.flap[k]) b[k] = 1;
      luSolve(A, N, this.pivb, b);
      for (let k = 0; k < N; k++) R[k * NS + m] = b[k];
      spent += N / 40;
    }
    for (let j = 0; j < NS; j++) for (let m = 0; m < NS; m++) this.RTb[j * NS + m] = R[this.te[j] * NS + m];
    // swap in
    let t;
    t = this.A; this.A = this.Ab; this.Ab = t;
    t = this.piv; this.piv = this.pivb; this.pivb = t;
    t = this.R; this.R = this.Rb; this.Rb = t;
    t = this.RT; this.RT = this.RTb; this.RTb = t;
    if (J.withM3) { t = this.M3; this.M3 = this.M3b; this.M3b = t; }
    this.job = null; this.built = true;
    return true;
  }
  // rows of work in a full rebuild (for spreading it over steps)
  rebuildCost(withM3 = true) { let n = 0; for (const q of this.parts) if (q.on) n += q.nc * q.ns; return n * (withM3 ? 2 : 1) + this.N / 4 + this.NS * this.N / 40; }
  _partOn(k) { for (const q of this.parts) if (k >= q.off && k < q.off + q.nc * q.ns) return q.on; return false; }

  // G0 = A^-1 rhs (rhs = -V.n per panel, set by the caller in this.rhs)
  solveBase() {
    const g0 = this.g0; g0.set(this.rhs);
    luSolve(this.A, this.N, this.piv, g0);
    return g0;
  }
  // G = G0 + R delta
  compose() {
    const N = this.N, NS = this.NS, R = this.R, d = this.delta, g = this.g, g0 = this.g0;
    for (let k = 0; k < N; k++) { let s = g0[k]; const r = k * NS; for (let m = 0; m < NS; m++) s += R[r + m] * d[m]; g[k] = s; }
    return g;
  }
  // circulation at each strip's trailing-edge ring for the current delta
  teGamma(j) {
    const NS = this.NS; let s = this.g0[this.te[j]]; const r = j * NS;
    for (let m = 0; m < NS; m++) s += this.RT[r + m] * this.delta[m];
    return s;
  }
  // induced velocity at every bound midpoint for circulation g
  induced(g) {
    const N = this.N, M3 = this.M3, out = this.vind;
    for (let k = 0; k < N; k++) {
      const r0 = 3 * k * N, r1 = r0 + N, r2 = r1 + N;
      let x = 0, y = 0, z = 0;
      for (let m = 0; m < N; m++) { const gm = g[m]; if (gm === 0) continue; x += M3[r0 + m] * gm; y += M3[r1 + m] * gm; z += M3[r2 + m] * gm; }
      out[3 * k] = x; out[3 * k + 1] = y; out[3 * k + 2] = z;
    }
    return out;
  }
  // velocity induced by the whole lattice (circulation g) at an arbitrary point (telltales, tests)
  velocityAt(g, px, py, pz, out) {
    let x = 0, y = 0, z = 0;
    for (let s = 0; s < this.nSeg; s++) {
      const v = this._segVel(s, px, py, pz), c = this.sC[s], p1 = this.sP1[s], p2 = this.sP2[s];
      let G = 0;
      if (p1 >= 0 && p2 >= 0) G = c * (g[p1] - g[p2]); else if (p1 >= 0) G = c * g[p1]; else if (p2 >= 0) G = c * g[p2];
      x += G * v[0]; y += G * v[1]; z += G * v[2];
    }
    out[0] = x; out[1] = y; out[2] = z; return out;
  }
}
