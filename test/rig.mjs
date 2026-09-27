// The rig as a structure (js/rig-structure.js): the solver against beam theory and the catenary, the shrouds against
// the righting moment, the Hobie's mast rotation, the Laser's vang bend, the J/70's backstay.
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { RigStructure, section, wireEA } from '../js/rig-structure.js';
const KT = 0.514444, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

// 1. a cantilever (clamped at its heel): tip deflection P L^3 / 3 EI; and with an end compression the P-delta
// amplification 1 / (1 - P/Pcr), Pcr = pi^2 EI / 4 L^2
{
  const b = new Boat('dinghy', { sailModel: 'strip', rigStructure: false });
  const spec = { step: { type: 'fixed', z: 0.05 }, spans: [{ z0: 0.05, z1: 6.24, dia: 0.0635, t: 0.0018 }], spreaders: [], wires: [], prebend: 0 };
  const rs = new RigStructure(b, spec), L = rs.zTop - rs.zStep, EI = section(spec.spans[0]).EIx, P = 40;
  rs.F.fill(0); rs.loadMast(rs.zTop, P, 0, 0); for (let k = 0; k < 4; k++) rs.solve(10);
  const tip = rs.u[5 * (rs.nm - 1)], th = P * L ** 3 / (3 * EI);
  check(Math.abs(tip / th - 1) < 0.01, `cantilever tip deflection ${(tip * 1000).toFixed(1)} mm vs P L^3/3EI ${(th * 1000).toFixed(1)} mm`);
  const Pcr = Math.PI ** 2 * EI / (4 * L * L), N = 0.4 * Pcr;
  rs.F.fill(0); rs.loadMast(rs.zTop, P, 0, -N); for (let k = 0; k < 8; k++) rs.solve(10);
  const tip2 = rs.u[5 * (rs.nm - 1)], amp = tip2 / th, ampTh = 1 / (1 - N / Pcr);
  check(Math.abs(amp / ampTh - 1) < 0.05, `P-delta: end compression 0.4 Pcr amplifies the tip by ${amp.toFixed(3)} (1/(1-P/Pcr) = ${ampTh.toFixed(3)})`);
  rs.F.fill(0); rs.loadMast(rs.zTop, P, 0, -1.3 * Pcr); rs.solve(10); rs.solve(10);
  check(rs.buckled, `a compression past Pcr (${(1.3 * Pcr).toFixed(0)} N) is reported as buckling`);
}

// 2. forestay sag under an evenly spread luff load against the catenary: sag = T/w (cosh(wL/2T) - 1)
{
  const b = new Boat('sportboat', { sailModel: 'strip' }), rs = b.rigStruct, st = rs.stays.jib;
  for (const W of [150, 400]) {
    rs.F.fill(0); rs.gravityLoads(1, 0); st.P.length = 0;
    const n = 40, pa = rs.pos(st.a, rs.u, [0, 0, 0]), pb = rs.pos(st.b, rs.u, [0, 0, 0]);
    // across the stay, to starboard
    for (let i = 0; i < n; i++) st.P.push([(i + 0.5) / n, 0, W / n, 0]);
    rs.stayPrep(st);
    for (let k = 0; k < 6; k++) rs.solve(10);
    rs.us = null;
    const mid = rs.stayAt('jib', 0.5, [0, 0, 0]);
    pa.splice(0, 3, ...rs.pos(st.a, rs.u, [0, 0, 0])); pb.splice(0, 3, ...rs.pos(st.b, rs.u, [0, 0, 0]));
    const sag = Math.hypot(mid[0] - 0.5 * (pa[0] + pb[0]), mid[1] - 0.5 * (pa[1] + pb[1]), mid[2] - 0.5 * (pa[2] + pb[2]));
    const Ls = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), w = W / Ls, T = st.T;
    const cat = T / w * (Math.cosh(w * Ls / (2 * T)) - 1);
    check(Math.abs(sag / cat - 1) < 0.03, `forestay sag with ${W} N on the luff: ${(sag * 1000).toFixed(1)} mm at T ${T.toFixed(0)} N (catenary ${(cat * 1000).toFixed(1)} mm)`);
  }
  // and the stay's tension comes from the rig: more backstay, more forestay tension, less sag
  const sagAt = (bs) => { b.ctrl.backstay = bs; rs.ready = false; rs.count = 0; for (let k = 0; k < 6; k++) { for (const w of rs.wires) w.Lrest = w.Lrest0 - (w.adjust ? w.adjust * bs : 0); rs.solve(10); } rs.us = null; return st.T; };
  const T0 = sagAt(0), T1 = sagAt(1);
  check(T1 > T0 + 1000, `backstay on: forestay tension ${T0.toFixed(0)} -> ${T1.toFixed(0)} N`);
}

