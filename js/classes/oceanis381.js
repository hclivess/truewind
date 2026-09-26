// Beneteau Oceanis 38.1 (Finot-Conq / Nauta, 2016-): the modern production cruiser. Plumb bow with an integrated
// anchor sprit, hard chine aft, twin wheels, a drop-down transom, in-mast furling main and a big genoa.
// Sources: Beneteau specification sheet 2021 (via nova-yachting.nl / signature-yachts.com PDFs) and boat-specs.com
// "Océanis 38.1 Deep draft": LOA 11.50 m (11.80 m incl. the bowsprit), hull length 11.13 m, LWL 10.72 m, beam
// 3.99 m, light displacement 6,850 kg, draft 2.09 m (deep) / 1.64 m (shoal), ballast 1,790 kg cast iron (deep),
// furling mainsail 30.0 m², 103% genoa 33.0 m²; engine Yanmar 3JH5E 40 hp on an SD60 saildrive (itboat.com,
// clickandboat.com listings); boats.com review (2017). Lines shaped to those dimensions and to photographs.
// Line handling on the real boat: German-style mainsheet from the boom to the coachroof and aft through clutches to
// the cabin-top winches either side of the companionway (no traveller); genoa sheets via cars on short tracks on
// the coachroof sides / side decks to the primary winches by the twin wheels; halyards, furling lines, reef
// (outhaul of the in-mast main) all led aft under the deck to the clutch banks; rigid vang; fixed backstay.
import { DEG, HP, rrTable, massProps } from './util.js';

