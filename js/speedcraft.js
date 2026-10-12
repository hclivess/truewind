// The speed machines: craft that are not boats with sails on a hull, but a rigid wing in the air, foils in the water
// and the small planing pods they skim on (Vestas Sailrocket 2: js/classes/sailrocket2.js). Their whole point is the
// geometry of the forces — where the wing's force acts, where the foil's acts, and in what directions — so they are
// simulated as one rigid body in six degrees of freedom with every element at its real place:
//
//  * the wing: a rigid aerofoil in strips up its span, each seeing the apparent wind at its height (the wind's
//    boundary layer, the craft's own motion, its roll and yaw) across the span; its trim (the chord's angle about the
//    span axis) is the pilot's control, as a sheet is on a sail (js/hydrofoil.js Surface, section 'naca');
//  * the foils: in strips, each at its depth in the local sea (waves, heave, pitch, heel), with its own cavitation
//    number, ventilated from the surface where the foil pierces it (js/hydrofoil.js, sections 'naca' and 'scav');
//  * the rudder: a foil turned by the helm;
//  * the pods: planing surfaces (Savitsky), floating bodies at rest, each at its own corner;
//  * the weight of each part, at its place (the centre of gravity and the inertia tensor are summed from the parts,
//    products of inertia included: these craft are not symmetric);
//  * the air drag of the hull, beam, pods and pilot.
// No moment is put in by hand: the forces act where they act and the body turns, heels and pitches by their moments
// about its centre of gravity. A wing whose force line passes through the foil's heels nothing; on the other tack it
// does not.
//
// Frames: the body frame is SNAME (x forward, y starboard, z down); the world is the game's (x east, z south, y up),
// NED for the integration (N = -z, E = x, D = -y). Euler angles yaw psi, pitch theta (+ bow up), roll phi (+ starboard
// down): the game's psi, pitch and phi. The class gives its geometry in the game's convention (x forward, y starboard,
// z UP) about its origin, a point on the design waterline under the centre of gravity; the origin is what the game
// knows as the boat's position (x, z) and heave.
import { G, DEG, KT } from './env.js';
import { defaultControls, clamp, lerp, sstep, wrap, RHO_A, craftHooks, POLAR_TWAS, makeSteadyEnv } from './physics.js';
import { Surface, planeCoef, coef, RHO_W, v3 } from './hydrofoil.js';

const { cross, dot } = v3;
const up2dn = (p) => [p[0], p[1], -p[2]];                 // class (z up) -> body SNAME (z down)

