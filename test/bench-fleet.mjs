// Cost of a race fleet per 120 Hz step: the player at L0 and n AI boats at L1 (as the game starts them), auto
// crews, beam reach in 12 kn. The game runs two steps per 60 Hz frame; its governor keeps the physics under 6 ms a
// frame. Run: node test/bench-fleet.mjs [class] [n]
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';
const KT = 0.514444, DEG = Math.PI / 180;
const [cls = 'sportboat', nAi = '6'] = process.argv.slice(2);
const env = makeSteadyEnv(12 * KT), dt = 1 / 120;
const boats = [new Boat(cls, { lod: 0 })];
for (let i = 0; i < +nAi; i++) boats.push(new Boat(cls, { lod: 1 }));
boats.forEach((b, i) => { b.reset(i * 30, 0, (60 + 10 * i) * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.4; });
const run = (n, t0) => { for (let s = 0; s < n; s++) for (const b of boats) { autoTrim(b, dt); b.step(dt, env, (t0 + s) * dt); b.r = 0; } };
run(600, 0);
let best = Infinity;
for (let r = 0; r < 3; r++) { const t = process.hrtime.bigint(); run(400, 600 + r * 400); best = Math.min(best, Number(process.hrtime.bigint() - t) / 1e6 / 400); }
const ok = boats.every((b) => [b.u, b.phi].every(Number.isFinite));
console.log(`${cls}: player L0 + ${nAi} AI at L1: ${best.toFixed(2)} ms per step, ${(2 * best).toFixed(2)} ms per 60 Hz frame (governor budget 6 ms)${ok ? '' : ' NaN!'}`);
