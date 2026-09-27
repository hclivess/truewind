// Auxiliary engines (js/engine.js): bollard pull, top speed under power in flat calm, stopping distance going
// astern, prop walk, a low-speed turn with and without the propwash on the rudder, and what a stopped engine costs
// under sail (the strip-model VPP, which runs the full dynamic model; the cloth sails' polars are baked).
import { Boat, CLASSES, solvePolarAngle } from '../js/physics.js';
import { Prop } from '../js/engine.js';
const KT = 0.514444, DEG = Math.PI / 180, dt = 1 / 120, HP = 0.7457;
const calm = { wind: { sample: (x, z, t, o) => { o.speed = 0; o.dir = 0; o.puff = 0; return o; }, profile: () => 1 },
  current: { at: (x, z, o) => { o.x = 0; o.z = 0; return o; } }, wavesOn: false };
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// a test vehicle for the inboard: the Blackwatch hull with a Yanmar 1GM10 (9 hp at 3600 rpm, 2.21:1) on an 8 degree
// shaft, a 13 x 9 in two-blade prop in the aperture ahead of the transom-hung rudder (the schema the other classes use)
const inboard = (prop = {}, extra = {}) => ({ ...CLASSES.blackwatch, engine: { type: 'inboard', model: 'Yanmar 1GM10', kW: 6.7, rpmMax: 3600, rpmIdle: 850, cyl: 1, fuel: 'diesel', gear: 2.21,
  prop: { D: 0.33, P: 0.23, Z: 2, BAR: 0.35, folding: false, rh: 1, ...prop }, pos: [-2.42, 0, -0.45], shaftAngle: 8 * DEG, mount: [-1.4, 0, -0.05],
  mass: 71, inMass: true, exhaust: [-3.05, 0.3, 0.25], ...extra } });

// the propeller alone: B3-50, P/D 0.8 (Wageningen charts: KT(0) ~ 0.31, 10 KQ(0) ~ 0.37, KT = 0 near J = 0.88)
{
  const p = new Prop({ D: 0.2, P: 0.16, Z: 3, BAR: 0.5 });
  console.log(`B3-50 P/D 0.8: KT(0) ${p.KT(0).toFixed(3)}  10KQ(0) ${(10 * p.KQ(0)).toFixed(3)}  KT=0 at J ${p.J0.toFixed(3)}  eta(0.6) ${(0.6 * p.KT(0.6) / (2 * Math.PI * p.KQ(0.6))).toFixed(2)}`);
  check(Math.abs(p.KT(0) - 0.31) < 0.03 && Math.abs(p.J0 - 0.88) < 0.06, 'B-series polynomial matches the published chart');
  // four quadrants: continuous, braking where it should
  const o = {}; let prev = null, jump = 0;
  for (let b = -Math.PI + 1e-3; b <= Math.PI; b += 0.01) { p.coef(b, o); if (prev) jump = Math.max(jump, Math.abs(o.ct - prev)); prev = o.ct; }
  const at = (deg) => (p.coef(deg * DEG, o), o.ct);
  console.log(`CT*: 0° ${at(0).toFixed(3)}  90° (locked) ${at(90).toFixed(3)}  135° ${at(135).toFixed(3)}  180° (astern bollard) ${at(180).toFixed(3)}  -90° ${at(-90).toFixed(3)}  max step ${jump.toFixed(3)}`);
  check(jump < 0.03 && at(90) < 0 && at(180) < 0 && at(-90) > 0 && at(180) > -at(0), 'four-quadrant CT* continuous, signs right, astern weaker than ahead');
}

function run(C, secs, fn, b = null) {
  b = b || new Boat(C, { sailModel: 'strip' });
  for (let i = 0; i < secs * 120; i++) { fn && fn(b, i * dt); b.step(dt, calm, b.t + dt); }
  return b;
}
function underway(C, thr = 1, secs = 60) {
  const b = new Boat(C, { sailModel: 'strip' }); b.reset(0, 0, 0);
  if (b.engine.stowed) b.engine.setStowed(false);
  b.engine.start(); run(C, 4, null, b); b.engine.throttle = thr;
  // a helmsman holding the heading (an off-centre outboard's thrust turns the boat)
  run(C, secs, (bb) => { bb.ctrl.helm = Math.max(-1, Math.min(1, -3 * bb.psi - 2 * bb.r)); }, b);
  return b;
}