// mass properties from the parts: [{ m, p: [x, y, z up], r: [rx, ry, rz] gyration radii about the part's own axes }]
export function craftMass(parts) {
  let M = 0; const c = [0, 0, 0];
  for (const q of parts) { const p = up2dn(q.p); M += q.m; for (let k = 0; k < 3; k++) c[k] += q.m * p[k]; }
  for (let k = 0; k < 3; k++) c[k] /= M;
  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of parts) {
    const p = up2dn(q.p), r = q.r || [0, 0, 0], d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const own = [r[1] * r[1] + r[2] * r[2], r[0] * r[0] + r[2] * r[2], r[0] * r[0] + r[1] * r[1]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      I[i][j] += q.m * ((i === j ? d[0] * d[0] + d[1] * d[1] + d[2] * d[2] : 0) - d[i] * d[j]);
      if (i === j) I[i][j] += q.m * own[i];
    }
  }
  return { M, cg: c, I };
}
function inv3(A) {
  const [a, b, c] = A[0], [d, e, f] = A[1], [g, h, i] = A[2];
  const A1 = e * i - f * h, B1 = -(d * i - f * g), C1 = d * h - e * g, det = a * A1 + b * B1 + c * C1;
  return [[A1 / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B1 / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C1 / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const mv = (A, x, o) => { o[0] = A[0][0] * x[0] + A[0][1] * x[1] + A[0][2] * x[2]; o[1] = A[1][0] * x[0] + A[1][1] * x[1] + A[1][2] * x[2]; o[2] = A[2][0] * x[0] + A[2][1] * x[1] + A[2][2] * x[2]; return o; };

// where a class's geometry is moved to put her origin on the design waterline under her centre of gravity ([x, y] in
// the class's frame: the drawing moves the same way)
export function craftOrigin(C) {
  if (C._origin) return C._origin;
  const S = C.speed, mp = craftMass([...S.parts, { m: C.crewN * C.crewEach, p: S.pilot }]);
  return (C._origin = [mp.cg[0], mp.cg[1]]);
}

export class SpeedCraft {
  constructor(cls, opts = {}) {
    const C = this.cls = cls, S = C.speed;
    this.speedCraft = true;
    // her origin: on the design waterline under the centre of gravity (the class's geometry moved there)
    const o = craftOrigin(C), P = (p) => { const q = up2dn(p); q[0] -= o[0]; q[1] -= o[1]; return q; };
    this.origin = o;
    const parts = [...S.parts, { m: C.crewN * C.crewEach, p: S.pilot, r: [0.25, 0.25, 0.3], pilot: true }].map((q) => ({ ...q, p: [q.p[0] - o[0], q.p[1] - o[1], q.p[2]] }));
    const mp = craftMass(parts);
    this.mass = mp.M; this.crewMass = C.crewN * C.crewEach; this.cg = mp.cg;
    // (added mass: the pods' and foils' water is small against the craft's own; a little in heave and roll keeps the
    // stiff planing contact well conditioned, ~10% in heave as for a planing hull at speed: Faltinsen 2005, "
    // Hydrodynamics of high-speed marine vehicles" ch. 9)
    this.I = mp.I; this.Iinv = inv3(mp.I);
    this.mAdd = [0.02 * mp.M, 0.08 * mp.M, 0.1 * mp.M];
    this.massProps = mp;
    // elements: the class gives each surface's root (z up), span and reference chord directions, and the side its lift
    // is + to (liftTo); here in the body frame
    const surf = (F, water, n) => new Surface({ ...F, root: P(F.root ?? F.foot), span: up2dn(F.span), chord0: up2dn(F.chord0 || [-1, 0, 0]), liftTo: up2dn(F.liftTo || [0, 1, 0]), n, water });
    this.wing = surf(S.wing, false, 10);
    this.extension = S.extension ? surf(S.extension, false, 4) : null;
    this.foils = S.foils.map((F) => surf(F, true, F.n || 8));
    this.pods = S.pods.map((Q) => ({ P: Q, keel: P([Q.c[0] - Q.len / 2, Q.c[1], Q.c[2]]), c: P(Q.c), st: {} }));
    const podOf = (name) => this.pods.find((q) => q.P.name === name);
    // (a rudder hung under a float: its root at the float's bottom, a little ahead of its transom)
    this.rudders = S.rudders.map((F) => { const q = podOf(F.at); const r = q ? [q.keel[0] + 0.25, q.keel[1], q.keel[2]] : P(F.root); const sf = new Surface({ ...F, root: r, span: up2dn(F.span), chord0: up2dn(F.chord0 || [-1, 0, 0]), liftTo: up2dn(F.liftTo || [0, 1, 0]), n: 4, water: true }); return sf; });
    // compatibility with the game's boats (js/physics.js Boat): the controls, the automation, the diagnostics
    this.id = opts.id ?? 0; this.name = opts.name ?? 'Boat';
    this.ctrl = defaultControls(); this.ctrl.main = S.trim0 ?? 0.2; this.ctrl.board = 1;
    this.auto = { trim: false, hike: false };
    const W = S.wing;
    this.sails = []; this.sailBy = { main: { key: 'main', kind: 'wing', area: this.wing.area, luff: W.len, foot: W.chord[0] ?? W.chord, reefs: 0 } };
    this.booms = {}; this.side = { jib: 1, gennaker: 1 };
    this.engine = null; this.sailSys = null; this.rigStruct = null; this.sailModel = 'strip'; this.lod = 2;
    this.hydro = null; this.shadow = 1;
    this.diag = { strips: {}, shape: {}, rig: {} };
    this._w = {}; this._c = {}; this._ws = {}; this._pc = {};
    this.reset(opts.x ?? 0, opts.z ?? 0, opts.heading ?? 0);
  }

  // the wing's trim: the chord's angle to the centreline about the wing's span axis, from the control (0 = sheeted
  // hard in .. 1 = eased right out), as the pilot's control line sets it
  wingAngle(e = this.lines.main) { const T = this.cls.speed.wing.trim; return lerp(T[0], T[1], clamp(e, 0, 1)); }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.psi = heading; this.phi = 0; this.pitch = 0; this.heave = 0;
    this.u = 0; this.v = 0; this.r = 0; this.p = 0; this.heaveV = 0; this.pitchV = 0;
    this.vb = [0, 0, 0]; this.wb = [0, 0, 0];
    this.rudder = 0; this.crewY = 0; this.crewX = 0;
    this.lines = { main: this.ctrl.main, jib: 0.3, stay: 0.3, lazy: 1, mizzen: 0.3 };
    // (the wing's trim is the pilot's control in the cockpit: no lines to make fast or cast off)
    this.locks = {}; this.held = {}; this.tackle = {}; this.lh = {};
    this.capsized = false; this.capsizeT = 0; this.righting = false; this.aground = 0;
    this.reefPos = 0; this.reefSlack = 0; this.reefing = false; this.genDeploy = 0; this.genFill = 0; this.backedByLazy = false;
    this.log = 0; this.t = 0; this.slam = 0; this.slamEvents = 0;
    // float her at rest: the heave where the pods carry her weight, level
    const S = this.cls.speed;
    // (h: the origin's depth below the surface; a pod's keel at the transom is k[2] + h deep)
    let h = 0;
    for (let it = 0; it < 200; it++) {
      let F = 0;
      for (const pd of this.pods) F += planeCoef(pd.P, pd.keel[2] + h, 0, 0, 0, pd.st).L;
      const err = this.mass * G - F;
      h += clamp(err / (RHO_W * G * 3), -0.02, 0.02);
      if (Math.abs(err) < 1) break;
    }
    this.heave = -h;
    this._uOut = 0; this._vOut = 0;
    this.trial = this.trial || null;
    if (this.trial) this.trial.reset();
  }

  // the forces as the drawing shows them: each surface's resultant (world, N: x east, y up, z south) at its centre of
  // pressure (world point), from the last step
  forceLines() {
    const R = this._rot(), out = {};
    const one = (list) => {
      let F = [0, 0, 0], m = [0, 0, 0], w = 0;
      for (const S of list) for (const st of S.strips) { const f = st.F, a = Math.hypot(f[0], f[1], f[2]); if (!(a > 0)) continue; for (let k = 0; k < 3; k++) { F[k] += f[k]; m[k] += st.p[k] * a; } w += a; }
      if (!(w > 1)) return null;
      const p = this.worldOf([m[0] / w, m[1] / w, m[2] / w], {});
      const n = R[0][0] * F[0] + R[0][1] * F[1] + R[0][2] * F[2], e = R[1][0] * F[0] + R[1][1] * F[1] + R[1][2] * F[2], dd = R[2][0] * F[0] + R[2][1] * F[1] + R[2][2] * F[2];
      return { p, f: [e, -dd, -n] };
    };
    out.wing = one([this.wing]); out.foil = one(this.foils); out.rudder = one(this.rudders.filter((r) => !r.up));
    return out;
  }

  // rotation body -> NED from the Euler angles
  _rot() {
    const R = this._R || (this._R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const cf = Math.cos(this.phi), sf = Math.sin(this.phi), ct = Math.cos(this.pitch), st = Math.sin(this.pitch), cp = Math.cos(this.psi), sp = Math.sin(this.psi);
    R[0][0] = ct * cp; R[0][1] = sf * st * cp - cf * sp; R[0][2] = cf * st * cp + sf * sp;
    R[1][0] = ct * sp; R[1][1] = sf * st * sp + cf * cp; R[1][2] = cf * st * sp - sf * cp;
    R[2][0] = -st; R[2][1] = sf * ct; R[2][2] = cf * ct;
    return R;
  }
  // body point p (SNAME) -> world (x, y up, z)
  worldOf(p, out = {}) {
    const R = this._R, ox = this.x, oz = this.z, oy = this.heave;
    const n = R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], e = R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], dd = R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2];
    out.x = ox + e; out.z = oz - n; out.y = oy - dd;
    return out;
  }

  step(dt, env, t, world = null) {
    // (sub-steps of 1/240 s at most: the planing contact is stiff)
    const n = Math.max(1, Math.ceil(dt * 240 - 1e-6)), h = dt / n;
    for (let i = 0; i < n; i++) this._sub(h, env, t + i * h, world, i === n - 1);
  }

  _sub(dt, env, t, world, last) {
    const C = this.cls, S = C.speed, ctrl = this.ctrl, d = this.diag;
    this.t = t;
    const R = this._rot();
    // (the game may have moved the boat: a collision's push, a reset, a tow; and set its speed)
    if (this.u !== this._uOut || this.v !== this._vOut) { this.vb[0] += this.u - this._uOut; this.vb[1] += this.v - this._vOut; }
    const vb = this.vb, wb = this.wb, cg = this.cg;
    // ---- the controls: the wing's trim line, the helm ----
    const rate = 0.5;                                                  // (control units / s: the pilot's hands)
    this.lines.main = clamp(this.lines.main + clamp(ctrl.main - this.lines.main, -rate * dt, rate * dt), 0, 1);
    const rudMax = S.rudderMax ?? 15 * DEG;
    this.rudder += clamp(clamp(ctrl.helm, -1, 1) * rudMax - this.rudder, -0.6 * dt, 0.6 * dt);
    this.wing.setIncidence(this.wingAngle());
    // (incidence + turns the chord so the flow from ahead meets the surface on its lift side: + lift, toward liftTo)
    for (const F of this.foils) F.setIncidence(-(F.spec.inc ?? 0));
    if (this.extension) this.extension.setIncidence(-(this.extension.spec.inc ?? 0));   // (+ inc: nose up)
    // the rudder: + helm turns the bow to starboard. Its lift is + to starboard (liftTo), and a blade turned trailing edge
    // to starboard (+ incidence) meets the water on its starboard face and is pushed to port: a rudder under the bow
    // turns its trailing edge to port to pull the bow to starboard, one under the stern to starboard
    for (const F of this.rudders) F.setIncidence(F.spec.fixed ? 0 : F.spec.front ? -this.rudder : this.rudder);

    // ---- the air ----
    const w = env.wind.sample(this.x, this.z, t, this._w), wsp = w.speed * this.shadow;
    const wE = -Math.sin(w.dir) * wsp, wN = -Math.cos(w.dir) * wsp;   // (world x = E; world z = -N)
    d.tws = w.speed; d.twd = w.dir; d.puff = w.puff;
    const rhoA = RHO_A * 288 / (288 - 9 * clamp(w.cold || 0, 0, 1));
    // the air's velocity in the body frame (before the boundary layer's height factor)
    const aB = this._aB || (this._aB = [0, 0, 0]);
    aB[0] = R[0][0] * wN + R[1][0] * wE; aB[1] = R[0][1] * wN + R[1][1] * wE; aB[2] = R[0][2] * wN + R[1][2] * wE;
    // ---- the water: the current, the local sea at a point ----
    const cur = env.current.at(this.x, this.z, this._c);
    d.curX = cur.x; d.curZ = cur.z;
    const cB = this._cB || (this._cB = [0, 0, 0]);
    { const cN = -cur.z, cE = cur.x; cB[0] = R[0][0] * cN + R[1][0] * cE; cB[1] = R[0][1] * cN + R[1][1] * cE; cB[2] = R[0][2] * cN + R[1][2] * cE; }
    const wp = this._wp || (this._wp = {});
    const seaAt = (p) => {
      const P = this.worldOf(p, wp);
      if (env.wavesOn) { const s = env.waves.sample(P.x, P.z, t, this._ws); P.eta = s.h; P.vx = s.vx; P.vy = s.vy; P.vz = s.vz; }
      else { P.eta = 0; P.vx = 0; P.vy = 0; P.vz = 0; }
      return P;
    };
    // body velocity of a point p (relative to the CG): v + w x (p - cg)
    const rr = this._rr || (this._rr = [0, 0, 0]), wr = this._wr || (this._wr = [0, 0, 0]);
    const pointVel = (p, o) => { rr[0] = p[0] - cg[0]; rr[1] = p[1] - cg[1]; rr[2] = p[2] - cg[2]; cross(wb, rr, wr); o[0] = vb[0] + wr[0]; o[1] = vb[1] + wr[1]; o[2] = vb[2] + wr[2]; return o; };
    const pv = this._pv || (this._pv = [0, 0, 0]);
    const airRel = (p, Sx, o) => {
      // (the height of the point above the water: the logarithmic boundary layer of the true wind)
      const P = this.worldOf(p, wp), prof = env.wind.profile(Math.max(0.3, P.y));
      pointVel(p, pv);
      o[0] = aB[0] * prof - pv[0]; o[1] = aB[1] * prof - pv[1]; o[2] = aB[2] * prof - pv[2];
      return o;
    };
    // the water's velocity relative to a point: the current and the wave's orbital motion (decaying with depth), less
    // the point's own; the depth of the point below the local surface
    const waterRel = (p, Sx, o) => {
      const P = Sx && Sx._sea ? Sx._sea : seaAt(p);
      const e = Math.exp(-(env.waves && env.waves.kv || 0) * Math.max(0, Sx && Sx.d || 0));
      const oN = -P.vz * e, oE = P.vx * e, oD = -P.vy * e;
      pointVel(p, pv);
      o[0] = cB[0] + R[0][0] * oN + R[1][0] * oE + R[2][0] * oD - pv[0];
      o[1] = cB[1] + R[0][1] * oN + R[1][1] * oE + R[2][1] * oD - pv[1];
      o[2] = cB[2] + R[0][2] * oN + R[1][2] * oE + R[2][2] * oD - pv[2];
      return o;
    };
    const depth = (p, Sx) => { const P = seaAt(p); const sea = Sx._sea || (Sx._sea = {}); sea.x = P.x; sea.z = P.z; sea.eta = P.eta; sea.vx = P.vx; sea.vy = P.vy; sea.vz = P.vz; return P.eta - P.y; };

    const F = [0, 0, 0], M = [0, 0, 0];
    const add = (f, m) => { F[0] += f[0]; F[1] += f[1]; F[2] += f[2]; M[0] += m[0]; M[1] += m[1]; M[2] += m[2]; };
    const addAt = (p, f) => { rr[0] = p[0] - cg[0]; rr[1] = p[1] - cg[1]; rr[2] = p[2] - cg[2]; const m = cross(rr, f, this._m || (this._m = [0, 0, 0])); F[0] += f[0]; F[1] += f[1]; F[2] += f[2]; M[0] += m[0]; M[1] += m[1]; M[2] += m[2]; };

    // ---- the wing ----
    const wg = this.wing.forces(airRel, null, rhoA, cg, dt);
    add(wg.F, wg.M);
    if (this.extension) { const r = this.extension.forces(airRel, null, rhoA, cg, dt); add(r.F, r.M); }
    // ---- the foils and the rudder ----
    for (const f of this.foils) { const r = f.forces(waterRel, depth, RHO_W, cg, dt); add(r.F, r.M); }
    for (const f of this.rudders) {
      // (a retractable skeg: the pilot pulls it up above its speed, and lowers it again below 0.8 of it)
      if (f.spec.retract) { const v = this.u / KT; if (v > f.spec.retract) f.up = true; else if (v < 0.8 * f.spec.retract) f.up = false; if (f.up) { f.F[0] = f.F[1] = f.F[2] = 0; continue; } }
      const r = f.forces(waterRel, depth, RHO_W, cg, dt); add(r.F, r.M);
    }
    // ---- the pods ----
    const pf = this._pf || (this._pf = [0, 0, 0]), wv = this._wv || (this._wv = [0, 0, 0]);
    let podLift = 0, podDrag = 0, podsWet = 0;
    for (const pd of this.pods) {
      const P = pd.P, k = pd.keel;
      const Sx = pd;
      const dk = depth(k, Sx);                                       // the keel's depth at the transom
      // its trim to the water: the craft's pitch, the pod's own incidence, less the sea's slope along it
      waterRel(k, Sx, wv);
      const Vx = -wv[0], Vy = -wv[1], Vz = -wv[2];                   // (the pod's velocity through the water)
      // the bottom's trim to the flow: the pod's incidence plus the angle the water meets it at (its body-frame
      // velocity holds the pitch and the heave rate); slow, the trim to the surface
      const trim = this.pitch + (P.inc ?? 0);
      const tau = (P.inc ?? 0) + lerp(this.pitch, Math.atan2(Vz, Math.abs(Vx)), sstep(0.5, 2, Math.abs(Vx)));
      const pc = planeCoef(P, dk, tau, Vx, Vy, pd.st, trim);
      if (pc.L > 0) {
        podsWet++;
        // the bottom's pressure acts normal to it (up the body's -z, tilted by the deadrise's side force none: the
        // pod is symmetric), its drag back along the flow, its side force across; at the centre of pressure
        const xp = k[0] + pc.xcp, cp = [xp, k[1], k[2]];
        const V = Math.hypot(Vx, Vy) || 1;
        // (and the waves it makes moving up and down, its radiation damping: a damping ratio of ~0.2 on its waterplane's
        // stiffness for a third of her mass, est.: a small float at rest stops bouncing in a few cycles)
        const kz = RHO_W * G * P.b * Math.max(0.05, pc.lam * P.b), Bz = 0.4 * Math.sqrt(kz * this.mass / 3);
        // (the dynamic pressure on the bottom pushes along its normal, the body's -z; the buoyancy straight up, the world's
        // -D: R^T [0, 0, -hs])
        const dyn = pc.L - pc.hs, hs = pc.hs;
        pf[0] = -pc.D * Vx / V - hs * R[2][0]; pf[1] = -pc.D * Vy / V + pc.S - hs * R[2][1]; pf[2] = -dyn - hs * R[2][2] - Bz * Vz * (1 - sstep(1, 3, pc.Cv));
        addAt(cp, pf);
        podLift += pc.L; podDrag += pc.D;
      }
      pd.d = dk; pd.out = pc;
    }
    // ---- weight ----
    {
      // (gravity is +D in NED: its body components are R^T [0, 0, m g])
      F[0] += R[2][0] * this.mass * G; F[1] += R[2][1] * this.mass * G; F[2] += R[2][2] * this.mass * G;
    }
    // ---- the air drag of the hull, beam, pods, pilot ----
    {
      const a = this._aw || (this._aw = [0, 0, 0]);
      for (const W of S.windage) {
        const p = W._p || (W._p = up2dn(W.p));
        airRel(p, null, a);
        const V = Math.hypot(a[0], a[1], a[2]), q = 0.5 * rhoA * V * W.cd;
        // (frontal area along the flow, side area across it)
        const A = W.area[0] * Math.abs(a[0]) / (V || 1) + W.area[1] * Math.hypot(a[1], a[2]) / (V || 1);
        const f = [q * A * a[0], q * A * a[1], q * A * a[2]];
        addAt(p, f);
      }
    }
    // ---- the parts that go under: the hull and the beam in the water (a capsize, a nosedive) ----
    if (S.wet) for (const Wt of S.wet) {
      const p = Wt._p || (Wt._p = up2dn(Wt.p)), Sx = Wt;
      const dd = depth(p, Sx);
      if (dd > -Wt.r) {
        const f = clamp((dd + Wt.r) / (2 * Wt.r), 0, 1);
        const vol = Wt.vol * f, a = this._ww || (this._ww = [0, 0, 0]);
        waterRel(p, Sx, a);
        const V = Math.hypot(a[0], a[1], a[2]), q = 0.5 * RHO_W * V * Wt.cd * Wt.area * f;
        const up = [R[2][0] * -RHO_W * G * vol, R[2][1] * -RHO_W * G * vol, R[2][2] * -RHO_W * G * vol];
        addAt(p, [up[0] + q * a[0], up[1] + q * a[1], up[2] + q * a[2]]);
      }
    }
    // ---- grounding: the foil's tip and the pods on the bottom ----
    this.aground = 0;
    if (world) {
      const tip = this.foils[0] ? this.foils[0].strips[this.foils[0].n - 1].p : [0, 0, 1];
      const P = this.worldOf(tip, wp), dep = world.depthAt(P.x, P.z);
      const pen = -P.y - dep;
      if (pen > 0) {
        this.aground = pen;
        const k = clamp(pen / 0.15, 0, 1);
        F[0] -= vb[0] * this.mass * 4 * k; F[1] -= vb[1] * this.mass * 4 * k;
        M[2] -= wb[2] * this.I[2][2] * 3 * k;
      }
    }
    // ---- external loads (the game's: a tow line) ----
    const E = this.ext;
    if (E) { F[0] += E.X || 0; F[1] += E.Y || 0; M[0] += E.K || 0; M[2] += E.N || 0; }

    // ---- integrate: Newton-Euler about the centre of gravity, body frame ----
    const m = this.mass, ma = this.mAdd;
    const ax = (F[0] - m * (wb[1] * vb[2] - wb[2] * vb[1])) / (m + ma[0]);
    const ay = (F[1] - m * (wb[2] * vb[0] - wb[0] * vb[2])) / (m + ma[1]);
    const az = (F[2] - m * (wb[0] * vb[1] - wb[1] * vb[0])) / (m + ma[2]);
    const Iw = mv(this.I, wb, this._Iw || (this._Iw = [0, 0, 0])), gyro = cross(wb, Iw, this._gy || (this._gy = [0, 0, 0]));
    // (roll and pitch damping of the water and air the elements already give; a little numerical damping of the body's
    // own rates against a stiff contact)
    const rhs = [M[0] - gyro[0], M[1] - gyro[1], M[2] - gyro[2]];
    const dw = mv(this.Iinv, rhs, this._dw || (this._dw = [0, 0, 0]));
    vb[0] += ax * dt; vb[1] += ay * dt; vb[2] += az * dt;
    wb[0] += dw[0] * dt; wb[1] += dw[1] * dt; wb[2] += dw[2] * dt;
    for (let k = 0; k < 3; k++) { if (!Number.isFinite(vb[k])) vb[k] = 0; if (!Number.isFinite(wb[k])) wb[k] = 0; vb[k] = clamp(vb[k], -60, 60); wb[k] = clamp(wb[k], -8, 8); }
    // Euler angle rates
    const cf = Math.cos(this.phi), sf = Math.sin(this.phi), ct = Math.max(0.05, Math.cos(this.pitch)), tt = Math.tan(this.pitch);
    const [p, q, r] = wb;
    const dphi = p + (q * sf + r * cf) * tt, dth = q * cf - r * sf, dpsi = (q * sf + r * cf) / ct;
    // the CG's velocity in NED
    const vN = R[0][0] * vb[0] + R[0][1] * vb[1] + R[0][2] * vb[2], vE = R[1][0] * vb[0] + R[1][1] * vb[1] + R[1][2] * vb[2], vD = R[2][0] * vb[0] + R[2][1] * vb[1] + R[2][2] * vb[2];
    // move the CG, then turn about it: the origin (the game's position) follows
    const cgW0 = this.worldOf(cg, this._cgW0 || (this._cgW0 = {}));
    const cgx = cgW0.x + vE * dt, cgz = cgW0.z - vN * dt, cgy = cgW0.y - vD * dt;
    this.phi = wrap(this.phi + dphi * dt); this.pitch = clamp(this.pitch + dth * dt, -1.4, 1.4); this.psi = wrap(this.psi + dpsi * dt);
    this._rot();
    const off = this.worldOf(cg, this._cgW1 || (this._cgW1 = {}));                                   // (where the CG would be with the old origin)
    this.x += cgx - off.x; this.z += cgz - off.z; this.heave += cgy - off.y;
    // ---- what the game reads ----
    const fx = Math.sin(this.psi), fz = -Math.cos(this.psi), sx = Math.cos(this.psi), sz = Math.sin(this.psi);
    const gx = vE, gz = -vN;                                            // (over the ground, x and z)
    this.vgx = gx; this.vgz = gz;
    // speed through the water along the heading and across it (the level frame), the rates as the game has them
    this.u = (gx - cur.x) * fx + (gz - cur.z) * fz; this.v = (gx - cur.x) * sx + (gz - cur.z) * sz;
    this._uOut = this.u; this._vOut = this.v;
    this.r = dpsi; this.p = dphi; this.pitchV = dth; this.heaveV = -vD;
    this.log += Math.hypot(gx, gz) * dt;
    this.capsized = Math.abs(this.phi) > 75 * DEG || Math.abs(this.pitch) > 50 * DEG;
    if (!last) return;
    // ---- diagnostics / instruments ----
    d.X = F[0]; d.Y = F[1]; d.Z = F[2]; d.K = M[0]; d.Mp = M[1]; d.N = M[2];
    const wd = this.wing.diag, fd = this.foils[0] ? this.foils[0].diag : {};
    d.wing = { alpha: wd.alpha, cl: wd.L / Math.max(1e-6, 0.5 * rhoA * wd.V * wd.V * this.wing.area), L: wd.L, D: wd.D, LD: wd.LD, F: [...this.wing.F], M: [...this.wing.M], V: wd.V, stalled: wd.stalled, angle: this.wing.delta };
    d.foil = { alpha: fd.alpha, L: fd.L, D: fd.D, LD: fd.LD, vent: fd.vent, cav: fd.cav, imm: fd.imm, sigma: fd.sigma, F: this.foils[0] ? [...this.foils[0].F] : [0, 0, 0], M: this.foils[0] ? [...this.foils[0].M] : [0, 0, 0] };
    d.pods = this.pods.map((pd) => ({ d: pd.d, L: pd.out.L, D: pd.out.D, lam: pd.out.lam, Cv: pd.out.Cv }));
    d.podLift = podLift; d.podDrag = podDrag; d.podsWet = podsWet;
    d.rudderAlpha = this.rudders[0] ? this.rudders[0].diag.alpha : 0; d.rudderVent = this.rudders[0] ? this.rudders[0].diag.vent : 0;
    d.sailK = wg.M[0]; d.sailX = wg.F[0]; d.sailY = wg.F[1];
    d.leeway = Math.atan2(this.v, Math.max(0.05, this.u));
    d.bsp = this.u; d.heading = this.psi; d.cog = Math.atan2(gx, -gz);
    // the apparent wind at the wing's middle (the instruments' masthead: the wing's tip)
    const top = this.wing.strips[this.wing.n - 1].p, mid = this.wing.strips[this.wing.n >> 1].p, a = this._aw || (this._aw = [0, 0, 0]);
    airRel(mid, null, a);
    d.awaMid = Math.atan2(-a[1], -a[0]); d.qMid = 0.5 * rhoA * (a[0] * a[0] + a[1] * a[1]);
    airRel(top, null, a);
    d.aws = Math.hypot(a[0], a[1]); d.awa = Math.atan2(-a[1], -a[0]);
    const P = this.worldOf(top, wp), prof = env.wind.profile(Math.max(0.3, P.y));
    const tx = a[0] + vb[0], ty = a[1] + vb[1];
    d.twsInst = Math.hypot(tx, ty) / prof; d.twa = Math.atan2(-ty, -tx);
    d.rhoA = rhoA; d.fn = 0; d.flyIn = 1;
    // the heeling moment the pods take: what the wing and foil leave unbalanced (+ starboard down), about the CG
    d.heelMoment = M[0];
    // the 500 m and nautical-mile runs (WSSRC): js/speedtrial.js
    if (this.trial) this.trial.update(this, t);
  }
}

