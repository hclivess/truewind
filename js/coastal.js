// Coastal wave transformation, precomputed per venue (on load, in a worker; again when the tide or the day's
// wind moves far enough): what the bottom and the coast do to each Gerstner component of the sea.
//  * Phase: the first-arrival solution of the eikonal |grad S| = k(h), k from the full dispersion relation
//    w^2 = g k tanh(k h) (fast marching from the upwave edges of the map, the coast and breakwaters blocking).
//    Crests shorten and bend toward the shallows (Snell), wrap round headlands, and in the lee of an obstacle
//    the first arrival is the wave diffracted round its end (Huygens).
//  * Amplitude: energy flux conserved along refracted rays (Cg E b const, b the width of the ray tube):
//    shoaling and refraction together, from the density of rays traced over the bottom. Rays cross land
//    unhindered here (the unobstructed wave, which the shelter factor then takes down).
//  * Shelter and diffraction: a one-way wide-angle (angular-spectrum) march of a unit wave along the
//    component's direction past the obstacles (the parabolic approximation without its small-angle limit):
//    exact Fresnel diffraction round a breakwater head, through a harbour entrance, behind an island or a
//    rock. Beyond the angles the march can resolve (short waves on a coarse grid; 90 deg into the lee),
//    the Sommerfeld single-edge asymptote from the eikonal's detour: |F(sigma)|, sigma^2 = 2 dS / pi.
//  * Wind sea is fetch-limited along its own direction: the effective fetch (the SPM's cos^2 fan of radials)
//    sets the local JONSWAP energy of each component, so the lee of land holds a smaller, shorter sea.
//  * Reflection: rays striking a wall reflect about its normal with the coefficient of its kind (vertical
//    quays ~0.9, rubble mounds Seelig-Ahrens 0.6 xi^2 / (6.6 + xi^2), natural slopes Battjes 0.1 xi^2, xi the
//    surf similarity); the reflected wave's phase is the first arrival from the struck walls with the image
//    path to the wall face, so the clapotis has its antinode on the wall.
// Depth-limited breaking is applied where the waves are summed (WaveField.sample and the water shader).
// Output per component: a tangent plane of the phase and the amplitude factor on an M^2 grid, (P, Gx, Gz, K):
// phase(x) = P + G.x, local wavevector G, and the same for the reflected wave on an (M/2)^2 grid. Bilinear
// blending of tangent planes stays exact for plane waves whatever the filtering precision.
import { binEnergy } from './env.js';

const G = 9.81;
export const CST_M = 256;            // coastal grid cells a side
const KCAP = 2.4;                    // caustics: a focus holds finite energy (the Airy peak)

// wavenumber from the full dispersion relation (Newton from Eckart's estimate)
export function dispK(w, h) {
  const k0 = w * w / G;
  if (!(h > 0.02)) h = 0.02;
  if (k0 * h > 12) return k0;
  let k = k0 / Math.sqrt(Math.tanh(k0 * h));
  for (let i = 0; i < 8; i++) {
    const t = Math.tanh(k * h), f = G * k * t - w * w, df = G * t + G * k * h * (1 - t * t);
    const dk = f / df; k -= dk; if (Math.abs(dk) < 1e-10 * k) break;
  }
  return k;
}
export function groupSpeed(w, k, h) {
  const kh = k * h;
  return (kh > 20 ? 0.5 : 0.5 * (1 + 2 * kh / Math.sinh(2 * kh))) * w / k;
}
// Fresnel integrals C, S (Abramowitz & Stegun 7.3.32-33 auxiliary functions, error < 2e-3)
function fresnelCS(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const f = (1 + 0.926 * x) / (2 + 1.792 * x + 3.104 * x * x), g = 1 / (2 + 4.142 * x + 3.492 * x * x + 6.670 * x * x * x);
  const a = Math.PI * x * x / 2, ca = Math.cos(a), sa = Math.sin(a);
  return [s * (0.5 + f * sa - g * ca), s * (0.5 - f * ca - g * sa)];
}
// |F(sigma)|: the knife-edge (Fresnel) field, F = (1+i)/2 int_-inf^sigma exp(-i pi t^2 / 2) dt; 1/2 on the
// shadow line, -> 0 in the shadow (sigma < 0), -> 1 with ripples in the light
export function fresnelEdge(sig) {
  const [C, S] = fresnelCS(sig);
  const re = 0.5 + C, im = -0.5 - S;                 // (1-i)/2 + C - i S
  return Math.hypot(re - im, re + im) / 2;           // |(1+i)(re + i im)| / 2
}

// ---------- main thread: sample the venue onto the coastal grid ----------
// world: World (sdfAt, depthAt); geo: its OSM geometry (breakwaters, groynes, piers); waves: WaveField.
// depthAt defaults to world.depthAt (real, tide-aware bathymetry where the world has it).
export function coastalInput(world, geo, waves, opts = {}) {
  const M = opts.M ?? CST_M, R = world.R, cs = 2 * R / M, N = M * M;
  const depthAt = opts.depthAt || ((x, z) => world.depthAt(x, z));
  const depth = new Float32Array(N), osdf = new Float32Array(N), blocked = new Uint8Array(N), bcls = new Uint8Array(N);
  const q = cs * 0.3;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs, k = j * M + i, s = world.sdfAt(x, z);
    osdf[k] = s;
    // land narrower than a cell (moles, spits) still blocks: any of five points on land
    const land = s < 0 || (s < cs && (world.sdfAt(x - q, z - q) < 0 || world.sdfAt(x + q, z - q) < 0 || world.sdfAt(x - q, z + q) < 0 || world.sdfAt(x + q, z + q) < 0));
    blocked[k] = land ? 1 : 0;
    depth[k] = land ? 0 : Math.max(0.1, depthAt(x, z));
  }
  // breakwaters and groynes are solid (rubble mounds); piers stand on piles and let the sea through, but a
  // shore lined with them is a harbour's quays (vertical walls)
  const seg = (pts, r, fn) => {
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r + R) / cs)), i1 = Math.min(M - 1, Math.floor((Math.max(ax, bx) + r + R) / cs));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r + R) / cs)), j1 = Math.min(M - 1, Math.floor((Math.max(az, bz) + r + R) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        fn(j * M + i, Math.hypot(ax + dx * t - x, az + dz * t - z));
      }
    }
  };
  const quay = new Uint8Array(N);
  for (const p of (geo && geo.piers) || []) {
    if (p.kind === 'breakwater' || p.kind === 'groyne') {
      const hw = (p.w ?? 10) / 2;
      seg(p.pts, cs, (k, d) => { osdf[k] = Math.min(osdf[k], d - hw); if (d < 0.71 * cs) { blocked[k] = 1; bcls[k] = 1; depth[k] = 0; } });
    } else if (p.kind === 'pier') seg(p.pts, 50, (k, d) => { if (d < 50) quay[k] = 1; });
  }
  // revetments the venue's manifest names (causeways, terminals): rock
  const rock = opts.byId ? (geo?.coast || []).filter(c => c.id && /^(causeway|terminal)$/.test(opts.byId.get(c.id)?.type || '')) : [];
  for (const c of rock) seg(c.pts, cs, (k, d) => { if (d < cs && blocked[k]) bcls[k] = 1; });
  for (let k = 0; k < N; k++) if (blocked[k] && !bcls[k] && quay[k]) bcls[k] = 2;
  const comps = waves.comps.map(c => ({ w: c.omega, dx: c.dx, dz: c.dz, sea: c.kind === 'sea', fa: c.fa, fb: c.fb }));
  return { M, R, depth, osdf, blocked, bcls, comps, U: opts.U ?? waves.U0, Fref: waves.F, Fedge: opts.Fedge ?? 25000, peN: opts.peN, rayDiv: opts.rayDiv };
}
export const coastalTransfer = (inp) => [inp.depth.buffer, inp.osdf.buffer, inp.blocked.buffer, inp.bcls.buffer];

