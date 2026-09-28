// ---- J/24: the one-design keelboat of 1977 (5,500+ built). A 7/8 fractional sloop (forestay at 8.19 m, spinnaker
// halyard at the same height), a 153% genoa, a symmetric spinnaker on a 2.98 m pole, lead fin keel, transom-hung
// rudder, five crew on the rail.
// Sources: ORC Club certificate GER907 (https://data.orc.org/public/WPub.dll/CC/038500021DV.pdf): LOA 7.318 m, beam
// 2.692 m, draft 1.244 m, 1,444 kg, P 8.54 E 2.97 IG 8.19 J 2.90 SPL 2.98 BAS 1.08 m, main 15.44 genoa 17.79 spinnaker
// 34.59 m^2, crew max 400 kg, RM 30.7 kg m/deg, wetted 10.78 m^2; class data (https://goodoldboat.com/saildata/boat/j24/):
// LWL 6.10 m, ballast 431 kg.
// Lines (for the line-handler schema): mainsheet 6:1 to a swivel cam on the floor traveller; genoa sheets on
// self-tailing winches on the coamings; spinnaker sheets and guys on the same winches, guys through twinning lines on
// cam cleats; pole topping lift and downhaul on cam cleats at the mast; halyards led aft to clutches either side of the
// companionway; backstay cascade to a cam cleat at the tiller; vang, cunningham, outhaul to cams on the cabin top.
import { DEG } from './util.js';

