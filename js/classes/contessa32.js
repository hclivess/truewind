// Contessa 32 (David Sadler, 1970; Jeremy Rogers). The small yacht that finished the 1979 Fastnet storm, and one of
// the most seaworthy 32-footers ever drawn: narrow, heavy, low, with a long fin keel and a skeg-hung rudder.
// Sources: Wikipedia "Contessa 32" (LOA 32 ft 0 in, LWL 24 ft 0 in, beam 9 ft 6 in, draft 5 ft 6 in,
// displacement 9,520 lb, sail area 562 sq ft (with the genoa), two tonnes of lead ballast encapsulated in the fin,
// AVS 155°, fin keel and skeg, inboard diesel 15-25 hp; modern boats a Beta 20/25). Masthead sloop; the rig
// dimensions are not published with the rest, so they are estimated from the profile drawing and the quoted area
// (main + 150% genoa): P ~30.5 ft, E ~11.0 ft, I ~38.5 ft, J ~12.0 ft, which gives 527 sq ft (6% under 562).
// PHRF ~204 (US fleets). Lines shaped to the dimensions and photographs: a long raked spoon bow, a sweet sheer,
// a short counter ending in a small raked transom, slack V sections flowing into the fin.
// Line handling on the real boat: mainsheet to a traveller on the bridge deck at the forward end of the cockpit
// (jam cleats on the car), jib / genoa sheets through cars on genoa tracks on the side decks to two primary winches
// on the cockpit coamings (cleated on horn cleats, or self-tailing on refitted boats), halyards on winches on the
// mast (many now led aft to the coachroof with clutches), slab reefing from the boom, a backstay adjuster (tackle).
import { DEG, FT, LB, SQFT, HP, rrTable, massProps } from './util.js';

