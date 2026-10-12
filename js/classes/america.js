// America: the pilot-boat schooner George Steers drew for John Cox Stevens's syndicate, built by William H. Brown,
// New York, 1851, who on 22 August 1851 won the Royal Yacht Squadron's £100 Cup round the Isle of Wight (10 h 34 min
// for ~53 miles, 24 min ahead of Aurora): the Cup that took her name. Modelled as she raced that day.
// Sources: The Lawson History of the America's Cup (1902), which reprints the 1851 Spirit of the Times description,
// the race reports and the sailmaker's figures (archive.org 'lawsonhistoryofa00thom'): 95 ft stem to stern, 80 ft of
// keel, 23 ft beam, 11 ft draft in sailing trim (6 ft forward, 11 ft aft: a strong drag), masts 79 ft 6 in (fore) and
// 81 ft (main) raked 2 1/2 in to the foot (11.8 deg), main boom 58 ft, main gaff 26 ft, fore gaff 24 ft, bowsprit 32 ft
// with a jib-boom; a short and slender main topmast and no fore topmast; the foresail a boomless 'lug foresail'; the
// three lower sails 5,263 sq ft (R. H. Wilson, sailmaker), machine-woven cotton duck cut to set flat; on race day
// mainsail, small main gaff topsail, foresail, fore staysail and flying jib (the jib-boom carried away off Sandown);
// a plain raking stern with a gilt eagle (left off here: no carved ornament is drawn), black topsides from Le Havre,
// copper to 6 in above the waterline, white-oak bulwarks 14 in high, one round skylight, a cockpit aft, steered by a
// tiller. Wikipedia 'America (yacht)' (LOA 101 ft 3 in with the counter's rail, LWL 89 ft 10 in, beam 22 ft 10 in,
// draft 10 ft 11 in); de.wikipedia (170 t); Klaus Kramer's archive (61 t of ballast, inside).
// Estimates (marked so): the heights above the water (the masts' lengths less ~9 ft below deck: the lower mastheads at
// 23.0 m (fore) and 23.3 m (main), the gaffs' throats under them and their peaks no higher than the peak halyards'
// blocks: a gaff is hoisted by halyards from the masthead and cannot be peaked above it), the mast positions (from the published sail plan's proportions), the freeboard (1.35 m), the
// canoe body's depth, the split of the 5,263 sq ft between the three lower sails (from their spars: main 264,
// foresail 146, fore staysail 79 m^2), the topsail (16 m^2, 'small') and flying jib (55 m^2), the ballast's height.
// Line handling as in 1851: no winches; sheets and halyards on tackles, belayed to pins and cleats, the main sheet's
// tackle to its horse on deck, the foresheet to its horse before the mainmast, the headsail sheets to cleats on the rail.
import { clarkeMunkK, DEG, FT, rrTable, massProps } from './util.js';

