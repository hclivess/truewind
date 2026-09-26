// Damage and gear failure from real loads (pure logic: no three.js; shared by the game and test/damage.mjs).
//
//  * STANDING RIG. A static rig analysis per class, every step. The moment the rig carries into the hull is the
//    sails' heeling moment, plus the rig's own weight and roll inertia, plus the water on a rig that is in the
//    sea (a knockdown): the wet rig's drag moment, spread over the ~0.12 s the cloth and the spars take to give.
//    Stayed rigs: the windward shrouds' vertical components carry it over the chainplate half-beam b
//    (Nordic Boat Standard / Skene), cap shroud share ~0.4-0.45 on a single-spreader rig, the lowers the rest,
//    plus the dock pretension; forestay = the headsail's lateral load over its sag, T = w L^2 / 8 delta;
//    backstay from its adjuster. An unstayed mast (the Laser) bends: moment at the partners and at the joint
//    of its two sections against the yield moment of the tube, M_y = sigma_y pi r^2 t.
//    A crash gybe adds the boom's slam: the sheet stops I_boom omega in ~0.08 s, the leech carries part of it
//    to the masthead.
//    Wire: 1x19 AISI 316, minimum breaking loads from the makers' tables (see WIRE). A part fails outright at its
//    breaking load; above ~75% it is overloaded and accumulates damage (strands yield and break), and every
//    load cycle adds Miner fatigue (S-N: N = 1e6 (0.3/r)^5 for r = load/MBL); accumulated damage lowers the
//    breaking load. Nothing is random: the same loads break the same rig.
//    Dismasted: the mast breaks at the spreaders (a cap shroud, forestay or backstay let go: the top panel
//    folds) or at the deck (lowers or a chainplate), a Laser at its partners or its joint, a beach cat's mast
//    falls whole. The broken rig hangs over the side on its wires and sails and drags (drag and its weight
//    through js/physics.js ext), the sails are gone; the crew can cut it away.
//  * SAILS. Peak membrane tension from the cloth solver (per triangle: k_warp (|F e_warp| - 1), k_fill (...))
//    or, with the strip model, pressure x radius of curvature; times a stress concentration of 3 at the corner
//    patches, against the cloth's strip strength (CLOTH_STRENGTH). Over it the sail tears, far over it blows
//    out. Flogging fatigue: Miner damage at dt / T(q), T = T0 (q0/q)^2.2 (a Dacron main flogging in 30 kn
//    apparent lasts ~20 minutes, in 50 kn ~2). A tear grows while the sail is loaded (reef or douse it to save
//    it) and costs the sail its area and shape (sailHealth -> the sail models' loads).
//  * HULL. Collision energy E = 1/2 mu v_rel^2 (1 - e^2), mu = m1 m2 / (m1 + m2), e = 0.3 (GRP): above the
//    hull's crack energy it costs damage points (drag), above its penetration energy it holes the hull.
//    Grounding: 1/2 m v^2 at the strike, the share that goes into the structure set by the seabed (rock 0.8,
//    gravel 0.4, sand 0.12, mud 0.03): keel-joint damage (a keel-bolt leak, then the keel lost: no ballast, no
//    lateral plane, she rolls over), rudder strikes bend the stock (limited, biased, weaker helm). Pounding on
//    the bottom in waves repeats the strikes.
//    Water ingress through each hole by Torricelli, Q = Cd A sqrt(2 g h) (Cd 0.6), h = depth of the hole
//    under the sea outside (heel, heave, pitch, waves) less the water inside; downflooding through the
//    companionway when the sill is under. Bilge pumps (manual rate falls with the pumper's fatigue), a dinghy's
//    self-bailer when moving. The water's weight and free surface go into the boat: heavier, lower, tender,
//    sluggish; past the hull's reserve buoyancy she sinks (unless foam or tanks keep her awash).

import { G, DEG } from './env.js';
import { RHO_W, clamp, lerp, sstep, STRIP_W, STRIP_F, sailHooks } from './physics.js';

// 1x19 AISI 316 stainless wire rope, minimum breaking load (N) by diameter (mm): Gunnebo / Blue Wave / Sta-Lok
// tables agree within ~10% (3 mm 7.4 kN, 4 mm 12.8, 5 mm 20.1, 6 mm 28.9). 7x19 flexible: ~70% of it.
export const WIRE = { 2.5: 5.0e3, 3: 7.4e3, 4: 12.8e3, 5: 20.1e3, 6: 28.9e3, 7: 39.3e3, 8: 51.4e3, 10: 80.3e3 };
const w1x19 = (d) => WIRE[d] ?? 800 * d * d;              // (between the table's sizes: ~800 d^2 N)
const w7x19 = (d) => 0.7 * w1x19(d);

// strip tensile strength of sailcloth along the warp (N/m), makers' data order of magnitude: 7-8 oz Dacron
// ~250 lbf/in, 4-5 oz ~170, polyester/aramid scrim laminates ~300, 0.75 oz ripstop nylon ~35 lbf/in
// (1 lbf/in = 175 N/m). Flogging life T0 (s) at q0 = 145 Pa (30 kn apparent): woven Dacron takes flogging
// best, laminates delaminate soonest.
export const CLOTH_STRENGTH = {
  dacronCruise: { S: 45e3, T0: 1200 }, dacronDinghy: { S: 30e3, T0: 900 },
  laminate: { S: 52e3, T0: 350 }, nylon: { S: 6e3, T0: 500 },
};
export const STRESS_CONC = 3;          // corner patches: the grid does not resolve them
export const SEAM_AGE = 0.65 * 0.75;   // a sewn seam holds ~65% of the cloth, a season's UV takes ~25% more
const FLOG_Q0 = 145, FLOG_M = 2.2;

