// The standing rig as a structure: the mast a beam-column on its step, held by its wires and spreaders, loaded by the
// sails through their luffs, heads, tacks and booms, by the halyards, the vang, the trapeze and its own weight and
// inertia. Solved quasi-statically a few times a second (a small finite-element model: ~12-16 mast nodes with five
// degrees of freedom each, spreader tips, a bowsprit end or a bridle apex), it gives the mast's bend fore-and-aft and
// sideways, the forestay's sag, and the load in every wire, at the step and at every chainplate.
//
//  * Mast: Euler-Bernoulli beam elements (Hermite, bending in both planes, axial) with the section's EI and EA from the
//    real spar (elliptical thin-walled tube or round tube: I = pi/4 t a^2 (a + 3b) about the minor axis), and the
//    geometric stiffness of its compression (P-delta: bend grows as 1/(1 - P/Pcr), and a column past its critical load
//    has no stiffness left: reported as buckled). A rotating mast (Hobie) turns its section with it.
//  * Wires: 1x19 stainless (EA = 125 GPa x 0.76 of the nominal area, breaking load ~800 d^2 N, d in mm), tension only,
//    large-displacement truss elements with geometric stiffness T/L; pre-tension is a rest length found at the dock so
//    that each wire carries its tune; the backstay adjuster shortens the backstay.
//  * Forestays carry the headsail's luff load: a taut string under the hanks' point loads, sag d(s) = M(s)/T (the
//    small-sag catenary), the arc length the sag adds (1/2 int d'^2) in the wire's strain, so the tension-sag
//    equilibrium is exact to second order and the stay's tangent stiffness is Ernst's equivalent modulus.
//  * Spreaders: struts built into the mast (axial EA/L, bending 3 EI/L^3 at the tip), carried by the mast's rotation.
//  * Supports: a deck-stepped mast is pinned on its step; the Laser's in its deck tube (heel and collar); the Hobie's
//    on its ball. A bowsprit is a cantilever from the stem held by its bobstay and whisker stays.
//  * Loads from a cloth sail are the reactions of its pinned luff, head and tack nodes (the membrane's stretch forces on
//    them, and the lattice's leading-edge suction), and from the boom the pull of every line on it plus the clew,
//    through the gooseneck (the vang and topping lift pull back where they end on the mast). The strip model's sails
//    are spread onto the luff and stay by the membrane's statics (half the normal load to the luff).
// Outputs: boat.rigLoads (N, for the damage model), boat.rigSpec (breaking loads), diag.rig (bend, sag, rotation),
// and the solved shapes the sails' luffs follow (luffAt / stayAt).
import { linesFor } from './hull.js';
import { G } from './env.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const DEG = Math.PI / 180;

// E (Pa), density (kg/m^3), allowable stress (Pa: yield for alloys, compressive allowable for the laminate)
export const SPAR_MATERIALS = {
  // (6061-T6: typical yield 276 MPa (ASM), the design minimum 241: a simulated spar is a typical one, not the code's worst)
  alu6061: { E: 70e9, rho: 2700, sy: 276e6 },
  alu7075: { E: 71.7e9, rho: 2810, sy: 480e6 },
  carbon: { E: 115e9, rho: 1550, sy: 500e6 },
  spruce: { E: 10e9, rho: 450, sy: 40e6 },
  teak: { E: 12e9, rho: 650, sy: 50e6 },
};
// 1x19 316 stainless: metallic area 0.76 of the nominal circle, effective modulus 125 GPa, breaking load ~800 d^2 N
// (manufacturers' tables: 4 mm 12.7 kN, 5 mm 20.1 kN, 6 mm 28.7 kN, 8 mm 51 kN)
export const wireEA = (d) => 125e9 * 0.76 * Math.PI * (d * 1e-3) ** 2 / 4;
export const wireBreak = (d) => 800 * d * d;
// Other standing rigging, by the diameter of its load-bearing section (a wire's 'mat'): Nitronic 50 rod (solid,
// E ~195 GPa, cold-drawn UTS ~1170 MPa: Navtec / Carbo-Link rod tables) and carbon cable (a bundle of unidirectional
// pultruded rods in a jacket: Future Fibres ECsix, Carbo-Link; E ~150 GPa effective and ~1750 MPa breaking on the
// fibre's section, est. from the makers' sizing by stiffness, which leaves ~3x on the break)
export const WIRE_MATS = {
  rod: { EA: (d) => 195e9 * Math.PI * (d * 1e-3) ** 2 / 4, brk: (d) => 1170e6 * Math.PI * (d * 1e-3) ** 2 / 4 },
  carbon: { EA: (d) => 150e9 * Math.PI * (d * 1e-3) ** 2 / 4, brk: (d) => 1750e6 * Math.PI * (d * 1e-3) ** 2 / 4 },
};

// thin-walled section: elliptical tube a (fore-aft) x b (athwartships) outer dimensions, wall t; or round (dia)
export function section(s) {
  const M = SPAR_MATERIALS[s.mat || 'alu6061'];
  const a = (s.a ?? s.dia) / 2 - (s.t / 2), b = (s.b ?? s.dia) / 2 - (s.t / 2), t = s.t;
  const Ix = Math.PI / 4 * t * a * a * (a + 3 * b);            // bending fore-and-aft (about the athwartships axis)
  const Iy = Math.PI / 4 * t * b * b * (b + 3 * a);            // sideways
  const per = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const A = per * t;
  return { EIx: M.E * Ix, EIy: M.E * Iy, EA: M.E * A, m: M.rho * A * (s.fill ?? 1.15), Zx: Ix / (a + t / 2), Zy: Iy / (b + t / 2), A, sy: M.sy };
}

// ---------------------------------------------------------------------------------------------------------------
// Per-class rigs. Heights above the waterline, x from the centre of gravity (as CLASSES). 'est.' = estimated from
// photos, sail plans and spar makers' sections of that size; the rest from class rules and builders' data.
export const RIG_DATA = {
  // J/70: deck-stepped tapered carbon mast (Southern Spars), one pair of swept spreaders 4.97 m up, cap shrouds over
  // them to the hounds, lowers to the spreader root, forestay to the hounds (fractional), adjustable backstay from the
  // masthead crane (8:1 cascade + fine tune: ~80 mm of stay). Section est. 125 x 80 mm, 3 mm wall (~15 kg with fittings), tapering above the
  // hounds; 4.8 mm caps and lowers, a 5 mm forestay (est.; as js/damage.js's class data). Dock tune ~ North Sails' base setting order (caps ~10% of
  // break, lowers slacker).
  sportboat: {
    step: { type: 'deck', z: 0.95 },
    spans: [{ z0: 0.95, z1: 8.9, a: 0.125, b: 0.08, t: 0.003, mat: 'carbon' }, { z0: 8.9, z1: 10.0, a: 0.09, b: 0.06, t: 0.0022, mat: 'carbon' }],
    spreaders: [{ z: 4.97, len: 0.78, sweep: 0.27, EA: 1.5e7, EI: 3000 }],
    chainX: -0.45, chainIn: 0.93,
    wires: [
      // (4.8 mm, 3/16 in, est.: on 4 mm the solver's caps and lowers came to 2.0-2.3 x their load at RM30)
      { key: 'capShroud', to: 'hounds', via: 0, d: 4.8, pre: 1600 },
      { key: 'lowerShroud', to: 4.97, dx: 0.08, d: 4.8, pre: 700 },
      // (5 mm, est.: on 4 mm the solver's forestay carried 9.6 kN at the righting moment of 30 deg, 1.3 x on its break)
      { key: 'forestay', stay: 'jib', d: 5 },
      { key: 'backstay', to: 'top', off: -0.22, low: 'transom', d: 5, pre: 350, adjust: 0.12 },
    ],
    prebend: 0.015, lineMax: 3000,
  },
  // Blackwatch 19: aluminium mast deck-stepped on the cabin top (compression post), one spreader set at mid-height,
  // cap shrouds to the hounds, forward and aft lowers, forestay to the teak bowsprit's end, inner forestay for the
  // staysail, a backstay with a small adjuster; the bowsprit held down by its bobstay and sideways by whisker stays.
  // Section est. 105 x 70 x 3.0 mm (a 1970s section for a 20 ft cruiser); 5 mm wire, 6 mm bobstay (est.)
  blackwatch: {
    step: { type: 'deck', z: 1.15 },
    // (3.0 mm wall, est.: on 2.4 mm the solver's critical load was 1.75 x the mast's compression at the righting moment of
    // 30 deg, and it buckled close-hauled in 35 kn)
    spans: [{ z0: 1.15, z1: 8.4, a: 0.105, b: 0.07, t: 0.003, mat: 'alu6061' }],
    spreaders: [{ z: 4.75, len: 0.82, sweep: 0.15, EA: 1.2e7, EI: 1500 }],
    chainX: -0.1, chainIn: 0.93,
    wires: [
      { key: 'capShroud', to: 'hounds', via: 0, d: 5, pre: 1800 },
      { key: 'lowerFwd', to: 4.75, dx: 0.3, d: 5, pre: 800 },
      { key: 'lowerAft', to: 4.75, dx: -0.3, d: 5, pre: 800 },
      { key: 'forestay', stay: 'jib', d: 5 },
      { key: 'innerForestay', stay: 'stay', d: 4, pre: 500 },
      { key: 'backstay', to: 'top', off: -0.05, low: 'transom', d: 4, pre: 1000, adjust: 0.008 },
      { key: 'bobstay', sprit: true, low: 'stem', d: 6 },
      { key: 'whisker', sprit: true, low: 'whisker', d: 4, pre: 300 },
    ],
    sprit: { mat: 'teak', w: 0.2, h: 0.08 },
    houndsZ: 8.15,
    prebend: 0.01, lineMax: 1800,
  },
  // Laser / ILCA 7: unstayed two-piece aluminium mast in a deck tube. Class: bottom section 2865 mm x 63.5 mm, top
  // section 3600 mm x 50.8 mm (walls est. 2.2 / 1.85 mm: below), heel 355 mm below the deck; the top
  // section slides ~0.27 m into the bottom one at the sleeve. The sail's luff sleeve wraps the mast.
  dinghy: {
    step: { type: 'tube', z: 0.05, collar: 0.41 },
    // (walls 2.2 / 1.85 mm, est. No class or builder figure is published that I could find. Sailors put the aluminium top
    // section at 2.6-3.1 kg, a 1.7-2.0 mm wall where the earlier estimate had 1.55 mm (2.4 kg); the bottom section scaled
    // by the same 1.19. At 1.8 mm the bottom's first yield, 1.57 kN m, was less than a Laser stopped with her sail aback in
    // an 18 kn sea breeze's gusts puts on it (a 0.7 kN sail force, 1.26 kN m of heel and its fore-and-aft part): her
    // bottom section parted in the sea trials, which real ones do not)
    spans: [{ z0: 0.05, z1: 2.645, dia: 0.0635, t: 0.0022, mat: 'alu6061' },
      { z0: 2.645, z1: 2.915, dia: 0.0635, t: 0.0022, mat: 'alu6061', plus: { dia: 0.0508, t: 0.00185 } },
      { z0: 2.915, z1: 6.24, dia: 0.0508, t: 0.00185, mat: 'alu6061' }],
    // (the vang's most: a 15:1 cascade, ~70% efficient, hauled with ~130 N by a sailor sitting out: ~1.4 kN, est. At 2.5 kN
    // the leech's pull bowed the top section a metre and more aft, which a Laser's does not do)
    spreaders: [], wires: [], prebend: 0, lineMax: 1400, noHalyard: true,
  },
  // Optimist: IODA rules: mast approximately circular, 45 mm; a sprit of 27.5 +/- 2 mm, at most 2286 mm; stepped on the
  // hull bottom and held by the mast thwart at the gunwale (the mast 7 ft 5 in above its step). Selden's class masts
  // are 7075-T6, 45 mm, in two wall thicknesses (a thinner 'Flex' for lighter sailors); wall est. 1.6 mm (~2 kg rigged).
  optimist: {
    step: { type: 'tube', z: 0.1, collar: 0.42 },
    spans: [{ z0: 0.1, z1: 2.36, dia: 0.045, t: 0.0016, mat: 'alu7075' }],
    spreaders: [], wires: [], prebend: 0, lineMax: 625, noHalyard: true,
  },
  // Sunfish: one-piece 6061-T6 mast, 10 ft x 2-1/4 in OD x 0.083 in wall (57.15 x 2.11 mm), in a deck tube down to the
  // hull bottom; the yard and boom 1-1/2 in x 0.065 in (38.1 x 1.65 mm). The lateen hangs from the masthead on its
  // halyard and from the gooseneck on the boom: the mast carries no luff.
  sunfish: {
    step: { type: 'tube', z: 0.04, collar: 0.34 },
    spans: [{ z0: 0.04, z1: 3.05, dia: 0.05715, t: 0.00211, mat: 'alu6061' }],
    spreaders: [], wires: [], prebend: 0, lineMax: 950, noHalyard: true,
  },
  // Hobie 16: rotating aluminium wing mast (8.07 m) on a ball on the front beam, side stays to the hulls, forestay to
  // the bridle from the bows, diamond wires over a pair of diamond spreaders, trapezes from the hounds; the mast
  // rotation limiter stops it ~60 deg each side (est.). Section est. 140 x 80 mm, 1.9 mm wall; 3/16 in (4.8 mm) stays, 3 mm diamonds.
  cat: {
    step: { type: 'ball', z: 0.53 },
    spans: [{ z0: 0.53, z1: 8.6, a: 0.14, b: 0.08, t: 0.0019, mat: 'alu6061' }],
    spreaders: [{ z: 3.9, len: 0.33, sweep: 0, EA: 1e7, EI: 800, diamond: true }],
    chainX: -0.12,
    wires: [
      { key: 'capShroud', to: 'hounds', d: 4.8, pre: 500 },
      { key: 'diamond', diamond: [6.4, 1.5], via: 0, d: 3, pre: 1200 },
      { key: 'forestay', stay: 'jib', d: 4.8 },
      { key: 'bridle', bridle: true, d: 4 },
    ],
    rotating: { limit: 60 * DEG, track: 0.05 },
    trapeze: true,
    houndsZ: 6.58,
    prebend: 0.01, lineMax: 1800,
  },
};

// Star (Star class rules; spar est.): a tapered aluminium mast, famously bendy, stepped on deck; one set of spreaders,
// uppers to the hounds and lowers, the forestay to the hounds, no backstay: running backstays from the hounds to the
// quarters (the windward one set up, the leeward one off). Section est. 100 x 76 mm, 3.6 mm wall, tapering above the
// hounds; 5 mm caps, 4.5 mm lowers, 3.5 mm runners. Its bend (the class's main depth control) comes from the runners, the vang and the
// leech.
RIG_DATA.star = {
  step: { type: 'deck', z: 0.42 },
  spans: [{ z0: 0.42, z1: 7.66, a: 0.1, b: 0.076, t: 0.0036, mat: 'alu6061' }, { z0: 7.66, z1: 9.95, a: 0.066, b: 0.054, t: 0.0018, mat: 'alu6061' }],
  spreaders: [{ z: 4.2, len: 0.5, sweep: 0.15, EA: 1e7, EI: 800 }],
  chainX: -0.15, chainIn: 0.93,
  wires: [
    // (5 mm caps, 4.5 mm lowers, a 3.6 mm wall low down, est.: on 4 / 3.5 mm and 2.4 mm the solver's caps and lowers came to
    // 1.7 x their load at the righting moment of 30 deg, the mast's critical load 1.3 x its compression)
    { key: 'capShroud', to: 'hounds', via: 0, d: 5, pre: 800 },
    // (the lowers led well aft of the mast: they hold its middle back, the Star's control of its bend low down)
    { key: 'lowerShroud', to: 4.2, dx: -0.35, d: 4.5, pre: 500 },
    { key: 'forestay', stay: 'jib', d: 4 },
    { key: 'runner', to: 'hounds', runner: true, d: 3.5, pre: 700 },
    // (the checkstays, from the quarters to the mast a little above the spreaders, the windward one set up with its runner:
    // they hold the middle of the bendy spar back against the forestay's and the leech's pull, as on every Star; without
    // them the solver's mast stood at 1.2 x its critical load sailing at the righting moment of 30 deg)
    { key: 'checkstay', to: 5.2, runner: true, d: 3.5, pre: 800 },
  ],
  houndsZ: 7.66, prebend: 0.03, lineMax: 2400,
};
// The Mariner's trimaran (a 60 ft racing trimaran's rig, est.): a rotating aluminium wing mast (0.9 m chord) on a ball
// in its tabernacle, turned by the luff up to its limiter as the Hobie's is; shrouds to the floats at the forward
// beam, runners to the floats aft, diamonds over spreaders at mid-height, the forestay to the bow. 16 mm caps, 10 mm
// runners, 8 mm diamonds.
RIG_DATA.mariner = {
  step: { type: 'ball', z: 1.6 },
  spans: [{ z0: 1.6, z1: 27.3, a: 0.9, b: 0.32, t: 0.007, mat: 'alu6061' }],
  spreaders: [{ z: 13.2, len: 1.1, sweep: 0.1, EA: 5e7, EI: 2e5, diamond: true }],
  wires: [
    // (16 mm caps, est.: a trimaran's righting moment is her weight over the float's offset, ~6000 kg x 6.7 m, ~0.4 MN m, twice
    // the rule's 30 deg figure; on 12 mm the caps parted reaching in 20 kn, the float flying)
    { key: 'capShroud', to: 'hounds', at: [2.9, 6.7, 1.7], d: 16, pre: 9000 },
    { key: 'runner', to: 'hounds', at: [-3.6, 6.7, 1.7], runner: true, d: 10, pre: 6000 },
    { key: 'diamond', diamond: [24.0, 2.8], via: 0, d: 8, pre: 5000 },
    { key: 'forestay', stay: 'jib', d: 12 },
  ],
  rotating: { limit: 45 * DEG, track: 0.05 },
  houndsZ: 24.7, prebend: 0.03, lineMax: 22000,
};

