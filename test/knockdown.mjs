// A breaking crest beam-on. After the 1979 Fastnet the Wolfson Unit and the SNAME/USYRU capsize study
// (Kirkman, Nicholson, Marchaj; "Safety from capsizing", 1985) ran models lying beam-on, sails down, into
// breaking waves: a breaker ~30 % of LOA high knocks a yacht down, one ~55 % of LOA rolls most of them
// over. Here: a sea whose waves break at about the boat's scale, one focused group (WaveField.forceEvent)
// brought to the boat, crest swept; the breaker's height is measured at the boat (crest to the trough
// before it), the roll it gives recorded. node test/knockdown.mjs [class ...]
import { Environment, KT, DEG } from '../js/env.js';
import { Boat, CLASSES } from '../js/physics.js';
const classes = process.argv.slice(2).length ? process.argv.slice(2) : ['blackwatch', 'sportboat', 'dinghy'];
let fail = 0;
for (const cls of classes) {
  const C = CLASSES[cls], L = C.loa;
  const rows = [];
  for (const r of [0.2, 0.3, 0.42, 0.55, 0.7]) {
    // every breaker at the same steepness (H / lambda_p ~ 0.085: it breaks as it focuses), as the model
    // tests made theirs: a young wind sea whose peak wave is that long (fetch 25 km, the wind from the JONSWAP
    // peak period Tp = 0.286 chi^(1/3) U / g), its own waves kept small (seaScale), one group focused at the
    // boat with a crest ~0.6 of the height. The wind itself is taken away: lying ahull, sails of no account.
    const Tp = Math.sqrt(r * L / 0.085 / 1.56);
    let Uw = 10; for (let i = 0; i < 30; i++) { const chi = 9.81 * 25000 / (Uw * Uw); Uw = Tp * 9.81 / (0.286 * Math.cbrt(chi)); }
    const env = new Environment({ tws: Uw, twd: 0, fetchKm: 25, seed: 11, weather: 'steady', rogue: false, seaScale: 0.4 });
    env.wind.sample = (x, z, t, o = {}) => { o.speed = 0.3; o.dir = 0; o.puff = 0; o.cold = 0; return o; };
    env.tick(0);
    const W = env.waves, b = new Boat(cls, { sailModel: 'strip' });
    b.reset(0, 0, 90 * DEG);                     // heading east: the sea (from the north) on the port beam
    b.auto.hike = false; b.ctrl.hike = 0; b.ctrl.main = 1; b.ctrl.jib = 1;
    const dt = 1 / 120, tf = 40;
    // the boat drifts a little while the group gathers: aim the focus where it will be
    let t = 0, x15 = 0, z15 = 0;
    for (; t < 20; t += dt) { b.step(dt, env, t); if (t < 15) { x15 = b.x; z15 = b.z; } }
    W.forceEvent({ x: b.x + (b.x - x15) / 5 * (tf - t), z: b.z + (b.z - z15) / 5 * (tf - t), t: tf, crest: 0.6 * r * L });
    let maxRoll = 0, maxF = 0, hMax = -1e9, hMin = 1e9, hs = [];
    for (; t < tf + 25; t += dt) {
      b.step(dt, env, t); env.tick(t);
      if (t > tf - 12) { maxRoll = Math.max(maxRoll, Math.abs(b.phi)); maxF = Math.max(maxF, b.diag.brkF || 0); }
      if (Math.abs(t - tf) < 1.2 * Tp) { const s = W.sample(b.x, b.z, t, {}); hs.push([t, s.h]); }
      if (!isFinite(b.phi) || !isFinite(b.x)) { console.log('NaN'); fail++; break; }
    }
    // breaker height at the boat: its highest crest and the lowest trough before it
    let ic = 0; for (let i = 0; i < hs.length; i++) if (hs[i][1] > hs[ic][1]) ic = i;
    for (const [tt, h] of hs) if (Math.abs(tt - hs[ic][0]) < 0.75 * Tp) hMin = Math.min(hMin, h);
    hMax = hs[ic][1];
    const Hb = hMax - hMin;
    rows.push({ Hb, r: Hb / L, roll: maxRoll / DEG, F: maxF, Hs: W.Hs, Tp });
  }
  console.log(`${cls.padEnd(10)} LOA ${L.toFixed(2)} m  mass ${(new Boat(cls, { sailModel: 'strip' }).mass).toFixed(0)} kg`);
  for (const r of rows) console.log(`   breaker ${r.Hb.toFixed(2)} m = ${(100 * r.r).toFixed(0).padStart(3)} % LOA (sea Tp ${r.Tp.toFixed(1)} s)   roll ${r.roll.toFixed(0).padStart(4)} deg   jet ${(r.F / 1000).toFixed(1)} kN`);
  // the thresholds, to their order: under ~25 % LOA no knockdown, at 55 % and over laid flat, the masthead in the water
  // (88 deg and more: the floating mast and the sails in the sea hold a keelboat there, and whether the last degrees
  // go past 90 is a matter of how she lies to the crest; the heavy long-keeled Blackwatch stops at 90 since her yaw is
  // taken about her centre of gravity, js/physics.js)
  const low = rows.filter(r => r.r < 0.25), high = rows.filter(r => r.r >= 0.55);
  if (low.some(r => r.roll > 75)) { console.log('   FAIL: knocked flat by a breaker under 25 % LOA'); fail++; }
  if (high.length && !high.some(r => r.roll >= 88)) { console.log('   FAIL: no breaker over 55 % LOA laid it flat'); fail++; }
}
console.log(fail ? `FAIL (${fail})` : 'ok');
process.exit(fail ? 1 : 0);
