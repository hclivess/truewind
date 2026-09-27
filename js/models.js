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
  // faired and painted foils (the J/70's lead keel and its bulb)
  paint: () => mat('keelpaint', () => new THREE.MeshStandardMaterial({ color: 0x1e2124, roughness: 0.55, metalness: 0.05 })),
  // satin-black painted carbon (J/70 mast, boom and sprit) with the class's white measurement bands
  satin: () => mat('satin', () => new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.55, metalness: 0.15 })),
  band: () => mat('band', () => new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.5 })),
  rust: () => mat('rust', () => new THREE.MeshStandardMaterial({ map: rustTex(), roughness: 0.9, metalness: 0.35 })),
  scrap: () => mat('scrap', () => new THREE.MeshStandardMaterial({ map: rustTex(), color: 0x9a9a92, roughness: 0.7, metalness: 0.6 })),
};
// rusty steel: orange-brown oxide over grey plate, pitted, with darker runs
function rustTex() {
  return canvasTex('rust', 128, 128, (g, w, h) => {
    const r = rnd(11);
    g.fillStyle = '#6d4a33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = r() * w, y = r() * h, s = 2 + r() * 10; g.fillStyle = r() < 0.5 ? `rgba(150,78,30,${0.2 + r() * 0.4})` : `rgba(60,52,46,${0.2 + r() * 0.4})`; g.fillRect(x, y, s, s * (0.5 + r())); }
    for (let i = 0; i < 20; i++) { const x = r() * w; g.fillStyle = 'rgba(90,40,15,0.25)'; g.fillRect(x, 0, 1 + r() * 3, h); }
  }, 1);
}

