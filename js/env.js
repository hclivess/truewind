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
export class WindField {
  constructor(opts = {}) {
    this.tws = opts.tws ?? 12 * KT;         // mean speed at 10 m (m/s)
    this.twd = (opts.twd ?? 0) * DEG;       // mean "from" direction (rad)
    this.gust = opts.gust ?? 0.5;           // 0 = laminar, 1 = very puffy
    this.shift = (opts.shift ?? 8) * DEG;   // amplitude of oscillating shifts
    this.seed = opts.seed ?? 7;
    this.weather = opts.weather || null;
    this._sq = {};
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

  // Local puff factor in [-1, 1]-ish (positive = puff). Puffs are advected with the mean wind
  // and elongated along it, like cat's paws on the water.
  puff(x, z, t) {
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd);
    const adv = this.tws * 0.9 * t;
    const along = x * fx + z * fz - adv;
    const cross = -x * fz + z * fx;
    let n = 0.65 * noise2(along / 260, cross / 170, this.seed)
          + 0.35 * noise2(along / 95 + 17.3, cross / 70 - 4.1, this.seed + 1);
    n = n > 0 ? n * 1.35 : n * 0.75; // puffs are peakier than lulls
    return n;
  }

  // Sample true wind at 10 m: {speed, dir}. dir is the "from" angle (rad).
  // mean wind now (weather trend, no puffs): speed m/s and from-direction
  mean(t) {
    const tr = this.weather ? this.weather.trend(t) : { f: 1, d: 0 };
    return { speed: this.tws * tr.f, dir: this.twd + tr.d };
  }
  sample(x, z, t, out = {}) {
    const p = this.puff(x, z, t);
    const g = this.gust;
    const W = this.weather;
    const tr = W ? W.trend(t) : { f: 1, d: 0 };
    const sq = W ? W.squall(x, z, t, this._sq) : { f: 1, d: 0, rain: 0 };
    const speed = this.tws * tr.f * sq.f * Math.max(0.05, 1 + 0.42 * g * p);
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd);
    const along = x * fx + z * fz - this.tws * 0.9 * t;
    const cross = -x * fz + z * fx;
    const osc = 0.65 * Math.sin(2 * Math.PI * t / this.T1 + this.ph1)
              + 0.35 * Math.sin(2 * Math.PI * t / this.T2 + this.ph2);
    const spatial = noise2(along / 900, cross / 700 + 3.7, this.seed + 2);
    const dir = this.twd + tr.d + sq.d + this.shift * (0.75 * osc + 0.5 * spatial) + p * g * 7 * DEG; // puffs tend to veer
    out.speed = speed; out.dir = dir; out.puff = p; out.rain = sq.rain;
    return out;
  }
}

