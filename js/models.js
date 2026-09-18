// Detailed boat models: hull lofted from class lines, deck with cockpit and non-skid, cabin trunk,
// deck hardware, spars, standing rigging and sails. Static parts are merged per material so a
// detailed boat stays cheap to draw; moving parts (rudder, booms, sails, bowsprit) stay separate.
import * as THREE from 'three';
import { STRIP_F, reefAt, clamp, lerp, sstep } from './physics.js';

// physics coordinates (x fwd, y stbd, z up) -> boat-local three.js (x stbd, y up, z aft)
export const V = (x, y, z) => new THREE.Vector3(y, z, -x);

// ------------------------------------------------------------------ materials & textures
const texCache = {};
function canvasTex(key, w, h, draw, repeat = 1) {
  if (texCache[key]) return texCache[key];
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat !== 1) t.repeat.set(repeat, repeat);
  texCache[key] = t;
  return t;
}
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const teakTex = () => canvasTex('teak', 256, 256, (g, w, h) => {
  const r = rnd(4);
  for (let p = 0; p < 8; p++) {
    const y0 = p * 32;
    const base = 120 + r() * 25;
    g.fillStyle = `rgb(${base + 40},${base - 10},${base - 55})`; g.fillRect(0, y0, w, 30);
    for (let i = 0; i < 40; i++) { g.strokeStyle = `rgba(70,40,15,${0.08 + r() * 0.12})`; g.beginPath(); const yy = y0 + r() * 30; g.moveTo(0, yy); g.bezierCurveTo(w * 0.3, yy + r() * 4 - 2, w * 0.7, yy + r() * 4 - 2, w, yy + r() * 3 - 1.5); g.stroke(); }
    g.fillStyle = '#1b140e'; g.fillRect(0, y0 + 30, w, 2); // caulking seam
  }
});
const nonskidTex = (tint = '#e9e6dc') => canvasTex('ns' + tint, 128, 128, (g, w, h) => {
  g.fillStyle = tint; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + 4, y); g.lineTo(x + 8, y + 4); g.lineTo(x + 4, y + 8); g.fill(); }
});
const carbonTex = () => canvasTex('carbon', 64, 64, (g, w, h) => {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const k = ((x + y) % 4 < 2); g.fillStyle = k ? '#2a2d33' : '#16181c'; g.fillRect(x * 8, y * 8, 8, 8); }
}, 6);

const matCache = {};
function mat(key, make) { return matCache[key] || (matCache[key] = make()); }
const M = {
  gel: (c) => mat('gel' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.28, metalness: 0.02 })),
  hull: () => mat('hullvc', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.02, side: THREE.DoubleSide })),
  teak: () => mat('teak', () => new THREE.MeshStandardMaterial({ map: teakTex(), roughness: 0.75, side: THREE.DoubleSide })),
  varnish: () => mat('varnish', () => new THREE.MeshStandardMaterial({ map: teakTex(), roughness: 0.25, color: 0xd9b48a })),
  deck: (tint) => mat('deck' + tint, () => new THREE.MeshStandardMaterial({ map: nonskidTex(tint), roughness: 0.85, side: THREE.DoubleSide })),
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.22, metalness: 0.9 })),
  alu: () => mat('alu', () => new THREE.MeshStandardMaterial({ color: 0xbfc5cb, roughness: 0.4, metalness: 0.75 })),
  black: () => mat('black', () => new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.2 })),
  rubber: () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9 })),
  bronze: () => mat('bronze', () => new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.85 })),
  carbon: () => mat('carbon', () => new THREE.MeshStandardMaterial({ map: carbonTex(), roughness: 0.3, metalness: 0.3 })),
  glass: () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x18242c, roughness: 0.05, metalness: 0.6 })),
  wire: () => mat('wire', () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.9 })),
  red: () => mat('navred', () => new THREE.MeshStandardMaterial({ color: 0xc81e1e, emissive: 0x400000, roughness: 0.3 })),
  green: () => mat('navgreen', () => new THREE.MeshStandardMaterial({ color: 0x1e9c3c, emissive: 0x003010, roughness: 0.3 })),
  cream: () => mat('cream', () => new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.4, side: THREE.DoubleSide })),
  cowlIn: () => mat('cowlin', () => new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, side: THREE.DoubleSide })),
  foil: () => mat('foil', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.3 })),
  lead: () => mat('lead', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.45, metalness: 0.4 })),
};