const LWL = 10.72, M = 6850, BAL = 1790;
const MP = massProps([{ m: M - BAL - 160, z: 0.55, ry: 1.35, rx: 2.9 }, { m: BAL, z: -1.45, ry: 0.12, rx: 0.5 }, { m: 160, z: 8.2, rz: 4.6 }]);
export default {
  id: 'oceanis381', name: 'Beneteau Oceanis 38.1', group: 'cruiser',
  blurb: "Beneteau's 38-footer from Finot-Conq: plumb bow, hard chine aft, hull windows, twin wheels, a transom that folds down into a swim platform. In-mast furling main and a big 103% genoa, cast iron keel. Roomy, quick in a breeze, and it reefs by winding a handle.",
  specs: 'Hull 11.13 m · LWL 10.72 m · Beam 3.99 m · Draft 2.09 m · 6,850 kg · 1,790 kg iron keel · Main (furling) 30.0 m² · Genoa (103%) 33.0 m²',
  lwl: LWL, loa: 11.13, beam: 3.99, bowX: 5.62, sternX: -5.51, freeboard: 1.36, canoeDraft: 0.55, wetted: 29, draft: 2.09,
  bowsprit: 0,
  massHull: M, zG: MP.zG, crewN: 5, crewEach: 80, crewZ: 1.35, crewMaxOut: 1.8, crewLee: -0.8, hikeRate: 0.45,
  gm: 1.4, bmForm: 1.0, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.05, amY: 0.75, amYaw: 0.5, amRoll: 0.3,
  rr: rrTable(LWL, M + 400, { prism: 0.15, planing: 0.15 }),
  keel: { x: 0.8, z: -1.35, area: 1.62, ARe: 3.3, stall: 15 * DEG, cd0: 0.01, span: 1.5, chord: 1.08 },
  rudder: { x: -4.25, z: -1.0, area: 0.72, ARe: 3.4, stall: 16 * DEG, cd0: 0.011, max: 32 * DEG, span: 1.38, chord: 0.54, loadRef: 2600 },
  hullLat: { area: 3.2, cd: 0.9, z: -0.25 },
  windage: { area: 6.8, z: 3.1, cd: 0.95 },
  mastX: 1.55, mastHeight: 16.6, boomZ: 2.55, mastR: 0.1, keelBulb: false,
  targetHeel: 17 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 3200, reefTime: 30,
  // saildrive: Yanmar 3JH5E (29.4 kW at 3,000 rpm) on an SD60 leg (2.49:1), 3-blade folding 17 x 12 in prop
  engine: { type: 'saildrive', kW: 40 * HP, rpmMax: 3000, gear: 2.49, prop: { D: 0.43, P: 0.3, Z: 3, folding: true, rh: true }, pos: [-2.6, 0, -0.95], shaftAngle: 0, tiltable: false },
  sails: [
    // in-mast furling: no battens, a hollow leech; it reefs by rolling into the mast
    { key: 'main', kind: 'boom', area: 30.0, luff: 13.7, foot: 4.75, head: 0.2, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG, roach: -0.02,
      cd0: 0.07, ARe: 4.4, min: 2 * DEG, max: 78 * DEG, trav: null, Iboom: 260, boomMass: 30, reefs: 2,
      vangBend: 0.03, sheetBend: 0.03, color: 0xf1f1ec, pockets: [], battens: { EI: 0, rows: [] }, furling: true },
    { key: 'jib', kind: 'loose', area: 33.0, tackX: 5.58, tackZ: 1.55, luff: 13.7, foot: 5.25, head: 0.06, footRise: 0.45,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.9, min: 10 * DEG, max: 50 * DEG, sagK: 1.2, color: 0xf1f1ec, window: false },
  ],
  hull: { color: 0xf5f6f4, stripe: 0x3b4450, deck: 0xdcdcd6, boot: 0x2c3036, bootTop: 0x3b4450, levels: [0.05, 0.12, 0.1, 0.06] },
  sailcloth: { cloth: 0xf1f1ec, kind: 'dacron', num: '#1d2a44', logo: '#1d2a44', trans: 0.28, rough: 0.55 },
  insignia: '38.1',
  lines: {
    sheer: [[0, 1.2], [0.3, 1.26], [0.6, 1.34], [0.85, 1.42], [1, 1.47]],
    deck: [[0, 0.9], [0.1, 0.95], [0.4, 1.0], [0.65, 0.95], [0.85, 0.72], [0.96, 0.4], [1, 0.12]],
    wl: [[0, 0.78], [0.35, 0.88], [0.65, 0.84], [0.88, 0.62], [1, 0.25]],
    keel: [[0, 0.1], [0.02, -0.06], [0.1, -0.26], [0.35, -0.5], [0.6, -0.55], [0.82, -0.36], [0.95, -0.14], [0.99, 0.05], [1, 1.2]],
    bilge: [[0, 6], [0.35, 4.2], [0.7, 2.4], [1, 1.7]], dead: [[0, 0.05], [0.4, 0.2], [0.8, 0.55], [1, 0.85]], flare: [[0, 1.1], [0.5, 0.9], [1, 0.8]],
    crown: 0.05, transomRake: -0.05,
  },
  model: {
    cockpit: { t0: 0.02, t1: 0.33, w: 0.7, sole: 0.9, seat: 0.4, seatW: 0.46, coaming: 0.22, table: 0.22, seatMat: 'teak' },
    deck: 'nonskid', deckTint: '#e2e2dc', toerail: 'alu',
    hullWindows: [{ t0: 0.52, t1: 0.74, z0: 0.72, z1: 0.84 }, { t0: 0.2, t1: 0.3, z0: 0.74, z1: 0.83 }],
    cabins: [{ t0: 0.335, t1: 0.74, h: [[0.33, 0.52], [0.6, 0.5], [0.74, 0.28]], w: [[0.33, 1.3], [0.55, 1.28], [0.68, 1.1], [0.74, 0.85]],
      slope: 0.12, camber: 0.05, frontRake: 0.9, aftRake: 0.08, color: 0xf3f3f0, roof: 'nonskid', roofTint: '#e2e2dc',
      windows: [{ kind: 'rect', t0: 0.4, t1: 0.66, zf: 0.62, hf: 0.38, round: 6, skew: -0.08 }, { kind: 'front', n: 3, w: 0.75 }],
      companion: { w: 0.7 }, hatches: [{ t: 0.4, w: 0.8, l: 0.8, kind: 'slide' }, { t: 0.55, w: 0.55, l: 0.55 }, { t: 0.7, w: 0.6, l: 0.6 }], handrails: true }],
    lifelines: { t0: 0.05, t1: 0.9, h: 0.62, spacing: 1.2 },
    steering: { kind: 'twin', x: -4.25, y: 0.95, r: 0.45, hub: 0.95 },
    rudder: { kind: 'spade', color: 0x2c3036, thick: 0.1 },
    keel: { kind: 'fin', chord: 1.2, taper: 0.7, sweep: 0.12, thick: 0.1, color: 0x2c3036, bulb: { len: 1.5, r: 0.17, fwd: 0.3, flat: 1.4 } },
    bowsprit: { len: 0.4, kind: 'plank', w: 0.18, mat: 'steel', bobstay: false, anchor: true, inboard: 0.4 },
    masts: { main: { mat: 'alu', r: 0.1, spreaders: [{ f: 0.38, len: 1.3, sweep: 18 * DEG }, { f: 0.7, len: 0.85, sweep: 18 * DEG }], round: false } },
    backstay: { split: false, x: -5.4 },
    extras: ['swimPlatform'],
  },
  hw: { trav: [-0.1, 0.1, 2.35], boomS: 0.55, winch: [-3.7, 1.55], jibTrack: [0.4, -0.55, 1.2], cabinWinch: [-0.1, 0.72], clutchX: 0.2, winchR: 0.085, helm: 'Wheel' },
};
