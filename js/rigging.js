// Running rigging you can see and handle: ropes (sagging by tension), multi-part purchases, blocks,
// tracks and cars, winches whose drums turn as line comes in, and the grab points the player uses
// to pull, ease, crank and slide them.
import * as THREE from 'three';
import { V } from './models.js';
import { clamp, lerp, sstep, reefAt } from './physics.js';

const ROPE_W = 1.4; // N/m, a little heavier than real so sag reads at a distance
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ------------------------------------------------------------------ rope: tube rebuilt in place
class Rope {
  constructor(parent, radius, color, maxPts = 64, radial = 6) {
    radius *= 1.7;                                   // drawn thicker than life so lines read on screen
    this.maxPts = maxPts; this.radial = radial; this.radius = radius;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * radial * 3);
    this.nor = new Float32Array(maxPts * radial * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.18 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    // glowing outline: the same tube pushed out along its normals, drawn back-faced and additive
    this.outline = new THREE.Mesh(g, FAINT_MAT);
    this.outline.frustumCulled = false; this.outline.visible = false; this.outline.renderOrder = 5;
    parent.add(this.outline);
    this.pts = [];
    for (let i = 0; i < maxPts; i++) this.pts.push(new THREE.Vector3());
  }
  // path: control points; tension: per span (N); gravity: unit "down" in the parent frame
  set(path, tension, gravity, flutter = 0, t = 0) {
    const n = path.length;
    if (n < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const lens = []; let total = 0;
    for (let i = 0; i < n - 1; i++) { const L = path[i].distanceTo(path[i + 1]); lens.push(L); total += L; }
    let k = 0;
    const budget = this.maxPts - 1;
    for (let i = 0; i < n - 1; i++) {
      const A = path[i], B = path[i + 1], L = lens[i];
      const segs = i === n - 2 ? budget - k : Math.max(2, Math.round(budget * L / Math.max(total, 1e-6)));
      const T = Math.max(2, Array.isArray(tension) ? tension[i] : tension);
      const sag = Math.min(0.4 * L, ROPE_W * L * L / (8 * T));
      for (let s = 0; s < segs && k < budget; s++, k++) {
        const u = s / segs;
        const p = this.pts[k].lerpVectors(A, B, u).addScaledVector(gravity, sag * 4 * u * (1 - u));
        if (flutter > 0) p.addScaledVector(gravity, flutter * Math.sin(u * 12 + t * 9) * u * (1 - u) * L * 0.2);
      }
    }
    this.pts[budget].copy(path[n - 1]);
    for (let i = k + 1; i < budget; i++) this.pts[i].copy(path[n - 1]);
    // tube frames
    const R = this.radius, rad = this.radial;
    let ref = new THREE.Vector3(0, 1, 0);
    const T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3();
    for (let i = 0; i < this.maxPts; i++) {
      const a = this.pts[Math.max(0, i - 1)], b = this.pts[Math.min(this.maxPts - 1, i + 1)];
      T.subVectors(b, a); if (T.lengthSq() < 1e-12) T.set(0, 0, 1); T.normalize();
      if (Math.abs(T.dot(ref)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
      N.crossVectors(T, ref).normalize(); Bn.crossVectors(T, N);
      const p = this.pts[i];
      for (let j = 0; j < rad; j++) {
        const th = j / rad * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        const nx = N.x * c + Bn.x * s, ny = N.y * c + Bn.y * s, nz = N.z * c + Bn.z * s;
        const o = (i * rad + j) * 3;
        this.pos[o] = p.x + nx * R; this.pos[o + 1] = p.y + ny * R; this.pos[o + 2] = p.z + nz * R;
        this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
  hide() { this.mesh.visible = false; this.outline.visible = false; }
  // 0 = none, 1 = faint (a control you can grab), 2 = bright (the one you are pointing at)
  glow(level) {
    const on = level > 0 && this.mesh.visible;
    this.outline.visible = on;
    if (on) this.outline.material = level === 2 ? OUTLINE_MAT : FAINT_MAT;
    this.mat.emissive.setHex(level === 2 ? 0xff8a2a : this.mat.color.getHex());
    this.mat.emissiveIntensity = level === 2 ? 0.8 : 0.18;
  }
}
const OUTLINE_MAT = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: `uniform float uTime; void main(){ vec3 p = position + normal * (0.022 + 0.008 * sin(uTime * 6.0)); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `uniform float uTime; void main(){ gl_FragColor = vec4(1.0, 0.62, 0.2, 0.75 + 0.25 * sin(uTime * 6.0)); }`,
  side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});
const FAINT_MAT = new THREE.ShaderMaterial({
  vertexShader: `void main(){ vec3 p = position + normal * 0.014; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(1.0, 0.72, 0.35, 0.28); }`,
  side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});
export function tickGlow(t) { OUTLINE_MAT.uniforms.uTime.value = t; }

// ------------------------------------------------------------------ hardware meshes
const HW = {};
const hwMat = (k, make) => HW[k] || (HW[k] = make());
const mStainless = () => hwMat('ss', () => new THREE.MeshStandardMaterial({ color: 0xd6dadf, roughness: 0.2, metalness: 0.9 }));
const mBronze = () => hwMat('bz', () => new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.85 }));
const mBlack = () => hwMat('bk', () => new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.45, metalness: 0.3 }));
const mTrack = () => hwMat('tr', () => new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.8 }));

function makeBlock(size = 0.05) {
  const g = new THREE.Group();
  const cheek = new THREE.Mesh(new THREE.CylinderGeometry(size, size, size * 0.7, 14), mBlack());
  cheek.rotation.z = Math.PI / 2; g.add(cheek);
  const sheave = new THREE.Mesh(new THREE.TorusGeometry(size * 0.75, size * 0.18, 6, 14), mStainless());
  sheave.rotation.y = Math.PI / 2; g.add(sheave);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function makeWinch(bronze, r = 0.06) {
  const g = new THREE.Group();
  const mat = bronze ? mBronze() : mStainless();
  const prof = [[r * 1.25, 0], [r * 1.25, 0.02], [r, 0.03], [r * 0.9, 0.08], [r * 0.95, 0.13], [r * 1.1, 0.15], [r * 1.1, 0.18], [r * 0.5, 0.2], [0, 0.2]];
  const drum = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 20), mat);
  drum.castShadow = true;
  const spin = new THREE.Group(); spin.add(drum);
  // ribs so rotation is visible
  for (let i = 0; i < 6; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.01), mBlack()); const a = i / 6 * Math.PI * 2; rib.position.set(Math.cos(a) * r * 0.93, 0.105, Math.sin(a) * r * 0.93); rib.rotation.y = -a; spin.add(rib); }
  g.add(spin);
  const handle = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.03), mBlack()); arm.position.set(0.12, 0.215, 0); handle.add(arm);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.1, 10), mBlack()); grip.position.set(0.23, 0.27, 0); handle.add(grip);
  g.add(handle);
  g.userData = { spin, handle, angle: 0, handleAngle: 0 };
  return g;
}

// ------------------------------------------------------------------ rigging per boat
export class Rigging {
  constructor(boat, vis, opts = {}) {
    this.b = boat; this.vis = vis; this.player = !!opts.player;
    const C = boat.cls, inner = vis.inner, dH = vis.deckH, Lx = vis.lines;
    this.ropes = [];
    this.g = new THREE.Vector3(0, -1, 0);
    const bw = (x) => Lx.bDeck(clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1));
    const bronze = C.id === 'blackwatch';
    const col = bronze ? { main: 0xe3d6b8, jib: 0xd9c7a0, ctl: 0xcdb98e, hal: 0xeee6d2 } : { main: 0xe8eef4, jib: 0x2f6fd6, ctl: 0xf2b33d, hal: 0xf4f4f4 };
    const rope = (r, c, n) => { const R = new Rope(inner, r, c, n); this.ropes.push(R); return R; };
    // ---------------- hardware layout (physics coordinates)
    const hw = this.hw = {};
    const M = boat.sailBy.main;
    if (C.id === 'sportboat') {
      hw.travX = C.mastX - M.foot * 0.55; hw.travZ = vis.ck.sole + 0.06; hw.travHalf = 0.55; hw.boomS = M.foot * 0.55;
      hw.winchX = C.mastX - 1.35; hw.winchY = 0.78; hw.winchZ = dH(C.mastX - 1.35, 0.78) + 0.02;
      hw.jibTrack = [C.mastX - 0.2, C.mastX - 1.0]; hw.jibTrackY = bw(C.mastX - 0.6) * 0.72;
    } else if (C.id === 'blackwatch') {
      hw.travX = C.sternX + 0.35; hw.travZ = dH(C.sternX + 0.35, 0) + 0.06; hw.travHalf = 0.55; hw.boomS = M.foot * 0.96;
      const cx = lerp(C.sternX, C.bowX, 0.27);
      hw.winchX = cx; hw.winchY = 0.66; hw.winchZ = dH(cx, 0.72) + 0.2;
      hw.jibTrack = [C.mastX - 0.15, C.mastX - 0.85]; hw.jibTrackY = bw(C.mastX - 0.5) * 0.9;
    } else if (C.multihull) {
      hw.travX = C.sternX + 0.45; hw.travZ = C.freeboard + 0.12; hw.travHalf = C.hullSpacing / 2 * 0.85; hw.boomS = M.foot * 0.96;
      hw.winchX = C.mastX - 1.3; hw.winchY = 0.4; hw.winchZ = C.freeboard + 0.1;
      hw.jibTrack = [C.mastX - 0.45, C.mastX - 1.0]; hw.jibTrackY = 0.55;
    } else {
      hw.travX = C.sternX + 0.12; hw.travZ = dH(C.sternX + 0.12, 0) + 0.05; hw.travHalf = bw(0.02) * 0.8; hw.boomS = M.foot * 0.97;
      hw.ratchetX = C.mastX - 1.55; hw.ratchetZ = vis.ck.sole + 0.12;
    }
    // traveler track + car
    if (M.trav || C.id === 'dinghy') {
      const track = new THREE.Mesh(new THREE.BoxGeometry(hw.travHalf * 2 + 0.1, 0.025, 0.04), mTrack());
      track.position.copy(V(hw.travX, 0, hw.travZ - 0.03)); track.receiveShadow = true;
      if (C.id !== 'dinghy') inner.add(track);
      if (C.multihull) track.position.y += 0.04;
      this.car = makeBlock(0.045); inner.add(this.car);
    }
    // jib tracks, cars, winches
    this.winches = [];
    if (boat.sailBy.jib) {
      this.jibCars = [];
      for (const s of [-1, 1]) {
        const [xa, xb] = hw.jibTrack, xm = (xa + xb) / 2, y = s * hw.jibTrackY, z = dH(xm, y) + 0.015;
        const tr = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, Math.abs(xa - xb) + 0.1), mTrack());
        tr.position.copy(V(xm, y, z)); inner.add(tr);
        const car = makeBlock(0.04); inner.add(car); this.jibCars.push(car);
        const w = C.noWinches ? makeBlock(0.04) : makeWinch(bronze, C.id === 'blackwatch' ? 0.055 : 0.065);
        if (C.noWinches) w.userData = { spin: new THREE.Group(), handle: new THREE.Group(), angle: 0, handleAngle: 0 };
        w.position.copy(V(hw.winchX, s * hw.winchY, hw.winchZ)); inner.add(w);
        w.userData.side = s;
        this.winches.push(w);
      }
      this.jibSheets = [rope(0.0065, col.jib, 70), rope(0.0065, col.jib, 70)];
    }
    if (boat.sailBy.gennaker) {
      this.genBlocks = [];
      for (const s of [-1, 1]) { const y = C.multihull ? s * C.hullSpacing / 2 : s * bw(0.04) * 0.88; const bl = makeBlock(0.045); bl.position.copy(V(C.sternX + 0.3, y, dH(C.sternX + 0.3, y) + 0.06)); inner.add(bl); this.genBlocks.push(bl); }
      this.genSheets = [rope(0.006, 0xd9412b, 70), rope(0.006, 0xd9412b, 70)];
      this.tackLine = rope(0.004, 0xff7a1a, 20);
    }
    // blocks on the boom and at the mast base
    this.boomBlock = makeBlock(0.045); inner.add(this.boomBlock);
    this.mainsheet = [0, 1, 2, 3].map(() => rope(0.006, col.main, 16));
    this.mainTail = rope(0.006, col.main, 40);
    this.travLines = [rope(0.0035, 0xff7a1a, 12), rope(0.0035, 0xff7a1a, 12)];
    this.vang = [0, 1, 2, 3].map(() => rope(0.004, 0x333840, 10));
    this.vangTail = rope(0.004, 0x333840, 20);
    this.cunn = [rope(0.004, col.ctl, 10), rope(0.004, col.ctl, 10)];
    this.cunnTail = rope(0.004, col.ctl, 16);
    this.outhaul = rope(0.0035, 0x7fbf3f, 16);
    this.halyards = [rope(0.004, col.hal, 12), rope(0.004, 0xd9412b, 12), rope(0.004, 0x2f6fd6, 12)];
    if (C.hasBackstay) this.backstayTackle = [rope(0.0035, 0x9b5de5, 10), rope(0.0035, 0x9b5de5, 10), rope(0.0035, 0x9b5de5, 16)];
    if (boat.sailBy.stay) { this.staySheet = [rope(0.005, col.jib, 10), rope(0.005, col.jib, 10), rope(0.005, col.jib, 40)]; this.stayBlock = makeBlock(0.04); inner.add(this.stayBlock); }
    if (boat.sailBy.main.reefs) this.reefLines = [rope(0.004, 0xd24a3a, 20), rope(0.004, 0x3a8ad2, 20)];
    if (C.id === 'dinghy') { this.ratchet = makeBlock(0.05); this.ratchet.position.copy(V(hw.ratchetX, 0, hw.ratchetZ)); inner.add(this.ratchet); this.midBlock = makeBlock(0.04); inner.add(this.midBlock); this.strap = rope(0.012, 0x2a3140, 12); }
    this.lastLines = { ...boat.lines };
    if (this.player) {
      const hw2 = [this.car, ...(this.jibCars || []), ...this.winches, this.vis.rudderPivot].filter(Boolean);
      for (const x of hw2) x.traverse(o => { if (o.material && o.material.emissive) { o.material = o.material.clone(); o.userData.e0 = o.material.emissiveIntensity; } });
    }
    this.hands = {}; // no hands: tails lead to cleats and lie coiled on deck
  }

  // points on a boom (physics: distance s aft of the pivot, dz below)
  boomPt(key, s, dz = -0.07) {
    const piv = this.vis.booms[key].position, a = this.b.booms[key].a;
    return new THREE.Vector3(piv.x + Math.sin(a) * s, piv.y + dz, piv.z + Math.cos(a) * s);
  }
  clew(key) {
    const b = this.b, s = b.sailBy[key], sh = b.diag.shape[key], st = b.diag.strips[key];
    const a = st.baseAngle ?? 0;
    const tx = s.tackX + (key === 'gennaker' && this.b.cls.bowsprit ? 0 : 0);
    const foot = s.foot * (key === 'gennaker' ? 0.95 : 1);
    return V(tx - Math.cos(a) * foot, Math.sin(a) * foot, s.tackZ + 0.05);
  }

  update(t, active = true) {
    const b = this.b, C = b.cls, vis = this.vis, hw = this.hw, d = b.diag, L = d.rig || {};
    // gravity in the heeled boat frame
    vis.inner.updateMatrixWorld();
    vis.inner.getWorldQuaternion(_q).invert();
    this.g.set(0, -1, 0).applyQuaternion(_q);
    if (!active) { for (const r of this.ropes) r.hide(); return; }
    const g = this.g, M = b.sailBy.main;
    // --- mainsheet purchase: boom block <-> traveler car
    const bb = this.boomPt('main', hw.boomS, -0.1);
    this.boomBlock.position.copy(bb);
    let carY = 0;
    if (M.trav) {
      const side = Math.sign(b.booms.main.a) || 1;
      const travA = lerp(M.trav[0], M.trav[1], b.ctrl.trav);
      carY = clamp(side * Math.tan(travA) * (C.mastX - hw.travX), -hw.travHalf, hw.travHalf);
    } else if (C.id === 'dinghy') carY = clamp(bb.x, -hw.travHalf, hw.travHalf);
    const car = V(hw.travX, carY, hw.travZ);
    if (this.car) this.car.position.copy(car);
    const mT = Math.max(5, (L.mainLoad || 0) / 4);
    const off = [[0.02, 0.012], [-0.02, 0.012], [0.02, -0.012], [-0.02, -0.012]];
    if (C.id === 'dinghy') {
      // una-rig: boom end -> traveler block -> boom end -> mid-boom block -> ratchet block -> hand
      const mid = this.boomPt('main', 1.35, -0.08);
      this.midBlock.position.copy(mid);
      const rat = V(hw.ratchetX, 0, hw.ratchetZ);
      this.mainsheet[0].set([bb, car], mT, g); this.mainsheet[1].set([car, bb.clone().add(_v.set(0.02, 0, 0))], mT, g);
      this.mainsheet[2].set([bb, mid], mT, g); this.mainsheet[3].set([mid, rat], mT, g);
      this.mainTail.set([rat, this.hands.main || rat.clone().add(_v.set(0.2, 0.05, 0.2))], this.hands.main ? mT : 3, g);
      this.travLines[0].set([V(hw.travX, -hw.travHalf, hw.travZ), car], 40, g); this.travLines[1].set([car, V(hw.travX, hw.travHalf, hw.travZ)], 40, g);
      this.strap.set([V(C.mastX - 1.1, 0, this.vis.ck.sole + 0.05), V(C.mastX - 2.1, 0, this.vis.ck.sole + 0.05)], 30, g);
    } else {
      for (let i = 0; i < 4; i++) {
        const o = off[i];
        this.mainsheet[i].set([bb.clone().add(_v.set(o[0], 0, o[1])), car.clone().add(_w.set(o[0], 0.02, o[1]))], mT, g);
      }
      const tailEnd = this.hands.main || car.clone().add(_v.set(0.3, -0.02, 0.3));
      this.mainTail.set([car.clone().add(_v.set(0, 0.03, 0)), tailEnd], this.hands.main ? mT : 2, g);
      const tl = Math.max(5, (L.mainLoad || 0) * 0.15);
      this.travLines[0].set([V(hw.travX, -hw.travHalf, hw.travZ), car], tl, g);
      this.travLines[1].set([car, V(hw.travX, hw.travHalf, hw.travZ)], tl, g);
    }
    // --- vang: 4-part tackle from the boom to the mast base, tail to the deck
    const vTop = this.boomPt('main', C.id === 'dinghy' ? 0.45 : 0.7, -0.07);
    const vBot = V(C.mastX - 0.1, 0, vis.mastBase + 0.12);
    const vt = 20 + 1800 * b.ctrl.vang * (C.id === 'dinghy' ? 0.6 : 1);
    for (let i = 0; i < 4; i++) { const o = off[i]; this.vang[i].set([vTop.clone().add(_v.set(o[0] * 0.6, 0, o[1])), vBot.clone().add(_w.set(o[0] * 0.6, 0, o[1]))], vt, g); }
    this.vangTail.set([vBot, V(C.mastX - 0.35, 0.12, vis.mastBase + 0.03), V(C.mastX - 0.9, 0.2, vis.deckH(C.mastX - 0.9, 0.2) + 0.03)], vt / 4, g);
    // --- cunningham, outhaul, halyards
    const rf = reefAt(b.reefPos);
    const tack = V(C.mastX - 0.06, 0, C.boomZ + 0.22 + (b.reefPos > 0 ? M.luff * (1 - rf.l) : 0));
    const cDeck = V(C.mastX - 0.12, 0.05, vis.mastBase + 0.05);
    const ct = 10 + 600 * b.ctrl.cunn;
    this.cunn[0].set([tack, cDeck], ct, g); this.cunn[1].set([tack.clone().add(_v.set(0.02, 0, 0)), cDeck.clone().add(_w.set(0.02, 0, 0))], ct, g);
    this.cunnTail.set([cDeck, V(C.mastX - 0.6, -0.18, vis.deckH(C.mastX - 0.6, -0.18) + 0.03)], ct / 2, g);
    const clewB = this.boomPt('main', M.foot * (0.92 + 0.05 * b.ctrl.outhaul), -0.02);
    this.outhaul.set([clewB, this.boomPt('main', M.foot + 0.02, -0.04), this.boomPt('main', M.foot * 0.5, -0.1)], 50 + 400 * b.ctrl.outhaul, g);
    const exitZ = vis.mastBase + 0.5;
    const hals = [V(C.mastX - 0.07, 0.02, exitZ), V(C.mastX + 0.07, 0, exitZ + 0.2), V(C.mastX + 0.07, -0.02, exitZ + 0.1)];
    // clutches on the aft end of the cabin roof (or the deck ahead of the cockpit), halyards run along the top
    const cx0 = C.id === 'sportboat' ? C.mastX - 0.75 : C.mastX - 1.0;
    const clutch = (i) => V(cx0 - i * 0.02, (i - 1) * 0.08 + (C.id === 'dinghy' ? 0 : 0.18), vis.deckH(cx0, 0.18) + 0.03);
    for (let i = 0; i < 3; i++) {
      const on = i === 0 || (i === 1 && b.sailBy.gennaker && b.genDeploy > 0.02) || (i === 2 && (b.sailBy.jib || b.sailBy.stay));
      if (!on || C.id === 'dinghy') { this.halyards[i].hide(); continue; }
      const slackH = i === 0 ? b.reefSlack : 0;
      this.halyards[i].set([hals[i], V(C.mastX - 0.08, (i - 1) * 0.06, vis.mastBase + 0.08), clutch(i)], slackH > 0.1 ? 3 : 300, g, slackH * 0.4, t);
    }
    // --- backstay adjuster
    if (this.backstayTackle) {
      const top = vis.stay.backstayLow;
      const bst = 30 + 1200 * b.ctrl.backstay;
      for (const [i, s] of [[0, -1], [1, 1]]) this.backstayTackle[i].set([top, V(C.sternX + 0.3, s * 0.15, vis.deckH(C.sternX + 0.3, 0) + 0.05)], bst, g);
      this.backstayTackle[2].set([V(C.sternX + 0.3, 0, vis.deckH(C.sternX + 0.3, 0) + 0.05), V(C.sternX + 0.9, 0.25, vis.ck.sole + 0.1)], bst / 3, g);
    }
    // --- reef lines (Blackwatch): from the reef clew cringle to the boom end, forward along the boom
    if (this.reefLines) {
      for (let i = 0; i < 2; i++) {
        const rl = this.reefLines[i];
        const hRow = M.luff * (i === 0 ? 0.16 : 0.31);
        const tension = b.reefPos > i + 0.5 ? 500 : b.reefing && b.reefPos > i ? 200 : 4;
        const cringle = this.boomPt('main', M.foot * 0.9, 0.0).add(_v.set(0, Math.max(0.05, hRow * (1 - clamp(b.reefPos - i, 0, 1))), 0));
        rl.set([cringle, this.boomPt('main', M.foot * 0.98, -0.06), this.boomPt('main', 0.3, -0.08)], tension, g);
      }
    }
    // --- jib sheets: clew -> car -> winch -> tail (lazy sheet goes around the mast)
    const J = b.sailBy.jib;
    if (J) {
      const jibOn = (d.strips.jib.areaF ?? 1) > 0.05;
      const side = Math.sign(b.side.jib) || 1;
      const clew = this.clew('jib');
      const xCar = lerp(this.hw.jibTrack[0], this.hw.jibTrack[1], b.ctrl.jibLead);
      const jl = Math.max(4, (L.jibLoad || 0));
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        const carP = V(xCar, s * hw.jibTrackY, vis.deckH(xCar, s * hw.jibTrackY) + 0.05);
        this.jibCars[k].position.copy(carP);
        const w = this.winches[k];
        const wp = w.position.clone().add(_v.set(-s * 0.06, 0.1, 0));
        const active = s === side;
        const tailHand = active ? this.hands.jib : null;
        const tailEnd = tailHand || w.position.clone().add(_w.set(-s * 0.35, -0.12, 0.25));
        if (!jibOn) { this.jibSheets[k].hide(); continue; }
        if (active) this.jibSheets[k].set([clew, carP, wp, w.position.clone().add(_v.set(0, 0.2, 0)), tailEnd], [jl, jl, jl, tailHand ? jl * 0.1 : 2], g);
        else this.jibSheets[k].set([clew, V(C.mastX + 0.35, 0, vis.deckH(C.mastX + 0.35, 0) + 0.35), carP, wp, tailEnd], [6, 6, 20, 3], g, 0.2, t);
      }
    }
    // --- gennaker sheets and tack line
    if (this.genSheets) {
      const gd = b.genDeploy;
      if (gd < 0.05) { this.genSheets.forEach(r => r.hide()); this.tackLine.hide(); }
      else {
        const G = b.sailBy.gennaker, side = Math.sign(b.side.gennaker) || 1;
        const clew = this.clew('gennaker');
        const gl = Math.max(4, (L.jibLoad || 0));
        for (let k = 0; k < 2; k++) {
          const s = k ? 1 : -1, bl = this.genBlocks[k].position, w = this.winches[k];
          const tailEnd = s === side && this.hands.jib ? this.hands.jib : w.position.clone().add(_w.set(-s * 0.3, -0.1, 0.3));
          if (s === side) this.genSheets[k].set([clew, bl, w.position.clone().add(_v.set(0, 0.2, 0)), tailEnd], [gl, gl, 3], g);
          else this.genSheets[k].set([clew, V(G.tackX + 0.2, 0, G.tackZ + 0.5), bl, w.position.clone().add(_v.set(0, 0.2, 0))], [5, 5, 5], g, 0.3, t);
        }
        const tk = V(G.tackX, 0, G.tackZ);
        this.tackLine.set([tk.clone().add(_v.set(0, 0.3 * b.ctrl.tackLine, 0)), V(C.bowX - 0.5, 0, vis.deckH(C.bowX - 0.5, 0) + 0.05), V(C.mastX - 0.9, 0.3, vis.deckH(C.mastX - 0.9, 0.3) + 0.03)], 200, g);
      }
    }
    // --- self-tacking staysail: club block -> deck traveler -> aft along the cabin
    if (this.staySheet) {
      const S2 = b.sailBy.stay;
      const cb = this.boomPt('stay', S2.foot * 0.9, -0.06);
      const dk = V(S2.tackX - S2.foot * 0.9, 0, vis.deckH(S2.tackX - S2.foot * 0.9, 0) + 0.05);
      this.stayBlock.position.copy(dk);
      const st = Math.max(4, (L.stayLoad || 0) / 2);
      this.staySheet[0].set([cb, dk], st, g); this.staySheet[1].set([cb.clone().add(_v.set(0.02, 0, 0)), dk.clone().add(_w.set(0.02, 0, 0))], st, g);
      this.staySheet[2].set([dk, V(C.mastX + 0.1, 0.08, vis.deckH(C.mastX + 0.1, 0.08) + 0.04), V(C.mastX - 1.1, 0.25, vis.deckH(C.mastX - 1.1, 0.25) + 0.04), this.hands.stay || V(C.mastX - 1.4, 0.3, vis.deckH(C.mastX - 1.4, 0.3) + 0.03)], [st, st, 3], g);
    }
    // --- winch drums turn with the line (trimming in turns them clockwise), handle on the working winch
    for (const w of this.winches) {
      const s = w.userData.side, active = s === (Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1);
      const dLine = (this.lastLines.jib - b.lines.jib) * (b.genDeploy > 0.5 ? 3.0 : 1.4); // metres of sheet
      if (active) { w.userData.angle -= dLine / 0.06; if (dLine > 0) w.userData.handleAngle -= dLine / 0.06 / 3.5; }
      w.userData.spin.rotation.y = w.userData.angle;
      w.userData.handle.visible = active && !!b.sailBy.jib;
      w.userData.handle.rotation.y = w.userData.handleAngle;
    }
    this.lastLines = { ...b.lines };
    this.applyGlow();
  }

  // world position of the working winch handle grip (for the grinder's hands)
  handleGrip(out = new THREE.Vector3()) {
    const b = this.b;
    const side = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1;
    const w = this.winches.find(w => w.userData.side === side);
    if (!w) return null;
    const a = w.userData.handleAngle;
    out.set(Math.cos(-a) * 0.23, 0.3, Math.sin(-a) * 0.23).add(w.position);
    return out;
  }

  // ropes belonging to a grab point, for the glow
  ropesFor(id) {
    const b = this.b, side = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1, k = (side + 1) / 2;
    const m = {
      main: [...this.mainsheet, this.mainTail], trav: this.travLines, vang: [...this.vang, this.vangTail], cunn: [...this.cunn, this.cunnTail],
      outhaul: [this.outhaul], backstay: this.backstayTackle || [], stay: this.staySheet || [], reef: this.reefLines || [],
      winch: b.genDeploy > 0.5 ? [this.genSheets?.[k]].filter(Boolean) : [this.jibSheets?.[k]].filter(Boolean),
      jibtail: b.genDeploy > 0.5 ? [this.genSheets?.[k]].filter(Boolean) : [this.jibSheets?.[k]].filter(Boolean),
      jibpull: [this.jibSheets?.[k]].filter(Boolean), jibLead: [this.jibSheets?.[k]].filter(Boolean), jibHalyard: [this.halyards[2]],
      gen: [this.halyards[1]], tackLine: [this.tackLine].filter(Boolean),
    };
    return m[id] || [];
  }
  // every control carries a faint outline so you can see what can be handled; the hovered one glows
  controlIds() { return ['main', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'stay', 'reef', 'winch', 'jibLead', 'jibHalyard', 'gen', 'tackLine', 'jibpull']; }
  applyGlow() {
    if (!this.player) return;
    for (const r of this.ropes) r.glow(0);
    if (this._hl) for (const rp of this.ropesFor(this._hl)) rp.glow(2);
  }
  // side-panel button keys -> the control on deck
  static idForKey(k, b) {
    const m = { main: 'main', trav: 'trav', vang: 'vang', cunn: 'cunn', outhaul: 'outhaul', backstay: 'backstay', stay: 'stay', jibLead: 'jibLead', jibHalyard: 'jibHalyard', tackLine: 'tackLine', helm: 'tiller', board: 'board', reef: 'reef', gen: 'gen' };
    if (k === 'jib') return b.cls.noWinches ? 'jibpull' : 'winch';
    return m[k] || null;
  }
  highlight(id) {
    if (this._hl === id) return;
    for (const x of this._hlObjs || []) x.traverse(o => { if (o.material && o.material.emissive) o.material.emissiveIntensity = o.userData.e0 ?? 0; });
    this._hl = id; this._hlObjs = [];
    this.applyGlow();
    if (!id) return;
    const objs = id === 'trav' ? [this.car] : id === 'jibLead' ? this.jibCars : id === 'winch' ? this.winches : id === 'tiller' ? [this.vis.rudderPivot] : [];
    for (const x of objs.filter(Boolean)) x.traverse(o => { if (o.material && o.material.emissive) { if (o.userData.e0 === undefined) { o.material = o.material.clone(); o.userData.e0 = o.material.emissiveIntensity; } o.material.emissive.setHex(0xff8a2a); o.material.emissiveIntensity = 0.9; } });
    this._hlObjs = objs.filter(Boolean);
  }

  // ---------------------------------------------------------------- grab points for the player
  grabs() {
    const b = this.b, C = b.cls, hw = this.hw, vis = this.vis, S = b.sailBy;
    const list = [];
    const toW = (p) => vis.inner.localToWorld(p.clone());
    const L = b.diag.rig || {};
    const deg = (r) => Math.round(Math.abs(r) * 180 / Math.PI);
    list.push({ id: 'main', label: 'Mainsheet', hint: 'pull up to trim, down to ease', kind: 'pull', key: 'main', dir: -1, pos: toW(this.mainsheet[0].pts[8]), info: () => `${Math.round(L.mainLoad || 0)} N · boom ${deg(b.booms.main.a)}°` });
    if (S.main.trav) {
      const A = toW(V(hw.travX, -hw.travHalf, hw.travZ)), B = toW(V(hw.travX, hw.travHalf, hw.travZ));
      list.push({ id: 'trav', label: 'Traveler car', hint: 'slide along the track', kind: 'track', key: 'trav', A, B, pos: toW(this.car.position), info: () => `${Math.round(b.ctrl.trav * 100)}% to leeward` });
    }
    list.push({ id: 'vang', label: 'Vang', hint: 'pull up for more leech tension', kind: 'pull', key: 'vang', dir: 1, pos: toW(this.vang[0].pts[5]), info: () => `${Math.round(b.ctrl.vang * 100)}%` });
    list.push({ id: 'cunn', label: 'Cunningham', hint: 'pull to move the draft forward', kind: 'pull', key: 'cunn', dir: 1, pos: toW(this.cunn[0].pts[5]), info: () => `${Math.round(b.ctrl.cunn * 100)}%` });
    list.push({ id: 'outhaul', label: 'Outhaul', hint: 'pull to flatten the foot', kind: 'pull', key: 'outhaul', dir: 1, pos: toW(this.outhaul.pts[3]), info: () => `${Math.round(b.ctrl.outhaul * 100)}%` });
    if (C.hasBackstay) list.push({ id: 'backstay', label: 'Backstay adjuster', hint: 'pull to bend the mast and tighten the forestay', kind: 'pull', key: 'backstay', dir: 1, pos: toW(this.backstayTackle[2].pts[6]), info: () => `${Math.round(L.backstayLoad || 0)} N` });
    if (this.winches.length && (S.jib || S.gennaker)) {
      const side = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1;
      const w = this.winches.find(w => w.userData.side === side);
      const name = b.genDeploy > 0.5 ? 'Gennaker' : 'Jib';
      if (C.noWinches) list.push({ id: 'jibpull', label: `${name} sheet`, hint: 'pull up to trim, down to ease', kind: 'pull', key: 'jib', dir: -1, pos: toW(w.position.clone().add(_v.set(0, 0.05, 0))), info: () => `${Math.round(L.jibLoad || 0)} N` });
      else list.push({ id: 'winch', label: `${name} winch`, hint: 'crank clockwise to trim', kind: 'crank', key: 'jib', pos: toW(w.position.clone().add(_v.set(0, 0.2, 0))), info: () => `${Math.round(L.jibLoad || 0)} N` });
      const tail = (b.genDeploy > 0.5 ? this.genSheets[(side + 1) / 2] : this.jibSheets[(side + 1) / 2]);
      list.push({ id: 'jibtail', label: `${name} sheet tail`, hint: 'drag down to ease (let it surge round the drum)', kind: 'pull', key: 'jib', dir: -1, easeOnly: true, pos: toW(tail.pts[tail.maxPts - 6]), info: () => `${Math.round(L.jibLoad || 0)} N` });
      if (S.jib && b.genDeploy < 0.5) {
        const A = toW(V(hw.jibTrack[0], side * hw.jibTrackY, vis.deckH(hw.jibTrack[0], side * hw.jibTrackY))), B = toW(V(hw.jibTrack[1], side * hw.jibTrackY, vis.deckH(hw.jibTrack[1], side * hw.jibTrackY)));
        list.push({ id: 'jibLead', label: 'Jib car', hint: 'slide forward for a deeper foot, aft to open the leech', kind: 'track', key: 'jibLead', A, B, pos: toW(this.jibCars[(side + 1) / 2].position), info: () => `${Math.round(b.ctrl.jibLead * 100)}% aft` });
        list.push({ id: 'jibHalyard', label: 'Jib halyard', hint: 'pull to tension the luff', kind: 'pull', key: 'jibHalyard', dir: 1, pos: toW(this.halyards[2].pts[8]), info: () => `${Math.round(b.ctrl.jibHalyard * 100)}%` });
      }
    }
    if (S.gennaker) {
      list.push({ id: 'gen', label: b.ctrl.gen ? 'Gennaker halyard — douse' : 'Gennaker halyard — hoist', hint: 'click', kind: 'click', action: 'gen', pos: toW(V(C.mastX - 0.1, -0.1, this.vis.mastBase + 0.3)), info: () => `${Math.round(b.genDeploy * 100)}% up` });
      if (b.genDeploy > 0.3) list.push({ id: 'tackLine', label: 'Tack line', hint: 'pull down, ease to let the luff rotate', kind: 'pull', key: 'tackLine', dir: -1, pos: toW(this.tackLine.pts[4]), info: () => `${Math.round(b.ctrl.tackLine * 100)}% eased` });
    }
    if (this.staySheet) list.push({ id: 'stay', label: 'Staysail sheet', hint: 'pull up to trim, down to ease', kind: 'pull', key: 'stay', dir: -1, pos: toW(this.staySheet[2].pts[30]), info: () => `${Math.round(L.stayLoad || 0)} N · club ${deg(b.booms.stay.a)}°` });
    if (this.reefLines) list.push({ id: 'reef', label: 'Reef line', hint: 'click to put in the next reef, shift-click to shake out', kind: 'click', action: 'reef', pos: toW(this.reefLines[b.reefPos >= 1 ? 1 : 0].pts[6]), info: () => b.reefing ? `working… ${Math.round(b.diag.reefProgress * 100)}%` : `${b.ctrl.reef | 0} reef${(b.ctrl.reef | 0) === 1 ? '' : 's'} in` });
    if (C.hasBoard && vis.keelMesh) {
      // grab the top of a board (for a catamaran, the one in the windward hull)
      const holder = C.keel.twin ? vis.keelMesh.children[(Math.sign(-b.phi || 1) + 1) / 2] || vis.keelMesh.children[0] : vis.keelMesh;
      list.push({ id: 'board', label: C.keel.twin ? 'Daggerboards' : 'Daggerboard', hint: 'drag up or down', kind: 'pull', key: 'board', dir: 1, pos: holder.localToWorld(new THREE.Vector3(0, 0.08, C.keel.chord * 0.4)), info: () => `${Math.round(b.ctrl.board * 100)}% down` });
    }
    // tiller: drag it sideways — the bow goes the other way
    const tp = vis.extension
      ? vis.extension.localToWorld(new THREE.Vector3(0, vis.extension.userData.len, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2 + 0.08))
      : vis.rudderPivot.localToWorld(vis.tillerEnd.clone());
    list.push({ id: 'tiller', label: C.id === 'blackwatch' ? 'Tiller' : 'Tiller extension', hint: 'drag sideways; push it to port and the bow goes to starboard', kind: 'tiller', pos: tp, info: () => `rudder ${Math.round(b.rudder * 180 / Math.PI)}°` });
    return list;
  }
}
