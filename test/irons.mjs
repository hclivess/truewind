// Out of irons: each boat dead head to wind and stopped (u = 0) in 12 kn, the autopilot engaged with no waypoint (it
// holds a close-hauled angle). A sloop backs its jib; a una rig (Sunfish, Laser, Optimist, 49er's main alone has a
// jib, so not it) has its boom pushed out to backwind the sail; going astern the rudder works backwards; once she has
// paid off ~50 deg the sail is let go, sheeted in, and she bears away to build speed before pointing.
// Pass: within 20 s she is out of the no-go zone (within 5 deg of her close-hauled angle or further off) and making
// 0.5 m/s or more ahead, and by 40 s sailing close-hauled
// (within 15 deg of her angle) at a third of her polar's speed or more.   CLASSES=sunfish,... : a subset.
import { Boat, solvePolar, vmgTargets, makeSteadyEnv, autoTrim, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { Autopilot } from '../js/autopilot.js';
const KT = 0.514444, DEG = Math.PI / 180, DT = 1 / 120;
const LIST = (process.env.CLASSES || 'sunfish,dinghy,optimist,catalina30,sportboat,j24').split(',');
const world = new World(VENUES.find((v) => v.id === 'open'), null);
let bad = 0;
for (const cls of LIST) {
  await loadBakedPolars(cls);
  const tws = 12 * KT, vt = vmgTargets(solvePolar(cls, tws));
  const env = makeSteadyEnv(tws), b = new Boat(cls, { id: 0, lod: 1 });
  b.reset(0, 0, 0);                                  // (the wind from the north, twd 0: heading 0 is head to wind)
  for (let i = 0; i < 240; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0, world); b.x = 0; b.z = 0; b.psi = 0; b.r = 0; b.u = 0; b.v = 0; }
  const ap = new Autopilot(b); ap.helm.targetsUpBsp = vt.up.bsp; ap.helm.upAngle = vt.up.twa * DEG;
  const sim = { boats: [b], world, env };
  ap.engage(0);
  let t = 0, out = null, sailing = null, minU = 0;
  for (let i = 0; i < 40 / DT; i++, t += DT) {
    ap.update(DT, t, sim, { targets: { up: vt.up.twa, dn: vt.dn.twa } });
    b.step(DT, env, t, world);
    const twa = Math.abs(wrap(0 - b.psi));
    minU = Math.min(minU, b.u);
    if (out === null && twa > vt.up.twa * DEG - 5 * DEG && b.u > 0.5) out = t;
    if (process.env.V && i % 60 === 0) console.log(`    ${t.toFixed(1)} twa ${(wrap(0 - b.psi) / DEG).toFixed(0)} u ${b.u.toFixed(2)} r ${(b.r / DEG).toFixed(1)} helm ${b.ctrl.helm.toFixed(2)} rud ${(b.rudder / DEG).toFixed(0)} push ${b.ctrl.pushBoom} boom ${(b.booms.main.a / DEG).toFixed(0)} main ${b.ctrl.main.toFixed(2)} backing ${ap.helm.backing} build ${ap.helm.building}`);
    if (sailing === null && Math.abs(twa - vt.up.twa * DEG) < 15 * DEG && b.u > vt.up.bsp / 3) sailing = t;
  }
  const ok = out !== null && out <= 20 && sailing !== null;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${cls.padEnd(11)} out of irons and moving in ${out === null ? 'never' : out.toFixed(1) + ' s'}, sailing close-hauled at ${sailing === null ? 'never' : sailing.toFixed(1) + ' s'} (astern at most ${(-minU).toFixed(2)} m/s; at 40 s ${(Math.abs(wrap(0 - b.psi)) / DEG).toFixed(0)} deg, ${b.u.toFixed(2)} m/s)`);
}
console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
