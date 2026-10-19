// Sea-trial validation suite: every class sailed through a short, realistic sail (leave on a close reach, beat with
// two tacks, bear away to a beam reach and hold it, broad reach or run under the kite, gybe, heave to) in a range of
// conditions, three ways (the game's autopilot; a scripted competent helmsman with the crew's auto-trim; the helm held
// fixed on a reach as a directional-stability probe), each judged against reference ranges from real boats
// (test/seatrial/refs.mjs, with sources). The acceptance gate for physics work.
//
//   node test/seatrial.mjs                 the full run (every class x every condition x 3 helms: hours)
//   QUICK=1 node test/seatrial.mjs         4 representative classes x 3 conditions x 3 helms (36 trials: ~3 min on
//                                          an idle 12-core machine, ~15 min on a heavily loaded one)
// Filters and options (environment):
//   CLASSES=j24,tp52      only these classes          CONDS=open-12-flat,solent   conditions whose id contains any
//   MODES=ap,helm,probe   which helmsmen               JOBS=n        worker processes (default: cores - 2)
//   SAILS=cloth|strip     sail model (cloth: the game's, at LOD; strip: 4x cheaper)   LOD=0|1 (default 1, the fleet's)
//   SCALE=1               leg length factor (shorter legs start each leg before she has settled from the last:
//                         below ~0.8 the legs' metrics run into each other)                             OUT=name  (test/out/<name>.md|json)
//   V=1                   every check of every trial on the console
//   REJUDGE=1             no sailing: judge the last run's metrics (test/out/<OUT>.json) again with the present ranges
// Writes test/out/seatrial[-quick].md (the tables) and .json (every metric); exits 1 on any fail.
// Deterministic: each condition's wind field and sea come from a seed hashed from its id.
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLASS_ORDER, CLASSES } from '../js/physics.js';
import { judge, overall } from './seatrial/judge.mjs';
import { R } from './seatrial/refs.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const E = process.env, QUICK = !!+(E.QUICK || 0), V = !!+(E.V || 0);

// ------------------------------------------------------------------ the matrix
const cond = (venue, tws, sea, gusty) => ({ id: `${venue}-${tws}-${sea ? 'sea' : 'flat'}-${gusty ? 'gusty' : 'steady'}`, venue, tws, sea, gusty });
const FULL_CONDS = [
  ...[6, 12, 18, 25, 32].map((w) => cond('open', w, false, false)),       // flat water, steady wind: the polar's own world
  ...[6, 12, 18, 25, 32].map((w) => cond('open', w, true, true)),         // the game's open-water seaway and its gusts
  cond('open', 18, true, false), cond('open', 18, false, true),           // the sea and the gusts apart, at 18
  ...[12, 18, 25].map((w) => cond('solent', w, true, true)),            // a tidal venue: the Solent's stream, fetch, depth
];
const QUICK_CONDS = [cond('open', 12, false, false), cond('open', 25, true, true), cond('solent', 18, true, true)];
// (sailrocket2 sails one tack only and is checked by test/speedcraft.mjs)
const ALL = CLASS_ORDER.filter((id) => !CLASSES[id].speed);
const QUICK_CLASSES = ['catalina30', 'tp52', 'velsheda', 'dinghy'];
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
const classes = list(E.CLASSES) || (QUICK ? QUICK_CLASSES : ALL);
for (const c of classes) if (!CLASSES[c]) { console.error('unknown class ' + c); process.exit(2); }
const condF = list(E.CONDS);
const conds = (QUICK ? QUICK_CONDS : FULL_CONDS).filter((c) => !condF || condF.some((f) => c.id.includes(f)));
const modes = list(E.MODES) || ['ap', 'helm', 'probe'];
const scale = +(E.SCALE || 1), sails = E.SAILS || 'cloth', lod = +(E.LOD ?? 1);
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) % 9973 + 1; };
const jobs = [];
for (const c of conds) for (const cls of classes) for (const mode of modes) jobs.push({ cls, cond: c, mode, seed: hash(c.id), scale, sails, lod });
// the heavy classes first (better packing across the workers)
const cost = (j) => (CLASSES[j.cls].loa > 20 ? 3 : CLASSES[j.cls].loa > 11 ? 2 : 1) * (j.mode === 'probe' ? 0.25 : 1) * (j.cond.venue === 'open' ? 1 : 1.3);
jobs.sort((a, b) => cost(b) - cost(a));
const nW = Math.max(1, Math.min(jobs.length, +(E.JOBS || Math.max(2, cpus().length - 2))));
const name = E.OUT || (QUICK ? 'seatrial-quick' : 'seatrial');
console.log(`sea trials: ${classes.length} classes x ${conds.length} conditions x ${modes.length} helms = ${jobs.length} trials, ${nW} workers, sails ${sails}${sails === 'strip' ? '' : ' L' + lod}, legs x${scale}`);

