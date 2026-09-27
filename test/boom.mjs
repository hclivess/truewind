// The main boom (js/boom.js): sheet geometry to a straight traveller track, the boom as a beam, the boom end in the
// sea, the leeward shroud stopping it, a preventer and a boom brake. Run: node test/boom.mjs
import { Boat, CLASSES, makeSteadyEnv, autoTrim } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { sheetCar, boomBlock, sheetDist, sheetLen, boomAngleForSheet, boomBend, boomContactAngle, boomDip, boomLen, goose } from '../js/boom.js';
const KT = 0.514444, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// 1. sheet geometry: the car on a straight athwartships track, the block on the boom; distance by hand, and the boom
// angle a sheet length allows comes back to that length
{
  const C = CLASSES.blackwatch, s = C.sails[0], T = s.track, G = goose(C);
  const a = 30 * DEG, car = sheetCar(C, s, 0.8, 1, a), blk = boomBlock(C, s, a);
  const byHand = Math.hypot(G.x - T.s * Math.cos(a) - T.x, T.s * Math.sin(a) - (-T.half + 1.6 * T.half), G.z - T.z);
  check(Math.abs(car[0] - T.x) < 1e-9 && Math.abs(car[2] - T.z) < 1e-9 && Math.abs(sheetDist(C, s, a, car) - byHand) < 1e-9 && Math.abs(blk[1] - T.s * Math.sin(a)) < 1e-9,
    `sheet to a car on a straight track: ${sheetDist(C, s, a, car).toFixed(4)} m = ${byHand.toFixed(4)} m by hand`);
  let worst = 0;
  for (const cls of ['blackwatch', 'sportboat', 'cat']) {
    const s2 = CLASSES[cls].sails[0];
    for (const tr of [0.2, 0.5, 0.9]) for (const e of [0.2, 0.5, 0.8]) {
      const L = sheetLen(CLASSES[cls], s2, e), ang = boomAngleForSheet(CLASSES[cls], s2, L, tr);
      if (ang < s2.max - 1e-6 && ang > 1e-3) worst = Math.max(worst, Math.abs(sheetDist(CLASSES[cls], s2, ang, sheetCar(CLASSES[cls], s2, tr, 1, ang)) - L));
    }
  }
  check(worst < 1e-4, `boom angle for a sheet length gives that length back (worst ${(worst * 1000).toFixed(3)} mm)`);
  // the downward part of the sheet's pull (its vang effect): hard in over the car it is nearly all of it; the same
  // boom angle with the car at the windward end pulls more across and less down
  const dn = (tr, ang) => { const c = sheetCar(C, s, tr, 1, ang), b = boomBlock(C, s, ang); return (b[2] - c[2]) / sheetDist(C, s, ang, c); };
  check(dn(0.5, 5 * DEG) > 0.75 && dn(0, 20 * DEG) < dn(0.9, 20 * DEG), `sheet's downward share: ${dn(0.5, 5 * DEG).toFixed(2)} over the car, ${dn(0, 20 * DEG).toFixed(2)} from the windward end vs ${dn(0.9, 20 * DEG).toFixed(2)} from under the boom at 20 deg`);
}

// 2. the boom as a beam: a point load at mid-span, simply supported: M = F L / 4, deflection F L^3 / (48 EI)
{
  const L = 2.7, EI = 1.1e4, F = 1000, o = boomBend(L, EI, L / 2, F, L / 2, 0);
  const d = F * L ** 3 / (48 * EI);
  check(Math.abs(o.M - F * L / 4) < 1e-6 && Math.abs(o.dv - d) / d < 1e-9, `boom bend: M ${o.M.toFixed(1)} N m (F L/4 ${(F * L / 4).toFixed(1)}), sag ${(o.dv * 1000).toFixed(1)} mm (${(d * 1000).toFixed(1)})`);
  // a Laser boom under 1.5 kN of vang near the gooseneck and the sheet's 400 N bows visibly; a keelboat's barely
  const la = CLASSES.dinghy.sails[0], bw = CLASSES.blackwatch.sails[0];
  const bl = boomBend(boomLen(la), la.boomEI, 0.22 * boomLen(la), 1500, la.track.s, 400), bb = boomBend(boomLen(bw), bw.boomEI, 0.22 * boomLen(bw), 1500, bw.track.s, 400);
  check(bl.dv > 5 * bb.dv && bl.dv > 0.01, `Laser boom sags ${(bl.dv * 1000).toFixed(0)} mm at the vang, Blackwatch's ${(bb.dv * 1000).toFixed(1)} mm`);
}

