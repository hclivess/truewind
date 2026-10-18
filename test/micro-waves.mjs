// Micro validation of the sea (js/env.js WaveField) against linear (Airy) and Stokes wave theory and the standard
// sea-state statistics. What other tests already pin is not repeated here (they are listed in docs/VALIDATION.md):
// Hs and Tp against duration-limited JONSWAP / PM in storms (big-seas.mjs), Beaufort heights and wind-sea
// steepness (whitecaps.mjs), crest statistics against Forristall (big-seas.mjs), shoaling, refraction (Snell),
// diffraction and the 0.78 breaking index at the coast (coastal.mjs), the tide's levels and streams against gauges
// (tide.mjs).
//   1. dispersion w^2 = g k tanh(k h): the wavenumber the sea uses at a depth (env.js kOfDepth, Eckart's
//      approximation) against the exact root, deep to shallow; and the phase speed measured off the sampled surface
//   2. group speed: a two-component group's envelope moves at cg = c/2 in deep water
//   3. orbital velocity and acceleration at the surface: w A and w^2 A (deep), w A / tanh(k h) horizontally in finite
//      depth; their decay below the surface (one e^{k z} per quantity, js/physics.js) against the sum of the
//      components' own e^{k_i z}; the shallow-water cosh profile
//   4. Stokes drift at the surface against Kenyon (1969) / Ardhuin et al. (2009): ~1-1.5% of U10 in a developed sea
//   5. the spectrum: Hs = 4 sqrt(m0) of the sampled surface against the sea's own Hs, and the sea's Hs and Tp against
//      the fetch-limited JONSWAP growth law (Shore Protection Manual 1984 / CEM) and Pierson-Moskowitz (1964)
//   6. statistics of the zero-up-crossing waves: H1/3 against 4 sqrt(m0) (Goda 2000: H1/3 ~ 0.95 Hm0 in a real
//      spectrum; 1.0 for a narrow one), the Rayleigh exceedance P(H > Hs) = e^-2 (Longuet-Higgins 1952), the expected
//      largest of N waves ~ Hm0 sqrt(ln N / 2) (ibid.)
//   7. steepness: no individual wave steeper than the Stokes-Michell limit H/L = 1/7 (Michell 1893)
// node test/micro-waves.mjs [QUICK=1]   (writes test/out/validation/micro-waves.json; exits 1 on a fail)
import { Environment, KT, G, kOfDepth, seaHsTp } from '../js/env.js';
import { dispK, groupSpeed } from '../js/coastal.js';
import { Register } from './lib/validation.mjs';

const V = new Register('micro-waves');
const QUICK = !!+(process.env.QUICK || 0);
const pct = (a, b) => `${a.toPrecision(4)} vs ${b.toPrecision(4)} (${a >= b ? '+' : ''}${((a / b - 1) * 100).toFixed(1)}%)`;
const within = (a, b, tol) => Math.abs(a / b - 1) <= tol;

// a sea of one component (or a few) of our choosing: the WaveField of a real Environment, its components replaced
function seaOf(comps, depth = null) {
  const env = new Environment({ tws: 10 * KT, twd: 0, fetchKm: 50, seed: 3, weather: 'steady', rogue: false });
  const W = env.waves;
  W.comps = comps.map((c) => ({ kind: 'swell', f: c.omega / (2 * Math.PI), phase: 0, dx: 1, dz: 0, Q: c.Q ?? 0, ...c, kRef: c.k }));
  W.k2 = 0; W.coastal = null; W.scaleFn = null;
  W.depthFn = depth === null ? null : () => depth;
  W._rgE = new Map(); W._rgL = new Map();
  return W;
}

