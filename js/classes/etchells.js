// Etchells (E22; Skip Etchells, 1966): the long, lean, three-man keelboat one-design, sailed hard in big fleets
// from Sydney to Hong Kong to Long Island Sound.
// Sources: Wikipedia "Etchells (keelboat)" / sailboatdata.com (LOA 30.50 ft, LWL 22.00 ft, beam 7.00 ft, draft
// 4.50 ft, displacement 3,325 lb, ballast 2,175 lb lead, I 27.60 ft, J 8.00, P 32.50, E 11.50, main 186.9 sq ft,
// jib 110.4 sq ft, fractional sloop, fin keel, skeg-mounted rudder); International Etchells Class rules (crew 3,
// maximum 285 kg; the spinnaker's area here, ~37 m², is an estimate from the class sail plan); PHRF ~138 (US).
// Lines shaped to the dimensions and photographs: long overhangs, a narrow flat-sheered hull, a long shallow fin
// keel, the rudder on a small skeg well aft.
// Line handling on the real boat: mainsheet to a floor block on the cockpit centreline with a fine tune (no
// traveller track: the class uses a 'bridle'), jib sheets to cleats on the cockpit sides via tracks and in-haulers
// (no winches), backstay on a cascade to both sides, Cunningham, vang and outhaul led aft either side; spinnaker
// halyard, sheets and guys on cam cleats with twings; pole on a topping lift / downhaul.
import { DEG, FT, LB, SQFT, rrTable, massProps } from './util.js';

