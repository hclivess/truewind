// Appendages as foils (js/foils.js): lift slope against Helmbold, stall and its hysteresis, ventilation onset and
// washout, cavitation onset speed, the daggerboard raised, the kick-up blade.
import { CLASSES } from '../js/physics.js';
import { foilSpec, foilState, foilGeom, foilCoef, helmbold, clMax2D, cd0Section, cpMin, kickUpdate } from '../js/foils.js';
const DEG = Math.PI / 180, KT = 0.514444;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const zw0 = () => 0;
const coefAt = (S, g, a, V, st = foilState(), dt = 1) => foilCoef(S, st, a, V, g, dt, {});

// 1. lift slope: the J/70 keel under its hull (end-plated) and the rudder at the surface, against Helmbold
{
  const S = foilSpec(CLASSES.sportboat, 'keel'), g = foilGeom(S, 1, 0, zw0, 1, 0, 0, 3, {});
  const c = coefAt(S, g, 2 * DEG, 3), ARg = S.span / S.chord, a0 = 0.95 * 2 * Math.PI;
  // (x the canoe body's share: the class's ARe 5.0 over the bare fin's 4.8)
  const slope = c.cl / (2 * DEG), hb = helmbold(ARg * (1 + 0.9 + 0.15) * S.hullShare, a0);
  check(Math.abs(slope / hb - 1) < 0.01 && S.hullShare > 1 && S.hullShare < 1.1, `J/70 keel lift slope ${slope.toFixed(2)} /rad = Helmbold on AR ${ARg.toFixed(2)} x (1 + 0.9 hull end plate + 0.15 bulb) x ${S.hullShare.toFixed(2)} hull share ${hb.toFixed(2)}`);
  // a fin under a deep canoe body keeps the class's ARe with the hull's share (J/24: 3.0, its bare fin 1.6), and heeled
  // the hull's end plate weakens (Keuning & Sonnenberg's effective draft)
  const J = foilSpec(CLASSES.j24, 'keel'), gJ = foilGeom(J, 1, 0, zw0, 1, 0, 0, 3, {}), gH = foilGeom(J, 1, 0, zw0, Math.cos(25 * DEG), Math.sin(25 * DEG), 0, 3, {});
  check(Math.abs(gJ.ARe - 3.0) < 0.05 && gH.ARe < 0.85 * gJ.ARe, `J/24 keel AR_e ${gJ.ARe.toFixed(2)} upright (class 3.0), ${gH.ARe.toFixed(2)} at 25 deg of heel`);
  const R = foilSpec(CLASSES.sportboat, 'rudder');
  const lo = foilGeom(R, 1, 0, zw0, 1, 0, 0, 0.5, {}), hi = foilGeom(R, 1, 0, zw0, 1, 0, 0, 8, {});
  check(lo.ARe > 1.6 * hi.ARe, `transom-hung rudder: the surface an end plate at low speed (AR_e ${lo.ARe.toFixed(2)}), a free tip at high speed (${hi.ARe.toFixed(2)})`);
}
// 2. stall: Reynolds-dependent CLmax, stall angle, hysteresis
{
  check(clMax2D(1e6) > clMax2D(2e5) + 0.25, `NACA 0012 CLmax ${clMax2D(2e5).toFixed(2)} at Re 2e5, ${clMax2D(1e6).toFixed(2)} at 1e6, ${clMax2D(3e6).toFixed(2)} at 3e6`);
  check(cd0Section(3e5, 0.12) > cd0Section(3e6, 0.12), `section drag ${cd0Section(3e5, 0.12).toFixed(4)} at Re 3e5, ${cd0Section(3e6, 0.12).toFixed(4)} at 3e6`);
  const S = foilSpec(CLASSES.sportboat, 'keel'), g = foilGeom(S, 1, 0, zw0, 1, 0, 0, 3, {}), st = foilState();
  let ast = 0, clPeak = 0;
  for (let a = 0; a < 30; a += 0.25) { const c = coefAt(S, g, a * DEG, 3, st, 1); if (c.cl > clPeak) { clPeak = c.cl; ast = a; } }
  check(ast > 12 && ast < 20, `J/70 keel at 3 m/s stalls at ${ast.toFixed(1)} deg (CL ${clPeak.toFixed(2)})`);
  // coming back down: still separated below the stall angle, reattached below 0.8 of it
  const c1 = coefAt(S, g, (ast - 1.5) * DEG, 3, st, 1), sep1 = st.sep;
  for (let k = 0; k < 20; k++) coefAt(S, g, 0.7 * ast * DEG, 3, st, 1);
  check(sep1 > 0.5 && st.sep < 0.1, `stall hysteresis: at ${(ast - 1.5).toFixed(1)} deg on the way down still separated (${sep1.toFixed(2)}, CL ${c1.cl.toFixed(2)}), reattached at ${(0.7 * ast).toFixed(1)} deg`);
}
// 3. ventilation: a surface-piercing rudder at speed ventilates past its inception angle, washes out well below it;
// the same blade a chord deep does not
{
  const R = foilSpec(CLASSES.sportboat, 'rudder'), V = 4.5;
  const g = foilGeom(R, 1, 0, zw0, 1, 0, 0, V, {}), st = foilState();
  let aOn = null;
  for (let a = 0; a <= 30; a += 0.5) { coefAt(R, g, a * DEG, V, st, 0.5); if (aOn === null && st.vent > 0.5) aOn = a; }
  let aOff = null;
  for (let a = 30; a >= 0; a -= 0.5) { coefAt(R, g, a * DEG, V, st, 0.5); if (aOff === null && st.vent < 0.5) aOff = a; }
  check(aOn !== null && aOn > 9 && aOn < 22 && aOff < 0.6 * aOn, `J/70 rudder at ${(V / KT).toFixed(1)} kn: ventilates at ${aOn} deg, washes out at ${aOff} deg`);
  const deep = () => R.F.z + R.span / 2 + 1.2 * R.chord;                   // water 1.2 chords above the blade's root
  const gd = foilGeom(R, 1, 0, deep, 1, 0, 0, V, {}), sd = foilState();
  for (let a = 0; a <= 30; a += 0.5) coefAt(R, gd, a * DEG, V, sd, 0.5);
  check(sd.vent < 0.1, `the same blade with its root 1.2 chords under water does not ventilate (${sd.vent.toFixed(2)})`);
  const c0 = coefAt(R, g, 12 * DEG, V, foilState(), 0.01), sv = foilState();
  for (let a = 0; a <= 25; a += 0.5) coefAt(R, g, a * DEG, V, sv, 0.5);
  const cv = coefAt(R, g, 12 * DEG, V, sv, 0.01);
  check(sv.ventOn && cv.cl < 0.6 * c0.cl, `ventilated, the blade's lift at 12 deg falls from CL ${c0.cl.toFixed(2)} to ${cv.cl.toFixed(2)}`);
}
// 4. cavitation: the Hobie's rudder loaded to CL 0.5 cavitates from ~20 kn; unloaded from ~40 kn
{
  const R = foilSpec(CLASSES.cat, 'rudder'), h = 0.3;
  const onset = (cl) => Math.sqrt((101325 + 1025 * 9.81 * h - 2340) / (0.5 * 1025 * cpMin(cl, R.tc))) / KT;
  const v5 = onset(0.5), v0 = onset(0.05);
  check(v5 > 16 && v5 < 26 && v0 > 35, `Hobie 16 rudder (t/c ${R.tc}) cavitation onset: ${v5.toFixed(1)} kn at CL 0.5, ${v0.toFixed(1)} kn lightly loaded`);
  const g = foilGeom(R, 1, 0, zw0, 1, 0, 0, 11, {});
  const slow = coefAt(R, g, 8 * DEG, 5, foilState()), fast = coefAt(R, g, 8 * DEG, 13, foilState());
  check(slow.cav === 0 && fast.cav > 0.1, `at 8 deg: no cavitation at ${(5 / KT).toFixed(0)} kn, ${Math.round(fast.cav * 100)}% of the lift lost at ${(13 / KT).toFixed(0)} kn`);
}
// 5. the Laser's daggerboard raised: less area and aspect ratio, its centre higher
{
  const S = foilSpec(CLASSES.dinghy, 'keel'), down = foilGeom(S, 1, 0, zw0, 1, 0, 0, 2.5, {}), half = foilGeom(S, 0.5, 0, zw0, 1, 0, 0, 2.5, {});
  check(Math.abs(half.area / down.area - 0.5) < 0.01 && half.ARe < 0.6 * down.ARe && half.z > down.z + 0.15, `Laser board half up: area ${down.area.toFixed(3)} -> ${half.area.toFixed(3)} m2, AR_e ${down.ARe.toFixed(2)} -> ${half.ARe.toFixed(2)}, centre ${down.z.toFixed(2)} -> ${half.z.toFixed(2)} m`);
}
// 6. kick-up rudder: the bottom pushes it up; the crew puts it down again in deep water
{
  const R = foilSpec(CLASSES.cat, 'rudder'), st = foilState(), tip = R.span / 2 - R.F.z;
  kickUpdate(R, st, 0.3, tip, 0.1);
  const g = foilGeom(R, 1, st.kick, zw0, 1, 0, 0, 3, {}), g0 = foilGeom(R, 1, 0, zw0, 1, 0, 0, 3, {});
  check(st.kick > 0.3 && g.span < g0.span && g.x < g0.x, `Hobie rudder kicked up in 0.3 m of water: ${Math.round(st.kick * 75)} deg, span ${g0.span.toFixed(2)} -> ${g.span.toFixed(2)} m, its centre ${(g0.x - g.x).toFixed(2)} m further aft`);
  for (let i = 0; i < 100; i++) kickUpdate(R, st, 3, tip, 0.1);
  check(st.kick === 0, 'relatched after a few seconds in deep water');
}
console.log(fails ? `${fails} foil check(s) FAILED` : 'all foil checks passed');
process.exit(fails ? 1 : 0);
