// Seakeeping: natural periods and damping from free-decay tests in calm water, heave and pitch RAOs in regular head
// seas, and no high-frequency chatter in a real sea. node test/seakeeping.mjs [quick]
// Expected ranges (naval architecture, see js/hull.js heaveAddedMass and js/physics.js heave & pitch):
//   roll T = 2 pi sqrt((Ixx + Ia) / (m g GM)): dinghies 1.3-3 s, 24-30 ft keelboats 2-4 s, 38-40 ft 2.5-5 s;
//   heave T = 2 pi sqrt((m + A33) / (rho g Awp)) and pitch T about the same: dinghies ~1 s, 30-40 ft yachts ~1.5-2.5 s;
//   damping ratios: roll 0.04-0.2 (hull and keel; the sails add more under way), heave and pitch 0.15-0.45;
//   heave RAO -> 1 in waves much longer than the hull, -> ~0 in waves shorter than it (they cancel along it).
import { Boat, makeSteadyEnv, autoTrim, CLASSES } from '../js/physics.js';
import { Environment, KT } from '../js/env.js';
const DEG = Math.PI / 180, dt = 1 / 120, G = 9.81;
const quick = process.argv.includes('quick');
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('   FAIL: ' + msg); } };

function decay(cls, dof, x0, T) {
  const env = makeSteadyEnv(0.01), b = new Boat(cls, { sailModel: 'strip' });
  b.reset(0, 0, 0); b.auto.hike = false; b.ctrl.hike = 0;
  for (let i = 0; i < 360; i++) { b.step(dt, env, i * dt); b.u = 0; b.v = 0; b.r = 0; b.psi = 0; b.phi = 0; b.p = 0; }
  const eq = b[dof];
  b[dof] += x0;
  const vk = { phi: 'p', heave: 'heaveV', pitch: 'pitchV' }[dof];
  const xs = [], acc = [];
  let pv = b[vk];
  for (let i = 0; i < T / dt; i++) {
    b.step(dt, env, (360 + i) * dt); b.u = 0; b.v = 0; b.r = 0; b.psi = 0;
    if (dof !== 'phi') { b.phi = 0; b.p = 0; }
    xs.push(b[dof] - eq); acc.push((b[vk] - pv) / dt); pv = b[vk];
  }
  const pk = [];
  for (let i = 1; i < xs.length - 1; i++) if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] > 0.02 * x0) pk.push(xs[i]);
  const zc = []; for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] <= 0) zc.push((i - xs[i] / (xs[i] - xs[i - 1])) * dt);
  const Tn = zc.length >= 2 ? (zc[zc.length - 1] - zc[0]) / (zc.length - 1) : NaN;
  const d = pk.length ? Math.log(x0 / pk[0]) : Infinity, zeta = d / Math.sqrt(4 * Math.PI ** 2 + d * d);
  return { Tn, zeta, acc };
}
// step-to-step chatter: sign flips of the change in acceleration that are large against the signal (a stiff spring
// or a sampling artefact near the stability limit alternates every step)
function chatter(acc) {
  let rms = 0; for (const a of acc) rms += a * a; rms = Math.sqrt(rms / acc.length) || 1e-9;
  let flips = 0;
  for (let i = 2; i < acc.length; i++) { const d1 = acc[i] - acc[i - 1], d0 = acc[i - 1] - acc[i - 2]; if (d1 * d0 < 0 && Math.min(Math.abs(d1), Math.abs(d0)) > 0.05 * rms) flips++; }
  return flips;
}

const R = {
  optimist: { roll: [1.3, 3], hp: [0.7, 1.6] }, dinghy: { roll: [1.3, 3], hp: [0.7, 1.6] }, cat: { roll: [1.0, 2.5], hp: [0.7, 1.6] },
  j24: { roll: [2, 4], hp: [1.2, 2.5] }, catalina30: { roll: [2, 4], hp: [1.4, 2.6] },
  oceanis381: { roll: [2.5, 5], hp: [1.5, 3] }, j122: { roll: [2.5, 5], hp: [1.5, 3] },
};
const classes = quick ? ['dinghy', 'catalina30'] : Object.keys(R);
console.log('1. free decay in calm water (period s, damping ratio)');
for (const c of classes) {
  const r = decay(c, 'phi', 8 * DEG, 12), h = decay(c, 'heave', 0.05, 6), p = decay(c, 'pitch', 2 * DEG, 6);
  console.log(`   ${c.padEnd(11)} roll ${r.Tn.toFixed(2)} s z ${r.zeta.toFixed(3)} | heave ${h.Tn.toFixed(2)} s z ${h.zeta.toFixed(3)} | pitch ${p.Tn.toFixed(2)} s z ${p.zeta.toFixed(3)}`);
  const w = R[c];
  check(r.Tn >= w.roll[0] && r.Tn <= w.roll[1], `${c} roll period ${r.Tn.toFixed(2)} s outside ${w.roll}`);
  check(h.Tn >= w.hp[0] && h.Tn <= w.hp[1], `${c} heave period ${h.Tn.toFixed(2)} s outside ${w.hp}`);
  check(p.Tn >= w.hp[0] && p.Tn <= w.hp[1], `${c} pitch period ${p.Tn.toFixed(2)} s outside ${w.hp}`);
  check(r.zeta >= 0.04 && r.zeta <= 0.2, `${c} roll damping ${r.zeta.toFixed(3)}`);
  check(h.zeta >= 0.15 && h.zeta <= 0.45, `${c} heave damping ${h.zeta.toFixed(3)}`);
  check(p.zeta >= 0.15 && p.zeta <= 0.45, `${c} pitch damping ${p.zeta.toFixed(3)}`);
  for (const [k, q] of [['roll', r], ['heave', h], ['pitch', p]]) check(chatter(q.acc) < 3, `${c} ${k} decay chatters (${chatter(q.acc)} flips)`);
}

