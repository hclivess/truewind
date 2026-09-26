// Man overboard (pure logic, no three.js). There is no drawn crew figure anywhere: a person in the water is only
// the MOB marker the crew throws (danbuoy with its strobe, and a horseshoe life ring) and the plotter's MOB mark.
//
//  * WHO GOES OVER. A violent event throws exposed crew: a knockdown or capsize (the heel passes ~55 deg with a
//    roll rate over ~0.8 rad/s), a crash gybe with the crew on the rail (the boom's slam), a hard lateral jerk.
//    The chance per exposed crew member grows with the roll rate squared (the energy of the throw) and with the
//    exposure (on a trapeze > hiking over the rail > sitting in a keelboat's cockpit): ~5% each at 1.5 rad/s on
//    the rail. The draw is deterministic: a hash of the boat's seed and the event count, never Math.random.
//    A dinghy's capsize is not a man overboard (the sailor swims round to the board, as before): only a violent
//    one (a death roll, a catapult) separates the sailor from the boat.
//  * IN THE WATER. A person in the water drifts with the current and a leeway of ~1.1% of the wind speed
//    (US Coast Guard leeway tables for a person in the water, Allen & Plourde 1999). The danbuoy and the ring are
//    thrown at once and the person holds on: the marker is where the person is. The crew presses the plotter's
//    MOB button at once (the chart marks the spot and steers for it).
//  * RECOVERY. Stop alongside within ~2 m at under ~1.5 kn and hold there ~4 s: the crew hauls them aboard. The
//    crew's weight is off the boat meanwhile (less righting moment, lighter boat). A single-hander left in the
//    water swims (~0.5 m/s in a buoyancy aid) for the boat, which sails on unmanned with the helm free and the
//    sheets as they were (she rounds up and stops, as they do) — or drifts away faster than a swimmer.
import { DEG } from './env.js';
import { clamp } from './physics.js';
import { hash01, recomputeMass } from './damage.js';

export const PIW_LEEWAY = 0.011, SWIM = 0.5;

