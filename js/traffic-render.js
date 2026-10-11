// Harbour traffic, drawn (js/traffic.js is the simulation): low-poly vessels as instanced meshes (one draw per
// part per type), furled or set sails on the yachts, the sea under every hull, foam wakes behind the boats under
// way and, after dark, the lights of the rules of the road — masthead, sidelights and stern light by their arcs,
// trawler's green over white, anchor lights, cabin lights in the marinas. No crew figures.
import * as THREE from 'three';
import { VESSELS } from './traffic.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ------------------------------------------------------------------ geometry: a vertex-coloured accumulator
// model frame: bow toward -z, starboard +x, up +y, waterline at y = 0, midships at z = 0
class Acc {
  constructor() { this.p = []; this.c = []; this.i = []; }
  get n() { return this.p.length / 3; }
  v(x, y, z, col) { this.p.push(x, y, z); this.c.push(col.r, col.g, col.b); return this.n - 1; }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // box centred at (x, y, z)
  box(w, h, d, x, y, z, hex, taper = 1) {
    const col = new THREE.Color(hex), W = w / 2, H = h / 2, D = d / 2, Wt = W * taper, Dt = D * taper;
    const P = [[-W, -H, -D], [W, -H, -D], [W, -H, D], [-W, -H, D], [-Wt, H, -Dt], [Wt, H, -Dt], [Wt, H, Dt], [-Wt, H, Dt]];
    const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const f of F) { const k = f.map(j => this.v(P[j][0] + x, P[j][1] + y, P[j][2] + z, col)); this.quad(k[0], k[1], k[2], k[3]); }
    return this;
  }
  // vertical (axis 'y') or fore-and-aft (axis 'z') prism of n sides
  cyl(r0, r1, len, x, y, z, hex, axis = 'y', n = 6) {
    const col = new THREE.Color(hex), a = [], b = [];
    for (let k = 0; k < n; k++) {
      const t = k / n * Math.PI * 2, cx = Math.cos(t), sz = Math.sin(t);
      if (axis === 'y') { a.push(this.v(x + cx * r0, y, z + sz * r0, col)); b.push(this.v(x + cx * r1, y + len, z + sz * r1, col)); }
      else { a.push(this.v(x + cx * r0, y + sz * r0, z - len / 2, col)); b.push(this.v(x + cx * r1, y + sz * r1, z + len / 2, col)); }
    }
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.quad(a[k], a[k1], b[k1], b[k]); }
    return this;
  }
  // a tapered rod from a to b (stays, spars, the furled genoa)
  rod(a, b, r0, r1, hex, n = 5) {
    const col = new THREE.Color(hex), d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); d.normalize();
    const u = new THREE.Vector3(Math.abs(d.y) < 0.9 ? 0 : 1, Math.abs(d.y) < 0.9 ? 1 : 0, 0).cross(d).normalize(), w = d.clone().cross(u);
    const A = [], B = [];
    for (let k = 0; k < n; k++) {
      const t = k / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      A.push(this.v(a[0] + (u.x * c + w.x * s) * r0, a[1] + (u.y * c + w.y * s) * r0, a[2] + (u.z * c + w.z * s) * r0, col));
      B.push(this.v(b[0] + (u.x * c + w.x * s) * r1, b[1] + (u.y * c + w.y * s) * r1, b[2] + (u.z * c + w.z * s) * r1, col));
    }
    for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; this.quad(A[k], A[k1], B[k1], B[k]); }
    return this;
  }
  // a hull lofted from half-sections. Topsides go to `top` (tinted per instance), the bottom and deck to this
  hull(top, L, B, F, D, o = {}) {
    const NS = 12, tr = o.transom ?? 0.75, rake = o.rake ?? 0.25, sheer = o.sheer ?? 0.2, flat = o.flat ?? 0.5;
    const cTop = new THREE.Color(0xffffff), cBot = new THREE.Color(o.bottom ?? 0x6b2320), cBoot = new THREE.Color(o.boot ?? 0x1d2530), cDeck = new THREE.Color(o.deck ?? 0xd9d2c0);
    const st = [];
    for (let s = 0; s <= NS; s++) {
      const t = s / NS, x = (t - 0.5) * L;                        // stern (t = 0) to bow
      const b = B / 2 * (t < 0.45 ? tr + (1 - tr) * Math.sin(t / 0.45 * Math.PI / 2) : Math.pow(Math.max(0, Math.cos((t - 0.45) / 0.55 * Math.PI / 2)), o.fine ?? 0.7));
      const f = F * (1 + sheer * ((t - 0.4) / 0.6) ** 2), d = D * (t > 0.8 ? 1 - (t - 0.8) / 0.2 * 0.85 : t < 0.08 ? 0.6 + 5 * t : 1);
      const bow = rake * Math.max(0, t - 0.85) / 0.15 * L * 0.06;
      st.push({ x, b, f, d, bow });
    }
    const sec = (q) => [[q.b, q.f, q.bow], [q.b * 0.99, 0.12, q.bow * 0.3], [q.b * 0.98, 0.0, 0], [q.b * (0.55 + 0.4 * flat), -q.d * 0.55, 0], [q.b * 0.25 * flat, -q.d * 0.92, 0], [0, -q.d, 0]];
    for (const side of [1, -1]) {
      let prevT = null, prevB = null;
      for (const q of st) {
        const s6 = sec(q);
        const T = [top.v(side * s6[0][0], s6[0][1], -(q.x + s6[0][2]), cTop), top.v(side * s6[1][0], s6[1][1], -(q.x + s6[1][2]), cTop)];
        const Bt = [this.v(side * s6[1][0], s6[1][1], -(q.x + s6[1][2]), cBoot), this.v(side * s6[2][0], s6[2][1], -q.x, cBoot), this.v(side * s6[2][0], s6[2][1] - 0.001, -q.x, cBot), this.v(side * s6[3][0], s6[3][1], -q.x, cBot), this.v(side * s6[4][0], s6[4][1], -q.x, cBot), this.v(side * s6[5][0], s6[5][1], -q.x, cBot)];
        if (prevT) {
          if (side > 0) { top.quad(prevT[0], T[0], T[1], prevT[1]); this.quad(prevB[0], Bt[0], Bt[1], prevB[1]); for (let k = 2; k < 5; k++) this.quad(prevB[k], Bt[k], Bt[k + 1], prevB[k + 1]); }
          else { top.quad(prevT[0], prevT[1], T[1], T[0]); this.quad(prevB[0], prevB[1], Bt[1], Bt[0]); for (let k = 2; k < 5; k++) this.quad(prevB[k], prevB[k + 1], Bt[k + 1], Bt[k]); }
        }
        prevT = T; prevB = Bt;
      }
    }
    // deck and transom
    let prev = null;
    for (const q of st) {
      const a = this.v(q.b, q.f, -(q.x + q.bow), cDeck), b = this.v(-q.b, q.f, -(q.x + q.bow), cDeck);
      if (prev) this.quad(prev[0], prev[1], b, a);
      prev = [a, b];
    }
    // (the transom in the topsides' colour, tinted with them: it was the deck's, a grey or beige slab on the stern)
    const q0 = st[0], s0 = sec(q0), tv = s0.map(([y, z]) => [top.v(y, z, -q0.x, cTop), top.v(-y, z, -q0.x, cTop)]);
    for (let k = 0; k < 5; k++) top.quad(tv[k][0], tv[k + 1][0], tv[k + 1][1], tv[k][1]);
    return st;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

// ------------------------------------------------------------------ more shapes
// the deck edge (half-beam b, sheer height f) at z along a hull lofted by Acc.hull (st: its stations)
function edgeAt(st, z) {
  const L = st[st.length - 1].x - st[0].x, t = clamp(0.5 - z / L, 0, 1) * (st.length - 1), i = Math.min(st.length - 2, Math.floor(t)), f = t - i;
  return { b: st[i].b + (st[i + 1].b - st[i].b) * f, f: st[i].f + (st[i + 1].f - st[i].f) * f };
}
// a deckhouse: the prism of a convex plan [[x, z], ...] (counter-clockwise seen from above: bow -z, starboard +x)
// from y0 to y1, its top drawn in by ix (across) and iz (fore and aft) fractions and moved aft by dz (a raked
// front), a cap on top. bands: windows and stripes on its walls, [f0, f1] of the wall's height, [u0, u1] along each
// wall, on the walls facing 'side' (abeam), 'front', 'back' or 'all', set 1 cm proud of the wall
// a triangle facing along (nx, ny, nz), whichever way round its corners were given
Acc.prototype.tri = function (a, b, c, nx, ny, nz) {
  const P = this.p, ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
  if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz >= 0) this.i.push(a, b, c); else this.i.push(a, c, b);
};
Acc.prototype.house = function (plan, y0, y1, hex, o = {}) {
  const col = new THREE.Color(hex), n = plan.length, ix = o.ix ?? 0, iz = o.iz ?? 0, dz = o.dz ?? 0;
  let cx = 0, cz = 0; for (const [x, z] of plan) { cx += x / n; cz += z / n; }
  const top = plan.map(([x, z]) => [cx + (x - cx) * (1 - ix), cz + (z - cz) * (1 - iz) + dz]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = plan[i], b = plan[j], A = top[i], B = top[j];
    const k0 = this.v(a[0], y0, a[1], col), k1 = this.v(b[0], y0, b[1], col), k2 = this.v(B[0], y1, B[1], col), k3 = this.v(A[0], y1, A[1], col);
    // (outward: away from the plan's middle)
    let nx = b[1] - a[1], nz = -(b[0] - a[0]); const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    this.tri(k0, k1, k2, nx, 0, nz); this.tri(k0, k2, k3, nx, 0, nz);
    // windows on this wall
    for (const w of o.bands || []) {
      const face = Math.abs(nx) > 0.7 ? 'side' : nz < 0 ? 'front' : 'back';
      if (w.on && w.on !== 'all' && w.on !== face) continue;
      if (w.min && nl < w.min) continue;
      const wc = new THREE.Color(w.hex), u0 = w.u0 ?? 0.04, u1 = w.u1 ?? 0.96, P = (u, f) => {
        const bx = a[0] + (b[0] - a[0]) * u, bz = a[1] + (b[1] - a[1]) * u, tx = A[0] + (B[0] - A[0]) * u, tz = A[1] + (B[1] - A[1]) * u;
        return [bx + (tx - bx) * f + nx * 0.012 * (w.out ?? 1), y0 + (y1 - y0) * f, bz + (tz - bz) * f + nz * 0.012 * (w.out ?? 1)];
      };
      const segs = w.n || 1, gap = w.gap ?? 0;
      for (let s = 0; s < segs; s++) {
        const ua = u0 + (u1 - u0) * s / segs + (segs > 1 ? gap / 2 : 0), ub = u0 + (u1 - u0) * (s + 1) / segs - (segs > 1 ? gap / 2 : 0);
        const q = [P(ua, w.f0), P(ub, w.f0), P(ub, w.f1), P(ua, w.f1)].map(p => this.v(p[0], p[1], p[2], wc));
        this.tri(q[0], q[1], q[2], nx, 0, nz); this.tri(q[0], q[2], q[3], nx, 0, nz);
      }
    }
  }
  if (o.cap !== false) {
    const c = this.v(cx, y1, cz + dz, o.capHex !== undefined ? new THREE.Color(o.capHex) : col), K = top.map(([x, z]) => this.v(x, y1, z, o.capHex !== undefined ? new THREE.Color(o.capHex) : col));
    for (let i = 0; i < n; i++) this.tri(c, K[(i + 1) % n], K[i], 0, 1, 0);
  }
  return this;
};
// a ribbon along the hull's side just proud of the topsides, from y = f - d0 to f - d1 (negative: above the sheer):
// a cove stripe, a rubbing strake, a toe rail (out: metres outboard; zs: the z range)
Acc.prototype.band = function (st, d0, d1, hex, out = 0.012, zs = [-1e9, 1e9]) {
  const col = new THREE.Color(hex);
  for (const side of [1, -1]) {
    let prev = null;
    for (const q of st) {
      const z = -(q.x + q.bow); if (z < zs[0] || z > zs[1]) { prev = null; continue; }
      const xo = side * (q.b + out), a = this.v(xo, q.f - d0, z, col), b = this.v(xo, q.f - d1, z, col);
      if (prev) { if (side > 0) this.quad(prev[0], a, b, prev[1]); else this.quad(prev[0], prev[1], b, a); }
      prev = [a, b];
    }
  }
  return this;
};
// a polyline of rods (rails, lifelines)
Acc.prototype.poly = function (pts, r, hex, n = 4) { for (let i = 0; i + 1 < pts.length; i++) this.rod(pts[i], pts[i + 1], r, r, hex, n); return this; };
// a ring of rods (a wheel, a lifebuoy): centre c, radius R, in the plane with normal along axis 'x' | 'y' | 'z'
Acc.prototype.ring = function (c, R, r, hex, axis = 'z', n = 10) {
  const P = [];
  for (let k = 0; k <= n; k++) { const t = k / n * Math.PI * 2, a = Math.cos(t) * R, b = Math.sin(t) * R; P.push(axis === 'z' ? [c[0] + a, c[1] + b, c[2]] : axis === 'x' ? [c[0], c[1] + b, c[2] + a] : [c[0] + a, c[1], c[2] + b]); }
  return this.poly(P, r, hex, 3);
};
// stanchions with two lifelines down both sides, the pulpit round the bow and the pushpit across the stern
function guardRails(acc, st, z0, z1, n, h, hex, bowZ, sternZ) {
  const zs = []; for (let i = 0; i <= n; i++) zs.push(z0 + (z1 - z0) * i / n);
  for (const side of [1, -1]) {
    const tops = [], mids = [];
    for (const z of zs) {
      const e = edgeAt(st, z), x = side * (e.b - 0.06);
      acc.rod([x, e.f, z], [x * 0.985, e.f + h, z], 0.014, 0.012, hex, 4);
      tops.push([x * 0.985, e.f + h, z]); mids.push([x * 0.99, e.f + h * 0.5, z]);
    }
    acc.poly(tops, 0.006, hex, 3).poly(mids, 0.005, hex, 3);
    // the pulpit: from the first stanchion forward round the stem; the pushpit: aft and across
    const eb = edgeAt(st, bowZ + 0.35), es = edgeAt(st, sternZ - 0.1);
    acc.poly([tops[0], [side * eb.b * 0.5, eb.f + h, bowZ + 0.6], [0, eb.f + h, bowZ + 0.35]], 0.014, STEEL, 4);
    acc.rod([side * eb.b * 0.5, eb.f, bowZ + 0.6], [side * eb.b * 0.5, eb.f + h, bowZ + 0.6], 0.014, 0.014, STEEL, 4);
    acc.poly([tops[tops.length - 1], [side * es.b * 0.8, es.f + h, sternZ - 0.15], [0, es.f + h, sternZ - 0.15]], 0.014, STEEL, 4);
    acc.rod([side * es.b * 0.8, es.f, sternZ - 0.15], [side * es.b * 0.8, es.f + h, sternZ - 0.15], 0.014, 0.014, STEEL, 4);
  }
}
// rails on a ship or a motor boat: posts and a top rail along a path of [x, y, z] (both sides mirrored when mirror)
function railAlong(acc, pts, h, hex, step = 1.4, mirror = true) {
  for (const s of mirror ? [1, -1] : [1]) {
    const P = pts.map(([x, y, z]) => [x * s, y + h, z]);
    acc.poly(P, 0.02, hex, 3);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]), m = Math.max(1, Math.round(L / step));
      for (let k = 0; k < m; k++) { const f = k / m, x = (a[0] + (b[0] - a[0]) * f) * s, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f; acc.rod([x, y, z], [x, y + h, z], 0.015, 0.015, hex, 3); }
    }
  }
}

