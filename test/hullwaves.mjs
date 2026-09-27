// Hull waves (js/hullwaves.js): the CPU reference of the GPU solver, a real hull (the sportboat's sections)
// towed at constant speed on the scrolling grid. Checks: the GPU's Stockham FFT pass against a plain DFT;
// a hull at rest leaves the water flat; the Kelvin pattern at Froude numbers 0.2-0.4 — the transverse
// wavelength on the track against 2 pi U^2 / g (within 10 %) and the cusp line (where the divergent and
// transverse waves meet, the amplitude maximum across the wake) at 19.47 deg (within 2 deg); stability.
//   node test/hullwaves.mjs [cls] [Fn list]
import { Boat, CLASSES } from '../js/physics.js';
import { HullWaveSim, hullEntries, stockhamPass, kelvinPattern, HW } from '../js/hullwaves.js';
const G = 9.81;
const [cls = 'sportboat', fns = '0.2,0.3,0.4'] = process.argv.slice(2);
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };

// ---- the GPU FFT pass (Stockham radix-2) against a DFT
{
  const N = 16; let a = new Float64Array(N * N * 4).map((_, i) => Math.sin(i * 12.9898) * 0.5), b = new Float64Array(N * N * 4);
  const a0 = a.slice();
  for (const horiz of [true, false]) for (let sub = 2; sub <= N; sub *= 2) { stockhamPass(a, b, N, sub, horiz, -1); [a, b] = [b, a]; }
  let err = 0;
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) for (let c = 0; c < 2; c++) {
    let sr = 0, si = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = (y * N + x) * 4 + 2 * c, th = -2 * Math.PI * (u * x + v * y) / N; sr += a0[o] * Math.cos(th) - a0[o + 1] * Math.sin(th); si += a0[o] * Math.sin(th) + a0[o + 1] * Math.cos(th); }
    const o = (v * N + u) * 4 + 2 * c; err = Math.max(err, Math.abs(a[o] - sr), Math.abs(a[o + 1] - si));
  }
  check(err < 1e-9, `Stockham FFT pass = DFT (max error ${err.toExponential(1)})`);
}
// ---- the ?q=low table radiates downstream only
{
  const K = kelvinPattern(); let up = 0, dn = 0;
  for (let j = 0; j < K.n; j++) for (let i = 0; i < K.n; i++) { const X = K.X0 + i * K.d, h = K.data[(j * K.n + i) * 4]; if (X > 1) up += h * h; if (X < -1) dn += h * h; }
  check(up < 1e-3 * dn, `analytic Kelvin table: energy ahead / behind ${(up / dn).toExponential(1)}`);
}

// bilinear h + q in world coordinates
function sampler(sim) {
  const N = sim.N, dx = sim.dx;
  return (x, z) => {
    const fi = x / dx - sim.ci + N / 2 - 0.5, fj = z / dx - sim.cj + N / 2 - 0.5;
    const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, c = fj - j;
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return 0;
    return (sim.hd(i, j) * (1 - a) + sim.hd(i + 1, j) * a) * (1 - c) + (sim.hd(i, j + 1) * (1 - a) + sim.hd(i + 1, j + 1) * a) * c;
  };
}
// the grid: ~12 cells a transverse wavelength, long enough for the hull and K wavelengths of wake behind it.
// The boat runs at U from the start and its pressure grows in over 8 wave periods (a speed ramp would leave
// a start-up ring spreading through the wake); the run lasts until the steady pattern (its energy trails at
// U/2) reaches K wavelengths aft.
function tow(C, U, opts) {
  const lam = 2 * Math.PI * U * U / G, K = opts.K ?? 10, N = opts.N ?? 256, dx = Math.min(0.5, lam / 12, (C.loa + K * lam + 2) / 0.6 / N), Ld = N * dx;
  const sim = new HullWaveSim({ N, L: Ld });
  const b = new Boat(C); b.reset(0, 0, Math.PI / 2);                  // heading +x
  const ramp = U > 0 ? 8 * lam / U : 3, T = opts.T ?? (U > 0 ? ramp + (C.loa + K * lam) / (0.45 * U) : 20);
  const dt = Math.min(HW.maxDt, U > 0 ? dx / U : 0.05);
  let x = 0, t = 0, hmax = 0;
  while (t < T) {
    x += U * dt; t += dt;
    const f = Math.min(1, t / ramp), w = f * f * (3 - 2 * f);
    const list = hullEntries(b, { x, z: 0, psi: Math.PI / 2, heave: 0, pitch: 0, phi: 0 }, []);
    for (const e of list) for (let j = 0; j < HW.NS; j++) e.st[j * 4 + 2] *= w;
    sim.recentre(x - 0.28 * Ld, 0);
    sim.step(dt, list);
    for (let k = 0; k < sim.h.length; k += 97) hmax = Math.max(hmax, Math.abs(sim.h[k] + sim.q[k]));
  }
  return { sim, x, lam, dx, hmax, Ld, N, at: sampler(sim) };
}

