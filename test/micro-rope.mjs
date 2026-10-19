// Micro validation of the ropes against analytic mechanics.
//  js/ropesim.js (the tails you see: a chain of point masses, position Verlet, segments held at their rest length,
//  velocity damping DAMP per second):
//   1. static sag of a slack span pinned at both ends against the catenary with the rope's length
//   2. the transverse (out-of-plane) wave speed along that span sqrt(H / mu), H the catenary's horizontal tension:
//      its first out-of-plane mode, f1 = sqrt(H/mu) / 2S (Irvine 1981, Cable Structures: out-of-plane modes of a
//      shallow cable are a taut string's), with the damping's shift of the frequency
//   3. a free tail hanging from a pin: the hanging chain's first mode w1 = 1.2024 sqrt(g / L) (Bernoulli 1732;
//      j0,1 / 2 = 1.2024), damped by DAMP
//   4. the damping itself: a swinging rope in still air loses little per cycle (damping ratio ~0.01-0.1, est.);
//      no energy gain (the energy of a passive rope with fixed pins never rises), no penetration of the deck
//  js/linehandlers.js (the loads in the lines):
//   5. elastic stretch: the tackle's rope EA per unit area against rope makers' elongation figures (polyester braid
//      ~2-3.5% at 20% of break, Dyneema ~0.3-1%: est. from typical datasheets), the tackle's spring n^2 EA / L
//   6. capstan friction: a winch's tail load against T2 = T1 e^(mu theta) (Euler-Eytelwein) for its wraps
// Already in test/rope.mjs (listed in docs/VALIDATION.md): a dropped tail at rest within 2 s at any frame rate, no
// energy growth once landed, no penetration of a flat deck or a cabin-top step, friction holding at 15 deg of heel
// and sliding at 45. node test/micro-rope.mjs
import { RopeSim, DAMP } from '../js/ropesim.js';
import { CLASSES } from '../js/physics.js';
import { capstan, tackleOf, lineSpecs, HANDLERS, tailLoad, lineLoad, initLines } from '../js/linehandlers.js';
import { Register } from './lib/validation.mjs';
const V = new Register('micro-rope');
const G = 9.81, H = 1 / 120;
const still = (floor = -100) => ({ g: [0, -G, 0], air: [0, 0, 0], cd: 0, floorY: () => floor, rad: 0.004 });

// a span of rope length Lr between pins S apart (along x, at height 1)
function span(S, Lr, N = 41) {
  const R = new RopeSim(N); R.pin[0] = R.pin[N - 1] = 1; R.rest.fill(Lr / (N - 1));
  // laid on a parabola of about the right length so it starts near its shape
  for (let k = 0; k < N; k++) { const f = k / (N - 1), x = f * S; R.set(k, x, 1 - 4 * f * (1 - f) * Math.sqrt(3 * S * (Lr - S) / 8), 0); }
  return R;
}
// catenary parameter a for span S and length Lr: Lr = 2 a sinh(S / 2a)
function catA(S, Lr) { let lo = 1e-3, hi = 1e6; for (let i = 0; i < 200; i++) { const a = Math.sqrt(lo * hi); if (2 * a * Math.sinh(S / (2 * a)) > Lr) lo = a; else hi = a; } return Math.sqrt(lo * hi); }

