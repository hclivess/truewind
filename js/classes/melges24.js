// Melges 24 (Reichel/Pugh with Melges Performance Sailboats, 1993): the sportboat that made the type: a lifting
// bulb keel, a carbon mast, a retractable bowsprit and a huge asymmetric.
// Sources: Wikipedia "Melges 24" / sailboatdata.com (LOA 24.00 ft, LWL 22.00 ft, beam 8.20 ft, draft 5.00 ft keel
// down, displacement 1,750 lb, ballast 650 lb lead bulb, I 27.85 ft, J 7.95, P 28.90, E 12.45, main 179.9 sq ft,
// jib 110.7 sq ft, asymmetric spinnaker 670 sq ft on a retractable bowsprit, fractional sloop, transom-hung rudder,
// outboard motor; hull speed 6.3 kn; PHRF 75-105); International Melges 24 Class rules (crew weight limit 375 kg,
// 4-5 aboard; the class requires the outboard to be carried). Lines shaped to the dimensions and photographs: a
// near-plumb bow, flat run aft to a wide open transom, hard turn of the bilge.
// Line handling on the real boat: mainsheet 6:1 (with a fine tune) to a swivel cam cleat on the cockpit floor
// (no traveller track: the class uses a 'barney post' and bridle), jib sheets to ratchets and cam cleats on the
// cockpit sides with in-haulers (no winches), spinnaker sheets through ratchet blocks aft to cam cleats, halyards,
// sprit launcher, vang, Cunningham, outhaul and backstay (a cascade) led to cam cleats on the deck either side.
import { DEG, FT, LB, SQFT, HP, rrTable, massProps } from './util.js';

