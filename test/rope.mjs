// The rope tails (js/ropesim.js): a line's free tail falls onto the deck and lies still there, like rope, at any
// frame rate — no bouncing, no creeping, no energy from nowhere.
//  1. a tail dropped from a cleat 0.3 m up comes to rest on a flat deck within 3 s (60 fps, 144 fps, a ragged mix
//     with long frames), its energy never growing once it has landed, every point on or above the deck
//  2. on a deck heeled 15 degrees, friction holds it: it does not creep to leeward; at 45 degrees it slides
//  3. hauling in (the tail growing 0.5 -> 2 m through the cleat) and easing (back to 0.6 m): it settles again
//  4. the boat pitching and heaving in a seaway (the frame accelerating +-3 m/s^2): a tail on deck stays on deck
//  5. a tail across a step (the side of a cabin top 0.25 m high): no jumps between the top and the sole
//  6. a tail pressed against that step by the heel in a seaway: it stays at the wall, never lifted onto the top
// Run: node test/rope.mjs
import { RopeSim, coilTail } from '../js/ropesim.js';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const DEG = Math.PI / 180;

// a tail: point 0 held at the cleat (0.3 m above the deck), N - 1 segments of rope
function tail(N = 36, len = 1.5, laid = 'straight') {
  const R = new RopeSim(N); R.pin[0] = 1; R.rest.fill(len / (N - 1));
  if (laid === 'coil') coilTail(R, 0, N - 1, len / (N - 1), 0, 0.3, 0, 0.3, 0.01, 0);
  else for (let k = 0; k < N; k++) R.set(k, k * len / (N - 1), 0.3, 0);
  return R;
}
const flat = (h = 0) => () => h;
const lowest = (R, floor) => { let m = Infinity; for (let k = 0; k < R.n; k++) m = Math.min(m, R.x[3 * k + 1] - floor(R.x[3 * k], R.x[3 * k + 2])); return m; };
const snap = (R) => Float64Array.from(R.x);
const moved = (R, a) => { let m = 0; for (let k = 0; k < R.n; k++) m = Math.max(m, Math.hypot(R.x[3 * k] - a[3 * k], R.x[3 * k + 1] - a[3 * k + 1], R.x[3 * k + 2] - a[3 * k + 2])); return m; };
// run for T s at frame times from gen(), env from envAt(t); returns the energy trace (one sample per frame)
function run(R, T, gen, envAt, onFrame) {
  const E = []; let t = 0;
  while (t < T) { const dt = gen(t); R.advance(dt, envAt(t)); t += dt; E.push([t, R.energy()]); if (onFrame) onFrame(t, dt); }
  return E;
}
const env0 = (g = [0, -9.81, 0], floorY = flat(0)) => ({ g, air: [3, 0, 0], cd: 0.03, floorY, rad: 0.004 });

