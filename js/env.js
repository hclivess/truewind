// Environment: true-wind field (boundary layer, advected puffs, oscillating shifts),
// wind-driven sea state (fetch-limited spectrum -> Gerstner components) and tidal current.
// Conventions: world x = east, z = south, y = up. Compass angles clockwise from north.
// A "from" direction d gives a flow vector (-sin d, +cos d) in (x, z).

export const G = 9.81;
export const KT = 0.514444; // m/s per knot
export const DEG = Math.PI / 180;

// ---------- deterministic value noise (mirrored nowhere else: gust texture is baked on CPU) ----------
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function smooth(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
export function noise2(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const u = smooth(fx), v = smooth(fy);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1; // [-1, 1]
}
// 3-D value noise, the third axis being time (puffs are born, travel and die). Also leaves the analytic
// derivative along y in _dny (the cross-wind gradient of a puff, which sets how it fans out).
let _dny = 0;
function hash3(ix, iy, iz, seed) { return hash2(ix ^ Math.imul(iz, 1540483477), iy, seed); }
function noise3d(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = smooth(fx), v = smooth(fy), w = smooth(fz), dv = 30 * fy * fy * (fy - 1) * (fy - 1);
  const a0 = hash3(ix, iy, iz, seed), b0 = hash3(ix + 1, iy, iz, seed), c0 = hash3(ix, iy + 1, iz, seed), d0 = hash3(ix + 1, iy + 1, iz, seed);
  const a1 = hash3(ix, iy, iz + 1, seed), b1 = hash3(ix + 1, iy, iz + 1, seed), c1 = hash3(ix, iy + 1, iz + 1, seed), d1 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const lo0 = a0 + (b0 - a0) * u, hi0 = c0 + (d0 - c0) * u, lo1 = a1 + (b1 - a1) * u, hi1 = c1 + (d1 - c1) * u;
  const p0 = lo0 + (hi0 - lo0) * v, p1 = lo1 + (hi1 - lo1) * v;
  _dny = 2 * ((hi0 - lo0) * (1 - w) + (hi1 - lo1) * w) * dv;
  return (p0 + (p1 - p0) * w) * 2 - 1;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- wind ----------
// Neutral atmospheric surface layer: U(h) = U10 * ln(h/z0) / ln(10/z0).
// Charnock roughness over open water, z0 = 0.011 u*^2 / g, solved by fixed point.
const P_MEAN = 0.08;  // mean of the skewed puff noise (removed so the slider's wind is the mean wind)
const GAMP = 0.96;    // puff amplitude per unit of the gust setting
const FAN = 0.28;     // puff fanning (lateral outflow per unit cross-wind gradient)
const TR0 = Object.freeze({ f: 1, d: 0 }), SQ0 = Object.freeze({ f: 1, d: 0, rain: 0 });
export class WindField {
  constructor(opts = {}) {
    this.tws = opts.tws ?? 12 * KT;         // mean speed at 10 m (m/s)
    this.twd = (opts.twd ?? 0) * DEG;       // mean "from" direction (rad)
    this.gust = opts.gust ?? 0.5;           // 0 = laminar, 1 = very puffy
    this.shift = (opts.shift ?? 8) * DEG;   // amplitude of oscillating shifts
    this.seed = opts.seed ?? 7;
    this.hemi = opts.hemi ?? 1;             // +1 northern hemisphere, -1 southern (puffs veer in the north, back in the south)
    this.weather = opts.weather || null;
    this._sq = {};
    // puff size: the eddies grow with the wind (a deeper, more turbulent boundary layer), so the period at a
    // fixed point (~L/U) falls less than 1/U: ~90 s in 6 kn, ~55 s in 12 kn, ~35 s in 25 kn
    const Ls = 0.6 + 0.4 * Math.min(3, this.tws / 6);
    this.L1 = 150 * Ls; this.L2 = 55 * Ls;
    this.life = 4 * this.L1 / Math.max(1.5, this.tws);   // s per time-lattice step: a puff lives ~1-3 minutes
    const r = mulberry32(this.seed * 31 + 5);
    this.ph1 = r() * 6.28; this.ph2 = r() * 6.28; this.ph3 = r() * 6.28;
    this.T1 = 180 + r() * 120; this.T2 = 60 + r() * 50;
    this.updateRoughness();
  }
  updateRoughness() {
    let z0 = 2e-4;
    for (let i = 0; i < 8; i++) {
      const ustar = 0.41 * this.tws / Math.log(10 / z0);
      z0 = Math.max(1e-5, 0.011 * ustar * ustar / G);
    }
    this.z0 = z0;
    this.lnRef = Math.log(10 / z0);
  }
  profile(h) {
    return Math.log(Math.max(h, 0.3) / this.z0) / this.lnRef;
  }
  // Mean flow unit vector (x, z)
  flowDir() { return [-Math.sin(this.twd), Math.cos(this.twd)]; }

  // Local puff factor, zero-mean, roughly [-0.6, 1.2] (positive = puff). Puffs are advected with the wind
  // and elongated along it, like cat's paws on the water; the big ones (brought down from aloft) travel a
  // little faster than the mean wind, the small ones slower, and each one grows and dies as it goes.
  // Leaves the cross-wind gradient (1/m) in this._dp.
  puff(x, z, t) {
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd), U = this.tws;
    const a0 = x * fx + z * fz, cross = -x * fz + z * fx;
    const a1 = (a0 - 1.05 * U * t) / this.L1, a2 = (a0 - 0.85 * U * t) / this.L2, tl = t / this.life;
    // the time lattice is sheared along the wind so the field never goes quiet everywhere at once
    let n = 0.65 * noise3d(a1, cross / (0.65 * this.L1), tl + 0.37 * a1, this.seed);
    let dn = 0.65 * _dny / (0.65 * this.L1);
    n += 0.35 * noise3d(a2 + 17.3, cross / (0.7 * this.L2) - 4.1, 1.6 * tl + 0.37 * a2, this.seed + 1);
    const k = n > 0 ? 1.35 : 0.75;   // puffs are peakier than lulls
    this._dp = dn * k;              // (the big puffs only: the small ones are too short-lived to fan)
    return n * k - P_MEAN;
  }

  // Sample true wind at 10 m: {speed, dir}. dir is the "from" angle (rad).
  // mean wind now (weather trend, no puffs): speed m/s and from-direction
  mean(t) {
    const tr = this.weather ? this.weather.trend(t) : { f: 1, d: 0 };
    return { speed: this.tws * tr.f, dir: this.twd + tr.d };
  }
  sample(x, z, t, out = {}) {
    const p = this.puff(x, z, t), dp = this._dp;
    const g = this.gust, U = this.tws;
    const W = this.weather;
    const tr = W ? W.trend(t) : TR0;
    const sq = W ? W.squall(x, z, t, this._sq) : SQ0;
    // turbulence intensity ~0.14 g: the gust factor (peak 3-s gust / 10-min mean) comes out ~1 + 0.8 g,
    // the ratio forecasts quote (1.3-1.5 at sea for g ~ 0.4-0.6)
    const speed = U * tr.f * sq.f * Math.max(0.05, 1 + GAMP * g * p);
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd);
    const a0 = x * fx + z * fz, cross = -x * fz + z * fx;
    // oscillating shifts are carried downwind with the wind: the boat to windward gets each one first
    const ts = t - a0 / Math.max(1, U);
    const osc = 0.65 * Math.sin(2 * Math.PI * ts / this.T1 + this.ph1)
              + 0.35 * Math.sin(2 * Math.PI * ts / this.T2 + this.ph2);
    const spatial = noise2((a0 - 0.9 * U * t) / 900, cross / 700 + 3.7, this.seed + 2);
    // puffs come down from aloft carrying veered wind (backed south of the equator) and fan out as they
    // land: lifted on one edge, headed on the other (outflow down the puff's cross-wind gradient)
    const dir = this.twd + tr.d + sq.d + this.shift * (0.75 * osc + 0.5 * spatial)
              + this.hemi * p * g * 7 * DEG - Math.atan(FAN * g * this.L1 * dp);
    out.speed = speed; out.dir = dir; out.puff = p; out.rain = sq.rain;
    return out;
  }
}

