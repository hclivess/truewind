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
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

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
export const wrap = (a) => { if (!isFinite(a)) return 0; return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)); };

// ---------------------------------------------------------------------------------------------
// Boat classes. Geometry in metres from the centre of gravity (x fwd), heights above waterline.
// Sail kinds: 'boom' (main, self-tacking staysail or jib), 'loose' (jib), 'spin' (asymmetric gennaker, or a
// symmetric spinnaker when it has a pole: s.pole, its length).
export const CLASSES = {
  blackwatch: {
    id: 'blackwatch', group: 'cruiser', name: 'Blackwatch 19/24',
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
    // mast stepped on the cabin top 2.1 m aft of the stem (photos of hull #66: 37% of LOD from the bow)
    mastX: 0.72, mastHeight: 8.4, boomZ: 1.5, keelBulb: false,
    targetHeel: 18 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 900,
    sails: [
      { key: 'main', kind: 'boom', area: 10.4, luff: 6.5, foot: 3.0, head: 0.15, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
        cd0: 0.07, ARe: 3.2, min: 2 * DEG, max: 80 * DEG, trav: [-4 * DEG, 12 * DEG], Iboom: 42, boomMass: 18, reefs: 2,
        vangBend: 0.08, sheetBend: 0.05, color: 0x9c4f2e },
      { key: 'stay', kind: 'boom', selfTacking: true, area: 4.2, tackX: 2.55, tackZ: 1.45, luff: 4.8, foot: 1.6, head: 0.05, rake: 0.55,
        depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.2, min: 5 * DEG, max: 55 * DEG, Iboom: 6, boomMass: 5, color: 0x9c4f2e },
      { key: 'jib', kind: 'loose', area: 5.1, tackX: 4.2, tackZ: 1.05, luff: 7.0, foot: 2.05, head: 0.05, rake: 1.0, footRise: 0.9,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 12 * DEG, max: 55 * DEG, sagK: 1.6, color: 0x9c4f2e },
    ],
    hull: { color: 0x15171b, stripe: 0xb8902f, deck: 0xcdbf9f, boot: 0x7a1f1f, sectionN: 1.8, transom: 0.62, bowRake: 0.35, sheer: 0.18 },
  },
  sportboat: {
    id: 'sportboat', group: 'keelboat', name: 'Sportboat 23',
    blurb: '7 m one-design sportboat, 4 crew, carbon mast, asymmetric gennaker on a retractable bowsprit. Planes downwind from about 13 kn of wind.',
    specs: 'LOA 6.93 m · LWL 6.10 m · Beam 2.25 m · Draft 1.45 m · 794 kg · Main 16.7 m² · Jib 9.1 m² · Gennaker 39.5 m²',
    lwl: 6.1, loa: 6.93, beam: 2.25, bowX: 3.55, sternX: -3.38, freeboard: 0.72, canoeDraft: 0.28, wetted: 10.2, draft: 1.45,
    bowsprit: 1.0,
    massHull: 794, zG: -0.22, crewN: 4, crewEach: 80, crewZ: 0.6, crewMaxOut: 1.05, crewLee: -0.55, hikeRate: 0.55,
    gm: 1.05, bmForm: 0.65, Ixx: 1400, Izz: 3600, amX: 0.06, amY: 0.7, amYaw: 0.4, amRoll: 0.25,
    // residuary resistance / weight. The hump is that of a keelboat that planes, not a dinghy: total R/W ~0.10-0.11
    // at Fn_vol ~2 (Savitsky; J/70-type D/L ~140 incl. crew), i.e. Rr/W ~0.07 once friction is taken off.
    // (It used to plateau at 0.05, which let it reach at wind speed in 12 kn — J/70 polars give ~8 kn.)
    rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0009], [0.25, 0.0018], [0.3, 0.0035], [0.35, 0.0065], [0.4, 0.013],
         [0.45, 0.027], [0.5, 0.044], [0.55, 0.057], [0.6, 0.066], [0.7, 0.072], [0.8, 0.071], [1.0, 0.066], [1.2, 0.065], [1.5, 0.069]],
    keel: { x: 0.65, z: -0.85, area: 0.58, ARe: 5.0, stall: 14 * DEG, cd0: 0.009, span: 1.17, chord: 0.5 },
    // the rudder hangs on the transom (J/Boats: "high aspect transom mounted molded rudder")
    rudder: { x: -3.45, z: -0.45, area: 0.23, ARe: 3.6, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.95, chord: 0.26, loadRef: 700, hung: true },
    hullLat: { area: 1.5, cd: 0.9, z: -0.1 },
    windage: { area: 2.8, z: 2.4, cd: 0.9 },
    // J/Boats sail plan: the deck-stepped mast is 2.5 m aft of the stem (J 2.34 m from the jib tack), 10.0 m DWL to
    // masthead, gooseneck 1.7 m above the waterline
    mastX: 1.03, mastHeight: 10.0, boomZ: 1.7, keelBulb: true,
    targetHeel: 17 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1400,
    sails: [
      { key: 'main', kind: 'boom', area: 16.7, luff: 7.97, foot: 2.88, head: 0.45, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 4.8, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 38, boomMass: 14, reefs: 0,
        vangBend: 0.15, sheetBend: 0.1, color: 0xf2f0ea },
      { key: 'jib', kind: 'loose', area: 9.1, tackX: 3.39, tackZ: 0.9, luff: 7.95, foot: 2.4, head: 0.08, rake: 0.32, footRise: 0.55,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.2, min: 8.5 * DEG, max: 42 * DEG, sagK: 1.0, color: 0xf2f0ea },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 39.5, tackX: 4.55, tackZ: 0.85, luff: 9.0, foot: 4.3, head: 0.5, rake: 0.55,
        depth: [0.19, 0.21, 0.19], cd0: 0.09, ARe: 2.2, min: 16 * DEG, max: 100 * DEG, color: 0xd9412b },
    ],
    hull: { color: 0xf3f4f1, stripe: 0x1d4e89, deck: 0xdcd8cc, boot: 0x1d4e89, sectionN: 2.6, transom: 0.78, bowRake: 0.25, sheer: 0.08 },
  },
  dinghy: {
    id: 'dinghy', group: 'dinghy', name: 'Singlehander 14',
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
    // ILCA rules: bottom section 2865 mm, top 3600 mm, boom pin 945 mm above the mast heel, which sits ~355 mm down
    // the deck tube: the gooseneck is ~0.6 m above the deck, the masthead ~6.2 m above the waterline
    mastX: 1.15, mastHeight: 6.24, boomZ: 1.0, keelBulb: false,
    targetHeel: 6 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 420,
    sails: [
      { key: 'main', kind: 'boom', area: 7.06, luff: 5.1, foot: 2.75, head: 0.25, depth: [0.12, 0.14, 0.12], twistMax: 24 * DEG,
        cd0: 0.06, ARe: 3.9, min: 3 * DEG, max: 88 * DEG, trav: null, Iboom: 12, boomMass: 6, reefs: 0,
        vangBend: 0.6, sheetBend: 0.45, color: 0xf4f3ee },
    ],
    hull: { color: 0xf6f6f2, stripe: 0xf6f6f2, deck: 0xe6e3da, boot: 0xc8412c, sectionN: 2.2, transom: 0.72, bowRake: 0.15, sheer: 0.05 },
  },
  cat: {
    id: 'cat', group: 'multihull', name: 'Beach Cat 16',
    blurb: '16 ft beach catamaran: twin asymmetric banana hulls with no daggerboards, trampoline, kick-up rudders on a tiller crossbar, fully battened rotating rig, both crew on trapeze. Flies a hull from about 10 kn, and pitchpoles if you bury the bows.',
    specs: 'LOA 5.04 m · Beam 2.41 m · Hull 160 kg · Main 13.7 m² (full battens) · Jib 5.2 m² · Spinnaker 17.5 m²',
    multihull: true, hullBeam: 0.42, hullSpacing: 2.0, noWinches: true, trapeze: true,
    lwl: 4.9, loa: 5.04, beam: 2.41, bowX: 2.52, sternX: -2.52, freeboard: 0.45, canoeDraft: 0.22, wetted: 4.8, draft: 0.85,
    bowsprit: 0.9,
    massHull: 160, zG: 0.42, crewN: 2, crewEach: 72, crewZ: 0.5, crewMaxOut: 2.0, crewLee: -0.4, hikeRate: 1.0,
    gm: 3, bmForm: 1, Ixx: 560, Izz: 520, amX: 0.04, amY: 0.35, amYaw: 0.4, amRoll: 0.4,
    // residuary resistance / weight of the pair of hulls, from the Southampton catamaran series (Molland,
    // Wellicome & Couser 1994) at this boat's slenderness L/vol^(1/3) ~ 9.3 per hull and spacing s/L ~ 0.4:
    // C_R ~ 5e-3 at the Fn 0.45-0.5 hump falling to ~1e-3 by Fn 1.2, times Fn^2 L S / 2 vol (~34 here).
    // A slender hull's C_R falls with speed but its Rr/W does not: it stays ~0.045-0.06 past the hump.
    // (The old table halved that, which is most of why the cat reached at 1.45 x the wind speed.)
    rr: [[0.1, 0.0004], [0.2, 0.002], [0.3, 0.0076], [0.35, 0.0145], [0.4, 0.024], [0.45, 0.036], [0.5, 0.042], [0.6, 0.046], [0.7, 0.046], [0.8, 0.048], [1.0, 0.051], [1.2, 0.054], [1.5, 0.061]],
    // no daggerboards: the Hobie 16's asymmetric hulls (flat inboard, round outboard, deep V aft) are its lateral plane;
    // the foil stands for their lift, the lee hull's share growing as the weather hull flies
    keel: { x: 0.3, z: -0.25, area: 0.36, ARe: 4.5, stall: 13 * DEG, cd0: 0.011, span: 0.75, chord: 0.26, twin: true },
    rudder: { x: -2.4, z: -0.3, area: 0.18, ARe: 3.5, stall: 16 * DEG, cd0: 0.012, max: 30 * DEG, span: 0.6, chord: 0.2, loadRef: 250, twin: true },
    hullLat: { area: 0.6, cd: 0.9, z: -0.08 },
    windage: { area: 2.1, z: 1.1, cd: 1.0 },
    // 8.07 m (26' 6") rotating mast stepped on the front beam
    mastX: 0.6, mastHeight: 8.6, boomZ: 1.25, keelBulb: false,
    targetHeel: 7 * DEG, canCapsize: true, hasBackstay: false, hasBoard: false, sheetPower: 700,
    sails: [
      { key: 'main', kind: 'boom', area: 13.7, luff: 7.2, foot: 2.6, head: 1.1, depth: [0.1, 0.12, 0.11], twistMax: 15 * DEG,
        cd0: 0.06, ARe: 4.6, min: 1 * DEG, max: 75 * DEG, trav: [-4 * DEG, 24 * DEG], Iboom: 16, boomMass: 6, reefs: 0,
        vangBend: 0.2, sheetBend: 0.25, color: 0xf2f4f6 },
      { key: 'jib', kind: 'loose', area: 5.2, tackX: 2.3, tackZ: 0.55, luff: 6.2, foot: 1.7, head: 0.06, rake: 0.4,
        depth: [0.12, 0.13, 0.11], cd0: 0.04, ARe: 4.5, min: 9 * DEG, max: 40 * DEG, sagK: 0.8, color: 0xf2f4f6 },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 17.5, tackX: 3.35, tackZ: 0.5, luff: 7.4, foot: 3.3, head: 0.4, rake: 0.4,
        depth: [0.18, 0.2, 0.18], cd0: 0.08, ARe: 2.4, min: 14 * DEG, max: 95 * DEG, color: 0x1d4e89 },
    ],
    hull: { color: 0xf5f5f2, stripe: 0xd9412b, deck: 0xe8e8e4, boot: 0xeeeeea, bootTop: 0xf5f5f2, sectionN: 2, transom: 0.35, bowRake: 0.05, sheer: 0.1 },
  },
  // ---- International 49er: a two-handed skiff, both crew on trapeze from the wings, carbon mast, square-top fully
  // battened main, self-tacking jib on a track, asymmetric gennaker off a retractable pole.
  // Sources: World Sailing / 49er class (https://49er.org/class-info-2/tuning/), Wikipedia 49er (dinghy)
  // (LOA 4.88 m, hull beam 1.75 m, 2.74 m over the wings, hull 94 kg, main + jib 19.97 m^2, gennaker 37.16 m^2,
  // crew about 150 kg); the main/jib split and foil sizes are estimates. RYA PN 697, US Sailing D-PN 68.2.
  // Lines (for the line-handler schema): mainsheet through a ratchet block on the floor to a cam cleat, from the boom end
  // to a bridle across the transom; jib sheet (self-tacker) on a cam cleat at the front of the wing; gennaker sheets through
  // ratchet blocks on the wings, hand-held (no cleat); gennaker halyard / pole launcher on one continuous line with a cam;
  // cunningham and vang on 2:1 cascades to cam cleats either side; halyards locked at the masthead (lock, no cleat).
  '49er': {
    id: '49er', group: 'dinghy', name: '49er',
    blurb: 'The Olympic two-handed skiff: both crew on trapeze from wings out to 2.7 m, a carbon mast with a square-top main, a self-tacking jib and a 37 m² gennaker. It planes upwind in 12 kn and does the wind speed downwind. It capsizes, often.',
    specs: 'LOA 4.88 m · Beam 1.75 m (2.74 m over the wings) · Hull 94 kg · Main + jib 20.0 m² · Gennaker 37.2 m² · Crew 2 on trapeze',
    lwl: 4.5, loa: 4.88, beam: 1.4, bowX: 2.4, sternX: -2.3, freeboard: 0.4, canoeDraft: 0.12, wetted: 3.0, draft: 1.45,
    bowsprit: 1.2, noWinches: true, trapeze: 2, carbonMast: true, mastR: 0.036, spreaders: { n: 2, sweep: 25 * DEG },
    engine: null,
    // (the hull's deck is 1.75 m wide over its flare; its waterline beam about 1 m: the drawn lines use 1.4 m)
    // (both on trapeze: the rail at 1.37 m, each sailor's weight about 0.9 m beyond it)
    massHull: 112, zG: 0.2, crewN: 2, crewEach: 80, crewZ: 0.45, crewMaxOut: 2.3, crewLee: -0.3, hikeRate: 1.6,
    gm: 0.4, bmForm: 0.5, Ixx: 850, Izz: 480, amX: 0.04, amY: 0.45, amYaw: 0.4, amRoll: 0.2,
    // residuary resistance / weight: a light, flat-run skiff hull (D/L ~ 45) that is over its hump by Fn 0.6
    rr: [[0.1, 0.0001], [0.2, 0.001], [0.3, 0.0045], [0.35, 0.009], [0.4, 0.016], [0.45, 0.026], [0.5, 0.034],
         [0.55, 0.039], [0.6, 0.041], [0.7, 0.04], [0.8, 0.037], [1.0, 0.034], [1.2, 0.034], [1.5, 0.038]],
    keel: { x: -0.25, z: -0.7, area: 0.34, ARe: 6.5, stall: 13 * DEG, cd0: 0.009, span: 1.25, chord: 0.27, board: true },
    rudder: { x: -2.35, z: -0.4, area: 0.14, ARe: 4.2, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.8, chord: 0.19, loadRef: 300, lifting: true },
    hullLat: { area: 0.4, cd: 0.9, z: -0.05 },
    windage: { area: 1.3, z: 1.0, cd: 1.0 },
    // (the rig from the class sail plan: mast 2.3 m aft of the stem, 8.25 m above the water, boom 0.9 m over the deck)
    mastX: 0.1, mastHeight: 8.25, boomZ: 1.25, keelBulb: false, houndsF: 0.3,
    targetHeel: 8 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 520,
    sailcloth: 'laminate', battens: { EI: 15, full: true, rows: [0.14, 0.28, 0.42, 0.56, 0.7, 0.84] },
    sails: [
      { key: 'main', kind: 'boom', area: 15.0, luff: 6.85, foot: 2.8, head: 0.8, depth: [0.14, 0.16, 0.15], twistMax: 17 * DEG,
        cd0: 0.06, ARe: 4.2, min: 1 * DEG, max: 80 * DEG, trav: [-3 * DEG, 16 * DEG], Iboom: 10, boomMass: 4, reefs: 0,
        vangBend: 0.35, sheetBend: 0.3, color: 0xe9ecef },
      // the self-tacking jib: its clew runs on a track across the foredeck (drawn clubless; the physics holds the clew on
      // the track's arc as a club would)
      { key: 'stay', kind: 'boom', selfTacking: true, club: false, label: 'Jib', area: 5.0, tackX: 2.35, tackZ: 0.42, luff: 4.95, foot: 1.95, head: 0.05,
        depth: [0.11, 0.12, 0.1], twistMax: 13 * DEG, cd0: 0.045, ARe: 4.4, min: 5 * DEG, max: 38 * DEG, Iboom: 1.2, boomMass: 1, color: 0xe9ecef },
      // (a gennaker this big on a mast this short: its broad shoulders are drawn as a wide head, the luff near vertical
      // ahead of the mast, as the sportboat's, so the rated area fits with the clew near the transom)
      { key: 'gennaker', kind: 'spin', area: 37.2, tackX: 3.55, tackZ: 0.45, luff: 7.2, foot: 4.3, head: 1.6, rake: 1.5,
        depth: [0.18, 0.2, 0.18], cd0: 0.08, ARe: 2.3, min: 14 * DEG, max: 95 * DEG, color: 0x1a1d22 },
    ],
    hullLines: { tm: 0.42, tr: 0.82, be: 0.85, sheerBow: 0.12, sheerStern: 0.0, stemRake: 0.02, transomRake: 0.0, flare: 0.5, flat: 0.85, sternDepth: 0.45, crown: 0.04 },
    hull: { color: 0xf4f5f6, stripe: 0x1a1d22, deck: 0xdcdfe2, boot: 0x1a1d22, sectionN: 2.4, transom: 0.8, bowRake: 0.02, sheer: 0.05,
      bareBottom: true, lifelines: false, logo: '49er', transomName: null, deckTint: '#d9dde1', cockpit: { t0: 0.02, t1: 0.7, w: 0.7, sole: 0.14 },
      wings: { y: 1.37, x0: -2.0, x1: -0.05, rise: 0.08 } },
    gear: { travX: -2.1, travHalf: 0.4, boomS: 0.95, winchX: -0.6, winchY: 0.32, jibTrack: [0.0, -0.4], jibTrackY: 0.4, clutchX: -0.5 },
  },
  // ---- International 470: the Olympic two-person centreboard dinghy. Crew on trapeze, helm hiking, symmetric
  // spinnaker on a pole, centre mainsheet on a traveller on the centreboard case, pivoting centreboard.
  // Sources: World Sailing 470 class rules (https://www.sailing.org/tools/documents/4702017CR170217-%5B22006%5D.pdf),
  // Wikipedia 470 (dinghy) (LOA 4.70 m, LWL 4.40 m, beam 1.69 m, hull 120 kg, mast 6.76 m, main 9.12 m^2, jib 3.58 m^2,
  // spinnaker 13 m^2, crew 110-145 kg). Pole length and foil sizes are estimates. RYA PN 973, US Sailing D-PN 86.3.
  // Lines (for the line-handler schema): mainsheet centre-sheeted to a ratchet block with a swivel cam cleat on the
  // centreboard case; jib sheets to swivel cam cleats on the side tanks; spinnaker sheets and guys through ratchet blocks,
  // guys to cam cleats by the shrouds (twinning lines); pole uphaul/downhaul on cam cleats at the mast; vang, cunningham,
  // outhaul and jib halyard (rig tension) on cam cleats either side of the case.
  '470': {
    id: '470', group: 'dinghy', name: '470',
    blurb: 'The Olympic two-person dinghy since 1976: crew on trapeze, helm hiking, a symmetric spinnaker set on a pole, a pivoting centreboard. Planes on a reach in a breeze. It capsizes.',
    specs: 'LOA 4.70 m · LWL 4.40 m · Beam 1.69 m · Hull 120 kg · Main 9.12 m² · Jib 3.58 m² · Spinnaker 13.0 m² · Crew 2 (trapeze)',
    lwl: 4.4, loa: 4.7, beam: 1.69, bowX: 2.4, sternX: -2.2, freeboard: 0.42, canoeDraft: 0.15, wetted: 3.6, draft: 1.05,
    noWinches: true, trapeze: 1, mastR: 0.034, spreaders: { n: 1, sweep: 20 * DEG },
    engine: null,
    // crew weight out: the helm hiking (CG ~1.05 m out) and the crew on trapeze (~1.55 m), 60 + 70 kg
    massHull: 130, zG: 0.15, crewN: 2, crewEach: 65, crewZ: 0.38, crewMaxOut: 1.32, crewLee: -0.3, hikeRate: 1.6,
    gm: 0.4, bmForm: 0.56, Ixx: 330, Izz: 450, amX: 0.05, amY: 0.5, amYaw: 0.4, amRoll: 0.2,
    rr: [[0.1, 0.0001], [0.15, 0.0005], [0.2, 0.0012], [0.25, 0.0027], [0.3, 0.0055], [0.35, 0.011], [0.4, 0.02],
         [0.45, 0.033], [0.5, 0.045], [0.55, 0.052], [0.6, 0.055], [0.7, 0.054], [0.8, 0.051], [1.0, 0.048], [1.2, 0.049], [1.5, 0.055]],
    keel: { x: 0.45, z: -0.55, area: 0.32, ARe: 4.6, stall: 13 * DEG, cd0: 0.01, span: 0.82, chord: 0.38, board: true, pivot: true },
    rudder: { x: -2.25, z: -0.35, area: 0.14, ARe: 3.8, stall: 15 * DEG, cd0: 0.011, max: 35 * DEG, span: 0.66, chord: 0.22, loadRef: 280, lifting: true },
    hullLat: { area: 0.5, cd: 0.9, z: -0.05 },
    windage: { area: 1.0, z: 1.0, cd: 1.0 },
    // (the rig from the class sail plan: mast 1.85 m aft of the stem, 6.7 m above the water, boom 0.5 m over the deck)
    mastX: 0.65, mastHeight: 6.7, boomZ: 0.85, keelBulb: false, houndsF: 0.24, spreader: 0.42,
    targetHeel: 5 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 460,
    sailcloth: 'dacronDinghy',
    sails: [
      { key: 'main', kind: 'boom', area: 9.12, luff: 5.65, foot: 2.45, head: 0.2, depth: [0.12, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 4.0, min: 2 * DEG, max: 82 * DEG, trav: [-3 * DEG, 14 * DEG], Iboom: 7, boomMass: 4, reefs: 0,
        vangBend: 0.4, sheetBend: 0.3, color: 0xf4f3ee },
      { key: 'jib', kind: 'loose', area: 3.58, tackX: 2.4, tackZ: 0.4, luff: 4.0, foot: 1.7, head: 0.04,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.2, min: 9 * DEG, max: 42 * DEG, sagK: 0.8, color: 0xf4f3ee },
      // symmetric spinnaker: tack on the pole end (pole 1.9 m), head at the hounds
      { key: 'gennaker', kind: 'spin', label: 'Spinnaker', pole: 1.9, replaces: 'jib', area: 13.0, tackX: 0.65 + 0.07 + 1.9, tackZ: 1.15, luff: 4.45, foot: 2.9, head: 0.4, rake: 1.97,
        depth: [0.2, 0.22, 0.2], cd0: 0.09, ARe: 1.9, min: 16 * DEG, max: 100 * DEG, color: 0xd9412b },
    ],
    hullLines: { tm: 0.46, tr: 0.62, be: 0.72, sheerBow: 0.22, sheerStern: 0.0, stemRake: 0.12, transomRake: 0.0, flare: 0.25, flat: 0.6, sternDepth: 0.3, crown: 0.06 },
    hull: { color: 0xf6f6f2, stripe: 0x1d4e89, deck: 0xe6e3da, boot: 0x1d4e89, sectionN: 2.2, transom: 0.62, bowRake: 0.12, sheer: 0.06,
      bareBottom: true, lifelines: false, logo: '470', transomName: null, cockpit: { t0: 0.08, t1: 0.66, w: 0.62, sole: 0.14 } },
    gear: { travX: -0.5, travHalf: 0.22, travOnSole: true, boomS: 0.55, winchX: -0.2, winchY: 0.35, jibTrack: [0.55, 0.05], jibTrackY: 0.48, clutchX: 0.1 },
  },
  // ---- Star: the two-man Olympic keelboat of 1911-2012. A hard-chined, low-freeboard hull with long overhangs, a
  // steel fin with a lead bulb, a huge bendy-masted main and a small jib, running backstays, no spinnaker (downwind
  // the jib is poled out; here it is simply eased), crew hiking in harnesses.
  // Sources: International Star Class rules; Wikipedia Star (keelboat) (LOA 6.922 m, LWL 4.724 m, beam 1.734 m,
  // draft 1.016 m, 671 kg incl. the 401.5 kg bulb, main 20.5 m^2, jib 6.0 m^2, mast 9.652 m, crew S + 1.5 C <= 250 kg).
  // RYA PN 917 (1986), US Sailing D-PN 83.1.
  // Lines (for the line-handler schema): mainsheet on a floor traveller through a ratchet block to a cam cleat; jib
  // sheet to a cam cleat on the deck (the jib pole when running, not modelled); runners on levers (the classic Star
  // running backstay levers) or cam cleats; vang, cunningham, outhaul, mast puller (bend) on cam cleats, halyards on horn cleats.
  star: {
    id: 'star', group: 'keelboat', name: 'Star',
    blurb: "The Olympic keelboat of a century: a narrow hard-chined hull with long overhangs, a lead bulb on a steel fin, a huge main on a bendy mast held by running backstays, and a small jib. No spinnaker. Fast upwind, and heeled it sails on its overhangs.",
    specs: 'LOA 6.92 m · LWL 4.72 m · Beam 1.73 m · Draft 1.02 m · 671 kg (401 kg bulb) · Main 20.5 m² · Jib 6.0 m² · Crew 2',
    lwl: 4.72, loa: 6.92, beam: 1.73, bowX: 2.55, sternX: -2.45, freeboard: 0.36, canoeDraft: 0.2, wetted: 6.0, draft: 1.02,
    runners: true, mastR: 0.042,
    engine: null,
    massHull: 671, zG: -0.5, crewN: 2, crewEach: 100, crewZ: 0.45, crewMaxOut: 1.25, crewLee: -0.3, hikeRate: 0.9,
    gm: 0.6, bmForm: 0.5, Ixx: 1350, Izz: 2600, amX: 0.05, amY: 0.6, amYaw: 0.4, amRoll: 0.25,
    // residuary resistance / weight: a narrow, flat-floored hull whose overhangs lengthen its sailing waterline when heeled
    // (4.72 m upright, over 5.5 m heeled: the table is referenced to the upright length)
    rr: [[0.1, 0.0002], [0.15, 0.0005], [0.2, 0.0011], [0.25, 0.0022], [0.3, 0.0042], [0.35, 0.0075], [0.4, 0.0135], [0.45, 0.024],
         [0.5, 0.039], [0.55, 0.054], [0.6, 0.064], [0.7, 0.072], [0.8, 0.076], [1.0, 0.08], [1.5, 0.088]],
    keel: { x: 0.32, z: -0.55, area: 0.6, ARe: 3.0, stall: 15 * DEG, cd0: 0.011, span: 0.8, chord: 0.72 },
    rudder: { x: -2.2, z: -0.35, area: 0.2, ARe: 3.0, stall: 16 * DEG, cd0: 0.011, max: 32 * DEG, span: 0.6, chord: 0.34, loadRef: 450 },
    hullLat: { area: 0.7, cd: 0.9, z: -0.08 },
    windage: { area: 1.8, z: 1.1, cd: 0.95 },
    mastX: 1.35, mastHeight: 9.95, boomZ: 0.72, keelBulb: { len: 1.5, r: 0.13, flat: 0.8 }, houndsF: 0.24,
    targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 800,
    sailcloth: 'dacronDinghy',
    sails: [
      { key: 'main', kind: 'boom', area: 20.5, luff: 8.8, foot: 4.3, head: 0.2, depth: [0.13, 0.15, 0.14], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 4.0, min: 1.5 * DEG, max: 80 * DEG, trav: [-4 * DEG, 12 * DEG], Iboom: 40, boomMass: 8, reefs: 0,
        vangBend: 0.45, sheetBend: 0.3, color: 0xf4f3ee },
      { key: 'jib', kind: 'loose', area: 6.0, tackX: 3.7, tackZ: 0.55, luff: 6.9, foot: 1.95, head: 0.05,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.6, min: 8.5 * DEG, max: 45 * DEG, sagK: 1.2, color: 0xf4f3ee },
    ],
    hullLines: { tm: 0.5, tr: 0.45, be: 0.9, sheerBow: 0.25, sheerStern: 0.08, stemRake: 1.25, transomRake: 0.85, flare: 0.08, flat: 0.95, sternDepth: 0.02, crown: 0.06, wl: 0.8 },
    hull: { color: 0xd8e4ec, stripe: 0x14305a, deck: 0xe6e3da, boot: 0x14305a, sectionN: 2.4, transom: 0.4, bowRake: 1.2, sheer: 0.08,
      lifelines: false, logo: '★', transomName: null, deckTint: '#e4dfd2', cockpit: { t0: 0.18, t1: 0.62, w: 0.62, sole: 0.2 } },
    gear: { travX: -1.3, travHalf: 0.5, boomS: 0.6, travOnSole: true, winchX: 0.3, winchY: 0.3, jibTrack: [1.0, 0.45], jibTrackY: 0.42, clutchX: 0.6 },
  },
  // ---- J/24: the one-design keelboat of 1977 (5,500+ built). A 7/8 fractional sloop (forestay at 8.19 m, spinnaker
  // halyard at the same height), a 153% genoa, a symmetric spinnaker on a 2.98 m pole, lead fin keel, transom-hung
  // rudder, five crew on the rail.
  // Sources: ORC Club certificate GER907 (https://data.orc.org/public/WPub.dll/CC/038500021DV.pdf): LOA 7.318 m, beam
  // 2.692 m, draft 1.244 m, 1,444 kg, P 8.54 E 2.97 IG 8.19 J 2.90 SPL 2.98 BAS 1.08 m, main 15.44 genoa 17.79 spinnaker
  // 34.59 m^2, crew max 400 kg, RM 30.7 kg m/deg, wetted 10.78 m^2; class data (https://goodoldboat.com/saildata/boat/j24/):
  // LWL 6.10 m, ballast 431 kg.
  // Lines (for the line-handler schema): mainsheet 6:1 to a swivel cam on the floor traveller; genoa sheets on
  // self-tailing winches on the coamings; spinnaker sheets and guys on the same winches, guys through twinning lines on
  // cam cleats; pole topping lift and downhaul on cam cleats at the mast; halyards led aft to clutches either side of the
  // companionway; backstay cascade to a cam cleat at the tiller; vang, cunningham, outhaul to cams on the cabin top.
  j24: {
    id: 'j24', group: 'keelboat', name: 'J/24',
    blurb: "Rod Johnstone's 1977 one-design, raced by more sailors than any keelboat: a 153% genoa, a symmetric spinnaker on a pole, a lead fin and a transom-hung rudder, five crew on the rail. Surfs downwind in a breeze.",
    specs: 'LOA 7.32 m · LWL 6.10 m · Beam 2.69 m · Draft 1.22 m · 1,406 kg · 431 kg lead · Main 15.4 m² · Genoa 17.8 m² · Spinnaker 34.6 m²',
    lwl: 6.1, loa: 7.32, beam: 2.69, bowX: 3.3, sternX: -3.15, freeboard: 0.74, canoeDraft: 0.36, wetted: 10.8, draft: 1.24,
    // auxiliary: a 4 hp four-stroke outboard on a bracket on the transom, to port of the rudder (as J/24s carry it)
    engine: { type: 'outboard', kW: 2.9, rpmMax: 5500, gear: 2.08, prop: { D: 0.19, P: 0.15, Z: 3, folding: false, rh: true }, pos: [-3.3, -0.45, -0.35], shaftAngle: 0, tiltable: true },
    massHull: 1444, zG: 0.05, crewN: 5, crewEach: 80, crewZ: 0.62, crewMaxOut: 1.12, crewLee: -0.5, hikeRate: 0.55,
    gm: 1.2, bmForm: 0.7, Ixx: 2700, Izz: 6700, amX: 0.06, amY: 0.75, amYaw: 0.45, amRoll: 0.25,
    // residuary resistance / weight: a moderate-displacement keelboat (D/L ~ 180, L/vol^(1/3) 5.0) that surfs but
    // does not plane
    rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0008], [0.25, 0.0016], [0.3, 0.0032], [0.35, 0.006], [0.4, 0.013],
         [0.45, 0.03], [0.5, 0.052], [0.55, 0.066], [0.6, 0.074], [0.7, 0.08], [0.8, 0.08], [1.0, 0.078], [1.2, 0.077], [1.5, 0.08]],
    // (the fin is 0.88 m deep under a deep canoe body, which carries part of the side force: the area and aspect ratio
    // here are the fin's plus the hull's share)
    keel: { x: 0.45, z: -0.8, area: 1.1, ARe: 3.0, stall: 17 * DEG, cd0: 0.011, span: 0.88, chord: 1.05, lead: true },
    rudder: { x: -3.2, z: -0.5, area: 0.36, ARe: 3.2, stall: 17 * DEG, cd0: 0.012, max: 33 * DEG, span: 0.95, chord: 0.38, loadRef: 800, hung: true },
    hullLat: { area: 1.5, cd: 0.9, z: -0.12 },
    windage: { area: 3.6, z: 1.7, cd: 0.9 },
    mastX: 1.0, mastHeight: 10.5, boomZ: 1.9, keelBulb: false, houndsF: 0.14,
    targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1300, reefWind: [22, 30],
    sails: [
      { key: 'main', kind: 'boom', area: 15.44, luff: 8.54, foot: 2.97, head: 0.15, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 5.0, min: 1.5 * DEG, max: 78 * DEG, trav: [-5 * DEG, 12 * DEG], Iboom: 40, boomMass: 12, reefs: 1,
        vangBend: 0.06, sheetBend: 0.04, color: 0xf2f0ea },
      { key: 'jib', kind: 'loose', area: 17.79, label: 'Genoa', tackX: 4.0, tackZ: 0.95, luff: 7.9, foot: 4.3, head: 0.06, footRise: 0.15,
        depth: [0.13, 0.14, 0.12], cd0: 0.045, ARe: 3.6, min: 8 * DEG, max: 45 * DEG, sagK: 1.3, color: 0xf2f0ea },
      { key: 'gennaker', kind: 'spin', label: 'Spinnaker', pole: 2.98, replaces: 'jib', area: 34.59, tackX: 1.0 + 0.07 + 2.98, tackZ: 2.0, luff: 7.0, foot: 4.9, head: 0.6, rake: 3.05,
        depth: [0.2, 0.22, 0.2], cd0: 0.09, ARe: 1.9, min: 16 * DEG, max: 100 * DEG, color: 0x1d4e89 },
    ],
    hullLines: { tm: 0.46, tr: 0.72, be: 0.8, sheerBow: 0.2, sheerStern: 0.05, stemRake: 0.75, transomRake: 0.12, flare: 0.2, flat: 0.5, sternDepth: 0.25, crown: 0.06, wl: 0.9 },
    hull: { color: 0xf3f4f1, stripe: 0xc8412c, deck: 0xdcd8cc, boot: 0x1d2a44, sectionN: 2.4, transom: 0.72, bowRake: 0.75, sheer: 0.1,
      logo: 'J/24', transomName: ['#', ''], deckTint: '#e2e0d8', benches: true,
      cockpit: { t0: 0.04, t1: 0.44, w: 0.62, sole: 0.42 }, cabin: { t0: 0.45, t1: 0.74, h: 0.3, w: 0.78 } },
    gear: { travX: -2.65, travHalf: 0.5, travOnSole: true, boomS: 0.93, winchX: -1.2, winchY: 0.92, jibTrack: [-0.3, -1.2], jibTrackY: 1.05,
      clutchX: -0.3, cabinWinch: [-0.45, 0.5] },
  },
  // ---- Nordic Folkboat: Tord Sundén's 1941 clinker-built Scandinavian one-design. A heavy long-keeled boat with a
  // keel-hung rudder, spoon bow, raked transom and lots of sheer, a 3/4 fractional rig with a big main and a small
  // jib, no spinnaker (the class allowed one only in 2025), three crew.
  // Sources: Nordic Folkboat class rules 2025-2028 (https://www.folkboats.com/wp-content/uploads/2025/03/NORDIC-FOLKBOAT-CLASS-RULES-2025-2028-incl-spinnaker.pdf):
  // LOA 7.68 m, LWL 6.00 m, beam 2.20 m, draft 1.20 m, min 1,930 kg, iron keel 1,000-1,050 kg, sail area 24 m^2;
  // ORC Club certificate NED 866 (https://data.orc.org/public/WPub.dll/CC/161245): 2,000 kg, P 7.90 E 3.38 IG 6.20
  // J 2.05 BAS 1.10 m, main 16.24 jib 8.91 m^2, crew max 327 kg, RM 19.3 kg m/deg, wetted 13.78 m^2.
  // Lines (for the line-handler schema): mainsheet to a cam on the aft-deck traveller; jib sheets on small winches on
  // the coamings with horn cleats (older boats: cam cleats); halyards on horn cleats at the mast; backstay tackle on a
  // cam cleat; reef lines to horn cleats on the boom.
  folkboat: {
    id: 'folkboat', group: 'keelboat', name: 'Nordic Folkboat',
    blurb: "Tord Sundén's 1941 clinker one-design: a heavy long keel with the rudder hung on it, a spoon bow and a raked transom, a big main on a 3/4 rig and a small jib. No spinnaker. Stiff, wet and happiest at its 6 kn hull speed.",
    specs: 'LOA 7.68 m · LWL 6.00 m · Beam 2.20 m · Draft 1.20 m · 1,930 kg · 1,000 kg iron keel · Main 16.2 m² · Jib 8.9 m² · Crew 3',
    lwl: 6.0, loa: 7.68, beam: 2.2, bowX: 3.05, sternX: -3.05, freeboard: 0.62, canoeDraft: 0.42, wetted: 13.8, draft: 1.2,
    cabin: true, longKeel: true, reefTime: 60, reefWind: [18, 25],
    // auxiliary: a 4 hp outboard in a well under the cockpit's aft end (the usual Folkboat installation)
    engine: { type: 'outboard', kW: 2.9, rpmMax: 5000, gear: 2.08, prop: { D: 0.19, P: 0.15, Z: 3, folding: false, rh: true }, pos: [-2.6, 0, -0.4], shaftAngle: 0, tiltable: true },
    massHull: 1930, zG: -0.36, crewN: 3, crewEach: 95, crewZ: 0.62, crewMaxOut: 0.95, crewLee: -0.45, hikeRate: 0.5,
    gm: 0.55, bmForm: 0.55, Ixx: 2600, Izz: 6200, amX: 0.07, amY: 0.9, amYaw: 0.6, amRoll: 0.3,
    // residuary resistance / weight: heavy (D/L ~ 290), fine-ended and slack-bilged: a wall at hull speed
    rr: [[0.1, 0.0001], [0.15, 0.0003], [0.2, 0.0007], [0.25, 0.0015], [0.3, 0.0033], [0.35, 0.0075], [0.4, 0.018],
         [0.45, 0.04], [0.5, 0.068], [0.55, 0.088], [0.6, 0.1], [0.7, 0.112], [0.8, 0.118], [1.0, 0.124], [1.5, 0.134]],
    // (the long keel is faired into the drawn hull, whose wetted surface already carries its skin friction: its own
    // profile drag here is the form part only)
    keel: { x: 0.7, z: -0.45, area: 1.9, ARe: 1.1, stall: 24 * DEG, cd0: 0.005, span: 0.65, chord: 3.2, long: true },
    rudder: { x: -3.15, z: -0.45, area: 0.42, ARe: 2.2, stall: 21 * DEG, cd0: 0.013, max: 35 * DEG, span: 0.95, chord: 0.5, transom: true, loadRef: 900, wood: true },
    hullLat: { area: 1.2, cd: 0.9, z: -0.12 },
    windage: { area: 2.8, z: 1.5, cd: 0.95 },
    mastX: 1.8, mastHeight: 9.7, boomZ: 1.8, keelBulb: false, houndsF: 0.33,
    targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 900,
    sailcloth: 'dacronCruise',
    sails: [
      { key: 'main', kind: 'boom', area: 16.24, luff: 7.9, foot: 3.38, head: 0.1, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
        cd0: 0.07, ARe: 4.0, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 10 * DEG], Iboom: 40, boomMass: 12, reefs: 2,
        vangBend: 0.08, sheetBend: 0.05, color: 0xf3efe2 },
      { key: 'jib', kind: 'loose', area: 8.91, tackX: 3.9, tackZ: 0.98, luff: 5.8, foot: 2.9, head: 0.05, footRise: 0.1,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 10 * DEG, max: 50 * DEG, sagK: 1.4, color: 0xf3efe2 },
    ],
    hullLines: { tm: 0.52, tr: 0.36, be: 0.75, sheerBow: 0.42, sheerStern: 0.28, stemRake: 0.95, transomRake: 0.55, flare: 0.3, flat: 0.15, sternDepth: 0.06, crown: 0.07 },
    hull: { color: 0xf1ede0, stripe: 0x1f3d2c, deck: 0xcdbf9f, boot: 0x7a1f1f, sectionN: 1.8, transom: 0.36, bowRake: 0.95, sheer: 0.2,
      clinker: 9, wood: true, lifelines: false, benches: true, logo: 'F', transomName: ['Folkbåt', ''], deckTint: '#e6dcc4',
      cockpit: { t0: 0.06, t1: 0.42, w: 0.55, sole: 0.3 }, cabin: { t0: 0.44, t1: 0.7, h: 0.3, w: 0.62, wood: true } },
    gear: { travX: -2.75, travHalf: 0.45, boomS: 0.95, winchX: -0.35, winchY: 0.78, jibTrack: [0.6, -0.1], jibTrackY: 0.88, clutchX: 0.8 },
  },
  // ---- J/122: a 40 ft performance cruiser-racer (Alan Johnstone, 2007). Carbon fractional rig with two swept
  // spreaders and a backstay, a non-overlapping jib, an asymmetric spinnaker tacked on a retractable carbon bowsprit,
  // a low-VCG fin keel with a bulb, a spade rudder and wheel steering, nine crew racing.
  // Sources: ORC certificate J-CURVE (https://data.orc.org/public/WPub.dll/CC/03410000WW5): LOA 12.200 m, beam 3.638 m,
  // draft 2.240 m, 7,450 kg, P 15.65 E 5.36 IG 16.55 J 4.62 BAS 1.72 TPS 6.60 m, main 50.07 jib 42.82 asymmetric
  // 155.89 m^2, crew max 797 kg, RM 175.9 kg m/deg, wetted 31.26 m^2; J/Boats (https://jboats.com/j122-tech-specs):
  // LWL 10.55 m, 6,760 kg, 2,540 kg ballast.
  // Lines (for the line-handler schema): mainsheet and traveller on winches in the cockpit ahead of the wheel;
  // jib sheets on primary self-tailing winches; asymmetric sheets on the primaries (or secondaries), tack line and
  // bowsprit out-haul to clutches on the cabin top; halyards, reefs, vang and cunningham through clutches to the
  // cabin-top halyard winches; backstay on a hydraulic or cascade purchase to a cam cleat.
  j122: {
    id: 'j122', group: 'cruiser', name: 'J/122',
    blurb: "A 40 ft offshore cruiser-racer: a carbon fractional rig, a 106% jib, a 156 m² asymmetric on a retractable bowsprit, a bulb keel and wheel steering, nine crew. Heavy on the helm and the winches, and 8 kn in a sea breeze.",
    specs: 'LOA 12.20 m · LWL 10.55 m · Beam 3.64 m · Draft 2.24 m · 7,450 kg · 2,540 kg ballast · Main 50.1 m² · Jib 42.8 m² · Asymmetric 155.9 m²',
    lwl: 10.55, loa: 12.2, beam: 3.64, bowX: 5.75, sternX: -5.65, freeboard: 1.18, canoeDraft: 0.55, wetted: 31.3, draft: 2.24,
    bowsprit: 2.0, wheel: { x: -3.6, r: 0.72, h: 0.72 }, carbonMast: true, mastR: 0.1, reefWind: [22, 30], spreaders: { n: 2, sweep: 20 * DEG },
    // auxiliary: Volvo D2-40 (29 kW) on a saildrive, two-blade folding propeller 0.46 m (J/Boats J/122E spec; ORC cert prop)
    engine: { type: 'saildrive', kW: 29.4, rpmMax: 3200, gear: 2.18, prop: { D: 0.46, P: 0.33, Z: 2, folding: true, rh: true }, pos: [-1.4, 0, -0.95], shaftAngle: 0, tiltable: false },
    massHull: 7450, zG: 0.07, crewN: 9, crewEach: 85, crewZ: 1.35, crewMaxOut: 1.72, crewLee: -0.8, hikeRate: 0.5,
    gm: 1.35, bmForm: 0.8, Ixx: 23000, Izz: 82000, amX: 0.06, amY: 0.8, amYaw: 0.45, amRoll: 0.25,
    // residuary resistance / weight: a moderate-displacement cruiser-racer (D/L ~ 170, L/vol^(1/3) 5.3)
    rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0008], [0.25, 0.0016], [0.3, 0.0032], [0.35, 0.0062], [0.4, 0.013],
         [0.45, 0.031], [0.5, 0.054], [0.55, 0.07], [0.6, 0.08], [0.7, 0.088], [0.8, 0.09], [1.0, 0.092], [1.5, 0.1]],
    // (the fin with the canoe body's share of the side force)
    keel: { x: 0.25, z: -1.4, area: 2.1, ARe: 4.0, stall: 15 * DEG, cd0: 0.009, span: 1.7, chord: 1.1, lead: true },
    rudder: { x: -4.55, z: -0.95, area: 0.85, ARe: 3.8, stall: 16 * DEG, cd0: 0.01, max: 32 * DEG, span: 1.55, chord: 0.55, loadRef: 3500 },
    hullLat: { area: 4.0, cd: 0.9, z: -0.2 },
    windage: { area: 7.8, z: 3.0, cd: 0.9 },
    mastX: 1.75, mastHeight: 18.9, boomZ: 2.95, keelBulb: { len: 2.3, r: 0.26 }, houndsF: 0.08, spreader: 1.0,
    targetHeel: 22 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 6000,
    sails: [
      { key: 'main', kind: 'boom', area: 50.07, luff: 15.65, foot: 5.36, head: 0.35, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 5.4, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 900, boomMass: 45, reefs: 2,
        vangBend: 0.06, sheetBend: 0.04, ropeK: 6, color: 0x2b2e33 },
      { key: 'jib', kind: 'loose', area: 42.82, tackX: 6.35, tackZ: 1.32, luff: 16.1, foot: 5.0, head: 0.1, footRise: 0.1,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 5.2, min: 7.5 * DEG, max: 42 * DEG, sagK: 1.2, color: 0x2b2e33 },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 155.89, tackX: 8.4, tackZ: 1.5, luff: 17.4, foot: 8.3, head: 0.9, rake: 6.45,
        depth: [0.19, 0.21, 0.19], cd0: 0.09, ARe: 2.2, min: 16 * DEG, max: 100 * DEG, color: 0xc8412c },
    ],
    hullLines: { tm: 0.44, tr: 0.8, be: 0.8, sheerBow: 0.1, sheerStern: 0.02, stemRake: 0.45, transomRake: -0.1, flare: 0.2, flat: 0.6, sternDepth: 0.3, crown: 0.05, wl: 0.81 },
    hull: { color: 0xeef0f2, stripe: 0x1d2a44, deck: 0xdcd8cc, boot: 0x1d2a44, sectionN: 2.6, transom: 0.8, bowRake: 0.45, sheer: 0.06,
      logo: 'J/122', transomName: ['#', ''], deckTint: '#e0e0da', extension: false, benches: true,
      cockpit: { t0: 0.02, t1: 0.4, w: 0.66, sole: 0.72 }, cabin: { t0: 0.41, t1: 0.74, h: 0.36, w: 1.1 } },
    gear: { travX: -2.55, travHalf: 0.9, travOnSole: true, boomS: 0.9, winchX: -4.2, winchY: 1.45, jibTrack: [-0.4, -1.7], jibTrackY: 1.05,
      clutchX: -1.2, cabinWinch: [-1.4, 0.7] },
  },
  // ---- The Mariner's trimaran from Waterworld (1995). A 60 ft ocean-racing trimaran built for the film by Jeanneau
  // Techniques Avancées to a VPLP design, in the moulds of the ORMA 60 Pierre 1er; one sailing boat and one for the
  // set, the sailing one raced afterwards. Dressed as salvaged junk: rust, scrap plate, patched sails, a mast that
  // folds down on a tabernacle and is raised by a geared winch.
  // Sources: VPLP (https://www.vplp.fr/en/maritime/waterworld/): LOA 18.28 m, beam 15 m, draft 1.54 / 2.88 m (board up /
  // down), air draft 27.5 m, glass/Kevlar; press quoted in https://groups.google.com/g/alt.sailing.asa/c/8xz4nSFv5o0:
  // "no more than 6 metric tons", mast over 90 ft, close to 4,300 ft^2 (400 m^2) of sail (the whole inventory: here the
  // main and jib only, 300 m^2, as an ORMA 60 carries upwind). The hull and float lines, the foils, the weights and the
  // sail split are estimates for an ORMA 60 hull built heavier. Not seen motoring in the film: the small inboard is
  // what a working boat of this size carries for harbour.
  // Lines (for the line-handler schema): mainsheet on a big traveller on the aft beam, both on powered winches; jib
  // sheets to winches in the cockpit; halyards to clutches and a halyard winch at the mast; runners on winches; the
  // mast-raising wire on its own geared drum aft of the mast.
  mariner: {
    id: 'mariner', group: 'multihull', name: "Mariner's trimaran (Waterworld)",
    blurb: "The film's salvaged 60 ft racing trimaran: a slender main hull on two floats 15 m apart, a 27 m hinged mast raised by a geared winch, a fully battened patched main and a jib, rust and scrap everywhere. Flies a float from 10 kn and reaches at twice the wind speed.",
    specs: 'LOA 18.28 m · Beam 15.0 m · Draft 1.54 / 2.88 m · ~6,000 kg · Air draft 27.5 m · Main 205 m² · Jib 95 m²',
    lwl: 17.4, loa: 18.28, beam: 15.0, hullBeam: 2.5, bowX: 8.95, sternX: -8.85, freeboard: 1.3, canoeDraft: 0.72, wetted: 22, draft: 2.88,
    amas: { y: 6.7, sy: 0.46, sz: 0.85, szTop: 0.9, dz: 0.5, t0: 0.1, t1: 0.99, beams: [2.9, -3.6], netZ: 1.75 },
    wheel: { x: -5.4, r: 0.6, h: 0.8 }, runners: true, mastR: 0.16, reefTime: 90, reefWind: [20, 28],
    engine: { type: 'inboard', kW: 22, rpmMax: 3000, gear: 2.0, prop: { D: 0.4, P: 0.3, Z: 2, folding: true, rh: true }, pos: [-5.2, 0, -0.95], shaftAngle: 0.14, tiltable: false },
    massHull: 6000, zG: 0.85, crewN: 2, crewEach: 85, crewZ: 1.6, crewMaxOut: 3.0, crewLee: -1.0, hikeRate: 1.0,
    gm: 6, bmForm: 2, Ixx: 140000, Izz: 240000, amX: 0.04, amY: 0.35, amYaw: 0.4, amRoll: 0.4,
    // residuary resistance / weight of the main hull and the leeward float (slender hulls, L/vol^(1/3) ~ 10): the
    // Southampton-series level the beach cat uses, a little higher past the hump for the heavier build
    rr: [[0.1, 0.0004], [0.2, 0.002], [0.3, 0.0076], [0.35, 0.0145], [0.4, 0.024], [0.45, 0.034], [0.5, 0.04], [0.6, 0.045], [0.7, 0.047], [0.8, 0.05], [1.0, 0.054], [1.2, 0.058], [1.5, 0.065]],
    keel: { x: 0.3, z: -1.8, area: 1.8, ARe: 6.0, stall: 13 * DEG, cd0: 0.009, span: 2.15, chord: 0.8, board: true },
    rudder: { x: -8.3, z: -1.2, area: 0.75, ARe: 4.0, stall: 15 * DEG, cd0: 0.01, max: 30 * DEG, span: 1.55, chord: 0.48, loadRef: 4000 },
    hullLat: { area: 3.0, cd: 0.9, z: -0.2 },
    windage: { area: 16, z: 2.8, cd: 0.95 },
    mastX: 1.9, mastHeight: 27.3, boomZ: 2.7, keelBulb: false, houndsF: 0.1,
    targetHeel: 9 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 9000,
    sailcloth: 'dacronCruise', battens: { EI: 60, full: true, rows: [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.93] },
    sails: [
      { key: 'main', kind: 'boom', area: 205, luff: 23.6, foot: 8.6, head: 2.6, depth: [0.11, 0.13, 0.12], twistMax: 18 * DEG,
        cd0: 0.06, ARe: 5.0, min: 1 * DEG, max: 70 * DEG, trav: [-4 * DEG, 22 * DEG], Iboom: 3200, boomMass: 90, reefs: 2,
        vangBend: 0.08, sheetBend: 0.06, ropeK: 20, color: 0xcfc3a4 },
      { key: 'jib', kind: 'loose', area: 95, tackX: 9.3, tackZ: 1.55, luff: 21.4, foot: 8.2, head: 0.15, footRise: 0.2,
        depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.8, min: 8 * DEG, max: 40 * DEG, sagK: 1.0, color: 0xcfc3a4 },
    ],
    hullLines: { tm: 0.48, tr: 0.55, be: 0.95, sheerBow: 0.18, sheerStern: 0.0, stemRake: 0.15, transomRake: 0.0, flare: 0.35, flat: 0.35, sternDepth: 0.25, crown: 0.08, wl: 0.8 },
    hull: { color: 0x8c877c, stripe: 0x7a3b1e, deck: 0x6b6152, boot: 0x3b2f27, bootTop: 0x5a4a3c, sectionN: 2.2, transom: 0.55, bowRake: 0.15, sheer: 0.05,
      weathered: true, patchedSails: true, noNumber: true, lifelines: false, logo: '', transomName: null, deckTint: '#7d7263', extension: false,
      cockpit: { t0: 0.12, t1: 0.36, w: 0.6, sole: 0.85 }, cabin: { t0: 0.37, t1: 0.56, h: 0.55, w: 0.95 } },
    gear: { travX: -3.6, travHalf: 2.4, boomS: 0.93, winchX: -4.4, winchY: 0.95, jibTrack: [0.8, -1.4], jibTrackY: 1.05, clutchX: -0.4, cabinWinch: [-0.6, 0.7] },
  },
};
// headsails are set on stays that run from the tack up to the mast: the head sits at the mast, so the
// luff's rake is the horizontal distance from the tack to the mast (a free-flying gennaker keeps its own)
for (const C of Object.values(CLASSES)) for (const s of C.sails) {
  if (s.kind === 'loose' || (s.kind === 'boom' && s.key !== 'main')) s.rake = s.tackX - (C.mastX + 0.07);
}
// lines that are held by a cleat, clutch or self-tailer (and which way they run when released)
export const LOCKABLE = ['main', 'jib', 'lazy', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibHalyard', 'tackLine'];
const RUNS_UP = new Set(['main', 'jib', 'lazy', 'stay', 'trav', 'tackLine']);
// (the menu shows them in this order within their groups: C.group, js/main.js CLASS_GROUPS)
export const CLASS_ORDER = ['blackwatch', 'folkboat', 'sportboat', 'j24', 'star', 'j122', 'dinghy', '470', '49er', 'cat', 'mariner'];

export const STRIP_F = [0.17, 0.5, 0.82];
export const STRIP_W = [0.43, 0.34, 0.23];
// js/sail/sailsim.js registers the cloth / vortex-lattice sail model here when it is loaded (no import cycle)
// (it also sets defaultModel: with it loaded every boat sails with cloth sails unless told otherwise, and
// polarAngle: the cloth sails' baked polars, js/sail/surrogate.js)
export const sailHooks = { make: null, defaultModel: null, polarAngle: null };
export const REEF = [{ a: 1, l: 1 }, { a: 0.76, l: 0.84 }, { a: 0.56, l: 0.69 }];
// area / luff factors at a continuous reef position (reefing is a procedure, not a switch)
export function reefAt(pos) {
  const i = Math.max(0, Math.min(1, Math.floor(pos))), f = Math.max(0, Math.min(2, pos)) - i;
  return { a: lerp(REEF[i].a, REEF[Math.min(2, i + 1)].a, f), l: lerp(REEF[i].l, REEF[Math.min(2, i + 1)].l, f) };
}
// seconds for the crew to put in (or shake out) one reef
export function reefTime(C) { return C.reefTime ?? (C.id === 'blackwatch' ? 70 : 45); }

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
  const sep = sstep(F.stall * 0.9, F.stall + 0.3, a);
  let cl = a <= F.stall ? slope * a : slope * F.stall * (1 - 0.4 * Math.min(1, (a - F.stall) / 0.12));
  let cd = F.cd0 + cl * cl / (Math.PI * ARe * 0.9) + 1.2 * Math.sin(a) ** 2 * sep;
  if (a > F.stall) {
    // deep stall: a flat plate with no leading-edge suction, so the force is normal to the chord
    // (Viterna-Corrigan, CDmax = 1.11 + 0.018 AR). The old post-stall lift (1.1 sin 2a against 1.2 sin^2 a
    // drag) tilted the resultant forward: a stalled keel pulled the boat ahead and a hard-over rudder
    // braked too little.
    const cdMax = 1.11 + 0.018 * ARe, t = sstep(F.stall, F.stall + 0.35, a);
    cl = lerp(cl, cdMax * Math.sin(a) * Math.cos(a), t);
    cd = lerp(cd, F.cd0 + cdMax * Math.sin(a) ** 2, t);
  }
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
    lazy: 1,            // the other jib sheet (on the windward winch): 1 = slack; hauled in, it drags the clew across (backs the jib)
    pushBoom: 0,        // una-rig: the sailor's hand pushing the boom out (-1 port / +1 starboard) to sail out of irons
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
    // sail model: 'strip' (three strips per sail, L2), 'vlm' (vortex lattice on the rig-set shapes) or
    // 'cloth' (cloth shaped by the wind and the rig, forces from a vortex lattice over it). lod 0/1/2 is the
    // detail level the cloth/lattice model runs at (2 = strip model); see js/sail/sailsim.js
    this.sailModel = opts.sailModel ?? sailHooks.defaultModel ?? 'strip';
    this.lod = opts.lod ?? (this.sailModel === 'strip' ? 2 : 0);
    this.sailSys = null;
    if (this.sailModel !== 'strip' && sailHooks.make) this.sailSys = sailHooks.make(this, this.sailModel, this.lod);
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
    this.lines = { main: this.ctrl.main, jib: this.ctrl.jib, stay: this.ctrl.stay, lazy: this.ctrl.lazy };
    this.backedByLazy = false;
    // every line is held by something: a cam cleat, a clutch or a winch self-tailer. Released, a loaded line
    // runs out by itself until it is cleated again (or held: the game marks lines the player is hauling)
    this.locks = Object.fromEntries(LOCKABLE.map(k => [k, true]));
    this.held = {};
    this.heave = 0; this.heaveV = 0; this.pitch = 0; this.pitchV = 0;
    this.capsized = false; this.capsizeT = 0; this.righting = false;
    this.aground = 0;
    this.reefPos = 0; this.reefSlack = 0; this.reefing = false;
    this.log = 0; this.t = 0; this.slam = 0;
    this._clHead = 0; this._clMain = 0;
    if (this.sailSys) this.sailSys.reset(this);
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

  // A strip of sail lying in the water (knocked down / capsized) is a plate in water, not a wing: blend
  // smoothly over the band where the cloth lies on the surface. A = strip area, h = its height above the
  // local surface, (xce, zs) its centre in the rig. Adds the water loads to ax; returns the wet fraction.
  sailWet(A, h, zs, xce, ax) {
    const wet = sstep(0.45, -0.15, h);
    if (wet > 0.01) {
      const cphi = ax.cphi;
      const vlat = this.v + this.r * xce + this.p * zs;                 // strip moving through the water
      const Aw = A * wet;
      const cq = 0.5 * RHO_W * 1.2 * Aw * Math.abs(vlat);                // linearised drag coefficient
      const Fp = -Math.sign(this.p * zs) * RHO_W * G * 0.01 * Aw;       // water lying on the cloth
      ax.Y += Fp * cphi; ax.N += xce * Fp * cphi;
      ax.K += (Fp - cq * (this.v + this.r * xce)) * zs;
      // dragging a whole sail sideways through water is stiff (a capsized cat: cq*dt/m > 2 blew the
      // explicit step up to NaN); its sway/yaw part goes into the implicit solve after the step
      const cw = cq * cphi; this._wD11 += cw; this._wD12 += cw * xce; this._wD22 += cw * xce * xce;
      this._cRollWet += cq * zs * zs;                                     // roll part: integrated implicitly (stiff)
      ax.X -= 0.5 * RHO_W * 0.08 * Aw * this.u * Math.abs(this.u);
    }
    return wet;
  }

  // Boom dynamics: a rotating body driven by the aero torque about its pivot, stopped by its sheet.
  boomDynamics(s, boomTorque, dt, aeroOn = true) {
    const key = s.key, ctrl = this.ctrl, d = this.diag;
    const b = this.booms[key];
    const limit = this.boomLimit(s);
    const grav = s.boomMass * G * (s.foot * 0.45) * Math.sin(this.phi) * Math.cos(b.a);
    const inert = -s.Iboom * (this._rdot || 0);
    const damp = aeroOn ? 2.5 : 8;
    // una-rig in irons: the sailor pushes the boom out against the wind to sail backwards and turn
    const push = (ctrl.pushBoom && !this.sailBy.jib && key === 'main') ? (ctrl.pushBoom * 0.8 - b.a) * s.Iboom * 20 : 0;
    const acc = (boomTorque + grav + inert + push - damp * b.rate) / s.Iboom;
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
  }

  // Where sail s sits and how it is set this step: the fraction of it hoisted (areaF), the chord angle at
  // its foot (baseAngle, + = to starboard), its pivot/tack, side, how much it flogs and how full it is.
  sailRig(s, reef, o) {
    const C = this.cls, key = s.key, genDef = this.sailBy.gennaker;
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
    o.areaF = areaF; o.baseAngle = baseAngle; o.pivotX = pivotX; o.pivotZ = pivotZ; o.side = side;
    o.flogging = flogging; o.fill = fill; o.luff = luff;
    return o;
  }

  // Strip-theory sails (level L2): three strips per sail, shape from the rig, coefficients from the shape.
  // ax carries the step's environment in and the sail forces and moments out.
  sailsStrip(ax) {
    const C = this.cls, ctrl = this.ctrl, d = this.diag;
    const { env, dt, cphi, sphi, heaveH, waveH, Wbx, Wby, ug, vg, rhoA, awaMid, qMid, bend, sag, aeroOn } = ax;
    const genDef = this.sailBy.gennaker;
    let X = 0, Y = 0, K = 0, N = 0, sailX = 0, sailY = 0, sailK = 0;
    const sc = this._sc;
    let clHeadSum = 0, clMainMid = 0;
    const reef = reefAt(this.reefPos);
    for (const s of this.sails) {
      const key = s.key;
      const ds = d.strips[key], sh = d.shape[key];
      const rg = this.sailRig(s, reef, this._rg || (this._rg = {}));
      const { areaF, baseAngle, pivotX, pivotZ, side, fill, luff } = rg;
      let flogging = rg.flogging;
      ds.areaF = areaF; ds.baseAngle = baseAngle; ds.luff = luff;
      this.shapeSail(s, qMid, bend, sag, sh);
      let boomTorque = 0, Fsum = 0, genAlphaMid = 0;
      if (areaF < 0.02 || !aeroOn) {
        for (let i = 0; i < 3; i++) { const st = ds[i]; st.state = 0; st.cl = 0; st.flog = areaF < 0.02 ? 0 : 1; sh[i].ang = baseAngle + side * sh[i].tw; }
      } else for (let i = 0; i < 3; i++) {
        const f = STRIP_F[i], o = ds[i], shp = sh[i];
        const chord = s.foot * (1 - f) + s.head * f;
        const zs = pivotZ + f * luff + (s.footRise || 0) * 0.4 * (1 - f);
        const lim = Math.max(Math.abs(baseAngle), 90 * DEG);  // the leech never twists past square
        const ang = clamp(baseAngle + side * shp.tw, -lim, lim);
        shp.ang = ang;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const xce = pivotX - (s.rake || 0) * f - 0.4 * chord * ca;
        const yce = 0.4 * chord * sa;
        // is this strip of sail in the water (knocked down / capsized)? a wet strip is a plate in water,
        // not a wing: blend smoothly over the band where the cloth lies on the surface
        const hStrip = zs * cphi - yce * sphi + heaveH - waveH;
        const wet = this.sailWet(s.area * STRIP_W[i] * areaF, hStrip, zs, xce, ax);
        o.inWater = wet > 0.5;
        if (wet > 0.99) { o.state = 0; o.cl = 0; o.flog = 0; continue; }
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
        const lm = hyp(lx, ln) + 1e-9; lx /= lm; ln /= lm;
        const blanket = key === 'main' ? 1 : 1 - 0.65 * sstep(140 * DEG, 178 * DEG, Math.abs(awaMid));
        const q = 0.5 * rhoA * V2 * s.area * STRIP_W[i] * areaF * blanket * (1 - wet);
        const Fx = q * (cl * lx + cd * dx), Fn = q * (cl * ln + cd * dn);
        const Fy = Fn * cphi;
        sailX += Fx; sailY += Fy; sailK += Fn * zs;
        N += xce * Fy - (yce * cphi + zs * sphi) * Fx;
        Fsum += hyp(Fx, Fn);
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
      if (s.kind === 'boom') this.boomDynamics(s, boomTorque, dt, aeroOn);
      else if (s.kind === 'loose' || (s.kind === 'spin' && this.genDeploy > 0.5)) {
        d.rig.jibLoad = lerp(d.rig.jibLoad || 0, Fsum * 0.95 * areaF, 0.1);
      }
    }
    this._clHead = lerp(this._clHead, clHeadSum, 0.2);
    this._clMain = lerp(this._clMain, clMainMid, 0.2);
    ax.X += X; ax.Y += Y; ax.K += K; ax.N += N; ax.sailX += sailX; ax.sailY += sailY; ax.sailK += sailK;
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
    this.diag.curX = cur.x; this.diag.curZ = cur.z;          // the tide the boat is in (the AI plans with it)
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
    // air density: the rain-cooled outflow under a squall (w.cold 0..1) is up to ~9 K colder than the air
    // around it, so ~3% denser (ideal gas, rho ~ 1/T at constant pressure) — a squall hits a little harder
    // than its wind speed alone says
    const rhoA = RHO_A * 288 / (288 - 9 * clamp(w.cold || 0, 0, 1));
    d.rhoA = rhoA;

    let X = 0, Y = 0, K = 0, N = 0;
    let sailX = 0, sailY = 0, sailK = 0;
    const heaveH = this.heave;
    const aeroOn = true;
    this._cRollWet = 0;                     // strips that are under water are handled one by one below
    this._wD11 = 0; this._wD12 = 0; this._wD22 = 0; // their sway/yaw drag, integrated implicitly

    // mid-height apparent wind (drives headsail sides, trimming, crew)
    const M0 = this.sailBy.main;
    const zMid = C.boomZ + 0.45 * M0.luff;
    const pm = env.wind.profile(zMid * cphi + 0.5);
    const axm = Wbx * pm - ug, aym = Wby * pm - vg - this.r * C.mastX - this.p * zMid;
    const awaMid = Math.atan2(-aym, -axm);
    const qMid = 0.5 * rhoA * (axm * axm + aym * aym);
    d.awaMid = awaMid; d.qMid = qMid;

    // ---- released lines run out under their load (sheets ease, controls lose tension, the car slides) ----
    for (const k of LOCKABLE) {
      if (this.held[k] > 0) { this.held[k] -= dt; continue; }
      if (this.locks[k] !== false || ctrl[k] === undefined) continue;
      const ld = k === 'main' || k === 'jib' || k === 'stay' ? (d.rig[k + 'Load'] || 0) / C.sheetPower : k === 'lazy' ? (d.rig.lazyLoad || 0) / C.sheetPower : k === 'trav' ? (d.rig.mainLoad || 0) / C.sheetPower : 0.35 * (ctrl[k] || 0) + 0.1;
      if (ld < 0.01) continue;
      const rate = Math.min(2.5, 0.25 + 1.6 * ld) * dt;
      if (RUNS_UP.has(k)) ctrl[k] = Math.min(1, ctrl[k] + rate);        // sheets and tack line ease, the car goes to leeward
      else ctrl[k] = Math.max(0, ctrl[k] - rate);                        // vang, cunningham, outhaul, backstay, halyard go slack
      if (k === 'main' || k === 'jib' || k === 'stay' || k === 'lazy') this.lines[k] = Math.max(this.lines[k], Math.min(ctrl[k], this.lines[k] + rate * 1.5));
    }
    // ---- running rigging: lines move at crew/winch speed, slower under load ----
    for (const k of ['main', 'jib', 'stay', 'lazy']) {
      const target = ctrl[k] ?? (k === 'lazy' ? 1 : 0.3);
      const load = (d.rig[(k === 'lazy' ? 'lazy' : k) + 'Load'] || 0) / C.sheetPower;
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

    // loose headsail sides. The jib has two sheets: the working sheet holds the clew on its side
    // until it is let go; the lazy sheet, hauled in on the other winch, drags the clew across (backing
    // the jib). When the clew crosses, the sheets swap roles — nothing is transferred by magic.
    const flipRate = 0.9 * clamp(Math.sqrt(qMid) / 2.5, 0.25, 1.6);
    for (const k of ['jib', 'gennaker']) {
      if (this.sailSys && this.sailSys.owns && this.sailSys.owns(k)) continue;   // a cloth headsail finds its own side
      const cs = this.side[k], cur = Math.sign(cs) || 1;
      let want = -Math.sign(awaMid) || cs;
      if (k === 'jib') {
        const held = this.lines.jib < 0.7;                       // made fast on the winch: the clew stays put
        if (want !== cur && held) want = cur;
        if (this.lines.lazy < 0.45 && this.lines.lazy < this.lines.jib - 0.2) want = -cur; // hauled across
        else if (want !== cur && Math.abs(awaMid) > 160 * DEG) want = cur; // running: the clew does not cross by itself
      } else {
        const hold = 4 * DEG;
        if (want !== cur && Math.abs(awaMid) < hold) want = cur;
        else if (want !== cur && Math.abs(awaMid) > 176 * DEG) want = cur;
      }
      const rt = flipRate * dt * (k === 'jib' ? 2 : 1.2) * (C.id === 'blackwatch' ? 0.7 : 1);
      this.side[k] = clamp(cs + clamp(want - cs, -rt, rt), -1, 1);
      if (k === 'jib' && Math.sign(this.side.jib) !== cur && this.side.jib !== 0) {
        // the clew crossed: the sheet on the new side is now the working sheet
        const byLazy = this.lines.lazy < this.lines.jib;
        [ctrl.jib, ctrl.lazy] = [ctrl.lazy, ctrl.jib];
        [this.lines.jib, this.lines.lazy] = [this.lines.lazy, this.lines.jib];
        this.backedByLazy = byLazy && -Math.sign(awaMid) !== Math.sign(this.side.jib);
      }
    }
    // a backed jib that the boat has turned into filling normally is simply the working jib again
    if (this.backedByLazy && -Math.sign(awaMid) === Math.sign(this.side.jib) && Math.abs(awaMid) > 25 * DEG) this.backedByLazy = false;
    d.rig.lazyLoad = this.lines.lazy < 0.5 && this.backedByLazy ? (d.rig.jibLoad || 0) * 0.2 : 0;

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
    const ax = this._ax || (this._ax = {});
    ax.env = env; ax.dt = dt; ax.cphi = cphi; ax.sphi = sphi; ax.heaveH = heaveH; ax.waveH = waveH;
    ax.Wbx = Wbx; ax.Wby = Wby; ax.ug = ug; ax.vg = vg; ax.rhoA = rhoA; ax.awaMid = awaMid; ax.qMid = qMid;
    ax.bend = bend; ax.sag = sag; ax.aeroOn = aeroOn;
    ax.X = 0; ax.Y = 0; ax.K = 0; ax.N = 0; ax.sailX = 0; ax.sailY = 0; ax.sailK = 0;
    if (this.sailSys && this.sailSys.active(this)) this.sailSys.step(this, ax);
    else this.sailsStrip(ax);
    X += ax.X; Y += ax.Y; K += ax.K; N += ax.N;
    sailX = ax.sailX; sailY = ax.sailY; sailK = ax.sailK;
    d.Nsail = N;
    X += sailX; Y += sailY; K += sailK;
    this._sailKf = lerp(this._sailKf || 0, sailK, clamp(dt * 4, 0, 1));

    // windage of hull, rig and crew
    {
      const wd = C.windage, prof = env.wind.profile(wd.z * cphi + 0.3);
      const ax = Wbx * prof - ug, ay = Wby * prof - vg - this.p * wd.z;
      const V = hyp(ax, ay);
      const q = 0.5 * rhoA * wd.area * wd.cd * V * Math.max(0.3, Math.abs(cphi));
      X += q * ax; Y += q * ay * cphi; K += q * ay * cphi * wd.z; d.windX = q * ax;
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
    if (C.multihull && !C.amas) {
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
      const q = 0.5 * RHO_W * V2 * area * Math.max(0, cphi) ** 1.5;   // the board comes out of the water as the boat lies over
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
      d.rudderX = rx; d.rudderY = rn * cphi; d.rudderStall = fc.stalled; d.rudderLoad = Math.abs(rn); d.rudderVent = vent;
      d.helmMoment = rn * F.chord * (F.transom ? 0.3 : 0.12); // tiller feel: an unbalanced transom rudder is heavy
    }
    {
      // a planing monohull rises onto its run and dries its forward sections. A multihull's slender,
      // round-bilged hulls (beam/length ~0.08) carry no planing surface: they stay displacement hulls, and
      // their residuary table (towing-tank C_R, which is referenced to the static wetted area) already
      // holds whatever sinkage and trim they take at speed
      const slender = C.multihull || C.amas;                             // (a trimaran's hulls are slender too)
      const planeLift = slender ? 0 : sstep(0.45, 0.95, Fn);
      const Swet = imm.girthLen * (1 - 0.3 * planeLift);                 // wetted surface of the real hull
      const Rf = 0.5 * RHO_W * Swet * uw * uw * cfITTC(uw, lwlDyn) * 1.08;
      // fore-aft crew weight: forward in light air (bury the bow, lift the transom), aft when planing
      const optTrim = lerp(-0.6, 0.8, sstep(0.3, 0.55, Fn));
      const trimPen = 1 + 0.09 * (this.crewX - optTrim) ** 2;
      const Rr = disp * G * interp(C.rr, Fn) * (C.multihull ? 1 + 0.3 * (1 - this.flyIn) : C.amas ? 1 : 1 + 0.5 * this.phi * this.phi) * trimPen;
      let Raw = 0;
      if (wv) {
        const enc = Math.max(0, -(fx * env.waves.comps[0].dx + fz * env.waves.comps[0].dz));
        Raw = 0.12 * RHO_W * G * (env.waves.Hs / 2) ** 2 * C.beam * (0.3 + enc) * clamp(Math.abs(uw) / 2, 0, 1);
      }
      // going astern the flat transom leads: separated flow, several times the forward drag
      const astern = uw < 0 ? 1 + 3.5 + 0.5 * RHO_W * uw * uw * C.beam * C.freeboard * 0.5 / Math.max(1, Rf + Rr) : 1;
      X -= (Rf + Rr + Raw) * Math.sign(uw) * astern;
      d.Rf = Rf; d.Rr = Rr; d.Raw = Raw;
      const H = C.hullLat;
      const cf = 0.5 * RHO_W * H.area * H.cd * vw * Math.abs(vw);
      Y -= cf; K -= cf * H.z;
      const T = C.canoeDraft, L = C.lwl;
      const N0 = N;
      N -= 0.5 * RHO_W * T * 0.9 * (L ** 4 / 32) * this.r * Math.abs(this.r);
      N -= 0.5 * RHO_W * T * L ** 3 * 0.03 * (Math.abs(uw) + 0.3) * this.r;
      if (!slender) N -= 0.011 * 0.5 * RHO_W * uw * Math.abs(uw) * L * L * T * Math.sin(this.phi);
      // hull drag acts where the immersed volume is: a multihull on its leeward hull wants to bear away
      if (imm.V > 1e-6) N += (Rf + Rr) * Math.sign(uw) * (imm.My / imm.V) * cphi * (slender ? 1 : 0.3);
      // Munk moment: a hull moving at a drift angle carries more fluid momentum sideways than lengthwise,
      // and the difference turns it broadside to the flow, N = -(m_y - m_x) u v (Kirchhoff; the added-mass
      // Coriolis term the surge and sway equations already carry, closed in yaw). With leeway it adds weather
      // helm; in a turn (bow inside the track) it tightens the turn. Water-relative velocities, as for the hull.
      const Nmunk = -(this.m22 - this.m11) * uw * vw * cphi;
      N += Nmunk; d.Nmunk = Nmunk;
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
    if (this.righting) {
      if (C.multihull) K -= (Math.sign(this.phi) || 1) * this.crewMass * G * (C.hullSpacing * 0.75) * Math.abs(cphi) ** 0.3; // hanging off the righting line
      else K += this.crewMass * G * (-(C.keel.span * clamp(ctrl.board, 0.3, 1) + C.canoeDraft + 0.2)) * sphi; // standing on the board tip
    } else K += this.crewMass * G * (this.crewY * cphi + C.crewZ * sphi);
    // Froude-Krylov wave forces on the immersed volume (surfing, wave roll/yaw)
    d.fkX = wv ? RHO_W * G * imm.FKx : 0;
    if (wv) { X += RHO_W * G * imm.FKx; Y += RHO_W * G * imm.FKy * cphi; N += RHO_W * G * imm.FKn * cphi; }
    d.Fb = Fb;

    // ---- mast in the water: a sealed spar floats, which is what holds a capsized boat on its side ----
    {
      const r0 = C.mastR ?? (C.id === 'dinghy' ? 0.032 : C.id === 'sportboat' ? 0.05 : 0.055);
      const base = C.boomZ - 0.8, L = C.mastHeight - base, nSeg = 6;
      for (let k = 0; k < nSeg; k++) {
        const zseg = base + (k + 0.5) * L / nSeg;
        const hW = zseg * cphi + heaveH - waveH;
        if (hW >= 0) continue;
        const Fb = RHO_W * G * Math.PI * r0 * r0 * 1.25 * (L / nSeg) * 0.85; // pear section, 85% sealed
        K -= Fb * zseg * sphi;                                   // lifts the side the mast has fallen to
        this._cRollWet += 0.5 * RHO_W * 1.0 * 2 * r0 * (L / nSeg) * Math.abs(this.p * zseg) * zseg * zseg;
      }
    }
    // capsized is a state you are in, not a script: past ~75 degrees on a boat that can capsize
    this.capsized = !!(C.canCapsize && Math.abs(this.phi) > 75 * DEG);
    if (this.righting && Math.abs(this.phi) < 20 * DEG) this.righting = false;

    // ---- integrate rigid body ----
    const m11 = this.m11, m22 = this.m22;
    let du = (X + m22 * this.v * this.r) / m11;
    let dv = (Y - m11 * this.u * this.r) / m22;
    let dr = N / this.Izz;
    const dp = K / this.Ixx;
    this._rdot = dr;
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;
    if (this._wD11 > 0) { // backward Euler for the wet-rig drag: (M + dt D) [v r]' = M [v r]  (D is symmetric, >= 0)
      const a11 = m22 + dt * this._wD11, a12 = dt * this._wD12, a22 = this.Izz + dt * this._wD22;
      const b1 = m22 * this.v, b2 = this.Izz * this.r, det = a11 * a22 - a12 * a12;
      this.v = (b1 * a22 - a12 * b2) / det; this.r = (a11 * b2 - a12 * b1) / det;
    }
    // explicit roll, then the stiff water damping of a wet rig implicitly (unconditionally stable)
    this.p = (this.p + dp * dt) / (1 + (this._cRollWet || 0) * dt / this.Ixx);
    // guards: a numerical blow-up must never take the game down
    this.p = clamp(this.p, -8, 8); this.r = clamp(this.r, -4, 4); this.v = clamp(this.v, -15, 15); this.u = clamp(this.u, -8, 30);
    for (const k of ['u', 'v', 'r', 'p', 'phi', 'heave', 'heaveV', 'pitch', 'pitchV']) if (!isFinite(this[k])) this[k] = 0;
    this.phi += this.p * dt;
    this.psi = wrap(this.psi + this.r * dt);
    this.x += (this.u * fx + this.v * sx + cur.x) * dt;
    this.z += (this.u * fz + this.v * sz + cur.z) * dt;
    this.log += Math.abs(this.u) * dt;
    // a bow driven under keeps going: past what this pitch model can represent, the boat trips over
    // sideways (how a multihull pitchpole usually ends) — the angular momentum goes into roll
    if (this.pitch <= -0.59 && this.pitchV < 0) { this.p += (Math.sign(this.phi) || 1) * Math.abs(this.pitchV) * 1.5; this.pitchV *= -0.2; }
    if (this.phi > Math.PI) this.phi -= 2 * Math.PI; if (this.phi < -Math.PI) this.phi += 2 * Math.PI;

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
      const Mc = this.crewMass * G * lim;
      const ff = 0.8 * (this._sailKf || 0) / Mc;
      // PD gains from the roll inertia the crew's weight has to steer: a ~2.5 rad/s, well-damped loop.
      // Fixed gains made the light boats' loop faster than a sailor can cross the boat (hikeRate): the crew
      // lagged the heel, the lag turned into a self-excited ±50° roll that pumped the rig downwind.
      const wn = 2.5, kp = this.Ixx * wn * wn / Mc, kd = 2 * 0.9 * wn * this.Ixx / Mc;
      const cmd = clamp(err * kp + this.p * kd + this._hikeI + ff, -1, 1);
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
      // added mass and radiation damping exist only for the part of the hull that is in the water:
      // a hull that leaves the water free-falls (dropping off a wave)
      const imf = clamp(imm.V / Math.max(1e-6, this.hydro.restV), 0, 1.5);
      const mEff = disp * (1 + 0.8 * Math.min(1, imf));
      const cz = 2 * 0.35 * Math.sqrt(kz * this.m33) * Math.min(1, imf);
      // relative to the water surface moving under the hull (wave vertical velocity)
      const wz = wv ? (wv.vy || 0) : 0;
      this.heaveV += (Fz - cz * (this.heaveV - wz)) / mEff * dt;
      this.heave += this.heaveV * dt;
      const crewXm = this.crewX * 0.8 + (C.crewX0 ?? 0);
      let My = RHO_W * G * imm.Mx - W * this.xG - this.crewMass * G * crewXm;
      // bow driven under: green water on the foredeck pushes it down (moment = x * Fz)
      if (imm.deckSub > 0 && uw > 0) { const Fz = -0.5 * RHO_W * uw * uw * C.beam * 0.4 * imm.deckSub; My += C.bowX * 0.6 * Fz; X -= 0.5 * RHO_W * uw * uw * C.beam * 0.15 * imm.deckSub; }
      My -= sailX * (C.boomZ + 2.3);                                            // drive high, drag low: bow down
      My += (this.u > 0 ? 1 : 0) * 0.5 * RHO_W * uw * uw * C.beam * C.lwl * 0.004 * sstep(0.35, 0.6, Fn); // bow lift near planing
      const kp = RHO_W * G * this.Awp * C.lwl * C.lwl / 16;
      const cp2 = 2 * 0.3 * Math.sqrt(kp * this.Iyy) * Math.min(1, imf);
      const IyyEff = this.Iyy * (0.6 + 0.4 * Math.min(1, imf));
      this.pitchV += (My - cp2 * this.pitchV) / IyyEff * dt;
      this.pitch = clamp(this.pitch + this.pitchV * dt, -0.6, 0.6);
      if (!isFinite(this.heave) || !isFinite(this.heaveV)) { this.heave = 0; this.heaveV = 0; }
      if (!isFinite(this.pitch) || !isFinite(this.pitchV)) { this.pitch = 0; this.pitchV = 0; }
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
    d.aws = hyp(amx, amy); d.awa = Math.atan2(-amy, -amx);
    const tx = amx + this.u, ty = amy + this.v;
    d.twsInst = hyp(tx, ty) / pmh;
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
  const clothMain = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('main');
  if (full) {
    // (a cloth main: the outhaul lets the clew forward along the boom; off the wind it goes all the way off for
    // the deepest foot, as crews do)
    c.outhaul = lerp(c.outhaul, lerp(clothMain ? 0 : 0.25, lerp(0.35, 1, flat), upwind), k);
    c.cunn = lerp(c.cunn, lerp(0, flat, upwind), k);
    if (C.hasBackstay) c.backstay = lerp(c.backstay, lerp(0.05, lerp(0.15, 1, flat), upwind), k);
    const twTop = clothMain && boat.sailBy.main.trav && d.shape.main ? d.shape.main[2].tw : null;
    if (clothMain && upwind > 0.5 && Number.isFinite(twTop)) {
      // a cloth main on a traveller upwind: the vang (with the sheet) sets the leech twist to the sailmaker's target,
      // about 11 degrees at the top batten, more when overpowered to spill wind from the head (as crews set it by
      // eye: the speed barely changes with it, the look of the sail does). (The una-rig dinghy's vang is its leech
      // and mast-bend control in one: it keeps its rule, which is also its fastest.)
      c.vang = clamp(c.vang + clamp(twTop - (11 + 8 * over) * DEG, -0.1, 0.1) * k * 1.5, 0, 1);
    } else {
      // (off the wind the vang holds the leech: a cloth main twists off as far as its vang lets it, so it goes on
      // harder than the strip model's twist rule needed)
      c.vang = lerp(c.vang, upwind > 0.5 ? (C.id === 'dinghy' ? lerp(0.15, 0.95, flat) : lerp(0.05, 0.7, flat)) : clothMain ? lerp(0.7, 0.85, power) : lerp(0.35, 0.55, power), k);
    }
    const clothJib = boat.sailBy.jib && boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('jib') && boat.genDeploy < 0.5;
    if (clothJib) {
      // a cloth jib: the car goes where the luff breaks evenly, top and bottom (the telltales): forward while the
      // foot meets the wind at a larger angle than the head (the leech is open, the foot pulled flat), aft while
      // the head meets it at more; a little further aft when overpowered, to twist the head off
      const st = d.strips.jib, sd = st.side || Math.sign(boat.side.jib) || 1;
      if (st[0].state && st[2].state) {
        const diff = clamp(((st[0].alpha || 0) - (st[2].alpha || 0)) * sd, -0.3, 0.3) + over * 0.05;
        c.jibLead = clamp(c.jibLead - diff * k * 0.6, 0, 1);
      }
    } else c.jibLead = lerp(c.jibLead, lerp(0.4, 0.85, flat) * upwind + 0.55 * (1 - upwind), k);
    c.jibHalyard = lerp(c.jibHalyard, lerp(0.3, 0.9, flat), k);
    c.tackLine = lerp(c.tackLine, lerp(0.15, 0.7, sstep(110 * DEG, 150 * DEG, awa)), k);
    if (C.hasBoard) c.board = lerp(c.board, lerp(0.3, 1, upwind), k);
  }
  // slow and pinching (mid-tack or stalled head to wind): ease the main so the bow can fall off
  const pinched = awa < 32 * DEG && boat.u < 1.3;
  // tacking: keep the old jib sheet made fast until the bow is through the wind (a long-keeler needs the
  // backed jib to push the bow round), then let it fly; the new sheet is tailed in below
  let letFly = false;
  if (boat.sailBy.jib && boat.genDeploy < 0.5 && !boat.backedByLazy) {
    const js = Math.sign(boat.side.jib) || 1, wantSide = -Math.sign(d.awaMid ?? 0) || js;
    const hold = (C.id === 'blackwatch' ? 20 : 7) * DEG;
    if (wantSide !== js && awa > hold && awa < 160 * DEG) letFly = true;
  }
  if (!boat.backedByLazy) c.lazy = 1;
  if (boat.locks) for (const k in boat.locks) boat.locks[k] = true;   // automatic mode keeps every line cleated
  const sh = d.shape;
  const tt = boat._tt || (boat._tt = { over: 0 });
  tt.over = lerp(tt.over, over, clamp(dt * 2, 0, 1));
  for (const s of C.sails) {
    if (s.kind === 'spin' && boat.genDeploy < 0.5) continue;
    if (s.kind === 'loose' && boat.genDeploy >= 0.5) continue;
    let midTw = sh[s.key] ? sh[s.key][1].tw : 0;
    if (boat.sailSys && boat.sailSys.owns && boat.sailSys.owns(s.key)) {
      // (a cloth sail's measured twist breathes and, flogging, jumps about: the crew goes by its trend)
      const tf = boat._twf || (boat._twf = {});
      tf[s.key] = lerp(tf[s.key] ?? midTw, clamp(midTw, -5 * DEG, 25 * DEG), clamp(dt * 2, 0, 1));
      midTw = tf[s.key];
    }
    // the crew trims to the telltales, i.e. to the angle the sail actually meets: the lattice models report
    // how far the flow at the sail is turned from the apparent wind (downwash, the other sail's up/downwash)
    // as aInd; the strip model only knows the headsail's downwash on the main
    const aInd = d.strips[s.key] ? d.strips[s.key].aInd : undefined;
    let aT;
    if (s.key === 'main') aT = (15 + aoaBias) * DEG - over * 7 * DEG + (aInd ?? 0.055 * boat._clHead);
    else if (s.kind === 'spin') aT = (21 + aoaBias) * DEG + (aInd ?? 0);
    else aT = (13 + aoaBias) * DEG - over * 3 * DEG + (aInd ?? 0);
    const want = awa - aT - midTw;
    // A cloth sail goes where the wind and its sheet put it, not where the sheet's length says, and the lattice
    // gives each strip the angle it really meets: the crew trims by the telltales, easing while the sail
    // meets the wind at more than the angle it wants, hauling in while less (attached strips only: a stalled
    // strip's angle says nothing about the trim)
    const owned = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns(s.key);
    if (owned && !(s.kind === 'loose' && (letFly || boat.backedByLazy))) {
      const key = s.kind === 'boom' ? s.key : 'jib', st = d.strips[s.key];
      // (overpowered, a cloth sail is let out further than the strip model's rule: a sail at a small angle still
      // pulls hard off its camber, so the crew eases it toward luffing)
      const aim = aT - (aInd ?? 0) - over * (s.key === 'main' ? 7 : 3) * DEG;
      // (the lattice's angles are signed across the boat: to leeward positive, a backed or luffing strip negative)
      // (the sign is the leeward side, where the wind should push the sail: not the side its boom or clew is on
      // (a traveller pulled to windward puts the boom past the centreline while the sail still draws), nor the
      // side its camber is on (a backwinded main's luff turns inside out, and read by its camber it would be
      // hauled in harder); running, by the lee, the side the sail is on)
      const sd = (awa < 150 * DEG ? -Math.sign(d.awaMid) : 0) || st.side || Math.sign(st.baseAngle || (s.kind === 'boom' ? boat.booms[s.key].a : boat.side.jib)) || 1;
      let a = 0; for (let i = 0; i < 3; i++) a += clamp((st[i].alpha || 0) * sd, -0.3, 0.6) * STRIP_W[i];
      if (s.key === 'main' && s.trav) {
        const sheetEase = clamp(0.06 + 0.25 * flat * upwind + (1 - upwind) * 0.3, 0, 1);
        c.trav = lerp(c.trav, clamp((want - sheetEase * (s.max - s.trav[1]) - s.trav[0]) / (s.trav[1] - s.trav[0]), 0, 1), k * 2);
      }
      // overpowered (heeled past the target): whatever the telltales say, the crew eases, the main most, in
      // proportion to the heel smoothed over half a second (an ease that integrated the heel would pump the boat
      // in a roll cycle)
      const ease0 = tt[key] ?? 0;
      tt[key] = clamp(tt.over, 0, 1.5) * (s.key === 'main' ? 0.25 : 0.1);
      // (pinched, the main is eased to let the bow fall off: for a cloth main only when really stopped head to
      // wind, since in light air a slow boat sails close-hauled at these angles and an eased main just stops it)
      const pinchedC = awa < 28 * DEG && boat.u < 0.7;
      c[key] = clamp((c[key] ?? 0.3) + clamp(a - aim, -0.3, 0.3) / (s.max - s.min) * k * 0.4 + (tt[key] - ease0), pinchedC && s.key === 'main' ? 0.35 : 0, 1);
      continue;
    }
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
      if (key === 'jib' && s.kind === 'loose' && letFly) { c.jib = 1; continue; }
      if (key === 'jib' && s.kind === 'loose' && boat.backedByLazy) continue; // hove-to on purpose: leave it
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

// For cloth sails the polar is the one baked offline from the cloth model itself (js/sail/surrogate.js); what is
// simulated here, at 50 Hz, is the strip model (the fallback sails, level L2)
export function solvePolarAngle(C, twsMS, twaDeg, opts = {}) {
  const model = opts.sailModel ?? sailHooks.defaultModel ?? 'strip';
  if (model !== 'strip' && sailHooks.polarAngle) { const r = sailHooks.polarAngle(C, twsMS, twaDeg); if (r) return r; }
  opts = { ...opts, sailModel: 'strip' };
  const env = makeSteadyEnv(twsMS);
  const dt = 1 / 50;
  let best = { twa: twaDeg, bsp: 0, vmg: 0 };
  const genOpts = C.sails.some(s => s.kind === 'spin') && twaDeg >= 85 ? [false, true] : [false];
  for (const gen of genOpts) for (const bias of [-4, 0, 4]) {
    const b = new Boat(C, opts);
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
export function solvePolar(cls, twsMS, angles = POLAR_TWAS, opts = {}) {
  const C = typeof cls === 'string' ? CLASSES[cls] : cls;
  return angles.map(a => solvePolarAngle(C, twsMS, a, opts));
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