// ---------------------------------------------------------------- 1. dispersion
console.log('1. dispersion w^2 = g k tanh(k h)');
for (const [T, h] of [[6, 1000], [6, 20], [6, 5], [6, 2], [10, 10], [12, 40], [12, 25], [16, 50]]) {
  const w = 2 * Math.PI / T, kx = dispK(w, h), ke = kOfDepth(w, h);
  const res = Math.abs(G * kx * Math.tanh(kx * h) - w * w) / (w * w);
  V.check({ section: 'dispersion', quantity: `exact root (coastal.js dispK) residual, T ${T} s, h ${h} m`, expected: '0', tol: '1e-6', source: 'Airy linear theory', show: res.toExponential(1), ok: res < 1e-6 });
  // Eckart (1952): within ~5% everywhere; env.js uses k0 (deep water) beyond 30 m whatever the wavelength
  V.check({ section: 'dispersion', quantity: `the sea's wavenumber (env.js kOfDepth), T ${T} s, h ${h} m (kh ${(kx * h).toFixed(2)})`, expected: `exact k ${kx.toFixed(4)} /m`, tol: '5%', source: 'w^2 = g k tanh(kh); Eckart 1952 (approximation within ~5%)', show: pct(ke, kx), ok: within(ke, kx, 0.05) });
}
// the phase speed off the sampled surface (deep water, a low wave so the Gerstner map is near-linear)
{
  const T = 7, w = 2 * Math.PI / T, k = w * w / G, A = 0.05, W = seaOf([{ A, k, omega: w }]);
  const o = {}, L = 2 * Math.PI / k, xs = [];
  // zero up-crossings in space at t = 0, then the phase after 1 s
  const zc = (t) => { const r = []; let prev = null; for (let x = 0; x < 3 * L; x += L / 400) { const hh = W.sample(x, 0, t, o).h; if (prev !== null && prev < 0 && hh >= 0) r.push(x); prev = hh; } return r; };
  const z0 = zc(0), z1 = zc(1);
  const Lm = (z0[z0.length - 1] - z0[0]) / (z0.length - 1), shift = ((z1[0] - z0[0]) % Lm + Lm) % Lm;
  V.check({ section: 'dispersion', quantity: `wavelength off the sampled surface, T ${T} s deep`, expected: `2 pi g / w^2 = ${L.toFixed(2)} m`, tol: '1%', source: 'Airy', show: pct(Lm, L), ok: within(Lm, L, 0.01) });
  V.check({ section: 'dispersion', quantity: `phase speed off the sampled surface, T ${T} s deep`, expected: `g/w = ${(G / w).toFixed(2)} m/s`, tol: '2%', source: 'Airy', show: pct(shift, G / w), ok: within(shift, G / w, 0.02) });
}

// ---------------------------------------------------------------- 2. group speed
console.log('2. group speed');
{
  const T = 8, w = 2 * Math.PI / T, dw = 0.04 * w, A = 0.05;
  const comps = [w - dw, w + dw].map((ww) => ({ A, k: ww * ww / G, omega: ww }));
  const W = seaOf(comps), o = {};
  const Lenv = 2 * Math.PI / (comps[1].k - comps[0].k);
  const peak = (t, x0) => { let bx = x0, be = -1; for (let x = x0 - Lenv / 2; x < x0 + Lenv / 2; x += 0.5) { const e = W.sample(x, 0, t, o).Ea; if (e > be) { be = e; bx = x; } } return bx; };
  const dt = 20, p0 = peak(0, 0), p1 = peak(dt, p0 + groupSpeed(w, w * w / G, 1e4) * dt);
  const cg = (p1 - p0) / dt, cgT = (2 * dw) / (comps[1].k - comps[0].k);
  V.check({ section: 'group speed', quantity: `envelope speed of a group, T ${T} s deep`, expected: `dw/dk = ${cgT.toFixed(2)} m/s (= c/2 ${(G / w / 2).toFixed(2)})`, tol: '3%', source: 'Airy: cg = c/2 in deep water', show: pct(cg, cgT), ok: within(cg, cgT, 0.03) });
}

