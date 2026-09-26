// Auxiliary engines: an outboard on a transom bracket, an inboard on a shaft, or a saildrive leg, turning a
// propeller through a reduction gear. Everything the engine does to the boat is a force at the propeller (or on the
// outboard's leg), a propwash on the rudder, and a weight where the engine is.
//
//  * PROPELLER: Wageningen B-series open-water polynomials (Oosterveld & van Oossanen 1975, 39 KT and 47 KQ terms,
//    Re 2e6) for the first quadrant (turning ahead, moving ahead) up to the advance ratio J = Va / nD where the thrust
//    vanishes. The rest of the four quadrants is written in the advance angle beta = atan(Va / 0.7 pi n D) with
//    CT* = T / (1/2 rho Vr^2 A0), CQ* = Q / (1/2 rho Vr^2 A0 D), Vr^2 = Va^2 + (0.7 pi n D)^2, which stays finite through
//    n = 0: past the zero-thrust J the coefficients run smoothly to those of a locked propeller at beta = 90 deg (a flat
//    plate at the blades' pitch angle meeting the flow: CT* = -1.15 BAR cos^2 phi, CQ* = -0.4 BAR sin phi cos phi); the
//    third quadrant (turning astern, moving astern) is the first run backwards at 62% of the thrust and 85% of the torque
//    (a B-series blade working trailing edge first: astern bollard pull is 55-70% of ahead); the second and fourth (crash
//    stops) are smooth blends between their neighbours with a bump of extra braking. That is the shape of the published
//    four-quadrant series (van Lammeren et al. 1969), not their Fourier fits: honest in sign, magnitude and continuity.
//    Va = u_axial (1 - w) with the Taylor wake fraction w; the hull feels T (1 - t), t the thrust deduction.
//  * ENGINE: torque curve peaking at 115% of the rated torque at 65% of the rated rpm, friction and pumping torque,
//    a rev limiter, an all-speed governor (the throttle lever sets the rpm; the rack is proportional with 8% droop plus a
//    little integral) and the rotating inertia of the engine through the gear. The shaft is integrated with implicit
//    Euler on sub-steps (the governor and the propeller's torque are stiff against the small inertia). Load it past its
//    torque and it lugs down; below half its idle it stalls.
//  * GEAR: one lever, throttle -1..1 with a neutral detent (|throttle| < 0.1). Shifting goes through neutral: the gear
//    engages after a delay and only once the engine is back near idle (as a cone clutch wants).
//  * STOPPED: a folding prop folds (only its hub's drag is left); a fixed prop windmills in neutral (it spins up until
//    its torque balances the shaft seal and gearbox drag, beta past the zero-thrust point: drag) or, if the crew leave the
//    box in gear (lockWhenOff), it is locked (more drag). An outboard is tilted clear of the water (no drag at all).
//  * PROP WALK: the paddle-wheel / asymmetric blade loading side force, a fraction of the thrust (larger astern, larger
//    with the shaft angle, fading once water flows past the stern): a right-handed prop (rh +1) walks the stern to port
//    going astern, to starboard going ahead.
//  * PROPWASH: a rudder right behind the prop sits in the slipstream (momentum theory: far-wake speed
//    sqrt(Va^2 + 8T / rho pi D^2), 75% of the increase reached at the rudder) over the part of its span the contracted jet
//    covers: its inflow is the area-weighted dynamic pressure, so a burst ahead kicks the stern round at no speed.
//  * WEIGHT: the engine's mass where it is (a transom-hung outboard trims the stern down, a racing crew stows it below).
//
// SCHEMA — class field `engine` (null: no engine). Body frame as physics.js: x forward from the CG, y starboard, z up
// from the waterline, metres; angles in radians.
//   type        'outboard' | 'inboard' | 'saildrive'
//   model       label (optional)
//   kW, rpmMax  rated power at rated rpm (the rev limiter sits 5% above); rpmIdle (default 1100 outboard, 850 diesel)
//   cyl         cylinders (four-stroke: firing frequency = rpm / 60 * cyl / 2); fuel 'petrol' | 'diesel'
//   gear        reduction ratio engine : propeller
//   prop        { D, P (pitch), Z (blades), BAR (expanded area ratio, default 0.5), folding: bool, rh: +1 | -1 (right /
//               left handed, seen from astern turning ahead) }
//   pos         [x, y, z] propeller centre
//   shaftAngle  shaft inclination (down by the stern), rad
//   mount       [x, y, z] outboard clamp / tilt pivot (the motor's weight sits here); inboards: engine CG (optional)
//   mass, inMass  kg; inMass: the class's massHull already includes it (then only moving it changes anything)
//   stow        [x, y, z] where it lives when stowed below (a racing crew's outboard), or null: not stowable. A stowable
//               engine starts stowed (the class's racing trim); the game mounts it for free sailing
//   tilts       outboard tilted clear of the water while stopped; steers: turns with the helm (tiller-linked)
//   lockWhenOff fixed prop left in gear when stopped (locked, not windmilling)
//   exhaust     [x, y, z] exhaust outlet (visuals); wake, deduction, walkA, walkR, legArea, shiftDelay, startTime,
//               I (engine rotating inertia at the crank, kg m^2): optional overrides of the type's defaults

