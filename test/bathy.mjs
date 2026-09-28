// Bathymetry against the charts: each venue's charted depth as the game lays it out (the baked grid on the OSM
// shoreline, js/world.js setBathy; below chart datum, world.chartDepthAt) at published spot depths, within 30% or
// 1 m; the Progreso shelf sailable as it really is (no false drying off the beach, no false trough across the roads);
// Progreso's tide range against the gauge's; the Solent's Bramble Bank still a bank.
// node test/bathy.mjs          (the ENC-wide statistics: node tools/verify-bathy.mjs <venue>)
import { loadVenue } from '../tools/verify-bathy.mjs';
import { args } from '../js/tide.js';

let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

// [name, lat, lon, charted depth (m) or [least, most], source]
const SEMAR = 'SEMAR, Cuestionario del puerto de Progreso', ENC = 'NOAA ENC sounding', EMOD = 'EMODnet DTM (LAT)', PANSW = 'Port Authority of NSW, promulgated depth';
const SPOTS = {
  progreso: [
    ['off the Puerto de Altura pier head', 21.3355, -89.6790, [6, 7.2], 'natural 6-7 m; the terminal basin 7.2 m (' + SEMAR + ')'],
    ['anchorage 4 M NNW of Progreso', 21.3447, -89.6910, 7.3, SEMAR + ': 7.3 m, hard sand'],
    ['the northern approach', 21.365, -89.672, [5.5, 9], SEMAR + ': 5.5-9 m, no shoals'],
    ['10 km off the beach', 21.378, -89.668, 10, 'the 10 m isobath 10 km off Progreso (J. Mar. Sci. Eng. 9, 518, 2021)'],
    ['the intermediate terminal', 21.3050, -89.6650, 4.2, SEMAR + ': its basin 4.2 m'],
    ['Yucalpetén entrance channel', 21.2790, -89.70247, 3.0, SEMAR + ': channel and basin 3.0 m'],
  ],
  sfbay: [
    ['Golden Gate', 37.81966, -122.47516, 87.7, ENC], ['City Front', 37.80948, -122.43854, 12.4, ENC], ['Blossom Rock', 37.81820, -122.39956, 21.6, ENC],
    ['north of Alcatraz', 37.82970, -122.42013, 17.6, ENC], ['Raccoon Strait', 37.86728, -122.44493, 21.9, ENC],
  ],
  newport: [['East Passage off Rose Island', 41.49443, -71.34352, 17.8, ENC], ['Newport Harbor entrance', 41.48726, -71.33123, 12.9, ENC], ['West Passage', 41.49909, -71.40033, 10.4, ENC]],
  solent: [['Hurst Narrows', 50.7055, -1.5465, 35.2, EMOD], ['Cowes Roads', 50.772, -1.31, 17.9, EMOD], ['Spithead', 50.76, -1.10, 11.4, EMOD], ['Yarmouth Roads', 50.712, -1.49, 12.5, EMOD]],
  kiel: [['outer fjord', 54.43, 10.20, 13.2, EMOD], ['Kiel Bight', 54.45, 10.25, 18.1, EMOD], ['inner fjord', 54.37, 10.16, 12.2, EMOD]],
  marseille: [['off Frioul', 43.26, 5.30, 52.9, EMOD], ['the Rade', 43.30, 5.34, 40.8, EMOD], ['off the Corniche', 43.25, 5.36, 16.4, EMOD], ['Frioul, between the islands', 43.28, 5.31, 7.3, EMOD]],
  sydney: [['Western Channel', -33.838, 151.265, [13.7, 30], PANSW + ' 13.7 m'], ['Eastern Channel pile', -33.8418, 151.2718, 10.5, PANSW + ' 10.5 m'], ['off the Harbour Bridge', -33.852, 151.211, [10, 30], 'the ferries\' and ships\' reach']],
  auckland: [['Rangitoto Channel', -36.803, 174.817, 12.5, 'Ports of Auckland: 12.5 m below chart datum']],
};
const V = {};
for (const [id, spots] of Object.entries(SPOTS)) {
  const L = V[id] = loadVenue(id), { w, P } = L;
  for (const [name, lat, lon, ref, src] of spots) {
    const [x, z] = P.fwd(lat, lon), d = w.chartDepthAt(x, z);
    const [lo, hi] = Array.isArray(ref) ? ref : [ref, ref], tol = Math.max(1, 0.3 * hi);
    check(d >= lo - Math.max(1, 0.3 * lo) && d <= hi + tol, `${id}: ${name} ${d.toFixed(1)} m (chart ${Array.isArray(ref) ? ref.join('-') : ref} m; ${src})`);
  }
}

