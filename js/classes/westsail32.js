// Westsail 32 (William Crealock after William Atkin's Eric / Colin Archer's redningsskøyte, 1971-80; ~830 built):
// the double-ended, full-keel cutter that launched a generation of blue-water cruisers.
// Sources: Wikipedia "Westsail 32" (LOD 32 ft 0 in, LWL 27 ft 6 in, beam 11 ft 0 in, draft 5 ft 0 in, displacement
// 19,500 lb, ballast 7,000 lb inside the keel (lead and iron on early boats, all lead later), sail area 629 sq ft,
// Bermudan cutter, long keel); sailboatdata.com "Westsail 32" (LOA 32.00 ft on deck, ~39 ft 10 in over the bowsprit
// and boomkin; engine Volvo Penta MD2B 25 hp as standard, Perkins 4-107/4-108 optional); PHRF ~222 (US).
// The rig split (main ~23, staysail ~13, yankee ~20 m²) is estimated from the class sail plan drawing and the
// quoted total. Lines shaped to the dimensions and photographs: a raked stem with a cutaway forefoot, a canoe
// (Norwegian) stern with the rudder hung outboard on the sternpost, slack bilges, a long straight keel.
// Line handling on the real boat: mainsheet from the boom end to a traveller on the boomkin-side of the stern deck
// (mainsheet on a cam or jam cleat); staysail on a club boom with its sheet to a deck traveller forward of the mast
// (self-tending); yankee sheets through blocks on the bulwark cap to primary winches on the cockpit coamings,
// cleated on horn cleats; halyards on winches on the mast, belayed to cleats / a pinrail at the mast; slab reefing.
import { DEG, FT, LB, HP, rrTable, massProps } from './util.js';

