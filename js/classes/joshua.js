// Joshua: Bernard Moitessier's steel ketch (Jean Knocker, built by Jean Fricaud, Chauffailles, launched 1962), in
// which he sailed Tahiti - Cape Horn - Alicante non-stop (1966) and, in the 1968-69 Golden Globe, one and a half
// times round the world, 37,455 miles, 'La Longue Route'. Now at the Musée Maritime de La Rochelle, a monument
// historique.
// Sources: Wikipédia "Joshua (ketch)" (hull 12.07 m, 14 m over the bowsprit, beam 3.68 m, draft 1.60 m,
// displacement 14 t, sail area 100 m², Bermudan ketch, masts 15 m and 7 m, steel); Musée Maritime de La Rochelle;
// B. Moitessier, "La Longue Route" (1971) (Knocker's brief: good windward ability, shallow draft, a Norwegian stern,
// a Bermudan ketch, an outboard rudder to take a self-steering gear; solid 'telegraph pole' masts; the small steel
// doghouse with its round ports at the companionway; no engine aboard on the Long Way). The sail split (main ~30,
// mizzen ~12, staysail ~17, jib ~28 m²) and ballast (~4.5 t internal), LWL (~10.5 m) are estimates from photographs and the total.
// Lines shaped to the dimensions and photographs: a raked stem with the bowsprit, moderate sheer, a canoe stern with
// the rudder hung outboard on the sternpost, a long keel.
// Line handling on the real boat: sheets and halyards to bronze winches on the deck and the masts, belayed to
// cleats; the mainsheet and mizzen sheet on tackles to horses on deck; the staysail on its club; the helm a tiller
// lashed to the wind-vane gear aft.
import { DEG, rrTable, massProps } from './util.js';

