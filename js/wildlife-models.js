// The animals' shapes (three.js geometry for js/wildlife-render.js): low-poly but sculpted, lofted bodies and
// planform fins and wings at their real proportions, with plumage and skin patterns in vertex colours
// (countershading, a gull's black wingtips and white mirrors, a common dolphin's hourglass, a humpback's white
// flippers and throat pleats, a right whale's callosities, a hawksbill's overlapping scutes, a whale shark's
// spots). Every vertex carries what the vertex shader needs to move it (wildlife-render.js WL_GLSL):
//   aPart = (part, s or eta, side, wrist): part 0 the body (and the fins that go with it), 1 a wing or a
//   turtle's fore-flipper (eta: 0 at the shoulder, 1 at the tip; side +1 starboard; wrist: eta of the joint),
//   2 a turtle's hind flipper, 3 a turtle's head and neck. For cetaceans and sharks s is the position along the
//   body, 0 at the snout and 1 at the tail's end.
//   aP2 = bird / fore-flipper: (shoulder x, shoulder y, semispan, rest dihedral); cetacean / shark: (L, beat
//   amplitude (x L), body waves per length, 0); turtle head: (neck z, neck y, L, 0); hind flipper (root x, root y, 0, 0).
// Model frame: forward -z, up +y, starboard +x. Birds and turtles have the shoulder at the origin (the wing's hinge
// axis is z = 0); cetaceans and sharks the middle of the body.
import * as THREE from 'three';
import { SPECIES } from './wildlife.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sst = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const lerp = (a, b, t) => a + (b - a) * t;
const _c = new THREE.Color();
const C = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };       // (linear, as vertexColors want)
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hsh = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
// smooth value noise in 2D (for mottling)
function vn(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return lerp(lerp(hsh(i, j), hsh(i + 1, j), su), lerp(hsh(i, j + 1), hsh(i + 1, j + 1), su), sv);
}
// spots: 1 inside a random disc of a grid of cells (size: cell, r: radius share)
function spots(x, y, cell, r, seed = 0) {
  const gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy);
  let best = 0;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const ci = i + di, cj = j + dj, px = ci + 0.2 + 0.6 * hsh(ci + seed, cj), py = cj + 0.2 + 0.6 * hsh(cj - seed, ci + 3);
    const rr = r * (0.6 + 0.6 * hsh(ci * 3 + seed, cj * 7));
    const d = Math.hypot(gx - px, gy - py);
    best = Math.max(best, 1 - sst(rr * 0.7, rr, d));
  }
  return best;
}

// piecewise-cubic interpolation of rows [x, v1, v2, ...] (Catmull-Rom tangents, clamped at the ends)
function curve(rows) {
  const n = rows.length, k = rows[0].length - 1;
  const out = new Array(k).fill(0);
  return (x) => {
    if (x <= rows[0][0]) { for (let c = 0; c < k; c++) out[c] = rows[0][c + 1]; return out; }
    if (x >= rows[n - 1][0]) { for (let c = 0; c < k; c++) out[c] = rows[n - 1][c + 1]; return out; }
    let i = 0; while (rows[i + 1][0] < x) i++;
    const a = rows[i], b = rows[i + 1], p = rows[Math.max(0, i - 1)], q = rows[Math.min(n - 1, i + 2)];
    const h = b[0] - a[0], t = (x - a[0]) / h, t2 = t * t, t3 = t2 * t;
    for (let c = 1; c <= k; c++) {
      const m0 = i > 0 ? (b[c] - p[c]) / (b[0] - p[0]) * h : b[c] - a[c], m1 = i + 2 < n ? (q[c] - a[c]) / (q[0] - a[0]) * h : b[c] - a[c];
      // (limited, so a profile does not overshoot between close points)
      const lo = Math.min(a[c], b[c]), hi = Math.max(a[c], b[c]), pad = 0.15 * (hi - lo) + 1e-9;
      out[c - 1] = clamp((2 * t3 - 3 * t2 + 1) * a[c] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b[c] + (t3 - t2) * m1, lo - pad, hi + pad);
    }
    return out;
  };
}
const f1 = (rows) => { const c = curve(rows); return (x) => c(x)[0]; };

