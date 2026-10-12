// The speed machines (js/speedcraft.js, js/hydrofoil.js): Vestas Sailrocket 2.
//  1. the sections: a base-ventilated wedge's lift and its cavitation onset against sigma; a supercavitating plate's
//     lift to Kirchhoff-Rayleigh; a planing float against Savitsky's lift equation; a float at rest floats
//  2. the mass (the published 275 kg empty) and her rest
//  3. the force alignment: at speed the wing's line of force passes through the foil's centre (within 0.5 m over a
//     ~10 m lever), so she sails level (|heel| < 2 deg) with no heeling moment put in by hand
//  4. the polar: about 2.2-2.6 times the wind on her reach in 22-26 kn (WSSRC records 59.4 kn over 500 m and 55.3 over
//     the mile in 23-26 kn, 65.45 in 27-29); held under ~70 kn by the foil's cavitation ("just over 65": the team);
//     nothing much in light air; no unrealistic upwind ability
//  5. one tack: with the wind on her port side she cannot make way
//  6. l'Hydroptère: her record speed in 30 kn, both tacks, not flying in light air, flying on her leeward foil, a
//     surface-piercing foil ventilating
import { CLASSES, makeSteadyEnv, solvePolarAngle, makeBoat } from '../js/physics.js';
import { SpeedCraft, speedAutoTrim, speedHelm, craftMass } from '../js/speedcraft.js';
import { coef, planeCoef, cnKirchhoff, surfState } from '../js/hydrofoil.js';
const DEG = Math.PI / 180, KT = 0.514444;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const C = CLASSES.sailrocket2;