// 3. the boom end in the sea: running, rolled 35 deg to the boom's side, the dipped boom drags aft and
// swings inboard; its drag, abaft and to leeward, turns the bow toward the boom (a broach)
{
  const b = new Boat('blackwatch', { sailModel: 'strip' });
  b.u = 3; b.v = 0; b.r = 0; b.p = 0;
  const s = b.sailBy.main, phi = 35 * DEG, ax = { cphi: Math.cos(phi), sphi: Math.sin(phi), heaveH: 0 };
  const o = boomDip(b, s, 80 * DEG, 0, boomLen(s), 0, ax, () => 0, {});
  const dry = boomDip(b, s, 80 * DEG, 0, boomLen(s), 0, { ...ax, cphi: 1, sphi: 0 }, () => 0, {});
  check(o.wet > 0 && dry.wet === 0 && o.X < 0 && o.torque < 0 && o.N > 0,
    `boom dipped at 35 deg heel: drag ${o.X.toFixed(0)} N, swings inboard (${o.torque.toFixed(0)} N m), yaw ${o.N.toFixed(0)} N m toward the boom; upright it is dry`);
}

// 4. the leeward shroud stops the boom: a swept-spreader J/70 earlier than the masthead Blackwatch, the unstayed
// dinghy past square
{
  const ang = (c) => boomContactAngle(CLASSES[c], Object.fromEntries(CLASSES[c].sails.map((s) => [s.key, s]))) / DEG;
  check(ang('sportboat') < ang('blackwatch') && ang('dinghy') > 90 && ang('blackwatch') < 90,
    `boom on the shroud: J/70 ${ang('sportboat').toFixed(0)} deg, Blackwatch ${ang('blackwatch').toFixed(0)}, cat ${ang('cat').toFixed(0)}, Laser ${ang('dinghy').toFixed(0)} (unstayed)`);
}

// 5-6. preventer and boom brake: the Blackwatch on a broad reach (150 deg true), the boom caught on the windward side
// at 25 deg with the sheet half out: the wind on its back throws it across (an accidental gybe); a preventer made fast
// there holds it; with the brake on it comes across more slowly
function gybeRun(model, prev, brake, tws = 14) {
  const env = makeSteadyEnv(tws * KT), b = new Boat('blackwatch', { sailModel: model });
  const dt = 1 / 120, twa = 150;
  b.reset(0, 0, twa * DEG); b.u = 2.5; b.booms.main.a = -25 * DEG; b.side.jib = -1;
  let t0 = null, t1 = null, maxA = -90;
  for (let i = 0; i < 120 * 8; i++) {
    const t = i * dt;
    autoTrim(b, dt); b.ctrl.main = 0.5; b.lines.main = 0.5; b.ctrl.preventer = prev ? 1 : 0; b.ctrl.brake = brake;
    b.step(dt, env, t); b.psi = twa * DEG; b.r = 0;
    const a = b.booms.main.a / DEG;
    if (t0 === null && a > -20) t0 = t;
    if (t0 !== null && t1 === null && a > 30) t1 = t;
    maxA = Math.max(maxA, a);
  }
  return { gybed: maxA > 30, swing: t1 !== null ? t1 - t0 : null, a: b.booms.main.a / DEG, load: b.diag.rig.preventerLoad || 0 };
}
for (const model of ['strip', 'cloth']) {
  const free = gybeRun(model, false, 0), held = gybeRun(model, true, 0), braked = gybeRun(model, false, model === 'strip' ? 0.1 : 0.02);
  check(free.gybed && !held.gybed, `${model}: caught on the windward side the boom gybes free (${free.gybed ? 'gybed' : 'held'}), the preventer holds it (${held.a.toFixed(0)} deg, ${held.load.toFixed(0)} N)`);
  check(free.swing !== null && braked.swing !== null && braked.swing > 1.3 * free.swing,
    `${model}: the boom brake (set light enough to let it across) slows the gybe: -20 to +30 deg in ${free.swing?.toFixed(2)} s free, ${braked.swing?.toFixed(2)} s braked`);
}
console.log(fails ? `${fails} FAILED` : 'all boom checks passed');
process.exit(fails ? 1 : 0);
