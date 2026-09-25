// Heavy air in a real sea (puffs, shifts, fetch-limited waves): the player's case — spawn on a beam
// reach, crew presets the trim, then the helm is left centred and nothing is touched.
import { Environment, KT, DEG } from '../js/env.js';
import { Boat, autoTrim } from '../js/physics.js';
const [cls = 'blackwatch', tws = 40, mode = 'manual', secs = 120, seed = 7, warp = 1] = process.argv.slice(2);
const env = new Environment({ tws: +tws * KT, twd: 0, gust: 0.5, shift: 7, fetchKm: 8, seed: +seed, weather: 'steady' });
const b = new Boat(cls);
b.reset(0, 0, 90 * DEG); b.u = 1.2;
env.tick(0);
for (let i = 0; i < 240; i++) { autoTrim(b, 1 / 60, 0, true); b.step(1 / 60, env, 0); b.psi = 90 * DEG; b.r = 0; }
b.x = 0; b.z = 0; b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.stay = b.ctrl.stay; b.lines.lazy = b.ctrl.lazy = 1;
const dt = 1 / 120; let t = 0, maxHeel = 0, stalled = 0, n = 0, uSum = 0;
for (let i = 0; i < 120 * +secs; i++) {
  if (mode === 'auto') autoTrim(b, dt);
  b.step(dt, env, t); t += dt; env.tick(t); maxHeel = Math.max(maxHeel, Math.abs(b.phi));
  const d = b.diag;
  if (Math.abs(d.leeway) > 45 * DEG) stalled += dt;
  uSum += b.u; n++;
  if (i % (+process.env.EVERY || 600) === 0) console.log(`t ${t.toFixed(0).padStart(3)} tws ${(d.tws / KT).toFixed(0)} hdg ${(b.psi / DEG).toFixed(0).padStart(4)} twa ${(d.twa / DEG).toFixed(0).padStart(4)} u ${(b.u / KT).toFixed(2).padStart(5)} v ${(b.v / KT).toFixed(2).padStart(5)} lee ${(d.leeway / DEG).toFixed(0).padStart(3)} heel ${(b.phi / DEG).toFixed(0).padStart(3)} r ${(b.r / DEG).toFixed(1)} | X sail ${d.sailX.toFixed(0)} wind ${d.windX.toFixed(0)} fk ${d.fkX.toFixed(0)} rudX ${d.rudderX.toFixed(0)} Xtot ${d.X.toFixed(0)} Raw ${d.Raw.toFixed(0)} keelX ${d.keelX.toFixed(0)} Rr ${d.Rr.toFixed(0)} main ${b.lines.main.toFixed(2)} jib ${b.lines.jib.toFixed(2)} stay ${b.lines.stay.toFixed(2)} boom ${(b.booms.main.a/DEG).toFixed(0)} jside ${b.side.jib.toFixed(1)} | N sail ${d.Nsail.toFixed(0)} keel ${d.Nkeel.toFixed(0)} rud ${d.Nrud.toFixed(0)} hull ${d.Nhull.toFixed(0)} vent ${d.rudderVent.toFixed(2)} Hs ${env.waves.Hs.toFixed(2)}`);
}
console.log(`max heel ${(maxHeel / DEG).toFixed(0)}°, time with leeway>45°: ${stalled.toFixed(0)} s, mean u ${(uSum / n / KT).toFixed(2)} kn`);
