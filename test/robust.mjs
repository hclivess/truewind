// Robustness of the boat physics (js/physics.js Boat.step and what it calls):
//  1. fuzz: random extreme conditions (to 60 kn, a 9 m swell, gust 1), every control slammed to its limits at random,
//     time steps of 1/240 .. 1/30 s with jitter, the odd 0.1 s step (the frame clamp's catch-up), teleports: every
//     state stays finite and bounded, every step
//  2. NaN injection: a NaN helm, a NaN wind sample, a NaN stream for one step: the state is finite again within a
//     second and stays so (a NaN must not stick)
//  3. determinism: the same seed and inputs give bit-identical states, in this process and in a fresh one
//  4. long run: two hours of sim time on a beam reach with a simple heading hold (QUICK: 10 min): speed, heel and
//     heave do not drift, the log agrees with the track; at rest in calm water for the same time, no creep
// node test/robust.mjs        QUICK=1 for the short version; SAILS=cloth for the cloth sails (default strip here);
//                              ONLY=fuzz,nan,det,long for some sections
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite } from './lib/check.mjs';
import { Boat, autoTrim, makeSteadyEnv, wrap } from '../js/physics.js';
import { Environment, KT, DEG, mulberry32 } from '../js/env.js';
import '../js/sail/sailsim.js';
const QUICK = !!+(process.env.QUICK || 0), MODEL = process.env.SAILS || 'strip';
const ME = fileURLToPath(import.meta.url);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean), on = (k) => !ONLY.length || ONLY.includes(k);   // ONLY=fuzz,nan,det,long

const KEYS = ['x', 'z', 'psi', 'u', 'v', 'r', 'phi', 'p', 'heave', 'heaveV', 'pitch', 'pitchV', 'rudder', 'crewY'];
const finite = (b) => KEYS.every((k) => Number.isFinite(b[k])) && Object.values(b.booms).every((q) => Number.isFinite(q.a));
const bounded = (b) => Math.abs(b.u) < 60 && Math.abs(b.v) < 30 && Math.abs(b.r) < 8 && Math.abs(b.p) < 15 && Math.abs(b.heave) < 30 && Math.abs(b.heaveV) < 40;
const hashState = (b) => KEYS.map((k) => b[k].toPrecision(17)).join(',');

// one deterministic run: returns the final state's hash
function detRun(cls, seed, secs) {
  const env = new Environment({ tws: 18 * KT, twd: 30, gust: 0.7, shift: 8, seed, weather: 'steady', swellH: 1.5, swellT: 8 });
  const b = new Boat(cls, { sailModel: MODEL, lod: 1 }); b.reset(0, 0, 100 * DEG); b.u = 2;
  const dt = 1 / 120; let t = 0;
  for (let i = 0; i < secs * 120; i++) { autoTrim(b, dt); b.ctrl.helm = 0.3 * Math.sin(t / 3); b.step(dt, env, t); t += dt; env.tick(t); }
  return hashState(b);
}
// (the child: the first boat of the class built in a fresh process, then a second one)
if (process.argv[2] === 'det-child') { const a = detRun(process.argv[3], +process.argv[4], +process.argv[5]); process.send([a, detRun(process.argv[3], +process.argv[4], +process.argv[5])]); process.exit(0); }

const S = suite('robust');
const CLS = QUICK ? ['sportboat', 'dinghy', 'cat'] : ['sportboat', 'dinghy', 'cat', 'blackwatch', 'j24', 'tp52', 'optimist', 'velsheda', 'folkboat'];

