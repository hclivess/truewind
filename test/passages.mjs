// Passages (macro validation): sail from A to B in X hours. On the venues' real charts, depths, wind and tide, the
// autopilot navigating (and, for some, the competent helmsman of the sea trials steering its course), each passage is
// timed against an independent estimate from the class's own polar and the tide (test/passages/routing.mjs: a VMG
// router along the autopilot's planned route), and checked for grounding, tacks and gybes and arrival.
//
//   node test/passages.mjs            the full set (~40 passages, an hour or two of sim time each: hours)
//   QUICK=1 node test/passages.mjs    3 short passages (a harbour crossing each at Sydney and Auckland, a 2 nm reach)
//   IDS=solent,sydney  CLASSES=j24  JOBS=n  as test/seatrial.mjs
// Writes test/out/passages[-quick].md|json and test/out/validation/passages.json; exits 1 on a fail.
//
// Expected values and tolerances:
//  - time: the routed estimate +-15% (pass), +-25% (warn). The estimate is the polar's (flat water, steady wind; the
//    passage has the venue's sea and the game's default gusts, so she is expected a little slower than it: est.)
//    plus the tide. The task: +-10-15% of a routed estimate. Published real-world elapsed times are only quoted
//    where one exists for the class in like conditions (none found for these legs: see REAL below).
//  - arrival: the autopilot's 'arrived' within the time limit (1.8 x the estimate + 10 min).
//  - grounding: never aground (0 s); the keel's clearance printed.
//  - tacks / gybes: a beat of D nm: 1 to 2 + 3 D tacks (a VMG beat needs at least one; a sensible crew does not tack
//    every few hundred metres: est.); a reach: no tack and at most one gybe.
//  - no dismasting, capsize or NaN.
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPool } from './lib/pool.mjs';
import { Register } from './lib/validation.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const E = process.env, QUICK = !!+(E.QUICK || 0);
const NM = 1852;
// courses: from / to as [lat, lon] on a venue's chart (the autopilot's spot in deep enough water near each), or x, z
// in metres on Open Water (the wind from the north there)
const COURSES = {
  // Cowes (off the Royal Yacht Squadron) to Yarmouth, Isle of Wight: ~8 nm west along the Solent into the prevailing
  // south-westerly, through Hurst's tide
  solent: { id: 'solent', venue: 'solent', from: [50.7700, -1.3000], to: [50.7135, -1.4960], twd: 225, kind: 'beat', note: 'Cowes to Yarmouth' },
  // Sydney Harbour: Rose Bay to Clifton Gardens across the harbour, in the summer north-easterly
  sydney: { id: 'sydney', venue: 'sydney', from: [-33.8635, 151.2700], to: [-33.8410, 151.2545], twd: 45, kind: 'reach', note: 'Rose Bay to Clifton Gardens' },
  // Waitemata Harbour, Auckland: off North Head (Devonport) to Bastion Point, in the prevailing south-westerly
  auckland: { id: 'auckland', venue: 'auckland', from: [-36.8345, 174.8130], to: [-36.8470, 174.8330], twd: 230, kind: 'reach', note: 'North Head to Bastion Point' },
  // Open Water: 20 nm dead to windward, and 20 nm on a beam reach
  beat20: { id: 'beat20', venue: 'open', from: { x: 0, z: 0 }, to: { x: 0, z: -20 * NM }, twd: 0, kind: 'beat', note: '20 nm beat' },
  reach20: { id: 'reach20', venue: 'open', from: { x: 0, z: 0 }, to: { x: 20 * NM, z: 0 }, twd: 0, kind: 'reach', note: '20 nm beam reach' },
  reach2: { id: 'reach2', venue: 'open', from: { x: 0, z: 0 }, to: { x: 2 * NM, z: 0 }, twd: 0, kind: 'reach', note: '2 nm beam reach' },
};
// published real-world times for these legs in like conditions: none found for the classes here (club and cruising
// passage times for Cowes-Yarmouth are given without wind, tide or class; the Round the Island Race's results are for
// a 50 nm course and a fleet's wind of the day). Left empty rather than invented.
const REAL = {};
const SEVEN = ['dinghy', 'j24', 'catalina30', 'oceanis381', 'tp52', 'swan131', 'velsheda'];
let jobs = [];
const J = (cls, course, tws, tide = null, helm = 'ap') => jobs.push({ cls, course: COURSES[course], tws, tide, helm, seed: 11 });
if (QUICK) { J('j24', 'sydney', 15); J('catalina30', 'auckland', 15); J('tp52', 'reach2', 15); }
else {
  for (const c of SEVEN) for (const td of ['fair', 'foul']) J(c, 'solent', 15, td);
  for (const c of ['j24', 'catalina30', 'tp52']) for (const w of [8, 25]) J(c, 'solent', w, 'fair');
  for (const c of ['j24', 'catalina30']) J(c, 'solent', 15, 'fair', 'helm');
  for (const c of SEVEN) { J(c, 'sydney', 15, 'fair'); J(c, 'auckland', 15, 'fair'); }
  for (const c of ['oceanis381', 'tp52']) { J(c, 'beat20', 15); J(c, 'reach20', 15); }
}
const ids = E.IDS ? E.IDS.split(',') : null, clsF = E.CLASSES ? E.CLASSES.split(',') : null;
jobs = jobs.filter((j) => (!ids || ids.includes(j.course.id)) && (!clsF || clsF.includes(j.cls)));
const n = Math.max(1, +(E.JOBS || Math.max(2, cpus().length - 2)));
const name = E.OUT || (QUICK ? 'passages-quick' : 'passages');
console.log(`passages: ${jobs.length}, ${n} workers`);
const t0 = Date.now();
const hm = (s) => (Number.isFinite(s) ? `${Math.floor(s / 3600)}h${String(Math.round(s / 60) % 60).padStart(2, '0')}` : '-');

