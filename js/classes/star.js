// ---- Star: the two-man Olympic keelboat of 1911-2012. A hard-chined, low-freeboard hull with long overhangs, a
// steel fin with a lead bulb, a huge bendy-masted main and a small jib, running backstays, no spinnaker (downwind
// the jib is poled out; here it is simply eased), crew hiking in harnesses.
// Sources: International Star Class rules; Wikipedia Star (keelboat) (LOA 6.922 m, LWL 4.724 m, beam 1.734 m,
// draft 1.016 m, 671 kg incl. the 401.5 kg bulb, main 20.5 m^2, jib 6.0 m^2, mast 9.652 m, crew S + 1.5 C <= 250 kg).
// RYA PN 917 (1986), US Sailing D-PN 83.1.
// Lines (for the line-handler schema): mainsheet on a floor traveller through a ratchet block to a cam cleat; jib
// sheet to a cam cleat on the deck (the jib pole when running, not modelled); runners on levers (the classic Star
// running backstay levers) or cam cleats; vang, cunningham, outhaul, mast puller (bend) on cam cleats, halyards on horn cleats.
import { DEG } from './util.js';

export default {
  id: 'star', group: 'keelboat', name: 'Star',
  blurb: "The Olympic keelboat of a century: a narrow hard-chined hull with long overhangs, a lead bulb on a steel fin, a huge main on a bendy mast held by running backstays, and a small jib. No spinnaker. Fast upwind, and heeled it sails on its overhangs.",
  specs: 'LOA 6.92 m · LWL 4.72 m · Beam 1.73 m · Draft 1.02 m · 671 kg (401 kg bulb) · Main 20.5 m² · Jib 6.0 m² · Crew 2',
  lwl: 4.72, loa: 6.92, beam: 1.73, bowX: 2.55, sternX: -2.45, freeboard: 0.36, canoeDraft: 0.2, wetted: 6.0, draft: 1.02,
  runners: true, mastR: 0.042, mastBend: 0.18,   // (the Star's famously bendy mast, drawn bent)
  engine: null,
  lines: { main: { handler: 'ratchetCam', n: 4, at: 'sole' }, trav: { handler: 'cam', n: 2, at: 'sole' }, jib: { handler: 'cam', n: 2, at: 'deck' },
    vang: { handler: 'cam', n: 8, at: 'deck' }, cunn: { handler: 'cam', n: 4, size: 'micro', at: 'mast' }, outhaul: { handler: 'cam', n: 4, size: 'micro', at: 'boom' },
    jibHalyard: { handler: 'horn', n: 2, at: 'mast' } },
  massHull: 671, zG: -0.5, crewN: 2, crewEach: 100, crewZ: 0.45, crewMaxOut: 1.25, crewLee: -0.3, hikeRate: 0.9,
  gm: 0.6, bmForm: 0.5, Ixx: 1350, Izz: 2600, amX: 0.05, amY: 0.6, amYaw: 0.4, amRoll: 0.25,
  // residuary resistance / weight: a narrow, flat-floored hull whose overhangs lengthen its sailing waterline when heeled
  // (4.72 m upright, over 5.5 m heeled: the table is referenced to the upright length)
  rr: [[0.1, 0.0002], [0.15, 0.0005], [0.2, 0.0011], [0.25, 0.0022], [0.3, 0.0042], [0.35, 0.0075], [0.4, 0.0135], [0.45, 0.024],
       [0.5, 0.039], [0.55, 0.054], [0.6, 0.064], [0.7, 0.072], [0.8, 0.076], [1.0, 0.08], [1.5, 0.088]],
  keel: { x: 0.32, z: -0.55, area: 0.6, ARe: 3.0, stall: 15 * DEG, cd0: 0.011, span: 0.8, chord: 0.72 },
  rudder: { x: -2.2, z: -0.35, area: 0.2, ARe: 3.0, stall: 16 * DEG, cd0: 0.011, max: 32 * DEG, span: 0.6, chord: 0.34, loadRef: 450 },
  hullLat: { area: 0.7, cd: 0.9, z: -0.08 },
  windage: { area: 1.8, z: 1.1, cd: 0.95 },
  mastX: 1.35, mastHeight: 9.95, boomZ: 0.72, keelBulb: { len: 1.5, r: 0.13, flat: 0.8 }, houndsF: 0.24,
  targetHeel: 16 * DEG, canCapsize: false, hasBackstay: false, hasBoard: false, sheetPower: 800,
  cloth: 'dacronDinghy',
  sails: [
    { key: 'main', kind: 'boom', area: 20.5, luff: 8.8, foot: 4.3, head: 0.2, depth: [0.13, 0.15, 0.14], twistMax: 20 * DEG,
      cd0: 0.06, ARe: 4.0, min: 1.5 * DEG, max: 80 * DEG, trav: [-4 * DEG, 12 * DEG], Iboom: 40, boomMass: 8, reefs: 0,
      vangBend: 0.45, sheetBend: 0.3, color: 0xf4f3ee },
    { key: 'jib', kind: 'loose', area: 6.0, tackX: 3.7, tackZ: 0.55, luff: 6.9, foot: 1.95, head: 0.05,
      depth: [0.12, 0.13, 0.11], cd0: 0.045, ARe: 4.6, min: 8.5 * DEG, max: 45 * DEG, sagK: 1.2, color: 0xf4f3ee },
  ],
  // the hull, in the parametric form (js/hull.js)
  offsets: { tm: 0.5, tr: 0.45, be: 0.9, sheerBow: 0.25, sheerStern: 0.08, stemRake: 1.25, transomRake: 0.85, flare: 0.08, flat: 0.95, sternDepth: 0.02, crown: 0.06, wl: 0.8 },
  insignia: (g, x, y, cl) => {   // the Star class's red five-pointed star
    g.fillStyle = cl.logo; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 17 : 44; g.lineTo(x + r * Math.cos(a), y + 2 + r * Math.sin(a)); }
    g.closePath(); g.fill();
  },
  // the sails' look (js/models.js): cloth colour and kind, number and insignia colours, translucency, gloss
  sailcloth: { cloth: 0xf3f2ec, kind: 'dacron', num: '#1d2a44', logo: '#d61f26', trans: 0.32, rough: 0.58 },
  hull: { color: 0xf1f2ef, stripe: 0x14305a, deck: 0xe6e3da, boot: 0x14305a, sectionN: 2.4, transom: 0.4, bowRake: 1.2, sheer: 0.08,
    lifelines: false, deckTint: '#e4dfd2', cockpit: { t0: 0.18, t1: 0.62, w: 0.62, sole: 0.2 } },
  // deck hardware (js/rigging.js): traveller [x, half length, z], primary winches [x, y], jib tracks [aft.. fwd, y]
  hw: { trav: [-1.3, 0.5, 0.26], winch: [0.3, 0.3], jibTrack: [1.0, 0.45, 0.42], boomS: 0.6, clutchX: 0.6 },
};
