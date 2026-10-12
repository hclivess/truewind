// Jolie Brise: the Le Havre pilot cutter Alexandre Pâris designed and the Albert Paumelle yard built in 1913, one of
// the last of the pilot service; winner of the first Fastnet race in 1925 (6 d 14 h 45 min) and again in 1929 and
// 1930, the only three-time winner; owned since 1977 by Dauntsey's School, sail training. Modelled as she sails now.
// Sources: Dauntsey's School (LOD 17.06 m, 22.5 m with the bowsprit, LWL 14.63 m, beam 4.63 m, draft 3.10 m, 44 tons
// Thames measurement); Wikipedia 'Jolie Brise' (the same; Gardner diesel fitted at Marseille 1934; the Fastnet wins);
// National Historic Ships UK, register 2663 (oak on grown frames, iron keel with lead internal ballast, air draft 76 ft,
// a 38 ft boom, running backstays and a topmast, Dacron sails, the original windlass and tiller, a new diesel 2024);
// Tom Cunliffe in Classic Boat, February 2021 (a 55-tonne gaff cutter, 2,500 sq ft of fore-and-aft sail, 'not a winch
// to be found', a quarter propeller, the net under the bowsprit, ratlines and a sheer pole, 'a comfy seven knots'
// under working sail in the Solent); the photographs on Wikimedia Commons (black topsides, a thin red cove line under a
// varnished rail, red antifouling and a narrow white boot top; tan sails, 'DS2' in white high on the main; a plumb
// stem, a raked transom with the rudder hung on it, the boom far out over it).
// Estimates (marked so): the ballast (22 t), the spars and heights (the lower masthead 17.5 m, the topmast's truck
// 22.6 m above the water from the air draft; a gaff of ~8.1 m, its peak at the lower masthead's peak halyard blocks), the mast's position, the sail split (main 128,
// topsail 25, staysail 30, jib 40 m^2 of the ~230: her jib topsail is not set here), the engine's power (~100 hp) and
// the propeller's place on the starboard quarter.
// Line handling: no winches — everything on tackles, sweated up and belayed to pins in the pinrails and to cleats: the
// mainsheet's tackle to its horse across the counter, the staysail sheet to its horse before the mast, the jib sheets
// to the rail; the throat and peak halyards to the mast's pinrail; the helm a long tiller.
import { clarkeMunkK, DEG, HP, rrTable, massProps } from './util.js';

