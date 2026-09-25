// Game controller: menu, venue loading (baked OSM or live Overpass), live weather, input, the
// fixed-step simulation loop, race flow, AI fleet, cameras.
import { Environment, KT, DEG } from './env.js';
import { Boat, CLASSES, CLASS_ORDER, autoTrim, solvePolarAngle, POLAR_TWAS, vmgTargets, clamp, lerp, wrap, makeSteadyEnv } from './physics.js';
import { VENUES, World, makeProjection, fetchVenueGeo, fetchLiveWind } from './world.js';
import { Course, Race, AIHelm, applyWindShadow, resolveCollisions } from './race.js';
import { Renderer } from './render.js';
import { HUD, pref } from './hud.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { Vector3 as THREE_V } from 'three';
import { Rigging } from './rigging.js';
import { sunPosition } from './sky.js';
import { attachSails } from './sail/sailsim.js';   // (also registers the cloth / lattice sail model with physics.js)

// the player's sail model: ?sails=strip (three strips per sail), vlm (vortex lattice on the rig-set shapes) or
// cloth (cloth shaped by the wind and the rig, forces from a vortex lattice over it)
const SAIL_MODEL = (() => { try { const m = new URLSearchParams(location.search).get('sails'); return ['strip', 'vlm', 'cloth'].includes(m) ? m : 'strip'; } catch (e) { return 'strip'; } })();

const $ = (s) => document.querySelector(s);
const PHYS_DT = 1 / 120;
const GRAB_PX = 30;
const C_RIGHT = (b) => (b.cls.multihull ? 8 : 4); // grab radius on screen, also the size of the marker rings
// the touch pad's third line (in order of use), with the labels for its two buttons (d = -1, +1)
const TOUCH_LINES = { stay: ['Stay', 'Trim', 'Ease', 'Staysail sheet'], trav: ['Trav', 'Up', 'Down', 'Traveler'], hike: ['Hike', 'In', 'Out', 'Crew weight'],
  vang: ['Vang', '−', '+', 'Vang'], tackLine: ['Tack', 'Down', 'Ease', 'Gennaker tack line'], backstay: ['Bstay', '−', '+', 'Backstay'], board: ['Board', 'Up', 'Down', 'Daggerboard'], pushBoom: ['Boom', 'Port', 'Stbd', 'Push the boom out'] };
const NAMES = ['Tern', 'Petrel', 'Skua', 'Gannet', 'Fulmar', 'Shearwater', 'Kittiwake', 'Albatross', 'Puffin', 'Cormorant'];

// reefs the crew ties in at the dock for this much wind (the same rule the AI crews use)
function startReef(C, kn) {
  const max = (C && (C.sails.find(s => s.key === 'main') || {}).reefs) || 0;
  return Math.min(max, kn > 24 ? 2 : kn > 17 ? 1 : 0);
}

class Game {
  constructor() {
    this.renderer = new Renderer($('#view'));
    this.hud = new HUD(this);
    this.audio = new Audio();
    this.net = new Net(this);
    this.netEpoch = null;
    this.geoCache = new Map();
    this.polarCache = new Map();
    this.keys = new Set();
    this.settings = {
      cls: 'blackwatch', venue: 'progreso', mode: 'free', tws: 14, twd: 70, gust: 0.5, shift: 7, swell: 0, current: 0.4,
      fleet: 5, countdown: 120, laps: 1, weather: 'changing', tod: 'afternoon', autoTrim: false, autoHike: true, tiller: false, laylines: true, sound: true,
    };
    this.venueTouched = false;
    // the last setup is remembered (a custom location is not: its coastline is downloaded per visit)
    try {
      const saved = JSON.parse(pref('tw-settings') || 'null');
      if (saved && typeof saved === 'object') {
        for (const k in this.settings) if (k in saved && typeof saved[k] === typeof this.settings[k]) this.settings[k] = saved[k];
        if (!CLASSES[this.settings.cls]) this.settings.cls = 'blackwatch';
        if (!VENUES.some(v => v.id === this.settings.venue)) this.settings.venue = 'progreso';
        this.venueTouched = true; this.restored = true;
      }
    } catch (e) { /* corrupt or blocked storage: defaults */ }
    this.running = false; this.paused = false;
    this.timeWarp = 1;
    this.t = 0;
    this.boats = [];
    this.showLaylines = true;
    this.buildMenu();
    this.bindInput();
    this.bindTouch();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // idle scene behind the menu
    this.startSession(true).catch(e => console.error(e));
  }

  resize() { this.renderer.resize(window.innerWidth, window.innerHeight); }

