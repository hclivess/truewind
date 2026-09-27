// Cost of a race fleet per 120 Hz step: the player at L0 and n AI boats at L1 (as the game starts a small fleet),
// auto crews, beam reach in 12 kn; for a big fleet also the game's mix: as many boats at L1 as the frame budget
// carries (js/fleet.js clothBudget), the rest on the strip model (L2). The game runs two steps per 60 Hz frame;
// its governor keeps the physics under 6 ms a frame. Run: node test/bench-fleet.mjs [class] [n]
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { clothBudget } from '../js/fleet.js';
const KT = 0.514444, DEG = Math.PI / 180;
const [cls = 'sportboat', nAi = '6'] = process.argv.slice(2);
const env = makeSteadyEnv(12 * KT), dt = 1 / 120;
function bench(lods) {
  const boats = lods.map((lod) => new Boat(cls, { lod }));
  boats.forEach((b, i) => { b.reset(i * 30, 0, (60 + 10 * (i % 10)) * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.4; });
  const run = (n, t0) => { for (let s = 0; s < n; s++) for (const b of boats) { autoTrim(b, dt); b.step(dt, env, (t0 + s) * dt); b.r = 0; } };
  run(600, 0);
  let best = Infinity;
  for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); run(400, 600 + r * 400); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6 / 400); }
  return { ms: best, ok: boats.every((b) => [b.u, b.phi].every(Number.isFinite)) };
}
const n = +nAi, all = bench([0, ...Array(n).fill(1)]);
console.log(`${cls}: player L0 + ${n} AI at L1: ${all.ms.toFixed(2)} ms per step, ${(2 * all.ms).toFixed(2)} ms per 60 Hz frame (governor budget 6 ms)${all.ok ? '' : ' NaN!'}`);
if (n > 6) {
  // one boat at each level alone, then the budgeted mix
  const p0 = bench([0]).ms, l1 = bench([1, 1]).ms / 2, l2 = bench([2, 2, 2, 2]).ms / 4;
  const k = Math.max(6, clothBudget(n, p0, l1, l2)), mix = bench([0, ...Array(n).fill(1).map((x, i) => (i < k ? 1 : 2))]);
  console.log(`  per boat: player L0 ${p0.toFixed(2)}, L1 ${l1.toFixed(3)}, L2 ${l2.toFixed(3)} ms per step`);
  console.log(`  the game's mix: ${k} AI at L1 (nearest the camera) + ${n - k} at L2: ${mix.ms.toFixed(2)} ms per step, ${(2 * mix.ms).toFixed(2)} ms per frame${mix.ok ? '' : ' NaN!'}`);
}