export default {
  id: 'j24', group: 'keelboat', name: 'J/24',
  blurb: "Rod Johnstone's 1977 one-design, raced by more sailors than any keelboat: a 153% genoa, a symmetric spinnaker on a pole, a lead fin and a transom-hung rudder, five crew on the rail. Surfs downwind in a breeze.",
  specs: 'LOA 7.32 m · LWL 6.10 m · Beam 2.69 m · Draft 1.22 m · 1,406 kg · 431 kg lead · Main 15.4 m² · Genoa 17.8 m² · Spinnaker 34.6 m²',
  lwl: 6.1, loa: 7.32, beam: 2.69, bowX: 3.3, sternX: -3.15, freeboard: 0.74, canoeDraft: 0.36, wetted: 10.8, draft: 1.24,
  // auxiliary: a 4 hp four-stroke outboard on a bracket on the transom, to port of the rudder (as J/24s carry it)
  engine: { type: 'outboard', model: '4 hp four-stroke long shaft', kW: 2.94, rpmMax: 5500, rpmIdle: 1100, cyl: 1, fuel: 'petrol', gear: 2.08,
    prop: { D: 0.19, P: 0.15, Z: 3, BAR: 0.5, folding: false, rh: 1 }, pos: [-3.3, -0.45, -0.3], mount: [-3.2, -0.45, 0.3], lift: 0.42,
    mass: 25, inMass: false, tilts: true, steers: false, exhaust: [-3.3, -0.45, 0.1] },
  lines: { main: { handler: 'cam', n: 6, at: 'sole' }, trav: { handler: 'cam', n: 2, at: 'sole' }, jib: { handler: 'selfTailer', at: 'winch' },
    gen: { handler: 'selfTailer', at: 'winch' }, vang: { handler: 'cam', n: 8, at: 'cabin' }, cunn: { handler: 'cam', n: 4, at: 'cabin' },
    outhaul: { handler: 'cam', n: 4, at: 'boom' }, backstay: { handler: 'cam', n: 8, at: 'deck' }, jibHalyard: { handler: 'clutch', n: 2, winch: 'cabin', at: 'cabin' },
    tackLine: { handler: 'cam', n: 2, at: 'mast' } },
  massHull: 1444, zG: 0.05, crewN: 5, crewEach: 80, crewZ: 0.62, crewMaxOut: 1.12, crewLee: -0.5, hikeRate: 0.55,
  gm: 1.2, bmForm: 0.7, Ixx: 2700, Izz: 6700, amX: 0.06, amY: 0.75, amYaw: 0.45, amRoll: 0.25,
  // residuary resistance / weight: a moderate-displacement keelboat (D/L ~ 180, L/vol^(1/3) 5.0) that surfs but
  // does not plane
  rr: [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0008], [0.25, 0.0016], [0.3, 0.0032], [0.35, 0.006], [0.4, 0.013],
       [0.45, 0.03], [0.5, 0.052], [0.55, 0.066], [0.6, 0.074], [0.7, 0.08], [0.8, 0.08], [1.0, 0.078], [1.2, 0.077], [1.5, 0.08]],
  planing: 0.3,
  // (the fin is 0.88 m deep under a deep canoe body, which carries part of the side force: the area and aspect ratio
  // here are the fin's plus the hull's share)
  keel: { x: 0.45, z: -0.8, area: 1.1, ARe: 3.0, stall: 17 * DEG, cd0: 0.011, span: 0.88, chord: 1.05, lead: true },
  rudder: { x: -3.2, z: -0.5, area: 0.36, ARe: 3.2, stall: 17 * DEG, cd0: 0.012, max: 33 * DEG, span: 0.95, chord: 0.38, loadRef: 800, hung: true },
  hullLat: { area: 1.5, cd: 0.9, z: -0.12 },
  windage: { area: 3.6, z: 1.7, cd: 0.9 },
  mastX: 1.0, mastHeight: 10.5, boomZ: 1.9, keelBulb: false, houndsF: 0.14,
  targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, sheetPower: 1300, reefWind: [22, 30],
  sails: [
    { key: 'main', kind: 'boom', area: 15.44, luff: 8.54, foot: 2.97, head: 0.15, depth: [0.11, 0.13, 0.12], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 5.0, min: 1.5 * DEG, max: 78 * DEG, trav: [-5 * DEG, 12 * DEG], Iboom: 40, boomMass: 12, reefs: 1,
      vangBend: 0.06, sheetBend: 0.04, color: 0xf2f0ea },
    { key: 'jib', kind: 'loose', area: 17.79, label: 'Genoa', tackX: 4.0, tackZ: 0.95, luff: 7.9, foot: 4.3, head: 0.06, footRise: 0.15,
      depth: [0.13, 0.14, 0.12], cd0: 0.045, ARe: 3.6, min: 8 * DEG, max: 45 * DEG, sagK: 1.3, color: 0xf2f0ea },
    { key: 'gennaker', kind: 'spin', label: 'Spinnaker', pole: 2.98, replaces: 'jib', area: 34.59, tackX: 1.0 + 0.07 + 2.98, tackZ: 2.0, luff: 7.0, foot: 4.9, head: 0.6, rake: 3.05,
      depth: [0.2, 0.22, 0.2], cd0: 0.09, ARe: 1.9, min: 16 * DEG, max: 100 * DEG, color: 0x1d4e89 },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.46, tr: 0.72, be: 0.8, sheerBow: 0.2, sheerStern: 0.05, stemRake: 0.75, transomRake: 0.12, flare: 0.2, flat: 0.5, sternDepth: 0.25, crown: 0.06, wl: 0.9 },
  insignia: 'J/24',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xf2f1ec, kind: 'dacron', num: '#16233a', logo: '#c8412c', trans: 0.3, rough: 0.58 },
  hull: { color: 0xf3f4f1, stripe: 0xc8412c, deck: 0xdcd8cc, boot: 0x1d2a44, sectionN: 2.4, transom: 0.72, bowRake: 0.75, sheer: 0.1,
    deckTint: '#e2e0d8', benches: true,
    cockpit: { t0: 0.04, t1: 0.44, w: 0.62, sole: 0.42 }, cabin: { t0: 0.45, t1: 0.74, h: 0.3, w: 0.78 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-2.65, 0.5, 0.48], winch: [-1.2, 0.92], jibTrack: [-0.3, -1.2, 1.05], boomS: 0.93, clutchX: -0.3, cabinWinch: [-0.45, 0.5] },
};
