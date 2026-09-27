// Man overboard (js/mob.js): drift of a person in the water, recovery alongside, the crew's weight off the rail,
// a single-hander swimming for the boat, and the deterministic draw. node test/mob.mjs   (non-zero exit on failure)
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { MOB, PIW_LEEWAY, SWIM } from '../js/mob.js';
import { hash01 } from '../js/damage.js';
const KT = 0.514444, DEG = Math.PI / 180, G = 9.81;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const dt = 1 / 120;
const envOf = (kn, cur = [0, 0]) => {
  const e = makeSteadyEnv(kn * KT);
  e.current = { at: (x, z, o) => { o.x = cur[0]; o.z = cur[1]; return o; } };
  return e;
};

// ---------------------------------------------------------------- 1. drift
console.log('1. A person in the water drifts with the current and ~1.1% of the wind (USCG leeway, person in water)');
{
  const env = envOf(20, [0.3, 0]);                      // 20 kn from the north (blowing south, +z), 0.3 m/s set to the east
  const b = new Boat('blackwatch', { sailModel: 'strip' }); b.reset(0, 0, 90 * DEG);
  const M = new MOB(b); M.drill();
  const P = M.people[0], x0 = P.x, z0 = P.z;
  b.x = 500; b.z = 500;                                  // the boat is far away (no recovery)
  const T = 600;
  for (let i = 0; i < T / dt; i++) M.post(dt, { env, t: i * dt });
  const ex = 0.3 * T, ez = PIW_LEEWAY * 20 * KT * T;
  check(Math.abs(P.x - x0 - ex) < 0.05 * ex && Math.abs(P.z - z0 - ez) < 0.05 * ez, `after 10 min: ${(P.x - x0).toFixed(0)} m east (current ${ex.toFixed(0)} m), ${(P.z - z0).toFixed(0)} m downwind (leeway ${ez.toFixed(0)} m)`);
}

// ---------------------------------------------------------------- 2. recovery and the crew's weight
console.log('\n2. Recovery alongside; the crew\'s weight is off the boat meanwhile');
{
  const env = envOf(14);
  const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG); b.u = 2;
  const M = new MOB(b);
  const m0 = b.mass, c0 = b.crewMass;
  // the crew's weight on the rail in 14 kn before and after one goes over
  const rm = () => { let s = 0, n = 0; for (let i = 0; i < 20 / dt; i++) { autoTrim(b, dt, 0, true); b.step(dt, env, i * dt); b.psi = 60 * DEG; b.r = 0; if (i > 10 / dt) { s += b.crewMass * G * Math.abs(b.crewY); n++; } } return s / n; };
  const RM0 = rm();
  M.drill();
  check(b.crewMass === c0 - b.cls.crewEach && Math.abs(b.mass - (m0 - b.cls.crewEach)) < 1e-6, `one of ${b.cls.crewN} over the side: crew ${c0} -> ${b.crewMass} kg, boat ${Math.round(m0)} -> ${Math.round(b.mass)} kg`);
  const RM1 = rm();
  check(RM1 < RM0 * 0.9, `crew righting moment on the rail: ${Math.round(RM0)} -> ${Math.round(RM1)} N m`);
  // sailing past at 3 kn within 2 m does not pick them up; stopped alongside does
  const P = M.people[0];
  b.x = P.x + 1.5; b.z = P.z; b.u = 3 * KT; b.v = 0; b.vgx = 0; b.vgz = -3 * KT;
  for (let i = 0; i < 1 / dt; i++) M.post(dt, { env, t: 0 });
  check(M.people.length === 1, 'passing at 3 kn within 2 m: not recovered');
  b.u = 0.2; b.vgx = 0; b.vgz = 0.2;
  let t = 0;
  while (M.people.length && t < 30) { b.x = P.x + 1.5; b.z = P.z; M.post(dt, { env, t }); t += dt; }
  check(M.people.length === 0 && b.crewMass === c0, `stopped 1.5 m off: recovered after ${t.toFixed(1)} s, crew ${b.crewMass} kg aboard`);
}

