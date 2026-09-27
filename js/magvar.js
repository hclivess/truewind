// Magnetic variation: the World Magnetic Model 2025 (NOAA NCEI / BGS, valid 2025.0-2030.0; coefficients
// from WMM.COF, 90 Gauss coefficients to degree 12 with their secular variation). A real compass points to
// magnetic north, which is off true north by the declination: 0.8 E in the Solent (it swung east of true in the early 2020s), 12.9 E at San Francisco,
// 4.4 E at Kiel, 12.8 E at Sydney (2026). Pure function of (lat, lon, height, date); no three.js.
const EPOCH = 2025.0;
// n, m, g, h (nT), dg/dt, dh/dt (nT/yr)
const C = [
  1,0,-29351.8,0,12,0, 1,1,-1410.8,4545.4,9.7,-21.5, 2,0,-2556.6,0,-11.6,0, 2,1,2951.1,-3133.6,-5.2,-27.7,
  2,2,1649.3,-815.1,-8,-12.1, 3,0,1361,0,-1.3,0, 3,1,-2404.1,-56.6,-4.2,4, 3,2,1243.8,237.5,0.4,-0.3,
  3,3,453.6,-549.5,-15.6,-4.1, 4,0,895,0,-1.6,0, 4,1,799.5,278.6,-2.4,-1.1, 4,2,55.7,-133.9,-6,4.1,
  4,3,-281.1,212,5.6,1.6, 4,4,12.1,-375.6,-7,-4.4, 5,0,-233.2,0,0.6,0, 5,1,368.9,45.4,1.4,-0.5,
  5,2,187.2,220.2,0,2.2, 5,3,-138.7,-122.9,0.6,0.4, 5,4,-142,43,2.2,1.7, 5,5,20.9,106.1,0.9,1.9,
  6,0,64.4,0,-0.2,0, 6,1,63.8,-18.4,-0.4,0.3, 6,2,76.9,16.8,0.9,-1.6, 6,3,-115.7,48.8,1.2,-0.4,
  6,4,-40.9,-59.8,-0.9,0.9, 6,5,14.9,10.9,0.3,0.7, 6,6,-60.7,72.7,0.9,0.9, 7,0,79.5,0,-0,0,
  7,1,-77,-48.9,-0.1,0.6, 7,2,-8.8,-14.4,-0.1,0.5, 7,3,59.3,-1,0.5,-0.8, 7,4,15.8,23.4,-0.1,0,
  7,5,2.5,-7.4,-0.8,-1, 7,6,-11.1,-25.1,-0.8,0.6, 7,7,14.2,-2.3,0.8,-0.2, 8,0,23.2,0,-0.1,0,
  8,1,10.8,7.1,0.2,-0.2, 8,2,-17.5,-12.6,0,0.5, 8,3,2,11.4,0.5,-0.4, 8,4,-21.7,-9.7,-0.1,0.4,
  8,5,16.9,12.7,0.3,-0.5, 8,6,15,0.7,0.2,-0.6, 8,7,-16.8,-5.2,-0,0.3, 8,8,0.9,3.9,0.2,0.2,
  9,0,4.6,0,-0,0, 9,1,7.8,-24.8,-0.1,-0.3, 9,2,3,12.2,0.1,0.3, 9,3,-0.2,8.3,0.3,-0.3,
  9,4,-2.5,-3.3,-0.3,0.3, 9,5,-13.1,-5.2,0,0.2, 9,6,2.4,7.2,0.3,-0.1, 9,7,8.6,-0.6,-0.1,-0.2,
  9,8,-8.7,0.8,0.1,0.4, 9,9,-12.9,10,-0.1,0.1, 10,0,-1.3,0,0.1,0, 10,1,-6.4,3.3,0,0,
  10,2,0.2,0,0.1,-0, 10,3,2,2.4,0.1,-0.2, 10,4,-1,5.3,-0,0.1, 10,5,-0.6,-9.1,-0.3,-0.1,
  10,6,-0.9,0.4,0,0.1, 10,7,1.5,-4.2,-0.1,0, 10,8,0.9,-3.8,-0.1,-0.1, 10,9,-2.7,0.9,-0,0.2,
  10,10,-3.9,-9.1,-0,-0, 11,0,2.9,0,0,0, 11,1,-1.5,0,-0,-0, 11,2,-2.5,2.9,0,0.1,
  11,3,2.4,-0.6,0,-0, 11,4,-0.6,0.2,0,0.1, 11,5,-0.1,0.5,-0.1,-0, 11,6,-0.6,-0.3,0,-0,
  11,7,-0.1,-1.2,-0,0.1, 11,8,1.1,-1.7,-0.1,-0, 11,9,-1,-2.9,-0.1,0, 11,10,-0.2,-1.8,-0.1,0,
  11,11,2.6,-2.3,-0.1,0, 12,0,-2,0,0,0, 12,1,-0.2,-1.3,0,-0, 12,2,0.3,0.7,-0,0,
  12,3,1.2,1,-0,-0.1, 12,4,-1.3,-1.4,-0,0.1, 12,5,0.6,-0,-0,-0, 12,6,0.6,0.6,0.1,-0,
  12,7,0.5,-0.1,-0,-0, 12,8,-0.1,0.8,0,0, 12,9,-0.4,0.1,0,-0, 12,10,-0.2,-1,-0.1,-0,
  12,11,-1.3,0.1,-0,0, 12,12,-0.7,0.2,-0.1,-0.1
];
const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F), RE = 6371.2;   // WGS-84; the model's reference radius
const DEG = Math.PI / 180;
// Schmidt semi-normalised associated Legendre functions (and derivatives) to degree 12, by recursion
function legendre(N, x, P, dP) {
  const s = Math.sqrt(1 - x * x) || 1e-12;
  for (let n = 0; n <= N; n++) for (let m = 0; m <= N; m++) { P[n][m] = 0; dP[n][m] = 0; }
  P[0][0] = 1;
  for (let n = 1; n <= N; n++) {
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        const k = m === 1 ? 1 : Math.sqrt((2 * m - 1) / (2 * m));
        P[n][m] = k * s * P[n - 1][m - 1];
        dP[n][m] = k * (s * dP[n - 1][m - 1] + x * P[n - 1][m - 1]);
      } else {
        const a = (2 * n - 1) / Math.sqrt(n * n - m * m), b = n - 1 >= m ? Math.sqrt(((n - 1) * (n - 1) - m * m)) / Math.sqrt(n * n - m * m) : 0;
        P[n][m] = a * x * P[n - 1][m] - (n - 2 >= m ? b * P[n - 2][m] : 0);
        dP[n][m] = a * (x * dP[n - 1][m] - s * P[n - 1][m]) - (n - 2 >= m ? b * dP[n - 2][m] : 0);
      }
    }
  }
}
const P = Array.from({ length: 13 }, () => new Float64Array(13)), dP = Array.from({ length: 13 }, () => new Float64Array(13));
// declination (deg, + east) and the field's north/east/down components (nT) at geodetic lat/lon (deg),
// height above the ellipsoid (km) and decimal year
export function magField(lat, lon, hKm = 0, year = 2026) {
  const phi = lat * DEG, lam = lon * DEG, sp = Math.sin(phi), cp = Math.cos(phi);
  const Rc = A / Math.sqrt(1 - E2 * sp * sp);
  const p = (Rc + hKm) * cp, z = (Rc * (1 - E2) + hKm) * sp, r = Math.hypot(p, z);
  const phc = Math.asin(z / r);                                   // geocentric latitude
  legendre(12, Math.sin(phc), P, dP);
  const dt = year - EPOCH;
  let Bx = 0, By = 0, Bz = 0;
  for (let i = 0; i < C.length; i += 6) {
    const n = C[i], m = C[i + 1], g = C[i + 2] + dt * C[i + 4], h = C[i + 3] + dt * C[i + 5];
    const ar = Math.pow(RE / r, n + 2), cm = Math.cos(m * lam), sm = Math.sin(m * lam);
    Bx += ar * (g * cm + h * sm) * dP[n][m];                       // north: +dV/(r dtheta), dP = d/dtheta (colatitude)
    By += ar * m * (g * sm - h * cm) * P[n][m];
    Bz -= (n + 1) * ar * (g * cm + h * sm) * P[n][m];
  }
  By /= (Math.cos(phc) || 1e-12);                                 // east: -dV/(r cos(lat) dlambda)
  // rotate from geocentric to geodetic
  const psi = phc - phi, X = Bx * Math.cos(psi) - Bz * Math.sin(psi), Z = Bx * Math.sin(psi) + Bz * Math.cos(psi);
  return { X, Y: By, Z, D: Math.atan2(By, X) / DEG };
}
export const declination = (lat, lon, year, hKm = 0) => magField(lat, lon, hKm, year).D;
// decimal year of a UTC time in ms
export const decYear = (ms) => { const d = new Date(ms), y = d.getUTCFullYear(), a = Date.UTC(y, 0, 1), b = Date.UTC(y + 1, 0, 1); return y + (ms - a) / (b - a); };