// ---- bollard pull and top speed ----
for (const [cls, C, vmin, vmax] of [['blackwatch', CLASSES.blackwatch, 4.4, 5.6], ['sportboat', CLASSES.sportboat, 5.0, 6.3], ['bw-inboard', inboard(), 5.2, 6.6]]) {
  const b = new Boat(C, { sailModel: 'strip' }); b.reset(0, 0, 0); b.engine.setStowed(false); b.engine.start();
  run(C, 4, null, b); b.engine.throttle = 1;
  let T = 0, n = 0;
  run(C, 6, (bb, t) => { bb.u = 0; bb.v = 0; bb.r = 0; if (t > 3) { T += bb.engine.X; n++; } }, b);
  const kg = T / n / 9.81, hp = C.engine.kW / HP;
  const u = underway(C, 1, 90);
  console.log(`${cls.padEnd(11)} ${C.engine.model}: bollard ${kg.toFixed(1)} kg (${(kg / hp).toFixed(1)} kg/hp) at ${b.engine.rpm.toFixed(0)} rpm | top ${(u.u / KT).toFixed(2)} kn at ${u.engine.rpm.toFixed(0)} rpm, ${u.engine.lh.toFixed(2)} L/h, trim ${(u.pitch / DEG).toFixed(2)}° bow up`);
  check(kg / hp > 8.5 && kg / hp < 16, `${cls}: bollard pull ${(kg / hp).toFixed(1)} kg/hp (small outboards and auxiliaries: ~10-14)`);
  check(u.u / KT > vmin && u.u / KT < vmax, `${cls}: ${(u.u / KT).toFixed(2)} kn under power in flat water (${vmin}-${vmax})`);
}

// ---- crash stop: full ahead, then full astern ----
for (const [cls, C] of [['blackwatch', CLASSES.blackwatch], ['sportboat', CLASSES.sportboat], ['bw-inboard', inboard()]]) {
  const b = underway(C, 1, 60), u0 = b.u, x0 = b.x, z0 = b.z;
  b.engine.throttle = -1; b.ctrl.helm = 0;
  let t = 0, tRev = null;
  while (b.u > 0 && t < 60) { b.step(dt, calm, b.t + dt); t += dt; if (tRev === null && b.engine.gear < 0) tRev = t; }
  const d = Math.hypot(b.x - x0, b.z - z0);
  console.log(`${cls.padEnd(11)} crash stop from ${(u0 / KT).toFixed(1)} kn: astern engaged after ${tRev?.toFixed(1)} s, stopped in ${t.toFixed(1)} s over ${d.toFixed(1)} m (${(d / C.loa).toFixed(1)} boat lengths)`);
  check(t < 30 && d < 8 * C.loa, `${cls}: stops going astern within ${(d / C.loa).toFixed(1)} lengths`);
}

// ---- prop walk: from rest, astern, helm amidships ----
for (const rh of [1, -1]) {
  const C = inboard({ rh });
  const b = new Boat(C, { sailModel: 'strip' }); b.reset(0, 0, 0); b.engine.start(); run(C, 4, null, b);
  b.engine.throttle = -0.7; b.ctrl.helm = 0;
  run(C, 8, null, b);
  // the stern going to port = the bow swinging to starboard (psi increasing)
  console.log(`prop walk, ${rh > 0 ? 'right' : 'left'}-handed, 8 s astern from rest: ${(b.u / KT).toFixed(2)} kn, heading ${(b.psi / DEG).toFixed(1)}° (${b.psi > 0 ? 'stern to port' : 'stern to starboard'}), side force ${b.engine.walk.toFixed(0)} N`);
  check(rh > 0 ? b.psi > 3 * DEG : b.psi < -3 * DEG, `${rh > 0 ? 'right' : 'left'}-handed prop walks the stern to ${rh > 0 ? 'port' : 'starboard'} going astern`);
}

