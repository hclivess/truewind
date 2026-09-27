// The cloth sails never hold a non-finite node, whatever the boat goes through: a 60 kn open-ocean sea (Hs ~20 m)
// from the first step, a teleport (Boat.reset while sailing, as the game does after a jump), and detail-level switches
// across it. A NaN node would reach the GPU as a NaN vertex (three.js: computeBoundingSphere NaN; a black frame).
// Run: node test/cloth-nan.mjs
import { Environment, KT, DEG } from '../js/env.js';
import { Boat, autoTrim } from '../js/physics.js';
import { attachSails } from '../js/sail/sailsim.js';
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const finiteRig = (b) => {
  if (b.sailSys) for (const x of b.sailSys.sails) if (x.rig) { const c = x.rig.cloth; for (let i = 0; i < c.x.length; i++) if (!Number.isFinite(c.x[i]) || !Number.isFinite(c.v[i])) return false; }
  for (const k in b.diag.shape) for (const o of b.diag.shape[k]) if (!Number.isFinite(o.ang) || !Number.isFinite(o.d) || !Number.isFinite(o.tw)) return false;
  for (const k in b.booms) if (!Number.isFinite(b.booms[k].a) || !Number.isFinite(b.booms[k].elev ?? 0)) return false;
  return [b.x, b.z, b.psi, b.phi, b.pitch, b.heave, b.u, b.v].every(Number.isFinite);
};
const env = new Environment({ tws: 60 * KT, twd: 0, fetchKm: 2000, seed: 7, weather: 'steady' }); env.tick(0);
console.log(`60 kn open sea: Hs ${env.waves.Hs.toFixed(1)} m`);
const dt = 1 / 120;
for (const cls of ['sportboat', 'blackwatch', 'dinghy', 'cat']) {
  const b = new Boat(cls);
  let bad = 0, t = 0, steps = 0;
  const run = (secs, hdg, trim = true) => {
    for (let i = 0; i < secs / dt; i++, t += dt) {
      env.tick(t);
      if (trim) autoTrim(b, dt, 0, true);
      b.ctrl.helm = 0; b.step(dt, env, t);
      if (!finiteRig(b)) bad++;
      steps++;
    }
  };
  for (const lod of [0, 1, 2]) {
    attachSails(b, 'cloth', lod);
    b.reset(0, 0, 100 * DEG); b.u = 3;
    run(8, 100);
    // a teleport: reset where the boat is, under way, in the middle of the sea; then on the other tack
    b.reset(500, -300, 250 * DEG); b.u = 4; run(4, 250);
    // detail-level switches across a jump
    attachSails(b, 'cloth', lod === 1 ? 0 : 1, true); b.reset(-800, 900, 30 * DEG); run(3, 30);
    attachSails(b, 'cloth', lod, true); run(3, 30, false);
  }
  check(bad === 0, `${cls}: ${steps} steps in a 60 kn sea (cloth L0, L1 and the strip model) with resets and level switches, ${bad} with a non-finite cloth node, shape or boom`);
}
console.log(fail ? `${fail} FAILED` : 'all cloth-finite checks passed');
process.exit(fail ? 1 : 0);