// ------------------------------------------------------------------ the pool
const t0 = Date.now();
const results = [];
const TIMEOUT = +(E.TIMEOUT_MIN || 45) * 60e3;
let next = 0, done = 0;
function short(checks) { return checks.filter((c) => c.s === 'fail').map((c) => `${c.k} ${c.v}`).concat(checks.filter((c) => c.s === 'warn').map((c) => `(w) ${c.k} ${c.v}`)); }
// REJUDGE=1: no sailing; the last run's metrics (test/out/<name>.json) judged again with the present ranges
const REJ = !!+(E.REJUDGE || 0);
let wallPrev = null;
if (REJ) {
  const P = JSON.parse(readFileSync(`${HERE}out/${name}.json`, 'utf8'));
  wallPrev = P.wall;
  const byId = Object.fromEntries([...FULL_CONDS, ...QUICK_CONDS].map((c) => [c.id, c]));
  for (const r of P.results) {
    const c = byId[r.cond]; if (!c || !classes.includes(r.cls) || !modes.includes(r.mode) || !conds.some((x) => x.id === c.id)) continue;
    const job = { cls: r.cls, cond: c, mode: r.mode, seed: r.seed, scale: r.scale, sails: r.sails, lod: r.lod };
    const checks = judge(r.metrics, c);
    results.push({ job, res: r.metrics, checks, st: overall(checks) });
  }
  console.log(`re-judged ${results.length} trials from test/out/${name}.json (${P.generated})`);
} else await new Promise((resolve) => {
  let live = 0;
  const spawn = () => {
    const w = fork(`${HERE}seatrial/worker.mjs`, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    live++;
    let cur = null, timer = null;
    const give = () => {
      if (next >= jobs.length) { w.send('exit'); return; }
      cur = { id: next, job: jobs[next++] };
      timer = setTimeout(() => { finish({ cls: cur.job.cls, cond: cur.job.cond.id, mode: cur.job.mode, error: `timeout after ${TIMEOUT / 60e3} min` }); w.kill(); }, TIMEOUT);
      w.send(cur);
    };
    const finish = (res) => {
      clearTimeout(timer);
      const job = cur.job; cur = null;
      const checks = judge(res, job.cond), st = overall(checks);
      results.push({ job, res, checks, st });
      done++;
      const mm = ((Date.now() - t0) / 60e3).toFixed(1);
      const s = short(checks);
      console.log(`[${String(done).padStart(4)}/${jobs.length} ${mm}m] ${st.toUpperCase().padEnd(4)} ${job.cls.padEnd(10)} ${job.cond.id.padEnd(22)} ${job.mode.padEnd(5)} ${res.wallSec ? res.wallSec.toFixed(0) + 's' : ''}  ${s.slice(0, 4).join(' | ')}`);
      if (V) for (const c of checks) console.log(`        ${c.s.padEnd(4)} ${c.k.padEnd(16)} ${c.v}`);
    };
    w.on('message', (m) => { if (m.ready) give(); else if (cur && m.id === cur.id) { finish(m.res); give(); } });
    w.on('exit', () => {
      live--;
      if (cur) { finish({ cls: cur.job.cls, cond: cur.job.cond.id, mode: cur.job.mode, error: 'worker died' }); }
      if (next < jobs.length) spawn();
      else if (live === 0) resolve();
    });
  };
  for (let i = 0; i < nW; i++) spawn();
});
const wall = wallPrev ?? (Date.now() - t0) / 1000;

// ------------------------------------------------------------------ the report
const ICON = { pass: 'pass', warn: 'WARN', fail: 'FAIL', info: '' };
const by = {};
for (const r of results) ((by[r.job.cls] ??= {})[r.job.cond.id] ??= {})[r.job.mode] = r;
const counts = { pass: 0, warn: 0, fail: 0 };
for (const r of results) counts[r.st]++;
const md = [];
md.push(`# Sea trials${QUICK ? ' (QUICK)' : ''}`, '');
md.push(`${results.length} trials (${classes.length} classes x ${conds.length} conditions x ${modes.join('/')}), sails ${sails}${sails === 'strip' ? '' : ' L' + lod}, legs x${scale}; ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail; wall ${(wall / 60).toFixed(1)} min on ${nW} workers. Generated by \`node test/seatrial.mjs\`${QUICK ? ' (QUICK=1)' : ''}; ranges and sources in test/seatrial/refs.mjs.`, '');
md.push('Conditions: `venue-tws-water-wind`. *open*: the game\'s Open Water (fetch-unlimited sea for the wind); *solent*: the real chart, depths and tide (a fixed spring morning), the sea over the real fetch. *flat*: no waves; *sea*: the environment\'s wave field. *gusty*: env gusts 0.5 and shifts +-7 deg (the game menu\'s defaults).', '');
md.push('| Condition | Hs m | Tp s | tidal stream kn | sea room m |', '|---|---|---|---|---|');
for (const c of conds) { const r = results.find((x) => x.job.cond.id === c.id && x.res.Hs !== undefined); if (r) md.push(`| ${c.id} | ${r.res.Hs.toFixed(2)} | ${r.res.Tp ? r.res.Tp.toFixed(1) : '-'} | ${r.res.stream !== undefined ? r.res.stream.toFixed(2) : '-'} | ${r.res.room ? Math.round(r.res.room) : 'open'} |`); }
md.push('');
// worst failures per class: how many trials failed each metric
md.push('## Worst failures per class', '', '| Class | trials pass/warn/fail | failing metrics (count of trials) | worst examples |', '|---|---|---|---|');
const summary = {};
for (const cls of classes) {
  const rs = results.filter((r) => r.job.cls === cls);
  const c = { pass: 0, warn: 0, fail: 0 }; for (const r of rs) c[r.st]++;
  const fm = {}; const ex = [];
  for (const r of rs) for (const k of r.checks) if (k.s === 'fail') { const key = k.k.replace(/^(tack[12])$/, 'tack'); fm[key] = (fm[key] || 0) + 1; if (ex.length < 4 && !ex.some((e) => e.startsWith(key))) ex.push(`${key} ${k.v} [${r.job.cond.id} ${r.job.mode}]`); }
  const top = Object.entries(fm).sort((a, b) => b[1] - a[1]);
  summary[cls] = { ...c, fails: fm };
  md.push(`| ${cls} | ${c.pass}/${c.warn}/${c.fail} | ${top.map(([k, n]) => `${k} (${n})`).join(', ') || '-'} | ${ex.join('; ').replace(/\|/g, '/') || '-'} |`);
}
md.push('');
// the digest: one row per class, the numbers behind the known complaints (where the trial exists)
{
  const get = (cls, cid, mode) => by[cls]?.[cid]?.[mode];
  const n = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d));
  const leg = (r, l) => r && r.res.legs && r.res.legs[l] && r.res.legs[l].st;
  const ratio = (r) => { const s = leg(r, 'beat1'); return s && s.polar ? s.u / s.polar : null; };
  md.push('## Digest', '', 'Upwind: the first beat\'s speed / polar in 12 kn flat (helm; the published reference in brackets where there is one). Heel: the first beat\'s mean heel in 18 and 25 kn flat (helm) / targetHeel (x: she was dismasted in that trial, the heel is not her sailing heel). Course: beam-reach heading rms, AP / helm, in 12 kn flat and 18 kn sea & gusts. Rig: the lowest rig safety factor in the trials to 18 kn, and dismastings to 18 kn / in all. Tacks: tacks stopped in irons / all tacks (AP + helm, 6-25 kn). Fixed helm: drift in 10 s in 12 kn flat (+ luffing).', '',
    '| Class | Upwind 12 kn / polar | Heel 18 / 25 kn (target) | Course rms 12 flat | Course rms 18 sea | Zig-zags | Rig SF min (to 18 kn) | Dismasted to 18 kn / all | Irons / tacks | Fixed helm 10 s |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const cls of classes) {
    const rs = results.filter((r) => r.job.cls === cls);
    const h12 = get(cls, 'open-12-flat-steady', 'helm'), kn = h12 && h12.checks.find((c) => c.k === 'knownVMG' || c.k === 'knownUpBsp');
    const heel = (cid) => { const r = get(cls, cid, 'helm'), s = leg(r, 'beat1'); return s ? n(s.heel.mean, 0) + (r.res.rigDown ? 'x' : '') : '-'; };
    const crs = (cid) => ['ap', 'helm'].map((m) => { const s = leg(get(cls, cid, m), 'beam'); return s ? n(s.herr.rms) : '-'; }).join(' / ');
    const zz = rs.filter((r) => r.checks.some((c) => c.k === 'zigzag' && c.s !== 'pass')).length;
    const low = rs.filter((r) => r.job.cond.tws <= 18 && r.res.struct);
    const sf = low.length ? Math.min(...low.map((r) => (r.res.struct.maxR > 0 ? 1 / r.res.struct.maxR : 99))) : null;
    const dm = (xs) => xs.filter((r) => r.res.rigDown).length;
    const tk = rs.filter((r) => r.job.mode !== 'probe' && r.job.cond.tws >= 6 && r.job.cond.tws <= 25).flatMap((r) => (r.res.tacks || []).filter((m) => m.kind === 'tack'));
    const irons = tk.filter((m) => m.crossed === null || m.ironsT > 3).length;
    const P = leg(get(cls, 'open-12-flat-steady', 'probe'), 'fixed'), pr = get(cls, 'open-12-flat-steady', 'probe')?.res.legs?.fixed?.probe;
    md.push(`| ${cls} | ${n(ratio(h12), 2)}${kn ? ' (' + kn.v.split(' (')[0] + ')' : ''} | ${heel('open-18-flat-steady')} / ${heel('open-25-flat-steady')} (${n(CLASSES[cls].targetHeel * 180 / Math.PI, 0)}) | ${crs('open-12-flat-steady')} | ${crs('open-18-sea-gusty')} | ${zz} | ${n(sf, 2)} | ${dm(low)} / ${dm(rs)} | ${irons} / ${tk.length} | ${pr ? n(pr.d10) : '-'} |`);
  }
  md.push('');
}
// per class x condition
md.push('## Per class and condition', '');
for (const cls of classes) {
  md.push(`### ${cls} (${CLASSES[cls].name})`, '', `| Condition | ${modes.join(' | ')} |`, `|---|${modes.map(() => '---').join('|')}|`);
  for (const c of conds) {
    const row = modes.map((m) => {
      const r = by[cls]?.[c.id]?.[m]; if (!r) return '-';
      const s = short(r.checks).slice(0, 4).join('; ').replace(/\|/g, '/');
      return `**${ICON[r.st]}** ${s}`;
    });
    md.push(`| ${c.id} | ${row.join(' | ')} |`);
  }
  md.push('');
}
// key numbers per trial (a compact digest)
md.push('## Key numbers', '', '| Class | Condition | Helm | up kn (polar) | beam kn (polar) | heel beat/target | course rms (osc period/amp) | weather helm | tacks s / loss | rig SF | fixed helm 10/30 s |', '|---|---|---|---|---|---|---|---|---|---|---|');
const g = (r, k) => (r.checks.find((c) => c.k === k) || {}).v ?? '-';
for (const r of results.sort((a, b) => a.job.cls.localeCompare(b.job.cls) || a.job.cond.id.localeCompare(b.job.cond.id) || a.job.mode.localeCompare(b.job.mode))) {
  const L = r.res.legs || {}, bt = L.beat1?.st, bm = L.beam?.st, P = L.fixed?.probe;
  const n = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(d));
  const tk = (r.res.tacks || []).filter((m) => m.kind === 'tack').map((m) => m.turnTime === null ? 'irons' : `${n(m.turnTime)}/${Math.round(100 * (1 - m.uMin / m.uPre))}%`).join(', ');
  md.push(`| ${r.job.cls} | ${r.job.cond.id} | ${r.job.mode} | ${bt ? n(bt.u, 2) + ' (' + n(bt.polar, 2) + ')' : '-'} | ${bm ? n(bm.u, 2) + ' (' + n(bm.polar, 2) + ')' : '-'} | ${bt ? n(bt.heel.mean) + '/' + n(r.res.targetHeel, 0) : '-'} | ${bm ? n(bm.herr.rms) + ' (' + n(bm.osc?.period) + '/' + n(bm.osc?.amp) + ')' : '-'} | ${bt ? n(bt.helm.mean) : '-'} | ${tk || '-'} | ${r.res.struct ? n(1 / r.res.struct.maxR, 2) : '-'} | ${P ? n(P.d10) + '/' + n(P.d30) : '-'} |`);
}
md.push('', '## Run', '', `Wall ${(wall / 60).toFixed(1)} min; per trial (wall, s): ` + Object.entries(results.reduce((a, r) => { (a[r.job.mode] ??= []).push(r.res.wallSec || 0); return a; }, {})).map(([m, xs]) => `${m} mean ${(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(0)}, max ${Math.max(...xs).toFixed(0)}`).join('; '));
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/${name}.md`, md.join('\n') + '\n');
writeFileSync(`${HERE}out/${name}.json`, JSON.stringify({ generated: new Date().toISOString(), quick: QUICK, sails, lod, scale, wall, ranges: R, conds, classes, modes, summary, results: results.map((r) => ({ ...r.job, cond: r.job.cond.id, status: r.st, checks: r.checks, metrics: r.res })) }, null, 1));
// the console: the per-class summary
console.log('\nworst failures per class (failing metric: number of trials):');
for (const cls of classes) { const s = summary[cls]; console.log(`  ${cls.padEnd(11)} ${String(s.pass).padStart(3)} pass ${String(s.warn).padStart(3)} warn ${String(s.fail).padStart(3)} fail   ${Object.entries(s.fails).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')}`); }
console.log(`\n${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail in ${(wall / 60).toFixed(1)} min — report test/out/${name}.md, metrics test/out/${name}.json`);
process.exit(counts.fail ? 1 : 0);
