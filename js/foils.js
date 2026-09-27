// Appendages as real foils: keel, daggerboard / centreboard and rudder blades.
//
//  * Section: NACA 00xx (thickness t/c per class). 2-D lift slope 0.95 x 2 pi; profile drag 2 Cf (1 + 2 t/c + 60 (t/c)^4)
//    (Hoerner's form factor) with Cf half way between the fully turbulent ITTC-57 line and Prandtl-Schlichting's
//    transitional one (a boat's foils are faired, but not polished: some laminar run); maximum lift from the
//    NACA 0012 tests against Reynolds number (Sheldahl & Klimas 1981; Abbott & von Doenhoff), scaled for thickness.
//  * Span: Helmbold's lift slope a = a0 / (sqrt(1 + (a0/pi AR)^2) + a0/pi AR) on the effective aspect ratio. The hull
//    over a keel or board root is an end plate (its image doubles the span: AR_e = AR (1 + 0.9)); a blade whose root
//    is at the free surface (a transom-hung rudder) gets the rigid-wall image at low speed and none at high speed
//    (the free surface then acts as a free tip), blended on the chord Froude number V/sqrt(g c) from 1 to 3; a bulb
//    is a partial tip plate (+15%). The immersed span comes from where the root and tip actually are in the local sea
//    (heel, heave, pitch and the wave at that station).
//  * Stall with hysteresis: CLmax_3D = 0.9 CLmax_2D(Re); stall angle CLmax/a (capped at 32 deg for the low-aspect
//    long keel); once separated the flow reattaches only below 0.8 of it; the separated fraction relaxes over three
//    chord lengths of travel (a little dynamic stall). Past the stall: a flat plate with no suction (Viterna-Corrigan).
//  * Ventilation: air drawn down the suction side from the surface. A blade whose root is at or near the surface
//    ventilates when its angle passes the inception angle (about 11-20 deg for a surface-piercing blade, falling with
//    chord Froude number, hardly at all below Fn_c ~ 1; much higher with the root a chord or more deep) and stays
//    ventilated until the angle falls below 40% of it (washout: the strong hysteresis of ventilated struts, Harwood et
//    al. 2016). Ventilated, the
//    suction side is at atmospheric pressure: the lift of a Kirchhoff free-streamline plate, 2 pi sin a / (4 + pi sin a).
//  * Cavitation: the suction peak -Cp_min ~ 0.41 (t/c / 0.12) + 1.3 |cl| + 2.9 cl^2 sqrt(0.12 / t/c) (fitted to NACA
//    0012 pressure data) against the cavitation number sigma = (p_atm + rho g h - p_v) / (q); past it the lift
//    saturates and the drag grows.
//  * Centre of pressure: quarter chord attached, moving to 0.42 c separated, ventilated or cavitating (the rudder's
//    stock torque, js/helm.js, comes from it). A pivoting centreboard swings aft as it is raised (area, span and its
//    centre move); a daggerboard slides up (span and centre height); a kick-up blade swings aft on grounding.
import { G } from './env.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;
export const RHO_W = 1025, NU_W = 1.19e-6, P_ATM = 101325, P_VAP = 2340;

