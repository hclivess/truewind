// ---- Nordic Folkboat: Tord Sundén's 1941 clinker-built Scandinavian one-design. A heavy long-keeled boat with a
// keel-hung rudder, spoon bow, raked transom and lots of sheer, a 3/4 fractional rig with a big main and a small
// jib, no spinnaker (the class allowed one only in 2025), three crew.
// Sources: Nordic Folkboat class rules 2025-2028 (https://www.folkboats.com/wp-content/uploads/2025/03/NORDIC-FOLKBOAT-CLASS-RULES-2025-2028-incl-spinnaker.pdf):
// LOA 7.68 m, LWL 6.00 m, beam 2.20 m, draft 1.20 m, min 1,930 kg, iron keel 1,000-1,050 kg, sail area 24 m^2;
// ORC Club certificate NED 866 (https://data.orc.org/public/WPub.dll/CC/161245): 2,000 kg, P 7.90 E 3.38 IG 6.20
// J 2.05 BAS 1.10 m, main 16.24 jib 8.91 m^2, crew max 327 kg, RM 19.3 kg m/deg, wetted 13.78 m^2.
// Lines (for the line-handler schema): mainsheet to a cam on the aft-deck traveller; jib sheets on small winches on
// the coamings with horn cleats (older boats: cam cleats); halyards on horn cleats at the mast; backstay tackle on a
// cam cleat; reef lines to horn cleats on the boom.
import { DEG } from './util.js';

export default {
  id: 'folkboat', group: 'keelboat', name: 'Nordic Folkboat',
  blurb: "Tord Sundén's 1941 clinker one-design: a heavy long keel with the rudder hung on it, a spoon bow and a raked transom, a big main on a 3/4 rig and a small jib. No spinnaker. Stiff, wet and happiest at its 6 kn hull speed.",
  specs: 'LOA 7.68 m · LWL 6.00 m · Beam 2.20 m · Draft 1.20 m · 1,930 kg · 1,000 kg iron keel · Main 16.2 m² · Jib 8.9 m² · Crew 3',
  lwl: 6.0, loa: 7.68, beam: 2.2, bowX: 3.05, sternX: -3.05, freeboard: 0.62, canoeDraft: 0.42, wetted: 13.8, draft: 1.2,
  cabin: true, longKeel: true, reefTime: 60, reefWind: [18, 25],
  // auxiliary: a 4 hp outboard in a well under the cockpit's aft end (the usual Folkboat installation)
  engine: { type: 'outboard', model: '4 hp four-stroke long shaft in a well', kW: 2.94, rpmMax: 5000, rpmIdle: 1100, cyl: 1, fuel: 'petrol', gear: 2.08,
    prop: { D: 0.19, P: 0.15, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-2.6, 0.35, -0.42], mount: [-2.5, 0.35, 0.2], transom: false, lift: 0.5,
    mass: 25, inMass: false, tilts: true, steers: false, exhaust: [-2.6, 0.35, 0.05] },
  lines: { main: { handler: 'cam', n: 4, at: 'deck' }, trav: { handler: 'cam', n: 2, at: 'deck' }, jib: { handler: 'winchHorn', at: 'winch' },
    vang: { handler: 'cam', n: 6, at: 'deck' }, cunn: { handler: 'horn', n: 2, at: 'mast' }, outhaul: { handler: 'horn', n: 2, at: 'boom' },
    backstay: { handler: 'cam', n: 6, at: 'deck' }, jibHalyard: { handler: 'horn', n: 2, at: 'mast' } },
  ropeStyle: 'classic',
  massHull: 1930, zG: -0.36, crewN: 3, crewEach: 95, crewZ: 0.62, crewMaxOut: 0.95, crewLee: -0.45, hikeRate: 0.5,
  gm: 0.55, bmForm: 0.55, Ixx: 2600, Izz: 6200, amX: 0.07, amY: 0.9, amYaw: 0.6, amRoll: 0.3,
  // residuary resistance / weight: heavy (D/L ~ 290), fine-ended and slack-bilged: a wall at hull speed
  rr: [[0.1, 0.0001], [0.15, 0.0003], [0.2, 0.0007], [0.25, 0.0015], [0.3, 0.0033], [0.35, 0.0075], [0.4, 0.018],
       [0.45, 0.04], [0.5, 0.068], [0.55, 0.088], [0.6, 0.1], [0.7, 0.112], [0.8, 0.118], [1.0, 0.124], [1.5, 0.134]],
  // (the long keel is faired into the drawn hull, whose wetted surface already carries its skin friction: its own
  // profile drag here is the form part only)
  keel: { x: 0.7, z: -0.45, area: 1.9, ARe: 1.1, stall: 24 * DEG, cd0: 0.005, span: 0.65, chord: 3.2, long: true },
  rudder: { x: -3.15, z: -0.45, area: 0.42, ARe: 2.2, stall: 21 * DEG, cd0: 0.013, max: 35 * DEG, span: 0.95, chord: 0.5, transom: true, loadRef: 900, wood: true, through: true },
  hullLat: { area: 1.2, cd: 0.9, z: -0.12 },
  windage: { area: 2.8, z: 1.5, cd: 0.95 },
  mastX: 1.8, mastHeight: 9.7, boomZ: 1.8, keelBulb: false, houndsF: 0.33,
  targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 900,
  cloth: 'dacronCruise',
  sails: [
    { key: 'main', kind: 'boom', area: 16.24, luff: 7.9, foot: 3.38, head: 0.1, depth: [0.12, 0.14, 0.13], twistMax: 20 * DEG,
      cd0: 0.07, ARe: 4.0, min: 2 * DEG, max: 80 * DEG, trav: [-3 * DEG, 10 * DEG], Iboom: 40, boomMass: 12, reefs: 2,
      vangBend: 0.08, sheetBend: 0.05, color: 0xf3efe2 },
    { key: 'jib', kind: 'loose', area: 8.91, tackX: 3.9, tackZ: 0.98, luff: 5.8, foot: 2.6, head: 0.05, footRise: 0.1,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 3.8, min: 10 * DEG, max: 50 * DEG, sagK: 2.2, color: 0xf3efe2 },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.52, tr: 0.36, be: 0.75, sheerBow: 0.42, sheerStern: 0.28, stemRake: 0.95, transomRake: 0.55, flare: 0.3, flat: 0.15, sternDepth: 0.06, crown: 0.07 },
  insignia: 'F',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xf1ead8, kind: 'dacron', num: '#1c2a3a', logo: '#b3261e', trans: 0.3, rough: 0.64 },
  // (most Folkboats are varnished mahogany clinker, or GRP moulded to look it: Wikimedia Commons, Nordic folkboats (14775215050))
  hull: { color: 0x7a4424, stripe: 0x7a4424, deck: 0xcdbf9f, boot: 0x2a2d31, sectionN: 1.8, transom: 0.36, bowRake: 0.95, sheer: 0.2,
    clinker: 9, wood: true, lifelines: false, benches: true, deckTint: '#e6dcc4',
    cockpit: { t0: 0.06, t1: 0.42, w: 0.55, sole: 0.3 }, cabin: { t0: 0.44, t1: 0.7, h: 0.3, w: 0.62, wood: true } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-2.75, 0.45], winch: [-0.35, 0.78], jibTrack: [0.6, -0.1, 0.88], boomS: 0.95, clutchX: 0.8 },
};
