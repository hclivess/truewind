// Real races (macro validation against real sailing): North Sails Cowes Week 2026 races of the one-design classes
// the game has (Dragon, Etchells, Contessa 32, Nordic Folkboat, J/70 as the sportboat), each sailed headless on its
// real course in the Solent, at its real date and time (the harmonic tide's level and streams for that moment), in
// the wind measured through the race on the Bramble pile in mid-Solent, by the game's autopilot
// (test/realraces/race.mjs). The data: test/realdata/*.json, built by tools/fetch-realraces.mjs, every value with its
// source URL (the race committee's courses and results pages, the Sailing Instructions' mark table, the Bramblemet
// archive).
//
//   node test/realraces.mjs           all 12 races (1.5-4 h of racing each; ~12 min wall on 14 workers)
//   QUICK=1 node test/realraces.mjs   the three shortest (J/70 race 10, Dragon and Etchells on the Friday)
//   IDS=cw26-d1-dragon,...  JOBS=n
// Writes test/out/realraces[-quick].md|json and test/out/validation/realraces.json; exits 1 on a fail.
//
// Checks, and why these tolerances:
//  - the course: the marks' great-circle length from the start line's middle to the finish's against the length the
//    race committee published, +-2% (it confirms the marks and the course were read right; the committee's own
//    figure is to 0.1 nm and its rounding of the lines is not given).
//  - the tide: the Bramble pile's tide gauge over the week against the game's harmonic tide there (TICON-4 constants
//    blended between the Solent gauges): rms of the de-meaned difference <= 0.15 m (the gauge is to chart datum and the
//    game to MSL, so the mean is taken out; the weather's surge, which the game does not model, stays in it), and no
//    time lag (best-fit lag within +-15 min).
//  - the race (the macro check): the autopilot's elapsed time against the real class's median elapsed time, +-15%.
//    The wind is one station's, 0.5-6 km from the course, 5 min means; the fleet sailed in each other's dirt and
//    tactics; the autopilot sails alone. A miss is a FAIL, reported, never widened.
//  - the polar (to tell the boat from the crew): a VMG router through the same marks in the same measured wind and
//    tide on the class's own polar (no tacking or rounding losses, perfect laylines) against the class winner's
//    elapsed time, +-15%. Slow here: the polar (the physics) is slow; fast here and the autopilot slow: the crew.
//  - seamanship: never aground (0 s), no capsize, no damage, no NaN.
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPool } from './lib/pool.mjs';
import { Register } from './lib/validation.mjs';
import { venue } from './seatrial/trial.mjs';
import { makeProjection } from '../js/world.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const E = process.env, QUICK = !!+(E.QUICK || 0);
const INDEX = JSON.parse(readFileSync(`${HERE}realdata/index.json`, 'utf8'));
const load = (id) => JSON.parse(readFileSync(`${HERE}realdata/${id}.json`, 'utf8'));
let ids = QUICK ? ['cw26-d4-sportboat', 'cw26-d7-dragon', 'cw26-d7-etchells'] : INDEX.races;
if (E.IDS) ids = E.IDS.split(',');
const name = E.OUT || (QUICK ? 'realraces-quick' : 'realraces');
const V = new Register(name);
const hms = (s) => { if (!Number.isFinite(s)) return "-"; s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const pct = (a, b) => `${a >= b ? '+' : ''}${Math.round((a / b - 1) * 100)}%`;

// ------------------------------------------------------------------ the courses as read
for (const id of ids) {
  const R = load(id), c = R.courseNm, q = c.throughMarks / c.published - 1;
  V.check({ section: id, quantity: 'course length through the marks', expected: `${c.published} nm (race committee)`, tol: '2%', source: `${R.sources.course}; marks: SI Table 4`, show: `${c.throughMarks} nm (${q >= 0 ? '+' : ''}${(q * 100).toFixed(1)}%)`, ok: Math.abs(q) <= 0.02 });
}

// ------------------------------------------------------------------ the tide on the Bramble pile
{
  const T = load(INDEX.tide), Vs = venue('solent'), P = makeProjection(Vs.v.lat, Vs.v.lon), [x, z] = P.fwd(T.lat, T.lon);
  const t0 = Date.parse(T.t0Utc), tide = Vs.tide;
  const lvl = (ms) => { tide.setClock(ms); tide.setTime(0); return tide.levelAt(x, z); };
  // (the gauge as read; less the surge figure it reports with it the fit is no better, 0.20 m: printed alongside)
  const fit = (lagMin, surge = false) => {
    const a = T.series.map((r) => r[1] - (surge ? r[2] ?? 0 : 0)), b = T.series.map((r) => lvl(t0 + (r[0] - lagMin) * 60e3));
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    return Math.sqrt(a.reduce((s, v, i) => s + (v - ma - (b[i] - mb)) ** 2, 0) / a.length);
  };
  let best = { lag: 0, rms: Infinity };
  for (let lag = -60; lag <= 60; lag += 5) { const r = fit(lag); if (r < best.rms) best = { lag, rms: r }; }
  const rms0 = fit(0), lessSurge = fit(0, true);
  const sec = 'Bramble pile tide gauge, 1-7 Aug 2026';
  V.check({ section: sec, quantity: 'tide height, rms of the de-meaned difference (game - gauge)', expected: '0 m', tol: '0.15 m', source: T.sources.data, show: `${rms0.toFixed(3)} m over ${T.series.length} half-hourly readings (${lessSurge.toFixed(3)} m less the gauge's surge figure)`, ok: rms0 <= 0.15 });
  V.check({ section: sec, quantity: 'tide: best-fit time lag (game behind gauge)', expected: '0 min', tol: '15 min', source: T.sources.data, show: `${best.lag} min (rms ${best.rms.toFixed(3)} m there)`, ok: Math.abs(best.lag) <= 15 });
}

// ------------------------------------------------------------------ the races
const cases = ids.map(load);
const n = Math.max(1, +(E.JOBS || Math.max(2, cpus().length - 2)));
const t0 = Date.now();
// the polars first, one job per class (the races then read them from the disk cache)
const classes = [...new Set(cases.map((c) => c.sim))];
await runPool(classes.map((cls) => ({ cls })), { n: Math.min(n, classes.length), mod: '../realraces/race.mjs', fn: 'bakePolar', timeoutMin: 60,
  onDone: (r) => console.log(`polar ${r.job.cls}: ${r.res.error || r.res.secs.toFixed(0) + ' s'}`) });
const results = await runPool(ids.map((id) => ({ id })), { n, mod: '../realraces/race.mjs', fn: 'runRealRace', timeoutMin: +(E.TIMEOUT_MIN || 120), onDone: (r, k, N) => {
  const x = r.res, R = cases.find((c) => c.id === r.job.id);
  console.log(`[${k}/${N} ${((Date.now() - t0) / 60e3).toFixed(1)}m] ${R.id.padEnd(20)} ${x.error ? 'ERROR ' + x.error : `${x.finished !== null ? hms(x.finished) : 'not finished (' + Math.round(x.toGo) + ' m to go after ' + hms(x.t) + ')'} vs median ${hms(R.results.median)}; polar ${hms(x.est)} vs best ${hms(R.results.best)}; ${x.tacks} tacks ${x.gybes} gybes, aground ${x.aground.toFixed(0)} s, wall ${x.wallSec.toFixed(0)} s`}`);
} });
const wall = (Date.now() - t0) / 1000;
const md = [`# Real races${QUICK ? ' (QUICK)' : ''}`, '', `${results.length} Cowes Week 2026 races, wall ${(wall / 60).toFixed(1)} min on ${n} workers. \`node test/realraces.mjs\`. Strip sail model at 120 Hz, the game's autopilot; wind: Bramblemet (5 min); tide: the game's harmonic tide at the race's date and time. Data: test/realdata/.`, '',
  '| Race | Class (sim) | Course | Wind (Bramble, mean, range, dir) | Real: best / median (n) | Sim (autopilot) | vs median | Polar router | vs best | Tacks / gybes | Aground | Result |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
const out = [];
for (const r of results.sort((a, b) => ids.indexOf(a.job.id) - ids.indexOf(b.job.id))) {
  const R = cases.find((c) => c.id === r.job.id), x = r.res, S = R.wind.series, sec = R.id;
  const mean = S.reduce((s, w) => s + w[1], 0) / S.length, lo = Math.min(...S.map((w) => w[1])), hi = Math.max(...S.map((w) => w[1]));
  let sx = 0, sy = 0; for (const w of S) { sx += w[1] * Math.sin(w[2] * Math.PI / 180); sy += w[1] * Math.cos(w[2] * Math.PI / 180); }
  const dir = Math.round((Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360);
  const src = `${R.sources.results} (elapsed); wind ${R.sources.wind}`;
  const st = [];
  if (x.error) { V.check({ section: sec, quantity: 'race run', expected: 'runs', source: '', show: x.error, ok: false }); st.push('fail'); }
  else {
    const fin = x.finished !== null, q = fin ? x.finished / R.results.median - 1 : NaN;
    st.push(V.check({ section: sec, quantity: `elapsed time, autopilot (${R.class} as ${R.sim})`, expected: `${hms(R.results.median)} (median of ${R.results.placed})`, tol: '15%', source: src,
      show: fin ? `${hms(x.finished)} (${pct(x.finished, R.results.median)})` : `not finished: ${(x.toGo / 1852).toFixed(2)} nm to go after ${hms(x.t)}`, ok: fin && Math.abs(q) <= 0.15 }) ? 'pass' : 'fail');
    const qe = x.est / R.results.best - 1;
    st.push(V.check({ section: sec, quantity: 'elapsed time, VMG router on the class polar (no tack or rounding losses)', expected: `${hms(R.results.best)} (class winner)`, tol: '15%', source: src,
      show: `${hms(x.est)} (${pct(x.est, R.results.best)})`, ok: Number.isFinite(qe) && Math.abs(qe) <= 0.15 }) ? 'pass' : 'fail');
    const bad = x.events.filter((e) => ['tear', 'blown', 'boom', 'holed', 'keel', 'rudder'].includes(e.type)).map((e) => e.type);
    st.push(V.check({ section: sec, quantity: 'seamanship: aground, capsize, damage, NaN', expected: 'none', source: 'seamanship (est.)',
      show: `${x.aground.toFixed(0)} s aground (least clearance ${x.minUK?.toFixed(1)} m)${x.capsized ? ', capsized' : ''}${bad.length ? ', ' + bad.join(' ') : ''}${x.rigDown ? ', dismasted: ' + x.rigWhy : ''}${x.nan ? ', NaN' : ''}`, ok: x.aground === 0 && !x.capsized && !bad.length && !x.rigDown && !x.nan }) ? 'pass' : 'fail');
  }
  const res = st.includes('fail') ? 'fail' : 'pass';
  md.push(`| ${R.race} | ${R.class} (${R.sim}) | ${R.course.map((m) => m.name).join(', ')}, ${R.finish.name} (${R.courseNm.published} nm) | ${mean.toFixed(1)} kn (${lo}-${hi}) from ${dir}° | ${hms(R.results.best)} / ${hms(R.results.median)} (${R.results.placed}) | ${x.error ? 'error' : x.finished !== null ? hms(x.finished) : `DNF (${(x.toGo / 1852).toFixed(1)} nm to go)`} | ${x.finished ? pct(x.finished, R.results.median) : '-'} | ${hms(x.est)} | ${Number.isFinite(x.est) ? pct(x.est, R.results.best) : '-'} | ${x.tacks ?? '-'} / ${x.gybes ?? '-'} | ${x.aground?.toFixed(0) ?? '-'} s | ${res} |`);
  out.push({ id: R.id, race: R.race, class: R.class, sim: R.sim, windKn: +mean.toFixed(1), windDir: dir, real: R.results, result: res, metrics: x });
}
md.push('', 'Sources per race: test/realdata/<id>.json (`sources`). The wind is the Bramble pile\'s, the same for the whole course; the game\'s puffs and shifts are laid over it.');
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/${name}.md`, md.join('\n') + '\n');
writeFileSync(`${HERE}out/${name}.json`, JSON.stringify(out, null, 1));
V.save({ wall });
const nf = out.filter((o) => o.result === 'fail').length;
console.log(`${out.length - nf} passed, ${nf} failed in ${(wall / 60).toFixed(1)} min — test/out/${name}.md`);
process.exit(V.failed ? 1 : 0);
