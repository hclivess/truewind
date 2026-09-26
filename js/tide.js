// Tides: water level and tidal streams from harmonic constituents.
// Level: h(t) = Z0 + Σ f·H·cos(V0 + u − G) at the venue's reference gauge (H, G: amplitude and Greenwich phase lag
// of each constituent, from NOAA CO-OPS for US stations, TICON-4 / GESLA-4 elsewhere), with the astronomical
// arguments V (Doodson numbers on the mean longitudes of Moon, Sun, lunar perigee, node, solar perigee: Meeus'
// polynomials) and Schureman's nodal corrections f, u evaluated at the moment, so a real date gives the real tide.
// Streams: per-constituent complex (u, v) maps baked offline by a depth-averaged shallow-water model
// (tools/bake-tide.mjs) over the venue's real bathymetry; at run time the stream is a cheap harmonic sum, cached
// as a snapshot grid every few seconds of game time and interpolated bilinearly.
// Conventions: world x = east, z = south; a stream (u east, v north) is the flow vector (u, −v) in (x, z).

const D2R = Math.PI / 180;
const mod360 = (a) => ((a % 360) + 360) % 360;

// Doodson numbers on (τ, s, h, p, N, p1) + multiples of 90°; nodal class. τ = hour angle of the mean Moon's...:
// here T (the mean Sun's Greenwich hour angle, 180° at 0h UT) is used as Schureman does, so a lunar term is
// written with T − s + h (= τ). Compound shallow-water tides are sums of their parents.
const BASE = {
  M2: [2, -2, 2, 0, 0, 0, 0, 'M2'], S2: [2, 0, 0, 0, 0, 0, 0, ''], N2: [2, -3, 2, 1, 0, 0, 0, 'M2'], K2: [2, 0, 2, 0, 0, 0, 0, 'K2'],
  K1: [1, 0, 1, 0, 0, 0, -1, 'K1'], O1: [1, -2, 1, 0, 0, 0, 1, 'O1'], P1: [1, 0, -1, 0, 0, 0, 1, ''], Q1: [1, -3, 1, 1, 0, 0, 1, 'O1'],
  '2Q1': [1, -4, 1, 2, 0, 0, 1, 'O1'], RHO: [1, -3, 3, -1, 0, 0, 1, 'O1'], J1: [1, 1, 1, -1, 0, 0, -1, 'J1'], OO1: [1, 2, 1, 0, 0, 0, -1, 'OO1'],
  M1: [1, -1, 1, 1, 0, 0, -1, 'M1'], S1: [1, 0, 0, 0, 0, 0, 0, ''], NU2: [2, -3, 4, -1, 0, 0, 0, 'M2'], MU2: [2, -4, 4, 0, 0, 0, 0, 'M2'],
  '2N2': [2, -4, 2, 2, 0, 0, 0, 'M2'], LAM2: [2, -1, 0, 1, 0, 0, 2, 'M2'], L2: [2, -1, 2, -1, 0, 0, 2, 'L2'], T2: [2, 0, -1, 0, 0, 1, 0, ''],
  R2: [2, 0, 1, 0, 0, -1, 2, ''], M3: [3, -3, 3, 0, 0, 0, 0, 'M3'], MM: [0, 1, 0, -1, 0, 0, 0, 'MM'], MF: [0, 2, 0, 0, 0, 0, 0, 'MF'],
  SA: [0, 0, 1, 0, 0, 0, 0, ''], SSA: [0, 0, 2, 0, 0, 0, 0, ''], EP2: [2, -5, 4, 1, 0, 0, 0, 'M2'], MA2: [2, -2, 1, 0, 0, 0, 0, 'M2'],
  MB2: [2, -2, 3, 0, 0, 0, 0, 'M2'], SGM: [1, -4, 3, 0, 0, 0, 1, 'O1'], S3: [3, 0, 0, 0, 0, 0, 0, ''],
};
// compound tides: { parent: multiple }
const COMPOUND = {
  M4: { M2: 2 }, M6: { M2: 3 }, M8: { M2: 4 }, MS4: { M2: 1, S2: 1 }, MN4: { M2: 1, N2: 1 }, S4: { S2: 2 }, S6: { S2: 3 },
  MK3: { M2: 1, K1: 1 }, '2MK3': { M2: 2, K1: -1 }, MSF: { S2: 1, M2: -1 }, '2SM2': { S2: 2, M2: -1 }, MK4: { M2: 1, K2: 1 },
  MSN2: { M2: 1, S2: 1, N2: -1 }, '2MS6': { M2: 2, S2: 1 }, '2MN6': { M2: 2, N2: 1 }, MSK6: { M2: 1, S2: 1, K1: 1 }, SK3: { S2: 1, K1: 1 },
  MO3: { M2: 1, O1: 1 }, SO3: { S2: 1, O1: 1 }, MKS2: { M2: 1, K2: 1, S2: -1 }, N4: { N2: 2 }, '2MK5': { M2: 2, K1: 1 },
  '2MO5': { M2: 2, O1: 1 },
};
const ALIAS = { RHO1: 'RHO', LAMBDA2: 'LAM2', LDA2: 'LAM2', MSQM: null, 'SIG1': null };
export const CONSTITUENTS = [...Object.keys(BASE), ...Object.keys(COMPOUND).filter(k => COMPOUND[k])];
export const constituentName = (n) => { const u = String(n).toUpperCase(); return u in ALIAS ? ALIAS[u] : u; };

