// The real sky (js/astro.js, used by js/sky.js) against events and closed forms, headless (no WebGL):
//  1. the sun: noon altitude at the solstices (90 - |lat - decl|), equinox declination and sunrise azimuth, the
//     equation of time (transit at Greenwich)
//  2. the moon: full and new moon, eclipses (a lunar eclipse's opposition; the 2024-04-08 total solar eclipse seen from
//     Dallas), its motion against the stars (~13.2 deg/day eastward), disk size; the drawn disk's lit side faces the sun
//     and its lit area is the phase (a replica of the composite shader's sphere)
//  3. the celestial rotation: Polaris at the latitude's altitude all night, sigma Octantis at -lat in the south, a star's
//     hour angle +15 deg per sidereal hour, a full turn in 23 h 56 min 4 s; the matrix a pure rotation; precession
//  4. the star catalogue (data/sky/stars.bin): count, Sirius, Polaris, colours
//  5. the planets: oppositions, Venus at greatest elongation and inferior conjunction, Mercury's elongation bound,
//     magnitudes; the moon's occultation of Mars on 2025-01-14
// node test/sky.mjs   (exits non-zero on a failed check)
import { readFileSync } from 'node:fs';
import { suite } from './lib/check.mjs';
import * as A from '../js/astro.js';

const DEG = Math.PI / 180, S = suite('sky');
const U = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sep = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const hdir = (h) => A.dirOfArr(h.el, h.az);

// ------------------------------------------------------------------ 1. the sun
const noonAlt = (y, mo, d, lat, lon) => { let best = -99; for (let m = 0; m < 1440; m++) best = Math.max(best, A.sunPosition(U(y, mo, d) + m * 60000, lat, lon).el / DEG); return best; };
S.near({ quantity: 'sun noon altitude, June solstice 2025, Cowes 50.77N', measured: noonAlt(2025, 6, 21, 50.77, -1.3), expected: 90 - (50.77 - 23.44), tol: 0.1, unit: 'deg', source: '90 - |lat - decl|, decl +23.44' });
S.near({ quantity: 'sun noon altitude, December solstice 2025, Auckland 36.85S', measured: noonAlt(2025, 12, 21, -36.85, 174.76), expected: 90 - Math.abs(-36.85 + 23.44), tol: 0.1, unit: 'deg', source: '90 - |lat - decl|, decl -23.44' });
S.near({ quantity: 'sun declination at the March equinox (2025-03-20 09:01 UTC)', measured: A.sunEquatorial(U(2025, 3, 20, 9, 1)).dec / DEG, expected: 0, tol: 0.02, unit: 'deg', source: 'equinox instant (USNO)' });
{ // sunrise azimuth at the equinox: east (geometric horizon, no refraction)
  let t = U(2025, 3, 20, 3); while (A.sunPosition(t, 50.77, -1.3).el < 0) t += 10000;
  S.near({ quantity: 'sunrise azimuth at the equinox, 50.77N', measured: A.sunPosition(t, 50.77, -1.3).az / DEG, expected: 90, tol: 0.5, unit: 'deg', source: 'decl 0: rises due east' });
}
const transit = (y, mo, d) => { let best = 0, bt = 0; for (let s = 0; s < 86400; s += 5) { const e = A.sunPosition(U(y, mo, d) + s * 1000, 0, 0).el; if (e > best) { best = e; bt = s; } } return bt / 60 - 720; };
S.near({ quantity: 'solar transit at Greenwich 2025-02-11 (minus 12:00)', measured: transit(2025, 2, 11), expected: 14.2, tol: 0.5, unit: 'min', source: 'equation of time -14.2 min (Feb minimum)' });
S.near({ quantity: 'solar transit at Greenwich 2025-11-03 (minus 12:00)', measured: transit(2025, 11, 3), expected: -16.4, tol: 0.5, unit: 'min', source: 'equation of time +16.4 min (Nov maximum)' });
S.within({ quantity: 'sun disk angular diameter', measured: 2 * Math.asin(696000 / 149.6e6) / DEG, lo: 0.52, hi: 0.545, unit: 'deg', source: '0.527-0.542 deg over the year' });

