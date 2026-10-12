// ---- Vestas Sailrocket 2 (VSR2): Paul Larsen's speed-record craft. Holder of the outright 500 m world sailing speed
// record, 65.45 kn (24 Nov 2012, Walvis Bay, Namibia: 500 m in 14.85 s; WSSRC newsletters 218/219, ratified Dec 2012)
// and of the nautical mile, 55.32 kn (18 Nov 2012). Launched 8 Mar 2011; designed by Malcolm Barnsley, Chris Hornzee-
// Jones and Wang Feng (Aerotrope), George Dadd and Paul Larsen; built by the team at the Vestas R&D facility, East Cowes.
//
// What she is (sources: the team's own pages, http://sailrocket.com/node/291 "Dimensions", node/292 "How it works",
// node/410-412 the wing, node/517-518 the foils, node/595-672 the 2012 campaign blog; WSSRC tables
// https://www.sailspeedrecords.com/500-metre and /nautical-mile; Aerotrope, https://www.aerotrope.com/what-we-do/low-
// carbon-vehicles/sailrocket-speed-sailing.html; Wavetrain, "Deconstructing Sailrocket"; Sail-World 83126):
//  * a proa-like asymmetric craft that sails on starboard tack only: the fuselage to windward, a long beam to leeward
//    with the wing at its end. The fuselage and beam are set 20 deg to the direction of travel, so at speed the
//    fuselage points into the apparent wind and the beam lies across it (node/292).
//  * the wing: rigid, inclined 30 deg to windward "to match the inclination of the opposing foil", so that the two
//    lines of force are one and the craft feels no overturning moment (node/287, node/410 and the force-alignment
//    drawing). Asymmetric section with a reflexed trailing edge, set up for starboard tack. Total area 22 m^2 (18 m^2
//    projected); ~65-70 kg. Seven elements (fillet, lower wing, middle wing with trim flap, tip, the extension at its
//    foot and its lift flap); the pilot sheets it in to ~10 deg for full power, eases to ~20 to moderate, ~30 at the
//    end of a run (node/411-412, node/591, node/672). Here the elements are trimmed as one (their sections lined up,
//    the full-power setting); the twist between them is not modelled.
//  * the main foil: on a stub beam off the windward side of the fuselage, aft, opposite the beam; an L-shaped,
//    surface-piercing, base-ventilated wedge (sharp leading edge, blunt base) in infused carbon, by Aerotrope, with
//    fences on both faces at the curved transition (they stopped the transition's ventilation overloading the lower
//    part, which had then cavitated at ~52 kn: node/595). Its pitch is fixed during a run. The foil pulls her down as
//    the inclined wing lifts her (Sail-World 83126).
//  * three planing floats, V'd with steps: the front float under the nose (the only planing surface at speed, the
//    small rudder under it, steered by a wheel), the rear float at the stern of the fuselage (lifted 20-30 cm clear
//    at speed by the foil's curve, node/561; a skeg under it for low speed), the leeward float under the wing (it flies
//    from ~38-50 kn, carried by the wing extension in ground effect).
//  * the pilot at the front of the fuselage ("It is why I'm in the front": node/517).
//  * 275 kg empty; 12.2 m long and 12.2 m wide (node/291); the whole craft has the aerodynamic drag of a 74 cm sphere
//    (node/292).
//  * performance: designed to run above 50 kn in 20-30 kn of wind; runs at ~2.4-2.5 times the wind speed; 43.85 kn
//    in 17-22 kn (node/603); needs ~17-20 kn to get going; the record runs at about 95-100 deg true (99 deg on
//    12 Nov, node/623); the 24 Nov record in 27-29 kn at the shore station, peak 68.01 kn.
// ESTIMATES (est.): no dimension beyond the above is published. The fuselage (10 m), the beam (6.6 m from the fuselage
// to the wing's foot), the wing's length along its spar (8.0 m) and chords (3.2 m root, 1.9 m tip), the floats
// (1.5-1.8 m sleds), the foil (0.18 m chord, ~1.3 m immersed), the rudder and the mass distribution are scaled from the
// force-alignment drawing (in which the craft's width, 12.2 m, fixes the scale) and from the team's photographs. The
// foil's stub and the wing's foot are placed so that the wing's centre of effort and the foil's lie on one line at
// the wing's 30 deg, as the team designed them; whether she then sails without heeling is left to the physics.
// The pilot: 80 kg (est.: the team's own reference passenger, node/292).
//
// Geometry: given in the fuselage's frame (fx along the fuselage, fy to starboard, z up from the design waterline)
// and turned 20 deg (nose to starboard, toward the wind) into the craft's frame, whose x is her direction of travel:
// her heading is where she goes, as the pods, the foil and the rudder are aligned to it.
import { DEG } from './util.js';