const LWL = 89.83 * FT, M = 170000, BAL = 61000, RAKE = Math.tan(11.8 * DEG);
// (the hull's own centroid at the waterline (est.): a deep wooden hull, two thirds of its planking, frames and floors
// below the water; the ballast 'stowed in her sides about her water-lines' (Lawson) and low in the hold, ~0.9 m down)
const MP = massProps([{ m: M - BAL - 6500, z: 0.0, ry: 2.4, rx: 8.0 }, { m: BAL, z: -0.9, ry: 1.6, rx: 6.5 }, { m: 6500, z: 11.5, rz: 7.5 }]);
const FX = 6.4, BZ = 2.4;                                     // foremast at the deck (est.), the booms' height
export default {
  id: 'america', name: 'America (1851)', group: 'legend',
  blurb: "The low black schooner that won the Royal Yacht Squadron's Cup round the Isle of Wight in 1851 — the America's Cup. Steers's pilot-boat lines with a long hollow bow and the beam well aft, masts raked 12°, flat-cut cotton sails, a boomless foresail, and a crew of twenty on tackles. No engine, no winches.",
  specs: 'LOD 28.96 m · LWL 27.38 m · Beam 7.0 m · Draft 3.35 m aft · 170 t · 61 t ballast · Lower sails 489 m² (5,263 sq ft) + topsail and flying jib',
  lwl: LWL, loa: 28.96, beam: 7.0, bowX: 14.7, sternX: -14.26, freeboard: 1.35, canoeDraft: 1.7, wetted: 205, draft: 3.35,
  bowsprit: 8.8, cabin: false, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 20, crewEach: 75, crewZ: 1.9, crewMaxOut: 2.6, crewLee: -1.5, hikeRate: 0.3,
  gm: 1.6, bmForm: 2.2, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.07, amY: 0.95, amYaw: 0.7, amRoll: 0.35,
  munkK: clarkeMunkK(LWL, 3.35, M + 1500, 0.07, 0.95),   // (the hull's yaw moment at a drift angle, util.js)
  vppSecs: 150,   // (a big hull's speed settles over a minute or two: the VPP's and the helm test's run)
  rr: rrTable(LWL, M + 1500, { prism: -0.06 }),
  // Balance. The long keel is the hull's lateral plane (span the whole draft, ARe 2 b^2 / A); its lift acts 0.1 chord
  // ahead of the middle of its profile (js/foils.js). The geometric centre of lateral resistance of her profile (6 ft
  // of draft forward, 11 ft aft) is ~1.4 m abaft midships, the working sails' centre of effort ~0.3 m abaft that (est.
  // from the spars): a lead of ~4% LWL. With the hull's yaw moment at Clarke's figure (munkK) and the lift centre at
  // -2.8 m (the deep heel aft carries more of it than the area alone says), she carries ~5 deg of weather helm at her
  // close-hauled angle (55 deg TWA, her best VMG) in 12 kn and ~7 deg pinched at 45 (test/helm.mjs); the rudder on
  // the sternpost 3.1 x 1.5 m (est.)
  keel: { x: -5.0, z: -1.8, area: 46, ARe: 0.5, stall: 28 * DEG, cd0: 0.003, span: 3.2, chord: 22, long: true },
  rudder: { x: -13.4, z: -1.6, area: 4.6, ARe: 1.9, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 3.1, chord: 1.5, loadRef: 30000 },
  hullLat: { area: 10, cd: 0.9, z: -0.5 },
  windage: { area: 34, z: 6.5, cd: 1.0 },
  mastX: -2.71, mastHeight: 27.4, mastRake: (27.4 - BZ) * RAKE, boomZ: BZ, mastR: 0.28, keelBulb: false,
  targetHeel: 18 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 7000, reefTime: 300,
  cloth: 'canvas',
  engine: null,                     // (1851: none)
  lines: { main: { handler: 'horn', n: 4, at: 'deck' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'horn', n: 2, at: 'deck' },
    fore: { handler: 'horn', n: 3, at: 'deck' }, vang: { handler: 'horn', n: 2, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' },
    outhaul: { handler: 'horn', n: 2, at: 'boom' }, jibHalyard: { handler: 'horn', n: 3, at: 'mast' } },
  ropeStyle: 'classic',
  sails: [
    // mainsail: 58 ft boom, 26 ft gaff peaked ~35 deg, the throat under the main cap, laced to the boom; the small
    // gaff topsail over it to the short topmast's truck
    { key: 'main', kind: 'boom', rig: 'gaff', area: 264, luff: 18.0, foot: 16.9, head: 7.4, headRise: 2.8, roach: 0,
      topsail: { luff: 7.0, area: 16, head: 0.2 },
      depth: [0.11, 0.12, 0.11], twistMax: 24 * DEG, cd0: 0.08, ARe: 2.4, min: 3 * DEG, max: 78 * DEG, trav: [-3 * DEG, 8 * DEG], Iboom: 31000, boomMass: 600, reefs: 2,
      vangBend: 0, sheetBend: 0, color: 0xeee6d0, pockets: [], battens: { EI: 0, rows: [] }, boomMat: 'wood', gaffR: 0.12, boomR: 0.2, boomRound: true, ropeK: 4 },
    // the lug foresail: boomless, its clew sheeted to a horse before the mainmast; 24 ft gaff
    { key: 'fore', kind: 'boom', rig: 'gaff', boomless: true, mast: { h: 23.0, r: 0.27, rake: (23.0 - BZ) * RAKE }, area: 146, tackX: FX - (BZ - 1.4) * RAKE, tackZ: BZ,
      luff: 17.0, foot: 8.0, head: 6.6, headRise: 3.3, roach: 0,
      depth: [0.12, 0.13, 0.12], twistMax: 24 * DEG, cd0: 0.08, ARe: 2.2, min: 4 * DEG, max: 62 * DEG, trav: [-4 * DEG, 10 * DEG], Iboom: 900, boomMass: 25,
      color: 0xeee6d0, boomMat: 'wood', gaffR: 0.11, pockets: [], battens: { EI: 0, rows: [] }, ropeK: 3 },
    // fore staysail, tacked at the stem head, set on the forestay to the foremast's hounds
    { key: 'jib', kind: 'loose', label: 'Fore staysail', stayTo: 'fore', area: 79, tackX: 14.6, tackZ: 1.8, luff: 18.0, foot: 8.5, head: 0.12, footRise: 0.5,
      depth: [0.11, 0.12, 0.1], cd0: 0.05, ARe: 3.4, min: 10 * DEG, max: 55 * DEG, sagK: 1.6, color: 0xeee6d0, window: false },
    // flying jib, out on the jib-boom, to the foremast's head
    { key: 'flying', kind: 'loose', label: 'Flying jib', stayTo: 'fore', area: 55, tackX: 23.5, tackZ: 2.4, luff: 19.0, foot: 7.5, head: 0.1, footRise: 1.5,
      depth: [0.11, 0.12, 0.1], cd0: 0.05, ARe: 4.5, min: 9 * DEG, max: 50 * DEG, sagK: 1.8, color: 0xeee6d0, window: false },
  ],
  hull: { color: 0x141518, stripe: 0x141518, deck: 0xd9c49a, boot: 0xb8733f, bootTop: 0xb8733f, levels: [0.15, 0.15, 0.0, 0.0], rough: 0.45 },
  sailcloth: { cloth: 0xeee6d0, kind: 'dacron', mottle: false, num: '#3a2a1a', logo: '#3a2a1a', trans: 0.3, rough: 0.8 },
  insignia: '',
  offsets: {
    sheer: [[0, 1.55], [0.2, 1.4], [0.5, 1.33], [0.8, 1.42], [1, 1.6]],
    deck: [[0, 0.62], [0.12, 0.84], [0.3, 0.97], [0.42, 1.0], [0.6, 0.92], [0.78, 0.7], [0.9, 0.42], [0.97, 0.14], [1, 0.02]],
    wl: [[0, 0.4], [0.15, 0.78], [0.42, 0.93], [0.7, 0.72], [0.88, 0.35], [1, 0.08]],
    keel: [[0, 0.55], [0.03, 0.05], [0.08, -0.85], [0.25, -1.65], [0.5, -1.7], [0.72, -1.3], [0.88, -0.6], [0.965, 0.0], [1, 1.25]],
    fin: [[0.03, -2.9], [0.05, -3.35], [0.4, -2.75], [0.75, -2.15], [0.9, -1.55], [0.955, -0.7]], finW: 0.25,
    bilge: [[0, 2.4], [0.45, 2.3], [0.8, 1.8], [1, 1.4]], dead: [[0, 0.35], [0.45, 0.4], [0.8, 0.65], [1, 0.8]], flare: 0.7,
    crown: 0.1, transomRake: 0.8, stemX: 0.15,
  },
  model: {
    // a flush deck: the cockpit aft (about 30 ft round), the one round skylight, the companion; white-oak bulwarks
    cockpit: { t0: 0.05, t1: 0.15, w: 0.4, sole: 0.6, seats: false, coaming: 0.25, coamingMat: 'teak' },
    deck: 'teak', toerail: { bulwark: 0.36, cap: 'teak', color: 0x141518 }, bronze: true, navLights: false,
    cabins: [
      { t0: 0.36, t1: 0.42, h: [[0.36, 0.42], [0.42, 0.42]], w: [[0.36, 0.6], [0.42, 0.6]], slope: 0.12, camber: 0.18, frontRake: 0.3, aftRake: 0.3, round: true,
        color: 0x6b3a1e, roof: 'paint', roofColor: 0x1a2530, trim: 'teak', windows: [], hatches: [] },
      { t0: 0.2, t1: 0.25, h: [[0.2, 0.4], [0.25, 0.4]], w: [[0.2, 0.42], [0.25, 0.42]], slope: 0.03, camber: 0.05, color: 0x6b3a1e, roof: 'teak', trim: 'teak',
        windows: [], hatches: [{ t: 0.225, w: 0.7, l: 0.6, kind: 'slide' }] },
    ],
    steering: { kind: 'tiller', len: 3.4, rise: 0.25, mat: 'wood', r: 0.07 },
    rudder: { kind: 'keel', mat: 'wood', color: 0xb8733f, span: 2.85, thick: 0.16, rootK: 1.0, taper: 0.95, sweep: 0.05, stockTop: 2.05 },
    keel: { kind: 'full' },
    bowsprit: { len: 8.8, kind: 'pole', mat: 'wood', r: 0.17, steeve: 0.9, inboard: 3.0, bobZ: 0.3 },
    masts: {
      main: { mat: 'wood', r: 0.28, round: true, spreaders: [], topmast: { cap: 23.3, heel: 21.5, r: 0.12, trees: 1.0 }, hounds: 22.6, deadeyes: true, deadeyeR: 0.09,
        ratlines: true, chainIn: 1.0, shrouds2: 1.0, lowerX: [], springs: [] },
      fore: { mat: 'wood', r: 0.27, round: true, spreaders: [], hounds: 21.8, deadeyes: true, deadeyeR: 0.09, ratlines: true, chainIn: 1.0, shrouds2: 1.0, chainAft: 0.25,
        stayTo: false, springs: [{ to: 'main', z0: 22.5, z1: 22.8 }] },
    },
    backstay: false, windex: false, noNumber: true, cleats: true,
    extras: ['schoonerDeck'],
  },
  hw: { trav: [-13.3, 1.3], boomS: 0.62, winch: [-8.0, 1.75], jibTrack: [6.0, 4.0, 2.4], helm: 'Tiller', bronze: true, winchR: 0.08 },
};
