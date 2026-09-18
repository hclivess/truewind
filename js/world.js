// Real-world venues from OpenStreetMap: coastlines + water polygons -> land/water grid,
// signed distance to shore, estimated bathymetry, land-sheltered wind and wave fetch.
// Shared by the browser (live "custom location" fetch) and tools/fetch-venues.mjs (baked venues).

import { noise2 } from './env.js';

export const VENUES = [
  { id: 'progreso', name: 'Puerto Progreso', place: 'Progreso, Yucatán, Mexico', lat: 21.315, lon: -89.668, R: 8000, wind: 70, windKt: 14, depth: 6.5, shelf: 1400,
    current: { kt: 0.4, dir: 270 }, spawn: { lat: 21.2925, lon: -89.6635, heading: 330 },
    note: 'Gulf of Mexico trade-wind sea breeze over the shallow Yucatán shelf, beside the 6.5 km Progreso pier — the longest in the world.' },
  { id: 'solent', name: 'The Solent', place: 'Cowes, Isle of Wight, UK', lat: 50.772, lon: -1.285, wind: 225, windKt: 13, depth: 14, current: { kt: 1.2, dir: 90 }, note: 'Home of Cowes Week. Strong tides along the shore, Bramble Bank shallows.' },
  { id: 'sfbay', name: 'San Francisco Bay', place: 'City Front, California, USA', lat: 37.822, lon: -122.425, wind: 255, windKt: 18, depth: 16, current: { kt: 1.5, dir: 80 }, note: 'The summer sea breeze pours through the Golden Gate. Alcatraz to leeward.' },
  { id: 'garda', name: 'Lake Garda', place: 'Riva del Garda, Italy', lat: 45.846, lon: 10.853, wind: 195, windKt: 14, depth: 90, note: 'Afternoon Ora from the south, funnelled between the mountains.' },
  { id: 'sydney', name: 'Sydney Harbour', place: 'New South Wales, Australia', lat: -33.845, lon: 151.255, wind: 45, windKt: 14, depth: 18, note: 'Summer nor-easter sea breeze, ferries, headlands and bays.' },
  { id: 'kiel', name: 'Kiel Fjord', place: 'Kiel, Germany', lat: 54.41, lon: 10.2, wind: 250, windKt: 12, depth: 16, note: 'Kieler Woche waters, the outer fjord toward the Baltic.' },
  { id: 'newport', name: 'Narragansett Bay', place: 'Newport, Rhode Island, USA', lat: 41.47, lon: -71.36, wind: 215, windKt: 14, depth: 20, current: { kt: 0.6, dir: 20 }, note: 'Classic America\'s Cup ground, reliable afternoon southwesterly.' },
  { id: 'auckland', name: 'Hauraki Gulf', place: 'Auckland, New Zealand', lat: -36.83, lon: 174.82, wind: 230, windKt: 15, depth: 18, note: 'Waitematā Harbour entrance, Rangitoto to the north.' },
  { id: 'marseille', name: 'Rade de Marseille', place: 'Marseille, France', lat: 43.27, lon: 5.33, wind: 315, windKt: 20, depth: 40, note: 'Mistral country. Frioul islands offshore.' },
  { id: 'meredith', name: 'Lake Meredith', place: 'near Amarillo, Texas, USA', lat: 35.69, lon: -101.565, wind: 200, windKt: 14, depth: 25, note: 'Panhandle lake near Amarillo, where Blue Water Boatworks built the Blackwatch 19/24.' },
  { id: 'open', name: 'Open Water', place: 'No land in sight', lat: 0, lon: 0, wind: 0, windKt: 12, depth: 200, open: true, note: 'Just you, the wind and the waves.' },
];

export const MAP_RADIUS = 6000; // metres, half-width of the modelled area

// ---------- projection ----------
export function makeProjection(lat0, lon0) {
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, kz = 110540;
  return {
    fwd: (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz],
    inv: (x, z) => [lat0 - z / kz, lon0 + x / kx],
  };
}

export function overpassQuery(lat, lon, R = MAP_RADIUS + 600) {
  R = Math.max(R, 600);
  const dLat = R / 110540, dLon = R / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  return `[out:json][timeout:90];(way["natural"="coastline"](${bb});way["natural"="water"](${bb});relation["natural"="water"](${bb});way["waterway"="riverbank"](${bb});relation["waterway"="riverbank"](${bb});way["man_made"~"^(pier|breakwater|groyne)$"](${bb});way["bridge"]["highway"](${bb});way["bridge"]["railway"](${bb}););out geom;`;
}

