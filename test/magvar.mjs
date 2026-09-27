// Magnetic variation from the World Magnetic Model 2025 against NOAA's published test values
// (WMM2025_TestValues.txt: decimal year, height km, lat, lon, declination), and the venues' variation.
import { magField, declination } from '../js/magvar.js';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const T = [
  [2025.000000, 28, 89, -121, -99.77],
  [2025.500000, 6, -36, -137, 20.28],
  [2026.000000, 74, -57, 3, -22.51],
  [2026.500000, 14, 0, 80, -3.10],
  [2027.000000, 37, -66, -5, -17.22],
  [2027.500000, 8, 62, 53, 19.39],
  [2028.000000, 49, 20, 167, 5.10],
  [2028.500000, 28, 54, -120, 15.43],
  [2029.000000, 95, -60, -59, 8.58],
  [2029.500000, 31, 13, -132, 9.04]
];
let worst = 0;
for (const [yr, h, lat, lon, D] of T) worst = Math.max(worst, Math.abs(magField(lat, lon, h, yr).D - D));
check(worst < 0.01, `WMM2025 declination at ${T.length} NOAA test points: worst error ${worst.toFixed(4)} deg`);
// variation near the venues in 2026: Solent just east (the agonic line crossed southern England in the early
// 2020s, moving west ~0.2 deg/yr), San Francisco ~13 E, Sydney ~13 E
const v = (lat, lon) => declination(lat, lon, 2026.5);
check(v(50.77, -1.3) > 0 && v(50.77, -1.3) < 1.5, `Solent ${v(50.77, -1.3).toFixed(2)} deg`);
check(v(37.82, -122.43) > 12 && v(37.82, -122.43) < 14, `San Francisco ${v(37.82, -122.43).toFixed(2)} deg`);
check(v(-33.85, 151.25) > 12 && v(-33.85, 151.25) < 14, `Sydney ${v(-33.85, 151.25).toFixed(2)} deg`);
console.log(fails ? `${fails} FAILED` : 'all magnetic variation checks passed');
process.exit(fails ? 1 : 0);