// ------------------------------------------------------------------------------------------------ automatic trim
// The pilot's wing trim: the wing set to the angle of attack of its best drive for the course, about 9 deg (the
// section's lift/drag peaks at 6-10 deg at Re ~ 3e6; past ~12 deg it nears the stall): the control line moves the trim
// at the pilot's speed. (Upwind or overpowered the target falls: the heeling moment is the craft's limit.)
export function speedAutoTrim(b, dt, aoaBias = 0) {
  const W = b.cls.speed.wing, wg = b.wing, a = b.diag.wing ? b.diag.wing.alpha : 0, awa = Math.abs(b.diag.awaMid ?? 0);
  // the angle of attack of the wing's best drive (lift across the course less drag along it) in this apparent wind,
  // from the wing's own section and span (the pilot's "full power" is this; easing from it is the depower), every
  // 0.2 s (with a margin of 2 deg from the stall)
  b._atT = (b._atT || 0) - dt;
  if (b._atT <= 0 || b._aBest === undefined) {
    b._atT = 0.2;
    const S = wg.strips[wg.n >> 1], st = { stalled: false, sep: 0, vent: 0, ventOn: false, cav: 0 }, o = b._atO || (b._atO = {});
    const V = Math.max(3, wg.diag.V || 10), ARe = wg.diag.ARe || 4, a0 = W.sec.alpha0 || 0;
    let best = -Infinity, aB = 8 * DEG;
    for (let x = 2; x <= 26; x += 1) {
      st.stalled = false; st.sep = 0;
      const c = coef(S.sec, st, x * DEG + a0, V, ARe, -1, false, 1, o);
      if (st.stalled || x * DEG + a0 > o.ast - 2 * DEG) break;
      const dr = c.cl * Math.sin(awa) - c.cd * Math.cos(awa);
      if (dr > best) { best = dr; aB = x * DEG; }
    }
    b._aBest = aB;
  }
  // (the foil boiling: she slows, slides to leeward and the ride goes rough. The pilot eases the wing until it holds
  // again, and sheets back on slowly)
  const cav = b.diag.foil ? b.diag.foil.cav || 0 : 0;
  b._ease = clamp((b._ease || 0) + (cav > 0.5 ? 3 : -0.4) * DEG * dt, 0, 12 * DEG);
  const target = b._aBest + aoaBias * DEG - b._ease;
  // the wing's angle of attack falls as the trim angle rises (the chord turned away from the wind)
  const err = a - target;
  const de = clamp(err * 1.2 * dt, -0.15 * dt, 0.15 * dt);
  b.ctrl.main = clamp(b.ctrl.main + de * (W.trim[1] > W.trim[0] ? 1 : -1), 0, 1);
}

