// Harbour traffic: yachts on marina berths and swing moorings, ships at anchor, and boats under way — ferries
// on their real OpenStreetMap routes, fishing boats, motor boats and cruising yachts. Everything here is
// kinematic (no physics): a vessel under way runs along a planned "rail" over the water (A* on the world's
// signed-distance grid, string-pulled and rounded), sets its speed by its type, the bends ahead and the traffic
// around it (power gives way to sail, crossing from starboard stands on, the give-way vessel slows and steps
// to starboard), and the sea moves it (heave, pitch and roll from the wave field). Moored boats lie to the wind
// and the tide on their scope. Map data: tools/fetch-venues.mjs --traffic bakes data/venues/<id>.traffic.json
// (or fetchTrafficGeo for a custom location). Drawn by js/traffic-render.js. No three.js here (node tests).
import { makeProjection, MAP_RADIUS } from './world.js';
import { mulberry32, KT, DEG } from './env.js';
import { fleetIdentities, VENUE_NATION } from './boatid.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
const hyp = Math.hypot;

// L length, B beam (m), H masthead / top light height, kn cruise speed range, power (false = under sail)
export const VESSELS = {
  yacht:    { L: 10.5, B: 3.4, H: 14, kn: [5, 7], power: false, name: 'yacht' },
  motor:    { L: 12, B: 3.9, H: 5.2, kn: [12, 20], power: true, name: 'motor cruiser' },
  rib:      { L: 6.5, B: 2.5, H: 2.2, kn: [16, 26], power: true, name: 'motor boat' },
  fishing:  { L: 16, B: 5.2, H: 8, kn: [7, 9], power: true, name: 'fishing boat' },
  ferry:    { L: 38, B: 10, H: 13, kn: [12, 16], power: true, name: 'ferry' },
  fastcat:  { L: 40, B: 11, H: 12, kn: [24, 32], power: true, name: 'fast ferry' },
  carferry: { L: 82, B: 17, H: 24, kn: [11, 14], power: true, name: 'car ferry' },
  chain:    { L: 34, B: 14, H: 9, kn: [2.5, 3], power: true, name: 'chain ferry' },
  ship:     { L: 130, B: 21, H: 32, kn: [9, 12], power: true, name: 'ship' },
};
export const DENSITY = { off: 0, light: 0.35, normal: 0.7, busy: 1 };

// ------------------------------------------------------------------ OpenStreetMap: query and bake
export function trafficQuery(lat, lon, R = MAP_RADIUS + 600) {
  const dLat = R / 110540, dLon = R / (111320 * Math.cos(lat * Math.PI / 180));
  const bb = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  return `[out:json][timeout:120];(nwr["leisure"="marina"](${bb});nwr["seamark:type"~"^(harbour|mooring|anchorage|anchor_berth|pontoon)$"](${bb});` +
    `way["man_made"~"^(pier|pontoon)$"](${bb});way["route"="ferry"](${bb});relation["route"="ferry"](${bb});node["amenity"="ferry_terminal"](${bb}););out tags geom;`;
}

// Overpass JSON -> compact local geometry (0.5 m): marinas (rings / points), pontoons and jetties (lines),
// moorings (points, areas), anchorages (rings / points, with category), harbours, ferry routes, terminals
export function processTraffic(osm, lat0, lon0, R = MAP_RADIUS + 600) {
  const P = makeProjection(lat0, lon0), lim = R * 1.05;
  const q = (v) => Math.round(v * 2) / 2;
  const toPts = (geom) => { const a = []; for (const g of geom) { if (!g) continue; const [x, z] = P.fwd(g.lat, g.lon); a.push(q(x), q(z)); } return a; };
  const near = (p) => { for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i]) < lim && Math.abs(p[i + 1]) < lim) return true; return false; };
  const closed = (p) => p.length >= 8 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
  const centroid = (p) => { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [q(x / n), q(z / n)]; };
  const out = { marinas: [], pontoons: [], jetties: [], moorings: [], mooringAreas: [], anchorages: [], harbours: [], ferries: [], terminals: [] };
  const seenFerry = new Set();
  const addFerry = (id, t, pts) => { if (seenFerry.has(id) || pts.length < 4 || !near(pts)) return; seenFerry.add(id); out.ferries.push({ n: t.name || '', op: t.operator || '', pts }); };
  // ring(s) of a way or a relation's outer members, joined end to end
  const rings = (el) => {
    if (el.type === 'way') return el.geometry ? [toPts(el.geometry)] : [];
    const parts = (el.members || []).filter(m => m.type === 'way' && m.geometry && m.role !== 'inner').map(m => toPts(m.geometry));
    const res = [];
    while (parts.length) {
      let r = parts.shift(), guard = 0;
      while (!closed(r) && guard++ < 500) {
        const ex = r[r.length - 2], ez = r[r.length - 1];
        const k = parts.findIndex(p => (p[0] === ex && p[1] === ez) || (p[p.length - 2] === ex && p[p.length - 1] === ez));
        if (k < 0) break;
        let p = parts.splice(k, 1)[0];
        if (p[0] !== ex || p[1] !== ez) { const rr = []; for (let i = p.length - 2; i >= 0; i -= 2) rr.push(p[i], p[i + 1]); p = rr; }
        r = r.concat(p.slice(2));
      }
      res.push(r);
    }
    return res;
  };
  for (const el of osm.elements || []) {
    const t = el.tags || {}, sm = t['seamark:type'];
    const pt = el.type === 'node' ? (() => { const [x, z] = P.fwd(el.lat, el.lon); return [q(x), q(z)]; })() : null;
    if (pt && (Math.abs(pt[0]) > lim || Math.abs(pt[1]) > lim)) continue;
    if (t.route === 'ferry') {
      if (el.type === 'way' && el.geometry) addFerry(el.id, t, toPts(el.geometry));
      else if (el.type === 'relation') for (const m of el.members || []) if (m.type === 'way' && m.geometry) addFerry(m.ref, t, toPts(m.geometry));
    } else if (t.amenity === 'ferry_terminal') { if (pt) out.terminals.push(pt); }
    else if (t.leisure === 'marina') {
      if (pt) out.marinas.push({ n: t.name || '', c: pt });
      else for (const r of rings(el)) if (closed(r) && near(r)) out.marinas.push({ n: t.name || '', c: centroid(r), ring: r });
    } else if (sm === 'mooring' || sm === 'anchorage' || sm === 'anchor_berth' || sm === 'harbour') {
      const cat = t[`seamark:${sm}:category`] || '';
      if (sm === 'harbour') { if (pt) out.harbours.push({ c: pt, cat }); else for (const r of rings(el)) if (near(r)) out.harbours.push({ c: centroid(r), cat }); continue; }
      if (sm === 'mooring') {
        if (pt) out.moorings.push(pt);
        else for (const r of rings(el)) if (near(r)) { if (closed(r)) out.mooringAreas.push(r); else for (let i = 0; i < r.length; i += 2) out.moorings.push([r[i], r[i + 1]]); }
        continue;
      }
      if (pt) out.anchorages.push({ c: pt, cat, small: sm === 'anchor_berth' || /small|yacht|pleasure/.test(cat) });
      else for (const r of rings(el)) if (closed(r) && near(r)) out.anchorages.push({ c: centroid(r), ring: r, cat, small: /small|yacht|pleasure/.test(cat) });
    } else if (el.type === 'way' && el.geometry && (t.man_made === 'pier' || t.man_made === 'pontoon' || sm === 'pontoon')) {
      const p = toPts(el.geometry);
      if (!near(p) || closed(p)) continue;                       // (a closed pier way is a platform, not a pontoon)
      (t.floating === 'yes' || t.man_made === 'pontoon' || sm === 'pontoon' ? out.pontoons : out.jetties).push(p);
    }
  }
  return out;
}

