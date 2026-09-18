// Sailing-yacht dynamics: 4 DOF rigid body (surge, sway, roll, yaw) + heave/pitch response,
// with a full running-rigging model that sets each sail's shape.
//
// Body frame follows SNAME: x forward, y starboard (heights are stored +up for readability).
// Heel phi > 0 = starboard rail down. Yaw rate r > 0 = bow swinging to starboard.
//
// Per time step:
//  * RIG -> SHAPE. Every sail is three horizontal strips. The controls that exist on the real boat
//    (mainsheet, traveler, vang, cunningham, outhaul, backstay, jib lead, jib halyard, gennaker tack
//    line, reefs) set each strip's camber depth, draft position and twist. Load matters too:
//    cloth stretch deepens the sail and pulls the draft aft, headstay sag deepens the jib,
//    and mast bend (backstay / vang / mainsheet) flattens the upper main and opens its leech.
//  * SHAPE -> FORCE. Each strip sees its own apparent wind (log-profile true wind at its height minus
//    the local velocity from surge, sway, yaw, roll and boom swing), projected into the heeled rig
//    plane. Its lift/drag follow from the shape: depth sets max lift and stall angle, draft position
//    and depth set the luffing angle (pointing), draft aft adds separation drag. The headsail's
//    downwash reduces the main's angle of attack (overtrimmed jib = backwinded main); the main's
//    upwash lifts the headsail.
//  * Booms (main, self-tacking staysail) are rotating bodies stopped by their sheet: gybes,
//    backwinding and crash-gybes emerge. Loose headsails flop across the bow with crew lag.
//  * Sheets are trimmed at a rate limited by load vs crew/winch power; the rudder slews at a
//    rate limited by its hydrodynamic load.
//  * Keel/board and rudder are finite wings (Helmbold slope, stall, induced drag) seeing
//    water-relative velocity incl. wave orbital motion, yaw, roll and keel downwash.
//  * Hull: ITTC-57 friction + tabulated residuary resistance (heel, fore-aft trim), cross-flow
//    drag, yaw damping, heeled-hull asymmetry, added resistance in waves. Grounding on real depth.
//  * Stability: GZ curve (weight + form), crew moment incl. crew height, roll damping.
//  * Waves: Froude-Krylov slope forces (surfing), roll/yaw forcing.

import { G, DEG, KT } from './env.js';
import { HullHydro } from './hull.js';

