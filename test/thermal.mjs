// Thermal winds: sea/lake breeze by day, land breeze by night, diurnal stability. Checks determinism,
// timing and direction at real venues from the real sun, the calm zone against an opposing gradient,
// and that open water (no thermal) is untouched. Run: node test/thermal.mjs
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
    thermal: { lat: v.lat, lon: v.lon, clock0, land: world(id) } });
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

// 3. Lake Garda (Riva, north end, calm gradient, midsummer): morning Pelèr from the north, afternoon Ora from the south
{
  const e = envAt('garda', '2026-07-15');
  const m6 = e.wind.mean(6 * 3600), m8 = e.wind.mean(8 * 3600), m15 = e.wind.mean(15 * 3600), m21 = e.wind.mean(20.5 * 3600);
  console.log(`     garda 06:00 ${fmt(m6)} | 08:00 ${fmt(m8)} | 15:00 ${fmt(m15)} | 20:30 ${fmt(m21)}`);
  check(kt(m6) > 2.5 && angIn(deg(m6), 330, 60), 'garda: Pelèr (N-NE) at dawn');
  check(kt(m8) < 1.5, 'garda: morning lull as the Pelèr dies and before the Ora');
  check(kt(m15) > 5 && angIn(deg(m15), 180, 240), 'garda: Ora (S-SW) mid-afternoon');
  check(kt(m21) < 1.5, 'garda: the Ora has died after sunset');
  // Ora with a southerly gradient adds; against a northerly gradient it makes a calm zone
  const up = envAt('garda', '2026-07-15', 8, 195).wind.mean(15 * 3600), dn = envAt('garda', '2026-07-15', 8, 15).wind.mean(15 * 3600);
  console.log(`     garda 15:00 with 8 kn from 195: ${fmt(up)} | with 8 kn from 015: ${fmt(dn)}`);
  check(kt(up) > 11 && kt(dn) < 5, 'garda: breeze adds to a gradient along it, calms one against it');
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

console.log(fails ? `${fails} FAILED` : 'all thermal checks passed');
process.exit(fails ? 1 : 0);