// ---------------------------------------------------------------- 1. static sag
console.log('1. static sag against the catenary');
for (const [S, slack] of [[2, 0.01], [2, 0.05], [3, 0.15]]) {
  const Lr = S * (1 + slack), R = span(S, Lr), env = still();
  for (let i = 0; i < 120 * 6; i++) R.advance(H, env);
  const mid = (R.n - 1) / 2, sag = 1 - R.x[3 * mid + 1], a = catA(S, Lr), sagC = a * (Math.cosh(S / (2 * a)) - 1);
  let len = 0; for (let k = 1; k < R.n; k++) { const i = 3 * k; len += Math.hypot(R.x[i] - R.x[i - 3], R.x[i + 1] - R.x[i - 2], R.x[i + 2] - R.x[i - 1]); }
  // (an inextensible rope: its segments held at their rest length by the constraint relaxation, js/ropesim.js ITERS)
  V.check({ section: 'sag', quantity: `length of the hanging span / its rest length, span ${S} m, ${(slack * 100).toFixed(0)}% slack`, expected: '1 (inextensible)', tol: '0.5%', source: 'the model\'s own constraint (ropesim.js: segments at their rest length)', show: `${(len / Lr).toFixed(4)}`, ok: Math.abs(len / Lr - 1) < 0.005 });
  V.check({ section: 'sag', quantity: `mid-span sag, span ${S} m, rope ${(slack * 100).toFixed(0)}% longer`, expected: `catenary a(cosh(S/2a) - 1) = ${(sagC * 1000).toFixed(1)} mm`, tol: '5%', source: 'the catenary (Bernoulli, Leibniz, Huygens 1691)', show: `${(sag * 1000).toFixed(1)} mm (${((sag / sagC - 1) * 100).toFixed(1)}%)`, ok: Math.abs(sag / sagC - 1) < 0.05 });
}

// ---------------------------------------------------------------- 2. transverse waves on the span
console.log('2. transverse wave speed on a tensioned span');
{
  const S = 2, Lr = S * 1.005, R = span(S, Lr), env = still();
  for (let i = 0; i < 120 * 6; i++) R.advance(H, env);
  const a = catA(S, Lr), c = Math.sqrt(G * a);               // H / mu = g a for a catenary of weight mu g per metre
  // pluck it sideways (out of the plane) in its first mode's shape, then time its swing
  for (let k = 1; k < R.n - 1; k++) { const i = 3 * k; R.x[i + 2] += 0.01 * Math.sin(Math.PI * k / (R.n - 1)); R.xp[i + 2] = R.x[i + 2]; }
  const mid = (R.n - 1) / 2, zs = [];
  for (let i = 0; i < 240; i++) { R.advance(H, env); zs.push(R.x[3 * mid + 2]); }
  const zc = []; for (let i = 1; i < zs.length; i++) if ((zs[i - 1] > 0) !== (zs[i] > 0)) zc.push((i - zs[i] / (zs[i] - zs[i - 1])) * H);
  const T = zc.length >= 3 ? 2 * (zc[zc.length - 1] - zc[0]) / (zc.length - 1) : NaN;
  const w1 = Math.PI * c / S, wd = Math.sqrt(Math.max(0, w1 * w1 - (DAMP / 2) ** 2)), Te = 2 * Math.PI / wd;
  V.check({ section: 'transverse wave', quantity: `first out-of-plane period, span ${S} m, 0.5% slack (H/mu = g a: c = ${c.toFixed(2)} m/s)`, expected: `2S/c, damped: ${Te.toFixed(3)} s`, tol: '10%', source: 'taut string c = sqrt(T/mu); Irvine 1981', show: `${T.toFixed(3)} s (${((T / Te - 1) * 100).toFixed(1)}%), ${zc.length} crossings`, ok: Math.abs(T / Te - 1) < 0.1 });
}