// ---------- weather ----------
// Deterministic in (seed, t): every browser in a shared world sees the same weather.
//  * trend: the gradient/sea-breeze wind drifts in speed and direction over tens of minutes
//  * squalls: cumulonimbus cells, one every ~11 minutes for as long as the session lasts, each born,
//    maturing and dying over ~70 minutes while it tracks across with the steering wind (veered from the
//    surface wind north of the equator, backed south of it). The surface wind is the ambient wind plus
//    the cell's own flow: inflow toward the updraft ahead of it (a lull), the cold outflow spreading
//    from the downdraft under the core (the gust front: a burst of wind, veered on one flank and backed
//    on the other), heavy rain in the core, and light, fitful air in the cold pool behind.
const CELL_EVERY = 690, CELL_LIFE = 2100;   // s between squalls; half-life-span of one cell
export class Weather {
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'changing';        // steady | changing | squally
    this.seed = opts.seed ?? 11;
    this.hemi = opts.hemi ?? 1;
    const r = mulberry32(this.seed * 131 + 7);
    this.p = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    this.amp = this.mode === 'steady' ? 0 : this.mode === 'changing' ? 1 : 0.8;
    this.squallsOn = this.mode === 'squally';
    this.tws0 = opts.tws ?? 6; this.twd0 = opts.twd ?? 0;
    this._cells = new Map();
    this._tt = NaN; this._tf = 1; this._td = 0;
  }
  // slow evolution of the mean wind: speed factor and direction offset (cached per t: the wind field asks
  // for it at every sample, and a frame samples thousands of points at one t)
  trend(t) {
    if (!this.amp) return { f: 1, d: 0 };
    if (t !== this._tt) {
      const [a, b, c, e] = this.p;
      const f = 1 + this.amp * (0.22 * Math.sin(2 * Math.PI * t / 2400 + a) + 0.1 * Math.sin(2 * Math.PI * t / 1100 + b));
      this._td = this.amp * (18 * Math.sin(2 * Math.PI * t / 3000 + c) + 8 * Math.sin(2 * Math.PI * t / 1300 + e)) * DEG;
      this._tf = Math.max(0.35, f); this._tt = t;
    }
    return { f: this._tf, d: this._td };
  }
  // the k-th squall: a pure function of (seed, k). It is abeam of the sailing area at time T, on a
  // straight track fixed by the steering wind at that time.
  cell(k) {
    let c = this._cells.get(k);
    if (c) return c;
    const r = mulberry32((this.seed * 131 + 7 + Math.imul(k + 1, 2654435761)) >>> 0);
    const T = 240 + k * CELL_EVERY + (r() - 0.5) * 300;
    const R = 450 + r() * 900;                                   // radius of the downdraft / rain core (m)
    const lateral = (r() - 0.5) * 2200;
    const strength = 0.45 + r() * 0.6;
    const tr = this.trend(T);
    const dir = this.twd0 + tr.d + this.hemi * (5 + r() * 20) * DEG;
    // cells ride the wind a few km up, which outruns a light surface breeze
    const speed = 3 + 0.8 * this.tws0 * tr.f;
    c = { k, T, R, lateral, strength, ux: -Math.sin(dir), uz: Math.cos(dir), speed };
    if (this._cells.size > 64) this._cells.clear();
    this._cells.set(k, c);
    return c;
  }
  // cells alive at time t: calls fn(cell, age, life 0..1)
  _eachCell(t, fn) {
    const k0 = Math.max(0, Math.floor((t - 240 - CELL_LIFE - 150) / CELL_EVERY));
    const k1 = Math.floor((t - 240 + CELL_LIFE + 150) / CELL_EVERY) + 1;
    for (let k = k0; k <= k1; k++) {
      const c = this.cell(k), age = t - c.T;
      if (age <= -CELL_LIFE || age >= CELL_LIFE) continue;
      const q = 1 - (age / CELL_LIFE) ** 2;
      fn(c, age, q * q);
    }
  }
  // squall influence at (x, z): speed factor f and direction change d against the ambient wind, rain 0..1,
  // cloud 0..1 (under the cell's cloud), cold 0..1 (inside the rain-cooled outflow)
  squall(x, z, t, out) {
    out.f = 1; out.d = 0; out.rain = 0; out.cloud = 0; out.cold = 0;
    if (!this.squallsOn) return out;
    const tr = this.trend(t), dir = this.twd0 + tr.d, U = Math.max(0.5, this.tws0 * tr.f);
    const fx = -Math.sin(dir), fz = Math.cos(dir);
    let vx = 0, vz = 0;                                          // the cells' own flow (m/s)
    const k0 = Math.max(0, Math.floor((t - 240 - CELL_LIFE - 150) / CELL_EVERY));
    const k1 = Math.floor((t - 240 + CELL_LIFE + 150) / CELL_EVERY) + 1;
    for (let k = k0; k <= k1; k++) {
      const c = this.cell(k), age = t - c.T;
      if (age <= -CELL_LIFE || age >= CELL_LIFE) continue;
      const q = 1 - (age / CELL_LIFE) ** 2, w = q * q;          // born, matures, dies
      const R = c.R;
      const px = x * c.ux + z * c.uz - c.speed * age;            // along track from the core (+ = ahead)
      const lx = -x * c.uz + z * c.ux - c.lateral;
      if (px > 5 * R || px < -4.5 * R || Math.abs(lx) > 4 * R) continue;
      // outflow from the downdraft, radial, peaking at the gust front (~1 R out, 1.5 R ahead since the
      // cold pool is carried along with the cell) and dying away a couple of radii beyond it
      // (the outflow running back against the ambient wind is much weaker: light, fitful air behind)
      const ex = px > 0 ? px / 1.5 : px, rr = Math.hypot(ex, lx) / R;
      const A = w * c.strength * (4 + 0.5 * U);                  // squalls bring wind even into a calm
      const m = rr > 1e-4 ? A * rr * Math.exp(1 - rr * rr) / (rr * R) : 0;  // (m/s per metre of ex, lx)
      let ua = m * ex * (px > 0 ? 1 : 0.4), ul = m * lx;
      // ahead of the gust front the updraft draws the surface air in toward the cell: the lull
      ua -= w * c.strength * 0.35 * U * Math.exp(-(((px - 2.6 * R) / (1.1 * R)) ** 2) - (lx / (1.4 * R)) ** 2);
      vx += ua * c.ux - ul * c.uz; vz += ua * c.uz + ul * c.ux;
      out.rain = Math.max(out.rain, w * Math.exp(-(((px - 0.15 * R) / (0.75 * R)) ** 2) - (lx / R) ** 2));
      out.cloud = Math.max(out.cloud, w * Math.exp(-(((px - 0.3 * R) / (1.8 * R)) ** 2) - (lx / (1.6 * R)) ** 2));
      out.cold = Math.max(out.cold, w * (rr < 1 ? 1 : Math.exp(-4 * (rr - 1) ** 2)));
    }
    if (vx !== 0 || vz !== 0) {
      const ax = fx * U + vx, az = fz * U + vz;
      out.f = Math.max(0.05, Math.hypot(ax, az) / U);
      out.d = Math.atan2(fx * az - fz * ax, fx * ax + fz * az);   // + = veer (clockwise), matching "from" angles
    }
    return out;
  }
  // the squall cells in the world now (for the towers, anvils and rain shafts): centre, core radius, life 0..1
  activeCells(t) {
    if (!this.squallsOn) return [];
    const out = [];
    this._eachCell(t, (c, age, w) => {
      const s0 = c.speed * age;
      out.push({ x: c.ux * s0 - c.uz * c.lateral, z: c.uz * s0 + c.ux * c.lateral, R: c.R, w });
    });
    // the most developed first (the sky draws four)
    return out.sort((a, b) => b.w - a.w);
  }
  // conditions for the sky: overall cloudiness near a point. Fresh breezes bring more cloud (a gale is
  // a grey stratocumulus sky), squally weather an unsettled, broken sky between the cells.
  sky(x, z, t, out = {}) {
    this.squall(x, z, t, out);
    const kt = this.tws0 * this.trend(t).f / KT;
    const base = (this.mode === 'squally' ? 0.35 : this.mode === 'changing' ? 0.15 : 0.05)
               + 0.6 * Math.min(1, Math.max(0, (kt - 16) / 22));
    out.overcast = Math.max(Math.min(0.85, base), out.cloud);
    return out;
  }
}