// a weathered hull's topsides: rust runs down from every fitting, stains and scrapes, patches of filler
function weatherTex() {
  return canvasTex('weather', 256, 256, (g, w, h) => {
    const r = rnd(23);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 22; i++) { const x = r() * w, y = r() * h * 0.5, L = 30 + r() * 160, wd = 1 + r() * 4;
      const grd = g.createLinearGradient(0, y, 0, y + L); grd.addColorStop(0, `rgba(120,55,20,${0.35 + r() * 0.4})`); grd.addColorStop(1, 'rgba(120,55,20,0)');
      g.fillStyle = grd; g.fillRect(x, y, wd, L); }
    for (let i = 0; i < 6; i++) { const x = r() * w, y = r() * h, rad = 20 + r() * 50, grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, `rgba(${90 + r() * 60},${70 + r() * 40},${50 + r() * 30},0.3)`); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad); }
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(40,35,30,${0.15 + r() * 0.2})`; g.lineWidth = 1; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 8); g.stroke(); }
  }, 1);
}


// What a class's drawn boat has. A class can set any of these in its C.hull (js/physics.js CLASSES); the four
// original classes keep their hand-set looks (drawn by id further down), so these fallbacks only fill in the rest.
export function lookOf(C) {
  if (C._look) return C._look;
  const id = C.id, H = C.hull || {}, dinghy = id === 'dinghy', bw = id === 'blackwatch', sb = id === 'sportboat';
  return (C._look = {
    // cockpit well (t along the hull 0 stern .. 1 bow, half-width as a fraction of the deck's, sole height)
    cockpit: H.cockpit ?? null,
    // a coachroof: extent, height h over the deck at the centreline, half-width w (m); wood: a varnished trunk
    cabin: H.cabin ?? null,
    deckTint: H.deckTint ?? null,
    wood: H.wood ?? bw,                                                   // teak trim, bronze fittings, varnished tiller
    lifelines: !!H.lifelines,                                             // pulpit, pushpit, stanchions and two lifelines
    benches: !!H.benches,
    liftingRudder: C.rudder.lifting ?? dinghy,                           // a dinghy's blade in a stock on the transom
    extension: H.extension ?? (!bw && !C.wheel),
    tillerLen: H.tillerLen ?? (dinghy ? 0.9 : 1.15),
    hounds: C.houndsF ?? null,                                            // forestay / shroud height, fraction of the mast from the top
    weathered: !!H.weathered,                                             // salvaged: rust streaks, patched sails, scrap
    noNumber: !!H.noNumber,
    // batten pockets drawn on the main: from C.battens (the cloth's own rows) where a class gives them
    battens: C.battens ? C.battens.rows.map((f) => [f, C.battens.full ? 1 : f > 0.8 ? 0.2 : 0.24]) : null,
  });
}

// Gelcoat topsides (vertex colour) over bottom paint, a boot top and a cove stripe cut crisp at their
// heights; matte antifouling, a faint waterline scum line and a slightly weathered gloss.
function hullMaterial(C) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: C.hull.weathered ? 0.8 : 0.26, metalness: 0.02, side: THREE.DoubleSide, map: C.hull.weathered ? weatherTex() : null });
  const U = {
    uAnti: { value: new THREE.Color(C.hull.boot) }, uBoot: { value: new THREE.Color(C.hull.bootTop ?? 0xf2f2ee) },
    uStripe: { value: new THREE.Color(C.hull.stripe) },
    // anti top, boot top, stripe below sheer (upper, lower); a dry-sailed dinghy has a bare gelcoat bottom
    // (a class may give its own: [antifouling top, boot top, stripe top below the sheer, stripe bottom])
    uLevels: { value: C.hull.levels ? new THREE.Vector4(...C.hull.levels) : C.id === 'dinghy' ? new THREE.Vector4(-9, -9, 0.1, 0.075) : new THREE.Vector4(0.04, C.hull.bootTop !== undefined ? 0.04 : 0.1, 0.12, 0.085) },
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
  if (C.hull.rough !== undefined) m.roughness = C.hull.rough;
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
import { linesFor, hullSection, hullOffsets, hullParts, partSection, calibrate } from './hull.js';
export { linesFor };

// one hull: P an offset y (a monohull, a catamaran's hulls) or a hull part (hull.js hullParts: a trimaran's floats)
function hullGeometry(C, Lx, P = 0) {
  const part = typeof P === 'number' ? { y: P, sy: 1, sz: 1, szTop: 1, dz: 0, t0: 0, t1: 1 } : P, yOff = part.y;
  const H = Lx.H;
  const NS = 64;
  const L0 = C.sternX, L1 = C.bowX;
  const stations = [];
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const tm = part.t0 + (part.t1 - part.t0) * t;
    let sec = partSection(C, Lx, tm, part);
    if (C.hull.clinker) sec = clinkerSection(sec, C.hull.clinker, Lx.keelZ(tm));
    const zTop = sec[0][1], zBot = sec[sec.length - 1][1];
    const x0 = lerp(L0, L1, tm);
    stations.push(sec.map(([y, z]) => {
      let x = x0;
      const zn = clamp((z - zBot) / Math.max(0.05, zTop - zBot), 0, 1);
      if (Lx.xShift) x += Lx.xShift(t, zn);                       // lines from offsets: their own stem and transom
      else {
        x += H.stemRake * sstep(0.86, 1, t) * zn ** 1.4;         // raked / clipper stem
        x -= H.transomRake * sstep(0.12, 0, t) * zn;              // raked transom
      }
      return [x, y, z];
    }));
  }
  const NP = stations[0].length;
  // topsides colour per vertex (fleet boats differ); bottom paint, boot top and cove stripe are drawn
  // crisp in the hull shader from each point's height and its station's sheer height
  const pos = [], col = [], shr = [], uv = [];
  const cTop = new THREE.Color(C.hull.color);
  // Hobie 16 asymmetric hulls (drawn; the hydrostatics keep the symmetric section of the same area): the inboard
  // side a flat, near-vertical wall down to a sharp keel, the outboard side round
  const side2y = (st, k, side) => {
    const y = st[k][1], sy = side ? -y : y;
    if (!C.multihull || sy * yOff > 0) return yOff + sy;
    const b = st[0][1], zt = st[0][2], zb = st[st.length - 1][2], zn = clamp((st[k][2] - zb) / Math.max(0.05, zt - zb), 0, 1);
    return yOff + Math.sign(sy || -yOff) * (y + Math.max(0, b * 0.9 - y) * 0.6 * sstep(0.08, 0.6, zn));
  };
  for (let s = 0; s <= NS; s++) for (let k = 0; k < NP; k++) for (let side = 0; side < 2; side++) {
    const [x, y, z] = stations[s][k];
    pos.push(side2y(stations[s], k, side), z, -x);
    col.push(cTop.r, cTop.g, cTop.b); shr.push(stations[s][0][2]);
    uv.push(x / 3 + (side ? 0.5 : 0), z / 1.5);                     // (a weathered hull's streaks run down the topsides)
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
  for (let k = 0; k < NP; k++) { const [x, y, z] = st[k]; pos.push(side2y(st, k, 0), z, -x, side2y(st, k, 1), z, -x); col.push(cTop.r, cTop.g, cTop.b, cTop.r, cTop.g, cTop.b); shr.push(st[0][2], st[0][2]); uv.push(y / 3, z / 1.5, -y / 3, z / 1.5); }
  for (let k = 0; k < NP - 1; k++) { const a = tBase + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sheerZ', new THREE.Float32BufferAttribute(shr, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return { geom: g, stations };
}

// A clinker-built hull (Folkboat): n strakes a side, each lapping outside the one below it. The section is resampled
// along its girth, and every strake stands out from the one under it by its thickness toward its lower edge (the
// land), stepping back in where the next strake begins: the hull shows its laps in the light. Only the canoe body is
// planked (not a keel below it). Drawn only; the hydrostatics use the smooth lines.
function clinkerSection(sec, n, zKeel) {
  const g = [0];
  for (let i = 1; i < sec.length; i++) g.push(g[i - 1] + Math.hypot(sec[i][0] - sec[i - 1][0], sec[i][1] - sec[i - 1][1]));
  // the planked girth ends where the canoe body meets the keel
  let iEnd = sec.length - 1;
  for (let i = 1; i < sec.length; i++) if (sec[i][1] < zKeel * 0.985 - 0.02) { iEnd = i - 1; break; }
  const G = g[iEnd], lap = 0.012, K = 3, out = [];
  const at = (gg) => {
    let i = 1; while (i < iEnd && g[i] < gg) i++;
    const f = (gg - g[i - 1]) / Math.max(1e-9, g[i] - g[i - 1]);
    const y = sec[i - 1][0] + (sec[i][0] - sec[i - 1][0]) * f, z = sec[i - 1][1] + (sec[i][1] - sec[i - 1][1]) * f;
    let ty = sec[i][0] - sec[i - 1][0], tz = sec[i][1] - sec[i - 1][1]; const tl = Math.hypot(ty, tz) || 1;
    return [y, z, -tz / tl, ty / tl];                                  // point and outward normal
  };
  for (let p = 0; p < n; p++) for (let k = 0; k <= K; k++) {
    const gg = G * (p + k / K) / n, [y, z, ny, nz] = at(Math.min(gg, G - 1e-6));
    const o = lap * (k / K) * (y > 0.02 ? 1 : y / 0.02);             // (no lap at the stem and keel line)
    out.push([Math.max(0, y + ny * o), z + nz * o]);
  }
  for (let i = iEnd + 1; i < sec.length; i++) out.push(sec[i]);
  // every station needs the same number of points: pad the unplanked part to a fixed count
  while (out.length < n * (K + 1) + 16) out.push(out[out.length - 1]);
  return out.slice(0, n * (K + 1) + 16);
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
      const hb = (C.amas ? C.hullBeam : C.beam) / 2;
      let z = sh + crown * (1 - u * u) * Math.min(1, b / hb) * hb * 0.35;
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
  const hb = (C.amas ? C.hullBeam : C.beam) / 2;
  const mono = (x, y) => {
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    const b = Math.max(0.05, Lx.bDeck(t)), sh = Lx.sheer(t);
    const u = clamp(y / b, -1, 1);
    let z = sh + Lx.H.crown * (1 - u * u) * Math.min(1, b / hb) * hb * 0.35;
    if (ck && t > ck.t0 && t < ck.t1 && Math.abs(u) < ck.w) z = ck.sole;
    return z;
  };;
  if (!C.amas) return mono;
  // a trimaran: the main hull, the floats' decks, and the nets and beams between them (at the beams' height)
  const A = C.amas;
  return (x, y) => {
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    if (Math.abs(y) <= Lx.bDeck(t) * 1.02) return mono(x, y);
    const ta = (t - A.t0) / (A.t1 - A.t0), dy = Math.abs(Math.abs(y) - A.y);
    if (ta >= 0 && ta <= 1 && dy < Lx.bDeck(ta) * A.sy) return Lx.sheer(ta) * A.szTop + A.dz;
    return A.netZ;
  }
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
  // Hobie 16: crosscut Dacron in the classic rainbow bands (foot to head)
  cat: { cloth: 0xf2f1ec, kind: 'dacron', bands: ['#1f4fa3', '#1f8a4c', '#f2c318', '#f07c1a', '#d4262c'], num: '#111317', logo: '#111317', trans: 0.3, rough: 0.58 },
};
const clothOf = (C, s) => s.kind === 'spin' ? { cloth: s.color, kind: 'nylon', num: '#ffffff', logo: '#ffffff', trans: 0.45, rough: 0.5 } : (SAILCLOTH[C.id] || C.sailcloth || SAILCLOTH.dinghy);
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
    // coloured panels (a Sunfish's rainbow stripes): bands of cloth across the sail, each its own colour
    if (cl.stripes && s.kind !== 'spin') cl.stripes.forEach(([f0, f1, c]) => { g.fillStyle = c; g.beginPath(); g.moveTo(0, h * (1 - f1)); g.lineTo(w, h * (1 - f1) + slope(h * (1 - f1))); g.lineTo(w, h * (1 - f0) + slope(h * (1 - f0))); g.lineTo(0, h * (1 - f0)); g.fill(); });
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
      if (cl.bands) {
        // coloured panels in bands from the foot up (each band a few panels deep)
        const nb = cl.bands.length;
        for (let y = panelPx * 0.6 - panelPx; y < h + 40; y += panelPx) {
          const f = 1 - (y + panelPx * 0.5) / h, c = cl.bands[clamp(Math.floor(f * nb), 0, nb - 1)];
          g.fillStyle = c; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + slope(y)); g.lineTo(w, y + panelPx + slope(y + panelPx)); g.lineTo(0, y + panelPx); g.fill();
        }
      }
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
    if (C.hull.patchedSails && s.kind !== 'spin') {
      // salvaged cloth: patches of other sails sewn over tears, each a different shade, zig-zag stitched; stains
      for (let i = 0; i < 16; i++) {
        const pw = 40 + r() * 140, ph = 30 + r() * 120, x = r() * (w - pw), y = r() * (h - ph), k = r();
        g.fillStyle = k < 0.33 ? 'rgba(110,80,50,0.22)' : k < 0.66 ? 'rgba(245,235,210,0.3)' : 'rgba(150,120,80,0.22)';
        g.save(); g.translate(x + pw / 2, y + ph / 2); g.rotate((r() - 0.5) * 0.5); g.fillRect(-pw / 2, -ph / 2, pw, ph);
        g.strokeStyle = 'rgba(30,25,20,0.5)'; g.setLineDash([3, 3]); g.lineWidth = 1.5; g.strokeRect(-pw / 2 + 3, -ph / 2 + 3, pw - 6, ph - 6); g.setLineDash([]); g.restore();
      }
      for (let i = 0; i < 12; i++) { const x = r() * w, y = r() * h, rad = 20 + r() * 70, grd = g.createRadialGradient(x, y, 0, x, y, rad); grd.addColorStop(0, 'rgba(80,50,20,0.18)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad); }
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
      // J/70 (J/Boats sail plan): two full-length battens at the top, two short ones below; Hobie 16: full battens
      // at the cloth model's rows; a class may give its own (s.pockets)
      const bat = s.pockets ?? lookOf(C).battens ?? (C.id === 'blackwatch' ? [[0.2, 0.18], [0.4, 0.2], [0.6, 0.2], [0.8, 0.16]] : C.id === 'dinghy' ? [[0.3, 0.2], [0.55, 0.22], [0.8, 0.18]]
        : C.id === 'cat' ? [0.14, 0.28, 0.42, 0.56, 0.7, 0.84, 0.95].map(f => [f, 1.0])
        : [[0.25, 0.47], [0.5, 0.53], [0.74, 1.0], [0.88, 1.0]]);
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
    if (s.key === 'jib' && C.id === 'sportboat') { // three short leech battens (J/Boats sail plan)
      for (const f of [0.2, 0.45, 0.7]) {
        const y = h * (1 - f), L = w * 0.16, dy = slope(y) * 0.16;
        g.save(); g.translate(0, y); g.rotate(Math.atan2(dy, L));
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(0, -7, Math.hypot(L, dy), 14);
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, -8, Math.hypot(L, dy), 2); g.fillRect(0, 6, Math.hypot(L, dy), 2);
        g.restore();
      }
    }
    if (s.window ?? (s.kind === 'loose' || (s.key === 'main' && C.id === 'dinghy'))) { // window
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
  const cl = SAILCLOTH[C.id] || C.sailcloth || SAILCLOTH.dinghy;
  return canvasTex(`decal-${C.id}-${number ?? ''}`, 512, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    // (a class insignia drawn by the class: a function of the canvas and the band's centre, or its text)
    if (typeof C.insignia === 'function') C.insignia(g, 128, 48, cl);
    else {
      const logo = C.insignia ?? (C.id === 'blackwatch' ? 'BW' : C.id === 'sportboat' ? 'S23' : C.id === 'dinghy' ? 'S14' : 'C16');
      g.font = 'bold 74px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillStyle = cl.logo; g.fillText(logo, 128, 76);
    }
    if (number) {
      // a long number (nation letters and digits) is set smaller: it must clear the leech where the sail
      // narrows, so it keeps within the middle ~60% of the band (the width a three-digit number takes)
      let fs = 150; g.font = `bold ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      const wd = g.measureText(String(number)).width; if (wd > 300) { fs = Math.floor(fs * 300 / wd); g.font = `bold ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`; }
      g.fillStyle = cl.num; g.fillText(String(number), 256, 226 - (150 - fs) * 0.35);
    }
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
  const tex = sailTexture(C, s), decal = s.key === 'main' && !lookOf(C).noNumber ? sailDecal(C, number) : null;
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
    let fs = C.id === 'blackwatch' ? 64 : 52;
    g.font = `italic 700 ${fs}px Georgia, "Times New Roman", serif`;
    const wd = g.measureText(name).width; if (wd > w * 0.94) { fs = Math.floor(fs * w * 0.94 / wd); g.font = `italic 700 ${fs}px Georgia, "Times New Roman", serif`; }
    g.fillText(name, w / 2, 66);
    g.font = '600 26px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.fillText(port, w / 2, 108);
  });
}

