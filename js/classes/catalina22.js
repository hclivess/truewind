// Catalina 22 (Frank Butler, 1969; original swing-keel model). The most built trailer sailer in North America.
// Sources: sailboatdata.com "Catalina 22" (LOA 21.50 ft, LWL 19.33 ft, beam 7.67 ft, draft 5.00 / 1.67 ft keel
// down / up, displacement 2,490 lb, ballast 550 lb cast iron swing keel (Wikipedia's infobox gives 450, its text
// 800 incl. the keel's stub: the plate itself is quoted by Catalina as 550 lb), I 25.83 ft, J 8.00, P 21.00,
// E 9.66, main 101.4 sq ft, foretriangle 103.3, masthead sloop, transom-hung kick-up rudder, outboard);
// PHRF ~270 (US average, Wikipedia / US Sailing); Catalina 22 National Sailing Association class rules.
// Lines shaped to those dimensions and to photographs of the boat: short overhangs, a near-plumb
// transom with the outboard bracket, a raked stem, flat-ish sections aft with a firm bilge.
// Line handling on the real boat: mainsheet 4:1 from the boom end to a traveller bar across the transom with cam
// cleat on the car; jib sheets to two #8 two-speed-less winches on the cockpit coamings with horn cleats, via
// fairleads on short tracks on the side decks; halyards cleated at the mast (some owners lead them aft to cam
// cleats on the cabin top); swing keel raised by a winch/pennant in the cabin; no vang on the standard boat
// (a simple 4:1 vang is a common add-on), backstay fixed.
import { DEG, FT, LB, SQFT, HP, rrTable } from './util.js';