// ------------------------------------------------------------------ per-class specifications
// Standing rigging from the class rules / builders where published, else estimated for the size (marked ~).
// b: chainplate half-beam (m); cap: cap-shroud share of the transverse load; pre: pretension (fraction of MBL);
// spreader: height of the spreaders (m above the waterline); mRig kg / zRig m: spars, wire and sails.
export const RIG = {
  blackwatch: { stayed: true, b: 0.95, cap: 0.45, pre: 0.12, spreader: 4.9, mRig: 48, zRig: 4.3, panel: 0.35,
    mast: { spec: 'Al extrusion ~110 x 75 mm, 2.8 mm wall (~)', r: 0.046, t: 0.0028, sy: 240e6 },
    parts: {
      cap: { name: 'Cap shroud', spec: '1x19 316 Ø5 mm', mbl: w1x19(5) },
      lower: { name: 'Lower shrouds', spec: '2 × 1x19 316 Ø5 mm', mbl: 2 * w1x19(5) },
      chain: { name: 'Chainplate', spec: 'SS strap, 2 × M8 A4', mbl: 38e3 },
      fore: { name: 'Forestay', spec: '1x19 316 Ø5 mm', mbl: w1x19(5) },
      back: { name: 'Backstay', spec: '1x19 316 Ø4 mm', mbl: w1x19(4) },
    } },
  // J/70: Southern Spars carbon mast, swept single spreaders; uppers and lowers 1x19 Ø4 mm (~), forestay Ø4 mm
  sportboat: { stayed: true, b: 0.86, cap: 0.5, pre: 0.14, spreader: 4.97, mRig: 34, zRig: 4.6, panel: 0.6,
    mast: { spec: 'carbon tube ~105 x 75 mm, 2.5 mm (~), allowable 500 MPa', r: 0.045, t: 0.0025, sy: 500e6 },
    parts: {
      cap: { name: 'Upper shroud', spec: '1x19 316 Ø4 mm', mbl: w1x19(4) },
      lower: { name: 'Lower shroud', spec: '1x19 316 Ø4 mm', mbl: w1x19(4) },
      chain: { name: 'Chainplate', spec: 'SS strap, 2 × M8 A4 (~)', mbl: 32e3 },
      fore: { name: 'Forestay', spec: '1x19 316 Ø4 mm', mbl: w1x19(4) },
      back: { name: 'Backstay', spec: 'Dynema SK78 Ø5 mm (~)', mbl: 18e3 },
    } },
  // ILCA / Laser: unstayed two-part aluminium mast. Bottom section Ø63.5 mm, top Ø~51 mm, walls ~2.0 / 1.6 mm (~),
  // alloy yield ~240 MPa (6000-series T6)
  dinghy: { stayed: false, mRig: 12, zRig: 2.8, sy: 240e6, tau: 0.2,   // (a bendy unstayed spar gives for longer)
    tubes: { bottom: { name: 'Bottom section', spec: 'Al tube Ø63.5 × 2.0 mm (~)', r: 0.03175, t: 0.0020 },
      top: { name: 'Top section', spec: 'Al tube Ø51 × 1.6 mm (~)', r: 0.0254, t: 0.0016 } },
    joint: 2.6 },        // joint height above the waterline (2.865 m section, heel 0.355 m below the deck)
  // Hobie 16: rotating mast on a ball, one shroud a side and a forestay on a bridle, no spreaders; 1x19 3/16" (~)
  cat: { stayed: true, b: 1.1, cap: 1.0, pre: 0.05, spreader: null, falls: true, mRig: 26, zRig: 3.9, panel: 0.6, hounds: 6.3,
    mast: { spec: 'Al wing section ~76 x 127 mm, 2.3 mm (~)', r: 0.049, t: 0.0023, sy: 240e6 },
    parts: {
      cap: { name: 'Shroud', spec: '1x19 316 Ø4.8 mm (3/16", ~)', mbl: w1x19(4.8) },
      chain: { name: 'Shroud adjuster / tang', spec: 'SS adjuster (~)', mbl: 22e3 },
      fore: { name: 'Forestay', spec: '1x19 316 Ø4.8 mm (3/16", ~)', mbl: w1x19(4.8) },
    } },
};
// Hull: crack (damage points) and penetration energies (J) for a blunt hit on the topsides, the hole a
// penetration makes, keel attachment energy to failure (J), rudder stock bend energy (J), ballast (kg, z m),
// flotation (fraction of volume in foam / sealed tanks), downflooding opening, pumps (L/min).
// (Drop-weight tests on GRP: penetration energy ~ t^1.5, ~1-2 kJ for an 8 mm hand-laid laminate, a few hundred J
// for a light dinghy skin; ISO 12215-9 designs keel attachments for grounding loads of the order of the
// displacement at the keel tip.)
export const HULL = {
  blackwatch: { crack: 400, pen: 2600, hole: 30e-4, keel: 30e3, longKeel: true, rudderBend: 500, ballast: 363, zBallast: -0.42,
    flot: 0, down: { z: 0.72, A: 0.04 }, pumps: [{ name: 'Manual (Whale Gusher 10)', lpm: 64, manual: true }] },
  sportboat: { crack: 300, pen: 1500, hole: 30e-4, keel: 16e3, rudderBend: 300, ballast: 285, zBallast: -1.35,
    flot: 0, down: { z: 0.6, A: 0.12 }, pumps: [{ name: 'Manual cockpit pump', lpm: 45, manual: true }] },
  dinghy: { crack: 120, pen: 700, hole: 20e-4, keel: 1.5e3, board: true, rudderBend: 120, ballast: 0,
    flot: 0.35, down: null, pumps: [], bailer: true },
  cat: { crack: 150, pen: 900, hole: 20e-4, keel: 1e9, rudderBend: 150, ballast: 0,
    flot: 0.5, down: null, pumps: [] },
};
// what a class without its own entry gets: sized from its displacement, righting moment and rig
export function rigSpec(C) {
  if (C.rigSpec) return C.rigSpec;
  if (RIG[C.id]) return RIG[C.id];
  const m = C.massHull + C.crewN * C.crewEach;
  const RM = m * G * Math.max(0.3, C.gm) * 0.5 + C.crewN * C.crewEach * G * C.crewMaxOut;   // ~RM at 30-40 deg
  const b = 0.42 * (C.multihull ? C.hullSpacing + C.beam * 0.2 : C.beam);
  const need = 2.8 * 0.45 * RM / Math.max(0.3, b);            // designed with ~2.8x on the cap at RM30
  const d = [2.5, 3, 4, 5, 6, 7, 8, 10].find((x) => w1x19(x) >= need) ?? 12;
  if (!C.hasBackstay && !C.multihull && C.sails.length === 1 && m < 250)
    return { stayed: false, mRig: 10, zRig: C.mastHeight * 0.45, sy: 240e6, joint: null,
      tubes: { bottom: { name: 'Mast', spec: 'Al tube (~)', r: 0.03 + 0.004 * C.mastHeight / 6, t: 0.002 } } };
  return { stayed: true, b, cap: C.multihull ? 1 : 0.45, pre: 0.12, spreader: C.mastHeight * 0.5, mRig: m * 0.04, zRig: C.mastHeight * 0.45,
    parts: {
      cap: { name: 'Cap shroud', spec: `1x19 316 Ø${d} mm (~)`, mbl: w1x19(d) },
      lower: C.multihull ? undefined : { name: 'Lower shrouds', spec: `2 × 1x19 316 Ø${d} mm (~)`, mbl: 2 * w1x19(d) },
      chain: { name: 'Chainplate', spec: 'SS strap (~)', mbl: 3 * w1x19(d) },
      fore: { name: 'Forestay', spec: `1x19 316 Ø${d} mm (~)`, mbl: w1x19(d) },
      back: C.hasBackstay ? { name: 'Backstay', spec: `1x19 316 Ø${Math.max(3, d - 1)} mm (~)`, mbl: w1x19(Math.max(3, d - 1)) } : undefined,
    } };
}
export function hullSpec(C) {
  if (C.hullSpec) return C.hullSpec;
  if (HULL[C.id]) return HULL[C.id];
  const m = C.massHull + C.crewN * C.crewEach, big = m > 400;
  return { crack: 60 + 0.28 * m, pen: 400 + 1.8 * m, hole: big ? 30e-4 : 20e-4, keel: big ? 14 * m : 1e9, longKeel: !!C.longKeel,
    board: !!(C.keel && C.keel.board), rudderBend: 80 + 0.3 * m, ballast: big ? 0.35 * C.massHull : 0, zBallast: C.keel ? C.keel.z - (C.keel.span || 0) * 0.4 : -0.5,
    flot: big ? 0 : 0.35, down: big ? { z: C.freeboard * 0.85, A: 0.05 } : null,
    pumps: big ? [{ name: 'Manual bilge pump', lpm: 45, manual: true }] : [], bailer: !big };
}

