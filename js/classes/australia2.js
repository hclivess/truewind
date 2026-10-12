// Australia II (KA 6): Ben Lexcen's International 12 Metre for Alan Bond's syndicate, built in aluminium by Steve E. Ward
// & Co., Perth, 1982, who on 26 September 1983 won the America's Cup 4-3 against Liberty at Newport, ending the New
// York Yacht Club's 132 years: the winged keel. John Bertrand skipper, eleven crew. Now with the WA Museum, Fremantle.
// Sources: 12mR class association, 12mrclass.com/australia-ii (ITMA figures: LOA 19.22 m, LWL 13.10 m, beam 3.65 m,
// draft 2.59 m, displacement 21.8 t, sail area 171 m^2, aluminium, sail number KA-6); Wikipedia 'Australia II' (draft
// 2.72 m, 175 m^2, a carbon boom, Kevlar running rigging); P. van Oossanen's account (proboat.com 2024, parts 1-2;
// van Oossanen & Joubert, J. Fluid Mech. 173, 1986): an inverted keel, its tip chord twice its root's, zero
// quarter-chord sweep; winglets placed and twisted by NLR panel calculations (J. Slooff), the induced drag at a given
// side force up to 35% lower (Wikipedia: 30%), +0.04-0.09 kn VMG over 7.5 kn of wind, a quarter less helm force at 30
// deg of rudder; a separate spade rudder, its stock moved 0.3 m forward when the bustle was faired away; a trim tab
// on the keel's trailing edge (not modelled: the sim's keel has no tab); Wikipedia 'Winged keel' (winglets canted
// ~20 deg down).
// Estimates (marked so): the keel's chords (root 2.0 m, tip 4.0 m) and span below the canoe body (1.75 m), the winglets'
// span (1.45 m each side), chord (1.3 m root, 0.7 m tip) and the induced-drag factor taken as 30%; the ballast (15 t
// of lead, in the keel and its winglets); the rig (near-masthead: I 22.6, J 7.3, P 23.0, E 7.6 m; main 95 m^2 with
// its roach, genoa 76 m^2; spinnaker ~280 m^2 on a 7.3 m pole); the colours (white hull, green boot top and a gold
// cove line, the Australian sporting colours she raced in; buff-gold Kevlar laminate main and genoa: unverified).
// Line handling: two coffee-grinder pedestals driving the primary winches (self-tailing), the mainsheet on its own
// winch-driven tackle to a traveller, runners on winches; no engine (a 12 Metre races without one).
import { DEG, rrTable, massProps } from './util.js';