export const RHO_A = 1.225, RHO_W = 1025, NU_W = 1.19e-6;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1] * (x / Math.max(table[0][0], 1e-9)) ** 2;
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  const n = table.length - 1;
  const [xa, ya] = table[n - 1], [xb, yb] = table[n];
  return yb + (yb - ya) / (xb - xa) * (x - xb);
}
export const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ---------------------------------------------------------------------------------------------
// Boat classes. Geometry in metres from the centre of gravity (x fwd), heights above waterline.
// Sail kinds: 'boom' (main, self-tacking staysail), 'loose' (jib), 'spin' (asymmetric gennaker).
export const CLASSES = {
  blackwatch: {
    id: 'blackwatch', name: 'Blackwatch 19/24',
    blurb: "Dave Autry's 1979 pocket bluewater cutter from Blue Water Boatworks. Long keel, transom-hung rudder, teak bowsprit, self-tacking staysail, flying jib, double-reefed main. Heavy, stiff, forgiving — and it will not go faster than its 5.6 kn hull speed.",
    specs: 'LOA 5.64 m (≈7.2 m incl. bowsprit) · LWL 5.33 m · Beam 2.29 m · Draft 0.61 m · 1,021 kg · 363 kg iron ballast · Sail area 19.7 m²',
    lwl: 5.33, loa: 5.64, beam: 2.29, bowX: 2.85, sternX: -2.79, freeboard: 0.78, canoeDraft: 0.42, wetted: 11.6, draft: 0.61,
    bowsprit: 1.45, cabin: true, longKeel: true,
    massHull: 1021, zG: -0.08, crewN: 2, crewEach: 80, crewZ: 0.8, crewMaxOut: 0.92, crewLee: -0.5, hikeRate: 0.5,
    gm: 0.92, bmForm: 0.62, Ixx: 1150, Izz: 2250, amX: 0.07, amY: 0.9, amYaw: 0.6, amRoll: 0.3,
    rr: [[0.1, 0.0002], [0.15, 0.0006], [0.2, 0.0016], [0.25, 0.0035], [0.3, 0.0072], [0.35, 0.0145], [0.4, 0.031],
         [0.45, 0.058], [0.5, 0.085], [0.55, 0.101], [0.6, 0.11], [0.7, 0.12], [0.8, 0.125], [1.0, 0.13], [1.5, 0.14]],
    keel: { x: 0.75, z: -0.3, area: 1.7, ARe: 0.95, stall: 26 * DEG, cd0: 0.013, span: 0.35, chord: 3.6, long: true },
    rudder: { x: -2.78, z: -0.28, area: 0.34, ARe: 2.4, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 0.75, chord: 0.5, transom: true, loadRef: 900 },
    hullLat: { area: 0.9, cd: 0.9, z: -0.1 },
    windage: { area: 3.1, z: 2.1, cd: 0.95 },
    mastX: 0.25, mastHeight: 8.4, boomZ: 1.4, keelBulb: false,
    targetHeel: 18 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 900,
    sails: [
      { key: 'main', kind: 'boom', area: 10.4, luff: 6.5, foot: 3.0, head: 0.15, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
        cd0: 0.07, ARe: 3.2, min: 2 * DEG, max: 80 * DEG, trav: [-4 * DEG, 12 * DEG], Iboom: 42, boomMass: 18, reefs: 2,
        vangBend: 0.08, sheetBend: 0.05, color: 0x9c4f2e },
      { key: 'stay', kind: 'boom', selfTacking: true, area: 4.2, tackX: 2.55, tackZ: 0.95, luff: 5.2, foot: 1.75, head: 0.05, rake: 0.55,
        depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.2, min: 5 * DEG, max: 55 * DEG, Iboom: 6, boomMass: 5, color: 0x9c4f2e },
      { key: 'jib', kind: 'loose', area: 5.1, tackX: 4.2, tackZ: 1.05, luff: 7.0, foot: 2.05, head: 0.05, rake: 1.0,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 12 * DEG, max: 55 * DEG, sagK: 1.6, color: 0x9c4f2e },
    ],
    hull: { color: 0x15171b, stripe: 0xb8902f, deck: 0xcdbf9f, boot: 0x7a1f1f, sectionN: 1.8, transom: 0.62, bowRake: 0.35, sheer: 0.18 },
  },
  sportboat: {
    id: 'sportboat', name: 'Sportboat 23',
    blurb: '7 m one-design sportboat, 4 crew, carbon mast, asymmetric gennaker on a retractable bowsprit. Planes downwind from about 13 kn of wind.',
    specs: 'LOA 6.93 m · LWL 6.10 m · Beam 2.25 m · Draft 1.45 m · 794 kg · Main 16.7 m² · Jib 9.1 m² · Gennaker 39.5 m²',
    lwl: 6.1, loa: 6.93, beam: 2.25, bowX: 3.55, sternX: -3.38, freeboard: 0.72, canoeDraft: 0.28, wetted: 10.2, draft: 1.45,
    bowsprit: 1.0,
    massHull: 794, zG: -0.22, crewN: 4, crewEach: 80, crewZ: 0.6, crewMaxOut: 1.05, crewLee: -0.55, hikeRate: 0.55,
    gm: 1.05, bmForm: 0.65, Ixx: 1400, Izz: 3600, amX: 0.06, amY: 0.7, amYaw: 0.4, amRoll: 0.25,
    rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0009], [0.25, 0.0018], [0.3, 0.0035], [0.35, 0.0065], [0.4, 0.013],
         [0.45, 0.025], [0.5, 0.037], [0.55, 0.045], [0.6, 0.049], [0.7, 0.051], [0.8, 0.05], [1.0, 0.048], [1.2, 0.049], [1.5, 0.055]],
    keel: { x: 0.33, z: -0.85, area: 0.58, ARe: 5.0, stall: 14 * DEG, cd0: 0.009, span: 1.17, chord: 0.5 },
    rudder: { x: -3.05, z: -0.45, area: 0.23, ARe: 3.6, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.95, chord: 0.26, loadRef: 700 },
    hullLat: { area: 1.5, cd: 0.9, z: -0.1 },
    windage: { area: 2.8, z: 2.4, cd: 0.9 },
    mastX: 0.62, mastHeight: 10.2, boomZ: 1.55, keelBulb: true,
    targetHeel: 17 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1400,
    sails: [
      { key: 'main', kind: 'boom', area: 16.7, luff: 8.3, foot: 2.95, head: 0.75, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 4.8, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 38, boomMass: 14, reefs: 0,
        vangBend: 0.15, sheetBend: 0.1, color: 0xf2f0ea },
      { key: 'jib', kind: 'loose', area: 9.1, tackX: 3.3, tackZ: 0.8, luff: 7.2, foot: 2.35, head: 0.08, rake: 0.32,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.2, min: 8.5 * DEG, max: 42 * DEG, sagK: 1.0, color: 0xf2f0ea },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 39.5, tackX: 4.55, tackZ: 0.85, luff: 9.0, foot: 4.3, head: 0.5, rake: 0.55,
        depth: [0.19, 0.21, 0.19], cd0: 0.09, ARe: 2.2, min: 16 * DEG, max: 100 * DEG, color: 0xd9412b },
    ],
    hull: { color: 0xf3f4f1, stripe: 0x1d4e89, deck: 0xdcd8cc, boot: 0x1d4e89, sectionN: 2.6, transom: 0.78, bowRake: 0.25, sheer: 0.08 },
  },
  dinghy: {
    id: 'dinghy', name: 'Singlehander 14',
    blurb: '4.2 m una-rig Olympic-style dinghy. One sailor, unstayed bendy mast, daggerboard, vang-sheeting. Capsizes if you let it.',
    specs: 'LOA 4.23 m · LWL 3.81 m · Beam 1.37 m · Hull 59 kg · Sail 7.06 m²',
    lwl: 3.81, loa: 4.23, beam: 1.37, bowX: 2.2, sternX: -2.03, freeboard: 0.38, canoeDraft: 0.16, wetted: 3.3, draft: 0.9,
    massHull: 59, zG: 0.12, crewN: 1, crewEach: 80, crewZ: 0.38, crewMaxOut: 1.08, crewLee: -0.3, hikeRate: 1.9,
    gm: 0.36, bmForm: 0.56, Ixx: 110, Izz: 190, amX: 0.05, amY: 0.5, amYaw: 0.4, amRoll: 0.2,
    rr: [[0.1, 0.0001], [0.15, 0.0005], [0.2, 0.0012], [0.25, 0.0027], [0.3, 0.0055], [0.35, 0.011], [0.4, 0.021],
         [0.45, 0.035], [0.5, 0.048], [0.55, 0.055], [0.6, 0.057], [0.7, 0.055], [0.8, 0.052], [1.0, 0.049], [1.2, 0.05], [1.5, 0.056]],
    keel: { x: 0.5, z: -0.55, area: 0.29, ARe: 5.0, stall: 13 * DEG, cd0: 0.01, span: 0.82, chord: 0.36, board: true },
    rudder: { x: -2.08, z: -0.35, area: 0.12, ARe: 3.8, stall: 15 * DEG, cd0: 0.011, max: 35 * DEG, span: 0.62, chord: 0.2, loadRef: 260 },
    hullLat: { area: 0.5, cd: 0.9, z: -0.05 },
    windage: { area: 0.75, z: 1.0, cd: 1.0 },
    mastX: 1.15, mastHeight: 6.1, boomZ: 0.78, keelBulb: false,
    targetHeel: 6 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 420,
    sails: [
      { key: 'main', kind: 'boom', area: 7.06, luff: 5.1, foot: 2.75, head: 0.25, depth: [0.12, 0.14, 0.12], twistMax: 24 * DEG,
        cd0: 0.06, ARe: 3.9, min: 3 * DEG, max: 88 * DEG, trav: null, Iboom: 12, boomMass: 6, reefs: 0,
        vangBend: 0.6, sheetBend: 0.45, color: 0xf4f3ee },
    ],
    hull: { color: 0xf6f6f2, stripe: 0xc8412c, deck: 0xe6e3da, boot: 0xc8412c, sectionN: 2.2, transom: 0.72, bowRake: 0.15, sheer: 0.05 },
  },
  cat: {
    id: 'cat', name: 'Beach Cat 16',
    blurb: '16 ft beach catamaran: twin slender hulls, trampoline, two daggerboards and two rudders, both crew on trapeze. Flies a hull from about 10 kn, and pitchpoles if you bury the bows.',
    specs: 'LOA 5.04 m · Beam 2.41 m · Hull 160 kg · Main 13.7 m² (full battens) · Jib 5.2 m² · Spinnaker 17.5 m²',
    multihull: true, hullBeam: 0.42, hullSpacing: 2.0, noWinches: true, trapeze: true,
    lwl: 4.9, loa: 5.04, beam: 2.41, bowX: 2.52, sternX: -2.52, freeboard: 0.45, canoeDraft: 0.22, wetted: 4.8, draft: 0.85,
    bowsprit: 0.9,
    massHull: 160, zG: 0.42, crewN: 2, crewEach: 72, crewZ: 0.5, crewMaxOut: 2.0, crewLee: -0.4, hikeRate: 1.0,
    gm: 3, bmForm: 1, Ixx: 560, Izz: 520, amX: 0.04, amY: 0.35, amYaw: 0.4, amRoll: 0.4,
    rr: [[0.1, 0.0004], [0.2, 0.002], [0.3, 0.0055], [0.35, 0.009], [0.4, 0.0135], [0.45, 0.018], [0.5, 0.021], [0.6, 0.0225], [0.7, 0.022], [0.8, 0.021], [1.0, 0.0195], [1.2, 0.019], [1.5, 0.02]],
    keel: { x: 0.35, z: -0.5, area: 0.36, ARe: 4.5, stall: 13 * DEG, cd0: 0.011, span: 0.75, chord: 0.26, board: true, twin: true },
    rudder: { x: -2.4, z: -0.3, area: 0.18, ARe: 3.5, stall: 16 * DEG, cd0: 0.012, max: 30 * DEG, span: 0.6, chord: 0.2, loadRef: 250, twin: true },
    hullLat: { area: 0.6, cd: 0.9, z: -0.08 },
    windage: { area: 2.1, z: 1.1, cd: 1.0 },
    mastX: 0.6, mastHeight: 8.9, boomZ: 1.25, keelBulb: false,
    targetHeel: 7 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 700,
    sails: [
      { key: 'main', kind: 'boom', area: 13.7, luff: 7.2, foot: 2.6, head: 1.1, depth: [0.1, 0.12, 0.11], twistMax: 15 * DEG,
        cd0: 0.06, ARe: 4.6, min: 1 * DEG, max: 75 * DEG, trav: [-4 * DEG, 24 * DEG], Iboom: 16, boomMass: 6, reefs: 0,
        vangBend: 0.2, sheetBend: 0.25, color: 0xf2f4f6 },
      { key: 'jib', kind: 'loose', area: 5.2, tackX: 2.3, tackZ: 0.55, luff: 6.2, foot: 1.7, head: 0.06, rake: 0.4,
        depth: [0.12, 0.13, 0.11], cd0: 0.04, ARe: 4.5, min: 9 * DEG, max: 40 * DEG, sagK: 0.8, color: 0xf2f4f6 },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 17.5, tackX: 3.35, tackZ: 0.5, luff: 7.4, foot: 3.3, head: 0.4, rake: 0.4,
        depth: [0.18, 0.2, 0.18], cd0: 0.08, ARe: 2.4, min: 14 * DEG, max: 95 * DEG, color: 0x1d4e89 },
    ],
    hull: { color: 0xf5f5f2, stripe: 0xd9412b, deck: 0xe8e8e4, boot: 0xd9412b, bootTop: 0xf5f5f2, sectionN: 2, transom: 0.35, bowRake: 0.05, sheer: 0.1 },
  },
};
export const CLASS_ORDER = ['blackwatch', 'sportboat', 'dinghy', 'cat'];

