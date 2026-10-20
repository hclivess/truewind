// One run of test/conditions.mjs (in a worker): a class on the game's autopilot, holding a wind angle like a wind
// vane, in one of the game's water conditions; returns what a sailor would notice.
import { Boat, autoTrim, wrap, CLASSES } from '../js/physics.js';
import { Environment, KT } from '../js/env.js';
import { VENUES, World } from '../js/world.js';
import { Autopilot } from '../js/autopilot.js';
import '../js/sail/sailsim.js';
const DEG = Math.PI / 180;

// the conditions: every kind of water the game sails in
export const CONDS = {
  flat:    { kt: 14, wavesOn: false, weather: 'steady', note: 'flat water, steady wind (the old tests\' only case)' },
  light:   { kt: 4, fetchKm: 20, weather: 'steady', note: '4 kn, its ripples' },
  sea8:    { kt: 8, fetchKm: 20, weather: 'steady', note: '8 kn, 20 km fetch' },
  sea14:   { kt: 14, fetchKm: 20, weather: 'steady', note: '14 kn, 20 km fetch' },
  sea20:   { kt: 20, fetchKm: 50, weather: 'steady', note: '20 kn, 50 km fetch' },
  ocean25: { kt: 25, fetchKm: 2000, weather: 'steady', note: '25 kn, fully developed ocean sea' },
  swell:   { kt: 12, fetchKm: 20, swellH: 2, swellT: 10, weather: 'steady', note: '12 kn + 2 m 10 s swell' },
  shallow: { kt: 14, fetchKm: 20, depthOverDraft: 1.2, weather: 'steady', note: '14 kn, 1.2 m under the keel' },
  current: { kt: 14, fetchKm: 20, currentKt: 1.5, currentDir: 90, weather: 'steady', note: '14 kn, 1.5 kn cross stream' },
  gusty:   { kt: 14, fetchKm: 20, weather: 'changing', note: '14 kn, puffs and shifts' },
  squalls: { kt: 14, fetchKm: 20, weather: 'squalls', note: '14 kn, squalls' },
};

export async function runCond({ cls, cond, twa, secs = 120, seed = 7 }) {
  const c = CONDS[cond];
  const depth = c.depthOverDraft ? CLASSES[cls].draft + c.depthOverDraft : null;
  const venue = { ...VENUES.find(v => v.id === 'open'), ...(depth ? { depth } : {}) };
  const world = new World(venue, null);
  const env = new Environment({ tws: c.kt * KT, twd: 0, fetchKm: c.fetchKm ?? 20, swellH: c.swellH, swellT: c.swellT, seed, weather: c.weather,
    wavesOn: c.wavesOn ?? true, currentKt: c.currentKt ?? 0, currentDir: c.currentDir ?? 90 });
  if (depth) env.waves.buildDepthField(world);
  env.tick(0);
  const b = new Boat(cls, { id: 0, lod: +(process.env.LOD ?? 0) });
  const psi0 = -twa * DEG; b.reset(0, 0, psi0);
  // (a flying start: the crew sets the sails at speed on the course)
  const u0 = Math.min(2.5, 0.35 * c.kt * KT + 0.5);
  for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0, world); b.x = 0; b.z = 0; b.psi = psi0; b.r = 0; b.u = u0; b.v = 0; }
  const ap = new Autopilot(b), sim = { boats: [b], world, env };
  ap.engage(0);
  const dt = 1 / 120, settle = 20;
  const s = { n: 0, hs: 0, hc: 0, ws: 0, wc: 0, a: 0, a2: 0, u: 0, lee: 0, phi2: 0, heelMax: 0, rudMax: 0, off: 0, offRun: 0, offMax: 0, slow: 0, capsized: 0, nan: false, aground: 0 };
  let tgt = null;
  for (let i = 0; i < secs / dt; i++) {
    const t = i * dt;
    if (i % 12 === 0) env.tick(t);
    ap.update(dt, t, sim, {});
    b.step(dt, env, t, world);
    if (!Number.isFinite(b.u + b.v + b.phi + b.psi)) { s.nan = true; break; }
    if (t < settle) continue;
    const d = b.diag, a = Math.abs(wrap((d.twd ?? 0) - b.psi)) / DEG;
    if (tgt === null) tgt = Math.abs(ap.vaneTwa ?? twa * DEG) / DEG;
    s.n++; s.a += a; s.a2 += a * a; s.hs += Math.sin(b.psi); s.hc += Math.cos(b.psi); s.ws += Math.sin(d.twd ?? 0); s.wc += Math.cos(d.twd ?? 0); s.u += b.u; s.lee += Math.abs(d.leeway ?? 0); s.phi2 += b.phi * b.phi;
    s.heelMax = Math.max(s.heelMax, Math.abs(b.phi)); s.rudMax = Math.max(s.rudMax, Math.abs(b.rudder));
    // off course: 35 degrees or more from the angle it holds (a broach, a round-up, a stall in irons)
    if (Math.abs(a - tgt) > 35) { s.off += dt; s.offRun += dt; s.offMax = Math.max(s.offMax, s.offRun); } else s.offRun = 0;
    if (Math.abs(b.phi) > 80 * DEG) s.capsized += dt;
    if (b.aground > 0.05) s.aground += dt;
  }
  const n = Math.max(1, s.n), m = s.a / n;
  const csd = (S, Cc) => Math.sqrt(-2 * Math.log(Math.min(1, Math.hypot(S, Cc) / n))) / DEG;   // (circular sd)
  return { cls, cond, twa, tgt: tgt ?? twa, nan: s.nan,
    twaMean: m, twaSd: Math.sqrt(Math.max(0, s.a2 / n - m * m)), hdgSd: csd(s.hs, s.hc), windSd: csd(s.ws, s.wc), bsp: s.u / n / KT, lee: s.lee / n / DEG, heelRms: Math.sqrt(s.phi2 / n) / DEG,
    heelMax: s.heelMax / DEG, rudMax: s.rudMax / DEG, off: s.off, offMax: s.offMax, capsized: s.capsized, aground: s.aground,
    hs: env.waves.Hs ?? 0, targetHeel: (CLASSES[cls].targetHeel ?? 20 * DEG) / DEG, dinghy: !!CLASSES[cls].keel?.board };
}