  // ------------------------------------------------------------ menu
  buildMenu() {
    const bl = $('#boat-list');
    bl.innerHTML = CLASS_ORDER.map(id => {
      const C = CLASSES[id];
      return `<button class="card" data-cls="${id}"><span class="t">${C.name}</span><span class="s">${C.specs}</span><span class="d">${C.blurb}</span></button>`;
    }).join('');
    bl.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => {
      this.settings.cls = c.dataset.cls;
      // the Blackwatch lives in Progreso unless another venue was picked
      if (c.dataset.cls === 'blackwatch' && !this.venueTouched) this.pickVenue('progreso', false);
      this.refreshMenu();
    }));
    const vl = $('#venue-list');
    vl.innerHTML = VENUES.map(v => `<button class="card" data-v="${v.id}"><span class="t">${v.name}</span><span class="s">${v.place}</span><span class="d">${v.note}</span></button>`).join('');
    vl.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => { this.venueTouched = true; this.pickVenue(c.dataset.v, true); }));
    document.querySelectorAll('.seg-b[data-mode]').forEach(b => b.addEventListener('click', () => { this.settings.mode = b.dataset.mode; this.refreshMenu(); }));
    document.querySelectorAll('.seg-b[data-weather]').forEach(b => b.addEventListener('click', () => { this.settings.weather = b.dataset.weather; this.refreshMenu(); }));
    document.querySelectorAll('.seg-b[data-tod]').forEach(b => b.addEventListener('click', () => { this.settings.tod = b.dataset.tod; this.refreshMenu(); if (this.idle) this.clockBase = this.clockFor(); }));
    const sliders = { tws: v => `${v} kn`, twd: v => `${String(v).padStart(3, '0')}°`, gust: v => `${Math.round(v * 100)}%`, shift: v => `±${v}°`, swell: v => v > 0 ? `${v} m` : 'none', current: v => v > 0 ? `${v} kn` : 'none', fleet: v => `${v}`, countdown: v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`, laps: v => `${v}` };
    for (const k in sliders) {
      const el = $('#' + k);
      el.value = this.settings[k];
      const out = $('#' + k + '-v');
      const upd = () => { this.settings[k] = parseFloat(el.value); out.textContent = sliders[k](this.settings[k]); if (k === 'tws') this.windNote(); };
      el.addEventListener('input', upd); upd();
    }
    const checks = { 'opt-trim': 'autoTrim', 'opt-hike': 'autoHike', 'opt-tiller': 'tiller', 'opt-laylines': 'laylines', 'opt-sound': 'sound' };
    for (const id in checks) { const el = $('#' + id); el.checked = this.settings[checks[id]]; el.addEventListener('change', () => { this.settings[checks[id]] = el.checked; }); }
    $('#start').addEventListener('click', () => this.castOff());
    $('#resume').addEventListener('click', () => this.closeMenu());
    $('#help-close').addEventListener('click', () => this.closeHelp());
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') this.closeHelp(); });
    $('#res-keep').addEventListener('click', () => { $('#results').hidden = true; this.syncTools(); });
    $('#res-menu').addEventListener('click', () => this.openMenu());
    $('#res-again').addEventListener('click', () => this.castOff());
    $('#live-wind').addEventListener('click', () => this.liveWind());
    $('#custom-go').addEventListener('click', () => this.customVenue());
    $('#custom-latlon').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.customVenue(); });
    try { $('#net-name').value = localStorage.getItem('tw-name') || ''; $('#net-room').value = localStorage.getItem('tw-room') || ''; } catch (e) {}
    this.pickVenue(this.settings.venue, false, this.restored);
    this.refreshMenu();
  }
  pickVenue(id, fromUser, keepWind = false) {
    this.settings.venue = id;
    const v = VENUES.find(x => x.id === id) || this.customV;
    if (v && !v.open && !keepWind) { this.setSlider('twd', v.wind); this.setSlider('tws', v.windKt); this.setSlider('current', v.current?.kt ?? 0); }
    this.refreshMenu();
  }
  setSlider(k, v) { const el = $('#' + k); el.value = v; el.dispatchEvent(new Event('input')); }
  refreshMenu() {
    document.querySelectorAll('#boat-list .card').forEach(c => c.classList.toggle('on', c.dataset.cls === this.settings.cls));
    document.querySelectorAll('#venue-list .card').forEach(c => c.classList.toggle('on', c.dataset.v === this.settings.venue));
    document.querySelectorAll('.seg-b[data-mode]').forEach(b => { const on = b.dataset.mode === this.settings.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    document.querySelectorAll('.seg-b[data-weather]').forEach(b => { const on = b.dataset.weather === this.settings.weather; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    document.querySelectorAll('.seg-b[data-tod]').forEach(b => { const on = b.dataset.tod === this.settings.tod; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    this.windNote();
    document.body.classList.toggle('racing', this.settings.mode === 'race');
    document.body.classList.toggle('online', this.settings.mode === 'online');
  }
  // what this much wind means for the chosen boat (Beaufort, and whether the crew will reef at the dock)
  windNote() {
    const el = $('#tws-note'); if (!el) return;
    const kn = this.settings.tws, C = CLASSES[this.settings.cls];
    const bf = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64].findIndex(x => kn < x);
    const name = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze', 'near gale', 'gale', 'strong gale', 'storm', 'violent storm', 'hurricane'][bf < 0 ? 12 : bf];
    const plan = startReef(C, kn);
    let txt = `Force ${bf < 0 ? 12 : bf}, ${name}.`, warn = false;
    if (plan > 0) { txt += ` The crew will tie in ${plan === 1 ? 'a reef' : 'two reefs'} before casting off.`; warn = kn > 30; }
    else if (kn > 22) { txt += ` Hard work for a ${C ? C.name : 'small boat'} — expect to be overpowered; automatic trim helps.`; warn = true; }
    el.textContent = kn >= 16 ? txt : '';
    el.classList.toggle('warn', warn);
  }
  async liveWind() {
    const v = this.currentVenueDef();
    const st = $('#live-status');
    if (v.open) { st.textContent = 'Pick a real venue first.'; return; }
    st.textContent = 'Asking Open-Meteo…';
    try {
      const w = await fetchLiveWind(v.lat, v.lon);
      this.setSlider('tws', Math.max(2, Math.round(w.kt * 2) / 2)); this.setSlider('twd', Math.round(w.dir));
      this.setSlider('gust', clamp((w.gustKt - w.kt) / Math.max(w.kt, 1) / 0.8, 0.1, 1));
      st.textContent = `${w.kt.toFixed(0)} kn from ${Math.round(w.dir)}°, gusting ${w.gustKt.toFixed(0)} (${w.time} UTC)`;
    } catch (e) { st.textContent = 'Live weather unavailable here (offline or blocked). Set it by hand.'; }
  }
  async customVenue() {
    const txt = $('#custom-latlon').value.trim();
    const m = txt.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    const st = $('#custom-status');
    if (!m) { st.textContent = 'Type a latitude and longitude, like 50.77, -1.29'; return; }
    const lat = +m[1], lon = +m[2];
    st.textContent = 'Downloading coastline from OpenStreetMap… (can take ~20 s)';
    try {
      const geo = await fetchVenueGeo(lat, lon);
      this.customV = { id: 'custom', name: 'Custom location', place: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, wind: this.settings.twd, windKt: this.settings.tws, depth: 12, note: '' };
      this.geoCache.set('custom', geo);
      this.settings.venue = 'custom';
      this.venueTouched = true;
      st.textContent = `Loaded ${geo.coast.length} coastline pieces, ${geo.water.length} water areas. Press Cast off.`;
      this.refreshMenu();
    } catch (e) { st.textContent = 'Could not reach OpenStreetMap (offline or blocked). Try a built-in venue.'; }
  }
  // where on Earth we are (for the sun and moon); open water is somewhere in the North Atlantic
  skyPlace() { const v = this.currentVenueDef(); return !v || v.open ? { lat: 32, lon: -40 } : { lat: v.lat, lon: v.lon }; }
  // UTC time for the chosen time of day, today, in local solar time at the venue (Live = now)
  clockFor() {
    const tod = this.settings.tod || 'afternoon';
    if (tod === 'live' || this.settings.mode === 'online') return Date.now();
    const { lat, lon } = this.skyPlace(), now = new Date();
    const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const at = (h) => day + (h - lon / 15) * 3600e3;
    const fixed = { morning: 9, noon: 12.3, afternoon: 15.5, night: 23 };
    if (fixed[tod] !== undefined) return at(fixed[tod]);
    // events by the sun's elevation: dawn (rising through -4 deg), golden hour (+7 deg), dusk (-2.5 deg)
    const [h0, h1, target] = tod === 'dawn' ? [2, 12, -4] : tod === 'golden' ? [12, 22, 7] : [12, 23.5, -2.5];
    const rising = tod === 'dawn';
    let prev = sunPosition(at(h0), lat, lon).el / DEG;
    for (let h = h0 + 1 / 60; h <= h1; h += 1 / 60) {
      const e = sunPosition(at(h), lat, lon).el / DEG;
      if (rising ? prev < target && e >= target : prev > target && e <= target) return at(h);
      prev = e;
    }
    return at(rising ? 6 : 18.5);
  }
  currentVenueDef() { return this.settings.venue === 'custom' ? this.customV : VENUES.find(v => v.id === this.settings.venue); }

  openMenu() {
    this.closeHelp();
    $('#results').hidden = true;
    $('#menu').hidden = false; $('#resume').hidden = !this.running;
    document.body.classList.add('menu-open');
    this.menuPaused = !this.paused; this.setPaused(true, true);
    ($('#resume').hidden ? $('#start') : $('#resume')).focus({ preventScroll: true });
  }
  closeMenu() {
    $('#menu').hidden = true; document.body.classList.remove('menu-open');
    if (this.menuPaused) this.setPaused(false, true);
    this.audio.on = this.settings.sound; this.syncTools();
    this.audio.start();
    document.activeElement && document.activeElement.blur();
  }
  async castOff() {
    this.audio.on = this.settings.sound;
    this.audio.start();
    $('#menu').hidden = true; $('#results').hidden = true; document.body.classList.remove('menu-open');
    document.activeElement && document.activeElement.blur();   // Space / Enter must not press Cast off again
    const { venue, ...rest } = this.settings;
    pref('tw-settings', JSON.stringify(venue === 'custom' ? rest : this.settings));
    await this.startSession(false);
    if (!pref('tw-seen-help')) { pref('tw-seen-help', '1'); this.openHelp(); }
  }
  // pause (not in a shared world: everyone's wind runs on one clock)
  setPaused(on, quiet = false) {
    if (on && this.netEpoch !== null) on = false;
    this.paused = on;
    if (!quiet && this.running) this.hud.toast(on ? 'Paused' : 'Sailing', 1);
    this.syncTools();
  }
  openHelp() {
    if (!$('#help').hidden) return;
    $('#help').hidden = false;
    this.helpPaused = this.running && !this.paused && $('#menu').hidden;
    if (this.helpPaused) this.setPaused(true, true);
    $('#help-close').focus({ preventScroll: true });
  }
  closeHelp() {
    if ($('#help').hidden) return;
    $('#help').hidden = true;
    if (this.helpPaused) { this.helpPaused = false; this.setPaused(false, true); }
  }
  toggleSound() {
    this.settings.sound = this.audio.on = !this.audio.on;
    $('#opt-sound').checked = this.audio.on;
    if (this.audio.on) this.audio.start(); else if (this.audio.ctx) this.audio.ctx.suspend();
    this.hud.toast(this.audio.on ? 'Sound on' : 'Sound off', 1);
    this.syncTools();
  }
  // toolbar / pause badge state
  syncTools() {
    const inGame = this.running && $('#menu').hidden;
    $('#paused-badge').hidden = !(this.paused && inGame && $('#help').hidden && $('#results').hidden);
    $('#tb-pause').setAttribute('aria-pressed', String(!!this.paused));
    $('#tb-pause').textContent = this.paused ? 'Play' : 'Pause';
    $('#tb-sound').setAttribute('aria-pressed', String(!!this.audio.on));
    const rigOn = document.body.classList.contains('narrow') ? document.body.classList.contains('rig-open') : !$('#rig').classList.contains('collapsed');
    $('#tb-rig').setAttribute('aria-pressed', String(rigOn));
  }
  cycleCamera() {
    const order = ['chase', 'helm', 'bow', 'mast', 'top', 'orbit', 'deck'];
    const i = order.indexOf(this.renderer.cam.mode);
    this.setCamera(String((i + 1) % order.length + 1));
  }
  setCamera(k) {
    const c = this.renderer.cam;
    const cams = { '1': 'chase', '2': 'helm', '3': 'bow', '4': 'mast', '5': 'top', '6': 'orbit', '7': 'deck' };
    if (!cams[k]) return false;
    c.mode = cams[k];
    if (k === '2' || k === '3' || k === '4') { c.yaw = Math.PI; c.pitch = 0.2; }
    else if (k === '7') { c.yaw = 200 * DEG; c.pitch = 0.45; c.dist = 6; }
    else if (k === '1') { c.yaw = 200 * DEG; c.pitch = 14 * DEG; c.dist = this.player && this.player.cls.id === 'dinghy' ? 8 : 12; }
    else if (k === '5') { c.dist = clamp(c.dist, 5, 60); }
    else if (k === '6') { c.dist = Math.max(c.dist, 14); }
    this.hud.toast({ chase: 'Chase camera', helm: 'At the helm', bow: 'On the bow', mast: 'Masthead', top: 'Overhead, wind up', orbit: 'Orbit', deck: 'On deck — grab the lines' }[cams[k]], 1.2);
    return true;
  }

  // ------------------------------------------------------------ session setup
  async loadGeo(v) {
    if (v.open) return null;
    if (this.geoCache.has(v.id)) return this.geoCache.get(v.id);
    const r = await fetch(`data/venues/${v.id}.json`);
    const g = await r.json();
    this.geoCache.set(v.id, g);
    return g;
  }

  async startSession(idle) {
    const S = this.settings;
    const v = this.currentVenueDef();
    if (!idle) { $('#loading').hidden = false; $('#loading-text').textContent = `Loading chart: ${v.name}`; }
    await new Promise(r => setTimeout(r, 30));
    const geo = await this.loadGeo(v).catch(() => null);
    const manifest = v.open ? null : await fetch(`data/venues/${v.id}.features.json`).then(r => r.ok ? r.json() : null).catch(() => null);
    this.venue = v; this.geo = geo; this.manifest = manifest;
    this.obstacles = null;
    const world = new World(v, geo);
    this.world = world;
    this.obstacles = ((geo && geo.piers) || []).filter(p => p.kind !== 'bridge' || (() => { let wet = 0; for (let i = 0; i < p.pts.length; i += 2) if (world.sdfAt(p.pts[i], p.pts[i + 1]) > 0) wet++; return wet > 0; })());
    const online = S.mode === 'online' && !idle;
    const cond = {
      seed: Math.floor(Math.random() * 100000), epoch: Date.now() / 1000,
      tws: idle ? v.windKt : S.tws, twd: idle ? v.wind : S.twd, gust: S.gust, shift: S.shift, swell: S.swell,
      current: idle ? 0 : S.current, currentDir: v.current?.dir ?? 90, weather: idle ? 'steady' : S.weather,
    };
    this.cond = cond;
    const env = this.makeEnv(cond);
    const twd = cond.twd * DEG;
    this.renderer.setWorld(world, geo, manifest);
    this.renderer.setWaves(env.waves);
    this.hud.setWorld(world);
    // boats
    this.renderer.removeAllBoats();
    this.boats = []; this.ais = [];
    this.race = null; this.course = null; this.waypoint = null;
    $('#results').hidden = true;
    const cls = CLASSES[S.cls];
    const player = new Boat(cls, { id: 0, name: 'You', sailModel: SAIL_MODEL, lod: SAIL_MODEL === 'strip' ? 2 : this.sailLevelFor(cls) });
    player.auto.trim = S.autoTrim; player.auto.hike = S.autoHike;
    // in a blow the crew ties in the reefs before leaving (shaking one out is a keypress away)
    const dockReef = idle ? 0 : startReef(cls, cond.tws);
    if (dockReef) player.ctrl.reef = dockReef;
    this.player = player;
    this.boats.push(player);
    const P = makeProjection(v.lat, v.lon);
    const safe = (x, z, need) => { // nearest water deep enough for this keel
      if (world.depthAt(x, z) > need) return [x, z];
      for (let r = 20; r < 3000; r += 20) for (let a = 0; a < 6.28; a += 0.3) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (world.depthAt(px, pz) > need && world.sdfAt(px, pz) > 25) return [px, pz];
      }
      return [x, z];
    };
    if (S.mode === 'race' && !idle) {
      const course = new Course(world, twd, { length: cls.id === 'dinghy' ? 600 : 800, laps: S.laps, lineLength: 60 + 14 * (S.fleet + 1) });
      this.course = course;
      const n = S.fleet;
      const spots = [];
      for (let i = 0; i <= n; i++) {
        const off = (i - n / 2) * 16;
        spots.push([course.origin.x - course.ux * 170 + course.rx * off, course.origin.z - course.uz * 170 + course.rz * off]);
      }
      player.reset(spots[0][0], spots[0][1], twd + Math.PI / 2);
      this.presetTrim(player);
      for (let i = 1; i <= n; i++) {
        const b = new Boat(cls, { id: i, name: NAMES[(i - 1) % NAMES.length] });
        b.reset(spots[i][0], spots[i][1], twd + Math.PI / 2);
        b.auto.hike = true;
        this.boats.push(b);
        const ai = new AIHelm(b, { skill: 0.8 + Math.random() * 0.18, startFrac: Math.random() });
        this.ais.push(ai);
      }
      this.race = new Race(course, this.boats, { countdown: S.countdown });
      this.renderer.setMarks(course.marks(), course.committee);
    } else {
      let x = 0, z = 0, hdg = twd + Math.PI / 2;
      if (v.spawn) { [x, z] = P.fwd(v.spawn.lat, v.spawn.lon); hdg = v.spawn.heading * DEG; }
      else if (!world.open) { const c = world.findCourse(twd, 400); x = c.x; z = c.z; }
      if (online) { const a = Math.random() * 6.28, r = 40 + Math.random() * 120; x += Math.cos(a) * r; z += Math.sin(a) * r; }
      [x, z] = safe(x, z, cls.draft + 0.6);
      player.reset(x, z, hdg);
      player.u = 1.2;
      this.presetTrim(player);
      this.renderer.setMarks([], null);
      if (idle) { player.auto.trim = true; }
    }
    for (const b of this.boats) this.renderer.addBoat(b, { player: b === player, number: b === player ? (cls.id === 'blackwatch' ? '79' : '7') : String(100 + b.id * 7), hullColor: b === player ? undefined : [0xf4f1ea, 0xd9e2ea, 0x1d4e89, 0x8b1e2d, 0x2e5e4e, 0xe8d8b0, 0x3a3f47, 0xb8c4cc, 0x6b4f3a][b.id % 9] });
    this.hud.buildRig(player);
    document.body.classList.toggle('no-jib', !player.sailBy.jib);
    this.buildTouch(player);
    this.renderer.cam.mode = idle ? 'orbit' : 'chase';
    this.renderer.cam.yaw = idle ? 0 : 200 * DEG; this.renderer.cam.pitch = 14 * DEG; this.renderer.cam.dist = idle ? 26 : cls.id === 'dinghy' ? 8 : 12;
    this.t = 0; this.acc = 0; this.timeWarp = 1;
    this.idle = idle;
    this.clockBase = this.clockFor();
    this.sharedRace = null;
    if (this.net.connected) this.net.disconnect();
    this.netEpoch = null;
    if (online) {
      const name = ($('#net-name').value || '').trim() || 'Sailor ' + Math.floor(Math.random() * 900 + 100);
      const room = ($('#net-room').value || '').trim() || 'public';
      try { localStorage.setItem('tw-name', name); localStorage.setItem('tw-room', room); } catch (e) {}
      this.netEpoch = cond.epoch;
      this.net.since = Date.now();
      this.net.connect({ venueId: v.id === 'custom' ? `c${v.lat.toFixed(2)},${v.lon.toFixed(2)}` : v.id, room, name, cls: cls.id, cond })
        .then(() => this.hud.toast(`Online in room “${room}” at ${v.name}`, 3))
        .catch(() => { this.hud.toast('Could not reach the relays — sailing offline', 4); });
    }
    this.showLaylines = S.laylines;
    this.polar = null; this.targets = null;
    this.computePolar(cls, env.wind.tws);
    $('#loading').hidden = true;
    if (!idle) {
      $('#hud').hidden = false;
      this.running = true; this.paused = false;
      if (!online) this.hud.toast(S.mode === 'race' ? `Race at ${v.name} — gun in ${Math.floor(S.countdown / 60)}:${String(S.countdown % 60).padStart(2, '0')}` : `${cls.name} · ${v.name}`, 3.5);
      if (dockReef) setTimeout(() => this.hud.toast(`${cond.tws} kn: ${dockReef === 1 ? 'one reef' : 'two reefs'} tied in at the dock — R to change`, 4), 3600);
      else if (cond.tws > 22) setTimeout(() => this.hud.toast(`${cond.tws} kn is a lot for a ${cls.name} — ease early, T for automatic trim`, 4), 3600);
      if (this.race) this.audio.horn(true);
      this.hud.keysHint(document.body.classList.contains('touch'));
      this.syncTools();
    }
  }

  // Environment from a conditions record (shared verbatim between online peers)
  makeEnv(cond) {
    const world = this.world, v = this.venue;
    const twd = cond.twd * DEG;
    world.updateShelter(twd);
    // waves: fetch-limited by the real coastline upwind of the sailing area
    const fetchM = world.open ? 60000 : world.fetchAt(0, 0, twd, 6000);
    // open ocean: effectively unlimited fetch, the sea grows to fully developed (Pierson-Moskowitz)
    const fetchKm = world.open ? 2000 : fetchM >= 6000 ? 25 : Math.max(0.4, fetchM / 1000);
    const env = new Environment({
      tws: cond.tws * KT, twd: cond.twd, gust: cond.gust, shift: cond.shift, seed: cond.seed, weather: cond.weather ?? 'changing',
      fetchKm, swellH: cond.swell, swellT: 5 + 3.2 * Math.sqrt(Math.max(0.1, cond.swell)),   // longer swell for bigger swell
      currentKt: cond.current, currentDir: cond.currentDir,
      hemi: v && !v.open && v.lat < 0 ? -1 : 1,     // puffs and squalls veer north of the equator, back south of it
      // sea/lake and land breezes by the real sun at the venue. clock0 = UTC ms at t = 0: online it is the
      // room's shared epoch (every peer's clock is epoch + t), offline the chosen time of day
      thermal: world.open || !v ? null : { lat: v.lat, lon: v.lon, land: world,
        clock0: this.settings.mode === 'online' && cond.epoch ? cond.epoch * 1000 : this.clockFor() },
    });
    // sheltering by land slows the wind near a weather shore
    const base = env.wind.sample.bind(env.wind);
    env.wind.sample = (x, z, t, o = {}) => { base(x, z, t, o); o.speed *= world.shelterAt(x, z); return o; };
    if (!world.open) env.waves.scaleFn = (x, z) => clamp(world.sdfAt(x, z) / 60, 0.08, 1);
    env.waves.buildDepthField(world);              // finite-depth dispersion over the real bottom
    env.tick(0);
    this.env = env;
    if (this.renderer) this.renderer.setPhaseField(env.waves);
    return env;
  }

  // another sailor in the room arrived first: take their wind, sea and clock
  applySharedConditions(cond) {
    this.cond = cond;
    this.makeEnv(cond);
    this.renderer.setWaves(this.env.waves);
    this.netEpoch = cond.epoch;
    this.t = Date.now() / 1000 - cond.epoch;
    this.computePolar(this.player.cls, this.env.wind.tws);
    this.hud.toast(`Room conditions: ${cond.tws} kn from ${String(Math.round(cond.twd)).padStart(3, '0')}°`, 3);
  }

  addRemoteBoat(b) {
    this.boats.push(b);
    const idx = this.boats.length;
    this.renderer.addBoat(b, { number: String(200 + (idx * 37) % 700), hullColor: [0xd9e2ea, 0x1d4e89, 0x8b1e2d, 0x2e5e4e, 0xe8d8b0, 0x3a3f47, 0xb8c4cc][idx % 7], label: b.name });
  }
  removeRemoteBoat(b) {
    this.boats = this.boats.filter(x => x !== b);
    this.renderer.removeBoat(b);
  }

  // one race for the whole room: same course (deterministic from the real map and wind), same gun
  startSharedRace() {
    const msg = { gun: Date.now() / 1000 + 120, laps: this.settings.laps, length: this.player.cls.id === 'dinghy' ? 600 : 800, twd: this.env.wind.twd, by: this.net.name, id: Math.random().toString(36).slice(2, 8) };
    this.onNetRace(msg, null);
    this.net.broadcastRace(msg);
  }
  onNetRace(msg, from) {
    if (!msg || (this.sharedRace && this.sharedRace.id === msg.id)) return;
    const countdown = msg.gun - Date.now() / 1000;
    if (countdown < -600) return;
    this.sharedRace = msg;
    const course = new Course(this.world, msg.twd, { length: msg.length, laps: msg.laps, lineLength: 140 });
    this.course = course;
    this.race = new Race(course, [this.player], { countdown });
    this.renderer.setMarks(course.marks(), course.committee);
    this.waypoint = null;
    this.hud.toast(`${from ? msg.by : 'You'} started a race — gun in ${Math.max(0, Math.round(countdown))} s`, 4);
    this.audio.horn(true);
  }
  // standings for the race card: local fleet, plus remote sailors' reported progress
  raceStandings() {
    if (!this.race) return [];
    const C = this.course;
    const list = this.race.standings().map(r => ({ name: r.boat === this.player ? 'You' : r.boat.name, me: r.boat === this.player, finished: r.finished, time: r.finishTime, leg: r.leg, boat: r.boat }));
    if (this.sharedRace) {
      for (const b of this.boats) {
        if (!b.remote || !b.netRace || b.netRace.id !== this.sharedRace.id) continue;
        list.push({ name: b.name, me: false, finished: !!b.netRace.fin, time: b.netRace.fin, leg: b.netRace.leg, boat: b });
      }
      const score = (e) => e.finished ? 1e9 - e.time : e.leg * 1e5 - (() => { const t = C.target(C.legs[Math.min(e.leg, C.legs.length - 1)], e.boat); return Math.hypot(e.boat.x - t.x, e.boat.z - t.z); })();
      list.sort((a, b) => score(b) - score(a));
    }
    return list;
  }

  // the crew sets the sails for the initial heading before handing over
  presetTrim(b) {
    b.reefPos = b.ctrl.reef | 0;   // reefs tied in at the dock are already in, not being tied in
    const keep = { x: b.x, z: b.z, psi: b.psi };
    for (let i = 0; i < 240; i++) { autoTrim(b, 1 / 60, 0, true); b.step(1 / 60, this.env, 0, this.world); b.psi = keep.psi; b.r = 0; }
    b.x = keep.x; b.z = keep.z;
    b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.stay = b.ctrl.stay; b.lines.lazy = b.ctrl.lazy = 1;
  }

  // VPP for the current wind, computed in a worker (falls back to slices on the main thread)
  computePolar(cls, tws) {
    const key = cls.id + ':' + Math.round(tws / KT);
    this.polarTws = tws;
    this._polarKey = key;
    if (this.polarCache.has(key)) { this.setPolar(this.polarCache.get(key)); return; }
    try {
      if (!this.vppWorker) {
        this.vppWorker = new Worker(new URL('./vpp-worker.js', import.meta.url), { type: 'module' });
        this.vppWorker.onmessage = (e) => { this.polarCache.set(e.data.key, e.data.polar); if (e.data.key === this._polarKey) this.setPolar(e.data.polar); };
      }
      this.vppWorker.postMessage({ key, cls: cls.id, tws });
      return;
    } catch (e) { /* no module workers: compute in slices */ }
    const out = [];
    let i = 0;
    const token = this._polarToken = {};
    const step = () => {
      if (token !== this._polarToken) return;
      out.push(solvePolarAngle(cls, tws, POLAR_TWAS[i++]));
      if (i < POLAR_TWAS.length) setTimeout(step, 0);
      else { this.polarCache.set(key, out); this.setPolar(out); }
    };
    setTimeout(step, 50);
  }
  setPolar(p) {
    this.polar = p; this.targets = vmgTargets(p);
    for (const ai of this.ais) ai.targetsUpBsp = this.targets.up.bsp;
  }

  navTarget() {
    if (this.race) {
      const r = this.race.racers[0];
      if (r.finished) return null;
      return this.course.target(this.course.legs[r.leg], this.player);
    }
    return this.waypoint;
  }
  onWaypoint() { this.renderer.setMarks(this.waypoint ? [this.waypoint] : [], null); }

  userTouched(k) {
    const trimKeys = ['main', 'jib', 'lazy', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibLead', 'jibHalyard', 'tackLine', 'board'];
    if (trimKeys.includes(k) && this.player.auto.trim) { this.player.auto.trim = false; this.hud.toast('Automatic trim off — you have the sheets'); }
    if ((k === 'hike' || k === 'crewAft') && this.player.auto.hike) { this.player.auto.hike = false; this.hud.toast('Automatic weight off — you place your weight'); }
  }
  toggleAutoTrim() { this.player.auto.trim = !this.player.auto.trim; this.hud.toast(this.player.auto.trim ? 'Automatic trim on' : 'Automatic trim off — you trim the sails'); }
  toggleAutoHike() { this.player.auto.hike = !this.player.auto.hike; this.hud.toast(this.player.auto.hike ? 'Automatic weight placement on' : 'Automatic weight off — you place your weight (Q/E)'); }
  // the side panel's buttons: same rates as the keys, loaded sheets come in slower
  // throw the working jib sheet off the winch: it runs out and the clew is free to cross
  letFly() { const b = this.player; if (!b.sailBy.jib) return; this.userTouched('jib'); b.locks.jib = false; this.audio.click && this.audio.click(); this.hud.toast('Jib sheet out of the self-tailer — it runs free', 1.4); }
  // cleat / release a line (cam cleat, clutch or self-tailer)
  toggleLock(k) {
    const b = this.player; if (!b.locks || !(k in b.locks)) return;
    this.userTouched(k); b.locks[k] = !b.locks[k]; this.audio.click && this.audio.click();
    const names = { main: 'Mainsheet', jib: 'Jib sheet', lazy: 'Lazy jib sheet', stay: 'Staysail sheet', trav: 'Traveler', vang: 'Vang', cunn: 'Cunningham', outhaul: 'Outhaul', backstay: 'Backstay', jibHalyard: 'Jib halyard', tackLine: 'Tack line' };
    this.hud.toast(`${names[k] || k} ${b.locks[k] ? 'cleated' : 'released — it runs under load'}`, 1.4);
  }
  // hauling a line seats it in its cleat or self-tailer; while the player works it, it does not run
  working(k, trimming) { const b = this.player; if (!b.locks || !(k in b.locks)) return; b.held[k] = 0.3; if (trimming) b.locks[k] = true; }
  nudge(k, d, dt) {
    const b = this.player, c = b.ctrl, C = b.cls;
    if (k === 'helm') { c.helm = clamp(c.helm + d * 0.9 * dt, -1, 1); return; }
    if (k === 'pushBoom') { c.pushBoom = d; this.pushHeld = true; clearTimeout(this._pbT); this._pbT = setTimeout(() => { this.pushHeld = false; c.pushBoom = 0; }, 120); return; }
    if (k === 'hike') { this.userTouched('hike'); c.hike = clamp(c.hike + d * 1.2 * dt, -1, 1); return; }
    this.userTouched(k);
    let rate = 0.3 * dt;
    const load = k === 'main' ? b.diag.rig.mainLoad : k === 'jib' || k === 'lazy' ? b.diag.rig.jibLoad : k === 'stay' ? b.diag.rig.stayLoad : 0;
    const trimming = (k === 'main' || k === 'jib' || k === 'stay' || k === 'lazy' || k === 'trav') ? d < 0 : k === 'tackLine' ? d < 0 : d > 0;
    if (trimming && (k === 'main' || k === 'jib' || k === 'stay' || k === 'lazy')) rate /= 1 + ((load || 0) / C.sheetPower) ** 2;
    this.working(k, trimming);
    c[k] = clamp(c[k] + d * rate, 0, 1);
  }
  grabIdForKey(k) { return Rigging.idForKey(k, this.player); }
  setReef(r) {
    const b = this.player, max = b.sailBy.main.reefs || 0;
    b.ctrl.reef = clamp(r, 0, max);
    this.hud.toast(b.ctrl.reef > b.reefPos ? `Reefing to ${['full', 'first', 'second'][b.ctrl.reef]} reef — halyard off` : b.ctrl.reef < b.reefPos ? 'Shaking out the reef' : 'Reef unchanged', 2);
  }
  rightBoat() {
    const b = this.player;
    if (b.capsized || Math.abs(b.phi) > 50 * DEG) { b.righting = true; this.hud.toast(b.cls.multihull ? 'On the righting line — lean back' : 'Standing on the daggerboard — lean back', 3); } else this.hud.toast('The boat is upright', 1.2);
  }
  toggleGen() {
    const b = this.player; if (!b.sailBy.gennaker) return;
    b.ctrl.gen = !b.ctrl.gen; this.hud.toast(b.ctrl.gen ? 'Gennaker going up' : 'Dousing the gennaker');
    this.syncTouch();
  }
  // touch pad: helm, main and jib, plus one more line of the class, picked by tapping its name
  buildTouch(b) {
    const rows = this.hud.rows || [];
    this.touchLines = Object.keys(TOUCH_LINES).filter(k => rows.includes(k));
    this.touchSel = 0;
    $('#tp-gen').hidden = !b.sailBy.gennaker;
    $('#touch .tp-trim').classList.toggle('has-gen', !!b.sailBy.gennaker);
    this.syncTouch();
  }
  syncTouch() {
    const b = this.player; if (!b || !this.touchLines) return;
    const k = this.touchLines[this.touchSel % this.touchLines.length], [name, lo, hi] = TOUCH_LINES[k];
    $('#tp-sel').textContent = `${name} ▸`;
    $('#tp-x0').dataset.k = k; $('#tp-x0').textContent = lo;
    $('#tp-x1').dataset.k = k; $('#tp-x1').textContent = hi;
    $('#tp-gen').textContent = b.ctrl.gen ? 'Douse' : 'Hoist';
    $('#tp-jibl').textContent = b.ctrl.gen && b.sailBy.gennaker ? 'Genn.' : 'Jib';
  }

  // ------------------------------------------------------------ input
  bindInput() {
    const tgtSel = (e) => e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox';
    window.addEventListener('keydown', (e) => {
      if (tgtSel(e)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.repeat && this.keys.has(k)) return;
      this.keys.add(k);
      if (e.shiftKey) this.keys.add('Shift');
      this.onKey(k, e);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k); if (e.key === 'Shift') this.keys.delete('Shift');
    });
    window.addEventListener('blur', () => this.keys.clear());
    // a background tab stops drawing frames: silence the sea too, and bring it back on return
    document.addEventListener('visibilitychange', () => {
      const ctx = this.audio.ctx; if (!ctx) return;
      if (document.hidden) ctx.suspend(); else if (this.audio.on && this.running) ctx.resume();
    });
    const cv = $('#view');
    let drag = null;
    const touches = new Map();   // two fingers pinch to zoom
    let pinch = null;
    const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) { pinch = spread(); drag = null; this._dragging = false; return; }
        if (touches.size > 2) return;
      }
      if (this.running && !this.idle) this.updateHover(e.clientX, e.clientY);   // a finger has no hover: pick up what it lands on
      const g = this.running && !this.idle ? this.hoverGrab : null;
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, grab: g, ang: null, clickDist: 0, shift: e.shiftKey };
      this._dragging = true;
      if (g) { cv.style.cursor = 'grabbing'; this.onGrabStart(g); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && touches.size === 2) { const s2 = spread(); if (s2 > 0 && pinch > 0) this.zoom(pinch / s2); pinch = s2; return; }
      }
      if (e.pointerType !== 'touch') this.mouse = [e.clientX, e.clientY];
      if (!drag) { this.updateHover(e.clientX, e.clientY); return; }
      if (drag.grab) { this.onGrabDrag(drag, e.clientX, e.clientY); }
      else {
        const c = this.renderer.cam;
        c.yaw -= (e.clientX - drag.x) * 0.005; c.pitch = clamp(c.pitch + (e.clientY - drag.y) * 0.004, -0.2, 1.45);
      }
      drag.clickDist += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    cv.addEventListener('pointerleave', () => { this.mouse = null; if (!drag) { this.hoverGrab = null; const tip = $('#grab-tip'); if (tip) tip.hidden = true; } });
    const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
    cv.addEventListener('pointercancel', (e) => { lift(e); drag = null; this._dragging = false; });
    cv.addEventListener('pointerup', (e) => {
      lift(e);
      if (drag && drag.grab && (drag.grab.kind === 'click' || drag.grab.onClick) && drag.clickDist < 8) this.onGrabClick(drag.grab, drag.shift);
      drag = null; this._dragging = false; cv.style.cursor = this.hoverGrab ? 'grab' : '';
      if (e.pointerType === 'touch') { this.hoverGrab = null; $('#grab-tip').hidden = true; }
    });
    cv.addEventListener('wheel', (e) => this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12), { passive: true });
  }
  // f > 1 backs the camera off; zooming in past the chase camera's closest puts you at the helm
  zoom(f) {
    const c = this.renderer.cam, out = f > 1;
    if (c.mode === 'helm' || c.mode === 'bow' || c.mode === 'mast') { if (out && f > 1.05) { c.mode = 'chase'; c.dist = 4.5; c.yaw = 200 * DEG; c.pitch = 0.12; } return; }
    if (c.mode === 'top') { c.dist = clamp(c.dist * f, 5, 400); return; }
    const next = c.dist * f;
    if (!out && next < 3.5 && (c.mode === 'chase' || c.mode === 'deck')) { c.mode = 'helm'; c.yaw = Math.PI; c.pitch = 0.15; this.hud.toast('At the helm', 1); return; }
    c.dist = clamp(next, 3.5, 600);
  }

  // ---------------------------------------------------------------- deck handling
  updateHover(mx, my) {
    const tip = $('#grab-tip');
    this.hoverGrab = null;
    if (!this.running || this.idle || !$('#menu').hidden) { tip.hidden = true; return; }
    const vis = this.renderer.boats.get(this.player);
    if (!vis) return;
    const list = vis.rigging.grabs();
    const cam = this.renderer.camera, W = window.innerWidth, H = window.innerHeight;
    let best = null, bd = GRAB_PX;
    for (const g of list) {
      const p = g.pos.clone().project(cam);
      if (p.z > 1) continue;
      const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bd) { bd = d; best = { ...g, sx, sy }; }
    }
    this.hoverGrab = best;
    vis.rigging.highlight(best ? best.id : this.panelHover || null);
    $('#view').style.cursor = best ? 'grab' : '';
    if (best) {
      tip.hidden = false;
      tip.style.left = best.sx + 16 + 'px'; tip.style.top = best.sy - 10 + 'px';
      tip.innerHTML = `<b>${best.label}</b><span>${best.info()}</span><em>${best.hint}</em>`;
    } else tip.hidden = true;
  }
  screenOf(v) { const p = v.clone().project(this.renderer.camera); return [(p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight]; }
  onGrabStart(g) {
    const b = this.player;
    if (g.key) this.userTouched(g.key);
    if (g.kind === 'crank') {
      const R = this.renderer.boats.get(b).rigging;
      if (R.handleOn !== g.role) { R.handleOn = g.role; this.audio.click && this.audio.click(); }
      this.hud.toast('Wind the handle round: clockwise = fast gear, anticlockwise = slow powerful gear', 1.8);
    }
  }
  onGrabClick(g, shift) {
    const b = this.player;
    if (g.action === 'lock') this.toggleLock(g.key);
    else if (g.onClick === 'letFly') this.letFly();
    else if (g.onClick === 'cycleCabin') { const R = this.renderer.boats.get(b).rigging, k = R.cycleCabinLine(); this.hud.toast(`Cabin-top winch: ${R.constructor.lineName(k)} on the drum`, 1.5); }
    else if (g.action === 'gen') this.toggleGen();
    else if (g.action === 'reef') {
      const max = b.sailBy.main.reefs;
      b.ctrl.reef = clamp((b.ctrl.reef | 0) + (shift ? -1 : 1), 0, max);
      this.hud.toast(shift ? 'Shaking out a reef' : `Reefing to ${b.ctrl.reef === 1 ? 'first' : 'second'} reef — halyard off`);
    }
  }
  onGrabDrag(drag, mx, my) {
    const g = drag.grab, b = this.player, c = b.ctrl, C = b.cls;
    const load = g.key === 'main' ? b.diag.rig.mainLoad : g.key === 'jib' ? b.diag.rig.jibLoad : g.key === 'lazy' ? (b.backedByLazy ? b.diag.rig.jibLoad : (b.diag.rig.jibLoad || 0) * 0.3) : g.key === 'stay' ? b.diag.rig.stayLoad : 0;
    const effort = 1 / (1 + ((load || 0) / C.sheetPower) ** 2);   // heavy lines come in slowly
    if (g.kind === 'pull') {
      const dy = (drag.y - my) * 0.0035;                            // up = pull
      if (g.easeOnly && dy > 0) return;
      let delta = g.dir * dy;
      const trimming = (g.dir < 0 && dy > 0) || (g.dir > 0 && dy > 0);
      if (trimming) delta *= g.handTail ? effort * effort * 0.6 : effort;  // tailing by hand only works while the sheet is light
      const tr = ['main', 'jib', 'stay', 'lazy', 'tackLine'].includes(g.key) ? delta < 0 : delta > 0;
      this.working(g.key, tr);
      c[g.key] = clamp(c[g.key] + delta, 0, 1);
    } else if (g.kind === 'track') {
      const [ax, ay] = this.screenOf(g.A), [bx, by] = this.screenOf(g.B);
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
      let t = clamp(((mx - ax) * vx + (my - ay) * vy) / L2, 0, 1);
      if (g.key === 'trav') { // track A is port, B starboard; the control is windward -> leeward
        const lee = Math.sign(b.booms.main.a) || 1;
        t = lee > 0 ? t : 1 - t;
      }
      this.working(g.key, true);
      c[g.key] = lerp(c[g.key], t, 0.5);
    } else if (g.kind === 'crank') {
      const [cx, cy] = [g.sx ?? drag.x0, g.sy ?? drag.y0];
      const ang = Math.atan2(my - cy, mx - cx);
      if (drag.ang !== null) {
        let da = ang - drag.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        // two-speed self-tailer: winding either way hauls line in (the ratchet stops it running back);
        // clockwise is the fast gear, anticlockwise the low gear — a third of the speed, three times the power
        // a winch hauls a fixed length of line per turn of the handle (drum ~19 cm round, fast gear 1:1, slow
        // gear 1:3); the load only decides whether you can turn it: in the fast gear a heavy sheet stalls it
        const low = da < 0, R = this.renderer.boats.get(b).rigging;
        R.lowGear = low;
        const gear = low ? 1 / 3 : 1;
        const ld = (g.trim > 0 ? (c[g.key] || 0) * 1.3 * C.sheetPower : (load || 0)) / C.sheetPower;
        const stall = !low && ld > 0.7;
        if (stall) { if (!drag.stallMsg) { drag.stallMsg = true; this.hud.toast('Too heavy for the fast gear — wind anticlockwise (slow gear)', 1.8); } }
        else {
          R.handleCrank = (R.handleCrank || 0) - da; R.crankT = performance.now();   // the handle follows your hand, either way
          const travel = g.trim > 0 ? 0.8 : g.key === 'lazy' ? 1.4 : (b.genDeploy > 0.5 ? 3.0 : 1.4);   // metres of line over the control's range
          const dl = Math.abs(da) / (2 * Math.PI) * 0.19 * gear / travel;
          c[g.key] = clamp(c[g.key] + g.trim * dl, 0, 1);
          if (g.key === 'jib' || g.key === 'lazy') b.lines[g.key] = clamp(Math.min(b.lines[g.key], c[g.key] + 0.002), 0, 1);  // the line comes in as the drum turns
          this.working(g.key, true);
        }
        if (!stall) drag.clicks = (drag.clicks || 0) + Math.abs(da);
        if (drag.clicks > (low ? 0.25 : 0.5)) { drag.clicks = 0; this.audio.click(); }
      }
      drag.ang = ang;
    } else if (g.kind === 'tiller') {
      // moving the tiller toward starboard turns the bow to port
      const vis = this.renderer.boats.get(b);
      const o = vis.inner.localToWorld(new THREE_V(0, 0, 0)), s = vis.inner.localToWorld(new THREE_V(1, 0, 0));
      const [ox, oy] = this.screenOf(o), [sx, sy] = this.screenOf(s);
      const ux = sx - ox, uy = sy - oy, ul = Math.hypot(ux, uy) || 1;
      const along = ((mx - drag.x) * ux + (my - drag.y) * uy) / ul;
      c.helm = clamp(c.helm - along * 0.006, -1, 1);
      this.tillerHeld = performance.now();
    }
  }

  onKey(k, e) {
    if (k === 'Escape') {
      if (!$('#help').hidden) { this.closeHelp(); return; }
      if (!$('#results').hidden) { $('#results').hidden = true; this.syncTools(); return; }
      if (document.body.classList.contains('rig-open')) { this.toggleRig(); return; }
      if ($('#menu').hidden) this.openMenu(); else if (this.running) this.closeMenu();
      return;
    }
    if (k === 'F1' || k === '?' || (k === 'h' && e.shiftKey)) { e.preventDefault(); if ($('#help').hidden) this.openHelp(); else this.closeHelp(); return; }
    if (!this.running || !$('#menu').hidden || !$('#help').hidden) return;
    const b = this.player;
    if (this.setCamera(k)) return;
    if (k === 'h') this.toggleAutoHike();
    else if (k === 't') this.toggleAutoTrim();
    else if (k === 'g') this.toggleGen();
    else if (k === 'o') this.toggleSound();
    else if (k === 'l') { this.showLaylines = !this.showLaylines; this.hud.toast(this.showLaylines ? 'Laylines on' : 'Laylines off', 1.2); }
    else if (k === 'k') { this.renderer.showForces = !this.renderer.showForces; this.hud.toast(this.renderer.showForces ? 'Force vectors: sails yellow, drive green, keel blue, rudder violet, wind white/teal' : 'Force vectors off', 3); }
    else if (k === 'i') { $('#physics').hidden = !$('#physics').hidden; }
    else if (k === 'p' && this.netEpoch !== null) { this.hud.toast('No pausing in a shared world', 1.5); }
    else if (k === 'p') this.setPaused(!this.paused);
    else if (k === 'y' && b.cls.hasBoard) { this.userTouched('board'); b.ctrl.board = b.ctrl.board > 0.5 ? 0.25 : 1; this.hud.toast(b.ctrl.board > 0.5 ? 'Board down' : 'Board up', 1.2); }
    else if (k === 'r') {
      if (b.capsized) this.rightBoat();
      else if (b.sailBy.main.reefs) this.setReef(((b.ctrl.reef | 0) + 1) % (b.sailBy.main.reefs + 1));
    }
    else if (k === 'f' && b.sailBy.jib) this.letFly();
    else if (k === ' ') b.ctrl.helm = 0;
    else if (k === '=' || k === '+') this.warp(2);
    else if (k === '-') this.warp(0.5);
  }
  // time warp: free sail, or the waiting part of an offline start sequence (drops back to 1x before the gun)
  canWarp() { return this.netEpoch === null && (!this.race || (!this.sharedRace && this.race.clock < -20)); }
  warp(f) {
    if (f > 1 && !this.canWarp()) { this.hud.toast(this.race ? 'Time warp only before the last 20 s of the start sequence' : 'No time warp in a shared world', 1.6); return; }
    this.timeWarp = clamp(this.timeWarp * f, 1, 8);
    this.hud.toast(`Time ×${this.timeWarp}`, 1);
  }
  toggleRig() {
    if (document.body.classList.contains('narrow')) document.body.classList.toggle('rig-open');
    else this.hud.setRigCollapsed(!$('#rig').classList.contains('collapsed'));
    this.syncTools();
  }

  // toolbar, touch pad and pinch zoom
  bindTouch() {
    const narrow = matchMedia('(max-width: 720px)'), coarse = matchMedia('(pointer: coarse)');
    const upd = () => { document.body.classList.toggle('narrow', narrow.matches); document.body.classList.toggle('touch', coarse.matches); if (!narrow.matches) document.body.classList.remove('rig-open'); if (this.hud) this.syncTools(); };
    narrow.addEventListener('change', upd); coarse.addEventListener('change', upd); upd();
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { fn(); e.currentTarget.blur(); });
    tap('#tb-menu', () => this.openMenu());
    tap('#tb-pause', () => { if (this.netEpoch !== null) this.hud.toast('No pausing in a shared world', 1.5); else this.setPaused(!this.paused); });
    tap('#tb-cam', () => this.cycleCamera());
    tap('#tb-rig', () => this.toggleRig());
    tap('#tb-sound', () => this.toggleSound());
    tap('#tb-help', () => this.openHelp());
    tap('#tp-centre', () => { this.player.ctrl.helm = 0; });
    tap('#tp-auto', () => this.toggleAutoTrim());
    tap('#tp-sel', () => { this.touchSel = (this.touchSel + 1) % Math.max(1, this.touchLines.length); this.syncTouch(); this.hud.toast(TOUCH_LINES[this.touchLines[this.touchSel]]?.[3] || '', 1); });
    tap('#tp-gen', () => this.toggleGen());
    // press and hold: the helm / sheet keeps moving while the finger stays down
    document.querySelectorAll('#touch .tbtn[data-k]').forEach(bt => {
      let timer = null;
      const stop = () => { clearInterval(timer); timer = null; bt.classList.remove('held'); };
      bt.addEventListener('pointerdown', (e) => {
        e.preventDefault(); stop(); bt.setPointerCapture(e.pointerId); bt.classList.add('held');
        const k = bt.dataset.k, d = +bt.dataset.d;
        const go = () => { if (this.running && !this.paused) this.nudge(k, d, 0.05); };
        go(); timer = setInterval(go, 50);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) bt.addEventListener(ev, stop);
      bt.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  // continuous controls, applied every physics step
  applyInput(dt) {
    const b = this.player, K = this.keys, c = b.ctrl, C = b.cls;
    const has = (...ks) => ks.some(k => K.has(k));
    const shift = K.has('Shift');
    let steer = 0;
    if (has('a', 'ArrowLeft')) steer -= 1;
    if (has('d', 'ArrowRight')) steer += 1;
    if (this.settings.tiller) steer = -steer; // push the tiller to port, the bow goes to starboard
    if (steer) c.helm = clamp(c.helm + steer * 0.9 * dt, -1, 1);
    // the helmsman holds the tiller where it was put (Space centres it)
    const rate = 0.28 * dt;
    const trim = (key, dir) => { this.userTouched(key); const tr = ['main', 'jib', 'stay', 'lazy', 'trav', 'tackLine'].includes(key) ? dir < 0 : dir > 0; this.working(key, tr); c[key] = clamp(c[key] + dir * rate, 0, 1); };
    if (has('w')) trim('main', -1);
    if (has('s')) trim('main', +1);
    if (K.has('ArrowUp')) trim(shift && b.sailBy.stay ? 'stay' : 'jib', -1);
    if (K.has('ArrowDown')) trim(shift && b.sailBy.stay ? 'stay' : 'jib', +1);
    if (has('z')) trim('trav', -1);
    if (has('x')) trim('trav', +1);
    if (has('c')) trim('vang', -1);
    if (has('v')) trim('vang', +1);
    if (has('n')) trim('backstay', -1);
    if (has('m')) trim('backstay', +1);
    if (has('q')) { this.userTouched('hike'); c.hike = clamp(c.hike - 1.2 * dt, -1, 1); }
    if (has('e')) { this.userTouched('hike'); c.hike = clamp(c.hike + 1.2 * dt, -1, 1); }
    // the lazy jib sheet (J hauls, Shift+J eases); a una-rig pushes the boom out by hand (J / Shift+J = port / stbd)
    if (has('j')) {
      if (b.sailBy.jib) { this.userTouched('lazy'); const load = (b.diag.rig.jibLoad || 0) / C.sheetPower; c.lazy = clamp(c.lazy + (shift ? 1 : -1 / (1 + load * load)) * rate, 0, 1); }
      else c.pushBoom = shift ? 1 : -1;
    } else if (!this.pushHeld) c.pushBoom = 0;
  }

  // ------------------------------------------------------------ loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.env) return;
    if (this.netEpoch !== null) {
      // shared clock: everyone evaluates the same wind and waves at the same instant
      this.timeWarp = 1; this.paused = false;
      const target = Date.now() / 1000 - this.netEpoch;
      if (target - this.t > 2 || target < this.t - 2) { this.t = target; this.acc = 0; }
      else this.acc = target - this.t;
    } else {
      const simDt = this.paused && !this.idle ? 0 : dt * (this.idle ? 1 : this.timeWarp);
      this.acc += simDt;
    }
    let steps = 0;
    const maxSteps = 12 * this.timeWarp;
    const tPhys = performance.now();
    while (this.acc >= PHYS_DT && steps < maxSteps) {
      for (const b of this.boats) b._prev = { x: b.x, z: b.z, psi: b.psi, heave: b.heave, pitch: b.pitch, phi: b.phi };
      this.step(PHYS_DT);
      this.acc -= PHYS_DT; steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    this.sailGovernor(performance.now() - tPhys, dt);
    // draw the boats between the last two physics states so motion is smooth at any refresh rate
    const alpha = clamp(this.acc / PHYS_DT, 0, 1);
    const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    for (const b of this.boats) {
      const p = b._prev || b;
      b.pose = { x: lerp(p.x, b.x, alpha), z: lerp(p.z, b.z, alpha), psi: p.psi + wrapA(b.psi - p.psi) * alpha,
        heave: lerp(p.heave, b.heave, alpha), pitch: lerp(p.pitch, b.pitch, alpha), phi: lerp(p.phi, b.phi, alpha) };
    }
    if (this.env.tick(this.t)) this.renderer.setWaves(this.env.waves);
    this.shelterAcc = (this.shelterAcc || 0) + dt;
    if (this.shelterAcc > 10) { this.shelterAcc = 0; const mw = this.env.wind.mean(this.t); if (this.world.updateShelter(mw.dir)) {} }
    this.renderer.updateWeather(this.env, this.t, this.renderer.camera.position);
    this.gustAcc = (this.gustAcc || 0) + dt;
    const p = this.player;
    if (this.gustAcc > 0.25 && p) { this.gustAcc = 0; this.renderer.updateGust(this.env, this.world, this.t, p.x, p.z); }
    if (!this.idle && this.running && p) {
      const vis = this.renderer.boats.get(p);
      const show = vis && ['deck', 'chase', 'helm'].includes(this.renderer.cam.mode) && this.renderer.cam.dist < 25;
      // what is under the pointer changes as the boat and camera move, not only when the mouse does
      if (this.mouse && !this._dragging) this.updateHover(this.mouse[0], this.mouse[1]); else if (!this.mouse) this.hoverGrab = null;
      // the panel is rebuilt now and then, so a 'pointerleave' can go missing: check the hovered row is still hovered
      if (this.panelHoverEl && !(this.panelHoverEl.isConnected && this.panelHoverEl.matches(':hover'))) { this.panelHover = null; this.panelHoverEl = null; }
      const hid = (this.hoverGrab && this.hoverGrab.id) || this.panelHover || null;
      vis.rigging.highlight(hid);
      this.renderer.updateGrabMarkers(show ? vis.rigging.grabs() : [], hid, GRAB_PX);
    }
    { const pl = this.skyPlace(); this.renderer.setClock(this.netEpoch !== null ? Date.now() : (this.clockBase ?? Date.now()) + this.t * 1000, pl.lat, pl.lon); }
    this.renderer.update(dt, this.t, { env: this.env, boats: this.boats, player: p });
    if (!this.idle && this.running) {
      const r0 = this.race && this.race.racers[0];
      this.net.update(dt, p, this.sharedRace && r0 ? { id: this.sharedRace.id, leg: r0.leg, fin: r0.finished ? r0.finishTime : 0 } : null);
      this.hud.update(dt);
      this.audio.update(p, dt);
      this.checkAlerts();
    }
  }

  // The cloth / lattice sails' detail level for the player: L0 (the full model), L1 (coarser) or L2 (the strip
  // model). A short benchmark on load picks where to start; the governor steps down when the physics takes
  // more than 6 ms of a frame (and back up, to the starting level, after a while well under budget); in
  // time warp beyond x2 the sails run at L2.
  sailLevelFor(cls) {
    if (this._sailLevel && this._sailLevel.cls === cls.id) return this._sailLevel.lod;
    let lod = 0;
    try {
      for (lod = 0; lod < 2; lod++) {
        const b = new Boat(cls, { sailModel: SAIL_MODEL, lod }), env = makeSteadyEnv(6);
        b.reset(0, 0, 1.2); b.u = 2;
        for (let i = 0; i < 40; i++) b.step(PHYS_DT, env, 0);                 // warm up (and the first factorisation)
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) b.step(PHYS_DT, env, 0);
        const ms = (performance.now() - t0) / 120;
        if (ms < 1.6) break;
      }
    } catch (e) { console.warn('sail benchmark', e); lod = 2; }
    this._sailLevel = { cls: cls.id, lod, start: lod };
    return lod;
  }
  setSailLevel(b, lod) {
    if (!b || b.sailModel === 'strip' || lod === b.lod) return;
    if (lod >= 2) { b.lod = 2; return; }
    if (!b.sailSys || b.sailSys.lod !== lod) attachSails(b, b.sailModel, lod);
    else { b.lod = lod; b.sailSys.reset(); }
  }
  sailGovernor(ms, dt) {
    const b = this.player, L = this._sailLevel;
    if (!b || !L || b.sailModel === 'strip') return;
    const g = this._gov || (this._gov = { ema: 0, over: 0, under: 0 });
    g.ema += (ms - g.ema) * Math.min(1, dt * 4);
    const want = this.timeWarp > 2 ? 2 : null;
    if (want !== null) { if (b.lod < 2) { g.saved = b.lod; this.setSailLevel(b, 2); } return; }
    if (g.saved !== undefined) { this.setSailLevel(b, g.saved); g.saved = undefined; }
    if (g.ema > 6) { g.over += dt; g.under = 0; } else if (g.ema < 2.5) { g.under += dt; g.over = 0; } else { g.over = 0; g.under = 0; }
    if (g.over > 1.5 && b.lod < 2) { this.setSailLevel(b, b.lod + 1); g.over = 0; this.hud.toast(b.lod < 2 ? 'Sails: lighter model (L' + b.lod + ') to keep the frame rate' : 'Sails: strip model to keep the frame rate', 2); }
    if (g.under > 15 && b.lod > L.start) { this.setSailLevel(b, b.lod - 1); g.under = 0; }
  }

  step(dt) {
    const b = this.player;
    this.t += dt;
    if (!this.idle) this.applyInput(dt);
    if (b.auto.trim || this.idle) autoTrim(b, dt, 0, true);
    if (this.idle) this.idleHelm(dt);
    for (const ai of this.ais) {
      const i = this.boats.indexOf(ai.b);
      ai.update(dt, this.t, this, this.race ? this.race.racers[i] : null, this.course, this.targets ? { up: this.targets.up.twa, dn: this.targets.dn.twa } : null);
    }
    this.net.preStep();
    this._shadowN = (this._shadowN || 0) + 1;
    if (this._shadowN % 12 === 0) applyWindShadow(this.boats);
    for (const bb of this.boats) bb.step(dt, this.env, this.t, this.world);
    this.net.postStep(dt);
    const marks = this.course ? [...this.course.marks(), this.course.committee] : this.waypoint ? [this.waypoint] : [];
    resolveCollisions(this.boats, marks, this.obstacles || [], (boat, other, v) => {
      if (boat === this.player && v > 0.6) { this.hud.toast(other && other.cls ? `Collision with ${other.name}!` : other && other.kind === 'pier' || other?.pts ? 'You hit the pier!' : 'Mark touched!', 2); this.audio.thump(Math.min(1, v / 2)); }
    });
    if (this.race) {
      this.race.update(dt);
      if (this.timeWarp > 1 && !this.canWarp()) { this.timeWarp = 1; this.hud.toast('Time ×1 — 20 seconds to the gun', 2); }
      for (const ev of this.race.events.splice(0)) this.onRaceEvent(ev);
    }
  }

  idleHelm(dt) { // gentle reaching behind the menu
    const b = this.player, twd = b.diag.twd ?? 0;
    const desired = twd + 100 * DEG;
    b.ctrl.helm = clamp(2 * wrap(desired - b.psi) - 1.5 * b.r, -0.6, 0.6);
  }

  onRaceEvent(ev) {
    const me = ev.boat === this.player;
    if (ev.type === 'signal') {
      if (ev.s === 0) { this.audio.horn(true); this.hud.toast('GUN — race on!', 2.5); }
      else if (ev.s === -60) { this.audio.horn(false); this.hud.toast('One minute', 2); }
      else if (ev.s === -30) { this.audio.beep(); this.hud.toast('30 seconds', 1.5); }
      else if (ev.s === -10) { this.audio.beep(); this.hud.toast('10 seconds', 1.2); }
    } else if (me && ev.type === 'ocs') { this.audio.horn(false); this.hud.alert('OCS — you were over early. Dip back below the line.', true); }
    else if (me && ev.type === 'cleared') { this.hud.alert(null); this.hud.toast('Cleared — now start', 2); }
    else if (me && ev.type === 'started') this.hud.toast('Clean start', 2);
    else if (me && ev.type === 'rounded') this.hud.toast(`${ev.name} rounded`, 2);
    else if (ev.type === 'finished') {
      this.audio.beep();
      if (me) {
        this.hud.toast(`Finished ${ev.place}${['th', 'st', 'nd', 'rd'][ev.place] || 'th'} — ${Math.floor(ev.t / 60)}:${String(Math.floor(ev.t % 60)).padStart(2, '0')}`, 6);
        this.timeWarp = 1;
        clearTimeout(this._resT); const race = this.race;
        this._resT = setTimeout(() => { if (this.race === race && $('#menu').hidden) { this.hud.showResults(); this.syncTools(); } }, 2500);
      }
    }
  }

  checkAlerts() {
    const b = this.player, C = b.cls;
    if (b.capsized && b.righting) this.hud.alert(`Righting… ${Math.round(Math.abs(b.phi) * 57.3)}° — keep your weight out`, true);
    else if (b.capsized) this.hud.alert('Capsized — press R to stand on the board and right her', true);
    else if (b.reefing) this.hud.alert(`${(b.ctrl.reef | 0) > b.reefPos ? 'Reefing' : 'Shaking out'} · ${Math.round(b.diag.reefProgress * 100)}% · main depowered`);
    else if (b.aground > 0.02) this.hud.alert(`Aground — ${this.world.depthAt(b.x, b.z).toFixed(1)} m of water`, true);
    else if (this.race && this.race.racers[0].ocs) this.hud.alert('OCS — dip back below the line', true);
    else if (Math.abs(b.phi) > C.targetHeel + 14 * 0.01745) this.hud.alert(b.sailBy.main.reefs ? 'Overpowered — ease, depower or reef' : 'Overpowered — ease the main');
    else if (b.u < 0.3 && Math.abs(b.diag.twa || 0) < 35 * DEG) this.hud.alert(b.sailBy.jib ? 'In irons — ease the main, let the jib sheet fly (F) and haul the lazy sheet (J) to back the jib, reverse the tiller while going astern' : 'In irons — ease the main, push the boom out (J / Shift+J), reverse the tiller while going astern');
    else this.hud.alert(null);
  }
}

window.game = new Game();
