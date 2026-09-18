// Shore scenery from OpenStreetMap: land-cover-coloured terrain, extruded building footprints, procedural
// houses along the real street network where OSM has no footprints, road ribbons and instanced trees.
// Data: data/venues/<id>.land.json (tools/fetch-venues.mjs --land). Everything is merged per ~1 km tile
// so the whole venue costs a few hundred draw calls and tiles off screen are culled.
import * as THREE from 'three';
import { noise2 } from './env.js';
import { LAND_KINDS } from './world.js';

const K = Object.fromEntries(LAND_KINDS.map((k, i) => [k, i]).filter(([k]) => k));
const TILE = 1000;
const ROAD_W = [14, 12, 10, 9, 8, 6, 6, 5, 3.5];          // motorway .. service
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ------------------------------------------------------------------ data
export async function loadLand(venueId) {
  try {
    const r = await fetch(`data/venues/${venueId}.land.json`);
    if (!r.ok) return null;
    return decodeLand(await r.json());
  } catch { return null; }
}
export function decodeLand(j) {
  if (!j || j.decoded) return j;
  const u = j.unit ?? 0.5;
  const ring = (a, i, n) => { const p = new Float32Array(n * 2); let x = 0, z = 0; for (let k = 0; k < n; k++) { x += a[i + 2 * k]; z += a[i + 2 * k + 1]; if (k === 0) { x = a[i]; z = a[i + 1]; } p[2 * k] = x * u; p[2 * k + 1] = z * u; } return p; };
  const buildings = [], roads = [], areas = [];
  for (let i = 0, B = j.B || []; i < B.length;) { const n = B[i]; buildings.push({ h: B[i + 1] / 10, lv: B[i + 2], ty: B[i + 3], rf: B[i + 4], pts: ring(B, i + 5, n) }); i += 5 + 2 * n; }
  for (let i = 0, R = j.R || []; i < R.length;) { const n = R[i]; roads.push({ cls: R[i + 1], pts: ring(R, i + 2, n) }); i += 2 + 2 * n; }
  for (let i = 0, A = j.A || []; i < A.length;) { const n = A[i]; areas.push({ kind: A[i + 1], pts: ring(A, i + 2, n) }); i += 2 + 2 * n; }
  return { decoded: true, id: j.id, lat: j.lat, buildings, roads, areas };
}

// scanline fill of a polygon into a grid (cell size cs, origin -R): calls fn(i, j) per covered cell
function fillPoly(pts, R, cs, N, fn) {
  let z0 = Infinity, z1 = -Infinity; const n = pts.length / 2;
  for (let k = 0; k < n; k++) { z0 = Math.min(z0, pts[2 * k + 1]); z1 = Math.max(z1, pts[2 * k + 1]); }
  const j0 = Math.max(0, Math.floor((z0 + R) / cs)), j1 = Math.min(N - 1, Math.floor((z1 + R) / cs));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = -R + (j + 0.5) * cs; xs.length = 0;
    for (let k = 0, m = n - 1; k < n; m = k++) {
      const za = pts[2 * m + 1], zb = pts[2 * k + 1];
      if ((za > zc) !== (zb > zc)) xs.push(pts[2 * m] + (zc - za) / (zb - za) * (pts[2 * k] - pts[2 * m]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] + R) / cs - 0.5)), i1 = Math.min(N - 1, Math.floor((xs[q + 1] + R) / cs - 0.5));
      for (let i = i0; i <= i1; i++) fn(i, j);
    }
  }
}
// land-cover raster (8 m): OSM areas, beaches first-class
function coverGrid(world, land, cs = 8) {
  const R = world.R, N = Math.ceil(2 * R / cs), g = new Uint8Array(N * N);
  // paint big/general classes first, specific ones over them
  const order = [K.farmland, K.meadow, K.grassland, K.grass, K.orchard, K.forest, K.wood, K.scrub, K.wetland, K.residential, K.retail, K.commercial, K.industrial, K.park, K.parking, K.sand, K.beach];
  const areas = land ? land.areas.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)) : [];
  for (const a of areas) fillPoly(a.pts, R, cs, N, (i, j) => { g[j * N + i] = a.kind; });
  return { g, N, cs, R, at(x, z) { const i = Math.floor((x + R) / cs), j = Math.floor((z + R) / cs); return i < 0 || j < 0 || i >= N || j >= N ? 0 : g[j * N + i]; } };
}

// town-ness: metres of local streets per 250 m cell (a street grid every ~100 m gives ~1250 m)
function townGrid(world, land) {
  const R = world.R, dc = 250, DN = Math.ceil(2 * R / dc), dens = new Float32Array(DN * DN);
  for (const r of land?.roads || []) {
    if (r.cls < 3 || r.cls > 7) continue;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) { const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]); const i = Math.floor(((p[k] + p[k + 2]) / 2 + R) / dc), j = Math.floor(((p[k + 1] + p[k + 3]) / 2 + R) / dc); if (i >= 0 && j >= 0 && i < DN && j < DN) dens[j * DN + i] += L; }
  }
  // bilinear, so town edges fade instead of stepping at cell borders
  return (x, z) => {
    const fx = (x + R) / dc - 0.5, fz = (z + R) / dc - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const g = (a, b) => a < 0 || b < 0 || a >= DN || b >= DN ? 0 : dens[b * DN + a];
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
}

// ------------------------------------------------------------------ terrain
// Height used for the terrain AND for everything placed on it: a gentle beach ramp at the waterline
// blending into the venue's hills inland; the sea floor shelves to the modelled depth.
// how much of the generic hill model a venue gets: the Yucatán coast is a dead-flat limestone plain
const RELIEF = { progreso: 0.05, meredith: 0.5 };
function groundHeight(world, x, z) {
  const s = world.sdfAt(x, z);
  if (s > 0) return -Math.min(world.depthAt(x, z), 6) - 0.35;
  const d = -s, rel = RELIEF[world.venue?.id] ?? 1;
  const beach = 0.35 + Math.min(d, 60) * 0.022 + 0.25 * sstep(0, 40, d);   // beach face, then the berm
  const w = sstep(25, 220, d);
  const hill = rel < 1 ? Math.min(2.2 + 1.5 * noise2(x / 700, z / 700, 23), 0.8 + d * 0.01) + rel * world.landHeight(x, z) : world.landHeight(x, z);
  return beach * (1 - w) + Math.max(hill, beach) * w;
}