const RHO = 1025, G = 9.81, PI = Math.PI, TAU = 2 * Math.PI;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const DETENT = 0.1;

// Wageningen B-series open water polynomials: K = sum C J^s (P/D)^t (AE/A0)^u Z^v   [C, s, t, u, v]
const KT_C = [
  [0.00880496, 0, 0, 0, 0], [-0.204554, 1, 0, 0, 0], [0.166351, 0, 1, 0, 0], [0.158114, 0, 2, 0, 0], [-0.147581, 2, 0, 1, 0],
  [-0.481497, 1, 1, 1, 0], [0.415437, 0, 2, 1, 0], [0.0144043, 0, 0, 0, 1], [-0.0530054, 2, 0, 0, 1], [0.0143481, 0, 1, 0, 1],
  [0.0606826, 1, 1, 0, 1], [-0.0125894, 0, 0, 1, 1], [0.0109689, 1, 0, 1, 1], [-0.133698, 0, 3, 0, 0], [0.00638407, 0, 6, 0, 0],
  [-0.00132718, 2, 6, 0, 0], [0.168496, 3, 0, 1, 0], [-0.0507214, 0, 0, 2, 0], [0.0854559, 2, 0, 2, 0], [-0.0504475, 3, 0, 2, 0],
  [0.010465, 1, 6, 2, 0], [-0.00648272, 2, 6, 2, 0], [-0.00841728, 0, 3, 0, 1], [0.0168424, 1, 3, 0, 1], [-0.00102296, 3, 3, 0, 1],
  [-0.0317791, 0, 3, 1, 1], [0.018604, 1, 0, 2, 1], [-0.00410798, 0, 2, 2, 1], [-0.000606848, 0, 0, 0, 2], [-0.0049819, 1, 0, 0, 2],
  [0.0025983, 2, 0, 0, 2], [-0.000560528, 3, 0, 0, 2], [-0.00163652, 1, 2, 0, 2], [-0.000328787, 1, 6, 0, 2], [0.000116502, 2, 6, 0, 2],
  [0.000690904, 0, 0, 1, 2], [0.00421749, 0, 3, 1, 2], [0.0000565229, 3, 6, 1, 2], [-0.00146564, 0, 3, 2, 2],
];
const KQ_C = [
  [0.00379368, 0, 0, 0, 0], [0.00886523, 2, 0, 0, 0], [-0.032241, 1, 1, 0, 0], [0.00344778, 0, 2, 0, 0], [-0.0408811, 0, 1, 1, 0],
  [-0.108009, 1, 1, 1, 0], [-0.0885381, 2, 1, 1, 0], [0.188561, 0, 2, 1, 0], [-0.00370871, 1, 0, 0, 1], [0.00513696, 0, 1, 0, 1],
  [0.0209449, 1, 1, 0, 1], [0.00474319, 2, 1, 0, 1], [-0.00723408, 2, 0, 1, 1], [0.00438388, 1, 1, 1, 1], [-0.0269403, 0, 2, 1, 1],
  [0.0558082, 3, 0, 1, 0], [0.0161886, 0, 3, 1, 0], [0.00318086, 1, 3, 1, 0], [0.015896, 0, 0, 2, 0], [0.0471729, 1, 0, 2, 0],
  [0.0196283, 3, 0, 2, 0], [-0.0502782, 0, 1, 2, 0], [-0.030055, 3, 1, 2, 0], [0.0417122, 2, 2, 2, 0], [-0.0397722, 0, 3, 2, 0],
  [-0.00350024, 0, 6, 2, 0], [-0.0106854, 3, 0, 0, 1], [0.00110903, 3, 3, 0, 1], [-0.000313912, 0, 6, 0, 1], [0.0035985, 3, 0, 1, 1],
  [-0.00142121, 0, 6, 1, 1], [-0.00383637, 1, 0, 2, 1], [0.0126803, 0, 2, 2, 1], [-0.00318278, 2, 3, 2, 1], [0.00334268, 0, 6, 2, 1],
  [-0.00183491, 1, 1, 0, 2], [0.000112451, 3, 2, 0, 2], [-0.0000297228, 3, 6, 0, 2], [0.000269551, 1, 0, 1, 2], [0.00083265, 2, 0, 1, 2],
  [0.00155334, 0, 2, 1, 2], [0.000302683, 0, 6, 1, 2], [-0.0001843, 0, 0, 2, 2], [-0.000425399, 0, 3, 2, 2], [0.0000869243, 3, 3, 2, 2],
  [-0.0004659, 0, 6, 2, 2], [0.0000554194, 1, 6, 2, 2],
];
const K07 = 0.7 * PI, ETA_T = 0.62, ETA_Q = 0.85;