// 3-5. sailing: shroud loads against the righting moment; the Hobie's mast rotation; the Laser's vang bend; the J/70's
// backstay bend (the strip model's sails, fast; the cloth sails load the rig the same way)
const sail = (cls, tws, twa, secs, set = {}) => {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls, { sailModel: 'strip' });
  b.reset(0, 0, twa * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.3;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * secs; i++) { autoTrim(b, dt); Object.assign(b.ctrl, set); b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0; }
  return b;
};
{
  const b = sail('sportboat', 14, 45, 30), L = b.rigLoads, rs = b.rigStruct;
  // the windward side is where the heel is not: port (index 0) with the wind over the port bow
  const ww = b.phi > 0 ? 0 : 1, lw = 1 - ww;
  // vertical pull of each side's shrouds, less the dock tune, times their half-beam at the chainplate: the rig's share of
  // the heeling moment about the deck
  let Mw = 0;
  for (const w of rs.wires) {
    if (!w.side || w.seg === 'upper' || !(w.key === 'capShroud' || w.key === 'lowerShroud')) continue;
    const p = w.a.p, dT = w.T - (w.pre || 0), e = w.e;
    Mw += -Math.sign(p[1]) * dT * Math.abs(e[2]) * Math.abs(p[1]);
  }
  const RM = Math.abs(b.diag.RM), hb = Math.abs(rs.wires.find((w) => w.key === 'capShroud' && w.seg === 'lower').a.p[1]);
  const est = RM / hb, Tw = L.capShroud[ww] + L.lowerShroud[ww] - L.capShroud[lw] - L.lowerShroud[lw];
  // (a rig designer's RM / half-beam puts the whole heeling moment through the shrouds; in fact the sheets take the
  // clews' share of the sails' side force straight to the hull, about half of it)
  check(Tw > 0.35 * est && Tw < 1.1 * est, `J/70 at 14 kn: windward less leeward shroud tension ${Tw.toFixed(0)} N vs RM/half-beam ${est.toFixed(0)} N (RM ${RM.toFixed(0)} N m, half-beam ${hb.toFixed(2)} m): ${(100 * Tw / est).toFixed(0)}%`);
  check(L.mastComp > 0 && L.mastStep[2] > 0 && Number.isFinite(L.forestay) && L.backstay > 0, `J/70 loads for the damage model: mast ${L.mastComp.toFixed(0)} N, step ${L.mastStep[2].toFixed(0)} N, forestay ${L.forestay.toFixed(0)} N, backstay ${L.backstay.toFixed(0)} N`);
  const bs0 = sail('sportboat', 14, 45, 20, { backstay: 0 }).diag.rig, bs1 = sail('sportboat', 14, 45, 20, { backstay: 1 }).diag.rig;
  check(bs1.bendMM > bs0.bendMM + 40 && bs1.sagMM < bs0.sagMM, `J/70 backstay: bend ${bs0.bendMM.toFixed(0)} -> ${bs1.bendMM.toFixed(0)} mm, forestay sag ${bs0.sagMM.toFixed(0)} -> ${bs1.sagMM.toFixed(0)} mm`);
}
{
  const up = sail('cat', 12, 45, 25), run = sail('cat', 12, 150, 25), lim = up.rigStruct.spec.rotating.limit;
  const r1 = Math.abs(up.rigStruct.rot) / DEG, r2 = Math.abs(run.rigStruct.rot) / DEG;
  check(r1 > 15 && r1 < 55, `Hobie 16 mast rotation upwind ${r1.toFixed(0)} deg (the luff's entry)`);
  check(r2 > r1 && r2 <= lim / DEG + 0.5, `Hobie 16 mast rotation off the wind ${r2.toFixed(0)} deg, against its limiter at ${(lim / DEG).toFixed(0)}`);
}
{
  // (the sheet held where it is: vang-sheeting, the leech tension comes from the vang)
  const soft = sail('dinghy', 14, 45, 20, { vang: 0.1, main: 0.12 }).diag.rig, hard = sail('dinghy', 14, 45, 20, { vang: 1, main: 0.12 }).diag.rig;
  check(hard.bendMM > soft.bendMM + 15, `Laser: vang on bends the unstayed mast ${soft.bendMM.toFixed(0)} -> ${hard.bendMM.toFixed(0)} mm`);
}
// 6. the wire data
check(Math.abs(wireEA(5) / 1.87e6 - 1) < 0.02, `1x19 5 mm: EA ${(wireEA(5) / 1e6).toFixed(2)} MN`);
console.log(fails ? `${fails} rig check(s) FAILED` : 'all rig checks passed');
process.exit(fails ? 1 : 0);
