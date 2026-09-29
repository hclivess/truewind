// Real-world venues from OpenStreetMap: coastlines + water polygons -> land/water grid,
// signed distance to shore, real bathymetry (js/bathy.js) under the tide (js/tide.js) or, where no survey grid
// exists (lakes, custom places offline), estimated depths; land-sheltered wind and wave fetch.
// Shared by the browser (live "custom location" fetch) and tools/fetch-venues.mjs (baked venues).

import { noise2 } from './env.js';

export const VENUES = [
  { id: 'progreso', features: true, name: 'Puerto Progreso', place: 'Progreso, Yucatán, Mexico', lat: 21.315, lon: -89.668, R: 8000, wind: 70, windKt: 14, depth: 6.5, shelf: 1400,
    // (the real tide here is small and mixed diurnal; its streams on the wide shelf are a few cm/s, so the westward
    // coastal drift along the Yucatán shore is kept under it)
    current: { kt: 0.4, dir: 270 }, residual: { kt: 0.3, dir: 270 }, spawn: { lat: 21.2925, lon: -89.6635, heading: 330 },
    // (the Yucalpetén refuge harbour's entrance channel and basin: 3.0 m, SEMAR's port questionnaire for Progreso)
    dredged: [{ name: 'Yucalpetén channel', depth: 3, w: 110, pts: [[21.28741, -89.70368], [21.28424, -89.70329], [21.28153, -89.70291], [21.28062, -89.70247], [21.27610, -89.70247]] },
      { name: 'Yucalpetén basin', depth: 3, w: 200, pts: [[21.27583, -89.70657], [21.27501, -89.70127]] }],
    note: 'Gulf of Mexico trade-wind sea breeze over the shallow Yucatán shelf, beside the 6.5 km Progreso pier — the longest in the world.' },
  // (the whole Solent, the Needles to Spithead: the tide runs in at both ends and through Hurst Narrows)
  { id: 'solent', name: 'The Solent', place: 'Cowes, Isle of Wight, UK', lat: 50.772, lon: -1.285, R: 24000, wind: 225, windKt: 13, depth: 14, current: { kt: 1.2, dir: 90 }, note: 'Home of Cowes Week. The tide races through Hurst Narrows, double high water, Bramble Bank dries at low springs.' },
  { id: 'sfbay', name: 'San Francisco Bay', place: 'City Front, California, USA', lat: 37.822, lon: -122.425, wind: 255, windKt: 6, depth: 16, current: { kt: 1.5, dir: 80 }, note: 'The summer sea breeze pours through the Golden Gate. Alcatraz to leeward.',
    // the Gate westerly: the cold Pacific against the Central Valley's heat, slow to build and slow to fade
    // (windKt is the gradient under it: the thermal brings the summer afternoon's 15-25 kn)
    regional: { name: 'Golden Gate westerly', tau: 6, cool: 2.5, local: 0.25, day: { from: 252, gain: 5.1, thr: 0.7 } } },
  { id: 'garda', lake: true, name: 'Lake Garda', place: 'Riva del Garda, Italy', lat: 45.846, lon: 10.853, wind: 195, windKt: 4, depth: 90, note: 'Afternoon Ora from the south, funnelled between the mountains.',
    // the valley winds of the Sarca and Adige: the Ora up the lake by day, the Pelèr down it from the night to late morning
    regional: { name: 'Ora (and the morning Pelèr)', tau: 4, cool: 5, local: 0.4, day: { from: 198, gain: 5.5, thr: 0.6 }, night: { from: 15, gain: 4, thr: 0.5 } } },
  { id: 'sydney', name: 'Sydney Harbour', place: 'New South Wales, Australia', lat: -33.845, lon: 151.255, wind: 45, windKt: 14, depth: 18, note: 'Summer nor-easter sea breeze, ferries, headlands and bays.' },
  { id: 'kiel', name: 'Kiel Fjord', place: 'Kiel, Germany', lat: 54.41, lon: 10.2, wind: 250, windKt: 12, depth: 16, note: 'Kieler Woche waters, the outer fjord toward the Baltic.' },
  { id: 'newport', name: 'Narragansett Bay', place: 'Newport, Rhode Island, USA', lat: 41.47, lon: -71.36, wind: 215, windKt: 14, depth: 20, current: { kt: 0.6, dir: 20 }, note: 'Classic America\'s Cup ground, reliable afternoon southwesterly.' },
  { id: 'auckland', name: 'Hauraki Gulf', place: 'Auckland, New Zealand', lat: -36.83, lon: 174.82, wind: 230, windKt: 15, depth: 18, note: 'Waitematā Harbour entrance, Rangitoto to the north.' },
  { id: 'marseille', name: 'Rade de Marseille', place: 'Marseille, France', lat: 43.27, lon: 5.33, wind: 315, windKt: 20, depth: 40, note: 'Mistral country. Frioul islands offshore.' },
  { id: 'meredith', lake: true, name: 'Lake Meredith', place: 'near Amarillo, Texas, USA', lat: 35.69, lon: -101.565, wind: 200, windKt: 14, depth: 25, note: 'Panhandle lake near Amarillo, where Blue Water Boatworks built the Blackwatch 19/24.' },
  { id: 'southern', name: 'Southern Ocean', place: 'Drake Passage, south of Cape Horn', lat: -57.5, lon: -66.5, wind: 285, windKt: 45, swell: 7, depth: 4000, open: true, preset: true,
    note: 'The Furious Fifties: a westerly gale with nothing to stop it, a big swell from the west under the local sea, and now and then a rogue.' },
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

// in place: each cell of an n × m grid the sum over the (2r+1)² box around it (running sums, rows then columns)
function boxBlur(F, n, m, r) {
  const tmp = new Float64Array(Math.max(n, m));
  for (let j = 0; j < m; j++) {
    let acc = 0; const o = j * n;
    for (let i = 0; i < Math.min(r, n); i++) acc += F[o + i];
    for (let i = 0; i < n; i++) { if (i + r < n) acc += F[o + i + r]; if (i - r - 1 >= 0) acc -= F[o + i - r - 1]; tmp[i] = acc; }
    for (let i = 0; i < n; i++) F[o + i] = tmp[i];
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < Math.min(r, m); j++) acc += F[j * n + i];
    for (let j = 0; j < m; j++) { if (j + r < m) acc += F[(j + r) * n + i]; if (j - r - 1 >= 0) acc -= F[(j - r - 1) * n + i]; tmp[j] = acc; }
    for (let j = 0; j < m; j++) F[j * n + i] = tmp[j];
  }
}