export function buildTerrain(world, land, opts = {}) {
  const R = world.R, f = opts.low ? 24 : 12, Nf = Math.ceil(2 * R / f);
  const tropical = Math.abs(opts.lat ?? land?.lat ?? 45) < 30;
  const cover = opts.cover || coverGrid(world, land), town = opts.town || townGrid(world, land);
  const H = new Float32Array((Nf + 1) * (Nf + 1)).fill(NaN);
  const hv = (i, j) => { i = clamp(i, 0, Nf); j = clamp(j, 0, Nf); const k = j * (Nf + 1) + i; let v = H[k]; if (v !== v) v = H[k] = groundHeight(world, -R + i * f, -R + j * f); return v; };
  // exact height of the rendered surface (fine grid, same triangulation as the mesh)
  const h = (x, z) => {
    const fx = (x + R) / f, fz = (z + R) / f, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    if (u + v <= 1) { const a = hv(i, j); return a + u * (hv(i + 1, j) - a) + v * (hv(i, j + 1) - a); }
    const c = hv(i + 1, j + 1); return c + (1 - u) * (hv(i, j + 1) - c) + (1 - v) * (hv(i + 1, j) - c);
  };
  const pal = tropical ? {
    sand: [0.93, 0.89, 0.78], wetsand: [0.72, 0.66, 0.55], scrub: [0.47, 0.5, 0.3], dry: [0.66, 0.62, 0.45], green: [0.4, 0.5, 0.26],
    forest: [0.24, 0.36, 0.17], wet: [0.33, 0.42, 0.26], town: [0.8, 0.74, 0.62], ind: [0.62, 0.6, 0.56], park: [0.36, 0.52, 0.24], field: [0.62, 0.58, 0.38], asphalt: [0.36, 0.36, 0.36], rock: [0.6, 0.57, 0.5],
  } : {
    sand: [0.86, 0.8, 0.64], wetsand: [0.6, 0.55, 0.45], scrub: [0.4, 0.46, 0.27], dry: [0.55, 0.56, 0.36], green: [0.36, 0.5, 0.24],
    forest: [0.17, 0.3, 0.14], wet: [0.3, 0.38, 0.24], town: [0.56, 0.56, 0.5], ind: [0.52, 0.51, 0.49], park: [0.3, 0.48, 0.2], field: [0.58, 0.55, 0.34], asphalt: [0.33, 0.33, 0.34], rock: [0.52, 0.5, 0.46],
  };
  const colorAt = (x, z, y, out) => {
    const s = world.sdfAt(x, z), kd = cover.at(x, z), n = 0.5 + 0.5 * noise2(x / 60, z / 60, 3), n2 = 0.5 + 0.5 * noise2(x / 400, z / 400, 7);
    let c;
    if (s > 0 || y < 0.2) c = pal.wetsand;
    else if (kd === K.beach || kd === K.sand || (-s < 22 && !kd)) c = pal.sand;
    else if (kd === K.forest || kd === K.wood) c = pal.forest;
    else if (kd === K.scrub) c = pal.scrub;
    else if (kd === K.wetland) c = pal.wet;
    else if (kd === K.residential || kd === K.retail || kd === K.commercial) c = pal.town;
    else if (kd === K.industrial) c = pal.ind;
    else if (kd === K.parking) c = pal.asphalt;
    else if (kd === K.park || kd === K.grass || kd === K.meadow || kd === K.grassland) c = pal.park;
    else if (kd === K.farmland || kd === K.orchard) c = n > 0.5 ? pal.field : pal.green;
    else if (y > 150) c = pal.rock;
    else { const a = sstep(0.3, 0.7, n2), b2 = sstep(0.45, 0.75, n); c = [0, 1, 2].map(k => (pal.dry[k] * (1 - a) + pal.scrub[k] * a) * (1 - 0.35 * b2) + pal.green[k] * 0.35 * b2); }
    // built-up ground (yards, pavements, dust) where the street grid is dense
    const tw = kd === K.park || kd === K.forest || kd === K.wood || kd === K.beach || kd === K.sand || s > 0 ? 0 : sstep(500, 1200, town(x, z)) * 0.85;
    if (tw > 0) c = [0, 1, 2].map(k => c[k] * (1 - tw) + pal.town[k] * tw);
    const t = 0.93 + 0.14 * n;
    // sand darkens toward the wet line
    const wet = s <= 0 && (kd === K.beach || kd === K.sand || -s < 22) ? 1 - sstep(2, 10, -s) : 0;
    out[0] = (c[0] * (1 - wet) + pal.wetsand[0] * wet) * t; out[1] = (c[1] * (1 - wet) + pal.wetsand[1] * wet) * t; out[2] = (c[2] * (1 - wet) + pal.wetsand[2] * wet) * t;
  };
  const group = new THREE.Group(); group.name = 'terrain';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const T = Math.round(480 / f) * f, nt = Math.ceil(2 * R / T), cells = T / f;
  const col = [0, 0, 0];
  for (let tj = 0; tj < nt; tj++) for (let ti = 0; ti < nt; ti++) {
    const x0 = -R + ti * T, z0 = -R + tj * T;
    // classify: skip open water; full detail along the shore; coarse inland
    let smin = Infinity, smax = -Infinity;
    for (let b = 0; b <= 8; b++) for (let a = 0; a <= 8; a++) { const s = world.sdfAt(x0 + a * T / 8, z0 + b * T / 8); smin = Math.min(smin, s); smax = Math.max(smax, s); }
    if (smin > 120) continue;
    const step = smin < 40 && smax > -40 ? 1 : smax > -900 ? 2 : 4, n = cells / step, i0 = ti * cells, j0 = tj * cells;
    const nv = (n + 1) * (n + 1), skirt = 4 * n;
    const pos = new Float32Array((nv + skirt * 2) * 3), nor = new Float32Array((nv + skirt * 2) * 3), cl = new Float32Array((nv + skirt * 2) * 3);
    const idx = [];
    let p = 0;
    for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) {
      const I = i0 + a * step, J = j0 + b * step, x = -R + I * f, z = -R + J * f, y = hv(I, J);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      const dx = hv(I + 1, J) - hv(I - 1, J), dz = hv(I, J + 1) - hv(I, J - 1), L = Math.hypot(dx, 2 * f, dz);
      nor[p] = -dx / L; nor[p + 1] = 2 * f / L; nor[p + 2] = -dz / L;
      colorAt(x, z, y, col); cl[p] = col[0]; cl[p + 1] = col[1]; cl[p + 2] = col[2];
      p += 3;
    }
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) { const k = b * (n + 1) + a; idx.push(k, k + n + 1, k + 1, k + 1, k + n + 1, k + n + 2); }
    // skirts hide the cracks where a detailed tile meets a coarse one
    const border = [];
    for (let a = 0; a < n; a++) border.push(a);
    for (let b = 0; b < n; b++) border.push(b * (n + 1) + n);
    for (let a = n; a > 0; a--) border.push(n * (n + 1) + a);
    for (let b = n; b > 0; b--) border.push(b * (n + 1));
    let q = nv;
    for (const k of border) { pos.set([pos[3 * k], pos[3 * k + 1] - 6, pos[3 * k + 2]], 3 * q); nor.set(nor.subarray(3 * k, 3 * k + 3), 3 * q); cl.set(cl.subarray(3 * k, 3 * k + 3), 3 * q); q++; }
    for (let e = 0; e < border.length; e++) {
      const a = border[e], b2 = border[(e + 1) % border.length], a2 = nv + e, bb = nv + (e + 1) % border.length;
      idx.push(a, a2, b2, b2, a2, bb, a, b2, a2, b2, bb, a2);   // both windings: seen from either side
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, q * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, q * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(cl.subarray(0, q * 3), 3));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m);
  }
  return { group, h, cover, town, material: mat };
}

