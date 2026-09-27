// The helm (js/helm.js): the rudder's stock torque for an unbalanced and a balanced blade, the tiller force a J/70
// helmsman feels upwind, a wheel's gearing, and the rudder taken back when the helm is overpowered.
import { Boat, autoTrim, makeSteadyEnv, CLASSES } from '../js/physics.js';
import { foilSpec, foilState, foilGeom, foilCoef } from '../js/foils.js';
import { helmSpec, stockTorque, helmForce, rudderStep } from '../js/helm.js';
const DEG = Math.PI / 180, KT = 0.514444;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

// 1. stock torque: a blade meeting the water at +alpha pushes back toward the flow when its centre of pressure is aft
// of the stock (Q < 0), by N (x_cp - x_stock)
{
  const R = foilSpec(CLASSES.sportboat, 'rudder'), V = 3, q = 0.5 * 1025 * V * V;
  const g = foilGeom(R, 1, 0, () => 0, 1, 0, 0, V, {}), c = foilCoef(R, foilState(), 5 * DEG, V, g, 1, {});
  const Qu = stockTorque(c.cn, q, g.area, R.chord, c.xcp, 0), Qb = stockTorque(c.cn, q, g.area, R.chord, c.xcp, 0.2);
  const expect = -c.cn * q * g.area * R.chord * 0.25;
  check(Qu < 0 && Math.abs(Qu / expect - 1) < 0.01, `unbalanced blade (stock at the leading edge) at 5 deg: Q ${Qu.toFixed(1)} N m = -N c/4 (${expect.toFixed(1)})`);
  check(Qb < 0 && Math.abs(Qb) < 0.25 * Math.abs(Qu), `balanced spade (stock at 20% chord): Q ${Qb.toFixed(1)} N m, a fifth of it`);
  const st = foilState(); for (let a = 0; a <= 25; a++) foilCoef(R, st, a * DEG, V, g, 1, {});
  const cs = foilCoef(R, st, 25 * DEG, V, g, 1, {}), Qs = stockTorque(cs.cn, q, g.area, R.chord, cs.xcp, 0.2);
  check(cs.xcp > 0.35 && Qs < 2 * Qb, `stalled, the centre of pressure goes aft (x_cp ${cs.xcp.toFixed(2)} c) and the balanced blade loads up again: ${Qs.toFixed(1)} N m`);
}
// 2. the J/70 upwind in 12 kn: the tiller force (with the extension held a third of its length out), at the helm that
// holds the course in this model and at the 3 deg of weather helm J/70 tuning guides aim for
{
  const run = (fixed) => {
    const env = makeSteadyEnv(12 * KT), b = new Boat('sportboat', { sailModel: 'strip' });
    b.reset(0, 0, 45 * DEG); b.u = 2.5; for (const k in b.booms) b.booms[k].a = 0.3;
    const dt = 1 / 120; let delta = fixed ?? 0, F = 0, n = 0;
    for (let i = 0; i < 120 * 40; i++) {
      autoTrim(b, dt); b.rudder = delta; b.step(dt, env, i * dt); b.r = 0; b.psi = 45 * DEG;
      if (fixed === null) delta = Math.max(-0.5, Math.min(0.5, delta - b.diag.N / (b.Izz * 2) * dt * 40));    // the helm that holds the course
      if (i > 120 * 30) { F += Math.abs(b.diag.helmForce); n++; }
    }
    return { F: F / n, delta, feel: b.diag.helmFeel };
  };
  const bal = run(null), wh = run(3 * DEG);
  check(bal.F > 3 && bal.F < 120, `J/70 upwind in 12 kn at this model's balanced helm (${(bal.delta / DEG).toFixed(1)} deg): tiller force ${bal.F.toFixed(0)} N (${bal.feel})`);
  check(wh.F > 15 && wh.F < 100, `J/70 upwind in 12 kn with 3 deg of weather helm: tiller force ${wh.F.toFixed(0)} N (${wh.feel})`);
}
// 3. a wheel: the rim force is the stock torque over the gear ratio times the wheel's radius
{
  const C = { ...CLASSES.blackwatch, id: 'cruiser40', loa: 12, rudder: { ...CLASSES.blackwatch.rudder, max: 35 * DEG }, helm: { type: 'wheel', wheelR: 0.5, turns: 1.6 } };
  const H = helmSpec(C), Q = -120;
  check(H.type === 'wheel' && Math.abs(helmForce(H, Q) - 120 / (H.gear * 0.5)) < 1e-9 && H.gear > 7 && H.gear < 9, `wheel of 0.5 m radius, ${H.turns} turns lock to lock: gear ${H.gear.toFixed(2)}, 120 N m at the stock is ${helmForce(H, Q).toFixed(0)} N on the rim`);
  const T = helmSpec(CLASSES.sportboat);
  check(T.type === 'tiller' && Math.abs(helmForce(T, Q) - 120 / T.lever) < 1e-9, `J/70 tiller: lever ${T.lever.toFixed(2)} m, 120 N m is ${helmForce(T, Q).toFixed(0)} N`);
}
// 4. overpowered: a torque past what the helm can push takes the rudder back; within it, the rudder goes where it is put
{
  const H = helmSpec(CLASSES.blackwatch), Qmax = H.handMax * H.lever;
  let r = 0.3; for (let i = 0; i < 60; i++) r = rudderStep(H, r, 0.3, -1.5 * Qmax, 0.6, 1 / 120);
  let r2 = 0; for (let i = 0; i < 120; i++) r2 = rudderStep(H, r2, 0.3, -0.5 * Qmax, 0.6, 1 / 120);
  check(r < 0.3 - 0.05 && Math.abs(r2 - 0.3) < 0.01, `Blackwatch helm: 1.5x the ${Qmax.toFixed(0)} N m a helmsman holds takes the blade back to ${(r / DEG).toFixed(1)} deg; half of it, the blade gets to 17 deg`);
}
console.log(fails ? `${fails} helm check(s) FAILED` : 'all helm checks passed');
process.exit(fails ? 1 : 0);