// ---------------------------------------------------------------------------------------------
export class World {
  constructor(venue, geo, opts = {}) {
    this.venue = venue;
    this.R = opts.R ?? venue.R ?? MAP_RADIUS;
    this.N = opts.N ?? Math.min(2048, Math.round(1024 * this.R / MAP_RADIUS / 64) * 64);   // (the big Solent: 23 m cells)
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

  // Estimated bathymetry (no survey grid): shelving from the shore to the venue's typical depth, with shoals.
  estDepth(x, z, d = this.sdfAt(x, z)) {
    const shoal = 0.75 + 0.5 * (0.5 + 0.5 * noise2(x / 520, z / 520, 91));
    return (0.4 + this.maxDepth * (1 - Math.exp(-d / (this.venue.shelf ?? 220)))) * shoal;
  }
  // Real bathymetry (a Bathy grid of depth below MSL) laid onto the OSM shoreline: the coastline is mean high water,
  // so on its water side the bed is at least 10 cm below MHW (drying banks stay, but the shore is wet at high
  // water); on the land side the bed rises just clear of MHW, so the shore ramps up within a cell.
  // Near the shore a coarse survey's cells straddle land and water (bathy.res, the source's own cell: ETOPO's and
  // GEBCO's 450 m average a beach's first half kilometre with the dunes behind it), which drags the water there
  // toward MSL and dries it out at low water. Within 1.5 source cells of the shore the bed is therefore at least
  // the coastal profile the survey's own trustworthy cells further out imply: from MHW at the waterline to their
  // depth along d ∝ s^p, Dean's equilibrium beach (p = 2/3) where the bottom shelves gently, steepening toward
  // p = 1/2 off a steep (rocky) shore. Real drying banks stay: a bank's own cells are shallow, and so is the
  // profile they imply. (A survey whose cells are under three of this grid's resolves its own shore, and its
  // shoals there are real: Marseille's Frioul, 7 m beside 25 m water.) Where the water is too narrow for any
  // trustworthy cell (a harbour narrower than the survey's cells) and the survey has land, the shelving
  // estimate stands in.
  // tide: the venue's Tide (js/tide.js), for the level and the chart datum; null in tideless water.
  setBathy(bathy, tide = null) {
    this.tide = tide;
    if (!bathy) { this.bed = null; return; }
    const n = bathy.nx, m = bathy.nz, dx = bathy.dx, bed = new Float32Array(n * m), N = n * m;
    const S = new Float32Array(N), HW = new Float32Array(N), raw = new Float32Array(N);
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const x = bathy.x0 + (i + 0.5) * dx, z = bathy.z0 + (j + 0.5) * dx, k = j * n + i;
      S[k] = this.sdfAt(x, z); HW[k] = tide ? Math.max(0.05, tide.mhwAt(x, z)) : 0.05;
      raw[k] = bathy.d[k] > -32000 ? bathy.d[k] * 0.1 : NaN;
    }
    // the trustworthy cells (B..3B from the shore): their depth above MHW's bed, distance and profile exponent,
    // averaged over the neighbourhood (a tent 2B wide: two box passes)
    const res = bathy.res ?? dx, B = res >= 3 * dx ? 1.5 * res : 0, T = new Float32Array(N), TA = new Float32Array(N), TS = new Float32Array(N), TP = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!B || S[k] < B || S[k] > 3 * B || !(raw[k] > -HW[k])) continue;          // (land there: the survey doesn't know this water)
      const A = raw[k] + HW[k], slope = A / S[k];
      T[k] = 1; TA[k] = A; TS[k] = S[k]; TP[k] = 2 / 3 - Math.max(0, Math.min(1, (slope - 0.02) / 0.06)) / 6;
    }
    if (B) for (const F of [T, TA, TS, TP]) for (let pass = 0; pass < 2; pass++) boxBlur(F, n, m, Math.round(B / dx));
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, s = S[k], hw = HW[k], d = raw[k];
      if (s <= 0) { bed[k] = -hw - 0.3; continue; }
      let b = d > -hw ? d : NaN;
      if (s < B && T[k] > 1e-3) {
        const pr = -hw + TA[k] / T[k] * Math.pow(Math.min(1, s / (TS[k] / T[k])), TP[k] / T[k]);
        b = b === b ? Math.max(b, pr) : pr;
      }
      if (!(b === b)) b = this.estDepth(bathy.x0 + (i + 0.5) * dx, bathy.z0 + (j + 0.5) * dx, s);
      bed[k] = Math.max(b, -hw + 0.1);
    }
    // dredged channels and basins (venue.dredged: the charted depth the port keeps, which no survey grid this
    // coarse resolves): at least that deep below chart datum
    if (this.venue.dredged) {
      const P = makeProjection(this.venue.lat, this.venue.lon);
      for (const c of this.venue.dredged) {
        const pts = c.pts.map(([la, lo]) => P.fwd(la, lo));
        for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
          const k = j * n + i; if (S[k] <= 0) continue;
          const x = bathy.x0 + (i + 0.5) * dx, z = bathy.z0 + (j + 0.5) * dx;
          let dd = Infinity;
          for (let q = 0; q + 1 < pts.length; q++) {
            const [ax, az] = pts[q], [bx, bz] = pts[q + 1], ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
            dd = Math.min(dd, Math.hypot(ax + ex * t - x, az + ez * t - z));
          }
          if (dd <= c.w / 2) bed[k] = Math.max(bed[k], c.depth + (tide ? tide.z0At(x, z) : 0));
        }
      }
    }
    this.bed = bed; this.bedG = { nx: n, nz: m, x0: bathy.x0, z0: bathy.z0, dx };
    this.bedWet = S.map(s => s > 0 ? 1 : 0); this.bedHw = HW; this.bedS = S;
    this.bathySource = bathy.source;
  }
  // bed depth below MSL (m; negative: a drying bank or land above MSL)
  bedAt(x, z, s = this.sdfAt(x, z)) {
    if (!this.bed) return s <= 0 ? s * 0.05 : this.estDepth(x, z, s);
    if (s <= 0 && s < -this.bedG.dx) return s * 0.05 - 0.3;
    const g = this.bedG, b = this.bed;
    let fx = (x - g.x0) / g.dx - 0.5, fz = (z - g.z0) / g.dx - 0.5;
    fx = Math.max(0, Math.min(g.nx - 1.001, fx)); fz = Math.max(0, Math.min(g.nz - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * g.nx + i;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
    if (s <= 0) return Math.min(b[k] * w00 + b[k + 1] * w10 + b[k + g.nx] * w01 + b[k + g.nx + 1] * w11, s * 0.05 - 0.3);
    // over water, from the wet cells only (a land cell's bed, above MHW, would make a false shoal a cell wide along
    // a quay or a dredged berth), and between the shore and those cells' own distance from it, rising evenly from
    // their depth to MHW at the waterline
    const W = this.bedWet, a = W[k] * w00, c = W[k + 1] * w10, e = W[k + g.nx] * w01, f = W[k + g.nx + 1] * w11, ws = a + c + e + f;
    if (ws < 1e-6) return b[k] * w00 + b[k + 1] * w10 + b[k + g.nx] * w01 + b[k + g.nx + 1] * w11;
    const d = (b[k] * a + b[k + 1] * c + b[k + g.nx] * e + b[k + g.nx + 1] * f) / ws, bs = this.bedS;
    const sw = (bs[k] * a + bs[k + 1] * c + bs[k + g.nx] * e + bs[k + g.nx + 1] * f) / ws, hw = this.bedHw[k];
    return s >= sw ? d : -hw + (d + hw) * s / sw;
  }
  // the tide's level above MSL here, now
  levelAt(x, z) { return this.tide ? this.tide.levelAt(x, z) : 0; }
  // Water depth now (m): the bed under the tide's level. Negative over land and over a bank dried out by the tide.
  depthAt(x, z) {
    const d = this.sdfAt(x, z);
    if (d <= 0) return d * 0.05;
    return (this.bed ? this.bedAt(x, z, d) : this.estDepth(x, z, d)) + (this.tide ? this.tide.levelAt(x, z) : 0);
  }
  // charted depth: below chart datum (LAT, or MLLW in US waters); negative = drying height
  chartDepthAt(x, z) { return this.bedAt(x, z) - (this.tide ? this.tide.z0At(x, z) : 0); }
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

  // Encode the SDF for the GPU: 0..255 over -128..+128 m; G: the bed below MSL (1/8 m, from 4 m above MSL: the
  // shader adds the tide's level); B: shelter
  sdfTextureData(size = 512) {
    const data = new Uint8Array(size * size * 4);
    const c = 2 * this.R / size;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -this.R + (i + 0.5) * c, z = -this.R + (j + 0.5) * c;
      const s = this.sdfAt(x, z), k = (j * size + i) * 4;
      data[k] = Math.max(0, Math.min(255, Math.round(128 + s)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round((this.bedAt(x, z) + 4) * 8)));
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
  // a stalled request must not leave the menu saying "Asking Open-Meteo…" forever
  const r = await fetch(u, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(10000) } : undefined);
  if (!r.ok) throw new Error('Open-Meteo ' + r.status);
  const j = await r.json();
  const c = j.current;
  if (!c || !Number.isFinite(c.wind_speed_10m) || !Number.isFinite(c.wind_direction_10m)) throw new Error('Open-Meteo: no current wind');
  const kt = c.wind_speed_10m;
  // gusts can be missing at some grid points; never report a gust below the mean
  const gustKt = Number.isFinite(c.wind_gusts_10m) ? Math.max(kt, c.wind_gusts_10m) : kt * 1.4;
  return { kt, dir: ((c.wind_direction_10m % 360) + 360) % 360, gustKt, time: c.time };
}

// ---------------------------------------------------------------------------------------------
// Land scenery from OpenStreetMap: building footprints, roads, land use / land cover, named places.
// Baked by tools/fetch-venues.mjs --land over the venue's whole area into a small manifest
// data/venues/<id>.land.json (chunk list, named places), a base file <id>.land.bin (land cover, street density)
// and one file per 4 km chunk under data/venues/<id>.land/ (footprints, streets) that js/scenery.js loads
// nearest first; custom locations fetch the same from Overpass live (fetchLandLive), chunk by chunk.
const HW_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
export const LAND_KINDS = ['', 'residential', 'commercial', 'industrial', 'retail', 'farmland', 'forest', 'grass', 'meadow', 'orchard',
  'wood', 'scrub', 'beach', 'sand', 'wetland', 'grassland', 'park', 'parking'];
// named places (their type sizes the procedural village where OSM has no footprints)
export const PLACE_KINDS = ['', 'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling'];
export const LAND_CHUNK = 4000;          // m: the file / streaming unit
const bbox = (lat, lon, x0, z0, x1, z1) => {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), kz = 110540;
  return `${(lat - z1 / kz).toFixed(5)},${(lon + x0 / kx).toFixed(5)},${(lat - z0 / kz).toFixed(5)},${(lon + x1 / kx).toFixed(5)}`;
};
// Overpass queries: land cover and places over the whole square of half-width R; buildings and streets per box
// (x0, z0, x1, z1 in local metres; ways crossing box edges come back from both sides and are merged by id)
export function landQueries(lat, lon, R) {
  const bb = bbox(lat, lon, -R, -R, R, R);
  const H = '[out:json][timeout:180];';
  return {
    areas: `${H}(way["landuse"~"^(residential|commercial|industrial|retail|farmland|forest|grass|meadow|orchard)$"](${bb});relation["landuse"~"^(residential|commercial|industrial|retail|farmland|forest|grass|meadow|orchard)$"](${bb});` +
      `way["natural"~"^(wood|scrub|beach|sand|wetland|grassland)$"](${bb});relation["natural"~"^(wood|scrub|beach|sand|wetland|grassland)$"](${bb});` +
      `way["leisure"="park"](${bb});relation["leisure"="park"](${bb});way["amenity"="parking"](${bb}););out tags geom;`,
    places: `${H}(node["place"~"^(${PLACE_KINDS.slice(1).join('|')})$"](${bb}););out;`,
  };
}
export function landBoxQuery(lat, lon, x0, z0, x1, z1) {
  const bb = bbox(lat, lon, x0, z0, x1, z1);
  return `[out:json][timeout:180];(way["building"](${bb});way["highway"~"^(${HW_CLASSES.join('|')})$"](${bb}););out tags geom;`;
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
const ringArea = (p) => { let a = 0; for (let k = 0, n = p.length / 2, m = n - 1; k < n; m = k++) a += p[2 * m] * p[2 * k + 1] - p[2 * k] * p[2 * m + 1]; return Math.abs(a) / 2; };
// osm: { buildings, roads, areas, places } Overpass JSON (any may be missing; buildings and roads may share one
// response); world: World built from the venue's water geometry. Returns plain lists in local metres:
// buildings [{ pts, h, lv, ty, rf }], roads [{ cls, pts }], areas [{ kind, pts }], places [{ t, x, z, name, pop }].
// opts.box [x0, z0, x1, z1] keeps buildings by centroid and streets by vertex inside it (default the world's square)
export function processLand(osm, lat0, lon0, world, opts = {}) {
  const P = makeProjection(lat0, lon0), R = world.R;
  const maxShore = opts.maxShore ?? 2500;
  const [bx0, bz0, bx1, bz1] = opts.box || [-R * 0.98, -R * 0.98, R * 0.98, R * 0.98];
  const toPts = (geom) => { const a = []; for (const g of geom) { if (!g) continue; const [x, z] = P.fwd(g.lat, g.lon); a.push(x, z); } return a; };
  const inBox = (x, z, m = 1) => Math.abs(x) < R * m && Math.abs(z) < R * m;
  const openRing = (p) => (p.length >= 4 && Math.abs(p[0] - p[p.length - 2]) < 0.01 && Math.abs(p[1] - p[p.length - 1]) < 0.01) ? p.slice(0, -2) : p;
  const els = (k) => osm[k]?.elements || [];
  const seen = new Set();
  // buildings: footprint rings on land within reach of the shore (simpler the farther inland: seen from the water
  // they are a few pixels)
  const buildings = [], roads = [];
  for (const el of [...els('buildings'), ...els('roads')]) {
    if (el.type !== 'way' || !el.geometry || seen.has(el.id)) continue;
    seen.add(el.id);
    const t = el.tags || {};
    if (t.building && t.building !== 'no') {
      const raw = toPts(el.geometry);
      let cx = 0, cz = 0; for (let i = 0; i < raw.length; i += 2) { cx += raw[i]; cz += raw[i + 1]; } cx /= raw.length / 2; cz /= raw.length / 2;
      if (cx < bx0 || cx >= bx1 || cz < bz0 || cz >= bz1 || !inBox(cx, cz, 0.99)) continue;
      const s = world.sdfAt(cx, cz);
      if (s > -2 || s < -maxShore) continue;
      const pts = openRing(simplify(raw, (opts.tolB ?? 1.2) * (s < -1000 ? 2 : 1)));
      if (pts.length < 6 || ringArea(pts) < 6) continue;
      const h = parseFloat(t.height), lv = parseInt(t['building:levels']);
      buildings.push({ pts, d: -s, h: isFinite(h) ? Math.min(400, h) : 0, lv: isFinite(lv) ? Math.min(99, Math.max(0, lv)) : 0, ty: BTYPE(t), rf: ROOF(t['roof:shape']) });
    } else if (t.highway) {
      const cls = HW_CLASSES.indexOf(t.highway); if (cls < 0) continue;
      // streets: polylines clipped to the box and to the shore band
      const all = toPts(el.geometry);
      let cur = [];
      const flush = () => { if (cur.length >= 4) roads.push({ cls, pts: simplify(cur, opts.tolR ?? 3) }); cur = []; };
      // (driveways and car-park aisles only near the water, where they are seen; the streets as far as the houses)
      const reach = cls === 8 ? Math.min(600, maxShore) : maxShore + 300;
      for (let i = 0; i < all.length; i += 2) {
        const x = all[i], z = all[i + 1];
        if (x >= bx0 - 40 && x < bx1 + 40 && z >= bz0 - 40 && z < bz1 + 40 && inBox(x, z, 0.99) && world.sdfAt(x, z) > -reach) cur.push(x, z); else flush();
      }
      flush();
    }
  }
  // land use / cover: outer rings (tiny patches do not show on the 8-16 m cover raster)
  const areas = [];
  const addArea = (ring, kind) => {
    ring = openRing(simplify(ring, opts.tolA ?? 8));
    if (ring.length < 6 || ringArea(ring) < (opts.minArea ?? 0)) return;
    let near = false; for (let i = 0; i < ring.length; i += 2) if (inBox(ring[i], ring[i + 1], 1.02)) { near = true; break; }
    if (near) areas.push({ kind, pts: ring });
  };
  for (const el of els('areas')) {
    const kind = areaKind(el.tags || {}); if (!kind) continue;
    if (el.type === 'way' && el.geometry) addArea(toPts(el.geometry), kind);
    else if (el.type === 'relation' && el.members) {
      const outer = el.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => toPts(m.geometry));
      for (const r of joinRings(outer)) addArea(r, kind);
    }
  }
  const places = [];
  for (const el of els('places')) {
    if (el.type !== 'node' || !el.tags) continue;
    const t = PLACE_KINDS.indexOf(el.tags.place); if (t < 1) continue;
    const [x, z] = P.fwd(el.lat, el.lon);
    if (!inBox(x, z)) continue;
    const pop = parseInt(String(el.tags.population || '').replace(/[, ]/g, ''));
    places.push({ t, x: Math.round(x), z: Math.round(z), name: el.tags.name || '', pop: isFinite(pop) ? pop : 0 });
  }
  return { buildings, roads, areas, places, counts: { buildings: buildings.length, roads: roads.length, areas: areas.length, places: places.length } };
}
// street metres per 250 m cell (a street grid every ~100 m gives ~1250 m): town-ness for the ground colour and
// the procedural houses; quantised to 10 m in a byte
export const TOWN_CELL = 250;
export function townDensity(roads, R) {
  const dc = TOWN_CELL, DN = Math.ceil(2 * R / dc), dens = new Float32Array(DN * DN);
  for (const r of roads) {
    if (r.cls < 3 || r.cls > 7) continue;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) { const L = Math.hypot(p[k + 2] - p[k], p[k + 3] - p[k + 1]); const i = Math.floor(((p[k] + p[k + 2]) / 2 + R) / dc), j = Math.floor(((p[k + 1] + p[k + 3]) / 2 + R) / dc); if (i >= 0 && j >= 0 && i < DN && j < DN) dens[j * DN + i] += L; }
  }
  const q = new Uint8Array(DN * DN); for (let k = 0; k < q.length; k++) q[k] = Math.min(255, Math.round(dens[k] / 10));
  return { DN, dc, q };
}
// split streets into per-chunk pieces (each piece keeps the vertex where it leaves its chunk, so they join up)
export function chunkOf(x, z, R, C = LAND_CHUNK) { return [Math.floor((x + R) / C), Math.floor((z + R) / C)]; }
export function splitByChunk(roads, R, C = LAND_CHUNK) {
  const out = new Map(), put = (k, r) => { let a = out.get(k); if (!a) out.set(k, a = []); a.push(r); };
  for (const r of roads) {
    const p = r.pts; let cur = [p[0], p[1]], key = chunkOf(p[0], p[1], R, C).join(',');
    for (let k = 2; k < p.length; k += 2) {
      const mk = chunkOf((p[k] + p[k - 2]) / 2, (p[k + 1] + p[k - 1]) / 2, R, C).join(',');
      if (mk !== key) { if (cur.length >= 4) put(key, { cls: r.cls, pts: cur }); cur = [p[k - 2], p[k - 1]]; key = mk; }
      cur.push(p[k], p[k + 1]);
    }
    if (cur.length >= 4) put(key, { cls: r.cls, pts: cur });
  }
  return out;
}

