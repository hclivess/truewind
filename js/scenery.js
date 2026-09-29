// Shore scenery from OpenStreetMap: land-cover-coloured terrain, extruded building footprints, procedural
// houses along the real street network (and in villages and housing estates) where OSM has no footprints,
// road ribbons and instanced trees.
// Data: data/venues/<id>.land.json + .land.bin + .land/<i>_<j>.bin (tools/fetch-venues.mjs --land), or Overpass live
// for a custom location. The venue's whole area streams in by distance from the camera, in three levels of detail:
// near (< 2.5 km) every building with its facade, roof, streets and trees, merged per 1 km tile; mid (< 10 km) one
// instanced box (and roof) per building and a cheap crown per tree, per 4 km block; far, the buildings of each
// 30 m cell merged into one low box. Lit windows and a point light per few houses make the towns read at dusk.
import * as THREE from 'three';
import { noise2 } from './env.js';
import { LAND_KINDS, PLACE_KINDS, LAND_CHUNK, TOWN_CELL, decodeLandBin, fetchLandLive } from './world.js';

const K = Object.fromEntries(LAND_KINDS.map((k, i) => [k, i]).filter(([k]) => k));
const PK = Object.fromEntries(PLACE_KINDS.map((k, i) => [k, i]).filter(([k]) => k));
const TILE = 1000, BLOCK = LAND_CHUNK;
const ROAD_W = [14, 12, 10, 9, 8, 6, 6, 5, 3.5];          // motorway .. service
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ------------------------------------------------------------------ data
// -> { areas, town, places, chunks: [{ key: 'i,j' (4 km chunk; 'all' for everything), load() -> { buildings, roads } }] }
export async function loadLand(venueId, world = null) {
  try {
    if (venueId === 'custom') {
      if (!world || world.open) return null;
      const L = await fetchLandLive(world);
      return { decoded: true, id: 'custom', lat: world.venue.lat, live: true, ...L };
    }
    const r = await fetch(`data/venues/${venueId}.land.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.v) return decodeLand(j);
    const b = await fetch(`data/venues/${venueId}.land.bin`);
    if (!b.ok) return null;
    const base = decodeLandBin(await b.arrayBuffer());
    const chunks = Object.entries(j.chunks || {}).map(([key, [bytes, nB]]) => ({ key, bytes, nB, load: async () => {
      const c = await fetch(`data/venues/${venueId}.land/${key.replace(',', '_')}.bin`);
      if (!c.ok) throw new Error(`land chunk ${key}: HTTP ${c.status}`);
      return decodeLandBin(await c.arrayBuffer());
    } }));
    return { decoded: true, id: j.id, lat: j.lat, band: j.band, areas: base.areas, town: base.town, places: (j.places || []).map(([t, x, z, name, pop]) => ({ t, x, z, name, pop })), chunks };
  } catch (e) { console.warn('land', e); return null; }
}
// the old single-file format (delta-coded int arrays): everything in one chunk
export function decodeLand(j) {
  if (!j || j.decoded) return j;
  const u = j.unit ?? 0.5;
  const ring = (a, i, n) => { const p = new Float32Array(n * 2); let x = 0, z = 0; for (let k = 0; k < n; k++) { x += a[i + 2 * k]; z += a[i + 2 * k + 1]; if (k === 0) { x = a[i]; z = a[i + 1]; } p[2 * k] = x * u; p[2 * k + 1] = z * u; } return p; };
  const buildings = [], roads = [], areas = [];
  for (let i = 0, B = j.B || []; i < B.length;) { const n = B[i]; buildings.push({ h: B[i + 1] / 10, lv: B[i + 2], ty: B[i + 3], rf: B[i + 4], pts: ring(B, i + 5, n) }); i += 5 + 2 * n; }
  for (let i = 0, R = j.R || []; i < R.length;) { const n = R[i]; roads.push({ cls: R[i + 1], pts: ring(R, i + 2, n) }); i += 2 + 2 * n; }
  for (let i = 0, A = j.A || []; i < A.length;) { const n = A[i]; areas.push({ kind: A[i + 1], pts: ring(A, i + 2, n) }); i += 2 + 2 * n; }
  return { decoded: true, id: j.id, lat: j.lat, areas, roads, town: null, places: [], chunks: [{ key: 'all', load: async () => ({ buildings, roads }) }] };
}

// scanline fill of a polygon into a grid (cell size cs, N x N cells from (ox, oz)): calls fn(i, j) per covered cell
function fillPoly(pts, ox, oz, cs, N, fn) {
  let z0 = Infinity, z1 = -Infinity; const n = pts.length / 2;
  for (let k = 0; k < n; k++) { z0 = Math.min(z0, pts[2 * k + 1]); z1 = Math.max(z1, pts[2 * k + 1]); }
  const j0 = Math.max(0, Math.floor((z0 - oz) / cs)), j1 = Math.min(N - 1, Math.floor((z1 - oz) / cs));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = oz + (j + 0.5) * cs; xs.length = 0;
    for (let k = 0, m = n - 1; k < n; m = k++) {
      const za = pts[2 * m + 1], zb = pts[2 * k + 1];
      if ((za > zc) !== (zb > zc)) xs.push(pts[2 * m] + (zc - za) / (zb - za) * (pts[2 * k] - pts[2 * m]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] - ox) / cs - 0.5)), i1 = Math.min(N - 1, Math.floor((xs[q + 1] - ox) / cs - 0.5));
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
  for (const a of areas) fillPoly(a.pts, -R, -R, cs, N, (i, j) => { g[j * N + i] = a.kind; });
  return { g, N, cs, R, at(x, z) { const i = Math.floor((x + R) / cs), j = Math.floor((z + R) / cs); return i < 0 || j < 0 || i >= N || j >= N ? 0 : g[j * N + i]; } };
}

// town-ness: metres of local streets per 250 m cell (a street grid every ~100 m gives ~1250 m); baked with the land
// data, or summed from the streets as they arrive (.add(roads): a custom location's live chunks)
function townGrid(world, land) {
  const R = world.R, dc = TOWN_CELL, DN = Math.ceil(2 * R / dc), dens = new Float32Array(DN * DN);
  const add = (roads) => {
    for (const r of roads || []) {
      if (r.cls < 3 || r.cls > 7) continue;
      const p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) { const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]); const i = Math.floor(((p[k] + p[k + 2]) / 2 + R) / dc), j = Math.floor(((p[k + 1] + p[k + 3]) / 2 + R) / dc); if (i >= 0 && j >= 0 && i < DN && j < DN) dens[j * DN + i] += L; }
    }
  };
  const T = land?.town;
  if (T && T.DN === DN) for (let k = 0; k < dens.length; k++) dens[k] = T.q[k] * 10;
  else add(land?.roads);
  // bilinear, so town edges fade instead of stepping at cell borders
  const f = (x, z) => {
    const fx = (x + R) / dc - 0.5, fz = (z + R) / dc - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const g = (a, b) => a < 0 || b < 0 || a >= DN || b >= DN ? 0 : dens[b * DN + a];
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
  f.add = T ? () => {} : add;
  return f;
}

// ------------------------------------------------------------------ terrain
// Height used for the terrain AND for everything placed on it: a gentle beach ramp at the waterline
// blending into the venue's hills inland; the sea floor shelves to the modelled depth.
// how much of the generic hill model a venue gets: the Yucatán coast is a dead-flat limestone plain
const RELIEF = { progreso: 0.05, meredith: 0.5 };
export function groundHeight(world, x, z) {
  const s = world.sdfAt(x, z);
  // (the sea bed at its real height below MSL, so the banks the tide uncovers show where the physics has them dry;
  // the renderer lowers the whole terrain by the tide's level)
  if (s > 0) return world.bed ? -Math.min(world.bedAt(x, z), 6) : -Math.min(world.depthAt(x, z), 6) - 0.35;
  const d = -s, rel = RELIEF[world.venue?.id] ?? 1;
  const beach = 0.35 + Math.min(d, 60) * 0.022 + 0.25 * sstep(0, 40, d);   // beach face, then the berm
  const w = sstep(25, 220, d);
  const hill = rel < 1 ? Math.min(2.2 + 1.5 * noise2(x / 700, z / 700, 23), 0.8 + d * 0.01) + rel * world.landHeight(x, z) : world.landHeight(x, z);
  return beach * (1 - w) + Math.max(hill, beach) * w;
}

export function buildTerrain(world, land, opts = {}) {
  const R = world.R, f = (opts.low ? 24 : 12) * (R > 10000 ? 2 : 1), Nf = Math.ceil(2 * R / f);
  const tropical = Math.abs(opts.lat ?? land?.lat ?? 45) < 30;
  const cover = opts.cover || coverGrid(world, land, R > 10000 ? 16 : 8), town = opts.town || townGrid(world, land);
  const H = new Float32Array((Nf + 1) * (Nf + 1)).fill(NaN);
  const hv = (i, j) => { i = clamp(i, 0, Nf); j = clamp(j, 0, Nf); const k = j * (Nf + 1) + i; let v = H[k]; if (v !== v) v = H[k] = groundHeight(world, -R + i * f, -R + j * f); return v; };
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
  const T = Math.round(480 / f) * f, nt = Math.ceil(2 * R / T), cells = T / f;
  // classify each tile: skip open water; full detail along the shore; coarser inland (a step that divides the tile)
  const steps = new Int8Array(nt * nt);
  for (let tj = 0; tj < nt; tj++) for (let ti = 0; ti < nt; ti++) {
    const x0 = -R + ti * T, z0 = -R + tj * T;
    let smin = Infinity, smax = -Infinity, bmin = Infinity;
    for (let b = 0; b <= 8; b++) for (let a = 0; a <= 8; a++) { const s = world.sdfAt(x0 + a * T / 8, z0 + b * T / 8); smin = Math.min(smin, s); smax = Math.max(smax, s); if (world.bed && s > 120) bmin = Math.min(bmin, world.bedAt(x0 + a * T / 8, z0 + b * T / 8)); }
    // (offshore, only where the tide can uncover the bank: above the lowest tide)
    if (smin > 120 && !(bmin < (world.tide ? world.tide.z0At(x0, z0) : 0) + 0.3)) continue;
    let step = smin < 40 && smax > -40 ? 1 : smax > -900 ? 2 : 4;
    while (cells % step) step >>= 1;
    steps[tj * nt + ti] = step;
  }
  // exact height of the rendered surface: the lattice of the tile's own step, the same triangulation as its mesh,
  // so whatever stands on the ground (buildings, roads, trees) sits on what is drawn, coarse tiles included
  const h = (x, z) => {
    const ti = clamp(Math.floor((x + R) / T), 0, nt - 1), tj = clamp(Math.floor((z + R) / T), 0, nt - 1), st = steps[tj * nt + ti] || 1;
    const fx = (x + R) / f / st, fz = (z + R) / f / st, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, I = i * st, J = j * st;
    if (u + v <= 1) { const a = hv(I, J); return a + u * (hv(I + st, J) - a) + v * (hv(I, J + st) - a); }
    const c = hv(I + st, J + st); return c + (1 - u) * (hv(I, J + st) - c) + (1 - v) * (hv(I + st, J) - c);
  };
  // the ground's colour: one texture over the whole venue (not per-vertex colours, whose detail would change with
  // each tile's mesh step and draw the tile edges), with the streets painted in as their chunks arrive
  const S = opts.low ? 1024 : 2048, px = 2 * R / S, tex = new Uint8Array(S * S * 4), cov = new Uint8Array(S * S);
  const col = [0, 0, 0], ws = pal.wetsand;
  for (let j = 0; j < S; j++) {
    const z = -R + (j + 0.5) * px, tj = Math.floor((z + R) / T);
    for (let i = 0; i < S; i++) {
      const x = -R + (i + 0.5) * px, k = (j * S + i) * 4;
      // (texels round a tile get its colour; open water the wet-sand tone, never seen)
      let used = false;
      for (let dj = -1; dj <= 1 && !used; dj++) for (let di = -1; di <= 1; di++) { const a = Math.floor((x + di * px + R) / T), b = tj + (dj ? Math.floor((z + dj * px + R) / T) - tj : 0); if (a >= 0 && b >= 0 && a < nt && b < nt && steps[b * nt + a]) { used = true; break; } }
      if (used) colorAt(x, z, h(x, z), col); else { col[0] = ws[0]; col[1] = ws[1]; col[2] = ws[2]; }
      tex[k] = Math.min(255, col[0] * 255 + 0.5); tex[k + 1] = Math.min(255, col[1] * 255 + 0.5); tex[k + 2] = Math.min(255, col[2] * 255 + 0.5); tex[k + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(tex, S, S, THREE.RGBAFormat);
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter; map.generateMipmaps = true; map.anisotropy = 16;
  map.needsUpdate = true;
  const asph = pal.asphalt.map(v => v * 255);
  // streets into the ground texture: each texel darkens by the share of it the street covers (the widest wins)
  const paintRoads = (roads) => {
    let n = 0;
    for (const r of roads || []) {
      const w = ROAD_W[r.cls], c = clamp(w / px, 0.08, 1), cq = Math.round(c * 255), p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]), m = Math.max(1, Math.ceil(L / (px * 0.5)));
        for (let q = 0; q <= m; q++) {
          const x = p[k] + (p[k + 2] - p[k]) * q / m, z = p[k + 1] + (p[k + 3] - p[k + 1]) * q / m;
          const i = Math.floor((x + R) / px), j = Math.floor((z + R) / px);
          if (i < 0 || j < 0 || i >= S || j >= S) continue;
          const t = j * S + i; if (cov[t] >= cq || world.sdfAt(x, z) > -1) continue;
          const o = cov[t] / 255, e = t * 4;
          for (let ch = 0; ch < 3; ch++) { const base = o < 1 ? (tex[e + ch] - asph[ch] * o) / (1 - o) : asph[ch]; tex[e + ch] = clamp(Math.round(base * (1 - c) + asph[ch] * c), 0, 255); }
          cov[t] = cq; n++;
        }
      }
    }
    if (n) map.userData.dirty = true;               // (uploaded by the land stream, at most every second or two)
  };
  const mat = withEdge(new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 }));
  EDGE.value = R;
  const uR = 1 / (2 * R);
  for (let tj = 0; tj < nt; tj++) for (let ti = 0; ti < nt; ti++) {
    const step = steps[tj * nt + ti]; if (!step) continue;
    const n = cells / step, i0 = ti * cells, j0 = tj * cells;
    const nv = (n + 1) * (n + 1), skirt = 4 * n;
    const pos = new Float32Array((nv + skirt * 2) * 3), nor = new Float32Array((nv + skirt * 2) * 3), uv = new Float32Array((nv + skirt * 2) * 2);
    const idx = [];
    let p = 0;
    for (let b = 0; b <= n; b++) for (let a = 0; a <= n; a++) {
      const I = i0 + a * step, J = j0 + b * step, x = -R + I * f, z = -R + J * f, y = hv(I, J);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      const dx = hv(I + 1, J) - hv(I - 1, J), dz = hv(I, J + 1) - hv(I, J - 1), L = Math.hypot(dx, 2 * f, dz);
      nor[p] = -dx / L; nor[p + 1] = 2 * f / L; nor[p + 2] = -dz / L;
      uv[p / 3 * 2] = (x + R) * uR; uv[p / 3 * 2 + 1] = (z + R) * uR;
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
    for (const k of border) { pos.set([pos[3 * k], pos[3 * k + 1] - 6, pos[3 * k + 2]], 3 * q); nor.set(nor.subarray(3 * k, 3 * k + 3), 3 * q); uv.set(uv.subarray(2 * k, 2 * k + 2), 2 * q); q++; }
    for (let e = 0; e < border.length; e++) {
      const a = border[e], b2 = border[(e + 1) % border.length], a2 = nv + e, bb = nv + (e + 1) % border.length;
      idx.push(a, a2, b2, b2, a2, bb, a, b2, a2, b2, bb, a2);   // both windings: seen from either side
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, q * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, q * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, q * 2), 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
    group.add(m);
  }
  paintRoads(land?.roads); map.needsUpdate = true;
  return { group, h, cover, town, material: mat, paintRoads };
}

// ------------------------------------------------------------------ the edge of the modelled land
// Nothing is known past the venue's square: rather than end in a cut, the land (and all that stands on it) goes
// into the haze over its last 1.5 km. EDGE: the square's half-width, shared by every scenery material.
const EDGE = { value: 1e9 };
function withEdge(m) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.uniforms.uEdge = EDGE;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uEdge;').replace('#include <fog_fragment>', `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(uEdge - 1500.0, uEdge - 40.0, max(abs(vFogWorld.x), abs(vFogWorld.z))));
#endif`);
  };
  m.customProgramCacheKey = () => 'edge' + (prevKey ? prevKey.call(m) : '');
  return m;
}

