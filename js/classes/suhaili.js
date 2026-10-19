// Suhaili: Robin Knox-Johnston's ketch, built of teak in Bombay (keel laid 1963, launched 19 December 1964) to William
// Atkin's 'Eric' (after Colin Archer's Norwegian rescue boats), in which he won the 1968-69 Sunday Times Golden Globe:
// Falmouth 14 June 1968 to Falmouth 22 April 1969, 30,123 miles in 312 days, the first single-handed non-stop
// circumnavigation. Refitted at Elephant Boatyard on the Hamble 2013-16; she still sails, from Falmouth. Modelled as
// she is now.
// Sources: Wikipedia 'Suhaili' and classicsailboats.org (LOD 32 ft 5 in, LOA over bowsprit and boomkin 44 ft 0 in,
// LWL 28 ft 0 in, beam 11 ft 1 in, draft 5 ft 6 in, 9,876 kg, sail area 665 sq ft, Bermudan ketch, Perkins Prima M50
// fitted 1988); Atkin's 'Eric' plans (atkin.mysticseaport.org: freeboard 4 ft 6 in at the bow, 2 ft 3 3/4 in amidships,
// 3 ft 4 in at the stern; 4,700 lb of keel ballast and 1,200 lb of trimming ballast); Yachting World (the refit; the
// cast-iron keel of 2.25 tons in two pieces on fourteen 2 in bolts; 1 1/4 in teak planking, iron-fastened, refastened
// in bronze; a stainless boomkin); Classic Sailor (2018: 'not fast, she does not go too well to windward, but a
// terrific sea boat'); Clipper race magazine (white topsides, brick-red antifouling).
// Estimates (marked so): the spars (Sparlight alloy masts since the 1989 dismasting: the main ~11.5 m and the mizzen
// ~7.6 m above the deck), the split of the 665 sq ft (main 27.9, mizzen 10.2, staysail 10.5, jib 13.2 m^2), the mast
// positions (Atkin's plan proportions), the bowsprit (2.1 m) and boomkin (1.4 m) outboard, the boot top's colour
// (dark blue), the deck gear (small bronze winches for the headsail sheets, the rest on cleats).
// Line handling: headsail sheets to bronze top-action winches on the cockpit coamings, belayed on cleats; mainsheet
// and mizzen sheet on tackles; halyards on cleats at the masts; the helm a tiller.
import { clarkeMunkK, DEG, HP, rrTable, massProps } from './util.js';

