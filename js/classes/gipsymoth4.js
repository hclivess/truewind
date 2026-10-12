// Gipsy Moth IV: Sir Francis Chichester's ketch (Illingworth & Primrose; Camper & Nicholsons, Gosport, yard no. 916,
// cold-moulded Honduras mahogany, launched March 1966), in which he sailed alone from Plymouth to Sydney (107 days)
// and Sydney to Plymouth round Cape Horn (119 days), 1966-67: the clipper route, one stop. Restored by UKSA (2005, and
// round the world again) and again from 2019; kept at Buckler's Hard. Modelled as she is now.
// Sources: Wikipedia 'Gipsy Moth IV' (LWL 38 ft 6 in, 10.4 t designed, ~11.4 t after trials with about a ton of lead
// added, 854 sq ft working sail, over 1,500 with the spinnaker); National Historic Ships UK, register 2646 (LOA
// 53 ft, beam 10 ft 6 in, air draft 70 ft, one diesel); Sandeman Yacht Company listing (draft 7 ft 9 in, Proctor alloy
// masts overhauled by Allspars 2020, a cutter-rigged ketch with staysail and yankees, roller reefing on the boom,
// Yanmar 4JH4 40 hp, flush deck with a blister deckhouse, a tiller); shipstamps.co.uk (8,490 lb lead keel);
// yacht.de (a white hull); BoatingNZ (Warwick Hood's keel extension in Sydney, under the rudder); Wave Train (the
// rudder hung on the keel, not on a skeg); Chichester, 'Gipsy Moth Circles the World' (tender, 'a crew of three: a
// man to navigate, an elephant to move the tiller and a chimpanzee with arms 8 ft long').
// Estimates (marked so): the masts (main truck 21.0 m above the water from the air draft, mizzen 12.5 m), their
// positions, the split of the 854 sq ft (main 36, mizzen 13, staysail 12, yankee 18 m^2), the freeboard, the deck's
// buff colour and the dark boot top; the Woolmark she wore in 1966-67 is left off (no logos).
// Line handling: headsail sheets to Lewmar winches on the cockpit coamings, the mainsheet on a tackle to a horse
// before the cockpit, the mizzen to its own; halyards on the masts; the wind-vane gear on the stern drives the tiller.
import { DEG, HP, rrTable, massProps } from './util.js';

