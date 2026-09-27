// Damage from real loads (js/damage.js): rig loads against the righting-moment rule, the dismasting threshold,
// collision energy, leak rate and sinking time, a bent rudder, a lost keel, sail tearing, grounding.
// node test/damage.mjs          (exits non-zero on a failed check)
import { Boat, autoTrim, makeSteadyEnv, RHO_W } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { Damage, rigSpec, collisionEnergy, impactPair, torricelli } from '../js/damage.js';
import { resolveCollisions } from '../js/race.js';
const KT = 0.514444, DEG = Math.PI / 180, G = 9.81;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const dt = 1 / 120;
function run(b, D, env, secs, each, world = null, hold = null) {
  let t = 0;
  for (let i = 0; i < secs / dt; i++) {
    if (each) each(t, i);
    const E = b.ext = b.ext || {}; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    D.pre(dt, E, env, t);
    b.step(dt, env, t, world); t += dt;
    if (hold) hold();
    D.post(dt, { world, env, t, seabed: world && world.bed ? world.bed : () => 'sand' });
  }
}

// ---------------------------------------------------------------- 1. rig loads vs the RM-based estimate
console.log('\n1. Shroud loads against the righting-moment rule (Nordic Boat Standard / Skene: T_cap = k RM / b + pretension)');
for (const cls of ['blackwatch', 'sportboat', 'cat']) {
  const env = makeSteadyEnv(16 * KT);
  const b = new Boat(cls, { sailModel: 'strip' }); b.reset(0, 0, 45 * DEG); b.u = 2;
  const D = new Damage(b), R = rigSpec(b.cls), P = D.parts.cap;
  let sT = 0, sRM = 0, n = 0;
  run(b, D, env, 40, () => autoTrim(b, dt, 0, true), null, () => { b.psi = 45 * DEG; b.r = 0; });
  run(b, D, env, 10, () => autoTrim(b, dt, 0, true), null, () => { b.psi = 45 * DEG; b.r = 0; sT += P.load; sRM += b.diag.RM; n++; });
  const T = sT / n, RM = sRM / n, est = R.cap * RM / (R.b * Math.cos(10 * DEG)) + P.mbl * R.pre;
  check(Math.abs(T - est) / est < 0.15, `${cls.padEnd(10)} 16 kn upwind: heel ${(b.phi / DEG).toFixed(0)}°, RM ${Math.round(RM)} N m, cap ${Math.round(T)} N (${P.spec}, MBL ${Math.round(P.mbl)} N); RM rule ${Math.round(est)} N`);
  // safety factor on the cap at RM30 (hull form + ballast + crew on the rail): designers work to ~2.5-3.5
  const m = b.cls.massHull + b.crewMass;
  const RM30 = m * G * b.GZ(30 * DEG) + b.crewMass * G * b.cls.crewMaxOut * Math.cos(30 * DEG);
  const T30 = R.cap * RM30 / (R.b * Math.cos(10 * DEG)) + P.mbl * R.pre;
  const SF = P.mbl / T30;
  check(SF > 1.8 && SF < 6, `${cls.padEnd(10)} cap at RM30 (${Math.round(RM30)} N m): ${Math.round(T30)} N, safety factor ${SF.toFixed(1)} (expect ~2-5)`);
}

