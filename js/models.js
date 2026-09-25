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
  hull: (C) => mat('hull-' + C.id, () => hullMaterial(C)),
  teak: () => mat('teak', () => new THREE.MeshStandardMaterial({ map: teakTex(), roughness: 0.75, side: THREE.DoubleSide })),
  varnish: () => mat('varnish', () => new THREE.MeshStandardMaterial({ map: teakTex(), roughness: 0.25, color: 0xd9b48a })),
  deck: (tint) => mat('deck' + tint, () => new THREE.MeshStandardMaterial({ map: nonskidTex(tint), roughness: 0.85, side: THREE.DoubleSide })),
  steel: () => mat('steel', () => new THREE.MeshStandardMaterial({ color: 0xd4d8dc, roughness: 0.22, metalness: 0.9 })),
  alu: () => mat('alu', () => new THREE.MeshStandardMaterial({ color: 0xc3c7cb, roughness: 0.38, metalness: 0.55 })),   // anodised: silver, not a mirror
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

// Gelcoat topsides (vertex colour) over bottom paint, a boot top and a cove stripe cut crisp at their
// heights; matte antifouling, a faint waterline scum line and a slightly weathered gloss.
function hullMaterial(C) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.02, side: THREE.DoubleSide });
  const U = {
    uAnti: { value: new THREE.Color(C.hull.boot) }, uBoot: { value: new THREE.Color(C.hull.bootTop ?? 0xf2f2ee) },
    uStripe: { value: new THREE.Color(C.hull.stripe) },
    // anti top, boot top, stripe below sheer (upper, lower); a dry-sailed dinghy has a bare gelcoat bottom
    uLevels: { value: C.id === 'dinghy' ? new THREE.Vector4(-9, -9, 0.1, 0.075) : new THREE.Vector4(0.04, C.hull.bootTop !== undefined ? 0.04 : 0.1, 0.12, 0.085) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float sheerZ; varying float vSheerZ; varying float vHullZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSheerZ = sheerZ; vHullZ = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSheerZ; varying float vHullZ; uniform vec3 uAnti, uBoot, uStripe; uniform vec4 uLevels; float hullAnti = 0.0;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float z = vHullZ, aa = max(fwidth(z), 1e-4);
          float anti = 1.0 - smoothstep(uLevels.x - aa, uLevels.x + aa, z);
          float boot = (1.0 - smoothstep(uLevels.y - aa, uLevels.y + aa, z)) * (1.0 - anti);
          float st = smoothstep(vSheerZ - uLevels.z - aa, vSheerZ - uLevels.z + aa, z) * (1.0 - smoothstep(vSheerZ - uLevels.w - aa, vSheerZ - uLevels.w + aa, z));
          vec3 c = mix(diffuseColor.rgb, uStripe, st);
          c = mix(c, uBoot, boot);
          c = mix(c, uAnti, anti);
          // scum line just above the boot top, and a little grime low on the topsides
          float scum = exp(-pow((z - uLevels.y - 0.018) / 0.01, 2.0)) * (1.0 - anti) * (1.0 - boot);
          c *= 1.0 - 0.1 * scum;
          c = mix(c, c * vec3(0.93, 0.92, 0.88), (1.0 - smoothstep(uLevels.y, uLevels.y + 0.25, z)) * (1.0 - anti) * 0.5);
          diffuseColor.rgb = c; hullAnti = anti;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.82, hullAnti);');
  };
  m.customProgramCacheKey = () => 'hullpaint';
  return m;
}

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
  // topsides colour per vertex (fleet boats differ); bottom paint, boot top and cove stripe are drawn
  // crisp in the hull shader from each point's height and its station's sheer height
  const pos = [], col = [], shr = [];
  const cTop = new THREE.Color(C.hull.color);
  for (let s = 0; s <= NS; s++) for (let k = 0; k < NP; k++) for (let side = 0; side < 2; side++) {
    const [x, y, z] = stations[s][k];
    pos.push(yOff + (side ? -y : y), z, -x);
    col.push(cTop.r, cTop.g, cTop.b); shr.push(stations[s][0][2]);
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
  for (let k = 0; k < NP; k++) { const [x, y, z] = st[k]; pos.push(yOff + y, z, -x, yOff - y, z, -x); col.push(cTop.r, cTop.g, cTop.b, cTop.r, cTop.g, cTop.b); shr.push(st[0][2], st[0][2]); }
  for (let k = 0; k < NP - 1; k++) { const a = tBase + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sheerZ', new THREE.Float32BufferAttribute(shr, 1));
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

// deck height at (x fwd, y stbd) — used to seat fittings
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
// Sailcloth per class: the Blackwatch carries tanbark cruising Dacron (crosscut, rust-red, the dye a
// little uneven from panel to panel), the sportboat a grey racing laminate (tri-radial panels,
// load-path scrim, draft stripes), the dinghy white Dacron. Gennakers are nylon in the class colour.
// Texture space: x = 0 leech .. w luff, y = 0 head .. h foot.
const SAILCLOTH = {
  blackwatch: { cloth: 0x9c4f2e, kind: 'dacron', mottle: true, num: '#efe6d2', logo: '#1c1d21', trans: 0.26, rough: 0.66 },
  sportboat: { cloth: 0xd5d8d8, kind: 'laminate', num: '#16233a', logo: '#1d4e89', trans: 0.16, rough: 0.42 },
  dinghy: { cloth: 0xf5f4ef, kind: 'dacron', num: '#1d2a44', logo: '#c8412c', trans: 0.34, rough: 0.6 },
  cat: { cloth: 0xeef0f2, kind: 'laminate', num: '#1d2a44', logo: '#d9412b', trans: 0.2, rough: 0.45 },
};
const clothOf = (C, s) => s.kind === 'spin' ? { cloth: s.color, kind: 'nylon', num: '#ffffff', logo: '#ffffff', trans: 0.45, rough: 0.5 } : (SAILCLOTH[C.id] || SAILCLOTH.dinghy);
// One cloth texture per class and sail, shared by both faces and every boat of the class. The sail
// number and insignia are a small decal atlas per number (DECAL), drawn by the sail shader into fixed
// rectangles of the cloth, mirrored on the face that needs it (starboard number higher, as class
// rules have it).
function sailTexture(C, s) {
  const cl = clothOf(C, s);
  const key = `sail-${C.id}-${s.key}-${cl.cloth}`;
  return canvasTex(key, 512, 1024, (g, w, h) => {
    const base = new THREE.Color(cl.cloth);
    g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, w, h);
    const r = rnd(s.key.length * 7 + 3);
    // seams perpendicular to the leech: across the sail, sloping down toward the luff
    const slope = (y) => { const v = 1 - y / h, chord = s.foot * (1 - v) + s.head * v; return h * chord * (s.foot - s.head) / (s.luff * s.luff); };
    const seam = (y0, alpha = 0.13) => {
      g.strokeStyle = `rgba(40,35,30,${alpha})`; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0 + slope(y0)); g.stroke();
      g.strokeStyle = `rgba(255,255,255,${alpha * 0.9})`; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y0 + 3); g.lineTo(w, y0 + 3 + slope(y0)); g.stroke();
    };
    const panelPx = h * 0.9 / s.luff;
    if (cl.kind === 'laminate') {
      // tri-radial: fans of panels from the head, clew and tack, crosscut through the middle band
      const fan = (cx, cy, pts, a = 0.14) => { g.strokeStyle = `rgba(30,35,40,${a})`; g.lineWidth = 2; for (const [x, y] of pts) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke(); } };
      fan(w * 0.5, -4, Array.from({ length: 7 }, (_, i) => [w * i / 6, h * 0.42]));
      fan(-4, h + 4, Array.from({ length: 5 }, (_, i) => [w * (0.1 + i * 0.18), h * 0.66]));
      fan(w + 4, h + 4, Array.from({ length: 4 }, (_, i) => [w * (0.35 + i * 0.2), h * 0.7]));
      for (let y = h * 0.42; y < h * 0.68; y += panelPx * 0.9) seam(y, 0.12);
      // scrim: load-path fibres radiating from the corners, fine and dark
      g.lineWidth = 1;
      for (let i = 0; i < 90; i++) {
        const c = i % 3, a = 0.05 + r() * 0.05; g.strokeStyle = `rgba(20,24,30,${a})`; g.beginPath();
        if (c === 0) { g.moveTo(w * 0.5, 0); g.lineTo(r() * w, h * (0.5 + r() * 0.5)); }
        else if (c === 1) { g.moveTo(0, h); g.lineTo(r() * w, r() * h * 0.8); }
        else { g.moveTo(w, h); g.lineTo(r() * w * 0.9, h * (0.2 + r() * 0.7)); }
        g.stroke();
      }
      // grid scrim at a fine pitch
      g.strokeStyle = 'rgba(20,24,30,0.035)';
      for (let x = 0; x < w; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.25, h); g.stroke(); }
      for (let x = -h * 0.25; x < w; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - h * 0.2 + h * 0.45, h); g.stroke(); }
    } else if (cl.kind === 'nylon') {
      // gennaker: horizontal panels, a radial head, a lighter centre band
      for (let y = h * 0.28; y < h; y += panelPx * 1.1) seam(y, 0.16);
      g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 2;
      for (let i = 0; i <= 6; i++) { g.beginPath(); g.moveTo(w * 0.5, 0); g.lineTo(w * i / 6, h * 0.28); g.stroke(); }
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, h * 0.44, w, h * 0.12);
    } else {
      // crosscut Dacron with a faint weave
      if (cl.mottle) {
        // tanbark: each panel dyed a shade apart, with soft cloudy blotches through the cloth
        for (let y = panelPx * 0.6 - panelPx, i = 0; y < h + 40; y += panelPx, i++) {
          const k = r() - 0.5;
          g.fillStyle = k > 0 ? `rgba(255,190,150,${k * 0.1})` : `rgba(40,10,0,${-k * 0.14})`;
          g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + slope(y)); g.lineTo(w, y + panelPx + slope(y + panelPx)); g.lineTo(0, y + panelPx); g.fill();
        }
        for (let i = 0; i < 26; i++) {
          const x = r() * w, y = r() * h, rad = 30 + r() * 90, dark = r() < 0.55;
          const grd = g.createRadialGradient(x, y, 0, x, y, rad);
          grd.addColorStop(0, dark ? 'rgba(50,15,0,0.07)' : 'rgba(255,200,160,0.06)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
        }
      }
      for (let y = panelPx * 0.6; y < h + 40; y += panelPx) seam(y);
      g.fillStyle = cl.mottle ? 'rgba(0,0,0,0.035)' : 'rgba(0,0,0,0.018)';
      for (let i = 0; i < 4000; i++) g.fillRect(r() * w, r() * h, 2, 1);
    }
    // soft creases from the clew toward the luff: sails are never paint-smooth
    for (let i = 0; i < 10; i++) {
      const y = h * (0.35 + r() * 0.6), grd = g.createLinearGradient(0, y, w * 0.7, y - h * 0.15);
      grd.addColorStop(0, 'rgba(0,0,0,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.strokeStyle = grd; g.lineWidth = 3 + r() * 5; g.beginPath(); g.moveTo(0, y); g.lineTo(w * (0.4 + r() * 0.3), y - h * (0.05 + r() * 0.1)); g.stroke();
    }
    // corner reinforcement: layered patches radiating from tack, clew and head
    const patch = (cx, cy, rads, a0, a1) => { for (const rad of rads) { g.fillStyle = 'rgba(0,0,0,0.035)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, rad, a0, a1); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rad, a0, a1); g.stroke(); } };
    patch(w, h, [36, 62, 88], Math.PI, Math.PI * 1.5);            // tack
    patch(0, h, [36, 62, 88], Math.PI * 1.5, Math.PI * 2);        // clew
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, h * 0.05); // head patch (the top row is the head)
    if (s.key === 'main' && s.head > 0.12) { g.fillStyle = 'rgba(150,155,160,0.9)'; g.fillRect(w * 0.45, 0, w * 0.55, h * 0.018); } // headboard
    // tapes: leech, luff (bolt rope / luff tape), foot
    g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, 0, 7, h);
    g.fillStyle = s.kind === 'loose' || s.kind === 'spin' ? 'rgba(40,40,45,0.35)' : 'rgba(0,0,0,0.16)'; g.fillRect(w - 10, 0, 10, h);
    g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, h - 7, w, 7);
    // stitch lines along the tapes
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.setLineDash([4, 5]); g.lineWidth = 1;
    for (const x of [10, w - 13]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.setLineDash([]);
    // draft stripes on the racing sails
    if (cl.kind === 'laminate' && s.kind !== 'spin') {
      g.fillStyle = 'rgba(20,32,60,0.75)';
      for (const f of [0.25, 0.5, 0.75]) { const y = h * (1 - f); g.fillRect(w * 0.1, y - 3, w * 0.9, 6); }
    }
    if (s.key === 'main') {
      // batten pockets, perpendicular to the leech, stitched
      const bat = C.id === 'blackwatch' ? [[0.2, 0.18], [0.4, 0.2], [0.6, 0.2], [0.8, 0.16]] : C.id === 'dinghy' ? [[0.3, 0.2], [0.55, 0.22], [0.8, 0.18]]
        : [[0.2, 0.25], [0.42, 0.3], [0.64, 0.35], [0.86, 1.0]];
      for (const [f, len] of bat) {
        const y = h * (1 - f), L = w * len, dy = slope(y) * len;
        g.save(); g.translate(0, y); g.rotate(Math.atan2(dy, L));
        const Lr = Math.hypot(L, dy);
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(0, -9, Lr, 18);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, -10, Lr, 2); g.fillRect(0, 8, Lr, 2); g.fillRect(Lr - 6, -10, 6, 20);
        g.restore();
      }
      if (s.reefs) for (const rf of [0.16, 0.31]) { // reef points with a cringle at each end
        const y = h - rf * h;
        g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, y - 8, w, 16);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        for (let x = 30; x < w - 30; x += 40) g.fillRect(x, y - 2, 3, 16);
        g.fillStyle = 'rgba(120,110,95,0.9)'; g.beginPath(); g.arc(w - 14, y, 10, 0, 7); g.arc(14, y, 10, 0, 7); g.fill();
      }
    }
    if (s.kind === 'loose' || (s.key === 'main' && C.id === 'dinghy')) { // window
      const [wx, wy, ww, wh] = s.kind === 'loose' ? [w * 0.35, h * 0.7, w * 0.32, h * 0.12] : [w * 0.3, h * 0.66, w * 0.4, h * 0.1];
      g.fillStyle = 'rgba(70,95,110,0.55)'; g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 5; g.strokeRect(wx, wy, ww, wh);
    }
  });
}

