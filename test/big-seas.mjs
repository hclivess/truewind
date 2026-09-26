// The extreme end of the sea (js/env.js WaveField): node test/big-seas.mjs [quick]
//  1. open-ocean sea state against Pierson-Moskowitz / JONSWAP at 40, 60 and 80 kn
//  2. crest and height distributions at a point against Rayleigh and Forristall (2000)
//  3. rogue groups: how often, how high, and the crest at the focus against the one drawn from the tail
//  4. the GPU's formula (render.js vertex shader, ported line for line) against sample(), in a rogue group
//  5. what a boat makes of it: surfing down a big following sea, a storm with a rogue beam-on
import { Environment, WaveField, KT, DEG, G, MAXW } from '../js/env.js';
import { Boat, autoTrim, CLASSES, wrap } from '../js/physics.js';
const quick = process.argv.includes('quick');
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('   FAIL: ' + msg); } };
const openSea = (kt, o = {}) => { const e = new Environment({ tws: kt * KT, twd: 0, fetchKm: 2000, seed: 7, weather: 'steady', ...o }); e.tick(0); return e; };

// ---- 1. sea state
console.log('1. open ocean, fully developed (fetch 2000 km)');
for (const kt of [40, 60, 80]) {
  const W = openSea(kt, { rogue: false }).waves, U = kt * KT;
  const chi = G * 2e6 / (U * U);
  const HsPM = 0.21 * U * U / G, TpPM = 7.14 * U / G, HsJ = 1.6e-3 * Math.sqrt(chi) * U * U / G, TpJ = 0.286 * Math.cbrt(chi) * U / G;
  // the sea as sampled: 4 sigma of the surface at a few points over 20 min (second order included)
  let s1 = 0, s2 = 0, n = 0, mx = -1e9, mn = 1e9; const o = {};
  for (let p = 0; p < 4; p++) for (let t = 0; t < 1200; t += 0.5) { const h = W.sample(p * 3000, p * 1700, t, o).h; s1 += h; s2 += h * h; n++; mx = Math.max(mx, h); mn = Math.min(mn, h); }
  const Hm0 = 4 * Math.sqrt(s2 / n - (s1 / n) ** 2);
  console.log(`   ${kt} kn: Hs ${W.Hs.toFixed(1)} m (sampled ${Hm0.toFixed(1)}), Tp ${W.Tp.toFixed(1)} s | PM ${HsPM.toFixed(1)} m ${TpPM.toFixed(1)} s, JONSWAP ${HsJ.toFixed(1)} m ${TpJ.toFixed(1)} s | crest ${mx.toFixed(1)} m, trough ${mn.toFixed(1)} m in 80 min`);
  const want = Math.min(HsPM, HsJ), wantT = Math.min(TpPM, TpJ);
  check(Math.abs(W.Hs / want - 1) < 0.05, `Hs ${W.Hs.toFixed(1)} vs ${want.toFixed(1)}`);
  check(Math.abs(W.Tp / wantT - 1) < 0.12, `Tp ${W.Tp.toFixed(1)} vs ${wantT.toFixed(1)} (one component's frequency: the bins are jittered)`);
  check(Math.abs(Hm0 / W.Hs - 1) < 0.1, `sampled Hs ${Hm0.toFixed(1)}`);
}

