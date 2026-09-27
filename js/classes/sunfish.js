// Sunfish (Alcort, 1952; now LaserPerformance): the board boat with the lateen rig, some 300,000 built.
// Sources: Wikipedia "Sunfish (sailboat)" (LOA 13 ft 9 in (4.19 m), beam 4 ft 1 in (1.24 m), hull 120 lb (54 kg),
// sail area 75 sq ft (7.0 m²), draft 2 ft 11 in (0.89 m) with the daggerboard down, lateen rig, US Portsmouth ~99-100);
// Sunfish class rules / sail plan: luff (on the upper spar) ~14 ft 8 in, foot (on the boom) ~13 ft 1 in, the spars
// joined by a gooseneck at the tack forward of the mast, the upper spar hoisted to the masthead. Here: luff laced to
// a yard 4.47 m long raised 52° from the boom, foot 3.99 m (area 7.0 m²); the gooseneck ~22 in (0.56 m) aft of the
// tack (Sunfish rigging guides: 15-24 in by wind strength), the halyard from the masthead to the yard ~5 ft below
// its top, so the yard hangs beside the mast, not against its head.
// Lines shaped to the dimensions and photographs: a flat deck a hand's breadth above the water, a small footwell,
// a sharp entry and a flat run aft.
// Line handling on the real boat: mainsheet 2:1 from the boom through a bridle (traveller rope) across the stern
// deck and a ratchet block on the footwell floor to the sailor's hand (no cleat); halyard to a cleat on the deck by
// the mast; outhaul and Cunningham on the boom's tack end (small cleats); vang optional.
import { DEG, LB, rrTable } from './util.js';

