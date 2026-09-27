// Seamanship in the game: wires damage (js/damage.js), anchoring (anchor.js), mooring lines (mooring.js), man
// overboard (mob.js) and crew fatigue (fatigue.js) into the loop, the keys, the rig panel's "Boat" section, the
// alerts, the chart's MOB mark and a race's retirements. Every boat gets damage and fatigue (the AI fleet too:
// deterministic, seeded by the race); the player's boat also gets the anchor, the lines and the MOB drill.
// Keys: U anchor (drop / weigh), B lines (make fast alongside or to a mooring buoy / cast off), 0 MOB (the plotter's
// man-overboard button: marks the spot and steers for it).
import { DEG, KT } from './env.js';
import { Damage, makeSeabed, contactImpact, impactPair, recomputeMass } from './damage.js';
import { Anchor } from './anchor.js';
import { Mooring } from './mooring.js';
import { MOB } from './mob.js';
import { Fatigue } from './fatigue.js';
import { pref } from './hud.js';

const $ = (s) => document.querySelector(s);
const pct = (v) => `${Math.round(v * 100)}%`;

export class Gear {
  constructor(game) {
    this.g = game;
    this.seabed = () => 'sand';
    this.mooringBuoys = [];        // (mooring buoys, when a venue or the traffic has them: { x, z })
    this._pairs = new Set();
    this.alertMsg = null;
  }
  get mode() { return this.g.settings.damage === 'off' ? 'off' : 'realistic'; }

  // ------------------------------------------------------------------ session
  setSession() {
    const g = this.g;
    const beaches = (g.renderer && g.renderer.town && g.renderer.town.userData && g.renderer.town.userData.beaches) || [];
    this.seabed = makeSeabed(g.world, g.venue, (g.nav && g.nav.marks) || [], beaches);
    this.seed = (g.cond && g.cond.seed) || 1;
    for (const b of g.boats) this.attach(b);
    this.alertMsg = null;
    if (g.nav) {
      g.nav.overlays = (g.nav.overlays || []).filter((o) => o.id !== 'mob');
      g.nav.overlays.push({ id: 'mob', chart: (ctx, P) => this.drawChartMOB(ctx, P), mini: (ctx, lw) => this.drawMiniMOB(ctx, lw) });
    }
  }
  // (the beaches arrive with the scenery, after the session starts)
  refreshSeabed() {
    const g = this.g, beaches = g.renderer && g.renderer.town && g.renderer.town.userData && g.renderer.town.userData.beaches;
    if (beaches && beaches.length && !this._beachesSet) { this._beachesSet = true; this.seabed = makeSeabed(g.world, g.venue, (g.nav && g.nav.marks) || [], beaches); }
  }
  attach(b, opts = {}) {
    const g = this.g, id = typeof b.id === 'number' ? b.id : String(b.id).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
    b.ext = { X: 0, Y: 0, N: 0, K: 0 };
    b.dmg = new Damage(b, { seed: this.seed * 131 + id, mode: this.mode, remote: !!(opts.remote || b.remote) });
    if (!b.remote) b.fat = new Fatigue(b);
    if (b === g.player) {
      b.anchor = new Anchor(b);
      b.moor = new Mooring(b);
      b.mob = new MOB(b, { seed: this.seed * 977 + 13 });
    }
    b.lights = b.lights || {};
  }
  setMode(m) {
    this.g.settings.damage = m;
    pref('tw-settings', JSON.stringify(this.g.settings));
    for (const b of this.g.boats) if (b.dmg) b.dmg.mode = m;
    this.g.hud.toast(m === 'off' ? 'Damage off — nothing breaks' : 'Damage realistic — loads break gear, hulls hole, boats sink', 2.5);
  }