const LWL = 27.5 * FT, M = 19500 * LB, BAL = 7000 * LB;
const MP = massProps([{ m: M - BAL - 230, z: 0.45, ry: 1.15, rx: 2.5 }, { m: BAL, z: -0.9, ry: 0.15, rx: 1.2 }, { m: 230, z: 6.8, rz: 4.0 }]);
export default {
  id: 'westsail32', name: 'Westsail 32', group: 'cruiser',
  blurb: "The 'Wet Snail': a 32 ft double-ender after Colin Archer's rescue boats, nine tonnes of it. Full keel, canoe stern with the rudder hung outboard, bowsprit and boomkin, cutter rig with a club-footed staysail. Slow in light air, unstoppable in a gale.",
  specs: 'LOD 9.75 m (12.1 m over sprit and boomkin) · LWL 8.38 m · Beam 3.35 m · Draft 1.52 m · 8,845 kg · 3,175 kg ballast · 58 m² (main, staysail, yankee)',
  lwl: LWL, loa: 32 * FT, beam: 11 * FT, bowX: 4.95, sternX: -4.8, freeboard: 1.15, canoeDraft: 0.62, wetted: 32, draft: 5 * FT,
  bowsprit: 1.3, cabin: true, longKeel: true,
  massHull: M, zG: MP.zG, crewN: 3, crewEach: 80, crewZ: 1.2, crewMaxOut: 1.3, crewLee: -0.6, hikeRate: 0.45,
  gm: 1.1, bmForm: 0.8, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.08, amY: 0.95, amYaw: 0.65, amRoll: 0.32,
  rr: rrTable(LWL, M + 240, { prism: -0.05 }),
  // (a long keel is part of the lines: its skin friction is in the hull's, so the foil keeps only its form drag)
  keel: { x: 0.1, z: -0.95, area: 3.3, ARe: 1.0, stall: 26 * DEG, cd0: 0.003, span: 0.9, chord: 4.4, long: true },
  rudder: { x: -4.95, z: -0.6, area: 0.78, ARe: 2.0, stall: 22 * DEG, cd0: 0.014, max: 35 * DEG, span: 1.35, chord: 0.62, transom: true, loadRef: 2200 },
  hullLat: { area: 2.8, cd: 0.9, z: -0.25 },
  windage: { area: 5.6, z: 2.6, cd: 0.95 },
  mastX: 0.6, mastHeight: 14.3, boomZ: 2.45, mastR: 0.075, keelBulb: false,
  targetHeel: 18 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 2400, reefTime: 75,
  // inboard: Volvo Penta MD2B (2-cyl diesel, 25 hp at 2,500 rpm, 2:1 reverse gear), 3-blade 16 x 11 in prop in the
  // aperture between the keel and the rudder
  engine: { type: 'inboard', model: 'Volvo Penta MD2B', kW: 25 * HP, rpmMax: 2500, rpmIdle: 750, cyl: 2, fuel: 'diesel', gear: 2.0,
    prop: { D: 0.41, P: 0.28, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-4.4, 0, -0.8], mount: [-2.8, 0, -0.2], mass: 180, inMass: true,
    shaftAngle: 7 * DEG, exhaust: [-4.6, 0.7, 0.4] },
  lines: { main: { handler: 'cam', n: 4, at: 'car' }, trav: { handler: 'horn', n: 1, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    stay: { handler: 'horn', n: 2, at: 'cabin' }, vang: { handler: 'horn', n: 4, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' },
    outhaul: { handler: 'horn', n: 2, at: 'boom' }, backstay: { handler: 'horn', n: 1, at: 'deck' }, jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  ropeStyle: 'classic',
  sails: [
    { key: 'main', kind: 'boom', area: 23.3, luff: 10.1, foot: 4.4, head: 0.14, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
      cd0: 0.07, ARe: 3.8, min: 2 * DEG, max: 80 * DEG, trav: [-4 * DEG, 11 * DEG], Iboom: 220, boomMass: 30, reefs: 2,
      vangBend: 0.04, sheetBend: 0.03, color: 0xf0ebdf, pockets: [[0.25, 0.14], [0.5, 0.16], [0.75, 0.14]] },
    { key: 'stay', kind: 'boom', selfTacking: true, area: 12.5, tackX: 3.4, tackZ: 1.62, luff: 10.0, foot: 2.5, head: 0.05,
      depth: [0.12, 0.13, 0.11], twistMax: 14 * DEG, cd0: 0.05, ARe: 3.5, min: 5 * DEG, max: 55 * DEG, Iboom: 30, boomMass: 10, color: 0xf0ebdf, clubVang: true },
    { key: 'jib', kind: 'loose', area: 20.0, tackX: 6.15, tackZ: 1.75, luff: 12.1, foot: 4.4, head: 0.05, footRise: 1.1,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 12 * DEG, max: 55 * DEG, sagK: 1.5, color: 0xf0ebdf, window: false },
  ],
  hull: { color: 0xf2efe6, stripe: 0x1f5a3a, deck: 0xd8cfb8, boot: 0x9a2e22, bootTop: 0x1f5a3a, levels: [0.05, 0.13, 0.32, -0.05] },
  sailcloth: { cloth: 0xf0ebdf, kind: 'dacron', num: '#1b3d2f', logo: '#1b3d2f', trans: 0.28, rough: 0.64 },
  insignia: 'W32',
  offsets: {
    sheer: [[0, 1.3], [0.2, 1.14], [0.5, 1.1], [0.8, 1.22], [1, 1.42]],
    deck: [[0, 0.02], [0.06, 0.26], [0.14, 0.5], [0.26, 0.8], [0.45, 1.0], [0.65, 0.95], [0.85, 0.66], [0.96, 0.28], [1, 0.03]],
    wl: [[0, 0.5], [0.1, 0.6], [0.45, 0.88], [0.8, 0.72], [1, 0.3]],
    keel: [[0, 0.6], [0.05, 0.14], [0.12, -0.28], [0.3, -0.6], [0.6, -0.64], [0.82, -0.38], [0.91, 0.06], [0.96, 0.4], [1, 1.1]],
    fin: [[0.005, -0.9], [0.05, -1.45], [0.5, -1.52], [0.72, -1.3], [0.84, -0.75], [0.9, -0.3]], finW: 0.2,
    bilge: [[0, 1.6], [0.45, 2.0], [0.9, 1.6]], dead: [[0, 0.55], [0.45, 0.45], [0.9, 0.7]], flare: 0.8,
    crown: 0.08, transomRake: 0, tumble: 0.02,
  },
  model: {
    cockpit: { t0: 0.1, t1: 0.33, w: 0.58, sole: 0.72, seat: 0.38, seatW: 0.36, coaming: 0.24, coamingMat: 'teak', seatMat: 'teak', grating: true },
    deck: 'teak', toerail: { bulwark: 0.2, cap: 'teak', color: 0x1f5a3a },
    hullPorts: [{ t0: 0.4, t1: 0.66, n: 4, z: 1.02, r: 0.055 }], bronze: true,
    cabins: [{ t0: 0.34, t1: 0.72, h: [[0.34, 0.48], [0.6, 0.46], [0.72, 0.36]], w: [[0.34, 1.15], [0.55, 1.12], [0.66, 0.98], [0.72, 0.75]],
      slope: 0.05, camber: 0.07, frontRake: 0.12, aftRake: 0.03, color: 0xf2efe6, side: 'teak', roof: 'paint', roofColor: 0xe0d8c2, eyebrow: 'teak',
      windows: [{ kind: 'port', t0: 0.4, t1: 0.66, n: 4, r: 0.065, zf: 0.5, mat: 'bronze' }], companion: { w: 0.55, mat: 'teak' },
      hatches: [{ t: 0.39, w: 0.62, l: 0.62, kind: 'slide' }, { t: 0.63, w: 0.55, l: 0.55 }], handrails: true, trim: 'teak',
      vents: [{ t: 0.66, kind: 'dorade', y: 0.45 }] }],
    lifelines: { t0: 0.1, t1: 0.9, h: 0.62, pushX: 0.4 },
    steering: { kind: 'tiller', len: 1.5, rise: 0.15, mat: 'wood', dz: 0.02 },
    rudder: { kind: 'transom', x: -4.95, top: 1.45, bottom: -1.45, chordTop: 0.3, heel: 0.25, lean: 0.12, mat: 'wood', thick: 0.06, pintles: [-1.2, -0.5, 0.3, 1.1] },
    keel: { kind: 'full' },
    bowsprit: { len: 1.3, kind: 'plank', w: 0.36, mat: 'teak', pulpit: true, anchor: true, inboard: 0.9, bobZ: 0.15 },
    bumpkin: { len: 1.0, dz: 0.1 },
    masts: { main: { mat: 'alu', r: 0.075, spreaders: [{ f: 0.52, len: 1.0, sweep: 0 }] } },
    backstay: { split: false, x: -5.75, z: 1.35 },
    hullName: { t: 0.1, z: 1.0, len: 1.1, color: '#1b3d2f' },   // (a canoe stern: the name goes on the quarters)
  },
  hw: { trav: [-4.3, 0.55], boomS: 0.96, winch: [-2.3, 1.1], jibTrack: [0.6, -0.6, 1.5], clutchX: -0.4, winchR: 0.07, bronze: true, helm: 'Tiller' },
};
