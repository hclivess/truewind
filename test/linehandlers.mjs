// Line handlers (js/linehandlers.js): what holds each line and how it behaves under load.
//  1. slip load: a closed cam cleat holds below its rating and slips above it (the sheet runs out until the load
//     falls under it again); a horn cleat holds anything;
//  2. one-way: a line in a cam / clutch / self-tailer can be hauled in while it is closed; on a horn cleat or a
//     V-jammer it has to be cast off first (nothing moves until it is) and is made fast again when let go;
//  3. a ratchet block holds all but 1/10 of the load above its engaging load: the hand (or the cam behind it)
//     holds a fraction, and a loaded Laser mainsheet held in the hand does not run where it would without it;
//  4. making fast takes the handler's time (horn cleat 3 s, cam 0.2 s), and so does casting off;
//  5. released under load: a cam / clutch dumps the line, a self-tailer or horn eases it round the drum, a ratchet
//     + cam leaves it in the hand; letting fly dumps whatever holds it;
//  6. every class's lines resolve to a handler, and a full boat sails with them (the auto crew keeps them made fast).
import { Boat, CLASSES, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { HANDLERS, HAND, CAM_SLIP, lineSpecs, specOf, tailLoad, stepLines, work, letFly, initLines, lineStatus, ropeLook, ROPES, tackleOf, handLoad } from '../js/linehandlers.js';
const DT = 1 / 120, KT = 0.514444;
let bad = 0;
const check = (ok, msg) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
// a boat reduced to its lines: loads are set by hand
function mock(cls, rig = {}) {
  const b = { cls: CLASSES[cls], ctrl: { main: 0.2, jib: 0.2, lazy: 1, stay: 0.2, trav: 0.5, vang: 0.4, cunn: 0.2, outhaul: 0.4, backstay: 0.3, jibHalyard: 0.5, tackLine: 0.3 },
    diag: { rig: { mainLoad: 0, jibLoad: 0, stayLoad: 0, lazyLoad: 0, backstayLoad: 0, ...rig } }, lines: { main: 0.2, jib: 0.2, lazy: 1, stay: 0.2 }, genDeploy: 0 };
  initLines(b);
  return b;
}
const run = (b, s) => { for (let i = 0; i < s / DT; i++) stepLines(b, DT); };

console.log('1. slip load');
{
  // Hobie 16 jib sheet: 2:1 into a Harken 150 cam (1330 N)
  const lo = mock('cat', { jibLoad: 2 * CAM_SLIP.std * 0.9 }), hi = mock('cat', { jibLoad: 2 * CAM_SLIP.std * 1.5 });
  run(lo, 2); run(hi, 0.5);
  check(lo.ctrl.jib === 0.2 && !lo.lh.jib.slip, `cam cleat at 90% of its slip load holds (jib ${lo.ctrl.jib.toFixed(2)})`);
  check(hi.ctrl.jib > 0.3 && hi.lh.jib.slip === 1, `at 150% it slips: the sheet runs out (jib 0.20 -> ${hi.ctrl.jib.toFixed(2)})`);
  // the load falls as the sheet eases: here once the sheet is out past 0.5 the gust has passed
  const g = mock('cat', { jibLoad: 4000 });
  for (let i = 0; i < 3 / DT; i++) { g.diag.rig.jibLoad = g.ctrl.jib > 0.5 ? 1000 : 4000; stepLines(g, DT); }
  check(g.ctrl.jib > 0.5 && g.ctrl.jib < 0.6 && !g.lh.jib.slip, `a slip stops once the load is back under the cam's rating (jib ${g.ctrl.jib.toFixed(2)})`);
  const bw = mock('blackwatch'); bw.ctrl.cunn = 0.8;   // horn cleat: holds anything
  bw.diag.rig.mainLoad = 1e5; run(bw, 1);
  check(bw.ctrl.cunn === 0.8, 'a horn cleat holds anything');
  const micro = mock('dinghy'); micro.ctrl.vang = 1; const T = tailLoad(micro, 'vang');
  check(T < CAM_SLIP.micro, `Laser vang full on: ${T.toFixed(0)} N at the micro cam through 15:1, under its ${CAM_SLIP.micro} N`);
}

console.log('2. one-way');
{
  const b = mock('sportboat', { mainLoad: 1500 });
  const f = work(b, 'main', true);
  check(f === 1 && b.locks.main && b.lh.main.s === 'locked', 'the mainsheet is hauled in through the ratchet + cam while it stays cleated');
  const c = mock('sportboat'); check(work(c, 'jibHalyard', true) === 1 && c.lh.jibHalyard.s === 'locked', 'a halyard is pulled in through its closed clutch');
  const h = mock('blackwatch', { jibLoad: 600 });
  const f0 = work(h, 'jib', true);
  check(f0 === 0 && h.locks.jib === false, 'a jib sheet on a horn cleat cannot come in until it is off the cleat');
  let t = 0, got = 0;
  while (t < 3) { got = work(h, 'jib', true); stepLines(h, DT); t += DT; if (got) break; }
  check(got === 1 && Math.abs(t - HANDLERS.winchHorn.releaseT) < 0.05, `cast off in ${t.toFixed(2)} s (horn: ${HANDLERS.winchHorn.releaseT} s), then it comes in`);
  const j0 = h.ctrl.jib; run(h, 0.5);
  check(h.locks.jib === true && h.lh.jib.s === 'locking' && h.ctrl.jib === j0, 'let go, the crew makes it fast again, holding it round the drum meanwhile');
  run(h, 3);
  check(h.lh.jib.s === 'locked', 'and it is on the horn again');
  const p = mock('blackwatch', { mainLoad: 400 }); p.ctrl.trav = 0.43;
  while (!work(p, 'trav', true)) stepLines(p, DT);
  p.ctrl.trav = 0.57; run(p, 1);
  check(Math.abs(p.ctrl.trav - 0.6) < 1e-9, `the push-button car stops at a hole in the track (0.57 -> ${p.ctrl.trav.toFixed(2)})`);
}

console.log('3. ratchet holding');
{
  const H = HANDLERS.ratchet, tk = tackleOf(CLASSES.dinghy, 'main'), L = 2000, T = tailLoad(mock('dinghy', { mainLoad: 3 * tk.efficiencyEase * L }), 'main');
  check(Math.abs(T - (H.engage + (L - H.engage) / H.hold)) < 1e-6, `2000 N on the Laser's ratchet: ${T.toFixed(0)} N in the hand (10:1 above ${H.engage} N)`);
  const light = tailLoad(mock('dinghy', { mainLoad: 3 * tk.efficiencyEase * 60 }), 'main');
  check(Math.abs(light - 60) < 1e-6, 'below its engaging load the ratchet runs free (60 N in the hand)');
  // a gust: 1200 N on the sheet (400 N at the block). With the ratchet the hand holds it; with a plain block it runs
  const r = mock('dinghy', { mainLoad: 1200 }); run(r, 1);
  const tNo = 1200 / 3;                                   // what the hand would hold without the ratchet
  check(r.ctrl.main === 0.2 && tNo > HAND, `with the ratchet the hand holds it (${r.lh.main.T.toFixed(0)} N); without, ${tNo.toFixed(0)} N beats the ${HAND} N hand`);
  const cat = mock('cat', { mainLoad: 4200 });
  const Tc = tailLoad(cat, 'main');
  check(Tc < 0.2 * CAM_SLIP.std, `Hobie 16 main at 4200 N (22 kn): 6:1 and the Ratchamatic leave ${Tc.toFixed(0)} N on the cam`);
}

console.log('4. make-fast time');
{
  for (const [cls, k, h] of [['blackwatch', 'cunn', 'horn'], ['dinghy', 'vang', 'cam'], ['blackwatch', 'stay', 'jam'], ['sportboat', 'jibHalyard', 'clutch'], ['sportboat', 'jib', 'winchCam']]) {
    const b = mock(cls); b.locks[k] = false; run(b, 3);
    check(b.lh[k].s === 'free', `${cls} ${k}: cast off`);
    b.locks[k] = true; let t = 0;
    while (b.lh[k].s !== 'locked' && t < 10) { stepLines(b, DT); t += DT; }
    check(specOf(b, k).handler === h && Math.abs(t - HANDLERS[h].lockT) < 0.02, `${HANDLERS[h].name} made fast in ${t.toFixed(2)} s`);
  }
}

console.log('5. released under load');
{
  const rel = (cls, k, rig, s = 1) => { const b = mock(cls, rig); b.locks[k] = false; run(b, s); return b; };
  const cam = rel('cat', 'jib', { jibLoad: 700 }), st = rel('sportboat', 'jib', { jibLoad: 700 }), bw = rel('blackwatch', 'jib', { jibLoad: 700 }, 3);
  check(cam.ctrl.jib > 0.9, `a jib sheet out of its cam cleat dumps (0.20 -> ${cam.ctrl.jib.toFixed(2)} in 1 s)`);
  check(st.ctrl.jib > 0.2 && st.ctrl.jib < 0.5, `out of the winch's cam it eases round the drum (0.20 -> ${st.ctrl.jib.toFixed(2)})`);
  check(bw.ctrl.jib > 0.2 && bw.ctrl.jib < 0.7, `3 s after casting off the horn cleat it surges round the winch (0.20 -> ${bw.ctrl.jib.toFixed(2)})`);
  const cl = rel('sportboat', 'cunn', {}, 1); check(cl.ctrl.cunn < 0.05, `a clutch opened under load dumps the cunningham (0.20 -> ${cl.ctrl.cunn.toFixed(2)})`);
  const rc = rel('cat', 'main', { mainLoad: 3000 });
  check(rc.ctrl.main === 0.2, `the Hobie mainsheet out of its cam stays in the hand through the ratchet (${rc.lh.main.T.toFixed(0)} N)`);
  const fl = mock('sportboat', { jibLoad: 700 }); letFly(fl, 'jib'); run(fl, 1);
  check(fl.ctrl.jib > 0.9, `let fly (turns off the winch): the sheet runs (0.20 -> ${fl.ctrl.jib.toFixed(2)})`);
  const s = lineStatus(fl, 'jib'); check(s.txt === 'FLY' && s.icon === 'winchCam', `panel: ${s.txt} · ${s.tip}`);
}

console.log('6. tackles');
{
  const C = CLASSES.dinghy, tk = tackleOf(C, 'main'), bw = tackleOf(CLASSES.blackwatch, 'main');
  check(tk.purchase === 3 && tk.efficiency < 1 && tk.efficiency > 0.9 && tk.efficiencyEase > 1, `Laser mainsheet 3:1 on ball bearings: hauling ${(tk.purchase * tk.efficiency).toFixed(2)}:1, easing ${(tk.purchase * tk.efficiencyEase).toFixed(2)}:1 (ideal 3:1)`);
  check(bw.bearing === 'plain' && bw.efficiency < tk.efficiency - 0.05, `Blackwatch 4:1 on plain bronze sheaves loses more: hauling ${(bw.purchase * bw.efficiency).toFixed(2)}:1 (${(100 * (1 - bw.efficiency)).toFixed(0)}% lost vs ${(100 * (1 - tk.efficiency)).toFixed(0)}%)`);
  const b = mock('blackwatch', { mainLoad: 800 }), up = handLoad(b, 'main', true), dn = handLoad(b, 'main', false);
  check(up > 800 / 4 && dn < 800 / 4, `800 N on the Blackwatch main: ${up.toFixed(0)} N in the hand hauling, ${dn.toFixed(0)} N easing (ideal ${800 / 4} N)`);
  const r = mock('dinghy', { mainLoad: 800 }), rh = handLoad(r, 'main', true), re = handLoad(r, 'main', false);
  check(re < 0.4 * rh, `through the Laser's ratchet: ${rh.toFixed(0)} N hauling, ${re.toFixed(0)} N holding / easing`);
  const v = tackleOf(C, 'vang'), m = tackleOf(C, 'main');
  check(v.stretchK > m.stretchK && v.lengthInTackle > 0 && m.lengthInTackle > 3, `stretch: the 15:1 vang is ${Math.round(v.stretchK / 1000)} kN/m at the boom, the 3:1 main ${Math.round(m.stretchK / 1000)} kN/m (${m.lengthInTackle.toFixed(1)} m of rope in it)`);
  const lb = mock('dinghy'); lb.ctrl.vang = 0.05; lb.locks.vang = false; run(lb, 2);
  const hb = mock('dinghy'); hb.ctrl.vang = 0.6; hb.locks.vang = false; run(hb, 2);
  check(lb.ctrl.vang === 0.05 && hb.ctrl.vang < 0.6, `let go, a light vang does not run through its blocks (it needs a pull), a loaded one does (0.60 -> ${hb.ctrl.vang.toFixed(2)})`);
  const B = new Boat('sportboat');
  check(B.tackle && B.tackle.main.purchase === 6 && ['purchase', 'efficiency', 'stretchK', 'lengthInTackle'].every((f) => isFinite(B.tackle.main[f])), `the boat exposes each line's tackle: J/70 main ${B.tackle.main.purchase}:1, efficiency ${B.tackle.main.efficiency.toFixed(3)}, ${B.tackle.main.lengthInTackle.toFixed(1)} m, ${Math.round(B.tackle.main.stretchK / 1000)} kN/m`);
}

console.log('7. every class');
{
  for (const id of Object.keys(CLASSES)) {
    const C = CLASSES[id], L = lineSpecs(C);
    check(Object.values(L).every((s) => HANDLERS[s.handler]) && ['main', 'jib', 'lazy', 'vang', 'cunn', 'outhaul'].every((k) => L[k]), `${id}: ${Object.entries(L).map(([k, s]) => `${k} ${s.handler}`).join(', ')}`);
  }
  const env = makeSteadyEnv(20 * KT);
  for (const id of Object.keys(CLASSES)) {
    const b = new Boat(id); b.reset(0, 0, Math.PI / 4); b.u = 2;
    let slips = 0;
    for (let i = 0; i < 10 / DT; i++) { autoTrim(b, DT); b.step(DT, env, i * DT); b.psi = Math.PI / 4; b.r = 0; for (const k in b.lh) slips += b.lh[k].slip; }
    check(isFinite(b.u) && b.u > 1 && Object.values(b.lh).every((s) => s.s === 'locked') && slips === 0, `${JSON.stringify(Object.fromEntries(Object.entries(b.lh).filter(([k, s]) => s.s !== 'locked' || s.ev).map(([k, s]) => [k, s.s + ' ' + s.ev.toFixed(2) + ' ' + s.T.toFixed(0)])))} ${id} sails 20 kn upwind with every line made fast, no slips (${(b.u / KT).toFixed(1)} kn)`);
  }
  check(Object.keys(ROPES).length >= 16 && ropeLook(CLASSES.blackwatch, 'jib').pattern === 'tracer', 'rope colours: every line its own; the Blackwatch in classic cream with coloured tracers');
}
process.exit(bad ? 1 : 0);
