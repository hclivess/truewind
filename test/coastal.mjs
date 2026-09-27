// Coastal waves (js/coastal.js and WaveField): refraction against Snell's law on a planar slope, shoaling against
// linear theory, depth-limited breaking, the lee of a semi-infinite breakwater against the Sommerfeld (Penney &
// Price) solution, the clapotis in front of a reflecting wall, sample() against the drawn waves, and a real venue's
// harbour and headlands. Run: node test/coastal.mjs [--gpu]   (--gpu: also the water shader in headless Chromium)
import { buildCoastal, coastalInput, CoastalField, dispK, groupSpeed } from '../js/coastal.js';
import { WaveField, Environment, BREAK_G, KT, DEG } from '../js/env.js';
import { VENUES, World } from '../js/world.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const G = 9.81, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
// a synthetic venue on the coastal grid: depth(x, z), signed distance to the obstacles sdf(x, z), wall kind
function synth({ M = 256, R = 1000, depth, sdf, kind = 0, comps, peN = 512 }) {
  const N = M * M, cs = 2 * R / M, d = new Float32Array(N), o = new Float32Array(N), b = new Uint8Array(N), c = new Uint8Array(N);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -R + (i + 0.5) * cs, z = -R + (j + 0.5) * cs, k = j * M + i, s = sdf(x, z);
    o[k] = s; b[k] = s < 0 ? 1 : 0; d[k] = s < 0 ? 0 : depth(x, z); c[k] = kind;
  }
  return { M, R, depth: d, osdf: o, blocked: b, bcls: c, comps, U: 10, Fref: 20000, Fedge: 25000, peN };
}
const swell = (T, ang) => { const w = 2 * Math.PI / T; return { w, dx: Math.cos(ang), dz: Math.sin(ang), sea: false }; };

// ---- 1, 2. a planar beach: 20 m at x = -1000 shoaling to the shore at x = +1000; 10 s swell
{
  const T = 10, w = 2 * Math.PI / T, h = (x) => Math.max(0.3, 20 - 19 * (x + 1000) / 2000);
  const cg0 = 0.5 * G / w;
  for (const a0 of [0, 30]) {
    const t0 = Date.now(), f = new CoastalField(buildCoastal(synth({ depth: (x) => h(x), sdf: () => 100, comps: [swell(T, rad(a0))] })));
    const ms = Date.now() - t0, k20 = dispK(w, 20);
    let worstA = 0, worstK = 0;
    for (const x of [-500, 0, 300, 600, 800, 900]) {
      f.at(x, 0).inc(0);
      const hh = h(x), k = dispK(w, hh), cg = groupSpeed(w, k, hh);
      const th = Math.asin(Math.sin(rad(a0)) * k20 / k);                  // Snell: k sin(theta) conserved
      const Kth = Math.sqrt(cg0 / cg) * Math.sqrt(Math.cos(rad(a0)) / Math.cos(th));   // shoaling x ray-tube width
      worstA = Math.max(worstA, Math.abs(deg(Math.atan2(f.gz, f.gx) - th)));
      worstK = Math.max(worstK, Math.abs(f.k / Kth - 1));
      if (x === 900) console.log(`     ${a0} deg: at h ${hh.toFixed(2)} m  theta ${deg(Math.atan2(f.gz, f.gx)).toFixed(2)} (Snell ${deg(th).toFixed(2)})  K ${f.k.toFixed(3)} (theory ${Kth.toFixed(3)})  |G| ${Math.hypot(f.gx, f.gz).toFixed(4)} (k ${k.toFixed(4)})  [${ms} ms]`);
    }
    if (a0) check(worstA < 0.5, `refraction on a planar slope, 30 deg incidence: wave direction within ${worstA.toFixed(2)} deg of Snell's law (< 0.5)`);
    check(worstK < 0.05, `${a0 ? 'oblique shoaling + refraction' : 'shoaling'}: K within ${(100 * worstK).toFixed(1)}% of ${a0 ? 'sqrt(cg0/cg) sqrt(cos a0 / cos a)' : 'Ks = sqrt(cg0/cg)'} (< 5%)`);
  }
}