  // ------------------------------------------------------------------ loop
  preStep(dt) {
    const g = this.g, ctx = { world: g.world, env: g.env, t: g.t, seabed: this.seabed };
    this._pairs.clear();
    for (const b of g.boats) {
      if (!b.ext) continue;
      const E = b.ext; E.X = 0; E.Y = 0; E.N = 0; E.K = 0;
      if (b.dmg) b.dmg.pre(dt, E, g.env, g.t);
      if (b.anchor) b.anchor.pre(dt, E, ctx);
      if (b.moor) b.moor.pre(dt, E);
      // the crew drops the sails at anchor and alongside, and sets them again when leaving
      const rest = (b.anchor && b.anchor.down && b.anchor.state !== 'weighing') || (b.moor && b.moor.tied);
      b.furl = Math.max(0, Math.min(1, (b.furl || 0) + (rest ? dt / 20 : -dt / 25)));
      if (b.furl === 0) b.furl = undefined;
      if (b.unmanned) { b.ctrl.helm *= Math.exp(-dt / 2); }   // the tiller swings free
    }
  }
  postStep(dt) {
    const g = this.g, ctx = { world: g.world, env: g.env, t: g.t, seabed: this.seabed };
    for (const b of g.boats) {
      if (b.dmg) b.dmg.post(dt, ctx);
      if (b.mob) b.mob.post(dt, ctx);
      if (b.fat) b.fat.post(dt, b.anchor && b.anchor.state === 'weighing' ? b.anchor.work || 0 : 0);
      if (b.anchor) b.anchor.post(dt, ctx);
      if (b.furl > 0.8) b.hikeLimit = 0.02;              // sails down, at rest: the crew sits in
    }
    this.drainEvents();
  }
  // a contact from resolveCollisions (js/race.js)
  onContact(b, other, v, nx, nz) {
    if (!b.dmg || nx === undefined) return;
    if (other && other.cls) {
      const key = [b.id, other.id].sort().join('|');
      if (this._pairs.has(key)) return;             // (each pair once a step: its energy is split between the two)
      this._pairs.add(key);
      impactPair(b, other, v, nx, nz);
      return;
    }
    const I = contactImpact(b, other, v, nx, nz);
    b.dmg.impact(I.E, I);
  }

  // ------------------------------------------------------------------ events -> toasts, alerts, race
  drainEvents() {
    const g = this.g, P = g.player;
    for (const b of g.boats) {
      const mine = b === P;
      for (const src of [b.dmg, b.anchor, b.moor, b.mob]) {
        if (!src || !src.events.length) continue;
        for (const ev of src.events.splice(0)) {
          if (mine) {
            g.hud.toast(ev.msg, ev.bad ? 4 : 2.5);
            if (ev.type === 'dismast' || ev.type === 'holed' || ev.type === 'keel') g.audio.thump && g.audio.thump(1);
            if (ev.type === 'mob' && b.mob && b.mob.mark) this.markMOB(b.mob.mark.x, b.mob.mark.z, true);
            if (ev.type === 'recovered' && b.mob && !b.mob.people.length && this.mobMark) {
              this.mobMark = null;
              if (g.waypoint && g.waypoint.kind === 'mob') { g.waypoint = null; g.onWaypoint(); }
            }
          } else if (ev.type === 'dismast' || ev.type === 'sunk') g.hud.toast(`${b.name}: ${ev.msg.split(' —')[0].toLowerCase()}`, 2.5);
        }
      }
      // a race: dismasted, sinking, keel or rudder gone -> retired
      if (g.race && b.dmg && !b._retired && b.dmg.retire()) {
        const r = g.race.racers.find((x) => x.boat === b);
        if (r && !r.finished) { r.retired = true; b._retired = true; if (mine) g.hud.toast('Retired from the race (RET)', 4); }
      }
    }
  }
  // the alert line: the most urgent state of the player's boat
  alert() {
    const b = this.g.player; if (!b || !b.dmg) return null;
    const D = b.dmg;
    if (D.hull.sunk) return { msg: 'Sunk. Esc for the menu', bad: true };
    if (b.mob && b.mob.people.length) {
      const P = b.mob.people[0], d = Math.hypot(P.x - b.x, P.z - b.z), brg = Math.round(((Math.atan2(P.x - b.x, -(P.z - b.z)) / DEG) + 360) % 360);
      return { msg: b.unmanned ? `In the water — the boat is ${Math.round(d)} m off. Swimming…` : `MAN OVERBOARD ${Math.round(d)} m · ${String(brg).padStart(3, '0')}° — come alongside slowly, stop within 2 m`, bad: true };
    }
    if (D.inflow > 1e-4 || D.water > 20) return { msg: `Taking water: ${Math.round(D.inflow * 60000)} L/min in, pumps ${Math.round(D.pumpOut * 60000)} L/min · ${Math.round(D.water)} L aboard`, bad: D.inflow > D.pumpOut };
    if (D.rig.down) return { msg: D.rig.cut ? 'Dismasted — rig cut away' : 'Dismasted — the rig is over the side dragging her: cut it away (Boat panel)', bad: true };
    if (D.hull.keelLost) return { msg: 'Keel gone — she is on her side', bad: true };
    if (b.anchor && b.anchor.dragging) return { msg: `Anchor dragging in ${b.anchor.bed} — let out more scope or re-anchor`, bad: true };
    if (b.anchor && b.anchor.state !== 'up') return { msg: b.anchor.state === 'weighing' ? 'Weighing anchor' : `At anchor in ${b.anchor.bed} — U to weigh`, bad: false };
    if (b.moor && b.moor.tied) return { msg: b.moor.kind === 'buoy' ? 'On the mooring — B to slip it' : 'Alongside — B to cast off', bad: false };
    return null;
  }