// Coachroofs: extent (t = 0 transom .. 1 stem), half width and height of the roof above the centreline deck.
// Blackwatch (photos of hull #66): a long, fairly high trunk from 40% to 77% of the length, narrowing forward.
// J/70 (J/Boats deck plan and profile): a low wedge from the cockpit (1.36 m wide, ~0.25 m high at its aft face)
// tapering to 0.7 m wide at its forward end, 1.6 m aft of the stem, where it fairs into the foredeck.
const CABIN = {
  blackwatch: { t0: 0.40, t1: 0.77, h: (t) => 0.4 - 0.03 * (t - 0.4) / 0.37, w: (t) => 0.74 * (1 - 0.5 * sstep(0.5, 1, (t - 0.4) / 0.37) ** 1.5) },
  sportboat: { t0: 0.515, t1: 0.77, h: (t) => 0.25 * (1 - sstep(0.45, 1.02, (t - 0.515) / 0.255) ** 1.3), w: (t) => lerp(0.68, 0.35, ((t - 0.515) / 0.255) ** 0.9) },
};
// ================================================================== assemble
// classes that carry a model description (C.model) are built by js/boats/detailed.js, which registers here
export const MODEL_HOOKS = { build: null };
export { transomDecal, M, Kit, canvasTex, rnd, hullGeometry, deckGeometry, deckHeightFn, foilGeom, lathe, sailMesh, clothOf, hullMaterial, updateSail, teakTex, nonskidTex, sailTexture };
export function buildBoatModel(boat, opts = {}) {
  const C = boat.cls;
  if (C.model && MODEL_HOOKS.build) return MODEL_HOOKS.build(boat, opts);
  const Lx = linesFor(C);
  const root = new THREE.Group();
  const inner = new THREE.Group(); root.add(inner);
  const kit = new Kit();
  const topColor = opts.hullColor ?? C.hull.color;
  const Chull = { ...C, hull: { ...C.hull, color: topColor } };
  // ---- hull
  calibrate(C);
  const offs = hullOffsets(C), parts = hullParts(C), LK = lookOf(C);
  let stations, hull;
  const partStations = [];
  for (const P of parts) {
    const r = hullGeometry(Chull, Lx, C.amas ? P : P.y);
    partStations.push(r.stations);
    if (!C.amas || P.y === 0) stations = r.stations;               // (a trimaran's main hull sets the deck lines)
    const m = new THREE.Mesh(r.geom, M.hull(C));
    m.castShadow = true; m.receiveShadow = true;
    inner.add(m);
    if (!C.amas || P.y === 0) hull = m;
  }
  const bx = (t) => lerp(C.sternX, C.bowX, t);
  const tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  // ---- cockpit layout per class
  // Blackwatch: cockpit from the aft deck to the companionway (38% of LOD); J/70 (J/Boats deck plan): 1.36 m wide,
  // from the transom to the aft face of the house 3.3 m aft of the stem; Laser: the short well from just ahead of
  // the daggerboard (1.55 m aft of the stem) to 3.2 m aft of it, ~0.6 m wide
  const ck = LK.cockpit ? LK.cockpit : C.id === 'blackwatch' ? { t0: 0.07, t1: 0.39, w: 0.5, sole: 0.38 }
    : C.id === 'sportboat' ? { t0: 0.0, t1: 0.515, w: 0.6, sole: 0.3 }
    : { t0: 0.24, t1: 0.635, w: 0.47, sole: 0.14 };
  const deckH0 = deckHeightFn(C, Lx, ck);
  // top surface: the deck, or the cabin roof where there is a coachroof (fittings sit on whichever is on top)
  // (a class's own coachroof, C.hull.cabin: a plain trunk of its height, narrowing a little forward)
  const cab = CABIN[C.id] || (LK.cabin ? { t0: LK.cabin.t0, t1: LK.cabin.t1, h: () => LK.cabin.h, w: (t) => LK.cabin.w * (1 - 0.25 * sstep(0.4, 1, (t - LK.cabin.t0) / (LK.cabin.t1 - LK.cabin.t0))) } : null);
  const deckH = (x, y) => {
    const z = deckH0(x, y);
    if (!cab) return z;
    const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    return t > cab.t0 && t < cab.t1 && Math.abs(y) < cab.w(t) ? Math.max(z, deckH0(x, 0) + cab.h(t)) : z;
  };
  const deckTint = LK.deckTint ? LK.deckTint : C.id === 'blackwatch' ? '#e6dcc4' : C.id === 'sportboat' ? '#dfe2e2' : '#eceae3';
  let deck;
  parts.forEach((P, i) => {
    const main = !C.multihull && P.y === 0;
    const g = deckGeometry(C, Lx, partStations[i], main ? ck : null);
    g.translate(P.y, 0, 0);
    // (a trimaran's floats: their decks are the same weathered skin as their topsides, round into them)
    const m = new THREE.Mesh(g, C.amas && P.y !== 0 ? mat('floatdeck', () => new THREE.MeshStandardMaterial({ color: C.hull.color, map: weatherTex(), roughness: 0.8, side: THREE.DoubleSide })) : M.deck(deckTint));
    m.receiveShadow = true; m.castShadow = true; inner.add(m);
    if (!deck || main) deck = m;
  });
  if (C.multihull) buildCatStructure(kit, inner, C, Lx, deckH);
  if (C.amas) buildTriStructure(kit, inner, C, Lx, deckH, LK);
  if (C.hull.wings) buildWings(kit, inner, C, Lx, deckH0);
  if (LK.weathered) buildSalvage(kit, C, Lx, deckH);
  // toe rails: the Blackwatch's mahogany rubrail the length of the sheer; the Laser's rolled deck-to-hull flange; the
  // J/70's short moulded toe rails on the foredeck only (J/Boats spec: "molded foredeck toe-rails P & S")
  const sheerPts = (side, off = 0) => stations.map(st => { const [x, y, z] = st[0]; return new THREE.Vector3(off + side * y, z + 0.02, -x); });
  if (!C.multihull) for (const side of [-1, 1]) {
    let pts = sheerPts(side).filter((p, i) => i % 2 === 0);
    if (C.id === 'sportboat') pts = sheerPts(side).filter((p, i) => i / (stations.length - 1) > 0.62 && i / (stations.length - 1) < 0.985).map(p => p.set(p.x * 0.985, p.y + 0.01, p.z));
    else if (C.id === 'dinghy') pts = sheerPts(side).map(p => p.set(p.x * 1.004, p.y - 0.022, p.z));
    const r = C.id === 'dinghy' ? 0.018 : C.id === 'sportboat' ? 0.016 : 0.022;
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, r, 6);
    kit.add(C.id === 'blackwatch' ? M.teak() : M.gel(topColor), tube);
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
    // the boat's name (the player's, or the fleet's); unnamed boats keep the class default; the home port
    // line only on the player's Blackwatch
    const name = opts.name || (C.id === 'blackwatch' ? 'Blackwatch' : C.id === 'sportboat' ? (opts.number ? '#' + opts.number : 'S23') : '');
    const port = C.id === 'blackwatch' && (opts.player || !opts.name) ? 'PROGRESO, YUC.' : '';
    const mat = new THREE.MeshStandardMaterial({ map: transomDecal(C, name, port), transparent: true, roughness: 0.4 });
    if (C.amas && name) {
      // a trimaran: on the outboard topsides of both floats, aft
      const A = C.amas, hw = 2.2, xa = lerp(C.sternX, C.bowX, A.t0 + 0.08), ta = 0.08, y = A.y + Lx.bDeck(ta) * A.sy + 0.02;
      for (const sd of [-1, 1]) {
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(hw, hw / 4), mat);
        dec.position.set(sd * y, A.dz + Lx.sheer(ta) * A.szTop * 0.62, -(xa + hw * 0.6));
        dec.rotation.y = sd * Math.PI / 2;
        inner.add(dec);
      }
    } else if (!C.multihull) {
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), mat);
      // (on the J/70 the name sits to port, clear of the rudder on its centreline gudgeons)
      dec.position.set(C.id === 'sportboat' ? -w * 0.3 : 0, zmid + Math.sin(tilt) * 0.012, -xm + Math.cos(tilt) * 0.012);
      dec.rotation.x = tilt;
      if (name && (C.id !== 'dinghy' || opts.name)) inner.add(dec);
    } else if (name) {
      // a catamaran carries its name on the outboard topsides of both hulls, aft
      const hw = 1.1, y = C.hullSpacing / 2 + C.hullBeam / 2 + 0.015;
      for (const sd of [-1, 1]) {
        const dec = new THREE.Mesh(new THREE.PlaneGeometry(hw, hw / 4), mat);
        dec.position.set(sd * y, zt * 0.62, -(xt + 0.95));
        dec.rotation.y = sd * Math.PI / 2;
        inner.add(dec);
      }
    }
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
    // J/70: an open cockpit with no seats; a moulded centreline foot brace runs aft from the house over the keel
    // box, and the aft face of the house carries the drop board
    const xf = bx(ck.t1);
    kit.box(M.gel(topColor), 0.26, 0.1, 1.85, V(xf - 0.95, 0, soleZ + 0.05));
    kit.box(M.gel(topColor), 0.3, 0.03, 1.85, V(xf - 0.95, 0, soleZ + 0.1));
  } else if (LK.benches) {
    // a keelboat's cockpit: benches either side (teak on a wooden boat), coamings on the Folkboat, a grating sole
    const xa = bx(ck.t0), xf = bx(ck.t1), xm = (xa + xf) / 2, L = xf - xa;
    const cw = ck.w * Lx.bDeck((ck.t0 + ck.t1) / 2), bh = Math.min(0.38, deckH0(xm, cw + 0.05) - soleZ - 0.02);
    for (const s of [-1, 1]) {
      kit.box(LK.wood ? M.teak() : M.deck(deckTint), 0.34, 0.05, L * 0.92, V(xm, s * (cw - 0.2), soleZ + bh));
      kit.box(LK.wood ? M.cream() : M.gel(topColor), 0.03, bh, L * 0.92, V(xm, s * (cw - 0.37), soleZ + bh / 2));
      if (LK.wood) kit.box(M.varnish(), 0.035, 0.22, L * 1.02, V(xm, s * (cw + 0.02), deckH0(xm, s * (cw + 0.05)) + 0.08));
    }
    if (LK.wood) kit.box(M.teak(), cw * 2 - 0.7, 0.03, L * 0.9, V(xm, 0, soleZ + 0.015));
  } else if (C.id === 'dinghy' || (C.keel.board && !C.multihull && !C.amas)) {
    // Laser (and the other dinghies): the daggerboard or centreboard trunk rises from the cockpit floor
    const tl = C.keel.pivot ? C.keel.chord * 2.2 : 0.42;
    kit.box(M.gel(topColor), 0.07, 0.2, tl, V(C.keel.x + 0.02 + (C.keel.pivot ? C.keel.chord * 0.6 : 0), 0, soleZ + 0.1));
  }
  // cabin trunk
  if (C.id === 'blackwatch') buildCabin(kit, C, Lx, deckH0, bx);
  if (C.id === 'sportboat') {
    trunkShell(kit, CABIN.sportboat, deckH0, bx, M.deck('#dfe2e2'), 0.03);
    const P = CABIN.sportboat, xa = bx(P.t0), zc = deckH0(xa, 0);
    // moulded companionway cover (hinged at its forward end) aft of the mast, drop board in the aft face
    const hx = C.mastX - 0.36;
    kit.box(M.gel(topColor), 0.56, 0.045, 0.5, V(hx, 0, deckH0(hx, 0) + P.h(tAt(hx)) + 0.03));
    kit.box(M.gel('#c9ccce'), 0.5, 0.2, 0.025, V(xa - 0.005, 0, zc + 0.12));
    // ventilation hatch on the house ahead of the mast
    const vx = bx(0.735), vz = deckH0(vx, 0) + P.h(0.735);
    kit.box(M.alu(), 0.42, 0.03, 0.3, V(vx, 0, vz + 0.02)); kit.box(M.glass(), 0.36, 0.012, 0.24, V(vx, 0, vz + 0.04));
    // foredeck U-bolt
    kit.rod(M.steel(), V(C.bowX - 0.55, -0.03, deckH0(C.bowX - 0.55, 0)), V(C.bowX - 0.55, 0.03, deckH0(C.bowX - 0.55, 0) + 0.04), 0.006);
    // deck organisers either side of the mast: the halyards and control lines turn aft here to the clutches
    for (const s of [-1, 1]) {
      const ox = C.mastX - 0.28, oy = s * 0.2, oz = deckH(ox, oy);
      kit.box(M.black(), 0.16, 0.012, 0.06, V(ox, oy, oz + 0.006));
      for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12); g.rotateZ(Math.PI / 2); g.translate(oy + (i - 1) * 0.045, oz + 0.026, -ox); kit.add(M.alu(), g); }
    }
    // the mast-mounted compass facing the cockpit
    kit.box(M.black(), 0.13, 0.1, 0.03, V(C.mastX - 0.08, 0, deckH(C.mastX, 0) + 1.55));
  }
  if (LK.cabin && !CABIN[C.id]) {
    // a class's coachroof (C.hull.cabin): the trunk, windows in its sides and front, a hatch, the companionway
    trunkShell(kit, cab, deckH0, bx, LK.cabin.wood ? M.varnish() : M.deck(deckTint), 0.05);
    const xa = bx(cab.t0), xf = bx(cab.t1), zc = deckH0(xa, 0), hc = LK.cabin.h;
    for (const s of [-1, 1]) {
      const xm = lerp(xa, xf, 0.45), w = cab.w(tAt(xm));
      if (LK.wood) for (const t of [0.35, 0.6]) {           // round bronze ports on a wooden trunk
        const x = lerp(xa, xf, t), wy = cab.w(tAt(x)), z = deckH0(x, 0) + hc * 0.5;
        const ring = new THREE.TorusGeometry(0.06, 0.012, 8, 18); ring.rotateY(Math.PI / 2); ring.translate(s * (wy * 0.99 + 0.004), z, -x); kit.add(M.bronze(), ring);
        const gl = new THREE.CircleGeometry(0.055, 16); gl.rotateY(s * Math.PI / 2); gl.translate(s * (wy * 0.99 + 0.006), z, -x); kit.add(M.glass(), gl);
      } else kit.box(M.glass(), 0.02, hc * 0.3, (xf - xa) * 0.55, V(xm, s * (w * 0.985 + 0.004), zc + hc * 0.55));
    }
    kit.box(M.gel(0x1c1e22), 0.55, 0.035, 0.5, V(lerp(xa, xf, 0.6), 0, deckH0(lerp(xa, xf, 0.6), 0) + hc + 0.02));   // hatch
    kit.box(LK.wood ? M.varnish() : M.gel('#c9ccce'), 0.5, hc * 0.8, 0.03, V(xa - 0.005, 0, zc + hc * 0.4));   // washboards
  }
  // pulpit, pushpit, stanchions and lifelines on the classes that race with them (J/24, J/122)
  if (LK.lifelines) buildLifelines(kit, C, Lx, stations, deckH, bx);
  // the J/70's low safety lines round the cockpit (the Blackwatch and the dinghies carry none)
  if (C.id === 'sportboat') buildSafetyLines(kit, C, Lx, deckH, bx);
  // mooring cleats, chainplates, nav lights
  const cleatM = LK.wood ? M.bronze() : M.alu();
  const cleat = (x, y) => { const z = deckH(x, y); kit.box(cleatM, 0.035, 0.03, 0.16, V(x, y, z + 0.035)); kit.box(cleatM, 0.03, 0.035, 0.04, V(x, y, z + 0.015)); };
  if (!C.multihull) { cleat(C.bowX - 0.35, 0); for (const s of [-1, 1]) cleat(C.sternX + 0.3, s * Lx.bDeck(0.05) * 0.8); }
  // shroud chainplates: the J/70's swept-spreader rig takes its shrouds 0.45 m aft of the mast (J/Boats sail plan);
  // the Hobie's side stays go to the outboard deck edge by the front beam
  const shroudX = C.id === 'sportboat' ? C.mastX - 0.45 : C.multihull ? C.mastX - 0.12 : C.mastX - 0.1;
  const chain = [];
  for (const s of [-1, 1]) {
    const y = C.multihull ? s * (C.hullSpacing / 2 + Lx.bDeck(tAt(shroudX)) * 0.8) : s * Lx.bDeck(tAt(shroudX)) * 0.93, z = deckH(shroudX, y);
    chain.push([shroudX, y, z]);
    kit.box(M.steel(), 0.02, 0.06, 0.05, V(shroudX, y, z + 0.02));
  }
  if (C.id === 'blackwatch' || LK.lifelines) {
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
      sprit = new THREE.Mesh(g, C.id === 'sportboat' ? M.satin() : M.carbon()); sprit.castShadow = true; sprit.userData.len = L;
      sprit.position.copy(V(C.bowX + 0.05 - L, 0, Lx.sheer(1) - 0.06));
      inner.add(sprit);
    }
  }
  // ---- keel / board / rudder
  const K = C.keel;
  let keelMesh = null;
  if (K.twin) {
    // (a Hobie 16 has no boards: its asymmetric hulls are the lateral plane)
    if (K.board) {
      keelMesh = new THREE.Group();
      for (const off of offs) { const b = new THREE.Mesh(foilGeom(K.chord, K.span + 0.45, 0.11, 0.9, 0.05), M.foil()); b.position.x = off; b.castShadow = true; keelMesh.add(b); }
      keelMesh.position.copy(V(K.x + K.chord * 0.35, 0, C.freeboard - 0.05));
      inner.add(keelMesh);
    }
  } else if (!K.long) {
    // J/70: a painted lead fin, swept and tapered, under a torpedo bulb; Laser: the white daggerboard, parallel-sided
    const kg = foilGeom(K.chord, K.span + (K.board ? 0.35 : 0.08), K.board ? 0.08 : 0.11, K.board ? 0.95 : 0.72, K.board ? 0 : 0.18);
    keelMesh = new THREE.Mesh(kg, K.board ? M.foil() : M.paint());
    keelMesh.position.copy(V(K.x + K.chord * 0.35, 0, -C.canoeDraft + 0.06 + (K.board ? 0.35 : 0)));
    keelMesh.castShadow = true;
    inner.add(keelMesh);
    if (C.keelBulb) {
      // the bulb: ~1.3 m long, its nose under the fin's leading edge, flat-topped torpedo
      // (a class can give its bulb's length and radius: keelBulb { len, r, flat }; the default is the J/70's)
      const kb = C.keelBulb, bl = kb.len ?? 1.31, br = kb.r ?? 0.145, ks = bl / 1.31, rs = br / 0.145;
      const bulb = new THREE.Mesh(lathe([[0, 0], [0.06, 0.06], [0.12, 0.22], [0.145, 0.45], [0.14, 0.75], [0.11, 1.0], [0.06, 1.2], [0.015, 1.3], [0, 1.31]].map(([r, y]) => [r * rs, y * ks]), 20), M.paint());
      bulb.rotation.x = Math.PI / 2; bulb.scale.set(1.15, 1, 0.85 * (kb.flat ?? 1)); bulb.position.set(0, -K.span - 0.02, -0.42 * ks + K.chord * 0.2 * (ks - 1));
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
    // Hobie 16: kick-up rudders in cast stern brackets on each transom; the tiller arms reach forward and inboard
    // to the tiller crossbar, which runs aft of the rear beam; the extension hangs off its middle
    rudderPivot.position.copy(V(C.sternX - 0.05, 0, 0));
    const armL = 0.3;
    for (const off of offs) {
      const pv = new THREE.Group(); pv.position.x = off;
      const blade = new THREE.Mesh(foilGeom(Rd.chord, Rd.span + C.freeboard - 0.05, 0.1, 0.72, 0.1), M.foil());
      blade.position.set(0, C.freeboard - 0.05, -0.04); blade.castShadow = true; pv.add(blade);
      const cast = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.16), M.black()); cast.position.set(0, C.freeboard - 0.02, 0.02); pv.add(cast);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, armL + 0.04, 8), M.alu()); arm.rotation.x = Math.PI / 2; arm.position.set(0, C.freeboard + 0.06, -armL / 2); pv.add(arm);
      rudderPivot.add(pv); rudderPivots.push(pv);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, C.hullSpacing, 8), M.alu()); bar.rotation.z = Math.PI / 2; bar.position.set(0, C.freeboard + 0.06, -armL); rudderPivot.add(bar);
    tillerEnd.set(0, C.freeboard + 0.08, -armL);
  } else if (Rd.transom) {
    // barn-door rudder hung on the transom with bronze pintles, wooden tiller over the transom
    // (Rd.through: the rudder head comes up inside the transom and the tiller out through a slot in it, as on a Folkboat)
    const topZ = Lx.sheer(0) + (Rd.through ? -0.12 : 0.05), botZ = C.keel.long ? -C.draft + 0.05 : -C.canoeDraft - Rd.span;
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
  } else if (Rd.hung) {
    // J/70: a high-aspect moulded blade on transom gudgeons, its head at deck level, the composite tiller running
    // forward over the cockpit
    const topZ = Lx.sheer(0) - 0.02, botZ = -C.canoeDraft - Rd.span;
    rudderPivot.position.copy(V(C.sternX - 0.07, 0, 0));
    const blade = new THREE.Mesh(foilGeom(Rd.chord * 1.05, topZ - botZ, 0.11, 0.62, 0.12), M.gel(0xf4f4f1));
    blade.position.set(0, topZ, -0.05); blade.castShadow = true; rudderPivot.add(blade);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.2, 0.3), M.black()); head.position.set(0, topZ + 0.03, 0.06); rudderPivot.add(head);
    for (const z of [topZ - 0.12, 0.12]) { const gd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.07), M.alu()); gd.position.set(0, z, -0.03); rudderPivot.add(gd); }
    const tLen = 1.05;
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, tLen, 10), M.satin());
    tiller.rotation.x = Math.PI / 2 - 0.08; tiller.position.set(0, topZ + 0.1, -tLen / 2 + 0.05);
    tiller.castShadow = true; rudderPivot.add(tiller);
    tillerEnd.set(0, topZ + 0.14, -tLen + 0.05);
  } else {
    // Laser: the blade drops into an aluminium rudder head on the transom gudgeons; aluminium tiller
    const topZ = LK.liftingRudder ? C.freeboard + 0.05 : -C.canoeDraft + 0.12;
    rudderPivot.position.copy(V(Rd.x + Rd.chord * 0.25, 0, 0));
    const blade = new THREE.Mesh(foilGeom(Rd.chord, Rd.span + Math.max(0, topZ + C.canoeDraft) , 0.12, 0.75, 0.05), M.foil());
    blade.position.set(0, topZ, -Rd.chord * 0.22); blade.castShadow = true; rudderPivot.add(blade);
    const stockTop = LK.liftingRudder ? C.freeboard + 0.12 : Lx.sheer(0.05) - 0.12 + 0.1;
    if (LK.liftingRudder) { const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.18), M.alu()); head.position.set(0, stockTop - 0.05, 0.02); rudderPivot.add(head); }
    else { const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stockTop - topZ, 10), M.steel()); stock.position.set(0, (stockTop + topZ) / 2, 0); rudderPivot.add(stock); }
    const tLen = LK.tillerLen;
    if (C.wheel) tillerEnd.set(0, stockTop + 0.06, 0);      // (wheel steering: the quadrant below deck, the wheel below)
    else {
      const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, tLen, 10), LK.liftingRudder ? M.alu() : M.carbon());
      tiller.rotation.x = Math.PI / 2 + 0.05; tiller.position.set(0, stockTop + 0.02, -tLen / 2);
      tiller.castShadow = true; rudderPivot.add(tiller);
      tillerEnd.set(0, stockTop + 0.06, -tLen);
    }
  }
  inner.add(rudderPivot);
  // tiller extension (hiking stick), hinged at the tiller end and lying forward along it
  let extension = null;
  if (LK.extension) {
    const L = C.id === 'dinghy' ? 1.0 : 1.2;
    const g = new THREE.CylinderGeometry(0.012, 0.012, L, 8); g.translate(0, L / 2, 0); g.rotateX(-Math.PI / 2 + 0.08);
    extension = new THREE.Mesh(g, M.black()); extension.castShadow = true;
    extension.position.copy(tillerEnd);
    rudderPivot.add(extension);
    extension.userData.len = L;
  }
  // ---- spars and standing rigging
  const rig = new THREE.Group(); inner.add(rig);
  // wheel steering: a pedestal and wheel at the forward end of the cockpit's aft part, turning with the rudder
  let wheel = null;
  if (C.wheel) {
    const W = C.wheel, x = W.x, z0 = ck.sole;
    kit.rod(M.steel(), V(x - 0.05, 0, z0), V(x - 0.02, 0, z0 + W.h), 0.05, 12);          // pedestal
    kit.box(M.black(), 0.16, 0.12, 0.14, V(x - 0.02, 0, z0 + W.h + 0.02));                // binnacle
    wheel = new THREE.Group(); wheel.position.copy(V(x - 0.1, 0, z0 + W.h)); wheel.rotation.x = -0.12;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(W.r, 0.016, 8, 40), M.steel()); wheel.add(rim);
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2 * W.r, 6), M.steel()); sp.rotation.z = i * Math.PI / 4; wheel.add(sp); }
    wheel.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    wheel.userData.r = W.r;
    inner.add(wheel);
  }
  const rigKit = new Kit();
  const mastBase = deckH(C.mastX, 0) + 0.02;
  const mastLen = C.mastHeight - mastBase;
  // J/70: Southern Spars carbon, satin black with white bands; Laser: two-part aluminium (63.5 mm bottom section
  // to a 2.865 m joint, a slimmer tapered top section) inside the sail's luff sleeve; Hobie 16 and Blackwatch:
  // anodised aluminium
  const mastMat = C.id === 'sportboat' ? M.satin() : C.carbonMast ? M.carbon() : lookOf(C).weathered ? M.scrap() : M.alu();
  const r0 = C.mastR ?? (C.id === 'dinghy' ? 0.032 : C.id === 'sportboat' ? 0.05 : 0.055);
  const joint = C.id === 'dinghy' ? 2.865 - 0.355 : 0;
  const mprof = C.id === 'dinghy'
    ? [[r0, 0], [r0, joint], [0.0254, joint + 0.01], [0.0254, joint + 1.4], [0.02, mastLen - 0.3], [0.016, mastLen], [0, mastLen]]
    : [[r0, 0], [r0, mastLen * 0.6], [r0 * 0.9, mastLen * 0.8], [r0 * 0.6, mastLen], [0, mastLen]];
  const mast = new THREE.Mesh(lathe(mprof, 14), mastMat);
  if (C.id !== 'dinghy') mast.scale.set(1, 1, C.wingMast ? 2.8 : 1.25); // pear-shaped section, deeper fore-aft (the Laser's is round; a wing mast's a deep aerofoil)
  if (C.wingMast) mast.geometry.translate(0, 0, 0.35 * r0);                // (its thicker leading edge forward: the section pivots near its front)
  if (C.mastBend) {
    // a bendy mast (the Star's) drawn with its bend: the top sagging aft, the middle forward of the ends
    const pa = mast.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { const f = pa.getY(i) / mastLen; pa.setZ(i, pa.getZ(i) + C.mastBend * (f * f * 1.6 - f * 0.6) / (C.wingMast ? 2.8 : 1.25)); }
    mast.geometry.computeVertexNormals();
  }
  mast.position.copy(V(C.mastX, 0, mastBase)); mast.castShadow = true; rig.add(mast);
  if (C.id === 'dinghy') {
    rigKit.add(M.alu(), new THREE.CylinderGeometry(0.034, 0.034, 0.05, 14).translate(0, mastBase + joint, -C.mastX)); // joint collar
    // the sail's luff sleeve round the mast from the tack to the head
    const ML = boat.sailBy.main.luff;
    rigKit.add(M.cream(), new THREE.CylinderGeometry(0.043, 0.047, ML * 0.97, 14, 1, true).translate(0, C.boomZ + ML * 0.485 + 0.03, -(C.mastX + 0.004)));
  } else rigKit.box(M.black(), 0.012, mastLen * 0.95, 0.012, V(C.mastX - r0 * 1.2, 0, mastBase + mastLen * 0.5)); // luff track
  if (C.id === 'sportboat') { // white bands: at the gooseneck, at the top of the mainsail hoist and at the mast foot
    for (const [z, h] of [[C.boomZ + 0.05, 0.03], [C.boomZ + boat.sailBy.main.luff + 0.05, 0.03], [mastBase + 0.15, 0.02]])
      rigKit.add(M.band(), new THREE.CylinderGeometry(r0 * 1.02, r0 * 1.02, h, 14).scale(1, 1, 1.25).translate(0, z, -C.mastX));
  }
  if (C.id === 'blackwatch' || C.id === 'sportboat') rigKit.box(mastMat, 0.07, 0.04, C.id === 'sportboat' ? 0.3 : 0.16, V(C.mastX - (C.id === 'sportboat' ? 0.1 : 0.04), 0, C.mastHeight + 0.01)); // masthead crane
  if (C.id === 'blackwatch') rigKit.rod(M.black(), V(C.mastX + 0.02, 0.03, C.mastHeight), V(C.mastX + 0.02, 0.03, C.mastHeight + 0.9), 0.004); // VHF whip
  rigKit.box(M.black(), 0.1, 0.06, 0.08, V(C.mastX - 0.08, 0, C.boomZ)); // gooseneck
  const stay = {}, S = boat.sailBy;
  if (C.multihull) {
    // Hobie 16: side stays from the hounds to the hull sides, the forestay down to the bridle from the bows, and a
    // trapeze wire pair each side hanging from the hounds with its ring, handle and shock cord to the hull
    const hounds = C.mastHeight - mastLen * 0.25;
    for (const s of [-1, 1]) {
      const [cx, cy, cz] = chain[(s + 1) / 2];
      rigKit.rod(M.wire(), V(cx, cy, cz + 0.05), V(C.mastX, s * 0.02, hounds), 0.003);
      for (const dx of [0.1, -0.1]) {
        const ringP = V(C.mastX - 0.3 + dx, s * (C.hullSpacing / 2 + 0.05), C.freeboard + 1.15);
        rigKit.rod(M.wire(), V(C.mastX, s * 0.03, hounds - 0.05), ringP, 0.0022);
        const ring = new THREE.TorusGeometry(0.03, 0.006, 6, 14); ring.rotateY(Math.PI / 2); ring.translate(ringP.x, ringP.y - 0.03, ringP.z); rigKit.add(M.steel(), ring);
        rigKit.rod(M.black(), ringP.clone().setY(ringP.y - 0.06), ringP.clone().setY(ringP.y - 0.2), 0.012);    // handle
        rigKit.rod(M.black(), ringP.clone().setY(ringP.y - 0.06), V(C.mastX - 1.2 + dx, s * (C.hullSpacing / 2 + 0.12), C.freeboard + 0.12), 0.003); // shock cord
      }
    }
    const J = S.jib; rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.0035);
    for (const s of [-1, 1]) rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(C.bowX - 0.2, s * C.hullSpacing / 2, C.freeboard + 0.15), 0.003); // bridle
  } else if (C.amas) {
    // a trimaran's rig: shrouds out to the floats at the forward beam, the forestay to the bow, runners to the floats aft
    const A = C.amas, hounds = C.mastHeight - mastLen * (LK.hounds ?? 0.1), xf = Math.max(...A.beams), xa = Math.min(...A.beams);
    for (const s of [-1, 1]) {
      rigKit.rod(M.wire(), V(xf, s * A.y, deckH(xf, s * A.y) + 0.1), V(C.mastX, s * 0.03, hounds), 0.006);
      rigKit.rod(M.wire(), V(xa, s * A.y, deckH(xa, s * A.y) + 0.1), V(C.mastX - 0.05, s * 0.03, hounds), 0.005);
      const sp = V(C.mastX - 0.1, s * 1.1, mastBase + mastLen * 0.45);                                   // diamond spreaders
      rigKit.rod(M.alu(), V(C.mastX, 0, mastBase + mastLen * 0.45), sp, 0.03, 6, 0.018);
      rigKit.rod(M.wire(), V(C.mastX, 0, mastBase + 1.2), sp, 0.005); rigKit.rod(M.wire(), sp, V(C.mastX, 0, hounds - 0.3), 0.005);
    }
    const J = S.jib; rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.007);
  } else if (C.id !== 'dinghy' && C.id !== 'blackwatch' && C.id !== 'sportboat') {
    const sprLen = C.spreader ?? C.beam * 0.36;
    const hounds = LK.hounds ? C.mastHeight - mastLen * LK.hounds : C.mastHeight - 0.25, J = S.jib;
    // spreaders: one pair at mid-mast (the original classes), or C.spreaders { n, sweep (rad) } pairs spaced up to the
    // hounds, each shorter than the one below, swept aft; the cap shroud runs over every tip, the intermediates from
    // each tip to the root of the pair above, the lowers from the chainplates to the lowest root
    const SP = C.spreaders || { n: 1 }, nSp = SP.n;
    const sprAt = (i) => nSp === 1 ? mastBase + mastLen * 0.5 : lerp(mastBase, hounds, (i + 1) / (nSp + 0.6));
    for (const s of [-1, 1]) {
      const [cx, cy, cz] = chain[(s + 1) / 2];
      const tips = [];
      for (let i = 0; i < nSp; i++) {
        const z = sprAt(i), L = sprLen * (1 - 0.28 * i), aft = SP.sweep !== undefined ? L * Math.sin(SP.sweep) : 0.15;
        const tip = V(C.mastX - aft, s * L * (SP.sweep !== undefined ? Math.cos(SP.sweep) : 1), z + 0.06);
        rigKit.rod(M.alu(), V(C.mastX, s * 0.03, z), tip, 0.018 * (1 + 0.3 * (nSp - 1)), 6, 0.01);
        tips.push(tip);
      }
      let prev = V(cx, cy, cz + 0.05);
      for (const tip of tips) { rigKit.rod(M.wire(), prev, tip, 0.0035); prev = tip; }    // cap shroud over the tips
      rigKit.rod(M.wire(), prev, V(C.mastX, s * 0.02, hounds), 0.0035);
      for (let i = 1; i < nSp; i++) rigKit.rod(M.wire(), tips[i - 1], V(C.mastX, s * 0.03, sprAt(i)), 0.003);   // intermediates
      rigKit.rod(M.wire(), V(cx + 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprAt(0)), 0.003); // forward lower
      rigKit.rod(M.wire(), V(cx - 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprAt(0)), 0.003); // aft lower
    }
    if (J) rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.004);
    if (S.stay) rigKit.rod(M.wire(), V(S.stay.tackX, 0, S.stay.tackZ), V(S.stay.tackX - S.stay.rake, 0, S.stay.tackZ + S.stay.luff + 0.05), 0.0035);
    const bsX = C.sternX + (C.id === 'blackwatch' ? -0.02 : 0.05);
    if (C.hasBackstay) {
      stay.backstayTop = V(C.mastX - 0.05, 0, C.mastHeight);
      stay.backstayLow = V(bsX + 0.25, 0, Lx.sheer(0.02) + 0.15);
      rigKit.rod(M.wire(), stay.backstayTop, stay.backstayLow, 0.0035);
      for (const s of [-1, 1]) rigKit.rod(M.wire(), stay.backstayLow, V(bsX + 0.02, s * Lx.bDeck(0.02) * 0.6, Lx.sheer(0.0)), 0.003); // bridle
    }
    if (C.runners) for (const s of [-1, 1]) {
      // running backstays from the hounds to the quarters (both drawn set up)
      const x = C.sternX + 0.6, y = s * Lx.bDeck(tAt(x)) * 0.92;
      rigKit.rod(M.wire(), V(C.mastX - 0.04, s * 0.02, hounds), V(x, y, deckH(x, y) + 0.03), 0.003);
    }
  } else if (C.id !== 'dinghy') {
    // J/70: one pair of swept carbon spreaders ~4.3 m above the deck; Blackwatch: aluminium spreaders at mid-height
    const J = S.jib;
    const sprZ = C.id === 'sportboat' ? 4.97 : mastBase + mastLen * 0.5, sprLen = C.id === 'sportboat' ? 0.78 : C.beam * 0.36;
    const hounds = C.id === 'sportboat' ? J.tackZ + J.luff + 0.05 : C.mastHeight - 0.25;
    for (const s of [-1, 1]) {
      const sweep = C.id === 'sportboat' ? 0.27 : 0.15;
      const tip = V(C.mastX - sweep, s * sprLen, sprZ + 0.06);
      rigKit.rod(C.id === 'sportboat' ? M.satin() : M.alu(), V(C.mastX, s * 0.03, sprZ), tip, 0.018, 6, 0.01);
      const [cx, cy, cz] = chain[(s + 1) / 2];
      rigKit.rod(M.wire(), V(cx, cy, cz + 0.05), tip, 0.0035);           // cap shroud, lower part
      rigKit.rod(M.wire(), tip, V(C.mastX, s * 0.02, hounds), 0.0035);     // cap shroud, upper part
      if (C.id === 'sportboat') rigKit.rod(M.wire(), V(cx + 0.08, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprZ), 0.003); // lower
      else {
        rigKit.rod(M.wire(), V(cx + 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprZ), 0.003); // forward lower
        rigKit.rod(M.wire(), V(cx - 0.3, cy * 0.97, cz + 0.05), V(C.mastX, s * 0.03, sprZ), 0.003); // aft lower
      }
    }
    if (J) rigKit.rod(M.wire(), V(J.tackX, 0, J.tackZ), V(J.tackX - J.rake, 0, J.tackZ + J.luff + 0.05), 0.004);
    if (S.stay) rigKit.rod(M.wire(), V(S.stay.tackX, 0, S.stay.tackZ), V(S.stay.tackX - S.stay.rake, 0, S.stay.tackZ + S.stay.luff + 0.05), 0.0035);
    const bsX = C.sternX + (C.id === 'blackwatch' ? -0.02 : 0.05);
    stay.backstayTop = V(C.mastX - (C.id === 'sportboat' ? 0.22 : 0.05), 0, C.mastHeight);
    stay.backstayLow = V(bsX + 0.25, 0, Lx.sheer(0.02) + 0.15);
    rigKit.rod(M.wire(), stay.backstayTop, stay.backstayLow, 0.0035);
    for (const s of [-1, 1]) rigKit.rod(M.wire(), stay.backstayLow, V(bsX + 0.02, s * Lx.bDeck(0.02) * 0.6, Lx.sheer(0.0)), 0.003); // bridle
  }
  // trapeze wires (C.trapeze: wires a side): from just under the hounds down beside the shrouds to a ring and handle
  // at about shoulder height over the rail, held in to the shroud by shock cord when nobody is on them
  if (C.trapeze && !C.multihull) {        // (the Hobie's are drawn with its rig above)
    const nT = C.trapeze === true ? 2 : C.trapeze, hT = C.multihull ? C.mastHeight - mastLen * 0.27 : LK.hounds ? C.mastHeight - mastLen * LK.hounds - 0.1 : C.mastHeight - 0.4;
    for (const s of [-1, 1]) for (let k = 0; k < nT; k++) {
      const [cx, cy, cz] = chain[(s + 1) / 2];
      const lo = V(cx - 0.12 - 0.12 * k, cy * 0.9, cz + 1.05 + 0.08 * k);
      rigKit.rod(M.wire(), V(C.mastX - 0.02, s * 0.03, hT - 0.05 * k), lo, 0.0022);
      const ring = new THREE.TorusGeometry(0.03, 0.006, 6, 12); ring.rotateY(Math.PI / 2); ring.translate(lo.x, lo.y - 0.03, lo.z); rigKit.add(M.steel(), ring);
      rigKit.rod(M.black(), lo.clone().add(new THREE.Vector3(0, -0.06, 0.02)), lo.clone().add(new THREE.Vector3(0, -0.2, 0.05)), 0.011, 6);   // handle
    }
  }
  rigKit.build(rig);
  // windex at the masthead
  const windex = new THREE.Group(); windex.position.copy(V(C.mastX, 0, C.mastHeight + 0.14));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.32, 6), M.black()); arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.22; windex.add(arrow);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.12, 0.18), M.red()); vane.position.z = 0.15; windex.add(vane);
  windex.visible = C.id !== 'dinghy';   // (a Laser's masthead is bare: its wind indicator sits low on the mast)
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
    const boomMesh = new THREE.Mesh(bgm, C.id === 'sportboat' ? M.satin() : C.carbonMast ? M.carbon() : LK.weathered ? M.scrap() : M.alu());
    boomMesh.position.y = -0.05; boomMesh.castShadow = true; piv.add(boomMesh);
    if (s.club === false) boomMesh.visible = false;           // (a clubless self-tacker: its clew on a track)
    if (C.id === 'sportboat' && s.key === 'main') { // the white band at the outhaul limit (E)
      const bnd = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 12), M.band()); bnd.rotation.x = Math.PI / 2; bnd.scale.set(1, 1, 1.3); bnd.position.set(0, -0.05, s.foot); piv.add(bnd);
    }
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
  // spinnaker pole (a symmetric spinnaker's): from the mast front out to the tack, set with the sail
  let pole = null;
  if (S.gennaker && S.gennaker.pole) {
    const L = S.gennaker.pole, g = new THREE.CylinderGeometry(0.022, 0.028, 1, 10); g.translate(0, 0.5, 0);
    pole = new THREE.Mesh(g, M.alu()); pole.castShadow = true; pole.visible = false;
    pole.userData = { L, base: V(C.mastX + 0.07, 0, S.gennaker.tackZ) };
    rig.add(pole);
  }
  return { root, inner, hull, deck, booms, sailMeshes, rudderPivot, rudderPivots, keelMesh, telltales, windex, rig, sprit, extension, tillerEnd, wheel, pole, mast,
    lines: Lx, deckH, ck, chain, stay, mastBase };
}