function judge(r) {
  const C = [], add = (k, s, v, exp) => C.push({ k, s, v, exp });
  const x = r.res;
  if (x.error) { add('run', 'fail', x.error, 'runs'); return C; }
  if (x.nan) add('nan', 'fail', 'NaN', 'none');
  const arrived = x.arrived !== null;
  add('arrival', arrived ? 'pass' : 'fail', arrived ? `${hm(x.arrived)}, ${Math.round(x.endDist)} m off B` : `not there after ${hm(x.t)} (${(x.endDist / NM).toFixed(2)} nm to go)`, 'arrives within 1.8 x estimate + 10 min');
  if (arrived && Number.isFinite(x.est)) {
    const q = x.arrived / x.est - 1;
    add('time', Math.abs(q) <= 0.15 ? 'pass' : Math.abs(q) <= 0.25 ? 'warn' : 'fail', `${hm(x.arrived)} vs routed ${hm(x.est)} (${q >= 0 ? '+' : ''}${Math.round(q * 100)}%)`, 'routed estimate +-15%');
  } else if (!Number.isFinite(x.est)) add('time', 'info', `estimate: no progress possible (${hm(x.t)} sailed)`, 'routed estimate');
  add('aground', x.aground === 0 ? 'pass' : 'fail', `${x.aground.toFixed(1)} s aground${x.minUK !== null ? `, least clearance ${x.minUK.toFixed(1)} m` : ''}`, '0 s');
  const D = x.distance / NM;
  if (r.job.course.kind === 'beat') { const hi = Math.round(2 + 3 * D); add('tacks', x.tacks >= 1 && x.tacks <= hi ? 'pass' : 'warn', `${x.tacks} tacks, ${x.gybes} gybes`, `1-${hi} tacks`); }
  else add('tacks', x.tacks === 0 && x.gybes <= 1 ? 'pass' : 'warn', `${x.tacks} tacks, ${x.gybes} gybes`, '0 tacks, <= 1 gybe');
  if (x.rigDown) add('dismast', 'fail', x.rigWhy, 'none');
  if (x.capsized) add('capsize', CLASSESlight(r.job.cls) ? 'warn' : 'fail', 'capsized', 'none (keelboat)');
  const bad = x.events.filter((e) => ['tear', 'blown', 'boom', 'holed', 'keel', 'rudder'].includes(e.type));
  if (bad.length) add('damage', 'fail', bad.map((e) => e.type).join(', '), 'none');
  return C;
}
const CLASSESlight = (c) => ['dinghy', 'cat', '470', '49er', 'optimist', 'sunfish', 'flyingscot'].includes(c);
const worst = (cs) => cs.reduce((s, c) => (c.s === 'fail' ? 'fail' : c.s === 'warn' && s !== 'fail' ? 'warn' : s), 'pass');