// ---------------------------------------------------------------- 1. fuzz
if (on('fuzz')) {
  const R = mulberry32(20261019);
  let steps = 0, bad = null, worst = { u: 0, r: 0, p: 0 };
  const runs = QUICK ? 6 : 18, secs = QUICK ? 40 : 90;
  for (let k = 0; k < runs; k++) {
    const cls = CLS[k % CLS.length];
    const tws = (5 + R() * 55) * KT, swellH = R() < 0.5 ? R() * 9 : 0;
    const env = new Environment({ tws, twd: R() * 360, gust: R(), shift: R() * 25, seed: 1 + Math.floor(R() * 999), weather: R() < 0.3 ? 'squally' : 'changing', swellH, swellT: 6 + R() * 10, currentKt: R() * 4, currentDir: R() * 360 });
    const b = new Boat(cls, { sailModel: MODEL, lod: 1 }); b.reset(0, 0, R() * 6.28); b.u = R() * 4;
    let t = 0;
    const baseDt = [1 / 240, 1 / 120, 1 / 60, 1 / 50, 1 / 30][k % 5];
    for (let i = 0; t < secs; i++) {
      if (i % 240 === 0) {                                   // every couple of seconds: slam the controls
        const c = b.ctrl, pick = () => (R() < 0.5 ? 0 : 1);
        c.helm = R() < 0.3 ? 0 : R() < 0.5 ? -1 : 1;
        for (const s of ['main', 'jib', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'board', 'lazy', 'jibLead', 'mizzen', 'fore']) if (s in c) c[s] = pick();
        c.gen = R() < 0.3; c.reef = Math.floor(R() * 3); c.hike = R() * 2 - 1; c.crewAft = R() * 2 - 1;
        b.auto.hike = R() < 0.5;
        if (R() < 0.08) { b.reset(R() * 200, R() * 200, R() * 6.28); b.u = R() * 6; }    // a teleport (a new start)
      }
      const dt = R() < 0.002 ? 0.1 : baseDt * (0.75 + 0.5 * R());
      b.step(dt, env, t); t += dt; env.tick(t); steps++;
      if (!finite(b) || !bounded(b)) { bad = bad || `${cls} run ${k} t ${t.toFixed(2)} tws ${(tws / KT).toFixed(0)} swell ${swellH.toFixed(1)}: ${KEYS.map((q) => q + ' ' + (+b[q]).toPrecision(3)).join(' ')}`; break; }
      worst.u = Math.max(worst.u, Math.abs(b.u)); worst.r = Math.max(worst.r, Math.abs(b.r)); worst.p = Math.max(worst.p, Math.abs(b.p));
    }
  }
  S.ok(!bad, `fuzz: ${runs} runs, ${steps} steps, ${CLS.length} classes, ${MODEL} sails: every state finite and bounded`, { measured: bad || `max |u| ${worst.u.toFixed(1)} m/s, |r| ${worst.r.toFixed(2)} rad/s, |p| ${worst.p.toFixed(2)} rad/s`, expected: 'finite, |u|<60, |r|<8, |p|<15', source: 'a physical boat: no energy from nowhere' });
}

// ---------------------------------------------------------------- 2. NaN injection
if (on('nan')) {
  const cases = [
    ['helm', (b, env, on) => { b.ctrl.helm = on ? NaN : 0.1; }],
    ['main sheet', (b, env, on) => { b.ctrl.main = on ? NaN : 0.3; }],
    ['wind speed', (b, env, on) => { env._nan = on; }],
    ['stream', (b, env, on) => { env._nanC = on; }],
  ];
  for (const cls of QUICK ? ['sportboat'] : ['sportboat', 'dinghy', 'cat']) for (const [what, poke] of cases) {
    const env = makeSteadyEnv(14 * KT), w0 = env.wind.sample, c0 = env.current.at;
    env.wind.sample = (x, z, t, o) => { w0(x, z, t, o); if (env._nan) o.speed = NaN; return o; };
    env.current.at = (x, z, o) => { c0(x, z, o); if (env._nanC) { o.x = NaN; o.z = NaN; } return o; };
    const b = new Boat(cls, { sailModel: MODEL, lod: 1 }); b.reset(0, 0, 90 * DEG); b.u = 2.5;
    const dt = 1 / 120; let t = 0, badAfter = 0, firstOk = null;
    for (let i = 0; i < 120 * 6; i++) {
      poke(b, env, i === 240);
      autoTrim(b, dt); if (what !== 'helm') b.ctrl.helm = 0;
      if (what === 'main sheet' && i === 240) b.ctrl.main = NaN;
      b.step(dt, env, t); t += dt;
      if (i > 240) { if (finite(b)) { if (firstOk === null) firstOk = (i - 240) * dt; } else if (firstOk !== null || i > 360) badAfter++; }
    }
    S.ok(firstOk !== null && firstOk <= 1 && badAfter === 0 && finite(b), `${cls}: a NaN ${what} for one step, then finite within 1 s and for good`, { measured: firstOk === null ? 'never recovers' : `finite after ${firstOk.toFixed(3)} s, ${badAfter} bad steps later`, expected: 'recovers <= 1 s', source: 'a glitch in one input must not poison the state' });
  }
}