const LWL = 19.33 * FT, M = 2490 * LB;
export default {
  id: 'catalina22', name: 'Catalina 22', group: 'cruiser',
  blurb: "Frank Butler's 1969 swing-keel trailer sailor — more than 15,000 built. Masthead sloop, 110% jib, cast iron swing keel you wind up to trailer her, kick-up rudder on the transom and a 6 hp outboard on its bracket. Forgiving, roomy, and slower than it looks.",
  specs: 'LOA 6.55 m · LWL 5.89 m · Beam 2.34 m · Draft 1.52 / 0.51 m · 1,129 kg · 249 kg iron swing keel · Main 9.4 m² · Jib (110%) 10.5 m²',
  lwl: LWL, loa: 21.5 * FT, beam: 7.67 * FT, bowX: 3.33, sternX: -3.22, freeboard: 0.78, canoeDraft: 0.36, wetted: 10.6, draft: 5.0 * FT,
  massHull: M, zG: 0.12, crewN: 3, crewEach: 80, crewZ: 0.75, crewMaxOut: 0.95, crewLee: -0.45, hikeRate: 0.55,
  gm: 0.9, bmForm: 0.65, Ixx: 1500, Izz: 3200, amX: 0.06, amY: 0.75, amYaw: 0.5, amRoll: 0.28,
  rr: rrTable(LWL, M + 240),
  // swing keel: a cast iron plate ~1.0 m below the hull, ~0.55 m chord, pivoting down from its trunk (a board to the physics)
  keel: { x: 0.32, z: -0.8, area: 0.52, ARe: 3.0, stall: 15 * DEG, cd0: 0.012, span: 1.0, chord: 0.55, board: true },
  rudder: { x: -3.34, z: -0.35, area: 0.24, ARe: 2.8, stall: 16 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.85, chord: 0.33, transom: true, loadRef: 650 },
  hullLat: { area: 1.0, cd: 0.9, z: -0.12 },
  windage: { area: 3.4, z: 1.9, cd: 0.95 },
  mastX: 0.84, mastHeight: 9.0, boomZ: 2.28, mastR: 0.045, keelBulb: false,
  targetHeel: 18 * DEG, canCapsize: false, hasBackstay: false, hasBoard: true, sheetPower: 800, reefTime: 50,
  // outboard: a 6 hp long-shaft four-stroke on a transom bracket (the class's usual fit: Tohatsu/Honda/Yamaha 6)
  engine: { type: 'outboard', kW: 6 * HP, rpmMax: 5500, gear: 2.33, prop: { D: 0.197, P: 0.165, Z: 3, folding: false, rh: true }, pos: [-3.42, -0.35, -0.45], shaftAngle: 0, tiltable: true },
  sails: [
    { key: 'main', kind: 'boom', area: 101.4 * SQFT, luff: 21.0 * FT, foot: 9.66 * FT, head: 0.12, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
      cd0: 0.07, ARe: 3.4, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 10 * DEG], Iboom: 26, boomMass: 9, reefs: 1,
      vangBend: 0.05, sheetBend: 0.04, color: 0xf3f1ea, pockets: [[0.25, 0.18], [0.5, 0.2], [0.75, 0.18]] },
    { key: 'jib', kind: 'loose', area: 10.5, tackX: 3.26, tackZ: 0.98, luff: 7.6, foot: 2.95, head: 0.05, footRise: 0.45,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.6, min: 12 * DEG, max: 50 * DEG, sagK: 1.4, color: 0xf3f1ea },
  ],
  hull: { color: 0xf4f3ee, stripe: 0x1d4f8c, deck: 0xefece2, boot: 0x1d4f8c, bootTop: 0x1d4f8c, levels: [0.02, 0.07, 0.16, 0.1] },
  sailcloth: { cloth: 0xf3f1ea, kind: 'dacron', num: '#1d3f7a', logo: '#1d3f7a', trans: 0.32, rough: 0.6 },
  insignia: 'C22',
  lines: {
    sheer: [[0, 0.7], [0.25, 0.71], [0.55, 0.76], [0.8, 0.86], [1, 0.97]],
    deck: [[0, 0.78], [0.12, 0.88], [0.4, 1.0], [0.62, 0.95], [0.82, 0.7], [0.94, 0.36], [1, 0.03]],
    wl: [[0, 0.72], [0.4, 0.9], [0.75, 0.86], [0.92, 0.6], [1, 0.3]],
    keel: [[0, 0.03], [0.04, -0.1], [0.2, -0.26], [0.5, -0.34], [0.72, -0.3], [0.86, -0.16], [0.93, 0.05], [0.97, 0.3], [1, 0.75]],
    bilge: [[0, 3.2], [0.5, 2.6], [0.85, 2.0], [1, 1.6]], dead: [[0, 0.1], [0.5, 0.25], [0.85, 0.55], [1, 0.8]], flare: 0.7,
    crown: 0.07, transomRake: 0.12,
  },
  model: {
    cockpit: { t0: 0.03, t1: 0.36, w: 0.64, sole: 0.42, seat: 0.36, seatW: 0.34, coaming: 0.12 },
    deck: 'nonskid', deckTint: '#ecebe3', toerail: 'alu',
    cabins: [{ t0: 0.365, t1: 0.74, h: [[0.36, 0.42], [0.6, 0.42], [0.74, 0.34]], w: [[0.36, 0.84], [0.55, 0.82], [0.66, 0.72], [0.74, 0.55]],
      slope: 0.07, camber: 0.05, frontRake: 0.45, aftRake: 0.05, color: 0xf4f3ee, roof: 'nonskid', roofTint: '#ecebe3',
      windows: [{ kind: 'rect', t0: 0.43, t1: 0.66, zf: 0.58, hf: 0.42, round: 4 }], companion: { w: 0.55 },
      hatches: [{ t: 0.43, w: 0.62, l: 0.62, kind: 'slide' }, { t: 0.7, w: 0.42, l: 0.42 }], handrails: true }],
    lifelines: { t0: 0.07, t1: 0.84, h: 0.55, spacing: 1.2, wires: 1 },
    steering: { kind: 'tiller', len: 1.05, rise: 0.12, mat: 'wood' },
    rudder: { kind: 'transom', top: 0.72, bottom: -0.8, chordTop: 0.2, heel: 0.3, mat: 'white', color: 0xf4f3ee },
    keel: { kind: 'swing', len: 1.05, width: 0.62, thick: 0.035, pivotX: 0.62, upAngle: -1.45 },
    outboard: { y: -0.38, color: 0x2a2c30 },
    masts: { main: { mat: 'alu', r: 0.045, spreaders: [{ f: 0.5, len: 0.62, sweep: 0 }] } },
    backstay: { split: false },
  },
  hw: { trav: [-3.0, 0.62], boomS: 0.96, winch: [-1.35, 0.78], jibTrack: [0.2, -0.45, 0.9], helm: 'Tiller' },
};
