// Thermal winds: sea/lake breeze by day, land breeze by night, diurnal stability, and the regional
// forcing a venue's map cannot see (Garda's Ora and Pelèr, the Golden Gate westerly). Checks determinism,
// timing, strength and direction at real venues from the real sun, the calm zone against an opposing
// gradient, the menu's clock change, and that open water (no thermal) is untouched. Run: node test/thermal.mjs
import { Environment, KT, DEG } from '../js/env.js';
import { VENUES, World } from '../js/world.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const worlds = {};
const world = (id) => worlds[id] || (worlds[id] = new World(VENUES.find(v => v.id === id), JSON.parse(readFileSync(`data/venues/${id}.json`))));
// local solar midnight of a date at the venue, as the game's clock does (at(h) = day + (h - lon/15) h)
const envAt = (id, date, gustKt = 0.01, twd = 0, extra = {}) => {
  const v = VENUES.find(x => x.id === id);
  const clock0 = Date.parse(date + 'T00:00:00Z') - v.lon / 15 * 3600e3;
  return new Environment({ tws: gustKt * KT, twd, gust: 0.5, shift: 6, seed: 9, weather: 'steady', ...extra,
    thermal: { lat: v.lat, lon: v.lon, clock0, land: world(id), regional: v.regional } });
};
const kt = (m) => m.speed / KT, deg = (m) => ((m.dir / DEG) % 360 + 360) % 360;
const angIn = (a, lo, hi) => lo <= hi ? a >= lo && a <= hi : a >= lo || a <= hi;
const fmt = (m) => `${kt(m).toFixed(1)} kn from ${deg(m).toFixed(0).padStart(3, '0')}`;

// 1. determinism: two environments, sampled in different orders, agree bit for bit
{
  const a = envAt('garda', '2026-07-15', 8, 195, { weather: 'squally' }), b = envAt('garda', '2026-07-15', 8, 195, { weather: 'squally' });
  const pts = []; for (let t = 30000; t < 60000; t += 1777) for (let x = -2000; x <= 2000; x += 1000) pts.push([x, x * 0.5 - 3000, t]);
  const ra = pts.map(([x, z, t]) => { const o = a.wind.sample(x, z, t, {}); return [o.speed, o.dir]; });
  const rb = pts.slice().reverse().map(([x, z, t]) => { const o = b.wind.sample(x, z, t, {}); return [o.speed, o.dir]; }).reverse();
  a.waves.update(50000); b.waves.update(20000); b.waves.update(50000);
  check(ra.every((r, i) => r[0] === rb[i][0] && r[1] === rb[i][1]) && a.waves.Hs === b.waves.Hs, `deterministic in (seed, position, t) (${pts.length} samples, any order)`);
}

// 2. open water: no thermal -> trend is the gradient trend, and an all-water "land" adds nothing
{
  const o = { tws: 7, twd: 200, gust: 0.6, shift: 8, seed: 42, weather: 'changing' };
  const plain = new Environment(o);
  const sea = { R: 6000, sdfAt: () => 5000, landHeight: () => -1 };
  const wet = new Environment({ ...o, thermal: { lat: 45, lon: 10, clock0: Date.parse('2026-07-15T12:00:00Z'), land: sea } });
  let same = true, dmax = 0;
  for (let t = 0; t < 7200; t += 97) {
    const a = plain.weather.trend(t), s = plain.weather.synoptic(t);
    same &&= a.f === s.f && a.d === s.d;
    const p = plain.wind.sample(300, -200, t, {}), q = wet.wind.sample(300, -200, t, {});
    dmax = Math.max(dmax, Math.abs(p.speed - q.speed), Math.abs(p.dir - q.dir));
  }
  check(same, 'open water: trend(t) === synoptic(t)');
  check(dmax < 1e-9, `open water: an all-water venue at noon is unchanged (max diff ${dmax.toExponential(1)})`);
}

