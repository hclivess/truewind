// Helpers the class files share: residuary resistance from the hull's slenderness, and the mass properties of a
// hull + ballast + rig from its parts. Plain numbers only (no three.js, no physics import: physics.js imports the
// classes).
export const DEG = Math.PI / 180;
export const FT = 0.3048, LB = 0.45359237, SQFT = 0.09290304, HP = 0.7457;

// Residuary resistance / weight against Froude number for a displacement keelboat, from its slenderness
// L / vol^(1/3) (sailing length over the cube root of the displaced volume, crew in). Two references: the J/70-like
// sportboat's calibrated table (L/vol^(1/3) 5.93, ORC certificate), and a heavy displacement cruiser at slenderness
// 4.0, whose table is the Blackwatch 19/24's (a short, full-ended long-keeler) scaled to 0.55 of it below Fn 0.35,
// calibrated on the Westsail 32's and the Catalina 30's US PHRF ratings (README), and all of it from Fn 0.45: the
// hull-speed wall a heavy displacement hull does not sail through. Others are
// interpolated between the two in log space, in log slenderness (the Delft series' Rr/W at a given Fn goes about
// as a power of it: Keuning & Sonnenberg 1998 fig. 3), and extrapolated a little on the heavy side.
// prism: prismatic coefficient correction (> 0 a high prismatic, full ends: dearer below Fn 0.33, cheaper near
// hull speed; < 0 fine ends); planing: 0 a pure displacement hull (Rr/W keeps rising past Fn 0.5), 1 the
// sportboat's planing run.
const RR_HEAVY = [[0.1, 0.0002], [0.15, 0.0006], [0.2, 0.0016], [0.25, 0.0035], [0.3, 0.0072], [0.35, 0.0145], [0.4, 0.031],
  [0.45, 0.058], [0.5, 0.085], [0.55, 0.101], [0.6, 0.11], [0.7, 0.12], [0.8, 0.125], [1.0, 0.13], [1.5, 0.14]]
  .map(([f, r]) => [f, r * (0.55 + 0.45 * Math.min(1, Math.max(0, (f - 0.35) / 0.1)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (f - 0.35) / 0.1))))]);
const RR_LIGHT = [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0009], [0.25, 0.0018], [0.3, 0.0035], [0.35, 0.0065], [0.4, 0.013],
  [0.45, 0.027], [0.5, 0.044], [0.55, 0.057], [0.6, 0.066], [0.7, 0.072], [0.8, 0.071], [1.0, 0.066], [1.5, 0.069]];
// the Laser-like dinghy's (its slenderness 7.4): a planing dinghy hull, for the centreboarders and board boats
const RR_DINGHY = [[0.1, 0.0001], [0.15, 0.0005], [0.2, 0.0012], [0.25, 0.0027], [0.3, 0.0055], [0.35, 0.011], [0.4, 0.021],
  [0.45, 0.035], [0.5, 0.048], [0.55, 0.055], [0.6, 0.057], [0.7, 0.055], [0.8, 0.052], [1.0, 0.049], [1.2, 0.05], [1.5, 0.056]];
const at = (tab, x) => { for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tab[tab.length - 1][1]; };
export function rrTable(lwl, massKg, { planing = 0, prism = 0, dinghy = false, k = 1 } = {}) {
  const s = lwl / Math.cbrt(massKg / 1025);
  // a dinghy hull: the dinghy's table, scaled as slenderness squared (a fuller, heavier-for-its-length hull makes
  // more wave per tonne: Rr/W ~ (vol^(1/3) / L)^2 near the hump)
  // (k: a hull's own factor on that, where its shape is known to be fuller or finer than the reference's)
  if (dinghy) return RR_DINGHY.map(([fn, r]) => [fn, Math.round(k * r * (7.4 / s) ** 2 * 1e5) / 1e5]);
  // (no lighter than the sportboat's: beyond it there is nothing to calibrate against)
  const w = Math.max(0, Math.min(1.6, Math.log(5.93 / s) / Math.log(5.93 / 4.0)));
  return RR_HEAVY.map(([fn]) => {
    let r = Math.exp(w * Math.log(at(RR_HEAVY, fn)) + (1 - w) * Math.log(at(RR_LIGHT, fn)));
    // a displacement hull does not come over its hump: past Fn 0.55 it keeps the heavy table's shape
    if (fn > 0.55 && planing < 1) { const r55 = Math.exp(w * Math.log(at(RR_HEAVY, 0.55)) + (1 - w) * Math.log(at(RR_LIGHT, 0.55))); r = r * planing + (1 - planing) * r55 * at(RR_HEAVY, fn) / at(RR_HEAVY, 0.55); }
    // prismatic: a high Cp (full ends) is cheaper near hull speed, dearer below it (Larsson & Eliasson ch. 5)
    if (prism) r *= 1 - prism * Math.max(-1, Math.min(1, (fn - 0.33) / 0.12));
    return [fn, Math.round(r * 1e5) / 1e5];
  });
}

