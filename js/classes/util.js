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