// ---------- the build (pure: plain arrays in, plain arrays out; runs in a worker) ----------
function bil(a, M, fx, fz) {
  let i = Math.floor(fx), j = Math.floor(fz);
  const u = fx - i, v = fz - j;
  const i0 = i < 0 ? 0 : i > M - 1 ? M - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 > M - 1 ? M - 1 : i + 1;
  const j0 = j < 0 ? 0 : j > M - 1 ? M - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 > M - 1 ? M - 1 : j + 1;
  return (a[j0 * M + i0] * (1 - u) + a[j0 * M + i1] * u) * (1 - v) + (a[j1 * M + i0] * (1 - u) + a[j1 * M + i1] * u) * v;
}
// fast marching on the grid: T holds the seeds (finite) and Infinity elsewhere; slow = phase per metre
function fmm(M, cs, slow, blocked, T) {
  const N = M * M, done = new Uint8Array(N);
  let cap = N * 2, hv = new Float64Array(cap), hk = new Int32Array(cap), n = 0;
  const push = (v, k) => {
    if (n >= cap) { cap *= 2; const a = new Float64Array(cap), b = new Int32Array(cap); a.set(hv); b.set(hk); hv = a; hk = b; }
    let c = n++;
    while (c > 0) { const p = (c - 1) >> 1; if (hv[p] <= v) break; hv[c] = hv[p]; hk[c] = hk[p]; c = p; }
    hv[c] = v; hk[c] = k;
  };
  const pop = () => {
    const top = hk[0], v = hv[--n], kk = hk[n];
    let c = 0;
    for (;;) {
      let m = 2 * c + 1; if (m >= n) break;
      if (m + 1 < n && hv[m + 1] < hv[m]) m++;
      if (hv[m] >= v) break;
      hv[c] = hv[m]; hk[c] = hk[m]; c = m;
    }
    hv[c] = v; hk[c] = kk;
    return top;
  };
  const solve = (k) => {
    const x = k % M;
    let a = Math.min(x > 0 ? T[k - 1] : Infinity, x < M - 1 ? T[k + 1] : Infinity);
    let b = Math.min(k >= M ? T[k - M] : Infinity, k < N - M ? T[k + M] : Infinity);
    if (a > b) { const t = a; a = b; b = t; }
    const f = slow[k] * cs;
    if (b - a >= f) return a + f;
    return 0.5 * (a + b + Math.sqrt(2 * f * f - (b - a) * (b - a)));
  };
  const relax = (q) => { if (done[q] || blocked[q]) return; const t = solve(q); if (t < T[q]) { T[q] = t; push(t, q); } };
  for (let k = 0; k < N; k++) if (T[k] < Infinity) push(T[k], k);
  while (n) {
    const v = hv[0], k = pop();
    if (done[k] || v > T[k]) continue;
    done[k] = 1;
    const x = k % M;
    if (x > 0) relax(k - 1);
    if (x < M - 1) relax(k + 1);
    if (k >= M) relax(k - M);
    if (k < N - M) relax(k + M);
  }
  return T;
}
// semi-Lagrangian upwind sweep along the unit direction (ux, uz): out[k] = add(k, value 1.5 cells upwave),
// the upwave value from outside(qx, qz) beyond the map. Scan order keeps every upwave neighbour done first.
function sweep(M, R, ux, uz, out, outside, add) {
  const cs = 2 * R / M, L = 1.5 * cs;
  for (let jj = 0; jj < M; jj++) {
    const j = uz >= 0 ? jj : M - 1 - jj;
    for (let ii = 0; ii < M; ii++) {
      const i = ux >= 0 ? ii : M - 1 - ii, k = j * M + i;
      const qx = -R + (i + 0.5) * cs - ux * L, qz = -R + (j + 0.5) * cs - uz * L;
      const v = (qx < -R || qx > R || qz < -R || qz > R) ? outside(qx, qz) : bil(out, M, (qx + R) / cs - 0.5, (qz + R) / cs - 0.5);
      out[k] = add(k, v, L);
    }
  }
  return out;
}
// radix-2 FFT (in place); tables per size
const _fft = new Map();
function fftTab(n) {
  let t = _fft.get(n); if (t) return t;
  const rev = new Uint32Array(n), c = new Float64Array(n / 2), s = new Float64Array(n / 2), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = Math.sin(2 * Math.PI * i / n); }
  t = { rev, c, s }; _fft.set(n, t); return t;
}
function fft(re, im, inv) {
  const n = re.length, { rev, c, s } = fftTab(n), sg = inv ? 1 : -1;
  for (let i = 0; i < n; i++) { const r = rev[i]; if (r > i) { let t = re[i]; re[i] = re[r]; re[r] = t; t = im[i]; im[i] = im[r]; im[r] = t; } }
  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1, step = n / size;
    for (let j = 0; j < half; j++) {
      const wr = c[j * step], wi = sg * s[j * step];
      for (let a = j; a < n; a += size) {
        const b = a + half, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
// Shelter: a unit plane wave marched along (dx, dz) past the obstacles by its angular spectrum, each plane-wave
// part advanced by exp(i (sqrt(k^2 - kappa^2) - k) ds) (evanescent beyond k), the obstacles zeroing the field
// on the way (a black screen: reflection is handled apart). Returns |u| on the coastal grid and the largest
// angle the march resolves (the transverse spacing limits kappa to pi / dn).
function shelterPE(M, R, blocked, k, dx, dz, Nn, pool = {}) {
  const cs = 2 * R / M, px = -dz, pz = dx;
  let s0 = Infinity, s1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [x, z] of [[-R, -R], [R, -R], [-R, R], [R, R]]) { const s = x * dx + z * dz, n = x * px + z * pz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  const dn = Math.max(0.5 * cs, 1.6 * (n1 - n0) / Nn), ds = dn, nStart = 0.5 * (n0 + n1) - 0.5 * Nn * dn;
  const S = Math.ceil((s1 - s0) / ds) + 2;
  const re = new Float64Array(Nn).fill(1), im = new Float64Array(Nn);
  const pr = new Float64Array(Nn), pi = new Float64Array(Nn);
  for (let m = 0; m < Nn; m++) {
    const kap = 2 * Math.PI * (m < Nn / 2 ? m : m - Nn) / (Nn * dn);
    if (Math.abs(kap) < k) { const ph = (Math.sqrt(k * k - kap * kap) - k) * ds; pr[m] = Math.cos(ph) / Nn; pi[m] = Math.sin(ph) / Nn; }
    else { pr[m] = Math.exp(-Math.sqrt(kap * kap - k * k) * ds) / Nn; pi[m] = 0; }
  }
  const D = pool.D && pool.D.length >= S * Nn ? pool.D : (pool.D = new Float32Array(S * Nn)), ic = 1 / cs;
  const blk = (x, z) => {
    const u = (x + R) * ic, v = (z + R) * ic;
    return blocked[(v < 0 ? 0 : v >= M ? M - 1 : v | 0) * M + (u < 0 ? 0 : u >= M ? M - 1 : u | 0)];
  };
  // an obstacle anywhere in a sample's footprint (2 x 2 points half a sample apart) blocks it: a breakwater
  // thinner than a sample stays shut
  const qa = 0.25 * ds, qn = 0.25 * dn;
  for (let t = 0; t < S; t++) {
    const s = s0 + t * ds, sx0 = (s - qa) * dx, sz0 = (s - qa) * dz, sx1 = (s + qa) * dx, sz1 = (s + qa) * dz;
    for (let m = 0; m < Nn; m++) {
      const n = nStart + m * dn, ax = (n - qn) * px, az = (n - qn) * pz, bx = (n + qn) * px, bz = (n + qn) * pz;
      const b = blk(sx0 + ax, sz0 + az) || blk(sx0 + bx, sz0 + bz) || blk(sx1 + ax, sz1 + az) || blk(sx1 + bx, sz1 + bz);
      if (b) { re[m] = 0; im[m] = 0; D[t * Nn + m] = -1; }        // (-1: blocked, left out of the resampling)
      else D[t * Nn + m] = Math.hypot(re[m], im[m]);
    }
    fft(re, im, false);
    for (let m = 0; m < Nn; m++) { const a = re[m], b = im[m]; re[m] = a * pr[m] - b * pi[m]; im[m] = a * pi[m] + b * pr[m]; }
    fft(re, im, true);
  }
  const out = pool.out || (pool.out = new Float32Array(M * M));
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs;
    const fs = (x * dx + z * dz - s0) / ds, fn = (x * px + z * pz - nStart) / dn;
    const t0 = Math.max(0, Math.min(S - 2, Math.floor(fs))), m0 = Math.max(0, Math.min(Nn - 2, Math.floor(fn)));
    const u = Math.max(0, Math.min(1, fs - t0)), v = Math.max(0, Math.min(1, fn - m0));
    // bilinear over the open samples only (the obstacles' footprint is conservative: a wall's face keeps its wave)
    const q0 = t0 * Nn + m0, q2 = q0 + Nn, w0 = (1 - u) * (1 - v), w1 = (1 - u) * v, w2 = u * (1 - v), w3 = u * v;
    let s = 0, ws = 0;
    if (D[q0] >= 0) { s += D[q0] * w0; ws += w0; }
    if (D[q0 + 1] >= 0) { s += D[q0 + 1] * w1; ws += w1; }
    if (D[q2] >= 0) { s += D[q2] * w2; ws += w2; }
    if (D[q2 + 1] >= 0) { s += D[q2 + 1] * w3; ws += w3; }
    out[j * M + i] = ws > 1e-6 ? s / ws : 0;
  }
  return out;
}

// the build: inp from coastalInput. Returns the packed fields (see CoastalField) and timings.
export function buildCoastal(inp) {
  const T0 = Date.now();
  const { M, R, depth, osdf, blocked, bcls, comps } = inp, N = M * M, cs = 2 * R / M;
  const Nn = inp.peN ?? 512, div = inp.rayDiv ?? 2;

  // boundary cells (wet, a blocked 4-neighbour): the wall's normal (into the wall), distance to its face,
  // and its kind (2 vertical quay, 1 rubble mound, 0 natural shore)
  const bnd = [], bnx = new Float32Array(N), bnz = new Float32Array(N), bkind = new Int8Array(N).fill(-1);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i; if (blocked[k]) continue;
    let kind = -1;
    for (const q of [i > 0 ? k - 1 : -1, i < M - 1 ? k + 1 : -1, j > 0 ? k - M : -1, j < M - 1 ? k + M : -1]) if (q >= 0 && blocked[q]) kind = Math.max(kind, bcls[q]);
    if (kind < 0) continue;
    const s = (a, b) => (a >= 0 ? osdf[a] : osdf[k]) - (b >= 0 ? osdf[b] : osdf[k]);
    let gx = -s(i < M - 1 ? k + 1 : -1, i > 0 ? k - 1 : -1), gz = -s(j < M - 1 ? k + M : -1, j > 0 ? k - M : -1);
    for (const [q, ox, oz] of [[i > 0 ? k - 1 : -1, -1, 0], [i < M - 1 ? k + 1 : -1, 1, 0], [j > 0 ? k - M : -1, 0, -1], [j < M - 1 ? k + M : -1, 0, 1]]) if (q >= 0 && blocked[q]) { gx += ox * cs; gz += oz * cs; }
    const L = Math.hypot(gx, gz) || 1;
    bnx[k] = gx / L; bnz[k] = gz / L; bkind[k] = kind; bnd.push(k);
  }
  const lf = landFill(M, blocked);
  // reflection coefficient of the wall beside boundary cell k for waves of steepness s0
  const reflR = (k, s0) => {
    const kind = bkind[k];
    if (kind === 2) return 0.9;
    if (kind === 1) { const xi2 = 0.67 * 0.67 / s0; return 0.6 * xi2 / (6.6 + xi2); }
    const tn = depth[k] / Math.max(osdf[k], 0.5 * cs), xi2 = tn * tn / s0;
    return Math.min(0.9, 0.1 * xi2);
  };
  // wind-sea fetch along 24 directions (the map's edge opening on to Fedge of open water)
  const anySea = comps.some(c => c.sea), ND = 24, fet = [];
  if (anySea) for (let d = 0; d < ND; d++) {
    const a = 2 * Math.PI * d / ND, ux = Math.cos(a), uz = Math.sin(a);
    fet.push(sweep(M, R, ux, uz, new Float32Array(N), (qx, qz) => {
      const i = Math.min(M - 1, Math.max(0, Math.floor((qx + R) / cs))), j = Math.min(M - 1, Math.max(0, Math.floor((qz + R) / cs)));
      return blocked[j * M + i] ? 0 : inp.Fedge;
    }, (k, v, L) => blocked[k] ? 0 : v + L));
  }
  const tFetch = Date.now() - T0;
  const Mr = M >> 1, Nr = Mr * Mr;
  const inc = new Float32Array(comps.length * N * 4), refL = [], rIdx = new Int16Array(comps.length).fill(-1);
  const kg = new Float32Array(N), cg = new Float32Array(N), gkx = new Float32Array(N), gkz = new Float32Array(N);
  const cc = (i) => -R + (i + 0.5) * cs;
  const shortL = inp.shortL ?? 20;
  // k(h) and cg(h) are tabulated per component in log depth
  const HT = 256, lh0 = Math.log(0.05), lh1 = Math.log(400), hq = new Float32Array(N), kt = new Float64Array(HT), ct = new Float64Array(HT);
  for (let k = 0; k < N; k++) hq[k] = blocked[k] ? -1 : Math.min(HT - 1.001, (Math.log(Math.max(0.05, depth[k])) - lh0) / (lh1 - lh0) * (HT - 1));
  const tm = { fmm: 0, pe: 0, ray: 0, rest: 0 };
  // scratch reused by every component
  const seed = new Float64Array(N), SstB = new Float64Array(N), SB = new Float64Array(N), SrB = new Float64Array(N), pePool = {};
  const Ef = new Float32Array(N), Esh = new Float32Array(N), Er = new Float32Array(N), rho = new Float32Array(N), wet = new Float32Array(N), Kc = new Float32Array(N), Kr = new Float32Array(N);
  for (let ci = 0; ci < comps.length; ci++) {
    const c = comps[ci], w = c.w, dx = c.dx, dz = c.dz, sea = c.sea, s0 = sea ? 0.035 : 0.01;
    const kDeep = w * w / G, cgDeep = 0.5 * G / w, lam = 2 * Math.PI / kDeep;
    // short wind-sea waves (deep over nearly all the water) are not worth the eikonal and the rays: they keep a
    // straight phase with the local wavenumber, the local shoaling, the shelter and their fetch, and no reflection
    const full = !sea || lam >= shortL;
    let t1 = Date.now();
    for (let q = 0; q < HT; q++) { const h = Math.exp(lh0 + (lh1 - lh0) * q / (HT - 1)); kt[q] = dispK(w, h); ct[q] = groupSpeed(w, kt[q], h); }
    for (let k = 0; k < N; k++) {
      const f = hq[k]; if (f < 0) { kg[k] = 0; cg[k] = 0; continue; }
      const q = Math.floor(f), u = f - q;
      kg[k] = kt[q] + u * (kt[q + 1] - kt[q]); cg[k] = ct[q] + u * (ct[q + 1] - ct[q]);
    }
    // the incident phase on the upwave edges. What happened to the wave beyond the map is unknown: it arrives at
    // the edge travelling in its own direction with the local wavenumber, the edge's phase the integral of
    // k (d . t) along it from the upwave corner (causal: never faster than the water allows)
    seed.fill(NaN);
    const iU = dx > 1e-3 ? 0 : dx < -1e-3 ? M - 1 : -1, jU = dz > 1e-3 ? 0 : dz < -1e-3 ? M - 1 : -1;
    const iC = dx >= 0 ? 0 : M - 1, jC = dz >= 0 ? 0 : M - 1, si = dx >= 0 ? 1 : -1, sj = dz >= 0 ? 1 : -1;
    const kE = (k) => kg[k] > 0 ? kg[k] : kDeep;
    seed[jC * M + iC] = kE(jC * M + iC) * (dx * cc(iC) + dz * cc(jC));
    if (jU >= 0) for (let q = 1; q < M; q++) { const i = iC + si * q, a = jU * M + i, b = a - si; seed[a] = seed[b] + 0.5 * (kE(a) + kE(b)) * dx * si * cs; }
    if (iU >= 0) for (let q = 1; q < M; q++) { const j = jC + sj * q, a = j * M + iU, b = a - sj * M; seed[a] = seed[b] + 0.5 * (kE(a) + kE(b)) * dz * sj * cs; }
    let kOff = Infinity;                                     // the deepest water on the upwave edges
    for (let k = 0; k < N; k++) if (seed[k] === seed[k] && !blocked[k]) kOff = Math.min(kOff, kg[k]);
    if (!(kOff < Infinity)) kOff = kDeep;
    // the straight unobstructed phase (land as open water; beyond the map it continues the edge's phase back
    // along the wave): the phase of a short wave, and the detour of a diffracted one is S - Sst
    const edgeS = (qx, qz) => {
      let i = Math.min(M - 1, Math.max(0, Math.floor((qx + R) / cs))), j = Math.min(M - 1, Math.max(0, Math.floor((qz + R) / cs)));
      if (iU >= 0 && (qx < -R || qx > R)) i = iU; else if (jU >= 0 && (qz < -R || qz > R)) j = jU;
      const k = j * M + i, s = seed[k], kk = kE(k);
      return (s === s ? s : kk * (dx * cc(i) + dz * cc(j))) + kk * (dx * (qx - cc(i)) + dz * (qz - cc(j)));
    };
    const Sst = sweep(M, R, dx, dz, SstB, edgeS, (k, v, L) => v + L * (blocked[k] ? kOff : kg[k]));
    let S = Sst;
    if (full) {
      // land takes its wet neighbours' k and cg (a smooth medium for the rays crossing it)
      const { order, layer } = lf;
      for (let n = 0; n < order.length; n++) {
        const k = order[n], L = layer[k] - 1, i = k % M; let s = 0, sc = 0, m = 0;
        if (i > 0 && layer[k - 1] === L) { s += kg[k - 1]; sc += cg[k - 1]; m++; }
        if (i < M - 1 && layer[k + 1] === L) { s += kg[k + 1]; sc += cg[k + 1]; m++; }
        if (k >= M && layer[k - M] === L) { s += kg[k - M]; sc += cg[k - M]; m++; }
        if (k < N - M && layer[k + M] === L) { s += kg[k + M]; sc += cg[k + M]; m++; }
        if (m) { kg[k] = s / m; cg[k] = sc / m; } else { kg[k] = kOff; cg[k] = cgDeep; }
      }
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const k = j * M + i, i0 = Math.max(0, i - 1), i1 = Math.min(M - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(M - 1, j + 1);
        gkx[k] = (kg[j * M + i1] - kg[j * M + i0]) / ((i1 - i0) * cs);
        gkz[k] = (kg[j1 * M + i] - kg[j0 * M + i]) / ((j1 - j0) * cs);
      }
      // phase: fast marching from the upwave edges
      S = SB.fill(Infinity);
      for (let k = 0; k < N; k++) if (seed[k] === seed[k] && !blocked[k]) S[k] = seed[k];
      fmm(M, cs, kg, blocked, S);
    }
    tm.fmm += Date.now() - t1; t1 = Date.now();
    // shelter: the wide-angle march at the offshore wavenumber; for the short waves (whose diffraction the
    // march could not resolve beyond a few degrees anyway) the geometric shadow, open where the straight line
    // upwave reaches the edge of the map over water
    const Dpe = full ? shelterPE(M, R, blocked, kOff, dx, dz, Nn, pePool) : sweep(M, R, dx, dz, pePool.geo || (pePool.geo = new Float32Array(N)), (qx, qz) => {
      const i = Math.min(M - 1, Math.max(0, Math.floor((qx + R) / cs))), j = Math.min(M - 1, Math.max(0, Math.floor((qz + R) / cs)));
      return blocked[j * M + i] ? 0 : 1;
    }, (k, v) => blocked[k] ? 0 : v);
    // a wind-sea component stands for a sector of the spread sea: its shadow's edges soften over that spread
    if (sea) blur(Dpe, M, 1.5);
    tm.pe += Date.now() - t1; t1 = Date.now();
    // local wind-sea growth: JONSWAP energy of this component's bin at the effective fetch, against the
    // reference fetch the sea's amplitudes were set for (tabulated in log fetch)
    let gK = null;
    if (sea) {
      const th = Math.atan2(dz, dx), NT = 96, lf0 = Math.log(20), lf1 = Math.log(300000), tab = new Float32Array(NT);
      const E0 = Math.max(1e-12, binEnergy(c.fa, c.fb, inp.U, inp.Fref));
      for (let q = 0; q < NT; q++) tab[q] = Math.sqrt(binEnergy(c.fa, c.fb, inp.U, Math.exp(lf0 + (lf1 - lf0) * q / (NT - 1))) / E0);
      const wd = [], ww = [];
      for (let d = 0; d < ND; d++) { let a = 2 * Math.PI * d / ND - th; a -= 2 * Math.PI * Math.round(a / (2 * Math.PI)); if (Math.abs(a) < 50 * Math.PI / 180) { wd.push(fet[d]); ww.push(Math.cos(a) ** 2); } }
      const ws = ww.reduce((s, x) => s + x, 0), nw = wd.length;
      for (let q = 0; q < nw; q++) ww[q] /= ws;
      gK = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        if (blocked[k]) continue;
        let F = 0; for (let q = 0; q < nw; q++) F += ww[q] * wd[q][k];
        const f = (Math.log(Math.max(20, F)) - lf0) / (lf1 - lf0) * (NT - 1), q = Math.min(NT - 2, Math.max(0, Math.floor(f))), u = Math.min(1, f - q);
        gK[k] = F < 1 ? 0 : tab[q] * (1 - u) + tab[q + 1] * u;
      }
    }
    // the incident energy factor at each cell from shelter and growth (reflection starts from it)
    const fac = (k) => { const d = Dpe[k]; return sea ? Math.max(gK[k], d) : d; };
    // the unobstructed amplitude: shoaling Ks = sqrt(cg0 / cg) times refraction, the ray tubes' narrowing
    // rho = b0 / b (1 for the short waves)
    Ef.fill(0); Esh.fill(0); Er.fill(0);
    if (full) {
      // rays: energy flux F = E cg b conserved; the energy of a cell is the sum over the rays crossing it of
      // F ds / (cg area). They enter along the upwave edges (a ray every b0 of edge carries the deep-water flux
      // through b0 |d . n|), run straight until inside the map, and straight over land unhindered; the first wall
      // a ray meets (while it has crossed no land) reflects a ray of flux R^2 F (times the shelter there),
      // traced until its second wall.
      // (one ray per cell where the refraction factor is to be smoothed over two cells or more anyway)
      const sg = Math.min(6, Math.max(0.7, 0.5 * Math.sqrt(lam * 1000) / cs));
      const b0 = cs / (sg >= 2 ? 1 : div), ds = cs / div, lim = R + 2 * cs, area = cs * cs, queue = [], ic = 1 / cs;
      const splat = (E, fx, fz, v) => {
        const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, t = fz - j;
        if (j >= 0 && j < M) { if (i >= 0 && i < M) E[j * M + i] += v * (1 - u) * (1 - t); if (i + 1 >= 0 && i + 1 < M) E[j * M + i + 1] += v * u * (1 - t); }
        if (j + 1 >= 0 && j + 1 < M) { if (i >= 0 && i < M) E[(j + 1) * M + i] += v * (1 - u) * t; if (i + 1 >= 0 && i + 1 < M) E[(j + 1) * M + i + 1] += v * u * t; }
      };
      const cellOf = (x, z) => { let i = Math.floor((x + R) * ic), j = Math.floor((z + R) * ic); i = i < 0 ? 0 : i >= M ? M - 1 : i; j = j < 0 ? 0 : j >= M ? M - 1 : j; return j * M + i; };
      const trace = (x, z, ux, uz, F, bounce, E) => {
        const free = E === Ef;
        let crossed = false, prev = -1;
        for (let st = 0; st < 4 * M * div; st++) {
          x += ux * ds; z += uz * ds;
          if ((x < -lim && ux <= 0) || (x > lim && ux >= 0) || (z < -lim && uz <= 0) || (z > lim && uz >= 0)) break;
          const k = cellOf(x, z);
          if (blocked[k]) {
            if (!crossed && prev >= 0 && bkind[prev] >= 0 && bounce < 2) {
              const Rc = reflR(prev, s0), nx = bnx[prev], nz = bnz[prev], un = ux * nx + uz * nz;
              // (the incident wave's shelter and growth taken two cells out from the wall)
              if (Rc >= 0.15 && un > 0) queue.push([x - ux * ds, z - uz * ds, ux - 2 * un * nx, uz - 2 * un * nz, F * Rc * Rc * (free ? fac(cellOf(x - 2 * cs * ux, z - 2 * cs * uz)) ** 2 : 1), bounce + 1]);
            }
            if (!free) return;                        // a reflected ray ends at its next wall
            crossed = true; continue;                 // the unobstructed ray runs on, straight
          }
          const inside = x > -R && x < R && z > -R && z < R;
          prev = inside ? k : -1;
          // one set of bilinear weights for k, grad k and cg
          const fx = (x + R) * ic - 0.5, fz = (z + R) * ic - 0.5;
          let i = Math.floor(fx), j = Math.floor(fz); const u = fx - i, t = fz - j;
          const i0 = i < 0 ? 0 : i >= M ? M - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 >= M ? M - 1 : i + 1, j0 = j < 0 ? 0 : j >= M ? M - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 >= M ? M - 1 : j + 1;
          const a = j0 * M + i0, b = j0 * M + i1, e = j1 * M + i0, h = j1 * M + i1, wa = (1 - u) * (1 - t), wb = u * (1 - t), we = (1 - u) * t, wh = u * t;
          if (inside) {
            // Snell in differential form: the ray turns toward larger k (slower water) at dtheta/ds = (grad k . n) / k
            const kk = kg[a] * wa + kg[b] * wb + kg[e] * we + kg[h] * wh;
            const turn = ds * ((gkz[a] * wa + gkz[b] * wb + gkz[e] * we + gkz[h] * wh) * ux - (gkx[a] * wa + gkx[b] * wb + gkx[e] * we + gkx[h] * wh) * uz) / kk;
            const nx = ux - uz * turn, nz = uz + ux * turn, L = Math.hypot(nx, nz); ux = nx / L; uz = nz / L;
          }
          const v = F * ds / ((cg[a] * wa + cg[b] * wb + cg[e] * we + cg[h] * wh) * area);
          splat(E, fx, fz, v);
          if (crossed && free) splat(Esh, fx, fz, v);
        }
      };
      // along each upwave edge, from 1.5 cells outside (so the edge row of cells is filled like any other)
      if (jU >= 0) { const z = jU ? R + 1.5 * cs : -R - 1.5 * cs, F = cgDeep * b0 * Math.abs(dz); for (let x = -R - 2 * cs + b0 / 2; x < R + 2 * cs; x += b0) trace(x, z, dx, dz, F, 0, Ef); }
      if (iU >= 0) { const x = iU ? R + 1.5 * cs : -R - 1.5 * cs, F = cgDeep * b0 * Math.abs(dx); for (let z = -R - 2 * cs + b0 / 2; z < R + 2 * cs; z += b0) trace(x, z, dx, dz, F, 0, Ef); }
      for (let q = 0; q < queue.length; q++) { const [x, z, ux, uz, F, b] = queue[q]; trace(x, z, ux, uz, F, b, Er); }
      // refraction's ray-tube factor, smoothed over the Fresnel scale 0.5 sqrt(lambda 1 km): a ray caustic is a
      // singularity no real (spectrally spread) sea shows; the shoaling stays local
      // (over the water only: land's cells hold no rays' energy)
      for (let k = 0; k < N; k++) { wet[k] = blocked[k] ? 0 : 1; rho[k] = blocked[k] ? 0 : Math.min(6, Ef[k] * cg[k] / cgDeep); }
      blur(rho, M, sg); blur(wet, M, sg);
      for (let k = 0; k < N; k++) rho[k] = wet[k] > 1e-3 ? rho[k] / wet[k] : 1;
    } else rho.fill(1);
    tm.ray += Date.now() - t1; t1 = Date.now();
    // amplitude: unobstructed (refraction x shoaling) x shelter x wind-sea growth
    const base = ci * N * 4; Kc.fill(0);
    for (let k = 0; k < N; k++) {
      if (blocked[k]) continue;
      const Kf = Math.min(KCAP, Math.sqrt(Math.min(3, rho[k]) * cgDeep / cg[k]));
      // in the rays' shadow: the larger of the march and the single edge. The edge term is Sommerfeld's
      // incident term exactly (sigma^2 = 2 dS / pi = (4 k r / pi) sin^2(beta / 2)) at any angle; the march, a
      // Rayleigh-Sommerfeld propagation, loses ~cos(beta) at wide angles but alone sees a second edge (the
      // shadow of a rock heals, a harbour entrance spreads its beam)
      let D = Math.min(1.25, Dpe[k]);
      const shd = full ? (Ef[k] > 0 ? Esh[k] / Ef[k] : 1) : 0;
      if (shd > 0.3 && S[k] < Infinity) {
        const Dw = fresnelEdge(-Math.sqrt(2 * Math.max(0, S[k] - Sst[k]) / Math.PI));
        D += smooth(0.3, 0.7, shd) * Math.max(0, Dw - D);
      }
      Kc[k] = Kf * (sea ? Math.max(gK[k], D) : D);
    }
    writePlanes(inc, base, M, R, blocked, lf, S, Sst, Kc, dx, dz, kOff);
    // the reflected wave: phase by fast marching from the struck walls (image path to the face), amplitude
    // from the reflected rays; kept at half resolution
    let Kmax = 0; for (let k = 0; k < N; k++) Kmax = Math.max(Kmax, Er[k]);
    if (full && Kmax > 4e-4) {
      const Sr = SrB.fill(Infinity); let ns = 0;
      for (const k of bnd) {
        if (!(S[k] < Infinity) || Kc[k] < 0.05 || reflR(k, s0) < 0.15) continue;
        const gx = gradAt(S, M, cs, blocked, k, 0), gz = gradAt(S, M, cs, blocked, k, 1), gn = gx * bnx[k] + gz * bnz[k];
        if (gn <= 0.1 * Math.hypot(gx, gz)) continue;
        Sr[k] = S[k] + 2 * gn * Math.max(0, osdf[k]); ns++;
      }
      if (ns) {
        fmm(M, cs, kg, blocked, Sr);
        for (let k = 0; k < N; k++) Kr[k] = Sr[k] < Infinity ? Math.min(2, Math.sqrt(Er[k])) : 0;
        const lay = new Float32Array(Nr * 4);
        halfPlanes(lay, M, R, blocked, Sr, Kr, -kOff * dx, -kOff * dz);
        rIdx[ci] = refL.length; refL.push(lay);
      }
    }
    tm.rest += Date.now() - t1;
  }
  const ref = new Float32Array(Math.max(1, refL.length) * Nr * 4), rMask = new Uint8Array(Nr);
  refL.forEach((l, q) => { ref.set(l, q * Nr * 4); for (let k = 0; k < Nr; k++) if (l[k * 4 + 3] > 0) rMask[k] = 255; });
  return { M, R, n: comps.length, inc, Mr, nr: refL.length, ref, rIdx, rMask, ms: Date.now() - T0, tm: { fetch: tFetch, ...tm } };
}
export const fieldTransfer = (f) => [f.inc.buffer, f.ref.buffer, f.rIdx.buffer, f.rMask.buffer];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// separable Gaussian blur in place (sigma in cells, clamped at the edges)
function blur(a, M, sig) {
  const r = Math.ceil(2.5 * sig), w = new Float64Array(2 * r + 1), t = new Float32Array(M * M);
  let ws = 0; for (let q = -r; q <= r; q++) ws += (w[q + r] = Math.exp(-q * q / (2 * sig * sig)));
  for (let q = 0; q <= 2 * r; q++) w[q] /= ws;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0; for (let q = -r; q <= r; q++) s += w[q + r] * a[j * M + Math.min(M - 1, Math.max(0, i + q))]; t[j * M + i] = s; }
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { let s = 0; for (let q = -r; q <= r; q++) s += w[q + r] * t[Math.min(M - 1, Math.max(0, j + q)) * M + i]; a[j * M + i] = s; }
}
// one component of grad S at k (central where both neighbours are known, one-sided where one is)
function gradAt(S, M, cs, blocked, k, axis) {
  const i = k % M, j = (k / M) | 0, st = axis ? M : 1, lo = axis ? j > 0 : i > 0, hi = axis ? j < M - 1 : i < M - 1;
  const a = lo && !blocked[k - st] && S[k - st] < Infinity ? S[k - st] : NaN, b = hi && !blocked[k + st] && S[k + st] < Infinity ? S[k + st] : NaN;
  if (a === a && b === b) return (b - a) / (2 * cs);
  if (b === b) return (b - S[k]) / cs;
  if (a === a) return (S[k] - a) / cs;
  return NaN;
}
// tangent planes (P = S - G.x, G) and K into a layer; cells the march never reached take the straight phase,
// land takes the plane of its most exposed wet neighbour and the least amplitude of them (a breakwater's lee
// stays calm right up to the wall), filled outward a few cells
function writePlanes(out, base, M, R, blocked, lf, S, Sst, K, dx, dz, kref) {
  const N = M * M, cs = 2 * R / M;
  for (let k = 0; k < N; k++) {
    if (blocked[k]) continue;
    const reach = S[k] < Infinity, A = reach ? S : Sst;
    let gx = gradAt(A, M, cs, blocked, k, 0), gz = gradAt(A, M, cs, blocked, k, 1);
    if (!(gx === gx)) gx = kref * dx; if (!(gz === gz)) gz = kref * dz;
    const x = -R + (k % M + 0.5) * cs, z = -R + (((k / M) | 0) + 0.5) * cs, o = base + k * 4;
    out[o] = A[k] - gx * x - gz * z; out[o + 1] = gx; out[o + 2] = gz; out[o + 3] = K[k];
  }
  const { order, layer } = lf, gx0 = kref * dx, gz0 = kref * dz;
  for (let n = 0; n < order.length; n++) {
    const k = order[n], L = layer[k] - 1, i = k % M, o = base + k * 4;
    let best = -1, kmin = Infinity;
    for (let e = 0; e < 4; e++) {
      const q = e === 0 ? (i > 0 ? k - 1 : -1) : e === 1 ? (i < M - 1 ? k + 1 : -1) : e === 2 ? (k >= M ? k - M : -1) : (k < N - M ? k + M : -1);
      if (q < 0 || layer[q] !== L) continue;
      const Kq = out[base + q * 4 + 3]; if (best < 0 || Kq > out[base + best * 4 + 3]) best = q; if (Kq < kmin) kmin = Kq;
    }
    if (best < 0) { out[o] = 0; out[o + 1] = gx0; out[o + 2] = gz0; out[o + 3] = 0; continue; }
    const b = base + best * 4;
    out[o] = out[b]; out[o + 1] = out[b + 1]; out[o + 2] = out[b + 2]; out[o + 3] = kmin;
  }
}
// land cells in order of their distance from the water (4-neighbour layers, 8 deep): what fills them from what
function landFill(M, blocked) {
  const N = M * M, layer = new Int8Array(N), order = [];
  for (let k = 0; k < N; k++) layer[k] = blocked[k] ? 127 : 0;
  let front = [];
  for (let k = 0; k < N; k++) if (!blocked[k]) front.push(k);
  for (let L = 1; L <= 8 && front.length; L++) {
    const next = [];
    for (const k of front) {
      const i = k % M;
      for (const q of [i > 0 ? k - 1 : -1, i < M - 1 ? k + 1 : -1, k >= M ? k - M : -1, k < N - M ? k + M : -1]) if (q >= 0 && layer[q] === 127) { layer[q] = L; next.push(q); order.push(q); }
    }
    front = next;
  }
  for (let k = 0; k < N; k++) if (layer[k] === 127) order.push(k);      // (beyond: the defaults)
  return { order: Int32Array.from(order), layer };
}
// reflected planes at half resolution: the phase at the coarse centre from its known fine cells' planes
function halfPlanes(out, M, R, blocked, S, K, gx0, gz0) {
  const Mr = M >> 1, cs = 2 * R / M, csr = 2 * cs, ok = new Uint8Array(Mr * Mr);
  for (let J = 0; J < Mr; J++) for (let I = 0; I < Mr; I++) {
    const xc = -R + (I + 0.5) * csr, zc = -R + (J + 0.5) * csr;
    let n = 0, sx = 0, sz = 0, sS = 0, e = 0, nw = 0;
    for (let b = 0; b < 4; b++) {
      const i = 2 * I + (b & 1), j = 2 * J + (b >> 1), k = j * M + i;
      if (!blocked[k]) { e += K[k] * K[k]; nw++; }
      if (blocked[k] || !(S[k] < Infinity) || !(K[k] > 0)) continue;
      const gx = gradAt(S, M, cs, blocked, k, 0), gz = gradAt(S, M, cs, blocked, k, 1);
      if (!(gx === gx) || !(gz === gz)) continue;
      const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs;
      sx += gx; sz += gz; sS += S[k] + gx * (xc - x) + gz * (zc - z); n++;
    }
    const o = (J * Mr + I) * 4;
    if (!n) continue;
    sx /= n; sz /= n; sS /= n;
    out[o] = sS - sx * xc - sz * zc; out[o + 1] = sx; out[o + 2] = sz; out[o + 3] = Math.sqrt(e / nw); ok[J * Mr + I] = 1;
  }
  // the unknown texels take their neighbours' planes, with no amplitude in open water (clean bilinear blending at
  // the reflected wave's edge) and the neighbour's on land (it holds up to the wall)
  for (let pass = 0; pass < 3; pass++) {
    const N = Mr * Mr; let any = false;
    for (let k = 0; k < N; k++) {
      if (ok[k]) continue;
      const i = k % Mr;
      for (const q of [i > 0 ? k - 1 : -1, i < Mr - 1 ? k + 1 : -1, k >= Mr ? k - Mr : -1, k < N - Mr ? k + Mr : -1]) {
        if (q < 0 || ok[q] !== 1) continue;
        const I = k % Mr, J = (k / Mr) | 0, dry = blocked[2 * J * M + 2 * I] && blocked[2 * J * M + 2 * I + 1] && blocked[(2 * J + 1) * M + 2 * I] && blocked[(2 * J + 1) * M + 2 * I + 1];
        out[k * 4] = out[q * 4]; out[k * 4 + 1] = out[q * 4 + 1]; out[k * 4 + 2] = out[q * 4 + 2]; out[k * 4 + 3] = dry && !pass ? out[q * 4 + 3] : 0; ok[k] = 2; any = true; break;
      }
    }
    for (let k = 0; k < N; k++) if (ok[k] === 2) ok[k] = 1;
    if (!any) break;
  }
  // beyond: no reflected wave, and a plane that is at least a wave (no zero wavevector to divide by)
  for (let k = 0; k < Mr * Mr; k++) if (!ok[k]) { out[k * 4] = 0; out[k * 4 + 1] = gx0; out[k * 4 + 2] = gz0; out[k * 4 + 3] = 0; }
}

