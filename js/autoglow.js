// The automatic crew's hands, seen on deck: whatever the crew, the automatic weight or the autopilot is working
// (js/crew.js Crew.hl, keyed by the crew's own control keys) glows on the player's boat while it is worked and fades
// over a second after: the rope in its own colour brightened, with a soft outline of that colour; its hardware (the
// winch whose drum is turning, the cleat or clutch, the traveller or jib car) warm; the tiller or wheel a little as
// it steers; and a small label by the part with the line's name and which way it went. Only the player's boat: the
// parts and their materials are found once per control (and again now and then: the working jib sheet changes side
// in a tack), nothing is allocated per frame.
import * as THREE from 'three';
import { touchLabel } from './crew.js';
import { ropeLook, ropeKey } from './linehandlers.js';

const WARM = new THREE.Color(0xffb35c), WHITE = new THREE.Color(0xffffff);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _box = new THREE.Box3();
const MAX_LABELS = 3;
const rank = (k, e) => e.a - (k === 'hike' || k === 'helm' ? 0.6 : 0);

// a rope's outline in its own colour (one per rope, made the first time it glows)
function outlineMat(col) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: col }, uA: { value: 0 } },
    vertexShader: 'void main(){ vec3 p = position + normal * 0.018; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader: 'uniform vec3 uCol; uniform float uA; void main(){ gl_FragColor = vec4(uCol, uA); }',
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