// A propeller: open-water T and Q in all four quadrants
export class Prop {
  constructor(p) {
    this.D = p.D; this.PD = p.P / p.D; this.BAR = p.BAR ?? 0.5; this.Z = p.Z ?? 3;
    this.A0 = PI * p.D * p.D / 4;
    // the polynomials collapse to cubics in J for a given propeller
    this.kt = [0, 0, 0, 0]; this.kq = [0, 0, 0, 0];
    for (const [c, s, t, u, v] of KT_C) this.kt[s] += c * this.PD ** t * this.BAR ** u * this.Z ** v;
    for (const [c, s, t, u, v] of KQ_C) this.kq[s] += c * this.PD ** t * this.BAR ** u * this.Z ** v;
    let lo = 0, hi = 2.5;                                       // J where the thrust vanishes
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (this.KT(m) > 0) lo = m; else hi = m; }
    this.J0 = lo; this.bEnd = Math.atan2(lo, K07);
    const f0 = 8 / (PI * K07 * K07), fe = 8 / (PI * (lo * lo + K07 * K07));
    this.ct0 = this.KT(0) * f0; this.cq0 = this.KQ(0) * f0; this.cqEnd = this.KQ(lo) * fe;
    const phi = Math.atan(this.PD / K07);                        // blade pitch angle at 0.7 R
    this.ctLock = -1.15 * this.BAR * Math.cos(phi) ** 2;
    this.cqLock = -1.15 * this.BAR * Math.cos(phi) * Math.sin(phi) * 0.35;
    this._c = { ct: 0, cq: 0 };
  }
  KT(J) { const k = this.kt; return k[0] + J * (k[1] + J * (k[2] + J * k[3])); }
  KQ(J) { const k = this.kq; return k[0] + J * (k[1] + J * (k[2] + J * k[3])); }
  // first quadrant, beta in [0, pi/2]
  q1(b, o) {
    if (b <= this.bEnd) { const J = K07 * Math.tan(b), f = 8 / (PI * (J * J + K07 * K07)); o.ct = this.KT(J) * f; o.cq = this.KQ(J) * f; }
    else { const s = (b - this.bEnd) / (PI / 2 - this.bEnd); o.ct = lerp(0, this.ctLock, s); o.cq = lerp(this.cqEnd, this.cqLock, s); }
    return o;
  }
  // CT*, CQ* at advance angle beta (-pi..pi): + thrust ahead, + torque absorbed by an ahead-turning prop
  coef(beta, o) {
    const h = PI / 2;
    if (beta >= 0 && beta <= h) return this.q1(beta, o);
    if (beta > h) {                                            // turning astern, moving ahead: braking
      const s = (beta - h) / h, bump = 0.25 * this.BAR * Math.sin(PI * s);
      o.ct = lerp(this.ctLock, -ETA_T * this.ct0, s) - bump; o.cq = lerp(this.cqLock, -ETA_Q * this.cq0, s);
      return o;
    }
    if (beta < -h) { this.q1(beta + PI, o); o.ct *= -ETA_T; o.cq *= -ETA_Q; return o; }   // astern, moving astern
    const s = (beta + h) / h, bump = 0.25 * this.BAR * Math.sin(PI * s);                // ahead, moving astern
    o.ct = lerp(-ETA_T * this.ctLock, this.ct0, s) + bump; o.cq = lerp(-ETA_Q * this.cqLock, this.cq0, s);
    return o;
  }
  // thrust T (N) and torque Q (N m) at advance speed Va (m/s) and n (rev/s, + ahead)
  forces(Va, n, o) {
    const w = K07 * n * this.D, Vr2 = Va * Va + w * w;
    if (Vr2 < 1e-10) { o.T = 0; o.Q = 0; return o; }
    this.coef(Math.atan2(Va, w), this._c);
    const q = 0.5 * RHO * Vr2 * this.A0;
    o.T = this._c.ct * q; o.Q = this._c.cq * q * this.D;
    return o;
  }
}

