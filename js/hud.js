// Heads-up display: instruments, rig panel (every control line + telltales + loads), tactical map,
// polar, physics readout, toasts.
import { DEG, KT } from './env.js';
import { polarSpeedAt, vmgTargets, clamp, wrap, REEF } from './physics.js';

const $ = (s) => document.querySelector(s);
const fmt = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '–');
const deg = (r) => Math.round(r / DEG);
const pad3 = (n) => String(((n % 360) + 360) % 360).padStart(3, '0');

const INST = [
  ['bsp', 'BSP', 'kn'], ['sog', 'SOG', 'kn'], ['hdg', 'HDG', '°T'], ['twa', 'TWA', '°'], ['tws', 'TWS', 'kn'], ['vmg', 'VMG', 'kn'],
  ['awa', 'AWA', '°'], ['aws', 'AWS', 'kn'], ['heel', 'HEEL', '°'], ['lee', 'LEEWAY', '°'], ['depth', 'DEPTH', 'm'], ['perf', 'POLAR', '%'],
];

export class HUD {
  constructor(game) {
    this.g = game;
    this.el = {};
    const ins = $('#instruments');
    ins.innerHTML = INST.map(([k, l, u]) => `<div class="inst" id="i-${k}"><div class="lab"><span>${l}</span><span>${u}</span></div><div class="val">–</div></div>`).join('');
    for (const [k] of INST) this.el[k] = $(`#i-${k}`);
    this.mapCanvas = $('#minimap'); this.mctx = this.mapCanvas.getContext('2d');
    this.polarCanvas = $('#polar'); this.pctx = this.polarCanvas.getContext('2d');
    this.mapRange = 700;
    this.acc = 0; this.mapAcc = 0;
    this.trail = [];
    this.polarTrail = [];
    this.mapCanvas.addEventListener('wheel', (e) => { e.preventDefault(); this.mapRange = clamp(this.mapRange * (e.deltaY > 0 ? 1.2 : 1 / 1.2), 120, 6000); }, { passive: false });
    this.mapCanvas.addEventListener('click', (e) => this.mapClick(e));
    $('#rig-toggle').addEventListener('click', () => {
      const r = $('#rig'); r.classList.toggle('collapsed');
      $('#rig-toggle').textContent = r.classList.contains('collapsed') ? 'Show' : 'Hide';
      $('#rig-toggle').setAttribute('aria-expanded', String(!r.classList.contains('collapsed')));
    });
  }