// ---- TWL2: 'TWL2', uint32 header length, JSON header, then zigzag LEB128 varints: coordinates in 0.5 m units,
// each point a delta from the previous one (the first point of a ring from the previous ring's first point).
// A building: flags (bit 0 a rectangle, 1 a height follows, 2 levels follow, 3-5 type, 6-8 roof shape), then a
// rectangle as its first corner, one side and the signed width across it (most houses: 7-8 bytes), any other
// footprint as its vertex count and ring
class VarW {
  constructor() { this.b = new Uint8Array(1 << 16); this.n = 0; this.px = 0; this.pz = 0; }
  byte(v) { if (this.n >= this.b.length) { const nb = new Uint8Array(this.b.length * 2); nb.set(this.b); this.b = nb; } this.b[this.n++] = v; }
  u(v) { v = Math.max(0, Math.round(v)); while (v >= 128) { this.byte((v % 128) | 128); v = Math.floor(v / 128); } this.byte(v); }
  s(v) { v = Math.round(v); this.u(v < 0 ? -2 * v - 1 : 2 * v); }
  pts(p) {
    let fx = 0, fz = 0;
    for (let k = 0; k < p.length; k += 2) {
      const x = Math.round(p[k] * 2), z = Math.round(p[k + 1] * 2);
      if (k === 0) { this.s(x - this.px); this.s(z - this.pz); this.px = fx = x; this.pz = fz = z; }
      else { this.s(x - fx); this.s(z - fz); fx = x; fz = z; }
    }
  }
}
class VarR {
  constructor(u8, i) { this.b = u8; this.i = i; this.px = 0; this.pz = 0; }
  u() { let v = 0, m = 1, c; do { c = this.b[this.i++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; }
  s() { const v = this.u(); return v % 2 ? -(v + 1) / 2 : v / 2; }
  pts(n) {
    const p = new Float32Array(n * 2); let x = 0, z = 0;
    for (let k = 0; k < n; k++) {
      if (k === 0) { x = this.px += this.s(); z = this.pz += this.s(); } else { x += this.s(); z += this.s(); }
      p[2 * k] = x * 0.5; p[2 * k + 1] = z * 0.5;
    }
    return p;
  }
}
// d: { buildings?, roads?, areas?, town? } -> Uint8Array
export function encodeLandBin(header, d) {
  const w = new VarW(), B = d.buildings || [], Rd = d.roads || [], A = d.areas || [];
  w.u(B.length);
  for (const b of B) {
    const p = b.pts, q = (v) => Math.round(v * 2), h = Math.round(b.h * 2);
    let rect = null;
    if (p.length === 8) {
      // (a rectangle to within 0.6 m: rebuilt from the quantised corner, side and width)
      const x0 = q(p[0]) / 2, z0 = q(p[1]) / 2, ex = q(p[2] - p[0]) / 2, ez = q(p[3] - p[1]) / 2, L = Math.hypot(ex, ez);
      if (L > 0.5) {
        const nx = -ez / L, nz = ex / L, wd = q((p[6] - p[0]) * nx + (p[7] - p[1]) * nz) / 2;
        if (Math.hypot(x0 + ex + nx * wd - p[4], z0 + ez + nz * wd - p[5]) < 0.6 && Math.hypot(x0 + nx * wd - p[6], z0 + nz * wd - p[7]) < 0.6 && Math.abs(wd) >= 0.5) rect = [ex, ez, wd];
      }
    }
    w.u((rect ? 1 : 0) | (h > 0 ? 2 : 0) | (b.lv > 0 ? 4 : 0) | (b.ty << 3) | (b.rf << 6));
    if (h > 0) w.u(h);
    if (b.lv > 0) w.u(b.lv);
    if (rect) { w.pts([p[0], p[1]]); w.s(rect[0] * 2); w.s(rect[1] * 2); w.s(rect[2] * 2); }
    else { w.u(p.length / 2); w.pts(p); }
  }
  w.u(Rd.length);
  for (const r of Rd) { w.u(r.pts.length / 2); w.u(r.cls); w.pts(r.pts); }
  w.u(A.length);
  for (const a of A) { w.u(a.pts.length / 2); w.u(a.kind); w.pts(a.pts); }
  const T = d.town;
  w.u(T ? T.DN : 0); if (T) for (let k = 0; k < T.q.length; k++) w.byte(T.q[k]);
  const hj = new TextEncoder().encode(JSON.stringify(header)), out = new Uint8Array(8 + hj.length + w.n);
  out.set([84, 87, 76, 50]); new DataView(out.buffer).setUint32(4, hj.length, true);
  out.set(hj, 8); out.set(w.b.subarray(0, w.n), 8 + hj.length);
  return out;
}
export function decodeLandBin(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== 84 || u8[1] !== 87 || u8[2] !== 76 || u8[3] !== 50) throw new Error('not a TWL2 land file');
  const L = dv.getUint32(4, true), header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + L)));
  const r = new VarR(u8, 8 + L), buildings = [], roads = [], areas = [];
  for (let k = 0, n = r.u(); k < n; k++) {
    const f = r.u(), h = f & 2 ? r.u() / 2 : 0, lv = f & 4 ? r.u() : 0;
    let pts;
    if (f & 1) {
      const c = r.pts(1), ex = r.s() / 2, ez = r.s() / 2, wd = r.s() / 2, L = Math.hypot(ex, ez) || 1, nx = -ez / L * wd, nz = ex / L * wd;
      pts = new Float32Array([c[0], c[1], c[0] + ex, c[1] + ez, c[0] + ex + nx, c[1] + ez + nz, c[0] + nx, c[1] + nz]);
    } else pts = r.pts(r.u());
    buildings.push({ h, lv, ty: (f >> 3) & 7, rf: f >> 6, pts });
  }
  for (let k = 0, n = r.u(); k < n; k++) { const m = r.u(), cls = r.u(); roads.push({ cls, pts: r.pts(m) }); }
  for (let k = 0, n = r.u(); k < n; k++) { const m = r.u(), kind = r.u(); areas.push({ kind, pts: r.pts(m) }); }
  const DN = r.u(), town = DN ? { DN, dc: TOWN_CELL, q: u8.slice(r.i, r.i + DN * DN) } : null;
  return { header, buildings, roads, areas, town };
}

