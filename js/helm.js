// The helm: the rudder's stock torque, what the sailor feels through the tiller or the wheel, and how fast the rudder
// can be put over against it.
//
//  * Stock torque Q = N (x_cp - x_stock): the blade's normal force (js/foils.js) acting at its centre of pressure
//    (quarter chord attached, further aft stalled, ventilated or cavitating; a kicked-up blade's is far aft) about the
//    stock axis, which sits balance x chord behind the leading edge: ~0 on a transom-hung barn door (all the load is
//    felt), 0.17-0.22 on a balanced spade (little is felt, and past a few degrees of rudder the centre of pressure
//    goes aft of the axis again). Q > 0 turns the blade toward more rudder angle; a blade with its centre of pressure
//    aft of the axis weathervanes back toward the flow, and the helm holds it there.
//  * Tiller: hand force F = Q / lever, the lever being the tiller (the extension's joint is at its end);
//    Wheel: rim force F = Q / (G R) with G the steering gear ratio (wheel turns lock to lock x 2 pi / rudder travel)
//    and R the wheel radius, plus the cable/quadrant friction.
//  * Putting the rudder over: the helm moves it at the rate a hand can move the tiller or the rim (tiller ~1.5 rad/s,
//    a wheel rim ~1.2 m/s), slower in proportion as the torque against it approaches what the sailor can push (~400 N
//    on a tiller, ~250 N on a rim); a torque beyond that takes the rudder back (the helm is overpowered: a broach).
//
// Per class (all optional, C.helm): { type: 'tiller' | 'wheel', tiller: m, extension: m, wheelR: m, turns: lock-to-lock
// turns, handMax: N, friction: N m }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

const HELM_DATA = {
  // tiller lengths as modelled (models.js): Blackwatch's curved wooden tiller, the J/70's composite one, the
  // Laser's aluminium tiller and extension, the Hobie's short arms to the crossbar and the long extension
  blackwatch: { type: 'tiller', tiller: 1.15, extension: 0 },
  sportboat: { type: 'tiller', tiller: 1.05, extension: 1.2 },
  dinghy: { type: 'tiller', tiller: 0.9, extension: 1.0 },
  cat: { type: 'tiller', tiller: 0.42, extension: 1.5 },
};

export function helmSpec(C) {
  // (a class described for the drawing (C.model.steering: 'tiller' with its length and extension, 'wheel' or 'twin'
  // wheels with their radius) steers as drawn)
  const St = (C.model && C.model.steering) || (C.wheel ? { kind: 'wheel', r: C.wheel.r } : null);
  const fromModel = St ? (St.kind === 'wheel' || St.kind === 'twin' ? { type: 'wheel', wheelR: St.r } : { type: 'tiller', tiller: St.len, extension: St.extension ?? 0 }) : {};
  const D = { ...fromModel, ...(HELM_DATA[C.id] || {}), ...(C.helm || {}) };
  const type = D.type || 'tiller';
  const maxA = C.rudder.max ?? 0.6;
  if (type === 'wheel') {
    const R = D.wheelR ?? clamp(0.12 * C.loa ** 0.6, 0.35, 0.7), turns = D.turns ?? 1.6;
    const gear = turns * 2 * Math.PI / (2 * maxA);                    // wheel angle per rudder angle
    return { type, R, turns, gear, lever: gear * R, handMax: D.handMax ?? 250, rate: (D.rimSpeed ?? 1.2) / (gear * R),
      friction: D.friction ?? 4 + 0.6 * C.loa, tiller: 0, extension: 0 };
  }
  const tiller = D.tiller ?? clamp(0.19 * C.loa, 0.6, 1.6), extension = D.extension ?? (C.loa < 8 ? 1.0 : 0);
  // (the extension's joint is at the tiller's end: whatever the angle it is held at, it pushes the tiller there)
  return { type, tiller, extension, lever: tiller, handMax: D.handMax ?? 400, rate: D.rate ?? 1.5, friction: D.friction ?? 0.5, gear: 1, R: 0 };
}

// hydrodynamic torque about the stock (N m, + = toward more rudder angle) of a blade with normal force coefficient cn
// on area A at dynamic pressure q, centre of pressure xcp and axis at balance (fractions of chord from the leading edge)
export function stockTorque(cn, q, A, chord, xcp, balance) { return -cn * q * A * chord * (xcp - balance); }

// the hand force the helm needs to hold the rudder (N, + = pushing toward more rudder angle), and its feel
export function helmForce(H, Q) { return -Q / H.lever; }
export function helmFeel(F) { const f = Math.abs(F); return f < 25 ? 'light' : f < 70 ? 'firm' : f < 150 ? 'heavy' : 'fighting'; }

// rudder angle this step: toward the helm's target at the rate the hand manages against the torque Q (N m, + toward
// more angle); overpowered, the blade is taken back. Returns the new angle.
export function rudderStep(H, rudder, target, Q, maxA, dt) {
  const Qmax = H.handMax * H.lever, err = target - rudder;
  // the helm's command: fast toward the target, easing in over the last few degrees
  let w = clamp(err * 8, -H.rate, H.rate);
  if (Math.abs(Q) > Qmax) {
    // overpowered: the water takes the blade back
    w = Math.sign(Q) * H.rate * clamp(Math.abs(Q) / Qmax - 1, 0, 1);
  } else if (w * Q < 0) w *= 1 - Math.abs(Q) / Qmax;                // working against the load
  return clamp(rudder + w * dt, -maxA, maxA);
}