// ---- 3. depth-limited breaking: a 2 m swell on the same beach, felt through WaveField.sample()
{
  const T = 10, w = 2 * Math.PI / T, h = (x) => Math.max(0.3, 20 - 19 * (x + 1000) / 2000);
  const W = new WaveField({ tws: 0.5, swellH: 0.01 });
  W.comps = [{ A: 1.0, Aswell: 1.0, k: w * w / G, kRef: w * w / G, omega: w, dx: 1, dz: 0, phase: 0.3, Q: 0.6, kind: 'swell' }];
  W.k2 = 0; W.depthFn = (x) => h(x);
  W.setCoastal(new CoastalField(buildCoastal(synth({ depth: (x) => h(x), sdf: () => 100, comps: [swell(T, 0)] }))));
  const rows = [];
  let surf = [], off = null;
  for (const x of [-800, 0, 500, 700, 800, 850, 900, 950]) {
    let hi = -Infinity, lo = Infinity, brk = 0;
    for (let t = 0; t < T; t += T / 80) { const s = W.sample(x, 0, t, {}); hi = Math.max(hi, s.h); lo = Math.min(lo, s.h); brk = Math.max(brk, s.breaking); }
    const H = hi - lo, hh = h(x), Hun = 2 * 1.0 * W.coastal.at(x, 0).inc(0).k;
    rows.push(`x ${x}: h ${hh.toFixed(1)} H ${H.toFixed(2)} (unbroken ${Hun.toFixed(2)}) H/h ${(H / hh).toFixed(2)} brk ${brk.toFixed(2)}`);
    if (Hun > 1.3 * BREAK_G * hh) surf.push(H / hh);
    if (x === -800) off = H / Hun;
  }
  console.log('     ' + rows.join('\n     '));
  check(Math.abs(off - 1) < 0.03, `offshore the height is the shoaled wave (${off.toFixed(3)} of it)`);
  check(surf.length >= 2 && surf.every(r => Math.abs(r - BREAK_G) < 0.06), `in the surf zone H/h = ${surf.map(r => r.toFixed(2)).join(', ')} (breaking index ${BREAK_G})`);
}