// ---------------------------------------------------------------- 2. dismasting threshold
console.log('\n2. Dismasting threshold (order of magnitude)');
for (const cls of ['blackwatch', 'sportboat', 'cat']) {
  const b = new Boat(cls, { sailModel: 'strip' }), R = rigSpec(b.cls), P = new Damage(b).parts.cap;
  const Mfail = (P.mbl * (1 - R.pre)) * R.b * Math.cos(10 * DEG) / R.cap;
  let RMmax = 0; for (let a = 5; a <= 90; a += 5) RMmax = Math.max(RMmax, (b.cls.massHull + b.crewMass) * G * b.GZ(a * DEG) + b.crewMass * G * b.cls.crewMaxOut * Math.cos(a * DEG));
  check(Mfail / RMmax > 1.2 && Mfail / RMmax < 8, `${cls.padEnd(10)} the cap parts at a rig moment of ${Math.round(Mfail)} N m = ${(Mfail / RMmax).toFixed(1)} x her largest righting moment (${Math.round(RMmax)} N m): steady sailing cannot break it, a shock can`);
}
// a knockdown: thrown onto her side (sail and boom in the water, the mast not) — and rolled past the horizontal with
// the mast driven into the sea: at what roll rate does the rig break? (a broach rolls a boat at ~0.5-1 rad/s, a
// breaking sea at 2-4)
const knock = (cls, phi0, p0) => {
  const env = makeSteadyEnv(20 * KT);
  const b = new Boat(cls, { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG); b.u = 1;
  const D = new Damage(b); D.age = 5;
  b.phi = phi0 * DEG; b.p = p0;
  run(b, D, env, 2.5);
  return D;
};
for (const cls of ['blackwatch', 'sportboat', 'cat', 'dinghy']) {
  const side = [1, 2, 3].map((p) => knock(cls, 70, p)).findIndex((D) => D.rig.down);
  if (cls !== 'dinghy' && cls !== 'cat') check(side < 0 || side >= 1, `${cls.padEnd(10)} knocked down to ~80° at up to ${side < 0 ? 3 : side} rad/s (sail and boom in the sea): ${side < 0 ? 'the rig stands' : 'breaks at ' + (side + 1)}`);
  let pBreak = null, why = '';
  for (const p0 of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]) { const D = knock(cls, 100, p0); if (D.rig.down) { pBreak = p0; why = D.rig.why; break; } }
  check(pBreak !== null && pBreak >= 0.5 && pBreak <= 3, `${cls.padEnd(10)} rolled past 90° with the mast going into the sea: breaks at ${pBreak ?? '>4'} rad/s (${why})`);
}
// crash gybe: the boom slams across at omega and the sheet stops it (J = I_boom omega in ~0.08 s)
{
  for (const [kn, w] of [[12, 1.5], [30, 3.5]]) {
    const env = makeSteadyEnv(kn * KT);
    const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 160 * DEG); b.u = 5;
    const D = new Damage(b); D.age = 5;
    b.ctrl.main = 0.8; b.lines.main = 0.8; b.booms.main.a = -0.5; b.booms.main.rate = -w;   // swinging out hard to port
    let peak = 0, worst = 0, wk = '';
    run(b, D, env, 2, null, null, () => { peak = Math.max(peak, D.lastSlam || 0); if (D.maxR > worst) { worst = D.maxR; wk = D.worst; } });
    check(!D.rig.down, `crash gybe in ${kn} kn, boom at ${w} rad/s: mainsheet shock ${Math.round(peak)} N, worst rig part ${wk} at ${Math.round(worst * 100)}% (the rig takes it)`);
  }
}

// ---------------------------------------------------------------- 3. collision energy
console.log('\n3. Collision energy (1/2 mu v^2 (1 - e^2), e = 0.3)');
for (const kn of [2, 6]) {
  const A = new Boat('sportboat', { sailModel: 'strip', id: 1 }), B = new Boat('sportboat', { sailModel: 'strip', id: 2 });
  A.reset(0, 6, 0); B.reset(0, 0, 90 * DEG);                        // A heads north into B's port side
  A.u = kn * KT; B.u = 0;
  const DA = A.dmg = new Damage(A), DB = B.dmg = new Damage(B);
  let I = null;
  for (let i = 0; i < 1200 && I === null; i++) {
    A.z -= A.u * dt;                                                  // (kinematic approach, no sails)
    resolveCollisions([A, B], [], [], (b, o, v, nx, nz) => { if (I === null && o && o.cls) I = impactPair(b, o, v, nx, nz); });
  }
  const v = kn * KT, mu = A.mass * B.mass / (A.mass + B.mass), Ean = 0.5 * mu * v * v * (1 - 0.09);
  check(I !== null && Math.abs(I.E - Ean) / Ean < 0.1, `two J/70-size boats, ${kn} kn T-bone: ${Math.round(I ? I.E : 0)} J lost (analytic ${Math.round(Ean)} J): the struck ${I && I.atB} takes ${Math.round(I ? I.Eb : 0)} J, the ${I && I.atA} ${Math.round(I ? I.Ea : 0)} J`);
  check(kn < 4 ? DB.hull.holes.length === 0 : DB.hull.holes.length > 0, `  struck boat: ${DB.hull.holes.length ? `holed ${Math.round(DB.hull.holes[0].A * 1e4)} cm²` : `no hole, damage ${Math.round(DB.hull.pts * 100)}%`}; the striking bow ${DA.hull.holes.length ? 'holed' : 'intact'}`);
}
check(collisionEnergy(1000, 15, 3, 0.1) < 70, `touching an inflatable race mark at 6 kn: ${collisionEnergy(1000, 15, 3, 0.1).toFixed(0)} J (harmless)`);
check(collisionEnergy(1000, Infinity, 3) > 4000, `hitting a pier at 6 kn: ${Math.round(collisionEnergy(1000, Infinity, 3))} J (holes a light boat)`);

