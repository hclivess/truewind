// ---- J/122: a 40 ft performance cruiser-racer (Alan Johnstone, 2007). Carbon fractional rig with two swept
// spreaders and a backstay, a non-overlapping jib, an asymmetric spinnaker tacked on a retractable carbon bowsprit,
// a low-VCG fin keel with a bulb, a spade rudder and wheel steering, nine crew racing.
// Sources: ORC certificate J-CURVE (https://data.orc.org/public/WPub.dll/CC/03410000WW5): LOA 12.200 m, beam 3.638 m,
// draft 2.240 m, 7,450 kg, P 15.65 E 5.36 IG 16.55 J 4.62 BAS 1.72 TPS 6.60 m, main 50.07 jib 42.82 asymmetric
// 155.89 m^2, crew max 797 kg, RM 175.9 kg m/deg, wetted 31.26 m^2; J/Boats (https://jboats.com/j122-tech-specs):
// LWL 10.55 m, 6,760 kg, 2,540 kg ballast.
// Lines (for the line-handler schema): mainsheet and traveller on winches in the cockpit ahead of the wheel;
// jib sheets on primary self-tailing winches; asymmetric sheets on the primaries (or secondaries), tack line and
// bowsprit out-haul to clutches on the cabin top; halyards, reefs, vang and cunningham through clutches to the
// cabin-top halyard winches; backstay on a hydraulic or cascade purchase to a cam cleat.
import { DEG } from './util.js';

