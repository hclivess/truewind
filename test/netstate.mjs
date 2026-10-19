// Online state (js/net.js, js/damage.js netState/applyNet): what one browser sends of its boat and how another
// rebuilds it.
//  1. the 10 Hz state packet survives JSON (what WebRTC carries) with its quantisation: position to 1 cm, angles
//     to 1 mrad, the controls to 0.001
//  2. the remote copy (re-simulated from the controls, pulled to the dead-reckoned state) follows the owner's boat
//     sailing a course with tacks: position error rms and worst, heading error
//  3. the damage summary round-trips: a dismasting, a torn sail, water aboard; and the water pumped out again
//     reaches the remote copy too
// node test/netstate.mjs
import { suite } from './lib/check.mjs';
import { Net } from '../js/net.js';
import { Boat, autoTrim, makeSteadyEnv, wrap } from '../js/physics.js';
import { Damage, recomputeMass } from '../js/damage.js';
import '../js/sail/sailsim.js';
const KT = 0.514444, DEG = Math.PI / 180;
const S = suite('netstate');
globalThis.window = globalThis.window || { addEventListener() {} };

const env = makeSteadyEnv(12 * KT);
let simT = 0;
const game = (env) => {
  const g = { t: 0, env, sailModel: 'strip', fleetSailLevel: () => 2, remote: [], hud: { toast() {} }, sharedRace: null,
    addRemoteBoat(b) { g.remote.push(b); }, removeRemoteBoat(b) { g.remote = g.remote.filter((x) => x !== b); }, onNetRace() {}, onNetPenalty() {} };
  return g;
};
// the clock the receiver's dead reckoning reads: the sim's own (performance.now in the browser)
const realNow = performance.now.bind(performance);
performance.now = () => simT * 1000;

const gA = game(env), gB = game(env);
const A = new Net(gA), B = new Net(gB);
A.connected = true; A.name = 'Alice';
let wire = [];
A.aState = { send: (d) => wire.push(JSON.stringify(d)) };
const me = new Boat('sportboat', { sailModel: 'strip', id: 0 }); me.reset(0, 0, -45 * DEG); me.u = 2.5;
me.dmg = new Damage(me);

// ---------------------------------------------------------------- 1 and 2: sail 120 s with two tacks
const dt = 1 / 120; let sq = 0, n = 0, worst = 0, worstH = 0, first = null;
let hdg = -45 * DEG;
for (let i = 0; i < 120 * 120; i++) {
  const t = i * dt; simT = t; gA.t = t; gB.t = t;
  if (i === 120 * 40) hdg = 45 * DEG;
  if (i === 120 * 80) hdg = -45 * DEG;
  autoTrim(me, dt); me.ctrl.helm = Math.max(-1, Math.min(1, -2 * wrap(me.psi - hdg) - 1.5 * me.r));
  me.step(dt, env, t);
  A.update(dt, me, null);
  for (const m of wire.splice(0)) { const d = JSON.parse(m); if (!first) first = { d, me: { x: me.x, z: me.z, psi: me.psi, u: me.u, ctrl: { ...me.ctrl } } }; B.onState(d, 'peerA'); }
  B.preStep();
  for (const b of gB.remote) b.step(dt, env, t);
  B.postStep(dt);
  const rb = gB.remote[0];
  if (rb && t > 2) { const e = Math.hypot(rb.x - me.x, rb.z - me.z); sq += e * e; n++; worst = Math.max(worst, e); worstH = Math.max(worstH, Math.abs(wrap(rb.psi - me.psi))); }
}
{
  const { d, me: m } = first;
  S.near({ quantity: 'packet x after JSON', measured: d.x - m.x, expected: 0, tol: 0.005, unit: 'm', source: 'quantised to 1 cm (net.js q)' });
  S.near({ quantity: 'packet heading after JSON', measured: d.psi - m.psi, expected: 0, tol: 0.0005, unit: 'rad', source: 'quantised to 1 mrad' });
  S.near({ quantity: 'packet boat speed after JSON', measured: d.u - m.u, expected: 0, tol: 0.005, unit: 'm/s', source: 'quantised to 1 cm/s' });
  S.ok(Math.abs(d.ctrl.main - m.ctrl.main) <= 5e-4 && Math.abs(d.ctrl.helm - m.ctrl.helm) <= 5e-4, 'controls survive the packet to 0.001', { measured: `main ${d.ctrl.main} vs ${m.ctrl.main.toFixed(4)}, helm ${d.ctrl.helm} vs ${m.ctrl.helm.toFixed(4)}`, source: 'net.js CTRL_KEYS rounding' });
  S.ok(gB.remote.length === 1 && gB.remote[0].remote, 'one remote boat built from the packets', { measured: `${gB.remote.length}` });
}
S.within({ quantity: 'remote copy position error, rms over 120 s with two tacks', measured: Math.sqrt(sq / n), hi: 0.5, unit: 'm', source: 'dead reckoning at 10 Hz pulled at 2.5/s: well under a boat length (est.)' });
S.within({ quantity: 'remote copy position error, worst', measured: worst, hi: 2, unit: 'm', source: 'est.: a third of a 7 m boat; a tack (the turn rate jumps) is the worst case' });
S.within({ quantity: 'remote copy heading error, worst', measured: worstH / DEG, hi: 10, unit: 'deg', source: 'est.' });

// ---------------------------------------------------------------- 3. damage round trip
{
  const a = new Boat('sportboat', { sailModel: 'strip' }), b = new Boat('sportboat', { sailModel: 'strip' });
  const Da = a.dmg = new Damage(a), Db = b.dmg = new Damage(b, { remote: true });
  Da.sails.jib.tear = 0.4; Da.sails.jib.u = 0.6; Da.sails.jib.v = 0.3;
  Da.water = 300; a.water = 300; recomputeMass(a);
  let st = JSON.parse(JSON.stringify(Da.netState()));
  Db.applyNet(st);
  S.ok(JSON.stringify(Db.netState()) === JSON.stringify(Da.netState()), 'torn jib and 300 L aboard: the remote summary equals the owner\'s', { measured: JSON.stringify(Db.netState()), expected: JSON.stringify(Da.netState()) });
  S.near({ quantity: 'remote copy: water aboard', measured: b.water, expected: 300, tol: 1, unit: 'kg', source: 'applyNet' });
  S.near({ quantity: 'remote copy: mass with the water', measured: b.mass - a.mass, expected: 0, tol: 1, unit: 'kg', source: 'recomputeMass on both' });
  Da.dismast(3.2, 'test', -1);
  st = JSON.parse(JSON.stringify(Da.netState())); Db.applyNet(st);
  S.ok(Db.rig.down && Math.abs(Db.rig.breakZ - 3.2) < 0.01 && Db.rig.side === -1 && b.rigDown, 'dismasted at 3.2 m, to port: the remote rig comes down there too', { measured: `${Db.rig.down} ${Db.rig.breakZ} ${Db.rig.side}` });
  // the owner pumps her dry: the remote copy must lose the water too
  Da.water = 0; a.water = 0; recomputeMass(a);
  st = Da.netState(); Db.applyNet(st ? JSON.parse(JSON.stringify(st)) : null);
  S.near({ quantity: 'remote copy: water aboard after the owner pumped her dry', measured: b.water, expected: 0, tol: 5, unit: 'kg', source: 'the summary omits water under 5 L (damage.js netState), so the remote must read its absence as dry' });
}

performance.now = realNow;
S.done();