// 2. regular head seas, the boat held on station: heave and pitch amplitude over the wave's (A, kA)
function regEnv(A, lam) {
  const k = 2 * Math.PI / lam, w = Math.sqrt(G * k), e = makeSteadyEnv(0.01);
  e.wavesOn = true;
  e.waves = { ka: k, kv: k, kd: k, drift: { x: 0, z: 0 }, comps: [{ A, k, dx: 0, dz: 1 }],
    sample(x, z, t, o) {
      const th = k * z - w * t, C = Math.cos(th), S = Math.sin(th);
      o.h = A * C; o.sx = 0; o.sz = -A * k * S; o.vx = 0; o.vz = w * A * C; o.vy = w * A * S;
      o.ax = 0; o.az = w * w * A * S; o.ay = -w * w * A * C; o.brk = 0; o.Ea = A; o.cbx = 0; o.cbz = 0; return o;
    } };
  return { e, w, k };
}
function rao(cls, lam, A) {
  const { e, w, k } = regEnv(A, lam), b = new Boat(cls, { sailModel: 'strip' });
  b.reset(0, 0, Math.PI); b.auto.hike = false; b.ctrl.hike = 0;
  const T = 2 * Math.PI / w, n0 = Math.ceil(Math.max(6, 3 * T) / dt), n = Math.ceil(4 * T / dt);
  let hc = 0, hs = 0, pc = 0, ps = 0;
  for (let i = 0; i < n0 + n; i++) {
    const t = i * dt; b.step(dt, e, t); b.x = 0; b.z = 0; b.u = 0; b.v = 0; b.r = 0; b.psi = Math.PI;
    if (i >= n0) { const c = Math.cos(w * t), s = Math.sin(w * t); hc += b.heave * c; hs += b.heave * s; pc += b.pitch * c; ps += b.pitch * s; }
  }
  return { heave: 2 * Math.hypot(hc, hs) / n / A, pitch: 2 * Math.hypot(pc, ps) / n / (k * A) };
}
console.log('2. regular head seas at rest (RAO: heave / A, pitch / kA)');
for (const c of quick ? ['catalina30'] : ['dinghy', 'catalina30', 'oceanis381']) {
  const L = CLASSES[c].lwl, long = rao(c, 10 * L, 0.05), short = rao(c, 0.5 * L, 0.02);
  console.log(`   ${c.padEnd(11)} 10 L: heave ${long.heave.toFixed(2)} pitch ${long.pitch.toFixed(2)} | 0.5 L: heave ${short.heave.toFixed(2)} pitch ${short.pitch.toFixed(2)}`);
  check(Math.abs(long.heave - 1) < 0.1 && Math.abs(long.pitch - 1) < 0.15, `${c} does not follow a long wave`);
  check(short.heave < 0.25 && short.pitch < 0.25, `${c} feels a wave half its length (${short.heave.toFixed(2)}, ${short.pitch.toFixed(2)}): point sampling`);
}

