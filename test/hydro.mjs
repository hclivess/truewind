import { CLASSES } from '../js/physics.js';
import { HullHydro } from '../js/hull.js';
const DEG = Math.PI / 180;
for (const id of Object.keys(CLASSES)) {
  const C = CLASSES[id]; const h = new HullHydro(C);
  const mass = C.massHull + C.crewN * C.crewEach;
  console.log(`${id}: depthScale ${C._depthScale.toFixed(2)}  V ${h.restV.toFixed(3)} m3 (need ${(mass / 1025).toFixed(3)})  wetted ${h.restWetted.toFixed(1)} m2 (table ${C.wetted})  LWL ${h.restLwl.toFixed(2)} (spec ${C.lwl})`);
  // hydrostatic righting arm of the hull (no crew offset), with the boat re-floated at each heel
  const row = [];
  for (const phi of [5, 10, 20, 30, 45, 60, 75, 90]) {
    let z = 0; let r;
    for (let it = 0; it < 40; it++) { r = h.immerse(z, 0, phi * DEG, () => 0, () => 0, {}); z += (r.V - mass / 1025) / 8 * 0.6; }
    row.push(`${phi}°:${(-r.My / r.V).toFixed(2)}`);
  }
  console.log('   buoyancy lateral arm (m):', row.join(' '));
}
