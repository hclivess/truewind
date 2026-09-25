// Stiffness guard: a boat lying capsized with its sails in the water, shoved sideways and spun, must damp
// out (the wet-rig sway/yaw drag is integrated implicitly), never blow up to Infinity/NaN, at 60 and 120 Hz.
import { Boat, makeSteadyEnv } from '../js/physics.js';
const KT = 0.514444, DEG = Math.PI / 180;
let bad = 0;
for (const cls of ['cat', 'dinghy']) for (const hz of [60, 120]) {
  const env = makeSteadyEnv(18 * KT), b = new Boat(cls), dt = 1 / hz;
  b.reset(0, 0, 60 * DEG); b.phi = 100 * DEG; b.u = 1;
  let maxV = 0;
  for (let i = 0; i < hz * 20; i++) { b.step(dt, env, i * dt); b.phi = 100 * DEG; b.p = 0; if (i === hz * 5) { b.v = 8; b.r = 3; } if (i > hz * 8) maxV = Math.max(maxV, Math.abs(b.v), Math.abs(b.r)); }
  const ok = [b.u, b.v, b.r, b.p, b.phi, b.pitch, b.heave].every(Number.isFinite) && maxV < 5;
  if (!ok) bad++;
  console.log(`${cls.padEnd(7)} ${hz} Hz: heel ${(b.phi / DEG).toFixed(0)}°  |v|,|r| max 3 s after a shove ${maxV.toFixed(2)}  ${ok ? 'ok' : 'BLEW UP'}`);
}
process.exit(bad ? 1 : 0);
