// Waves the boats make: the Kelvin wake (transverse waves 2 pi U^2/g long, divergent waves out to the 19.47
// degree cusp), bow and stern waves, the hollow behind a transom and the rings a pitching bow radiates.
// Each hull is a pressure distribution on the free surface (a slender-body stand-in for the displaced
// water: head q = immersed depth, so a boat at rest leaves the sea flat) built every frame from the real
// hull sections at the boat's heel, pitch and heave, and the sea answers it as linear deep water:
//   dh/dt = |k| phi,  dphi/dt = -g (h + q)          (per Fourier mode: omega^2 = g |k|, exact)
// the pressure as a kick phi -= g q dt, then the free sea propagated exactly over the step in Fourier space
// (Tessendorf's eWave: the iWave problem solved with its exponential, no kernel truncation, no step-size
// limit on the dispersion): H' = e (H cos wt + |k|/w Phi sin wt),  Phi' = e (Phi cos wt - g/w H sin wt).
// h and phi are both real, so they travel as one complex field h + i phi (one transform each way).
// The grid (N^2 over L metres) follows the player, scrolled in whole cells, with a sponge at its rim
// (the FFT's box is periodic); e = exp(-(g0 + nu k^2 + hyper) dt) keeps the grid scale clean. The renderer
// adds h + q (the departure from the hull's static waterline) to the ocean near the boats, its slope to
// the normals, and the steep crests and the transom's wash to the persistent foam map.
// ?q=low draws a precomputed steady Kelvin pattern instead (kelvinPattern), scaled by U^2/g along the track.
// No three.js import: the CPU reference below runs in node (test/hullwaves.mjs); the GPU class gets THREE.
const G = 9.81;
export const HW = { N: 256, L: 128, NS: 16, MAXH: 6, nu: 0.006, g0: 0.012, hyper: 3.0, sponge: 3.5, maxDt: 1 / 20 };

// ---------------------------------------------------------------------------------------------------
// footprint: per hull NS stations stern -> stem of (lateral centre of the waterplane, half-width, head D)
// with a parabolic profile across (q = D (1 - s^2), so the section integrates to its immersed area A:
// D = 3A / 4 hw). Heel shifts and widens the waterplane, pitch and heave (and the sea along the hull)
// change A: a bow burying itself into a wave raises its pressure at once, and radiates.
let CUT = new Float64Array(256);
function sectionCut(p, sp, cp, zw, sl, r) {
  const n = p.length / 2;
  if (CUT.length < 4 * n + 8) CUT = new Float64Array(4 * n + 8);
  let m2 = 0, ymin = 1e9, ymax = -1e9;
  const f = (y, z) => -y * sp + z * cp - zw - sl * (y * cp + z * sp);
  let px = p[2 * n - 2], pz = p[2 * n - 1], pf = f(px, pz);
  for (let i = 0; i < n; i++) {
    const cx = p[2 * i], cz = p[2 * i + 1], cf = f(cx, cz);
    if ((pf < 0) !== (cf < 0)) {
      const t = pf / (pf - cf), yx = px + (cx - px) * t, zx = pz + (cz - pz) * t, yl = yx * cp + zx * sp;
      CUT[m2++] = yx; CUT[m2++] = zx; if (yl < ymin) ymin = yl; if (yl > ymax) ymax = yl;
    }
    if (cf < 0) { CUT[m2++] = cx; CUT[m2++] = cz; }
    px = cx; pz = cz; pf = cf;
  }
  let A = 0;
  for (let i = 0, m = m2 / 2; i < m; i++) { const j = (i + 1) % m; A += CUT[2 * i] * CUT[2 * j + 1] - CUT[2 * j] * CUT[2 * i + 1]; }
  r.A = Math.abs(A) / 2; r.y0 = ymin; r.y1 = ymax;
  return r;
}
// one boat's hulls -> list entries { x, z, fx, fz, x0, dxs, taper, wmax, st: Float32Array(NS * 4) }
// pose: { x, z, psi, heave, pitch, phi } (the drawn pose); the sea along the hull from the last physics step
export function hullEntries(b, pose, list, max = HW.MAXH) {
  const C = b.cls, hy = b.hydro, NS = HW.NS, P = pose || b;
  const etaAt = b._etaAt || (() => 0), slLat = b._slLat || (() => 0);
  const cp = Math.cos(P.phi || 0), sp = Math.sin(P.phi || 0), heave = P.heave || 0, pitch = P.pitch || 0;
  const S = hy.stations, n = S.length, nh = S[0].polys.length;
  const cut = b._hwCut || (b._hwCut = { A: 0, y0: 0, y1: 0, tab: new Float64Array(n * nh * 3) }), tab = cut.tab;
  for (let i = 0; i < n; i++) {
    const st = S[i], zw = etaAt(st.x) - heave - st.x * pitch, sl = slLat(st.x);
    for (let q = 0; q < nh; q++) {
      sectionCut(st.polys[q], sp, cp, zw, sl, cut);
      const k = (i * nh + q) * 3;
      if (cut.A > 1e-5 && cut.y1 > cut.y0) { tab[k] = cut.A; tab[k + 1] = 0.5 * (cut.y0 + cut.y1); tab[k + 2] = Math.max(0.03, 0.5 * (cut.y1 - cut.y0)); }
      else { tab[k] = 0; tab[k + 1] = 0; tab[k + 2] = 0.03; }
    }
  }
  const fx = Math.sin(P.psi), fz = -Math.cos(P.psi), L0 = C.sternX, L1 = C.bowX, dxs = (L1 - L0) / (NS - 1);
  for (let q = 0; q < nh && list.length < max; q++) {
    const e = { x: P.x, z: P.z, fx, fz, x0: L0, dxs, taper: 0.3 / dxs, wmax: 0, st: new Float32Array(NS * 4), b };
    let any = false;
    for (let j = 0; j < NS; j++) {
      // hydro stations sit at (i + 0.5) / n: linear between them, the end ones held out to the transom
      const fi = Math.min(n - 1, Math.max(0, j / (NS - 1) * n - 0.5)), i0 = Math.min(n - 2, Math.floor(fi)), w = fi - i0;
      const ka = (i0 * nh + q) * 3, kb = ((i0 + 1) * nh + q) * 3;
      const A = tab[ka] * (1 - w) + tab[kb] * w, yc = tab[ka + 1] * (1 - w) + tab[kb + 1] * w, hw = tab[ka + 2] * (1 - w) + tab[kb + 2] * w;
      const D = j === NS - 1 ? 0 : 0.75 * A / hw;                      // the stem: nothing forward of it
      e.st[j * 4] = yc; e.st[j * 4 + 1] = hw; e.st[j * 4 + 2] = D;
      if (D > 0) { any = true; e.wmax = Math.max(e.wmax, Math.abs(yc) + hw); }
    }
    if (any) list.push(e);
  }
  return list;
}
// the head q (m) the hulls press on the water at world (x, z): the same sum the GPU force pass makes
export function headAt(list, x, z) {
  let q = 0;
  for (const e of list) {
    const dx = x - e.x, dz = z - e.z, xb = dx * e.fx + dz * e.fz, yb = -dx * e.fz + dz * e.fx;
    const NS = HW.NS, u = (xb - e.x0) / e.dxs;
    if (u < -e.taper || u > NS - 1 || Math.abs(yb) > e.wmax + 0.5) continue;
    const uc = Math.min(Math.max(u, 0), NS - 1.001), j = Math.floor(uc), w = uc - j, s = e.st;
    const yc = s[j * 4] * (1 - w) + s[j * 4 + 4] * w, hw = s[j * 4 + 1] * (1 - w) + s[j * 4 + 5] * w, D = s[j * 4 + 2] * (1 - w) + s[j * 4 + 6] * w;
    const r = (yb - yc) / Math.max(hw, 0.02), tp = u < 0 ? 1 + u / e.taper : 1;
    q += D * Math.max(0, 1 - r * r) * tp;
  }
  return q;
}
// supersampled over the cell (2 x 2), as the force pass does
export function headCell(list, x, z, dx) {
  const o = dx * 0.25;
  return 0.25 * (headAt(list, x - o, z - o) + headAt(list, x + o, z - o) + headAt(list, x - o, z + o) + headAt(list, x + o, z + o));
}

