// ---- International 49er: a two-handed skiff, both crew on trapeze from the wings, carbon mast, square-top fully
// battened main, self-tacking jib on a track, asymmetric gennaker off a retractable pole.
// Sources: World Sailing / 49er class (https://49er.org/class-info-2/tuning/), Wikipedia 49er (dinghy)
// (LOA 4.88 m, hull beam 1.75 m, 2.74 m over the wings, hull 94 kg, main + jib 19.97 m^2, gennaker 37.16 m^2,
// crew about 150 kg); the main/jib split and foil sizes are estimates. RYA PN 697, US Sailing D-PN 68.2.
// Lines (for the line-handler schema): mainsheet through a ratchet block on the floor to a cam cleat, from the boom end
// to a bridle across the transom; jib sheet (self-tacker) on a cam cleat at the front of the wing; gennaker sheets through
// ratchet blocks on the wings, hand-held (no cleat); gennaker halyard / pole launcher on one continuous line with a cam;
// cunningham and vang on 2:1 cascades to cam cleats either side; halyards locked at the masthead (lock, no cleat).
import { DEG } from './util.js';

export default {
  id: '49er', group: 'dinghy', name: '49er',
  blurb: 'The Olympic two-handed skiff: both crew on trapeze from wings out to 2.7 m, a carbon mast with a square-top main, a self-tacking jib and a 37 m² gennaker. It planes upwind in 12 kn and does the wind speed downwind. It capsizes, often.',
  specs: 'LOA 4.88 m · Beam 1.75 m (2.74 m over the wings) · Hull 94 kg · Main + jib 20.0 m² · Gennaker 37.2 m² · Crew 2 on trapeze',
  lwl: 4.5, loa: 4.88, beam: 1.4, bowX: 2.4, sternX: -2.3, freeboard: 0.4, canoeDraft: 0.12, wetted: 3.0, draft: 1.45,
  bowsprit: 1.2, noWinches: true, trapeze: 2, carbonMast: true, mastR: 0.036, spreaders: { n: 2, sweep: 25 * DEG },
  engine: null,
  // (the hull's deck is 1.75 m wide over its flare; its waterline beam about 1 m: the drawn lines use 1.4 m)
  // (both on trapeze: the rail at 1.37 m, each sailor's weight about 0.9 m beyond it)
  lines: { main: { handler: 'ratchetCam', n: 4, at: 'sole' }, stay: { handler: 'cam', n: 2, at: 'deck' }, gen: { handler: 'ratchet', hold: 20, at: 'quarter' },
    trav: { handler: 'cam', n: 2, at: 'deck' }, vang: { handler: 'cam', n: 12, size: 'micro', at: 'deck' }, cunn: { handler: 'cam', n: 8, size: 'micro', at: 'deck' },
    outhaul: { handler: 'cam', n: 6, size: 'micro', at: 'deck' }, tackLine: { handler: 'cam', at: 'deck' } },
  massHull: 112, zG: 0.2, crewN: 2, crewEach: 80, crewZ: 0.45, crewMaxOut: 2.3, crewLee: -0.3, hikeRate: 1.6,
  gm: 0.4, bmForm: 0.5, Ixx: 850, Izz: 480, amX: 0.04, amY: 0.45, amYaw: 0.4, amRoll: 0.2,
  // residuary resistance / weight: a light, flat-run skiff hull (D/L ~ 45) that is over its hump by Fn 0.6
  rr: [[0.1, 0.0001], [0.2, 0.001], [0.3, 0.0045], [0.35, 0.009], [0.4, 0.016], [0.45, 0.026], [0.5, 0.034],
       [0.55, 0.039], [0.6, 0.041], [0.7, 0.04], [0.8, 0.037], [1.0, 0.034], [1.2, 0.034], [1.5, 0.038]],
  keel: { x: -0.25, z: -0.7, area: 0.34, ARe: 6.5, stall: 13 * DEG, cd0: 0.009, span: 1.25, chord: 0.27, board: true },
  rudder: { x: -2.35, z: -0.4, area: 0.14, ARe: 4.2, stall: 15 * DEG, cd0: 0.01, max: 32 * DEG, span: 0.8, chord: 0.19, loadRef: 300, lifting: true },
  hullLat: { area: 0.4, cd: 0.9, z: -0.05 },
  windage: { area: 1.3, z: 1.0, cd: 1.0 },
  // (the rig from the class sail plan: mast 2.3 m aft of the stem, 8.25 m above the water, boom 0.9 m over the deck)
  mastX: 0.1, mastHeight: 8.25, boomZ: 1.25, keelBulb: false, houndsF: 0.3,
  // (fullPowerTws: the wind in which both crew are out and the sails still at full power, kn; past it the crew
  // twists the main off, as test/sailshape.mjs knows)
  targetHeel: 8 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 520, fullPowerTws: 10,
  cloth: 'laminate', battens: { EI: 15, full: true, rows: [0.14, 0.28, 0.42, 0.56, 0.7, 0.84] },
  sails: [
    { key: 'main', kind: 'boom', area: 15.0, luff: 6.85, foot: 2.8, head: 0.8, depth: [0.14, 0.16, 0.15], twistMax: 17 * DEG,
      cd0: 0.06, ARe: 4.2, min: 1 * DEG, max: 80 * DEG, trav: [-3 * DEG, 16 * DEG], Iboom: 10, boomMass: 4, reefs: 0,
      vangBend: 0.35, sheetBend: 0.3, color: 0xe9ecef },
    // the self-tacking jib: its clew runs on a track across the foredeck (drawn clubless; the physics holds the clew on
    // the track's arc as a club would)
    { key: 'stay', kind: 'boom', selfTacking: true, club: false, label: 'Jib', area: 5.0, tackX: 2.35, tackZ: 0.42, luff: 4.95, foot: 1.95, head: 0.05,
      depth: [0.11, 0.12, 0.1], twistMax: 13 * DEG, cd0: 0.045, ARe: 4.4, min: 5 * DEG, max: 38 * DEG, Iboom: 1.2, boomMass: 1, color: 0xe9ecef },
    // (a gennaker this big on a mast this short: its broad shoulders are drawn as a wide head, the luff near vertical
    // ahead of the mast, as the sportboat's, so the rated area fits with the clew near the transom)
    { key: 'gennaker', kind: 'spin', area: 37.2, tackX: 3.55, tackZ: 0.45, luff: 7.2, foot: 4.3, head: 1.6, rake: 1.5,
      depth: [0.18, 0.2, 0.18], cd0: 0.08, ARe: 2.3, min: 14 * DEG, max: 95 * DEG, color: 0x1a1d22 },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.42, tr: 0.82, be: 0.85, sheerBow: 0.12, sheerStern: 0.0, stemRake: 0.02, transomRake: 0.0, flare: 0.5, flat: 0.85, sternDepth: 0.45, crown: 0.04 },
  insignia: '49er',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xdfe3e6, kind: 'laminate', num: '#16233a', logo: '#16233a', trans: 0.3, rough: 0.35 },
  hull: { color: 0xf4f5f6, stripe: 0x1a1d22, deck: 0xdcdfe2, boot: 0x1a1d22, sectionN: 2.4, transom: 0.8, bowRake: 0.02, sheer: 0.05,
    levels: [-9, -9, 0.1, 0.075], lifelines: false, deckTint: '#d9dde1', cockpit: { t0: 0.02, t1: 0.7, w: 0.7, sole: 0.14 },
    wings: { y: 1.37, x0: -2.0, x1: -0.05, rise: 0.08 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-2.1, 0.4], winch: [-0.6, 0.32], jibTrack: [0.0, -0.4, 0.4], boomS: 0.95, clutchX: -0.5 },
};
