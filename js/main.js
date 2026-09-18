// Game controller: menu, venue loading (baked OSM or live Overpass), live weather, input, the
// fixed-step simulation loop, race flow, AI fleet, cameras.
import { Environment, KT, DEG } from './env.js';
import { Boat, CLASSES, CLASS_ORDER, autoTrim, solvePolarAngle, POLAR_TWAS, vmgTargets, clamp, lerp, wrap } from './physics.js';
import { VENUES, World, makeProjection, fetchVenueGeo, fetchLiveWind } from './world.js';
import { Course, Race, AIHelm, applyWindShadow, resolveCollisions } from './race.js';
import { Renderer } from './render.js';
import { HUD } from './hud.js';
import { Audio } from './audio.js';
import { Net } from './net.js';
import { Vector3 as THREE_V } from 'three';

const $ = (s) => document.querySelector(s);
const PHYS_DT = 1 / 120;
const GRAB_PX = 30; // grab radius on screen, also the size of the marker rings
const NAMES = ['Tern', 'Petrel', 'Skua', 'Gannet', 'Fulmar', 'Shearwater', 'Kittiwake', 'Albatross', 'Puffin', 'Cormorant'];

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
      fleet: 5, countdown: 120, laps: 1, weather: 'changing', autoTrim: false, autoHike: true, tiller: false, laylines: true, sound: true,
    };
    this.venueTouched = false;
    this.running = false; this.paused = false;
    this.timeWarp = 1;
    this.t = 0;
    this.boats = [];
    this.showLaylines = true;
    this.backJib = false;
    this.buildMenu();
    this.bindInput();
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
    const sliders = { tws: v => `${v} kn`, twd: v => `${String(v).padStart(3, '0')}°`, gust: v => `${Math.round(v * 100)}%`, shift: v => `±${v}°`, swell: v => v > 0 ? `${v} m` : 'none', current: v => v > 0 ? `${v} kn` : 'none', fleet: v => `${v}`, countdown: v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`, laps: v => `${v}` };
    for (const k in sliders) {
      const el = $('#' + k);
      el.value = this.settings[k];
      const out = $('#' + k + '-v');
      const upd = () => { this.settings[k] = parseFloat(el.value); out.textContent = sliders[k](this.settings[k]); };
      el.addEventListener('input', upd); upd();
    }
    const checks = { 'opt-trim': 'autoTrim', 'opt-hike': 'autoHike', 'opt-tiller': 'tiller', 'opt-laylines': 'laylines', 'opt-sound': 'sound' };
    for (const id in checks) { const el = $('#' + id); el.checked = this.settings[checks[id]]; el.addEventListener('change', () => { this.settings[checks[id]] = el.checked; }); }
    $('#start').addEventListener('click', () => this.castOff());
    $('#resume').addEventListener('click', () => this.closeMenu());
    $('#help-close').addEventListener('click', () => { $('#help').hidden = true; });
    $('#live-wind').addEventListener('click', () => this.liveWind());
    $('#custom-go').addEventListener('click', () => this.customVenue());
    $('#custom-latlon').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.customVenue(); });
    try { $('#net-name').value = localStorage.getItem('tw-name') || ''; $('#net-room').value = localStorage.getItem('tw-room') || ''; } catch (e) {}
    this.pickVenue(this.settings.venue, false);
    this.refreshMenu();
  }
  pickVenue(id, fromUser) {
    this.settings.venue = id;
    const v = VENUES.find(x => x.id === id) || this.customV;
    if (v && !v.open) { this.setSlider('twd', v.wind); this.setSlider('tws', v.windKt); this.setSlider('current', v.current?.kt ?? 0); }
    this.refreshMenu();
  }
  setSlider(k, v) { const el = $('#' + k); el.value = v; el.dispatchEvent(new Event('input')); }
  refreshMenu() {
    document.querySelectorAll('#boat-list .card').forEach(c => c.classList.toggle('on', c.dataset.cls === this.settings.cls));
    document.querySelectorAll('#venue-list .card').forEach(c => c.classList.toggle('on', c.dataset.v === this.settings.venue));
    document.querySelectorAll('.seg-b[data-mode]').forEach(b => { const on = b.dataset.mode === this.settings.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    document.querySelectorAll('.seg-b[data-weather]').forEach(b => { const on = b.dataset.weather === this.settings.weather; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    document.body.classList.toggle('racing', this.settings.mode === 'race');
    document.body.classList.toggle('online', this.settings.mode === 'online');
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
  currentVenueDef() { return this.settings.venue === 'custom' ? this.customV : VENUES.find(v => v.id === this.settings.venue); }

  openMenu() { $('#menu').hidden = false; $('#resume').hidden = !this.running; this.paused = true; }
  closeMenu() { $('#menu').hidden = true; this.paused = false; this.audio.start(); }
  async castOff() {
    this.audio.on = this.settings.sound;
    this.audio.start();
    $('#menu').hidden = true;
    await this.startSession(false);
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
    const cls = CLASSES[S.cls];
    const player = new Boat(cls, { id: 0, name: 'You' });
    player.auto.trim = S.autoTrim; player.auto.hike = S.autoHike;
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
    for (const b of this.boats) this.renderer.addBoat(b, { player: b === player, number: b === player ? (cls.id === 'blackwatch' ? '79' : '7') : String(100 + b.id * 7), hullColor: b === player ? undefined : [0xf4f1ea, 0xd9e2ea, 0x1d4e89, 0x8b1e2d, 0x2e5e4e, 0xe8d8b0, 0x3a3f47, 0xb8c4cc, 0x6b4f3a][b.id % 9], crewTint: b.id });
    this.hud.buildRig(player);
    this.renderer.cam.mode = idle ? 'orbit' : 'chase';
    this.renderer.cam.yaw = idle ? 0 : 200 * DEG; this.renderer.cam.pitch = 14 * DEG; this.renderer.cam.dist = idle ? 26 : cls.id === 'dinghy' ? 8 : 12;
    this.t = 0; this.acc = 0; this.timeWarp = 1;
    this.idle = idle;
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
      if (this.race) this.audio.horn(true);
    }
  }

  // Environment from a conditions record (shared verbatim between online peers)
  makeEnv(cond) {
    const world = this.world, v = this.venue;
    const twd = cond.twd * DEG;
    world.updateShelter(twd);
    // waves: fetch-limited by the real coastline upwind of the sailing area
    const fetchM = world.open ? 60000 : world.fetchAt(0, 0, twd, 6000);
    const fetchKm = world.open ? 60 : fetchM >= 6000 ? 25 : Math.max(0.4, fetchM / 1000);
    const env = new Environment({
      tws: cond.tws * KT, twd: cond.twd, gust: cond.gust, shift: cond.shift, seed: cond.seed, weather: cond.weather ?? 'changing',
      fetchKm, swellH: cond.swell, swellT: 9, currentKt: cond.current, currentDir: cond.currentDir,
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
    this.renderer.addBoat(b, { number: String(200 + (idx * 37) % 700), hullColor: [0xd9e2ea, 0x1d4e89, 0x8b1e2d, 0x2e5e4e, 0xe8d8b0, 0x3a3f47, 0xb8c4cc][idx % 7], crewTint: idx, label: b.name });
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
    const keep = { x: b.x, z: b.z, psi: b.psi };
    for (let i = 0; i < 240; i++) { autoTrim(b, 1 / 60, 0, true); b.step(1 / 60, this.env, 0, this.world); b.psi = keep.psi; b.r = 0; }
    b.x = keep.x; b.z = keep.z;
    b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.stay = b.ctrl.stay;
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
    const trimKeys = ['main', 'jib', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibLead', 'jibHalyard', 'tackLine', 'board'];
    if (trimKeys.includes(k) && this.player.auto.trim) { this.player.auto.trim = false; this.hud.toast('Automatic trim off — you have the sheets'); }
    if ((k === 'hike' || k === 'crewAft') && this.player.auto.hike) { this.player.auto.hike = false; this.hud.toast('Automatic weight off — you place your weight'); }
  }
  toggleAutoTrim() { this.player.auto.trim = !this.player.auto.trim; this.hud.toast(this.player.auto.trim ? 'Automatic trim on' : 'Automatic trim off — you trim the sails'); }
  toggleAutoHike() { this.player.auto.hike = !this.player.auto.hike; this.hud.toast(this.player.auto.hike ? 'Automatic weight placement on' : 'Automatic weight off — you place your weight (Q/E)'); }
  toggleGen() {
    const b = this.player; if (!b.sailBy.gennaker) return;
    b.ctrl.gen = !b.ctrl.gen; this.hud.toast(b.ctrl.gen ? 'Gennaker going up' : 'Dousing the gennaker');
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
      if (k === 'j') this.backJib = false;
    });
    window.addEventListener('blur', () => this.keys.clear());
    const cv = $('#view');
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const g = this.running && !this.idle ? this.hoverGrab : null;
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, grab: g, ang: null, clickDist: 0, shift: e.shiftKey };
      if (g) { cv.style.cursor = 'grabbing'; this.onGrabStart(g); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) { this.updateHover(e.clientX, e.clientY); return; }
      if (drag.grab) { this.onGrabDrag(drag, e.clientX, e.clientY); }
      else {
        const c = this.renderer.cam;
        c.yaw -= (e.clientX - drag.x) * 0.005; c.pitch = clamp(c.pitch + (e.clientY - drag.y) * 0.004, -0.2, 1.45);
      }
      drag.clickDist += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    cv.addEventListener('pointerup', () => {
      if (drag && drag.grab && drag.grab.kind === 'click' && drag.clickDist < 8) this.onGrabClick(drag.grab, drag.shift);
      drag = null; cv.style.cursor = this.hoverGrab ? 'grab' : '';
    });
    cv.addEventListener('wheel', (e) => {
      const c = this.renderer.cam, out = e.deltaY > 0;
      if (c.mode === 'helm' || c.mode === 'bow' || c.mode === 'mast') { if (out) { c.mode = 'chase'; c.dist = 4.5; c.yaw = 200 * DEG; c.pitch = 0.12; } return; }
      if (c.mode === 'top') { c.dist = clamp(c.dist * (out ? 1.12 : 1 / 1.12), 5, 400); return; }
      const next = c.dist * (out ? 1.12 : 1 / 1.12);
      if (!out && next < 3.5 && (c.mode === 'chase' || c.mode === 'deck')) { c.mode = 'helm'; c.yaw = Math.PI; c.pitch = 0.15; this.hud.toast('At the helm', 1); return; }
      c.dist = clamp(next, 3.5, 600);
    }, { passive: true });
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
    vis.rigging.highlight(best ? best.id : null);
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
    if (g.kind === 'crank') this.hud.toast('Crank clockwise to grind the sheet in', 1.5);
  }
  onGrabClick(g, shift) {
    const b = this.player;
    if (g.action === 'gen') this.toggleGen();
    else if (g.action === 'reef') {
      const max = b.sailBy.main.reefs;
      b.ctrl.reef = clamp((b.ctrl.reef | 0) + (shift ? -1 : 1), 0, max);
      this.hud.toast(shift ? 'Shaking out a reef' : `Reefing to ${b.ctrl.reef === 1 ? 'first' : 'second'} reef — halyard off`);
    }
  }
  onGrabDrag(drag, mx, my) {
    const g = drag.grab, b = this.player, c = b.ctrl, C = b.cls;
    const load = g.key === 'main' ? b.diag.rig.mainLoad : g.key === 'jib' ? b.diag.rig.jibLoad : g.key === 'stay' ? b.diag.rig.stayLoad : 0;
    const effort = 1 / (1 + ((load || 0) / C.sheetPower) ** 2);   // heavy lines come in slowly
    if (g.kind === 'pull') {
      const dy = (drag.y - my) * 0.0035;                            // up = pull
      if (g.easeOnly && dy > 0) return;
      let delta = g.dir * dy;
      const trimming = (g.dir < 0 && dy > 0) || (g.dir > 0 && dy > 0);
      if (trimming) delta *= effort;
      c[g.key] = clamp(c[g.key] + delta, 0, 1);
    } else if (g.kind === 'track') {
      const [ax, ay] = this.screenOf(g.A), [bx, by] = this.screenOf(g.B);
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
      let t = clamp(((mx - ax) * vx + (my - ay) * vy) / L2, 0, 1);
      if (g.key === 'trav') { // track A is port, B starboard; the control is windward -> leeward
        const lee = Math.sign(b.booms.main.a) || 1;
        t = lee > 0 ? t : 1 - t;
      }
      c[g.key] = lerp(c[g.key], t, 0.5);
    } else if (g.kind === 'crank') {
      const [cx, cy] = [g.sx ?? drag.x0, g.sy ?? drag.y0];
      const ang = Math.atan2(my - cy, mx - cx);
      if (drag.ang !== null) {
        let da = ang - drag.ang; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        if (da > 0) { // clockwise on screen = grinding in; the ratchet stops it running back
          c.jib = clamp(c.jib - da / (2 * Math.PI) * 0.045 * effort, 0, 1);
          drag.clicks = (drag.clicks || 0) + da;
          if (drag.clicks > 0.5) { drag.clicks = 0; this.audio.click(); }
        }
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
    if (k === 'Escape') { if (!$('#help').hidden) { $('#help').hidden = true; return; } if ($('#menu').hidden) this.openMenu(); else if (this.running) this.closeMenu(); return; }
    if (!this.running || !$('#menu').hidden) return;
    const b = this.player, c = this.renderer.cam;
    const cams = { '1': 'chase', '2': 'helm', '3': 'bow', '4': 'mast', '5': 'top', '6': 'orbit', '7': 'deck' };
    if (cams[k]) { c.mode = cams[k]; if (k === '2' || k === '3' || k === '4') { c.yaw = Math.PI; c.pitch = 0.2; } else if (k === '7') { c.yaw = 200 * DEG; c.pitch = 0.45; c.dist = 6; } else if (k === '1') { c.yaw = 200 * DEG; c.pitch = 14 * DEG; c.dist = 10; } this.hud.toast({ chase: 'Chase camera', helm: 'At the helm', bow: 'On the bow', mast: 'Masthead', top: 'Overhead, wind up', orbit: 'Orbit', deck: 'On deck — grab the lines' }[cams[k]], 1.2); }
    else if (k === 'h') this.toggleAutoHike();
    else if (k === 't') this.toggleAutoTrim();
    else if (k === 'g') this.toggleGen();
    else if (k === 'l') { this.showLaylines = !this.showLaylines; this.hud.toast(this.showLaylines ? 'Laylines on' : 'Laylines off', 1.2); }
    else if (k === 'k') { this.renderer.showForces = !this.renderer.showForces; this.hud.toast(this.renderer.showForces ? 'Force vectors: sails yellow, drive green, keel blue, rudder violet, wind white/teal' : 'Force vectors off', 3); }
    else if (k === 'i') { $('#physics').hidden = !$('#physics').hidden; }
    else if (k === 'p' && this.netEpoch !== null) { this.hud.toast('No pausing in a shared world', 1.5); }
    else if (k === 'p') { this.paused = !this.paused; this.hud.toast(this.paused ? 'Paused' : 'Sailing', 1); }
    else if (k === 'y' && b.cls.hasBoard) { this.userTouched('board'); b.ctrl.board = b.ctrl.board > 0.5 ? 0.25 : 1; this.hud.toast(b.ctrl.board > 0.5 ? 'Board down' : 'Board up', 1.2); }
    else if (k === 'r') {
      if (b.capsized) { b.righting = 4; this.hud.toast('Standing on the daggerboard…', 3); }
      else if (b.sailBy.main.reefs) { b.ctrl.reef = ((b.ctrl.reef | 0) + 1) % (b.sailBy.main.reefs + 1); this.hud.toast(b.ctrl.reef ? `Reefing to ${b.ctrl.reef === 1 ? 'first' : 'second'} reef — halyard off` : 'Shaking out the reefs'); }
    }
    else if (k === 'j') this.backJib = true;
    else if (k === ' ') b.ctrl.helm = 0;
    else if (k === '=' || k === '+') { if (!this.race) { this.timeWarp = Math.min(8, this.timeWarp * 2); this.hud.toast(`Time ×${this.timeWarp}`, 1); } }
    else if (k === '-') { this.timeWarp = Math.max(1, this.timeWarp / 2); this.hud.toast(`Time ×${this.timeWarp}`, 1); }
    else if (k === 'F1' || k === '?') { e.preventDefault(); $('#help').hidden = false; }
    else if (k === 'Enter' && false) {}
    if (k === 'h' && e.shiftKey) $('#help').hidden = false;
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
    const trim = (key, dir) => { this.userTouched(key); c[key] = clamp(c[key] + dir * rate, 0, 1); };
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
    // backing the jib: hold the clew on the side the wind is coming from
    if (this.backJib) { const twa = wrap((b.diag.twd ?? 0) - b.psi); c.backJib = c.backJib || (Math.sign(twa) || 1); }
    else c.backJib = 0;
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
    while (this.acc >= PHYS_DT && steps < maxSteps) {
      for (const b of this.boats) b._prev = { x: b.x, z: b.z, psi: b.psi, heave: b.heave, pitch: b.pitch, phi: b.phi };
      this.step(PHYS_DT);
      this.acc -= PHYS_DT; steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
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
      this.renderer.updateGrabMarkers(show ? vis.rigging.grabs() : [], this.hoverGrab && this.hoverGrab.id, GRAB_PX);
    }
    this.renderer.update(dt, this.t, { env: this.env, boats: this.boats, player: p });
    if (!this.idle && this.running) {
      const r0 = this.race && this.race.racers[0];
      this.net.update(dt, p, this.sharedRace && r0 ? { id: this.sharedRace.id, leg: r0.leg, fin: r0.finished ? r0.finishTime : 0 } : null);
      this.hud.update(dt);
      this.audio.update(p, dt);
      this.checkAlerts();
    }
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
    else if (ev.type === 'finished') { this.audio.beep(); if (me) this.hud.toast(`Finished ${ev.place}${['th', 'st', 'nd', 'rd'][ev.place] || 'th'} — ${Math.floor(ev.t / 60)}:${String(Math.floor(ev.t % 60)).padStart(2, '0')}`, 6); }
  }

  checkAlerts() {
    const b = this.player, C = b.cls;
    if (b.capsized) this.hud.alert('Capsized — press R to right the boat', true);
    else if (b.reefing) this.hud.alert(`${(b.ctrl.reef | 0) > b.reefPos ? 'Reefing' : 'Shaking out'} · ${Math.round(b.diag.reefProgress * 100)}% · main depowered`);
    else if (b.aground > 0.02) this.hud.alert(`Aground — ${this.world.depthAt(b.x, b.z).toFixed(1)} m of water`, true);
    else if (this.race && this.race.racers[0].ocs) this.hud.alert('OCS — dip back below the line', true);
    else if (Math.abs(b.phi) > C.targetHeel + 14 * 0.01745) this.hud.alert(b.sailBy.main.reefs ? 'Overpowered — ease, depower or reef' : 'Overpowered — ease the main');
    else if (b.u < 0.3 && Math.abs(b.diag.twa || 0) < 35 * DEG) this.hud.alert(b.sailBy.jib ? 'In irons — ease the main, hold J to back the jib, reverse the tiller while going astern' : 'In irons — ease the main, push the boom out, reverse the tiller while going astern');
    else this.hud.alert(null);
  }
}

window.game = new Game();
