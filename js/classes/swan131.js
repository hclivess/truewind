// Swan 131 "Aristarchos" (Nautor's Swan, Pietarsaari, Finland; hull 131-001, launched 2006): the only Swan 131 built
// and the largest yacht Nautor has launched. Naval architecture and exterior German Frers; interior Rhoades Young
// (Dick Young). A flush teak deck forward of a low raised saloon with a long smoked window band, the guest cockpit at
// the saloon's aft end, twin wheels aft of it on a long flush aft deck, a navy-blue GRP hull. Masthead sloop with an
// inner forestay (furling staysail) and running backstays, a Southern Spars carbon keel-stepped mast and carbon boom
// with in-boom furling, captive hydraulic winches below deck. Twin rudders, a fixed bulb keel, twin Caterpillar C12
// diesels on twin shafts.
//
// Sources (fetched 2026-10):
//  [W]  Wikipedia "Swan 131" (data as sailboatdata.com): LOA 40.00 m, LWL 34.96 m, beam 8.50 m, draft 4.70 m, light
//       displacement 180,000 kg, loaded 200,000 kg, ballast 36,000 kg; masthead rig, I 50.32 m, J 15.00 m, P 47.00 m,
//       E 15.64 m; one built, 2006, "Aristarchos"; designer German Frers. (Its "mainsail 377.4 m^2" is I*J/2 and its
//       "foretriangle 368 m^2" P*E/2: the two labels are swapped; neither is a sail's area.)
//  [NJ] Northrop & Johnson listing "Aristarchos 131 Nautor Swan" (broker's specification): LWL 114 ft (34.69 m), max
//       draft 16 ft (4.88 m); "Southern Spars carbon keel stepped mast 54 meters, carbon spars and spreaders, carbon
//       boom, with in-boom furling mandrel and hydraulic furling motor"; total sail area 989 m^2; North Sails main 3Di
//       (2017), jib 3Di (2015), staysail 3DL (2006); Reckmann hydraulic jib and staysail furlers; "Rondal captive
//       hydraulic winches for the jib sheets, for the main sheet, the main halyard and the running backstays";
//       "Lewmar hydraulic winches by the mast and at the aft deck"; BSI rod rigging (renewed 2020); "twin rudder
//       system with shafts & clutch", 2 x twin hydraulic Bosch Rexroth steering; 2 x Caterpillar C12, 480 hp (358 kW)
//       each; "swinging-out aft carbon swimming platform"; Castoldi 5.5 m jet tender, Zodiac 3.8 m.
//  [F]  Fraser listing "Aristarchos": 40 m, beam 8.5 m, draft 4.88 m, 185 GT, Southern Spars carbon mast, "Panamax
//       rig", 2 x Caterpillar (480 hp), 2 x Kohler 55 kW, cruising 12 kn, max 13.5 kn (under power), range 2,000 nm,
//       Bureau Veritas, Malta flag, built 2006, refit 2022; naval architect Frers, interior Rhoades Young.
//  [YB] YachtBuyer: hull colour "Navy Blue", superstructure white, teak deck; fuel 3,170 US gal (12,000 l), fresh
//       water 1,004 US gal (3,800 l); twin screws; tenders Castoldi 18 ft, Zodiac 12 ft 6 in.
//  [CW] CharterWorld: 39.93 m, 8.53 m, 4.88 m; 2 x 490 hp CAT; refits 2015 and 2020; photographs (the profile under
//       sail, the aerial at anchor, the aft deck with the two big deck winches, the twin helm consoles, the transom
//       "ARISTARCHOS / PIRAEUS"). [IT] itboat.com: "quite unusual with two rudders, which is rare on such large yachts".
//       [BI] Boat International superyacht directory: 39.93 m, Nautor's Swan, 2006, Frers.
// Hull 131-001 = Aristarchos: confirmed by [W] (one built, named), [IT], [BI] and the charter / sale listings.
//
// Estimates ('est.') where nothing is published: the hull's lines (from the profile and aerial photographs and the
// published LOA / LWL / beam / draft), the split of the 989 m^2 (main ~430, jib ~395 and the staysail ~164 m^2: the
// photographs show the main and one headsail set, and the sail plan's I, J, P, E), the keel and rudder sizes, the
// mass distribution, spreader count (three sets, from the photographs), the engine rpm, gear and props, the deck
// hardware positions. No gennaker or code zero is listed in her inventory [NJ], so she carries none here.
import { DEG, HP, rrTable, massProps } from './util.js';

