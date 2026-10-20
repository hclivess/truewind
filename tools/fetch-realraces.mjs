// Builds test/realdata/*.json, the real races test/realraces.mjs sails: North Sails Cowes Week 2026 races of the
// one-design classes the game has, each with
//   - the course as the race committee set it (the "Races & courses" page: marks, rounding sides, the published
//     course length), the marks' positions from the Sailing Instructions' Table 4 (and its amendments),
//   - the start (the gun: each finisher's finish time less its elapsed time) and the fleet's elapsed times
//     (the daily results: every boat placed, OCS / DNF / RET / DNC left out),
//   - the wind measured on the Bramble pile in mid-Solent (Bramblemet: 5 min mean speed, vector-mean direction and
//     the 3 s gust, every 5 min) through the race, and the pile's tide gauge (for test/realraces.mjs's tide check).
// Downloads are cached in test/out/realraw/ (kept out of git); a second run reads them from there. Needs pdftotext
// (poppler) for the Sailing Instructions.
//
//   node tools/fetch-realraces.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RAW = `${ROOT}test/out/realraw/`, OUT = `${ROOT}test/realdata/`;
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 (truewind validation; github.com truewind)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, file, bin = false) {
  const f = RAW + file;
  if (!existsSync(f)) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    await sleep(1000);                                   // (politely: one request a second)
  }
  return bin ? f : readFileSync(f, 'utf8');
}
const CW = 'https://www.cowesweek.co.uk/web/code/php/main_c.php?map=cw-res&ui=cw-res&style=std&override=';
const SI = 'https://www.cowesweek.co.uk/web/download/2026/CW26-SailingInstructions.pdf';
const SI_AMEND = ['1', '2', '3', '4a'].map((n) => `https://www.cowesweek.co.uk/web/download/2026/CW26-SI-Amendment-${n}.pdf`);
const BRAMBLE = { name: 'Bramblemet (Bramble pile, mid-Solent)', lat: 50 + 47.41 / 60, lon: -(1 + 17.15 / 60), url: 'https://www.bramblemet.co.uk/' };
const ent = (s) => s.replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;?/g, ' ');

// the races: day of the week (1 = Saturday 1 August 2026), the class's name on the results and courses pages,
// its results race number, the game's class
const CASES = [
  { day: 1, name: 'Dragon', race: 1150, sim: 'dragon' },
  { day: 1, name: 'Etchells', race: 1160, sim: 'etchells' },
  { day: 2, name: 'Etchells', race: 2160, sim: 'etchells' },
  { day: 2, name: 'Dragon', race: 2150, sim: 'dragon' },
  { day: 2, name: 'Contessa 32', race: 2130, sim: 'contessa32' },
  { day: 3, name: 'Dragon', race: 3150, sim: 'dragon' },
  { day: 3, name: 'Folkboat (Race 5)', race: 5165, sim: 'folkboat' },
  { day: 3, name: 'Contessa 32', race: 3130, sim: 'contessa32' },
  { day: 4, name: 'Dragon', race: 4150, sim: 'dragon' },
  { day: 4, name: 'Etchells', race: 4160, sim: 'etchells' },
  { day: 4, name: 'J/70 (Race 10)', race: 10265, sim: 'sportboat' },
  { day: 6, name: 'J/70', race: 14265, sim: 'sportboat' },
  { day: 7, name: 'Dragon', race: 7150, sim: 'dragon' },
  { day: 7, name: 'Etchells', race: 7160, sim: 'etchells' },
  { day: 7, name: 'J/70', race: 15265, sim: 'sportboat' },
];
const CLASS_ID = { Dragon: 66, Etchells: 65, 'Contessa 32': 44, Folkboat: 40, 'J/70': 80 };