// ---------- runtime lookups (WaveField.sample; the water shader reads the same arrays as textures) ----------
// Texel centres at -R + (i + 1/2) cs, bilinear with clamp-to-edge: exactly what the GPU's linear filter reads.
export class CoastalField {
  constructor(f) {
    this.M = f.M; this.R = f.R; this.n = f.n; this.Mr = f.Mr; this.nr = f.nr;
    this.incA = f.inc; this.refA = f.ref; this.rIdx = f.rIdx; this.rMask = f.rMask; this.ms = f.ms; this.tm = f.tm;
    this.cs = 2 * f.R / f.M; this.csr = 2 * f.R / f.Mr; this.N = f.M * f.M; this.Nr = f.Mr * f.Mr;
    this.w = new Float64Array(4); this.o = new Int32Array(4); this.wr = new Float64Array(4); this.or = new Int32Array(4);
    this.hasR = false;
    this.p = 0; this.gx = 0; this.gz = 0; this.k = 0;
  }
  _corners(x, z, M, cs, w, o) {
    const fx = (x + this.R) / cs - 0.5, fz = (z + this.R) / cs - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const i0 = i < 0 ? 0 : i > M - 1 ? M - 1 : i, i1 = i + 1 < 0 ? 0 : i + 1 > M - 1 ? M - 1 : i + 1;
    const j0 = j < 0 ? 0 : j > M - 1 ? M - 1 : j, j1 = j + 1 < 0 ? 0 : j + 1 > M - 1 ? M - 1 : j + 1;
    o[0] = (j0 * M + i0) * 4; o[1] = (j0 * M + i1) * 4; o[2] = (j1 * M + i0) * 4; o[3] = (j1 * M + i1) * 4;
    w[0] = (1 - u) * (1 - v); w[1] = u * (1 - v); w[2] = (1 - u) * v; w[3] = u * v;
  }
  // set up the texels around (x, z)
  at(x, z) {
    this.x = x; this.z = z;
    this._corners(x, z, this.M, this.cs, this.w, this.o);
    this.hasR = false;
    if (this.nr) {
      this._corners(x, z, this.Mr, this.csr, this.wr, this.or);
      const m = this.rMask, or = this.or, wr = this.wr;
      this.hasR = (m[or[0] >> 2] && wr[0] > 0) || (m[or[1] >> 2] && wr[1] > 0) || (m[or[2] >> 2] && wr[2] > 0) || (m[or[3] >> 2] && wr[3] > 0);
    }
    return this;
  }
  _blend(a, base, w, o) {
    const a0 = base + o[0], a1 = base + o[1], a2 = base + o[2], a3 = base + o[3];
    const P = a[a0] * w[0] + a[a1] * w[1] + a[a2] * w[2] + a[a3] * w[3];
    this.gx = a[a0 + 1] * w[0] + a[a1 + 1] * w[1] + a[a2 + 1] * w[2] + a[a3 + 1] * w[3];
    this.gz = a[a0 + 2] * w[0] + a[a1 + 2] * w[1] + a[a2 + 2] * w[2] + a[a3 + 2] * w[3];
    this.k = a[a0 + 3] * w[0] + a[a1 + 3] * w[1] + a[a2 + 3] * w[2] + a[a3 + 3] * w[3];
    this.P = P; this.p = P + this.gx * this.x + this.gz * this.z;
  }
  // component ci at the point set up: phase p (without the time term), wavevector (gx, gz), amplitude factor k
  inc(ci) { this._blend(this.incA, ci * this.N * 4, this.w, this.o); return this; }
  // its reflected wave; false where there is none
  ref(ci) {
    const l = this.rIdx[ci]; if (l < 0 || !this.hasR) return false;
    this._blend(this.refA, l * this.Nr * 4, this.wr, this.or); return true;
  }
}