// ---------------------------------------------------------------------------------------------------
// FFT. The GPU runs Stockham radix-2 passes (natural order in and out, one pass per stage, ping-pong);
// stockhamPass is that pass on the CPU (the test checks it against a plain DFT). The CPU solver uses an
// ordinary in-place transform: the same arithmetic, faster in JS.
export function stockhamPass(src, dst, N, sub, horiz, sign) {
  const half = sub / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const idx = horiz ? x : y;
    const ev = Math.floor(idx / sub) * half + (idx % half), od = ev + N / 2;
    const ie = horiz ? (y * N + ev) * 4 : (ev * N + x) * 4, io = horiz ? (y * N + od) * 4 : (od * N + x) * 4;
    const a = sign * 2 * Math.PI * idx / sub, c = Math.cos(a), s = Math.sin(a), o = (y * N + x) * 4;
    for (let k = 0; k < 4; k += 2) {
      const orr = src[io + k], oi = src[io + k + 1];
      dst[o + k] = src[ie + k] + c * orr - s * oi; dst[o + k + 1] = src[ie + k + 1] + s * orr + c * oi;
    }
  }
}
function fft1(re, im, n, sign, rev, cs, sn) {
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const h = size >> 1, step = (n / size) | 0;
    for (let i = 0; i < n; i += size) for (let j = 0; j < h; j++) {
      const c = cs[j * step], s = sign * sn[j * step], a = i + j, b = a + h;
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
export function makeFFT2(N) {
  const rev = new Uint32Array(N), cs = new Float64Array(N / 2), sn = new Float64Array(N / 2), bits = Math.log2(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = -Math.sin(2 * Math.PI * i / N); }
  const tr = new Float64Array(N), ti = new Float64Array(N);
  // sign -1: forward (e^-i), +1: inverse (unnormalised)
  return (re, im, sign) => {
    for (let y = 0; y < N; y++) { const o = y * N; for (let x = 0; x < N; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; } fft1(tr, ti, N, -sign, rev, cs, sn); for (let x = 0; x < N; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; } }
    for (let x = 0; x < N; x++) { for (let y = 0; y < N; y++) { tr[y] = re[y * N + x]; ti[y] = im[y * N + x]; } fft1(tr, ti, N, -sign, rev, cs, sn); for (let y = 0; y < N; y++) { re[y * N + x] = tr[y]; im[y * N + x] = ti[y]; } }
  };
}
// damping of a mode: a slow overall decay, a viscosity-like k^2 term, and a steep one right at the grid
// scale (k / k_Nyquist)^8 (the spectral solver keeps waves two cells long exactly: nothing else removes them)
export function modeDamp(k, kN, P = HW) { const r = k / kN, r2 = r * r, r4 = r2 * r2; return P.g0 + P.nu * k * k + P.hyper * r4 * r4; }

// the sponge's weight at cell (i, j): 0 inside, rising to 1 over the outer 14 % of the grid
export function spongeW(i, j, N) {
  const e = Math.max(Math.abs((i + 0.5) / N - 0.5), Math.abs((j + 0.5) / N - 0.5)), s = Math.min(1, Math.max(0, (e - 0.36) / 0.14)), w = s * s * (3 - 2 * s);
  return w * w;
}
// The same solver on the CPU (the reference for the GPU passes and the node test)
export class HullWaveSim {
  constructor(opts = {}) {
    const P = this.P = { ...HW, ...opts }, N = this.N = P.N;
    this.L = P.L; this.dx = P.L / N;
    this.h = new Float64Array(N * N); this.phi = new Float64Array(N * N); this.q = new Float64Array(N * N);
    this.zr = new Float64Array(N * N); this.zi = new Float64Array(N * N);
    this.fft = makeFFT2(N);
    this.ci = 0; this.cj = 0;                 // grid centre in whole cells (world = c * dx)
  }
  // centre the grid on world (x, z), in whole cells: the field scrolls with it
  recentre(x, z) {
    const N = this.N, ni = Math.round(x / this.dx), nj = Math.round(z / this.dx), si = ni - this.ci, sj = nj - this.cj;
    if (!si && !sj) return;
    const h = this.zr, p = this.zi;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = i + si, c = j + sj, k = j * N + i;
      if (a < 0 || c < 0 || a >= N || c >= N) { h[k] = 0; p[k] = 0; } else { h[k] = this.h[c * N + a]; p[k] = this.phi[c * N + a]; }
    }
    this.h.set(h); this.phi.set(p); this.ci = ni; this.cj = nj;
  }
  worldOf(i, j) { return [(this.ci + i + 0.5 - this.N / 2) * this.dx, (this.cj + j + 0.5 - this.N / 2) * this.dx]; }
  step(dt, list) {
    const N = this.N, P = this.P, dx = this.dx, h = this.h, phi = this.phi, q = this.q;
    // sponge at the rim (the transform's box is periodic: nothing may come back in on the other side)
    if (this._spDt !== dt) {
      const sp = this._sp || (this._sp = new Float64Array(N * N)); this._spDt = dt;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) sp[j * N + i] = Math.exp(-P.sponge * dt * spongeW(i, j, N));
    }
    for (let k = 0; k < N * N; k++) { h[k] *= this._sp[k]; phi[k] *= this._sp[k]; q[k] = 0; }
    // the hulls' head this step (only the cells near a hull)
    for (const e of list) {
      const R = Math.max(e.x0 * -1, e.x0 + e.dxs * (HW.NS - 1)) + e.wmax + 1;
      const i0 = Math.max(0, Math.floor((e.x - R) / dx - this.ci + N / 2)), i1 = Math.min(N - 1, Math.ceil((e.x + R) / dx - this.ci + N / 2));
      const j0 = Math.max(0, Math.floor((e.z - R) / dx - this.cj + N / 2)), j1 = Math.min(N - 1, Math.ceil((e.z + R) / dx - this.cj + N / 2));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const [x, z] = this.worldOf(i, j); q[j * N + i] += headCell([e], x, z, dx); }
    }
    for (let k = 0; k < N * N; k++) phi[k] -= G * q[k] * dt;          // the hulls' pressure: a kick
    const zr = this.zr, zi = this.zi;
    zr.set(h); zi.set(phi);
    this.fft(zr, zi, -1);
    // per-mode propagator for this dt (cos, |k|/w sin, g/w sin, damping), kept while dt stays the same
    if (this._evDt !== dt) {
      this._evDt = dt;
      const T = this._ev || (this._ev = new Float64Array(N * N * 4)), dk = 2 * Math.PI / this.L, kN = Math.PI / dx;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const kx = (i < N / 2 ? i : i - N) * dk, kz = (j < N / 2 ? j : j - N) * dk, kk = Math.sqrt(kx * kx + kz * kz), o = (j * N + i) * 4;
        if (kk === 0) { T[o] = T[o + 1] = T[o + 2] = T[o + 3] = 0; continue; }
        const w = Math.sqrt(G * kk), e = Math.exp(-modeDamp(kk, kN, P) * dt);
        T[o] = e * Math.cos(w * dt); T[o + 1] = e * kk / w * Math.sin(w * dt); T[o + 2] = e * G / w * Math.sin(w * dt); T[o + 3] = 1;
      }
    }
    const T = this._ev, inv = 1 / (N * N), out = this._o || (this._o = { r: new Float64Array(N * N), i: new Float64Array(N * N) });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, m = ((N - j) % N) * N + ((N - i) % N), o = k * 4;
      if (!T[o + 3]) { out.r[k] = 0; out.i[k] = 0; continue; }
      // H = (Z(k) + conj Z(-k)) / 2, Phi = (Z(k) - conj Z(-k)) / 2i
      const Hr = 0.5 * (zr[k] + zr[m]), Hi = 0.5 * (zi[k] - zi[m]), Fr = 0.5 * (zi[k] + zi[m]), Fi = -0.5 * (zr[k] - zr[m]);
      const c = T[o], a = T[o + 1], b = T[o + 2];
      const H2r = Hr * c + a * Fr, H2i = Hi * c + a * Fi;
      const F2r = Fr * c - b * Hr, F2i = Fi * c - b * Hi;
      // Z' = H' + i Phi'
      out.r[k] = (H2r - F2i) * inv; out.i[k] = (H2i + F2r) * inv;
    }
    zr.set(out.r); zi.set(out.i);
    this.fft(zr, zi, 1);
    h.set(zr); phi.set(zi);
  }
  // the drawn surface: departure from the hulls' static waterline
  hd(i, j) { const k = j * this.N + i; return this.h[k] + this.q[k]; }
}