// ------------------------------------------------------------------ building material (procedural facades)
const NIGHT = { value: 0 };
const SWAY = { value: 0 }, TIME = { value: 0 };
// fade: for the instanced distant levels, a dithered hand-over by distance: each instance is drawn only nearer than
// (fade.out) or beyond (fade.in) its own threshold, spread between the two distances by a hash of its position, so
// one level thins out while the next fills in over the same band and no line is drawn between them
const DITHER_GLSL = `
float ditherKeep(vec3 o, float lo, float hi, float dir) {
  float hsh = fract(sin(dot(floor(o.xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  float d = length(o.xz - cameraPosition.xz), th = mix(lo, hi, hsh);
  return dir > 0.0 ? step(d, th) : step(th, d);
}`;
function facadeMaterial(fade = null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld;\nattribute vec3 aRoof;\nvarying vec4 vBld;\nvarying vec3 vRoof;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;' + (fade ? DITHER_GLSL : ''))
      // (the distant levels are instanced boxes and roofs: their world position goes through the instance matrix)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vBld = aBld; vRoof = aRoof;
#ifdef USE_INSTANCING
${fade ? `if (ditherKeep((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, ${fade[0].toFixed(1)}, ${fade[1].toFixed(1)}, ${fade[2].toFixed(1)}) < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);` : ''}
vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * (mat3(instanceMatrix) * objectNormal));
#else
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
varying vec4 vBld; varying vec3 vRoof; varying vec3 vWPos; varying vec3 vWNrm;
float hsh(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float box(vec2 f, vec2 a, vec2 b, vec2 w){ vec2 lo = smoothstep(a - w, a + w, f), hi = 1.0 - smoothstep(b - w, b + w, f); return lo.x * lo.y * hi.x * hi.y; }
float winMask = 0.0; float winLit = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // (kind + 8: a distant level's box, whose top is the flat roof)
  float lodBox = step(7.5, vBld.w), kind = vBld.w - 8.0 * lodBox, hy = vWPos.y - vBld.x, top = vBld.y - vBld.x;
  float wall = 1.0 - step(0.35, abs(vWNrm.y));
  if (lodBox > 0.5 && vWNrm.y > 0.6) diffuseColor.rgb = vRoof;                // (the roof's own tone, as near)
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
  // (far off, where a window is under a pixel, each building glows at its own share of lit windows instead of
  // twinkling pixel by pixel)
  winLit = mix(step(r, 0.38), 0.15 + 0.6 * fract(vBld.z * 17.3), far) * w;
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
  m.customProgramCacheKey = () => 'facade' + (fade ? fade.join() : '');
  return m;
}
export function setSceneryNight(group, v) { NIGHT.value = clamp(v, 0, 1); group?.userData.scenery?.setNight(NIGHT.value); }
// trees sway with the wind (t seconds, wind m/s); the land streams in and changes its detail around the camera
export function tickScenery(group, t, wind = 5, camera = null) {
  TIME.value = t; SWAY.value = clamp(wind / 15, 0, 1.5);
  const s = group?.userData.scenery;
  if (s && camera) s.update(camera.position.x, camera.position.z);
}

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
const NEAR = 2500, MID = 10000, HYST = 600;       // m: full detail, instanced blocks, (beyond) merged cells
const WALL_T = [[0.96, 0.94, 0.89], [0.98, 0.96, 0.9], [0.98, 0.82, 0.4], [0.95, 0.66, 0.62], [0.45, 0.78, 0.74], [0.97, 0.6, 0.32], [0.62, 0.78, 0.93], [0.93, 0.87, 0.55], [0.82, 0.42, 0.36], [0.98, 0.98, 0.96],
  [0.62, 0.8, 0.45], [0.92, 0.9, 0.8], [0.75, 0.55, 0.8], [0.99, 0.93, 0.78]];