// A rig for a class with no entry, sized as a rig designer would from its righting moment at 30 deg (Nordic Boat
// Standard / Skene order): cap shroud breaking load ~2.8 RM30 / chainplate half-beam, lowers 0.85 of its size, dock
// tune ~12% of break; the mast (aluminium, an ellipse 1.55:1, wall 1/45 of the chord) stiff enough that its compression
// (twice the shroud load RM30 / half-beam, plus the tune) is a third of the Euler load of its longest panel; one
// spreader set under 13 m of mast, two above; keel-stepped over 9 m LOA, masthead or fractional as the jib's head says.
// What the class's drawing (C.model.masts.main: its radius, round or not, material, spreaders as fractions of the mast
// above the deck, shrouds: false for an unstayed spar) says is used; the rest is sized.
// The generic rigs as checked on this solver, sailing (tools/size-rigs.mjs): the rule of thumb's sizes do not see how a
// rig shares its load (swept spreaders put the forestay's pull in the caps; the mast's whole column bows on stretching
// stays where the rule sees panels between rigid supports), so each class's caps, lowers (a side's together) and
// forestay are scaled to ~2.8 x their load sailing upwind at the righting moment of 30 deg, and its mast's stiffness to
// a critical load ~2.7 x its compression there. Factors on the breaking load (wire area) and on EI.
export const GENERIC_K = {
  '470': {cap: 0.42, low: 0.44, ei: 1, fore: 1},
  folkboat: {cap: 0.66, low: 0.71, ei: 0.6, fore: 1},
  // (the J/24's stays one size up, 6.3 mm: on 5 mm her jib sagged a tenth past its cut (sagN 1.1) on the autopilot
  // in a 20 kn sea and she luffed off her reach, yaw 9 deg rms; at 6.3 mm, 0.85, as the Catalina 30's and Oceanis's)
  j24: {cap: 0.6, low: 0.45, ei: 1, fore: 1.59, foreSag: 1.59},
  j122: {cap: 1.43, low: 0.12, ei: 4.2, fore: 1},
  '49er': {cap: 0.1, low: 0.1, ei: 0.67, fore: 1},
  catalina22: {cap: 0.82, low: 0.48, ei: 1.44, fore: 1},
  catalina30: {cap: 0.7, low: 0.43, ei: 1, fore: 1},
  oceanis381: {cap: 0.82, low: 0.23, ei: 2.11, fore: 1},
  contessa32: {cap: 0.74, low: 0.43, ei: 1, fore: 1},
  westsail32: {cap: 0.77, low: 0.41, ei: 1, fore: 1},
  flyingscot: {cap: 0.67, low: 0.69, ei: 1, fore: 1},
  dragon: {cap: 1.14, low: 0.76, ei: 1.33, fore: 1},
  etchells: {cap: 0.97, low: 0.33, ei: 1, fore: 1},
  melges24: {cap: 1, low: 0.27, ei: 2.14, fore: 1},
  spray: {cap: 0.49, low: 0.4, ei: 1, fore: 1},
  joshua: {cap: 1.27, low: 0.43, ei: 3, fore: 1},
  america: {cap: 1.87, low: 0.47, ei: 0.45, fore: 1},
  shenandoah: {cap: 1.28, low: 0.2, ei: 0.2, fore: 1},
  joliebrise: {cap: 1.71, low: 0.37, ei: 1.18, fore: 1},
  suhaili: {cap: 0.78, low: 0.52, ei: 1.42, fore: 1},
  gipsymoth4: {cap: 1.88, low: 0.18, ei: 6.74, fore: 1},
  hydroptere: {cap: 1.5, low: 7.37, ei: 4.65, fore: 1},
};
// The righting moment a rig is designed to at 30 deg: the hull's (its GZ curve, as the physics has it: GM and the
// form's share) on the whole sailing displacement, plus the crew sitting out on the rail. (It was GM sin 30 x 0.8 on
// the displacement alone: no crew, which on a sportboat or a dinghy is half the righting moment or more, so that the
// generic rigs came out at 1.3-2.3 times their load where a designer works to ~2.5-3.5: a Melges 24's caps parted
// sailing upwind in 20 kn.)
export function rm30(C) {
  const crew = (C.crewN || 0) * (C.crewEach || 80), disp = C.massHull + crew, ph = 30 * DEG;
  const gm = C.gm ?? 1, bm = C.bmForm ?? 0, gz = (gm - bm) * Math.sin(ph) + bm * Math.sin(2 * ph) / 2;
  return disp * G * Math.max(0.05, gz) + (C.multihull ? 0 : crew * G * (C.crewMaxOut || 0) * Math.cos(ph));
}
// k: the sizing pass's corrections (GENERIC_K: tools/size-rigs.mjs): breaking-load factors on the caps, the lowers and
// the forestay and backstay (sized for the headsail's sag), and on the mast's stiffness
export function genericRig(C, k = GENERIC_K[C.id] || {}) {
  const crew = (C.crewN || 0) * (C.crewEach || 80), hb = C.beam / 2 * 0.9, kc = Math.sqrt(k.cap ?? 1), kl = Math.sqrt(k.low ?? 1), kf = Math.sqrt(k.fore ?? 1);
  const RM30 = rm30(C), Tsh = RM30 / hb;
  const d = clamp(Math.sqrt(2.8 * Tsh / 800), 3, 16);
  // (the fore-and-aft stays are sized for their stiffness, the headsail's sag, as they were when the classes' balance was
  // set: on the displacement's GM alone, without the crew. Sized on the whole RM30 with the shrouds, a Catalina 30's 8.5
  // mm forestay and backstay took a fifth off the jib's sag, and on the autopilot in a 20 kn sea she luffed into the wind
  // and stopped (test/seakeeping.mjs 4). The sizing (kf, tools/size-rigs.mjs) then sets them for the headsail's sag to
  // be what its luff was cut for, never under 2.2 x their load.)
  const dS = clamp(Math.sqrt(2.8 * (C.massHull + crew) * G * (C.gm || 1) * Math.sin(30 * DEG) * 0.8 / hb / 800), 3, 16);
  // (the drawing's description: C.model.masts.main for the detailed boats, or the race classes' own fields: mastR,
  // carbonMast, spreaders { n, sweep } with spreader (length), houndsF (the hounds' distance from the top, a fraction
  // of the mast), runners)
  const M0 = (C.model && C.model.masts && C.model.masts.main) || {};
  const deck0 = C.freeboard + (C.cabin ? 0.35 : 0.08), mastL0 = C.mastHeight - deck0;
  const MD = { ...M0, r: M0.r ?? C.mastR, mat: M0.mat ?? (C.carbonMast ? 'carbon' : undefined),
    hounds: M0.hounds ?? (C.houndsF ? C.mastHeight - C.houndsF * mastL0 : undefined) };
  if (!M0.spreaders && C.spreaders && C.spreaders.n) {
    const n = C.spreaders.n, L1 = C.spreader ?? C.beam * 0.36, hz = MD.hounds ?? C.mastHeight - 0.25;
    MD.spreaders = Array.from({ length: n }, (_, i) => ({ f: n === 1 ? 0.5 : ((deck0 + (hz - deck0) * (i + 1) / (n + 0.6)) - deck0) / mastL0, len: L1 * (1 - 0.28 * i), sweep: C.spreaders.sweep ?? 0 }));
  }
  const mat = MD.mat === 'wood' ? 'spruce' : MD.mat === 'carbon' || MD.mat === 'black' ? 'carbon' : 'alu6061';
  const deck = C.freeboard + (C.cabin ? 0.35 : 0.08);
  const unstayed = MD.shrouds === false || (!C.hasBackstay && !C.multihull && C.sails.length === 1 && C.massHull < 250 && !(MD.spreaders && MD.spreaders.length));
  if (unstayed) {
    // an unstayed spar in its deck tube (a Finn-like class without its own data; the Optimist and Sunfish have theirs): heel ~0.3 m under the deck, held at the deck; a tube
    // of the drawn radius with the wall that makes its tip bend ~L/12 under the sail's load at its centre of effort, and
    // holds ~3x the most the crew can hold up (a real dinghy spar's margin: the Optimist's, the Sunfish's ~3-4) at its yield
    const r = MD.r || 0.03, L = C.mastHeight - deck, F = 0.5 * 1.225 * 8 * 8 * C.sails[0].area * 1.1, zc = 0.45 * L;
    const EIneed = F * zc * zc * (3 * L - zc) / 6 / (L / 12);
    const RMx = (C.crewN || 1) * (C.crewEach || 80) * G * (C.crewMaxOut || 0.6) + C.massHull * G * (C.beam || 1) * 0.25;
    const t = clamp(Math.max(EIneed / (SPAR_MATERIALS[mat].E * Math.PI * r ** 3), 3 * RMx / (SPAR_MATERIALS[mat].sy * Math.PI * r * r)), r / 40, r / (mat === 'spruce' ? 1.5 : 8));
    return { step: { type: 'tube', z: Math.max(0.02, deck - 0.3), collar: deck }, spans: [{ z0: Math.max(0.02, deck - 0.3), z1: C.mastHeight, dia: 2 * r, t, mat }],
      spreaders: [], wires: [], prebend: 0, generic: true, lineMax: 2.5 * (C.sheetPower || 300), noHalyard: true };
  }
  const keelStep = C.loa > 9;
  const zStep = keelStep ? Math.max(-0.2, -0.5 * (C.canoeDraft || 0.4)) : deck, L = C.mastHeight - zStep;
  const drawn = MD.spreaders && MD.spreaders.length ? MD.spreaders : null;
  const nSpr = drawn ? drawn.length : L > 13 ? 2 : 1, panel = 1.1 * (C.mastHeight - deck) / (nSpr + 1);
  const Pd = 2 * Tsh + 0.3 * wireBreak(d), EIneed = (k.ei ?? 1) * 3 * Pd * panel * panel / (Math.PI ** 2);
  let A, B, T;
  if (MD.r) {
    // the drawn section (deeper fore-and-aft unless round), its wall what the Euler requirement asks (a solid wooden spar
    // at most)
    A = 2 * MD.r * (MD.round ? 1 : 1.25); B = 2 * MD.r;
    let lo = A / 120, hi = mat === 'spruce' ? A / 2.2 : A / 12;
    for (let k = 0; k < 40; k++) { const t = 0.5 * (lo + hi), sc = section({ a: A, b: B, t, mat }); if (Math.min(sc.EIx, sc.EIy) > EIneed) hi = t; else lo = t; }
    T = hi;
    // (a drawn spar that cannot carry its rig at its thickest wall is bigger than drawn: the section grows, its wall in
    // proportion, until it does. A mast that would buckle at the heel she sails at is no mast anyone stepped.)
    const sc0 = section({ a: A, b: B, t: T, mat }), short = EIneed / Math.min(sc0.EIx, sc0.EIy);
    if (short > 1.0001) { const g = Math.pow(short, 1 / 4); A *= g; B *= g; T *= g; }
  } else {
    let lo = 0.05, hi = 0.5;
    for (let k = 0; k < 40; k++) { const a = 0.5 * (lo + hi), sc = section({ a, b: a / 1.55, t: a / 45, mat }); if (Math.min(sc.EIx, sc.EIy) > EIneed) hi = a; else lo = a; }
    A = hi; B = A / 1.55; T = A / 45;
  }
  const spreaders = [];
  for (let k = 0; k < nSpr; k++) {
    const sd = drawn ? drawn[k] : null, z = deck + (C.mastHeight - deck) * (sd ? sd.f : (k + 1) / (nSpr + 1.3)), len = sd ? sd.len : C.beam * 0.36 / (1 + 0.4 * k);
    spreaders.push({ z, len, sweep: sd ? len * Math.sin(sd.sweep || 0) : 0.12, EA: 3e7, EI: 5e3 * (A / 0.1) ** 4 });
  }
  // (never under 2.5 mm: the smallest 1x19 a builder fits, a dinghy's margin is then its wire's size)
  const dc = Math.max(2.5, d * kc), dl = Math.max(2.5, d * 0.85 * kl);
  const wires = [
    { key: 'capShroud', to: 'hounds', via: 0, d: dc, pre: 0.12 * wireBreak(dc) },
    { key: 'lowerFwd', to: spreaders[0].z, dx: 0.3, d: dl, pre: 0.08 * wireBreak(dl) },
    { key: 'lowerAft', to: spreaders[0].z, dx: -0.3, d: dl, pre: 0.08 * wireBreak(dl) },
  ];
  // (a schooner's headsails are on the foremast's stays (s.stayTo): the mainmast is held forward by its spring stay,
  // from its hounds to the foremast's head, which is taken as fixed (the foremast as stiff as its own stays make it))
  const onMain = (k) => C.sails.some((s) => s.key === k && (!s.stayTo || s.stayTo === 'main'));
  if (onMain('jib')) wires.push({ key: 'forestay', stay: 'jib', d: Math.max(2.5, dS * kf) });
  if (onMain('stay')) wires.push({ key: 'innerForestay', stay: 'stay', d: dS * 0.85 });
  const fore = C.sails.find((s) => s.key === 'fore' && s.mast);
  if (fore && !onMain('jib')) {
    const zf = Math.min(fore.mast.h, MD.hounds ?? C.mastHeight - 0.5) - 0.3, xf = fore.tackX - (fore.mast.rake || 0) * (zf - fore.tackZ) / (fore.mast.h - fore.tackZ);
    wires.push({ key: 'forestay', to: 'hounds', at: [xf, 0, zf], d: Math.max(2.5, dS * kf), pre: 0.06 * wireBreak(Math.max(2.5, dS * kf)) });
  }
  if (C.runners) wires.push({ key: 'runner', to: 'hounds', runner: true, d: d * 0.85, pre: 0.1 * wireBreak(d * 0.85) });
  // (a backstay where the class has one: adjustable where it has the control, fixed where only its drawing has one)
  const fixedBs = !C.hasBackstay && C.model && C.model.backstay;
  if (C.hasBackstay || fixedBs) wires.push({ key: 'backstay', to: 'top', off: -0.05, low: 'transom', d: Math.max(2.5, dS * kf), pre: (fixedBs ? 0.14 : 0.1) * wireBreak(Math.max(2.5, dS * kf)), adjust: fixedBs ? 0 : 0.0025 * L });
  return { step: { type: keelStep ? 'keel' : 'deck', z: zStep, partners: keelStep ? deck : undefined }, spans: [{ z0: zStep, z1: C.mastHeight, a: A, b: B, t: T, mat }],
    spreaders, chainX: -0.1, chainIn: 0.93, wires, prebend: 0.002 * L, generic: true, lineMax: 2.5 * (C.sheetPower || 1000),
    houndsZ: MD.hounds, noHalyard: !!(C.sails.find((x) => x.key === 'main') || {}).rig, trapeze: !!C.trapeze };
}