// ---------------------------------------------------------------- 3. hanging chain, 4. damping and energy
console.log('3. a hanging tail swinging; 4. damping, energy, the deck');
for (const L of [0.5, 1.0]) {
  const N = Math.round(L / 0.025) + 1, R = new RopeSim(N); R.pin[0] = 1; R.rest.fill(L / (N - 1));
  for (let k = 0; k < N; k++) R.set(k, 0, 2 - k * L / (N - 1), 0);
  const env = still();
  // the first mode's shape is J0(2.405 sqrt(1 - s/L)) ~ displaced more at the foot: a small swing of the whole
  for (let k = 1; k < N; k++) { const i = 3 * k, s = k / (N - 1); R.x[i] += 0.02 * s; }
  for (let i = 0; i < 20; i++) R.advance(H, env);          // (the constraints settle the lengths)
  const xs = [], E = [];
  // the mechanical energy per unit mass of the free points: kinetic + g y
  const mech = () => { let pe = 0; for (let k = 0; k < N; k++) if (!R.pin[k]) pe += G * R.x[3 * k + 1]; return R.energy() + pe; };
  for (let i = 0; i < 120 * 6; i++) { R.advance(H, env); xs.push(R.x[3 * (N - 1)]); E.push(mech()); }
  const zc = []; for (let i = 1; i < xs.length; i++) if ((xs[i - 1] > 0) !== (xs[i] > 0)) zc.push((i - xs[i] / (xs[i] - xs[i - 1])) * H);
  const T = zc.length >= 2 ? 2 * (zc[Math.min(zc.length - 1, 3)] - zc[0]) / Math.min(zc.length - 1, 3) : NaN;
  const w1 = 1.2024 * Math.sqrt(G / L), wd = Math.sqrt(Math.max(1e-9, w1 * w1 - (DAMP / 2) ** 2)), Te = 2 * Math.PI / wd;
  V.check({ section: 'hanging chain', quantity: `first-mode swing period of a ${L} m tail hanging free`, expected: `2 pi / sqrt(w1^2 - (DAMP/2)^2), w1 = 1.2024 sqrt(g/L): ${Te.toFixed(3)} s (undamped ${(2 * Math.PI / w1).toFixed(3)})`, tol: '8%', source: 'the hanging chain (D. Bernoulli 1732; Rayleigh, Theory of Sound s. 130)', show: Number.isFinite(T) ? `${T.toFixed(3)} s (${((T / Te - 1) * 100).toFixed(1)}%)` : 'no swing (over-damped)', ok: Number.isFinite(T) && Math.abs(T / Te - 1) < 0.08 });
  const zeta = DAMP / (2 * w1);
  V.check({ section: 'damping', quantity: `damping ratio of a ${L} m tail's swing in still air`, expected: '0.01-0.1 (a rope swinging in still air keeps swinging for many cycles: est.)', tol: '', source: 'est. (textile rope internal friction and air drag)', show: `${zeta.toFixed(2)} (DAMP ${DAMP}/s: amplitude ${Math.exp(-DAMP / 2 * 2 * Math.PI / wd).toFixed(2)} of itself after a cycle)`, status: zeta <= 0.1 ? 'pass' : zeta <= 0.5 ? 'warn' : 'fail' });
  let gain = 0; for (let i = 121; i < E.length; i++) gain = Math.max(gain, E[i] - E[i - 1]);   // (after the first second)
  const swing = E[120] - Math.min(...E);
  V.check({ section: 'energy', quantity: `no energy gain in a free swing (${L} m tail, pins fixed): the largest step-to-step rise of its mechanical energy`, expected: '<= 0', tol: '1% of the energy it swings with', source: 'passivity (a damped system with fixed supports gains no energy)', show: `${gain.toExponential(2)} J/kg against ${swing.toExponential(2)}`, ok: gain <= 0.01 * swing + 1e-9 });
}
{ // dropped onto a deck from a height: never below it
  const N = 41, R = new RopeSim(N); R.pin[0] = 1; R.rest.fill(0.05);
  for (let k = 0; k < N; k++) R.set(k, k * 0.05, 0.4, 0);
  const env = still(0); let low = Infinity;
  for (let i = 0; i < 120 * 3; i++) { R.advance(H, env); for (let k = 0; k < N; k++) low = Math.min(low, R.x[3 * k + 1]); }
  V.check({ section: 'contact', quantity: 'lowest point of a tail dropped 0.4 m onto a flat deck', expected: '>= 0 (the deck)', tol: '2 mm', source: 'impenetrability', show: `${(low * 1000).toFixed(1)} mm`, ok: low > -0.002 });
}