// mean longitudes (deg) at UTC ms: Moon s, Sun h, lunar perigee p, Moon's node N, solar perigee p1 (Meeus 1998)
export function astro(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545.0) / 36525, T2 = T * T;
  const s = mod360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2);
  const h = mod360(280.46646 + 36000.76983 * T + 0.0003032 * T2);
  const p = mod360(83.3532465 + 4069.0137287 * T - 0.01032 * T2);
  const N = mod360(125.04452 - 1934.136261 * T + 0.0020708 * T2);
  const p1 = mod360(282.93735 + 1.71946 * T + 0.00046 * T2);
  const hrs = ((ms / 3600000) % 24 + 24) % 24;
  return { T: mod360(180 + 15 * hrs), s, h, p, N, p1 };
}
// Schureman's node factors f and angles u (deg) for the base constituents, for the Moon's node N
function nodal(a) {
  const N = a.N * D2R, w = 23.4523 * D2R, i = 5.145 * D2R;
  const I = Math.acos(Math.cos(i) * Math.cos(w) - Math.sin(i) * Math.sin(w) * Math.cos(N));
  const A = Math.atan(Math.cos((w - i) / 2) / Math.cos((w + i) / 2) * Math.tan(N / 2));
  const B = Math.atan(Math.sin((w - i) / 2) / Math.sin((w + i) / 2) * Math.tan(N / 2));
  const nu = A - B, xi = N - A - B;                          // (A, B share the branch of N/2: exact for all N)
  const s2I = Math.sin(2 * I), sI = Math.sin(I), cI2 = Math.cos(I / 2), sI2 = Math.sin(I / 2);
  const nup = Math.atan2(s2I * Math.sin(nu), s2I * Math.cos(nu) + 0.3347);
  const nupp2 = Math.atan2(sI * sI * Math.sin(2 * nu), sI * sI * Math.cos(2 * nu) + 0.0727);
  const P = a.p * D2R - xi, t2 = Math.tan(I / 2) ** 2;
  const RaInv = Math.sqrt(Math.max(0, 1 - 12 * t2 * Math.cos(2 * P) + 36 * t2 * t2));
  const R = Math.atan2(Math.sin(2 * P), 1 / (6 * t2) - Math.cos(2 * P));
  const Q = Math.atan2((5 * Math.cos(I) - 1) * Math.sin(P), (7 * Math.cos(I) + 1) * Math.cos(P));
  const QaInv = Math.sqrt(0.25 + 1.5 * Math.cos(I) * Math.cos(2 * P) / (cI2 * cI2) + 2.25 * Math.cos(I) ** 2 / cI2 ** 4);
  const fM2 = cI2 ** 4 / 0.9154, fO1 = sI * cI2 * cI2 / 0.38, d = 180 / Math.PI;
  return {
    '': [1, 0],
    M2: [fM2, (2 * xi - 2 * nu) * d],
    O1: [fO1, (2 * xi - nu) * d],
    K1: [Math.sqrt(0.8965 * s2I * s2I + 0.6001 * s2I * Math.cos(nu) + 0.1006), -nup * d],
    K2: [Math.sqrt(19.0444 * sI ** 4 + 2.7702 * sI * sI * Math.cos(2 * nu) + 0.0981), -nupp2 * d],
    J1: [s2I / 0.7214, -nu * d],
    OO1: [sI * sI2 * sI2 / 0.0164, (-2 * xi - nu) * d],
    MM: [(2 / 3 - sI * sI) / 0.5021, 0],
    MF: [sI * sI / 0.1578, -2 * xi * d],
    M3: [cI2 ** 6 / 0.8758, (3 * xi - 3 * nu) * d],
    L2: [fM2 * RaInv, (2 * xi - 2 * nu - R) * d],
    M1: [fO1 * QaInv, (xi - nu + Q) * d],
  };
}
// V (deg) and nodal f, u for every constituent at time ms: { name: [f, V + u] }
export function args(ms) {
  const a = astro(ms), nd = nodal(a), out = {};
  const L = [a.T, a.s, a.h, a.p, a.N, a.p1];
  for (const k in BASE) {
    const b = BASE[k];
    let V = b[6] * 90; for (let j = 0; j < 6; j++) V += b[j] * L[j];
    const [f, u] = nd[b[7]];
    out[k] = [f, mod360(V + u)];
  }
  for (const k in COMPOUND) {
    const c = COMPOUND[k]; if (!c) continue;
    let f = 1, V = 0;
    for (const p in c) { const [fp, Vp] = out[p]; f *= Math.pow(fp, Math.abs(c[p])); V += c[p] * Vp; }
    out[k] = [f, mod360(V)];
  }
  return out;
}
// angular speed (deg / hour) of each constituent, from the arguments an hour apart
export function speed(name) {
  const a = astro(0), b = astro(3600e3);
  const L0 = [0, a.s, a.h, a.p, a.N, a.p1], L1 = [15, b.s, b.h, b.p, b.N, b.p1];
  const one = (bb) => { let w = 0; for (let j = 0; j < 6; j++) { let d = L1[j] - L0[j]; if (j) d = ((d + 540) % 360) - 180; w += bb[j] * d; } return w; };
  if (BASE[name]) return one(BASE[name]);
  let w = 0; for (const p in COMPOUND[name]) w += COMPOUND[name][p] * one(BASE[p]); return w;
}

