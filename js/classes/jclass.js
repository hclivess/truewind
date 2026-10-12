// The J Class: the big Universal Rule cutters of the 1930 - 1937 America's Cups (rating 65 - 76 ft under
// R = 0.18 L sqrt(S) / cbrt(D)), and the three of Charles E. Nicholson's British challengers that sail today, as they
// are rigged now: Shamrock V (JK3, 1930), Velsheda (JK7, 1933) and Endeavour (JK4, 1934).
//
// Sources (fetched October 2026):
//  * J Class Association, jclassyachts.com: Shamrock V JK3 (LOA 36.89 m, LWL 26.84 m, beam 6.00 m, 168.0 t, upwind
//    sail area 756.4 m², spinnaker 792.6 m²; mahogany planking on steel frames, launched 14 April 1930 at Camper &
//    Nicholsons, Gosport; 2000 Pendennis refit returned her deck structures and rig to their 1930s configuration);
//    Endeavour JK4 (LOA 39.56 m, LWL 26.88 m, beam 6.78 m, 178 t, upwind 948 m², spinnaker 947 m²; 2010-11 refit by
//    Yachting Developments, Auckland, to Dykstra's design: new deck structure and layout, rig, sails, engine room);
//    Velsheda JK7 (LOA 39.25 m, LWL 27.73 m, beam 6.55 m, 180 t, upwind 942 m², spinnaker 934.7 m²).
//  * Dykstra Naval Architects design pages JK3 / JK4 / JK7 (Shamrock V: LOA 36.5 m, LWL 27 m, beam 5.85 m, draft
//    4.8 m, ~172 t, fuel 4,700 l, water 3,700 l; Endeavour: draft 4.76 m; Velsheda: LOA 39.4 m, LWL 27.8 m, beam
//    6.6 m, draft 4.8 m, ~173 t; rebuilt 1997 by Southampton Yacht Services with "the tallest one-piece carbon mast in
//    the world").
//  * Yachting World, "A pocket guide to the J Class yachts" (Shamrock V: 36.50 / 26.7 / 6.00 m, 166 t, "the only
//    wooden J and the smallest", dark green hull, bronze deck fittings; Endeavour: 39.31 / 27.30 / 6.68 m, 175 t,
//    royal 'Endeavour Blue' hull, clean deck, single deckhouse; Velsheda: 39.25 / 27.8 / 6.57 m, 180 t, dark blue
//    hull, pinched transom); Yachting World, "At the helm of J Class yacht Endeavour" (490 m² main with the JK4
//    insignia, Southern Spars carbon mast, ECsix carbon rigging, Cariboni hydraulic rams under the aft deck for the
//    mainsheet traveller, push-button hydraulic traveller / cunningham / outhaul / backstay, winches 'reduced to the
//    minimum', a keel-hung rudder that takes real effort; "upwind figures of 9.5 to 10.5 knots and up to 12 knots
//    reaching are typical for a J" in 10 - 17 kn).
//  * Wikipedia "Shamrock V" (1930 figures: 119 ft 10 in / 81 ft 1 in / 19 ft 8 in / 14 ft 8 in, 134 tons, 7,540 sq ft,
//    hollow spruce mast; Bermudan cutter from launch, not converted), "Velsheda" (1997 rebuild: one-piece carbon mast,
//    first inboard diesel), "Endeavour (yacht)" (steel; 1984-89 rebuild by Elizabeth Meyer at Royal Huisman),
//    "J Class (yacht)" (the Universal Rule, rating 65 - 76 ft, LWL 75 - 87 ft, 15 ft draft); cse.unr.edu J Class
//    pages (Shamrock V: mast 150 ft above the deck); MDL Marinas / Barche Magazine (Shamrock V relaunched at Saxon
//    Wharf, Southampton, 20 May 2024 after a two-year rebuild: 95% of her 1970 teak planking refitted, 62% of the steel
//    frames kept, all 6,500 bronze bolts renewed, rigging by Marine Results).
//  * Photographs measured for the sail plan, the deck and the hull (Wikimedia Commons): "Le Shamrock V (voilier
//    britannique)" (Agence Rol, 1930, two side views: mast 15.4 m abaft the stem, boom ~19.5 m, boom ~3 m above the
//    water, sheer 2.3 m at the stem and ~1.1 m amidships, overhangs ~4.6 m forward and ~5 m aft); "Velsheda - J Class
//    Yacht - J-K7" (Falmouth 2012, side views under main and genoa and under spinnaker: mast 12.7 m abaft the stem,
//    boom ~22 m, genoa foot ~20 m, two varnished deckhouses aft of the mast, a wide flat-topped boom, gold cove line);
//    "J Class Yacht Endeavour ... Don Ramey Logan" (on deck: big chrome drum winches, coffee-grinder pedestals, the
//    wheel aft behind a varnished console, flush teak deck).
// '(est.)' marks what no source gives and is estimated from those photographs and the totals: ballast (none of the
// three publishes it: ~58% of the displacement in lead, the J Class's order with the refits' 'improved ballast ratio'), the split between main and genoa
// (Endeavour's 490 m² main of 948, the same share for the others), mast heights (Shamrock V's 150 ft above the deck
// kept; Velsheda's reported 171 ft spar and Endeavour's of the same sail area), engines (Shamrock V's fuel tank says
// she has one; none of the three publishes its make), the hull lines (shaped to the dimensions and photographs, not
// taken off the drawings).
//
// Rigged as they sail today: the modern restored configuration, not 1930s hand winches. Big drum winches on deck
// driven from below (hydraulic) and from coffee-grinder pedestals, a hydraulic captive mainsheet winch and push-button
// traveller, backstay, vang, cunningham and outhaul (Endeavour, Yachting World); laminate sails (3Di / moulded) in
// the cloth's natural grey-cream; a symmetric spinnaker on a pole; running backstays (and the permanent backstay)
// as the J's carry them; a diesel inboard with a feathering propeller.
import { DEG, rrTable, massProps } from './util.js';