// Douglas-Peucker on flat [x,z,x,z,...]; closed rings are split at their farthest vertex first
function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n > 3 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) {
    let m = 1, md = -1;
    for (let i = 1; i < n - 1; i++) { const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2; if (d > md) { md = d; m = i; } }
    const a = simplifyOpen(pts.slice(0, 2 * m + 2), tol), b = simplifyOpen(pts.slice(2 * m), tol);
    return a.concat(b.slice(2));
  }
  return simplifyOpen(pts, tol);
}
function simplifyOpen(pts, tol) {
  const n = pts.length / 2;
  if (n < 3) return pts;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], az = pts[2 * a + 1], bx = pts[2 * b], bz = pts[2 * b + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[2 * i] - ax) * dz - (pts[2 * i + 1] - az) * dx) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

// Join way pieces into closed rings by matching endpoints
function joinRings(pieces) {
  const rings = [];
  const pool = pieces.map(p => p.slice());
  const same = (ax, az, bx, bz) => Math.abs(ax - bx) < 0.5 && Math.abs(az - bz) < 0.5;
  while (pool.length) {
    let ring = pool.pop();
    let guard = 0;
    while (!same(ring[0], ring[1], ring[ring.length - 2], ring[ring.length - 1]) && guard++ < 5000) {
      const ex = ring[ring.length - 2], ez = ring[ring.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (same(p[0], p[1], ex, ez)) { found = i; break; }
        if (same(p[p.length - 2], p[p.length - 1], ex, ez)) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let p = pool.splice(found, 1)[0];
      if (rev) { const r = []; for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]); p = r; }
      ring = ring.concat(p.slice(2));
    }
    rings.push(ring);
  }
  return rings;
}

// Convert Overpass JSON into compact local geometry: { coast: [[x,z,...]], water: [[ring,...]] }
export function processOSM(osm, lat0, lon0, R = MAP_RADIUS + 600) {
  R = Math.max(R, 600);
  const P = makeProjection(lat0, lon0);
  const toPts = (geom) => { const a = []; for (const g of geom) { const [x, z] = P.fwd(g.lat, g.lon); a.push(Math.round(x * 2) / 2, Math.round(z * 2) / 2); } return a; };
  const coast = [], water = [], piers = [];
  const lim = R * 1.6;
  const near = (pts) => { for (let i = 0; i < pts.length; i += 2) if (Math.abs(pts[i]) < lim && Math.abs(pts[i + 1]) < lim) return true; return false; };
  for (const el of osm.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'way' && el.geometry) {
      const pts = toPts(el.geometry);
      if (tags.natural === 'coastline') { if (near(pts)) { const sp = simplify(pts, 3); sp.osm = el.id; coast.push(sp); } }
      else if (tags.man_made) { if (near(pts)) piers.push({ id: el.id, pts: simplify(pts, 1.5), w: tags.man_made === 'pier' ? 6 : 10, kind: tags.man_made, name: tags.name }); }
      else if (tags.bridge) { if (near(pts)) piers.push({ id: el.id, pts: simplify(pts, 1.5), w: 8, kind: 'bridge', name: tags.name }); }
      else if (pts.length >= 8 && pts[0] === pts[pts.length - 2] && pts[1] === pts[pts.length - 1]) {
        water.push([simplify(pts, 3)]);
      }
    } else if (el.type === 'relation' && el.members) {
      const outer = [], inner = [];
      for (const m of el.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        (m.role === 'inner' ? inner : outer).push(toPts(m.geometry));
      }
      const rings = joinRings(outer).concat(joinRings(inner)).map(r => simplify(r, 3)).filter(r => r.length >= 8);
      if (rings.length) water.push(rings);
    }
  }
  // clip coastline polylines to the area of interest (keep segments near the box)
  const clipped = [];
  for (const line of coast) {
    let cur = []; cur.osm = line.osm;
    for (let i = 0; i < line.length; i += 2) {
      const inside = Math.abs(line[i]) < lim && Math.abs(line[i + 1]) < lim;
      if (inside) cur.push(line[i], line[i + 1]);
      else { if (cur.length) { cur.push(line[i], line[i + 1]); clipped.push(cur); cur = []; cur.osm = line.osm; } }
      if (!inside && i + 2 < line.length && Math.abs(line[i + 2]) < lim && Math.abs(line[i + 3]) < lim) cur.push(line[i], line[i + 1]);
    }
    if (cur.length >= 4) clipped.push(cur);
  }
  const coastOut = clipped.filter(l => l.length >= 4).map(l => ({ id: l.osm, pts: Array.from(l) }));
  return { coast: coastOut, water, piers };
}