// ------------------------------------------------------------------ building material (procedural facades)
const NIGHT = { value: 0 };
const SWAY = { value: 0 }, TIME = { value: 0 };
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld;\nvarying vec4 vBld;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvBld = aBld;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
varying vec4 vBld; varying vec3 vWPos; varying vec3 vWNrm;
float hsh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float box(vec2 f, vec2 a, vec2 b, vec2 w){ vec2 lo = smoothstep(a - w, a + w, f), hi = 1.0 - smoothstep(b - w, b + w, f); return lo.x * lo.y * hi.x * hi.y; }
float winMask = 0.0; float winLit = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float kind = vBld.w, hy = vWPos.y - vBld.x, top = vBld.y - vBld.x;
  float wall = 1.0 - step(0.35, abs(vWNrm.y));
  vec2 t2 = normalize(vec2(-vWNrm.z, vWNrm.x) + 1e-5);
  float hx = dot(vWPos.xz, t2);
  float fh = 3.0 + 0.4 * fract(vBld.z * 7.3), ws = kind > 0.5 && kind < 1.5 ? 1.9 : 2.6 + 1.2 * fract(vBld.z * 13.1);
  vec2 cell = vec2(hx / ws, (hy - 0.15) / fh), fc = fract(cell), id = floor(cell);
  vec2 aa = fwidth(cell) * 0.8 + 1e-4;
  float inFacade = wall * step(0.5, hy) * step(hy, top - 0.35);
  float w = 0.0, fr = 0.0, door = 0.0;
  if (kind < 0.5) {                                                   // homes: framed windows, a door per house
    fr = box(fc, vec2(0.24, 0.26), vec2(0.76, 0.86), aa);
    w = box(fc, vec2(0.28, 0.3), vec2(0.72, 0.82), aa);
    float dcol = floor(fract(vBld.z * 5.1) * 3.0);
    if (id.y < 0.5 && abs(mod(id.x, 3.0) - dcol) < 0.5) { door = box(fc, vec2(0.3, 0.0), vec2(0.7, 0.72), aa); w = 0.0; fr = max(fr * 0.0, box(fc, vec2(0.26, 0.0), vec2(0.74, 0.76), aa)); }
  } else if (kind < 1.5) {                                            // offices, flats: wide glazing, mullions
    fr = box(fc, vec2(0.06, 0.2), vec2(0.94, 0.88), aa);
    w = box(fc, vec2(0.08, 0.22), vec2(0.92, 0.86), aa) * (1.0 - box(fc, vec2(0.49, 0.2), vec2(0.51, 0.88), aa));
  } else if (kind < 2.5) {                                            // sheds: a clerestory strip
    float cx = hx / 1.6;
    w = (hy > top - 2.4 && hy < top - 1.1) ? box(vec2(fract(cx), 0.5), vec2(0.15, 0.0), vec2(0.85, 1.0), vec2(fwidth(cx), 0.01)) : 0.0;
  }
  if (kind < 1.5 && id.y < 0.5 && fract(vBld.z * 3.7) > 0.55) { w = max(w, box(fc, vec2(0.1, 0.05), vec2(0.9, 0.78), aa)); fr = max(fr, box(fc, vec2(0.07, 0.02), vec2(0.93, 0.81), aa)); } // shopfront
  w *= inFacade; fr *= inFacade; door *= wall * step(hy, top - 0.35);
  // far away the pattern averages out instead of shimmering
  float far = smoothstep(0.35, 0.9, max(aa.x, aa.y));
  w = mix(w, kind < 2.5 ? 0.28 * inFacade : 0.0, far); fr *= 1.0 - far; door *= 1.0 - far;
  winMask = w;
  float r = hsh(vec3(id, vBld.z * 91.0));
  winLit = step(r, 0.38) * w;
  vec3 base = diffuseColor.rgb;
  vec3 glass = mix(vec3(0.1, 0.11, 0.12), vec3(0.34, 0.38, 0.42), 0.3 + 0.4 * r);
  diffuseColor.rgb = mix(base, mix(base, vec3(0.97, 0.96, 0.93), 0.75), fr);        // light frames / reveals
  diffuseColor.rgb = mix(diffuseColor.rgb, glass, w);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.33, 0.22, 0.14), vec3(0.2, 0.28, 0.33), step(0.5, fract(vBld.z * 2.3))), door);
  // plinth, floor-slab line, parapet coping, grime toward the ground
  float plinth = wall * (1.0 - smoothstep(0.35, 0.45, hy));
  float slab = wall * box(vec2(0.5, hy), vec2(0.0, top - 0.12), vec2(1.0, top + 0.08), vec2(0.01, fwidth(hy)));
  float coping = wall * step(top + 0.6, hy);
  diffuseColor.rgb *= 1.0 - 0.28 * plinth - 0.12 * slab;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.88), coping * 0.6);
  diffuseColor.rgb *= mix(1.0, 0.84 + 0.16 * smoothstep(0.0, 1.4, hy), wall);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, winMask);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * winLit * uNight * 1.6;');
  };
  return m;
}
export function setSceneryNight(group, v) { NIGHT.value = clamp(v, 0, 1); }
// trees sway with the wind (t seconds, wind m/s)
export function tickScenery(group, t, wind = 5) { TIME.value = t; SWAY.value = clamp(wind / 15, 0, 1.5); }

