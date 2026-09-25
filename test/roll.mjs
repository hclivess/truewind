// Roll steadiness with the automatic crew: heading locked, flat water, steady wind. A competent crew holds
// the boat steady; a self-excited roll (crew chasing the heel faster than they can move) pumps the rig and
// inflates the speed. Reports the heel swing (max-min over the last 20 s) and mean speed.
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
const KT = 0.514444, DEG = Math.PI / 180;
const classes = process.argv[2] ? [process.argv[2]] : Object.keys(CLASSES);
const dt = 1 / 120;
for (const cls of classes) for (const tws of [12, 20]) {
  const row = [];
  for (const twa of [45, 90, 150, 180]) {
    const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
    b.reset(0, 0, twa * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.3;
    let lo = 1e9, hi = -1e9, us = 0, n = 0;
    for (let i = 0; i < 120 * 60; i++) {
      autoTrim(b, dt); b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
      if (i > 120 * 40) { lo = Math.min(lo, b.phi); hi = Math.max(hi, b.phi); us += b.u; n++; }
    }
    row.push(`${twa}°: ${(us / n / KT).toFixed(1)} kn heel ${(lo / DEG).toFixed(0)}..${(hi / DEG).toFixed(0)}`);
  }
  console.log(`${cls.padEnd(10)} ${tws} kn | ${row.join(' | ')}`);
}
