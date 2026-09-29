// Boats on the sea as it is drawn: node test/drawn-sea.mjs
// The water grid (render.js _buildWater) draws each wave only where it is longer than a few of its cells, which grow
// with the distance from the camera, and fades the sea out toward the horizon; a boat heaves and pitches on the whole
// sea (physics.js). Drawn as they were, the far boats bobbed on a glassy sea and lifted clear of troughs, and the
// traffic (traffic-render.js) sat at a fraction of the swell's trough by its length alone: "boats flying".
//  1. drawnSeaKeep is the shader's filter: the grid spacing at a vertex, long waves kept, short ones dropped, the fade
//  2. WaveField.ride: the drawn and the unseen parts add up to the whole; at a point it is the sea's linear part
//  3. a J/70 sailing in 18 kn and a swell, drawn at 20 / 100 / 300 / 900 m from the camera: her drawn hull (heave +
//     seaDh, render.js onDrawnSea) against the drawn sea under it, before and after
//  4. the traffic: a 150 m ship, a 12 m yacht and a 30 m ferry on the drawn sea (the old point-sample x length factor
//     against the hull's mean)
//  5. the drawn pose between two physics steps: a capsized boat's heel through pi goes the short way
import { Environment, KT, DEG, drawnSeaKeep } from '../js/env.js';
import { Boat, autoTrim, drawPose, wrap } from '../js/physics.js';
let fail = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const GRID = { N: 360, R: 6500, a: 0.035 };
const sst = (e0, e1, x) => { const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return u * u * (3 - 2 * u); };

console.log('1. the grid\'s filter');
{
  const st = {}, { N, R, a } = GRID;
  // at vertex i the shader's spc attribute is dmap(i / N * 2 - 1) (the larger of the two axes)
  let worst = 0;
  for (const i of [180, 190, 220, 260, 300, 340, 359]) {
    const u = i / N * 2 - 1, x = R * Math.sign(u) * (a * Math.abs(u) + (1 - a) * Math.abs(u) ** 3), want = R * (a + 3 * (1 - a) * u * u) * 2 / N;
    drawnSeaKeep(GRID, 0, 0, 0, 0, 1, x, 0, st);
    worst = Math.max(worst, Math.abs(st.spc / want - 1));
  }
  check(worst < 1e-6, `spacing at the vertices as the vertex attribute (worst ${(worst * 100).toExponential(1)} %)`);
  const keep = drawnSeaKeep(GRID, 0, 0, 0, 0, 1, 10, 0, st);
  check(keep(2 * Math.PI / 100) === 1 && keep(2 * Math.PI / 2) === 0, `near the camera a 100 m wave is drawn whole, a 2 m one not at all (spacing ${st.spc.toFixed(2)} m)`);
  drawnSeaKeep(GRID, 0, 0, 0, 0, 1, 300, 0, st);
  check(st.spc > 12 && st.keep(2 * Math.PI / 30) === 0 && st.keep(2 * Math.PI / 200) === 1, `300 m off: spacing ${st.spc.toFixed(1)} m, a 30 m wave gone, a 200 m swell kept`);
  drawnSeaKeep(GRID, 0, 0, 0, 0, 1, 3000, 0, st);
  check(Math.abs(st.fade - (1 - sst(760, 3450, 3000))) < 1e-9 && st.fade < 0.2, `3 km off the sea is faded to ${st.fade.toFixed(2)}`);
}

// an 18 kn sea over 20 km of fetch and a 1.5 m, 9 s swell
const env = new Environment({ tws: 18 * KT, twd: 0, weather: 'steady', seed: 7, fetchKm: 20, swellH: 1.5, swellT: 9 });
env.tick(0);
const W = env.waves;
console.log(`   (sea Hs ${W.Hs.toFixed(2)} m, ${W.comps.length} components, ${W.comps.map(c => (2 * Math.PI / (c.kRef ?? c.k)).toFixed(0)).join(' ')} m)`);
// the sea as the GPU draws it at (x, z): the full surface less the linear part of the waves the grid drops there
const o = {}, o2 = {};
const drawnAt = (x, z, t, keep) => W.sample(x, z, t, o).h - W.ride(x, z, t, 0, 0, 0, keep, o2, true).h;