// A skiff's wings (racks): tube frames out to the crew's rail each side, covered in a non-skid tramp
function buildWings(kit, inner, C, Lx, deckH) {
  const W = C.hull.wings, tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  const tex = canvasTex('wingtramp', 64, 64, (g, w, h) => { g.fillStyle = '#2a2e33'; g.fillRect(0, 0, w, h); g.fillStyle = '#3a3f46'; for (let i = 0; i < w; i += 4) { g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 1); } }, 1);
  for (const s of [-1, 1]) {
    const pts = [];
    for (const x of [W.x0, W.x1]) {
      const yIn = Lx.bDeck(tAt(x)) * 0.98, z = deckH(x, s * yIn) + 0.02;
      kit.rod(M.alu(), V(x, s * yIn, z), V(x, s * W.y, z + W.rise), 0.022, 10);                 // cross tubes
      pts.push([x, yIn, z]);
    }
    kit.rod(M.alu(), V(W.x0, s * W.y, pts[0][2] + W.rise), V(W.x1, s * W.y, pts[1][2] + W.rise), 0.025, 10);   // the rail
    // the tramp between hull and rail
    const g = new THREE.BufferGeometry(), zIn0 = pts[0][2], zIn1 = pts[1][2];
    const P = [V(W.x0, s * pts[0][1], zIn0), V(W.x0, s * W.y, zIn0 + W.rise), V(W.x1, s * W.y, zIn1 + W.rise), V(W.x1, s * pts[1][1], zIn1)];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P.flatMap((v) => [v.x, v.y, v.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 3, 0, 3, 6, 0, 6], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
    m.receiveShadow = true; inner.add(m);
  }
}

