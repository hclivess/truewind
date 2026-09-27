// ---- International 470: the Olympic two-person centreboard dinghy. Crew on trapeze, helm hiking, symmetric
// spinnaker on a pole, centre mainsheet on a traveller on the centreboard case, pivoting centreboard.
// Sources: World Sailing 470 class rules (https://www.sailing.org/tools/documents/4702017CR170217-%5B22006%5D.pdf),
// Wikipedia 470 (dinghy) (LOA 4.70 m, LWL 4.40 m, beam 1.69 m, hull 120 kg, mast 6.76 m, main 9.12 m^2, jib 3.58 m^2,
// spinnaker 13 m^2, crew 110-145 kg). Pole length and foil sizes are estimates. RYA PN 973, US Sailing D-PN 86.3.
// Lines (for the line-handler schema): mainsheet centre-sheeted to a ratchet block with a swivel cam cleat on the
// centreboard case; jib sheets to swivel cam cleats on the side tanks; spinnaker sheets and guys through ratchet blocks,
// guys to cam cleats by the shrouds (twinning lines); pole uphaul/downhaul on cam cleats at the mast; vang, cunningham,
// outhaul and jib halyard (rig tension) on cam cleats either side of the case.
import { DEG } from './util.js';

export default {
  id: '470', group: 'dinghy', name: '470',
  blurb: 'The Olympic two-person dinghy since 1976: crew on trapeze, helm hiking, a symmetric spinnaker set on a pole, a pivoting centreboard. Planes on a reach in a breeze. It capsizes.',
  specs: 'LOA 4.70 m · LWL 4.40 m · Beam 1.69 m · Hull 120 kg · Main 9.12 m² · Jib 3.58 m² · Spinnaker 13.0 m² · Crew 2 (trapeze)',
  lwl: 4.4, loa: 4.7, beam: 1.69, bowX: 2.4, sternX: -2.2, freeboard: 0.42, canoeDraft: 0.15, wetted: 3.6, draft: 1.05,
  noWinches: true, trapeze: 1, mastR: 0.034, spreaders: { n: 1, sweep: 20 * DEG },
  engine: null,
  // crew weight out: the helm hiking (CG ~1.05 m out) and the crew on trapeze (~1.55 m), 60 + 70 kg
  lines: { main: { handler: 'ratchetCam', n: 3, at: 'sole' }, jib: { handler: 'cam', n: 2, at: 'deck' }, gen: { handler: 'ratchet', hold: 20, at: 'quarter' },
    trav: { handler: 'cam', n: 2, at: 'sole' }, vang: { handler: 'cam', n: 12, size: 'micro', at: 'deck' }, cunn: { handler: 'cam', n: 6, size: 'micro', at: 'deck' },
    outhaul: { handler: 'cam', n: 4, size: 'micro', at: 'deck' }, jibHalyard: { handler: 'cam', n: 8, at: 'deck' }, tackLine: { handler: 'cam', at: 'mast' } },
  massHull: 130, zG: 0.15, crewN: 2, crewEach: 65, crewZ: 0.38, crewMaxOut: 1.32, crewLee: -0.3, hikeRate: 1.6,
  gm: 0.4, bmForm: 0.56, Ixx: 330, Izz: 450, amX: 0.05, amY: 0.5, amYaw: 0.4, amRoll: 0.2,
  rr: [[0.1, 0.0001], [0.15, 0.0005], [0.2, 0.0012], [0.25, 0.0027], [0.3, 0.0055], [0.35, 0.011], [0.4, 0.02],
       [0.45, 0.033], [0.5, 0.045], [0.55, 0.052], [0.6, 0.055], [0.7, 0.054], [0.8, 0.051], [1.0, 0.048], [1.2, 0.049], [1.5, 0.055]],
  keel: { x: 0.45, z: -0.55, area: 0.32, ARe: 4.6, stall: 13 * DEG, cd0: 0.01, span: 0.82, chord: 0.38, board: true, pivot: true },
  rudder: { x: -2.25, z: -0.35, area: 0.14, ARe: 3.8, stall: 15 * DEG, cd0: 0.011, max: 35 * DEG, span: 0.66, chord: 0.22, loadRef: 280, lifting: true },
  hullLat: { area: 0.5, cd: 0.9, z: -0.05 },
  windage: { area: 1.0, z: 1.0, cd: 1.0 },
  // (the rig from the class sail plan: mast 1.85 m aft of the stem, 6.7 m above the water, boom 0.5 m over the deck)
  mastX: 0.65, mastHeight: 6.7, boomZ: 0.85, keelBulb: false, houndsF: 0.24, spreader: 0.42,
  targetHeel: 5 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 460,
  cloth: 'dacronDinghy',
  sails: [
    { key: 'main', kind: 'boom', area: 9.12, luff: 5.65, foot: 2.45, head: 0.2, depth: [0.12, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 4.0, min: 2 * DEG, max: 82 * DEG, trav: [-3 * DEG, 14 * DEG], Iboom: 7, boomMass: 4, reefs: 0,
      vangBend: 0.4, sheetBend: 0.3, color: 0xf4f3ee },
    { key: 'jib', kind: 'loose', area: 3.58, tackX: 2.4, tackZ: 0.4, luff: 4.0, foot: 1.7, head: 0.04,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.2, min: 9 * DEG, max: 42 * DEG, sagK: 0.8, color: 0xf4f3ee },
    // symmetric spinnaker: tack on the pole end (pole 1.9 m), head at the hounds
    { key: 'gennaker', kind: 'spin', label: 'Spinnaker', pole: 1.9, replaces: 'jib', area: 13.0, tackX: 0.65 + 0.07 + 1.9, tackZ: 1.15, luff: 4.45, foot: 2.9, head: 0.4, rake: 1.97,
      depth: [0.2, 0.22, 0.2], cd0: 0.09, ARe: 1.9, min: 16 * DEG, max: 100 * DEG, color: 0xd9412b },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.46, tr: 0.62, be: 0.72, sheerBow: 0.22, sheerStern: 0.0, stemRake: 0.12, transomRake: 0.0, flare: 0.25, flat: 0.6, sternDepth: 0.3, crown: 0.06 },
  insignia: '470',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xf4f3ee, kind: 'dacron', num: '#1d2a44', logo: '#1d4e89', trans: 0.34, rough: 0.6 },
  hull: { color: 0xf6f6f2, stripe: 0x1d4e89, deck: 0xe6e3da, boot: 0x1d4e89, sectionN: 2.2, transom: 0.62, bowRake: 0.12, sheer: 0.06,
    levels: [-9, -9, 0.1, 0.075], lifelines: false, cockpit: { t0: 0.08, t1: 0.66, w: 0.62, sole: 0.14 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-0.5, 0.22, 0.2], winch: [-0.2, 0.35], jibTrack: [0.55, 0.05, 0.48], boomS: 0.55, clutchX: 0.1 },
};