const LWL = 11.73, M = 11400, BAL = 4900;
const MP = massProps([{ m: M - BAL - 380, z: 0.35, ry: 1.0, rx: 3.6 }, { m: BAL, z: -1.55, ry: 0.15, rx: 1.4 }, { m: 380, z: 9.0, rz: 5.2 }]);
export default {
  id: 'gipsymoth4', name: "Chichester's Gipsy Moth IV", group: 'legend',
  blurb: "The 53 ft ketch Francis Chichester sailed alone round the world by the clipper route in 1966-67, stopping once, at Sydney: 226 days at sea. Long, slim, cold-moulded mahogany, a deep keel with the rudder hung on it, a blister deckhouse and a big tiller. Tender at first — he called her cantankerous — and very fast.",
  specs: 'LOA 16.15 m · LWL 11.73 m · Beam 3.20 m · Draft 2.36 m · ~11.4 t · ~4.9 t lead · Ketch 79.3 m² (854 sq ft) · Yanmar 4JH4',
  lwl: LWL, loa: 16.15, beam: 3.2, bowX: 8.1, sternX: -8.05, freeboard: 1.0, canoeDraft: 0.6, wetted: 38, draft: 2.36,
  cabin: true,
  massHull: M, zG: MP.zG, crewN: 1, crewEach: 80, crewZ: 1.1, crewMaxOut: 1.2, crewLee: -0.8, hikeRate: 0.4,
  gm: 0.9, bmForm: 0.8, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.06, amY: 0.85, amYaw: 0.6, amRoll: 0.3,
  rr: rrTable(12.6, M + 80),
  keel: { x: -0.4, z: -1.35, area: 3.6, ARe: 1.7, stall: 20 * DEG, cd0: 0.008, span: 1.75, chord: 2.8 },
  rudder: { x: -4.6, z: -1.3, area: 0.9, ARe: 2.0, stall: 20 * DEG, cd0: 0.012, max: 33 * DEG, span: 1.5, chord: 0.62, loadRef: 3000 },
  hullLat: { area: 2.2, cd: 0.9, z: -0.2 },
  windage: { area: 8.5, z: 3.2, cd: 0.95 },
  mastX: 1.55, mastHeight: 21.0, boomZ: 2.1, mastR: 0.095, keelBulb: false,
  targetHeel: 20 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 2200, reefTime: 120,
  // Yanmar 4JH4 (40 hp at 3,000 rpm), est. 2.6:1 box, a 3-blade prop on a shaft ahead of the keel-hung rudder
  engine: { type: 'inboard', model: 'Yanmar 4JH4', kW: 40 * HP, rpmMax: 3000, rpmIdle: 800, cyl: 4, fuel: 'diesel', gear: 2.6, wake: 0.2,
    prop: { D: 0.43, P: 0.3, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-4.05, 0, -0.72], mount: [-2.6, 0, -0.2], mass: 205, inMass: true,
    shaftAngle: 9 * DEG, exhaust: [-7.6, 0.5, 0.45] },
  lines: { main: { handler: 'horn', n: 4, at: 'deck' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    stay: { handler: 'winchHorn', n: 1, at: 'cabin' }, mizzen: { handler: 'horn', n: 3, at: 'deck' }, vang: { handler: 'horn', n: 4, at: 'deck' },
    cunn: { handler: 'horn', n: 2, at: 'mast' }, outhaul: { handler: 'horn', n: 2, at: 'boom' },
    jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  sails: [
    { key: 'main', kind: 'boom', area: 36, luff: 16.6, foot: 4.7, head: 0.14, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG, roach: 0.05,
      cd0: 0.07, ARe: 5.2, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 10 * DEG], Iboom: 260, boomMass: 32, reefs: 2,
      vangBend: 0.03, sheetBend: 0.03, color: 0xf3f0e8, boomMat: 'alu', pockets: [[0.25, 0.14], [0.5, 0.16], [0.75, 0.14]] },
    // (the staysail on a club (est.): self-tending, as she was sailed single-handed)
    { key: 'stay', kind: 'boom', selfTacking: true, area: 12, tackX: 5.4, tackZ: 1.45, luff: 13.6, foot: 2.6, head: 0.05,
      depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 4.0, min: 5 * DEG, max: 55 * DEG, Iboom: 30, boomMass: 10, color: 0xf3f0e8, boomMat: 'alu', clubVang: true },
    { key: 'jib', kind: 'loose', label: 'Yankee', area: 18, tackX: 7.95, tackZ: 1.5, luff: 18.0, foot: 4.4, head: 0.05, footRise: 1.4,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.5, min: 10 * DEG, max: 50 * DEG, sagK: 1.3, color: 0xf3f0e8, window: false },
    { key: 'mizzen', kind: 'boom', mast: { h: 12.5, r: 0.07 }, area: 13, tackX: -6.2, tackZ: 2.0, luff: 10.0, foot: 2.6, head: 0.1, rake: 0,
      depth: [0.12, 0.14, 0.13], twistMax: 18 * DEG, cd0: 0.07, ARe: 3.8, min: 3 * DEG, max: 80 * DEG, trav: null, Iboom: 45, boomMass: 12,
      color: 0xf3f0e8, boomMat: 'alu', pockets: [[0.35, 0.12], [0.65, 0.12]] },
  ],
  hull: { color: 0xf4f3ee, stripe: 0x1c2433, deck: 0xd8cdb0, boot: 0x1c2433, bootTop: 0x1c2433, levels: [0.04, 0.1, 0.0, 0.0] },
  cloth: 'dacronCruise',
  sailcloth: { cloth: 0xf3f0e8, kind: 'dacron', num: '#1c2433', logo: '#1c2433', trans: 0.3, rough: 0.62 },
  insignia: '',
  offsets: {
    // (pencil-slim, soft-bilged, long overhangs both ends, a short counter; the deep keel with the rudder on its aft end)
    sheer: [[0, 1.05], [0.25, 0.95], [0.55, 0.95], [0.8, 1.08], [1, 1.32]],
    deck: [[0, 0.5], [0.12, 0.72], [0.32, 0.94], [0.5, 1.0], [0.7, 0.9], [0.85, 0.6], [0.95, 0.24], [1, 0.02]],
    wl: [[0, 0.25], [0.2, 0.62], [0.45, 0.86], [0.72, 0.72], [0.9, 0.32], [1, 0.08]],
    keel: [[0, 0.62], [0.1, 0.2], [0.17, -0.12], [0.35, -0.55], [0.55, -0.62], [0.72, -0.45], [0.85, -0.12], [0.91, 0.12], [1, 0.95]],
    fin: [[0.27, -0.45], [0.29, -2.36], [0.47, -2.36], [0.58, -1.2], [0.64, -0.5]], finW: 0.17,
    bilge: [[0, 1.7], [0.45, 1.8], [0.85, 1.5]], dead: [[0, 0.4], [0.45, 0.5], [0.85, 0.75]], flare: 0.78,
    crown: 0.07, transomRake: 0.35,
  },
  model: {
    cockpit: { t0: 0.17, t1: 0.33, w: 0.48, sole: 0.4, seat: 0.38, seatW: 0.32, coaming: 0.25, coamingMat: 'teak' },
    deck: 'nonskid', deckTint: '#d8cdb0', toerail: 'teak', bronze: false,
    cabins: [
      // the blister deckhouse over the flush deck, its big curved windows forward
      { t0: 0.335, t1: 0.5, h: [[0.335, 0.62], [0.45, 0.6], [0.5, 0.3]], w: [[0.335, 0.92], [0.45, 0.9], [0.5, 0.62]], slope: 0.08, camber: 0.14,
        frontRake: 0.45, aftRake: 0.04, round: true, color: 0xf4f3ee, roof: 'nonskid', roofTint: '#d8cdb0', eyebrow: 'teak', trim: 'teak',
        windows: [{ kind: 'rect', t0: 0.36, t1: 0.47, zf: 0.6, hf: 0.42, round: 14 }], companion: { w: 0.55, mat: 'teak' }, hatches: [{ t: 0.36, w: 0.55, l: 0.5, kind: 'slide' }], handrails: true },
      { t0: 0.66, t1: 0.71, h: [[0.66, 0.18], [0.71, 0.18]], w: [[0.66, 0.4], [0.71, 0.4]], slope: 0.02, camber: 0.04, color: 0xf4f3ee, roof: 'teak', trim: 'teak', windows: [], hatches: [{ t: 0.685, w: 0.55, l: 0.5 }] },
    ],
    lifelines: { t0: 0.08, t1: 0.9, h: 0.62 },
    steering: { kind: 'tiller', len: 1.9, rise: 0.14, mat: 'wood', r: 0.035 },
    rudder: { kind: 'keel', color: 0x1c2433, span: 1.6, thick: 0.1, rootK: 1.0, taper: 0.85, sweep: 0.2 },
    keel: { kind: 'full' },
    masts: {
      main: { mat: 'alu', r: 0.095, spreaders: [{ f: 0.38, len: 0.95, sweep: 0 }, { f: 0.68, len: 0.7, sweep: 0 }] },
      mizzen: { mat: 'alu', r: 0.07, spreaders: [{ f: 0.55, len: 0.6, sweep: 0 }], stayTo: -7.9, stayToZ: 1.2, triatic: 19.6 },
    },
    backstay: false, windex: true, noNumber: true,
    hullName: { text: 'GIPSY MOTH IV', t: 0.07, z: 0.7, len: 2.0, color: '#1c2433', font: '700 64px Georgia, "Times New Roman", serif' },
    extras: ['vaneGear'],
  },
  hw: { trav: [-1.2, 0.7], boomS: 0.6, winch: [-4.0, 1.15], jibTrack: [2.6, 1.0, 1.15], helm: 'Tiller', winchR: 0.07 },
};
