// Running rigging you can see and handle: ropes (sagging by tension), multi-part purchases, blocks,
// tracks and cars, winches whose drums turn as line comes in, and the grab points the player uses
// to pull, ease, crank and slide them.
import * as THREE from 'three';
import { V } from './models.js';
import { clamp, lerp, sstep, reefAt } from './physics.js';

const ROPE_W = 1.4; // N/m, a little heavier than real so sag reads at a distance
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ------------------------------------------------------------------ rope: tube rebuilt in place
let braidTex = null;
function braid() {
  if (braidTex) return braidTex;
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 64);
  // two sets of strands winding opposite ways, with a darker fleck: reads as braid when it moves
  for (let i = -64; i < 96; i += 8) {
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, i); g.lineTo(32, i + 16); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.moveTo(0, i + 4); g.lineTo(32, i - 12); g.stroke();
  }
  g.fillStyle = 'rgba(20,40,90,0.35)'; for (let y = 3; y < 64; y += 16) g.fillRect(6, y, 4, 3);
  braidTex = new THREE.CanvasTexture(cv); braidTex.wrapS = braidTex.wrapT = THREE.RepeatWrapping; braidTex.colorSpace = THREE.SRGBColorSpace;
  return braidTex;
}
class Rope {
  constructor(parent, radius, color, maxPts = 64, radial = 6) {
    radius *= 1.7;                                   // drawn thicker than life so lines read on screen
    this.maxPts = maxPts; this.radial = radial; this.radius = radius;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * radial * 3);
    this.nor = new Float32Array(maxPts * radial * 3);
    this.uv = new Float32Array(maxPts * radial * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.feed = 0;   // metres of line that have run through: scrolls the braid
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mat = new THREE.MeshStandardMaterial({ color, map: braid(), roughness: 0.7, emissive: color, emissiveIntensity: 0.12 });
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
    // a loaded line is straight: only slack lines and free tails need the point-mass simulation
    const tMin = Array.isArray(tension) ? Math.min(...tension) : tension;
    if (this.sim && this.sim.M && (this.freeEnd || tMin < 150)) { this.simulate(path, tension); this.buildTube(); return; }
    this._stale = true;
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
    // a slack line lies on the deck / cabin roof instead of sagging through it
    if (this.floor) for (let i = 1; i < budget; i++) this.floor(this.pts[i], this.radius);
    this.buildTube();
  }

