// The sightseeing landmarks of the predefined venues, in 3D where they really stand: the bridges, towers, forts,
// lighthouses and the Opera House a sailor steers by. Low-poly procedural models at their real dimensions and
// colours (silhouettes that read at sailing distances, hundreds of metres to kilometres), merged per material
// over the whole venue (a couple of dozen draw calls), floodlit at night by the same day/night factor the town's
// lit windows follow (render.js), with aircraft-warning lights on the tall ones and the bridges' deck and necklace
// lights as glowing points that keep a few pixels at any distance (as navlights.js does for a boat).
// Each one stands on the ground the terrain is drawn on (scenery.js groundHeight, handed in as opts.ground) or, in
// the water, on the sea bed. What stands in the water (bridge towers and piers, sea forts, chalk stacks,
// lighthouses on caissons) is handed to the boats as an obstacle (main.js, with the piers); a deck high above the
// water is not one.
// Frames: world x east, z south (north is -z), y up from mean sea level (makeProjection, world.js); a landmark's
// own frame is turned to its heading (degrees true): -z points along the heading, +x to the right of it. A bridge
// is placed by its two ends, a (at +L/2) and b (at -L/2), and heads from a to b.
// No three.js import here: build(THREE, ...) is handed the library, so the node tests run the models as they are.
import { VENUES, makeProjection, MAP_RADIUS } from './world.js';

const DEG = Math.PI / 180;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ------------------------------------------------------------------ 3x4 affine matrices (row-major)
const I3 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(A, B) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = A[i * 4] * B[j] + A[i * 4 + 1] * B[4 + j] + A[i * 4 + 2] * B[8 + j];
    r[i * 4 + 3] = A[i * 4] * B[3] + A[i * 4 + 1] * B[7] + A[i * 4 + 2] * B[11] + A[i * 4 + 3];
  }
  return r;
}
const T = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; };
const YAW = (deg) => RY(-deg * DEG);           // a turn clockwise seen from above, as a bearing turns
// the frame whose y axis runs from p0 toward p1, its x axis level (for members, cables, hulls)
function along(p0, p1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2], L = Math.hypot(dx, dy, dz) || 1e-6;
  const v = [dx / L, dy / L, dz / L], r = Math.abs(v[1]) < 0.97 ? [0, 1, 0] : [1, 0, 0];
  let u = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const lu = Math.hypot(u[0], u[1], u[2]); u = [u[0] / lu, u[1] / lu, u[2] / lu];
  const w = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { M: [u[0], v[0], w[0], p0[0], u[1], v[1], w[1], p0[1], u[2], v[2], w[2], p0[2]], L };
}
function smoothNormals(P, IX) {
  const N = new Float64Array(P.length);
  for (let i = 0; i < IX.length; i += 3) {
    const a = IX[i] * 3, b = IX[i + 1] * 3, c = IX[i + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return Array.from(N);
}

// ------------------------------------------------------------------ the kit: triangles per material, lights, footings
// ctx.ground(x, z): the ground's height (m above MSL; the bed, below 0, in the water) at a point of the landmark's frame
const BOX_F = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]]];
export class Kit {
  constructor(ctx = {}) {
    this.ground = ctx.ground || (() => -10);
    this.parts = new Map(); this.lights = []; this.feet = []; this.lamps = []; this.M = I3;
  }
  g(x, z) { return this.ground(x, z); }
  // the lowest ground under a footprint of radius r (nothing floats; it sinks a little into a slope)
  gmin(x, z, r = 0) {
    let m = this.ground(x, z);
    if (r > 0) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; m = Math.min(m, this.ground(x + r * Math.cos(a), z + r * Math.sin(a)), this.ground(x + r * 0.5 * Math.cos(a), z + r * 0.5 * Math.sin(a))); }
    return m;
  }
  // a building's floor: on land the lowest ground under it, never below the waterline
  base(x, z, r) { return Math.max(0.4, this.gmin(x, z, r)); }
  with(M, fn) { const old = this.M; this.M = mul(old, M); fn(); this.M = old; }
  at(x, y, z, yawDeg, fn) { this.with(mul(T(x, y, z), YAW(yawDeg || 0)), fn); }
  _part(k) { let p = this.parts.get(k); if (!p) this.parts.set(k, p = { pos: [], nor: [], idx: [] }); return p; }
  _add(k, P, N, IX, M = this.M) {
    const p = this._part(k), o = p.pos.length / 3;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      p.pos.push(M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]);
      const a = N[i], b = N[i + 1], c = N[i + 2];
      const nx = M[0] * a + M[1] * b + M[2] * c, ny = M[4] * a + M[5] * b + M[6] * c, nz = M[8] * a + M[9] * b + M[10] * c, l = Math.hypot(nx, ny, nz) || 1;
      p.nor.push(nx / l, ny / l, nz / l);
    }
    for (const i of IX) p.idx.push(i + o);
  }
  // a box centred at (x, y, z), sizes sx, sy, sz, turned by yaw (deg)
  box(k, x, y, z, sx, sy, sz, yaw = 0) {
    if (!(sx > 0 && sy > 0 && sz > 0)) return;
    const P = [], N = [], IX = [];
    for (const [n, t1, t2] of BOX_F) {
      const o = P.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push((n[0] + t1[0] * a + t2[0] * b) * sx / 2, (n[1] + t1[1] * a + t2[1] * b) * sy / 2, (n[2] + t1[2] * a + t2[2] * b) * sz / 2);
        N.push(n[0], n[1], n[2]);
      }
      IX.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    this._add(k, P, N, IX, yaw ? mul(this.M, mul(T(x, y, z), YAW(yaw))) : mul(this.M, T(x, y, z)));
  }
  // a box between heights y0 and y1
  slab(k, x, y0, y1, z, sx, sz, yaw = 0) { if (y1 > y0) this.box(k, x, (y0 + y1) / 2, z, sx, y1 - y0, sz, yaw); }
  // a cylinder / frustum from y0 up h, radius r0 at the foot, r1 at the top; o: { n, flat, caps ('top', 'both',
  // 'none'), sx, sz (elliptic), yaw, a0, a1 (a part of the round, rad) }
  cyl(k, x, y0, z, h, r0, r1 = r0, o = {}) {
    if (!(h > 0)) return;
    const n = o.n || 12, a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2, sx = o.sx || 1, sz = o.sz || 1, caps = o.caps || 'top', full = o.a1 === undefined;
    const P = [], N = [], IX = [], slope = (r0 - r1) / h;
    const pt = (r, a, y) => [r * Math.cos(a) * sx, y, r * Math.sin(a) * sz];
    const nr = (a) => { const nx = Math.cos(a) / sx, nz = Math.sin(a) / sz, l = Math.hypot(nx, nz); return [nx / l, slope, nz / l]; };
    if (o.flat) {
      for (let i = 0; i < n; i++) {
        const aa = a0 + (a1 - a0) * i / n, ab = a0 + (a1 - a0) * (i + 1) / n, nm = nr((aa + ab) / 2), q = P.length / 3;
        for (const p of [pt(r0, aa, 0), pt(r1, aa, h), pt(r1, ab, h), pt(r0, ab, 0)]) { P.push(...p); N.push(...nm); }
        IX.push(q, q + 1, q + 2, q, q + 2, q + 3);
      }
    } else {
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, nm = nr(a); P.push(...pt(r0, a, 0), ...pt(r1, a, h)); N.push(...nm, ...nm); }
      for (let i = 0; i < n; i++) { const b = 2 * i; IX.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    }
    if (full && (caps === 'top' || caps === 'both') && r1 > 0) {
      const c = P.length / 3; P.push(0, h, 0); N.push(0, 1, 0);
      for (let i = 0; i <= n; i++) { P.push(...pt(r1, a0 + (a1 - a0) * i / n, h)); N.push(0, 1, 0); }
      for (let i = 0; i < n; i++) IX.push(c, c + 2 + i, c + 1 + i);
    }
    if (full && caps === 'both' && r0 > 0) {
      const c = P.length / 3; P.push(0, 0, 0); N.push(0, -1, 0);
      for (let i = 0; i <= n; i++) { P.push(...pt(r0, a0 + (a1 - a0) * i / n, 0)); N.push(0, -1, 0); }
      for (let i = 0; i < n; i++) IX.push(c, c + 1 + i, c + 2 + i);
    }
    this._add(k, P, N, IX, mul(this.M, mul(T(x, y0, z), YAW(o.yaw || 0))));
  }
  // a dome (part of a sphere above its equator, to latitude top rad), radius r, stretched sy upward
  dome(k, x, y, z, r, o = {}) {
    const n = o.n || 14, rows = o.rows || 4, sy = o.sy || 1, top = o.top ?? Math.PI / 2;
    const P = [], N = [], IX = [];
    for (let j = 0; j <= rows; j++) {
      const f = top * j / rows, c = Math.cos(f), s = Math.sin(f);
      for (let i = 0; i <= n; i++) { const a = Math.PI * 2 * i / n; P.push(r * c * Math.cos(a), r * s * sy, r * c * Math.sin(a)); const l = Math.hypot(c, s / sy) || 1; N.push(c * Math.cos(a) / l, s / sy / l, c * Math.sin(a) / l); }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + n + 1; IX.push(a, b, b + 1, a, b + 1, a + 1); }
    this._add(k, P, N, IX, mul(this.M, T(x, y, z)));
  }
  // a rectangular member from p0 to p1: w wide (level, across it) and d deep
  beam(k, p0, p1, w, d) { const { M, L } = along(p0, p1); this.with(M, () => this.box(k, 0, L / 2, 0, w, L, d)); }
  // a round member (cable, pipe, leg) from p0 to p1, radius r (r1 at p1)
  tube(k, p0, p1, r, n = 6, r1 = r) { const { M, L } = along(p0, p1); this.with(M, () => this.cyl(k, 0, 0, 0, L, r, r1, { n, caps: 'none' })); }
  // a parametric surface f(u, v) -> [x, y, z], u, v in [0, 1] (smooth normals; drawn double-sided by its material)
  surf(k, f, nu, nv) {
    const P = [], IX = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(...f(i / nu, j / nv));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; IX.push(a, a + 1, b + 1, a, b + 1, b); }
    const N = smoothNormals(P, IX);
    this._add(k, P, N, IX);
    // (a single-sided material gets the back faces too)
    if (!(PAL[k] && PAL[k][5])) { const R = []; for (let i = 0; i < IX.length; i += 3) R.push(IX[i], IX[i + 2], IX[i + 1]); this._add(k, P, N.map(v => -v), R); }
  }
  // rings of points ({ y, pts: [[x, z], ...] }, the same count each, counter-clockwise as cyl's), joined, capped on top
  loft(k, rings, cap = true) {
    const n = rings[0].pts.length, P = [], IX = [];
    for (const r of rings) for (const [x, z] of r.pts) P.push(x, r.y, z);
    for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n; IX.push(a, c, d, a, d, b); }
    if (cap) { const top = rings[rings.length - 1], c = P.length / 3; let cx = 0, cz = 0; for (const [x, z] of top.pts) { cx += x / n; cz += z / n; } P.push(cx, top.y, cz); for (let i = 0; i < n; i++) IX.push(c, (rings.length - 1) * n + (i + 1) % n, (rings.length - 1) * n + i); }
    this._add(k, P, smoothNormals(P, IX), IX);
  }
  // flat triangles [[p0, p1, p2], ...], each turned to face away from the vertical axis through (cx, cz)
  facets(k, tris, cx = 0, cz = 0) {
    const P = [], N = [], IX = [];
    for (const [a, b, c] of tris) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const mx = (a[0] + b[0] + c[0]) / 3 - cx, mz = (a[2] + b[2] + c[2]) / 3 - cz, flip = n[0] * mx + n[2] * mz < 0;
      if (flip) n = n.map(q => -q);
      const o = P.length / 3; for (const q of flip ? [a, c, b] : [a, b, c]) { P.push(...q); N.push(...n); } IX.push(o, o + 1, o + 2);
    }
    this._add(k, P, N, IX);
  }
  // a gable roof over sx x sz, ridge along z, h high, from y
  roof(k, x, y, z, sx, sz, h, yaw = 0) {
    const a = sx / 2, b = sz / 2;
    const P = [-a, 0, -b, a, 0, -b, a, 0, b, -a, 0, b, 0, h, -b, 0, h, b];
    const IX = [0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2];
    // (flat-shaded: each face its own vertices)
    const FP = [], FN = [], FI = [];
    for (let i = 0; i < IX.length; i += 3) {
      const t = [IX[i], IX[i + 1], IX[i + 2]].map(q => [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]]);
      const u = [t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], v = [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]];
      const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const o = FP.length / 3; for (const p of t) { FP.push(...p); FN.push(...nn); } FI.push(o, o + 1, o + 2);
    }
    this._add(k, FP, FN, FI, mul(this.M, mul(T(x, y, z), YAW(yaw))));
  }
  // a glowing point at night: col (linear rgb, may exceed 1), s its apparent size (m), blink period (s, 0 steady)
  light(x, y, z, col, s = 2.5, blink = 0) { const M = this.M; this.lights.push([M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11], col, s, blink]); }
  // where this model's lantern is: the charted light of the seamark here shines from it (its generic tower is not drawn)
  lamp(x, y, z) { const M = this.M; this.lamps.push([M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]]); }
  // a footing in the water (an obstacle to boats if it is wet): centre, length along yaw (deg), width
  foot(x, z, len, w, yaw = 0) {
    const M = this.M, a = yaw * DEG, ux = Math.sin(a), uz = -Math.cos(a), h = Math.max(0, len - w) / 2 + 0.05;
    const p = (px, pz) => [M[0] * px + M[2] * pz + M[3], M[8] * px + M[10] * pz + M[11]];
    this.feet.push({ a: p(x - ux * h, z - uz * h), b: p(x + ux * h, z + uz * h), w, c: p(x, z) });
  }
  // triangles, all parts
  get tris() { let n = 0; for (const p of this.parts.values()) n += p.idx.length / 3; return n; }
  // everything of K, moved by M, into this kit
  absorb(K, M) {
    for (const [k, p] of K.parts) this._add(k, p.pos, p.nor, p.idx, M);
    for (const [x, y, z, c, s, b] of K.lights) this.lights.push([M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11], c, s, b]);
  }
}

