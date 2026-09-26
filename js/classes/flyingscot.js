// Flying Scot (Gordon K. "Sandy" Douglass, 1957): the big, stable, family centreboard one-design of US lakes and bays.
// Picked over the Lightning (the two are the same size; the Scot is the one more people own and sail).
// Sources: Wikipedia "Flying Scot (dinghy)" / sailboatdata.com (LOA 19.00 ft, LWL 18.50 ft, beam 6.75 ft, draft
// 8 in board up / 4.00 ft board down, displacement 850 lb, main 138 sq ft, jib 53 sq ft, total 191 sq ft, spinnaker
// 200 sq ft, fractional sloop, centreboard, transom-hung rudder), Flying Scot Sailing Association class rules (crew
// 2-3); US Portsmouth DPN 90. Lines shaped to the dimensions and photographs: a beamy, flared, hard-bilged hull, a
// long foredeck with a small cuddy, a big open cockpit with wide side seats.
// Line handling on the real boat: mainsheet 4:1 from the boom's middle to a swivel cam block on the centreboard
// trunk (centre sheeting, no traveller), jib sheets through fairleads on the side decks to cam cleats on the
// seats, spinnaker sheets and guys to cam cleats aft with twings, halyards to cleats at the mast base, board lifted
// by a pennant to a cam cleat on the trunk.
import { DEG, FT, LB, SQFT, rrTable } from './util.js';

