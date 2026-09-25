// AI in a cross-tide beside a bank: the boat reaches east (wind from the north) toward a point 500 m away,
// with 1.5 kn of tide setting it south onto a bank 60 m to leeward. A helm that aims its bow at the point
// is set down-tide onto the bank; a tide-aware one crabs up-tide and keeps its ground track clear.
import { Boat, makeSteadyEnv } from '../js/physics.js';
import { AIHelm } from '../js/race.js';
const KT = 0.514444, DEG = Math.PI / 180;
let bad = 0;
for (const cls of ['blackwatch', 'sportboat', 'dinghy']) {
  const env = makeSteadyEnv(10 * KT);
  const tide = 1.5 * KT;
  env.current.at = (x, z, o) => { o.x = 0; o.z = tide; return o; };   // flowing south (+z)
  const world = { open: false, depthAt: (x, z) => (z > 60 ? 0.4 : 12), gradDepth: () => [0, -1] };
  const b = new Boat(cls); b.reset(0, 0, 90 * DEG); b.u = 2;
  const ai = new AIHelm(b, { skill: 0.9, startFrac: 0.5 }); ai.targetsUpBsp = 2.5;
  const sim = { boats: [b], world, env };
  const dt = 1 / 60; let aground = 0, maxZ = -1e9;
  for (let i = 0; i < 60 * 180; i++) {
    ai.update(dt, i * dt, sim, null, null, null);
    b.step(dt, env, i * dt, world);
    if (b.aground > 0.05) aground += dt;
    maxZ = Math.max(maxZ, b.z);
  }
  const ok = aground === 0;
  if (!ok) bad++;
  console.log(`${cls.padEnd(10)} made ${b.x.toFixed(0)} m east, closest to the bank ${(60 - maxZ).toFixed(0)} m, aground ${aground.toFixed(0)} s  ${ok ? 'ok' : 'AGROUND'}`);
}
process.exit(bad ? 1 : 0);
