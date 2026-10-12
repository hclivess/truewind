// Shenandoah (of Sark): the three-masted gaff topsail schooner Theodore E. Ferris designed and Townsend & Downey built
// at Shooter's Island, New York, launched 12 April 1902 for Gibson Fahnestock (the yacht's own history gives Charles
// Fahnestock). Later Lasca II (1912), Shenandoah again (1919), Atlantide (1925-72), Shenandoah under Baron Bich (1972);
// restored at McMullen & Wing, Auckland, 1995-96 (ShowBoats Best Classic Restoration), refitted 2004, 2009, 2016,
// 2019; Rolex Trophy, Les Voiles de Saint-Tropez 2022. Modelled as she is now. ('Of Sark': Wikipedia says she is
// registered there, uncited; the yacht's spec sheet gives her flag as UK, MMSI 235062000.)
// Sources: syshenandoah.com/specifications (LOA over spars 54.35 m, LWL 32.63 m, beam 8.28 m, draft 4.65 m, steel,
// '3 Mast Gaff Topsail Schooner', 2 x Lugger L6140AL, ZF BW160 gearboxes, Hundested VP7 controllable-pitch propeller,
// 9 kn cruising and 12 kn flat out under power) and its sail plan drawing (sail-plan.png), from which the spars, the
// heights and the sail areas here are measured (scale ~0.0605 m/px from the length over spars and the draft; +-5%:
// the masts rising aft, fore 34.7 / main 35.6 / mizzen 36.6 m above the water at the trucks, raked ~3 deg; gaffs
// ~9.0, 8.8 and 11.6 m; booms ~8.0, 9.0 and 17.4 m, the mizzen's 3.4 m past the counter; a club on the fore staysail;
// bowsprit and jib-boom ~8.2 m outboard); Wikipedia 'Shenandoah (1902)' (length on deck 44.2 m, beam 8.23 m,
// 888 m^2 of sail, ~300 t, uncited); superyachts.com (2022: 10 upwind sails, ~1,000 m^2); the yacht's photo galleries
// (black topsides, a pale boot top, varnished bulwarks inside and a varnished rail on bronze stanchions, laid teak, a
// low varnished deckhouse with a white roof abaft the mainmast, a big spoked wheel aft, varnished spars with white
// bands, white sails, bronze pins in pinrails, geared drum winches on the masts).
// Estimates (marked so): displacement (300 t, Wikipedia's uncited figure), ballast (100 t), the canoe body's depth, the
// mast positions and sail corners off the drawing, the engines' power (500 hp each, a secondary source) and the way they
// drive (taken as one centreline shaft to the VP7 controllable-pitch propeller), the deck furniture's sizes.
import { DEG, HP, rrTable, massProps } from './util.js';