// ---------- waves ----------
// A directional wind-sea spectrum (Pierson-Moskowitz with JONSWAP peak enhancement, cos^2s spreading)
// discretised into Gerstner components with fixed frequency and direction. Each component's
// energy follows the wind with a lag that grows with wavelength (short chop answers in a minute,
// the long waves in many), so the sea builds after the wind does, decays slower, and a wind
// shift raises a new sea across the old one. The same components drive the GPU water.
// Finite depth: waves shorten and slow over the bottom (dispersion w^2 = g k tanh kh, integrated
// along each component's direction into a phase field), grow as they shoal (Ks = sqrt(cg0/cg))
// and break when H > 0.78 h. Current: Doppler-shifted frequency, steepening against the tide.
// Discretisation: every wind-sea component has its OWN frequency (log-spaced bins, jittered inside the
// bin) and its own direction (a low-discrepancy spread about the wind), so no two components share a
// wavelength: the sea has no repeat pattern, no moire bands and long irregular crests in groups.
// Each component carries the whole spectral energy of its frequency bin (integrated, so the narrow
// JONSWAP peak is not missed between bins) weighted by the spreading function at its direction.
export const MAXW = 20;
const hsTp = (U, F) => {
  const chi = G * F / (U * U);
  return [Math.min(1.6e-3 * Math.sqrt(chi) * U * U / G, 0.21 * U * U / G), Math.min(0.286 * Math.cbrt(chi) * U / G, 7.14 * U / G)];
};
const jonswapShape = (x) => {            // x = f / fp; PM shape times the JONSWAP (gamma 3.3) peak factor
  const sg = x <= 1 ? 0.07 : 0.09;
  return x ** -5 * Math.exp(-1.25 * x ** -4) * Math.pow(3.3, Math.exp(-((x - 1) ** 2) / (2 * sg * sg)));
};
// integral of the shape over f/fp: the spectrum is normalised so it integrates to exactly Hs^2 / 16
const JS_INT = (() => { let s = 0; for (let x = 0.3; x < 12; x += 0.0005) s += jonswapShape(x) * 0.0005; return s; })();
// cos^8(θ/2) spreading, normalised over the circle; spreadP(w) = the share of energy within ±w
const spreadD = (dth) => Math.pow(Math.max(0, Math.cos(dth / 2)), 8) / 1.718;
const spreadP = (w) => { let s = 0; const n = 64; for (let i = 0; i < n; i++) s += spreadD(-w + (i + 0.5) * 2 * w / n) * 2 * w / n; return s; };
const QMAX = 0.8;   // sum of k·A·Q over the sea: crests sharpen as far as they can without ever looping
export class WaveField {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 3;
    this.set(opts);
  }
  set(opts) {
    this.opts = opts;
    const U0 = Math.max(0.5, opts.tws ?? 6);
    this.U0 = U0;
    this.F = (opts.fetchKm ?? 8) * 1000;
    this.dir0 = opts.twd ?? 0;                   // wind from (rad)
    this.weather = opts.weather || null;
    this.seaScale = opts.seaScale ?? 1;
    const rnd = mulberry32(this.seed * 977 + 11);
    // frequency bins cover the peak for the whole range of wind the weather can bring
    const [, TpLo] = hsTp(U0 * 0.55, this.F), [, TpHi] = hsTp(U0 * 1.55, this.F);
    const fLo = 0.8 / Math.max(TpHi, 0.5), fHi = 2.6 / Math.max(TpLo, 0.4);
    const sw = opts.swellH ?? 0, nSw = sw > 0.01 ? 2 : 0, nS = MAXW - nSw;
    const comps = [], ratio = fHi / fLo, ph0 = rnd();
    for (let i = 0; i < nS; i++) {
      const fa = fLo * Math.pow(ratio, i / nS), fb = fLo * Math.pow(ratio, (i + 1) / nS);
      const f = fa * Math.pow(fb / fa, 0.2 + 0.6 * rnd());
      // spreading: the long waves near the peak run close to the wind, the short ones fan out
      const w = (28 + 34 * i / (nS - 1)) * DEG;
      const u = (ph0 + i * 0.6180339887) % 1;                     // golden-ratio sequence: neighbours differ
      const dd = (2 * u - 1) * w;
      const th = this.dir0 + Math.PI + dd;
      const omega = 2 * Math.PI * f;
      comps.push({ f, fa, fb, dd, wSpread: 2 * w / spreadP(w), travel: th, A: 0, k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'sea' });
    }
    if (nSw) {
      // the slider is the swell's significant height: 4·sqrt(Σ A²/2) = sw
      const T = opts.swellT ?? 8, th0 = (opts.swellDir ?? this.dir0 + 0.5) + Math.PI, r = [0.85, 0.45];
      const a0 = sw / Math.sqrt(8 * (r[0] ** 2 + r[1] ** 2));
      for (let j = 0; j < 2; j++) {
        const omega = 2 * Math.PI / (T * (j ? 0.87 : 1)), th = th0 + (j ? 0.18 : -0.05);
        comps.push({ A: a0 * r[j], Aswell: a0 * r[j], k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'swell' });
      }
    }
    this.comps = comps;
    this.cur = { x: 0, z: 0 };
    this.depthFn = null; this.phaseField = null;
    this.update(0);
  }

  // target spectral amplitude of a component for mean wind (U, from-direction dir)
  _amp(c, U, dir) {
    const [Hs, Tp] = hsTp(Math.max(U, 0.5), this.F);
    const fp = 1 / Math.max(Tp, 0.3);
    // energy of the component's frequency bin: the JONSWAP spectrum (normalised to Hs^2/16) integrated
    const n = 8, xa = c.fa / fp, xb = c.fb / fp, r = Math.pow(xb / xa, 1 / n);
    let E = 0;
    for (let i = 0, x = xa; i < n; i++, x *= r) E += jonswapShape(x * Math.sqrt(r)) * x * (r - 1);
    E *= Hs * Hs / 16 / JS_INT;
    // cos^2s spreading about the downwind direction: the component stands for directions within ±w
    let dth = c.travel - (dir + Math.PI); while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
    return Math.sqrt(Math.max(0, 2 * E * spreadD(dth) * c.wSpread)) * this.seaScale;
  }

  // Deterministic sea state at time t: each component answers to the wind it felt tau seconds ago.
  update(t) {
    const W = this.weather;
    let Hs2 = 0;
    for (const c of this.comps) {
      if (c.kind === 'swell') { c.A = c.Aswell; Hs2 += c.A * c.A; continue; }
      const cg = G / (4 * Math.PI * c.f);                       // deep-water group speed
      const tau = Math.min(1500, 45 + 0.4 * this.F / cg * 0.05 + 25 / (c.f * c.f));   // growth lag, s
      const tr = W ? W.trend(t - tau) : { f: 1, d: 0 };
      const trNow = W ? W.trend(t) : tr;
      // grows toward the lagged wind; a falling wind lets the sea decay more slowly still
      const U = this.U0 * Math.max(tr.f, Math.min(trNow.f, tr.f) + 0.5 * Math.max(0, tr.f - trNow.f));
      c.A = this._amp(c, U, this.dir0 + tr.d);
      Hs2 += c.A * c.A;
    }
    this.Hs = 4 * Math.sqrt(Hs2 / 2);
    // trochoid steepness: full Gerstner sharpness (Q = 1) unless the summed steepness could fold a crest
    let sK = 0;
    for (const c of this.comps) sK += c.k * c.A * (c.curAmp ?? 1);
    const q = Math.min(1, QMAX / Math.max(1e-6, sK));
    let sJ = 0;
    for (const c of this.comps) { c.Q = q; sJ += (q * c.k * c.A) ** 2 / 2; }
    this.jSigma = Math.sqrt(sJ);          // rms crest compression (1 - Jacobian): whitecap statistics
    let best = null; for (const c of this.comps) if (c.kind === 'sea' && (!best || c.A > best.A)) best = c;
    this.Tp = best ? 1 / best.f : 0;
    return this;
  }

  // mean current (uniform part) for the Doppler shift and wave-current steepening
  setCurrent(cx, cz) {
    this.cur.x = cx; this.cur.z = cz;
    for (const c of this.comps) {
      const Ud = cx * c.dx + cz * c.dz;                          // current along the wave direction
      const cph = c.omega / c.k;
      c.omegaEff = c.omega + c.k * Ud;                            // Doppler shift
      c.curAmp = 1 / Math.sqrt(Math.max(0.35, 1 + 2 * Ud / cph)); // opposing current steepens the sea
    }
  }

  // Finite-depth phase field: integrate (k(h) - k_deep) along each component's direction.
  buildDepthField(world) {
    for (const c of this.comps) c.kRef = c.k;
    if (!world || world.open) { this.depthFn = null; this.phaseField = null; return; }
    this.depthFn = (x, z) => Math.max(0.05, world.depthAt(x, z));
    const Nn = 96, R = world.R, cs = 2 * R / Nn;
    this.pfN = Nn; this.pfR = R;
    const depth = new Float32Array(Nn * Nn);
    for (let j = 0; j < Nn; j++) for (let i = 0; i < Nn; i++) { const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs; depth[j * Nn + i] = world.sdfAt(x, z) > 0 ? Math.max(0.05, world.depthAt(x, z)) : -1; }
    this.depthGrid = depth;
    // each component takes the wavenumber of the venue's typical water depth as its base; the field
    // only stores the (small, smooth) residual where the depth departs from it
    const wet = Array.from(depth).filter(h => h > 0.05).sort((a, b) => a - b);
    const hTyp = wet.length ? wet[Math.floor(wet.length / 2)] : 99;
    for (const c of this.comps) c.kRef = kOfDepth(c.omega, hTyp);
    this.hTyp = hTyp;
    const fields = [];
    const dg = (x, z) => { const i = Math.floor((x + R) / cs), j = Math.floor((z + R) / cs); return (i < 0 || j < 0 || i >= Nn || j >= Nn) ? 99 : depth[j * Nn + i]; };
    for (const c of this.comps) {
      const phi = new Float32Array(Nn * Nn);
      const kd = c.kRef;
      // march each cell back along the wave direction to the upwave map edge
      for (let j = 0; j < Nn; j++) for (let i = 0; i < Nn; i++) {
        let x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs, acc = 0;
        for (let s = 0; s < 2 * R; s += cs) {
          const h = dg(x, z);
          if (h < 0) break;                           // waves do not cross land: this sea starts at the shore
          acc += (kOfDepth(c.omega, Math.max(0.3, h)) - kd) * cs;
          x -= c.dx * cs; z -= c.dz * cs;
          if (Math.abs(x) > R || Math.abs(z) > R) break;
        }
        phi[j * Nn + i] = acc;
      }
      fields.push(phi);
    }
    this.phaseField = fields;
  }
  _pf(ci, x, z) {
    const F = this.phaseField; if (!F) return 0;
    const Nn = this.pfN, R = this.pfR, cs = 2 * R / Nn;
    let fx = (x + R) / cs - 0.5, fz = (z + R) / cs - 0.5;
    fx = Math.max(0, Math.min(Nn - 1.001, fx)); fz = Math.max(0, Math.min(Nn - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = F[ci], k = j * Nn + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + Nn] * (1 - u) + a[k + Nn + 1] * u) * v;
  }
  // local amplitude factor for component c at depth h: shoaling, and nothing in the dry
  _ampFactor(c, h) {
    if (h === null) return 1;
    const kh = kOfDepth(c.omega, h) * h;
    const n = 0.5 * (1 + 2 * kh / Math.sinh(Math.min(2 * kh, 40)));
    const cgRatio = n * Math.tanh(kh) / 0.5;            // cg(h) / cg(deep)
    return Math.min(2.2, 1 / Math.sqrt(Math.max(0.2, cgRatio)));
  }

  _disp(x0, z0, t, o) {
    let X = 0, Z = 0, Y = 0, xx = 0, xz = 0, zz = 0;
    const h = this.depthFn ? this.depthFn(x0, z0) : null;
    let ci = 0;
    for (const c of this.comps) {
      const A = c.A * (c.curAmp ?? 1) * this._ampFactor(c, h);
      const th = (c.kRef ?? c.k) * (c.dx * x0 + c.dz * z0) + this._pf(ci++, x0, z0) - (c.omegaEff ?? c.omega) * t + c.phase;
      const C = Math.cos(th), S = Math.sin(th);
      const QA = c.Q * A, QAkS = QA * (c.kRef ?? c.k) * S;
      X += QA * c.dx * C; Z += QA * c.dz * C; Y += A * S;
      xx += QAkS * c.dx * c.dx; xz += QAkS * c.dx * c.dz; zz += QAkS * c.dz * c.dz;
    }
    // o.jxx.. = d(displacement)/d(x0): the Jacobian of the Gerstner map minus the identity
    o.x = X; o.z = Z; o.y = Y; o.jxx = -xx; o.jxz = -xz; o.jzz = -zz;
    return o;
  }

  // Full sample at world (x, z): surface height, slopes, orbital velocity. Inverts the horizontal
  // Gerstner displacement; applies shoaling and the depth-limited breaking cap.
  sample(x, z, t, out = {}) {
    const d = this._d || (this._d = { x: 0, y: 0, z: 0 });
    // Newton on x0 + D(x0) = x (sharp crests make the plain fixed-point iteration converge slowly)
    let x0 = x, z0 = z;
    for (let i = 0; i < 3; i++) {
      this._disp(x0, z0, t, d);
      const fx = x0 + d.x - x, fz = z0 + d.z - z;
      const a = 1 + d.jxx, b = d.jxz, e = 1 + d.jzz, det = a * e - b * b;
      if (det > 0.05) { x0 -= (e * fx - b * fz) / det; z0 -= (a * fz - b * fx) / det; }
      else { x0 -= fx; z0 -= fz; }
      if (fx * fx + fz * fz < 1e-4) break;
    }
    const h = this.depthFn ? this.depthFn(x0, z0) : null;
    let hsum = 0, nx = 0, nz = 0, ny = 1, vx = 0, vz = 0, vy = 0, a2 = 0;
    let ci = 0;
    for (const c of this.comps) {
      const A = c.A * (c.curAmp ?? 1) * this._ampFactor(c, h);
      a2 += A * A;
      const kk = h === null ? c.k : kOfDepth(c.omega, h);
      const th = (c.kRef ?? c.k) * (c.dx * x0 + c.dz * z0) + this._pf(ci++, x0, z0) - (c.omegaEff ?? c.omega) * t + c.phase;
      const C = Math.cos(th), S = Math.sin(th);
      const WA = kk * A;
      hsum += A * S;
      nx -= c.dx * WA * C; nz -= c.dz * WA * C; ny -= c.Q * WA * S;
      const orb = h === null ? 1 : 1 / Math.max(0.3, Math.tanh(kk * h)); // orbital velocity grows in shallow water
      vx += A * c.omega * c.dx * S * orb; vz += A * c.omega * c.dz * S * orb;
      vy -= A * c.omega * C;
    }
    // depth-limited breaking: significant height cannot exceed 0.78 h
    let k = this.scaleFn ? this.scaleFn(x, z) : 1;
    if (h !== null) { const Hs = 4 * Math.sqrt(a2 / 2); if (Hs > 0.78 * h) k *= 0.78 * h / Hs; }
    out.h = hsum * k; out.sx = -nx / ny * k; out.sz = -nz / ny * k; out.vx = vx * k; out.vz = vz * k; out.vy = vy * k;
    out.breaking = h !== null ? clamp01(4 * Math.sqrt(a2 / 2) / (0.78 * h) - 0.7) : 0;
    out.j = ny;                    // crest compression (Gerstner Jacobian): the water shader's whitecap measure
    return out;
  }
  height(x, z, t) { return this.sample(x, z, t, this._tmp || (this._tmp = {})).h; }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// wavenumber for angular frequency w at depth h (Eckart's approximation of w^2 = g k tanh(k h))