// A salvaged boat's gear: the hinged mast's tabernacle and the geared drum winch that raises it (its wire led to the mast
// over a short strut), rusty drums and crates lashed on deck, and scrap plate bolted over old damage
function buildSalvage(kit, C, Lx, deckH) {
  const r = rnd(7), mx = C.mastX, z0 = deckH(mx, 0);
  // tabernacle: two cheek plates either side of the mast foot, the hinge pin through them
  for (const s of [-1, 1]) kit.box(M.scrap(), 0.04, 0.9, 0.7, V(mx - 0.05, s * 0.2, z0 + 0.42));
  kit.rod(M.steel(), V(mx - 0.05, -0.26, z0 + 0.7), V(mx - 0.05, 0.26, z0 + 0.7), 0.045, 10);
  // the mast-raising winch: a drum on an A-frame, a crank each side, its wire over a strut up to the mast
  const wx = mx - 2.6, wz = deckH(wx, 0);
  for (const s of [-1, 1]) { kit.rod(M.rust(), V(wx - 0.3, s * 0.45, wz), V(wx, s * 0.45, wz + 0.75), 0.04, 6); kit.rod(M.rust(), V(wx + 0.3, s * 0.45, wz), V(wx, s * 0.45, wz + 0.75), 0.04, 6); }
  const drum = new THREE.CylinderGeometry(0.22, 0.22, 0.7, 18); drum.rotateX(Math.PI / 2); drum.rotateY(Math.PI / 2); drum.translate(0, wz + 0.75, -wx); kit.add(M.scrap(), drum);
  for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20); g.rotateZ(Math.PI / 2); g.translate(s * 0.37, wz + 0.75, -wx); kit.add(M.rust(), g); kit.box(M.black(), 0.04, 0.4, 0.05, V(wx + 0.12, s * 0.5, wz + 0.62)); }
  kit.rod(M.wire(), V(wx, 0, wz + 0.97), V(mx - 1.2, 0, z0 + 1.6), 0.008);                             // wire to the strut
  kit.rod(M.rust(), V(mx - 0.25, 0, z0 + 0.3), V(mx - 1.2, 0, z0 + 1.6), 0.05, 8);                        // the strut
  kit.rod(M.wire(), V(mx - 1.2, 0, z0 + 1.6), V(mx - 0.06, 0, z0 + 3.2), 0.008);                          // up to the mast
  // lashed cargo: drums and crates on the main hull's deck and the aft nets; plate patches on the decks
  const spots = [[C.sternX + 2.2, 1.9], [C.sternX + 2.6, -2.2], [C.sternX + 3.4, 2.6], [mx + 3.0, 0.6], [mx + 3.6, -0.5]];
  spots.forEach(([x, y], i) => {
    const z = (C.amas && Math.abs(y) > Lx.bDeck(clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1)) ? C.amas.netZ : deckH(x, y));
    if (i % 2 === 0) { const g = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16); g.translate(y, z + 0.44, -x); kit.add(i === 2 ? M.scrap() : M.rust(), g); }
    else kit.box(M.varnish(), 0.7, 0.45, 0.6, V(x, y, z + 0.22), r() * 0.6);
  });
  for (let i = 0; i < 9; i++) {
    const x = lerp(C.sternX + 1, C.bowX - 1.5, r()), y = (r() - 0.5) * Lx.bDeck(clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1)) * 1.2;
    kit.box(i % 3 ? M.rust() : M.scrap(), 0.3 + r() * 0.7, 0.012, 0.3 + r() * 0.9, V(x, y, deckH(x, y) + 0.008), r() * 1.5);
  }
}

