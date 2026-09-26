// Navigation: a paper-style chart (north up: coastline, charted depths below chart datum with the drying banks,
// seamarks with IALA symbols and their light characteristics, the tidal streams as arrows, the boat, its COG/SOG
// vector and track, the waypoint or the race's next mark, and the day's tide curve), the nav readout (COG, SOG,
// depth, the stream's set and drift, the height of tide, position, BRG / DTW / XTE / VMC / ETA to the waypoint)
// and a steering compass tape.
// Tab (or the toolbar's Chart button) opens the chart; click or tap it to set a waypoint (a seamark: steer for it).
import { DEG, KT } from './env.js';
import { pref } from './hud.js';
import { makeProjection } from './world.js';
import { resolveMark, lightLabel, PAINT, colourName } from './seamarks.js';

const $ = (s) => document.querySelector(s);
const NM = 1852;
const pad3 = (n) => String(((Math.round(n) % 360) + 360) % 360).padStart(3, '0');
const brgOf = (dx, dz) => Math.atan2(dx, -dz);
const hex = (c) => '#' + (PAINT[c] ?? PAINT[colourName(c)] ?? 0x8a8d90).toString(16).padStart(6, '0');
const LIGHT_CSS = { W: '#f5c400', R: '#e0302a', G: '#1f9a50', Y: '#f5c400', Bu: '#2f63d0' };
const MAGENTA = '#c0268f';
const dist = (m) => m >= 0.1 * NM ? `${(m / NM).toFixed(m >= 10 * NM ? 1 : 2)} nm` : `${Math.round(m)} m`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmtLat(lat) { const a = Math.abs(lat), d = Math.floor(a); return `${String(d).padStart(2, '0')}°${((a - d) * 60).toFixed(2).padStart(5, '0')}'${lat >= 0 ? 'N' : 'S'}`; }
export function fmtLon(lon) { const a = Math.abs(lon), d = Math.floor(a); return `${String(d).padStart(3, '0')}°${((a - d) * 60).toFixed(2).padStart(5, '0')}'${lon >= 0 ? 'E' : 'W'}`; }

export class Nav {
  constructor(game) {
    this.g = game;
    this.chartOpen = false;
    this.track = [];
    this.hazards = [];                                         // buoys and beacons near a boat: solid, like the race marks
    this.view = { cx: 0, cz: 0, s: 0.12, follow: true };      // s: chart pixels (css) per metre
    this.cv = $('#chart-cv'); this.ctx = this.cv.getContext('2d');
    this.tape = $('#compass-tape'); this.tctx = this.tape.getContext('2d');
    this.acc = 0; this.chartAcc = 0;
    this.bindChart();
    this.labels = pref('tw-chart-labels') !== '0';
    const lb = $('#chart-labels'), syncL = () => { lb.setAttribute('aria-pressed', String(this.labels)); lb.classList.toggle('on', this.labels); };
    lb.addEventListener('click', () => { this.labels = !this.labels; pref('tw-chart-labels', this.labels ? '1' : '0'); syncL(); this.drawChart(); }); syncL();
    $('#chart-close').addEventListener('click', () => this.toggleChart(false));
    $('#chart-centre').addEventListener('click', () => { this.view.follow = true; this.drawChart(); });
    $('#chart-clear').addEventListener('click', () => { if (!this.g.race) { this.g.waypoint = null; this.g.onWaypoint(); this.drawChart(); } });
    window.addEventListener('resize', () => { if (this.chartOpen) this.drawChart(); });
  }

  setWorld(world, geo, venue) {
    this.world = world; this.venue = venue;
    this.proj = venue && !venue.open ? makeProjection(venue.lat, venue.lon) : makeProjection(32, -40);
    const data = geo && geo.seamarks;
    this.region = data ? data.region : null;
    this.marks = data && data.marks ? data.marks.map(m => resolveMark(m, data.region)) : [];
    for (const m of this.marks) m.label = m.L ? lightLabel(m.L) : '';
    this.base = null; this.track = []; this.origin = null; this.lastTgt = null; this.hazards = [];
    this.solid = this.marks.filter(m => !m.far && /^(buoy_|beacon_|light_float|light_vessel)/.test(m.t)).map(m => ({ x: m.x, z: m.z, kind: 'mark', seamark: true, name: m.n }));
    this.view.follow = true;
    $('#chart-title').textContent = venue ? `${venue.name}${this.region ? ` · IALA ${this.region}` : ''}` : 'Chart';
  }

