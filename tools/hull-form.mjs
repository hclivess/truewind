// Form parameters of each class's drawn hull, and Holtrop & Mennen's wave-making resistance from them:
//   node tools/hull-form.mjs [class...]
// The drawn hull (js/hull.js: its sections are the hydrostatics) gives what a resistance regression needs: waterline
// length and beam, canoe-body draft, displacement, the midship, prismatic and waterplane coefficients, the
// longitudinal centre of buoyancy, the half angle of entrance and the immersed transom. Holtrop & Mennen's regression
// (Holtrop 1984, "A statistical re-analysis of resistance and propulsion data", Int. Shipbuilding Progress 31; the
// low-speed formula, Fn <= 0.4) turns them into Rw / W.
// A diagnostic, not part of the physics. Scaling a calibrated reference's table by Holtrop's ratio (formRr) was tried
// for the full-keel double-enders and does not hold for yachts: for the Blackwatch it predicts Rr/W 0.013 at Fn 0.4
// against the 0.031 its towing-tank table gives, and it rates the Westsail's blunt entrance (half angle 40 deg) as
// costlier than the table does, the opposite of the gap it was meant to close. Ship regressions have no yacht in them
// with a Westsail's slenderness and entrance; the residuary tables in js/util.js stay the physics.
import { CLASSES } from '../js/physics.js';
import { HullHydro, linesFor, calibrate } from '../js/hull.js';

const G = 9.81;
// form parameters from the drawn hull at rest
export function hullForm(C) {
  calibrate(C);
  const h = new HullHydro(C), Lx = linesFor(C), st = h.stations, V = h.restV;
  const dx = st[1].x - st[0].x, far = () => -1e3;
  let Ax = 0, Aw = 0, Mx = 0, xs = [], ys = [], AT = 0;
  const wl = h.waterline(0, 0, 0, () => 0, () => 0);
  for (let i = 0; i < st.length; i++) {
    const xi = st[i].x;
    const r = h.immerse(0, 0, 0, (x) => (Math.abs(x - xi) < dx / 2 ? 0 : -1e3), () => 0, {});
    const A = r.V / dx; if (A > Ax) Ax = A;
    let yb = 0; const p = wl[i].pts; for (let k = 0; k < p.length; k += 2) yb = Math.max(yb, Math.abs(p[k]));
    if (A > 1e-5) { xs.push(xi); ys.push(yb); Aw += 2 * yb * dx; Mx += A * dx * xi; }
    if (i === 0) AT = A;
  }
  const L = Math.max(0.3, h.restLwl), B = 2 * Math.max(...ys);
  let Tc = 0; for (let t = 0; t <= 1; t += 0.01) Tc = Math.max(Tc, -Lx.keelZ(t));
  const xf = Math.max(...xs), xa = Math.min(...xs), xm = (xf + xa) / 2;
  // half angle of entrance: the waterline's slope over the forward tenth of its length
  let iE = 20;
  { const n = xs.length, k = Math.max(1, Math.round(n * 0.1)), yk = ys[n - 1 - k], dxk = xs[n - 1] - xs[n - 1 - k] + dx / 2;
    iE = Math.atan2(Math.max(1e-3, yk - ys[n - 1] * 0.3), dxk) * 180 / Math.PI; }
  const Cm = Math.min(0.98, Ax / Math.max(1e-6, B * Tc)), Cp = Math.min(0.85, V / Math.max(1e-6, Ax * L));
  return { L, B, T: Tc, V, Cm, Cp, Cwp: Aw / (L * B), lcb: 100 * (Mx / V - xm) / L, iE, AT: AT * (xs[0] <= st[0].x + 1e-6 ? 1 : 0) };
}
// Holtrop & Mennen's wave-making resistance / weight at Froude number Fn (low-speed formula)
export function holtropRw(f, Fn) {
  const { L, B, T, V, Cm, Cp } = f, BL = B / L, LB = L / B;
  const c7 = BL < 0.11 ? 0.229577 * BL ** 0.33333 : BL < 0.25 ? BL : 0.5 - 0.0625 * LB;
  const iE = Math.min(89, Math.max(1, f.iE));
  const c1 = 2223105 * c7 ** 3.78613 * (T / B) ** 1.07961 * (90 - iE) ** -1.37565;
  const c5 = Math.max(0.2, 1 - 0.8 * f.AT / (B * T * Cm));
  const L3V = L ** 3 / V;
  const c15 = L3V < 512 ? -1.69385 : L3V < 1726.91 ? -1.69385 + (L / V ** (1 / 3) - 8) / 2.36 : 0;
  const c16 = Cp < 0.8 ? 8.07981 * Cp - 13.8673 * Cp * Cp + 6.984388 * Cp ** 3 : 1.73014 - 0.7067 * Cp;
  const m1 = 0.0140407 * L / T - 1.75254 * V ** (1 / 3) / L - 4.79323 * BL - c16;
  const m4 = c15 * 0.4 * Math.exp(-0.034 * Fn ** -3.29);
  const lam = LB < 12 ? 1.446 * Cp - 0.03 * LB : 1.446 * Cp - 0.36;
  return c1 * c5 * Math.exp(m1 * Fn ** -0.9 + m4 * Math.cos(lam * Fn ** -2));
}
// a class's residuary table from a reference class's (both carry lines): the reference's table times the form ratio
export function formRr(C, ref, { fnMax = 0.42 } = {}) {
  const fc = hullForm(C), fr = hullForm(ref);
  const ratio = (fn) => { const x = Math.min(fn, fnMax); return holtropRw(fc, x) / holtropRw(fr, x); };
  const out = ref.rr.map(([fn, r]) => [fn, Math.round(r * ratio(Math.max(fn, 0.2)) * 1e5) / 1e5]);
  out.form = fc; out.refForm = fr;
  return out;
}

// CLI: the form of each class (default: every class with lines) and Holtrop's Rw / W at three speeds
if (process.argv[1] && process.argv[1].endsWith('hull-form.mjs')) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLASSES);
  for (const id of ids) {
    const C = CLASSES[id]; if (!C) { console.log(id, 'no such class'); continue; }
    try {
      const f = hullForm(C), r = (fn) => holtropRw(f, fn).toFixed(4);
      console.log(id.padEnd(12), `L ${f.L.toFixed(2)} B ${f.B.toFixed(2)} T ${f.T.toFixed(2)} V ${f.V.toFixed(2)} Cm ${f.Cm.toFixed(2)} Cp ${f.Cp.toFixed(3)} Cwp ${f.Cwp.toFixed(2)} lcb ${f.lcb.toFixed(1)}% iE ${f.iE.toFixed(0)} AT ${f.AT.toFixed(2)}  Rw/W(Holtrop) Fn.3 ${r(0.3)} Fn.35 ${r(0.35)} Fn.4 ${r(0.4)}`);
    } catch (e) { console.log(id.padEnd(12), 'skipped:', e.message); }
  }
}
