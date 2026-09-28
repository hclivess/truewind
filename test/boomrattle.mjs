// The boom of a luffing or pinching main (cloth sails, the player's level): an 18 kg boom sheeted hard in, with its
// vang, cannot rattle; eased, it wanders with the luffing sail but does not swing through half the quadrant.
//  pinch: 25 deg true, 12 kn, the automatic crew (sheet hard in): the boom holds within a couple of degrees, no slams
//  luff:  45 deg true, 12 kn, main and jib sheets eased to 0.7 (the sail luffing): the boom within about +-10 deg
// Heading held, as the VPP does. node test/boomrattle.mjs [class]
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';
const KT = 0.514444, DEG = Math.PI / 180, dt = 1 / 120;
let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
function run(cls, twa, ease, tws = 12) {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls); b.reset(0, 0, twa * DEG); b.u = 1.5;
  const trim = () => { autoTrim(b, dt); if (ease !== null) { b.ctrl.main = b.lines.main = ease; b.ctrl.jib = b.lines.jib = ease; } };
  const hold = () => { b.r = 0; b.psi = twa * DEG; b.rudder = 0; };
  for (let i = 0; i < 120 * 12; i++) { trim(); b.step(dt, env, i * dt); hold(); }
  const A = [], slam0 = b.slamEvents || 0; let rate = 0;
  for (let i = 0; i < 120 * 15; i++) { trim(); b.step(dt, env, (1440 + i) * dt); hold(); A.push(b.booms.main.a / DEG); rate = Math.max(rate, Math.abs(b.booms.main.rate || 0) / DEG); }
  const m = A.reduce((s, x) => s + x, 0) / A.length, sd = Math.sqrt(A.reduce((s, x) => s + (x - m) ** 2, 0) / A.length);
  return { m, sd, lo: Math.min(...A), hi: Math.max(...A), rate, slams: (b.slamEvents || 0) - slam0 };
}
const fmt = (r) => `boom ${r.m.toFixed(1)} deg +-${r.sd.toFixed(1)} (${r.lo.toFixed(0)}..${r.hi.toFixed(0)}), peak ${r.rate.toFixed(0)} deg/s, ${r.slams} slams`;
for (const cls of process.argv[2] ? [process.argv[2]] : ['blackwatch', 'sportboat', 'dinghy']) {
  const p = run(cls, 25, null);
  check(p.sd < 2 && p.rate < 60 && p.slams <= 2, `${cls.padEnd(10)} pinching, sheet hard in: ${fmt(p)}`);
  const l = run(cls, 45, 0.7);
  check(l.sd < 11 && l.hi - l.lo < 40 && l.rate < 90, `${cls.padEnd(10)} luffing, sheets eased: ${fmt(l)}`);
}
console.log(bad ? `${bad} check(s) FAILED` : 'all boom rattle checks passed');
process.exit(bad ? 1 : 0);
