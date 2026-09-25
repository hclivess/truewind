// Weather effects every browser in a room must agree on: lightning strikes (when, where, their shape),
// when a strike's thunder reaches a listener, sea fog and morning mist, and the day's convection.
// Pure functions of (seed, cell, time, clock) — no Math.random, no three.js — so node can test them.
import { mulberry32 } from './env.js';

const DEG = Math.PI / 180;
export const SOUND = 343;                 // m/s
export const THUNDER_MAX = 25000;         // thunder is rarely heard beyond ~25 km
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
function hashInt(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return h >>> 0;
}
const hash01 = (a, b, c) => hashInt(a, b, c) / 4294967296;

// ------------------------------------------------------------------ lightning
// Each cell has a slot every SLOT seconds; a slot holds a strike with a probability that follows the
// cell's development at the strike's own time (not the viewer's), so the strike list is the same
// whenever and wherever it is computed. A mature cumulonimbus flashes a few times a minute.
const SLOT = 0.5, RATE_MAX = 0.075;       // strikes per second at full maturity (~4.5 a minute)
export function lightningRate(w, strength = 0.75) { return RATE_MAX * (0.55 + 0.6 * strength) * Math.pow(smooth(0.45, 1, w), 1.5); }
// cells: Weather.activeCells(t) (with k, age, life, track); strikes with t0 <= ts < t1 are appended to out
export function strikes(cells, t, t0, t1, out = []) {
  for (const c of cells) {
    if (c.k === undefined || c.life === undefined) continue;
    for (let n = Math.max(0, Math.floor(t0 / SLOT)); n * SLOT < t1; n++) {
      const h0 = hash01(c.k, n, 11);
      if (h0 >= RATE_MAX * 1.2 * SLOT) continue;                     // cheap reject
      const ts = (n + hash01(c.k, n, 12)) * SLOT;
      if (ts < t0 || ts >= t1) continue;
      const age = c.age + (ts - t), q = 1 - (age / c.life) ** 2, w = q > 0 ? q * q : 0;
      if (h0 >= lightningRate(w, c.strength ?? 0.75) * SLOT) continue;
      const seed = hashInt(c.k, n, 13), r = mulberry32(seed);
      const mv = c.speed * (ts - t), cx = c.x + c.ux * mv, cz = c.z + c.uz * mv;
      const cg = r() < 0.32;                                          // a third reach the ground
      // cloud-to-ground: in and around the rain core (a little ahead of the cell centre); in-cloud: anywhere
      // in the upper tower and out into the anvil downwind
      const al = cg ? (r() - 0.3) * 1.3 * c.R : (r() - 0.2) * 2.4 * c.R, la = (r() - 0.5) * (cg ? 1.6 : 2.2) * c.R;
      const strokes = [0]; const ns = cg ? 1 + Math.floor(r() * 4.5) : 2 + Math.floor(r() * 5);
      for (let i = 1; i < ns; i++) strokes.push(strokes[i - 1] + (cg ? 0.035 + r() * 0.09 : 0.05 + r() * 0.16));
      out.push({
        id: c.k * 1000003 + n, k: c.k, ts, cg, seed, strokes, peak: 0.55 + 0.45 * r(),
        x: cx + al * c.ux - la * c.uz, z: cz + al * c.uz + la * c.ux, y: cg ? 0 : 3800 + r() * 4200,
        spread: cg ? 1500 + r() * 3500 : 3000 + r() * 5000,   // extent of the channel (m): how long the rumble rolls
      });
    }
  }
  return out;
}
// light of a strike at time t (0..1): return strokes as short bright pulses, glowing between them
export function flashAt(s, t) {
  const dt = t - s.ts; if (dt < 0) return 0;
  const last = s.strokes[s.strokes.length - 1];
  if (dt > last + 0.35) return 0;
  let I = 0;
  for (const o of s.strokes) if (dt >= o) I = Math.max(I, Math.exp(-(dt - o) / (s.cg ? 0.028 : 0.06)));
  if (dt < last) I = Math.max(I, s.cg ? 0.12 : 0.2);                 // continuing current between strokes
  return I * s.peak;
}
// distances from a listener to the nearest and farthest parts of the channel (thunder starts at the
// nearest point and rolls on until sound from the farthest arrives)
export function channelRange(s, lx, ly, lz, base = 900) {
  const dh = Math.hypot(lx - s.x, lz - s.z);
  if (s.cg) {
    const near = Math.hypot(dh, Math.max(0, ly - base) + Math.min(0, ly));
    return [near, Math.hypot(dh + s.spread * 0.3, base) + s.spread * 0.4];
  }
  const d = Math.hypot(dh, s.y - ly);
  return [Math.max(Math.abs(s.y - ly) * 0.8, d - s.spread * 0.4), d + s.spread * 0.6];
}
// thunder whose sound front reaches the listener in (tPrev, t]: [{ s, d, far, ta }]
export function thunderDue(list, lx, ly, lz, tPrev, t, base, out = []) {
  if (!(t > tPrev) || t - tPrev > 5) return out;                     // paused, or a jump in time: nothing
  for (const s of list) {
    const [d, far] = channelRange(s, lx, ly, lz, base);
    if (d > THUNDER_MAX) continue;
    const ta = s.ts + d / SOUND;
    if (ta > tPrev && ta <= t) out.push({ s, d, far, ta });
  }
  return out;
}
// the bolt of a cloud-to-ground strike: a branched channel from the cloud base to the sea, fractal
// (midpoint displacement), the same everywhere for the same strike. Returns [x0,y0,z0,x1,y1,z1,I, ...]
export function boltSegments(s, top) {
  const r = mulberry32(s.seed ^ 0x5bd1e995), segs = [];
  const channel = (a, b, depth, I, branchP, rough) => {
    let pts = [a, b];
    for (let lv = 0; lv < depth; lv++) {
      const np = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i], L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        np.push([(p[0] + q[0]) / 2 + (r() - 0.5) * L * rough, (p[1] + q[1]) / 2 + (r() - 0.5) * L * 0.15, (p[2] + q[2]) / 2 + (r() - 0.5) * L * rough], q);
      }
      pts = np;
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      segs.push(p[0], p[1], p[2], q[0], q[1], q[2], I);
      if (branchP > 0 && i < pts.length - 3 && r() < branchP) {
        const len = p[1] * (0.12 + 0.3 * r()), az = r() * 2 * Math.PI, dn = 0.5 + 0.5 * r();
        const e = [p[0] + Math.cos(az) * len * 0.8, Math.max(p[1] * 0.25, p[1] - len * dn), p[2] + Math.sin(az) * len * 0.8];
        channel(p, e, Math.max(2, depth - 2), I * (0.25 + 0.2 * r()), branchP * 0.35, 0.5);
      }
    }
  };
  const lean = 300 + r() * 500, az = r() * 2 * Math.PI;
  channel([s.x + Math.cos(az) * lean, top, s.z + Math.sin(az) * lean], [s.x, 0, s.z], 7, 1, 0.1, 0.42);
  return segs;
}

