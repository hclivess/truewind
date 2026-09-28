// Catalina 30 (Frank Butler, 1972-2008; Mk I/II, standard rig, fin keel). Over 6,000 built: the classic 30.
// Sources: sailboatdata.com "Catalina 30" (LOA 29.92 ft, LWL 25.00 ft, beam 10.83 ft, draft 5.25 ft fin keel,
// displacement 10,200 lb, ballast 4,250 lb, I 41.00 ft, J 11.50, P 35.00, E 11.50, main 201.3 sq ft, foretriangle
// 235.8 sq ft, masthead sloop, internally mounted spade rudder, wheel steering); engines Universal 5411 (11 hp),
// Universal M25 / M25XP (21-23 hp) and Yanmar 2GM/3GM (Catalina 30 owners' manual; Wikipedia); PHRF ~180 (US).
// Lines shaped to those dimensions and to photographs of the boat: moderate spoon bow, nearly vertical transom with the swim ladder, a
// slack-bilged U-section canoe body with a separate fin, the rudder well aft.
// Line handling on the real boat: mainsheet 6:1 to a traveller on the bridge deck at the forward end of the
// cockpit (cam cleat on the car, traveller control lines on cam cleats); genoa sheets on self-tailing #16/#22
// primaries on the cockpit coamings via cars on genoa tracks on the side decks; halyards and reef lines led aft
// through rope clutches to a pair of cabin-top winches; boom vang 4:1 to the mast base; backstay fixed or with a
// small tackle; roller-furling headsail (Harken / CDI) on most boats, its furling line to a cam cleat aft.
import { DEG, FT, LB, SQFT, HP, rrTable, massProps } from './util.js';

