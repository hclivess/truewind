// Helpers the class files share: residuary resistance from the hull's slenderness, and the mass properties of a
// hull + ballast + rig from its parts. Plain numbers only (no three.js, no physics import: physics.js imports the
// classes).
export const DEG = Math.PI / 180;
export const FT = 0.3048, LB = 0.45359237, SQFT = 0.09290304, HP = 0.7457;

// Residuary resistance / weight against Froude number for a displacement keelboat, from its slenderness
// L / vol^(1/3) (LWL over the cube root of the displaced volume, crew in). The two reference hulls are the ones the
// game already carries and has calibrated against real polars: the Blackwatch 19/24 and the J/70-like sportboat
// (L/vol^(1/3) 5.93). The Blackwatch's is a short, full-ended long-keeler (prismatic ~0.6, a bluff bow wave): its
// Rr/W is that of an average hull of slenderness ~4.3 (its own is 5.05), and it stands for that here. Others are
// interpolated between the two in log space, in log slenderness (the Delft series' Rr/W at a given Fn goes about
// as a power of it: Keuning & Sonnenberg 1998 fig. 3), and extrapolated a little either side. prism: prismatic coefficient correction (fine ends > 0.56 cost
// less at hull speed, full ends more); planing: 0 a pure displacement hull (Rr/W keeps rising past Fn 0.5), 1 the
// sportboat's planing run.
const RR_HEAVY = [[0.1, 0.0002], [0.15, 0.0006], [0.2, 0.0016], [0.25, 0.0035], [0.3, 0.0072], [0.35, 0.0145], [0.4, 0.031],
  [0.45, 0.058], [0.5, 0.085], [0.55, 0.101], [0.6, 0.11], [0.7, 0.12], [0.8, 0.125], [1.0, 0.13], [1.5, 0.14]];
const RR_LIGHT = [[0.1, 0.0001], [0.15, 0.0004], [0.2, 0.0009], [0.25, 0.0018], [0.3, 0.0035], [0.35, 0.0065], [0.4, 0.013],
  [0.45, 0.027], [0.5, 0.044], [0.55, 0.057], [0.6, 0.066], [0.7, 0.072], [0.8, 0.071], [1.0, 0.066], [1.5, 0.069]];
const at = (tab, x) => { for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return tab[tab.length - 1][1]; };
export function rrTable(lwl, massKg, { planing = 0, prism = 0 } = {}) {
  const s = lwl / Math.cbrt(massKg / 1025);
  const w = Math.max(-1, Math.min(1.6, Math.log(5.93 / s) / Math.log(5.93 / 4.3)));
  return RR_HEAVY.map(([fn]) => {
    let r = Math.exp(w * Math.log(at(RR_HEAVY, fn)) + (1 - w) * Math.log(at(RR_LIGHT, fn)));
    // a displacement hull does not come over its hump: past Fn 0.55 it keeps the heavy table's shape
    if (fn > 0.55 && planing < 1) { const r55 = Math.exp(w * Math.log(at(RR_HEAVY, 0.55)) + (1 - w) * Math.log(at(RR_LIGHT, 0.55))); r = r * planing + (1 - planing) * r55 * at(RR_HEAVY, fn) / at(RR_HEAVY, 0.55); }
    // prismatic: fine ends (high Cp) are cheaper near hull speed, dearer below it (Larsson & Eliasson ch. 5)
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
