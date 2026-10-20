// The autopilot picking up a man overboard (js/autopilot.js pickUp): one of the crew goes over from a boat under way,
// the MOB mark is the waypoint, and the autopilot must bring her to a stop alongside them (js/mob.js recovers a
// person within reach with her nearly stopped). A report, not a gate: node test/mob-pickup.mjs [CLS=j24,dragon]
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { Environment, KT } from '../js/env.js';
import { Autopilot } from '../js/autopilot.js';
import { MOB } from '../js/mob.js';
import '../js/sail/sailsim.js';
const DEG = Math.PI / 180, DT = 1 / 120;
for (const cls of (process.env.CLS || 'j24,dragon,contessa32').split(',')) for (const [kn, sea, twa0] of [[14, false, 45], [22, true, 45], [14, true, 140]]) {
  const env = new Environment({ tws: kn * KT, twd: 0, seed: 5, weather: 'steady', fetchKm: 20, wavesOn: sea });
  env.tick(0);
  const b = new Boat(cls, { sailModel: 'strip' }); b.auto.trim = true; b.auto.hike = true;
  b.reset(0, 0, twa0 * DEG); b.u = 2.5;
  const ap = new Autopilot(b), sim = { boats: [b], world: null, env };
  for (let i = 0; i < 120 * 20; i++) { const t = i * DT; if (i % 12 === 0) env.tick(t); autoTrim(b, DT); b.step(DT, env, t); }
  const M = new MOB(b, { enabled: true }); b.mob = M; b.crewY = -1; M.drill(); M.events.length = 0;
  const mark = { x: M.mark.x, z: M.mark.z, kind: 'mob', label: 'MOB' };
  ap.engage(20); let t = 20, got = null, minD = 1e9;
  for (; t < 20 + 900; t += DT) {
    if (Math.round(t * 120) % 12 === 0) env.tick(t);
    ap.update(DT, t, sim, { target: mark });
    b.step(DT, env, t); M.post(DT, { env, t });
    const P = M.people[0]; if (P) minD = Math.min(minD, Math.hypot(P.x - b.x, P.z - b.z));
    if (M.events.some((e) => e.type === 'recovered')) { got = t - 20; break; }
  }
  console.log(`${cls.padEnd(10)} ${kn} kn ${sea ? 'sea ' : 'flat'} from ${twa0}°: ${got ? 'recovered in ' + got.toFixed(0) + ' s' : 'NOT recovered (closest ' + minD.toFixed(1) + ' m)'}`);
}
