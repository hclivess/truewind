// Air density under a squall: the rain-cooled outflow (env wind sample .cold = 1) is ~9 K colder, so the
// same wind speed pushes ~3% harder on the sails and windage. Same boat, same state, one step each.
import { Boat, makeSteadyEnv } from '../js/physics.js';
const KT = 0.514444, DEG = Math.PI / 180;
let bad = 0;
for (const cls of ['blackwatch', 'sportboat', 'dinghy', 'cat']) {
  const res = [];
  for (const cold of [0, 1]) {
    const env = makeSteadyEnv(15 * KT), base = env.wind.sample;
    env.wind.sample = (x, z, t, o) => { base(x, z, t, o); o.cold = cold; return o; };
    const b = new Boat(cls); b.reset(0, 0, 60 * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.35;
    b.step(1 / 120, env, 0);
    res.push({ F: Math.hypot(b.diag.sailX, b.diag.sailY), rho: b.diag.rhoA });
  }
  const r = res[1].F / res[0].F;
  if (!(r > 1.02 && r < 1.05)) bad++;
  console.log(`${cls.padEnd(10)} rho ${res[0].rho.toFixed(3)} -> ${res[1].rho.toFixed(3)} kg/m3  sail force x${r.toFixed(3)}`);
}
process.exit(bad ? 1 : 0);
