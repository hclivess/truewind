// Shared world over WebRTC (peer-to-peer). Peers find each other through public Nostr relays via
// Trystero, so a static site (GitHub Pages) needs no game server.
//
// Model:
//  * One room per venue + room name. Conditions (wind seed, speed, direction, puffs, shifts, swell,
//    current) and the clock epoch come from the earliest arrival; everyone converges on them.
//    Wind and waves are deterministic functions of (seed, position, time), so every browser
//    sees the same puffs, shifts and waves at the same moment.
//  * Each browser is authoritative for its own boat and streams its state at 10 Hz.
//  * Remote boats are re-simulated locally from their control inputs (so sails, heel and trim
//    look right) and continuously pulled toward the dead-reckoned remote state.
import { Boat, CLASSES, wrap, lerp, clamp } from './physics.js';

const TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.25.4/+esm';
const APP_ID = 'truewind-sailing-sim-v1';
const CTRL_KEYS = ['helm', 'main', 'jib', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibLead', 'jibHalyard', 'tackLine', 'board', 'reef', 'crewAft', 'lazy', 'pushBoom'];

export class Net {
  constructor(game) {
    this.g = game;
    this.peers = new Map();   // peerId -> { name, cls, boat, pkt, pktAt, color }
    this.connected = false;
    this.since = Date.now();  // our arrival time; earliest arrival owns the conditions
    this.sendAcc = 0;
    this.status = 'offline';
  }

  async connect({ venueId, room, name, cls, cond }) {
    this.status = 'connecting';
    const mod = await import(TRYSTERO);
    this.selfId = mod.selfId;
    this.name = (name || 'Sailor').slice(0, 20);
    this.cls = cls;
    this.cond = cond;          // { seed, epoch, tws, twd, gust, shift, swell, current, currentDir }
    this.condSince = this.since;
    const r = this.room = mod.joinRoom({ appId: APP_ID }, `${venueId}:${(room || 'public').toLowerCase()}`);
    const act = (name) => {
      const a = r.makeAction(name);
      if (Array.isArray(a)) return { send: a[0], on: (cb) => a[1]((d, peerId) => cb(d, peerId)) };
      return { send: (d, o) => a.send(d, o), on: (cb) => { a.onMessage = (d, meta) => cb(d, meta && meta.peerId !== undefined ? meta.peerId : meta); } };
    };
    this.aHello = act('hello'); this.aState = act('state'); this.aCond = act('cond'); this.aRace = act('race'); this.aBye = act('bye');
    this.aHello.on((d, id) => this.onHello(d, id));
    this.aState.on((d, id) => this.onState(d, id));
    this.aCond.on((d, id) => this.onCond(d, id));
    this.aRace.on((d, id) => this.g.onNetRace(d, id));
    this.aBye.on((d, id) => this.dropPeer(id));
    const join = (id) => {
      this.aHello.send(this.helloMsg(), { target: id });
      this.aCond.send({ cond: this.cond, since: this.condSince }, { target: id });
      if (this.g.sharedRace) this.aRace.send(this.g.sharedRace, { target: id });
    };
    const leave = (id) => this.dropPeer(id);
    r.onPeerJoin = join; r.onPeerLeave = leave;
    this.connected = true;
    this.status = 'online';
    window.addEventListener('beforeunload', () => { try { this.aBye.send({}); r.leave(); } catch (e) {} });
  }

  helloMsg() { return { name: this.name, cls: this.cls, v: 1 }; }

  disconnect() {
    try { this.aBye && this.aBye.send({}); this.room && this.room.leave(); } catch (e) {}
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.connected = false; this.status = 'offline';
  }

  onHello(d, id) {
    let p = this.peers.get(id);
    if (!p) {
      p = { name: d.name || 'Sailor', cls: CLASSES[d.cls] ? d.cls : 'sportboat', boat: null, pkt: null };
      this.peers.set(id, p);
      this.g.hud.toast(`${p.name} joined`, 2);
    } else { p.name = d.name || p.name; }
  }

  onCond(d, id) {
    // the earliest arrival's conditions win; adopt and re-announce so the room converges
    if (!d || !d.cond) return;
    if (d.since < this.condSince - 1) {
      this.condSince = d.since; this.cond = d.cond;
      this.g.applySharedConditions(d.cond);
    }
  }

  onState(d, id) {
    let p = this.peers.get(id);
    if (!p) { p = { name: d.n || 'Sailor', cls: CLASSES[d.c] ? d.c : 'sportboat', boat: null, pkt: null }; this.peers.set(id, p); }
    if (!p.boat || p.boat.cls.id !== d.c) {
      if (p.boat) this.g.removeRemoteBoat(p.boat);
      p.cls = CLASSES[d.c] ? d.c : 'sportboat';
      // (re-simulated here with the fleet's sail model and level: cloth at L1 unless this machine cannot)
      const b = new Boat(p.cls, { id: 'net-' + id, name: p.name, sailModel: this.g.sailModel, lod: this.g.fleetSailLevel() });
      b.remote = true; b.auto.hike = false; b.auto.trim = false;
      b.reset(d.x, d.z, d.psi);
      p.boat = b;
      this.g.addRemoteBoat(b);
    }
    p.boat.name = p.name = d.n || p.name;
    p.pkt = d; p.pktAt = performance.now();
  }

  dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.boat) this.g.removeRemoteBoat(p.boat);
    this.peers.delete(id);
    this.g.hud.toast(`${p.name} left`, 2);
  }

  // stream our boat
  update(dt, me, raceInfo) {
    if (!this.connected || !me) return;
    this.sendAcc += dt;
    if (this.sendAcc < 0.1) return;
    this.sendAcc = 0;
    const c = {};
    for (const k of CTRL_KEYS) c[k] = typeof me.ctrl[k] === 'number' ? Math.round(me.ctrl[k] * 1000) / 1000 : me.ctrl[k];
    c.gen = !!me.ctrl.gen;
    const q = (v, s = 100) => Math.round(v * s) / s;
    const booms = {}; for (const k in me.booms) booms[k] = q(me.booms[k].a, 1000);
    this.aState.send({
      n: this.name, c: me.cls.id, t: q(this.g.t, 1000),
      x: q(me.x), z: q(me.z), psi: q(me.psi, 1000), u: q(me.u), v: q(me.v), r: q(me.r, 1000), phi: q(me.phi, 1000), p: q(me.p, 1000),
      cy: q(me.crewY), cx: q(me.crewX), rud: q(me.rudder, 1000), gd: q(me.genDeploy), gf: q(me.genFill), sj: q(me.side.jib), sg: q(me.side.gennaker),
      rf: q(me.reefPos),
      b: booms, ctrl: c, cap: me.capsized ? 1 : 0, race: raceInfo || null,
    });
  }

  // before each physics step: feed remote inputs; after: pull toward the dead-reckoned remote state
  preStep() {
    for (const p of this.peers.values()) {
      const b = p.boat, d = p.pkt; if (!b || !d) continue;
      for (const k of CTRL_KEYS) if (d.ctrl[k] !== undefined) b.ctrl[k] = d.ctrl[k];
      b.ctrl.gen = !!d.ctrl.gen; b.ctrl.hike = 0;
    }
  }
  postStep(dt) {
    const k = 1 - Math.exp(-dt * 2.5);
    for (const p of this.peers.values()) {
      const b = p.boat, d = p.pkt; if (!b || !d) continue;
      const age = Math.min(1.5, (performance.now() - p.pktAt) / 1000);
      // dead reckoning of the remote boat to "now"
      const psi = d.psi + d.r * age;
      const fx = Math.sin(psi), fz = -Math.cos(psi), sx = Math.cos(psi), sz = Math.sin(psi);
      const cur = this.g.env.current.at(d.x, d.z, {});
      const x = d.x + (d.u * fx + d.v * sx + cur.x) * age, z = d.z + (d.u * fz + d.v * sz + cur.z) * age;
      const err = Math.hypot(x - b.x, z - b.z);
      const kk = err > 25 ? 1 : k;
      b.x += (x - b.x) * kk; b.z += (z - b.z) * kk;
      b.psi = wrap(b.psi + wrap(psi - b.psi) * kk);
      b.u = lerp(b.u, d.u, kk); b.v = lerp(b.v, d.v, kk); b.r = lerp(b.r, d.r, kk);
      b.phi = lerp(b.phi, d.phi, kk); b.p = lerp(b.p, d.p, kk);
      b.crewY = d.cy; b.crewX = d.cx; b.rudder = lerp(b.rudder, d.rud, 0.5);
      b.genDeploy = d.gd; b.genFill = lerp(b.genFill, d.gf, kk); b.side.jib = d.sj; b.side.gennaker = d.sg;
      for (const key in d.b) if (b.booms[key]) b.booms[key].a = lerp(b.booms[key].a, d.b[key], Math.max(kk, 0.3));
      // the reef as the owner has it (a cloth main is rebuilt for it), and cloth sails kept on the owner's side
      if (d.rf !== undefined) b.reefPos = d.rf;
      if (b.sailSys && b.sailSys.active(b)) b.sailSys.follow(b, { booms: d.b, jib: d.sj, gennaker: d.sg }, dt);
      b.capsized = !!d.cap;
      b.netRace = d.race;
    }
  }

  broadcastRace(msg) { if (this.connected) this.aRace.send(msg); }
  get count() { return this.peers.size + 1; }
}
