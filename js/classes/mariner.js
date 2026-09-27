// ---- The Mariner's trimaran from Waterworld (1995). A 60 ft ocean-racing trimaran built for the film by Jeanneau
// Techniques Avancées to a VPLP design, in the moulds of the ORMA 60 Pierre 1er; one sailing boat and one for the
// set, the sailing one raced afterwards. Dressed as salvaged junk: rust, scrap plate, patched sails, a mast that
// folds down on a tabernacle and is raised by a geared winch.
// Sources: VPLP (https://www.vplp.fr/en/maritime/waterworld/): LOA 18.28 m, beam 15 m, draft 1.54 / 2.88 m (board up /
// down), air draft 27.5 m, glass/Kevlar; press quoted in https://groups.google.com/g/alt.sailing.asa/c/8xz4nSFv5o0:
// "no more than 6 metric tons", mast over 90 ft, close to 4,300 ft^2 (400 m^2) of sail (the whole inventory: here the
// main and jib only, 300 m^2, as an ORMA 60 carries upwind). The hull and float lines, the foils, the weights and the
// sail split are estimates for an ORMA 60 hull built heavier. Not seen motoring in the film: the small inboard is
// what a working boat of this size carries for harbour.
// Lines (for the line-handler schema): mainsheet on a big traveller on the aft beam, both on powered winches; jib
// sheets to winches in the cockpit; halyards to clutches and a halyard winch at the mast; runners on winches; the
// mast-raising wire on its own geared drum aft of the mast.
import { DEG } from './util.js';

