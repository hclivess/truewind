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
const TR0 = Object.freeze({ f: 1, d: 0 }), SQ0 = Object.freeze({ f: 1, d: 0, rain: 0, cold: 0 });
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
    const gs = this.gust, U = this.tws;
    const W = this.weather;
    const tr = W ? W.synoptic(t) : TR0;
    const sq = W ? W.squall(x, z, t, this._sq) : SQ0;
    // the gradient wind here, combined as vectors with the local thermal breeze (sea/lake breeze by day,
    // land breeze by night) and its stability (a convective day mixes gusts down, a stable night damps them)
    let base = U * tr.f, dir0 = this.twd + tr.d, g = gs, shift = this.shift;
    if (W && W.thermal) {
      const th = W.thermal.at(x, z, t, base, this._th || (this._th = {}));
      const c = combineThermal(base, dir0, th);
      base = c.speed; dir0 = c.dir; g *= 1 + 0.4 * th.st; shift *= 1 + 0.25 * th.st;
    }
    // turbulence intensity ~0.14 g: the gust factor (peak 3-s gust / 10-min mean) comes out ~1 + 0.8 g,
    // the ratio forecasts quote (1.3-1.5 at sea for g ~ 0.4-0.6)
    const speed = base * sq.f * Math.max(0.05, 1 + GAMP * g * p);
    const fx = -Math.sin(this.twd), fz = Math.cos(this.twd);
    const a0 = x * fx + z * fz, cross = -x * fz + z * fx;
    // oscillating shifts are carried downwind with the wind: the boat to windward gets each one first
    const ts = t - a0 / Math.max(1, U);
    const osc = 0.65 * Math.sin(2 * Math.PI * ts / this.T1 + this.ph1)
              + 0.35 * Math.sin(2 * Math.PI * ts / this.T2 + this.ph2);
    const spatial = noise2((a0 - 0.9 * U * t) / 900, cross / 700 + 3.7, this.seed + 2);
    // puffs come down from aloft carrying veered wind (backed south of the equator) and fan out as they
    // land: lifted on one edge, headed on the other (outflow down the puff's cross-wind gradient)
    const dir = dir0 + sq.d + shift * (0.75 * osc + 0.5 * spatial)
              + this.hemi * p * g * 7 * DEG - Math.atan(FAN * g * this.L1 * dp);
    out.speed = speed; out.dir = dir; out.puff = p; out.rain = sq.rain;
    out.cold = sq.cold;
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
    this.thermal = null; this._ct = NaN;
  }
  // share of the sky's cloud from the weather type alone (fair-weather cumulus up to an unsettled sky)
  cloudBase() { return this.mode === 'squally' ? 0.35 : this.mode === 'changing' ? 0.15 : 0.05; }
  // mean wind at the sailing area now: the gradient trend combined (as vectors) with the venue's thermal
  // breeze at its reference point. Speed factor f against tws0 and direction offset d against twd0. Without
  // a thermal (open water, tests) this is the gradient trend itself. The sea follows this wind.
  trend(t) {
    if (!this.thermal) return this.synoptic(t);
    if (t !== this._ct) {
      const s = this.synoptic(t), th = this.thermal.at(this.thermal.refX, this.thermal.refZ, t, this.tws0 * s.f, this._cth || (this._cth = {}));
      const c = combineThermal(this.tws0 * s.f, this.twd0 + s.d, th);
      this._ct = t; this._cf = c.speed / Math.max(1e-3, this.tws0); this._cd = c.dir - this.twd0;
    }
    return { f: this._cf, d: this._cd };
  }
  // slow evolution of the gradient (synoptic) wind: speed factor and direction offset (cached per t: the
  // wind field asks for it at every sample, and a frame samples thousands of points at one t)
  synoptic(t) {
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
    const tr = this.synoptic(T);
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
    const tr = this.synoptic(t), dir = this.twd0 + tr.d, U = Math.max(0.5, this.tws0 * tr.f);
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
      // (k, age, life and the track let the sky place lightning and the gust front deterministically)
      out.push({ x: c.ux * s0 - c.uz * c.lateral, z: c.uz * s0 + c.ux * c.lateral, R: c.R, w, k: c.k, age, life: CELL_LIFE, ux: c.ux, uz: c.uz, speed: c.speed, strength: c.strength });
    });
    // the most developed first (the sky draws four)
    return out.sort((a, b) => b.w - a.w);
  }
  // conditions for the sky: overall cloudiness near a point. Fresh breezes bring more cloud (a gale is
  // a grey stratocumulus sky), squally weather an unsettled, broken sky between the cells.
  sky(x, z, t, out = {}) {
    this.squall(x, z, t, out);
    const kt = this.tws0 * this.synoptic(t).f / KT;
    const base = this.cloudBase()
               + 0.6 * Math.min(1, Math.max(0, (kt - 16) / 22));
    out.overcast = Math.max(Math.min(0.85, base), out.cloud);
    return out;
  }
}