// ------------------------------------------------------------------ 2. the moon
const elong = (ms) => wrap180(A.moonEcliptic(ms).lon / DEG - A.sunEquatorial(ms).lon / DEG);
S.near({ quantity: 'moon - sun longitude, full moon 2025-01-13 22:27 UTC', measured: Math.abs(elong(U(2025, 1, 13, 22, 27))), expected: 180, tol: 0.5, unit: 'deg', source: 'USNO moon phases' });
S.near({ quantity: 'moon - sun longitude, new moon 2025-01-29 12:36 UTC', measured: elong(U(2025, 1, 29, 12, 36)), expected: 0, tol: 0.5, unit: 'deg', source: 'USNO moon phases' });
S.near({ quantity: 'moon - sun longitude, full moon 2026-03-03 11:38 UTC', measured: Math.abs(elong(U(2026, 3, 3, 11, 38))), expected: 180, tol: 0.5, unit: 'deg', source: 'USNO (total lunar eclipse night)' });
S.within({ quantity: 'illuminated fraction, full moon 2025-01-13', measured: A.moonPhase(U(2025, 1, 13, 22, 27)), lo: 0.95, unit: '', source: 'full: ~1' });
S.within({ quantity: 'illuminated fraction, new moon 2025-01-29', measured: A.moonPhase(U(2025, 1, 29, 12, 36)), hi: 0.05, unit: '', source: 'new: ~0' });
S.near({ quantity: 'illuminated fraction, first quarter 2025-02-05 08:02 UTC', measured: A.moonPhase(U(2025, 2, 5, 8, 2)), expected: 0.5, tol: 0.05, unit: '', source: 'quarter: half lit' });
{ // total lunar eclipse 2025-03-14, greatest 06:59 UTC: the moon in the earth's shadow, on the ecliptic opposite the sun
  const t = U(2025, 3, 14, 6, 59), m = A.moonEquatorial(t), s = A.sunEquatorial(t);
  S.near({ quantity: 'moon from the anti-sun, total lunar eclipse 2025-03-14 06:59 UTC', measured: sep(A.eqVec(m.ra, m.dec), A.eqVec(s.ra, s.dec).map(v => -v)), expected: 0, tol: 0.6, unit: 'deg', source: 'umbra radius ~0.7 deg, gamma 0.35' });
}
{ // total solar eclipse 2024-04-08 from Dallas (32.78N 96.80W), mid-totality 18:42 UTC: topocentric sun and moon coincide
  const t = U(2024, 4, 8, 18, 42), lat = 32.78, lon = -96.80;
  const d = sep(hdir(A.sunPosition(t, lat, lon)), hdir(A.moonPosition(t, lat, lon)));
  S.near({ quantity: 'sun-moon separation, Dallas, 2024-04-08 18:42 UTC (total eclipse)', measured: d, expected: 0, tol: 0.15, unit: 'deg', source: 'NASA eclipse path (needs the parallax)' });
  const mp = A.moonPosition(t, lat, lon);
  S.within({ quantity: 'moon parallax at that time (geocentric - topocentric altitude)', measured: (mp.elGeo - mp.el) / DEG, lo: 0.3, hi: 0.5, unit: 'deg', source: 'HP ~1.0 deg (near perigee) x cos(alt ~65)' });
}
{ // eastward against the stars: RA and ecliptic longitude gain ~13.2 deg a day (27.32-day sidereal month)
  let tot = 0; const t0 = U(2025, 1, 1); for (let k = 0; k < 273; k++) tot += wrap180(A.moonEcliptic(t0 + (k + 1) * 86400000).lon / DEG - A.moonEcliptic(t0 + k * 86400000).lon / DEG);
  S.near({ quantity: 'moon motion against the stars, mean over 273 days', measured: tot / 273, expected: 360 / 27.3217, tol: 0.05, unit: 'deg/day', source: 'sidereal month 27.3217 d' });
  const a = A.moonEquatorial(U(2025, 6, 1)), b = A.moonEquatorial(U(2025, 6, 2));
  S.within({ quantity: 'moon RA change in one day (eastward > 0)', measured: wrap180((b.ra - a.ra) / DEG), lo: 10, hi: 16, unit: 'deg', source: '11.5-15.5 deg/day with the orbit\'s eccentricity' });
}
{ const r = []; for (let k = 0; k < 400; k++) r.push(2 * A.moonPosition(U(2025, 1, 1) + k * 86400000, 0, 0).radius / DEG);
  S.within({ quantity: 'moon disk angular diameter, smallest', measured: Math.min(...r), lo: 0.48, hi: 0.505, unit: 'deg', source: 'apogee 29.4\'' });
  S.within({ quantity: 'moon disk angular diameter, largest', measured: Math.max(...r), lo: 0.54, hi: 0.57, unit: 'deg', source: 'perigee 33.5\'' }); }
{ // the drawn moon: a replica of the composite shader's lit sphere (js/sky.js COMP_FS), a waxing crescent at dusk
  const t = U(2025, 1, 3, 17, 30), lat = 50.77, lon = -1.3;
  const sd = hdir(A.sunPosition(t, lat, lon)), md = hdir(A.moonPosition(t, lat, lon)), pole = A.apply3(A.celestialMatrix(t, lat, lon), [0, 0, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], nrm = (a) => { const l = Math.hypot(...a); return a.map(v => v / l); };
  const ax = nrm(cross(pole, md)), ay = cross(md, ax);
  let lit = 0, n = 0, cx = 0, cy = 0;
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) {
    const qx = i / 40, qy = j / 40, r2 = qx * qx + qy * qy; if (r2 > 1) continue;
    const nn = [0, 1, 2].map(k => -md[k] * Math.sqrt(1 - r2) + ax[k] * qx + ay[k] * qy);
    const l = Math.max(0, dot(nn, sd)) > 0 ? 1 : 0; lit += l; n++; cx += l * qx; cy += l * qy;
  }
  const sunOnSky = [dot(sd, ax), dot(sd, ay)], litC = [cx, cy];
  const ang = Math.acos((sunOnSky[0] * litC[0] + sunOnSky[1] * litC[1]) / Math.hypot(...sunOnSky) / Math.hypot(...litC)) / DEG;
  S.near({ quantity: 'drawn moon: lit limb toward the sun (angle between them on the sky)', measured: ang, expected: 0, tol: 3, unit: 'deg', source: 'the bright limb points at the sun' });
  S.near({ quantity: 'drawn moon: lit fraction of the disk = phase', measured: lit / n, expected: A.moonPhase(t), tol: 0.03, unit: '', source: '(1 + cos i)/2' });
}

