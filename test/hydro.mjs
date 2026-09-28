import { CLASSES, Boat } from '../js/physics.js';
import { HullHydro } from '../js/hull.js';
const DEG = Math.PI / 180;
for (const id of Object.keys(CLASSES)) {
  const C = CLASSES[id]; const h = new HullHydro(C);
  const mass = C.massHull + C.crewN * C.crewEach;
  console.log(`${id}: fullness ${C._fullness.toFixed(2)} depth x${C._depthScale.toFixed(2)}  V ${h.restV.toFixed(3)} m3 (need ${(mass / 1025).toFixed(3)})  wetted ${h.restWetted.toFixed(1)} m2 (table ${C.wetted})  LWL ${h.restLwl.toFixed(2)} (spec ${C.lwl})`);
  // hydrostatic righting arm of the hull (no crew offset), with the boat re-floated at each heel
  const row = [];
  for (const phi of [5, 10, 20, 30, 45, 60, 75, 90]) {
    let z = 0; let r;
    for (let it = 0; it < 40; it++) { r = h.immerse(z, 0, phi * DEG, () => 0, () => 0, {}); z += (r.V - mass / 1025) / 8 * 0.6; }
    row.push(`${phi}°:${(-r.My / r.V).toFixed(2)}`);
  }
  console.log('   buoyancy lateral arm (m):', row.join(' '));
}

// Residuary resistance over the hump (js/classes/util.js rrOverHump): the Delft series on each drawn hull, against the
// two towing-tank references: the Laser's (Day & Nixon 2014, Rr/W with ITTC friction on the static wetted area) and the
// Blackwatch's own table; a displacement keelboat keeps climbing past Fn 0.6 (no planing plateau)
{
  const at = (t, x) => { for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [a, b] = t[i - 1], [c, d] = t[i]; return b + (d - b) * (x - a) / (c - a); } return t[t.length - 1][1]; };
  let fails = 0;
  const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
  for (const id of ['dinghy', 'blackwatch', 'j24']) new Boat(CLASSES[id], { sailModel: 'strip' });
  const L = CLASSES.dinghy._rr, tank = [[0.548, 0.056], [0.633, 0.070], [0.717, 0.079]];
  check(tank.every(([f, r]) => Math.abs(at(L, f) / r - 1) < 0.15), `Laser Rr/W ${tank.map(([f, r]) => `Fn ${f}: ${at(L, f).toFixed(3)} (tank ${r})`).join(', ')}`);
  const B = CLASSES.blackwatch;
  check([0.5, 0.55, 0.6].every((f) => Math.abs(at(B._rr, f) / at(B.rr, f) - 1) < 0.12), `Blackwatch Rr/W over the hump ${[0.5, 0.55, 0.6].map((f) => `${at(B._rr, f).toFixed(3)} (towing tank ${at(B.rr, f).toFixed(3)})`).join(', ')}`);
  const J = CLASSES.j24._rr;
  check(at(J, 0.6) > 0.1 && at(J, 0.7) >= at(J, 0.6) && at(J, 1.0) >= at(J, 0.7), `J/24 Rr/W climbs past the hump: ${[0.5, 0.6, 0.7, 1.0].map((f) => at(J, f).toFixed(3)).join(', ')} at Fn 0.5, 0.6, 0.7, 1.0`);
  console.log(fails ? `${fails} resistance check(s) FAILED` : 'all resistance checks passed');
  if (fails) process.exitCode = 1;
}
