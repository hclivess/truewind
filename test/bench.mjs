// Cost of one 120 Hz physics step per boat, for each class and sail model / detail level.
// Beam reach in 12 kn, auto crew, after a 5 s warm-up. Run: node test/bench.mjs [class] [models]
//   models: comma list of strip, vlm, cloth0, cloth1 (default: all)
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
import { attachSails } from '../js/sail/sailsim.js';
const KT = 0.514444, DEG = Math.PI / 180;
const classes = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : Object.keys(CLASSES);
const models = (process.argv[3] || 'strip,vlm,cloth0,cloth1').split(',');
const dt = 1 / 120, warm = 600, N = 1200;
for (const cls of classes) {
  const row = [];
  for (const m of models) {
    const b = new Boat(cls, { sailModel: 'strip' });
    if (m === 'vlm') attachSails(b, 'vlm', 0);
    else if (m.startsWith('cloth')) attachSails(b, 'cloth', +m.slice(5));
    const env = makeSteadyEnv(12 * KT);
    b.reset(0, 0, 60 * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.4;
    for (let i = 0; i < warm; i++) { autoTrim(b, dt); b.step(dt, env, i * dt); b.psi = 60 * DEG; b.r = 0; }
    // best of three blocks (the machine may be shared: the least disturbed block is the cost)
    let ms = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < N / 3; i++) { autoTrim(b, dt); b.step(dt, env, (warm + r * N / 3 + i) * dt); b.psi = 60 * DEG; b.r = 0; }
      ms = Math.min(ms, Number(process.hrtime.bigint() - t0) / 1e6 / (N / 3));
    }
    const ok = [b.u, b.v, b.phi, b.r].every(Number.isFinite);
    row.push(`${m} ${ms.toFixed(3)} ms${ok ? '' : ' NaN!'} (${(b.u / KT).toFixed(1)} kn)`);
  }
  console.log(`${cls.padEnd(10)} ${row.join(' | ')}`);
}
