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
  sample(x, z, t, out = {}) {
    const p = this.puff(x, z, t);
    const g = this.gust;
    const speed = this.tws * Math.max(0.05, 1 + 0.42 * g * p);
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd);
    const along = x * fx + z * fz - this.tws * 0.9 * t;
    const cross = -x * fz + z * fx;
    const osc = 0.65 * Math.sin(2 * Math.PI * t / this.T1 + this.ph1)
              + 0.35 * Math.sin(2 * Math.PI * t / this.T2 + this.ph2);
    const spatial = noise2(along / 900, cross / 700 + 3.7, this.seed + 2);
    const dir = this.twd + this.shift * (0.75 * osc + 0.5 * spatial) + p * g * 7 * DEG; // puffs tend to veer
    out.speed = speed; out.dir = dir; out.puff = p;
    return out;
  }
}

// ---------- waves ----------
// Fetch-limited JONSWAP growth (Hasselmann 1973):
//   g Hs / U^2 = 1.6e-3 (gF/U^2)^0.5,   g Tp / U = 0.286 (gF/U^2)^(1/3)   (capped at fully developed PM)
// Spectrum discretised into Gerstner (trochoidal) components; same data drives the GPU shader.
export class WaveField {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 3;
    this.set(opts);
  }
  set(opts) {
    const U = Math.max(0.5, opts.tws ?? 6);
    const F = (opts.fetchKm ?? 8) * 1000;
    const dir = (opts.twd ?? 0);        // wind from (rad)
    const chi = G * F / (U * U);
    let Hs = 1.6e-3 * Math.sqrt(chi) * U * U / G;
    let Tp = 0.286 * Math.cbrt(chi) * U / G;
    const HsPM = 0.21 * U * U / G, TpPM = 7.14 * U / G * 1.0;
    Hs = Math.min(Hs, HsPM); Tp = Math.min(Tp, TpPM);
    Hs *= opts.seaScale ?? 1;
    this.Hs = Hs; this.Tp = Tp;
    const rnd = mulberry32(this.seed * 977 + 11);
    const comps = [];
    const fp = 1 / Math.max(Tp, 0.5);
    const ratios = [0.78, 0.88, 0.97, 1.07, 1.2, 1.36, 1.56, 1.82, 2.15, 2.6];
    const travel = dir + Math.PI; // waves travel downwind
    for (let i = 0; i < ratios.length; i++) {
      const f = fp * ratios[i];
      const f0 = fp * (i === 0 ? ratios[0] * 0.92 : (ratios[i] + ratios[i - 1]) / 2);
      const f1 = fp * (i === ratios.length - 1 ? ratios[i] * 1.1 : (ratios[i] + ratios[i + 1]) / 2);
      const df = f1 - f0;
      // Pierson-Moskowitz shape scaled to Hs, with a mild JONSWAP peak enhancement
      const S = (5 / 16) * Hs * Hs * Math.pow(fp, 4) * Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(fp / f, 4));
      const sigma = f <= fp ? 0.07 : 0.09;
      const gamma = Math.pow(3.3, Math.exp(-((f - fp) ** 2) / (2 * sigma * sigma * fp * fp)));
      const A = Math.sqrt(2 * S * gamma * df) * 0.85;
      const omega = 2 * Math.PI * f;
      const k = omega * omega / G;
      const spread = (22 + 18 * (ratios[i] - 1)) * DEG;
      const th = travel + (rnd() * 2 - 1) * spread;
      comps.push({ A, k, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0 });
    }
    // optional ocean swell (independent of local wind)
    const sw = opts.swellH ?? 0;
    if (sw > 0.01) {
      const T = opts.swellT ?? 8;
      const th = (opts.swellDir ?? dir) + Math.PI;
      for (let j = 0; j < 2; j++) {
        const omega = 2 * Math.PI / (T * (j ? 0.87 : 1));
        const a = sw / 2 * (j ? 0.45 : 0.85);
        const t2 = th + (j ? 0.18 : -0.05);
        comps.push({ A: a, k: omega * omega / G, omega, dx: Math.sin(t2), dz: -Math.cos(t2), phase: rnd() * 6.283, Q: 0 });
      }
    }
    // trochoid steepness, keeping sum(Q k A) < 1 so crests never loop
    const n = comps.length;
    for (const c of comps) c.Q = Math.min(1.0, 0.55 / Math.max(1e-6, c.k * c.A * n));
    this.comps = comps;
  }

  // Displacement of the surface point whose rest position is (x0, z0)
  _disp(x0, z0, t, o) {
    let X = 0, Z = 0, Y = 0;
    for (const c of this.comps) {
      const th = c.k * (c.dx * x0 + c.dz * z0) - c.omega * t + c.phase;
      const C = Math.cos(th), S = Math.sin(th);
      X += c.Q * c.A * c.dx * C; Z += c.Q * c.A * c.dz * C; Y += c.A * S;
    }
    o.x = X; o.z = Z; o.y = Y;
    return o;
  }

  // Full sample at world (x, z): surface height, slopes dh/dx, dh/dz, horizontal orbital velocity,
  // and the vertical velocity of the surface. Inverts the horizontal Gerstner displacement.
  sample(x, z, t, out = {}) {
    const d = { x: 0, y: 0, z: 0 };
    let x0 = x, z0 = z;
    for (let i = 0; i < 4; i++) { this._disp(x0, z0, t, d); x0 = x - d.x; z0 = z - d.z; }
    let h = 0, nx = 0, nz = 0, ny = 1, vx = 0, vz = 0, vy = 0;
    for (const c of this.comps) {
      const th = c.k * (c.dx * x0 + c.dz * z0) - c.omega * t + c.phase;
      const C = Math.cos(th), S = Math.sin(th);
      const WA = c.k * c.A;
      h += c.A * S;
      nx -= c.dx * WA * C; nz -= c.dz * WA * C; ny -= c.Q * WA * S;
      // linear deep-water orbital velocity at the surface
      vx += c.A * c.omega * c.dx * S; vz += c.A * c.omega * c.dz * S;
      vy -= c.A * c.omega * C;
    }
    // sheltered / shallow water near the shore damps the sea (same factor the GPU shader uses)
    const k = this.scaleFn ? this.scaleFn(x, z) : 1;
    out.h = h * k; out.sx = -nx / ny * k; out.sz = -nz / ny * k; out.vx = vx * k; out.vz = vz * k; out.vy = vy * k;
    return out;
  }
  height(x, z, t) { return this.sample(x, z, t, this._tmp || (this._tmp = {})).h; }
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
    this.wind = new WindField(opts);
    this.waves = new WaveField({ tws: this.wind.tws, twd: this.wind.twd, fetchKm: opts.fetchKm, swellH: opts.swellH, swellT: opts.swellT, seaScale: opts.seaScale });
    this.current = new Current({ speed: opts.currentKt ?? 0, dir: opts.currentDir ?? 90 });
    this.wavesOn = opts.wavesOn ?? true;
  }
}