  // ------------------------------------------------------------ rig panel
  buildRig(b) {
    // read-only: every control is a real line on deck (or a key); this panel reports state
    const C = b.cls, S = b.sailBy;
    const tt = (key) => `<span class="tt" id="tt-${key}"><span class="st">·</span><span class="st">·</span><span class="st">·</span></span>`;
    const bw = C.id === 'blackwatch';
    const rows = [['main', 'Mainsheet', bw ? '#e3d6b8' : '#e8eef4']];
    if (S.main.trav) rows.push(['trav', 'Traveler', '#ff7a1a']);
    rows.push(['vang', 'Vang', '#333840'], ['cunn', 'Cunningham', bw ? '#cdb98e' : '#f2b33d'], ['outhaul', 'Outhaul', '#7fbf3f']);
    if (C.hasBackstay) rows.push(['backstay', 'Backstay', '#9b5de5']);
    if (S.stay) rows.push(['stay', 'Staysail sheet', bw ? '#d9c7a0' : '#2f6fd6']);
    if (S.jib) rows.push(['jib', S.gennaker ? 'Jib / genn. sheet' : 'Jib sheet', bw ? '#d9c7a0' : '#2f6fd6'], ['lazy', 'Lazy jib sheet', bw ? '#d9c7a0' : '#2f6fd6'], ['jibLead', 'Jib car', '#9aa1a8'], ['jibHalyard', 'Jib halyard', '#2f6fd6']);
    else rows.push(['pushBoom', 'Push boom out', '#9aa1a8']);
    if (S.gennaker) rows.push(['tackLine', 'Tack line', '#ff7a1a']);
    if (C.hasBoard) rows.push(['board', 'Daggerboard', '#f2f2ef']);
    rows.push(['hike', 'Weight on rail', '#d33f49']);
    let h = `<div class="rg"><h3>Sails ${''}</h3>`;
    h += `<div class="sl2"><span>Main</span>${tt('main')}</div>`;
    if (S.stay) h += `<div class="sl2"><span>Staysail</span>${tt('stay')}</div>`;
    if (S.jib) h += `<div class="sl2"><span id="hs-name">Jib</span>${tt('jib')}</div>`;
    if (S.gennaker) h += `<div class="sl2"><span>Gennaker</span>${tt('gennaker')}</div>`;
    h += `</div><div class="rg"><h3>Lines <span class="muted" style="font-weight:500;letter-spacing:.02em;text-transform:none">grab them on deck · 7</span></h3><div class="lines">`;
    // every control is here as press-and-hold buttons, and on deck as the real line / car / winch
    const BTN = { main: ['Trim', 'Ease'], jib: ['Trim', 'Ease'], lazy: ['Haul', 'Ease'], pushBoom: ['Port', 'Stbd'], stay: ['Trim', 'Ease'], trav: ['Windward', 'Leeward'], vang: ['−', '+'], cunn: ['−', '+'],
      outhaul: ['−', '+'], backstay: ['−', '+'], jibHalyard: ['−', '+'], jibLead: ['Fwd', 'Aft'], tackLine: ['Down', 'Ease'], board: ['Up', 'Down'], hike: ['In', 'Out'] };
    const btns = (k) => `<span class="nb"><button class="nbtn" data-k="${k}" data-d="-1">${BTN[k][0]}</button><button class="nbtn" data-k="${k}" data-d="1">${BTN[k][1]}</button></span>`;
    h += rows.map(([k, label, col]) => `<div class="ln" data-k="${k}"><i style="background:${col}"></i><span>${label}</span><b id="o-${k}"></b>${btns(k)}</div>`).join('');
    h += `<div class="ln"><i style="background:#8a5a2b"></i><span>Helm</span><b id="o-helm"></b><span class="nb"><button class="nbtn" data-k="helm" data-d="-1">Port</button><button class="nbtn" data-k="helm" data-d="1">Stbd</button></span></div>`;
    h += `</div><div class="toggles acts">`;
    if (S.main.reefs) h += `<span class="muted small">Reef</span>` + [0, 1, 2].slice(0, S.main.reefs + 1).map(r => `<button class="chip" data-reef="${r}">${['Full', '1st', '2nd'][r]}</button>`).join('') + `<b id="o-reef" class="small"></b>`;
    h += `</div><div class="toggles acts">`;
    if (S.gennaker) h += `<button class="chip" id="a-gen">Hoist gennaker</button>`;
    if (S.jib) h += `<button class="chip" id="a-fly">Let jib sheet fly</button>`;
    if (C.canCapsize) h += `<button class="chip" id="a-right">Right the boat</button>`;
    h += `<button class="chip" id="a-center">Centre helm</button>`;
    h += `</div><div class="toggles"><button class="chip" id="t-trim">Automatic trim</button><button class="chip" id="t-hike">Automatic weight</button></div></div>`;
    h += `<div class="rg"><h3>Rig loads</h3><div class="loads" id="loads"></div></div>`;
    $('#rig-body').innerHTML = h;
    this.rows = rows.map(r => r[0]);
    $('#t-trim').addEventListener('click', () => this.g.toggleAutoTrim());
    $('#t-hike').addEventListener('click', () => this.g.toggleAutoHike());
    // press and hold: the line keeps moving while the button is held
    document.querySelectorAll('#rig-body .nbtn').forEach(bt => {
      let timer = null;
      const stop = () => { clearInterval(timer); timer = null; bt.classList.remove('held'); };
      bt.addEventListener('pointerdown', (e) => { e.preventDefault(); stop(); bt.classList.add('held'); const k = bt.dataset.k, d = +bt.dataset.d; this.g.nudge(k, d, 0.05); timer = setInterval(() => this.g.nudge(k, d, 0.05), 50); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) bt.addEventListener(ev, stop);
    });
    document.querySelectorAll('#rig-body [data-reef]').forEach(btn => btn.addEventListener('click', () => this.g.setReef(+btn.dataset.reef)));
    // hovering a control's buttons lights that control up on the boat
    const hover = (el, key) => { el.addEventListener('pointerenter', () => { this.g.panelHover = key; this.g.panelHoverEl = el; }); el.addEventListener('pointerleave', () => { if (this.g.panelHover === key) { this.g.panelHover = null; this.g.panelHoverEl = null; } }); };
    document.querySelectorAll('#rig-body .ln[data-k]').forEach(row => hover(row, this.g.grabIdForKey(row.dataset.k)));
    document.querySelectorAll('#rig-body .nbtn[data-k="helm"]').forEach(btn => hover(btn, 'tiller'));
    document.querySelectorAll('#rig-body [data-reef]').forEach(btn => hover(btn, 'reef'));
    const ag = document.getElementById('a-gen'); if (ag) hover(ag, 'gen');
    const gen = $('#a-gen'); if (gen) gen.addEventListener('click', () => this.g.toggleGen());
    const fly = $('#a-fly'); if (fly) { hover(fly, 'jibtail'); fly.addEventListener('click', () => this.g.letFly()); }
    const right = $('#a-right'); if (right) right.addEventListener('click', () => this.g.rightBoat());
    $('#a-center').addEventListener('click', () => { b.ctrl.helm = 0; });
  }

  toast(msg, secs = 2.4) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), secs * 1000);
  }
  alert(msg, bad = false) {
    const a = $('#alert');
    if (!msg) { a.classList.remove('show'); this._alertMsg = null; return; }
    if (this._alertMsg === msg) return;
    this._alertMsg = msg; a.textContent = msg; a.classList.toggle('bad', bad); a.classList.add('show');
  }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    const g = this.g, b = g.player;
    if (!b) return;
    this.acc += dt; this.mapAcc += dt;
    if (this.mapAcc > 1 / 20) { this.mapAcc = 0; this.drawMap(); }
    if (this.acc < 0.1) return;
    this.acc = 0;
    const d = b.diag, C = b.cls;
    const set = (k, v, cls = '') => { const e = this.el[k]; e.querySelector('.val').innerHTML = v; e.className = 'inst ' + cls; };
    const twaDeg = deg(d.twa ?? 0);
    set('bsp', fmt(b.u / KT)); set('sog', fmt(Math.hypot(b.vgx || 0, b.vgz || 0) / KT));
    set('hdg', pad3(deg(b.psi)));
    set('twa', `${Math.abs(twaDeg)}`, twaDeg > 0 ? 'stbd' : 'port');
    set('tws', fmt((d.twsInst ?? 0) / KT));
    const tgt = g.navTarget();
    let vmg;
    if (tgt) { const brg = Math.atan2(tgt.x - b.x, -(tgt.z - b.z)); vmg = ((b.vgx || 0) * Math.sin(brg) - (b.vgz || 0) * Math.cos(brg)) / KT; this.el.vmg.querySelector('.lab span').textContent = 'VMC'; }
    else { vmg = b.u * Math.cos(d.twa ?? 0) / KT; this.el.vmg.querySelector('.lab span').textContent = 'VMG'; }
    set('vmg', fmt(vmg));
    const awaDeg = deg(d.awa ?? 0);
    set('awa', `${Math.abs(awaDeg)}`, awaDeg > 0 ? 'stbd' : 'port');
    set('aws', fmt((d.aws ?? 0) / KT));
    set('heel', `${Math.abs(deg(b.phi))}`, Math.abs(b.phi) > C.targetHeel + 8 * DEG ? 'warn' : '');
    set('lee', fmt(Math.abs(d.leeway ?? 0) / DEG));
    const depth = g.world ? g.world.depthAt(b.x, b.z) : 99;
    set('depth', depth > 99 ? '99+' : fmt(depth), depth < C.draft + 1 ? 'bad' : depth < C.draft + 3 ? 'warn' : '');
    let perf = '–';
    if (g.polar) { const ps = polarSpeedAt(g.polar, Math.abs(twaDeg)); if (ps > 0.3) perf = Math.round(100 * b.u / ps); }
    set('perf', perf, perf !== '–' && perf < 85 ? 'warn' : '');
    this.updateRig(b);
    if (!$('#physics').hidden) this.updatePhysics(b);
    this.drawPolar(b, twaDeg);
    this.updateRaceCard();
  }

  updateRig(b) {
    const d = b.diag, S = b.sailBy;
    for (const k of this.rows) {
      const o = document.getElementById('o-' + k), bar = document.getElementById('bar-' + k);
      const v = b.ctrl[k];
      let txt, frac = v;
      if (k === 'main') { txt = `${Math.abs(deg(b.booms.main.a))}° · ${Math.round(d.rig.mainLoad || 0)} N`; frac = 1 - v; }
      else if (k === 'stay') { txt = `${Math.abs(deg(b.booms.stay.a))}° · ${Math.round(d.rig.stayLoad || 0)} N`; frac = 1 - v; }
      else if (k === 'trav') txt = `${deg(S.main.trav[0] + (S.main.trav[1] - S.main.trav[0]) * v)}°`;
      else if (k === 'jib') { const s2 = b.genDeploy > 0.5 ? S.gennaker : S.jib; txt = `${deg(s2.min + (s2.max - s2.min) * b.lines.jib)}° · ${Math.round(d.rig.jibLoad || 0)} N`; frac = 1 - v; }
      else if (k === 'hike') { txt = `${fmt(Math.abs(b.crewY), 1)} m ${b.auto.hike ? 'auto' : ''}`; frac = Math.abs(b.crewY) / b.cls.crewMaxOut; }
      else if (k === 'lazy') { txt = b.backedByLazy ? `backed · ${Math.round((1 - b.lines.lazy) * 100)}%` : v > 0.95 ? 'slack' : `${Math.round((1 - v) * 100)}% in`; frac = 1 - v; }
      else if (k === 'pushBoom') { txt = v ? (v < 0 ? 'to port' : 'to starboard') : '—'; frac = Math.abs(v); }
      else if (k === 'board') txt = `${Math.round(v * 100)}% down`;
      else if (k === 'jibLead') txt = `${Math.round(v * 100)}% aft`;
      else txt = `${Math.round(v * 100)}%`;
      o.textContent = txt;
      if (bar) bar.style.setProperty('--v', `${Math.round(clamp(frac, 0, 1) * 100)}%`);
    }
    document.querySelectorAll('#rig-body [data-reef]').forEach(btn => btn.classList.toggle('on', +btn.dataset.reef === (b.ctrl.reef | 0)));
    const gen = document.getElementById('a-gen'); if (gen) { gen.textContent = b.ctrl.gen ? 'Douse gennaker' : 'Hoist gennaker'; gen.classList.toggle('on', !!b.ctrl.gen); }
    const right = document.getElementById('a-right'); if (right) right.classList.toggle('on', !!b.capsized);
    const reefEl = document.getElementById('o-reef');
    if (reefEl) reefEl.textContent = b.reefing ? `working ${Math.round(d.reefProgress * 100)}%` : '';
    const setTT = (key) => {
      const el = document.getElementById('tt-' + key); if (!el) return;
      const st = d.strips[key];
      [...el.children].forEach((c, i) => {
        const s = st[i];
        const on = (st.areaF ?? 1) > 0.3;
        const state = !on ? 0 : s.state;
        c.className = 'st ' + (state === 1 ? 'st-luff' : state === 2 ? 'st-ok' : state === 3 ? 'st-stall' : '');
        c.textContent = state === 1 ? 'LUFF' : state === 2 ? 'FLOW' : state === 3 ? 'STALL' : '·';
        c.title = ['Foot', 'Mid', 'Head'][i] + (on ? ` · α ${fmt(Math.abs(s.alpha) / DEG, 0)}°, CL ${fmt(s.cl, 2)}` : '');
      });
    };
    setTT('main'); if (S.stay) setTT('stay'); if (S.jib) setTT('jib'); if (S.gennaker) setTT('gennaker');
    document.getElementById('t-trim').classList.toggle('on', b.auto.trim);
    document.getElementById('t-hike').classList.toggle('on', b.auto.hike);
    const r = deg(b.rudder);
    document.getElementById('o-helm').textContent = `${r > 0 ? 'S' : r < 0 ? 'P' : ''}${Math.abs(r)}°`;
    const hm = Math.abs(d.helmMoment || 0);
    document.getElementById('o-helm').textContent += ` · ${hm < 15 ? 'light' : hm < 60 ? 'firm' : hm < 150 ? 'heavy' : 'fighting'}`;
    const L = d.rig;
    const N = (v) => `${Math.round(v || 0)} N`;
    document.getElementById('loads').innerHTML =
      `<span>Mainsheet</span><b>${N(L.mainLoad)}</b>` +
      (S.jib ? `<span>${b.genDeploy > 0.5 ? 'Genn. sheet' : 'Jib sheet'}</span><b>${N(L.jibLoad)}</b>` : '') +
      (S.stay ? `<span>Staysail sheet</span><b>${N(L.stayLoad)}</b>` : '') +
      (b.cls.hasBackstay ? `<span>Backstay</span><b>${N(L.backstayLoad)}</b>` : '') +
      `<span>Mast bend</span><b>${Math.round(L.bendMM || 0)} mm</b>` +
      (S.jib ? `<span>Forestay sag</span><b>${Math.round(L.sagMM || 0)} mm</b>` : '') +
      `<span>Heel moment</span><b>${Math.round(Math.abs(d.sailK || 0))} Nm</b>` +
      `<span>Righting</span><b>${Math.round(Math.abs(d.RM || 0))} Nm</b>`;
  }

  updatePhysics(b) {
    const d = b.diag, C = b.cls;
    const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
    let h = '';
    h += kv('Drive (sails)', `${fmt(d.sailX, 0)} N`) + kv('Side force (sails)', `${fmt(d.sailY, 0)} N`);
    for (const s of b.sails) { const st = d.strips[s.key]; if ((st.areaF ?? 0) > 0.05) h += kv(`· ${s.key} total`, `${fmt(st.F, 0)} N`); }
    h += kv('Friction (ITTC-57)', `${fmt(d.Rf, 0)} N`) + kv('Wave-making', `${fmt(d.Rr, 0)} N`) + kv('Added (waves)', `${fmt(d.Raw, 0)} N`);
    h += kv('Keel lift / drag', `${fmt(d.keelY, 0)} / ${fmt(d.keelX, 0)} N`) + kv('Keel stalled', d.keelStall ? 'yes' : 'no');
    h += kv('Rudder force', `${fmt(d.rudderY, 0)} N`) + kv('Rudder ventilation', `${Math.round((1 - (d.rudderVent ?? 1)) * 100)}%`);
    h += kv('Froude number', fmt(d.fn, 3)) + kv('Reynolds (hull)', `${(Math.abs(b.u) * C.lwl / 1.19e-6 / 1e6).toFixed(1)}e6`);
    h += kv('Heel moment', `${fmt(d.sailK, 0)} Nm`) + kv('Righting moment', `${fmt(d.RM, 0)} Nm`);
    h += kv('Weight position', `${fmt(b.crewY, 2)} m / ${fmt(b.crewX, 2)}`);
    h += kv('Yaw rate', `${fmt(b.r / DEG, 1)} °/s`) + kv('Roll rate', `${fmt(b.p / DEG, 1)} °/s`);
    h += kv('Heave / pitch', `${fmt(b.heave, 2)} m / ${fmt(b.pitch / DEG, 1)}°`);
    h += kv('Local wind / dirty air', `${fmt((d.tws ?? 0) / KT)} kn / ${Math.round((1 - b.shadow) * 100)}%`);
    h += kv('Wind from (true)', `${pad3(deg(d.twd ?? 0))}°`);
    const cur = this.g.env.current.at(b.x, b.z, {});
    h += kv('Current', `${fmt(Math.hypot(cur.x, cur.z) / KT)} kn → ${pad3(deg(Math.atan2(cur.x, -cur.z)))}°`);
    h += kv('Mast bend / fs. sag', `${Math.round(d.rig.bendMM || 0)} / ${Math.round(d.rig.sagMM || 0)} mm`);
    for (const s of b.sails) {
      const sh = d.shape[s.key];
      if ((d.strips[s.key].areaF ?? 0) < 0.05) continue;
      h += kv(`${s.key} depth ft/mid/hd`, sh.map(x => Math.round(x.d * 100)).join(' / ') + ' %');
      h += kv(`${s.key} twist`, `${fmt(Math.abs(sh[2].ang - sh[0].ang) / DEG, 0)}°`);
    }
    document.getElementById('phys-body').innerHTML = h;
  }

  updateRaceCard() {
    const g = this.g;
    const rc = document.getElementById('rc-clock');
    document.getElementById('rc-venue').textContent = g.venue.name;
    const online = g.net && g.net.connected;
    let actions = '';
    if (g.race) {
      const c = g.race.clock;
      const m = Math.floor(Math.abs(c) / 60), s = Math.floor(Math.abs(c) % 60);
      rc.textContent = `${c < 0 ? '−' : ''}${m}:${String(s).padStart(2, '0')}`;
      rc.classList.toggle('pre', c < 0);
      const me = g.race.racers[0];
      const leg = g.course.legs[me.leg];
      document.getElementById('rc-mode').textContent = online ? 'Online race' : 'Race';
      let legTxt = me.finished ? `Finished · ${ordinal(me.place)}` : leg.type === 'start' ? (c < 0 ? 'Start sequence' : me.ocs ? 'OCS — return below the line' : 'Cross the line') : leg.name;
      if (!me.finished && leg.type !== 'start') {
        const tgt = g.course.target(leg, g.player);
        legTxt += ` · ${Math.round(Math.hypot(tgt.x - g.player.x, tgt.z - g.player.z))} m`;
      }
      document.getElementById('rc-leg').textContent = legTxt;
      const st = g.raceStandings();
      document.getElementById('rc-standings').innerHTML = st.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span>${i + 1}</span><span>${esc(r.name)}</span><span>${r.finished ? fmtT(r.time) : legShort(g.course.legs[Math.min(r.leg, g.course.legs.length - 1)])}</span></li>`).join('');
      if (online && (me.finished || c > 1800)) actions = `<button class="chip" id="rc-newrace">Start another race</button>`;
    } else {
      document.getElementById('rc-mode').textContent = online ? 'Online' : 'Free sail';
      rc.classList.remove('pre');
      rc.textContent = fmtT(g.t);
      const wp = g.waypoint;
      document.getElementById('rc-leg').textContent = wp ? `Waypoint ${Math.round(Math.hypot(wp.x - g.player.x, wp.z - g.player.z))} m · ${pad3(deg(Math.atan2(wp.x - g.player.x, -(wp.z - g.player.z))))}°` : `Log ${fmt(g.player.log / 1852, 2)} nm · click the map for a waypoint`;
      if (online) {
        const names = [...g.net.peers.values()].map(p => `<li><span></span><span>${esc(p.name)}</span><span>${p.boat ? Math.round(Math.hypot(p.boat.x - g.player.x, p.boat.z - g.player.z)) + ' m' : '…'}</span></li>`);
        document.getElementById('rc-standings').innerHTML = names.join('');
        actions = `<button class="chip" id="rc-newrace">Start a race for the room</button>`;
      } else document.getElementById('rc-standings').innerHTML = g.timeWarp > 1 ? `<li><span></span><span>Time warp</span><span>${g.timeWarp}×</span></li>` : '';
    }
    if (online) actions = `<span class="muted small"><span class="net-dot"></span>${g.net.count} sailing</span>` + actions;
    else if (g.net && g.net.status === 'connecting') actions = `<span class="muted small"><span class="net-dot off"></span>connecting…</span>`;
    const box = document.getElementById('rc-actions');
    if (box.dataset.html !== actions) {
      box.dataset.html = actions; box.innerHTML = actions;
      const b = document.getElementById('rc-newrace');
      if (b) b.addEventListener('click', () => g.startSharedRace());
    }
  }

  // ------------------------------------------------------------ tactical map (wind up)
  setWorld(world) {
    this.world = world;
    this.trail = [];
    if (!world || world.open) { this.landImg = null; return; }
    const S = 512, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -world.R + (i + 0.5) * 2 * world.R / S, z = -world.R + (j + 0.5) * 2 * world.R / S;
      const s = world.sdfAt(x, z), k = (j * S + i) * 4;
      if (s < 0) { img.data[k] = 142; img.data[k + 1] = 150; img.data[k + 2] = 118; img.data[k + 3] = 255; }
      else {
        const dp = world.depthAt(x, z);
        const sh = clamp(1 - dp / 6, 0, 1);
        img.data[k] = 18 + 40 * sh; img.data[k + 1] = 42 + 70 * sh; img.data[k + 2] = 58 + 60 * sh; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.landImg = cv;
  }

  mapTransform() {
    const g = this.g, b = g.player, W = this.mapCanvas.width;
    const up = g.env.wind.twd; // wind comes from the top
    const sc = (W / 2) / this.mapRange;
    return { cx: b.x, cz: b.z, rot: -up, sc, W };
  }
  toMap(T, x, z) {
    const dx = x - T.cx, dz = z - T.cz, c = Math.cos(T.rot), s = Math.sin(T.rot);
    return [T.W / 2 + (dx * c - dz * s) * T.sc, T.W / 2 + (dx * s + dz * c) * T.sc];
  }
  mapClick(e) {
    if (this.g.race) return;
    const r = this.mapCanvas.getBoundingClientRect();
    const T = this.mapTransform();
    const px = (e.clientX - r.left) / r.width * T.W - T.W / 2, py = (e.clientY - r.top) / r.height * T.W - T.W / 2;
    const c = Math.cos(-T.rot), s = Math.sin(-T.rot);
    const dx = (px * c - py * s) / T.sc, dz = (px * s + py * c) / T.sc;
    this.g.waypoint = { x: T.cx + dx, z: T.cz + dz, kind: 'mark', name: 'WP', color: 0x39d0ff };
    this.g.onWaypoint();
    this.toast('Waypoint set');
  }

  drawMap() {
    const g = this.g, b = g.player, ctx = this.mctx, W = this.mapCanvas.width;
    const T = this.mapTransform();
    ctx.save();
    ctx.fillStyle = '#122a3a'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2); ctx.rotate(T.rot); ctx.scale(T.sc, T.sc); ctx.translate(-T.cx, -T.cz);
    if (this.landImg) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.landImg, -this.world.R, -this.world.R, 2 * this.world.R, 2 * this.world.R);
    }
    // puffs (from the renderer's wind texture)
    const gt = g.renderer.gustTex, gd = gt.image.data, GS = 128, size = g.renderer.waterU.uGustS.value, o = g.renderer.waterU.uGustO.value;
    const cell = size / GS;
    for (let j = 0; j < GS; j += 2) for (let i = 0; i < GS; i += 2) {
      const f = gd[(j * GS + i) * 4] / 128;
      if (f > 1.08) { ctx.fillStyle = `rgba(8,16,40,${Math.min(0.55, (f - 1.05) * 1.6)})`; ctx.fillRect(o.x - size / 2 + i * cell, o.y - size / 2 + j * cell, cell * 2, cell * 2); }
      else if (f < 0.9) { ctx.fillStyle = `rgba(190,220,235,${Math.min(0.25, (0.92 - f) * 1.2)})`; ctx.fillRect(o.x - size / 2 + i * cell, o.y - size / 2 + j * cell, cell * 2, cell * 2); }
    }
    const lw = 1 / T.sc;
    // track
    if (!this.trail.length || Math.hypot(this.trail[this.trail.length - 1][0] - b.x, this.trail[this.trail.length - 1][1] - b.z) > 6) { this.trail.push([b.x, b.z]); if (this.trail.length > 600) this.trail.shift(); }
    ctx.strokeStyle = 'rgba(255,122,26,0.55)'; ctx.lineWidth = 1.5 * lw; ctx.beginPath();
    this.trail.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z))); ctx.stroke();
    // course
    const course = g.course;
    const dot = (m, col, r = 4) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(m.x, m.z, r * lw, 0, Math.PI * 2); ctx.fill(); };
    if (course) {
      ctx.strokeStyle = 'rgba(233,238,242,.7)'; ctx.setLineDash([4 * lw, 4 * lw]); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(course.pin.x, course.pin.z); ctx.lineTo(course.committee.x, course.committee.z); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(course.gateL.x, course.gateL.z); ctx.lineTo(course.gateR.x, course.gateR.z); ctx.stroke();
      ctx.setLineDash([]);
      dot(course.pin, '#ff7a1a'); dot(course.committee, '#e9eef2', 5); dot(course.windward, '#ff7a1a', 5); dot(course.gateL, '#f2b33d'); dot(course.gateR, '#f2b33d');
    }
    if (g.waypoint) {
      dot(g.waypoint, '#39d0ff', 5);
      ctx.strokeStyle = 'rgba(57,208,255,.5)'; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(b.x, b.z); ctx.lineTo(g.waypoint.x, g.waypoint.z); ctx.stroke();
    }
    // laylines to the navigation target
    const tgt = g.navTarget();
    if (tgt && g.showLaylines && g.targets) {
      const twd = g.env.wind.twd;
      const up = g.targets.up.twa * DEG, dn = g.targets.dn.twa * DEG;
      const upwindLeg = Math.cos(wrap(Math.atan2(tgt.x - b.x, -(tgt.z - b.z)) - twd)) > 0;
      const A = upwindLeg ? up : dn;
      ctx.strokeStyle = 'rgba(242,179,61,.75)'; ctx.lineWidth = lw * 1.2;
      for (const sgn of [-1, 1]) {
        const d2 = twd + sgn * A + Math.PI; // back along the close-hauled / running heading on each tack
        const L = 3000;
        ctx.beginPath(); ctx.moveTo(tgt.x, tgt.z); ctx.lineTo(tgt.x + Math.sin(d2) * L, tgt.z - Math.cos(d2) * L); ctx.stroke();
      }
    }
    // boats
    for (const o2 of g.boats) {
      const me = o2 === b;
      ctx.save(); ctx.translate(o2.x, o2.z); ctx.rotate(o2.psi);
      // your own boat: a big notched arrow with a dark outline so it reads at any zoom
      const s = Math.max(o2.cls.loa, (me ? 22 : 9) * lw) / 2;
      ctx.fillStyle = me ? '#ff7a1a' : 'rgba(233,238,242,.85)';
      ctx.beginPath();
      if (me) { ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s * 0.7, s); }
      else { ctx.moveTo(0, -s); ctx.lineTo(s * 0.45, s); ctx.lineTo(-s * 0.45, s); }
      ctx.closePath(); ctx.fill();
      if (me) { ctx.strokeStyle = 'rgba(10,20,28,.9)'; ctx.lineWidth = lw * 1.6; ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
    // wind arrow + north
    ctx.fillStyle = 'rgba(233,238,242,.9)';
    ctx.beginPath(); ctx.moveTo(W / 2, 30); ctx.lineTo(W / 2 - 9, 10); ctx.lineTo(W / 2 + 9, 10); ctx.closePath(); ctx.fill();
    ctx.font = '600 20px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${pad3(deg(g.env.wind.twd))}°`, W / 2, 52);
    const nr = T.rot;
    ctx.save(); ctx.translate(W - 30, 30); ctx.rotate(nr);
    ctx.fillStyle = '#e0413a'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(6, 4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e9eef2'; ctx.fillText('N', 0, 22);
    ctx.restore();
    document.getElementById('map-scale').textContent = `${this.mapRange >= 1000 ? fmt(this.mapRange / 1000, 1) + ' km' : Math.round(this.mapRange) + ' m'} radius`;
  }

  // ------------------------------------------------------------ polar
  drawPolar(b, twaDeg) {
    const ctx = this.pctx, W = this.polarCanvas.width, H = this.polarCanvas.height;
    ctx.clearRect(0, 0, W, H);
    const polar = this.g.polar;
    const cx = 40, cy = H / 2, R = H / 2 - 16;
    const maxK = polar ? Math.max(4, Math.ceil(Math.max(...polar.map(p => p.bsp / KT)) / 2) * 2) : 8;
    const pt = (twa, kn) => [cx + Math.sin(twa * DEG) * kn / maxK * R, cy - Math.cos(twa * DEG) * kn / maxK * R];
    ctx.strokeStyle = 'rgba(233,238,242,.12)'; ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(142,162,177,.9)'; ctx.font = '500 16px "Barlow Condensed", sans-serif';
    const ring = maxK > 10 ? 4 : 2;
    for (let k = ring; k <= maxK; k += ring) {
      ctx.beginPath(); ctx.arc(cx, cy, k / maxK * R, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.fillText(`${k}`, cx - 22, cy - k / maxK * R + 5);
    }
    for (let a = 0; a <= 180; a += 30) { const [x, y] = pt(a, maxK); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); if (a % 60 === 0 && a > 0) ctx.fillText(`${a}°`, x + 4, y + (a === 180 ? -4 : 5)); }
    if (polar) {
      ctx.strokeStyle = '#e9eef2'; ctx.lineWidth = 2; ctx.beginPath();
      polar.forEach((p, i) => { const [x, y] = pt(p.twa, p.bsp / KT); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      const vt = vmgTargets(polar);
      for (const p of [vt.up, vt.dn]) { const [x, y] = pt(p.twa, p.bsp / KT); ctx.fillStyle = '#f2b33d'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); }
      const ps = polarSpeedAt(polar, Math.abs(twaDeg));
      document.getElementById('polar-pct').textContent = `${fmt(this.g.polarTws / KT, 0)} kn · up ${vt.up.twa}° · dn ${vt.dn.twa}°`;
    } else document.getElementById('polar-pct').textContent = 'computing…';
    this.polarTrail.push([Math.abs(twaDeg), b.u / KT]); if (this.polarTrail.length > 60) this.polarTrail.shift();
    this.polarTrail.forEach(([a, k], i) => { const [x, y] = pt(a, Math.max(0, k)); ctx.fillStyle = `rgba(255,122,26,${i / 80})`; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
    const [x, y] = pt(Math.abs(twaDeg), Math.max(0, b.u / KT));
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'); }
function fmtT(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function legShort(l) { return l.type === 'start' ? 'start' : l.type === 'mark' ? 'beat' : l.type === 'gate' ? 'run' : 'to finish'; }