// Over the hump: the tables above are calibrated where the boats sail in 12 kn (Fn <= ~0.45, ORC, PHRF and Portsmouth
// numbers); past it they were drawn by hand, and flattened out (the keelboats at Rr/W 0.07-0.08 from Fn 0.6, the
// dinghies falling from 0.057 at Fn 0.6) as if every hull planed. The Delft series (Keuning & Katgert 2008, bare hull,
// Fn 0.1-0.7; friction on the static wetted area, ITTC-57) keeps them climbing: on the Blackwatch's lines it gives her
// towing-tank table to 8%, and on the Laser's the tank tests of Day & Nixon (2014: Rr/W 0.056 at Fn 0.55, 0.070 at
// 0.63, 0.084 at 0.76) within 10%; a J/24 or a Star sits at Rr/W ~0.12 by Fn 0.6, twice their old tables. So above the
// hump each class takes the Delft resistance of its own drawn hull (js/hull.js hullForm): blended in from Fn 0.42 to
// 0.52, never below its own table. Past Fn 0.7 (the series' end) a displacement hull keeps climbing slowly (the heavy
// table's wall: +8% by Fn 1.0), a planing hull (planing 1) rides up on its run and sheds wave resistance (Savitsky: a
// dinghy at Fn 1.3 has Rr/W ~ tan trim ~ 0.06, 0.75 of the hump); planing 0..1 blends the two.
const DELFT_FN = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const DELFT_A = [   // a0..a7 (Keuning & Katgert 2008, table 3)
  [-0.0005, -0.0003, -0.0002, -0.0009, -0.0026, -0.0064, -0.0218, -0.0388, -0.0347, -0.0361, 0.0008, 0.0108, 0.1023],
  [0.0023, 0.0059, -0.0156, 0.0016, -0.0567, -0.4034, -0.5261, -0.5986, -0.4764, 0.0037, 0.3728, -0.1238, 0.7726],
  [-0.0086, -0.0064, 0.0031, 0.0337, 0.0446, -0.1250, -0.2945, -0.3038, -0.2361, -0.2960, -0.3667, -0.2026, 0.5040],
  [-0.0015, 0.0070, -0.0021, -0.0285, -0.1091, 0.0273, 0.2485, 0.6033, 0.8762, 0.9661, 1.3957, 1.1282, 1.7867],
  [0.0061, 0.0014, -0.0070, -0.0367, -0.0707, -0.1341, -0.2428, -0.0430, 0.4219, 0.6123, 1.0343, 1.1836, 2.1934],
  [0.0010, 0.0013, 0.0148, 0.0218, 0.0914, 0.3578, 0.6293, 0.8332, 0.8990, 0.7534, 0.3230, 0.4973, -1.5479],
  [0.0001, 0.0005, 0.0010, 0.0015, 0.0021, 0.0045, 0.0081, 0.0106, 0.0096, 0.0100, 0.0072, 0.0038, -0.0115],
  [0.0052, -0.0020, -0.0043, -0.0172, -0.0078, 0.1115, 0.2086, 0.1336, -0.2272, -0.3352, -0.4632, -0.4477, -0.0977]];
// Rr / (rho g vol) of a canoe body at DELFT_FN[i]. f: { L, B, T, V, Aw, lcb, lcf (fractions of L from the bow), Cp, Cm },
// held where the series' hulls are (Cp 0.52-0.60, Cm 0.65-0.78, B/T 2.5-12; LCB 2-6% aft of midships and the LCF 3%
// behind it: the drawn lines are not faired to that precision, and the regression's top rows swing on them)
export function delftRr(f, i) {
  const c = (x, a, b) => Math.min(b, Math.max(a, x));
  const Cp = c(f.Cp, 0.52, 0.6), Cm = c(f.Cm, 0.65, 0.78), lcb = c(f.lcb, 0.52, 0.56), lcf = lcb + 0.03, BT = c(f.B / f.T, 2.5, 12);
  const V3 = Math.cbrt(f.V), a = (k) => DELFT_A[k][i];
  return a(0) + (a(1) * lcb + a(2) * Cp + a(3) * V3 * V3 / f.Aw + a(4) * f.B / f.L + a(5) * lcb / lcf + a(6) * BT + a(7) * Cm) * V3 / f.L;
}
const RR_OVER = [[0.7, 1], [0.8, 1.042], [1.0, 1.083], [1.5, 1.167]];          // the heavy table past Fn 0.7, / its 0.7 value
const RR_PLANE = [[0.7, 1], [0.8, 1.05], [0.9, 1.02], [1.0, 0.95], [1.2, 0.82], [1.5, 0.75]];
export function rrOverHump(tab, f, planing = 0) {
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const d = DELFT_FN.map((_, i) => Math.max(0, delftRr(f, i))), d7 = d[d.length - 1];
  const hi = (fn) => fn <= 0.7 ? at(DELFT_FN.map((x, i) => [x, d[i]]), fn) : d7 * (at(RR_OVER, fn) * (1 - planing) + at(RR_PLANE, fn) * planing);
  const fns = [...new Set([...tab.map((r) => r[0]), 0.42, 0.45, 0.5, 0.52, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5])].sort((a, b) => a - b);
  return fns.map((fn) => { const r = at(tab, fn); return [fn, Math.round((r + (Math.max(r, hi(fn)) - r) * sstep(0.42, 0.52, fn)) * 1e5) / 1e5]; });
}

// centre of gravity height (m, + above the DWL) and roll / yaw inertia (kg m^2) of hull + ballast + rig:
// parts [{ m, z, ry, rx, rz }]: z of each part's centre, r* its radius of gyration about it across, along, up
export function massProps(parts) {
  let M = 0, Mz = 0;
  for (const p of parts) { M += p.m; Mz += p.m * p.z; }
  const zG = Mz / M;
  let Ixx = 0, Izz = 0;
  for (const p of parts) { Ixx += p.m * ((p.z - zG) ** 2 + (p.ry ?? 0) ** 2 + (p.rz ?? 0) ** 2); Izz += p.m * ((p.rx ?? 0) ** 2 + (p.ry ?? 0) ** 2); }
  return { M, zG, Ixx, Izz };
}