// ---- low-speed turn: helm hard over from rest, half ahead; the propwash makes the rudder bite ----
{
  const res = {};
  for (const wash of [true, false]) {
    const C = inboard({}, { wash });
    const b = new Boat(C, { sailModel: 'strip' }); b.reset(0, 0, 0); b.engine.start(); run(C, 4, null, b);
    b.engine.throttle = 0.45; b.ctrl.helm = -1;
    // the kick: how far the bow swings in the first 6 s from rest
    run(C, 6, null, b); const kick = Math.abs(b.psi) / DEG;
    // then the steady circle
    let xmin = 1e9, xmax = -1e9;
    run(C, 60, null, b);
    run(C, 60, (bb) => { xmin = Math.min(xmin, bb.x); xmax = Math.max(xmax, bb.x); }, b);
    res[wash] = { kick, D: xmax - xmin, u: b.u, r: b.r };
    console.log(`low-speed turn, half ahead, helm hard over, ${wash ? 'with' : 'no  '} propwash: bow swings ${kick.toFixed(0)}° in 6 s from rest; circle ${(xmax - xmin).toFixed(1)} m (${((xmax - xmin) / C.loa).toFixed(1)} L) at ${(b.u / KT).toFixed(1)} kn`);
  }
  check(res[true].kick > 1.3 * res[false].kick && res[true].D < res[false].D, 'propwash kicks the stern round and tightens the turn');
}

// ---- a stopped engine under sail: drag towed at 5 kn and the strip VPP ----
{
  const tow = (C, kn, setup) => {
    const b = new Boat(C, { sailModel: 'strip' }); b.reset(0, 0, 0); setup && setup(b);
    let X = 0, n = 0, rpm = 0;
    run(C, 20, (bb, t) => { bb.u = kn * KT; bb.v = 0; bb.r = 0; if (t > 15) { X += bb.engine.X; rpm += bb.engine.n * 60; n++; } }, b);
    return { X: X / n, rpm: rpm / n };
  };
  const cfg = [
    ['folding prop', inboard({ folding: true })],
    ['fixed, windmilling', inboard({ folding: false })],
    ['fixed, locked in gear', inboard({ folding: false }, { lockWhenOff: true })],
  ];
  for (const [name, C] of cfg) for (const kn of [3, 5, 6]) {
    const r = tow(C, kn);
    console.log(`drag of a stopped ${name.padEnd(22)} at ${kn} kn: ${(-r.X).toFixed(1)} N${Math.abs(r.rpm) > 1 ? ` (shaft ${r.rpm.toFixed(0)} rpm)` : ''}`);
  }
  const bare = { ...CLASSES.blackwatch, engine: null }, spNone = { ...CLASSES.sportboat, engine: null };
  const vpp = (C, twa) => solvePolarAngle(C, 12 * KT, twa, { sailModel: 'strip' }).bsp / KT;
  for (const twa of [45, 90, 135]) {
    const s0 = vpp(spNone, twa), s1 = vpp(CLASSES.sportboat, twa);
    const b0 = vpp(bare, twa), bo = vpp(CLASSES.blackwatch, twa), bf = vpp(inboard({ folding: true }), twa), bw = vpp(inboard({ folding: false }), twa), bl = vpp(inboard({ folding: false }, { lockWhenOff: true }), twa);
    const pc = (v) => `${v.toFixed(2)} (${((v / b0 - 1) * 100).toFixed(1)}%)`;
    console.log(`VPP 12 kn TWA ${twa}°: J/70 no engine ${s0.toFixed(3)} / stowed outboard ${s1.toFixed(3)} kn | Blackwatch bare ${b0.toFixed(2)}, raised 26 kg outboard ${pc(bo)}, inboard folding ${pc(bf)}, fixed windmilling ${pc(bw)}, fixed locked ${pc(bl)}`);
    check(s0 === s1, `J/70 with its outboard stowed sails exactly as without (TWA ${twa}°)`);
    check(Math.abs(bf / b0 - 1) < 0.005, `folding prop: sailing speed unchanged within 0.5% (TWA ${twa}°)`);
    check(bw < bf && bw / b0 > 0.9 && bl <= bw * 1.01, `fixed prop: slightly slower (TWA ${twa}°)`);
  }
}
if (fails) { console.log(`${fails} check(s) failed`); process.exit(1); }
console.log('all engine checks passed');