// ---------------------------------------------------------------------------------------------------------------
// Reactions of a cloth's pinned (kinematic) nodes: the force the membrane (its stretch, shear, tapes, headboard and
// battens) and the air's load on the node itself put on whatever holds it. cb(i, j, Fx, Fy, Fz) per pinned node.
const PIN_CACHE = new WeakMap();
export function clothPinForces(c, cb) {
  let pc = PIN_CACHE.get(c);
  if (!pc || pc.kinSum !== c.kin.reduce((s, v, i) => s + v * (i + 1), 0)) {
    const tris = [], dists = [];
    for (let t = 0; t < c.T; t++) if (c.kin[c.tri[3 * t]] || c.kin[c.tri[3 * t + 1]] || c.kin[c.tri[3 * t + 2]]) tris.push(t);
    c.dist.forEach((d, k) => { if (c.kin[d.i] || c.kin[d.j]) dists.push(k); });
    const pins = []; for (let i = 0; i < c.n; i++) if (c.kin[i] && i >= c.off) pins.push(i);
    pc = { tris, dists, pins, F: new Float64Array(3 * c.n), kinSum: c.kin.reduce((s, v, i) => s + v * (i + 1), 0) };
    PIN_CACHE.set(c, pc);
  }
  const F = pc.F, x = c.x, cf = c.cf, tri = c.tri, S = Math.SQRT1_2, cr = c.tensionOnly ? c.compress : 1;
  for (const i of pc.pins) { F[3 * i] = c.f[3 * i]; F[3 * i + 1] = c.f[3 * i + 1]; F[3 * i + 2] = c.f[3 * i + 2]; }
  for (const t of pc.tris) {
    const i0 = tri[3 * t], i1 = tri[3 * t + 1], i2 = tri[3 * t + 2], a0 = 3 * i0, a1 = 3 * i1, a2 = 3 * i2, o = 6 * t;
    const c0 = cf[o], c1 = cf[o + 1], c2 = cf[o + 2], e0 = cf[o + 3], e1 = cf[o + 4], e2 = cf[o + 5];
    const f1x = c0 * x[a0] + c1 * x[a1] + c2 * x[a2], f1y = c0 * x[a0 + 1] + c1 * x[a1 + 1] + c2 * x[a2 + 1], f1z = c0 * x[a0 + 2] + c1 * x[a1 + 2] + c2 * x[a2 + 2];
    const f2x = e0 * x[a0] + e1 * x[a1] + e2 * x[a2], f2y = e0 * x[a0 + 1] + e1 * x[a1 + 1] + e2 * x[a2 + 1], f2z = e0 * x[a0 + 2] + e1 * x[a1 + 2] + e2 * x[a2 + 2];
    const l1 = hyp3(f1x, f1y, f1z) || 1e-12, l2 = hyp3(f2x, f2y, f2z) || 1e-12;
    const u1x = f1x / l1, u1y = f1y / l1, u1z = f1z / l1, u2x = f2x / l2, u2y = f2y / l2, u2z = f2z / l2;
    let bx = u1x + u2x, by = u1y + u2y, bz = u1z + u2z, dx = u1x - u2x, dy = u1y - u2y, dz = u1z - u2z;
    const bl = hyp3(bx, by, bz) || 1e-12, dl = hyp3(dx, dy, dz) || 1e-12;
    bx /= bl; by /= bl; bz /= bl; dx /= dl; dy /= dl; dz /= dl;
    const kw = c.kw[t], kf = c.kf[t], kb = c.kb[t];
    const p1 = l1 < 1 ? l1 + cr * (1 - l1) : 1, p2 = l2 < 1 ? l2 + cr * (1 - l2) : 1;
    // dE/df1 and dE/df2 (warp / fill stretch and the shear pair); the force on node a is -(c_a dE/df1 + e_a dE/df2)
    const g1x = kw * (f1x - p1 * u1x) + kb * (f1x - l1 * S * (bx + dx)), g1y = kw * (f1y - p1 * u1y) + kb * (f1y - l1 * S * (by + dy)), g1z = kw * (f1z - p1 * u1z) + kb * (f1z - l1 * S * (bz + dz));
    const g2x = kf * (f2x - p2 * u2x) + kb * (f2x - l2 * S * (bx - dx)), g2y = kf * (f2y - p2 * u2y) + kb * (f2y - l2 * S * (by - dy)), g2z = kf * (f2z - p2 * u2z) + kb * (f2z - l2 * S * (bz - dz));
    for (const [n, ca, ea] of [[i0, c0, e0], [i1, c1, e1], [i2, c2, e2]]) {
      if (!c.kin[n]) continue;
      F[3 * n] -= ca * g1x + ea * g2x; F[3 * n + 1] -= ca * g1y + ea * g2y; F[3 * n + 2] -= ca * g1z + ea * g2z;
    }
  }
  for (const k of pc.dists) {
    const d = c.dist[k], i = 3 * d.i, j = 3 * d.j;
    let dx = x[j] - x[i], dy = x[j + 1] - x[i + 1], dz = x[j + 2] - x[i + 2];
    const l = hyp3(dx, dy, dz) || 1e-12;
    if (d.tension && l < d.rest) continue;
    const T = d.w * (l - d.rest) / l; dx *= T; dy *= T; dz *= T;
    if (c.kin[d.i]) { F[i] += dx; F[i + 1] += dy; F[i + 2] += dz; }
    if (c.kin[d.j]) { F[j] -= dx; F[j + 1] -= dy; F[j + 2] -= dz; }
  }
  const nu = c.nu;
  for (const i of pc.pins) { const q = i - c.off; cb(q % nu, Math.floor(q / nu), F[3 * i], F[3 * i + 1], F[3 * i + 2]); }
}

// ---------------------------------------------------------------------------------------------------------------
// Envelope (skyline) Cholesky of a dense-stored SPD matrix in place (lower): each row only from its first non-zero
// column (the mast's rows are banded; the few spreader-tip, sprit and bridle rows at the end are full). false when not
// positive definite (a buckled column).
function cholesky(A, n, fc) {
  for (let i = 0; i < n; i++) { let f = i; for (let k = 0; k < i; k++) if (A[i * n + k] !== 0) { f = k; break; } fc[i] = f; }
  for (let j = 0; j < n; j++) {
    const fj = fc[j], rj = j * n;
    let s = A[rj + j];
    for (let k = fj; k < j; k++) s -= A[rj + k] * A[rj + k];
    if (!(s > 0)) { cholesky.fail = j; return false; }
    const d = Math.sqrt(s); A[rj + j] = d;
    for (let i = j + 1; i < n; i++) {
      const fi = fc[i]; if (fi > j) continue;
      const ri = i * n;
      let t = A[ri + j];
      for (let k = fi > fj ? fi : fj; k < j; k++) t -= A[ri + k] * A[rj + k];
      A[ri + j] = t / d;
    }
  }
  return true;
}
function cholSolve(A, n, b, fc) {
  for (let i = 0; i < n; i++) { let s = b[i]; const ri = i * n; for (let k = fc[i]; k < i; k++) s -= A[ri + k] * b[k]; b[i] = s / A[ri + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) if (fc[k] <= i) s -= A[k * n + i] * b[k]; b[i] = s / A[i * n + i]; }
  return b;
}

const PEN = 1e10;
const TUNE = new WeakMap();


// a stay's solved state (its numbers and number arrays; not its attachments), to start every boat of a class alike
function snapStay(st) {
  const o = {};
  for (const k in st) { const v = st[k]; if (typeof v === 'number') o[k] = v; else if (v instanceof Float64Array) o[k] = Float64Array.from(v); else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) o[k] = v.slice(); }
  return o;
}
function restoreStay(st, o) {
  for (const k in st) { const v = st[k]; if ((typeof v === 'number' || v instanceof Float64Array || (Array.isArray(v) && v.every((x) => typeof x === 'number'))) && !(k in o)) delete st[k]; }
  for (const k in o) st[k] = o[k] instanceof Float64Array ? Float64Array.from(o[k]) : Array.isArray(o[k]) ? o[k].slice() : o[k];
}
export class RigStructure {
  constructor(boat, spec = null) {
    const C = boat.cls;
    this.boat = boat; this.C = C;
    // (a class may give its structure in C.rigSpec together with the damage model's parts, as the J Class's do: it had
    // been missed, and the J Class sailed on a generic rig a tenth as strong as its own rod)
    const R = this.spec = spec || C.rigStructure || (C.rigSpec && C.rigSpec.spans && C.rigSpec.wires ? C.rigSpec : null) || RIG_DATA[C.id] || genericRig(C);
    this.axisX = C.mastX + 0.03;
    // the most a line on the boom carries (its purchase times what the crew can pull): the vang and the sheet
    this.lineMax = R.lineMax ?? 2 * (C.sheetPower || 700);
    this.sheetMax = R.sheetMax ?? 2 * (C.sheetPower || 700);
    this.track = R.rotating ? R.rotating.track : 0.05;         // luff track aft of the mast's axis
    this.rot = 0; this.rotTarget = 0;
    this.stays = {};
    // lines that pull on the mast with a set tension (a leech toward its clew, a halyard's hauling part down the mast, a
    // trapeze toward its crew): their pull turns with the mast as it bends, so they carry their geometric stiffness (a
    // halyard inside the mast cannot buckle it; a leech pulling the head toward the clew holds it as a stay would)
    this.pulls = [];
    this.buildGeometry();
    this.u = new Float64Array(this.n); this.du = new Float64Array(this.n);
    this.K = new Float64Array(this.n * this.n); this.R = new Float64Array(this.n); this.F = new Float64Array(this.n);
    this.u0 = new Float64Array(this.n);
    // built-in bend (the spar's straightness tolerance and set: a small forward bow, sine over the panel)
    const L = this.zTop - this.zStep;
    for (let i = 0; i < this.nm; i++) {
      const s = (this.z[i] - this.zStep) / L;
      this.u0[5 * i] = (R.prebend || 0) * Math.sin(Math.PI * s); this.u0[5 * i + 1] = (R.prebend || 0) * Math.PI / L * Math.cos(Math.PI * s);
    }
    this.count = 0; this.every = 4; this.ready = false;
    // the cloth's luffs follow the solved mast and stays (off: the old parametric bow and sag, for comparison)
    this.feedLuff = RigStructure.feedLuff ?? true; this.feedStay = RigStructure.feedStay ?? true;
    this.loads = {};
    this.bendN = 0; this.sagN = 0; this.bendMM = 0; this.sagMM = 0;
    // (the dock tune depends only on the class: found once, shared by every boat of it)
    // (every boat of a class starts from the same tuned state: the wires, the shape, the spar elements' forces and the
    // stays' solved state. The first one used to keep what designLuffRound's load case left in its stays and elements
    // (its forestay at 4.7 kN, the later boats' at 1.1): the player and an identical AI boat, or two peers, diverged)
    let tc = TUNE.get(C);
    if (!(tc && tc.spec === R)) {
      this.tune();
      tc = { spec: R, L0: this.wires.map((w) => w.L0), Lrest0: this.wires.map((w) => w.Lrest0), T: this.wires.map((w) => w.T), u: Float64Array.from(this.u),
        eN: this.el.map((e) => [e.N, e.Ng]), stays: Object.fromEntries(Object.entries(this.stays).map(([k, st]) => [k, snapStay(st)])) };
      TUNE.set(C, tc);
      tc.luffRound = this.designLuffRound();
    }
    this.wires.forEach((w, k) => { w.L0 = tc.L0[k]; w.Lrest0 = w.Lrest = tc.Lrest0[k]; w.T = tc.T[k]; });
    this.u.set(tc.u);
    if (tc.eN) this.el.forEach((e, k) => { e.N = tc.eN[k][0]; e.Ng = tc.eN[k][1]; });
    if (tc.stays) for (const k in this.stays) if (tc.stays[k]) restoreStay(this.stays[k], tc.stays[k]);
    this.pulls.length = 0; this.F.fill(0);
    this.u0dock = Float64Array.from(this.u);
    this.luffRound = tc.luffRound;
  }