// ------------------------------------------------------------------ geometry accumulator (per tile)
class Acc {
  constructor() { this.cap = 0; this.nv = 0; this.grow(768); }
  grow(cap) {
    const P = new Float32Array(cap * 3), N = new Int8Array(cap * 3), C = new Uint8Array(cap * 3), B = new Float32Array(cap * 4);
    if (this.nv) { P.set(this.P.subarray(0, this.nv * 3)); N.set(this.N.subarray(0, this.nv * 3)); C.set(this.C.subarray(0, this.nv * 3)); B.set(this.B.subarray(0, this.nv * 4)); }
    this.P = P; this.N = N; this.C = C; this.B = B; this.cap = cap;
  }
  v(p, nrm, col, bld) {
    const i = this.nv++, P = this.P, N = this.N, C = this.C, B = this.B;
    P[3 * i] = p[0]; P[3 * i + 1] = p[1]; P[3 * i + 2] = p[2];
    N[3 * i] = nrm[0] * 127; N[3 * i + 1] = nrm[1] * 127; N[3 * i + 2] = nrm[2] * 127;
    C[3 * i] = Math.min(255, col[0] * 255); C[3 * i + 1] = Math.min(255, col[1] * 255); C[3 * i + 2] = Math.min(255, col[2] * 255);
    B[4 * i] = bld[0]; B[4 * i + 1] = bld[1]; B[4 * i + 2] = bld[2]; B[4 * i + 3] = bld[3];
  }
  tri(a, b, c, nrm, col, bld) {
    if (this.nv + 3 > this.cap) this.grow(this.cap * 2);
    // keep the winding consistent with the normal (front face outward)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    this.v(a, nrm, col, bld);
    if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0) { this.v(c, nrm, col, bld); this.v(b, nrm, col, bld); }
    else { this.v(b, nrm, col, bld); this.v(c, nrm, col, bld); }
  }
  quad(a, b, c, d, nrm, col, bld) { this.tri(a, b, c, nrm, col, bld); this.tri(a, c, d, nrm, col, bld); }
  mesh(mat) {
    if (!this.nv) return null;
    const g = new THREE.BufferGeometry(), n = this.nv;
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3, true));
    g.setAttribute('aBld', new THREE.BufferAttribute(this.B.slice(0, n * 4), 4));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.matrixAutoUpdate = false; return m;
  }
}
const nrmOf = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1; return [dz / L, 0, -dx / L]; };