// ------------------------------------------------------------------ materials
// [colour, roughness, metalness, emissive, emissive intensity at full night, double-sided]
const PAL = {
  intl: [0xc0362c, 0.7, 0.15, 0xff6a30, 0.32],        // International Orange (the Golden Gate), its towers floodlit
  silver: [0xa7aeb2, 0.5, 0.35, 0xdfe6ff, 0.06],      // the Bay Bridge's aluminium grey
  pell: [0x86a394, 0.6, 0.2, 0xd8f0e0, 0.05],         // the Newport Bridge's grey-green
  shb: [0x6e7377, 0.55, 0.35, 0xffe6c0, 0.12],        // "Harbour Bridge grey", floodlit
  granite: [0xb6ab98, 0.92, 0, 0xffdcae, 0.22],
  conc: [0xb4b0a6, 0.92, 0, 0xffe2b8, 0.04],
  conc2: [0xd9d4c6, 0.9, 0, 0xffe2b8, 0.05],          // Alcatraz's whitewashed concrete
  stone: [0xdccfb4, 0.9, 0, 0xffd9a0, 0.3],           // pale limestone, floodlit
  stoneG: [0xd3c09a, 0.92, 0, 0xffd29a, 0.28],        // Riva's warm stone
  sand: [0xc8a978, 0.92, 0, 0xffd29a, 0.18],          // Sydney sandstone
  green: [0x58735c, 0.85, 0, 0xffd9a0, 0.2],          // Florentine green stone (the Marseille bands)
  podium: [0xbfa98c, 0.9, 0, 0xffd9a8, 0.12],         // the Opera House's granite podium
  tile: [0xf3f0e6, 0.32, 0, 0xfff2dc, 0.42, 1],       // the Opera House's shells, floodlit
  glass: [0x2b3236, 0.15, 0.6, 0xffc684, 0.95],       // glazing, lit from inside at night
  goldglass: [0x8a6a2c, 0.25, 0.7, 0xffcf7a, 1.1],    // the Sydney Tower's golden turret
  podglass: [0x34454f, 0.2, 0.6, 0xbfe0ff, 1.2],      // the Sky Tower's pod, lit
  white: [0xf0eee8, 0.6, 0, 0xfff0d8, 0.14],
  quartz: [0xe9e6de, 0.55, 0.05, 0xffe9c4, 0.22],     // the Transamerica Pyramid
  crown: [0xd8dde0, 0.3, 0.6, 0xffffff, 0.7],         // its lit spire
  red: [0xb3261e, 0.6, 0, 0xff6040, 0.1],
  black: [0x1e2022, 0.5, 0.3],
  iron: [0x34383b, 0.6, 0.5],
  brick: [0x7a3527, 0.9, 0, 0xffc890, 0.12],
  brickL: [0xb27850, 0.88, 0, 0xffd29a, 0.2],         // honey sandstone and brick (the Auckland Ferry Building)
  roof: [0x8e3b25, 0.8],
  slate: [0x4a4e54, 0.75],
  copper: [0x5f8f7a, 0.6, 0.2],
  gold: [0xd8b04a, 0.3, 0.9, 0xffd27a, 0.8],
  lantern: [0xfff4d0, 0.2, 0, 0xfff0c8, 1.6],         // lighthouse lanterns
  rock: [0x6f6a62, 0.95],
  chalk: [0xe6e3d8, 0.95],
  grass: [0x6b7a45, 1],
  dry: [0x9a8d62, 1],
  steel: [0x6a7075, 0.45, 0.6],
  cable: [0x3a3d40, 0.5, 0.6],
  asphalt: [0x3a3c40, 0.95],
  ochre: [0xc9a27a, 0.85, 0, 0xffcf96, 0.3],          // the Palace of Fine Arts
  ochreD: [0x8c6a4c, 0.9],
  dome: [0xb5875f, 0.8, 0, 0xffcf96, 0.25],
  dark: [0x4a4d50, 0.8, 0.1, 0xffd6a0, 0.25],         // the MuCEM's lattice
  sub: [0x41474c, 0.6, 0.3],
  crane: [0x2f62a8, 0.6, 0.3],
  cont: [0xb8412c, 0.7], cont2: [0x1d4e89, 0.7], cont3: [0x2e7d4f, 0.7],
  rust: [0xb9a58a, 0.85],
  verdigris: [0x6fa996, 0.62, 0.25, 0xa8e8cc, 0.2],    // the Statue of Liberty's copper patina, floodlit
  pgranite: [0xb9a398, 0.9, 0, 0xffe0c0, 0.13],       // her pedestal's pink Stony Creek granite, floodlit
  fort: [0xa59c8a, 0.94, 0, 0xffdcae, 0.04],          // Fort Wood's granite walls
  wtc: [0x8ea2ae, 0.1, 0.85, 0xdde8ff, 0.42],         // One World Trade Center's glass
  bbtan: [0xc4ad86, 0.7, 0.2, 0xffe2b8, 0.1],         // the Brooklyn Bridge's tan steel and cables
  vnb: [0x8d969b, 0.5, 0.45, 0xe8eeff, 0.05],         // the Verrazzano's grey steel
  redstone: [0x93533f, 0.92, 0, 0xffc890, 0.15],      // Castle Williams' red sandstone
  brown: [0x6a4a35, 0.7, 0.2],                        // Robbins Reef's brown lower tower
};
export const MATERIAL_KEYS = Object.keys(PAL);
export function makeMaterial(THREE, k) {
  const p = PAL[k] || PAL.conc;
  const m = new THREE.MeshStandardMaterial({ color: p[0], roughness: p[1], metalness: p[2] || 0, emissive: p[3] ?? 0, emissiveIntensity: 0, side: p[5] ? THREE.DoubleSide : THREE.FrontSide });
  m.name = 'landmark-' + k; m.userData.night = p[4] || 0;
  return m;
}

