// Sailcloth membrane checks (js/sail/cloth.js).
//  1. tensile test: strain = T / k along the warp, the fill and on the bias (45 deg: 1/k45 = (1/kw + 1/kf + 1/kb) / 4),
//     at the game's time step (the static answer of the projective-dynamics solver is its fixed point)
//  2. pressurised strip: sag = p L^2 / (8 T)
//  3. a sheet hanging in no wind comes to rest and stays put
//  4. laminate under a sudden gust of pressure at the game's time step: stable, no NaN
import { Cloth } from '../js/sail/cloth.js';
import { MATERIALS } from '../js/sail/specs.js';
import { CLOTH_SUB } from '../js/sail/sailsim.js';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const noAcc = (i, x, v, o) => { o[0] = o[1] = o[2] = 0; };

// flat patch in the x-y plane, nu x nv nodes over W x H, warp at dirAngle from x
function patch(nu, nv, W, H, dirAngle, k, rho = 0.2, air = 1.0) {
  const c = new Cloth(nu, nv);
  const rest = new Float64Array(3 * nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = 3 * (j * nu + i); rest[q] = W * i / (nu - 1); rest[q + 1] = H * j / (nv - 1); }
  c.setRest(rest, (i, j, e) => { e[0] = Math.cos(dirAngle); e[1] = Math.sin(dirAngle); e[2] = 0; }, k, rho, () => air);
  c.x.set(rest); c.grav.fill(0);
  return c;
}
const hold = (c, i) => { c.setKinematic(i, true); c.pin(i, c.x[3 * i], c.x[3 * i + 1], c.x[3 * i + 2]); };