// A trimaran's platform: arched crossbeams (akas) from the main hull out to the amas, and nets between them
function buildTriStructure(kit, inner, C, Lx, deckH, LK) {
  const A = C.amas, tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  const beamM = LK.weathered ? M.rust() : M.alu();
  const tex = canvasTex('trinet', 64, 64, (g, w, h) => { g.fillStyle = 'rgba(40,36,30,0.95)'; g.fillRect(0, 0, w, h); g.clearRect(0, 0, w, h); g.strokeStyle = '#3b352c'; g.lineWidth = 2; for (let i = 0; i <= w; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }, 1);
  tex.repeat.set(10, 10);
  const netM = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.3 });
  for (const s of [-1, 1]) {
    for (const x of A.beams) {
      const y0 = Lx.bDeck(tAt(x)) * 0.9, z0 = deckH(x, 0) - 0.05, ta = (tAt(x) - A.t0) / (A.t1 - A.t0), z1 = Lx.sheer(clamp(ta, 0, 1)) * A.szTop + A.dz + 0.05;
      // an arched beam, deep at the main hull and tapering to the float
      const pts = []; for (let i = 0; i <= 8; i++) { const f = i / 8; pts.push(V(x, s * lerp(y0, A.y, f), lerp(z0, z1, f) + 0.45 * Math.sin(Math.PI * f))); }
      kit.add(beamM, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.16, 10));
    }
    // the net between the beams (flat, at the beams' mid height)
    const [xa, xb] = [Math.min(...A.beams), Math.max(...A.beams)], yi = Lx.bDeck(tAt((xa + xb) / 2)) * 0.95, yo = A.y - 0.5;
    const g = new THREE.PlaneGeometry(yo - yi, xb - xa - 0.3); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, netM); m.position.copy(V((xa + xb) / 2, s * (yi + yo) / 2, A.netZ)); m.receiveShadow = true; inner.add(m);
  }
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

