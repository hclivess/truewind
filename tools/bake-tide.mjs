// Tidal streams: a depth-averaged 2-D shallow-water model of each venue's waters, forced at its open boundaries
// by the harmonic tide, run through a spring-neap cycle and analysed into per-constituent stream maps.
//   ∂η/∂t + ∇·(H u) = 0,   ∂u/∂t + (u·∇)u + f k×u = −g ∇η − g n² |u| u / H^{4/3}
// Arakawa C-grid on a rectilinear grid (fine over the sailing area, stretched outward), forward-backward in time
// (momentum with the old η, continuity with the new velocities), first-order upwind momentum advection, quadratic
// (Manning) friction implicit, Coriolis from the averaged cross velocity. Wetting and drying after Stelling &
// Duinmeijer (2003): the flux through a face carries the upwind water depth over the face's (higher) bed, so a cell
// can empty but never go negative, and a face with under 5 cm of water is dry.
// Open boundaries: water level from the tide gauges' constants (inverse-distance blend of the side's anchor gauges,
// all constituents with their nodal factors), ramped in over 12 h. A short run first calibrates the boundary
// constituents (one complex factor per species and anchor) so the model's tide at the reference gauges matches
// theirs; the full run (1.2 days spin-up + 15.5 days analysed, which separates M2 / S2 and K1 / O1) is then fitted by
// least squares, per cell, for the mean flow and the constituents M2, S2, K1, O1, M4, MS4, M6 — each carrying its
// smaller neighbours by inference (N2, ν2, 2N2, L2 with M2; K2, T2 with S2; P1, J1 with K1; Q1 with O1; MN4 with M4;
// 2MS6 with M6) in the ratios and phase offsets of the reference gauge.
// Output: data/venues/<id>.tide.json `streams` (Int8 cos/sin coefficients per constituent and component on a regular
// grid over the venue; see js/tide.js TideStreams) and `model` (the run's settings and its validation).
// Usage: node tools/bake-tide.mjs [venueId...] [--days 15.5] [--noquick]
import { VENUES, makeProjection, MAP_RADIUS } from '../js/world.js';
import { args, TideStation, constituentName } from '../js/tide.js';
import { sample, z0Field } from './bathy-src.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const G = 9.81, D2R = Math.PI / 180;
const SPONGE = 6, VMAX = 5;                       // sponge width (cells); a velocity no tide here reaches (a guard, m/s)
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d; };
const DAYS = opt('--days', 15.5), SPIN = opt('--spin', 1.2), CALN = opt('--cal', 2), CALD = opt('--caldays', 2.6);

// model domains (lat/lon box), grid (fine cell size over the fine box, growth outward, largest cell), Manning n,
// and open boundaries: per side the anchor gauges and where along the side it is open (lat or lon range).
// cal: anchor -> the gauge whose tide calibrates it.
// (one anchor set for every open side, so the forced level is smooth round the corners: a step there drives a jet)
const SOLENT_BC = ['Bournemouth', 'Swanage', 'Sandown', 'Portsmouth'];
export const MODELS = {
  solent: { box: [-1.626, 50.555, -0.944, 50.989], dx: 200, n: 0.024, date: '2026-06-01',
    cal: { Bournemouth: 'Lymington', Swanage: 'Lymington', Sandown: 'Portsmouth', Portsmouth: 'Portsmouth' },
    sides: { W: { a: SOLENT_BC }, E: { a: SOLENT_BC }, S: { a: SOLENT_BC } },
    check: [['Hurst Narrows', 50.7055, -1.5465], ['Needles Channel', 50.672, -1.575], ['Yarmouth Roads', 50.712, -1.49], ['Cowes (Egypt Pt)', 50.772, -1.31], ['Bramble Bank', 50.79, -1.29], ['Calshot', 50.815, -1.305], ['Spithead', 50.76, -1.10], ['Portsmouth entrance', 50.793, -1.108]] },
  sfbay: { box: [-122.80, 37.43, -121.95, 38.15], fine: [-122.515, 37.765, -122.335, 37.88], dx: 150, grow: 1.08, dmax: 700, n: 0.022, date: '2026-06-01',
    cal: { 'Point Reyes': 'San Francisco (Presidio)', 'Pillar Point Harbor': 'San Francisco (Presidio)' },
    sides: { W: { a: ['Point Reyes', 'Pillar Point Harbor'] }, N: { a: ['Point Reyes', 'Pillar Point Harbor'], lon: [-123, -122.62] }, S: { a: ['Point Reyes', 'Pillar Point Harbor'], lon: [-123, -122.52] }, E: { a: ['Port Chicago'], lat: [37.99, 38.13] } },
    check: [['Golden Gate Bridge', 37.8125, -122.4775], ['Point Bonita', 37.815, -122.53], ['Alcatraz N', 37.83, -122.42], ['Raccoon Strait', 37.868, -122.445], ['Blossom Rock', 37.818, -122.40], ['Anita Rock (City Front)', 37.807, -122.44]] },
  newport: { box: [-71.52, 41.33, -71.10, 41.84], fine: [-71.44, 41.42, -71.28, 41.54], dx: 120, grow: 1.08, dmax: 500, n: 0.024, date: '2026-06-01',
    cal: { 'Point Judith': 'Newport', Sakonnet: 'Newport' },
    sides: { S: { a: ['Point Judith', 'Sakonnet'] }, W: { a: ['Point Judith', 'Sakonnet'], lat: [41.30, 41.38] }, E: { a: ['Point Judith', 'Sakonnet'], lat: [41.30, 41.46] } },
    check: [['East Passage (Rose I.)', 41.495, -71.345], ['Newport Harbor ent.', 41.487, -71.33], ['West Passage (Dutch I.)', 41.50, -71.40], ['Castle Hill', 41.462, -71.36]] },
  sydney: { box: [151.00, -33.93, 151.36, -33.74], fine: [151.17, -33.875, 151.30, -33.80], dx: 80, grow: 1.08, dmax: 500, n: 0.025, date: '2026-06-01',
    cal: { 'Fort Denison': 'Fort Denison' },
    sides: { E: { a: ['Fort Denison'] }, N: { a: ['Fort Denison'], lon: [151.29, 152] }, S: { a: ['Fort Denison'], lon: [151.265, 152] } },
    check: [['The Heads', -33.832, 151.285], ['Bradleys Head', -33.853, 151.245], ['Harbour Bridge', -33.852, 151.211], ['Middle Harbour ent.', -33.822, 151.265]] },
  auckland: { box: [174.55, -36.95, 175.02, -36.68], fine: [174.74, -36.87, 174.90, -36.77], dx: 100, grow: 1.08, dmax: 600, n: 0.025, date: '2026-06-01',
    cal: { 'Auckland (Waitematā)': 'Auckland (Waitematā)' },
    sides: { N: { a: ['Auckland (Waitematā)'] }, E: { a: ['Auckland (Waitematā)'] }, S: { a: ['Auckland (Waitematā)'], lon: [174.92, 176] } },
    check: [['Rangitoto Channel', -36.80, 174.84], ['North Head', -36.83, 174.815], ['Harbour Bridge', -36.832, 174.745], ['Tamaki Strait', -36.85, 174.9]] },
  progreso: { box: [-89.765, 21.21, -89.57, 21.42], dx: 250, n: 0.028, date: '2026-06-01',
    cal: {},
    sides: { N: { a: ['Progreso', 'Sisal', 'Telchac'] }, W: { a: ['Sisal', 'Progreso'], lat: [21.30, 22] }, E: { a: ['Telchac', 'Progreso'], lat: [21.30, 22] } },
    check: [['Pier head', 21.345, -89.668], ['Off Chelem', 21.29, -89.74]] },
};
// fitted constituents and the ones each carries by inference
const GROUPS = { M2: ['N2', 'NU2', '2N2', 'L2'], S2: ['K2', 'T2'], K1: ['P1', 'J1'], O1: ['Q1'], M4: ['MN4'], MS4: [], M6: ['2MS6'] };
const SPECIES = (n) => /^(M2|S2|N2|K2|NU2|2N2|L2|T2|MU2|LAM2|R2|MKS2|EP2|MA2|MB2|2SM2|MSN2)$/.test(n) ? 2 : /^(K1|O1|P1|Q1|J1|OO1|2Q1|RHO|M1|S1|SGM)$/.test(n) ? 1 : /^(M4|MS4|MN4|S4|MK4|N4)$/.test(n) ? 4 : /^(M6|2MS6|2MN6|S6|MSK6)$/.test(n) ? 6 : /^(M3|MK3|2MK3|MO3|SO3|SK3|S3)$/.test(n) ? 3 : /^(M8)$/.test(n) ? 8 : 0;