export default {
  id: 'j122', group: 'cruiser', name: 'J/122',
  blurb: "A 40 ft offshore cruiser-racer: a carbon fractional rig, a 106% jib, a 156 m² asymmetric on a retractable bowsprit, a bulb keel and wheel steering, nine crew. Heavy on the helm and the winches, and 8 kn in a sea breeze.",
  specs: 'LOA 12.20 m · LWL 10.55 m · Beam 3.64 m · Draft 2.24 m · 7,450 kg · 2,540 kg ballast · Main 50.1 m² · Jib 42.8 m² · Asymmetric 155.9 m²',
  lwl: 10.55, loa: 12.2, beam: 3.64, bowX: 5.75, sternX: -5.65, freeboard: 1.18, canoeDraft: 0.55, wetted: 31.3, draft: 2.24,
  bowsprit: 2.0, wheel: { x: -3.6, r: 0.72, h: 0.72 }, carbonMast: true, mastR: 0.1, reefWind: [22, 30], spreaders: { n: 2, sweep: 20 * DEG },
  // auxiliary: Volvo D2-40 (29 kW) on a saildrive, two-blade folding propeller 0.46 m (J/Boats J/122E spec; ORC cert prop)
  engine: { type: 'saildrive', model: 'Volvo Penta D2-40 saildrive', kW: 29.4, rpmMax: 3200, rpmIdle: 850, cyl: 4, fuel: 'diesel', gear: 2.18,
    prop: { D: 0.46, P: 0.33, Z: 2, BAR: 0.5, folding: true, rh: 1 }, pos: [-1.4, 0, -0.95], mount: [-1.1, 0, -0.2],
    mass: 200, inMass: true, tilts: false, steers: false, exhaust: [-5.5, -1.2, 0.5] },
  lines: { main: { handler: 'selfTailer', n: 6, at: 'winch' }, trav: { handler: 'cam', n: 4, at: 'sole' }, jib: { handler: 'selfTailer', at: 'winch' },
    gen: { handler: 'selfTailer', at: 'winch' }, vang: { handler: 'clutch', n: 12, winch: 'cabin', at: 'cabin' }, cunn: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' },
    outhaul: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' }, backstay: { handler: 'cam', n: 24, at: 'deck' },
    jibHalyard: { handler: 'clutch', n: 4, winch: 'cabin', at: 'cabin' }, tackLine: { handler: 'clutch', winch: 'cabin', at: 'cabin' } },
  massHull: 7450, zG: 0.07, crewN: 9, crewEach: 85, crewZ: 1.35, crewMaxOut: 1.72, crewLee: -0.8, hikeRate: 0.5,
  gm: 1.35, bmForm: 0.8, Ixx: 23000, Izz: 82000, amX: 0.06, amY: 0.8, amYaw: 0.45, amRoll: 0.25,
  // residuary resistance / weight: a moderate-displacement cruiser-racer (D/L ~ 170, L/vol^(1/3) 5.3)
  rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0008], [0.25, 0.0016], [0.3, 0.0032], [0.35, 0.0062], [0.4, 0.013],
       [0.45, 0.031], [0.5, 0.054], [0.55, 0.07], [0.6, 0.08], [0.7, 0.088], [0.8, 0.09], [1.0, 0.092], [1.5, 0.1]],
  // (the fin with the canoe body's share of the side force)
  keel: { x: 0.25, z: -1.4, area: 2.1, ARe: 4.0, stall: 15 * DEG, cd0: 0.009, span: 1.7, chord: 1.1, lead: true },
  rudder: { x: -4.55, z: -0.95, area: 0.85, ARe: 3.8, stall: 16 * DEG, cd0: 0.01, max: 32 * DEG, span: 1.55, chord: 0.55, loadRef: 3500 },
  hullLat: { area: 4.0, cd: 0.9, z: -0.2 },
  windage: { area: 7.8, z: 3.0, cd: 0.9 },
  mastX: 1.75, mastHeight: 18.9, boomZ: 2.95, keelBulb: { len: 2.3, r: 0.26 }, houndsF: 0.08, spreader: 1.0,
  targetHeel: 22 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 6000,
  sails: [
    { key: 'main', kind: 'boom', area: 50.07, luff: 15.65, foot: 5.36, head: 0.35, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 5.4, min: 1.5 * DEG, max: 78 * DEG, trav: [-6 * DEG, 12 * DEG], Iboom: 900, boomMass: 45, reefs: 2,
      vangBend: 0.06, sheetBend: 0.04, ropeK: 6, color: 0x2b2e33 },
    { key: 'jib', kind: 'loose', area: 42.82, tackX: 6.35, tackZ: 1.32, luff: 16.1, foot: 5.0, head: 0.1, footRise: 0.1,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 5.2, min: 7.5 * DEG, max: 42 * DEG, sagK: 1.2, color: 0x2b2e33 },
    { key: 'gennaker', kind: 'spin', replaces: 'jib', area: 155.89, tackX: 8.4, tackZ: 1.5, luff: 17.4, foot: 8.3, head: 0.9, rake: 6.45,
      depth: [0.19, 0.21, 0.19], cd0: 0.09, ARe: 2.2, min: 16 * DEG, max: 100 * DEG, color: 0xc8412c },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.44, tr: 0.8, be: 0.8, sheerBow: 0.1, sheerStern: 0.02, stemRake: 0.45, transomRake: -0.1, flare: 0.2, flat: 0.6, sternDepth: 0.3, crown: 0.05, wl: 0.81 },
  insignia: 'J/122',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0x3a3d42, kind: 'laminate', num: '#e9e6dc', logo: '#e9e6dc', trans: 0.08, rough: 0.4 },
  hull: { color: 0xeef0f2, stripe: 0x1d2a44, deck: 0xdcd8cc, boot: 0x1d2a44, sectionN: 2.6, transom: 0.8, bowRake: 0.45, sheer: 0.06,
    deckTint: '#e0e0da', extension: false, benches: true,
    cockpit: { t0: 0.02, t1: 0.4, w: 0.66, sole: 0.72 }, cabin: { t0: 0.41, t1: 0.74, h: 0.36, w: 1.1 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-2.55, 0.9, 0.78], winch: [-4.2, 1.45], jibTrack: [-0.4, -1.7, 1.05], boomS: 0.9, clutchX: -1.2, cabinWinch: [-1.4, 0.7] },
};