const LWL = 8.53, M = 9876, BAL = 2286, TRIM = 545;
const MP = massProps([{ m: M - BAL - TRIM - 260, z: 0.3, ry: 1.15, rx: 2.4 }, { m: BAL, z: -1.25, ry: 0.15, rx: 1.4 }, { m: TRIM, z: -0.55, ry: 0.4, rx: 1.0 }, { m: 260, z: 6.2, rz: 3.4 }]);
export default {
  id: 'suhaili', name: "Knox-Johnston's Suhaili", group: 'legend',
  blurb: "The 32 ft teak ketch, built in Bombay to William Atkin's Colin Archer–style 'Eric', in which Robin Knox-Johnston sailed alone round the world without stopping in 1968-69 — the first ever, 313 days. Double-ended, full-keeled, heavy, a bowsprit and a boomkin; slow to windward, a terrific sea boat.",
  specs: 'LOD 9.88 m (13.41 m with spars) · LWL 8.53 m · Beam 3.37 m · Draft 1.67 m · 9.9 t · 2.25 t iron keel · Ketch 61.8 m² (665 sq ft)',
  lwl: LWL, loa: 9.88, beam: 3.37, bowX: 4.94, sternX: -4.94, freeboard: 0.95, canoeDraft: 0.7, wetted: 33, draft: 1.67,
  bowsprit: 2.1, cabin: true, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 1, crewEach: 80, crewZ: 1.1, crewMaxOut: 1.3, crewLee: -0.8, hikeRate: 0.4,
  gm: 1.1, bmForm: 0.85, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.08, amY: 0.95, amYaw: 0.65, amRoll: 0.32,
  munkK: clarkeMunkK(LWL, 1.67, M + 80, 0.08, 0.95),   // (the hull's yaw moment at a drift angle, util.js)
  rr: rrTable(LWL, M + 80, { prism: -0.05 }),
  // (the long keel and deadwood as one low-aspect wing, its span the whole draft, as the Westsail's)
  keel: { x: -0.2, z: -0.85, area: 5.6, ARe: 1.0, stall: 26 * DEG, cd0: 0.003, span: 1.67, chord: 4.0, long: true },
  rudder: { x: -5.05, z: -0.65, area: 0.85, ARe: 2.0, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 1.4, chord: 0.65, transom: true, loadRef: 2300 },
  hullLat: { area: 1.2, cd: 0.9, z: -0.2 },
  windage: { area: 6.2, z: 2.7, cd: 1.0 },
  mastX: 1.3, mastHeight: 12.6, boomZ: 2.2, mastR: 0.08, keelBulb: false,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 1900, reefTime: 90,
  // Perkins Prima M50 (fitted 1988): 4-cyl 2.0 L diesel, ~50 hp at 4,000 rpm, est. 2.5:1 box, a 3-blade prop in the
  // aperture between keel and rudder (its wake fraction a long keel's)
  engine: { type: 'inboard', model: 'Perkins Prima M50', kW: 50 * HP, rpmMax: 4000, rpmIdle: 850, cyl: 4, fuel: 'diesel', gear: 2.5, wake: 0.3,
    prop: { D: 0.43, P: 0.3, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-4.55, 0, -0.85], mount: [-2.9, 0, -0.25], mass: 210, inMass: true,
    shaftAngle: 7 * DEG, exhaust: [-4.75, 0.6, 0.4] },
  lines: { main: { handler: 'horn', n: 4, at: 'deck' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    stay: { handler: 'horn', n: 2, at: 'cabin' }, mizzen: { handler: 'horn', n: 3, at: 'deck' }, vang: { handler: 'horn', n: 3, at: 'deck' },
    cunn: { handler: 'horn', n: 1, at: 'mast' }, outhaul: { handler: 'horn', n: 2, at: 'boom' }, jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  ropeStyle: 'classic',
  sails: [
    { key: 'main', kind: 'boom', area: 27.9, luff: 9.6, foot: 5.0, head: 0.14, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG, roach: 0.04,
      cd0: 0.07, ARe: 3.4, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 9 * DEG], Iboom: 260, boomMass: 32, reefs: 2,
      vangBend: 0.02, sheetBend: 0.02, color: 0xf1ebdc, boomMat: 'alu', pockets: [[0.3, 0.12], [0.55, 0.14], [0.8, 0.12]] },
    { key: 'stay', kind: 'boom', selfTacking: true, area: 10.5, tackX: 3.6, tackZ: 1.45, luff: 8.4, foot: 2.6, head: 0.05,
      depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.2, min: 5 * DEG, max: 55 * DEG, Iboom: 25, boomMass: 9, color: 0xf1ebdc, boomMat: 'wood', clubVang: true },
    { key: 'jib', kind: 'loose', area: 13.2, tackX: 6.95, tackZ: 1.6, luff: 9.9, foot: 3.6, head: 0.05, footRise: 0.8,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.6, min: 12 * DEG, max: 55 * DEG, sagK: 1.6, color: 0xf1ebdc, window: false },
    { key: 'mizzen', kind: 'boom', mast: { h: 8.6, r: 0.06 }, area: 10.2, tackX: -2.9, tackZ: 1.95, luff: 6.2, foot: 3.3, head: 0.1, rake: 0,
      depth: [0.12, 0.14, 0.13], twistMax: 18 * DEG, cd0: 0.07, ARe: 3.0, min: 3 * DEG, max: 80 * DEG, trav: null, Iboom: 40, boomMass: 12,
      color: 0xf1ebdc, boomMat: 'alu', pockets: [[0.35, 0.12], [0.65, 0.12]] },
  ],
  hull: { color: 0xf3f2ec, stripe: 0x1d2f55, deck: 0xc9a878, boot: 0xa0402c, bootTop: 0x1d2f55, levels: [0.05, 0.12, 0.0, 0.0], rough: 0.4 },
  cloth: 'dacronCruise',
  sailcloth: { cloth: 0xf1ebdc, kind: 'dacron', num: '#1d2f55', logo: '#1d2f55', trans: 0.28, rough: 0.66 },
  insignia: '',
  offsets: {
    // (Atkin's freeboards: 1.37 m at the stem, 0.71 amidships, 1.02 at the stern: a strong sheer)
    sheer: [[0, 1.02], [0.25, 0.82], [0.5, 0.72], [0.75, 0.86], [1, 1.37]],
    deck: [[0, 0.02], [0.05, 0.3], [0.15, 0.62], [0.3, 0.88], [0.5, 1.0], [0.7, 0.92], [0.86, 0.62], [0.96, 0.26], [1, 0.03]],
    wl: [[0, 0.45], [0.1, 0.58], [0.45, 0.9], [0.8, 0.74], [1, 0.3]],
    keel: [[0, 0.75], [0.06, 0.28], [0.13, -0.28], [0.3, -0.68], [0.6, -0.72], [0.8, -0.45], [0.9, 0.0], [0.95, 0.45], [1, 1.25]],
    fin: [[0.03, -0.6], [0.07, -1.55], [0.5, -1.67], [0.72, -1.4], [0.82, -0.8], [0.88, -0.3]], finW: 0.2,
    bilge: [[0, 1.6], [0.45, 2.1], [0.9, 1.6]], dead: [[0, 0.55], [0.45, 0.42], [0.9, 0.7]], flare: 0.75,
    crown: 0.08, transomRake: 0, tumble: 0.02,
  },
  model: {
    cockpit: { t0: 0.1, t1: 0.27, w: 0.55, sole: 0.6, seat: 0.36, seatW: 0.34, coaming: 0.24, coamingMat: 'teak', seatMat: 'teak' },
    deck: 'teak', toerail: { bulwark: 0.18, cap: 'teak', color: 0xf3f2ec }, bronze: true,
    cabins: [
      // the high cabin trunk and its doghouse aft (Knox-Johnston's own complaint in the Southern Ocean)
      { t0: 0.28, t1: 0.66, h: [[0.28, 0.62], [0.4, 0.6], [0.42, 0.42], [0.66, 0.36]], w: [[0.28, 1.12], [0.55, 1.1], [0.66, 0.88]], slope: 0.05, camber: 0.07,
        frontRake: 0.1, aftRake: 0.03, color: 0xf3f2ec, side: 'teak', roof: 'paint', roofColor: 0xe4dcc6, eyebrow: 'teak', trim: 'teak',
        windows: [{ kind: 'rect', t0: 0.3, t1: 0.39, zf: 0.65, hf: 0.35, round: 5 }, { kind: 'port', t0: 0.45, t1: 0.62, n: 4, r: 0.06, zf: 0.5, mat: 'bronze' }],
        companion: { w: 0.55, mat: 'teak' }, hatches: [{ t: 0.31, w: 0.55, l: 0.5, kind: 'slide' }, { t: 0.6, w: 0.5, l: 0.5 }], handrails: true,
        vents: [{ t: 0.6, kind: 'dorade', y: 0.4 }] },
    ],
    lifelines: { t0: 0.1, t1: 0.9, h: 0.6, pushX: 0.4 },
    steering: { kind: 'tiller', len: 1.4, rise: 0.15, mat: 'wood', dz: 0.02 },
    rudder: { kind: 'transom', x: -5.0, top: 1.25, bottom: -1.5, chordTop: 0.32, heel: 0.25, lean: 0.12, mat: 'wood', thick: 0.06, pintles: [-1.2, -0.5, 0.3, 1.0] },
    keel: { kind: 'full' },
    bowsprit: { len: 2.1, kind: 'pole', mat: 'wood', r: 0.075, steeve: 0.12, inboard: 1.0, bobZ: 0.15 },
    bumpkin: { len: 1.4, dz: 0.12 },
    masts: {
      main: { mat: 'alu', r: 0.08, spreaders: [{ f: 0.55, len: 0.85, sweep: 0 }], chainIn: 1.0 },
      mizzen: { mat: 'alu', r: 0.06, spreaders: [{ f: 0.5, len: 0.6, sweep: 0 }], stayTo: -6.25, stayToZ: 1.25, triatic: 11.9 },
    },
    backstay: false, windex: false, noNumber: true,
  },
  hw: { trav: [-1.6, 0.85], boomS: 0.6, winch: [-3.2, 1.1], jibTrack: [1.2, 0.2, 1.3], helm: 'Tiller', winchR: 0.06, bronze: true },
};