// Live fetch for a custom location (the baked venues have data/venues/<id>.traffic.json)
export async function fetchTrafficGeo(lat, lon) {
  const q = trafficQuery(lat, lon);
  const urls = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return processTraffic(await r.json(), lat, lon);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ------------------------------------------------------------------ navigation grid
// A* over the world's signed-distance grid at half its resolution. A cell is open where the water is at least
// `need` metres from the shore and no moored boat lies; paths prefer water well clear of the shore.
class Heap {
  constructor() { this.k = new Int32Array(1024); this.p = new Float32Array(1024); this.n = 0; }
  push(k, p) {
    if (this.n === this.k.length) { const k2 = new Int32Array(this.n * 2), p2 = new Float32Array(this.n * 2); k2.set(this.k); p2.set(this.p); this.k = k2; this.p = p2; }
    let i = this.n++;
    while (i > 0) { const j = (i - 1) >> 1; if (this.p[j] <= p) break; this.k[i] = this.k[j]; this.p[i] = this.p[j]; i = j; }
    this.k[i] = k; this.p[i] = p;
  }
  pop() {
    const top = this.k[0], k = this.k[--this.n], p = this.p[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1; if (c >= this.n) break;
      if (c + 1 < this.n && this.p[c + 1] < this.p[c]) c++;
      if (this.p[c] >= p) break;
      this.k[i] = this.k[c]; this.p[i] = this.p[c]; i = c;
    }
    this.k[i] = k; this.p[i] = p;
    return top;
  }
}
export class NavGrid {
  constructor(world, stride = 2) {
    this.world = world; this.R = world.R;
    this.M = Math.max(16, Math.floor(world.N / stride)); this.c = 2 * world.R / this.M;
    const M = this.M;
    this.clr = new Float32Array(M * M); this.block = new Uint8Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) this.clr[j * M + i] = world.open ? 1e4 : world.sdfAt(-this.R + (i + 0.5) * this.c, -this.R + (j + 0.5) * this.c);
    this.g = new Float32Array(M * M); this.from = new Int32Array(M * M); this.seen = new Uint32Array(M * M); this.gen = 0;
  }
  cell(x, z) { const M = this.M; return clamp(Math.floor((z + this.R) / this.c), 0, M - 1) * M + clamp(Math.floor((x + this.R) / this.c), 0, M - 1); }
  center(k) { return [-this.R + (k % this.M + 0.5) * this.c, -this.R + (((k / this.M) | 0) + 0.5) * this.c]; }
  open(k, need) { return this.clr[k] >= need && !this.block[k]; }
  blockDisc(x, z, r) {
    const M = this.M, n = Math.ceil(r / this.c) + 1, k0 = this.cell(x, z), i0 = k0 % M, j0 = (k0 / M) | 0;
    for (let j = Math.max(0, j0 - n); j <= Math.min(M - 1, j0 + n); j++) for (let i = Math.max(0, i0 - n); i <= Math.min(M - 1, i0 + n); i++) {
      const [cx, cz] = this.center(j * M + i); if (hyp(cx - x, cz - z) < r + this.c * 0.5) this.block[j * M + i] = 1;
    }
  }
  blockedAt(x, z) { return this.block[this.cell(x, z)] === 1; }
  // connected bodies of open water (for `need`): a destination is only picked where the start can reach it
  label(need) {
    const M = this.M, comp = new Int32Array(M * M).fill(-1), q = new Int32Array(M * M), size = [];
    for (let k0 = 0; k0 < M * M; k0++) {
      if (comp[k0] >= 0 || !this.open(k0, need)) continue;
      const id = size.length; let qh = 0, qt = 0; q[qt++] = k0; comp[k0] = id;
      while (qh < qt) {
        const k = q[qh++], i = k % M;
        for (const nk of [i > 0 ? k - 1 : -1, i < M - 1 ? k + 1 : -1, k - M, k + M]) if (nk >= 0 && nk < M * M && comp[nk] < 0 && this.open(nk, need)) { comp[nk] = id; q[qt++] = nk; }
      }
      size.push(qt);
    }
    return { comp, big: size.indexOf(Math.max(0, ...size)) };
  }
  // (labelled once per clearance a vessel type needs)
  comps(need) { const c = this._comps || (this._comps = new Map()); if (!c.has(need)) c.set(need, this.label(need)); return c.get(need); }
  // nearest open cell (breadth-first over rings), or -1
  snap(k, need, maxR = 40) {
    if (this.open(k, need)) return k;
    const M = this.M, i0 = k % M, j0 = (k / M) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || i < 0 || j < 0 || i >= M || j >= M) continue;
        const kk = j * M + i; if (!this.open(kk, need)) continue;
        const d = (i - i0) ** 2 + (j - j0) ** 2; if (d < bd) { bd = d; best = kk; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // is the straight run a->b on water at least `need` from shore (and clear of moored boats)?
  clearSeg(ax, az, bx, bz, need) {
    const L = hyp(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 4));
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n;
      if (Math.abs(x) > this.R - 5 || Math.abs(z) > this.R - 5) return false;
      if (!this.world.open && this.world.sdfAt(x, z) < need) return false;
      if (this.block[this.cell(x, z)]) return false;
    }
    return true;
  }
  // water path from a to b: [x, z, x, z, ...] or null
  plan(ax, az, bx, bz, need = 10, maxExp = 120000) {
    const M = this.M, clr = this.clr;
    const s = this.snap(this.cell(ax, az), need), g = this.snap(this.cell(bx, bz), need);
    if (s < 0 || g < 0) return null;
    const gen = ++this.gen, G = this.g, F = this.from, S = this.seen;
    const gi = g % M, gj = (g / M) | 0;
    const h = (k) => { const di = Math.abs(k % M - gi), dj = Math.abs(((k / M) | 0) - gj); return (Math.max(di, dj) + 0.4142 * Math.min(di, dj)) * 1.25; };
    const heap = new Heap();
    G[s] = 0; F[s] = -1; S[s] = gen; heap.push(s, h(s));
    let exp = 0, found = s === g;
    const D = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1, 1, 1, 1.4142, 1, -1, 1.4142, -1, 1, 1.4142, -1, -1, 1.4142];
    while (heap.n && !found && exp++ < maxExp) {
      const k = heap.pop(), i = k % M, j = (k / M) | 0, gk = G[k];
      for (let d = 0; d < 24; d += 3) {
        const ni = i + D[d], nj = j + D[d + 1]; if (ni < 0 || nj < 0 || ni >= M || nj >= M) continue;
        const nk = nj * M + ni; if (!this.open(nk, need)) continue;
        // a step costs its length, more close to the shore (paths keep to the middle of a channel)
        const w = D[d + 2] * (1 + 1.5 * Math.max(0, 1 - clr[nk] / (need + 60))), ng = gk + w;
        if (S[nk] === gen && ng >= G[nk]) continue;
        S[nk] = gen; G[nk] = ng; F[nk] = k; heap.push(nk, ng + h(nk));
        if (nk === g) { found = true; break; }
      }
    }
    if (!found) return null;
    const cells = []; for (let k = g; k >= 0; k = F[k]) cells.push(k);
    cells.reverse();
    const pts = [ax, az]; for (const k of cells) pts.push(...this.center(k)); pts.push(bx, bz);
    return this.smooth(this.pull(pts, need), need);
  }
  // string pulling: drop every point the straight run can skip. The ends may sit in tighter water than
  // `need` (a pier head, a mooring): runs from and to them may use it
  pull(pts, need) {
    const n = pts.length / 2, out = [pts[0], pts[1]];
    const endNeed = (i) => Math.min(need, Math.max(2, (this.world.open ? 1e4 : this.world.sdfAt(pts[2 * i], pts[2 * i + 1])) * 0.8));
    const nA = endNeed(0), nB = endNeed(n - 1);
    let i = 0;
    while (i < n - 1) {
      let j = Math.min(n - 1, i + 80);
      for (; j > i + 1; j--) {
        const nd = Math.min(i === 0 ? nA : need, j === n - 1 ? nB : need, i < 3 ? nA : need, j > n - 4 ? nB : need);
        if (this.clearSeg(pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1], nd)) break;
      }
      out.push(pts[2 * j], pts[2 * j + 1]); i = j;
    }
    return out;
  }
  // round the corners (Chaikin, twice) where the rounded runs are still clear
  smooth(pts, need) {
    let p = pts;
    for (let it = 0; it < 2; it++) {
      if (p.length < 6) break;
      const q = [p[0], p[1]];
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        if (i > 0) q.push(0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz);
        if (i + 4 < p.length) q.push(0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz);
      }
      q.push(p[p.length - 2], p[p.length - 1]);
      let ok = true;
      for (let i = 2; i + 5 < q.length && ok; i += 2) ok = this.clearSeg(q[i], q[i + 1], q[i + 2], q[i + 3], Math.min(need, 3));
      if (!ok) break;
      p = q;
    }
    return p;
  }
}