// 3. Lake Garda (Riva, north end, calm gradient, midsummer), local solar time (CEST = solar + 1.3 h): the Pelèr
//    down the lake from the small hours to late morning (10-20 kn), a lull, the Ora up it from about noon
//    (15-25 kn mid-afternoon), gone by the evening; in January no Ora
{
  const e = envAt('garda', '2026-07-15'), m = (h) => e.wind.mean(h * 3600);
  const m3 = m(3), m6 = m(6), m8 = m(8), m10 = m(10.2), m12 = m(12), m15 = m(15), m17 = m(17), m20 = m(20.3);
  console.log(`     garda 03:00 ${fmt(m3)} | 06:00 ${fmt(m6)} | 08:00 ${fmt(m8)} | 10:12 ${fmt(m10)} | 12:00 ${fmt(m12)}`);
  console.log(`           15:00 ${fmt(m15)} | 17:00 ${fmt(m17)} | 20:18 ${fmt(m20)}`);
  const N = (w) => angIn(deg(w), 345, 35), S = (w) => angIn(deg(w), 180, 220);
  check([m3, m6, m8].every(w => kt(w) >= 9 && kt(w) <= 20 && N(w)), 'garda: Pelèr (N-NNE) 10-20 kn from the small hours through the early morning');
  check(kt(m10) < 4, 'garda: late-morning lull as the Pelèr dies and before the Ora');
  check(kt(m12) > 10 && S(m12), 'garda: the Ora is in by noon');
  check([m15, m17].every(w => kt(w) >= 15 && kt(w) <= 25 && S(w)), 'garda: Ora (S-SSW) 15-25 kn through the afternoon');
  check(kt(m20) < 3, 'garda: the Ora has died by the evening');
  const jan = envAt('garda', '2026-01-15').wind.mean(15 * 3600);
  console.log(`     garda jan 15:00 ${fmt(jan)}`);
  check(kt(jan) < 6 && !S(jan), 'garda: no Ora under the January sun');
  // Ora with a southerly gradient adds; against a northerly gradient it makes a calm zone
  const up = envAt('garda', '2026-07-15', 8, 195).wind.mean(15 * 3600), dn = envAt('garda', '2026-07-15', 8, 15).wind.mean(15 * 3600);
  console.log(`     garda 15:00 with 8 kn from 195: ${fmt(up)} | with 8 kn from 015: ${fmt(dn)}`);
  check(kt(up) > 25 && kt(dn) < kt(up) - 14, 'garda: breeze adds to a gradient along it, is cut down by one against it');
}

// 3b. San Francisco (City Front, calm gradient): the Gate westerly is the Pacific against the Central Valley,
//     far off the map. July: light in the morning, 15-25 kn WSW through the afternoon, still blowing at dusk;
//     January: little of it. (PDT = solar + 1.2 h)
{
  const e = envAt('sfbay', '2026-07-15'), m = (h) => e.wind.mean(h * 3600);
  const m9 = m(9), m13 = m(13), m16 = m(16), m20 = m(20), m4 = m(4);
  console.log(`     sfbay jul 04:00 ${fmt(m4)} | 09:00 ${fmt(m9)} | 13:00 ${fmt(m13)} | 16:00 ${fmt(m16)} | 20:00 ${fmt(m20)}`);
  const W = (w) => angIn(deg(w), 235, 275);
  check(kt(m9) < 8, 'sfbay: light in the morning');
  check([m13, m16].every(w => kt(w) >= 15 && kt(w) <= 25 && W(w)), 'sfbay: 15-25 kn W-WSW through the afternoon (not the map\'s own north-easterly)');
  check(kt(m16) > kt(m13) && kt(m20) > 10 && W(m20), 'sfbay: peaks late in the afternoon and is still blowing at dusk');
  const jan = envAt('sfbay', '2026-01-15').wind.mean(15 * 3600);
  console.log(`     sfbay jan 15:00 ${fmt(jan)}`);
  check(kt(jan) < kt(m16) / 2, 'sfbay: weak in winter');
  // uniform over the area, as a regional flow is: the same westerly at the Gate side and off the city
  const f = envAt('sfbay', '2026-07-15', 0.01, 0, { gust: 0 }), a = f.wind.sample(-2500, -500, 16 * 3600, {}), b = f.wind.sample(2000, 1000, 16 * 3600, {});
  check(Math.abs(kt(a) - kt(b)) < 3 && W(a) && W(b), `sfbay: the westerly across the area, not a local breeze (puffs aside: ${fmt(a)} / ${fmt(b)})`);
}

// 3c. the menu's time of day: moving the clock of a built environment gives the breeze of one built at that clock
{
  const v = VENUES.find(x => x.id === 'garda'), c = (h) => Date.parse('2026-07-15T00:00:00Z') + (h - v.lon / 15) * 3600e3;
  const mk = (h) => new Environment({ tws: 0.01 * KT, twd: 0, gust: 0.5, shift: 6, seed: 9, weather: 'steady', thermal: { lat: v.lat, lon: v.lon, clock0: c(h), land: world('garda'), regional: v.regional } });
  const a = mk(6), b = mk(15);
  const before = a.wind.mean(600).speed; a.waves.update(600);
  a.setClock(c(15), 600);
  const pa = a.wind.sample(300, -800, 600, {}), pb = b.wind.sample(300, -800, 600, {});
  b.waves.update(600);
  console.log(`     garda: built at 06:00 ${(before / KT).toFixed(1)} kn -> clock moved to 15:00 ${(pa.speed / KT).toFixed(1)} kn (built at 15:00: ${(pb.speed / KT).toFixed(1)} kn)`);
  check(pa.speed === pb.speed && pa.dir === pb.dir && a.wind.mean(600).speed === b.wind.mean(600).speed && a.waves.Hs === b.waves.Hs, 'setClock: wind, mean wind and sea as if built at the new clock');
}