// ------------------------------------------------------------------ night lights (glowing points)
const WARM = [1.4, 0.95, 0.5], WHITE = [1.3, 1.25, 1.1], LED = [1.1, 1.2, 1.4], RED = [2.2, 0.12, 0.06];
const LU = { uOn: { value: 0 }, uScale: { value: 600 }, uPx: { value: 1 }, uTime: { value: 0 } };
let LMAT = null;
function lightMaterial(THREE) {
  if (LMAT) return LMAT;
  LMAT = new THREE.ShaderMaterial({
    uniforms: LU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute vec2 aSz; uniform float uOn; uniform float uScale; uniform float uPx; uniform float uTime; varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = max(-mv.z, 0.1);
        float on = uOn;
        // (an aircraft-warning light blinks, each on its own phase)
        if (aSz.y > 0.0) on *= step(0.45, fract(uTime / aSz.y + fract(position.x * 0.0131 + position.z * 0.0077)));
        vC = aCol * on * exp(-d * 0.00006);
        gl_PointSize = on > 0.0 ? clamp(aSz.x * uScale / d, 2.0 * uPx, 10.0 * uPx) : 0.0;
        gl_Position = projectionMatrix * mv;
        gl_Position.z -= 0.0005 * gl_Position.w;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 6.0) * 1.8, halo = (1.0 - r2) * 0.3;
        gl_FragColor = vec4(vC * (core + halo) + vec3(core * 0.25) * max(max(vC.r, vC.g), vC.b), 1.0);
      }`,
  });
  return LMAT;
}

function toObject(THREE, K, mat) {
  const group = new THREE.Group();
  for (const [k, p] of K.parts) {
    if (!p.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(p.idx, 1));
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat(k)); m.castShadow = true; m.receiveShadow = true; m.name = k;
    group.add(m);
  }
  if (K.lights.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(K.lights.flatMap(l => [l[0], l[1], l[2]]), 3));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(K.lights.flatMap(l => l[3]), 3));
    g.setAttribute('aSz', new THREE.Float32BufferAttribute(K.lights.flatMap(l => [l[4], l[5]]), 2));
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    const pts = new THREE.Points(g, lightMaterial(THREE)); pts.name = 'lights'; pts.renderOrder = 5; pts.frustumCulled = false;
    group.add(pts);
  }
  return group;
}

// ------------------------------------------------------------------ building blocks
// a lighthouse tower: o { x, z, y0 (foot), h (to the gallery), r0, r1, n, key, bands [[f0, f1, key]...] (fractions
// of h), stripes [k1, k2] (vertical), square, lantern height, domeKey }; registers its lantern; returns its top
function lighthouse(K, o) {
  const { x = 0, z = 0, y0, h, r0, r1 = r0 * 0.75, key = 'white', square = false } = o;
  const n = square ? 4 : (o.n || 14), yaw = square ? 45 : 0, flat = square || !!o.stripes || !!o.flat;
  if (o.stripes) for (let i = 0; i < n; i++) K.cyl(o.stripes[i % 2], x, y0, z, h, r0, r1, { n: 1, flat: true, a0: i * Math.PI * 2 / n, a1: (i + 1) * Math.PI * 2 / n });
  else for (const [f0, f1, k] of o.bands || [[0, 1, key]]) K.cyl(k, x, y0 + h * f0, z, h * (f1 - f0), mix(r0, r1, f0), mix(r0, r1, f1), { n, flat, yaw, caps: f1 >= 1 ? 'top' : 'none' });
  const yG = y0 + h, rl = (square ? r1 * 0.75 : r1) * 0.72, lh = o.lantern || Math.max(2, r1 * 0.9);
  K.cyl('black', x, yG, z, 0.45, r1 + 0.7, r1 + 0.7, { n: 12, caps: 'both' });               // the gallery
  K.cyl('lantern', x, yG + 0.45, z, lh, rl, rl, { n: 10 });
  K.dome(o.domeKey || 'black', x, yG + 0.45 + lh, z, rl * 1.12, { n: 10, rows: 3 });
  K.lamp(x, yG + 0.45 + lh / 2, z);
  return yG + 0.45 + lh + rl * 1.12;
}
// a cottage: walls sx x sz x h from y, a gable roof
function house(K, x, y, z, sx, sz, h, yaw = 0, wall = 'white', roofK = 'roof') {
  K.at(x, 0, z, yaw, () => { K.slab(wall, 0, y - 3, y + h, 0, sx, sz); K.roof(roofK, 0, y + h, 0, sx + 0.8, sz + 0.8, Math.min(sx, sz) * 0.45); K.slab('glass', 0, y + h * 0.35, y + h * 0.65, 0, sx + 0.12, sz * 0.7); });
}
// battlements along the top of a wall run from (x0, z0) to (x1, z1) at y
function merlons(K, k, x0, z0, x1, z1, y, t = 1.2, h = 1.6, gap = 2.4) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(L / (gap * 2))), yaw = Math.atan2(x1 - x0, -(z1 - z0)) / DEG;
  for (let i = 0; i < n; i++) { const t0 = (i + 0.5) / n; K.box(k, mix(x0, x1, t0), y + h / 2, mix(z0, z1, t0), t, h, gap, yaw); }
}
// a wall run on the ground between two points (its foot follows the lowest ground along it)
function wall(K, k, x0, z0, x1, z1, h, t, top = null) {
  const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.5) return;
  const g = Math.max(-6, Math.min(K.g(x0, z0), K.g(x1, z1), K.g((x0 + x1) / 2, (z0 + z1) / 2)));
  const y1 = top ?? Math.max(0.4, g) + h;
  K.box(k, (x0 + x1) / 2, (g - 3 + y1) / 2, (z0 + z1) / 2, t, y1 - g + 3, L + t * 0.5, Math.atan2(x1 - x0, -(z1 - z0)) / DEG);
  return y1;
}
// a ring of n equal walls round (cx, cz), radius r (a polygonal fort), with towers at the corners
function ringWall(K, k, cx, cz, r, n, h, t, rot = 0, tower = null) {
  for (let i = 0; i < n; i++) {
    const a = rot * DEG + i * Math.PI * 2 / n, b = rot * DEG + (i + 1) * Math.PI * 2 / n;
    wall(K, k, cx + r * Math.sin(a), cz - r * Math.cos(a), cx + r * Math.sin(b), cz - r * Math.cos(b), h, t);
    if (tower) tower(cx + r * Math.sin(a), cz - r * Math.cos(a), a / DEG);
  }
}

// ------------------------------------------------------------------ bridges
// the deck from a (s = 0, at z = +L/2) to b (s = L): its top at y(s); w wide, depth deep; piers under the given
// stretches [[s0, s1, step]]; deck lamps every `lamps` m on both sides
function deckRun(K, o) {
  const { L, y, w, depth, key, step = 30 } = o, zs = (s) => L / 2 - s;
  const n = Math.max(1, Math.ceil(L / step));
  for (let i = 0; i < n; i++) {
    const s0 = Math.max(0, L * i / n - 0.4), s1 = Math.min(L, L * (i + 1) / n + 0.4);
    K.beam(key, [0, y(s0) - depth / 2, zs(s0)], [0, y(s1) - depth / 2, zs(s1)], w, depth);
    K.beam('asphalt', [0, y(s0) + 0.1, zs(s0)], [0, y(s1) + 0.1, zs(s1)], w - 3, 0.3);
  }
  for (const [sa, sb, st] of o.piers || []) for (let s = sa; s <= sb + 0.01; s += st) {
    const z = zs(s), g = K.g(0, z), top = y(s) - depth, wet = g < 0.3, bot = wet ? Math.max(g, -16) - 1 : g - 2;
    if (top - bot < 2) continue;
    for (const x of [-(w / 2 - 3), w / 2 - 3]) K.slab(o.pierKey || 'conc', x, bot, top, z, 3.6, 3.6);
    K.slab(o.pierKey || 'conc', 0, top - 2.4, top, z, w, 3.6);
    if (wet) K.foot(0, z, w, 5, 90);
  }
  if (o.lamps) for (let s = o.lamps / 2; s < L; s += o.lamps) for (const x of [-(w / 2 - 0.6), w / 2 - 0.6]) K.light(x, y(s) + 7, zs(s), o.lampCol || WARM, 2.4);
}
// a suspension bridge's two main cables and their suspenders: anchorages [a1, a2], towers [t1, t2] (stations
// from a), the saddles at yTop, the low point yLow; necklace lights every `neck` m
function cables(K, o) {
  const { L, anchors: [a1, a2], towers: [t1, t2], yTop, yLow, sep, r, key, deck, hang = 15, neck = 0 } = o;
  const zs = (s) => L / 2 - s, sm = (t1 + t2) / 2, half = (t2 - t1) / 2;
  const yA1 = o.yAnch ? o.yAnch[0] : deck(a1) + 2, yA2 = o.yAnch ? o.yAnch[1] : deck(a2) + 2;
  const side = (s, sa, sb, ya, yb) => { const t = (s - sa) / (sb - sa); return mix(ya, yb, t) - 0.03 * Math.abs(sb - sa) * 4 * t * (1 - t); };
  const cy = (s) => s < t1 ? side(s, a1, t1, yA1, yTop) : s <= t2 ? yLow + (yTop - yLow) * ((s - sm) / half) ** 2 : side(s, t2, a2, yTop, yA2);
  const spans = [[a1, t1], [t1, t2], [t2, a2]];
  for (const x of [-sep / 2, sep / 2]) {
    for (const [sa, sb] of spans) {
      const n = Math.max(2, Math.ceil((sb - sa) / 20));
      for (let i = 0; i < n; i++) { const s0 = mix(sa, sb, i / n), s1 = mix(sa, sb, (i + 1) / n); K.tube(key, [x, cy(s0), zs(s0)], [x, cy(s1), zs(s1)], r, 6); }
      for (let s = sa + hang; s < sb - hang * 0.5; s += hang) { const yd = deck(s), yc = cy(s); if (yc - yd > 1.5) K.beam(key, [x, yd, zs(s)], [x, yc, zs(s)], 0.4, 0.4); }
      if (neck) for (let s = sa + neck / 2; s < sb; s += neck) K.light(x, cy(s) + 0.9, zs(s), LED, 2.2);
    }
  }
}
// a cable anchorage (or a deck's abutment block): concrete from the ground (or the bed) to above the deck
function anchorage(K, z, yD, w, d, key = 'conc') {
  const g = K.gmin(0, z, d / 2), wet = g < 0.3, bot = wet ? Math.max(g, -20) - 2 : g - 3;
  K.slab(key, 0, bot, yD + 3, z, w, d);
  if (wet) K.foot(0, z, w, d, 90);
}
// a tower's footing in the water (a caisson to above the waterline) or on land; returns the tower's foot
function towerPier(K, z, w, d) {
  const g = K.gmin(0, z, d / 2), wet = g < 0.3;
  if (wet) { K.slab('conc', 0, Math.max(g, -20) - 2, 7, z, w, d); K.foot(0, z, w, d, 90); return 7; }
  K.slab('conc', 0, g - 3, g + 2, z, w, d); return g + 2;
}

// The Golden Gate Bridge (1937): a 1280 m main span between two 227 m towers, side spans of 343 m, the deck 67 m
// over the water at mid-span on a 7.6 m stiffening truss 27.4 m wide, the main cables 27.4 m apart.
// a: the San Francisco end (the toll plaza), b: Marin (Vista Point); the main span's middle 1363 m from a.
function goldenGate(K, L) {
  const sm = 1363, t1 = sm - 640, t2 = sm + 640, a1 = t1 - 343, a2 = t2 + 343, zs = (s) => L / 2 - s;
  const endA = clamp(K.gmin(0, zs(0), 10) + 1.5, 6, 60), endB = clamp(K.gmin(0, zs(L), 10) + 1.5, 6, 60);
  const yA = 69, yT = 72.5, yM = 75;
  const deck = (s) => s <= a1 ? mix(endA, yA, s / a1) : s < t1 ? mix(yA, yT, (s - a1) / (t1 - a1)) : s <= t2 ? yT + (yM - yT) * (1 - ((s - sm) / 640) ** 2)
    : s < a2 ? mix(yT, yA, (s - t2) / (a2 - t2)) : mix(yA, endB, (s - a2) / (L - a2));
  deckRun(K, { L, y: deck, w: 27.4, depth: 7.6, key: 'intl', piers: [[25, a1 - 25, 48], [a2 + 25, L - 20, 48]], pierKey: 'intl', lamps: 38 });
  for (const s of [t1, t2]) {
    const z = zs(s), yD = deck(s), b = towerPier(K, z, 48, 30);
    const secs = [[b, yD - 6, 11, 17], [yD - 6, 125, 10, 15], [125, 170, 9, 13], [170, 223, 8, 11]];
    for (const x of [-13.7, 13.7]) {
      for (const [y0, y1, w, d] of secs) K.slab('intl', x, y0, y1, z, w, d);
      // (the art-deco setbacks: ribs up the legs' faces)
      for (const dz of [-4, 4]) K.slab('intl', x + Math.sign(x) * 4.6, yD, 205, z + dz, 1.2, 1.6);
      K.slab('intl', x, 223, 227, z, 6, 9);                  // the saddle housing
      K.light(x, 228, z, RED, 3.2, 1.6);
    }
    for (const [y0, y1] of [[yD - 17, yD - 8], [112, 121], [151, 159], [189, 196], [214, 223]]) K.slab('intl', 0, y0, y1, z, 21, 7);
  }
  for (const s of [a1, a2]) anchorage(K, zs(s), deck(s), 36, 44);
  cables(K, { L, anchors: [a1, a2], towers: [t1, t2], yTop: 224.5, yLow: yM + 2.5, sep: 27.4, r: 0.8, key: 'intl', deck });
}
// The San Francisco–Oakland Bay Bridge's western span (1936): two suspension bridges end to end, each with a 704 m
// main span and 354 m side spans, meeting at the concrete central anchorage; towers ~150 m, the upper deck ~60 m
// up on a 9 m double-deck truss. a: the San Francisco anchorage (Rincon Hill), b: the Yerba Buena Island anchorage.
function bayBridge(K, L) {
  const f = L / 2824, st = [0, 354, 1058, 1412, 1766, 2470, 2824].map(s => s * f), zs = (s) => L / 2 - s;
  const yE = 58, yT = 61, yM = 64;
  const deck = (s) => {
    for (const [a, t1, t2, b] of [[st[0], st[1], st[2], st[3]], [st[3], st[4], st[5], st[6]]]) if (s >= a && s <= b) {
      if (s < t1) return mix(yE, yT, (s - a) / (t1 - a));
      if (s <= t2) { const u = (s - (t1 + t2) / 2) / ((t2 - t1) / 2); return yT + (yM - yT) * (1 - u * u); }
      return mix(yT, yE, (s - t2) / (b - t2));
    }
    return yE;
  };
  deckRun(K, { L, y: deck, w: 20, depth: 9, key: 'silver', lamps: 36 });
  for (const s of [st[1], st[2], st[4], st[5]]) {
    const z = zs(s), yD = deck(s), b = towerPier(K, z, 40, 26), top = 152;
    for (const x of [-10, 10]) { K.slab('silver', x, b, top, z, 6.5, 9); K.light(x, top + 0.8, z, RED, 3, 1.6); }
    const lv = [yD - 12, yD + 22, yD + 52, yD + 80, top - 4];
    for (const y of lv) K.slab('silver', 0, y - 2, y + 2, z, 20, 6);
    for (let i = 1; i + 1 < lv.length; i++) { K.beam('silver', [-10, lv[i], z], [10, lv[i + 1], z], 1.4, 1.4); K.beam('silver', [10, lv[i], z], [-10, lv[i + 1], z], 1.4, 1.4); }
  }
  anchorage(K, zs(st[0]), deck(st[0]), 34, 50); anchorage(K, zs(st[6]), deck(st[6]), 34, 50);
  { // the central anchorage (W4): a concrete pier to the deck and the cable bents above it
    const z = zs(st[3]), g = K.g(0, z);
    K.slab('conc', 0, Math.max(g, -24) - 2, deck(st[3]) + 2, z, 40, 60); K.foot(0, z, 40, 60, 90);
    for (const x of [-10, 10]) K.slab('conc', x, deck(st[3]) + 2, 88, z, 8, 18);
    K.slab('conc', 0, 84, 92, z, 30, 18);
  }
  cables(K, { L, anchors: [st[0], st[3]], towers: [st[1], st[2]], yTop: 150, yLow: yM + 3, sep: 20, r: 0.7, key: 'silver', deck, neck: 14, yAnch: [yE + 2, 88] });
  cables(K, { L, anchors: [st[3], st[6]], towers: [st[4], st[5]], yTop: 150, yLow: yM + 3, sep: 20, r: 0.7, key: 'silver', deck, neck: 14, yAnch: [88, yE + 2] });
}
// The Claiborne Pell Newport Bridge (1969): a 488 m main span between 122 m towers, 210 m side spans anchored on
// piers in the water, 65 m of clearance, and the necklace lights along its cables; long approach viaducts.
// a: the Newport end (east), b: Jamestown, Conanicut Island; the main span's middle 2350 m from a.
function pellBridge(K, L) {
  const sm = 2350, t1 = sm - 244, t2 = sm + 244, a1 = t1 - 210, a2 = t2 + 210, zs = (s) => L / 2 - s;
  const endA = clamp(K.gmin(0, zs(0), 10) + 1.5, 6, 40), endB = clamp(K.gmin(0, zs(L), 10) + 1.5, 6, 40);
  const yA = 59, yT = 64, yM = 68;
  const deck = (s) => s <= a1 ? mix(endA, yA, Math.sin(Math.PI / 2 * s / a1)) : s < t1 ? mix(yA, yT, (s - a1) / (t1 - a1)) : s <= t2 ? yT + (yM - yT) * (1 - ((s - sm) / 244) ** 2)
    : s < a2 ? mix(yT, yA, (s - t2) / (a2 - t2)) : mix(yA, endB, 1 - Math.cos(Math.PI / 2 * (s - a2) / (L - a2)));
  deckRun(K, { L, y: deck, w: 21, depth: 4.5, key: 'pell', piers: [[40, a1 - 30, 72], [a2 + 30, L - 30, 72]], lamps: 40 });
  for (const s of [t1, t2]) {
    const z = zs(s), yD = deck(s), b = towerPier(K, z, 34, 16);
    for (const x of [-10.5, 10.5]) { K.slab('pell', x, b, yD, z, 6.5, 8); K.slab('pell', x, yD, 122, z, 5, 6.5); K.light(x, 122.8, z, RED, 3, 1.6); }
    for (const [y0, y1] of [[yD - 9, yD - 4.5], [yD + 27, yD + 31], [115, 122]]) K.slab('pell', 0, y0, y1, z, 21, 5);
  }
  for (const s of [a1, a2]) anchorage(K, zs(s), deck(s), 28, 30);
  cables(K, { L, anchors: [a1, a2], towers: [t1, t2], yTop: 120.5, yLow: yM + 2.5, sep: 21, r: 0.6, key: 'pell', deck, neck: 10 });
}
// The Sydney Harbour Bridge (1932): a two-hinged steel through-arch of 503 m, its top 134 m over the water, the
// deck 49 m wide some 50 m up, a granite-faced pylon 89 m high at each corner, steel approach spans: 1149 m in all.
// a: Dawes Point (south), b: Milsons Point (north).
function harbourBridge(K, L) {
  const c = L / 2, zs = (s) => L / 2 - s, half = 251.5;
  const endA = clamp(K.gmin(0, zs(0), 10) + 1.5, 8, 48), endB = clamp(K.gmin(0, zs(L), 10) + 1.5, 8, 48);
  const sP = [c - half - 17, c + half + 17];          // the pylons' middles
  const deck = (s) => { const d = Math.abs(s - c); if (d <= half + 34) return 52 - 2 * (d / (half + 34)) ** 2; const t = (d - half - 34) / (c - half - 34); return mix(50, s < c ? endA : endB, t * t); };
  deckRun(K, { L, y: deck, w: 49, depth: 4, key: 'shb', piers: [[22, sP[0] - 40, 50], [sP[1] + 40, L - 22, 50]], pierKey: 'granite', lamps: 30 });
  // the two arch trusses, 30 m apart
  const N = 28, yt = (u) => 60 + 74 * (1 - (2 * u - 1) ** 2), yb = (u) => 3 + 113 * (1 - (2 * u - 1) ** 2);
  const sOf = (u) => c - half + 2 * half * u;
  for (const x of [-15, 15]) {
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, z0 = zs(sOf(u0)), z1 = zs(sOf(u1));
      K.beam('shb', [x, yt(u0), z0], [x, yt(u1), z1], 3, 3.5);
      K.beam('shb', [x, yb(u0), z0], [x, yb(u1), z1], 3.6, 4.6);
      if (i % 2 === 0) K.beam('shb', [x, yb(u0), z0], [x, yt(u1), z1], 1.5, 1.5); else K.beam('shb', [x, yt(u0), z0], [x, yb(u1), z1], 1.5, 1.5);
      K.light(x, yt(u0) + 2.2, z0, WHITE, 2.2);
    }
    for (let i = 0; i <= N; i++) {
      const u = i / N, z = zs(sOf(u)), yd = deck(sOf(u));
      K.beam('shb', [x, yb(u), z], [x, yt(u), z], 1.7, 1.7);
      if (i > 0 && i < N && Math.abs(yb(u) - yd) > 3) K.beam('shb', [x, Math.min(yb(u), yd - 4), z], [x, Math.max(yb(u), yd - 4), z], 1.2, 1.2);   // hangers / posts
    }
  }
  // lateral bracing between the trusses
  for (let i = 0; i <= N; i++) {
    const u = i / N, z = zs(sOf(u));
    K.beam('shb', [-15, yt(u), z], [15, yt(u), z], 1.2, 1.4);
    if (i % 2 === 0) K.beam('shb', [-15, yb(u), z], [15, yb(u), z], 1.4, 1.6);
    if (i < N && i % 2 === 0) { const z1 = zs(sOf(u + 1 / N)), u1 = u + 1 / N; K.beam('shb', [-15, yt(u), z], [15, yt(u1), z1], 0.9, 0.9); K.beam('shb', [15, yt(u), z], [-15, yt(u1), z1], 0.9, 0.9); }
  }
  for (const x of [-15, 15]) { K.light(x, 136.5, zs(c), RED, 3, 1.6); for (const s of [c - half, c + half]) K.slab('granite', x, -2, 6, zs(s), 7, 9); }
  K.slab('white', 0, 136, 147, zs(c), 0.4, 0.4);                                     // the flagpoles on the summit
  // the pylons, the abutment towers between them
  for (const s of sP) {
    const z = zs(s), g = Math.max(-4, K.gmin(0, z, 20));
    K.slab('granite', 0, g - 3, deck(s) - 4, z, 68, 34);
    if (g < 0.3) K.foot(0, z, 68, 34, 90);
    for (const x of [-34, 34]) {
      K.slab('granite', x, g - 3, 58, z, 19, 32); K.slab('granite', x, 58, 76, z, 17, 29); K.slab('granite', x, 76, 85, z, 15, 26); K.slab('granite', x, 85, 89, z, 12, 21);
      K.slab('black', x, 66, 76, z, 8, 29.4);                                      // the arched openings, through along the axis
      K.light(x, 89.6, z, RED, 2.6, 1.6);
    }
  }
}

// ------------------------------------------------------------------ the Opera House
// a shell: its ridge rising from the podium at zb and curling forward to the apex (za, h up), its front edges coming
// down to the podium either side (w wide) behind the apex; the mouth glazed
function shell(K, x0, y0, zb, za, h, w) {
  const dir = Math.sign(za - zb), zc = za - dir * 0.2 * Math.abs(za - zb);
  const ridge = (t) => { const a = t * Math.PI / 2; return [x0, y0 + h * Math.sin(a), zb + (za - zb) * (1 - Math.cos(a))]; };
  const edge = (t, s) => [x0 + s * (w / 2) * (1 - t) * (1 + 0.3 * Math.sin(Math.PI * t)), y0 + h * Math.pow(t, 0.8), zc + (za - zc) * t];
  for (const s of [-1, 1]) K.surf('tile', (t, v) => {
    const R = ridge(t), E = edge(t, s), b = Math.sin(Math.PI * v) * (1 - 0.9 * t);
    return [mix(R[0], E[0], v) + s * b * w * 0.12, mix(R[1], E[1], v) + b * h * 0.07, mix(R[2], E[2], v)];
  }, 10, 5);
  K.surf('glass', (t, v) => { const A = edge(t, -1), B = edge(t, 1); return [mix(A[0], B[0], v), mix(A[1], B[1], v), mix(A[2], B[2], v) - dir * (1.5 + 3 * Math.sin(Math.PI * v) * (1 - t))]; }, 8, 3);
}
function operaHouse(K) {
  const b = K.base(0, 0, 50), top = b + 7.5;
  K.slab('podium', 0, b - 8, top, 8, 112, 168);                                       // the podium on Bennelong Point
  K.slab('podium', 0, b - 6, top - 3, -84, 84, 12);
  K.beam('podium', [0, top, 92], [0, b + 0.5, 124], 92, 1.2);                         // the Monumental Steps
  for (const [x, list] of [[-26, [[58, 92, 27, 30], [56, 12, 40, 42], [30, -30, 58.5, 52], [2, -72, 50, 46]]],                // Concert Hall (west)
    [26, [[56, 86, 24, 28], [52, 12, 36, 38], [27, -28, 52, 48], [0, -64, 44, 42]]]])                                          // Joan Sutherland Theatre
    for (const [zb, za, h, w] of list) shell(K, x, top, zb, za, h, w);
  shell(K, -47, top, 96, 70, 17, 20); shell(K, -47, top, 74, 98, 12, 15);          // the restaurant's pair
  for (let z = -70; z <= 80; z += 30) for (const x of [-56, 56]) K.light(x, top + 1, z, WARM, 2);
}

// ------------------------------------------------------------------ towers
function skyTower(K) {          // Auckland's Sky Tower (1997): 328 m, a 12 m shaft, the pod at 182-222 m, a 92 m mast
  const b = K.base(0, 0, 14);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; K.beam('conc', [14 * Math.cos(a), b - 2, 14 * Math.sin(a)], [6 * Math.cos(a), b + 45, 6 * Math.sin(a)], 3, 3); }
  K.cyl('conc', 0, b - 2, 0, 238, 7.5, 6, { n: 12 });
  K.cyl('conc', 0, b + 172, 0, 10, 6, 16, { n: 16, caps: 'none' });
  K.cyl('podglass', 0, b + 182, 0, 16, 16, 16.5, { n: 16 });
  K.cyl('white', 0, b + 198, 0, 5, 17.5, 17.5, { n: 16 });
  K.cyl('conc', 0, b + 203, 0, 8, 16, 10, { n: 16 });
  K.cyl('podglass', 0, b + 214, 0, 7, 9, 9.5, { n: 16 });
  K.cyl('white', 0, b + 221, 0, 4, 10, 8, { n: 16 });
  K.cyl('white', 0, b + 236, 0, 64, 2.6, 1.6, { n: 8 });
  K.cyl('red', 0, b + 300, 0, 28, 1.6, 0.4, { n: 8 });
  K.light(0, b + 329, 0, RED, 3.5, 1.6); K.light(0, b + 290, 0, RED, 2.5, 0);
  for (let i = 0; i < 4; i++) K.light(17.6 * Math.cos(i * Math.PI / 2), b + 200.5, 17.6 * Math.sin(i * Math.PI / 2), RED, 2.5, 0);
}
function sydneyTower(K) {       // Sydney Tower (1981): 309 m, its golden turret at 250-275 m, on the Westfield podium
  const b = K.base(0, 0, 25);
  K.slab('conc', 0, b - 2, b + 22, 0, 48, 48);
  K.cyl('steel', 0, b + 22, 0, 228, 3.8, 3.8, { n: 10 });
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, a2 = a + 0.5; K.tube('cable', [13 * Math.cos(a), b + 22, 13 * Math.sin(a)], [5 * Math.cos(a2), b + 240, 5 * Math.sin(a2)], 0.35, 4); }
  K.cyl('steel', 0, b + 246, 0, 4, 6, 15, { n: 16, caps: 'none' });
  K.cyl('goldglass', 0, b + 250, 0, 12, 15, 15, { n: 16 });
  K.cyl('goldglass', 0, b + 262, 0, 10, 17, 17, { n: 16 });
  K.cyl('steel', 0, b + 272, 0, 4, 13, 11, { n: 16 });
  K.cyl('steel', 0, b + 276, 0, 5, 6, 5, { n: 12 });
  K.cyl('steel', 0, b + 281, 0, 28, 1.6, 0.4, { n: 6 });
  K.light(0, b + 309.5, 0, RED, 3.5, 1.6);
  for (let i = 0; i < 4; i++) K.light(17.3 * Math.cos(i * Math.PI / 2), b + 272, 17.3 * Math.sin(i * Math.PI / 2), RED, 2.5);
}
function transamerica(K) {      // the Transamerica Pyramid (1972): 260 m, a 53 m square base, the wings from floor 29
  const b = K.base(0, 0, 26);
  K.cyl('quartz', 0, b - 3, 0, 215, 37.5, 6.4, { n: 4, flat: true, yaw: 45 });
  K.cyl('crown', 0, b + 212, 0, 48, 6.4, 0.3, { n: 4, flat: true, yaw: 45 });
  for (const x of [-14, 14]) K.slab('quartz', x, b + 105, b + 228, 0, 9, 11);
  K.slab('glass', 0, b + 1, b + 8, 0, 54.5, 54.5);
  K.light(0, b + 260.5, 0, RED, 3.5, 1.6);
}
function coitTower(K) {         // Coit Tower (1933): a fluted concrete column 64 m high on Telegraph Hill, floodlit
  const b = K.base(0, 0, 14);
  K.slab('stone', 0, b - 3, b + 7, 0, 28, 28);
  K.cyl('stone', 0, b + 7, 0, 47, 5.8, 5.6, { n: 16, flat: true });
  K.cyl('glass', 0, b + 54, 0, 5, 5.4, 5.4, { n: 16, flat: true, caps: 'none' });
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; K.slab('stone', 5.5 * Math.cos(a), b + 54, b + 59, 5.5 * Math.sin(a), 1.4, 1.4); }
  K.cyl('stone', 0, b + 59, 0, 5, 6.1, 5.8, { n: 16, flat: true });
}
function palaceFineArts(K) {    // the Palace of Fine Arts (1915): the rotunda's dome 49 m, the curved colonnades
  const b = K.base(0, 0, 22);
  K.cyl('ochreD', 0, b - 2, 0, 26, 17, 17, { n: 8, flat: true });
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4; K.slab('ochre', 20 * Math.cos(a), b - 1, b + 22, 20 * Math.sin(a), 3.4, 3.4); }
  K.cyl('ochre', 0, b + 22, 0, 4, 21.5, 21.5, { n: 8, flat: true, caps: 'both' });
  K.dome('dome', 0, b + 26, 0, 18, { n: 16, rows: 5, sy: 1.08 });
  K.cyl('ochre', 0, b + 45, 0, 4, 2.5, 2, { n: 8 });
  for (let i = 0; i <= 26; i++) {
    const a = (115 + i * 5) * DEG, x = 62 * Math.cos(a), z = 62 * Math.sin(a), g = K.base(x, z, 3);
    K.cyl('ochre', x, g - 1, z, 17, 1.2, 1.1, { n: 6 });
    if (i < 26) { const a2 = (115 + (i + 1) * 5) * DEG; K.beam('ochre', [x, g + 17, z], [62 * Math.cos(a2), g + 17, 62 * Math.sin(a2)], 3, 2.5); }
  }
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) * Math.PI / 4; K.light(23 * Math.cos(a), b + 2, 23 * Math.sin(a), WARM, 2.4); }
}

// ------------------------------------------------------------------ San Francisco: Alcatraz
function alcatraz(K) {          // at the lighthouse; heading 315 along the island's axis (local -z: north-west)
  const cb = K.base(-14, -88, 40);
  K.slab('conc2', -14, cb - 4, cb + 14, -88, 31, 152);                                // the Cellhouse
  K.slab('glass', -14, cb + 6, cb + 10, -88, 31.4, 140);
  K.slab('slate', -14, cb + 14, cb + 15.5, -88, 27, 146);
  const lb = K.base(0, 0, 4);
  K.slab('ochreD', 13, lb - 2, lb + 9, 6, 13, 20);                                    // the warden's house (a ruin)
  lighthouse(K, { y0: lb, h: 21, r0: 2.6, r1: 1.9, n: 8, flat: true, key: 'white', lantern: 2.6 });
  const wb = K.base(0, -204, 6);                                                       // the water tower, the north end
  for (const [x, z] of [[-5, -5], [5, -5], [5, 5], [-5, 5]]) K.beam('rust', [x * 1.25, wb - 1, -204 + z * 1.25], [x, wb + 24, -204 + z], 0.8, 0.8);
  K.cyl('rust', 0, wb + 24, -204, 9, 7, 7, { n: 12 }); K.cyl('rust', 0, wb + 33, -204, 2.5, 7.2, 1, { n: 12 });
  const pb = K.base(18, -168, 4); K.cyl('conc2', 18, pb, -168, 30, 1.9, 1.5, { n: 8 });   // the power house chimney
  K.slab('conc2', 26, K.base(26, -150, 12) - 2, K.base(26, -150, 12) + 8, -150, 16, 30);
  for (let z = -160; z <= -20; z += 28) K.light(2, cb + 9, z, WARM, 1.8);
}

// ------------------------------------------------------------------ Sydney
function fortDenison(K) {       // Fort Denison (1857) on Pinchgut: the Martello tower (its light), the barracks east of it, the seawall
  const b = K.base(0, -26, 15);
  K.slab('sand', 0, -3, b + 2.5, -26, 34, 88);
  K.cyl('sand', 0, b + 2.5, 0, 12.5, 8.5, 8, { n: 16 });
  K.cyl('sand', 0, b + 15, 0, 1.2, 8.3, 8.3, { n: 16, caps: 'none' });
  house(K, 0, b + 2.5, -36, 11, 40, 6.5, 0, 'sand', 'slate');
  K.cyl('lantern', 0, b + 16, 0, 1.6, 0.6, 0.6, { n: 6 });
  K.lamp(0, b + 16.8, 0);
  K.light(0, b + 4, -58, WARM, 2); K.light(0, b + 4, -14, WARM, 2);
}
// ------------------------------------------------------------------ Marseille
function notreDameGarde(K) {    // the basilica (1864) on its 149 m hill: striped stone, bell tower 41 m, the gilded statue
  const b = K.base(0, 25, 40), t = b + 9;
  K.slab('stone', 0, b - 12, t, 25, 46, 98);                                          // the old fort's walls, the terrace
  for (let i = 0; i < 10; i++) K.slab(i % 2 ? 'green' : 'stone', 0, t + i * 2, t + i * 2 + 2, 38, 17, 54);   // the nave, in bands
  K.roof('slate', 0, t + 20, 38, 17.6, 54, 4);
  for (const z of [22, 38, 54]) { K.cyl('stone', 0, t + 22, z, 3, 5, 5, { n: 12 }); K.dome('green', 0, t + 25, z, 5, { n: 12, rows: 3 }); }
  K.cyl('stone', 0, t, 65, 20, 8, 8, { n: 10, a0: 0, a1: Math.PI, caps: 'none' });
  for (let i = 0; i < 16; i++) K.slab(i % 2 ? 'green' : 'stone', 0, t + i * 2.06, t + (i + 1) * 2.06, 0, 12, 12);   // the bell tower, to 33 m
  K.slab('stone', 0, t + 33, t + 41, 0, 10, 10);
  K.slab('black', 0, t + 35, t + 40, 0, 10.3, 6); K.slab('black', 0, t + 35, t + 40, 0, 6, 10.3);   // the belfry's arches
  K.cyl('stone', 0, t + 41, 0, 12.5, 3.2, 2.6, { n: 12 });                          // the pedestal
  K.cyl('gold', 0, t + 53.5, 0, 9, 1.9, 0.7, { n: 10 });                            // la Bonne Mère, 11.2 m
  K.cyl('gold', 0, t + 62.3, 0, 2.3, 1.0, 0.45, { n: 8 });
  K.slab('gold', 0, t + 58.5, t + 59.5, 0, 6, 0.6);
  K.light(0, t + 65, 0, RED, 2.6, 1.6);
}
function chateauIf(K) {         // the Château d'If (1531): a square keep with three round towers, ramparts round the island
  const b = K.base(0, 0, 18);
  K.slab('stone', 0, b - 3, b + 17, 0, 28, 28);
  merlons(K, 'stone', -14, -14, 14, -14, b + 17); merlons(K, 'stone', 14, -14, 14, 14, b + 17); merlons(K, 'stone', 14, 14, -14, 14, b + 17); merlons(K, 'stone', -14, 14, -14, -14, b + 17);
  K.cyl('stone', -14, b - 3, -14, 25, 7.5, 7, { n: 14 });                           // la tour Saint-Christophe
  K.cyl('stone', 14, b - 3, -14, 22, 5.5, 5.2, { n: 12 }); K.cyl('stone', 14, b - 3, 14, 22, 5.5, 5.2, { n: 12 });
  // (heading east: the island runs 100 m west and 170 m east of the château, 140 m north to south)
  const pts = [[-60, -153], [48, -153], [48, 88], [-60, 88]];
  for (let i = 0; i < 4; i++) wall(K, 'stone', pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], 6, 3);
  K.light(0, b + 18, 15, WARM, 2.2);
}
function fortStJean(K) {        // Fort Saint-Jean at the Vieux-Port's mouth: the Tour du Roi René, the Tour du Fanal
  const b = K.base(0, 0, 25);
  K.slab('stone', 0, b - 4, b + 12, 0, 28, 170);
  K.slab('stone', 0, K.base(0, -40, 9) - 3, K.base(0, -40, 9) + 31, -40, 15, 15);   // le Roi René, square
  merlons(K, 'stone', -7.5, -47.5, 7.5, -47.5, K.base(0, -40, 9) + 31); merlons(K, 'stone', -7.5, -32.5, 7.5, -32.5, K.base(0, -40, 9) + 31);
  K.cyl('stone', 0, K.base(0, -82, 5) - 3, -82, 27, 4.5, 4, { n: 12 });              // le Fanal, round
  K.cyl('stone', 0, b + 12, 40, 6, 6, 6, { n: 10 });
  K.light(0, b + 13, -70, WARM, 2.2); K.light(0, b + 13, 60, WARM, 2.2);
}
function mucem(K) {             // the MuCEM (2013): a 72 m cube in its dark concrete lattice, the footbridge to the fort
  const b = K.base(0, 0, 30);
  K.slab('glass', 0, b - 2, b + 17, 0, 52, 52);
  K.slab('dark', 0, b + 17, b + 18.5, 0, 72, 72);
  for (let i = -3; i <= 3; i++) for (const [x, z, sx, sz] of [[i * 11, -35.5, 3, 1], [i * 11, 35.5, 3, 1], [-35.5, i * 11, 1, 3], [35.5, i * 11, 1, 3]]) K.slab('dark', x, b - 2, b + 17, z, sx, sz);
  K.beam('dark', [0, b + 18, 36], [0, b + 18, 150], 3, 1.5);
}
function fortStNicolas(K) {     // Fort Saint-Nicolas (1660), the bastioned fort on the south side of the harbour mouth
  const b = K.base(0, 0, 50);
  ringWall(K, 'stone', 0, 0, 78, 6, 13, 9, 15, (x, z, a) => K.slab('stone', x, K.base(x, z, 8) - 3, K.base(x, z, 8) + 15, z, 16, 16, a));
  K.slab('stone', 0, b - 2, b + 20, 0, 42, 28);
  K.light(0, b + 21, 0, WARM, 2.2);
}
function laMajor(K) {           // the Cathédrale de la Major (1893): 142 m long, striped, its main dome 70 m
  const b = K.base(0, 0, 40);
  for (let i = 0; i < 8; i++) K.slab(i % 2 ? 'green' : 'stone', 0, b + i * 3 - (i ? 0 : 3), b + (i + 1) * 3, 6, 24, 126);
  for (let i = 0; i < 8; i++) K.slab(i % 2 ? 'green' : 'stone', 0, b + i * 3 - (i ? 0 : 3), b + (i + 1) * 3, 24, 60, 22);
  K.cyl('stone', 0, b + 24, 24, 16, 11, 11, { n: 16 });
  K.dome('green', 0, b + 40, 24, 11, { n: 16, rows: 5, sy: 1.5 });
  K.cyl('stone', 0, b + 56, 24, 9, 2.5, 2, { n: 8 }); K.dome('green', 0, b + 65, 24, 2.2, { n: 8, rows: 3 });
  for (const z of [-20, 52]) { K.cyl('stone', 0, b + 24, z, 6, 6.5, 6.5, { n: 12 }); K.dome('green', 0, b + 30, z, 6.5, { n: 12, rows: 4, sy: 1.3 }); }
  for (const x of [-9, 9]) { for (let i = 0; i < 14; i++) K.slab(i % 2 ? 'green' : 'stone', x, b + i * 3.2 - (i ? 0 : 3), b + (i + 1) * 3.2, -58, 9, 9); K.dome('green', x, b + 44.8, -58, 4.8, { n: 10, rows: 3, sy: 1.5 }); }
}
// ------------------------------------------------------------------ Kiel
function laboe(K) {             // the Laboe Naval Memorial (1936): an 85 m (72 m above the ground) brick tower, the hall behind
  const b = K.base(0, 0, 16);
  const ring = (y, a, f, k) => ({ y, pts: Array.from({ length: 16 }, (_, i) => { const t = i * Math.PI * 2 / 16, s = Math.sin(t); return [a * Math.cos(t), s > 0 ? k * s : f * s]; }) });
  K.loft('brick', [ring(b - 3, 12, 19, 7), ring(b + 20, 9.5, 15, 5.5), ring(b + 60, 6, 9.5, 3.5), ring(b + 63, 7.4, 11, 4.4), ring(b + 72, 7, 10.4, 4.2)]);
  K.cyl('brick', 0, b - 2, 34, 7, 23, 23, { n: 20 });
  K.cyl('stone', 0, b - 2, 34, 1.5, 26, 26, { n: 20 });
  K.light(0, b + 72.6, 0, RED, 3, 1.6);
  for (const x of [-12, 12]) K.light(x, b + 1, -18, WARM, 2.5);
}
function u995(K) {              // U-995 (a Type VIIC/41, 1943) on her stands on Laboe beach: 67 m long, 6.2 m beam
  const b = K.base(0, 0, 10), y = b + 5.2;
  const prof = [[-33.5, 0.4], [-30, 1.6], [-24, 2.6], [-14, 3.1], [12, 3.1], [22, 2.5], [29, 1.4], [33.5, 0.3]];
  for (let i = 0; i + 1 < prof.length; i++) K.tube('sub', [0, y, prof[i][0]], [0, y, prof[i + 1][0]], prof[i][1], 12, prof[i + 1][1]);
  K.slab('sub', 0, y + 2.2, y + 3.6, 0, 3.4, 52);
  K.slab('sub', 0, y + 3.6, y + 7.4, -4, 2.8, 9); K.slab('sub', 0, y + 7.4, y + 8.6, -5, 2, 4);
  for (const z of [-22, -8, 8, 22]) K.slab('conc', 0, b - 2, y - 2, z, 4, 3);
}
// ------------------------------------------------------------------ Solent
function needles(K) {           // the Needles: the lighthouse (1859, 31 m, its helideck on top) and the three chalk stacks
  K.cyl('conc', 0, -7, 0, 10, 8, 7, { n: 12 });
  K.foot(0, 0, 0.2, 16, 0);
  lighthouse(K, { y0: 3, h: 18.5, r0: 4.4, r1: 3.4, n: 16, bands: [[0, 0.35, 'white'], [0.35, 0.72, 'red'], [0.72, 1, 'white']], lantern: 3 });
  for (const [x, z] of [[-4, -4], [4, -4], [4, 4], [-4, 4]]) K.beam('steel', [x * 0.8, 21.5, z * 0.8], [x * 1.3, 28.5, z * 1.3], 0.5, 0.5);
  K.cyl('steel', 0, 28.5, 0, 1, 7.5, 7.5, { n: 12, caps: 'both' });                // the helideck
  // the stacks, strung along the heading toward the headland
  for (const [d, h, len, w] of [[-48, 17, 36, 9], [-165, 27, 64, 13], [-300, 29, 78, 15]]) {
    const diamond = (y, f) => ({ y, pts: [[w / 2 * f, 0], [0, len / 2 * (0.6 + 0.4 * f)], [-w / 2 * f, 0], [0, -len / 2 * (0.6 + 0.4 * f)]].map(([x, z]) => [x, z + d]) });
    K.loft('rock', [diamond(-7, 1.15), diamond(1.5, 1.08)], false);
    K.loft('chalk', [diamond(1.5, 1.08), diamond(h * 0.55, 0.8), diamond(h * 0.88, 0.42), diamond(h, 0.12)]);
    K.foot(0, d, len, w, 0);
  }
}
function hurstCastle(K) {       // Hurst Castle (1544, the Victorian wings 1870s) at the end of the shingle spit
  const b = K.base(0, 0, 20);
  K.cyl('granite', 0, b - 3, 0, 15, 17, 17, { n: 12, flat: true });
  K.cyl('granite', 0, b + 12, 0, 6, 10, 10, { n: 12, flat: true });
  for (let i = 0; i < 3; i++) { const a = (60 + i * 120) * DEG; K.cyl('granite', 21 * Math.sin(a), b - 3, -21 * Math.cos(a), 11, 9, 9, { n: 10 }); }
  for (const [yaw, len] of [[245, 130], [25, 120]]) K.at(0, 0, 0, yaw, () => {
    const g = Math.max(0.4, Math.min(K.g(0, 0), K.gmin(0, -len / 2 - 20, 12)));
    K.slab('granite', 0, g - 4, g + 9, -len / 2 - 20, 24, len); K.slab('black', 0, g + 3, g + 6, -len / 2 - 20, 24.3, len - 8);
  });
  K.light(0, b + 18.5, 0, WARM, 2.2);
}
function hurstLight(K) {        // Hurst Point (the High Light, 1867): a white round tower 26 m
  const b = K.base(0, 0, 5);
  lighthouse(K, { y0: b, h: 21, r0: 3.2, r1: 2.4, key: 'white', lantern: 2.4 });
  house(K, 9, b, 6, 8, 12, 5, 0);
}
function rysCastle(K) {         // Cowes Castle, the Royal Yacht Squadron (1539): stone, a round tower, the line of brass guns
  const b = K.base(0, 22, 15);
  K.slab('stone', 0, b - 3, b + 11, 22, 30, 22);
  merlons(K, 'stone', -15, 11, 15, 11, b + 11); merlons(K, 'stone', 15, 11, 15, 33, b + 11);
  K.cyl('stone', -13, b - 3, 12, 18, 5.5, 5.5, { n: 14 });
  K.slab('stone', 0, -2, Math.max(0.4, K.g(0, 4)) + 2.2, 4, 46, 10);                 // the platform on the shore
  for (let i = 0; i < 22; i++) K.tube('gold', [-21 + i * 2, Math.max(0.4, K.g(0, 4)) + 2.6, 3], [-21 + i * 2, Math.max(0.4, K.g(0, 4)) + 2.8, 0.8], 0.15, 5);
  K.cyl('white', 0, Math.max(0.4, K.g(0, 0)), 0, 30, 0.35, 0.15, { n: 6 });           // the flagstaff
  K.beam('white', [-6, 24, 0], [6, 24, 0], 0.2, 0.2);
  for (const x of [-12, 0, 12]) K.light(x, b + 6, 10.5, WARM, 2);
}
function spinnaker(K) {         // the Spinnaker Tower (2005): 170 m, its white sail, the viewing decks at 100-110 m
  const b = K.base(0, 0, 14), H = 170;
  const spine = (s, t) => [s * (8 - 6 * t), b + H * t, 12 - 9 * t - 3 * Math.sin(Math.PI * t)];
  const arc = (s, t) => [s * (12 - 10.5 * t), b + H * 0.985 * t, -6 - 30 * Math.sin(Math.PI * Math.pow(t, 0.85)) + 9 * t];
  for (const s of [-1, 1]) for (let i = 0; i < 12; i++) {
    K.tube('white', spine(s, i / 12), spine(s, (i + 1) / 12), 2.2 - 1.2 * i / 12, 8, 2.2 - 1.2 * (i + 1) / 12);
    K.tube('white', arc(s, i / 12), arc(s, (i + 1) / 12), 2 - i / 12, 8, 2 - (i + 1) / 12);
    if (i % 2) K.tube('white', spine(s, i / 12), arc(s, i / 12), 0.6, 5);
  }
  K.surf('tile', (u, v) => { const t = 0.3 + 0.68 * u, A = arc(-1, t), B = arc(1, t); return [mix(A[0], B[0], v), mix(A[1], B[1], v), mix(A[2], B[2], v) - 2 * Math.sin(Math.PI * v)]; }, 12, 4);
  K.slab('podglass', 0, b + 100, b + 112, -6, 18, 22);
  K.slab('white', 0, b + 112, b + 113, -6, 19, 23);
  K.light(0, b + H + 1, 3, RED, 3, 1.6);
  for (const t of [0.35, 0.55, 0.75]) for (const s of [-1, 1]) { const p = arc(s, t); K.light(p[0], p[1], p[2] - 2, LED, 2.5); }
}
function calshot(K) {           // Calshot Castle (1540), at the tip of the spit: a round keep in a round curtain
  const b = K.base(0, 0, 14);
  K.cyl('granite', 0, b - 3, 0, 16, 11, 11, { n: 16 });
  K.cyl('granite', 0, b - 3, 0, 9, 25, 25, { n: 24, caps: 'none' });
  K.cyl('granite', 0, b - 3, 0, 9, 22, 22, { n: 24, caps: 'none' });
  K.cyl('slate', 0, b + 13, 0, 2.5, 6, 2, { n: 12 });
  K.light(0, b + 14, 11, WARM, 2);
}
// a Spithead sea fort (1860s-80s): granite below, a ring of iron casemates above, a light on top
function seaFort(K, R, H, lightY) {
  K.cyl('granite', 0, -8, 0, 14, R, R, { n: 28 });
  K.cyl('iron', 0, 6, 0, H - 9, R - 0.3, R - 0.3, { n: 28 });
  for (let i = 0; i < 24; i++) { const a = i * Math.PI * 2 / 24; K.box('black', (R - 0.1) * Math.cos(a), 6 + (H - 9) * 0.55, (R - 0.1) * Math.sin(a), 2.2, 2.4, 2.2, 90 - a / DEG); }
  K.cyl('granite', 0, H - 3, 0, 3, R - 0.8, R - 1.4, { n: 28 });
  K.cyl('white', 0, H, 0, lightY - H - 1.5, 1.2, 1, { n: 8 });
  K.cyl('lantern', 0, lightY - 1.5, 0, 2, 0.9, 0.9, { n: 8 }); K.dome('black', 0, lightY + 0.5, 0, 1, { n: 8, rows: 2 });
  K.lamp(0, lightY, 0);
  K.foot(0, 0, 0.2, 2 * R, 0);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; K.light((R + 0.5) * Math.cos(a), H - 1, (R + 0.5) * Math.sin(a), WARM, 2); }
}
function osborne(K) {           // Osborne House (1851): the Italianate pavilion and its two towers above the Solent
  const b = K.base(0, 0, 30);
  K.slab('stone', 0, b - 3, b + 17, 0, 34, 30); K.slab('stone', -34, b - 3, b + 14, 8, 40, 16); K.slab('stone', 32, b - 3, b + 14, 12, 34, 16);
  K.slab('stone', -10, b + 17, b + 33, -10, 9, 9); K.roof('slate', -10, b + 33, -10, 10, 10, 2);
  K.slab('stone', 14, b + 17, b + 28, 12, 7, 7); K.roof('slate', 14, b + 28, 12, 8, 8, 1.6);
  K.slab('glass', 0, b + 4, b + 12, 0, 34.3, 26); K.slab('glass', -34, b + 4, b + 10, 8, 40.3, 12);
}
// ------------------------------------------------------------------ Lake Garda, Riva
function apponale(K) {          // the Torre Apponale (13th century), 34 m, its belfry and the angel on top
  const b = K.base(0, 0, 5);
  K.slab('stoneG', 0, b - 2, b + 34, 0, 7.6, 7.6);
  K.slab('black', 0, b + 28, b + 31.5, 0, 7.9, 3); K.slab('black', 0, b + 28, b + 31.5, 0, 3, 7.9);
  merlons(K, 'stoneG', -3.8, -3.8, 3.8, -3.8, b + 34, 0.6, 1.2, 1.2); merlons(K, 'stoneG', -3.8, 3.8, 3.8, 3.8, b + 34, 0.6, 1.2, 1.2);
  K.cyl('roof', 0, b + 34, 0, 3.2, 3.6, 0.1, { n: 4, flat: true, yaw: 45 });
  K.cyl('gold', 0, b + 37.2, 0, 2.2, 0.35, 0.1, { n: 6 });
  K.light(0, b + 30, 4.2, WARM, 2.2);
}
function roccaRiva(K) {         // the Rocca di Riva (1124): the castle in its moat by the harbour, the keep
  const b = K.base(0, 0, 26);
  for (const [x0, z0, x1, z1] of [[-24, -24, 24, -24], [24, -24, 24, 24], [24, 24, -24, 24], [-24, 24, -24, -24]]) { wall(K, 'stoneG', x0, z0, x1, z1, 11, 4); merlons(K, 'stoneG', x0, z0, x1, z1, b + 11); }
  for (const [x, z] of [[-24, -24], [24, -24], [24, 24]]) K.slab('stoneG', x, b - 3, b + 14, z, 8, 8);
  K.slab('stoneG', -20, b - 3, b + 25, 20, 11, 11); K.roof('roof', -20, b + 25, 20, 11.6, 11.6, 3);
  K.slab('roof', 0, b + 8, b + 9, 0, 40, 40);
  K.light(0, b + 12, -25, WARM, 2.2);
}
function bastione(K) {          // the Bastione (1508), the round Venetian fort on the hillside above Riva
  const b = K.base(0, 0, 14);
  K.cyl('stoneG', 0, b - 6, 0, 24, 13, 12, { n: 16 });
  for (let i = 0; i < 16; i++) { const a = (i + 0.5) * Math.PI / 8; K.box('stoneG', 12 * Math.cos(a), b + 18.9, 12 * Math.sin(a), 1.2, 1.8, 2.2, 90 - a / DEG); }
  K.light(0, b + 14, -13, WARM, 2.2);
}
// ------------------------------------------------------------------ the rest
function fortAdams(K) {         // Fort Adams (1824-57): the great pentagonal granite fort on the point
  const b = K.base(0, 0, 70);
  K.cyl('grass', 0, b - 2, 0, 2.5, 88, 88, { n: 5, flat: true });
  ringWall(K, 'granite', 0, 0, 108, 5, 11, 15, 18, (x, z, a) => K.slab('granite', x, K.base(x, z, 10) - 3, K.base(x, z, 10) + 12, z, 24, 24, a));
  for (let i = 0; i < 5; i++) { const a = (18 + 36 + i * 72) * DEG; K.light(100 * Math.sin(a), b + 12, -100 * Math.cos(a), WARM, 2.2); }
}
function roseIsland(K) {        // Rose Island Lighthouse (1870): a white house with a mansard roof, the tower on top
  const b = K.base(0, 0, 7);
  K.slab('white', 0, b - 2, b + 6, 0, 10, 10);
  K.cyl('slate', 0, b + 6, 0, 3.2, 7.6, 5.2, { n: 4, flat: true, yaw: 45 });
  K.cyl('white', 0, b + 9.2, 0, 2.6, 1.9, 1.7, { n: 8, flat: true });
  lighthouse(K, { y0: b + 11.8, h: 0.2, r0: 1.6, r1: 1.6, n: 8, key: 'white', lantern: 1.7 });
  K.slab('glass', 0, b + 1.5, b + 4.5, 0, 10.2, 6);
}
function ferryBuilding(K) {     // the Auckland Ferry Building (1912): sandstone and brick, its clock tower
  const b = K.base(0, 0, 25);
  K.slab('brickL', 0, b - 2, b + 19, 0, 72, 30); K.roof('roof', 0, b + 19, 0, 30, 72, 4, 90);
  K.slab('glass', 0, b + 3, b + 15, 0, 72.3, 26);
  K.slab('brickL', 0, b + 19, b + 36, 13, 9, 9); K.slab('white', 0, b + 30, b + 33, 13, 9.4, 9.4);
  K.cyl('copper', 0, b + 36, 13, 6, 4.5, 0.4, { n: 8 });
}
function beanRock(K) {          // Bean Rock Lighthouse (1871): a wooden cottage on iron piles in the harbour, white, 15 m
  K.cyl('conc', 0, -5, 0, 7, 5.5, 5, { n: 12 });
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; K.tube('iron', [3.8 * Math.cos(a), 2, 3.8 * Math.sin(a)], [3.4 * Math.cos(a), 5, 3.4 * Math.sin(a)], 0.25, 5); }
  K.cyl('white', 0, 5, 0, 0.4, 5, 5, { n: 6, flat: true, caps: 'both' });
  K.cyl('white', 0, 5.4, 0, 5, 3.9, 3.6, { n: 6, flat: true });
  K.cyl('roof', 0, 10.4, 0, 2, 4.3, 1.6, { n: 6, flat: true });
  K.cyl('lantern', 0, 12.4, 0, 1.8, 1.2, 1.2, { n: 8 }); K.dome('roof', 0, 14.2, 0, 1.3, { n: 8, rows: 3 });
  K.lamp(0, 13.3, 0);
  K.foot(0, 0, 0.2, 11, 0);
}
function sanfordDam(K, L) {     // Sanford Dam (1965): an earthfill embankment; the lake to its right (+x)
  const prof = [[16, -6], [-50, 22], [-60, 22], [-118, -6]], keys = ['rock', 'asphalt', 'dry'];
  for (let i = 0; i < 3; i++) {
    const [xa, ya] = prof[i], [xb, yb] = prof[i + 1];
    K.surf(keys[i], (u, v) => [mix(xa, xb, v), mix(ya, yb, v), mix(L / 2, -L / 2, u)], 20, 1);
  }
  for (const zE of [L / 2, -L / 2]) K.surf('dry', (u, v) => { const p = mix(16, -118, u); const top = p > -50 ? mix(-6, 22, (16 - p) / 66) : p > -60 ? 22 : mix(22, -6, (-60 - p) / 58); return [p, mix(-6, top, v), zE]; }, 8, 1);
  for (let z = -L / 2 + 40; z < L / 2; z += 60) K.light(-55, 28, z, WARM, 2.2);
  K.slab('conc', -50.5, 22, 23.2, 0, 0.5, L);
  K.foot(9, 0, L, 12, 0);
}
function walvisCranes(K) {      // ship-to-shore gantry cranes on the commercial quay of Walvis Bay; booms out over the water (-z)
  for (const x of [-105, -40, 25, 90]) {
    const b = K.base(x, 24, 18);
    for (const dx of [-9, 9]) for (const z of [10, 40]) K.slab('crane', x + dx, b - 1, b + 42, z, 2, 2);
    for (const dx of [-9, 9]) K.slab('crane', x + dx, b + 40, b + 44, 25, 2.5, 34);
    for (const dx of [-4, 4]) K.beam('crane', [x + dx, b + 47, 75], [x + dx, b + 47, -62], 1.6, 2.6);
    K.slab('crane', x, b + 42, b + 48, 25, 20, 3);
    for (const dx of [-4, 4]) { K.beam('crane', [x + dx, b + 44, 28], [x + dx * 0.4, b + 72, 18], 1.4, 1.4); K.beam('crane', [x + dx, b + 44, 8], [x + dx * 0.4, b + 72, 18], 1.4, 1.4); K.beam('steel', [x + dx * 0.4, b + 72, 18], [x + dx, b + 48, -55], 0.4, 0.4); }
    K.slab('white', x, b + 48, b + 54, 55, 9, 14);
    K.light(x, b + 73, 18, RED, 2.6, 1.6);
    for (const z of [-40, 0, 40]) K.light(x, b + 45, z, WARM, 2.2);
  }
  for (let i = 0; i < 24; i++) { const x = -110 + (i % 8) * 30, z = 80 + Math.floor(i / 8) * 16, g = K.base(x, z, 6), n = 1 + (i * 7 % 3); for (let s = 0; s < n; s++) K.slab(['cont', 'cont2', 'cont3'][(i + s) % 3], x, g + s * 2.6, g + (s + 1) * 2.6, z, 12, 2.5); }
}

// ------------------------------------------------------------------ New York
// an n-pointed star (counter-clockwise as cyl's: from +x toward +z), points at radius r1, notches at r0, a point at rot
function starPts(n, r1, r0, rot = 0) { const p = []; for (let i = 0; i < 2 * n; i++) { const a = rot + i * Math.PI / n, r = i % 2 ? r0 : r1; p.push([r * Math.cos(a), r * Math.sin(a)]); } return p; }
// an elliptic ring of n points at y (rx across, rz fore and aft, centred dz; folds: the robe's ripple)
const ell = (y, rx, rz, dz = 0, n = 16, folds = 0) => ({ y, pts: Array.from({ length: n }, (_, i) => { const a = i * Math.PI * 2 / n, f = 1 + folds * Math.sin(5 * a + 0.7); return [rx * f * Math.cos(a), dz + rz * f * Math.sin(a)]; }) });
// The Statue of Liberty (Bartholdi and Eiffel, 1886) on Liberty Island, facing south-east down the harbour toward the
// Narrows (heading 130°: the axis of Fort Wood's eleven-pointed star in OpenStreetMap, a point behind her, a notch
// before her): the star fort's walls, Stone's concrete foundation (19.8 m) and Hunt's granite pedestal (27.1 m) to
// 46.9 m above the ground, the copper statue 46.05 m from her base to the torch's flame (heel to head 33.9 m, the
// right arm 12.8 m, the tablet 7.2 x 4.1 m), the gold-leaf flame lit and the statue floodlit at night (NPS, Statue
// Statistics). Local -z: her front, +x: her right (the torch arm).
function statueOfLiberty(K) {
  const b = K.base(0, 0, 45), back = Math.PI / 2;
  // Fort Wood (1811): the star's granite walls, points 48 m from the centre, the notches 31 m
  K.loft('fort', [{ y: b - 3, pts: starPts(11, 49, 32, back) }, { y: b + 7, pts: starPts(11, 48, 31, back) }]);
  K.cyl('grass', 0, b + 7, 0, 0.3, 27, 27, { n: 22 });
  // the foundation, a truncated pyramid 27.7 m square at the foot, 20.3 m at the top
  K.cyl('conc2', 0, b + 5, 0, 14.8, 19.6, 14.35, { n: 4, flat: true, yaw: 45 });
  // the pedestal: plinth, die, the loggias (dark recesses), cornice, attic, the balcony's parapet
  const sq = (k, y0, y1, w0, w1 = w0) => K.cyl(k, 0, y0, 0, y1 - y0, w0 / Math.SQRT2, w1 / Math.SQRT2, { n: 4, flat: true, yaw: 45 });
  sq('pgranite', b + 19.8, b + 23, 19.8, 19.4); sq('pgranite', b + 23, b + 33.5, 18, 16.8); sq('pgranite', b + 33.5, b + 38.5, 16.4);
  K.slab('black', 0, b + 34.2, b + 37.8, 0, 16.6, 9); K.slab('black', 0, b + 34.2, b + 37.8, 0, 9, 16.6);
  sq('pgranite', b + 38.5, b + 40, 18.2); sq('pgranite', b + 40, b + 45.4, 14.6); sq('pgranite', b + 45.4, b + 46.9, 15.4);
  const P = b + 46.9;
  // the robe, to the shoulders; neck and head (chin to cranium 5.3 m)
  K.loft('verdigris', [ell(P - 0.4, 4.9, 4.3, 0, 16, 0.06), ell(P + 2, 4.6, 4.0, 0, 16, 0.06), ell(P + 8, 4.1, 3.4, 0, 16, 0.05), ell(P + 14, 3.8, 3.05, 0, 16, 0.04),
    ell(P + 19, 3.7, 2.9, 0, 16, 0.03), ell(P + 23, 4.0, 2.9), ell(P + 26, 4.4, 2.7), ell(P + 27.6, 3.4, 2.2), ell(P + 28.6, 1.5, 1.4)]);
  K.cyl('verdigris', 0, P + 28.4, -0.1, 1.2, 1.3, 1.3, { n: 10, caps: 'none' });
  K.loft('verdigris', [0, 0.35, 0.6, 0.8, 0.93, 1].map((t) => { const a = -Math.PI / 2 + Math.PI * t; return ell(P + 31.2 + 2.66 * Math.sin(a), 2.15 * Math.cos(a) + 0.05, 2.35 * Math.cos(a) + 0.05, -0.3, 10); }));
  // the crown: its band and the seven rays, fanned across her front
  K.cyl('verdigris', 0, P + 31.9, -0.3, 1.1, 2.35, 2.25, { n: 12, caps: 'none' });
  for (let i = 0; i < 7; i++) {
    const th = (i - 3) * 27 * DEG, e = (14 + 6 * Math.abs(i - 3)) * DEG, d = [Math.sin(th) * Math.cos(e), Math.sin(e), -Math.cos(th) * Math.cos(e)], p0 = [2.1 * d[0], P + 32.6, -0.3 + 2.1 * d[2]];
    K.tube('verdigris', p0, [p0[0] + 3 * d[0], p0[1] + 3 * d[1], p0[2] + 3 * d[2]], 0.38, 4, 0.04);
  }
  // the right arm raised with the torch (the flame's tip 46.05 m above her base)
  const sh = [3.5, P + 26.8, 0.2], el = [3.9, P + 33.4, 0.1], ha = [4.25, P + 39.6, -0.4];
  K.tube('verdigris', sh, el, 1.25, 8, 1.0); K.tube('verdigris', el, ha, 1.0, 8, 0.8);
  K.tube('verdigris', [ha[0], ha[1] - 0.6, ha[2]], [ha[0], P + 41.7, ha[2]], 0.65, 8, 0.85);
  K.cyl('verdigris', ha[0], P + 41.6, ha[2], 1.4, 0.9, 1.75, { n: 12 });                 // the torch's cup and balcony
  K.cyl('gold', ha[0], P + 43, ha[2], 3.05, 1.25, 0.05, { n: 10 });                       // the gilded flame
  K.light(ha[0], P + 44.3, ha[2], [2.6, 1.8, 0.7], 6);
  // the left arm, down, the tablet (JULY IV MDCCLXXVI) held against her side
  const ls = [-3.5, P + 26.4, 0.3], le = [-4.4, P + 21.4, -0.6], lh = [-3.9, P + 18.2, -2.1];
  K.tube('verdigris', ls, le, 1.15, 8, 0.95); K.tube('verdigris', le, lh, 0.95, 8, 0.75);
  K.box('verdigris', -4.0, P + 19.2, -2.3, 4.14, 7.19, 0.61, -20);
  // floodlights in the star's notches, the balcony's lamps
  for (let i = 0; i < 11; i++) { const a = back + (2 * i + 1) * Math.PI / 11; K.light(30 * Math.cos(a), b + 7.6, 30 * Math.sin(a), WARM, 2.6); }
  for (const [x, z] of [[-7.5, -7.5], [7.5, -7.5], [7.5, 7.5], [-7.5, 7.5]]) K.light(x, P + 0.6, z, WARM, 1.8);
}
// Ellis Island's Main Building (1900): French Renaissance in red brick and limestone, 103 m long, the Registry Room's
// block between two wings, its four corner towers with copper cupolas. Local -z: the front, toward the ferry basin.
function ellisIsland(K) {
  const b = K.base(0, 0, 45);
  K.slab('brick', 0, b - 2, b + 21, 0, 50, 42);
  K.roof('slate', 0, b + 21, 0, 42, 50, 6, 90);
  for (const x of [-38.5, 38.5]) { K.slab('brick', x, b - 2, b + 16, 1, 27, 36); K.roof('slate', x, b + 16, 1, 36, 27, 4.5, 90); K.slab('stone', x, b + 15, b + 16.3, 1, 27.4, 36.4); K.slab('glass', x, b + 4, b + 12, 1, 27.3, 30); }
  K.slab('stone', 0, b + 19.8, b + 21.2, 0, 50.6, 42.6);
  K.slab('glass', 0, b + 4, b + 8, 0, 50.3, 36); K.slab('glass', 0, b + 11, b + 18.5, 0, 42, 42.3);   // the Registry Room's arched windows
  K.slab('stone', 0, b - 1, b + 9, -22.5, 16, 3);                                                 // the entrance arches
  K.slab('glass', 0, b, b + 7, -24.1, 12, 0.4);
  for (const x of [-22, 22]) for (const z of [-18, 18]) {
    K.slab('brick', x, b - 2, b + 28, z, 6.5, 6.5); K.slab('stone', x, b + 27, b + 30.5, z, 7.2, 7.2);
    K.cyl('copper', x, b + 30.5, z, 3.2, 3.2, 3.2, { n: 8 }); K.dome('copper', x, b + 33.7, z, 3.3, { n: 8, rows: 3, sy: 1.45 });
    K.cyl('copper', x, b + 38.4, z, 3.2, 0.45, 0.05, { n: 6 });
    K.light(x, b + 30, z + 3.8 * Math.sign(z), WARM, 2);
  }
  for (const x of [-45, -30, 30, 45]) K.light(x, b + 2, -17.5, WARM, 2);
}
// One World Trade Center (2014): a 61 m square rising from its 57 m podium through eight tall isosceles triangles to
// a square turned by 45° at the 417 m roof, the 124 m spire to 541.3 m, its beacon lit. Local axes along the square.
function oneWTC(K) {
  const b = K.base(0, 0, 32), s = 30.5, y0 = b + 57, y1 = b + 417;
  K.slab('steel', 0, b - 3, y0, 0, 60.6, 60.6); K.slab('wtc', 0, b + 6, y0 - 2, 0, 61, 61);
  const B = [[s, s], [-s, s], [-s, -s], [s, -s]].map(([x, z]) => [x, y0, z]), Tq = [[0, s], [-s, 0], [0, -s], [s, 0]].map(([x, z]) => [x, y1, z]);
  const tri = [];
  for (let i = 0; i < 4; i++) { tri.push([B[i], B[(i + 1) % 4], Tq[i]]); tri.push([Tq[(i + 3) % 4], B[i], Tq[i]]); }
  K.facets('wtc', tri);
  K.slab('steel', 0, y1, y1 + 3.5, 0, 43.1, 43.1, 45);
  K.cyl('steel', 0, y1 + 3.5, 0, 6, 6, 4.5, { n: 12 });
  K.cyl('crown', 0, y1 + 9.5, 0, 114.8, 2.6, 0.5, { n: 8 });
  for (const f of [0.15, 0.32, 0.5]) { const r = mix(2.6, 0.5, f) + 0.9; K.cyl('steel', 0, y1 + 9.5 + 114.8 * f, 0, 1.6, r, r, { n: 10, caps: 'both' }); }
  K.light(0, b + 541.3, 0, WHITE, 6, 0); K.light(0, y1 + 70, 0, RED, 3, 1.6);
  for (const [x, z] of [[21, 0], [-21, 0], [0, 21], [0, -21]]) K.light(x, y1 + 4, z, RED, 3, 1.6);
}
// The Brooklyn Bridge (Roebling, 1883): a 486 m main span between granite and limestone towers 84 m above high
// water, each pierced by two pointed Gothic arches over the roadway; side spans to the anchorages; four main cables
// with the diagonal stays' web; the deck 26 m wide, 41 m clear at mid-span. a: the Manhattan anchorage, b: Brooklyn's.
function brooklynBridge(K, L) {
  const f = L / 1120.1, t1 = 311 * f, t2 = 796.6 * f, sm = (t1 + t2) / 2, half = (t2 - t1) / 2, zs = (s) => L / 2 - s;
  const yE = 35, yT = 40.5, yM = 45.5;
  const deck = (s) => s < t1 ? mix(yE, yT, s / t1) : s <= t2 ? yT + (yM - yT) * (1 - ((s - sm) / half) ** 2) : mix(yT, yE, (s - t2) / (L - t2));
  deckRun(K, { L, y: deck, w: 26, depth: 5, key: 'bbtan', lamps: 26 });
  for (const s of [t1, t2]) {
    const z = zs(s), g = K.gmin(0, z, 12), wet = g < 0.3, bot = wet ? Math.max(g, -20) - 2 : g - 3;
    K.slab('granite', 0, bot, 37, z, 42.7, 18);
    if (wet) K.foot(0, z, 42.7, 18, 90);
    for (const [x, w] of [[-17.45, 6.8], [0, 7.4], [17.45, 6.8]]) K.slab('granite', x, 37, 64, z, w, 16.6);
    // the pointed arches: each opening (10.3 m) narrowed in steps to its apex
    for (const xc of [-8.85, 8.85]) for (const [y0, y1, d] of [[64, 67, 2], [67, 70, 3.5], [70, 72.5, 4.6]]) for (const sx of [-1, 1]) K.slab('granite', xc + sx * (5.15 - d / 2), y0, y1, z, d, 16.2);
    K.slab('granite', 0, 72.5, 84.3, z, 41.6, 16.2);
    K.slab('granite', 0, 80.5, 81.8, z, 42.6, 17.2);
    for (const x of [-19, 19]) K.light(x, 85, z, RED, 3, 1.6);
    // the stays, fanned from the tower top over the outer cables' planes
    for (const x of [-13, 13]) for (const dir of [-1, 1]) for (let k = 1; k <= 8; k++) { const s2 = s + dir * k * 19; K.beam('bbtan', [x, 80, z], [x, deck(s2) + 0.5, zs(s2)], 0.25, 0.25); }
  }
  for (const s of [0, L]) anchorage(K, zs(s), deck(s), 36, 40, 'granite');
  cables(K, { L, anchors: [0, L], towers: [t1, t2], yTop: 82, yLow: yM + 2, sep: 26, r: 0.5, key: 'bbtan', deck, hang: 12, neck: 14, yAnch: [yE + 3, yE + 3] });
  cables(K, { L, anchors: [0, L], towers: [t1, t2], yTop: 82, yLow: yM + 2, sep: 7.6, r: 0.5, key: 'bbtan', deck, hang: 12, yAnch: [yE + 3, yE + 3] });
}
// The Manhattan Bridge (1909): steel towers 102 m, a 448 m main span, side spans of 221 m, a double-deck truss.
// a: the Manhattan anchorage, b: Brooklyn's.
function manhattanBridge(K, L) {
  const f = L / 932.5, t1 = 243.5 * f, t2 = 687.6 * f, sm = (t1 + t2) / 2, half = (t2 - t1) / 2, zs = (s) => L / 2 - s;
  const yE = 40, yT = 45, yM = 49;
  const deck = (s) => s < t1 ? mix(yE, yT, s / t1) : s <= t2 ? yT + (yM - yT) * (1 - ((s - sm) / half) ** 2) : mix(yT, yE, (s - t2) / (L - t2));
  deckRun(K, { L, y: deck, w: 37, depth: 8, key: 'silver', lamps: 30 });
  for (const s of [t1, t2]) {
    const z = zs(s), b = towerPier(K, z, 44, 22);
    for (const x of [-14, 14]) { K.slab('silver', x, b, 102, z, 5, 8); K.light(x, 102.8, z, RED, 3, 1.6); }
    for (const [y0, y1] of [[deck(s) - 10, deck(s) - 7], [70, 73], [92, 100]]) K.slab('silver', 0, y0, y1, z, 33, 6);
    K.beam('silver', [-14, deck(s) + 2, z], [14, 90, z], 1.2, 1.2); K.beam('silver', [14, deck(s) + 2, z], [-14, 90, z], 1.2, 1.2);
  }
  for (const s of [0, L]) anchorage(K, zs(s), deck(s), 50, 56, 'granite');
  for (const sep of [28, 12]) cables(K, { L, anchors: [0, L], towers: [t1, t2], yTop: 99, yLow: yM + 2.5, sep, r: 0.55, key: 'silver', deck, neck: sep > 20 ? 14 : 0, yAnch: [yE + 3, yE + 3] });
}
// The Verrazzano-Narrows Bridge (1964): a 1298 m main span (the world's longest until 1981) between steel towers
// 211 m high, side spans of 370 m, a double-deck truss 31.4 m wide and 7.3 m deep, 69.5 m clear at mid-span, its
// necklace lights. a: the Staten Island anchorage (Fort Wadsworth), b: Brooklyn's (Fort Hamilton).
function verrazzano(K, L) {
  const f = L / 2083.4, t1 = 382.7 * f, t2 = 1678.6 * f, sm = (t1 + t2) / 2, half = (t2 - t1) / 2, zs = (s) => L / 2 - s;
  const yE = 62, yT = 70.5, yM = 76.8;
  const deck = (s) => s < t1 ? mix(yE, yT, s / t1) : s <= t2 ? yT + (yM - yT) * (1 - ((s - sm) / half) ** 2) : mix(yT, yE, (s - t2) / (L - t2));
  deckRun(K, { L, y: deck, w: 31.4, depth: 7.3, key: 'vnb', lamps: 40 });
  for (const s of [t1, t2]) {
    const z = zs(s), g = K.gmin(0, z, 25), wet = g < 0.3;
    let b; if (wet) { K.slab('conc', 0, Math.max(g, -30) - 2, 7, z, 70, 40); K.foot(0, z, 70, 40, 90); b = 7; } else { K.slab('conc', 0, g - 3, g + 3, z, 70, 40); b = g + 3; }
    for (const x of [-21, 21]) {
      for (const [y0, y1, w, d] of [[b, 70, 9.5, 11.5], [70, 140, 8.5, 10.5], [140, 209, 7.5, 9.5]]) K.slab('vnb', x, y0, y1, z, w, d);
      K.slab('vnb', x, 209, 211, z, 5, 8);                                  // the saddle housing
      K.light(x, 212, z, RED, 3.2, 1.6);
    }
    for (const [y0, y1] of [[yT - 15, yT - 8], [124, 130], [166, 171], [202, 209]]) K.slab('vnb', 0, y0, y1, z, 36, 7);
  }
  for (const s of [0, L]) anchorage(K, zs(s), deck(s), 60, 70);
  cables(K, { L, anchors: [0, L], towers: [t1, t2], yTop: 208, yLow: yM + 3, sep: 35, r: 0.9, key: 'vnb', deck, neck: 13, yAnch: [yE + 4, yE + 4] });
}
// Castle Williams (1811) on Governors Island: the round red sandstone casemated fort, 64 m across, its tiers of
// gunports toward the harbour, the straight gorge wall toward the island. Local -z: the gorge (south-east).
function castleWilliams(K) {
  const b = K.base(0, 0, 32), a0 = -Math.PI / 2 + Math.PI / 3, a1 = 3 * Math.PI / 2 - Math.PI / 3, H = 12.5;
  K.cyl('redstone', 0, b - 3, 0, H + 3, 32, 32, { n: 24, a0, a1, caps: 'none' });
  K.cyl('redstone', 0, b - 3, 0, H + 3, 22.5, 22.5, { n: 18, a0, a1, caps: 'none' });
  K.surf('redstone', (u, v) => { const a = mix(a0, a1, u), r = mix(22.5, 32, v); return [r * Math.cos(a), b + H, r * Math.sin(a)]; }, 18, 1);
  const c0 = [27 * Math.cos(a0), 27 * Math.sin(a0)], c1 = [27 * Math.cos(a1), 27 * Math.sin(a1)];
  wall(K, 'redstone', c0[0], c0[1], c1[0], c1[1], H - 2, 5);
  for (const y of [b + 2.5, b + 7]) for (let i = 0; i < 22; i++) { const a = mix(a0, a1, (i + 0.5) / 22); K.box('black', 32 * Math.cos(a), y, 32 * Math.sin(a), 1.3, 1.6, 1.3, 90 - a / DEG); }
  for (let i = 0; i < 5; i++) { const a = mix(a0, a1, (i + 0.5) / 5); K.light(34 * Math.cos(a), b + 1, 34 * Math.sin(a), WARM, 2.2); }
}

// ------------------------------------------------------------------ the registry
// name, lat, lon, heading (deg true), or a / b: a bridge's two ends; clear: no buildings or trees within (m)
export const LANDMARKS = {
  sfbay: [
    { name: 'Golden Gate Bridge', a: [37.80720, -122.47554], b: [37.83069, -122.48128], clear: 35, bridge: true, model: goldenGate },
    { name: 'San Francisco–Oakland Bay Bridge (western span)', a: [37.78821, -122.38722], b: [37.80779, -122.36657], clear: 35, bridge: true, model: bayBridge },
    { name: 'Alcatraz (cellhouse, lighthouse, water tower)', lat: 37.82626, lon: -122.42229, heading: 315, clear: 120, model: alcatraz },
    { name: 'Coit Tower', lat: 37.80239, lon: -122.40582, heading: 0, clear: 25, model: coitTower },
    { name: 'Transamerica Pyramid', lat: 37.79520, lon: -122.40280, heading: 0, clear: 40, model: transamerica },
    { name: 'Palace of Fine Arts', lat: 37.80290, lon: -122.44840, heading: 0, clear: 70, model: palaceFineArts },
  ],
  sydney: [
    { name: 'Sydney Harbour Bridge', a: [-33.85697, 151.20868], b: [-33.84703, 151.21232], clear: 45, bridge: true, model: harbourBridge },
    { name: 'Sydney Opera House', lat: -33.85690, lon: 151.21510, heading: 350, clear: 100, model: operaHouse },
    { name: 'Fort Denison', lat: -33.85476, lon: 151.22591, heading: 90, clear: 50, model: fortDenison },
    { name: 'Sydney Tower', lat: -33.87050, lon: 151.20890, heading: 0, clear: 40, model: sydneyTower },
    { name: 'Hornby Lighthouse', lat: -33.83356, lon: 151.28101, heading: 0, clear: 20,
      model: (K) => { const b = K.base(0, 0, 4); lighthouse(K, { y0: b, h: 8, r0: 2.6, r1: 2.2, n: 12, stripes: ['red', 'white'], domeKey: 'red', lantern: 2.2 }); house(K, -14, b, 8, 7, 12, 4.5, 0); house(K, -14, b, -8, 7, 12, 4.5, 0); } },
    { name: 'Macquarie Lighthouse', lat: -33.85397, lon: 151.28518, heading: 0, clear: 30,
      model: (K) => { const b = K.base(0, 0, 6); lighthouse(K, { y0: b, h: 22, r0: 4, r1: 3, n: 16, key: 'white', lantern: 3 }); house(K, -18, b, 0, 12, 28, 6, 0, 'white', 'slate'); } },
  ],
  auckland: [
    // (the Harbour Bridge stands beyond this map's edge, 6.6 km west of its centre)
    { name: 'Sky Tower', lat: -36.84850, lon: 174.76220, heading: 0, clear: 30, model: skyTower },
    { name: 'Auckland Ferry Building', lat: -36.84290, lon: 174.76720, heading: 0, clear: 45, model: ferryBuilding },
    { name: 'Bean Rock Lighthouse', lat: -36.83329, lon: 174.83106, heading: 0, model: beanRock },
  ],
  newport: [
    { name: 'Claiborne Pell Newport Bridge', a: [41.50094, -71.32093], b: [41.50699, -71.36214], clear: 30, bridge: true, model: pellBridge },
    { name: 'Fort Adams', lat: 41.47750, lon: -71.33820, heading: 0, clear: 130, model: fortAdams },
    { name: 'Castle Hill Lighthouse', lat: 41.46215, lon: -71.36290, heading: 0, clear: 12,
      model: (K) => { const b = K.base(0, 0, 4); K.slab('rock', 0, b - 3, b + 1, 0, 9, 9); lighthouse(K, { y0: b + 1, h: 9.5, r0: 2.4, r1: 1.9, key: 'granite', lantern: 2 }); } },
    { name: 'Rose Island Lighthouse', lat: 41.49548, lon: -71.34272, heading: 0, clear: 15, model: roseIsland },
    { name: 'Beavertail Lighthouse', lat: 41.44936, lon: -71.39944, heading: 0, clear: 25,
      model: (K) => { const b = K.base(0, 0, 5); lighthouse(K, { y0: b, h: 17, r0: 4.6, r1: 3.9, square: true, key: 'granite', lantern: 2.6 }); house(K, 0, b, 13, 14, 9, 6, 90, 'white', 'roof'); } },
  ],
  newyork: [
    { name: 'Statue of Liberty', lat: 40.68930, lon: -74.04454, heading: 130, clear: 60, model: statueOfLiberty },
    { name: 'Ellis Island Main Building', lat: 40.69912, lon: -74.03950, heading: 224, clear: 60, model: ellisIsland },
    { name: 'One World Trade Center', lat: 40.71300, lon: -74.01319, heading: 27.4, clear: 40, model: oneWTC },
    { name: 'Brooklyn Bridge', a: [40.70930, -74.00089], b: [40.70198, -73.99172], clear: 30, bridge: true, model: brooklynBridge },
    { name: 'Manhattan Bridge', a: [40.71083, -73.99264], b: [40.70308, -73.98828], clear: 30, bridge: true, model: manhattanBridge },
    { name: 'Verrazzano-Narrows Bridge', a: [40.60268, -74.05667], b: [40.61002, -74.03395], clear: 40, bridge: true, model: verrazzano },
    { name: 'Castle Williams', lat: 40.69283, lon: -74.01935, heading: 135, clear: 40, model: castleWilliams },
    { name: 'Robbins Reef Lighthouse', lat: 40.65737, lon: -74.06536, heading: 0,
      model: (K) => { K.cyl('black', 0, -8, 0, 13.5, 6.6, 6.4, { n: 16 }); K.foot(0, 0, 0.2, 13, 0); lighthouse(K, { y0: 5.5, h: 10, r0: 3.4, r1: 2.5, n: 12, bands: [[0, 0.5, 'brown'], [0.5, 1, 'white']], lantern: 2.2 }); } },
  ],
  marseille: [
    { name: 'Notre-Dame de la Garde', lat: 43.28400, lon: 5.37130, heading: 270, clear: 75, model: notreDameGarde },
    { name: "Château d'If", lat: 43.27972, lon: 5.32556, heading: 90, clear: 60, model: chateauIf },
    { name: 'Fort Saint-Jean', lat: 43.29550, lon: 5.36170, heading: 270, clear: 90, model: fortStJean },
    { name: 'MuCEM', lat: 43.29690, lon: 5.36060, heading: 0, clear: 55, model: mucem },
    { name: 'Fort Saint-Nicolas', lat: 43.29180, lon: 5.36260, heading: 0, clear: 95, model: fortStNicolas },
    { name: 'Cathédrale de la Major', lat: 43.29950, lon: 5.36530, heading: 315, clear: 80, model: laMajor },
  ],
  kiel: [
    { name: 'Laboe Naval Memorial', lat: 54.41030, lon: 10.22640, heading: 305, clear: 45, model: laboe },
    { name: 'U-995', lat: 54.41140, lon: 10.22810, heading: 35, clear: 40, model: u995 },
    { name: 'Friedrichsort Lighthouse', lat: 54.39053, lon: 10.19341, heading: 0,
      model: (K) => { K.cyl('conc', 0, -8, 0, 12, 8, 7.5, { n: 14 }); K.foot(0, 0, 0.2, 16, 0); lighthouse(K, { y0: 4, h: 25, r0: 3.2, r1: 2.5, n: 12, bands: [[0, 0.62, 'red'], [0.62, 0.78, 'white'], [0.78, 1, 'red']], lantern: 2.6 }); } },
    { name: 'Bülk Lighthouse', lat: 54.45522, lon: 10.19728, heading: 0, clear: 15,
      model: (K) => { const b = K.base(0, 0, 4); lighthouse(K, { y0: b, h: 23, r0: 3, r1: 2.2, bands: [[0, 0.45, 'white'], [0.45, 0.68, 'black'], [0.68, 1, 'white']], lantern: 2.4 }); } },
  ],
  solent: [
    { name: 'The Needles (lighthouse and chalk stacks)', lat: 50.66223, lon: -1.59174, heading: 83, model: needles },
    { name: 'Hurst Castle', lat: 50.70670, lon: -1.55202, heading: 0, clear: 60, model: hurstCastle },
    { name: 'Hurst Point Lighthouse', lat: 50.70795, lon: -1.55033, heading: 0, clear: 15, model: hurstLight },
    { name: 'Royal Yacht Squadron (Cowes Castle)', lat: 50.76673, lon: -1.30092, heading: 330, clear: 40, model: rysCastle },
    { name: 'Spinnaker Tower', lat: 50.79550, lon: -1.10860, heading: 200, clear: 30, model: spinnaker },
    { name: 'Calshot Castle', lat: 50.81970, lon: -1.30810, heading: 0, clear: 30, model: calshot },
    { name: "No Man's Land Fort", lat: 50.74002, lon: -1.09491, heading: 0, model: (K) => seaFort(K, 30.5, 17, 21) },
    { name: 'Horse Sand Fort', lat: 50.74994, lon: -1.07255, heading: 0, model: (K) => seaFort(K, 30.5, 17, 21) },
    { name: 'Spitbank Fort', lat: 50.77063, lon: -1.09906, heading: 0, model: (K) => seaFort(K, 23, 14, 18) },
    { name: 'Osborne House', lat: 50.75060, lon: -1.26970, heading: 0, clear: 50, model: osborne },
  ],
  garda: [
    { name: 'Torre Apponale', lat: 45.88580, lon: 10.84140, heading: 0, clear: 8, model: apponale },
    { name: 'Rocca di Riva', lat: 45.88470, lon: 10.84390, heading: 0, clear: 30, model: roccaRiva },
    { name: 'Bastione di Riva', lat: 45.88750, lon: 10.83500, heading: 0, clear: 18, model: bastione },
  ],
  progreso: [
    { name: 'Faro de Progreso', lat: 21.28568, lon: -89.66351, heading: 0, clear: 18,
      model: (K) => { const b = K.base(0, 0, 6); lighthouse(K, { y0: b, h: 33, r0: 3.4, r1: 2.4, n: 16, key: 'white', domeKey: 'red', lantern: 2.8 }); K.slab('white', 0, b - 2, b + 6, 12, 14, 12); } },
  ],
  meredith: [
    { name: 'Sanford Dam', a: [35.71736, -101.55829], b: [35.70768, -101.55013], bridge: true, model: sanfordDam },
  ],
  walvis: [
    // (Pelican Point and its lighthouse lie 8 km north-west, beyond this map's edge)
    { name: 'Walvis Bay port gantry cranes', lat: -22.94689, lon: 14.50087, heading: 270, clear: 60, model: walvisCranes },
  ],
};

// ------------------------------------------------------------------ placement
const KZ = 110540, kxAt = (lat) => Math.cos(lat * DEG) * 111320;
// a bridge's length from its two ends (the projection's metres)
const span = (a, b) => Math.hypot((b[1] - a[1]) * kxAt((a[0] + b[0]) / 2), (b[0] - a[0]) * KZ);
for (const list of Object.values(LANDMARKS)) for (const lm of list) {
  if (lm.a) {
    lm.lat = (lm.a[0] + lm.b[0]) / 2; lm.lon = (lm.a[1] + lm.b[1]) / 2;
    lm.heading = ((Math.atan2((lm.b[1] - lm.a[1]) * kxAt(lm.lat), (lm.b[0] - lm.a[0]) * KZ) / DEG) + 360) % 360;
    lm.L = span(lm.a, lm.b);
  } else lm.L = 0;
  // build(THREE, mat?, ctx?): the model in its own frame (ctx.ground(x, z) in that frame; flat water by default)
  lm.build = (THREE, mat, ctx) => { const K = new Kit(ctx); lm.model(K, lm.L); const mats = new Map(); return toObject(THREE, K, mat || ((k) => mats.get(k) || (mats.set(k, makeMaterial(THREE, k)), mats.get(k)))); };
  lm.kit = (ctx) => { const K = new Kit(ctx); lm.model(K, lm.L); return K; };
}

// where a venue's landmark stands in the venue's frame: x, z, its heading's matrix and the frame's ground function
export function placeLandmark(lm, venue, ground = null) {
  const P = makeProjection(venue.lat, venue.lon);
  let x, z, h = (lm.heading || 0) * DEG, L = lm.L;
  if (lm.a) {
    const A = P.fwd(lm.a[0], lm.a[1]), B = P.fwd(lm.b[0], lm.b[1]);
    x = (A[0] + B[0]) / 2; z = (A[1] + B[1]) / 2; h = Math.atan2(B[0] - A[0], -(B[1] - A[1])); L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  } else [x, z] = P.fwd(lm.lat, lm.lon);
  const c = Math.cos(h), s = Math.sin(h);
  // local (lx, lz) -> world: RY(-h) then the offset (local -z along the heading, +x to its right)
  const toWorld = (lx, lz) => [x + c * lx - s * lz, z + s * lx + c * lz];
  return { x, z, h, L, M: mul(T(x, 0, z), RY(-h)), toWorld, ground: ground ? (lx, lz) => { const [wx, wz] = toWorld(lx, lz); return ground(wx, wz); } : null };
}
function venueOf(id) { return VENUES.find(v => v.id === id); }
export function landmarksOf(id) { return LANDMARKS[id] || []; }

// The venue's landmarks: one group (a mesh per material, the lights as one set of points), the boats' obstacles,
// the seamark lights they carry (replace: the generic seamark tower is not drawn there) and the building mask.
// opts.ground(x, z): world ground height (scenery.js groundHeight); opts.sdf(x, z): signed distance to the shore
export function buildLandmarks(THREE, venueId, opts = {}) {
  const v = venueOf(venueId), list = v && !v.open ? landmarksOf(venueId) : [];
  const group = new THREE.Group(); group.name = 'landmarks';
  const mats = new Map(), mat = (k) => mats.get(k) || (mats.set(k, makeMaterial(THREE, k)), mats.get(k));
  const all = new Kit(), replace = [], clear = [], obstacles = [];
  for (const lm of list) {
    try {
      const pl = placeLandmark(lm, v, opts.ground || null);
      const K = new Kit({ ground: pl.ground || undefined }); lm.model(K, pl.L);
      all.absorb(K, pl.M);
      for (const [x, y, z] of K.lamps) { const [wx, wz] = pl.toWorld(x, z); replace.push({ x: wx, z: wz, y, r: 45, name: lm.name }); }
      obstacles.push(...feetToObstacles(K, pl, lm, opts.sdf));
      if (lm.clear) {
        if (lm.a) { const A = pl.toWorld(0, pl.L / 2), B = pl.toWorld(0, -pl.L / 2); clear.push([A[0], A[1], B[0], B[1], lm.clear]); }
        else clear.push([pl.x, pl.z, pl.x, pl.z, lm.clear]);
      }
    } catch (e) { if (typeof console !== 'undefined') console.error('landmark', lm.name, e); }
  }
  const obj = toObject(THREE, all, mat);
  for (const c of [...obj.children]) group.add(c);
  group.userData.landmarks = { mats: [...mats.values()], tris: all.tris, lights: all.lights.length, names: list.map(l => l.name) };
  const mask = (x, z) => {
    for (const [ax, az, bx, bz, r] of clear) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1) : 0;
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
    }
    return false;
  };
  return { group, obstacles, replace, mask };
}
function feetToObstacles(K, pl, lm, sdf) {
  const out = [];
  for (const f of K.feet) {
    const c = pl.toWorld(f.c[0], f.c[1]);
    if (sdf && sdf(c[0], c[1]) < -2) continue;                                       // on dry land: the land stops a boat already
    const A = pl.toWorld(f.a[0], f.a[1]), B = pl.toWorld(f.b[0], f.b[1]);
    out.push({ pts: [A[0], A[1], B[0], B[1]], w: f.w, kind: 'landmark', name: lm.name });
  }
  return out;
}
// the boats' obstacles alone (main.js): what of the venue's landmarks stands in the water
export function landmarkObstacles(venueId, sdf) {
  const v = venueOf(venueId); if (!v || v.open) return [];
  const out = [];
  for (const lm of landmarksOf(venueId)) { const pl = placeLandmark(lm, v, null); const K = new Kit(); lm.model(K, pl.L); out.push(...feetToObstacles(K, pl, lm, sdf)); }
  return out;
}

// every frame: night 0..1 (render.js: the town windows' factor), t (s), the drawing buffer's height (px), the camera's
// vertical field of view (deg), the pixel ratio
export function tickLandmarks(group, night, t, heightPx, fovDeg, pr) {
  LU.uOn.value = night; LU.uTime.value = t;
  LU.uScale.value = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360)); LU.uPx.value = pr;
  const d = group && group.userData.landmarks;
  if (d && d.night !== night) { d.night = night; for (const m of d.mats) m.emissiveIntensity = m.userData.night * night; }
}
export { MAP_RADIUS };