// ------------------------------------------------------------------ the accumulator
class Geo {
  constructor() { this.p = []; this.c = []; this.a = []; this.b = []; this.i = []; }
  get n() { return this.p.length / 3; }
  v(x, y, z, col, A, B) { this.p.push(x, y, z); this.c.push(col[0], col[1], col[2]); this.a.push(A[0], A[1], A[2], A[3]); this.b.push(B[0], B[1], B[2], B[3]); return this.n - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // a lofted body: stations ss (s values), M around; prof(s) -> [w, up, dn, yc] (m); zAt(s) -> z;
  // e(s) the cross-section's superellipse exponent (2: an ellipse; less: a lens with sharper sides);
  // color(s, th, x, y) -> rgb (th: 0 on top, pi below, + to starboard); mod(s, th, P) may move the point P
  loft({ ss, M, prof, zAt, e = () => 2, color, part = () => [0, 0, 0, 0], p2 = [0, 0, 0, 0], mod = null, capA = true, capB = true }) {
    const rings = [], P = [0, 0, 0];
    for (const s of ss) {
      const [w, up, dn, yc] = prof(s), z = zAt(s), ex = 2 / e(s), ring = [];
      for (let j = 0; j < M; j++) {
        const th = j / M * TAU, sn = Math.sin(th), cs = Math.cos(th);
        P[0] = w * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
        P[1] = yc + (cs >= 0 ? up : dn) * Math.sign(cs) * Math.pow(Math.abs(cs), ex);
        P[2] = z;
        if (mod) mod(s, th, P);
        ring.push(this.v(P[0], P[1], P[2], color(s, th > Math.PI ? th - TAU : th, P[0], P[1]), part(s, th), typeof p2 === 'function' ? p2(s) : p2));
      }
      rings.push(ring);
    }
    for (let r = 0; r + 1 < rings.length; r++) for (let j = 0; j < M; j++) { const j1 = (j + 1) % M; this.quad(rings[r][j], rings[r][j1], rings[r + 1][j1], rings[r + 1][j]); }
    const cap = (k, s, rev) => {
      const [, up, dn, yc] = prof(s), ring = rings[k];
      let cx = 0, cy = 0; for (const v of ring) { cx += this.p[v * 3]; cy += this.p[v * 3 + 1]; } cx /= M; cy /= M;
      const c = this.v(cx, cy + (up - dn) * 0, zAt(s), color(s, Math.PI / 2, 0, yc), part(s, 0), typeof p2 === 'function' ? p2(s) : p2);
      for (let j = 0; j < M; j++) { const j1 = (j + 1) % M; if (rev) this.tri(c, ring[j1], ring[j]); else this.tri(c, ring[j], ring[j1]); }
    };
    if (capA) cap(0, ss[0], true);
    if (capB) cap(rings.length - 1, ss[ss.length - 1], false);
    return this;
  }
  // a planform (wing, fin, fluke, flipper, tail): the point at (eta along the span, c along the chord, side) is
  // org + span * eta + chord * (le + (te - le) c) + nrm * (droop + side * thickness / 2); le/te/droop in m
  plan({ org, span, chord, nrm = null, le, te, th = () => 0.1, droop = () => 0, ns, nc = [0, 0.12, 0.35, 0.65, 1], color, part = () => [0, 0, 0, 0], p2 = [0, 0, 0, 0], sides = [1, -1] }) {
    if (!nrm) {    // (perpendicular to the span and the chord)
      const x = span[1] * chord[2] - span[2] * chord[1], y = span[2] * chord[0] - span[0] * chord[2], z = span[0] * chord[1] - span[1] * chord[0], l = Math.hypot(x, y, z) || 1;
      nrm = [x / l, y / l, z / l];
      if (nrm[1] < -0.3 || (Math.abs(nrm[1]) <= 0.3 && nrm[0] < 0)) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const tp = (c) => 2.6 * Math.sqrt(c) * (1 - c) * (1 - 0.3 * c);
    for (const side of sides) {
      const grid = [];
      for (const e of ns) {
        const L0 = le(e), T0 = te(e), ch = Math.abs(T0 - L0), d = droop(e), row = [];
        for (const c of nc) {
          const o = L0 + (T0 - L0) * c, h = d + side * 0.5 * th(e) * ch * tp(c);
          row.push(this.v(org[0] + span[0] * e + chord[0] * o + nrm[0] * h, org[1] + span[1] * e + chord[1] * o + nrm[1] * h, org[2] + span[2] * e + chord[2] * o + nrm[2] * h,
            color(e, c, side), part(e, c), typeof p2 === 'function' ? p2(e, c) : p2));
        }
        grid.push(row);
      }
      for (let i = 0; i + 1 < grid.length; i++) for (let j = 0; j + 1 < nc.length; j++) {
        if (side > 0) this.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        else this.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
      }
    }
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.a, 4));
    g.setAttribute('aP2', new THREE.Float32BufferAttribute(this.b, 4));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
// station lists: n even steps from a to b, plus extra (sharp colour edges: a station twice, the second a hair later)
function steps(a, b, n, extra = []) {
  const s = [];
  for (let i = 0; i <= n; i++) s.push(a + (b - a) * i / n);
  for (const x of extra) { s.push(x - 1e-4, x + 1e-4); }
  return s.sort((p, q) => p - q).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 5e-5);
}
const curveSteps = (a, b, n, pow) => { const s = []; for (let i = 0; i <= n; i++) s.push(a + (b - a) * Math.pow(i / n, pow)); return s; };

// ------------------------------------------------------------------ birds
// palettes: mantle (back and upperwing), tip (the primaries' black), mirror (white spots in it), te (trailing edge),
// under (underwing), head, hood (cap or hood colour, null: none), bill, billTip, gonys (the red spot), body, tail,
// tailTip, eye
const WHITE = 0xf4f4f0, BLACK = 0x17181a;
const GULL = {
  herringGull: { mantle: 0x97a2ad, tip: BLACK, mirror: WHITE, bill: 0xe8c12e, gonys: 0xd4372a, eye: 0xe6d26a },
  gbbGull: { mantle: 0x26292e, tip: 0x111214, mirror: WHITE, bill: 0xe2bb2c, gonys: 0xd4372a },
  blackHeadedGull: { mantle: 0xa7b0b9, tip: BLACK, mirror: null, lead: WHITE, bill: 0x9a2a2c, hood: 0x4a3226, hoodAll: true },
  laughingGull: { mantle: 0x5b6168, tip: 0x141516, mirror: null, bill: 0x8c1f22, hood: 0x1d1d1f, hoodAll: true },
  silverGull: { mantle: 0xa6b1ba, tip: BLACK, mirror: WHITE, bill: 0xc8312b, eye: 0xf2f2f2 },
  redBilledGull: { mantle: 0xa4afb9, tip: BLACK, mirror: WHITE, bill: 0xc7302a },
  kelpGull: { mantle: 0x2b2e33, tip: 0x121315, mirror: WHITE, bill: 0xe2bb2c, gonys: 0xd4372a },
  yellowLeggedGull: { mantle: 0x8b96a1, tip: BLACK, mirror: WHITE, bill: 0xeac22a, gonys: 0xd4372a },
  westernGull: { mantle: 0x6e7680, tip: BLACK, mirror: WHITE, bill: 0xe6bf2c, gonys: 0xd4372a },
  ringBilledGull: { mantle: 0xa2acb6, tip: BLACK, mirror: WHITE, bill: 0xe2c63a, ring: 0x1a1a1a },
};
const TERN = {
  sandwichTern: { mantle: 0xd6dde2, tip: 0x6d737a, bill: 0x151515, billTip: 0xe7d35a, cap: BLACK, crest: true, fork: 0.22 },
  commonTern: { mantle: 0xb7c1c9, tip: 0x5a6068, bill: 0xd8352c, billTip: 0x181818, cap: BLACK, fork: 0.3 },
  crestedTern: { mantle: 0x9ea8b0, tip: 0x5a6068, bill: 0xe6d05a, cap: BLACK, capFront: true, crest: true, fork: 0.2 },
  whiteFrontedTern: { mantle: 0xc4ccd3, tip: 0x6a7078, bill: 0x151515, cap: BLACK, capFront: true, fork: 0.3 },
  royalTern: { mantle: 0xc9d1d8, tip: 0x5d636b, bill: 0xe87a2a, cap: BLACK, crest: true, fork: 0.2 },
  caspianTern: { mantle: 0xc5ccd3, tip: 0x3a3e44, underTip: 0x3a3e44, bill: 0xd23324, billTip: 0x2a2a2a, cap: BLACK, fork: 0.1 },
};

// shared bird body: rows [s, w, up, dn, yc] in fractions of L (s 0 at the bill's tip)
function birdBody(g, P) {
  const L = P.L, prof = curve(P.body), sSh = P.sSh;
  P.zk = 1 / (P.sTail + Math.max(...P.tail.len.map((r) => r[1])) - 0.03);
  const zAt = (s) => (s - sSh) * L * P.zk;
  const ss = steps(0, P.sTail, P.nBody || 22, P.edges || []);
  const fb = P.full ?? 1.12;
  g.loft({ ss, M: P.M || 12, zAt, prof: (s) => { const r = prof(s); return [r[0] * L * fb, r[1] * L * fb, r[2] * L * fb, r[3] * L]; }, color: P.bodyColor, e: P.e || (() => 2), capA: true, capB: true });
  return prof;
}
function birdWing(g, P, prof) {
  const L = P.L, wr = prof(P.sSh), x0 = wr[0] * L * 0.75, y0 = (wr[3] + wr[1] * 0.45) * L;
  const semi = P.span / 2 - x0, W = P.wing, S = P.span;
  const le = f1(W.le), te = f1(W.te);
  for (const side of [1, -1]) {
    g.plan({ org: [side * x0, y0, 0], span: [side * semi, 0, 0], chord: [0, 0, 1], nrm: [0, 1, 0],
      le: (e) => le(e) * S, te: (e) => te(e) * S, th: (e) => lerp(0.16, 0.05, e), droop: (e) => W.droop ? W.droop(e) * S : 0,
      ns: steps(0, 1, W.n || 14, W.edges || []), nc: W.nc || [0, 0.1, 0.3, 0.6, 0.85, 1],
      color: (e, c, sd) => P.wingColor(e, c, sd), part: (e) => [1, e, side, W.wrist], p2: [x0, y0, semi, W.rest || 0] });
  }
}
function birdTail(g, P, prof) {
  const L = P.L, T = P.tail, r = prof(P.sTail - 0.02), z0 = (P.sTail - 0.03 - P.sSh) * L * P.zk, y0 = r[3] * L + r[1] * L * 0.2;
  const len = f1(T.len), k = P.zk;
  for (const side of [1, -1]) g.plan({ org: [0, y0, z0], span: [side * T.hw * L, 0, 0], chord: [0, 0, 1], nrm: [0, 1, 0],
    le: (e) => -0.01 * L + e * T.hw * L * (T.fan ?? 1.1), te: (e) => len(e) * L * k, th: () => 0.06, ns: steps(0, 1, 6, T.edges || []), nc: [0, 0.3, 0.7, 1],
    color: (e, c, sd) => P.tailColor(e, c, sd), part: () => [0, 0, 0, 0] });
}
// top-ness of a body point: 1 on the back, -1 below
const topk = (th) => Math.cos(th);

function gullModel(id) {
  const S = SPECIES[id], pal = GULL[id], L = S.L;
  const white = C(WHITE), mantle = C(pal.mantle), tip = C(pal.tip), bill = C(pal.bill), gon = C(pal.gonys || pal.bill), eye = C(pal.eye || 0x202020);
  const hood = pal.hood ? C(pal.hood) : null, ring = pal.ring ? C(pal.ring) : null, mirror = pal.mirror ? C(pal.mirror) : null;
  const small = L < 0.5;
  const P = {
    L, span: S.span, sSh: 0.33, sTail: 0.66, M: 12, nBody: 24, edges: [0.09],
    //       s     w      up     dn     yc
    body: [[0.0, 0.003, 0.003, 0.003, 0.03], [0.045, 0.009, 0.012, 0.011, 0.03], [0.09, 0.017, 0.023, 0.021, 0.034], [0.105, 0.042, 0.044, 0.036, 0.038],
      [0.14, 0.058, 0.058, 0.046, 0.04], [0.18, 0.054, 0.054, 0.05, 0.038], [0.22, 0.062, 0.055, 0.066, 0.03], [0.3, 0.1, 0.076, 0.096, 0.012],
      [0.42, 0.112, 0.08, 0.096, 0.0], [0.54, 0.09, 0.064, 0.072, 0.0], [0.62, 0.055, 0.038, 0.036, 0.008], [0.66, 0.042, 0.02, 0.016, 0.012]],
    bodyColor: (s, th) => {
      const k = topk(th), side = Math.abs(Math.sin(th));
      if (s < 0.09) {   // the bill: a gonys spot (or a ring) on the lower mandible near the tip
        if (pal.gonys && k < -0.1 && s > 0.012 && s < 0.03) return gon;
        if (ring && s > 0.015 && s < 0.028) return ring;
        return s < 0.006 && small ? mix(bill, C(0x303030), 0.3) : bill;
      }
      // the eye: a small dark spot (a pale iris, if it has one, round a black pupil)
      if (s > 0.115 && s < 0.135 && k > 0.15 && k < 0.6 && side > 0.6) return pal.eye ? mix(eye, C(0x111111), s > 0.12 && s < 0.13 ? 0.7 : 0) : C(0x141414);
      if (hood && s < (pal.hoodAll ? 0.2 : 0.17)) return mix(hood, white, sst(0.17, 0.21, s));
      if (s > 0.24 && k > 0.35) return mix(white, mantle, sst(0.24, 0.3, s) * sst(0.35, 0.6, k));
      return white;
    },
    wing: { wrist: 0.42, rest: 0.05, n: 16, edges: [0.72],
      le: [[0, -0.06], [0.42, -0.072], [0.7, -0.035], [0.9, 0.02], [1, 0.062]], te: [[0, 0.1], [0.4, 0.086], [0.6, 0.076], [0.85, 0.078], [1, 0.084]],
      droop: (e) => -0.035 * sst(0.45, 1, e) },
    wingColor: (e, c, sd) => {
      // the upperwing: mantle grey, a white trailing edge, black outer primaries with white mirrors; below white,
      // the black tips showing through
      const top = sd > 0;
      if (e > 0.72) {
        if (mirror && e > 0.87 && e < 0.95 && c > 0.3 && c < 0.75) return mirror;
        if (!top && c < 0.2 && e < 0.82) return mix(white, tip, 0.4);
        if (pal.lead && e < 0.84 && c < 0.3) return C(pal.lead);
        return tip;
      }
      if (!top) return mix(white, C(0xd9dde0), sst(0.5, 0.78, e) * 0.5);
      if (pal.lead && e > 0.55 && c < 0.25) return C(pal.lead);
      if (c > 0.82 && e < 0.72) return mix(mantle, white, 0.85);
      return mantle;
    },
    tail: { hw: 0.1, len: [[0, 0.17], [1, 0.16]] },
    tailColor: () => white,
  };
  return birdAll(P);
}
function birdAll(P) {
  const g = new Geo();
  const prof = birdBody(g, P);
  birdWing(g, P, prof);
  birdTail(g, P, prof);
  return g.build();
}
function ternModel(id) {
  const S = SPECIES[id], pal = TERN[id], L = S.L;
  const white = C(WHITE), mantle = C(pal.mantle), tip = C(pal.tip), cap = C(pal.cap), bill = C(pal.bill), billTip = pal.billTip ? C(pal.billTip) : bill;
  const P = {
    L, span: S.span, sSh: 0.33, sTail: 0.6, M: 12, nBody: 22, edges: [0.13],
    body: [[0.0, 0.002, 0.002, 0.002, 0.03], [0.065, 0.008, 0.01, 0.009, 0.03], [0.13, 0.014, 0.017, 0.016, 0.032], [0.15, 0.03, 0.036, 0.03, 0.035],
      [0.19, 0.04, 0.045, 0.036, 0.036], [0.23, 0.038, 0.04, 0.042, 0.03], [0.32, 0.072, 0.055, 0.075, 0.01], [0.42, 0.075, 0.058, 0.072, 0.0],
      [0.52, 0.05, 0.04, 0.045, 0.0], [0.6, 0.025, 0.016, 0.014, 0.008]],
    bodyColor: (s, th) => {
      const k = topk(th);
      if (s < 0.13) return s < 0.025 ? billTip : bill;
      // the black cap from the bill to the nape (a white forehead in the crested and white-fronted terns)
      if (s < 0.25 && k > -0.05 + (s > 0.2 ? 0.4 : 0) && !(pal.capFront && s < 0.165 && k > 0.2)) return pal.crest && s > 0.19 ? cap : cap;
      if (s > 0.27 && k > 0.4) return mix(white, mantle, sst(0.27, 0.32, s));
      return white;
    },
    wing: { wrist: 0.4, rest: 0.08, n: 16, edges: [0.72],
      le: [[0, -0.045], [0.4, -0.055], [0.75, -0.005], [1, 0.1]], te: [[0, 0.08], [0.4, 0.064], [0.8, 0.072], [1, 0.1]], droop: (e) => -0.02 * sst(0.4, 1, e) },
    wingColor: (e, c, sd) => {
      if (sd < 0) return e > 0.72 && c > 0.6 && pal.underTip ? C(pal.underTip) : mix(white, C(0xe2e6ea), 0.4);
      if (e > 0.72 && c < 0.35) return tip;              // (the outer primaries darker)
      if (c > 0.85 && e < 0.7) return mix(mantle, white, 0.6);
      return mantle;
    },
    tail: { hw: 0.065, len: [[0, 0.1], [0.5, 0.13], [0.85, 0.1 + pal.fork * 0.8], [1, 0.1 + pal.fork]], edges: [] },
    tailColor: (e) => mix(white, mantle, 0.25 * e),
  };
  return birdAll(P);
}
function gannetModel(id) {
  const S = SPECIES[id], L = S.L, aus = id === 'australasianGannet';
  const white = C(0xf6f5ef), black = C(0x1a1a1c), head = C(aus ? 0xe8cf7a : 0xe6d08e), bill = C(0x9fb0bd), face = C(0x1c1c1e);
  const P = {
    L, span: S.span, sSh: 0.36, sTail: 0.72, M: 12, nBody: 24, edges: [0.11],
    // a cigar: the dagger bill, the head, a long neck, the body tapering into a pointed tail
    body: [[0, 0.002, 0.002, 0.002, 0.02], [0.06, 0.008, 0.01, 0.009, 0.02], [0.11, 0.015, 0.017, 0.017, 0.022], [0.14, 0.03, 0.035, 0.03, 0.025],
      [0.19, 0.036, 0.038, 0.034, 0.025], [0.25, 0.037, 0.036, 0.042, 0.018], [0.34, 0.06, 0.05, 0.065, 0.008], [0.45, 0.068, 0.055, 0.068, 0.0],
      [0.58, 0.05, 0.042, 0.048, 0.0], [0.68, 0.025, 0.02, 0.02, 0.003], [0.72, 0.016, 0.012, 0.01, 0.004]],
    bodyColor: (s, th) => {
      const k = topk(th);
      if (s < 0.11) return k < -0.3 && s > 0.08 ? face : bill;
      if (s < 0.135 && k < 0.2) return face;                     // (the bare black skin at the bill's base and throat)
      if (s < 0.25) return mix(head, white, sst(0.2, 0.26, s));
      return white;
    },
    wing: { wrist: 0.45, rest: 0.03, n: 16, edges: [0.6],
      le: [[0, -0.04], [0.45, -0.052], [0.75, -0.005], [1, 0.1]], te: [[0, 0.075], [0.45, 0.066], [0.8, 0.07], [1, 0.1]], droop: (e) => -0.015 * sst(0.5, 1, e) },
    wingColor: (e, c, sd) => {
      if (e > 0.6) return black;                                 // the primaries
      if (aus && c > 0.55) return black;                         // (Australasian: the secondaries black too)
      return white;
    },
    tail: { hw: 0.05, len: [[0, 0.24], [0.5, 0.18], [1, 0.1]] },
    tailColor: (e) => (aus && e < 0.35 ? black : white),
  };
  return birdAll(P);
}
function albatrossModel(id) {
  const S = SPECIES[id], L = S.L, bb = id === 'blackBrowedAlbatross';
  const white = C(0xf5f5f1), dark = C(bb ? 0x2c2a29 : 0x2a2a2a), bill = C(bb ? 0xe9a33a : 0xeec3b0), billTip = C(bb ? 0xd76d3a : 0xe2b2a0), brow = C(0x2a2a2a);
  const P = {
    L, span: S.span, sSh: 0.36, sTail: 0.75, M: 12, nBody: 24, edges: [0.12],
    body: [[0, 0.004, 0.006, 0.004, 0.03], [0.05, 0.012, 0.018, 0.012, 0.03], [0.12, 0.022, 0.028, 0.022, 0.03], [0.15, 0.045, 0.05, 0.042, 0.035],
      [0.2, 0.055, 0.058, 0.05, 0.035], [0.26, 0.06, 0.055, 0.07, 0.02], [0.36, 0.085, 0.07, 0.09, 0.008], [0.48, 0.088, 0.07, 0.085, 0.0],
      [0.62, 0.06, 0.05, 0.052, 0.0], [0.72, 0.03, 0.02, 0.02, 0.006], [0.75, 0.022, 0.012, 0.01, 0.008]],
    bodyColor: (s, th) => {
      const k = topk(th), sd = Math.abs(Math.sin(th));
      if (s < 0.12) return s < 0.018 ? billTip : bill;
      if (bb && s > 0.125 && s < 0.16 && k > 0.25 && k < 0.7 && sd > 0.55) return brow;      // the black eyebrow
      if (bb && s > 0.28 && k > 0.45) return dark;                                         // a dark mantle
      return white;
    },
    wing: { wrist: 0.55, rest: 0.0, n: 18, edges: bb ? [] : [0.62],
      le: [[0, -0.028], [0.55, -0.032], [0.85, -0.004], [1, 0.045]], te: [[0, 0.046], [0.55, 0.04], [0.85, 0.042], [1, 0.045]], droop: (e) => -0.02 * sst(0.55, 1, e) },
    wingColor: (e, c, sd) => {
      if (bb) {
        if (sd > 0) return dark;                                  // all dark above
        // below: white with a broad black leading edge, a black trailing edge and tip
        if (e > 0.82 || c < lerp(0.38, 0.2, e) || c > 0.9) return dark;
        return white;
      }
      // a wandering albatross: white, black primaries and a black trailing edge (an old male's wing)
      if (e > 0.62) return dark;
      if (sd > 0 && c > 0.85) return dark;
      if (sd > 0 && e > 0.35) return mix(white, dark, 0.15);
      return white;
    },
    tail: { hw: 0.06, len: [[0, 0.13], [1, 0.09]] },
    tailColor: () => (bb ? C(0x5a5a5a) : white),
  };
  return birdAll(P);
}
function petrelModel(id) {
  const S = SPECIES[id], L = S.L;
  const pals = {
    giantPetrel: { up: 0x5d5a55, down: 0x6e6b66, bill: 0xd7c79a, tipB: 0x9bb58a, head: 0x8a8580 },
    capePetrel: { up: 0x1d1e20, down: 0xf2f2ee, bill: 0x1a1a1a, chequer: true, head: 0x1d1e20 },
    whiteChinnedPetrel: { up: 0x241f1c, down: 0x2b2522, bill: 0xd8d2a6, head: 0x241f1c, chin: 0xe8e4dc },
    shortTailedShearwater: { up: 0x3a3532, down: 0x4a4542, under: 0x9a9894, bill: 0x2a2a2a, head: 0x3a3532 },
    flutteringShearwater: { up: 0x4a4744, down: 0xf2f1ed, bill: 0x3a3a3a, head: 0x4a4744 },
    scopolisShearwater: { up: 0x7d7468, down: 0xf3f1ec, bill: 0xe2cc6a, head: 0x8d8478 },
  };
  const pal = pals[id], up = C(pal.up), down = C(pal.down), bill = C(pal.bill), head = C(pal.head), white = C(0xf4f4f0), under = pal.under ? C(pal.under) : down;
  const giant = id === 'giantPetrel', sw = S.morph === 'shearwater';
  const P = {
    L, span: S.span, sSh: 0.36, sTail: 0.74, M: 12, nBody: 22, edges: [giant ? 0.12 : 0.1],
    body: [[0, 0.004, 0.006, 0.004, 0.025], [0.05, 0.01, 0.014, 0.01, 0.025], [giant ? 0.12 : 0.1, giant ? 0.026 : 0.018, giant ? 0.03 : 0.02, giant ? 0.026 : 0.018, 0.028],
      [0.14, 0.045, 0.048, 0.04, 0.032], [0.2, 0.055, 0.056, 0.052, 0.03], [0.27, 0.06, 0.055, 0.07, 0.018], [0.38, 0.085, 0.068, 0.088, 0.006],
      [0.5, 0.085, 0.066, 0.08, 0.0], [0.64, 0.055, 0.045, 0.048, 0.0], [0.74, 0.024, 0.014, 0.012, 0.006]],
    bodyColor: (s, th) => {
      const k = topk(th);
      if (s < (giant ? 0.12 : 0.1)) return giant && s < 0.02 ? C(pal.tipB) : bill;
      if (pal.chin && s < 0.16 && k < -0.5) return C(pal.chin);
      if (s < 0.24) return k > (sw ? -0.1 : -0.6) ? head : down;
      return k > (sw || pal.chequer ? 0.05 : -0.2) ? up : down;
    },
    wing: { wrist: 0.45, rest: 0.0, n: 16, edges: pal.chequer ? [0.62, 0.8] : [],
      le: [[0, -0.04], [0.45, -0.046], [0.78, -0.004], [1, 0.08]], te: [[0, 0.075], [0.45, 0.06], [0.8, 0.062], [1, 0.08]], droop: (e) => -0.03 * sst(0.45, 1, e) },
    wingColor: (e, c, sd) => {
      if (pal.chequer) {    // a cape petrel: black and white chequered above, white below with a black margin
        if (sd < 0) return e > 0.85 || c < 0.12 || c > 0.9 ? up : white;
        if (e > 0.62 && e < 0.8 && c > 0.15 && c < 0.75) return white;
        if (e < 0.6 && c > 0.4) return mix(up, white, spots(e * 14, c * 6, 1, 0.45) * 0.9);
        return up;
      }
      if (sd > 0) return up;
      if (sw && (c < 0.12 || e > 0.85 || c > 0.92)) return up;
      return sw ? under : down;
    },
    tail: { hw: 0.05, len: sw ? [[0, 0.1], [1, 0.08]] : [[0, 0.14], [1, 0.1]] },
    tailColor: () => up,
  };
  return birdAll(P);
}
function frigateModel() {
  const S = SPECIES.frigatebird, L = S.L;
  const black = C(0x111214), gloss = C(0x1d2124), red = C(0xb02020), bill = C(0x8c8f93);
  const P = {
    L, span: S.span, sSh: 0.3, sTail: 0.55, M: 12, nBody: 22, edges: [0.12],
    // a long hooked bill, a small body, very long narrow wings, the deep forked tail
    body: [[0, 0.004, 0.006, 0.006, 0.022], [0.06, 0.007, 0.009, 0.007, 0.024], [0.12, 0.012, 0.014, 0.012, 0.026], [0.14, 0.026, 0.03, 0.026, 0.028],
      [0.18, 0.03, 0.032, 0.03, 0.026], [0.23, 0.04, 0.035, 0.05, 0.016], [0.32, 0.055, 0.045, 0.06, 0.004], [0.42, 0.05, 0.04, 0.05, 0.0],
      [0.5, 0.03, 0.022, 0.025, 0.002], [0.55, 0.018, 0.01, 0.01, 0.004]],
    bodyColor: (s, th) => {
      const k = topk(th);
      if (s < 0.12) return s < 0.012 ? C(0x5a5d61) : bill;
      if (s > 0.15 && s < 0.25 && k < -0.4) return red;          // (a male's gular pouch, deflated)
      return k > 0.3 ? gloss : black;
    },
    wing: { wrist: 0.38, rest: 0.25, n: 16,
      le: [[0, -0.035], [0.38, -0.055], [0.65, -0.01], [0.85, 0.06], [1, 0.12]], te: [[0, 0.065], [0.38, 0.05], [0.7, 0.07], [1, 0.12]], droop: (e) => -0.07 * sst(0.38, 1, e) },
    wingColor: (e, c, sd) => (sd > 0 && e < 0.4 && c < 0.4 ? C(0x2c2a28) : black),
    tail: { hw: 0.045, len: [[0, 0.18], [0.5, 0.22], [0.8, 0.38], [1, 0.48]] },
    tailColor: () => black,
  };
  return birdAll(P);
}
function pelicanModel() {
  const S = SPECIES.brownPelican, L = S.L;
  const body = C(0x5c5852), wingUp = C(0x8e8a84), dark = C(0x2a2724), head = C(0xf1e8c8), neck = C(0x4a3326), bill = C(0x9a948a), pouch = C(0x3b3734), crown = C(0xe6cf72);
  const P = {
    L, span: S.span, sSh: 0.42, sTail: 0.76, M: 12, nBody: 26, edges: [0.26],
    // the long bill and pouch, the head drawn back on the shoulders in flight, a heavy body
    body: [[0, 0.006, 0.004, 0.006, 0.02], [0.08, 0.012, 0.006, 0.02, 0.02], [0.18, 0.016, 0.008, 0.03, 0.02], [0.26, 0.022, 0.012, 0.03, 0.022],
      [0.28, 0.04, 0.045, 0.035, 0.026], [0.32, 0.045, 0.048, 0.04, 0.024], [0.36, 0.05, 0.045, 0.06, 0.012], [0.45, 0.08, 0.065, 0.085, 0.004],
      [0.56, 0.08, 0.065, 0.08, 0.0], [0.68, 0.05, 0.04, 0.045, 0.0], [0.76, 0.025, 0.015, 0.012, 0.004]],
    bodyColor: (s, th) => {
      const k = topk(th);
      if (s < 0.26) return k < -0.2 && s > 0.03 ? pouch : bill;
      if (s < 0.33) return k > 0.5 && s < 0.3 ? crown : head;
      if (s < 0.4 && k > -0.2 && Math.abs(Math.sin(th)) < 0.9) return neck;     // (the chestnut hindneck, breeding)
      return k > 0.3 ? mix(body, wingUp, 0.5) : body;
    },
    wing: { wrist: 0.45, rest: 0.0, n: 16, edges: [0.62],
      le: [[0, -0.065], [0.45, -0.075], [0.8, -0.05], [1, -0.005]], te: [[0, 0.12], [0.45, 0.11], [0.85, 0.09], [1, 0.04]], droop: (e) => -0.03 * sst(0.45, 1, e) },
    wingColor: (e, c, sd) => {
      if (e > 0.62) return dark;                               // the primaries
      if (sd > 0) return c > 0.55 ? dark : wingUp;            // secondaries dark, coverts silvery
      return mix(body, dark, 0.4);
    },
    tail: { hw: 0.06, len: [[0, 0.11], [1, 0.1]] },
    tailColor: () => mix(body, dark, 0.3),
  };
  return birdAll(P);
}

// ------------------------------------------------------------------ cetaceans
// rows [s, w, up, dn, yc] in fractions of L; fins: dorsal { s, len (root chord), h, sweep, falcate }, pecs { s, len,
// chord, out, down, back }, flukes { span (half), chord, sweep, notch, serrate }
function cetacean(P) {
  const g = new Geo(), L = P.L, prof = curve(P.body), zAt = (s) => (s - 0.5) * L;
  const p2 = [L, P.amp || 0.09, P.waves || 0.65, 0];
  const pr = (s) => { const r = prof(s); return [r[0] * L, r[1] * L, r[2] * L, r[3] * L]; };
  g.loft({ ss: steps(0, 1, P.n || 34, P.edges || []), M: P.M || 18, zAt, prof: pr, color: P.color, e: P.e || (() => 2), mod: P.mod || null, p2 });
  // the dorsal fin
  const D = P.dorsal;
  if (D) {
    const r = pr(D.s), y0 = r[3] + r[1] * 0.92, c0 = D.len * L, h = D.h * L, tz = D.sweep * h;
    g.plan({ org: [0, y0, zAt(D.s)], span: [0, h, 0], chord: [0, 0, 1], nrm: [1, 0, 0],
      le: (e) => tz * Math.pow(e, D.falcate ? 1.5 : 1.15), te: (e) => (D.falcate ? c0 - (c0 - tz) * Math.pow(e, 0.55) : c0 + (tz - c0) * e), th: (e) => lerp(0.22, 0.08, e),
      ns: steps(0, 1, 7), nc: [0, 0.15, 0.4, 0.7, 1], color: (e, c, sd) => P.finColor('dorsal', e, c, sd), p2 });
  }
  const F = P.pecs;
  if (F) for (const side of [1, -1]) {
    const r = pr(F.s), x0 = side * r[0] * 0.8, y0 = r[3] - r[2] * 0.45, len = F.len * L, ch = F.chord * L;
    const sp = [side * len * F.out, -len * F.down, len * F.back];
    g.plan({ org: [x0, y0, zAt(F.s) - ch * 0.3], span: sp, chord: [0, 0, 1],
      le: (e) => (F.knobs ? -0.012 * L * Math.abs(Math.sin(e * Math.PI * 6)) * (1 - e) : 0) + ch * 0.25 * e * e, te: (e) => ch * (1 - 0.75 * Math.pow(e, F.round ? 2.5 : 1.4)) + ch * 0.25 * e * e,
      th: () => 0.18, ns: steps(0, 1, 9), nc: [0, 0.2, 0.5, 0.8, 1], color: (e, c, sd) => P.finColor('pec', e, c, sd), p2 });
  }
  const K = P.flukes;
  if (K) for (const side of [1, -1]) {
    const r = pr(0.95), half = K.span * L, ch = K.chord * L, z0 = zAt(K.s ?? 0.93);
    g.plan({ org: [0, r[3], z0], span: [side * half, 0, 0], chord: [0, 0, 1], nrm: [0, 1, 0],
      le: (e) => K.sweep * L * Math.pow(e, 1.6),
      te: (e) => {
        const base = lerp(ch * K.notch, ch * 1.05, sst(0, 0.25, e)) + (K.sweep * L - ch) * Math.pow(e, 1.3) * 0.0;
        const t = lerp(base, K.sweep * L, Math.pow(e, K.pointed ? 2.2 : 3));
        return t + (K.serrate ? K.serrate * L * (0.5 + 0.5 * Math.sin(e * 40)) * sst(0.1, 0.4, e) * (1 - sst(0.85, 1, e)) : 0);
      },
      th: (e) => lerp(0.2, 0.06, e), ns: steps(0, 1, 10), nc: [0, 0.12, 0.35, 0.65, 1], color: (e, c, sd) => P.finColor('fluke', e, c, sd), p2 });
  }
  if (P.extra) P.extra(g, pr, zAt, p2);
  const geo = g.build();
  // s along the body for every vertex (the body's wave goes by it)
  const pos = geo.attributes.position.array, A = geo.attributes.aPart.array;
  for (let i = 0; i < pos.length / 3; i++) A[i * 4 + 1] = (pos[i * 3 + 2] + L / 2) / L;
  return geo;
}
// countershading by the angle round the body: back colour above a line at angle th0 (from the top), belly below
const shade = (th, back, belly, th0 = 1.7, soft = 0.25) => mix(back, belly, sst(th0 - soft, th0 + soft, Math.abs(th)));

function delphinid(id) {
  const S = SPECIES[id], L = S.L;
  const body = [[0, 0.006, 0.006, 0.006, -0.01], [0.025, 0.014, 0.012, 0.013, -0.012], [0.05, 0.02, 0.018, 0.02, -0.012], [0.07, 0.034, 0.045, 0.034, -0.004],
    [0.11, 0.052, 0.068, 0.054, 0.0], [0.18, 0.07, 0.085, 0.074, 0.0], [0.3, 0.084, 0.095, 0.09, 0.0], [0.42, 0.083, 0.094, 0.09, 0.0],
    [0.55, 0.072, 0.085, 0.08, 0.0], [0.67, 0.05, 0.07, 0.06, 0.004], [0.78, 0.028, 0.055, 0.04, 0.006], [0.88, 0.016, 0.035, 0.022, 0.006],
    [0.95, 0.011, 0.016, 0.01, 0.003], [1, 0.006, 0.006, 0.005, 0.0]];
  let color, finColor, dorsal = { s: 0.43, len: 0.15, h: 0.095, sweep: 1.1, falcate: true }, beak = 1;
  const white = C(0xe9e7e2);
  if (id === 'bottlenose') {
    // a short stubby beak and a rounded melon behind a distinct crease
    body.splice(0, 5, [0, 0.008, 0.008, 0.008, -0.012], [0.022, 0.02, 0.018, 0.02, -0.014], [0.042, 0.026, 0.024, 0.026, -0.012], [0.055, 0.04, 0.052, 0.04, -0.002],
      [0.09, 0.056, 0.072, 0.058, 0.0], [0.13, 0.064, 0.078, 0.066, 0.0]);
    const back = C(0x4b5258), flank = C(0x7f878d), belly = C(0xd9d6d0);
    color = (s, th) => {
      let c = shade(th, back, flank, 1.1, 0.4);
      c = mix(c, belly, sst(2.1, 2.5, Math.abs(th)));
      if (s > 0.1 && s < 0.13 && Math.abs(th) > 1.3 && Math.abs(th) < 1.6) c = mix(c, C(0x24282b), 0.8);   // the eye
      if (s < 0.06 && Math.abs(th) > 2.2) c = mix(c, belly, 0.6);
      return c;
    };
    finColor = () => back;
  } else if (id === 'commonDolphin') {
    // dark cape with a V under the fin, the hourglass: a tan-yellow patch forward, pale grey aft; white belly
    beak = 1.15;
    const back = C(0x25292e), tan = C(0xa58c5c), grey = C(0x8c9296), belly = C(0xeceae4), stripe = C(0x30343a);
    color = (s, th) => {
      const a = Math.abs(th);
      const capeLine = 1.0 + 0.55 * Math.abs(s - 0.45) / 0.3;            // the cape dips to a V below the fin
      if (a < capeLine) return back;
      if (a > 2.3) return (s < 0.3 && a < 2.5 && s > 0.1) ? stripe : belly;     // (the flipper-to-chin stripe)
      if (s < 0.06) return mix(back, grey, 0.4);
      if (s > 0.1 && s < 0.13 && a < 1.6) return back;                      // (the eye patch)
      // (the patches: the yellowish one forward reaches from the eye to below the fin, the grey one behind it)
      const fw = s < 0.4 ? tan : s < 0.5 ? mix(tan, grey, (s - 0.4) / 0.1) : grey;
      return mix(fw, belly, sst(2.05, 2.3, a) * 0.6);
    };
    finColor = (k, e, c) => (k === 'dorsal' && e > 0.2 && e < 0.7 && c > 0.2 && c < 0.6 ? C(0x5a5e63) : back);
    dorsal = { s: 0.43, len: 0.14, h: 0.1, sweep: 1.0, falcate: true };
  } else if (id === 'hourglassDolphin') {
    // black, with two white flank patches joined by a thin line (the hourglass), white belly; a short beak
    beak = 0.6;
    const black = C(0x15171a), w2 = C(0xf2f1ee);
    color = (s, th) => {
      const a = Math.abs(th);
      if (a > 2.4) return w2;
      const fore = s > 0.08 && s < 0.38 && a > 1.25 + 0.4 * Math.abs(s - 0.25) / 0.13;
      const aft = s > 0.5 && s < 0.82 && a > 1.0 + 0.6 * Math.abs(s - 0.62) / 0.2;
      const line = s >= 0.38 && s <= 0.5 && a > 1.9 && a < 2.1;
      return fore || aft || line ? w2 : black;
    };
    finColor = () => black;
    dorsal = { s: 0.43, len: 0.15, h: 0.11, sweep: 0.9, falcate: true };
  } else {  // striped
    beak = 1.1;
    const back = C(0x3b4552), flank = C(0x9aa4ae), belly = C(0xeceae5), stripe = C(0x2a323b);
    color = (s, th) => {
      const a = Math.abs(th);
      if (a > 2.35) return belly;
      if (a > 2.05 && a < 2.25 && s > 0.1 && s < 0.85) return stripe;      // the eye-to-anus stripe
      if (a < 1.2 - 0.3 * sst(0.3, 0.5, s)) return back;
      if (s > 0.28 && s < 0.5 && Math.abs(a - (1.3 + (0.5 - s) * 1.5)) < 0.09) return back;      // (the spinal blaze)
      return flank;
    };
    finColor = () => back;
  }
  if (beak !== 1) for (const r of body) if (r[0] <= 0.07) { r[0] = r[0] < 0.07 ? r[0] * beak : r[0]; }
  return cetacean({ L, body, color, finColor, dorsal, M: 18, n: 36, edges: [0.06],
    pecs: { s: 0.22, len: 0.16, chord: 0.07, out: 0.75, down: 0.45, back: 0.55 },
    flukes: { span: 0.12, chord: 0.07, sweep: 0.075, notch: 0.55 }, amp: 0.1 });
}
function porpoise() {
  const S = SPECIES.harbourPorpoise, L = S.L;
  const back = C(0x34393e), flank = C(0x7e858a), belly = C(0xe3e1dc);
  const body = [[0, 0.016, 0.016, 0.014, -0.01], [0.012, 0.038, 0.04, 0.034, -0.008], [0.04, 0.062, 0.068, 0.058, -0.003], [0.09, 0.078, 0.088, 0.075, 0.0], [0.18, 0.09, 0.1, 0.092, 0.0],
    [0.32, 0.1, 0.108, 0.104, 0.0], [0.45, 0.097, 0.105, 0.1, 0.0], [0.58, 0.08, 0.092, 0.085, 0.0], [0.7, 0.05, 0.075, 0.06, 0.004],
    [0.82, 0.025, 0.05, 0.035, 0.005], [0.92, 0.013, 0.022, 0.014, 0.002], [1, 0.006, 0.006, 0.005, 0]];
  return cetacean({ L, body, M: 18, n: 30,
    color: (s, th) => { let c = shade(th, back, flank, 1.2, 0.4); c = mix(c, belly, sst(2.0, 2.4, Math.abs(th))); if (s < 0.05) c = mix(c, back, 0.5); return c; },
    finColor: () => back,
    dorsal: { s: 0.46, len: 0.14, h: 0.075, sweep: 0.45, falcate: false },     // (low and triangular)
    pecs: { s: 0.2, len: 0.13, chord: 0.06, out: 0.7, down: 0.5, back: 0.55 },
    flukes: { span: 0.13, chord: 0.07, sweep: 0.07, notch: 0.55 }, amp: 0.1 });
}
function rorqual(id) {
  const S = SPECIES[id], L = S.L;
  if (id === 'humpback') {
    // Southern Hemisphere humpback: black above, a lot of white below; long white flippers with knobbed leading
    // edges, the small dorsal fin on a hump, tubercles on the head, throat pleats, flukes serrated behind
    const black = C(0x1c1f22), grey = C(0x3d4247), white = C(0xe2e0da), pleat = C(0xb7b4ae), knob = C(0x2d3135);
    const body = [[0, 0.012, 0.008, 0.012, -0.012], [0.03, 0.05, 0.03, 0.045, -0.012], [0.1, 0.075, 0.05, 0.072, -0.012], [0.2, 0.094, 0.075, 0.098, -0.006],
      [0.3, 0.104, 0.09, 0.112, 0.0], [0.42, 0.104, 0.094, 0.104, 0.0], [0.55, 0.09, 0.09, 0.09, 0.0], [0.65, 0.07, 0.085, 0.07, 0.0],
      [0.78, 0.04, 0.06, 0.045, 0.0], [0.88, 0.022, 0.04, 0.028, 0.0], [0.95, 0.012, 0.02, 0.012, 0], [1, 0.004, 0.005, 0.004, 0]];
    return cetacean({ L, body, M: 26, n: 46, amp: 0.06, waves: 0.55,
      color: (s, th, x, y) => {
        const a = Math.abs(th);
        let c = mix(black, white, sst(1.9, 2.3, a) * (s < 0.62 ? 1 : 0.4));
        if (a > 2.2 && s > 0.02 && s < 0.48 && Math.cos(th * 46) > 0.2) c = mix(c, pleat, 0.7);      // throat pleats
        if (s < 0.22 && a < 1.2 && spots(s * 60, th * 6, 1, 0.3, 4) > 0.5) c = knob;                // tubercles
        if (a > 1.6 && a < 2.2) c = mix(c, grey, 0.5 * vn(s * 30, th * 5));
        return c;
      },
      finColor: (k, e, c, sd) => (k === 'pec' ? (sd > 0 && e < 0.5 && c > 0.4 ? mix(black, white, 0.5) : white) : k === 'fluke' ? (sd < 0 ? (vn(e * 8, c * 4) > 0.62 ? black : white) : black) : black),
      dorsal: { s: 0.64, len: 0.06, h: 0.03, sweep: 1.0, falcate: true },
      pecs: { s: 0.27, len: 0.3, chord: 0.055, out: 0.6, down: 0.45, back: 0.65, knobs: true },
      flukes: { span: 0.15, chord: 0.055, sweep: 0.06, notch: 0.5, serrate: 0.006, pointed: true },
      // (a small hump in front of the fin)
      mod: (s, th, P) => { if (Math.abs(th) < 0.5) P[1] += 0.012 * L * Math.exp(-(((s - 0.63) / 0.03) ** 2)) * Math.cos(th); } });
  }
  if (id === 'brydes') {
    const back = C(0x3a4148), belly = C(0xd4d1cb);
    const body = [[0, 0.01, 0.006, 0.01, -0.01], [0.04, 0.035, 0.025, 0.035, -0.01], [0.12, 0.06, 0.045, 0.062, -0.006], [0.22, 0.075, 0.065, 0.078, -0.002],
      [0.35, 0.083, 0.078, 0.086, 0.0], [0.5, 0.078, 0.078, 0.078, 0.0], [0.62, 0.062, 0.07, 0.062, 0.0], [0.76, 0.036, 0.052, 0.04, 0.0],
      [0.87, 0.02, 0.034, 0.024, 0], [0.95, 0.011, 0.016, 0.01, 0], [1, 0.004, 0.005, 0.004, 0]];
    return cetacean({ L, body, M: 22, n: 40, amp: 0.06, waves: 0.55,
      color: (s, th) => { let c = shade(th, back, belly, 2.0, 0.3); if (Math.abs(th) > 2.3 && s < 0.45 && Math.cos(th * 44) > 0.3) c = mix(c, C(0xa9a6a0), 0.5); return c; },
      finColor: (k, e, c, sd) => (k === 'fluke' && sd < 0 ? mix(back, belly, 0.6) : back),
      dorsal: { s: 0.68, len: 0.05, h: 0.035, sweep: 1.2, falcate: true },
      pecs: { s: 0.28, len: 0.1, chord: 0.03, out: 0.65, down: 0.45, back: 0.6 },
      flukes: { span: 0.12, chord: 0.045, sweep: 0.05, notch: 0.55, pointed: true },
      // the three ridges on top of the rostrum (Bryde's whale's mark)
      mod: (s, th, P) => { if (s < 0.2) { const r = Math.exp(-((th / 0.06) ** 2)) + Math.exp(-(((Math.abs(th) - 0.38) / 0.06) ** 2)); P[1] += 0.004 * L * r * (1 - s / 0.2); } } });
  }
  // fin whale: very long and slim, a pointed V head, the right lower jaw white and the left dark
  const back = C(0x3b3e42), belly = C(0xe2e0db);
  const body = [[0, 0.008, 0.005, 0.008, -0.008], [0.05, 0.03, 0.02, 0.03, -0.008], [0.14, 0.055, 0.04, 0.055, -0.004], [0.25, 0.068, 0.058, 0.07, 0.0],
    [0.38, 0.072, 0.068, 0.074, 0.0], [0.52, 0.066, 0.066, 0.066, 0.0], [0.65, 0.05, 0.058, 0.05, 0.0], [0.78, 0.03, 0.045, 0.032, 0],
    [0.88, 0.016, 0.028, 0.018, 0], [0.95, 0.009, 0.014, 0.009, 0], [1, 0.004, 0.004, 0.004, 0]];
  return cetacean({ L, body, M: 22, n: 44, amp: 0.05, waves: 0.55,
    color: (s, th) => {
      let c = shade(th, back, belly, 2.0, 0.3);
      if (s < 0.18 && th > 0.9 && th < 2.2) c = mix(c, belly, 0.9 * sst(0.9, 1.3, th));     // (the right jaw white)
      if (s > 0.2 && s < 0.4 && Math.abs(th) > 1.0 && Math.abs(th) < 1.6) c = mix(c, C(0x8a8d90), 0.3 * sst(0.2, 0.3, s));     // the pale chevron
      if (Math.abs(th) > 2.3 && s < 0.45 && Math.cos(th * 44) > 0.3) c = mix(c, C(0xb0aea8), 0.5);
      return c;
    },
    finColor: (k, e, c, sd) => (k === 'fluke' && sd < 0 ? belly : back),
    dorsal: { s: 0.72, len: 0.04, h: 0.03, sweep: 1.3, falcate: true },
    pecs: { s: 0.27, len: 0.09, chord: 0.025, out: 0.6, down: 0.45, back: 0.65 },
    flukes: { span: 0.11, chord: 0.04, sweep: 0.045, notch: 0.55, pointed: true } });
}
function rightWhale() {
  // a southern right whale: rotund, no dorsal fin, the bowed jaw, the callosities (pale, rough) on the head,
  // broad paddle flippers, broad smooth flukes
  const S = SPECIES.southernRight, L = S.L;
  const black = C(0x17191b), call = C(0xd6cfbf), white = C(0xd9d6cf);
  const body = [[0, 0.012, 0.012, 0.012, 0.03], [0.03, 0.035, 0.03, 0.06, 0.02], [0.1, 0.06, 0.05, 0.11, 0.0], [0.2, 0.09, 0.075, 0.13, -0.012],
    [0.28, 0.12, 0.1, 0.13, -0.004], [0.4, 0.13, 0.115, 0.125, 0.0], [0.52, 0.12, 0.112, 0.11, 0.0], [0.64, 0.09, 0.095, 0.085, 0.0],
    [0.76, 0.05, 0.065, 0.05, 0], [0.87, 0.024, 0.038, 0.026, 0], [0.95, 0.012, 0.018, 0.012, 0], [1, 0.004, 0.005, 0.004, 0]];
  return cetacean({ L, body, M: 26, n: 44, amp: 0.06, waves: 0.55,
    color: (s, th) => {
      const a = Math.abs(th);
      // the callosities: the bonnet on the rostrum, rows over the eyes, on the chin and lower lips
      if (s < 0.2) {
        const bonnet = s > 0.01 && s < 0.07 && a < 0.4, brow = s > 0.15 && s < 0.19 && a > 0.6 && a < 1.0, lip = s < 0.17 && a > 1.7 && a < 2.0 && Math.sin(s * 140) > 0;
        if ((bonnet || brow || lip) && vn(s * 80, th * 10) > 0.35) return call;
      }
      if (a > 2.6 && s > 0.35 && s < 0.6 && vn(s * 12, th * 3) > 0.55) return white;     // (a white belly patch)
      return black;
    },
    finColor: (k, e, c, sd) => black,
    dorsal: null,
    pecs: { s: 0.3, len: 0.14, chord: 0.07, out: 0.6, down: 0.55, back: 0.55, round: true },
    flukes: { span: 0.17, chord: 0.06, sweep: 0.065, notch: 0.5, pointed: true } });
}

// ------------------------------------------------------------------ turtles
function turtleModel(id) {
  const S = SPECIES[id], L = S.L, lb = id === 'leatherback';
  const g = new Geo();
  // carapace and plastron: one lofted shell from the front margin (s = 0) to the back (s = 1), its middle a
  // quarter-length behind the shoulder (the fore-flippers' hinge at z = 0)
  const sh = { greenTurtle: { w: [[0, 0.24], [0.15, 0.37], [0.4, 0.43], [0.7, 0.36], [0.92, 0.18], [1, 0.05]], up: 0.17, dn: 0.1 },
    hawksbill: { w: [[0, 0.22], [0.15, 0.34], [0.4, 0.39], [0.7, 0.32], [0.9, 0.15], [1, 0.03]], up: 0.16, dn: 0.1 },
    loggerhead: { w: [[0, 0.27], [0.15, 0.4], [0.38, 0.44], [0.7, 0.34], [0.9, 0.17], [1, 0.05]], up: 0.19, dn: 0.11 },
    leatherback: { w: [[0, 0.22], [0.15, 0.34], [0.35, 0.36], [0.65, 0.28], [0.88, 0.12], [1, 0.0]], up: 0.18, dn: 0.13 } }[id];
  const wf = f1(sh.w), hp = f1([[0, 0.45], [0.2, 0.9], [0.45, 1], [0.75, 0.85], [1, 0.25]]);
  const z0 = -0.1 * L, zAt = (s) => z0 + s * L;
  const pal = {
    greenTurtle: { a: 0x5b4a2c, b: 0x8a7444, seam: 0x3b3020, skin: 0x5a5547, skinEdge: 0xc9c2a6, plast: 0xe6dcb6 },
    hawksbill: { a: 0x5a2e14, b: 0xc98c3a, seam: 0x2a1408, skin: 0x3d2c1e, skinEdge: 0xd4b77a, plast: 0xe9d9a6 },
    loggerhead: { a: 0x7a3a1c, b: 0xa65a2a, seam: 0x4a2412, skin: 0x8a5a32, skinEdge: 0xd9b07a, plast: 0xe4d29e },
    leatherback: { a: 0x15181c, b: 0x2a2f36, seam: 0x0d0f12, skin: 0x1a1d21, skinEdge: 0xcfd2d6, plast: 0xd6d4d0 },
  }[id];
  const A = C(pal.a), Bc = C(pal.b), seam = C(pal.seam), skin = C(pal.skin), skinEdge = C(pal.skinEdge), plast = C(pal.plast), whiteSp = C(0xcfd3d8);
  const shellColor = (s, th, x, y) => {
    const a = Math.abs(th);
    if (a > 1.65) return lb ? mix(plast, A, 0.3 * spots(s * 8, th * 2, 1, 0.3)) : plast;
    const u = Math.sin(th);                     // across the shell, -1..1
    if (lb) {
      // ridged black skin with pale spots
      return mix(mix(A, Bc, vn(s * 10, u * 6)), whiteSp, spots(s * 55, u * 30, 1, 0.16, 5) * 0.7);
    }
    // the scutes: 5 vertebral down the middle, 4 (5 in the loggerhead) costal pairs, the marginal ring
    const nC = id === 'loggerhead' ? 5 : 4, au = Math.abs(u);
    let row, k, n;
    if (au < 0.27) { n = 5; k = s * n; row = 0; } else if (au < 0.86) { n = nC; k = (s - 0.04) / 0.92 * n; row = 1; } else { n = 12; k = s * n; row = 2; }
    const fr = k - Math.floor(k), cell = Math.floor(k);
    const edge = Math.min(fr, 1 - fr) < 0.06 || Math.abs(au - 0.27) < 0.025 || Math.abs(au - 0.86) < 0.02;
    if (edge) return seam;
    // within a scute: streaks radiating from its back corner (green), tortoiseshell flecks (hawksbill), even (loggerhead)
    const rx = (au - (row === 0 ? 0 : row === 1 ? 0.56 : 0.93)) * 6, ry = fr - 0.85, ang = Math.atan2(ry, rx);
    if (id === 'greenTurtle') return mix(A, Bc, 0.5 + 0.5 * Math.sin(ang * 9 + cell * 2) * sst(0.1, 0.6, Math.hypot(rx * 0.3, ry)));
    if (id === 'hawksbill') return mix(A, Bc, sst(0.4, 0.7, vn(s * 14 + cell, ang * 1.5 + u * 3)) * 0.9 + 0.1 * fr);
    return mix(A, Bc, 0.35 + 0.4 * vn(s * 9, u * 4));
  };
  g.loft({ ss: steps(0, 1, 26), M: 32, zAt, e: () => (lb ? 1.9 : 1.6),
    prof: (s) => { const w = wf(s) * L, h = hp(s); return [w, sh.up * L * h, sh.dn * L * h * 0.8, -0.02 * L]; },
    color: shellColor,
    mod: (s, th, P) => {
      const a = Math.abs(th);
      if (lb && a < 1.6) {     // the leatherback's seven ridges
        const u = Math.sin(th), r = Math.min(Math.abs(u - 0), Math.abs(Math.abs(u) - 0.35), Math.abs(Math.abs(u) - 0.7), Math.abs(Math.abs(u) - 0.98));
        P[1] += 0.012 * L * Math.exp(-((r / 0.05) ** 2)) * hp(s);
      }
      if (id === 'hawksbill' && a < 1.55) {    // overlapping scutes: a step at each one's back edge; a serrated rear margin
        const au = Math.abs(Math.sin(th)), n = au < 0.27 ? 5 : au < 0.86 ? 4 : 12, k = (au < 0.27 || au >= 0.86 ? s : (s - 0.04) / 0.92) * n;
        P[1] += 0.006 * L * (k - Math.floor(k)) * Math.cos(th);
        if (s > 0.65 && a > 1.2) P[0] *= 1 + 0.04 * Math.max(0, Math.sin(s * 60));
      }
      if (id === 'loggerhead' && a < 0.4 && s > 0.15 && s < 0.85) P[1] += 0.004 * L * Math.cos(th);      // (a slight vertebral keel)
    },
    part: () => [0, 0, 0, 0] });
  // the head and neck (part 3: lifts for a breath)
  const hd = { greenTurtle: { len: 0.25, w: 0.07, h: 0.065, beak: 0.6 }, hawksbill: { len: 0.27, w: 0.06, h: 0.06, beak: 0.25 },
    loggerhead: { len: 0.3, w: 0.11, h: 0.09, beak: 0.7 }, leatherback: { len: 0.22, w: 0.085, h: 0.08, beak: 0.6 } }[id];
  const headProf = curve([[0, 0.012 * hd.beak, 0.01, 0.01, 0], [0.08, hd.w * 0.45, hd.h * 0.5, hd.h * 0.4, 0], [0.25, hd.w * 0.85, hd.h * 0.85, hd.h * 0.8, 0.005],
    [0.45, hd.w, hd.h, hd.h * 0.9, 0.006], [0.7, hd.w * 0.8, hd.h * 0.8, hd.h * 0.8, 0], [1, hd.w * 0.75, hd.h * 0.75, hd.h * 0.75, -0.01]]);
  const nz = z0 + 0.05 * L, ny = -0.01 * L, hl = hd.len * L;
  const headColor = (s, th) => {
    const a = Math.abs(th);
    if (lb) return s < 0.4 && a < 0.4 && s > 0.25 ? C(0xd59a9a) : mix(skin, whiteSp, spots(s * 22, th * 6, 1, 0.16) * 0.7);   // (the pink pineal spot)
    if (a > 1.9) return mix(skinEdge, plast, 0.5);
    if (s < 0.08) return id === 'hawksbill' ? C(0x6a5a40) : mix(skin, C(0x8a8060), 0.5);             // the beak
    if (s > 0.18 && s < 0.26 && a > 1.0 && a < 1.5) return C(0x101010);                              // the eye
    // head scales: dark plates with pale edges
    const sc = spots(s * 9, th * 2.2, 1, 0.62, 9);
    return mix(mix(skinEdge, skin, 0.55), id === 'loggerhead' ? C(0x8a4e22) : skin, sc);
  };
  g.loft({ ss: steps(0, 1, 12), M: 14, zAt: (s) => nz - hl * (1 - s), prof: (s) => { const r = headProf(s); return [r[0] * L, r[1] * L, r[2] * L, ny + r[3] * L]; },
    color: headColor, part: () => [3, 0, 0, 0], p2: [nz, ny, L, 0] });
  // the fore-flippers (part 1: they fly), long and swept back; the leatherback's longest
  const fl = { greenTurtle: 0.58, hawksbill: 0.55, loggerhead: 0.52, leatherback: 0.8 }[id] * L;
  const flColor = (e, c, sd) => {
    if (sd < 0) return mix(plast, skinEdge, 0.3);
    if (lb) return mix(skin, whiteSp, spots(e * 30, c * 8, 1, 0.16) * 0.7);
    const sc = spots(e * 10, c * 3, 1, 0.62, 3);
    if (c > 0.9) return mix(skin, skinEdge, 0.5);            // (a pale trailing margin)
    return mix(mix(skinEdge, skin, 0.75), skin, sc);
  };
  for (const side of [1, -1]) {
    const x0 = side * wf(0.16) * L * 0.85, y0 = -0.03 * L;
    const ch = 0.16 * L;
    g.plan({ org: [x0, y0, -ch * 0.25], span: [side * fl * 0.88, -fl * 0.08, fl * 0.42], chord: [0, 0, 1], nrm: [0, 1, 0],
      le: (e) => -0.02 * L * Math.sin(e * Math.PI), te: (e) => ch * (1 - 0.82 * Math.pow(e, 1.3)), th: (e) => lerp(0.22, 0.08, e), ns: steps(0, 1, 9), nc: [0, 0.15, 0.4, 0.7, 1],
      color: flColor, part: (e) => [1, e, side, 0.99], p2: [Math.abs(x0), y0, fl, 0] });
    // the hind flippers: small paddles
    const hx = side * wf(0.8) * L * 0.75, hz = zAt(0.84), hl2 = (lb ? 0.22 : 0.17) * L;
    g.plan({ org: [hx, -0.035 * L, hz], span: [side * hl2 * 0.75, -hl2 * 0.1, hl2 * 0.6], chord: [0, 0, 1], nrm: [0, 1, 0],
      le: () => 0, te: (e) => 0.09 * L * (1 - 0.5 * e * e), th: () => 0.15, ns: steps(0, 1, 5), nc: [0, 0.3, 0.7, 1],
      color: flColor, part: () => [2, 0, side, 0], p2: [Math.abs(hx), -0.035 * L, hz, 0] });
  }
  return g.build();
}

// ------------------------------------------------------------------ sharks
function sharkModel(id) {
  const S = SPECIES[id], L = S.L;
  const P = {
    blueShark: { back: 0x1d3f8a, flank: 0x3f78c8, belly: 0xf0f0ec, tip: null, snout: 1.3, slim: 0.8, pec: 0.24, d1: [0.4, 0.085, 0.11], lunate: false },
    bullShark: { back: 0x6b6f72, flank: 0x8a8e90, belly: 0xeeeeea, tip: null, snout: 0.6, slim: 1.15, pec: 0.18, d1: [0.32, 0.1, 0.13], lunate: false },
    blacktip: { back: 0x6c6e66, flank: 0x9c9a8c, belly: 0xf0efea, tip: 0x111111, snout: 1.0, slim: 0.9, pec: 0.17, d1: [0.34, 0.1, 0.11], lunate: false, band: true },
    bronzeWhaler: { back: 0x6e6448, flank: 0x948a6a, belly: 0xefede6, tip: 0x3a362c, snout: 0.9, slim: 1.0, pec: 0.19, d1: [0.34, 0.1, 0.12], lunate: false },
    greatWhite: { back: 0x56595d, flank: 0x6a6d71, belly: 0xf4f3f0, tip: 0x161616, snout: 0.85, slim: 1.2, pec: 0.2, d1: [0.36, 0.11, 0.12], lunate: true, line: true },
    porbeagle: { back: 0x2e3a4a, flank: 0x46536a, belly: 0xf1f0ec, tip: null, snout: 0.8, slim: 1.2, pec: 0.17, d1: [0.36, 0.11, 0.12], lunate: true, freeTip: true },
    baskingShark: { back: 0x4a4744, flank: 0x6b6762, belly: 0xb9b5ae, tip: null, snout: 0.8, slim: 1.0, pec: 0.18, d1: [0.36, 0.14, 0.13], lunate: true, basking: true },
    whaleShark: { back: 0x2f3e4c, flank: 0x3d4e5e, belly: 0xe8e8e4, tip: null, snout: 0.3, slim: 1.25, pec: 0.16, d1: [0.5, 0.1, 0.11], lunate: true, whale: true },
  }[id];
  const back = C(P.back), flank = C(P.flank), belly = C(P.belly), tipC = P.tip ? C(P.tip) : null, dark = C(0x0e0d0d);
  const sl = P.slim, sn = P.snout;
  let body = [[0, 0.006, 0.006, 0.006, 0.004], [0.04 * sn, 0.03 * sl, 0.028 * sl, 0.024 * sl, 0.004], [0.1, 0.055 * sl, 0.05 * sl, 0.048 * sl, 0.0], [0.2, 0.07 * sl, 0.065 * sl, 0.065 * sl, 0.0],
    [0.32, 0.075 * sl, S.back, 0.072 * sl, 0.0], [0.45, 0.068 * sl, S.back * 0.92, 0.068 * sl, 0.0], [0.58, 0.05 * sl, S.back * 0.72, 0.052 * sl, 0.0],
    [0.7, 0.03 * sl, 0.045 * sl, 0.034 * sl, 0.002], [0.8, 0.018, 0.026, 0.02, 0.004], [0.86, 0.014, 0.02, 0.015, 0.006], [0.9, 0.01, 0.014, 0.01, 0.008]];
  if (P.whale) body = [[0, 0.07, 0.02, 0.02, 0.0], [0.02, 0.085, 0.035, 0.032, 0.0], [0.08, 0.1, 0.055, 0.05, 0.0], [0.2, 0.11, 0.075, 0.07, 0.0], [0.35, 0.105, S.back, 0.08, 0.0],
    [0.5, 0.085, S.back * 0.95, 0.07, 0.0], [0.62, 0.06, 0.06, 0.05, 0.0], [0.74, 0.035, 0.04, 0.032, 0.0], [0.84, 0.02, 0.026, 0.02, 0.004], [0.9, 0.012, 0.016, 0.012, 0.006]];
  if (P.basking) { body[0] = [0, 0.008, 0.008, 0.008, 0.03]; body[1] = [0.04, 0.03, 0.02, 0.02, 0.03]; body.splice(2, 0, [0.07, 0.07, 0.045, 0.075, 0.0]); }
  const color = (s, th, x, y) => {
    const a = Math.abs(th);
    let c = mix(back, flank, sst(0.6, 1.4, a));
    c = mix(c, belly, P.line ? sst(1.75, 1.85, a) : sst(1.65, 2.05, a));
    if (P.band && s > 0.45 && s < 0.68 && a > 1.55 && a < 1.85) c = mix(c, belly, 0.7);            // (the blacktip's flank band)
    if (P.whale) {    // spots and pale stripes on a dark back, white belly; the wide mouth across the front
      if (a < 1.9) { const sp = spots(s * 50, th * 7, 1, 0.24, 2); c = mix(c, C(0xdfe3e6), sp); if (s > 0.2 && Math.cos(s * 95) > 0.93) c = mix(c, C(0xc9cfd4), 0.6); }
      if (s < 0.02 && a > 1.4 && a < 1.9) c = dark;
    }
    if (P.basking) {   // the gape (feeding: wide open) and the great gill slits all round the head
      if (s > 0.035 && s < 0.075 && a > 1.0) return s < 0.06 ? dark : C(0xc8beb0);
      if (s > 0.09 && s < 0.25 && Math.cos((s - 0.09) / 0.16 * 5 * TAU) > 0.75 && a > 0.4) c = mix(c, dark, 0.75);
      c = mix(c, C(0x7a756d), 0.25 * vn(s * 30, th * 4));
    } else if (!P.whale && s > 0.17 && s < 0.25 && a > 1.0 && a < 2.0 && Math.cos((s - 0.17) / 0.08 * 5 * TAU) > 0.7) c = mix(c, dark, 0.5);     // five gill slits
    if (!P.whale && s > 0.075 && s < 0.09 && a > 1.0 && a < 1.3) c = C(0x0a0a0a);   // the eye
    return c;
  };
  const finTip = (k, e, c, sd) => {
    let col = sd > 0 || k === 'dorsal' || k === 'caudal' ? mix(back, flank, 0.3) : belly;
    if (k === 'pec' && sd < 0) col = mix(belly, back, sst(0.6, 0.9, e) * 0.5);
    if (tipC && e > 0.78 && (k !== 'caudal' || true)) col = tipC;
    if (P.freeTip && k === 'dorsal' && c > 0.7 && e < 0.35) col = C(0xe8e8e4);        // (a porbeagle's white rear tip)
    if (P.whale && sd > 0) col = mix(col, C(0xdfe3e6), spots(e * 8, c * 6, 1, 0.24) * 0.9);
    return col;
  };
  return cetacean({ L, body, M: 16, n: 34, amp: P.whale || P.basking ? 0.06 : 0.09, waves: 0.85, edges: P.basking ? [0.035, 0.06, 0.075] : [],
    color, finColor: finTip, dorsal: null, pecs: null, flukes: null,
    extra: (g, pr, zAt, p2) => {
      // first dorsal: tall, triangular, its trailing edge straight (a little concave in the requiem sharks)
      const [d1s, d1c, d1h] = P.d1, r = pr(d1s), h = d1h * L, c0 = d1c * L;
      const req = !P.lunate;
      g.plan({ org: [0, r[3] + r[1] * 0.95, zAt(d1s)], span: [0, h, 0], chord: [0, 0, 1], nrm: [1, 0, 0],
        le: (e) => c0 * 0.62 * Math.pow(e, 1.25), te: (e) => lerp(c0, c0 * 0.72, e) - (req ? 0.06 * c0 * Math.sin(Math.PI * e) : 0) - (P.freeTip && e < 0.12 ? -0.08 * c0 * (1 - e / 0.12) : 0),
        th: (e) => lerp(0.22, 0.1, e), ns: steps(0, 1, 7), nc: [0, 0.15, 0.4, 0.7, 1], color: (e, c, sd) => finTip('dorsal', e, c, sd), p2 });
      // second dorsal and anal: small
      for (const [s2, up] of [[P.whale ? 0.72 : 0.7, 1], [0.72, -1]]) {
        const r2 = pr(s2), h2 = 0.03 * L, c2 = 0.04 * L;
        g.plan({ org: [0, r2[3] + up * (up > 0 ? r2[1] : r2[2]) * 0.9, zAt(s2)], span: [0, up * h2, 0], chord: [0, 0, 1], nrm: [1, 0, 0],
          le: (e) => c2 * 0.5 * e, te: (e) => lerp(c2, c2 * 0.7, e), th: () => 0.15, ns: steps(0, 1, 3), nc: [0, 0.4, 1], color: (e, c, sd) => finTip('dorsal', e, c, sd), p2 });
      }
      // pectorals: big, swept (a blue shark's long and sickle-shaped); pelvics small
      for (const side of [1, -1]) {
        const rp = pr(0.27), len = P.pec * L, ch = 0.075 * L;
        g.plan({ org: [side * rp[0] * 0.8, rp[3] - rp[2] * 0.55, zAt(0.25)], span: [side * len * 0.8, -len * 0.35, len * 0.5], chord: [0, 0, 1],
          le: (e) => ch * 0.3 * e * e, te: (e) => ch * (1 - 0.7 * e) + ch * 0.3 * e * e, th: () => 0.15, ns: steps(0, 1, 7), nc: [0, 0.2, 0.5, 0.8, 1],
          color: (e, c, sd) => finTip('pec', e, c, sd), p2 });
        const rv = pr(0.6), lv = 0.05 * L;
        g.plan({ org: [side * rv[0] * 0.6, rv[3] - rv[2] * 0.7, zAt(0.58)], span: [side * lv * 0.7, -lv * 0.4, lv * 0.4], chord: [0, 0, 1],
          le: () => 0, te: (e) => 0.035 * L * (1 - 0.6 * e), th: () => 0.15, ns: steps(0, 1, 3), nc: [0, 0.5, 1], color: (e, c, sd) => finTip('pec', e, c, sd), p2 });
      }
      // the caudal fin: the upper lobe up and back (long in the requiem sharks), the lower lobe (as long in the
      // lunate tails of the white, the porbeagle and the basking shark)
      const rc = pr(0.88), zc = zAt(0.88), up = (P.lunate ? 0.17 : 0.22) * L, lo = (P.lunate ? 0.15 : 0.1) * L;
      g.plan({ org: [0, rc[3], zc], span: [0, up * 0.72, up * 0.7], chord: [0, -0.35, 1], nrm: [1, 0, 0],
        le: (e) => 0, te: (e) => 0.07 * L * (1 - e) * (P.lunate ? 1 : 1 - 0.4 * sst(0.75, 0.85, e)) + 0.01 * L, th: (e) => lerp(0.18, 0.06, e),
        ns: steps(0, 1, 8), nc: [0, 0.2, 0.5, 0.8, 1], color: (e, c, sd) => finTip('caudal', e, c, sd), p2 });
      g.plan({ org: [0, rc[3] - rc[2] * 0.5, zc + 0.01 * L], span: [0, -lo * 0.72, lo * 0.55], chord: [0, 0.4, 1], nrm: [1, 0, 0],
        le: () => 0, te: (e) => 0.06 * L * (1 - 0.85 * e), th: (e) => lerp(0.18, 0.06, e),
        ns: steps(0, 1, 6), nc: [0, 0.3, 0.7, 1], color: (e, c, sd) => (tipC && e > 0.7 ? tipC : finTip('caudal', e, c, sd)), p2 });
      // (a whale shark's ridges along the back)
      if (P.whale) for (const xr of [-0.045, 0.045]) {
        g.plan({ org: [xr * L, pr(0.3)[1] * 0.85, zAt(0.15)], span: [0, 0.012 * L, 0], chord: [0, 0, 1], nrm: [1, 0, 0],
          le: (e) => 0.1 * L * e, te: (e) => 0.55 * L - 0.1 * L * e, th: () => 0.4, ns: [0, 1], nc: [0, 0.5, 1], color: () => C(0x3a4a58), p2 });
      }
    } });
}

// ------------------------------------------------------------------ by species
const cache = new Map();
export function speciesGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const S = SPECIES[id];
  let g;
  switch (S.morph) {
    case 'gull': g = gullModel(id); break;
    case 'tern': g = ternModel(id); break;
    case 'gannet': g = gannetModel(id); break;
    case 'albatross': g = albatrossModel(id); break;
    case 'petrel': case 'shearwater': g = petrelModel(id); break;
    case 'frigatebird': g = frigateModel(); break;
    case 'pelican': g = pelicanModel(); break;
    case 'delphinid': g = delphinid(id); break;
    case 'porpoise': g = porpoise(); break;
    case 'rorqual': g = rorqual(id); break;
    case 'right': g = rightWhale(); break;
    case 'turtle': case 'leatherback': g = turtleModel(id); break;
    case 'shark': case 'whaleshark': g = sharkModel(id); break;
  }
  cache.set(id, g);
  return g;
}