// ---------- thermal winds: sea/lake breeze, land breeze, diurnal stability ----------
// A pure function of (venue geometry, lat/lon, UTC clock at t = 0, t), so every browser in a shared world
// sees the same breeze. The land-sea temperature contrast dT is the land's lagged response (tau 2.5 h) to
// the sun: it heats with the sine of the real sun elevation at the venue (latitude, season, time of day)
// under the weather's cloud and cools at night by net long-wave loss. The breeze runs down the pressure
// gradient that contrast sets up, U ~ sqrt(g h dT / T), from the water toward the land by day (onset late
// morning, peak mid-afternoon, gone around sunset) and gently back offshore late at night and at dawn
// (katabatic, much stronger under high ground: Garda's morning Pelèr against its afternoon Ora). Coriolis
// turns it through the day (veering north of the equator, backing south of it). The geometry is a
// multi-scale "where is the land" vector: land seen on rings 0.6-6 km around each point, which points
// inland perpendicular to the smoothed coastline and has length 1 on a straight coast, 0 on open water
// or mid-lake (breezes flow outward to every shore and cancel there). It decays offshore (~15 km).
// Regional forcing (venue.regional): what a 12 km map cannot see. The Golden Gate westerly is the Pacific
// against the Central Valley 100 km inland, Garda's Ora and Pelèr the whole Sarca/Adige valley system against
// the Po plain. Each is the same lagged sun-driven contrast, with the region's own memory (a big air mass heats
// and cools slowly: tau 4-6 h) and night loss, blowing along the terrain's fixed axis (the Gate, the valley)
// over the whole sailing area: day = from 'day.from' when the contrast is above day.thr, night = the drainage
// from 'night.from' when below -night.thr, scaled by the season's diurnal swing (a valley wind is the day's
// heat running back out, not the winter's cold alone). local scales the map's own breeze under it.
const TH_TAU = 2.5 * 3600, TH_STEP = 600;   // land lag, integration step (s); the memory is 5 lags
const TH_A = 13, TH_B = 3.5;           // K of land-sea contrast per unit sin(sun elevation) in clear sky; K of night cooling
const TH_SEA = 2.5, TH_SEA0 = 1.5;     // sea breeze m/s per sqrt(K) above a K threshold
const TH_LAND = 1.3, TH_LAND0 = 0.5;   // land breeze
// rings weighted to the large scales: a breeze needs a broad heated area (a 2 km-wide lake has no cross-lake
// breeze, but its end has an along-valley one); the outer ring reads past the map edge (the edge extended)
const TH_RINGS = [800, 2000, 4500, 9000], TH_RW = [0.3, 0.6, 1, 1.4], TH_AZ = 16;
export function sunElevation(ms, lat, lon) {   // same low-precision ephemeris as the sky (sky.js sunPosition)
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = (280.46061837 + 360.98564736629 * d + lon) * DEG - ra, phi = lat * DEG;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}
// gradient wind (speed m/s, from-direction rad) plus a thermal {vx, vz, st}: speed and from-direction,
// the direction kept within half a turn of the gradient's (so it never jumps by 2 pi)
const _cmb = { speed: 0, dir: 0 };
export function combineThermal(U, dir, th) {
  const m = U * (1 + 0.08 * th.st);                        // a mixed (unstable) day brings more of the wind down
  const vx = -Math.sin(dir) * m + th.vx, vz = Math.cos(dir) * m + th.vz;
  let dd = Math.atan2(-vx, vz) - dir;
  dd -= 2 * Math.PI * Math.round(dd / (2 * Math.PI));
  _cmb.speed = Math.hypot(vx, vz); _cmb.dir = dir + dd;
  return _cmb;
}
export class Thermal {
  // land: { R, sdfAt(x, z) (m, + over water), landHeight?(x, z) }; clock0: UTC ms at t = 0
  constructor(opts) {
    const land = opts.land, R = land.R, M = opts.M ?? 48, c = 2 * R / M;
    this.lat = opts.lat; this.lon = opts.lon; this.clock0 = opts.clock0;
    this.hemi = opts.lat < 0 ? -1 : 1;
    this.latF = Math.abs(Math.sin(opts.lat * DEG)) / Math.SQRT1_2;   // Coriolis parameter against 45 deg
    this.cloud = opts.cloud ?? 0.15;                                 // weather's cloud share (0 clear .. 1 overcast)
    this.R = R; this.M = M; this.cs = c;
    const gx = new Float32Array(M * M), gz = new Float32Array(M * M), rl = new Float32Array(M * M);
    let wsum = 0; for (let r = 0; r < TH_RINGS.length; r++) wsum += TH_RW[r] * TH_AZ;
    let ax = 0, az = 0, ar = 0, an = 0;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = -R + (i + 0.5) * c, z = -R + (j + 0.5) * c;
      let vx = 0, vz = 0, hs = 0, hw = 0;
      for (let r = 0; r < TH_RINGS.length; r++) for (let k = 0; k < TH_AZ; k++) {
        const a = (k + 0.5 * (r & 1)) * 2 * Math.PI / TH_AZ, ux = Math.sin(a), uz = -Math.cos(a);
        const px = x + ux * TH_RINGS[r], pz = z + uz * TH_RINGS[r];
        if (land.sdfAt(px, pz) >= 0) continue;
        vx += TH_RW[r] * ux; vz += TH_RW[r] * uz;
        if (land.landHeight) { hs += TH_RW[r] * Math.max(0, land.landHeight(px, pz)); hw += TH_RW[r]; }
      }
      // pi / wsum: a straight coast (land on half the circle) gives length 1; a bay's head or a harbour
      // (land on both hands) about 0.3-0.6, which still brings in the breeze. Mountain valleys channel the
      // whole valley's thermal flow along their axis (the end of an alpine lake gets a full valley wind).
      const relief = Math.min(1, (hw ? hs / hw : 0) / 250);   // high ground 0..1 (a mean ~250 m of hills)
      const len = Math.hypot(vx, vz) * Math.PI / wsum, n = Math.min(1, (1.6 + 3 * relief) * len) / Math.max(1e-9, len);
      const off = Math.exp(-Math.max(0, land.sdfAt(x, z)) / 15000);   // the breeze dies away offshore
      const k = j * M + i;
      gx[k] = vx * Math.PI / wsum * n * off; gz[k] = vz * Math.PI / wsum * n * off;
      rl[k] = relief;
      if (x * x + z * z < 3000 * 3000 && land.sdfAt(x, z) > 0) { ax += gx[k]; az += gz[k]; ar += rl[k]; an++; }
    }
    this.gx = gx; this.gz = gz; this.rl = rl;
    // the reference point for the area's mean wind (and the sea it raises): the water within 3 km of centre
    this.refX = 0; this.refZ = 0;
    if (an) { this._ref = { gx: ax / an, gz: az / an, rl: ar / an }; }
    this._dt = new Map(); this._tt = NaN;
    const rg = this.rg = opts.regional || null;
    this.loc = rg ? rg.local ?? 1 : 1;
    if (rg) { this.rgTau = (rg.tau ?? 4) * 3600; this.rgB = rg.cool ?? TH_B; this._dr = new Map(); this._sw = new Map(); }
  }
  // a new clock (the menu's time of day changed): the same breeze as a Thermal built at that clock
  setClock(clock0) { this.clock0 = clock0; this._tt = NaN; }
  // land-sea contrast (K) at UTC ms q (a multiple of TH_STEP s): exponentially lagged equilibrium contrast
  _dT(q) { return this._lag(q, TH_TAU, TH_B, this._dt); }
  _lag(q, tau, B, cache) {
    let v = cache.get(q);
    if (v !== undefined) return v;
    const clear = 1 - 0.7 * this.cloud;
    let s = 0, w = 0;
    for (let a = 0; a <= 5 * tau; a += TH_STEP) {
      const el = sunElevation(q - a * 1000, this.lat, this.lon);
      const eq = TH_A * clear * Math.max(0, Math.sin(el)) - B;
      const k = Math.exp(-a / tau); s += k * eq; w += k;
    }
    v = s / w;
    if (cache.size > 512) cache.clear();
    cache.set(q, v);
    return v;
  }
  // the season's diurnal swing at UTC ms: sine of the sun's noon elevation that local day against 60 deg
  _swing(ms) {
    const day = Math.floor((ms / 3.6e6 + this.lon / 15) / 24);
    let v = this._sw.get(day);
    if (v === undefined) {
      v = Math.min(1, Math.max(0, Math.sin(sunElevation((day * 24 + 12 - this.lon / 15) * 3.6e6, this.lat, this.lon))) / Math.sin(60 * DEG));
      if (this._sw.size > 64) this._sw.clear();
      this._sw.set(day, v);
    }
    return v;
  }
  // the time-only part at sim time t (cached per t): contrast, breeze speeds, their turning, stability
  _time(t) {
    if (t === this._tt) return this;
    const ms = this.clock0 + t * 1000, st = TH_STEP * 1000;
    const q0 = Math.floor(ms / st) * st, f = (ms - q0) / st;
    const dT = this._dT(q0) * (1 - f) + this._dT(q0 + st) * f;
    this.dT = dT;
    this.hour = ((ms / 3.6e6 + this.lon / 15) % 24 + 24) % 24;       // local solar time
    this.sea = TH_SEA * Math.sqrt(Math.max(0, dT - TH_SEA0));
    this.landB = TH_LAND * Math.sqrt(Math.max(0, -dT - TH_LAND0));
    // Coriolis: the sea breeze turns through the afternoon (~6 deg/h at 45 deg), the land breeze through the night
    const hd = Math.max(-3, Math.min(7, this.hour - 12));
    const hn = Math.max(-5, Math.min(6, ((this.hour - 3 + 36) % 24) - 12));
    this.veerD = this.hemi * hd * 6 * DEG * this.latF;
    this.veerN = this.hemi * hn * 4 * DEG * this.latF;
    this.stab = Math.max(-1, Math.min(1, dT / 6));
    const rg = this.rg;
    if (rg) {
      const dR = this.dTr = this._lag(q0, this.rgTau, this.rgB, this._dr) * (1 - f) + this._lag(q0 + st, this.rgTau, this.rgB, this._dr) * f;
      this.rgD = rg.day ? rg.day.gain * Math.sqrt(Math.max(0, dR - (rg.day.thr ?? 0))) : 0;
      this.rgN = rg.night ? rg.night.gain * Math.sqrt(Math.max(0, -dR - (rg.night.thr ?? 0))) * this._swing(ms) : 0;
    }
    this._tt = t;
    return this;
  }
  // thermal flow at (x, z) (m/s, x east / z south), and stability st in [-1, 1] (+ = convective day)
  // over land-affected water. Ug = gradient wind speed: a strong gradient mixes the contrast away.
  at(x, z, t, Ug, out = {}) {
    const T = this._time(t);
    let gx, gz, rl;
    if (x === this.refX && z === this.refZ && this._ref) ({ gx, gz, rl } = this._ref);
    else {
      const M = this.M, c = this.cs;
      let fx = (x + this.R) / c - 0.5, fz = (z + this.R) / c - 0.5;
      fx = Math.max(0, Math.min(M - 1.001, fx)); fz = Math.max(0, Math.min(M - 1.001, fz));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * M + i;
      const bl = (a) => (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + M] * (1 - u) + a[k + M + 1] * u) * v;
      gx = bl(this.gx); gz = bl(this.gz); rl = bl(this.rl);
    }
    // high ground: a stronger afternoon up-valley breeze, far stronger night drainage (katabatic), and
    // the valley walls hold the flow on the valley's axis against the Coriolis turn
    const supp = 1 / (1 + (Ug / 8) ** 2), ch = 1 - 0.7 * rl;
    const S = T.sea * (1 + 0.5 * rl) * supp, L = T.landB * (1 + 1.8 * rl) * supp;
    const cd = Math.cos(T.veerD * ch), sd = Math.sin(T.veerD * ch), cn = Math.cos(T.veerN * ch), sn = Math.sin(T.veerN * ch);
    // flow toward the land by day, away from it by night; a turn of the from-direction by +a (veer) turns
    // the flow vector (fx, fz) to (fx cos a - fz sin a, fz cos a + fx sin a)
    out.vx = S * (gx * cd - gz * sd) - L * (gx * cn - gz * sn);
    out.vz = S * (gz * cd + gx * sd) - L * (gz * cn + gx * sn);
    out.st = T.stab * Math.min(1, Math.hypot(gx, gz));
    if (this.loc !== 1) { out.vx *= this.loc; out.vz *= this.loc; }
    const rg = this.rg;
    if (rg) {
      // the regional flow is deeper than a local breeze: a gradient mixes it away less readily
      const sr = 1 / (1 + (Ug / 11) ** 2), D = T.rgD * sr, N = T.rgN * sr;
      if (D > 0) { const a = rg.day.from * DEG; out.vx -= D * Math.sin(a); out.vz += D * Math.cos(a); }
      if (N > 0) { const a = rg.night.from * DEG; out.vx -= N * Math.sin(a); out.vz += N * Math.cos(a); }
      out.st = Math.max(-1, Math.min(1, out.st + 0.5 * T.stab * Math.min(1, (D + N) / 6)));
    }
    return out;
  }
}