// A coachroof shell from a CABIN entry: sides from the deck up to the roof edge (a little tumblehome), a cambered
// roof, closed at both ends
function trunkShell(kit, P, deckH, bx, material, camber = 0.06) {
  const N = 20, M2 = 10;
  const pos = [], idx = [], uv = [], rows = [];
  for (let i = 0; i <= N; i++) {
    const t = lerp(P.t0, P.t1, i / N), x = bx(t), w = P.w(t), h = P.h(t);
    const zd = deckH(x, w * 0.98) - 0.01, zr = deckH(x, 0) + h;
    const ring = [[w, zd], [w * 0.96, Math.max(zd, zr - camber)]];
    for (let j = 0; j <= M2; j++) { const u = 1 - j / M2; ring.push([w * 0.94 * u, Math.max(zd, zr - camber + camber * (1 - u * u))]); }
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
  for (const [i, flip] of [[0, false], [N, true]]) {
    const base = pos.length / 3, ring = rows[i].ring;
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
  kit.add(material, g);
}

function buildCabin(kit, C, Lx, deckH, bx) {
  // Blackwatch coachroof: cream sides with two bronze-framed oval portlights a side (four in all), teak
  // handrails, companionway with washboards, cambered roof, mushroom vents
  const P = CABIN.blackwatch, t0 = P.t0, t1 = P.t1;
  trunkShell(kit, P, deckH, bx, M.cream());
  for (const s of [-1, 1]) {
    for (const t of [0.5, 0.64]) {
      const x = bx(t), w = P.w(t), z = deckH(x, w) + 0.19;
      const ring = new THREE.TorusGeometry(0.075, 0.015, 8, 20); ring.scale(1.55, 0.8, 1); ring.rotateY(Math.PI / 2); ring.translate(s * (w * 0.975 + 0.004), z, -x);
      kit.add(M.bronze(), ring);
      const gl = new THREE.CircleGeometry(0.072, 18); gl.scale(1.55, 0.8, 1); gl.rotateY(s * Math.PI / 2); gl.translate(s * (w * 0.975 + 0.006), z, -x);
      kit.add(M.glass(), gl);
    }
    const xa = bx(t0 + 0.04), xf = bx(t1 - 0.08), xm = (xa + xf) / 2;
    const zr = deckH(xm, 0) + P.h(tAtX(C, xm)) + 0.05;
    kit.box(M.varnish(), 0.035, 0.04, xf - xa, V(xm, s * 0.42, zr + 0.05));
    for (let k = 0; k < 4; k++) kit.box(M.varnish(), 0.035, 0.05, 0.035, V(lerp(xa, xf, (k + 0.5) / 4), s * 0.42, zr + 0.02));
  }
  const xa = bx(t0);
  const zc = deckH(xa, 0), hc = P.h(t0);
  kit.box(M.varnish(), 0.62, hc - 0.06, 0.04, V(xa - 0.005, 0, zc + (hc - 0.06) / 2));   // washboards
  kit.box(M.cream(), 0.66, 0.05, 0.6, V(xa + 0.25, 0, zc + hc + 0.06));                 // sliding hatch
  for (const s of [-1, 1]) kit.box(M.varnish(), 0.03, 0.05, 0.62, V(xa + 0.25, s * 0.34, zc + hc + 0.03));
  for (const s of [-1, 1]) { // low mushroom vents: clear of the main boom and staysail club
    const x = bx(t1 - 0.1), y = s * 0.24, z = deckH(x, 0) + P.h(t1 - 0.1);
    const g = new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16); g.translate(y, z + 0.025, -x);
    kit.add(M.bronze(), g);
  }
}

// J/70 (J/Boats spec): "four low height SS stanchions and two reinforced SS stern rails at transom corners, 12"
// safety lines surrounding the cockpit ... termination points on deck edge forward of shrouds". No pulpit.
// pulpit, pushpit, stanchions every metre, two lifelines
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

function buildSafetyLines(kit, C, Lx, deckH, bx) {
  const H = 0.32;
  for (const s of [-1, 1]) {
    const edge = (x) => s * Lx.bDeck(tAtX(C, x)) * 0.94;
    const xs = C.sternX + 0.12, xe = C.mastX + 0.25;
    // stern rail: a hoop on the transom corner
    const ys = edge(xs), zs = deckH(xs, ys);
    const rail = [V(xs + 0.45, ys * 0.99, zs), V(xs + 0.42, ys * 1.0, zs + H + 0.06), V(xs + 0.05, ys, zs + H + 0.08), V(xs, ys * 0.9, zs + H + 0.06), V(xs, ys * 0.82, zs)];
    kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail), 16, 0.013, 6));
    // two stanchions a side along the cockpit
    const tops = [V(xs + 0.42, ys, zs + H + 0.06)];
    for (const f of [0.33, 0.66]) {
      const x = lerp(xs + 0.42, xe, f), y = edge(x), z = deckH(x, y);
      kit.rod(M.steel(), V(x, y, z), V(x, y, z + H), 0.011);
      kit.box(M.steel(), 0.05, 0.01, 0.06, V(x, y, z + 0.005));
      tops.push(V(x, y, z + H));
    }
    const ye = edge(xe);
    tops.push(V(xe, ye, deckH(xe, ye) + 0.02));
    kit.add(M.wire(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tops), 24, 0.004, 4));
  }
  // the transom gate: a line across between the stern rails
  const xs = C.sternX + 0.12, y = Lx.bDeck(tAtX(C, xs)) * 0.94 * 0.86, z = deckH(xs, y) + H + 0.06;
  kit.add(M.wire(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xs, -y, z), V(xs - 0.01, 0, z - 0.03), V(xs, y, z)]), 8, 0.004, 4));
}
const tAtX = (C, x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);