// ---- 2. crest and height statistics at points, the sea's own and with its rogue groups (a 20-kn open-ocean
// sea: short enough for ~10^5 waves in a few minutes' computing)
{
  const kt = 20, pts = quick ? 16 : 48, T = quick ? 3 * 3600 : 6 * 3600, dt = 0.3;
  const run = (rogue) => {
    const W = openSea(kt, { rogue }).waves, o = {}, C = [], H = []; let s2 = 0, n = 0;
    for (let p = 0; p < pts; p++) {
      const x = (p % 8) * 1900 + 311, z = Math.floor(p / 8) * 2300 - 877;
      let prev = W.sample(x, z, 0, o).h, cmax = -1e9, tmin = 1e9, started = false, lastT = 0;
      for (let t = dt; t < T; t += dt) {
        const h = W.sample(x, z, t, o).h; s2 += h * h; n++;
        if (prev < 0 && h >= 0) {                                   // zero up-crossing: a wave ends
          if (started) { C.push(cmax); H.push(cmax - Math.min(tmin, lastT)); }   // (to the deeper trough either side)
          started = true; lastT = tmin; cmax = -1e9; tmin = 1e9;
        }
        cmax = Math.max(cmax, h); tmin = Math.min(tmin, h); prev = h;
      }
    }
    return { W, C, H, Hs: 4 * Math.sqrt(s2 / n) };
  };
  const A = run(false), B = run(true), W = A.W, Hs = A.Hs, N = A.C.length;
  const Tm = 2 * Math.PI / Math.sqrt(2 * W.k2 * G), S1 = 2 * Math.PI * Hs / (G * Tm * Tm);
  const aF = 0.3536 + 0.2568 * S1, bF = 2 - 1.7912 * S1;
  const P = (arr, x) => arr.filter(v => v > x).length / arr.length;
  console.log(`2. at points, ${kt} kn open ocean (Hs ${Hs.toFixed(2)} m, ${N} waves; Forristall 2-D crests: alpha ${aF.toFixed(3)} beta ${bF.toFixed(2)})`);
  console.log('             the sea alone   with rogue groups   Rayleigh    Forristall');
  for (const c of [0.6, 0.8, 1.0, 1.1, 1.2, 1.3]) {
    const pa = P(A.C, c * Hs), pb = P(B.C, c * B.Hs), Pf = Math.exp(-Math.pow(c / aF, bF));
    console.log(`   C > ${c.toFixed(1)} Hs  ${pa.toExponential(1).padStart(9)}  ${pb.toExponential(1).padStart(14)}  ${Math.exp(-8 * c * c).toExponential(1).padStart(14)}  ${Pf.toExponential(1).padStart(10)}`);
    if (c <= 0.8) check(pa > Pf / 3 && pa < Pf * 3, `crests over ${c} Hs not within a factor 3 of Forristall`);
    if (c >= 1.1 && c <= 1.2) check(pb > Pf / 10 && pb < Pf * 10, `rogue crests over ${c} Hs not within an order of magnitude of Forristall`);
  }
  // (heights: Forristall's 1978 fit to storm records, P(H > h) = exp(-2.263 (h / Hs)^2.126))
  for (const h of [1.5, 1.8, 2.0, 2.2]) {
    const pa = P(A.H, h * Hs), pb = P(B.H, h * B.Hs), Pf = Math.exp(-2.263 * Math.pow(h, 2.126));
    console.log(`   H > ${h.toFixed(1)} Hs  ${pa.toExponential(1).padStart(9)}  ${pb.toExponential(1).padStart(14)}  ${Math.exp(-2 * h * h).toExponential(1).padStart(14)}  ${Pf.toExponential(1).padStart(10)}`);
    if (h === 2.0) check(pb > Pf / 10 && pb < Pf * 10, 'rogue heights over 2 Hs not within an order of magnitude of Forristall');
  }
}