// ------------------------------------------------------------------ merge kit
function ensureAttrs(g) {
  if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
export function mergeGeoms(list) {
  let nv = 0, ni = 0;
  for (const g of list) { ensureAttrs(g); nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
    uv.set(g.attributes.uv.array.subarray(0, n * 2), vo * 2);
    const gi = g.index.array; for (let i = 0; i < g.index.count; i++) idx[io + i] = gi[i] + vo;
    vo += n; io += g.index.count; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}
class Kit {
  constructor() { this.parts = new Map(); }
  add(material, geom, matrix) {
    if (matrix) geom.applyMatrix4(matrix);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(geom);
    return geom;
  }
  // a cylinder between two points (local three coords)
  rod(material, a, b, r, seg = 6, r2 = r) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    if (L < 1e-4) return;
    const g = new THREE.CylinderGeometry(r2, r, L, seg, 1);
    g.translate(0, L / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
    this.add(material, g);
  }
  box(material, w, h, d, pos, rotY = 0, rotX = 0, rotZ = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')));
    g.translate(pos.x, pos.y, pos.z);
    this.add(material, g);
  }
  build(parent, cast = true) {
    for (const [m, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeoms(list), m);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

// ------------------------------------------------------------------ hull lines (shared with the physics)
import { linesFor, hullSection, hullOffsets, calibrate } from './hull.js';
export { linesFor };

function hullGeometry(C, Lx, yOff = 0) {
  const H = Lx.H;
  const NS = 64;
  const L0 = C.sternX, L1 = C.bowX;
  const stations = [];
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const sec = hullSection(C, Lx, t);
    const zTop = sec[0][1], zBot = sec[sec.length - 1][1];
    const x0 = lerp(L0, L1, t);
    stations.push(sec.map(([y, z]) => {
      let x = x0;
      const zn = clamp((z - zBot) / Math.max(0.05, zTop - zBot), 0, 1);
      x += H.stemRake * sstep(0.86, 1, t) * zn ** 1.4;           // raked / clipper stem
      x -= H.transomRake * sstep(0.12, 0, t) * zn;                // raked transom
      return [x, y, z];
    }));
  }
  const NP = stations[0].length;
  const pos = [], col = [];
  const cTop = new THREE.Color(C.hull.color), cBoot = new THREE.Color(C.hull.bootTop ?? 0xf2f2ee), cAnti = new THREE.Color(C.hull.boot), cStripe = new THREE.Color(C.hull.stripe);
  for (let s = 0; s <= NS; s++) for (let k = 0; k < NP; k++) for (let side = 0; side < 2; side++) {
    const [x, y, z] = stations[s][k];
    pos.push(yOff + (side ? -y : y), z, -x);
    const shz = stations[s][0][2];
    const c = z < 0.04 ? cAnti : z < 0.1 ? cBoot : (z > shz - 0.12 && z < shz - 0.085) ? cStripe : cTop;
    col.push(c.r, c.g, c.b);
  }
  const idx = [];
  const vid = (s, k, side) => (s * NP + k) * 2 + side;
  for (let s = 0; s < NS; s++) for (let k = 0; k < NP - 1; k++) for (let side = 0; side < 2; side++) {
    const a = vid(s, k, side), b2 = vid(s + 1, k, side), c2 = vid(s + 1, k + 1, side), d2 = vid(s, k + 1, side);
    if (side === 0) idx.push(a, d2, b2, b2, d2, c2); else idx.push(a, b2, d2, b2, c2, d2);
  }
  // transom closure
  const tBase = pos.length / 3;
  const st = stations[0];
  for (let k = 0; k < NP; k++) { const [x, y, z] = st[k]; pos.push(yOff + y, z, -x, yOff - y, z, -x); const c = z < 0.04 ? cAnti : cTop; col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  for (let k = 0; k < NP - 1; k++) { const a = tBase + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return { geom: g, stations };
}

// deck surface with crown and a cockpit well lowered into it
function deckGeometry(C, Lx, stations, ck) {
  const NU = 26, NS = stations.length - 1;
  const pos = [], uv = [], idx = [];
  const crown = Lx.H.crown;
  for (let s = 0; s <= NS; s++) {
    const t = s / NS, [x, b, sh] = stations[s][0];
    for (let j = 0; j <= NU; j++) {
      const u = j / NU * 2 - 1;
      let z = sh + crown * (1 - u * u) * Math.min(1, b / (C.beam / 2)) * (C.beam / 2) * 0.35;
      let y = u * b * 0.992;
      if (ck) {
        const e = 1.2 / NS, eu = 2.4 / NU;
        const m = sstep(ck.t0 - e, ck.t0, t) * (1 - sstep(ck.t1, ck.t1 + e, t)) * (1 - sstep(ck.w, ck.w + eu, Math.abs(u)));
        z = lerp(z, ck.sole, m);
        if (m > 0.5) y = u * b * 0.992;
      }
      pos.push(y, z, -x); uv.push(y * 1.6, x * 1.6);
    }
  }
  for (let s = 0; s < NS; s++) for (let j = 0; j < NU; j++) {
    const a = s * (NU + 1) + j;
    idx.push(a, a + NU + 1, a + 1, a + 1, a + NU + 1, a + NU + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// deck height at (x fwd, y stbd) — used to seat fittings and crew
function deckHeightFn(C, Lx, ck) {
  if (C.multihull) return (x, y) => {
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1), half = C.hullSpacing / 2;
    const dy = Math.abs(Math.abs(y) - half), b = Math.max(0.05, Lx.bDeck(t));
    return dy < b ? Lx.sheer(t) + 0.03 * (1 - (dy / b) ** 2) : C.freeboard + 0.05;
  };
  return (x, y) => {
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    const b = Math.max(0.05, Lx.bDeck(t)), sh = Lx.sheer(t);
    const u = clamp(y / b, -1, 1);
    let z = sh + Lx.H.crown * (1 - u * u) * Math.min(1, b / (C.beam / 2)) * (C.beam / 2) * 0.35;
    if (ck && t > ck.t0 && t < ck.t1 && Math.abs(u) < ck.w) z = ck.sole;
    return z;
  };
}

// ------------------------------------------------------------------ foils
function foilGeom(chord, span, thick = 0.1, taper = 0.7, sweep = 0.1) {
  const shape = new THREE.Shape();
  const n = 18, pts = [];
  for (let i = 0; i <= n; i++) {
    const xc = (1 - Math.cos(i / n * Math.PI)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    pts.push([xc, yt]);
  }
  shape.moveTo(0, 0);
  for (const [x, y] of pts) shape.lineTo(x * chord, y * chord);
  for (let i = pts.length - 2; i >= 1; i--) shape.lineTo(pts[i][0] * chord, -pts[i][1] * chord);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 4, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const depth = -p.getY(i) / span;
    const s = lerp(1, taper, depth);
    p.setX(i, p.getX(i) * s + depth * chord * sweep);
    p.setZ(i, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  g.rotateY(-Math.PI / 2); // chord runs aft (+z local)
  return g;
}
function lathe(profile, seg = 16) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg); }

// ------------------------------------------------------------------ sail textures
function sailTexture(C, s, number, color) {
  const key = `sail-${C.id}-${s.key}-${number}-${color}`;
  return canvasTex(key, 512, 1024, (g, w, h) => {
    const base = new THREE.Color(color);
    g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, w, h);
    // crosscut panels (seams perpendicular to the leech), with a faint cloth weave
    g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 2;
    for (let y = 30; y < h + 200; y += 58) { g.beginPath(); g.moveTo(0, y - 60); g.lineTo(w, y); g.stroke(); }
    const r = rnd(9); g.fillStyle = 'rgba(0,0,0,0.02)';
    for (let i = 0; i < 3000; i++) g.fillRect(r() * w, r() * h, 2, 1);
    // corner reinforcement patches (tack bottom-right = luff at u=0 -> texture x=w)
    const patch = (cx, cy, rad) => { g.fillStyle = 'rgba(0,0,0,0.07)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill(); };
    patch(w, h, 90); patch(0, h, 90); patch(w, 0, 70);
    // leech tape
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 6, h);
    if (s.key === 'main') {
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 7;
      for (const f of [0.2, 0.4, 0.6, 0.8]) { const y = h - f * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w * 0.42, y + 8); g.stroke(); } // batten pockets
      if (s.reefs) for (const rf of [0.16, 0.31]) { // reef points
        const y = h - rf * h;
        g.fillStyle = 'rgba(255,255,255,0.8)';
        for (let x = 20; x < w - 20; x += 38) { g.fillRect(x, y - 1, 3, 14); }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(w - 12, y, 9, 0, 7); g.arc(12, y, 9, 0, 7); g.fill();
      }
      if (number) {
        g.fillStyle = C.id === 'blackwatch' ? '#f1e6cf' : '#1d2a44';
        g.font = 'bold 150px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center';
        g.fillText(number, w * 0.5, h * 0.52);
        g.font = 'bold 72px "Barlow Condensed", "Arial Narrow", sans-serif';
        g.fillText(C.id === 'blackwatch' ? 'BW' : C.id === 'sportboat' ? 'S23' : 'S14', w * 0.55, h * 0.3);
      }
    }
    if (s.kind === 'loose') { // window
      g.fillStyle = 'rgba(160,200,220,0.35)'; g.fillRect(w * 0.35, h * 0.72, w * 0.3, h * 0.12);
    }
  });
}

// ------------------------------------------------------------------ sails
const NU = 12, NV = 18;
function sailMesh(tex, color) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3), uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  const idx = [];
  for (let v = 0; v <= NV; v++) for (let u = 0; u <= NU; u++) {
    const k = v * (NU + 1) + u; uv[2 * k] = 1 - u / NU; uv[2 * k + 1] = v / NV;
    if (u < NU && v < NV) idx.push(k, k + 1, k + NU + 1, k + 1, k + NU + 2, k + NU + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : color, map: tex || null, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}

// ------------------------------------------------------------------ transom lettering
function transomDecal(C, name, port) {
  return canvasTex(`transom-${C.id}-${name}`, 512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = C.id === 'blackwatch' ? '#c9a24a' : '#1d2a44';
    g.textAlign = 'center';
    g.font = `italic 700 ${C.id === 'blackwatch' ? 64 : 52}px Georgia, "Times New Roman", serif`;
    g.fillText(name, w / 2, 66);
    g.font = '600 26px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(port, w / 2, 108);
  });
}

// ================================================================== assemble
export function buildBoatModel(boat, opts = {}) {
  const C = boat.cls;
  const Lx = linesFor(C);
  const root = new THREE.Group();
  const inner = new THREE.Group(); root.add(inner);
  const kit = new Kit();
  const topColor = opts.hullColor ?? C.hull.color;
  const Chull = { ...C, hull: { ...C.hull, color: topColor } };
  // ---- hull
  calibrate(C);
  const offs = hullOffsets(C);
  let stations, hull;
  for (const off of offs) {
    const r = hullGeometry(Chull, Lx, off);
    stations = r.stations;
    hull = new THREE.Mesh(r.geom, M.hull());
    hull.castShadow = true; hull.receiveShadow = true;
    inner.add(hull);
  }
  const bx = (t) => lerp(C.sternX, C.bowX, t);
  const tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  // ---- cockpit layout per class
  const ck = C.id === 'blackwatch' ? { t0: 0.07, t1: 0.33, w: 0.5, sole: 0.38 }
    : C.id === 'sportboat' ? { t0: 0.0, t1: 0.44, w: 0.66, sole: 0.3 }
    : { t0: 0.12, t1: 0.66, w: 0.55, sole: 0.14 };
  const deckH = deckHeightFn(C, Lx, ck);
  const deckTint = C.id === 'blackwatch' ? '#e6dcc4' : C.id === 'sportboat' ? '#dfe2e2' : '#eceae3';
  let deck;
  for (const off of offs) {
    const g = deckGeometry(C, Lx, stations, C.multihull ? null : ck);
    g.translate(off, 0, 0);
    deck = new THREE.Mesh(g, M.deck(deckTint));
    deck.receiveShadow = true; deck.castShadow = true; inner.add(deck);
  }
  if (C.multihull) buildCatStructure(kit, inner, C, Lx, deckH);
  // toerail along the sheer
  const sheerPts = (side, off = 0) => stations.map(st => { const [x, y, z] = st[0]; return new THREE.Vector3(off + side * y, z + 0.02, -x); });
  if (!C.multihull) for (const side of [-1, 1]) {
    const pts = sheerPts(side);
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.filter((p, i) => i % 2 === 0)), 60, C.id === 'dinghy' ? 0.015 : 0.022, 5);
    kit.add(C.id === 'blackwatch' ? M.teak() : M.alu(), tube);
  }
  // transom lettering
  {
    // sit the lettering on the actual transom surface: take its top (sheer) and the point near the
    // boot top from the hull's own stern section, and lie the plate along that line
    const st = stations[0];
    const [xt, , zt] = st[0];
    let xb = xt, zb = 0.12;
    for (let k = 1; k < st.length; k++) { const [xa, , za] = st[k - 1], [xc, , zc] = st[k]; if (za >= 0.12 && zc < 0.12) { xb = xa + (xc - xa) * (za - 0.12) / (za - zc); break; } }
    const tilt = Math.atan2(xb - xt, zt - zb);          // rake: top of the transom further aft
    const f = 0.55, xm = xb + (xt - xb) * f, zmid = zb + (zt - zb) * f;
    const w = Lx.bDeck(0) * 1.5;
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: transomDecal(C, C.id === 'blackwatch' ? 'Blackwatch' : C.id === 'sportboat' ? (opts.number ? '#' + opts.number : 'S23') : '', C.id === 'blackwatch' ? 'PROGRESO, YUC.' : ''), transparent: true, roughness: 0.4 }));
    dec.position.set(0, zmid + Math.sin(tilt) * 0.012, -xm + Math.cos(tilt) * 0.012);
    dec.rotation.x = tilt;
    if (C.id !== 'dinghy' && !C.multihull) inner.add(dec);
  }
  // cockpit furniture
  const soleZ = ck.sole;
  if (C.id === 'blackwatch') {
    const xa = bx(ck.t0), xf = bx(ck.t1), xm = (xa + xf) / 2, L = xf - xa;
    const cw = ck.w * Lx.bDeck((ck.t0 + ck.t1) / 2);
    for (const s of [-1, 1]) {
      kit.box(M.teak(), 0.34, 0.05, L * 0.92, V(xm, s * (cw - 0.2), soleZ + 0.38));         // benches
      kit.box(M.cream(), 0.03, 0.38, L * 0.92, V(xm, s * (cw - 0.37), soleZ + 0.19));       // bench fronts
      kit.box(M.varnish(), 0.035, 0.22, L * 1.02, V(xm, s * (cw + 0.02), deckH(xm, s * (cw + 0.05)) + 0.08)); // coamings
    }
    kit.box(M.teak(), cw * 2 - 0.7, 0.03, L * 0.9, V(xm, 0, soleZ + 0.015)); // teak grating sole
    for (let i = 0; i < 9; i++) kit.box(M.black(), cw * 2 - 0.72, 0.012, 0.012, V(xa + 0.1 + i * L * 0.1, 0, soleZ + 0.034));
  } else if (C.id === 'sportboat') {
    const xa = bx(0.02), xf = bx(ck.t1);
    kit.box(M.black(), 0.04, 0.08, 0.5, V(xf - 0.6, 0, soleZ + 0.04)); // traveler base / thwart
  } else {
    // dinghy: daggerboard trunk, hiking strap posts, mast step
    kit.box(M.cream(), 0.06, 0.26, 0.42, V(C.keel.x + 0.02, 0, soleZ + 0.13));
  }
  // cabin trunk
  if (C.id === 'blackwatch') buildCabin(kit, C, Lx, deckH, bx);
  if (C.id === 'sportboat') {
    const xa = bx(0.46), xf = bx(0.72), L = xf - xa;
    const w = 0.62;
    const cab = new THREE.BoxGeometry(w * 2, 0.16, L, 1, 1, 1);
    const p = cab.attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.9); if (p.getZ(i) < 0) p.setY(i, p.getY(i) - 0.04); } }
    cab.computeVertexNormals();
    cab.translate(0, deckH((xa + xf) / 2, 0) + 0.06, -(xa + xf) / 2);
    kit.add(M.deck('#dfe2e2'), cab);
    kit.box(M.glass(), w * 1.6, 0.05, 0.02, V(xf - 0.02, 0, deckH(xf, 0) + 0.1)); // forward windows
    for (const s of [-1, 1]) kit.box(M.glass(), 0.02, 0.05, L * 0.6, V((xa + xf) / 2, s * w * 0.96, deckH(xa, 0) + 0.1));
    kit.box(M.black(), 0.5, 0.03, 0.5, V(xa + 0.3, 0, deckH(xa, 0) + 0.15)); // hatch
  }
  // stanchions, pulpit, pushpit, lifelines
  if (C.id !== 'dinghy' && !C.multihull) buildLifelines(kit, C, Lx, stations, deckH, bx);
  // mooring cleats, chainplates, nav lights
  const cleatM = C.id === 'blackwatch' ? M.bronze() : M.alu();
  const cleat = (x, y) => { const z = deckH(x, y); kit.box(cleatM, 0.035, 0.03, 0.16, V(x, y, z + 0.035)); kit.box(cleatM, 0.03, 0.035, 0.04, V(x, y, z + 0.015)); };
  if (!C.multihull) { cleat(C.bowX - 0.35, 0); for (const s of [-1, 1]) cleat(C.sternX + 0.3, s * Lx.bDeck(0.05) * 0.8); }
  const shroudX = C.mastX - 0.1;
  const chain = [];
  for (const s of [-1, 1]) {
    const y = C.multihull ? s * (C.hullSpacing / 2) : s * Lx.bDeck(tAt(shroudX)) * 0.93, z = deckH(shroudX, y);
    chain.push([shroudX, y, z]);
    kit.box(M.steel(), 0.02, 0.06, 0.05, V(shroudX, y, z + 0.02));
  }
  if (C.id !== 'dinghy' && !C.multihull) {
    const nx = C.bowX - 0.25, ny = Lx.bDeck(tAt(nx)) * 0.8;
    kit.box(M.red(), 0.05, 0.04, 0.07, V(nx, -ny, deckH(nx, -ny) + 0.05));
    kit.box(M.green(), 0.05, 0.04, 0.07, V(nx, ny, deckH(nx, ny) + 0.05));
  }
  // bowsprit
  let sprit = null;
  if (C.bowsprit) {
    if (C.id === 'blackwatch') {
      const x0 = C.bowX - 0.6, x1 = C.bowX + C.bowsprit, z = Lx.sheer(1) + 0.05;
      kit.box(M.teak(), 0.2, 0.08, x1 - x0, V((x0 + x1) / 2, 0, z));
      kit.rod(M.bronze(), V(x1 - 0.02, 0, z + 0.02), V(x1 + 0.06, 0, z + 0.02), 0.05, 10);
      kit.rod(M.steel(), V(x1, 0, z - 0.03), V(C.bowX + 0.02, 0, 0.12), 0.008);  // bobstay
      for (const s of [-1, 1]) kit.rod(M.steel(), V(x1 - 0.05, 0, z), V(C.bowX - 0.35, s * Lx.bDeck(tAt(C.bowX - 0.35)) * 0.95, Lx.sheer(0.95)), 0.004); // whisker stays
      // anchor on the bow roller
      const ax = C.bowX + 0.15, az = z + 0.06;
      kit.box(M.steel(), 0.03, 0.03, 0.55, V(ax, 0.05, az), 0, 0.15);
      kit.box(M.steel(), 0.28, 0.03, 0.12, V(ax + 0.28, 0.05, az - 0.04), 0, 0.3);
    } else {
      // retractable carbon bowsprit (slides out with the gennaker)
      const L = C.bowsprit + 0.8;
      const g = new THREE.CylinderGeometry(0.035, 0.045, L, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, -L / 2);
      sprit = new THREE.Mesh(g, M.carbon()); sprit.castShadow = true;
      sprit.position.copy(V(C.bowX - 0.6, 0, Lx.sheer(1) - 0.06));
      inner.add(sprit);
    }
  }
  // ---- keel / board / rudder
  const K = C.keel;
  let keelMesh = null;
  if (K.twin) {
    keelMesh = new THREE.Group();
    for (const off of offs) { const b = new THREE.Mesh(foilGeom(K.chord, K.span + 0.45, 0.11, 0.9, 0.05), M.foil()); b.position.x = off; b.castShadow = true; keelMesh.add(b); }
    keelMesh.position.copy(V(K.x + K.chord * 0.35, 0, C.freeboard - 0.05));
    inner.add(keelMesh);
  } else if (!K.long) {
    const kg = foilGeom(K.chord, K.span + (K.board ? 0.35 : 0.08), 0.11, K.board ? 0.95 : 0.72, K.board ? 0 : 0.12);
    keelMesh = new THREE.Mesh(kg, K.board ? M.foil() : M.carbon());
    keelMesh.position.copy(V(K.x + K.chord * 0.35, 0, -C.canoeDraft + 0.06 + (K.board ? 0.35 : 0)));
    keelMesh.castShadow = true;
    inner.add(keelMesh);
    if (C.keelBulb) {
      const bulb = new THREE.Mesh(lathe([[0, 0], [0.07, 0.08], [0.13, 0.3], [0.15, 0.6], [0.14, 0.95], [0.09, 1.25], [0.02, 1.42], [0, 1.44]], 20), M.lead());
      bulb.rotation.x = Math.PI / 2; bulb.position.set(0, -K.span - 0.02, -0.55);
      bulb.castShadow = true; keelMesh.add(bulb);
    }
    if (K.board) { // handle on top of the daggerboard
      const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, K.chord * 0.8), M.black()); hnd.position.set(0, 0.03, K.chord * 0.4); keelMesh.add(hnd);
    }
  }
  const Rd = C.rudder;
  const rudderPivot = new THREE.Group();
  let tillerEnd = new THREE.Vector3();
  const rudderPivots = [];
  if (Rd.twin) {
    // twin transom rudders with tiller arms joined by a crossbar; the extension hangs off its middle
    rudderPivot.position.copy(V(C.sternX - 0.05, 0, 0));
    for (const off of offs) {
      const pv = new THREE.Group(); pv.position.x = off;
      const blade = new THREE.Mesh(foilGeom(Rd.chord, Rd.span + C.freeboard, 0.12, 0.8, 0.02), M.foil());
      blade.position.set(0, C.freeboard, -0.02); blade.castShadow = true; pv.add(blade);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.6, 8), M.alu()); arm.rotation.x = Math.PI / 2; arm.position.set(0, C.freeboard + 0.08, -0.3); pv.add(arm);
      rudderPivot.add(pv); rudderPivots.push(pv);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, C.hullSpacing, 8), M.alu()); bar.rotation.z = Math.PI / 2; bar.position.set(0, C.freeboard + 0.08, -0.6); rudderPivot.add(bar);
    tillerEnd.set(0, C.freeboard + 0.1, -0.6);
  } else if (Rd.transom) {
    // barn-door rudder hung on the transom with bronze pintles, wooden tiller over the transom
    const topZ = Lx.sheer(0) + 0.05, botZ = C.keel.long ? -C.draft + 0.05 : -C.canoeDraft - Rd.span;
    const tx = C.sternX - Lx.H.transomRake * 0.5;
    rudderPivot.position.copy(V(tx - 0.02, 0, 0));
    const sh = new THREE.Shape();
    const ch = Rd.chord;
    sh.moveTo(0, topZ); sh.lineTo(0, botZ); sh.quadraticCurveTo(ch * 0.9, botZ - 0.02, ch, botZ + 0.25); sh.lineTo(ch * 0.75, topZ - 0.35); sh.lineTo(0.12, topZ);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.045, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    bg.translate(0, 0, -0.0225); bg.rotateY(-Math.PI / 2); // chord aft along +z
    const blade = new THREE.Mesh(bg, M.varnish()); blade.castShadow = true; rudderPivot.add(blade);
    for (const z of [0.1, topZ - 0.35, -0.25]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 8), M.bronze()); pin.position.set(0, z, 0.005); rudderPivot.add(pin); }
    const tpts = [new THREE.Vector3(0, topZ - 0.02, 0.03), new THREE.Vector3(0, topZ + 0.1, -0.2), new THREE.Vector3(0, topZ + 0.14, -0.7), new THREE.Vector3(0, topZ + 0.08, -1.15)];
    const tiller = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tpts), 16, 0.028, 8), M.varnish());
    tiller.castShadow = true; rudderPivot.add(tiller);
    tillerEnd.copy(tpts[3]);
  } else {
    const topZ = C.id === 'dinghy' ? C.freeboard + 0.05 : -C.canoeDraft + 0.12;
    rudderPivot.position.copy(V(Rd.x + Rd.chord * 0.25, 0, 0));
    const blade = new THREE.Mesh(foilGeom(Rd.chord, Rd.span + Math.max(0, topZ + C.canoeDraft) , 0.12, 0.75, 0.05), M.foil());
    blade.position.set(0, topZ, -Rd.chord * 0.22); blade.castShadow = true; rudderPivot.add(blade);
    const stockTop = C.id === 'dinghy' ? C.freeboard + 0.12 : Lx.sheer(0.05) - 0.12 + 0.1;
    if (C.id === 'dinghy') { const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.18), M.alu()); head.position.set(0, stockTop - 0.05, 0.02); rudderPivot.add(head); }
    else { const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stockTop - topZ, 10), M.steel()); stock.position.set(0, (stockTop + topZ) / 2, 0); rudderPivot.add(stock); }
    const tLen = C.id === 'dinghy' ? 0.9 : 1.15;
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, tLen, 10), C.id === 'dinghy' ? M.alu() : M.carbon());
    tiller.rotation.x = Math.PI / 2 + 0.05; tiller.position.set(0, stockTop + 0.02, -tLen / 2);
    tiller.castShadow = true; rudderPivot.add(tiller);
    tillerEnd.set(0, stockTop + 0.06, -tLen);
  }
  inner.add(rudderPivot);
  // tiller extension (hiking stick), hinged at the tiller end and lying forward along it
  let extension = null;
  if (C.id !== 'blackwatch') {
    const L = C.id === 'dinghy' ? 1.0 : 1.2;
    const g = new THREE.CylinderGeometry(0.012, 0.012, L, 8); g.translate(0, L / 2, 0); g.rotateX(-Math.PI / 2 + 0.08);
    extension = new THREE.Mesh(g, M.black()); extension.castShadow = true;
    extension.position.copy(tillerEnd);
    rudderPivot.add(extension);
    extension.userData.len = L;
  }
  // ---- spars and standing rigging
  const rig = new THREE.Group(); inner.add(rig);
  const rigKit = new Kit();
  const mastBase = C.id === 'blackwatch' ? deckH(C.mastX, 0) + 0.02 : deckH(C.mastX, 0);
  const mastLen = C.mastHeight - mastBase;
  const mastMat = C.id === 'sportboat' ? M.carbon() : M.alu();
  const r0 = C.id === 'dinghy' ? 0.032 : C.id === 'sportboat' ? 0.05 : 0.055;
  const mast = new THREE.Mesh(lathe([[r0, 0], [r0, mastLen * 0.6], [r0 * 0.9, mastLen * 0.8], [r0 * 0.6, mastLen], [0, mastLen]], 14), mastMat);
  mast.scale.set(1, 1, 1.25); // pear-shaped section, deeper fore-aft
  mast.position.copy(V(C.mastX, 0, mastBase)); mast.castShadow = true; rig.add(mast);
  rigKit.box(M.black(), 0.012, mastLen * 0.95, 0.012, V(C.mastX - r0 * 1.2, 0, mastBase + mastLen * 0.5)); // luff track
  rigKit.box(mastMat, 0.07, 0.04, 0.16, V(C.mastX - 0.04, 0, C.mastHeight + 0.01)); // masthead crane
  rigKit.rod(M.black(), V(C.mastX + 0.02, 0.03, C.mastHeight), V(C.mastX + 0.02, 0.03, C.mastHeight + 0.9), 0.004); // VHF whip
  rigKit.box(M.black(), 0.1, 0.06, 0.08, V(C.mastX - 0.08, 0, C.boomZ)); // gooseneck
  const stay = {}, S = boat.sailBy;
  if (C.multihull) {
    const hounds = C.mastHeight - mastLen * 0.25;
    for (const s of [-1, 1]) rigKit.rod(M.wire(), V(C.mastX - 0.05, s * C.hullSpacing / 2, C.freeboard + 0.1), V(C.mastX, s * 0.02, hounds), 0.003);
    const J = S.jib; rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.0035);
    for (const s of [-1, 1]) rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(C.bowX - 0.2, s * C.hullSpacing / 2, C.freeboard + 0.15), 0.003); // bridle
    stay.trapezeTop = V(C.mastX, 0, hounds);
  } else if (C.id !== 'dinghy') {
    const sprZ = mastBase + mastLen * 0.5, sprLen = C.beam * 0.36;
    const hounds = C.id === 'sportboat' ? C.mastHeight - mastLen * 0.2 : C.mastHeight - 0.25;
    for (const s of [-1, 1]) {
      const tip = V(C.mastX - 0.15, s * sprLen, sprZ + 0.06);
      rigKit.rod(M.alu(), V(C.mastX, s * 0.03, sprZ), tip, 0.018, 6, 0.01);
      const [cx, cy, cz] = chain[(s + 1) / 2];
      rigKit.rod(M.wire(), V(cx, cy, cz + 0.05), tip, 0.0035);           // cap shroud, lower part
      rigKit.rod(M.wire(), tip, V(C.mastX, s * 0.02, hounds), 0.0035);     // cap shroud, upper part
      rigKit.rod(M.wire(), V(cx + 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprZ), 0.003); // forward lower
      rigKit.rod(M.wire(), V(cx - 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprZ), 0.003); // aft lower
    }
    const J = S.jib;
    if (J) rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.004);
    if (S.stay) rigKit.rod(M.wire(), V(S.stay.tackX, 0, S.stay.tackZ), V(S.stay.tackX - S.stay.rake, 0, S.stay.tackZ + S.stay.luff + 0.05), 0.0035);
    const bsX = C.sternX + (C.id === 'blackwatch' ? -0.02 : 0.05);
    stay.backstayTop = V(C.mastX - 0.05, 0, C.mastHeight);
    stay.backstayLow = V(bsX + 0.25, 0, Lx.sheer(0.02) + 0.15);
    rigKit.rod(M.wire(), stay.backstayTop, stay.backstayLow, 0.0035);
    for (const s of [-1, 1]) rigKit.rod(M.wire(), stay.backstayLow, V(bsX + 0.02, s * Lx.bDeck(0.02) * 0.6, Lx.sheer(0.0)), 0.003); // bridle
  }
  rigKit.build(rig);
  // windex at the masthead
  const windex = new THREE.Group(); windex.position.copy(V(C.mastX, 0, C.mastHeight + 0.14));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 6), M.black()); arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.22; windex.add(arrow);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.12, 0.18), M.red()); vane.position.z = 0.15; windex.add(vane);
  rig.add(windex);
  // ---- booms
  const booms = {};
  for (const s of boat.sails) {
    if (s.kind !== 'boom') continue;
    const piv = new THREE.Group();
    const px = s.key === 'main' ? C.mastX - 0.06 : s.tackX, pz = s.key === 'main' ? C.boomZ : s.tackZ + 0.02;
    piv.position.copy(V(px, 0, pz));
    const L = s.foot + 0.08;
    const bgm = lathe([[0.042, 0], [0.047, L * 0.4], [0.04, L * 0.85], [0.03, L], [0, L]], 10);
    bgm.rotateX(Math.PI / 2); bgm.scale(1, 1.3, 1);
    const boomMesh = new THREE.Mesh(bgm, C.id === 'sportboat' ? M.carbon() : M.alu());
    boomMesh.position.y = -0.05; boomMesh.castShadow = true; piv.add(boomMesh);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.08), M.black()); cap.position.set(0, -0.05, L); piv.add(cap);
    if (s.key === 'main' && s.reefs) { // stowed reef bundle along the boom
      const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, L * 0.8, 4, 10), new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.85 }));
      bundle.rotation.x = Math.PI / 2; bundle.position.set(0, 0.03, L * 0.48); bundle.visible = false; piv.add(bundle);
      piv.userData.bundle = bundle;
    }
    rig.add(piv); booms[s.key] = piv;
  }
  // ---- sails
  const sailMeshes = {};
  for (const s of boat.sails) {
    const tex = sailTexture(C, s, s.key === 'main' ? opts.number : null, s.color);
    const m = sailMesh(tex, s.color);
    rig.add(m); sailMeshes[s.key] = m;
  }
  // telltales
  const ttg = new THREE.BufferGeometry();
  ttg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3 * 12), 3));
  ttg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2 * 3 * 12), 3));
  const telltales = new THREE.LineSegments(ttg, new THREE.LineBasicMaterial({ vertexColors: true }));
  telltales.frustumCulled = false; rig.add(telltales);

  kit.build(inner);
  // floating name tag for other sailors
  if (opts.label) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(11,22,31,0.78)'; g.fillRect(0, 8, 256, 48);
    g.fillStyle = '#ff7a1a'; g.fillRect(0, 8, 6, 48);
    g.fillStyle = '#e9eef2'; g.font = '600 30px "Barlow Condensed", Arial Narrow, sans-serif'; g.textBaseline = 'middle';
    g.fillText(opts.label.slice(0, 16), 16, 33);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
    sp.scale.set(0.12, 0.03, 1); sp.position.set(0, C.mastHeight + 1.5, 0); sp.renderOrder = 10;
    root.add(sp);
  }
  return { root, inner, hull, deck, booms, sailMeshes, rudderPivot, rudderPivots, keelMesh, telltales, windex, rig, sprit, extension, tillerEnd,
    lines: Lx, deckH, ck, chain, stay, mastBase };
}