// ------------------------------------------------------------------ 3. the celestial rotation
const POLARIS = A.eqVec(37.9529 * DEG, 89.2641 * DEG), SIGOCT = A.eqVec(317.195 * DEG, -88.9565 * DEG);   // J2000 (BSC5)
const altOf = (v, t, lat, lon) => Math.asin(A.apply3(A.celestialMatrixJ2000(t, lat, lon), v)[1]) / DEG;
{ let lo = 99, hi = -99; for (let h = 0; h <= 12; h += 0.25) { const a = altOf(POLARIS, U(2026, 10, 20, 18) + h * 3600e3, 50.77, -1.3); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  S.near({ quantity: 'Polaris altitude, lowest over a night, 50.77N', measured: lo, expected: 50.77, tol: 1.0, unit: 'deg', source: '~lat (0.63 deg from the pole)' });
  S.near({ quantity: 'Polaris altitude, highest over a night, 50.77N', measured: hi, expected: 50.77, tol: 1.0, unit: 'deg', source: '~lat' }); }
{ let lo = 99, hi = -99; for (let h = 0; h <= 24; h += 0.5) { const a = altOf(SIGOCT, U(2026, 10, 20) + h * 3600e3, -36.85, 174.76); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  S.near({ quantity: 'sigma Octantis altitude over a day, Auckland 36.85S (mean)', measured: (lo + hi) / 2, expected: 36.85, tol: 0.5, unit: 'deg', source: '|lat| (south celestial pole altitude = -lat)' });
  S.within({ quantity: 'sigma Octantis altitude range over a day', measured: hi - lo, lo: 1.5, hi: 2.8, unit: 'deg', source: '2 x its 1.1 deg from the pole' }); }
{ // the matrix is a rotation, and the analytic one agrees with the old one built from three basis stars
  const M = A.celestialMatrix(U(2026, 10, 20, 22), 50.77, -1.3); let err = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) err = Math.max(err, Math.abs(M[i] * M[j] + M[3 + i] * M[3 + j] + M[6 + i] * M[6 + j] - (i === j ? 1 : 0)));
  S.within({ quantity: 'celestial matrix: |M^T M - I|', measured: err, hi: 1e-12, unit: '', source: 'orthonormal' });
  let e2 = 0; const t = U(2026, 10, 20, 22);
  for (const [ra, dec] of [[0, 0], [1, 0.3], [2.5, -1.1], [4, 0.9], [5.5, -0.2]]) { const h = A.horizontal(ra, dec, t, 50.77, -1.3); e2 = Math.max(e2, sep(A.apply3(M, A.eqVec(ra, dec)), A.dirOfArr(h.el, h.az))); }
  S.within({ quantity: 'celestial matrix vs the alt/az formulas', measured: e2, hi: 1e-5, unit: 'deg', source: 'same transform' });
}
{ // hour angle from the horizon direction: HA = atan2(d . west, d . (meridian on the equator))
  const lat = 50.77, lon = -1.3, p = lat * DEG, Aq = [0, Math.cos(p), Math.sin(p)], W = [-1, 0, 0];
  const ha = (v, t) => Math.atan2(dot(A.apply3(A.celestialMatrixJ2000(t, lat, lon), v), W), dot(A.apply3(A.celestialMatrixJ2000(t, lat, lon), v), Aq)) / DEG;
  const star = A.eqVec(279.23 * DEG, 38.78 * DEG), t0 = U(2026, 10, 20, 20);   // Vega
  S.near({ quantity: 'Vega hour angle gained in one sidereal hour', measured: wrap180(ha(star, t0 + A.SIDEREAL_DAY_S / 24 * 1000) - ha(star, t0)), expected: 15, tol: 1e-3, unit: 'deg', source: '360 deg per sidereal day' });
  S.near({ quantity: 'Vega hour angle gained in one solar hour', measured: wrap180(ha(star, t0 + 3600e3) - ha(star, t0)), expected: 15.0411, tol: 1e-3, unit: 'deg', source: '15.041 deg/h' });
  S.near({ quantity: 'Vega back where it was after 23h56m4.09s', measured: sep(A.apply3(A.celestialMatrixJ2000(t0, lat, lon), star), A.apply3(A.celestialMatrixJ2000(t0 + A.SIDEREAL_DAY_S * 1000, lat, lon), star)), expected: 0, tol: 0.01, unit: 'deg', source: 'one sidereal day' });
  S.near({ quantity: 'sidereal day', measured: A.SIDEREAL_DAY_S, expected: 86164.09, tol: 0.01, unit: 's', source: '23 h 56 min 4.09 s' });
  // the sky turns westward: a star east of the meridian climbs
  S.ok(altOf(star, t0 - 3 * 3600e3 + 600e3, lat, lon) > altOf(star, t0 - 3 * 3600e3, lat, lon) === (ha(star, t0 - 3 * 3600e3) < 0), 'a star rises east of the meridian, sets west of it', { source: 'diurnal motion' });
}
{ // precession: Polaris' declination of date (2026: +89 deg 22')
  const t = U(2026, 7, 1), v = A.apply3(A.precessionMatrix(t), POLARIS);
  S.near({ quantity: 'Polaris declination of date, 2026.5', measured: Math.asin(v[2]) / DEG, expected: 89 + 22.6 / 60, tol: 0.03, unit: 'deg', source: 'J2000 +89 15.9\', +~0.27\'/yr' });
  const w = A.apply3(A.precessionMatrix(U(2025, 1, 1, 12)), [1, 0, 0]);
  S.near({ quantity: 'precession in RA over 25 years at RA 0 Dec 0', measured: Math.atan2(w[1], w[0]) / DEG * 240, expected: 3.075 * 25, tol: 0.5, unit: 's', source: 'm + n sin a tan d = 3.075 s/yr' });
}

// ------------------------------------------------------------------ 4. the catalogue
{ const b = readFileSync(new URL('../data/sky/stars.bin', import.meta.url)), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(8, true), st = [];
  for (let i = 0; i < n; i++) { const o = 12 + i * 8; st.push({ ra: dv.getUint16(o, true) / 65536 * 360, dec: dv.getInt16(o + 2, true) / 32767 * 90, v: dv.getInt16(o + 4, true) / 1000, bv: dv.getInt16(o + 6, true) / 1000 }); }
  S.ok(b.toString('latin1', 0, 4) === 'TWST' && b.length === 12 + 8 * n, 'stars.bin header and size', { measured: n });
  S.within({ quantity: 'stars to V 6.0', measured: n, lo: 4800, hi: 5200, unit: '', source: 'BSC5: 5080 to V 6.0' });
  S.near({ quantity: 'brightest star: Sirius V', measured: st[0].v, expected: -1.46, tol: 0.01, unit: 'mag', source: 'BSC5 HR 2491' });
  S.near({ quantity: 'Sirius position error', measured: sep(A.eqVec(st[0].ra * DEG, st[0].dec * DEG), A.eqVec(101.2872 * DEG, -16.7161 * DEG)) * 3600, expected: 0, tol: 20, unit: '"', source: 'J2000 06h45m08.9s -16 42 58' });
  const pol = st.find(s => s.dec > 89);
  S.ok(pol && Math.abs(pol.v - 2.02) < 0.01 && sep(A.eqVec(pol.ra * DEG, pol.dec * DEG), POLARIS) < 0.01, 'Polaris in the catalogue, V 2.02', { measured: pol && pol.v });
  const bet = st.find(s => Math.abs(s.ra - 88.79) < 0.05 && Math.abs(s.dec - 7.41) < 0.05);
  S.near({ quantity: 'Betelgeuse B-V', measured: bet ? bet.bv : NaN, expected: 1.85, tol: 0.01, unit: 'mag', source: 'BSC5 HR 2061' });
  const north = st.filter(s => s.dec > 0).length / n;
  S.within({ quantity: 'fraction of the stars north of the equator', measured: north, lo: 0.45, hi: 0.55, unit: '', source: 'a whole-sky catalogue' }); }
{ const g = A.GAL_NP, c = A.GAL_C;
  S.within({ quantity: 'galactic pole . galactic centre', measured: Math.abs(dot(g, c)), hi: 1e-4, unit: '', source: 'perpendicular' }); }

// ------------------------------------------------------------------ 5. the planets
const pe = (name, t) => A.planet(name, t);
S.near({ quantity: 'Mars elongation at opposition 2025-01-16', measured: pe('mars', U(2025, 1, 16, 2)).elong, expected: 176, tol: 1, unit: 'deg', source: 'opposition, Mars ~4 deg N of the ecliptic (dec +25 vs the anti-sun +21)' });
S.near({ quantity: 'Mars - sun longitude at opposition 2025-01-16 02:38 UTC', measured: Math.abs(wrap180(pe('mars', U(2025, 1, 16, 2, 38)).eclLon / DEG - A.sunEquatorial(U(2025, 1, 16, 2, 38)).lon / DEG + 0.35)), expected: 180, tol: 0.3, unit: 'deg', source: 'opposition: 180 deg in longitude (J2000 vs of-date: 0.35)' });
S.near({ quantity: 'Jupiter - sun longitude at opposition 2026-01-10', measured: Math.abs(wrap180(pe('jupiter', U(2026, 1, 10, 8)).eclLon / DEG - A.sunEquatorial(U(2026, 1, 10, 8)).lon / DEG + 0.36)), expected: 180, tol: 0.5, unit: 'deg', source: 'opposition 2026-01-10' });
S.near({ quantity: 'Saturn - sun longitude at opposition 2025-09-21', measured: Math.abs(wrap180(pe('saturn', U(2025, 9, 21, 4)).eclLon / DEG - A.sunEquatorial(U(2025, 9, 21, 4)).lon / DEG + 0.35)), expected: 180, tol: 0.5, unit: 'deg', source: 'opposition 2025-09-21' });
S.near({ quantity: 'Venus elongation, greatest eastern 2025-01-10', measured: pe('venus', U(2025, 1, 10)).elong, expected: 47.2, tol: 0.3, unit: 'deg', source: 'greatest elongation 47.2 deg' });
S.near({ quantity: 'Venus - sun longitude, inferior conjunction 2025-03-23 01 UTC', measured: wrap180(pe('venus', U(2025, 3, 23, 1)).eclLon / DEG - A.sunEquatorial(U(2025, 3, 23, 1)).lon / DEG + 0.35), expected: 0, tol: 0.5, unit: 'deg', source: 'inferior conjunction 2025-03-23' });
{ let mx = 0; for (let k = 0; k < 730; k++) mx = Math.max(mx, pe('mercury', U(2025, 1, 1) + k * 86400000).elong);
  S.within({ quantity: 'Mercury, greatest elongation over 2025-2026', measured: mx, lo: 26.5, hi: 28.3, unit: 'deg', source: '17.9-27.8 deg' }); }
S.near({ quantity: 'Venus magnitude, 2025-01-10', measured: pe('venus', U(2025, 1, 10)).mag, expected: -4.5, tol: 0.25, unit: 'mag', source: 'almanac -4.4..-4.6' });
S.near({ quantity: 'Jupiter magnitude at opposition 2026', measured: pe('jupiter', U(2026, 1, 10)).mag, expected: -2.7, tol: 0.25, unit: 'mag', source: 'almanac -2.7' });
S.near({ quantity: 'Mars magnitude at opposition 2025', measured: pe('mars', U(2025, 1, 16)).mag, expected: -1.4, tol: 0.25, unit: 'mag', source: 'almanac -1.4' });
S.near({ quantity: 'Saturn magnitude at opposition 2025 (rings edge on)', measured: pe('saturn', U(2025, 9, 21)).mag, expected: 0.6, tol: 0.3, unit: 'mag', source: 'almanac +0.6' });
{ // the moon occulted Mars for North America on 2025-01-14 (~02:20 UTC from Washington DC); positions to date (J2000 -> date)
  const t = U(2025, 1, 14, 2, 20), lat = 38.9, lon = -77.04, p = pe('mars', t);
  const mars = A.apply3(A.celestialMatrixJ2000(t, lat, lon), p.vec), moon = hdir(A.moonPosition(t, lat, lon));
  S.within({ quantity: 'moon-Mars separation from Washington, 2025-01-14 02:20 UTC (occultation)', measured: sep(mars, moon), hi: 0.45, unit: 'deg', source: 'Mars behind the moon (radius 0.27 deg)' });
}
S.done();