// ---------------------------------------------------------------- 5. stretch
console.log('5. elastic stretch');
{
  const seen = {};
  for (const id of Object.keys(CLASSES)) {
    const C = CLASSES[id]; if (C.speed) continue;
    for (const k of Object.keys(lineSpecs(C))) {
      const T = tackleOf(C, k); if (!T || !T.EA || seen[T.fibre]) continue;
      seen[T.fibre] = { E: T.EA / (Math.PI * T.d * T.d / 4), d: T.d, n: T.purchase, L: T.lengthInTackle, K: T.stretchK, cls: id, k };
    }
  }
  const band = { polyester: [1.2e3, 3.5e3], dyneema: [8e3, 6e4], ram: [1.5e5, 2.2e5] };
  for (const [f, s] of Object.entries(seen)) {
    const [lo, hi] = band[f] || [0, Infinity];
    // elongation at 20% of a typical break load (polyester braid ~ 50 N/mm^2 nominal at 20% MBL; Dyneema ~ 150)
    V.check({ section: 'stretch', quantity: `rope modulus EA / area, ${f} (${s.cls} ${s.k}, ${s.d} mm)`, expected: `${lo}-${hi} N/mm^2`, tol: '', source: f === 'ram' ? 'steel E = 200 GPa' : 'rope makers\' datasheets: elongation at 20% MBL ~2-3.5% (polyester), 0.3-1% (Dyneema) (est.)', show: `${s.E.toFixed(0)} N/mm^2`, ok: s.E >= lo && s.E <= hi });
    V.check({ section: 'stretch', quantity: `tackle stiffness, ${s.cls} ${s.k} (${s.n}:1, ${s.L.toFixed(1)} m of rope in it)`, expected: `n^2 EA / L = ${(s.n * s.n * s.E * Math.PI * s.d * s.d / 4 / s.L / 1000).toFixed(1)} kN/m`, tol: '1%', source: 'springs in a tackle: each of n parts carries T/n, the hauling end moves n x', show: `${(s.K / 1000).toFixed(1)} kN/m`, ok: Math.abs(s.K / (s.n * s.n * s.E * Math.PI * s.d * s.d / 4 / s.L) - 1) < 0.01 });
  }
}

// ---------------------------------------------------------------- 6. capstan
console.log('6. capstan friction');
{
  for (const w of [1, 2, 3]) V.check({ section: 'capstan', quantity: `holding ratio of ${w} turn(s) on a drum`, expected: `e^(mu 2 pi n), mu 0.1-0.15 for rope on an alloy drum: ${Math.exp(0.1 * 2 * Math.PI * w).toFixed(1)}-${Math.exp(0.15 * 2 * Math.PI * w).toFixed(1)}`, tol: '', source: 'Euler-Eytelwein capstan equation; mu est. (polyester braid on anodised alloy)', show: capstan(w).toFixed(2), ok: capstan(w) >= Math.exp(0.1 * 2 * Math.PI * w) * 0.999 && capstan(w) <= Math.exp(0.15 * 2 * Math.PI * w) * 1.001 });
  // a winch line's tail: the line's load / purchase / e^(mu theta)
  let done = 0;
  for (const id of ['j122', 'tp52', 'catalina30', 'swan131']) {
    const C = CLASSES[id], sp = lineSpecs(C);
    for (const k of ['jib', 'main']) {
      const H0 = HANDLERS[sp[k] && sp[k].handler]; if (!H0 || !H0.wraps || H0.hold) continue;
      const b = { cls: C, ctrl: { main: 0.2, jib: 0.2, lazy: 1, stay: 0.2, trav: 0.5, vang: 0.4, cunn: 0.2, outhaul: 0.4, backstay: 0.3, jibHalyard: 0.5, tackLine: 0.3 },
        diag: { rig: { mainLoad: 8000, jibLoad: 8000, stayLoad: 0, lazyLoad: 0, backstayLoad: 0 } }, lines: { main: 0.2, jib: 0.2, lazy: 1, stay: 0.2 }, genDeploy: 0 };
      initLines(b);
      const Tl = lineLoad(b, k), Tt = tailLoad(b, k), n = (sp[k].n || 1), want = Tl / n / capstan(H0.wraps);
      V.check({ section: 'capstan', quantity: `${id} ${k} sheet's tail load on its ${sp[k].handler} (${H0.wraps} turns)`, expected: `T / e^(mu theta) = ${want.toFixed(0)} N (line load ${Tl.toFixed(0)} N${n > 1 ? ' / ' + n + ':1' : ''})`, tol: '15% (block friction)', source: 'Euler-Eytelwein', show: `${Tt.toFixed(0)} N`, ok: Math.abs(Tt / want - 1) < 0.15 });
      if (++done >= 3) break;
    }
    if (done >= 3) break;
  }
}
V.save();
process.exit(V.failed ? 1 : 0);