function buildCatStructure(kit, inner, C, Lx, deckH) {
  const half = C.hullSpacing / 2, z = C.freeboard + 0.05;
  const xf = C.mastX - 0.05, xr = C.sternX + 0.45;
  for (const x of [xf, xr]) kit.rod(M.alu(), V(x, -half, z), V(x, half, z), 0.045, 12);           // front and rear beams
  kit.rod(M.alu(), V(C.bowX - 0.1, 0, z - 0.02), V(xf, 0, z), 0.02, 8);                         // centre spine / bow pole base
  // trampoline: mesh between the hulls with a woven texture
  const tex = canvasTex('tramp', 64, 64, (g, w, h) => { g.fillStyle = '#23262b'; g.fillRect(0, 0, w, h); g.fillStyle = '#34383f'; for (let i = 0; i < w; i += 4) { g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 1); } }, 1);
  tex.repeat.set(6, 6);
  const tg = new THREE.PlaneGeometry(C.hullSpacing - 0.35, xf - xr); tg.rotateX(-Math.PI / 2);
  const tramp = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
  tramp.position.copy(V((xf + xr) / 2, 0, z + 0.02)); tramp.receiveShadow = true; inner.add(tramp);
  for (const s of [-1, 1]) kit.rod(M.black(), V(xf, s * (half - 0.18), z + 0.02), V(xr, s * (half - 0.18), z + 0.02), 0.012); // bolt ropes
}