// ---------------------------------------------------------------------------------------------------- grid
function axis(lo, hi, flo, fhi, dx, grow, dmax) {
  // edges: uniform dx over [flo, fhi], cells growing by `grow` (up to dmax) outward to lo and hi
  const n = Math.max(1, Math.round((fhi - flo) / dx)), e = [];
  for (let i = 0; i <= n; i++) e.push(flo + (fhi - flo) * i / n);
  let d = dx, x = flo; const left = [];
  while (x > lo + 1) { d = Math.min(dmax, d * grow); x = Math.max(lo, x - d); if (x - lo < d * 0.5) x = lo; left.push(x); }
  d = dx; x = fhi; const right = [];
  while (x < hi - 1) { d = Math.min(dmax, d * grow); x = Math.min(hi, x + d); if (hi - x < d * 0.5) x = hi; right.push(x); }
  return [...left.reverse(), ...e, ...right];
}

class Model {
  constructor(v, M, gauges) {
    this.v = v; this.M = M; this.P = makeProjection(v.lat, v.lon);
    const [lw, ls, le, ln] = M.box, P = this.P;
    const [X0] = P.fwd(v.lat, lw), [X1] = P.fwd(v.lat, le), [, Z0] = P.fwd(ln, v.lon), [, Z1] = P.fwd(ls, v.lon);
    let fx0 = X0, fx1 = X1, fz0 = Z0, fz1 = Z1;
    if (M.fine) { [fx0] = P.fwd(v.lat, M.fine[0]); [fx1] = P.fwd(v.lat, M.fine[2]); [, fz0] = P.fwd(M.fine[3], v.lon); [, fz1] = P.fwd(M.fine[1], v.lon); }
    this.xe = axis(X0, X1, fx0, fx1, M.dx, M.grow ?? 1, M.dmax ?? M.dx);
    this.ze = axis(Z0, Z1, fz0, fz1, M.dx, M.grow ?? 1, M.dmax ?? M.dx);
    this.nx = this.xe.length - 1; this.nz = this.ze.length - 1;
    this.xc = Float64Array.from({ length: this.nx }, (_, i) => (this.xe[i] + this.xe[i + 1]) / 2);
    this.zc = Float64Array.from({ length: this.nz }, (_, j) => (this.ze[j] + this.ze[j + 1]) / 2);
    this.gauges = gauges;
    this.f = 2 * 7.2921e-5 * Math.sin(v.lat * D2R);
  }
  async bathy() {
    const { nx, nz, xc, zc } = this;
    // (coarse cells: the mean depth of a 3×3 sub-sampling of the cell)
    const sub = 3, xs = [], zs = [];
    for (let i = 0; i < nx; i++) for (let a = 0; a < sub; a++) xs.push(this.xe[i] + (a + 0.5) / sub * (this.xe[i + 1] - this.xe[i]));
    for (let j = 0; j < nz; j++) for (let b = 0; b < sub; b++) zs.push(this.ze[j] + (b + 0.5) / sub * (this.ze[j + 1] - this.ze[j]));
    const ref = this.gauges.find(g => g.navd !== undefined);
    const r = await sample(this.v, { xs, zs }, { z0At: z0Field(this.gauges), navd: ref ? ref.navd : 0, px: Math.max(25, this.M.dx / 3) });
    this.source = r.source;
    const h = new Float64Array(nx * nz), W = xs.length;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0, wet = 0;
      for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) { const d = r.data[(j * sub + b) * W + i * sub + a] / 10; s += d; if (d > 0) wet++; }
      h[j * nx + i] = s / (sub * sub);
      if (wet >= 5 && h[j * nx + i] < 0.3) h[j * nx + i] = 0.3;          // a mostly wet cell stays wet at MSL
    }
    this.h = h;
  }
  setup() {
    const { nx, nz, h } = this, N = nx * nz, M = this.M;
    const hat = Math.max(...this.gauges.map(g => g.cons.filter(c => SPECIES(constituentName(c[0]))).reduce((s, c) => s + c[1], 0)));
    this.hat = hat;
    // water: below the highest tide (plus a margin); edge cells that are water on an open side: boundary
    const mask = new Uint8Array(N);
    for (let k = 0; k < N; k++) mask[k] = h[k] > -hat - 0.3 ? 1 : 0;
    const P = this.P, sides = M.sides || {};
    const openAt = (side, i, j) => {
      const s = sides[side]; if (!s) return null;
      const [lat, lon] = P.inv(this.xc[i], this.zc[j]);
      if (s.lon && (lon < s.lon[0] || lon > s.lon[1])) return null;
      if (s.lat && (lat < s.lat[0] || lat > s.lat[1])) return null;
      return s.a;
    };
    this.bc = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!mask[k] || h[k] < 0.5) continue;
      const side = i === 0 ? 'W' : i === nx - 1 ? 'E' : j === 0 ? 'N' : j === nz - 1 ? 'S' : null;
      if (!side) continue;
      const a = openAt(side, i, j); if (!a) continue;
      mask[k] = 2; this.bc.push({ k, x: this.xc[i], z: this.zc[j], anchors: a });
    }
    // remove water not connected to an open boundary (ponds, lagoons behind a closed edge)
    const seen = new Uint8Array(N), q = this.bc.map(b => b.k); for (const k of q) seen[k] = 1;
    while (q.length) { const k = q.pop(), i = k % nx, j = (k / nx) | 0; for (const [ii, jj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const kk = jj * nx + ii; if (mask[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); } } }
    for (let k = 0; k < N; k++) if (!seen[k]) mask[k] = 0;
    // the outer ring is either open boundary or wall
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if ((i === 0 || j === 0 || i === nx - 1 || j === nz - 1) && mask[j * nx + i] === 1) mask[j * nx + i] = 0;
    this.mask = mask;
    // active lists
    const cells = [], uf = [], vf = [];
    for (let k = 0; k < N; k++) if (mask[k] === 1) cells.push(k);
    // (faces between two boundary cells carry nothing: both levels are imposed)
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx - 1; i++) { const k = j * nx + i; if (mask[k] && mask[k + 1] && !(mask[k] === 2 && mask[k + 1] === 2)) uf.push(k); }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (mask[k] && mask[k + nx] && !(mask[k] === 2 && mask[k + nx] === 2)) vf.push(k); }
    this.cells = Int32Array.from(cells); this.uf = Int32Array.from(uf); this.vf = Int32Array.from(vf);
    // cells from the open boundary (the sponge: a gauge-interpolated boundary is never quite the real sea's, so the
    // velocities along it are damped over SPONGE cells rather than left to reflect and run as edge jets)
    const dist = new Uint16Array(N).fill(65535), dq = this.bc.map(b => b.k); for (const k of dq) dist[k] = 0;
    for (let qh = 0; qh < dq.length; qh++) { const k = dq[qh], i = k % nx, j = (k / nx) | 0; for (const [ii, jj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const kk = jj * nx + ii; if (mask[kk] && dist[kk] === 65535) { dist[kk] = dist[k] + 1; dq.push(kk); } } }
    this.dist = dist;
    this.eta = new Float64Array(N); this.U = new Float64Array(N); this.V = new Float64Array(N);
    for (let k = 0; k < N; k++) if (mask[k]) this.eta[k] = Math.max(0, -h[k]);    // (dry banks start dry)
    for (let k = 0; k < N; k++) if (mask[k] && h[k] < 0) this.eta[k] = -h[k];
    // face bed depth (the shallower side), spacings
    this.dxc = Float64Array.from({ length: nx - 1 }, (_, i) => this.xc[i + 1] - this.xc[i]);
    this.dzc = Float64Array.from({ length: nz - 1 }, (_, j) => this.zc[j + 1] - this.zc[j]);
    this.dxi = Float64Array.from({ length: nx }, (_, i) => this.xe[i + 1] - this.xe[i]);
    this.dzi = Float64Array.from({ length: nz }, (_, j) => this.ze[j + 1] - this.ze[j]);
    this.hu = new Float64Array(N); this.hv = new Float64Array(N);
    for (const k of uf) this.hu[k] = Math.min(h[k], h[k + 1]);
    for (const k of vf) this.hv[k] = Math.min(h[k], h[k + nx]);
    // time step: CFL on the gravity wave (plus a 3 m/s current) on the deepest, smallest cells
    let dt = 60;
    for (const k of cells) { const i = k % nx, j = (k / nx) | 0; const c = Math.sqrt(G * Math.max(0.5, h[k] + hat)) + 3; dt = Math.min(dt, 0.7 / (c * Math.sqrt(1 / this.dxi[i] ** 2 + 1 / this.dzi[j] ** 2))); }
    for (const b of this.bc) { const i = b.k % nx, j = (b.k / nx) | 0; const c = Math.sqrt(G * Math.max(0.5, h[b.k] + hat)) + 3; dt = Math.min(dt, 0.7 / (c * Math.sqrt(1 / this.dxi[i] ** 2 + 1 / this.dzi[j] ** 2))); }
    this.dt = dt;
  }
  // boundary constituents: inverse-distance blend (complex) of the anchor gauges, times their calibration factors
  forcing(cal = {}) {
    const byName = Object.fromEntries(this.gauges.map(g => [g.name, g]));
    const names = new Set();
    for (const b of this.bc) for (const a of b.anchors) for (const c of byName[a].cons) if (SPECIES(constituentName(c[0])) && c[1] >= 0.004) names.add(constituentName(c[0]));
    this.fcons = [...names];
    // per boundary cell: complex amplitude per constituent (re, im) with h = Re{A e^{-iG} e^{i(V+u)}}
    for (const b of this.bc) {
      const re = new Float64Array(this.fcons.length), im = new Float64Array(this.fcons.length);
      let ws = 0;
      for (const a of b.anchors) {
        const g = byName[a], d2 = (b.x - g.x) ** 2 + (b.z - g.z) ** 2 + 4e6, w = 1 / (d2 * d2); ws += w;
        const cf = cal[a] || {};
        this.fcons.forEach((n, ci) => {
          const c = g.cons.find(c => constituentName(c[0]) === n); if (!c) return;
          const s = SPECIES(n), [fr, fi] = cf[s] || [1, 0];
          const cr = c[1] * Math.cos(-c[2] * D2R), cim = c[1] * Math.sin(-c[2] * D2R);
          re[ci] += w * (cr * fr - cim * fi); im[ci] += w * (cr * fi + cim * fr);
        });
      }
      for (let ci = 0; ci < re.length; ci++) { re[ci] /= ws; im[ci] /= ws; }
      b.re = re; b.im = im;
    }
  }
  // the fitted basis at time ms: [1, per group: cos-like, sin-like] with inference ratios from the reference gauge
  basis(ms, groups, ratios, out) {
    const a = args(ms); let p = 0; out[p++] = 1;
    for (const gname of groups) {
      const [f, Vu] = a[gname]; let c = f * Math.cos(Vu * D2R), s = f * Math.sin(Vu * D2R);
      for (const [t, r, dg] of ratios[gname]) { const [ft, Vt] = a[t]; const ph = (Vt - dg) * D2R; c += r * ft * Math.cos(ph); s += r * ft * Math.sin(ph); }
      out[p++] = c; out[p++] = s;
    }
    return out;
  }
  // run from ms0 for `days`, analysing after `spin` days. Returns per-cell coefficients for eta, u, v.
  run(ms0, days, spin, groups, ratios, log = true) {
    const { nx, nz, h, mask, U, V, eta, uf, vf, cells, dt, hu, hv, dxc, dzc, dxi, dzi, f } = this;
    const N = nx * nz, n2 = this.M.n * this.M.n, HD = 0.05, gn2 = G * n2;
    const nb = 1 + 2 * groups.length, ATA = new Float64Array(nb * nb), B = new Float64Array(nb);
    // accumulators: for every water cell, A^T y for eta, u, v
    const wk = []; for (let k = 0; k < N; k++) if (mask[k]) wk.push(k);
    const W = wk.length, Aeta = new Float64Array(W * nb), Au = new Float64Array(W * nb), Av = new Float64Array(W * nb);
    const steps = Math.round(days * 86400 / dt), spinSteps = Math.round(spin * 86400 / dt), every = Math.max(1, Math.round(900 / dt));
    const bc = this.bc, nf = this.fcons.length, fv = new Float64Array(nf * 2);
    let nS = 0, tWall = Date.now(), mass0 = 0, massIn = 0;
    const maxSpeed = new Float32Array(N);
    // per-face tables: neighbour flags (1 west/north upstream face, 2 east/south, 4 cross-lower, 8 cross-upper) and spacings
    const nU = uf.length, nV = vf.length;
    const uFl = new Uint8Array(nU), uA = new Float64Array(nU * 6), vFl = new Uint8Array(nV), vA = new Float64Array(nV * 6);
    const dist = this.dist, SP = SPONGE, spong = (d) => d < SP ? 2e-3 * (1 - d / SP) ** 2 : 0;
    const uR = new Float64Array(nU), vR = new Float64Array(nV);
    for (let q = 0; q < nU; q++) {
      const k = uf[q], i = k % nx, j = (k / nx) | 0;
      uFl[q] = (i > 0 && mask[k - 1] ? 1 : 0) | (i < nx - 2 && mask[k + 2] ? 2 : 0) | (j > 0 && mask[k - nx] && mask[k - nx + 1] ? 4 : 0) | (j < nz - 1 && mask[k + nx] && mask[k + nx + 1] ? 8 : 0);
      const du = Math.min(dist[k], dist[k + 1]); uR[q] = spong(du); if (du === 0) uFl[q] = 0;
      uA[q * 6] = 1 / dxc[i]; uA[q * 6 + 1] = 1 / dxi[i]; uA[q * 6 + 2] = i < nx - 2 ? 1 / dxi[i + 1] : 0;
      uA[q * 6 + 3] = j > 0 ? 1 / dzc[j - 1] : 0; uA[q * 6 + 4] = j < nz - 1 ? 1 / dzc[j] : 0; uA[q * 6 + 5] = dzi[j];
    }
    for (let q = 0; q < nV; q++) {
      const k = vf[q], i = k % nx, j = (k / nx) | 0;
      vFl[q] = (j > 0 && mask[k - nx] ? 1 : 0) | (j < nz - 2 && mask[k + 2 * nx] ? 2 : 0) | (i > 0 && mask[k - 1] && mask[k + nx - 1] ? 4 : 0) | (i < nx - 1 && mask[k + 1] && mask[k + nx + 1] ? 8 : 0);
      const dv = Math.min(dist[k], dist[k + nx]); vR[q] = spong(dv); if (dv === 0) vFl[q] = 0;
      vA[q * 6] = 1 / dzc[j]; vA[q * 6 + 1] = 1 / dzi[j]; vA[q * 6 + 2] = j < nz - 2 ? 1 / dzi[j + 1] : 0;
      vA[q * 6 + 3] = i > 0 ? 1 / dxc[i - 1] : 0; vA[q * 6 + 4] = i < nx - 1 ? 1 / dxc[i] : 0; vA[q * 6 + 5] = dxi[i];
    }
    const nC = cells.length, cInvA = new Float64Array(nC);
    for (let q = 0; q < nC; q++) { const k = cells[q]; cInvA[q] = 1 / (dxi[k % nx] * dzi[(k / nx) | 0]); }
    const FU = new Float64Array(N), FV = new Float64Array(N), Un = new Float64Array(nU), Vn = new Float64Array(nV);
    // boundary forcing: the constituents that matter (≥ 5 mm at some anchor)
    const keep = []; for (let c = 0; c < nf; c++) if (bc.some(b => Math.hypot(b.re[c], b.im[c]) >= 0.005)) keep.push(c);
    for (let s = 0; s <= steps; s++) {
      const t = s * dt, ms = ms0 + t * 1000;
      // --- momentum with eta^n; the face flux takes the new velocity and the upwind depth over the face's bed
      for (let q = 0; q < nU; q++) {
        const k = uf[q], fl = uFl[q], o = q * 6;
        const u = U[k], e0 = eta[k], e1 = eta[k + 1];
        let Hf = hu[k] + (u > 0 ? e0 : u < 0 ? e1 : (e0 > e1 ? e0 : e1));
        if (Hf < HD) { Un[q] = 0; FU[k] = 0; continue; }
        const vb = 0.25 * (V[k - nx] + V[k - nx + 1] + V[k] + V[k + 1]);
        let adv = 0;
        if (u > 0) { if (fl & 1) adv = u * (u - U[k - 1]) * uA[o + 1]; } else if (fl & 2) adv = u * (U[k + 1] - u) * uA[o + 2];
        if (vb > 0) { if (fl & 4) adv += vb * (u - U[k - nx]) * uA[o + 3]; } else if (fl & 8) adv += vb * (U[k + nx] - u) * uA[o + 4];
        const Hc = Hf < 0.3 ? 0.3 : Hf;
        let un = (u + dt * (-G * (e1 - e0) * uA[o] - f * vb - adv)) / (1 + dt * (gn2 * Math.sqrt(u * u + vb * vb) / (Hc * Math.cbrt(Hc)) + uR[q]));
        if (un > VMAX) un = VMAX; else if (un < -VMAX) un = -VMAX;
        Un[q] = un;
        Hf = hu[k] + (un > 0 ? e0 : un < 0 ? e1 : 0);
        FU[k] = Hf > 0 ? un * Hf * uA[o + 5] : 0;
      }
      for (let q = 0; q < nU; q++) U[uf[q]] = Un[q];
      for (let q = 0; q < nV; q++) {
        const k = vf[q], fl = vFl[q], o = q * 6;
        const v = V[k], e0 = eta[k], e1 = eta[k + nx];
        let Hf = hv[k] + (v > 0 ? e0 : v < 0 ? e1 : (e0 > e1 ? e0 : e1));
        if (Hf < HD) { Vn[q] = 0; FV[k] = 0; continue; }
        const ub = 0.25 * (U[k - 1] + U[k + nx - 1] + U[k] + U[k + nx]);
        let adv = 0;
        if (v > 0) { if (fl & 1) adv = v * (v - V[k - nx]) * vA[o + 1]; } else if (fl & 2) adv = v * (V[k + nx] - v) * vA[o + 2];
        if (ub > 0) { if (fl & 4) adv += ub * (v - V[k - 1]) * vA[o + 3]; } else if (fl & 8) adv += ub * (V[k + 1] - v) * vA[o + 4];
        const Hc = Hf < 0.3 ? 0.3 : Hf;
        let vn = (v + dt * (-G * (e1 - e0) * vA[o] + f * ub - adv)) / (1 + dt * (gn2 * Math.sqrt(v * v + ub * ub) / (Hc * Math.cbrt(Hc)) + vR[q]));
        if (vn > VMAX) vn = VMAX; else if (vn < -VMAX) vn = -VMAX;
        Vn[q] = vn;
        Hf = hv[k] + (vn > 0 ? e0 : vn < 0 ? e1 : 0);
        FV[k] = Hf > 0 ? vn * Hf * vA[o + 5] : 0;
      }
      for (let q = 0; q < nV; q++) V[vf[q]] = Vn[q];
      // --- continuity; boundary cells take the forced level (the water they pass in or out is counted)
      for (let q = 0; q < nC; q++) {
        const k = cells[q];
        let e = eta[k] - dt * cInvA[q] * (FU[k] - FU[k - 1] + FV[k] - FV[k - nx]);
        if (e < -h[k]) e = -h[k];
        eta[k] = e;
      }
      const a = args(ms), ramp = Math.min(1, (t + (this.t0 || 0)) / 43200);
      for (const c of keep) { const [ff, Vu] = a[this.fcons[c]]; fv[2 * c] = ff * Math.cos(Vu * D2R); fv[2 * c + 1] = ff * Math.sin(Vu * D2R); }
      for (const b of bc) {
        const k = b.k;
        massIn += dt * (FU[k] - (k % nx ? FU[k - 1] : 0) + FV[k] - (k >= nx ? FV[k - nx] : 0));   // what the boundary cell exported
        let e = 0; for (const c of keep) e += b.re[c] * fv[2 * c] - b.im[c] * fv[2 * c + 1];
        e *= ramp; eta[k] = e < -h[k] ? -h[k] : e;
      }
      if (s === spinSteps) { mass0 = this.volume(); massIn = 0; this.bVol0 = this.bVolume(); }
      // --- harmonic analysis: sample every ~15 min after the spin-up
      if (s >= spinSteps && s % every === 0) {
        const bas = this.basis(ms, groups, ratios, B);
        for (let p = 0; p < nb; p++) for (let r = 0; r < nb; r++) ATA[p * nb + r] += bas[p] * bas[r];
        for (let w = 0; w < W; w++) {
          const k = wk[w];
          const uc = 0.5 * ((k % nx ? U[k - 1] : 0) + U[k]), vc = 0.5 * ((k >= nx ? V[k - nx] : 0) + V[k]);
          const e = eta[k], o = w * nb;
          const spd = uc * uc + vc * vc; if (spd > maxSpeed[k]) maxSpeed[k] = spd;
          for (let p = 0; p < nb; p++) { const bp = bas[p]; Aeta[o + p] += bp * e; Au[o + p] += bp * uc; Av[o + p] += bp * vc; }
        }
        nS++;
      }
      if (s > 0 && s % Math.round((typeof log === 'number' ? log : 1) * 86400 / dt) === 0) {
        let mx = 0, km = -1; for (const k of uf) if (Math.abs(U[k]) > mx) { mx = Math.abs(U[k]); km = k; } for (const k of vf) if (Math.abs(V[k]) > mx) { mx = Math.abs(V[k]); km = k; }
        let nan = -1; for (const k of cells) if (!(eta[k] === eta[k])) { nan = k; break; }
        if (!(mx < 50)) for (const k of cells) if (!(Math.abs(U[k]) < 50 && Math.abs(V[k]) < 50)) { nan = k; break; }
        if (log || nan >= 0) console.log(`  ${this.v.id} day ${(t / 86400).toFixed(2)} max |u| ${mx.toFixed(2)} m/s at (${km % nx},${(km / nx) | 0}) h ${h[km]?.toFixed(1)} ${((Date.now() - tWall) / 1000).toFixed(0)} s`);
        if (nan >= 0) { const i = nan % nx, j = (nan / nx) | 0; throw new Error(`model blew up at cell (${i},${j}) h ${h[nan].toFixed(2)} eta ${eta[nan]} U ${U[nan]} V ${V[nan]} mask ${mask[nan]}`); }
      }
    }
    // mass budget over the analysis: interior volume change against the water the boundary cells passed in
    const dVol = this.volume() - mass0;
    this.massErr = { dVol, massIn: massIn, rel: Math.abs(dVol - massIn) / Math.max(1, this.volume()) };
    // solve the shared normal equations
    const inv = invert(ATA, nb);
    const sol = (A) => { const out = new Float64Array(W * nb); for (let w = 0; w < W; w++) for (let p = 0; p < nb; p++) { let s = 0; for (let r = 0; r < nb; r++) s += inv[p * nb + r] * A[w * nb + r]; out[w * nb + p] = s; } return out; };
    return { wk, nb, eta: sol(Aeta), u: sol(Au), v: sol(Av), samples: nS, maxSpeed };
  }
  // water volume in the interior cells (m³); the boundary ring's volume separately
  volume() { let s = 0; const { nx, eta, h, dxi, dzi } = this; for (const k of this.cells) s += (eta[k] + h[k]) * dxi[k % nx] * dzi[(k / nx) | 0]; return s; }
  bVolume() { let s = 0; const { nx, eta, h, dxi, dzi } = this; for (const b of this.bc) s += (eta[b.k] + h[b.k]) * dxi[b.k % nx] * dzi[(b.k / nx) | 0]; return s; }
  cellAt(x, z) {
    let i = 0, j = 0; while (i < this.nx - 1 && this.xe[i + 1] < x) i++; while (j < this.nz - 1 && this.ze[j + 1] < z) j++;
    return j * this.nx + i;
  }
  // nearest water cell to (x, z) that stays wet (a gauge sits in a channel): at least minH below MSL
  wetCellNear(x, z, minH = 2) {
    let best = -1, bd = Infinity;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const k = j * this.nx + i; if (this.mask[k] !== 1 || this.h[k] < minH) continue; const d = (this.xc[i] - x) ** 2 + (this.zc[j] - z) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  }
}
function invert(A, n) {
  const M = Float64Array.from(A), I = new Float64Array(n * n); for (let i = 0; i < n; i++) I[i * n + i] = 1;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
    for (let k = 0; k < n; k++) { [M[c * n + k], M[p * n + k]] = [M[p * n + k], M[c * n + k]]; [I[c * n + k], I[p * n + k]] = [I[p * n + k], I[c * n + k]]; }
    const d = M[c * n + c]; for (let k = 0; k < n; k++) { M[c * n + k] /= d; I[c * n + k] /= d; }
    for (let r = 0; r < n; r++) if (r !== c) { const m = M[r * n + c]; if (m) for (let k = 0; k < n; k++) { M[r * n + k] -= m * M[c * n + k]; I[r * n + k] -= m * I[c * n + k]; } }
  }
  return I;
}
// amplitude / phase lag of a fitted group at water cell w: value = a cos(V+u) + b sin(V+u) = A cos(V+u - g)
const ampPh = (C, w, nb, gi) => { const a = C[w * nb + 1 + 2 * gi], b = C[w * nb + 2 + 2 * gi]; return [Math.hypot(a, b), ((Math.atan2(b, a) / D2R) + 360) % 360]; };