export function kOfDepth(w, h) {
  const k0 = w * w / G;
  if (h > 30 || h === null) return k0;
  return k0 / Math.sqrt(Math.tanh(k0 * h));
}

// ---------- tidal current ----------
export class Current {
  constructor(opts = {}) {
    this.speed = (opts.speed ?? 0) * KT;
    this.dir = (opts.dir ?? 90) * DEG; // direction the current flows TOWARD
  }
  at(x, z, out = {}) {
    // slightly stronger in "deep water" to the east of the course — a real tactical feature
    const s = this.speed * (1 + 0.25 * Math.tanh(x / 400));
    out.x = Math.sin(this.dir) * s; out.z = -Math.cos(this.dir) * s;
    return out;
  }
}

export class Environment {
  constructor(opts = {}) {
    this.opts = opts;
    this.weather = new Weather({ mode: opts.weather ?? 'changing', seed: (opts.seed ?? 7) * 3 + 1, tws: opts.tws ?? 6, twd: (opts.twd ?? 0) * DEG, hemi: opts.hemi });
    this.wind = new WindField({ ...opts, weather: this.weather });
    this.waves = new WaveField({ tws: this.wind.tws, twd: this.wind.twd, fetchKm: opts.fetchKm, swellH: opts.swellH, swellT: opts.swellT, seaScale: opts.seaScale, weather: this.weather, seed: (opts.seed ?? 3) + 5 });
    this.current = new Current({ speed: opts.currentKt ?? 0, dir: opts.currentDir ?? 90 });
    const c0 = this.current.at(0, 0, {});
    this.waves.setCurrent(c0.x, c0.z);
    this.wavesOn = opts.wavesOn ?? true;
    this._lastWaveT = -1e9;
  }
  // advance the slowly-changing sea state (cheap; call every frame)
  tick(t) {
    if (Math.abs(t - this._lastWaveT) > 1) { this.waves.update(t); this._lastWaveT = t; return true; }
    return false;
  }
}