// ------------------------------------------------------------------ a rail: a polyline followed by arc length
class Rail {
  constructor(pts) {
    const n = pts.length / 2;
    this.p = Float64Array.from(pts); this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + hyp(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    this.L = this.cum[n - 1]; this.n = n;
  }
  at(s, o) {
    s = clamp(s, 0, this.L);
    let lo = 0, hi = this.n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.cum[m] <= s) lo = m; else hi = m - 1; }
    const i = lo;
    const L = this.cum[i + 1] - this.cum[i] || 1e-9, f = (s - this.cum[i]) / L, p = this.p;
    o.x = p[2 * i] + (p[2 * i + 2] - p[2 * i]) * f; o.z = p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * f;
    o.dx = (p[2 * i + 2] - p[2 * i]) / L; o.dz = (p[2 * i + 3] - p[2 * i + 1]) / L;
    return o;
  }
  // heading of the chord from s - h to s + h (a hull of length 2h lies along it)
  heading(s, h) { const a = this.at(s - h, this._a || (this._a = {})), ax = a.x, az = a.z, b = this.at(s + h, a); return Math.atan2(b.x - ax, -(b.z - az)); }
  reversed() { const q = []; for (let i = this.n - 1; i >= 0; i--) q.push(this.p[2 * i], this.p[2 * i + 1]); return new Rail(q); }
}

// ------------------------------------------------------------------ a cruising yacht's speed and heel
// A 10 m cruiser's polar in the spirit of ORC certificates: no speed inside 30 deg of the wind, full speed on
// a beam reach, capped at hull speed; heel grows with the wind and the closeness to it
export function yachtSpeed(twa, tws) {
  const a = Math.abs(twa) / DEG;
  const f = a < 30 ? 0 : a < 45 ? (a - 30) / 15 * 0.78 : a < 100 ? 0.78 + 0.22 * (a - 45) / 55 : 1 - 0.18 * (a - 100) / 80;
  return Math.min(3.9, 0.75 * Math.pow(Math.max(0, tws), 0.85)) * f;
}
export function yachtHeel(twa, tws) {
  const a = Math.abs(twa);
  return Math.min(24 * DEG, 0.35 * Math.pow(tws / KT, 1.4) * DEG * Math.max(0, Math.cos(a * 0.62)) ** 1.5);
}