const CRAB = 20 * DEG;                                   // fuselage and beam to the direction of travel (node/292)
const cc = Math.cos(CRAB), sc = Math.sin(CRAB);
const T = (fx, fy, z) => [fx * cc - fy * sc, fx * sc + fy * cc, z];          // fuselage frame -> craft frame
const D = (fx, fy, z) => T(fx, fy, z);                                         // (directions turn the same way)

export function makeSailrocket2(o = {}) {
// ---- the layout in the fuselage frame (est.: see above)
const FUS = { x0: -5.0, x1: 5.0, z: 0.95, r: 0.42 };     // fuselage: 10 m, ~0.85 m deep, its axis 0.95 m up
// (opts.xw, opts.xf: the beam's and the foil stub's stations along the fuselage; opts.foilDy: the foil's offset across
// from where the static alignment puts it.) The beam slides along the fuselage, forward at low speed and aft at speed
// (node/292); the foil's pitch is tuned between sessions (node/660): as the team set her up, these were chosen (est.)
// so that at speed (26 kn of wind, 100 deg true) the yaw moment the rudder must hold is small and she sails level with
// the leeward float light: 0.5 m further across than the static alignment of the two centres (the wing's centre rises
// with the wind gradient), the beam at the stern and the foil's stub 2 m ahead of it.
const XB = o.xw ?? -5.0, XF = o.xf ?? -3.0;
const BEAM_Y = -6.6, BEAM_Z = 1.0;                       // the beam out to the wing's foot, to port (leeward)
const INC = 30 * DEG;                                    // the wing's inclination to windward (node/410)
const WING = { foot: [XB, BEAM_Y, 1.3], len: 8.0, chord: [3.2, 1.9] };
// the wing's span (spar) direction: up and to windward (starboard) in the beam's plane
const WS = [0, Math.sin(INC), Math.cos(INC)];
// the foil: from its stub off the starboard side, down and inboard, parallel to the wing (its force at the same 30
// deg), then the L's foot turning further inboard (more of its force downward). Its stub is placed where the wing's
// line of force, run down from the wing's centre of effort (0.42 of its span: a tapered wing's centroid) at the wing's
// inclination, reaches the foil's centre at its design depth (0.35 m, est.): the team's force alignment
const WCE = 0.42 * WING.len, ZF = -0.35;
const wceY = WING.foot[1] + WS[1] * WCE, wceZ = WING.foot[2] + WS[2] * WCE;
const foilY = wceY + (wceZ - ZF) / Math.tan(INC);
const FOIL_TOP = [XF, foilY + (o.foilDy ?? 0.5) + (0.45 - ZF) * Math.tan(INC), 0.45];   // (where it leaves the stub, 0.45 m above the water)
const FOIL_A = { len: 1.35, dir: [0, -Math.sin(INC), -Math.cos(INC)], chord: o.foilChord ?? 0.15 };
const FOOT_DIR = [0, -Math.sin(62 * DEG), -Math.cos(62 * DEG)];
const add = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const ELBOW = add(FOIL_TOP, FOIL_A.dir, FOIL_A.len);

  return {
  id: 'sailrocket2', group: 'speed', name: 'Vestas Sailrocket 2',
  blurb: "Paul Larsen's speed-record craft (65.45 kn over 500 m, Walvis Bay, 2012): a rigid wing leaning 30° to windward at the end of a beam, a ventilated foil on the windward side whose line of force is the wing's, three planing floats. It sails only on starboard tack, needs about 20 kn of wind, and runs at two and a half times the wind speed on a reach.",
  specs: 'Length 12.2 m · Width 12.2 m · 275 kg empty · Wing 22 m² (18 m² projected), inclined 30° · Starboard tack only · 500 m record 65.45 kn',
  // (what the rest of the game reads: her extent along her heading and across it, the wing's height, the foil's depth)
  loa: 12.2, lwl: 9.4, beam: 12.2, hullBeam: 0.85, bowX: 4.9, sternX: -5.6, freeboard: 0.9, canoeDraft: 0.25, draft: 1.25,
  mastHeight: 8.2, mastX: -1.0, boomZ: 1.3, targetHeel: 6 * DEG, canCapsize: true, crewN: 1, crewEach: 80, crewZ: 0.8,
  massHull: 275, sheetPower: 400, hasBackstay: false, hasBoard: false, sails: [], lines: {}, engine: null,
  rudder: { max: 12 * DEG },
  speed: {
    windSide: 1,                                          // starboard tack only: the wind from starboard
    crab: CRAB,
    rudderMax: 12 * DEG,
    // the pilot's wing trim: the chord's angle to the fuselage's axis, from over-sheeted (stalled to windward, to
    // bear away from rest: node/591) to eased right out
    wing: {
      foot: T(...WING.foot), span: D(...WS), len: WING.len, chord: WING.chord, chord0: D(-1, 0, 0), liftTo: [0, -1, 1],
      // asymmetric, cambered for starboard tack (est.: its zero-lift angle 2 deg, the reflexed trailing edge keeping
      // the camber moderate); thickness 12% (est.); the root against the fillet and the extension is an end plate
      sec: { kind: 'naca', tc: 0.12, alpha0: 2 * DEG, clMax: 1.2, cd0: 0.015, kcl: 0.015 }, endPlate: 0.3, trim: [-60 * DEG, 90 * DEG], aoa: 7, aoaMax: 12,
    },
    trim0: 0.3,
    // the wing extension: a horizontal surface at the wing's foot reaching outboard, in ground effect, that carries
    // the leeward float clear at speed. Its lift flap is mass balanced (node/411): here a fixed incidence (est. 5 deg)
    extension: { root: T(XB, BEAM_Y, 1.05), span: D(0, -1, 0), len: 1.8, chord: [0.95, 0.7], chord0: D(-1, 0, 0), liftTo: [0, 0, 1],
      sec: { kind: 'naca', tc: 0.12 }, inc: 8 * DEG, endPlate: 1.0 },
    foils: [
      // the main foil's long inclined leg (surface piercing) and its L's foot, base-ventilated wedges (est.: base 12% of
      // the chord, its faces 3.4 deg to the chord line); pitch fixed for the run, tuned between sessions (node/660): here -1.2 deg (est.: its
      // chord turned 1.2 deg away from its lift, so it works at the leeway the floats and rudder sail at best; the
      // fastest of -1.2, 0 and +0.6 in the VPP)
      { name: 'foil', root: T(...FOIL_TOP), span: D(...FOIL_A.dir), len: FOIL_A.len, chord: FOIL_A.chord, chord0: [-1, 0, 0], liftTo: [0, 1, -1],
        sec: { kind: 'wedge', tb: 0.12 }, inc: -1.2 * DEG, fence: true },
      { name: 'foot', root: T(...ELBOW), span: D(...FOOT_DIR), len: 0.3, chord: [FOIL_A.chord, FOIL_A.chord * 0.67], chord0: [-1, 0, 0], liftTo: [0, 1, -1],
        sec: { kind: 'wedge', tb: 0.12 }, inc: -1.2 * DEG, endPlate: 0.5, fence: true, pierce: false, baseVent: true, n: 3 },
    ],
    rudders: [
      // the small rudder under the front float, steered by a wheel (Wavetrain; node/595)
      // (est. 0.26 m deep, 0.1 m chord: "small"; its base fed with air by the float's ventilated step, Sail-World 83126)
      { name: 'rudder', root: [0, 0, 0], span: [0, 0, -1], len: 0.26, chord: [0.11, 0.08], chord0: [-1, 0, 0], liftTo: [0, 1, 0],
        sec: { kind: 'wedge', tb: 0.1 }, endPlate: 0.9, front: true, at: 'front', baseVent: true },   // (a base-cavity section: its base pressure was logged, node/558, 598)
      // the skeg under the rear float (fixed; retractable, for low speed: node/595, Wavetrain)
      { name: 'skeg', root: [0, 0, 0], span: [0, 0, -1], len: 0.22, chord: [0.3, 0.2], chord0: [-1, 0, 0], liftTo: [0, 1, 0],
        sec: { kind: 'naca', tc: 0.1 }, endPlate: 0.9, fixed: true, at: 'rear', retract: 20 },   // (pulled up above ~20 kn)
    ],
    // the floats: V'd sleds aligned with her travel (est. sizes); transom: where the keel line meets the transom
    pods: [
      { name: 'front', c: T(3.9, 0, 0), len: 1.9, b: 0.6, beta: 12 * DEG, inc: 4 * DEG, rocker: 10 * DEG, depthMax: 0.38, side: 0.3 },
      { name: 'rear', c: T(-4.3, 0, 0.2), len: 1.5, b: 0.45, beta: 12 * DEG, inc: 4 * DEG, rocker: 10 * DEG, depthMax: 0.3, side: 0.22 },
      { name: 'leeward', c: T(XB, -6.35, 0.02), len: 1.8, b: 0.5, beta: 12 * DEG, inc: 4 * DEG, rocker: 10 * DEG, depthMax: 0.34, side: 0.25 },
    ],
    // the parts' masses (est., to the published 275 kg) at their places, gyration radii about their own axes
    parts: [
      { m: 92, p: T(0.6, 0, FUS.z), r: [2.6, 0.3, 0.3], name: 'fuselage, cockpit, stub beam' },
      { m: 30, p: T(XB, BEAM_Y / 2, BEAM_Z), r: [0.1, 1.9, 0.1], name: 'beam' },
      { m: 66, p: T(XB, WING.foot[1] + WS[1] * 3.3, WING.foot[2] + WS[2] * 3.3), r: [0.8, 1.2, 2.0], name: 'wing' },
      { m: 6, p: T(XB, BEAM_Y - 0.9, 1.05), r: [0.3, 0.5, 0.05], name: 'wing extension' },
      { m: 22, p: T(XF, foilY + 0.2, 0.0), r: [0.1, 0.4, 0.5], name: 'foil, stub beam fairing' },
      { m: 16, p: T(3.9, 0, 0.2), r: [0.5, 0.2, 0.15], name: 'front float, rudder, steering' },
      { m: 10, p: T(-4.3, 0, 0.25), r: [0.4, 0.2, 0.15], name: 'rear float, skeg' },
      { m: 13, p: T(XB, -6.35, 0.25), r: [0.5, 0.2, 0.15], name: 'leeward float' },
      { m: 20, p: T(-2.5, -3.5, 2.6), r: [1.0, 1.5, 1.5], name: 'compression strut, shrouds, electronics' },
    ],
    pilot: T(3.0, 0, 0.85),
    // air drag apart from the wing: the whole craft is a 74 cm sphere's (node/292: C_D ~0.47 subcritical, 0.43 m^2:
    // C_D A ~0.2 m^2 with the wing's own profile drag in it; here ~0.12 m^2 for the rest, est.), [frontal, side] areas
    windage: [
      { p: T(0.5, 0, FUS.z), area: [0.35, 6.5], cd: 0.15 },          // the fuselage
      { p: T(XB, BEAM_Y / 2, BEAM_Z), area: [0.6, 0.3], cd: 0.08 },  // the beam (a faired section)
      { p: T(3.0, 0, 1.45), area: [0.25, 0.25], cd: 0.5 },          // the pilot's head and the cockpit
    ],
    // parts that go in the water only in a capsize or a nosedive: the fuselage's ends and the beam's middle
    wet: [
      { p: T(3.5, 0, FUS.z), r: FUS.r, vol: 0.9, area: 1.2, cd: 0.8 },
      { p: T(-3.0, 0, FUS.z), r: FUS.r, vol: 0.9, area: 1.2, cd: 0.8 },
      { p: T(XB, -4.0, BEAM_Z), r: 0.12, vol: 0.1, area: 0.6, cd: 1.0 },
      { p: T(XB, BEAM_Y, 1.0), r: 0.25, vol: 0.12, area: 0.5, cd: 1.0 },
      { p: T(XB, WING.foot[1] + WS[1] * 4, WING.foot[2] + WS[2] * 4), r: 1.2, vol: 0.5, area: 10, cd: 1.2 },
    ],
  },
  // the drawing (js/boats/speedcraft-model.js)
  look: {
    fus: FUS, crab: CRAB, xb: XB, beamY: BEAM_Y, beamZ: BEAM_Z, wing: WING, wingInc: INC, foilTop: FOIL_TOP, elbow: ELBOW,
    orange: 0xf26a1b, black: 0x17181a, film: 0xdfe3e6, name: 'Vestas Sailrocket 2', text: 'Vestas',
  },
};
}
export default makeSailrocket2();
