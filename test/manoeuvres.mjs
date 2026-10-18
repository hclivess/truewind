// Manoeuvres against seamanship and published figures:
//  1. turning circle under power: cruising throttle, the helm hard over, the steady circle's diameter in boat lengths
//     (a fin-keel or skeg-hung yacht turns in ~2-4 lengths, a long keel in ~3-6: Larsson & Eliasson, Principles of
//     Yacht Design, ch. 'Rudder design'; for scale, IMO MSC.137(76) allows a ship a tactical diameter of 5 L)
//  2. shooting head to wind: from a close reach at speed in 12 kn, rounded up head to wind and the sheets let fly,
//     how far she carries her way (to 0.3 m/s): a heavy keelboat several lengths, a light dinghy one or two (RYA Day
//     Skipper / Competent Crew notes on picking up a mooring under sail: 'a heavy boat carries her way for several
//     lengths'; est. bands)
//  3. stopping under power: full astern from cruising speed, the distance to a stop in lengths (1-3 lengths for a
//     yacht with a fixed prop: RYA Diesel / boat-handling practice, est.)
//  4. full power in flat water: speed against Gerr's displacement-speed formula (The Propeller Handbook, 2001:
//     SL = 10.665 / (lb/shp)^(1/3), V = SL sqrt(LWL ft), at most ~1.4 sqrt(LWL) without planing), and the fuel
//     burn against the brake specific consumption (diesel ~0.31 L/kWh, petrol ~0.5 at full load: makers' curves)
// node test/manoeuvres.mjs   [QUICK=1: one class each]
import { suite } from './lib/check.mjs';
import { Boat, autoTrim, makeSteadyEnv, wrap, CLASSES } from '../js/physics.js';
const QUICK = !!+(process.env.QUICK || 0), KT = 0.514444, DEG = Math.PI / 180, dt = 1 / 120;
const S = suite('manoeuvres');
const calm = makeSteadyEnv(0.01);
const steps = (b, env, secs, fn) => { for (let i = 0; i < secs * 120; i++) { fn && fn(b); b.step(dt, env, b.t + dt); } };

// ---------------------------------------------------------------- 1. turning circle under power
for (const id of QUICK ? ['contessa32'] : ['contessa32', 'catalina30', 'oceanis381', 'j24', 'blackwatch', 'westsail32']) {
  const C = CLASSES[id]; if (!C.engine) continue;
  const b = new Boat(id, { sailModel: 'strip' }); b.reset(0, 0, 0);
  if (b.engine.stowed) b.engine.setStowed(false);
  b.engine.start(); steps(b, calm, 4); b.engine.throttle = 0.75;
  steps(b, calm, 40, (bb) => { bb.ctrl.helm = Math.max(-1, Math.min(1, -3 * wrap(bb.psi) - 2 * bb.r)); });
  const u0 = b.u;
  b.ctrl.helm = 1; steps(b, calm, 30);                         // into the turn, settle
  let xmin = 1e9, xmax = -1e9, zmin = 1e9, zmax = -1e9, turned = 0;
  steps(b, calm, 120, (bb) => { if (turned < 2 * Math.PI) { xmin = Math.min(xmin, bb.x); xmax = Math.max(xmax, bb.x); zmin = Math.min(zmin, bb.z); zmax = Math.max(zmax, bb.z); turned += Math.abs(bb.r) * dt; } });
  const D = 0.5 * ((xmax - xmin) + (zmax - zmin)), long = !!C.keel.long;
  S.within({ quantity: `${C.name}: steady turning circle under power, helm hard over (${(u0 / KT).toFixed(1)} kn before the turn)`, measured: D / C.loa, lo: long ? 2.5 : 1.5, hi: long ? 6.5 : 4.5, unit: 'LOA', source: 'yacht practice: fin/skeg 2-4 L, long keel 3-6 L (Larsson & Eliasson ch. 12; IMO MSC.137(76) ship limit 5 L)' });
}

