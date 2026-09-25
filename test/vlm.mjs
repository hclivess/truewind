// Vortex-lattice checks against classical results (js/sail/vlm.js).
//  1. elliptic flat plate AR 6: lift slope vs lifting line 2pi/(1+2/AR) and vs Jones' lifting-surface value
//     2pi/(E+2/AR) (E = semi-perimeter / span), span efficiency from the Kutta-Joukowski forces
//  2. rectangular AR 20: lift slope vs Helmbold / lifting line
//  3. the water plane as a mirror: a wing standing on it lifts like a free wing of twice the span
//  4. parabolic camber h/c = 0.1: zero-lift angle -2h/c (lattice and the strip's own thin-airfoil integral)
//  5. two sails in one flow: sheeting the headsail in lowers the main's lift (the slot / backwind effect)
import { SailLattice } from '../js/sail/vlm.js';
const DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// a wing in the x-y plane: chord along +x (u), span along +y (v); planform chord(eta), eta 0..1 over the span
function wing(L, part, span, chordAt, camber = null, y0 = 0, x0 = 0, cosSpan = true) {
  const q = L.parts[part], { nc, ns } = q, W = nc + 1;
  for (let j = 0; j <= ns; j++) {
    const eta = cosSpan ? 0.5 * (1 - Math.cos(Math.PI * j / ns)) : j / ns;
    const c = chordAt(eta), y = y0 + eta * span;
    for (let i = 0; i <= nc; i++) {
      const u = i / nc;                                              // uniform chordwise: the 1/4-3/4 rule is exact in 2-D
      const k = 3 * (j * W + i);
      q.surf[k] = x0 - 0.25 * c + u * c + 0.25 * chordAt(0); q.surf[k + 1] = y; q.surf[k + 2] = camber ? camber(u) * c : 0;
    }
  }
}
// solve at angle a (freestream (cos a, 0, sin a)); returns CL, CDi (forces from the lattice), per-strip data
function run(L, a, V = 1, Sref) {
  L.updateGeometry();
  const vx = V * Math.cos(a), vz = V * Math.sin(a);
  for (const q of L.parts) for (let j = 0; j <= q.ns; j++) { q.wake[3 * j] = Math.cos(a); q.wake[3 * j + 1] = 0; q.wake[3 * j + 2] = Math.sin(a); }
  L.rebuild();
  for (let k = 0; k < L.N; k++) L.rhs[k] = -(vx * L.nrm[3 * k] + vz * L.nrm[3 * k + 2]);
  L.solveBase(); L.delta.fill(0);
  const g = L.compose(), vi = L.induced(g);
  let Fx = 0, Fz = 0;
  for (let k = 0; k < L.N; k++) {
    const p = L.prevP[k], dG = g[k] - (p >= 0 ? g[p] : 0);
    const ux = vx + vi[3 * k], uy = vi[3 * k + 1], uz = vz + vi[3 * k + 2];
    const lx = L.bl[3 * k], ly = L.bl[3 * k + 1], lz = L.bl[3 * k + 2];
    Fx += (uy * lz - uz * ly) * dG; Fz += (ux * ly - uy * lx) * dG;   // rho = 1
  }
  const q = 0.5 * V * V;
  const lift = Fz * Math.cos(a) - Fx * Math.sin(a), drag = Fx * Math.cos(a) + Fz * Math.sin(a);
  return { CL: lift / (q * Sref), CD: drag / (q * Sref), g };
}