// ---------------------------------------------------------------------------------------------------
// ?q=low: the steady Kelvin pattern of a hull-like pressure patch, in units of the transverse wavelength
// lambda = 2 pi U^2 / g (so one table serves every speed): h(X, Y) for the patch moving toward +X, from
//   H(k) = -Q(k) |k| / (|k| - kx^2 / K0 - i eps kx)    (K0 = g / U^2 = 2 pi; eps: the radiation condition)
// Returns { n, X0, X1, Y1, data: Float32Array(n * n * 4) (h, dh/dX, dh/dY, 0) } for a unit-volume patch.
export function kelvinPattern(n = 256, span = 25.6, ahead = 3.2, lenL = 0.9, eps = 0.06) {
  const re = new Float64Array(n * n), im = new Float64Array(n * n), d = span / n, fft = makeFFT2(n);
  const X0 = ahead - span, K0 = 2 * Math.PI, sx = lenL / 4, sy = lenL / 14;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    // periodic coordinates centred on the patch (at X = 0, Y = 0)
    const X = i < n / 2 ? i * d : (i - n) * d, Y = j < n / 2 ? j * d : (j - n) * d;
    re[j * n + i] = Math.exp(-0.5 * ((X / sx) ** 2 + (Y / sy) ** 2)) / (2 * Math.PI * sx * sy);
  }
  fft(re, im, -1);
  const dk = 2 * Math.PI / span, out = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)], oi = [new Float64Array(n * n), new Float64Array(n * n), new Float64Array(n * n)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, kx = (i < n / 2 ? i : i - n) * dk, ky = (j < n / 2 ? j : j - n) * dk, kk = Math.hypot(kx, ky);
    if (kk === 0) continue;
    // -|k| / (|k| - kx^2/K0 - i eps kx), times the patch, damped at the grid scale
    const ar = kk - kx * kx / K0, ai = -eps * kx, den = ar * ar + ai * ai;
    const tr = -kk * ar / den, ti = kk * ai / den, f = Math.exp(-((kk * d / 2.2) ** 4));
    const Hr = (re[k] * tr - im[k] * ti) * f, Hi = (re[k] * ti + im[k] * tr) * f;
    out[0][k] = Hr; oi[0][k] = Hi;
    out[1][k] = -kx * Hi; oi[1][k] = kx * Hr;                    // d/dX: i kx H
    out[2][k] = -ky * Hi; oi[2][k] = ky * Hr;
  }
  for (let c = 0; c < 3; c++) fft(out[c], oi[c], 1);
  const data = new Float32Array(n * n * 4), inv = 1 / (n * n);
  // re-laid so texel i sits at X = X0 + i d (patch at X = 0) and texel j at Y = (j - n/2) d
  const i0 = Math.round(X0 / d);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const si = (((i + i0) % n) + n) % n, sj = (j + n / 2) % n, k = sj * n + si, o = (j * n + i) * 4;
    data[o] = out[0][k] * inv; data[o + 1] = out[1][k] * inv; data[o + 2] = out[2][k] * inv;
  }
  return { n, X0: i0 * d, span, d, data };
}