const LWL = 13.10, M = 21800, BAL = 15000;
const MP = massProps([{ m: M - BAL - 900, z: 0.3, ry: 1.0, rx: 4.6 }, { m: BAL, z: -2.0, ry: 0.4, rx: 1.0 }, { m: 900, z: 12.5, rz: 7.2 }]);
export default {
  id: 'australia2', name: 'Australia II (KA 6)', group: 'legend', sailNo: 'KA 6',
  blurb: "Ben Lexcen's 12 Metre that took the America's Cup from the New York Yacht Club in 1983, ending 132 years. Under her the secret: an upside-down keel, longest at its tip, with two winglets canted down off it that cut the keel's induced drag by about a third. Low, narrow and long-ended, eleven crew, two coffee grinders.",
  specs: 'LOA 19.22 m · LWL 13.10 m · Beam 3.65 m · Draft 2.59 m · 21.8 t · ~15 t lead (est.) · 171 m² (main + genoa) · Winged keel',
  lwl: LWL, loa: 19.22, beam: 3.65, bowX: 9.55, sternX: -9.67, freeboard: 0.95, canoeDraft: 1.25, wetted: 41, draft: 2.59,
  massHull: M, zG: MP.zG, crewN: 11, crewEach: 85, crewZ: 1.05, crewMaxOut: 1.5, crewLee: -0.8, hikeRate: 0.5,
  gm: 1.1, bmForm: 0.9, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.06, amY: 0.85, amYaw: 0.6, amRoll: 0.3,
  // (her long overhangs sail her on a longer waterline heeled: the wave-making on ~14.6 m)
  rr: rrTable(14.6, M + 935),
  // (the keel's lift centre 2.2 m abaft the mast (est.: the winged keel sat well aft, its leading edge raked forward,
  // and van Oossanen moved it 210 mm forward late in the design): ~4 deg of weather helm close-hauled in 12 kn,
  // test/helm.mjs; the spade rudder 1.4 m^2 (est.))
  keel: { x: -0.4, z: -1.75, area: 5.3, ARe: 1.9, stall: 18 * DEG, cd0: 0.009, span: 1.75, chord: 3.0 },
  rudder: { x: -5.3, z: -1.0, area: 1.4, ARe: 2.6, stall: 18 * DEG, cd0: 0.011, max: 32 * DEG, span: 1.65, chord: 0.85, loadRef: 6000 },
  hullLat: { area: 4.2, cd: 0.9, z: -0.3 },
  windage: { area: 11, z: 3.0, cd: 0.95 },
  // the rig as a structure (js/rig-structure.js): a keel-stepped alloy mast, section est. 360 x 220 mm with a 9 mm wall
  // in 7075, tapering above the hounds; three sets of spreaders; rod caps and lowers, backstay and runners (est.: a 12
  // Metre of 1983; sized to ~2.8x the cap's load at her righting moment at 30 deg, ~130 kN m). The generic sizing
  // (wire from the righting moment, a wall from the Euler load of the caps alone) gave 14.5 mm wire, 160 kN of mast
  // compression at the dock with backstay and runners both set up, and a mast that buckled in 20 kn
  rigStructure: {
    step: { type: 'keel', z: -0.3, partners: 1.0 },
    spans: [{ z0: -0.3, z1: 21.5, a: 0.36, b: 0.22, t: 0.009, mat: 'alu7075' }, { z0: 21.5, z1: 26.0, a: 0.24, b: 0.15, t: 0.006, mat: 'alu7075' }],
    spreaders: [{ z: 8.5, len: 1.1, sweep: 0, EA: 6e7, EI: 3e5 }, { z: 14.8, len: 0.85, sweep: 0, EA: 5e7, EI: 2e5 }, { z: 20.4, len: 0.6, sweep: 0, EA: 4e7, EI: 1.2e5 }],
    chainX: -0.15, chainIn: 0.93,
    wires: [
      { key: 'capShroud', to: 'hounds', via: 0, d: 11, pre: 9000 },
      { key: 'lowerShroud', to: 8.5, dx: 0.1, d: 9, pre: 4500 },
      { key: 'forestay', stay: 'jib', d: 11 },
      { key: 'backstay', to: 'top', off: -0.1, low: 'transom', d: 10, pre: 7000, adjust: 0.05 },
      { key: 'runner', to: 'hounds', runner: true, d: 10, pre: 4500 },
    ],
    houndsZ: 23.5, prebend: 0.06, lineMax: 13000,
  },
  mastX: 1.85, mastHeight: 26.0, boomZ: 1.55, mastR: 0.12, keelBulb: false, runners: true,
  targetHeel: 22 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 4500, reefTime: 90,
  engine: null,
  lines: { main: { handler: 'winchCam', n: 4, at: 'car' }, trav: { handler: 'cam', n: 3, at: 'deck' }, jib: { handler: 'selfTailer', at: 'winch' },
    gen: { handler: 'selfTailer', n: 1, at: 'winch' }, vang: { handler: 'clutch', n: 6, winch: 'cabin', at: 'cabin' }, cunn: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' },
    outhaul: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' }, backstay: { handler: 'horn', n: 12, at: 'deck' }, jibHalyard: { handler: 'selfTailer', at: 'mast' }, tackLine: { handler: 'cam', at: 'deck' } },
  sails: [
    { key: 'main', kind: 'boom', area: 95, luff: 23.0, foot: 7.4, head: 0.25, roach: 0.12, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 5.4, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 900, boomMass: 70, reefs: 1,
      vangBend: 0.12, sheetBend: 0.08, color: 0xd9c48c, boomMat: 'carbon', pockets: [[0.25, 0.18], [0.5, 0.2], [0.75, 0.16]] },
    { key: 'jib', kind: 'loose', label: 'Genoa', area: 76, tackX: 9.2, tackZ: 1.15, luff: 22.4, foot: 10.6, head: 0.1, footRise: 0.2,
      depth: [0.11, 0.12, 0.1], cd0: 0.04, ARe: 4.6, min: 8 * DEG, max: 48 * DEG, sagK: 1.0, color: 0xd9c48c, window: false },
    { key: 'gennaker', kind: 'spin', pole: 7.3, area: 280, tackX: 9.2, tackZ: 1.4, luff: 23.0, rake: 7.3, fixedRake: true, foot: 13.0, head: 1.0,
      depth: [0.2, 0.22, 0.2], cd0: 0.1, ARe: 1.8, min: 18 * DEG, max: 100 * DEG, color: 0x1f7a3d },
  ],
  hull: { color: 0xf5f5f1, stripe: 0xd4a62a, deck: 0xdcd8cc, boot: 0xf0f0ea, bootTop: 0x0f6b3a, levels: [0.0, 0.1, 0.24, 0.2] },
  cloth: 'laminate',
  sailcloth: { cloth: 0xd9c48c, kind: 'laminate', num: '#14301f', logo: '#14301f', trans: 0.15, rough: 0.45 },
  insignia: '',
  offsets: {
    // (a 12 Metre's lines: long, low, narrow, long overhangs both ends, the canoe body faired into the fin; the
    // bustle faired away aft, as van Oossanen did)
    sheer: [[0, 1.05], [0.25, 0.92], [0.55, 0.9], [0.8, 1.0], [1, 1.22]],
    deck: [[0, 0.42], [0.12, 0.66], [0.3, 0.9], [0.5, 1.0], [0.68, 0.92], [0.84, 0.62], [0.95, 0.24], [1, 0.02]],
    wl: [[0, 0.25], [0.2, 0.55], [0.45, 0.82], [0.7, 0.7], [0.88, 0.32], [1, 0.08]],
    keel: [[0, 0.8], [0.12, 0.25], [0.175, 0.0], [0.3, -0.85], [0.5, -1.25], [0.66, -1.05], [0.79, -0.45], [0.87, 0.0], [0.94, 0.5], [1, 1.0]],
    bilge: [[0, 1.8], [0.45, 1.9], [0.8, 1.6], [1, 1.4]], dead: [[0, 0.45], [0.45, 0.55], [0.8, 0.7], [1, 0.85]], flare: 0.75,
    crown: 0.08, transomRake: 0.25,
  },
  model: {
    // a flush deck: the helmsman's well aft, the grinders' and trimmers' pits amidships, no house
    cockpit: { t0: 0.16, t1: 0.42, w: 0.55, sole: 0.35, seats: false, coaming: 0.05 },
    deck: 'nonskid', deckTint: '#dcd8cc', toerail: 'alu', navLights: false, cleats: false,
    cabins: [],
    steering: { kind: 'wheel', x: -3.7, r: 0.75, hub: 1.0 },
    rudder: { kind: 'spade', color: 0xf0f0ea, thick: 0.1 },
    keel: { kind: 'fin', chord: 2.0, taper: 2.0, sweep: -0.25, thick: 0.14, color: 0xf0f0ea,
      winglets: { span: 1.45, chord: 1.3, tipChord: 0.7, cant: 20, sweep: 0.3, x0: 0.35, tc: 0.12, kDi: 0.3 } },
    masts: { main: { mat: 'alu', r: 0.12, spreaders: [{ f: 0.3, len: 1.1, sweep: 0 }, { f: 0.55, len: 0.85, sweep: 0 }, { f: 0.78, len: 0.6, sweep: 0 }] } },
    backstay: { split: false },
    runners: { x: -4.5, z: 21.0 },
    noNumber: false, windex: true,
    extras: ['grinders'],
  },
  hw: { trav: [-2.6, 0.75], boomS: 0.5, winch: [-1.2, 1.4], jibTrack: [0.6, -1.6, 1.05], cabinWinch: [-0.2, 0.45], clutchX: 0.0, helm: 'Wheel', winchR: 0.11 },
};
