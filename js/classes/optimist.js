// International Optimist (Clark Mills, 1947; IODA one-design since 1995): the pram every young sailor starts in.
// Sources: IODA class rules / Wikipedia "Optimist (dinghy)" (LOA 7 ft 9 in (2.31-2.36 m), LWL ~7 ft 2 in, beam 3 ft
// 8 in (1.13 m), hull minimum 35 kg (77 lb), sail area 3.3 m², sprit rig, mast 7 ft 5 in above the step, daggerboard
// draft 2 ft 9 in, 5 in board up); RYA Portsmouth Yardstick 1646 (the slowest dinghy on the RYA list). The sail's
// shape is the class sail plan's quadrilateral: luff laced to the mast, foot on the boom, the peak held up and out
// by the sprit from a snotter low on the mast. Lines shaped to the dimensions and photographs: a flat bottom with
// hard chines, a pram (transom) bow, slab sides.
// Line handling on the real boat: mainsheet 3:1 from the boom through a ratchet block on a bridle across the hull
// to the sailor's hand (no cleat in the class rules), sprit tension on the snotter (a small tackle with a cleat on
// the mast), vang on the boom's gooseneck end, outhaul and luff ties; daggerboard and rudder held by elastic.
import { DEG, rrTable } from './util.js';

const LWL = 2.1, M = 40;
export default {
  id: 'optimist', name: 'Optimist', group: 'dinghy',
  blurb: "The 2.3 m pram every young sailor starts in — more than 150,000 of them. Flat bottom, square bow, a sprit rig with the peak held up by a diagonal spar, daggerboard and a tiller on a stick. One sailor up to about 15 years old. Slowest boat on the Portsmouth list, and the hardest fleet to win.",
  specs: 'LOA 2.31 m · Beam 1.13 m · Hull 35 kg (min) · Sail 3.3 m² (sprit) · Draft 0.13 / 0.84 m',
  lwl: LWL, loa: 2.31, beam: 1.13, bowX: 1.2, sternX: -1.11, freeboard: 0.4, canoeDraft: 0.11, wetted: 2.0, draft: 0.84,
  massHull: M, zG: 0.18, crewN: 1, crewEach: 45, crewZ: 0.34, crewMaxOut: 0.62, crewLee: -0.2, hikeRate: 1.8,
  gm: 0.4, bmForm: 0.45, Ixx: 26, Izz: 22, amX: 0.06, amY: 0.6, amYaw: 0.45, amRoll: 0.25,
  rr: rrTable(LWL, M + 45, { planing: 0.35 }),
  keel: { x: 0.25, z: -0.45, area: 0.2, ARe: 3.6, stall: 13 * DEG, cd0: 0.012, span: 0.72, chord: 0.28, board: true },
  rudder: { x: -1.2, z: -0.25, area: 0.085, ARe: 2.8, stall: 15 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.5, chord: 0.18, transom: true, loadRef: 120 },
  hullLat: { area: 0.26, cd: 1.0, z: -0.05 },
  windage: { area: 0.45, z: 0.6, cd: 1.1 },
  mastX: 0.72, mastHeight: 2.36, boomZ: 0.55, mastR: 0.022, keelBulb: false, vangSheeting: true,
  targetHeel: 5 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 250,
  engine: null,
  lines: { main: { handler: 'ratchet', n: 3, at: 'sole' }, vang: { handler: 'cam', n: 2, size: 'micro', at: 'deck' },
    cunn: { handler: 'cam', n: 1, size: 'micro', at: 'deck' }, outhaul: { handler: 'cam', n: 1, size: 'micro', at: 'deck' } },
  sails: [
    { key: 'main', kind: 'boom', rig: 'sprit', area: 3.3, luff: 1.8, foot: 2.05, head: 1.03, headRise: 0.84, snotterZ: 0.55, roach: 0,
      depth: [0.12, 0.13, 0.12], twistMax: 24 * DEG, cd0: 0.07, ARe: 2.6, min: 3 * DEG, max: 88 * DEG, trav: null, Iboom: 3, boomMass: 2, reefs: 0,
      vangBend: 0.2, sheetBend: 0.15, color: 0xf6f5f0, pockets: [[0.45, 0.2], [0.72, 0.2]], battens: { EI: 0, rows: [] }, boomMat: 'alu', spritR: 0.016, boomR: 0.022, window: true },
  ],
  hull: { color: 0xf6f6f2, stripe: 0xd8352a, deck: 0xf0efe8, boot: 0xf6f6f2, bare: true, levels: [-9, -9, 0.05, 0.02] },
  sailcloth: { cloth: 0xf6f5f0, kind: 'dacron', num: '#1d2a44', logo: '#1d4e89', trans: 0.36, rough: 0.6 },
  // the class emblem (IODA): a ring with a short tail through its lower right, like a Q
  insignia: (g, cx, cy) => {
    g.strokeStyle = '#111316'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy - 4, 30, 0, 2 * Math.PI); g.stroke();
    g.beginPath(); g.moveTo(cx + 4, cy + 2); g.lineTo(cx + 26, cy + 42); g.stroke();
  },
  offsets: {
    sheer: [[0, 0.38], [0.5, 0.39], [1, 0.44]],
    deck: [[0, 0.8], [0.15, 0.92], [0.45, 1.0], [0.75, 0.94], [1, 0.62]],
    wl: [[0, 0.82], [0.4, 0.9], [0.8, 0.86], [1, 0.7]],
    keel: [[0, 0.06], [0.08, -0.06], [0.3, -0.12], [0.6, -0.12], [0.85, -0.04], [0.95, 0.06], [1, 0.14]],
    bilge: 6, dead: 0.08, flare: 1.0, crown: 0.02, transomRake: 0.12, stemX: 0.18,
  },
  model: {
    nameAt: false,
    cockpit: { t0: 0.02, t1: 0.97, w: 0.86, sole: 0.02, seats: false, coaming: 0 },
    bowTransom: true,
    deck: 'nonskid', deckTint: '#f0efe8', toerail: 'teak', cleats: false, navLights: false, windex: false,
    steering: { kind: 'tiller', len: 0.7, rise: 0.06, mat: 'wood', extension: 0.75, r: 0.018 },
    rudder: { kind: 'transom', top: 0.5, bottom: -0.45, chordTop: 0.14, heel: 0.2, mat: 'wood', thick: 0.02 },
    keel: { kind: 'dagger', color: 0xc89a64 },
    masts: { main: { mat: 'alu', r: 0.022, rTop: 0.02, round: true, mastCollar: false, spreaders: [], lowers: false, shrouds: false } },
    extras: ['optiBuoyancy'],
  },
  hw: { style: 'dinghy', trav: [-0.75, 0.45], boomS: 0.62, ratchet: [-0.3, 0.1], helm: 'Tiller extension' },
  noWinches: true,
};