const LWL = 14.63, M = 55000, BAL = 24000;
const MP = massProps([{ m: M - BAL - 1800, z: 0.6, ry: 1.7, rx: 4.6 }, { m: BAL, z: -2.3, ry: 0.4, rx: 3.0 }, { m: 1800, z: 8.5, rz: 5.5 }]);
export default {
  id: 'joliebrise', name: 'Jolie Brise', group: 'legend', sailNo: 'DS2',
  blurb: "The 1913 Le Havre pilot cutter that won the first Fastnet race in 1925 — and again in 1929 and 1930. Fifty-five tonnes of oak, a plumb stem, a long running bowsprit, a 38 ft boom far out over the transom, a gaff main with its topsail over it, tan sails, and not a winch aboard: everything on tackles and pins.",
  specs: 'LOD 17.06 m (22.5 m with bowsprit) · LWL 14.63 m · Beam 4.63 m · Draft 3.10 m · ~55 t · Gaff cutter ~223 m² (main, topsail, staysail, jib)',
  lwl: LWL, loa: 17.06, beam: 4.63, bowX: 8.6, sternX: -8.46, freeboard: 1.45, canoeDraft: 1.2, wetted: 102, draft: 3.1,
  bowsprit: 5.3, cabin: true, longKeel: true, runners: true,
  massHull: M, zG: MP.zG, crewN: 10, crewEach: 75, crewZ: 1.6, crewMaxOut: 1.8, crewLee: -1.2, hikeRate: 0.35,
  gm: 1.2, bmForm: 1.3, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.08, amY: 0.95, amYaw: 0.7, amRoll: 0.35,
  munkK: clarkeMunkK(LWL, 3.1, M + 750, 0.08, 0.95),   // (the hull's yaw moment at a drift angle, util.js)
  vppSecs: 90,   // (a heavy hull's speed settles over a minute or two: the VPP's and the helm test's run)
  rr: rrTable(LWL, M + 750, { prism: -0.04 }),
  // (the long keel's lift centre 1.5 m abaft the CG (est.): ~4.5 deg of weather helm close-hauled in 12 kn, test/helm.mjs)
  keel: { x: -1.5, z: -1.5, area: 24, ARe: 0.8, stall: 26 * DEG, cd0: 0.003, span: 3.1, chord: 12, long: true },
  rudder: { x: -7.6, z: -1.3, area: 2.4, ARe: 1.9, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 2.6, chord: 0.95, transom: true, loadRef: 9000 },
  hullLat: { area: 5, cd: 0.9, z: -0.4 },
  windage: { area: 15, z: 4.2, cd: 1.0 },
  mastX: 1.4, mastHeight: 22.6, boomZ: 2.9, mastR: 0.17, keelBulb: false,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 4000, reefTime: 240,
  cloth: 'canvas',
  // a new diesel (2024) on a quarter propeller, offset to starboard (est. ~100 hp: 'not a huge amount of horsepower')
  engine: { type: 'inboard', model: 'diesel on a quarter propeller (2024; power est.)', kW: 100 * HP, rpmMax: 2600, rpmIdle: 700, cyl: 4, fuel: 'diesel', gear: 2.5,
    prop: { D: 0.6, P: 0.45, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-6.0, 1.0, -1.3], mount: [-3.6, 0.6, -0.4], mass: 450, inMass: true,
    shaftAngle: 6 * DEG, exhaust: [-8.3, 1.4, 0.5] },
  lines: { main: { handler: 'horn', n: 4, at: 'deck' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'horn', n: 2, at: 'deck' },
    stay: { handler: 'horn', n: 2, at: 'deck' }, vang: { handler: 'horn', n: 2, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' },
    outhaul: { handler: 'horn', n: 2, at: 'boom' }, jibHalyard: { handler: 'horn', n: 3, at: 'mast' } },
  ropeStyle: 'classic',
  sails: [
    { key: 'main', kind: 'boom', rig: 'gaff', area: 128, luff: 11.0, foot: 11.0, head: 7.2, headRise: 3.8, roach: 0,
      topsail: { luff: 8.7, area: 25, head: 0.15 },
      depth: [0.12, 0.13, 0.12], twistMax: 24 * DEG, cd0: 0.08, ARe: 2.2, min: 3 * DEG, max: 78 * DEG, trav: [-3 * DEG, 8 * DEG], Iboom: 4200, boomMass: 220, reefs: 2,
      vangBend: 0, sheetBend: 0, color: 0xa8573a, pockets: [], battens: { EI: 0, rows: [] }, boomMat: 'wood', gaffR: 0.09, boomR: 0.13, boomRound: true, ropeK: 2 },
    // the staysail: loose-footed, its sheet to a horse across the deck before the mast (self-tending)
    { key: 'stay', kind: 'boom', boomless: true, selfTacking: true, area: 30, tackX: 8.35, tackZ: 2.0, luff: 12.8, foot: 5.2, head: 0.08,
      depth: [0.12, 0.13, 0.11], twistMax: 16 * DEG, cd0: 0.05, ARe: 3.0, min: 5 * DEG, max: 55 * DEG, trav: [-6 * DEG, 6 * DEG], Iboom: 80, boomMass: 6, color: 0xa8573a },
    // the jib, set flying on its traveller out to the running bowsprit's end
    { key: 'jib', kind: 'loose', area: 40, tackX: 13.85, tackZ: 2.3, luff: 13.0, foot: 7.0, head: 0.08, footRise: 1.0,
      depth: [0.12, 0.13, 0.11], cd0: 0.05, ARe: 3.4, min: 10 * DEG, max: 55 * DEG, sagK: 2.0, color: 0xa8573a, window: false },
  ],
  hull: { color: 0x121316, stripe: 0xb22a1e, deck: 0xc9a878, boot: 0x9a2a20, bootTop: 0xf2efe6, levels: [0.0, 0.08, 0.36, 0.33], rough: 0.5 },
  sailcloth: { cloth: 0xa8573a, kind: 'dacron', mottle: false, num: '#f4f1ea', logo: '#f4f1ea', trans: 0.15, rough: 0.75 },
  insignia: '',
  offsets: {
    // (a plumb stem with a deep forefoot, a long straight keel deepening aft, firm bilges, a raked transom with the
    // rudder hung on it)
    sheer: [[0, 1.7], [0.25, 1.48], [0.55, 1.42], [0.8, 1.55], [1, 1.95]],
    deck: [[0, 0.6], [0.1, 0.78], [0.3, 0.95], [0.5, 1.0], [0.7, 0.93], [0.85, 0.72], [0.95, 0.38], [1, 0.04]],
    wl: [[0, 0.4], [0.12, 0.62], [0.45, 0.9], [0.75, 0.82], [0.92, 0.5], [1, 0.2]],
    keel: [[0, 1.0], [0.07, 0.4], [0.13, -0.25], [0.22, -1.0], [0.35, -1.3], [0.6, -1.3], [0.82, -1.0], [0.92, -0.5], [0.955, 0.0], [1, 1.9]],
    fin: [[0.02, -0.15], [0.11, -3.1], [0.45, -2.75], [0.8, -2.2], [0.92, -1.4], [0.955, -0.4]], finW: 0.22,
    bilge: [[0, 2.2], [0.45, 2.6], [0.85, 2.0], [1, 1.6]], dead: [[0, 0.4], [0.45, 0.4], [0.85, 0.6], [1, 0.75]], flare: 0.72,
    crown: 0.1, transomRake: 1.0, stemX: 0.0,
  },
  model: {
    cockpit: { t0: 0.04, t1: 0.12, w: 0.42, sole: 0.95, seats: false, coaming: 0.2, coamingMat: 'teak' },
    deck: 'teak', toerail: { bulwark: 0.42, cap: 'teak', color: 0x121316 }, bronze: true, navLights: false,
    cabins: [
      // the coachroof amidships (the crew sit on it), a skylight, the companion aft
      { t0: 0.38, t1: 0.55, h: [[0.38, 0.45], [0.55, 0.45]], w: [[0.38, 0.95], [0.55, 0.95]], slope: 0.04, camber: 0.08, frontRake: 0.05, aftRake: 0.05,
        color: 0xb06a3a, side: 'wood', roof: 'paint', roofColor: 0xd8ccb0, trim: 'teak', windows: [{ kind: 'port', t0: 0.41, t1: 0.52, n: 3, r: 0.07, zf: 0.5, mat: 'bronze' }],
        hatches: [{ t: 0.47, w: 0.7, l: 0.7 }] },
      { t0: 0.16, t1: 0.22, h: [[0.16, 0.42], [0.22, 0.42]], w: [[0.16, 0.5], [0.22, 0.5]], slope: 0.03, camber: 0.05, color: 0xb06a3a, side: 'wood', roof: 'teak', trim: 'teak',
        windows: [], companion: { w: 0.6, mat: 'teak' }, hatches: [{ t: 0.19, w: 0.6, l: 0.55, kind: 'slide' }] },
    ],
    steering: { kind: 'tiller', len: 2.6, rise: 0.25, mat: 'wood', r: 0.05 },
    rudder: { kind: 'transom', x: -8.4, top: 1.95, bottom: -2.9, chordTop: 0.45, heel: 0.35, lean: 0.2, mat: 'hull', thick: 0.1, pintles: [-2.3, -1.2, 0.0, 1.3] },
    keel: { kind: 'full' },
    bowsprit: { len: 5.3, kind: 'pole', mat: 'wood', r: 0.12, steeve: 0.1, inboard: 2.6, bobZ: 0.2 },
    masts: { main: { mat: 'wood', r: 0.17, round: true, spreaders: [], topmast: { cap: 17.5, heel: 15.5, r: 0.08, trees: 0.8 }, hounds: 16.7,
      deadeyes: true, deadeyeR: 0.07, ratlines: true, chainIn: 1.0, shrouds2: 0.7, lowerX: [] } },
    backstay: false, windex: false, noNumber: false,
    runners: { x: -2.6, z: 16.7 },
    hullName: { text: 'JOLIE BRISE', t: 0.6, board: true, inset: 0.985, dz: 0.67, len: 1.9, color: '#121316', bg: '#efe6cf', font: '700 64px Georgia, "Times New Roman", serif' },
    extras: ['schoonerDeck'],
  },
  hw: { trav: [-7.9, 1.6], boomS: 0.97, winch: [-5.5, 1.75], jibTrack: [5.0, 3.5, 1.9], helm: 'Tiller', bronze: true, winchR: 0.06 },
};