// Lines of a Nicholson J: a long spoon bow, a long counter to a small raked transom ('pinched'), slack wineglass
// sections, the keel faired into the canoe body (no separate fin), deepest at its heel where the rudder hangs on its
// trailing edge; t: 0 at the transom .. 1 at the stem head (js/hull.js offsetLines).
//   tA, tF: the waterline's aft and forward ends; zBow, zMid, zStern: sheer heights; tK: the keel's heel; finW: half
//   thickness of the keel
function jLines(o) {
  const { tA, tF, zBow, zMid, zStern, tK } = o;
  const tm = (tA + tF) / 2;
  return {
    sheer: [[0, zStern], [tA * 0.9, zStern - 0.12], [0.35, zMid + 0.02], [0.5, zMid], [0.66, zMid + 0.12], [0.8, zMid + 0.38], [0.92, zBow - 0.42], [1, zBow]],
    // deck plan: a narrow pinched transom (~1.3 m), the greatest beam a little aft of the middle, a fine bow
    deck: [[0, o.transomW], [0.04, o.transomW + 0.12], [0.12, 0.55], [0.22, 0.76], [0.34, 0.93], [0.47, 1.0], [0.58, 0.985], [0.7, 0.9], [0.8, 0.74], [0.88, 0.54], [0.95, 0.3], [1, 0.04]],
    // the turn of the bilge (as a fraction of the deck's half-breadth): slack, the topsides flaring out above it
    wl: [[0, 0.55], [tA, 0.72], [0.3, 0.92], [tm, 0.97], [0.68, 0.94], [tF - 0.04, 0.74], [tF + 0.05, 0.5], [1, 0.35]],
    // the canoe body's bottom on the centreline: up into the overhangs (+), the counter's underside rising to the
    // transom, the spoon bow's forefoot curving up to the stem head
    keel: [[0, o.transomZ], [tA * 0.45, o.transomZ * 0.55], [tA, 0.0], [tA + 0.06, -0.75], [0.32, -1.5], [tm, -1.95], [0.62, -1.88], [0.7, -1.5], [0.77, -0.9], [tF - 0.035, -0.25], [tF, 0.0], [tF + 0.04, 0.42], [0.95, 1.05], [0.985, 1.65], [1, zBow - 0.15]],
    // the keel below it: the rudder's line at its aft edge (raked, its top aft) down to the heel, the bottom nearly
    // level, the leading edge sweeping up into the forefoot
    fin: [[tK - 0.075, -0.75], [tK - 0.045, -2.4], [tK - 0.015, -4.1], [tK, -o.draft], [tK + 0.12, -o.draft + 0.12], [tK + 0.24, -o.draft + 0.45],
      ...[0.2, 0.4, 0.6, 0.8].map((u) => [tK + 0.24 + u * (tF - 0.03 - tK - 0.24), -(o.draft - 0.45) * (1 - u ** 1.25)]), [tF - 0.03, -0.12]],
    finW: [[tK - 0.07, 0.12], [tK, 0.24], [tK + 0.12, 0.42], [tK + 0.24, 0.45], [tK + 0.36, 0.38], [tF - 0.12, 0.22], [tF - 0.03, 0.08]],
    bilge: [[0, 1.8], [0.3, 1.9], [tm, 2.0], [0.8, 1.7], [1, 1.45]],
    dead: [[0, 0.35], [0.3, 0.38], [tm, 0.4], [0.8, 0.55], [1, 0.7]],
    flare: [[0, 0.8], [0.5, 0.78], [0.85, 0.65], [1, 0.6]],
    tumble: 0, crown: 0.09, transomRake: o.transomRake, stemX: 0,
  };
}

