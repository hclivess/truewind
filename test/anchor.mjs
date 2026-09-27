// Anchoring (js/anchor.js): the rode's catenary against the textbook solution, holding against dragging, swinging
// to the wind. node test/anchor.mjs   (exits non-zero on a failed check)
import { Boat, RHO_W } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { Anchor, rodeSolve, holding, ANCHOR, HOLD_K } from '../js/anchor.js';
const KT = 0.514444, DEG = Math.PI / 180, G = 9.81;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// ---------------------------------------------------------------- 1. catenary
console.log('1. All-chain catenary against the analytic solution (chain partly on the bottom)');
{
  const w = 0.8 * G * (1 - RHO_W / 7850), L = 30, h = 5;                  // 6 mm chain, 5 m from the bottom to the roller
  for (const H of [30, 150, 600, 2500]) {
    const a = H / w, s = Math.sqrt(h * h + 2 * h * a);
    if (s > L) continue;
    const X = (L - s) + a * Math.asinh(s / a);                             // horizontal reach for that tension
    const st = rodeSolve(X, h, L, w, 0, 1e12, {}, 5e6, 1e15);
    check(Math.abs(st.H - H) / H < 0.01 && Math.abs(st.T - Math.hypot(H, w * s)) / st.T < 0.01,
      `X ${X.toFixed(2)} m: H ${st.H.toFixed(1)} N (analytic ${H}), top tension ${st.T.toFixed(1)} N (analytic ${Math.hypot(H, w * s).toFixed(1)}), ${st.lay.toFixed(1)} m on the bottom`);
  }
  // pulled past the point where the chain lifts off the anchor: the shank angle appears and the tension climbs
  const a0 = rodeSolve(Math.sqrt(L * L - h * h) - 0.5, h, L, w, 0, 1e12, {}, 5e6, 1e15), a1 = rodeSolve(Math.sqrt(L * L - h * h) - 0.05, h, L, w, 0, 1e12, {}, 5e6, 1e15);
  check(a1.ang > 0 && a1.H > a0.H, `rode nearly straight: shank angle ${(a1.ang / DEG).toFixed(1)}°, H ${Math.round(a0.H)} -> ${Math.round(a1.H)} N`);
  // a chain + nylon rode: the rope's stretch absorbs a snub
  const c = ANCHOR.blackwatch;
  const wc = c.chain.w * G * (1 - RHO_W / 7850);
  // how hard a 0.2 m surge snubs, from a 1 kN lie: all chain (nearly straight by then) against chain and nylon
  const allChain = (X) => rodeSolve(X, 6, 40, wc, 0, 1e12, {}, 1e6).H, mixed = (X) => rodeSolve(X, 6, 10, wc, 30, c.rope.EA, {}, 1e6).H;
  const Xat = (f, H) => { let lo = 30, hi = 45; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < H) lo = m; else hi = m; } return (lo + hi) / 2; };
  const s1 = allChain(Xat(allChain, 1000) + 0.2), s2 = mixed(Xat(mixed, 1000) + 0.2);
  check(s2 < s1, `a 0.2 m surge from a 1 kN lie snubs to ${Math.round(s1)} N on 40 m of chain, ${Math.round(s2)} N on 10 m of chain and 30 m of nylon (EA ${c.rope.EA / 1000} kN)`);
}