// 1. sections
{
  const st = () => surfState(), o = {};
  const sec = { kind: 'wedge', tb: 0.12, chord: 0.15, water: true }, th = Math.atan(0.06);
  // wetted (faces both attached, base vented): lift ~ 0.9 x 2 pi x alpha x Helmbold, no cavitation at 50 kn and 2 deg, 0.4 m deep
  const a = coef(sec, st(), 2 * DEG, 25.7, 6, 0.4, false, 1, o, true);
  check(a.cav < 0.01 && a.cl > 0.12 && a.cl < 0.2, `wedge at 2 deg, 50 kn: wetted, cl ${a.cl.toFixed(3)}, cd ${a.cd.toFixed(4)} (sigma ${a.sigma.toFixed(2)})`);
  // the leading edge boils when kLE cl passes sigma: at the same lift, it holds at 50 kn and boils at 75
  const s1 = st(); let c1; for (let k = 0; k < 5; k++) c1 = coef(sec, s1, 2.8 * DEG, 25.7, 6, 0.3, false, 0.05, {}, true);
  const s2 = st(); let c2; for (let k = 0; k < 5; k++) c2 = coef(sec, s2, 2.8 * DEG, 38.6, 6, 0.3, false, 0.05, {}, true);
  check(c1.cav < 0.5 && c2.cav > 0.5 && c2.cl < 0.8 * c1.cl, `wedge at 2.8 deg: wetted at 50 kn (cl ${c1.cl.toFixed(3)}), cavitating at 75 kn (cl ${c2.cl.toFixed(3)}, sigma ${c2.sigma.toFixed(2)})`);
  // a supercavitating plate (sigma ~0, infinite aspect ratio): Kirchhoff-Rayleigh's normal force
  const p = coef({ kind: 'scav', chord: 0.2, water: true }, Object.assign(st(), { vent: 1, ventOn: true }), 6 * DEG, 30, 1e6, 0.01, true, 1, {});
  check(Math.abs(p.cl - cnKirchhoff(6 * DEG) * Math.cos(6 * DEG)) / p.cl < 0.05, `ventilated plate at 6 deg: cl ${p.cl.toFixed(3)} (Kirchhoff ${(cnKirchhoff(6 * DEG) * Math.cos(6 * DEG)).toFixed(3)})`);
  // Savitsky: a 0.6 m float at 4 deg trim, 15 m/s, lambda 2: L = 1/2 rho V^2 b^2 (tau^1.1 0.012 lambda^0.5 - beta term)
  const P = { len: 2, b: 0.6, beta: 12 * DEG, depthMax: 0.4 };
  const lam = 2, tau = 4 * DEG, Lk = lam * P.b + P.b * Math.tan(P.beta) / (2 * Math.PI * Math.tan(tau)), d = Lk * Math.sin(tau);
  const q = planeCoef(P, d, tau, 15, 0, {}, tau);
  const CL0 = Math.pow(4, 1.1) * 0.012 * Math.sqrt(q.lam), CLb = CL0 - 0.0065 * 12 * Math.pow(CL0, 0.6), Ls = 0.5 * 1025 * 225 * 0.36 * CLb;
  check(Math.abs(q.lam - lam) < 0.05 && Math.abs(q.dyn - Ls) / Ls < 0.02 && q.L > q.dyn, `float planing: lambda ${q.lam.toFixed(2)}, dynamic lift ${q.dyn.toFixed(0)} N (Savitsky ${Ls.toFixed(0)}), with the buoyancy left ${q.L.toFixed(0)} N`);
}
// 2. mass and rest
{
  const parts = C.speed.parts.reduce((s, p) => s + p.m, 0);
  check(Math.abs(parts - 275) < 0.5, `parts sum to ${parts} kg (275 kg empty, sailrocket.com/node/291)`);
  const b = new SpeedCraft(C), env = makeSteadyEnv(0.01);
  for (let i = 0; i < 1200; i++) b.step(1 / 120, env, i / 120);
  const L = b.diag.pods.reduce((s, p) => s + p.L, 0);
  check(Math.abs(L - b.mass * 9.81) / (b.mass * 9.81) < 0.03 && Math.abs(b.phi) < 4 * DEG && b.diag.pods.every((p) => p.L > 100), `at rest on her three floats: ${b.diag.pods.map((p) => p.L.toFixed(0)).join(' / ')} N for ${(b.mass * 9.81).toFixed(0)} N, heel ${(b.phi / DEG).toFixed(1)} deg`);
}
// a steady run, heading held by the helm, the pilot's trim
function run(tws, twa, secs = 30) {
  const b = new SpeedCraft(C), env = makeSteadyEnv(tws * KT), dt = 1 / 60, psi = -(C.speed.windSide ?? 1) * twa * DEG;
  b.reset(0, 0, psi); b.vb[0] = 0.7 * tws * KT; b.u = b._uOut = b.vb[0];
  let n = 0; const s = { u: 0, phi: 0, mis: 0, kw: 0 };
  for (let i = 0; i < secs / dt; i++) {
    speedAutoTrim(b, dt); speedHelm(b, psi); b.step(dt, env, i * dt);
    if (b.capsized) break;
    if (i > 0.75 * secs / dt) {
      n++; s.u += b.u; s.phi += b.phi;
      // the foil's centre's distance from the wing's line of force (the transverse picture: y-z of the body)
      const L = b.forceLines(), w = L.wing, f = L.foil;
      if (w && f) {
        const d = [f.p.x - w.p.x, f.p.y - w.p.y, f.p.z - w.p.z], F = w.f, m = Math.hypot(...F);
        const c = [d[1] * F[2] - d[2] * F[1], d[2] * F[0] - d[0] * F[2], d[0] * F[1] - d[1] * F[0]];
        s.mis += Math.hypot(...c) / m; s.kw += m;
      }
    }
  }
  return { b, u: s.u / n / KT, phi: s.phi / n / DEG, mis: s.mis / n, Fw: s.kw / n, cap: b.capsized };
}
// 3. alignment and balance
{
  const r = run(26, 100);
  check(Math.abs(r.phi) < 2 && r.mis < 0.6 && r.Fw > 3000, `26 kn at 100 deg: ${r.u.toFixed(1)} kn, heel ${r.phi.toFixed(2)} deg, the foil ${r.mis.toFixed(2)} m off the wing's line of force (${(r.Fw / 1000).toFixed(1)} kN on the wing)`);
  const fl = r.b.diag.pods;
  check(fl[1].L < 50, `at speed the rear float flies (node/561): ${fl.map((p) => p.L.toFixed(0)).join(' / ')} N on front / rear / leeward`);
}
// 4. the polar
{
  const v = (tws, twa) => solvePolarAngle(C, tws * KT, twa).bsp / KT;
  const v26 = v(26, 100), v22 = v(22, 100), v18 = v(18, 100), v28 = v(28, 100), v34 = v(34, 100);
  check(v26 / 26 > 2.15 && v26 / 26 < 2.65, `26 kn of wind, 100 deg: ${v26.toFixed(1)} kn (${(v26 / 26).toFixed(2)} x the wind; the team: 2.4-2.5)`);
  check(v22 > 38 && v22 < 56, `22 kn: ${v22.toFixed(1)} kn (43.85 kn in 17-22 kn, mostly 20, node/603; 54.08 in 24.5, node/623)`);
  check(v28 > 60 && v28 < 69 && v34 < 73, `28 kn: ${v28.toFixed(1)} kn, 34 kn: ${v34.toFixed(1)} kn (the record, 65.45 kn, in 27-29 kn at the shore station; above ~65 the foil cavitates)`);
  check(v18 < 45, `18 kn: ${v18.toFixed(1)} kn (she needs ~17-20 kn to get going)`);
  const up = v(26, 45);
  check(up * Math.cos(45 * DEG) < 26, `upwind (45 deg true): ${up.toFixed(1)} kn, VMG ${(up * Math.cos(45 * DEG)).toFixed(1)} kn: no better than the wind`);
}
// 5. the wrong tack
{
  const r = run(26, -100, 20);
  check(r.cap || r.u < 10, `wind on her port side: ${r.cap ? 'capsized' : `${r.u.toFixed(1)} kn`} — she sails on starboard tack only`);
  check(makeBoat(C) instanceof SpeedCraft, 'makeBoat builds her as a speed machine');
}
// 6. l'Hydroptère: a sailing trimaran on surface-piercing foils (js/physics.js Boat with C.hydrofoils)
{
  const H = CLASSES.hydroptere, v = (tws, twa) => solvePolarAngle(H, tws * KT, twa);
  const r30 = v(30, 120), r12 = v(12, 110), rp = v(30, -120);
  check(r30.bsp / KT > 46 && r30.bsp / KT < 56 && Math.abs(r30.heel) < 10, `l'Hydroptère, 30 kn at 120 deg: ${(r30.bsp / KT).toFixed(1)} kn, heel ${r30.heel.toFixed(1)} deg (51.36 kn over 500 m in 30 kn, WSSRC 2009)`);
  check(Math.abs(rp.bsp - r30.bsp) / r30.bsp < 0.03, `she sails both tacks: ${(rp.bsp / KT).toFixed(1)} kn on the other`);
  check(r12.bsp / KT < 20, `12 kn: ${(r12.bsp / KT).toFixed(1)} kn, not flying`);
  // flying on the leeward foil, the windward one light, the hull clear; the ride height found by the immersed span
  const b = makeBoat(H, { sailModel: 'strip' }), env = makeSteadyEnv(30 * KT), dt = 1 / 60;
  const { vppStart, autoTrim } = await import('../js/physics.js');
  vppStart(b, 30 * KT, 120, false);
  for (let i = 0; i < 40 / dt; i++) { autoTrim(b, dt, 0); b.step(dt, env, i * dt); b.r = 0; b.psi = 120 * DEG; b.rudder = 0; }
  const F = b.diag.hfoils, lee = F[0].lift > F[1].lift ? F[0] : F[1], win = lee === F[0] ? F[1] : F[0];
  check(b.diag.displaced < 100 && lee.imm > 0.2 && lee.imm < 0.9 && win.lift < 0.2 * lee.lift, `flying: hulls ${b.diag.displaced.toFixed(0)} kg in the water, the leeward foil ${(lee.lift / 1000).toFixed(1)} kN at ${(lee.imm * 100).toFixed(0)}% immersed, the windward ${(win.lift / 1000).toFixed(1)} kN; heave ${b.heave.toFixed(2)} m`);
  // a foil ventilating from the surface past its inception angle loses its lift at once
  const sec = { kind: 'naca', tc: 0.09, chord: 0.7, water: true }, st = surfState(), o = {};
  let c2, c3; const s3 = surfState();
  for (let k = 0; k < 6; k++) { c2 = coef(sec, st, 16 * DEG, 12, 4, 0.6, true, 0.2, o); c3 = coef(sec, s3, 16 * DEG, 12, 4, 0.6, false, 0.2, {}); }
  check(c2.vent > 0.9 && c3.vent < 0.01 && c2.cl < 0.6 * c3.cl, `a foil at 16 deg, 23 kn: piercing the surface it ventilates (cl ${c2.cl.toFixed(2)}), sealed below it holds (cl ${c3.cl.toFixed(2)})`);
}
console.log(fails ? `${fails} FAILED` : 'all speed-craft checks passed');
process.exit(fails ? 1 : 0);