console.log('2. WaveField.ride');
{
  const st = {}; let worst = 0, s2 = 0, d2 = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 13.7, z = i * -7.1, t = i * 0.37, keep = drawnSeaKeep(GRID, 0, 0, 0, 0, W.Hs, x % 600, z % 600, st), psi = i * 0.3;
    const all = W.ride(x, z, t, psi, 8, 3, null, {}), a = W.ride(x, z, t, psi, 8, 3, keep, {}), b = W.ride(x, z, t, psi, 8, 3, keep, {}, true);
    worst = Math.max(worst, Math.abs(a.h + b.h - all.h), Math.abs(a.al + b.al - all.al), Math.abs(a.at + b.at - all.at));
    const h = W.sample(x, z, t, o).h, l = W.ride(x, z, t, 0, 0, 0, null, {}).h; s2 += h * h; d2 += (h - l) ** 2; n++;
  }
  check(worst < 1e-3, `drawn + unseen = the whole (worst ${worst.toExponential(1)})`);
  check(Math.sqrt(d2 / n) < 0.15 * Math.sqrt(s2 / n), `at a point it is the sea's linear part: ${(Math.sqrt(d2 / n) * 100).toFixed(1)} cm rms off the surface's ${(Math.sqrt(s2 / n) * 100).toFixed(0)} cm (the trochoids and the second order)`);
}

console.log('3. a J/70 drawn at a distance: her hull against the drawn sea under it');
{
  const b = new Boat('sportboat', { sailModel: 'strip' }), C = b.cls, dt = 1 / 120;
  b.reset(0, 0, 60 * DEG); b.u = 3;
  const st = {}, P = {};
  const res = {};
  for (let t = 0; t < 60; t += dt) {
    autoTrim(b, dt, 0, true); b.ctrl.helm = Math.max(-1, Math.min(1, -2 * wrap(b.psi - 60 * DEG) - b.r));
    b.step(dt, env, t); env.tick(t);
    if (t < 10 || Math.round(t / dt) % 6) continue;
    for (const d of [20, 100, 300, 900]) {
      // the camera d metres off her beam, the grid laid about it
      const cx = b.x - d, cz = b.z, keep = drawnSeaKeep(GRID, Math.round(cx / 4) * 4, Math.round(cz / 4) * 4, cx, cz, W.Hs, b.x, b.z, st);
      const r = W.ride(b.x, b.z, t, b.psi, C.lwl, C.beam, keep, P, true), dh = -r.h;       // render.js onDrawnSea
      // the drawn sea's mean under the hull
      const fx = Math.sin(b.psi), fz = -Math.cos(b.psi); let sea = 0;
      for (let i = 0; i < 5; i++) { const s = C.sternX + (C.bowX - C.sternX) * i / 4, x = b.x + fx * s, z = b.z + fz * s; sea += drawnAt(x, z, t, drawnSeaKeep(GRID, Math.round(cx / 4) * 4, Math.round(cz / 4) * 4, cx, cz, W.Hs, x, z, {})) / 5; }
      const q = res[d] || (res[d] = { o1: 0, o2: 0, n1: 0, n2: 0, n: 0 });
      q.o1 += b.heave - sea; q.o2 += (b.heave - sea) ** 2; q.n1 += b.heave + dh - sea; q.n2 += (b.heave + dh - sea) ** 2; q.n++;
    }
  }
  // (the hull floats at her own draft and trim: the mean of heave - sea is that, a few cm, the same at any distance;
  // what moves about it is what shows. Near the camera the grid draws almost every wave: what is left there is the
  // boat's own motion on the sea, the floor for the rest)
  const sd = (q, a, b) => Math.sqrt(Math.max(0, q[b] / q.n - (q[a] / q.n) ** 2));
  const floor = sd(res[20], 'n1', 'n2');
  for (const d of [20, 100, 300, 900]) {
    const q = res[d], old = sd(q, 'o1', 'o2'), now = sd(q, 'n1', 'n2');
    console.log(`   ${String(d).padStart(4)} m: hull - drawn sea ${(old * 100).toFixed(1)} cm sd as she was drawn, ${(now * 100).toFixed(1)} cm now (mean ${(q.n1 / q.n * 100).toFixed(1)} cm)`);
    if (d >= 100) check(now < 0.5 * old && now < floor + 0.02, `${d} m off she moves with the water that is drawn (${(now * 100).toFixed(1)} cm sd, ${(floor * 100).toFixed(1)} near the camera; was ${(old * 100).toFixed(1)})`);
  }
}

