// Astronomy for the sky (no three.js: test/sky.mjs runs it headless). Low precision, arc-minutes:
//  - the sun: the USNO approximate solar coordinates (~1')
//  - the moon: Meeus ch. 47, the largest terms of the ELP theory (~0.1 deg), with the topocentric parallax (up to ~1 deg)
//  - the planets: JPL's Keplerian elements for approximate positions, 1800-2050 (Standish), J2000 ecliptic (~arc-minutes),
//    magnitudes from the phase-angle laws in Schlyter's "How to compute planetary positions"
//  - precession J2000 -> date (IAU 1976 angles) for the J2000 star catalogue
// Angles in radians unless named *Deg. Equatorial frame: x -> RA 0h, y -> RA 6h, z -> north celestial pole.
// The horizon frame is the scene's: x east, y up, z south.
const DEG = Math.PI / 180, TAU = 2 * Math.PI;
export const jd = (ms) => ms / 86400000 + 2440587.5;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

// local sidereal time (rad): GMST (no nutation: the equation of the equinoxes is ~1 s) plus the longitude
export const lst = (ms, lon) => wrap((280.46061837 + 360.98564736629 * (jd(ms) - 2451545.0)) * DEG + lon * DEG);
export const SIDEREAL_DAY_S = 86400 / 1.00273790935;   // 23 h 56 min 4.09 s

export function horizontal(ra, dec, ms, lat, lon) {
  const L = lst(ms, lon), H = L - ra, phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)); // from north, eastward
  return { el, az, lst: L, ra, dec };
}
// horizon direction (x east, y up, z south)
export const dirOfArr = (el, az) => [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
export const eqVec = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];

// ecliptic (of date) -> equatorial
function eclToEq(l, b, eps) {
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  return { ra: wrap(ra), dec };
}

// the sun: apparent-ish geocentric longitude of date, RA/Dec, distance (AU)
export function sunEquatorial(ms) {
  const d = jd(ms) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  return { ra: wrap(ra), dec, lon: wrap(L), dist: 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g) };
}
export function sunPosition(ms, lat, lon) {
  const s = sunEquatorial(ms);
  return horizontal(s.ra, s.dec, ms, lat, lon);
}