// ---------------------------------------------------------------- 4. leak rate, pumps, sinking time
console.log('\n4. Leak rate (Torricelli) and sinking time');
{
  const calm = makeSteadyEnv(0.01);
  const b = new Boat('blackwatch', { sailModel: 'strip' }); b.reset(0, 0, 0);
  const D = new Damage(b); D.pumping = false;
  const A = Math.PI * 0.025 * 0.025, z = -0.4;                       // a 5 cm hole 0.4 m under the waterline
  D.addHole(0.5, 0, z, A, 'test');
  run(b, D, calm, 0.5, null, null, null);
  const Q0 = torricelli(A, -z - b.heave);
  check(Math.abs(D.inflow - Q0) / Q0 < 0.1, `5 cm hole 0.4 m down: ${(D.inflow * 1000).toFixed(2)} L/s in (Torricelli Cd 0.6: ${(Q0 * 1000).toFixed(2)} L/s = ${Math.round(Q0 * 60000)} L/min)`);
  let t = 0.5, tSunk = null;
  const reserve = D.Vfull * RHO_W - b.mass;
  while (t < 7200 && !D.hull.sunk) { run(b, D, calm, 1); t += 1; }
  tSunk = D.hull.sunk ? t : null;
  // the same flooding integrated by hand, quasi-statically: she floats where her hull displaces her weight and the
  // water's (bisection on the hull's sections), the water inside stands where the hull holds its volume
  const hb = new Boat('blackwatch', { sailModel: 'strip' }), Dh = new Damage(hb);
  const heaveFor = (m) => { let lo = -3, hi = 1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (hb.hydro.immerse(mid, 0, 0, () => 0, () => 0, {}).V * RHO_W > m) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const zinFor = (V) => { let k = 1; while (k < Dh.inV.length - 1 && Dh.inV[k] < V) k++; return Dh.inZ[k - 1] + (Dh.inZ[k] - Dh.inZ[k - 1]) * Math.min(1, Math.max(0, (V - Dh.inV[k - 1]) / (Dh.inV[k] - Dh.inV[k - 1]))); };
  let V = 0, ta = 0;
  while (V * RHO_W < reserve * 0.98 && ta < 10800) {
    const hv = heaveFor(b.cls.massHull + b.crewMass + V * RHO_W);
    if (hv < -(b.cls.freeboard + 0.6)) break;
    const h = (-hv - z) - Math.max(0, zinFor(V) - z);
    V += torricelli(A, Math.max(0, h)) * 1; ta += 1;
  }
  check(tSunk !== null && Math.abs(tSunk - ta) / ta < 0.3, `no pumping: she sinks after ${tSunk ? (tSunk / 60).toFixed(1) : '>120'} min with ${Math.round(D.water)} kg of water in her (reserve buoyancy ${Math.round(reserve)} kg; by hand ${(ta / 60).toFixed(1)} min)`);
  // a 2 cm hole: the manual pump (64 L/min) keeps up
  const b2 = new Boat('blackwatch', { sailModel: 'strip' }); b2.reset(0, 0, 0);
  const D2 = new Damage(b2); D2.addHole(0.5, 0, -0.4, Math.PI * 0.01 * 0.01, 'test');
  run(b2, D2, calm, 600);
  check(!D2.hull.sunk && D2.water < 60, `2 cm hole with the pump going: ${Math.round(D2.water)} L aboard after 10 min (in ${Math.round(D2.inflow * 60000)} L/min, pumped ${Math.round(D2.pumpOut * 60000)} L/min)`);
  // a half-flooded boat is heavier and slower
  const env = makeSteadyEnv(12 * KT);
  const speed = (water) => { const bb = new Boat('blackwatch', { sailModel: 'strip' }); bb.reset(0, 0, 90 * DEG); bb.u = 2; const DD = new Damage(bb); DD.water = water; DD.pumping = false; let s = 0, n = 0; run(bb, DD, env, 60, () => autoTrim(bb, dt, 0, true), null, () => { bb.psi = 90 * DEG; bb.r = 0; }); run(bb, DD, env, 20, () => autoTrim(bb, dt, 0, true), null, () => { bb.psi = 90 * DEG; bb.r = 0; s += bb.u; n++; }); return s / n; };
  const v0 = speed(0), v1 = speed(400);
  check(v1 < v0 * 0.97, `beam reach in 12 kn: ${(v0 / KT).toFixed(2)} kn dry, ${(v1 / KT).toFixed(2)} kn with 400 L aboard`);
}

// ---------------------------------------------------------------- 5. a bent rudder
console.log('\n5. Rudder damage');
{
  const env = makeSteadyEnv(12 * KT);
  const turn = (bend, helm) => {
    const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 70 * DEG); b.u = 3;
    const D = new Damage(b); if (bend) { D.hull.rudder = bend; D.hull.rudderSide = 1; }
    run(b, D, env, 20, () => autoTrim(b, dt, 0, true), null, () => { b.psi = 70 * DEG; b.r = 0; });
    let r = 0, n = 0;
    run(b, D, env, 3, (t) => { autoTrim(b, dt, 0, true); b.ctrl.helm = helm; if (t > 1.5) { r += b.r; n++; } });
    return r / n;
  };
  const r0 = turn(0, -1), r1 = turn(0.6, -1), rb = turn(0.6, 0), rc = turn(0, 0);
  check(Math.abs(r1) < 0.7 * Math.abs(r0), `full helm: turns at ${(Math.abs(r0) / DEG).toFixed(1)}°/s with a sound rudder, ${(Math.abs(r1) / DEG).toFixed(1)}°/s with the stock bent (60%)`);
  check(Math.abs(rb - rc) > 0.5 * DEG, `helm amidships with the bent stock: she turns at ${(rb / DEG).toFixed(1)}°/s (sound: ${(rc / DEG).toFixed(1)}°/s)`);
}

