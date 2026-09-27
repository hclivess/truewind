// Residuary resistance from the hull's own form. The drawn hull (js/hull.js: its sections are the hydrostatics) gives
// the form parameters a resistance regression needs: waterline length and beam, canoe-body draft, displacement, the
// midship and prismatic coefficients, the waterplane coefficient, the longitudinal centre of buoyancy, the half angle
// of entrance of the waterline and the immersed transom. Holtrop & Mennen's wave-making regression (Holtrop 1984,
// "A statistical re-analysis of resistance and propulsion data", Int. Shipbuilding Progress 31; the low-speed
// formula, Fn <= 0.4) turns those into Rw / W. It is a ship regression: its absolute level is not trusted for a
// yacht, but its dependence on form is. So a class's table is a calibrated reference hull's table, scaled at every
// Froude number by the ratio of Holtrop's Rw / W for the class's hull to Holtrop's for the reference's:
//   Rr/W(class, Fn) = Rr/W(ref, Fn) * H(class, Fn) / H(ref, Fn)
// Past Fn 0.42 the ratio is held (the regression's range ends; the reference's hump shape carries on).
import { HullHydro, linesFor, calibrate } from './hull.js';

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