const LWL = 25.0 * FT, M = 10200 * LB, BAL = 4250 * LB;
// hull shell, deck, interior and engine; the iron fin's centroid 1.1 m down; spars and rigging
const MP = massProps([{ m: M - BAL - 75, z: 0.42, ry: 1.12, rx: 2.3 }, { m: BAL, z: -1.1, ry: 0.1, rx: 0.4 }, { m: 75, z: 7.0, rz: 3.9 }]);
export default {
  id: 'catalina30', name: 'Catalina 30', group: 'cruiser',
  blurb: "Frank Butler's best seller: 6,000+ built from 1972. Masthead sloop with a 135% genoa, iron fin keel, spade rudder, wheel steering in a wide cockpit and teak trim below. Comfortable rather than quick — and there is always another one in the fleet to race.",
  specs: 'LOA 9.12 m · LWL 7.62 m · Beam 3.30 m · Draft 1.60 m · 4,627 kg · 1,928 kg iron fin · Main 18.7 m² · Genoa (135%) 30.0 m²',
  lwl: LWL, loa: 29.92 * FT, beam: 10.83 * FT, bowX: 4.66, sternX: -4.46, freeboard: 1.12, canoeDraft: 0.5, wetted: 23, draft: 5.25 * FT,
  massHull: M, zG: MP.zG, crewN: 4, crewEach: 80, crewZ: 1.15, crewMaxOut: 1.4, crewLee: -0.6, hikeRate: 0.5,
  gm: 1.2, bmForm: 0.8, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.06, amY: 0.8, amYaw: 0.55, amRoll: 0.3,
  rr: rrTable(LWL, M + 320, { prism: 0.1 }),
  keel: { x: 0.32, z: -1.05, area: 1.45, ARe: 2.6, stall: 16 * DEG, cd0: 0.011, span: 1.1, chord: 1.32 },
  rudder: { x: -3.3, z: -0.95, area: 0.52, ARe: 3.0, stall: 17 * DEG, cd0: 0.011, max: 35 * DEG, span: 1.12, chord: 0.46, loadRef: 1500 },
  hullLat: { area: 2.3, cd: 0.9, z: -0.2 },
  windage: { area: 4.6, z: 2.6, cd: 0.95 },
  mastX: 1.06, mastHeight: 13.85, boomZ: 2.78, mastR: 0.07, keelBulb: false,
  targetHeel: 18 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 2200, reefTime: 60,
  // inboard: Universal M25XP (3-cyl diesel, 23 hp at 3,000 rpm, 2:1 Hurth box), 2-blade fixed 13 x 9 in prop
  engine: { type: 'inboard', model: 'Universal M25XP', kW: 23 * HP, rpmMax: 3000, rpmIdle: 850, cyl: 3, fuel: 'diesel', gear: 2.0,
    prop: { D: 0.33, P: 0.23, Z: 2, BAR: 0.35, folding: false, rh: 1 }, pos: [-2.75, 0, -0.62], mount: [-1.9, 0, -0.05], mass: 125, inMass: true,
    shaftAngle: 11 * DEG, exhaust: [-4.4, 0.6, 0.35] },
  lines: { main: { handler: 'cam', n: 6, at: 'car' }, trav: { handler: 'cam', n: 3, at: 'deck' }, jib: { handler: 'selfTailer', at: 'winch' },
    vang: { handler: 'cam', n: 8, at: 'deck' }, cunn: { handler: 'clutch', n: 2, winch: 'cabin', at: 'cabin' }, outhaul: { handler: 'clutch', n: 2, winch: 'cabin', at: 'cabin' },
    backstay: { handler: 'horn', n: 4, at: 'deck' }, jibHalyard: { handler: 'clutch', winch: 'cabin', at: 'cabin' } },
  sails: [
    { key: 'main', kind: 'boom', area: 201.3 * SQFT * 1.04, luff: 35 * FT, foot: 11.5 * FT, head: 0.15, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
      cd0: 0.07, ARe: 4.2, min: 2 * DEG, max: 80 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 150, boomMass: 22, reefs: 2,
      vangBend: 0.05, sheetBend: 0.04, color: 0xf2f0e8 },
    { key: 'jib', kind: 'loose', area: 30.0, tackX: 4.58, tackZ: 1.36, luff: 12.3, foot: 4.9, head: 0.06, footRise: 0.35,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 10 * DEG, max: 50 * DEG, sagK: 1.3, color: 0xf2f0e8, window: false },
  ],
  hull: { color: 0xf3f2ec, stripe: 0xb3262a, deck: 0xe9e3d3, boot: 0x1b2f52, bootTop: 0x6b3f22, levels: [0.03, 0.09, 0.2, 0.12] },
  cloth: 'dacronCruise',   // (the cloth solver's stiffness and weight: Dacron, as the renderer and js/damage.js have it)
  sailcloth: { cloth: 0xf2f0e8, kind: 'dacron', num: '#1d2a44', logo: '#8a2a1e', trans: 0.3, rough: 0.62 },
  // the class insignia: Catalina's bold open 'C' round the class number
  // the Catalina insignia (as on the class's mains): a red diamond with a white sail in it, the class number below
  insignia: (g, cx, cy) => {
    g.fillStyle = '#c8282e'; g.beginPath(); g.moveTo(cx, cy - 46); g.lineTo(cx + 30, cy - 4); g.lineTo(cx, cy + 38); g.lineTo(cx - 30, cy - 4); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - 4, cy - 30); g.lineTo(cx - 4, cy + 14); g.lineTo(cx + 16, cy + 14); g.fill();
    g.beginPath(); g.moveTo(cx - 8, cy - 22); g.lineTo(cx - 8, cy + 14); g.lineTo(cx - 20, cy + 14); g.fill();
    g.font = 'bold 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillStyle = '#c8282e'; g.fillText('30', cx + 56, cy + 12);
  },
  offsets: {
    sheer: [[0, 1.02], [0.25, 1.02], [0.55, 1.08], [0.8, 1.2], [1, 1.33]],
    deck: [[0, 0.82], [0.12, 0.9], [0.4, 1.0], [0.62, 0.96], [0.82, 0.72], [0.94, 0.38], [1, 0.03]],
    wl: [[0, 0.62], [0.35, 0.86], [0.7, 0.84], [0.88, 0.58], [1, 0.3]],
    keel: [[0, 0.1], [0.05, -0.08], [0.2, -0.38], [0.48, -0.52], [0.7, -0.45], [0.84, -0.24], [0.9, 0.0], [0.95, 0.4], [1, 1.0]],
    bilge: [[0, 3.4], [0.45, 2.4], [0.8, 1.9], [1, 1.5]], dead: [[0, 0.12], [0.45, 0.3], [0.8, 0.55], [1, 0.8]], flare: 0.75,
    crown: 0.06, transomRake: -0.08,
  },
  model: {
    bands: [{ t0: 0.02, t1: 0.99, z0: 0.82, z1: 0.845, color: 0x1b2f52 }],
    cockpit: { t0: 0.02, t1: 0.33, w: 0.62, sole: 0.66, seat: 0.4, seatW: 0.42, coaming: 0.18, coamingMat: 'teak', thwart: 0.31, thwartH: 0.38, table: 0.2 },
    deck: 'nonskid', deckTint: '#e7e1cf', toerail: 'alu',
    cabins: [{ t0: 0.335, t1: 0.73, h: [[0.33, 0.5], [0.6, 0.48], [0.73, 0.36]], w: [[0.33, 1.08], [0.55, 1.05], [0.66, 0.92], [0.73, 0.7]],
      slope: 0.08, camber: 0.07, frontRake: 0.5, aftRake: 0.04, color: 0xf3f2ec, roof: 'nonskid', roofTint: '#e7e1cf', eyebrow: 'teak',
      windows: [{ kind: 'rect', t0: 0.37, t1: 0.44, zf: 0.58, hf: 0.42, round: 6 }, { kind: 'rect', t0: 0.46, t1: 0.53, zf: 0.58, hf: 0.42, round: 6 }, { kind: 'rect', t0: 0.55, t1: 0.62, zf: 0.58, hf: 0.42, round: 6 }, { kind: 'rect', t0: 0.64, t1: 0.69, zf: 0.6, hf: 0.36, round: 6, skew: -0.06 }],
      companion: { w: 0.6, mat: 'teak' }, hatches: [{ t: 0.4, w: 0.7, l: 0.7, kind: 'slide' }, { t: 0.69, w: 0.5, l: 0.5 }], handrails: true,
      vents: [{ t: 0.62, kind: 'mushroom', y: 0.35 }] }],
    lifelines: { t0: 0.06, t1: 0.86, h: 0.62 },
    steering: { kind: 'wheel', x: -3.35, r: 0.42, hub: 0.9 },
    rudder: { kind: 'spade', color: 0x1b2f52, thick: 0.1 },
    keel: { kind: 'fin', chord: 1.5, taper: 0.66, sweep: 0.3, thick: 0.13, color: 0x1b2f52 },
    masts: { main: { mat: 'alu', r: 0.07, spreaders: [{ f: 0.5, len: 1.05, sweep: 0 }] } },
    backstay: { split: true, splitH: 1.4 },
  },
  hw: { trav: [-1.62, 0.6], boomS: 0.62, winch: [-2.1, 1.3], jibTrack: [-0.3, -1.6, 1.35], cabinWinch: [-0.5, 0.55], clutchX: -0.35, winchR: 0.075, helm: 'Wheel' },
};