// ---------------------------------------------------------------------------------------------
export class World {
  constructor(venue, geo, opts = {}) {
    this.venue = venue;
    this.R = opts.R ?? venue.R ?? MAP_RADIUS;
    this.N = opts.N ?? Math.round(1024 * this.R / MAP_RADIUS / 64) * 64;
    this.cs = 2 * this.R / this.N;
    this.maxDepth = venue.depth ?? 20;
    this.open = !!venue.open || !geo;
    this.build(geo);
  }

  cellOf(x, z) { return [Math.floor((x + this.R) / this.cs), Math.floor((z + this.R) / this.cs)]; }

  build(geo) {
    const N = this.N, cs = this.cs, R = this.R;
    const lab = new Uint8Array(N * N); // 0 unknown, 1 land, 2 water, 3 coast
    this.lab = lab;
    const hasCoast = geo && geo.coast && geo.coast.length > 0;
    const hasWater = geo && geo.water && geo.water.length > 0;
    if (this.open) { lab.fill(2); this.finish(); return; }
    // each coastline sample votes for "land" on its left and "water" on its right; cells seed
    // only on a clear majority, so features narrower than a cell cannot plant wrong-side seeds
    const vl = new Uint16Array(N * N), vw = new Uint16Array(N * N);
    const vote = (x, z, arr) => {
      const i = Math.floor((x + R) / cs), j = Math.floor((z + R) / cs);
      if (i < 0 || j < 0 || i >= N || j >= N) return;
      const k = j * N + i; if (arr[k] < 65000) arr[k]++;
    };
    if (hasCoast) {
      for (const entry of geo.coast) {
        const line = entry.pts || entry;
        for (let s = 0; s + 3 < line.length; s += 2) {
          const ax = line[s], az = line[s + 1], bx = line[s + 2], bz = line[s + 3];
          const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
          if (L < 1e-6) continue;
          const nx = dz / L, nz = -dx / L; // OSM: land lies to the left of the way direction
          const steps = Math.ceil(L / (cs * 0.4));
          for (let k = 0; k <= steps; k++) {
            const t = k / steps, px = ax + dx * t, pz = az + dz * t;
            const i = Math.floor((px + R) / cs), j = Math.floor((pz + R) / cs);
            if (i >= 0 && j >= 0 && i < N && j < N) lab[j * N + i] = 3;
          }
          for (let k = 0; k <= steps; k++) {
            const t = k / steps, px = ax + dx * t, pz = az + dz * t;
            for (const o of [1.2, 2.2]) {
              vote(px + nx * cs * o, pz + nz * cs * o, vl);
              vote(px - nx * cs * o, pz - nz * cs * o, vw);
            }
          }
        }
      }
      // connected regions between coastline cells take the majority of their votes
      const q = new Int32Array(N * N);
      for (let k0 = 0; k0 < N * N; k0++) {
        if (lab[k0] !== 0) continue;
        let qh = 0, qt = 0, sl = 0, sw = 0;
        q[qt++] = k0; lab[k0] = 4;
        while (qh < qt) {
          const k = q[qh++], i = k % N, j = (k / N) | 0;
          sl += vl[k]; sw += vw[k];
          if (i > 0 && lab[k - 1] === 0) { lab[k - 1] = 4; q[qt++] = k - 1; }
          if (i < N - 1 && lab[k + 1] === 0) { lab[k + 1] = 4; q[qt++] = k + 1; }
          if (j > 0 && lab[k - N] === 0) { lab[k - N] = 4; q[qt++] = k - N; }
          if (j < N - 1 && lab[k + N] === 0) { lab[k + N] = 4; q[qt++] = k + N; }
        }
        const v = sl > sw ? 1 : 2;
        for (let m = 0; m < qt; m++) lab[q[m]] = v;
      }
      for (let k = 0; k < N * N; k++) if (lab[k] === 0) lab[k] = 2;
      // coast cells take the majority of their neighbours
      for (let k = 0; k < N * N; k++) if (lab[k] === 3) {
        const i = k % N, j = (k / N) | 0; let l = 0, w = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const v = lab[jj * N + ii]; if (v === 1) l++; else if (v === 2) w++;
        }
        lab[k] = l > w ? 1 : 2;
      }
    } else {
      lab.fill(hasWater ? 1 : 2);
    }
    // lakes and rivers: even-odd scanline fill per multipolygon
    if (hasWater) {
      const xs = [];
      for (const poly of geo.water) {
        let minZ = Infinity, maxZ = -Infinity;
        for (const ring of poly) for (let i = 1; i < ring.length; i += 2) { minZ = Math.min(minZ, ring[i]); maxZ = Math.max(maxZ, ring[i]); }
        const j0 = Math.max(0, Math.floor((minZ + R) / cs)), j1 = Math.min(N - 1, Math.ceil((maxZ + R) / cs));
        for (let j = j0; j <= j1; j++) {
          const zc = -R + (j + 0.5) * cs;
          xs.length = 0;
          for (const ring of poly) {
            for (let s = 0; s + 3 < ring.length; s += 2) {
              const z1 = ring[s + 1], z2 = ring[s + 3];
              if ((z1 <= zc) !== (z2 <= zc)) xs.push(ring[s] + (zc - z1) / (z2 - z1) * (ring[s + 2] - ring[s]));
            }
          }
          xs.sort((a, b) => a - b);
          for (let m = 0; m + 1 < xs.length; m += 2) {
            const i0 = Math.max(0, Math.ceil((xs[m] + R) / cs - 0.5)), i1 = Math.min(N - 1, Math.floor((xs[m + 1] + R) / cs - 0.5));
            for (let i = i0; i <= i1; i++) lab[j * N + i] = 2;
          }
        }
      }
    }
    this.finish();
  }

  finish() {
    const N = this.N, lab = this.lab, cs = this.cs;
    // signed distance to shore (m): + over water, - over land. Two-pass chamfer transform per side.
    const INF = 1e9;
    const dw = new Float32Array(N * N), dl = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) { dw[k] = lab[k] === 2 ? INF : 0; dl[k] = lab[k] === 1 ? INF : 0; }
    const chamfer = (d) => {
      const a = 1, b = Math.SQRT2;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i; let v = d[k]; if (v === 0) continue;
        if (i > 0) v = Math.min(v, d[k - 1] + a);
        if (j > 0) { v = Math.min(v, d[k - N] + a); if (i > 0) v = Math.min(v, d[k - N - 1] + b); if (i < N - 1) v = Math.min(v, d[k - N + 1] + b); }
        d[k] = v;
      }
      for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i; let v = d[k]; if (v === 0) continue;
        if (i < N - 1) v = Math.min(v, d[k + 1] + a);
        if (j < N - 1) { v = Math.min(v, d[k + N] + a); if (i < N - 1) v = Math.min(v, d[k + N + 1] + b); if (i > 0) v = Math.min(v, d[k + N - 1] + b); }
        d[k] = v;
      }
    };
    chamfer(dw); chamfer(dl);
    const sdf = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) sdf[k] = lab[k] === 2 ? Math.min(dw[k], 5000 / cs) * cs - cs * 0.5 : -Math.min(dl[k], 5000 / cs) * cs + cs * 0.5;
    this.sdf = sdf;
    this.windDir = null;
  }

  // bilinear signed distance to shore (m)
  sdfAt(x, z) {
    const N = this.N, cs = this.cs;
    let fx = (x + this.R) / cs - 0.5, fz = (z + this.R) / cs - 0.5;
    fx = Math.max(0, Math.min(N - 1.001, fx)); fz = Math.max(0, Math.min(N - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const k = j * N + i, s = this.sdf;
    return (s[k] * (1 - u) + s[k + 1] * u) * (1 - v) + (s[k + N] * (1 - u) + s[k + N + 1] * u) * v;
  }
  isWater(x, z) { return this.sdfAt(x, z) > 0; }

  // Estimated bathymetry: shelving from the shore to the venue's typical depth, with shoals.
  depthAt(x, z) {
    const d = this.sdfAt(x, z);
    if (d <= 0) return d * 0.05;
    const shoal = 0.75 + 0.5 * (0.5 + 0.5 * noise2(x / 520, z / 520, 91));
    return (0.4 + this.maxDepth * (1 - Math.exp(-d / (this.venue.shelf ?? 220)))) * shoal;
  }
  gradDepth(x, z) {
    const e = this.cs;
    return [(this.depthAt(x + e, z) - this.depthAt(x - e, z)) / (2 * e), (this.depthAt(x, z + e) - this.depthAt(x, z - e)) / (2 * e)];
  }
  landHeight(x, z) {
    const d = -this.sdfAt(x, z);
    if (d <= 0) return -1;
    const n = 0.5 + 0.5 * noise2(x / 900, z / 900, 17);
    const hills = (this.venue.id === 'garda' ? 900 : this.venue.id === 'marseille' ? 220 : 60) * n + 8;
    return Math.min(hills, 1.2 + d * (0.04 + 0.12 * n)) + 3 * noise2(x / 120, z / 120, 5);
  }

  // Distance upwind over open water from (x,z), for a wind coming FROM dir (rad).
  fetchAt(x, z, dir, maxD = 6000) {
    const ux = Math.sin(dir), uz = -Math.cos(dir); // toward where the wind comes from
    let d = 0;
    const step = Math.max(this.cs, 30);
    while (d < maxD) {
      d += step;
      const px = x + ux * d, pz = z + uz * d;
      if (Math.abs(px) > this.R || Math.abs(pz) > this.R) return this.open ? maxD * 5 : maxD * 1.5;
      if (this.sdfAt(px, pz) < 0) return d;
    }
    return maxD;
  }

  // Wind speed factor grid for the current mean wind direction: sheltering behind land.
  // Over land the wind is slowed by roughness and hills; it recovers over ~1 km of open water.
  updateShelter(dir) {
    if (this.windDir !== null && Math.abs(dir - this.windDir) < 0.05) return false;
    this.windDir = dir;
    const M = 96, R = this.R, c = 2 * R / M;
    const g = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = -R + (i + 0.5) * c, z = -R + (j + 0.5) * c;
      const f = this.open ? 99999 : this.fetchAt(x, z, dir, 2500);
      g[j * M + i] = 0.5 + 0.5 * (1 - Math.exp(-f / 700));
    }
    this.shelter = g; this.shelterM = M;
    return true;
  }
  shelterAt(x, z) {
    if (!this.shelter) return 1;
    const M = this.shelterM, c = 2 * this.R / M;
    let fx = (x + this.R) / c - 0.5, fz = (z + this.R) / c - 0.5;
    fx = Math.max(0, Math.min(M - 1.001, fx)); fz = Math.max(0, Math.min(M - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * M + i, s = this.shelter;
    return (s[k] * (1 - u) + s[k + 1] * u) * (1 - v) + (s[k + M] * (1 - u) + s[k + M + 1] * u) * v;
  }

  // Find a patch of open water near the venue centre that can hold a course of length L.
  findCourse(dir, L) {
    const ux = Math.sin(dir), uz = -Math.cos(dir);
    let best = null;
    for (let r = 0; r <= 4000; r += 150) {
      const n = r === 0 ? 1 : Math.ceil(2 * Math.PI * r / 300);
      for (let k = 0; k < n; k++) {
        const a = k / n * 2 * Math.PI, cx = Math.cos(a) * r, cz = Math.sin(a) * r;
        if (this.sdfAt(cx, cz) < 120) continue;
        // how much of the upwind leg + start area stays clear of land
        let ok = 0;
        for (let t = -0.25; t <= 1.1; t += 0.05) {
          const px = cx + ux * L * t, pz = cz + uz * L * t;
          if (this.sdfAt(px, pz) > 80 && this.depthAt(px, pz) > 2.5) ok++; else break;
        }
        const score = ok * 10 - r / 400;
        if (!best || score > best.score) best = { x: cx, z: cz, score, len: Math.max(200, (ok - 6) * 0.05 * L) };
      }
      if (best && best.score > 260) break;
    }
    return best || { x: 0, z: 0, len: L };
  }

  // Encode the SDF for the GPU: 0..255 over -128..+128 m (plus shelter in G)
  sdfTextureData(size = 512) {
    const data = new Uint8Array(size * size * 4);
    const c = 2 * this.R / size;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -this.R + (i + 0.5) * c, z = -this.R + (j + 0.5) * c;
      const s = this.sdfAt(x, z), k = (j * size + i) * 4;
      data[k] = Math.max(0, Math.min(255, Math.round(128 + s)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round(this.depthAt(x, z) * 8)));
      data[k + 2] = Math.round(this.shelterAt(x, z) * 255);
      data[k + 3] = 255;
    }
    return data;
  }
}

// Live fetch for any location (works on GitHub Pages; blocked in sandboxes without network)
export async function fetchVenueGeo(lat, lon) {
  const q = overpassQuery(lat, lon);
  const urls = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      const j = await r.json();
      return processOSM(j, lat, lon);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Live wind at a location from Open-Meteo (free, no key)
export async function fetchLiveWind(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = await r.json();
  const c = j.current;
  return { kt: c.wind_speed_10m, dir: c.wind_direction_10m, gustKt: c.wind_gusts_10m, time: c.time };
}

// ---------------------------------------------------------------------------------------------
// Land scenery from OpenStreetMap: building footprints, roads, land use / land cover.
// Baked by tools/fetch-venues.mjs --land into data/venues/<id>.land.json (compact delta-coded ints,
// 0.5 m units) and turned into meshes by js/scenery.js.
const HW_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
export const LAND_KINDS = ['', 'residential', 'commercial', 'industrial', 'retail', 'farmland', 'forest', 'grass', 'meadow', 'orchard',
  'wood', 'scrub', 'beach', 'sand', 'wetland', 'grassland', 'park', 'parking'];
export function landQueries(lat, lon, R) {
  const dLat = R / 110540, dLon = R / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  const H = '[out:json][timeout:180];';
  return {
    buildings: `${H}(way["building"](${bb}););out tags geom;`,
    roads: `${H}(way["highway"~"^(${HW_CLASSES.join('|')})$"](${bb}););out tags geom;`,
    areas: `${H}(way["landuse"~"^(residential|commercial|industrial|retail|farmland|forest|grass|meadow|orchard)$"](${bb});relation["landuse"~"^(residential|commercial|industrial|retail|farmland|forest|grass|meadow|orchard)$"](${bb});` +
      `way["natural"~"^(wood|scrub|beach|sand|wetland|grassland)$"](${bb});relation["natural"~"^(wood|scrub|beach|sand|wetland|grassland)$"](${bb});` +
      `way["leisure"="park"](${bb});relation["leisure"="park"](${bb});way["amenity"="parking"](${bb}););out tags geom;`,
  };
}
const BTYPE = (t) => {
  const b = t.building;
  if (/^(house|residential|detached|semidetached_house|terrace|bungalow|cabin|farm|hut|static_caravan)$/.test(b)) return 1;
  if (/^(apartments|dormitory|hotel)$/.test(b)) return 2;
  if (/^(commercial|retail|office|supermarket|kiosk|civic|public|government)$/.test(b)) return 3;
  if (/^(industrial|warehouse|shed|hangar|manufacture|storage_tank|silo|service|transportation|hangar|boathouse)$/.test(b)) return 4;
  if (/^(church|cathedral|chapel|mosque|temple|synagogue|religious)$/.test(b)) return 5;
  if (/^(garage|garages|roof|carport|parking)$/.test(b)) return 6;
  if (/^(school|university|college|hospital|train_station|stadium|sports_hall|fire_station)$/.test(b)) return 7;
  return 0;
};
const ROOF = (s) => !s ? 0 : s === 'flat' ? 1 : /^(gabled|gambrel|saltbox|round)$/.test(s) ? 2 : /^(hipped|half-hipped|mansard)$/.test(s) ? 3 : /^(pyramidal|dome|onion|cone)$/.test(s) ? 4 : s === 'skillion' ? 5 : 0;
function areaKind(t) {
  const k = t.landuse || t.natural || (t.leisure === 'park' ? 'park' : t.amenity === 'parking' ? 'parking' : '');
  const i = LAND_KINDS.indexOf(k);
  return i > 0 ? i : 0;
}
// append a ring/polyline: absolute first point, then deltas (0.5 m units)
function pushPts(out, pts) {
  let px = 0, pz = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x = Math.round(pts[i] * 2), z = Math.round(pts[i + 1] * 2);
    if (i === 0) out.push(x, z); else out.push(x - px, z - pz);
    px = x; pz = z;
  }
}
// osm: { buildings, roads, areas } Overpass JSON; world: World built from the venue's water geometry
export function processLand(osm, lat0, lon0, world, opts = {}) {
  const P = makeProjection(lat0, lon0), R = world.R;
  const maxShore = opts.maxShore ?? 2500, maxB = opts.maxBuildings ?? 25000;
  const toPts = (geom) => { const a = []; for (const g of geom) { if (!g) continue; const [x, z] = P.fwd(g.lat, g.lon); a.push(x, z); } return a; };
  const inBox = (x, z, m = 1) => Math.abs(x) < R * m && Math.abs(z) < R * m;
  const openRing = (p) => (p.length >= 4 && Math.abs(p[0] - p[p.length - 2]) < 0.01 && Math.abs(p[1] - p[p.length - 1]) < 0.01) ? p.slice(0, -2) : p;
  // buildings: footprint rings on land near the water, nearest first
  const bl = [];
  for (const el of osm.buildings?.elements || []) {
    if (el.type !== 'way' || !el.geometry) continue;
    let pts = openRing(simplify(toPts(el.geometry), opts.tolB ?? 1.5));
    if (pts.length < 6) continue;
    let cx = 0, cz = 0; for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cz += pts[i + 1]; } cx /= pts.length / 2; cz /= pts.length / 2;
    if (!inBox(cx, cz, 0.98)) continue;
    const s = world.sdfAt(cx, cz);
    if (s > -2 || s < -maxShore) continue;                     // on land, within reach of the shore
    const t = el.tags || {};
    const h = parseFloat(t.height), lv = parseInt(t['building:levels']);
    bl.push({ d: -s, pts, h: isFinite(h) ? Math.min(400, h) : 0, lv: isFinite(lv) ? Math.min(99, lv) : 0, ty: BTYPE(t), rf: ROOF(t['roof:shape']) });
  }
  bl.sort((a, b) => a.d - b.d);
  const B = [];
  for (const b of bl.slice(0, maxB)) { B.push(b.pts.length / 2, Math.round(b.h * 10), b.lv, b.ty, b.rf); pushPts(B, b.pts); }
  // roads: polylines clipped to the modelled box and to the shore band
  const Rd = []; let nR = 0;
  for (const el of osm.roads?.elements || []) {
    if (el.type !== 'way' || !el.geometry) continue;
    const cls = HW_CLASSES.indexOf(el.tags?.highway); if (cls < 0) continue;
    const all = toPts(el.geometry);
    let cur = [];
    const flush = () => { if (cur.length >= 4) { const sp = simplify(cur, opts.tolR ?? 3); Rd.push(sp.length / 2, cls); pushPts(Rd, sp); nR++; } cur = []; };
    for (let i = 0; i < all.length; i += 2) {
      const x = all[i], z = all[i + 1];
      if (inBox(x, z, 0.99) && world.sdfAt(x, z) > -maxShore - 300) cur.push(x, z); else flush();
    }
    flush();
  }
  // land use / cover: outer rings
  const A = []; let nA = 0;
  const addArea = (ring, kind) => {
    ring = openRing(simplify(ring, opts.tolA ?? 8));
    if (ring.length < 6) return;
    let near = false; for (let i = 0; i < ring.length; i += 2) if (inBox(ring[i], ring[i + 1], 1.02)) { near = true; break; }
    if (!near) return;
    A.push(ring.length / 2, kind); pushPts(A, ring); nA++;
  };
  for (const el of osm.areas?.elements || []) {
    const kind = areaKind(el.tags || {}); if (!kind) continue;
    if (el.type === 'way' && el.geometry) addArea(toPts(el.geometry), kind);
    else if (el.type === 'relation' && el.members) {
      const outer = el.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => toPts(m.geometry));
      for (const r of joinRings(outer)) addArea(r, kind);
    }
  }
  return { B, R: Rd, A, counts: { buildings: Math.min(bl.length, maxB), buildingsTotal: bl.length, roads: nR, areas: nA } };
}