// 1. elliptic AR 6 (refined lattice; and at the game's resolution, 6 x 10)
{
  const b = 6, c0 = 4 / Math.PI, AR = 6;                 // area = pi b c0 / 4 = 6
  const res = [];
  for (const [nc, ns, cos] of [[8, 80, false], [6, 10, false]]) {
    const L = new SailLattice([{ nc, ns }]);
    wing(L, 0, b, (e) => c0 * Math.sqrt(Math.max(0, 1 - (2 * e - 1) ** 2)) + 1e-4, null, -b / 2, 0, cos);
    L.updateGeometry(); let S = 0; for (let k = 0; k < L.N; k++) S += L.area[k];
    const r1 = run(L, 1 * DEG, 1, S), r5 = run(L, 5 * DEG, 1, S);
    // Trefftz-plane induced drag of the same loading (2-D point vortices at the trailing lines)
    const q = L.parts[0], ys = [], G = [];
    for (let j = 0; j <= ns; j++) ys.push(q.surf[3 * j * (nc + 1) + 1]);
    for (let j = 0; j < ns; j++) G.push(r5.g[L.te[j]]);
    let D = 0;
    for (let m = 0; m < ns; m++) {
      const ym = 0.5 * (ys[m] + ys[m + 1]); let w = 0;
      for (let j = 0; j <= ns; j++) w += ((j > 0 ? G[j - 1] : 0) - (j < ns ? G[j] : 0)) / (2 * Math.PI * (ym - ys[j]));
      D += 0.5 * G[m] * w * (ys[m + 1] - ys[m]);
    }
    const eT = r5.CL ** 2 / (Math.PI * (b * b / S) * Math.abs(D) / (0.5 * S));
    res.push({ nc, ns, cla: (r5.CL - r1.CL) / (4 * DEG), e: r5.CL ** 2 / (Math.PI * (b * b / S) * r5.CD), eT });
  }
  const ll = 2 * Math.PI / (1 + 2 / AR), helm = 2 * Math.PI * AR / (2 + Math.sqrt(AR * AR + 4));
  const [f, g] = res;
  console.log(`     elliptic AR 6 (8x80): CLa ${f.cla.toFixed(3)} /rad; Helmbold lifting surface ${helm.toFixed(3)} (${((f.cla / helm - 1) * 100).toFixed(1)}%), lifting line ${ll.toFixed(3)} (${((f.cla / ll - 1) * 100).toFixed(1)}%); e ${f.eT.toFixed(3)} (Trefftz plane), ${f.e.toFixed(3)} (forces on the bound vortices)`);
  console.log(`     elliptic AR 6 at game resolution (6x10): CLa ${g.cla.toFixed(3)}, e ${g.e.toFixed(3)} (induced drag ${((1 / g.e - 1) * 100).toFixed(0)}% vs the converged lattice)`);
  check(Math.abs(f.cla / helm - 1) < 0.03, 'elliptic AR 6 lift slope within 3% of the lifting-surface value (Helmbold)');
  check(Math.abs(f.eT - 1) < 0.03 && Math.abs(f.e - 1) < 0.05, `elliptic AR 6 span efficiency ${f.eT.toFixed(3)} (1 for an elliptic load)`);
  check(g.e > 0.97 && g.e < 1.12, 'game resolution: span efficiency within 12%');
}
// 2. rectangular AR 20 vs Prandtl's lifting line, solved by Glauert's series (60 odd terms)
function liftingLineRect(AR) {
  const M = 60, th = [], A = [];
  for (let m = 0; m < M; m++) th.push(Math.PI * (m + 0.5) / (2 * M));   // half span (symmetric: odd terms)
  const mu = 2 * Math.PI / (4 * AR);                                     // a0 c / (4 b), c = b / AR
  const K = [], rhs = [];
  for (let m = 0; m < M; m++) { const row = []; for (let n = 0; n < M; n++) { const k = 2 * n + 1; row.push(Math.sin(k * th[m]) * (mu * k + Math.sin(th[m]))); } K.push(row); rhs.push(mu * Math.sin(th[m])); }
  for (let c = 0; c < M; c++) { let p = c; for (let r = c + 1; r < M; r++) if (Math.abs(K[r][c]) > Math.abs(K[p][c])) p = r; [K[c], K[p]] = [K[p], K[c]]; [rhs[c], rhs[p]] = [rhs[p], rhs[c]];
    for (let r = c + 1; r < M; r++) { const f = K[r][c] / K[c][c]; for (let q = c; q < M; q++) K[r][q] -= f * K[c][q]; rhs[r] -= f * rhs[c]; } }
  const x = new Array(M).fill(0); for (let r = M - 1; r >= 0; r--) { let s = rhs[r]; for (let q = r + 1; q < M; q++) s -= K[r][q] * x[q]; x[r] = s / K[r][r]; }
  return Math.PI * AR * x[0];                                            // CL per radian (alpha = 1)
}
{
  const L = new SailLattice([{ nc: 6, ns: 60 }]);
  wing(L, 0, 20, () => 1, null, -10);
  const r1 = run(L, 1 * DEG, 1, 20), r4 = run(L, 4 * DEG, 1, 20);
  const cla = (r4.CL - r1.CL) / (3 * DEG), AR = 20, ll = liftingLineRect(AR);
  console.log(`     rectangular AR 20: CLa ${cla.toFixed(3)}, lifting line ${ll.toFixed(3)} (${((cla / ll - 1) * 100).toFixed(1)}%)`);
  check(Math.abs(cla / ll - 1) < 0.02, 'rectangular AR 20 lift slope within 2% of lifting line');
}
// 3. image plane: a wing of span b standing on the water vs a free wing of span 2b
{
  const b = 3, S = 3;
  const L1 = new SailLattice([{ nc: 6, ns: 20 }]);
  wing(L1, 0, b, () => 1, null, 0, 0, false);
  L1.image = { on: true, nx: 0, ny: 1, nz: 0, h0: 0 };            // plane y = 0
  const a = run(L1, 4 * DEG, 1, S);
  const L2 = new SailLattice([{ nc: 6, ns: 40 }]);
  wing(L2, 0, 2 * b, () => 1, null, -b, 0, false);
  const f = run(L2, 4 * DEG, 1, 2 * S);
  const Lfree = new SailLattice([{ nc: 6, ns: 20 }]);
  wing(Lfree, 0, b, () => 1, null, 0, 0, false);
  const h = run(Lfree, 4 * DEG, 1, S);
  console.log(`     half wing on the mirror CL ${a.CL.toFixed(4)}, full wing (twice the span) ${f.CL.toFixed(4)}, half wing in free air ${h.CL.toFixed(4)}`);
  check(Math.abs(a.CL / f.CL - 1) < 0.005, 'the water plane doubles the effective aspect ratio');
}
// 4. parabolic camber h/c = 0.1 on a high aspect ratio wing: zero-lift angle -2h/c
{
  const L = new SailLattice([{ nc: 12, ns: 30 }]);
  wing(L, 0, 40, () => 1, (u) => 0.4 * u * (1 - u), -20);
  const r0 = run(L, 0, 1, 40), r4 = run(L, 4 * DEG, 1, 40);
  const a0 = -r0.CL / ((r4.CL - r0.CL) / (4 * DEG));
  const mid = L.sa0[15];
  console.log(`     camber 10%: zero-lift angle ${(a0 / DEG).toFixed(2)} deg (lattice), ${(mid / DEG).toFixed(2)} deg (strip integral), theory ${(-0.2 / DEG).toFixed(2)} deg; depth ${L.sd[15].toFixed(3)} at ${L.sf[15].toFixed(2)}`);
  check(Math.abs(a0 / -0.2 - 1) < 0.03, 'zero-lift angle of a 10% parabolic camber = -2h/c (lattice)');
  check(Math.abs(mid / -0.2 - 1) < 0.03, 'zero-lift angle of a 10% parabolic camber = -2h/c (strip integral)');
}
// 5. tandem: a headsail ahead and to windward of the main's luff; sheeting the headsail in raises its lift and
//    lowers the main's (downwash on the main)
{
  const res = [];
  for (const jibA of [0, 4, 8, 12]) {
    const L = new SailLattice([{ nc: 6, ns: 10 }, { nc: 5, ns: 8 }]);
    wing(L, 0, 6, () => 2.5, (u) => 0.4 * u * (1 - u) * 0.12 / 0.1, 0, 0, false);     // main: 12% camber
    // jib: chord 2, overlapping, its leech 0.3 m to windward (-z) of the main's luff
    const q = L.parts[1], W = q.nc + 1, ca = Math.cos(jibA * DEG), sa = Math.sin(jibA * DEG);
    for (let j = 0; j <= q.ns; j++) for (let i = 0; i <= q.nc; i++) {
      const u = 0.5 * (1 - Math.cos(Math.PI * i / q.nc)), c = 2, cz = 0.48 * u * (1 - u) * c;
      const x = -1.6 + u * c, z = -0.35 + cz;
      const k = 3 * (j * W + i);                                   // rotate about the jib's leech, nose up by jibA
      const dx = x - 0.4, dz = z + 0.35;
      q.surf[k] = 0.4 + dx * ca + dz * sa; q.surf[k + 1] = j / q.ns * 5.5; q.surf[k + 2] = -0.35 - dx * sa + dz * ca;
    }
    const r = run(L, 6 * DEG, 1, 1);
    const gm = L.g[L.te[4]], gj = L.g[L.te[10 + 3]];
    res.push([jibA, gm, gj]);
  }
  console.log('     headsail angle / main mid-strip circulation / headsail mid-strip circulation: ' + res.map(r => `${r[0]}deg ${r[1].toFixed(3)} ${r[2].toFixed(3)}`).join(' | '));
  check(res.every((r, i) => i === 0 || (r[1] < res[i - 1][1] && r[2] > res[i - 1][2])), 'sheeting the headsail in raises its load and lowers the main\'s');
}
console.log(fails ? `${fails} FAILED` : 'all vortex-lattice checks passed');
process.exit(fails ? 1 : 0);