const TYPES = {
  outboard: { wake: 0.02, deduction: 0.03, walkA: 0.012, walkR: 0.04, rpmIdle: 1100, fuel: 'petrol', I: 0.006, startTime: 1.3, shiftDelay: 0.5, legArea: 0.035, legFront: 0.012, tilts: true },
  inboard: { wake: 0.1, deduction: 0.08, walkA: 0.015, walkR: 0.04, rpmIdle: 850, fuel: 'diesel', I: 0.05, startTime: 1.8, shiftDelay: 0.8, legArea: 0, legFront: 0, tilts: false },
  saildrive: { wake: 0.06, deduction: 0.05, walkA: 0.008, walkR: 0.025, rpmIdle: 850, fuel: 'diesel', I: 0.05, startTime: 1.8, shiftDelay: 0.8, legArea: 0, legFront: 0, tilts: false },
};
// brake specific fuel consumption at best load (g/kWh) and density (kg/L)
const FUEL = { petrol: { bsfc: 380, rho: 0.74 }, diesel: { bsfc: 260, rho: 0.84 } };

export function engineSpec(spec) {
  const T = TYPES[spec.type] || TYPES.outboard;
  const S = { ...T, cyl: 1, shaftAngle: 0, inMass: false, stow: null, steers: false, lockWhenOff: false, ...spec };
  S.prop = { BAR: 0.5, Z: 3, folding: false, rh: 1, ...spec.prop };
  S.mount = spec.mount || spec.pos;
  // shaft drives walk harder the steeper the shaft (the blades' inflow is asymmetric)
  if (S.type === 'inboard' && spec.walkR === undefined) { S.walkR = 0.04 + 0.4 * Math.sin(S.shaftAngle); S.walkA = 0.3 * S.walkR; }
  return S;
}

export class Engine {
  constructor(boat, spec) {
    const S = this.spec = engineSpec(spec);
    this.prop = new Prop(S.prop);
    this.wMax = S.rpmMax * TAU / 60; this.wIdle = S.rpmIdle * TAU / 60;
    this.Trated = S.kW * 1000 / this.wMax;
    this.Ip = 45 * this.prop.D ** 5 + 2e-4;                              // prop and shaft (a bronze prop: I ~ D^5)
    this.Ieff = S.I + this.Ip / (S.gear * S.gear);                       // engine and prop, seen at the crank
    this.addedMass = S.inMass ? 0 : S.mass;                               // (physics.js adds it to the boat)
    this.stowed = !!S.stow;
    this._f = { T: 0, Q: 0 };
    this.reset();
  }
  reset() {
    this.running = false; this.cranking = 0; this.starting = false; this.we = 0; this.n = 0; this.gear = 0; this.shiftT = 0;
    this.throttle = 0; this.rack = 0; this.integ = 0; this.stallT = 0; this.stalled = false;
    this.down = this.spec.tilts ? 0 : 1; this.open = 0;
    this.T = 0; this.Q = 0; this.washU = 0; this.slip = 0; this.lh = 0; this.kv = 1;
    this.X = 0; this.Y = 0; this.K = 0; this.N = 0; this.My = 0; this._latch = false;
  }
  get rpm() { return this.we * 60 / TAU; }
  get propRpm() { return this.n * 60; }
  get active() { return this.running || this.starting; }