// ---------- waves ----------
// A directional wind-sea spectrum (Pierson-Moskowitz with JONSWAP peak enhancement, cos^2s spreading)
// discretised into Gerstner components with fixed frequency and direction. Each component's
// energy follows the wind with a lag that grows with wavelength (short chop answers in a minute,
// the long waves in many), so the sea builds after the wind does, decays slower, and a wind
// shift raises a new sea across the old one. The same components drive the GPU water.
// Coast and bottom (coastal.js, precomputed per venue): each component's local phase, wavevector and
// amplitude — refraction and shortening over the bottom (w^2 = g k tanh kh), shoaling, the shelter and
// diffraction of land and breakwaters, fetch-limited growth in the lee, and the waves the walls reflect.
// Waves break where their height reaches 0.78 h. Current: Doppler-shifted frequency, steepening against the tide.
// Discretisation: every wind-sea component has its OWN frequency (log-spaced bins, jittered inside the
// bin) and its own direction (a low-discrepancy spread about the wind), so no two components share a
// wavelength: the sea has no repeat pattern, no moire bands and long irregular crests in groups.
// Each component carries the whole spectral energy of its frequency bin (integrated, so the narrow
// JONSWAP peak is not missed between bins) weighted by the spreading function at its direction.
export const MAXW = 20;
// Fetch- and duration-limited growth (JONSWAP, Hasselmann et al. 1973; capped by the fully developed
// Pierson-Moskowitz sea). A sea needs time as well as distance: a wind that has blown for D seconds can only
// have used the fetch F_D given by gt/U = 68.8 (gF/U^2)^(2/3) (Shore Protection Manual 1984, 3-2). D is a
// storm's day (STORM_H): the open ocean's sea at 60 kn is then Hs ~14 m, Tp ~18 s, the WMO Beaufort table's
// "probable height" for force 11-12 (11.5-14 m), not the 20 m / 23 s of a sea fully developed over ~3 days
// and ~3000 km that no real storm keeps up. Below ~30 kn a day of wind fully develops the sea (no change).
export const STORM_H = 24;
const hsTp = (U, F, D = STORM_H * 3600) => {
  const Fd = U * U / G * Math.pow(G * D / (68.8 * U), 1.5);
  const chi = G * Math.min(F, Fd) / (U * U);
  return [Math.min(1.6e-3 * Math.sqrt(chi) * U * U / G, 0.21 * U * U / G), Math.min(0.286 * Math.cbrt(chi) * U / G, 7.14 * U / G)];
};
export const seaHsTp = hsTp;
const jonswapShape = (x) => {            // x = f / fp; PM shape times the JONSWAP (gamma 3.3) peak factor
  const sg = x <= 1 ? 0.07 : 0.09;
  return x ** -5 * Math.exp(-1.25 * x ** -4) * Math.pow(3.3, Math.exp(-((x - 1) ** 2) / (2 * sg * sg)));
};
// integral of the shape over f/fp: the spectrum is normalised so it integrates to exactly Hs^2 / 16
const JS_INT = (() => { let s = 0; for (let x = 0.3; x < 12; x += 0.0005) s += jonswapShape(x) * 0.0005; return s; })();
// cos^8(θ/2) spreading, normalised over the circle; spreadP(w) = the share of energy within ±w
const spreadD = (dth) => Math.pow(Math.max(0, Math.cos(dth / 2)), 8) / 1.718;
const spreadP = (w) => { let s = 0; const n = 64; for (let i = 0; i < n; i++) s += spreadD(-w + (i + 0.5) * 2 * w / n) * 2 * w / n; return s; };
// energy (m^2) of the frequency bin [fa, fb] of the fetch-limited JONSWAP spectrum for wind U over fetch F
// (the spectrum normalised to Hs^2/16, integrated over the bin so the narrow peak is not missed)
export function binEnergy(fa, fb, U, F) {
  const [Hs, Tp] = hsTp(Math.max(U, 0.5), F);
  const fp = 1 / Math.max(Tp, 0.3);
  const n = 8, xa = fa / fp, xb = fb / fp, r = Math.pow(xb / xa, 1 / n);
  let E = 0;
  for (let i = 0, x = xa; i < n; i++, x *= r) E += jonswapShape(x * Math.sqrt(r)) * x * (r - 1);
  return E * Hs * Hs / 16 / JS_INT;
}
// ---------- whitecaps ----------
// Whitecap cover: the fraction of the sea's surface white with foam — the active, breaking crests (stage A)
// and the patches of decaying foam they leave (stage B) together — against the 10-m wind U (m/s).
// Monahan & O'Muircheartaigh (1980): W = 3.84e-6 U^3.41 — 0.1 % at 10 kn, 1.1 % at 20, 4.3 % at 30, 7 % at
// 35. Their data end near 20 m/s (~40 kn); carried on, the fit would whiten half the sea by 60 kn, where
// observed whitecap cover levels off (the extra foam of a storm is torn off the crests and laid out in the
// streaks along the wind that WMO's Beaufort 8-12 describe, drawn separately), so it saturates smoothly at
// WC.max: 15 % at 45 kn, 27 % at 60.
// Of that cover, the active crests are a small part: a whitecap breaks for about a second and the foam it
// leaves decays over several (e-folding ~2-10 s, mostly 3-5: Monahan & Lu 1990, Callaghan et al. 2012), so
// in a steady sea the decaying foam is 2-4 times the breaking (WC.A: the active share). The water shader
// draws the active crests and the foam map (render.js) the decaying foam, each calibrated to its share.
export const WC = { a: 3.84e-6, b: 3.41, max: 0.3, A: 0.3, tauB: 4 };
export const whitecapCover = (U) => WC.max * Math.tanh(WC.a * Math.pow(Math.max(U, 0), WC.b) / WC.max);
// the same curve for the shaders (render.js: the water's whitecaps, the foam map's source; test/whitecaps.mjs
// checks one against the other)
const glf = (x) => { const t = String(x); return /[.e]/.test(t) ? t : t + '.0'; };
export const WC_GLSL = `float wcCover(float U) { float m = ${glf(WC.a)} * pow(max(U, 0.0), ${glf(WC.b)}) / ${glf(WC.max)}; float e = exp(-2.0 * m); return ${glf(WC.max)} * (1.0 - e) / (1.0 + e); }`;
const QMAX = 0.8;   // sum of k·A·Q over the sea: crests sharpen as far as they can without ever looping
export const BREAK_G = 0.78;   // depth-limited breaking: wave height / depth (McCowan)
// Rogue waves. A freak wave is the sea's own components arriving in phase at one place and time (dispersive
// focusing); its expected shape is the NewWave of Lindgren and Tromans, the spectrum's autocorrelation. Each
// group adds to every wind-sea component i a term w a_i (c1 cos(th_i - psi_i) + c2 sin(th_i - psi_i)), psi_i
// the component's own phase at the focus (x_f, t_f), a_i = A_i^2 / sum A^2, c1 and c2 set so the sea at the
// focus has exactly the group's crest and no Hilbert part (Taylor's constrained NewWave: the random sea
// already there counts). Away from the focus the components drift out of phase again: the group builds over
// tens of seconds as it disperses in, and disperses out. w is a compact window moving at the group speed that
// cuts the far field. A sum of two sinusoids of one wavenumber is one sinusoid, so a group only changes each
// component's complex amplitude: no extra trigonometry, in the shader or here.
// Occurrence is deterministic from (seed, square cell, slot of time), so everyone in a room has the same sea.
// The cells are ~10 peak wavelengths and the slots ~12 peak periods of the session's nominal sea (at most
// 2.5 km and 240 s): a few thousand waves each. A cell-slot holds a group with probability p = N P_F(C0)
// (1 + 3 C4): N the waves it holds (mean period, a crest 1.5 wavelengths long), P_F(C0) Forristall's (2000)
// second-order chance of a crest over C0 = 1.1 Hs, raised by C4, the excess kurtosis of a sea with
// Benjamin-Feir index BFI (Janssen 2003: a steep, narrow-banded sea has more). Its crest is drawn from the
// tail of Forristall's distribution beyond C0 (mostly 1.1-1.3 Hs, rarely 1.4: Draupner was 18.5 m in Hs
// 12 m). A sum of twenty components makes big waves of its own up to ~0.9-1 Hs but hardly any beyond: the
// groups are the tail (test/big-seas.mjs). In a 60-kn storm that is a group every ~20 min within 1.5 km.
const RG_PMAX = 0.9, RG_C0 = 1.1, RG_CMAX = 1.45;
const RG_FOLD = 0.3;          // a group's share of the crest compression at its focus: the lean does the rest
const RG_NONE = Object.freeze([]);
const h32 = (a, b, c, d) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b); h = Math.imul(h ^ b ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ c ^ (h >>> 16), 0x27d4eb2f); h = Math.imul(h ^ d ^ (h >>> 15), 0x165667b1);
  return (h ^ (h >>> 16)) >>> 0;
};
// a group's window at (x0, z0, t): (1 - u^2)^3 along its direction, across it and in time (render.js: rgWin)
function rgWin(E, x0, z0, t) {
  const dt = t - E.t, ut = dt * E.iRt; if (ut <= -1 || ut >= 1) return 0;
  const s = E.cg * dt, rx = x0 - E.x - E.dx * s, rz = z0 - E.z - E.dz * s;
  const ua = (rx * E.dx + rz * E.dz) * E.iRa, uc = (rz * E.dx - rx * E.dz) * E.iRc;
  const qa = 1 - ua * ua, qc = 1 - uc * uc, qt = 1 - ut * ut;
  if (qa <= 0 || qc <= 0) return 0;
  return qa * qa * qa * qc * qc * qc * qt * qt * qt;
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export class WaveField {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 3;
    this._d = {}; this._lo = {}; this._rp = []; this._ra = []; this._rw = new Float64Array(8); this._rq = new Float64Array(8);
    this.set(opts);
  }
  set(opts, t0 = 0) {
    this.opts = opts;
    const U0 = Math.max(0.5, opts.tws ?? 6);
    this.U0 = U0;
    this.F = (opts.fetchKm ?? 8) * 1000;
    this.dir0 = opts.twd ?? 0;                   // wind from (rad)
    this.weather = opts.weather || null;
    this.seaScale = opts.seaScale ?? 1;
    const rnd = mulberry32(this.seed * 977 + 11);
    const sw = opts.swellH ?? 0, nSw = sw > 0.01 ? 2 : 0, nS = MAXW - nSw;
    // the components are laid out once, about the direction(s) the day's wind will blow from; the weather
    // then only sets their amplitudes. A venue's thermal can blow from anywhere (Garda: Pelèr from the
    // north at dawn, Ora from the south by noon), so the day ahead is sampled and a sea whose energy comes
    // from two opposite sides gets two families of components, each with its own full frequency range.
    let fams = [{ dir: this.dir0, n: nS }], Ulo = U0 * 0.55, Uhi = U0 * 1.55;
    if (this.weather && this.weather.thermal) ({ fams, Ulo, Uhi } = this._layout(nS, U0, t0));
    // frequency bins cover the peak for the whole range of wind the weather can bring
    const [, TpLo] = hsTp(Ulo, this.F), [, TpHi] = hsTp(Uhi, this.F);
    const fLo = 0.8 / Math.max(TpHi, 0.5), fHi = 2.6 / Math.max(TpLo, 0.4);
    const comps = [], ratio = fHi / fLo, ph0 = rnd();
    for (const fam of fams) for (let i = 0, n = fam.n; i < n; i++) {
      const fa = fLo * Math.pow(ratio, i / n), fb = fLo * Math.pow(ratio, (i + 1) / n);
      const f = fa * Math.pow(fb / fa, 0.2 + 0.6 * rnd());
      // spreading: the long waves near the peak run close to the wind, the short ones fan out
      const w = (28 + 34 * i / (n - 1)) * DEG;
      const u = (ph0 + i * 0.6180339887) % 1;                     // golden-ratio sequence: neighbours differ
      const dd = (2 * u - 1) * w;
      const th = fam.dir + Math.PI + dd;
      const omega = 2 * Math.PI * f;
      comps.push({ f, fa, fb, dd, wSpread: 2 * w / spreadP(w), travel: th, A: 0, k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'sea' });
    }
    if (nSw) {
      // the slider is the swell's significant height: 4·sqrt(Σ A²/2) = sw
      const T = opts.swellT ?? 8, th0 = (opts.swellDir ?? this.dir0 + 0.7) + Math.PI, r = [0.85, 0.45];
      const a0 = sw / Math.sqrt(8 * (r[0] ** 2 + r[1] ** 2));
      for (let j = 0; j < 2; j++) {
        const omega = 2 * Math.PI / (T * (j ? 0.87 : 1)), th = th0 + (j ? 0.18 : -0.05);
        comps.push({ A: a0 * r[j], Aswell: a0 * r[j], k: omega * omega / G, omega, dx: Math.sin(th), dz: -Math.cos(th), phase: rnd() * 6.283, Q: 0, kind: 'swell' });
      }
    }
    this.comps = comps;
    this.cur = { x: 0, z: 0 };
    this.depthFn = null; this.coastal = null;       // (a new layout: the old coastal field no longer fits)
    this.rogue = opts.rogue ?? true; this.rgForced = []; this._rgE = new Map(); this._rgL = new Map();
    // the rogue groups' lattice, scaled to the session's nominal sea (see RG_PMAX)
    // (and the session's nominal sea, fixed while the weather moves the sea about it: the size of its whitecaps)
    this.HsNom = hsTp(U0, this.F)[0] * this.seaScale;
    { const [, Tp0] = hsTp(U0, this.F), Lp0 = G * Tp0 * Tp0 / (2 * Math.PI); this.rgCell = Math.min(2500, Math.max(400, 10 * Lp0)); this.rgSlot = Math.min(240, Math.max(60, 12 * Tp0)); }
    this.update(t0);
  }

  // where the next 12 h of wind (gradient + thermal) comes from, weighted by the sea it raises (~U^3):
  // the axial mean direction splits the samples into two opposite halves; a half with over a fifth of the
  // energy gets its own family of components (at least 6), about its own energy-weighted mean direction
  _layout(nS, U0, t0) {
    const W = this.weather, S = [];
    let Ulo = Infinity, Uhi = 0, c2 = 0, s2 = 0;
    for (let t = t0; t <= t0 + 12 * 3600; t += 600) {
      const tr = W.trend(t), U = U0 * tr.f, d = this.dir0 + tr.d, w = U * U * U;
      S.push({ d, w }); c2 += w * Math.cos(2 * d); s2 += w * Math.sin(2 * d);
      Ulo = Math.min(Ulo, U); Uhi = Math.max(Uhi, U);
    }
    const ax = 0.5 * Math.atan2(s2, c2), half = [{ x: 0, z: 0, e: 0 }, { x: 0, z: 0, e: 0 }];
    for (const s of S) {
      const h = half[Math.cos(s.d - ax) >= 0 ? 0 : 1];
      h.x += s.w * Math.sin(s.d); h.z += s.w * Math.cos(s.d); h.e += s.w;
    }
    const E = half[0].e + half[1].e, dirOf = (h) => Math.atan2(h.x, h.z);
    let fams;
    if (E <= 0) fams = [{ dir: this.dir0, n: nS }];
    else if (Math.min(half[0].e, half[1].e) > 0.2 * E) {
      const n0 = Math.max(6, Math.min(nS - 6, Math.round(nS * half[0].e / E)));
      fams = [{ dir: dirOf(half[0]), n: n0 }, { dir: dirOf(half[1]), n: nS - n0 }];
    } else fams = [{ dir: dirOf(half[0].e >= half[1].e ? half[0] : half[1]), n: nS }];
    return { fams, Ulo: Math.min(U0, Ulo) * 0.55, Uhi: Math.max(U0, Uhi) * 1.55 };
  }

  // target spectral amplitude of a component for mean wind (U, from-direction dir)
  _amp(c, U, dir) {
    // energy of the component's frequency bin: the JONSWAP spectrum (normalised to Hs^2/16) integrated
    const E = binEnergy(c.fa, c.fb, U, this.F);
    // cos^2s spreading about the downwind direction: the component stands for directions within ±w
    let dth = c.travel - (dir + Math.PI); while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
    return Math.sqrt(Math.max(0, 2 * E * spreadD(dth) * c.wSpread)) * this.seaScale;
  }

  // a component's amplitude at time t: it answers to the wind it felt tau seconds ago
  _ampOf(c, t) {
    if (c.kind === 'swell') return c.Aswell;
    const W = this.weather;
    const cg = G / (4 * Math.PI * c.f);                       // deep-water group speed
    const tau = Math.min(1500, 45 + 0.4 * this.F / cg * 0.05 + 25 / (c.f * c.f));   // growth lag, s
    const tr = W ? W.trend(t - tau) : { f: 1, d: 0 };
    const trNow = W ? W.trend(t) : tr;
    // grows toward the lagged wind; a falling wind lets the sea decay more slowly still
    const U = this.U0 * Math.max(tr.f, Math.min(trNow.f, tr.f) + 0.5 * Math.max(0, tr.f - trNow.f));
    return this._amp(c, U, this.dir0 + tr.d);
  }
  // Deterministic sea state at time t: each component answers to the wind it felt tau seconds ago.
  update(t) {
    let Hs2 = 0;
    for (const c of this.comps) { c.A = this._ampOf(c, t); Hs2 += c.A * c.A; }
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
    // second order: the Gerstner map makes each component a trochoid (Stokes' second-order crest on its
    // own), but a sum of trochoids has no sum-frequency interaction between components, so a real sea of
    // twenty of them stays almost symmetric (skewness ~0.01 against ~0.1-0.2 measured at sea). Tayfun's
    // narrow-band correction adds the missing part: eta2 = (k_m / 2) (eta^2 - H[eta]^2), H the Hilbert
    // transform (every component's cosine partner), k_m from the spectral mean frequency — sharper, higher
    // crests and flatter troughs, zero mean. The trochoids' own share (Q of each self term) is taken out.
    // Mean surface Stokes drift sum(omega k A^2) along each direction: what carries the foam.
    // The same moments give the depth decay of what the hull feels (u, w ~ e^{kz}, the Stokes drift
    // ~ e^{2kz}): each as one wavenumber, the mean of k over the spectrum of that quantity (velocity ~
    // w^2 S, acceleration ~ w^4 S, drift ~ w k S), and the mean wave direction and energy-weighted k
    // (Rapp & Melville's global steepness S = sum a_i k_i of a focused group is k-bar times its crest).
    let m0 = 0, m1 = 0, sx = 0, sz = 0, mk = 0, v0 = 0, vk = 0, a0 = 0, ak = 0, d0 = 0, dk = 0, ex = 0, ez = 0;
    for (const c of this.comps) {
      const A = c.A * (c.curAmp ?? 1), a2 = A * A, w2 = c.omega * c.omega;
      m0 += a2; m1 += a2 * c.omega; mk += a2 * c.k;
      sx += c.omega * c.k * a2 * c.dx; sz += c.omega * c.k * a2 * c.dz;
      v0 += w2 * a2; vk += w2 * a2 * c.k; a0 += w2 * w2 * a2; ak += w2 * w2 * a2 * c.k; d0 += c.omega * c.k * a2; dk += c.omega * c.k * c.k * a2;
      ex += a2 * c.dx; ez += a2 * c.dz;
    }
    const wm = m0 > 0 ? m1 / m0 : 1;
    this.k2 = 0.5 * wm * wm / G;
    this.drift = { x: sx, z: sz };
    const el = Math.hypot(ex, ez) || 1;
    this.kv = v0 > 0 ? vk / v0 : 0.1; this.ka = a0 > 0 ? ak / a0 : 0.1; this.kd = d0 > 0 ? dk / d0 : 0.1;
    // breaking: where the local envelope's steepness k-bar·|a| passes the onset of spilling (S ~ 0.25,
    // Rapp & Melville 1990) the crest leans forward and throws a jet; plunging by S ~ 0.35
    this.brk = { kb: m0 > 0 ? mk / m0 : 0, S0: 0.2, S1: 0.34, L: 0.9, dx: ex / el, dz: ez / el };
    return this;
  }

  // mean current (uniform part) for the Doppler shift and wave-current steepening. When the stream changes at
  // time t (the tide turning), each component's phase takes up the change of frequency so no crest jumps.
  setCurrent(cx, cz, t = 0) {
    this.cur.x = cx; this.cur.z = cz;
    for (const c of this.comps) {
      const Ud = cx * c.dx + cz * c.dz;                          // current along the wave direction
      const cph = c.omega / c.k, w = c.omega + c.k * Ud;
      if (t && c.omegaEff !== undefined) c.phase = (c.phase + (w - c.omegaEff) * t) % (2 * Math.PI);
      c.omegaEff = w;                                             // Doppler shift
      c.curAmp = 1 / Math.sqrt(Math.max(0.35, 1 + 2 * Ud / cph)); // opposing current steepens the sea
    }
    this._rgE = new Map(); this._rgL = new Map();   // the groups' phases moved with the frequencies
  }

  // The venue's water depth (breaking, orbital velocity) and each component's base wavenumber at its typical
  // depth (the wave's phase until a coastal field arrives). Cheap: the coastal field (coastal.js, built in a
  // worker) carries refraction, shoaling, shelter and reflection.
  buildDepthField(world) {
    this._world = world;
    this._rgE = new Map(); this._rgL = new Map();
    for (const c of this.comps) c.kRef = c.k;
    if (!world || world.open) { this.depthFn = null; return; }
    this.depthFn = (x, z) => Math.max(0.05, world.depthAt(x, z));
    const wet = [], n = 48, R = world.R;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -R + (i + 0.5) * 2 * R / n, z = -R + (j + 0.5) * 2 * R / n; if (world.sdfAt(x, z) > 0) wet.push(Math.max(0.05, world.depthAt(x, z))); }
    wet.sort((a, b) => a - b);
    this.hTyp = wet.length ? wet[wet.length >> 1] : 99;
    for (const c of this.comps) c.kRef = kOfDepth(c.omega, this.hTyp);
  }
  // the coastal field for this layout of components (coastal.js CoastalField), or null
  setCoastal(f) { this.coastal = f && f.n === this.comps.length ? f : null; this._rgE = new Map(); this._rgL = new Map(); }   // (the groups' phases at their foci moved)

  // Every wave near the (undisplaced) point x0: the components, and where a wall reflects them their reflected
  // waves. Each is a local plane wave, phase p + g.x at t = 0 (g its wavevector: direction (ux, uz), wavenumber
  // k), amplitude factor K on its component's amplitude: from the coastal field when there is one, else a plane
  // wave at the component's base wavenumber. slot 0: the query point's (Newton's iterations), 1: the water's own.
  _local(x0, z0, slot = 1) {
    const L = this._L || (this._L = [0, 1].map(() => { const f = () => new Float64Array(2 * MAXW); return { n: 0, ci: new Int32Array(2 * MAXW), p: f(), gx: f(), gz: f(), ux: f(), uz: f(), k: f(), K: f(), we: f() }; }));
    const W = L[slot], cf = this.coastal;
    if (cf) cf.at(x0, z0);
    let n = 0;
    for (let i = 0, nc = this.comps.length; i < nc; i++) {
      const c = this.comps[i], we = c.omegaEff ?? c.omega;
      for (let r = 0; r < 2; r++) {
        let P, gx, gz, K;
        if (cf) {
          if (r === 0) cf.inc(i); else if (!cf.ref(i)) break;
          P = cf.P; gx = cf.gx; gz = cf.gz; K = cf.k;
        } else { if (r) break; const kb = c.kRef ?? c.k; P = 0; gx = kb * c.dx; gz = kb * c.dz; K = 1; }
        const k = Math.sqrt(gx * gx + gz * gz) || 1e-9;
        W.ci[n] = i; W.p[n] = P + c.phase; W.gx[n] = gx; W.gz[n] = gz; W.ux[n] = gx / k; W.uz[n] = gz / k; W.k[n] = k; W.K[n] = K; W.we[n] = we; n++;
      }
    }
    W.n = n;
    return W;
  }
  // Local limits on the summed waves at depth h (null: deep water): the trochoids' steepness (sum Q k A no more
  // than QMAX, where shoaling and reflection pile the waves up) and depth-limited breaking — the height of the
  // wave passing, twice its envelope sqrt(eta^2 + H[eta]^2), held to 0.78 h (McCowan) by a soft cap. Leaves
  // _cap, _qs and _bd, the depth-limited breaking: this crest spilling, and the surf zone's share of broken water.
  _limits(h, e, eH, sK, a2) {
    let cap = 1, bd = 0;
    if (h !== null) {
      const r = 2 * Math.sqrt(e * e + eH * eH) / (BREAK_G * h); if (r > 0.3) cap = 1 / Math.pow(1 + Math.pow(r, 8), 1 / 8);
      bd = Math.max(sstep(0.85, 1.05, r), 0.6 * clamp01(4 * Math.sqrt(a2 / 2) / (BREAK_G * h) - 0.7));
    }
    this._cap = cap; this._qs = Math.min(1, QMAX / Math.max(1e-9, sK * cap)); this._bd = bd;
  }

  // ---- rogue waves: focused wave groups (see RG_* above) ----
  // the event (if any) of cell (i, j) in time slot n: deterministic from the seed, cached
  _rgEvent(i, j, n) {
    const key = ((i + 32768) * 65536 + (j + 32768)) * 8192 + (n & 8191);
    let E = this._rgE.get(key);
    if (E !== undefined && (!E || E.n === n)) return E;
    const r = mulberry32(h32(this.seed, i, j, n)), u = r();
    E = null;
    if (u < RG_PMAX) {
      const Lc = this.rgCell, tf = (n + 0.1 + 0.8 * r()) * this.rgSlot, xf = (i + 0.15 + 0.7 * r()) * Lc, zf = (j + 0.15 + 0.7 * r()) * Lc;
      E = this._mkEvent(xf, zf, tf, r(), undefined);
      // occurrence: the waves in the cell-slot times Forristall's chance of such a crest, raised by the
      // sea's excess kurtosis (Janssen 2003: C4 = pi BFI^2 / 3 sqrt 3)
      if (E) {
        const Tz = 0.92 * E.Tm, Lz = G * Tz * Tz / (2 * Math.PI), N = Lc * Lc / (1.5 * Lz * Lz) * this.rgSlot / Tz;
        E.p = Math.min(RG_PMAX, N * E.PF * (1 + 3 * E.C4));
        if (u >= E.p) E = null;
      }
      if (E) E.n = n;
    }
    if (this._rgE.size > 8192) this._rgE.clear();
    this._rgE.set(key, E);
    return E;
  }
  // every group whose window can reach the cell-slot of (x, z, t): the 3x3 cells and 3 slots about it
  _rgNear(x, z, t) {
    if (!this.rogue) return this.rgForced.length ? this.rgForced : RG_NONE;
    const ci = Math.floor(x / this.rgCell), cj = Math.floor(z / this.rgCell), n = Math.floor(t / this.rgSlot);
    const key = ((ci + 32768) * 65536 + (cj + 32768)) * 8192 + (n & 8191);
    let L = this._rgL.get(key);
    if (L && L.n === n) return L;
    L = []; L.n = n;
    for (let dn = -1; dn <= 1; dn++) for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const E = this._rgEvent(ci + di, cj + dj, n + dn); if (E) L.push(E);
    }
    for (const E of this.rgForced) L.push(E);
    if (this._rgL.size > 4096) this._rgL.clear();
    this._rgL.set(key, L);
    return L;
  }
  // A group focused at (xf, zf) at time tf. u: its draw from the crest distribution; crest (m) to force one.
  _mkEvent(xf, zf, tf, u, crest) {
    const comps = this.comps, N = comps.length, h = this.depthFn ? this.depthFn(xf, zf) : null, cf = this.coastal;
    const A = new Float64Array(N), psi = new Float64Array(N), af = new Float64Array(N);
    if (cf) cf.at(xf, zf);
    let m0 = 0, m0s = 0, m1 = 0, m1a = 0, ex = 0, ez = 0, kp = 0, best = 0, er = 0, hr = 0;
    for (let q = 0; q < N; q++) {
      const c = comps[q], a = this._ampOf(c, tf) * (c.curAmp ?? 1);
      // (each component as the coast has made it at the focus: its local phase and amplitude factor)
      let ph; if (cf) { cf.inc(q); af[q] = cf.k; ph = cf.p; } else { af[q] = 1; ph = (c.kRef ?? c.k) * (c.dx * xf + c.dz * zf); }
      A[q] = a;
      psi[q] = ph - (c.omegaEff ?? c.omega) * tf + c.phase;
      er += a * af[q] * Math.sin(psi[q]); hr += a * af[q] * Math.cos(psi[q]);   // the sea already there (and its Hilbert part)
      m0 += a * a; m1a += a * a * c.omega;
      if (c.kind !== 'sea') continue;
      m0s += a * a; m1 += a * a * c.omega; ex += a * a * c.dx; ez += a * a * c.dz;
      if (a > best) { best = a; kp = c.k; }
    }
    const Hs = 4 * Math.sqrt(m0 / 2), Hss = 4 * Math.sqrt(m0s / 2);
    if ((crest === undefined && Hss < 0.2) || m1 <= 0) return null;   // (no groups on a sea of ripples; forced ones anywhere)
    const wm = m1 / m0s, T1 = 2 * Math.PI / wm;
    // crest height from the tail of Forristall's (2000) 2-D second-order crest distribution beyond C0 Hs:
    // P(C > c) = exp(-(c / (alpha Hs))^beta), alpha, beta from the steepness S1 and the Ursell number
    const S1 = 2 * Math.PI * Hs / (G * T1 * T1), k1 = h === null ? wm * wm / G : kOfDepth(wm, h);
    const Ur = h === null ? 0 : Math.min(0.5, Hs / (k1 * k1 * h * h * h));
    const aF = 0.3536 + 0.2568 * S1 + 0.08 * Ur, bF = 2 - 1.7912 * S1 - 0.5302 * Ur + 0.284 * Ur * Ur;
    const P0 = Math.exp(-Math.pow(RG_C0 / aF, bF));
    const cr = crest ?? Math.min(RG_CMAX, aF * Math.pow(-Math.log(P0 * (1 - u)), 1 / bF)) * Hs;
    // the linear crest that the second-order (Tayfun) term raises to cr: cr = a + K2 a^2 (K2 of the sea at t_f,
    // as update() will have it: everything here is a function of the seed and the focus alone)
    const K2 = 0.5 * (m1a / m0) ** 2 / G, al = K2 > 1e-7 ? (Math.sqrt(1 + 4 * K2 * cr) - 1) / (2 * K2) : cr;
    // NewWave weights a_i = A_i^2 / sum A^2 (wind sea only); constrained: the sea already at the focus is
    // made up to the crest and its Hilbert part taken out, so the envelope peaks there at exactly cr
    let F = 0, Sk = 0;
    const a = new Float64Array(N);
    for (let q = 0; q < N; q++) if (comps[q].kind === 'sea') { a[q] = A[q] * A[q] / m0s; F += a[q] * af[q]; Sk += a[q] * af[q] * comps[q].k; }
    // (no group where the coast has taken the wind sea away: on land, in a harbour's lee)
    if (!(F > 0.05)) return null;
    let c1 = (al - er) / F, c2 = -hr / F;
    // no group steeper than a crest can stand (S = sum a_i k_i ~ 0.45, well into plunging)
    const S = Sk * Math.hypot(c1, c2);
    if (S > 0.45) { c1 *= 0.45 / S; c2 *= 0.45 / S; }
    const rs = new Float64Array(N), rc = new Float64Array(N);
    for (let q = 0; q < N; q++) {
      if (!a[q]) continue;
      const sp = Math.sin(psi[q]), cp = Math.cos(psi[q]);
      rs[q] = a[q] * (c1 * sp + c2 * cp); rc[q] = a[q] * (c1 * cp - c2 * sp);
    }
    // the window: compact, moving at the group speed, a few wavelengths and periods across (the build-up and
    // dispersal are the components' own phases; the window only cuts the far field). It must stay inside
    // the neighbouring cells and slots, where _rgNear looks.
    const el = Math.hypot(ex, ez) || 1, dx = ex / el, dz = ez / el, cg = G / (2 * wm), Lm = 2 * Math.PI * G / (wm * wm);
    const Lc = this.rgCell, sa = Math.min(1.2 * Lm, 0.19 * Lc), sc = Math.min(1.0 * Lm, 0.19 * Lc), st = Math.min(3 * T1, 0.2 * Lc / cg, 0.18 * this.rgSlot);
    const eps = kp * Hss / 2, BFI = Math.min(1.2, Math.SQRT2 * eps / 0.3);
    return { comps, x: xf, z: zf, t: tf, dx, dz, cg, iRa: 1 / (2.5 * sa), iRc: 1 / (2.5 * sc), iRt: 1 / (2.5 * st),
      rs, rc, qf: Math.min(1, RG_FOLD / Math.max(1e-6, Math.min(S, 0.45))), crest: cr, Hs, Tm: T1, BFI, C4: Math.PI * BFI * BFI / (3 * Math.sqrt(3)), PF: P0 };
  }
  // a group made to order (tests, ?rogue): focus (x, z) at time t, crest in metres or crestHs x Hs
  forceEvent({ x, z, t, crest, crestHs }) {
    if (crest === undefined) { const E0 = this._mkEvent(x, z, t, 0.5, 0); crest = (crestHs ?? 1.25) * (E0 ? E0.Hs : this.Hs); }
    const E = this._mkEvent(x, z, t, 0.5, crest);
    if (!E) return null;
    E.forced = true; this.rgForced.push(E); this._rgL = new Map();
    return E;
  }
  // the groups that can reach (x, z) now (their windows then evaluated at each x0)
  _rgPre(x, z, t) {
    const L = this._rgNear(x, z, t), P = this._rp;
    P.length = 0;
    for (const E of L) {
      const ut = (t - E.t) * E.iRt; if (ut <= -1 || ut >= 1) continue;
      const s = E.cg * (t - E.t), rx = x - E.x - E.dx * s, rz = z - E.z - E.dz * s, R = 1 / Math.min(E.iRa, E.iRc) + 80;
      if (rx * rx + rz * rz < R * R) P.push(E);
    }
    return P;
  }
  _rgWins(ev, x0, z0, t) {
    let n = 0;
    for (const E of ev) {
      const w = rgWin(E, x0, z0, t);
      if (w > 0 && n < 8) { this._ra[n] = E; this._rw[n] = w; this._rq[n] = w * E.qf; n++; }
    }
    return n;
  }
  // The (at most) two groups the GPU draws, packed as render.js uploads them: those whose moving centre
  // is nearest (cx, cz). rg[4i..]: (rs, rc) of component i for groups 0 and 1; A: (xf, zf, tf, qf), B: (dir, cg),
  // C: (1/Ra, 1/Rc, 1/Rt, on). Where a third group reaches the same water it is left out of the drawing.
  // o.sticky (the renderer): a group keeps its slot for its whole life, and a new one takes a free slot only
  // before it has grown or while it is far off, so no group ever appears or vanishes in view.
  rogueUniforms(t, cx, cz, o = {}) {
    o.rg = o.rg || new Float32Array(MAXW * 4); o.A = o.A || new Float32Array(8); o.B = o.B || new Float32Array(8); o.C = o.C || new Float32Array(8);
    const sel = [], live = (E) => Math.abs((t - E.t) * E.iRt) < 1;
    const dist = (E) => { const s = E.cg * (t - E.t); return Math.hypot(cx - E.x - E.dx * s, cz - E.z - E.dz * s); };
    for (const E of this._rgNear(cx, cz, t)) if (live(E)) sel.push({ E, d: dist(E) });
    sel.sort((a, b) => a.d - b.d);
    let slots;
    if (o.sticky) {
      slots = o.slots || (o.slots = [null, null]);
      for (let e = 0; e < 2; e++) if (slots[e] && (!live(slots[e]) || slots[e].comps !== this.comps)) slots[e] = null;
      for (const { E, d } of sel) {
        if (slots.includes(E)) continue;
        const e = slots.indexOf(null); if (e < 0) break;
        if ((t - E.t) * E.iRt <= -0.6 || d > 1.2 / Math.min(E.iRa, E.iRc) + 400) slots[e] = E;
      }
    } else slots = [sel[0] ? sel[0].E : null, sel[1] ? sel[1].E : null];
    o.rg.fill(0); o.A.fill(0); o.B.fill(0); o.C.fill(0);
    o.list = [];
    for (let e = 0; e < 2; e++) {
      const E = slots[e]; if (!E) continue;
      const N = Math.min(MAXW, E.rs.length);
      for (let i = 0; i < N; i++) { o.rg[i * 4 + 2 * e] = E.rs[i]; o.rg[i * 4 + 2 * e + 1] = E.rc[i]; }
      o.A.set([E.x, E.z, E.t, E.qf], 4 * e); o.B.set([E.dx, E.dz, E.cg, 0], 4 * e); o.C.set([E.iRa, E.iRc, E.iRt, 1], 4 * e);
      o.list.push(E);
    }
    return o;
  }

  // Breaking crests lean forward: where the local envelope |a| = sqrt(eta^2 + H[eta]^2) is steep enough
  // (B, from k-bar |a|, or the depth limit Bd) the crest is carried ahead along the sea's mean direction by
  // L B eta^2 / |a| (the top most, mean level not at all): the front face steepens toward vertical, the back
  // flattens. The lean is cut where it would fold the surface: the map's compression along the mean
  // direction (Gerstner's plus the lean's own) stays below 0.75. eta, H: first order; g: grad eta; j..: the
  // Gerstner compression tensor sum k (Ph S + Qh C) d d. Leaves o.lam (the shift), o.c0 (d shift / d eta)
  // and o.dl (the lean's share of the compression, for the normal).
  _lean(e, hc, gx, gz, jxx, jxz, jzz, Bd, o) {
    o.lam = 0; o.c0 = 0; o.dl = 0; o.B = 0;
    const br = this.brk; if (!br) return o;
    const Ea = Math.sqrt(e * e + hc * hc), B = Math.max(sstep(br.S0, br.S1, br.kb * Ea), Bd);
    o.B = B;
    if (B <= 0 || !(e > 0)) return o;
    const ie = 1 / (Ea + 1e-3), dx = br.dx, dz = br.dz;
    const jd = 1 - (dx * dx * jxx + 2 * dx * dz * jxz + dz * dz * jzz);
    const c0 = br.L * B * 2 * e * ie, Dl = c0 * (dx * gx + dz * gz);
    const f = Dl < 0 ? clamp01((jd - 0.25) / -Dl) : 1;
    o.lam = br.L * B * e * e * ie * f; o.c0 = c0 * f; o.dl = Dl * f;
    return o;
  }

  // the water at undisplaced (x0, z0): horizontal displacement (Gerstner, rogue groups, breaking lean), first-
  // order height, and the Jacobian of the map minus the identity (o.a = dX/dx0, o.b = dX/dz0, o.c = dZ/dx0, o.d).
  // W: the local waves (_local). The limits, the lean and the shore's fade as the water shader applies them.
  _disp(x0, z0, t, o, ev, W = this._local(x0, z0)) {
    const h = this.depthFn ? this.depthFn(x0, z0) : null;
    const nE = ev.length ? this._rgWins(ev, x0, z0, t) : 0, ra = this._ra, rw = this._rw, rq = this._rq, comps = this.comps;
    let X = 0, Z = 0, xx = 0, xz = 0, zz = 0, e = 0, hc = 0, gx = 0, gz = 0, a2 = 0, sK = 0;
    for (let n = 0; n < W.n; n++) {
      const ci = W.ci[n], c = comps[ci], K = W.K[n], base = c.A * (c.curAmp ?? 1), Q = c.Q, k = W.k[n], ux = W.ux[n], uz = W.uz[n];
      let rs = 0, rc = 0, qs = 0, qc = 0;
      for (let m = 0; m < nE; m++) { const r1 = ra[m].rs[ci], r2 = ra[m].rc[ci]; rs += rw[m] * r1; rc += rw[m] * r2; qs += rq[m] * r1; qc += rq[m] * r2; }
      const P = (base + rs) * K, Qc = rc * K, Ph = Q * (base + qs) * K, Qh = Q * qc * K;
      const th = W.p[n] + W.gx[n] * x0 + W.gz[n] * z0 - W.we[n] * t, C = Math.cos(th), S = Math.sin(th);
      const Y = P * S + Qc * C, H = P * C - Qc * S, Xh = Ph * C - Qh * S, Jh = k * (Ph * S + Qh * C);
      X += Xh * ux; Z += Xh * uz;
      xx += Jh * ux * ux; xz += Jh * ux * uz; zz += Jh * uz * uz;
      e += Y; hc += H; gx += k * H * ux; gz += k * H * uz; a2 += base * K * base * K; sK += Q * k * base * K;
    }
    this._limits(h, e, hc, sK, a2);
    const cap = this._cap, cq = cap * this._qs;
    const L = this._lean(cap * e, cap * hc, cap * gx, cap * gz, cq * xx, cq * xz, cq * zz, this._bd, this._lo);
    const bx = this.brk ? this.brk.dx : 0, bz = this.brk ? this.brk.dz : 0, sc = this.scaleFn ? this.scaleFn(x0, z0) : 1;
    o.x = sc * (cq * X + bx * L.lam); o.z = sc * (cq * Z + bz * L.lam); o.y = sc * cap * e;
    const lx = L.c0 * cap * gx, lz = L.c0 * cap * gz;
    o.a = sc * (-cq * xx + bx * lx); o.b = sc * (-cq * xz + bx * lz); o.c = sc * (-cq * xz + bz * lx); o.d = sc * (-cq * zz + bz * lz);
    return o;
  }

  // Full sample at world (x, z): surface height, slopes, orbital velocity and acceleration, breaking.
  // Inverts the horizontal displacement; the coast's local waves (coastal.js), their limits and the lean.
  sample(x, z, t, out = {}) {
    const d = this._d, ev = this._rgPre(x, z, t);
    // Newton on x0 + D(x0) = x (sharp crests make the plain fixed-point iteration converge slowly), with the
    // local waves of the query point (the water is a few metres off at most: its tangent planes hold)
    let x0 = x, z0 = z;
    const Wq = this._local(x, z, 0);
    for (let i = 0; i < 4; i++) {
      this._disp(x0, z0, t, d, ev, Wq);
      const fx = x0 + d.x - x, fz = z0 + d.z - z;
      const a = 1 + d.a, b = d.b, c = d.c, e = 1 + d.d, det = a * e - b * c;
      if (det > 0.05) { x0 -= (e * fx - b * fz) / det; z0 -= (a * fz - c * fx) / det; }
      else { x0 -= fx; z0 -= fz; }
      if (fx * fx + fz * fz < 1e-4) break;
    }
    const W = this._local(x0, z0), h = this.depthFn ? this.depthFn(x0, z0) : null;
    const nE = ev.length ? this._rgWins(ev, x0, z0, t) : 0, ra = this._ra, rw = this._rw, rq = this._rq, comps = this.comps;
    let hsum = 0, nx = 0, nz = 0, nyJ = 0, vx = 0, vz = 0, vy = 0, ax = 0, az = 0, ay = 0, a2 = 0, sK = 0, jxx = 0, jxz = 0, jzz = 0;
    let hc = 0, hx = 0, hz = 0, ht = 0, s2 = 0, s2x = 0, s2z = 0, s2t = 0;   // Hilbert partner and trochoid self terms
    for (let n = 0; n < W.n; n++) {
      const ci = W.ci[n], c = comps[ci], K = W.K[n], base = c.A * (c.curAmp ?? 1), Q = c.Q, kk = W.k[n], ux = W.ux[n], uz = W.uz[n], w = c.omega;
      let rs = 0, rc = 0, qs = 0, qc = 0;
      for (let m = 0; m < nE; m++) { const r1 = ra[m].rs[ci], r2 = ra[m].rc[ci]; rs += rw[m] * r1; rc += rw[m] * r2; qs += rq[m] * r1; qc += rq[m] * r2; }
      const P = (base + rs) * K, Qc = rc * K, Ph = Q * (base + qs) * K, Qh = Q * qc * K;
      a2 += base * K * base * K; sK += Q * kk * base * K;
      const th = W.p[n] + W.gx[n] * x0 + W.gz[n] * z0 - W.we[n] * t, C = Math.cos(th), S = Math.sin(th);
      // this wave's elevation, its Hilbert partner and its horizontal compression (Gerstner)
      const Y = P * S + Qc * C, H = P * C - Qc * S, Jh = kk * (Ph * S + Qh * C);
      hsum += Y;
      nx -= ux * kk * H; nz -= uz * kk * H; nyJ += Jh;
      jxx += Jh * ux * ux; jxz += Jh * ux * uz; jzz += Jh * uz * uz;
      const orb = h === null ? 1 : 1 / Math.max(0.3, Math.tanh(kk * h)); // orbital velocity grows in shallow water
      vx += w * ux * Y * orb; vz += w * uz * Y * orb; vy -= w * H;
      ax -= w * w * ux * H * orb; az -= w * w * uz * H * orb; ay -= w * w * Y;
      hc += H; hx += ux * kk * Y; hz += uz * kk * Y; ht += w * Y;
      const sc4 = 4 * Q * Y * H;
      s2 += Q * (H * H - Y * Y); s2x -= sc4 * kk * ux; s2z -= sc4 * kk * uz; s2t += sc4 * w;
    }
    this._limits(h, hsum, hc, sK, a2);
    const cap = this._cap, qs = this._qs, cq = cap * qs, c2 = cap * cap, bD = this._bd;
    // a breaking crest's forward lean steepens its front face (the compression it adds)
    const L = this._lean(cap * hsum, cap * hc, -cap * nx, -cap * nz, cq * jxx, cq * jxz, cq * jzz, bD, this._lo);
    const ny = Math.max(0.05, 1 - cq * nyJ + L.dl);
    // second-order crest/trough asymmetry (see update): height, slope and vertical velocity
    const K2 = this.k2 || 0;
    let H2 = 0, n2x = 0, n2z = 0, v2 = 0;
    if (K2 > 0) {
      const e = hsum;
      H2 = K2 * (e * e - hc * hc + qs * s2);
      n2x = K2 * (-2 * e * nx + 2 * hc * hx + qs * s2x);
      n2z = K2 * (-2 * e * nz + 2 * hc * hz + qs * s2z);
      v2 = K2 * (2 * e * vy - 2 * hc * ht + qs * s2t);
    }
    const k = this.scaleFn ? this.scaleFn(x0, z0) : 1;
    const Nx = cap * nx - c2 * n2x, Nz = cap * nz - c2 * n2z;
    out.h = (cap * hsum + c2 * H2) * k; out.sx = -Nx / ny * k; out.sz = -Nz / ny * k;
    out.vx = cap * vx * k; out.vz = cap * vz * k; out.vy = (cap * vy + c2 * v2) * k;
    out.ax = cap * ax * k; out.az = cap * az * k; out.ay = cap * ay * k;
    out.breaking = bD;
    out.j = ny;                    // crest compression (Gerstner Jacobian): the water shader's whitecap measure
    out.x0 = x0; out.z0 = z0;      // the undisplaced (Lagrangian) position of the water here: the foam map's frame
    // A breaking crest here: its intensity on the upper front quarter of the wave (phase from the analytic
    // signal: eta > 0.25-0.7 |a| and rising, H[eta] < 0), where the jet of a spilling or plunging crest falls, and
    // the crest's velocity, the phase speed of the local wavenumber |k| = |H grad eta - eta grad H| / |a|^2
    const e1 = cap * hsum, hc1 = cap * hc, gx = -cap * nx, gz = -cap * nz, hx1 = cap * hx, hz1 = cap * hz;
    const Ea = Math.sqrt(e1 * e1 + hc1 * hc1);
    out.Ea = Ea * k; out.brk = 0; out.cbx = 0; out.cbz = 0;
    if (L.B > 0 && Ea > 1e-3) {
      out.brk = L.B * sstep(0.25, 0.7, e1 / Ea) * sstep(0, 0.35, -hc1 / Ea) * k;
      const klx = (hc1 * gx + e1 * hx1) / (Ea * Ea), klz = (hc1 * gz + e1 * hz1) / (Ea * Ea), kl = Math.hypot(klx, klz);
      if (kl > 1e-5) {
        const cph = Math.sqrt(G / kl * (h === null ? 1 : Math.tanh(Math.min(kl * h, 20))));
        out.cbx = cph * klx / kl; out.cbz = cph * klz / kl;
      }
    }
    return out;
  }
  height(x, z, t) { return this.sample(x, z, t, this._tmp || (this._tmp = {})).h; }

  // The sea as a drawing shows it, per component: keep(k) is the share (0..1) of the wave of wavenumber k that the
  // drawing has (render.js seaKeep: the water grid's spacing and its far fade). A hull of length L and beam B at
  // (x, z) heading psi, as it averages the sea over its waterplane (each component by sinc(k L cos / 2) sinc(k B
  // sin / 2)): out.h its level, out.al / out.at the mean slope along (+ = bow up) and across (+ = up to starboard).
  // With keep = 1 and L = B = 0 that is the linear sea at the point. The coast's local waves are those of (x, z);
  // the limits, the second order, the trochoids' lean and the rogue groups are left out (a vessel's ride, not the
  // surface itself). unseen = true: the part the drawing leaves out instead (1 - keep).
  ride(x, z, t, psi, L, B, keep, out, unseen = false) {
    const W = this._local(x, z, 1), comps = this.comps, fx = Math.sin(psi), fz = -Math.cos(psi), sx = -fz, sz = fx;
    let h = 0, al = 0, at = 0;
    for (let n = 0; n < W.n; n++) {
      const k = W.k[n], q = keep ? keep(k) : 1, w = unseen ? 1 - q : q;
      if (w < 1e-4) continue;
      const c = comps[W.ci[n]], ca = W.ux[n] * fx + W.uz[n] * fz, cs = W.ux[n] * sx + W.uz[n] * sz;
      const ua = 0.5 * k * L * ca, uc = 0.5 * k * B * cs;
      const R = (Math.abs(ua) < 1e-4 ? 1 : Math.sin(ua) / ua) * (Math.abs(uc) < 1e-4 ? 1 : Math.sin(uc) / uc);
      const A = c.A * (c.curAmp ?? 1) * W.K[n] * w * R, th = W.p[n] + W.gx[n] * x + W.gz[n] * z - W.we[n] * t;
      const S = Math.sin(th), C = Math.cos(th);
      h += A * S; al += A * k * ca * C; at += A * k * cs * C;
    }
    const s = this.scaleFn ? this.scaleFn(x, z) : 1;
    out.h = h * s; out.al = al * s; out.at = at * s;
    return out;
  }
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// What the water is drawn with, of a wave of wavenumber k at world (x, z): keep(k), 0..1 — render.js's vertex shader
// draws each wave times fade * smoothstep(3 spc, 6 spc, wavelength). spc is the grid's spacing there: grid
// { N, R, a } is render.js _buildWater's (the vertex u in -1..1 at R (a u + (1 - a) u^3), spacing
// R (a + 3 (1 - a) u^2) 2 / N, the larger of the two axes), laid about (ox, oz), the snapped camera; the fade takes
// the sea out toward the horizon from the camera (cx, cz), further for a higher sea Hs. st: a scratch object that
// keeps the returned keep() (valid until the next call with it).
export function drawnSeaKeep(grid, ox, oz, cx, cz, Hs, x, z, st) {
  const { N, R, a } = grid;
  const inv = (d) => {                     // u in 0..1 with u (a + (1 - a) u^2) = d / R (Newton from above: convex)
    const s = Math.min(1, d / R); let u = Math.cbrt(s);
    for (let i = 0; i < 6; i++) u -= (a * u + (1 - a) * u * u * u - s) / (a + 3 * (1 - a) * u * u);
    return clamp01(u);
  };
  const dmap = (u) => R * (a + 3 * (1 - a) * u * u) * 2 / N;
  st.spc = Math.max(dmap(inv(Math.abs(x - ox))), dmap(inv(Math.abs(z - oz))));
  st.fade = 1 - sstep(700 + 60 * Hs, 3200 + 250 * Hs, Math.hypot(x - cx, z - cz));
  return st.keep || (st.keep = (k) => st.fade * sstep(3 * st.spc, 6 * st.spc, 2 * Math.PI / k));
}
// wavenumber for angular frequency w at depth h (Eckart's approximation of w^2 = g k tanh(k h))
export function kOfDepth(w, h) {
  const k0 = w * w / G;
  if (h > 30 || h === null) return k0;
  return k0 / Math.sqrt(Math.tanh(k0 * h));
}