const LWL = 3.8, M = 120 * LB + 14;    // hull + spars, sail and foils
export default {
  id: 'sunfish', name: 'Sunfish', group: 'dinghy',
  blurb: "Alcort's 1952 board boat — the most sailed boat on the beach. Flat deck, a footwell, a daggerboard, and a lateen: the sail laced between a yard and a boom that swing together round a short mast, in the classic rainbow stripes. Wet, simple and quick off the wind.",
  specs: 'LOA 4.19 m · Beam 1.24 m · Hull 54 kg · Sail 7.0 m² (lateen) · Draft 0.89 m board down',
  lwl: LWL, loa: 4.19, beam: 1.24, bowX: 2.12, sternX: -2.07, freeboard: 0.26, canoeDraft: 0.1, wetted: 3.4, draft: 0.89,
  massHull: M, zG: 0.18, crewN: 1, crewEach: 80, crewZ: 0.32, crewMaxOut: 0.8, crewLee: -0.25, hikeRate: 1.8,
  gm: 0.4, bmForm: 0.5, Ixx: 65, Izz: 110, amX: 0.05, amY: 0.5, amYaw: 0.4, amRoll: 0.2,
  rr: rrTable(LWL, M + 80, { dinghy: true }),
  keel: { x: 0.55, z: -0.5, area: 0.2, ARe: 4.2, stall: 13 * DEG, cd0: 0.011, span: 0.72, chord: 0.28, board: true },
  rudder: { x: -2.15, z: -0.28, area: 0.09, ARe: 3.2, stall: 15 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.52, chord: 0.18, transom: true, loadRef: 200 },
  hullLat: { area: 0.4, cd: 0.9, z: -0.04 },
  windage: { area: 0.6, z: 0.8, cd: 1.0 },
  mastX: 0.85, mastHeight: 3.05, boomZ: 0.55, mastR: 0.028, keelBulb: false, vangSheeting: true,
  targetHeel: 6 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 380,
  engine: null,
  lines: { main: { handler: 'ratchet', n: 2, at: 'sole' }, vang: { handler: 'cam', n: 2, size: 'micro', at: 'deck' },
    cunn: { handler: 'cam', n: 2, at: 'deck' }, outhaul: { handler: 'cam', n: 1, size: 'micro', at: 'deck' } },
  sails: [
    { key: 'main', kind: 'boom', rig: 'lateen', area: 7.0, luff: 3.51, rake: 2.77, fixedRake: true, tackFwd: 0.56, foot: 3.99, head: 0.05, roach: 0, mastTop: 3.05,
      depth: [0.12, 0.13, 0.12], twistMax: 24 * DEG, cd0: 0.07, ARe: 3.0, min: 3 * DEG, max: 88 * DEG, trav: null, Iboom: 14, boomMass: 5, reefs: 0,
      vangBend: 0.1, sheetBend: 0.1, color: 0xf6f5f0, pockets: [], battens: { EI: 0, rows: [] }, boomMat: 'alu', yardR: 0.026, boomR: 0.026, window: false },
  ],
  hull: { color: 0xf6f6f2, stripe: 0x1f6fb5, deck: 0xf4f4ef, boot: 0xf6f6f2, bare: true, levels: [-9, -9, 0.06, 0.035] },
  // the rainbow sail, as the Sunfish wears it: diagonal bands over the whole sail, yellow at the peak through orange and
  // red to blue at the tack, the band edges leaning from the boom up to the yard
  sailcloth: { cloth: 0xf6f5f0, kind: 'dacron', num: '#16171a', logo: '#16171a', trans: 0.36, rough: 0.55,
    bands: [[-0.6, 0.18, '#f3d02a'], [0.18, 0.36, '#f4a11f'], [0.36, 0.56, '#ef6f1c'], [0.56, 0.78, '#d8312b'], [0.78, 1.6, '#2a62c4']], bandTilt: 0.45 },
  // the class emblem: a black sunfish, round-bodied, its tail to the left
  insignia: (g, cx, cy) => {
    g.fillStyle = '#16171a';
    g.beginPath(); g.moveTo(cx + 40, cy); g.bezierCurveTo(cx + 30, cy - 38, cx - 18, cy - 40, cx - 30, cy - 4); g.lineTo(cx - 52, cy - 26); g.lineTo(cx - 46, cy + 2);
    g.lineTo(cx - 52, cy + 28); g.lineTo(cx - 30, cy + 6); g.bezierCurveTo(cx - 18, cy + 40, cx + 30, cy + 38, cx + 40, cy); g.fill();
    g.fillStyle = '#f6f5f0'; g.beginPath(); g.arc(cx + 22, cy - 8, 4, 0, 7); g.fill();
  },
  offsets: {
    sheer: [[0, 0.24], [0.5, 0.25], [0.85, 0.3], [1, 0.34]],
    deck: [[0, 0.72], [0.2, 0.9], [0.5, 1.0], [0.75, 0.82], [0.92, 0.42], [1, 0.03]],
    wl: [[0, 0.78], [0.5, 0.92], [0.85, 0.62], [1, 0.2]],
    keel: [[0, 0.02], [0.06, -0.05], [0.35, -0.1], [0.65, -0.1], [0.85, -0.04], [0.95, 0.08], [1, 0.25]],
    bilge: [[0, 4], [0.5, 3], [1, 2]], dead: [[0, 0.1], [0.6, 0.2], [1, 0.6]], flare: 1.0, crown: 0.02, transomRake: 0.05,
  },
  model: {
    nameAt: false,
    cockpit: { t0: 0.26, t1: 0.46, w: 0.36, sole: 0.02, seats: false, coaming: 0.03 },
    deck: 'nonskid', deckTint: '#f4f4ef', toerail: 'alu', cleats: false, navLights: false, windex: false,
    steering: { kind: 'tiller', len: 0.8, rise: 0.05, mat: 'alu', extension: 0.8, r: 0.016 },
    rudder: { kind: 'transom', top: 0.3, bottom: -0.5, chordTop: 0.15, heel: 0.2, mat: 'wood', thick: 0.02 },
    keel: { kind: 'dagger', color: 0xc89a64 },
    masts: { main: { mat: 'alu', r: 0.028, rTop: 0.024, round: true, mastCollar: false, spreaders: [], lowers: false, shrouds: false } },
    extras: ['sunfishDeck'],
  },
  hw: { style: 'dinghy', trav: [-1.95, 0.45], boomS: 0.62, ratchet: [-0.35, 0.08], helm: 'Tiller extension' },
  noWinches: true,
};
