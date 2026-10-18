// Lifting surfaces and planing surfaces for the speed machines (js/speedcraft.js): a rigid wing in the air, foils in
// the water that run at 30 m/s and more, and the planing pods they ride on. Pure math (no three.js, no physics.js
// import), in the body frame SNAME uses: x forward, y to starboard, z DOWN (right-handed). (The class files give heights
// +up like the rest of the game; js/speedcraft.js turns them over.)
//
// Sections (coef):
//  * 'naca': a symmetric NACA 00xx section in air or water, as the appendages (js/foils.js): 2-D slope 0.95 x 2 pi,
//    Helmbold's finite-span slope on the surface's effective aspect ratio, profile drag 2 Cf (1 + 2 t/c + 60 (t/c)^4),
//    CLmax against Reynolds number (NACA 0012 data, Sheldahl & Klimas 1981), stall with hysteresis and, past it, a
//    flat plate with no leading-edge suction (Viterna-Corrigan). In water: the suction peak -Cp_min against the
//    cavitation number sigma = (p_atm + rho g h - p_v) / q (js/foils.js cpMin), past which the lift saturates.
//  * 'scav': a supercavitating / ventilated section, a sharp leading edge and a blunt base, made to run with its
//    suction side and base in a cavity (Tulin 1953, "Steady two-dimensional cavity flows about slender bodies", DTMB
//    report 834; Johnson 1961, "Theoretical and experimental investigation of supercavitating hydrofoils operating near
//    the free water surface", NASA TR R-93; Acosta 1973, "Hydrofoils and hydrofoil craft", Annu. Rev. Fluid Mech. 5).
//    Fully wetted (slow, before the cavity forms) it is a thin section with the base drag of its blunt trailing edge
//    (base pressure coefficient about -0.2: Hoerner, "Fluid-Dynamic Drag" ch. 3) and a sharp leading edge's early
//    suction peak (it cavitates early: the cavity is meant to form). In the cavity regime the suction side is at the
//    cavity's pressure and only the pressure face works: the normal force of a flat plate in free-streamline flow,
//    Kirchhoff-Rayleigh's 2 pi sin a / (4 + pi sin a), raised by the cavitation number as Wu's finite-cavity theory
//    gives it, C_N(sigma) ~ C_N(0) (1 + sigma) (Wu 1955, "A free streamline theory for two-dimensional fully
//    cavitated hydrofoils", J. Math. Phys. 35). Its drag is the normal force's component along the flow, C_N sin a,
//    plus friction on the one wetted face: a plate's lift/drag ~ 1 / tan a, the lower bound of a cambered SC face
//    (Johnson's three-term sections do better at their design point; the face's camber is not published for the
//    boats modelled here: the plate is the conservative estimate). The cavity is
//      - vapour (supercavitation) once the wetted section's suction peak passes sigma, at cavitation number sigma;
//      - air (ventilation) when the surface-piercing surface pulls air down its sharp edge: then the cavity is at
//        atmospheric pressure, sigma_v = rho g h / q, nearly zero at speed. It forms above an inception speed and angle
//        (gravity holds the surface closed at chord Froude numbers below ~2: Rothblum, Mayer & Wilburn 1969, "
//        Ventilation, cavitation and other characteristics of high speed surface-piercing struts", DTNSRDC 3023;
//        Harwood et al. 2016, J. Fluid Mech. 800) and washes out with strong hysteresis.
//  Three-dimensional: the 2-D coefficients carry Helmbold's ratio of the finite slope to the section's and the induced
//  drag CL^2 / (pi AR_e 0.9) as js/foils.js does; the immersed span sets AR_e (a surface-piercing foil's tip at the
//  surface is a free tip at speed).
//
// Planing (planeCoef): Savitsky's prismatic planing surface (Savitsky 1964, "Hydrodynamic design of planing hulls",
// Marine Technology 1(1)): C_L0 = tau^1.1 (0.012 lambda^0.5 + 0.0055 lambda^2.5 / Cv^2), C_Lbeta = C_L0 - 0.0065 beta
// C_L0^0.6, lift 1/2 rho V^2 b^2 C_Lbeta, the pressure resultant normal to the bottom (drag L tan tau) and friction on the
// wetted bottom lambda b^2 / cos beta (ITTC-57). The wetted length from the keel's immersion at the transom (keel
// wetted length d / sin tau, the chines' shorter by b tan beta / (pi tan tau): Savitsky's wave rise). Slow (Cv < 1),
// where his fit no longer holds, the pod is a floating body: its buoyancy and its form drag; the hydrostatic part of
// his lift (the 0.0055 term) is the transition, the dynamic part grows in from Cv 0.5 to 1.5.
import { G } from './env.js';
import { clMax2D, cd0Section, helmbold, cpMin, cfFoil } from './foils.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
export const RHO_W = 1025, NU_W = 1.19e-6, NU_A = 1.5e-5, P_ATM = 101325, P_VAP = 2340;

