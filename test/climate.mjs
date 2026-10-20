// Climate (js/climate.js) and the weather it brings (env.js Weather with a climate): snow only where and when it
// really snows at the water, the season's temperatures, fog where it is typical, the same weather for the same
// seed and clock (a shared room), and the air's density from its temperature.
import { Weather, Environment, airDensity, KT } from '../js/env.js';
import { CLIMATE, climateFor, seasonAt, snowShare, diurnal } from '../js/climate.js';
import { mist } from '../js/wx.js';
import { VENUES } from '../js/world.js';
import { snowLevels, rainLevels } from '../js/audio.js';
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const V = Object.fromEntries(VENUES.map(v => [v.id, v]));
const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
// UTC ms at local solar hour h on the 15th of month m (2025)
const at = (v, m, h) => Date.UTC(2025, m, 15) + (h - v.lon / 15) * 3.6e6;
const place = (id) => id === 'open' ? { lat: 32, lon: -40 } : V[id];
const mk = (id, mode, seed, clock0, tws = 12) => { const p = place(id); return new Weather({ mode, seed, tws: tws * KT, twd: 0, climate: { id, lat: p.lat, lon: p.lon, clock0 } }); };
// sample a month: many days (seeds) through the day; precipitation at a few points
function survey(id, m, mode = 'changing', seeds = 40) {
  const p = place(id), o = {};
  let n = 0, wet = 0, snow = 0, sleet = 0, fog = 0, Tmin = Infinity, Tmax = -Infinity, Tsum = 0;
  for (let s = 1; s <= seeds; s++) {
    const W = mk(id, mode, s * 13 + 1, at(p, m, 0));
    for (let t = 0; t < 86400; t += 1800) {
      n++;
      const T = W.airTemp(t); Tmin = Math.min(Tmin, T); Tmax = Math.max(Tmax, T); Tsum += T;
      let r = 0, sn = 0;
      for (const [x, z] of [[0, 0], [3000, 0], [0, -3000]]) { W.sky(x, z, t, o); if (o.rain > r) { r = o.rain; sn = o.snow; } }
      if (r > 0.05) { wet++; if (sn >= 0.95) snow++; else if (sn > 0.05) sleet++; }
      const f = W.fog(t); if (f && f.on > 0.5) fog++;
    }
  }
  return { n, wet: wet / n, snow, sleet, fog: fog / n, Tmin, Tmax, Tmean: Tsum / n };
}