  // ---- controls ----
  start() {
    if (this.stowed) return 'stowed';
    if (this.running || this.starting) return 'running';
    this.throttle = 0;                               // the lever goes to neutral: no starting in gear
    this.starting = true; this.cranking = 0; this.stalled = false;
    return 'starting';
  }
  stop() { this.running = false; this.starting = false; this.cranking = 0; this.gear = 0; }
  toggle() { if (this.active) { this.stop(); return 'stopped'; } return this.start(); }
  setStowed(on) { if (!this.spec.stow) on = false; if (on) this.stop(); this.stowed = on; if (on) this.down = 0; }
  // the throttle lever, moved at a rate: it stops in the neutral detent until let go
  nudge(d, dt) {
    if (this._latch) return;
    const t0 = this.throttle, t1 = clamp(t0 + d * 0.7 * dt, -1, 1);
    if ((t0 > 0 && t1 <= 0) || (t0 < 0 && t1 >= 0)) { this.throttle = 0; this._latch = true; return; }
    this.throttle = t1;
  }
  release() { this._latch = false; }
  get gearName() { return this.gear > 0 ? 'AHEAD' : this.gear < 0 ? 'ASTERN' : 'NEUTRAL'; }

  // indicated torque at full rack (N m): the brake torque curve (115% of rated at 65% rpm, rated at rated rpm, cut by the
  // rev limiter) plus the friction and pumping torque the fuel also has to overcome
  tMax(w) {
    const x = w / this.wMax;
    if (x < 0.05) return 0;
    return (this.Trated * (1.15 - 0.15 * ((x - 0.65) / 0.35) ** 2) + this.tFric(w)) * (x > 1.03 ? 1 - sstep(1.03, 1.08, x) : 1);
  }
  // motoring friction and pumping (fuel cut, the engine brakes itself down to idle in a second or two)
  tFric(w) { return w > 0 ? this.Trated * (0.12 + 0.15 * w / this.wMax) * Math.min(1, w / 5) : 0; }