// ---------------------------------------------------------------- 3. orbital velocity and acceleration
console.log('3. orbital motion');
for (const [T, h] of [[7, null], [7, 8], [10, 5]]) {
  const w = 2 * Math.PI / T, k = h === null ? w * w / G : dispK(w, h), A = 0.04, W = seaOf([{ A, k, omega: w }], h), o = {};
  let mx = 0, my = 0, ax = 0, ay = 0;
  for (let i = 0; i < 400; i++) { W.sample(0, 0, i * T / 400, o); mx = Math.max(mx, Math.abs(o.vx)); my = Math.max(my, Math.abs(o.vy)); ax = Math.max(ax, Math.abs(o.ax)); ay = Math.max(ay, Math.abs(o.ay)); }
  const th = h === null ? 1 : Math.tanh(k * h), where = h === null ? 'deep' : `h ${h} m (kh ${(k * h).toFixed(2)})`;
  V.check({ section: 'orbital', quantity: `horizontal orbital velocity at the surface, T ${T} s, ${where}`, expected: `w A / tanh(kh) = ${(w * A / th).toFixed(4)} m/s`, tol: '3%', source: 'Airy: u = w A cosh(k(z+h)) / sinh(kh)', show: pct(mx, w * A / th), ok: within(mx, w * A / th, 0.03) });
  V.check({ section: 'orbital', quantity: `vertical orbital velocity at the surface, T ${T} s, ${where}`, expected: `w A = ${(w * A).toFixed(4)} m/s`, tol: '3%', source: 'Airy', show: pct(my, w * A), ok: within(my, w * A, 0.03) });
  V.check({ section: 'orbital', quantity: `horizontal / vertical acceleration amplitude, T ${T} s, ${where}`, expected: `w^2 A / tanh(kh) = ${(w * w * A / th).toFixed(4)}, w^2 A = ${(w * w * A).toFixed(4)} m/s^2`, tol: '3%', source: 'Airy', show: `${pct(ax, w * w * A / th)}; ${pct(ay, w * w * A)}`, ok: within(ax, w * w * A / th, 0.03) && within(ay, w * w * A, 0.03) });
}
// decay below the surface: the hull reads each quantity at depth z as (surface value) e^{k_v z} with one spectral-
// mean wavenumber (js/physics.js, env.js update: kv, ka, kd); linear theory sums each component's own e^{k_i z}
for (const kn of [15, 25]) {
  const env = new Environment({ tws: kn * KT, twd: 0, fetchKm: 100, seed: 5, weather: 'steady', rogue: false }); env.tick(0);
  const W = env.waves;
  let rows = [], ok = true;
  for (const z of [-0.5, -1.5, -3]) {
    let s0 = 0, sz = 0, d0 = 0, dz = 0;
    for (const c of W.comps) { const a2 = c.A * c.A, w2 = c.omega * c.omega; s0 += w2 * a2; sz += w2 * a2 * Math.exp(2 * c.k * z); d0 += c.omega * c.k * a2; dz += c.omega * c.k * a2 * Math.exp(2 * c.k * z); }
    const exact = Math.sqrt(sz / s0), model = Math.exp(W.kv * z), ed = dz / d0, md = Math.exp(2 * W.kd * z);
    rows.push(`z ${z}: rms u ${model.toFixed(3)} vs ${exact.toFixed(3)}, drift ${md.toFixed(3)} vs ${ed.toFixed(3)}`);
    if (Math.abs(model - exact) > 0.1 * exact + 0.01 || Math.abs(md - ed) > 0.15 * ed + 0.01) ok = false;
  }
  V.check({ section: 'orbital', quantity: `decay with depth of the orbital velocity and the Stokes drift, ${kn} kn sea (Hs ${W.Hs.toFixed(2)} m)`, expected: 'sum of e^{k_i z} (velocity), e^{2 k_i z} (drift) over the components', tol: '10% (velocity), 15% (drift)', source: 'Airy; Stokes drift u_s(z) = sum w k a^2 e^{2kz}', show: rows.join('; '), ok });
}
{ // shallow water: linear theory's cosh(k(z+h))/cosh(kh) against the e^{kz} the hull uses
  const T = 8, h = 5, w = 2 * Math.PI / T, k = dispK(w, h);
  const z = -2.5, cosh = Math.cosh(k * (z + h)) / Math.cosh(k * h), ex = Math.exp(k * z);
  V.check({ section: 'orbital', quantity: `horizontal orbital velocity at mid-depth in shallow water (T ${T} s, h ${h} m), relative to the surface`, expected: `cosh(k(z+h))/cosh(kh) = ${cosh.toFixed(3)}`, tol: '10%', source: 'Airy', show: `e^{kz} used: ${ex.toFixed(3)} (${((ex / cosh - 1) * 100).toFixed(0)}%)`, status: within(ex, cosh, 0.1) ? 'pass' : 'warn' });
}