// ------------------------------------------------------------------ physics helpers (also for the tests)
// energy lost in a collinear impact of two bodies (restitution e)
export function collisionEnergy(m1, m2, vrel, e = 0.3) {
  const mu = !isFinite(m2) ? m1 : m1 * m2 / (m1 + m2);
  return 0.5 * mu * vrel * vrel * (1 - e * e);
}
// A contact from resolveCollisions (js/race.js): boat b pushed off `other` along (nx, nz) (from it toward b),
// having closed on it at vn (> 0, its own speed along the normal before the push). The other body: a boat (its
// mass and its own speed along the normal), a committee boat, a steel seamark buoy (~1.5 t), an inflatable race
// mark (~15 kg, soft: e = 0.1) or something fixed (pier, breakwater, beacon). Returns what b's hull takes.
export function contactImpact(b, other, vn, nx, nz) {
  let m2 = Infinity, vo = 0, e = 0.3, share = 1;
  if (other && other.cls) {
    m2 = other.mass;
    const f = Math.sin(other.psi), g = -Math.cos(other.psi), sx = Math.cos(other.psi), sz = Math.sin(other.psi);
    vo = (other.u * f + other.v * sx) * nx + (other.u * g + other.v * sz) * nz;   // toward b along the normal
    share = 1;                                            // (two hulls: split by impactPair)
  } else if (other && other.kind === 'committee') m2 = 3000;
  else if (other && other.seamark) { m2 = 1500; share = 0.9; }
  else if (other && (other.kind === 'mark' || other.kind === 'pin' || other.kind === 'gate')) { m2 = 15; e = 0.1; }
  else share = 0.85;                                      // piers, breakwaters: they give a little
  const vrel = Math.max(0, vn + vo);
  const E = collisionEnergy(b.mass, m2, vrel, e) * share;
  const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
  const cx = -(nx * fx + nz * fz), cy = -(nx * sx + nz * sz);
  return { E, vrel, at: cx > 0.8 ? 'bow' : cx < -0.8 ? 'stern' : 'side', side: Math.sign(cy) || 1, m2 };
}
// two boats: the energy lost is shared by where each was hit: a stem into topsides puts ~70% into the topsides
// (the struck panel flexes and cracks, the stem is the strongest part of a hull), otherwise half each
export function impactPair(a, b, v, nx, nz) {
  const Ia = contactImpact(a, b, v, nx, nz), Ib = contactImpact(b, a, 0, -nx, -nz);
  const E = Ia.E, fa = Ia.at === 'bow' && Ib.at !== 'bow' ? 0.3 : Ib.at === 'bow' && Ia.at !== 'bow' ? 0.7 : 0.5;
  a.dmg && a.dmg.impact(E * fa, Ia);
  b.dmg && b.dmg.impact(E * (1 - fa), Ib);
  return { E, Ea: E * fa, Eb: E * (1 - fa), vrel: Ia.vrel, atA: Ia.at, atB: Ib.at };
}
// Torricelli: inflow (m^3/s) through a hole of area A (m^2) with head h (m)
export function torricelli(A, h, Cd = 0.6) { return h > 0 ? Cd * A * Math.sqrt(2 * G * h) : 0; }
// yield moment of a thin-walled round tube (N m)
export function tubeYield(r, t, sy) { return sy * Math.PI * r * r * t; }
// what the seabed is: 'rock' | 'gravel' | 'sand' | 'mud'. Charted dangers (seamark rock / wreck / obstruction)
// are rock within ~40 m; within 60 m of an OSM beach it is sand; steep shores (the land rises fast) are rock near
// the shore; else the venue's bottom (by region) with patches
export const VENUE_BED = { progreso: 'sand', solent: 'mud', sfbay: 'mud', garda: 'gravel', sydney: 'sand', kiel: 'sand',
  newport: 'gravel', auckland: 'mud', marseille: 'rock', meredith: 'mud', open: 'sand' };
export const BED_STRUCT = { rock: 0.8, gravel: 0.4, sand: 0.12, mud: 0.03 };   // share of the strike energy into the structure
export function makeSeabed(world, venue, dangers = [], beaches = []) {
  const base = (venue && VENUE_BED[venue.id]) || 'sand';
  const dz = dangers.filter((m) => /^(rock|wreck|obstruction)$/.test(m.t));
  const bb = beaches;
  const f = (x, z) => {
    for (const m of dz) if (Math.abs(m.x - x) < 40 && Math.abs(m.z - z) < 40 && Math.hypot(m.x - x, m.z - z) < 40) return 'rock';
    for (const ring of f.beaches) {
      if (ring.bx && (x < ring.bx[0] - 60 || x > ring.bx[1] + 60 || z < ring.bx[2] - 60 || z > ring.bx[3] + 60)) continue;
      for (let i = 0; i + 1 < ring.length; i += 2) if (Math.abs(ring[i] - x) < 60 && Math.abs(ring[i + 1] - z) < 60) return 'sand';
    }
    if (world && !world.open) {
      const s = world.sdfAt(x, z);
      if (s < 80 && world.landHeight(x - 30, z) > 25) return 'rock';     // a steep shore close by
    }
    // patches: a deterministic field over the venue's bottom
    const h = Math.sin(x * 0.0123 + z * 0.0071) + Math.sin(x * 0.0057 - z * 0.0133);
    if (base === 'mud') return h > 1.5 ? 'sand' : 'mud';
    if (base === 'sand') return h > 1.6 ? 'gravel' : h < -1.7 ? 'mud' : 'sand';
    if (base === 'gravel') return h > 1.2 ? 'rock' : h < -1.2 ? 'sand' : 'gravel';
    return h < -1.2 ? 'gravel' : 'rock';
  };
  f.beaches = bb.map((r) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i + 1 < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } const a = Array.from(r); a.bx = [x0, x1, z0, z1]; return a; });
  return f;
}