// ---------- weather ----------
// Deterministic in (seed, t): every browser in a shared world sees the same weather.
//  * trend: the gradient/sea-breeze wind drifts in speed and direction over tens of minutes
//  * squalls: convective cells travelling with the wind: a lull ahead, a veering gust front,
//    heavy rain in the core, then the wind returns.
export class Weather {
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'changing';        // steady | changing | squally
    this.seed = opts.seed ?? 11;
    const r = mulberry32(this.seed * 131 + 7);
    this.p = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    this.amp = this.mode === 'steady' ? 0 : this.mode === 'changing' ? 1 : 0.8;
    this.squallsOn = this.mode === 'squally';
    this.tws0 = opts.tws ?? 6; this.twd0 = opts.twd ?? 0;
    this.cells = [];
    if (this.squallsOn) {
      // a cell every ~9-14 minutes, arriving from upwind of the sailing area
      for (let k = 0; k < 24; k++) {
        const T = 240 + k * (540 + r() * 300);
        const R = 450 + r() * 900;
        const lateral = (r() - 0.5) * 2200;
        const strength = 0.45 + r() * 0.6;
        this.cells.push({ T, R, lateral, strength, veer: (12 + r() * 25) * DEG, dirOff: (r() - 0.3) * 30 * DEG });
      }
    }
  }
  // slow evolution of the mean wind: speed factor and direction offset
  trend(t) {
    if (!this.amp) return { f: 1, d: 0 };
    const [a, b, c, e] = this.p;
    const f = 1 + this.amp * (0.22 * Math.sin(2 * Math.PI * t / 2400 + a) + 0.1 * Math.sin(2 * Math.PI * t / 1100 + b));
    const d = this.amp * (18 * Math.sin(2 * Math.PI * t / 3000 + c) + 8 * Math.sin(2 * Math.PI * t / 1300 + e)) * DEG;
    return { f: Math.max(0.35, f), d };
  }
  // squall influence at (x, z): speed factor, direction offset, rain 0..1
  squall(x, z, t, out) {
    out.f = 1; out.d = 0; out.rain = 0; out.cloud = 0;
    if (!this.squallsOn) return out;
    const tr = this.trend(t);
    const dir = this.twd0 + tr.d;
    for (const c of this.cells) {
      const age = t - c.T;
      if (age < -1500 || age > 1500) continue;
      const md = dir + c.dirOff;                                // travels roughly with the wind
      const ux = -Math.sin(md), uz = Math.cos(md);              // direction of travel (downwind)
      const speed = this.tws0 * tr.f * 0.95;
      const s0 = speed * age;                                   // along-track position of the cell centre (0 = abeam of the area)
      const px = x * ux + z * uz - s0, lx = -x * uz + z * ux - c.lateral;
      const R = c.R, lat = Math.exp(-((lx / (1.3 * R)) ** 2));
      // ahead of the cell (px > 0) the inflow lull, at ~0.7R the gust front, the core rains
      const front = Math.exp(-(((px - 0.7 * R) / (0.45 * R)) ** 2));
      const lull = Math.exp(-(((px - 2.2 * R) / (0.9 * R)) ** 2));
      const core = Math.exp(-((px / (0.9 * R)) ** 2));
      out.f *= 1 + lat * (c.strength * front - 0.25 * lull + 0.15 * core);
      out.d += lat * front * c.veer;
      out.rain = Math.max(out.rain, lat * Math.exp(-(((px - 0.2 * R) / (0.8 * R)) ** 2)));
      out.cloud = Math.max(out.cloud, lat * Math.exp(-(((px - 0.3 * R) / (1.6 * R)) ** 2)));
    }
    return out;
  }
  // positions of the squall cells in the world now (for clouds and rain curtains)
  activeCells(t) {
    if (!this.squallsOn) return [];
    const tr = this.trend(t), dir = this.twd0 + tr.d, out = [];
    for (const c of this.cells) {
      const age = t - c.T;
      if (age < -1200 || age > 1200) continue;
      const md = dir + c.dirOff, ux = -Math.sin(md), uz = Math.cos(md);
      const s0 = this.tws0 * tr.f * 0.95 * age;
      out.push({ x: ux * s0 - uz * c.lateral, z: uz * s0 + ux * c.lateral, R: c.R });
    }
    return out;
  }
  // conditions for the sky: overall cloudiness near a point
  sky(x, z, t, out = {}) {
    this.squall(x, z, t, out);
    out.overcast = Math.max(this.mode === 'squally' ? 0.35 : this.mode === 'changing' ? 0.15 : 0.05, out.cloud);
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
export const MAXW = 20;
const hsTp = (U, F) => {
  const chi = G * F / (U * U);
  return [Math.min(1.6e-3 * Math.sqrt(chi) * U * U / G, 0.21 * U * U / G), Math.min(0.286 * Math.cbrt(chi) * U / G, 7.14 * U / G)];
};
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
    const nF = 6, dirs = [-38, -12, 12, 38];
    const comps = [];
    for (let i = 0; i < nF; i++) {
      const f = fLo * Math.pow(fHi / fLo, i / (nF - 1));
      const df = f * (Math.pow(fHi / fLo, 1 / (nF - 1)) - 1);
      const nd = i < 2 ? 2 : 3;                 // fewer directions for the long waves
      const dl = nd === 2 ? [-18, 18] : [-30, 0, 30];
      for (const dd of dl) {
        const th = this.dir0 + Math.PI + (dd + (rnd() - 0.5) * 10) * DEG;
        const omega = 2 * Math.PI * f;
        comps.push({ f, df, dth: (nd === 2 ? 36 : 30) * DEG, travel: th, A: 0, k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'sea' });
      }
    }
    const sw = opts.swellH ?? 0;
    if (sw > 0.01) {
      const T = opts.swellT ?? 8, th0 = (opts.swellDir ?? this.dir0 + 0.5) + Math.PI;
      for (let j = 0; j < 2; j++) {
        const omega = 2 * Math.PI / (T * (j ? 0.87 : 1)), th = th0 + (j ? 0.18 : -0.05);
        comps.push({ A: sw / 2 * (j ? 0.45 : 0.85), Aswell: sw / 2 * (j ? 0.45 : 0.85), k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'swell' });
      }
    }
    this.comps = comps.slice(0, MAXW);
    this.cur = { x: 0, z: 0 };
    this.depthFn = null; this.phaseField = null;
    this.update(0);
  }

  // target spectral amplitude of a component for mean wind (U, from-direction dir)
  _amp(c, U, dir) {
    const [Hs, Tp] = hsTp(Math.max(U, 0.5), this.F);
    const fp = 1 / Math.max(Tp, 0.3), f = c.f;
    const S = (5 / 16) * Hs * Hs * fp ** 4 * f ** -5 * Math.exp(-1.25 * (fp / f) ** 4);
    const sigma = f <= fp ? 0.07 : 0.09;
    const gamma = Math.pow(3.3, Math.exp(-((f - fp) ** 2) / (2 * sigma * sigma * fp * fp)));
    // cos^2s spreading about the downwind direction (s = 4), normalised over direction
    let dth = c.travel - (dir + Math.PI); while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
    const s2 = 8, D = Math.pow(Math.max(0, Math.cos(dth / 2)), s2) / 1.718;  // cos^8(θ/2) integrates to 2π·C(8,4)/2^8 = 1.718
    // PM shape scaled to Hs times the JONSWAP peak factor over-counts energy by ~1.6: renormalise
    return Math.sqrt(Math.max(0, 2 * S * gamma / 1.6 * c.df * D * c.dth)) * this.seaScale;
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
    // trochoid steepness: keep the crests from looping
    const n = this.comps.length;
    for (const c of this.comps) c.Q = Math.min(1.0, 0.55 / Math.max(1e-6, c.k * c.A * n));
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
    let X = 0, Z = 0, Y = 0;
    const h = this.depthFn ? this.depthFn(x0, z0) : null;
    let ci = 0;
    for (const c of this.comps) {
      const A = c.A * (c.curAmp ?? 1) * this._ampFactor(c, h);
      const th = (c.kRef ?? c.k) * (c.dx * x0 + c.dz * z0) + this._pf(ci++, x0, z0) - (c.omegaEff ?? c.omega) * t + c.phase;
      const C = Math.cos(th), S = Math.sin(th);
      X += c.Q * A * c.dx * C; Z += c.Q * A * c.dz * C; Y += A * S;
    }
    o.x = X; o.z = Z; o.y = Y;
    return o;
  }

  // Full sample at world (x, z): surface height, slopes, orbital velocity. Inverts the horizontal
  // Gerstner displacement; applies shoaling and the depth-limited breaking cap.
  sample(x, z, t, out = {}) {
    const d = this._d || (this._d = { x: 0, y: 0, z: 0 });
    let x0 = x, z0 = z;
    for (let i = 0; i < 3; i++) { this._disp(x0, z0, t, d); x0 = x - d.x; z0 = z - d.z; }
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
    this.weather = new Weather({ mode: opts.weather ?? 'changing', seed: (opts.seed ?? 7) * 3 + 1, tws: opts.tws ?? 6, twd: (opts.twd ?? 0) * DEG });
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