// A J Class yacht from her particulars. o: id, name, sailNo, dims (loa, lwl, beam, draft, disp), rig (mastFromStem,
// mastHeight, boomZ, main / genoa / spinnaker areas, pole), look (hull, cove, boot, deck), deckhouses
function jClass(o) {
  const LOA = o.loa, LWL = o.lwl, M = o.disp, BAL = o.ballast;
  // the waterline set in the hull's length (overhangs: the bow's ~44% of the total, the counter's the rest)
  const oh = LOA - LWL, ohF = oh * o.bowShare, ohA = oh - ohF;
  // x = 0 at the centre of gravity: the waterline's middle, 2.5% of it aft (est.: an LCB ~53% of the LWL from the bow)
  const xWLf = LWL / 2 - 0.025 * LWL, bowX = xWLf + ohF, sternX = bowX - LOA;
  const tA = ohA / LOA, tF = (LOA - ohF) / LOA, X = (t) => sternX + t * LOA;
  const mastX = bowX - o.mastFromStem;
  // mass: the lead keel low in the keel's heel; the hull (steel frames and plating or planking), deck, deckhouses,
  // interior, tanks and machinery; the rig (spars, rod, sails) (est.: their centres from the drawings' proportions)
  const rigM = o.rigMass, hullM = M - BAL - rigM;
  const MP = massProps([{ m: hullM, z: o.hullZ, ry: 2.2, rx: 0.27 * LOA }, { m: BAL, z: -(o.draft - 0.85), ry: 0.25, rx: 4.2 }, { m: rigM, z: 0.42 * o.mastHeight, rz: 0.29 * o.mastHeight }]);
  const tK = o.tK;
  // the rudder on the keel's raked trailing edge: its hinge from the canoe body's underside (t = tK - 0.075) to the
  // heel (tK), 1.35 m of chord aft of it
  const hingeTop = X(tK - 0.075), rake = Math.atan2(X(tK) - hingeTop, o.draft - 0.75), hingeLen = (o.draft - 1.0) / Math.cos(rake);
  const rudderX = X(tK - 0.04) - 0.675;
  const crewN = o.crewN, crewEach = 85;
  const lines = jLines({ tA, tF, zBow: o.zBow, zMid: o.freeboard, zStern: o.zStern, tK, draft: o.draft, transomW: o.transomW, transomZ: o.zStern - 0.38, transomRake: 0.55 });
  // the forestay: from the stem head to the mast near its top (the genoa's luff; est. as Velsheda's 2012 photographs)
  const tackX = bowX - 0.35, tackZ = o.zBow + 0.25, headZ = o.mastHeight * o.forestayF;
  const C = {
    id: o.id, name: o.name, group: 'classic',
    blurb: o.blurb, specs: o.specs,
    lwl: LWL, loa: LOA, beam: o.beam, bowX, sternX, freeboard: o.freeboard, canoeDraft: 1.95, wetted: o.wetted, draft: o.draft,
    bowsprit: 0, cabin: true, longKeel: true,
    massHull: M - crewN * crewEach, zG: MP.zG, crewN, crewEach, crewZ: o.freeboard + 0.45, crewMaxOut: o.beam / 2 - 0.25, crewLee: -1.6, hikeRate: 0.3,
    gm: 1.5, bmForm: 1.0, Ixx: MP.Ixx, Izz: MP.Izz, amX: 0.07, amY: 0.9, amYaw: 0.6, amRoll: 0.3,
    // residuary resistance: a moderate-displacement hull of slenderness ~5 on her upright waterline. Heeled, her
    // overhangs immerse and the sailing length grows (the hydrostatics measure it each step: the Froude number is
    // taken on it), which is what the long ends were drawn for under the Universal Rule's measured L
    rr: rrTable(LWL, M, { prism: 0.04 }),
    // the keel and the canoe body above it as one low-aspect wing (as the long-keeled classes): the lateral plane
    // below the waterline, ~the keel's profile plus the canoe body's share, over the draft as span (the hull's mirror
    // doubles it: ARe 2 b^2 / A) (its skin friction is in the hull's)
    // (keelArea, keelX: the drawn keel's profile below the canoe body (~42-48 m^2, its centroid) and a quarter of the
    // canoe body's above it, as tools measured them on these lines)
    keel: { x: o.keelX, z: -o.draft / 2, area: o.keelArea, ARe: 2 * o.draft ** 2 / o.keelArea, stall: 24 * DEG, cd0: 0.004, span: o.draft, chord: o.keelArea / o.draft, long: true },
    // the rudder hung on the keel's trailing edge (pintles on the sternpost): no balance, its stock raked aft up through
    // the counter, a wheel to it through a geared quadrant (est. 3.5 turns lock to lock)
    rudder: { x: rudderX, z: -2.7, area: 1.35 * hingeLen, ARe: 1.7, stall: 22 * DEG, cd0: 0.012, max: 35 * DEG, span: hingeLen * Math.cos(rake), chord: 1.35, hung: true,
      foil: { root: 'hull', balance: 0.0, tc: 0.14 } },
    helm: { type: 'wheel', wheelR: 0.8, turns: 3.5, handMax: 300, friction: 60 },
    hullLat: { area: 6, cd: 0.9, z: -0.6 },
    windage: { area: 0.75 * LOA + 0.35 * o.mastHeight, z: 0.3 * o.mastHeight, cd: 1.0 },
    mastX, mastHeight: o.mastHeight, boomZ: o.boomZ, mastR: o.mastR, keelBulb: false,
    // (the VPP's run: she takes ~2 minutes to settle at her speed from its start, js/physics.js solvePolarAngle)
    vppSecs: 150, hydroStations: 44, hullStations: 120,
    // (sailed on her lines: a J races heeled ~20 degrees upwind in a breeze, the lee rail near the water)
    targetHeel: 20 * DEG, canCapsize: false, hasBackstay: true, hasBoard: false, runners: true,
    // the deck's hydraulic power: what the crew and the winches can pull on a sheet (N): a J's genoa sheet runs to
    // 10 - 15 t, the mainsheet to ~10 t (est.)
    sheetPower: 60000, reefTime: 180, reefWind: [24, 30],          // (est.: J Class racing stops at ~25 kn; a reef then)
    cloth: 'superLaminate',
    engine: o.engine,
    // line handling as rigged now: the sheets on big two-speed drum winches on deck driven hydraulically from below
    // (and by the grinders' pedestals), self-tailing; the mainsheet on a hydraulic captive winch below the aft deck;
    // traveller, vang, cunningham, outhaul, backstay on hydraulic rams (push-button panel); halyards on captive
    // winches at the mast foot. powered: metres of line a second the drive takes in, whatever the load up to its rating
    lines: {
      main: { handler: 'selfTailer', n: 2, at: 'winch', powered: 0.35, d: 22, fibre: 'dyneema' },
      jib: { handler: 'selfTailer', at: 'winch', powered: 0.5, d: 20, fibre: 'dyneema' },
      gen: { handler: 'selfTailer', at: 'winch', powered: 0.6, d: 18, fibre: 'dyneema' },
      trav: { handler: 'selfTailer', n: 1, at: 'deck', powered: 0.25 },
      vang: { handler: 'selfTailer', n: 1, at: 'deck', powered: 0.05, max: 150000 },
      cunn: { handler: 'selfTailer', n: 1, at: 'mast', powered: 0.05, max: 60000 },
      outhaul: { handler: 'selfTailer', n: 1, at: 'boom', powered: 0.05, max: 40000 },
      backstay: { handler: 'selfTailer', n: 1, at: 'deck', powered: 0.05, max: 200000 },
      jibHalyard: { handler: 'selfTailer', n: 1, at: 'mast', powered: 0.1, max: 120000 },
      tackLine: { handler: 'selfTailer', n: 1, at: 'deck', powered: 0.3 },
    },
    ropeStyle: 'modern',
    sails: [
      { key: 'main', kind: 'boom', area: o.main, luff: o.mastHeight - o.boomZ - 0.7, foot: o.mainFoot, head: 1.4, depth: [0.11, 0.13, 0.12], twistMax: 18 * DEG, roach: 0.05,
        cd0: 0.06, ARe: 5.2, min: 2 * DEG, max: 80 * DEG, trav: [-5 * DEG, 10 * DEG], Iboom: o.boomMass * (o.mainFoot ** 2) / 3, boomMass: o.boomMass, reefs: 2,
        vangBend: 0.02, sheetBend: 0.02, color: o.cloth, boomMat: o.boomMat, boomR: o.boomR, boomWide: o.boomWide, boomDeep: 0.95,
        pockets: [[0.2, 0.12], [0.35, 0.13], [0.5, 0.14], [0.64, 0.15], [0.78, 0.16], [0.9, 1.0]], ropeK: 10,
        // the mainsheet to a hydraulic traveller across the aft deck (est.: under the boom's after third); the boom a
        // carbon box section (est. EI 2.5e8 N m², yield moment 2.2 MN m); hydraulic rod vang; preventer and no brake
        track: { x: mastX - o.mainFoot * 0.78, z: o.freeboard + 0.25, half: 1.6, s: o.mainFoot * 0.78 }, boomEI: 2.5e8, boomMmax: 2.2e6, vang: 'rope', vangMax: 150000, preventer: 250000 },
      { key: 'jib', kind: 'loose', label: 'Genoa', area: o.genoa, tackX, tackZ, luff: headZ - tackZ, foot: o.genoaFoot, head: 0.4, footRise: 0.25,
        depth: [0.13, 0.14, 0.12], cd0: 0.045, ARe: 4.0, min: 8 * DEG, max: 45 * DEG, sagK: 0.7, color: o.cloth, window: false, ropeK: 10 },
      { key: 'gennaker', kind: 'spin', label: 'Spinnaker', pole: o.pole, replaces: 'jib', area: o.spin, tackX: mastX + 0.07 + o.pole, tackZ: o.freeboard + 4.2,
        luff: o.mastHeight * 0.86, foot: o.pole * 1.75, head: 1.2, rake: o.pole + 0.07,
        depth: [0.2, 0.22, 0.2], cd0: 0.09, ARe: 2.0, min: 16 * DEG, max: 100 * DEG, color: o.spinColor, spinBands: o.spinBands, cloth: 'superNylon', ropeK: 6 },
    ],
    hull: { color: o.hullColor, stripe: o.cove, deck: 0xb08a5c, boot: o.boot, bootTop: o.bootTop, levels: [0.0, 0.045, 0.17, 0.135], rough: 0.2, rubrail: null, wood: o.wood },
    sailcloth: { cloth: o.cloth, kind: 'laminate', num: o.numColor ?? '#1b1d22', logo: o.numColor ?? '#1b1d22', trans: 0.2, rough: 0.5, noDraftStripes: true },
    // the class insignia: a J over the sail number's letter and digit (JK3: 'J' above 'K3', as the yachts carry it)
    insignia: (g, x, y, cl) => { g.fillStyle = cl.logo; g.font = '700 70px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.fillText('J', x, y + 26); },
    // her sail number on the main (with the class's J over it), her own name; the regatta the AI fleet sails when she
    // races (js/main.js): the three of them; the chase camera stands off far enough to see her
    sailNo: o.sailNo, yachtName: o.yachtName, fleet: ['shamrock5', 'velsheda', 'endeavour'], camDist: 1.05 * LOA,
    offsets: lines,
    model: {
      // the helmsman's well round the wheel (a shallow footwell in the flush deck), and the afterguard's pit forward of it
      cockpit: { t0: o.wellT[0], t1: o.wellT[1], w: 0.42, sole: o.freeboard + 0.1 - 0.55, seats: false, coaming: 0.06, coamingMat: 'teak', grating: true },
      deck: 'laid', deckTone: o.deckTone ?? '#b38b5d', toerail: { bulwark: 0.1, cap: 'teak', color: o.hullColor }, bronze: o.bronze, cleatScale: 2.4, bowCleatX: 1.6,
      navLights: false,
      cabins: o.houses,
      steering: { kind: 'wheel', x: X((o.wellT[0] + o.wellT[1]) / 2) - 0.3, r: 0.8, hub: 1.05, rim: 'wood' },
      rudder: { kind: 'keel', hingeX: hingeTop, rake, span: hingeLen, thick: 0.13, taper: 1.0, gap: 0, mat: 'hull' },
      keel: { kind: 'full' },
      masts: { main: { mat: o.mastLook, r: o.mastR, rTop: o.mastR * 0.62, spreaders: o.spreaders, hounds: headZ, chainIn: 0.92, chainAft: 0.5, wire: 0.012, lowerX: [0.7, -0.7] } },
      backstay: { split: false, x: sternX + 0.35, z: o.zStern + 0.02, top: o.mastHeight - 0.1 },
      runners: { z: headZ - 0.6, x: mastX - o.runnerAft, foot: true }, wireR: 4,
      windex: false, hullName: { text: o.hullName, t: 0.07, z: o.zStern - 0.2, len: 2.6, color: o.nameColor, font: 'italic 700 78px Georgia, "Times New Roman", serif' },
      extras: ['jDeck'], jDeck: o.deckKit,
    },
    // deck hardware (js/rigging.js): mainsheet traveller [x, half length], boom sheeting point (fraction of the foot),
    // the genoa winches [x, y] (two-speed hydraulic drums, est. 0.42 m drum diameter), genoa car tracks [aft, fwd, y]
    hw: { trav: [mastX - o.mainFoot * 0.78, 1.6, o.freeboard + 0.14], boomS: 0.78, winch: [o.winchX, 2.15], jibTrack: [o.trackX[0], o.trackX[1], o.beam / 2 - 0.55], clutchX: mastX - 2.2, winchR: 0.21, helm: 'Wheel', bronze: o.bronze },
    // the rig as a structure (js/rig-structure.js) and its parts' strengths (js/damage.js) in one table (their keys do
    // not overlap): a keel-stepped carbon spar (Shamrock V's est. carbon too: her 2000 rig's material is not published),
    // four spreader sets, discontinuous rod (V cap shrouds over the top spreader, D diagonals to each spreader root),
    // the forestay to the genoa's head, running backstays to the hounds and a permanent backstay to the counter
    rigSpec: null,
    hullSpec: null,
    massItems: null,
  };
  // mass items (js/massprops.js): the lead in the keel's heel, the rudder, the machinery and tanks, the deck gear
  C.massItems = [
    { name: 'ballast', m: BAL, box: { x0: X(tK + 0.01), x1: X(tK + 0.3), y: 0.25, z0: -o.draft + 0.15, z1: -o.draft + 1.6 } },
    { name: 'rudder', m: 2200, box: { x0: rudderX - 0.6, x1: rudderX + 0.6, y: 0.06, z0: -4.0, z1: -1.0 } },
    { name: 'engine and gearbox', m: o.engine ? o.engine.mass : 0, at: [X(0.36), 0, -0.6] },
    { name: 'tanks (half full)', m: o.tanks, box: { x0: X(0.36), x1: X(0.6), y: 1.2, z0: -1.1, z1: -0.5 } },
    { name: 'interior', m: o.interior, box: { x0: X(0.2), x1: X(0.8), y: 2.0, z0: -0.8, z1: 1.0 } },
    { name: 'deckhouses and deck gear', m: o.deckGear, box: { x0: X(0.15), x1: X(0.75), y: 1.6, z0: o.freeboard, z1: o.freeboard + 0.7 } },
    { name: 'boom', m: o.boomMass, box: { x0: mastX - o.mainFoot, x1: mastX, y: 0.3, z0: o.boomZ - 0.3, z1: o.boomZ + 0.3 } },
    { name: 'sails', m: o.sailMass, at: [mastX - 3, 0, 0.35 * o.mastHeight] },
    { name: 'rigging', m: o.riggingMass, at: [mastX - 1, 0, 0.5 * o.mastHeight] },
  ].filter((it) => it.m > 0);
  // the rig structure: the mast's section from the drawing's radius (fore-and-aft 1.6 x it athwartships est.), wall
  // from Velsheda's reported 3.1 t spar; cap shrouds sized for ~2.8 x their load at 30 deg of heel
  const z0 = -0.6, zTop = o.mastHeight, L = zTop - z0, deck = o.freeboard + 0.1;
  const sprZ = o.spreaders.map((s) => deck + s.f * (zTop - deck));
  const dCap = o.rodD, a = 2 * o.mastR * 1.25, b = 2 * o.mastR;
  C.rigSpec = {
    // (js/rig-structure.js)
    step: { type: 'keel', z: z0, partners: deck },
    spans: [{ z0, z1: zTop - 9, a, b, t: o.mastWall, mat: o.mastMat === 'wood' ? 'spruce' : 'carbon' },
      { z0: zTop - 9, z1: zTop, a: a * 0.7, b: b * 0.72, t: o.mastWall * 0.75, mat: o.mastMat === 'wood' ? 'spruce' : 'carbon' }],
    spreaders: o.spreaders.map((s, i) => ({ z: sprZ[i], len: s.len, sweep: s.len * Math.sin(s.sweep), EA: 2e8, EI: 4e6 })),
    chainX: -0.5, chainIn: 0.92,
    wires: [
      { key: 'capShroud', to: 'hounds', via: 3, d: dCap, pre: 0.12 * 800 * dCap * dCap },
      { key: 'D3', to: sprZ[3], via: 2, d: dCap * 0.8, pre: 0.1 * 800 * (dCap * 0.8) ** 2 },
      { key: 'D2', to: sprZ[2], via: 1, d: dCap * 0.8, pre: 0.1 * 800 * (dCap * 0.8) ** 2 },
      { key: 'D1', to: sprZ[1], via: 0, d: dCap * 0.85, pre: 0.1 * 800 * (dCap * 0.85) ** 2 },
      { key: 'lowerFwd', to: sprZ[0], dx: 0.7, d: dCap * 0.7, pre: 0.08 * 800 * (dCap * 0.7) ** 2 },
      { key: 'lowerAft', to: sprZ[0], dx: -0.7, d: dCap * 0.7, pre: 0.08 * 800 * (dCap * 0.7) ** 2 },
      { key: 'forestay', stay: 'jib', d: dCap * 0.9 },
      { key: 'runner', to: 'hounds', runner: true, at: [mastX - o.runnerAft, o.beam / 2 * 0.86, o.freeboard + 0.1], d: dCap * 0.75, pre: 0.08 * 800 * (dCap * 0.75) ** 2 },
      { key: 'backstay', to: 'top', off: -0.05, low: 'transom', d: dCap * 0.7, pre: 0.08 * 800 * (dCap * 0.7) ** 2, adjust: 0.0025 * L },
    ],
    houndsZ: headZ, prebend: 0.002 * L, lineMax: 2.5 * 60000,
    // (js/damage.js)
    stayed: true, b: o.beam / 2 * 0.92, cap: 0.45, pre: 0.12, spreader: sprZ[0], mRig: o.rigMass, zRig: 0.42 * o.mastHeight, panel: (zTop - deck) / 5,
    mast: { spec: o.mastSpec, r: o.mastR, t: o.mastWall, sy: o.mastMat === 'wood' ? 40e6 : 500e6 },
    parts: {
      cap: { name: 'V cap shrouds', spec: `rod, ~${Math.round(800 * dCap * dCap / 1000)} kN break (~)`, mbl: 800 * dCap * dCap },
      lower: { name: 'D1 lowers', spec: `2 × rod, ~${Math.round(800 * (dCap * 0.7) ** 2 / 1000)} kN (~)`, mbl: 2 * 800 * (dCap * 0.7) ** 2 },
      chain: { name: 'Chainplates', spec: 'steel knees to the frames (~)', mbl: 3 * 800 * dCap * dCap },
      fore: { name: 'Forestay', spec: `rod / composite, ~${Math.round(800 * (dCap * 0.9) ** 2 / 1000)} kN (~)`, mbl: 800 * (dCap * 0.9) ** 2 },
      back: { name: 'Backstay', spec: `rod, ~${Math.round(800 * (dCap * 0.7) ** 2 / 1000)} kN (~)`, mbl: 800 * (dCap * 0.7) ** 2 },
    },
  };
  // the hull's strength (js/damage.js): a heavy steel-framed hull (plank on frame for Shamrock V), lead keel bolted
  // through floors, bilge pumps engine-driven and electric (est.)
  C.hullSpec = { crack: 60000, pen: 400000, hole: 120e-4, keel: 14 * M, longKeel: true, rudderBend: 60000, ballast: BAL, zBallast: -(o.draft - 0.85),
    flot: 0, down: { z: o.freeboard * 0.85, A: 0.3 }, pumps: [{ name: 'Engine-driven bilge pump', lpm: 600 }, { name: 'Electric bilge pumps (2)', lpm: 400 }, { name: 'Manual pump', lpm: 90, manual: true }] };
  return C;
}

// the deck as each is laid out now (est. from the photographs): low varnished deckhouses (houses), flush skylights,
// the coffee grinders' pedestals and the big drum winches (deckKit, drawn by js/boats/detailed.js 'jDeck')
// (a deckhouse of varnished mahogany with a row of rectangular lights each side: n panes with a mullion of
// varnish between them; a teak roof)
const house = (t0, t1, h, w, n = 4, extra = {}) => {
  const e = 0.012, pane = (t1 - t0 - 2 * e) / n, windows = [];
  for (let i = 0; i < n; i++) windows.push({ kind: 'rect', t0: t0 + e + i * pane + pane * 0.12, t1: t0 + e + (i + 1) * pane - pane * 0.12, zf: 0.56, hf: 0.42, round: 40 });
  return { t0, t1, h: [[t0, h], [t1, h]], w: [[t0, w], [t1, w]], slope: 0.05, camber: 0.05, frontRake: 0.05, aftRake: 0.05,
    color: 0x7a3a1c, side: 'wood', roof: 'teak', trim: 'teak', windows, ...extra };
};

export const shamrock5 = jClass({
  id: 'shamrock5', name: 'Shamrock V (J Class)', yachtName: 'Shamrock V', sailNo: 'K3', hullName: 'SHAMROCK V',
  blurb: "Sir Thomas Lipton's fifth and last America's Cup challenger (1930), Charles E. Nicholson's first J and the only one built in wood: mahogany planking on steel frames, a dark green hull, varnished deckhouses and bronze fittings. The smallest J afloat — 36.5 m, 168 tonnes, a 47 m mast — rebuilt at Southampton and relaunched in 2024.",
  specs: 'LOA 36.5 m · LWL 26.84 m · Beam 6.00 m · Draft 4.80 m · 168 t · Upwind sail 756 m² (main ~420, genoa ~336, est.) · Spinnaker 793 m² · Mast ~47 m above the water (est.)',
  loa: 36.5, lwl: 26.84, beam: 6.0, draft: 4.8, disp: 168000, ballast: 97000, bowShare: 0.42,
  freeboard: 1.15, zBow: 2.35, zStern: 1.5, transomW: 0.24, tK: 0.27, hullZ: -0.7, wetted: 228, keelArea: 52, keelX: -3.4, crewN: 22,
  mastFromStem: 15.4, mastHeight: 46.9, boomZ: 3.75, boomMat: 'wood', boomR: 0.32, boomWide: 1.05, mastR: 0.3, mastWall: 0.009, mastMat: 'carbon', mastLook: 'wood', mastSpec: 'carbon spar ~750 x 600 mm, varnished finish (est.)',
  forestayF: 0.9, rodD: 46, runnerAft: 13.5,
  spreaders: [{ f: 0.2, len: 1.9, sweep: 0 }, { f: 0.4, len: 1.6, sweep: 0 }, { f: 0.6, len: 1.3, sweep: 0 }, { f: 0.79, len: 1.0, sweep: 0 }],
  main: 420, mainFoot: 18.6, genoa: 336, genoaFoot: 15.6, spin: 792.6, pole: 13.5, boomMass: 1600, sailMass: 900, riggingMass: 1800, rigMass: 7500,
  tanks: 3600, interior: 14000, deckGear: 6000,
  cloth: 0xe9e3d2, spinColor: 0x1f5a3a,
  hullColor: 0x123b2a, cove: 0xc8a24a, boot: 0x2a2b2d, bootTop: 0xe9e4d6, wood: null, nameColor: '#c8a24a', bronze: true,
  houses: [house(0.265, 0.33, 0.55, 0.85, 3), house(0.43, 0.505, 0.42, 0.8, 4)],
  wellT: [0.1, 0.17], winchX: -2.2, trackX: [-0.5, 2.5],
  deckKit: { skylights: [0.38, 0.53, 0.65], grinders: [0.245, 0.4], winches: [[0.235, 0.62], [0.3, 0.75], [0.36, 0.8]], hatches: [0.73, 0.85] },
  // a diesel inboard (est.: her 4,700 l of fuel says she has one; make and power not published), shaft to a
  // feathering three-blade propeller in the aperture ahead of the rudder, offset to port
  engine: { type: 'inboard', model: 'diesel inboard (est.)', kW: 220, rpmMax: 2300, rpmIdle: 650, cyl: 6, fuel: 'diesel', gear: 2.5, wake: 0.25,
    prop: { D: 0.85, P: 0.7, Z: 3, BAR: 0.5, folding: true, rh: 1 }, pos: [-8.6, -0.75, -1.55], mount: [-5.0, 0, -0.6], mass: 1400, inMass: true, shaftAngle: 8 * DEG, exhaust: [-17.8, 0.5, 1.0] },
});

export const velsheda = jClass({
  id: 'velsheda', name: 'Velsheda (J Class)', yachtName: 'Velsheda', sailNo: 'K7', hullName: 'VELSHEDA',
  blurb: "Nicholson's 1933 J for W. L. Stephenson of Woolworths, named for his three daughters, never built for the Cup. Rebuilt by Dykstra in 1997 with a one-piece carbon mast and her first engine: a near-black navy hull with a gold cove line, two varnished deckhouses, laminate sails, and a reputation for winning.",
  specs: 'LOA 39.25 m · LWL 27.73 m · Beam 6.55 m · Draft 4.80 m · 180 t · Upwind sail 942 m² (main ~490, genoa ~452, est.) · Spinnaker 935 m² · Carbon mast ~50 m above the water (est.)',
  loa: 39.25, lwl: 27.73, beam: 6.55, draft: 4.8, disp: 180000, ballast: 104000, bowShare: 0.42,
  freeboard: 1.2, zBow: 2.45, zStern: 1.55, transomW: 0.22, tK: 0.26, hullZ: -0.7, wetted: 249, keelArea: 58, keelX: -4.4, crewN: 26,
  mastFromStem: 12.7, mastHeight: 50.0, boomZ: 3.8, boomMat: 'white', boomR: 0.4, boomWide: 1.15, mastR: 0.33, mastWall: 0.0095, mastMat: 'carbon', mastLook: 'white', mastSpec: 'one-piece carbon spar ~820 x 660 mm, painted (est.)',
  forestayF: 0.92, rodD: 52, runnerAft: 15.5,
  spreaders: [{ f: 0.2, len: 2.0, sweep: 0 }, { f: 0.4, len: 1.7, sweep: 0 }, { f: 0.6, len: 1.4, sweep: 0 }, { f: 0.79, len: 1.05, sweep: 0 }],
  main: 490, mainFoot: 21.5, genoa: 452, genoaFoot: 20.2, spin: 934.7, pole: 14.0, boomMass: 2000, sailMass: 1100, riggingMass: 2200, rigMass: 8800,
  tanks: 4000, interior: 16000, deckGear: 7000,
  // (her 3Di main and genoa as sailed since ~2016: charcoal grey; the spinnaker in red, white and blue bands with the
  // JK7 diamond; the hull navy with a gold cove line and a thin red boot top (photographs, Newport 2016, Falmouth 2012))
  cloth: 0x55585d, numColor: '#f1f0eb', spinColor: 0x2556b8, spinBands: [[0, 0.27, '#c8352b'], [0.27, 0.55, '#f2f1ec'], [0.55, 1, '#2556b8']],
  hullColor: 0x17223a, cove: 0xc9a24a, boot: 0x16181c, bootTop: 0xa8302b, wood: null, nameColor: '#c9a24a', bronze: false,
  houses: [house(0.33, 0.42, 0.55, 1.0, 4), house(0.17, 0.245, 0.55, 0.95, 3)],
  wellT: [0.1, 0.16], winchX: -1.5, trackX: [-0.4, 3.0],
  deckKit: { skylights: [0.5, 0.58, 0.74], grinders: [0.265, 0.45], winches: [[0.13, 0.75], [0.29, 0.8], [0.45, 0.85]], hatches: [0.8, 0.88] },
  // a diesel inboard (est.: fitted in the 1997 rebuild, her first; make and power not published)
  engine: { type: 'inboard', model: 'diesel inboard (est.)', kW: 260, rpmMax: 2300, rpmIdle: 650, cyl: 6, fuel: 'diesel', gear: 2.5, wake: 0.25,
    prop: { D: 0.9, P: 0.75, Z: 3, BAR: 0.5, folding: true, rh: 1 }, pos: [-9.6, -0.8, -1.6], mount: [-5.5, 0, -0.6], mass: 1600, inMass: true, shaftAngle: 8 * DEG, exhaust: [-19.2, 0.5, 1.0] },
});

export const endeavour = jClass({
  id: 'endeavour', name: 'Endeavour (J Class)', yachtName: 'Endeavour', sailNo: 'K4', hullName: 'ENDEAVOUR',
  blurb: "T. O. M. Sopwith's 1934 challenger, the J that nearly took the Cup from Rainbow — steel, quadrilateral genoa, four-speed winches. Saved from a mud berth by Elizabeth Meyer (1989) and refitted in New Zealand in 2011: royal 'Endeavour Blue' hull, one deckhouse on 100 feet of clean teak deck, a Southern Spars carbon mast and hydraulics under the deck.",
  specs: 'LOA 39.56 m · LWL 26.88 m · Beam 6.78 m · Draft 4.76 m · 178 t · Upwind sail 948 m² (main 490, genoa ~458) · Spinnaker 947 m² · Carbon mast ~50 m above the water (est.)',
  loa: 39.56, lwl: 26.88, beam: 6.78, draft: 4.76, disp: 178000, ballast: 103000, bowShare: 0.42,
  freeboard: 1.22, zBow: 2.5, zStern: 1.6, transomW: 0.22, tK: 0.27, hullZ: -0.7, wetted: 245, keelArea: 57, keelX: -4.4, crewN: 26,
  mastFromStem: 13.0, mastHeight: 50.0, boomZ: 3.8, boomMat: 'white', boomR: 0.4, boomWide: 1.15, mastR: 0.33, mastWall: 0.0095, mastMat: 'carbon', mastLook: 'white', mastSpec: 'Southern Spars carbon spar ~820 x 660 mm, painted (est.)',
  forestayF: 0.92, rodD: 52, runnerAft: 15.5,
  spreaders: [{ f: 0.2, len: 2.05, sweep: 0 }, { f: 0.4, len: 1.75, sweep: 0 }, { f: 0.6, len: 1.45, sweep: 0 }, { f: 0.79, len: 1.05, sweep: 0 }],
  main: 490, mainFoot: 21.5, genoa: 458, genoaFoot: 20.4, spin: 947, pole: 14.0, boomMass: 2000, sailMass: 1100, riggingMass: 1800, rigMass: 8400,
  tanks: 4000, interior: 15000, deckGear: 6000,
  // (charcoal 3Di sails as refitted in 2011; the royal 'Endeavour Blue' hull, a white boot top and cove line (est.))
  cloth: 0x3f4349, numColor: '#f1f0eb', spinColor: 0xf2f2ee,
  hullColor: 0x1c3a7c, cove: 0xe9e4d6, boot: 0x24262a, bootTop: 0xf0ede4, wood: null, nameColor: '#e9e4d6', bronze: false,
  houses: [house(0.3, 0.4, 0.55, 1.05, 4)],
  wellT: [0.12, 0.18], winchX: -1.8, trackX: [-0.6, 3.0],
  deckKit: { skylights: [0.5, 0.58, 0.75], grinders: [0.2, 0.43], winches: [[0.16, 0.75], [0.27, 0.8], [0.44, 0.85]], hatches: [0.8, 0.88] },
  // a diesel inboard (est.: its engine room was upgraded in the 2011 refit; make and power not published)
  engine: { type: 'inboard', model: 'diesel inboard (est.)', kW: 260, rpmMax: 2300, rpmIdle: 650, cyl: 6, fuel: 'diesel', gear: 2.5, wake: 0.25,
    prop: { D: 0.9, P: 0.75, Z: 3, BAR: 0.5, folding: true, rh: 1 }, pos: [-9.3, -0.8, -1.6], mount: [-5.5, 0, -0.6], mass: 1600, inMass: true, shaftAngle: 8 * DEG, exhaust: [-19.3, 0.5, 1.0] },
});