// Kirchhoff-Rayleigh: normal force coefficient of a flat plate in free-streamline flow (cavity at sigma = 0)
export const cnKirchhoff = (a) => { const s = Math.sin(Math.abs(a)); return 2 * Math.PI * s / (4 + Math.PI * s); };
// the |cl| at which a wetted symmetric section's suction peak reaches sigma (js/foils.js cpMin, solved for cl)
// (cp0: the suction peak the thickness alone makes: a NACA 00xx's 0.41 (t/c / 0.12) by default; a section drawn for a
// flat pressure at its design lift, the NACA 16-series that propellers and hydrofoils use, ~2 t/c (Abbott & von
// Doenhoff, "Theory of Wing Sections" (1959) app. I; Brockett 1966, DTMB report 1780))
export function clCav(sigma, tc, cp0 = 0.41 * (tc / 0.12)) {
  const a = 2.9 * Math.sqrt(0.12 / tc), b = 1.3, c = cp0 - sigma;
  if (c >= 0) return 0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export function surfState() { return { stalled: false, sep: 0, vent: 0, ventOn: false, cav: 0 }; }

// Section + span coefficients at signed angle of attack a (rad, any), flow speed V (m/s), for a surface of section
// spec sec ({ kind 'naca' | 'scav', tc, chord, water, tb (base thickness / chord), aVent (inception angle) }),
// effective aspect ratio ARe, depth h of the section (m, water: for sigma; < 0 out of the water), whether air can reach
// it from the surface (pierce: the surface is cut by the free surface above it), dt (s) for the state's relaxation.
export function coef(sec, st, a, V, ARe, h, pierce, dt, out, baseVent = false) {
  if (sec.kind === 'wedge') return wedgeCoef(sec, st, a, V, ARe, h, pierce, dt, out, baseVent);
  let s = Math.sign(a) || 1; a = Math.abs(a);
  if (a > Math.PI / 2) { a = Math.PI - a; s = -s; }
  const Va = Math.max(0.05, Math.abs(V)), c = sec.chord, water = !!sec.water;
  const Re = Va * c / (water ? NU_W : NU_A);
  const a0 = 0.95 * 2 * Math.PI * (Re < 2e5 ? 0.9 + 0.1 * Re / 2e5 : 1);
  const slope = helmbold(Math.max(0.05, ARe), a0), k3 = slope / a0;
  const scav = sec.kind === 'scav';
  // stall: a sharp leading edge separates early (a thin plate's CLmax ~0.8 at 8-10 deg), a round one per Re
  const clMax = sec.clMax ?? (scav ? 0.8 : 0.9 * clMax2D(Re, sec.tc));
  const ast = clamp(clMax / slope, 6 * DEG, 30 * DEG);
  if (!st.stalled && a > ast) st.stalled = true;
  else if (st.stalled && a < 0.8 * ast) st.stalled = false;
  const sepT = st.stalled ? sstep(0.8 * ast, 0.88 * ast, a) : sstep(ast, ast + 6 * DEG, a);
  st.sep += (sepT - st.sep) * clamp(dt * Va / (3 * c), 0, 1);
  let clA = slope * a;
  if (a > 0.85 * ast) clA = slope * 0.85 * ast + (clMax - slope * 0.85 * ast) * Math.sin(Math.min(1, (a - 0.85 * ast) / (0.15 * ast)) * Math.PI / 2);
  // (sec.cd0: a section's own zero-lift drag where it is not a smooth foil, e.g. a ribbed film wing with gaps between
  // its elements; sec.kcl: its viscous drag rise with lift, cd += kcl cl^2 (a section's drag bucket))
  const cd0 = (sec.cd0 ?? cd0Section(Re, scav ? 0.04 : sec.tc)) + (scav ? 0.2 * (sec.tb ?? 0.05) : 0);   // (a blunt base, wetted)
  const cdMax = 1.11 + 0.018 * ARe;
  const clS = Math.max(cdMax * Math.sin(a) * Math.cos(a), clMax * (1 - 0.4 * Math.min(1, (a - ast) / 0.12)) * (a < ast + 0.3 ? 1 - (a - ast) / 0.3 : 0));
  let cl = lerp(clA, clS, st.sep), cd = lerp(cd0 + (sec.kcl ?? 0) * clA * clA + clA * clA / (Math.PI * ARe * 0.9), cd0 + cdMax * Math.sin(a) ** 2, st.sep);
  let sigma = Infinity, sigV = Infinity, cavT = 0;
  if (water && h > 0) {
    const q = 0.5 * RHO_W * Va * Va;
    sigma = (P_ATM + RHO_W * G * h - P_VAP) / q;
    sigV = RHO_W * G * h / q;
    // the wetted section's suction peak against sigma: a sharp leading edge peaks as a thin one does. A cambered section
    // drawn for a design lift (sec.clDesign: a cavitation "bucket", the NACA 16 / a = 0.8 kind: Brockett 1966, DTMB
    // report 1780) peaks with its lift's distance from that design lift, not from zero
    const cc = scav ? clCav(sigma, 0.04) : clCav(sigma, sec.tc, sec.cp0), dcl = Math.abs(cl * s - (sec.clDesign || 0));
    if (dcl > cc) cavT = clamp((dcl - cc) / Math.max(0.05, dcl), 0, 1);
  }
  // ventilation: air down a surface-piercing surface's suction side (scav: its sharp edge; naca: past the inception
  // angle, js/foils.js). Gravity closes the surface below a chord Froude number ~2.
  const Fnc = Va / Math.sqrt(G * c);
  let vT = 0;
  if (water && h > 0 && pierce) {
    const aVi = (sec.aVent ?? (scav ? 2.5 : 14)) * DEG * (1 + 3 * (1 - sstep(1.5, 3, Fnc)));
    if (!st.ventOn && a > aVi && Fnc > 1.5) st.ventOn = true;
    else if (st.ventOn && (a < 0.4 * aVi || Fnc < 1.2)) st.ventOn = false;
    vT = st.ventOn ? 1 : 0;
  } else st.ventOn = false;
  st.vent += (vT - st.vent) * clamp(dt * Va / (vT > st.vent ? 2 * c : 8 * c), 0, 1);
  st.cav += (cavT - st.cav) * clamp(dt * Va / (2 * c), 0, 1);
  const cavity = Math.max(st.vent, scav ? st.cav : 0);
  if (cavity > 1e-3) {
    // free-streamline plate: the pressure face only, at the cavity's own cavitation number (air: sigma_v; vapour: sigma)
    const sc = st.vent >= st.cav || !scav ? sigV : sigma, sg = Number.isFinite(sc) ? clamp(sc, 0, 2) : 0;
    const cn = cnKirchhoff(a) * (1 + sg) * k3;
    const clC = cn * Math.cos(a), cfw = cfFoil(Re);
    const cdC = cn * Math.sin(a) + cfw + clC * clC / (Math.PI * ARe * 0.9);
    if (scav) { cl = lerp(cl, clC, cavity); cd = lerp(cd, cdC, cavity); }
    else { cl = lerp(cl, Math.min(cl, clC), st.vent); cd = lerp(cd, Math.max(cd, cdC), st.vent); }
  }
  // a round-nosed (naca) section cavitating: the lift saturates past sigma, the drag grows (js/foils.js)
  if (!scav && water && st.cav > 0 && Number.isFinite(sigma)) {
    const cc = clCav(sigma, sec.tc, sec.cp0), cD = (sec.clDesign || 0) * s, dcl = cl - cD;
    if (Math.abs(dcl) > cc) { const ex = Math.abs(dcl) - cc; cl = cD + Math.sign(dcl) * (cc + 0.25 * ex); cd += 0.15 * ex; }
  }
  out.cl = cl * s; out.cd = cd; out.sigma = sigma; out.sigmaV = sigV; out.vent = st.vent; out.cav = st.cav; out.stalled = st.sep > 0.5;
  out.Re = Re; out.ast = ast; out.cavity = cavity; out.Fnc = Fnc;
  return out;
}

// A base-ventilated wedge (Sailrocket 2's foil, Aerotrope: a sharp leading edge, flat faces diverging at the half-angle
// theta = atan(t_b / 2c) to a blunt base t_b, the base fed with air down the surface-piercing foil). Linearised
// free-streamline theory (Tulin 1961, "Supercavitating flows", ch. 12 of Handbook of Fluid Dynamics; the base-vented
// sections of Tulin & Burkart): with the base in a cavity at pressure p_c and both faces wetted (|alpha| < theta: each
// face meets the flow at a positive angle, its pressure above the stream's, so it neither cavitates nor draws air), the
// section lifts as a wetted one (slope 0.9 x 2 pi in 2-D, est.), its faces carry the forebody pressure drag
// (pi / 4) (t_b / c)^2 (each face at angle theta carries C_p ~ (pi / 2) theta), and the base the cavity's suction
// sigma_c t_b / c: vented, sigma_c = sigma_v = rho g h / q (almost nothing at speed); not vented, a wetted blunt base's
// -C_pb ~ 0.25 (Hoerner ch. 3) until the base boils, at sigma (then p_c = p_v: what costs a 0.04 m^2 base ~400 kg at
// 60 kn, node/517). Past |alpha| = theta the suction face meets the flow at a negative angle from its sharp edge:
//  * it boils (supercavitates) once its suction passes sigma: alpha > theta + sigma / pi (est.: the face's mean C_p
//    ~ -pi (alpha - theta) in the linear theory);
//  * where the face reaches the surface (above any fence) it draws air in as soon as it is below the stream's pressure,
//    alpha > theta (at chord Froude numbers over ~2; washes out below 0.5 theta);
// and the section is then a supercavitating plate whose pressure face meets the flow at alpha + theta: Kirchhoff's
// normal force raised by the cavity's sigma (Wu), drag along that face's normal. Its lift falls by about half: the
// wall a foil hits.
function wedgeCoef(sec, st, a, V, ARe, h, pierce, dt, out, baseVent) {
  let s = Math.sign(a) || 1; a = Math.abs(a);
  if (a > Math.PI / 2) { a = Math.PI - a; s = -s; }
  const Va = Math.max(0.05, Math.abs(V)), c = sec.chord, tb = sec.tb ?? 0.12, th = Math.atan(tb / 2);
  const Re = Va * c / NU_W, cf = cfFoil(Re), a0 = 0.9 * 2 * Math.PI;
  const slope = helmbold(Math.max(0.05, ARe), a0), k3 = slope / a0;
  const q = 0.5 * RHO_W * Va * Va, hh = Math.max(0, h);
  const sigma = (P_ATM + RHO_W * G * hh - P_VAP) / q, sigV = RHO_W * G * hh / q;
  const Fnc = Va / Math.sqrt(G * c);
  // the base: vented (air down the foil, at speed), or a wetted base's suction until it boils
  const bv = baseVent && Fnc > 1.5;
  const sigB = bv ? sigV : Math.min(0.25, sigma);
  // the suction face: boiling, or air from the surface. It boils once its suction passes sigma: past the face angle,
  // alpha > theta + sigma / pi; and, below it, at the sharp leading edge, where the flow turns round the edge onto the
  // face: -Cp_min ~ kLE cl (kLE = 0.9, est.: calibrated on the team's own figures for Sailrocket 2's foils, the 2012
  // foil's expected onset "just over 65 kn" at its load, node/660 (sigma ~0.17 at cl ~0.19), and the earlier one's
  // ceiling at ~52 kn with its lower part 40% overloaded, node/595 (sigma ~0.27 at cl ~0.27-0.3))
  const clW0 = slope * a, kLE = sec.kLE ?? 0.9;
  const aC = th + sigma / Math.PI, boil = a > aC || kLE * clW0 > sigma, unboil = a < th + 0.7 * sigma / Math.PI && kLE * clW0 < 0.85 * sigma;
  if (!st.stalled && boil) st.stalled = true; else if (st.stalled && unboil) st.stalled = false;
  const aV = th * (1 + 3 * (1 - sstep(1.5, 3, Fnc)));
  if (pierce && Va > 1) { if (!st.ventOn && a > aV) st.ventOn = true; else if (st.ventOn && (a < 0.5 * th || Fnc < 1.2)) st.ventOn = false; }
  else st.ventOn = false;
  st.vent += ((st.ventOn ? 1 : 0) - st.vent) * clamp(dt * Va / (st.ventOn ? 2 * c : 8 * c), 0, 1);
  st.cav += ((st.stalled ? 1 : 0) - st.cav) * clamp(dt * Va / (2 * c), 0, 1);
  // faces wetted
  const clW = slope * a;
  const cdW = 2 * cf + Math.PI / 4 * tb * tb + sigB * tb + clW * clW / (Math.PI * ARe * 0.9);
  let cl = clW, cd = cdW;
  const cav = Math.max(st.vent, st.cav);
  if (cav > 1e-3) {
    const sc = st.vent >= st.cav ? sigV : sigma, ap = a + th;
    const cn = cnKirchhoff(ap) * (1 + clamp(sc, 0, 2)) * k3;
    const clC = cn * Math.cos(ap), cdC = cn * Math.sin(ap) + cf + clC * clC / (Math.PI * ARe * 0.9);
    cl = lerp(cl, clC, cav); cd = lerp(cd, cdC, cav);
  }
  out.cl = cl * s; out.cd = cd; out.sigma = sigma; out.sigmaV = sigV; out.vent = st.vent; out.cav = st.cav; out.stalled = st.cav > 0.5;
  out.Re = Re; out.ast = aC; out.cavity = cav; out.Fnc = Fnc; out.baseVent = bv; out.theta = th;
  return out;
}

// ------------------------------------------------------------------------------------------------ lifting surface
// A straight (or tapered) surface from a root point along a unit span vector, in strips. Its chord line is set by a
// rotation about the span (incidence, the wing's trim): chord0 the reference chord direction (unit, perpendicular to
// the span, pointing from the leading edge to the trailing edge). For each strip the caller supplies the fluid's
// velocity relative to the strip (body frame) and, in water, the strip's depth; forces are summed in the body frame
// with their moments about the centre of gravity.
const cross = (a, b, o) => { o[0] = a[1] * b[2] - a[2] * b[1]; o[1] = a[2] * b[0] - a[0] * b[2]; o[2] = a[0] * b[1] - a[1] * b[0]; return o; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; a[0] /= l; a[1] /= l; a[2] /= l; return a; };
export const v3 = { cross, dot, norm };

export class Surface {
  // spec: { root: [x, y, z] (body, z down), span: [sx, sy, sz] (unit), len (m), chord: [root, tip] or number,
  //         chord0: [cx, cy, cz] (unit, LE -> TE at zero incidence), sec: {...} (coef), n: strips, water: bool,
  //         endPlate: 0..1 (root image), area (m^2, optional: the planform's) }
  constructor(spec) {
    this.spec = spec;
    const n = spec.n || 6;
    this.n = n;
    const c = Array.isArray(spec.chord) ? spec.chord : [spec.chord, spec.chord];
    this.strips = [];
    let A = 0;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, ch = lerp(c[0], c[1], f), ds = spec.len / n;
      const p = [spec.root[0] + spec.span[0] * spec.len * f, spec.root[1] + spec.span[1] * spec.len * f, spec.root[2] + spec.span[2] * spec.len * f];
      this.strips.push({ f, chord: ch, ds, area: ch * ds, p, st: surfState(), sec: { ...spec.sec, chord: ch, water: !!spec.water }, c: {}, F: [0, 0, 0], imm: 1 });
      A += ch * ds;
    }
    this.area = A; this.cMean = A / spec.len;
    this.s = norm([...spec.span]);
    this.c0 = norm([...spec.chord0]);
    // (the side its lift is + to: s x c0, or turned over to face spec.liftTo)
    this.n0 = cross(this.s, this.c0, [0, 0, 0]);
    if (spec.liftTo && dot(this.n0, spec.liftTo) < 0) for (let k = 0; k < 3; k++) this.n0[k] = -this.n0[k];
    this.ch = [...this.c0]; this.nn = [...this.n0]; this.delta = 0;
    this.F = [0, 0, 0]; this.M = [0, 0, 0];
    this.diag = { alpha: 0, cl: 0, cd: 0, vent: 0, cav: 0, imm: 1, V: 0, L: 0, D: 0, sigma: Infinity, stalled: false, LD: 0, ARe: 0 };
  }
  // chord direction at incidence delta: c0 rotated about the span by delta (+ toward n0)
  setIncidence(delta) {
    const cd = Math.cos(delta), sd = Math.sin(delta), c0 = this.c0, n0 = this.n0, c = this.ch, nn = this.nn;
    for (let k = 0; k < 3; k++) { c[k] = c0[k] * cd + n0[k] * sd; nn[k] = n0[k] * cd - c0[k] * sd; }
    this.delta = delta;
  }
  // relVel(p, i, out): fluid velocity relative to strip i at body point p (body frame); depth(p, i): depth below the
  // local surface (m; water only); rho; cg: body point of the centre of gravity. Sums this.F (N) and this.M (N m).
  forces(relVel, depth, rho, cg, dt) {
    const F = this.F, M = this.M, sp = this.spec, s = this.s, c = this.ch, n = this.nn;
    F[0] = F[1] = F[2] = 0; M[0] = M[1] = M[2] = 0;
    // the immersed span (a surface-piercing foil) and its effective aspect ratio: the root's image doubles it while the
    // root is against a body (endPlate), the free surface over a piercing foil is a free tip at speed
    let immN = 0, dTop = Infinity;
    if (sp.water) for (const S of this.strips) { S.d = depth(S.p, S); S.imm = clamp(S.d / (0.5 * S.ds) + 0.5, 0, 1); immN += S.imm; dTop = Math.min(dTop, S.d); }
    else for (const S of this.strips) { S.imm = 1; immN += 1; }
    const spanW = sp.len * immN / this.n;
    const pierce = sp.water && sp.pierce !== false && immN < this.n - 1e-3;
    const ARe = Math.max(0.1, spanW * spanW / Math.max(1e-6, this.area * immN / this.n) * (1 + (sp.endPlate ?? 0)));
    let L = 0, D = 0, aSum = 0, wSum = 0, vMax = 0, cMax = 0, sg = Infinity, Vs = 0;
    const W = this._W || (this._W = [0, 0, 0]), Wh = this._Wh || (this._Wh = [0, 0, 0]), Ld = this._Ld || (this._Ld = [0, 0, 0]), r = this._r || (this._r = [0, 0, 0]), m = this._m || (this._m = [0, 0, 0]);
    for (const S of this.strips) {
      if (S.imm <= 0) { S.F[0] = S.F[1] = S.F[2] = 0; continue; }
      relVel(S.p, S, W);
      const ws = dot(W, s);
      W[0] -= ws * s[0]; W[1] -= ws * s[1]; W[2] -= ws * s[2];          // the section sees the flow across the span
      const V2 = dot(W, W), V = Math.sqrt(V2);
      if (V < 1e-3) { S.F[0] = S.F[1] = S.F[2] = 0; continue; }
      Wh[0] = W[0] / V; Wh[1] = W[1] / V; Wh[2] = W[2] / V;
      const al = Math.atan2(dot(W, n), dot(W, c));
      // (a cambered section lifts at zero incidence: its zero-lift angle, alpha0, toward +n)
      // (fences across a surface-piercing foil stop the air the surface feeds its faces at their depth: below a fence
      // the faces do not ventilate from the surface; the base cavity is fed along the whole trailing edge)
      const pf = pierce && !(sp.fence && S.d > (sp.fenceDepth ?? 0.3));
      const co = coef(S.sec, S.st, al + (sp.sec.alpha0 || 0), V, ARe, sp.water ? S.d : -1, pf, dt, S.c, sp.baseVent ?? (sp.water && pierce));
      // lift: perpendicular to the flow, toward +n for + cl; drag along the flow
      const wn = dot(n, Wh);
      Ld[0] = n[0] - wn * Wh[0]; Ld[1] = n[1] - wn * Wh[1]; Ld[2] = n[2] - wn * Wh[2]; norm(Ld);
      const q = 0.5 * rho * V2 * S.area * S.imm;
      for (let k = 0; k < 3; k++) S.F[k] = q * (co.cl * Ld[k] + co.cd * Wh[k]);
      F[0] += S.F[0]; F[1] += S.F[1]; F[2] += S.F[2];
      r[0] = S.p[0] - cg[0]; r[1] = S.p[1] - cg[1]; r[2] = S.p[2] - cg[2];
      cross(r, S.F, m); M[0] += m[0]; M[1] += m[1]; M[2] += m[2];
      L += q * Math.abs(co.cl); D += q * co.cd;
      const w = q + 1e-9; aSum += al * w; wSum += w; Vs += V * w;
      vMax = Math.max(vMax, co.vent); cMax = Math.max(cMax, co.cav); sg = Math.min(sg, co.sigma);
      this.diag.stalled = co.stalled;
    }
    const d = this.diag;
    d.alpha = wSum > 0 ? aSum / wSum : 0; d.V = wSum > 0 ? Vs / wSum : 0; d.L = L; d.D = D; d.vent = vMax; d.cav = cMax; d.sigma = sg;
    d.imm = immN / this.n; d.ARe = ARe; d.LD = D > 1e-6 ? L / D : 0; d.dTop = dTop;
    return this;
  }
}