export const STRIP_F = [0.17, 0.5, 0.82];
const STRIP_W = [0.43, 0.34, 0.23];
export const REEF = [{ a: 1, l: 1 }, { a: 0.76, l: 0.84 }, { a: 0.56, l: 0.69 }];
// area / luff factors at a continuous reef position (reefing is a procedure, not a switch)
export function reefAt(pos) {
  const i = Math.max(0, Math.min(1, Math.floor(pos))), f = Math.max(0, Math.min(2, pos)) - i;
  return { a: lerp(REEF[i].a, REEF[Math.min(2, i + 1)].a, f), l: lerp(REEF[i].l, REEF[Math.min(2, i + 1)].l, f) };
}
// seconds for the crew to put in (or shake out) one reef
export function reefTime(C) { return C.id === 'blackwatch' ? 70 : 45; }

// ---------------------------------------------------------------------------------------------
// Section coefficients from sail shape. a = |alpha| (rad, 0..pi/2), d = camber depth / chord,
// f = draft position (0 = at luff .. 1 = at leech; ~0.4-0.5 typical).
export function shapeCoef(a, d, f, S, out) {
  const clMax = clamp(0.42 + 7.8 * d, 0.7, 1.95);
  const ast = (9 + 85 * d + 8 * (0.55 - f)) * DEG;                       // deep + draft forward stalls later
  const alf = (0.6 + 28 * d * (0.9 + 0.9 * (0.55 - f))) * DEG;            // deep + round entry luffs sooner
  let cl;
  if (a <= ast) cl = clMax * Math.sin(0.5 * Math.PI * a / ast);
  else {
    const t = sstep(ast, ast + 0.5, a);
    const decay = clMax * (1 - 0.3 * Math.min(1, (a - ast) / 0.4));
    cl = lerp(decay, 1.15 * Math.sin(2 * Math.min(a, Math.PI / 2)), t);
  }
  let flog = 0;
  if (a < alf) { const lf = (a / alf) ** 2; cl *= lf; flog = 1 - lf; }
  const sep = sstep(ast * 0.8, ast + 0.45, a);
  const cd = S.cd0 + 1.4 * (d - 0.1) ** 2 + 0.03 * clamp(f - 0.45, 0, 1) + cl * cl / (Math.PI * S.ARe)
           + 1.25 * Math.sin(a) ** 2 * sep + 0.08 * flog;
  out.cl = cl; out.cd = cd; out.flog = flog; out.alf = alf; out.ast = ast;
  out.state = a < alf * 1.25 ? 1 : a > ast * 1.08 ? 3 : 2; // 1 luffing, 2 attached, 3 stalled
  return out;
}

// Foil coefficients for signed alpha (any angle). Finite-wing lift slope (Helmbold).
function foilCoef(alpha, F, ARe, out) {
  let a = Math.abs(alpha), s = Math.sign(alpha) || 1;
  if (a > Math.PI / 2) { a = Math.PI - a; s = -s; }
  const slope = 2 * Math.PI / (2 / ARe + Math.sqrt(1 + (2 / ARe) ** 2));
  let cl;
  if (a <= F.stall) cl = slope * a;
  else {
    const clm = slope * F.stall;
    const t = sstep(F.stall, F.stall + 0.35, a);
    cl = lerp(clm * (1 - 0.4 * Math.min(1, (a - F.stall) / 0.12)), 1.1 * Math.sin(2 * a), t);
  }
  const sep = sstep(F.stall * 0.9, F.stall + 0.3, a);
  const cd = F.cd0 + cl * cl / (Math.PI * ARe * 0.9) + 1.2 * Math.sin(a) ** 2 * sep;
  out.cl = cl * s; out.cd = cd; out.stalled = a > F.stall;
  return out;
}

function cfITTC(u, L) {
  const Re = Math.max(1e5, Math.abs(u) * L / NU_W);
  const lg = Math.log10(Re) - 2;
  return 0.075 / (lg * lg);
}

// Rig settings (0..1 unless noted)
export function defaultControls() {
  return {
    helm: 0,            // -1..1 of max rudder (+ = bow turns to starboard)
    main: 0.3, jib: 0.3, stay: 0.3, // sheet ease: 0 = hard in, 1 = fully eased
    trav: 0.5,          // traveler car: 0 = to windward, 1 = to leeward
    vang: 0.3, cunn: 0.2, outhaul: 0.4, backstay: 0.3,
    jibLead: 0.45,      // jib car: 0 = forward (deep foot, closed leech) .. 1 = aft (flat foot, open leech)
    jibHalyard: 0.5,    // luff tension: pulls draft forward
    tackLine: 0.3,      // gennaker tack height
    board: 1,           // daggerboard down fraction
    reef: 0,            // 0, 1, 2
    crewAft: 0,         // -1 forward .. 1 aft
    hike: 0,            // -1 (sit to leeward) .. 1 (full hike)
    gen: false,
    backJib: 0,         // crew holding the jib clew to one side (-1 port / +1 starboard) to back it
  };
}

// ---------------------------------------------------------------------------------------------
export class Boat {
  constructor(cls, opts = {}) {
    this.cls = typeof cls === 'string' ? CLASSES[cls] : cls;
    const C = this.cls;
    this.mass = C.massHull + C.crewN * C.crewEach;
    this.crewMass = C.crewN * C.crewEach;
    this.m11 = this.mass * (1 + C.amX); this.m22 = this.mass * (1 + C.amY);
    this.Izz = C.Izz * (1 + C.amYaw); this.Ixx = C.Ixx * (1 + C.amRoll);
    // hydrostatics from the drawn hull (shared geometry with the renderer)
    this.hydro = new HullHydro(C);
    const h0 = this.hydro.immerse(0.02, 0, 0, () => 0, () => 0, {});
    const h1 = this.hydro.immerse(-0.02, 0, 0, () => 0, () => 0, {});
    this.Awp = Math.max(0.2, (h1.V - h0.V) / 0.04);                  // waterplane area
    this.xG = this.hydro.immerse(0, 0, 0, () => 0, () => 0, {}).Mx / this.hydro.restV; // LCG over the LCB at rest
    this.m33 = this.mass * 1.8;                                       // heave incl. added mass
    this.Iyy = this.mass * (0.27 * C.loa) ** 2 * 1.7;                  // pitch incl. added inertia
    this.kRoll = RHO_W * G * this.Awp * (C.beam * C.beam / 12);
    this.cRoll = 2 * 0.07 * Math.sqrt(Math.max(1, this.mass * G * 0.6) * this.Ixx);
    this._hy = {}; this._ws7 = []; for (let i = 0; i < 7; i++) this._ws7.push({});
    this.sails = C.sails;
    this.sailBy = {};
    for (const s of C.sails) this.sailBy[s.key] = s;
    this.id = opts.id ?? 0;
    this.name = opts.name ?? 'Boat';
    this.ctrl = defaultControls();
    this.auto = { trim: false, hike: true };
    this.diag = { strips: {}, shape: {}, rig: {} };
    for (const s of C.sails) {
      this.diag.strips[s.key] = STRIP_F.map(() => ({ alpha: 0, state: 0, cl: 0, cd: 0, V: 0, flog: 0 }));
      this.diag.shape[s.key] = STRIP_F.map(() => ({ d: 0.12, f: 0.45, tw: 0, ang: 0 }));
    }
    this._w = {}; this._wv = {}; this._c = {}; this._fc = {}; this._sc = {};
    this.shadow = 1;
    this.slamEvents = 0;
    this.reset(opts.x ?? 0, opts.z ?? 0, opts.heading ?? 0);
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.psi = heading;
    this.u = 0; this.v = 0; this.r = 0; this.phi = 0; this.p = 0;
    this.booms = {};
    for (const s of this.sails) if (s.kind === 'boom') this.booms[s.key] = { a: 0.2, rate: 0 };
    this.side = { jib: 1, gennaker: 1 };
    this.genDeploy = 0; this.genFill = 0;
    this.rudder = 0; this.crewY = 0; this.crewX = 0;
    this.lines = { main: this.ctrl.main, jib: this.ctrl.jib, stay: this.ctrl.stay };
    this.heave = 0; this.heaveV = 0; this.pitch = 0; this.pitchV = 0;
    this.capsized = false; this.capsizeT = 0; this.righting = 0;
    this.aground = 0;
    this.reefPos = 0; this.reefSlack = 0; this.reefing = false;
    this.log = 0; this.t = 0; this.slam = 0;
    this._clHead = 0; this._clMain = 0;
  }