// ------------------------------------------------------------------ convection through the day
// heat: surface heating 0..1 (the sun's elevation an hour and a half ago — the sea breeze and the
// cumulus lag the sun). Fair-weather cumulus start small and low in the morning, grow and lift their
// base through the day, tower in the afternoon when the air is unstable, and die away at dusk; a
// fresh-to-strong wind mixes the layer into flat, lower stratocumulus instead.
export function heatFromSun(elLag) { return Math.pow(clamp01(Math.sin(Math.max(0, elLag)) / Math.sin(55 * DEG)), 0.8); }
export function convection(mode, heat, kts) {
  const unstable = mode === 'squally' ? 1 : mode === 'changing' ? 0.5 : 0.2;
  const strat = smooth(15, 28, kts);
  const cu = heat * (1 - 0.75 * strat);
  return {
    heat, strat, unstable,
    cover: 0.05 + 0.26 * cu * (0.6 + 0.4 * unstable) + 0.22 * strat,    // added to the weather's own cloudiness
    base: (600 + 650 * cu) * (1 - strat) + 650 * strat,                 // cloud base rises as the day warms (a moist sea air: low)
    thick: (350 + cu * (550 + 700 * unstable)) * (1 - strat) + 520 * strat,
    tower: cu * unstable * smooth(0.45, 0.85, heat),                    // cumulus congestus
  };
}

// ------------------------------------------------------------------ mist and sea fog
// A layer hugging the water: extinction sigma0 (1/m) at the surface, falling off with height scale H
// (clear above ~2.5 H). Two sources:
//  * radiation mist over calm water, built through the night, thickest at dawn, burnt off as the sun
//    climbs through the morning (shallow: 10-40 m, visibility a kilometre or two);
//  * advection sea fog, moist air over cool water in a light-to-moderate breeze, at any hour, on the
//    humid spells (deep: 60-150 m, visibility down to a few hundred metres); most likely in settled
//    weather at mid latitudes (San Francisco, the Solent, Kiel), rare in the tropics.
// A rain-cooled outflow adds some scud. hour: local solar hour; kts: mean wind; cold: 0..1 outflow.
export function mist(mode, seed, t, sunEl, hour, lat, kts, cold = 0, out = {}) {
  const r = mulberry32((seed * 977 + 31) >>> 0), p0 = r() * 6.283, p1 = r() * 6.283;
  const bias = mode === 'steady' ? 0.2 : mode === 'changing' ? 0 : -0.15;
  const hum = 0.5 + 0.28 * Math.sin(2 * Math.PI * t / 5400 + p0) + 0.17 * Math.sin(2 * Math.PI * t / 2300 + p1) + bias;
  const hh = hour < 12 ? hour + 24 : hour;
  const night = smooth(20.5, 28.5, hh);                           // cools from the evening to before dawn
  const rad = night * (1 - smooth(4 * DEG, 30 * DEG, sunEl)) * smooth(11, 3.5, kts) * clamp01((hum - 0.2) / 0.45);
  const cool = smooth(24, 38, Math.abs(lat));
  const adv = cool * smooth(0.84, 1.04, hum) * smooth(17, 8, kts) * (1 - 0.35 * clamp01(Math.sin(Math.max(0, sunEl))));
  const scud = 0.4 * cold * smooth(16, 5, kts);
  const sR = 0.0035 * rad, sA = 0.013 * adv, sS = 0.0025 * scud;
  const sig = sR + sA + sS;
  const top = sig > 0 ? (sR * (12 + 28 * rad) + sA * (60 + 90 * clamp01(hum - 0.6) * 2.5) + sS * 150) / sig : 30;
  out.sigma = sig; out.H = top / 2.5; out.top = top; out.hum = hum; out.rad = rad; out.adv = adv;
  out.vis = sig > 0 ? 3.9 / sig : Infinity;                        // metres, at the surface
  return out;
}
// optical depth of the mist between two points (the same integral as the shaders)
export function mistTau(sig, H, ax, ay, az, bx, by, bz) {
  if (!(sig > 0)) return 0;
  const L = Math.hypot(bx - ax, by - ay, bz - az), y0 = Math.max(0, ay), y1 = Math.max(0, by), dy = y1 - y0;
  const g = Math.abs(dy) > 0.01 * H ? H * (Math.exp(-y0 / H) - Math.exp(-y1 / H)) / dy : Math.exp(-y0 / H);
  return sig * L * g;
}
