// Seamarks: light characters parsed into on/off timing (Fl(2) W 10s, Oc(3) 15s, Q, VQ(6)+LFl 10s, Mo(U), Iso,
// Al.WR, OSM sequences), sector lights, chart labels, IALA regions, and every baked venue's seamarks.
// Run: node test/seamarks.mjs
import { parseLight, lightPhases, lightAt, countFlashes, inSector, lightLabel, ialaRegion, resolveMark } from '../js/seamarks.js';
import { VENUES } from '../js/world.js';
import { readFileSync, existsSync } from 'node:fs';

let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const sum = (P) => P.ph.reduce((s, p) => s + p[0], 0);
const ons = (P) => P.ph.filter(p => p[1] > 0).map(p => +p[0].toFixed(3));
const show = (s, P) => console.log(`     ${s.padEnd(16)} per ${P.per}s  ${P.ph.map(p => (p[1] ? '+' : '-') + p[0].toFixed(2)).join(' ')}`);
const L = (s) => { const l = parseLight(s), P = lightPhases(l); show(s, P); return [l, P]; };

// parsing
{
  const a = parseLight('Fl(2) W 10s'); check(a.ch === 'Fl' && a.gr === '2' && a.col.join() === 'W' && a.per === 10, 'parse "Fl(2) W 10s"');
  const b = parseLight('VQ(6)+LFl 10s'); check(b.ch === 'VQ+LFl' && b.gr === '6' && b.per === 10, 'parse "VQ(6)+LFl 10s"');
  const c = parseLight('Mo(U)'); check(c.ch === 'Mo' && c.gr === 'U', 'parse "Mo(U)"');
  const d = parseLight('Iso WRG 4s'); check(d.ch === 'Iso' && d.col.join() === 'W,R,G' && d.per === 4, 'parse "Iso WRG 4s"');
  const e = parseLight('Fl.G.5s'); check(e.ch === 'Fl' && e.col.join() === 'G' && e.per === 5, 'parse "Fl.G.5s"');
  const f = parseLight('Al.WR 4s'); check(f.ch === 'Al' && f.col.join() === 'W,R' && f.per === 4, 'parse "Al.WR 4s"');
}
// Fl(2) W 10s: two 0.5 s flashes 1 s apart, then the long eclipse
{
  const [, P] = L('Fl(2) W 10s');
  check(P.per === 10 && near(sum(P), 10), 'Fl(2) 10s: the phases fill the 10 s period');
  check(countFlashes(P) === 2 && ons(P).join() === '0.5,0.5', 'Fl(2) 10s: two 0.5 s flashes');
  check(lightAt(P, 0.25)[0] === 1 && lightAt(P, 0.9)[0] === 0 && lightAt(P, 1.75)[0] === 1 && lightAt(P, 5)[0] === 0 && lightAt(P, 10.25)[0] === 1, 'Fl(2) 10s: on at 0.25 s and 1.75 s, dark at 0.9 s and 5 s, repeats at 10.25 s');
  let on = 0; for (let t = 0; t < 10; t += 0.001) on += lightAt(P, t)[0] * 0.001;
  check(near(on, 1, 0.01), `Fl(2) 10s: 1 s of light per period (${on.toFixed(3)})`);
}
// Oc(3) 15s: three eclipses, light longer than dark
{
  const [, P] = L('Oc(3) 15s');
  const dark = P.ph.filter(p => !p[1]);
  check(near(sum(P), 15) && dark.length === 3, 'Oc(3) 15s: three eclipses in 15 s');
  check(dark.reduce((s, p) => s + p[0], 0) < 7.5, 'Oc(3) 15s: total light longer than total eclipse');
  const [, O] = L('Oc 10s');
  check(near(sum(O), 10) && O.ph.filter(p => !p[1]).length === 1 && O.ph.find(p => !p[1])[0] < 5, 'Oc 10s: one short eclipse');
}
// Q, VQ: 60 and 120 flashes a minute
{
  const [, Q] = L('Q'); check(near(Q.per, 1) && countFlashes(Q) === 1, 'Q: one flash a second (60/min)');
  const [, V] = L('VQ'); check(near(V.per, 0.5) && countFlashes(V) === 1, 'VQ: one flash every half second (120/min)');
  let n = 0, prev = 0; for (let t = 0; t < 60; t += 0.01) { const i = lightAt(Q, t)[0]; if (i && !prev) n++; prev = i; }
  check(n === 60, `Q: 60 flashes in a minute (${n})`);
}
// VQ(6)+LFl 10s (south cardinal): six very quick flashes and a long flash of 2 s or more, in 10 s
{
  const [, P] = L('VQ(6)+LFl 10s');
  const o = ons(P);
  check(near(sum(P), 10) && countFlashes(P) === 7, 'VQ(6)+LFl 10s: seven flashes in 10 s');
  check(o.slice(0, 6).every(d => d < 0.5) && o[6] >= 2, 'VQ(6)+LFl 10s: six short flashes then a long flash ≥ 2 s');
  const [, Q] = L('Q(9) 15s'); check(near(sum(Q), 15) && countFlashes(Q) === 9, 'Q(9) 15s (west cardinal): nine flashes');
  const [, E] = L('VQ(3) 5s'); check(near(sum(E), 5) && countFlashes(E) === 3, 'VQ(3) 5s (east cardinal): three flashes');
}
// Morse U (· · —)
{
  const [, P] = L('Mo(U)');
  check(ons(P).join() === '0.5,0.5,1.5', 'Mo(U): dot, dot, dash');
  const [, A] = L('Mo(A) 6s'); check(ons(A).join() === '0.5,1.5' && near(sum(A), 6), 'Mo(A) 6s: dot, dash, in 6 s');
}
// Iso, fixed, alternating, FFl, composite groups, OSM sequences
{
  const [, I] = L('Iso 4s'); check(ons(I).join() === '2' && near(sum(I), 4), 'Iso 4s: 2 s on, 2 s off');
  const [, F] = L('F R'); check(lightAt(F, 0.3)[0] === 1 && lightAt(F, 123.4)[0] === 1, 'F: always on');
  const [, A] = L('Al.WR 4s'); check(lightAt(A, 0.5)[1] !== lightAt(A, 2.5)[1] && lightAt(A, 2.5)[0] === 1, 'Al.WR: on all the time, alternating colour');
  const [, G] = L('Fl(2+1) 15s'); check(countFlashes(G) === 3 && near(sum(G), 15), 'Fl(2+1) 15s: a group of two, then one');
  const S = lightPhases({ ch: 'Oc', per: 10, seq: '8+(2)' }); check(ons(S).join() === '8' && near(sum(S), 10), 'OSM sequence "8+(2)": 8 s light, 2 s eclipse');
  const T = lightPhases({ ch: 'Q+LFl', gr: '6', per: 15 }); check(countFlashes(T) === 7 && near(sum(T), 15), 'OSM tags character=Q+LFl group=6 period=15');
  const U = lightPhases({ ch: 'Fl', gr: '3', per: 10, seq: '0.5+(1),0.5+(1),0.5+(6.5)' }); check(countFlashes(U) === 3 && near(sum(U), 10), 'OSM sequence of a Fl(3)');
}
// sectors (bearings from seaward) and labels
{
  const l = { ch: 'Oc', col: ['W'], s0: 350, s1: 10 };
  check(inSector(l, 355) && inSector(l, 5) && !inSector(l, 20), 'sector 350°-010° wraps through north');
  check(inSector({ ch: 'F' }, 123), 'all-round light is seen from every bearing');
  check(lightLabel([{ ch: 'Fl', gr: '2', col: ['G'], per: 5 }]) === 'Fl(2) G 5s', `label "${lightLabel([{ ch: 'Fl', gr: '2', col: ['G'], per: 5 }])}"`);
  check(lightLabel([{ ch: 'Q+LFl', gr: '6', col: ['W'], per: 15 }]) === 'Q(6)+LFl W 15s', 'label "Q(6)+LFl W 15s"');
  const sec = lightLabel([{ ch: 'Oc', col: ['G'], per: 10, s0: 1, s1: 2 }, { ch: 'Oc', col: ['W'], per: 10, s0: 2, s1: 3 }, { ch: 'Oc', col: ['R'], per: 10, s0: 3, s1: 4 }]);
  check(sec === 'Oc GWR 10s', `sector label "${sec}"`);
}
// IALA regions
{
  const want = { solent: 'A', sfbay: 'B', garda: 'A', sydney: 'A', kiel: 'A', newport: 'B', auckland: 'A', marseille: 'A', meredith: 'B', progreso: 'B' };
  for (const [id, r] of Object.entries(want)) { const v = VENUES.find(x => x.id === id); check(ialaRegion(v.lat, v.lon) === r, `IALA region ${r}: ${v.name}`); }
  check(ialaRegion(35.6, 139.8) === 'B' && ialaRegion(14.6, 121) === 'B' && ialaRegion(37.5, 126.6) === 'B' && ialaRegion(1.3, 103.8) === 'A', 'IALA B: Tokyo, Manila, Incheon; A: Singapore');
  const pA = resolveMark({ t: 'buoy_lateral', cat: 'port' }, 'A'), pB = resolveMark({ t: 'buoy_lateral', cat: 'port' }, 'B');
  check(pA.col[0] === 'red' && pA.sh === 'can' && pB.col[0] === 'green', 'port-hand buoy: red can in region A, green in region B');
  const s = resolveMark({ t: 'buoy_cardinal', cat: 'south', L: [{ ch: 'Q+LFl', gr: '6', per: 15 }] }, 'A');
  check(s.col.join() === 'yellow,black' && s.tm === '2 cones down' && s.L[0].col[0] === 'W', 'south cardinal: yellow over black, cones down, white light');
}
// every baked venue has its seamarks
{
  const types = {};
  for (const v of VENUES) {
    if (v.open) continue;
    const f = `data/venues/${v.id}.seamarks.json`;
    if (!existsSync(f)) { check(false, `${v.id}: ${f} missing`); continue; }
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const lit = j.marks.filter(m => m.L), major = j.marks.filter(m => /^(lighthouse|light_major|light_vessel)$/.test(m.t));
    const inside = j.marks.filter(m => !m.far);
    for (const m of j.marks) types[m.t] = (types[m.t] || 0) + 1;
    console.log(`     ${v.id.padEnd(10)} ${String(j.marks.length).padStart(4)} marks, ${String(lit.length).padStart(3)} lit, ${major.length} major, region ${j.region}`);
    const lake = v.id === 'garda' || v.id === 'meredith';
    check(Array.isArray(j.marks) && j.region === ialaRegion(v.lat, v.lon), `${v.id}: seamarks file loads (region ${j.region})`);
    if (!lake) check(inside.length >= 10 && lit.length >= 3, `${v.id}: at least 10 marks in the sailing area and 3 lit (${inside.length}, ${lit.length})`);
    let okTiming = true;
    for (const m of lit) for (const l of m.L) { const P = lightPhases(l); if (!(P.per > 0) || !near(sum(P), P.per, 1e-6) || P.ph.some(p => !(p[0] > 0))) { okTiming = false; console.log('     bad timing', v.id, m.n, JSON.stringify(l)); } }
    check(okTiming, `${v.id}: every light's timing fills its period`);
    check(j.marks.every(m => isFinite(m.x) && isFinite(m.z)), `${v.id}: positions are finite`);
  }
  check((types.lighthouse || 0) + (types.light_major || 0) >= 5, `lighthouses / major lights across the venues (${(types.lighthouse || 0) + (types.light_major || 0)})`);
}

console.log(fails ? `${fails} FAILED` : 'all seamark checks passed');
process.exit(fails ? 1 : 0);