// ---------------------------------------------------------------- 3. determinism
if (on('det')) {
  const secs = QUICK ? 20 : 60;
  for (const cls of QUICK ? ['sportboat'] : ['sportboat', 'cat']) {
    const a = detRun(cls, 42, secs), b = detRun(cls, 42, secs), c = detRun(cls, 43, secs);
    const child = await new Promise((res) => { const p = fork(ME, ['det-child', cls, '42', String(secs)]); p.on('message', res); p.on('exit', () => res(null)); });
    S.ok(a === b, `${cls}: same seed, same inputs, ${secs} s in a seaway: bit-identical state (same process)`, { source: 'deterministic wind and waves of (seed, x, z, t): every browser in a shared world sees the same' });
    S.ok(child && a === child[1], `${cls}: bit-identical in a fresh process (its second boat)`, { source: 'no hidden state across sessions (Math.random, Date.now)' });
    S.ok(child && child[0] === child[1], `${cls}: the first boat of the class built in a process sails as every later one`, { measured: child && child[0] === child[1] ? 'same' : 'differs', expected: 'same', source: 'per-class caches (rig dock tune, hull calibration) must not change the boat' });
    S.ok(a !== c, `${cls}: a different seed gives a different run`, { source: 'the seed is used' });
  }
}

// ---------------------------------------------------------------- 4. long run
if (on('long')) {
  const H = QUICK ? 600 : 7200, dt = 1 / 60;
  for (const cls of QUICK ? ['sportboat'] : ['sportboat', 'blackwatch']) {
    const env = makeSteadyEnv(12 * KT);
    const b = new Boat(cls, { sailModel: MODEL, lod: 1 }); b.reset(0, 0, 90 * DEG); b.u = 2.5;
    const psi0 = 90 * DEG; let t = 0, track = 0, px = 0, pz = 0;
    const win = []; let acc = { u: 0, phi: 0, heave: 0, n: 0 };
    for (let i = 0; t < H; i++) {
      autoTrim(b, dt);
      b.ctrl.helm = Math.max(-1, Math.min(1, -2.5 * wrap(b.psi - psi0) - 2 * b.r));     // a plain heading hold
      b.step(dt, env, t); t += dt;
      track += Math.hypot(b.x - px, b.z - pz); px = b.x; pz = b.z;
      if (t > 120) { acc.u += b.u; acc.phi += b.phi; acc.heave += b.heave; acc.n++; }
      if (acc.n && acc.n * dt >= 300) { win.push({ u: acc.u / acc.n, phi: acc.phi / acc.n, heave: acc.heave / acc.n }); acc = { u: 0, phi: 0, heave: 0, n: 0 }; }
    }
    const us = win.map((w) => w.u), ph = win.map((w) => w.phi / DEG), hv = win.map((w) => w.heave * 100);
    const spread = (a) => Math.max(...a) - Math.min(...a), mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    S.near({ quantity: `${cls}: spread of 5 min mean boat speeds over ${H / 60} min, steady 12 kn beam reach`, measured: spread(us) / mean(us) * 100, expected: 0, tol: 2, unit: '% of the mean', source: 'steady forcing, steady state (no secular drift)' });
    S.near({ quantity: `${cls}: spread of 5 min mean heel`, measured: spread(ph), expected: 0, tol: 1, unit: 'deg', source: 'steady state' });
    S.near({ quantity: `${cls}: spread of 5 min mean heave`, measured: spread(hv), expected: 0, tol: 1, unit: 'cm', source: 'steady state' });
    S.near({ quantity: `${cls}: log / track over the ground (no stream, leeway small)`, measured: b.log / track, expected: 1, tol: 0.02, unit: '', source: 'the log integrates u; the track is u and v (cos leeway ~0.998)' });
  }
  { // at rest, calm, no wind: nothing moves
    const env = makeSteadyEnv(0.01), b = new Boat('blackwatch', { sailModel: MODEL, lod: 1 }); b.reset(0, 0, 0);
    for (const s of b.sails) b.ctrl[s.key] = 1;
    let t = 0; for (; t < H; t += dt) b.step(dt, env, t);
    S.near({ quantity: `blackwatch at rest in calm for ${H / 60} min: distance crept`, measured: Math.hypot(b.x, b.z), expected: 0, tol: 1, unit: 'm', source: 'no force, no motion' });
    S.near({ quantity: '  heel after it', measured: b.phi / DEG, expected: 0, tol: 0.5, unit: 'deg', source: 'symmetry' });
    S.ok(finite(b), '  state finite', { source: '' });
  }
}

S.done();