// ------------------------------------------------------------------ the marks (SI Table 4, amendments applied)
const pdf = async (url, file) => { const f = await get(url, file, true); return execFileSync('pdftotext', ['-layout', f, '-']).toString(); };
const marks = {};
const dm = (d, m) => +d + +m / 60;
const takeMarks = (txt, src) => {
  // "3D Salt Mead   50 44.51 01 23.04" (two columns to a line); the lines' and laid marks' rows the same
  for (const m of txt.matchAll(/(?:^|\s{2,})([0-9][0-9A-Z])\s+(\S+(?: \S+)*?)\s+`?\s*(\d\d) (\d\d\.\d{2,3}) (\d\d) (\d\d\.\d{2,3})/gm)) {
    const name = m[2].replace(/\s+/g, ' ').trim();
    marks[name] = { id: m[1], name, lat: +dm(m[3], m[4]).toFixed(6), lon: -dm(m[5], m[6]).toFixed(6), src };
  }
};
takeMarks(await pdf(SI, 'CW26-SailingInstructions.pdf'), 'SI Table 4');
for (const [i, u] of SI_AMEND.entries()) {
  const t = await pdf(u, `CW26-SI-Amendment-${i}.pdf`);
  for (const m of t.matchAll(/^(\w\w) (\S[^\n]*?\S)\s{2,}(\d\d) (\d\d\.\d\d) (\d\d) (\d\d\.\d\d)/gm)) {
    const name = m[2].trim();
    marks[name] = { id: m[1], name, lat: +dm(m[3], m[4]).toFixed(6), lon: -dm(m[5], m[6]).toFixed(6), src: `SI amendment ${['1', '2', '3', '4a'][i]}` };
  }
  // (amendment 4a renames 3S "SCRA.ORG.UK" to "SCRA.ORG.UK (displaying TeamO)": the courses page keeps the old name)
}
const markOf = (n) => {
  const k = Object.keys(marks).find((x) => x.toLowerCase() === n.toLowerCase());
  if (!k) throw new Error(`no mark "${n}" in the SI`);
  return marks[k];
};

// the standard finish lines (SI 14.2) and the RYS start line (SI 12.3): the RYS flagstaff (80) to Alpha (8A); the
// Breakwater line from Gamma (8G) to a committee vessel moored south of it (its distance not given: est. 300 m)
const LINES = {
  'RYS Start Line': () => ({ a: pos(markOf('RYS Flagstaff')), b: pos(markOf('Alpha')), note: 'SI 12.3a: the RYS flagstaff (80) in line with the RYS roof diamond, out to Alpha (8A)' }),
  'RYS Finish Line': () => ({ a: pos(markOf('RYS Flagstaff')), b: pos(markOf('Alpha')), note: 'SI 14.2a: between the RYS flagstaff (80) and Alpha (8A)' }),
  'Breakwater Finish Line': () => { const g = markOf('Gamma'); return { a: pos(g), b: [+(g.lat - 300 / 1852 / 60).toFixed(6), g.lon], note: 'SI 14.2c: between Gamma (8G) and a committee vessel moored south of it (est. 300 m south)' }; },
};
const pos = (m) => [m.lat, m.lon];

// ------------------------------------------------------------------ great-circle distance (nm)
const R_NM = 3440.065, rad = Math.PI / 180;
const gc = (a, b) => { const p1 = a[0] * rad, p2 = b[0] * rad, dl = (b[1] - a[1]) * rad; return 2 * R_NM * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)); };
const mid = (L) => [(L.a[0] + L.b[0]) / 2, (L.a[1] + L.b[1]) / 2];

// ------------------------------------------------------------------ the wind and tide on the Bramble pile
const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
async function bramble(dayOfMonth) {
  const name = `Bra${String(dayOfMonth).padStart(2, '0')}Aug2026.csv`;
  const t = await get(`https://www.bramblemet.co.uk/archive/2026/August/CSV/${name}`, name);
  // date, time (BST: the archive's own clock, UTC+1 in summer; its tide column agrees with the harmonic tide to
  // r = 0.997 with that offset and 0.83 without), then by the file's own header: WSPD kn, WD deg true, GST kn, DEPTH
  // (the tide, m above CD), ... A column the station did not report that day is left out of the file altogether
  // (2 August 2026 has no WD: its vane was out), so the columns are found by name.
  const lines = t.trim().split(/\r?\n/), H = lines[0].replace(/"/g, '').split(',').map((s) => s.trim().toUpperCase());
  const col = (k) => H.indexOf(k);
  const [iS, iD, iG, iT, iU] = ['WSPD', 'WD', 'GST', 'DEPTH', 'SURGE'].map(col);
  return lines.filter((l) => /^"?\d\d\/\d\d\/\d{4}/.test(l)).map((l) => l.replace(/"/g, '').split(',')).map((r) => {
    const [hh, mm] = r[1].split(':').map(Number);
    return { utc: Date.UTC(2026, 7, dayOfMonth, hh - 1, mm), ws: +r[iS], wd: iD < 0 || r[iD] === '' ? NaN : +r[iD], gs: iG < 0 ? NaN : +r[iG], tide: iT < 0 ? NaN : +r[iT], surge: iU < 0 || r[iU] === '' ? NaN : +r[iU] };
  });
}

// ------------------------------------------------------------------ the pages
const sec = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
const statusUrl = (d) => `${CW}&section=racing&page=racestatus2026&setday=${d}`;
const resultsUrl = (d, cls, race) => `${CW}&section=takingpart&page=results2026&showentrants=0&dayrequest=${d}&classrequest=${cls}/${race}&submit=`;
function coursesOf(html) {
  const out = [];
  for (const p of html.split(/<h5>/).slice(1)) {
    const line = p.split('<')[0].trim();
    for (const m of p.matchAll(/<tr>\s*<td[^>]*><span class="c1">([^<]*)<\/span><\/td>\s*<td[^>]*><span class="c2">([^<]*)<\/span><\/td>\s*<td[^>]*><span class="c3">([^<]*)<\/span><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      const legs = ent(m[4]).split(/<br\/?>/).map((s) => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
      const nm = legs.length ? +((legs[legs.length - 1].match(/\(([\d.]+)nm\)/) || [])[1] || NaN) : NaN;
      out.push({ line, cls: m[1].trim(), start: m[2].trim(), finished: m[3].trim(), legs: legs.map((s) => s.replace(/\s*\([\d.]+nm\)/, '')), nm });
    }
  }
  return out;
}
function resultsOf(html) {
  const i = html.indexOf('resultspage'), body = html.slice(i, html.indexOf('footer-logo-section', i));
  const trs = body.split(/<tr/i).slice(1).map((tr) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => ent(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()));
  const head = trs.find((c) => c.includes('Elapsed'));
  const iE = head.indexOf('Elapsed'), iF = head.indexOf('Finished'), iP = head.indexOf('Pos');
  const rows = trs.filter((c) => c !== head && c.length > iP);
  const placed = rows.filter((c) => /^\d+$/.test(c[iP]) && /^\d\d:\d\d:\d\d$/.test(c[iE]));
  return { placed: placed.map((c) => ({ sail: c[0], name: c[1], finished: c[iF], elapsed: c[iE], pos: +c[iP] })), others: rows.filter((c) => !/^\d+$/.test(c[iP])).map((c) => `${c[0]} ${c[iP]}`) };
}

const index = [], skipped = [];
for (const C of CASES) {
  const base = C.name.replace(/ \(Race \d+\)/, '');
  const status = coursesOf(await get(statusUrl(C.day), `cw26-status-d${C.day}.html`));
  const res = resultsOf(await get(resultsUrl(C.day, CLASS_ID[base], C.race), `cw26-res-d${C.day}-${C.race}.html`));
  const fin = res.placed;
  const el = fin.map((r) => sec(r.elapsed)).sort((a, b) => a - b);
  // the gun: the first boat's finish time less its elapsed time (BST)
  const first = fin.find((r) => r.pos === 1) || fin[0];
  const gunBst = sec(first.finished) - sec(first.elapsed);
  const hhmm = `${String(Math.floor(gunBst / 3600)).padStart(2, '0')}:${String(Math.floor(gunBst / 60) % 60).padStart(2, '0')}`;
  const course = status.find((c) => c.cls === C.name && c.start === hhmm) || status.find((c) => c.cls.replace(/ \(Race \d+\)/, '') === base && c.start === hhmm);
  if (!course) throw new Error(`no course for ${C.name} day ${C.day} start ${hhmm}`);
  if (course.line !== 'RYS Start Line') throw new Error(`${C.name} day ${C.day}: started on ${course.line} (position not published)`);
  const legs = course.legs.map((s) => { const m = s.match(/^(.*?)(?:\((\w\w)\))?$/); return { name: m[1].trim(), side: m[2] || null }; });
  const finLeg = legs.pop();
  const start = LINES['RYS Start Line']();
  const finish = LINES[finLeg.name] ? { kind: 'line', name: finLeg.name, ...LINES[finLeg.name]() } : { kind: 'mark', name: finLeg.name, at: pos(markOf(finLeg.name)), note: 'SI 14.3: between the mark and a committee vessel (the mark itself taken)' };
  const cm = legs.map((l) => { const m = markOf(l.name); return { name: m.name, id: m.id, lat: m.lat, lon: m.lon, side: l.side, src: m.src, laid: /^Laid mark/.test(m.name) }; });
  // the course length through the marks, from the start line's middle to the finish's
  const pts = [mid(start), ...cm.map((m) => [m.lat, m.lon]), finish.kind === 'line' ? mid(finish) : finish.at];
  let nm = 0; for (let i = 1; i < pts.length; i++) nm += gc(pts[i - 1], pts[i]);
  const gunUtc = Date.UTC(2026, 7, C.day, 0, 0) + (gunBst - 3600) * 1000;
  // the wind from 10 min before the gun to 15 min after the last finisher
  const met = (await bramble(C.day)).filter((r) => r.utc >= gunUtc - 600e3 && r.utc <= gunUtc + (el[el.length - 1] + 900) * 1000);
  const wind = met.filter((r) => r.ws > 0 && Number.isFinite(r.wd)).map((r) => [Math.round((r.utc - gunUtc) / 1000), r.ws, r.wd, r.gs >= r.ws ? r.gs : null]);
  const med = el.length % 2 ? el[(el.length - 1) / 2] : (el[el.length / 2 - 1] + el[el.length / 2]) / 2;
  // the wind must cover the race: at least 75% of the 5 min readings from the gun to the median finish, no gap over 20 min
  const inRace = wind.filter((w) => w[0] >= 0 && w[0] <= med), slots = Math.floor(med / 300) + 1;
  let gap = 0; for (let i = 1; i < wind.length; i++) gap = Math.max(gap, wind[i][0] - wind[i - 1][0]);
  if (inRace.length < 0.75 * slots || gap > 1200) {
    const why = `Bramblemet: ${inRace.length} of ${slots} wind readings with a direction through the race${met.length && !met.some((r) => Number.isFinite(r.wd)) ? ' (no WD column that day: the vane was out)' : ''}`;
    skipped.push({ race: `${C.name}, day ${C.day}`, why }); console.log(`skipped ${C.name} day ${C.day}: ${why}`); continue;
  }
  const id = `cw26-d${C.day}-${C.sim}`;
  const J = {
    id, event: 'North Sails Cowes Week 2026', race: `${C.name}, ${['', 'Sat 1', 'Sun 2', 'Mon 3', 'Tue 4', 'Wed 5', 'Thu 6', 'Fri 7'][C.day]} August 2026`,
    class: base, sim: C.sim, venue: 'solent', date: `2026-08-0${C.day}`, gunUtc: new Date(gunUtc).toISOString(),
    start: { kind: 'line', name: 'RYS Start Line', ...start },
    course: cm, finish,
    courseNm: { published: course.nm, throughMarks: +nm.toFixed(2) },
    results: { placed: fin.length, notPlaced: res.others, best: el[0], median: med, worst: el[el.length - 1], elapsed: el },
    wind: { station: BRAMBLE.name, lat: +BRAMBLE.lat.toFixed(5), lon: +BRAMBLE.lon.toFixed(5), measured: '5 min mean speed (kn), vector-mean direction (deg true), max 3 s gust (kn); archive clock BST', cols: ['t s from the gun', 'kn', 'deg', 'gust kn'], series: wind },
    sources: {
      course: statusUrl(C.day), results: resultsUrl(C.day, CLASS_ID[base], C.race), marks: SI, marksAmendments: SI_AMEND,
      wind: `https://www.bramblemet.co.uk/archive/2026/August/CSV/Bra${String(C.day).padStart(2, '0')}Aug2026.csv`,
    },
  };
  writeFileSync(`${OUT}${id}.json`, JSON.stringify(J, null, 1).replace(/\[\s+([-\d.,\s]+?)\s+\]/g, (m, s) => `[${s.replace(/\s+/g, ' ')}]`));
  index.push(id);
  const mean = wind.reduce((s, w) => s + w[1], 0) / wind.length;
  console.log(`${id}: ${C.name} gun ${hhmm} BST, ${fin.length} placed, best ${el[0]} s, median ${med} s; course ${course.nm} nm published, ${nm.toFixed(2)} through the marks; Bramble ${mean.toFixed(1)} kn (${wind.length} pts)`);
}
// the tide gauge on the pile, a week of it (every 30 min: test/realraces.mjs compares it with the harmonic tide)
const tide = [];
for (let d = 1; d <= 7; d++) for (const r of await bramble(d)) if (r.tide > 0 && new Date(r.utc).getUTCMinutes() % 30 === 0) tide.push([Math.round((r.utc - Date.UTC(2026, 7, 1)) / 60e3), r.tide, Number.isFinite(r.surge) ? r.surge : null]);
writeFileSync(`${OUT}bramble-tide-2026-08.json`, JSON.stringify({
  station: BRAMBLE.name, lat: +BRAMBLE.lat.toFixed(5), lon: +BRAMBLE.lon.toFixed(5), measured: 'tide height above chart datum (m) and the surge the station reports with it (m: the weather part of the level), every 30 min',
  t0Utc: '2026-08-01T00:00:00Z', cols: ['min from t0 (UTC)', 'm above CD', 'surge m'], series: tide,
  sources: { data: 'https://www.bramblemet.co.uk/archive/2026/August/CSV/Bra01Aug2026.csv (to Bra07Aug2026.csv)', about: 'https://www.bramblemet.co.uk/about.aspx' },
}).replace(/\],\[/g, '],[')) ;
writeFileSync(`${OUT}index.json`, JSON.stringify({ races: index, skipped, tide: 'bramble-tide-2026-08' }, null, 1));
console.log(`${index.length} races, ${tide.length} tide readings -> test/realdata/`);