// the moon: geocentric ecliptic longitude/latitude of date and distance (km), Meeus ch. 47 (terms > ~0.03 deg)
export function moonEcliptic(ms) {
  const T = (jd(ms) - 2451545.0) / 36525;
  const Lp = (218.3164477 + 481267.88123421 * T) * DEG;
  const D = (297.8501921 + 445267.1114034 * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG;
  const F = (93.2720950 + 483202.0175233 * T) * DEG;
  const S = Math.sin, C = Math.cos;
  const dl = 6.288774 * S(Mp) + 1.274027 * S(2 * D - Mp) + 0.658314 * S(2 * D) + 0.213618 * S(2 * Mp) - 0.185116 * S(M)
    - 0.114332 * S(2 * F) + 0.058793 * S(2 * D - 2 * Mp) + 0.057066 * S(2 * D - M - Mp) + 0.053322 * S(2 * D + Mp)
    + 0.045758 * S(2 * D - M) - 0.040923 * S(M - Mp) - 0.034720 * S(D) - 0.030383 * S(M + Mp) + 0.015327 * S(2 * D - 2 * F)
    - 0.012528 * S(Mp + 2 * F) + 0.010980 * S(Mp - 2 * F) + 0.010675 * S(4 * D - Mp) + 0.010034 * S(3 * Mp);
  const db = 5.128122 * S(F) + 0.280602 * S(Mp + F) + 0.277693 * S(Mp - F) + 0.173237 * S(2 * D - F) + 0.055413 * S(2 * D - Mp + F)
    + 0.046271 * S(2 * D - Mp - F) + 0.032573 * S(2 * D + F) + 0.017198 * S(2 * Mp + F) + 0.009266 * S(2 * D + Mp - F);
  const dr = -20905.355 * C(Mp) - 3699.111 * C(2 * D - Mp) - 2955.968 * C(2 * D) - 569.925 * C(2 * Mp) + 48.888 * C(M)
    + 246.158 * C(2 * D - 2 * Mp) - 152.138 * C(2 * D - M - Mp) - 170.733 * C(2 * D + Mp) - 204.586 * C(2 * D - M)
    - 129.620 * C(M - Mp) + 108.743 * C(D) + 104.755 * C(M + Mp);
  return { lon: wrap(Lp + dl * DEG), lat: db * DEG, dist: 385000.56 + dr, eps: (23.439291 - 0.0130042 * T) * DEG };
}
export function moonEquatorial(ms) {
  const m = moonEcliptic(ms), q = eclToEq(m.lon, m.lat, m.eps);
  return { ra: q.ra, dec: q.dec, lon: m.lon, lat: m.lat, dist: m.dist };
}
// topocentric: the moon seen from the surface sits lower than from the centre, by its horizontal parallax x cos(alt)
export function moonPosition(ms, lat, lon) {
  const q = moonEquatorial(ms), h = horizontal(q.ra, q.dec, ms, lat, lon);
  const par = Math.asin(6378.14 / q.dist);
  h.elGeo = h.el; h.el -= Math.asin(Math.sin(par) * Math.cos(h.el));
  h.dist = q.dist; h.radius = Math.asin(1737.4 / q.dist);      // the disk's angular radius (~0.26 deg)
  return h;
}
// illuminated fraction of the moon's disk, from the sun-moon elongation (geocentric)
export function moonPhase(ms) {
  const s = sunEquatorial(ms), m = moonEquatorial(ms);
  const a = eqVec(s.ra, s.dec), b = eqVec(m.ra, m.dec);
  const ce = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // phase angle i: the sun-moon-earth angle (the moon 400 000 km away, the sun 150 million)
  const R = s.dist * 149597870.7, e = Math.acos(Math.max(-1, Math.min(1, ce)));
  const i = Math.atan2(R * Math.sin(e), m.dist - R * Math.cos(e));
  return (1 + Math.cos(i)) / 2;
}

// precession J2000 -> mean equator and equinox of date (row-major 3x3): r_date = P r_J2000
export function precessionMatrix(ms) {
  const T = (jd(ms) - 2451545.0) / 36525, as = DEG / 3600;
  const z0 = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
  const cz0 = Math.cos(z0), sz0 = Math.sin(z0), cz = Math.cos(z), sz = Math.sin(z), ct = Math.cos(th), st = Math.sin(th);
  return [
    cz0 * ct * cz - sz0 * sz, -sz0 * ct * cz - cz0 * sz, -st * cz,
    cz0 * ct * sz + sz0 * cz, -sz0 * ct * sz + cz0 * cz, -st * sz,
    cz0 * st, -sz0 * st, ct,
  ];
}
export const mul3 = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };
export const apply3 = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];

// equatorial of date -> horizon (row-major 3x3, a pure rotation). Built analytically: the horizon frame's east,
// up and south axes in equatorial coordinates, for local sidereal time and latitude
export function celestialMatrix(ms, lat, lon) {
  const L = lst(ms, lon), p = lat * DEG, cL = Math.cos(L), sL = Math.sin(L), cp = Math.cos(p), sp = Math.sin(p);
  const east = [-sL, cL, 0], up = [cp * cL, cp * sL, sp], south = [sp * cL, sp * sL, -cp];
  return [...east, ...up, ...south];      // rows: horizon component = row . equatorial vector
}
// J2000 (the catalogue's frame) -> horizon: the same, after precession to the date
export const celestialMatrixJ2000 = (ms, lat, lon) => mul3(celestialMatrix(ms, lat, lon), precessionMatrix(ms));

