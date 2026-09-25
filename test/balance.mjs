// Helm balance: yaw moment from sails+keel+hull at steady close-hauled, rudder centred.
// Negative (for this port-tack setup) = weather helm (bow wants to round up).
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
const KT = 0.514444, DEG = Math.PI / 180;
const tws = +(process.argv[2] ?? 12);
for (const cls of Object.keys(CLASSES)) for (const twa of [45, 90]) {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
  b.reset(0, 0, twa * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.3;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 40; i++) { autoTrim(b, dt); b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0; }
  const d = b.diag, Nn = d.Nsail + d.Nkeel + d.Nhull;
  // rudder angle that would balance it (small-angle): N_rudder per degree
  console.log(`${cls.padEnd(10)} TWA ${twa}  bsp ${(b.u / KT).toFixed(1)}  heel ${(b.phi / DEG).toFixed(0)}°  N sail ${d.Nsail.toFixed(0)}  keel ${d.Nkeel.toFixed(0)}  hull ${d.Nhull.toFixed(0)} (munk ${(d.Nmunk ?? 0).toFixed(0)})  net ${Nn.toFixed(0)} ${Nn < 0 ? '(weather helm)' : '(LEE helm)'}`);
}
