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
function settle(cls, set = null, secs = null, twa0 = null) {
  // (a heavy boat takes longer to come up to speed and settle: ~14 s for the light ones, up to 40 s for a 15 t boat)
  const Cc = CLASSES[cls]; secs = secs ?? Math.round(Math.max(14, Math.min(40, 6 + (Cc.massHull + Cc.crewN * Cc.crewEach) / 400)));
  const env = makeSteadyEnv(12 * KT), b = new Boat(cls);
  attachSails(b, 'cloth', 0);
  const twa = twa0 ?? (cls === 'cat' ? 50 : 45);
  b.reset(0, 0, twa * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.15;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * secs; i++) {
    autoTrim(b, dt);
    if (set && i > 120 * secs * 0.43) for (const k in set) b.ctrl[k] = set[k];
    b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
  }
  // average the shape over three seconds (the cloth breathes: a fully battened main sheeted hard, its leech held by the
  // sheet alone, the Hobie's, opens and closes over a couple of seconds)
  const acc = {};
  for (let i = 0; i < 360; i++) {
    autoTrim(b, dt); if (set) for (const k in set) b.ctrl[k] = set[k];
    b.step(dt, env, (120 * secs + i) * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
    for (const key in b.diag.shape) { const a = acc[key] || (acc[key] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]); b.diag.shape[key].forEach((o, k) => { a[k][0] += o.d / 360; a[k][1] += o.f / 360; a[k][2] += o.tw / 360; }); }
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
  // (an una-rig on an unstayed bendy mast (no traveller) twists more: its tip bends aft and to leeward under load and
  // the head falls off, the rig's automatic depower. Held to 11 degrees by the vang, the dinghy sailed 12% faster
  // upwind in 12 kn than a Laser does (VMG 4.1 kn against ~3.6): 8-22 degrees there)
  const twMax = C.sails.find((x) => x.key === 'main').trav ? 15 : 22;
  check(m[2][2] > 8 * DEG && m[2][2] < twMax * DEG, `${cls}: upper main twist ${(m[2][2] / DEG).toFixed(0)}° in 8-${twMax}°`);
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
  if (C.sails.find((x) => x.key === 'main').vang !== 'none') {           // (the cat has no vang)
    // (on a reach: close-hauled, a main sheeted hard in over a car under the boom (the Blackwatch's end-boom sheet)
    // has its leech held by the sheet and the vang hangs slack, as on the real boat; eased, the vang holds it)
    const [a, b] = [settle(cls, { vang: 0.1 }, 14, 90), settle(cls, { vang: 0.9 }, 14, 90)];
    check(b.sh.main[2][2] < a.sh.main[2][2], `${cls}: vang on closes the leech (twist ${(a.sh.main[2][2] / DEG).toFixed(0)}° -> ${(b.sh.main[2][2] / DEG).toFixed(0)}°)`);
  }
  if (C.hasBackstay) {
    const [a, b] = pair('backstay', 0, 1);
    check(b.sh.main[1][0] < a.sh.main[1][0], `${cls}: backstay flattens the main (${(a.sh.main[1][0] * 100).toFixed(1)}% -> ${(b.sh.main[1][0] * 100).toFixed(1)}%)`);
    if (a.sh.jib) check(b.sh.jib[1][0] < a.sh.jib[1][0], `${cls}: backstay takes the sag out of the jib (${(a.sh.jib[1][0] * 100).toFixed(1)}% -> ${(b.sh.jib[1][0] * 100).toFixed(1)}%)`);
  }
  if (base.sh.jib) {
    const [a, b] = pair('jibLead', 0.1, 0.9);
    // A high-cut yankee (clew more than a metre above the deck, the Blackwatch's) has a short, straight-cut foot with
    // no round for the car to take out: its foot and leech tapes are both taut, and the car only shifts the load
    // between them. What it does is open the leech (twist at 50 and 82%); the foot must not get deeper.
    const J = C.sails.find((x) => x.key === 'jib'), yankee = J.tackZ + (J.footRise || 0) - C.freeboard > 1.0;
    const tw = (o) => o.sh.jib[1][2] + o.sh.jib[2][2];
    if (yankee) check(tw(b) > tw(a) && b.sh.jib[0][0] <= a.sh.jib[0][0] + 0.002, `${cls}: jib (yankee) car aft opens the leech, foot no deeper (twist 50+82% ${(tw(a) / DEG).toFixed(0)}° -> ${(tw(b) / DEG).toFixed(0)}°, foot ${(a.sh.jib[0][0] * 100).toFixed(1)}% -> ${(b.sh.jib[0][0] * 100).toFixed(1)}%)`);
    else check(b.sh.jib[0][0] < a.sh.jib[0][0] && b.sh.jib[2][2] > a.sh.jib[2][2], `${cls}: jib car aft flattens the foot and opens the leech (foot ${(a.sh.jib[0][0] * 100).toFixed(1)}% -> ${(b.sh.jib[0][0] * 100).toFixed(1)}%, twist ${(a.sh.jib[2][2] / DEG).toFixed(0)}° -> ${(b.sh.jib[2][2] / DEG).toFixed(0)}°)`);
  }
}
console.log(fails ? `${fails} FAILED` : 'all sail-shape checks passed');
process.exit(fails ? 1 : 0);