  GZ(phi) {
    const C = this.cls;
    return (C.gm - C.bmForm) * Math.sin(phi) + C.bmForm * Math.sin(2 * phi) / 2;
  }

  // Maximum angle a boomed sail may swing out to, given sheet + traveler
  boomLimit(s) {
    const ease = clamp(this.lines[s.key] ?? 0.3, 0, 1);
    if (s.trav) {
      const travA = lerp(s.trav[0], s.trav[1], clamp(this.ctrl.trav, 0, 1));
      return clamp(travA + ease * (s.max - s.trav[1]), 0, s.max);
    }
    return lerp(s.min, s.max, ease);
  }

  // Shape of every strip of sail s: depth d, draft position f, twist tw (rad, + = opens to leeward)
  shapeSail(s, q, bend, sag, out) {
    const c = this.ctrl;
    const stretch = clamp(q / 90, 0, 1.2);
    for (let i = 0; i < 3; i++) {
      const o = out[i];
      let d = s.depth[i], f = 0.45, tw = 0;
      const fr = STRIP_F[i] / 0.82;
      if (s.key === 'main') {
        const ease = this.lines.main;
        const sheetDown = 1 - sstep(0, 0.32, ease);      // the sheet pulls down on the leech only when hard in
        const LT = Math.max(c.vang * 0.95, sheetDown * (s.trav ? 1 : 0.85));
        tw = (s.twistMax * (1 - 0.82 * LT) + 5 * DEG * bend) * Math.pow(fr, 1.3);
        if (i === 0) d *= 1.28 - 0.6 * c.outhaul;
        if (i === 1) d *= 1.1 - 0.22 * c.outhaul;
        if (i > 0) d *= 1 - 0.38 * bend * (i === 2 ? 1.2 : 0.9);
        f = 0.5 - 0.2 * c.cunn + 0.12 * stretch;
        d *= (1 - 0.12 * c.cunn) * (1 + 0.1 * stretch);
        if (this.reefPos > 0) d *= 1 - 0.1 * this.reefPos;
        d *= 1 + 0.9 * this.reefSlack; f += 0.12 * this.reefSlack;
      } else if (s.key === 'jib') {
        const ease = this.lines.jib;
        tw = (3 * DEG + 16 * DEG * (0.35 * ease + 0.6 * c.jibLead)) * Math.pow(fr, 1.2);
        if (i === 0) d *= 1.3 - 0.6 * c.jibLead;
        d *= 1 + 0.45 * sag * (s.sagK ?? 1) * (i === 1 ? 1.2 : 0.8) * 0.7;
        f = 0.48 - 0.2 * c.jibHalyard + 0.1 * stretch + 0.08 * sag;
        d *= 1 + 0.08 * stretch;
      } else if (s.key === 'stay') {
        const ease = this.lines.stay;
        tw = (s.twistMax * (0.4 + 0.6 * sstep(0, 0.5, ease))) * Math.pow(fr, 1.2);
        d *= 1 + 0.25 * sag;
        f = 0.45 + 0.1 * stretch;
      } else { // gennaker
        tw = (10 * DEG + 12 * DEG * c.tackLine + 6 * DEG * this.lines.jib) * Math.pow(fr, 1.1);
        f = 0.5 - 0.08 * c.tackLine + 0.05 * stretch;
        d *= 1 + 0.05 * stretch - 0.06 * c.tackLine;
      }
      o.d = d; o.f = clamp(f, 0.25, 0.7); o.tw = tw;
    }
  }

