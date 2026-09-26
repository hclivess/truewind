// The sail governor on a slow device (js/governor.js). In SwiftShader the game draws a frame in seconds: each frame
// runs 12 catch-up physics steps (0.1 s of sailing, the dt clamp) and the old wall-clock governor dropped the
// sportboat to L1 at 0.2 s of sailing, posed afresh: main and jib stalled for a second and a half. Here:
//  1. a level switch right after the start carries the cloth over: no stall, no loss of drive (L0 -> L1, L1 -> L0,
//     and to the strip model and back);
//  2. frames that are slow for the drawing's sake (and paused frames) never switch anything;
//  3. a device that is slow for the physics' sake switches, but only after 3 s and 90 frames of sailing, the fleet
//     before the player, each boat once its cloth has flown, and each without a stall.
import { Boat, makeSteadyEnv, autoTrim } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { SailGovernor, GOV, setSailLevel, sailsFlown } from '../js/governor.js';
const KT = 0.514444, DT = 1 / 120;
let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
// the game's start: 14 kn, beam reach, four seconds of the crew's preset trim, trim then left alone
const env = makeSteadyEnv(14 * KT);
function start(cls, lod, z = 0) {
  const b = new Boat(cls, { lod, id: z }); b.reset(0, z * 30, Math.PI / 2); b.u = 1.2;
  for (let i = 0; i < 480; i++) { autoTrim(b, DT, 0, true); b.step(DT, env, 0); b.psi = Math.PI / 2; b.r = 0; }
  b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.lazy = b.ctrl.lazy = 1;
  return b;
}
// drive: the sails' load on the hull over the last 0.1 s (a cloth resampled onto a finer grid settles in a few
// steps, a jolt of the cloth's own inertia the boat does not feel)
const drive = (b) => { const F = Math.hypot(b.diag.sailX, b.diag.sailY), h = b._Fh || (b._Fh = []); h.push(F); if (h.length > 12) h.shift(); return h.reduce((a, x) => a + x, 0) / h.length; };
const stalled = (b) => { let n = 0; for (const k in b.diag.strips) if (b.sailBy[k] && b.lod < 2) for (const s of b.diag.strips[k]) n += s.state === 3; return n; };

console.log('1. a switch right after the start');
for (const [cls, seq] of [['sportboat', [[0.2, 1]]], ['dinghy', [[0.2, 1]]], ['sportboat', [[0.2, 1], [0.6, 0]]], ['blackwatch', [[0.2, 2], [1.0, 0]]]]) {
  const b = start(cls, 0);
  let t = 0, F0 = 0, s0 = 0, Fmin = Infinity, smax = 0;
  const ev = seq.slice();
  for (let i = 0; i < 1.6 / DT; i++) {
    t += DT;
    if (ev.length && t >= ev[0][0]) { const [, l] = ev.shift(); if (!F0) { F0 = drive(b); s0 = stalled(b); } setSailLevel(b, l); }
    b.step(DT, env, t);
    const F = drive(b);
    if (F0 && b.lod < 2) { Fmin = Math.min(Fmin, F); smax = Math.max(smax, stalled(b)); }
  }
  check(Fmin > 0.85 * F0 && smax <= s0 + 1, `${cls.padEnd(10)} L0 ${seq.map(([t, l]) => `-> L${l} @${t}s`).join(' ')}: drive ${F0.toFixed(0)} N, lowest after ${Fmin.toFixed(0)} N; stalled strips ${s0} -> at most ${smax}`);
}