  toggleChart(on = !this.chartOpen) {
    this.chartOpen = on;
    $('#chart').hidden = !on;
    $('#tb-chart') && $('#tb-chart').setAttribute('aria-pressed', String(on));
    if (on) { if (this.view.follow) this.fit(); this.drawChart(); }
  }
  fit() { const b = this.g.player; if (b) { this.view.cx = b.x; this.view.cz = b.z; } }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, b = g.player; if (!b || !this.world) return;
    const last = this.track[this.track.length - 1];
    const jump = last ? Math.hypot(last[0] - b.x, last[1] - b.z) : 0;
    if (jump > 400) this.track = [];                              // (a new start or a reset: a new track)
    if (!last || jump > 8) { this.track.push([b.x, b.z]); if (this.track.length > 4000) this.track.splice(0, 1000); }
    // XTE runs from where the boat was when the target was set to the target
    const tgt = g.navTarget();
    if (!tgt) { this.lastTgt = null; this.origin = null; }
    else if (!this.lastTgt || Math.hypot(tgt.x - this.lastTgt.x, tgt.z - this.lastTgt.z) > 30) { this.origin = { x: b.x, z: b.z }; this.lastTgt = { x: tgt.x, z: tgt.z }; }
    this.hazAcc = (this.hazAcc || 0) + dt;
    if (this.hazAcc > 0.5) { this.hazAcc = 0; this.hazards = (this.solid || []).filter(h => g.boats.some(o => Math.abs(o.x - h.x) < 150 && Math.abs(o.z - h.z) < 150)); }
    this.acc += dt; this.chartAcc += dt; this.tapeAcc = (this.tapeAcc || 0) + dt;
    if (this.tapeAcc > 1 / 30) { this.tapeAcc = 0; this.drawTape(); }
    if (this.acc > 0.25) { this.acc = 0; this.readout(); }
    if (this.chartOpen && this.chartAcc > 0.1) { this.chartAcc = 0; if (this.view.follow) this.fit(); this.drawChart(); }
  }

  // what the nav instruments show (also used by the tape and the chart)
  state() {
    const g = this.g, b = g.player;
    const sog = Math.hypot(b.vgx || 0, b.vgz || 0), cog = sog > 0.05 ? brgOf(b.vgx, b.vgz) : b.psi;
    const [lat, lon] = this.proj.inv(b.x, b.z);
    const s = { sog, cog, hdg: b.psi, lat, lon, depth: this.world.depthAt(b.x, b.z) };
    const tgt = g.navTarget();
    if (tgt) {
      const dx = tgt.x - b.x, dz = tgt.z - b.z;
      s.tgt = tgt; s.brg = brgOf(dx, dz); s.dtw = Math.hypot(dx, dz);
      s.vmc = sog * Math.cos(cog - s.brg);
      s.ttg = s.vmc > 0.05 ? s.dtw / s.vmc : Infinity;
      if (this.origin) {
        const ox = tgt.x - this.origin.x, oz = tgt.z - this.origin.z, L = Math.hypot(ox, oz);
        s.xte = L > 1 ? ((b.x - this.origin.x) * oz - (b.z - this.origin.z) * ox) / L * -1 : 0;   // + = right of the track
      }
      s.tname = g.race ? (() => { const r = g.race.racers[0], leg = g.course.legs[r.leg]; return leg ? (leg.type === 'start' ? 'Start line' : leg.name) : ''; })() : (tgt.label || 'Waypoint');
    }
    return s;
  }

  readout() {
    const s = this.state(), el = $('#nav-read'); if (!el) return;
    const set = (k, v, cls = '') => { const e = document.getElementById('nv-' + k); if (e) { e.textContent = v; e.className = cls; } };
    set('cog', pad3(s.cog / DEG) + '°'); set('sog', (s.sog / KT).toFixed(1));
    const C = this.g.player.cls;
    set('dpt', s.depth > 99 ? '99+' : s.depth.toFixed(1), s.depth < C.draft + 1 ? 'bad' : s.depth < C.draft + 3 ? 'warn' : '');
    set('pos', `${fmtLat(s.lat)} ${fmtLon(s.lon)}`);
    // the stream here (set: where it goes; drift: its speed) and the height of tide above chart datum
    const b = this.g.player, cur = this.g.env && this.g.env.current ? this.g.env.current.at(b.x, b.z, this._cur || (this._cur = {})) : { x: 0, z: 0 };
    const drift = Math.hypot(cur.x, cur.z), tide = this.g.tide, real = tide && !tide.still;
    el.classList.toggle('has-td', drift > 0.01 || !!real); el.classList.toggle('has-ht', !!real);
    set('set', drift > 0.01 ? pad3(brgOf(cur.x, cur.z) / DEG) + '°' : '–'); set('drift', (drift / KT).toFixed(1));
    if (real) {
      const g = tide.gaugeNear(b.x, b.z), h = tide.levelAt(b.x, b.z) + tide.z0At(b.x, b.z), ms = tide.now();
      const rising = g ? g.level(ms + 600e3) > g.level(ms) : false;
      set('tide', `${h.toFixed(1)} ${rising ? '↑' : '↓'}`);
    }
    el.classList.toggle('has-wp', !!s.tgt);
    if (s.tgt) {
      set('tname', s.tname);
      set('brg', pad3(s.brg / DEG) + '°'); set('dtw', dist(s.dtw));
      set('xte', s.xte === undefined ? '–' : `${dist(Math.abs(s.xte))} ${Math.abs(s.xte) < 1 ? '' : s.xte > 0 ? 'R' : 'L'}`, Math.abs(s.xte || 0) > 200 ? 'warn' : '');
      set('vmc', (s.vmc / KT).toFixed(1));
      if (isFinite(s.ttg) && s.ttg < 360000) {
        const clock = (this.g.clockBase ?? Date.now()) + this.g.t * 1000 + s.ttg * 1000 + (this.venue && !this.venue.open ? this.venue.lon / 15 * 3600e3 : 0);
        const d = new Date(clock), tt = s.ttg < 3600 ? `${Math.floor(s.ttg / 60)}:${String(Math.floor(s.ttg % 60)).padStart(2, '0')}` : `${Math.floor(s.ttg / 3600)}h${String(Math.floor(s.ttg / 60) % 60).padStart(2, '0')}`;
        set('eta', `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} · ${tt}`);
      } else set('eta', '–');
    } else set('tname', 'No waypoint · Tab for the chart');
  }

  // ------------------------------------------------------------------ steering compass tape
  drawTape() {
    const cv = this.tape, ctx = this.tctx; if (!cv || cv.offsetParent === null) return;
    const W = cv.width, H = cv.height, s = this.state(), hdg = s.hdg / DEG;
    const span = 90, px = W / span;                               // ±45° across the tape
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(11,22,31,.78)'; ctx.fillRect(0, 0, W, H);
    const x = (a) => W / 2 + (((a - hdg + 540) % 360) - 180) * px;
    ctx.strokeStyle = 'rgba(233,238,242,.55)'; ctx.fillStyle = '#e9eef2'; ctx.textAlign = 'center';
    ctx.font = `600 ${Math.round(H * 0.3)}px "Barlow Condensed", sans-serif`;
    for (let a = Math.floor((hdg - span / 2) / 5) * 5; a <= hdg + span / 2 + 5; a += 5) {
      const X = x(a), n = ((a % 360) + 360) % 360;
      ctx.lineWidth = n % 10 === 0 ? 2 : 1; ctx.beginPath(); ctx.moveTo(X, H); ctx.lineTo(X, H - (n % 10 === 0 ? H * 0.28 : H * 0.16)); ctx.stroke();
      if (n % 30 === 0) ctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? pad3(n), X, H * 0.5);
    }
    // markers: bearing to the waypoint (cyan), COG (orange), wind (white)
    const mark = (a, col, label, up) => {
      let X = x(a), off = false;
      if (X < 8) { X = 8; off = true; } else if (X > W - 8) { X = W - 8; off = true; }
      ctx.fillStyle = col; ctx.beginPath();
      if (up) { ctx.moveTo(X, H * 0.62); ctx.lineTo(X - 7, H); ctx.lineTo(X + 7, H); } else { ctx.moveTo(X, H * 0.3); ctx.lineTo(X - 7, 0); ctx.lineTo(X + 7, 0); }
      ctx.closePath(); ctx.fill();
      if (off && label) { ctx.font = `600 ${Math.round(H * 0.26)}px "Barlow Condensed", sans-serif`; ctx.textAlign = X < W / 2 ? 'left' : 'right'; ctx.fillText(label, X < W / 2 ? X + 10 : X - 10, up ? H * 0.62 : H * 0.28); ctx.textAlign = 'center'; }
    };
    mark(s.cog / DEG, '#ff7a1a', 'COG', true);
    if (s.tgt) mark(s.brg / DEG, '#39d0ff', `BRG ${pad3(s.brg / DEG)}`, false);
    const twd = this.g.env && this.g.env.wind ? this.g.env.wind.twd / DEG : null;
    if (twd !== null) mark(twd, 'rgba(233,238,242,.8)', '', false);
    // lubber line and heading
    ctx.fillStyle = '#ff7a1a'; ctx.fillRect(W / 2 - 1.5, 0, 3, H);
    const bw = H * 1.25;
    ctx.fillStyle = '#0e1a24'; ctx.fillRect(W / 2 - bw / 2, 0, bw, H * 0.42);
    ctx.fillStyle = '#e9eef2'; ctx.font = `700 ${Math.round(H * 0.34)}px "Barlow Condensed", sans-serif`; ctx.fillText(pad3(hdg) + '°', W / 2, H * 0.34);
    if (s.tgt) {
      const err = (((s.brg - s.hdg) / DEG + 540) % 360) - 180;
      ctx.font = `600 ${Math.round(H * 0.26)}px "Barlow Condensed", sans-serif`; ctx.fillStyle = '#39d0ff';
      ctx.textAlign = err < 0 ? 'left' : 'right';
      ctx.fillText(Math.abs(err) < 2 ? '' : err < 0 ? `◀ ${Math.round(-err)}°` : `${Math.round(err)}° ▶`, err < 0 ? 6 : W - 6, H * 0.82);
    }
  }

  // ------------------------------------------------------------------ minimap overlay (called inside its transform)
  drawMini(ctx, lw) {
    if (!this.marks) return;
    for (const m of this.marks) {
      if (m.far || /^(wreck|rock|obstruction|landmark)$/.test(m.t)) continue;
      const major = /^(lighthouse|light_major)$/.test(m.t);
      ctx.fillStyle = major ? MAGENTA : hex(m.col[0]);
      ctx.beginPath(); ctx.arc(m.x, m.z, (major ? 4 : 2.6) * lw, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ chart
  baseImage() {
    if (this.base && this.base.world === this.world) return this.base;
    const w = this.world, S = w.R > 10000 ? 1536 : 768, R = w.R, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), band = new Uint8Array(S * S);
    const BANDS = [0, 2, 5, 10, 20];
    const PAL = [[150, 196, 224], [176, 212, 236], [204, 228, 244], [226, 240, 249], [246, 250, 252]];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -R + (i + 0.5) * 2 * R / S, z = -R + (j + 0.5) * 2 * R / S, k = j * S + i;
      const s = w.sdfAt(x, z);
      let c;
      if (s <= 0) { c = [238, 222, 166]; band[k] = 255; }
      // (charted depth below chart datum: negative = a drying bank, green as on a paper chart)
      else { const d = w.chartDepthAt(x, z); let bi = 0; while (bi + 1 < BANDS.length && d >= BANDS[bi + 1]) bi++; band[k] = d < 0 ? 254 : bi; c = d < 0 ? [172, 196, 150] : PAL[bi]; }
      img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = 255;
    }
    // depth contours and the coastline where the band changes
    for (let j = 1; j < S; j++) for (let i = 1; i < S; i++) {
      const k = j * S + i, a = band[k], l = band[k - 1], u = band[k - S];
      if (a !== l || a !== u) {
        const coast = a === 255 || l === 255 || u === 255;
        const o = k * 4, f = coast ? 0.35 : 0.72;
        img.data[o] *= f; img.data[o + 1] *= f; img.data[o + 2] *= coast ? 0.35 : 0.85;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.base = { world: this.world, cv };
    return this.base;
  }

  bindChart() {
    const cv = this.cv;
    let drag = null; const touches = new Map(); let pinch = null;
    const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    const zoomAt = (f, mx, my) => {
      const r = cv.getBoundingClientRect(), V = this.view;
      const [wx, wz] = this.toWorld(mx - r.left, my - r.top);
      V.s = clamp(V.s * f, 0.004, 4);
      const [nx, nz] = this.toWorld(mx - r.left, my - r.top);
      V.cx += wx - nx; V.cz += wz - nz; V.follow = false;
      this.drawChart();
    };
    cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1 / 1.2 : 1.2, e.clientX, e.clientY); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size === 2) { pinch = spread(); drag = null; return; } }
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    cv.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && touches.size === 2) { const s2 = spread(), [a, b] = [...touches.values()]; if (pinch > 0 && s2 > 0) zoomAt(s2 / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch = s2; return; }
      }
      if (!drag) { this.hover(e.clientX, e.clientY); return; }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved > 6) { this.view.cx -= dx / this.view.s; this.view.cz -= dy / this.view.s; this.view.follow = false; this.drawChart(); }
    });
    const up = (e) => {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = null;
      if (drag && drag.moved <= 6 && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
      drag = null;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
  toWorld(px, py) { const V = this.view, W = this.cv.clientWidth, H = this.cv.clientHeight; return [V.cx + (px - W / 2) / V.s, V.cz + (py - H / 2) / V.s]; }
  toPx(x, z) { const V = this.view, W = this.cv.clientWidth, H = this.cv.clientHeight; return [W / 2 + (x - V.cx) * V.s, H / 2 + (z - V.cz) * V.s]; }
  pick(mx, my) {
    const r = this.cv.getBoundingClientRect(); let best = null, bd = 14;
    for (const m of this.marks || []) { const [px, py] = this.toPx(m.x, m.z), d = Math.hypot(px - (mx - r.left), py - (my - r.top)); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  describe(m) {
    const kind = { lighthouse: 'Lighthouse', light_major: 'Major light', light_minor: 'Light', light_vessel: 'Light vessel', light_float: 'Light float', landmark: 'Landmark', wreck: 'Wreck', rock: 'Rock', obstruction: 'Obstruction' }[m.t]
      || m.t.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace('Buoy', 'Buoy,').replace('Beacon', 'Beacon,');
    const cat = m.cat ? ` (${m.cat.replace(/_/g, ' ')})` : '';
    const L = m.L && m.L.length ? `<br>${m.label}${m.L[0].ht ? ` · ${m.L[0].ht} m` : ''}${m.L.some(l => l.s0 !== undefined) ? ' · sectored' : ''}${m.L[0].guess ? ' (not charted: assumed)' : ''}` : '';
    const [lat, lon] = this.proj.inv(m.x, m.z);
    return `<b>${m.n ? m.n.replace(/[<>&]/g, '') : kind}</b><br>${m.n ? kind : ''}${cat}${m.col && /^(buoy|beacon)/.test(m.t) ? ` · ${m.col.join('-')}${m.sh ? ' ' + m.sh : ''}` : ''}${L}<br><span class="muted">${fmtLat(lat)} ${fmtLon(lon)}</span>`;
  }
  hover(mx, my) {
    const m = this.pick(mx, my), tip = $('#chart-tip');
    if (!m) { tip.hidden = true; this.cv.style.cursor = 'crosshair'; return; }
    const r = this.cv.getBoundingClientRect();
    tip.hidden = false; tip.innerHTML = this.describe(m) + '<br><em>click: steer for it</em>';
    tip.style.left = Math.min(mx - r.left + 16, r.width - 230) + 'px'; tip.style.top = (my - r.top + 12) + 'px';
    this.cv.style.cursor = 'pointer';
  }
  tap(mx, my) {
    const g = this.g;
    const m = this.pick(mx, my);
    if (g.race) { if (m) this.hover(mx, my); g.hud.toast('Racing: the next mark is your waypoint', 1.6); return; }
    const r = this.cv.getBoundingClientRect();
    let x, z, label;
    if (m) { x = m.x; z = m.z; label = m.n || m.t.replace(/_/g, ' '); }
    else { [x, z] = this.toWorld(mx - r.left, my - r.top); label = 'Waypoint'; }
    g.waypoint = { x, z, kind: 'mark', name: 'WP', color: 0x39d0ff, label, seamark: !!m };
    g.onWaypoint();
    if (m) g.renderer.setMarks([], null);                // (the real buoy is there already)
    const b = g.player;
    g.hud.toast(`${label}: ${pad3(brgOf(x - b.x, z - b.z) / DEG)}° · ${dist(Math.hypot(x - b.x, z - b.z))}`, 2);
    this.drawChart();
  }

  drawChart() {
    const cv = this.cv, ctx = this.ctx, g = this.g, b = g.player;
    if (!this.world || !b) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const V = this.view, w = this.world;
    ctx.fillStyle = w.open ? '#f6fafc' : '#dfe3e2'; ctx.fillRect(0, 0, W, H);
    if (!w.open) {
      const B = this.baseImage(), [x0, y0] = this.toPx(-w.R, -w.R);
      ctx.imageSmoothingEnabled = V.s * 2 * w.R / B.cv.width < 3;
      ctx.drawImage(B.cv, x0, y0, 2 * w.R * V.s, 2 * w.R * V.s);
    }
    this.graticule(ctx, W, H);
    this.streamArrows(ctx, W, H);
    const P = (x, z) => this.toPx(x, z);
    // track, race course, waypoint
    ctx.strokeStyle = 'rgba(210,90,20,.85)'; ctx.lineWidth = 1.6; ctx.beginPath();
    this.track.forEach(([x, z], i) => { const [px, py] = P(x, z); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    { const [px, py] = P(b.x, b.z); ctx.lineTo(px, py); }
    ctx.stroke();
    const tgt = g.navTarget();
    if (g.course) {
      const c = g.course;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(30,30,30,.7)'; ctx.lineWidth = 1;
      const seg = (a, bb) => { const [ax, ay] = P(a.x, a.z), [bx, by] = P(bb.x, bb.z); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
      seg(c.pin, c.committee); seg(c.gateL, c.gateR); ctx.setLineDash([]);
      for (const [mk, nm] of [[c.pin, 'Pin'], [c.committee, 'RC'], [c.windward, 'W'], [c.gateL, 'G-P'], [c.gateR, 'G-S']]) {
        const [px, py] = P(mk.x, mk.z);
        ctx.fillStyle = '#ff7a1a'; ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.font = '600 12px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left'; ctx.fillText(nm, px + 8, py + 4);
      }
    }
    if (tgt) {
      const [bx, by] = P(b.x, b.z), [tx, ty] = P(tgt.x, tgt.z);
      if (this.origin && !g.race) { const [ox, oy] = P(this.origin.x, this.origin.z); ctx.strokeStyle = 'rgba(20,120,170,.45)'; ctx.setLineDash([8, 5]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); }
      ctx.strokeStyle = '#1690c8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.strokeStyle = '#1690c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, 9, 0, Math.PI * 2); ctx.moveTo(tx - 13, ty); ctx.lineTo(tx + 13, ty); ctx.moveTo(tx, ty - 13); ctx.lineTo(tx, ty + 13); ctx.stroke();
    }
    // seamarks
    this.drawMarks(ctx, W, H);
    // other boats, then the player with the 6-minute COG/SOG vector
    for (const o of g.boats) {
      if (o === b) continue;
      const [px, py] = P(o.x, o.z);
      ctx.save(); ctx.translate(px, py); ctx.rotate(o.psi); ctx.fillStyle = 'rgba(60,60,60,.8)'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3.5, 5); ctx.lineTo(-3.5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    const s = this.state(), [bx, by] = P(b.x, b.z);
    const vx = Math.sin(s.cog) * s.sog * 360, vz = -Math.cos(s.cog) * s.sog * 360;
    const [ex, ey] = P(b.x + vx, b.z + vz);
    ctx.strokeStyle = '#c0268f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    if (Math.hypot(ex - bx, ey - by) > 12) { const a = Math.atan2(ey - by, ex - bx); ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(a - 0.4), ey - 9 * Math.sin(a - 0.4)); ctx.moveTo(ex, ey); ctx.lineTo(ex - 9 * Math.cos(a + 0.4), ey - 9 * Math.sin(a + 0.4)); ctx.stroke(); }
    ctx.save(); ctx.translate(bx, by); ctx.rotate(b.psi);
    const L = Math.max(b.cls.loa * V.s, 16) / 2;
    ctx.fillStyle = '#ff7a1a'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(L * 0.6, L); ctx.lineTo(0, L * 0.45); ctx.lineTo(-L * 0.6, L); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    this.chrome(ctx, W, H, s);
  }

  // lat / lon lines with edge labels; a scale bar
  graticule(ctx, W, H) {
    const [la0, lo0] = this.proj.inv(...this.toWorld(0, H)), [la1, lo1] = this.proj.inv(...this.toWorld(W, 0));
    const spanMin = (la1 - la0) * 60;
    const step = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find(s => spanMin / s < 7) || 60;
    ctx.strokeStyle = 'rgba(40,60,80,.22)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(30,40,50,.8)'; ctx.font = '500 11px "Barlow Condensed", sans-serif';
    const fm = (v, lat) => { const a = Math.abs(v), d = Math.floor(a + 1e-9), m = (a - d) * 60; return `${d}°${m.toFixed(step < 1 ? 2 : 0).padStart(2, '0')}'${lat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W')}`; };
    for (let m = Math.ceil(la0 * 60 / step) * step; m <= la1 * 60; m += step) {
      const [, y] = this.toPx(...this.proj.fwd(m / 60, lo0)); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillText(fm(m / 60, true), 4, y - 3);
    }
    for (let m = Math.ceil(lo0 * 60 / step) * step; m <= lo1 * 60; m += step) {
      const [x] = this.toPx(...this.proj.fwd(la0, m / 60)); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(fm(m / 60, false), x, 12);
    }
  }

  drawMarks(ctx, W, H) {
    const V = this.view, boxes = [];
    const free = (x, y, w, h) => { for (const q of boxes) if (x < q[0] + q[2] && x + w > q[0] && y < q[1] + q[3] && y + h > q[1]) return false; boxes.push([x, y, w, h]); return true; };
    const k = clamp(V.s / 0.12, 0.7, 1.4);                         // symbol size follows the zoom a little
    const order = [...(this.marks || [])].sort((a, b) => rank(a) - rank(b));
    for (const m of order) {
      const [px, py] = this.toPx(m.x, m.z);
      if (px < -60 || py < -60 || px > W + 60 || py > H + 60) continue;
      const major = /^(lighthouse|light_major|light_vessel)$/.test(m.t);
      if (!major && V.s < 0.03 && !m.L) continue;
      ctx.save(); ctx.translate(px, py); ctx.scale(k, k);
      if (m.L) this.flare(ctx, m, major);
      symbol(ctx, m);
      ctx.restore();
      // label: name, light characteristic
      const show = this.labels && (major || V.s > 0.06 || (m.L && V.s > 0.035));
      if (!show) continue;
      const lines = [m.n && (major || V.s > 0.09) ? m.n : '', m.label].filter(Boolean);
      if (!lines.length) continue;
      ctx.font = 'italic 500 12px "Barlow Condensed", sans-serif';
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width)), th = lines.length * 13;
      const lx = px + 10 * k, ly = py - 4 - th / 2;
      if (!free(lx, ly, tw, th) && !major) continue;
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(lx - 1, ly - 1, tw + 2, th + 2);
      ctx.textAlign = 'left';
      lines.forEach((l, i) => { ctx.fillStyle = i === lines.length - 1 && m.label ? MAGENTA : '#1d2530'; ctx.fillText(l, lx, ly + 11 + i * 13); });
    }
  }
  // the magenta light flare, and sector arcs for sector lights
  flare(ctx, m, major) {
    const sec = m.L.filter(l => l.s0 !== undefined);
    if (sec.length && major) {
      const R = 34;
      for (const l of sec) {
        // sectors are bearings from seaward: the light shines the opposite way
        const a0 = (l.s0 + 180) * DEG - Math.PI / 2, a1 = (l.s1 + 180) * DEG - Math.PI / 2;
        ctx.strokeStyle = LIGHT_CSS[(l.col || ['W'])[0]] || '#f5c400'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, R, a0, a1 < a0 ? a1 + Math.PI * 2 : a1); ctx.stroke();
        ctx.strokeStyle = 'rgba(40,40,40,.45)'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3]);
        for (const a of [a0, a1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 1.25, Math.sin(a) * R * 1.25); ctx.stroke(); }
        ctx.setLineDash([]);
      }
    }
    const c = LIGHT_CSS[(m.L[0].col || ['W'])[0]] || MAGENTA;
    ctx.fillStyle = c === LIGHT_CSS.W ? MAGENTA : c; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(9, -3, 13, -14); ctx.quadraticCurveTo(3, -10, 0, 0); ctx.fill();
    ctx.globalAlpha = 1;
  }

  chrome(ctx, W, H, s) {
    // scale bar
    const V = this.view, target = 120 / V.s;
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].find(v => v >= target * 0.5) || 20000;
    const nm = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find(v => v * NM >= target * 0.5) || 10;
    const x0 = 14, y0 = H - 14;
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(x0 - 4, y0 - 30, Math.max(nice, nm * NM) * V.s + 60, 34);
    ctx.strokeStyle = '#1d2530'; ctx.fillStyle = '#1d2530'; ctx.lineWidth = 2; ctx.font = '500 11px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left';
    ctx.beginPath(); ctx.moveTo(x0, y0 - 18); ctx.lineTo(x0 + nice * V.s, y0 - 18); ctx.stroke(); ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x0 + nice * V.s + 4, y0 - 14);
    ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0 + nm * NM * V.s, y0 - 4); ctx.stroke(); ctx.fillText(`${nm} nm`, x0 + nm * NM * V.s + 4, y0);
    // north arrow
    ctx.fillStyle = '#1d2530'; ctx.beginPath(); ctx.moveTo(W - 24, 14); ctx.lineTo(W - 30, 32); ctx.lineTo(W - 24, 28); ctx.lineTo(W - 18, 32); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '700 12px "Barlow Condensed", sans-serif'; ctx.fillText('N', W - 24, 45);
    const w = this.world, tide = this.g.tide;
    $('#chart-scale').textContent = `${(W / V.s / NM).toFixed(W / V.s / NM < 3 ? 2 : 1)} nm across · ` + (w.bed ? `depths in m below ${tide ? tide.cd : 'MSL'}` : 'depths estimated');
    if (tide && !tide.still && tide.ref) this.tidePanel(ctx, W, H);
  }

  // tidal streams: an arrow every ~52 px, as long as the stream is strong (1 kn: 16 px), labelled in knots when strong
  streamArrows(ctx, W, H) {
    const g = this.g, cur = g.env && g.env.current, w = this.world;
    if (!cur || w.open || (g.tide && g.tide.still && !cur.speed)) return;
    const step = 52, o = this._sa || (this._sa = {});
    ctx.save(); ctx.lineCap = 'round'; ctx.font = '600 10px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left';
    for (let py = step / 2; py < H; py += step) for (let px = step / 2; px < W; px += step) {
      const [x, z] = this.toWorld(px, py);
      if (Math.abs(x) > w.R || Math.abs(z) > w.R || w.sdfAt(x, z) < 15) continue;
      cur.at(x, z, o);
      const sp = Math.hypot(o.x, o.z) / KT; if (sp < 0.08) continue;
      const L = Math.min(40, 16 * sp), ux = o.x / (sp * KT), uz = o.z / (sp * KT);
      const ax = px - ux * L / 2, ay = py - uz * L / 2, bx = px + ux * L / 2, by = py + uz * L / 2;
      const col = sp < 0.5 ? 'rgba(40,90,160,.55)' : sp < 1.5 ? 'rgba(40,70,170,.8)' : sp < 3 ? 'rgba(120,40,170,.9)' : 'rgba(190,20,110,.95)';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = sp < 0.5 ? 1.2 : 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const a = Math.atan2(uz, ux), hl = Math.min(7, 3 + L * 0.2);
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - hl * Math.cos(a - 0.45), by - hl * Math.sin(a - 0.45)); ctx.lineTo(bx - hl * Math.cos(a + 0.45), by - hl * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
      if (sp >= 1) ctx.fillText(sp.toFixed(1), px + 5, py + 12);
    }
    ctx.restore();
  }

  // the day's tide (local solar day) at the nearest gauge: curve, high and low waters, now; the stream at the boat
  tidePanel(ctx, W, H) {
    const g = this.g, tide = g.tide, b = g.player, st = tide.gaugeNear(b.x, b.z) || tide.ref, v = this.venue;
    const now = tide.now(), lon = v && !v.open ? v.lon : 0, loc = (t) => ((t / 3600e3 + lon / 15) % 24 + 24) % 24;
    const day0 = now - loc(now) * 3600e3;
    // (cache the day's curve: it is the same all day)
    if (!this._tc || this._tc.st !== st || this._tc.day0 !== day0) {
      const pts = []; for (let i = 0; i <= 96; i++) { const t = day0 + i * 900e3; pts.push(st.level(t) + st.z0); }
      this._tc = { st, day0, pts, ex: st.extremes(day0, day0 + 24 * 3600e3) };
    }
    const { pts, ex } = this._tc;
    const pw = 250, ph = 118, x0 = W - pw - 10, y0 = H - ph - 10, gx = x0 + 26, gy = y0 + 20, gw = pw - 36, gh = ph - 46;
    let lo = Math.min(0, ...pts), hi = Math.max(...pts); if (hi - lo < 0.4) { hi += 0.2; lo -= 0.2; }
    const X = (t) => gx + (t - day0) / 86400e3 * gw, Y = (h) => gy + gh - (h - lo) / (hi - lo) * gh;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.strokeStyle = 'rgba(30,40,50,.35)'; ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, pw, ph); ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, ph - 1);
    const d = new Date(day0 + 12 * 3600e3 - lon / 15 * 3600e3);
    ctx.fillStyle = '#1d2530'; ctx.font = '600 12px "Barlow Condensed", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Tide · ${st.name} · ${d.toISOString().slice(0, 10)}`, x0 + 6, y0 + 13);
    ctx.textAlign = 'right'; ctx.font = '500 10px "Barlow Condensed", sans-serif'; ctx.fillStyle = 'rgba(30,40,50,.7)';
    ctx.fillText(`m above ${st.cd}`, x0 + pw - 6, y0 + 13);
    // axes: hours 0 6 12 18 24, heights
    ctx.strokeStyle = 'rgba(30,40,50,.18)';
    for (let hr = 0; hr <= 24; hr += 6) { const x = gx + hr / 24 * gw; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gh); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(String(hr).padStart(2, '0'), x, gy + gh + 11); }
    const hstep = hi - lo > 3 ? 1 : 0.5;
    for (let h = Math.ceil(lo / hstep) * hstep; h <= hi; h += hstep) { const y = Y(h); ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(h.toFixed(hstep < 1 ? 1 : 0), gx - 3, y + 3); }
    // the curve, filled to chart datum
    ctx.beginPath(); pts.forEach((h, i) => { const x = gx + i / 96 * gw, y = Y(h); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#1690c8'; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.lineTo(gx + gw, Y(Math.max(lo, 0))); ctx.lineTo(gx, Y(Math.max(lo, 0))); ctx.closePath(); ctx.fillStyle = 'rgba(22,144,200,.12)'; ctx.fill();
    // high and low waters
    ctx.font = '600 10px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#1d2530'; ctx.textAlign = 'center';
    const hm = (t) => { const h = loc(t); return `${String(Math.floor(h)).padStart(2, '0')}${String(Math.floor(h % 1 * 60)).padStart(2, '0')}`; };
    for (const e of ex) { const x = X(e.t), y = Y(e.h + st.z0); ctx.beginPath(); ctx.arc(x, y, 2, 0, 6.3); ctx.fill(); ctx.fillText(`${hm(e.t)} ${(e.h + st.z0).toFixed(1)}`, Math.max(gx + 14, Math.min(gx + gw - 14, x)), e.hw ? y - 4 : y + 11); }
    // now
    const xn = X(now), hn = st.level(now) + st.z0;
    ctx.strokeStyle = '#c0268f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(xn, gy); ctx.lineTo(xn, gy + gh); ctx.stroke();
    ctx.fillStyle = '#c0268f'; ctx.beginPath(); ctx.arc(xn, Y(hn), 3.2, 0, 6.3); ctx.fill();
    // the stream at the boat
    const c = g.env.current.at(b.x, b.z, {}), sp = Math.hypot(c.x, c.z) / KT;
    ctx.textAlign = 'left'; ctx.font = '600 11px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#1d2530';
    ctx.fillText(`Now ${hn.toFixed(2)} m ${st.level(now + 600e3) > st.level(now) ? 'rising' : 'falling'} · stream ${sp.toFixed(1)} kn → ${pad3(brgOf(c.x, c.z) / DEG)}°`, x0 + 6, y0 + ph - 5);
    ctx.restore();
  }
}