  // ---------------------------------------------------------------- geometry
  buildGeometry() {
    const C = this.C, R = this.spec, Lx = linesFor(C);
    const tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
    const S = C.sails.reduce((o, s) => (o[s.key] = s, o), {});
    const zStep = R.step.z, zTop = C.mastHeight;
    // heads of the sails set on stays: the stay's top on the mast
    // (the sails' luffs rise their luff length from the tack, as the cloth and the drawings set them)
    const headZ = (s) => s.tackZ + s.luff;
    const houndsZ = R.houndsZ ?? (S.jib ? headZ(S.jib) : zTop - 0.3);
    this.houndsZ = houndsZ; this.zStep = zStep; this.zTop = zTop;
    const zVang = C.boomZ - Math.min(0.55, Math.max(0.3, C.boomZ - C.freeboard + 0.1));
    // key heights, then elements no longer than ~1/12 of the mast
    const keys = new Set([zStep, zTop, C.boomZ, clamp(zVang, zStep, zTop), houndsZ]);
    if (R.step.collar) keys.add(R.step.collar);
    if (R.step.partners) keys.add(R.step.partners);
    for (const sp of R.spreaders) keys.add(sp.z);
    for (const w of R.wires) { if (typeof w.to === 'number') keys.add(w.to); if (w.diamond) { keys.add(w.diamond[0]); keys.add(w.diamond[1]); } if (w.stay && S[w.stay]) keys.add(Math.min(zTop, headZ(S[w.stay]))); }
    for (const sp of R.spans) { keys.add(sp.z0); keys.add(sp.z1); }
    let zs = [...keys].filter((z) => z >= zStep - 1e-6 && z <= zTop + 1e-6).sort((a, b) => a - b);
    zs = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.04);
    const hmax = (zTop - zStep) / 12, z = [];
    for (let i = 0; i < zs.length; i++) {
      z.push(zs[i]);
      if (i + 1 < zs.length) { const n = Math.ceil((zs[i + 1] - zs[i]) / hmax); for (let k = 1; k < n; k++) z.push(zs[i] + (zs[i + 1] - zs[i]) * k / n); }
    }
    this.z = z; this.nm = z.length;
    const node = (zz) => { let b = 0; for (let i = 1; i < z.length; i++) if (Math.abs(z[i] - zz) < Math.abs(z[b] - zz)) b = i; return b; };
    this.node = node;
    // element sections (the span covering the element's middle)
    this.el = [];
    let massMast = 0;
    for (let i = 0; i + 1 < z.length; i++) {
      const zm = 0.5 * (z[i] + z[i + 1]), sp = R.spans.find((s) => zm >= s.z0 - 1e-6 && zm <= s.z1 + 1e-6) || R.spans[R.spans.length - 1];
      const s0 = section(sp), s1 = sp.plus ? section({ ...sp.plus, mat: sp.mat }) : null;
      const sec = s1 ? { EIx: s0.EIx + s1.EIx, EIy: s0.EIy + s1.EIy, EA: s0.EA + s1.EA, m: s0.m + s1.m, Zx: s0.Zx + s1.Zx * 0.8, Zy: s0.Zy + s1.Zy * 0.8, A: s0.A + s1.A, sy: s0.sy } : s0;
      this.el.push({ i, j: i + 1, L: z[i + 1] - z[i], ...sec, N: 0, span: R.spans.indexOf(sp) });
      massMast += sec.m * (z[i + 1] - z[i]);
    }
    this.massMast = massMast;
    // nodal masses
    this.mN = new Float64Array(z.length);
    for (const e of this.el) { this.mN[e.i] += e.m * e.L / 2; this.mN[e.j] += e.m * e.L / 2; }
    // extra nodes: spreader tips (2 per spreader), a bowsprit end, a bridle apex
    let n = 5 * z.length;
    const extra = [];
    const addNode = (p) => { const k = { p: p.slice(), dof: n }; n += 3; extra.push(k); return k; };
    this.tips = [];
    for (const sp of R.spreaders) {
      const pair = [];
      for (const s of [-1, 1]) {
        const r = [-sp.sweep, s * sp.len, 0];
        pair.push({ sp, s, r, node: addNode([this.axisX + r[0], r[1], sp.z]) });
      }
      this.tips.push(pair);
    }
    this.extra = extra;
    // wires
    const chain = (s, dx = 0) => {
      const x = C.mastX + (R.chainX ?? -0.1) + dx, t = tAt(x);
      const y = C.multihull ? s * (C.hullSpacing / 2 + Lx.bDeck(t) * 0.8) : s * Lx.bDeck(t) * (R.chainIn ?? 0.93);
      return [x, y, Lx.sheer(t) * (C.multihull ? 1 : 1) + 0.03];
    };
    const mastAt = (zz, ox = 0, oy = 0) => ({ kind: 'mast', i: node(zz), ox, oy });
    const fixed = (p) => ({ kind: 'fixed', p });
    const nodeAt = (k) => ({ kind: 'node', k });
    this.wires = [];
    // (a wire of the spec's material: 1x19 by default, rod or carbon cable where the spec says (WIRE_MATS))
    const matOf = (key) => { const ws = R.wires.find((x) => x.key === key); return ws && WIRE_MATS[ws.mat]; };
    // (a running backstay's or checkstay's wires carry the spec's runner flag: the step sets up the windward one and lets
    // the leeward one off)
    const isRunner = (key) => !!(R.wires.find((x) => x.key === key) || {}).runner;
    const W = (key, a, b, d, pre = null, o = {}) => { const M = matOf(key); const w = { key, a, b, d, EA: M ? M.EA(d) : wireEA(d), brk: M ? M.brk(d) : wireBreak(d), pre, T: 0, Lrest: 0, side: o.side ?? 0, runner: isRunner(key), ...o }; this.wires.push(w); return w; };
    let sprit = null, apex = null;
    for (const w of R.wires) {
      if (w.sprit || w.stay || w.bridle) continue;
      if (w.diamond) {
        for (const [k, pair] of this.tips.entries()) if (pair[0].sp.diamond) for (const tip of pair) {
          W(w.key, mastAt(w.diamond[0]), nodeAt(tip.node), w.d, w.pre, { side: tip.s, seg: 'upper' });
          W(w.key, nodeAt(tip.node), mastAt(w.diamond[1]), w.d, w.pre, { side: tip.s, seg: 'lower' });
        }
        continue;
      }
      if (w.key === 'backstay') {
        const lowX = C.sternX + 0.3, t = tAt(lowX);
        // (twin backstays, as a rig without a centreline stay has them (the TP52's): one to each quarter, both on
        // the backstay control)
        if (w.twin) for (const sd of [-1, 1]) W(w.key, mastAt(zTop, w.off ?? -0.05, 0), fixed([lowX, sd * Lx.bDeck(t) * (w.twin.in ?? 0.85), Lx.sheer(t) + 0.03]), w.d, w.pre, { adjust: w.adjust || 0, side: sd });
        else W(w.key, mastAt(zTop, w.off ?? -0.05, 0), fixed([lowX, 0, Lx.sheer(t) + 0.15]), w.d, w.pre, { adjust: w.adjust || 0 });
        continue;
      }
      const zTo = w.to === 'hounds' ? houndsZ : w.to === 'top' ? zTop : w.to;
      for (const s of [-1, 1]) {
        // (a running backstay to the quarter; a wire to a given point, mirrored each side: a trimaran's float)
        const xq = C.sternX + 0.6, tq = tAt(xq);
        const cp = w.at ? [w.at[0], s * w.at[1], w.at[2]] : w.runner ? [xq, s * Lx.bDeck(tq) * 0.92, Lx.sheer(tq) + 0.03] : chain(s, w.dx || 0);
        if (w.from !== undefined && this.tips[w.from]) {
          // a diagonal of discontinuous rigging (D2, D3): from a spreader's tip in to the mast at the next one's root
          W(w.key, nodeAt(this.tips[w.from][(s + 1) / 2].node), mastAt(zTo), w.d, w.pre, { side: s, seg: 'diag' });
        } else if (Array.isArray(w.via)) {
          // a shroud over several spreaders (V1..V4 of a three-spreader rig): chainplate, each tip, the mast
          const pts = [fixed(cp), ...w.via.map((k) => nodeAt(this.tips[k][(s + 1) / 2].node)), mastAt(zTo)];
          for (let k = 0; k + 1 < pts.length; k++) W(w.key, pts[k], pts[k + 1], w.d, w.pre, { side: s, seg: k === 0 ? 'lower' : k === pts.length - 2 ? 'upper' : 'mid' });
        } else if (w.via !== undefined && this.tips[w.via] && !this.tips[w.via][0].sp.diamond) {
          const tip = this.tips[w.via][(s + 1) / 2];
          W(w.key, fixed(cp), nodeAt(tip.node), w.d, w.pre, { side: s, seg: 'lower' });
          W(w.key, nodeAt(tip.node), mastAt(zTo), w.d, w.pre, { side: s, seg: 'upper' });
        } else W(w.key, fixed(cp), mastAt(zTo), w.d, w.pre, { side: s });
      }
    }
    // headsail stays (their tops on the mast at the sail's head, their feet at the tack: deck, bowsprit end, bridle)
    for (const w of R.wires) {
      if (!w.stay || !S[w.stay]) continue;
      const s = S[w.stay], hz = Math.min(zTop, headZ(s)), top = mastAt(hz, s.tackX - (s.rake || 0) - this.axisX, 0);
      let foot;
      if (R.sprit && s.tackX > C.bowX + 0.1) {
        if (!sprit) {
          const t1 = tAt(C.bowX);
          sprit = addNode([s.tackX, 0, s.tackZ]);
          const M = SPAR_MATERIALS[R.sprit.mat || 'teak'], Ls = s.tackX - C.bowX;
          const Iv = R.sprit.w * R.sprit.h ** 3 / 12, Ih = R.sprit.h * R.sprit.w ** 3 / 12;
          this.spritStrut = { node: sprit, root: [C.bowX, 0, Lx.sheer(t1) + 0.05], L: Ls, kAx: M.E * R.sprit.w * R.sprit.h / (Ls + 0.6), kV: 3 * M.E * Iv / Ls ** 3, kH: 3 * M.E * Ih / Ls ** 3, EIv: M.E * Iv, EIh: M.E * Ih, Zv: Iv / (R.sprit.h / 2), sy: M.sy };
          for (const x of R.wires) {
            if (!x.sprit) continue;
            if (x.low === 'stem') W(x.key, nodeAt(sprit), fixed([C.bowX + 0.02, 0, 0.12]), x.d, x.pre ?? null);
            else if (x.low === 'whisker') for (const sd of [-1, 1]) { const xw = C.bowX - 0.35; W(x.key, nodeAt(sprit), fixed([xw, sd * Lx.bDeck(tAt(xw)) * 0.95, Lx.sheer(tAt(xw))]), x.d, x.pre ?? null, { side: sd }); }
          }
        }
        foot = nodeAt(sprit);
      } else if (R.wires.some((x) => x.bridle) && w.key === 'forestay') {
        // the Hobie's bridle: two wires from the bows to the forestay's foot, nearly level. Held there by the bridle's
        // tension (as a node it swings with every load: a mechanism, not a structure), the foot is taken as fixed and the
        // bridle wires' loads come from the forestay's pull by statics (outputs)
        const bw = R.wires.find((x) => x.bridle);
        this.bridle = { d: bw.d, brk: wireBreak(bw.d), ends: [-1, 1].map((sd) => [C.bowX - 0.05, sd * C.hullSpacing / 2, Math.max(s.tackZ - 0.05, C.freeboard)]), foot: [s.tackX, 0, s.tackZ] };
        foot = fixed([s.tackX, 0, s.tackZ]);
      } else foot = fixed([s.tackX, 0, s.tackZ]);
      const st = W(w.key, foot, top, w.d, w.pre ?? null, { stay: w.stay, sail: s });
      st.P = []; st.sag = []; st.A2 = 0;
      this.stays[w.stay] = st;
    }
    this.n = n;
    this.sprit = sprit; this.apex = apex;
    // supports
    const st = R.step;
    this.supports = [{ i: 0, dofs: st.type === 'fixed' ? [0, 1, 2, 3, 4] : [0, 2, 4] }];
    if (st.type === 'tube' && st.collar) this.supports.push({ i: node(st.collar), dofs: [0, 2] });
    if (st.type === 'keel' && st.partners) this.supports.push({ i: node(st.partners), dofs: [0, 2] });
    // where the loads go
    this.iGoose = node(C.boomZ); this.iVang = node(zVang); this.iTop = z.length - 1; this.iHounds = node(houndsZ);
    this.zVang = zVang;
  }

  // position of an attachment (reference + displacement) -> out
  pos(a, u, out) {
    if (a.kind === 'fixed') { out[0] = a.p[0]; out[1] = a.p[1]; out[2] = a.p[2]; return out; }
    if (a.kind === 'node') { const k = a.k, d = k.dof; out[0] = k.p[0] + u[d]; out[1] = k.p[1] + u[d + 1]; out[2] = k.p[2] + u[d + 2]; return out; }
    const b = 5 * a.i;
    out[0] = this.axisX + a.ox + u[b]; out[1] = a.oy + u[b + 2]; out[2] = this.z[a.i] + u[b + 4] - a.ox * u[b + 1] - a.oy * u[b + 3];
    return out;
  }
  // (dof, coefficient) lists of an attachment's x, y and z displacement
  map(a) {
    if (a._m) return a._m;
    if (a.kind === 'fixed') return (a._m = [[], [], []]);
    if (a.kind === 'node') { const d = a.k.dof; return (a._m = [[[d, 1]], [[d + 1, 1]], [[d + 2, 1]]]); }
    const b = 5 * a.i;
    return (a._m = [[[b, 1]], [[b + 2, 1]], [[b + 4, 1], [b + 1, -a.ox], [b + 3, -a.oy]]]);
  }
  // element between attachments a and b with 3x3 stiffness Kd on (pb - pa) and force fb on b (-fb on a)
  addPair(a, b, Kd, fb) {
    const K = this.K, n = this.n, R = this.R, ma = this.map(a), mb = this.map(b);
    const D = this._pd || (this._pd = new Int32Array(12)), Cc = this._pc || (this._pc = new Float64Array(12)), Rr = this._pr || (this._pr = new Int8Array(12));
    let m = 0;
    for (let r = 0; r < 3; r++) {
      for (const e of mb[r]) { D[m] = e[0]; Cc[m] = e[1]; Rr[m++] = r; }
      for (const e of ma[r]) { D[m] = e[0]; Cc[m] = -e[1]; Rr[m++] = r; }
    }
    for (let p = 0; p < m; p++) {
      const dp = D[p], cp = Cc[p], rp = 3 * Rr[p];
      R[dp] += cp * fb[Rr[p]];
      const row = dp * n;
      for (let q = 0; q < m; q++) { const k = Kd[rp + Rr[q]]; if (k !== 0) K[row + D[q]] += cp * Cc[q] * k; }
    }
  }
  loadAt(a, Fx, Fy, Fz) {
    const m = this.map(a), F = this.F;
    for (const [d, c] of m[0]) F[d] += c * Fx; for (const [d, c] of m[1]) F[d] += c * Fy; for (const [d, c] of m[2]) F[d] += c * Fz;
  }
  // a force at height z on the mast (off the axis by ox, oy), shared between the two nodes either side
  loadMast(z, Fx, Fy, Fz, ox = 0, oy = 0) {
    const zz = this.z; let i = 0;
    while (i < this.nm - 2 && zz[i + 1] < z) i++;
    const f = clamp((z - zz[i]) / (zz[i + 1] - zz[i]), 0, 1), F = this.F;
    for (const [k, w] of [[i, 1 - f], [i + 1, f]]) {
      if (w <= 0) continue;
      const b = 5 * k; F[b] += w * Fx; F[b + 2] += w * Fy; F[b + 4] += w * Fz; F[b + 1] -= w * Fz * ox; F[b + 3] -= w * Fz * oy;
    }
  }

  // ---------------------------------------------------------------- the solve
  // the tangent stiffness K and the residual R at the current shape u, the mast's geometric stiffness scaled by kg
  assemble(kg = 1) {
    const n = this.n, K = this.K, R = this.R, u = this.u, pa = this._sa || (this._sa = [0, 0, 0]), pb = this._sb || (this._sb = [0, 0, 0]), Kd = this._Kd || (this._Kd = new Float64Array(9)), fb = this._fb || (this._fb = [0, 0, 0]);
    if (!this._KE) { this._KE = new Float64Array(16); this._KG = new Float64Array(16); this._dd = new Int32Array(4); this._fc = new Int32Array(n); }
    K.fill(0); R.set(this.F);
    // mast beam-column elements (both bending planes, axial; P-delta from the axial force)
    for (const e of this.el) {
      const L = e.L, bi = 5 * e.i, bj = 5 * e.j;
      const Nax = e.EA / L * (u[bj + 4] - u[bi + 4]); e.N = Nax;
      // (the geometric stiffness takes the compression of the last converged shape: an overshooting iterate must not
      // make the column look buckled)
      const Ng = e.Ng ?? Nax;
      const cr = Math.cos(this.rot), sr = Math.sin(this.rot), EIx = e.EIx * cr * cr + e.EIy * sr * sr, EIy = e.EIy * cr * cr + e.EIx * sr * sr;
      const ka = e.EA / L;
      const ax = [bi + 4, bj + 4];
      K[ax[0] * n + ax[0]] += ka; K[ax[1] * n + ax[1]] += ka; K[ax[0] * n + ax[1]] -= ka; K[ax[1] * n + ax[0]] -= ka;
      R[ax[0]] += Nax; R[ax[1]] -= Nax;
      for (let pl = 0; pl < 2; pl++) {
        const EI = pl ? EIy : EIx, o = 2 * pl, k = EI / (L * L * L), g = kg * Ng / (30 * L);
        const d0 = bi + o, d1 = bi + o + 1, d2 = bj + o, d3 = bj + o + 1;
        const KE = this._KE, KG = this._KG, dd = this._dd;
        KE[0] = 12 * k; KE[1] = 6 * L * k; KE[2] = -12 * k; KE[3] = 6 * L * k; KE[5] = 4 * L * L * k; KE[6] = -6 * L * k; KE[7] = 2 * L * L * k; KE[10] = 12 * k; KE[11] = -6 * L * k; KE[15] = 4 * L * L * k;
        KG[0] = 36 * g; KG[1] = 3 * L * g; KG[2] = -36 * g; KG[3] = 3 * L * g; KG[5] = 4 * L * L * g; KG[6] = -3 * L * g; KG[7] = -L * L * g; KG[10] = 36 * g; KG[11] = -3 * L * g; KG[15] = 4 * L * L * g;
        for (let r = 0; r < 4; r++) for (let c = 0; c < r; c++) { KE[4 * r + c] = KE[4 * c + r]; KG[4 * r + c] = KG[4 * c + r]; }
        dd[0] = d0; dd[1] = d1; dd[2] = d2; dd[3] = d3;
        for (let r = 0; r < 4; r++) {
          let fr = 0; const row = dd[r] * n;
          for (let c = 0; c < 4; c++) { const kt = KE[4 * r + c] + KG[4 * r + c]; K[row + dd[c]] += kt; fr += kt * u[dd[c]] + KG[4 * r + c] * this.u0[dd[c]]; }
          R[dd[r]] -= fr;
        }
      }
    }
    // wires: tension only, large displacement, geometric stiffness; stays with their luff load's sag
    for (const w of this.wires) {
      this.pos(w.a, u, pa); this.pos(w.b, u, pb);
      let ex = pb[0] - pa[0], ey = pb[1] - pa[1], ez = pb[2] - pa[2];
      const L = hyp3(ex, ey, ez); ex /= L; ey /= L; ez /= L;
      const k = w.EA / w.Lrest;
      let T, kt;
      if (w.stay && w.A2 > 0) {
        // T = k (L - Lrest + A2 / T^2): the arc the sag adds (A2 = 1/2 int (M/T)'^2 T^2 ds)
        T = Math.max(1, w.T || k * (L - w.Lrest));
        for (let q = 0; q < 12; q++) { const f = T - k * (L - w.Lrest) - k * w.A2 / (T * T), fp = 1 + 2 * k * w.A2 / (T * T * T); T = Math.max(1, T - f / fp); }
        kt = k / (1 + 2 * k * w.A2 / (T * T * T));
      } else { T = k * (L - w.Lrest); kt = k; if (T <= 0) { T = 0; kt = 0.02 * k; } }
      w.T = T; w.L = L; w.e = [ex, ey, ez];
      const g = T / L, E = [ex, ey, ez];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Kd[3 * r + c] = kt * E[r] * E[c] + g * ((r === c ? 1 : 0) - E[r] * E[c]);
      fb[0] = -T * ex; fb[1] = -T * ey; fb[2] = -T * ez;          // the wire pulls b toward a
      this.addPair(w.a, w.b, Kd, fb);
    }
    // spreaders: a strut built into the mast, carried by its rotation
    for (const pair of this.tips) for (const tp of pair) {
      const sp = tp.sp, r = this.rotV(tp.r), Ls = Math.hypot(r[0], r[1]), ex = r[0] / Ls, ey = r[1] / Ls;
      const root = tp._root || (tp._root = { kind: 'mast', i: this.node(sp.z), ox: 0, oy: 0 });
      root.ox = r[0]; root.oy = r[1]; root._m = null;
      const tip = tp._tip || (tp._tip = { kind: 'node', k: tp.node });
      const ka = sp.EA / Ls, kb = 3 * sp.EI / (Ls * Ls * Ls), E = [ex, ey, 0];
      for (let rr = 0; rr < 3; rr++) for (let c = 0; c < 3; c++) Kd[3 * rr + c] = ka * E[rr] * E[c] + kb * ((rr === c ? 1 : 0) - E[rr] * E[c]);
      // relative displacement of the tip from where the mast carries it
      const k0 = tp.node;
      const d0 = [u[k0.dof] - (u[5 * root.i]), u[k0.dof + 1] - u[5 * root.i + 2], u[k0.dof + 2] - (u[5 * root.i + 4] - r[0] * u[5 * root.i + 1] - r[1] * u[5 * root.i + 3])];
      // (the tip node's reference sits where the unrotated spreader put it: include the rotation's offset)
      d0[0] += k0.p[0] - (this.axisX + r[0]); d0[1] += k0.p[1] - r[1];
      for (let rr = 0; rr < 3; rr++) { fb[rr] = 0; for (let c = 0; c < 3; c++) fb[rr] -= Kd[3 * rr + c] * d0[c]; }
      this.addPair(root, tip, Kd, fb);
    }
    // pulls: a line at a set tension T from a to b: force T e on a, its geometric stiffness T/L (I - e e^T)
    for (const pl of this.pulls) {
      this.pos(pl.a, u, pa); this.pos(pl.b, u, pb);
      let ex = pb[0] - pa[0], ey = pb[1] - pa[1], ez = pb[2] - pa[2]; const L = hyp3(ex, ey, ez) || 1; ex /= L; ey /= L; ez /= L;
      const E = [ex, ey, ez], g = pl.T / L;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Kd[3 * r + c] = g * ((r === c ? 1 : 0) - E[r] * E[c]);
      fb[0] = -pl.T * ex; fb[1] = -pl.T * ey; fb[2] = -pl.T * ez;
      this.addPair(pl.a, pl.b, Kd, fb);
    }
    // bowsprit: a cantilever from the stem
    if (this.spritStrut) {
      const s = this.spritStrut, k0 = s.node, ex = k0.p[0] - s.root[0], ez = k0.p[2] - s.root[2], l = Math.hypot(ex, ez), e = [ex / l, 0, ez / l], nv = [-e[2], 0, e[0]];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Kd[3 * r + c] = s.kAx * e[r] * e[c] + s.kV * nv[r] * nv[c] + (r === 1 && c === 1 ? s.kH : 0);
      const tip = s._tip || (s._tip = { kind: 'node', k: k0 }), root = s._root || (s._root = { kind: 'fixed', p: s.root });
      const d0 = [u[k0.dof], u[k0.dof + 1], u[k0.dof + 2]];
      for (let r = 0; r < 3; r++) { fb[r] = 0; for (let c = 0; c < 3; c++) fb[r] -= Kd[3 * r + c] * d0[c]; }
      this.addPair(root, tip, Kd, fb);
    }
    // supports (penalty) and a light spring on the free nodes (a slack wire must not leave them singular)
    for (const s of this.supports) for (const o of s.dofs) { const d = 5 * s.i + o; K[d * n + d] += PEN; R[d] -= PEN * u[d]; }
    for (const k of this.extra) for (let c = 0; c < 3; c++) { const d = k.dof + c; K[d * n + d] += 50; R[d] -= 50 * u[d]; }
    for (let i = 0; i < this.nm; i++) { const d = 5 * i + 4; K[d * n + d] += 1; }
  }
  // one quasi-static solution for the loads in this.F. Returns false if the mast buckled.
  solve(maxIt = 8) {
    const n = this.n, K = this.K, R = this.R, u = this.u, du = this.du;
    if (!this._fc) this._fc = new Int32Array(n);
    let ok = true, kg = 1, lost = false;
    this.buckled = false; this.converged = false;
    for (let it = 0; it < maxIt; it++) {
      this.assemble(kg);
      du.set(R);
      if (!cholesky(K, n, this._fc)) {
        // no stiffness left at this iterate: take this step at a reduced geometric stiffness (whether the column has
        // buckled is asked of the shape the iterations end at, below)
        lost = true; kg *= 0.5; this.failDof = cholesky.fail; this.failKg = kg;
        if (kg < 0.05) { this.buckled = true; ok = false; break; }
        it--; continue;
      }
      kg = Math.min(1, kg * 2);
      cholSolve(K, n, du, this._fc);
      let mx = 0;
      let big = 0; for (let i = 0; i < n; i++) big = Math.max(big, Math.abs(du[i]));
      // (steps kept to 30 mm: wires make the problem stiff and one-sided (a slack wire has no stiffness), and an unstayed
      // spar under a cloth whose luff follows it has no stable shape far out (taken whole, a Laser's top ran to 3.8 m):
      // its steps are the spar's own motion, ~1 m/s at the solver's rate)
      const cap = 0.03, sc = big > cap ? cap / big : 1;
      for (let i = 0; i < n; i++) { const s = du[i] * sc; u[i] += s; mx = Math.max(mx, Math.abs(s)); }
      if (mx < 1e-5 && kg === 1) { this.converged = true; break; }
    }
    // (a column has buckled when its tangent stiffness, with the whole of its compression's geometric stiffness, is
    // singular at the shape it stands in. Flagged at the first iterate that lost it, as it was, a wire going slack
    // between two iterates read as buckling: a Hobie's mast 'buckled' at half its critical load in 25 kn, the loads were
    // extrapolated from 60% of them and its shroud parted)
    if (lost && ok) { this.assemble(1); if (!cholesky(K, n, this._fc)) { this.buckled = true; ok = false; } }
    for (const e of this.el) e.Ng = e.N;
    // what the step and the collar hold the mast with (z: the step's compression)
    this.stepF = [this._reac(0), this._reac(2), this._reac(4)];
    return ok;
  }
  // the rig's own critical load factor: how many times the mast's present compression its tangent stiffness (the
  // wires' stretch and the spreaders' give, the mast continuous over its supports, both planes) takes before it is
  // singular. Bisection on the geometric stiffness at the solved shape; 1 / it is the P / Pcr the damage model reads.
  criticalFactor() {
    const n = this.n, K = this.K, fc = this._fc;
    const pd = (l) => { this.assemble(l); return cholesky(K, n, fc); };
    let lo = 0, hi = this.lcr > 0 ? this.lcr : 2;
    // bracket (from the last answer: the load changes slowly)
    if (pd(hi)) { lo = hi; hi *= 1.6; while (hi < 40 && pd(hi)) { lo = hi; hi *= 1.6; } }
    else { lo = hi / 1.6; while (lo > 0.05 && !pd(lo)) { hi = lo; lo /= 1.6; } }
    for (let k = 0; k < 5; k++) { const m = 0.5 * (lo + hi); if (pd(m)) lo = m; else hi = m; }
    return (this.lcr = 0.5 * (lo + hi));
  }
  _reac(o) { let r = 0; for (const s of this.supports) if (s.dofs.includes(o)) r -= PEN * this.u[5 * s.i + o]; return r; }
  rotV(r) { const c = Math.cos(this.rot), s = Math.sin(this.rot); return [r[0] * c - r[1] * s, r[0] * s + r[1] * c]; }

  // rest lengths for the dock tune: wires with a pre-tension carry it with the rig unloaded, upright
  tune() {
    const pa = [0, 0, 0], pb = [0, 0, 0], z = new Float64Array(this.n);
    for (const w of this.wires) {
      this.pos(w.a, z, pa); this.pos(w.b, z, pb);
      const L = hyp3(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      w.L0 = L; w.Lrest = L / (1 + (w.pre || 0) / w.EA); w.Lrest0 = w.Lrest;
    }
    for (let it = 0; it < 12; it++) {
      this.F.fill(0); this.gravityLoads(1, 0);
      this.solve(10);
      let err = 0;
      for (const w of this.wires) {
        if (!w.pre) continue;
        // (a wire in series with the rest of the rig is softer than itself: correct by 0.7 of the error each round)
        w.Lrest0 *= 1 - 0.7 * (w.pre - w.T) / w.EA; w.Lrest = w.Lrest0 - (w.adjust ? 0 : 0);
        err = Math.max(err, Math.abs(w.pre - w.T) / w.pre);
      }
      if (err < 0.02) break;
    }
    this.u0dock = Float64Array.from(this.u);
  }

  // The luff round a sailmaker cuts into the main: the mast's bend (mid-luff, against the luff's chord) sailing upwind
  // in its design breeze (~12 kn true, 50 Pa apparent), backstay and vang half on: the sail sets at its moulded depth there, and
  // flattens as the mast bends more.
  designLuffRound() {
    const C = this.C, M = C.sails.find((s) => s.key === 'main');
    if (!M) return 0;
    const q = 50, W = 1.05 * q * M.area, zs = [0.17, 0.5, 0.82].map((f) => C.boomZ + f * M.luff), wts = [0.43, 0.34, 0.23];
    const fake = { diag: { strips: { main: wts.map((w, i) => ({ Fx: 0.1 * W * w, Fn: W * w, zs: zs[i] })) }, shape: { main: wts.map(() => ({ ang: 0.1, d: 0.12 })) },
      rig: { mainLoad: 0.6 * W }, qMid: q }, ctrl: { vang: 0.5, backstay: 0.5 }, reefPos: 0, side: {}, sailBy: { main: M }, booms: {} };
    this.F.fill(0); this.gravityLoads(1, 0); this.loads.halyard = {};
    this.sailLoads(fake, M, null);
    for (const w of this.wires) w.Lrest = w.Lrest0 - (w.adjust ? w.adjust * 0.5 : 0);
    const u0 = Float64Array.from(this.u);
    for (let r = 0; r < 4; r++) this.solve(8);
    const us = this.us; this.us = null;
    const zl0 = C.boomZ, zl1 = Math.min(this.zTop, C.boomZ + M.luff), zm = 0.5 * (zl0 + zl1);
    const off = this.mastDisp(zm, [0, 0, 0])[0] - 0.5 * (this.mastDisp(zl0, [0, 0, 0])[0] + this.mastDisp(zl1, [0, 0, 0])[0]);
    this.us = us; this.u.set(u0); for (const w of this.wires) w.Lrest = w.Lrest0;
    this.pulls.length = 0; this.F.fill(0);
    for (const e of this.el) { e.N = e.EA / e.L * (this.u[5 * e.j + 4] - this.u[5 * e.i + 4]); e.Ng = e.N; }
    // (between the 0.6% of the luff the cloth was cut with before and the ~1% sailmakers give the bendiest dinghy
    // spars: a linear column is least trustworthy at the Laser's top-section bends)
    this.designOff = off;
    // (a class without its own rig data: its sails were cut for its mast, whose bend is what it is)
    return clamp(0.9 * off, (this.spec.generic ? 0.1 : 0.35) * 0.018 * M.luff, 0.02 * M.luff);
  }

  // ---------------------------------------------------------------- loads
  // weight and inertia of the mast (rig frame): gravity (0, g sin phi, -g cos phi) minus the frame's acceleration
  // (a: the hull's acceleration in rig axes at the waterline; pd roll and qdd pitch accelerations: a point z up the
  // mast moves pd z to starboard and -qdd z forward)
  gravityLoads(cphi, sphi, a = null) {
    const ax = a ? a.x : 0, ay = a ? a.y : 0, az = a ? a.z : 0, pd = a ? a.pd : 0, qdd = a ? a.qdd : 0;
    for (let i = 0; i < this.nm; i++) {
      const m = this.mN[i], zz = this.z[i];
      this.F[5 * i] -= m * (ax - qdd * zz);
      this.F[5 * i + 2] += m * (G * sphi - ay - pd * zz);
      this.F[5 * i + 4] -= m * (G * cphi + az);
    }
  }

  // gather the loads on the rig from the sails, booms, halyards and crew
  gatherLoads(b) {
    const C = this.C, F = this.F, d = b.diag;
    F.fill(0);
    for (const st of Object.values(this.stays)) { st.P.length = 0; }
    this.pulls.length = 0;
    const cphi = Math.cos(b.phi), sphi = Math.sin(b.phi);
    // frame accelerations (rig axes) from the last solve's rates
    const fr = this._fr || (this._fr = { u: b.u, v: b.v, p: b.p, pv: b.pitchV, hv: b.heaveV, t: b.t });
    // (the time since the last solve: the boat's clock, or the steps it took where the clock stands still (a preset at
    // t = 0, a test): taken as 1 ms there, each rate's change over it was an acceleration of hundreds of g, clamped at
    // 20, on every solve: the mast loaded with its own weight times 2 g at random)
    const dtf = b.t - fr.t > 1e-4 ? b.t - fr.t : (this._dtSolve || 1 / 30);
    const acc = { ud: clamp((b.u - fr.u) / dtf, -20, 20), vd: clamp((b.v - fr.v) / dtf, -20, 20), pd: clamp((b.p - fr.p) / dtf, -20, 20), qdd: clamp(((b.pitchV || 0) - fr.pv) / dtf, -20, 20), hd: clamp(((b.heaveV || 0) - fr.hv) / dtf, -30, 30) };
    fr.u = b.u; fr.v = b.v; fr.p = b.p; fr.pv = b.pitchV || 0; fr.hv = b.heaveV || 0; fr.t = b.t;
    this.gravityLoads(cphi, sphi, { x: acc.ud, y: acc.vd * cphi + acc.hd * sphi, z: acc.hd * cphi - acc.vd * sphi, pd: acc.pd, qdd: acc.qdd });
    const L = this.loads; L.halyard = {}; L.gooseneck = 0; L.vang = 0;
    const sys = b.sailSys && b.sailSys.active && b.sailSys.active(b) ? b.sailSys : null;
    let mainPin = null;
    for (const s of C.sails) {
      const rig = sys ? sys.cloth(s.key) : null;
      const st = d.strips[s.key]; if (!st || (st.areaF ?? 1) < 0.3) continue;
      this._luffSum = null;
      // (a cloth sail just set is still finding its shape: its loads count once it has flown a second. The cloth's
      // pinned nodes' reactions (clothLoads) are the direct measure, but a projective-dynamics cloth's pin reactions
      // alternate node to node around the load, and its penalty lines hauled against each other report forces no crew
      // could apply (a vang at 19 kN on a J/70): the rig takes the cloth's air load by membrane statics instead)
      const live = rig && rig.cloth && !rig.needPose && (rig.sincePose || 0) > 1;
      if (live && RigStructure.fromPins) this.clothLoads(b, s, rig);
      else this.sailLoads(b, s, live ? rig : null);
      if (s.key === 'main') mainPin = this._luffSum;
    }
    // the Hobie's rotating mast turns until the luff's pull passes through its axis (the track is aft of it), up to its
    // limiter
    if (this.spec.rotating) {
      const lim = this.spec.rotating.limit;
      // (a membrane pulls only along itself: on its track the luff pulls along the sail's entry, the chord turned
      // toward the leeward side by the camber's slope at the luff, atan 4 d/c; the mast turns until that pull passes
      // through its axis)
      let tgt = 0;
      if (this._entryW > 1) tgt = this._entry / this._entryW;
      else if (b.booms.main) tgt = b.booms.main.a + Math.sign(b.booms.main.a) * 0.35;
      if (Math.abs(tgt) > Math.PI / 2) tgt = Math.sign(tgt) * Math.PI / 2;
      this.rotTarget = clamp(tgt, -lim, lim);
    }
    // trapeze: each crewmember out on the wire hangs ~0.9 of their weight from the hounds, toward where they are
    if (this.spec.trapeze && C.crewEach) {
      const rail = C.hullSpacing ? C.hullSpacing / 2 : C.beam / 2, nT = typeof C.trapeze === 'number' ? C.trapeze : C.crewN;
      const out = clamp((Math.abs(b.crewY) - rail) / Math.max(0.1, C.crewMaxOut - rail), 0, 1);
      if (out > 0) {
        const T = 0.9 * nT * C.crewEach * G * out, zz = C.freeboard + 0.9;
        this.pull({ kind: 'mast', i: this.node(this.houndsZ - 0.05), ox: 0, oy: 0 }, { kind: 'fixed', p: [C.mastX - 0.3, b.crewY, zz] }, T);
        L.trapeze = T;
      } else L.trapeze = 0;
    }
  }

  // loads of a cloth sail: its pinned nodes' reactions; the main's boom through the gooseneck
  clothLoads(b, s, rig) {
    const c = rig.cloth, nv = c.nv, C = this.C, stay = this.stays[s.key];
    const luff = this._luffSum = [0, 0, 0];
    // the pinned nodes' reactions, low-passed per node over ~0.1 s (a projective-dynamics cloth's pin reactions carry
    // every substep's jolt), and capped at what the sail's air load and its lines could put there: a flogging or
    // freshly set cloth must not throw the rig about
    const pl = rig._pinLoad || (rig._pinLoad = new Float64Array(3 * nv)), k = clamp((b.t - (rig._pinT ?? b.t - 1)) / 0.1, 0, 1);
    rig._pinT = b.t;
    clothPinForces(c, (i, j, Fx, Fy, Fz) => {
      if (i !== 0) return;
      pl[3 * j] += (Fx - pl[3 * j]) * k; pl[3 * j + 1] += (Fy - pl[3 * j + 1]) * k; pl[3 * j + 2] += (Fz - pl[3 * j + 2]) * k;
    });
    // the pins between tack and head: a membrane pinned along a line hands it forces that alternate node to node (the
    // grid's stretch errors, large next to stiff cloth) around the load it really carries. The luff takes their sum and
    // its first moment: a load varying linearly along it, which is what reaches the spar or the stay.
    let S0x = 0, S0y = 0, S0z = 0, S1x = 0, S1y = 0, S1z = 0, v0 = 1, v1 = 0;
    for (let j = 1; j < nv - 1; j++) {
      const v = j / (nv - 1); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
      S0x += pl[3 * j]; S0y += pl[3 * j + 1]; S0z += pl[3 * j + 2]; S1x += pl[3 * j] * v; S1y += pl[3 * j + 1] * v; S1z += pl[3 * j + 2] * v;
    }
    const nP = 6, pts = this._pts || (this._pts = []);
    pts.length = 0;
    if (nv > 2) {
      // f(v) = S0/n + g (v - vc): total S0, centroid from S1 (the slope limited so the load keeps its sign)
      const vc = 0.5 * (v0 + v1), hw = 0.5 * (v1 - v0) || 0.5;
      const lin = (S0, S1) => { const g = (S1 - S0 * vc) / (hw * hw / 3 * nP); return [S0 / nP, clamp(g, -Math.abs(S0 / nP) / hw, Math.abs(S0 / nP) / hw)]; };
      const [ax, gx] = lin(S0x, S1x), [ay, gy] = lin(S0y, S1y), [az, gz] = lin(S0z, S1z);
      for (let k = 0; k < nP; k++) { const v = v0 + (v1 - v0) * (k + 0.5) / nP, dv = v - vc; pts.push([v, ax + gx * dv, ay + gy * dv, az + gz * dv]); }
    }
    const h = 3 * (nv - 1);
    pts.unshift([0, pl[0], pl[1], pl[2]]); pts.push([1, pl[h], pl[h + 1], pl[h + 2]]);
    // the main's boom: what it puts on the gooseneck and where its lines end on the mast
    const boom = s.key === 'main' && rig.E !== undefined ? this.boomLoads(b, rig) : null;
    // one scale for everything this sail puts on the rig, so its internal pairs (the luff pulled aft by the membrane,
    // the gooseneck pushed forward by the boom) still cancel: at most what the lines' purchases and the crew can pull
    // (a stiff penalty rope hauled against another reports forces no crew could apply) and what the air load and those
    // lines together could put there
    let sum = 0; for (const p of pts) sum += hyp3(p[1], p[2], p[3]);
    if (boom) for (const o of boom.ops) sum += hyp3(o[1], o[2], o[3]);
    const Fa = (b.diag.strips[s.key] && b.diag.strips[s.key].F) || 0, allow = 3 * Fa + 3 * this.lineMax + 300;
    let sc = sum > allow ? allow / sum : 1;
    if (boom && boom.ropeMax > this.lineMax) sc = Math.min(sc, this.lineMax / boom.ropeMax);
    let headFz = 0;
    const X0 = c.x[3 * c.node(0, 0)], Z0 = c.x[3 * c.node(0, 0) + 2], Xh = c.x[3 * c.node(0, nv - 1)], Zh = c.x[3 * c.node(0, nv - 1) + 2];
    for (let k = 0; k < pts.length; k++) {
      const [v, fx, fy, fz] = pts[k], Fx = fx * sc, Fy = fy * sc, Fz = fz * sc, j = k === 0 ? 0 : k === pts.length - 1 ? nv - 1 : -1;
      const X = lerp(X0, Xh, v), Z = lerp(Z0, Zh, v);
      if (s.kind === 'boom' && s.key === 'main') {
        // on the mast (track aft of the axis): the tack at the gooseneck, the head on its halyard (the hauling part
        // down the mast doubles the head's pull in compression)
        this.loadMast(Z, Fx, Fy, Fz, X - this.axisX, 0);
        luff[0] += Fx; luff[1] += Fy;
        if (j === nv - 1) { headFz = Fz; this.loadMast(Z, 0, 0, Math.min(0, Fz)); }
      } else if (stay) {
        if (j === 0) this.tackLoad(stay, Fx, Fy, Fz);
        else if (j === nv - 1) { this.headLoad(stay, Fx, Fy, Fz); headFz = Fz; }
        else stay.P.push([v, Fx, Fy, Fz]);
      } else if (s.kind === 'spin') {
        if (j === nv - 1) { this.loadMast(Math.min(this.zTop, Z), Fx, Fy, Fz); this.loadMast(Math.min(this.zTop, Z), 0, 0, Math.min(0, Fz)); headFz = Fz; }
        else if (j === 0) this.loads.spritTack = [Fx, Fy, Fz];
      }
    }
    if (boom) {
      for (const [z, Fx, Fy, Fz, ox] of boom.ops) this.loadMast(z, Fx * sc, Fy * sc, Fz * sc, ox, 0);
      this.loads.gooseneck = boom.goose * sc; this.loads.vang = boom.vang * sc;
    }
    this.loads.halyard[s.key] = Math.max(0, -headFz);
    this.loads.clothScale = sc;
  }

  // A spritsail's peak: the leech's pull (toward the clew) and its share of the air load there are held by the sprit,
  // a strut from the snotter low on the mast, and the head's edge, a tie back to the throat at the masthead. In the
  // plane of the two (the mast's axis and the boom's bearing): S along the sprit (compression), H along the head;
  // across it, the peak's load goes to the mast's axis at the throat and the snotter by their heights (the turn about the
  // axis it also makes is the sail's twist, which the leech carries to the boom). So the sprit pushes the mast forward
  // low down and the head pulls it aft at the top: the sprit rig's own bend.
  spritLoads(s, Th, Lhx, Lhy, zt, ba) {
    const C = this.C, cb = Math.cos(ba), sb = Math.sin(ba);
    const hP = s.head, zp = zt + (s.headRise || 0), zs = Math.min(zt - 0.3, C.boomZ + (s.snotterZ ?? 0.5));
    // the leech from the peak to the clew (in the sail's plane, along the boom's bearing), and the peak's air load
    const lh = s.foot - hP, lz = C.boomZ - zp, ll = Math.hypot(lh, lz);
    const Fh = Th * lh / ll + (-cb * Lhx + sb * Lhy), Fz = Th * lz / ll, Fn = sb * Lhx + cb * Lhy;
    const ls = Math.hypot(hP, zp - zs), lhd = Math.hypot(hP, zt - zp);
    const esh = hP / ls, esz = (zp - zs) / ls, ehh = -hP / lhd, ehz = (zt - zp) / lhd;
    // S e_s + H e_h = -(Fh, Fz)
    const det = esh * ehz - esz * ehh;
    const S = Math.max(0, (-Fh * ehz + Fz * ehh) / det), H = Math.max(0, (-Fz * esh + Fh * esz) / det);
    // on the mast: -S e_s at the snotter, -H e_h at the throat (h: aft along the boom, (-cb, sb) in the rig's frame)
    this.loadMast(zs, S * esh * cb, -S * esh * sb, -S * esz, 0, 0);
    this.loadMast(zt, H * ehh * cb, -H * ehh * sb, -H * ehz, -this.track, 0);
    const kt = (zp - zs) / (zt - zs);
    this.loadMast(zt, kt * Fn * sb, kt * Fn * cb, 0, -this.track, 0);
    this.loadMast(zs, (1 - kt) * Fn * sb, (1 - kt) * Fn * cb, 0, 0, 0);
    this.loads.sprit = S;
  }
  // A lateen: the yard's share at its halyard reaches the masthead through the halyard (which swings until it points
  // along the load), its hauling part runs down the mast; the tack's share goes into the boom's fore end and so the
  // gooseneck. The leech's head share is at the yard's peak, above the halyard: levered, more than all of it to the
  // halyard and the tack held down against it.
  lateenLoads(s, yard, Lhx, Lhy, zT, zHy) {
    const C = this.C, wp = (C.boomZ + s.luff - zT) / (zHy - zT);
    const mx = yard[0] + wp * Lhx, my = yard[1] + wp * Lhy, W = (s.yardMass ?? 3) * G;
    this.loadMast(this.zTop, mx, my, -W, 0, 0);
    this.loadMast(C.boomZ, yard[2] + (1 - wp) * Lhx, yard[3] + (1 - wp) * Lhy, 0, 0, 0);
    this.pull({ kind: 'mast', i: this.node(this.zTop), ox: 0, oy: 0 }, { kind: 'mast', i: 0, ox: 0, oy: 0 }, Math.hypot(mx, my, W));
  }

  // the boom: every line on it and the clew pull on the gooseneck; lines that end on the mast pull it there too.
  // Returns the loads on the mast (z, F, offset) rather than applying them
  boomLoads(b, rig) {
    const c = rig.cloth, x = c.x, off = c.off, C = this.C, ops = [];
    let Fx = 0, Fy = 0, Fz = 0, vang = 0, ropeMax = 0;
    for (const a of c.att) {
      if (a.e >= off) continue;
      const i = 3 * a.i, e = 3 * a.e, t = a.t, A = a.anchor;
      const tx = A[0] + t * (x[e] - A[0]), ty = A[1] + t * (x[e + 1] - A[1]), tz = A[2] + t * (x[e + 2] - A[2]);
      Fx += a.w * (x[i] - tx); Fy += a.w * (x[i + 1] - ty); Fz += a.w * (x[i + 2] - tz);
    }
    for (const r of c.ropes) {
      if (r.e >= off || !(r.force > 0)) continue;
      const e = 3 * r.e, A = r.anchor, t = r.t, T = r.to, Tl = r.force;
      const px = A[0] + t * (x[e] - A[0]), py = A[1] + t * (x[e + 1] - A[1]), pz = A[2] + t * (x[e + 2] - A[2]);
      const dx = T[0] - px, dy = T[1] - py, dz = T[2] - pz, l = hyp3(dx, dy, dz) || 1;
      const fx = Tl * dx / l, fy = Tl * dy / l, fz = Tl * dz / l;
      Fx += fx; Fy += fy; Fz += fz; ropeMax = Math.max(ropeMax, Tl);
      // a line that ends on the mast (vang, topping lift) pulls the mast back where it ends
      if (Math.abs(T[0] - this.axisX) < 0.2 && Math.abs(T[1]) < 0.1 && T[2] > this.zStep - 0.2) {
        ops.push([clamp(T[2], this.zStep, this.zTop), -fx, -fy, -fz, 0]);
        if (T[2] < C.boomZ) vang = Tl;
      }
    }
    const s = rig.s, wB = (s.boomMass || 0) * G;
    Fz -= wB * Math.cos(this.boat.phi); Fy += wB * Math.sin(this.boat.phi);
    ops.push([C.boomZ, Fx, Fy, Fz, -0.05]);
    return { ops, goose: hyp3(Fx, Fy, Fz), vang, ropeMax };
  }

  // a headsail's tack and head loads, and its hanks' loads on its stay
  tackLoad(st, Fx, Fy, Fz) { if (st.a.kind === 'node') this.loadAt(st.a, Fx, Fy, Fz); }
  headLoad(st, Fx, Fy, Fz) {
    // the head on its halyard at the stay's top: its pull, and the hauling part down the mast
    const a = st.b; this.loadAt(a, Fx, Fy, Fz);
    if (Fz < 0) this.pull(a, { kind: 'mast', i: 0, ox: 0, oy: 0 }, -0.8 * Fz);
  }
  pull(a, b, T) { if (T > 0) this.pulls.push({ a, b, T }); }

  // A sail's load on the rig by membrane statics, row by row up the sail: each row's air load (the cloth's own, node by
  // node, or the strip model's strips) splits between luff and leech, half its normal part to each end; the luff is also
  // pulled aft along the chord by the row's tension (W / 8 (d/c) for a parabolic section of depth d/c, of which the
  // luff takes the share a cross-cut or radial panel layout does not lead to the head and clew, ~40%). The leech
  // tension (what the sheet and vang put on it, at most the purchases allow) pulls the head toward the clew and is
  // carried by the halyard; the vang and sheet load the boom, which pushes on the gooseneck.
  sailLoads(b, s, rig) {
    const C = this.C, st = b.diag.strips[s.key], sh = b.diag.shape[s.key], stay = this.stays[s.key];
    const rows = this._rows || (this._rows = []); rows.length = 0;
    const c = rig && rig.cloth;
    if (c) {
      // the cloth's rows: the air's load on every node (rig frame), the row's chord from luff to leech
      const nu = c.nu, nv = c.nv, f = c.f, x = c.x;
      for (let j = 0; j < nv; j++) {
        let Fx = 0, Fy = 0; const n0 = 3 * c.node(0, j), n1 = 3 * c.node(nu - 1, j);
        for (let i = 0; i < nu; i++) { const n = 3 * c.node(i, j); Fx += f[n]; Fy += f[n + 1]; }
        const k = Math.min(2, Math.floor(3 * j / nv));
        rows.push([x[n0 + 2], Fx, Fy, Math.atan2(x[n1 + 1] - x[n0 + 1], -(x[n1] - x[n0])), (sh && sh[k] ? sh[k].d : 0.12)]);
      }
      // (no more than the air can put on a sail: a normal-force coefficient of ~1.8 on its area at the apparent wind's
      // pressure, a flat plate's most. A flogging cloth's nodes, whipping through the air, summed to 18-63 times their mean
      // load for a second at a time in the Laser's sea trials, and her mast took it)
      const q = b.diag.qMid || 0, cap = 1.8 * q * s.area * (st && st.areaF !== undefined ? st.areaF : 1);
      let tot = 0; for (const r of rows) tot += Math.hypot(r[1], r[2]);
      if (q > 0 && tot > cap) { const k = cap / tot; for (const r of rows) { r[1] *= k; r[2] *= k; } }
    } else for (let i = 0; i < 3; i++) {
      const o = st[i]; if (!Number.isFinite(o.Fn)) continue;
      rows.push([o.zs, o.Fx || 0, o.Fn, sh[i].ang || 0, sh[i].d || 0.12]);
    }
    const luff = this._luffSum = [0, 0, 0];
    if (s.key === 'main') { this._entry = 0; this._entryW = 0; }
    // the leech's half of each row's normal load is carried by the leech tension along the curved leech to its ends:
    // about half of it to the head (up the mast, by the halyard), half to the clew (the boom and sheet)
    let Lhx = 0, Lhy = 0, An0 = 0, tcx = 0, tcy = 0;
    // a lateen's luff is laced to its yard, which hangs on its halyard from the masthead and sits on the boom's fore end
    // at the tack: each row's luff load goes to those two by the yard's lever (the chord's tension closes through the
    // yard and boom, not the mast)
    const lat = s.key === 'main' && s.rig === 'lateen', yard = lat ? (this._yard || (this._yard = [0, 0, 0, 0])) : null;
    const zT = C.boomZ, zHy = C.boomZ + (s.halyardF ?? 0.66) * s.luff;
    if (lat) yard.fill(0);
    for (const [z, Fx, Fy, ang, dep] of rows) {
      const ca = Math.cos(ang), sa = Math.sin(ang), cx = -ca, cy = sa;         // chord, aft from the luff
      const nx = sa, ny = ca;                                                  // its normal (to starboard for a centred chord)
      const An = Fx * nx + Fy * ny, Ac = Fx * cx + Fy * cy;
      const Tc = lat ? 0 : 0.4 * Math.abs(An) / (8 * Math.max(0.1, dep));        // (a flat section carries its load by the leech, not the chord)
      const Lx = 0.5 * An * nx + 0.5 * Ac * cx + Tc * cx, Ly = 0.5 * An * ny + 0.5 * Ac * cy + Tc * cy;
      if (lat) { const w = (z - zT) / (zHy - zT); yard[0] += w * Lx; yard[1] += w * Ly; yard[2] += (1 - w) * Lx; yard[3] += (1 - w) * Ly; }
      else if (s.key === 'main') this.loadMast(Math.min(this.zTop, z), Lx, Ly, 0, -this.track, 0);
      else if (stay) { const v = clamp((z - s.tackZ) / Math.max(0.5, s.luff), 0.03, 0.97); stay.P.push([v, Lx, Ly, 0]); }
      luff[0] += Lx; luff[1] += Ly; tcx += Tc * cx; tcy += Tc * cy;
      // (the leech's half of a row's load runs along the leech to its ends as a string's would: to the head in proportion to
      // how far up it the row is. Split evenly, as it is for a stayed rig's (its bend set with it), an unstayed spar's head
      // took the foot's share too)
      const fh = this.spec.wires.length ? 0.5 : clamp((z - zT) / Math.max(0.5, (s.luff || 1)), 0, 1);
      Lhx += 0.5 * fh * An * nx; Lhy += 0.5 * fh * An * ny; An0 += Math.abs(An);
      if (s.key === 'main') { const w = Math.abs(An); this._entry += w * (ang + Math.sign(An) * Math.atan(4 * dep)); this._entryW += w; }
    }
    // the leech tension: the sheet's load (a cloth sail's, as the cloth's sheet reports it), no more than the purchase
    const lead = Math.min(this.sheetMax, b.diag.rig[s.key + 'Load'] || (s.kind !== 'boom' ? b.diag.rig.jibLoad : 0) || 0);
    // (never less than the membrane's own: a leech carrying a quarter of the sail's normal load along its sag, ~0.5 of it)
    // (and no more than the leech can carry of the sail's own load: a leech holding its half of the normal load W on a sag
    // of ~5% of its length is at ~1.25 W, the sheet's pull beyond that stretching the cloth, not the leech. The cloth's
    // sheet, a penalty line, reported 0.95-1 kN on a Laser beating in 12 kn, three times her sail's ~0.35 kN; taken as
    // her leech's tension it parted her bottom section within seconds of every sea trial)
    const leadB = Math.min(lead, 1.25 * An0);
    let Th = Math.max(0.9 * leadB, 0.5 * An0);
    if (s.key === 'main') {
      // the vang: the boom's compression pushes the gooseneck forward, the vang pulls its foot on the mast aft; the
      // sheet pulls the boom (and so the gooseneck) down
      // (its tension is what the crew hauled it to through its purchase: ~ the most it takes, times the setting squared)
      const V = this.lineMax * clamp(b.ctrl.vang, 0, 1) ** 2;
      const zv = this.zVang, hz = C.boomZ - zv, bl = 0.22 * s.foot, l = Math.hypot(hz, bl);
      // the leech carries the sheet's pull and the vang's, levered down the boom (the vang is on at a fifth of it)
      Th = Math.max(0.9 * leadB, 0.5 * An0) + 0.22 * V * hz / l;
      const zH = Math.min(this.zTop, C.boomZ + s.luff * (b.reefPos ? 1 - 0.16 * b.reefPos : 1));
      // the head pulled toward the clew (where the boom has it), and the halyard's hauling part down the mast (a sleeved
      // luff has no halyard)
      const ba = (b.booms && b.booms.main && b.booms.main.a) || 0, head = { kind: 'mast', i: this.node(zH), ox: -this.track, oy: 0 };
      if (lat) this.lateenLoads(s, yard, Lhx, Lhy, zT, zHy);
      else if (s.rig === 'sprit') this.spritLoads(s, Th, Lhx, Lhy, zH, ba);
      // (the leech leaves the head along its own curve, the roach and the sail's twist carrying it ~12 deg aft of the
      // straight line to the clew: a pull in that direction, not a string to a fixed point)
      else {
        const lx = -s.foot * Math.cos(ba), ly = s.foot * Math.sin(ba), lz = C.boomZ - zH, ll = Math.hypot(lx, ly, lz), hl = Math.hypot(lx, ly) || 1;
        const a12 = 12 * DEG, ca = Math.cos(a12), sa = Math.sin(a12);
        // turn the head-to-clew direction 12 deg toward the horizontal, aft along the boom
        const ex = lx / ll, ey = ly / ll, ez = lz / ll, hx = lx / hl, hy = ly / hl;
        const dx = ex * ca + hx * sa * Math.abs(ez), dy = ey * ca + hy * sa * Math.abs(ez), dz = ez * ca + sa * hl / ll, dn = Math.hypot(dx, dy, dz);
        // (an unstayed spar has only the leech to hold its head fore-and-aft: there the leech is a string from the head to
        // the clew (the boom's end, held by its sheet and vang: the clew's pull is theirs, as before), which pulls the head
        // back toward its line as the spar bends. As a load in a fixed
        // direction it had no such stiffness, and the P-delta of its own pull down the mast bowed a Laser's converged
        // solve 3 m at the top in 20 kn)
        // (the rows' chord tension pulls the luff aft and, as much, the leech forward: the leech's half reaching the head is
        // the head's, pulled forward. Left out, the mast took a net aft pull of the sail's own tension, ~0.4 of its normal
        // load, that nothing balanced: on an unstayed spar, which has no stays to take it, a Laser's top section was at
        // twice its strength close-hauled in 25 kn. A stayed rig's luff round and bend were set with it as it was: there
        // it is left for a recalibration of those.)
        if (!this.spec.wires.length) this.loadMast(zH, -0.5 * tcx, -0.5 * tcy, 0, -this.track, 0);
        if (!this.spec.wires.length) this.pull({ kind: 'mast', i: this.node(zH), ox: -this.track, oy: 0 }, { kind: 'fixed', p: [this.axisX - this.track + lx, ly, C.boomZ] }, Th);
        else this.loadMast(zH, Th * dx / dn, Th * dy / dn, Th * dz / dn, -this.track, 0);
      }
      if (!this.spec.noHalyard && !lat && s.rig !== 'sprit') this.pull(head, { kind: 'mast', i: 0, ox: 0, oy: 0 }, Th);
      if (!lat && s.rig !== 'sprit') this.loadMast(zH, Lhx, Lhy, 0, -this.track, 0);
      // (and the clew's share, through the boom: the part the gooseneck takes, the sheet's lever on the boom being 0.86)
      this.loadMast(C.boomZ, 0.14 * Lhx, 0.14 * Lhy, 0, -this.track, 0);
      // (along the boom, wherever it is swung: squared off, the boom pushes the mast sideways)
      const cb = Math.cos(ba), sb = Math.sin(ba);
      this.loadMast(C.boomZ, V * bl / l * cb, -V * bl / l * sb, -V * hz / l - leadB);
      this.loadMast(zv, -V * bl / l * cb, V * bl / l * sb, V * hz / l);
      this.loads.vang = V; this.loads.gooseneck = Math.hypot(V * bl / l, V * hz / l + leadB);
    } else if (stay) {
      // the leech toward the clew (the sheet's side), the halyard down the mast
      const cl = (s.kind === 'loose' ? Math.sign(b.side.jib || 1) : 1) * (s.min || 0.2);
      const cx = s.tackX - s.foot * Math.cos(cl), cy = s.foot * Math.sin(cl);
      this.pull(stay.b, { kind: 'fixed', p: [cx, cy, s.tackZ + (s.footRise || 0)] }, Th);
      this.pull(stay.b, { kind: 'mast', i: 0, ox: 0, oy: 0 }, 0.6 * Th);
      this.loadAt(stay.b, Lhx, Lhy, 0);
    } else if (s.kind === 'spin') {
      // a free-flying gennaker: its halyard at the masthead (the luff's tension ~ its sheet's), its tack on the sprit
      const zH = Math.min(this.zTop, s.tackZ + s.luff);
      this.loadMast(zH, 0.3 * Th, 0.2 * Th * Math.sign(b.side.gennaker || 1), -2 * Th);
      this.loads.spritTack = [-0.7 * Th, 0.3 * Th * Math.sign(b.side.gennaker || 1), 0.5 * Th];
    }
    this.loads.halyard[s.key] = Th;
  }

  // ---------------------------------------------------------------- stays' sag
  // point loads P (v, F) on a stay: split into the part across the stay (its sag) and along it (to its ends)
  stayPrep(st) {
    const pa = [0, 0, 0], pb = [0, 0, 0];
    this.pos(st.a, this.u, pa); this.pos(st.b, this.u, pb);
    let ex = pb[0] - pa[0], ey = pb[1] - pa[1], ez = pb[2] - pa[2]; const L = hyp3(ex, ey, ez); ex /= L; ey /= L; ez /= L;
    const P = st.P.sort((p, q) => p[0] - q[0]);
    const Q = st.Q || (st.Q = []); Q.length = 0;
    let ta = [0, 0, 0], tb = [0, 0, 0];
    for (const [v, Fx, Fy, Fz] of P) {
      const al = Fx * ex + Fy * ey + Fz * ez, qx = Fx - al * ex, qy = Fy - al * ey, qz = Fz - al * ez;
      Q.push([v, qx, qy, qz]);
      // across: shared between the ends as a simply supported string; along: to the head and tack alike
      for (let k = 0; k < 3; k++) { const q = [qx, qy, qz][k], a = [ex, ey, ez][k] * al * 0.5; ta[k] += q * (1 - v) + a; tb[k] += q * v + a; }
    }
    this.loadAt(st.b, tb[0], tb[1], tb[2]);
    if (st.a.kind !== 'fixed') this.loadAt(st.a, ta[0], ta[1], ta[2]);
    // M(s) of the string (per unit tension it is the sag), and A2 = 1/2 int |M'|^2 ds
    const Ns = 16, M = st.M || (st.M = new Float64Array(3 * (Ns + 1)));
    for (let k = 0; k <= Ns; k++) {
      const sv = k / Ns; let mx = 0, my = 0, mz = 0;
      for (const [v, qx, qy, qz] of Q) { const w = sv < v ? sv * (1 - v) : v * (1 - sv); mx += qx * w * L; my += qy * w * L; mz += qz * w * L; }
      M[3 * k] = mx; M[3 * k + 1] = my; M[3 * k + 2] = mz;
    }
    let A2 = 0;
    for (let k = 0; k < Ns; k++) { const ds = L / Ns, gx = (M[3 * k + 3] - M[3 * k]) / ds, gy = (M[3 * k + 4] - M[3 * k + 1]) / ds, gz = (M[3 * k + 5] - M[3 * k + 2]) / ds; A2 += 0.5 * (gx * gx + gy * gy + gz * gz) * ds; }
    st.A2 = A2; st.Ls = L;
  }

  // ---------------------------------------------------------------- per step
  update(b, dt) {
    this.count++;
    const every = b.lod >= 2 || !b.sailSys ? 12 : b.lod >= 1 ? 8 : 4;
    if (this.ready && this.count % every !== 0) return;
    this._dtSolve = dt * (this.ready ? every : 1);
    // (while a cloth-sailed boat is set aside at L2 for a moment, the strip model sailing, the rig stays as the cloth
    // left it: the cloth flies on from there when it comes back)
    // (for a moment only: a boat that stays on the strip model, a slow device's, has its rig solved from the strips)
    const aside = (b.sailSys && !b.sailSys.active(b)) || (b.lod >= 2 && b.sailModel && b.sailModel !== 'strip');
    this.asideT = aside ? (this.asideT || 0) + dt * every : 0;
    if (this.ready && aside && this.asideT < 3) return;
    const C = this.C;
    // the rotating mast turns toward where the luff pulls it (over ~0.3 s)
    if (this.spec.rotating) this.rot += (this.rotTarget - this.rot) * clamp(dt * every / 0.3, 0, 1);
    this.gatherLoads(b);
    // the backstay adjuster
    // (the backstay adjuster; the running backstays: the windward one set up, the leeward one let off)
    const wsd = Math.sign(b.diag.awaMid || 0) || 1;
    // (ctrl.runners 0: neither runner set up: the crew late with the new one in a gybe, or a runner lost)
    const runOff = b.ctrl.runners === 0;
    for (const w of this.wires) w.Lrest = w.runner && (runOff || w.side !== wsd) ? w.Lrest0 * 1.03 : w.Lrest0 - (w.adjust ? w.adjust * clamp(b.ctrl.backstay ?? 0, 0, 1) : 0);
    for (const st of Object.values(this.stays)) this.stayPrep(st);
    // the loads, low-passed over ~0.15 s (a quasi-static rig does not follow the cloth's every flutter)
    const k = this.ready ? clamp(dt * every / 0.15, 0, 1) : 1, F = this.F, Fs = this.Fs || (this.Fs = Float64Array.from(F));
    for (let i = 0; i < F.length; i++) { Fs[i] += (F[i] - Fs[i]) * k; F[i] = Fs[i]; }
    for (const st of Object.values(this.stays)) {
      const Ms = st.Ms || (st.Ms = Float64Array.from(st.M));
      for (let i = 0; i < Ms.length; i++) { Ms[i] += (st.M[i] - Ms[i]) * k; st.M[i] = Ms[i]; }
      st.A2s = (st.A2s ?? st.A2) + (st.A2 - (st.A2s ?? st.A2)) * k; st.A2 = st.A2s;
    }
    const uGood = this.uGood || (this.uGood = Float64Array.from(this.u));
    const isBad = () => {
      if (this.buckled) return true;
      // (the bow against the spar's chord from its step to its head: a stayed mast leaning to leeward on its shrouds'
      // stretch is not bent. Counted from the vertical, a Melges 24's mast leaning 0.6 m on its 3.7 mm caps in 20 kn
      // (3.3 deg: wire at 0.8 of its break stretches ~0.6%) passed the 6% mark, the rig was declared failed, and the
      // loads extrapolated from the fraction it 'stood' parted its caps at once; a lean past a quarter of the length
      // is a solve gone astray)
      // (an unstayed spar is a cantilever from its deck: its deflection from the vertical is its bend. Its stress is what
      // breaks it (the damage model reads it), and its converged solve is the answer; past 60% of its length it is astray)
      const st = this.spec.wires.length > 0, Lm = this.zTop - this.zStep, lim = (st ? 0.06 : 0.12) * Lm, u = this.u, nt = 5 * (this.nm - 1);
      for (let i = 0; i < this.nm; i++) {
        const f = st ? (this.z[i] - this.zStep) / Lm : 0, bx = u[5 * i] - f * u[nt], by = u[5 * i + 2] - f * u[nt + 2];
        if (!(Math.abs(bx) < lim && Math.abs(by) < lim && Math.abs(u[5 * i]) < (st ? 0.25 : 0.6) * Lm && Math.abs(u[5 * i + 2]) < (st ? 0.25 : 0.6) * Lm)) return true;
      }
      for (const w of this.wires) if (!(w.T < 2 * w.brk)) return true;
      return false;
    };
    this.solve(this.ready ? 5 : 10);
    if (RigStructure.debug) RigStructure.debug(this, b);
    // a column past its critical load, or loads beyond anything the rig could stand (a stayed spar bent past 6% of its length (an unstayed one 12%),
    // a wire at twice its breaking load): the rig has failed at this load. Report it (the damage model decides what
    // breaks), and draw the shape at the largest fraction of the load the rig still stands
    // (an unstayed spar's 12% is a limit on the shape, not a failure. Coupled to a cloth sail whose luff follows it, the
    // quasi-static spar has no stable shape past it: solved through, a Laser's top bowed 3.8 m at 12 kn and her speed fell
    // from 5.4 to 3.3 kn. Its step past the limit is not taken (the spar holds the shape it had: the stress it reads is
    // that shape's, never a fraction's extrapolated: that toggled solve to solve and counted as load cycles))
    let bad = isBad(), frac = 1;
    this.overload = false;
    if (bad && !this.spec.wires.length) {
      const held = this.uHeld || uGood;
      this.u.set(held);
      for (const e of this.el) { e.N = e.EA / e.L * (this.u[5 * e.j + 4] - this.u[5 * e.i + 4]); e.Ng = e.N; }
      this._ov = null; bad = false;
    } else if (bad) {
      this.overload = true;
      const F0 = Float64Array.from(this.F);
      // (the loads at the whole of it are extrapolated from the first fraction solved, 0.6: the lines' pulls (a leech, a
      // vang, a halyard) are not in F and do not scale, so a rig 'bad' at 0.6 is no better at 0.13, and dividing that
      // solution's loads by 0.13 made a Laser's top section, running in 20 kn at a third of its yield, part)
      let ov = null;
      for (let k = 0; k < 4 && bad; k++) {
        frac *= 0.6; this.u.set(uGood);
        for (const e of this.el) { e.N = e.EA / e.L * (this.u[5 * e.j + 4] - this.u[5 * e.i + 4]); e.Ng = e.N; }
        for (let i = 0; i < F0.length; i++) this.F[i] = F0[i] * frac;
        this.solve(8); bad = isBad();
        if (k === 0) { const sr = this._stress(); ov = { T: this.wires.map((w) => (w.pre || 0) + Math.max(0, w.T - (w.pre || 0)) / frac), U: sr.spU.map((x) => x / frac) }; }
      }
      this._ov = ov;
      if (bad) {
        // nothing stands: back toward the rig at rest
        this.u.set(this.u0dock || uGood);
        for (const e of this.el) { e.N = e.EA / e.L * (this.u[5 * e.j + 4] - this.u[5 * e.i + 4]); e.Ng = e.N; }
      }
      this.F.set(F0);
    } else if (this.converged) uGood.set(this.u);
    if (!this.spec.wires.length) (this.uHeld || (this.uHeld = new Float64Array(this.u.length))).set(this.u);
    this.failed = bad; this.loadFrac = frac;
    // the shape the sails' luffs follow: eased toward the solution (~0.3 s, at most ~0.3 m/s). A cloth whose pinned luff
    // is jerked answers with a jerk in its pins' loads: moved at once, the luff and the rig would feed each other.
    const us = this.us || (this.us = Float64Array.from(this.u)), ku = clamp(dt * every / 0.3, 0, 1), cap = 0.3 * dt * every;
    // (the strip model's bend and sag over ~1 s: its sails' shape, the heel and the crew's hiking otherwise chase each
    // other through the rig)
    this._kS = clamp(dt * every / 1.0, 0, 1);
    const kSag = clamp(dt * every / 3.0, 0, 1);
    for (const st of Object.values(this.stays)) if (st.M) { const m = this._sagNow(st); st.sagSlow = st.sagSlow === undefined ? m : st.sagSlow + (m - st.sagSlow) * kSag; }
    for (let i = 0; i < us.length; i++) us[i] += clamp((this.u[i] - us[i]) * ku, -cap, cap);
    for (const st of Object.values(this.stays)) st.Ts = st.Ts === undefined ? st.T : st.Ts + (st.T - st.Ts) * ku;
    // the shapes the sails and the drawing follow are the rig's deflection from its dock tune: the sails were cut for
    // the rig as tuned (its rake and pre-bend), and the model is drawn as it stands at the dock
    const ur = this.ur || (this.ur = new Float64Array(us.length));
    for (let i = 0; i < us.length; i++) ur[i] = us[i] - this.u0dock[i];
    this.ready = true; this._dtOut = dt * every;
    this.outputs(b);
  }

  // mast displacement (x, y) at height z (Hermite between nodes) -> out; + the track's offset for rotation
  mastDisp(z, out) {
    const zz = this.z, u = this.ur || this.us || this.u; let i = 0;
    while (i < this.nm - 2 && zz[i + 1] < z) i++;
    const L = zz[i + 1] - zz[i], t = clamp((z - zz[i]) / L, 0, 1);
    const h1 = 1 - 3 * t * t + 2 * t * t * t, h2 = (t - 2 * t * t + t * t * t) * L, h3 = 3 * t * t - 2 * t * t * t, h4 = (-t * t + t * t * t) * L;
    const b0 = 5 * i, b1 = 5 * (i + 1);
    out[0] = h1 * u[b0] + h2 * u[b0 + 1] + h3 * u[b1] + h4 * u[b1 + 1];
    out[1] = h1 * u[b0 + 2] + h2 * u[b0 + 3] + h3 * u[b1 + 2] + h4 * u[b1 + 3];
    out[2] = u[b0 + 4] * (1 - t) + u[b1 + 4] * t;
    return out;
  }
  // where the main's luff is at height z (rig frame): the mast's axis displaced, the track aft of it, turned with a
  // rotating mast
  // (the luff takes the mast's bend between its tack and its head: its bow against the chord from gooseneck to head;
  // the whole spar leaning, which moves the head and the boom together, leaves the sail's cut as it is)
  luffAt(z, out) {
    const C = this.C, M = this._M || (this._M = C.sails.find((s) => s.key === 'main')), z0 = C.boomZ, z1 = Math.min(this.zTop, z0 + (M ? M.luff : 5));
    const a = this._la || (this._la = [0, 0, 0]), b = this._lb || (this._lb = [0, 0, 0]);
    this.mastDisp(z0, a); this.mastDisp(z1, b); this.mastDisp(z, out);
    const f = clamp((z - z0) / (z1 - z0), 0, 1);
    // (fore-and-aft only: the mast's sideways bow against the luff's chord is drawn and carried in the loads, but fed to
    // the cloth it turns a heeled J/70's main inside out at the head in 20 kn (the luff to windward of its chord,
    // alternating with the camber): the cloth needs its luff's lateral curve handled first)
    out[0] -= a[0] + (b[0] - a[0]) * f; out[1] = 0;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    out[0] += this.axisX - this.track * c; out[1] += this.track * s;
    return out;
  }
  // a point on a headsail's stay at luff fraction v (tack 0 .. head 1): the stay's chord between its displaced ends and
  // its sag there -> out; null if the sail has no stay here
  stayAt(key, v, out) {
    const st = this.stays[key]; if (!st || !st.M) return null;
    const pa = this._pa || (this._pa = [0, 0, 0]), pb = this._pb || (this._pb = [0, 0, 0]);
    const uu = this.ur || this.us || this.u;
    this.pos(st.a, uu, pa); this.pos(st.b, uu, pb);
    const Ns = 16, f = clamp(v, 0, 1) * Ns, k = Math.min(Ns - 1, Math.floor(f)), w = f - k, M = st.M, T = Math.max(50, st.Ts ?? st.T);
    for (let c = 0; c < 3; c++) out[c] = pa[c] + (pb[c] - pa[c]) * v + ((1 - w) * M[3 * k + c] + w * M[3 * k + 3 + c]) / T;
    return out;
  }

  // a stay's largest sag (m), eased: what its sail's luff takes
  // (what the sails' luffs take is the stay's sag over ~3 s, not its sag of the moment: a quasi-static stay whose sag
  // follows the roll a few tenths of a second late (the loads' and the shape's easing, the solve's update interval) feeds
  // the headsail's force back in phase with the roll rate, and pumped a Dragon running in 20 kn to ±48°; a real stay,
  // light and taut, follows its load without lag, and a constant sag of the same size leaves the boat steady)
  staySag(key) {
    const st = this.stays[key]; if (!st || !st.M) return 0;
    return st.sagSlow ?? this._sagNow(st);
  }
  _sagNow(st) {
    let mx = 0; const T = Math.max(50, st.Ts ?? st.T);
    for (let k = 0; k <= 16; k++) mx = Math.max(mx, hyp3(st.M[3 * k], st.M[3 * k + 1], st.M[3 * k + 2]) / T);
    return mx;
  }

  // the mast's compression, bending and stress (the largest fraction of its yield, overall and in each span) as it stands
  _stress() {
    const u = this.u;
    let comp = 0, mMax = 0, util = 0;
    const spU = (this._spU || (this._spU = this.spec.spans.map(() => 0))).fill(0);
    const St = this.spec.wires.length ? null : this._statics();
    for (const e of this.el) {
      comp = Math.max(comp, -e.N);
      const L2 = e.L, bi = 5 * e.i, bj = 5 * e.j;
      if (St) {
        // (an unstayed spar's moments from its loads' statics, the larger at the element's two ends)
        e.M0 = Math.max(St[e.i][0], St[e.j][0]); e.M2 = Math.max(St[e.i][1], St[e.j][1]);
        mMax = Math.max(mMax, e.M0, e.M2);
      } else for (const o of [0, 2]) {
        const EI = o === 0 ? e.EIx : e.EIy;
        const k0 = (-6 * u[bi + o] - 4 * L2 * u[bi + o + 1] + 6 * u[bj + o] - 2 * L2 * u[bj + o + 1]) / (L2 * L2);
        const M = Math.abs(EI * k0);
        mMax = Math.max(mMax, M);
        e['M' + o] = M;
      }
      // (the two planes' bending stresses peak at different points of the wall: on a thin elliptical tube the worst
      // fibre takes their root sum square, exactly)
      const ue = (Math.max(0, -e.N) / e.A + Math.hypot(e.M0 / e.Zx, e.M2 / e.Zy)) / e.sy;
      util = Math.max(util, ue); spU[e.span] = Math.max(spU[e.span], ue);
    }
    return { comp, mMax, util, spU };
  }
  // An unstayed spar is statically determinate: above its collar the bending moment at a height is the moment of the loads
  // above it (the sail's, the leech's pull, its weight and inertia, at the shape it stands in: their P-delta included),
  // between heel and collar it falls to nothing at the heel. Read from the solved curvature, its stress was only as good as
  // the coupled cloth-and-spar solve, which holds its shape at a limit (update): the statics see the load whole.
  _statics() {
    const n = this.nm, u = this.u, z = this.z, F = this.F;
    const P = this._stP || (this._stP = Array.from({ length: n }, () => [0, 0, 0, 0, 0, 0]));   // node: x, y, z, Fx, Fy, Fz
    for (let i = 0; i < n; i++) { const p = P[i], b = 5 * i; p[0] = this.axisX + u[b]; p[1] = u[b + 2]; p[2] = z[i] + u[b + 4]; p[3] = F[b]; p[4] = F[b + 2]; p[5] = F[b + 4]; }
    const pa = [0, 0, 0], pb = [0, 0, 0];
    for (const pl of this.pulls) {
      this.pos(pl.a, u, pa); this.pos(pl.b, u, pb);
      const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2], l = hyp3(dx, dy, dz) || 1;
      if (pl.a.kind === 'mast') { const p = P[pl.a.i]; p[3] += pl.T * dx / l; p[4] += pl.T * dy / l; p[5] += pl.T * dz / l; }
      if (pl.b.kind === 'mast') { const p = P[pl.b.i]; p[3] -= pl.T * dx / l; p[4] -= pl.T * dy / l; p[5] -= pl.T * dz / l; }
    }
    const M = this._stM || (this._stM = Array.from({ length: n }, () => [0, 0]));
    const iCol = this.supports.length > 1 ? this.supports[1].i : 0;
    for (let i = 0; i < n; i++) {
      let mx = 0, my = 0;
      if (i >= iCol) for (let k = i + 1; k < n; k++) {
        const q = P[k], ex = q[0] - P[i][0], ey = q[1] - P[i][1], ez = q[2] - P[i][2];
        mx += q[3] * ez - q[5] * ex; my += q[4] * ez - q[5] * ey;
      }
      M[i][0] = Math.abs(mx); M[i][1] = Math.abs(my);
    }
    // (heel to collar: the collar's moment falling to nothing at the pinned heel)
    for (let i = 0; i < iCol; i++) { const f = (z[i] - z[0]) / Math.max(1e-6, z[iCol] - z[0]); M[i][0] = M[iCol][0] * f; M[i][1] = M[iCol][1] * f; }
    return M;
  }
  outputs(b) {
    const C = this.C, d = b.diag, L = this.loads, u = this.u;
    // mast bend: the largest fore-and-aft offset of the mast from the straight line from the gooseneck to the masthead
    // (+ = the middle forward), as a sailor sights it up the mainsail's luff groove
    const p = [0, 0, 0], g0 = this.mastDisp(C.boomZ, [0, 0, 0]), g1 = this.mastDisp(this.zTop, [0, 0, 0]);
    let bend = 0, side = 0;
    for (let k = 1; k < 20; k++) {
      const z = lerp(C.boomZ, this.zTop, k / 20), f = k / 20; this.mastDisp(z, p);
      const dx = p[0] - lerp(g0[0], g1[0], f), dy = p[1] - lerp(g0[1], g1[1], f);
      if (Math.abs(dx) > Math.abs(bend)) bend = dx;
      if (Math.abs(dy) > Math.abs(side)) side = dy;
    }
    this.bendMM = bend * 1000; this.sideMM = side * 1000;
    // the strip model's bend (0..1: 1 = the old full-backstay bend) from the mid-luff offset against the luff's chord
    const M0 = b.sailBy.main;
    if (M0) {
      const zl0 = C.boomZ, zl1 = Math.min(this.zTop, C.boomZ + M0.luff), zm = 0.5 * (zl0 + zl1);
      const a0 = this.mastDisp(zl0, [0, 0, 0])[0], a1 = this.mastDisp(zl1, [0, 0, 0])[0], am = this.mastDisp(zm, [0, 0, 0])[0];
      // (the sail is cut with the luff round of the mast's design bend: bent that much, the strip model's 0.35, its
      // nominal; each 1.8% of the luff more is one unit)
      this.luffOff = am - 0.5 * (a0 + a1);
      const bN = clamp((this.luffOff - (this.luffRound ?? 0.35 * 0.018 * M0.luff)) / (0.018 * M0.luff) + 0.35, -0.3, 1.5);
      this.bendN = this.bendN === undefined || !this._kS ? bN : this.bendN + (bN - this.bendN) * this._kS;
    }
    // forestay sag (mm) at its worst point, and the strip model's sag
    const J = b.sailBy.jib, st = this.stays.jib;
    if (st && st.M) {
      let mx = 0; const T = Math.max(50, st.T);
      for (let k = 0; k <= 16; k++) mx = Math.max(mx, hyp3(st.M[3 * k], st.M[3 * k + 1], st.M[3 * k + 2]) / T);
      this.sagMM = mx * 1000;
      const sN = clamp((st.sagSlow ?? mx) / (0.012 * J.luff * (J.sagK ?? 1)), 0, 1.5);
      this.sagN = sN;
    } else { this.sagMM = 0; this.sagN = 0; }
    // wire loads, the mast's compression and bending, the step and chainplates
    const W = {}, spec = {};
    for (const w of this.wires) {
      const k = w.key, i = w.side > 0 ? 1 : 0;
      const T = this.overload && this._ov ? Math.max(w.T, this._ov.T[this.wires.indexOf(w)]) : w.T;
      if (w.side) { W[k] = W[k] || [0, 0]; W[k][i] = Math.max(W[k][i], T); } else W[k] = Math.max(W[k] || 0, T);
      spec[k] = w.brk;
    }
    const sr = this._stress(), comp = sr.comp, mMax = sr.mMax, spU = sr.spU;
    let util = sr.util, pcr = 0;
    if (this.overload && this._ov) {
      // an overloaded rig is drawn at the fraction of the load it stands: its loads at the whole of it, from that
      // solution scaled up (a lower bound where it stood nothing)
      for (let k = 0; k < spU.length; k++) spU[k] = Math.max(spU[k], this._ov.U[k]);
      util = Math.max(util, ...spU);
    }
    // P / Pcr: the solved rig's own (its tangent stiffness singular at 1 / pcr times the mast's compression). An Euler
    // column on each panel between rigid pinned supports misses both ways: the mast is continuous over the spreaders
    // (the lightly loaded panel above holds the one below: it read 0.7 on a cruiser whose rig takes 0.5, 1.4 on Joshua's
    // at 0.5), and the stays stretch (a fractional rig's whole mast bows fore-and-aft: 0.4 on a J/70 at 0.6). Checked
    // every ~0.25 s: it moves with the loads, which the rig low-passes over 0.15 s.
    if (this.buckled) pcr = 1;
    else { this._lcrT = (this._lcrT ?? 1) + (this._dtOut ?? 1); if (this._lcrT >= 0.25 || !(this.lcr > 0)) { this._lcrT = 0; this.criticalFactor(); } pcr = 1 / this.lcr; }
    if (this.bridle && this.stays.jib && this.stays.jib.e) {
      // the two bridle wires in equilibrium with the forestay's pull on their apex: solve the 3x2 system in least squares
      const st = this.stays.jib, T = st.T, e = st.e, br = this.bridle, f = [T * e[0], T * e[1], T * e[2]];
      const u1 = br.ends[0].map((v, k) => v - br.foot[k]), u2 = br.ends[1].map((v, k) => v - br.foot[k]);
      const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2); for (let k = 0; k < 3; k++) { u1[k] /= l1; u2[k] /= l2; }
      const a11 = u1[0] * u1[0] + u1[1] * u1[1] + u1[2] * u1[2], a12 = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2], a22 = u2[0] * u2[0] + u2[1] * u2[1] + u2[2] * u2[2];
      const b1 = -(f[0] * u1[0] + f[1] * u1[1] + f[2] * u1[2]), b2 = -(f[0] * u2[0] + f[1] * u2[1] + f[2] * u2[2]), det = a11 * a22 - a12 * a12;
      W.bridle = [Math.max(0, (b1 * a22 - a12 * b2) / det), Math.max(0, (a11 * b2 - a12 * b1) / det)]; spec.bridle = br.brk;
    }
    const sb = this.stepF;
    Object.assign(L, W);
    L.mastComp = comp; L.mastStep = [sb[0], sb[1], sb[2]]; L.mastMoment = mMax; L.mastStress = util; L.mastSpans = this.spec.spans.map((sp, k) => ({ z0: sp.z0, z1: sp.z1, util: spU[k] })); L.buckling = this.buckled ? 1 : pcr; L.buckled = !!this.buckled;
    // for js/damage.js: the lowers of a side together (it rates them as one part), and each load's breaking strength
    // (the wires' from their size; the mast's compression against its critical load)
    const lowerKeys = ['lowerShroud', 'lowerFwd', 'lowerAft'].filter((k) => W[k]);
    if (lowerKeys.length) L.lowerShrouds = [0, 1].map((i) => lowerKeys.reduce((a, k) => a + W[k][i], 0));
    const mbl = L.mbl || (L.mbl = {});
    for (const k in spec) mbl[k] = spec[k];
    if (lowerKeys.length) mbl.lowerShrouds = lowerKeys.reduce((a, k) => a + spec[k], 0);
    mbl.mastComp = pcr > 0.01 ? comp / pcr : 1e9;
    if (this.spritStrut) {
      const s = this.spritStrut, k0 = s.node, dz = u[k0.dof + 2];
      L.bowsprit = { comp: Math.max(0, -s.kAx * (u[k0.dof] * (k0.p[0] - s.root[0]) + dz * (k0.p[2] - s.root[2])) / s.L), moment: Math.abs(s.kV * dz * s.L), stress: Math.abs(s.kV * dz * s.L) / s.Zv / s.sy };
    } else if (L.spritTack && C.bowsprit) {
      const [fx, fy, fz] = L.spritTack, ext = C.bowsprit * (b.genDeploy ?? 1);
      L.bowsprit = { comp: Math.max(0, -fx), moment: Math.hypot(fy, fz) * ext };
    }
    L.rotation = this.rot; L.overload = !!this.overload; L.loadFrac = this.loadFrac ?? 1;
    b.rigLoads = L;
    spec.mastYieldMoment = this._yM || (this._yM = Math.min(...this.el.map((e) => e.Zx * e.sy)));
    spec.mastMass = this.massMast;
    b.rigSpec = spec;
    // diag.rig for the panel
    const dr = d.rig;
    dr.bendMM = this.bendMM; dr.sideMM = this.sideMM; dr.sagMM = this.sagMM; dr.mastRot = this.rot;
    if (W.backstay !== undefined) dr.backstayLoad = Array.isArray(W.backstay) ? Math.max(...W.backstay) : W.backstay;
    dr.shroudLoad = W.capShroud ? Math.max(...W.capShroud) : 0; dr.forestayLoad = W.forestay || 0; dr.mastComp = comp;
  }
}