// ---------------------------------------------------------------- 6. grounding and a lost keel
console.log('\n6. Grounding by the seabed, a lost keel');
{
  for (const [bed, kn] of [['sand', 6], ['rock', 3], ['rock', 6], ['rock', 9]]) {
    const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 0);
    const D = new Damage(b);
    const E = 0.5 * b.mass * (kn * KT) ** 2;
    D.grounding(E, bed, false);
    console.log(`     ${kn} kn onto ${bed}: ${Math.round(E)} J, keel ${Math.round(D.hull.keelD * 100)}%${D.hull.holes.length ? `, leak ${Math.round(D.hull.holes[0].A * 1e4)} cm²` : ''}${D.hull.keelLost ? ', KEEL LOST' : ''}`);
    if (bed === 'sand') check(D.hull.keelD < 0.25 && !D.hull.holes.length, '  sand absorbs a 6 kn grounding: no leak');
    if (bed === 'rock' && kn === 6) check(D.hull.holes.length > 0 && !D.hull.keelLost, '  rock at 6 kn: the keel bolts leak, the keel stays on');
    if (bed === 'rock' && kn === 9) { D.grounding(E, bed, false); check(D.hull.keelLost, '  rock at 9 kn, twice: the keel is gone'); }
  }
  // the full physics: a keelboat without her keel rolls over
  let keel12 = 0;
  for (const kn of [12, 20]) {
    const env = makeSteadyEnv(kn * KT);
    const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG); b.u = 3;
    const D = new Damage(b); D.loseKeel();
    let maxPhi = 0;
    run(b, D, env, 25, () => autoTrim(b, dt, 0, true), null, () => { maxPhi = Math.max(maxPhi, Math.abs(b.phi)); });
    console.log(`     J/70 without her keel (${Math.round(b.mass)} kg, her hull's weight ${D.b.zG.toFixed(2)} m above the waterline) in ${kn} kn: heels to ${(maxPhi / DEG).toFixed(0)}°`);
    if (kn === 12) keel12 = maxPhi;
    if (kn === 20) check(maxPhi > 1.5 * keel12, `  without the ballast she lies over ${(maxPhi / DEG).toFixed(0)}° in 20 kn with the crew on the rail`);
  }
  {
    // a keelboat's ballast is what keeps her up when the crew cannot: lost keel, crew sitting in, 16 kn: over she goes
    const env = makeSteadyEnv(16 * KT);
    const heel = (lose) => {
      const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG); b.u = 3; b.auto.hike = false; b.ctrl.hike = 0;
      const D = new Damage(b); if (lose) D.loseKeel();
      let maxPhi = 0;
      run(b, D, env, 25, () => { b.ctrl.main = 0.15; b.ctrl.jib = 0.15; b.ctrl.trav = 0.5; b.ctrl.hike = 0; }, null, () => { maxPhi = Math.max(maxPhi, Math.abs(b.phi)); });
      return maxPhi;
    };
    const h0 = heel(false), h1 = heel(true);
    check(h1 > 1.4 * h0, `  sheets made fast, crew sitting in, 16 kn: she lies over ${(h1 / DEG).toFixed(0)}° without her keel (${(h0 / DEG).toFixed(0)}° with it; with no keel she also slides off sideways instead of heeling)`);
    // the range of stability: knocked to 110° by a sea, with her keel she comes back; without it she stays capsized
    const flip = (lose) => {
      const b = new Boat('sportboat', { sailModel: 'strip' }); b.reset(0, 0, 60 * DEG); b.auto.hike = false; b.ctrl.hike = 0;
      const D = new Damage(b); if (lose) D.loseKeel();
      b.phi = 110 * DEG; b.p = 0.3;
      run(b, D, makeSteadyEnv(8 * KT), 30);
      return Math.abs(b.phi);
    };
    const f0 = flip(false), f1 = flip(true);
    check(f0 < 45 * DEG && f1 > 80 * DEG, `  knocked to 110° by a sea: with her keel she comes back to ${(f0 / DEG).toFixed(0)}° within 30 s; without it she stays capsized at ${(f1 / DEG).toFixed(0)}° (held on her side only by the floating mast)`);
  }
  // a real grounding in the physics: a shoal ahead, rock
  const shoal = { depthAt: (x, z) => (z < -8 ? 0.6 : 6), gradDepth: () => [0, 1], sdfAt: () => 100, bed: () => 'rock' };
  const g = new Boat('sportboat', { sailModel: 'strip' }); g.reset(0, 0, 0); g.u = 6 * KT;
  const DG = new Damage(g); DG.age = 5;
  run(g, DG, makeSteadyEnv(0.01), 12, null, shoal);
  check(DG.hull.keelD > 0.1, `running onto a rock shoal at 6 kn in the physics: keel ${Math.round(DG.hull.keelD * 100)}%, ${DG.hull.holes.length} leak(s), ${Math.round(DG.water)} L aboard after 12 s`);
}

