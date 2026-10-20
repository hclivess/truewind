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

import { G, DEG, KT, airDensity } from './env.js';
import { HullHydro, hullForm, hullParts, calibrate } from './hull.js';
import { mastXAt, mastXOf, boomContactAngle, goose, sheetLen, boomAngleForSheet, easeForBoomAngle, sheetDir, boomBend, boomDip, boomLen } from './boom.js';
export { mastXAt, rigWires } from './boom.js';
import { LOCKABLE, initLines, stepLines, swapJib } from './linehandlers.js';
export { LOCKABLE };
import { Engine } from './engine.js';
import { RigStructure } from './rig-structure.js';
import { REEF, reefAt, reefedSail, normaliseTopsail, planChord } from './sail/plan.js';
import { foilSpec, foilState, foilGeom, foilCoef as foilCoefR, bulbDrag, wingletDrag, kickUpdate, depthAt } from './foils.js';
import { helmSpec, stockTorque, helmForce, helmFeel, rudderStep } from './helm.js';
import { massProps } from './massprops.js';
import { FAMOUS } from './classes/famous.js';
import { RACE } from './classes/race.js';
import { SPEED } from './classes/speed.js';
import { rrOverHump } from './classes/util.js';
import { Surface } from './hydrofoil.js';
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export const RHO_A = 1.225, RHO_W = 1025, NU_W = 1.19e-6;
const BRK_CS = 2.5;                      // slamming coefficient of a breaking crest's jet on the hull (see step)
const D0 = Object.freeze({ x: 0, z: 0 });
// the time over which a section's immersion is averaged for the surge Froude-Krylov load (js/hull.js immerseStations):
// several periods of the chop a small boat meets, short against a change of heel or a lifted bow
const FK_LP_T = 5;

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
// the pose a boat is drawn in, alpha (0..1) of the way from its previous physics state p to its state b. The
// heading and the heel are angles kept in -pi..pi: each goes the short way round (a capsized boat's heel through pi
// went the long way, through upright, for a frame)
export function drawPose(p, b, alpha) {
  const ang = (a0, a1) => a0 + Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) * alpha;
  return { x: lerp(p.x, b.x, alpha), z: lerp(p.z, b.z, alpha), psi: ang(p.psi, b.psi), heave: lerp(p.heave, b.heave, alpha), pitch: lerp(p.pitch, b.pitch, alpha), phi: ang(p.phi, b.phi) };
}

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
    // (x: the centre of the drawn long keel; its lift acts a quarter chord ahead, at the forefoot: js/foils.js)
    keel: { x: 0.42, z: -0.3, area: 1.7, ARe: 0.95, stall: 26 * DEG, cd0: 0.013, span: 0.35, chord: 3.6, long: true },
    rudder: { x: -2.78, z: -0.28, area: 0.34, ARe: 2.4, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 0.75, chord: 0.5, transom: true, loadRef: 900 },
    hullLat: { area: 0.9, cd: 0.9, z: -0.1 },
    windage: { area: 3.1, z: 2.1, cd: 0.95 },
    // mast stepped on the cabin top 2.1 m aft of the stem (photos of hull #66: 37% of LOD from the bow)
    mastX: 0.72, mastHeight: 8.4, boomZ: 1.5, keelBulb: false,
    targetHeel: 18 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 900,
    // (her crew reefs early, as a small cruiser's does: the first reef in ~15 kn of true wind close-hauled, the second
    // in ~21; later off the wind)
    autoReef: { up: [15, 21], off: [21, 27] }, reefWind: [15, 21],
    // (a masthead rig: the backstay pulls against the forestay at the same masthead, so it tightens the forestay and
    // bends the stout mast little; a fractional rig's backstay bends the mast above its hounds, 0.75 by default)
    backstayBend: 0.35,
    // line handlers (js/linehandlers.js): a traditional small cutter. Bronze winches with horn cleats for the jib
    // sheets and (at the mast foot) the jib halyard, a V-jammer for the staysail sheet, cam on the mainsheet fiddle,
    // push-button traveller car, cunningham on a mast horn cleat, outhaul in a clam on the boom; classic cream ropes
    lines: { main: { handler: 'cam', n: 4, at: 'car' }, trav: { handler: 'pinStop', at: 'car' }, jib: { handler: 'winchHorn', at: 'winch' },
      stay: { handler: 'jam', n: 2, at: 'cabin' }, vang: { handler: 'cam', n: 6, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' },
      outhaul: { handler: 'clam', n: 4, at: 'boom' }, backstay: { handler: 'cam', n: 6, at: 'deck' }, jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
    ropeStyle: 'classic',
    // auxiliary (js/engine.js): a long-shaft outboard on a transom bracket to port of the barn-door rudder — what the
    // boats carry (Blue Water Boatworks fitted no inboard; owners' listings: Tohatsu 4 hp long shaft, Mercury 5,
    // British Seagull 5). Tohatsu MFS4: 4 hp at 5000 rpm, 123 cc single, 2.15:1, 7.8 x 6 in three-blade, 26 kg (not in
    // the designer's 1,021 kg). Steered by the rudder. A lifting bracket on the transom (x from the hull's stern station,
    // js/engine.js transomX): 20 in shaft, clamp 0.35 m up with the prop 0.28 m down; slid up 0.42 m clear when stopped.
    engine: { type: 'outboard', model: 'Tohatsu MFS4 long shaft', kW: 2.94, rpmMax: 5000, rpmIdle: 1100, cyl: 1, fuel: 'petrol', gear: 2.15,
      prop: { D: 0.198, P: 0.152, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-3.14, -0.45, -0.28], mount: [-3.0, -0.45, 0.35], lift: 0.42,
      mass: 26, inMass: false, tilts: true, steers: false, exhaust: [-3.14, -0.45, 0.12] },
    sails: [
      { key: 'main', kind: 'boom', area: 10.4, luff: 6.5, foot: 3.0, head: 0.15, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
        cd0: 0.07, ARe: 3.2, min: 2 * DEG, max: 80 * DEG, trav: [-4 * DEG, 12 * DEG], Iboom: 42, boomMass: 18, reefs: 2,
        vangBend: 0.08, sheetBend: 0.05, color: 0x9c4f2e,
        // end-boom sheeting to a track across the stern deck; an aluminium boom (~100 x 60 mm, EI ~80 kN m^2, yields at
        // ~4.5 kN m); rope vang and topping lift; a cruiser rigs a preventer and carries a boom brake
        track: { x: -2.44, z: 1.0, half: 0.55, s: 2.88 }, boomEI: 8e4, boomMmax: 4500, vang: 'rope', vangMax: 2500,
        preventer: 8000, brake: 250 },
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
    planing: 1,                                                  // (over its hump it planes: js/classes/util.js rrOverHump)
    // (the fin where the J/70's is: its quarter chord 0.8 m aft of the mast)
    keel: { x: 0.25, z: -0.85, area: 0.58, ARe: 5.0, stall: 14 * DEG, cd0: 0.009, span: 1.17, chord: 0.5 },
    // the rudder hangs on the transom (J/Boats: "high aspect transom mounted molded rudder")
    rudder: { x: -3.45, z: -0.45, area: 0.23, ARe: 3.6, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.95, chord: 0.26, loadRef: 700, hung: true },
    hullLat: { area: 1.5, cd: 0.9, z: -0.1 },
    windage: { area: 2.8, z: 2.4, cd: 0.9 },
    // J/Boats sail plan: the deck-stepped mast is 2.5 m aft of the stem (J 2.34 m from the jib tack), 10.0 m DWL to
    // masthead, gooseneck 1.7 m above the waterline. (Its ~0.6 m of rake (mastRake, js/boom.js mastXAt) is left out while the
    // solved rig, js/rig-structure.js, models an upright mast: the raked luff on it lost the backstay's flattening)
    mastX: 1.03, mastHeight: 10.0, boomZ: 1.7, keelBulb: true,
    targetHeel: 17 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1400,
    // J/70 (Harken layout, J/70 building spec): 6:1 mainsheet (a 2:1 fine tune on top) to a switchable Carbo ratchet on a 144 swivel base
    // with a 150 cam; 2:1 jib sheets on B8 / SnubbAir winches with cam cleats; gennaker sheets hand-held through
    // 2x-grip Ratchamatics on the quarters; 2:1 traveller and the backstay cascade on cams; tack line on a cabin-top cam;
    // halyard and control leads through a clutch bank to the cabin-top winch
    lines: { main: { handler: 'ratchetCam', n: 6, at: 'sole' }, trav: { handler: 'cam', n: 2, at: 'deck' }, jib: { handler: 'winchCam', n: 2, at: 'winch' },
      gen: { handler: 'ratchet', hold: 20, at: 'quarter' }, vang: { handler: 'clutch', n: 16, winch: 'cabin', at: 'cabin' }, cunn: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' },
      outhaul: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' }, backstay: { handler: 'cam', n: 16, at: 'deck' },
      jibHalyard: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' }, tackLine: { handler: 'cam', at: 'cabin' } },
    // auxiliary: J/70 class rule C.5.3 — one functioning outboard of at least 12 kg aboard, NOT FOR USE while racing
    // (stowed below, secured at the mast step: it is inside the class weight). A 3.5 hp four-stroke short shaft
    // (Tohatsu MFS3.5: 85 cc single, 5500 rpm, 2.08:1, 7.2 x 5 in three-blade, 17.4 kg) on the transom bracket for
    // getting to and from the course (15 in shaft; the clamp's x from the transom); slid up clear when stopped.
    engine: { type: 'outboard', model: '3.5 hp four-stroke short shaft', kW: 2.57, rpmMax: 5500, rpmIdle: 1150, cyl: 1, fuel: 'petrol', gear: 2.08,
      prop: { D: 0.183, P: 0.127, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-3.62, -0.42, -0.27], mount: [-3.48, -0.42, 0.23], lift: 0.38,
      mass: 17.4, inMass: true, stow: [0.55, 0, -0.12], tilts: true, steers: false, exhaust: [-3.62, -0.42, 0.1] },
    sails: [
      { key: 'main', kind: 'boom', area: 16.7, luff: 7.97, foot: 2.88, head: 0.45, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
        cd0: 0.06, ARe: 4.8, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 38, boomMass: 14, reefs: 0,
        vangBend: 0.15, sheetBend: 0.1, color: 0xf2f0ea,
        // J/70: the mainsheet to a bridle across the cockpit 5.15 m aft of the stem (its car trims to windward);
        // aluminium boom (EI ~60 kN m^2, ~3.5 kN m); a rigid kicker whose gas spring holds the boom up (no topping lift)
        track: { x: -1.6, z: 0.85, half: 0.55, s: 2.61 }, boomEI: 6e4, boomMmax: 3500, vang: 'rigid', vangMax: 3000, vangSpring: 350 },
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
    // Laser / ILCA: the mainsheet is hand-held through the ratchet block on the cockpit floor (no cleat); vang
    // (15:1 cascade), cunningham and outhaul led to Harken cam cleats on the deck
    lines: { main: { handler: 'ratchet', n: 3, at: 'sole' }, vang: { handler: 'cam', n: 15, size: 'micro', at: 'deck' },
      cunn: { handler: 'cam', n: 8, size: 'micro', at: 'deck' }, outhaul: { handler: 'cam', n: 8, size: 'micro', at: 'deck' } },
    engine: null,                       // a dinghy is paddled, not motored
    sails: [
      { key: 'main', kind: 'boom', area: 7.06, luff: 5.1, foot: 2.75, head: 0.25, depth: [0.12, 0.14, 0.12], twistMax: 24 * DEG,
        cd0: 0.06, ARe: 3.9, min: 3 * DEG, max: 88 * DEG, trav: null, Iboom: 12, boomMass: 6, reefs: 0,
        vangBend: 0.6, sheetBend: 0.45, color: 0xf4f3ee,
        // Laser: the sheet's block rides a rope horse across the transom; a thin aluminium tube (63.5 x 1.6 mm, EI ~11 kN
        // m^2, yields ~1.2 kN m in 6061-T6) that bows visibly under the vang (8:1 on a ~200 N pull), the Laser's strongest control
        track: { x: -1.78, z: 0.45, half: 0.45, s: 2.67, horse: true }, boomEI: 1.1e4, boomMmax: 1200, vang: 'rope', vangMax: 1600,
        // (luff round cut into the sail, fraction of the full mast bend: the Laser's is cut for the bend of its
        // two-part unstayed mast under the vang and the sheet it sails with, more than a stayed mast's)
        luffRoundK: 0.6 },
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
    // Hobie 16: 6:1 mainsheet, lower block a triple Ratchamatic with a 150 cam on the traveller car; the traveller
    // line cleats in a cam on the car; 2:1 jib sheets in swivel cam cleats; spinnaker sheets hand-held through
    // ratchet blocks; downhaul cam at the mast, outhaul in a clam on the boom
    lines: { main: { handler: 'ratchetCam', n: 6, at: 'car' }, trav: { handler: 'carCam', n: 2, at: 'car' }, jib: { handler: 'cam', n: 2, at: 'deck' },
      gen: { handler: 'ratchet', hold: 20, at: 'quarter' }, cunn: { handler: 'cam', n: 6, at: 'mast' }, outhaul: { handler: 'clam', n: 4, at: 'boom' }, jibHalyard: { handler: 'cam', n: 6, at: 'mast' },
      tackLine: { handler: 'cam', at: 'deck' } },
    engine: null,
    sails: [
      // (a fully battened main cut full, 13% at mid height: its battens, tensioned in their pockets, hold the depth
      // the sheet's pull on the leech would stretch out of a soft sail)
      { key: 'main', kind: 'boom', area: 13.7, luff: 7.2, foot: 2.6, head: 1.1, depth: [0.11, 0.13, 0.12], twistMax: 15 * DEG,
        cd0: 0.06, ARe: 4.6, min: 1 * DEG, max: 75 * DEG, trav: [-4 * DEG, 24 * DEG], Iboom: 16, boomMass: 6, reefs: 0,
        vangBend: 0.2, sheetBend: 0.25, color: 0xf2f4f6,
        // Hobie 16: the mainsheet to a car on the rear beam's track, nearly hull to hull. The real boat has no vang (its
        // fully battened main is held by the sheet alone: vang 'none', which the rig, the trim and the VPP support);
        // sailed so, the cloth leech and the solved mast's bend (js/rig-structure.js, lagging the sheet's load) chase
        // each other upwind and the cat loses a quarter of its speed, so until the bend is solved without the lag the
        // cat keeps a light rope vang standing in for the 6:1 sheet's downward pull
        track: { x: -2.07, z: 0.57, half: 0.85, s: 2.5 }, boomEI: 3e4, boomMmax: 2000, vang: 'rope', vangMax: 1500 },
      { key: 'jib', kind: 'loose', area: 5.2, tackX: 2.3, tackZ: 0.55, luff: 6.2, foot: 1.7, head: 0.06, rake: 0.4,
        depth: [0.12, 0.13, 0.11], cd0: 0.04, ARe: 4.5, min: 9 * DEG, max: 40 * DEG, sagK: 0.8, color: 0xf2f4f6 },
      { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 17.5, tackX: 3.35, tackZ: 0.5, luff: 7.4, foot: 3.3, head: 0.4, rake: 0.4,
        depth: [0.18, 0.2, 0.18], cd0: 0.08, ARe: 2.4, min: 14 * DEG, max: 95 * DEG, color: 0x1d4e89 },
    ],
    hull: { color: 0xf5f5f2, stripe: 0xd9412b, deck: 0xe8e8e4, boot: 0xeeeeea, bootTop: 0xf5f5f2, sectionN: 2, transom: 0.35, bowRake: 0.05, sheer: 0.1 },
  },
};
// production and famous boats (js/classes/*.js)
for (const C of [...RACE, ...FAMOUS, ...SPEED]) CLASSES[C.id] = C;
// headsails are set on stays that run from the tack up to the mast: the head sits at the mast, so the
// luff's rake is the horizontal distance from the tack to the mast (a free-flying gennaker keeps its own; a sail on
// its own mast, a mizzen, keeps its, as does a sail marked fixedRake). A raked mast (mastRake: m aft at the masthead,
// from the gooseneck up) carries the main's luff and the headsails' heads aft with it: the sails' centre of effort
// moves aft by about half the rake
// A schooner's headsails are set on the foremast's stays (s.stayTo: the key of the sail on that mast), and a sail on its
// own raked mast (s.mast.rake: m aft at its head) takes the mast's rake. A gaff sail with a topsail over it is one
// planform (js/sail/plan.js normaliseTopsail)
for (const C of Object.values(CLASSES)) for (const s of C.sails) normaliseTopsail(s);
for (const C of Object.values(CLASSES)) for (const s of C.sails) {
  if (s.mast) { if (s.mast.rake) s.rake = s.mast.rake * s.luff / (s.mast.h - s.tackZ); continue; }
  if (s.fixedRake) continue;
  if (s.kind === 'loose' || (s.kind === 'boom' && s.key !== 'main')) s.rake = s.tackX - (mastXOf(C, s.stayTo || 'main', s.tackZ + s.luff) + 0.07);
  else if (s.key === 'main' && C.mastRake) s.rake = C.mastRake * s.luff / (C.mastHeight - C.boomZ);
}
// The main boom swings out until it lies on the leeward shroud (an unstayed dinghy's goes past square), and its
// traveller's range, seen from the gooseneck, is the track's half-length at the track's distance aft (the classes
// whose mainsheet runs to a track: js/boom.js)
for (const C of Object.values(CLASSES)) {
  const by = Object.fromEntries(C.sails.map((s) => [s.key, s])), M = by.main;
  if (!M || !M.track) continue;
  M.max = boomContactAngle(C, by);
  if (M.trav) { const h = Math.atan2(M.track.half, goose(C).x - M.track.x); M.trav = [-h, h]; }
}
// (the menu shows them in this order within their groups: C.group, js/main.js CLASS_GROUPS)
export const CLASS_ORDER = ['blackwatch', 'sportboat', 'dinghy', 'cat', ...RACE.map(C => C.id), ...FAMOUS.map(C => C.id), ...SPEED.map(C => C.id)];
// sheets the crew trims (a boomed sail's sheet is keyed by the sail: a mizzen has its own)
const SHEETS = ['main', 'jib', 'stay', 'lazy', 'mizzen', 'fore'];

export const STRIP_F = [0.17, 0.5, 0.82];
export const STRIP_W = [0.43, 0.34, 0.23];
// js/sail/sailsim.js registers the cloth / vortex-lattice sail model here when it is loaded (no import cycle)
// (it also sets defaultModel: with it loaded every boat sails with cloth sails unless told otherwise, and
// polarAngle: the cloth sails' baked polars, js/sail/surrogate.js)
export const sailHooks = { make: null, defaultModel: null, polarAngle: null };
// boomOverload(boat, ratio): the main boom bent past its section's strength (the damage model hooks in here)
export const boatHooks = { boomOverload: null };
// js/speedcraft.js registers the speed machines here (a class with C.speed: a rigid wing, foils and planing pods, one
// rigid body in six degrees of freedom): make(C, opts) builds one, polarAngle its VPP, autoTrim its pilot's wing trim
export const craftHooks = { make: null, polarAngle: null, autoTrim: null };
// a boat of class C: a sailing boat (Boat), or a speed machine (js/speedcraft.js)
export function makeBoat(cls, opts = {}) {
  const C = typeof cls === 'string' ? CLASSES[cls] : cls;
  return (C.speed && craftHooks.make && craftHooks.make(C, opts)) || new Boat(C, opts);
}
// (reef factors and the planform of a sail with a topsail: js/sail/plan.js)
export { REEF, reefAt };
// A furling headsail rolled in with the reefs (s.furlReef: the fraction of it left set at reef 0, 1, 2: a big yacht rolls
// her jib a turn or two on its hydraulic furler as she reefs the main), at a reef position
export function furlAt(s, pos) {
  const F = s.furlReef; if (!F) return 1;
  const i = Math.max(0, Math.min(1, Math.floor(pos))), f = Math.max(0, Math.min(2, pos)) - i;
  return lerp(F[i], F[Math.min(2, i + 1)], f);
}
// the headsail as set at furl fraction f: rolled round its stay, its foot and leech come in, its luff stays
export const furledSail = (s, f) => (f >= 0.999 ? s : { ...s, foot: s.foot * f, head: (s.head || 0) * f, area: s.area * f, furled: f });
// seconds for the crew to put in (or shake out) one reef
// A headsail's foot angle (fraction of its min..max range) for its sheet eased to e. The sheet runs from the clew
// to a lead on deck: eased, it lets the clew rise as much as go out, so the foot opens slowly at first (the cloth
// jib's clew angle for a given sheet, sportboat on a reach: 8, 11, 15, 22, 35 degrees for e = 0 .. 1; the strip
// model used to open it linearly, 9 to 42, and stalled the jib the cloth held drawing)
export const jibEaseAngle = (e) => e * e;
// The reef a crew puts in (C.autoReef: a class whose crew reefs as the wind gets up, a big yacht's in-boom or in-mast
// furling main rolled down by its motor): { up: [first, second] true wind (kn) close-hauled, off: [...] reaching and
// running }, between the two by the wind's angle (a superyacht reefs her main from ~19-20 kn of true wind upwind,
// rather than twist its head off; off the wind she carries full sail longer). tws in kn, twa in rad
export function autoReefFor(C, tws, twa, cur = 0) {
  const R = C.autoReef; if (!R || !(C.sails.find((s) => s.key === 'main') || {}).reefs) return 0;
  const f = sstep(60 * DEG, 110 * DEG, twa), r1 = lerp(R.up[0], R.off[0], f), r2 = lerp(R.up[1], R.off[1], f), h = R.hyst ?? 1.5;
  const want = tws > r2 ? 2 : tws > r1 ? 1 : 0;
  // (hysteresis: a reef goes in at its wind and comes out 1.5 kn below it, not with every puff and lull)
  if (want < cur && tws > (cur === 2 ? r2 : r1) - h) return cur;
  return Math.min(want, C.sails.find((s) => s.key === 'main').reefs);
}
// A crew's reefing in a gusty wind: in when the wind's mean over the last half minute calls for it, or at once in a gust
// 4 kn past the reef's wind; out only once the mean has stayed 2 kn under it (and under the reef's own hysteresis) for a
// minute. (Decided on each puff and lull, a Catalina 30's autopilot in 18-25 kn reefed and shook out every 15 s.)
// decide(tws kn, cur) -> the reef that wind wants. One decision per physics step (boat.t), however many callers ask.
export function steadyReef(boat, dt, tws, decide) {
  const cur = boat.ctrl.reef | 0, H = boat._reefH || (boat._reefH = { m: tws, low: 0, at: null, r: cur });
  if (H.at !== null && H.at === boat.t) return H.r;
  H.at = boat.t ?? null;
  H.m += (tws - H.m) * clamp(dt / 30, 0, 1);
  let r = cur;
  const up = decide(Math.max(H.m, tws - 4), cur);
  if (up > cur) { r = up; H.low = 0; }
  else if (decide(H.m + 2, cur) < cur) { H.low += dt; if (H.low > 60) { r = decide(H.m + 2, cur); H.low = 0; } }
  else H.low = 0;
  return (H.r = r);
}
export function reefTime(C) { return C.reefTime ?? (C.id === 'blackwatch' ? 70 : 45); }

// ---------------------------------------------------------------------------------------------
// Section coefficients from sail shape. a = |alpha| (rad, 0..pi/2), d = camber depth / chord,
// f = draft position (0 = at luff .. 1 = at leech; ~0.4-0.5 typical).
// A spinnaker's (s.kind 'spin') maximum lift is capped at SPIN_CLMAX whatever its depth: the depth law, fitted to mains and
// jibs of 6-15% camber, gave a 20-25% deep kite section lift coefficients of 1.6-1.95 on every reach, its resultant
// force coefficient 1.67 (the J/70's gennaker at 72 deg apparent), where ORC's asymmetric spinnaker tacked on the
// centreline reaches C_L 1.04-1.075 at 60-75 deg with a viscous C_D0 of 0.39-0.48, a resultant of about 1.2 with its
// induced drag (ORC VPP Documentation 2023, Table 5.7; the symmetric's, Table 5.6, is the same within 5%), and
// twisted-flow wind-tunnel kites 1.1-1.4. At 1.2 the strip J/70's resultant is 1.19, and its reaching and running
// speeds in 8-12 kn come within -7..+8% of its ORC certificate (they were 6-12% above it; the Etchells' within 5%).
const SPIN_CLMAX = 1.2;
export function shapeCoef(a, d, f, S, out) {
  const clMax = clamp(0.42 + 7.8 * d, 0.7, S.kind === 'spin' ? SPIN_CLMAX : 1.95);
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
    main: 0.3, jib: 0.3, stay: 0.3, mizzen: 0.3, fore: 0.3, // sheet ease: 0 = hard in, 1 = fully eased (fore: a schooner's foresail)
    trav: 0.5,          // traveler car: 0 = to windward, 1 = to leeward
    vang: 0.3, cunn: 0.2, outhaul: 0.4, backstay: 0.3,
    jibLead: 0.45,      // jib car: 0 = forward (deep foot, closed leech) .. 1 = aft (flat foot, open leech)
    jibHalyard: 0.5,    // luff tension: pulls draft forward
    flap: 0.5,          // a foiler's take-off flap (the T-foil elevator's): 0 down .. 1 up
    tackLine: 0.3,      // gennaker tack height
    board: 1,           // daggerboard down fraction
    reef: 0,            // 0, 1, 2
    crewAft: 0,         // -1 forward .. 1 aft
    hike: 0,            // -1 (sit to leeward) .. 1 (full hike)
    gen: false,
    lazy: 1,            // the other jib sheet (on the windward winch): 1 = slack; hauled in, it drags the clew across (backs the jib)
    pushBoom: 0,        // una-rig: the sailor's hand pushing the boom out (-1 port / +1 starboard) to sail out of irons
    preventer: 0,       // 1 = rigged: a line from the boom end to the bow, led aft, holds the boom out (cruisers)
    brake: 0,           // boom brake friction, 0 = free .. 1 = full (cruisers)
  };
}

// ---------------------------------------------------------------------------------------------
// the drawn hull's form for the Delft regression, on the class's waterline length (the drawn waterline runs out into
// the overhangs: the physics scales it back to C.lwl the same way for its Froude number)
function delftForm(C, hydro) {
  const f = hullForm(C, hydro), k = C.lwl / f.L;
  return { L: C.lwl, B: f.B, T: f.T, V: hydro.restV, Aw: f.Aw * k, lcb: f.lcbF, lcf: f.lcfF, Cp: f.Cp, Cm: f.Cm };
}
// a trimaran's residuary factor on its table: each hull's share of the displacement at its own slenderness, against the
// main hull's carrying all of it
function amaLoad(b, imm) {
  const C = b.cls, P = b._parts || (b._parts = hullParts(C)), Vh = imm.Vh, V = Math.max(1e-6, imm.V);
  const s0 = C.lwl / Math.cbrt(b.hydro.restV);
  let f = 0;
  for (let i = 0; i < P.length; i++) if (Vh[i] > 1e-6) f += Vh[i] / V * (s0 / (C.lwl * (P[i].t1 - P[i].t0) / Math.cbrt(Vh[i]))) ** 1.3;
  return f || 1;
}
// how far a hull comes over its hump onto a plane (0 a displacement hull .. 1 a planing dinghy or sportboat)
export const planingOf = (C) => C.planing ?? (C.group === 'dinghy' ? 1 : 0);

// The air the sails carry with them in roll. A plate moving normal to itself carries an added mass rho pi c^2 / 4 per
// unit span (c its chord: Newman, "Marine Hydrodynamics" (1977) 4.13); a sail is such a plate swinging about the roll
// axis at its height z, so it adds rho_a pi/4 integral c(z)^2 (z - zG)^2 dz, taken at 0.7 of that for a
// low-aspect-ratio triangle's tip losses. Air is 1/840 of water, but the sails are big and high: on a 30 ft yacht
// ~15-20 % of its roll inertia, on a dinghy more (the working sails; a gennaker is off most of the time).
const m_g = (m) => Math.max(1, m * G);
function sailRollAddedInertia(C, zG) {
  let I = 0;
  for (const s of C.sails) {
    if (s.kind === 'spin' || s.replaces || !(s.luff > 0)) continue;
    const z0 = s.tackZ ?? C.boomZ, n = 8;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, c = planChord(s, f), z = z0 + f * s.luff - zG;
      I += RHO_A * Math.PI / 4 * c * c * z * z * s.luff / n;
    }
  }
  return 0.7 * I;
}

export class Boat {
  constructor(cls, opts = {}) {
    this.cls = typeof cls === 'string' ? CLASSES[cls] : cls;
    const C = this.cls;
    // the drawn hull's depth and fullness, fitted to the class's displacement (js/hull.js calibrate, cached on the
    // class) before anything reads the lines: the engine's transom, the rig's partners and the hull shell's inertia
    // (massProps) took the uncalibrated lines on the first boat of a class built in a session and the calibrated ones
    // on every later boat, so the first boat (the player's, usually) sailed differently from the rest
    calibrate(C);
    this.engine = C.engine ? new Engine(this, C.engine) : null;          // auxiliary engine (js/engine.js)
    this.mass = C.massHull + C.crewN * C.crewEach + (this.engine ? this.engine.addedMass : 0);
    this.crewMass = C.crewN * C.crewEach;
    this.m11 = this.mass * (1 + C.amX); this.m22 = this.mass * (1 + C.amY);
    // the standing rig as a structure (js/rig-structure.js); the inertias from the boat's parts, crew included
    // (js/massprops.js: the hull shell over its real surface, keel and bulb, mast, rig, engine, crew on the rails)
    this.rigStruct = opts.rigStructure === false || RigStructure.off ? null : new RigStructure(this);
    this.massProps = massProps(C, this.rigStruct);
    // (a class that brings its own component-built hull inertias (js/classes/*: util.js massProps) keeps them, with its
    // crew added on the rails; the four built-in classes' are built here from their parts; pitch always here)
    const mp = this.massProps;
    const MP = C.useClassInertia ? { Ixx: C.Ixx, Izz: C.Izz, Iyy: this.mass * (0.27 * C.loa) ** 2 }
      : mp.ownData || !C.Ixx ? mp : { Ixx: C.Ixx + mp.IxxCrew, Izz: C.Izz + mp.IzzCrew, Iyy: mp.Iyy };
    this.Izz = MP.Izz * (1 + C.amYaw); this.Ixx = MP.Ixx * (1 + C.amRoll);
    this.IxxAir = sailRollAddedInertia(C, mp.zG);                     // the sails' air, while they are in the air (step)
    // hydrostatics from the drawn hull (shared geometry with the renderer)
    this.hydro = new HullHydro(C);
    const h0 = this.hydro.immerse(0.02, 0, 0, () => 0, () => 0, {});
    const h1 = this.hydro.immerse(-0.02, 0, 0, () => 0, () => 0, {});
    this.Awp = Math.max(0.2, (h1.V - h0.V) / 0.04);                  // waterplane area
    this.xG = this.hydro.immerse(0, 0, 0, () => 0, () => 0, {}).Mx / this.hydro.restV; // LCG over the LCB at rest
    // residuary resistance over the hump: the class's table below it, the Delft series on its drawn hull above
    // (js/classes/util.js rrOverHump; the slender multihulls keep their towing-tank tables)
    if (!C._rr) C._rr = C.multihull || C.amas ? C.rr : rrOverHump(C.rr, delftForm(C, this.hydro), planingOf(C));
    // heave and pitch: the dry mass and pitch inertia here; the water's added mass and inertia come from the drawn hull,
    // station by station, as much of it as is wet (js/hull.js heaveAddedMass: a 30 ft yacht carries about twice its
    // own mass in heave). m33 is the total at rest, level.
    this.m33 = this.mass + this.hydro.A33;
    this.Iyy = MP.Iyy;
    this.kRoll = RHO_W * G * this.Awp * (C.beam * C.beam / 12);
    // the hull's own roll damping (eddy making and wave radiation of the canoe body: the keel's, the rudder's and the
    // sails' come from their own forces), a damping ratio of 0.07 about the boat's real metacentric height, from the
    // drawn hull's righting moment at 2 degrees (it was sized for a GM of 0.6 m whatever the boat: 0.03-0.04 on the
    // stiff ones). Bare-hull yacht roll decay tests give 0.05-0.1 (Klaka, Penrose, Horsley & Renilson 2005)
    {
      const m = this.mass, V = m / RHO_W, ph = 2 * DEG;
      let z = 0, r;
      for (let i = 0; i < 40; i++) { r = this.hydro.immerse(z, 0, ph, () => 0, () => 0, {}); z += (r.V - V) / this.Awp * 0.8; }
      const RM = RHO_W * G * r.My - C.massHull * G * (C.zG ?? 0) * Math.sin(ph) - this.crewMass * G * (C.crewZ ?? 0) * Math.sin(ph);
      this.GM = clamp(RM / (m * G * Math.sin(ph)), 0.2, 10);
    }
    this.cRoll = 2 * 0.07 * Math.sqrt(m_g(this.mass) * this.GM * (this.Ixx + this.IxxAir));
    this._hy = {}; this._ws7 = []; for (let i = 0; i < 7; i++) this._ws7.push({});
    // the sea at each station's waterline edges, port and starboard (the roll's wave slope across the section: step)
    this._wsP = []; this._wsS = []; for (let i = 0; i < 7; i++) { this._wsP.push({}); this._wsS.push({}); }
    this._slC = new Float64Array(7);
    { // each sample station's waterline half-breadth at rest (across both hulls of a multihull)
      const wl = this.hydro.waterline(0, 0, 0, () => 0, () => 0), st = this.hydro.stations;
      this._yb7 = [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const x = C.sternX + (C.bowX - C.sternX) * i / 6;
        let best = 0, dmin = 1e9;
        for (let j = 0; j < st.length; j++) {
          let yb = 0; const q = wl[j].pts; for (let k = 0; k < q.length; k += 2) yb = Math.max(yb, Math.abs(q[k]));
          const dd = Math.abs(st[j].x - x); if (dd < dmin - 1e-9 && yb > 0.02) { dmin = dd; best = yb; }
        }
        return Math.max(0.1, best);
      });
    }
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
    // appendages as foils (js/foils.js), the helm (js/helm.js), the standing rig as a structure (js/rig-structure.js)
    this.keelS = foilSpec(C, 'keel'); this.rudS = foilSpec(C, 'rudder'); this.helmS = helmSpec(C);
    // a foiler's lifting foils (C.hydrofoils: l'Hydroptère's): surfaces in strips at their depths (js/hydrofoil.js), the
    // class's geometry (z up) turned into the body frame the surfaces work in (SNAME: z down)
    const dn = (q) => [q[0], q[1], -q[2]];
    // (the sails' centre of effort, for a foiler's pitch: each working sail's triangle centroid, a third of the way up its
    // luff, weighted by its area)
    { let a = 0, m = 0; for (const s of C.sails) { if (s.kind === 'spin' || s.replaces) continue; const z0 = s.tackZ ?? C.boomZ; a += s.area; m += s.area * (z0 + s.luff / 3); } this._ceZ = a > 0 ? m / a : C.boomZ + 2.3; }
    this.hfoils = C.hydrofoils ? C.hydrofoils.map((F) => new Surface({ ...F, root: dn(F.root), span: dn(F.span), chord0: dn(F.chord0 || [-1, 0, 0]), liftTo: dn(F.liftTo || [0, 0, 1]), water: true, n: F.n || 6 })) : null;
    this.keelSt = foilState(); this.rudSt = [foilState(), foilState()];
    this._kg = {}; this._rg2 = [{}, {}]; this._rc = {};
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
    this.lines = { main: this.ctrl.main, jib: this.ctrl.jib, stay: this.ctrl.stay, lazy: this.ctrl.lazy, mizzen: this.ctrl.mizzen, fore: this.ctrl.fore };
    this.backedByLazy = false;
    // every line is held by something (js/linehandlers.js: cam, clam, jammer, horn, clutch, ratchet, winch...).
    // Released, a loaded line runs out by itself until it is made fast again (or held: the player is hauling it)
    initLines(this);
    this.heave = 0; this.heaveV = 0; this.pitch = 0; this.pitchV = 0; this._fresh = true;
    this.capsized = false; this.capsizeT = 0; this.righting = false;
    this.aground = 0;
    this.reefPos = 0; this.reefSlack = 0; this.reefing = false;
    this.log = 0; this.t = 0; this.slam = 0;
    this._clHead = 0; this._clMain = 0;
    if (this.sailSys) this.sailSys.reset(this);
    if (this.engine) this.engine.reset();
  }

  GZ(phi) {
    const C = this.cls;
    return (C.gm - C.bmForm) * Math.sin(phi) + C.bmForm * Math.sin(2 * phi) / 2;
  }

  // Maximum angle a boomed sail may swing out to, given sheet + traveler
  boomLimit(s) {
    const ease = clamp(this.lines[s.key] ?? 0.3, 0, 1);
    // the main: the angle at which the sheet, run from the boom block to the car on its straight track, comes taut
    if (s.track) return boomAngleForSheet(this.cls, s, sheetLen(this.cls, s, ease), this.ctrl.trav);
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
        // the sheet pulls down on the leech as much as it runs down to its car: hard in over the car, all of it; eased
        // with the car inboard, little (js/boom.js geometry, while the sheet holds the boom)
        const sheetDown = s.track ? (this._sheetDown ?? 1 - sstep(0, 0.32, ease)) : 1 - sstep(0, 0.32, ease);
        const vangEff = s.vang === 'none' ? 0 : c.vang * 0.95;
        const LT = Math.max(vangEff, sheetDown * (s.trav ? 1 : 0.85));
        tw = (s.twistMax * (1 - 0.82 * LT) + 5 * DEG * bend) * Math.pow(fr, 1.3);
        if (i === 0) d *= 1.28 - 0.6 * c.outhaul;
        if (i === 1) d *= 1.1 - 0.22 * c.outhaul;
        if (i > 0) d *= 1 - 0.38 * bend * (i === 2 ? 1.2 : 0.9);
        f = 0.5 - 0.2 * c.cunn + 0.12 * stretch;
        d *= (1 - 0.12 * c.cunn) * (1 + 0.1 * stretch);
        if (this.reefPos > 0) d *= 1 - 0.1 * this.reefPos;
        d *= 1 + 0.9 * this.reefSlack; f += 0.12 * this.reefSlack;
      } else if (s.key === 'jib' || s.kind === 'loose') {
        // (every headsail on the jib sheets: a schooner's or a cutter's outer jibs are trimmed with the jib)
        const ease = this.lines.jib;
        // (eased, the clew is let up as well as out: the sheet's lead stays on deck, so the leech falls away and the
        // head twists off, 20-40 degrees more than the foot on a reach, as the cloth jib shows)
        tw = (3 * DEG + 9.6 * DEG * c.jibLead + 42 * DEG * sstep(0.05, 0.55, ease)) * Math.pow(fr, 1.2);
        if (i === 0) d *= 1.3 - 0.6 * c.jibLead;
        d *= 1 + 0.45 * sag * (s.sagK ?? 1) * (i === 1 ? 1.2 : 0.8) * 0.7;
        f = 0.48 - 0.2 * c.jibHalyard + 0.1 * stretch + 0.08 * sag;
        d *= 1 + 0.08 * stretch;
      } else if (s.key === 'stay' || s.kind === 'boom') {
        // (a staysail on its club, or a mizzen: the sheet sets the twist)
        const ease = this.lines[s.key] ?? 0.3;
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

  // the main boom's bending this step (js/boom.js boomBend: M, dv, ds, ratio = M / the section's strength), handed to
  // sailHooks.boomOverload(boat, ratio) (js/damage.js)
  boomBent(bd) {
    const r = this.diag.rig;
    r.boomM = bd.M; r.boomBendMM = 1000 * Math.max(bd.dv, bd.ds); r.boomRatio = bd.ratio;
    // (js/damage.js takes it every step: fatigue past three quarters of the strength, a break past it)
    const hook = sailHooks.boomOverload || boatHooks.boomOverload;
    if (hook) hook(this, bd.ratio);
  }
  // the preventer's load (N) against its breaking strength: it parts, and the boom is free to gybe
  preventerLoad(F, strength) {
    const r = this.diag.rig;
    r.preventerLoad = lerp(r.preventerLoad || 0, F, 0.2);
    if (F > strength) { this.ctrl.preventer = 0; r.preventerBroke = (r.preventerBroke || 0) + 1; }
  }

  // Boom dynamics: a rotating body driven by the aero torque about its pivot, stopped by its sheet.
  boomDynamics(s, boomTorque, dt, aeroOn = true, ax = null) {
    const key = s.key, ctrl = this.ctrl, d = this.diag;
    const b = this.booms[key];
    const limit = this.boomLimit(s);
    const grav = s.boomMass * G * (s.foot * 0.45) * Math.sin(this.phi) * Math.cos(b.a);
    const inert = -s.Iboom * (this._rdot || 0);
    const damp = aeroOn ? 2.5 : 8;
    // una-rig in irons: the sailor pushes the boom out against the wind to sail backwards and turn. A hand's push, not a
    // spring scaled by the boom's inertia: that was a few newton-metres on a Sunfish's light spar, the backed sail blew
    // the boom back across and she lay head to wind going astern. Up to ~300 N where she can reach it (est.: a sailor
    // leaning on the boom from the cockpit), with a little damping of the swing
    let push = 0;
    if (ctrl.pushBoom && !this.sailBy.jib && key === 'main') {
      const Tmax = 300 * Math.min(1.5, 0.5 * boomLen(s));
      push = clamp((ctrl.pushBoom * 0.8 - b.a) / 0.15 * Tmax - 0.3 * Tmax * b.rate, -Tmax, Tmax);
    }
    // the boom end in the sea: water drag on the immersed length swings it (js/boom.js boomDip); the hull takes the rest
    // (the water's drag grows with the square of the boom's swing: integrated explicitly it overshoots and blows up
    // once the boom swings fast in the sea, so its dependence on the swing is taken implicitly: T = T0 - c rate)
    let dipT = 0, dipC = 0;
    if (ax && s.track && Number.isFinite(b.a) && Number.isFinite(b.rate)) {
      const o = this._dip || (this._dip = {});
      const sea = this._sea || (this._sea = (x, y) => (this._etaAt ? this._etaAt(x) + (this._slLat ? this._slLat(x) * y : 0) : 0));
      boomDip(this, s, b.a, 0, boomLen(s), b.rate, ax, sea, o);
      if (o.wet > 0) {
        const T1 = o.torque; ax.X += o.X; ax.Y += o.Y; ax.K += o.K; ax.N += o.N;
        const o0 = this._dip0 || (this._dip0 = {});
        boomDip(this, s, b.a, 0, boomLen(s), 0, ax, sea, o0);
        dipT = o0.torque; dipC = Math.abs(b.rate) > 1e-4 ? Math.max(0, (o0.torque - T1) / b.rate) : 0;
      }
      this.diag.rig.boomWet = o.wet;
    }
    // boom brake: friction against the swing (a line round a drum: its drag rises to the set value as the boom starts
    // to move, 0.1 m/s at the end, so it slows the swing, never holds a boom still or reverses it)
    const brakeT = s.brake ? (ctrl.brake || 0) * s.brake * boomLen(s) * clamp(Math.abs(b.rate) * boomLen(s) / 0.1, 0, 1) : 0;
    const acc = (boomTorque + grav + inert + push + dipT - damp * b.rate) / s.Iboom;
    b.rate = (b.rate + acc * dt) / (1 + dipC * dt / s.Iboom);
    if (brakeT > 0) { const dr = Math.min(Math.abs(b.rate), brakeT / s.Iboom * dt); b.rate -= Math.sign(b.rate) * dr; }
    b.a += b.rate * dt;
    // preventer (rigged: the boom may not swing back inboard of where it was made fast; it parts if overloaded)
    if (s.preventer && (ctrl.preventer || 0) > 0.5) {
      if (b.prevA === undefined) b.prevA = b.a;
      const sg = Math.sign(b.prevA) || 1;
      if (b.a * sg < Math.abs(b.prevA) - 0.02) {
        const lever = boomLen(s) * 0.9;
        this.preventerLoad(Math.abs(boomTorque + grav) / lever + s.Iboom * Math.abs(b.rate) / dt / lever * 0.05, s.preventer);
        if ((ctrl.preventer || 0) > 0.5) { b.a = sg * (Math.abs(b.prevA) - 0.02); if (b.rate * sg < 0) b.rate = 0; }
      }
    } else b.prevA = undefined;
    let sheetLoad = 0;
    if (Math.abs(b.a) >= limit) {
      const sg = Math.sign(b.a);
      b.a = sg * limit;
      if (b.rate * sg > 0) {
        const J = s.Iboom * b.rate * 1.2;
        if (key === 'main') { this.slam = Math.max(this.slam, Math.abs(b.rate)); if (Math.abs(b.rate) > 1.2) this.slamEvents++; this.slamJ = Math.max(this.slamJ || 0, Math.abs(J)); }
        this.r -= J / this.Izz * 0.6;
        b.rate *= -0.2;
      }
      // the sheet holds the aero torque, plus the leech tension it carries when hard in
      sheetLoad = Math.abs(boomTorque + grav) / (s.foot * 0.85) * (1 + 1.6 * (1 - sstep(0, 0.35, this.lines[key] ?? 0.3)));
    }
    if (s.track) {
      // the boom as a beam: the sheet's downward pull at its block (tension along the sheet's line to the car, found
      // from the torque it holds) and the vang's, held up by the leech at the end
      const dir = sheetDir(this.cls, s, Math.abs(b.a), ctrl.trav, 1, this._sd || (this._sd = [0, 0, 0]));
      const across = Math.abs(dir[0] * Math.sin(Math.abs(b.a)) + dir[1] * Math.cos(b.a)) + 0.05;
      const T = sheetLoad > 0 ? Math.abs(boomTorque + grav) / (s.track.s * across) : 0;
      const Fv = s.vang === 'none' ? 0 : clamp(ctrl.vang, 0, 1) * (s.vangMax || 0);
      const bd = boomBend(boomLen(s), s.boomEI || 1e5, 0.22 * boomLen(s), Fv, s.track.s, T * Math.max(0, -dir[2]), this._bd || (this._bd = {}));
      bd.ratio = bd.M / (s.boomMmax || 1e9);
      this.boomBent(bd);
      this._sheetDown = sheetLoad > 0 ? Math.max(0, -dir[2]) : 0;
    }
    d.rig[key + 'Load'] = lerp(d.rig[key + 'Load'] || 0, sheetLoad, 0.1);
    d.rig[key + 'Limit'] = limit;
  }

  // the planform sail s is set to now (a gaff sail's topsail handed at the first reef: js/sail/plan.js reefedSail),
  // at the half-reef stages the cloth is rebuilt at
  setSail(s) {
    const lv = Math.round(clamp(this.reefPos, 0, 2) * 2) / 2, c = this._setS || (this._setS = {}), k = s.key + lv;
    return c[k] || (c[k] = reefedSail(s, s.key === 'main' ? lv : Math.min(1, lv)));
  }
  // Where sail s sits and how it is set this step: the fraction of it hoisted (areaF), the chord angle at
  // its foot (baseAngle, + = to starboard), its pivot/tack, side, how much it flogs and how full it is.
  sailRig(s, reef, o) {
    const C = this.cls, key = s.key, genDef = this.sailBy.gennaker;
    let areaF = 1, baseAngle, pivotX, pivotZ, side, flogging = 0, fill = 1, luff = s.luff, stream = null;
    if (s.kind === 'boom') {
      const b = this.booms[key];
      baseAngle = b.a; side = Math.sign(b.a) || 1;
      // (a lateen's luff starts at its tack, forward of the mast on the boom)
      // (a sail with a gaff topsail over it hands the topsail at the first reef: js/sail/plan.js)
      const rf = s.gaff ? reefAt(this.reefPos, s) : reef;
      if (key === 'main') { pivotX = C.mastX + (s.rig === 'lateen' ? s.tackFwd : 0); pivotZ = C.boomZ; areaF = rf.a; luff = s.luff * rf.l; }
      else { pivotX = s.tackX; pivotZ = s.tackZ; if (s.gaff) { areaF = rf.a; luff = s.luff * rf.l; } }
    } else if (s.kind === 'loose') {
      areaF = (genDef && genDef.replaces === key ? 1 - this.genDeploy : 1) * furlAt(s, this.reefPos);
      pivotX = s.tackX; pivotZ = s.tackZ;
      let ang = lerp(s.min, s.max, jibEaseAngle(this.lines.jib)); side = Math.sign(this.side.jib) || 1;
      flogging = 1 - sstep(0.55, 0.95, Math.abs(this.side.jib));
      // a sheet eased past the apparent wind holds nothing: the clew streams downwind of the luff, the sail lies in the
      // wind and flogs. (The sheet's angle held a let-fly jib across the wind like a board: head to wind with the
      // sheets free a J-class's jib took CD ~1 on its whole area, and she stopped in a length.) Backed, the wind
      // presses the sail against its sheet: as it is.
      const aw = Math.abs(this.diag.awaMid ?? Math.PI);
      if (side === -(Math.sign(this.diag.awaMid) || side) && ang > aw) { flogging = Math.max(flogging, clamp((ang - aw) / (10 * DEG), 0, 1)); ang = Math.max(s.min, aw); stream = ang; }
      baseAngle = this.side.jib * ang;
    } else {
      areaF = this.genDeploy; pivotX = s.tackX; pivotZ = s.tackZ;
      baseAngle = this.side.gennaker * lerp(s.min, s.max, this.lines.jib); side = Math.sign(this.side.gennaker) || 1;
      flogging = 1 - sstep(0.5, 0.95, Math.abs(this.side.gennaker));
      fill = this.genFill;
    }
    if (this.sailHealth) areaF *= this.sailHealth[key] ?? 1;   // torn, blown out or the rig down (js/damage.js)
    if (this.furl) areaF *= 1 - this.furl;                       // lowered at anchor or alongside (js/gear.js)
    o.areaF = areaF; o.baseAngle = baseAngle; o.pivotX = pivotX; o.pivotZ = pivotZ; o.side = side;
    o.flogging = flogging; o.fill = fill; o.luff = luff; o.stream = stream;   // (stream: a let-fly sail's angle, its twist too)
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
        const chord = planChord(s.gaff ? this.setSail(s) : s, f);
        const zs = pivotZ + f * luff + (s.footRise || 0) * 0.4 * (1 - f);
        const lim = Math.max(Math.abs(baseAngle), rg.stream ?? 90 * DEG);  // the leech never twists past square (nor past the wind, let fly)
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
        else if (s.mast) alpha += (s.tackX > C.mastX ? 0.03 : -0.04) * sgn * this._clMain;   // a mizzen sails in the main's downwash, a schooner's foresail in its upwash
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
        o.Fx = Fx; o.Fn = Fn; o.zs = zs;                  // (the rig's structure spreads these onto the luff)
        o.state = flogging > 0.5 ? 1 : (s.kind === 'spin' && fill < 0.6 ? 1 : sc.state);
        o.flog = Math.max(sc.flog, flogging, s.kind === 'spin' ? 1 - fill : 0);
        if (i === 1) {
          if (key === 'main') clMainMid = cl;
          else if (!s.mast) clHeadSum = Math.max(clHeadSum, cl * areaF);
        }
      }
      ds.F = Fsum;
      if (s.kind === 'spin') {
        const target = genAlphaMid > sc.alf * 0.75 * (1 - 0.3 * ctrl.tackLine) && Math.abs(this.side.gennaker) > 0.8 ? 1 : 0;
        this.genFill = clamp(this.genFill + (target ? 1.4 : -2.6) * dt, 0, 1);
      }
      if (s.kind === 'boom') this.boomDynamics(s, boomTorque, dt, aeroOn, ax);
      else if (s.kind === 'loose' && key !== 'jib' && this.sailBy.jib) d.rig[key + 'Load'] = lerp(d.rig[key + 'Load'] || 0, Fsum * 0.95 * areaF, 0.1);
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
    const SP = C.sheetPower * (this.crewPower ?? 1);   // the crew's pulling power, less when tired (js/fatigue.js)

    // ---- environment at the boat ----
    const cur = env.current.at(this.x, this.z, this._c);
    if (!(Number.isFinite(cur.x) && Number.isFinite(cur.z))) { cur.x = 0; cur.z = 0; }   // (a bad sample: no stream this step)
    this.diag.curX = cur.x; this.diag.curZ = cur.z;          // the tide the boat is in (the AI plans with it)
    let wv = null, slopeAlong = 0, slopeLat = 0, slopeLatBow = 0, slopeLatStern = 0, orbU = 0, orbV = 0, waveH = 0;
    // the sea along the hull: 7 samples from stern to bow (height, slopes, orbital velocity)
    const W7 = this._ws7, xs7 = this._xs7 || (this._xs7 = [0, 1, 2, 3, 4, 5, 6].map(i => C.sternX + (C.bowX - C.sternX) * i / 6));
    if (env.wavesOn) {
      for (let i = 0; i < 7; i++) env.waves.sample(this.x + fx * xs7[i], this.z + fz * xs7[i], t, W7[i]);
      // Roll: the wave slope a section feels is not the surface's slope at its centreline. Integrated over the
      // section (Froude-Krylov), the heeling moment of a wave across a waterline of half-breadth b goes as
      // integral y eta dy, which Simpson's rule over (-b, 0, b) makes (eta_s - eta_p) / 2b: the chord across the
      // waterline. A wave long against the beam gives its full slope; one as short as the beam about none, where the
      // tangent at the centreline gave all of it (and the slope spectrum is mostly those short waves). The pressure
      // under the hull is also the wave's at depth, e^{kz}: the Smith effect, at the canoe body's centre of buoyancy
      // with the velocity spectrum's mean k (Lewandowski, "The Dynamics of Marine Craft" (2004) 5.4: the effective wave
      // slope coefficient; Journee & Massie ch. 6; Lloyd, "Seakeeping" (1989) ch. 11).
      {
        const smith = Math.exp(-(env.waves.kv || 0) * 0.4 * (C.canoeDraft || 0.3)), yb7 = this._yb7;
        for (let i = 0; i < 7; i++) {
          const yb = yb7[i], xa = this.x + fx * xs7[i], za = this.z + fz * xs7[i];
          const P = env.waves.sample(xa - sx * yb, za - sz * yb, t, this._wsP[i]), S = env.waves.sample(xa + sx * yb, za + sz * yb, t, this._wsS[i]);
          this._slC[i] = (S.h - P.h) / (2 * yb);
        }
        this._smith = smith;
      }
      // the sea at each hull of a multihull (the trimaran's floats, a cat's hulls), station by station: js/hull.js hullEta
      const hy0 = this.hydro, st0 = hy0.stations[0];
      if (st0.polys.length > 1) {
        const nh = st0.polys.length, HE = this._hE || (this._hE = Array.from({ length: nh }, () => new Float64Array(7))), tmp = this._hEs || (this._hEs = {});
        const yq = this._hY || (this._hY = st0.polys.map((P, q) => { let y = 0, n = 0; for (const st of hy0.stations) { const Q = st.polys[q]; for (let i = 0; i < Q.length; i += 2) { y += Q[i]; n++; } } return n ? y / n : 0; }));
        for (let q = 0; q < nh; q++) for (let i = 0; i < 7; i++) {
          const xa = this.x + fx * xs7[i], za = this.z + fz * xs7[i];
          HE[q][i] = env.waves.sample(xa + sx * yq[q], za + sz * yq[q], t, tmp).h;
        }
        this._hy.hullEta = (x, q) => { const f = clamp((x - C.sternX) / (C.bowX - C.sternX) * 6, 0, 5.999), i = Math.floor(f), w = f - i; return HE[q][i] * (1 - w) + HE[q][i + 1] * w; };
      }
      wv = W7[3];
      waveH = wv.h;
      slopeAlong = wv.sx * fx + wv.sz * fz;
      slopeLat = wv.sx * sx + wv.sz * sz;
      // the water the hull moves through: the orbital velocity averaged over its length (a hull does not feel
      // waves shorter than itself as a current) at its mid-body depth, u ~ e^{kz} with k the velocity
      // spectrum's mean (WaveField.kv), and the Stokes drift of the surface layer, sum w k a^2 e^{2kz}
      const Wv = env.waves, dr = Wv.drift || D0, e1 = Math.exp((Wv.kv || 0) * -0.5 * C.canoeDraft), e2 = Math.exp(2 * (Wv.kd || 0) * -0.5 * C.canoeDraft);
      let ox = 0, oz = 0;
      for (let i = 0; i < 7; i++) { const wt = i === 0 || i === 6 ? 1 / 12 : 1 / 6; ox += W7[i].vx * wt; oz += W7[i].vz * wt; }
      ox = ox * e1 + dr.x * e2; oz = oz * e1 + dr.z * e2;
      orbU = ox * fx + oz * fz; orbV = ox * sx + oz * sz;
      // a boat just put in the water (reset) sits on the sea under her, riding it: set at the still waterline in a sea she
      // was dropped into a trough or held down in a crest (a trimaran with her floats in one displaced two and a half times
      // her weight and was thrown up 1.7 m; a keelboat dropped into a trough shipped water over the deck)
      if (this._fresh) {
        let h = 0, vy = 0;
        for (let i = 0; i < 7; i++) { const wt = i === 0 || i === 6 ? 1 / 12 : 1 / 6; h += W7[i].h * wt; vy += (W7[i].vy || 0) * wt; }
        this.heave = h; this.heaveV = vy;
        this.pitch = clamp((W7[6].h - W7[0].h) / Math.max(0.5, xs7[6] - xs7[0]), -0.3, 0.3); this.pitchV = 0;
      }
    } else { for (let i = 0; i < 7; i++) { W7[i].h = 0; W7[i].sx = 0; W7[i].sz = 0; W7[i].vy = 0; this._slC[i] = 0; } this._hy.hullEta = null; }
    this._fresh = false;

    const vgx = this.u * fx + this.v * sx + cur.x, vgz = this.u * fz + this.v * sz + cur.z;
    this.vgx = vgx; this.vgz = vgz;
    const ug = vgx * fx + vgz * fz, vg = vgx * sx + vgz * sz;

    const w = env.wind.sample(this.x, this.z, t, this._w);
    if (!(Number.isFinite(w.speed) && Number.isFinite(w.dir))) { w.speed = 0; w.dir = Number.isFinite(w.dir) ? w.dir : 0; }   // (nor wind)
    const wsp = w.speed * this.shadow;
    const wx = -Math.sin(w.dir) * wsp, wz = Math.cos(w.dir) * wsp;
    const Wbx = wx * fx + wz * fz, Wby = wx * sx + wz * sz;
    d.tws = w.speed; d.twd = w.dir; d.puff = w.puff;
    // air density: ideal gas at the air's temperature (w.temp, °C, the venue's climate for the date and hour:
    // ~1.32 kg/m3 at -5 °C, 1.225 at 15, 1.16 at 30), and the rain-cooled outflow under a squall (w.cold 0..1)
    // up to ~9 K colder than the air around it, so ~3% denser — a squall hits a little harder than its wind
    // speed alone says (env.js airDensity)
    const rhoA = airDensity(w.temp ?? 15, w.cold || 0);
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

    // ---- lines: handlers take their time, slip when overloaded; released lines run out under their load ----
    stepLines(this, dt);
    // ---- running rigging: lines move at crew/winch speed, slower under load ----
    for (const k of SHEETS) {
      const target = ctrl[k] ?? (k === 'lazy' ? 1 : 0.3);
      const load = (d.rig[(k === 'lazy' ? 'lazy' : k) + 'Load'] || 0) / SP;
      const rate = target > this.lines[k] ? 0.7 : 0.45 / (1 + load * load);
      this.lines[k] = clamp(this.lines[k] + clamp(target - this.lines[k], -rate * dt, rate * dt), 0, 1);
    }
    // mast bend and headstay sag: solved by the rig's structure from last step's loads (js/rig-structure.js); in the
    // strip model's units (bend 1 = the mid-luff forward by 1.8% of the luff, sag 1 = 1.2% of the jib's luff)
    let bend, sag;
    const rs = this.rigStruct;
    if (rs) { rs.update(this, dt); bend = rs.bendN; sag = rs.sagN; }
    else {
      const sheetHard = 1 - sstep(0, 0.3, this.lines.main);
      bend = clamp((C.hasBackstay ? (C.backstayBend ?? 0.75) * ctrl.backstay : 0) + M0.vangBend * ctrl.vang + M0.sheetBend * sheetHard, 0, 1);
      sag = clamp(qMid / 70, 0, 1.3) * (C.hasBackstay ? 1 - 0.75 * ctrl.backstay : 0.5);
    }
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
      const rt = flipRate * dt * (k === 'jib' ? 2 : 1.2) * (C.id === 'blackwatch' || C.keel.long ? 0.7 : 1);
      this.side[k] = clamp(cs + clamp(want - cs, -rt, rt), -1, 1);
      if (k === 'jib' && Math.sign(this.side.jib) !== cur && this.side.jib !== 0) {
        // the clew crossed: the sheet on the new side is now the working sheet
        const byLazy = this.lines.lazy < this.lines.jib;
        [ctrl.jib, ctrl.lazy] = [ctrl.lazy, ctrl.jib];
        [this.lines.jib, this.lines.lazy] = [this.lines.lazy, this.lines.jib];
        swapJib(this);
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
    if (this.rigDown) { /* dismasted: no sails (the wreck's drag comes in through ext, js/damage.js) */ }
    else if (this.sailSys && this.sailSys.active(this)) this.sailSys.step(this, ax);
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
    const uw = this.u - orbU, vw = this.v - orbV;
    // immersion of the real hull in the local sea (heave, pitch and heel included)
    const hy = this.hydro;
    const interp7 = (arr, key, x) => { const f = clamp((x - C.sternX) / (C.bowX - C.sternX) * 6, 0, 5.999), i = Math.floor(f), w = f - i; return arr[i][key] * (1 - w) + arr[i + 1][key] * w; };
    const etaAt = (x) => interp7(W7, 'h', x);
    const slC = this._slC;
    const slLat = (x) => { const f = clamp((x - C.sternX) / (C.bowX - C.sternX) * 6, 0, 5.999), i = Math.floor(f), w = f - i; return slC[i] * (1 - w) + slC[i + 1] * w; };
    const slAl = (x) => (interp7(W7, 'sx', x) * fx + interp7(W7, 'sz', x) * fz);
    // the orbital acceleration along the hull (body axes): the diffraction (added-mass) wave loads
    // (the lateral acceleration the section feels, -g times the slope across it: at the surface of a linear wave the
    // water's horizontal acceleration is -g grad eta, and averaged over the section as the slope is, not the point
    // value at the centreline, which the short waves' w^2 dominate; the lengthwise one from the samples)
    const accAt = wv ? (x, o) => { const ax = interp7(W7, 'ax', x), az = interp7(W7, 'az', x); o.a = ax * fx + az * fz; o.l = -G * slLat(x); o.v = interp7(W7, 'ay', x); o.w = interp7(W7, 'vy', x); } : null;
    const imm = hy.immerse(this.heave, this.pitch, this.phi, etaAt, slLat, this._hy, slAl, accAt, wv ? env.waves.ka || 0 : 0, wv ? this._smith ?? 1 : 1, wv ? clamp(dt / FK_LP_T, 0, 1) : 0);
    // the water at a foil (body station xb, depth zb < 0): the local orbital velocity there and the drift
    const wo = this._wo || (this._wo = { u: 0, v: 0 });
    const waterAt = (xb, zb) => {
      if (!wv) { wo.u = 0; wo.v = 0; return wo; }
      const Wv = env.waves, dr = Wv.drift || D0, e1 = Math.exp((Wv.kv || 0) * Math.min(0, zb)), e2 = Math.exp(2 * (Wv.kd || 0) * Math.min(0, zb));
      const vx = interp7(W7, 'vx', xb) * e1 + dr.x * e2, vz = interp7(W7, 'vz', xb) * e1 + dr.z * e2;
      wo.u = vx * fx + vz * fz; wo.v = vx * sx + vz * sz; return wo;
    };
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
    // water level (body z) at station x: where the foils' roots and tips are in the local sea
    const zwAt = this._zwAt || (this._zwAt = (x) => this._etaAt(x) - this.heave - x * this.pitch);
    {
      const F = C.keel, S = this.keelS, g = this._kg;
      let board = F.board ? clamp(ctrl.board, 0.05, 1) : 1;
      const ww = waterAt(F.x, F.z * cphi);                     // (the orbital water where the foil is)
      const ul = this.u - ww.u;
      if (S.hullProxy) {
        // (the Hobie's hulls: their lift, the lee hull's share growing as the weather hull flies)
        if (F.twin) board *= 0.5 + 0.5 * this.flyIn;
        g.area = F.area * board * Math.max(0, cphi) ** 1.5; g.ARe = F.ARe * Math.max(0.3, board); g.x = F.x; g.z = F.z * (0.4 + 0.6 * board);
        g.imm = 1; g.dRoot = 1; g.dMid = -F.z; g.Fnc = 0; g.sweepCos = 1;
      } else foilGeom(S, board, 0, zwAt, cphi, sphi, 0, ul, g);
      g.area *= this.keelEff ?? 1;                              // (a damaged keel or board: js/damage.js)
      const zk = g.z;
      const vl = (this.v - ww.v + this.r * g.x + this.p * zk) * cphi;
      const V2 = ul * ul + vl * vl, V = Math.sqrt(V2) + 1e-9;
      foilCoefR(S, this.keelSt, Math.atan2(vl, ul), V, g, dt, fc);
      keelCl = fc.cl;
      const q = 0.5 * RHO_W * V2 * g.area;
      const kx = q * (fc.cl * vl / V - fc.cd * ul / V), kn = q * (-fc.cl * ul / V - fc.cd * vl / V);
      X += kx; Y += kn * cphi; K += kn * zk; N += g.x * kn * cphi; d.Kkeel = kn * zk;
      // the bulb: a body of revolution's friction and form drag, low down
      if (S.bulb && g.imm > 0.5 && (this.keelEff ?? 1) > 0.5) { const Db = bulbDrag(S.bulb, ul); X -= Db; d.bulbDrag = Db; }
      if (S.winglets && g.imm > 0.5 && (this.keelEff ?? 1) > 0.5) { const Dw = wingletDrag(S.winglets, ul); X -= Dw; d.wingletDrag = Dw; }
      d.Nkeel = g.x * kn * cphi; d.keelCl = fc.cl;
      d.keelX = kx; d.keelY = kn * cphi; d.keelStall = fc.stalled; d.leeway = Math.atan2(vw, Math.max(0.05, uw));   // (through the water she sails in: the orbital motion she rides on is not leeway)
      d.keelARe = g.ARe; d.keelImm = g.imm; d.keelVent = fc.vent; d.keelRe = fc.Re; d.keelStallA = fc.ast;
    }
    // ---- auxiliary engine: propeller thrust, prop walk, a stopped prop's drag, the outboard's leg and weight, propwash
    if (this.engine) { const e = this.engine.step(this, dt, uw, vw, cphi, sphi); X += e.X; Y += e.Y; K += e.K; N += e.N; }
    {
      const F = C.rudder, S = this.rudS, H = this.helmS;
      // the rudder works in the hull's and keel's wake: the water reaches it ~8% slower (DSYHS-type effective rudder
      // inflow); the local water at the stern: surfing on a crest, the water there runs with the boat and the rudder
      // loses its grip (how a broach starts) (+ the propwash over the blade)
      const ww = waterAt(F.x, F.z * cphi), wu = ww.u, wvv = ww.v;
      const ul = (this.u - wu) * (1 - (F.wake ?? 0.08)) + (this.engine ? this.engine.washU : 0);
      // keel downwash at the rudder: the keel's trailing vortices a distance dx behind it turn the flow by
      // CL / (pi AR_e) (1 + dx / sqrt(dx^2 + s^2)) (s: its span with its image in the hull), nearly twice the lifting-line
      // value by the time it reaches the rudder (the old 1.2 CL / pi AR_e undercut it, and the rudder carried a fifth of
      // the lateral force at zero helm: lee helm); a rudder hung on the keel's trailing edge acts more like a flap
      const dxk = Math.max(0, C.keel.x - F.x), sk = 2 * (this.keelS.span || 1);
      // (the downwash is a sideways velocity, eps times the water the keel meets; in the propeller's slipstream the
      // rudder's water runs faster than that, and the angle it turns that water by is smaller in proportion. Taken whole,
      // a Westsail 32 motoring off from rest, her long keel's lift that of a few cm/s of leeway, had the rudder's water
      // turned past the blade's own angle and spun round with the helm reversed)
      const uK = Math.max(0, (this.u - wu) * (1 - (F.wake ?? 0.08)));
      const eps0 = keelCl / (Math.PI * d.keelARe) * (1 + dxk / Math.sqrt(dxk * dxk + sk * sk)) * (F.transom ? 0.35 : 1);
      const eps = eps0 * clamp(uK / Math.max(1e-3, ul), 0, 1) * (ul > 0 ? 1 : 0);
      // The propeller's slipstream covers only the part of the blade behind the propeller (its diameter over the span):
      // that part meets the faster wash, the rest the boat's own water, each at its own angle. Averaged over the whole
      // blade, the wash stiffened the part outside it against the water swinging in at the stern as she turns (r x), and
      // she was driven round harder than her lateral plane could follow. At rest the wash part alone turns her: prop kick
      const eng = this.engine, wFr = eng && eng.washFr > 0 && uK >= 0 ? clamp(eng.washFr, 0, 1) : 0;
      const parts = this._rudParts || (this._rudParts = [{ f: 1, ul: 0 }, { f: 0, ul: 0 }]);
      if (wFr > 0) { parts[0].f = 1 - wFr; parts[0].ul = uK; parts[1].f = wFr; parts[1].ul = Math.max(uK, eng.washUs * (1 - (F.wake ?? 0.08)) + uK * (F.wake ?? 0.08)); }
      else { parts[0].f = 1; parts[0].ul = ul; parts[1].f = 0; }
      // one blade, or two: a catamaran's on its hulls (the weather one lifts out as the hull flies), a monohull's twin
      // spades F.y either side of the centreline (heeled, the windward blade rises toward the surface)
      const nb = F.twin ? 2 : 1;
      let rx = 0, rn = 0, K0 = 0, N0 = 0, Q = 0, vent = 0, cav = 0, stall = false, imm = 0, a0 = 0;
      const stW = this._rudStW || (this._rudStW = [foilState(), foilState()]);
      for (let k = 0; k < nb; k++) {
        const yb = F.twin ? (k ? 1 : -1) * (F.y ?? C.hullSpacing / 2) : 0, g = this._rg2[k];
        foilGeom(S, 1, this.rudSt[k].kick, zwAt, cphi, sphi, yb, parts[0].ul, g);
        const vl = (this.v - wvv + this.r * g.x + this.p * g.z) * cphi * (1 - (F.wake ?? 0.08));
        for (let pi = 0; pi < 2; pi++) {
          const P = parts[pi]; if (!(P.f > 0)) continue;
          const st = pi ? stW[k] : this.rudSt[k], uP = P.ul;
          if (pi) st.kick = this.rudSt[k].kick;
          const V2 = uP * uP + vl * vl, V = Math.sqrt(V2) + 1e-9;
          const al = wrap(Math.atan2(vl, uP) - eps0 * clamp(uK / Math.max(1e-3, uP), 0, 1) * (uP > 0 ? 1 : 0) + this.rudder);
          foilCoefR(S, st, al, V, g, dt, fc);
          const q = 0.5 * RHO_W * V2 * g.area * P.f / nb * (this.rudderEff ?? 1);   // (a bent blade: js/damage.js)
          const fx = q * (fc.cl * vl / V - fc.cd * uP / V), fn = q * (-fc.cl * uP / V - fc.cd * vl / V);
          rx += fx; rn += fn; K0 += fn * g.z; N0 += g.x * fn * cphi;
          // stock torque: the normal force at the centre of pressure about the stock (a kicked-up blade's is far aft)
          const kickArm = st.kick ? 0.5 * g.span * Math.sin(g.sweep) / S.chord : 0;
          Q += stockTorque(fc.cn, 0.5 * RHO_W * V2, g.area * P.f / nb, S.chord, fc.xcp + kickArm, S.balance);
          vent += fc.vent * P.f / nb; cav += fc.cav * P.f / nb; stall = stall || fc.stalled; imm += g.imm * P.f / nb; if (!k && !pi) a0 = al;
        }
      }
      X += rx; Y += rn * cphi; K += K0; N += N0;
      d.Nrud = N0; d.rudAlpha = a0; d.eps = eps; d.rudAst = fc.ast;
      d.rudderX = rx; d.rudderY = rn * cphi; d.rudderStall = stall; d.rudderLoad = Math.abs(rn);
      d.rudderVent = imm * (1 - vent); d.rudderVentilated = vent; d.rudderCav = cav; d.rudderImm = imm; d.rudderKick = this.rudSt[0].kick;
      // what the helm feels: the stock torque through the tiller or the wheel (+ = the blade pushing toward more angle)
      d.rudderTorque = Q; d.helmMoment = Q;
      d.helmForce = helmForce(H, Q); d.helmFeel = helmFeel(d.helmForce);
    }
    // ---- a foiler's lifting foils: each strip at its own depth in the local sea, its own flow (the boat's motion in all
    // six senses, the waves' orbital water); their force and moments into surge, sway, roll and yaw here, heave and pitch
    // below. A surface-piercing foil lifts by what is under water: she finds her ride height by herself.
    let foilFz = 0, foilMy = 0, kF = 0;
    if (this.hfoils) {
      const r0 = this._r0 || (this._r0 = [0, 0, 0]), kv = wv ? env.waves.kv || 0 : 0, cth = Math.cos(this.pitch), sth = Math.sin(this.pitch);
      const relVel = (p, S, o) => {
        const x = p[0], y = p[1], zd = p[2], q = this.pitchV || 0;
        const ww = waterAt(x, Math.min(0, -zd));
        const vx = this.u - this.r * y + q * zd, vy = this.v + this.r * x - this.p * zd, vz = -this.heaveV - q * x + this.p * y;
        const wz = wv ? -(this._etaDot(x) || 0) * Math.exp(kv * Math.min(0, -zd)) : 0;   // (the water's own vertical motion, + down)
        const Rx = ww.u - vx, Ry = ww.v - vy, Rz = wz - vz;
        // (into the body's axes: pitched, then heeled. The pitch turns the flow at every foil: a bow-up hull meets
        // the water from below on its foils, its main foils' and its T-foil's angle of attack rise with it, which is the
        // T-foil's whole pitch stability: without it the foils felt only the pitch rate)
        const xb = Rx * cth - Rz * sth, zp = Rx * sth + Rz * cth;
        o[0] = xb; o[1] = Ry * cphi + zp * sphi; o[2] = -Ry * sphi + zp * cphi;
        return o;
      };
      const depth = (p) => depthAt(zwAt(p[0]), p[1], -p[2], cphi, sphi);
      const fd = d.hfoils || (d.hfoils = []);
      for (let i = 0; i < this.hfoils.length; i++) {
        const Sf = this.hfoils[i], F0 = Sf.spec;
        const flap = F0.flap ? lerp(F0.flap[0], F0.flap[1], clamp(ctrl.flap ?? 0.5, 0, 1)) : 0;
        Sf.setIncidence(-((F0.inc || 0) + flap));
        Sf.forces(relVel, depth, RHO_W, r0, dt);
        const F = Sf.F, M = Sf.M;
        // (back to the level frame: the heel undone, then the pitch)
        const fy = F[1] * cphi - F[2] * sphi, zh = F[1] * sphi + F[2] * cphi, fx = F[0] * cth + zh * sth, fzd = -F[0] * sth + zh * cth;
        X += fx; Y += fy; K += M[0]; N += M[2]; foilFz -= fzd; foilMy += M[1]; kF += M[0];
        const q = fd[i] || (fd[i] = {});
        q.name = F0.name; q.lift = -fzd; q.side = fy; q.drag = -F[0]; q.imm = Sf.diag.imm; q.vent = Sf.diag.vent; q.cav = Sf.diag.cav; q.alpha = Sf.diag.alpha;
      }
      d.foilLift = foilFz; d.Kfoil = kF;
      // a hull that skims the water at speed (a foiler's leeward float, its main hull touching down): the water it
      // presses down leaves its transom with the hull's vertical speed, a vertical force -U a33(x_T) w at the transom
      // (slender-body theory at speed: the momentum of the added mass m33 = rho pi b^2 / 2 of the wetted section,
      // half-breadth b at the waterline, carried aft at U; Faltinsen 2005, "Hydrodynamics of High-Speed Marine
      // Vehicles" 9.2, the planing hull's damping in heave and pitch). Zero-speed radiation damping (the heave block
      // below) is a few percent of it at 20 m/s: a skimming float damps the heel and heave of a flying trimaran
      const U = Math.max(0, uw), P = this._parts || (this._parts = hullParts(C));
      let Fp = 0, Kp = 0, Mp = 0;
      if (U > 1) for (const Pt of P) {
        const xT = C.sternX + (C.bowX - C.sternX) * Pt.t0 + 0.3;
        const r = Pt.tube ? Pt.tube.r : (C.hullBeam ?? C.beam) / 2, zk = Pt.tube ? Pt.tube.z - Pt.tube.r : -C.canoeDraft;
        const dk = depthAt(zwAt(xT), Pt.y, zk, cphi, sphi);
        if (dk <= 0) continue;
        const b = dk < r ? Math.sqrt(Math.max(0, 2 * r * dk - dk * dk)) : r;
        const a33 = RHO_W * Math.PI * b * b / 2, w = this.heaveV + xT * (this.pitchV || 0) - this.p * Pt.y * cphi;
        const f = -U * a33 * w;
        Fp += f; Mp += f * xT; Kp -= f * Pt.y * cphi;
      }
      K += Kp; this._planeF = Fp; this._planeM = Mp; d.planeDampK = Kp;
    }
    {
      // a planing monohull rises onto its run and dries its forward sections, once it is over its hump (the Delft
      // resistance it follows to Fn 0.7, like any towing-tank C_R, is referenced to the static wetted area and
      // already holds the sinkage and trim up to there). A displacement keelboat never gets up there (planing 0), nor
      // does a multihull's slender, round-bilged hull (beam/length ~0.08): its towing-tank table holds its trim
      const slender = C.multihull || C.amas;                             // (a trimaran's hulls are slender too)
      const planeLift = slender ? 0 : planingOf(C) * sstep(0.7, 1.2, Fn);
      const Swet = imm.girthLen * (1 - 0.3 * planeLift);                 // wetted surface of the real hull
      const Rf = 0.5 * RHO_W * Swet * uw * uw * cfITTC(uw, lwlDyn) * 1.08;
      // fore-aft crew weight: forward in light air (bury the bow, lift the transom), aft when planing
      const optTrim = lerp(-0.6, 0.8, sstep(0.3, 0.55, Fn));
      const trimPen = 1 + 0.09 * (this.crewX - optTrim) ** 2;
      // (a trimaran's table is for its main hull carrying her (L/vol^(1/3) ~ 10); flying it, the leeward float carries
      // it all, a shorter hull at 2-3 times its load: the Southampton series' C_R rises as slenderness falls, Rr/W about
      // as slenderness^-1.3 (Molland et al. 1994), so each hull's share of the weight is charged at its own slenderness.
      // (The cat's two equal hulls: one hull flying doubles the other's load, the 1.3 factor below.)
      // (a foiler lifted out: the waves her hulls make go with what is left of them in the water)
      const flyF = this.hfoils ? clamp(imm.V / Math.max(1e-6, hy.restV), 0, 1) : 1;
      const Rr = flyF * disp * G * interp(C._rr, Fn) * (C.multihull ? 1 + 0.3 * (1 - this.flyIn) : C.amas ? amaLoad(this, imm) : 1 + 0.5 * this.phi * this.phi) * trimPen;
      let Raw = 0;
      if (wv) {
        // added resistance in waves comes from the waves about the boat's own length (it rides the long ones
        // up and down and meets no more resistance): each component's energy through a response peaked at
        // lambda ~ 1.3 L (Gerritsma & Beukelman's peak), falling to nothing for waves several times longer
        // (a 5 m hull in a 300 m ocean wave). (Hs/2)^2 = 2 sum A^2 where every wave counts.
        let z2 = 0, en = 0;
        for (const c of env.waves.comps) {
          const lq = Math.log(2 * Math.PI / (c.kRef ?? c.k) / (1.3 * C.lwl)), a = c.A * (c.curAmp ?? 1), a2 = a * a * Math.exp(-lq * lq / 0.5);
          z2 += a2; en += a2 * Math.max(0, -(fx * c.dx + fz * c.dz));
        }
        const enc = z2 > 0 ? en / z2 : 0;                                 // head seas cost the most
        // (the waves reflect off the hulls' waterline beam: a multihull's two slender hulls, not its overall beam,
        // which made a beach cat in a 20 kn sea drag a kilonewton, a third of its weight)
        const Bw = C.multihull ? 2 * C.hullBeam : C.beam;
        Raw = 0.12 * RHO_W * G * 2 * z2 * Bw * (0.3 + enc) * clamp(Math.abs(uw) / 2, 0, 1);
      }
      // going astern the flat transom leads: separated flow, several times the forward drag
      const astern = uw < 0 ? 1 + 3.5 + 0.5 * RHO_W * uw * uw * C.beam * C.freeboard * 0.5 / Math.max(1, Rf + Rr) : 1;
      X -= (Rf + Rr + Raw) * Math.sign(uw) * astern;
      d.Rf = Rf; d.Rr = Rr; d.Raw = Raw;
      const H = C.hullLat;
      const cf = (this.hfoils ? clamp(imm.V / Math.max(1e-6, hy.restV), 0, 1) : 1) * 0.5 * RHO_W * H.area * H.cd * vw * Math.abs(vw);
      Y -= cf; K -= cf * H.z;
      const T = C.canoeDraft, L = C.lwl;
      const N0 = N;
      // The hull's cross-flow drag strip by strip along the length (Hooft 1994; Oltmann & Sharma 1984): each strip meets
      // the water sideways at v + r x, so a hull turning while it skids feels it most at the end that swings out. (The
      // pure-sway part stays the class's cf above: straight-line sailing is unchanged; the strips carry the rotation,
      // the r|r| term alone before, and the cross terms that were missing.) And the canoe body's linear yaw damping at
      // the old 0.03 T/L (Clarke, Gedling & Hine's N'r for a canoe body alone), raised to 2.5x of it while the propeller's
      // race runs over the stern: the faster water there over the run, deadwood and skeg resists the stern's swing as she
      // turns under power. Set with the strips on the turning circles under power (test/manoeuvres.mjs; without it the
      // fin keelers pivoted round in half a length); under sail it stays 1x, which the tacks need (test/seatrial.mjs,
      // 2.5x everywhere put half again as many tacks into irons)
      {
        const cs = 0.5 * RHO_W * 0.9 * T, n = 12, dxs = L / n;
        let Ys = 0, Ns = 0;
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + (i + 0.5) * dxs, w = vw + this.r * x;
          const f = cs * (w * Math.abs(w) - vw * Math.abs(vw)) * dxs;
          Ys -= f; Ns -= f * x;
        }
        Y += Ys * Math.abs(cphi); N += Ns * Math.abs(cphi);   // (a drag: it opposes the motion whichever way she lies)
      }
      const yawWash = this.engine && this.engine.washFr > 0 ? clamp(this.engine.washFr / 0.15, 0, 1) : 0;
      N -= 0.5 * RHO_W * T * L ** 3 * 0.03 * (1 + 1.5 * yawWash) * (Math.abs(uw) + 0.3) * this.r;
      if (!slender) N -= 0.011 * 0.5 * RHO_W * uw * Math.abs(uw) * L * L * T * Math.sin(this.phi);
      // hull drag acts where the immersed volume is: a multihull on its leeward hull wants to bear away
      if (imm.V > 1e-6) N += (Rf + Rr) * Math.sign(uw) * (imm.My / imm.V) * cphi * (slender ? 1 : 0.3);
      // Munk moment: a hull moving at a drift angle carries more fluid momentum sideways than lengthwise,
      // and the difference turns it broadside to the flow, N = -(m_y - m_x) u v (Kirchhoff; the added-mass
      // Coriolis term the surge and sway equations already carry, closed in yaw). With leeway it adds weather
      // helm; in a turn (bow inside the track) it tightens the turn. Water-relative velocities, as for the hull.
      // (a class may scale it, C.munkK: a deep long-keeled hull, whose potential-flow moment the viscous flow round its
      // deep, separated run cuts well down: js/classes/util.js clarkeMunkK)
      // (potential flow: it holds while the flow stays on the hull, a few degrees of leeway. Skidding round a turn, past
      // ~15 degrees of drift the flow leaves the run and the cross flow takes over (the strips above): the moment falls
      // to a quarter by 40 degrees (ship captive-model data: Hooft 1994, Oltmann & Sharma 1984, N(beta) peaks at 10-20
      // degrees). Whole, it kept spinning a yacht turning hard under power until she pivoted on the spot)
      const beta = Math.atan2(Math.abs(vw), Math.abs(uw) + 1e-6);
      // (and the canoe body's, not the boat's: m22 carries the keel's and the rudder's added mass too, whose own lift at
      // their own stations is in their forces already. For the canoe body Clarke, Gedling & Hine's (1983) regression of
      // captive-model tests, N'v = -pi (T/L)^2 (0.5 + 2.4 T/L) on 0.5 rho L^3 U v with T its draft, gives ~0.55 of the
      // whole boat's m22 - m11 on a fin-keeled yacht: the old figure turned a Catalina 30 under power at 24 deg/s, the
      // hull's moment as large as the rudder's, and she skidded out of the turn. A class's own munkK still applies)
      const Tc = C.canoeDraft || 0.3, Lw = C.lwl || C.loa;
      const munkC = C.munkK !== undefined ? C.munkK * (this.m22 - this.m11) : Math.min(this.m22 - this.m11, 0.5 * RHO_W * Math.PI * Lw * Tc * Tc * (0.5 + 2.4 * Tc / Lw));
      const Nmunk = -munkC * uw * vw * cphi * (1 - 0.75 * sstep(15 * DEG, 40 * DEG, beta));
      N += Nmunk; d.Nmunk = Nmunk;
      d.Nhull = N - N0;
      X -= 2 * uw;
    }

    // ---- grounding on the real bottom ----
    this.aground = 0;
    if (world) {
      // a kick-up rudder that touches bottom swings up (and stays up until the crew pushes it down in deep water)
      if (this.rudS.kickUp) {
        const xr = C.rudder.x, dR = world.depthAt(this.x + fx * xr, this.z + fz * xr), tipD = (this.rudS.span / 2 - C.rudder.z) * Math.abs(cphi);
        for (const st of this.rudSt) kickUpdate(this.rudS, st, dR, tipD, dt);
      }
      // the keel (at the origin, her full draught) and the forefoot and the heel of the hull at the ends, which meet a
      // steep shore or a quay before the keel does: a fin keel grounds out in the water, but where the bed drops away
      // steeply at the waterline (a lake's rocky shore, a harbour wall) the keel finds no bottom until the bow is over
      // the land (test/aground.mjs: Garda's shore)
      const draftK = (C.keel.board ? C.draft * clamp(ctrl.board, 0.2, 1) : C.draft) * Math.abs(cphi) + 0.05;
      const dEnd = 0.3 * (C.canoeDraft || 0.3) * Math.abs(cphi) + 0.05;
      for (let q = 0; q < 3; q++) {
        const xp = q === 0 ? 0 : q === 1 ? 0.92 * C.bowX : 0.92 * C.sternX;
        const px = this.x + fx * xp, pz = this.z + fz * xp, depth = world.depthAt(px, pz);
        const wP = q === 0 || depth < 0 ? 1 : 0.2;                         // (an end over the land: against the shore)
        const pen = (q === 0 ? draftK : dEnd) - depth;
        if (pen <= 0) continue;
        this.aground = Math.max(this.aground, pen);
        const vp = this.v + this.r * xp;                                   // (the probe's sideways speed)
        const k = clamp(pen / 0.15, 0, 1) * wP;
        let Xb = -this.u * disp * 4 * k, Yb = -vp * disp * 4 * k;
        if (q === 0) N -= this.r * this.Izz * 3 * k;
        const g = world.gradDepth(px, pz);
        if (q === 0 && depth < 0.05) { // beached: push back toward water
          Xb += (g[0] * fx + g[1] * fz) * disp * 3; Yb += (g[0] * sx + g[1] * sz) * disp * 3;
        }
        // The bed carries some of her weight (what lifting her by pen would take off her buoyancy, rho g Awp pen, up to
        // all of it; at an end a share of it) and holds her by it: a keel or a hull driven up a bank ploughs the sand or
        // mud ahead of it (~0.6 of that weight against going on up the slope), and slides on it (~0.15 every way). The
        // damping above alone only slowed her: her sails still drawing, a keelboat crept on up the bank at a few tenths
        // of a knot and a beached dinghy sailed up the beach onto the land (test/aground.mjs). Backing off down the
        // slope stays free of the plough, as a kedge, the engine astern or the rising tide get a real boat off.
        const Nb = wP * Math.min(disp * G, RHO_W * G * this.Awp * pen);
        const vwx = this.u * fx + vp * sx, vwz = this.u * fz + vp * sz, vs = Math.hypot(vwx, vwz);
        if (vs > 1e-6) {
          const gl = Math.hypot(g[0], g[1]), w = clamp(gl / 0.02, 0, 1), nx = gl > 1e-9 ? -g[0] / gl : 0, nz = gl > 1e-9 ? -g[1] / gl : 0;
          const vup = Math.max(0, vwx * nx + vwz * nz);                       // (her speed on up the slope)
          const rx = w * vup * nx + (1 - w) * vwx, rz = w * vup * nz + (1 - w) * vwz, rs = Math.hypot(rx, rz);
          let Fx = 0, Fz = 0;
          if (rs > 1e-6) { const F = Math.min(0.6 * Nb * rs / (rs + 0.05), wP * disp * rs / dt); Fx -= F * rx / rs; Fz -= F * rz / rs; }
          // (the slide: under the keel only, so that an end lying over the shore by the chart's resolution, alongside a
          // quay, never holds her there)
          if (q === 0) { const F2 = Math.min(0.15 * Nb * vs / (vs + 0.05), disp * vs / dt); Fx -= F2 * vwx / vs; Fz -= F2 * vwz / vs; }
          Xb += Fx * fx + Fz * fz; Yb += Fx * sx + Fz * sz;
        }
        X += Xb; Y += Yb; N += xp * Yb;
      }
    }

    // ---- hydrostatics & crew ----
    // buoyancy of the immersed hull: roll restoring moment from where the displaced volume actually is,
    // hull + ballast weight at its real height, crew weight where the crew is
    const Fb = RHO_W * G * imm.V;
    K -= RHO_W * G * imm.My;
    K += (this.mHull ?? C.massHull) * G * (this.zG ?? C.zG) * sphi;          // (less, and higher, with the keel gone)
    d.Kwave = -RHO_W * G * imm.My + (this.mHull ?? C.massHull) * G * (this.zG ?? C.zG) * sphi;   // (buoyancy and weight: hydrostatic in the wave)
    K -= this.cRoll * this.p;
    if (this.righting) {
      if (C.multihull) K -= (Math.sign(this.phi) || 1) * this.crewMass * G * (C.hullSpacing * 0.75) * Math.abs(cphi) ** 0.3; // hanging off the righting line
      else K += this.crewMass * G * (-(C.keel.span * clamp(ctrl.board, 0.3, 1) + C.canoeDraft + 0.2)) * sphi; // standing on the board tip
    } else K += this.crewMass * G * (this.crewY * cphi + C.crewZ * sphi);
    // Froude-Krylov wave forces on the immersed volume (surfing, wave roll/yaw)
    d.fkX = wv ? RHO_W * G * imm.FKx : 0;
    d.diffX = 0; d.diffY = 0; d.brkF = 0;
    if (wv) {
      X += RHO_W * G * imm.FKx; Y += RHO_W * G * imm.FKy * cphi; N += RHO_W * G * imm.FKn * cphi; d.Nfk = RHO_W * G * (imm.FKn - (this.xG || 0) * imm.FKy) * cphi;   // (about the CG: see the integration)
      // diffraction: a body in accelerating water feels (rho V + m_a) a (G. I. Taylor 1928); Froude-Krylov
      // above is the rho V a (at the surface -grad p / rho = g grad eta), this is the added mass's m_a a,
      // section by section with its depth decay, at the class's added-mass coefficients (sway, surge); the
      // heave part goes to the heave equation below. Big waves heave, surge and roll the boat by the
      // inertia of their water, not only by where their surface is.
      const Dx = C.amX * RHO_W * imm.FAx, Dy = C.amY * RHO_W * imm.FAy;
      X += Dx; Y += Dy * cphi; N += C.amY * RHO_W * imm.FAn * cphi; K += C.amY * RHO_W * imm.FAk; d.Ndiff = C.amY * RHO_W * (imm.FAn - (this.xG || 0) * imm.FAy) * cphi; d.Kdiff = C.amY * RHO_W * imm.FAk;
      d.diffX = Dx; d.diffY = Dy;
      // ---- a breaking crest (WaveField.sample: brk on the upper front quarter of a steep crest). Its top is a
      // jet of water moving at about the crest's phase speed c = g / w (the lip of a plunger, the roller of a
      // spilling breaker), a sheet ~0.3 of the local wave height thick. Where it meets the hull's exposed
      // side it stops against it: impact pressure 1/2 rho C_s v^2 on the area it strikes (v relative to the
      // hull, C_s = BRK_CS averaged over the slam; peaks are several times it), above the waterline, while the
      // keel holds the bottom of the boat in the slower water beneath: the trip that knocks a boat down or
      // rolls it past 90 deg (a transom struck from astern: surge and bow-down pitch, the start of a
      // pitchpole). The energy behind it: E = rho g H^2 / 8 per m^2 of sea (a 4 m breaker 20 kJ/m^2),
      // carried at the group speed (~6 m/s: 120 kW per metre of crest); the jet's momentum flux rho c^2 t
      // (c = 11 m/s, t = 0.5 m) is ~60 kN per metre of crest, so beam-on a small yacht takes far more
      // than its own weight in thrust for a fraction of a second. How much of that it takes is capped
      // below by what stops the relative flow within the step (implicit: the boat is carried at most up to
      // the jet's speed). Model tests after the 1979 Fastnet (Wolfson Unit, SNAME/USYRU 1985): beam-on,
      // a breaker ~30 % of LOA high knocks a yacht down, ~55 % rolls most of them over; here (C_s set to
      // that order) 30 % rolls it ~55 deg, 50 % lays it flat past 90 deg (test/knockdown.mjs).
      let Fy = 0, Fx = 0, Kb = 0, Nb = 0, Mb = 0, Dl = 0, Dr = 0, Da = 0;
      const dxs = (C.bowX - C.sternX) / 6;
      for (let i = 0; i < 7; i++) {
        const s = W7[i]; if (!(s.brk > 0.02)) continue;
        const xb = xs7[i], L = (i === 0 || i === 6 ? 0.5 : 1) * dxs;
        // struck height (the topsides, and the deck as the boat lies over), its centre above the waterline
        const he = Math.min(0.6 * s.Ea, C.freeboard + 0.3 + 0.5 * C.beam * Math.abs(sphi)), zi = 0.5 * he;
        const jx = 0.9 * s.cbx, jz = 0.9 * s.cbz;                               // the jet, in the water's frame
        const rl = jx * sx + jz * sz - this.v - this.r * xb - this.p * zi, ra = jx * fx + jz * fz - this.u;
        const q = 0.5 * RHO_W * BRK_CS * s.brk;
        const Dy = q * Math.abs(rl) * L * he;
        Fy += Dy * rl; Kb += Dy * rl * zi * cphi; Nb += Dy * rl * xb; Dl += Dy; Dr += Dy * zi * zi;
        // the transom from astern, the bow from ahead
        if ((i === 0 && ra > 0) || (i === 6 && ra < 0)) { const Dxx = q * Math.abs(ra) * C.beam * 0.7 * he; Fx += Dxx * ra; Mb -= Dxx * ra * zi; Da += Dxx; }
      }
      if (Dl > 0 || Da > 0) {
        const sl = Math.min(1, 0.5 * this.m22 / Math.max(1e-9, Dl * dt), 0.5 * this.Ixx / Math.max(1e-9, Dr * dt)), sa = Math.min(1, 0.5 * this.m11 / Math.max(1e-9, Da * dt));
        Y += Fy * sl; K += Kb * sl; N += Nb * sl; X += Fx * sa; this._brkMy = Mb * sa;
        d.brkF = Math.hypot(Fx * sa, Fy * sl);
      } else this._brkMy = 0;
    } else this._brkMy = 0;
    d.Fb = Fb;

    // ---- mast in the water: a sealed spar floats, which is what holds a capsized boat on its side ----
    {
      const r0 = C.mastR ?? (C.id === 'dinghy' ? 0.032 : C.id === 'sportboat' ? 0.05 : 0.055);
      const base = C.boomZ - 0.8, L = (this.mastTop ?? C.mastHeight) - base, nSeg = 6;   // (a broken mast: its stump)
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

    // external loads: anchor rode, mooring lines, fenders, a wreck over the side, water aboard (js/anchor.js, mooring.js, damage.js)
    const E = this.ext;
    if (E) { X += E.X; Y += E.Y; N += E.N; K += E.K; }
    // ---- integrate rigid body ----
    const m11 = this.m11, m22 = this.m22;
    // (yaw about the centre of gravity: the hull floats level with its centre of gravity over its centre of buoyancy,
    // xG from the origin the forces' arms are measured from, so a side force through it (a wave's, all at the centre of
    // buoyancy) turns nothing. Taken about the origin it did: in a beam sea a 30 ft yacht's hull, whose waves' side
    // force is all at x = xG ~ -0.3 m, felt a yaw moment of 2 kN m where slender-body theory has none. Sailing
    // steadily the side forces sum to nothing and this is zero)
    N -= (this.xG || 0) * Y;
    let du = (X + m22 * this.v * this.r) / m11;
    let dv = (Y - m11 * this.u * this.r) / m22;
    let dr = N / this.Izz;
    // (the air the sails carry: gone as they lie down on the water, where the wet strips' drag takes over, and with
    // the rig if it comes down: ~ the cube of what stands of it, the sail's area and its height)
    const rigUp = this.mastTop === undefined ? 1 : clamp((this.mastTop - C.boomZ) / Math.max(0.1, C.mastHeight - C.boomZ), 0, 1) ** 3;
    const Ir = this.Ixx + (this.IxxAir || 0) * rigUp * (1 - sstep(50 * DEG, 80 * DEG, Math.abs(this.phi)));
    this._Ir = Ir;
    const dp = K / Ir;
    this._rdot = dr;
    this.u += du * dt; this.v += dv * dt; this.r += dr * dt;
    if (this._wD11 > 0) { // backward Euler for the wet-rig drag: (M + dt D) [v r]' = M [v r]  (D is symmetric, >= 0)
      const a11 = m22 + dt * this._wD11, a12 = dt * this._wD12, a22 = this.Izz + dt * this._wD22;
      const b1 = m22 * this.v, b2 = this.Izz * this.r, det = a11 * a22 - a12 * a12;
      this.v = (b1 * a22 - a12 * b2) / det; this.r = (a11 * b2 - a12 * b1) / det;
    }
    // explicit roll, then the stiff water damping of a wet rig implicitly (unconditionally stable)
    this.p = (this.p + dp * dt) / (1 + (this._cRollWet || 0) * dt / Ir);
    // guards: a numerical blow-up must never take the game down
    this.p = clamp(this.p, -8, 8); this.r = clamp(this.r, -4, 4); this.v = clamp(this.v, -15, 15); this.u = clamp(this.u, -8, C.speedMax ?? 30);
    for (const k of ['u', 'v', 'r', 'p', 'phi', 'heave', 'heaveV', 'pitch', 'pitchV']) if (!isFinite(this[k])) this[k] = 0;
    this.phi += this.p * dt;
    this.psi = wrap(this.psi + this.r * dt);
    this.x += (this.u * fx + this.v * sx + cur.x) * dt;
    this.z += (this.u * fz + this.v * sz + cur.z) * dt;
    this.log += Math.abs(this.u) * dt;
    // a bow driven under keeps going: past what this pitch model can represent, the boat trips over
    // sideways (how a multihull pitchpole usually ends) — the angular momentum goes into roll
    // (over a few tenths of a second, as the buried bow slews her: the pitch's angular momentum handed to roll at a rate,
    // Iyy w_pitch -> Ixx w_roll with some lost to the water, not all in one step, which spun the roll up by 6 rad/s in
    // 1/120 s and broke rigs on a J/70 running and on the Hobie)
    if (this.pitch <= -0.5 && this.pitchV < 0) {
      const f = clamp(dt / 0.35, 0, 1) * sstep(-0.5, -0.59, this.pitch);
      const Iy = this.Iyy + (this.hydro.A55 || 0), Ix = this._Ir || this.Ixx;
      const dL = f * Iy * -this.pitchV;
      this.p += (Math.sign(this.phi) || 1) * 0.7 * dL / Ix;
      this.pitchV *= 1 - f;
    }
    if (this.phi > Math.PI) this.phi -= 2 * Math.PI; if (this.phi < -Math.PI) this.phi += 2 * Math.PI;

    // ---- rudder: slew rate limited by hydrodynamic load on the blade ----
    // (the helm puts it over as fast as a hand moves the tiller or the wheel, slower against the stock torque; a torque
    // beyond what the helm can push takes it back: js/helm.js)
    if (!Number.isFinite(this.rudder)) this.rudder = 0;
    const target = clamp(Number.isFinite(ctrl.helm) ? ctrl.helm : 0, -1, 1) * C.rudder.max * (this.rudderLim ?? 1) + (this.rudderBias || 0);   // (a bent stock)
    this.rudder = rudderStep(this.helmS, this.rudder, target, d.rudderTorque || 0, C.rudder.max, dt);

    // ---- crew: hiking (athwartships) and fore-aft ----
    let crewTarget;
    // (the side the wind is on, as the crew takes it: on a run the apparent wind swings across the stern with every
    // roll (the masthead's own motion), and a crew that changed sides with it drove the roll: it changes side only
    // when the wind is clearly over the other quarter, or has been for a second)
    const ws0 = -Math.sign(awaMid) || 1;
    if (this._ws === undefined || Math.abs(awaMid) < 160 * DEG) { this._ws = ws0; this._wsT = 0; }
    else if (ws0 !== this._ws) { this._wsT = (this._wsT || 0) + dt; if (this._wsT > 1.5) { this._ws = ws0; this._wsT = 0; } }
    else this._wsT = 0;
    const windSide = this._ws;
    const lim = C.crewMaxOut * (this.hikeLimit ?? 1);   // (tired legs: js/fatigue.js)
    if (this.auto.hike) {
      const upwindness = 1 - sstep(80 * DEG, 150 * DEG, Math.abs(awaMid));
      // (a crew heels her to the target only when there is a wind to sail by: in a flat calm, sails slatting, they sit
      // her upright, not on her lee rail for hours)
      const tgt = windSide * C.targetHeel * 0.6 * upwindness * sstep(0.2, 1.0, qMid);
      const err = this.phi - tgt;
      this._hikeI = clamp((this._hikeI || 0) + err * dt * 1.2, -0.4, 0.4);
      const Mc = this.crewMass * G * lim;
      const ff = 0.8 * (this._sailKf || 0) / Mc;
      // PD gains from the roll inertia the crew's weight has to steer: a ~2.5 rad/s, well-damped loop.
      // Fixed gains made the light boats' loop faster than a sailor can cross the boat (hikeRate): the crew
      // lagged the heel, the lag turned into a self-excited ±50° roll that pumped the rig downwind.
      // Off the wind the crew does not chase the roll: the sail's heeling moment is small, a rolling boat's is mostly
      // its own, and weight thrown across at a crew's pace lags it by a quarter period and feeds it. They sit still,
      // leaning against the heel only as it builds over a second or two (loop gains to a fifth, rate term off).
      const calm = lerp(0.2, 1, upwindness);
      this._phiF = lerp(this._phiF ?? this.phi, this.phi, clamp(dt * lerp(0.7, 20, upwindness), 0, 1));
      const errC = lerp(this._phiF - tgt, err, upwindness);
      const Ir = this._Ir || this.Ixx, wn = 2.5, kp = Ir * wn * wn / Mc * calm, kd = 2 * 0.9 * wn * Ir / Mc * upwindness;
      const cmd = clamp(errC * kp + this.p * kd + (this._hikeI + ff) * upwindness, -1, 1);
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
    // Strip theory (Salvesen, Tuck & Faltinsen 1970, the zero-speed terms): each station of the hull carries its own
    // added mass a33(x) (js/hull.js) while it is wet, and feels the sea at its own place:
    //   (m + A33) z'' + A35 th'' = F_hs + rho sum V a_w + sum a33 a_w - B sum a33 (z' + x th' - w)
    //   A35 z'' + (Iyy + A55) th'' = M_hs + rho sum V a_w x + sum a33 a_w x - B sum a33 x (z' + x th' - w)
    // F_hs, M_hs: the buoyancy of the hull under the local surface (hydrostatic in the wave); rho V a_w: the
    // Froude-Krylov part that surface does not carry (the wave's pressure decays as e^{kz}: at the hull's depth it is
    // less than rho g eta by rho V a_w); a33 a_w: diffraction; B: radiation damping, set so a hull at rest has
    // zeta ~0.3 in heave (measured yacht heave RAOs peak at ~1.5-2 at resonance: Gerritsma, Keuning & Versluis 1993),
    // pitch damping following from the same sections. A hull that leaves the water keeps its own mass only and
    // free-falls (dropping off a wave).
    {
      const W = disp * G;
      const Fz = Fb - W;
      const kz = RHO_W * G * this.Awp, A33r = Math.max(1e-6, this.hydro.A33);
      const beta = 2 * 0.3 * Math.sqrt(kz * (disp + A33r)) / A33r;
      const M33 = imm.M33 || 0, M35 = imm.M35 || 0, M55 = imm.M55 || 0;
      let F = Fz + foilFz + (this.hfoils ? this._planeF || 0 : 0), Mw = 0;
      if (wv) { F += RHO_W * (imm.FAz || 0) + imm.F33; Mw = RHO_W * (imm.FAm || 0) + imm.F35; }
      // (the damping against the water's own vertical velocity: zero in calm water)
      F -= beta * (M33 * this.heaveV + M35 * this.pitchV - (wv ? imm.W33 : 0));
      const crewXm = this.crewX * 0.8 + (C.crewX0 ?? 0);
      let My = RHO_W * G * imm.Mx - W * this.xG - this.crewMass * G * crewXm + Mw + foilMy + (this.hfoils ? this._planeM || 0 : 0);
      My -= beta * (M35 * this.heaveV + M55 * this.pitchV - (wv ? imm.W35 : 0));
      // bow driven under: green water on the foredeck pushes it down (moment = x * Fz)
      // (across the bow that is under: a multihull's own hull, not her platform's overall beam: the Hobie's 2.4 m beam
      // over a 0.42 m bow pressed a buried bow down at twice her weight, and she pitchpoled reaching in a 0.5 m chop; the
      // trimaran's 15 m, a hundred tonnes)
      const bowB = C.multihull || C.amas ? (C.hullBeam ?? C.beam) : C.beam;
      if (imm.deckSub > 0 && uw > 0) { const Fz = -0.5 * RHO_W * uw * uw * bowB * 0.4 * imm.deckSub; My += C.bowX * 0.6 * Fz; X -= 0.5 * RHO_W * uw * uw * bowB * 0.15 * imm.deckSub; }
      d.myHs = My - foilMy; d.myFoil = foilMy;
      // (a foiler's: the drive at the sails' centre of effort, above her origin (this._ceZ): her foils' drags carry their own
      // moments; flying, there is no hull drag low down)
      const armD = this.hfoils ? this._ceZ : C.boomZ + 2.3;
      My -= sailX * armD;                                                       // drive high, drag low: bow down
      if (this.engine) My += this.engine.My;                                     // thrust low (bow up), the engine's weight
      if (wv) My += this._brkMy || 0;                                            // a breaker's jet
      // (bow lift near planing; a foiler's hulls only as far as they are in the water)
      My += (this.u > 0 ? 1 : 0) * 0.5 * RHO_W * uw * uw * C.beam * C.lwl * 0.004 * sstep(0.35, 0.6, Fn) * (this.hfoils ? clamp(imm.V / Math.max(1e-6, this.hydro.restV), 0, 1) : 1); // bow lift near planing
      // the coupled heave-pitch inertia about the origin the moments are taken about: neither the added mass's centre
      // (A35) nor the boat's own centre of gravity (xG, where her weight acts) is at it
      const xg = this.xG || 0;
      const a11 = disp + M33, a12 = M35 + disp * xg, a22 = this.Iyy + disp * xg * xg + M55, det = a11 * a22 - a12 * a12;
      const zdd = (F * a22 - a12 * My) / det, tdd = (a11 * My - a12 * F) / det;
      this.heaveV += zdd * dt;
      this.heave += this.heaveV * dt;
      this.pitchV += tdd * dt;
      this.pitch = clamp(this.pitch + this.pitchV * dt, -0.6, 0.6);
      // (held at the stop, she does not keep the rate into it: carried on, it pinned the bow under at -34 deg while its
      // buoyancy, twice her weight, threw the hull 2 m into the air)
      if (Math.abs(this.pitch) >= 0.6 && this.pitchV * this.pitch > 0) this.pitchV = 0;
      if (!isFinite(this.heave) || !isFinite(this.heaveV)) { this.heave = 0; this.heaveV = 0; }
      if (!isFinite(this.pitch) || !isFinite(this.pitchV)) { this.pitch = 0; this.pitchV = 0; }
    }

    // ---- diagnostics / instruments ----
    d.X = X; d.Y = Y; d.K = K; d.N = N;
    d.sailX = sailX; d.sailY = sailY; d.sailK = sailK;
    d.RM = RHO_W * G * imm.My - (this.mHull ?? C.massHull) * G * (this.zG ?? C.zG) * sphi - this.crewMass * G * (this.crewY * cphi + C.crewZ * sphi);
    if (!rs) {
      d.rig.backstayLoad = (C.hasBackstay ? 350 + 5200 * ctrl.backstay ** 1.5 : 0) + 0.35 * (d.rig.mainLoad || 0);
      d.rig.bendMM = bend * M0.luff * 18;
      d.rig.sagMM = sag * (this.sailBy.jib ? this.sailBy.jib.luff * 12 * (this.sailBy.jib.sagK ?? 1) : 0);
    }
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
const AK = {}, SK = {};   // (the telltale and slack filters' keys, one string per sail)
export function autoTrim(boat, dt, aoaBias = 0, full = true) {
  trimSails(boat, dt, aoaBias, full);
  if (boat.hfoils && !boat.speedCraft) foilerHeel(boat, dt);
}
// A foiler flying on her leeward foil does not hold her own heel (with her sheets made fast, in 20 kn on a beam reach the
// simulation rolls her between 3 and 29 deg): heeled, her leeward foil rides out and flattens,
// her T-foil on the centreline rises toward the surface, and the heel the sails put in has nothing to stop it short of
// the float going in. Her mainsheet trimmer holds the heel with the traveller and the sheet, playing them on the heel
// and on the roll rate (a crew sees the windward float rise before the heel has come): a proportional-derivative hand
// with a slow integral for the gusts' mean, at the lines' own speed (js/physics.js step). Gains (est.): the car fully
// down by ~3 deg over the target or ~1 deg/s of roll, the sheet dumped with it (est.: the gains a sweep found to hold her
// within ~3 deg in 20 kn on a reach, test/roll.mjs; a softer hand let her roll 15-30 deg and fall off her foils)
function foilerHeel(boat, dt) {
  const C = boat.cls, c = boat.ctrl, d = boat.diag, M = boat.sailBy.main;
  if (!M || !M.trav) return;
  const lee = -Math.sign(d.awaMid ?? 0) || 1, awa = Math.abs(d.awaMid ?? Math.PI);
  const on = 1 - sstep(140 * DEG, 165 * DEG, awa);                     // (running, the heel is not the sails' to hold)
  const e = (boat.phi * lee - (C.targetHeel ?? 5 * DEG)), r = (boat.p || 0) * lee;
  const tt = boat._fh || (boat._fh = { I: 0 });
  tt.I = clamp(tt.I + e * dt * 1.5, -0.25, 0.6);
  const dep = clamp((e / ((C.fhP ?? 3) * DEG) + r / ((C.fhD ?? 1) * DEG) + tt.I / (6 * DEG) * (C.fhI ?? 0.3)) * on, 0, 1);
  boat.diag.heelDepower = dep;
  c.trav = Math.max(c.trav, dep);
  c.main = Math.max(c.main, 0.8 * dep);
}
function trimSails(boat, dt, aoaBias = 0, full = true) {
  if (boat.speedCraft) { if (craftHooks.autoTrim) craftHooks.autoTrim(boat, dt, aoaBias); return; }
  // a foiler's take-off flap (the T-foil's: l'Hydroptère's crew's control of her flight): held for a level trim, the bow
  // a little up (est. 0.5 deg), against the pitch rate
  // (the flap's bite grows with the square of the speed: the crew's hand on it gets lighter as she goes faster, or it
  // would set her pitching)
  // (a hand that leans on it as the pitch is off and as it moves, and settles where it holds her: proportional,
  // rate and a slow integral that does not wind up against the stops)
  if (boat.hfoils) {
    // (to take off the crew lifts her bow, ~3.5 deg, with the flap — "it controls the take-off" — so the foils meet the
    // water at more angle, and levels her as she flies; past ~35 kn she is trimmed a little bow down (-0.7 deg) to keep
    // her low on her foils, her T-foil deep: est.)
    const c = boat.ctrl, g = (12 / Math.max(12, Math.abs(boat.u))) ** 2, e = boat.pitch - (lerp(3.5, 0.5, sstep(8, 16, boat.u)) - 1.2 * sstep(16, 24, boat.u)) * DEG;
    const raw = 0.5 + (boat._flapI || 0) + (e * 4 + (boat.pitchV || 0) * 1.2) * g;
    if ((raw > 0 && raw < 1) || (raw >= 1 && e < 0) || (raw <= 0 && e > 0)) boat._flapI = clamp((boat._flapI || 0) + e * 0.6 * g * dt, -0.5, 0.5);
    c.flap = lerp(c.flap ?? 0.5, clamp(raw, 0, 1), clamp(dt * 3, 0, 1));
  }
  const C = boat.cls, d = boat.diag, c = boat.ctrl;
  // (the dinghy sailor's play on the sheet, below, is taken off before the trim reads the sail and put back after it:
  // the telltale trim would otherwise haul it back in within a few seconds)
  { const t0 = boat._tt; if (t0 && t0.mpa) { c.main = clamp(c.main - t0.mpa, 0, 1); t0.mpa = 0; } }
  const awa = Math.abs(d.awaMid ?? Math.PI);
  const tws = (d.tws ?? 5) / KT;
  // (a crew that reefs as the wind rises: C.autoReef)
  // (not once the player has put in or shaken out a reef by hand: boat.auto.reef false, js/main.js setReef)
  if (full && C.autoReef && boat.auto.reef !== false) { const twaR = Math.abs(wrap(boat.psi - (d.twd ?? 0))); c.reef = steadyReef(boat, dt, tws, (w, cur) => autoReefFor(C, w, twaR, cur)); }
  // overpowered: heeled past the target, or the bow being driven under (a multihull flying a hull has all its pitch
  // stiffness on one bow: the drive trims it down until it trips over the bow; a crew eases before the bow buries)
  // (the heel that overpowers is to leeward, the sails' doing: rolling to windward on a run, the death roll, easing
  // the main (and hauling it again as the boat rolls back) pumps the roll; running, the crew holds the sheets steady)
  // (a foiler's crew watches the roll as much as the heel: flying on one foil she heels fast, and the main is eased as the
  // heel starts to come, not when it has: 0.6 s of lead)
  const lee = -Math.sign(d.awaMid ?? 0) || 1, heelLee = (boat.phi + (boat.hfoils ? (C.heelLead ?? 0.6) * (boat.p || 0) : 0)) * lee * (1 - sstep(140 * DEG, 170 * DEG, awa));
  // (a foiler is overpowered by her pitch long before her heel: the drive, high up, pitches her bow down against the
  // T-foil's elevator, and the crew eases as the elevator nears the end of its flap (or boils), and when her lifting
  // foils start to cavitate)
  let foilOver = 0;
  if (boat.hfoils && d.hfoils) {
    let cav = 0; for (const f of d.hfoils) if (f.imm > 0.05) cav = Math.max(cav, f.cav || 0);
    // (only the elevator's lifting end counts, and only flying: the flap at its other stop is the crew failing to lift
    // the bow for the take-off, at a speed where the elevator has no bite, and easing then would only keep her down)
    const flying = (d.displaced || 0) < 0.3 * boat.mass;
    foilOver = Math.max(flying ? clamp(((c.flap ?? 0.5) - 0.75) / 0.2, 0, 1.5) : 0, clamp((cav - 0.2) / 0.4, 0, 1.5));
  }
  const overP = clamp(Math.max((heelLee - C.targetHeel) / ((C.overHeel ?? 10) * DEG), (-(boat.pitch || 0) - 6 * DEG) / (6 * DEG), foilOver), 0, 1.5);
  const k = clamp(dt * 1.5, 0, 1);
  const upwind = 1 - sstep(55 * DEG, 95 * DEG, awa);
  // A crew holds the boat near her design heel, not 10 degrees past it: while she heels past her target they go on
  // depowering, step by step, until she comes back to within ~2.5 degrees of it (and give it back as she comes
  // under it; the band between, where they hold what they have, keeps the trim from hunting): the depower
  // below is the heel's excess now plus what has built up over the last ~10 s. Without the build-up the trim
  // settled where the ease balanced the heel, 8-12 degrees past the target in 20 kn (a J/24 at 28, a Catalina 30 at 31)
  // (upwind and close reaching, as a crew trims to her heel: reaching under a kite in a blow the sheet is eased by
  // the heel itself, above, and an ease built up over 10 s left a kite too soft to break when she broached)
  const tb = boat._tt || (boat._tt = { over: 0 });
  // (the time since she last tacked or gybed: the apparent wind changed sides)
  if (lee !== tb.lee0) { tb.lee0 = lee; tb.since = 0; } else tb.since = (tb.since ?? 99) + dt;
  { const e = (heelLee - C.targetHeel) / ((C.overHeel ?? 10) * DEG), on = sstep(75 * DEG, 55 * DEG, awa) * (1 - clamp(boat.genDeploy || 0, 0, 1));
    // (not a dinghy's: her crew keeps her flat by hiking, the vang and the cunningham, and its main eased further
    // stalls: with a build-up of even a quarter a Laser-sized dinghy in 25 kn stopped dead, 0.1-2.5 kn from 4-5.6;
    // nor a foiler's, eased by her pitch and foils above)
    const depMax = C.depowerMax ?? (C.group === 'dinghy' || C.canCapsize || boat.hfoils ? 0 : 1);
    tb.dep = clamp((tb.dep ?? 0) + dt / 10 * on * (e > 0.25 ? e - 0.25 : e < -0.05 ? clamp(e + 0.05, -1, 0) : 0) - (on < 0.5 ? dt / 8 : 0), 0, depMax); }
  const over = clamp(overP + tb.dep, 0, 2);
  // the main's twist as the crew reads it: its sections' angles to leeward of the boom. (The cloth's own measure is
  // signed by the camber's side: a head backed by the headsail or turned inside out read as twisted to windward, and
  // the rules below took the vang off and eased the sheet for more twist, which backed it further: a 40 m main went
  // round that loop until it flogged)
  const twMain = (i) => { const shp = d.shape.main, st = d.strips.main; return shp && st && shp[i] ? wrap(shp[i].ang - (st.baseAngle ?? boat.booms.main.a)) * lee : null; };
  // the main backed: its sections meeting the wind at a negative angle (to windward) while the headsail draws; the
  // crew sees the luff bubbling behind the jib's leech
  { const st = d.strips.main, jst = d.strips.jib;
    let am = 0; if (st) for (let i = 0; i < 3; i++) am += (st[i].alpha || 0) * lee * STRIP_W[i];
    const jibOn = !!(jst && boat.sailBy.jib && boat.genDeploy < 0.5 && (jst[1].cl || 0) > 0.4);
    tb.bw = lerp(tb.bw ?? 0, jibOn && upwind > 0.5 ? clamp(-am / (4 * DEG), 0, 1) : 0, clamp(dt * 1.5, 0, 1)); }
  const power = clamp((tws - 7) / 11, 0, 1);            // 0 = light: full shape, 1 = heavy: flat
  const flat = clamp(power + over * 0.6, 0, 1);
  const clothMain = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('main');
  // (with the gennaker up the boat is reaching, however close the apparent wind comes: a fast boat under a kite
  // sails at 45-60 degrees apparent. The cloth main is set for reaching then, deep and eased)
  const shapeUp = clothMain ? upwind * (1 - clamp(boat.genDeploy, 0, 1)) : upwind;
  if (full) {
    // (a cloth main: the outhaul lets the clew forward along the boom; off the wind it goes all the way off for
    // the deepest foot, as crews do)
    c.outhaul = lerp(c.outhaul, lerp(clothMain ? 0 : 0.25, lerp(0.35, 1, flat), shapeUp), k);
    c.cunn = lerp(c.cunn, lerp(0, flat, shapeUp), k);
    if (C.hasBackstay) c.backstay = lerp(c.backstay, lerp(0.05, lerp(0.15, 1, flat), shapeUp), k);
    const twTop = clothMain && boat.sailBy.main.trav && d.shape.main ? twMain(2) : null;
    if (clothMain && shapeUp > 0.5 && Number.isFinite(twTop)) {
      // a cloth main on a traveller upwind: the vang (with the sheet) sets the leech twist to the sailmaker's target,
      // about 11 degrees at the top batten, more when overpowered to spill wind from the head (as crews set it by
      // eye: the speed barely changes with it, the look of the sail does). (The una-rig dinghy's vang is its leech
      // and mast-bend control in one: it keeps its rule, which is also its fastest.)
      // (backed, the head's twist says nothing: the vang holds)
      // (overpowered, the leech opens only a little more: the traveller and the reefs depower, not a head twisted off)
      c.vang = clamp(c.vang + clamp(twTop - (11 + 3 * over) * DEG, -0.1, 0.1) * k * 1.5 * (1 - clamp(2 * tb.bw, 0, 1)), 0, 1);
    } else {
      // (off the wind the vang holds the leech: a cloth main twists off as far as its vang lets it, so it goes on
      // harder than the strip model's twist rule needed)
      // (overpowered off the wind, where the sheet cannot ease the main any further than the shrouds, the vang comes
      // off: the leech twists open and the head spills its wind, the one depower left on a reach)
      c.vang = lerp(c.vang, shapeUp > 0.5 ? (C.id === 'dinghy' || C.vangSheeting ? lerp(0.15, 0.95, flat) : lerp(0.05, 0.7, flat)) : clothMain ? lerp(0.7, 0.85, power) * (1 - clamp((boat._tt ? boat._tt.over : over), 0, 1)) : lerp(0.35, 0.55, power), k);
    }
    const clothJib = boat.sailBy.jib && boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('jib') && boat.genDeploy < 0.5;
    if (clothJib) {
      // a cloth jib: the car goes where the luff breaks evenly, top and bottom (the telltales): forward while the
      // foot meets the wind at a larger angle than the head (the leech is open, the foot pulled flat), aft while
      // the head meets it at more; a little further aft when overpowered, to twist the head off
      const st = d.strips.jib, sd = st.side || Math.sign(boat.side.jib) || 1;
      if (st[0].state && st[2].state) {
        const diff = clamp(((st[0].alpha || 0) - (st[2].alpha || 0)) * sd, -0.3, 0.3) + over * 0.05;
        // (and aft while its leech backs the main: the car aft opens the leech, the slot with it)
        c.jibLead = clamp(c.jibLead - diff * k * 0.6 + tb.bw * k * 0.25, 0, 1);
      }
    } else c.jibLead = lerp(c.jibLead, lerp(0.4, 0.85, flat) * upwind + 0.55 * (1 - upwind), k);
    c.jibHalyard = lerp(c.jibHalyard, lerp(0.3, 0.9, flat), k);
    // (tack line: down tight reaching, so the luff stays straight and the kite keeps its entry; eased deep, so the
    // luff can rotate out to windward. A cloth kite shows the tight-reaching tack best right down)
    const clothSpin = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('gennaker');
    c.tackLine = lerp(c.tackLine, lerp(clothSpin ? 0 : 0.15, 0.7, sstep(110 * DEG, 150 * DEG, awa)), k);
    if (C.hasBoard) c.board = lerp(c.board, lerp(0.3, 1, upwind), k);
  }
  // slow and pinching (mid-tack or stalled head to wind): ease the main so the bow can fall off
  const pinched = awa < 32 * DEG && boat.u < 1.3;
  // tacking: keep the old jib sheet made fast until the bow is through the wind (a long-keeler needs the
  // backed jib to push the bow round), then let it fly; the new sheet is tailed in below
  let letFly = false;
  if (boat.sailBy.jib && boat.genDeploy < 0.5 && !boat.backedByLazy) {
    // (the side the working sheet is on: a cloth jib's sheets swap roles only once its clew is well across, js/sail/
    // rigsim.js, and until then the sheet on the old side is the one flying. Read off the clew alone, the let-fly ended as
    // the clew passed the centreline, the crew took the old sheet in again and eased the new one, and the sail came
    // across onto a fully eased sheet)
    const jr = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns('jib') ? boat.sailSys.cloth('jib') : null;
    const js = (jr && jr.side) || Math.sign(boat.side.jib) || 1, wantSide = -Math.sign(d.awaMid ?? 0) || js;
    const hold = (C.id === 'blackwatch' || C.keel.long ? 20 : 7) * DEG;
    if (wantSide !== js && awa > hold && awa < 160 * DEG) letFly = true;
  }
  if (!boat.backedByLazy) c.lazy = 1;
  if (boat.locks) for (const k in boat.locks) boat.locks[k] = true;   // automatic mode keeps every line cleated
  const sh = d.shape;
  const tt = boat._tt || (boat._tt = { over: 0 });
  // (running, a crew trims to the wind's mean, not to the swings a rolling boat puts into the apparent wind and the
  // heel: a trim that followed them within a roll period, ~4 s, pumped the roll: heel and telltales over ~3 s there)
  const runT = C.overT ?? lerp(0.5, 3, sstep(120 * DEG, 160 * DEG, awa));
  tt.over = lerp(tt.over, over, clamp(dt / runT, 0, 1));
  // (and upwind too the sheets go to the wind's trend over a second or two, not to each roll: the masthead's own
  // motion swings the apparent wind +-10 degrees at the roll's period in a seaway, and a trim that followed it within a
  // third of a second pumped the heeling moment in step with the roll, and the helm with it. The telltales a crew
  // trims by show it too, but no hand on a sheet follows a 3 s cycle; the loss in a steady wind is nil)
  tt.awa = lerp(tt.awa ?? awa, awa, clamp(dt / lerp(1.5, 3, sstep(120 * DEG, 160 * DEG, awa)), 0, 1));
  const awaT = Math.abs(awa - tt.awa) > 25 * DEG ? (tt.awa = awa) : tt.awa;   // (a tack or a gybe: at once)
  for (const s of C.sails) {
    if (s.kind === 'spin' && boat.genDeploy < 0.5) continue;
    if (s.kind === 'loose' && boat.genDeploy >= 0.5) continue;
    if (s.kind === 'loose' && s.key !== 'jib' && boat.sailBy.jib) continue;   // (the outer jibs go on the jib's sheets)
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
    const overT = over > tt.over + 0.5 ? over : tt.over;   // (the heel's trend; a knockdown still eases at once)
    if (s.key === 'main') aT = (15 + aoaBias) * DEG - overT * 7 * DEG + (aInd ?? 0.055 * boat._clHead);
    else if (s.kind === 'spin') aT = (21 + aoaBias) * DEG + (aInd ?? 0);
    else aT = (13 + aoaBias) * DEG - overT * 3 * DEG + (aInd ?? 0);
    const want = awaT - aT - midTw;
    // A cloth sail goes where the wind and its sheet put it, not where the sheet's length says, and the lattice
    // gives each strip the angle it really meets: the crew trims by the telltales, easing while the sail
    // meets the wind at more than the angle it wants, hauling in while less (attached strips only: a stalled
    // strip's angle says nothing about the trim)
    const owned = boat.sailSys && boat.sailSys.owns && boat.sailSys.owns(s.key);
    // (the old sheet let fly, the new one is tailed in on the other winch while it is still slack, to a little
    // short of its mark for the wind's angle: it takes the clew across and the sail fills on the new tack trimmed, not
    // flogging at the end of a fully eased sheet to be ground in under load, which on a big boat took 20-25 s)
    if (s.kind === 'loose' && letFly && s.key === 'jib') c.lazy = clamp((Math.max(0, want + Math.max(0, 35 * DEG - awaT)) - s.min) / (s.max - s.min) + 0.1, 0.1, 1);
    if (owned && !(s.kind === 'loose' && (letFly || boat.backedByLazy))) {
      const key = s.kind === 'boom' ? s.key : 'jib', st = d.strips[s.key];
      // (overpowered, a cloth sail is let out further than the strip model's rule: a sail at a small angle still
      // pulls hard off its camber, so the crew eases it toward luffing)
      const aim = aT - (aInd ?? 0) - over * (s.key === 'main' ? 7 : 3) * DEG;
      // (the lattice's angles are signed across the boat: to leeward positive, a backed or luffing strip negative)
      // (the sign is the leeward side, where the wind should push the sail: not the side its boom or clew is on
      // (a traveller pulled to windward puts the boom past the centreline while the sail still draws), nor the
      // side its camber is on (a backwinded main's luff turns inside out, and read by its camber it would be
      // hauled in harder); running, by the lee, the side the sail is on: for a main the side its boom is out on,
      // not its camber's (on a run in a seaway a main's camber can blow through to windward with the boom still
      // out to leeward: read by its camber it was hauled in, block to block, and a sportboat in the race test sailed
      // the rest of the run at 2-4 kn with her main sheeted flat and backed, and did not finish)
      const boomSide = s.kind === 'boom' && boat.booms[s.key] && Math.abs(boat.booms[s.key].a) > 5 * DEG ? Math.sign(boat.booms[s.key].a) : 0;
      const sd = (awa < 150 * DEG ? -Math.sign(d.awaMid) : 0) || boomSide || st.side || Math.sign(st.baseAngle || (s.kind === 'boom' ? boat.booms[s.key].a : boat.side.jib)) || 1;
      let a = 0; for (let i = 0; i < 3; i++) a += clamp((st[i].alpha || 0) * sd, -0.3, 0.6) * STRIP_W[i];
      const ak = AK[key] || (AK[key] = 'a_' + key); tt[ak] = lerp(tt[ak] ?? a, a, clamp(dt / (C.canCapsize && s.kind === 'boom' ? Math.max(1, runT - 0.4) : runT - 0.4), 0, 1)); a = tt[ak];
      // (upwind, a main on a traveller with a vang is trimmed by the car and its leech below: travUp)
      // (not when she is stopped head to wind, in irons or mid-tack: then the main is eased to let the bow fall off,
      // below, as before: held hard in on its sheet, an AI boat that stalled in a tack stayed in irons)
      // (nor with her boom over on the windward side, the main aback: read by its telltales the car was hauled further
      // to windward, which held it aback; an AI sportboat bearing away round the windward mark in the race test (seed 2)
      // lay there at 1-2 kn with full helm for ten minutes and did not finish. The strip rule below puts the car by the
      // wind's angle, to leeward, and the boom swings across)
      const travUp = s.key === 'main' && !!s.trav && !!s.track && shapeUp > 0.5 && s.vang !== 'none' && !!sh.main && !(awa < 32 * DEG && boat.u < 1.3) && !(boat.booms.main && boat.booms.main.a * sd > 8 * DEG)
        // (nor in the first seconds after a tack: the new side's telltales read the boom still crossing, and the car,
        // hauled up by them, pulled the boom over to the new windward side (seed 2 again, a sportboat tacking at 2.5 kn),
        // where it stayed. The strip rule puts the car by the wind's angle until the main has filled on its new side)
        && tb.since > 6;
      if (s.key === 'main' && s.trav && !travUp) {
        const sheetEase = clamp(0.06 + 0.25 * flat * upwind + (1 - upwind) * 0.3, 0, 1);
        c.trav = lerp(c.trav, clamp((want - sheetEase * (s.max - s.trav[1]) - s.trav[0]) / (s.trav[1] - s.trav[0]), 0, 1), k * 2);
      }
      // overpowered (heeled past the target): whatever the telltales say, the crew eases, the main most, in
      // proportion to the heel smoothed over half a second (an ease that integrated the heel would pump the boat
      // in a roll cycle)
      const ease0 = tt[key] ?? 0;
      // (a kite is eased hardest: its sheet is the crew's main depower reaching, and it drives the bow down most)
      // (a main on a traveller track: its sheet lets the boom out faster than linearly, js/boom.js, so half the ease)
      // (C.overEase: a class whose crew eases harder overpowered: a foiler flying on one foil, where the heel the sails
      // put in is the one thing that can tip her over)
      tt[key] = clamp(tt.over, 0, 1.5) * (s.key === 'main' ? (s.track && s.trav ? 0.12 : 0.25) : s.kind === 'spin' ? 0.3 : 0.1) * (C.overEase ?? 1);
      // (pinched, the main is eased to let the bow fall off: for a cloth main only when really stopped head to
      // wind, since in light air a slow boat sails close-hauled at these angles and an eased main just stops it)
      const pinchedC = awa < 28 * DEG && boat.u < 0.7;
      // (and while overpowered it does not haul in, whatever the telltales say)
      // (a kite, overpowered, is not hauled in again whatever its luff says: reaching in a blow its pull is what trips
      // the boat; a main or jib is, or it flogs and the boat stops, still heeled by the flogging)
      // After a tack the new headsail sheet is tailed in to its mark for the wind's angle as the sail comes across, at
      // the winch's pace (js/crew.js), and only then played by the telltales: a headsail flogging out of a tack reads
      // anything on its telltales, and played by them from fully eased a J-class genoa stayed out at 40-45 degrees
      // for half a minute, the boat stuck at 4 kn on a close reach
      // (to the mark for a close reach at least: just through the wind and slow, she bears away to build speed before
      // she points, and a sheet tailed to the mark for the wind just off the bow pinned the jib flat, stopped her and
      // set her going astern)
      if (s.kind === 'loose' && tb.since < 15 && awa < 80 * DEG) {
        const mark = clamp((Math.max(0, want + Math.max(0, 35 * DEG - awaT)) - s.min) / (s.max - s.min), 0, 1);
        if ((c.jib ?? 0.3) > mark + 0.05) { c.jib = Math.max(mark, (c.jib ?? 0.3) - 0.6 * dt); tt[ak] = aim; continue; }
        // (nor hauled in past it by telltales that read a luff only because she is still nearly head to wind)
        if ((c.jib ?? 0.3) < mark - 0.05) { c.jib = Math.min(mark, (c.jib ?? 0.3) + 0.6 * dt); tt[ak] = aim; continue; }
      }
      // (a dinghy's boom swinging inside its sheet, the sheet slack: the sail meets the wind at more than it will once
      // the boom has gone out to the sheet, by the angle still to go. Trimmed by the angle it meets now, the sheet was
      // eased as the boom swung in and hauled as it swung out, a Sunfish's every 2 s: the sheet never loaded, the boom
      // snatching it at 10-60x its mean load. By the angle at the sheet, the sheet holds and the boom comes to rest on it)
      let aS = a;
      // (close-hauled: off the wind a boom inside its sheet is a sail eased to its angle, and read so a Sunfish lost 5% at 90 deg)
      if (s.kind === 'boom' && C.canCapsize && boat.booms[s.key] && awa < 50 * DEG) aS = a - Math.max(0, boat.boomLimit(s) - boat.booms[s.key].a * sd);
      let dA = clamp(aS - aim, -0.3, 0.3); if (dA < 0 && s.kind === 'spin') dA *= 1 - clamp(tt.over, 0, 1);
      // (and the main out of a tack is not sheeted past the angle the wind's own angle asks for, until she has her
      // speed: the apparent wind is wide while she is slow, and sheeted for full speed by its car and leech a 40 m main
      // stood stalled at 30-40 degrees for half a minute while she sat at 4 kn)
      const postM = s.key === 'main' && s.track && tb.since < 12 && awa < 80 * DEG ? easeForBoomAngle(C, s, Math.max(0, want), c.trav) : 0;
      if (s.key === 'main' && s.track && shapeUp > 0.5 && sh.main) {
        // (the top batten's twist breathes with the sheet it answers to: the crew goes by its trend over a couple of
        // seconds, or sheet and twist chase each other round a cycle)
        tt.twTop = lerp(tt.twTop ?? twMain(2), clamp(twMain(2), -10 * DEG, 30 * DEG), clamp(dt * 0.5, 0, 1));
        const e = (11 + 8 * over) * DEG - tt.twTop;
        if (travUp) {
          // Upwind with a traveller, as a crew trims a main: the car carries its angle to the wind (by the telltales,
          // and down to leeward as she heels past her target: the aim above), the sheet its leech: in until the top
          // batten stands at the twist the sailmaker wants, ~11 degrees, eased past that only as the head must spill
          // wind when she is overpowered. With the car hard down and still meeting the wind at too much, the sheet
          // lets the boom out further; past that she reefs (C.autoReef). (Before, the car went where the strip
          // model's sheet rule put it, mostly hard up, and the sheet carried the angle: a 40 m main was eased by the
          // telltales until its head stood at 30-45 degrees of twist, luffed and was backed by the jib)
          const range = s.trav[1] - s.trav[0], t0 = c.trav;
          c.trav = clamp(c.trav + dA / range * k * 0.4, 0, 1);
          const spill = dA - (c.trav - t0) * range / (k * 0.4 || 1);
          // (backed by the jib, the twist reads nothing: the leech holds)
          let leech = clamp(e - 5 * over * DEG, -0.3, 0.3) * k * 0.3 * (1 - clamp(2 * tt.bw, 0, 1));
          // (with the car hard down and still overpowered, the sheet is the angle now: the vang holds the leech)
          // (and so it is with the car down and the main still meeting the wind at too much, overpowered or not: slow
          // out of a tack, the apparent wind wide, a 40 m main stood stalled at 30-40 degrees with its sheet held in by
          // the twist rule, and she sat at 4 kn on a close reach)
          if (t0 >= 0.999 && (tt.over > 0.3 || spill > 0)) leech = Math.max(0, leech);
          c.main = clamp(Math.max(c.main + leech + ((t0 >= 0.999 && spill > 0) || (t0 <= 0.001 && spill < 0) ? spill / (s.max - s.min) * k * 0.4 : 0), Math.min(postM, c.main + 0.5 * dt)), 0, 1);
          continue;
        }
        if (s.vang === 'none' && s.trav) {
          // No vang (the Hobie's fully battened main): upwind the sheet is its leech, and a vangless main eased flogs
          // with its boom lifted. So the sheet stays hard, eased only as far as the head needs to twist off, and the
          // traveller carries the angle by the telltales (the boom sits over the car, block to block): out to leeward
          // while the sail meets the wind at more than it wants and when overpowered, in while less, never past the
          // centreline to windward (a car there drags a vangless boom across)
          c.trav = clamp(c.trav + (dA + 0.3 * clamp(tt.over, 0, 1)) * k * 1.5, 0.5, 1);
          c.main = clamp(c.main + (clamp(2 * e, -0.3, 0.3) * 0.15 - 0.008) * k + (tt[key] - ease0), 0, 1);
          continue;
        }
        // where the sheet pulls nearly straight down on the leech (a Laser sheeted to its horse off the transom, any
        // main sheeted hard over its car with the vang off), the sailor eases a little to let the head twist off;
        // closing it is the vang's
        // (not while the jib backs it: eased then, the main only backs further)
        if ((s.track.horse || c.vang < 0.05) && e > 0) dA += clamp(2 * e, 0, 0.3) * (1 - clamp(2 * tt.bw, 0, 1));
      }
      // a flogging sail (let fly for a luff, or eased past where it fills) swings its boom about well inside where
      // the sheet would hold it, and its telltales read anything: the crew takes in the slack until the sail fills
      // and leans on the sheet again (by the telltales alone an eased J/70 main flogged at 60 deg on a close reach
      // for minutes, and with the jib alone pulling the bow down she could not come up to close-hauled)
      // (a headsail's clew likewise, inside where its working sheet would let it go: after a tack the new sheet
      // comes in from fully eased, and trimmed by the telltales alone a J/70 left her tacks at 2-3 kn with the jib
      // still flogging) (a main to a beam reach, a headsail upwind and close reaching: further off, a sail blanketed
      // or twisted off can float inside its sheet and still draw)
      let slackIn = 0;
      const sk = SK[key] || (SK[key] = 'sl_' + key), jr = s.kind === 'loose' && boat.sailSys.cloth(s.key);
      if (awa < (s.kind === 'boom' ? 110 : 80) * DEG && ((s.kind === 'boom' && boat.booms[s.key]) || (jr && jr.side === sd && jr.a !== undefined))) {
        const out = s.kind === 'boom' ? boat.boomLimit(s) - boat.booms[s.key].a * sd : lerp(s.min, s.max, clamp(boat.lines.jib, 0, 1)) - jr.a * sd;
        tt[sk] = lerp(tt[sk] ?? 0, out, clamp(dt / 1.5, 0, 1));
        slackIn = clamp((tt[sk] - 8 * DEG) / (20 * DEG), 0, 1) * (s.kind === 'boom' ? 0.3 : 0.6) * dt;
        // (never past the sheet that sets it to the apparent wind: an eased main while she bears away is no slack)
        const wA = Math.max(0, want), floor = s.kind === 'boom' ? (s.track ? easeForBoomAngle(C, s, wA, c.trav) : clamp((wA - s.min) / (s.max - s.min), 0, 1)) : clamp((wA - s.min) / (s.max - s.min), 0, 1);
        slackIn = clamp(Math.min(slackIn, (c[key] ?? 0.3) - floor), 0, 1);
      } else tt[sk] = 0;
      c[key] = clamp(Math.max((c[key] ?? 0.3) + dA / (s.max - s.min) * k * 0.4 + (tt[key] - ease0) - slackIn, Math.min(postM, (c[key] ?? 0.3) + 0.5 * dt)), pinchedC && s.key === 'main' && s.vang !== 'none' ? 0.35 : 0, 1);
      continue;
    }
    if (s.key === 'main' && s.trav) {
      // traveler carries the angle upwind, sheet sets leech tension (twist); off the wind, traveler down
      const sheetEase = clamp(0.06 + 0.25 * flat * upwind + (1 - upwind) * 0.3, 0, 1);
      const easeAngle = sheetEase * (s.max - s.trav[1]);
      const tr = clamp((want - easeAngle - s.trav[0]) / (s.trav[1] - s.trav[0]), 0, 1);
      c.trav = lerp(c.trav, tr, k * 2);
      const travAng = lerp(s.trav[0], s.trav[1], c.trav);
      // (the sheet that lets the boom out to the angle wanted, with the car where it is: js/boom.js geometry)
      const eMain = s.track ? easeForBoomAngle(C, s, want, c.trav) : (want - travAng) / (s.max - s.trav[1]);
      c.main = lerp(c.main, clamp(eMain, pinched ? 0.35 : 0, 1), k * 2);
    } else {
      const key = s.kind === 'boom' ? s.key : 'jib';
      if (key === 'jib' && s.kind === 'loose' && letFly) { c.jib = 1; continue; }
      if (key === 'jib' && s.kind === 'loose' && boat.backedByLazy) continue; // hove-to on purpose: leave it
      const fr = s.track ? easeForBoomAngle(C, s, want, c.trav) : clamp((want - s.min) / (s.max - s.min), 0, 1);
      c[key] = lerp(c[key] ?? 0.3, s.kind === 'loose' ? Math.sqrt(fr) : fr, k * 2);
    }
  }
  // A main left aback upwind (its boom over on the windward side: a gybe that did not take the main across, then a
  // luff up to a close reach) is hauled in until the boom comes over the centreline and fills on the right side: eased
  // there, read by its twist, it stayed aback, its pull holding the bow off the wind against the full helm, and a
  // sportboat in the race test (seed 0) could not come up from 60 degrees to close-hauled for three minutes
  if (boat.sailBy.main && boat.booms.main && !boat.speedCraft && awa < 80 * DEG && boat.booms.main.a * lee > 8 * DEG && boat.u > 0.5) {
    c.main = Math.max(0, c.main - dt * 0.6);
    if (boat.sailBy.main.trav && c.trav !== undefined) c.trav = Math.min(1, c.trav + dt * 0.6);
  }
  // Luffing into a tack (the helm's intent, boat.tackIntent, while she is still on the old tack): the main comes in and
  // its car up, whatever the heel asked of them a moment before, as a trimmer does when the helm goes over. Its pull aft
  // is what turns her up into the wind; eased for the heel, the jib's pull forward held a TP52 in 25 kn on a close
  // reach with the helm hard over and her rudder stalled, and she never got through the wind
  // (the intent lasts a quarter of a second unless the helm says it again: a helm that lets go leaves no main held in)
  if (boat.tackIntent > 0 && (boat.tackIntent -= dt) > -1 && boat.sailBy.main && awa < 70 * DEG && !boat.speedCraft) {
    c.main = Math.max(0, c.main - dt * 0.6);
    if (boat.sailBy.main.trav && c.trav !== undefined) c.trav = Math.max(0, c.trav - dt * 0.6);
  }
  // An unstayed mast (a Laser's, an Optimist's) has only the leech to hold its head: the leech tension, sheet and vang
  // together, is what bends it, ~500 N of it took a Laser's spar to its section's strength upwind and reaching in
  // 25-30 kn (test/dismast.mjs). Her sailor watches the mast bend and plays the main in the gusts: past about half the
  // spar's strength the vang comes off (fast) and the sheet goes out a little (a tenth), and both come back as it
  // straightens. (It moves the failure, not the whole of it: easing takes the leech load off the top section, but in
  // 25-30 kn the bottom section still parts under the rig's whole heeling moment, reaching within 3 s: the spar's own
  // model, not the trim)
  // (By the bend the crew sees, js/damage.js's load on the spar; no damage model, no bend to see: the polars' bake)
  if (full && boat.dmg && boat.dmg.R && boat.dmg.R.stayed === false && boat.sailBy.main) {
    tb.mR = lerp(tb.mR ?? 0, boat.dmg.maxR || 0, clamp(dt / 0.25, 0, 1));
    const ex = tb.mR - 0.55, cap = 0.1;
    if (ex > 0) {
      tb.vE = clamp((tb.vE ?? 0) + ex * dt * 8, 0, 1);
      tb.mE = clamp((tb.mE ?? 0) + ex * dt * 2, 0, cap);
    } else {
      const dk = 20;   // (and come back over ~20 s once it has straightened: it is still blowing)
      tb.vE = Math.max(0, (tb.vE ?? 0) - dt / dk);
      tb.mE = Math.max(0, (tb.mE ?? 0) - dt / dk * cap);
    }
    // (the sheet out by at most a tenth more than she trims it to, the main still drawing: let run until it flogs, she
    // stops, rolls and the spar whips (a Laser eased that far in 30 kn broke her mast lying stopped))
    c.vang = Math.min(c.vang, 1 - tb.vE);
    c.main = clamp(c.main - (tb.mEa ?? 0) + tb.mE, 0, 1); tb.mEa = tb.mE;
  }
  // A dinghy sailor plays the mainsheet all the time: as a gust heels her past her target (and as she starts to roll
  // towards it: the roll rate) the sheet goes out within ~0.3 s, the boom lifting and the leech opening, while she hikes,
  // and it comes back in over a second or so as she comes upright. (Without it the depower above, the heel smoothed and
  // traded against the telltales, left a Laser or a Sunfish sheeted hard in through the gusts in 18 kn: heeled 28-45 deg
  // with the boom at 10 deg, the sail's heeling moment 1.4-1.6 kN m against ~1 kN m of righting, the spar overloaded and
  // the Sunfish over in 25 kn)
  if (C.canCapsize && !boat.hfoils && boat.sailBy.main && !boat.capsized) {
    const ls = -Math.sign(d.awaMid ?? 0) || 1, h = boat.phi * ls, rate = (boat.p || 0) * ls;
    const on = 1 - sstep(110 * DEG, 150 * DEG, awa);
    // (only once she is well past her target, 5 deg, and has been heeled 2 deg past it over the last ~2 s: a roll of a boat
    // sailing flat is not a gust, and the sheet eased on her rolling cost a Laser 7-9% close-hauled in 12 kn)
    tb.hS = lerp(tb.hS ?? h, h, clamp(dt / 2, 0, 1)); tb.age = (tb.age ?? 0) + dt;
    // (nor in her first seconds, the heel a start from rest throws her to: eased then, a Laser's cloth trim settled in a
    // slower state in 12 kn, 4.49 kn close-hauled against 4.90)
    const want = tb.age > 8 && h > C.targetHeel + 5 * DEG && tb.hS > C.targetHeel + 2 * DEG ? clamp((h - C.targetHeel - 5 * DEG) / (10 * DEG) + rate * 0.35 / (10 * DEG), 0, 1) * 0.55 * on : 0;
    tb.mp = lerp(tb.mp ?? 0, want, clamp(dt / (want > (tb.mp ?? 0) ? 0.3 : 1.0), 0, 1));
    // (nothing touched while there is no play: the trim's own value, clamped or not, stays as it was)
    if (tb.mp > 1e-4) { const m0 = c.main; c.main = clamp(c.main + tb.mp, 0, 1); tb.mpa = c.main - m0; } else tb.mpa = 0;
  }
  // running, the boom is never let out past square: a main eased forward of abeam drives the rig to windward, the start
  // of the death roll (a Laser at 160 deg in a 16 kn puff, the telltales asking for more ease, had her boom at 100 deg
  // and rolled in over her windward side in two seconds). The crew stops the sheet where the boom came to 85 deg and
  // gives it back only as the boom comes in again
  const bm = boat.booms && boat.booms.main;
  if (full && bm && boat.sailBy.main && boat.sailBy.main.boom !== false && awa > 110 * DEG) {
    const tbm = boat._tt, a = Math.abs(bm.a);
    if (a > 85 * DEG) tbm.mCap = Math.min(tbm.mCap ?? c.main, c.main) - dt * 0.3 * clamp((a - 85 * DEG) / (5 * DEG), 0, 1);
    else if (tbm.mCap !== undefined) tbm.mCap += dt * (a < 80 * DEG ? 0.03 : 0);
    if (tbm.mCap !== undefined && c.main > tbm.mCap) { const cut = c.main - Math.max(0, tbm.mCap); c.main -= cut; tbm.mpa = Math.max(0, (tbm.mpa || 0) - cut); }
  } else if (boat._tt && boat._tt.mCap !== undefined) {
    // (given back over a couple of seconds as she comes up from the run, not at once: dropped in a step, the trim's
    // own ease came back in one frame and the boom jumped out)
    const tbm = boat._tt; tbm.mCap += dt * 0.4;
    if (c.main > tbm.mCap) { const cut = c.main - Math.max(0, tbm.mCap); c.main -= cut; tbm.mpa = Math.max(0, (tbm.mpa || 0) - cut); }
    if (tbm.mCap >= 1) tbm.mCap = undefined;
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

// The VPP's boat at the start of a run: slowly under way with its sails set. In a breeze (from 16 kn), reaching and
// running, it is already moving with its sheets eased, as a crew bears away onto the course and trims in: from a standing start with the
// sheets in, a light multihull in 25 kn is driven at half a g and its bows are pressed under before any crew could
// ease, it trips over them, and the polar showed nothing there. (In light air the old start is kept: an eased start
// leaves some rigs in a slower trim, e.g. the Blackwatch's strip main luffing at 44 degrees in 6 kn.)
export function vppStart(b, twsMS, twaDeg, gen) {
  b.reset(0, 0, twaDeg * DEG);
  // (close-hauled the old start stands: a boat started with its sheets eased head to wind in a breeze just stops)
  const breeze = twsMS > 16 * KT && twaDeg >= 70;
  b.u = breeze ? Math.min(0.4 * twsMS, 5) : 1.5; for (const k in b.booms) b.booms[k].a = 0.3; b.side.jib = 1; b.side.gennaker = 1;
  if (breeze) for (const k of ['main', 'jib', 'stay']) { b.ctrl[k] = 1; b.lines[k] = 1; }
  // (a main with no vang, the Hobie's, starts sheeted in over its car: left at the default ease its boom lifts, the
  // leech opens and it flogs, and in a blow the boat never gathers way)
  else if (b.sailBy.main.vang === 'none') { b.ctrl.main = b.lines.main = 0.05; b.ctrl.trav = 0.6; }
  b.ctrl.gen = gen; b.genDeploy = gen ? 1 : 0; b.genFill = gen ? 1 : 0;
  // (a crew that reefs in a breeze (C.autoReef) sets out reefed, as from the dock: the VPP measures the reefed boat)
  if (b.cls.autoReef) { b.ctrl.reef = autoReefFor(b.cls, twsMS / KT, twaDeg * DEG); b.reefPos = b.ctrl.reef; }
  return b;
}

// For cloth sails the polar is the one baked offline from the cloth model itself (js/sail/surrogate.js); what is
// simulated here, at 50 Hz, is the strip model (the fallback sails, level L2)
export function solvePolarAngle(C, twsMS, twaDeg, opts = {}) {
  if (C.speed) return craftHooks.polarAngle ? craftHooks.polarAngle(C, twsMS, twaDeg, opts) : { twa: twaDeg, bsp: 0, vmg: 0 };
  const model = opts.sailModel ?? sailHooks.defaultModel ?? 'strip';
  if (model !== 'strip' && sailHooks.polarAngle) { const r = sailHooks.polarAngle(C, twsMS, twaDeg); if (r) return r; }
  opts = { ...opts, sailModel: 'strip' };
  const env = makeSteadyEnv(twsMS);
  const dt = 1 / 50;
  let best = { twa: twaDeg, bsp: 0, vmg: 0 };
  const genOpts = C.sails.some(s => s.kind === 'spin') && twaDeg >= 85 ? [false, true] : [false];
  for (const gen of genOpts) for (const bias of [-4, 0, 4]) {
    const b = new Boat(C, opts);
    vppStart(b, twsMS, twaDeg, gen);
    let acc = 0, n = 0;
    // (40 s settles a yacht of a few tonnes; a heavy one (C.vppSecs: a 185 t superyacht's speed has a time constant of
    // ~25 s) is still gathering way at the end of it)
    const steps = 50 * (C.vppSecs ?? 40);
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