function rank(m) { return /^(lighthouse|light_major|light_vessel)$/.test(m.t) ? 0 : m.L ? 1 : /^(wreck|rock|obstruction)$/.test(m.t) ? 3 : 2; }

// simplified INT-1 symbols: buoy shapes in their colours, beacons as stakes or towers, topmarks, dangers
function symbol(ctx, m) {
  const cs = m.col && m.col.length ? m.col : ['grey'], t = m.t, sh = m.sh || '';
  ctx.lineWidth = 1; ctx.strokeStyle = '#1a1a1a';
  const paint = (path, h0, h1) => {                            // fill a path with the mark's bands (y from h1 up to h0)
    ctx.save(); path(); ctx.clip();
    if (m.pat === 'vertical' && cs.length > 1) { for (let i = 0; i < 6; i++) { ctx.fillStyle = hex(cs[i % cs.length]); ctx.fillRect(-12 + i * 4, h0, 4, h1 - h0); } }
    else { const n = cs.length, hh = (h1 - h0) / n; cs.forEach((c, i) => { ctx.fillStyle = hex(c); ctx.fillRect(-12, h0 + i * hh, 24, hh + 0.5); }); }
    ctx.restore(); path(); ctx.stroke();
  };
  const dot = () => { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill(); };
  let top = -2;
  if (t === 'lighthouse' || t === 'light_major') {
    ctx.fillStyle = '#1a1a1a'; star(ctx, 0, 0, 7, 2.6); ctx.fill(); dot(); return;
  }
  if (t === 'light_minor' || t === 'landmark') { ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill(); return; }
  if (t === 'wreck') { ctx.strokeStyle = '#1a1a1a'; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.moveTo(-3.5, -3); ctx.lineTo(-3.5, 3); ctx.moveTo(3.5, -3); ctx.lineTo(3.5, 3); ctx.stroke(); return; }
  if (t === 'rock') { ctx.strokeStyle = '#1a1a1a'; ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(4, 4); ctx.moveTo(-4, 4); ctx.lineTo(4, -4); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke(); return; }
  if (t === 'obstruction') { ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); return; }
  if (/^beacon/.test(t)) {
    if (/tower|lattice/.test(sh)) { paint(() => { ctx.beginPath(); ctx.moveTo(-3.5, 0); ctx.lineTo(-2, -12); ctx.lineTo(2, -12); ctx.lineTo(3.5, 0); ctx.closePath(); }, -12, 0); top = -12; }
    else { ctx.lineWidth = 2.4; const n = cs.length; cs.forEach((c, i) => { ctx.strokeStyle = hex(c); ctx.beginPath(); ctx.moveTo(0, -12 + i * 12 / n); ctx.lineTo(0, -12 + (i + 1) * 12 / n); ctx.stroke(); }); top = -12; }
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-4, -0.8, 8, 1.6);
  } else {
    // buoys (INT-1 draws them leaning; upright here)
    if (sh === 'can' || sh === 'barrel') { paint(() => { ctx.beginPath(); ctx.rect(-5, -8, 10, 8); }, -8, 0); top = -8; }
    else if (sh === 'conical') { paint(() => { ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(0, -11); ctx.lineTo(6, 0); ctx.closePath(); }, -11, 0); top = -11; }
    else if (sh === 'spherical') { paint(() => { ctx.beginPath(); ctx.arc(0, -5, 5, 0, Math.PI * 2); }, -10, 0); top = -10; }
    else if (sh === 'spar') { paint(() => { ctx.beginPath(); ctx.rect(-1.6, -13, 3.2, 13); }, -13, 0); top = -13; }
    else if (sh === 'light_vessel') { paint(() => { ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(9, -4); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath(); }, -4, 0); top = -4; }
    else { const big = sh === 'super-buoy' ? 1.4 : 1; paint(() => { ctx.beginPath(); ctx.moveTo(-6 * big, 0); ctx.lineTo(-2.5 * big, -13 * big); ctx.lineTo(2.5 * big, -13 * big); ctx.lineTo(6 * big, 0); ctx.closePath(); }, -13 * big, 0); top = -13 * big; }
    dot();
  }
  if (m.tm) topmarkSym(ctx, m.tm, (m.tc && m.tc[0]) || 'black', top - 1.5);
}
function star(ctx, x, y, R, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r : R; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } ctx.closePath(); }
function topmarkSym(ctx, tm, c, y) {
  ctx.fillStyle = hex(String(c).toLowerCase()); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.8;
  const tri = (yy, up) => { ctx.beginPath(); if (up) { ctx.moveTo(-3.5, yy); ctx.lineTo(0, yy - 5); ctx.lineTo(3.5, yy); } else { ctx.moveTo(-3.5, yy - 5); ctx.lineTo(0, yy); ctx.lineTo(3.5, yy - 5); } ctx.closePath(); ctx.fill(); ctx.stroke(); };
  const ball = (yy) => { ctx.beginPath(); ctx.arc(0, yy - 2.6, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  const t = String(tm).toLowerCase();
  if (t === '2 cones up') { tri(y, true); tri(y - 6, true); }
  else if (t === '2 cones down') { tri(y, false); tri(y - 6, false); }
  else if (t === '2 cones base together') { tri(y, false); tri(y - 5, true); }
  else if (t === '2 cones point together') { tri(y, true); tri(y - 5, false); }
  else if (/cone.*down/.test(t)) tri(y, false);
  else if (/cone/.test(t)) tri(y, true);
  else if (t === '2 spheres') { ball(y); ball(y - 5.4); }
  else if (/sphere/.test(t)) ball(y);
  else if (/cylinder|can/.test(t)) { ctx.fillRect(-3, y - 6, 6, 6); ctx.strokeRect(-3, y - 6, 6, 6); }
  else if (/x-shape|saltire|cross/.test(t)) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-3, y); ctx.lineTo(3, y - 6); ctx.moveTo(-3, y - 6); ctx.lineTo(3, y); ctx.stroke(); }
  else { ctx.fillRect(-3, y - 6, 6, 6); }
}
