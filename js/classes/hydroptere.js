// ---- l'Hydroptère: Alain Thébault's foiling trimaran (launched Sept 1994, Saint-Nazaire; hull and floats by DCN
// Lorient; VPLP naval architects with Dassault Aviation engineers; EPFL foil work from 2006). Holder of the outright
// 500 m world sailing speed record, 51.36 kn (4 Sept 2009, Hyères: 500.05 m in 18.9 s, wind 30 kn from 260°, WSSRC
// newsletter 177), and of the nautical mile, 50.17 kn (8 Nov 2009, 30-35 kn, newsletter 178). Peak 55.5 kn. On 21
// Dec 2008, after a peak of 56.36 kn in gusts over 45 kn, she capsized and turtled; the design team blamed a coupling
// between the crossbeam's twist and the windward foil's load at very high speed (Bourgeon et al. 2010, EPFL / RINA
// Innov'Sail 2010).
// Sources: lhydroptere.com (official specifications: LOA 18.28 m, floats 6.7 m, beam 24 m, air draft 30 m, draft
// 1.3 m hull / 3.5 m foils, 7.5 t, crew 4-10, main 195 m², solent 105 m², trinquette 65 m²); fr.wikipedia
// L'Hydroptère (foils ~6 m and 380 kg each, held at 42-45° by titanium arms, carbon with a composite leading edge,
// ending in a vertical winglet; Rafale-derived shock absorbers that let a foil give above ~30 t; rear T-foil, strut
// 3.30 m, its horizontal foil's 55 cm flap "controls the take-off"; mast 27 m, carbon); ru.wikipedia (three points in
// flight: the leeward lateral foil, the windward one (immersion varying), the rear T-foil; ~2 m² wetted in flight);
// Wikimedia Commons photographs (2010 livery: white hull, the name in black italic script, charcoal carbon sails with
// white battens; foils sloping down and inboard from the float ends, a Λ seen from ahead; the T-foil on a transom
// bracket). WSSRC newsletters 177, 178 via sailspeedrecords.com.
// ESTIMATES (est.): no foil area, chord or section is published. Foil chord 0.85 m at the root tapering to 0.6 m (a
// carbon foil 6 m long weighing 380 kg is about that size: ~0.25 m³ of laminate at ~1.6 t/m³ for a 9% section);
// a 9% section cambered for a design lift of 0.25 (the EPFL work shaped the sections against cavitation: a section
// with its cavitation bucket at its working lift, est.), zero-lift angle -2°; incidence 2° (fixed, set ashore: not found
// whether it can be trimmed under way); the hull and
// float lines, the beam stations, the mass split and centre of gravity, the elevator's span (2.2 m) and chord; the crew
// of 6 (4-10 sail her; 11 aboard for the records). The sailing displacement is taken as the official 7.5 t, crew in.
// What is not modelled: the crossbeams' elasticity (the twist-load coupling of the 2008 capsize), the foils' shock
// absorbers, the trinquette and gennaker.
// Foils (C.hydrofoils, js/hydrofoil.js Surface, in strips at their depths: physics.js Boat.step): a surface-piercing
// foil lifts by its immersed span, so she finds her own ride height; the leeward one carries her, the windward one
// lifts out; one that ventilates down from the surface (past its inception angle at speed) loses its lift at once.
import { DEG } from './util.js';

// geometry (x forward from the centre of gravity, y to starboard, z up from the design waterline; est.)
const FLOAT_Y = 11.4, FOIL_X = 1.2, BEAM_F = 2.6, BEAM_A = -3.2;
const DIH = 45 * DEG;                                    // the foils' slope to the horizontal (42-45°: fr.wikipedia)
const foil = (side) => ({
  name: side > 0 ? 'stbd foil' : 'port foil', side,
  // from its arm at the float, down and inboard at 45°, 5.5 m, then the winglet (straight down, 0.6 m)
  root: [FOIL_X, side * (FLOAT_Y - 0.55), 1.05], span: [0, -side * Math.cos(DIH), -Math.sin(DIH)], len: 5.5,
  chord: [0.85, 0.6], chord0: [-1, 0, 0], liftTo: [0, -side, 1], sec: { kind: 'naca', tc: 0.09, alpha0: 2 * DEG, clDesign: 0.25 }, inc: 2 * DEG, n: 10,
});
const winglet = (side) => {
  const f = foil(side), tip = f.root.map((v, k) => v + f.span[k] * f.len);
  return { name: (side > 0 ? 'stbd' : 'port') + ' winglet', side, root: tip, span: [0, 0, -1], len: 0.6, chord: [0.6, 0.4], chord0: [-1, 0, 0], liftTo: [0, side, 0], sec: { kind: 'naca', tc: 0.08 }, inc: 0, n: 2, endPlate: 0.5, pierce: false };
};

