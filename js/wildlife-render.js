// Wildlife, drawn (js/wildlife.js is the simulation, js/wildlife-models.js the shapes): one instanced mesh per
// species, the wingbeats, the body's wave and the flukes' stroke in the vertex shader (WL_GLSL), the blows and the
// splashes as the renderer's sea spray (js/splash.js SeaSpray), the calls and blows through the mixer's Wildlife
// channel (js/audio.js), and now and then a sighting called by the crew. Runs once a frame from the renderer's
// hooks (js/render.js), after the boats are posed and before the draw.
//
// Under the water: the sea is drawn opaque, so what swims under it would be hidden. A second, translucent pass of
// the same instances draws the part of each animal that is under the surface where the line of sight meets the
// surface (so it sorts against the boats and the land like the water itself), dimmed and tinted by the water it
// is seen through (the path length in the water, the venue's water clarity) and by the surface's reflection at
// the angle it is seen at: a shark's body under its fin, a turtle below, a dolphin before it breaks the surface.
import * as THREE from 'three';
import { Wildlife, SPECIES, ST, GM, bearingWords } from './wildlife.js';
import { speciesGeometry } from './wildlife-models.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const CLS = { bird: 0, cet: 1, shark: 2, turtle: 3 };
// how far each is drawn (m)
const DRAW = { bird: 1300, cet: 2200, shark: 700, turtle: 350 };
// the water's clarity: an attenuation per metre of sight line (murky estuaries to the clear open ocean)
const KWATER = { solent: 0.45, kiel: 0.4, sfbay: 0.7, newport: 0.35, newyork: 0.6, sydney: 0.2, auckland: 0.22, progreso: 0.28, marseille: 0.11, garda: 0.18, meredith: 0.35, southern: 0.1, open: 0.07 };