const LWL = 34.7, M = 185000, BAL = 36000;
// x from the centre of gravity, forward; the hull 40.0 m from the transom's top (-20.4) to the stem (19.6): a 1.3 m
// bow overhang and a 4.0 m counter (the photographs; LWL 34.7 m) (est.)
const BOW = 19.6, STERN = -20.4;
const tx = (t) => STERN + t * (BOW - STERN);
// what the hull's 185 t is made of (est., from the parts' published weights where there are any): the lead bulb 36 t
// [W], the keel fin and its floors, the deckhouse, interior, tanks half full (12,000 l diesel, 3,800 l water [YB]),
// twin C12s (~1.2 t each with gearboxes) and generators, deck gear, spars and sails; the rest is the GRP shell and deck
const ITEMS = [
  { name: 'bulb', m: BAL, box: { x0: -2.4, x1: 2.6, y: 0.25, z0: -4.75, z1: -4.1 } },
  { name: 'fin', m: 7000, box: { x0: -1.6, x1: 2.6, y: 0.12, z0: -4.0, z1: -1.4 } },
  { name: 'rudders', m: 1400, box: { x0: -15.3, x1: -14.5, y: 1.55, z0: -2.6, z1: 0 } },
  { name: 'engines', m: 3200, box: { x0: -10.0, x1: -7.5, y: 1.25, z0: -0.9, z1: -0.2 } },
  { name: 'generators', m: 1400, box: { x0: -12.5, x1: -11.0, y: 1.6, z0: -0.5, z1: 0.1 } },
  { name: 'tanks', m: 7900, box: { x0: -6.0, x1: 4.0, y: 2.0, z0: -1.1, z1: -0.4 } },
  { name: 'deckhouse', m: 6000, box: { x0: -4.6, x1: 1.8, y: 2.5, z0: 2.3, z1: 3.4 } },
  { name: 'deck gear', m: 6000, box: { x0: -17.0, x1: 17.0, y: 2.6, z0: 1.8, z1: 2.4 } },
  { name: 'anchors and chain', m: 2000, at: [16.8, 0, 1.0] },
  { name: 'interior', m: 44000, box: { x0: -16.0, x1: 16.0, y: 2.8, z0: -0.6, z1: 2.0 } },
  { name: 'boom', m: 2200, box: { x0: -13.4, x1: 3.4, y: 0.25, z0: 5.1, z1: 5.7 } },
  { name: 'sails', m: 1000, at: [5.0, 0, 16.0] },
  { name: 'rigging and furlers', m: 2500, at: [6.0, 0, 26.0] },
];
// (the mast: Southern Spars carbon, ~3.1 t as the rig's structure below sizes its section; here for the class's own centre of
// gravity, with the shell's 0.6 m: the hull from the bottom to the sheer and the deck)
const MAST_M = 3050, inItems = ITEMS.reduce((a, it) => a + it.m, 0) + MAST_M;
const zOf = (it) => (it.box ? (it.box.z0 + it.box.z1) / 2 : it.at[2]);
const MP = massProps([...ITEMS.map((it) => ({ m: it.m, z: zOf(it), ry: it.box ? it.box.y : 0.2, rx: it.box ? (it.box.x1 - it.box.x0) / 3.5 : 0.5 })),
  { m: MAST_M, z: 26.0, rz: 15 }, { m: M - inItems, z: 0.6, ry: 3.0, rx: 11 }]);

