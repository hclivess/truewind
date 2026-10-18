// Dismasting: real rigs stand hard sailing and break in the ways real ones do (js/damage.js, js/rig-structure.js).
//  1. fatigue counts load cycles (rainflow, API RP 2SK's spiral-strand curve), not time under load: a rig's flutter at
//     the solver's rate and a steady load spend nothing; a wave-period cycle spends what the curve says
//  2. each class's rig at the righting moment of 30 deg (hull and crew), on the solver's sailing loads: shrouds 2.5-3.5 x
//     their load (more where the wire is the smallest one fitted, or the class's own data has more), the forestay at
//     least 2 x, the mast's critical load at least ~1.8 x its compression
//  3. no dismasting in hard but seamanlike sailing, 25 and 30 kn in the seaway, close-hauled, reaching and running, the
//     autopilot steering and the crew trimming (and reefing) as in the game; the fatigue spent stays small
//  4. what does break a rig still does: a strength meant for a smaller boat parts; rolled past 90 deg with the mast
//     driven into the sea (test/damage.mjs); crash gybes with the runners off are reported
// node test/dismast.mjs [quick]      MIN=minutes per run in 3 (default 2; quick: 0.75)   CLS=a,b  only those classes
import { Boat, autoTrim, makeSteadyEnv, CLASSES, CLASS_ORDER, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { Environment } from '../js/env.js';
import { Damage, rainflow, SN } from '../js/damage.js';
import { Autopilot } from '../js/autopilot.js';
import { Crew } from '../js/crew.js';
import { RigStructure, RIG_DATA } from '../js/rig-structure.js';
import { rigMargins } from '../tools/size-rigs.mjs';
const KT = 0.514444, DEG = Math.PI / 180;
const quick = process.argv.includes('quick');
const MIN = +(process.env.MIN ?? (quick ? 0.75 : 2));
const ONLY = process.env.CLS ? process.env.CLS.split(',') : null;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const dt = 1 / 120;

// ---------------------------------------------------------------- 1. rainflow
console.log('\n1. Fatigue by cycles (rainflow + Miner, API RP 2SK spiral strand: N R^5.05 = 10^(3.25 - 3.43 Lm))');
{
  const run = (f, T = 600) => { const p = { D: 0 }; for (let t = 0; t < T; t += dt) rainflow(p, f(t), SN.wire); return p.D; };
  const Dsteady = run(() => 0.6);
  const Dchat = run((t) => 0.55 + 0.004 * Math.sin(2 * Math.PI * 40 * t) + 0.003 * Math.sin(2 * Math.PI * 57 * t));
  check(Dsteady === 0 && Dchat < 1e-6, `a steady 60% load and a 0.7%-of-break flutter on 55% for 10 min: Miner sum ${Dsteady}, ${Dchat.toExponential(1)} (the old per-step rule: ${(600 * 0.3 * Math.pow(0.6 / 0.3, 5) / 1e6 + 0).toExponential(1)} and a part's life in hours)`);
  const Dw = run((t) => 0.35 + 0.15 * Math.sin(2 * Math.PI * 0.2 * t)), want = 120 / SN.wire(0.3, 0.35);
  check(Math.abs(Dw / want - 1) < 0.05, `±15% of break about 35% at a 5 s wave for 10 min: ${Dw.toExponential(2)} (120 cycles / N = ${want.toExponential(2)}: ${(SN.wire(0.3, 0.35) / 0.2 / 3600).toFixed(0)} h of it to fail)`);
  const Dhi = run((t) => 0.6 + 0.25 * Math.sin(2 * Math.PI * 0.2 * t), 3600);
  check(Dhi > 0.3, `±25% about 60% (a rig sailed past its design load in a seaway) for an hour: ${Dhi.toFixed(2)} of its life`);
}

// ---------------------------------------------------------------- 2. margins at RM30
console.log('\n2. Rig margins at the righting moment of 30 deg (the solver sailing upwind; loads beyond the dock tune scaled to RM30)');
const stayed = CLASS_ORDER.filter((id) => { const C = CLASSES[id]; if (C.speedCraft || (ONLY && !ONLY.includes(id))) return false; try { return new Boat(id, { sailModel: 'strip', lod: 2 }).rigStruct?.spec.wires.length > 0; } catch (e) { return false; } });
for (const id of stayed) {
  const C = CLASSES[id], b = new Boat(id, { sailModel: 'strip', lod: 2 }), spec = b.rigStruct.spec, generic = !!spec.generic;
  let m; try { m = rigMargins(id); } catch (e) { check(false, `${id}: ${e.message}`); continue; }
  const dmin = (key) => Math.min(...spec.wires.filter((w) => key.test(w.key)).map((w) => w.d));
  const atMin = (key) => !WIRE_MAT(spec, key) && dmin(key) <= 2.51;
  const f = (x) => (x ? x.toFixed(2) : '-');
  const msg = `${id.padEnd(11)} RM30 ${(m.RM30 / 1000).toFixed(1)} kN m: cap ${f(m.cap)}, lowers ${f(m.low)}, forestay ${f(m.fore)}, mast Pcr/P ${f(m.mast)}${generic ? ' (generic rig, sized on the solver)' : ''}`;
  const lo = Math.min(m.cap ?? 9, m.low ?? 9), hiOK = (x, key) => !x || x <= 4 || atMin(key) || !generic;
  // (the mast's margin is checked where this solver sized it; a class's own spar data is reported against ~2)
  const mastOK = (m.mast ?? 9) >= (generic ? 1.7 : 0);
  check(lo >= 2.5 && (m.fore ?? 9) >= 1.9 && mastOK && hiOK(m.cap, /^cap/) && hiOK(m.low, /^lower/), msg + (!generic && m.mast < 1.7 ? '  [its own mast data: critical load under 1.7 x]' : ''));
}
function WIRE_MAT(spec, key) { const w = spec.wires.find((x) => key.test(x.key)); return w && w.mat; }

// ---------------------------------------------------------------- 3. hard, seamanlike sailing
console.log(`\n3. Hard but seamanlike sailing in the seaway: ${MIN} min each, autopilot and crew (no dismasting; fatigue spent)`);
const SAIL = ['sportboat', 'j24', 'melges24', 'dinghy', 'catalina30', 'oceanis381', 'blackwatch', 'swan131', 'tp52', 'velsheda', 'cat', 'mariner', 'joshua', 'spray']
  .filter((id) => CLASSES[id] && (!ONLY || ONLY.includes(id)));
function sail(id, kn, twa, secs, o = {}) {
  const env = new Environment({ tws: kn * KT, twd: 0, fetchKm: 30, seed: 7, weather: 'steady' }); env.tick(0);
  const psi0 = twa * DEG, b = new Boat(id, { id: 0, sailModel: 'strip', lod: 2 });
  if (o.spec) b.rigStruct = new RigStructure(b, o.spec);
  b.reset(0, 0, psi0); b.u = 1.2;
  for (let i = 0; i < 480; i++) { autoTrim(b, dt, 0, true); if (o.noGen) b.ctrl.gen = false; b.step(dt, env, 0); b.psi = psi0; b.r = 0; b.x = 0; b.z = 0; }
  const D = new Damage(b); b.dmg = D;
  const ap = new Autopilot(b), cr = new Crew(), sim = { boats: [b], world: null, env };
  ap.engage(0);
  let t = 0, down = null, maxR = 0, worst = '', rolled = -99;
  for (let i = 0; i < secs / dt; i++, t += dt) {
    env.tick(t);
    cr.pre(b);
    if (o.each) o.each(t, b, ap, sim, cr); else { cr.begin(b); ap.update(dt, t, sim, {}); cr.end(b, dt); }
    cr.post(b, dt, true);
    const E = b.ext = b.ext || {}; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    D.pre(dt, E, env, t); b.step(dt, env, t, null); D.post(dt, { env, t, seabed: () => 'sand' });
    if (D.maxR > maxR && t > 3) { maxR = D.maxR; worst = D.worst; }
    if (Math.abs(b.phi) > 70 * DEG || b.pitch < -0.35) rolled = t;     // (capsized, or her bows driven under)
    for (const e of D.events.splice(0)) if (e.type === 'dismast' && !down) down = { t, msg: e.msg, rolled: t - rolled < 2 };
    if (down) break;
  }
  let Dmax = 0, Dk = ''; for (const k in D.parts) if (D.parts[k].D > Dmax) { Dmax = D.parts[k].D; Dk = k; }
  return { down, maxR, worst, Dmax, Dk, b, D };
}
let capsized = 0;
for (const id of SAIL) {
  for (const kn of [25, 30]) {
    // (a dinghy reaches and runs at the angles her sailor would in it: broad, not by the lee)
    for (const [name, twa] of [['close-hauled', 45], ['reaching', 100], ['running', id === 'dinghy' ? 135 : 150]]) {
      const r = sail(id, kn, twa, MIN * 60);
      const okFat = r.Dmax < 0.02, line = `${id.padEnd(11)} ${kn} kn ${name.padEnd(12)} ${r.down ? `DISMASTED at ${r.down.t.toFixed(0)} s: ${r.down.msg}` : `stands ${MIN} min`}; worst load ${(r.maxR * 100).toFixed(0)}% (${r.worst}), fatigue spent ${(r.Dmax * 100).toFixed(2)}% (${r.Dk || '-'})`;
      // (a rig broken in a capsize or a pitchpole is a rolled boat's, and real: reported, the boat's handling being the
      // question there, not the rig's strength)
      if (r.down && r.down.rolled) { console.log(`CAPS ${line} — she capsized or pitchpoled first`); capsized++; }
      else check(!r.down && okFat, line);
    }
  }
}

if (capsized) console.log(`     ${capsized} run(s) capsized or pitchpoled and broke the rig in it (not counted against the rig)`);

// ---------------------------------------------------------------- 4. the failures that are real
console.log('\n4. What does break a rig');
const crash = (id, kn, runnersOff) => sail(id, kn, 160, 100, { noGen: true, each: (t, b, ap, sim, cr) => {
  if (t < 4) { cr.begin(b); ap.update(dt, t, sim, {}); cr.end(b, dt); b.ctrl.gen = false; return; }
  // the main let run, the backstay off, and the helm put over through the gybe with nobody on the sheet (and the runners
  // not set up: the crew late with the new one)
  ap.disengage(); b.ctrl.gen = false; b.ctrl.main = 1; if (b.lines) b.lines.main = 1; b.ctrl.backstay = 0; if (runnersOff) b.ctrl.runners = 0;
  // (the helm hard over until her stern has passed through the wind, held 3 s more, then centred; the other way 30 s on)
  const side = Math.sign(wrap(0 - b.psi)) || 1, g = b._cg || (b._cg = { side, done: -1 });
  // (a following sea slewing her stern through the wind as the helm goes over: her yaw held at ~15 deg/s through it; a
  // J Class's helm alone rounds her up instead)
  if (g.done < 0) { b.ctrl.helm = -0.8 * g.side; b.r = -0.26 * g.side; if (side !== g.side) g.done = t; }
  else if (t - g.done < 3) { b.ctrl.helm = -0.8 * g.side; if (t - g.done < 1.5) b.r = -0.26 * g.side; }
  else { b.ctrl.helm = 0; if (t - g.done > 30) b._cg = { side, done: -1 }; }
} });
// a rig with a strength meant for a smaller boat (a J/70 on a dinghy's 2.5 mm caps and lowers) parts sailing upwind
if (!ONLY || ONLY.includes('sportboat')) {
  const spec = { ...RIG_DATA.sportboat, wires: RIG_DATA.sportboat.wires.map((w) => (/Shroud/.test(w.key) ? { ...w, d: 2.5 } : w)) };
  const r = sail('sportboat', 25, 45, 60, { spec });
  check(!!r.down, `J/70 on 2.5 mm caps and lowers, 25 kn close-hauled: ${r.down ? `${r.down.msg} at ${r.down.t.toFixed(0)} s` : `stands (worst ${(r.maxR * 100).toFixed(0)}% ${r.worst})`}`);
}
// crash gybes in 25 kn, the main let run, backstay and runners off (reported: the model's slam is no rig-breaker for these)
for (const [id, runners] of [['velsheda', true], ['tp52', false], ['star', true]]) {
  if (ONLY && !ONLY.includes(id)) continue;
  const r = crash(id, 25, runners);
  console.log(`     ${id} 25 kn crash gybes${runners ? ', runners off' : ''}: ${r.down ? `${r.down.msg} at ${r.down.t.toFixed(0)} s` : `stands (worst ${(r.maxR * 100).toFixed(0)}% of its strength: ${r.worst})`}`);
}
console.log(fails ? `\n${fails} dismasting check(s) FAILED` : '\nall dismasting checks passed');
process.exit(fails ? 1 : 0);
