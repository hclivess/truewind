// What the automatic crew touches lights up (js/crew.js Crew.hl, drawn by js/autoglow.js and the rig panel):
//  1. every control the crew moves in a step is touched in that step, with the way it moved (+: up) and lit fully
//  2. once the hands are off it, the light holds HL_HOLD s and fades out over HL_FADE s
//  3. the helm, the reef and the engine lever are credited to the automation only for what it changed (pre / post
//     around it): the player's own input before it is not
//  4. the crew's weight moving (automatic hiking) is touched, out / in
//  5. the labels' words: a sheet hauled is "trim", eased "ease"; the vang "on" / "off"; the helm "port" / "stbd"
// Run: node test/autoglow.mjs
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { Crew, touchLabel, HL_HOLD, HL_FADE } from '../js/crew.js';
const KT = 0.514444, DEG = Math.PI / 180, dt = 1 / 60;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// 1. sailing on the crew, bearing away half way: each moved control touched that step, the right way
{
  const env = makeSteadyEnv(12 * KT), b = new Boat('sportboat');
  b.reset(0, 0, 45 * DEG); b.u = 2; b.auto.trim = true;
  const C = new Crew(), seen = new Set();
  let miss = 0, wrong = 0, moved = 0;
  for (let i = 0; i < 30 / dt; i++) {
    if (i === Math.round(15 / dt)) b.psi += 50 * DEG;
    const before = { ...b.ctrl };
    C.pre(b); C.begin(b); autoTrim(b, dt, 0, true); C.end(b, dt); C.post(b, dt, false);
    for (const k in C.real) {
      const dv = b.ctrl[k] - before[k];
      if (Math.abs(dv) < 1e-9) continue;
      moved++; seen.add(k);
      const e = C.hl[k];
      if (!e || !(e.live > 0) || e.a < 0.999) miss++;
      else if (e.dir !== Math.sign(dv) && !(k === 'jib' && b.lh && b.lh.jib && b.lh.jib.fly)) wrong++;
    }
    b.step(dt, env, i * dt);
  }
  check(moved > 50 && seen.has('main') && seen.has('trav'), `the crew worked ${seen.size} controls (${[...seen].join(', ')}), ${moved} moves`);
  check(miss === 0, `every move touched and lit in its step (${miss} missed)`);
  check(wrong === 0, `touched the way it moved (${wrong} the wrong way)`);
  // 2. the hands off: lit HL_HOLD, then out within HL_FADE
  const k = [...seen][0];
  C.touch(k, 1); C.tick(HL_HOLD * 0.8);
  check(C.hl[k].a === 1, `${k}: still fully lit ${(HL_HOLD * 0.8).toFixed(2)} s after the last touch`);
  for (let t = 0; t < HL_HOLD + 0.5 * HL_FADE; t += dt) C.tick(dt);
  const mid = C.hl[k].a;
  for (let t = 0; t < 0.6 * HL_FADE; t += dt) C.tick(dt);
  check(mid > 0.2 && mid < 0.8 && C.hl[k].a === 0, `fades over ${HL_FADE} s (half way ${mid.toFixed(2)}, then dark)`);
}

// 3. helm / reef / throttle: only what the automation changed
{
  const b = new Boat('sportboat'), C = new Crew();
  b.reset(0, 0, 45 * DEG);
  b.ctrl.helm = 0.4;                          // the player's own input, before the automation runs
  C.pre(b); C.post(b, dt, true);
  check(!C.hl.helm, 'the player moving the helm is not lit');
  C.pre(b); b.ctrl.helm -= 0.02; C.post(b, dt, true);
  check(C.hl.helm && C.hl.helm.dir === -1 && C.hl.helm.a > 0.25, `the autopilot steering to port is lit (${C.hl.helm && C.hl.helm.a.toFixed(2)})`);
  C.pre(b); b.ctrl.helm += 0.02; C.post(b, dt, false);
  check(C.hl.helm.dir === -1, 'helm changes outside the autopilot are not credited to it');
  C.pre(b); b.ctrl.reef = 1; b.reefing = true; C.post(b, dt, true);
  check(C.hl.reef && C.hl.reef.dir === 1, 'a reef put in is lit');
  for (let i = 0; i < 120; i++) { C.pre(b); C.post(b, dt, true); }
  check(C.hl.reef.a === 1, 'and stays lit while the reef is worked');
  b.reefing = false; for (let i = 0; i < 120; i++) { C.pre(b); C.post(b, dt, true); }
  check(C.hl.reef.a === 0, 'and goes out once it is in');
  if (b.engine) { C.pre(b); b.engine.throttle = 0.3; C.post(b, dt, true); check(C.hl.throttle && C.hl.throttle.dir === 1, 'the lever moved by the automation is lit'); }
}

// 4. the crew's weight
{
  const b = new Boat('sportboat'), C = new Crew();
  b.reset(0, 0, 45 * DEG); b.auto.hike = true; b.crewY = 0.2;
  C.pre(b); C.post(b, dt, false);
  b.crewY = 0.2015; C.pre(b); C.post(b, dt, false);
  check(!C.hl.hike, 'the weight creeping (0.09 m/s) is not lit');
  b.crewY = 0.3; C.pre(b); C.post(b, dt, false);
  check(C.hl.hike && C.hl.hike.dir === 1, 'the crew moving out is lit, out');
  b.auto.hike = false; b.crewY = 0.1; C.hl.hike.dir = 0; C.pre(b); C.post(b, dt, false);
  check(C.hl.hike.dir === 0, 'the player placing the weight is not');
}

// 5. the words
{
  const b = new Boat('sportboat');
  const w = (k, d) => { const L = touchLabel(b, k, d); return `${L.name} ${L.arrow} ${L.word}`; };
  check(w('main', -1) === 'Mainsheet ▲ trim' && w('main', 1) === 'Mainsheet ▼ ease', `${w('main', -1)} / ${w('main', 1)}`);
  check(w('vang', 1) === 'Vang ▲ on' && w('vang', -1) === 'Vang ▼ off', `${w('vang', 1)} / ${w('vang', -1)}`);
  check(w('helm', -1) === 'Helm ◀ port' && w('helm', 1) === 'Helm ▶ stbd', `${w('helm', -1)} / ${w('helm', 1)}`);
  check(w('trav', 1) === 'Traveller ▼ down', w('trav', 1));
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