// ------------------------------------------------------------------ the traffic
const HULLS = [0xf4f2ec, 0xf1efe8, 0xe9ecef, 0xffffff, 0x1d3557, 0xdfe6ea, 0x8b1e2d, 0x2e5e4e, 0xf4f1ea, 0x243447, 0xe8d8b0, 0xf6f6f2];
// the ships that work each route (matched on the route's name and operator): [pattern, car ferries or big boats,
// fast craft]. Where a route's fleet is not known the ferry goes by its route's name
const FERRY_FLEETS = [
  [/red funnel/i, ['Red Falcon', 'Red Osprey', 'Red Eagle'], ['Red Jet 6', 'Red Jet 7']],
  [/wightlink/i, ['Victoria of Wight', 'Wight Light', 'Wight Sky', 'Wight Sun', 'St Clare', 'St Faith'], ['Wight Ryder I', 'Wight Ryder II']],
  [/hovertravel|hover/i, [], ['Island Flyer', 'Solent Flyer']],
  [/floating bridge|chain/i, ['Floating Bridge No. 6'], []],
  [/manly/i, ['Freshwater', 'Queenscliff', 'Narrabeen', 'Collaroy', 'Fred Hollows', 'Victor Chang', 'Pemulwuy', 'Bungaree', 'Balarinji', 'Catherine Hamlin'], ['Manly Flyer', 'Manly Cove']],
  [/parramatta|rivercat|meadowbank|rydalmere|sydney olympic/i, ['Betty Cuthbert', 'Dawn Fraser', 'Evonne Goolagong', 'Marlene Mathews', 'Marjorie Jackson', 'Shane Gould', 'Lauren Jackson'], []],
  [/sydney ferries|transdev|circular quay/i, ['Sirius', 'Supply', 'Alexander', 'Borrowdale', 'Charlotte', 'Fishburn', 'Friendship', 'Golden Grove', 'Scarborough', 'May Gibbs', 'Olive Cotton', 'Kurt Fearnley', 'Ethel Turner', 'Ruby Langford Ginibi'], []],
  [/golden gate/i, ['Del Norte', 'Mendocino', 'Napa', 'Sonoma', 'San Francisco', 'Golden Gate', 'Marin', 'Del Norte'], []],
  [/water emergency|weta|sf bay ferry|san francisco bay ferry/i, ['Hydrus', 'Cetus', 'Carina', 'Argo', 'Pisces', 'Scorpio', 'Gemini', 'Taurus', 'Intintoli', 'Mare Island', 'Bay Breeze', 'Peralta'], []],
  [/alcatraz/i, ['Alcatraz Flyer', 'Alcatraz Clipper', 'Alcatraz Voyager'], []],
  [/fullers|waiheke|devonport|birkenhead|half moon|pine harbour|hobsonville|bayswater|rotoroa/i, ['Kea', 'Te Kotuku', 'Kawau Kat', 'Superflyte', 'Harbour Cat'], ['Quickcat', 'Jet Raider', 'Te Waka']],
  [/navigazione|garda|limone|malcesine|riva/i, ['Brescia', 'Verona', 'Italia', 'Zanardelli', 'Andrea Doria', 'Tonale'], ['Freccia delle Riviere', 'Freccia del Garda']],
];
const SHIP_NAMES = ['Nordic Star', 'Atlantic Trader', 'Pacific Venture', 'Baltic Carrier', 'Ocean Harmony', 'Cape Mercy', 'Northern Dawn', 'Southern Cross', 'Iron Duke', 'Silver Pearl', 'Coral Sea', 'Eastern Promise'];
const FISHING_NAMES = ['Girl Pat', 'Our Boys', 'Provider', 'Good Intent', 'Boy Andrew', 'Harvest Reaper', 'Ocean Pride', 'Silver Dawn', 'Guiding Star', 'Fruitful Bough', 'Brothers', 'Sea Harvester', 'Morning Glory', 'Two Sisters'];
const FERRY_NAMES = { Wightlink: 0x1b3f8b, 'Red Funnel': 0xe03a2f, 'Sydney Ferries': 0x2f6e3a, 'Fullers': 0x0e3b66 };
export class Traffic {
  // world: World; data: processTraffic() output (or null); opts: { density, seed, keepOut: [{x, z, r}], env }
  constructor(world, data, opts = {}) {
    this.world = world; this.data = data || {};
    this.k = typeof opts.density === 'number' ? opts.density : DENSITY[opts.density ?? 'normal'] ?? 0.7;
    this.rnd = mulberry32((opts.seed ?? 1) * 7919 + 17);
    this.keepOut = opts.keepOut || [];
    this.twd = opts.twd ?? 0;
    this.vessels = []; this.moored = []; this.movers = [];
    this.t = 0; this.events = [];
    if (this.k <= 0) return;
    const t0 = Date.now();
    this.nav = new NavGrid(world, 2);
    this.hash = new Map(); this.HC = 60;
    this.ferryRails = [];
    this.buildFerryRails();
    this.placeBerths();
    this.placeMoorings();
    this.placeAnchored();
    this.spawnMovers();
    this.nameAll(opts.seed ?? 1, opts.venue);
    this.buildMs = Date.now() - t0;
  }
  counts() {
    const c = { berthed: 0, moored: 0, anchored: 0, ferries: 0, underway: 0 };
    for (const v of this.vessels) {
      if (v.mode === 'berth') c.berthed++; else if (v.mode === 'mooring') c.moored++; else if (v.mode === 'anchor') c.anchored++;
      else if (v.ferry) c.ferries++; else c.underway++;
    }
    return c;
  }
  sdf(x, z) { return this.world.open ? 1e4 : this.world.sdfAt(x, z); }
  kept(x, z, m = 0) { for (const k of this.keepOut) if (hyp(x - k.x, z - k.z) < k.r + m) return true; return false; }
  // spatial hash of vessels that stay put (placement spacing, collisions)
  hkey(x, z) { return Math.floor(x / this.HC) * 100003 + Math.floor(z / this.HC); }
  hadd(v) { const k = this.hkey(v.x, v.z); let a = this.hash.get(k); if (!a) this.hash.set(k, a = []); a.push(v); }
  near(x, z, r, fn) {
    const n = Math.ceil(r / this.HC), i0 = Math.floor(x / this.HC), j0 = Math.floor(z / this.HC);
    for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) { const a = this.hash.get(i * 100003 + j); if (a) for (const v of a) if (fn(v) === false) return false; }
    return true;
  }
  free(x, z, r) { return this.near(x, z, r + 160, (v) => hyp((v.ax ?? v.x) - x, (v.az ?? v.z) - z) >= r + (v.room ?? v.L / 2)); }
  make(type, o = {}) {
    const T = VESSELS[type], r = this.rnd;
    const sc = o.scale ?? (type === 'yacht' ? 0.72 + r() * 0.62 : type === 'motor' ? 0.8 + r() * 0.5 : type === 'ship' ? 0.7 + r() * 0.6 : 0.9 + r() * 0.2);
    const v = { type, T, L: T.L * sc, B: T.B * sc, H: T.H * sc, scale: sc, x: 0, z: 0, psi: 0, u: 0, heel: 0, pitch: 0, heave: 0, roll: 0,
      color: o.color ?? (type === 'ship' ? [0x2b2f36, 0x7a1f1f, 0x1d3557, 0x2e5e4e][Math.floor(r() * 4)] : type === 'fishing' ? [0x2f5d8a, 0xb8322b, 0x2e5e4e, 0xe8e2d0][Math.floor(r() * 4)] : HULLS[Math.floor(r() * HULLS.length)]),
      seed: r(), lights: 0, sails: false, twa: 0, boom: 0.3, name: o.name || '', ...o };
    this.vessels.push(v);
    return v;
  }

  // ---------------- ferries: their real routes, on the water
  buildFerryRails() {
    const W = this.world, nav = this.nav, R = W.R - 60;
    for (const f of this.data.ferries || []) {
      // densify, keep the longest run inside the modelled area
      const d = [];
      for (let i = 0; i + 3 < f.pts.length; i += 2) {
        const ax = f.pts[i], az = f.pts[i + 1], bx = f.pts[i + 2], bz = f.pts[i + 3], n = Math.max(1, Math.ceil(hyp(bx - ax, bz - az) / 15));
        for (let k = 0; k < n; k++) d.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
      }
      d.push([f.pts[f.pts.length - 2], f.pts[f.pts.length - 1]]);
      let runs = [], cur = [];
      for (const p of d) { if (Math.abs(p[0]) < R && Math.abs(p[1]) < R) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
      if (cur.length) runs.push(cur);
      let run = runs.sort((a, b) => b.length - a.length)[0];
      if (!run || run.length < 10) continue;
      const edge = (p) => Math.abs(p[0]) > R - 40 || Math.abs(p[1]) > R - 40;
      const endA = edge(run[0]) ? 'edge' : 'term', endB = edge(run[run.length - 1]) ? 'edge' : 'term';
      // the ends run up the slipway onto land: trim them back to water
      let a = 0, b = run.length - 1;
      while (a < b && this.sdf(...run[a]) < 5) a++;
      while (b > a && this.sdf(...run[b]) < 5) b--;
      run = run.slice(a, b + 1);
      if (run.length < 8) continue;
      // stretches over land (a coarse coastline, a route drawn across a spit): replan them over the water
      const pts = [];
      let ok = true;
      for (let i = 0; i < run.length && ok; i++) {
        if (this.sdf(...run[i]) >= 3) { pts.push(run[i][0], run[i][1]); continue; }
        let j = i; while (j < run.length && this.sdf(...run[j]) < 3) j++;
        if (j >= run.length) break;
        const p0 = [pts[pts.length - 2], pts[pts.length - 1]], seg = nav.plan(p0[0], p0[1], run[j][0], run[j][1], 6);
        if (!seg) { ok = false; break; }
        for (let k = 2; k + 1 < seg.length; k += 2) pts.push(seg[k], seg[k + 1]);
        i = j;
      }
      if (!ok || pts.length < 8) continue;
      const rail = new Rail(pts);
      if (rail.L < (/floating bridge|chain/i.test(f.n + f.op) ? 50 : 250)) continue;
      const nm = f.n + ' ' + f.op;
      const type = /floating bridge|chain/i.test(nm) ? 'chain' : /fast|jet|hover|catamaran|express/i.test(nm) ? 'fastcat' : /vehic|car |wightlink|red funnel|sealink|great barrier/i.test(nm) && rail.L > 2500 ? 'carferry' : 'ferry';
      this.ferryRails.push({ rail, type, name: f.n, op: f.op, endA, endB });
    }
    // one route drawn twice (a way and its relation, or both directions): keep one
    this.ferryRails.sort((a, b) => b.rail.L - a.rail.L);
    const kept = [];
    for (const fr of this.ferryRails) {
      const o = {}, dup = kept.some(k => { let same = 0; for (let s = 0; s <= 10; s++) { fr.rail.at(fr.rail.L * s / 10, o); const q = {}; let best = 1e9; for (let u = 0; u <= 40; u++) { k.rail.at(k.rail.L * u / 40, q); best = Math.min(best, hyp(q.x - o.x, q.z - o.z)); } if (best < 60) same++; } return same >= 9; });
      if (!dup) kept.push(fr);
    }
    this.ferryRails = kept;
    // (a ferry lane is kept clear of the moorings placed later)
    for (const fr of kept) { const o = {}; for (let s = 0; s < fr.rail.L; s += 40) { fr.rail.at(s, o); (this.lanes || (this.lanes = [])).push(o.x, o.z); } }
  }
  inLane(x, z, r) { const l = this.lanes; if (!l) return false; for (let i = 0; i < l.length; i += 2) if (Math.abs(l[i] - x) < r && Math.abs(l[i + 1] - z) < r && hyp(l[i] - x, l[i + 1] - z) < r) return true; return false; }

  // ---------------- marina berths: boats side by side along the pontoons, bows in
  placeBerths() {
    const D = this.data, r = this.rnd, occ = 0.35 + 0.55 * this.k;
    const marinas = (D.marinas || []);
    const inMarina = (x, z) => marinas.some(m => m.ring ? pip(m.ring, x, z) || nearRing(m.ring, x, z, 30) : hyp(x - m.c[0], z - m.c[1]) < 250);
    const lines = [...(D.pontoons || []).map(p => ({ p, float: true })), ...(D.jetties || []).map(p => ({ p, float: false }))];
    const all = lines.map(l => { const b = ringBox(l.p); b.p = l.p; return b; });
    let placed = 0;
    const cap = Math.round(90 + 520 * this.k);
    for (const { p, float } of lines) {
      const len = polyLen(p), marina = inMarina(p[0], p[1]) || inMarina(p[p.length - 2], p[p.length - 1]);
      if (!marina && !float) {
        // a private jetty: a boat at its head, now and then
        if (len > 8 && len < 120 && r() < 0.3 + 0.4 * this.k) {
          const n = p.length, ex = p[n - 2], ez = p[n - 1], dx = ex - p[n - 4], dz = ez - p[n - 3], L0 = hyp(dx, dz) || 1;
          const type = r() < 0.55 ? 'yacht' : r() < 0.6 ? 'motor' : 'rib', T = VESSELS[type];
          const sd = r() < 0.5 ? 1 : -1, nx = -dz / L0 * sd, nz = dx / L0 * sd, off = 1.6 + T.B * 0.5;
          const x = ex - dx / L0 * T.L * 0.45 + nx * off, z = ez - dz / L0 * T.L * 0.45 + nz * off;
          if (this.sdf(x, z) > 1.5 && this.free(x, z, T.B) && !this.kept(x, z, 20)) { const v = this.make(type, { x, z, psi: Math.atan2(dx, -dz), mode: 'berth' }); v.ax = x; v.az = z; v.room = v.B * 0.6; this.hadd(v); }
        }
        continue;
      }
      // both sides, perpendicular; bows toward the pontoon
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = hyp(bx - ax, bz - az);
        if (L < 6) continue;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        for (const sd of [1, -1]) {
          const nx = -uz * sd, nz = ux * sd;
          for (let s = 3; s < L - 2;) {
            const type = r() < 0.8 ? 'yacht' : r() < 0.7 ? 'motor' : 'rib', sc = type === 'yacht' ? 0.75 + r() * 0.45 : 0.8 + r() * 0.35;
            const T = VESSELS[type], Lb = T.L * sc, Bb = T.B * sc;
            const off = 1.4 + Lb / 2, x = ax + ux * s + nx * off, z = az + uz * s + nz * off;
            s += Bb + 0.9;
            if (r() > occ || placed >= cap) continue;
            const tx = x + nx * Lb * 0.45, tz = z + nz * Lb * 0.45;
            if (this.sdf(x, z) < 1.5 || this.sdf(tx, tz) < 0 || this.kept(x, z, 10)) continue;
            // not across another pontoon
            let clash = false;
            for (const q of all) { if (q.p === p || x < q[0] - Lb || x > q[2] + Lb || z < q[1] - Lb || z > q[3] + Lb) continue; if (segDist(q.p, x, z) < Lb * 0.45 || segDist(q.p, tx, tz) < 1) { clash = true; break; } }
            if (clash || !this.free(x, z, Bb * 0.55)) continue;
            const v = this.make(type, { x, z, psi: Math.atan2(-nx, nz) + (r() < 0.25 ? Math.PI : 0), mode: 'berth', scale: sc });
            v.ax = x; v.az = z; v.room = Bb * 0.55; this.hadd(v); placed++;
          }
        }
      }
    }
    // marinas mapped without pontoons: rows of boats across the basin
    for (const m of marinas) {
      if (!m.ring) continue;
      let have = 0; this.near(m.c[0], m.c[1], 300, v => { if (v.mode === 'berth' && pip(m.ring, v.x, v.z)) have++; });
      const area = ringArea(m.ring);
      if (have > area / 900 || area < 2000) continue;
      const [ox, oz, ux, uz] = obbAxis(m.ring), vx = -uz, vz = ux;
      let bb = 0; for (let i = 0; i < m.ring.length; i += 2) bb = Math.max(bb, hyp(m.ring[i] - ox, m.ring[i + 1] - oz));
      for (let a = -bb; a <= bb; a += 34) for (const side of [-1, 1]) for (let c = -bb; c <= bb; c += 4.4) {
        if (placed >= cap || r() > occ) continue;
        const x = ox + vx * (a + side * 6.2) + ux * c, z = oz + vz * (a + side * 6.2) + uz * c;
        if (!pip(m.ring, x, z) || this.sdf(x, z) < 3 || this.kept(x, z, 10) || !this.free(x, z, 1.8)) continue;
        const v = this.make(r() < 0.8 ? 'yacht' : 'motor', { x, z, psi: Math.atan2(vx * side, -vz * side), mode: 'berth', scale: 0.75 + r() * 0.4 });
        v.ax = x; v.az = z; v.room = v.B * 0.55; this.hadd(v); placed++;
      }
    }
    for (const v of this.vessels) if (v.mode === 'berth') this.nav.blockDisc(v.x, v.z, v.L * 0.5 + 2);
  }

  // ---------------- swing moorings: the mapped ones, and fields in the sheltered water off every harbour
  mooringOK(x, z, L) {
    const s = this.sdf(x, z), d = this.world.open ? 50 : this.world.depthAt(x, z);
    return s > L + 12 && d > 1.8 && !this.kept(x, z, 60) && !this.inLane(x, z, 70);
  }
  addMooring(x, z, type = 'yacht') {
    const v = this.make(type, { mode: 'mooring' });
    v.ax = x; v.az = z; v.scope = v.L * 0.9 + 6; v.room = v.scope + v.L * 0.55; v.x = x; v.z = z;
    this.hadd(v); this.nav.blockDisc(x, z, v.scope + v.L * 0.5 + 4);
    return v;
  }
  placeMoorings() {
    const D = this.data, r = this.rnd, W = this.world;
    const cap = Math.round(40 + 260 * this.k);
    let n = 0;
    for (const [x, z] of D.moorings || []) {
      if (n >= cap) break;
      if (r() > 0.4 + 0.6 * this.k) continue;
      if (this.sdf(x, z) > 12 && (W.open || W.depthAt(x, z) > 1.2) && !this.kept(x, z, 40) && this.free(x, z, 14)) { this.addMooring(x, z, r() < 0.85 ? 'yacht' : 'motor'); n++; }
    }
    for (const ring of D.mooringAreas || []) n += this.fillArea(ring, Math.min(cap - n, Math.round(ringArea(ring) / 2500 * this.k)));
    // fields off the marinas and harbours (and off the jetty-lined shores where nothing is mapped)
    if (W.open) return;
    const seeds = [];
    for (const m of D.marinas || []) seeds.push(m.c);
    for (const h of D.harbours || []) seeds.push(h.c);
    if (!seeds.length) for (const p of (D.jetties || []).concat(D.pontoons || [])) seeds.push([p[p.length - 2], p[p.length - 1]]);
    // (close seeds share one field)
    const uniq = [];
    for (const s of seeds) if (!uniq.some(u => hyp(u[0] - s[0], u[1] - s[1]) < 700)) uniq.push(s);
    for (const s of uniq.slice(0, 24)) {
      if (n >= cap) break;
      // the nearest sheltered water a boat can swing in
      let best = null;
      for (let rr = 60; rr < 1400 && !best; rr += 60) for (let a = 0; a < 6.283; a += 0.35) {
        const x = s[0] + Math.cos(a) * rr, z = s[1] + Math.sin(a) * rr;
        if (Math.abs(x) > W.R - 200 || Math.abs(z) > W.R - 200) continue;
        const sd = this.sdf(x, z);
        if (sd < 35 || sd > 260 || !this.mooringOK(x, z, 12)) continue;
        if (this.exposure(x, z) > 2500) continue;
        best = [x, z]; break;
      }
      if (!best) continue;
      const want = Math.round((8 + r() * 26) * this.k);
      let k = 0;
      for (let tries = 0; tries < want * 12 && k < want && n < cap; tries++) {
        const a = r() * 6.283, rr = Math.sqrt(r()) * (90 + 22 * want);
        const x = best[0] + Math.cos(a) * rr, z = best[1] + Math.sin(a) * rr;
        if (!this.mooringOK(x, z, 11) || this.sdf(x, z) > 380 || !this.free(x, z, 17)) continue;
        this.addMooring(x, z, r() < 0.82 ? 'yacht' : r() < 0.6 ? 'motor' : 'fishing'); k++; n++;
      }
    }
  }
  // mean open-water fetch around a point (m): small in a harbour, large off an open coast
  exposure(x, z) { let s = 0; for (let a = 0; a < 8; a++) s += this.world.fetchAt(x, z, a * Math.PI / 4, 4000); return s / 8; }
  fillArea(ring, want, type = 'yacht') {
    let k = 0; const r = this.rnd;
    const [x0, z0, x1, z1] = ringBox(ring);
    for (let tries = 0; tries < want * 15 && k < want; tries++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      if (!pip(ring, x, z) || this.sdf(x, z) < 15 || !this.free(x, z, type === 'ship' ? 150 : 16) || this.kept(x, z, 60)) continue;
      if (type === 'ship') this.addAnchor(x, z); else this.addMooring(x, z, r() < 0.85 ? 'yacht' : 'motor');
      k++;
    }
    return k;
  }

  // ---------------- ships and yachts at anchor
  addAnchor(x, z, type = 'ship') {
    const v = this.make(type, { mode: 'anchor' });
    v.ax = x; v.az = z; v.scope = type === 'ship' ? 90 + this.rnd() * 60 : v.L * 2.5 + 10; v.room = v.scope + v.L * 0.6; v.x = x; v.z = z;
    this.hadd(v); this.nav.blockDisc(x, z, v.scope + v.L * 0.5 + 10);
    return v;
  }
  placeAnchored() {
    const W = this.world, r = this.rnd;
    if (W.open) return;
    let ships = 0;
    const shipCap = Math.round(1 + 5 * this.k);
    for (const a of this.data.anchorages || []) {
      const deep = (x, z) => W.depthAt(x, z) > 9 && this.sdf(x, z) > 300 && !this.inLane(x, z, 250) && !this.kept(x, z, 300);
      if (a.small) {
        const want = Math.round((a.ring ? clamp(ringArea(a.ring) / 20000, 2, 14) : 4) * this.k);
        if (a.ring) this.fillArea(a.ring, want);
        else for (let i = 0, k = 0; i < want * 10 && k < want; i++) { const x = a.c[0] + (r() - 0.5) * 300, z = a.c[1] + (r() - 0.5) * 300; if (this.sdf(x, z) > 30 && W.depthAt(x, z) > 2 && this.free(x, z, 30) && !this.kept(x, z, 40)) { this.addAnchor(x, z, 'yacht'); k++; } }
        continue;
      }
      if (ships >= shipCap) continue;
      const want = Math.min(shipCap - ships, a.ring ? clamp(Math.round(ringArea(a.ring) / 300000 * this.k), 1, 3) : 1);
      for (let i = 0, k = 0; i < 60 && k < want; i++) {
        const x = a.ring ? ringBox(a.ring)[0] + r() * (ringBox(a.ring)[2] - ringBox(a.ring)[0]) : a.c[0] + (r() - 0.5) * 800;
        const z = a.ring ? ringBox(a.ring)[1] + r() * (ringBox(a.ring)[3] - ringBox(a.ring)[1]) : a.c[1] + (r() - 0.5) * 800;
        if (a.ring && !pip(a.ring, x, z)) continue;
        if (deep(x, z) && this.free(x, z, 200)) { this.addAnchor(x, z); k++; ships++; }
      }
    }
  }

  // ---------------- names: the ferries by their real ships, the rest by the game's fleet names (another draw
  // than the race fleet's), ships and fishing boats by names of their kind
  ferryName(fr) {
    const nm = fr.name + ' ' + fr.op, F = FERRY_FLEETS.find(([re]) => re.test(nm)), fast = fr.type === 'fastcat';
    const list = F ? (fast && F[2].length ? F[2] : F[1].length ? F[1] : F[2]) : [];
    const used = this._fused || (this._fused = new Set()), free = list.filter(n => !used.has(n));
    if (!free.length) return '';
    const n = free[Math.floor(this.rnd() * free.length)]; used.add(n);
    return n;
  }
  nameAll(seed, venue) {
    const list = this.vessels.filter(v => !v.name && (v.type === 'yacht' || v.type === 'motor' || v.type === 'rib'));
    // (the pool's worth: boats under way first, then the swinging ones, those met at sea; the rest go unnamed)
    const rank = (v) => (v.mode === 'rail' ? 0 : v.mode === 'berth' ? 2 : 1);
    list.sort((a, b) => rank(a) - rank(b));
    const ids = fleetIdentities((seed | 0) + 101, Math.min(list.length, 90), VENUE_NATION[venue] || '');
    ids.forEach((id, i) => { list[i].name = id.name; });
    const r = this.rnd;
    for (const v of this.vessels) if (!v.name && v.type === 'ship') v.name = SHIP_NAMES[Math.floor(r() * SHIP_NAMES.length)];
    for (const v of this.vessels) if (!v.name && v.type === 'fishing') v.name = FISHING_NAMES[Math.floor(r() * FISHING_NAMES.length)];
  }
  // how a message names it: "the car ferry Red Falcon", "the Circular Quay - Manly ferry", "the moored yacht Tern"
  describe(v) {
    const what = v.T.name, lead = v.mode === 'rail' ? 'the ' : v.mode === 'anchor' ? 'the anchored ' : 'the moored ';
    if (v.name) return `${lead}${what} ${v.name}`;
    return v.route ? `the ${v.route} ${what}` : `${lead}${what}`;
  }

  // ---------------- boats under way
  spawnMovers() {
    const W = this.world, r = this.rnd;
    // ferries: every kept route, one or two boats spread along it
    const fcap = Math.round(1 + 11 * this.k);
    let nf = 0;
    for (const fr of this.ferryRails) {
      const per = fr.type === 'chain' ? 1 : fr.rail.L > 3000 && this.k > 0.6 ? 2 : 1;
      for (let i = 0; i < per && nf < fcap; i++, nf++) {
        const v = this.make(fr.type, { mode: 'rail', ferry: fr, name: this.ferryName(fr), route: fr.name, color: Object.entries(FERRY_NAMES).find(([k]) => (fr.op + fr.name).includes(k))?.[1] ?? (fr.type === 'carferry' ? 0xf4f4f0 : [0x2f6e3a, 0xf1efe8, 0x0e3b66][Math.floor(r() * 3)]) });
        v.need = 5; v.cruise = (v.T.kn[0] + r() * (v.T.kn[1] - v.T.kn[0])) * KT;
        v.rail = r() < 0.5 ? fr.rail : fr.rail.reversed(); v.fwd = v.rail === fr.rail;
        v.s = (i + r() * 0.6) / per * v.rail.L; v.u = v.cruise * 0.8;
        this.movers.push(v);
      }
    }
    if (W.open) {
      for (let i = 0; i < Math.round(3 * this.k); i++) this.addWanderer(i === 0 ? 'ship' : 'yacht');
      return;
    }
    // the rest scale with the size of the harbours: how many boats live here
    const home = this.vessels.filter(v => v.mode !== 'rail').length;
    const n = Math.round(clamp(6 + home * 0.07, 6, 34) * this.k);
    const lake = !(this.data.ferries || []).length && !(this.data.anchorages || []).some(a => !a.small) && this.world.maxDepth > 30;
    for (let i = 0; i < n; i++) {
      const q = r();
      this.addWanderer(q < 0.42 ? 'yacht' : q < 0.64 ? 'motor' : q < 0.82 ? 'rib' : lake ? 'motor' : 'fishing');
    }
  }
  // a point of open water: near the harbours, or anywhere with room
  pickWater(need, nearTo = null, maxR = 3500, comp = -1) {
    const W = this.world, r = this.rnd, nav = this.nav;
    for (let i = 0; i < 400; i++) {
      let x, z;
      if (nearTo && i < 300) { const a = r() * 6.283, d = 150 + r() * maxR; x = nearTo[0] + Math.cos(a) * d; z = nearTo[1] + Math.sin(a) * d; }
      else { x = (r() * 2 - 1) * (W.R - 400); z = (r() * 2 - 1) * (W.R - 400); }
      if (Math.abs(x) > W.R - 300 || Math.abs(z) > W.R - 300) continue;
      const k = nav.cell(x, z);
      if (nav.open(k, need + 15) && !this.kept(x, z, 80) && (comp < 0 || nav.comps(need).comp[k] === comp)) return [x, z];
    }
    return null;
  }
  homes() {
    if (this._homes) return this._homes;
    const h = [];
    for (const m of this.data.marinas || []) h.push(m.c);
    for (const v of this.vessels) if (v.mode === 'mooring' && this.rnd() < 0.2) h.push([v.ax, v.az]);
    return (this._homes = h);
  }
  addWanderer(type) {
    const v = this.make(type, { mode: 'rail' }), r = this.rnd;
    v.need = type === 'ship' ? 60 : type === 'fishing' ? 14 : 10;
    v.cruise = (v.T.kn[0] + r() * (v.T.kn[1] - v.T.kn[0])) * KT;
    const H = this.homes(), home = H.length ? H[Math.floor(r() * H.length)] : null;
    v.home = home;
    const L = this.nav.comps(v.need), hk = home ? this.nav.snap(this.nav.cell(home[0], home[1]), v.need, 60) : -1, hc = hk >= 0 ? L.comp[hk] : -1;
    v.comp = hc >= 0 ? hc : L.big;
    const a = this.pickWater(v.need, home, 2500, v.comp);
    if (!a) { this.vessels.splice(this.vessels.indexOf(v), 1); return null; }
    v.x = a[0]; v.z = a[1]; v.psi = r() * 6.283;
    if (!this.newLeg(v, true)) { this.vessels.splice(this.vessels.indexOf(v), 1); return null; }
    this.movers.push(v);
    return v;
  }
  // plan the next leg: somewhere else in open water (fishing boats: a fishing ground, then home)
  newLeg(v, first = false, twd = this.twd ?? 0) {
    const r = this.rnd;
    for (let tries = 0; tries < 6; tries++) {
      const far = v.type === 'fishing' || v.type === 'ship' ? 5000 : v.type === 'rib' ? 2200 : 3200;
      const b = this.pickWater(v.need, r() < 0.6 && v.home ? v.home : [v.x, v.z], far, v.comp ?? -1);
      if (!b || hyp(b[0] - v.x, b[1] - v.z) < 400) continue;
      let pts = this.nav.plan(v.x, v.z, b[0], b[1], v.need);
      if (!pts) continue;
      v.sails = false;
      if (v.type === 'yacht') {
        // under sail where there is room to tack; motoring where there is not
        const z = tackRoute(this.nav, pts, twd, 48 * DEG, v.need);
        if (z) { pts = z; v.sails = true; }
      }
      v.rail = new Rail(pts); v.s = first ? r() * v.rail.L * 0.7 : 0; v.fwd = true;
      v.fishing = v.type === 'fishing' && r() < 0.7;
      v.stuck = 0; v.lastS = v.s; v.twdPlan = twd;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- per step
  // env: Environment (wind, current, waves); boats: the sailing boats (player, fleet, online) to keep clear of
  update(dt, t, env, boats = []) {
    if (this.k <= 0) return;
    this.t = t;
    const mw = env.wind.mean(t);
    this.twd = mw.dir; this.tws = mw.speed;
    const o = this._o || (this._o = {}), c = this._c || (this._c = {});
    // moored and anchored boats lie to the wind and the tide (a keel boat to the tide, windage turns her)
    this.mooredAcc = (this.mooredAcc || 0) + dt;
    if (this.mooredAcc > 0.25) {
      const h = this.mooredAcc; this.mooredAcc = 0;
      const wx = -Math.sin(mw.dir) * mw.speed, wz = Math.cos(mw.dir) * mw.speed;   // (wind blows toward)
      for (const v of this.vessels) {
        if (v.mode !== 'mooring' && v.mode !== 'anchor') continue;
        env.current.at(v.ax, v.az, c);
        const kw = v.type === 'ship' ? 0.012 : 0.05, fx = wx * kw + c.x, fz = wz * kw + c.z;
        // bow toward where the flow comes from, sheering to and fro about it
        const want = Math.atan2(-fx, fz) + Math.sin(t / (40 + 60 * v.seed) + v.seed * 20) * (v.type === 'ship' ? 0.06 : 0.22) * clamp(mw.speed / 6, 0.3, 1.5);
        if (v.psi0 === undefined) v.psi0 = want;
        v.psi0 += wrap(want - v.psi0) * clamp(h / (v.type === 'ship' ? 90 : 25), 0, 1);
        v.psi = v.psi0;
        v.x = v.ax - Math.sin(v.psi) * v.scope * (1 - 0.1 * Math.cos(t * 0.05 + v.seed * 9)); v.z = v.az + Math.cos(v.psi) * v.scope * (1 - 0.1 * Math.cos(t * 0.05 + v.seed * 9));
      }
    }
    const q = this.queue;
    if (q && q.length) {
      const v = q.shift(); v.queued = false;
      const keep = v.dwell > 1e8 ? 0 : v.dwell;
      v.dwell = this.newLeg(v, false, this.twd) ? Math.max(keep, 2 + this.rnd() * 20) : 30;
    }
    for (const v of this.movers) this.move(v, dt, t, env, boats, o);
  }
  // a new leg is planned later (one A* a frame, so a frame never hitches on several), meanwhile the boat waits
  replan(v) { if (!v.queued) { v.queued = true; (this.queue || (this.queue = [])).push(v); } v.dwell = Math.max(v.dwell || 0, 1e9); }
  move(v, dt, t, env, boats, o) {
    const W = this.world, r = this.rnd;
    if (v.dwell > 0) {                            // alongside at a terminal, or away past the edge of the chart
      v.dwell -= dt; v.u = 0;
      if (v.dwell <= 0) { v.hidden = false; if (v.ferry) { v.rail = v.rail.reversed(); v.s = 0; v.fwd = !v.fwd; } }
      return;
    }
    const rail = v.rail;
    if (v.s >= rail.L - 0.5) {
      if (v.ferry) {
        const end = v.fwd ? v.ferry.endB : v.ferry.endA;
        v.dwell = end === 'edge' ? 120 + r() * 240 : v.type === 'chain' ? 50 + r() * 30 : 70 + r() * 110;
        v.hidden = end === 'edge';
      } else {
        this.replan(v);
      }
      return;
    }
    // the speed it wants: cruising (or what the wind gives), slower through bends and near the end
    rail.at(v.s, o);
    const px0 = o.x, pz0 = o.z;
    const psi = rail.heading(v.s, v.L * 0.5);
    let want = v.cruise;
    if (v.sails) {
      if (!(t - (v.windT ?? -9) < 0.5)) { const wv = env.wind.sample(px0, pz0, t, this._w || (this._w = {})); v.windT = t; v.twd = wv.dir; v.tws = wv.speed; }
      v.twa = wrap(v.twd - psi);
      want = Math.max(1.0, yachtSpeed(v.twa, v.tws));
      if (Math.abs(v.twa) < 26 * DEG) { v.ironsT = (v.ironsT || 0) + dt; if (v.ironsT > 20) { v.sails = false; v.cruise = 5.5 * KT; } } else v.ironsT = 0;
    }
    const look = 25 + v.u * 6, h1 = rail.heading(Math.min(rail.L, v.s + look), v.L * 0.5);
    want *= clamp(1 - Math.abs(wrap(h1 - psi)) / Math.PI * 1.6, 0.3, 1);
    want = Math.min(want, 0.8 + Math.sqrt(2 * 0.25 * Math.max(0, rail.L - v.s)));        // (stops at the end)
    if (v.ferry && v.type !== 'chain' && v.s < 150) want = Math.min(want, 2 + v.s * 0.08); // leaving the terminal
    if (v.fishing) want = Math.min(want, 1.6);                                              // trawling
    o.x = px0; o.z = pz0;
    // give way (looked at four times a second): to the player, power to sail and to power on its starboard side,
    // small craft to big ships; the give-way vessel slows and steps to starboard of its track
    if (!(t < v.avoidT)) { v.avoidT = t + 0.2 + 0.1 * r(); this.lookOut(v, psi, o.x, o.z, boats); }
    const yieldTo = v.yieldTo, stepOut = v.stepOut;
    want *= 1 - 0.85 * (yieldTo || 0);
    // step to starboard (never toward the shore or a moored boat)
    const off0 = v.off || 0, sx = Math.cos(psi), sz = Math.sin(psi);
    let offT = (stepOut || 0) * Math.min(40, v.L * 1.5 + 10);
    if (offT > 0) { const px = o.x + sx * offT, pz = o.z + sz * offT; if (this.sdf(px, pz) < v.need * 0.6 + v.B || this.nav.blockedAt(px, pz)) offT = 0; }
    v.off = off0 + clamp(offT - off0, -2 * dt, 2 * dt);
    // speed: accelerate / brake at the type's rate
    const acc = v.L > 60 ? 0.12 : v.L > 25 ? 0.25 : 0.6;
    v.u += clamp(want - v.u, -acc * 1.6 * dt, acc * dt);
    v.s += Math.max(0, v.u) * dt;
    rail.at(v.s, o);
    let x = o.x + sx * v.off, z = o.z + sz * v.off;
    if (this.sdf(x, z) < 1.5) { v.off = 0; x = o.x; z = o.z; }             // (the rail itself is on the water)
    const turn = wrap(psi - v.psi);
    v.psi = psi;
    v.x = x; v.z = z;
    // the look of it: heel into a turn (power) or to leeward (sail), bow up at speed
    const rate = turn / Math.max(dt, 1e-3);
    if (v.sails) {
      v.heel += (-Math.sign(v.twa) * yachtHeel(v.twa, v.tws) - v.heel) * clamp(dt / 3, 0, 1);
      const aw = Math.atan2(Math.sin(Math.abs(v.twa)) * v.tws, Math.cos(Math.abs(v.twa)) * v.tws + v.u);
      v.boom += (clamp(aw * 0.55 - 0.05, 0.08, 1.4) - v.boom) * clamp(dt / 2, 0, 1);
    } else v.heel += (clamp(rate * v.u * 0.35, -0.2, 0.2) * (v.L > 30 ? -0.3 : 1) - v.heel) * clamp(dt * 2, 0, 1);   // (+ = to starboard: a planing hull leans into the turn, a ship out of it)
    v.trim = v.T.power && v.L < 20 ? clamp((v.u - 3) * 0.012, 0, 0.09) : 0;
    // stuck (blocked by traffic for long): replan
    if (!v.ferry) {
      if (v.s - v.lastS < 0.2 * dt) v.stuck += dt; else v.stuck = 0;
      v.lastS = v.s;
      if (v.stuck > 90) { v.stuck = 0; this.replan(v); }
      else if (v.sails && Math.abs(wrap(this.twd - v.twdPlan)) > 35 * DEG && v.s > 50 && !v.queued) this.replan(v);
    }
  }

  lookOut(v, psi, x, z, boats) {
    this._v = v; this._psi = psi; this._x = x; this._z = z; this._y = 0; this._s = 0;
    this._fx = Math.sin(psi) * v.u; this._fz = -Math.cos(psi) * v.u;
    // (every sailing boat of the game — the player, a race fleet, online sailors — is given room)
    for (const b of boats) this.check(b.x, b.z, Math.sin(b.psi) * (b.u || 0), -Math.cos(b.psi) * (b.u || 0), b.cls ? b.cls.loa : 8, true, true);
    for (const w of this.movers) if (w !== v && !w.hidden && !(w.dwell > 0) && Math.abs(w.x - x) < 500 && Math.abs(w.z - z) < 500) this.check(w.x, w.z, Math.sin(w.psi) * w.u, -Math.cos(w.psi) * w.u, w.L, !!w.sails, false);
    v.yieldTo = this._y; v.stepOut = this._s;
  }
  check(ox, oz, ovx, ovz, oL, osail, player) {
    const v = this._v, psi = this._psi, dx = ox - this._x, dz = oz - this._z, d = hyp(dx, dz);
    if (d > 400 + v.L) return;
    const rvx = ovx - this._fx, rvz = ovz - this._fz, rv2 = rvx * rvx + rvz * rvz;
    const tc = rv2 > 1e-4 ? clamp(-(dx * rvx + dz * rvz) / rv2, 0, 90) : 0;
    const cpa = hyp(dx + rvx * tc, dz + rvz * tc), safe = (v.L + oL) * 0.6 + (player ? 25 : 12);
    if (cpa > safe || (tc > 60 && d > safe * 2)) return;
    const brg = wrap(Math.atan2(dx, -dz) - psi);                // + = on my starboard side
    const ahead = Math.abs(brg) < 100 * DEG;
    if (!ahead && d > safe) return;                              // (it is astern: an overtaking vessel keeps clear)
    // the player is always given room; power gives way to sail, and to power on its starboard side (crossing,
    // head-on, overtaking); a yacht on port tack gives way to one on starboard; small craft do not impede a
    // ship or a ferry, which stands on for them
    const iPower = v.T.power || !v.sails;
    let give = player || (iPower ? osail || (brg > -30 * DEG && brg < 112.5 * DEG) : osail && v.twa < 0);
    if (!player && v.L > 30 && oL < 20) give = false;
    if (!player && v.L < 20 && oL > 30) give = true;
    if (d < safe * 1.2 && ahead) give = true;                  // too close: whoever sees it acts
    if (!give) return;
    const urg = clamp(1 - (tc * Math.max(v.u, 0.5)) / (8 * v.L + 120), 0, 1) * clamp(1.6 - cpa / safe, 0, 1);
    if (urg > this._y) this._y = urg;
    if (ahead && urg > this._s) this._s = urg;
  }

  // Sailing boats against the traffic: a hull (capsule) against every vessel near it. The boat is pushed off
  // and bounces; onHit(boat, vessel, speed) for a message.
  collide(boats, onHit) {
    if (this.k <= 0) return;
    const hit = (b, v) => {
      const C = b.cls, fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
      const bA = [b.x + fx * (C.bowX - C.beam * 0.35), b.z + fz * (C.bowX - C.beam * 0.35)], bB = [b.x + fx * (C.sternX + C.beam * 0.35), b.z + fz * (C.sternX + C.beam * 0.35)];
      const gx = Math.sin(v.psi), gz = -Math.cos(v.psi), hl = Math.max(0, v.L / 2 - v.B / 2);
      const vA = [v.x + gx * hl, v.z + gz * hl], vB = [v.x - gx * hl, v.z - gz * hl];
      let best = null;
      for (let i = 0; i <= 4; i++) {
        const px = bA[0] + (bB[0] - bA[0]) * i / 4, pz = bA[1] + (bB[1] - bA[1]) * i / 4;
        const q = closestOn(vA, vB, px, pz), d = hyp(px - q[0], pz - q[1]);
        if (!best || d < best.d) best = { d, px, pz, qx: q[0], qz: q[1] };
      }
      const rr = C.beam * 0.45 + v.B * 0.45;
      if (best.d >= rr) return;
      let nx = best.px - best.qx, nz = best.pz - best.qz; const L = hyp(nx, nz) || 1; nx /= L; nz /= L;
      b.x += nx * (rr - best.d); b.z += nz * (rr - best.d);
      const sx = Math.cos(b.psi), sz = Math.sin(b.psi);
      const ux = b.u * fx + b.v * sx - gx * v.u, uz = b.u * fz + b.v * sz - gz * v.u, vn = ux * nx + uz * nz;
      if (vn < 0) {
        const wx = ux - 1.5 * vn * nx + gx * v.u, wz = uz - 1.5 * vn * nz + gz * v.u;
        b.u = (wx * fx + wz * fz) * 0.7; b.v = (wx * sx + wz * sz) * 0.7;
        if (v.mode === 'rail') v.u *= 0.3;
        if (onHit && -vn > 0.3) onHit(b, v, -vn);
      }
    };
    for (const b of boats) {
      if (!b.cls) continue;
      this.near(b.x, b.z, 80, (v) => { if (Math.abs(v.x - b.x) < v.L + 10 && Math.abs(v.z - b.z) < v.L + 10) hit(b, v); });
      for (const v of this.movers) if (!v.hidden && Math.abs(v.x - b.x) < v.L + 10 && Math.abs(v.z - b.z) < v.L + 10) hit(b, v);
    }
  }
}

// the traffic on the tactical map: small dots for boats under way, ferries a little bigger
export function drawTrafficMap(ctx, traffic, lw) {
  if (!traffic) return;
  for (const v of traffic.movers) {
    if (v.hidden) continue;
    ctx.fillStyle = v.ferry ? 'rgba(255,214,90,.9)' : v.sails ? 'rgba(200,235,255,.75)' : 'rgba(255,255,255,.55)';
    const r = Math.max(v.L / 2, (v.ferry ? 4 : 2.5) * lw);
    ctx.beginPath(); ctx.arc(v.x, v.z, r, 0, Math.PI * 2); ctx.fill();
  }
}

// ------------------------------------------------------------------ tacking upwind
// Turn every leg of a route that points into the wind into a zigzag of tacks inside a lane, tacking early for
// the shore; null if it cannot (then the yacht motors)
function tackRoute(nav, pts, twd, up, need) {
  const out = [pts[0], pts[1]];
  let x = pts[0], z = pts[1];
  for (let i = 2; i < pts.length; i += 2) {
    const bx = pts[i], bz = pts[i + 1], x0 = x, z0 = z, L0 = hyp(bx - x0, bz - z0) || 1, ax = (bx - x0) / L0, az = (bz - z0) / L0;
    let s = wrap(Math.atan2(bx - x, -(bz - z)) - twd) > 0 ? 1 : -1, guard = 0;
    for (;;) {
      const rel = wrap(Math.atan2(bx - x, -(bz - z)) - twd), d = hyp(bx - x, bz - z);
      if (Math.abs(rel) >= up * 0.93 || d < 30) { if (!nav.clearSeg(x, z, bx, bz, Math.min(need, 4))) return null; out.push(bx, bz); x = bx; z = bz; break; }
      if (guard++ > 30) return null;
      // on tack s until the other tack fetches the mark, or the lane edge, or the shore ahead
      const h = twd + s * up, hx = Math.sin(h), hz = -Math.cos(h), lane = clamp(L0 * 0.3, 120, 450);
      let px = x, pz = z, run = 0;
      while (run < 3000) {
        if (!nav.clearSeg(px, pz, px + hx * 40, pz + hz * 40, need)) break;
        px += hx * 10; pz += hz * 10; run += 10;
        const rel2 = wrap(Math.atan2(bx - px, -(bz - pz)) - twd);
        if (Math.abs((px - x0) * az - (pz - z0) * ax) > lane || -s * rel2 >= up * 0.97) break;
      }
      if (run < 30) return null;
      out.push(px, pz); x = px; z = pz; s = -s;
    }
  }
  return out;
}

// ------------------------------------------------------------------ geometry helpers
function pip(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function closestOn(a, b, px, pz) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / L2, 0, 1);
  return [a[0] + dx * t, a[1] + dz * t];
}
function segDist(p, x, z) {
  let best = 1e18;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}
function nearRing(ring, x, z, r) { return segDist(ring, x, z) < r; }
function polyLen(p) { let s = 0; for (let i = 0; i + 3 < p.length; i += 2) s += hyp(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return s; }
function ringArea(r) { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]); return Math.abs(a / 2); }
function ringBox(r) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return [x0, z0, x1, z1]; }
// centre and long axis of a ring (principal axis of its vertices)
function obbAxis(r) {
  const n = r.length / 2; let cx = 0, cz = 0; for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; } cx /= n; cz /= n;
  let xx = 0, xz = 0, zz = 0; for (let i = 0; i < r.length; i += 2) { const dx = r[i] - cx, dz = r[i + 1] - cz; xx += dx * dx; xz += dx * dz; zz += dz * dz; }
  const a = 0.5 * Math.atan2(2 * xz, xx - zz);
  return [cx, cz, Math.cos(a), Math.sin(a)];
}
