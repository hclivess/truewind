// The boom through a tack and a gybe (cloth sails, js/sail/rigsim.js): the traveller car goes over along its track,
// so the boom swings across under its sheet and is not snatched; and a main by the lee gybes from the wind (the vang
// letting go when the backed main overloads it), the car following at its own pace.
//  1. tacks (the bow through the wind at 30 deg/s, the automatic crew): the boom end's second difference per 1/120 s
//     step stays under 40 mm (was ~500 mm: the car set straight onto the new side snatched the boom at 100-200 kN)
//  2. a gybe with the main eased right out: the boom goes over to the new side, without the car throwing it over
//  3. a crash gybe swings the boom hard (over 120 deg/s at mid-swing), a controlled one gently (under 90)
// Run: node test/tack-boom.mjs
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { attachSails } from '../js/sail/sailsim.js';
const DEG = Math.PI / 180, KT = 0.514444, dt = 1 / 120;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

function sail(cls, tws, from, to, wild) {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
  attachSails(b, 'cloth', 0);
  b.reset(0, 0, from * DEG); b.u = 2.5;
  let hdg = from * DEG;
  const E = [], j = [], side = [];
  for (let i = 0; i < 120 * 26; i++) {
    const t = i * dt, tgt = (t > 12 ? to : from) * DEG, d = tgt - hdg, rate = Math.sign(d) * Math.min(Math.abs(d) / dt, 30 * DEG);
    hdg += rate * dt;
    autoTrim(b, dt, 0, true);
    if (wild) { b.ctrl.main = 1; b.lines.main = 1; }
    b.step(dt, env, t); b.psi = hdg; b.r = rate; b.rudder = 0;
    const R = b.sailSys.cloth('main'), e = 3 * R.E, c = R.cloth;
    E.push([c.x[e], c.x[e + 1], c.x[e + 2]]);
    if (E.length > 3) E.shift();
    if (E.length === 3) j.push(Math.hypot(E[2][0] - 2 * E[1][0] + E[0][0], E[2][1] - 2 * E[1][1] + E[0][1], E[2][2] - 2 * E[1][2] + E[0][2]));
    if (i % 120 === 0) side.push(wild ? Math.sign(R.a) : Math.sign(R.car[1]));         // (upwind the boom is near the centreline: the car's side)
  }
  j.sort((a, b) => a - b);
  return { max: j[j.length - 1] * 1000, p99: j[Math.floor(0.99 * (j.length - 1))] * 1000, before: side[10], after: side[side.length - 1] };
}
for (const cls of ['sportboat', 'tp52']) {
  const r = sail(cls, 14, 45, -45, false);
  check(r.max < 40 && r.before !== r.after, `${cls}: tacks without snatching the boom (boom end, worst ${r.max.toFixed(1)} mm per step, p99 ${r.p99.toFixed(1)} mm; car ${r.before} -> ${r.after})`);
}
{
  const r = sail('sportboat', 16, 150, 240, true);
  check(r.before !== r.after, `sportboat: an unplanned gybe, main eased right out: the boom goes over (side ${r.before} -> ${r.after}, worst ${r.max.toFixed(0)} mm per step)`);
}
// 3. a crash gybe swings the boom hard, a controlled one does not: bearing away from 150 deg to 270 deg TWA (the wind
//    getting ahead of the boom on the new side) at 25 deg/s with the main let right out, the boom crosses at well over
//    100 deg/s at mid-swing (it crept across at 40-80 deg/s: the sail took its swing's moment into the luff's pins, and a
//    viscous boom damper took the rest); with the main hauled to the centre first, under 90 deg/s
function gybe(cls, tws, controlled) {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
  attachSails(b, 'cloth', 0);
  b.reset(0, 0, 150 * DEG); b.u = 3;
  let hdg = 150 * DEG, mid = 0, side0 = 0, side1 = 0;
  for (let i = 0; i < 120 * 24; i++) {
    const t = i * dt, tgt = (t > 12 ? 270 : 150) * DEG, d = tgt - hdg, rate = Math.sign(d) * Math.min(Math.abs(d) / dt, 25 * DEG);
    hdg += rate * dt;
    autoTrim(b, dt, 0, true);
    if (!controlled) { b.ctrl.main = 1; b.lines.main = 1; } else if (t > 4 && t < 18) b.ctrl.main = Math.max(0.05, b.ctrl.main - 0.4 * dt);
    b.step(dt, env, t); b.psi = hdg; b.r = rate; b.rudder = 0;
    const R = b.sailSys.cloth('main');
    if (t > 11 && !side0) side0 = Math.sign(R.a);
    if (t > 12 && Math.abs(R.a) < 25 * DEG) mid = Math.max(mid, Math.abs(R.rate) / DEG);
    side1 = Math.sign(R.a);
  }
  return { mid, crossed: side1 === -side0 };
}
{
  const a = gybe('sportboat', 16, false), c = gybe('sportboat', 16, true);
  check(a.crossed && a.mid > 120, `sportboat 16 kn: a crash gybe swings the boom across at ${a.mid.toFixed(0)} deg/s at mid-swing`);
  check(c.crossed && c.mid < 90, `sportboat 16 kn: a controlled gybe (main hauled in first) at ${c.mid.toFixed(0)} deg/s`);
}
console.log(fails ? `${fails} FAILED` : 'all tack and gybe boom checks passed');
process.exit(fails ? 1 : 0);
