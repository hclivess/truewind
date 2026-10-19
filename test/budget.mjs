// Performance budgets for the physics. The game's budget is the governor's: 6 ms of physics per 1/60 s of sailing,
// i.e. 3 ms per 120 Hz step for every boat together (js/governor.js GOV.budget). Costs are CPU time
// (process.cpuUsage: what this process ran, so a loaded machine slows it less than the wall clock), best of three
// blocks, beam reach in 12 kn with the auto crew.
//  1. against the budget (the share each level must keep for the fleet to fit): reported with the machine's speed
//     factor; checked only with ABS=1 (on a quiet desktop-class core), since a shared server's CPU time is inflated
//     by contention:  player L0 <= 2/3 of a step, a fleet boat at L1 <= 1/8, a strip boat (L2) <= 1/40
//  2. regression: each cost in units of a fixed reference workload timed in the same run (dense 6x6 solves,
//     the kind of arithmetic the physics does), which the load slows about as much; limit 2x the units measured
//     when this test was written (2026-10, a heavily loaded 12-core server), so it fails on a real slow-down only
// node test/budget.mjs   [QUICK=1: the sportboat only; CLASSES=a,b; ABS=1]
import { suite } from './lib/check.mjs';
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import { attachSails } from '../js/sail/sailsim.js';
import { GOV } from '../js/governor.js';
const QUICK = !!+(process.env.QUICK || 0), KT = 0.514444, DEG = Math.PI / 180;
const S = suite('budget');
const STEP = GOV.budget / 2;                        // ms per 120 Hz step for everything (6 ms per 1/60 s)
const CLS = process.env.CLASSES ? process.env.CLASSES.split(',') : QUICK ? ['sportboat'] : ['sportboat', 'dinghy', 'cat', 'blackwatch', 'tp52'];
const LIM = { cloth0: STEP * 2 / 3, cloth1: STEP / 8, strip: STEP / 40 };
const ABS = !!+(process.env.ABS || 0);
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
// the reference workload: 20000 small dense solves (Gaussian elimination on 6x6 systems), best of 5, ms
function refMs() {
  const A = new Float64Array(36), x = new Float64Array(6); let sink = 0, best = Infinity;
  for (let r = 0; r < 5; r++) {
    const c0 = cpuMs();
    for (let k = 0; k < 20000; k++) {
      for (let i = 0; i < 36; i++) A[i] = Math.sin(i * 1.3 + k) + (i % 7 === 0 ? 4 : 0);
      for (let i = 0; i < 6; i++) x[i] = Math.cos(i + k);
      for (let c = 0; c < 6; c++) for (let i = c + 1; i < 6; i++) { const f = A[i * 6 + c] / A[c * 6 + c]; for (let j = c; j < 6; j++) A[i * 6 + j] -= f * A[c * 6 + j]; x[i] -= f * x[c]; }
      for (let i = 5; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < 6; j++) s -= A[i * 6 + j] * x[j]; x[i] = s / A[i * 6 + i]; }
      sink += x[0];
    }
    best = Math.min(best, cpuMs() - c0);
  }
  if (!Number.isFinite(sink)) console.log('');
  return best;
}
// cost units (step CPU / reference CPU) measured when written; the limit is twice these
const UNITS = { strip: 0.035, cloth1: 0.075, cloth0: 0.15 };
const ref0 = refMs();
console.log(`reference workload: ${ref0.toFixed(1)} ms CPU`);
const dt = 1 / 120;
for (const cls of CLS) {
  for (const m of ['strip', 'cloth1', 'cloth0']) {
    const b = new Boat(cls, { sailModel: 'strip' });
    if (m.startsWith('cloth')) attachSails(b, 'cloth', +m.slice(5));
    const env = makeSteadyEnv(12 * KT);
    b.reset(0, 0, 90 * DEG); b.u = 2.5;
    const warm = m === 'strip' ? 240 : 360, N = m === 'strip' ? 1200 : 240;
    for (let i = 0; i < warm; i++) { autoTrim(b, dt); b.step(dt, env, i * dt); b.psi = 90 * DEG; b.r = 0; }
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const c0 = cpuMs();
      for (let i = 0; i < N / 3; i++) { autoTrim(b, dt); b.step(dt, env, (warm + r * N / 3 + i) * dt); b.psi = 90 * DEG; b.r = 0; }
      best = Math.min(best, (cpuMs() - c0) / (N / 3));
    }
    const lv = m === 'strip' ? 'strip (L2)' : m === 'cloth1' ? 'cloth L1 (fleet)' : 'cloth L0 (player)';
    if (ABS) S.within({ quantity: `${cls} ${lv}: CPU per 120 Hz step`, measured: best, hi: LIM[m], unit: 'ms', source: `governor budget ${GOV.budget} ms per 1/60 s (js/governor.js); this level's share ${(LIM[m] / STEP).toFixed(3)} of a step` });
    else console.log(`     ${cls} ${lv}: ${best.toFixed(3)} ms CPU per step (${(best / LIM[m]).toFixed(1)}x its budget share ${LIM[m].toFixed(3)} ms on this machine)`);
    S.within({ quantity: `${cls} ${lv}: step cost in reference-workload units`, measured: best / ref0, hi: 2 * UNITS[m], unit: '', source: `regression guard: 2x the cost measured when written (${UNITS[m]})` });
  }
}
S.done();
