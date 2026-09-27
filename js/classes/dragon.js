// International Dragon (Johan Anker, 1929; Olympic 1948-72): the long-overhang classic keelboat one-design.
// Sources: Wikipedia "Dragon (keelboat)" (LOA 8.90 m, LWL 5.66 m, beam 1.95 m, draft 1.20 m, displacement 1,700 kg,
// main 16.0 m², jib 11.7 m², upwind 27.7 m², spinnaker 23.6 m², crew 3 (maximum 285 kg), fixed keel; RYA Portsmouth
// Yardstick 986); International Dragon Association class rules (ballast keel about 1,000 kg, fractional rig with a
// backstay and running backstays, spinnaker on a pole). Lines shaped to the dimensions and photographs: long spoon
// bow and counter, a narrow deep-V hull, the keel running into the hull with the rudder hung on its trailing edge.
// Line handling on the real boat: mainsheet from the boom's middle to a traveller / swivel block on the cockpit
// floor with a fine tune; jib sheets on small winches (or 2-speed ratchets) with cam cleats, the jib car led
// athwartships with a barber-hauler; backstay and runners on tackles to cam cleats; vang, Cunningham and outhaul led
// to both sides of the cockpit; spinnaker sheets and guys on cam cleats with twings; pole topping lift / downhaul
// cleated at the mast.
import { DEG, rrTable, massProps } from './util.js';

