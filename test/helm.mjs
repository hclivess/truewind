// Helm balance as a sailor feels it: the rudder angle that holds a steady course (net yaw moment zero,
// rudder included), heading locked, flat water, steady wind, auto crew. + = weather helm (tiller to
// windward, blade turning the bow away from the wind). Real boats are designed for ~2-4° upwind.
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
const KT = 0.514444, DEG = Math.PI / 180;
const tws = +(process.argv[2] ?? 12);
const classes = process.argv[3] ? [process.argv[3]] : Object.keys(CLASSES);
for (const cls of classes) {
  const row = [];
  for (const twa of [45, 90, 135]) {
    const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
    b.reset(0, 0, twa * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.3;
    const dt = 1 / 120; let delta = 0, acc = 0, n = 0;
    for (let i = 0; i < 120 * 50; i++) {
      autoTrim(b, dt);
      b.rudder = delta; b.step(dt, env, i * dt);
      b.r = 0; b.psi = twa * DEG;
      // port tack (wind over the port bow): a weather-helm boat needs the blade turned to push the bow to starboard
      delta = Math.max(-0.5, Math.min(0.5, delta - b.diag.N / (b.Izz * 2) * dt * 40));
      if (i > 120 * 40) { acc += delta; n++; }
    }
    const helm = acc / n;
    // a boat that rounds up (weather helm) needs rudder that turns the bow to starboard here: + rudder
    row.push(`${twa}°: ${(b.u / KT).toFixed(1)} kn helm ${(helm / DEG).toFixed(1)}° (Munk ${(b.diag.Nmunk ?? 0).toFixed(0)} N·m)`);
  }
  console.log(`${cls.padEnd(10)} ${tws} kn | ${row.join(' | ')}`);
}