export default {
  id: 'mariner', group: 'multihull', name: "Mariner's trimaran (Waterworld)",
  blurb: "The film's salvaged 60 ft racing trimaran: a slender main hull on two floats 15 m apart, a 27 m hinged mast raised by a geared winch, a fully battened patched main and a jib, rust and scrap everywhere. Flies a float from 10 kn and reaches at twice the wind speed.",
  specs: 'LOA 18.28 m · Beam 15.0 m · Draft 1.54 / 2.88 m · ~6,000 kg · Air draft 27.5 m · Main 205 m² · Jib 95 m²',
  lwl: 17.4, loa: 18.28, beam: 15.0, hullBeam: 2.5, bowX: 8.95, sternX: -8.85, freeboard: 1.3, canoeDraft: 0.72, wetted: 22, draft: 2.88,
  amas: { y: 6.7, sy: 0.5, sz: 0.9, szTop: 0.62, dz: 0.38, tumble: 0.62, t0: 0.08, t1: 0.99, beams: [2.9, -3.6], netZ: 1.3 },
  wheel: { x: -5.4, r: 0.6, h: 0.8 }, runners: true, mastR: 0.16, wingMast: true, reefTime: 90, reefWind: [20, 28],
  engine: { type: 'inboard', model: 'small diesel on a shaft (assumed)', kW: 22, rpmMax: 3000, rpmIdle: 850, cyl: 3, fuel: 'diesel', gear: 2.0,
    prop: { D: 0.4, P: 0.3, Z: 2, BAR: 0.5, folding: true, rh: 1 }, pos: [-5.2, 0, -0.95], shaftAngle: 0.14, mount: [-3.8, 0, -0.1],
    mass: 150, inMass: true, tilts: false, steers: false, exhaust: [-8.8, 0.6, 0.6] },
  lines: { main: { handler: 'selfTailer', n: 8, at: 'winch' }, trav: { handler: 'selfTailer', n: 4, at: 'winch' }, jib: { handler: 'selfTailer', at: 'winch' },
    vang: { handler: 'horn', n: 8, at: 'deck' }, cunn: { handler: 'horn', n: 4, at: 'mast' }, outhaul: { handler: 'horn', n: 4, at: 'boom' },
    jibHalyard: { handler: 'winchHorn', winch: 'cabin', at: 'mast' } },
  ropeStyle: 'classic',
  massHull: 6000, zG: 0.85, crewN: 2, crewEach: 85, crewZ: 1.6, crewMaxOut: 3.0, crewLee: -1.0, hikeRate: 1.0,
  gm: 6, bmForm: 2, Ixx: 140000, Izz: 240000, amX: 0.04, amY: 0.35, amYaw: 0.4, amRoll: 0.4,
  // residuary resistance / weight of the main hull and the leeward float (slender hulls, L/vol^(1/3) ~ 10): the
  // Southampton-series level the beach cat uses, a little higher past the hump for the heavier build
  rr: [[0.1, 0.0004], [0.2, 0.002], [0.3, 0.0076], [0.35, 0.0145], [0.4, 0.024], [0.45, 0.034], [0.5, 0.04], [0.6, 0.045], [0.7, 0.047], [0.8, 0.05], [1.0, 0.054], [1.2, 0.058], [1.5, 0.065]],
  keel: { x: 0.3, z: -1.8, area: 1.8, ARe: 6.0, stall: 13 * DEG, cd0: 0.009, span: 2.15, chord: 0.8, board: true },
  rudder: { x: -8.3, z: -1.2, area: 0.75, ARe: 4.0, stall: 15 * DEG, cd0: 0.01, max: 30 * DEG, span: 1.55, chord: 0.48, loadRef: 4000 },
  hullLat: { area: 3.0, cd: 0.9, z: -0.2 },
  windage: { area: 16, z: 2.8, cd: 0.95 },
  mastX: 1.9, mastHeight: 27.3, boomZ: 2.7, keelBulb: false, houndsF: 0.1,
  targetHeel: 9 * DEG, canCapsize: true, hasBackstay: false, hasBoard: true, sheetPower: 9000, fullPowerTws: 10,
  cloth: 'dacronCruise', battens: { EI: 25, full: true, rows: [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.93] },
  sails: [
    { key: 'main', kind: 'boom', area: 205, luff: 23.6, foot: 8.6, head: 1.6, depth: [0.11, 0.13, 0.12], twistMax: 18 * DEG,
      cd0: 0.06, ARe: 5.0, min: 1 * DEG, max: 70 * DEG, trav: [-4 * DEG, 22 * DEG], Iboom: 3200, boomMass: 90, reefs: 2,
      vangBend: 0.15, sheetBend: 0.06, ropeK: 20, vangTravel: 6, color: 0xcfc3a4 },
    { key: 'jib', kind: 'loose', window: false, area: 95, tackX: 9.3, tackZ: 1.55, luff: 21.4, foot: 8.2, head: 0.15, footRise: 0.2,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.8, min: 8 * DEG, max: 40 * DEG, sagK: 1.0, color: 0xcfc3a4 },
  ],
  // the hull, in the parametric form (js/hull.js)
  // (a table of offsets shaped on the ORMA 60 type and the film's photographs (VPLP): a slender main hull, round
  // bilged and flared, a fine entry under a raked stem, a crowned deck; the floats are the same lines narrowed and
  // lowered (amas), so they read as long slim round-sectioned hulls with their own sheer)
  offsets: {
    sheer: [[0, 1.2], [0.3, 1.26], [0.6, 1.36], [0.85, 1.58], [1, 1.85]],
    deck: [[0, 0.52], [0.12, 0.78], [0.4, 1.0], [0.62, 0.95], [0.82, 0.62], [0.95, 0.22], [1, 0.02]],
    wl: [[0, 0.6], [0.4, 0.86], [0.8, 0.74], [1, 0.3]],
    keel: [[0, -0.12], [0.08, -0.5], [0.4, -0.72], [0.75, -0.55], [0.93, -0.12], [1, 0.55]],
    bilge: 2.0, dead: 0.4, flare: 0.55, tumble: 0.05, crown: 0.22, stemX: 0.45, transomRake: -0.05,
  },
  insignia: '',
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xcdbd98, kind: 'dacron', mottle: true, num: '#2a2520', logo: '#2a2520', trans: 0.3, rough: 0.75 },
  hull: { color: 0x736b5f, stripe: 0x7a3b1e, deck: 0x6b6152, boot: 0x3b2f27, bootTop: 0x5a4a3c, sectionN: 2.2, transom: 0.55, bowRake: 0.15, sheer: 0.05,
    weathered: true, patchedSails: true, noNumber: true, lifelines: false, deckTint: '#7d7263', extension: false,
    cockpit: { t0: 0.12, t1: 0.36, w: 0.6, sole: 0.85 }, cabin: { t0: 0.37, t1: 0.56, h: 0.55, w: 0.95 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-3.6, 2.4], winch: [-4.4, 0.95], jibTrack: [0.8, -1.4, 1.05], boomS: 0.93, clutchX: -0.4, cabinWinch: [-0.6, 0.7] },
};
