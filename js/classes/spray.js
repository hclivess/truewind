// Spray: the old Delaware Bay oyster sloop Joshua Slocum rebuilt at Fairhaven (1892-95) and sailed alone around the
// world, 1895-98 — the first single-handed circumnavigation. As she finished the voyage: a yawl, the gaff main on the
// sloop's shortened mast, a jib on the (shortened) bowsprit and a small jigger on a mast stepped on the stern.
// Sources: J. Slocum, "Sailing Alone Around the World" (1900) and its appendix (36 ft 9 in over all, 14 ft 2 in wide,
// 4 ft 2 in deep in the hold, 9 tons net / 12.70 tons gross; boom shortened ~4 ft at Pernambuco; mast shortened 7 ft
// and bowsprit ~5 ft at Buenos Aires; the jigger added in the Strait of Magellan, 'merely a temporary affair'; cement
// ballast stanchioned down, three tons of it later exchanged for tridacna shells); Wikipedia "Spray (sailing
// vessel)"; H. I. Chapelle's lines of Spray (Smithsonian, "American Small Sailing Craft", 1951). Not published
// with the dimensions, so estimated here (and marked so): LWL ~33 ft (10.2 m), draft ~4 ft 2 in (1.27 m),
// displacement ~15 t, sail areas (main ~58 m², jib ~22 m², jigger ~6 m²) from the sail plan in the appendix.
// Lines shaped to Chapelle's plan: a broad, shallow, hard-bilged hull, a straight keel, a raked stem with a clipper
// head, a broad square stern with the rudder hung outboard, low bulwarks.
// Line handling on the real boat: everything belayed to pins and cleats — jib sheets to cleats on the rail, the
// mainsheet to a horse across the stern (Slocum lashed the helm and let her steer herself), throat and peak
// halyards hauled by hand and belayed at the mast, the jigger sheet to its boomkin, reefing by tying points.
import { DEG, HP, rrTable, massProps } from './util.js';

