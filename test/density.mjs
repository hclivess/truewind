// Air density under a squall: the rain-cooled outflow (env wind sample .cold = 1) is ~9 K colder, so the
// same wind speed pushes ~3% harder on the sails and windage. Same boat, same state, one step each.
import { Boat, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
const KT = 0.514444, DEG = Math.PI / 180;
let bad = 0;
for (const cls of ['blackwatch', 'sportboat', 'dinghy', 'cat']) {
  // (a cloth sail luffs and breathes, and two runs a little apart in density soon differ by more than the density
  // does: so two boats sail in lockstep in the same air for 1.5 s, then the air of one turns cold, and the force is
  // compared on that step, the sails' shapes still identical; summed over four headings)
  const res = [{ F: 0, rho: 0 }, { F: 0, rho: 0 }];
  for (const hdg of [50, 60, 70, 80]) {
    const cold = [0, 0], boats = [0, 1].map((k) => {
      const env = makeSteadyEnv(15 * KT), base = env.wind.sample;
      env.wind.sample = (x, z, t, o) => { base(x, z, t, o); o.cold = cold[k]; return o; };
      const b = new Boat(cls); b.reset(0, 0, hdg * DEG); b.u = 2; for (const kk in b.booms) b.booms[kk].a = 0.35;
      return { b, env };
    });
    for (let i = 0; i <= 180; i++) {
      if (i === 180) cold[1] = 1;
      for (const { b, env } of boats) { b.step(1 / 120, env, i / 120); b.u = 2; b.v = 0; b.r = 0; b.p = 0; b.phi = 0; b.psi = hdg * DEG; }
    }
    // (the air's force on the sails, before the cloth takes any of it up in its own motion)
    boats.forEach(({ b }, k) => { for (const s of b.sails) res[k].F += b.diag.strips[s.key].F || 0; res[k].rho = b.diag.rhoA; });
  }
  const r = res[1].F / res[0].F;
  if (!(r > 1.02 && r < 1.05)) bad++;
  console.log(`${cls.padEnd(10)} rho ${res[0].rho.toFixed(3)} -> ${res[1].rho.toFixed(3)} kg/m3  sail force x${r.toFixed(3)}`);
}
process.exit(bad ? 1 : 0);