// ---- at rest: flat (the head is exactly the hull's own depression)
{
  const C = CLASSES[cls];
  const r = tow(C, 0, { T: 10 });
  let m = 0; const at = r.at;
  for (let y = -6; y <= 6; y += 0.25) for (let X = -8; X <= 8; X += 0.25) if (Math.abs(y) > C.beam || Math.abs(X) > C.loa / 2 + 0.5) m = Math.max(m, Math.abs(at(r.x + X, y)));
  check(m < 0.004, `hull at rest: water outside the hull flat (max |h| ${(m * 1000).toFixed(1)} mm)`);
}

for (const Fn of fns.split(',').map(Number)) {
  const C = CLASSES[cls], U = Fn * Math.sqrt(G * C.lwl);
  const t0 = Date.now();
  // (at low Fn the hull is several wavelengths long: its divergent waves cancel along it and the cusp
  // only outgrows the transverse waves far aft, so the wake is followed further)
  const K = Fn < 0.25 ? 20 : 10, r = tow(C, U, Fn < 0.25 ? { K, N: 512 } : { K });
  const { at, lam, x } = r, bow = x + C.bowX;
  // transverse wavelength: up-crossings on the track behind the stern
  const xs = [], X0 = x + C.sternX - 0.5 * lam, X1 = bow - C.loa - (K - 1) * lam, step = lam / 64;
  let prev = at(X0, 0);
  for (let X = X0 - step; X > X1; X -= step) {
    const v = at(X, 0);
    if (prev < 0 && v >= 0) xs.push(X + step * v / (v - prev));      // (walking aft: crossing downward in X)
    prev = v;
  }
  const lamT = xs.length > 2 ? (xs[0] - xs[xs.length - 1]) / (xs.length - 1) : NaN;
  // the cusp: across the wake at each distance D behind the bow, the envelope (max over one wavelength
  // along, both sides added). The divergent and transverse waves meet in a caustic, across which the
  // envelope is an Airy function: its peak (Ai(-1.02)) lies inside the cusp line, which sits where the
  // envelope has fallen to Ai(0) / max Ai = 0.662 of the peak on the outer side. Both are fitted
  // y = a + D tan(angle) (a: the wedge starts from the whole hull, not a point), robustly.
  const pk = [], ca = [];
  // (from two wavelengths behind the stern: along the hull the bow and stern systems still overlap)
  for (let D = C.loa + (K > 10 ? 6 : 2) * lam; D <= C.loa + (K - 1) * lam; D += lam / 4) {
    const ys = [], es = [];
    for (let y = 0.1 * D; y <= 0.55 * D; y += lam / 48) {
      let e = 0;
      for (let s = -0.5; s <= 0.5; s += 1 / 24) e = Math.max(e, Math.abs(at(bow - D + s * lam, y)) + Math.abs(at(bow - D + s * lam, -y)));
      ys.push(y); es.push(e);
    }
    // the outermost envelope maximum that stands out (the cusp's), not the transverse waves' on the track
    let emax = 0; for (const e of es) emax = Math.max(emax, e);
    let by = 0; for (let i = 1; i < es.length - 1; i++) if (es[i] >= es[i - 1] && es[i] >= es[i + 1] && es[i] > 0.3 * emax) by = i;
    let yp = ys[by], ep = es[by];
    if (by > 0 && by < ys.length - 1) { const a = es[by - 1], b = es[by], c = es[by + 1], den = a - 2 * b + c; if (den < 0) { const o = 0.5 * (a - c) / den; yp += o * (ys[1] - ys[0]); ep = b - 0.25 * (a - c) * o; } }
    pk.push([D, yp]);
    for (let i = by; i < es.length - 1; i++) if (es[i + 1] < 0.662 * ep) { const f = (es[i] - 0.662 * ep) / (es[i] - es[i + 1]); ca.push([D, ys[i] + f * (ys[i + 1] - ys[i])]); break; }
  }
  // Theil-Sen: the median of the slopes between every pair of rows (a row that caught the wrong peak moves it little)
  const fit = (pts) => { const sl = []; for (let i = 0; i < pts.length; i++) for (let j = i + 4; j < pts.length; j++) sl.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0])); sl.sort((a, b) => a - b); return Math.atan(sl[sl.length >> 1]) * 180 / Math.PI; };
  const angP = fit(pk), ang = fit(ca);
  console.log(`Fn ${Fn.toFixed(2)}: U ${U.toFixed(2)} m/s (${(U / 0.5144).toFixed(1)} kn), grid ${r.dx.toFixed(3)} m x ${r.N} (${r.Ld.toFixed(0)} m), ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(Math.abs(lamT / lam - 1) < 0.1, `  transverse wavelength ${lamT.toFixed(3)} m vs 2 pi U^2/g ${lam.toFixed(3)} m (${((lamT / lam - 1) * 100).toFixed(1)} %, ${xs.length} crests)`);
  check(Math.abs(ang - 19.47) < 2, `  cusp line ${ang.toFixed(2)} deg (Kelvin 19.47; the amplitude peak inside it: ${angP.toFixed(2)} deg)`);
  check(isFinite(r.hmax) && r.hmax < 1.0, `  stable: max |h| ${r.hmax.toFixed(3)} m`);
}
process.exit(fail ? 1 : 0);