// Harmonic predictor for one place. cons: [[name, amplitude (m), Greenwich phase lag (deg)], ...]; z0: mean level
// above the chart datum (m). level(ms) is relative to mean sea level, chart(ms) to chart datum.
export class TideStation {
  constructor(def = {}) {
    this.name = def.name || ''; this.z0 = def.z0 ?? 0; this.source = def.source || '';
    this.cons = (def.cons || []).map(([n, A, G]) => [constituentName(n), A, G]).filter(c => c[0] && (BASE[c[0]] || COMPOUND[c[0]]));
    this._t = NaN; this._a = null;
  }
  _args(ms) { if (ms !== this._t) { this._t = ms; this._a = args(ms); } return this._a; }
  level(ms) {
    const a = this._args(ms); let h = 0;
    for (const [n, A, G] of this.cons) { const [f, Vu] = a[n]; h += f * A * Math.cos((Vu - G) * D2R); }
    return h;
  }
  chart(ms) { return this.level(ms) + this.z0; }
  // high and low waters between t0 and t1 (ms): [{ t, h, hw }], refined to the minute
  extremes(t0, t1, step = 6 * 60e3) {
    const out = []; let a = this.level(t0 - step), b = this.level(t0);
    for (let t = t0; t <= t1; t += step) {
      const c = this.level(t + step);
      if ((b > a && b >= c) || (b < a && b <= c)) {
        // parabola through the three samples
        const den = a - 2 * b + c, dt = den !== 0 ? 0.5 * (a - c) / den : 0;
        const te = t + dt * step;
        out.push({ t: te, h: this.level(te), hw: b > a });
      }
      a = b; b = c;
    }
    return out;
  }
  get range() { let s = 0; for (const [n, A] of this.cons) if (/^(M2|S2|K1|O1|N2|K2|P1)$/.test(n)) s += A; return 2 * s; }
}