const LWL = 24 * FT, M = 9520 * LB, BAL = 2030;
const MP = massProps([{ m: M - BAL - 95, z: 0.3, ry: 0.95, rx: 2.35 }, { m: BAL, z: -1.25, ry: 0.08, rx: 0.55 }, { m: 95, z: 6.6, rz: 3.7 }]);
export default {
  id: 'contessa32', name: 'Contessa 32', group: 'cruiser',
  blurb: "David Sadler's 1970 classic, built by Jeremy Rogers: narrow, low and heavy, two tonnes of lead in a long fin, rudder on a full skeg, positive stability to 155°. In the 1979 Fastnet storm Assent sailed on to the finish. Points high, stands up to it, and asks for nothing.",
  specs: 'LOA 9.75 m · LWL 7.32 m · Beam 2.90 m · Draft 1.68 m · 4,318 kg · 2,030 kg lead · Main 15.6 m² · Genoa (150%) 33.3 m²',
  lwl: LWL, loa: 32 * FT, beam: 9.5 * FT, bowX: 4.95, sternX: -4.8, freeboard: 0.92, canoeDraft: 0.48, wetted: 20, draft: 5.5 * FT,
  massHull: M, zG: MP.zG, crewN: 4, crewEach: 80, crewZ: 0.95, crewMaxOut: 1.15, crewLee: -0.55, hikeRate: 0.5,
  gm: 1.1, bmForm: 0.7, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.06, amY: 0.85, amYaw: 0.55, amRoll: 0.3,
  rr: rrTable(LWL, M + 320),
  keel: { x: 0.42, z: -1.05, area: 1.62, ARe: 2.4, stall: 17 * DEG, cd0: 0.012, span: 1.2, chord: 1.55 },
  rudder: { x: -3.55, z: -0.85, area: 0.5, ARe: 2.4, stall: 20 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.95, chord: 0.52, loadRef: 1400 },
  hullLat: { area: 2.0, cd: 0.9, z: -0.2 },
  windage: { area: 4.3, z: 2.4, cd: 0.95 },
  mastX: 1.02, mastHeight: 13.1, boomZ: 1.72, mastR: 0.065, keelBulb: false,
  targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 2000, reefTime: 60,
  // inboard: Yanmar 2GM20 (18 hp at 3,400 rpm, KM2P 2.2:1) under the cockpit, 2-blade 14 x 9 in prop in the skeg's lee
  engine: { type: 'inboard', model: 'Yanmar 2GM20 (Beta 20 on refitted boats)', kW: 18 * HP, rpmMax: 3400, rpmIdle: 850, cyl: 2, fuel: 'diesel', gear: 2.21,
    prop: { D: 0.36, P: 0.23, Z: 2, BAR: 0.35, folding: false, rh: 1 }, pos: [-2.95, 0, -0.62], mount: [-2.1, 0, -0.1], mass: 115, inMass: true,
    shaftAngle: 9 * DEG, exhaust: [-4.7, 0.5, 0.3] },
  lines: { main: { handler: 'cam', n: 4, at: 'car' }, trav: { handler: 'cam', n: 2, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    vang: { handler: 'cam', n: 8, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' }, outhaul: { handler: 'horn', n: 2, at: 'boom' },
    backstay: { handler: 'horn', n: 4, at: 'deck' }, jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  sails: [
    { key: 'main', kind: 'boom', area: 0.5 * 30.5 * 11.0 * SQFT, luff: 30.5 * FT, foot: 11.0 * FT, head: 0.12, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
      cd0: 0.07, ARe: 4.2, min: 2 * DEG, max: 80 * DEG, trav: [-5 * DEG, 11 * DEG], Iboom: 110, boomMass: 18, reefs: 2,
      vangBend: 0.05, sheetBend: 0.04, color: 0xf2efe6, pockets: [[0.25, 0.16], [0.5, 0.18], [0.75, 0.16]] },
    { key: 'jib', kind: 'loose', area: 33.3, tackX: 4.66, tackZ: 1.1, luff: 11.55, foot: 5.4, head: 0.06, footRise: 0.25,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 10 * DEG, max: 50 * DEG, sagK: 1.3, color: 0xf2efe6, window: false },
  ],
  hull: { color: 0xf3f1ea, stripe: 0xc8a24a, deck: 0xe6e0cf, boot: 0x14305a, bootTop: 0x14305a, levels: [0.03, 0.1, 0.09, 0.08] },
  nameColor: '#c9a24a',
  sailcloth: { cloth: 0xf2efe6, kind: 'dacron', num: '#14305a', logo: '#14305a', trans: 0.3, rough: 0.62 },
  // the class badge: C and O run together, like a figure of eight on its side
  insignia: (g, cx, cy) => {
    g.strokeStyle = '#111316'; g.lineWidth = 9;
    g.beginPath(); g.arc(cx - 22, cy, 22, 0.25 * Math.PI, 1.75 * Math.PI); g.stroke();
    g.beginPath(); g.arc(cx + 22, cy, 22, 0, 2 * Math.PI); g.stroke();
  },
  offsets: {
    sheer: [[0, 0.92], [0.25, 0.86], [0.5, 0.86], [0.75, 0.94], [1, 1.1]],
    deck: [[0, 0.5], [0.08, 0.7], [0.3, 0.95], [0.5, 1.0], [0.7, 0.9], [0.86, 0.6], [0.96, 0.25], [1, 0.02]],
    wl: [[0, 0.3], [0.2, 0.7], [0.5, 0.86], [0.75, 0.74], [0.9, 0.45], [1, 0.2]],
    keel: [[0, 0.48], [0.06, 0.25], [0.12, 0.0], [0.25, -0.34], [0.5, -0.5], [0.7, -0.44], [0.82, -0.25], [0.88, 0.0], [0.94, 0.4], [1, 1.02]],
    bilge: [[0, 1.8], [0.4, 1.9], [0.8, 1.6], [1, 1.3]], dead: [[0, 0.3], [0.4, 0.5], [0.8, 0.7], [1, 0.9]], flare: 0.75,
    crown: 0.07, transomRake: 0.3,
  },
  model: {
    cockpit: { t0: 0.1, t1: 0.36, w: 0.58, sole: 0.52, seat: 0.36, seatW: 0.38, coaming: 0.2, coamingMat: 'teak', thwart: 0.345, thwartH: 0.35 },
    deck: 'teak', toerail: 'teak',
    bands: [{ t0: 0.08, t1: 0.9, z0: 0.14, z1: 0.155, color: 0x14305a }, { t0: 0.08, t1: 0.9, z0: 0.18, z1: 0.195, color: 0x14305a }],
    cabins: [{ t0: 0.365, t1: 0.7, h: [[0.36, 0.3], [0.6, 0.28], [0.7, 0.2]], w: [[0.36, 0.95], [0.55, 0.92], [0.65, 0.8], [0.7, 0.62]],
      slope: 0.08, camber: 0.06, frontRake: 0.35, aftRake: 0.04, color: 0xf3f1ea, roof: 'nonskid', roofTint: '#e6e0cf', eyebrow: 'teak',
      windows: [{ kind: 'rect', t0: 0.42, t1: 0.5, zf: 0.55, hf: 0.44, round: 8 }, { kind: 'rect', t0: 0.53, t1: 0.62, zf: 0.55, hf: 0.44, round: 8 }],
      companion: { w: 0.55, mat: 'teak' }, hatches: [{ t: 0.42, w: 0.62, l: 0.62, kind: 'slide' }, { t: 0.66, w: 0.45, l: 0.45 }], handrails: true,
      vents: [{ t: 0.6, kind: 'dorade', y: 0.4 }] }],
    lifelines: { t0: 0.11, t1: 0.86, h: 0.6 },
    steering: { kind: 'tiller', len: 1.35, rise: 0.12, mat: 'wood' },
    rudder: { kind: 'skeg', color: 0x14305a, thick: 0.1, skegChord: 0.55 },
    keel: { kind: 'fin', chord: 1.8, taper: 0.62, sweep: 0.45, thick: 0.13, color: 0x14305a },
    masts: { main: { mat: 'alu', r: 0.065, spreaders: [{ f: 0.52, len: 0.95, sweep: 0 }] } },
    backstay: { split: false },
  },
  hw: { trav: [-1.3, 0.5], boomS: 0.35, winch: [-2.15, 0.95], jibTrack: [-0.35, -1.4, 1.2], clutchX: -0.4, winchR: 0.07, helm: 'Tiller' },
};