function buildCabin(kit, C, Lx, deckH, bx) {
  // Blackwatch coachroof: cream sides with bronze portlights, varnished eyebrow, teak handrails,
  // companionway with washboards, cambered roof with non-skid, dorade cowls
  const t0 = 0.34, t1 = 0.72, N = 20;
  const pos = [], idx = [], uv = [];
  const cabinW = (t) => 0.74 * (1 - 0.55 * sstep(0.55, 1, (t - t0) / (t1 - t0)) ** 1.5);
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const t = lerp(t0, t1, i / N), x = bx(t), w = cabinW(t);
    const zd = deckH(x, w * 0.98) - 0.01, zr = deckH(x, 0) + 0.44 - 0.04 * (i / N);
    const ring = [];
    const M2 = 10;
    ring.push([w, zd]); ring.push([w * 0.96, zr - 0.06]);
    for (let j = 0; j <= M2; j++) { const u = 1 - j / M2; ring.push([w * 0.94 * u, zr + 0.06 * (1 - u * u)]); }
    rows.push({ x, ring });
  }
  const R = rows[0].ring.length;
  for (let i = 0; i <= N; i++) for (let side = 0; side < 2; side++) for (let j = 0; j < R; j++) {
    const [y, z] = rows[i].ring[j]; pos.push(side ? -y : y, z, -rows[i].x); uv.push(y * 1.5, rows[i].x * 1.5);
  }
  const vid = (i, side, j) => (i * 2 + side) * R + j;
  for (let i = 0; i < N; i++) for (let side = 0; side < 2; side++) for (let j = 0; j < R - 1; j++) {
    const a = vid(i, side, j), b = vid(i + 1, side, j), c = vid(i + 1, side, j + 1), d = vid(i, side, j + 1);
    if (side === 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  // end caps
  for (const [i, flip] of [[0, false], [N, true]]) {
    const base = pos.length / 3;
    const ring = rows[i].ring;
    const cx = rows[i].x, cz = ring[ring.length - 1][1] * 0.5 + ring[0][1] * 0.5;
    pos.push(0, cz, -cx); uv.push(0, 0);
    for (const side of [1, -1]) for (const [y, z] of ring) { pos.push(side * y, z, -cx); uv.push(y, z); }
    const n = ring.length * 2;
    for (let k = 0; k < n - 1; k++) flip ? idx.push(base, base + 2 + k, base + 1 + k) : idx.push(base, base + 1 + k, base + 2 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  kit.add(M.cream(), g);
  // eyebrow trim, portlights, handrails, companionway, dorades
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const t = lerp(t0 + 0.05, t1 - 0.1, k / 2), x = bx(t), w = cabinW(t);
      const z = deckH(x, w) + 0.2;
      const ring = new THREE.TorusGeometry(0.075, 0.016, 8, 18); ring.rotateY(Math.PI / 2); ring.translate(s * (w * 0.985 + 0.004), z, -x);
      kit.add(M.bronze(), ring);
      const gl = new THREE.CircleGeometry(0.066, 16); gl.rotateY(s * Math.PI / 2); gl.translate(s * (w * 0.985 + 0.006), z, -x);
      kit.add(M.glass(), gl);
    }
    const xa = bx(t0 + 0.04), xf = bx(t1 - 0.08), xm = (xa + xf) / 2;
    const zr = deckH(xm, 0) + 0.49;
    kit.box(M.varnish(), 0.035, 0.04, xf - xa, V(xm, s * 0.42, zr + 0.05));
    for (let k = 0; k < 4; k++) kit.box(M.varnish(), 0.035, 0.05, 0.035, V(lerp(xa, xf, (k + 0.5) / 4), s * 0.42, zr + 0.02));
  }
  const xa = bx(t0);
  const zc = deckH(xa, 0);
  kit.box(M.varnish(), 0.62, 0.38, 0.04, V(xa - 0.005, 0, zc + 0.2));                 // washboards
  kit.box(M.cream(), 0.66, 0.05, 0.6, V(xa + 0.25, 0, zc + 0.5));                       // sliding hatch
  for (const s of [-1, 1]) kit.box(M.varnish(), 0.03, 0.05, 0.62, V(xa + 0.25, s * 0.34, zc + 0.47));
  for (const s of [-1, 1]) { // dorade cowl vents
    const x = bx(t1 - 0.06), y = s * 0.35, z = deckH(x, 0) + 0.44;
    kit.box(M.cream(), 0.22, 0.08, 0.28, V(x, y, z + 0.04));
    const curve = new THREE.CatmullRomCurve3([V(x, y, z + 0.08), V(x, y, z + 0.22), V(x + 0.06, y, z + 0.3)]);
    kit.add(M.cream(), new THREE.TubeGeometry(curve, 8, 0.045, 12));
    const mouth = new THREE.CylinderGeometry(0.075, 0.05, 0.08, 14, 1, true);
    mouth.rotateZ(Math.PI / 2); mouth.rotateY(Math.PI / 2); mouth.translate(y, z + 0.3, -(x + 0.1));
    kit.add(M.cowlIn(), mouth);
  }
}

function buildLifelines(kit, C, Lx, stations, deckH, bx) {
  const posts = [];
  const tA = C.id === 'blackwatch' ? 0.1 : 0.06, tB = 0.86;
  const n = Math.round((bx(tB) - bx(tA)) / 0.95);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = lerp(tA, tB, i / n), x = bx(t), y = s * Lx.bDeck(t) * 0.95, z = deckH(x, y);
      const top = V(x, y * 1.02, z + 0.62);
      kit.rod(M.steel(), V(x, y, z), top, 0.012);
      kit.box(M.steel(), 0.05, 0.012, 0.06, V(x, y, z + 0.006));
      pts.push(top);
    }
    posts.push(pts);
    // pushpit and pulpit legs
    const xs = C.sternX + 0.2, ys = s * Lx.bDeck(0.02) * 0.85;
    kit.rod(M.steel(), V(xs, ys, deckH(xs, ys)), V(xs, ys, deckH(xs, ys) + 0.65), 0.014);
    const xb = C.bowX - 0.35, yb = s * Lx.bDeck(tAtX(C, xb)) * 0.8;
    kit.rod(M.steel(), V(xb, yb, deckH(xb, yb)), V(xb, yb, deckH(xb, yb) + 0.62), 0.014);
    // lifelines (upper and middle) as slightly sagging wires
    for (const h of [0, -0.3]) {
      const line = [V(xb, yb, deckH(xb, yb) + 0.62 + h), ...pts.slice().reverse().map(p => p.clone().setY(p.y + h)), V(xs, ys, deckH(xs, ys) + 0.65 + h)];
      kit.add(M.wire(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length * 3, 0.0035, 4));
    }
  }
  // pushpit rail across the stern and pulpit hoop at the bow
  const xs = C.sternX + 0.2, zs = deckH(xs, 0) + 0.65, yw = Lx.bDeck(0.02) * 0.85;
  kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xs, -yw, zs), V(xs - 0.05, 0, zs + 0.02), V(xs, yw, zs)]), 12, 0.014, 6));
  const xb = C.bowX - 0.35, zb = deckH(xb, 0) + 0.62, yb = Lx.bDeck(tAtX(C, xb)) * 0.8;
  kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xb, -yb, zb), V(C.bowX - 0.05, 0, zb + 0.03), V(xb, yb, zb)]), 12, 0.014, 6));
}
const tAtX = (C, x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);