// deterministic hash to [0, 1) from integers (no Math.random anywhere in shared state)
export function hash01(a, b = 0, c = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// the boat's mass properties from what is aboard: hull (less a lost keel), crew still aboard, water in her
export function recomputeMass(b) {
  const C = b.cls, base = b._base || (b._base = { m11k: b.m11 / b.mass, m22k: b.m22 / b.mass, m33k: b.m33 / b.mass, Iyyk: b.Iyy / b.mass, Ixx: b.Ixx, crew: b.crewMass });
  const mh = b.mHull ?? C.massHull;
  b.mass = mh + b.crewMass + (b.water || 0);
  b.m11 = b.mass * base.m11k; b.m22 = b.mass * base.m22k; b.m33 = b.mass * base.m33k; b.Iyy = b.mass * base.Iyyk;
  b.Ixx = base.Ixx * (b.mass / (C.massHull + base.crew));
}

// peak membrane tension (N/m) of a cloth sail: the larger of warp and fill tension per triangle, taken at the
// 95th percentile of the triangles (the grid converging on the head and the corner nodes pinned by the rig give a
// few triangles strains that mean nothing; the corner patches' real concentration is STRESS_CONC), and where
const _pk = { v: new Float64Array(0), i: new Int32Array(0) };
export function clothPeak(cl, out = {}) {
  const X = cl.x, tri = cl.tri, cf = cl.cf;
  if (_pk.v.length < cl.T) { _pk.v = new Float64Array(cl.T); _pk.i = new Int32Array(cl.T); }
  let Am = 0, n = 0;
  for (let t = 0; t < cl.T; t++) Am += cl.tA[t];
  Am /= Math.max(1, cl.T);
  for (let t = 0; t < cl.T; t++) {
    const A = cl.tA[t]; if (A < 0.25 * Am) continue;
    const i0 = 3 * tri[3 * t], i1 = 3 * tri[3 * t + 1], i2 = 3 * tri[3 * t + 2];
    const c0 = cf[6 * t], c1 = cf[6 * t + 1], c2 = cf[6 * t + 2], d0 = cf[6 * t + 3], d1 = cf[6 * t + 4], d2 = cf[6 * t + 5];
    const ax = c0 * X[i0] + c1 * X[i1] + c2 * X[i2], ay = c0 * X[i0 + 1] + c1 * X[i1 + 1] + c2 * X[i2 + 1], az = c0 * X[i0 + 2] + c1 * X[i1 + 2] + c2 * X[i2 + 2];
    const bx = d0 * X[i0] + d1 * X[i1] + d2 * X[i2], by = d0 * X[i0 + 1] + d1 * X[i1 + 1] + d2 * X[i2 + 1], bz = d0 * X[i0 + 2] + d1 * X[i1 + 2] + d2 * X[i2 + 2];
    const sw = Math.sqrt(ax * ax + ay * ay + az * az) - 1, sf = Math.sqrt(bx * bx + by * by + bz * bz) - 1;
    _pk.v[n] = Math.max(cl.kw[t] * sw, cl.kf[t] * sf) / A; _pk.i[n] = t; n++;
  }
  if (!n) { out.T = 0; return out; }
  // 95th percentile by partial selection (n ~ 100: a few passes)
  const k = Math.min(n - 1, Math.floor(n * 0.95));
  const idx = Array.from({ length: n }, (_, j) => j).sort((a, b) => _pk.v[a] - _pk.v[b]);
  const j = idx[k], bt = _pk.i[j];
  out.T = Math.max(0, _pk.v[j]);
  const q = tri[3 * bt] - cl.off; out.u = (q % cl.nu) / Math.max(1, cl.nu - 1); out.v = Math.floor(q / cl.nu) / Math.max(1, cl.nv - 1);
  return out;
}

// the structural rig model's load names -> the parts here; a load is a number (N), [port, starboard], or { T, mbl }
const RL_MAP = { capShroud: 'cap', capShrouds: 'cap', uppers: 'cap', lowers: 'lower', lowerShrouds: 'lower', forestay: 'fore', backstay: 'back', chainplate: 'chain', chainplates: 'chain', mastComp: 'mastComp' };
const RL_NAME = { cap: 'Cap shroud', lower: 'Lower shrouds', fore: 'Forestay', back: 'Backstay', chain: 'Chainplate', mastComp: 'Mast (compression)' };
function rlValue(v) {
  const one = (x) => (typeof x === 'number' ? x : x && typeof x === 'object' ? x.T ?? x.load ?? x.tension ?? 0 : 0);
  if (typeof v === 'number') return isFinite(v) ? { T: v } : null;
  if (Array.isArray(v)) { const T = Math.max(0, ...v.map(one)); const m = v.map((x) => x && x.mbl).filter(Boolean); return { T, mbl: m.length ? Math.min(...m) : undefined }; }
  if (v && typeof v === 'object') return { T: one(v), mbl: v.mbl ?? v.breaking ?? v.strength };
  return null;
}
// the sail model's boom-bending hook: boomOverload(boat, ratio), ratio = bending moment / capacity
export function boomOverload(b, ratio) { if (b && b.dmg) b.dmg.boomLoad(ratio); }
sailHooks.boomOverload = boomOverload;

// ------------------------------------------------------------------ the damage state of one boat
export class Damage {
  constructor(boat, opts = {}) {
    this.b = boat; this.C = boat.cls;
    this.R = rigSpec(this.C); this.H = hullSpec(this.C);
    this.seed = opts.seed ?? 1;
    this.mode = opts.mode ?? 'realistic';
    this.remote = !!opts.remote;
    this.events = [];
    this.reset();
  }
  reset() {
    const b = this.b, C = this.C, R = this.R;
    this.parts = {};
    if (R.stayed) {
      for (const k in R.parts) if (R.parts[k]) this.parts[k] = { ...R.parts[k], load: 0, r: 0, D: 0, peak: 0 };
      if (R.mast) this.parts.mast = { name: 'Mast', spec: R.mast.spec, mbl: tubeYield(R.mast.r, R.mast.t, R.mast.sy), load: 0, r: 0, D: 0, peak: 0 };
    }
    else for (const k in R.tubes) this.parts[k] = { ...R.tubes[k], mbl: tubeYield(R.tubes[k].r, R.tubes[k].t, R.sy), load: 0, r: 0, D: 0, peak: 0 };
    this.rig = { down: false, breakZ: null, side: 1, why: '', wreck: null, cut: false };
    this.sails = {};
    for (const s of C.sails) this.sails[s.key] = { D: 0, tear: 0, u: 0.8, v: 0.55, peak: 0, ratio: 0, blown: false, mat: null };
    this.hull = { pts: 0, holes: [], keelD: 0, keelLost: false, rudder: 0, rudderLost: false, grounded: false, sunk: false };
    this.water = 0; this.inflow = 0; this.pumpOut = 0;
    this.Mw = 0; this.Mb = 0; this.Mbj = 0; this.Mslam = 0; this.maxR = 0; this.worst = null; this.age = 0; this.Ma = 0; this._pdf = 0; this._p0 = undefined;
    this.pumping = true;
    this._aground = 0; this._u = 0; this._hv = 0; this._acc = 0; this._pk = {};
    b.sailHealth = null; b.rigDown = false; b.mastTop = undefined; b.keelEff = undefined; b.rudderEff = undefined; b.rudderLim = undefined; b.rudderBias = 0;
    b.mHull = undefined; b.zG = undefined; b.water = 0; b.sunk = false;
    if (b._base) recomputeMass(b);
    // reserve buoyancy: the hull's volume to the sheer, less what she displaces now
    const Vfull = b.hydro.immerse(-(C.freeboard + C.canoeDraft + 2), 0, 0, () => 0, () => 0, {}).V;
    this.Vfull = Vfull;
    // the hull's volume below each height (boat frame, upright): where the water inside stands for a volume of it
    this.inZ = []; this.inV = [];
    const z0 = -C.canoeDraft * (C._depthScale || 1) - 0.1, z1 = C.freeboard + 0.1;
    for (let k = 0; k <= 40; k++) { const z = z0 + (z1 - z0) * k / 40; this.inZ.push(z); this.inV.push(b.hydro.immerse(-z, 0, 0, () => 0, () => 0, {}).V); }
  }
  event(type, msg, bad = true) { this.events.push({ type, msg, bad }); }
  get on() { return this.mode !== 'off' && !this.remote; }

  // ---- inputs from the world (collisions, from the game or a test)
  // E: energy lost in the impact (J); at: 'bow' | 'side' | 'stern'; side: +1 starboard / -1 port; hard: the other
  // body is solid (pier, steel buoy, another hull), soft: an inflatable mark
  impact(E, info = {}) {
    if (!this.on || this.hull.sunk) return;
    const H = this.H, h = this.hull, at = info.at || 'side';
    const Ee = E * (at === 'bow' ? 0.6 : 1);               // the stem is the strongest part of her
    if (Ee > H.crack) {
      h.pts = clamp(h.pts + (Ee - H.crack) / (6 * H.pen), 0, 1);
      if (Ee > H.pen) {
        const A = clamp(H.hole * Math.pow(Ee / H.pen, 2 / 3), 0, 0.06);
        const x = at === 'bow' ? this.C.bowX - 0.4 : at === 'stern' ? this.C.sternX + 0.4 : 0;
        const y = (info.side || 1) * (this.C.multihull ? this.C.hullSpacing / 2 + this.C.hullBeam * 0.5 : this.C.beam * 0.45);
        this.addHole(x, y, 0.06, A, 'collision');
        this.event('holed', `Holed by the collision — ${Math.round(A * 1e4)} cm² at the ${at === 'side' ? (info.side > 0 ? 'starboard' : 'port') + ' side' : at}`);
      } else this.event('crack', `Collision damage — hull ${Math.round(h.pts * 100)}%`, false);
    }
    if (at === 'stern' && E > H.rudderBend * 0.5) this.rudderHit(E * 0.5, info.side || 1);
  }
  addHole(x, y, z, A, why) { this.hull.holes.push({ x, y, z, A, why }); }
  rudderHit(E, side) {
    const h = this.hull, H = this.H;
    if (h.rudderLost || E < H.rudderBend * 0.3) return;
    h.rudder = clamp(h.rudder + E / H.rudderBend * 0.6, 0, 1.2);
    h.rudderSide = side;
    if (h.rudder >= 1) { h.rudderLost = true; this.event('rudder', 'Rudder torn off — no steering'); }
    else this.event('rudder', `Rudder stock bent — ${Math.round((1 - this.rudderLimFor(h.rudder)) * 100)}% of the helm lost`);
  }
  rudderLimFor(bend) { return clamp(1 - 0.7 * bend, 0.15, 1); }
  // the keel meets the bottom: E = kinetic energy at the strike (J), bed type
  grounding(E, bed, rudderToo) {
    if (!this.on) return;
    const H = this.H, h = this.hull, s = BED_STRUCT[bed] ?? 0.12, Es = E * s;
    if (bed !== 'mud') this.event('ground', `Aground on ${bed} — ${E < 300 ? 'a gentle touch' : E < 3000 ? 'a hard strike' : 'a violent strike'}`, E > 1500 && bed !== 'sand');
    if (H.board) { h.keelD = clamp(h.keelD + Es / H.keel, 0, 1); if (h.keelD >= 1 && !h.keelLost) { h.keelLost = true; this.event('keel', 'Daggerboard broken'); } }
    else if (H.longKeel) {
      h.keelD = clamp(h.keelD + Es / H.keel, 0, 1);
      if (h.keelD > 0.5 && !h._breach) { h._breach = true; this.addHole(this.C.keel.x, 0, -this.C.canoeDraft, 8e-4 + 25e-4 * (h.keelD - 0.5), 'keel'); this.event('holed', 'The garboard is split — water coming in at the keel'); }
      h.pts = clamp(h.pts + Es / (8 * H.keel), 0, 1);
    } else if (H.keel < 1e8) {
      const D0 = h.keelD;
      h.keelD = clamp(h.keelD + Es / H.keel, 0, 1.2);
      if (D0 < 0.25 && h.keelD >= 0.25) { h.keelHole = this.hull.holes.length; this.addHole(this.C.keel.x, 0, -this.C.canoeDraft, 3e-4, 'keel'); this.event('holed', 'Keel bolts working — a leak at the keel'); }
      if (h.keelHole !== undefined && h.holes[h.keelHole]) h.holes[h.keelHole].A = 3e-4 + 30e-4 * clamp((h.keelD - 0.25) / 0.75, 0, 1);
      if (h.keelD >= 1 && !h.keelLost) this.loseKeel();
    }
    if (rudderToo) this.rudderHit(E * 0.3 * (s + 0.1), 1);
  }
  loseKeel() {
    const b = this.b, h = this.hull, H = this.H;
    h.keelLost = true;
    b.keelEff = 0.05;
    b.mHull = this.C.massHull - H.ballast;
    // what is left of the hull weighs where the hull does: ~0.1 m above the waterline without its ballast
    b.zG = (this.C.massHull * this.C.zG - H.ballast * H.zBallast) / Math.max(1, b.mHull);
    recomputeMass(b);
    if (h.keelHole !== undefined && h.holes[h.keelHole]) h.holes[h.keelHole].A = 60e-4;
    this.event('keel', 'KEEL LOST — she will roll over');
  }

  // ---- before the physics step: loads that the physics must carry (wreck over the side, water aboard)
  pre(dt, ext, env, t) {
    const b = this.b; this._u = b.u; this._hv = b.heaveV; this._aground = b.aground; this._pp = b.p;
    if (!this.on) return;
    const C = this.C;
    // the broken rig in the water on its wires: drag at the chainplate, its submerged weight hauling that side down
    const w = this.rig.wreck;
    if (w && !this.rig.cut) {
      const x = C.mastX, y = this.rig.side * (C.multihull ? C.hullSpacing / 2 : C.beam / 2);
      const vx = b.u, vy = b.v + b.r * x, V = Math.hypot(vx, vy) + 1e-6;
      const c = 0.5 * RHO_W * w.CdA;
      const Fx = -c * vx * V, Fy = -c * vy * V;
      ext.X += Fx; ext.Y += Fy; ext.N += x * Fy - y * Fx;
      ext.K += w.wSub * G * y * Math.cos(b.phi) + (-c * b.p * y * Math.abs(b.p * y)) * y * 0.2;
    }
    // water aboard: its weight sits in the bilge and runs to the low side (free surface: i = l b^3 / 12)
    if (this.water > 1) {
      const zw = -C.canoeDraft * 0.5, l = C.lwl * 0.6, bw = Math.min(C.beam * 0.6, 0.3 + this.water / RHO_W / (l * 0.3));
      const ifs = l * bw * bw * bw / 12;
      ext.K += this.water * G * zw * Math.sin(b.phi) + RHO_W * G * ifs * Math.sin(b.phi) * (C.multihull ? 0 : 1);
      if (C.multihull && this.waterY) ext.K += this.water * G * this.waterY * Math.cos(b.phi);
    }
    // a damaged hull drags: stove-in sections, loose gear
    if (this.hull.pts > 0) ext.X -= 0.3 * this.hull.pts * (b.diag.Rf || 0) * Math.sign(b.u);
  }

  // ---- after the physics step
  post(dt, ctx = {}) {
    const b = this.b, C = this.C, d = b.diag;
    if (!this.on) { b.slamJ = 0; return; }
    if (this.hull.sunk) { this.sunkStep(dt, ctx); return; }
    this.rigLoads(dt);
    this.sailLoads(dt);
    this.groundingCheck(dt, ctx);
    this.flood(dt, ctx);
    b.slamJ = 0;
    // what the damage does to her foils: a bent stock limits and biases the helm and weakens the blade
    const h = this.hull;
    if (h.rudder > 0) {
      b.rudderLim = h.rudderLost ? 0.2 : this.rudderLimFor(h.rudder);
      b.rudderBias = (h.rudderSide || 1) * 6 * DEG * Math.min(1, h.rudder);
      b.rudderEff = h.rudderLost ? 0.06 : 1 - 0.45 * Math.min(1, h.rudder);
    }
    if (h.keelLost && this.H.board) b.keelEff = 0.3;              // a broken daggerboard: the stump still works a little
  }

  // ---------------------------------------------------------------- standing rig
  // A rig slamming into the sea (a knockdown past the horizontal): the water's drag on the wet part of the mast and,
  // through the luff, half of the wet sail's, at the speed the roll drives them in (p z, before the water stops it),
  // and never more than stopping the boat's roll in the ~0.12 s the cloth and the spar take to give (I p / 0.12: the
  // drag of a plate at the entry speed is only the first instant).
  // Returns the bending moment about height zs of what lies above it.
  waterBending(dt, zs) {
    const b = this.b, C = this.C, R = this.R;
    const p = this._pp ?? b.p, cphi = Math.cos(b.phi);
    const eta = b._etaAt ? b._etaAt(C.mastX) : 0;
    const r0 = R.mast ? R.mast.r : R.tubes ? R.tubes.bottom.r : 0.05;
    const base = C.freeboard, top = C.mastHeight, n = 12, dz = (top - base) / n;
    let M = 0;
    for (let k = 0; k < n; k++) {
      const z = base + (k + 0.5) * dz; if (z <= zs) continue;
      if (z * cphi + b.heave - eta >= 0) continue;
      const v = p * z, f = 0.5 * RHO_W * 1.2 * 2 * r0 * dz * v * v;
      M += f * (z - zs);
    }
    for (const s of C.sails) {
      const st = b.diag.strips[s.key], aF = st ? st.areaF ?? 0 : 0; if (aF < 0.05) continue;
      const pz = s.key === 'main' ? C.boomZ : s.tackZ;
      for (let i = 0; i < 3; i++) {
        const z = pz + STRIP_F[i] * s.luff; if (z <= zs) continue;
        if (z * cphi + b.heave - eta >= 0) continue;
        const v = p * z, A = s.area * STRIP_W[i] * aF;
        M += 0.5 * 0.5 * RHO_W * 1.2 * A * v * v * (z - zs);
      }
    }
    return Math.min(M, b.Ixx * Math.abs(p) / (R.tau ?? 0.12) * (M > 0 ? 1 : 0));
  }
  rigLoads(dt) {
    const b = this.b, C = this.C, R = this.R, d = b.diag, P = this.parts;
    if (this.rig.down) return;
    // roll inertia of the rig and the water on it (low-passed over the ~0.12 s the cloth and spars take to give)
    const pdot = (b.p - (this._p0 ?? b.p)) / dt; this._p0 = b.p;
    const Mw = -(b._cRollWet || 0) * b.p;
    const kf = clamp(dt / 0.12, 0, 1);
    this.Mw += (Mw - this.Mw) * kf;
    // the mast's own bending under a slam into the sea: about its upper support (a stayed rig: the spreaders or the
    // hounds, the panel sharing it with the stays), or its partners and its joint (unstayed)
    const zSup = R.stayed ? (R.spreader ?? R.hounds ?? C.mastHeight * 0.75) : C.freeboard;
    this.Mb = this.waterBending(dt, zSup) * (R.panel ?? 1);
    if (R.tubes && R.joint) this.Mbj = this.waterBending(dt, R.joint);
    const Iri = R.mRig * R.zRig * R.zRig * 1.3;
    this._pdf = (this._pdf ?? 0) + (pdot - (this._pdf ?? 0)) * kf;
    // crash gybe: the sheet stops the boom (angular momentum J) in ~0.08 s; part of the leech's jerk reaches the head
    const M0 = b.sailBy.main;
    if (b.slamJ > 0 && M0) {
      const P0 = b.slamJ / 0.08 / (0.85 * M0.foot), sa = Math.abs(Math.sin(b.booms.main ? b.booms.main.a : 1));
      this.Mslam = Math.max(this.Mslam, 0.35 * P0 * sa * (C.boomZ + M0.luff * 0.8) * 0.5);
      this.lastSlam = P0;
    }
    this.Mslam *= Math.exp(-dt / 0.15);
    // the sails' moment reaches the chainplates through the cloth's and the wire's stretch: ~0.1 s (and a sail
    // being set is not yet loading anything: the first seconds after a reset are ignored)
    this.age = (this.age || 0) + dt;
    this.Ma = (this.Ma ?? 0) + ((d.sailK || 0) - (this.Ma ?? 0)) * clamp(dt / 0.1, 0, 1) * (this.age > 1 ? 1 : 0);
    const Maero = this.Ma, sgn = Math.sign(Maero) || 1;
    const M = Maero + this.Mw + R.mRig * G * R.zRig * Math.sin(b.phi) - Iri * this._pdf + sgn * this.Mslam;
    this.Mrig = M;
    this._wr = 0; this._worst = null;
    const load = (k, T, mbl) => this.loadPart(k, T, dt, mbl);
    // the structural rig model (js/rig-structure.js), when it runs, supplies the wire tensions (and the mast's
    // compression) from the real luff loads: those replace the estimate below. The sea on a wet rig and a boom's
    // slam, which it does not see, are added to the shrouds.
    const RL = R.stayed ? b.rigLoads : null;
    if (RL && typeof RL === 'object') {
      const mbls = RL.mbl || RL.breaking || RL.strength || {};
      const Tw = Math.abs(this.Mw + sgn * this.Mslam) / R.b / Math.cos(10 * DEG);
      for (const src in RL_MAP) {
        if (RL[src] === undefined || RL[src] === null) continue;
        const v = rlValue(RL[src]); if (!v) continue;
        const k = RL_MAP[src];
        if (!P[k]) P[k] = { name: RL_NAME[k] || src, spec: '(rig model)', mbl: v.mbl ?? mbls[src] ?? 1e9, load: 0, r: 0, D: 0, peak: 0 };
        const add = k === 'cap' ? R.cap * Tw : k === 'lower' ? (1 - R.cap) * Tw : k === 'chain' ? Tw : 0;
        load(k, v.T + add, v.mbl ?? mbls[src]);
      }
      if (P.mast) load('mast', this.Mb);
    } else if (R.stayed) {
      const Tv = Math.abs(M) / R.b / Math.cos(10 * DEG);           // vertical load on that side's shrouds
      const pre = (P.cap ? P.cap.mbl : 1e4) * R.pre;
      load('cap', R.cap * Tv + pre);
      if (P.lower) load('lower', (1 - R.cap) * Tv + pre * 0.8);
      if (P.chain) load('chain', Tv + pre * (P.lower ? 1.8 : 1));
      // forestay: the headsail's side load on a sagging stay, T = F L / (8 sag / L) / L; or the backstay's reaction
      const J = b.sailBy.jib || b.sailBy.stay;
      const Fh = J ? Math.max(d.strips.jib ? d.strips.jib.F || 0 : 0, d.strips.stay ? (d.strips.stay.F || 0) * 0.6 : 0) : 0;
      const sagL = clamp((d.rig.sagMM || 0) / 1000 / (J ? J.luff : 5), 0.02, 0.05);
      const Tbs = C.hasBackstay ? d.rig.backstayLoad || 0 : 0;
      if (P.fore) load('fore', Math.max(0.5 * Fh / (8 * sagL), Tbs * 1.15, (P.fore.mbl * R.pre)) + 0.25 * Math.abs(this.Mslam) / Math.max(1, C.mastHeight));
      if (P.back) load('back', Tbs + 0.3 * Math.abs(this.Mslam) / Math.max(1, C.mastHeight));
      if (P.mast) load('mast', this.Mb + 0.15 * Math.abs(Maero));
    } else {
      // an unstayed mast bends: at the partners the whole rig moment; at the joint the part above it
      // (sail: the area above the joint at its lever; water: a wet mast's drag grows with height, ~45% above)
      if (this._kj === undefined) {
        const s = b.sailBy.main, zj = R.joint;
        let A = 0, Aj = 0, Mj = 0, Mz = 0;
        for (let i = 0; i < 40; i++) { const f = (i + 0.5) / 40, z = C.boomZ + f * s.luff, c = s.foot * (1 - f) + s.head * f; A += c; Mz += c * z; if (zj && z > zj) { Aj += c; Mj += c * (z - zj); } }
        this._kj = zj ? Mj / Mz : 0;
      }
      const Mp = Math.abs(Maero) + this.Mb + Math.abs(this.Mslam) + R.mRig * G * R.zRig * Math.abs(Math.sin(b.phi));
      const Mj = Math.abs(Maero) * this._kj + (this.Mbj || 0) + Math.abs(this.Mslam) * 0.6 + R.mRig * 0.3 * G * 1.4 * Math.abs(Math.sin(b.phi));
      load('bottom', Mp);
      if (P.top) load('top', Mj);
    }
    this.maxR = this._wr; this.worst = this._worst;
  }
  // one part's load T (N; a mast: N m) against its breaking load (or yield moment); mbl: the rig model's, if it has one
  loadPart(k, T, dt, mbl0) {
    const p = this.parts[k]; if (!p) return;
    if (mbl0) p.mbl = mbl0;
    p.load = T;
    const mbl = p.mbl * (1 - 0.35 * clamp(p.D, 0, 1));
    const r = T / mbl; p.r = r; p.peak = Math.max(p.peak * Math.exp(-dt / 20), r);
    // overload: strands yield and break above ~75% of the breaking load; Miner fatigue on every cycle
    if (r > 0.75) p.D += dt * ((r - 0.75) / 0.25) ** 2 / 2;
    if (r > 0.15) p.D += dt * 0.3 * Math.pow(r / 0.3, 5) / 1e6;
    if (r > this._wr) { this._wr = r; this._worst = k; }
    if ((r >= 1 || p.D >= 1) && this.age > 3) this.fail(k, r >= 1 ? 'overload' : 'fatigue');
  }
  // the boom's bending (the sail model's boom: ratio = its bending moment / its capacity), through boomOverload()
  boomLoad(ratio, dt = 1 / 120) {
    if (!this.on || this.rig.down || this.boomBroken || !isFinite(ratio)) return;
    const P = this.parts;
    if (!P.boom) P.boom = { name: 'Boom', spec: '(bending, sail model)', mbl: 1, load: 0, r: 0, D: 0, peak: 0 };
    const p = P.boom;
    p.load = ratio; p.r = ratio; p.peak = Math.max(p.peak * Math.exp(-dt / 20), ratio);
    if (ratio > 0.75) p.D += dt * ((ratio - 0.75) / 0.25) ** 2 / 2;
    if ((ratio >= 1 || p.D >= 1) && this.age > 3) this.breakBoom();
  }
  breakBoom() {
    const b = this.b;
    this.boomBroken = true; b.boomBroken = true;
    // a broken boom: the sheet no longer holds the leech — the main twists off, flogs and loses its shape
    const h = b.sailHealth || (b.sailHealth = {});
    h.main = Math.min(h.main ?? 1, 0.45);
    this.sails.main && (this.sails.main.D = Math.max(this.sails.main.D, 0.5));
    this.event('boom', 'BOOM BROKEN — the main is out of control: reef or drop it');
  }
  fail(k, why) {
    const C = this.C, R = this.R, p = this.parts[k];
    if (this.rig.down) return;
    let z;
    if (!R.stayed) z = k === 'top' ? R.joint : this.b.vis?.mastBase ?? C.freeboard + 0.05;
    else if (R.falls || k === 'chain') z = k === 'chain' && !R.falls ? C.freeboard + 0.25 : C.freeboard;
    else if (k === 'lower') z = C.freeboard + 0.25 + (R.spreader - C.freeboard) * 0.15;
    else if (k === 'mast') z = R.falls ? C.freeboard : (R.spreader ?? R.hounds ?? C.mastHeight * 0.6);
    else z = R.spreader ?? C.mastHeight * 0.5;
    this.dismast(z, `${p ? p.name : k} ${why === 'fatigue' ? 'failed (fatigue)' : 'parted'}`, Math.sign(this.Mrig || this.b.phi || 1));
  }
  // the mast breaks at height z (above the waterline); side: which way it falls (+1 starboard)
  dismast(z, why, side = 1) {
    const b = this.b, C = this.C, R = this.R;
    if (this.rig.down) return;
    // the rig falls to the side the load pushed it: away from the shroud that let go, i.e. to leeward
    this.rig = { down: true, breakZ: z, side: side || 1, why, cut: false,
      wreck: { L: C.mastHeight - z, CdA: 1.1 * (0.12 * (C.mastHeight - z) + 0.35 * C.sails.reduce((a, s) => a + s.area, 0) * 0.35), wSub: R.mRig * 0.55 * (C.mastHeight - z) / Math.max(1, C.mastHeight - C.freeboard) } };
    b.rigDown = true; b.mastTop = z;
    for (const k in b.diag.strips) for (const st of b.diag.strips[k]) { st.state = 0; st.cl = 0; st.flog = 0; }   // (no sails to read)
    b.sailHealth = Object.fromEntries(C.sails.map((s) => [s.key, 0]));
    b.ctrl.gen = false; b.genDeploy = 0;
    for (const k in this.sails) this.sails[k].blown = true;
    this.event('dismast', `DISMASTED — ${why}; the rig is over the ${side > 0 ? 'starboard' : 'port'} side`);
  }
  cutAway() { if (this.rig.down && !this.rig.cut) { this.rig.cut = true; this.event('cut', 'Rig cut away — the wreck is gone', false); } }

  // ---------------------------------------------------------------- sails
  sailLoads(dt) {
    const b = this.b, C = this.C, d = b.diag;
    if (this.rig.down) return;
    this._acc += dt;
    const every = 0.1;                                     // (the cloth scan every 0.1 s is plenty)
    const scan = this._acc >= every; if (scan) this._acc = 0;
    let health = b.sailHealth;
    for (const s of C.sails) {
      const S = this.sails[s.key], st = d.strips[s.key];
      if (!S.mat) S.mat = this.materialOf(s);
      const areaF = st.areaF ?? 0;
      if (S.blown || areaF < 0.05) continue;
      const q = 0.5 * (d.rhoA || 1.225) * (d.aws || 0) ** 2;
      // flogging: Miner damage at dt / T(q)
      let flog = 0; for (let i = 0; i < 3; i++) flog += (st[i].flog || 0) * STRIP_W[i];
      if (flog > 0.05 && q > 5) {
        const T = S.mat.T0 * Math.pow(FLOG_Q0 / q, FLOG_M);
        S.D += dt * flog * areaF / T;
        if (S.tear > 0) S.tear += dt * flog * areaF / (T * 0.6);
        if (S.D >= 1 && S.tear === 0) { S.tear = 0.06; S.u = 0.85; S.v = 0.62; this.event('tear', `${this.sailName(s)} torn at the leech — flogging`); }
      }
      if (scan && this.age > 3) {
        const cl = b.sailSys && b.sailSys.active(b) && b.sailSys.cloth(s.key);
        if (cl && (cl.sincePose || 0) < 2) continue;         // (a cloth just set, or re-made at another detail level, is settling)
        let T;
        if (cl && cl.cloth && (b.sailSys.sails.find((x) => x.key === s.key) || {}).part?.on) { clothPeak(cl.cloth, this._pk); T = this._pk.T; }
        else {
          // strip model: average pressure times the radius of curvature of the camber, x2 at the leech
          const F = st.F || 0, A = s.area * areaF, chord = (s.foot + s.head) / 2, dd = (d.shape[s.key] && d.shape[s.key][1].d) || 0.12;
          T = F / Math.max(0.1, A) * chord / (8 * dd) * 2;
          this._pk.u = 0.2; this._pk.v = 0.5;
        }
        S.peak = T;
        S.ratio = T * STRESS_CONC / (S.mat.S * SEAM_AGE * (1 - 0.4 * clamp(S.D, 0, 1)));
        if (S.ratio > 1) {
          if (S.tear === 0) { S.u = this._pk.u ?? 0.5; S.v = this._pk.v ?? 0.5; S.tear = 0.05; this.event('tear', `${this.sailName(s)} torn — overloaded (${Math.round(T / 1000 * 10) / 10} kN/m at the ${S.v > 0.8 ? 'head' : S.u < 0.3 ? 'leech' : 'clew'})`); }
          S.tear += every * 0.6 * (S.ratio - 1) * (S.ratio > 1.6 ? 6 : 1);
        } else if (S.tear > 0) {
          // a tear under load runs: slowly at working loads, fast near the strength (e-folding ~2 min at 1/3)
          S.tear += every * S.tear * 0.008 * (S.ratio / 0.33) ** 2 * areaF;
        }
      }
      if (S.tear > 0) {
        S.tear = Math.min(1, S.tear);
        if (!health) health = b.sailHealth = {};
        if (S.tear >= 0.75 && !S.blown) { S.blown = true; this.event('blown', `${this.sailName(s)} BLOWN OUT`); }
        health[s.key] = S.blown ? 0 : clamp(1 - S.tear, 0, 1);
      }
    }
  }
  materialOf(s) {
    const C = this.C;
    const k = s.kind === 'spin' ? 'nylon' : C.id === 'blackwatch' ? 'dacronCruise' : C.id === 'dinghy' ? 'dacronDinghy' : C.sailcloth || (C.massHull > 600 ? 'dacronCruise' : 'laminate');
    return { key: k, ...(CLOTH_STRENGTH[s.cloth || k] || CLOTH_STRENGTH.dacronCruise) };
  }
  sailName(s) { return { main: 'Mainsail', jib: 'Jib', stay: 'Staysail', gennaker: this.C.id === 'cat' ? 'Spinnaker' : 'Gennaker' }[s.key] || s.key; }

  // ---------------------------------------------------------------- grounding (the keel, the rudder) and pounding
  groundingCheck(dt, ctx) {
    const b = this.b, C = this.C, H = this.H, world = ctx.world;
    if (!world) return;
    const was = this._aground > 0.005, now = b.aground > 0.005;
    const bed = ctx.seabed ? ctx.seabed(b.x, b.z) : 'sand';
    this.bed = now ? bed : this.bed;
    if (now && !was) {
      const v = Math.max(0, Math.abs(this._u));
      const E = 0.5 * b.mass * v * v;
      const sx = b.x + Math.sin(b.psi) * C.rudder.x, sz = b.z - Math.cos(b.psi) * C.rudder.x;
      const rTip = -C.rudder.z + C.rudder.span * 0.5;
      const rudderToo = world.depthAt(sx, sz) < rTip;
      if (E > 20) this.grounding(E, bed, rudderToo);
    } else if (now && this._hv < -0.4 && b.heaveV > -0.1) {
      // pounding: the hull dropped onto the bottom with a sea running
      const E = 0.5 * b.mass * this._hv * this._hv;
      if (E > 50) this.grounding(E, bed, false);
    }
    this.hull.grounded = now;
  }

  // ---------------------------------------------------------------- water in, water out
  flood(dt, ctx) {
    const b = this.b, C = this.C, H = this.H, h = this.hull;
    const env = ctx.env, t = ctx.t || 0;
    const sphi = Math.sin(b.phi), cphi = Math.cos(b.phi);
    const eta = (x, y) => {
      if (!env || !env.wavesOn || !b._etaAt) return 0;
      return b._etaAt(x) + (b._slLat ? b._slLat(x) * y : 0);
    };
    // inside: the water stands at the height where the hull holds its volume (the hull's own sections)
    const Vw = this.water / RHO_W;
    let zin = this.inZ[0];
    if (Vw > 0) { const V = this.inV; let k = 1; while (k < V.length - 1 && V[k] < Vw) k++; zin = this.inZ[k - 1] + (this.inZ[k] - this.inZ[k - 1]) * clamp((Vw - V[k - 1]) / Math.max(1e-9, V[k] - V[k - 1]), 0, 1); }
    this.zin = zin;
    let Q = 0;
    const holeHead = (x, y, z) => {
      const zw = b.heave + z * cphi - y * sphi + x * b.pitch;             // hole height relative to still water
      const out = eta(x, y) - zw;                                          // sea above it
      const inside = Math.max(0, zin - z);                                 // water inside above it
      return out - inside;
    };
    for (const o of h.holes) { const hh = holeHead(o.x, o.y, o.z); if (hh > 0) Q += torricelli(o.A, hh); }
    // downflooding: the companionway sill under water (knocked down, or sinking)
    if (H.down) {
      for (const sd of [-1, 1]) {
        const hh = holeHead(C.mastX - 0.5, sd * 0.25, H.down.z);
        if (hh > 0) Q += torricelli(H.down.A * 0.5, hh);
      }
    }
    this.inflow = Q;
    // pumps: manual ones need someone on the handle (fatigue); a self-bailer drains while she sails
    let out = 0;
    if (this.water > 0.5 && this.pumping) {
      for (const p of H.pumps) out += p.lpm / 60000 * (p.manual ? clamp(b.pumpPower ?? 1, 0.2, 1) : 1);
      if (H.bailer && b.u > 1.5) out += 0.25e-3 * clamp((b.u - 1.5) / 1.5, 0, 1);
    }
    this.pumpOut = out;
    const cap = this.Vfull * RHO_W - (b.mHull ?? C.massHull) - b.crewMass;
    // foam / sealed tanks: that share of the volume never floods
    const maxW = (this.Vfull * (1 - H.flot)) * RHO_W * 0.95;
    this.water = clamp(this.water + (Q - out) * RHO_W * dt, 0, maxW);
    if (C.multihull && h.holes.length) this.waterY = h.holes[0].y;
    b.water = this.water; recomputeMass(b);
    b.pumpWork = out > 0 && H.pumps.some((p) => p.manual) ? 1 : 0;
    // sunk: more water than her reserve buoyancy, or the deck well under
    if ((this.water > cap * 0.98 && H.flot === 0) || (b.heave < -(C.freeboard + 0.6) && H.flot === 0)) {
      h.sunk = true; b.sunk = true;
      this.event('sunk', 'SUNK — she has gone down');
    }
  }
  sunkStep(dt, ctx) {
    const b = this.b, C = this.C;
    b.u *= 0.9; b.v *= 0.9; b.r *= 0.9;
    const floor = ctx.world ? -(Math.max(1.5, ctx.world.depthAt(b.x, b.z)) - C.draft) : -6;
    b.heave = Math.max(floor, Math.min(b.heave, -(C.freeboard + 0.8)) - 0.25 * dt);
    b.heaveV = 0;
  }

  // ---------------------------------------------------------------- summary for the panel / net
  retire() { return this.rig.down || this.hull.sunk || this.hull.keelLost || this.hull.rudderLost || this.water > 0.5 * (this.Vfull * RHO_W - this.b.mass); }
  netState() {
    const s = {};
    if (this.rig.down) { s.dm = [Math.round(this.rig.breakZ * 100) / 100, this.rig.side, this.rig.cut ? 1 : 0]; }
    const t = {}; let any = false; for (const k in this.sails) if (this.sails[k].tear > 0) { t[k] = [Math.round(this.sails[k].tear * 100) / 100, Math.round(this.sails[k].u * 100) / 100, Math.round(this.sails[k].v * 100) / 100]; any = true; }
    if (any) s.tr = t;
    if (this.water > 5) s.w = Math.round(this.water);
    if (this.hull.sunk) s.sk = 1;
    return Object.keys(s).length ? s : null;
  }
  applyNet(s) {
    const b = this.b;
    if (!s) return;
    if (s.dm && !this.rig.down) { this.dismast(s.dm[0], 'remote', s.dm[1]); this.events.length = 0; }
    if (s.dm && s.dm[2]) this.rig.cut = true;
    if (s.tr) for (const k in s.tr) if (this.sails[k]) { const S = this.sails[k]; [S.tear, S.u, S.v] = s.tr[k]; S.blown = S.tear >= 0.75; (b.sailHealth || (b.sailHealth = {}))[k] = S.blown ? 0 : 1 - S.tear; }
    if (s.w) { this.water = s.w; b.water = s.w; recomputeMass(b); }
    if (s.sk) { this.hull.sunk = true; b.sunk = true; }
  }
}