// ================================================================== per-frame
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
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
  if (vis.wheel) vis.wheel.rotation.z = b.rudder * 5;
  if (C.wingMast && vis.mast && b.booms.main) vis.mast.rotation.y = b.booms.main.a * 0.8;   // a rotating wing mast turns with the boom                // (about one and a half turns lock to lock)
  if (vis.pole) {
    // the pole out to the spinnaker's tack: the cloth's own tack, or where the strip model sets it (on the forestay)
    const on = b.genDeploy > 0.3, P = vis.pole;
    P.visible = on;
    if (on) {
      const rig = b.sailSys && b.sailSys.active(b) ? b.sailSys.cloth('gennaker') : null, G = b.sailBy.gennaker;
      const T = rig && rig.tack ? V(rig.tack[0], rig.tack[1], rig.tack[2]) : V(G.tackX, 0, G.tackZ);
      const base = P.userData.base, d = _v.subVectors(T, base), L = d.length();
      P.position.copy(base); P.scale.set(1, L, 1);
      P.quaternion.setFromUnitVectors(_up, d.normalize());
    }
  }
  for (const s of b.sails) updateSail(vis.sailMeshes[s.key], b, s, t);
  vis.windex.rotation.y = -b.diag.awa + Math.PI;
  updateTelltales(vis, b, t);
  if (vis.update) vis.update(vis, b, t);          // (a detailed model's own moving parts: gaff, yard, sprit, pole, wheel)
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
    if (s.key === 'main') chord += s.foot * (s.roach ?? 0.07) * Math.sin(Math.PI * fv * 0.85);
    if (s.kind === 'spin') chord *= 0.9 + 0.25 * Math.sin(Math.PI * fv);
    let lx = px - rake * fv, ly = 0;
    const lz = pz + footLift + fv * luff * (1 - 0.06 * slack);
    if (s.rig === 'lateen') { const a0 = st.baseAngle ?? 0, dx = s.tackFwd - rake * fv; lx = C.mastX - 0.02 + dx * Math.cos(a0); ly = -dx * Math.sin(a0); }
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
      const xb = lx + cx * chord * fu + nx * off, yb = ly + cy * chord * fu + ny * off;
      const k = (v * (NU + 1) + u) * 3;
      pos[k] = yb; pos[k + 1] = lz + (s.footRise || 0) * fu * (1 - fv) + (s.headRise || 0) * fu * fv; pos[k + 2] = -xb;
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
      const chord = ms.foot * (1 - fv) + ms.head * fv + ms.foot * (ms.roach ?? 0.07) * Math.sin(Math.PI * fv * 0.85);
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