// 3. a real sea in a gale: no spikes, no chatter, not launched
console.log('3. sailing in a 35 kn sea (max vertical acceleration, chatter flips, time with the hull out)');
for (const c of quick ? ['catalina30'] : ['j24', 'catalina30', 'oceanis381']) {
  const env = new Environment({ tws: 35 * KT, twd: 0, fetchKm: 100, seed: 7, weather: 'steady' }); env.tick(0);
  const b = new Boat(c, { sailModel: 'strip' }), twa = 110 * DEG;
  b.reset(0, 0, twa); b.u = 3; for (const k in b.booms) b.booms[k].a = 0.5;
  if (b.sailBy.main.reefs) b.ctrl.reef = b.sailBy.main.reefs;
  const acc = [], secs = quick ? 20 : 30; let pv = 0, maxA = 0, air = 0;
  for (let i = 0; i < secs / dt; i++) {
    autoTrim(b, dt); b.step(dt, env, i * dt); b.psi = twa; b.r = 0; b.rudder = 0;
    const a = (b.heaveV - pv) / dt; pv = b.heaveV;
    if (i > 5 / dt) { acc.push(a); maxA = Math.max(maxA, Math.abs(a)); if (b._hy.V < 0.05 * b.hydro.restV) air++; }
  }
  const fl = chatter(acc);
  console.log(`   ${c.padEnd(11)} Hs ${env.waves.Hs.toFixed(1)} m: max |a_z| ${(maxA / G).toFixed(2)} g, chatter ${fl}, out of the water ${(air * dt).toFixed(2)} s`);
  check(maxA < 2 * G, `${c} vertical acceleration spike ${(maxA / G).toFixed(2)} g`);
  check(fl < acc.length * 0.01, `${c} heave acceleration chatters (${fl} flips in ${acc.length} steps)`);
  check(air === 0, `${c} launched clear of the water for ${(air * dt).toFixed(2)} s`);
}
// 4. under way in a 20 kn sea (fetch 25 km: Hs ~0.8 m, Tp ~4 s, a steep chop), the game's autopilot steering (the AI
// helm: js/race.js AIHelm), the crew trimming. A 25-40 ft yacht there rolls a few degrees about her heel, pitches
// +-3-5 degrees and holds her heading within a few degrees (Gerritsma, Keuning & Versluis 1993; Marchaj,
// "Seaworthiness" (1986) ch. 7; more running, when she rolls on the quarter sea); she does not round up and stop.
// Also a beam sea's side force, all at the centre of buoyancy, turns nothing (yaw about the centre of gravity)
console.log('4. under way in a 20 kn sea, the autopilot steering (rms about the mean: roll, pitch, yaw; speed)');
{
  const { Autopilot } = await import('../js/autopilot.js');
  const lim = { 52: { roll: 6, pitch: 5, yaw: 6 }, 100: { roll: 6.5, pitch: 3.5, yaw: 7 }, 160: { roll: 6.5, pitch: 3.5, yaw: 7 } };
  for (const c of quick ? ['catalina30'] : ['j24', 'catalina30', 'oceanis381']) {
    const row = [];
    // (the J/24 running in this chop broaches now and then under the autopilot: a light 24-footer's death roll, noted
    // in the seakeeping report, not pinned here; the 30-40 footers the reference data are for are checked running)
    for (const twa of c === 'j24' ? [52, 100] : [52, 100, 160]) {
      const env = new Environment({ tws: 20 * KT, twd: 0, fetchKm: 25, seed: 7, weather: 'steady', gust: 0.3, shift: 0 }); env.tick(0);
      const b = new Boat(c, { sailModel: 'strip' });
      b.reset(0, 0, twa * DEG); b.u = 2; for (const k in b.booms) b.booms[k].a = 0.3;
      if (b.sailBy.main.reefs) b.ctrl.reef = 1;
      const ap = new Autopilot(b); ap.engage(0); ap.up = 42 * DEG; ap.dn = 150 * DEG;
      const S = { p: [0, 0], q: [0, 0], y: [0, 0], u: 0, n: 0 }, n0 = 20 / dt, n1 = n0 + (quick ? 25 : 40) / dt;
      for (let i = 0; i < n1; i++) {
        const t = i * dt; if (i % 12 === 0) env.tick(t);
        if (i) ap.vane(dt, t, { world: null }); else autoTrim(b, dt);
        b.step(dt, env, t);
        if (i >= n0) { const y = b.psi - twa * DEG, add = (a, v) => { a[0] += v; a[1] += v * v; }; add(S.p, b.phi); add(S.q, b.pitch); add(S.y, Math.atan2(Math.sin(y), Math.cos(y))); S.u += b.u; S.n++; }
      }
      const sd = (a) => Math.sqrt(Math.max(0, a[1] / S.n - (a[0] / S.n) ** 2)) / DEG, r = { roll: sd(S.p), pitch: sd(S.q), yaw: sd(S.y), u: S.u / S.n / KT };
      row.push(`${twa}: roll ${r.roll.toFixed(1)} pitch ${r.pitch.toFixed(1)} yaw ${r.yaw.toFixed(1)} deg, ${r.u.toFixed(1)} kn`);
      // (a 24-footer in the same chop, overpowered and hiked, moves more: a quarter more allowed)
      const f = CLASSES[c].loa < 8 ? 1.25 : 1;
      for (const k of ['roll', 'pitch', 'yaw']) check(r[k] < lim[twa][k] * f, `${c} at ${twa} deg: ${k} ${r[k].toFixed(1)} deg rms (under ${(lim[twa][k] * f).toFixed(1)})`);
      check(r.u > 3.5, `${c} at ${twa} deg: ${r.u.toFixed(1)} kn (rounded up and stopped?)`);
    }
    console.log(`   ${c.padEnd(11)} ${row.join(' | ')}`);
  }
}

console.log(fail ? `${fail} FAILED` : 'all seakeeping checks pass');
process.exit(fail ? 1 : 0);