const results = await runPool(jobs, { n, mod: '../passages/passage.mjs', fn: 'runPassage', timeoutMin: +(E.TIMEOUT_MIN || 240), onDone: (r, k, N) => {
  r.checks = judge(r); r.st = worst(r.checks);
  const j = r.job;
  console.log(`[${k}/${N} ${((Date.now() - t0) / 60e3).toFixed(1)}m] ${r.st.toUpperCase().padEnd(4)} ${j.cls.padEnd(10)} ${j.course.id.padEnd(8)} ${String(j.tws).padStart(2)} kn ${(j.tide || '-').padEnd(4)} ${j.helm.padEnd(4)} ${r.checks.map((c) => `${c.k}: ${c.v}`).join(' | ')}`);
} });
const wall = (Date.now() - t0) / 1000;
// the report
const md = [`# Passages${QUICK ? ' (QUICK)' : ''}`, '', `${results.length} passages, wall ${(wall / 60).toFixed(1)} min on ${n} workers. \`node test/passages.mjs\`${QUICK ? ' (QUICK=1)' : ''}. Strip sail model (the game's beyond x2 time warp); the estimate from the same model's polar and the tide (test/passages/routing.mjs).`, '',
  '| Class | Course | Wind kn | Tide (stream along the course) | Helm | Estimate | Actual | Miss | Tacks/gybes | Aground | Result | Notes |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
const V = new Register(name === 'passages' ? 'passages' : name, { quiet: true });
for (const r of results.sort((a, b) => a.job.course.id.localeCompare(b.job.course.id) || a.job.cls.localeCompare(b.job.cls) || a.job.tws - b.job.tws)) {
  const x = r.res, j = r.job, miss = x.arrived !== null && Number.isFinite(x.est) ? `${Math.round((x.arrived / x.est - 1) * 100)}%` : '-';
  const notes = r.checks.filter((c) => c.s !== 'pass').map((c) => `${c.k}: ${c.v}`).join('; ');
  md.push(`| ${j.cls} | ${j.course.note} (${(x.distance / NM || 0).toFixed(1)} nm) | ${j.tws} | ${j.tide ? `${j.tide} (${x.stream?.toFixed(2)} kn, ${x.tideHour}h UTC)` : '-'} | ${j.helm} | ${hm(x.est)} | ${hm(x.arrived)} | ${miss} | ${x.tacks ?? '-'}/${x.gybes ?? '-'} | ${x.aground?.toFixed(0) ?? '-'} s | ${r.st} | ${notes.replace(/\|/g, '/')} |`);
  for (const c of r.checks) V.check({ section: `${j.course.id} ${j.cls} ${j.tws} kn${j.tide ? ' ' + j.tide : ''} ${j.helm}`, quantity: `passage ${c.k}`, expected: c.exp, tol: '', source: c.k === 'time' ? 'VMG routing on the class polar + harmonic tide (test/passages/routing.mjs)' : 'seamanship (est.)', show: c.v, status: c.s });
}
md.push('', 'Real-world references: none found for these classes on these legs in like conditions (see REAL in test/passages.mjs).');
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/${name}.md`, md.join('\n') + '\n');
writeFileSync(`${HERE}out/${name}.json`, JSON.stringify(results.map((r) => ({ ...r.job, course: r.job.course.id, status: r.st, checks: r.checks, metrics: r.res })), null, 1));
V.save({ wall });
const nf = results.filter((r) => r.st === 'fail').length;
console.log(`${results.length - nf} not failed, ${nf} failed in ${(wall / 60).toFixed(1)} min — test/out/${name}.md`);
process.exit(nf ? 1 : 0);
