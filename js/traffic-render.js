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
    const q0 = st[0], s0 = sec(q0), tv = s0.map(([y, z]) => [this.v(y, z, -q0.x, cDeck), this.v(-y, z, -q0.x, cDeck)]);
    for (let k = 0; k < 5; k++) this.quad(tv[k][0], tv[k + 1][0], tv[k + 1][1], tv[k][1]);
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

// ------------------------------------------------------------------ the fleet of models (base size = VESSELS)
// parts: hull (topsides, tinted with the vessel's colour), body (everything else); yachts add cover (sail
// cover and furled headsail, shown when the sails are down), main and jib (set)
const WHITE = 0xf2f2ee, GLASS = 0x1c2630, STEEL = 0xb9bec4, DARK = 0x2a2d31;
function yachtModel() {
  const T = VESSELS.yacht, top = new Acc(), body = new Acc(), cover = new Acc();
  body.hull(top, T.L, T.B, 1.05, 0.55, { transom: 0.8, rake: 0.4, sheer: 0.15, fine: 0.8, deck: 0xe6e0d0 });
  body.box(1.9, 0.5, 3.4, 0, 1.3, -0.2, WHITE, 0.85).box(1.85, 0.12, 2.6, 0, 1.33, -0.4, GLASS);
  body.cyl(0.07, 0.05, T.H - 1.1, 0, 1.1, -0.9, STEEL);                 // mast
  body.cyl(0.05, 0.05, 3.9, 0, 2.1, 1.05, STEEL, 'z', 4);               // boom
  body.box(0.02, 0.02, 0.02, 0, T.H - 0.5, -0.9, STEEL);
  body.cyl(0.35, 0.05, 1.9, 0, -0.55, 0.2, 0x303338, 'y', 4);           // (keel, below the waterline)
  body.rod([0, 1.3, -T.L * 0.47], [0, T.H - 1.2, -1.0], 0.012, 0.012, STEEL, 3);    // forestay
  body.rod([0, 1.2, T.L * 0.47], [0, T.H - 0.2, -0.9], 0.01, 0.01, STEEL, 3);        // backstay
  cover.cyl(0.2, 0.2, 3.6, 0, 2.28, 1.0, 0x1d3f6e, 'z', 6);
  cover.rod([0, 1.5, -T.L * 0.47 + 0.05], [0, T.H - 1.6, -1.1], 0.08, 0.03, 0x2d3e5a, 5);     // the furled genoa on its stay
  return { hull: top.geo(), body: body.geo(), cover: cover.geo(), main: sailGeo(T.H - 2.6, 3.8, 0.1), jib: sailGeo(T.H - 3.2, T.L * 0.42, 0.12, true) };
}
// a sail: luff up the local y axis, foot aft along +z, camber toward +x
function sailGeo(luff, foot, depth, jib = false) {
  const nu = 4, nv = 5, p = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const v = j / nv, u = i / nu, ch = foot * (1 - v * (jib ? 1 : 0.92));
    const x = depth * ch * Math.sin(Math.PI * u) * (1 - 0.3 * v), y = luff * v, z = ch * u + (jib ? luff * 0.28 * v : 0);
    p.push(x, y, z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; idx.push(a, a + 1, a + nu + 2, a, a + nu + 2, a + nu + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function motorModel() {
  const T = VESSELS.motor, top = new Acc(), b = new Acc();
  b.hull(top, T.L, T.B, 1.35, 0.7, { transom: 0.92, rake: 0.8, sheer: 0.25, fine: 0.55, flat: 0.25, bottom: 0x2b2f38, deck: 0xe8e6e0 });
  b.box(3.1, 1.2, 5.4, 0, 1.9, 0.4, WHITE, 0.92).box(3.12, 0.45, 4.6, 0, 2.05, 0.2, GLASS);
  b.box(2.6, 0.9, 3.2, 0, 2.9, 0.8, WHITE, 0.85).box(2.62, 0.3, 1.2, 0, 2.95, -0.5, GLASS);
  b.box(0.12, 1.1, 0.12, 0, 3.8, 1.2, STEEL).box(0.8, 0.12, 0.3, 0, 4.3, 1.2, 0x333333);
  return { hull: top.geo(), body: b.geo() };
}
function ribModel() {
  const T = VESSELS.rib, top = new Acc(), b = new Acc();
  b.hull(top, T.L, T.B, 0.75, 0.4, { transom: 0.95, rake: 0.6, sheer: 0.3, fine: 0.45, flat: 0.2, bottom: 0x303030, deck: 0x9aa0a4 });
  b.box(0.9, 0.9, 0.8, 0, 1.2, 0.2, 0xe4e4e0).box(0.92, 0.35, 0.1, 0, 1.55, -0.2, GLASS);
  b.box(0.5, 0.9, 0.5, 0, 0.8, T.L / 2 + 0.1, DARK);
  return { hull: top.geo(), body: b.geo() };
}
function fishingModel() {
  const T = VESSELS.fishing, top = new Acc(), b = new Acc();
  b.hull(top, T.L, T.B, 1.9, 1.6, { transom: 0.75, rake: 0.6, sheer: 0.5, fine: 0.6, flat: 0.7, bottom: 0x6b2320, deck: 0x8f8a80 });
  b.box(3.2, 2.2, 3.4, 0, 3.0, -2.6, WHITE).box(3.22, 0.6, 3.0, 0, 3.5, -3.2, GLASS).box(3.4, 0.2, 3.6, 0, 4.15, -2.6, 0xd24b2a);
  b.cyl(0.12, 0.1, 5.5, 0, 4.2, -2.4, 0xd8d8d0);
  b.box(0.2, 3.5, 0.2, 2.2, 3.4, 4.8, 0xd8a23a).box(0.2, 3.5, 0.2, -2.2, 3.4, 4.8, 0xd8a23a).box(4.6, 0.25, 0.25, 0, 5.1, 4.8, 0xd8a23a);
  b.cyl(0.7, 0.7, 2.2, 0, 2.7, 2.0, 0x3a6b44, 'z', 8);                    // net drum
  return { hull: top.geo(), body: b.geo() };
}
function ferryModel(fast) {
  const T = fast ? VESSELS.fastcat : VESSELS.ferry, top = new Acc(), b = new Acc();
  if (fast) {
    for (const sx of [-1, 1]) { const h = new Acc(), ht = new Acc(); h.hull(ht, T.L, 2.6, 2.2, 1.3, { transom: 0.9, rake: 0.3, fine: 0.9, sheer: 0.1, bottom: 0x2a2d31 }); const g1 = h.geo(), g2 = ht.geo(); g1.translate(sx * 4.2, 0, 0); g2.translate(sx * 4.2, 0, 0); top.merge = (top.merge || []).concat(g2); b.merge = (b.merge || []).concat(g1); }
    b.box(T.B, 0.6, T.L * 0.94, 0, 2.5, 0.4, 0xdadcd8);
  } else b.hull(top, T.L, T.B, 2.4, 1.8, { transom: 0.85, rake: 0.5, fine: 0.6, sheer: 0.12, bottom: 0x6b2320, deck: 0xb8b8b0 });
  const d0 = fast ? 2.8 : 2.4;
  b.box(T.B * 0.92, 2.4, T.L * 0.72, 0, d0 + 1.2, 1.0, WHITE).box(T.B * 0.93, 1.1, T.L * 0.7, 0, d0 + 1.35, 1.0, GLASS);
  b.box(T.B * 0.8, 2.1, T.L * 0.5, 0, d0 + 3.4, 2.0, WHITE).box(T.B * 0.81, 0.9, T.L * 0.48, 0, d0 + 3.5, 2.0, GLASS);
  b.box(T.B * 0.5, 1.6, 3.2, 0, d0 + 5.2, -T.L * 0.12, WHITE).box(T.B * 0.52, 0.7, 2.8, 0, d0 + 5.4, -T.L * 0.12 - 0.3, GLASS);
  b.box(1.4, 2.2, 2.2, 0, d0 + 5.4, T.L * 0.25, 0xe2d23a, 0.8).cyl(0.08, 0.06, 3.5, 0, d0 + 6, -T.L * 0.12, STEEL);
  return { hull: top.geo(), body: merge([b.geo(), ...(b.merge || [])]), hullExtra: top.merge };
}
function carFerryModel() {
  const T = VESSELS.carferry, top = new Acc(), b = new Acc();
  b.hull(top, T.L, T.B, 4.2, 3.4, { transom: 0.92, rake: 0.3, fine: 0.5, sheer: 0.08, flat: 0.8, bottom: 0x6b2320, deck: 0x8e9296 });
  b.box(T.B * 0.98, 5.0, T.L * 0.86, 0, 6.7, 0, 0xf4f4f0).box(T.B * 0.99, 1.0, T.L * 0.8, 0, 7.4, 0, GLASS);
  b.box(T.B * 0.9, 3.2, T.L * 0.5, 0, 10.8, 3, WHITE).box(T.B * 0.91, 1.2, T.L * 0.48, 0, 11.0, 3, GLASS);
  b.box(T.B * 0.95, 2.4, 7, 0, 13.5, -T.L * 0.22, WHITE).box(T.B * 0.96, 1.0, 6, 0, 13.8, -T.L * 0.22 - 0.8, GLASS);
  b.box(3.4, 5, 6, 0, 15.5, T.L * 0.18, 0xf4f4f0, 0.85).box(3.5, 1.4, 6.1, 0, 17.3, T.L * 0.18, DARK, 0.85);
  b.cyl(0.15, 0.1, 6, 0, 14.5, -T.L * 0.2, STEEL);
  return { hull: top.geo(), body: b.geo() };
}
function chainModel() {
  const T = VESSELS.chain, top = new Acc(), b = new Acc();
  b.box(T.B, 1.4, T.L * 0.75, 0, 0.3, 0, 0x5a6168);
  top.box(T.B + 0.1, 0.9, T.L * 0.76, 0, 0.8, 0, 0xffffff);
  b.box(T.B * 0.9, 0.3, T.L * 0.13, 0, 0.9, -T.L * 0.42, 0x6d7278, 1).box(T.B * 0.9, 0.3, T.L * 0.13, 0, 0.9, T.L * 0.42, 0x6d7278, 1);
  for (const sx of [-1, 1]) b.box(2.4, 4.5, 8, sx * (T.B / 2 - 1.2), 3.3, 0, WHITE).box(2.45, 1.0, 7, sx * (T.B / 2 - 1.2), 4.6, 0, GLASS);
  return { hull: top.geo(), body: b.geo() };
}
function shipModel() {
  const T = VESSELS.ship, top = new Acc(), b = new Acc();
  b.hull(top, T.L, T.B, 6, 6.5, { transom: 0.9, rake: 0.5, fine: 0.45, sheer: 0.1, flat: 0.95, bottom: 0x7a2420, boot: 0x7a2420, deck: 0x6c6f66 });
  // containers in bays, a white house aft, the funnel
  const cols = [0xb03a2e, 0x2e6fa7, 0x3c8d5a, 0xd4a13a, 0x8a8f96, 0x6b3f8a, 0xc9c9c2];
  for (let k = 0; k < 9; k++) for (let tier = 0; tier < 2; tier++) b.box(T.B * 0.86, 2.5, 11, 0, 7.4 + tier * 2.55, -T.L * 0.36 + k * 11.8, cols[(k * 3 + tier * 5) % cols.length]);
  b.box(T.B * 0.92, 11, 12, 0, 11.5, T.L * 0.39, WHITE).box(T.B * 0.93, 1.1, 11, 0, 15.8, T.L * 0.39 - 0.4, GLASS).box(T.B * 1.1, 1, 4, 0, 16.9, T.L * 0.37, WHITE);
  b.box(4, 7, 5, 0, 20, T.L * 0.44, 0x2b2f36, 0.85).cyl(0.2, 0.15, 5, 0, 17.4, T.L * 0.37, STEEL);
  return { hull: top.geo(), body: b.geo() };
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
let MODELS = null;
function models() {
  if (MODELS) return MODELS;
  const f = ferryModel(false), fc = ferryModel(true);
  if (fc.hullExtra) fc.hull = merge([fc.hull, ...fc.hullExtra]);
  MODELS = { yacht: yachtModel(), motor: motorModel(), rib: ribModel(), fishing: fishingModel(), ferry: f, fastcat: fc, carferry: carFerryModel(), chain: chainModel(), ship: shipModel() };
  return MODELS;
}

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
const JIB_AXIS = new THREE.Vector3(0, 1, 0.28).normalize();
const LCOL = { mh: [1, 0.96, 0.88], stern: [1, 0.96, 0.88], all: [1, 0.96, 0.88], stbd: [0.2, 1, 0.45], port: [1, 0.15, 0.1], green: [0.2, 1, 0.45], red: [1, 0.15, 0.1], cabin: [1, 0.68, 0.32], deck: [1, 0.85, 0.6] };
const LSIZE = { mh: 1, stern: 0.9, all: 0.9, stbd: 1, port: 1, green: 0.9, red: 0.9, cabin: 0.7, deck: 1.6 };

// ------------------------------------------------------------------ the view
export class TrafficView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'traffic';
    scene.add(this.group);
    this.traffic = null;
  }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh || o.isPoints) { if (o.geometry && !o.userData.shared) o.geometry.dispose(); } });
  }
  setTraffic(traffic) {
    this.group.clear();
    this.traffic = traffic; this.meshes = {}; this.trails = new Map();
    if (!traffic || !traffic.vessels.length) return;
    const M = models(), byType = {};
    for (const v of traffic.vessels) (byType[v.type] || (byType[v.type] = [])).push(v);
    this.mat = this.mat || {
      hull: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05 }),
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }),
      sail: new THREE.MeshStandardMaterial({ color: 0xf1eee4, roughness: 0.8, side: THREE.DoubleSide }),
    };
    const col = new THREE.Color();
    for (const type in byType) {
      const list = byType[type], m = M[type], parts = {};
      for (const k of ['hull', 'body', 'cover', 'main', 'jib']) {
        if (!m[k]) continue;
        const mesh = new THREE.InstancedMesh(m[k], k === 'main' || k === 'jib' ? this.mat.sail : k === 'hull' ? this.mat.hull : this.mat.body, list.length);
        mesh.frustumCulled = false; mesh.userData.shared = true;
        mesh.castShadow = type !== 'ship' && type !== 'carferry'; mesh.receiveShadow = false;
        if (k === 'hull') { list.forEach((v, i) => mesh.setColorAt(i, col.setHex(v.color))); mesh.instanceColor.needsUpdate = true; }
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh); parts[k] = mesh;
      }
      this.meshes[type] = { list, parts };
    }
    // lights
    let nl = 0; for (const v of traffic.vessels) nl += 12;
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
    // wakes
    const WN = 22, nm = traffic.movers.length;
    this.WN = WN;
    const wg = new THREE.BufferGeometry();
    this.wPos = new Float32Array(nm * WN * 2 * 3); this.wA = new Float32Array(nm * WN * 2); const across = new Float32Array(nm * WN * 2), idx = [];
    for (let m = 0; m < nm; m++) for (let i = 0; i < WN; i++) {
      const a = (m * WN + i) * 2; across[a] = 0; across[a + 1] = 1;
      if (i < WN - 1) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    wg.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('alpha', new THREE.BufferAttribute(this.wA, 1).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('across', new THREE.BufferAttribute(across, 1)); wg.setIndex(idx);
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
    this.group.add(this.wakes);
    this.crumbs = traffic.movers.map(() => []);
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
    // instance matrices
    for (const type in this.meshes) {
      const { list, parts } = this.meshes[type];
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v._dirty && !!v._hid === !!v.hidden) continue;
        v._dirty = false;
        if (v.hidden) { for (const k in parts) parts[k].setMatrixAt(i, this._zero); v._hid = true; continue; }
        v._hid = false;
        e.set(v.pitch, -v.psi, -v.roll); q.setFromEuler(e); p.set(v.x, v.heave, v.z); s.setScalar(v.scale);
        m.compose(p, q, s); (v._mat || (v._mat = new THREE.Matrix4())).copy(m);
        parts.hull.setMatrixAt(i, m); parts.body.setMatrixAt(i, m);
        if (parts.cover) {
          parts.cover.setMatrixAt(i, v.sails ? this._zero : m);
          if (v.sails) {
            const side = -Math.sign(v.twa || 1);                      // leeward: + = starboard
            this._m2.makeRotationY(side * -v.boom); this._m2.setPosition(0, 2.2, -0.9);
            this._m3.makeScale(side, 1, 1); this._m2.multiply(this._m3);
            parts.main.setMatrixAt(i, this._m3.multiplyMatrices(m, this._m2));
            // (the jib turns about its stay)
            this._m2.makeRotationAxis(JIB_AXIS, side * -Math.min(0.62, v.boom * 0.75)); this._m2.setPosition(0, 1.3, -VESSELS.yacht.L * 0.47);
            this._m3.makeScale(side, 1, 1); this._m2.multiply(this._m3);
            parts.jib.setMatrixAt(i, this._m3.multiplyMatrices(m, this._m2));
          } else { parts.main.setMatrixAt(i, this._zero); parts.jib.setMatrixAt(i, this._zero); }
        }
      }
      for (const k in parts) parts[k].instanceMatrix.needsUpdate = true;
    }
    this._updateWakes(dt, t, cx, cz, night);
    this._updateLights(cx, cz, night, px, cam);
  }
  _updateWakes(dt, t, cx, cz, night) {
    const T = this.traffic, WN = this.WN, P = this.wPos, A = this.wA, wo = this._wo;
    this.wakeMat.uniforms.uT.value = t; this.wakeMat.uniforms.uLight.value = 1 - 0.8 * night;
    T.movers.forEach((v, mi) => {
      const cr = this.crumbs[mi], base = mi * WN * 2;
      if (v.hidden || v._d > 1500) { cr.length = 0; for (let i = 0; i < WN * 2; i++) A[base + i] = 0; return; }
      const fx = Math.sin(v.psi), fz = -Math.cos(v.psi);
      if (!cr.length || t - cr[0].t > 0.4 || t < cr[0].t) {
        cr.unshift({ x: v.x - fx * v.L * 0.48, z: v.z - fz * v.L * 0.48, t, sp: v.u, px: Math.cos(v.psi), pz: Math.sin(v.psi), B: v.B });
        if (cr.length > WN) cr.pop();
      }
      for (let i = 0; i < WN; i++) {
        const c = cr[Math.min(i, cr.length - 1)], k = (base + i * 2);
        if (!c || i >= cr.length) { A[k] = A[k + 1] = 0; continue; }
        const age = t - c.t, w = c.B * 0.45 + age * c.sp * 0.33;
        if (c.h === undefined || (i + this.frameN) % 4 === 0) c.h = this._cheap(c.x, c.z, t, 1, wo, this.seaKeep ? this.seaKeep(c.x, c.z) : null).h * 0.5 + 0.12;
        const h = c.h;
        const a = clamp(c.sp / 5, 0, 1) * Math.exp(-age / (4 + c.B * 0.3)) * (i === 0 ? 0 : 1);
        const o3 = k * 3; P[o3] = c.x + c.px * w; P[o3 + 1] = h; P[o3 + 2] = c.z + c.pz * w; P[o3 + 3] = c.x - c.px * w; P[o3 + 4] = h; P[o3 + 5] = c.z - c.pz * w;
        A[k] = A[k + 1] = a;
      }
    });
    this.wakes.geometry.attributes.position.needsUpdate = true; this.wakes.geometry.attributes.alpha.needsUpdate = true;
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