// inference ratios from the reference gauge: [tied, amplitude ratio, phase offset G_t - G_main]
function ratiosFrom(ref, groups) {
  const con = (n) => ref.cons.find(c => constituentName(c[0]) === n);
  const R = {};
  for (const g of groups) {
    R[g] = [];
    const m = con(g); if (!m || m[1] < 1e-4) continue;
    for (const t of GROUPS[g] || []) { const c = con(t); if (c && c[1] > 0.1 * 0.01) R[g].push([t, c[1] / m[1], ((c[2] - m[2]) % 360 + 360) % 360]); }
  }
  return R;
}

async function bake(v) {
  const M = MODELS[v.id]; if (!M) return;
  const tf = `data/venues/${v.id}.tide.json`, T = JSON.parse(readFileSync(tf, 'utf8'));
  const gauges = T.gauges, ref = gauges.find(g => g.role === 'level');
  const m = new Model(v, M, gauges);
  const t0 = Date.now();
  await m.bathy();
  m.setup();
  const wet = m.cells.length + m.bc.length;
  console.log(`${v.id}: grid ${m.nx}×${m.nz} (${wet} water cells, ${m.bc.length} on open boundaries), dx ${Math.min(...m.dxi).toFixed(0)}–${Math.max(...m.dxi).toFixed(0)} m, dt ${m.dt.toFixed(2)} s, bathymetry ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const ms0 = Date.parse(M.date + 'T00:00:00Z');
  const groups = Object.keys(GROUPS);
  // calibration: gauges the anchors are tied to; a short run fits the species with inference, then factors
  const calG = [...new Set(Object.values(M.cal))].map(n => gauges.find(g => g.name === n)).filter(Boolean);
  let cal = {};
  const calCells = calG.map(g => m.wetCellNear(g.x, g.z));
  const report = (res, label) => {
    const out = [];
    for (const g of gauges) {
      const k = m.wetCellNear(g.x, g.z), w = res.wk.indexOf(k); if (w < 0) continue;
      const row = { gauge: g.name };
      for (const [gi, n] of groups.entries()) {
        const c = g.cons.find(c => constituentName(c[0]) === n); if (!c || c[1] < 0.01) continue;
        const [A, ph] = ampPh(res.eta, w, res.nb, gi);
        row[n] = `${A.toFixed(3)}/${ph.toFixed(0)}° (gauge ${c[1].toFixed(3)}/${c[2].toFixed(0)}°)`;
      }
      out.push(row);
    }
    console.log(`  ${label}:`); for (const r of out) console.log('   ', JSON.stringify(r));
    return out;
  };
  // (--repack: the last run's analysis, cached, packed again without running)
  const cacheF = join(tmpdir(), `truewind-tide-${v.id}.json`);
  const f32 = (a) => Buffer.from(Float32Array.from(a).buffer).toString('base64'), unf = (s) => { const b = Buffer.from(s, 'base64'); return new Float64Array(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
  let cached = argv.includes('--repack') && existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : null;
  if (!cached && !argv.includes('--noquick') && calG.length) {
    const qg = ['M2', 'K1', 'M4', 'M6'];
    const qr = { M2: [], K1: [], M4: [], M6: [] };
    // (species inference for the short run: S2, N2, K2 ride on M2; O1, P1, Q1 on K1; MS4, MN4 on M4)
    const conOf = (g, n) => g.cons.find(c => constituentName(c[0]) === n);
    for (let pass = 0; pass < CALN; pass++) {
      m.forcing(cal);
      m.eta.fill(0); m.U.fill(0); m.V.fill(0); for (let k = 0; k < m.eta.length; k++) if (m.mask[k] && m.h[k] < 0) m.eta[k] = -m.h[k];
      const tie = { M2: ['S2', 'N2', 'K2', 'NU2', 'L2'], K1: ['O1', 'P1', 'Q1'], M4: ['MS4', 'MN4'], M6: ['2MS6'] };
      for (const q of qg) { const mc = conOf(ref, q); qr[q] = mc ? tie[q].map(t => conOf(ref, t)).filter(Boolean).map(c => [constituentName(c[0]), c[1] / mc[1], ((c[2] - mc[2]) % 360 + 360) % 360]) : []; }
      const res = m.run(ms0, CALD, 1.0, qg, qr, false);
      const next = {};
      calG.forEach((g, ci) => {
        const w = res.wk.indexOf(calCells[ci]); if (w < 0) return;
        const fac = {};
        qg.forEach((q, gi) => {
          const c = conOf(g, q); if (!c) return;
          const [A, ph] = ampPh(res.eta, w, res.nb, gi); if (A < 1e-4) return;
          // wanted / modelled, as a complex factor on e^{-iG}
          const r = c[1] / A, d = -(c[2] - ph) * D2R;
          fac[{ M2: 2, K1: 1, M4: 4, M6: 6 }[q]] = [r * Math.cos(d), r * Math.sin(d)];
        });
        next[g.name] = fac;
        console.log(`  calibration pass ${pass + 1} at ${g.name}: ` + qg.map((q, gi) => { const c = conOf(g, q), [A, ph] = ampPh(res.eta, w, res.nb, gi); return c ? `${q} ${A.toFixed(3)}/${ph.toFixed(0)}° vs ${c[1].toFixed(3)}/${c[2].toFixed(0)}°` : ''; }).join(', '));
      });
      // compose with the previous factors
      const comp = {};
      for (const [anchor, gname] of Object.entries(M.cal)) {
        const old = cal[anchor] || {}, nf = next[gname] || {}, o = {};
        for (const s of [1, 2, 4, 6]) { const [a, b] = old[s] || [1, 0], [c, d] = nf[s] || [1, 0]; o[s] = [a * c - b * d, a * d + b * c]; }
        // (the 8th-diurnal and 3rd-diurnal follow the nearest species)
        o[3] = o[2]; o[8] = o[4];
        comp[anchor] = o;
      }
      cal = comp;
    }
  }
  // full run
  const ratios = ratiosFrom(ref, groups);
  let res, runS;
  if (cached) {
    ({ cal, runS } = cached); m.massErr = cached.massErr;
    res = { wk: cached.wk, nb: cached.nb, samples: cached.samples, eta: unf(cached.eta), u: unf(cached.u), v: unf(cached.v), maxSpeed: new Float32Array(m.nx * m.nz) };
    const ms = unf(cached.maxSpeed); res.wk.forEach((k, w) => res.maxSpeed[k] = ms[w]);
  } else {
    m.forcing(cal);
    m.eta.fill(0); m.U.fill(0); m.V.fill(0); for (let k = 0; k < m.eta.length; k++) if (m.mask[k] && m.h[k] < 0) m.eta[k] = -m.h[k];
    const tr = Date.now();
    res = m.run(ms0, SPIN + DAYS, SPIN, groups, ratios, true);
    runS = (Date.now() - tr) / 1000;
    writeFileSync(cacheF, JSON.stringify({ wk: res.wk, nb: res.nb, samples: res.samples, eta: f32(res.eta), u: f32(res.u), v: f32(res.v), maxSpeed: f32(res.wk.map(k => res.maxSpeed[k])), cal, runS, massErr: m.massErr }));
  }
  console.log(`  mass: interior volume change ${m.massErr.dVol.toExponential(3)} m³ against ${m.massErr.massIn.toExponential(3)} m³ through the boundary (relative error ${m.massErr.rel.toExponential(1)})`);
  const levels = report(res, 'model tide at the gauges (amplitude m / Greenwich phase)');
  // stream checks
  const checks = [];
  for (const [name, lat, lon] of M.check || []) {
    const [x, z] = m.P.fwd(lat, lon), k = m.wetCellNear(x, z, 1), w = res.wk.indexOf(k);
    const row = { name, lat, lon, depth: +m.h[k].toFixed(1), maxKt: +(Math.sqrt(res.maxSpeed[k]) / 0.514444).toFixed(2) };
    const [Au, pu] = ampPh(res.u, w, res.nb, 0), [Av, pv] = ampPh(res.v, w, res.nb, 0);
    row.M2 = `u ${Au.toFixed(2)}/${pu.toFixed(0)}° v(south) ${Av.toFixed(2)}/${pv.toFixed(0)}°`;
    checks.push(row); console.log('   ', JSON.stringify(row));
  }
  // resample to the runtime grid over the venue ([-R, R]², cells of about the fine model size)
  const R = v.R ?? MAP_RADIUS, rdx = Math.max(M.dx, R > 10000 ? 200 : 100), rn = Math.round(2 * R / rdx), rd = 2 * R / rn;
  const cellIndex = new Int32Array(m.nx * m.nz).fill(-1); res.wk.forEach((k, w) => cellIndex[k] = w);
  const interp = (C, x, z, p) => {
    // bilinear over the model's cell centres (dry / land neighbours dropped)
    let i = 0, j = 0; while (i < m.nx - 2 && m.xc[i + 1] < x) i++; while (j < m.nz - 2 && m.zc[j + 1] < z) j++;
    const u = Math.max(0, Math.min(1, (x - m.xc[i]) / (m.xc[i + 1] - m.xc[i]))), vv = Math.max(0, Math.min(1, (z - m.zc[j]) / (m.zc[j + 1] - m.zc[j])));
    let s = 0, ws = 0;
    for (const [kk, wt] of [[j * m.nx + i, (1 - u) * (1 - vv)], [j * m.nx + i + 1, u * (1 - vv)], [(j + 1) * m.nx + i, (1 - u) * vv], [(j + 1) * m.nx + i + 1, u * vv]]) {
      const w = cellIndex[kk]; if (w < 0 || m.h[kk] < 0.2) continue; s += C[w * res.nb + p] * wt; ws += wt;
    }
    return ws > 0.05 ? s / ws : 0;
  };
  // runtime cells the model has water in (only these are stored)
  const wetR = new Uint8Array(rn * rn);
  for (let j = 0; j < rn; j++) for (let i = 0; i < rn; i++) {
    const x = -R + (i + 0.5) * rd, z = -R + (j + 0.5) * rd;
    let ii = 0, jj = 0; while (ii < m.nx - 2 && m.xc[ii + 1] < x) ii++; while (jj < m.nz - 2 && m.zc[jj + 1] < z) jj++;
    for (const kk of [jj * m.nx + ii, jj * m.nx + ii + 1, (jj + 1) * m.nx + ii, (jj + 1) * m.nx + ii + 1]) if (cellIndex[kk] >= 0 && m.h[kk] >= 0.2) wetR[j * rn + i] = 1;
  }
  const nW = wetR.reduce((a, b) => a + b, 0), bits = new Uint8Array(Math.ceil(rn * rn / 8));
  for (let k = 0; k < rn * rn; k++) if (wetR[k]) bits[k >> 3] |= 1 << (k & 7);
  const pack = (a) => { const o = new Int8Array(nW * 2); let p = 0; for (let k = 0; k < rn * rn; k++) if (wetR[k]) { o[p++] = a[2 * k]; o[p++] = a[2 * k + 1]; } return Buffer.from(o.buffer).toString('base64'); };
  const maps = [];
  for (const [gi, n] of [['mean', 'Z0'], ...groups.map((g, i) => [i, g])].map(([a, b]) => [a, b])) {
    const pc = n === 'Z0' ? [0, null] : [1 + 2 * gi, 2 + 2 * gi];
    const re = new Float32Array(rn * rn * 2), im = new Float32Array(rn * rn * 2);
    let mx = 0;
    for (let j = 0; j < rn; j++) for (let i = 0; i < rn; i++) {
      const x = -R + (i + 0.5) * rd, z = -R + (j + 0.5) * rd, o = 2 * (j * rn + i);
      // v in the model is southward; the maps store (u east, v north)
      re[o] = interp(res.u, x, z, pc[0]); re[o + 1] = -interp(res.v, x, z, pc[0]);
      if (pc[1] !== null) { im[o] = interp(res.u, x, z, pc[1]); im[o + 1] = -interp(res.v, x, z, pc[1]); }
      mx = Math.max(mx, Math.abs(re[o]), Math.abs(re[o + 1]), Math.abs(im[o]), Math.abs(im[o + 1]));
    }
    if (mx < 0.02) continue;                                   // (under 2 cm/s anywhere: left out)
    const s = mx / 127, q = (a) => pack(Int8Array.from(a, x => Math.round(x / s)));
    maps.push({ n, s: +s.toPrecision(4), tied: n === 'Z0' ? [] : ratios[n].map(([t, r, d]) => [t, +r.toFixed(4), +d.toFixed(2)]), re: q(re), ...(pc[1] !== null ? { im: q(im) } : {}) });
    console.log(`  map ${n}: max ${mx.toFixed(2)} m/s`);
  }
  T.streams = { nx: rn, nz: rn, x0: -R, z0: -R, dx: rd, wet: Buffer.from(bits).toString('base64'), cons: maps };
  T.model = { grid: `${m.nx}×${m.nz}`, dx: [Math.round(Math.min(...m.dxi)), Math.round(Math.max(...m.dxi))], dt: +m.dt.toFixed(2), manning: M.n, days: DAYS, spin: SPIN, start: M.date,
    bathymetry: m.source, samples: res.samples, runSeconds: Math.round(runS), calibration: cal, mass: m.massErr, levels, checks, baked: new Date().toISOString().slice(0, 10) };
  writeFileSync(tf, JSON.stringify(T));
  console.log(`${v.id}: done in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${(JSON.stringify(T).length / 1024).toFixed(0)} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const want = argv.filter(a => !a.startsWith('--') && isNaN(+a));
  for (const v of VENUES) if (MODELS[v.id] && (!want.length || want.includes(v.id))) await bake(v);
}
export { Model, bake };