// ---------------------------------------------------------------- 2. holding and dragging
console.log('\n2. Holding (k x anchor weight by the bottom) and dragging');
check(holding(ANCHOR.blackwatch, 'sand') > holding(ANCHOR.blackwatch, 'rock') * 5, `Delta 7 kg: sand ${Math.round(holding(ANCHOR.blackwatch, 'sand'))} N, mud ${Math.round(holding(ANCHOR.blackwatch, 'mud'))} N, rock ${Math.round(holding(ANCHOR.blackwatch, 'rock'))} N`);
check(HOLD_K.fluke.mud > HOLD_K.delta.mud, `a fluke anchor holds better in mud than a plough (${HOLD_K.fluke.mud}x vs ${HOLD_K.delta.mud}x its weight)`);
const world = (depth, bed) => ({ depthAt: () => depth, gradDepth: () => [0, 0], sdfAt: () => 500, bed });
function lieToAnchor(kn, bed, secs = 150, dirFn = null) {
  const dir0 = 0;
  const env = {
    wind: { sample: (x, z, t, o) => { o.speed = kn * KT; o.dir = dirFn ? dirFn(t) : dir0; o.puff = 0; return o; }, profile: (h) => Math.log(Math.max(h, 0.3) / 2e-4) / Math.log(10 / 2e-4) },
    current: { at: (x, z, o) => { o.x = 0; o.z = 0; return o; } }, wavesOn: false,
  };
  const b = new Boat('blackwatch', { sailModel: 'strip' }); b.reset(0, 0, 0); b.u = 0; b.furl = 1;
  const W = world(6, bed);
  const A = new Anchor(b); A.drop(W);
  const ctx = { world: W, env, t: 0, seabed: () => bed };
  const dt = 1 / 120; let t = 0, Hmax = 0, holdAtMax = 0, trace = [];
  for (let i = 0; i < secs / dt; i++) {
    const E = b.ext = b.ext || {}; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
    ctx.t = t; A.pre(dt, E, ctx);
    b.step(dt, env, t, W); t += dt;
    A.post(dt, ctx);
    if (!A.st.slack && A.st.H > Hmax) { Hmax = A.st.H; holdAtMax = A.hold; }
    if (i % 120 === 0) trace.push({ t, x: b.x - A.x, z: b.z - A.z, psi: b.psi, H: A.st.H });
  }
  return { A, b, Hmax, holdAtMax, trace };
}
for (const [kn, bed] of [[20, 'sand'], [45, 'sand'], [70, 'sand'], [25, 'rock']]) {
  const r = lieToAnchor(kn, bed);
  const dragged = r.A.dragged > 3 && r.A.setF >= 1 || (bed === 'rock' && r.A.dragged > 3);
  console.log(`     ${kn} kn, ${bed}: peak pull ${Math.round(r.Hmax)} N, holding ${Math.round(r.holdAtMax)} N, anchor moved ${r.A.dragged.toFixed(1)} m, ${r.A.paid.toFixed(0)} m of rode out`);
  if (kn === 20) check(!dragged, '  20 kn on sand: she lies to it');
  if (kn === 70) check(dragged && r.Hmax > r.holdAtMax * 0.95, '  70 kn on sand: the pull exceeds the holding and she drags');
  if (bed === 'rock') check(r.A.dragged > 1, '  on rock the anchor will not set: it skips along');
}

// ---------------------------------------------------------------- 3. swinging
console.log('\n3. Swinging to the wind');
{
  const r = lieToAnchor(15, 'sand', 480, (t) => (t < 150 ? 0 : 90 * DEG));
  const at = (T) => r.trace.reduce((a, p) => (Math.abs(p.t - T) < Math.abs(a.t - T) ? p : a));
  const brg = (p) => ((Math.atan2(p.x, -p.z) / DEG) + 360) % 360;     // bearing of the boat from the anchor
  const p1 = at(145), p2 = at(475);
  const hd = (p) => ((p.psi / DEG) % 360 + 360) % 360;
  check(Math.abs(brg(p1) - 180) < 25, `wind from 000°: she lies ${brg(p1).toFixed(0)}° from her anchor (downwind 180°), heading ${hd(p1).toFixed(0)}°`);
  check(Math.abs(brg(p2) - 270) < 30, `wind veers to 090°: she swings to ${brg(p2).toFixed(0)}° from the anchor (downwind 270°), heading ${hd(p2).toFixed(0)}°`);
}
console.log(`\n${fails ? fails + ' check(s) FAILED' : 'all anchor checks passed'}`);
process.exit(fails ? 1 : 0);