// 4. Kiel (north of the fjord mouth, 54 N): a summer sea breeze veering through the afternoon; none in December
{
  const e = envAt('kiel', '2026-07-15'), m12 = e.wind.mean(12 * 3600), m17 = e.wind.mean(17 * 3600), m3 = e.wind.mean(3 * 3600);
  const w = envAt('kiel', '2026-12-15').wind.mean(14 * 3600);
  console.log(`     kiel  jul 12:00 ${fmt(m12)} | 17:00 ${fmt(m17)} | 03:00 ${fmt(m3)} | dec 14:00 ${fmt(w)}`);
  let dv = deg(m17) - deg(m12); dv -= 360 * Math.round(dv / 360);
  check(kt(m12) > 5 && dv > 15, 'kiel: summer sea breeze veers (northern hemisphere)');
  check(kt(m3) < 5 && Math.abs(((deg(m3) - deg(m12) + 540) % 360) - 180) > 120, 'kiel: light land breeze the other way at night');
  check(kt(w) < 1 || Math.abs(((deg(w) - deg(m12) + 540) % 360) - 180) > 120, 'kiel: no onshore sea breeze under the December sun (at most the cold land\'s drainage)');
}

// 5. Sydney Harbour (34 S, January): sea breeze in from the east, backing (southern hemisphere)
{
  const e = envAt('sydney', '2026-01-15'), m12 = e.wind.mean(12 * 3600), m17 = e.wind.mean(17 * 3600);
  console.log(`     sydney jan 12:00 ${fmt(m12)} | 17:00 ${fmt(m17)}`);
  let dv = deg(m17) - deg(m12); dv -= 360 * Math.round(dv / 360);
  check(kt(m12) > 5 && angIn(deg(m12), 30, 120) && dv < -15, 'sydney: easterly sea breeze, backing through the afternoon');
}

// 6. diurnal stability near the shore: gustier and a touch stronger by day, lighter and steadier at night
{
  const stats = (t0) => {
    const e = envAt('kiel', '2026-07-15', 12, 250);
    let s = 0, s2 = 0, n = 0;
    for (let t = t0; t < t0 + 1800; t += 2) { const w = e.wind.sample(0, 0, t, {}); const v = w.speed; s += v; s2 += v * v; n++; }
    const m = s / n; return [m / KT, Math.sqrt(s2 / n - m * m) / m];
  };
  const [dm, dg] = stats(13 * 3600), [nm, ng] = stats(2 * 3600);
  console.log(`     kiel 12 kn from 250: day mean ${dm.toFixed(1)} kn, gust sd ${(dg * 100).toFixed(0)}% | night ${nm.toFixed(1)} kn, ${(ng * 100).toFixed(0)}%`);
  check(ng < dg, 'stability: steadier wind at night than by day');
}

// 7. the sea follows the thermal wherever it blows from: Garda's dawn Pelèr (from the north, against the
// venue's southerly gradient) raises a sea, and the afternoon Ora a full fetch-limited one (8 km fetch)
{
  const v = VENUES.find(x => x.id === 'garda');
  const e = envAt('garda', '2026-07-15', v.windKt, v.wind, { fetchKm: 8 });
  e.waves.update(5 * 3600); const dawn = e.waves.Hs;
  e.waves.update(15 * 3600); const aft = e.waves.Hs, m = e.wind.mean(15 * 3600);
  const U = m.speed, hsFL = 0.0016 * U * Math.sqrt(8000 / 9.81);     // JONSWAP fetch-limited estimate
  check(dawn > 0.15, `sea under the Pelèr against the gradient: Hs ${dawn.toFixed(2)} m at dawn`);
  check(Math.abs(aft / hsFL - 1) < 0.35, `sea under the Ora: Hs ${aft.toFixed(2)} m (fetch-limited ${hsFL.toFixed(2)} m in ${kt(m).toFixed(1)} kn)`);
}

console.log(fails ? `${fails} FAILED` : 'all thermal checks passed');
process.exit(fails ? 1 : 0);