const LWL = 22 * FT, M = 1750 * LB, BAL = 650 * LB;
const MP = massProps([{ m: M - BAL - 35, z: 0.3, ry: 0.9, rx: 1.9 }, { m: BAL, z: -1.35, ry: 0.08, rx: 0.4 }, { m: 35, z: 5.8, rz: 3.0 }]);
export default {
  id: 'melges24', name: 'Melges 24', group: 'keelboat',
  blurb: "Reichel/Pugh's 1993 sportboat: 24 ft, 794 kg, a lead bulb on a lifting fin, carbon mast, and a 62 m² asymmetric on a sprit that pops out of the bow. Five crew hiking over the side; planes off the breeze from about 12 kn.",
  specs: 'LOA 7.32 m · LWL 6.71 m · Beam 2.50 m · Draft 1.52 m · 794 kg · 295 kg lead bulb · Main 16.7 m² · Jib 10.3 m² · Gennaker 62.2 m²',
  lwl: LWL, loa: 24 * FT, beam: 8.2 * FT, bowX: 3.78, sternX: -3.54, freeboard: 0.66, canoeDraft: 0.26, wetted: 11, draft: 5 * FT,
  bowsprit: 1.55,
  massHull: M, zG: MP.zG, crewN: 4, crewEach: 88, crewZ: 0.62, crewMaxOut: 1.15, crewLee: -0.5, hikeRate: 0.6,
  gm: 1.0, bmForm: 0.65, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.05, amY: 0.65, amYaw: 0.4, amRoll: 0.25,
  rr: rrTable(LWL, M + 352, { planing: 1 }),
  keel: { x: 0.75, z: -0.85, area: 0.52, ARe: 5.0, stall: 14 * DEG, cd0: 0.009, span: 1.25, chord: 0.42 },
  rudder: { x: -3.62, z: -0.45, area: 0.24, ARe: 3.6, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.95, chord: 0.27, transom: true, loadRef: 700 },
  hullLat: { area: 1.4, cd: 0.9, z: -0.1 },
  windage: { area: 2.8, z: 2.2, cd: 0.9 },
  mastX: 1.2, mastHeight: 10.55, boomZ: 1.45, mastR: 0.05, keelBulb: true,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1300,
  // outboard: carried aboard by class rule (a 2-4 hp four-stroke, e.g. Tohatsu MFS3.5), shipped on a stern bracket
  engine: { type: 'outboard', model: '3.5 hp four-stroke short shaft', kW: 3.5 * HP, rpmMax: 5500, rpmIdle: 1150, cyl: 1, fuel: 'petrol', gear: 2.15,
    prop: { D: 0.185, P: 0.12, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-3.7, -0.45, -0.3], mount: [-3.6, -0.45, 0.25], mass: 17.4, inMass: true,
    stow: [0.6, 0, -0.1], tilts: true, steers: false, shaftAngle: 0, exhaust: [-3.7, -0.45, 0.1] },
  lines: { main: { handler: 'ratchetCam', n: 6, at: 'sole' }, trav: { handler: 'cam', n: 2, at: 'deck' }, jib: { handler: 'ratchetCam', n: 1, at: 'deck' },
    gen: { handler: 'ratchet', hold: 20, at: 'quarter' }, vang: { handler: 'cam', n: 12, at: 'deck' }, cunn: { handler: 'cam', n: 4, size: 'micro', at: 'deck' },
    outhaul: { handler: 'cam', n: 4, size: 'micro', at: 'deck' }, backstay: { handler: 'cam', n: 16, at: 'deck' }, jibHalyard: { handler: 'clutch', n: 2, at: 'deck' }, tackLine: { handler: 'cam', at: 'deck' } },
  sails: [
    { key: 'main', kind: 'boom', area: 179.9 * SQFT, luff: 28.9 * FT, foot: 12.45 * FT, head: 0.5, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 4.8, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 40, boomMass: 12, reefs: 0,
      vangBend: 0.18, sheetBend: 0.12, color: 0x3b3e44 },
    { key: 'jib', kind: 'loose', area: 110.7 * SQFT, tackX: 3.62, tackZ: 0.72, luff: 8.25, foot: 2.55, head: 0.08, footRise: 0.4,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.3, min: 8.5 * DEG, max: 42 * DEG, sagK: 1.0, color: 0x3b3e44 },
    { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 670 * SQFT, tackX: 5.3, tackZ: 0.78, luff: 9.5, foot: 5.4, head: 0.55, rake: 0.6,
      depth: [0.19, 0.21, 0.19], cd0: 0.09, ARe: 2.2, min: 16 * DEG, max: 100 * DEG, color: 0xe03a2a },
  ],
  hull: { color: 0xf5f6f4, stripe: 0x14305a, deck: 0xdfe1e1, boot: 0x14305a, bootTop: 0x14305a, levels: [0.03, 0.06, 0.06, 0.035] },
  sailcloth: { cloth: 0x3b3e44, kind: 'laminate', num: '#f2f2ee', logo: '#f2f2ee', trans: 0.1, rough: 0.4 },
  insignia: '24',
  offsets: {
    sheer: [[0, 0.58], [0.4, 0.6], [0.75, 0.66], [1, 0.76]],
    deck: [[0, 0.86], [0.15, 0.93], [0.45, 1.0], [0.7, 0.88], [0.88, 0.55], [0.97, 0.18], [1, 0.03]],
    wl: [[0, 0.72], [0.4, 0.86], [0.75, 0.74], [0.93, 0.42], [1, 0.2]],
    keel: [[0, 0.1], [0.04, 0.0], [0.08, -0.08], [0.25, -0.2], [0.5, -0.26], [0.72, -0.2], [0.88, -0.07], [0.95, 0.06], [1, 0.45]],
    bilge: [[0, 4.5], [0.5, 3.0], [1, 1.8]], dead: [[0, 0.08], [0.5, 0.28], [1, 0.75]], flare: 0.85, crown: 0.05, transomRake: 0.02,
  },
  model: {
    cockpit: { t0: 0.0, t1: 0.52, w: 0.72, sole: 0.24, seats: false, coaming: 0 },
    deck: 'nonskid', deckTint: '#dfe1e1', toerail: 'alu', navLights: false,
    cabins: [{ t0: 0.52, t1: 0.72, h: [[0.52, 0.14], [0.72, 0.04]], w: [[0.52, 0.66], [0.72, 0.55]], slope: 0.05, camber: 0.04, frontRake: 0.4, aftRake: 0.03, color: 0xdfe1e1, roof: 'same', hatches: [{ t: 0.56, w: 0.45, l: 0.45 }] }],
    steering: { kind: 'tiller', len: 1.15, rise: 0.08, mat: 'black', extension: 1.2 },
    rudder: { kind: 'transom', top: 0.55, bottom: -1.05, chordTop: 0.22, heel: 0.3, color: 0xf2f2ee, thick: 0.035 },
    keel: { kind: 'fin', chord: 0.45, taper: 0.9, sweep: 0.05, thick: 0.1, mat: 'lead', bulb: { len: 1.35, r: 0.14, fwd: 0.35, flat: 1.3 } },
    bowsprit: { kind: 'retract' },
    masts: { main: { mat: 'carbon', r: 0.05, spreaders: [{ f: 0.35, len: 0.7, sweep: 22 * DEG }, { f: 0.68, len: 0.45, sweep: 22 * DEG }], hounds: 9.05 } },
    backstay: { split: true, splitH: 1.1 },
  },
  hw: { trav: [-0.9, 0.2, 0.3], boomS: 0.55, winch: [-1.2, 0.95], jibTrack: [1.0, 0.4, 0.62], helm: 'Tiller extension' },
  noWinches: true,
};