export default {
  id: 'hydroptere', group: 'speed', name: "l'Hydroptère",
  blurb: "Alain Thébault's foiling trimaran (1994): 18.3 m long, 24 m wide, on two surface-piercing foils sloping in at 45° from her floats and a T-foil rudder. She lifts out at about 15-20 kn and flies on her leeward foil; 51.36 kn over 500 m in 2009. A foil that ventilates drops her; in 2008 she capsized at 56 kn.",
  specs: 'LOA 18.28 m · Beam 24 m · Floats 6.7 m · 7.5 t · Mast 27 m · Main 195 m² · Solent 105 m² · Foils 3.5 m draft · 500 m record 51.36 kn',
  lwl: 17.6, loa: 18.28, beam: 24, hullBeam: 1.9, bowX: 9.3, sternX: -8.98, freeboard: 1.05, canoeDraft: 0.6, wetted: 26, draft: 3.5,
  amas: { y: FLOAT_Y, tube: { r: 0.62, z: 0.66 }, sy: 1, sz: 1, szTop: 1, dz: 0, t0: (-4.6 + 8.98) / 18.28, t1: (2.1 + 8.98) / 18.28, beams: [BEAM_F, BEAM_A], netZ: 1.25 },
  wheel: { x: -5.0, r: 0.55, h: 0.8 }, mastR: 0.17, wingMast: true, reefTime: 90, reefWind: [24, 32], speedMax: 40,
  engine: null,
  lines: { main: { handler: 'selfTailer', n: 8, at: 'winch' }, trav: { handler: 'selfTailer', n: 4, at: 'winch' }, jib: { handler: 'selfTailer', at: 'winch' },
    vang: { handler: 'horn', n: 8, at: 'deck' }, cunn: { handler: 'horn', n: 4, at: 'mast' }, outhaul: { handler: 'horn', n: 4, at: 'boom' },
    jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  ropeStyle: 'modern',
  // 7.5 t sailing (official), crew of 6 at 80 kg (est.); the foils 2 x 380 kg (fr.wikipedia) out at the floats
  massHull: 7020, zG: 0.9, crewN: 6, crewEach: 80, crewZ: 1.4, crewMaxOut: 4.0, crewLee: -1.0, hikeRate: 1.0,
  gm: 9, bmForm: 3, Ixx: 260000, Izz: 330000, amX: 0.04, amY: 0.35, amYaw: 0.4, amRoll: 0.4,
  // residuary resistance / weight: slender hulls (the Southampton-series level the Mariner's trimaran uses); flying,
  // it goes with the hull's immersed volume (js/physics.js)
  rr: [[0.1, 0.0004], [0.2, 0.002], [0.3, 0.0076], [0.35, 0.0145], [0.4, 0.024], [0.45, 0.034], [0.5, 0.04], [0.6, 0.045], [0.7, 0.047], [0.8, 0.05], [1.0, 0.054], [1.2, 0.058], [1.5, 0.065]],
  // the main hull's own lateral plane (no board: her foils resist leeway), a long low fin of the hull's 1.3 m draft
  // (official), the canoe body and its skeg (est.)
  keel: { x: 0.2, z: -0.65, area: 5.0, ARe: 0.6, stall: 26 * DEG, cd0: 0.013, span: 1.3, chord: 8, long: true },
  // the T-foil's strut, hung on a transom bracket (3.3 m strut: fr.wikipedia), steered by the wheels
  rudder: { x: -9.25, z: -1.35, area: 0.95, ARe: 3.4, stall: 15 * DEG, cd0: 0.01, max: 25 * DEG, span: 2.7, chord: 0.35, loadRef: 6000, transom: true },
  hullLat: { area: 4.0, cd: 0.9, z: -0.25 },
  windage: { area: 22, z: 2.2, cd: 0.9 },
  mastX: 1.2, mastHeight: 28.5, boomZ: 2.6, keelBulb: false, houndsF: 0.08,
  // (flying, the crew keeps her within a few degrees of level: heeled further her windward foil lifts out and the
  // leeward one cannot hold her; overHeel: the heel past it at which the crew is fully easing, js/physics.js autoTrim)
  targetHeel: 3 * DEG, overHeel: 4, canCapsize: true, hasBackstay: false, hasBoard: false, sheetPower: 9000, fullPowerTws: 14,
  cloth: 'laminate', battens: { EI: 30, full: true, rows: [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.93] },
  sails: [
    // (est. shapes for the official areas: a square-top main on the rotating wing mast, the solent to the masthead)
    { key: 'main', kind: 'boom', area: 195, luff: 24.6, foot: 8.6, head: 2.4, depth: [0.11, 0.13, 0.12], twistMax: 18 * DEG,
      cd0: 0.06, ARe: 5.2, min: 1 * DEG, max: 70 * DEG, trav: [-4 * DEG, 22 * DEG], Iboom: 3000, boomMass: 80, reefs: 2,
      vangBend: 0.15, sheetBend: 0.06, ropeK: 20, vangTravel: 6, color: 0x2b2d31 },
    { key: 'jib', kind: 'loose', window: false, area: 105, tackX: 9.4, tackZ: 1.25, luff: 25.4, foot: 8.4, head: 0.2, footRise: 0.25,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 5.0, min: 8 * DEG, max: 40 * DEG, sagK: 1.0, color: 0x2b2d31 },
  ],
  // the main hull: long, slim, low, a fine slightly raked bow, a flat wide transom (photos; est. lines)
  offsets: {
    sheer: [[0, 0.95], [0.3, 1.0], [0.6, 1.08], [0.85, 1.2], [1, 1.38]],
    deck: [[0, 0.7], [0.12, 0.85], [0.4, 1.0], [0.62, 0.95], [0.82, 0.62], [0.95, 0.22], [1, 0.02]],
    wl: [[0, 0.62], [0.4, 0.86], [0.8, 0.72], [1, 0.3]],
    keel: [[0, -0.1], [0.08, -0.42], [0.4, -0.6], [0.75, -0.5], [0.93, -0.1], [1, 0.45]],
    bilge: 2.0, dead: 0.45, flare: 0.6, tumble: 0.04, crown: 0.18, stemX: 0.25, transomRake: -0.03,
  },
  insignia: '',
  sailcloth: { cloth: 0x2b2d31, kind: 'laminate', num: '#e8e8e8', logo: '#e8e8e8', trans: 0.12, rough: 0.4 },
  hull: { color: 0xf4f4f2, stripe: 0xc8202a, levels: [0.05, 0.05, -1, -1], deck: 0xd8dadb, boot: 0x1d1f22, bootTop: 0xf4f4f2, sectionN: 2.2, transom: 0.7, bowRake: 0.1, sheer: 0.05,
    noNumber: true, lifelines: false, deckTint: '#d6d8d9', extension: false, name: "l'Hydroptère",
    cockpit: { t0: 0.1, t1: 0.3, w: 0.55, sole: 0.75 }, cabin: { t0: 0.32, t1: 0.52, h: 0.42, w: 0.7 } },
  hw: { trav: [-3.4, 2.2], winch: [-4.4, 0.85], jibTrack: [1.0, -1.2, 0.9], boomS: 0.93, clutchX: -0.2, cabinWinch: [-0.4, 0.6] },
  // ---- the foils (js/hydrofoil.js Surface, driven in js/physics.js Boat.step)
  hydrofoils: [foil(1), foil(-1), winglet(1), winglet(-1),
    // the T-foil's horizontal: 2.6 m wide, 0.42 m chord (est.) at the strut's foot, its flap the take-off control (crew:
    // ctrl.flap); flying, it carries a down-load (the drive, high up, pitches her bow down): a thin section cambered
    // for it (est.)
    { name: 'elevator', root: [-9.3, -1.3, -2.65], span: [0, 1, 0], len: 2.6, chord: [0.42, 0.42], chord0: [-1, 0, 0], liftTo: [0, 0, 1], sec: { kind: 'naca', tc: 0.08, alpha0: -1 * DEG, clDesign: -0.08 }, inc: 0, flap: [-6 * DEG, 6 * DEG], n: 4, endPlate: 0.3, pierce: false },
  ],
};