// ------------------------------------------------------------------------------------------------ planing pod
// P: { b (beam at the chines, m), beta (deadrise, rad), len (bottom length, m), vol (closed volume, m^3), depthMax,
//      side (lateral area per m of draft, m) }. d: the keel's depth at the transom below the local surface (m), tau:
// trim of the bottom to the water (rad, + bow up), V: speed along the pod (m/s), Vs: the cross flow (m/s). Returns
// the bottom's normal (lift) force, its drag along the flow and the side force, with the centre of pressure's distance
// ahead of the transom (m).
export function planeCoef(P, d, tau, V, Vs, out, trim = tau) {
  out.L = 0; out.D = 0; out.S = 0; out.xcp = 0; out.lam = 0; out.wet = 0; out.Cv = 0; out.buoy = 0; out.dyn = 0; out.Ddyn = 0; out.Df = 0;
  if (d <= 0) return out;
  const b = P.b, beta = P.beta ?? 0, Va = Math.abs(V);
  // wetted lengths from the bottom's geometric trim to the surface (trim): the keel's to where it leaves the surface,
  // the chines' shorter by the wave rise (Savitsky's b tan(beta) / (pi tan(tau))). A sled's bow sweeps up (rocker):
  // where the keel's wetted length runs past the flat run (the after 3/4 of the bottom) onto the curve, that part meets
  // the water at the trim plus its share of the rocker. The lift's angle is the flow's (tau: the trim and the pod's
  // own vertical motion), so a pod dropping in meets the water harder: the planing surface's heave damping.
  const tg = clamp(trim, 0.5 * DEG, 20 * DEG), Lrun = 0.75 * P.len;
  const Lg = d / Math.sin(tg);
  const fb = clamp((Lg - Lrun) / (P.len - Lrun), 0, 1);
  const Lk = Math.min(P.len, Lg);
  // (the curve's angle rises from 0 at the run's end to the rocker at the bow: the wetted part of it meets the water at
  // half its immersed share of the rocker on average, weighted twice for the pressure peak at the forward spray root)
  const tauA = clamp(tau + (P.rocker ?? 0) * fb * Math.max(0, Lk - Lrun) / Lk, 0.5 * DEG, 25 * DEG);
  const Lc = clamp(Lk - b * Math.tan(beta) / (Math.PI * Math.tan(tg)), 0, Lk);
  const lam = clamp((Lk + Lc) / (2 * b), 0.05, P.len / b);
  const Cv = Va / Math.sqrt(G * b);
  // the immersed volume: the bottom's V section (deadrise beta, then the sides) under the water along the pod, the
  // depth falling off toward the bow with the trim (six stations), up to the pod's depth (depthMax)
  const hV = 0.5 * b * Math.tan(beta), Dm = P.depthMax ?? 1;
  const Asec = (z) => { z = Math.min(z, Dm); return z <= 0 ? 0 : z <= hV ? z * z / Math.max(1e-3, Math.tan(beta)) : hV * b / 2 + b * (z - hV); };
  let vol = 0, mx = 0;
  for (let i = 0; i < 6; i++) { const x = (i + 0.5) / 6 * P.len, a = Asec(d - x * Math.sin(tau)) * P.len / 6; vol += a; mx += a * x; }
  const wl = lam * b, xB = vol > 0 ? mx / vol : 0;
  const buoy = RHO_W * G * vol;
  const tauD = tauA / DEG;
  const CL0 = Math.pow(tauD, 1.1) * 0.012 * Math.sqrt(lam);
  const CLb = Math.max(0, CL0 - 0.0065 * (beta / DEG) * Math.pow(CL0, 0.6));
  const q = 0.5 * RHO_W * Va * Va;
  const dyn = q * b * b * CLb * sstep(0.5, 1.5, Cv);
  // the transom runs dry from Cv ~2: the after body's hydrostatic pressure is lost (Savitsky's hydrostatic term is
  // about half the static buoyancy there)
  const hs = buoy * lerp(1, 0.5, sstep(1, 3, Cv));
  const L = dyn + hs;
  const wet = wl * b / Math.cos(beta);
  const Re = Math.max(1e5, Va * wl / NU_W), cf = 0.075 / (Math.log10(Re) - 2) ** 2 + 0.0004;
  const Df = q * wet * cf;
  // slow, a floating box: its form drag (Cd ~0.3 on its immersed section) until it planes
  const Dform = q * b * Math.min(d, b) * 0.3 * (1 - sstep(1, 2.5, Cv));
  out.hs = hs; out.L = L; out.D = dyn * Math.tan(tauA) + Df + Dform; out.Ddyn = dyn * Math.tan(tauA); out.Df = Df;
  // cross flow: the immersed side and the chine's edge (Cd ~1)
  out.S = -0.5 * RHO_W * Vs * Math.abs(Vs) * wl * Math.min(d, P.side ?? 0.3) * 1.0;
  // centre of pressure (Savitsky: dynamic 0.75 - 1 / (5.21 Cv^2 / lam^2 + 2.39) of the mean wetted length ahead of
  // the transom; the buoyancy at a third of it)
  const xd = lam * b * (0.75 - 1 / (5.21 * Cv * Cv / (lam * lam) + 2.39));
  out.xcp = L > 0 ? (dyn * Math.max(0, xd) + hs * xB) / L : 0;
  out.lam = lam; out.wet = wet; out.Cv = Cv; out.buoy = buoy; out.dyn = dyn; out.Lk = Lk;
  return out;
}