// ---------------------------------------------------------------- 7. sails: overload and flogging
console.log('\n7. Sails');
{
  // flogging: a Dacron main left to flog head to wind in 35 kn: Miner damage at dt / T0 (q0 / q)^2.2
  const env = makeSteadyEnv(35 * KT);
  const b = new Boat('blackwatch', { sailModel: 'strip' }); b.reset(0, 0, 0); b.u = 0;
  const D = new Damage(b); D.age = 5;
  let tTear = null, t = 0;
  while (t < 1800 && tTear === null) { run(b, D, env, 5, () => { b.ctrl.main = 1; b.ctrl.jib = 1; b.ctrl.stay = 1; b.lines.main = 1; }, null, () => { b.psi = 0; b.r = 0; b.x = 0; b.z = 0; }); t += 5; if (D.sails.main.tear > 0) tTear = t; }
  const q = 0.5 * 1.225 * (35 * KT) ** 2, Tex = 1200 * Math.pow(145 / q, 2.2);
  check(tTear !== null && tTear > Tex * 0.8 && tTear < Tex * 4, `Dacron main flogging head to wind in 35 kn (q ${Math.round(q)} Pa): tears after ${tTear ?? '>1800'} s (life at full flog ${Math.round(Tex)} s)`);
  // overload: a nylon gennaker hard pressed in a 38 kn blast (cloth sails)
  const e2 = makeSteadyEnv(45 * KT);
  const g = new Boat('sportboat'); g.reset(0, 0, 110 * DEG); g.u = 6; g.ctrl.gen = true; g.genDeploy = 1; g.genFill = 1;
  const DG = new Damage(g);
  run(g, DG, e2, 30, () => autoTrim(g, dt, 0, true), null, () => { g.psi = 110 * DEG; g.r = 0; });
  const S = DG.sails.gennaker;
  console.log('     (gennaker state', JSON.stringify({ tear: S.tear, D: S.D, ratio: S.ratio, peak: S.peak, blown: S.blown }), ')');
  check(S.tear > 0, `gennaker reaching in a 45 kn blast: peak cloth tension ${(S.peak / 1000).toFixed(2)} kN/m (x${3} at the corners vs ${(S.mat.S / 1000).toFixed(0)} kN/m nylon): ${S.blown ? 'BLOWN OUT' : `torn ${Math.round(S.tear * 100)}%`}`);
  const e3 = makeSteadyEnv(14 * KT);
  const g2 = new Boat('sportboat'); g2.reset(0, 0, 110 * DEG); g2.u = 6; g2.ctrl.gen = true; g2.genDeploy = 1; g2.genFill = 1;
  const DG2 = new Damage(g2);
  run(g2, DG2, e3, 30, () => autoTrim(g2, dt, 0, true), null, () => { g2.psi = 110 * DEG; g2.r = 0; });
  check(DG2.sails.gennaker.tear === 0, `the same gennaker in 14 kn: ${Math.round(DG2.sails.gennaker.ratio * 100)}% of its strength, sound`);
}

console.log(`\n${fails ? fails + ' check(s) FAILED' : 'all damage checks passed'}`);
process.exit(fails ? 1 : 0);