// ------------------------------------------------------------------ the fleet of models (base size = VESSELS)
// parts: hull (topsides, tinted with the vessel's colour), body (everything else). Yachts add cover (the sail
// cover and furled headsail, tinted with the vessel's canvas colour, shown when the sails are down), main and jib
// (set), fenders (alongside a berth only); vessels that anchor, ball (the black ball by day, COLREG 30, only at
// anchor). The yachts, motor boats and RIBs come in two levels: near (every rail, winch and window) and far (the
// same hull, house and rig without the small parts), so the hundreds in a marina cost little.
const WHITE = 0xf2f2ee, GLASS = 0x1c2630, STEEL = 0xb9bec4, DARK = 0x2a2d31, TEAK = 0x8a6a46, NONSKID = 0xe2dccb, RUST = 0x7a2420;
// variant 0: a classic cruiser (raked bow, sprayhood, blue stripe, silver spars); 1: a modern one (plumb bow, wide
// stern, long dark windows, twin wheels, black mast and boom)
function yachtModel(variant = 0, near = true) {
  const T = VESSELS.yacht, top = new Acc(), body = new Acc(), cover = new Acc(), fend = new Acc(), ball = new Acc();
  const modern = variant === 1, L = T.L, H = T.H;
  const st = body.hull(top, L, T.B, modern ? 1.0 : 1.05, 0.55, modern ? { transom: 0.92, rake: 0.05, sheer: 0.06, fine: 0.62, deck: NONSKID } : { transom: 0.78, rake: 0.4, sheer: 0.16, fine: 0.8, deck: NONSKID });
  const bowZ = -L / 2 - (modern ? 0.02 : 0.25), sternZ = L / 2;
  // stripes: the cove line (or a dark sheer band) and the boot top
  // (far off — past 320 m, where a yacht is 30 pixels long — a stripe, a window, a coaming or a toe rail is under a
  // pixel: the far model leaves them out and costs about what the old box model did)
  if (near) body.band(st, 0.13, 0.19, modern ? 0x30353b : 0x1d3557, 0.012);
  if (modern) body.band(st, 0.35, 0.75, GLASS, 0.013, [-1.6, 1.6]);        // (hull windows)
  // the coachroof: a raked front, windows along it, a hatch on top
  const cz0 = modern ? -3.3 : -2.9, cz1 = modern ? 0.9 : 0.8, cw = modern ? 1.12 : 1.02, y0 = edgeAt(st, -1).f - 0.04, yr = y0 + (modern ? 0.4 : 0.5);
  body.house([[-cw * 0.5, cz0], [-cw * 0.92, cz0 + 0.8], [-cw, cz0 + 2], [-cw, cz1], [cw, cz1], [cw, cz0 + 2], [cw * 0.92, cz0 + 0.8], [cw * 0.5, cz0]], y0, yr, WHITE,
    { ix: 0.08, iz: 0.06, dz: 0.18, capHex: 0xece8dc, bands: !near ? [{ on: 'side', f0: 0.38, f1: 0.75, hex: GLASS, u0: 0.1, u1: 0.9 }] : modern ? [{ on: 'side', f0: 0.3, f1: 0.82, hex: GLASS, u0: 0.03, u1: 0.97 }, { on: 'front', f0: 0.35, f1: 0.8, hex: GLASS }] : [{ on: 'side', f0: 0.38, f1: 0.72, hex: GLASS, n: 3, gap: 0.08, u0: 0.12, u1: 0.9 }, { on: 'front', f0: 0.4, f1: 0.75, hex: GLASS, u0: 0.15, u1: 0.85 }] });
  const mz = modern ? -1.2 : -0.9;
  if (near) {
    body.box(0.55, 0.06, 0.55, 0, yr + 0.03, cz0 + 0.9, 0x3a4048);                       // forehatch (smoked)
    body.box(0.5, 0.04, 0.5, 0, yr + 0.02, mz + 1.0, 0x3a4048);                          // saloon hatch
    for (const s of [1, -1]) body.box(0.04, 0.05, 1.8, s * cw * 0.7, yr + 0.03, (cz0 + cz1) / 2 + 0.2, TEAK);   // handrails
  }
  // the sprayhood over the companionway (and on the modern one a bimini over the helm)
  const canvas = modern ? 0x5b6168 : 0x22324c;
  body.house([[-0.85, cz1 - 0.55], [-0.88, cz1 + 0.25], [0.88, cz1 + 0.25], [0.85, cz1 - 0.55]], yr - 0.02, yr + 0.55, canvas, { ix: 0.06, iz: 0.55, dz: 0.28, bands: near ? [{ on: 'front', f0: 0.25, f1: 0.75, hex: 0x46525e, n: 2, gap: 0.06 }] : [] });
  // the cockpit: teak seats and sole between the coamings, the wheel(s) on a pedestal
  const yc = edgeAt(st, 2.2).f;
  body.box(1.95, 0.03, 2.9, 0, yc + 0.01, cz1 + 1.55, TEAK);
  if (near) for (const s of [1, -1]) body.box(0.08, 0.32, 2.7, s * 1.08, yc + 0.15, cz1 + 1.4, modern ? 0xd9d6cc : TEAK);
  const wz = sternZ - (modern ? 1.0 : 1.6);
  for (const wx of modern ? [-0.75, 0.75] : [0]) {
    if (!near) continue;
    body.cyl(0.07, 0.06, 0.62, wx, yc, wz + 0.15, 0xd8d8d2, 'y', 6);
    body.ring([wx, yc + 0.68, wz], modern ? 0.38 : 0.42, 0.018, 0x2c2f33, 'z', 12).rod([wx, yc + 0.68, wz - 0.03], [wx, yc + 0.68, wz + 0.1], 0.03, 0.03, 0x2c2f33, 4);
  }
  if (modern && near) {   // the bimini: a frame of two hoops and a canvas top
    for (const z of [cz1 + 0.35, cz1 + 1.9]) body.poly([[-1.05, yc + 0.3, z], [-0.95, yc + 1.85, z], [0.95, yc + 1.85, z], [1.05, yc + 0.3, z]], 0.012, STEEL, 3);
    body.box(1.9, 0.03, 1.6, 0, yc + 1.87, cz1 + 1.12, canvas);
  }
  // winches on the coachroof and coamings
  if (near) for (const s of [1, -1]) { body.cyl(0.07, 0.06, 0.13, s * 0.75, yr, cz1 - 0.15, 0x9ba1a6, 'y', 8); body.cyl(0.09, 0.08, 0.17, s * 1.08, yc + 0.31, cz1 + 1.0, 0x9ba1a6, 'y', 8); }
  // rails: stanchions and lifelines, pulpit, pushpit
  if (near) guardRails(body, st, bowZ + 1.15, sternZ - 0.5, modern ? 6 : 6, 0.62, 0xc9ced3, bowZ, sternZ);
  // the toe rail
  if (near) body.band(st, -0.05, 0.0, modern ? 0x9aa0a6 : TEAK, -0.01);
  // the rig: mast, spreaders, shrouds, stays, boom and its vang
  const spar = modern ? 0x24272b : STEEL, ym = yr, sy = ym + (H - ym) * 0.55, ys2 = ym + (H - ym) * 0.8;
  body.cyl(0.09, 0.06, H - ym, 0, ym, mz, spar, 'y', near ? 8 : 6);
  // the boom and its vang, about the gooseneck (they swing out with the main: on the centreline under its cover)
  const boomP = new Acc(), bl = 3.9 + (modern ? 0.4 : 0);
  boomP.cyl(0.06, 0.05, bl, 0, -0.05, bl / 2 + 0.05, spar, 'z', 6);
  if (near) boomP.rod([0, -0.5, 0.1], [0, -0.08, 1.15], 0.02, 0.02, spar, 4);
  const ch = edgeAt(st, mz + 0.25), chp = [ch.b - 0.08, ch.f, mz + 0.25];
  for (const s of [1, -1]) {
    const tip = [s * 0.95, sy, mz + 0.12], tip2 = [s * 0.6, ys2, mz + 0.06];
    body.rod([0, sy, mz], tip, 0.03, 0.02, spar, 4);
    if (modern && near) body.rod([0, ys2, mz], tip2, 0.025, 0.018, spar, 4);
    body.rod([s * chp[0], chp[1], chp[2]], tip, 0.009, 0.009, STEEL, 3);
    if (modern) { body.rod(tip, tip2, 0.008, 0.008, STEEL, 3); body.rod(tip2, [0, H - 0.6, mz], 0.007, 0.007, STEEL, 3); }
    else body.rod(tip, [0, H - 0.4, mz], 0.008, 0.008, STEEL, 3);
    if (near) { body.rod([s * chp[0], chp[1], chp[2] - 0.6], [0, sy, mz], 0.008, 0.008, STEEL, 3); body.rod([s * chp[0], chp[1], chp[2] + 0.6], [0, sy, mz], 0.008, 0.008, STEEL, 3); }
  }
  body.rod([0, edgeAt(st, bowZ + 0.3).f + 0.05, bowZ + 0.25], [0, H - (modern ? 0.4 : 1.2), mz], 0.011, 0.011, STEEL, 3);   // forestay
  if (modern) for (const s of [1, -1]) body.rod([s * 1.2, edgeAt(st, sternZ - 0.2).f, sternZ - 0.2], [0, H - 0.1, mz + 0.05], 0.007, 0.007, 0x30353b, 3);   // split backstay
  else body.rod([0, edgeAt(st, sternZ - 0.2).f + 0.6, sternZ - 0.2], [0, H - 0.1, mz + 0.05], 0.009, 0.009, STEEL, 3);
  if (near) {
    body.rod([0, H, mz], [0, H + 0.9, mz - 0.05], 0.005, 0.005, DARK, 3);                               // VHF whip
    body.rod([0, H, mz], [0, H + 0.1, mz + 0.45], 0.008, 0.008, DARK, 3);                               // windex
    body.box(0.12, 0.08, 0.12, 0, H + 0.04, mz, DARK);                                                  // masthead light
    body.box(0.18, 0.12, 0.1, 0, edgeAt(st, bowZ + 0.4).f + 0.08, bowZ + 0.3, 0x8d9399);              // bow roller and anchor
    body.cyl(0.1, 0.1, 0.25, 0, edgeAt(st, bowZ + 0.8).f, bowZ + 0.8, 0x6d7278, 'y', 6);               // windlass
    // the mainsheet traveller, the stern's swim ladder and the dinghy's outboard on the pushpit
    body.box(1.6, 0.05, 0.08, 0, yc + (modern ? 0.02 : 0.33), modern ? wz + 0.6 : cz1 + 0.4, 0x8d9399);
    body.box(0.4, 0.04, 0.3, 0, edgeAt(st, sternZ).f - 0.45, sternZ + 0.15, 0xc0c4c8);
  }
  // the sail cover on the boom (lazy-bag) and the furled genoa on its stay (tinted per boat)
  const cw0 = modern ? 0.26 : 0.21, by = ym + 0.75;
  cover.cyl(cw0, cw0 * 0.55, 3.7, 0, by + 0.16, mz + 1.95, 0xffffff, 'z', near ? 8 : 6);
  cover.rod([0, edgeAt(st, bowZ + 0.3).f + 0.35, bowZ + 0.3], [0, H - (modern ? 0.8 : 1.6), mz - 0.08], 0.1, 0.035, 0xffffff, near ? 6 : 5);
  // fenders alongside (three a side, white), the black ball forward at anchor
  if (near) for (const s of [1, -1]) for (const z of [-2, 0.2, 2.2]) { const e = edgeAt(st, z); fend.cyl(0.11, 0.11, 0.5, s * (e.b + 0.12), e.f - 0.75, z, 0xf4f4f0, 'y', 8); fend.rod([s * (e.b + 0.12), e.f - 0.25, z], [s * (e.b - 0.05), e.f + 0.05, z], 0.006, 0.006, 0x1d3557, 3); }
  ball.box(0.4, 0.4, 0.4, 0, H * 0.45, bowZ * 0.6 + mz * 0.4, 0x111111, 0.6).box(0.4, 0.4, 0.4, 0, H * 0.45 + 0.05, bowZ * 0.6 + mz * 0.4, 0x111111, 1.4);
  return { hull: top.geo(), body: body.geo(), boom: boomP.geo(), cover: cover.geo(), main: sailGeo(H - ym - 1.6, 3.9 + (modern ? 0.4 : 0), modern ? 0.09 : 0.1, false, modern, near), jib: sailGeo(H - (modern ? 2.0 : 3.0), L * (modern ? 0.36 : 0.44), 0.12, true, false, near), fenders: near ? fend.geo() : null, ball: ball.geo(), mainAt: [0, ym + 0.8, mz], jibAt: [0, edgeAt(st, bowZ + 0.3).f + 0.05, bowZ + 0.25], jibAxis: new THREE.Vector3(0, H - (modern ? 0.4 : 1.2) - edgeAt(st, bowZ + 0.3).f, mz - bowZ - 0.25).normalize() };
}
// a sail: luff up the local y axis, foot aft along +z, camber toward +x (the deepest at 40 % of the chord, flatter
// aloft, the leech twisted off); square: a modern square-top main's roach
function sailGeo(luff, foot, depth, jib = false, square = false, fine = true) {
  const nu = fine ? 8 : 4, nv = fine ? 10 : 5, p = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = j / nv, u = i / nu, ch = foot * (jib ? 1 - v : 1 - v * (square ? 0.72 : 0.9) + (square ? 0 : 0.12 * Math.sin(Math.PI * v) * (1 - v)));
    const prof = Math.sin(Math.PI * Math.pow(u, 0.75)), twist = u * u * 0.1 * v;
    const x = depth * ch * prof * (1 - 0.35 * v) + ch * twist, y = luff * v, z = ch * u + (jib ? luff * 0.28 * v : 0);
    p.push(x, y, z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function motorModel(near = true) {
  const T = VESSELS.motor, top = new Acc(), b = new Acc(), fend = new Acc(), L = T.L;
  const st = b.hull(top, L, T.B, 1.35, 0.7, { transom: 0.92, rake: 0.8, sheer: 0.25, fine: 0.55, flat: 0.25, bottom: 0x2b2f38, deck: 0xe8e6e0 });
  b.band(st, 0.18, 0.3, 0x30353b, 0.013);
  if (near) b.band(st, -0.06, 0.0, 0xd6d3cb, -0.02).band(st, 0.45, 0.7, GLASS, 0.013, [-1.5, 2.2]);   // rubbing strake, hull windows
  const yd = edgeAt(st, 0).f - 0.05;
  // the saloon: raked windscreen, dark glass all round; the flybridge on top with its screen, helm and bimini
  b.house([[-1.0, -2.6], [-1.5, -1.4], [-1.55, 2.4], [1.55, 2.4], [1.5, -1.4], [1.0, -2.6]], yd, yd + 1.25, WHITE, { ix: 0.06, iz: 0.12, dz: 0.35, bands: [{ on: 'all', f0: 0.3, f1: 0.88, hex: GLASS, u0: 0.03, u1: 0.97 }] });
  b.house([[-0.85, -0.8], [-1.35, 0.2], [-1.4, 3.0], [1.4, 3.0], [1.35, 0.2], [0.85, -0.8]], yd + 1.25, yd + 1.55, 0xeceae4, { ix: 0.02, iz: 0.02 });
  b.house([[-0.7, -0.6], [-1.0, 0.0], [1.0, 0.0], [0.7, -0.6]], yd + 1.55, yd + 1.95, 0xeceae4, { iz: 0.3, dz: 0.15, bands: [{ on: 'front', f0: 0.45, f1: 0.95, hex: 0x3c4a56 }] });
  b.box(1.9, 0.04, 0.5, 0, yd - 0.1, L / 2 + 0.25, TEAK);                                    // bathing platform
  b.box(2.6, 0.03, 2.6, 0, yd + 0.02, 3.6, TEAK);                                            // cockpit sole
  if (near) {
    railAlong(b, [[1.3, yd - 0.05, -1.4], [1.0, edgeAt(st, -3.8).f, -3.8], [0.35, edgeAt(st, -5.4).f, -5.4]], 0.5, STEEL, 1.1);
    railAlong(b, [[1.3, yd + 1.55, 0.3], [1.3, yd + 1.55, 2.9]], 0.55, STEEL, 0.9);
    for (const z of [1.2, 2.9]) b.poly([[-1.35, yd + 1.55, z], [-1.2, yd + 2.75, z], [1.2, yd + 2.75, z], [1.35, yd + 1.55, z]], 0.025, STEEL, 4);
    b.box(2.5, 0.04, 1.8, 0, yd + 2.77, 2.05, 0x2f3a46);                                     // bimini
    b.box(0.5, 0.18, 0.5, 0, yd + 2.88, 2.05, 0xe8e8e2).box(0.9, 0.08, 0.25, 0, yd + 3.0, 2.05, 0x2a2d31);   // radome / radar on the arch
    b.ring([0.35, yd + 1.95, -0.1], 0.2, 0.015, 0x2c2f33, 'z', 10);
    b.box(0.25, 0.1, 0.4, 0, edgeAt(st, -5.6).f + 0.06, -5.6, 0x8d9399);                     // anchor
    b.cyl(0.05, 0.05, 0.6, 0.5, yd + 1.55, 2.9, 0x2a2d31, 'y', 4);                           // (the ensign staff)
    for (const s of [1, -1]) for (const z of [-2, 0.5, 3]) { const e = edgeAt(st, z); fend.cyl(0.13, 0.13, 0.6, s * (e.b + 0.14), e.f - 0.85, z, 0xf4f4f0, 'y', 8); }
  }
  return { hull: top.geo(), body: b.geo(), fenders: near ? fend.geo() : null };
}
function ribModel(near = true) {
  const T = VESSELS.rib, top = new Acc(), b = new Acc(), L = T.L;
  const st = b.hull(top, L, T.B * 0.82, 0.62, 0.45, { transom: 0.95, rake: 0.6, sheer: 0.3, fine: 0.45, flat: 0.2, bottom: 0x303030, deck: 0x8f969a });
  // the tubes: round the gunwale from the transom to the bow, swept up at the bow
  const P = [];
  for (let i = 0; i <= 12; i++) { const z = L / 2 + 0.2 - (L + 0.1) * i / 12, e = edgeAt(st, Math.max(-L / 2 + 0.3, z)); P.push([e.b + 0.12, e.f + 0.02 + 0.25 * Math.max(0, (-z - L * 0.25) / (L * 0.25)) ** 2, z]); }
  const tube = 0x41464c;
  for (const s of [1, -1]) b.poly(P.map(([x, y, z]) => [s * x, y, z]), 0.24, tube, near ? 8 : 6);
  b.rod([P[12][0], P[12][1], P[12][2]], [-P[12][0], P[12][1], P[12][2]], 0.24, 0.24, tube, near ? 8 : 6);
  b.band(st, 0.0, 0.09, 0xd9572b, 0.36, [-1, 2]);                                            // (a stripe on the tube)
  // console with its screen, the leaning post, the outboard on the transom
  b.house([[-0.45, -0.5], [-0.5, 0.4], [0.5, 0.4], [0.45, -0.5]], 0.5, 1.35, 0xe4e4e0, { iz: 0.25, dz: 0.1 });
  b.box(0.92, 0.35, 0.06, 0, 1.55, -0.38, 0x8fa0ac);
  b.box(0.8, 0.85, 0.5, 0, 0.9, 1.3, 0x2c3034);
  b.box(0.48, 0.75, 0.55, 0, 1.05, L / 2 + 0.25, 0x1d1f22).box(0.18, 0.7, 0.25, 0, 0.35, L / 2 + 0.35, 0x26292c);
  if (near) { b.poly([[-0.5, 1.4, 0.5], [-0.5, 2.3, 1.0], [0.5, 2.3, 1.0], [0.5, 1.4, 0.5]], 0.025, STEEL, 4); b.box(0.15, 0.15, 0.15, 0, 2.38, 1.0, 0xf2f2ee); }
  return { hull: top.geo(), body: b.geo() };
}
function fishingModel() {
  const T = VESSELS.fishing, top = new Acc(), b = new Acc(), L = T.L;
  const st = b.hull(top, L, T.B, 1.9, 1.6, { transom: 0.75, rake: 0.6, sheer: 0.5, fine: 0.6, flat: 0.7, bottom: RUST, deck: 0x8f8a80 });
  b.band(st, -0.65, 0.0, 0xe9e5da, -0.03).band(st, 0.2, 0.32, 0xe9e5da, 0.012);             // bulwarks, a white sheer line
  const yd = edgeAt(st, -2.6).f;
  b.house([[-1.3, -4.3], [-1.6, -3.6], [-1.6, -1.0], [1.6, -1.0], [1.6, -3.6], [1.3, -4.3]], yd, yd + 2.3, WHITE, { ix: 0.04, iz: 0.04, bands: [{ on: 'front', f0: 0.55, f1: 0.85, hex: GLASS, n: 3, gap: 0.04 }, { on: 'side', f0: 0.58, f1: 0.85, hex: GLASS, u0: 0.1, u1: 0.5 }], capHex: 0xd24b2a });
  b.cyl(0.12, 0.1, 5.5, 0, yd + 2.3, -2.6, 0xd8d8d0).box(1.4, 0.06, 0.06, 0, yd + 6.2, -2.6, 0xd8d8d0).box(0.7, 0.25, 0.25, 0, yd + 2.55, -3.4, 0xf0f0ea);
  // the gantry aft, the net drum, two outriggers stowed up
  const ya = edgeAt(st, 4.8).f;
  b.rod([2.1, ya, 4.8], [1.6, ya + 4.2, 5.0], 0.12, 0.1, 0xd8a23a, 5).rod([-2.1, ya, 4.8], [-1.6, ya + 4.2, 5.0], 0.12, 0.1, 0xd8a23a, 5).rod([-1.7, ya + 4.1, 5.0], [1.7, ya + 4.1, 5.0], 0.12, 0.12, 0xd8a23a, 5);
  b.cyl(0.7, 0.7, 2.2, 0, yd + 0.8, 2.0, 0x3a6b44, 'z', 8);
  for (const s of [1, -1]) b.rod([s * 0.3, yd + 2.4, -1.4], [s * 2.3, yd + 7.5, -0.6], 0.06, 0.04, 0xbfc3c6, 4);
  for (const s of [1, -1]) b.cyl(0.25, 0.25, 0.4, s * 1.9, yd + 0.4, -1.5, 0xe86a2a, 'y', 6);   // (buoys and fish boxes on deck)
  const ball = new Acc(); ball.box(0.6, 0.6, 0.6, 0, yd + 5.4, -2.6, 0x111111, 0.6).box(0.6, 0.6, 0.6, 0, yd + 5.45, -2.6, 0x111111, 1.4);
  return { hull: top.geo(), body: b.geo(), ball: ball.geo() };
}
// a passenger ferry (monohull) or a fast catamaran: decks of windows, a bridge with wings, a funnel or exhausts
function ferryModel(fast) {
  const T = fast ? VESSELS.fastcat : VESSELS.ferry, top = new Acc(), b = new Acc(), L = T.L, B = T.B;
  let st;
  if (fast) {
    for (const sx of [-1, 1]) { const h = new Acc(), ht = new Acc(); h.hull(ht, L, 2.6, 2.2, 1.3, { transom: 0.9, rake: 0.3, fine: 0.9, sheer: 0.1, bottom: 0x2a2d31 }); const g1 = h.geo(), g2 = ht.geo(); g1.translate(sx * 4.2, 0, 0); g2.translate(sx * 4.2, 0, 0); top.merge = (top.merge || []).concat(g2); b.merge = (b.merge || []).concat(g1); }
    b.house([[-B * 0.3, -L * 0.47], [-B / 2, -L * 0.36], [-B / 2, L * 0.47], [B / 2, L * 0.47], [B / 2, -L * 0.36], [B * 0.3, -L * 0.47]], 1.9, 2.8, 0xdadcd8, { cap: true });
  } else {
    st = b.hull(top, L, B, 2.4, 1.8, { transom: 0.85, rake: 0.5, fine: 0.6, sheer: 0.12, bottom: RUST, deck: 0xb8b8b0 });
    b.band(st, 0.5, 0.75, 0x30353b, 0.02);
  }
  const d0 = fast ? 2.8 : 2.4, hw = B * 0.46;
  // main deck saloon: rounded front, a band of windows all round; the upper deck saloon; the bridge forward on top
  b.house([[-hw * 0.55, -L * 0.36], [-hw, -L * 0.24], [-hw, L * 0.37], [hw, L * 0.37], [hw, -L * 0.24], [hw * 0.55, -L * 0.36]], d0, d0 + 2.4, WHITE, { ix: 0.02, iz: 0.02, dz: 0.4, bands: [{ on: 'all', f0: 0.35, f1: 0.8, hex: GLASS, n: 9, gap: 0.012, min: 3 }] });
  b.house([[-hw * 0.5, -L * 0.24], [-hw * 0.88, -L * 0.14], [-hw * 0.88, L * 0.28], [hw * 0.88, L * 0.28], [hw * 0.88, -L * 0.14], [hw * 0.5, -L * 0.24]], d0 + 2.4, d0 + 4.5, WHITE, { ix: 0.03, iz: 0.03, dz: 0.3, bands: [{ on: 'all', f0: 0.3, f1: 0.8, hex: GLASS, n: 7, gap: 0.015, min: 3 }] });
  b.house([[-hw * 0.4, -L * 0.17], [-hw * 0.55, -L * 0.1], [-hw * 0.55, -L * 0.02], [hw * 0.55, -L * 0.02], [hw * 0.55, -L * 0.1], [hw * 0.4, -L * 0.17]], d0 + 4.5, d0 + 6.3, WHITE, { iz: 0.05, dz: 0.25, bands: [{ on: 'front', f0: 0.45, f1: 0.88, hex: GLASS, n: 3, gap: 0.03 }, { on: 'side', f0: 0.45, f1: 0.88, hex: GLASS }] });
  b.box(B * 0.98, 0.25, 2.0, 0, d0 + 5.0, -L * 0.07, WHITE);                                        // bridge wings
  // the funnel (yellow-topped by default, tinted by the hull colour band below it) and the mast
  b.house([[-1.0, L * 0.12], [-1.1, L * 0.2], [1.1, L * 0.2], [1.0, L * 0.12]], d0 + 4.5, d0 + 7.4, 0xf2f2ee, { ix: 0.15, iz: 0.12, dz: 0.5, bands: [{ on: 'all', f0: 0.72, f1: 1.0, hex: 0x1d1f22, out: 1 }], capHex: 0x1d1f22 });
  b.cyl(0.1, 0.07, 4.2, 0, d0 + 6.3, -L * 0.1, STEEL).box(1.4, 0.08, 0.08, 0, d0 + 9.4, -L * 0.1, STEEL).box(0.6, 0.1, 0.6, 0, d0 + 6.4, -L * 0.05, 0xe8e8e2);
  // rails on the upper deck and the bow, liferaft canisters along the upper deck
  railAlong(b, [[hw * 0.88, d0 + 4.5, -L * 0.14], [hw * 0.88, d0 + 4.5, L * 0.3]], 1.0, 0xe8e8e2, 1.6);
  railAlong(b, [[hw * 0.9, d0, -L * 0.37], [hw * 0.35, d0, -L * 0.46]], 1.0, 0xe8e8e2, 1.6);
  for (const s of [1, -1]) for (let k = 0; k < 4; k++) b.cyl(0.35, 0.35, 1.3, s * hw * 0.78, d0 + 4.85, L * 0.05 + k * 1.6, 0xf2f2ee, 'z', 6);
  return { hull: top.geo(), body: merge([b.geo(), ...(b.merge || [])]), hullExtra: top.merge };
}
function carFerryModel() {
  const T = VESSELS.carferry, top = new Acc(), b = new Acc(), L = T.L, B = T.B;
  const st = b.hull(top, L, B, 4.2, 3.4, { transom: 0.92, rake: 0.3, fine: 0.5, sheer: 0.08, flat: 0.8, bottom: RUST, deck: 0x8e9296 });
  b.band(st, 0.7, 1.0, 0x30353b, 0.03);
  // the vehicle deck: a closed white box over the hull, its stern door dark; above it the passenger decks
  b.house([[-B * 0.4, -L * 0.45], [-B * 0.49, -L * 0.36], [-B * 0.49, L * 0.47], [B * 0.49, L * 0.47], [B * 0.49, -L * 0.36], [B * 0.4, -L * 0.45]], 4.0, 9.2, 0xf4f4f0, { bands: [{ on: 'side', f0: 0.55, f1: 0.75, hex: GLASS, n: 12, gap: 0.03, u0: 0.05, u1: 0.95 }, { on: 'back', f0: 0.05, f1: 0.85, hex: 0x3b3f44, u0: 0.25, u1: 0.75 }] });
  b.house([[-B * 0.32, -L * 0.33], [-B * 0.46, -L * 0.24], [-B * 0.46, L * 0.3], [B * 0.46, L * 0.3], [B * 0.46, -L * 0.24], [B * 0.32, -L * 0.33]], 9.2, 12.4, WHITE, { ix: 0.02, dz: 0.6, bands: [{ on: 'all', f0: 0.3, f1: 0.8, hex: GLASS, n: 14, gap: 0.01, min: 4 }] });
  b.house([[-B * 0.3, -L * 0.27], [-B * 0.4, -L * 0.2], [-B * 0.4, -L * 0.13], [B * 0.4, -L * 0.13], [B * 0.4, -L * 0.2], [B * 0.3, -L * 0.27]], 12.4, 15.0, WHITE, { iz: 0.05, dz: 0.4, bands: [{ on: 'front', f0: 0.45, f1: 0.9, hex: GLASS, n: 5, gap: 0.02 }, { on: 'side', f0: 0.45, f1: 0.9, hex: GLASS }] });
  b.box(B * 1.0, 0.3, 2.6, 0, 13.6, -L * 0.165, WHITE);                                             // bridge wings
  // twin funnels aft, lifeboats on davits each side, the mast and radars over the bridge
  for (const s of [1, -1]) b.house([[s * 2.4, L * 0.16], [s * 2.4, L * 0.25], [s * 4.8, L * 0.25], [s * 4.8, L * 0.16]], 12.4, 19.5, 0xf4f4f0, { ix: 0.12, iz: 0.1, dz: 0.8, bands: [{ on: 'all', f0: 0.8, f1: 1.0, hex: 0x1d1f22 }], capHex: 0x1d1f22 });
  for (const s of [1, -1]) for (const z of [-L * 0.05, L * 0.05, L * 0.15]) b.cyl(1.1, 1.1, 6.5, s * B * 0.47, 10.6, z, 0xe8702a, 'z', 8);
  b.cyl(0.15, 0.1, 6, 0, 15.0, -L * 0.18, STEEL).box(3.5, 0.12, 0.3, 0, 18.5, -L * 0.18, 0x2a2d31).box(2.4, 0.1, 0.25, 0, 16.6, -L * 0.15, 0x2a2d31);
  railAlong(b, [[B * 0.46, 12.4, -L * 0.13], [B * 0.46, 12.4, L * 0.3]], 1.1, 0xe8e8e2, 2.0);
  const ball = new Acc(); ball.box(1.2, 1.2, 1.2, 0, 21, -L * 0.18, 0x111111, 0.6).box(1.2, 1.2, 1.2, 0, 21.1, -L * 0.18, 0x111111, 1.4);
  return { hull: top.geo(), body: b.geo(), ball: ball.geo() };
}
function chainModel() {
  const T = VESSELS.chain, top = new Acc(), b = new Acc();
  b.box(T.B, 1.4, T.L * 0.75, 0, 0.3, 0, 0x5a6168);
  top.box(T.B + 0.1, 0.9, T.L * 0.76, 0, 0.8, 0, 0xffffff);
  b.box(T.B * 0.9, 0.3, T.L * 0.13, 0, 0.9, -T.L * 0.42, 0x6d7278, 1).box(T.B * 0.9, 0.3, T.L * 0.13, 0, 0.9, T.L * 0.42, 0x6d7278, 1);
  b.box(T.B * 0.55, 0.05, T.L * 0.74, 0, 1.26, 0, 0x3f4247);                                      // (the vehicle lanes)
  for (const sx of [-1, 1]) {
    b.house([[sx * (T.B / 2 - 2.4), -4], [sx * (T.B / 2 - 2.4), 4], [sx * T.B / 2, 4], [sx * T.B / 2, -4]], 1.25, 5.6, WHITE, { bands: [{ on: 'all', f0: 0.55, f1: 0.85, hex: GLASS, n: 3, gap: 0.04, min: 2 }] });
    railAlong(b, [[sx * (T.B / 2 - 0.2), 1.25, -T.L * 0.36], [sx * (T.B / 2 - 0.2), 1.25, T.L * 0.36]], 1.0, 0xe2c23a, 1.8, false);
  }
  return { hull: top.geo(), body: b.geo() };
}
// a feeder container ship: a forecastle with its bulwark, rows of containers (each 2.44 m box its own colour, the
// stacks of uneven height), the house aft with its bridge windows and wings, the funnel, a mast forward
function shipModel() {
  const T = VESSELS.ship, top = new Acc(), b = new Acc(), L = T.L, B = T.B;
  const st = b.hull(top, L, B, 6, 6.5, { transom: 0.9, rake: 0.5, fine: 0.45, sheer: 0.1, flat: 0.95, bottom: RUST, boot: RUST, deck: 0x6c6f66 });
  b.band(st, -1.4, 0.0, 0x2b2f36, -0.05, [-L * 0.5, -L * 0.36]);                                   // the forecastle bulwark
  b.band(st, 0.6, 1.0, 0xe8e8e2, 0.03, [-L * 0.5, -L * 0.42]);
  const cols = [0xb03a2e, 0x2e6fa7, 0x3c8d5a, 0xd4a13a, 0x8a8f96, 0x6b3f8a, 0xc9c9c2, 0x1d3557, 0x7a1f1f, 0xe2e2dc, 0x4a6b7a, 0xb86a2a];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = 7, w = (B * 0.88) / rows;
  for (let k = 0; k < 9; k++) {
    const zc = -L * 0.34 + k * 11.8, tiers = 2 + Math.floor(rnd() * 3);
    b.box(B * 0.9, 0.5, 11.2, 0, 6.6, zc, 0x5d6168);                                              // hatch cover
    for (let rI = 0; rI < rows; rI++) {
      const n = Math.max(0, tiers - (rI === 0 || rI === rows - 1 ? (rnd() < 0.5 ? 1 : 0) : 0) - (rnd() < 0.15 ? 1 : 0));
      for (let tI = 0; tI < n; tI++) b.box(w * 0.97, 2.55, 11.0 * (rnd() < 0.2 ? 0.48 : 0.98), -B * 0.44 + w * (rI + 0.5), 6.85 + 1.28 + tI * 2.6, zc, cols[Math.floor(rnd() * cols.length)]);
    }
  }
  const zh = L * 0.4, yd = 6;
  b.house([[-B * 0.42, zh - 6], [-B * 0.46, zh + 6], [B * 0.46, zh + 6], [B * 0.42, zh - 6]], yd, yd + 13, WHITE, { bands: [{ on: 'front', f0: 0.2, f1: 0.25, hex: GLASS, n: 8, gap: 0.04 }, { on: 'front', f0: 0.43, f1: 0.48, hex: GLASS, n: 8, gap: 0.04 }, { on: 'front', f0: 0.66, f1: 0.71, hex: GLASS, n: 8, gap: 0.04 }, { on: 'side', f0: 0.43, f1: 0.48, hex: GLASS, n: 4, gap: 0.08 }] });
  b.house([[-B * 0.45, zh - 6.6], [-B * 0.45, zh - 2.5], [B * 0.45, zh - 2.5], [B * 0.45, zh - 6.6]], yd + 13, yd + 15.6, WHITE, { bands: [{ on: 'front', f0: 0.3, f1: 0.85, hex: GLASS, n: 10, gap: 0.01 }, { on: 'side', f0: 0.3, f1: 0.85, hex: GLASS }] });
  b.box(B * 1.08, 0.4, 3.0, 0, yd + 13.2, zh - 5.0, WHITE);                                          // bridge wings
  b.house([[-2.2, zh + 1], [-2.5, zh + 6.5], [2.5, zh + 6.5], [2.2, zh + 1]], yd + 13, yd + 21, 0x2b2f36, { ix: 0.1, iz: 0.1, dz: 0.6, bands: [{ on: 'all', f0: 0.55, f1: 0.75, hex: 0xd0d2d4 }] });
  b.cyl(0.2, 0.15, 5, 0, yd + 15.6, zh - 4.6, STEEL).box(4.0, 0.15, 0.35, 0, yd + 19.5, zh - 4.6, 0x2a2d31).box(3.0, 0.12, 0.3, 0, yd + 18.0, zh - 3.8, 0x2a2d31);
  b.cyl(0.35, 0.25, 9, 0, yd + 1, -L * 0.4, 0xe6c84a);                                              // foremast
  b.cyl(1.3, 1.3, 6.5, 0, yd + 7.5, L * 0.47, 0xe8702a, 'z', 8);                                    // free-fall lifeboat
  railAlong(b, [[B * 0.45, yd + 13, zh - 6.6], [B * 0.45, yd + 13, zh + 6]], 1.0, 0xe8e8e2, 2.0);
  const ball = new Acc(); ball.box(1.4, 1.4, 1.4, 0, yd + 10.5, -L * 0.4, 0x111111, 0.6).box(1.4, 1.4, 1.4, 0, yd + 10.6, -L * 0.4, 0x111111, 1.4);
  return { hull: top.geo(), body: b.geo(), ball: ball.geo() };
}
function merge(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const g of list) {
    const gp = g.attributes.position.array, gc = g.attributes.color ? g.attributes.color.array : null;
    pos.set(gp, o * 3); if (gc) col.set(gc, o * 3); else col.fill(1, o * 3, o * 3 + gp.length);
    const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx.push(gi[i] + o);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('color', new THREE.BufferAttribute(col, 3)); m.setIndex(idx); m.computeVertexNormals();
  return m;
}
// the models by draw key (see keyOf): { far: parts, near: parts | null }
let MODELS = null;
function models() {
  if (MODELS) return MODELS;
  const f = ferryModel(false), fc = ferryModel(true);
  if (fc.hullExtra) fc.hull = merge([fc.hull, ...fc.hullExtra]);
  MODELS = {
    yacht0: { far: yachtModel(0, false), near: yachtModel(0, true) }, yacht1: { far: yachtModel(1, false), near: yachtModel(1, true) },
    motor: { far: motorModel(false), near: motorModel(true) }, rib: { far: ribModel(false), near: ribModel(true) },
    fishing: { far: fishingModel() }, ferry: { far: f }, fastcat: { far: fc }, carferry: { far: carFerryModel() }, chain: { far: chainModel() }, ship: { far: shipModel() },
  };
  return MODELS;
}
// which model a vessel is drawn with (the yachts in two designs)
const keyOf = (v) => (v.type === 'yacht' ? 'yacht' + (v.seed > 0.58 ? 1 : 0) : v.type);
// canvas: sail covers, sprayhoods' cover colours; sails: white Dacron, cream, grey laminate
const CANVAS = [0x1d3f6e, 0x1d3f6e, 0x23324c, 0x7a1f2b, 0x2e5e4e, 0x5b6168, 0xc9b98f, 0x16191d];
const SAILC = [0xf3f0e6, 0xf3f0e6, 0xece6d4, 0xf6f6f2, 0x9aa0a6, 0x5c6066];

// nav lights in the model frame (base size): [x, y, z, kind]. kind: 'mh' masthead (225 deg ahead), 'port',
// 'stbd' (112.5 deg each side), 'stern' (135 deg astern), 'all' (all round), 'green' / 'red' all round
function lightsFor(v) {
  const T = v.T, L = T.L, B = T.B, H = T.H, f = { yacht: 1.1, motor: 1.4, rib: 0.8, fishing: 2, ferry: 2.6, fastcat: 3, carferry: 4.5, chain: 1.3, ship: 6.2 }[v.type];
  const out = [];
  if (v.mode === 'berth') return v.seed < 0.3 ? [[0, f + 0.7, 0, 'cabin']] : out;
  if (v.mode === 'mooring') return v.seed < 0.5 ? [[0, H, -L * 0.08, 'all']] : out;
  if (v.mode === 'anchor') return v.type === 'ship' ? [[0, f + 9, -L * 0.46, 'all'], [0, f + 5, L * 0.46, 'all'], [B * 0.5, f + 1, -L * 0.2, 'deck'], [-B * 0.5, f + 1, L * 0.1, 'deck'], [B * 0.5, f + 9, L * 0.36, 'deck'], [-B * 0.5, f + 9, L * 0.36, 'deck']] : [[0, H, -L * 0.08, 'all']];
  if (v.hidden) return out;
  const sy = f + (L > 30 ? 1.2 : 0.3);                        // (on a ship, out on the bridge wings)
  out.push([B * 0.53, sy, -L * 0.3, 'stbd'], [-B * 0.53, sy, -L * 0.3, 'port'], [0, f + 0.4, L * 0.5 + 0.1, 'stern']);
  if (v.type === 'yacht') { if (!v.sails) out.push([0, H * 0.55, -L * 0.08, 'mh']); return out; }
  if (v.type === 'fishing' && v.fishing) out.push([0, H + 0.4, -L * 0.15, 'green'], [0, H - 0.6, -L * 0.15, 'all']);
  out.push([0, H, -L * 0.2, 'mh']);
  if (L > 50) out.push([0, H * 0.7, -L * 0.42, 'mh']);
  // the saloon windows, lit along both sides
  if (v.type === 'ferry' || v.type === 'carferry' || v.type === 'fastcat') for (const sx of [-1, 1]) for (const z of [-0.2, 0, 0.2]) out.push([sx * B * 0.48, f + 1.4, L * z, 'deck']);
  return out;
}
const LCOL = { mh: [1, 0.96, 0.88], stern: [1, 0.96, 0.88], all: [1, 0.96, 0.88], stbd: [0.2, 1, 0.45], port: [1, 0.15, 0.1], green: [0.2, 1, 0.45], red: [1, 0.15, 0.1], cabin: [1, 0.68, 0.32], deck: [1, 0.85, 0.6] };
const LSIZE = { mh: 1, stern: 0.9, all: 0.9, stbd: 1, port: 1, green: 0.9, red: 0.9, cabin: 0.7, deck: 1.6 };


// ------------------------------------------------------------------ the view
const PARTS = ['hull', 'body', 'boom', 'cover', 'main', 'jib', 'fenders', 'ball'];
export class TrafficView {
  // opts.low: a weak GPU (?q=low): fewer boats drawn in full detail, and only close by
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'traffic';
    scene.add(this.group);
    this.traffic = null;
    this.low = !!opts.low;
    // the near level: within R metres, at most cap boats of a kind (the nearest); the rest drawn with the far model
    this.nearR = this.low ? 110 : 320; this.nearCap = this.low ? 20 : 150;
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh || o.isPoints || o.isLineSegments) { if (o.geometry && !o.userData.shared) o.geometry.dispose(); } });
  }
  // instanced meshes of one model's parts, n instances
  _parts(m, n, type) {
    const parts = {};
    for (const k of PARTS) {
      if (!m[k]) continue;
      const mesh = new THREE.InstancedMesh(m[k], k === 'main' || k === 'jib' ? this.mat.sail : k === 'hull' ? this.mat.hull : k === 'cover' ? this.mat.cover : this.mat.body, n);
      mesh.frustumCulled = false; mesh.userData.shared = true;
      mesh.castShadow = type !== 'ship' && type !== 'carferry'; mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh); parts[k] = mesh;
    }
    return parts;
  }
  _colour(parts, i, v) {
    const col = this._col;
    if (parts.hull) parts.hull.setColorAt(i, col.setHex(v.color));
    if (parts.cover) parts.cover.setColorAt(i, col.setHex(v.canvas));
    if (parts.main) { col.setHex(v.sailCol); parts.main.setColorAt(i, col); parts.jib.setColorAt(i, col); }
  }
  setTraffic(traffic) {
    this.group.clear();
    this.traffic = traffic; this.meshes = {};
    if (!traffic || !traffic.vessels.length) return;
    const M = models(), byKey = {};
    for (const v of traffic.vessels) {
      (byKey[keyOf(v)] || (byKey[keyOf(v)] = [])).push(v);
      // (a boat's own canvas and sails, from her seed: the same boat the same colours every time)
      v.canvas = CANVAS[Math.floor(v.seed * 977) % CANVAS.length]; v.sailCol = SAILC[Math.floor(v.seed * 613) % SAILC.length];
      v._near = false;
    }
    this.mat = this.mat || {
      // (both sides: the lofted topsides are wound inward — drawn one-sided they were culled, and every hull showed
      // as its deck and keel floating over the water)
      hull: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.02, side: THREE.DoubleSide }),
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
      cover: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
      sail: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide }),
    };
    this._col = new THREE.Color();
    for (const key in byKey) {
      const list = byKey[key], m = M[key], type = list[0].type;
      const far = this._parts(m.far, list.length, type);
      list.forEach((v, i) => this._colour(far, i, v));
      for (const k in far) if (far[k].instanceColor) far[k].instanceColor.needsUpdate = true;
      let near = null, cap = 0;
      if (m.near) { cap = Math.min(list.length, this.nearCap); near = this._parts(m.near, cap, type); for (const k in near) near[k].count = 0; }
      this.meshes[key] = { list, far, near, cap, nearList: [], mf: m.far, mn: m.near };
    }
    // lights
    const nl = traffic.vessels.length * 12;
    this.lightCap = nl;
    const lg = new THREE.BufferGeometry();
    this.lPos = new Float32Array(nl * 3); this.lCol = new Float32Array(nl * 3); this.lSize = new Float32Array(nl);
    lg.setAttribute('position', new THREE.BufferAttribute(this.lPos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lCol, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('size', new THREE.BufferAttribute(this.lSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.lightMat = this.lightMat || new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 500 }, uOn: { value: 0 } },
      vertexShader: `attribute float size; attribute vec3 color; uniform float uScale; uniform float uOn; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          // a point of light stays a point far away (the eye sees a lamp miles off), dimmed by haze
          vC = color * uOn * exp(-d * 0.00012); gl_PointSize = clamp(size * 2.2 * uScale / d, 3.5, 14.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard;
        float a = exp(-r * 7.0) * 1.4 + 0.35 * exp(-r * 1.5); gl_FragColor = vec4(vC * a * 2.2, 1.0); }`,
    });
    this.lights = new THREE.Points(lg, this.lightMat); this.lights.frustumCulled = false; this.lights.renderOrder = 5;
    this.group.add(this.lights);
    // wakes behind (WN crumbs a mover) and bow waves along the hull (BN stations)
    const WN = 22, BN = 6, nm = traffic.movers.length;
    this.WN = WN; this.BN = BN;
    const ribbons = (n, per) => {
      const g = new THREE.BufferGeometry(), pos = new Float32Array(n * per * 2 * 3), al = new Float32Array(n * per * 2), across = new Float32Array(n * per * 2), idx = [];
      for (let m = 0; m < n; m++) for (let i = 0; i < per; i++) {
        const a = (m * per + i) * 2; across[a] = 0; across[a + 1] = 1;
        if (i < per - 1) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('alpha', new THREE.BufferAttribute(al, 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('across', new THREE.BufferAttribute(across, 1)); g.setIndex(idx);
      return g;
    };
    const wg = ribbons(nm, WN), bg = ribbons(nm, BN);
    this.wPos = wg.attributes.position.array; this.wA = wg.attributes.alpha.array;
    this.bPos = bg.attributes.position.array; this.bA = bg.attributes.alpha.array;
    this.wakeMat = this.wakeMat || new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uT: { value: 0 }, uLight: { value: 1 } },
      vertexShader: `attribute float alpha; attribute float across; varying float vA; varying float vX; varying vec2 vW;
        void main(){ vA = alpha; vX = across; vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT; uniform float uLight; varying float vA; varying float vX; varying vec2 vW;
        float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
        void main(){
          // the two arms of the Kelvin wedge and the churned water between them
          float e = abs(vX * 2.0 - 1.0), arm = smoothstep(0.55, 0.95, e) * (1.0 - smoothstep(0.95, 1.0, e)), mid = 1.0 - smoothstep(0.0, 0.45, e);
          float n = fn(vW * 1.3 + uT * 0.2) * 0.6 + fn(vW * 4.1 - uT * 0.3) * 0.4;
          float f = clamp(vA * (arm * 0.9 + mid * 1.1) * smoothstep(0.25, 0.75, n + vA * 0.3), 0.0, 0.85);
          if (f < 0.01) discard;
          gl_FragColor = vec4(vec3(0.93, 0.96, 0.98) * uLight, f * 0.75); }`,
    });
    this.wakes = new THREE.Mesh(wg, this.wakeMat); this.wakes.frustumCulled = false; this.wakes.renderOrder = 2;
    this.bows = new THREE.Mesh(bg, this.wakeMat); this.bows.frustumCulled = false; this.bows.renderOrder = 2;
    this.group.add(this.wakes, this.bows);
    this.crumbs = traffic.movers.map(() => []);
    // mooring buoys (a white pick-up buoy off the bow of every boat on a swing mooring) and the lines to them: the
    // pendant to the buoy, an anchored boat's rode down into the water ahead
    this.moored = traffic.vessels.filter(v => v.mode === 'mooring' || v.mode === 'anchor');
    const nb = this.moored.filter(v => v.mode === 'mooring').length;
    this.buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 7), new THREE.MeshStandardMaterial({ color: 0xf0eee6, roughness: 0.5 }), Math.max(1, nb));
    this.buoys.count = nb; this.buoys.frustumCulled = false; this.buoys.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const lgeo = new THREE.BufferGeometry(); this.rPos = new Float32Array(this.moored.length * 2 * 3);
    lgeo.setAttribute('position', new THREE.BufferAttribute(this.rPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rodes = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({ color: 0x3b3f44 })); this.rodes.frustumCulled = false;
    this.group.add(this.buoys, this.rodes);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._m2 = new THREE.Matrix4(); this._m3 = new THREE.Matrix4(); this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.waveT = -1;
  }
  // the few biggest wave components (for the wakes' ribbons: cheap)
  _waves(env) {
    const W = env.waves, list = W.comps.map(c => ({ A: c.A * (c.curAmp ?? 1), k: c.kRef ?? c.k, w: c.omegaEff ?? c.omega, dx: c.dx, dz: c.dz, ph: c.phase })).filter(c => c.A > 0.005).sort((a, b) => b.A - a.A).slice(0, 6);
    this.wv = list;
  }
  // (keep: what of each wave the water grid draws there, render.js seaKeepAt)
  _cheap(x, z, t, sc, o, keep = null) {
    let h = 0, sx = 0, sz = 0;
    for (const c of this.wv) { const A = keep ? c.A * keep(c.k) : c.A, th = c.k * (c.dx * x + c.dz * z) - c.w * t + c.ph, C = Math.cos(th), S = Math.sin(th); h += A * S; sx += A * c.k * c.dx * C; sz += A * c.k * c.dz * C; }
    o.h = h * sc; o.sx = sx * sc; o.sz = sz * sc;
    return o;
  }
  // one vessel's parts at instance i (m: her matrix; M: the model's anchor points for the sails)
  _write(parts, i, v, m, M) {
    if (!m) { for (const k in parts) parts[k].setMatrixAt(i, this._zero); return; }
    parts.hull.setMatrixAt(i, m); parts.body.setMatrixAt(i, m);
    if (parts.fenders) parts.fenders.setMatrixAt(i, v.mode === 'berth' ? m : this._zero);
    if (parts.ball) parts.ball.setMatrixAt(i, v.mode === 'anchor' ? m : this._zero);
    if (!parts.cover) return;
    parts.cover.setMatrixAt(i, v.sails ? this._zero : m);
    if (v.sails) {
      const side = -Math.sign(v.twa || 1);                      // leeward: + = starboard
      this._m2.makeRotationY(side * -v.boom); this._m2.setPosition(M.mainAt[0], M.mainAt[1], M.mainAt[2]);
      this._m3.makeScale(side, 1, 1); this._m2.multiply(this._m3);
      parts.main.setMatrixAt(i, this._m3.multiplyMatrices(m, this._m2));
      if (parts.boom) parts.boom.setMatrixAt(i, this._m3);       // (the boom out with the main: it stayed on the centreline)
      // (the jib turns about its stay)
      this._m2.makeRotationAxis(M.jibAxis, side * -Math.min(0.62, v.boom * 0.75)); this._m2.setPosition(M.jibAt[0], M.jibAt[1], M.jibAt[2]);
      this._m3.makeScale(side, 1, 1); this._m2.multiply(this._m3);
      parts.jib.setMatrixAt(i, this._m3.multiplyMatrices(m, this._m2));
    } else {
      parts.main.setMatrixAt(i, this._zero); parts.jib.setMatrixAt(i, this._zero);
      if (parts.boom) { this._m2.makeTranslation(M.mainAt[0], M.mainAt[1], M.mainAt[2]); parts.boom.setMatrixAt(i, this._m3.multiplyMatrices(m, this._m2)); }
    }
  }
  // per frame. env: Environment; cam: the camera (THREE); night 0..1; renderer height (px) for the lights.
  // seaKeep(x, z) (set by main.js: render.js seaKeepAt): what the water grid draws of each wave there
  update(dt, t, env, cam, night, px) {
    const T = this.traffic; if (!T || !this.meshes) return;
    if (!this.wv || Math.abs(t - this.waveT) > 1) { this._waves(env); this.waveT = t; }
    const cx = cam.position.x, cz = cam.position.z, wo = this._wo || (this._wo = {});
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    let idx = 0;
    const fr = this.frameN = (this.frameN || 0) + 1;
    // pose of every vessel: the sea under it as it is drawn, the hull's mean of it over its length and beam
    // (WaveField.ride: a ship spans the short waves and rides the swell), its own heel and trim. The sea is
    // looked at every frame near the camera, every third or sixth far off (where only the long waves are drawn);
    // a vessel under way is moved every frame all the same.
    // (It was the sea's point value at the bow-to-stern middle, times one factor for the hull's length, of the
    // whole sea near the camera but of six waves elsewhere — waves the grid does not draw far off: the far boats
    // bobbed on a glassy sea, a ship sat at 40 % of a swell's trough, lifted clear of it, and a boat popped between
    // the two as it came within 350 m. And the far ones' positions were only updated with their sea.)
    for (const v of T.vessels) {
      const d = Math.hypot(v.x - cx, v.z - cz);
      v._d = d; idx++;
      const moving = v.mode !== 'berth';
      if (v.mode === 'berth' && d > 1500 && v._posed) continue;           // (far off in a marina: leave it)
      // (the hundreds alongside in a marina, in its sheltered water: every frame only close by)
      if (v._posed && (d > 2500 || (d > 1200 ? (fr + idx) % 6 : d > (moving ? 400 : 150) ? (fr + idx) % 3 : 0))) { if (moving) v._dirty = true; continue; }
      if (env.wavesOn) env.waves.ride(v.x, v.z, t, v.psi, v.L, v.B, this.seaKeep ? this.seaKeep(v.x, v.z) : null, wo);
      else { wo.h = 0; wo.al = 0; wo.at = 0; }
      v.heave = wo.h;
      v.pitch = Math.atan(wo.al) + (v.trim || 0);
      v.roll = -Math.atan(wo.at) + (v.heel || 0);
      v._posed = true; v._dirty = true;
    }
    // the near level: the nearest boats of each kind within reach (looked at four times a second; a boat leaves it
    // 15 % further out than she comes in, so none flickers between the two at the edge)
    const pick = fr % 15 === 1;
    for (const key in this.meshes) {
      const G = this.meshes[key];
      if (!G.near || !pick) continue;
      const R = this.nearR, want = G.list.filter(v => !v.hidden && v._d < R * (v._near ? 1.15 : 1)).sort((a, b) => a._d - b._d).slice(0, G.cap);
      const was = new Set(G.nearList), now = new Set(want);
      for (const v of G.nearList) if (!now.has(v)) { v._near = false; v._dirty = true; }
      for (const v of want) if (!was.has(v)) { v._near = true; v._dirty = true; }
      G.nearList = want; G.pickN = fr;
      want.forEach((v, j) => this._colour(G.near, j, v));
      for (const k in G.near) { G.near[k].count = want.length; if (G.near[k].instanceColor) G.near[k].instanceColor.needsUpdate = true; }
    }
    // instance matrices
    for (const key in this.meshes) {
      const G = this.meshes[key], { list, far } = G;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v._dirty && !!v._hid === !!v.hidden) continue;
        v._dirty = false;
        if (v.hidden) { this._write(far, i, v, null); v._hid = true; continue; }
        v._hid = false;
        e.set(v.pitch, -v.psi, -v.roll); q.setFromEuler(e); p.set(v.x, v.heave, v.z); s.setScalar(v.scale);
        m.compose(p, q, s); (v._mat || (v._mat = new THREE.Matrix4())).copy(m); v._nw = fr;
        this._write(far, i, v, v._near ? null : m, G.mf);
      }
      for (const k in far) far[k].instanceMatrix.needsUpdate = true;
      if (G.near) {
        // (only the boats that moved, or all when the set was picked anew: a marina's berthed boats stand still)
        const all = G.pickN === fr;
        G.nearList.forEach((v, j) => { if (all || v._nw === fr || v.hidden) this._write(G.near, j, v, v.hidden ? null : v._mat || null, G.mn); });
        for (const k in G.near) G.near[k].instanceMatrix.needsUpdate = true;
      }
    }
    this._updateMoorings(cx, cz);
    this._updateWakes(dt, t, cx, cz, night, env);
    this._updateLights(cx, cz, night, px, cam);
  }
  // the buoy a boat lies to, 2.5 m off her stem, and the pendant up to her bow (an anchored one's rode down ahead)
  _updateMoorings(cx, cz) {
    const B = this.buoys, P = this.rPos, m = this._m, vv = this._vv2 || (this._vv2 = new THREE.Vector3());
    let ib = 0, il = 0;
    for (const v of this.moored) {
      const near = v._d < 700 && v._mat;
      const fx = Math.sin(v.psi), fz = -Math.cos(v.psi), bow = v.L * 0.5 + 0.2;
      if (v.mode === 'mooring') {
        if (near) { m.makeTranslation(v.x + fx * (bow + 2.5), v.heave + 0.12, v.z + fz * (bow + 2.5)); B.setMatrixAt(ib, m); } else B.setMatrixAt(ib, this._zero);
        ib++;
      }
      if (near) {
        vv.set(0, v.T.H * 0 + (v.type === 'ship' ? 6 : 1.1), -v.T.L * 0.5 + 0.15).applyMatrix4(v._mat);
        const far = v.mode === 'mooring' ? bow + 2.5 : bow + (v.type === 'ship' ? 18 : 5);
        P[il++] = vv.x; P[il++] = vv.y; P[il++] = vv.z;
        P[il++] = v.x + fx * far; P[il++] = v.heave + (v.mode === 'mooring' ? 0.3 : -0.4); P[il++] = v.z + fz * far;
      } else { for (let k = 0; k < 6; k++) P[il++] = 0; }
    }
    B.instanceMatrix.needsUpdate = true;
    this.rodes.geometry.attributes.position.needsUpdate = true;
  }
  // the sea as it is drawn at (x, z) (WaveField.ride at a point with the grid's keep): the wakes lie on it
  _seaH(env, x, z, t) { return env.wavesOn ? env.waves.ride(x, z, t, 0, 0, 0, this.seaKeep ? this.seaKeep(x, z) : null, this._so || (this._so = {})).h : 0; }
  _updateWakes(dt, t, cx, cz, night, env) {
    const T = this.traffic, WN = this.WN, BN = this.BN, P = this.wPos, A = this.wA, BP = this.bPos, BA = this.bA, wo = this._wo;
    this.wakeMat.uniforms.uT.value = t; this.wakeMat.uniforms.uLight.value = 1 - 0.8 * night;
    T.movers.forEach((v, mi) => {
      const cr = this.crumbs[mi], base = mi * WN * 2, bb = mi * BN * 2;
      if (v.hidden || v._d > 1500) { cr.length = 0; for (let i = 0; i < WN * 2; i++) A[base + i] = 0; for (let i = 0; i < BN * 2; i++) BA[bb + i] = 0; return; }
      const fx = Math.sin(v.psi), fz = -Math.cos(v.psi);
      if (!cr.length || t - cr[0].t > 0.4 || t < cr[0].t) {
        cr.unshift({ x: v.x - fx * v.L * 0.48, z: v.z - fz * v.L * 0.48, t, sp: v.u, px: Math.cos(v.psi), pz: Math.sin(v.psi), B: v.B });
        if (cr.length > WN) cr.pop();
      }
      for (let i = 0; i < WN; i++) {
        const c = cr[Math.min(i, cr.length - 1)], k = (base + i * 2);
        if (!c || i >= cr.length) { A[k] = A[k + 1] = 0; continue; }
        const age = t - c.t, w = c.B * 0.45 + age * c.sp * 0.33;
        // (on the drawn sea itself: it lay at half the height of six of its waves, under the crests, and the
        // wakes behind the traffic were hidden in the water)
        if (c.h === undefined || (i + this.frameN) % 4 === 0) c.h = this._seaH(env, c.x, c.z, t) + 0.1;
        const h = c.h;
        const a = clamp(c.sp / 5, 0, 1) * Math.exp(-age / (4 + c.B * 0.3)) * (i === 0 ? 0 : 1);
        const o3 = k * 3; P[o3] = c.x + c.px * w; P[o3 + 1] = h; P[o3 + 2] = c.z + c.pz * w; P[o3 + 3] = c.x - c.px * w; P[o3 + 4] = h; P[o3 + 5] = c.z - c.pz * w;
        A[k] = A[k + 1] = a;
      }
      // the bow wave: white water peeling off both bows and along the hull, by the Froude number (a ferry at 14 kn
      // throws a big one, a trawler at 2 kn none); it spreads at the Kelvin angle's pace aft of the stem
      const Fn = v.u / Math.sqrt(9.81 * Math.max(3, v.L)), ab = clamp((Fn - 0.12) * 3.5, 0, 1) * (v.type === 'chain' ? 0 : 1);
      const sx = Math.cos(v.psi), sz = Math.sin(v.psi), upd = ab > 0 && v._d < 900 && (mi + this.frameN) % 3 === 0;
      for (let i = 0; i < BN; i++) {
        const f = i / (BN - 1), along = v.L * (0.5 - 0.62 * f), k = bb + i * 2, o3 = k * 3;
        const w = v.B * 0.5 * Math.sin(Math.min(1, 0.25 + f * 1.6) * Math.PI / 2) + v.L * f * 0.1 * (0.4 + ab);
        const x = v.x + fx * along, z = v.z + fz * along;
        const hl = upd ? this._seaH(env, x + sx * w, z + sz * w, t) + 0.12 : BP[o3 + 1], hr = upd ? this._seaH(env, x - sx * w, z - sz * w, t) + 0.12 : BP[o3 + 4];
        BP[o3] = x + sx * w; BP[o3 + 1] = hl; BP[o3 + 2] = z + sz * w; BP[o3 + 3] = x - sx * w; BP[o3 + 4] = hr; BP[o3 + 5] = z - sz * w;
        BA[k] = BA[k + 1] = i === 0 ? 0 : ab * (1 - 0.55 * f);
      }
    });
    for (const g of [this.wakes.geometry, this.bows.geometry]) { g.attributes.position.needsUpdate = true; g.attributes.alpha.needsUpdate = true; }
  }
  _updateLights(cx, cz, night, px, cam) {
    this.lightMat.uniforms.uOn.value = night;
    this.lights.visible = night > 0.02;
    if (!this.lights.visible) return;
    this.lightMat.uniforms.uScale.value = px / (2 * Math.tan(cam.fov * Math.PI / 360));
    const T = this.traffic, P = this.lPos, C = this.lCol, S = this.lSize, vv = this._vv || (this._vv = new THREE.Vector3()), fr = this.frameN;
    let n = 0;
    for (const v of T.vessels) {
      if (v._d > 6000 || v.hidden || !v._mat) continue;
      // (under way the set changes — sails, trawling, dwelling — so it is looked at again now and then)
      if (!v._lights || (v.mode === 'rail' && (fr + v.seed * 30 | 0) % 30 === 0)) v._lights = lightsFor(v);
      const Ls = v._lights, m = v._mat;
      if (!Ls.length) continue;
      // which arc the camera is in: bearing of the camera from the bow, + = starboard
      const brg = Math.atan2(cx - v.x, -(cz - v.z)) - v.psi, b = Math.atan2(Math.sin(brg), Math.cos(brg));
      for (const [x, y, z, kind] of Ls) {
        if (n >= this.lightCap) break;
        const ab = Math.abs(b), vis = kind === 'mh' ? ab <= 1.9635 : kind === 'stbd' ? b >= -0.05 && b <= 1.9635 : kind === 'port' ? b <= 0.05 && b >= -1.9635 : kind === 'stern' ? ab >= 1.9635 : true;
        if (!vis) continue;
        vv.set(x, y, z).applyMatrix4(m);
        P[n * 3] = vv.x; P[n * 3 + 1] = vv.y; P[n * 3 + 2] = vv.z;
        const c = LCOL[kind]; C[n * 3] = c[0]; C[n * 3 + 1] = c[1]; C[n * 3 + 2] = c[2];
        S[n] = LSIZE[kind] * (kind === 'deck' ? Math.sqrt(v.scale * v.L / 40) : 1);
        n++;
      }
    }
    const g = this.lights.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}