export default {
  id: 'swan131', name: 'Swan 131 Aristarchos', group: 'cruiser',
  blurb: "Hull 131-001, the only Swan 131 and the biggest Swan ever launched (Nautor, 2006). Frers lines, 40 m and 185 tonnes, a navy hull, a flush teak deck and a low raised saloon. Southern Spars carbon rig with in-boom furling, captive hydraulic winches, twin rudders, twin Caterpillars. Push a button and the winch does the rest.",
  specs: 'LOA 40.00 m · LWL 34.7 m · Beam 8.50 m · Draft 4.88 m · ~185 t (180 t light) · 36 t ballast · I 50.3 / J 15.0 / P 47.0 / E 15.6 m · 989 m² upwind',
  lwl: LWL, loa: 40.0, beam: 8.5, bowX: BOW, sternX: STERN, freeboard: 2.15, canoeDraft: 1.45, wetted: 215, draft: 4.88,
  bowsprit: 0,
  massHull: M, zG: MP.zG, crewN: 6, crewEach: 80, crewZ: 3.1, crewMaxOut: 1.5, crewLee: -0.8, hikeRate: 0.4, hikeMVC: 0.02,
  gm: 2.6, bmForm: 2.2, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.05, amY: 0.75, amYaw: 0.5, amRoll: 0.3,
  massItems: [...ITEMS],
  // (a long, fine-ended displacement hull: slenderness L / vol^(1/3) 6.1, past the sportboat's; prismatic ~0.56)
  rr: rrTable(LWL, M + 480, { prism: 0.05 }),
  planing: 0,
  // the fin (est.: root chord 5.6 m tapering to 3.6 m over 2.6 m down to the bulb, 17 m^2 with the bulb's side),
  // its lift a quarter chord back from the leading edge; the bulb's bottom at the 4.88 m draft
  keel: { x: 0.9, z: -3.15, area: 17.0, ARe: 3.0, stall: 14 * DEG, cd0: 0.009, span: 3.4, chord: 5.0 },
  // twin spade rudders under the counter, 1.55 m either side of the centreline ([NJ] twin rudders, [IT]; size est.:
  // 2 x 1.9 m^2, 2.4 m deep); the leeward one bites deeper as she heels, the windward one lifts toward the surface
  rudder: { x: -14.7, y: 1.55, z: -1.45, area: 3.8, ARe: 3.0, stall: 16 * DEG, cd0: 0.011, max: 35 * DEG, span: 2.4, chord: 0.85, twin: true,
    foil: { root: 'hull', balance: 0.2 } },
  hullLat: { area: 34, cd: 0.9, z: -0.6 },
  windage: { area: 82, z: 9.5, cd: 0.95 },
  // the mast's centre 15.0 m + its half chord aft of the forestay's tack (J [W]); the main's tack P below the black
  // band, which sits under the masthead crane; mastHeight: the masthead above the DWL (the sheer there 2.35 + I 50.32
  // = the forestay's hounds at 52.67; the 54 m keel-stepped spar [NJ] has its heel ~1.3 m under the DWL)
  mastX: 3.85, mastHeight: 53.2, boomZ: 5.4, mastR: 0.32, keelBulb: false,
  vppSecs: 160,
  // the crew rolls the main down into its boom as the wind rises (a superyacht reefs from ~17-22 kn true upwind, later
  // off the wind) rather than twist its head off; the AI's race reefing by the same winds (estimate: tuned in the cloth
  // model, where the reefed main beat the full one eased to her ~17 degree target: 20 kn 11.1 kn at 40 deg against
  // 9.2 with the first reef held to 22 kn)
  autoReef: { up: [17, 22], off: [23, 29] }, reefWind: [17, 22],
  // (her crew holds her near 17 degrees, but not at any cost: in the cloth model the full depower build-up held her at
  // 17-19 degrees in 20-25 kn and cost 10-17 % of her speed close-hauled; capped at 0.7 she sails at 19-22 degrees and
  // gives up 2-8 %. Estimate)
  targetHeel: 17 * DEG, depowerMax: 0.7, canCapsize: false, hasBackstay: true, hasBoard: false, reefTime: 75,
  // (powered: every working line is on a hydraulic winch or ram, so the "crew power" is the hydraulics': a Rondal
  // captive winch pulls ~8-10 t; no hand tires on it: js/fatigue.js)
  sheetPower: 60000, powered: true,
  backstayBend: 0.3,
  // Twin Caterpillar C12 (6-cyl 12 l diesels, 480 hp = 358 kW each [NJ][F]) on twin shafts ([YB] twin screws), 2.5:1
  // reduction (est.), four-blade feathering props ~1.0 m (est.: folding: true is a prop that offers little drag sailing)
  // 1.25 m either side of the centreline, ahead of the rudders. Her published 13.5-14 kn under power is the check.
  engine: { type: 'inboard', model: '2 × Caterpillar C12', kW: 480 * HP, rpmMax: 2100, rpmIdle: 650, cyl: 6, fuel: 'diesel', gear: 2.5, wake: 0.06,
    prop: { D: 1.0, P: 0.8, Z: 4, BAR: 0.55, folding: true, rh: 1 }, twin: 1.25, pos: [-11.4, 0, -1.45], mount: [-8.7, 0, -0.55], mass: 2600, inMass: true,
    shaftAngle: 8 * DEG, exhaust: [-18.6, 3.55, 0.55], exhaustR: 0.07 },
  // line handling: Rondal captive hydraulic winches below deck (jib sheets, mainsheet, main halyard, runners), a
  // hydraulic vang, backstay and outhaul (the in-boom furler's), Reckmann hydraulic furlers: push-button controls at
  // the helm consoles. Nothing to cleat, nothing to grind
  lines: { main: { handler: 'captive', n: 2, at: 'deck', d: 24, fibre: 'dyneema' }, jib: { handler: 'captive', n: 1, at: 'winch', d: 26, fibre: 'dyneema' }, lazy: { handler: 'captive', n: 1, at: 'winch', d: 26, fibre: 'dyneema' },
    vang: { handler: 'ram', n: 1, at: 'deck', max: 160e3, d: 60, fibre: 'ram' }, cunn: { handler: 'ram', n: 1, at: 'mast', max: 60e3 }, outhaul: { handler: 'ram', n: 1, at: 'boom', max: 50e3 },
    backstay: { handler: 'ram', n: 1, at: 'deck', max: 250e3 }, trav: { handler: 'captive', n: 1, at: 'car' }, jibHalyard: { handler: 'ram', n: 1, at: 'mast', max: 120e3 } },
  sails: [
    // in-boom furling main with full horizontal battens (est. 430 m^2 of the 989 [NJ]; P 47.0, E 15.64 [W]); it reefs
    // by rolling down into the boom. (ropeK, tapeK, clewK: her sheets, vang, leech tape and clew fittings in proportion
    // to her loads, ~25x a 35 ft yacht's: js/sail/rigsim.js)
    { key: 'main', kind: 'boom', area: 430, luff: 47.0, foot: 15.6, head: 3.2, depth: [0.1, 0.12, 0.11], twistMax: 18 * DEG,
      cd0: 0.06, ARe: 5.2, min: 2 * DEG, max: 78 * DEG, trav: [-4 * DEG, 4 * DEG], Iboom: 1.9e5, boomMass: 2200, reefs: 2, furling: true, inBoom: true,
      vangBend: 0.02, sheetBend: 0.02, ropeK: 25, tapeK: 25, clewK: 25, color: 0xe9e6dc, boomR: 0.36, boomRound: false, pocketW: 0.12,
      pockets: [[0.13, 1.0], [0.27, 1.0], [0.41, 1.0], [0.55, 1.0], [0.69, 1.0], [0.83, 1.0]],
      battens: { EI: 1500, full: true, rows: [0.13, 0.27, 0.41, 0.55, 0.69, 0.83] },
      track: { x: -12.9, z: 2.2, half: 1.2, s: 15.1 }, boomEI: 1.6e8, boomMmax: 9e5, vang: 'rigid', vangMax: 160e3, vangSpring: 2e5, vangDrop: 2.8,
      preventer: 120e3, brake: 30e3 },
    // furling jib on the forestay, ~100% (est. 395 m^2), the Reckmann drum at the stemhead; rolled in a little with each
    // reef of the main (est.: 85% and 70% set)
    { key: 'jib', kind: 'loose', area: 395, tackX: 19.05, tackZ: 3.05, luff: 50.6, foot: 15.4, head: 0.6, footRise: 1.2,
      depth: [0.11, 0.12, 0.1], cd0: 0.04, ARe: 6.0, min: 9 * DEG, max: 50 * DEG, sagK: 0.8, ropeK: 20, tapeK: 25, furlReef: [1, 0.85, 0.7], color: 0xe9e6dc, window: false },
  ],
  hull: { color: 0x0e1828, stripe: 0xc9cdd2, deck: 0xc8a978, boot: 0x14161a, bootTop: 0xe8e8e4, levels: [0.03, 0.11, 0.64, 0.6], rough: 0.18 },
  cloth: 'superMembrane',
  sailcloth: { cloth: 0xe9e6dc, kind: 'laminate', draft: false, scrim: 0.45, num: '#2a3346', logo: '#2a3346', trans: 0.2, rough: 0.5 },
  insignia: '',   // (her sails carry no class insignia in the photographs)
  nameColor: '#e9ecef',
  // the chase camera ~1.75 hull lengths off (her 53 m mast in the frame); a race: a superyacht regatta's course (a
  // 3 km beat) and at most five sisters on the line (there is one Swan 131: the fleet is what-if)
  camDist: 70, courseLen: 3000, raceFleetMax: 5, lineSpacing: 24,
  // the sail plan's own structure: Southern Spars carbon keel-stepped mast, three sets of carbon spreaders, BSI rod
  // rigging (Nitronic 50 rod: a stiffer, stronger stay than the 1x19 wire table for the same diameter: given here as
  // the 1x19 diameter of equal breaking load), inner forestay with running backstays, a hydraulic backstay
  rigStructure: {
    step: { type: 'keel', z: -1.3, partners: 2.4 },
    spans: [{ z0: -1.3, z1: 44.0, a: 0.82, b: 0.56, t: 0.016, mat: 'carbon' }, { z0: 44.0, z1: 53.2, a: 0.6, b: 0.42, t: 0.011, mat: 'carbon' }],
    spreaders: [{ z: 15.1, len: 3.3, sweep: 0.5, EA: 3e8, EI: 5e6 }, { z: 27.5, len: 2.6, sweep: 0.4, EA: 2.5e8, EI: 3e6 }, { z: 39.4, len: 1.9, sweep: 0.3, EA: 2e8, EI: 2e6 }],
    chainX: -0.6, chainIn: 0.92,
    wires: [
      // (discontinuous rod: the V1 cap over the top spreader to the hounds, D3 over the second to the top spreader's
      // root, D2 over the first to the second's, the D1 lowers fore and aft; each from the chainplate here, the spar
      // model taking the stack's sum through the spreader tips)
      { key: 'capShroud', to: 'hounds', via: 2, d: 44, pre: 185e3 },
      { key: 'interShroud', to: 39.4, via: 1, d: 36, pre: 100e3 },
      { key: 'midShroud', to: 27.5, via: 0, d: 36, pre: 100e3 },
      { key: 'lowerFwd', to: 15.1, dx: 0.6, d: 34, pre: 80e3 },
      { key: 'lowerAft', to: 15.1, dx: -0.6, d: 34, pre: 80e3 },
      { key: 'forestay', stay: 'jib', d: 44 },
      { key: 'runner', to: 40.0, runner: true, d: 30, pre: 70e3 },
      { key: 'backstay', to: 'top', off: -0.3, low: 'transom', d: 36, pre: 150e3, adjust: 0.12 },
    ],
    houndsZ: 52.67, prebend: 0.08, lineMax: 160e3, sheetMax: 160e3,
  },
  // what the damage model checks (js/damage.js): the rod stack's breaking loads (est., for a rig of this righting
  // moment: ~2.4 MN m at 30 deg over a 3.9 m chainplate half-beam, x2.8), the carbon spar
  rigSpec: { stayed: true, b: 3.9, cap: 0.45, pre: 0.12, spreader: 15.1, mRig: 10300, zRig: 25, panel: 0.6,
    mast: { spec: 'Southern Spars carbon, ~820 x 560 mm (est.)', r: 0.3, t: 0.016, sy: 500e6 },
    parts: {
      cap: { name: 'Cap shroud (V1)', spec: 'BSI Nitronic 50 rod (est. -170)', mbl: 1.6e6 },
      lower: { name: 'Lower shrouds (D1)', spec: '2 × Nitronic 50 rod (est. -115)', mbl: 2.2e6 },
      chain: { name: 'Chainplate', spec: 'Titanium / composite (est.)', mbl: 4.5e6 },
      fore: { name: 'Forestay', spec: 'Nitronic 50 rod + Reckmann furler (est.)', mbl: 1.6e6 },
      back: { name: 'Backstay', spec: 'Nitronic 50 rod, hydraulic ram (est.)', mbl: 1.1e6 },
    } },
  // damage: standing rigging from the rig above (rod as its 1x19-equivalent breaking load); the hull a 40 m GRP
  // superyacht's (est.)
  hullSpec: { crack: 60e3, pen: 400e3, hole: 120e-4, keel: 3.0e6, rudderBend: 60e3, ballast: BAL, zBallast: -4.45,
    flot: 0, down: { z: 1.9, A: 0.3 }, pumps: [{ name: 'Electric bilge pumps (2 x)', lpm: 800 }, { name: 'Engine-driven bilge pump', lpm: 1500 }] },
  offsets: {
    // (photographs: a near-straight sheer rising to the bow; freeboard ~2.1 m amidships)
    sheer: [[0, 1.95], [0.15, 2.0], [0.4, 2.12], [0.6, 2.28], [0.8, 2.5], [0.95, 2.7], [1, 2.78]],
    deck: [[0, 0.74], [0.08, 0.83], [0.2, 0.93], [0.35, 0.99], [0.48, 1.0], [0.6, 0.97], [0.72, 0.88], [0.82, 0.73], [0.9, 0.53], [0.96, 0.3], [1, 0.04]],
    wl: [[0, 0.5], [0.1, 0.66], [0.3, 0.84], [0.5, 0.88], [0.7, 0.82], [0.85, 0.6], [0.95, 0.35], [1, 0.1]],
    // the counter's underside reaches the DWL 4.0 m forward of the transom (t 0.1), the forefoot 1.3 m aft of the stem
    keel: [[0, 0.55], [0.05, 0.25], [0.1, -0.01], [0.13, -0.2], [0.18, -0.5], [0.3, -1.05], [0.45, -1.4], [0.58, -1.45], [0.7, -1.3], [0.82, -0.95], [0.92, -0.42], [0.965, -0.04], [0.976, 0.3], [0.986, 1.15], [1, 2.7]],
    bilge: [[0, 3.2], [0.3, 2.5], [0.6, 2.2], [1, 1.8]], dead: [[0, 0.1], [0.4, 0.22], [0.8, 0.5], [1, 0.85]], flare: [[0, 0.9], [0.5, 0.85], [1, 0.72]],
    crown: 0.12, transomRake: 0.45,
  },
  model: {
    // the guest cockpit at the saloon's aft end, a step below the deck, its U-sofas and table (photos)
    cockpit: { t0: 0.275, t1: 0.4, w: 0.56, sole: 1.75, seat: 0.42, seatW: 0.55, coaming: 0, table: 0.335, seatMat: 'paint', color: 0xf3f2ee, seats: false },
    deck: 'teak', deckPlank: 0.052, toerail: 'teak', cleatScale: 2.4, bowCleatX: 1.1,
    // the raised saloon: from just aft of the mast, its front a raked windscreen; its sides carried on aft as the guest
    // cockpit's high coamings (js/boats/detailed.js EXTRAS.swan131); the long lens-shaped smoked window in its side runs on
    // aft along them to its point abreast the cockpit table (the aerial photographs: from ~0.47 to ~0.67 of her length from
    // the stem)
    cabins: [{ t0: 0.4, t1: 0.573, h: [[0.4, 0.98], [0.46, 1.04], [0.52, 1.04], [0.573, 0.97]], w: [[0.4, 2.8], [0.47, 2.92], [0.53, 2.8], [0.573, 2.25]],
      slope: 0.1, camber: 0.05, frontRake: 0.95, aftRake: 0.05, color: 0xf3f2ee, roof: 'paint', roofColor: 0xeeede8, rough: 0.3,
      windows: [{ kind: 'lens', t0: 0.4015, t1: 0.53, g0: 0.335, g1: 0.53, zf0: 0.13, hf: 0.76, peak: 0.7, pinch: 1.3 }, { kind: 'front', n: 3, w: 0.78 }],
      hatches: [{ t: 0.45, w: 0.9, l: 0.9 }, { t: 0.51, w: 0.9, l: 0.9 }] }],
    lifelines: { t0: 0.02, t1: 0.96, h: 0.8, spacing: 2.2, pushX: 0.35, pulpX: 0.6 },
    steering: { kind: 'twin', x: -11.85, y: 2.05, r: 0.72, hub: 1.0, onDeck: true, rim: 'wood', rimR: 0.032, spokes: 6, spokeK: 1.8 },
    rudder: { kind: 'spade', twin: true, color: 0x14161a, thick: 0.12, taper: 0.7, sweep: 0.12 },
    keel: { kind: 'fin', chord: 5.6, taper: 0.64, sweep: 0.22, thick: 0.11, color: 0x14161a, bulb: { len: 7.0, r: 0.56, fwd: 0.32, flat: 1.4 } },
    masts: { main: { mat: 'white', r: 0.32, rTop: 0.2, spreaders: [{ f: 0.255, len: 3.3, sweep: 8 * DEG }, { f: 0.5, len: 2.6, sweep: 8 * DEG }, { f: 0.74, len: 1.9, sweep: 8 * DEG }],
      wire: 0.02, lowerWire: 0.017, sprR: 0.09, sprMat: 'mast', lowerX: [0.6, -0.6], chainAft: 0.6, chainIn: 0.92 } },
    backstay: { split: false, x: -20.0, z: 2.0, top: 53.1 },
    runners: { z: 40.0, x: -12.6, r: 0.015, in: 0.92 },
    stayR: 0.022, scale: 3,
    noNumber: true, transomName: { text: 'ARISTARCHOS', port: 'PIRAEUS', w: 3.2 },
    extras: ['swan131'],
  },
  // deck hardware (est., from the photographs: the mainsheet's traveller across the deck just aft of the wheels'
  // consoles (a recessed hydraulic car, est.: no plan of it is published; a 40 m sloop's main needs one to be
  // sheeted to the centreline upwind), the jib's lead blocks on short tracks abreast the mast, the captive winches' deck exits beside the
  // saloon); a superyacht's blocks and lines, ~3x a 40 ft yacht's
  hw: { trav: [-12.9, 1.2], boomS: 0.97, winch: [0.9, 3.25], jibTrack: [5.4, 2.6, 3.3], clutchX: 1.5, winchR: 0.09, helm: 'Wheel', captive: true, scale: 3, ropeScale: 1.8, vangS: 4.0, vangZ: 1.0 },
};