// ------------------------------------------------------------------------------------------------ helm
// The pilot's steering to a heading: the wheel on the front rudder, against the yaw rate (a person's hands: the
// rudder itself moves at its own rate, step)
export function speedHelm(b, psi, gain = 4) {
  const e = wrap(psi - b.psi);
  b.ctrl.helm = clamp(gain * e - 1.6 * b.r, -1, 1);
}

// ------------------------------------------------------------------------------------------------ VPP
// The polar: the craft steered on a fixed true-wind angle (flat water, steady wind) with the pilot's automatic wing
// trim, from a running start (she is towed up to speed and let go, as she is at Walvis Bay: from about 0.7 of the
// wind's speed), averaged over the last quarter of the run. Her heading is held by the helm (the rudder trims the
// yaw moment, and drags for it), not locked.
export function speedPolarAngle(C, twsMS, twaDeg, opts = {}) {
  const env = makeSteadyEnv(twsMS), dt = 1 / 60;
  let best = { twa: twaDeg, bsp: 0, vmg: 0 };
  const side = C.speed.windSide ?? -1;                        // (the side the wind must come from: -1 port)
  const psi = -side * twaDeg * DEG;                           // (wind from 0: heading so the wind is on her side)
  for (const bias of opts.biases ?? [-4, -2, 0]) {
    const b = new SpeedCraft(C);
    b.reset(0, 0, psi);
    const v0 = opts.v0 ?? 0.7 * twsMS;
    b.vb[0] = v0; b.u = b._uOut = v0;
    b.ctrl.main = b.lines.main = 0.3;
    let acc = 0, n = 0, cap = false, heel = 0;
    const steps = Math.round((opts.secs ?? 40) / dt);
    for (let i = 0; i < steps; i++) {
      speedAutoTrim(b, dt, bias);
      speedHelm(b, psi);
      b.step(dt, env, i * dt);
      if (b.capsized) { cap = true; break; }
      if (i > steps * 0.75) { acc += b.u; heel += b.phi; n++; }
    }
    const bsp = cap ? 0 : acc / n;
    if (bsp > best.bsp) best = { twa: twaDeg, bsp, heel: heel / n / DEG, bias, leeway: b.diag.leeway / DEG, capsized: cap };
    if (cap && !best.bsp) best.capsized = true;
  }
  best.vmg = best.bsp * Math.cos(twaDeg * DEG);
  return best;
}

craftHooks.make = (C, opts) => (C.speed ? new SpeedCraft(C, opts) : null);
craftHooks.polarAngle = (C, tws, twa, opts) => (C.speed ? speedPolarAngle(C, tws, twa, opts) : null);
craftHooks.autoTrim = (b, dt, bias) => { if (!b.speedCraft) return false; speedAutoTrim(b, dt, bias); return true; };