export const WL_GLSL = /* glsl */`
attribute vec4 aPart; attribute vec4 aP2; attribute vec4 aAnim; attribute float aSurf;
void wlRotZ(inout vec3 p, inout vec3 n, vec2 c, float a) { float s = sin(a), k = cos(a); vec2 q = p.xy - c; p.xy = c + vec2(k * q.x - s * q.y, s * q.x + k * q.y); n.xy = vec2(k * n.x - s * n.y, s * n.x + k * n.y); }
void wlRotY(inout vec3 p, inout vec3 n, vec2 c, float a) { float s = sin(a), k = cos(a); vec2 q = p.xz - c; p.xz = c + vec2(k * q.x - s * q.y, s * q.x + k * q.y); n.xz = vec2(k * n.x - s * n.z, s * n.x + k * n.z); }
void wlRotX(inout vec3 p, inout vec3 n, vec2 c, float a) { float s = sin(a), k = cos(a); vec2 q = p.yz - c; p.yz = c + vec2(k * q.x - s * q.y, s * q.x + k * q.y); n.yz = vec2(k * n.y - s * n.z, s * n.y + k * n.z); }
// a wing (or a turtle's fore-flipper) on its two joints: the shoulder (hinge along z at aP2.xy) and the wrist
void wlWing(inout vec3 p, inout vec3 n) {
  float side = aPart.z, eta = aPart.y, wr = aPart.w, semi = aP2.z, rest = aP2.w;
  float ph = aAnim.x, amp = aAnim.y, fold = aAnim.z, att = aAnim.w;
#if WL_CLASS == 3
  ph += side > 0.0 ? 0.0 : 3.14159 * aAnim.z;      // alternate strokes when slow, together when fleeing
  fold = 0.0; att = 0.0;
#endif
  vec2 sh = vec2(side * aP2.x, aP2.y);
  // folded: the span drawn in, swept back along the body (sitting on the water, the last of a plunge)
  float k = 1.0 - 0.58 * fold;
  p.x = sh.x + (p.x - sh.x) * k;
  float wx = sh.x + side * wr * semi * k;
  float hand = smoothstep(wr - 0.07, wr + 0.07, eta);
  float s1 = sin(ph), c1 = cos(ph);
#if WL_CLASS == 3
  wlRotX(p, n, vec2(sh.y, 0.0), 0.45 * amp * c1);         // (the flipper's pitch through the stroke)
#endif
  // the hand: flexed back on the upstroke, its beat a little behind the arm's
  wlRotY(p, n, vec2(wx, 0.0), side * hand * (0.35 * amp * max(c1, 0.0)));
  wlRotZ(p, n, vec2(wx, sh.y), side * hand * (amp * 0.35 * sin(ph - 0.8) - att * 0.6));
  // the arm
  wlRotY(p, n, vec2(sh.x, 0.0), side * fold * 1.42);
  wlRotZ(p, n, sh, side * ((rest + amp * s1 + att * 0.7) * (1.0 - fold) - 0.12 * fold));
}
void wlDeform(inout vec3 p, inout vec3 n) {
#if WL_CLASS == 0 || WL_CLASS == 3
  if (aPart.x > 0.5 && aPart.x < 1.5) wlWing(p, n);
#endif
#if WL_CLASS == 3
  if (aPart.x > 1.5 && aPart.x < 2.5) { float sd = aPart.z; wlRotZ(p, n, vec2(sd * aP2.x, aP2.y), sd * 0.3 * aAnim.y * sin(aAnim.x * 0.5 + sd)); }
  if (aPart.x > 2.5) { float L = aP2.z, u = aAnim.w; wlRotX(p, n, vec2(aP2.y, aP2.x), 0.45 * u); p.y += 0.02 * L * u; p.z -= 0.05 * L * u; }
#endif
#if WL_CLASS == 1 || WL_CLASS == 2
  // the body's wave, growing toward the tail: up and down in a whale or a dolphin, side to side in a fish
  float s = aPart.y, L = aP2.x, kw = 6.2832 * aP2.z;
  float env = 0.02 + pow(smoothstep(0.25, 1.05, s), 1.6);
  float ph = aAnim.x - kw * s;
  float d = aAnim.y * aP2.y * L * env * sin(ph), sl = aAnim.y * aP2.y * env * cos(ph) * kw;
#if WL_CLASS == 1
  p.y += d + aAnim.w * 0.045 * L * (1.0 - (2.0 * s - 1.0) * (2.0 * s - 1.0));
  wlRotX(p, n, vec2(p.y, p.z), -atan(sl));
#else
  p.x += d;
  wlRotY(p, n, vec2(p.x, p.z), -atan(sl));
#endif
  p.x += aAnim.z * L * (s - 0.45) * (s - 0.45);
#endif
}
`;