export class AutoGlow {
  constructor(vis, rig) {
    this.vis = vis; this.rig = rig;
    this.parts = {};                 // key -> { t, ropes, mats, anchor }
    this.meshes = new Map();         // object -> its emissive materials (cloned once, as rigging.highlight does)
    this.lit = new Set(); this.lit2 = new Set();
    this.labels = null; this._hlKey = undefined; this._hover = new Set();
  }
  // the emissive materials of object o (its own copies, the originals' emission kept in userData); above: only the
  // parts above the water (a tiller, not the blade under it)
  matsOf(o, above) {
    let L = this.meshes.get(o);
    if (L) return L;
    L = [];
    o.traverse((m) => {
      if (!m.isMesh || !m.material || Array.isArray(m.material) || !m.material.emissive) return;
      // (an indicator that lights itself — a cleat's red band, a slip warning — is left to its own cue)
      if (m.material.emissiveIntensity >= 0.4 && m.material.emissive.getHex() !== 0 && m.userData.e0 === undefined) return;
      if (above) {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        _box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).getCenter(_v);
        if (this.vis.inner.worldToLocal(_v).y < 0.05) return;
      }
      if (m.userData.e0 === undefined) { m.material = m.material.clone(); m.userData.e0 = m.material.emissiveIntensity; m.userData.e0c = m.material.emissive.getHex(); }
      L.push(m);
    });
    this.meshes.set(o, L);
    return L;
  }
  // what control k is on deck: its ropes, its hardware's meshes, where its label goes
  find(k) {
    const R = this.rig, b = R.b, vis = this.vis, ropes = [], objs = [];
    let above = false;
    const cs = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1, gen = b.genDeploy > 0.5 && R.genBlocks;
    const cleat = (q) => { const c = R.cleats && R.cleats[q]; if (c && c.visible) objs.push(c); };
    switch (k) {
      case 'helm': above = true; if (vis.wheel) objs.push(vis.wheel); else { objs.push(vis.rudderPivot); if (vis.extension) objs.push(vis.extension); } break;
      case 'board': if (vis.keelMesh) objs.push(vis.keelMesh); break;
      case 'throttle': above = true; if (vis.engineVis && vis.engineVis.root) objs.push(vis.engineVis.root); break;
      case 'hike': if (R.strap) ropes.push(R.strap); break;
      case 'jibLead': if (R.jibCars) objs.push(R.jibCars[(cs + 1) / 2]); break;
      case 'jib': case 'lazy':
        ropes.push(...R.ropesFor(k === 'jib' ? 'jibtail' : 'lazyWinch'));
        if (gen && k === 'jib') objs.push(R.genBlocks[(cs + 1) / 2]); else { const w = R.winchOf(k); if (w) objs.push(w); }
        cleat(k); break;
      case 'trav': ropes.push(...R.ropesFor('trav')); if (R.car) objs.push(R.car); cleat('trav'); break;
      case 'main': ropes.push(...R.ropesFor('main')); if (R.mainWinch) objs.push(R.mainWinch); cleat('main'); break;
      default:
        ropes.push(...R.ropesFor(k)); cleat(k);
        if (R.cabinWinch && R.cabinLine === k) { objs.push(R.cabinWinch); if (R.cabinLead) ropes.push(R.cabinLead); }
    }
    const mats = [];
    for (const o of objs) if (o) for (const m of this.matsOf(o, above)) mats.push(m);
    const anchor = objs.find((o) => o && o.visible !== false) || null;
    return { ropes: ropes.filter(Boolean), mats, anchor, rope: ropes[0] || null };
  }
  // the deck's lights for this frame: hl from the crew, t the clock (s); camera / showLabels for the labels
  update(hl, t, camera, showLabels, helmLabel) {
    const R = this.rig, b = R.b;
    // the hovered control keeps its own (brighter) highlight
    if (this._hlKey !== R._hl) { this._hlKey = R._hl; this._hover.clear(); if (R._hl) for (const r of R.ropesFor(R._hl)) this._hover.add(r); for (const o of R._hlObjs || []) o.traverse((m) => { if (m.isMesh) this._hover.add(m); }); }
    const now = this.lit2; now.clear();
    const pulse = 0.85 + 0.15 * Math.sin(t * 7);
    let nl = 0;
    const top = this._top || (this._top = []); top.length = 0;
    for (const k in hl) {
      const e = hl[k];
      if (!(e.a > 0.01)) continue;
      let P = this.parts[k];
      if (!P || t - P.t > 0.3 || t < P.t) { P = this.parts[k] = this.find(k); P.t = t; }
      const g = e.a * (e.live > 0 ? pulse : 1), helm = k === 'helm';
      for (const r of P.ropes) {
        if (this._hover.has(r) || !r.mesh.visible) continue;
        if (!r._hiCol) { r._hiCol = new THREE.Color(); r._olMat = outlineMat(new THREE.Color()); }
        if (r._hiBase !== r.base) { r._hiBase = r.base; r._hiCol.setHex(r.base).lerp(WHITE, 0.45); r._olMat.uniforms.uCol.value.setHex(r.base).lerp(WHITE, 0.5); }
        r.mat.emissive.copy(r._hiCol); r.mat.emissiveIntensity = 0.06 + 0.8 * g;
        r.outline.material = r._olMat; r._olMat.uniforms.uA.value = 0.7 * g; r.outline.visible = true;
        now.add(r);
      }
      for (const m of P.mats) {
        if (this._hover.has(m)) continue;
        m.material.emissive.copy(WARM); m.material.emissiveIntensity = Math.max(m.userData.e0 || 0, (helm ? 0.35 : 0.6) * g);
        now.add(m);
      }
      // a label for what is really being worked (the helm only in a big turn: it steers all the time)
      if (showLabels && (!helm || e.a > 0.8) && e.a > 0.15) top.push(k);
    }
    // what went dark this frame (faded out, or no longer this control's part: the sheet across after a tack)
    for (const x of this.lit) if (!now.has(x) && !this._hover.has(x)) {
      if (x.isMesh) { x.material.emissiveIntensity = x.userData.e0 ?? 0; x.material.emissive.setHex(x.userData.e0c ?? 0); }
      else x.glow(0);
    }
    this.lit2 = this.lit; this.lit = now;
    // the labels: the brightest few, by their part, faded with it
    if (!this.labels && showLabels) this.makeLabels();
    if (!this.labels) return;
    top.sort((p, q) => rank(q, hl[q]) - rank(p, hl[p]));         // (the lines first: the helm and the weight move all the time)
    const W = innerWidth, H = innerHeight, used = this._used || (this._used = []); used.length = 0;
    for (const k of top) {
      if (nl >= MAX_LABELS) break;
      const P = this.parts[k], e = hl[k];
      if (P.anchor) P.anchor.getWorldPosition(_w);
      else if (P.rope) P.rope.mesh.localToWorld(_w.copy(P.rope.pts[P.rope.maxPts >> 2]));
      else if (k === 'hike') this.vis.inner.localToWorld(_w.set(b.crewY || 0, (b.cls.freeboard || 0.6) + 0.6, -(b.cls.sternX * 0.6)));   // (physics x, y, z = -three z, three x, three y)
      else continue;
      _w.project(camera);
      if (_w.z > 1 || Math.abs(_w.x) > 0.95 || Math.abs(_w.y) > 0.95) continue;
      let x = (_w.x * 0.5 + 0.5) * W, y = (-_w.y * 0.5 + 0.5) * H - 26;
      for (let pass = 0, hit = true; hit && pass < 4; pass++) { hit = false; for (const u of used) if (Math.abs(u[0] - x) < 150 && Math.abs(u[1] - y) < 23) { y = u[1] - 25; hit = true; } }
      used.push([x, y]);
      const el = this.labels[nl++], L = touchLabel(b, k, e.dir), name = k === 'helm' ? helmLabel : L.name;
      const sw = k === 'helm' || k === 'board' || k === 'throttle' || k === 'reef' || k === 'hike' || k === 'jibLead' ? '#ffb35c' : ropeLook(b.cls, ropeKey(b.cls, k === 'jib' && b.genDeploy > 0.5 ? 'gen' : k)).swatch;
      const html = `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:${sw}"></i>${name} <b style="color:#ffcf8a">${L.arrow} ${L.word}</b>`;
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.min(1, e.a * 1.4));
      if (el.hidden) el.hidden = false;
    }
    for (let i = nl; i < MAX_LABELS; i++) if (!this.labels[i].hidden) this.labels[i].hidden = true;
  }
  makeLabels() {
    const host = (document.getElementById('nextmark') || {}).parentNode || document.body;
    this.labels = [];
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'autoglow-label'; el.hidden = true;
      el.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;padding:2px 7px 3px;border-radius:4px;background:rgba(8,18,26,.66);'
        + 'font:600 12px/1.2 var(--cond, sans-serif);letter-spacing:.03em;color:#eef3f6;text-shadow:0 1px 3px rgba(0,0,0,.6);will-change:transform,opacity;';
      host.appendChild(el); this.labels.push(el);
    }
  }
  // all dark (automatic modes off, another boat, the menu)
  clear() {
    for (const x of this.lit) if (!this._hover.has(x)) { if (x.isMesh) { x.material.emissiveIntensity = x.userData.e0 ?? 0; x.material.emissive.setHex(x.userData.e0c ?? 0); } else x.glow(0); }
    this.lit.clear();
    if (this.labels) for (const el of this.labels) el.hidden = true;
  }
  dispose() { this.clear(); if (this.labels) for (const el of this.labels) el.remove(); this.labels = null; }
}