const LWL = 32.63, M = 300000, BAL = 110000, R3 = Math.tan(3.1 * DEG);
const MP = massProps([{ m: M - BAL - 14000, z: 0.9, ry: 2.8, rx: 9.5 }, { m: BAL, z: -3.6, ry: 0.4, rx: 6.0 }, { m: 14000, z: 15, rz: 9.5 }]);
const BZ = 4.0, FZ = 3.7, MZ = 3.7;          // gooseneck heights (main, fore, mizzen)
const FX = 11.06, ZX = -7.24;                // fore and mizzen masts at their goosenecks
export default {
  id: 'shenandoah', name: 'Shenandoah of Sark', group: 'legend',
  blurb: "Theodore Ferris's 1902 three-masted gaff topsail schooner: 54 m over her spars, a black steel hull with a clipper bow and a long counter, three varnished masts rising aft to 36 m, gaff topsails on every mast and three headsails on a long bowsprit and jib-boom. Restored in Auckland in 1996; won the Rolex Trophy at Saint-Tropez in 2022.",
  specs: 'LOA 54.35 m (spars) · LOD ~43.5 m · LWL 32.63 m · Beam 8.28 m · Draft 4.65 m · ~300 t (est.) · Steel · ~850 m² working sail · 2 × Lugger L6140AL',
  lwl: LWL, loa: 43.5, beam: 8.28, bowX: 21.6, sternX: -21.9, freeboard: 2.1, canoeDraft: 2.0, wetted: 350, draft: 4.65,
  bowsprit: 8.2, cabin: true, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 16, crewEach: 80, crewZ: 2.6, crewMaxOut: 3.2, crewLee: -2.0, hikeRate: 0.3,
  gm: 1.5, bmForm: 2.4, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.07, amY: 0.95, amYaw: 0.7, amRoll: 0.35,
  rr: rrTable(LWL, M + 1300, { prism: -0.04 }),
  // (the lateral plane's centre aft of midships, where the drawing's keel is deepest (est.); ~8 deg of weather helm
  // close-hauled in 12 kn at speed, test/helm.mjs; the rudder on the sternpost 3.6 x 1.7 m (est.))
  keel: { x: -2.5, z: -2.4, area: 60, ARe: 0.7, stall: 26 * DEG, cd0: 0.003, span: 4.6, chord: 16, long: true },
  rudder: { x: -12.6, z: -2.3, area: 6.2, ARe: 2.1, stall: 22 * DEG, cd0: 0.013, max: 35 * DEG, span: 3.6, chord: 1.72, loadRef: 45000 },
  hullLat: { area: 16, cd: 0.9, z: -0.8 },
  windage: { area: 60, z: 9, cd: 1.0 },
  mastX: 2.3, mastHeight: 35.6, mastRake: (35.6 - BZ) * R3, boomZ: BZ, mastR: 0.25, keelBulb: false,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 12000, reefTime: 420,
  cloth: 'canvas',
  // 2 x Lugger L6140AL (est. 500 hp each), ZF BW160 gearboxes, the Hundested VP7 controllable-pitch propeller: taken
  // here as one shaft on the centreline (est.), its pitch set for the yacht's 12 kn
  engine: { type: 'inboard', model: '2 × Lugger L6140AL, Hundested VP7 CP propeller', kW: 2 * 500 * HP, rpmMax: 2300, rpmIdle: 650, cyl: 6, fuel: 'diesel', gear: 3.5, wake: 0.25,
    prop: { D: 1.4, P: 1.25, Z: 4, BAR: 0.55, folding: false, rh: 1 }, pos: [-11.2, 0, -2.1], mount: [-6.5, 0, -0.9], mass: 3600, inMass: true,
    shaftAngle: 6 * DEG, exhaust: [-20.5, 1.5, 1.2] },
  lines: { main: { handler: 'horn', n: 4, at: 'deck' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    stay: { handler: 'horn', n: 3, at: 'deck' }, fore: { handler: 'horn', n: 4, at: 'deck' }, mizzen: { handler: 'horn', n: 5, at: 'deck' },
    vang: { handler: 'horn', n: 3, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' }, outhaul: { handler: 'horn', n: 2, at: 'boom' },
    jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  ropeStyle: 'classic',
  sails: [
    // mainsail (the middle mast) and its gaff topsail
    { key: 'main', kind: 'boom', rig: 'gaff', area: 134, luff: 14.9, foot: 8.6, head: 6.1, headRise: 6.3, roach: 0,
      topsail: { luff: 16.1, area: 47, head: 0.25 },
      depth: [0.11, 0.12, 0.11], twistMax: 22 * DEG, cd0: 0.075, ARe: 2.6, min: 3 * DEG, max: 72 * DEG, trav: [-3 * DEG, 8 * DEG], Iboom: 3000, boomMass: 260, reefs: 2,
      vangBend: 0, sheetBend: 0, color: 0xf3f0e8, pockets: [], battens: { EI: 0, rows: [] }, boomMat: 'wood', gaffR: 0.12, boomR: 0.16, boomRound: true, ropeK: 5 },
    // foresail and its topsail; the boom ends short of the mainmast
    { key: 'fore', kind: 'boom', rig: 'gaff', mast: { h: 34.7, r: 0.24, rake: (34.7 - FZ) * R3 }, area: 121, tackX: FX, tackZ: FZ,
      luff: 14.3, foot: 7.7, head: 6.0, headRise: 6.7, roach: 0, topsail: { luff: 16.1, area: 47, head: 0.25 },
      depth: [0.11, 0.12, 0.11], twistMax: 22 * DEG, cd0: 0.075, ARe: 2.6, min: 3 * DEG, max: 66 * DEG, trav: [-3 * DEG, 8 * DEG], Iboom: 2400, boomMass: 220,
      color: 0xf3f0e8, boomMat: 'wood', gaffR: 0.12, boomR: 0.15, boomRound: true, pockets: [], battens: { EI: 0, rows: [] }, ropeK: 5 },
    // mizzen (the spanker: the biggest), its boom over the counter, and its topsail
    { key: 'mizzen', kind: 'boom', rig: 'gaff', mast: { h: 36.6, r: 0.27, rake: (36.6 - MZ) * R3 }, area: 276, tackX: ZX, tackZ: MZ,
      luff: 16.9, foot: 16.8, head: 8.95, headRise: 7.4, roach: 0, topsail: { luff: 15.4, area: 66, head: 0.25 },
      depth: [0.11, 0.12, 0.11], twistMax: 22 * DEG, cd0: 0.075, ARe: 2.4, min: 3 * DEG, max: 75 * DEG, trav: null, Iboom: 30000, boomMass: 700,
      color: 0xf3f0e8, boomMat: 'wood', gaffR: 0.14, boomR: 0.2, boomRound: true, pockets: [], battens: { EI: 0, rows: [] }, ropeK: 6 },
    // fore staysail on its club, tacked at the stem head
    { key: 'stay', kind: 'boom', selfTacking: true, stayTo: 'fore', area: 60, tackX: 21.3, tackZ: 3.7, luff: 16.7, foot: 7.3, head: 0.12,
      depth: [0.11, 0.12, 0.1], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.6, min: 5 * DEG, max: 55 * DEG, Iboom: 400, boomMass: 60, color: 0xf3f0e8, boomMat: 'wood', clubVang: true, boomR: 0.09, boomRound: true },
    // jib, high-cut, on the bowsprit's end
    { key: 'jib', kind: 'loose', label: 'Jib', stayTo: 'fore', area: 53, tackX: 24.4, tackZ: 4.1, luff: 16.5, foot: 8.2, head: 0.1, footRise: 2.1,
      depth: [0.11, 0.12, 0.1], cd0: 0.045, ARe: 4.2, min: 9 * DEG, max: 50 * DEG, sagK: 1.6, color: 0xf3f0e8, window: false },
    // flying jib (jib topsail) on the jib-boom's end, to the fore topmast
    { key: 'flying', kind: 'loose', label: 'Flying jib', stayTo: 'fore', area: 48, tackX: 29.4, tackZ: 4.7, luff: 17.1, foot: 9.0, head: 0.1, footRise: 2.9,
      depth: [0.11, 0.12, 0.1], cd0: 0.045, ARe: 5.0, min: 8 * DEG, max: 48 * DEG, sagK: 1.8, color: 0xf3f0e8, window: false },
  ],
  hull: { color: 0x0f1013, stripe: 0xc9a54a, deck: 0xc9a878, boot: 0x2a2c30, bootTop: 0xd9e4d6, levels: [0.05, 0.25, 0.32, 0.29], rough: 0.3 },
  sailcloth: { cloth: 0xf3f0e8, kind: 'dacron', mottle: false, num: '#2a2a2a', logo: '#2a2a2a', trans: 0.28, rough: 0.66 },
  insignia: '',
  offsets: {
    // (drawn off the sail plan: the long counter overhanging ~5.6 m, a clipper stem with a cut-away forefoot, the
    // deep keel's bottom flat from a third of the length aft, the rudder on its raked sternpost)
    sheer: [[0, 2.25], [0.2, 2.15], [0.45, 2.1], [0.7, 2.3], [0.9, 2.85], [1, 3.35]],
    deck: [[0, 0.45], [0.08, 0.66], [0.2, 0.86], [0.4, 0.99], [0.55, 1.0], [0.72, 0.9], [0.86, 0.62], [0.95, 0.3], [1, 0.03]],
    wl: [[0, 0.3], [0.15, 0.55], [0.3, 0.84], [0.5, 0.9], [0.72, 0.75], [0.88, 0.42], [1, 0.1]],
    keel: [[0, 1.4], [0.1, 0.75], [0.17, 0.05], [0.22, -0.8], [0.32, -1.95], [0.55, -2.0], [0.75, -1.6], [0.87, -0.85], [0.935, 0.0], [1, 1.9]],
    fin: [[0.175, -0.6], [0.2, -3.6], [0.24, -4.65], [0.48, -4.65], [0.62, -4.1], [0.78, -2.8], [0.88, -1.4], [0.93, -0.4]], finW: 0.35,
    bilge: [[0, 2.0], [0.45, 2.4], [0.8, 1.9], [1, 1.5]], dead: [[0, 0.35], [0.45, 0.45], [0.8, 0.7], [1, 0.85]], flare: 0.75,
    crown: 0.14, transomRake: 0.5, stemX: 1.2,
  },
  model: {
    cockpit: { t0: 0.1, t1: 0.17, w: 0.3, sole: 1.2, seats: true, seat: 0.4, seatW: 0.4, coaming: 0.35, coamingMat: 'teak' },
    deck: 'teak', toerail: { bulwark: 0.45, cap: 'teak', color: 0x0f1013 }, bronze: true,
    lifelines: { t0: 0.06, t1: 0.92, h: 0.95, mat: 'bronze', rail: 'teak', pushpit: false, pulpit: false, spacing: 1.6 },
    hullPorts: [{ t0: 0.2, t1: 0.82, n: 12, z: 1.2, r: 0.12 }],
    cabins: [
      // the deckhouse abaft the mainmast: varnished teak, white roof, windows
      { t0: 0.47, t1: 0.58, h: [[0.47, 1.0], [0.58, 1.0]], w: [[0.47, 1.35], [0.58, 1.4]], slope: 0.04, camber: 0.1, frontRake: 0.05, aftRake: 0.05,
        color: 0x9a5a2a, side: 'wood', roof: 'paint', roofColor: 0xf2efe6, trim: 'teak',
        windows: [{ kind: 'rect', t0: 0.48, t1: 0.57, n: 4, zf: 0.6, hf: 0.45 }], companion: { w: 0.8, mat: 'teak' } },
      // skylights forward and aft
      { t0: 0.66, t1: 0.7, h: [[0.66, 0.5], [0.7, 0.5]], w: [[0.66, 0.6], [0.7, 0.6]], slope: 0.05, camber: 0.2, color: 0x9a5a2a, side: 'wood', roof: 'teak', trim: 'teak', windows: [], hatches: [] },
      { t0: 0.3, t1: 0.35, h: [[0.3, 0.5], [0.35, 0.5]], w: [[0.3, 0.7], [0.35, 0.7]], slope: 0.05, camber: 0.2, color: 0x9a5a2a, side: 'wood', roof: 'teak', trim: 'teak', windows: [], hatches: [] },
    ],
    steering: { kind: 'wheel', x: -16.0, r: 0.75, hub: 1.25 },
    rudder: { kind: 'keel', color: 0x2a2c30, span: 3.3, thick: 0.2, rootK: 1.0, taper: 0.9, sweep: 0.15 },
    keel: { kind: 'full' },
    bowsprit: { len: 8.2, kind: 'pole', mat: 'wood', r: 0.2, steeve: 1.3, inboard: 3.5, bobZ: 0.8 },
    masts: {
      main: { mat: 'wood', r: 0.25, round: true, spreaders: [], topmast: { cap: 25.2, heel: 23.0, r: 0.13, trees: 1.3 }, hounds: 24.4, deadeyes: true, deadeyeR: 0.1,
        ratlines: true, chainIn: 1.0, shrouds2: 1.2, lowerX: [], springs: [{ to: 'fore', z0: 25.1, z1: 24.2 }] },
      fore: { mat: 'wood', r: 0.24, round: true, spreaders: [], topmast: { cap: 24.3, heel: 22.1, r: 0.13, trees: 1.3 }, hounds: 23.5, deadeyes: true, deadeyeR: 0.1,
        ratlines: true, chainIn: 1.0, shrouds2: 1.2, stayTo: false },
      mizzen: { mat: 'wood', r: 0.27, round: true, spreaders: [], topmast: { cap: 26.2, heel: 24.0, r: 0.14, trees: 1.4 }, hounds: 25.4, deadeyes: true, deadeyeR: 0.1,
        ratlines: true, chainIn: 1.0, shrouds2: 1.2, stayTo: false, springs: [{ to: 'main', z0: 26.1, z1: 25.1 }] },
    },
    backstay: false, windex: false, noNumber: true,
    hullName: { text: 'SHENANDOAH', t: 0.035, z: 1.5, len: 3.2, color: '#c9a54a', font: '700 72px Georgia, "Times New Roman", serif' },
    extras: ['schoonerDeck'],
  },
  hw: { trav: [-18.0, 1.6], boomS: 0.95, winch: [-13.0, 2.4], jibTrack: [15.0, 13.0, 2.9], helm: 'Wheel', bronze: true, winchR: 0.1 },
};