// ---- 4. semi-infinite breakwater: normal incidence, deep water, lambda 60 m; the lee against Penney & Price
// (Sommerfeld's rigid half-plane, Born & Wolf 11.5)
function fresnelTail(x) {                     // int_x^inf e^{i mu^2} dmu
  let re = 0, im = 0; const n = Math.max(400, Math.ceil(Math.abs(x) * 600)), hs = x / n;
  for (let i = 0; i <= n; i++) { const m = i * hs, wt = (i === 0 || i === n) ? 0.5 : 1; re += wt * Math.cos(m * m) * hs; im += wt * Math.sin(m * m) * hs; }
  const c = Math.sqrt(Math.PI / 2) / 2; return [c - re, c - im];
}
function sommerfeld(kr, th, a) {
  const cm = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]], ex = (p) => [Math.cos(p), Math.sin(p)];
  const t1 = cm(ex(-kr * Math.cos(th - a)), fresnelTail(-Math.sqrt(2 * kr) * Math.cos((th - a) / 2)));
  const t2 = cm(ex(-kr * Math.cos(th + a)), fresnelTail(-Math.sqrt(2 * kr) * Math.cos((th + a) / 2)));
  return Math.hypot(t1[0] + t2[0], t1[1] + t2[1]) / Math.sqrt(Math.PI);
}
{
  const L = 60, k = 2 * Math.PI / L, w = Math.sqrt(G * k);
  // breakwater 12 m wide along z = 0 for x < 0 (its head at the origin); waves travel toward +z
  const f = new CoastalField(buildCoastal(synth({ depth: () => 200, sdf: (x, z) => x < -6 ? Math.abs(z) - 6 : Math.hypot(x + 6, z) - 6, kind: 1, comps: [{ w, dx: 0, dz: 1, sea: false }] })));
  const at = (rl, b) => { const r = rl * L, x = -r * Math.sin(rad(b)), z = r * Math.cos(rad(b)); f.at(x, z).inc(0); return [f.k, sommerfeld(k * r, (Math.atan2(-z, -x) + 2 * Math.PI) % (2 * Math.PI), Math.PI / 2)]; };
  const rows = [];
  for (const rl of [2, 5, 8]) rows.push(`r ${rl} L: ` + [-30, 0, 15, 30, 45, 60, 88].map(b => { const [m, s] = at(rl, b); return `${b}:${m.toFixed(2)}/${s.toFixed(2)}`; }).join(' '));
  console.log('     (beta into the lee: model/Penney-Price)\n     ' + rows.join('\n     '));
  const [m45, s45] = at(5, 45), [m90, s90] = at(5, 88), [m0] = at(5, 0), [mL] = at(5, -30);
  check(Math.abs(m45 - s45) < 0.1, `lee of a breakwater, 45 deg in, 5 wavelengths from its head: K ${m45.toFixed(3)} vs Penney-Price ${s45.toFixed(3)} (within 0.1)`);
  check(Math.abs(m90 - s90) < 0.1, `lee of a breakwater, 90 deg in (behind the wall), 5 wavelengths: K ${m90.toFixed(3)} vs Penney-Price ${s90.toFixed(3)} (within 0.1)`);
  check(Math.abs(m0 - 0.5) < 0.08 && mL > 0.85, `shadow line K ${m0.toFixed(2)} (~1/2), open water beside it ${mL.toFixed(2)}`);
}

// ---- 5. a vertical wall (R 0.9) across the waves: partial standing wave, antinode on the wall
{
  const L = 80, k = 2 * Math.PI / L, w = Math.sqrt(G * k), xw = 400;
  const f = new CoastalField(buildCoastal(synth({ depth: () => 100, sdf: (x) => xw - x, kind: 2, comps: [{ w, dx: 1, dz: 0, sea: false }], peN: 256 })));
  let amax = 0, amin = Infinity, Ki = 0, Kr = 0, xa = 0;
  for (let x = xw - 1.5 * L; x < xw - 0.3 * L; x += L / 64) {
    f.at(x, 0).inc(0); const ki = f.k, pi = f.p; let kr = 0, pr = 0; if (f.ref(0)) { kr = f.k; pr = f.p; }
    const env = Math.hypot(ki * Math.cos(pi) + kr * Math.cos(pr), ki * Math.sin(pi) + kr * Math.sin(pr));
    if (env > amax) { amax = env; xa = x; Ki = ki; Kr = kr; } amin = Math.min(amin, env);
  }
  const R = Kr / Ki, dxa = ((xw - xa) % (L / 2) + L / 2) % (L / 2);
  check(Math.abs(R - 0.9) < 0.05, `reflected amplitude off a vertical wall ${R.toFixed(3)} of the incident (R 0.9)`);
  check(Math.abs(amax / Ki - (1 + R)) < 0.03 && Math.abs(amin / Ki - (1 - R)) < 0.05, `clapotis: antinodes ${(amax / Ki).toFixed(3)} (1+R = ${(1 + R).toFixed(3)}), nodes ${(amin / Ki).toFixed(3)} (1-R) x the incident`);
  check(Math.min(dxa, L / 2 - dxa) < L / 16, `antinodes every half wavelength from the wall face (offset ${Math.min(dxa, L / 2 - dxa).toFixed(1)} m)`);
}