// ---------------------------------------------------------------------------------------------------
// GPU: HullWaveSim.step as full-screen passes on N^2 RG float targets (h + i phi; two, ping-pong):
//   prep (scroll, sponge, the hulls' kick) -> 2 log2 N Stockham passes -> evolve -> 2 log2 N back,
// and then the surface the water reads: (h + q, its slope, where it breaks) at half float, mipmapped so a
// vertex or a far pixel reads the level that matches its own spacing (no moire from waves it cannot draw).
// (8 bytes a texel: ~1.5 MB of traffic a pass, ~35 passes a step)
const FS_VERT = /* glsl */`void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const hullHeadGLSL = (NS, MAXH) => /* glsl */`
uniform vec4 uHP[${MAXH}];            // hull: position relative to the grid centre, forward (x, z)
uniform vec4 uHM[${MAXH}];            // station 0 (body x), station spacing, taper aft of the transom (stations), half-span
uniform vec4 uHS[${MAXH * NS}];       // stations: waterplane centre (starboard), half-width, head amplitude
uniform int uHn;
float hullHead(vec2 p) {
  float q = 0.0;
  for (int h = 0; h < ${MAXH}; h++) { if (h >= uHn) break;
    vec4 P = uHP[h], M = uHM[h];
    vec2 d = p - P.xy; float xb = dot(d, P.zw), yb = dot(d, vec2(-P.w, P.z)), u = (xb - M.x) / M.y;
    if (u < -M.z || u > ${NS - 1}.0 || abs(yb) > M.w + 0.5) continue;
    float uc = clamp(u, 0.0, ${NS - 1}.0 - 0.001); int j = int(uc); float w = uc - float(j);
    vec3 s = mix(uHS[h * ${NS} + j].xyz, uHS[h * ${NS} + j + 1].xyz, w);
    float r = (yb - s.x) / max(s.y, 0.02);
    q += s.z * max(0.0, 1.0 - r * r) * (u < 0.0 ? 1.0 + u / M.z : 1.0);
  }
  return q;
}
// supersampled over the cell (2 x 2), cell (i, j) of the grid (uDx a side, centred on the grid centre)
float headCell(ivec2 ij) {
  if (uHn == 0) return 0.0;
  vec2 p = (vec2(ij) + 0.5 - float(N / 2)) * uDx, o = vec2(0.25 * uDx, -0.25 * uDx);
  return 0.25 * (hullHead(p - o.xx) + hullHead(p + o.xy) + hullHead(p - o.xy) + hullHead(p + o.xx));
}`;
// sampling for the water (and the foam pass): uHWC = (centre x, z, size, on)
export const HW_GLSL = /* glsl */`
uniform sampler2D uHW; uniform vec4 uHWC;
vec4 hwAt(vec2 x, float lod) {
  vec2 uv = (x - uHWC.xy) / uHWC.z + 0.5;
  float w = uHWC.w * (1.0 - smoothstep(0.38, 0.47, max(abs(uv.x - 0.5), abs(uv.y - 0.5))));
  return w > 0.0 ? textureLod(uHW, uv, lod) * w : vec4(0.0);
}`;

export class HullWaves {
  constructor(THREE, renderer, opts = {}) {
    const P = this.P = { ...HW, ...opts }, N = P.N;
    this.T = THREE; this.r = renderer; this.dx = P.L / N;
    this.ok = !!(renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float'));
    this.uniforms = { uHW: { value: null }, uHWC: { value: new THREE.Vector4(0, 0, P.L, 0) } };
    this.t = null; this.ci = 0; this.cj = 0; this.dir = null; this.nSteps = 0; this.cpuMs = 0; this.frames = 0; this.passes = 0;
    if (!this.ok) return;
    const mk = (o) => new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false, ...o });
    this.A = mk(); this.B = mk();
    this.S = mk({ type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    this.uniforms.uHW.value = this.S.texture;
    const mat = (frag, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: FS_VERT, fragmentShader: `const int N = ${N};\n` + frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4());
    this.prep = mat(/* glsl */`
      uniform sampler2D uSrc; uniform ivec2 uShift; uniform float uSp; uniform float uDx; uniform float uDt;
      ${hullHeadGLSL(P.NS, P.MAXH)}
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy), s = ij + uShift;
        vec2 hp = vec2(0.0);
        if (s.x >= 0 && s.y >= 0 && s.x < N && s.y < N) hp = texelFetch(uSrc, s, 0).rg;
        vec2 uv = (vec2(ij) + 0.5) / float(N);
        float sw = smoothstep(0.36, 0.5, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
        hp *= exp(-uSp * sw * sw);                                     // the sponge at the rim
        hp.y -= 9.81 * headCell(ij) * uDt;                             // the hulls' pressure: a kick
        gl_FragColor = vec4(hp, 0.0, 0.0);
      }`, this.hu = { uSrc: { value: null }, uShift: { value: [0, 0] }, uSp: { value: 0 }, uDx: { value: this.dx }, uDt: { value: 0 }, uHP: { value: v4(P.MAXH) }, uHM: { value: v4(P.MAXH) }, uHS: { value: v4(P.MAXH * P.NS) }, uHn: { value: 0 } });
    this.fftM = mat(/* glsl */`
      uniform sampler2D uSrc; uniform int uSub; uniform int uHz; uniform float uSign;
      void main(){
        ivec2 p = ivec2(gl_FragCoord.xy);
        int idx = uHz == 1 ? p.x : p.y, hf = uSub / 2, ev = (idx / uSub) * hf + idx % hf, od = ev + N / 2;
        vec2 e = texelFetch(uSrc, uHz == 1 ? ivec2(ev, p.y) : ivec2(p.x, ev), 0).xy, o = texelFetch(uSrc, uHz == 1 ? ivec2(od, p.y) : ivec2(p.x, od), 0).xy;
        float a = uSign * 6.28318530718 * float(idx) / float(uSub), c = cos(a), s = sin(a);
        gl_FragColor = vec4(e.x + c * o.x - s * o.y, e.y + s * o.x + c * o.y, 0.0, 0.0);
      }`, { uSrc: { value: null }, uSub: { value: 2 }, uHz: { value: 1 }, uSign: { value: -1 } });
    this.evolve = mat(/* glsl */`
      uniform sampler2D uSrc; uniform float uDt; uniform float uDk; uniform float uKN; uniform vec3 uDamp;
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy), mj = ivec2((N - ij.x) % N, (N - ij.y) % N);
        vec2 kv = vec2(float(ij.x < N / 2 ? ij.x : ij.x - N), float(ij.y < N / 2 ? ij.y : ij.y - N)) * uDk;
        float kk = length(kv);
        if (kk == 0.0) { gl_FragColor = vec4(0.0); return; }
        vec2 a = texelFetch(uSrc, ij, 0).xy, b = texelFetch(uSrc, mj, 0).xy;
        // Z = FFT(h + i phi): H = (Z(k) + conj Z(-k)) / 2, Phi = (Z(k) - conj Z(-k)) / 2i
        vec2 H = 0.5 * vec2(a.x + b.x, a.y - b.y), F = 0.5 * vec2(a.y + b.y, b.x - a.x);
        float w = sqrt(9.81 * kk), r = kk / uKN, r4 = r * r * r * r;
        float e = exp(-(uDamp.x + uDamp.y * kk * kk + uDamp.z * r4 * r4) * uDt), c = cos(w * uDt), s = sin(w * uDt);
        vec2 H2 = e * (H * c + kk / w * s * F), F2 = e * (F * c - 9.81 / w * s * H);
        gl_FragColor = vec4(H2.x - F2.y, H2.y + F2.x, 0.0, 0.0) / float(N * N);
      }`, { uSrc: { value: null }, uDt: { value: 0 }, uDk: { value: 2 * Math.PI / P.L }, uKN: { value: Math.PI / this.dx }, uDamp: { value: new THREE.Vector3(P.g0, P.nu, P.hyper) } });
    this.surf = mat(/* glsl */`
      uniform sampler2D uSrc; uniform float uDx;
      ${hullHeadGLSL(P.NS, P.MAXH)}
      float hd(ivec2 p) { p = clamp(p, ivec2(0), ivec2(N - 1)); return texelFetch(uSrc, p, 0).x + headCell(p); }
      void main(){
        ivec2 ij = ivec2(gl_FragCoord.xy);
        float q = headCell(ij), h0 = texelFetch(uSrc, ij, 0).x + q;
        float x1 = hd(ij + ivec2(1, 0)), x0 = hd(ij - ivec2(1, 0)), z1 = hd(ij + ivec2(0, 1)), z0 = hd(ij - ivec2(0, 1));
        vec2 g = vec2(x1 - x0, z1 - z0) / (2.0 * uDx);
        float lap = (x1 + x0 + z1 + z0 - 4.0 * h0) / (uDx * uDx);
        // breaking: a crest steeper than ~0.25 (Stokes' limit 0.58) and sharp (curving down), outside the hulls
        float brk = smoothstep(0.2, 0.42, length(g)) * smoothstep(0.0, 0.03, h0) * smoothstep(0.1, -0.4, lap) * (1.0 - smoothstep(0.005, 0.04, q));
        gl_FragColor = vec4(h0, g, brk);
      }`, { ...this.hu, uSrc: { value: null } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.prep); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.list = []; this.prev = new Map();
    this._cc = new THREE.Color();
  }
  _pass(mat, src, dst) { mat.uniforms.uSrc.value = src.texture; this.quad.material = mat; this.r.setRenderTarget(dst); this.r.render(this.scene, this.cam); this.passes++; }
  // 2 log2 N passes, ping-pong from A (an even count: the result is back in A)
  _fft(sign) {
    const N = this.P.N, M = this.fftM.uniforms;
    for (const hz of [1, 0]) for (let sub = 2; sub <= N; sub *= 2) {
      M.uSub.value = sub; M.uHz.value = hz; M.uSign.value = sign;
      this._pass(this.fftM, this.A, this.B); [this.A, this.B] = [this.B, this.A];
    }
  }
  clear() {
    const r = this.r, cc = r.getClearColor(this._cc), ca = r.getClearAlpha(), prev = r.getRenderTarget();
    r.setClearColor(0x000000, 0);
    for (const rt of [this.A, this.B, this.S]) { r.setRenderTarget(rt); r.clear(true, false, false); }
    r.setClearColor(cc, ca); r.setRenderTarget(prev);
  }
  // one step: the state in A -> A
  _step(dt, shift, hulls) {
    const U = this.prep.uniforms, P = this.P;
    U.uShift.value[0] = shift[0]; U.uShift.value[1] = shift[1]; U.uSp.value = P.sponge * dt; U.uDt.value = dt;
    U.uHn.value = hulls.length;
    for (let i = 0; i < hulls.length; i++) {
      const e = hulls[i];
      U.uHP.value[i].set(e.rx, e.rz, e.rfx, e.rfz); U.uHM.value[i].set(e.x0, e.dxs, e.taper, e.wmax);
      for (let j = 0; j < P.NS; j++) U.uHS.value[i * P.NS + j].set(e.st[j * 4], e.st[j * 4 + 1], e.st[j * 4 + 2], 0);
    }
    this._pass(this.prep, this.A, this.B); [this.A, this.B] = [this.B, this.A];
    this._fft(-1);
    this.evolve.uniforms.uDt.value = dt;
    this._pass(this.evolve, this.A, this.B); [this.A, this.B] = [this.B, this.A];
    this._fft(1);
    this.nSteps++;
  }
  // t: sim time; boats: all of them; player: the boat the grid follows
  update(t, boats, player) {
    if (!this.ok || !player) return;
    const c0 = performance.now(), P = this.P, dx = this.dx;
    const dt0 = this.t === null ? 0 : t - this.t, jump = this.t === null || dt0 < 0 || dt0 > 3;
    this.t = t;
    const r = this.r, prevRT = r.getRenderTarget(), ac = r.autoClear;
    if (jump) { this.clear(); this.prev.clear(); this.dir = null; }
    const pp = player.pose || player;
    // the grid follows the player, set back along its (slowly followed) track so the wake has the room
    const sp = Math.hypot(player.vgx || 0, player.vgz || 0), hx = sp > 0.3 ? player.vgx / sp : Math.sin(pp.psi), hz = sp > 0.3 ? player.vgz / sp : -Math.cos(pp.psi);
    if (!this.dir) this.dir = [hx, hz];
    else { const k = 1 - Math.exp(-Math.max(dt0, 0) / 4); this.dir[0] += (hx - this.dir[0]) * k; this.dir[1] += (hz - this.dir[1]) * k; }
    const ni = Math.round((pp.x - this.dir[0] * 0.2 * P.L) / dx), nj = Math.round((pp.z - this.dir[1] * 0.2 * P.L) / dx);
    const shift = jump ? [0, 0] : [ni - this.ci, nj - this.cj];
    this.ci = ni; this.cj = nj;
    const cx = ni * dx, cz = nj * dx;
    // the hulls: the player's, then the nearest boats on the grid that are moving (at rest a hull makes nothing)
    const cand = [];
    for (const b of boats) {
      const q = b.pose || b, d = Math.hypot(q.x - cx, q.z - cz);
      if (b !== player && (d > 0.34 * P.L || Math.hypot(b.vgx || 0, b.vgz || 0) < 0.25)) continue;
      cand.push([b === player ? -1 : d, b]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const list = this.list; list.length = 0;
    for (const [, b] of cand) { if (list.length >= P.MAXH) break; hullEntries(b, b.pose, list, P.MAXH); }
    const n = jump ? 1 : Math.min(8, Math.ceil(dt0 / P.maxDt - 1e-9));
    r.autoClear = false;
    this.passes = 0;
    if (n > 0) {
      const h = jump ? 0.02 : dt0 / n;
      for (let s = 1; s <= n; s++) {
        // positions between the last frame's and this one's (the head moves smoothly under the grid)
        const a = s / n;
        for (const e of list) {
          const pv = this.prev.get(e.b), x = pv ? pv[0] + (e.x - pv[0]) * a : e.x, z = pv ? pv[1] + (e.z - pv[1]) * a : e.z;
          let fx = pv ? pv[2] + (e.fx - pv[2]) * a : e.fx, fz = pv ? pv[3] + (e.fz - pv[3]) * a : e.fz; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
          e.rx = x - cx; e.rz = z - cz; e.rfx = fx; e.rfz = fz;
        }
        this._step(h, s === 1 ? shift : [0, 0], list);
      }
      this.prev.clear();
      for (const e of list) if (!this.prev.has(e.b)) this.prev.set(e.b, [e.x, e.z, e.fx, e.fz]);
      this._pass(this.surf, this.A, this.S);
    }
    r.autoClear = ac; r.setRenderTarget(prevRT);
    this.uniforms.uHWC.value.set(cx, cz, P.L, 1);
    this.frames++; this.cpuMs += performance.now() - c0;
  }
  stats() { return { N: this.P.N, L: this.P.L, steps: this.nSteps, frames: this.frames, passesLastFrame: this.passes, cpuMsPerFrame: +(this.cpuMs / Math.max(1, this.frames)).toFixed(3), hulls: this.list.length }; }
  dispose() { for (const rt of [this.A, this.B, this.S]) rt && rt.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// ?q=low (and no float targets): the steady pattern of kelvinPattern for the player and the nearest moving
// boat, laid along each one's track and scaled by lambda = 2 pi U^2 / g (held at 1.6 LWL, Fn 0.5: beyond it
// the wake narrows and this table no longer describes it); height V / lambda^2 x the unit-volume table.
// uKT = (X0, span, n, on) of the table; uKB[i] = (x, z, track x, z); uKS[i] = (lambda, amplitude, -, -)
export const KW_GLSL = /* glsl */`
uniform sampler2D uKW; uniform vec4 uKT; uniform vec4 uKB[2]; uniform vec4 uKS[2];
vec3 kwAt(vec2 x) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 2; i++) { vec4 B = uKB[i], S = uKS[i]; if (S.y <= 0.0) continue;
    vec2 d = (x - B.xy) / S.x; float X = dot(d, B.zw), Y = dot(d, vec2(-B.w, B.z));
    vec2 uv = vec2((X - uKT.x) / uKT.y, Y / uKT.y + 0.5) + 0.5 / uKT.z;
    float e = max(abs(uv.x - 0.5), abs(uv.y - 0.5)); if (e > 0.5) continue;
    vec3 v = texture(uKW, uv).xyz * (1.0 - smoothstep(0.38, 0.49, e)) * S.y;
    r += vec3(v.x, (v.y * B.zw + v.z * vec2(-B.w, B.z)) / S.x);
  }
  return r;
}`;
export class KelvinLow {
  constructor(THREE) {
    const K = kelvinPattern(256), n = K.n, half = new Uint16Array(n * n * 4);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(K.data[i]);
    const tex = new THREE.DataTexture(half, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this.uniforms = { uKW: { value: tex }, uKT: { value: new THREE.Vector4(K.X0, K.span, n, 1) }, uKB: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uKS: { value: [new THREE.Vector4(), new THREE.Vector4()] } };
    this.t = null;
  }
  update(t, boats, player) {
    const dt = this.t === null ? 0 : Math.min(Math.max(t - this.t, 0), 1); this.t = t;
    const U = this.uniforms, pp = player ? (player.pose || player) : null;
    const cand = [];
    if (player) for (const b of boats) {
      const q = b.pose || b, d = Math.hypot(q.x - pp.x, q.z - pp.z);
      if (b === player || d < 150) cand.push([b === player ? -1 : d, b]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < 2; i++) {
      const b = cand[i] && cand[i][1];
      if (!b) { U.uKS.value[i].set(1, 0, 0, 0); continue; }
      const q = b.pose || b, C = b.cls, sp = Math.hypot(b.vgx || 0, b.vgz || 0);
      // the track, followed over a couple of seconds (the pattern is the wake of a steady course)
      const hx = sp > 0.3 ? b.vgx / sp : Math.sin(q.psi), hz = sp > 0.3 ? b.vgz / sp : -Math.cos(q.psi);
      const dd = b._kwDir || (b._kwDir = [hx, hz]), k = 1 - Math.exp(-dt / 2);
      dd[0] += (hx - dd[0]) * k; dd[1] += (hz - dd[1]) * k; const l = Math.hypot(dd[0], dd[1]) || 1;
      const lam = Math.max(0.5, Math.min(2 * Math.PI * sp * sp / G, 1.6 * C.lwl)), Fn = sp / Math.sqrt(G * C.lwl);
      const V = (C.massHull + C.crewN * C.crewEach) / 1025;
      const amp = V / (lam * lam) * Math.min(1, Math.max(0, (Fn - 0.08) / 0.25)) * Math.min(1, Math.max(0, (sp - 0.4) / 0.8));
      U.uKB.value[i].set(q.x, q.z, dd[0] / l, dd[1] / l); U.uKS.value[i].set(lam, amp, 0, 0);
    }
  }
}

// Planing (a monohull past Fn ~0.5, a cat's hulls past ~0.7): the water closing in behind the dry transom
// throws up a rooster tail, a fan of spray a beam or so aft, rising at a third of the boat's speed and
// falling back into the wake. Emitted through the splash's drops (splash.js HullSplash.emit).
export function roosterTail(splash, b, dt, env, t, tmp = {}) {
  const C = b.cls, P = b.pose || b, U = Math.max(0, b.u || 0), Fn = U / Math.sqrt(G * C.lwl);
  const k = Math.min(1, Math.max(0, (Fn - (C.multihull ? 0.7 : 0.5)) / 0.4));
  if (k <= 0 || dt <= 0) return;
  const fx = Math.sin(P.psi), fz = -Math.cos(P.psi), rx = Math.cos(P.psi), rz = Math.sin(P.psi);
  const offs = C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0], hb = C.hullBeam ?? C.beam;
  for (const o of offs) {
    let n = k * U * dt * (C.multihull ? 10 : 22);
    for (; n > 0; n--) {
      if (n < 1 && Math.random() > n) break;
      const back = C.sternX - (0.6 + Math.random() * 1.2) * hb, lat = o + (Math.random() - 0.5) * 0.5 * hb;
      const x = P.x + fx * back + rx * lat, z = P.z + fz * back + rz * lat;
      const y = env && env.wavesOn ? env.waves.sample(x, z, t, tmp).h : 0;
      const up = U * (0.18 + 0.2 * Math.random()) * (0.5 + 0.5 * k), fw = U * (0.35 + 0.3 * Math.random()), sd = (Math.random() - 0.5) * U * 0.12;
      splash.emit(x, y + 0.05, z, fx * fw + rx * sd + (b.vgx || 0) * 0.1, up, fz * fw + rz * sd + (b.vgz || 0) * 0.1, 0.03 + Math.random() * 0.05, Math.random() < 0.15 ? 1 : 0, 0.9);
    }
  }
}