// 1. dropped, at three frame rates
const rates = { '60 fps': () => 1 / 60, '144 fps': () => 1 / 144, 'ragged (30-240 fps, 0.1 s stalls)': (t) => (Math.floor(t * 97) % 23 === 0 ? 0.1 : [1 / 30, 1 / 240, 1 / 90, 1 / 144, 1 / 60][Math.floor(t * 131) % 5]) };
for (const [name, gen] of Object.entries(rates)) {
  for (const laid of ['straight', 'coil']) {
    const R = tail(36, 1.5, laid), env = env0();
    const E = run(R, 3, gen, () => env);
    const late = E.filter(([t]) => t > 2), eLate = Math.max(...late.map(e => e[1]));
    // after landing (1 s), the energy never rises above what it was when it landed
    const after = E.filter(([t]) => t > 1.5), grow = after.some(([, e]) => e > Math.max(1e-3, after[0][1] * 1.2));
    const a = snap(R); run(R, 1, gen, () => env);
    const creep = moved(R, a);
    check(R.finite() && eLate < 2e-4 && !grow && creep < 0.003 && lowest(R, flat(0)) > -0.002,
      `${name}, laid ${laid}: at rest by 2 s (energy ${eLate.toExponential(1)} m²/s², moved ${(creep * 1000).toFixed(1)} mm in the next second, lowest ${(lowest(R, flat(0)) * 1000).toFixed(1)} mm)${grow ? ' — ENERGY GREW' : ''}`);
  }
}
// 2. heeled
for (const [heel, slides] of [[15, false], [45, true]]) {
  const g = [0, -9.81 * Math.cos(heel * DEG), 9.81 * Math.sin(heel * DEG)];           // (heeled across the tail's lead)
  const R = tail(36, 1.5), env = env0(g);
  run(R, 3, () => 1 / 60, () => env0());                       // lands upright
  // (the half of the tail at its end, lying on deck: the part hanging from the cleat swings to the new vertical, as
  // it would, and drags the touchdown along a little)
  const a = snap(R), on = Array.from(R.contact); run(R, 2, () => 1 / 60, () => env);
  let m = 0; for (let k = R.n >> 1; k < R.n; k++) if (on[k]) m = Math.max(m, Math.hypot(R.x[3 * k] - a[3 * k], R.x[3 * k + 2] - a[3 * k + 2]));
  check(R.finite() && (slides ? m > 0.1 : m < 0.01), `heeled ${heel}°: ${slides ? 'slides to leeward' : 'friction holds it'} (moved ${(m * 1000).toFixed(0)} mm in 2 s)`);
}
// 3. hauled in and eased through the cleat
{
  const R = tail(40, 0.5), env = env0();
  let L = 0.5;
  run(R, 2, () => 1 / 60, () => env);
  const E = run(R, 6, () => 1 / 144, (t) => { L = t < 2 ? 0.5 + 0.75 * t : t < 3 ? 2 : Math.max(0.6, 2 - 1.4 * (t - 3)); R.rest.fill(L / 39); return env; });
  const e = Math.max(...E.filter(([t]) => t > 5.5).map(x => x[1]));
  const a = snap(R); run(R, 1, () => 1 / 144, () => env);
  check(R.finite() && e < 1e-3 && moved(R, a) < 0.005, `hauled in to 2 m and eased to 0.6 m: settles (energy ${e.toExponential(1)}, then moved ${(moved(R, a) * 1000).toFixed(1)} mm in 1 s)`);
}
// 4. in a seaway: the frame accelerating up and down (heave) and fore and aft (pitch)
{
  const R = tail(36, 1.5, 'coil'), env = env0();
  run(R, 2, () => 1 / 60, () => env);
  let up = 0;
  const E = run(R, 8, () => 1 / 144, (t) => ({ ...env, g: [2 * Math.sin(2.1 * t), -9.81 - 3 * Math.sin(1.3 * t), 0.8 * Math.cos(1.7 * t)] }), () => { up = Math.max(up, -lowest(R, () => 0) < 0 ? 0 : 0); for (let k = 1; k < R.n; k++) up = Math.max(up, R.x[3 * k + 1]); });
  const e = Math.max(...E.map(x => x[1]));
  check(R.finite() && up < 0.3 + 1e-3 && e < 0.05, `pitching and heaving (±3 m/s²): lies on deck (highest point ${(up * 1000).toFixed(0)} mm, peak energy ${e.toExponential(1)})`);
}
// 5. across the side of a cabin top: the top 0.25 m up for x < 0.4, the sole beyond
{
  const step = (x) => (x < 0.4 ? 0.25 : 0);
  const R = new RopeSim(36); R.pin[0] = 1; R.rest.fill(1.5 / 35);
  for (let k = 0; k < 36; k++) R.set(k, k * 1.5 / 35 - 0.1, 0.4, 0.02 * Math.sin(k));
  const env = env0([0, -9.81, 0], step);
  let jump = 0, prev = snap(R);
  run(R, 4, () => 1 / 144, () => env, (t) => { if (t > 1.5) jump = Math.max(jump, moved(R, prev)); prev = snap(R); });
  check(R.finite() && jump < 0.01 && lowest(R, step) > -0.01, `over a cabin side: no jumps (largest move in a frame after landing ${(jump * 1000).toFixed(1)} mm)`);
}
// 6. a tail on the sole pressed against the side of a cabin top by the heel (and a seaway), creeping into it: it
//    stays at the wall (a surface height remembered while a point crept a few millimetres once let one through, then
//    lifted it onto the top in a single step)
{
  const step = (x) => (x < 0.2 ? 0.25 : 0);
  const R = new RopeSim(24); R.pin[0] = 1; R.rest.fill(0.9 / 23);
  for (let k = 0; k < 24; k++) R.set(k, 1.1 - k * 0.9 / 23 * 0.9, 0.01, 0.03 * Math.sin(k));
  let t = 0, jump = 0, prev = snap(R);
  run(R, 12, (t) => 1 / 60 + 0.002 * Math.sin(t * 91), (tt) => { t = tt; return { g: [-3 + 1.5 * Math.sin(1.1 * t), -9.81 - 2 * Math.sin(1.3 * t), 0.8 * Math.sin(0.7 * t)], air: [-4, 0, 1], cd: 0.03, floorY: step, rad: 0.004 }; },
    () => { jump = Math.max(jump, moved(R, prev)); prev = snap(R); });
  let onTop = 0; for (let k = 1; k < 24; k++) if (R.x[3 * k] < 0.2 - 0.01 && R.x[3 * k + 1] > 0.2) onTop++;
  check(R.finite() && jump < 0.05 && onTop === 0, `pressed against a cabin side in a seaway: stays at the wall (largest move in a frame ${(jump * 1000).toFixed(0)} mm, points climbed onto the top ${onTop})`);
}
console.log(fails ? `${fails} FAILED` : 'all rope checks passed');
process.exit(fails ? 1 : 0);
