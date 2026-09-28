// Autopilot for the player's boat, a learning aid: the AI crews' own tactician and helm (js/race.js AIHelm) sail her to
// the chart's waypoint or, racing, round the course; with no waypoint it holds the wind angle like a wind vane. A water
// route (A* over the chart, js/traffic.js NavGrid, with the shallows closed) takes her round land and banks; at the
// waypoint she shoots up or heaves to. A coach says what she does and why, in plain words, as each decision is taken
// (the tactician's notes: tacks on the layline, gybes, the kite, reefs, shallows, giving way), never on a timer.
import { DEG, KT } from './env.js';
import { autoTrim, wrap, clamp, lerp } from './physics.js';
import { AIHelm, waterTwd } from './race.js';
import { NavGrid } from './traffic.js';
import { RULE_SHORT } from './rules.js';

const dg = (r) => Math.round(Math.abs(r) / DEG);
const distTxt = (m) => (m >= 1852 * 0.3 ? `${(m / 1852).toFixed(1)} nm` : `${Math.round(m / 10) * 10} m`);
const mmss = (s) => (s < 3600 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`);
// why she gives way, in words (the rule's own short name where it reads well)
const WHY = { '13': 'we are tacking', '15': 'she has just gained right of way (15)', '16.1': 'she is changing course (16.1)', '17': 'proper course (17)', '22': 'we are returning or turning (22)', '23': 'she is capsized or aground (23)' };
const pad3 = (a) => String(((Math.round(a / DEG) % 360) + 360) % 360).padStart(3, '0');
// the point of sailing for a true wind angle
const pointOf = (a) => (a < 52 * DEG ? 'close-hauled' : a < 75 * DEG ? 'close reach' : a < 108 * DEG ? 'beam reach' : a < 155 * DEG ? 'broad reach' : 'run');

// A* over the chart for a keel: the traffic's grid (clear of the shore) with every cell too shallow for her closed,
// and straight runs checked for depth as well as the shore. One per world and draft (coarse on a big chart: ~512 cells a side)
class RouteGrid extends NavGrid {
  constructor(world, keel) {
    super(world, Math.max(2, Math.round(world.N / 512)));
    this.keel = keel;
    for (let k = 0; k < this.M * this.M; k++) if (this.clr[k] > 0) { const [x, z] = this.center(k); if (world.depthAt(x, z) < keel) this.clr[k] = -1; }
  }
  clearSeg(ax, az, bx, bz, need) {
    if (!super.clearSeg(ax, az, bx, bz, need)) return false;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 8));
    for (let i = 0; i <= n; i++) if (this.world.depthAt(ax + (bx - ax) * i / n, az + (bz - az) * i / n) < this.keel) return false;
    return true;
  }
}

export class Autopilot {
  constructor(boat) {
    this.b = boat;
    const h = this.helm = new AIHelm(boat, { seed: 0, skill: 1, startFrac: 0.5 });
    h.overstand = 3 * DEG; h.bias = 0; h.log = []; h.cone = 0.6;      // (a steady helm: no personality; off the laylines till close)
    this.engaged = false; this.events = []; this.line = null; this.info = null;
  }
  engage(t) {
    const h = this.helm, b = this.b;
    this.engaged = true; this.t0 = t; this.line = null; this.prev = null; this.info = null; this.events.length = 0;
    this.vaneTwa = null; this.tgtKey = null; this.arrived = false; this.route = null; this.mode = null;
    this.keySeen = null; this.keySaid = null; this.lastSaid = {}; this.shiftArm = 0; this.markSaid = -1; this.shooting = false; this.helmOut = null; this.finSaid = false; this.psSaid = null; this.overSaid = false;
    h.log.length = 0; h.genNoted = b.ctrl.gen; h.lastTack = -100; h.tackTo = 0; h.twdMean = null; h.kc = null; h.holdPsi = null; h.backing = false; h.goal = null;
  }
  disengage() { this.engaged = false; this.info = null; this.shooting = false; }

  // o: { target {x, z, label}, racer, course, targets {up, dn} (deg), name } — sim: the game (boats, world, env, rules, race)
  update(dt, t, sim, o = {}) {
    if (!this.engaged) return;
    const b = this.b;
    if (b.diag.twd === undefined) return;     // (not a step sailed yet: no wind felt to steer by)
    // the helm moved by anyone else (a key, the tiller, the touch pad): like a real autopilot, it lets go at once
    if (this.helmOut !== null && Math.abs(b.ctrl.helm - this.helmOut) > 0.02) { this.disengage(); this.say('override', 'Autopilot off: manual helm — she is yours.', t); return; }
    this.targets = o.targets || this.targets;
    this.up = (this.targets?.up ?? 42) * DEG; this.dn = Math.min((this.targets?.dn ?? 145) * DEG, b.sailBy.gennaker ? 150 * DEG : Math.PI);
    this.o = o; this.sim = sim;
    if (o.racer) { this.helm.goal = null; this.helm.update(dt, t, sim, o.racer, o.course, o.targets); this.mode = this.helm.mode; this.T = this.helm.dest; }
    else if (o.target) this.toPoint(dt, t, sim, o.target);
    else { this.tgtKey = null; this.T = null; this.vane(dt, t, sim); }
    this.digest(t, sim);
    if (t - (this.infoT ?? -9) > 0.25) { this.infoT = t; this.info = this.plan(sim); }
    this.helmOut = b.ctrl.helm;
  }

  // ---------------------------------------------------------------- free sailing to a point
  toPoint(dt, t, sim, T0) {
    const b = this.b, h = this.helm, L = b.cls.loa, w = sim.world, keel = b.cls.draft + 1;
    const key = `${T0.x.toFixed(0)},${T0.z.toFixed(0)}`;
    if (key !== this.tgtKey) {
      this.tgtKey = key; this.arrived = false; this.shooting = false; this.vaneTwa = null; this.keySaid = null;
      this.tname = T0.label ? (T0.label === 'Waypoint' ? 'the waypoint' : T0.label) : 'the waypoint';
      // a waypoint on the land or the shallows: the nearest water she can float in, and she stops there
      this.T = { x: T0.x, z: T0.z };
      if (w && !w.open && (w.sdfAt(T0.x, T0.z) < 3 || w.depthAt(T0.x, T0.z) < keel)) {
        const d0 = w.sdfAt(T0.x, T0.z) < 0 ? 0 : w.depthAt(T0.x, T0.z);
        found: for (let r = 10; r < 1500; r += 10) for (let a = 0; a < 6.28; a += 12 / r) {
          const x = T0.x + Math.cos(a) * r, z = T0.z + Math.sin(a) * r;
          if (w.sdfAt(x, z) > 8 && w.depthAt(x, z) > keel + 0.5) { this.T = { x, z }; break found; }
        }
        this.say('shallowWp', `${cap(this.tname)} is in ${d0 < 0.3 ? 'no water' : d0.toFixed(1) + ' m of water'}, too shallow for our ${b.cls.draft.toFixed(1)} m keel: we stop ${Math.round(Math.hypot(this.T.x - T0.x, this.T.z - T0.z))} m short, in water we can float in.`, t);
      }
      this.route = w && !w.open ? this.planRoute(w, this.T, keel) : null;
      if (this.route && this.route.length > 1) this.say('route', `Routing round the ${this.routeWhy}: ${this.route.length} legs, the first to ${pad3(Math.atan2(this.route[0][0] - b.x, -(this.route[0][1] - b.z)))}° (${distTxt(Math.hypot(this.route[0][0] - b.x, this.route[0][1] - b.z))}). A straight line to ${this.tname} would cross it.`, t);
    }
    const T = this.T, dist = Math.hypot(T.x - b.x, T.z - b.z), twd = waterTwd(b);
    // there: heave to (luffing, sheets eased) until she drifts off it, then sail back
    const rArr = Math.max(2 * L, 8);
    if (!this.arrived && dist < rArr) {
      this.arrived = true; this.shooting = false;
      this.say('arrive', `Arrived: heaving to ${Math.round(dist)} m from ${this.tname} — luffing head to wind with the sheets eased, so she stops and lies quietly.`, t);
    } else if (this.arrived && dist > Math.max(8 * L, 45)) {
      this.arrived = false; this.keySaid = null;
      this.say('drift', `Drifted ${Math.round(dist)} m off ${this.tname} on the wind and tide: sailing back to it.`, t);
    }
    if (this.arrived) { this.heaveTo(dt, twd); this.mode = 'hove-to'; return; }
    const goal = this.nextGoal(sim, t);
    // the last few metres dead to windward: shoot up, luffing into the wind to coast there on her way
    const brg = Math.atan2(T.x - b.x, -(T.z - b.z)), rel = wrap(brg - twd);
    if (goal === T && !this.shooting && Math.abs(rel) < this.up && dist > rArr + 3 && dist < Math.min(3 * L + 8, 5 * b.u) && b.u > 0.8 && Math.abs(wrap(brg - b.psi)) < 60 * DEG) {
      this.shooting = true;
      this.say('shoot', `Shooting up to ${this.tname}: it's dead to windward and ${Math.round(dist)} m off, so we luff into the wind and coast the last metres on her way.`, t);
    }
    if (this.shooting && (b.u < 0.35 || Math.abs(rel) > this.up + 15 * DEG || dist > 3 * L + 12)) this.shooting = false;
    if (this.shooting) {
      if (!h.noTrim) autoTrim(b, dt, 0);
      if (b.sailBy.gennaker) b.ctrl.gen = false;
      h.steer(dt, brg, true); this.mode = 'shoot'; return;
    }
    h.goal = goal;
    h.update(dt, t, sim, null, null, this.targets);
    this.mode = h.mode;
  }
  // the route's next point: the farthest one in clear water on a straight line (checked each second), or the waypoint
  nextGoal(sim, t) {
    if (!this.route) return this.T;
    const b = this.b, w = sim.world, keel = b.cls.draft + 1, near = Math.max(40, 5 * b.cls.loa);
    if (t - (this.skipT ?? -9) > 1) {
      this.skipT = t; let moved = false;
      while (this.route.length > 1 && (Math.hypot(this.route[0][0] - b.x, this.route[0][1] - b.z) < near || this.clearRun(w, b.x, b.z, this.route[1][0], this.route[1][1], keel))) { this.route.shift(); moved = true; }
      if (this.route.length <= 1) { this.route = null; if (moved) this.say('leg', `Clear water to ${this.tname} now: sailing straight for it.`, t); return this.T; }
      if (moved) this.say('leg', `Next leg: round to ${pad3(Math.atan2(this.route[0][0] - b.x, -(this.route[0][1] - b.z)))}° (${distTxt(Math.hypot(this.route[0][0] - b.x, this.route[0][1] - b.z))}), keeping to the deep water.`, t);
    }
    const p = this.route[0];
    if (!this.goalPt || this.goalPt.x !== p[0] || this.goalPt.z !== p[1]) this.goalPt = { x: p[0], z: p[1] };
    return this.goalPt;
  }
  clearRun(w, ax, az, bx, bz, keel) {
    if (!w || w.open) return true;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
    for (let i = 0; i <= n; i++) { const x = ax + (bx - ax) * i / n, z = az + (bz - az) * i / n; if (w.sdfAt(x, z) < 15 || w.depthAt(x, z) < keel) return false; }
    return true;
  }
  planRoute(w, T, keel) {
    const b = this.b;
    if (this.clearRun(w, b.x, b.z, T.x, T.z, keel)) return null;
    // (what is in the way: land, or only the shallows)
    let land = false; for (let i = 0; i <= 60; i++) if (w.sdfAt(b.x + (T.x - b.x) * i / 60, b.z + (T.z - b.z) * i / 60) < 0) land = true;
    this.routeWhy = land ? 'land' : 'shallows';
    const g = w._apGrid && w._apGrid.keel === keel && w._apGrid.world === w ? w._apGrid : (w._apGrid = new RouteGrid(w, keel));
    const pts = g.plan(b.x, b.z, T.x, T.z, 25, g.M * g.M);
    if (!pts) return null;
    const r = []; for (let i = 2; i + 1 < pts.length; i += 2) r.push([pts[i], pts[i + 1]]);
    return r.length ? r : null;
  }
  // heave to: luff to ~50° off the wind, every sheet eased, and let her lie there
  heaveTo(dt, twd) {
    const b = this.b, c = b.ctrl, tack = Math.sign(wrap(twd - b.psi)) || 1;
    c.main = 1; if (b.sailBy.jib) c.jib = 1; if (b.sailBy.stay) c.stay = 1; if ('mizzen' in c) c.mizzen = 1;
    c.gen = false; c.lazy = 1; c.pushBoom = 0; this.helm.genNoted = false;
    const err = wrap(twd - tack * 50 * DEG - b.psi), cmd = clamp(2 * err - 1.5 * b.r, -0.6, 0.6);
    c.helm = lerp(c.helm, b.u < -0.1 ? -cmd : cmd, clamp(dt * 6, 0, 1));
    this.helm.desired = twd - tack * 50 * DEG;
  }

  // ---------------------------------------------------------------- no waypoint: a wind vane (holds the true wind angle)
  vane(dt, t, sim) {
    const b = this.b, h = this.helm, twd = waterTwd(b), up = this.up;
    if (this.vaneTwa === null) {
      const a = wrap(twd - b.psi);
      this.vaneTwa = (Math.sign(a) || 1) * clamp(Math.abs(a), up, 175 * DEG);
      this.say('vane', `No waypoint: holding the wind angle like a wind vane, ${dg(this.vaneTwa)}° off the wind on ${this.vaneTwa > 0 ? 'starboard' : 'port'} tack (a ${pointOf(Math.abs(this.vaneTwa))}). Tap the chart for a waypoint to sail to.`, t);
    }
    const A = Math.abs(this.vaneTwa), mode = A < up + 6 * DEG ? 'beat' : A > 150 * DEG ? 'run' : 'reach', tack = Math.sign(wrap(twd - b.psi)) || 1;
    let desired = twd - this.vaneTwa;
    if (sim.world && !sim.world.open) {
      const hh = h.avoidShoals(sim, desired, mode, tack, up, twd, t);
      // (turned through the wind to get out of the shallows: the same angle on the new tack)
      if (hh !== desired && (Math.sign(wrap(twd - hh)) || 1) !== Math.sign(this.vaneTwa) && Math.abs(wrap(twd - hh)) > up * 0.9) {
        this.vaneTwa = -this.vaneTwa; desired = twd - this.vaneTwa;
        this.say('vaneFlip', `Shallows ahead: ${mode === 'run' ? 'gybing' : 'tacking'} away, and holding ${dg(this.vaneTwa)}° off the wind on ${this.vaneTwa > 0 ? 'starboard' : 'port'} now.`, t);
      } else desired = hh;
    }
    h.sails(mode, wrap(twd - b.psi), false);
    if (!h.noTrim) autoTrim(b, dt, 0);
    h.steer(dt, desired);
    h.mode = mode; this.mode = 'vane';
  }

  // ---------------------------------------------------------------- the coach
  say(kind, text, t, gap = 0) {
    if (gap && t - (this.lastSaid[kind] ?? -1e9) < gap) return false;
    this.lastSaid[kind] = t;
    this.prev = this.line; this.line = { kind, text, t };
    this.events.push(this.line);
    return true;
  }
  tn() {
    const o = this.o, r = o && o.racer;
    if (r && o.course) { const leg = o.course.legs[r.leg]; return !leg ? 'the finish' : leg.type === 'start' ? 'the start line' : 'the ' + leg.name.toLowerCase().replace('finish', 'finish line'); }
    return this.route ? 'the next turn of the route' : this.tname || 'the waypoint';
  }
  digest(t, sim) {
    const b = this.b, h = this.helm, twd = waterTwd(b), R = sim.rules;
    const D = this.o && this.o.racer ? h.dest : this.route && h.goal ? h.goal : this.T, brg = D ? Math.atan2(D.x - b.x, -(D.z - b.z)) : b.psi, fromHdg = dg(wrap(brg - b.psi));
    let turned = false;
    for (const e of h.log.splice(0)) {
      if (e.k === 'tack') {
        turned = true;
        const side = e.to > 0 ? 'starboard' : 'port';
        const txt = e.why === 'layline' ? `Tacking now: we've reached the ${side} layline (${this.tn()} bears ${fromHdg}° from our heading).`
          : e.why === 'header' ? `Tacking on the header: the wind has swung ${dg(e.hdr)}° against us, so the other tack now points closer to ${this.tn()}.`
          : e.why === 'tide' ? `Tacking for the tide: the other tack takes us into water flowing more toward ${this.tn()}.`
          : e.why === 'hail' ? `Tacking: ${R && R.hailTo(b) ? R.hailTo(b).from.name + ' hailed' : 'we were hailed'} for room to tack (rule 20).`
          : e.why === 'shoal' ? `Tacking away from the shallows: ${e.depth.toFixed(1)} m ahead and we draw ${b.cls.draft.toFixed(1)} m.`
          : e.why === 'start' ? 'Tacking to cross the start line between its ends.'
          : e.why === 'cone' ? `Tacking back toward the middle: we're ${distTxt(Math.abs(e.off))} out to the ${e.off > 0 ? 'left' : 'right'} of the direct line. Staying off the laylines until close keeps our options open if the wind shifts.`
          : `Tacking onto ${side}.`;
        this.say('tack', txt, t);
      } else if (e.k === 'gybe') {
        turned = true;
        this.say('gybe', `Gybing: ${this.tn()} is now on the other gybe's side (${fromHdg < 20 ? 'just across dead downwind' : `${fromHdg}° from our heading`}); the boom comes across, so it's done steadily.`, t);
      } else if (e.k === 'gen') {
        const gn = (b.sailBy.gennaker && b.sailBy.gennaker.label || 'gennaker').toLowerCase(), awa = dg(b.diag.awaMid ?? b.diag.awa ?? 0);
        if (e.up) this.say('gen', `Hoisting the ${gn}: ${awa > 90 ? 'apparent wind is aft of the beam' : `the wind is ${dg(e.twa)}° off the bow, broad enough to carry it`}, and it pulls far harder than the jib there.`, t, 6);
        else this.say('gen', `Dropping the ${gn}: ${e.why === 'bottom' ? `the leeward mark is close — down before we round and head up` : e.why === 'beat' ? `we're heading upwind, and it can't set that close to the wind` : `at ${dg(e.twa)}° off the wind it's too close to set (it wants ${e.from}° or more)`}.`, t, 6);
      } else if (e.k === 'reef') {
        const heel = dg(b.phi);
        this.say('reef', e.to > e.from ? `Reefing${e.to > 1 ? ' again' : ''}: ${Math.round(e.tws)} kn and ${heel}° of heel — a smaller main keeps her on her feet and the helm light.` : `Shaking out ${e.to ? 'a' : 'the'} reef: down to ${Math.round(e.tws)} kn, she wants the sail back.`, t);
      } else if (e.k === 'shoal') {
        this.say('shoal', `Shallows on our track (${e.depth.toFixed(1)} m ahead, we draw ${b.cls.draft.toFixed(1)} m): ${e.off >= 180 ? 'no clear heading — turning for the deepest water' : `steering ${e.off}° off to keep water under the keel`}.`, t, 20);
      } else if (e.k === 'give') {
        const nm = e.o.name || 'the other boat', rs = WHY[e.rule] || RULE_SHORT[e.rule] || `rule ${e.rule}`;
        const txt = e.rule === '18.2' ? `Giving ${nm} mark-room (rule 18.2): she's inside us at the mark.`
          : e.rule === '19' ? `Giving ${nm} room at the obstruction (rule 19).`
          : e.rule === '20' ? `Giving ${nm} room to tack (rule 20).`
          : `Giving way: ${rs}, ${{ duck: 'ducking', up: 'heading up to keep clear of', slow: 'easing the sheets to slow behind', tack: 'tacking away from', hold: 'keeping clear of' }[e.how]} ${nm}.`;
        if (this.giveKey !== nm || t - (this.lastSaid.give ?? -1e9) > 15) { this.giveKey = nm; this.say('give', txt, t); }   // (once a boat, not each re-plan)
      } else if (e.k === 'stand') {
        const nm = e.o.name || 'the other boat';
        if (this.standKey !== nm || t - (this.lastSaid.stand ?? -1e9) > 30) { this.standKey = nm; this.say('stand', `Standing on: ${nm} must keep clear of us (${RULE_SHORT[e.rule] || 'rule ' + e.rule}), so we hold our course${e.danger ? ' — and she is cutting it fine' : ''}.`, t); }
      }
    }
    // the point of sailing, once it has held for a few seconds (the tactician's mode, the reach's own angle)
    const m = this.mode, tw = Math.abs(wrap(twd - (h.desired ?? b.psi)));
    // (a reach held close-hauled, the mark just past the layline, is still the beat)
    const key = m === 'reach' ? (tw < this.up + 10 * DEG ? 'beat' : tw > this.dn - 8 * DEG ? 'run' : 'reach:' + pointOf(Math.max(tw, 52 * DEG))) : m;
    if (key !== this.keySeen) { this.keySeen = key; this.keyT = t; }
    const first = this.keySaid === null;
    if (key !== this.keySaid && (t - this.keyT > (first ? 0.6 : 3) || ['penalty', 'capsized'].includes(m))) {
      const prevTw = this.keyTw; this.keySaid = key; this.keyTw = tw;
      // (rounding a mark the point of sailing changes by the second: the rounding's own line says it)
      const rr = this.o && this.o.racer, CC = this.o && this.o.course, lg = rr && CC && CC.legs[rr.leg];
      const atMark = lg && lg.type === 'mark' && this.markSaid === rr.leg && Math.hypot(lg.mark.x - b.x, lg.mark.z - b.z) < 6 * b.cls.loa + 30;
      if (!atMark) this.sayMode(key.split(':')[0], tw, prevTw, first, t, brg, twd);
    }
    // mark rounding (racing)
    const r = this.o && this.o.racer, C = this.o && this.o.course;
    if (r && C && !r.finished && C.legs[r.leg] && C.legs[r.leg].type === 'mark') {
      const mk = C.legs[r.leg].mark, dm = Math.hypot(mk.x - b.x, mk.z - b.z);
      if (this.markSaid !== r.leg && dm < 6 * b.cls.loa + 20) { this.markSaid = r.leg; this.say('mark', `Rounding the ${C.legs[r.leg].name.toLowerCase()} to port: we come in a length and a half wide of it, then bear away round it once we're above it.`, t); }
      if (h.overMark && !this.overSaid) this.say('mark', 'Above the mark: bearing away round it.', t);
      this.overSaid = h.overMark;
    }
    if (r && r.finished && !this.finSaid) { this.finSaid = true; this.say('fin', 'Finished: sailing clear of the line and the boats still finishing.', t); }
    if (m === 'prestart' && h.psPhase !== this.psSaid) {
      this.psSaid = h.psPhase;
      const clk = sim.race ? -sim.race.clock : 0;
      if (h.psPhase === 'run') this.say('pre', `Going for the line: ${Math.round(clk)} s to the gun, timing the run to cross it at speed as it fires.`, t);
      else this.say('pre', 'Pre-start: holding below the line, reaching to and fro until it is time to go.', t);
    }
    // wind shifts on the beat: head up in a lift, bear away in a header (the other tack gains)
    if (m === 'beat' && this.keySaid === 'beat' && t - this.keyT > 10 && h.twdMean !== null && !turned) {
      const tack = Math.sign(wrap(twd - b.psi)) || 1, sh = tack > 0 ? wrap(twd - h.twdMean) : -wrap(twd - h.twdMean);
      if (Math.abs(sh) < 3 * DEG) this.shiftArm = 0;
      else if (Math.abs(sh) > 7 * DEG && Math.abs(sh) < 30 * DEG && this.shiftArm !== Math.sign(sh)) {
        this.shiftArm = Math.sign(sh);
        if (sh > 0) this.say('shift', `Lifted ${dg(sh)}°: the wind has swung aft on this tack, so we head up with it and point closer to ${this.tn()}.`, t, 20);
        else this.say('shift', `Headed ${dg(sh)}°: the wind has swung toward the bow, so we bear away with it${Math.abs(sh) > 8 * DEG ? ' — the other tack is lifted now' : ''}.`, t, 20);
      }
    }
  }
  sayMode(m, tw, prevTw, first, t, brg, twd) {
    const b = this.b, up = this.up, dn = this.dn, rel = Math.abs(wrap(brg - twd)), tn = this.tn(), T = cap(tn);
    const verb = !first && prevTw !== undefined ? (tw > prevTw + 8 * DEG ? 'Bearing away' : tw < prevTw - 8 * DEG ? 'Heading up' : null) : null;
    const sheets = verb === 'Bearing away' ? 'easing the main and jib' : 'trimming the main and jib in';
    if (m === 'beat') this.say('mode', `${verb === 'Heading up' ? `Heading up to close-hauled: ${sheets}. ` : ''}Beating to ${tn}: it's ${dg(rel)}° off the wind, inside the no-go zone, so we sail close-hauled at ${dg(up)}° and tack on the layline.`, t);
    else if (m === 'reach') {
      const corr = Math.abs(this.helm.tideCorr ?? 0) > 3 * DEG ? `, aiming ${dg(this.helm.tideCorr)}° up-tide so the track, not the bow, points at it` : '';
      this.say('mode', verb ? `${verb} to a ${pointOf(Math.max(tw, 52 * DEG))}: ${sheets}. ${T} is ${dg(rel)}° off the wind${corr}.` : `Reaching to ${tn}: it's ${dg(rel)}° off the wind, outside the no-go zone, so we sail straight for it on a ${pointOf(Math.max(tw, 52 * DEG))}${corr}.`, t);
    } else if (m === 'run') this.say('mode', `${verb === 'Bearing away' ? 'Bearing away to a run: easing the main and jib right out. ' : ''}Running to ${tn}: it's ${dg(Math.PI - rel)}° from dead downwind. Dead downwind is slow and rolly, so we sail ${dg(dn)}° off the wind and gybe on the layline.`, t);
    else if (m === 'penalty') { const p = this.sim.rules && this.sim.rules.penaltyOf(b); this.say('mode', `Taking the penalty: first clear of the other boats, then ${p && p.turns === 1 ? 'one turn' : 'two turns'} the same way round, each a tack and a gybe.`, t); }
    else if (m === 'capsized') this.say('mode', 'Capsized: sheets eased, standing on the board to right her.', t);
  }

  // ---------------------------------------------------------------- what she plans: numbers for the HUD, lines for the chart
  plan(sim) {
    const b = this.b, h = this.helm, twd = waterTwd(b), up = this.up, dn = this.dn;
    const desired = h.desired ?? b.psi, twa = Math.abs(wrap(twd - desired));
    // (as the coach has it: a reach held close-hauled is the beat, one at the run's angle the run)
    const m = this.mode === 'reach' ? (twa < up + 10 * DEG ? 'beat' : twa > dn - 8 * DEG ? 'run' : 'reach') : this.mode;
    const info = { mode: m, twa, desired, next: '', track: null, lay: null };
    info.label = { beat: 'Beat', reach: 'Reach', run: 'Run', prestart: 'Pre-start', penalty: 'Penalty', 'hove-to': 'Hove to', shoot: 'Shooting up', vane: 'Wind vane', capsized: 'Capsized' }[m] || m || '';
    if (m === 'vane') { info.twa = Math.abs(this.vaneTwa ?? twa); info.next = `holding ${dg(info.twa)}° ${this.vaneTwa > 0 ? 'stbd' : 'port'}`; info.track = [[b.x, b.z], [b.x + Math.sin(desired) * 600, b.z - Math.cos(desired) * 600]]; return info; }
    const D = m === 'hove-to' || m === 'shoot' ? this.T : h.dest || this.T;
    if (!D) return info;
    const B = [b.x, b.z], dist = Math.hypot(D.x - b.x, D.z - b.z), tack = Math.sign(wrap(twd - b.psi)) || 1;
    const Tw = this.T, dtw = Tw ? Math.hypot(Tw.x - b.x, Tw.z - b.z) : dist;
    if (m === 'hove-to') { info.next = `hove to · ${Math.round(dtw)} m off`; info.twa = Math.abs(wrap(twd - b.psi)); return info; }
    const rest = this.route && !this.o.racer ? this.route.slice(1) : [];
    const tail = rest.length ? [...rest, [this.T.x, this.T.z]] : this.o.racer ? [] : D !== this.T && this.T ? [[this.T.x, this.T.z]] : [];
    const Ll = Math.max(300, dist * 1.4);
    // where this tack (gybe) meets the other one's line through the mark: the layline
    const meet = (g1, g2) => {
      const n1 = Math.hypot(...g1) || 1, n2 = Math.hypot(...g2) || 1, a = [g1[0] / n1, g1[1] / n1], c = [g2[0] / n2, g2[1] / n2];
      const dx = D.x - b.x, dz = D.z - b.z, det = a[0] * c[1] - c[0] * a[1];
      info.lay = [[D.x, D.z, D.x - a[0] * Ll, D.z - a[1] * Ll], [D.x, D.z, D.x - c[0] * Ll, D.z - c[1] * Ll]];
      if (Math.abs(det) < 1e-6) return null;
      const s = (dx * c[1] - c[0] * dz) / det, r = (a[0] * dz - dx * a[1]) / det;
      return s > 0 && r > 0 ? [s, [b.x + a[0] * s, b.z + a[1] * s]] : null;
    };
    const eta = () => { const vmc = ((b.vgx || 0) * (D.x - b.x) + (b.vgz || 0) * (D.z - b.z)) / (dist || 1); return vmc > 0.2 ? `arrive in ${mmss(dtw / vmc)}` : `${distTxt(dtw)} to go`; };
    if (m === 'beat') {
      const P = meet(h.trackVel(tack, up), h.trackVel(-tack, up));
      info.track = P ? [B, P[1], [D.x, D.z], ...tail] : [B, [D.x, D.z], ...tail];
      info.next = P ? `tack in ${distTxt(P[0])}` : 'on the layline';
      info.twa = up;
    } else if (m === 'run') {
      const hv = (s) => [Math.sin(twd - s * dn), -Math.cos(twd - s * dn)];
      const P = meet(hv(tack), hv(-tack));
      info.track = P ? [B, P[1], [D.x, D.z], ...tail] : [B, [D.x, D.z], ...tail];
      info.next = P ? `gybe in ${distTxt(P[0])}` : 'on the layline';
      info.twa = dn;
    } else {
      info.track = [B, [D.x, D.z], ...tail];
      info.next = m === 'prestart' && sim.race ? `gun in ${mmss(Math.max(0, -sim.race.clock))}` : m === 'penalty' ? 'turning' : eta();
    }
    if (this.route && !this.o.racer && m !== 'shoot') info.next += ` · ${this.route.length} legs`;
    info.dtw = dtw;
    return info;
  }
  // the plan on a chart: P(x, z) -> [px, py], lw a pixel in its units, dark: a dark map (the minimap)
  drawPlan(ctx, P, lw, dark) {
    const I = this.info; if (!this.engaged || !I) return;
    ctx.save();
    if (I.lay) {
      ctx.strokeStyle = dark ? 'rgba(242,179,61,.8)' : 'rgba(200,120,10,.85)'; ctx.lineWidth = 1.4 * lw; ctx.setLineDash([6 * lw, 4 * lw]);
      for (const [x0, z0, x1, z1] of I.lay) { const [ax, ay] = P(x0, z0), [bx, by] = P(x1, z1); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    }
    if (I.track) {
      ctx.setLineDash([]); ctx.lineWidth = 2.4 * lw; ctx.strokeStyle = dark ? 'rgba(95,227,154,.95)' : 'rgba(19,138,79,.95)';
      ctx.beginPath(); I.track.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      for (let i = 1; i < I.track.length - 1; i++) { const [px, py] = P(I.track[i][0], I.track[i][1]); ctx.beginPath(); ctx.arc(px, py, 3.5 * lw, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
