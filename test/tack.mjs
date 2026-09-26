// Tack & gybe test: steady on a heading, then hold the helm over and record the heading trace.
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
const KT = 0.514444, DEG = Math.PI / 180;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const [cls = 'blackwatch', tws = 14, man = 'tack'] = process.argv.slice(2);
const env = makeSteadyEnv(+tws * KT);
const b = new Boat(cls);
const start = man === 'tack' ? 45 : 150; // wind from north (0); TWA on port tack (wind over port side)
b.reset(0, 0, start * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.3;
const dt = 1 / 120;
for (let i = 0; i < 120 * 40; i++) { autoTrim(b, dt); b.step(dt, env, i * dt); b.r = 0; b.psi = start * DEG; b.rudder = 0; }
console.log(`${cls} ${tws} kn ${man}: start bsp ${(b.u / KT).toFixed(2)} kn, TWA ${start}`);
const helmMag = +(process.argv[5] ?? 1); const helm = (man === 'tack' ? -1 : 1) * helmMag; const backJib = process.argv[6] === 'back'; // tack: turn to port through the wind; gybe: turn to starboard through dead downwind
let t = 0, crossed = null;
for (let i = 0; i < 120 * 30; i++) {
  b.ctrl.helm = helm;
  if (process.argv[7] !== 'manual') autoTrim(b, dt);
  b.step(dt, env, t); t += dt;
  const twa = wrap(0 - b.psi) / DEG;
  if (crossed === null && ((man === 'tack' && twa > 0) || (man === 'gybe' && twa > 0 && twa < 179))) crossed = t;
  if (i % 60 === 0 && t < 9) console.log(`t ${t.toFixed(0).padStart(2)}  hdg ${(b.psi / DEG).toFixed(0).padStart(4)}  twa ${twa.toFixed(0).padStart(4)}  bsp ${(b.u / KT).toFixed(2)}  rud ${(b.rudder / DEG).toFixed(0)}  r ${(b.r / DEG).toFixed(1)}°/s  boom ${(b.booms.main.a / DEG).toFixed(0)}  jibSide ${b.side.jib.toFixed(2)} | N sail ${b.diag.Nsail.toFixed(0)} keel ${b.diag.Nkeel.toFixed(0)} rud ${b.diag.Nrud.toFixed(0)} hull ${b.diag.Nhull.toFixed(0)} | rudα ${(b.diag.rudAlpha/DEG).toFixed(0)} eps ${(b.diag.eps/DEG).toFixed(0)} keelCl ${b.diag.keelCl.toFixed(2)} v ${b.v.toFixed(2)}`);
}
console.log(crossed !== null ? `crossed the wind after ${crossed.toFixed(1)} s` : 'NEVER CROSSED');