const WALL_C = [[0.62, 0.33, 0.25], [0.55, 0.3, 0.24], [0.9, 0.88, 0.83], [0.85, 0.82, 0.74], [0.7, 0.7, 0.68], [0.78, 0.72, 0.6], [0.95, 0.94, 0.9], [0.5, 0.42, 0.36]];
const ROOF_TILE = [[0.55, 0.24, 0.17], [0.6, 0.3, 0.2], [0.45, 0.2, 0.15], [0.28, 0.29, 0.31], [0.35, 0.36, 0.38], [0.5, 0.33, 0.25]];
const FLAT = [[0.72, 0.71, 0.68], [0.62, 0.61, 0.59], [0.8, 0.79, 0.76], [0.55, 0.54, 0.52]];
const pick = (a, r) => a[Math.floor(r * a.length) % a.length];
const shade = (c, r) => { const t = 0.9 + 0.2 * r; return [c[0] * t, c[1] * t, c[2] * t]; };
const NO_HOUSE = new Set([K.forest, K.wood, K.farmland, K.park, K.beach, K.sand, K.wetland, K.industrial, K.parking, K.grass, K.meadow, K.orchard]);
const WOOD = { [K.forest]: 220, [K.wood]: 220, [K.orchard]: 220, [K.scrub]: 220, [K.wetland]: 480, [K.park]: 500 };   // m² per tree
// named places without footprints: how far their houses reach (m)
const PLACE_R = { city: 2500, town: 1200, suburb: 700, village: 480, quarter: 380, neighbourhood: 300, hamlet: 200, isolated_dwelling: 45 };
const TREE_CROWN = { palm: [[0.3, 0.5, 0.2], 2.6, 1.0, 7.9], broad: [[0.22, 0.38, 0.15], 2.3, 2.0, 4.6], conifer: [[0.13, 0.27, 0.15], 1.7, 3.4, 4.6], bush: [[0.3, 0.38, 0.19], 1.0, 0.7, 0.6] };