  // ------------------------------------------------------------------ keys and actions
  onKey(k, e) {
    if (k === 'u') { this.anchorAction(); return true; }
    if (k === 'b') { this.linesAction(); return true; }
    if (k === '0') { this.mobButton(); return true; }
    return false;
  }
  anchorAction() {
    const g = this.g, b = g.player, A = b.anchor;
    if (!A || !A.has) { g.hud.toast(A && A.lost ? 'The anchor is lost' : `No anchor aboard a ${b.cls.name}`, 1.8); return; }
    if (A.state === 'up') {
      const sog = Math.hypot(b.vgx || 0, b.vgz || 0);
      if (sog > 1.2 * KT) { g.hud.toast(`${(sog / KT).toFixed(1)} kn is too fast to anchor — head up, stop, then drop it and fall back`, 2.2); return; }
      const depth = g.world.depthAt(b.x, b.z);
      if (depth > A.spec.chain.L + A.spec.rope.L - 2) { g.hud.toast(`${depth.toFixed(0)} m is too deep for ${A.spec.chain.L + A.spec.rope.L} m of rode`, 2.2); return; }
      if (b.moor && b.moor.tied) { g.hud.toast('Alongside — cast off first (B)', 1.6); return; }
      A.drop(g.world);
    } else if (A.state === 'weighing') { A.state = 'down'; g.hud.toast('Stopped hauling', 1.4); }
    else A.weigh();
  }
  linesAction() {
    const g = this.g, b = g.player, M = b.moor; if (!M) return;
    if (M.tied) { M.castOff(); return; }
    const sog = Math.hypot(b.vgx || 0, b.vgz || 0);
    const dock = M.findDock(g.obstacles || []), buoy = M.findBuoy(this.mooringBuoys);
    if (!dock && !buoy) { g.hud.toast('No dock or mooring within reach — come alongside (within ~3 m)', 2); return; }
    if (sog > 0.9) { g.hud.toast('Too fast to get a line on — stop alongside first', 1.8); return; }
    if (buoy && (!dock || buoy.d < dock.gap)) M.tieBuoy(buoy); else M.tieDock(dock);
  }
  // the plotter's MOB button: marks where the boat is (or where the person went in) and steers for it
  mobButton() {
    const g = this.g, b = g.player;
    const P = b.mob && b.mob.people[0];
    this.markMOB(P ? P.x0 : b.x, P ? P.z0 : b.z, false);
  }
  markMOB(x, z, auto) {
    const g = this.g;
    this.mobMark = { x, z, t: g.t };
    if (!g.race) { g.waypoint = { x, z, kind: 'mob', ghost: true, name: 'MOB', color: 0xff2a2a, label: 'MOB' }; g.onWaypoint(); }
    g.hud.toast(auto ? 'MOB marked on the plotter — steering back' : 'MOB mark set — Tab for the chart', 2.2);
  }
  pump(on) { const D = this.g.player.dmg; D.pumping = on ?? !D.pumping; this.g.hud.toast(D.pumping ? 'Pumping' : 'Pumps off', 1.2); }
  cutAway() { const D = this.g.player.dmg; if (D.rig.down) { D.cutAway(); } }