  // one integration step. world (optional) supplies water depth for grounding.
  step(dt, env, t, world = null) {
    const C = this.cls, ctrl = this.ctrl, d = this.diag;
    this.t = t;
    const cps = Math.cos(this.psi), sps = Math.sin(this.psi);
    const fx = sps, fz = -cps, sx = cps, sz = sps;
    const cphi = Math.cos(this.phi), sphi = Math.sin(this.phi);
    const disp = this.mass;

    // ---- environment at the boat ----
    const cur = env.current.at(this.x, this.z, this._c);
    let wv = null, slopeAlong = 0, slopeLat = 0, slopeLatBow = 0, slopeLatStern = 0, orbU = 0, orbV = 0, waveH = 0;
    // the sea along the hull: 7 samples from stern to bow (height, slopes, orbital velocity)
    const W7 = this._ws7, xs7 = this._xs7 || (this._xs7 = [0, 1, 2, 3, 4, 5, 6].map(i => C.sternX + (C.bowX - C.sternX) * i / 6));
    if (env.wavesOn) {
      for (let i = 0; i < 7; i++) env.waves.sample(this.x + fx * xs7[i], this.z + fz * xs7[i], t, W7[i]);
      wv = W7[3];
      waveH = wv.h;
      slopeAlong = wv.sx * fx + wv.sz * fz;
      slopeLat = wv.sx * sx + wv.sz * sz;
      orbU = wv.vx * fx + wv.vz * fz; orbV = wv.vx * sx + wv.vz * sz;
    } else for (let i = 0; i < 7; i++) { W7[i].h = 0; W7[i].sx = 0; W7[i].sz = 0; W7[i].vy = 0; }

    const vgx = this.u * fx + this.v * sx + cur.x, vgz = this.u * fz + this.v * sz + cur.z;
    this.vgx = vgx; this.vgz = vgz;
    const ug = vgx * fx + vgz * fz, vg = vgx * sx + vgz * sz;

    const w = env.wind.sample(this.x, this.z, t, this._w);
    const wsp = w.speed * this.shadow;
    const wx = -Math.sin(w.dir) * wsp, wz = Math.cos(w.dir) * wsp;
    const Wbx = wx * fx + wz * fz, Wby = wx * sx + wz * sz;
    d.tws = w.speed; d.twd = w.dir; d.puff = w.puff;

    let X = 0, Y = 0, K = 0, N = 0;
    let sailX = 0, sailY = 0, sailK = 0;
    const heaveH = this.heave;
    const aeroOn = !this.capsized && this.righting <= 0;

    // mid-height apparent wind (drives headsail sides, trimming, crew)
    const M0 = this.sailBy.main;
    const zMid = C.boomZ + 0.45 * M0.luff;
    const pm = env.wind.profile(zMid * cphi + 0.5);
    const axm = Wbx * pm - ug, aym = Wby * pm - vg - this.r * C.mastX - this.p * zMid;
    const awaMid = Math.atan2(-aym, -axm);
    const qMid = 0.5 * RHO_A * (axm * axm + aym * aym);
    d.awaMid = awaMid; d.qMid = qMid;

    // ---- running rigging: lines move at crew/winch speed, slower under load ----
    for (const k of ['main', 'jib', 'stay']) {
      const target = ctrl[k] ?? 0.3;
      const load = (d.rig[k + 'Load'] || 0) / C.sheetPower;
      const rate = target > this.lines[k] ? 0.7 : 0.45 / (1 + load * load);
      this.lines[k] = clamp(this.lines[k] + clamp(target - this.lines[k], -rate * dt, rate * dt), 0, 1);
    }
    // mast bend and headstay sag
    const sheetHard = 1 - sstep(0, 0.3, this.lines.main);
    const bend = clamp((C.hasBackstay ? 0.75 * ctrl.backstay : 0) + M0.vangBend * ctrl.vang + M0.sheetBend * sheetHard, 0, 1);
    const sag = clamp(qMid / 70, 0, 1.3) * (C.hasBackstay ? 1 - 0.75 * ctrl.backstay : 0.5);
    d.rig.bend = bend; d.rig.sag = sag;

    // gennaker hoist/douse; the jib is furled while it flies
    const genDef = this.sailBy.gennaker;
    const genWant = !!(ctrl.gen && genDef);
    this.genDeploy = clamp(this.genDeploy + (genWant ? 0.22 : -0.3) * dt, 0, 1);

    // loose headsail sides (crew moves the clew across; hysteresis when running goose-winged)
    const flipRate = 0.9 * clamp(Math.sqrt(qMid) / 2.5, 0.25, 1.6);
    for (const k of ['jib', 'gennaker']) {
      const cs = this.side[k];
      let want = -Math.sign(awaMid) || cs;
      // tacking: the crew holds the jib aback until the bow is clearly through the wind, then lets
      // it go — heavy long-keelers need it held longer to push the bow round
      const hold = (k === 'jib' ? (C.id === 'blackwatch' ? 20 : 7) : 4) * DEG;
      if (Math.sign(want) !== Math.sign(cs) && Math.abs(awaMid) < hold) want = Math.sign(cs) || want;
      if (k === 'jib' && ctrl.backJib) want = ctrl.backJib; // crew holds the clew to windward
      else if (Math.sign(want) !== Math.sign(cs) && Math.abs(awaMid) > (k === 'jib' ? 160 : 176) * DEG) want = Math.sign(cs) || want;
      const rt = flipRate * dt * (k === 'jib' ? 2 : 1.2) * (C.id === 'blackwatch' ? 0.7 : 1);
      this.side[k] = clamp(cs + clamp(want - cs, -rt, rt), -1, 1);
    }

    // ---- reefing procedure: ease halyard -> tack down + reef line -> re-tension halyard ----
    {
      const target = clamp(ctrl.reef | 0, 0, M0.reefs || 0);
      const T = reefTime(C);
      if (Math.abs(target - this.reefPos) > 1e-3) {
        const dir = Math.sign(target - this.reefPos);
        this.reefPos = dir > 0 ? Math.min(target, this.reefPos + dt / T) : Math.max(target, this.reefPos - dt / (T * 0.7));
        this.reefing = true;
      } else { this.reefPos = target; this.reefing = false; }
      const ph = this.reefPos - Math.floor(this.reefPos);
      // halyard slack peaks in the middle of each reef: the main bags and flogs while the crew works
      this.reefSlack = this.reefing ? Math.max(Math.sin(Math.PI * ph), 0.35) : Math.max(0, this.reefSlack - dt * 0.8);
      d.reefing = this.reefing; d.reefProgress = ph;
    }

    // ---- sails ----
    const sc = this._sc;
    let clHeadSum = 0, clMainMid = 0;
    const reef = reefAt(this.reefPos);
    for (const s of this.sails) {
      const key = s.key;
      const ds = d.strips[key], sh = d.shape[key];
      let areaF = 1, baseAngle, pivotX, pivotZ, side, flogging = 0, fill = 1, luff = s.luff;
      if (s.kind === 'boom') {
        const b = this.booms[key];
        baseAngle = b.a; side = Math.sign(b.a) || 1;
        if (key === 'main') { pivotX = C.mastX; pivotZ = C.boomZ; areaF = reef.a; luff = s.luff * reef.l; }
        else { pivotX = s.tackX; pivotZ = s.tackZ; }
      } else if (s.kind === 'loose') {
        areaF = genDef && genDef.replaces === key ? 1 - this.genDeploy : 1;
        pivotX = s.tackX; pivotZ = s.tackZ;
        baseAngle = this.side.jib * lerp(s.min, s.max, this.lines.jib); side = Math.sign(this.side.jib) || 1;
        flogging = 1 - sstep(0.55, 0.95, Math.abs(this.side.jib));
      } else {
        areaF = this.genDeploy; pivotX = s.tackX; pivotZ = s.tackZ;
        baseAngle = this.side.gennaker * lerp(s.min, s.max, this.lines.jib); side = Math.sign(this.side.gennaker) || 1;
        flogging = 1 - sstep(0.5, 0.95, Math.abs(this.side.gennaker));
        fill = this.genFill;
      }
      ds.areaF = areaF; ds.baseAngle = baseAngle; ds.luff = luff;
      this.shapeSail(s, qMid, bend, sag, sh);
      let boomTorque = 0, Fsum = 0, genAlphaMid = 0;
      if (areaF < 0.02 || !aeroOn) {
        for (let i = 0; i < 3; i++) { const st = ds[i]; st.state = 0; st.cl = 0; st.flog = areaF < 0.02 ? 0 : 1; sh[i].ang = baseAngle + side * sh[i].tw; }
      } else for (let i = 0; i < 3; i++) {
        const f = STRIP_F[i], o = ds[i], shp = sh[i];
        const chord = s.foot * (1 - f) + s.head * f;
        const zs = pivotZ + f * luff;
        const lim = Math.max(Math.abs(baseAngle), 90 * DEG);  // the leech never twists past square
        const ang = clamp(baseAngle + side * shp.tw, -lim, lim);
        shp.ang = ang;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const xce = pivotX - (s.rake || 0) * f - 0.4 * chord * ca;
        const yce = 0.4 * chord * sa;
        const prof = env.wind.profile(zs * cphi - yce * sphi + 0.4 + heaveH);
        let axs = Wbx * prof - ug + this.r * yce;
        let ays = Wby * prof - vg - this.r * xce - this.p * zs;
        if (s.kind === 'boom') {
          const rb = 0.4 * chord, br = this.booms[key].rate;
          axs -= br * rb * sa; ays -= br * rb * ca;
        }
        const an = ays * cphi;
        const V2 = axs * axs + an * an;
        const V = Math.sqrt(V2) + 1e-9;
        const dx = axs / V, dn = an / V;
        const cx = -ca, cn = sa;
        const cross = cx * dn - cn * dx, dot = cx * dx + cn * dn;
        let alpha = Math.atan2(cross, dot);
        // slot: headsail downwash on the main, main upwash on the headsail
        const sgn = Math.sign(alpha) || 1;
        if (key === 'main') alpha -= sgn * 0.055 * this._clHead;
        else alpha += sgn * 0.03 * this._clMain;
        let a = Math.abs(alpha), rev = 1;
        if (a > Math.PI / 2) { a = Math.PI - a; rev = -1; }
        shapeCoef(a, shp.d, shp.f, s, sc);
        let cl = sc.cl, cd = sc.cd;
        if (s.kind === 'spin') {
          // an eased tack line lets the luff rotate to windward and hold shape at lower angles of attack
          const alf = sc.alf * (1 - 0.3 * ctrl.tackLine);
          if (a < alf) cl *= (a / alf) ** 2;
          cl *= fill; cd = lerp(0.35, cd, fill);
          if (i === 1) genAlphaMid = a;
        }
        if (key === 'main' && this.reefSlack > 0) flogging = Math.max(flogging, 0.75 * this.reefSlack);
        if (flogging > 0) { cl *= 1 - flogging; cd += 0.15 * flogging; }
        let lx = -(cx - dot * dx) * rev, ln = -(cn - dot * dn) * rev;
        const lm = Math.hypot(lx, ln) + 1e-9; lx /= lm; ln /= lm;
        const blanket = key === 'main' ? 1 : 1 - 0.65 * sstep(140 * DEG, 178 * DEG, Math.abs(awaMid));
        const q = 0.5 * RHO_A * V2 * s.area * STRIP_W[i] * areaF * blanket;
        const Fx = q * (cl * lx + cd * dx), Fn = q * (cl * ln + cd * dn);
        const Fy = Fn * cphi;
        sailX += Fx; sailY += Fy; sailK += Fn * zs;
        N += xce * Fy - (yce * cphi + zs * sphi) * Fx;
        Fsum += Math.hypot(Fx, Fn);
        if (s.kind === 'boom') boomTorque += 0.4 * chord * (Fx * sa + Fn * ca);
        o.alpha = alpha; o.cl = cl; o.cd = cd; o.V = V; o.alf = sc.alf; o.ast = sc.ast;
        o.state = flogging > 0.5 ? 1 : (s.kind === 'spin' && fill < 0.6 ? 1 : sc.state);
        o.flog = Math.max(sc.flog, flogging, s.kind === 'spin' ? 1 - fill : 0);
        if (i === 1) {
          if (key === 'main') clMainMid = cl;
          else clHeadSum = Math.max(clHeadSum, cl * areaF);
        }
      }
      ds.F = Fsum;
      if (s.kind === 'spin') {
        const target = genAlphaMid > sc.alf * 0.75 * (1 - 0.3 * ctrl.tackLine) && Math.abs(this.side.gennaker) > 0.8 ? 1 : 0;
        this.genFill = clamp(this.genFill + (target ? 1.4 : -2.6) * dt, 0, 1);
      }
      // ---- boom dynamics: a rotating body stopped by its sheet ----
      if (s.kind === 'boom') {
        const b = this.booms[key];
        const limit = this.boomLimit(s);
        const grav = s.boomMass * G * (s.foot * 0.45) * Math.sin(this.phi) * Math.cos(b.a);
        const inert = -s.Iboom * (this._rdot || 0);
        const damp = aeroOn ? 2.5 : 8;
        const acc = (boomTorque + grav + inert - damp * b.rate) / s.Iboom;
        b.rate += acc * dt; b.a += b.rate * dt;
        let sheetLoad = 0;
        if (Math.abs(b.a) >= limit) {
          const sg = Math.sign(b.a);
          b.a = sg * limit;
          if (b.rate * sg > 0) {
            const J = s.Iboom * b.rate * 1.2;
            if (key === 'main') { this.slam = Math.max(this.slam, Math.abs(b.rate)); if (Math.abs(b.rate) > 1.2) this.slamEvents++; }
            this.r -= J / this.Izz * 0.6;
            b.rate *= -0.2;
          }
          // the sheet holds the aero torque, plus the leech tension it carries when hard in
          sheetLoad = Math.abs(boomTorque + grav) / (s.foot * 0.85) * (1 + 1.6 * (1 - sstep(0, 0.35, this.lines[key] ?? 0.3)));
        }
        d.rig[key + 'Load'] = lerp(d.rig[key + 'Load'] || 0, sheetLoad, 0.1);
        d.rig[key + 'Limit'] = limit;
      } else if (s.kind === 'loose' || (s.kind === 'spin' && this.genDeploy > 0.5)) {
        d.rig.jibLoad = lerp(d.rig.jibLoad || 0, Fsum * 0.95 * areaF, 0.1);
      }
    }
    this._clHead = lerp(this._clHead, clHeadSum, 0.2);
    this._clMain = lerp(this._clMain, clMainMid, 0.2);
    d.Nsail = N;
    X += sailX; Y += sailY; K += sailK;
    this._sailKf = lerp(this._sailKf || 0, sailK, clamp(dt * 4, 0, 1));

    // windage of hull, rig and crew
    {
      const wd = C.windage, prof = env.wind.profile(wd.z * cphi + 0.3);
      const ax = Wbx * prof - ug, ay = Wby * prof - vg - this.p * wd.z;
      const V = Math.hypot(ax, ay);
      const q = 0.5 * RHO_A * wd.area * wd.cd * V * (this.capsized ? 0.5 : 1);
      X += q * ax; Y += q * ay * cphi; K += q * ay * cphi * wd.z;
    }

    // ---- hydrodynamics ----
    const uw = this.u - 0.6 * orbU, vw = this.v - 0.6 * orbV;
    // immersion of the real hull in the local sea (heave, pitch and heel included)
    const hy = this.hydro;
    const interp7 = (arr, key, x) => { const f = clamp((x - C.sternX) / (C.bowX - C.sternX) * 6, 0, 5.999), i = Math.floor(f), w = f - i; return arr[i][key] * (1 - w) + arr[i + 1][key] * w; };
    const etaAt = (x) => interp7(W7, 'h', x);
    const slLat = (x) => (interp7(W7, 'sx', x) * sx + interp7(W7, 'sz', x) * sz);
    const slAl = (x) => (interp7(W7, 'sx', x) * fx + interp7(W7, 'sz', x) * fz);
    const imm = hy.immerse(this.heave, this.pitch, this.phi, etaAt, slLat, this._hy, slAl);
    if (C.multihull) {
      const vh = imm.Vh || [imm.V / 2, imm.V / 2];
      this.flyIn = clamp(Math.min(vh[0], vh[1]) / Math.max(1e-6, Math.max(vh[0], vh[1])), 0, 1);
    } else this.flyIn = 1;
    d.flyIn = this.flyIn;
    const lwlDyn = Math.max(0.3, imm.lwl) * (C.lwl / hy.restLwl);
    const Fn = Math.abs(uw) / Math.sqrt(G * lwlDyn);
    d.lwl = lwlDyn; d.wetted = imm.girthLen; d.displaced = imm.V * RHO_W;
    this._etaAt = etaAt; this._slLat = slLat;
    this._etaDot = (x) => interp7(W7, 'vy', x) || 0;
    d.fn = Fn;
    const fc = this._fc;
    let keelCl = 0;
    {
      const F = C.keel;
      let board = F.board ? clamp(ctrl.board, 0.05, 1) : 1;
      if (F.twin) board *= 0.5 + 0.5 * this.flyIn;           // the windward board lifts out with its hull
      const area = F.area * board, ARe = F.ARe * Math.max(0.3, board), zk = F.z * (0.4 + 0.6 * board);
      const ul = this.u - 0.3 * orbU;
      const vl = (this.v - 0.3 * orbV + this.r * F.x + this.p * zk) * cphi;
      const V2 = ul * ul + vl * vl, V = Math.sqrt(V2) + 1e-9;
      foilCoef(Math.atan2(vl, ul), F, ARe, fc);
      keelCl = fc.cl;
      const q = 0.5 * RHO_W * V2 * area * (this.capsized ? 0.4 : 1);
      const kx = q * (fc.cl * vl / V - fc.cd * ul / V), kn = q * (-fc.cl * ul / V - fc.cd * vl / V);
      X += kx; Y += kn * cphi; K += kn * zk; N += F.x * kn * cphi;
      d.Nkeel = F.x * kn * cphi; d.keelCl = fc.cl;
      d.keelX = kx; d.keelY = kn * cphi; d.keelStall = fc.stalled; d.leeway = Math.atan2(this.v, Math.max(0.05, this.u));
      d.keelARe = ARe;
    }
    {
      const F = C.rudder;
      const ul = this.u - 0.5 * orbU;
      const vl = (this.v - 0.5 * orbV + this.r * F.x + this.p * F.z) * cphi;
      const V2 = ul * ul + vl * vl, V = Math.sqrt(V2) + 1e-9;
      // keel downwash at the rudder; a rudder hung on the keel's trailing edge acts more like a flap
      const eps = 1.2 * keelCl / (Math.PI * d.keelARe) * (ul > 0 ? 1 : 0) * (F.transom ? 0.35 : 1);
      foilCoef(wrap(Math.atan2(vl, ul) - eps + this.rudder), F, F.ARe, fc);
      const vent = (1 - sstep(38 * DEG, 70 * DEG, Math.abs(this.phi))) * (F.twin ? 0.5 + 0.5 * this.flyIn : 1);
      const q = 0.5 * RHO_W * V2 * F.area * vent;
      const rx = q * (fc.cl * vl / V - fc.cd * ul / V), rn = q * (-fc.cl * ul / V - fc.cd * vl / V);
      X += rx; Y += rn * cphi; K += rn * F.z; N += F.x * rn * cphi;
      d.Nrud = F.x * rn * cphi; d.rudAlpha = wrap(Math.atan2(vl, ul) - eps + this.rudder); d.eps = eps;
      d.rudderY = rn * cphi; d.rudderStall = fc.stalled; d.rudderLoad = Math.abs(rn); d.rudderVent = vent;
      d.helmMoment = rn * F.chord * (F.transom ? 0.3 : 0.12); // tiller feel: an unbalanced transom rudder is heavy
    }
    {
      const planeLift = sstep(0.45, 0.95, Fn);
      const Swet = imm.girthLen * (1 - 0.3 * planeLift);                 // wetted surface of the real hull
      const Rf = 0.5 * RHO_W * Swet * uw * uw * cfITTC(uw, lwlDyn) * 1.08;
      // fore-aft crew weight: forward in light air (bury the bow, lift the transom), aft when planing
      const optTrim = lerp(-0.6, 0.8, sstep(0.3, 0.55, Fn));
      const trimPen = 1 + 0.09 * (this.crewX - optTrim) ** 2;
      const Rr = disp * G * interp(C.rr, Fn) * (C.multihull ? 1 + 0.3 * (1 - this.flyIn) : 1 + 0.5 * this.phi * this.phi) * trimPen;
      let Raw = 0;
      if (wv) {
        const enc = Math.max(0, -(fx * env.waves.comps[0].dx + fz * env.waves.comps[0].dz));
        Raw = 0.12 * RHO_W * G * (env.waves.Hs / 2) ** 2 * C.beam * (0.3 + enc) * clamp(Math.abs(uw) / 2, 0, 1);
      }
      X -= (Rf + Rr + Raw) * Math.sign(uw);
      d.Rf = Rf; d.Rr = Rr; d.Raw = Raw;
      const H = C.hullLat;
      const cf = 0.5 * RHO_W * H.area * H.cd * vw * Math.abs(vw);
      Y -= cf; K -= cf * H.z;
      const T = C.canoeDraft, L = C.lwl;
      const N0 = N;
      N -= 0.5 * RHO_W * T * 0.9 * (L ** 4 / 32) * this.r * Math.abs(this.r);
      N -= 0.5 * RHO_W * T * L ** 3 * 0.03 * (Math.abs(uw) + 0.3) * this.r;
      if (!C.multihull) N -= 0.011 * 0.5 * RHO_W * uw * Math.abs(uw) * L * L * T * Math.sin(this.phi);
      // hull drag acts where the immersed volume is: a multihull on its leeward hull wants to bear away
      if (imm.V > 1e-6) N += (Rf + Rr) * Math.sign(uw) * (imm.My / imm.V) * cphi * (C.multihull ? 1 : 0.3);
      d.Nhull = N - N0;
      X -= 2 * uw;
    }

    // ---- grounding on the real bottom ----
    this.aground = 0;
    if (world) {
      const depth = world.depthAt(this.x, this.z);
      const draft = (C.keel.board ? C.draft * clamp(ctrl.board, 0.2, 1) : C.draft) * Math.abs(cphi) + 0.05;
      const pen = draft - depth;
      if (pen > 0) {
        this.aground = pen;
        const k = clamp(pen / 0.15, 0, 1);
        X -= this.u * disp * 4 * k; Y -= this.v * disp * 4 * k; N -= this.r * this.Izz * 3 * k;
        if (depth < 0.05) { // beached: push back toward water
          const g = world.gradDepth(this.x, this.z);
          const gx = g[0] * fx + g[1] * fz, gy = g[0] * sx + g[1] * sz;
          X += gx * disp * 3; Y += gy * disp * 3;
        }
      }
    }

    // ---- hydrostatics & crew ----
    // buoyancy of the immersed hull: roll restoring moment from where the displaced volume actually is,
    // hull + ballast weight at its real height, crew weight where the crew is
    const Fb = RHO_W * G * imm.V;
    K -= RHO_W * G * imm.My;
    K += C.massHull * G * C.zG * sphi;
    K -= this.cRoll * this.p;
    K += this.crewMass * G * (this.crewY * cphi + C.crewZ * sphi);
    // Froude-Krylov wave forces on the immersed volume (surfing, wave roll/yaw)
    if (wv) { X += RHO_W * G * imm.FKx; Y += RHO_W * G * imm.FKy * cphi; N += RHO_W * G * imm.FKn * cphi; }
    d.Fb = Fb;

    // ---- integrate rigid body ----
    const m11 = this.m11, m22 = this.m22;
    let du = (X + m22 * this.v * this.r) / m11;
    let dv = (Y - m11 * this.u * this.r) / m22;
    let dr = N / this.Izz;
    const dp = K / this.Ixx;
    if (this.capsized) { du -= 1.5 * this.u; dv -= 1.5 * this.v; dr -= 2 * this.r; }
    this._rdot = dr;
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;
    this.p += dp * dt;
    if (this.capsized) {
      const target = Math.sign(this.phi || 1) * 88 * DEG;
      this.p += (-(this.phi - target) * 8 - this.p * 6 - dp) * dt;
    }
    if (this.righting > 0) {
      this.righting -= dt;
      this.phi *= Math.exp(-dt * 1.5); this.p = 0; this.u *= 0.98; this.v *= 0.95;
      if (this.righting <= 0) { this.capsized = false; this.phi = 0; this.p = 0; }
    }
    this.phi += this.p * dt;
    this.psi = wrap(this.psi + this.r * dt);
    this.x += (this.u * fx + this.v * sx + cur.x) * dt;
    this.z += (this.u * fz + this.v * sz + cur.z) * dt;
    this.log += Math.abs(this.u) * dt;
    if (C.canCapsize && !this.capsized && this.righting <= 0 && Math.abs(this.phi) > 80 * DEG) {
      this.capsized = true; this.capsizeT = t; this.capsizeKind = 'capsize';
    }
    // a multihull driven too hard downwind buries its bows and trips over them
    if (C.multihull && !this.capsized && this.pitch < -0.3 && this.u > 3) {
      this.capsized = true; this.capsizeT = t; this.capsizeKind = 'pitchpole'; this.phi = Math.sign(this.phi || 1) * 0.5; this.p = Math.sign(this.phi) * 2;
    }
    if (!C.canCapsize) this.phi = clamp(this.phi, -115 * DEG, 115 * DEG);

    // ---- rudder: slew rate limited by hydrodynamic load on the blade ----
    const target = clamp(ctrl.helm, -1, 1) * C.rudder.max;
    const slew = 1.5 / (1 + (d.rudderLoad || 0) / C.rudder.loadRef);
    this.rudder += clamp(target - this.rudder, -slew * dt, slew * dt);

    // ---- crew: hiking (athwartships) and fore-aft ----
    let crewTarget;
    const windSide = -Math.sign(awaMid) || 1;
    const lim = C.crewMaxOut;
    if (this.auto.hike) {
      const upwindness = 1 - sstep(80 * DEG, 150 * DEG, Math.abs(awaMid));
      const tgt = windSide * C.targetHeel * 0.6 * upwindness;
      const err = this.phi - tgt;
      this._hikeI = clamp((this._hikeI || 0) + err * dt * 1.2, -0.4, 0.4);
      const ff = 0.8 * (this._sailKf || 0) / (this.crewMass * G * lim);
      const cmd = clamp(err * 5 + this.p * 2.2 + this._hikeI + ff, -1, 1);
      crewTarget = -cmd * lim;
      ctrl.hike = clamp(-crewTarget * windSide / lim, -1, 1);
      ctrl.crewAft = lerp(-0.6, 0.8, sstep(0.3, 0.55, Fn));
    } else {
      const h = clamp(ctrl.hike, -1, 1);
      crewTarget = h >= 0 ? -windSide * h * lim : windSide * (-h) * -C.crewLee;
    }
    this.crewY += clamp(crewTarget - this.crewY, -C.hikeRate * dt, C.hikeRate * dt);
    this.crewX += clamp(ctrl.crewAft - this.crewX, -0.6 * dt, 0.6 * dt);

    // ---- heave & pitch: buoyancy of the real hull vs weight, drive couple and crew trim ----
    {
      const W = disp * G;
      const Fz = Fb - W;
      const kz = RHO_W * G * this.Awp;
      const cz = 2 * 0.35 * Math.sqrt(kz * this.m33);
      this.heaveV += (Fz - cz * this.heaveV) / this.m33 * dt;
      this.heave += this.heaveV * dt;
      const crewXm = this.crewX * 0.8 + (C.crewX0 ?? 0);
      let My = RHO_W * G * imm.Mx - W * this.xG - this.crewMass * G * crewXm;
      My -= sailX * (C.boomZ + 2.3);                                            // drive high, drag low: bow down
      My += (this.u > 0 ? 1 : 0) * 0.5 * RHO_W * uw * uw * C.beam * C.lwl * 0.004 * sstep(0.35, 0.6, Fn); // bow lift near planing
      const kp = RHO_W * G * this.Awp * C.lwl * C.lwl / 16;
      const cp2 = 2 * 0.3 * Math.sqrt(kp * this.Iyy);
      this.pitchV += (My - cp2 * this.pitchV) / this.Iyy * dt;
      this.pitch = clamp(this.pitch + this.pitchV * dt, -0.6, 0.6);
      if (!isFinite(this.heave)) { this.heave = 0; this.heaveV = 0; }
    }

    // ---- diagnostics / instruments ----
    d.X = X; d.Y = Y; d.K = K; d.N = N;
    d.sailX = sailX; d.sailY = sailY; d.sailK = sailK;
    d.RM = RHO_W * G * imm.My - C.massHull * G * C.zG * sphi - this.crewMass * G * (this.crewY * cphi + C.crewZ * sphi);
    d.rig.backstayLoad = (C.hasBackstay ? 350 + 5200 * ctrl.backstay ** 1.5 : 0) + 0.35 * (d.rig.mainLoad || 0);
    d.rig.bendMM = bend * M0.luff * 18;
    d.rig.sagMM = sag * (this.sailBy.jib ? this.sailBy.jib.luff * 12 * (this.sailBy.jib.sagK ?? 1) : 0);
    const zm = C.mastHeight;
    const pmh = env.wind.profile(zm * cphi + heaveH);
    const amx = Wbx * pmh - ug, amy = Wby * pmh - vg - this.p * zm - this.r * C.mastX;
    d.aws = Math.hypot(amx, amy); d.awa = Math.atan2(-amy, -amx);
    const tx = amx + this.u, ty = amy + this.v;
    d.twsInst = Math.hypot(tx, ty) / pmh;
    d.twa = Math.atan2(-ty, -tx);
    d.heading = this.psi; d.bsp = this.u;
    d.cog = Math.atan2(vgx, -vgz);
  }
}

