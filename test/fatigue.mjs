// Crew fatigue (js/fatigue.js): hiking endurance on Rohmert's curve, recovery, the work reserve (critical power)
// and what it does to the boat. node test/fatigue.mjs   (non-zero exit on failure)
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { Fatigue, rohmert, CP, WPRIME, FC } from '../js/fatigue.js';
const KT = 0.514444, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const dt = 1 / 120;

console.log('1. Rohmert endurance of an isometric hold');
for (const [f, lo, hi] of [[0.45, 60, 100], [0.3, 130, 170], [0.2, 350, 420]]) { const T = rohmert(f); check(T > lo && T < hi, `${Math.round(f * 100)}% MVC: ${Math.round(T)} s`); }
check(rohmert(FC) === Infinity, `${Math.round(FC * 100)}% MVC and below: sustainable`);

console.log('\n2. A Laser hiked flat out upwind in 18 kn');
{
  const env = makeSteadyEnv(18 * KT);
  const b = new Boat('dinghy', { sailModel: 'strip' }); b.reset(0, 0, 45 * DEG); b.u = 2;
  const F = new Fatigue(b);
  let t = 0, t20 = null; const log = [];
  let heel0 = 0, heel1 = 0, n0 = 0, n1 = 0, u0 = 0, u1 = 0;
  for (let i = 0; i < 600 / dt; i++) {
    autoTrim(b, dt, 0, true); b.step(dt, env, t); b.psi = 45 * DEG; b.r = 0; F.post(dt); t += dt;
    if (t20 === null && F.R < 0.2) t20 = t;
    if (i % (60 / dt) === 0) log.push(`${Math.round(t)}s R ${F.R.toFixed(2)} out ${(Math.abs(b.crewY) / b.cls.crewMaxOut * 100).toFixed(0)}% heel ${(b.phi / DEG).toFixed(0)}°`);
    if (t > 20 && t < 40) { heel0 += Math.abs(b.phi); u0 += b.u; n0++; }
    if (t > 560) { heel1 += Math.abs(b.phi); u1 += b.u; n1++; }
  }
  console.log('     ' + log.join(' | '));
  check(t20 !== null && t20 > 45 && t20 < 400, `full hike is spent in ${t20 ? Math.round(t20) : '>600'} s (minutes, not hours)`);
  check(b.hikeLimit > 0.35 && b.hikeLimit < 0.7, `after 10 minutes she settles at a depth the sailor can hold for ever (~15% MVC): hike limited to ${Math.round(b.hikeLimit * 100)}% (reserve ${Math.round(F.R * 100)}%)`);
  check(heel1 / n1 > heel0 / n0 || u1 / n1 < u0 / n0, `fresh: heel ${(heel0 / n0 / DEG).toFixed(1)}°, ${(u0 / n0 / KT).toFixed(2)} kn; tired: heel ${(heel1 / n1 / DEG).toFixed(1)}°, ${(u1 / n1 / KT).toFixed(2)} kn`);
  // rest (sitting in on a run): the legs come back
  b.auto.hike = false; b.ctrl.hike = 0;
  let tr = 0; while (F.R < 0.8 && tr < 600) { b.crewY = 0; F.post(dt); tr += dt; }
  check(tr < 240, `sitting in: back to 80% in ${Math.round(tr)} s`);
}

console.log('\n3. A trapeze and a cruiser\'s rail are sustainable');
for (const cls of ['cat', 'blackwatch']) {
  const b = new Boat(cls, { sailModel: 'strip' }); const F = new Fatigue(b);
  b.diag.awaMid = 0.8; b.crewY = b.cls.crewMaxOut;
  for (let i = 0; i < 1200 / dt; i++) F.post(dt);
  check(F.R > 0.95, `${cls}: 20 minutes fully out, reserve ${Math.round(F.R * 100)}% (${Math.round(F.f * 100)}% MVC)`);
}

console.log('\n4. Grinding: the work reserve above critical power');
{
  const b = new Boat('sportboat', { sailModel: 'strip' }); const F = new Fatigue(b);
  let t = 0;
  while (F.W > 0 && t < 600) { F.post(dt, 2 * (CP + 150)); t += dt; }       // two grinders at CP + 150 W each
  check(Math.abs(t - WPRIME / 150) < 5, `two grinders at ${CP + 150} W each: W' (${WPRIME / 1000} kJ) gone in ${Math.round(t)} s; sheets now come in at ${Math.round(b.crewPower * 100)}% speed`);
  let tr = 0; while (F.W < 0.9 * WPRIME && tr < 3600) { F.post(dt, 0); tr += dt; }
  check(tr > 300 && tr < 1800, `resting: 90% back in ${Math.round(tr)} s (Skiba)`);
  // a tired crew trims slower: the same ease takes longer to haul back in
  const env = makeSteadyEnv(26 * KT);
  const haul = (power) => {
    const c = new Boat('sportboat', { sailModel: 'strip' }); c.reset(0, 0, 50 * DEG); c.u = 3;
    for (let i = 0; i < 20 / dt; i++) { autoTrim(c, dt, 0, true); c.step(dt, env, i * dt); c.psi = 50 * DEG; c.r = 0; }
    c.crewPower = power; c.ctrl.main = 0; c.lines.main = 0.6;
    let i = 0; while (c.lines.main > 0.05 && i < 30 / dt) { c.ctrl.main = 0; c.step(dt, env, i * dt); c.psi = 50 * DEG; c.r = 0; i++; }
    if (power === 1) console.log(`     (mainsheet load ${Math.round(c.diag.rig.mainLoad)} N, the crew's pull ${c.cls.sheetPower} N fresh)`);
    return i * dt;
  };
  const tf = haul(1), tt = haul(0.55);
  check(tt > tf * 1.2, `hauling the main in under load: ${tf.toFixed(1)} s fresh, ${tt.toFixed(1)} s spent`);
}
console.log(`\n${fails ? fails + ' check(s) FAILED' : 'all fatigue checks passed'}`);
process.exit(fails ? 1 : 0);