// ---------------------------------------------------------------- 2. shooting head to wind
{
  const env = makeSteadyEnv(12 * KT);
  for (const [id, lo, hi] of QUICK ? [['blackwatch', 1.5, 7]] : [['blackwatch', 1.5, 7], ['j122', 2, 8], ['sportboat', 1, 5], ['dinghy', 0.4, 3], ['velsheda', 2, 9]]) {
    const b = new Boat(id, { sailModel: 'strip' }), C = b.cls; b.reset(0, 0, -60 * DEG); b.u = 2;
    steps(b, env, 40, (bb) => { autoTrim(bb, dt); bb.ctrl.helm = Math.max(-1, Math.min(1, -2.5 * wrap(bb.psi + 60 * DEG) - 2 * bb.r)); });
    const u0 = b.u, x0 = b.x, z0 = b.z;
    let t = 0, dist = null;
    // round up and hold her head to wind, everything eased
    for (const k of ['main', 'jib', 'stay', 'mizzen', 'fore']) if (k in b.ctrl) b.ctrl[k] = 1;
    b.ctrl.gen = false;
    for (; t < 120 && dist === null; t += dt) {
      b.ctrl.helm = Math.max(-1, Math.min(1, -2.5 * wrap(b.psi - 0) - 2 * b.r));
      b.step(dt, env, b.t + dt);
      if (b.u < 0.3) dist = Math.hypot(b.x - x0, b.z - z0);
    }
    S.within({ quantity: `${C.name}: carries her way head to wind from ${(u0 / KT).toFixed(1)} kn (to 0.3 m/s)`, measured: (dist ?? 999) / C.loa, lo, hi, unit: 'LOA', source: 'seamanship (RYA): heavy boats several lengths, light dinghies 1-2 (est. bands)' });
  }
}

// ---------------------------------------------------------------- 3. crash stop under power
for (const id of QUICK ? ['contessa32'] : ['contessa32', 'oceanis381', 'blackwatch']) {
  const C = CLASSES[id]; if (!C.engine) continue;
  const b = new Boat(id, { sailModel: 'strip' }); b.reset(0, 0, 0);
  if (b.engine.stowed) b.engine.setStowed(false);
  b.engine.start(); steps(b, calm, 4); b.engine.throttle = 0.75;
  steps(b, calm, 40, (bb) => { bb.ctrl.helm = Math.max(-1, Math.min(1, -3 * wrap(bb.psi) - 2 * bb.r)); });
  const u0 = b.u, x0 = b.x, z0 = b.z; b.engine.throttle = -1; b.ctrl.helm = 0;
  let t = 0; while (b.u > 0.05 && t < 60) { b.step(dt, calm, b.t + dt); t += dt; }
  S.within({ quantity: `${C.name}: full astern from ${(u0 / KT).toFixed(1)} kn, distance to a stop`, measured: Math.hypot(b.x - x0, b.z - z0) / C.loa, lo: 0.5, hi: 4, unit: 'LOA', source: 'boat-handling practice: 1-3 lengths with a fixed prop (est.)' });
  S.within({ quantity: `${C.name}: time to the stop`, measured: t, lo: 3, hi: 25, unit: 's', source: 'est.: gearbox through neutral ~1-2 s, then the prop astern' });
}
// ---------------------------------------------------------------- 4. full power: speed and fuel
for (const id of QUICK ? ['contessa32'] : ['contessa32', 'catalina30', 'oceanis381', 'westsail32', 'j122', 'folkboat', 'blackwatch', 'sportboat']) {
  const C = CLASSES[id]; if (!C.engine) continue;
  const b = new Boat(id, { sailModel: 'strip' }); b.reset(0, 0, 0);
  if (b.engine.stowed) b.engine.setStowed(false);
  b.engine.start(); steps(b, calm, 4); b.engine.throttle = 1;
  steps(b, calm, 60, (bb) => { bb.ctrl.helm = Math.max(-1, Math.min(1, -3 * wrap(bb.psi) - 2 * bb.r)); });
  const lb = b.mass / 0.4536, shp = C.engine.kW / 0.7457 * 0.95, lwlFt = C.lwl / 0.3048;   // (shaft hp: ~5% lost in the gearbox)
  const gerr = Math.min(10.665 / Math.cbrt(lb / shp), 1.4) * Math.sqrt(lwlFt);
  S.near({ quantity: `${C.name} (${C.engine.kW.toFixed(0)} kW, ${Math.round(b.mass)} kg): full-power speed in flat water`, measured: b.u / KT, expected: gerr, tol: 0.2, rel: true, unit: 'kn', source: "Gerr, The Propeller Handbook (2001): SL = 10.665/(lb/shp)^(1/3), capped at 1.4" });
  const fuel = C.engine.fuel === 'petrol' ? 0.51 : 0.31;
  S.near({ quantity: `${C.name}: fuel at full power`, measured: b.engine.lh, expected: fuel * C.engine.kW, tol: 0.4, rel: true, unit: 'L/h', source: `BSFC at full load ~${fuel} L/kWh (${C.engine.fuel}; makers' curves, e.g. Yanmar GM series)` });
}
S.done();