// the galaxy (J2000): north galactic pole and centre (IAU 1958 / Hipparcos)
export const GAL_NP = eqVec(192.85948 * DEG, 27.12825 * DEG);
export const GAL_C = eqVec(266.40500 * DEG, -28.93617 * DEG);

// ------------------------------------------------------------------ planets
// [a (AU), e, I, L, long. perihelion, long. ascending node] at J2000 and their rates per Julian century (deg)
const ELEM = {
  mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  venus: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  earth: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  mars: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  saturn: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
};
// heliocentric J2000 ecliptic position (AU)
export function helio(name, ms) {
  const T = (jd(ms) - 2451545.0) / 36525, [e0, r] = ELEM[name];
  const a = e0[0] + r[0] * T, e = e0[1] + r[1] * T, I = (e0[2] + r[2] * T) * DEG, L = (e0[3] + r[3] * T) * DEG;
  const w = (e0[4] + r[4] * T) * DEG, N = (e0[5] + r[5] * T) * DEG;
  const om = w - N, M = Math.atan2(Math.sin(L - w), Math.cos(L - w));
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(om), so = Math.sin(om), cN = Math.cos(N), sN = Math.sin(N), cI = Math.cos(I), sI = Math.sin(I);
  return [(co * cN - so * sN * cI) * xp + (-so * cN - co * sN * cI) * yp,
    (co * sN + so * cN * cI) * xp + (-so * sN + co * cN * cI) * yp,
    (so * sI) * xp + (co * sI) * yp];
}
const EPS0 = 23.43928 * DEG;
const MAG = {   // V at 1 AU from sun and earth, and the phase coefficients (Schlyter): V0 + 5 log10(r R) + f(i deg)
  mercury: (i) => -0.36 + 0.027 * i + 2.2e-13 * i ** 6,
  venus: (i) => -4.34 + 0.013 * i + 4.2e-7 * i ** 3,
  mars: (i) => -1.51 + 0.016 * i,
  jupiter: (i) => -9.25 + 0.014 * i,
  saturn: (i) => -9.0 + 0.044 * i,
};
export const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'];
// geocentric: J2000 equatorial unit vector, RA/Dec (J2000), ecliptic longitude (J2000), distance, magnitude, elongation
export function planet(name, ms) {
  const p = helio(name, ms), E = helio('earth', ms);
  const g = [p[0] - E[0], p[1] - E[1], p[2] - E[2]];
  const R = Math.hypot(...g), r = Math.hypot(...p), Re = Math.hypot(...E);
  const ce = Math.cos(EPS0), se = Math.sin(EPS0);
  const q = [g[0] / R, (g[1] * ce - g[2] * se) / R, (g[1] * se + g[2] * ce) / R];
  const i = Math.acos(Math.max(-1, Math.min(1, (r * r + R * R - Re * Re) / (2 * r * R)))) / DEG;
  const elong = Math.acos(Math.max(-1, Math.min(1, -(g[0] * E[0] + g[1] * E[1] + g[2] * E[2]) / (R * Re)))) / DEG;
  let mag = MAG[name](i) + 5 * Math.log10(r * R);
  if (name === 'saturn') {   // the rings: brighter as they open toward us (ring plane: node 169.5, inclination 28.06 to the ecliptic, J2000)
    const lon = Math.atan2(g[1], g[0]), lat = Math.asin(g[2] / R), ir = 28.06 * DEG, Nr = 169.51 * DEG;
    const B = Math.asin(Math.sin(lat) * Math.cos(ir) - Math.cos(lat) * Math.sin(ir) * Math.sin(lon - Nr));
    mag += -2.6 * Math.abs(Math.sin(B)) + 1.2 * Math.sin(B) ** 2;
  }
  return { vec: q, ra: wrap(Math.atan2(q[1], q[0])), dec: Math.asin(q[2]), eclLon: wrap(Math.atan2(g[1], g[0])), dist: R, mag, elong, phaseAngle: i };
}