// ================================================================== per-frame
const _v = new THREE.Vector3();
export function updateBoatModel(vis, b, t) {
  const C = b.cls, P = b.pose || b;
  vis.root.position.set(P.x, P.heave, P.z);
  vis.root.rotation.set(0, -P.psi, 0);
  vis.inner.rotation.set(P.pitch, 0, -P.phi, 'YXZ');
  if (vis.rudderPivots && vis.rudderPivots.length) { for (const pv of vis.rudderPivots) pv.rotation.y = b.rudder; vis.rudderPivot.position.x = -Math.sin(b.rudder) * 0.6 * 0; }
  else vis.rudderPivot.rotation.y = b.rudder;
  if (C.keel.twin && vis.keelMesh) vis.keelMesh.position.y = C.freeboard - 0.05 + (1 - b.ctrl.board) * C.keel.span * 0.8;
  else if (C.keel.board && vis.keelMesh) vis.keelMesh.position.y = -C.canoeDraft + 0.41 + (1 - b.ctrl.board) * C.keel.span * 0.8;
  for (const k in vis.booms) {
    vis.booms[k].rotation.y = b.booms[k].a;
    const bundle = vis.booms[k].userData.bundle;
    if (bundle) { const rp = b.reefPos; bundle.visible = rp > 0.03; bundle.scale.set(0.4 + 0.6 * Math.min(1, rp), 1, 0.4 + 0.6 * Math.min(1, rp)); }
  }
  if (vis.sprit) vis.sprit.position.z = -(C.bowX - 0.6) - (C.bowsprit) * b.genDeploy + 0.0;
  for (const s of b.sails) updateSail(vis.sailMeshes[s.key], b, s, t);
  vis.windex.rotation.y = -b.diag.awa + Math.PI;
  updateTelltales(vis, b, t);
}