function solidMaterial(cls) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: cls === 'bird' ? 0.85 : cls === 'turtle' ? 0.6 : cls === 'cet' ? 0.55 : 0.6, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = `#define WL_CLASS ${CLS[cls]}\n` + WL_GLSL + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\nvec3 wlP = vec3(position);\nwlDeform(wlP, objectNormal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
      .replace('#include <begin_vertex>', 'vec3 transformed = wlP;');
  };
  m.customProgramCacheKey = () => 'wl' + cls;
  return m;
}
function ghostMaterial(cls, U) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: U,
    defines: { WL_CLASS: CLS[cls] },
    vertexShader: `attribute vec3 color; uniform vec3 uSunCol; uniform vec3 uAmbTop; uniform vec3 uLightDir; uniform float uK; uniform float uOn;
      varying vec3 vCol; varying float vT; varying float vUnder; varying float vPath;
      ${WL_GLSL}
      void main() {
        if (uOn < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 p = position, n = normal; wlDeform(p, n);
        mat4 M = modelMatrix * instanceMatrix;
        vec4 w = M * vec4(p, 1.0);
        vec3 wn = normalize(mat3(M) * n);
        float ys = aSurf, under = ys - w.y;
        vUnder = under;
        vec3 C = cameraPosition, d = w.xyz - C;
        // where the sight line meets the surface
        vec3 q = w.xyz;
        if (C.y > ys && w.y < ys) q = C + d * ((C.y - ys) / (C.y - w.y));
        float path = length(w.xyz - q);
        vPath = path;
        // daylight under the water: from above, dimmer with the depth
        float nd = 0.55 + 0.45 * max(dot(wn, normalize(uLightDir + vec3(0.0, 1.5, 0.0))), 0.0);
        vCol = color * (uAmbTop * 0.8 + uSunCol * 0.6 * max(uLightDir.y, 0.0)) * nd * exp(-max(under, 0.0) * uK * 0.6);
        // what crosses the surface: Fresnel at the angle of view (Schlick, water)
        float mu = abs(d.y) / max(length(d), 1e-3), F = 0.02 + 0.98 * pow(1.0 - mu, 5.0);
        vT = exp(-path * uK) * (1.0 - F);
        // (drawn a little toward the eye of the surface point: the drawn sea's ripples would cut it into stripes)
        gl_Position = projectionMatrix * viewMatrix * vec4(q + normalize(C - q) * min(0.6, 0.05 * length(C - q)), 1.0);
      }`,
    fragmentShader: `uniform vec3 uDeep; uniform vec3 uAmbTop; varying vec3 vCol; varying float vT; varying float vUnder; varying float vPath;
      void main() {
        if (vUnder < 0.03 || vT < 0.012) discard;
        // the colours seen through water: the red goes first, then the green
        vec3 tint = exp(-vPath * vec3(0.45, 0.09, 0.06));
        vec3 col = mix(uDeep * uAmbTop, vCol * tint, 0.85 - 0.5 * (1.0 - exp(-vPath * 0.3)));
        gl_FragColor = vec4(col, clamp(vT * 0.75, 0.0, 0.65) * smoothstep(0.03, 0.25, vUnder));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class WildlifeView {
  constructor(renderer, game) {
    this.R = renderer; this.g = game;
    this.group = new THREE.Group(); this.group.name = 'wildlife';
    renderer.scene.add(this.group);
    this.meshes = {};         // species -> { mesh, ghost, cap, n, M (matrix array), A (anim), S (surf) }
    this.mats = {}; this.gmats = {};
    this.sim = null; this.key = null; this.t = null;
    this.enabled = !/[?&]wildlife=0/.test(typeof location !== 'undefined' ? location.search : '');
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._boats = []; this._wind = { x: 0, z: 0, U: 0 }; this._w = {};
    this._ctx = { fx: 0, fz: 0, boats: this._boats, player: null, ride: null, wind: this._wind, Hs: 0, active: false };
    this._ride = (x, z, psi, L, B, out) => {
      const env = this._env;
      if (!env || !env.wavesOn || !env.waves.ride) { out.h = 0; out.al = 0; out.at = 0; return out; }
      return env.waves.ride(x, z, this._tr, psi, L, B, this.R.seaKeepAt(x, z), out);
    };
    this._ctx.ride = this._ride;
    this.lastCall = -1e9; this.calls = 0; this.ms = 0;
    this._evFn = (e) => this._event(e, this._cam, this._ctx);
    this.lineup = null;
    this.gU = null;
    renderer.hooks = renderer.hooks || [];
    renderer.hooks.push((dt, t, sim) => this.update(dt, t, sim));
  }
  // the share of birds and pod sizes for this device (the ?q=low renderer, or a machine that sails the strip model)
  budget() {
    const g = this.g, L = g._sailLevel;
    return this.R.low ? 0.45 : L && L.start >= 2 ? 0.7 : 1;
  }
  _session() {
    const g = this.g, world = g.world, v = g.venue;
    const key = world && v ? world : null;
    if (key === this.key) return;
    this.key = key;
    for (const k in this.meshes) { const o = this.meshes[k]; this.group.remove(o.mesh); if (o.ghost) this.group.remove(o.ghost); }
    this.meshes = {};
    this.sim = null; this.t = null;
    if (!key || !this.enabled) return;
    this.sim = new Wildlife({ venue: v, world, seed: (g.cond && g.cond.seed) || 0, dateMs: this.R.clockMs || Date.now(), budget: this.budget() });
    this.kWater = KWATER[v.id] ?? 0.25;
    if (this.gU) this.gU.uK.value = this.kWater;
    const caps = {};
    for (const gr of this.sim.groups) caps[gr.sp] = (caps[gr.sp] || 0) + gr.members.length;
    for (const sp in caps) this._mesh(sp, caps[sp]);
  }
  _mesh(sp, cap) {
    if (this.meshes[sp] && this.meshes[sp].cap >= cap) return this.meshes[sp];
    if (this.meshes[sp]) { this.group.remove(this.meshes[sp].mesh); if (this.meshes[sp].ghost) this.group.remove(this.meshes[sp].ghost); }
    const S = SPECIES[sp], cls = S.cls;
    // (a geometry of its own per mesh: the per-instance attributes live on it)
    const geo = speciesGeometry(sp).clone();
    const A = new Float32Array(cap * 4), Sf = new Float32Array(cap);
    const aA = new THREE.InstancedBufferAttribute(A, 4), aS = new THREE.InstancedBufferAttribute(Sf, 1);
    aA.setUsage(THREE.DynamicDrawUsage); aS.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', aA); geo.setAttribute('aSurf', aS);
    const mat = this.mats[cls] || (this.mats[cls] = solidMaterial(cls));
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false;
    this.group.add(mesh);
    let ghost = null;
    if (cls !== 'bird' && !this.R.low) {
      if (!this.gU) {
        const sky = this.R.skySys;
        this.gU = { uSunCol: sky.U.uSunCol, uAmbTop: sky.U.uAmbTop, uLightDir: { value: sky.lightV }, uK: { value: this.kWater ?? 0.25 }, uDeep: this.R.waterU.uDeep, uOn: { value: 1 } };
      }
      ghost = new THREE.InstancedMesh(geo, this.gmats[cls] || (this.gmats[cls] = ghostMaterial(cls, this.gU)), cap);
      ghost.instanceMatrix = mesh.instanceMatrix;
      ghost.frustumCulled = false; ghost.count = 0; ghost.renderOrder = 3;
      // (only in the camera's own view: the sea's mirror (reflect.js) draws the scene from below the surface)
      ghost.onBeforeRender = (r, sc, cam) => { this.gU.uOn.value = cam === this.R.camera ? 1 : 0; };
      this.group.add(ghost);
    }
    const o = { mesh, ghost, cap, n: 0, A, Sf, aA, aS, cls };
    this.meshes[sp] = o;
    return o;
  }

  update(dt, t, simIn) {
    const g = this.g, R = this.R;
    this._session();
    const W = this.sim;
    if (!W) return;
    const env = simIn.env, P = simIn.player;
    this._env = env; this._tr = t;
    // sim time: the drawn instant's steps (pause and time warp as the sea)
    let dts = this.t === null ? 0 : t - this.t;
    if (!(dts >= 0 && dts < 10)) dts = 0;
    this.t = t;
    const cam = R.camera.position;
    const ctx = this._ctx, B = this._boats;
    B.length = 0;
    for (const b of simIn.boats) B.push(b);
    const T = g.traffic;
    if (T && T.movers) for (const v of T.movers) if (!v.hidden) B.push(v);
    ctx.player = P && !g.idle ? P : null;
    ctx.fx = P ? P.x : cam.x; ctx.fz = P ? P.z : cam.z;
    ctx.active = !!(g.running && !g.idle && P);
    const w = env.wind.sample(ctx.fx, ctx.fz, t, this._w);
    this._wind.x = -Math.sin(w.dir) * w.speed; this._wind.z = Math.cos(w.dir) * w.speed; this._wind.U = w.speed;
    ctx.Hs = env.wavesOn ? env.waves.Hs || 0 : 0;
    const t0 = performance.now();
    if (!this.lineup) W.update(dts, t, ctx);
    this._cam = cam;
    W.drain(this._evFn);
    this._draw(cam, t, dts);
    if (ctx.active) this._sightings(W, P, t);
    this.ms += (performance.now() - t0 - this.ms) * 0.05;     // (its cost per frame, ms: smoothed)
  }

  // ---------------------------------------------------------------- the instances
  _draw(cam, t, dt) {
    const M = this.meshes, m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    for (const k in M) M[k].n = 0;
    const list = this.lineup ? this.lineup.animals : this.sim.animals;
    for (const a of list) {
      if (!a.on || !a.vis) continue;
      const sp = a.g ? a.g.sp : a.sp, o = M[sp];
      if (!o || o.n >= o.cap) continue;
      const S = SPECIES[sp];
      const d = Math.hypot(a.x - cam.x, a.z - cam.z);
      if (d > DRAW[S.cls] * (S.L > 6 ? 2 : 1)) continue;
      const i = o.n++;
      e.set(a.pitch, -a.psi, -a.roll); q.setFromEuler(e); p.set(a.x, a.y, a.z); s.setScalar(a.scale);
      m.compose(p, q, s); o.mesh.setMatrixAt(i, m);
      // the animation: birds (phase, amplitude, fold, attitude), cetaceans and sharks (phase, amplitude, bend,
      // arch), turtles (phase, amplitude, alternation, head up)
      const A = o.A, k4 = i * 4;
      if (S.cls === 'bird') { A[k4] = a.ph; A[k4 + 1] = a.amp; A[k4 + 2] = a.a2; A[k4 + 3] = a.a3; }
      else {
        if (S.cls === 'cet') { a.ph += 6.2832 * a.hz * dt; if (a.ph > 1e4) a.ph -= 6283.2; }
        A[k4] = a.ph; A[k4 + 1] = a.amp; A[k4 + 2] = S.cls === 'turtle' ? a.a2 : (a.a2 || 0); A[k4 + 3] = a.a3 || 0;
      }
      o.Sf[i] = a.surf;
    }
    for (const k in M) {
      const o = M[k];
      o.mesh.count = o.n; if (o.ghost) o.ghost.count = o.n;
      if (o.n) { o.mesh.instanceMatrix.needsUpdate = true; o.aA.needsUpdate = true; o.aS.needsUpdate = true; }
    }
  }

  // ---------------------------------------------------------------- blows, splashes, sounds
  _event(e, cam, ctx) {
    const spray = this.R.seaSpray, S = SPECIES[e.sp];
    const d = Math.hypot(e.x - cam.x, e.z - cam.z);
    const R = this.R;
    if (e.type === 'blow') {
      if (e.b > 0 && spray && d < 3500) this._blow(spray, e, R.low ? 0.4 : 1);
      if (S && S.L > 6) this._sound('blow', e, cam, d, Math.min(1.6, S.L / 12));
      else this._sound('puff', e, cam, d, 0.4);
      if (S && S.L > 6) this._heard(e, d);
    } else if (e.type === 'splash' || e.type === 'breach') {
      if (spray && d < 2500) this._splash(spray, e, R.low ? 0.4 : 1);
      this._sound(e.type, e, cam, d, e.type === 'breach' ? 1 : clamp(e.a / 1.5, 0.15, 1));
      if (e.type === 'breach') this._heard(e, d);
      else if (S && S.dive === 'plunge') this._gannets(e, d);
    } else if (e.type === 'call') this._sound(S.call, e, cam, d, 1);
    else if (e.type === 'puff') this._sound('puff', e, cam, d, 0.3);
  }
  // a blow's shape by species: a humpback's bushy column, a right whale's V (two blowholes, wide apart), a
  // Bryde's slim column, a fin whale's tall narrow column; ~3-6 m, drifting and spreading with the wind
  _blow(spray, e, q) {
    // the plume filled from the water to its top: each puff is given the speed that carries it to its own height
    // (the spray's mist slows as exp(-1.5 t): it rises v / 1.5), spreading with its height into the shape
    const kind = e.b, sc = clamp(e.a / 13.5, 0.4, 1.4);
    const H = (kind === 2 ? 5 : kind === 1 ? 4 : kind === 3 ? 6 : 4) * Math.sqrt(sc);
    const fx = Math.sin(e.dir), fz = -Math.cos(e.dir), sx = -fz, sz = fx;
    const n = Math.round(200 * q), r = Math.random;
    for (let i = 0; i < n; i++) {
      const u = Math.pow(r(), 0.7), h = H * (0.12 + 0.88 * u), vy = 1.5 * h;
      let lat, vh, size;
      if (kind === 2) {             // V: two jets, ~25° either side of the vertical, across the body
        lat = (i & 1 ? 1 : -1) * 1.5 * h * 0.47 + (r() - 0.5) * (0.4 + 0.8 * u); vh = (r() - 0.5) * (0.4 + 0.6 * u); size = 0.3 + 0.45 * u;
      } else {                      // a column: bushy (wide, filling out at the top), slim, or tall and narrow
        const w = kind === 1 ? 0.5 + 2.2 * u * u : kind === 3 ? 0.3 + 0.5 * u : 0.3 + 0.8 * u;
        const a = r() * 6.2832, rr = Math.sqrt(r()) * w;
        lat = Math.cos(a) * rr; vh = Math.sin(a) * rr; size = (kind === 1 ? 0.35 + 0.55 * u : 0.25 + 0.4 * u);
      }
      size *= sc;
      spray.emit(e.x, e.y + 0.2, e.z, sx * lat + fx * vh, vy, sz * lat + fz * vh, size, 1, 0.16 + 0.12 * r());
    }
    // a few heavier drops falling out of it
    for (let i = 0; i < 14 * q; i++) spray.emit(e.x, e.y + 0.3, e.z, (r() - 0.5) * 2, 4 + 4 * r(), (r() - 0.5) * 2, 0.03 + 0.03 * r(), 0, 0.7);
  }
  _splash(spray, e, q) {
    const r = Math.random, big = e.type === 'breach', a = e.a;
    const nd = Math.round((big ? 260 : 14 + a * 30) * q), ns = Math.round((big ? 50 : 4 + a * 6) * q), nm = Math.round((big ? 40 : 3 + a * 5) * q);
    const v0 = big ? 8 : clamp(2 + (e.b || 0) * 0.25, 2, 7);
    for (let i = 0; i < nd; i++) {
      const ang = r() * 6.2832, rad = r() * a * 0.5, h = (0.3 + 0.7 * r()) * v0;
      spray.emit(e.x + Math.cos(ang) * rad, e.y + 0.1, e.z + Math.sin(ang) * rad, Math.cos(ang) * (0.5 + 2 * r()) * (big ? 2 : 1), h, Math.sin(ang) * (0.5 + 2 * r()) * (big ? 2 : 1), 0.03 + 0.05 * r() * (big ? 2 : 1), 0, 0.8);
    }
    for (let i = 0; i < ns; i++) {
      const ang = r() * 6.2832;
      spray.emit(e.x + Math.cos(ang) * a * 0.3, e.y + 0.2, e.z + Math.sin(ang) * a * 0.3, Math.cos(ang) * (1 + 2 * r()), (big ? 3 : 1.2) + 2 * r(), Math.sin(ang) * (1 + 2 * r()), a * (big ? 0.25 : 0.4) * (0.6 + 0.6 * r()), 3, 0.5 + 0.3 * r());
    }
    for (let i = 0; i < nm; i++) spray.emit(e.x + (r() - 0.5) * a, e.y + 0.3, e.z + (r() - 0.5) * a, (r() - 0.5), 1 + 2 * r(), (r() - 0.5), a * (big ? 0.35 : 0.5), 1, 0.35);
  }
  _sound(kind, e, cam, d, gain) {
    const au = this.g.audio;
    if (!au || !au.wildlife || !kind) return;
    if (d > (kind === 'blow' || kind === 'breach' ? 2500 : kind === 'splash' ? 400 : kind === 'puff' ? 80 : 300)) return;
    const c = this.R.camera, fwd = c.getWorldDirection(this._fw || (this._fw = new THREE.Vector3()));
    const bx = e.x - cam.x, bz = e.z - cam.z, l = Math.hypot(bx, bz) || 1;
    const pan = clamp((bx * -fwd.z + bz * fwd.x) / l * -1, -1, 1);
    au.wildlife(kind, d, pan, gain, (e.x * 13 + e.z * 7) | 0);
  }

  // ---------------------------------------------------------------- sightings, called by the crew (rarely)
  _say(msg, t) {
    const g = this.g, now = performance.now() / 1000;
    if (now - this.lastCall < 45) return false;
    if (!g.hud || !g.hud.crew) return false;
    if (g.hud.crew(msg, 'crew')) { this.lastCall = now; this.calls++; return true; }
    return false;
  }
  _brg(x, z) { const P = this.g.player; return bearingWords(P.x, P.z, P.psi, x, z); }
  _heard(e, d) {
    const g = this.g, gr = e.g;
    if (!g.player || !g.running || g.idle || !gr || gr.seenGen === gr.gen || d > 2500) return;
    const S = gr.S;
    const by = { humpback: ' — a humpback, by the bushy blow', southernRight: ' — a V-shaped blow: a southern right whale', finWhale: ' — a tall blow: a fin whale', brydes: " — a Bryde's whale" }[gr.sp] || '';
    const msg = e.type === 'breach' ? `Whale breaching ${this._brg(e.x, e.z)}!` : `Thar she blows — ${this._brg(e.x, e.z)}${by}`;
    if (this._say(msg)) gr.seenGen = gr.gen;
  }
  _gannets(e, d) {
    const gr = e.g;
    if (!gr || gr.seenGen === gr.gen || d > 700 || !this.g.player || this.g.idle) return;
    if (this._say(`Gannets diving ${this._brg(e.x, e.z)} — fish there`)) gr.seenGen = gr.gen;
  }
  _sightings(W, P, t) {
    // a few groups a frame (cheap): the nearest member above the water within sight
    const G = W.groups, n = G.length;
    if (!n) return;
    for (let k = 0; k < 3; k++) {
      const gr = G[(this._sc = ((this._sc || 0) + 1) % n)];
      if (!gr.on) continue;
      const S = gr.S;
      if (gr.seenGen === gr.gen && !(S.cls === 'cet' && (gr.mode === GM.BOW || gr.bowCalled))) continue;
      let best = null, bd = 1e9;
      for (const a of gr.members) {
        if (!a.on || !a.vis) continue;
        const d = Math.hypot(a.x - P.x, a.z - P.z);
        if (d < bd) { bd = d; best = a; }
      }
      if (!best) continue;
      const above = best.y > best.surf - (S.cls === 'shark' ? 0.6 : 0.3);
      let msg = null;
      if (S.cls === 'cet' && gr.mode === GM.BOW && bd < 30) { if (!gr.bowCalled && this._say('Dolphins on the bow!')) gr.bowCalled = true; continue; }
      if (S.cls === 'cet' && gr.mode !== GM.BOW) gr.bowCalled = false;
      if (gr.seenGen === gr.gen) continue;
      if (S.cls === 'cet' && S.L < 4 && above && bd < 220) msg = S.morph === 'porpoise' ? `Porpoise ${this._brg(best.x, best.z)}` : `Dolphins ${this._brg(best.x, best.z)}!`;
      else if (S.cls === 'turtle' && above && bd < 70) msg = S.morph === 'leatherback' ? `A leatherback turtle ${this._brg(best.x, best.z)}!` : `Turtle ${this._brg(best.x, best.z)}`;
      else if (S.cls === 'shark' && best.st === ST.CRUISE && above && bd < 160)
        msg = gr.sp === 'baskingShark' ? `Basking shark ${this._brg(best.x, best.z)} — feeding, mouth open` : gr.sp === 'whaleShark' ? `Whale shark ${this._brg(best.x, best.z)}!` : `Shark fin ${this._brg(best.x, best.z)}`;
      else if (S.morph === 'albatross' && bd < 250) msg = `Albatross ${this._brg(best.x, best.z)}`;
      if (msg && this._say(msg)) gr.seenGen = gr.gen;
    }
  }

  // ---------------------------------------------------------------- debugging
  // a group of a species of this venue brought to (dx, dz) metres from the player (or the camera): its next generation
  debugSpawn(sp, dx = 0, dz = -100) {
    const W = this.sim, P = this.g.player, c = this.R.camera.position;
    if (!W) return false;
    const g = W.groups.find((x) => x.sp === sp && !x.on) || W.groups.find((x) => x.sp === sp);
    if (!g) return false;
    if (g.on) W._off(g);
    g.gen++; W._spawn(g, (P ? P.x : c.x) + dx, (P ? P.z : c.z) + dz, this._ctx);
    return true;
  }
  // species posed in a row before the camera
  // ids: species; o: { dist, gap, state ('fly' | 'glide' | 'sit' | 'surface' | 'fluke' | 'blow' | 'breach' ...), y, phase }
  debugLineup(ids, o = {}) {
    if (!ids) { this.lineup = null; return; }
    const R = this.R, cam = R.camera, fwd = cam.getWorldDirection(new THREE.Vector3()); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const animals = [];
    const n = ids.length, gap = o.gap ?? 3, dist = o.dist ?? 12;
    ids.forEach((id, i) => {
      const S = SPECIES[id];
      this._mesh(id, 4);
      const off = (i - (n - 1) / 2) * gap;
      const x = cam.position.x + fwd.x * dist + right.x * off, z = cam.position.z + fwd.z * dist + right.z * off;
      const a = { sp: id, g: null, on: true, vis: true, x, y: 0, z, psi: Math.atan2(right.x, -right.z) + (o.yaw ?? 0), pitch: o.pitch ?? 0, roll: o.roll ?? 0, scale: 1,
        ph: o.phase ?? 0.3, amp: 0, a2: 0, a3: 0, hz: 0, surf: 0, st: 0 };
      const st = o.state || 'fly';
      if (S.cls === 'bird') { a.y = o.y ?? 1.6; a.amp = st === 'glide' ? 0 : S.amp; a.a2 = st === 'sit' ? 1 : st === 'dive' ? 0.85 : 0; if (st === 'sit') a.y = 0.05; if (st === 'dive') a.pitch = -1.2; }
      else if (S.cls === 'cet') { a.amp = 0.8; a.y = o.y ?? 0.2; a.a3 = st === 'arch' ? 1 : 0; if (st === 'fluke') { a.pitch = -1.2; a.y = -S.L * 0.25; } }
      else if (S.cls === 'turtle') { a.amp = 0.6; a.a2 = 1; a.a3 = st === 'breathe' ? 1 : 0; a.y = o.y ?? 0.05; }
      else { a.amp = 0.9; a.y = o.y ?? 0.0; }
      a.ph = o.phase ?? 1.0;
      animals.push(a);
    });
    this.lineup = { animals };
    return animals;
  }
}
