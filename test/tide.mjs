// Tides: the harmonic predictor against official predictions, the baked tidal streams against published and
// predicted currents, the shallow-water model's mass balance, stability, narrows and drying banks, and a keel
// grounding on a bank at low water that floats at high water.
// node test/tide.mjs            (the stream checks need data/venues/<id>.tide.json baked by tools/bake-tide.mjs)
import { TideStation, Tide, args } from '../js/tide.js';
import { World, VENUES, makeProjection } from '../js/world.js';
import { Bathy } from '../js/bathy.js';
import { Boat, makeSteadyEnv } from '../js/physics.js';
import { Model } from '../tools/bake-tide.mjs';
import { readFileSync, existsSync } from 'node:fs';

const KT = 0.514444;
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };
const utc = (s) => Date.parse(s.replace(' ', 'T') + 'Z');
const tideFile = (id) => JSON.parse(readFileSync(new URL(`../data/venues/${id}.tide.json`, import.meta.url), 'utf8'));

// ---------------------------------------------------------------- 1. harmonic prediction vs official predictions
// NOAA CO-OPS high / low waters (m above MSL, GMT) for San Francisco 9414290 and Newport 8452660
const NOAA = {
  sfbay: [['2026-09-26 00:17', -0.574], ['2026-09-26 06:34', 0.716], ['2026-09-26 12:26', -0.719], ['2026-09-26 19:00', 0.785], ['2026-09-27 00:54', -0.722], ['2026-09-27 07:22', 0.68],
    ['2027-03-15 01:35', 0.198], ['2027-03-15 05:12', 0.016], ['2027-03-15 11:42', 0.79], ['2027-03-15 19:08', -0.966]],
  newport: [['2026-09-26 05:19', -0.546], ['2026-09-26 11:58', 0.733], ['2026-09-26 17:50', -0.534], ['2026-09-27 00:17', 0.672], ['2026-09-27 05:53', -0.585], ['2026-09-27 12:38', 0.796],
    ['2027-03-15 05:27', 0.517], ['2027-03-15 11:10', -0.395], ['2027-03-15 18:04', 0.343], ['2027-03-15 23:05', -0.476]],
};
for (const id of ['sfbay', 'newport']) {
  const g = tideFile(id).gauges[0], st = new TideStation({ cons: g.cons });
  let dtMax = 0, dhMax = 0;
  for (const [t, h] of NOAA[id]) {
    const T = utc(t), ex = st.extremes(T - 3 * 3600e3, T + 3 * 3600e3);
    const e = ex.reduce((a, b) => (!a || Math.abs(b.t - T) < Math.abs(a.t - T) ? b : a), null);
    dtMax = Math.max(dtMax, Math.abs(e.t - T) / 60e3); dhMax = Math.max(dhMax, Math.abs(e.h - h));
  }
  check(dtMax < 15 && dhMax < 0.10, `${g.name}: ${NOAA[id].length} NOAA high / low waters, times within ${dtMax.toFixed(1)} min, heights within ${(dhMax * 100).toFixed(1)} cm`);
}
// UKHO (Admiralty EasyTide) low waters at Portsmouth, UTC; TICON-4 constants. (High water at Portsmouth is a long
// stand whose "time" is ill defined, so only the lows are compared.)
{
  const g = tideFile('solent').gauges.find(x => x.name === 'Portsmouth'), st = new TideStation({ cons: g.cons });
  const LW = ['2026-09-25 03:28', '2026-09-25 15:50', '2026-09-26 04:04', '2026-09-26 16:25'];
  let dtMax = 0;
  for (const t of LW) { const T = utc(t), ex = st.extremes(T - 3 * 3600e3, T + 3 * 3600e3).filter(e => !e.hw); const e = ex.reduce((a, b) => (!a || Math.abs(b.t - T) < Math.abs(a.t - T) ? b : a), null); dtMax = Math.max(dtMax, Math.abs(e.t - T) / 60e3); }
  check(dtMax < 15, `Portsmouth: UKHO low waters, times within ${dtMax.toFixed(1)} min`);
  // the Solent's young flood stand and long high water (M4, M6 on M2): at Southampton the rise stalls mid-flood,
  // then the water stays near its top for hours
  const sw = tideFile('solent').gauges.find(x => x.name === 'Southampton'), ss = new TideStation({ cons: sw.cons });
  const e = ss.extremes(utc('2026-09-26 03:00'), utc('2026-09-26 17:00')), lw = e.find(x => !x.hw), hw = e.find(x => x.hw && x.t > lw.t);
  const rates = []; for (let t = lw.t; t < hw.t; t += 600e3) rates.push((ss.level(t + 600e3) - ss.level(t)) * 6);
  const mid = rates.slice(Math.floor(rates.length * 0.2), Math.floor(rates.length * 0.6)), rmax = Math.max(...rates), rmin = Math.min(...mid);
  let stand = 0; for (let t = hw.t - 5 * 3600e3; t < hw.t + 5 * 3600e3; t += 600e3) if (ss.level(t) > hw.h - 0.3) stand += 10;
  check(rmin < 0.35 * rmax && stand >= 170, `Southampton: the young flood stand (rise slows to ${rmin.toFixed(2)} m/h against ${rmax.toFixed(2)}), high water within 30 cm for ${(stand / 60).toFixed(1)} h (a pure semidiurnal tide: 2.2 h)`);
}
// tideless and microtidal venues
{
  const kiel = tideFile('kiel').gauges[0], mar = tideFile('marseille').gauges[0];
  const rng = (g) => { const s = new TideStation({ cons: g.cons }); let lo = 9, hi = -9; for (let t = utc('2026-09-01 00:00'); t < utc('2026-10-01 00:00'); t += 1800e3) { const h = s.level(t); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; };
  const rk = rng(kiel), rm = rng(mar);
  check(rk < 0.3 && rm < 0.5, `Kiel (astronomical range ${(rk * 100).toFixed(0)} cm: the Baltic's level is the wind's) and Marseille (${(rm * 100).toFixed(0)} cm) are microtidal`);
}

// ---------------------------------------------------------------- 2. tidal streams vs published / predicted
const streamsOf = (id) => { const f = new URL(`../data/venues/${id}.tide.json`, import.meta.url); if (!existsSync(f)) return null; const t = new Tide(tideFile(id)); return t.streams ? t : null; };
const maxOver = (tide, lat, lon, v, t0, t1, dir) => {
  const P = makeProjection(v.lat, v.lon), [x, z] = P.fwd(lat, lon), o = {};
  let best = 0, bt = 0;
  for (let t = t0; t < t1; t += 300e3) { tide.streams.atTime(x, z, t, o); const s = dir === undefined ? Math.hypot(o.x, o.z) : o.x * Math.sin(dir) - o.z * Math.cos(dir); if (s > best) { best = s; bt = t; } }
  return [best / KT, bt];
};
{
  const V = VENUES.find(v => v.id === 'sfbay'), tide = streamsOf('sfbay');
  if (!tide) check(false, 'San Francisco: no baked stream maps (node tools/bake-tide.mjs sfbay)');
  else {
    // springs at the end of September 2026: NOAA predicts 4.4 kn of ebb at the Bay Entrance (SFB1201)
    const [ebb, te] = maxOver(tide, 37.8200, -122.4750, V, utc('2026-09-28 12:00'), utc('2026-10-01 12:00'), 247 * Math.PI / 180);
    check(ebb >= 3.5 && ebb <= 5.5, `Golden Gate under the bridge: strongest spring ebb ${ebb.toFixed(1)} kn (3.5–5.5)`);
    // NOAA SFB1201 (Bay Entrance, outside): ebb and flood maxima and slacks, spring tides; model at the station
    const NO = [['2026-09-29 23:57', 'ebb', -4.3], ['2026-09-30 00:56', 'ebb', -4.42], ['2026-09-30 07:23', 'flood', 2.9], ['2026-09-30 13:10', 'ebb', -3.2], ['2026-09-30 19:21', 'flood', 3.1]];
    const P = makeProjection(V.lat, V.lon), [x, z] = P.fwd(37.8106, -122.502), o = {}, fd = 61 * Math.PI / 180;
    const major = (t) => { tide.streams.atTime(x, z, t, o); return (o.x * Math.sin(fd) - o.z * Math.cos(fd)) / KT; };
    let dts = [], ratio = [];
    for (const [t, kind, sp] of NO) {
      const T = utc(t); let bt = T, bv = 0;
      for (let d = -120; d <= 120; d += 5) { const v = major(T + d * 60e3); if (kind === 'ebb' ? v < bv : v > bv) { bv = v; bt = T + d * 60e3; } }
      dts.push((bt - T) / 60e3); ratio.push(bv / sp);
    }
    const dtAbs = Math.max(...dts.map(Math.abs));
    console.log(`     SFB1201 max-current times, model − NOAA (min): ${dts.map(d => d.toFixed(0)).join(' ')}; speed ratios ${ratio.map(r => r.toFixed(2)).join(' ')}`);
    check(dtAbs <= 60 && Math.min(...ratio) > 0.5 && Math.max(...ratio) < 1.6, `Bay Entrance (NOAA SFB1201): current maxima within ${dtAbs.toFixed(0)} min, speeds ${Math.min(...ratio).toFixed(2)}–${Math.max(...ratio).toFixed(2)} × NOAA's`);
    // flow accelerates in the Gate: stronger there than in the open bay off the City Front and on the shoals
    const [bay] = maxOver(tide, 37.815, -122.37, V, utc('2026-09-28 12:00'), utc('2026-10-01 12:00'));
    check(ebb > 1.6 * bay, `the Gate (${ebb.toFixed(1)} kn) runs much harder than the bay off Treasure Island (${bay.toFixed(1)} kn)`);
  }
}
{
  const V = VENUES.find(v => v.id === 'solent'), tide = streamsOf('solent');
  if (!tide) check(false, 'Solent: no baked stream maps (node tools/bake-tide.mjs solent)');
  else {
    // springs: full moon 26 September 2026
    const [hurst] = maxOver(tide, 50.7055, -1.5465, V, utc('2026-09-26 00:00'), utc('2026-09-29 00:00'));
    check(hurst >= 3 && hurst <= 4.5, `Hurst Narrows, springs: ${hurst.toFixed(1)} kn (3–4.5)`);
    const [cowes] = maxOver(tide, 50.772, -1.31, V, utc('2026-09-26 00:00'), utc('2026-09-29 00:00'));
    const [shoal] = maxOver(tide, 50.795, -1.36, V, utc('2026-09-26 00:00'), utc('2026-09-29 00:00'));
    check(hurst > cowes && cowes > shoal, `strongest in the narrows, then the channel off Cowes (${cowes.toFixed(1)} kn), weakest over the Beaulieu shallows (${shoal.toFixed(1)} kn)`);
    // neaps are gentler than springs
    const [hN] = maxOver(tide, 50.7055, -1.5465, V, utc('2026-10-02 12:00'), utc('2026-10-05 12:00'));
    check(hN < 0.8 * hurst, `Hurst Narrows at neaps ${hN.toFixed(1)} kn, springs ${hurst.toFixed(1)} kn`);
  }
}

// ---------------------------------------------------------------- 3. the shallow-water solve: mass, stability, narrows, drying
{
  // a 24 × 10 km inlet: open sea at the west edge (1 m M2 + 0.3 m S2), a 1.2 km narrows, a basin with a tidal flat
  const v = { id: 'synthetic', lat: 50, lon: 0 };
  const la0 = 50 - 5000 / 110540, la1 = 50 + 5000 / 110540, lo0 = -12000 / (111320 * Math.cos(50 * Math.PI / 180)), lo1 = -lo0;
  const M = { box: [lo0, la0, lo1, la1], dx: 250, n: 0.025, sides: { W: { a: ['Sea'] } } };
  const gauges = [{ name: 'Sea', role: 'bc', x: -12000, z: 0, cons: [['M2', 1.0, 0], ['S2', 0.3, 30]] }];
  const m = new Model(v, M, gauges);
  m.h = new Float64Array(m.nx * m.nz);
  for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) {
    const x = m.xc[i], z = m.zc[j];
    let h = Math.abs(z) < 4000 ? 12 : -5;                                    // the inlet, 8 km wide
    if (Math.abs(x) < 1000 && Math.abs(z) > 600) h = -5;                      // the narrows: 1.2 km
    if (x > 7000 && z > 1500 && Math.abs(z) < 4000) h = -0.4;                 // a tidal flat 0.4 m above MSL
    m.h[j * m.nx + i] = h;
  }
  m.setup(); m.forcing({});
  const ms0 = utc('2026-06-01 00:00'), cell = (x, z) => { let i = 0, j = 0; while (m.xc[i + 1] < x) i++; while (m.zc[j + 1] < z) j++; return j * m.nx + i; };
  const kN = cell(0, 0), kW = cell(-6000, 0), kF = cell(9000, 2500);
  let maxN = 0, maxW = 0, fMin = 9, fMax = -9, ok = true;
  try {
    for (let c = 0; c < 36; c++) {                                            // 1.5 days in 1-hour runs
      m.t0 = c * 3600; m.run(ms0 + c * 3600e3, 1 / 24, 1 / 48, ['M2'], { M2: [] }, false);
      const sp = (k) => Math.hypot(0.5 * (m.U[k - 1] + m.U[k]), 0.5 * (m.V[k - m.nx] + m.V[k]));
      if (c > 12) { maxN = Math.max(maxN, sp(kN)); maxW = Math.max(maxW, sp(kW)); const d = m.eta[kF] + m.h[kF]; fMin = Math.min(fMin, d); fMax = Math.max(fMax, d); }
    }
  } catch (e) { ok = false; console.log('    ', e.message); }
  check(ok, 'shallow-water model: 1.5 days of spring tide through a narrows and over a flat without blowing up');
  check(ok && m.massErr.rel < 1e-9, `mass: volume change matches the boundary flux to ${m.massErr.rel.toExponential(1)} (relative)`);
  check(maxN > 3 * maxW, `the stream accelerates through the narrows: ${maxN.toFixed(2)} m/s against ${maxW.toFixed(2)} m/s in the open inlet`);
  check(fMin < 0.06 && fMax > 0.3, `the tidal flat dries (${fMin.toFixed(2)} m) and floods (${fMax.toFixed(2)} m) and never goes negative`);
}