  // ---- a real rope: a chain of point masses (Verlet) simulated in world space between its anchors.
  // Gravity, the boat's motion (roll, pitch, heave, acceleration) and drag in the apparent wind move it;
  // each span's length comes from the line's tension (loaded = straight, eased = slack and swinging);
  // a tail has a free end that spills onto the deck as line is hauled in and draws back as it is eased.
  simulate(path, tension) {
    const S = this.sim, M = S.M, Minv = S.Minv, dt = Math.min(1 / 30, Math.max(1 / 240, S.dt || 1 / 60));
    const n = path.length, spans = n - 1, N = this.maxPts;
    const anchors = path.map(p => p.clone().applyMatrix4(M));
    // topology: particles per span in proportion to the span lengths (fixed once laid out)
    if (!this._P || this._spans !== spans) {
      const lens = []; let tot = 0;
      for (let i = 0; i < spans; i++) { const L = path[i].distanceTo(path[i + 1]) + 0.05; lens.push(L); tot += L; }
      const segs = lens.map(L => Math.max(2, Math.round((N - 1) * L / tot)));
      let sum = segs.reduce((a, b) => a + b, 0);
      while (sum > N - 1) { const i = segs.indexOf(Math.max(...segs)); segs[i]--; sum--; }
      while (sum < N - 1) { segs[segs.length - 1]++; sum++; }
      this._segs = segs; this._spans = spans; this._freeTopo = null;
      this._start = []; let k = 0; for (const s of segs) { this._start.push(k); k += s; }
      this._P = []; this._Pp = [];
      for (let i = 0; i < spans; i++) for (let j = 0; j < segs[i]; j++) {
        const p = anchors[i].clone().lerp(anchors[i + 1], j / segs[i]); this._P.push(p); this._Pp.push(p.clone());
      }
      const e = anchors[n - 1].clone(); this._P.push(e); this._Pp.push(e.clone());
    }
    const P = this._P, Pp = this._Pp, segs = this._segs, start = this._start;
    // teleport (new session, respawn) or coming back from a taut / static spell: lay the rope out again
    if (this._stale || P[0].distanceToSquared(anchors[0]) > 25) {
      this._stale = false;
      let k = 0; for (let i = 0; i < spans; i++) for (let j = 0; j < segs[i]; j++, k++) { P[k].lerpVectors(anchors[i], anchors[i + 1], j / segs[i]); Pp[k].copy(P[k]); }
      P[k].copy(anchors[n - 1]); Pp[k].copy(P[k]);
    }
    // rest length of each span from the tension (catenary sag -> extra length); a free tail keeps its own length
    const rest = [];
    for (let i = 0; i < spans; i++) {
      const L = anchors[i].distanceTo(anchors[i + 1]);
      const T = Math.max(2, Array.isArray(tension) ? tension[i] : tension);
      const sag = Math.min(0.4 * L, ROPE_W * L * L / (8 * T));
      let R = L + 8 * sag * sag / (3 * Math.max(L, 0.05));
      if (this.freeEnd && i === spans - 1 && this.tailRest) R = this.tailRest;
      rest.push(R / segs[i]);
    }
    if (this._freeTopo !== this.freeEnd) {
      this._freeTopo = this.freeEnd;
      this._pin = new Int16Array(N).fill(-1);
      for (let i = 0; i < spans; i++) this._pin[start[i]] = i;
      if (!this.freeEnd) this._pin[N - 1] = n - 1;
    }
    const pin = this._pin, pinned = (k) => pin[k] >= 0 ? anchors[pin[k]] : null;
    // integrate: gravity + drag in the apparent wind, light damping
    const wind = S.wind, g = -9.81 * dt * dt, cd = 0.05 * dt * dt;
    const v = this._v || (this._v = new THREE.Vector3()), rel = this._rel || (this._rel = new THREE.Vector3());
    for (let k = 0; k < N; k++) {
      const a = pinned(k);
      if (a) { P[k].copy(a); Pp[k].copy(a); continue; }
      v.subVectors(P[k], Pp[k]).multiplyScalar(0.985);
      rel.copy(wind).addScaledVector(v, -1 / dt);
      const sp = rel.length();
      Pp[k].copy(P[k]);
      P[k].add(v).addScaledVector(rel, cd * sp); P[k].y += g;
    }
    // constraints: segment lengths, pins, and the deck / cabin roof underneath (with friction)
    const lp = this._lp || (this._lp = new THREE.Vector3()), d = this._d || (this._d = new THREE.Vector3());
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < spans; i++) for (let j = 0; j < segs[i]; j++) {
        const k = start[i] + j, A = P[k], B = P[k + 1];
        d.subVectors(B, A); const len = d.length() || 1e-6, diff = (len - rest[i]) / len;
        const pa = pinned(k), pb = pinned(k + 1);
        if (pa && pb) continue;
        if (pa) B.addScaledVector(d, -diff); else if (pb) A.addScaledVector(d, diff); else { A.addScaledVector(d, diff * 0.5); B.addScaledVector(d, -diff * 0.5); }
      }
      if (this.floor && (it === 3 || it === 7)) for (let k = 1; k < N; k++) {
        if (pinned(k)) continue;
        lp.copy(P[k]).applyMatrix4(Minv); const y0 = lp.y, x0 = lp.x, z0 = lp.z;
        this.floor(lp, this.radius);
        if (this.contain) this.contain(lp);
        if (lp.y !== y0 || lp.x !== x0 || lp.z !== z0) { P[k].copy(lp.applyMatrix4(M)); Pp[k].lerp(P[k], 0.6); } // resting on deck: friction
      }
    }
    for (let k = 0; k < N; k++) this.pts[k].copy(P[k]).applyMatrix4(Minv);
  }

  buildTube() {
    // tube frames
    const R = this.radius, rad = this.radial;
    let ref = new THREE.Vector3(0, 1, 0);
    let arc = 0;
    const T = new THREE.Vector3(), N = new THREE.Vector3(), Bn = new THREE.Vector3();
    for (let i = 0; i < this.maxPts; i++) {
      const a = this.pts[Math.max(0, i - 1)], b = this.pts[Math.min(this.maxPts - 1, i + 1)];
      T.subVectors(b, a); if (T.lengthSq() < 1e-12) T.set(0, 0, 1); T.normalize();
      if (Math.abs(T.dot(ref)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
      N.crossVectors(T, ref).normalize(); Bn.crossVectors(T, N);
      const p = this.pts[i];
      if (i > 0) arc += p.distanceTo(this.pts[i - 1]);
      const uAlong = (arc - this.feed) / 0.06;                      // one braid repeat every 6 cm
      for (let j = 0; j < rad; j++) {
        const th = j / rad * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
        const nx = N.x * c + Bn.x * s, ny = N.y * c + Bn.y * s, nz = N.z * c + Bn.z * s;
        const o = (i * rad + j) * 3;
        this.pos[o] = p.x + nx * R; this.pos[o + 1] = p.y + ny * R; this.pos[o + 2] = p.z + nz * R;
        this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
        const uo = (i * rad + j) * 2; this.uv[uo] = j / rad; this.uv[uo + 1] = uAlong;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
    this.mesh.geometry.attributes.uv.needsUpdate = true;
  }
  hide() { this.mesh.visible = false; this.outline.visible = false; }
  // 0 = none, 1 = faint (a control you can grab), 2 = bright (the one you are pointing at)
  glow(level) {
    const on = level > 0 && this.mesh.visible;
    this.outline.visible = on;
    if (on) this.outline.material = level === 2 ? OUTLINE_MAT : FAINT_MAT;
    this.mat.emissive.setHex(level === 2 ? 0xff8a2a : this.mat.color.getHex());
    this.mat.emissiveIntensity = level === 2 ? 0.8 : 0.06;
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
    const floorAt = (p, rad) => {
      const x = -p.z, y = p.x;
      if (x < C.sternX || x > C.bowX) return;
      const t = clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
      const inBeam = C.multihull ? Math.abs(Math.abs(y) - C.hullSpacing / 2) < Lx.bDeck(t) || Math.abs(y) < C.hullSpacing / 2 : Math.abs(y) < Lx.bDeck(t);
      if (!inBeam) return;
      const top = dH(x, y) + rad + 0.005;
      if (p.y < top) p.y = top;
    };
    // toe rail / coaming and transom: a line lying on deck stays aboard instead of sliding over the side
    const containAt = (p) => {
      let x = -p.z; const y = p.x;
      if (x < C.sternX - 0.3 || x > C.bowX) return;
      const xc = clamp(x, C.sternX + 0.06, C.bowX - 0.1);
      const t = clamp((xc - C.sternX) / (C.bowX - C.sternX), 0, 1), half = Lx.bDeck(t) - 0.05;
      const top = dH(xc, clamp(y, -half, half));
      if (p.y > top + 0.12) return;                    // above the rail: free to swing outboard
      if (C.multihull) {
        const c = C.hullSpacing / 2, hs = Math.sign(y) || 1, dy = Math.abs(y) - c;
        if (Math.abs(dy) > half && Math.abs(y) > c) p.x = hs * (c + half);
      } else if (Math.abs(y) > half) p.x = Math.sign(y) * half;
      if (x !== xc) p.z = -xc;
    };
    const rope = (r, c, n) => { const R = new Rope(inner, r, c, n); R.floor = floorAt; R.contain = containAt; this.ropes.push(R); return R; };
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
    // cabin-top winch: any control led aft through the clutches can be put on it and ground in
    if (!C.noWinches && (C.id === 'blackwatch' || C.id === 'sportboat')) {
      const x = C.id === 'blackwatch' ? C.mastX - 1.3 : C.mastX - 1.1, y = C.id === 'blackwatch' ? 0.36 : 0.42;
      const w = makeWinch(bronze, 0.045); w.position.copy(V(x, y, vis.deckH(x, y))); inner.add(w);
      w.userData.side = 0; this.cabinWinch = w; this.winches.push(w);
      this.cabinLead = rope(0.0045, col.ctl, 40);
      this.cabinLines = ['jibHalyard', 'cunn', 'outhaul', 'vang'].filter(k => k !== 'jibHalyard' || boat.sailBy.jib);
      this.cabinLine = this.cabinLines[0];
    }
    this.handleOn = 'work'; // the one winch handle: on the working winch until you use another
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
      for (const x of hw2) x.traverse(o => { if (o.material && o.material.emissive) { o.material = o.material.clone(); o.userData.e0 = o.material.emissiveIntensity; o.userData.e0c = o.material.emissive.getHex(); } });
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
    return V(tx - Math.cos(a) * foot, Math.sin(a) * foot, s.tackZ + 0.05 + (s.footRise || 0));
  }

  update(t, active = true, dt = 1 / 60, env = null) {
    const b = this.b, C = b.cls, vis = this.vis, hw = this.hw, d = b.diag, L = d.rig || {};
    // gravity in the heeled boat frame (refresh the parents too: the pose was just set on the root)
    vis.inner.updateWorldMatrix(true, false);
    // the player's ropes are simulated (world-space point masses); the others are drawn as static catenaries
    let ctx = null;
    if (active && vis.player && env) {
      const S = this._ctx || (this._ctx = { M: new THREE.Matrix4(), Minv: new THREE.Matrix4(), wind: new THREE.Vector3(), dt: 1 / 60, w: {} });
      S.M.copy(vis.inner.matrixWorld); S.Minv.copy(S.M).invert(); S.dt = dt;
      const P = b.pose || b, w = env.wind.sample(P.x, P.z, t, S.w);
      S.wind.set(-Math.sin(w.dir) * w.speed, 0, Math.cos(w.dir) * w.speed);
      ctx = S;
    }
    for (const r of this.ropes) { r.sim = ctx; r.freeEnd = false; }
    vis.inner.getWorldQuaternion(_q).invert();
    this.g.set(0, -1, 0).applyQuaternion(_q);
    if (!active) { for (const r of this.ropes) r.hide(); return; }
    const g = this.g, M = b.sailBy.main;
    // line running through the blocks: sheets by how far they are eased, controls by their setting
    const feedMain = b.lines.main * 3.5, feedJib = b.lines.jib * 2.2, feedStay = b.lines.stay * 1.5;
    this.mainsheet.forEach((rp, i) => { rp.feed = (i % 2 ? -1 : 1) * feedMain * 0.25; });
    this.mainTail.feed = -feedMain;
    this.vang.forEach((rp, i) => { rp.feed = (i % 2 ? -1 : 1) * b.ctrl.vang * 0.3; }); this.vangTail.feed = -b.ctrl.vang * 1.2;
    this.cunn.forEach((rp, i) => { rp.feed = (i % 2 ? -1 : 1) * b.ctrl.cunn * 0.2; }); this.cunnTail.feed = -b.ctrl.cunn * 0.4;
    this.outhaul.feed = b.ctrl.outhaul * 0.3;
    this.travLines[0].feed = b.ctrl.trav * 1.1; this.travLines[1].feed = -b.ctrl.trav * 1.1;
    if (this.jibSheets) this.jibSheets.forEach(rp => { rp.feed = feedJib; });
    if (this.genSheets) this.genSheets.forEach(rp => { rp.feed = feedJib * 1.6; });
    if (this.staySheet) this.staySheet.forEach(rp => { rp.feed = feedStay; });
    if (this.backstayTackle) this.backstayTackle.forEach((rp, i) => { rp.feed = (i === 2 ? -1 : 1) * b.ctrl.backstay * 0.5; });
    this.halyards[2].feed = b.ctrl.jibHalyard * 0.2;
    if (this.tackLine) this.tackLine.feed = b.ctrl.tackLine * 0.6;
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
      this.mainTail.freeEnd = !this.hands.main; this.mainTail.tailRest = 0.5 + (1 - b.lines.main) * 2.0;
      this.mainTail.set([rat, this.hands.main || rat.clone().add(_v.set(0.2, 0.05, 0.2))], this.hands.main ? mT : 3, g);
      this.travLines[0].set([V(hw.travX, -hw.travHalf, hw.travZ), car], 40, g); this.travLines[1].set([car, V(hw.travX, hw.travHalf, hw.travZ)], 40, g);
      this.strap.set([V(C.mastX - 1.1, 0, this.vis.ck.sole + 0.05), V(C.mastX - 2.1, 0, this.vis.ck.sole + 0.05)], 30, g);
    } else {
      for (let i = 0; i < 4; i++) {
        const o = off[i];
        this.mainsheet[i].set([bb.clone().add(_v.set(o[0], 0, o[1])), car.clone().add(_w.set(o[0], 0.02, o[1]))], mT, g);
      }
      const tailEnd = this.hands.main || car.clone().add(_v.set(0.3, -0.02, 0.3));
      this.mainTail.freeEnd = !this.hands.main; this.mainTail.tailRest = 0.5 + (1 - b.lines.main) * 2.5;
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
    this.vangTail.freeEnd = true; this.vangTail.tailRest = 0.4 + b.ctrl.vang * 1.0;
    this.vangTail.set([vBot, V(C.mastX - 0.35, 0.12, vis.mastBase + 0.03), V(C.mastX - 0.9, 0.2, vis.deckH(C.mastX - 0.9, 0.2) + 0.03)], vt / 4, g);
    // --- cunningham, outhaul, halyards
    const rf = reefAt(b.reefPos);
    const tack = V(C.mastX - 0.06, 0, C.boomZ + 0.22 + (b.reefPos > 0 ? M.luff * (1 - rf.l) : 0));
    const cDeck = V(C.mastX - 0.12, 0.05, vis.mastBase + 0.05);
    const ct = 10 + 600 * b.ctrl.cunn;
    this.cunn[0].set([tack, cDeck], ct, g); this.cunn[1].set([tack.clone().add(_v.set(0.02, 0, 0)), cDeck.clone().add(_w.set(0.02, 0, 0))], ct, g);
    this.cunnTail.freeEnd = true; this.cunnTail.tailRest = 0.3 + b.ctrl.cunn * 0.6;
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
        this.jibSheets[k].freeEnd = !tailHand; this.jibSheets[k].tailRest = active ? 0.5 + (1 - b.lines.jib) * 2.2 : 0.9;
        if (active) this.jibSheets[k].set([clew, carP, wp, w.position.clone().add(_v.set(0, 0.2, 0)), tailEnd], [jl, jl, jl, tailHand ? jl * 0.1 : 2], g);
        else if (b.lines.lazy < 0.6) { const ll = Math.max(20, jl * (b.backedByLazy ? 1 : 0.4)); this.jibSheets[k].set([clew, carP, wp, w.position.clone().add(_v.set(0, 0.2, 0)), tailEnd], [ll, ll, ll, 2], g); }
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
          this.genSheets[k].freeEnd = s === side && !this.hands.jib; this.genSheets[k].tailRest = 0.6 + (1 - b.lines.jib) * 3;
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
    const cs = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1;
    if (this.cabinWinch) this.updateCabinLead(g);
    for (const w of this.winches) {
      const s = w.userData.side, role = s === 0 ? 'cabin' : s === cs ? 'work' : 'lazy';
      const dLine = role === 'work' ? (this.lastLines.jib - b.lines.jib) * (b.genDeploy > 0.5 ? 3.0 : 1.4)   // metres of sheet
        : role === 'lazy' ? (this.lastLines.lazy - b.lines.lazy) * 1.4
        : (b.ctrl[this.cabinLine] - (this.lastCabin ?? b.ctrl[this.cabinLine])) * 0.8;
      // the drum only ever turns one way (the ratchet): hauling turns it, easing lets line surge round it
      if (dLine > 0) w.userData.angle -= dLine / 0.06;
      // the handle: where your hand is when you wind it (either way — the two gears), otherwise geared to the drum
      if (role === this.handleOn) {
        if (this.handleCrank) { w.userData.handleAngle += this.handleCrank; this.handleCrank = 0; }
        else if (dLine > 0 && performance.now() - (this.crankT || 0) > 300) w.userData.handleAngle -= dLine / 0.06 / 3.5;
      }
      w.userData.spin.rotation.y = w.userData.angle;
      w.userData.handle.visible = role === this.handleOn && (role === 'cabin' || !!b.sailBy.jib);
      w.userData.handle.rotation.y = w.userData.handleAngle;
    }
    this.lastLines = { ...b.lines };
    if (this.cabinWinch) this.lastCabin = b.ctrl[this.cabinLine];
    this.applyGlow();
  }

  // the control on the cabin-top winch: from the mast base, along the deck, through its clutch, three turns on the drum, tail
  updateCabinLead(g) {
    const b = this.b, C = b.cls, vis = this.vis, w = this.cabinWinch, k = this.cabinLine;
    const i = this.cabinLines.indexOf(k);
    const cx0 = C.id === 'sportboat' ? C.mastX - 0.75 : C.mastX - 1.0;
    const clutch = V(cx0 + 0.05, 0.12 + i * 0.05, vis.deckH(cx0, 0.18) + 0.035);
    const base = V(C.mastX - 0.12, 0.08, vis.mastBase + 0.06);
    const top = w.position.clone().add(_v.set(0, 0.12, 0));
    const T = 30 + 900 * (b.ctrl[k] || 0);
    this.cabinLead.freeEnd = true; this.cabinLead.tailRest = 0.4 + (b.ctrl[k] || 0) * 0.8;
    this.cabinLead.set([base, clutch, top, top.clone().add(_w.set(0.3, -0.1, 0.25))], [T, T, 3], g);
  }
  cycleCabinLine() {
    if (!this.cabinWinch) return null;
    const L = this.cabinLines; this.cabinLine = L[(L.indexOf(this.cabinLine) + 1) % L.length];
    this._hl = null; return this.cabinLine;
  }
  static lineName(k) { return { jibHalyard: 'jib halyard', cunn: 'cunningham', outhaul: 'outhaul', vang: 'vang' }[k] || k; }

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
      lazyWinch: [this.jibSheets?.[1 - k]].filter(Boolean),
      cwinch: this.cabinWinch ? [this.cabinLead, ...(this.cabinLine === 'jibHalyard' ? [this.halyards[2]] : this.cabinLine === 'cunn' ? [...this.cunn, this.cunnTail] : this.cabinLine === 'vang' ? [...this.vang, this.vangTail] : [this.outhaul])] : [],
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
    for (const x of this._hlObjs || []) x.traverse(o => { if (o.material && o.material.emissive) { o.material.emissiveIntensity = o.userData.e0 ?? 0; if (o.userData.e0c !== undefined) o.material.emissive.setHex(o.userData.e0c); } });
    this._hl = id; this._hlObjs = [];
    this.applyGlow();
    if (!id) return;
    const cs = Math.sign((this.b.genDeploy > 0.5 ? this.b.side.gennaker : this.b.side.jib)) || 1;
    const objs = id === 'trav' ? [this.car] : id === 'jibLead' ? this.jibCars : id === 'winch' ? this.winches.filter(w => w.userData.side === cs)
      : id === 'lazyWinch' ? this.winches.filter(w => w.userData.side === -cs) : id === 'cwinch' ? [this.cabinWinch] : id === 'tiller' ? [this.vis.rudderPivot] : [];
    for (const x of objs.filter(Boolean)) x.traverse(o => { if (o.material && o.material.emissive) { if (o.userData.e0 === undefined) { o.material = o.material.clone(); o.userData.e0 = o.material.emissiveIntensity; } if (o.userData.e0c === undefined) o.userData.e0c = o.material.emissive.getHex(); o.material.emissive.setHex(0xff8a2a); o.material.emissiveIntensity = 0.9; } });
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
      else {
        list.push({ id: 'winch', label: `${name} sheet winch`, hint: 'wind the handle round: clockwise fast gear, anticlockwise slow powerful gear', kind: 'crank', key: 'jib', trim: -1, role: 'work', pos: toW(w.position.clone().add(_v.set(0, 0.2, 0))), info: () => `${Math.round(L.jibLoad || 0)} N` });
        const lw = this.winches.find(w => w.userData.side === -side);
        if (S.jib && b.genDeploy < 0.5 && lw) list.push({ id: 'lazyWinch', label: 'Lazy jib sheet winch', hint: 'grind in to haul the clew across and back the jib; drag the tail down to ease', kind: 'crank', key: 'lazy', trim: -1, role: 'lazy', pos: toW(lw.position.clone().add(_v.set(0, 0.2, 0))), info: () => b.backedByLazy ? 'jib backed' : b.lines.lazy > 0.95 ? 'slack' : `${Math.round((1 - b.lines.lazy) * 100)}% in` });
      }
      const tail = (b.genDeploy > 0.5 ? this.genSheets[(side + 1) / 2] : this.jibSheets[(side + 1) / 2]);
      list.push({ id: 'jibtail', label: `${name} sheet tail`, hint: 'drag down to ease, up to tail in by hand (light loads only); click to let it fly', kind: 'pull', key: 'jib', dir: -1, handTail: true, onClick: 'letFly', pos: toW(tail.pts[tail.maxPts - 6]), info: () => `${Math.round(L.jibLoad || 0)} N` });
      if (S.jib && b.genDeploy < 0.5) {
        const A = toW(V(hw.jibTrack[0], side * hw.jibTrackY, vis.deckH(hw.jibTrack[0], side * hw.jibTrackY))), B = toW(V(hw.jibTrack[1], side * hw.jibTrackY, vis.deckH(hw.jibTrack[1], side * hw.jibTrackY)));
        list.push({ id: 'jibLead', label: 'Jib car', hint: 'slide forward for a deeper foot, aft to open the leech', kind: 'track', key: 'jibLead', A, B, pos: toW(this.jibCars[(side + 1) / 2].position), info: () => `${Math.round(b.ctrl.jibLead * 100)}% aft` });
        list.push({ id: 'jibHalyard', label: 'Jib halyard', hint: 'pull to tension the luff', kind: 'pull', key: 'jibHalyard', dir: 1, pos: toW(this.halyards[2].pts[8]), info: () => `${Math.round(b.ctrl.jibHalyard * 100)}%` });
      }
    }
    if (this.cabinWinch) {
      const cw = this.cabinWinch;
      list.push({ id: 'cwinch', label: `Cabin-top winch — ${Rigging.lineName(this.cabinLine)}`, hint: 'wind the handle round to tension; click to take another line from the clutches', kind: 'crank', key: this.cabinLine, trim: 1, role: 'cabin', onClick: 'cycleCabin', pos: toW(cw.position.clone().add(_v.set(0, 0.16, 0))), info: () => `${Math.round((b.ctrl[this.cabinLine] || 0) * 100)}%` });
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