  // ------------------------------------------------------------------ chart: the MOB mark and the people in the water
  drawChartMOB(ctx, P) {
    const b = this.g.player; if (!b) return;
    const M = this.mobMark;
    if (M) {
      const [x, y] = P(M.x, M.z);
      ctx.strokeStyle = '#d0102a'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
      ctx.fillStyle = '#d0102a'; ctx.font = '700 12px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left';
      const d = Math.hypot(M.x - b.x, M.z - b.z), brg = Math.round(((Math.atan2(M.x - b.x, -(M.z - b.z)) / DEG) + 360) % 360);
      ctx.fillText(`MOB ${Math.round(d)} m ${String(brg).padStart(3, '0')}°  +${fmtT(this.g.t - M.t)}`, x + 12, y + 4);
    }
    if (b.mob) for (const p of b.mob.people) {
      const [x, y] = P(p.mx, p.mz);
      ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();   // the danbuoy (its AIS / strobe)
    }
  }
  drawMiniMOB(ctx, lw) {
    const M = this.mobMark; if (!M) return;
    ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 2 * lw;
    ctx.beginPath(); ctx.arc(M.x, M.z, 7 * lw, 0, Math.PI * 2); ctx.moveTo(M.x - 5 * lw, M.z - 5 * lw); ctx.lineTo(M.x + 5 * lw, M.z + 5 * lw); ctx.moveTo(M.x + 5 * lw, M.z - 5 * lw); ctx.lineTo(M.x - 5 * lw, M.z + 5 * lw); ctx.stroke();
  }