// ---- 3. rogue groups: occurrence and height
{
  const kt = 60, env = openSea(kt), W = env.waves;
  let n = 0, sumC = 0, maxC = 0; const cr = [];
  const cells = 40, slots = 60;                                   // 40 x 40 cells of 2.5 km, 4 h
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) for (let s = 0; s < slots; s++) {
    const E = W._rgEvent(i, j, s + 10); if (!E) continue;
    n++; cr.push(E.crest / E.Hs); maxC = Math.max(maxC, E.crest / E.Hs);
  }
  const area = cells * cells * 2.5 * 2.5, hours = slots * 240 / 3600;
  const rate = n / area / hours;
  cr.sort((a, b) => a - b);
  // Forristall's space-time rate of crests over 1.1 Hs, for comparison: waves per km^2 per hour
  // (mean period, a crest ~1.5 wavelengths long) times the exceedance per wave
  const Tm = 2 * Math.PI / Math.sqrt(2 * W.k2 * G), Lz = G * Tm * Tm / (2 * Math.PI), S1 = 2 * Math.PI * W.Hs / (G * Tm * Tm);
  const aF = 0.3536 + 0.2568 * S1, bF = 2 - 1.7912 * S1, perWave = Math.exp(-Math.pow(1.1 / aF, bF));
  const wavesKm2h = 3600 / Tm * 1e6 / (Lz * 1.5 * Lz), theory = wavesKm2h * perWave;
  console.log(`3. rogue groups at ${kt} kn (Hs ${W.Hs.toFixed(1)} m): ${rate.toFixed(2)} per km^2 per hour (second-order theory, crests > 1.1 Hs: ${theory.toFixed(2)}; enhancement ${(rate / theory).toFixed(1)}x)`);
  console.log(`   crest / Hs: median ${cr[cr.length >> 1].toFixed(2)}, 90 % ${cr[Math.floor(cr.length * 0.9)].toFixed(2)}, max ${maxC.toFixed(2)}; within 1.5 km of a boat: ${(rate * Math.PI * 1.5 * 1.5).toFixed(1)} an hour`);
  check(rate / theory > 0.5 && rate / theory < 6, 'group rate not within the kurtosis-enhanced range of second-order theory');
  check(maxC <= 1.46 && cr[0] >= 1.1, 'group crests outside 1.1-1.45 Hs');
  // a Draupner: a crest of 1.25 Hs, focused; the surface at the focus, and the wave height there
  const tf = 900, E = W.forceEvent({ x: 400, z: -300, t: tf, crestHs: 1.25 }), o = {};
  let best = -1e9, bx = 0, bz = 0; const Lm = G * E.Tm * E.Tm / (2 * Math.PI);
  for (let x = 400 - Lm / 2; x < 400 + Lm / 2; x += Lm / 200) for (let z = -300 - Lm / 4; z < -300 + Lm / 4; z += Lm / 40) {
    const h = W.sample(x, z, tf, o).h; if (h > best) { best = h; bx = x; bz = z; }
  }
  // trough-to-crest along the group's direction, the deeper trough either side within a wavelength
  let tr1 = 1e9, tr2 = 1e9;
  for (let s = 0; s < Lm; s += Lm / 400) { tr1 = Math.min(tr1, W.sample(bx + E.dx * s, bz + E.dz * s, tf, o).h); tr2 = Math.min(tr2, W.sample(bx - E.dx * s, bz - E.dz * s, tf, o).h); }
  const Hr = best - Math.min(tr1, tr2);
  console.log(`   forced group (crest 1.25 Hs = ${E.crest.toFixed(1)} m): crest ${best.toFixed(1)} m = ${(best / E.Hs).toFixed(2)} Hs, height ${Hr.toFixed(1)} m = ${(Hr / E.Hs).toFixed(2)} Hs (Draupner: 18.5 / 25.6 m in Hs 12 m = 1.55 / 2.15 Hs)`);
  check(Math.abs(best / E.crest - 1) < 0.06, 'crest at the focus is not the group\'s crest');
  check(Hr / E.Hs > 1.8 && Hr / E.Hs < 2.6, 'rogue height not ~2-2.2 Hs');
  // the build-up: the highest crest near the group, 60 s before, at, and 60 s after the focus
  const hi = (tt) => { let m = -1e9; for (let x = 400 - 1.5 * Lm; x < 400 + 1.5 * Lm; x += Lm / 60) for (let z = -300 - Lm / 2; z < -300 + Lm / 2; z += Lm / 12) m = Math.max(m, W.sample(x + E.dx * E.cg * (tt - tf), z + E.dz * E.cg * (tt - tf), tt, o).h); return m; };
  console.log(`   highest crest about the group: -60 s ${hi(tf - 60).toFixed(1)} m, -20 s ${hi(tf - 20).toFixed(1)} m, focus ${hi(tf).toFixed(1)} m, +20 s ${hi(tf + 20).toFixed(1)} m, +60 s ${hi(tf + 60).toFixed(1)} m`);
}