// ---------------------------------------------------------------- the Progreso shelf
{
  const { w, v, P } = V.progreso, R = v.R;
  // no drying or shallow patch out on the shelf (SEMAR: no shoals; the bottom slopes about 1:1000 beyond the
  // beach's 4 m depth of closure, and the pier's 6.5 km reach 6-7 m)
  for (const [off, least] of [[1500, 2.5], [3000, 3.5]]) {
    let n = 0, low = 0, worst = 99;
    for (let z = -R + 100; z < R; z += 200) for (let x = -R + 100; x < R; x += 200) {
      if (w.sdfAt(x, z) < off) continue;
      n++; const d = w.chartDepthAt(x, z); worst = Math.min(worst, d); if (d < least) low++;
    }
    check(n > 500 && low === 0, `Progreso: the shelf ${off / 1000} km or more off the shore is ${least} m or deeper at chart datum everywhere (${n} points, least ${worst.toFixed(1)} m)`);
  }
  // the beach shoals within a few hundred metres, not a kilometre of drying sand: 1 km off the Progreso-Chicxulub
  // beach a 1.45 m keel floats at chart datum (the lowest tide)
  let m = 0, dry = 0, least = 99;
  for (let x = -2500; x <= 3000; x += 100) for (let z = -1000; z < 4500; z += 25) {
    const s = w.sdfAt(x, z); if (Math.abs(s - 1000) > 15) continue;
    m++; const d = w.chartDepthAt(x, z); least = Math.min(least, d); if (d < 1.8) dry++;
  }
  check(m > 20 && dry === 0, `Progreso: 1 km off the beach at least 1.8 m at chart datum (${m} points, least ${least.toFixed(1)} m)`);
  // the game's start off the beach: afloat at the lowest tide
  const [sx, sz] = P.fwd(v.spawn.lat, v.spawn.lon), ds = w.chartDepthAt(sx, sz);
  check(ds > 1.45 + 0.3, `Progreso: the start ${ds.toFixed(1)} m at chart datum (a 1.45 m keel floats at the lowest tide)`);
  // the tide: small and mixed, mostly diurnal (UHSLC gauge, TICON-4): the range a day, and low water never below
  // chart datum by more than a few cm (the level is added to the bed once: depth = bed below MSL + level)
  const g = w.tide.gauges[0], t0 = Date.UTC(2026, 0, 1);
  let lo = 9, hi = -9; const days = [];
  for (let d = 0; d < 365; d++) { let a = 9, b = -9; for (let h = 0; h < 24; h += 0.5) { const ms = t0 + (d * 24 + h) * 3600e3, l = g.level(ms, args(ms)); a = Math.min(a, l); b = Math.max(b, l); } days.push(b - a); lo = Math.min(lo, a); hi = Math.max(hi, b); }
  days.sort((a, b) => a - b);
  const med = days[183], p95 = days[346];
  check(med > 0.3 && med < 0.8 && p95 < 1.1 && lo > -w.tide.z0At(g.x, g.z) - 0.05, `Progreso tide: a day's range ${med.toFixed(2)} m (95%: ${p95.toFixed(2)} m), the year ${lo.toFixed(2)}..+${hi.toFixed(2)} m on MSL, chart datum ${w.tide.z0At(g.x, g.z).toFixed(2)} m below it`);
  const [gx, gz] = P.fwd(21.3355, -89.6790), bed = w.bedAt(gx, gz);
  w.tide.still = false; w.tide.setClock(t0); w.tide.setTime(0);
  const now = w.depthAt(gx, gz), lv = w.tide.levelAt(gx, gz);
  check(Math.abs(now - (bed + lv)) < 0.01, `Progreso: the depth now is the bed below MSL plus the tide's level, once (${bed.toFixed(2)} + ${lv.toFixed(2)} = ${now.toFixed(2)} m)`);
}

// ---------------------------------------------------------------- real banks stay banks
{
  const { w, P } = V.solent, [x0, z0] = P.fwd(50.79, -1.29);
  let least = 99; for (let dx = -1500; dx <= 1500; dx += 50) for (let dz = -1500; dz <= 1500; dz += 50) if (w.sdfAt(x0 + dx, z0 + dz) > 300) least = Math.min(least, w.chartDepthAt(x0 + dx, z0 + dz));
  check(least < 1, `Solent: the Bramble Bank shoals to ${least.toFixed(1)} m at chart datum (it dries at low springs)`);
}

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