// walls of a ring (outward), from y0 to y1; parapet = extra height with an inner face and a cap
function walls(acc, pts, y0, y1, col, bld, parapet = 0, simple = false) {
  const n = pts.length / 2;
  let area = 0; for (let k = 0, m = n - 1; k < n; m = k++) area += pts[2 * m] * pts[2 * k + 1] - pts[2 * k] * pts[2 * m + 1];
  const s = area > 0 ? 1 : -1;
  const top = y1 + parapet;
  for (let k = 0, m = n - 1; k < n; m = k++) {
    const ax = pts[2 * m], az = pts[2 * m + 1], bx = pts[2 * k], bz = pts[2 * k + 1];
    let nr = nrmOf(ax, az, bx, bz); nr = [nr[0] * s, 0, nr[2] * s];
    acc.quad([ax, y0, az], [bx, y0, bz], [bx, top, bz], [ax, top, az], nr, col, bld);
    if (parapet > 0) {
      const ix = -nr[0] * 0.22, iz = -nr[2] * 0.22;
      if (!simple) acc.quad([ax + ix, y1, az + iz], [bx + ix, y1, bz + iz], [bx + ix, top, bz + iz], [ax + ix, top, az + iz], [-nr[0], 0, -nr[2]], col, bld);
      acc.quad([ax, top, az], [bx, top, bz], [bx + ix, top, bz + iz], [ax + ix, top, az + iz], [0, 1, 0], col, bld);
    }
  }
}
function flatRoof(acc, pts, y, col, bld) {
  const n = pts.length / 2, contour = [];
  if (n === 4) { acc.quad([pts[0], y, pts[1]], [pts[2], y, pts[3]], [pts[4], y, pts[5]], [pts[6], y, pts[7]], [0, 1, 0], col, bld); return; }
  for (let k = 0; k < n; k++) contour.push(new THREE.Vector2(pts[2 * k], pts[2 * k + 1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
  for (const [a, b, c] of tris) acc.tri([contour[a].x, y, contour[a].y], [contour[b].x, y, contour[b].y], [contour[c].x, y, contour[c].y], [0, 1, 0], col, bld);
}
// oriented bounding box of a ring: centre, unit long axis, half extents
function obb(pts) {
  const n = pts.length / 2; let best = null;
  for (let k = 0, m = n - 1; k < n; m = k++) {
    const dx = pts[2 * k] - pts[2 * m], dz = pts[2 * k + 1] - pts[2 * m + 1], L = Math.hypot(dx, dz); if (L < 0.5) continue;
    const ux = dx / L, uz = dz / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let q = 0; q < n; q++) { const a = pts[2 * q] * ux + pts[2 * q + 1] * uz, b = -pts[2 * q] * uz + pts[2 * q + 1] * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uz, a0, a1, b0, b1 };
  }
  if (!best) return null;
  const { ux, uz, a0, a1, b0, b1 } = best;
  let hl = (a1 - a0) / 2, hw = (b1 - b0) / 2, ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  let lx = ux, lz = uz;
  if (hw > hl) { [hl, hw] = [hw, hl]; lx = -uz; lz = ux; }
  return { cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, lx, lz, hl, hw, area: best.area };
}
// gabled or hipped roof over an oriented rectangle (with overhang), underside included
function pitchedRoof(acc, o, y, pitch, hip, col, wallCol, bld) {
  const ov = 0.45, hl = o.hl + ov, hw = o.hw + ov, rise = o.hw * Math.tan(pitch), px = -o.lz, pz = o.lx;
  const P = (a, b, h) => [o.cx + o.lx * a + px * b, y + h, o.cz + o.lz * a + pz * b];
  const r = hip ? Math.min(hl * 0.8, hw) : 0;
  const R0 = P(-hl + r, 0, rise), R1 = P(hl - r, 0, rise);
  const c00 = P(-hl, -hw, 0), c10 = P(hl, -hw, 0), c11 = P(hl, hw, 0), c01 = P(-hl, hw, 0);
  const up = (a, b, c) => { const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const L = Math.hypot(...n) || 1; n = n.map(v => v / L); return n[1] < 0 ? n.map(v => -v) : n; };
  const face = (pts) => { const n = up(pts[0], pts[1], pts[2]); const dn = n.map(v => -v); const dark = col.map(v => v * 0.45);
    for (let k = 1; k + 1 < pts.length; k++) { acc.tri(pts[0], pts[k], pts[k + 1], n, col, bld); acc.tri(pts[0], pts[k], pts[k + 1], dn, dark, bld); } };
  face([c00, c10, R1, R0]); face([c11, c01, R0, R1]);
  if (hip) { face([c10, c11, R1]); face([c01, c00, R0]); }
  else {
    // gable ends: wall-coloured triangles from the eave line to the ridge
    const g0 = [P(-o.hl, -o.hw, 0), P(-o.hl, o.hw, 0), P(-o.hl, 0, rise)], g1 = [P(o.hl, -o.hw, 0), P(o.hl, o.hw, 0), P(o.hl, 0, rise)];
    acc.tri(g0[0], g0[1], g0[2], [-o.lx, 0, -o.lz], wallCol, bld); acc.tri(g1[0], g1[1], g1[2], [o.lx, 0, o.lz], wallCol, bld);
  }
}
function tank(acc, x, z, y, r, h, col, bld) {
  const seg = 6;
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
    acc.quad(p0, p1, [p1[0], y + h, p1[2]], [p0[0], y + h, p0[2]], [Math.cos(am), 0, Math.sin(am)], col, bld);
    acc.tri([x, y + h + 0.12, z], [p0[0], y + h, p0[2]], [p1[0], y + h, p1[2]], [0, 1, 0], col, bld);
  }
}

// ------------------------------------------------------------------ trees
function treeGeometry(kind) {
  const P = [], N = [], C = [];
  const U = [];
  const push = (g, col, m, uv = null) => {
    if (g.index) g = g.toNonIndexed(); if (m) g.applyMatrix4(m); g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); const t = 0.85 + 0.3 * ((i * 7919) % 13) / 13; C.push(col[0] * t, col[1] * t, col[2] * t); if (uv) U.push(uv[2 * i], uv[2 * i + 1]); else U.push(0.02, 0.5); }
  };
  const M4 = new THREE.Matrix4();
  if (kind === 'palm') {
    // curved, ringed trunk
    const H = 8, segs = 4;
    for (let s = 0; s < segs; s++) {
      const y0 = s / segs * H, y1 = (s + 1) / segs * H, b0 = 0.06 * (y0 / H) ** 2 * H, b1 = 0.06 * (y1 / H) ** 2 * H;
      const g = new THREE.CylinderGeometry(0.17 - 0.05 * s / segs, 0.2 - 0.05 * s / segs, y1 - y0, 5, 1, true);
      const dx = b1 - b0, L = y1 - y0;
      M4.makeRotationZ(-Math.atan2(dx, L)).setPosition(b0 + dx / 2, (y0 + y1) / 2, 0);
      push(g, [0.47, 0.41, 0.33], M4);
    }
    const tx = 0.06 * H, ty = H;
    // drooping fronds: tapered double-sided blades
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2 + (k % 2) * 0.2, L = 3.2 + (k % 3) * 0.4, fp = [], fu = [];
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [];
      for (let q = 0; q <= 3; q++) { const u = q / 3, r = u * L, droop = -1.6 * u * u + 0.55 * u; const w = 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.1)) + 0.12; pts.push([tx + ca * r, ty + droop, sa * r, w]); }
      for (let q = 0; q < 3; q++) {
        const [x0, y0, z0, w0] = pts[q], [x1, y1, z1, w1] = pts[q + 1];
        const A = [x0 - sa * w0, y0 - 0.12 * w0, z0 + ca * w0], B = [x0 + sa * w0, y0 - 0.12 * w0, z0 - ca * w0], Cc = [x1 + sa * w1, y1 - 0.12 * w1, z1 - ca * w1], D = [x1 - sa * w1, y1 - 0.12 * w1, z1 + ca * w1], mid0 = [x0, y0 + 0.05, z0], mid1 = [x1, y1 + 0.05, z1];
        // texture: u along the frond (0.12..1), v across (0 edge, 0.5 rib, 1 other edge)
        const u0 = 0.12 + 0.88 * q / 3, u1 = 0.12 + 0.88 * (q + 1) / 3;
        const uA = [u0, 0], uB = [u0, 1], uC = [u1, 1], uD = [u1, 0], um0 = [u0, 0.5], um1 = [u1, 0.5];
        for (const [tri, tu] of [[[A, mid0, mid1], [uA, um0, um1]], [[A, mid1, D], [uA, um1, uD]], [[mid0, B, Cc], [um0, uB, uC]], [[mid0, Cc, mid1], [um0, uC, um1]]]) { for (const v of tri) fp.push(...v); for (const t of tu) fu.push(...t); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      push(g, k % 4 === 0 ? [0.62, 0.58, 0.32] : [0.3, 0.5, 0.2], null, fu);
    }
    push(new THREE.OctahedronGeometry(0.35, 0), [0.35, 0.3, 0.18], M4.makeTranslation(tx, ty - 0.2, 0));
  } else if (kind === 'broad') {
    push(new THREE.CylinderGeometry(0.14, 0.22, 3.2, 5, 1, true), [0.36, 0.29, 0.22], M4.makeTranslation(0, 1.6, 0));
    const lobes = [[0, 4.6, 0, 2.2], [1.25, 4.0, 0.5, 1.6], [-1.15, 4.1, -0.4, 1.7], [0.2, 4.1, -1.25, 1.5], [0.1, 5.5, 0.3, 1.4]];
    for (const [x, y, z, r] of lobes) push(new THREE.IcosahedronGeometry(r, 0), [0.22, 0.38, 0.15], new THREE.Matrix4().makeScale(1, 0.82, 1).setPosition(x, y, z));
  } else if (kind === 'conifer') {
    push(new THREE.CylinderGeometry(0.1, 0.2, 2, 6, 1, true), [0.33, 0.26, 0.2], M4.makeTranslation(0, 1, 0));
    for (const [y, r, h] of [[2.6, 2.1, 3.2], [4.4, 1.6, 2.8], [6.0, 1.05, 2.4], [7.3, 0.6, 1.8]]) push(new THREE.ConeGeometry(r, h, 8, 1, true), [0.13, 0.27, 0.15], new THREE.Matrix4().makeTranslation(0, y, 0));
  } else { // bush
    for (const [x, y, z, r] of [[0, 0.7, 0, 0.9], [0.6, 0.55, 0.3, 0.6], [-0.5, 0.5, -0.2, 0.65], [0.1, 0.5, -0.6, 0.55]]) push(new THREE.IcosahedronGeometry(r, 0), [0.3, 0.38, 0.19], new THREE.Matrix4().makeScale(1, 0.8, 1).setPosition(x, y, z));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeBoundingSphere();
  return g;
}
// pinnate leaflets for palm fronds (alpha-tested); the left strip stays solid for trunks and canopies
function leafTexture() {
  if (typeof document === 'undefined') return null;
  const W = 256, Hh = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W * 0.1, Hh);
  x.strokeStyle = '#fff'; x.lineCap = 'round';
  x.lineWidth = 3; x.beginPath(); x.moveTo(W * 0.12, Hh / 2); x.lineTo(W, Hh / 2); x.stroke();          // rib
  for (let i = 0; i < 46; i++) {
    const u = W * (0.13 + 0.86 * i / 46), len = Hh * 0.5 * (0.75 + 0.25 * Math.sin(i * 1.7));
    x.lineWidth = 2.2;
    for (const sg of [-1, 1]) { x.beginPath(); x.moveTo(u, Hh / 2); x.quadraticCurveTo(u + 6, Hh / 2 + sg * len * 0.5, u + 12, Hh / 2 + sg * len); x.stroke(); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function treeMaterial() {
  const map = leafTexture();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, map, alphaTest: map ? 0.5 : 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = SWAY; sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #else
      float ph = 0.0;
      #endif
      float bend = uSway * max(position.y - 1.0, 0.0) * 0.012 * (1.0 + 0.6 * sin(uTime * 1.3 + ph)) + uSway * max(position.y - 1.0, 0.0) * 0.006 * sin(uTime * 3.1 + ph * 2.0 + position.x);
      transformed.x += bend; transformed.z += bend * 0.4;`);
  };
  return m;
}

// ------------------------------------------------------------------ the scenery
export function buildScenery(world, land, opts = {}) {
  const group = new THREE.Group(); group.name = 'scenery';
  if (!land || world.open) return group;
  land = decodeLand(land);
  const t0 = performance.now();
  const lat = opts.lat ?? land.lat ?? 45, tropical = Math.abs(lat) < 30, low = !!opts.low;
  const onStructure = opts.onStructure || (() => false);
  const R = world.R;
  const terrain = opts.terrain || buildTerrain(world, land, { low, lat });
  const H = terrain.h, cover = terrain.cover || coverGrid(world, land);
  const rand = rng(0x5eed ^ Math.round(R));
  // occupancy (4 m): 1 road, 2 OSM building, 4 procedural house, 8 tree
  const oc = 4, ON = Math.ceil(2 * R / oc), occ = new Uint8Array(ON * ON);
  const oi = (x, z) => { const i = Math.floor((x + R) / oc), j = Math.floor((z + R) / oc); return i < 0 || j < 0 || i >= ON || j >= ON ? -1 : j * ON + i; };
  const mark = (x, z, bit) => { const k = oi(x, z); if (k >= 0) occ[k] |= bit; };
  const test = (x, z, bits) => { const k = oi(x, z); return k < 0 || (occ[k] & bits) !== 0; };
  // roads into the occupancy grid
  for (const r of land.roads) {
    const hw = ROAD_W[r.cls] / 2, p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]), n = Math.max(1, Math.ceil(L / 2));
      for (let s = 0; s <= n; s++) { const x = p[k] + (p[k + 2] - p[k]) * s / n, z = p[k + 1] + (p[k + 3] - p[k + 1]) * s / n;
        for (let a = -hw; a <= hw; a += 2) for (let b = -hw; b <= hw; b += 2) if (a * a + b * b <= hw * hw) mark(x + a, z + b, 1); }
    }
  }
  for (const b of land.buildings) fillPoly(b.pts, R, oc, ON, (i, j) => { occ[j * ON + i] |= 2; });

  const tiles = new Map();
  const tile = (x, z) => { const key = Math.floor((x + R) / TILE) + ',' + Math.floor((z + R) / TILE); let t = tiles.get(key); if (!t) tiles.set(key, t = { b: new Acc(), r: new Acc(), trees: { palm: [], broad: [], conifer: [], bush: [] } }); return t; };
  const WALL_T = [[0.96, 0.94, 0.89], [0.98, 0.96, 0.9], [0.98, 0.82, 0.4], [0.95, 0.66, 0.62], [0.45, 0.78, 0.74], [0.97, 0.6, 0.32], [0.62, 0.78, 0.93], [0.93, 0.87, 0.55], [0.82, 0.42, 0.36], [0.98, 0.98, 0.96],
    [0.62, 0.8, 0.45], [0.92, 0.9, 0.8], [0.75, 0.55, 0.8], [0.99, 0.93, 0.78]];
  const WALL_C = [[0.62, 0.33, 0.25], [0.55, 0.3, 0.24], [0.9, 0.88, 0.83], [0.85, 0.82, 0.74], [0.7, 0.7, 0.68], [0.78, 0.72, 0.6], [0.95, 0.94, 0.9], [0.5, 0.42, 0.36]];
  const ROOF_TILE = [[0.55, 0.24, 0.17], [0.6, 0.3, 0.2], [0.45, 0.2, 0.15], [0.28, 0.29, 0.31], [0.35, 0.36, 0.38], [0.5, 0.33, 0.25]];
  const FLAT = [[0.72, 0.71, 0.68], [0.62, 0.61, 0.59], [0.8, 0.79, 0.76], [0.55, 0.54, 0.52]];
  const pick = (a, r) => a[Math.floor(r * a.length) % a.length];
  const shade = (c, r) => { const t = 0.9 + 0.2 * r; return [c[0] * t, c[1] * t, c[2] * t]; };
  let nB = 0, nInfill = 0, nTank = 0;

  // one building: footprint ring, total height to the eaves, roof style
  const addBuilding = (pts, height, ty, roof, seed, simple = false) => {
    const n = pts.length / 2; let cx = 0, cz = 0, gmin = Infinity;
    for (let k = 0; k < n; k++) { cx += pts[2 * k]; cz += pts[2 * k + 1]; gmin = Math.min(gmin, H(pts[2 * k], pts[2 * k + 1])); }
    cx /= n; cz /= n; gmin = Math.min(gmin, H(cx, cz));
    if (gmin < 0.05) gmin = 0.05;
    const base = gmin - 0.05, y0 = base - 2.5, eave = base + height;
    const r1 = (seed * 9301 % 1000) / 1000, r2 = (seed * 4973 % 1000) / 1000;
    const wallCol = shade(tropical ? pick(WALL_T, r1) : pick(WALL_C, r1), r2);
    const winKind = ty === 4 ? 2 : ty === 6 ? 3 : (ty === 2 || ty === 3 || ty === 7) ? 1 : 0;
    const bld = [base, eave, r1 + r2 * 0.37, winKind];
    const T = tile(cx, cz);
    const o = obb(pts);
    let fa = 0; for (let k = 0, m = n - 1; k < n; m = k++) fa += pts[2 * m] * pts[2 * k + 1] - pts[2 * k] * pts[2 * m + 1]; fa = Math.abs(fa) / 2;
    const rectish = o && fa / o.area > 0.82 && o.hw > 1.5 && o.hw < 9;
    let style = roof;                               // 1 flat, 2 gabled, 3 hipped
    if (!style || style === 4 || style === 5) {
      if (ty === 5) style = 2;
      else if (tropical) style = 1;
      else style = (ty === 1 || (ty === 0 && fa < 260)) ? (r2 < 0.6 ? 2 : 3) : 1;
    }
    if (style !== 1 && !rectish) style = 1;
    const parapet = style === 1 && ty !== 4 && ty !== 6 ? (tropical ? 0.9 : 0.5) : 0;
    walls(T.b, pts, y0, eave, wallCol, bld, parapet, simple);
    if (style === 1) {
      const rc = shade(pick(FLAT, r2), r1);
      flatRoof(T.b, pts, eave + (parapet ? 0.05 : 0), rc, [base, eave, 0, 3]);
      // rooftop water tanks (the black cisterns on every other Yucatán roof), AC boxes elsewhere
      if (tropical && fa < 600 && r1 < 0.45 && o) { tank(T.b, o.cx + o.lx * o.hl * 0.4, o.cz + o.lz * o.hl * 0.4, eave, 0.55, 1.3, [0.08, 0.08, 0.09], [base, eave, 0, 3]); nTank++; }
    } else pitchedRoof(T.b, o, eave, (ty === 5 ? 45 : 28 + 14 * r1) * Math.PI / 180, style === 3, shade(pick(ROOF_TILE, r2), r1), wallCol, [base, eave, 0, 3]);
  };

  // ---- OSM buildings
  for (let bi = 0; bi < land.buildings.length; bi++) {
    const b = land.buildings[bi], p = b.pts, n = p.length / 2;
    if (n < 3) continue;
    let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += p[2 * k]; cz += p[2 * k + 1]; } cx /= n; cz /= n;
    if (world.sdfAt(cx, cz) > -1 || onStructure(cx, cz)) continue;
    let fa = 0; for (let k = 0, m = n - 1; k < n; m = k++) fa += p[2 * m] * p[2 * k + 1] - p[2 * k] * p[2 * m + 1]; fa = Math.abs(fa) / 2;
    if (fa < 6) continue;
    const r = ((bi * 2654435761) >>> 0) / 4294967296;
    const fl = tropical ? 3.1 : 2.9;
    let h = b.h || (b.lv ? b.lv * fl + 0.4 : 0);
    if (!h) {
      h = b.ty === 1 ? fl * (r < 0.55 ? 1 : 2) + (tropical ? 0.3 : 0.4) : b.ty === 2 ? fl * (4 + Math.floor(r * 5)) : b.ty === 3 ? fl * (2 + Math.floor(r * 3)) : b.ty === 4 ? 6 + r * 5
        : b.ty === 5 ? 11 : b.ty === 6 ? 2.7 : b.ty === 7 ? fl * (2 + Math.floor(r * 2)) : fa > 1500 ? 7 + r * 4 : fa > 400 ? fl * (2 + Math.floor(r * 2)) : fl * (1 + Math.floor(r * 2)) + 0.3;
    }
    // with a pitched roof, the tagged height includes the roof: eaves lower
    addBuilding(p, Math.max(2.4, h), b.ty, b.rf, bi * 7 + 3);
    nB++;
  }

  // ---- procedural houses along the street network where OSM has no footprints
  const densAt = terrain.town || townGrid(world, land);
  const NO_HOUSE = new Set([K.forest, K.wood, K.farmland, K.park, K.beach, K.sand, K.wetland, K.industrial, K.parking, K.grass, K.meadow, K.orchard]);
  const maxInfill = low ? 5000 : 22000;
  const roadsByPri = land.roads.filter(r => r.cls >= 4 && r.cls <= 7).map(r => { const p = r.pts; let d = Infinity; for (let k = 0; k < p.length; k += 8) d = Math.min(d, -world.sdfAt(p[k], p[k + 1])); return { r, d }; }).sort((a, b) => a.d - b.d);
  // the lot's own street is guaranteed clear by construction; its first 3.5 m are not tested against the
  // (4 m-cell) road raster, the rest of the lot must be free of streets, footprints and other houses
  const lotFree = (cx, cz, lx, lz, hl, hw, side) => {
    const px = -lz * side, pz = lx * side;         // pointing away from the street
    for (let a = -hl + 0.5; a <= hl - 0.5; a += 2) for (let b = -hw; b <= hw + 0.5; b += 2) {
      const x = cx + lx * a + px * b, z = cz + lz * a + pz * b;
      if (test(x, z, b < -hw + 3.5 ? 6 : 7)) return false;
    }
    for (const [a, b] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [0, 0]]) {
      const x = cx + lx * a + px * b, z = cz + lz * a + pz * b;
      if (world.sdfAt(x, z) > -4 || onStructure(x, z)) return false;
      if (NO_HOUSE.has(cover.at(x, z))) return false;
    }
    return true;
  };
  const gardens = [];
  outer: for (const { r } of roadsByPri) {
    const p = r.pts, hwR = ROAD_W[r.cls] / 2;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 6) continue;
      const lx = (bx - ax) / L, lz = (bz - az) / L;
      for (const side of [-1, 1]) {
        let s = 3;
        while (s < L - 3) {
          const w = tropical ? 7 + rand() * 6 : 8 + rand() * 5;
          const x = ax + lx * (s + w / 2), z = az + lz * (s + w / 2);
          s += w + (tropical ? rand() * 0.4 : 1 + rand() * 3);   // Yucatán towns: houses wall to wall
          const kd = cover.at(x, z), town = sstep(350, 1300, densAt(x, z));
          const pr = kd === K.residential ? Math.max(0.9, town) : kd === K.commercial || kd === K.retail ? 0.8 : (r.cls >= 6 ? town : town * 0.6);
          if (rand() > pr) continue;
          const d = tropical ? 9 + rand() * 8 : 8 + rand() * 4, set = (tropical ? 0.3 + rand() * 1.0 : 3 + rand() * 3);
          const off = side * (hwR + set + d / 2);
          const cx = x - lz * off, cz = z + lx * off;
          // the house's long axis runs away from the street when deep, along it when wide
          const hl = w / 2 - 0.3, hw2 = d / 2;
          if (!lotFree(cx, cz, lx, lz, hl, hw2, side)) continue;
          const px = -lz, pz = lx;
          const pts = new Float32Array([cx - lx * hl - px * hw2, cz - lz * hl - pz * hw2, cx + lx * hl - px * hw2, cz + lz * hl - pz * hw2, cx + lx * hl + px * hw2, cz + lz * hl + pz * hw2, cx - lx * hl + px * hw2, cz - lz * hl + pz * hw2]);
          for (let a = -hl; a <= hl; a += 2) for (let b = -hw2; b <= hw2; b += 2) mark(cx + lx * a + px * b, cz + lz * a + pz * b, 4);
          const rr = rand();
          const floors = tropical ? (rr < 0.62 ? 1 : rr < 0.93 ? 2 : 3) : (rr < 0.35 ? 1 : 2);
          const shop = (kd === K.commercial || kd === K.retail) && rand() < 0.6;
          addBuilding(pts, floors * (tropical ? 3.1 : 2.8) + 0.3, shop ? 3 : 1, tropical ? 1 : (rand() < 0.65 ? 2 : 3), (nInfill + 17) * 31, true);
          nInfill++;
          gardens.push([cx - lz * side * (hw2 + 3), cz + lx * side * (hw2 + 3), tropical ? 0.55 : 0.45]);   // back garden / patio
          gardens.push([x - lz * side * (hwR + 0.6), z + lx * side * (hwR + 0.6), 0.2]);                  // street tree
          if (nInfill >= maxInfill) break outer;
        }
      }
    }
  }

  // ---- roads: ribbons draped on the terrain
  for (const r of land.roads) {
    const p = r.pts, hw = ROAD_W[r.cls] / 2, shade0 = (r.cls <= 2 ? 0.26 : r.cls === 8 ? 0.4 : 0.32) * (tropical ? 1.35 : 1);
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const lx = (bx - ax) / L, lz = (bz - az) / L, px = -lz * hw, pz = lx * hw;
      const n = Math.max(1, Math.ceil(L / 8));
      for (let s = 0; s < n; s++) {
        const x0 = ax + (bx - ax) * s / n, z0 = az + (bz - az) * s / n, x1 = ax + (bx - ax) * (s + 1) / n, z1 = az + (bz - az) * (s + 1) / n;
        if (world.sdfAt(x0, z0) > -1 || world.sdfAt(x1, z1) > -1 || onStructure(x0, z0) || onStructure(x1, z1)) continue;
        // extend a little along the road so segments overlap at bends
        const e = hw * 0.5, ex = lx * e, ez = lz * e;
        const q = [[x0 - ex + px, z0 - ez + pz], [x1 + ex + px, z1 + ez + pz], [x1 + ex - px, z1 + ez - pz], [x0 - ex - px, z0 - ez - pz]].map(([x, z]) => [x, H(x, z) + 0.12, z]);
        const c = shade0 * (0.95 + 0.1 * noise2(x0 / 30, z0 / 30, 11));
        tile(x0, z0).r.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [c, c, c * 1.02], [0, 0, 0, 3]);
      }
    }
  }

  // ---- trees
  const cands = [];
  const tryTree = (x, z, weight) => {
    if (world.sdfAt(x, z) > -6 || test(x, z, 15) || onStructure(x, z)) return;
    const kd = cover.at(x, z);
    if (kd === K.beach || kd === K.sand || kd === K.parking) { if (!(tropical && kd !== K.parking && rand() < 0.15)) return; }
    cands.push([x, z, weight * (0.3 + rand())]);
  };
  for (const [x, z, pr] of gardens) if (rand() < pr) tryTree(x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3, 1.5);
  const woodKinds = new Set([K.forest, K.wood, K.park, K.orchard, K.scrub, K.wetland]);
  for (const a of land.areas) {
    if (!woodKinds.has(a.kind)) continue;
    const p = a.pts; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
    const area = (x1 - x0) * (z1 - z0), n = Math.min(4000, Math.round(area / (a.kind === K.park ? 500 : 220)));
    for (let q = 0; q < n; q++) { const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0); if (cover.at(x, z) === a.kind) tryTree(x, z, a.kind === K.park ? 1.2 : 1); }
  }
  // palms along a tropical beachfront
  if (tropical) for (const r of land.roads) { const p = r.pts; for (let k = 0; k + 1 < p.length; k += 2) if (-world.sdfAt(p[k], p[k + 1]) < 120 && rand() < 0.5) tryTree(p[k] + (rand() - 0.5) * 20, p[k + 1] + (rand() - 0.5) * 20, 2); }
  // nearer the water first (what you see from a boat), a budget in total
  for (const c of cands) c[2] /= 1 + (-world.sdfAt(c[0], c[1])) / 900;
  cands.sort((a, b) => b[2] - a[2]);
  const maxTrees = low ? 2500 : 8000;
  let nTrees = 0;
  for (const [x, z] of cands) {
    if (nTrees >= maxTrees) break;
    if (test(x, z, 8)) continue;
    mark(x, z, 8);
    const kd = cover.at(x, z), r = rand();
    const sp = tropical ? (kd === K.scrub || kd === K.wetland ? (r < 0.75 ? 'bush' : 'broad') : kd === K.beach || kd === K.sand ? 'palm' : r < 0.45 ? 'palm' : r < 0.85 ? 'broad' : 'bush')
      : (kd === K.forest || kd === K.wood ? (r < (Math.abs(lat) > 50 ? 0.5 : 0.25) ? 'conifer' : 'broad') : kd === K.scrub ? 'bush' : r < 0.12 ? 'conifer' : r < 0.9 ? 'broad' : 'bush');
    tile(x, z).trees[sp].push([x, H(x, z) - 0.1, z, 0.75 + rand() * 0.6, rand() * Math.PI * 2, rand()]);
    nTrees++;
  }

  // ---- meshes per tile
  const bMat = facadeMaterial();
  const rMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const tMat = treeMaterial();
  const TG = { palm: treeGeometry('palm'), broad: treeGeometry('broad'), conifer: treeGeometry('conifer'), bush: treeGeometry('bush') };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const t of tiles.values()) {
    const bm = t.b.mesh(bMat); if (bm) { bm.name = 'buildings'; group.add(bm); }
    const rm = t.r.mesh(rMat); if (rm) { rm.name = 'roads'; rm.receiveShadow = true; rm.renderOrder = 1; group.add(rm); }
    for (const [sp, list] of Object.entries(t.trees)) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(TG[sp], tMat, list.length);
      list.forEach(([x, y, z, s, a, c], i) => {
        q.setFromAxisAngle(up, a); sc.set(s, s * (0.85 + 0.3 * c), s); ps.set(x, y, z);
        m4.compose(ps, q, sc); im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setRGB(0.85 + 0.3 * c, 0.9 + 0.2 * (1 - c), 0.85 + 0.2 * c));
      });
      im.computeBoundingSphere(); im.name = 'trees'; im.matrixAutoUpdate = false;
      group.add(im);
    }
  }
  // beaches, as OSM draws them (for terrain colouring and anything else that wants them)
  group.userData.beaches = land.areas.filter(a => a.kind === K.beach || a.kind === K.sand).map(a => a.pts);
  group.userData.terrain = terrain;
  group.userData.stats = { osmBuildings: nB, infill: nInfill, tanks: nTank, trees: nTrees, tiles: tiles.size, meshes: group.children.length, ms: Math.round(performance.now() - t0) };
  return group;
}