// ---- 4. the GPU's formula against sample()
{
  const env = openSea(45), W = env.waves, t = 1300;
  const E = W.forceEvent({ x: 0, z: 0, t: t + 4, crestHs: 1.3 });
  const U = W.rogueUniforms(t, 0, 0), br = W.brk;
  // render.js: the vertex shader's wave sum, line for line (open water: no depth, shore, fade or LOD)
  const vert = (x0, z0) => {
    const win = (e) => {
      const A = U.A.subarray(4 * e), B = U.B.subarray(4 * e), C = U.C.subarray(4 * e);
      if (C[3] < 0.5) return 0;
      const dt = t - A[2], ut = dt * C[2]; if (Math.abs(ut) >= 1) return 0;
      const rx = x0 - A[0] - B[0] * B[2] * dt, rz = z0 - A[1] - B[1] * B[2] * dt;
      const ua = (rx * B[0] + rz * B[1]) * C[0], uc = (rz * B[0] - rx * B[1]) * C[1];
      const q = [1 - ua * ua, 1 - uc * uc, 1 - ut * ut]; if (q[0] <= 0 || q[1] <= 0) return 0;
      return q[0] ** 3 * q[1] ** 3 * q[2] ** 3;
    };
    const rw = [win(0), win(1)], rq = [rw[0] * U.A[3], rw[1] * U.A[7]];
    let Px = x0, Pz = z0, Py = 0, eH = 0, s2 = 0, gx = 0, gz = 0, Tx = 0, Ty = 0, Tz = 0;
    W.comps.forEach((c, i) => {
      const a = [c.dx, c.dz, c.kRef ?? c.k, c.omegaEff ?? c.omega], b = [c.A * (c.curAmp ?? 1), c.Q, c.phase, c.omega], g = U.rg.subarray(4 * i);
      const th = a[2] * (a[0] * x0 + a[1] * z0) - a[3] * t + b[2], C = Math.cos(th), S = Math.sin(th);
      const P = b[0] + rw[0] * g[0] + rw[1] * g[2], Qc = rw[0] * g[1] + rw[1] * g[3];
      const Ph = b[1] * (b[0] + rq[0] * g[0] + rq[1] * g[2]), Qh = b[1] * (rq[0] * g[1] + rq[1] * g[3]);
      const w = [P * S + Qc * C, P * C - Qc * S, Ph * C - Qh * S, Ph * S + Qh * C];
      Px += a[0] * w[2]; Pz += a[1] * w[2]; Py += w[0]; eH += w[1]; s2 += b[1] * (w[1] * w[1] - w[0] * w[0]);
      gx += a[2] * a[0] * w[1]; gz += a[2] * a[1] * w[1]; Tx += a[2] * w[3] * a[0] * a[0]; Ty += a[2] * w[3] * a[0] * a[1]; Tz += a[2] * w[3] * a[1] * a[1];
    });
    // leanB
    const Ea = Math.sqrt(Py * Py + eH * eH), sst = (e0, e1, x) => { const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };
    const B = sst(br.S0, br.S1, br.kb * Ea);
    if (B > 0 && Py > 0) {
      const ie = 1 / (Ea + 1e-3), jd = 1 - (br.dx * br.dx * Tx + 2 * br.dx * br.dz * Ty + br.dz * br.dz * Tz);
      const c0 = br.L * B * 2 * Py * ie, Dl = c0 * (br.dx * gx + br.dz * gz), f = Dl < 0 ? Math.max(0, Math.min(1, (jd - 0.25) / -Dl)) : 1;
      const lam = br.L * B * Py * Py * ie * f; Px += br.dx * lam; Pz += br.dz * lam;
    }
    Py += W.k2 * (Py * Py - eH * eH + s2);
    return [Px, Py, Pz];
  };
  let worst = 0, n = 0, maxH = -1e9, leaned = 0; const o = {};
  const Lm = G * E.Tm * E.Tm / (2 * Math.PI);
  for (let x0 = -Lm; x0 < Lm; x0 += Lm / 97) for (let z0 = -Lm / 3; z0 < Lm / 3; z0 += Lm / 23) {
    const [Px, Py, Pz] = vert(x0, z0), s = W.sample(Px, Pz, t, o);
    worst = Math.max(worst, Math.abs(s.h - Py)); n++; maxH = Math.max(maxH, Py); if (s.brk > 0) leaned++;
  }
  console.log(`4. shader formula vs sample() in a rogue group (${U.list.length} drawn, crest ${E.crest.toFixed(1)} m, highest vertex ${maxH.toFixed(1)} m, ${leaned} of ${n} points breaking): worst |dh| ${(worst * 100).toFixed(2)} cm`);
  check(worst < 0.03, 'sample() and the drawn surface differ by more than 3 cm');
}

// ---- 5. boats
{
  // surfing: a Blackwatch running before an open-ocean gale, two reefs in, the helm holding the course; the
  // faces and the water's orbital motion drive it past its hull speed, 1.34 sqrt(LWL ft) = 5.6 kn
  for (const kt of [40, 60]) {
    const env = openSea(kt), b = new Boat('blackwatch', { sailModel: 'strip' });
    b.reset(0, 0, 180 * DEG); b.u = 2; b.ctrl.reef = 2; b.reefPos = 2;
    for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0); b.psi = Math.PI; b.r = 0; }
    const dt = 1 / 120; let umax = 0, rollMax = 0, pitchMin = 0, t = 0, bad = false, brk = 0;
    for (; t < (quick ? 150 : 400); t += dt) {
      autoTrim(b, dt); b.ctrl.helm = Math.max(-1, Math.min(1, -1.5 * (wrap(b.psi - Math.PI) + 0.8 * b.r)));
      b.step(dt, env, t); env.tick(t);
      if (t > 20) { umax = Math.max(umax, b.u); rollMax = Math.max(rollMax, Math.abs(b.phi)); pitchMin = Math.min(pitchMin, b.pitch); brk = Math.max(brk, b.diag.brkF); }
      if (!isFinite(b.u + b.phi + b.heave + b.x)) { bad = true; break; }
    }
    const hs = 1.34 * Math.sqrt(CLASSES.blackwatch.lwl / 0.3048);
    console.log(`5. Blackwatch running before ${kt} kn (Hs ${env.waves.Hs.toFixed(1)} m): top speed ${(umax / KT).toFixed(1)} kn (hull speed ${hs.toFixed(1)}), max roll ${(rollMax / DEG).toFixed(0)} deg, bow down to ${(pitchMin / DEG).toFixed(0)} deg, breaking-crest load up to ${(brk / 1000).toFixed(1)} kN`);
    check(!bad, 'NaN');
    check(umax / KT > 1.2 * hs, 'never surfed past hull speed');
  }
}
console.log(fail ? `FAIL (${fail})` : 'ok');
process.exit(fail ? 1 : 0);