  // ------------------------------------------------------------------ the rig panel's "Boat" section
  buildPanel(b) {
    const body = $('#rig-body'); if (!body) return;
    const old = document.getElementById('gear-rg'); if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'rg'; el.id = 'gear-rg';
    const hasA = b.anchor && b.anchor.has;
    el.innerHTML = `<h3>Boat <span class="muted" style="font-weight:500;letter-spacing:.02em;text-transform:none">damage · crew</span><button class="chip" id="g-mode" title="Damage: realistic (loads break gear) or off">Damage</button></h3>
      <div class="dmg" id="g-rows"></div>
      <div class="toggles acts">${hasA ? '<button class="chip" id="g-anchor" title="Drop / weigh the anchor (U)">Anchor</button>' : ''}<button class="chip" id="g-lines" title="Make fast alongside or to a mooring / cast off (B)">Lines</button><button class="chip mob" id="g-mob" title="Man overboard: mark the spot on the plotter (0)">MOB</button><button class="chip" id="g-pump" hidden>Pump</button><button class="chip" id="g-cut" hidden>Cut away rig</button></div>`;
    body.appendChild(el);
    $('#g-mode').addEventListener('click', () => this.setMode(this.mode === 'off' ? 'realistic' : 'off'));
    if (hasA) $('#g-anchor').addEventListener('click', () => this.anchorAction());
    $('#g-lines').addEventListener('click', () => this.linesAction());
    $('#g-mob').addEventListener('click', () => this.mobButton());
    $('#g-pump').addEventListener('click', () => this.pump());
    $('#g-cut').addEventListener('click', () => this.cutAway());
    this._rowsHtml = '';
  }
  updatePanel() {
    const g = this.g, b = g.player; if (!b || !b.dmg) return;
    const rows = document.getElementById('g-rows'); if (!rows) return;
    const D = b.dmg, C = b.cls, F = b.fat;
    const mode = document.getElementById('g-mode');
    if (mode) { mode.textContent = this.mode === 'off' ? 'Damage: off' : 'Damage: realistic'; mode.classList.toggle('on', this.mode !== 'off'); }
    let h = '';
    const cls = (r) => (r > 0.85 ? 'bad' : r > 0.6 ? 'warn' : '');
    // rig: the most loaded part, its load and peak as % of its breaking load (a mast: of its yield moment)
    if (D.rig.down) h += `<span>Rig</span><b class="bad">${D.rig.cut ? 'dismasted, cut away' : 'dismasted — over the side'}</b>`;
    else if (D.worst && D.parts[D.worst]) { const p = D.parts[D.worst]; h += `<span>Rig</span><b class="${cls(p.r)}" title="${p.spec}">${p.name} ${pct(p.r)}<small> peak ${pct(p.peak)}${p.D > 0.01 ? ` · wear ${pct(p.D)}` : ''}</small></b>`; }
    else h += `<span>Rig</span><b>–</b>`;
    // sails
    const sl = [];
    for (const s of C.sails) {
      const S = D.sails[s.key]; if (!S) continue;
      const nm = { main: 'main', jib: 'jib', stay: 'stays’l', gennaker: C.id === 'cat' ? 'kite' : 'genn.' }[s.key] || s.key;
      if (S.blown && !D.rig.down) sl.push(`<em class="bad">${nm} blown out</em>`);
      else if (S.tear > 0 && !D.rig.down) sl.push(`<em class="warn">${nm} torn ${pct(S.tear)}</em>`);
      else if (S.D > 0.3 && !D.rig.down) sl.push(`<em>${nm} worn ${pct(S.D)}</em>`);
    }
    h += `<span>Sails</span><b>${D.rig.down ? '<em class="bad">gone with the rig</em>' : sl.length ? sl.join(' · ') : 'sound'}</b>`;
    // hull, water, steering, keel
    const H = D.hull;
    let hull = H.pts > 0.02 ? `damaged ${pct(H.pts)}` : 'sound';
    if (H.holes.length) hull += ` · ${H.holes.length} hole${H.holes.length > 1 ? 's' : ''} ${Math.round(H.holes.reduce((a, o) => a + o.A, 0) * 1e4)} cm²`;
    h += `<span>Hull</span><b class="${H.holes.length ? 'bad' : H.pts > 0.2 ? 'warn' : ''}">${hull}</b>`;
    if (D.water > 1 || D.inflow > 0) h += `<span>Bilge</span><b class="${D.inflow > D.pumpOut ? 'bad' : 'warn'}">${Math.round(D.water)} L · in ${Math.round(D.inflow * 60000)} L/min · out ${Math.round(D.pumpOut * 60000)}</b>`;
    if (H.rudder > 0) h += `<span>Rudder</span><b class="bad">${H.rudderLost ? 'lost' : `stock bent · ${pct(1 - (b.rudderLim ?? 1))} of the helm gone`}</b>`;
    if (H.keelD > 0.05) h += `<span>Keel</span><b class="${H.keelLost ? 'bad' : 'warn'}">${H.keelLost ? (D.H.board ? 'board broken' : 'lost') : `strained ${pct(H.keelD)}`}</b>`;
    if (b.anchor && b.anchor.state !== 'up') {
      const A = b.anchor;
      h += `<span>Anchor</span><b class="${A.dragging ? 'bad' : ''}">${A.state === 'falling' ? 'going down' : A.state === 'weighing' ? `weighing · ${Math.round(A.paid)} m out` : `${A.dragging ? 'DRAGGING' : A.setF >= 1 ? 'set' : 'setting'} · ${Math.round(A.paid)} m in ${Math.round(g.world.depthAt(A.x, A.z) * 10) / 10} m · ${Math.round(A.H || 0)} N / holds ${Math.round(A.hold)} N (${A.bed})`}</b>`;
    }
    if (b.moor && b.moor.tied) h += `<span>Lines</span><b>${b.moor.kind === 'buoy' ? 'on the mooring' : 'alongside'} · ${b.moor.lines.map((L) => Math.round(L.T)).join(' / ')} N${b.moor.fenders ? ` · fender ${Math.round(b.moor.fenders.load || 0)} N` : ''}</b>`;
    // crew: hiking reserve and work reserve, as meters
    if (F) {
      const legs = F.R, arms = F.W / 18e3;
      const crewN = Math.round(b.crewMass / C.crewEach);
      h += `<span>Crew</span><b class="crew"><i class="meter" title="Hiking / trapeze endurance"><i style="width:${Math.round(legs * 100)}%"></i></i><small>legs ${pct(legs)}</small><i class="meter" title="Grinding / hauling / pumping reserve"><i style="width:${Math.round(arms * 100)}%"></i></i><small>arms ${pct(arms)}</small>${crewN < C.crewN ? ` <em class="bad">${crewN}/${C.crewN} aboard</em>` : ''}</b>`;
    }
    if (h !== this._rowsHtml) { this._rowsHtml = h; rows.innerHTML = h; }
    const pump = document.getElementById('g-pump'); if (pump) { pump.hidden = !(D.water > 1 && D.H.pumps.length); pump.classList.toggle('on', D.pumping); }
    const cut = document.getElementById('g-cut'); if (cut) cut.hidden = !(D.rig.down && !D.rig.cut);
    const an = document.getElementById('g-anchor'); if (an) { an.textContent = b.anchor.state === 'up' ? 'Anchor' : b.anchor.state === 'weighing' ? 'Stop hauling' : 'Weigh'; an.classList.toggle('on', b.anchor.state !== 'up'); }
    const ln = document.getElementById('g-lines'); if (ln) { ln.textContent = b.moor.tied ? 'Cast off' : 'Lines'; ln.classList.toggle('on', b.moor.tied); }
    const mb = document.getElementById('g-mob'); if (mb) mb.classList.toggle('on', !!(b.mob && b.mob.people.length) || !!this.mobMark);
  }
  update(dt) {
    this.refreshSeabed();
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.2) { this._acc = 0; this.updatePanel(); }
  }
}
function fmtT(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
export { recomputeMass };