  // ---- one physics step: returns this with X, Y, K, N (boat forces and moments) and My (pitch) ----
  step(b, dt, uw, vw, cphi, sphi) {
    const S = this.spec, C = b.cls, pr = this.prop, D = pr.D;
    const [xp, yp, zp] = S.pos;
    this.X = 0; this.Y = 0; this.K = 0; this.N = 0; this.My = 0; this.washU = 0;
    // the outboard's leg is lowered to start and tilted clear when stopped (the crew takes ~1.5 s)
    const wantDown = !this.stowed && (!S.tilts || this.running || this.starting);
    this.down = clamp(this.down + (wantDown ? 1 : -1) * dt / 1.5, 0, 1);
    const legIn = S.tilts ? sstep(0.75, 1, this.down) : 1;
    // prop immersion: a pitching or heeling stern lifts it out and it ventilates
    let depth = -(zp * cphi - yp * sphi + xp * Math.sin(b.pitch) + b.heave);
    if (b._etaAt) depth += b._etaAt(clamp(xp, C.sternX, C.bowX));
    const kv = this.kv = legIn * sstep(-0.35 * D, 0.75 * D, depth);
    // water at the prop: along the shaft (yaw swings an off-centre prop) and across
    const ax = uw - b.r * yp, lat = (vw + b.r * xp + b.p * zp) * cphi;
    const Va = ax > 0 ? ax * (1 - S.wake) : ax;
    // starting: the leg goes down, the starter (or the pull cord) turns it over, it fires
    if (this.starting) {
      if (this.down > 0.98 || !S.tilts) {
        this.cranking += dt;
        this.we = lerp(this.we, 0.3 * this.wIdle, clamp(dt * 8, 0, 1));
        if (this.cranking >= S.startTime) { this.starting = false; this.running = true; this.we = Math.max(this.we, 0.9 * this.wIdle); this.cranking = 0; }
      }
    }
    // gear: through neutral, engaging once the engine is back near idle
    const want = !this.running || Math.abs(this.throttle) < DETENT ? 0 : Math.sign(this.throttle);
    if (!this.running) this.gear = 0;
    else if (want !== this.gear) {
      if (this.gear !== 0) { this.gear = 0; this.shiftT = 0; }
      else { this.shiftT += dt; if (this.shiftT >= S.shiftDelay && this.we < 1.35 * this.wIdle) this.gear = want; }
    }
    const lever = want ? (Math.abs(this.throttle) - DETENT) / (1 - DETENT) : 0;
    const wT = this.running ? (want === this.gear ? this.wIdle + lever * (this.wMax - this.wIdle) : this.wIdle) : 0;
    // folding blades open when driven, fold when not
    const driven = this.running && this.gear !== 0;
    this.open = S.prop.folding ? clamp(this.open + (driven ? 4 : -2) * dt, 0, 1) : 1;
    const locked = !this.running && !S.prop.folding && S.lockWhenOff && !S.tilts;
    // ---- shaft: implicit Euler sub-steps ----
    const nSub = Math.max(1, Math.ceil(dt / 0.003)), h = dt / nSub, f = this._f, g = S.gear, eta = 0.95;
    const propQ = (n) => { pr.forces(Va, n, f); return f.Q * kv * this.open; };
    let fuelT = 0;
    for (let k = 0; k < nSub; k++) {
      // governor: proportional rack with 8% droop, a little integral to hold the rpm under load
      if (this.running) {
        const err = (wT - this.we) / this.wMax;
        this.integ = clamp(this.integ + err * h * 3, -0.1, 0.35);
        this.rack = clamp(err / 0.08 + this.integ, 0, 1);
      } else { this.rack = 0; this.integ = 0; }
      const Te = (w) => this.rack * this.tMax(w) - this.tFric(w);
      if (this.gear !== 0) {
        // engine and prop turn together: n = gear * w / (2 pi g)
        const fw = (w) => Te(w) - this.gear * propQ(this.gear * w / (TAU * g)) / (g * eta);
        const f0 = fw(this.we), f1 = fw(this.we + 0.5), dfw = (f1 - f0) / 0.5;
        this.we = Math.max(0, this.we + h * f0 / (this.Ieff - h * Math.min(0, dfw)));
        this.n = this.gear * this.we / (TAU * g);
      } else {
        if (!this.starting) {
          const f0 = Te(this.we), dfw = (Te(this.we + 0.5) - f0) / 0.5;
          this.we = Math.max(0, this.we + h * f0 / (S.I - h * Math.min(0, dfw)));
        }
        // the prop on its own: folded, locked, or windmilling against the seal and gearbox drag
        if (locked || this.open < 0.05 || kv < 0.01) this.n *= Math.exp(-h * 3);
        else {
          const Qf = 0.03 * this.Trated * g;
          const fn = (n) => -propQ(n) - Qf * Math.tanh(n * 4);
          const f0 = fn(this.n), dfn = (fn(this.n + 0.05) - f0) / 0.05;
          this.n += h * f0 / (TAU * this.Ip - h * Math.min(0, dfn));
        }
      }
      fuelT += this.rack * this.tMax(this.we) * this.we * h;
    }
    // stalled: lugged below half its idle
    if (this.running && this.we < 0.5 * this.wIdle) { this.stallT += dt; if (this.stallT > 0.4) { this.stop(); this.stalled = true; } } else this.stallT = 0;
    // fuel: the indicated work at the brake specific consumption (brake / indicated ~ 0.78 at full load), worse at part
    // load, plus what it burns just idling
    const P = fuelT / dt, Fl = FUEL[S.fuel] || FUEL.petrol;
    const bsfc = 0.78 * Fl.bsfc * (1 + 0.5 * (1 - this.rack) ** 2);
    this.lh = lerp(this.lh, this.running ? P / 1000 * bsfc / 1000 / Fl.rho + 0.04 * S.kW : 0, clamp(dt * 2, 0, 1));
    // ---- forces at the prop ----
    let T, Q;
    if (locked) { pr.forces(Va, 0, f); T = f.T * kv; Q = 0; }
    else { pr.forces(Va, this.n, f); T = f.T * kv * this.open; Q = f.Q * kv * this.open; }
    // folded blades and the hub: a small bluff body
    const hubD = 0.28 * D;
    T -= (1 - this.open) * kv * 0.5 * RHO * 0.12 * PI * hubD * hubD / 4 * Va * Math.abs(Va);
    this.T = T; this.Q = Q;
    const Tb = T * (T > 0 ? 1 - S.deduction : 1) * Math.cos(S.shaftAngle);
    const dl = S.steers ? b.rudder : 0;
    let Fx = Tb * Math.cos(dl), Fy = -Tb * Math.sin(dl);
    // prop walk: strongest from rest (paddle wheel in the hull's shadow), fading once water streams past the stern
    const Jw = Math.abs(Va) / Math.max(0.3, Math.abs(this.n) * D);
    const walk = (this.n >= 0 ? S.walkA : -S.walkR) * S.prop.rh * Math.abs(T) / (1 + (Jw / 0.45) ** 2);
    Fy += walk; this.walk = walk;
    // the outboard's leg: a small fin (lift and cross-flow) and a bluff gearcase
    if (S.legArea && legIn > 0) {
      const Aw = S.legArea * legIn, Ua = Math.max(Math.abs(ax), 0.3);
      Fy -= 0.5 * RHO * Aw * (2.2 * Ua * lat + 1.1 * lat * Math.abs(lat));
      Fx -= 0.5 * RHO * S.legFront * legIn * 0.35 * ax * Math.abs(ax);
    }
    this.X = Fx; this.Y = Fy * cphi; this.K = Fy * zp; this.N = xp * Fy * cphi - (yp * cphi + zp * sphi) * Fx;
    this.My = -Fx * zp + Tb * Math.sin(S.shaftAngle) * xp;    // thrust below the CG lifts the bow; an inclined shaft lifts the stern
    // slipstream (momentum theory) and the rudder in it
    this.slip = T > 0 ? Math.sqrt(Math.max(0, Va) ** 2 + 8 * T / (RHO * PI * D * D)) : 0;
    const R = C.rudder;
    if (T > 0 && S.wash !== false && S.type !== 'outboard' && R && R.x < xp && Math.abs(yp) < 0.3 && !R.twin) {
      const us = Math.max(0, Va) + 0.75 * (this.slip - Math.max(0, Va));
      const fr = clamp(0.85 * D / R.span, 0, 1);
      const u0 = Math.max(0, ax);
      this.washU = (ax >= 0 ? Math.sqrt((1 - fr) * u0 * u0 + fr * us * us) - u0 : fr * us) * kv;
    }
    // ---- the engine's weight where it is ----
    if (S.mass) {
      const at = this.stowed ? S.stow : S.mount;
      const ref = S.inMass ? (S.stow || S.mount) : null;
      const dx = at[0] - (ref ? ref[0] : b.xG), dy = at[1] - (ref ? ref[1] : 0), dz = at[2] - (ref ? ref[2] : 0);
      if (dx || dy || dz) { this.My -= S.mass * G * dx; this.K += S.mass * G * (dy * cphi + dz * sphi); }
    }
    return this;
  }

  // what the network carries: running and the lever (absent: stopped)
  packet() { return this.running || this.starting ? Math.round(this.throttle * 100) / 100 : undefined; }
  follow(e) {
    if (e === undefined || e === null) { if (this.active) this.stop(); return; }
    if (this.stowed) this.setStowed(false);
    if (!this.active) this.start();
    this.throttle = clamp(+e || 0, -1, 1);
  }
}