// 1. a 4 x 1 m strip (17 x 5 nodes) held at one end, pulled at the other with T N per metre of width; the free
//    end's nodes are free to contract across. Strain read in the middle half (an extensometer, clear of the grips).
function tensile(k, ang, T) {
  const nu = 17, nv = 5, W = 4, H = 1, c = patch(nu, nv, W, H, ang, k, k.rho);
  hold(c, 2 * nu);                                                 // one node fixed: no rigid drift
  // the gripped end is a roller: x held, y and z free (a node pinned to its own y each step)
  const grip = []; for (let j = 0; j < nv; j++) if (j !== 2) { hold(c, j * nu); grip.push(j * nu); }
  c.damp = 3;
  for (let it = 0; it < 1800; it++) {
    c.f.fill(0);
    for (let j = 0; j < nv; j++) c.f[3 * (j * nu + nu - 1)] = T * H / (nv - 1) * (j === 0 || j === nv - 1 ? 0.5 : 1);
    c.step(1 / 120, CLOTH_SUB, noAcc);
    if (!c.finite()) return NaN;
  }
  const j = 2, i1 = 4, i2 = 12;
  return (c.x[3 * (j * nu + i2)] - c.x[3 * (j * nu + i1)]) / (W * (i2 - i1) / (nu - 1)) - 1;
}
{
  const T = 400;                                                   // N per metre of width (a hard-sheeted leech)
  for (const mat of ['dacronCruise', 'laminate']) {
    const k = MATERIALS[mat];
    for (const [name, ang, kExp] of [['warp', 0, k.warp], ['fill', Math.PI / 2, k.fill], ['bias', Math.PI / 4, 4 / (1 / k.warp + 1 / k.fill + 1 / k.bias)]]) {
      const want = T / kExp, eps = tensile(k, ang, T);
      console.log(`     ${mat} ${name}: strain ${(eps * 1e3).toFixed(3)} per mil, T/k ${(want * 1e3).toFixed(3)} (${((eps / want - 1) * 100).toFixed(2)}%)`);
      check(Math.abs(eps / want - 1) < 0.02, `${mat} tensile ${name} strain = T/k within 2%`);
    }
  }
}
// 2. pressurised strip: chord L = 1 m between two held edges, pretensioned by holding it 0.4% stretched; a slice of a
//    long strip (every node kept in its own y plane)
{
  const k = MATERIALS.dacronCruise, nu = 21, nv = 5, L = 1, eps0 = 0.004;
  const c = patch(nu, nv, L, 0.4, 0, k, k.rho);
  for (let j = 0; j < nv; j++) { hold(c, j * nu); const r = j * nu + nu - 1; c.x[3 * r] = L * (1 + eps0); hold(c, r); }
  const y0 = Float64Array.from({ length: nu * nv }, (_, i) => c.x[3 * i + 1]);
  c.damp = 4;
  const p = 150;                                                   // Pa
  for (let it = 0; it < 2400; it++) {
    c.f.fill(0);
    for (let t = 0; t < c.T; t++) {
      const a = c.tri[3 * t], b = c.tri[3 * t + 1], d = c.tri[3 * t + 2], X = c.x;
      const ux = X[3 * b] - X[3 * a], uy = X[3 * b + 1] - X[3 * a + 1], uz = X[3 * b + 2] - X[3 * a + 2];
      const vx = X[3 * d] - X[3 * a], vy = X[3 * d + 1] - X[3 * a + 1], vz = X[3 * d + 2] - X[3 * a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // = 2 A n
      const s = Math.sign(nz) || 1;
      for (const i of [a, b, d]) { c.f[3 * i] += s * p * nx / 6; c.f[3 * i + 1] += s * p * ny / 6; c.f[3 * i + 2] += s * p * nz / 6; }
    }
    c.step(1 / 120, CLOTH_SUB, noAcc);
    for (let i = 0; i < nu * nv; i++) { c.x[3 * i + 1] = y0[i]; c.v[3 * i + 1] = 0; }
  }
  const j = 2; let sag = 0, arc = 0;
  for (let i = 0; i < nu; i++) sag = Math.max(sag, Math.abs(c.x[3 * (j * nu + i) + 2]));
  for (let i = 1; i < nu; i++) { const a = 3 * (j * nu + i - 1), b = a + 3; arc += Math.hypot(c.x[b] - c.x[a], c.x[b + 2] - c.x[a + 2]); }
  const Lc = L * (1 + eps0), T = k.warp * (arc / L - 1), want = p * Lc * Lc / (8 * T);
  console.log(`     pressurised strip: sag ${(sag * 1e3).toFixed(1)} mm, p L^2 / 8T ${(want * 1e3).toFixed(1)} mm (T ${T.toFixed(0)} N/m from the stretch)`);
  check(Math.abs(sag / want - 1) < 0.03, 'pressurised strip sag = pL^2/(8T) within 3%');
}
// 3. a 2 x 3 m sheet hanging from its top edge under gravity, pushed, comes to rest and does not drift
{
  const k = MATERIALS.dacronDinghy, nu = 7, nv = 9;
  const c = new Cloth(nu, nv);
  const rest = new Float64Array(3 * nu * nv);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const q = 3 * (j * nu + i); rest[q] = 2 * i / (nu - 1); rest[q + 2] = 3 * j / (nv - 1); }
  c.setRest(rest, (i, j, e) => { e[0] = 1; e[1] = 0; e[2] = 0; }, k, k.rho, () => 0.5);
  c.x.set(rest);
  for (let i = 0; i < nu; i++) hold(c, (nv - 1) * nu + i);
  for (let i = 0; i < nu * (nv - 1); i++) c.v[3 * i + 1] = 0.3;
  let vmax = 0; const snap = new Float64Array(c.x.length);
  for (let it = 0; it < 120 * 30; it++) {
    c.f.fill(0); c.step(1 / 120, CLOTH_SUB, noAcc);
    if (it === 120 * 25) snap.set(c.x);
    if (it > 120 * 25) for (let i = 0; i < c.v.length; i++) vmax = Math.max(vmax, Math.abs(c.v[i]));
  }
  let drift = 0; for (let i = 0; i < c.x.length; i++) drift = Math.max(drift, Math.abs(c.x[i] - snap[i]));
  console.log(`     hanging sheet: max speed over the last 5 s ${(vmax * 1e3).toFixed(2)} mm/s, drift ${(drift * 1e3).toFixed(2)} mm`);
  check(vmax < 5e-3 && drift < 5e-3 && c.finite(), 'a hanging sheet comes to rest and does not drift');
}
// 4. laminate panel (the stiffest cloth, no added air mass) held on two edges, hit by a sudden 300 Pa gust
{
  const k = MATERIALS.laminate, nu = 9, nv = 12;
  const c = patch(nu, nv, 2.5, 7, 0.3, k, k.rho, 0);
  for (let j = 0; j < nv; j++) hold(c, j * nu);
  for (let i = 1; i < nu; i++) hold(c, i);
  let bad = false, zmax = 0;
  for (let it = 0; it < 120 * 5; it++) {
    c.f.fill(0);
    const p = it > 60 ? 300 : 0;
    for (let n = 0; n < nu * nv; n++) c.f[3 * n + 2] = p * (2.5 * 7) / (nu * nv);
    c.step(1 / 120, CLOTH_SUB, noAcc);
    if (!c.finite()) { bad = true; break; }
    for (let n = 0; n < nu * nv; n++) zmax = Math.max(zmax, Math.abs(c.x[3 * n + 2]));
  }
  console.log(`     laminate under a 300 Pa gust: finite ${!bad}, max deflection ${zmax.toFixed(2)} m`);
  check(!bad, `laminate stable at ${CLOTH_SUB} substeps of 1/120 s under a gust`);
}
console.log(fails ? `${fails} FAILED` : 'all cloth checks passed');
process.exit(fails ? 1 : 0);