// ---------------------------------------------------------------------------------------------------------
// Tidal streams: baked per-constituent maps on a regular grid over the venue (x east, z south, cell centres).
// Each map c holds, per cell, the cos and sin coefficients (re, im; Int8 × scale s) of the east and north stream
// against the constituent's argument V+u, and carries its inferred neighbours (tied: [name, ratio, phase offset]):
//   stream = Σ_c s·(re·K + im·S),  K + iS = f_c e^{i(V+u)_c} + Σ_t r f_t e^{i((V+u)_t − Δ)}
// ('Z0' is the tidal residual: a steady map.)
function timeFactor(a, c) {
  if (c.n === 'Z0') return [c.s, 0];
  const fa = a[c.n]; if (!fa) return [0, 0];
  let K = fa[0] * Math.cos(fa[1] * D2R), S = fa[0] * Math.sin(fa[1] * D2R);
  for (const [t, r, d] of c.tied || []) { const ft = a[t]; if (!ft) continue; const ph = (ft[1] - d) * D2R; K += r * ft[0] * Math.cos(ph); S += r * ft[0] * Math.sin(ph); }
  return [K * c.s, S * c.s];
}
export class TideStreams {
  constructor(d) {
    this.nx = d.nx; this.nz = d.nz; this.x0 = d.x0; this.z0 = d.z0; this.dx = d.dx;
    this.cons = d.cons;
    const n = this.nx * this.nz;
    this.snap = [new Float32Array(n * 2), new Float32Array(n * 2)];
    this.snapT = [NaN, NaN]; this.w = 0;
    this.interval = d.interval ?? 20;          // s of game time between snapshots
  }
  // fill a snapshot grid (x, z components; z = south) with the stream at UTC ms
  fill(out, ms) {
    const a = args(ms), n = this.nx * this.nz;
    out.fill(0);
    for (const c of this.cons) {
      const [K, S] = timeFactor(a, c), re = c.re, im = c.im;
      if (im) for (let k = 0; k < 2 * n; k += 2) { out[k] += K * re[k] + S * im[k]; out[k + 1] -= K * re[k + 1] + S * im[k + 1]; }
      else for (let k = 0; k < 2 * n; k += 2) { out[k] += K * re[k]; out[k + 1] -= K * re[k + 1]; }
    }
    return out;
  }
  // keep the two snapshots bracketing game time t (clock0: UTC ms at t = 0)
  update(t, clock0) {
    const I = this.interval, ta = Math.floor(t / I) * I, tb = ta + I;
    if (this.clock0 !== clock0) { this.clock0 = clock0; this.snapT = [NaN, NaN]; }
    if (this.snapT[0] !== ta || this.snapT[1] !== tb) {
      if (this.snapT[1] === ta) { const s = this.snap[0]; this.snap[0] = this.snap[1]; this.snap[1] = s; this.snapT = [ta, NaN]; }
      if (this.snapT[0] !== ta) { this.fill(this.snap[0], clock0 + ta * 1000); this.snapT[0] = ta; }
      this.fill(this.snap[1], clock0 + tb * 1000); this.snapT[1] = tb;
    }
    this.w = Math.max(0, Math.min(1, (t - ta) / I));
  }
  _cell(x, z) {
    let fx = (x - this.x0) / this.dx - 0.5, fz = (z - this.z0) / this.dx - 0.5;
    if (!(fx >= -0.5 && fz >= -0.5 && fx <= this.nx - 0.5 && fz <= this.nz - 0.5)) return null;
    fx = Math.max(0, Math.min(this.nx - 1.0001, fx)); fz = Math.max(0, Math.min(this.nz - 1.0001, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    return [j * this.nx + i, fx - i, fz - j];
  }
  // bilinear stream at (x, z) between the snapshots (m/s, x east and z south)
  at(x, z, out) {
    const c = this._cell(x, z);
    if (!c) { out.x = 0; out.z = 0; return out; }
    const [k, u, v] = c, nx = this.nx, W = this.w;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
    const A = this.snap[0], B = this.snap[1], k0 = 2 * k, k1 = k0 + 2, k2 = k0 + 2 * nx, k3 = k2 + 2;
    const ax = A[k0] * w00 + A[k1] * w10 + A[k2] * w01 + A[k3] * w11, az = A[k0 + 1] * w00 + A[k1 + 1] * w10 + A[k2 + 1] * w01 + A[k3 + 1] * w11;
    const bx = B[k0] * w00 + B[k1] * w10 + B[k2] * w01 + B[k3] * w11, bz = B[k0 + 1] * w00 + B[k1 + 1] * w10 + B[k2 + 1] * w01 + B[k3 + 1] * w11;
    out.x = ax + (bx - ax) * W; out.z = az + (bz - az) * W;
    return out;
  }
  // the stream at (x, z) at any UTC ms, straight from the constituents (tests, the tide tables)
  atTime(x, z, ms, out = {}) {
    out.x = 0; out.z = 0;
    const cc = this._cell(x, z); if (!cc) return out;
    const [k, u, v] = cc, nx = this.nx, a = args(ms);
    const W = [[k, (1 - u) * (1 - v)], [k + 1, u * (1 - v)], [k + nx, (1 - u) * v], [k + nx + 1, u * v]];
    for (const c of this.cons) {
      const [K, S] = timeFactor(a, c);
      for (const [kk, w] of W) { out.x += w * (K * c.re[2 * kk] + (c.im ? S * c.im[2 * kk] : 0)); out.z -= w * (K * c.re[2 * kk + 1] + (c.im ? S * c.im[2 * kk + 1] : 0)); }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------
// A venue's tide at run time: the level (inverse-distance blend of the level gauges' predictions, each cached per
// game time), the chart datum and MHW fields, and the streams. clock0: UTC ms at game time t = 0.
export class Tide {
  constructor(j) {
    const b64 = (s) => { if (typeof atob === 'function') { const t = atob(s), a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a; } return new Uint8Array(Buffer.from(s, 'base64')); };
    this.meta = j;
    this.gauges = (j.gauges || []).filter(g => g.role === 'level').map(g => Object.assign(new TideStation({ name: g.name, z0: g.z0, cons: g.cons }), { x: g.x, z: g.z, cd: g.cd, mhw: g.mhw, lat: g.lat, lon: g.lon, source: g.source, lv: 0 }));
    this.ref = this.gauges[0] || null;
    if (j.streams && j.streams.cons && j.streams.cons.length) {
      const S = j.streams;
      // (the maps hold only the cells the model had water in: unpack onto the full grid)
      const n = S.nx * S.nz, wet = S.wet ? b64(S.wet) : null;
      const unpack = (str) => { const a = new Int8Array(b64(str).buffer); if (!wet) return a; const o = new Int8Array(n * 2); let p = 0; for (let k = 0; k < n; k++) if (wet[k >> 3] & (1 << (k & 7))) { o[2 * k] = a[p++]; o[2 * k + 1] = a[p++]; } return o; };
      this.streams = new TideStreams({ ...S, cons: S.cons.map(c => ({ n: c.n, s: c.s, tied: c.tied || [], re: unpack(c.re), im: c.im ? unpack(c.im) : null })) });
    } else this.streams = null;
    this.residual = j.residual || null;         // { kt, dir }: a steady non-tidal drift added to the streams
    this.clock0 = Date.now(); this.t = 0; this._lt = NaN;
  }
  get cd() { return this.ref ? this.ref.cd : 'MSL'; }
  setClock(clock0) { this.clock0 = clock0; this._lt = NaN; if (this.streams) this.streams.snapT = [NaN, NaN]; }
  // advance to game time t (cheap: the gauges' levels once a second, the stream snapshots every 20 s)
  setTime(t) {
    this.t = t;
    const q = Math.floor(t);
    if (q !== this._lt) { this._lt = q; const ms = this.clock0 + t * 1000; for (const g of this.gauges) g.lv = g.level(ms); }
    if (this.streams) this.streams.update(t, this.clock0);
  }
  now() { return this.clock0 + this.t * 1000; }
  _blend(x, z, f) {
    const G = this.gauges; if (!G.length) return 0;
    if (G.length === 1) return f(G[0]);
    let s = 0, w = 0;
    for (const g of G) { const d2 = (x - g.x) ** 2 + (z - g.z) ** 2 + 4e6, q = 1 / (d2 * d2); s += q * f(g); w += q; }
    return s / w;
  }
  // water level above MSL at (x, z), now
  levelAt(x, z) { return this.still ? 0 : this._blend(x, z, g => g.lv); }      // (still: the menu's steady current, no rise and fall)
  // chart datum below MSL, and MHW above MSL, at (x, z)
  z0At(x, z) { return this._blend(x, z, g => g.z0); }
  mhwAt(x, z) { return this._blend(x, z, g => g.mhw); }
  // the nearest level gauge (the tide curve and tables)
  gaugeNear(x, z) { let b = null, bd = Infinity; for (const g of this.gauges) { const d = (x - g.x) ** 2 + (z - g.z) ** 2; if (d < bd) { bd = d; b = g; } } return b; }
  // stream (m/s in x, z) at (x, z) now
  streamAt(x, z, out) {
    if (this.streams) this.streams.at(x, z, out); else { out.x = 0; out.z = 0; }
    if (this.residual) { const s = this.residual.kt * 0.514444, d = this.residual.dir * D2R; out.x += Math.sin(d) * s; out.z -= Math.cos(d) * s; }
    return out;
  }
}