// ---------------------------------------------------------------- 3. the single-hander
console.log('\n3. A single-hander in the water swims for the boat');
{
  // capsized, the boat lies with the rig in the water and drifts slower than a swimmer: caught
  const env = envOf(16);
  const b = new Boat('dinghy', { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG);
  b.phi = 85 * DEG; b.u = 0;
  const M = new MOB(b); M.drill();
  check(b.unmanned === true, 'the sailor is in the water: the boat is unmanned (no helm, no trim)');
  let t = 0;
  while (M.people.length && t < 120) { b.step(dt, env, t); M.post(dt, { env, t }); t += dt; }
  check(!M.people.length && !b.unmanned, `capsized dinghy drifting at ${Math.hypot(b.vgx, b.vgz).toFixed(2)} m/s: reached and back aboard after ${t.toFixed(0)} s (swimming ${SWIM} m/s)`);
  // upright and sailing away with the sheet cleated: she luffs up and stops, or she is gone
  const e2 = envOf(16);
  const c = new Boat('dinghy', { sailModel: 'strip' }); c.reset(0, 0, 100 * DEG); c.u = 3;
  for (let i = 0; i < 10 / dt; i++) { autoTrim(c, dt, 0, true); c.step(dt, e2, i * dt); }
  const M2 = new MOB(c); M2.drill();
  let t2 = 0, dmax = 0;
  while (M2.people.length && t2 < 300) { c.ctrl.helm *= Math.exp(-dt / 2); c.step(dt, e2, t2); M2.post(dt, { env: e2, t: t2 }); t2 += dt; if (M2.people.length) dmax = Math.max(dmax, Math.hypot(c.x - M2.people[0].x, c.z - M2.people[0].z)); }
  console.log(`     thrown out of an upright Laser on a reach: the boat got ${dmax.toFixed(0)} m away; ${M2.people.length ? 'not caught in 5 minutes' : `back aboard after ${t2.toFixed(0)} s`}`);
}

// ---------------------------------------------------------------- 4. the draw is deterministic
console.log('\n4. Who goes over is a deterministic draw (seeded), at the modelled rate');
{
  const draw = (seed) => { const b = new Boat('sportboat', { sailModel: 'strip' }); b.crewY = -1; const M = new MOB(b, { seed }); M.throwCrew(3, 'knockdown'); return M.people.length; };
  check(draw(7) === draw(7) && draw(12345) === draw(12345), `same seed, same outcome (seed 7: ${draw(7)} over, seed 12345: ${draw(12345)} over)`);
  let n = 0; const N = 4000;
  for (let s = 0; s < N; s++) if (hash01(s, 1, 0) < 0.1) n++;
  check(Math.abs(n / N - 0.1) < 0.015, `hash draw rate at p = 0.1: ${(n / N).toFixed(3)}`);
  let over = 0, trials = 400;
  for (let s = 0; s < trials; s++) over += draw(s);
  console.log(`     knockdown at 3 rad/s with 4 crew hiking: ${(over / trials).toFixed(2)} overboard per knockdown`);
  check(over > 0 && over / trials < 1.5, '  some go over, not everyone');
  const gentle = (() => { let o = 0; for (let s = 0; s < trials; s++) { const b = new Boat('sportboat', { sailModel: 'strip' }); b.crewY = 0; const M = new MOB(b, { seed: s }); M.throwCrew(0.9, 'knockdown'); o += M.people.length; } return o; })();
  check(gentle / trials < 0.05, `  a gentle roll (0.9 rad/s) with the crew in: ${(gentle / trials).toFixed(3)} per event`);
}
console.log(`\n${fails ? fails + ' check(s) FAILED' : 'all MOB checks passed'}`);
process.exit(fails ? 1 : 0);