// ---------- current ----------
// A steady stream set by hand (open water, custom places, or the menu's 'Steady' tide), flowing TOWARD dir.
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

// The real tide's stream (js/tide.js Tide: harmonic maps over the venue, advanced by Environment.tick)
export class TideCurrent {
  constructor(tide) { this.tide = tide; this.speed = 0; this.dir = 0; }
  at(x, z, out = {}) { return this.tide.streamAt(x, z, out); }
}

export class Environment {
  constructor(opts = {}) {
    this.opts = opts;
    this.weather = new Weather({ mode: opts.weather ?? 'changing', seed: (opts.seed ?? 7) * 3 + 1, tws: opts.tws ?? 6, twd: (opts.twd ?? 0) * DEG, hemi: opts.hemi });
    // thermal breezes where there is land: opts.thermal = { lat, lon, clock0 (UTC ms at t = 0), land (World) }
    if (opts.thermal) this.weather.thermal = new Thermal({ ...opts.thermal, cloud: this.weather.cloudBase() });
    this.wind = new WindField({ ...opts, weather: this.weather });
    this.waves = new WaveField({ tws: this.wind.tws, twd: this.wind.twd, fetchKm: opts.fetchKm, swellH: opts.swellH, swellT: opts.swellT, seaScale: opts.seaScale, weather: this.weather, seed: (opts.seed ?? 3) + 5, rogue: opts.rogue });
    // the tide: the real one (level and streams from the venue's harmonic constants and baked maps) or a steady stream
    this.tide = opts.tide || null;
    if (this.tide) { this.tide.setClock(opts.tideClock0 ?? opts.thermal?.clock0 ?? Date.now()); this.tide.setTime(0); }
    this.current = this.tide && opts.tideMode !== 'steady' ? new TideCurrent(this.tide) : new Current({ speed: opts.currentKt ?? 0, dir: opts.currentDir ?? 90 });
    this.focus = { x: 0, z: 0 };                  // where the sea's Doppler shift takes its stream from (the game sets it)
    const c0 = this.current.at(0, 0, {});
    this.waves.setCurrent(c0.x, c0.z);
    this._curT = 0;
    this.wavesOn = opts.wavesOn ?? true;
    this._lastWaveT = -1e9;
  }
  // the thermal's clock moved (the menu's time of day): drop everything cached by t, raise the sea anew
  setClock(clock0, t = 0) {
    if (this.tide) { this.tide.setClock(clock0); this.tide.setTime(t); }
    const th = this.weather.thermal; if (!th) return;
    th.setClock(clock0); this.weather._ct = NaN;
    // the day ahead now blows from elsewhere: lay the sea's components out anew (current and depth kept)
    const W = this.waves, cur = W.cur, world = W._world;
    W.set(W.opts); W.setCurrent(cur.x, cur.z); if (world) W.buildDepthField(world); W.update(t);
    this._lastWaveT = t;
    if (this.onSeaLayout) this.onSeaLayout(t);       // (the coast's effect on the new components: coastal.js)
  }
  // advance the slowly-changing sea state (cheap; call every frame). The sea's stream follows the tide at the focus
  // (the boat), refreshed every 20 s of game time.
  tick(t) {
    if (this.tide) this.tide.setTime(t);
    let changed = false;
    if (this.tide && this.current instanceof TideCurrent && Math.abs(t - this._curT) >= 20) {
      this._curT = t;
      const c = this.current.at(this.focus.x, this.focus.z, this._cf || (this._cf = {})), W = this.waves;
      if (Math.hypot(c.x - W.cur.x, c.z - W.cur.z) > 0.02) { W.setCurrent(c.x, c.z, t); changed = true; }
    }
    if (Math.abs(t - this._lastWaveT) > 1) { this.waves.update(t); this._lastWaveT = t; return true; }
    return changed;
  }
}
