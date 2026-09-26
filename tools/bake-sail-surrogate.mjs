// Bakes the cloth sails' polars: node tools/bake-sail-surrogate.mjs [class...] [--tws=4,6,8,...] [--jobs=N] [--secs=30]
//
// For each class and wind speed, the full cloth + vortex-lattice model (level 0, the player's) sails at each of the
// VPP's true wind angles at the game's 120 Hz step, yaw locked, flat water, steady wind with its gradient, with the
// automatic crew and each of the VPP's trim offsets (-4, 0, +4 degrees; with and without the gennaker from 85
// degrees), and the fastest settled speed is kept, exactly as physics.js solvePolarAngle does for the strip model.
// The result goes to data/sails/<class>.json, which js/sail/surrogate.js reads back for the game's polar.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';

const KT = 0.514444, DEG = Math.PI / 180;
const BIASES = [-4, 0, 4];

async function sailAngle(cls, twsKn, twa, secs) {
  const { Boat, autoTrim, makeSteadyEnv, CLASSES } = await import('../js/physics.js');
  await import('../js/sail/sailsim.js');
  const C = CLASSES[cls], dt = 1 / 120, steps = Math.round(secs / dt);
  const gens = C.sails.some((s) => s.kind === 'spin') && twa >= 85 ? [false, true] : [false];
  let best = { bsp: 0, heel: 0, leeway: 0, gen: 0, bias: 0 };
  for (const gen of gens) for (const bias of BIASES) {
    const env = makeSteadyEnv(twsKn * KT), b = new Boat(C, { sailModel: 'cloth', lod: 0 });
    b.reset(0, 0, twa * DEG); b.u = 1.5; for (const k in b.booms) b.booms[k].a = 0.3; b.side.jib = 1; b.side.gennaker = 1;
    b.ctrl.gen = gen; b.genDeploy = gen ? 1 : 0; b.genFill = gen ? 1 : 0;
    let acc = 0, n = 0, heel = 0, lee = 0, bad = false;
    for (let i = 0; i < steps; i++) {
      autoTrim(b, dt, bias); b.step(dt, env, i * dt); b.r = 0; b.psi = twa * DEG; b.rudder = 0;
      if (!Number.isFinite(b.u)) { bad = true; break; }
      if (i > steps * 0.6) { acc += b.u; heel += b.phi; lee += b.diag.leeway || 0; n++; }
    }
    const bsp = bad || b.capsized ? 0 : acc / n / KT;
    if (bsp > best.bsp) best = { bsp, heel: Math.abs(heel / n) / DEG, leeway: Math.abs(lee / n) / DEG, gen: gen ? 1 : 0, bias };
  }
  return best;
}

if (!isMainThread) {
  parentPort.on('message', async (job) => {
    const r = await sailAngle(job.cls, job.tws, job.twa, workerData.secs);
    parentPort.postMessage({ ...job, r });
  });
} else {
  const { CLASSES, POLAR_TWAS } = await import('../js/physics.js');
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  const classes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const todo = classes.length ? classes : Object.keys(CLASSES);
  const TWS = arg('tws', '4,6,8,10,12,14,16,20,25').split(',').map(Number);
  const secs = +arg('secs', '30'), nJobs = +arg('jobs', String(Math.max(1, cpus().length - 1)));
  const jobs = [];
  for (const cls of todo) for (const tws of TWS) for (const twa of POLAR_TWAS) jobs.push({ cls, tws, twa });
  const out = {};
  for (const cls of todo) out[cls] = { rows: {} };
  const t0 = Date.now(); let done = 0;
  await new Promise((resolve) => {
    let next = 0, alive = 0;
    const workers = Array.from({ length: Math.min(nJobs, jobs.length) }, () => new Worker(new URL(import.meta.url), { workerData: { secs } }));
    const feed = (w) => { if (next < jobs.length) { w.postMessage(jobs[next++]); return true; } w.terminate(); return false; };
    for (const w of workers) {
      alive++;
      w.on('message', (m) => {
        out[m.cls].rows[`${m.tws}:${m.twa}`] = m.r; done++;
        if (done % 20 === 0) process.stdout.write(`\r${done}/${jobs.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        if (!feed(w) && --alive === 0) resolve();
      });
      feed(w);
    }
  });
  mkdirSync(new URL('../data/sails/', import.meta.url), { recursive: true });
  const r3 = (v) => Math.round(v * 1000) / 1000, r1 = (v) => Math.round(v * 10) / 10;
  for (const cls of todo) {
    const R = out[cls].rows, tab = (f) => TWS.map((t) => POLAR_TWAS.map((a) => f(R[`${t}:${a}`])));
    const data = { class: cls, model: 'cloth', lod: 0, secs, hz: 120, biases: BIASES, baked: new Date().toISOString().slice(0, 10),
      tws: TWS, twa: POLAR_TWAS, bsp: tab((r) => r3(r.bsp)), heel: tab((r) => r1(r.heel)), leeway: tab((r) => r1(r.leeway)), gen: tab((r) => r.gen), bias: tab((r) => r.bias) };
    writeFileSync(new URL(`../data/sails/${cls}.json`, import.meta.url), JSON.stringify(data) + '\n');
    const i12 = TWS.indexOf(12);
    if (i12 >= 0) console.log(`\n${cls} 12 kn: ` + POLAR_TWAS.map((a, j) => `${a}:${data.bsp[i12][j].toFixed(2)}${data.gen[i12][j] ? 'g' : ''}`).join(' '));
  }
  console.log(`\nbaked ${todo.join(', ')} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
