// Truthful capsize: overpower a dinghy until it goes over, check it lies on its side, then right it.
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
const KT = 0.514444, DEG = Math.PI / 180;
const cls = process.argv[2] || 'dinghy';
const env = makeSteadyEnv(22 * KT);
const b = new Boat(cls); b.reset(0, 0, 60 * DEG); b.u = 3; for (const k in b.booms) b.booms[k].a = 0.3;
b.auto.hike = false; b.ctrl.hike = -1; b.ctrl.main = 0; b.ctrl.jib = 0; // sheets cleated hard in, weight to leeward
const dt = 1 / 120; let t = 0, capsAt = null;
for (let i = 0; i < 120 * 40; i++) {
  if (b.capsized && capsAt === null) { capsAt = t; }
  if (capsAt !== null && t > capsAt + 8 && !b.righting && Math.abs(b.phi) > 1) { b.righting = true; b.ctrl.main = 1; console.log('t', t.toFixed(1), 'crew onto the board'); }
  b.step(dt, env, t); t += dt;
  if (i % 240 === 0) console.log(`t ${t.toFixed(0).padStart(2)} heel ${(b.phi / DEG).toFixed(0).padStart(4)}°  u ${(b.u / KT).toFixed(1)} kn  capsized ${b.capsized} righting ${b.righting}  sails in water ${Object.values(b.diag.strips).flat().filter(s => s.inWater).length}`);
}