// Insignia and sail number atlas (512 x 256): the class insignia in the top-left 256 x 96 band, the
// number in the 512 x 160 band below. Each band maps onto a rectangle of the 512 x 1024 cloth texture
// (DECAL rects, in cloth pixels: x0, y0, width, height; the number sits lower on the port face).
const DECAL = { logo: [0.58 * 512 - 128, 0.24 * 1024 - 76, 256, 96], numStbd: [0.52 * 512 - 256, 0.47 * 1024 - 130, 512, 160], numPort: [0.52 * 512 - 256, 0.58 * 1024 - 130, 512, 160] };
function sailDecal(C, number) {
  const cl = SAILCLOTH[C.id] || SAILCLOTH.dinghy;
  return canvasTex(`decal-${C.id}-${number ?? ''}`, 512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    const logo = C.id === 'blackwatch' ? 'BW' : C.id === 'sportboat' ? 'S23' : C.id === 'dinghy' ? 'S14' : 'C16';
    g.font = 'bold 74px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillStyle = cl.logo; g.fillText(logo, 128, 76);
    if (number) { g.font = 'bold 150px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillStyle = cl.num; g.fillText(String(number), 256, 226); }
  });
}

// ------------------------------------------------------------------ sails
// Sailcloth is thin: sunlight on one face shows through the other (a backlit sail glows and its
// seams and battens show), so the diffuse term also takes light from behind the cloth.
function sailMaterial(tex, cl, side, decal = null, mirror = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, side, roughness: cl.rough, metalness: 0 });
  m.shadowSide = THREE.DoubleSide;
  const uTrans = { value: cl.trans };
  const nr = mirror ? DECAL.numPort : DECAL.numStbd;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTrans = uTrans;
    if (decal) {
      sh.uniforms.uDecal = { value: decal }; sh.uniforms.uMirror = { value: mirror ? 1 : 0 };
      sh.uniforms.uLogoR = { value: new THREE.Vector4(...DECAL.logo) }; sh.uniforms.uNumR = { value: new THREE.Vector4(...nr) };
      sh.fragmentShader = 'uniform sampler2D uDecal;\nuniform float uMirror;\nuniform vec4 uLogoR, uNumR;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 cc = vec2(vMapUv.x, 1.0 - vMapUv.y) * vec2(512.0, 1024.0);
        vec4 dc = vec4(0.0);
        vec2 l = (cc - uLogoR.xy) / uLogoR.zw;
        if (l.x >= 0.0 && l.y >= 0.0 && l.x < 1.0 && l.y < 1.0) { if (uMirror > 0.5) l.x = 1.0 - l.x; dc = texture2D(uDecal, vec2(l.x * 0.5, 1.0 - l.y * 0.375)); }
        vec2 q = (cc - uNumR.xy) / uNumR.zw;
        if (q.x >= 0.0 && q.y >= 0.0 && q.x < 1.0 && q.y < 1.0) { if (uMirror > 0.5) q.x = 1.0 - q.x; dc = texture2D(uDecal, vec2(q.x, 1.0 - (0.375 + q.y * 0.625))); }
        diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a);
      }`);
    }
    sh.fragmentShader = 'uniform float uTrans;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
          float bk = max(0.0, -dot(normal, directionalLights[i].direction));
          reflectedLight.directDiffuse += diffuseColor.rgb * diffuseColor.rgb * directionalLights[i].color * bk * uTrans;
        }
      #endif`);
  };
  m.customProgramCacheKey = () => decal ? 'sailcloth-decal' : 'sailcloth';
  return m;
}
const NU = 12, NV = 18;
function sailMesh(C, s, number) {
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
  const cl = clothOf(C, s);
  // front faces look to port, back faces to starboard: one material per face so both read right
  const tex = sailTexture(C, s), decal = s.key === 'main' ? sailDecal(C, number) : null;
  const mesh = new THREE.Mesh(g, sailMaterial(tex, cl, THREE.FrontSide, decal, true));
  const back = new THREE.Mesh(g, sailMaterial(tex, cl, THREE.BackSide, decal, false));
  back.frustumCulled = false; mesh.add(back);
  mesh.castShadow = true; mesh.frustumCulled = false;
  back.customDepthMaterial = null; back.castShadow = false;
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
    hull = new THREE.Mesh(r.geom, M.hull(C));
    hull.castShadow = true; hull.receiveShadow = true;
    inner.add(hull);
  }
  const bx = (t) => lerp(C.sternX, C.bowX, t);
  const tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  // ---- cockpit layout per class
  const ck = C.id === 'blackwatch' ? { t0: 0.07, t1: 0.33, w: 0.5, sole: 0.38 }
    : C.id === 'sportboat' ? { t0: 0.0, t1: 0.44, w: 0.66, sole: 0.3 }
    : { t0: 0.12, t1: 0.66, w: 0.55, sole: 0.14 };
  const deckH0 = deckHeightFn(C, Lx, ck);
  // top surface: the deck, or the cabin roof where there is a coachroof (fittings sit on whichever is on top)
  const cab = C.id === 'blackwatch' ? { t0: 0.34, t1: 0.72, h: 0.44, w: (t) => 0.74 * (1 - 0.55 * sstep(0.55, 1, (t - 0.34) / 0.38) ** 1.5) }
    : C.id === 'sportboat' ? { t0: 0.46, t1: 0.72, h: 0.16, w: () => 0.56 } : null;
  const deckH = (x, y) => {
    const z = deckH0(x, y);
    if (!cab) return z;
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    return t > cab.t0 && t < cab.t1 && Math.abs(y) < cab.w(t) ? deckH0(x, 0) + cab.h : z;
  };
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
      kit.box(M.varnish(), 0.035, 0.22, L * 1.02, V(xm, s * (cw + 0.02), deckH0(xm, s * (cw + 0.05)) + 0.08)); // coamings
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
  if (C.id === 'blackwatch') buildCabin(kit, C, Lx, deckH0, bx);
  if (C.id === 'sportboat') {
    const xa = bx(0.46), xf = bx(0.72), L = xf - xa;
    const w = 0.62;
    const cab = new THREE.BoxGeometry(w * 2, 0.16, L, 1, 1, 1);
    const p = cab.attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.9); if (p.getZ(i) < 0) p.setY(i, p.getY(i) - 0.04); } }
    cab.computeVertexNormals();
    cab.translate(0, deckH0((xa + xf) / 2, 0) + 0.06, -(xa + xf) / 2);
    kit.add(M.deck('#dfe2e2'), cab);
    kit.box(M.glass(), w * 1.6, 0.05, 0.02, V(xf - 0.02, 0, deckH0(xf, 0) + 0.1)); // forward windows
    for (const s of [-1, 1]) kit.box(M.glass(), 0.02, 0.05, L * 0.6, V((xa + xf) / 2, s * w * 0.96, deckH0(xa, 0) + 0.1));
    kit.box(M.black(), 0.5, 0.03, 0.5, V(xa + 0.3, 0, deckH0(xa, 0) + 0.15)); // hatch
    // deck organisers either side of the mast: the halyards and control lines turn aft here to the clutches
    for (const s of [-1, 1]) {
      const ox = C.mastX - 0.28, oy = s * 0.2, oz = deckH(ox, oy);
      kit.box(M.black(), 0.16, 0.012, 0.06, V(ox, oy, oz + 0.006));
      for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12); g.rotateZ(Math.PI / 2); g.translate(oy + (i - 1) * 0.045, oz + 0.026, -ox); kit.add(M.alu(), g); }
    }
    // forward hatch on the foredeck, and the mast-mounted compass / tactical display facing the cockpit
    const hx = bx(0.8), hz = deckH(hx, 0);
    kit.box(M.alu(), 0.46, 0.03, 0.46, V(hx, 0, hz + 0.012)); kit.box(M.glass(), 0.4, 0.012, 0.4, V(hx, 0, hz + 0.03));
    kit.box(M.black(), 0.13, 0.1, 0.03, V(C.mastX - 0.08, 0, deckH(C.mastX, 0) + 1.55));
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
      sprit = new THREE.Mesh(g, M.carbon()); sprit.castShadow = true; sprit.userData.len = L;
      sprit.position.copy(V(C.bowX + 0.05 - L, 0, Lx.sheer(1) - 0.06));
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
  const mastBase = deckH(C.mastX, 0) + 0.02;
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
      const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, L * 0.8, 4, 10), new THREE.MeshStandardMaterial({ color: clothOf(C, s).cloth, roughness: 0.85 }));
      bundle.rotation.x = Math.PI / 2; bundle.position.set(0, 0.03, L * 0.48); bundle.visible = false; piv.add(bundle);
      piv.userData.bundle = bundle;
    }
    rig.add(piv); booms[s.key] = piv;
  }
  // ---- sails
  const sailMeshes = {};
  for (const s of boat.sails) {
    const m = sailMesh(C, s, s.key === 'main' ? opts.number : null);
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
  for (const s of [-1, 1]) { // low mushroom vents: clear of the main boom and staysail club
    const x = bx(t1 - 0.12), y = s * 0.3, z = deckH(x, 0) + 0.44;
    const g = new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16); g.translate(y, z + 0.025, -x);
    kit.add(M.bronze(), g);
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
    vis.booms[k].rotation.set(-(b.booms[k].elev || 0), b.booms[k].a, 0, 'YXZ');   // (a cloth sail's boom lifts)
    const bundle = vis.booms[k].userData.bundle;
    if (bundle) { const rp = b.reefPos; bundle.visible = rp > 0.03; bundle.scale.set(0.4 + 0.6 * Math.min(1, rp), 1, 0.4 + 0.6 * Math.min(1, rp)); }
  }
  // retracted, the pole's tip sits just proud of the stem (the rest is in its tube inside the hull)
  if (vis.sprit) vis.sprit.position.z = -(C.bowX + 0.05 - vis.sprit.userData.len) - C.bowsprit * b.genDeploy;
  for (const s of b.sails) updateSail(vis.sailMeshes[s.key], b, s, t);
  vis.windex.rotation.y = -b.diag.awa + Math.PI;
  updateTelltales(vis, b, t);
}