const LWL = 5.66, M = 1700, BAL = 1000;
const MP = massProps([{ m: M - BAL - 45, z: 0.35, ry: 0.65, rx: 2.3 }, { m: BAL, z: -0.95, ry: 0.06, rx: 0.8 }, { m: 45, z: 5.5, rz: 2.9 }]);
export default {
  id: 'dragon', name: 'Dragon', group: 'keelboat',
  blurb: "Johan Anker's 1929 design, Olympic from 1948 to 1972 and still raced by kings: 8.9 m of varnish-and-navy elegance on a 5.7 m waterline. Long overhangs that lengthen her as she heels, a long keel with the rudder on it, three crew, runners and a spinnaker on a pole.",
  specs: 'LOA 8.90 m · LWL 5.66 m · Beam 1.95 m · Draft 1.20 m · 1,700 kg · ~1,000 kg ballast · Main 16.0 m² · Jib 11.7 m² · Spinnaker 23.6 m²',
  lwl: LWL, loa: 8.9, beam: 1.95, bowX: 4.55, sternX: -4.35, freeboard: 0.72, canoeDraft: 0.5, wetted: 13.5, draft: 1.2,
  massHull: M, zG: MP.zG, crewN: 3, crewEach: 90, crewZ: 0.75, crewMaxOut: 0.95, crewLee: -0.3, hikeRate: 0.6,
  gm: 0.8, bmForm: 0.5, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.05, amY: 0.8, amYaw: 0.55, amRoll: 0.3,
  // (her long, fine overhangs make her sailing length ~6.4 m, not her 5.66 m static waterline: the wave-making follows
  // the sailing length's slenderness; the lines give the dynamic waterline the Froude number is taken on, js/hull.js)
  rr: rrTable(6.4, M + 270),
  // (a long keel is part of the lines: its skin friction is in the hull's, so the foil keeps only its form drag)
  keel: { x: -0.3, z: -0.8, area: 1.75, ARe: 1.4, stall: 20 * DEG, cd0: 0.003, span: 0.72, chord: 2.5, long: true },
  rudder: { x: -1.45, z: -0.75, area: 0.34, ARe: 2.2, stall: 20 * DEG, cd0: 0.012, max: 35 * DEG, span: 0.72, chord: 0.45, loadRef: 900 },
  hullLat: { area: 1.3, cd: 0.9, z: -0.2 },
  windage: { area: 2.7, z: 1.8, cd: 0.95 },
  mastX: 1.0, mastHeight: 10.4, boomZ: 1.35, mastR: 0.055, keelBulb: false,
  targetHeel: 22 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1100,
  engine: null,
  lines: { main: { handler: 'ratchetCam', n: 6, at: 'sole' }, trav: { handler: 'cam', n: 2, at: 'deck' }, jib: { handler: 'winchCam', at: 'winch' },
    gen: { handler: 'ratchet', n: 1, at: 'quarter' }, vang: { handler: 'cam', n: 8, at: 'deck' }, cunn: { handler: 'cam', n: 4, size: 'micro', at: 'deck' },
    outhaul: { handler: 'cam', n: 4, size: 'micro', at: 'deck' }, backstay: { handler: 'cam', n: 8, at: 'deck' }, jibHalyard: { handler: 'cam', n: 4, at: 'deck' }, tackLine: { handler: 'cam', at: 'deck' } },
  sails: [
    { key: 'main', kind: 'boom', area: 16.0, luff: 8.6, foot: 3.55, head: 0.15, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 4.6, min: 1.5 * DEG, max: 80 * DEG, trav: [-5 * DEG, 12 * DEG], Iboom: 36, boomMass: 10, reefs: 0,
      vangBend: 0.18, sheetBend: 0.12, color: 0xf3f2ec },
    { key: 'jib', kind: 'loose', area: 11.7, tackX: 3.72, tackZ: 0.92, luff: 7.55, foot: 3.1, head: 0.06, footRise: 0.15,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.0, min: 8.5 * DEG, max: 45 * DEG, sagK: 1.1, color: 0xf3f2ec },
    { key: 'gennaker', kind: 'spin', pole: 2.6, area: 23.6, tackX: 3.72, tackZ: 1.1, luff: 7.4, rake: 2.72, fixedRake: true, foot: 4.3, head: 0.4,
      depth: [0.2, 0.22, 0.2], cd0: 0.1, ARe: 1.8, min: 18 * DEG, max: 100 * DEG, color: 0xf3f2ec },
  ],
  hull: { color: 0x14223d, stripe: 0xd8b26a, deck: 0xb07a45, boot: 0xf2f2ee, bootTop: 0xf2f2ee, levels: [0.03, 0.06, 0.035, 0.02] },
  sailcloth: { cloth: 0xf3f2ec, kind: 'laminate', num: '#14223d', logo: '#b3261e', trans: 0.2, rough: 0.45 },
  insignia: 'D',
  offsets: {
    sheer: [[0, 0.82], [0.25, 0.7], [0.5, 0.68], [0.75, 0.74], [1, 0.9]],
    deck: [[0, 0.3], [0.1, 0.55], [0.3, 0.88], [0.5, 1.0], [0.68, 0.9], [0.85, 0.55], [0.96, 0.18], [1, 0.02]],
    wl: [[0, 0.3], [0.2, 0.6], [0.5, 0.82], [0.75, 0.65], [1, 0.2]],
    keel: [[0, 0.62], [0.1, 0.38], [0.2, 0.08], [0.3, -0.22], [0.5, -0.45], [0.66, -0.36], [0.8, -0.1], [0.88, 0.2], [1, 0.82]],
    fin: [[0.3, -0.35], [0.36, -1.05], [0.5, -1.2], [0.6, -1.18], [0.7, -0.75], [0.8, -0.2]], finW: 0.13,
    bilge: [[0, 1.6], [0.5, 1.8], [1, 1.4]], dead: [[0, 0.6], [0.5, 0.65], [1, 0.8]], flare: 0.7, crown: 0.05, transomRake: 0.25,
  },
  model: {
    cockpit: { t0: 0.22, t1: 0.55, w: 0.62, sole: 0.35, seats: false, coaming: 0.1, coamingMat: 'teak' },
    deck: 'teak', toerail: 'teak', bronze: true, navLights: false,
    cabins: [{ t0: 0.55, t1: 0.66, h: [[0.55, 0.22], [0.66, 0.12]], w: [[0.55, 0.6], [0.66, 0.5]], slope: 0.05, camber: 0.05, frontRake: 0.25, aftRake: 0.03, side: 'wood', roof: 'teak', hatches: [] }],
    steering: { kind: 'tiller', len: 1.2, rise: 0.1, mat: 'wood', extension: 1.0 },
    rudder: { kind: 'keel', color: 0xf2f2ee, span: 0.62, thick: 0.08, rootK: 1.0, taper: 0.9, sweep: 0.25 },
    keel: { kind: 'full' },
    masts: { main: { mat: 'alu', r: 0.055, spreaders: [{ f: 0.45, len: 0.62, sweep: 12 * DEG }], hounds: 8.75 } },
    backstay: { split: false, x: -4.3, z: 0.95 },
    runners: { x: -2.0, z: 8.7 },
  },
  hw: { trav: [-1.05, 0.45, 0.42], boomS: 0.5, winch: [-1.1, 0.72], jibTrack: [0.55, -0.1, 0.55], helm: 'Tiller extension', winchR: 0.05 },
};