console.log('2-3. the governor on a slow device');
function run(name, frame, n, warpAt = null) {
  const boats = [start('sportboat', 0, 0), start('sportboat', 1, 1), start('sportboat', 1, 2)], player = boats[0];
  const log = [];
  const gov = new SailGovernor((b, l) => {
    log.push({ t, id: b.id, from: b.lod, to: l, flown: sailsFlown(b), F0: b._Fh.reduce((a, x) => a + x, 0) / b._Fh.length, s0: stalled(b) });
    setSailLevel(b, l);
  }, (b) => (b === player ? 0 : 1));
  let t = 0;
  const watch = [];
  for (let f = 0; f < n; f++) {
    const fr = frame(f), warp = warpAt && f >= warpAt[0] && f < warpAt[1] ? 4 : 1;
    for (let s = 0; s < fr.steps; s++) {
      t += DT;
      for (const b of boats) { b.step(DT, env, t); b.psi = Math.PI / 2; b.r = 0; drive(b); }
      for (const w of watch) if (t - w.t < 1) { w.Fmin = Math.min(w.Fmin ?? Infinity, w.b._Fh.reduce((a, x) => a + x, 0) / w.b._Fh.length); w.smax = Math.max(w.smax ?? 0, stalled(w.b)); }
    }
    const k = log.length;
    gov.frame(fr.ms, fr.steps, DT, fr.frameMs, boats, player, (b) => Math.abs(b.z - player.z), warp);
    for (const e of log.slice(k)) if (e.to < 2) watch.push(Object.assign(e, { b: boats[e.id] }));
  }
  console.log(`  ${name}: ${log.length ? log.map((e) => `#${e.id} L${e.from}->L${e.to} @${e.t.toFixed(1)}s`).join(', ') : 'no switch'}`);
  return { log, boats, t };
}
// SwiftShader: 8 s a frame to draw, 12 steps of physics in 35 ms of it
let r = run('draws slowly', () => ({ steps: 12, ms: 35, frameMs: 8000 }), 60);
check(r.log.length === 0, `a device that draws slowly keeps its sails (${r.t.toFixed(1)} s of sailing, 60 frames)`);
// paused, then a shader compile: frames with no steps, then a 3 s frame with 20 ms of physics in it
r = run('paused, then a compile', (f) => (f < 200 ? { steps: 0, ms: 0, frameMs: 16 } : f === 200 ? { steps: 12, ms: 20, frameMs: 3000 } : { steps: 2, ms: 1, frameMs: 16.7 }), 300);
check(r.log.length === 0, 'paused frames and a compile stall switch nothing');
// the physics is what makes it slow: 12 steps of 5 ms each in a 75 ms frame (cost 10 ms per 60 Hz frame)
r = run('slow physics', () => ({ steps: 12, ms: 60, frameMs: 75 }), 250);
const first = r.log[0];
check(!!first && first.t >= Math.max(GOV.hold, GOV.holdFrames * 12 * DT) - 1e-9, `the first switch waits for 3 s and 90 frames of sailing (${first ? first.t.toFixed(1) : '-'} s)`);
check(r.log.length >= 3 && r.log[0].id !== 0 && r.log[1].id !== 0 && r.log[2].id === 0, 'the fleet is lightened before the player');
check(r.log.every((e) => e.flown), 'every boat switched had its cloth flying');
check(r.log.filter((e) => e.Fmin !== undefined).every((e) => e.Fmin > 0.85 * e.F0 && e.smax <= e.s0 + 1),
  'no switch onto cloth costs drive or stalls the sails: ' + r.log.filter((e) => e.Fmin !== undefined).map((e) => `#${e.id} ${e.F0.toFixed(0)}->${e.Fmin.toFixed(0)} N, stalled ${e.s0}->${e.smax}`).join('; '));
// time warp x4 for 30 frames: all at L2, then back as they were, the cloth set aside flying on
r = run('time warp', () => ({ steps: 2, ms: 0.5, frameMs: 16.7 }), 150, [100, 130]);
check(r.boats.map((b) => b.lod).join('') === '011' && r.log.filter((e) => e.from === 2).every((e) => e.Fmin > 0.85 * e.F0 && e.smax <= 1),
  `after time warp the boats are back at L0/L1, the cloth set aside drawing at once (${r.log.filter((e) => e.from === 2).map((e) => `#${e.id} ${e.F0.toFixed(0)}->${e.Fmin.toFixed(0)} N, ${e.smax} stalled`).join('; ')})`);
process.exit(bad ? 1 : 0);