// A cloth sail (js/sail/cloth.js) drawn from its own nodes: Catmull-Rom through the cloth grid onto the mesh's
// (u, v) chart (u = 0 at the luff, v = 0 at the foot), rig frame (x fwd, y stbd, z up) -> [y, z, -x]
function clothToMesh(mesh, rig) {
  const c = rig.cloth, nu = c.nu, nv = c.nv, off = c.off, X = c.x, pos = mesh.geometry.attributes.position.array;
  const P = (i, j, k) => {
    // nodes outside the grid are extrapolated linearly
    const ii = i < 0 ? 0 : i >= nu ? nu - 1 : i, jj = j < 0 ? 0 : j >= nv ? nv - 1 : j;
    let v = X[3 * (off + jj * nu + ii) + k];
    if (i < 0) v = 2 * v - X[3 * (off + jj * nu + 1) + k]; else if (i >= nu) v = 2 * v - X[3 * (off + jj * nu + nu - 2) + k];
    if (j < 0) v = 2 * v - X[3 * (off + nu + ii) + k]; else if (j >= nv) v = 2 * v - X[3 * (off + (nv - 2) * nu + ii) + k];
    return v;
  };
  const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 + p3 - 3 * p2) * t * t * t);
  const col = [0, 0, 0, 0];
  for (let v = 0; v <= NV; v++) {
    const fv = v / NV * (nv - 1), j = Math.min(nv - 2, Math.floor(fv)), tv = fv - j;
    for (let u = 0; u <= NU; u++) {
      const fu = u / NU * (nu - 1), i = Math.min(nu - 2, Math.floor(fu)), tu = fu - i, k = (v * (NU + 1) + u) * 3;
      for (let a = 0; a < 3; a++) {
        for (let q = 0; q < 4; q++) col[q] = cr(P(i - 1, j - 1 + q, a), P(i, j - 1 + q, a), P(i + 1, j - 1 + q, a), P(i + 2, j - 1 + q, a), tu);
        const w = cr(col[0], col[1], col[2], col[3], tv);
        if (a === 0) pos[k + 2] = -w; else if (a === 1) pos[k] = w; else pos[k + 1] = w;
      }
    }
  }
  mesh.visible = true;
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function updateSail(mesh, boat, s, t) {
  const rig = boat.sailSys && boat.sailSys.active(boat) ? boat.sailSys.cloth(s.key) : null;
  if (rig) { if ((boat.diag.strips[s.key].areaF ?? 1) < 0.3) mesh.visible = false; else clothToMesh(mesh, rig); return; }
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
    if (s.key === 'main') chord += s.foot * 0.07 * Math.sin(Math.PI * fv * 0.85);
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
      pos[k] = yb; pos[k + 1] = lz + (s.footRise || 0) * fu * (1 - fv); pos[k + 2] = -xb;
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
  // a cloth sail: the telltales sit on the cloth itself
  const act = b.sailSys && b.sailSys.active(b), hRig = act && b.sailSys.cloth(head.key), mRig = act && b.sailSys.cloth('main');
  const _q = updateTelltales._q || (updateTelltales._q = [0, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const fv = STRIP_F[i], s = st[i], a = sh[i].ang;
    const chord = head.foot * (1 - fv) + head.head * fv;
    const cx = -Math.cos(a), cy = Math.sin(a);
    let baseX = px - (head.rake || 0) * fv + cx * chord * 0.12, baseY = cy * chord * 0.12, baseZ = pz + fv * head.luff;
    if (hRig) { hRig.cloth.sample(hRig.cloth.x, 0.12, fv, _q); baseX = _q[0]; baseY = _q[1]; baseZ = _q[2]; }
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
  // leech telltales on the main, at the batten ends: they stream aft off the leech while the flow
  // leaves it cleanly, and curl round behind the leeward side when that strip stalls
  const ms = b.sailBy.main, mst = b.diag.strips.main, msh = b.diag.shape.main;
  if (ms && (mst.areaF ?? 1) > 0.3) {
    const rf = reefAt(b.reefPos), mside = Math.sign(mst.baseAngle || 1);
    for (let i = 0; i < 3; i++) {
      const fv = STRIP_F[i], s = mst[i], a = msh[i].ang;
      const chord = ms.foot * (1 - fv) + ms.head * fv + ms.foot * 0.07 * Math.sin(Math.PI * fv * 0.85);
      const cx = -Math.cos(a), cy = Math.sin(a), lx = Math.sin(a) * mside, ly = Math.cos(a) * mside; // chord aft, leeward normal
      let baseX = C.mastX - 0.02 + cx * chord, baseY = cy * chord, baseZ = C.boomZ + fv * ms.luff * rf.l;
      if (mRig) { mRig.cloth.sample(mRig.cloth.x, 1, fv, _q); baseX = _q[0]; baseY = _q[1]; baseZ = _q[2]; }
      let dx = cx, dy = cy, dz = -0.08;
      const flog = s.flog || 0;
      if (s.state === 3) { dx = -cx * 0.25 + lx * 0.75 + Math.sin(t * 8 + i * 1.7) * 0.2; dy = -cy * 0.25 + ly * 0.75 + Math.cos(t * 6 + i) * 0.2; dz = -0.45; }
      else if (s.state === 0) { dx = cx * 0.15; dy = cy * 0.15; dz = -1; }
      else { const w = Math.sin(t * 14 + i * 2) * (0.06 + 0.3 * flog + (s.state === 1 ? 0.12 : 0)); dx += lx * w; dy += ly * w; }
      const L = 0.3, k = n * 2;
      pos.setXYZ(k, baseY, baseZ, -baseX);
      pos.setXYZ(k + 1, baseY + dy * L, baseZ + dz * L, -(baseX + dx * L));
      col.setXYZ(k, 1, 0.7, 0.1); col.setXYZ(k + 1, 1, 0.7, 0.1);
      n++;
    }
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  vis.telltales.geometry.setDrawRange(0, n * 2);
}