// ---- 6. a real venue: Marseille in a WSW swell and the mistral
const world = new World(VENUES.find(v => v.id === 'marseille'), JSON.parse(readFileSync('data/venues/marseille.json')));
const env = new Environment({ tws: 20 * KT, twd: 315, fetchKm: 25, swellH: 2.5, swellT: 10, weather: 'steady', seed: 7 });
env.waves.set({ ...env.waves.opts, swellDir: 250 * DEG }); env.waves.update(0);
env.waves.buildDepthField(world);
const t0 = Date.now(), out = buildCoastal(coastalInput(world, JSON.parse(readFileSync('data/venues/marseille.json')), env.waves, { U: 20 * KT }));
const buildMs = Date.now() - t0;
const cf = new CoastalField(out);
env.waves.setCoastal(cf);
{
  const sw = env.waves.comps.findIndex(c => c.kind === 'swell');
  const K = (x, z) => cf.at(x, z).inc(sw).k;
  // open water to the WSW; the Vieux-Port basin (behind its narrow western entrance); the lee of the Frioul islands
  const open = K(-4500, 1500), port = K(3240, -2775), lee = K(-800, -1750);
  console.log(`     build ${buildMs} ms (${JSON.stringify(out.tm)}), ${out.nr} reflected layers; swell K: open ${open.toFixed(2)}, Vieux-Port ${port.toFixed(2)}, lee of Frioul ${lee.toFixed(2)}`);
  check(open > 0.8 && port < 0.25 && lee < 0.6, `Marseille in a WSW swell: open water K ${open.toFixed(2)}, inside the Vieux-Port ${port.toFixed(2)}, lee of the Frioul islands ${lee.toFixed(2)}`);
  // sample() inside the port is flat, outside it is the full sea
  let hp = 0, ho = 0;
  for (let t = 0; t < 30; t += 0.25) { hp = Math.max(hp, Math.abs(env.waves.sample(3240, -2775, t, {}).h)); ho = Math.max(ho, Math.abs(env.waves.sample(-4500, 1500, t, {}).h)); }
  check(hp < 0.25 * ho, `the hull feels it: max |eta| ${hp.toFixed(2)} m in the port against ${ho.toFixed(2)} m outside`);
}

// ---- 7. sample() is the drawn surface: the vertex displacement the shader computes from the same texture data
// (a transcription of the GLSL in render.js), pushed back through sample() at the displaced point
{
  const W = env.waves; let worst = 0;
  const pts = [[-4500, 1500], [-800, -1750], [1500, -1300], [2300, 200], [3240, -2775], [-1200, 2500]];
  for (const [x0, z0] of pts) for (let t = 3; t < 60; t += 7.7) {
    const L = W._local(x0, z0), h = W.depthFn(x0, z0);
    let X = 0, Z = 0, Y = 0, eH = 0, sK = 0, s2 = 0;
    for (let i = 0; i < L.n; i++) {
      const th = L.p[i] + L.gx[i] * x0 + L.gz[i] * z0 - L.we[i] * t, C = Math.cos(th), S = Math.sin(th), A = L.A[i];
      X += L.Q[i] * A * L.ux[i] * C; Z += L.Q[i] * A * L.uz[i] * C; Y += A * S; eH += A * C; sK += L.Q[i] * L.k[i] * A; s2 += L.Q[i] * A * A * (C * C - S * S);
    }
    W._limits(h, Y, eH, sK);
    const cap = W._cap, qs = W._qs, py = cap * Y + W.k2 * cap * cap * (Y * Y - eH * eH + qs * s2);
    const s = W.sample(x0 + cap * qs * X, z0 + cap * qs * Z, t, {});
    worst = Math.max(worst, Math.abs(s.h - py));
  }
  check(worst < 2e-3, `sample() at the displaced point returns the drawn vertex height (worst ${(worst * 1000).toFixed(2)} mm)`);
}

if (process.argv.includes('--gpu')) {
  const { gpuCheck } = await import('../tools/verify-coastal.mjs');
  const r = await gpuCheck();
  check(r.ok, `GPU: the water vertex shader against sample() at ${r.n} vertices, worst ${r.worst.toFixed(3)} m`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