console.log('4. the traffic on the drawn sea');
{
  const st = {}, P = {};
  for (const [name, L, B] of [['ship', 150, 24], ['ferry', 30, 8], ['yacht', 12, 3.8]]) {
    for (const d of [60, 600]) {
      let old = 0, now = 0, n = 0, oldMax = 0, nowMax = 0;
      for (let i = 0; i < 300; i++) {
        const t = 100 + i * 0.23, x = 500 + i * 1.3, z = -200 + i * 0.7, psi = 0.4, cx = x - d, cz = z;
        const kp = (xx, zz) => drawnSeaKeep(GRID, Math.round(cx / 4) * 4, Math.round(cz / 4) * 4, cx, cz, W.Hs, xx, zz, {});
        const fx = Math.sin(psi), fz = -Math.cos(psi); let sea = 0;
        for (let j = 0; j < 9; j++) { const s = (j / 8 - 0.5) * L * 0.9, xx = x + fx * s, zz = z + fz * s; sea += drawnAt(xx, zz, t, kp(xx, zz)) / 9; }
        const hOld = W.sample(x, z, t, o).h * (0.35 + 0.65 * Math.max(0.1, Math.min(1, 12 / L)));   // (the old pose, near the camera)
        const hNew = W.ride(x, z, t, psi, L, B, kp(x, z), P).h;
        old += (hOld - sea) ** 2; now += (hNew - sea) ** 2; n++; oldMax = Math.max(oldMax, Math.abs(hOld - sea)); nowMax = Math.max(nowMax, Math.abs(hNew - sea));
      }
      old = Math.sqrt(old / n); now = Math.sqrt(now / n);
      console.log(`   ${name} (${L} m) ${d} m off: vs the drawn sea's mean under her ${(old * 100).toFixed(1)} cm rms (worst ${(oldMax * 100).toFixed(0)}) before, ${(now * 100).toFixed(1)} cm (worst ${(nowMax * 100).toFixed(0)}) now`);
      check(now < 0.06 && nowMax < 0.2, `${name} ${d} m off rides the drawn sea`);
    }
  }
}

console.log('5. the drawn pose between two steps');
{
  const a = { x: 0, z: 0, psi: 3.1, heave: 0, pitch: 0, phi: 3.1 }, b = { x: 1, z: 0, psi: -3.1, heave: 0.1, pitch: 0, phi: -3.1 };
  const q = drawPose(a, b, 0.5);
  check(Math.abs(Math.abs(q.phi) - Math.PI) < 0.01 && Math.abs(Math.abs(q.psi) - Math.PI) < 0.01, `heel 3.1 -> -3.1 rad halfway: ${q.phi.toFixed(2)} (not upright), heading ${q.psi.toFixed(2)}`);
  check(Math.abs(q.x - 0.5) < 1e-12 && Math.abs(q.heave - 0.05) < 1e-12, 'position and heave halfway');
}

console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
