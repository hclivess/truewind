// The autopilot's lookout: the other boats (the fleet, online sailors) and the harbour traffic (js/traffic.js), each
// one's closest point of approach (CPA) and the time to it (TCPA) on the course she means to sail, and the collision
// regulations (COLREGs) for a sailing vessel:
//   - a power-driven vessel keeps out of the way of a sailing one (rule 18), so with a motor boat or a ferry she stands
//     on (rule 17(a)); but a sailing vessel does not impede a vessel that can navigate only in a channel or fairway
//     (rule 9(b), and a ship or a large ferry is treated so: she cannot turn for a yacht), so with those she gives way
//   - between sailing vessels (rule 12): on opposite tacks, the one on port keeps clear; on the same tack, the one to
//     windward keeps clear
//   - an overtaking vessel keeps clear of the one she overtakes, whatever they are (rule 13)
//   - the give-way vessel acts early and substantially (rule 16): she alters by enough that the CPA opens well past
//     safe, by bearing away to pass astern, heading up, or tacking; if no course does it she luffs to slow
//   - the stand-on vessel holds her course and speed (17(a)(i)), but once it is clear the other is not acting and the
//     CPA has become dangerous, she acts herself (17(a)(ii), (b))
// In a race the racing rules govern the boats (js/rules.js, AIHelm's aiRules): the lookout then watches the traffic only.
import { wrap, clamp } from './physics.js';

const DEG = Math.PI / 180;
// the look-ahead (s) and the margin that counts as clear: the CPA between centres at least half the two lengths plus
// a margin by the other's kind (est.: a yacht passed at 20 m hull to hull, a motor boat 30, a ferry or ship by half
// her length and at least 60 m: room for her to change her mind)
const LOOK = 150;
export function safeRange(ownL, c) {
  const m = c.big ? Math.max(60, 0.5 * c.L) : c.power ? 30 : 20;
  return 0.5 * (ownL + c.L) + m;
}
// CPA (m) and TCPA (s) of contact c from a boat at (x, z) moving at (vx, vz)
export function cpaOf(x, z, vx, vz, c) {
  const rx = c.x - x, rz = c.z - z, wx = c.vx - vx, wz = c.vz - vz, w2 = wx * wx + wz * wz;
  const tc = w2 > 1e-6 ? -(rx * wx + rz * wz) / w2 : 0;
  if (tc <= 0) return { cpa: Math.hypot(rx, rz), tcpa: 0, now: Math.hypot(rx, rz) };
  return { cpa: Math.hypot(rx + wx * tc, rz + wz * tc), tcpa: tc, now: Math.hypot(rx, rz) };
}
// the contacts within a kilometre: { id, x, z, vx, vz, psi, L, power, sail, big, port (on port tack), name, kind }
export function contacts(b, sim, { boats = true, traffic = true } = {}) {
  const out = [];
  if (boats && sim.boats) for (const o of sim.boats) {
    if (o === b || o.sunk || !o.cls) continue;
    if (Math.abs(o.x - b.x) > 1000 || Math.abs(o.z - b.z) > 1000) continue;
    const twd = o.diag && o.diag.twd !== undefined ? o.diag.twd : (b.diag.twd ?? 0);
    out.push({ id: 'b' + (o.id ?? out.length), x: o.x, z: o.z, vx: o.vgx ?? Math.sin(o.psi) * o.u, vz: o.vgz ?? -Math.cos(o.psi) * o.u, psi: o.psi, u: o.u,
      L: o.cls.loa, power: false, sail: true, big: false, port: wrap(twd - o.psi) < 0, kind: 'yacht', name: o.name ? o.name : 'a yacht' });
  }
  const T = traffic && sim.traffic;
  if (T && T.vessels) for (const v of T.vessels) {
    if (v.hidden || Math.abs(v.x - b.x) > 1000 || Math.abs(v.z - b.z) > 1000) continue;
    const power = !!(v.T && v.T.power) || !v.sails, u = v.dwell > 0 ? 0 : (v.u || 0);
    const kind = v.type || 'vessel', label = (v.T && v.T.name) || kind;
    out.push({ id: 't' + T.vessels.indexOf(v), x: v.x, z: v.z, vx: Math.sin(v.psi) * u, vz: -Math.cos(v.psi) * u, psi: v.psi, u,
      L: v.L || 10, power, sail: !power, big: !!v.transit || ((v.L || 0) > 50 && power) || kind === 'chain', port: (v.twa ?? 0) < 0, kind,
      name: v.name ? `the ${label} ${v.name}` : `a ${label}` });
  }
  return out;
}
// who keeps clear of whom, for a contact on a collision course: 'give' (she keeps clear) or 'stand' (she stands on),
// with the rule and a few words of why
export function roleOf(b, c, twd) {
  const fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
  const brg = wrap(Math.atan2(c.x - b.x, -(c.z - b.z)) - b.psi);            // the contact's bearing off our bow (+ starboard)
  const back = wrap(Math.atan2(b.x - c.x, -(b.z - c.z)) - c.psi);            // ours off hers
  const moving = c.u > 0.3;
  // overtaking (13): coming up from more than 22.5 degrees abaft her beam, and faster along her way
  const closing = b.u * (fx * Math.sin(c.psi) - fz * Math.cos(c.psi)) - c.u;
  if (moving && Math.abs(back) > 112.5 * DEG && closing > 0.2) return { role: 'give', rule: '13', why: 'we are overtaking her' };
  if (moving && Math.abs(brg) > 112.5 * DEG && c.u > b.u + 0.2) return { role: 'stand', rule: '13', why: 'she is overtaking us and keeps clear' };
  if (!moving) return { role: 'give', rule: '8', why: 'she is stopped' };
  if (c.big) return { role: 'give', rule: '9', why: 'a ship that cannot turn for us: we do not impede her' };
  if (c.power) return { role: 'stand', rule: '18', why: 'power gives way to sail' };
  const port = wrap(twd - b.psi) < 0;
  if (port !== c.port) return port ? { role: 'give', rule: '12', why: 'we are on port tack, she on starboard' } : { role: 'stand', rule: '12', why: 'we are on starboard, she on port' };
  // same tack: windward keeps clear (the wind blows from twd: toward the source is (sin twd, -cos twd))
  const up = (c.x - b.x) * Math.sin(twd) - (c.z - b.z) * Math.cos(twd);
  return up < 0 ? { role: 'give', rule: '12', why: 'we are to windward of her' } : { role: 'stand', rule: '12', why: 'she is to windward of us' };
}
export function aspectOf(b, c) {
  const brg = wrap(Math.atan2(c.x - b.x, -(c.z - b.z)) - b.psi), a = Math.abs(brg) / DEG, s = brg > 0 ? 'starboard' : 'port';
  return a < 12 ? 'dead ahead' : a < 67.5 ? `on the ${s} bow` : a < 112.5 ? `abeam to ${s}` : `astern on the ${s} quarter`;
}