// ---------------------------------------------------------------------------------------------
// Automatic trim — what a competent crew does. Used by AI boats, the player's trim assist and the VPP.
// Sheets and traveler for angle of attack; shape controls for wind strength and how overpowered the
// boat is; board height; (AI only) reefs.
export function autoTrim(boat, dt, aoaBias = 0, full = true) {
  const C = boat.cls, d = boat.diag, c = boat.ctrl;
  const awa = Math.abs(d.awaMid ?? Math.PI);
  const tws = (d.tws ?? 5) / KT;
  const over = clamp((Math.abs(boat.phi) - C.targetHeel) / (10 * DEG), 0, 1.5);
  const k = clamp(dt * 1.5, 0, 1);
  const upwind = 1 - sstep(55 * DEG, 95 * DEG, awa);
  const power = clamp((tws - 7) / 11, 0, 1);            // 0 = light: full shape, 1 = heavy: flat
  const flat = clamp(power + over * 0.6, 0, 1);
  if (full) {
    c.outhaul = lerp(c.outhaul, lerp(0.25, lerp(0.35, 1, flat), upwind), k);
    c.cunn = lerp(c.cunn, lerp(0, flat, upwind), k);
    if (C.hasBackstay) c.backstay = lerp(c.backstay, lerp(0.05, lerp(0.15, 1, flat), upwind), k);
    c.vang = lerp(c.vang, upwind > 0.5 ? (C.id === 'dinghy' ? lerp(0.15, 0.95, flat) : lerp(0.05, 0.7, flat)) : lerp(0.35, 0.55, power), k);
    c.jibLead = lerp(c.jibLead, lerp(0.4, 0.85, flat) * upwind + 0.55 * (1 - upwind), k);
    c.jibHalyard = lerp(c.jibHalyard, lerp(0.3, 0.9, flat), k);
    c.tackLine = lerp(c.tackLine, lerp(0.15, 0.7, sstep(110 * DEG, 150 * DEG, awa)), k);
    if (C.hasBoard) c.board = lerp(c.board, lerp(0.3, 1, upwind), k);
  }
  // slow and pinching (mid-tack or stalled head to wind): ease the main so the bow can fall off
  const pinched = awa < 32 * DEG && boat.u < 1.3;
  const sh = d.shape;
  for (const s of C.sails) {
    if (s.kind === 'spin' && boat.genDeploy < 0.5) continue;
    if (s.kind === 'loose' && boat.genDeploy >= 0.5) continue;
    const midTw = sh[s.key] ? sh[s.key][1].tw : 0;
    let aT;
    if (s.key === 'main') aT = (15 + aoaBias) * DEG - over * 7 * DEG + 0.055 * boat._clHead;
    else if (s.kind === 'spin') aT = (21 + aoaBias) * DEG;
    else aT = (13 + aoaBias) * DEG - over * 3 * DEG;
    const want = awa - aT - midTw;
    if (s.key === 'main' && s.trav) {
      // traveler carries the angle upwind, sheet sets leech tension (twist); off the wind, traveler down
      const sheetEase = clamp(0.06 + 0.25 * flat * upwind + (1 - upwind) * 0.3, 0, 1);
      const easeAngle = sheetEase * (s.max - s.trav[1]);
      const tr = clamp((want - easeAngle - s.trav[0]) / (s.trav[1] - s.trav[0]), 0, 1);
      c.trav = lerp(c.trav, tr, k * 2);
      const travAng = lerp(s.trav[0], s.trav[1], c.trav);
      c.main = lerp(c.main, clamp((want - travAng) / (s.max - s.trav[1]), pinched ? 0.35 : 0, 1), k * 2);
    } else {
      const key = s.kind === 'boom' ? s.key : 'jib';
      c[key] = lerp(c[key] ?? 0.3, clamp((want - s.min) / (s.max - s.min), 0, 1), k * 2);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Velocity prediction program: settle the full dynamic model at fixed true-wind angles (yaw locked,
// flat water, steady wind) with the auto crew, trying several trim targets and keeping the fastest.
export function makeSteadyEnv(twsMS) {
  const z0 = 2e-4, lr = Math.log(10 / z0);
  return {
    wind: { sample: (x, z, t, o) => { o.speed = twsMS; o.dir = 0; o.puff = 0; return o; },
            profile: (h) => Math.log(Math.max(h, 0.3) / z0) / lr },
    current: { at: (x, z, o) => { o.x = 0; o.z = 0; return o; } },
    wavesOn: false,
  };
}

export function solvePolarAngle(C, twsMS, twaDeg) {
  const env = makeSteadyEnv(twsMS);
  const dt = 1 / 50;
  let best = { twa: twaDeg, bsp: 0, vmg: 0 };
  const genOpts = C.sails.some(s => s.kind === 'spin') && twaDeg >= 85 ? [false, true] : [false];
  for (const gen of genOpts) for (const bias of [-4, 0, 4]) {
    const b = new Boat(C);
    b.reset(0, 0, twaDeg * DEG);
    b.u = 1.5; for (const k in b.booms) b.booms[k].a = 0.3; b.side.jib = 1; b.side.gennaker = 1;
    b.ctrl.gen = gen; b.genDeploy = gen ? 1 : 0; b.genFill = gen ? 1 : 0;
    let acc = 0, n = 0;
    const steps = 50 * 40;
    for (let i = 0; i < steps; i++) {
      autoTrim(b, dt, bias);
      b.step(dt, env, i * dt);
      b.r = 0; b.psi = twaDeg * DEG; b.rudder = 0;
      if (i > steps * 0.7) { acc += b.u; n++; }
    }
    const bsp = b.capsized ? 0 : acc / n;
    if (bsp > best.bsp) best = { twa: twaDeg, bsp, heel: b.phi / DEG, gen, bias, leeway: b.diag.leeway / DEG };
  }
  best.vmg = best.bsp * Math.cos(twaDeg * DEG);
  return best;
}

export const POLAR_TWAS = [32, 36, 40, 44, 48, 55, 65, 75, 90, 105, 120, 135, 150, 165, 180];
export function solvePolar(cls, twsMS, angles = POLAR_TWAS) {
  const C = typeof cls === 'string' ? CLASSES[cls] : cls;
  return angles.map(a => solvePolarAngle(C, twsMS, a));
}

export function vmgTargets(polar) {
  let up = polar[0], dn = polar[polar.length - 1];
  for (const p of polar) { if (p.vmg > up.vmg) up = p; if (p.vmg < dn.vmg) dn = p; }
  return { up, dn };
}

export function polarSpeedAt(polar, twaDeg) {
  const a = Math.abs(twaDeg);
  if (a <= polar[0].twa) return polar[0].bsp * Math.max(0, (a - 20) / (polar[0].twa - 20));
  for (let i = 1; i < polar.length; i++) {
    if (a <= polar[i].twa) return lerp(polar[i - 1].bsp, polar[i].bsp, (a - polar[i - 1].twa) / (polar[i].twa - polar[i - 1].twa));
  }
  return polar[polar.length - 1].bsp;
}