const LWL = 10.5, M = 14000, BAL = 4500;
const MP = massProps([{ m: M - BAL - 550, z: 0.35, ry: 1.25, rx: 2.9 }, { m: BAL, z: -1.05, ry: 0.2, rx: 1.4 }, { m: 550, z: 6.4, rz: 3.8 }]);
export default {
  id: 'joshua', name: "Moitessier's Joshua", group: 'classic',
  blurb: "Bernard Moitessier's red steel ketch: 12 m, 14 tonnes, a canoe stern with the rudder outboard for the wind-vane, telegraph-pole masts, a bowsprit, and the little doghouse with its round ports. In 1968-69 she sailed one and a half times round the world — and he kept going rather than finish the race.",
  specs: 'Hull 12.07 m (14 m with bowsprit) · Beam 3.68 m · Draft 1.60 m · 14 t · Ketch ~87 m² working sails (100 m² quoted)',
  lwl: LWL, loa: 12.07, beam: 3.68, bowX: 6.05, sternX: -6.02, freeboard: 1.1, canoeDraft: 0.72, wetted: 40, draft: 1.6,
  bowsprit: 1.9, cabin: true, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 1, crewEach: 80, crewZ: 1.2, crewMaxOut: 1.3, crewLee: -0.9, hikeRate: 0.4,
  gm: 1.3, bmForm: 1.0, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.08, amY: 0.95, amYaw: 0.65, amRoll: 0.33,
  rr: rrTable(LWL, M + 80, { prism: -0.04 }),
  keel: { x: 0.2, z: -1.1, area: 4.6, ARe: 1.0, stall: 26 * DEG, cd0: 0.013, span: 0.88, chord: 5.4, long: true },
  rudder: { x: -6.12, z: -0.7, area: 1.0, ARe: 2.0, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 1.5, chord: 0.72, transom: true, loadRef: 2800 },
  hullLat: { area: 4.0, cd: 0.9, z: -0.3 },
  windage: { area: 12.5, z: 2.9, cd: 1.0 },
  mastX: 1.55, mastHeight: 15.0, boomZ: 2.55, mastR: 0.11, keelBulb: false,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 2200, reefTime: 90,
  engine: null,                     // (sailed without an engine on the Long Way, 1968-69)
  sails: [
    { key: 'main', kind: 'boom', area: 30, luff: 11.3, foot: 4.6, head: 0.14, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG, roach: 0.04,
      cd0: 0.07, ARe: 4.0, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 9 * DEG], Iboom: 300, boomMass: 40, reefs: 2,
      vangBend: 0.02, sheetBend: 0.02, color: 0xf1ede2, boomMat: 'white', pockets: [[0.3, 0.12], [0.55, 0.14], [0.8, 0.12]] },
    { key: 'stay', kind: 'boom', selfTacking: true, area: 17, tackX: 4.55, tackZ: 1.95, luff: 10.3, foot: 3.25, head: 0.05,
      depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.4, min: 5 * DEG, max: 55 * DEG, Iboom: 40, boomMass: 14, color: 0xf1ede2, boomMat: 'white' },
    { key: 'jib', kind: 'loose', area: 28, tackX: 7.9, tackZ: 2.2, luff: 12.3, foot: 5.1, head: 0.05, footRise: 0.9,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.7, min: 12 * DEG, max: 55 * DEG, sagK: 1.6, color: 0xf1ede2, window: false },
    { key: 'mizzen', kind: 'boom', mast: { h: 9.4, r: 0.08 }, area: 12, tackX: -3.45, tackZ: 2.45, luff: 6.4, foot: 3.6, head: 0.1, rake: 0,
      depth: [0.12, 0.14, 0.13], twistMax: 18 * DEG, cd0: 0.07, ARe: 3.2, min: 3 * DEG, max: 80 * DEG, trav: null, Iboom: 60, boomMass: 18,
      color: 0xf1ede2, boomMat: 'white', pockets: [[0.35, 0.12], [0.65, 0.12]] },
  ],
  hull: { color: 0xb3241c, stripe: 0xf2efe6, deck: 0xe6e2d6, boot: 0x1e1f22, bootTop: 0xf2efe6, levels: [0.1, 0.17, 0.05, 0.0], rough: 0.45 },
  sailcloth: { cloth: 0xf1ede2, kind: 'dacron', num: '#1e1f22', logo: '#b3241c', trans: 0.28, rough: 0.66 },
  insignia: '',
  lines: {
    sheer: [[0, 1.3], [0.25, 1.1], [0.55, 1.05], [0.8, 1.2], [1, 1.5]],
    deck: [[0, 0.02], [0.05, 0.32], [0.2, 0.78], [0.45, 1.0], [0.65, 0.95], [0.85, 0.66], [0.96, 0.26], [1, 0.03]],
    wl: [[0, 0.4], [0.1, 0.6], [0.45, 0.9], [0.8, 0.74], [1, 0.3]],
    keel: [[0, 0.66], [0.045, 0.2], [0.11, -0.33], [0.3, -0.72], [0.6, -0.74], [0.82, -0.45], [0.915, 0.05], [0.96, 0.45], [1, 1.2]],
    fin: [[0.005, -1.0], [0.06, -1.5], [0.5, -1.6], [0.72, -1.35], [0.83, -0.8], [0.89, -0.3]], finW: 0.2,
    bilge: [[0, 2.4], [0.45, 3.0], [0.9, 2.0]], dead: [[0, 0.45], [0.45, 0.35], [0.9, 0.6]], flare: 0.75,
    crown: 0.06, transomRake: 0, stemX: 0.1,
  },
  model: {
    cockpit: { t0: 0.1, t1: 0.26, w: 0.5, sole: 0.8, seats: true, seat: 0.36, seatW: 0.34, coaming: 0.2, color: 0xe6e2d6 },
    deck: 'paint', deckColor: 0xdcd6c6, toerail: { bulwark: 0.12, cap: 'paint', capColor: 0xb3241c, color: 0xb3241c },
    cabins: [
      { t0: 0.29, t1: 0.66, h: [[0.29, 0.42], [0.66, 0.36]], w: [[0.29, 1.12], [0.55, 1.1], [0.66, 0.9]], slope: 0.05, camber: 0.08, frontRake: 0.1, aftRake: 0.03,
        color: 0xf0ede4, roof: 'paint', roofColor: 0xdcd6c6,
        windows: [{ kind: 'port', t0: 0.4, t1: 0.62, n: 4, r: 0.07, zf: 0.5 }], hatches: [{ t: 0.6, w: 0.55, l: 0.55 }], handrails: true, trim: 'steel' },
      // the doghouse at the companionway: a small steel turret with round ports all round (Moitessier's 'kiosque')
      { t0: 0.27, t1: 0.35, h: [[0.27, 0.95], [0.35, 0.95]], w: [[0.27, 0.46], [0.35, 0.46]], slope: 0.02, camber: 0.2, round: true, frontRake: 0.28, aftRake: 0.28,
        color: 0xf0ede4, roof: 'paint', roofColor: 0xf0ede4, windows: [{ kind: 'port', t0: 0.29, t1: 0.33, n: 2, r: 0.075, zf: 0.62 }] },
    ],
    steering: { kind: 'tiller', len: 1.5, rise: 0.12, mat: 'wood', r: 0.035 },
    rudder: { kind: 'transom', x: -6.1, top: 1.35, bottom: -1.55, chordTop: 0.35, heel: 0.3, lean: 0.12, mat: 'hull', thick: 0.05, pintles: [-1.2, -0.4, 0.4, 1.1] },
    keel: { kind: 'full' },
    bowsprit: { len: 1.9, kind: 'pole', mat: 'steel', r: 0.07, steeve: 0.12, inboard: 0.8, bobZ: 0.1 },
    masts: {
      main: { mat: 'white', r: 0.11, rTop: 0.07, round: true, spreaders: [{ f: 0.55, len: 0.95, sweep: 0 }], ratlines: true, chainIn: 1.0 },
      mizzen: { mat: 'white', r: 0.08, rTop: 0.055, round: true, spreaders: [{ f: 0.55, len: 0.6, sweep: 0 }], stayTo: -6.25, stayToZ: 1.5, triatic: 13.8 },
    },
    backstay: false, windex: false, noNumber: true,
    extras: ['joshuaDetails'],
  },
  hw: { trav: [-1.4, 0.7], boomS: 0.6, winch: [-4.2, 1.2], jibTrack: [1.4, 0.2, 1.6], helm: 'Tiller', winchR: 0.07, bronze: true },
};