const LWL = 22 * FT, M = 3325 * LB, BAL = 2175 * LB;
const MP = massProps([{ m: M - BAL - 45, z: 0.35, ry: 0.72, rx: 2.3 }, { m: BAL, z: -0.95, ry: 0.06, rx: 0.9 }, { m: 45, z: 6.0, rz: 3.2 }]);
export default {
  id: 'etchells', name: 'Etchells', group: 'keelboat',
  blurb: "Skip Etchells's 1966 Olympic-trials design, now one of the hottest keelboat fleets in the world: 30 ft of narrow, low hull on a 22 ft waterline, a long lead fin, fractional rig with a big main, and three crew hiking hard. Points like a knife.",
  specs: 'LOA 9.30 m · LWL 6.71 m · Beam 2.13 m · Draft 1.37 m · 1,508 kg · 987 kg lead · Main 17.4 m² · Jib 10.3 m² · Spinnaker ~37 m²',
  lwl: LWL, loa: 30.5 * FT, beam: 7 * FT, bowX: 4.45, sternX: -4.85, freeboard: 0.7, canoeDraft: 0.36, wetted: 15, draft: 4.5 * FT,
  massHull: M, zG: MP.zG, crewN: 3, crewEach: 90, crewZ: 0.72, crewMaxOut: 0.95, crewLee: -0.3, hikeRate: 0.6,
  gm: 0.9, bmForm: 0.55, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.05, amY: 0.75, amYaw: 0.5, amRoll: 0.28,
  rr: rrTable(LWL, M + 270, { prism: 0.12, planing: 0.2 }),
  keel: { x: 0.45, z: -0.85, area: 1.25, ARe: 2.1, stall: 17 * DEG, cd0: 0.01, span: 1.0, chord: 1.6 },
  rudder: { x: -2.75, z: -0.7, area: 0.34, ARe: 2.6, stall: 18 * DEG, cd0: 0.011, max: 34 * DEG, span: 0.8, chord: 0.42, loadRef: 900 },
  hullLat: { area: 1.2, cd: 0.9, z: -0.14 },
  windage: { area: 2.7, z: 1.7, cd: 0.95 },
  mastX: 2.05, mastHeight: 11.55, boomZ: 1.4, mastR: 0.055, keelBulb: false,
  targetHeel: 22 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1000,
  engine: null,
  sails: [
    { key: 'main', kind: 'boom', area: 186.9 * SQFT, luff: 32.5 * FT, foot: 11.5 * FT, head: 0.18, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 5.0, min: 1.5 * DEG, max: 80 * DEG, trav: [-4 * DEG, 11 * DEG], Iboom: 40, boomMass: 10, reefs: 0,
      vangBend: 0.2, sheetBend: 0.15, color: 0xeef0ee, pockets: [[0.2, 0.22], [0.42, 0.26], [0.64, 0.26], [0.86, 0.22]] },
    { key: 'jib', kind: 'loose', area: 110.4 * SQFT, tackX: 4.12, tackZ: 0.82, luff: 8.3, foot: 2.6, head: 0.05, footRise: 0.12,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.5, min: 8 * DEG, max: 42 * DEG, sagK: 1.0, color: 0xeef0ee },
    { key: 'gennaker', kind: 'spin', pole: 2.44, area: 37, tackX: 4.12, tackZ: 1.0, luff: 8.4, rake: 2.07, fixedRake: true, foot: 5.0, head: 0.45,
      depth: [0.2, 0.22, 0.2], cd0: 0.1, ARe: 1.8, min: 18 * DEG, max: 100 * DEG, color: 0xe8e8e2 },
  ],
  hull: { color: 0xf4f5f3, stripe: 0x9a1f2a, deck: 0xe8e8e2, boot: 0x9a1f2a, bootTop: 0x9a1f2a, levels: [0.03, 0.06, 0.04, 0.025] },
  sailcloth: { cloth: 0xeef0ee, kind: 'laminate', num: '#16233a', logo: '#9a1f2a', trans: 0.18, rough: 0.42 },
  insignia: 'E',
  lines: {
    sheer: [[0, 0.62], [0.3, 0.62], [0.6, 0.66], [0.85, 0.74], [1, 0.84]],
    deck: [[0, 0.42], [0.12, 0.65], [0.35, 0.95], [0.52, 1.0], [0.7, 0.9], [0.86, 0.58], [0.96, 0.2], [1, 0.02]],
    wl: [[0, 0.3], [0.2, 0.6], [0.5, 0.85], [0.8, 0.62], [1, 0.2]],
    keel: [[0, 0.36], [0.07, 0.2], [0.14, 0.0], [0.3, -0.26], [0.52, -0.36], [0.7, -0.3], [0.84, -0.08], [0.9, 0.12], [1, 0.72]],
    bilge: [[0, 1.8], [0.5, 2.2], [1, 1.6]], dead: [[0, 0.4], [0.5, 0.5], [1, 0.75]], flare: 0.75, crown: 0.05, transomRake: 0.2,
  },
  model: {
    cockpit: { t0: 0.2, t1: 0.6, w: 0.66, sole: 0.3, seats: false, coaming: 0.06 },
    deck: 'nonskid', deckTint: '#e8e8e2', toerail: 'alu', navLights: false,
    cabins: [{ t0: 0.6, t1: 0.7, h: [[0.6, 0.12], [0.7, 0.04]], w: [[0.6, 0.56], [0.7, 0.45]], slope: 0.04, camber: 0.04, frontRake: 0.3, aftRake: 0.02, color: 0xe8e8e2, roof: 'same' }],
    steering: { kind: 'tiller', len: 1.2, rise: 0.08, mat: 'alu', extension: 1.1 },
    rudder: { kind: 'skeg', color: 0x9a1f2a, thick: 0.1, skegChord: 0.3 },
    keel: { kind: 'fin', chord: 1.95, taper: 0.7, sweep: 0.55, thick: 0.12, color: 0x9a1f2a },
    masts: { main: { mat: 'alu', r: 0.055, spreaders: [{ f: 0.42, len: 0.6, sweep: 18 * DEG }], hounds: 9.35 } },
    backstay: { split: false, x: -4.8, z: 0.84 },
  },
  hw: { trav: [-0.4, 0.25, 0.36], boomS: 0.55, winch: [-0.9, 0.78], jibTrack: [1.4, 0.8, 0.5], helm: 'Tiller extension' },
  noWinches: true,
};