// Live land data for a custom location, the same shape as the baked files: land cover and places first (the
// terrain needs them), then buildings and streets chunk by chunk, nearest the centre first.
// Returns { areas, places, town: null, chunks: [{ key, box, load() -> { buildings, roads } }] }.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
async function overpassLive(q) {
  let lastErr;
  for (const u of OVERPASS) {
    try {
      // (a stalled server must not hold the terrain up: the next mirror, then nothing)
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined;
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
export async function fetchLandLive(world) {
  const v = world.venue, R = world.R, C = LAND_CHUNK, Q = landQueries(v.lat, v.lon, R);
  const [areas, places] = await Promise.all([overpassLive(Q.areas).catch(() => null), overpassLive(Q.places).catch(() => null)]);
  const base = processLand({ areas, places }, v.lat, v.lon, world);
  const nc = Math.ceil(2 * R / C), chunks = [];
  for (let j = 0; j < nc; j++) for (let i = 0; i < nc; i++) {
    const box = [-R + i * C, -R + j * C, Math.min(R, -R + (i + 1) * C), Math.min(R, -R + (j + 1) * C)];
    // (no land within reach of this chunk: nothing to ask for)
    let land = false;
    for (let b = 0; b <= 8 && !land; b++) for (let a = 0; a <= 8; a++) if (world.sdfAt(box[0] + (box[2] - box[0]) * a / 8, box[1] + (box[3] - box[1]) * b / 8) < 300) { land = true; break; }
    if (!land) continue;
    chunks.push({ key: i + ',' + j, box, load: async () => {
      const osm = await overpassLive(landBoxQuery(v.lat, v.lon, ...box));
      const out = processLand({ buildings: osm }, v.lat, v.lon, world, { box });
      return { buildings: out.buildings, roads: out.roads };
    } });
  }
  return { areas: base.areas, places: base.places, town: null, chunks };
}
