// Weather effects (js/wx.js): lightning strikes are a pure function of (seed, cell, time) — the same list
// whenever and in whatever pieces it is computed; thunder reaches a listener distance / 343 m/s after the
// flash; mist and cumulus follow the time of day and the wind.
import { Weather, KT } from '../js/env.js';
import { strikes, flashAt, thunderDue, channelRange, boltSegments, convection, heatFromSun, mist, SOUND } from '../js/wx.js';
const DEG = Math.PI / 180;
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };

const W = new Weather({ mode: 'squally', seed: 22, tws: 7 });
// 1. determinism: one pass over [600, 1800) equals the union of many small frame-sized passes computed at
//    the frame's own time (the cells are propagated to each strike's time)
const whole = strikes(W.activeCells(1200), 1200, 600, 1800);
const pieces = []; for (let t = 600; t < 1800; t += 0.37) strikes(W.activeCells(t), t, t, Math.min(1800, t + 0.37), pieces);
const key = (l) => l.map(s => `${s.id}:${s.ts.toFixed(4)}:${s.x.toFixed(1)}:${s.z.toFixed(1)}`).sort().join('|');
check(whole.length > 20 && key(whole) === key(pieces), `strike list identical in one pass and in frames (${whole.length} strikes, ${whole.filter(s => s.cg).length} to the ground)`);
check(key(strikes(W.activeCells(1200), 1200, 600, 1800)) === key(whole), 'second computation identical');
const W2 = new Weather({ mode: 'squally', seed: 23, tws: 7 });
check(key(strikes(W2.activeCells(1200), 1200, 600, 1800)) !== key(whole), 'another seed, other strikes');
check(new Weather({ mode: 'changing', seed: 22 }).activeCells(1200).length === 0, 'no cells (and no lightning) out of squally weather');
const perMin = whole.length / 20;
check(perMin > 0.5 && perMin < 9, `flash rate ${perMin.toFixed(1)}/min over two mature cells`);
// 2. thunder timing: step a listener through time at 60 fps; each strike's thunder fires once, at ts + d/343
const L = { x: 300, y: 3, z: -200 };
const fired = new Map(); let tPrev = 600;
for (let t = 600; t <= 1900; t += 1 / 60) {
  const list = strikes(W.activeCells(t), t, Math.max(0, t - 90), t + 1e-6);
  for (const e of thunderDue(list, L.x, L.y, L.z, tPrev, t, 900)) { if (fired.has(e.s.id)) check(false, `fires once ${e.s.id}`); fired.set(e.s.id, { t, d: e.d, ts: e.s.ts }); }
  tPrev = t;
}
let worst = 0, far = 0;
for (const [, f] of fired) { worst = Math.max(worst, Math.abs(f.t - f.ts - f.d / SOUND)); far = Math.max(far, f.d); }
check(fired.size > 10 && worst <= 1 / 60 + 1e-9, `${fired.size} thunders, each at flash + d/343 within a frame (worst ${(worst * 1000).toFixed(1)} ms, farthest ${(far / 1000).toFixed(1)} km = ${(far / SOUND).toFixed(0)} s)`);
const inRange = whole.filter(s => channelRange(s, L.x, L.y, L.z, 900)[0] < 25000 && s.ts + channelRange(s, L.x, L.y, L.z, 900)[0] / SOUND < 1900);
check(inRange.every(s => fired.has(s.id)), 'every strike within 25 km was heard');
check(thunderDue(whole, L.x, L.y, L.z, 1000, 1030).length === 0, 'a jump in time (>5 s) plays nothing');
// 3. flash and bolt
const cg = whole.find(s => s.cg);
check(flashAt(cg, cg.ts - 0.01) === 0 && flashAt(cg, cg.ts) > 0.5 && flashAt(cg, cg.ts + 2) === 0, 'flash: dark before, bright at the stroke, gone after');
const sg = boltSegments(cg, 900), sg2 = boltSegments(cg, 900);
const ends = []; for (let i = 0; i < sg.length; i += 7) ends.push(sg[i + 4]);
check(sg.length === sg2.length && sg.every((v, i) => v === sg2[i]) && sg.length / 7 > 100, `bolt deterministic, ${sg.length / 7} segments`);
check(Math.min(...ends) === 0 && Math.max(...ends) < 901, 'the bolt runs from the cloud base down to the sea');
// 4. convection over a day: small cumulus in the morning, deep in the afternoon, towers only when unstable
const cm = convection('changing', heatFromSun(10 * DEG), 8 / 1), ca = convection('changing', heatFromSun(50 * DEG), 8), cs = convection('squally', heatFromSun(50 * DEG), 8);
check(cm.base < ca.base && cm.thick < ca.thick && cm.cover < ca.cover, `base ${cm.base.toFixed(0)} -> ${ca.base.toFixed(0)} m, depth ${cm.thick.toFixed(0)} -> ${ca.thick.toFixed(0)} m morning to afternoon`);
check(cs.tower > 0.5 && convection('steady', heatFromSun(50 * DEG), 8).tower < 0.3 && convection('squally', 0, 8).tower === 0, 'towers on an unstable afternoon only');
check(convection('changing', 1, 30).strat > 0.9 && convection('changing', 1, 30).base < ca.base, 'strong wind: low stratocumulus');
// 5. mist: calm dawn misty, burnt off by late morning, blown away by wind; advection fog thick at mid latitude
const dawn = mist('steady', 22, 0, 1 * DEG, 6.2, 45, 3), late = mist('steady', 22, 0, 40 * DEG, 11, 45, 3), windy = mist('steady', 22, 0, 1 * DEG, 6.2, 45, 18);
check(dawn.vis < 2500 && late.rad === 0 && windy.sigma < dawn.sigma * 0.2, `dawn mist vis ${dawn.vis.toFixed(0)} m top ${dawn.top.toFixed(0)} m; gone at 11h (rad ${late.rad.toFixed(2)}); ${windy.sigma.toExponential(1)} in 18 kn`);
let minVis = Infinity, anyFog = 0; for (let t = 0; t < 20000; t += 60) { const m = mist('steady', 5, t, 30 * DEG, 14, 38, 8); minVis = Math.min(minVis, m.vis); if (m.vis < 1000) anyFog++; }
check(minVis > 250 && minVis < 600 && anyFog > 0, `sea fog spells at 38 deg in 8 kn: worst visibility ${minVis.toFixed(0)} m, ${anyFog} of 334 minutes under 1 km`);
let tropic = Infinity; for (let t = 0; t < 20000; t += 60) tropic = Math.min(tropic, mist('steady', 5, t, 30 * DEG, 14, 21, 8).vis);
check(tropic === Infinity, 'no afternoon sea fog in the tropics');
process.exit(fail ? 1 : 0);