function updateSail(mesh, boat, s, t) {
  const C = boat.cls, d = boat.diag;
  const sh = d.shape[s.key], st = d.strips[s.key];
  const pos = mesh.geometry.attributes.position.array;
  const areaF = st.areaF ?? 1;
  mesh.visible = areaF > 0.03;
  if (!mesh.visible) return;
  let px, pz, luff, rake = s.rake || 0, footLift = 0;
  if (s.key === 'main') {
    const rf = reefAt(boat.reefPos);
    px = C.mastX - 0.02; pz = C.boomZ; luff = s.luff * rf.l;
    footLift = 0; // reefed sail: the new tack sits on the boom
  } else { px = s.tackX; pz = s.tackZ; luff = s.luff; }
  if (s.kind === 'spin' || s.kind === 'loose') luff *= Math.sqrt(areaF);
  const side = Math.sign(st.baseAngle || 1);
  const slack = s.key === 'main' ? boat.reefSlack : 0;
  for (let v = 0; v <= NV; v++) {
    const fv = v / NV;
    let a, dd, ff;
    const F = STRIP_F;
    if (fv <= F[0]) { const k = fv / F[0]; a = lerp(st.baseAngle ?? 0, sh[0].ang, k); dd = sh[0].d; ff = sh[0].f; }
    else if (fv <= F[1]) { const k = (fv - F[0]) / (F[1] - F[0]); a = lerp(sh[0].ang, sh[1].ang, k); dd = lerp(sh[0].d, sh[1].d, k); ff = lerp(sh[0].f, sh[1].f, k); }
    else if (fv <= F[2]) { const k = (fv - F[1]) / (F[2] - F[1]); a = lerp(sh[1].ang, sh[2].ang, k); dd = lerp(sh[1].d, sh[2].d, k); ff = lerp(sh[1].f, sh[2].f, k); }
    else { const k = (fv - F[2]) / (1 - F[2]); a = sh[2].ang + (sh[2].ang - sh[1].ang) * k * 0.5; dd = sh[2].d; ff = sh[2].f; }
    const si = fv < 0.33 ? 0 : fv < 0.66 ? 1 : 2;
    const flog = st[si].flog || 0, state = st[si].state;
    let chord = s.foot * (1 - fv) + s.head * fv;
    if (s.key === 'main') chord += s.foot * 0.13 * Math.sin(Math.PI * fv) * (s.head / s.foot > 0.2 ? 1 : 0.55);
    if (s.kind === 'spin') chord *= 0.9 + 0.25 * Math.sin(Math.PI * fv);
    const lx = px - rake * fv, lz = pz + footLift + fv * luff * (1 - 0.06 * slack);
    const ca = Math.cos(a), sa = Math.sin(a);
    const cx = -ca, cy = sa, nx = sa * side, ny = ca * side;
    const depth = dd * (1 - 0.8 * flog);
    for (let u = 0; u <= NU; u++) {
      const fu = u / NU;
      const camb = fu < ff ? 1 - (1 - fu / ff) ** 2 : 1 - ((fu - ff) / (1 - ff)) ** 2;
      let off = depth * chord * camb;
      if (flog > 0.05) off += flog * 0.12 * chord * Math.sin(fu * 9 - t * 22 + fv * 4) * fu * (0.5 + 0.5 * Math.sin(t * 7 + fv * 3));
      if (state === 1 && s.kind !== 'spin') off -= 0.25 * flog * depth * chord * Math.max(0, 1 - fu * 3);
      if (slack > 0.05) off += slack * 0.05 * Math.sin(fv * 20 + t * 6) * (1 - fu) * chord; // luff scallops with the halyard off
      const xb = lx + cx * chord * fu + nx * off, yb = cy * chord * fu + ny * off;
      const k = (v * (NU + 1) + u) * 3;
      pos[k] = yb; pos[k + 1] = lz; pos[k + 2] = -xb;
    }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function updateTelltales(vis, b, t) {
  const C = b.cls;
  const pos = vis.telltales.geometry.attributes.position, col = vis.telltales.geometry.attributes.color;
  const head = b.sailBy.jib && (b.diag.strips.jib.areaF ?? 1) > 0.3 ? b.sailBy.jib : b.sailBy.main;
  const st = b.diag.strips[head.key], sh = b.diag.shape[head.key];
  let n = 0;
  const px = head.key === 'main' ? C.mastX : head.tackX, pz = head.key === 'main' ? C.boomZ : head.tackZ;
  const side = Math.sign(st.baseAngle || 1);
  for (let i = 0; i < 3; i++) {
    const fv = STRIP_F[i], s = st[i], a = sh[i].ang;
    const chord = head.foot * (1 - fv) + head.head * fv;
    const cx = -Math.cos(a), cy = Math.sin(a);
    const baseX = px - (head.rake || 0) * fv + cx * chord * 0.12, baseY = cy * chord * 0.12, baseZ = pz + fv * head.luff;
    for (const ws of [-1, 1]) {
      const nx = Math.sin(a) * side * ws * 0.02, ny = Math.cos(a) * side * ws * 0.02;
      let dx = cx, dy = cy, dz = 0;
      if (s.state === 3 && ws > 0) { dx = cx * 0.2 + Math.sin(t * 9 + i) * 0.5; dy = cy * 0.2 + Math.cos(t * 7 + i) * 0.5; dz = 0.7; }
      else if (s.state === 1 && ws < 0) { dx = cx * 0.3 + Math.sin(t * 11) * 0.4; dy = cy * 0.3 - side * 0.5; dz = 0.6; }
      else dy += Math.sin(t * 13 + i * 2 + ws) * 0.05;
      const L = 0.28, k = n * 2;
      pos.setXYZ(k, baseY + ny, baseZ, -(baseX + nx));
      pos.setXYZ(k + 1, baseY + ny + dy * L, baseZ + dz * L, -(baseX + nx + dx * L));
      const c = ws * side > 0 ? [0.1, 0.8, 0.3] : [0.9, 0.15, 0.15];
      col.setXYZ(k, ...c); col.setXYZ(k + 1, ...c);
      n++;
    }
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  vis.telltales.geometry.setDrawRange(0, n * 2);
}