// The lookout and the helm's answer. desired: the heading the pilot means to steer; up: the close-hauled angle; U: the
// speed to judge her by. Returns { desired, slow, say } (say: a coach line for a new decision, or null).
export class Lookout {
  constructor(b) { this.b = b; this.act = null; this.seen = {}; this.evalT = -9; }
  step(t, sim, desired, up, { boats = true, traffic = true } = {}) {
    const b = this.b, twd = b.diag.twd ?? 0, L = b.cls.loa, U = Math.max(1, b.u);
    if (t - this.evalT < 0.5 && this.act) return { desired: this.act.hdg, slow: this.act.slow, say: null };
    this.evalT = t;
    const C = contacts(b, sim, { boats, traffic });
    if (!C.length) { this.act = null; return { desired, slow: false, say: null }; }
    const vel = (h, k = 1) => [Math.sin(h) * U * k, -Math.cos(h) * U * k];
    const margin = (h, k = 1, only = null) => {
      const [vx, vz] = vel(h, k); let m = Infinity;
      for (const c of C) { if (only && c !== only) continue; const q = cpaOf(b.x, b.z, vx, vz, c); if (q.tcpa > LOOK) continue; m = Math.min(m, q.cpa / safeRange(L, c)); }
      return m;
    };
    // the threats on the course she means: closing inside the look-ahead with a CPA inside safe
    const [dvx, dvz] = vel(desired);
    const threats = [];
    for (const c of C) {
      const q = cpaOf(b.x, b.z, dvx, dvz, c), S = safeRange(L, c);
      if (q.tcpa > 0 && q.tcpa < LOOK && q.cpa < S) threats.push({ c, q, S, ...roleOf(b, c, twd) });
      else if (q.now < 0.7 * S && q.tcpa > 0) threats.push({ c, q, S, ...roleOf(b, c, twd) });
    }
    if (!threats.length) {
      // (a turn made is held until she is past: back on her course only when that course is clear itself)
      if (this.act) { const was = this.act; this.act = null; if (t - was.t > 4) return { desired, slow: false, say: { k: 'clear', text: `Clear of ${was.name}: back on course.` } }; }
      return { desired, slow: false, say: null };
    }
    // the most urgent: the soonest CPA
    threats.sort((p, q) => p.q.tcpa - q.q.tcpa);
    const th = threats[0];
    // stand-on: hold on while the other has time to act; act herself once the CPA is close and near (17(a)(ii), 17(b))
    const give = threats.some((x) => x.role === 'give');
    // (the time she gives the other to act: longer for a big ship, which needs more room to be passed clear)
    const tAct = 30 + 0.6 * th.c.L + 3 * L;
    if (!give && !(th.q.cpa < 0.6 * th.S && th.q.tcpa < tAct) && !(th.q.now < th.S)) {
      let say = null;
      if (this.seen[th.c.id] === undefined || t - this.seen[th.c.id] > 60) { this.seen[th.c.id] = t; say = { k: 'stand', text: `${cap(th.c.name)} ${aspectOf(b, th.c)}: ${th.why} (rule ${th.rule}), so we stand on, holding our course and speed, and watch her.` }; }
      this.act = null;
      return { desired, slow: false, say };
    }
    // the answer: the smallest turn (by heading, a tack counted as 25 degrees more) that opens every CPA to 1.3 x safe;
    // between equals, bearing away (passing astern of a crossing boat) before heading up
    const twa0 = wrap(twd - desired), side0 = Math.sign(twa0) || 1;
    let best = null;
    for (let off = -100; off <= 100; off += 5) {
      const h = desired + off * DEG, twa = wrap(twd - h);
      if (Math.abs(twa) < up) continue;                           // (the no-go zone: not a course she can sail)
      const m = margin(h);
      const away = Math.abs(twa) > Math.abs(twa0) ? 0 : 3;
      const cost = Math.abs(off) + (Math.sign(twa) !== side0 ? 25 : 0) + away;
      if (!best || (m >= 1.3 && (best.m < 1.3 || cost < best.cost)) || (best.m < 1.3 && m > best.m)) best = { h, m, cost, off };
    }
    // (held: a turn already made stays made while it still clears, so she does not weave between two answers)
    if (this.act && this.act.id === th.c.id && margin(this.act.hdg) >= 1.1) best = { h: this.act.hdg, m: margin(this.act.hdg), off: wrap(this.act.hdg - desired) / DEG, held: true };
    if (!best) best = { h: desired, m: margin(desired), off: 0 };
    const slow = best.m < 1.1;                                     // (no course clears her: luff and let her pass)
    const twaB = wrap(twd - best.h);
    const astern = Math.abs(wrap(Math.atan2(th.c.x - b.x, -(th.c.z - b.z)) - b.psi)) > 112.5 * DEG;
    const turn = Math.abs(best.off) < 3 ? '' : Math.sign(twaB) !== side0 ? 'tacking away' : Math.abs(twaB) > Math.abs(twa0) + 2 * DEG ? (astern ? 'bearing away to open the distance' : th.c.u > 0.3 ? 'bearing away to pass astern of her' : 'bearing away to pass clear') : (astern ? 'heading up to open the distance' : 'heading up to pass clear');
    const verb = slow ? (turn ? turn + ', and easing the sheets to slow' : 'easing the sheets to slow and let her pass') : turn || 'holding on';
    const isNew = !this.act || this.act.id !== th.c.id || this.act.verb !== verb;
    this.act = { id: th.c.id, hdg: best.h, slow, t: isNew ? t : this.act.t, name: th.c.name, verb };
    let say = null;
    if (isNew) {
      const why = th.role === 'give' ? `${th.why}, so we keep clear (rule ${th.rule})` : `she is not giving way and is close now, so we act ourselves (rule 17)`;
      say = { k: 'avoid', text: `${cap(th.c.name)} ${aspectOf(b, th.c)}, closest approach ${Math.round(th.q.cpa)} m in ${Math.round(th.q.tcpa)} s: ${why} — ${verb}${slow ? '' : ` (${Math.abs(Math.round(best.off))}°)`}.` };
    }
    return { desired: best.h, slow, say };
  }
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
