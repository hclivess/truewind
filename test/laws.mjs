// Physics laws the simulation must obey, each against a closed form or published data (test/lib/check.mjs prints the
// quantity, the expected value, the tolerance, the source and what was measured):
//  1. units: the knot
//  2. the apparent-wind triangle, exact for any heading, speed, leeway and stream (Boat.step's instruments)
//  3. the wind over the sea: Charnock roughness, the 10 m drag coefficient against Smith (1980), the log profile
//     between deck and masthead against the offshore power law; puffs: the mean kept, turbulence intensity and gust
//     factor against the model's own design (and the offshore range), the puff period
//  4. hydrostatics: every class floats level at its design waterline (weight = buoyancy, trim, heel, drift at rest);
//     the GZ curve's angle of vanishing stability against published figures and ISO 12217-2; the righting moment the
//     generic rigs are sized from against the hull's own
//  5. leeway close-hauled against measured yacht leeway
// node test/laws.mjs [QUICK=1: fewer classes in 4 and 5]
import { suite } from './lib/check.mjs';
import { CLASSES, CLASS_ORDER, Boat, makeSteadyEnv, solvePolarAngle, RHO_W } from '../js/physics.js';
import { KT, DEG, G, WindField } from '../js/env.js';
import { RIG_DATA, rm30 } from '../js/rig-structure.js';
const QUICK = !!+(process.env.QUICK || 0);
const S = suite('laws');

// ---------------------------------------------------------------- 1. units
S.near({ quantity: 'one knot', measured: KT, expected: 1852 / 3600, tol: 1e-6, rel: true, unit: 'm/s', source: 'international nautical mile 1852 m (1929)' });