const LWL = 10.2, M = 15000, BAL = 3000;
const MP = massProps([{ m: M - BAL - 600, z: 0.4, ry: 1.5, rx: 2.9 }, { m: BAL, z: -0.55, ry: 0.6, rx: 2.0 }, { m: 600, z: 5.5, rz: 3.2 }]);
export default {
  id: 'spray', name: "Slocum's Spray", group: 'classic',
  blurb: "The rebuilt oyster sloop in which Joshua Slocum sailed alone round the world, 1895-98 — the first to do it. Beamy, shallow, heavy, with a long straight keel; gaff main, jib on a long bowsprit, and the little jigger he added in Patagonia. Balanced so well she steered herself for thousands of miles.",
  specs: 'LOA 11.20 m · Beam 4.32 m · Depth of hold 1.27 m · 12.7 tons gross · ~15 t displacement (est.) · Gaff yawl ~86 m² (est.)',
  lwl: LWL, loa: 11.2, beam: 4.32, bowX: 5.8, sternX: -5.4, freeboard: 1.05, canoeDraft: 0.7, wetted: 45, draft: 1.3,
  bowsprit: 3.0, cabin: true, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 1, crewEach: 80, crewZ: 1.2, crewMaxOut: 1.5, crewLee: -1.0, hikeRate: 0.4,
  gm: 1.5, bmForm: 1.2, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.09, amY: 1.0, amYaw: 0.7, amRoll: 0.35,
  rr: rrTable(LWL, M + 80, { prism: -0.12 }),
  // (a long keel is part of the lines: its skin friction is in the hull's, so the foil keeps only its form drag)
  keel: { x: 0.1, z: -0.9, area: 5.2, ARe: 0.75, stall: 28 * DEG, cd0: 0.003, span: 0.6, chord: 8.5, long: true },
  rudder: { x: -5.55, z: -0.5, area: 1.25, ARe: 1.8, stall: 22 * DEG, cd0: 0.015, max: 35 * DEG, span: 1.4, chord: 0.95, transom: true, loadRef: 3000 },
  hullLat: { area: 4.5, cd: 0.9, z: -0.3 },
  windage: { area: 8.5, z: 2.8, cd: 1.0 },
  mastX: 2.3, mastHeight: 11.4, boomZ: 2.3, mastR: 0.13, keelBulb: false,
  targetHeel: 12 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 1800, reefTime: 110,
  cloth: 'canvas',
  engine: null,                     // (none: Slocum sailed her everywhere, and sculled her in calms)
  sails: [
    { key: 'main', kind: 'boom', rig: 'gaff', area: 58, luff: 6.4, foot: 8.2, head: 5.0, headRise: 3.4, roach: 0,
      depth: [0.13, 0.14, 0.13], twistMax: 26 * DEG, cd0: 0.08, ARe: 2.2, min: 3 * DEG, max: 80 * DEG, trav: [-3 * DEG, 8 * DEG], Iboom: 900, boomMass: 90, reefs: 2,
      vangBend: 0, sheetBend: 0, color: 0xece2c8, pockets: [], battens: { EI: 0, rows: [] }, boomMat: 'wood', gaffR: 0.07, boomR: 0.09, boomRound: true },
    { key: 'jib', kind: 'loose', area: 22, tackX: 8.7, tackZ: 1.85, luff: 7.6, foot: 4.8, head: 0.06, footRise: 0.5,
      depth: [0.12, 0.13, 0.11], cd0: 0.05, ARe: 3.0, min: 12 * DEG, max: 55 * DEG, sagK: 1.8, color: 0xece2c8, window: false },
    { key: 'mizzen', kind: 'boom', mast: { h: 7.0, r: 0.07 }, area: 6, tackX: -5.15, tackZ: 2.0, luff: 4.7, foot: 2.5, head: 0.1, rake: 0,
      depth: [0.12, 0.13, 0.12], twistMax: 18 * DEG, cd0: 0.07, ARe: 2.6, min: 3 * DEG, max: 80 * DEG, trav: null, Iboom: 20, boomMass: 12, roach: 0,
      color: 0xece2c8, boomMat: 'wood', boomRound: true, pockets: [], battens: { EI: 0, rows: [] } },
  ],
  hull: { color: 0xf1ede2, stripe: 0x2a2a2a, deck: 0xc9a878, boot: 0x7a2a1c, bootTop: 0x2a2a2a, levels: [0.12, 0.2, 0.06, 0.0], rough: 0.5 },
  sailcloth: { cloth: 0xe8dcc0, kind: 'dacron', mottle: false, num: '#3a2a1a', logo: '#3a2a1a', trans: 0.3, rough: 0.78 },
  insignia: '',
  lines: {
    sheer: [[0, 1.45], [0.25, 1.2], [0.55, 1.12], [0.8, 1.3], [1, 1.75]],
    deck: [[0, 0.72], [0.12, 0.86], [0.4, 1.0], [0.65, 0.97], [0.85, 0.72], [0.96, 0.3], [1, 0.03]],
    wl: [[0, 0.62], [0.15, 0.8], [0.45, 0.95], [0.75, 0.86], [0.92, 0.5], [1, 0.2]],
    keel: [[0, 0.55], [0.06, 0.05], [0.13, -0.38], [0.35, -0.62], [0.65, -0.62], [0.8, -0.5], [0.9, -0.2], [0.95, 0.15], [0.985, 0.8], [1, 1.35]],
    fin: [[0.01, -0.8], [0.06, -1.25], [0.5, -1.3], [0.78, -1.22], [0.88, -0.8], [0.94, -0.25]], finW: 0.2,
    bilge: [[0, 3.2], [0.45, 3.2], [0.85, 2.2], [1, 1.6]], dead: [[0, 0.2], [0.45, 0.2], [0.9, 0.5]], flare: 0.65,
    crown: 0.07, transomRake: 0.35, stemX: 0.6,
  },
  model: {
    cockpit: { t0: 0.07, t1: 0.16, w: 0.45, sole: 0.95, seats: false, coaming: 0.12, coamingMat: 'teak' },
    deck: 'teak', toerail: { bulwark: 0.3, cap: 'teak', color: 0xf1ede2 }, bronze: true, cleats: false,
    cabins: [
      { t0: 0.17, t1: 0.52, h: [[0.17, 0.62], [0.52, 0.62]], w: [[0.17, 1.2], [0.52, 1.25]], slope: 0.02, camber: 0.1, frontRake: 0.02, aftRake: 0.02,
        color: 0xe4d8b6, roof: 'paint', roofColor: 0xd9ccaa, eyebrow: 'teak', trim: 'teak',
        windows: [{ kind: 'port', t0: 0.22, t1: 0.47, n: 4, r: 0.08, zf: 0.52, mat: 'bronze' }], companion: { w: 0.62, mat: 'teak' },
        hatches: [{ t: 0.22, w: 0.66, l: 0.6, kind: 'slide' }, { t: 0.42, w: 0.6, l: 0.6 }] },
      { t0: 0.72, t1: 0.8, h: [[0.72, 0.5], [0.8, 0.5]], w: [[0.72, 0.62], [0.8, 0.55]], slope: 0.02, camber: 0.08, color: 0xe4d8b6, roof: 'paint', roofColor: 0xd9ccaa, trim: 'teak',
        windows: [{ kind: 'port', t0: 0.74, t1: 0.78, n: 1, r: 0.06, zf: 0.5, mat: 'bronze' }], hatches: [{ t: 0.76, w: 0.5, l: 0.45, kind: 'slide' }] },
    ],
    steering: { kind: 'tiller', len: 1.7, rise: 0.12, mat: 'wood', r: 0.04 },
    rudder: { kind: 'transom', x: -5.5, top: 1.55, bottom: -1.3, chordTop: 0.5, heel: 0.3, lean: 0.28, mat: 'wood', thick: 0.08, pintles: [-1.0, -0.2, 0.6, 1.3] },
    keel: { kind: 'full' },
    bowsprit: { len: 3.0, kind: 'pole', mat: 'wood', r: 0.11, steeve: 0.35, inboard: 1.4, bobZ: 0.05 },
    bumpkin: { len: 1.4, dz: 0.15, mat: 'wood', r: 0.05 },
    masts: {
      main: { mat: 'wood', r: 0.13, rTop: 0.085, round: true, spreaders: [], crosstrees: { f: 0.82, len: 0.55 }, deadeyes: true, ratlines: true, hounds: 10.6, chainIn: 1.0, lowerX: [0.5, -0.4] },
      mizzen: { mat: 'wood', r: 0.07, rTop: 0.05, round: true, spreaders: [], hounds: 6.6, stayTo: -6.7, stayToZ: 1.7 },
    },
    backstay: false, windex: false, noNumber: true, hullName: { text: 'SPRAY', t: 0.9, z: 1.2, len: 1.1, color: '#1e1e1e' },
    extras: ['sprayDetails'],
  },
  hw: { trav: [-5.1, 1.2], boomS: 0.97, winch: [-3.6, 1.75], jibTrack: [0.8, -0.8, 1.9], helm: 'Tiller', bronze: true, winchR: 0.06 },
};