// the distant levels' pieces: a box standing on y = 0 (walls and a flat top), a gable prism (ridge along x, 1 high),
// a tree crown
function unitGeometries() {
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  { const ix = box.index.array; box.setIndex([...ix.slice(0, 18), ...ix.slice(24)]); box.clearGroups(); }   // (no underside: 10 triangles)
  const P = [], a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 1, 0], d = [-0.5, 1, 0], e = [-0.5, 0, 0.5], f = [0.5, 0, 0.5];
  for (const t of [[a, c, b], [a, d, c], [e, f, c], [e, c, d], [a, e, d], [b, c, f]]) for (const v of t) P.push(...v);
  const prism = new THREE.BufferGeometry(); prism.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); prism.computeVertexNormals();
  const crown = new THREE.OctahedronGeometry(1, 0);
  // (the facade material multiplies by the vertex colour: white, so the instance colour shows)
  for (const g of [box, prism]) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return { box, prism, crown };
}
// one geometry per instanced mesh (it carries that mesh's per-instance building data) sharing the unit's buffers
function instGeometry(unit, aBld, aRoof = null) {
  const g = new THREE.BufferGeometry();
  for (const k of Object.keys(unit.attributes)) g.setAttribute(k, unit.attributes[k]);
  if (unit.index) g.setIndex(unit.index);
  if (aBld) g.setAttribute('aBld', new THREE.InstancedBufferAttribute(aBld, 4));
  if (aRoof) g.setAttribute('aRoof', new THREE.InstancedBufferAttribute(aRoof, 3));
  return g;
}
function lightsMaterial(near) {
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const m = new THREE.PointsMaterial({ size: 2.4 * dpr, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  // (inside the near ring the lit windows of the full buildings do this)
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      vFade = smoothstep(${near.toFixed(1)}, ${(near + 900).toFixed(1)}, -mvPosition.z);
      if (vFade <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    sh.uniforms.uEdge = EDGE;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade; uniform float uEdge;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.a *= vFade;
      #ifdef USE_FOG
      diffuseColor.a *= 1.0 - smoothstep(uEdge - 1500.0, uEdge - 40.0, max(abs(vFogWorld.x), abs(vFogWorld.z)));
      #endif`);
  };
  return m;
}
const rectDist = (x, z, x0, z0, x1, z1) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
const hash2 = (a, b) => (Math.imul(Math.round(a) | 0, 73856093) ^ Math.imul(Math.round(b) | 0, 19349663)) >>> 0;

// The land around the camera, streamed: chunks of data load nearest first, 1 km tiles are laid out (footprints
// described, procedural houses and trees placed) and drawn at the detail their distance needs, within a time budget
// per frame. update(x, z) once a frame; idle() once everything near enough is in.
class LandStream {
  constructor(world, land, opts, group, terrain) {
    this.world = world; this.land = land; this.group = group; this.low = !!opts.low;
    this.R = world.R; this.H = terrain.h; this.cover = terrain.cover; this.town = terrain.town; this.terrain = terrain;
    this.onStructure = opts.onStructure || (() => false);
    this.lat = opts.lat ?? land.lat ?? 45; this.tropical = Math.abs(this.lat) < 30;
    this.nearR = this.low ? 1600 : NEAR; this.midR = this.low ? 7000 : MID;
    this.band = (land.band ?? 2500) + 200;              // (how far inland the data reaches: no made-up houses beyond)
    this.tiles = new Map(); this.blocks = new Map(); this.nearSet = new Set();
    // (the hand-over bands: mid to far over the last 1.5 km of the mid ring; tree crowns thin out well before it)
    const f0 = this.midR - 1500, f1 = this.midR - 100;
    this.bMat = facadeMaterial(); this.mMat = facadeMaterial([f0, f1, 1]); this.fMat = facadeMaterial([f0, f1, -1]);
    this.crownR = this.low ? 4500 : 7000;
    this.rMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, transparent: true, depthWrite: false });
    // (the ribbons fade out before the near ring ends; the streets painted into the ground texture carry on beyond)
    this.rMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vRd;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvRd = length((modelMatrix * vec4(transformed, 1.0)).xz - cameraPosition.xz);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRd;').replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= 1.0 - smoothstep(${(this.nearR * 0.55).toFixed(1)}, ${(this.nearR - 150).toFixed(1)}, vRd);`);
    };
    this.rMat.customProgramCacheKey = () => 'road' + this.nearR;
    this.tMat = treeMaterial();
    this.cMat = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true });
    this.cMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + DITHER_GLSL).replace('#include <fog_vertex>', `#include <fog_vertex>
        if (ditherKeep((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, ${(this.crownR - 2500).toFixed(1)}, ${this.crownR.toFixed(1)}, 1.0) < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
    };
    this.cMat.customProgramCacheKey = () => 'crown' + this.crownR;
    this.lMat = lightsMaterial(this.nearR);
    this.TG = { palm: treeGeometry('palm'), broad: treeGeometry('broad'), conifer: treeGeometry('conifer'), bush: treeGeometry('bush') };
    this.U = unitGeometries();
    // (stand-ins, so the renderer's material patches — cloud shadows — reach the materials before the stream uses them)
    for (const m of [this.bMat, this.mMat, this.fMat, this.rMat, this.tMat, this.cMat]) withEdge(m);
    EDGE.value = this.R;
    for (const m of [this.bMat, this.mMat, this.fMat, this.rMat, this.tMat, this.cMat]) { const s = new THREE.Mesh(new THREE.BufferGeometry(), m); s.visible = false; s.name = 'material'; group.add(s); }
    this.places = (land.places || []).filter(p => PLACE_R[PLACE_KINDS[p.t]]).map(p => ({ ...p, r: PLACE_R[PLACE_KINDS[p.t]], ang: (hash2(p.x, p.z) % 628) / 100,
      scatter: p.t === PK.town || p.t === PK.village || p.t === PK.hamlet || p.t === PK.isolated_dwelling }));   // (cities and their suburbs are mapped)
    // tiles on (or near) land
    const R = this.R, nt = Math.ceil(2 * R / TILE);
    for (let j = 0; j < nt; j++) for (let i = 0; i < nt; i++) {
      const x0 = -R + i * TILE, z0 = -R + j * TILE; let smin = Infinity;
      for (let b = 0; b <= 6; b++) for (let a = 0; a <= 6; a++) smin = Math.min(smin, world.sdfAt(x0 + a * TILE / 6, z0 + b * TILE / 6));
      if (smin < 80) this._tile(i, j);
    }
    this.chunks = new Map((land.chunks || []).map(c => [c.key, { ...c, state: 'idle' }]));
    this.loading = 0; this.dirty = true; this.queue = []; this.cx = 0; this.cz = 0; this.rx = Infinity; this.rz = Infinity;
    this.lastT = 0; this.frameMs = 16; this.night = 0;
    this.n = { osm: 0, infill: 0, trees: 0, lights: 0, workMs: 0, maxSliceMs: 0 };
  }
  _tile(i, j) {
    const key = i + ',' + j; let T = this.tiles.get(key);
    if (T) return T;
    const R = this.R, nt = Math.ceil(2 * R / TILE);
    if (i < 0 || j < 0 || i >= nt || j >= nt) return null;
    const x0 = -R + i * TILE, z0 = -R + j * TILE, I = Math.floor(i * TILE / BLOCK), J = Math.floor(j * TILE / BLOCK);
    T = { i, j, key, x0, z0, x1: x0 + TILE, z1: z0 + TILE, osm: [], roads: [], recs: null, trees: null, nearG: null, midHidden: false, block: I + ',' + J };
    T.places = this.places.filter(p => rectDist(p.x, p.z, x0, z0, T.x1, T.z1) < p.r);
    this.tiles.set(key, T);
    let B = this.blocks.get(T.block);
    if (!B) this.blocks.set(T.block, B = { key: T.block, I, J, x0: -R + I * BLOCK, z0: -R + J * BLOCK, x1: -R + (I + 1) * BLOCK, z1: -R + (J + 1) * BLOCK, tiles: [], mid: null, crown: null, far: null, lights: null });
    B.tiles.push(T);
    return T;
  }
  // a chunk's data is in (a chunk that failed to load counts as in, empty)
  _chunkReady(blockKey) {
    const c = this.chunks.get('all') || this.chunks.get(blockKey);
    return !c || c.state === 'ready' || c.state === 'failed';
  }
  _tileReady(T) {
    const R = this.R;
    for (const [x, z] of [[T.x0 - 60, T.z0 - 60], [T.x1 + 60, T.z0 - 60], [T.x0 - 60, T.z1 + 60], [T.x1 + 60, T.z1 + 60]]) {
      const I = Math.floor((clamp(x, -R, R - 1) + R) / BLOCK), J = Math.floor((clamp(z, -R, R - 1) + R) / BLOCK);
      if (!this._chunkReady(I + ',' + J)) return false;
    }
    return true;
  }
  _ingest(d) {
    const R = this.R, tileAt = (x, z) => this._tile(Math.floor((x + R) / TILE), Math.floor((z + R) / TILE));
    for (const b of d.buildings || []) {
      const p = b.pts, n = p.length / 2; if (n < 3) continue;
      let cx = 0, cz = 0; for (let k = 0; k < n; k++) { cx += p[2 * k]; cz += p[2 * k + 1]; } cx /= n; cz /= n;
      let rad = 0; for (let k = 0; k < n; k++) rad = Math.max(rad, Math.abs(p[2 * k] - cx) + Math.abs(p[2 * k + 1] - cz));
      b.cx = cx; b.cz = cz; b.rad = rad;
      const T = tileAt(cx, cz); if (T) T.osm.push(b);
    }
    // a street goes to every tile it passes within 50 m of (the houses along it test against it)
    for (const r of d.roads || []) {
      const p = r.pts; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
      for (let j = Math.floor((z0 - 50 + R) / TILE); j <= Math.floor((z1 + 50 + R) / TILE); j++) for (let i = Math.floor((x0 - 50 + R) / TILE); i <= Math.floor((x1 + 50 + R) / TILE); i++) { const T = this._tile(i, j); if (T) T.roads.push(r); }
    }
    if (!this.land.roads) { this.town.add(d.roads); this.terrain.paintRoads?.(d.roads); }   // (the old single-file format's streets are in already)
  }
  _load() {
    const max = this.land.live ? 2 : 4;
    while (this.loading < max) {
      let best = null, bd = Infinity;
      for (const c of this.chunks.values()) {
        if (c.state !== 'idle') continue;
        const [I, J] = c.key === 'all' ? [0, 0] : c.key.split(',').map(Number);
        const d = c.key === 'all' ? 0 : rectDist(this.cx, this.cz, -this.R + I * BLOCK, -this.R + J * BLOCK, -this.R + (I + 1) * BLOCK, -this.R + (J + 1) * BLOCK);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) return;
      best.state = 'loading'; this.loading++;
      best.load().then(d => { if (this.dead) return; this._ingest(d); best.state = 'ready'; })
        .catch(e => { console.warn('land chunk', best.key, e); best.state = 'failed'; })
        .finally(() => { this.loading--; this.dirty = true; });
    }
  }

  // ---- a tile laid out: footprints described, procedural houses and trees placed
  describe(pts, height, ty, roof, seed, simple) {
    const H = this.H, tropical = this.tropical, n = pts.length / 2;
    let cx = 0, cz = 0, gmin = Infinity;
    for (let k = 0; k < n; k++) { cx += pts[2 * k]; cz += pts[2 * k + 1]; gmin = Math.min(gmin, H(pts[2 * k], pts[2 * k + 1])); }
    cx /= n; cz /= n; gmin = Math.min(gmin, H(cx, cz));
    if (gmin < 0.05) gmin = 0.05;
    const base = gmin - 0.05, y0 = base - 2.5, eave = base + height;
    const r1 = (seed * 9301 % 1000) / 1000, r2 = (seed * 4973 % 1000) / 1000;
    const wallCol = shade(tropical ? pick(WALL_T, r1) : pick(WALL_C, r1), r2);
    const winKind = ty === 4 ? 2 : ty === 6 ? 3 : (ty === 2 || ty === 3 || ty === 7) ? 1 : 0;
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
    const roofCol = style === 1 ? shade(pick(FLAT, r2), r1) : shade(pick(ROOF_TILE, r2), r1);
    return { pts, cx, cz, base, y0, eave, bld: [base, eave, r1 + r2 * 0.37, winKind], wallCol, roofCol, o, fa, style, parapet, ty, simple, r1,
      pitch: (ty === 5 ? 45 : 28 + 14 * r1) * Math.PI / 180, tank: tropical && style === 1 && fa < 600 && r1 < 0.45 && !!o };
  }
  // (the layout and the builds below are generators: they yield now and then, and the stream resumes them within
  // its time budget, so a dense town tile never stalls a frame)
  *_prep(T) {
    const world = this.world, H = this.H, cover = this.cover, onStructure = this.onStructure, tropical = this.tropical, low = this.low, densAt = this.town;
    const x0 = T.x0, z0 = T.z0, M = 48, oc = 4, ON = Math.ceil((TILE + 2 * M) / oc), ox = x0 - M, oz = z0 - M;
    const occ = new Uint8Array(ON * ON);
    const oi = (x, z) => { const i = Math.floor((x - ox) / oc), j = Math.floor((z - oz) / oc); return i < 0 || j < 0 || i >= ON || j >= ON ? -1 : j * ON + i; };
    const mark = (x, z, bit) => { const k = oi(x, z); if (k >= 0) occ[k] |= bit; };
    const test = (x, z, bits) => { const k = oi(x, z); return k < 0 || (occ[k] & bits) !== 0; };
    const inT = (x, z) => x >= T.x0 && x < T.x1 && z >= T.z0 && z < T.z1;
    const rand = rng(hash2(T.i * 7919 + 17, T.j * 104729 + 3) ^ 0x5eed);
    // occupancy (4 m): 1 road, 2 OSM building, 4 procedural house, 8 tree
    // (streets: a disc of cells round every 3 m along each segment)
    let q = 0;
    for (const r of T.roads) {
      if (++q % 20 === 0) yield 'roads';
      const hw = ROAD_W[r.cls] / 2, p = r.pts, rc = hw / oc + 0.35, ri = Math.floor(rc);
      for (let k = 0; k + 3 < p.length; k += 2) {
        if (Math.max(p[k], p[k + 2]) < ox - hw || Math.min(p[k], p[k + 2]) > ox + ON * oc + hw || Math.max(p[k + 1], p[k + 3]) < oz - hw || Math.min(p[k + 1], p[k + 3]) > oz + ON * oc + hw) continue;
        const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]), n = Math.max(1, Math.ceil(L / 3));
        for (let s = 0; s <= n; s++) {
          const fx = (p[k] + (p[k + 2] - p[k]) * s / n - ox) / oc, fz = (p[k + 1] + (p[k + 3] - p[k + 1]) * s / n - oz) / oc, ci = Math.floor(fx), cj = Math.floor(fz);
          for (let b = -ri; b <= ri; b++) {
            const j = cj + b; if (j < 0 || j >= ON) continue;
            for (let a = -ri; a <= ri; a++) { const i = ci + a; if (i >= 0 && i < ON && (i + 0.5 - fx) ** 2 + (j + 0.5 - fz) ** 2 <= rc * rc) occ[j * ON + i] |= 1; }
          }
        }
      }
    }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const N = this.tiles.get((T.i + di) + ',' + (T.j + dj)); if (!N) continue;
      for (const b of N.osm) {
        if (++q % 400 === 0) yield 'fill';
        if (rectDist(b.cx, b.cz, ox, oz, ox + ON * oc, oz + ON * oc) < b.rad) fillPoly(b.pts, ox, oz, oc, ON, (i, j) => { occ[j * ON + i] |= 2; });
      }
    }
    yield 'fill2';
    const recs = [];
    // ---- OSM buildings
    const fl = tropical ? 3.1 : 2.9;
    for (const b of T.osm) {
      if (++q % 250 === 0) yield 'osm';
      const p = b.pts;
      if (world.sdfAt(b.cx, b.cz) > -1 || onStructure(b.cx, b.cz)) continue;
      let fa = 0; for (let k = 0, n = p.length / 2, m = n - 1; k < n; m = k++) fa += p[2 * m] * p[2 * k + 1] - p[2 * k] * p[2 * m + 1]; fa = Math.abs(fa) / 2;
      if (fa < 6) continue;
      const hs = hash2(b.cx * 2, b.cz * 2), r = hs / 4294967296;
      let h = b.h || (b.lv ? b.lv * fl + 0.4 : 0);
      if (!h) {
        h = b.ty === 1 ? fl * (r < 0.55 ? 1 : 2) + (tropical ? 0.3 : 0.4) : b.ty === 2 ? fl * (4 + Math.floor(r * 5)) : b.ty === 3 ? fl * (2 + Math.floor(r * 3)) : b.ty === 4 ? 6 + r * 5
          : b.ty === 5 ? 11 : b.ty === 6 ? 2.7 : b.ty === 7 ? fl * (2 + Math.floor(r * 2)) : fa > 1500 ? 7 + r * 4 : fa > 400 ? fl * (2 + Math.floor(r * 2)) : fl * (1 + Math.floor(r * 2)) + 0.3;
      }
      // (with a pitched roof, the tagged height includes the roof: eaves lower)
      recs.push(this.describe(p, Math.max(2.4, h), b.ty, b.rf, hs % 100003, false));
    }
    this.n.osm += recs.length;
    // places reaching into this tile: their pull toward houses, 1 in the middle fading to 0 at their edge
    const placeW = (x, z, scatter = false) => { let w = 0; for (const pl of T.places) { if (scatter && !pl.scatter) continue; const d = Math.hypot(x - pl.x, z - pl.z); if (d < pl.r) w = Math.max(w, 1 - sstep(pl.r * 0.45, pl.r, d)); } return w; };
    const placeAng = (x, z) => { let best = null, bd = Infinity; for (const pl of T.places) { const d = Math.hypot(x - pl.x, z - pl.z) / pl.r; if (d < bd) { bd = d; best = pl; } } return best ? best.ang : 0; };
    // ---- procedural houses along the street network where OSM has no footprints
    const maxInfill = low ? 500 : 1800;
    let nInfill = 0;
    const gardens = [];
    // the lot's own street is guaranteed clear by construction; its first 3.5 m are not tested against the
    // (4 m-cell) road raster, the rest of the lot must be free of streets, footprints and other houses
    const lotFree = (cx, cz, lx, lz, hl, hw, side, anyCover = false) => {
      const px = -lz * side, pz = lx * side;         // pointing away from the street
      for (let a = -hl + 0.5; a <= hl - 0.5; a += 2) for (let b = -hw; b <= hw + 0.5; b += 2) {
        const x = cx + lx * a + px * b, z = cz + lz * a + pz * b;
        if (test(x, z, b < -hw + 3.5 && !anyCover ? 6 : 7)) return false;
      }
      for (const [a, b] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [0, 0]]) {
        const x = cx + lx * a + px * b, z = cz + lz * a + pz * b;
        if (world.sdfAt(x, z) > -4 || onStructure(x, z)) return false;
        if (NO_HOUSE.has(cover.at(x, z))) return false;
      }
      return true;
    };
    const house = (cx, cz, lx, lz, hl, hw2, kd) => {
      const px = -lz, pz = lx;
      const pts = new Float32Array([cx - lx * hl - px * hw2, cz - lz * hl - pz * hw2, cx + lx * hl - px * hw2, cz + lz * hl - pz * hw2, cx + lx * hl + px * hw2, cz + lz * hl + pz * hw2, cx - lx * hl + px * hw2, cz - lz * hl + pz * hw2]);
      for (let a = -hl; a <= hl; a += 2) for (let b = -hw2; b <= hw2; b += 2) mark(cx + lx * a + px * b, cz + lz * a + pz * b, 4);
      const rr = rand();
      const floors = tropical ? (rr < 0.62 ? 1 : rr < 0.93 ? 2 : 3) : (rr < 0.35 ? 1 : 2);
      const shop = (kd === K.commercial || kd === K.retail) && rand() < 0.6;
      recs.push(this.describe(pts, floors * (tropical ? 3.1 : 2.8) + 0.3, shop ? 3 : 1, tropical ? 1 : (rand() < 0.65 ? 2 : 3), (hash2(cx * 3, cz * 3) % 100003) + 17, true));
      nInfill++;
    };
    const segs = [];
    for (const r of T.roads) {
      if (r.cls < 4 || r.cls > 7) continue;
      const p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) if (inT((p[k] + p[k + 2]) / 2, (p[k + 1] + p[k + 3]) / 2)) segs.push([r, k, -world.sdfAt(p[k], p[k + 1])]);
    }
    segs.sort((a, b) => a[2] - b[2]);                       // nearer the water first
    outer: for (const [r, k] of segs) {
      if (++q % 40 === 0) yield 'street';
      const p = r.pts, hwR = ROAD_W[r.cls] / 2;
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
          let pr = kd === K.residential ? Math.max(0.9, town) : kd === K.commercial || kd === K.retail ? 0.8 : (r.cls >= 6 ? town : town * 0.6);
          pr = Math.max(pr, 0.9 * placeW(x, z));            // a named village with its streets but no footprints
          if (rand() > pr) continue;
          const d = tropical ? 9 + rand() * 8 : 8 + rand() * 4, set = (tropical ? 0.3 + rand() * 1.0 : 3 + rand() * 3);
          const off = side * (hwR + set + d / 2);
          const cx = x - lz * off, cz = z + lx * off;
          const hl = w / 2 - 0.3, hw2 = d / 2;
          if (!lotFree(cx, cz, lx, lz, hl, hw2, side)) continue;
          house(cx, cz, lx, lz, hl, hw2, kd);
          gardens.push([cx - lz * side * (hw2 + 3), cz + lx * side * (hw2 + 3), tropical ? 0.55 : 0.45]);   // back garden / patio
          gardens.push([x - lz * side * (hwR + 0.6), z + lx * side * (hwR + 0.6), 0.2]);                  // street tree
          if (nInfill >= maxInfill) break outer;
        }
      }
    }
    // ---- villages and housing estates OSM draws without streets or footprints: houses scattered over residential
    // land and round named places, wherever nothing stands within 20 m (a mapped town is never that empty)
    if (nInfill < maxInfill && (T.places.some(pl => pl.scatter) || this._hasCover(T, K.residential))) {
      const G = 30;
      for (let gz = T.z0 + G / 2; gz < T.z1; gz += G) for (let gx = T.x0 + G / 2; gx < T.x1; gx += G) {
        if (++q % 300 === 0) yield 'scatter';
        const x = gx + (rand() - 0.5) * G * 0.7, z = gz + (rand() - 0.5) * G * 0.7;
        const kd = cover.at(x, z), pw = placeW(x, z, true);
        if (world.sdfAt(x, z) < -this.band) continue;
        const pr = Math.max(kd === K.residential ? 0.7 : 0, 0.75 * pw);
        if (pr <= 0 || rand() > pr) continue;
        let clear = true;
        for (let b = -20; b <= 20 && clear; b += 4) for (let a = -20; a <= 20; a += 4) if (test(x + a, z + b, 6)) { clear = false; break; }
        if (!clear) continue;
        const ang = placeAng(x, z) + (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.3, lx = Math.cos(ang), lz = Math.sin(ang);
        const hl = (tropical ? 4 : 4.5) + rand() * 2, hw2 = 3.5 + rand() * 1.5;
        if (!lotFree(x, z, lx, lz, hl, hw2, 1, true)) continue;
        house(x, z, lx, lz, hl, hw2, kd);
        gardens.push([x - lz * (hw2 + 4), z + lx * (hw2 + 4), 0.5]);
        if (nInfill >= maxInfill) break;
      }
    }
    this.n.infill += nInfill;
    // ---- trees: gardens, woods and parks (sampled from the land cover), palms along a tropical beachfront
    const cands = [];
    const tryTree = (x, z, weight) => {
      if (!inT(x, z) || world.sdfAt(x, z) > -6 || test(x, z, 15) || onStructure(x, z)) return;
      const kd = cover.at(x, z);
      if (kd === K.beach || kd === K.sand || kd === K.parking) { if (!(tropical && kd !== K.parking && rand() < 0.15)) return; }
      cands.push([x, z, weight * (0.3 + rand())]);
    };
    for (const [x, z, pr] of gardens) if (rand() < pr) tryTree(x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3, 1.5);
    const S = 12;
    for (let gz = T.z0 + S / 2; gz < T.z1; gz += S) for (let gx = T.x0 + S / 2; gx < T.x1; gx += S) {
      if (++q % 2000 === 0) yield 'trees';
      const x = gx + (rand() - 0.5) * S, z = gz + (rand() - 0.5) * S, per = WOOD[cover.at(x, z)];
      if (per && rand() < S * S / per) tryTree(x, z, per > 400 ? 1.2 : 1);
    }
    if (tropical) for (const r of T.roads) { const p = r.pts; for (let k = 0; k + 1 < p.length; k += 2) if (-world.sdfAt(p[k], p[k + 1]) < 120 && rand() < 0.5) tryTree(p[k] + (rand() - 0.5) * 20, p[k + 1] + (rand() - 0.5) * 20, 2); }
    // nearer the water first (what you see from a boat), a budget per tile
    for (const c of cands) c[2] /= 1 + (-world.sdfAt(c[0], c[1])) / 900;
    cands.sort((a, b) => b[2] - a[2]);
    const maxTrees = low ? 150 : 350, trees = [], lat = this.lat;
    for (const [x, z] of cands) {
      if (trees.length >= maxTrees) break;
      if (test(x, z, 8)) continue;
      mark(x, z, 8);
      const kd = cover.at(x, z), r = rand();
      const sp = tropical ? (kd === K.scrub || kd === K.wetland ? (r < 0.75 ? 'bush' : 'broad') : kd === K.beach || kd === K.sand ? 'palm' : r < 0.45 ? 'palm' : r < 0.85 ? 'broad' : 'bush')
        : (kd === K.forest || kd === K.wood ? (r < (Math.abs(lat) > 50 ? 0.5 : 0.25) ? 'conifer' : 'broad') : kd === K.scrub ? 'bush' : r < 0.12 ? 'conifer' : r < 0.9 ? 'broad' : 'bush');
      trees.push([x, H(x, z) - 0.1, z, 0.75 + rand() * 0.6, rand() * Math.PI * 2, rand(), sp]);
    }
    this.n.trees += trees.length;
    T.recs = recs; T.trees = trees;
  }
  _hasCover(T, kind) {
    for (let z = T.z0 + 25; z < T.z1; z += 50) for (let x = T.x0 + 25; x < T.x1; x += 50) if (this.cover.at(x, z) === kind) return true;
    return false;
  }

  // ---- near: every building in full, the streets, the trees (one merged mesh per kind per tile)
  *_buildNear(T) {
    const world = this.world, H = this.H, onStructure = this.onStructure, tropical = this.tropical;
    const g = new THREE.Group(); g.name = 'tile'; g.matrixAutoUpdate = false;
    const b = new Acc(), r = new Acc();
    let qn = 0;
    for (const rec of T.recs) {
      if (++qn % 50 === 0) yield;
      walls(b, rec.pts, rec.y0, rec.eave, rec.wallCol, rec.bld, rec.parapet, rec.simple);
      const top = [rec.base, rec.eave, 0, 3];
      if (rec.style === 1) {
        flatRoof(b, rec.pts, rec.eave + (rec.parapet ? 0.05 : 0), rec.roofCol, top);
        // rooftop water tanks (the black cisterns on every other Yucatán roof)
        if (rec.tank) { const o = rec.o; tank(b, o.cx + o.lx * o.hl * 0.4, o.cz + o.lz * o.hl * 0.4, rec.eave, 0.55, 1.3, [0.08, 0.08, 0.09], top); }
      } else pitchedRoof(b, rec.o, rec.eave, rec.pitch, rec.style === 3, rec.roofCol, rec.wallCol, top);
    }
    // roads: ribbons draped on the terrain (each segment drawn by the tile that holds its middle)
    for (const rd of T.roads) {
      if (++qn % 60 === 0) yield;
      const p = rd.pts, hw = ROAD_W[rd.cls] / 2, shade0 = (rd.cls <= 2 ? 0.26 : rd.cls === 8 ? 0.4 : 0.32) * (tropical ? 1.35 : 1);
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k], az = p[k + 1], bx = p[k + 2], bz = p[k + 3], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (mx < T.x0 || mx >= T.x1 || mz < T.z0 || mz >= T.z1) continue;
        const lx = (bx - ax) / L, lz = (bz - az) / L, px = -lz * hw, pz = lx * hw;
        const n = Math.max(1, Math.ceil(L / 8));
        for (let s = 0; s < n; s++) {
          const x0 = ax + (bx - ax) * s / n, z0 = az + (bz - az) * s / n, x1 = ax + (bx - ax) * (s + 1) / n, z1 = az + (bz - az) * (s + 1) / n;
          if (world.sdfAt(x0, z0) > -1 || world.sdfAt(x1, z1) > -1 || onStructure(x0, z0) || onStructure(x1, z1)) continue;
          // extend a little along the road so segments overlap at bends
          const e = hw * 0.5, ex = lx * e, ez = lz * e;
          const q = [[x0 - ex + px, z0 - ez + pz], [x1 + ex + px, z1 + ez + pz], [x1 + ex - px, z1 + ez - pz], [x0 - ex - px, z0 - ez - pz]].map(([x, z]) => [x, H(x, z) + 0.12, z]);
          const c = shade0 * (0.95 + 0.1 * noise2(x0 / 30, z0 / 30, 11));
          r.quad(q[0], q[1], q[2], q[3], [0, 1, 0], [c, c, c * 1.02], [0, 0, 0, 3]);
        }
      }
    }
    yield;
    const bm = b.mesh(this.bMat); if (bm) { bm.name = 'buildings'; g.add(bm); }
    yield;
    const rm = r.mesh(this.rMat); if (rm) { rm.name = 'roads'; rm.receiveShadow = true; rm.renderOrder = 1; g.add(rm); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const sp of ['palm', 'broad', 'conifer', 'bush']) {
      yield;
      const list = T.trees.filter(t => t[6] === sp);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.TG[sp], this.tMat, list.length);
      list.forEach(([x, y, z, s, a, c], i) => {
        q.setFromAxisAngle(up, a); sc.set(s, s * (0.85 + 0.3 * c), s); ps.set(x, y, z);
        m4.compose(ps, q, sc); im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setRGB(0.85 + 0.3 * c, 0.9 + 0.2 * (1 - c), 0.85 + 0.2 * c));
      });
      im.computeBoundingSphere(); im.name = 'trees'; im.matrixAutoUpdate = false;
      g.add(im);
    }
    this.group.add(g); T.nearG = g; this.nearSet.add(T);
  }
  _dropNear(T) {
    const g = T.nearG; if (!g) return;
    this._midShow(T, true);
    this.group.remove(g);
    g.traverse(o => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh) o.geometry.dispose(); });
    T.nearG = null; this.nearSet.delete(T);
  }

  // ---- mid: per 4 km block, one instanced box per building (and a gable per pitched roof), a crown per tree
  *_buildMid(B) {
    let nb = 0, nr = 0;
    for (const T of B.tiles) for (const rec of T.recs) if (rec.o) { nb++; if (rec.style !== 1) nr++; }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const boxes = this._inst(this.U.box, nb, this.mMat, true), roofs = this._inst(this.U.prism, nr, this.mMat, true);
    let ib = 0, ir = 0, qm = 0;
    for (const T of B.tiles) {
      const r0 = [ib, ir];
      for (const rec of T.recs) {
        if (++qm % 600 === 0) yield;
        const o = rec.o; if (!o) continue;
        const k = rec.style === 1 && rec.fa < o.area * 0.82 ? Math.sqrt(rec.fa / o.area) : 1;
        q.setFromAxisAngle(up, Math.atan2(-o.lz, o.lx));
        m4.compose(ps.set(o.cx, rec.y0, o.cz), q, sc.set(2 * o.hl * k, rec.eave + rec.parapet - rec.y0, 2 * o.hw * k));
        boxes.setMatrixAt(ib, m4); boxes.setColorAt(ib, col.setRGB(...rec.wallCol));
        boxes.userData.aB.set([rec.bld[0], rec.bld[1], rec.bld[2], rec.bld[3] + 8], ib * 4); boxes.userData.aR.set(rec.roofCol, ib * 3); ib++;
        if (rec.style !== 1) {
          m4.compose(ps.set(o.cx, rec.eave, o.cz), q, sc.set(2 * o.hl + 0.9, o.hw * Math.tan(rec.pitch), 2 * o.hw + 0.9));
          roofs.setMatrixAt(ir, m4); roofs.setColorAt(ir, col.setRGB(...rec.roofCol));
          roofs.userData.aB.set([rec.base, rec.eave, 0, 3], ir * 4); ir++;
        }
      }
      T.mid = [r0, [ib, ir]];
      yield;
    }
    B.mid = { parts: [boxes, roofs], meshes: this._add([boxes, roofs], 'mid') };
    for (const T of B.tiles) if (T.nearG) this._midShow(T, false);
  }
  // an instanced mesh of a unit piece, with per-instance colour (and building data, roof colour)
  _inst(unit, n, mat, withBld) {
    if (!n) return null;
    const aB = withBld ? new Float32Array(n * 4) : null, aR = withBld ? new Float32Array(n * 3) : null;
    const im = new THREE.InstancedMesh(instGeometry(unit, aB, aR), mat, n);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    im.matrixAutoUpdate = false; im.userData.aB = aB; im.userData.aR = aR;
    return im;
  }
  _add(list, name) {
    const meshes = list.filter(Boolean);
    for (const m of meshes) { m.computeBoundingSphere(); m.userData.orig = m.instanceMatrix.array.slice(); m.name = name; this.group.add(m); }
    return meshes;
  }
  // ---- tree crowns, per block within the crown ring (they thin out, dithered, toward its edge)
  *_buildCrowns(B) {
    let nc = 0;
    for (const T of B.tiles) nc += T.trees.length;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const crowns = this._inst(this.U.crown, nc, this.cMat, false);
    let ic = 0;
    for (const T of B.tiles) {
      const c0 = ic;
      for (const [x, y, z, s, a, c, sp] of T.trees) {
        const [tc, w, h, cy] = TREE_CROWN[sp];
        q.setFromAxisAngle(up, a);
        m4.compose(ps.set(x, y + cy * s, z), q, sc.set(w * s, h * s * (0.85 + 0.3 * c), w * s));
        crowns.setMatrixAt(ic, m4); crowns.setColorAt(ic, col.setRGB(tc[0] * (0.85 + 0.3 * c), tc[1] * (0.9 + 0.2 * (1 - c)), tc[2] * (0.85 + 0.2 * c))); ic++;
      }
      T.crown = [c0, ic];
      yield;
    }
    B.crown = { parts: [crowns], meshes: this._add([crowns], 'crowns') };
    for (const T of B.tiles) if (T.nearG) { T.crownHidden = false; this._midShow(T, false); }
  }
  // hide (or show again) a tile's instances in its block's mid level and crowns, while its near level stands there
  _midShow(T, on) {
    const B = this.blocks.get(T.block); if (!B) return;
    const put = (m, a, b) => {
      if (!m || b <= a) return;
      const arr = m.instanceMatrix.array;
      if (on) arr.set(m.userData.orig.subarray(a * 16, b * 16), a * 16); else arr.fill(0, a * 16, b * 16);
      m.instanceMatrix.needsUpdate = true;
    };
    if (B.mid && T.mid && T.midHidden !== !on) { B.mid.parts.forEach((m, k) => put(m, T.mid[0][k], T.mid[1][k])); T.midHidden = !on; }
    if (B.crown && T.crown && T.crownHidden !== !on) { put(B.crown.parts[0], T.crown[0], T.crown[1]); T.crownHidden = !on; }
  }
  _dropMid(B) {
    if (!B.mid) return;
    for (const m of B.mid.meshes) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
    B.mid = null;
    for (const T of B.tiles) { T.mid = null; T.midHidden = false; }
  }
  _dropCrowns(B) {
    if (!B.crown) return;
    for (const m of B.crown.meshes) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
    B.crown = null;
    for (const T of B.tiles) { T.crown = null; T.crownHidden = false; }
  }

  // ---- far: the buildings of each 30 m cell merged into one low box; and the block's night lights
  *_buildFar(B) {
    const C = 30, cells = new Map();
    let qf = 0;
    for (const T of B.tiles) for (const rec of T.recs) {
      if (++qf % 1000 === 0) yield;
      const key = Math.floor((rec.cx - B.x0) / C) + Math.floor((rec.cz - B.z0) / C) * 1000;
      let c = cells.get(key);
      if (!c) cells.set(key, c = { fa: 0, h: 0, x: 0, z: 0, base: Infinity, r: 0, g: 0, b: 0, rr: 0, rg: 0, rb: 0, kind: 0 });
      const w = rec.fa, h = rec.eave - rec.base;
      c.fa += w; c.h += h * w; c.x += rec.cx * w; c.z += rec.cz * w; c.base = Math.min(c.base, rec.base);
      c.r += rec.wallCol[0] * w; c.g += rec.wallCol[1] * w; c.b += rec.wallCol[2] * w; if (rec.bld[3] === 1) c.kind = 1;
      c.rr += rec.roofCol[0] * w; c.rg += rec.roofCol[1] * w; c.rb += rec.roofCol[2] * w;
    }
    yield;
    let lights = [];
    const rand = rng(hash2(B.I * 31 + 7, B.J * 131 + 11));
    for (const T of B.tiles) for (const rec of T.recs) {
      if (++qf % 1000 === 0) yield;
      const o = rec.o, big = rec.ty === 2 || rec.ty === 3 || rec.ty === 7;
      const n = big ? Math.min(5, Math.ceil(rec.fa / 300)) : rec.ty === 4 || rec.ty === 6 ? (rand() < 0.15 ? 1 : 0) : rand() < 0.6 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        const a = o ? (rand() - 0.5) * 1.6 * o.hl : 0, b = o ? (rand() - 0.5) * 1.6 * o.hw : 0, lx = o ? o.lx : 1, lz = o ? o.lz : 0;
        const x = rec.cx + lx * a - lz * b, z = rec.cz + lz * a + lx * b, y = rec.base + 1.4 + rand() * Math.max(0, rec.eave - rec.base - 2.2);
        const warm = rand() < (big ? 0.55 : 0.85), t = 0.55 + 0.45 * rand();
        lights.push(x, y, z, t * (warm ? 1 : 0.85), t * (warm ? 0.72 : 0.88), t * (warm ? 0.42 : 1));
      }
    }
    const n = cells.size;
    if (n) {
      const im = this._inst(this.U.box, n, this.fMat, true), aB = im.userData.aB, aR = im.userData.aR;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), col = new THREE.Color();
      let i = 0;
      for (const c of cells.values()) {
        const side = C * Math.sqrt(clamp(c.fa / (C * C) * 1.4, 0.1, 0.85)), h = c.h / c.fa;
        m4.compose(ps.set(c.x / c.fa, c.base - 2.5, c.z / c.fa), q, sc.set(side, h + 2.5, side));
        im.setMatrixAt(i, m4); im.setColorAt(i, col.setRGB(c.r / c.fa, c.g / c.fa, c.b / c.fa));
        aB.set([c.base, c.base + h, (i * 0.618) % 1, 8 + c.kind], i * 4); aR.set([c.rr / c.fa, c.rg / c.fa, c.rb / c.fa], i * 3); i++;
      }
      im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.name = 'far';
      this.group.add(im); B.far = im;
    } else B.far = true;
    if (lights.length) {
      const g = new THREE.BufferGeometry(), a = new Float32Array(lights), P = new Float32Array(a.length / 2), Cc = new Float32Array(a.length / 2);
      for (let k = 0; k < a.length / 6; k++) { P.set(a.subarray(k * 6, k * 6 + 3), k * 3); Cc.set(a.subarray(k * 6 + 3, k * 6 + 6), k * 3); }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(Cc, 3)); g.computeBoundingSphere();
      const pts = new THREE.Points(g, this.lMat); pts.matrixAutoUpdate = false; pts.name = 'lights'; pts.visible = this.night > 0.01; pts.renderOrder = 2;
      this.group.add(pts); B.lights = pts; this.n.lights += P.length / 3;
    } else B.lights = true;
  }

  // ---- the work list, nearest first: near tiles, tiles to lay out, blocks to build
  _rank() {
    const cx = this.cx, cz = this.cz, q = [];
    this.rx = cx; this.rz = cz; this.dirty = false;
    for (const B of this.blocks.values()) {
      const dB = rectDist(cx, cz, B.x0, B.z0, B.x1, B.z1);
      let all = true;
      for (const T of B.tiles) {
        if (!T.recs) {
          all = false;
          if (B.far && dB > this.midR) continue;            // (let go far off: laid out again when it comes nearer)
          if (this._tileReady(T)) q.push([rectDist(cx, cz, T.x0, T.z0, T.x1, T.z1), 0, T]);
        } else if (!T.nearG) { const d = rectDist(cx, cz, T.x0, T.z0, T.x1, T.z1); if (d < this.nearR) q.push([d - 20000, 1, T]); }
      }
      if (!all) continue;
      if (!B.mid && dB < this.midR) q.push([dB + 500, 2, B]);
      if (!B.far) q.push([dB + 2000, 3, B]);
      if (!B.crown && dB < this.crownR) q.push([dB + 800, 4, B]);
    }
    q.sort((a, b) => a[0] - b[0]);
    this.queue = q;
  }
  update(cx, cz) {
    if (this.dead || !this.group.parent) return;
    const now = performance.now();
    if (this.lastT) this.frameMs = this.frameMs * 0.8 + Math.min(1000, now - this.lastT) * 0.2;
    this.lastT = now;
    this.cx = cx; this.cz = cz;
    const map = this.terrain.material?.map;
    if (map?.userData.dirty && now - (this.mapT || 0) > 1500) { map.userData.dirty = false; map.needsUpdate = true; this.mapT = now; }
    this._load();
    if (this.dirty || Math.hypot(cx - this.rx, cz - this.rz) > 150) this._rank();
    // a slice of the frame (a fifth: more on a slow frame, which would be slow anyway)
    const budget = clamp(this.frameMs * 0.2, this.low ? 2.5 : 4, 60);
    while (performance.now() - now < budget) {
      if (!this.job) {
        if (!this.queue.length) break;
        const [, kind, o] = this.queue.shift();
        const go = kind === 0 ? !o.recs : kind === 1 ? !o.nearG && rectDist(cx, cz, o.x0, o.z0, o.x1, o.z1) < this.nearR : kind === 2 ? !o.mid : kind === 3 ? !o.far : !o.crown && rectDist(cx, cz, o.x0, o.z0, o.x1, o.z1) < this.crownR;
        if (!go || o.busy) continue;
        o.busy = true;
        this.job = { o, it: kind === 0 ? this._prep(o) : kind === 1 ? this._buildNear(o) : kind === 2 ? this._buildMid(o) : kind === 3 ? this._buildFar(o) : this._buildCrowns(o) };
      }
      const w0 = performance.now();
      const r = this.job.it.next();
      const dw = performance.now() - w0; this.n.workMs += dw; if (dw > this.n.maxSliceMs) this.n.maxSliceMs = dw;
      if (r.done) { this.job.o.busy = false; this.job = null; this.dirty = true; }
    }
    // levels by distance (with some slack, so crossing a boundary does not rebuild back and forth)
    for (const T of this.nearSet) {
      const d = rectDist(cx, cz, T.x0, T.z0, T.x1, T.z1);
      if (d > this.nearR + HYST) this._dropNear(T); else this._midShow(T, false);
    }
    for (const B of this.blocks.values()) {
      const dB = rectDist(cx, cz, B.x0, B.z0, B.x1, B.z1);
      if (B.mid && dB > this.midR + HYST) this._dropMid(B);
      if (B.crown && dB > this.crownR + HYST) this._dropCrowns(B);
      // (the far level is always there: its cells fill in, dithered, as the mid level's buildings thin out; whole
      // while its block has no mid level yet, so nothing goes missing while that streams in)
      if (B.far && B.far !== true) { const m = B.mid ? this.fMat : this.bMat; if (B.far.material !== m) B.far.material = m; }
      // far off and drawn: its tiles' layouts are let go (memory), and made again, the same, if the camera returns
      if (B.far && !B.mid && dB > this.midR + 3000 && !B.evicted) { for (const T of B.tiles) if (!T.busy && !T.nearG) { T.recs = null; T.trees = null; } B.evicted = true; }
      else if (dB < this.midR) B.evicted = false;
    }
  }
  setNight(v) {
    this.night = v; this.lMat.opacity = v;
    for (const B of this.blocks.values()) if (B.lights && B.lights !== true) B.lights.visible = v > 0.01;
  }
  // nothing left to load or build within r of the camera (default: the mid ring)
  idle(r = this.midR) {
    for (const c of this.chunks.values()) {
      if (c.state === 'loading') return false;
      if (c.state === 'idle') {
        if (c.key === 'all') return false;
        const [I, J] = c.key.split(',').map(Number);
        if (rectDist(this.cx, this.cz, -this.R + I * BLOCK, -this.R + J * BLOCK, -this.R + (I + 1) * BLOCK, -this.R + (J + 1) * BLOCK) < r) return false;
      }
    }
    if (this.dirty) this._rank();
    return !this.job && !this.queue.some(([p, kind]) => (kind === 1 ? p + 20000 : kind === 2 ? p - 500 : kind === 3 ? p - 2000 : kind === 4 ? p - 800 : p) < r);
  }
  stats() {
    let prepped = 0, near = 0, mid = 0, far = 0, chunks = 0;
    for (const T of this.tiles.values()) { if (T.recs) prepped++; if (T.nearG) near++; }
    for (const B of this.blocks.values()) { if (B.mid) mid++; if (B.far) far++; }
    for (const c of this.chunks.values()) if (c.state === 'ready') chunks++;
    return { tiles: this.tiles.size, prepped, near, midBlocks: mid, farBlocks: far, blocks: this.blocks.size, chunks, chunksTotal: this.chunks.size, ...this.n, workMs: Math.round(this.n.workMs), maxSliceMs: Math.round(this.n.maxSliceMs) };
  }
  dispose() { this.dead = true; }
}

export function buildScenery(world, land, opts = {}) {
  const group = new THREE.Group(); group.name = 'scenery';
  if (!land || world.open) return group;
  land = decodeLand(land);
  const terrain = opts.terrain || buildTerrain(world, land, { low: opts.low, lat: opts.lat });
  const stream = new LandStream(world, land, opts, group, terrain);
  group.userData.scenery = stream;
  // beaches, as OSM draws them (for terrain colouring and anything else that wants them)
  group.userData.beaches = land.areas.filter(a => a.kind === K.beach || a.kind === K.sand).map(a => a.pts);
  group.userData.terrain = terrain;
  Object.defineProperty(group.userData, 'stats', { get: () => stream.stats(), enumerable: false });
  return group;
}