// NACA 0012 CLmax against Reynolds number (log10 Re), smooth-ish model section
const CLMAX_RE = [[4.7, 0.72], [5.0, 0.82], [5.2, 0.95], [5.5, 1.08], [5.85, 1.2], [6.0, 1.3], [6.3, 1.42], [6.5, 1.5], [6.8, 1.58], [7.0, 1.62]];
export function clMax2D(Re, tc = 0.12) {
  const x = Math.log10(Math.max(1e4, Re));
  let c = CLMAX_RE[CLMAX_RE.length - 1][1];
  if (x <= CLMAX_RE[0][0]) c = CLMAX_RE[0][1];
  else for (let i = 1; i < CLMAX_RE.length; i++) if (x <= CLMAX_RE[i][0]) { const [x0, y0] = CLMAX_RE[i - 1], [x1, y1] = CLMAX_RE[i]; c = lerp(y0, y1, (x - x0) / (x1 - x0)); break; }
  // thinner sections stall at the leading edge sooner (0009 ~ 0.85 of 0012), thicker ones a little later up to 15%
  return c * clamp(1 - 2.2 * (0.12 - tc) - 3 * Math.max(0, tc - 0.15), 0.7, 1.05);
}
export function cfFoil(Re) {
  Re = Math.max(2e4, Re);
  const ittc = 0.075 / (Math.log10(Re) - 2) ** 2, ps = Math.max(1.328 / Math.sqrt(Re), 0.074 / Re ** 0.2 - 1700 / Re);
  return 0.5 * (ittc + ps);
}
export const cd0Section = (Re, tc) => 2 * cfFoil(Re) * (1 + 2 * tc + 60 * tc ** 4);
// Helmbold (low-aspect lifting surface) with the section's own slope a0
export const helmbold = (ARe, a0 = 0.95 * 2 * Math.PI) => { const k = a0 / (Math.PI * ARe); return a0 / (Math.sqrt(1 + k * k) + k); };
// suction peak of a symmetric section at lift cl
export const cpMin = (cl, tc) => 0.41 * (tc / 0.12) + 1.3 * Math.abs(cl) + 2.9 * cl * cl * Math.sqrt(0.12 / tc);
// the |cl| at which the suction peak reaches the cavitation number
function clCav(sigma, tc) {
  const a = 2.9 * Math.sqrt(0.12 / tc), b = 1.3, c = 0.41 * (tc / 0.12) - sigma;
  if (c >= 0) return 0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

// per-class foil data the CLASSES entries do not carry (section, balance, kick-up, bulb, board type); a class without
// an entry gets defaults from its CLASSES geometry. (sources in the comments; 'est.' = estimated from photos/drawings)
export const FOIL_DATA = {
  // J/70: cast-iron fin under a lead torpedo bulb (ballast 285 kg, J/Boats), NACA 00-series fin ~10%; transom-hung
  // high-aspect moulded blade on gudgeons, its axis just behind the leading edge (est.)
  sportboat: { keel: { tc: 0.1, root: 'hull', bulb: { len: 1.3, dia: 0.26 } }, rudder: { tc: 0.12, root: 'surface', balance: 0.02 } },
  // Laser/ILCA: parallel daggerboard ~9%, slides in its trunk; kick-up blade in the aluminium stock, raked forward
  // when down so its axis sits ~12% behind the leading edge (est. from the class drawings)
  dinghy: { keel: { tc: 0.09, root: 'hull', board: 'dagger' }, rudder: { tc: 0.1, root: 'surface', balance: 0.12, kickUp: true } },
  // Hobie 16: no boards (the 'keel' stands for the asymmetric hulls' lift: no section to ventilate); cast kick-up
  // rudder heads whose cams release on impact, blades ~11% with ~14% balance set by the rake adjustment (est.)
  cat: { keel: { tc: 0.2, root: 'hull', hullProxy: true }, rudder: { tc: 0.11, root: 'surface', balance: 0.14, kickUp: true } },
  // Blackwatch 19: full keel with a barn-door rudder hung on its trailing edge and the transom: unbalanced (axis on
  // the pintles at the leading edge); the long keel is a very low aspect ratio foil, thick (~18%)
  blackwatch: { keel: { tc: 0.18, root: 'hull' }, rudder: { tc: 0.1, root: 'surface', balance: 0.0 } },
};

// resolved foil spec: the class foil (C.keel / C.rudder) with its section data and defaults
export function foilSpec(C, which) {
  const F = which === 'keel' ? C.keel : C.rudder;
  const D = { ...((FOIL_DATA[C.id] || {})[which] || {}), ...(F.foil || {}) };
  const chord = F.chord ?? Math.sqrt(F.area / Math.max(0.5, F.ARe || 3)), span = F.span ?? F.area / chord;
  const spade = which === 'rudder' && !F.transom && !F.hung && !F.twin && !D.root;
  return {
    F, which, chord, span, area: F.area,
    tc: D.tc ?? (which === 'keel' ? 0.12 : 0.12),
    // what caps the root: 'hull' (an end plate), 'surface' (a transom-hung blade whose head is at the water)
    root: D.root ?? (which === 'keel' || spade ? 'hull' : 'surface'),
    endPlate: D.endPlate ?? (F.long ? 0.3 : 0.9),        // (a long keel is its own hull: its image counts little)
    tipPlate: D.bulb ? 0.15 : 0,
    bulb: D.bulb || null,
    board: D.board ?? (F.board ? 'dagger' : null),
    pivot: D.pivot || null,                               // pivoting centreboard: { x, z } of the pin
    balance: D.balance ?? (spade ? 0.2 : 0.02),           // stock axis aft of the leading edge / chord
    kickUp: !!D.kickUp,
    hullProxy: !!D.hullProxy || (!!F.twin && which === 'keel' && !F.board),
    // a long keel is the hull's own lateral plane: its effective aspect ratio is the class's (hull and keel together)
    fixedARe: F.long ? F.ARe : null,
    // the class's hand-set stall angle is kept as a floor for very low aspect ratios (a long keel)
    stall0: F.stall ?? 15 * DEG,
  };
}

export function foilState() { return { sep: 0, stalled: false, vent: 0, ventOn: false, cav: 0, kick: 0, kickT: 0, xcp: 0.25 }; }

// Depth below the local surface of a point (y, z) of the hull's body frame at station x (m, + = under water).
// zw: the water level in body z at x (hull.js convention: eta - heave - x pitch), phi heel
export const depthAt = (zw, y, z, cphi, sphi) => zw - (-y * sphi + z * cphi);

// Geometry of a foil this step: immersed span and area, effective aspect ratio, centre (x, z) of its lift and the
// root depth (for ventilation) and depth of its centre (for cavitation). boardDown 0..1; kick 0..1 (kicked-up blade).
// zw(x): water level in body z; y: lateral offset of the foil (twin hulls).
export function foilGeom(S, boardDown, kick, zw, cphi, sphi, y, V, out) {
  const F = S.F;
  let span = S.span, x = F.x, zMid = F.z, sweepCos = 1;
  // root and tip of the full blade (F.z: the middle of the span as the class gives it)
  let zRoot = F.z + span / 2;
  if (S.board === 'dagger') { span = S.span * clamp(boardDown, 0.02, 1); zMid = zRoot - span / 2; }
  else if (S.board === 'pivot' && S.pivot) {
    // a centreboard swings aft about its pin as it is raised (90 deg = fully up)
    const psi = (1 - clamp(boardDown, 0, 1)) * 85 * DEG;
    sweepCos = Math.cos(psi);
    span = S.span * Math.max(0.05, sweepCos);
    zMid = S.pivot.z - 0.5 * S.span * sweepCos; x = S.pivot.x - 0.5 * S.span * Math.sin(psi); zRoot = S.pivot.z;
  }
  if (kick > 0) {
    // kicked up: the blade swings aft about its head
    const psi = kick * 75 * DEG;
    sweepCos = Math.cos(psi); x -= 0.5 * span * Math.sin(psi); span *= Math.max(0.05, sweepCos);
    zMid = zRoot - span / 2;
  }
  const zTip = zRoot - span;
  const w = zw(x);
  const dRoot = depthAt(w, y, zRoot, cphi, sphi), dTip = depthAt(w, y, zTip, cphi, sphi);
  // immersed fraction of the span (depth is linear along it)
  let imm = 1;
  if (dTip <= 0) imm = 0;
  else if (dRoot < 0) imm = dTip / (dTip - dRoot);
  const spanW = span * imm;
  const ARg = spanW / S.chord;
  // end plate at the root: the hull (while the root is under it), or the free surface (rigid wall at low chord
  // Froude number, free tip at high)
  const Fnc = Math.abs(V) / Math.sqrt(G * S.chord);
  let ep;
  if (S.root === 'hull' && dRoot > -0.02) ep = S.endPlate * clamp(Math.abs(cphi) * 1.2, 0, 1);
  else ep = 1 - sstep(1, 3, Fnc);
  if (S.root === 'hull' && dRoot <= -0.02) ep = Math.min(ep, S.endPlate);
  const ARe = S.fixedARe ? S.fixedARe * Math.max(0.05, imm) : Math.max(0.05, ARg * (1 + ep + S.tipPlate)) * sweepCos;
  out.imm = imm; out.span = spanW; out.area = S.chord * spanW; out.ARe = ARe; out.ARg = ARg;
  out.x = x; out.dRoot = dRoot; out.dTip = dTip; out.Fnc = Fnc; out.sweepCos = sweepCos;
  // centre of lift: a little below mid-immersed-span (elliptic loading with the image at the root)
  const zTop = imm < 1 ? zTip + spanW : zRoot;
  out.z = zTop - spanW * (0.5 - 0.06 * ep);
  out.dMid = Math.max(0.01, dTip - (dTip - Math.max(0, dRoot)) * 0.5);
  out.sweep = Math.acos(clamp(sweepCos, -1, 1));
  return out;
}

// Coefficients (on the immersed area) at signed angle of attack alpha, water speed V, over dt. Updates the state.
export function foilCoef(S, st, alpha, V, g, dt, out) {
  let a = Math.abs(alpha), s = Math.sign(alpha) || 1;
  if (a > Math.PI / 2) { a = Math.PI - a; s = -s; }
  const Va = Math.max(0.05, Math.abs(V));
  const Re = Va * S.chord / NU_W;
  const ARe = g.ARe;
  const a0 = 0.95 * 2 * Math.PI * (Re < 2e5 ? 0.9 + 0.1 * Re / 2e5 : 1);
  const slope = helmbold(ARe, a0);
  const clMax = 0.9 * clMax2D(Re, S.tc) * g.sweepCos;
  // low-aspect wings stall later than the linear slope says (tip vortex lift): the class's own figure is the floor
  const ast = clamp(Math.max(clMax / slope, ARe < 2 ? S.stall0 : 0), 6 * DEG, 32 * DEG);
  // stall with hysteresis: separation begins past ast; separated, reattaches below 0.8 ast
  if (!st.stalled && a > ast) st.stalled = true;
  else if (st.stalled && a < 0.8 * ast) st.stalled = false;
  const sepT = st.stalled ? sstep(0.8 * ast, 0.88 * ast, a) : sstep(ast, ast + 6 * DEG, a);
  const k = clamp(dt * Va / (3 * S.chord), 0, 1);
  st.sep += (sepT - st.sep) * k;
  // attached branch (the lift rounds off toward CLmax over the last few degrees)
  let clA = slope * a;
  if (a > 0.85 * ast) clA = slope * 0.85 * ast + (clMax - slope * 0.85 * ast) * Math.sin(Math.min(1, (a - 0.85 * ast) / (0.15 * ast)) * Math.PI / 2);
  const cd0 = cd0Section(Re, S.tc);
  let cdA = cd0 + clA * clA / (Math.PI * ARe * 0.9);
  // separated branch: a flat plate with no leading-edge suction (Viterna-Corrigan, CDmax = 1.11 + 0.018 AR)
  const cdMax = 1.11 + 0.018 * ARe;
  const clS = Math.max(cdMax * Math.sin(a) * Math.cos(a), clMax * (1 - 0.4 * Math.min(1, (a - ast) / 0.12)) * (a < ast + 0.3 ? 1 - (a - ast) / 0.3 : 0));
  const cdS = cd0 + cdMax * Math.sin(a) ** 2;
  let cl = lerp(clA, clS, st.sep), cd = lerp(cdA, cdS, st.sep);
  // ventilation: only for a blade with a root near the surface (a hull's lift proxy has none)
  let vT = 0;
  if (!S.hullProxy && g.imm > 0) {
    const h = g.dRoot / S.chord;                          // root depth in chords (< 0: the blade pierces the surface)
    // (slow, gravity holds the surface down: below a chord Froude number of ~1 a blade hardly ventilates at all)
    const aVi = lerp(20, 11, sstep(1, 4, g.Fnc)) * (h <= 0 ? 1 : 1 + 2.5 * Math.min(2, h)) * (1 + 3 * (1 - sstep(0.8, 1.6, g.Fnc))) * DEG;
    // (a root under a hull is sealed by it: air has no path down while the hull bottom is in the water)
    const sealed = S.root === 'hull' && g.dRoot > 0.03;
    if (!sealed && Va > 1) {
      if (!st.ventOn && a > aVi) st.ventOn = true;
      else if (st.ventOn && (a < 0.4 * aVi || h > 1.5)) st.ventOn = false;
    } else st.ventOn = false;
    vT = st.ventOn ? (h <= 0 ? 1 : clamp(1 - h / 1.5, 0, 1) * 0.8) : 0;
  } else st.ventOn = false;
  // air is drawn in fast (a few chord lengths), and washes out slower
  const kv = clamp(dt * Va / (vT > st.vent ? 2 * S.chord : 8 * S.chord), 0, 1);
  st.vent += (vT - st.vent) * kv;
  if (st.vent > 1e-3) {
    const sa = Math.sin(a), clV = 2 * Math.PI * sa * Math.cos(a) / (4 + Math.PI * sa) * (slope / a0);
    cl = lerp(cl, Math.min(cl, clV), st.vent);
    cd = lerp(cd, cd0 + clV * Math.tan(Math.min(a, 1.4)) + 0.1 * sa * sa + 0.02, st.vent);
  }
  // cavitation: past sigma the suction side boils: the lift saturates, the drag grows
  const q = 0.5 * RHO_W * Va * Va;
  const sigma = (P_ATM + RHO_W * G * Math.max(0, g.dMid) - P_VAP) / q;
  const cc = clCav(sigma, S.tc);
  st.cav = 0;
  if (cl > cc) {
    const ex = cl - cc;
    st.cav = clamp(ex / Math.max(0.05, cl), 0, 1);
    cl = cc + 0.25 * ex; cd += 0.15 * ex;
  }
  out.sigma = sigma; out.cpMin = cpMin(cl, S.tc);
  out.cl = cl * s; out.cd = cd; out.stalled = st.sep > 0.5; out.slope = slope; out.ast = ast; out.clMax = clMax;
  out.vent = st.vent; out.cav = st.cav; out.Re = Re; out.cd0 = cd0;
  // centre of pressure along the chord (from the leading edge), and the normal-force coefficient
  const xcp = 0.25 + 0.17 * Math.max(st.sep, st.vent, st.cav);
  st.xcp = xcp; out.xcp = xcp;
  out.cn = (cl * Math.cos(a) + cd * Math.sin(a)) * s;
  return out;
}

// keel bulb: a body of revolution's friction and form drag (Hoerner: Cf (1 + 1.5 (d/l)^1.5 + 7 (d/l)^3) on its
// wetted area, ~0.75 pi d l for a torpedo)
export function bulbDrag(b, V) {
  const Re = Math.max(1e5, Math.abs(V) * b.len / NU_W), cf = 0.075 / (Math.log10(Re) - 2) ** 2, dl = b.dia / b.len;
  return 0.5 * RHO_W * V * Math.abs(V) * 0.75 * Math.PI * b.dia * b.len * cf * (1 + 1.5 * dl ** 1.5 + 7 * dl ** 3);
}

// kick-up blade: pushed up by the bottom (depth: water depth under it), relatched by the crew after a while in deep
// water. tipZ: body z of the blade's tip when down.
export function kickUpdate(S, st, depth, tipDepth, dt) {
  if (!S.kickUp) { st.kick = 0; return 0; }
  if (depth < tipDepth) {
    // the bottom pushes the blade up to where its tip just clears
    const need = clamp(Math.acos(clamp(depth / Math.max(0.05, tipDepth), 0, 1)) / (75 * DEG), 0, 1);
    st.kick = Math.max(st.kick, need); st.kickT = 0;
  } else if (st.kick > 0) {
    st.kickT += dt;
    if (st.kickT > 4 && depth > tipDepth + 0.3) st.kick = Math.max(0, st.kick - dt);     // the crew pushes it down again
  }
  return st.kick;
}
