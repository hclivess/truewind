// The automatic crew works the real lines (js/crew.js): autoTrim's plan carried out through the handlers, at the
// speed of hands and winches.
//  1. it sails as well as autoTrim setting the controls directly (boat speed within 5%, close-hauled then close reaching,
//     and close reaching then broad reaching)
//  2. it uses the hardware: easing a cleated line opens its cleat (the handler goes free) and it is made fast again
//     afterwards; hauling a sheet on a winch goes at a winch's pace, not instantly
//  3. its messages are few (no more than one per control in 8 s) and say what it did
//  4. no control moves faster than hands, tackles and winches can move it (the player's own rates, js/linehandlers.js
//     handRate; the jib car on its adjuster, a board by hand), where autoTrim alone jumps
// Run: node test/crew.mjs [class]
import { Boat, autoTrim, makeSteadyEnv, CLASS_ORDER } from '../js/physics.js';
import { Crew } from '../js/crew.js';
import { lineSpecs } from '../js/linehandlers.js';
const KT = 0.514444, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const classes = process.argv[2] ? [process.argv[2]] : ['sportboat', 'blackwatch', 'dinghy'];
const dt = 1 / 60;

const KEYS = ['main', 'jib', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibHalyard', 'jibLead', 'board'];
const RUNS_UP = new Set(['main', 'jib', 'stay', 'trav', 'tackLine']);
function sail(cls, twa, crew, secs = 40, tws = 12, onStep) {
  const env = makeSteadyEnv(tws * KT), b = new Boat(cls);
  b.reset(0, 0, twa * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.2;
  const C = crew ? new Crew() : null, states = {}, over = {}, jump = {}, R = new Crew();
  let u = 0, n = 0;
  for (let i = 0; i < secs / dt; i++) {
    const before = {}, capIn = {}, capOut = {};
    for (const k of KEYS) { before[k] = b.ctrl[k]; if (b.ctrl[k] !== undefined) { capIn[k] = R.rate(b, k, true); capOut[k] = R.rate(b, k, false); } }
    if (C) { C.begin(b); autoTrim(b, dt, 0, true); C.end(b, dt); } else autoTrim(b, dt, 0, true);
    // (after the first seconds: the reset's own settling aside) each control's move against what hands can do
    if (i * dt > 2 && !(b.lh && b.lh.jib && b.lh.jib.fly)) for (const k of KEYS) {
      if (before[k] === undefined || b.ctrl[k] === undefined || (C && !(k in C.real))) continue;   // (a string this boat has not got)
      const dv = b.ctrl[k] - before[k], trimming = RUNS_UP.has(k) ? dv < 0 : dv > 0;
      if (Math.abs(dv) < 1e-9) continue;
      const cap = (trimming ? capIn[k] : capOut[k]) * dt;                 // (the rate for the load it had)
      jump[k] = Math.max(jump[k] || 0, Math.abs(dv) / cap);
      if (Math.abs(dv) > cap * 1.001 + 1e-9) over[k] = (over[k] || 0) + 1;
    }
    // (half way, she bears away 40 degrees: the whole trim changes, the car and traveller with it)
    const h = (i * dt < secs / 2 ? twa : twa + 40) * DEG;
    b.step(dt, env, i * dt); b.r = 0; b.psi = h; b.rudder = 0;
    if (b.lh) for (const k in b.lh) (states[k] || (states[k] = new Set())).add(b.lh[k].s);
    if (i * dt > secs - 10) { u += b.u; n++; }
    if (onStep) onStep(b, i * dt);
  }
  return { b, u: u / n / KT, states, said: C ? C.said : [], over, jump };
}

for (const cls of classes) {
  for (const twa of [45, 80]) {
    const a = sail(cls, twa, false), c = sail(cls, twa, true);
    check(Math.abs(c.u - a.u) / a.u < 0.05, `${cls} at ${twa}° TWA: the crew's hands sail at ${c.u.toFixed(2)} kn, autoTrim alone ${a.u.toFixed(2)} kn`);
    const used = Object.entries(c.states).filter(([, s]) => s.has('free') || s.has('releasing')).map(([k]) => k);
    // (a line held in the hand through a ratchet block, a Laser's mainsheet, has no cleat to open)
    const hand = ['main', 'jib'].filter((k) => c.b.lh[k] && ['ratchet'].includes(lineSpecs(c.b.cls)[k]?.handler));
    check((used.length > 0 || hand.length > 0) && Object.values(c.b.lh).every((s) => s.s !== 'free' || !c.b.locks[Object.keys(c.b.lh).find((k) => c.b.lh[k] === s)]),
      `${cls} at ${twa}°: cleats opened to ease (${used.join(', ') || 'none'}${hand.length ? `; in the hand: ${hand.join(', ')}` : ''}) and made fast again`);
    const fast = Object.keys(c.over), worst = Object.entries(a.jump).sort((x, y) => y[1] - x[1])[0];
    check(!fast.length, `${cls} at ${twa}° then ${twa + 40}°: every control moves at a crew's pace (${fast.length ? 'too fast: ' + fast.map((k) => `${k} ${c.jump[k].toFixed(2)}x`).join(', ') : 'none faster than its hands / tackle / winch'}; autoTrim alone ${worst ? `moves the ${worst[0]} ${worst[1].toFixed(0)}x faster than that` : 'within it'})`);
    const per = {}; for (const m of c.said) per[m.key] = (per[m.key] || 0) + 1;
    const most = Math.max(0, ...Object.values(per));
    check(most <= Math.ceil(40 / 8) + 1, `${cls} at ${twa}°: ${c.said.length} crew messages in 40 s, at most ${most} for one control${c.said.length ? ` (e.g. "${c.said[c.said.length - 1].msg}")` : ''}`);
  }
}
// a sheet on a winch: from fully eased, hauled in at the pace of tailing then grinding, not in one step
{
  const b = new Boat('sportboat'), env = makeSteadyEnv(12 * KT), C = new Crew();
  b.reset(0, 0, 45 * DEG); b.u = 2.5;
  for (let i = 0; i < 600; i++) { C.begin(b); autoTrim(b, dt, 0, true); C.end(b, dt); b.step(dt, env, i * dt); b.psi = 45 * DEG; b.r = 0; }
  b.ctrl.jib = 1; C.plan.jib = 1; C.real = null;
  let maxStep = 0, prev = 1, t = 0;
  for (let i = 0; i < 600; i++) {
    C.begin(b); autoTrim(b, dt, 0, true); C.end(b, dt); b.step(dt, env, (600 + i) * dt); b.psi = 45 * DEG; b.r = 0;
    maxStep = Math.max(maxStep, prev - b.ctrl.jib); prev = b.ctrl.jib; if (b.ctrl.jib > 0.35) t = (i + 1) * dt;
  }
  check(maxStep < 0.03 && t > 0.5 && t < 8, `jib sheet from fully eased: hauled in over ${t.toFixed(1)} s (largest move in a step ${(maxStep * 100).toFixed(1)}%)`);
}
console.log(fails ? `${fails} FAILED` : 'all crew checks passed');
process.exit(fails ? 1 : 0);