export class MOB {
  constructor(boat, opts = {}) {
    this.b = boat; this.C = boat.cls;
    this.seed = opts.seed ?? 1;
    this.n = 0;                   // violent events so far (the hash's counter)
    this.people = [];             // { x, z, mx, mz (marker), t, since (alongside), id }
    this.events = [];
    this.enabled = opts.enabled ?? true;
    this._pmax = 0; this._inEvent = false;
    this.crewEach = this.C.crewEach;
  }
  get single() { return this.C.crewN <= 1; }
  get overboard() { return this.people.length; }
  // exposure of the crew by how they are placed
  exposure() {
    const b = this.b, C = this.C, out = Math.abs(b.crewY) / Math.max(0.1, C.crewMaxOut);
    if (C.trapeze && out > 0.6) return 1.4;
    if (C.id === 'blackwatch' || C.cabin) return 0.25 + 0.5 * out;
    return 0.4 + 0.8 * out;
  }
  post(dt, ctx = {}) {
    const b = this.b, C = this.C, env = ctx.env, t = ctx.t || 0;
    if (!this.enabled) return;
    // ---- violent events
    const aphi = Math.abs(b.phi), ap = Math.abs(b.p);
    if (aphi > 55 * DEG && ap > 0.5) { this._inEvent = true; this._pmax = Math.max(this._pmax, ap); }
    else if (this._inEvent && (aphi < 45 * DEG || ap < 0.2)) {
      this._inEvent = false;
      const pr = this._pmax; this._pmax = 0;
      if (pr > 0.8) this.throwCrew(pr, C.canCapsize ? 'capsize' : 'knockdown');
    }
    if ((b.slamJ || 0) > 0 && b.sailBy.main) {
      const Jref = b.sailBy.main.Iboom * 3 * 1.2;
      if (b.slamJ > 0.6 * Jref && Math.abs(b.crewY) > 0.5 * C.crewMaxOut) this.throwCrew(1.5 * b.slamJ / Jref, 'gybe');
    }
    // ---- people in the water: drift, swim, recover
    const w = env ? env.wind.sample(b.x, b.z, t, this._w || (this._w = {})) : { speed: 0, dir: 0 };
    const wx = -Math.sin(w.dir) * w.speed, wz = Math.cos(w.dir) * w.speed;
    for (const P of this.people) {
      const cur = env ? env.current.at(P.x, P.z, this._c || (this._c = {})) : { x: 0, z: 0 };
      P.x += (cur.x + PIW_LEEWAY * wx) * dt; P.z += (cur.z + PIW_LEEWAY * wz) * dt;
      P.t += dt;
      const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz);
      const half = C.multihull ? C.hullSpacing / 2 + 0.5 : C.beam / 2;
      if (this.single) {
        // the sailor swims for the boat
        if (d > 0.5) { P.x += dx / d * SWIM * dt; P.z += dz / d * SWIM * dt; }
      }
      P.mx = P.x; P.mz = P.z;
      const sog = Math.hypot(b.vgx || 0, b.vgz || 0);
      if (d < half + 2 && sog < 0.8) P.since += dt; else P.since = Math.max(0, P.since - dt * 2);
      if (P.since > (this.single ? 1.5 : 4)) this.recover(P);
    }
  }
  throwCrew(severity, why) {
    const b = this.b, C = this.C;
    const aboard = Math.round(b.crewMass / this.crewEach);
    if (aboard <= 0) return;
    this.n++;
    const e = this.exposure();
    // a dinghy's ordinary capsize is not a man overboard: only a violent one separates the sailor from the boat
    const base = why === 'capsize' ? 0.012 : why === 'gybe' ? 0.03 : 0.05;
    const p = clamp(base * e * (severity / 1.5) ** 2 * (why === 'capsize' ? (severity > 2 ? 3 : 0.3) : 1), 0, 0.6);
    let lost = 0;
    for (let k = 0; k < aboard; k++) if (hash01(this.seed, this.n, k) < p) lost++;
    if (!lost) return;
    for (let k = 0; k < lost; k++) this.overboard1(why, k);
  }
  overboard1(why, k = 0) {
    const b = this.b, C = this.C;
    if (b.crewMass < this.crewEach - 1) return;
    // off the weather rail (or out of the cockpit to leeward in a knockdown)
    const side = why === 'knockdown' ? Math.sign(b.phi) || 1 : -Math.sign(b.crewY) || 1;
    const half = C.multihull ? C.hullSpacing / 2 + 0.6 : C.beam / 2 + 0.6;
    const x0 = C.sternX * 0.3 - 0.5 * k, sx = Math.cos(b.psi), sz = Math.sin(b.psi), fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
    const x = b.x + fx * x0 + sx * side * half, z = b.z + fz * x0 + sz * side * half;
    const P = { x, z, mx: x, mz: z, t: 0, since: 0, id: this.people.length + 1, x0: x, z0: z };
    this.people.push(P);
    b.crewMass = Math.max(0, b.crewMass - this.crewEach); recomputeMass(b);
    if (this.single) { b.unmanned = true; b.auto.trim = false; }
    this.mark = { x, z };
    this.events.push({ type: 'mob', msg: this.single ? 'You are in the water — swimming for the boat' : `MAN OVERBOARD${why === 'gybe' ? ' — swept off by the boom' : why === 'knockdown' ? ' — thrown out in the knockdown' : ''}! Danbuoy and ring away, MOB marked`, bad: true });
  }
  recover(P) {
    const b = this.b;
    this.people = this.people.filter((q) => q !== P);
    b.crewMass += this.crewEach; recomputeMass(b);
    if (this.single) b.unmanned = false;
    this.events.push({ type: 'recovered', msg: this.single ? 'Back aboard' : `Crew recovered after ${Math.round(P.t)} s` });
    if (!this.people.length) this.mark = null;
  }
  // (a test hook, and the menu's "man overboard" drill)
  drill() { this.overboard1('drill'); }
}