// ---------------------------------------------------------------- 4. grounding on a drying bank at low water
{
  const tide = new Tide({ gauges: [{ role: 'level', name: 'Test', x: 0, z: 0, z0: 1.4, mhw: 1.0, cd: 'LAT', cons: [['M2', 1.2, 0]] }] });
  const c0 = utc('2026-09-26 00:00'); tide.setClock(c0);
  const ex = tide.ref.extremes(c0, c0 + 13 * 3600e3), hw = ex.find(e => e.hw), lw = ex.find(e => !e.hw);
  const world = new World({ id: 'bank', open: true, depth: 10 }, null);
  const n = 40, d = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -1000 + (i + 0.5) * 50, z = -1000 + (j + 0.5) * 50; d[j * n + i] = Math.hypot(x, z) < 250 ? -3 : 50; }  // a bank 0.3 m above MSL in 5 m of water
  world.setBathy(new Bathy({ nx: n, nz: n, x0: -1000, z0: -1000, dx: 50 }, d), tide);
  const env = makeSteadyEnv(8 * KT);
  const run = (t) => {
    tide.setTime((t - c0) / 1000);
    const b = new Boat('blackwatch'); b.reset(0, 0, 90 * Math.PI / 180);
    let ag = 0; for (let i = 0; i < 240; i++) { b.step(1 / 120, env, i / 120, world); ag = Math.max(ag, b.aground); }
    return { depth: world.depthAt(0, 0), ag };
  };
  const H = run(hw.t), L = run(lw.t);
  check(H.ag === 0 && H.depth > 0.61, `high water: ${H.depth.toFixed(2)} m over the bank, the Blackwatch (0.61 m draft) floats`);
  check(L.ag > 0.3 && L.depth < 0, `low water: the bank dries (${L.depth.toFixed(2)} m) and the keel is aground (${L.ag.toFixed(2)} m)`);
  check(Math.abs(world.chartDepthAt(0, 0) + 0.3 + 1.4) < 0.05, `the chart shows the bank as drying ${(-world.chartDepthAt(0, 0)).toFixed(1)} m above chart datum`);
}

console.log(bad ? `${bad} tide check(s) failed` : 'all tide checks passed');
process.exit(bad ? 1 : 0);