// ---------------------------------------------------------------- 4. Stokes drift
console.log('4. Stokes drift');
for (const kn of [15, 25]) {
  const U = kn * KT, env = new Environment({ tws: U, twd: 0, fetchKm: 2000, seed: 5, weather: 'steady', rogue: false }); env.tick(0);
  const W = env.waves, us = Math.hypot(W.drift.x, W.drift.z), r = us / U;
  V.check({ section: 'Stokes drift', quantity: `surface Stokes drift in a developed sea, ${kn} kn`, expected: '1-1.5% of U10 (0.8-2% accepted)', tol: '', source: 'Kenyon 1969; Ardhuin et al. 2009 (us ~ 1.3% U10 from wave spectra)', show: `${us.toFixed(3)} m/s = ${(r * 100).toFixed(2)}% of U10`, ok: r >= 0.008 && r <= 0.02, warn: r >= 0.004 && r <= 0.03 });
}

// ---------------------------------------------------------------- 5. spectrum and 6. statistics, 7. steepness
console.log('5-7. spectrum, wave statistics, steepness');
for (const [kn, fetch] of QUICK ? [[20, 100]] : [[15, 2000], [20, 100], [30, 20]]) {
  const U = kn * KT, env = new Environment({ tws: U, twd: 0, fetchKm: fetch, seed: 9, weather: 'steady', rogue: false }); env.tick(0);
  const W = env.waves, o = {}, [Hs0, Tp0] = seaHsTp(U, fetch * 1000), tag = `${kn} kn, fetch ${fetch} km`;
  // the growth law the sea follows: SPM 1984 (JONSWAP) fetch-limited, capped by Pierson-Moskowitz (Hs 0.21 U^2/g)
  const chi = G * fetch * 1000 / (U * U), HsJ = 1.6e-3 * Math.sqrt(chi) * U * U / G, TpJ = 0.286 * Math.cbrt(chi) * U / G, HsPM = 0.21 * U * U / G, TpPM = 7.14 * U / G;
  const HsR = Math.min(HsJ, HsPM), TpR = Math.min(TpJ, TpPM);
  V.check({ section: 'spectrum', quantity: `the sea's Hs, ${tag}`, expected: `JONSWAP/SPM fetch-limited ${HsJ.toFixed(2)} m, PM cap ${HsPM.toFixed(2)} m (and a day's duration: ${Hs0.toFixed(2)})`, tol: '10%', source: 'Hasselmann et al. 1973; Shore Protection Manual 1984; Pierson & Moskowitz 1964', show: pct(W.Hs, Math.min(HsR, Hs0 * 1.0001)), ok: within(W.Hs, Math.min(HsR, Hs0 * 1.0001), 0.1) });
  V.check({ section: 'spectrum', quantity: `the sea's Tp, ${tag}`, expected: `SPM ${TpJ.toFixed(1)} s, PM cap ${TpPM.toFixed(1)} s (a day: ${Tp0.toFixed(1)})`, tol: '12% (one frequency bin)', source: 'as above', show: pct(W.Tp, Math.min(TpR, Tp0 * 1.0001)), ok: within(W.Tp, Math.min(TpR, Tp0 * 1.0001), 0.12) });
  // a time series at a point: 2 Hz for 40 min (the sea's 20 components do not repeat in that time)
  const N = QUICK ? 2400 : 4800, dt = 0.5, h = new Float64Array(N);
  for (let i = 0; i < N; i++) h[i] = W.sample(0, 0, i * dt, o).h;
  let m = 0; for (const v of h) m += v; m /= N; let v2 = 0; for (const v of h) v2 += (v - m) ** 2; v2 /= N;
  const Hm0 = 4 * Math.sqrt(v2);
  V.check({ section: 'spectrum', quantity: `Hm0 = 4 sqrt(m0) of the sampled surface, ${tag}`, expected: `the sea's Hs ${W.Hs.toFixed(2)} m`, tol: '10%', source: 'spectral definition Hm0 = 4 sqrt(m0)', show: pct(Hm0, W.Hs), ok: within(Hm0, W.Hs, 0.1) });
  // zero up-crossing waves
  const waves = []; let last = -1, lo = 0, hi = 0;
  for (let i = 1; i < N; i++) {
    const a = h[i - 1] - m, b = h[i] - m;
    if (a < 0 && b >= 0) { const tc = (i - 1 + a / (a - b)) * dt; if (last >= 0) waves.push({ H: hi - lo, T: tc - last }); last = tc; lo = 0; hi = 0; }
    lo = Math.min(lo, b); hi = Math.max(hi, b);
  }
  const Hs = waves.map((x) => x.H).sort((a, b) => b - a), n = Hs.length;
  const H13 = Hs.slice(0, Math.max(1, Math.round(n / 3))).reduce((s, x) => s + x, 0) / Math.max(1, Math.round(n / 3));
  V.check({ section: 'statistics', quantity: `H1/3 of the zero-crossing waves / Hm0, ${tag} (${n} waves)`, expected: '0.95 (real spectra; 1.0 narrow-band)', tol: '0.88-1.02', source: 'Goda 2000; Longuet-Higgins 1980', show: (H13 / Hm0).toFixed(3), ok: H13 / Hm0 >= 0.88 && H13 / Hm0 <= 1.02 });
  const pEx = Hs.filter((x) => x > Hm0).length / n;
  V.check({ section: 'statistics', quantity: `P(H > Hm0), ${tag}`, expected: 'e^-2 = 0.135 (Rayleigh)', tol: '0.08-0.20 (fewer for a broad spectrum)', source: 'Longuet-Higgins 1952', show: pEx.toFixed(3), ok: pEx >= 0.08 && pEx <= 0.2, warn: pEx >= 0.05 && pEx <= 0.25 });
  const Emax = Hm0 * Math.sqrt(Math.log(n) / 2);
  V.check({ section: 'statistics', quantity: `largest of ${n} waves, ${tag}`, expected: `Hm0 sqrt(ln N / 2) = ${Emax.toFixed(2)} m`, tol: '25% (one record)', source: 'Longuet-Higgins 1952', show: pct(Hs[0], Emax), ok: within(Hs[0], Emax, 0.25) });
  // steepness of each wave: H / L with L = g T^2 / 2 pi (deep water)
  let sMax = 0; for (const x of waves) if (x.T > 0.5) sMax = Math.max(sMax, x.H / (G * x.T * x.T / (2 * Math.PI)));
  let cMax = 0; for (const c of W.comps) cMax = Math.max(cMax, 2 * c.A / (2 * Math.PI / c.k));
  V.check({ section: 'steepness', quantity: `steepest wave H/L, ${tag}`, expected: '< 1/7 = 0.143', tol: '', source: 'Michell 1893 (Stokes limiting wave)', show: `${sMax.toFixed(3)} (steepest component ${cMax.toFixed(3)})`, ok: sMax < 1 / 7 && cMax < 1 / 7 });
}
V.save();
process.exit(V.failed ? 1 : 0);