const LWL = 18.5 * FT, M = 850 * LB;
export default {
  id: 'flyingscot', name: 'Flying Scot', group: 'dinghy',
  blurb: "Sandy Douglass's 1957 family one-design: 19 ft, beamy and stable enough that it rarely capsizes, with a big centreboard, a fractional rig and a spinnaker on a pole. Three up, lots of room, and one of the biggest one-design fleets in America.",
  specs: 'LOA 5.79 m · LWL 5.64 m · Beam 2.06 m · Draft 0.20 / 1.22 m · 386 kg · Main 12.8 m² · Jib 4.9 m² · Spinnaker 18.6 m²',
  lwl: LWL, loa: 19 * FT, beam: 6.75 * FT, bowX: 2.95, sternX: -2.84, freeboard: 0.62, canoeDraft: 0.18, wetted: 7.0, draft: 4.0 * FT,
  massHull: M, zG: 0.3, crewN: 3, crewEach: 75, crewZ: 0.5, crewMaxOut: 0.98, crewLee: -0.35, hikeRate: 0.9,
  gm: 0.6, bmForm: 0.55, Ixx: 420, Izz: 900, amX: 0.05, amY: 0.6, amYaw: 0.45, amRoll: 0.25,
  rr: rrTable(LWL, M + 225, { planing: 0.8 }),
  keel: { x: 0.35, z: -0.6, area: 0.52, ARe: 4.0, stall: 13 * DEG, cd0: 0.011, span: 1.0, chord: 0.55, board: true },
  rudder: { x: -2.95, z: -0.3, area: 0.2, ARe: 3.0, stall: 15 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.72, chord: 0.3, transom: true, loadRef: 420 },
  hullLat: { area: 0.6, cd: 0.9, z: -0.06 },
  windage: { area: 1.6, z: 1.0, cd: 1.0 },
  mastX: 1.05, mastHeight: 8.55, boomZ: 1.18, mastR: 0.04, keelBulb: false,
  targetHeel: 10 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 520,
  engine: null,
  sails: [
    { key: 'main', kind: 'boom', area: 138 * SQFT, luff: 7.15, foot: 3.25, head: 0.14, depth: [0.12, 0.14, 0.12], twistMax: 22 * DEG,
      cd0: 0.06, ARe: 4.0, min: 2 * DEG, max: 85 * DEG, trav: null, Iboom: 16, boomMass: 6, reefs: 0,
      vangBend: 0.3, sheetBend: 0.2, color: 0xf6f5f0, pockets: [[0.22, 0.2], [0.45, 0.22], [0.68, 0.22], [0.88, 0.2]] },
    { key: 'jib', kind: 'loose', area: 53 * SQFT, tackX: 2.95, tackZ: 0.66, luff: 5.55, foot: 1.82, head: 0.05, footRise: 0.25,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.0, min: 9 * DEG, max: 45 * DEG, sagK: 1.2, color: 0xf6f5f0 },
    { key: 'gennaker', kind: 'spin', pole: 1.95, area: 200 * SQFT, tackX: 2.95, tackZ: 0.95, luff: 5.8, rake: 1.9, fixedRake: true, foot: 3.5, head: 0.35,
      depth: [0.2, 0.22, 0.2], cd0: 0.1, ARe: 1.8, min: 18 * DEG, max: 100 * DEG, color: 0x1f5fb0 },
  ],
  hull: { color: 0xf6f6f2, stripe: 0x1d4f8c, deck: 0xf0efe8, boot: 0x9fc6e0, bare: false, levels: [0.02, 0.06, 0.06, 0.035] },
  sailcloth: { cloth: 0xf6f5f0, kind: 'dacron', num: '#1d2a44', logo: '#1d2a44', trans: 0.34, rough: 0.58 },
  // the class insignia: a St Andrew's cross (saltire) on a shield
  insignia: (g, cx, cy) => {
    g.fillStyle = '#1d4f8c'; g.beginPath(); g.moveTo(cx - 34, cy - 38); g.lineTo(cx + 34, cy - 38); g.lineTo(cx + 34, cy + 6); g.quadraticCurveTo(cx + 30, cy + 34, cx, cy + 44); g.quadraticCurveTo(cx - 30, cy + 34, cx - 34, cy + 6); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 9; g.beginPath(); g.moveTo(cx - 28, cy - 32); g.lineTo(cx + 26, cy + 30); g.moveTo(cx + 28, cy - 32); g.lineTo(cx - 26, cy + 30); g.stroke();
  },
  lines: {
    sheer: [[0, 0.56], [0.4, 0.58], [0.75, 0.66], [1, 0.8]],
    deck: [[0, 0.8], [0.2, 0.93], [0.5, 1.0], [0.75, 0.86], [0.92, 0.46], [1, 0.03]],
    wl: [[0, 0.72], [0.45, 0.82], [0.8, 0.72], [1, 0.2]],
    keel: [[0, -0.03], [0.05, -0.09], [0.35, -0.2], [0.6, -0.2], [0.85, -0.12], [0.96, -0.03], [1, 0.3]],
    bilge: [[0, 4], [0.5, 3.2], [1, 2]], dead: [[0, 0.1], [0.5, 0.3], [1, 0.7]], flare: 0.9, crown: 0.05, transomRake: 0.08,
  },
  model: {
    cockpit: { t0: 0.02, t1: 0.66, w: 0.8, sole: 0.12, seat: 0.3, seatW: 0.34, coaming: 0.08, color: 0xf0efe8 },
    deck: 'nonskid', deckTint: '#f0efe8', toerail: 'alu', navLights: false,
    cabins: [{ t0: 0.66, t1: 0.8, h: [[0.66, 0.12], [0.8, 0.02]], w: [[0.66, 0.72], [0.8, 0.5]], slope: 0.04, camber: 0.04, frontRake: 0.3, aftRake: 0.02, color: 0xf0efe8, roof: 'same' }],
    steering: { kind: 'tiller', len: 0.95, rise: 0.08, mat: 'wood', extension: 1.0 },
    rudder: { kind: 'transom', top: 0.6, bottom: -0.72, chordTop: 0.18, heel: 0.25, mat: 'wood', thick: 0.03 },
    keel: { kind: 'centreboard', len: 1.25, width: 0.62, thick: 0.03, pivotX: 0.62, upAngle: -1.45, color: 0xf2f2ee, trunk: { h: 0.3, len: 1.5 } },
    masts: { main: { mat: 'alu', r: 0.04, spreaders: [{ f: 0.52, len: 0.55, sweep: 20 * DEG }], hounds: 6.85 } },
    backstay: false,
  },
  hw: { style: 'dinghy', trav: [-1.4, 0.2], boomS: 0.55, ratchet: [-0.2, 0.3], jibTrack: [0.25, -0.35, 0.82], winch: [-0.7, 0.82], helm: 'Tiller extension' },
  noWinches: true,
};
