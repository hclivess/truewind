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
// with a Westsail's slenderness and entrance; the residuary tables in js/classes/util.js stay the physics below the hump,
// and over it the Delft yacht series on these same form parameters (rrOverHump).
import { CLASSES } from '../js/physics.js';
import { calibrate, hullForm as hullFormOf } from '../js/hull.js';

// form parameters from the drawn hull at rest (js/hull.js)
export function hullForm(C) { calibrate(C); return hullFormOf(C); }
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
