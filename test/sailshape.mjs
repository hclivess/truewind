// Cloth sail shapes (js/sail/rigsim.js + cloth.js under the lattice's loads).
//  1. beating in 12 kn with the automatic crew: main depth, draft position and twist at the three heights
//  2. every string does what it does on a real boat (sign checks, one control moved, the rest held):
//     outhaul in -> flatter foot; cunningham on -> draft forward; backstay on -> flatter main, less headstay sag
//     (flatter jib); vang on -> less twist; jib car aft -> flatter jib foot, more jib twist
// Run: node test/sailshape.mjs [class]
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
import { attachSails } from '../js/sail/sailsim.js';
const KT = 0.514444, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const classes = process.argv[2] ? [process.argv[2]] : ['blackwatch', 'sportboat', 'dinghy', 'cat'];

// settle a boat close-hauled (heading and helm held), auto crew, then hold a set of controls and settle again
function settle(cls, set = null, secs = 14) {
  const env = makeSteadyEnv(12 * KT), b = new Boat(cls);
  attachSails(b, 'cloth', 0);
  const twa = cls === 'cat' ? 50 : 45;
  b.reset(0, 0, twa * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.15;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * secs; i++) {
    autoTrim(b, dt);
    if (set && i > 120 * 6) for (const k in set) b.ctrl[k] = set[k];
    b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
  }
  // average the shape over half a second (the cloth breathes)
  const acc = {};
  for (let i = 0; i < 60; i++) {
    autoTrim(b, dt); if (set) for (const k in set) b.ctrl[k] = set[k];
    b.step(dt, env, (120 * secs + i) * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
    for (const key in b.diag.shape) { const a = acc[key] || (acc[key] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]); b.diag.shape[key].forEach((o, k) => { a[k][0] += o.d / 60; a[k][1] += o.f / 60; a[k][2] += o.tw / 60; }); }
  }
  return { b, sh: acc };
}
const fmt = (a) => a.map(o => `${(o[0] * 100).toFixed(1)}%/${o[1].toFixed(2)}/${(o[2] / DEG).toFixed(0)}°`).join('  ');

for (const cls of classes) {
  const C = CLASSES[cls];
  const base = settle(cls);
  const m = base.sh.main;
  console.log(`${cls}: ${(base.b.u / KT).toFixed(2)} kn  main (depth/draft/twist at 17/50/82%) ${fmt(m)}${base.sh.jib ? '  jib ' + fmt(base.sh.jib) : ''}`);
  check(m[1][0] > 0.10 && m[1][0] < 0.14, `${cls}: mid main depth ${(m[1][0] * 100).toFixed(1)}% in 10-14%`);
  check(m[1][1] > 0.40 && m[1][1] < 0.50, `${cls}: mid main draft ${(m[1][1] * 100).toFixed(0)}% in 40-50%`);
  check(m[2][2] > 8 * DEG && m[2][2] < 15 * DEG, `${cls}: upper main twist ${(m[2][2] / DEG).toFixed(0)}° in 8-15°`);
  // sign checks: one control each way, from the auto crew's setting
  const pair = (k, lo, hi) => [settle(cls, { [k]: lo }), settle(cls, { [k]: hi })];
  {
    const [a, b] = pair('outhaul', 0.1, 0.9);
    check(b.sh.main[0][0] < a.sh.main[0][0], `${cls}: outhaul in flattens the foot (${(a.sh.main[0][0] * 100).toFixed(1)}% -> ${(b.sh.main[0][0] * 100).toFixed(1)}%)`);
  }
  {
    const [a, b] = pair('cunn', 0, 1);
    check(b.sh.main[1][1] < a.sh.main[1][1], `${cls}: cunningham pulls the draft forward (${(a.sh.main[1][1] * 100).toFixed(0)}% -> ${(b.sh.main[1][1] * 100).toFixed(0)}%)`);
  }
  {
    const [a, b] = pair('vang', 0.1, 0.9);
    check(b.sh.main[2][2] < a.sh.main[2][2], `${cls}: vang on closes the leech (twist ${(a.sh.main[2][2] / DEG).toFixed(0)}° -> ${(b.sh.main[2][2] / DEG).toFixed(0)}°)`);
  }
  if (C.hasBackstay) {
    const [a, b] = pair('backstay', 0, 1);
    check(b.sh.main[1][0] < a.sh.main[1][0], `${cls}: backstay flattens the main (${(a.sh.main[1][0] * 100).toFixed(1)}% -> ${(b.sh.main[1][0] * 100).toFixed(1)}%)`);
    if (a.sh.jib) check(b.sh.jib[1][0] < a.sh.jib[1][0], `${cls}: backstay takes the sag out of the jib (${(a.sh.jib[1][0] * 100).toFixed(1)}% -> ${(b.sh.jib[1][0] * 100).toFixed(1)}%)`);
  }
  if (base.sh.jib) {
    const [a, b] = pair('jibLead', 0.1, 0.9);
    check(b.sh.jib[0][0] < a.sh.jib[0][0] && b.sh.jib[2][2] > a.sh.jib[2][2], `${cls}: jib car aft flattens the foot and opens the leech (foot ${(a.sh.jib[0][0] * 100).toFixed(1)}% -> ${(b.sh.jib[0][0] * 100).toFixed(1)}%, twist ${(a.sh.jib[2][2] / DEG).toFixed(0)}° -> ${(b.sh.jib[2][2] / DEG).toFixed(0)}°)`);
  }
}
console.log(fails ? `${fails} FAILED` : 'all sail-shape checks passed');
process.exit(fails ? 1 : 0);