// ---------------------------------------------------------------- 2. the apparent-wind triangle
// A uniform wind (no gradient), set states, one step of 1 microsecond: the instruments against the vector triangle
// in the water's frame (true wind over the water = wind over the ground - stream; apparent = that - the boat's
// velocity through the water), and the textbook form AWS^2 = TWS^2 + V^2 + 2 TWS V cos(TWA) with no leeway or stream.
{
  const env = { wind: { sample: (x, z, t, o) => { o.speed = W.tws; o.dir = W.twd; o.puff = 0; return o; }, profile: () => 1 },
    current: { at: (x, z, o) => { o.x = W.cx; o.z = W.cz; return o; } }, wavesOn: false };
  const W = { tws: 0, twd: 0, cx: 0, cz: 0 };
  const b = new Boat('sportboat', { sailModel: 'strip', rigStructure: false });
  let worstA = 0, worstS = 0, worstTB = 0, worstT = 0, n = 0;
  const r = (k) => { let h = 2166136261 + k; h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  for (let k = 0; k < 400; k++) {
    const psi = r(5 * k) * 2 * Math.PI, u = r(5 * k + 1) * 10, tws = 1 + r(5 * k + 2) * 25, twd = r(5 * k + 3) * 2 * Math.PI;
    const withLee = k >= 200, v = withLee ? (r(5 * k + 4) - 0.5) * 1.5 : 0;
    W.tws = tws; W.twd = twd; W.cx = withLee ? Math.sin(k) * 1.5 : 0; W.cz = withLee ? Math.cos(3 * k) * 1.5 : 0;
    b.reset(0, 0, psi); b.u = u; b.v = v;
    b.step(1e-6, env, 0);
    const d = b.diag;
    // ground frame: x east, z south; the wind blows toward dir + 180
    const wx = -Math.sin(twd) * tws, wz = Math.cos(twd) * tws;
    const fx = Math.sin(psi), fz = -Math.cos(psi), sx = Math.cos(psi), sz = Math.sin(psi);
    const twx = wx - W.cx, twz = wz - W.cz;                       // true wind over the water
    const ax = twx - (u * fx + v * sx), az = twz - (u * fz + v * sz);
    const af = ax * fx + az * fz, as = ax * sx + az * sz;         // along the bow, to starboard
    const AWS = Math.hypot(ax, az), AWA = Math.atan2(-as, -af);
    worstS = Math.max(worstS, Math.abs(d.aws - AWS));
    worstA = Math.max(worstA, Math.abs(Math.atan2(Math.sin(d.awa - AWA), Math.cos(d.awa - AWA))));
    worstT = Math.max(worstT, Math.abs(d.twsInst - Math.hypot(twx, twz)));
    if (!withLee) {
      const twa = Math.atan2(Math.sin(twd - psi), Math.cos(twd - psi));
      const aws = Math.sqrt(tws * tws + u * u + 2 * tws * u * Math.cos(twa));
      worstTB = Math.max(worstTB, Math.abs(d.aws - aws));
    }
    n++;
  }
  S.near({ quantity: `AWS against the textbook triangle, ${n / 2} random headings, speeds 0-10 m/s, TWS 1-26 m/s`, measured: worstTB, expected: 0, tol: 1e-3, unit: 'm/s (worst)', source: 'AWS^2 = TWS^2 + V^2 + 2 TWS V cos TWA (e.g. Marchaj, Aero-Hydrodynamics of Sailing, ch. 1)' });
  S.near({ quantity: 'AWS with leeway and a 1.5 m/s stream, worst error', measured: worstS, expected: 0, tol: 1e-3, unit: 'm/s', source: 'vector triangle in the water frame' });
  S.near({ quantity: 'AWA with leeway and stream, worst error', measured: worstA / DEG, expected: 0, tol: 0.01, unit: 'deg', source: 'vector triangle in the water frame' });
  S.near({ quantity: 'instrument TWS = wind over the water (with stream), worst error', measured: worstT, expected: 0, tol: 1e-3, unit: 'm/s', source: 'masthead unit and log measure relative to the water' });
}

// ---------------------------------------------------------------- 3. the wind over the sea
{
  for (const kn of [8, 16, 30]) {
    const wf = new WindField({ tws: kn * KT, gust: 0, seed: 3 }), U = kn * KT, k = 0.41;
    const us = k * U / Math.log(10 / wf.z0);
    S.near({ quantity: `Charnock roughness at ${kn} kn`, measured: wf.z0, expected: 0.011 * us * us / G, tol: 0.02, rel: true, unit: 'm', source: 'Charnock (1955), alpha 0.011 (Smith 1988)' });
    if (U >= 6 && U <= 22) {
      const Cd = (k / Math.log(10 / wf.z0)) ** 2 * 1000, sm = 0.61 + 0.063 * U;
      S.near({ quantity: `10 m drag coefficient at ${kn} kn (x1000)`, measured: Cd, expected: sm, tol: 0.2, rel: true, unit: '', source: 'Smith (1980), JPO 10: 1000 Cd10 = 0.61 + 0.063 U10 (6-22 m/s)' });
    }
  }
  // masthead over deck height, a 30 footer (deck 1 m, masthead 13 m) in 14 kn, against the offshore power law 1/9
  const wf = new WindField({ tws: 14 * KT, gust: 0 });
  S.near({ quantity: 'wind at 13 m / wind at 1 m, 14 kn', measured: wf.profile(13) / wf.profile(1), expected: 13 ** 0.11, tol: 0.06, rel: true, unit: '', source: 'offshore power law, exponent 0.11 (Hsu, Meindl & Gilhousen 1994, J. Appl. Meteor. 33)' });
  S.near({ quantity: 'profile at the 10 m reference height', measured: wf.profile(10), expected: 1, tol: 1e-9, unit: '', source: 'definition: TWS is the 10 m wind' });

  // puffs at a fixed point, 8 hours at 1 Hz (no weather: the puff field alone)
  for (const [kn, g] of [[12, 0.5], [20, 0.8]]) {
    const f = new WindField({ tws: kn * KT, gust: g, shift: 8, seed: 11 }), N = 8 * 3600, s = new Float64Array(N), o = {};
    for (let i = 0; i < N; i++) s[i] = f.sample(0, 0, i, o).speed;
    let m = 0; for (const x of s) m += x; m /= N;
    let v = 0; for (const x of s) v += (x - m) ** 2; const sd = Math.sqrt(v / N);
    S.near({ quantity: `mean wind / set wind, ${kn} kn, gust ${g}`, measured: m / f.tws, expected: 1, tol: 0.03, unit: '', source: 'the slider is the mean wind (env.js P_MEAN)' });
    S.near({ quantity: `turbulence intensity sigma/U, ${kn} kn, gust ${g}`, measured: sd / m, expected: 0.14 * g, tol: 0.3, rel: true, unit: '', source: 'env.js WindField.sample comment: TI ~0.14 g' });
    if (g <= 0.5) S.within({ quantity: `turbulence intensity at the default gust setting, ${kn} kn`, measured: sd / m, lo: 0.05, hi: 0.13, unit: '', source: 'offshore 10 m TI 0.06-0.12 (IEC 61400-3 (2009) Annex; Hsu (2003) gust factors over the sea)' });
    // gust factor: the largest 3 s mean in each 10 min over that 10 min mean
    let gf = 0, nb = 0;
    for (let b0 = 0; b0 + 600 <= N; b0 += 600) {
      let mm = 0; for (let i = b0; i < b0 + 600; i++) mm += s[i]; mm /= 600;
      let pk = 0; for (let i = b0; i + 3 <= b0 + 600; i++) pk = Math.max(pk, (s[i] + s[i + 1] + s[i + 2]) / 3);
      gf += pk / mm; nb++;
    }
    S.near({ quantity: `gust factor (3 s peak / 10 min mean), ${kn} kn, gust ${g}`, measured: gf / nb, expected: 1 + 0.8 * g, tol: 0.15, rel: true, unit: '', source: 'env.js design 1 + 0.8 g; WMO-No. 1555 (2015) at sea 1.2-1.5' });
    // puff period: mean interval between up-crossings of the mean
    let up = 0; for (let i = 1; i < N; i++) if (s[i - 1] < m && s[i] >= m) up++;
    const T = N / Math.max(1, up), Texp = kn === 12 ? 55 : 42;
    S.within({ quantity: `puff period at a point, ${kn} kn`, measured: T, lo: Texp * 0.5, hi: Texp * 1.6, unit: 's', source: 'env.js design ~90 s at 6 kn, 55 at 12, 35 at 25 (L/U of the puffs)' });
  }
}

// ---------------------------------------------------------------- 4. hydrostatics
{
  const env = makeSteadyEnv(0.01), dt = 1 / 120;
  const all = CLASS_ORDER.filter((id) => !CLASSES[id].speed && !CLASSES[id].hydrofoils);
  const settle = QUICK ? ['blackwatch', 'dinghy', 'cat', 'contessa32'] : all;
  // (a) at rest in calm water, 20 s from a level start
  let worstV = 0, worstH = 0, worstTrim = 0, worstPhi = 0, worstU = 0, wV = '', wH = '', wT = '', wP = '', wU = '';
  for (const id of settle) {
    const b = new Boat(id, { sailModel: 'strip' });
    b.reset(0, 0, 0);
    for (let i = 0; i < 120 * 20; i++) b.step(dt, env, i * dt);
    const imm = b.hydro.immerse(b.heave, b.pitch, b.phi, () => 0, () => 0, {});
    const eV = imm.V * RHO_W / b.mass - 1;
    if (Math.abs(eV) > Math.abs(worstV)) { worstV = eV; wV = id; }
    if (Math.abs(b.heave) > Math.abs(worstH)) { worstH = b.heave; wH = id; }
    if (Math.abs(b.pitch) > Math.abs(worstTrim)) { worstTrim = b.pitch; wT = id; }
    if (Math.abs(b.phi) > Math.abs(worstPhi)) { worstPhi = b.phi; wP = id; }
    const sp = Math.hypot(b.u, b.v); if (sp > worstU) { worstU = sp; wU = id; }
  }
  const nn = `${settle.length} classes`;
  S.near({ quantity: `buoyancy / weight at rest (${nn}, worst ${wV})`, measured: 1 + worstV, expected: 1, tol: 0.005, unit: '', source: 'Archimedes' });
  S.near({ quantity: `heave at rest from the design waterline (worst ${wH})`, measured: worstH * 100, expected: 0, tol: 2, unit: 'cm', source: 'class data: displacement and lines agree (js/hull.js calibrate)' });
  S.near({ quantity: `trim at rest (worst ${wT})`, measured: worstTrim / DEG, expected: 0, tol: 1.5, unit: 'deg', source: 'boats float near their designed trim (est.: 1.5 deg is ~10 cm over a 4 m dinghy)' });
  S.near({ quantity: `heel at rest, crew on the centreline (worst ${wP})`, measured: worstPhi / DEG, expected: 0, tol: 0.5, unit: 'deg', source: 'symmetry' });
  S.near({ quantity: `drift at rest in still air and water (worst ${wU})`, measured: worstU, expected: 0, tol: 0.01, unit: 'm/s', source: 'no force, no motion' });

  // (b) the GZ curve of the hull with its crew on the centreline, re-floated at each angle (pitch held at rest)
  const gzCurve = (b) => {
    const C = b.cls, m = b.mass, out = [];
    for (let ph = 0; ph <= 180; ph += 2.5) {
      let z = 0, r;
      for (let it = 0; it < 60; it++) { r = b.hydro.immerse(z, 0, ph * DEG, () => 0, () => 0, {}); z += (r.V - m / RHO_W) / Math.max(1, 0.6 * b.Awp) * 0.7; }
      const RM = RHO_W * G * r.My - C.massHull * G * C.zG * Math.sin(ph * DEG) - b.crewMass * G * C.crewZ * Math.sin(ph * DEG);
      out.push([ph, RM / (m * G)]);
    }
    return out;
  };
  const avsOf = (gz) => { for (let i = 2; i < gz.length; i++) if (gz[i - 1][1] > 0 && gz[i][1] <= 0) return gz[i - 1][0] + 2.5 * gz[i - 1][1] / (gz[i - 1][1] - gz[i][1]); return 180; };
  const boats = {};
  const get = (id) => boats[id] || (boats[id] = new Boat(id, { sailModel: 'strip' }));
  // published: Contessa 32 155 deg (Rogers' figure, quoted after the 1979 Fastnet; js/classes/contessa32.js)
  {
    const avs = avsOf(gzCurve(get('contessa32')));
    S.near({ quantity: 'AVS Contessa 32', measured: avs, expected: 155, tol: 8, unit: 'deg', source: 'Jeremy Rogers / 1979 Fastnet Race Inquiry; js/classes/contessa32.js' });
  }
  // ISO 12217-2 (2015) design category A (ocean), monohull sailing boats: AVS >= 130 - 0.002 m_LDC, and not under 100
  const ocean = QUICK ? ['contessa32', 'oceanis381'] : ['contessa32', 'westsail32', 'oceanis381', 'j122', 'joshua', 'suhaili', 'gipsymoth4', 'catalina30'];
  for (const id of ocean) {
    const b = get(id), avs = avsOf(gzCurve(b)), lim = Math.max(100, 130 - 0.002 * b.mass);
    S.within({ quantity: `AVS ${CLASSES[id].name} (${Math.round(b.mass)} kg)`, measured: avs, lo: lim, unit: 'deg', source: 'ISO 12217-2:2015 category A: >= 130 - 0.002 m, min 100 deg' });
  }
  // an unballasted dinghy, crew sitting in the middle, lies down somewhere between 60 and 100 deg
  for (const id of QUICK ? ['dinghy'] : ['dinghy', 'optimist', '470', 'sunfish', 'flyingscot']) {
    const avs = avsOf(gzCurve(get(id)));
    S.within({ quantity: `AVS ${CLASSES[id].name} (no crew weight out)`, measured: avs, lo: 55, hi: 105, unit: 'deg', source: 'unballasted planing dinghies: positive stability to ~60-100 deg (est., cf. ISO 12217-3 swamping/capsize tests)' });
  }
  // (c) the righting moment the generic rig sizing assumes (C.gm, the class table's GM, crew in the middle) against the
  // boat's own at 30 deg as she sails: the hull's GZ plus the crew sitting out (crewMaxOut), what the shrouds carry
  const generic = all.filter((id) => !CLASSES[id].rigStructure && !RIG_DATA[id] && !CLASSES[id].multihull);
  const pick = QUICK ? generic.slice(0, 4) : generic;
  for (const id of pick) {
    const b = get(id), C = b.cls, gz30 = gzCurve(b).find((p) => p[0] === 30)[1] + b.crewMass * (C.crewMaxOut || 0) * Math.cos(30 * DEG) / b.mass;
    const assumed = rm30(C) / (b.mass * G);                                  // js/rig-structure.js genericRig's RM30 / (m g)
    S.near({ quantity: `${C.name}: RM30 the generic rig is sized from / the hull's own (crew out)`, measured: assumed / gz30, expected: 1, tol: 0.25, unit: '', source: 'Nordic Boat Standard rig sizing from the boat\'s own RM30 (js/rig-structure.js rm30 uses C.gm, C.bmForm; GENERIC_K may correct the wires)' });
  }
}

// ---------------------------------------------------------------- 5. leeway close-hauled
// Full-scale and tank data: a fin-keel yacht beating makes 3-6 deg of leeway, a long keel 4-8, a dinghy with its
// board down 2-5 (Marchaj, Sailing Theory and Practice (1964/2003) ch. 3; Larsson & Eliasson, Principles of Yacht
// Design, the VPP's beta 2-6 deg; Kerwin's Delft measurements)
for (const [id, lo, hi] of QUICK ? [['sportboat', 2, 6.5]] : [['sportboat', 2, 6.5], ['j24', 2.5, 6.5], ['folkboat', 3, 8], ['dinghy', 1.5, 6]]) {
  const r = solvePolarAngle(CLASSES[id], 12 * KT, 42, { sailModel: 'strip' });
  S.within({ quantity: `leeway ${CLASSES[id].name}, 12 kn, 42 deg TWA (strip sails)`, measured: Math.abs(r.leeway), lo, hi, unit: 'deg', source: 'Marchaj; Larsson & Eliasson ch. 3: 3-6 deg upwind for a fin keel' });
}

S.done();