// 1. never snow at the water where it never does, in any month and any weather
for (const id of ['progreso', 'sydney', 'sfbay', 'walvis', 'garda', 'auckland', 'open']) {
  let snow = 0, wet = 0;
  for (let m = 0; m < 12; m++) for (const mode of ['changing', 'squally']) { const r = survey(id, m, mode, 12); snow += r.snow + r.sleet; wet += r.wet; }
  check(snow === 0 && wet > 0, `${id}: no snow or sleet in any month (precipitation seen: ${wet > 0})`);
}
// 2. Kiel in January: grey, cold, and sometimes snow
{
  const r = survey('kiel', 0, 'changing', 60), p = V.kiel;
  const W = mk('kiel', 'changing', 5, at(p, 0, 12)), s = W.sky(0, 0, 0);
  check(r.snow + r.sleet > 0 && r.snow > 0, `Kiel January: snow in ${r.snow} and sleet in ${r.sleet} of ${Math.round(r.wet * r.n)} wet half-hours`);
  check(r.Tmean > -4 && r.Tmean < 5, `Kiel January: mean ${r.Tmean.toFixed(1)} °C (${r.Tmin.toFixed(1)}..${r.Tmax.toFixed(1)})`);
  check(s.overcast > 0.45, `Kiel January: overcast ${s.overcast.toFixed(2)} on a changing day`);
  const j = survey('kiel', 6, 'changing', 30);
  check(j.snow + j.sleet === 0, 'Kiel July: no snow');
  const sq = survey('southern', 0, 'squally', 30), sw = survey('southern', 6, 'changing', 30);
  check(sq.snow + sq.sleet > 0 && sw.snow > 0, `Drake Passage: snow or sleet in summer squalls (${sq.snow + sq.sleet}) and winter (${sw.snow} snow)`);
}
// 3. temperatures sane per venue and month: within the normals' range (with the day's spread), seasons the right way round
for (const id of Object.keys(CLIMATE)) {
  const C = climateFor(id), p = place(id);
  let ok = true, worst = '';
  for (let m = 0; m < 12; m++) {
    const r = survey(id, m, 'changing', 10);
    const lo = C.lo[m] - 4 * (C.tsd ?? 2.5) - 2, hi = C.hi[m] + 4 * (C.tsd ?? 2.5) + 2;
    if (!(r.Tmin > lo && r.Tmax < hi && Math.abs(r.Tmean - (C.hi[m] + C.lo[m]) / 2) < 3)) { ok = false; worst = `${MON[m]} ${r.Tmin.toFixed(1)}..${r.Tmax.toFixed(1)} mean ${r.Tmean.toFixed(1)}`; }
    if (!(C.hi[m] > C.lo[m] && C.sst[m] > -2 && C.sst[m] < 32 && C.hi[m] < 40 && C.lo[m] > -15)) { ok = false; worst = `table ${MON[m]}`; }
  }
  const jan = (C.hi[0] + C.lo[0]) / 2, jul = (C.hi[6] + C.lo[6]) / 2;
  if (id !== 'open' && Math.abs(p.lat) > 15 && (p.lat > 0 ? jul < jan : jul > jan)) { ok = false; worst = 'seasons reversed'; }
  check(ok, `${id}: temperatures Jan ${C.lo[0]}..${C.hi[0]}, Jul ${C.lo[6]}..${C.hi[6]} °C, sea ${C.sst[0]} / ${C.sst[6]} °C ${worst}`);
}
check(diurnal(6) < 0.01 && diurnal(15) > 0.99 && diurnal(3) < diurnal(22) && snowShare(0) === 1 && snowShare(2) === 0.5 && snowShare(4) === 0 && snowShare(-10, false) === 0, 'daily cycle and snow share');
// 4. the season's rain: a July day in Progreso brings afternoon showers (cells), a Walvis Bay day almost never
//    rains, steady weather is always dry
{
  const pr = survey('progreso', 6, 'changing', 60), wv = survey('walvis', 6, 'changing', 60), st = survey('kiel', 0, 'steady', 20);
  let aft = 0, cells = 0;
  for (let s = 1; s <= 60; s++) { const W = mk('progreso', 'changing', s * 13 + 1, at(V.progreso, 6, 12)); const c = W.activeCells(4 * 3600).length; cells += c; if (c) aft++; }
  check(pr.wet > 0.03 && aft > 3, `Progreso July: rain ${(pr.wet * 100).toFixed(1)}% of the time, cells mid-afternoon on ${aft} of 60 days`);
  let night = 0; for (let s = 1; s <= 60; s++) night += mk('progreso', 'changing', s * 13 + 1, at(V.progreso, 6, 2)).activeCells(0).length;
  check(night < cells / 3, `Progreso July: convection in the afternoon (${cells} cells at 16 h, ${night} at 2 h)`);
  check(wv.wet < 0.01, `Walvis Bay July: rain ${(wv.wet * 100).toFixed(2)}% of the time`);
  check(st.wet === 0, 'steady weather is fair: no precipitation');
  const kj = survey('kiel', 0, 'changing', 60);
  check(kj.wet > 0.08, `Kiel January: precipitation ${(kj.wet * 100).toFixed(0)}% of the time`);
}
// 5. fog where it is typical: the Golden Gate in summer (afternoon and night), Walvis Bay's nights; hardly at Progreso
{
  const p = V.sfbay;
  let julAft = 0, julNoon = 0, janAft = 0, wvN = 0, wvA = 0, prog = 0, N = 80;
  for (let s = 1; s <= N; s++) {
    const W = mk('sfbay', 'changing', s * 7 + 3, at(p, 6, 0)), J = mk('sfbay', 'changing', s * 7 + 3, at(p, 0, 0));
    julAft += W.fog(18 * 3600).on > 0.5; julNoon += W.fog(13 * 3600).on > 0.5; janAft += J.fog(18 * 3600).on > 0.5;
    const Wv = mk('walvis', 'changing', s * 7 + 3, at(V.walvis, 4, 0)); wvN += Wv.fog(4 * 3600).on > 0.5; wvA += Wv.fog(15 * 3600).on > 0.5;
    prog += mk('progreso', 'changing', s * 7 + 3, at(V.progreso, 6, 0)).fog(5 * 3600).on > 0.5;
  }
  check(julAft > 0.4 * N && julNoon < julAft / 3 && janAft < julAft / 3, `SF July fog in the evening on ${julAft} of ${N} days (${julNoon} at 13 h, ${janAft} on January evenings)`);
  check(wvN > 0.25 * N && wvA === 0, `Walvis Bay May fog before dawn on ${wvN} of ${N} nights, none in the afternoon`);
  check(prog === 0, 'Progreso July: no fog');
  // in the mist model: a dense bank with the 18 kn westerly through the Gate
  const W = mk('sfbay', 'changing', 1, at(p, 7, 0));
  let best = Infinity; for (let s = 1; s < 40; s++) { const Ws = mk('sfbay', 'changing', s, at(p, 7, 0)); for (let t = 17 * 3600; t < 22 * 3600; t += 600) best = Math.min(best, mist('changing', s, t, 5 * Math.PI / 180, 19, 37.8, 18, 0, {}, Ws.fog(t)).vis); }
  check(best < 400 && best > 120, `Golden Gate fog in an 18 kn westerly: visibility down to ${best.toFixed(0)} m`);
  void W;
}
// 6. determinism: the same seed and clock give the same weather, wherever and in whatever order it is asked
{
  const c0 = at(V.kiel, 0, 9), A = mk('kiel', 'changing', 77, c0), B = mk('kiel', 'changing', 77, c0), o1 = {}, o2 = {};
  let same = true;
  for (let t = 0; t < 30000; t += 97) { A.sky(100, -200, t, o1); A.airTemp(t + 5); }
  for (let t = 29999; t >= 0; t -= 211) { B.airTemp(t); }
  for (let t = 0; t < 30000; t += 97) {
    A.sky(100, -200, t, o1); B.sky(100, -200, t, o2);
    if (o1.rain !== o2.rain || o1.snow !== o2.snow || o1.overcast !== o2.overcast || A.airTemp(t) !== B.airTemp(t) || A.fog(t).on !== B.fog(t).on) same = false;
  }
  check(same, 'same seed + clock: the same rain, snow, cloud, temperature and fog, asked in any order');
  const C = mk('kiel', 'changing', 78, c0); let diff = false;
  for (let t = 0; t < 86400 * 3; t += 3600) if (C.airTemp(t) !== A.airTemp(t)) diff = true;
  check(diff, 'another seed: other weather');
  // through the Environment (as the game builds it), and the clock moved (the menu's time of day)
  const env = new Environment({ seed: 9, tws: 12 * KT, twd: 250, weather: 'changing', climate: { id: 'kiel', lat: 54.41, lon: 10.2, clock0: c0 } });
  const env2 = new Environment({ seed: 9, tws: 12 * KT, twd: 250, weather: 'changing', climate: { id: 'kiel', lat: 54.41, lon: 10.2, clock0: c0 + 7 * 3.6e6 } });
  env.setClock(c0 + 7 * 3.6e6, 0);
  let eq = true; for (let t = 0; t < 7200; t += 60) if (env.weather.airTemp(t) !== env2.weather.airTemp(t) || env.weather.sky(0, 0, t).rain !== env2.weather.sky(0, 0, t).rain) eq = false;
  check(eq, 'Environment.setClock gives the weather of an Environment built at that clock');
  check(env.wind.sample(0, 0, 100, {}).temp === env.weather.airTemp(100), 'the wind sample carries the air temperature');
  // without a climate the weather is the old one: 15 °C, no snow
  const plain = new Weather({ mode: 'changing', seed: 3 });
  check(plain.airTemp(100) === 15 && plain.sky(0, 0, 100).snow === 0 && plain.activeCells(1200).length === 0 && plain.fog(0) === null, 'no climate: the climate-free weather');
}
// 7. air density: ideal gas, 1.225 at 15 °C, denser in the cold
{
  const r15 = airDensity(15), rm5 = airDensity(-5), r30 = airDensity(30);
  check(Math.abs(r15 / 1.225 - 1) < 0.03 && Math.abs(r15 - 1.225) < 0.001, `air density ${r15.toFixed(4)} kg/m3 at 15 °C`);
  check(rm5 > r15 && r15 > r30 && rm5 / r30 > 1.1 && rm5 / r30 < 1.16, `-5 °C ${rm5.toFixed(3)}, +30 °C ${r30.toFixed(3)} kg/m3 (x${(rm5 / r30).toFixed(3)})`);
  check(airDensity(15, 1) / r15 > 1.025 && airDensity(15, 1) / r15 < 1.04, 'a squall outflow at 15 °C ~3% denser');
}
// 8. snow is heard as a hush, not as rain: no drops, the world muffled
{
  const a = snowLevels(0), b = snowLevels(1), c = snowLevels(0.3);
  check(a.hush === 0 && a.muffleF >= 17999 && b.muffleF < 2600 && c.muffleF < a.muffleF && c.muffleF > b.muffleF && b.hush > 0 && b.hush < rainLevels(1).hiss,
    `snow sound: hush ${b.hush.toFixed(3)}, lowpass ${a.muffleF.toFixed(0)} -> ${c.muffleF.toFixed(0)} -> ${b.muffleF.toFixed(0)} Hz`);
}
// 9. the table itself: every venue has a climate, every row twelve months
{
  const ids = VENUES.map(v => v.id).filter(id => !CLIMATE[id]);
  const rows = Object.values(CLIMATE).every(C => ['hi', 'lo', 'sst', 'wet', 'snow', 'fog', 'cloud', 'conv'].every(k => C[k].length === 12 && C[k].every(Number.isFinite)));
  const z = climateFor('custom', 60), zs = climateFor('custom', 10);
  check(ids.length === 0 && rows, `every venue has a twelve-month climate${ids.length ? ' (missing ' + ids + ')' : ''}`);
  check(z.snow[0] > 0 && z.snow[6] === 0 && zs.snow.every(v => v === 0) && seasonAt(z, Date.UTC(2025, 0, 15), 0).snowOK, 'custom places: a zonal climate (snow in a 60° N winter, never in the tropics)');
}
process.exit(fail ? 1 : 0);
