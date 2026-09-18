// Three.js renderer: sky, Gerstner ocean (same spectrum as the physics), real-map terrain, piers,
// lofted hulls, live sails (twist, camber, draft, luffing), telltales, crew, wakes, marks, cameras.
import * as THREE from 'three';
import { DEG } from './env.js';
import { STRIP_F, REEF, clamp, lerp } from './physics.js';

const MAXW = 14;
const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 zenith = vec3(0.16, 0.36, 0.66);
  vec3 horizon = vec3(0.70, 0.80, 0.88);
  vec3 c = mix(horizon, zenith, pow(h, 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 8.0) * 0.25 + pow(s, 64.0) * 0.5);
  if (d.y < 0.0) c = mix(horizon, vec3(0.35, 0.45, 0.5), clamp(-d.y * 4.0, 0.0, 1.0));
  return c;
}`;

const WAVE_GLSL = /* glsl */`
uniform vec4 uWa[${MAXW}]; // dx, dz, k, omega
uniform vec4 uWb[${MAXW}]; // A, Q, phase, 0
uniform int uWn;
uniform float uTime;
`;

export class Renderer {
  constructor(canvas) {
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 30000);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - 38) * DEG, 200 * DEG).normalize();
    this.scene.fog = new THREE.FogExp2(0xb7c8d4, 0.00011);
    const hemi = new THREE.HemisphereLight(0xcfe3f5, 0x3a5566, 0.9);
    this.scene.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    this.scene.add(sun); this.scene.add(sun.target);
    this.cam = { mode: 'chase', yaw: 200 * DEG, pitch: 14 * DEG, dist: 22, tx: 0, tz: 0, ty: 2 };
    this.boats = new Map();
    this.markMeshes = [];
    this.forceArrows = null;
    this.showForces = false;
    this._buildSky();
    this._buildWater();
    this.wakes = new Map();
  }

  resize(w, h) {
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- sky
  _buildSky() {
    const g = new THREE.SphereGeometry(20000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSunDir: { value: this.sunDir } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `varying vec3 vDir; ${SKY_GLSL}
        void main(){ vec3 d = normalize(vDir); vec3 c = skyColor(d);
          float s = max(dot(d, uSunDir), 0.0); c += vec3(1.0,0.95,0.85) * smoothstep(0.9993, 0.9997, s) * 4.0;
          // a few soft cumulus bands
          float cl = sin(d.x*9.0+sin(d.z*7.0)*1.5)*sin(d.z*11.0+d.x*3.0);
          c = mix(c, vec3(0.95), smoothstep(0.55, 0.95, cl) * smoothstep(0.02, 0.12, d.y) * (1.0 - smoothstep(0.25, 0.5, d.y)) * 0.55);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.sky = new THREE.Mesh(g, m);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // ---------------------------------------------------------------- water
  _buildWater() {
    const N = 360, R = 6500, a = 0.035;
    const pos = new Float32Array((N + 1) * (N + 1) * 3);
    const map = (u) => R * Math.sign(u) * (a * Math.abs(u) + (1 - a) * Math.abs(u) ** 3);
    let p = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      pos[p++] = map(i / N * 2 - 1); pos[p++] = 0; pos[p++] = map(j / N * 2 - 1);
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i;
      idx.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const Wa = [], Wb = [];
    for (let i = 0; i < MAXW; i++) { Wa.push(new THREE.Vector4()); Wb.push(new THREE.Vector4()); }
    this.gustTex = new THREE.DataTexture(new Uint8Array(128 * 128 * 4).fill(128), 128, 128, THREE.RGBAFormat);
    this.gustTex.magFilter = THREE.LinearFilter; this.gustTex.minFilter = THREE.LinearFilter; this.gustTex.needsUpdate = true;
    this.sdfTex = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, THREE.RGBAFormat);
    this.sdfTex.needsUpdate = true;
    const uniforms = {
      uWa: { value: Wa }, uWb: { value: Wb }, uWn: { value: 0 }, uTime: { value: 0 },
      uSunDir: { value: this.sunDir }, uCam: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector2() },
      uGust: { value: this.gustTex }, uGustO: { value: new THREE.Vector2() }, uGustS: { value: 2048 },
      uSdf: { value: this.sdfTex }, uWorldR: { value: 6000 }, uHasMap: { value: 0 },
      uFlow: { value: new THREE.Vector2(0, 1) }, uWind: { value: 6 }, uFoamK: { value: 0 },
      uDeep: { value: new THREE.Color(0x0a2f40) }, uShallow: { value: new THREE.Color(0x2e9c9a) },
      fogColor: { value: new THREE.Color(0xb7c8d4) }, fogDensity: { value: 0.00011 },
    };
    this.waterU = uniforms;
    const m = new THREE.ShaderMaterial({
      uniforms, fog: false,
      vertexShader: /* glsl */`
        ${WAVE_GLSL}
        uniform vec2 uOffset; uniform vec3 uCam; uniform sampler2D uSdf; uniform float uWorldR; uniform float uHasMap;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore;
        void main(){
          vec2 x0 = position.xz + uOffset;
          float dist = length(x0 - uCam.xz);
          float fade = 1.0 - smoothstep(700.0, 3200.0, dist);
          float shore = 1.0;
          if (uHasMap > 0.5) {
            vec2 uv = (x0 + uWorldR) / (2.0 * uWorldR);
            float s = (texture2D(uSdf, uv).r * 255.0 - 128.0);
            shore = clamp(s / 60.0, 0.08, 1.0);
          }
          vec3 P = vec3(x0.x, 0.0, x0.y);
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            float th = a.z * dot(a.xy, x0) - a.w * uTime + b.z;
            float A = b.x * fade * shore;
            P.x += b.y * A * a.x * cos(th); P.z += b.y * A * a.y * cos(th); P.y += A * sin(th);
          }
          vPos = P; vX0 = x0; vFade = fade; vShore = shore;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${WAVE_GLSL}
        ${SKY_GLSL}
        uniform vec3 uCam; uniform sampler2D uGust; uniform vec2 uGustO; uniform float uGustS;
        uniform sampler2D uSdf; uniform float uWorldR; uniform float uHasMap;
        uniform vec2 uFlow; uniform float uWind; uniform float uFoamK;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 x0 = vX0;
          float dist = length(vPos - uCam);
          // analytic Gerstner normal + Jacobian (crest sharpness) for whitecaps
          vec3 n = vec3(0.0, 1.0, 0.0); float J = 1.0;
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            float th = a.z * dot(a.xy, x0) - a.w * uTime + b.z;
            float WA = a.z * b.x * vFade * vShore;
            n.x -= a.x * WA * cos(th); n.z -= a.y * WA * cos(th); n.y -= b.y * WA * sin(th);
            J -= b.y * WA * sin(th);
          }
          // local wind (puffs + land shelter) drives capillary ripples: puffs read as dark patches
          vec2 guv = (x0 - uGustO) / uGustS + 0.5;
          float gw = texture2D(uGust, guv).r * 2.0;
          float lw = uWind * gw;
          float rip = clamp((lw - 1.0) / 7.0, 0.0, 1.4);
          float mip = 1.0 - smoothstep(15.0, 260.0, dist);
          vec2 fl = uFlow, pr = vec2(-fl.y, fl.x);
          vec2 rn = vec2(0.0);
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float ang = (hash(vec2(fk, 3.1)) - 0.5) * 1.3;
            vec2 d = normalize(fl * cos(ang) + pr * sin(ang));
            float wl = 0.45 + fk * 0.55;
            float kk = 6.2832 / wl, om = sqrt(9.81 * kk + 0.074 * kk * kk * kk / 1025.0);
            float ph = kk * dot(d, x0) - om * uTime + hash(vec2(fk, 7.7)) * 6.28;
            rn += d * cos(ph) * (0.085 / (1.0 + fk * 0.35));
          }
          n.xz += rn * rip * mip;
          n = normalize(n);
          vec3 V = normalize(uCam - vPos);
          float cosT = max(dot(n, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
          vec3 R = reflect(-V, n); R.y = abs(R.y);
          vec3 refl = skyColor(R);
          float shin = mix(900.0, 120.0, clamp(rip, 0.0, 1.0));
          float spec = pow(max(dot(R, uSunDir), 0.0), shin) * (shin * 0.025 + 1.0);
          // water body colour: shallow sand shows through on real bathymetry
          float depth = 30.0;
          float sd = 999.0;
          if (uHasMap > 0.5) {
            vec4 s = texture2D(uSdf, (x0 + uWorldR) / (2.0 * uWorldR));
            sd = s.r * 255.0 - 128.0; depth = s.g * 255.0 / 8.0;
          }
          vec3 body = mix(uShallow, uDeep, smoothstep(0.5, 9.0, depth));
          body *= 0.85 + 0.3 * clamp(vPos.y * 1.5 + 0.3, 0.0, 1.0);          // light through crests
          body *= 1.0 - 0.18 * clamp(gw - 1.0, 0.0, 1.0);                      // puffs look darker
          vec3 col = mix(body, refl, F) + vec3(1.0, 0.92, 0.8) * spec * 0.9;
          // whitecaps where the trochoid crest folds (only in real breeze)
          float fn = vnoise(x0 * 0.35 + uTime * 0.2) * vnoise(x0 * 1.3 - uTime * 0.3);
          float cap = smoothstep(0.62, 0.35, J) * uFoamK * smoothstep(0.15, 0.5, fn) * vFade;
          col = mix(col, vec3(0.93, 0.96, 0.98), clamp(cap, 0.0, 0.9));
          // shoreline surf
          if (uHasMap > 0.5) {
            float band = smoothstep(9.0, 0.0, sd) * (0.55 + 0.45 * sin(sd * 1.2 - uTime * 1.6 + vnoise(x0 * 0.1) * 6.0));
            col = mix(col, vec3(0.92, 0.95, 0.96), clamp(band * 0.8, 0.0, 0.85));
          }
          float fogF = 1.0 - exp(-pow(fogDensity * dist, 2.0));
          col = mix(col, skyColor(normalize(vec3(-V.x, 0.02, -V.z))), clamp(fogF, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(g, m);
    this.water.frustumCulled = false;
    this.scene.add(this.water);
  }

  setWaves(waves) {
    const U = this.waterU;
    const n = Math.min(MAXW, waves.comps.length);
    for (let i = 0; i < MAXW; i++) {
      const c = waves.comps[i];
      if (i < n) { U.uWa.value[i].set(c.dx, c.dz, c.k, c.omega); U.uWb.value[i].set(c.A, c.Q, c.phase, 0); }
      else { U.uWa.value[i].set(0, 0, 0, 0); U.uWb.value[i].set(0, 0, 0, 0); }
    }
    U.uWn.value = n;
  }
  setWavesEnabled(on, waves) {
    if (on) this.setWaves(waves); else this.waterU.uWn.value = 0;
  }

  // ---------------------------------------------------------------- terrain & piers from the real map
  setWorld(world, geo) {
    if (this.land) { this.scene.remove(this.land); this.land.geometry.dispose(); }
    if (this.town) { this.scene.remove(this.town); }
    if (this.piersMesh) { this.scene.remove(this.piersMesh); }
    this.world = world;
    const U = this.waterU;
    U.uHasMap.value = world.open ? 0 : 1;
    U.uWorldR.value = world.R;
    const S = 512;
    this.sdfTex.dispose();
    this.sdfTex = new THREE.DataTexture(world.sdfTextureData(S), S, S, THREE.RGBAFormat);
    this.sdfTex.magFilter = THREE.LinearFilter; this.sdfTex.minFilter = THREE.LinearFilter; this.sdfTex.needsUpdate = true;
    U.uSdf.value = this.sdfTex;
    if (world.open) return;
    // heightfield
    const M = 300, R = world.R, c = 2 * R / M;
    const pos = new Float32Array((M + 1) * (M + 1) * 3), col = new Float32Array((M + 1) * (M + 1) * 3);
    const sand = new THREE.Color(0xd9c9a0), grass = new THREE.Color(0x6d8a4a), scrub = new THREE.Color(0x8a8a5c), rock = new THREE.Color(0x8c877d), wet = new THREE.Color(0x6b6250);
    const tmp = new THREE.Color();
    let p = 0;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      const x = -R + i * c, z = -R + j * c;
      const s = world.sdfAt(x, z);
      let h;
      if (s > 0) h = -Math.min(world.depthAt(x, z), 6) - 0.3; else h = world.landHeight(x, z);
      pos[p] = x; pos[p + 1] = h; pos[p + 2] = z;
      if (h < 0.3) tmp.copy(wet);
      else if (h < 2.5 || -s < 25) tmp.copy(sand);
      else if (h > 120) tmp.copy(rock);
      else tmp.copy(grass).lerp(scrub, clamp((h - 20) / 80, 0, 1) * 0.7 + 0.15 * Math.sin(x * 0.01 + z * 0.013));
      col[p] = tmp.r; col[p + 1] = tmp.g; col[p + 2] = tmp.b;
      p += 3;
    }
    const idx = [];
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const k = j * (M + 1) + i;
      idx.push(k, k + M + 1, k + 1, k + 1, k + M + 1, k + M + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.land = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.land.receiveShadow = true;
    this.scene.add(this.land);
    // settlements along the shore (instanced houses where the land is low and near the water)
    const houses = [];
    for (let k = 0; k < 9000 && houses.length < 2600; k++) {
      const x = (Math.random() * 2 - 1) * R * 0.95, z = (Math.random() * 2 - 1) * R * 0.95;
      const s = world.sdfAt(x, z);
      if (s > -30 || s < -1400) continue;
      const h = world.landHeight(x, z);
      if (h > 70) continue;
      const dens = 0.5 + 0.5 * Math.sin(x * 0.004) * Math.cos(z * 0.0037);
      if (Math.random() > dens * 0.9) continue;
      houses.push([x, h, z]);
    }
    const hg = new THREE.BoxGeometry(1, 1, 1); hg.translate(0, 0.5, 0);
    const town = new THREE.InstancedMesh(hg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), houses.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const hc = [0xefe8da, 0xe3d6bf, 0xf4f1ea, 0xd8c3a5, 0xcfd6d9, 0xe8c9a8];
    houses.forEach((hh, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      sc.set(8 + Math.random() * 14, 5 + Math.random() * (Math.random() < 0.1 ? 25 : 6), 8 + Math.random() * 12);
      ps.set(hh[0], hh[1] - 0.5, hh[2]);
      mtx.compose(ps, q, sc); town.setMatrixAt(i, mtx);
      town.setColorAt(i, tmp.setHex(hc[i % hc.length]));
    });
    this.town = town; this.scene.add(town);
    // piers / breakwaters: merged into two meshes (deck/rock and wooden piles)
    const pierGroup = new THREE.Group();
    const stone = [], timber = [];
    const addBox = (list, w, h, l, x, y, z, ry) => {
      const bg = new THREE.BoxGeometry(w, h, l); bg.rotateY(ry); bg.translate(x, y, z); list.push(bg);
    };
    for (const pr of (geo && geo.piers) || []) {
      const pts = pr.pts, isPier = pr.kind === 'pier';
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        const ry = Math.atan2(bx - ax, bz - az);
        addBox(isPier ? timber : stone, pr.w, isPier ? 1.2 : 2.5, L + pr.w * 0.5, (ax + bx) / 2, isPier ? 2.6 : 0.9, (az + bz) / 2, ry);
        if (isPier) for (let t = 0; t < L; t += 9) { const u = t / L; addBox(timber, 0.45, 4, 0.45, ax + (bx - ax) * u, 0.4, az + (bz - az) * u, ry); }
      }
    }
    if (stone.length) pierGroup.add(new THREE.Mesh(mergeGeometries(stone), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 })));
    if (timber.length) pierGroup.add(new THREE.Mesh(mergeGeometries(timber), new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 0.9 })));
    this.piersMesh = pierGroup; this.scene.add(pierGroup);
  }

  // ---------------------------------------------------------------- gust texture (CPU-baked wind field)
  updateGust(env, world, t, cx, cz) {
    const S = 128, size = 2048;
    const ox = Math.round(cx / 16) * 16, oz = Math.round(cz / 16) * 16;
    const data = this.gustTex.image.data;
    const tmp = {};
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = ox + (i + 0.5) / S * size - size / 2, z = oz + (j + 0.5) / S * size - size / 2;
      env.wind.sample(x, z, t, tmp);
      const f = tmp.speed / env.wind.tws;
      const k = (j * S + i) * 4;
      data[k] = clamp(Math.round(f * 128), 0, 255);
    }
    this.gustTex.needsUpdate = true;
    this.waterU.uGustO.value.set(ox, oz);
    this.waterU.uGustS.value = size;
    const fl = env.wind.flowDir();
    this.waterU.uFlow.value.set(fl[0], fl[1]);
    this.waterU.uWind.value = env.wind.tws;
    this.waterU.uFoamK.value = clamp((env.wind.tws - 5.5) / 5, 0, 1);
  }

  // ---------------------------------------------------------------- boats
  addBoat(boat, opts = {}) {
    const vis = buildBoat(boat, opts);
    this.scene.add(vis.root);
    this.boats.set(boat, vis);
    const wake = new Wake(); this.scene.add(wake.mesh); this.wakes.set(boat, wake);
    return vis;
  }
  removeAllBoats() {
    for (const [b, v] of this.boats) { this.scene.remove(v.root); }
    for (const [b, w] of this.wakes) { this.scene.remove(w.mesh); }
    this.boats.clear(); this.wakes.clear();
  }

  // ---------------------------------------------------------------- marks
  setMarks(marks, committee) {
    for (const m of this.markMeshes) this.scene.remove(m);
    this.markMeshes = [];
    for (const mk of marks) {
      const g = new THREE.Group();
      let body;
      if (mk.kind === 'pin') {
        body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 }));
        body.position.y = 0.2;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        pole.position.y = 1.4; g.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x1a4fd0, side: THREE.DoubleSide }));
        flag.position.set(0, 2.4, 0.3); g.add(flag); g.userData.flag = flag;
      } else {
        body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 1.9, 20), new THREE.MeshStandardMaterial({ color: mk.color ?? 0xff7a1a, roughness: 0.55 }));
        body.position.y = 0.6;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0xffffff }));
        band.position.y = 1.2; g.add(band);
      }
      body.castShadow = true;
      g.add(body);
      g.userData.mark = mk;
      this.scene.add(g); this.markMeshes.push(g);
    }
    if (committee) {
      const cb = buildMotorBoat();
      cb.userData.mark = committee;
      this.scene.add(cb); this.markMeshes.push(cb);
    }
  }

  // ---------------------------------------------------------------- per-frame update
  update(dt, t, sim) {
    const { env, boats, player } = sim;
    // camera
    this._updateCamera(dt, player, env, t);
    const cam = this.camera.position;
    this.waterU.uCam.value.copy(cam);
    const snap = 4;
    this.waterU.uOffset.value.set(Math.round(cam.x / snap) * snap, Math.round(cam.z / snap) * snap);
    this.waterU.uTime.value = t;
    this.sky.position.copy(cam);
    // sun shadow follows the player
    if (player) {
      this.sun.position.set(player.x + this.sunDir.x * 60, this.sunDir.y * 60, player.z + this.sunDir.z * 60);
      this.sun.target.position.set(player.x, 0, player.z);
    }
    for (const [b, vis] of this.boats) {
      updateBoat(vis, b, env, t, this.camera);
      this.wakes.get(b).update(b, env, t, dt);
    }
    const tmp = {};
    for (const g of this.markMeshes) {
      const mk = g.userData.mark;
      const h = env.wavesOn ? env.waves.sample(mk.x, mk.z, t, tmp) : { h: 0, sx: 0, sz: 0 };
      g.position.set(mk.x, h.h, mk.z);
      g.rotation.set(Math.atan(h.sz) * 0.6, mk.heading ?? 0, -Math.atan(h.sx) * 0.6, 'YXZ');
      if (g.userData.flags) {
        const w = env.wind.sample(mk.x, mk.z, t, {});
        for (const f of g.userData.flags) f.rotation.y = Math.PI - w.dir - (mk.heading ?? 0) + Math.sin(t * 6 + f.userData.fid) * 0.1;
      }
    }
    if (this.showForces && player) this._updateForces(player);
    else if (this.forceArrows) this.forceArrows.visible = false;
    this.r.render(this.scene, this.camera);
  }

  _updateCamera(dt, b, env, t) {
    const c = this.cam, cam = this.camera;
    if (!b) return;
    const k = 1 - Math.exp(-dt * 6);
    c.tx = lerp(c.tx, b.x, k); c.tz = lerp(c.tz, b.z, k);
    const bh = b.heave || 0;
    if (c.mode === 'chase' || c.mode === 'orbit') {
      if (c.mode === 'orbit') c.yaw += dt * 0.08;
      const yaw = c.yaw + (c.mode === 'chase' ? b.psi : 0);
      const d = c.dist;
      cam.position.set(c.tx - Math.sin(yaw) * Math.cos(c.pitch) * d, Math.max(1.2, bh + 2 + Math.sin(c.pitch) * d), c.tz + Math.cos(yaw) * Math.cos(c.pitch) * d);
      cam.up.set(0, 1, 0);
      cam.lookAt(c.tx, bh + 2.2, c.tz);
    } else if (c.mode === 'helm' || c.mode === 'bow' || c.mode === 'mast') {
      const vis = this.boats.get(b);
      const C = b.cls;
      const local = c.mode === 'helm' ? new THREE.Vector3(b.crewY * 0.8 - Math.sign(b.crewY || 1) * 0.1, C.freeboard + 1.0, -(C.sternX + 0.9))
        : c.mode === 'bow' ? new THREE.Vector3(0, C.freeboard + 0.7, -(C.bowX - 0.3))
        : new THREE.Vector3(0.3, C.mastHeight + 0.4, -C.mastX + 0.5);
      vis.inner.updateMatrixWorld();
      const wp = local.applyMatrix4(vis.inner.matrixWorld);
      cam.position.copy(wp);
      const look = new THREE.Vector3(Math.sin(c.yaw - Math.PI) * Math.cos(c.pitch - 0.2) * 20, c.mode === 'mast' ? -8 : Math.sin(c.pitch - 0.25) * 20, -Math.cos(c.yaw - Math.PI) * Math.cos(c.pitch - 0.2) * 20);
      const target = look.applyMatrix4(vis.inner.matrixWorld);
      cam.up.set(0, 1, 0).applyQuaternion(vis.inner.getWorldQuaternion(new THREE.Quaternion()));
      cam.lookAt(target);
    } else if (c.mode === 'top') {
      const fl = env.wind.flowDir();
      cam.position.set(c.tx - fl[0] * 0.01, 40 + c.dist * 3.5, c.tz - fl[1] * 0.01 + 0.01);
      cam.up.set(-fl[0], 0, -fl[1]); // wind comes from the top of the screen
      cam.lookAt(c.tx, 0, c.tz);
    }
  }

  _updateForces(b) {
    if (!this.forceArrows) {
      this.forceArrows = new THREE.Group();
      const mk = (col) => { const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, col, 0.6, 0.35); this.forceArrows.add(a); return a; };
      this.fa = { sail: mk(0xffd23f), keel: mk(0x3fa9ff), rudder: mk(0x9b5de5), aw: mk(0xffffff), tw: mk(0x2ec4b6), drive: mk(0x5ee36a) };
      this.scene.add(this.forceArrows);
    }
    this.forceArrows.visible = true;
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const d = b.diag, C = b.cls;
    const at = (xb, h) => new THREE.Vector3(b.x + fx * xb, h, b.z + fz * xb);
    const set = (a, org, vx, vz, vy, scale) => {
      const v = new THREE.Vector3(vx, vy || 0, vz); const L = v.length() * scale;
      if (L < 0.05) { a.visible = false; return; } a.visible = true;
      a.position.copy(org); a.setDirection(v.normalize()); a.setLength(L, Math.min(1.2, L * 0.25), Math.min(0.6, L * 0.12));
    };
    const s = 1 / 150;
    set(this.fa.sail, at(C.mastX - 0.6, C.boomZ + 3), fx * d.sailX + sx * d.sailY, fz * d.sailX + sz * d.sailY, 0, s);
    set(this.fa.drive, at(C.mastX - 0.6, C.boomZ + 3), fx * d.sailX, fz * d.sailX, 0, s);
    set(this.fa.keel, at(C.keel.x, -0.2), fx * d.keelX + sx * d.keelY, fz * d.keelX + sz * d.keelY, 0, s);
    set(this.fa.rudder, at(C.rudder.x, -0.1), sx * d.rudderY, sz * d.rudderY, 0, s * 3);
    const awx = -Math.sin(b.psi + d.awa), awz = Math.cos(b.psi + d.awa);
    set(this.fa.aw, at(C.mastX + 3, C.mastHeight), -awx * d.aws, -awz * d.aws, 0, 0.4);
    set(this.fa.tw, at(C.mastX + 3, C.mastHeight + 1), Math.sin(d.twd) * d.tws, -Math.cos(d.twd) * d.tws, 0, 0.4);
  }
}

function mergeGeometries(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}

// =============================================================================== hull lofting
function hullGeometry(C) {
  const H = C.hull, B = C.beam / 2, F = C.freeboard, D = C.canoeDraft;
  const NS = 36, NP = 14;
  const L0 = C.sternX, L1 = C.bowX;
  const pos = [], col = [];
  const cHull = new THREE.Color(H.color), cBoot = new THREE.Color(H.boot), cStripe = new THREE.Color(H.stripe), cBottom = new THREE.Color(0x3b3f45);
  const stations = [];
  for (let s = 0; s <= NS; s++) {
    const t = s / NS; // 0 stern .. 1 bow
    const x = lerp(L0, L1, t);
    const shape = t < 0.42 ? lerp(H.transom, 1, Math.sin(t / 0.42 * Math.PI / 2)) : Math.pow(Math.max(0, Math.cos(Math.min(1, (t - 0.42) / 0.58) * Math.PI / 2)), 0.75);
    const b = B * Math.max(shape, 0.0);
    const dd = D * (t < 0.12 ? lerp(0.45, 1, t / 0.12) : t > 0.75 ? lerp(1, 0.08, (t - 0.75) / 0.25) : 1);
    const sheer = F * (1 + H.sheer * (Math.pow(Math.abs(t - 0.45) / 0.55, 2)) + 0.12 * Math.max(0, t - 0.8) / 0.2);
    const pts = [];
    for (let k = 0; k <= NP; k++) {
      // half-section from sheer (k=0) around to keel line (k=NP)
      let y, z;
      const topK = 4;
      if (k <= topK) { const u = k / topK; y = lerp(b * 0.96, b, Math.sin(u * Math.PI / 2)); z = lerp(sheer, 0, u); }
      else {
        const th = (k - topK) / (NP - topK) * Math.PI / 2;
        const e = 2 / H.sectionN;
        y = b * Math.pow(Math.max(0, Math.cos(th)), e); z = -dd * Math.pow(Math.max(0, Math.sin(th)), e);
      }
      const rake = H.bowRake * Math.max(0, z + D) / (F + D) * Math.pow(t, 10);
      pts.push([x + rake, y, z]);
    }
    stations.push(pts);
  }
  const colorFor = (z, sheer) => {
    if (z < -0.02) return cBottom.clone().lerp(cBoot, 0.4);
    if (z < 0.1) return cBoot;
    if (z > sheer - 0.09 && z < sheer - 0.03) return cStripe;
    return cHull;
  };
  const idx = [];
  const vid = (s, k, side) => (s * (NP + 1) + k) * 2 + side;
  for (let s = 0; s <= NS; s++) for (let k = 0; k <= NP; k++) for (let side = 0; side < 2; side++) {
    const [x, y, z] = stations[s][k];
    pos.push(side ? -y : y, z, -x);
    const c = colorFor(z, stations[s][0][2]); col.push(c.r, c.g, c.b);
  }
  for (let s = 0; s < NS; s++) for (let k = 0; k < NP; k++) {
    for (let side = 0; side < 2; side++) {
      const a = vid(s, k, side), b2 = vid(s + 1, k, side), c2 = vid(s + 1, k + 1, side), d2 = vid(s, k + 1, side);
      if (side === 0) idx.push(a, d2, b2, b2, d2, c2); else idx.push(a, b2, d2, b2, c2, d2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // deck + transom
  const dpos = [], didx = [];
  for (let s = 0; s <= NS; s++) {
    const [x, y, z] = stations[s][0];
    dpos.push(y, z, -x, -y, z, -x);
    if (s < NS) { const a = s * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3)); dg.setIndex(didx); dg.computeVertexNormals();
  const tpos = [], tidx = [];
  const st = stations[0];
  for (let k = 0; k <= NP; k++) { const [x, y, z] = st[k]; tpos.push(y, z, -x, -y, z, -x); if (k < NP) { const a = k * 2; tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3)); tg.setIndex(tidx); tg.computeVertexNormals();
  return { hull: g, deck: dg, transom: tg, sheerAt: (x) => { const t = clamp((x - L0) / (L1 - L0), 0, 1); return stations[Math.round(t * NS)][0]; } };
}

function foilGeometry(chord, span, thick = 0.1, taper = 0.7) {
  // NACA-00xx section extruded downward, tapering
  const shape = new THREE.Shape();
  const n = 16, pts = [];
  for (let i = 0; i <= n; i++) {
    const x = 1 - Math.cos(i / n * Math.PI / 2 * 2) / 2 - 0.5 + 0.5;
    const xc = i / n;
    const yt = 5 * thick * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1015 * xc ** 4);
    pts.push([xc, yt]);
  }
  shape.moveTo(0, 0);
  for (const [x, y] of pts) shape.lineTo(x * chord, y * chord);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i][0] * chord, -pts[i][1] * chord);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1 });
  // shape is in (x,y), extruded along +z: map to x=aft(chord), y=down(span)
  g.rotateX(Math.PI / 2); // z(depth) -> -y
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const depth = -p.getY(i) / span; // 0 top .. 1 tip
    const s = lerp(1, taper, depth);
    p.setX(i, p.getX(i) * s + depth * chord * (1 - taper) * 0.3);
    const zz = p.getZ(i); p.setZ(i, zz * s);
  }
  g.computeVertexNormals();
  // local frame: +x = aft along chord; we want local three z = aft, x = starboard
  g.rotateY(-Math.PI / 2);
  return g;
}

function makeSailTexture(C, number, color) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const g = cv.getContext('2d');
  const base = new THREE.Color(color);
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, 256, 512);
  // panel seams
  g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
  for (let y = 40; y < 512; y += 46) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y + 24); g.stroke(); }
  // battens
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 3;
  for (const y of [120, 220, 320, 410]) { g.beginPath(); g.moveTo(256, y); g.lineTo(150, y + 8); g.stroke(); }
  if (number) {
    g.fillStyle = C.id === 'blackwatch' ? '#f1e6cf' : '#1d2a44';
    g.font = 'bold 72px "Barlow Condensed", Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.fillText(number, 128, 210);
    g.font = 'bold 34px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(C.id === 'blackwatch' ? 'BW' : C.id === 'sportboat' ? 'S23' : 'S14', 128, 110);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const NU = 8, NV = 12;
function sailMesh(tex, color) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((NU + 1) * (NV + 1) * 3), uv = new Float32Array((NU + 1) * (NV + 1) * 2);
  const idx = [];
  for (let v = 0; v <= NV; v++) for (let u = 0; u <= NU; u++) {
    const k = v * (NU + 1) + u; uv[2 * k] = 1 - u / NU; uv[2 * k + 1] = v / NV;
    if (u < NU && v < NV) idx.push(k, k + 1, k + NU + 1, k + 1, k + NU + 2, k + NU + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : color, map: tex || null, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, transparent: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}

function buildMotorBoat() {
  const C = { beam: 3.0, freeboard: 1.2, canoeDraft: 0.5, sternX: -5, bowX: 5, hull: { color: 0xe9ecef, boot: 0x223344, stripe: 0xff7a1a, sectionN: 2.4, transom: 0.85, bowRake: 0.6, sheer: 0.15 } };
  const h = hullGeometry(C);
  const g = new THREE.Group();
  const hull = new THREE.Mesh(h.hull, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }));
  g.add(hull);
  g.add(new THREE.Mesh(h.deck, new THREE.MeshStandardMaterial({ color: 0xcfd2d4 })));
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 3.5), new THREE.MeshStandardMaterial({ color: 0xf4f4f4 }));
  cabin.position.set(0, 2.0, 0.5); g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.5, 3.3), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.2 }));
  glass.position.set(0, 2.4, 0.5); g.add(glass);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  mast.position.set(0, 4.8, 0.5); g.add(mast);
  g.userData.flags = [];
  const fc = [0xff7a1a, 0x1a4fd0, 0xffd400];
  for (let i = 0; i < 3; i++) {
    const piv = new THREE.Group(); piv.position.set(0, 6.9 - i * 0.7, 0.5);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: fc[i], side: THREE.DoubleSide }));
    f.position.x = 0.45; piv.add(f); piv.userData.fid = i; g.add(piv); g.userData.flags.push(piv);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// =============================================================================== boat assembly
function buildBoat(boat, opts) {
  const C = boat.cls, H = C.hull;
  const root = new THREE.Group();
  const inner = new THREE.Group(); root.add(inner);
  const hg = hullGeometry(C);
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
  const hull = new THREE.Mesh(hg.hull, hullMat); hull.castShadow = true; hull.receiveShadow = true;
  if (opts.hullColor) { hullMat.vertexColors = false; hullMat.color.setHex(opts.hullColor); }
  inner.add(hull);
  const deckMat = new THREE.MeshStandardMaterial({ color: H.deck, roughness: 0.85 });
  const deck = new THREE.Mesh(hg.deck, deckMat); deck.receiveShadow = true; inner.add(deck);
  inner.add(new THREE.Mesh(hg.transom, new THREE.MeshStandardMaterial({ color: opts.hullColor ?? H.color, roughness: 0.4, side: THREE.DoubleSide })));
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.7 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.4, metalness: 0.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5 });
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(C.beam * 0.55, 0.05, C.lwl * 0.28), new THREE.MeshStandardMaterial({ color: 0x9b978c, roughness: 0.9 }));
  cockpit.position.set(0, C.freeboard * 0.72, -(C.sternX + C.lwl * 0.2)); inner.add(cockpit);
  if (C.cabin) { // Blackwatch coachroof with teak trim and bronze portlights
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 2.0), new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.6 }));
    cab.position.set(0, C.freeboard + 0.2, -0.55); cab.castShadow = true; inner.add(cab);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 2.05), wood); trim.position.set(0, C.freeboard + 0.02, -0.55); inner.add(trim);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.8, roughness: 0.3 }));
      port.rotation.z = Math.PI / 2; port.position.set(s * 0.73, C.freeboard + 0.22, -1.1 + i * 0.55); inner.add(port);
    }
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), wood); hatch.position.set(0, C.freeboard + 0.45, -0.1); inner.add(hatch);
  }
  // bowsprit
  if (C.bowsprit) {
    const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, C.bowsprit + 0.6, 10), C.id === 'blackwatch' ? wood : carbon);
    bs.rotation.x = Math.PI / 2; bs.position.set(0, C.freeboard + 0.12, -(C.bowX + C.bowsprit / 2 - 0.3));
    inner.add(bs);
    if (C.id === 'blackwatch') { // bobstay
      const bob = lineBetween([0, C.freeboard + 0.1, -(C.bowX + C.bowsprit)], [0, 0.05, -(C.bowX - 0.1)], 0x222222); inner.add(bob);
    }
  }
  // keel / board
  const K = C.keel;
  let keelMesh;
  if (K.long) {
    const kg = new THREE.BoxGeometry(0.16, C.draft - C.canoeDraft + 0.05, 3.9, 1, 1, 6);
    const p = kg.attributes.position;
    for (let i = 0; i < p.count; i++) { // rounded forefoot, raked heel
      const z = p.getZ(i), y = p.getY(i);
      if (z < -1.2 && y < 0) p.setY(i, y + (-z - 1.2) * 0.25);
      if (y < 0) p.setX(i, p.getX(i) * 0.7);
    }
    kg.computeVertexNormals();
    keelMesh = new THREE.Mesh(kg, black);
    keelMesh.position.set(0, -C.canoeDraft - (C.draft - C.canoeDraft) / 2 + 0.03, -(K.x + 0.1));
  } else {
    keelMesh = new THREE.Mesh(foilGeometry(K.chord, K.span, 0.11, 0.75), C.keelBulb ? carbon : new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }));
    keelMesh.position.set(0, -C.canoeDraft + 0.05, -(K.x + K.chord * 0.35));
    if (C.keelBulb) {
      const bulb = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 1.1, 6, 12), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.4, roughness: 0.4 }));
      bulb.rotation.x = Math.PI / 2; bulb.position.set(0, -K.span, 0.2); keelMesh.add(bulb);
    }
  }
  keelMesh.castShadow = true;
  inner.add(keelMesh);
  // rudder + tiller
  const Rd = C.rudder;
  const rudderPivot = new THREE.Group();
  rudderPivot.position.set(0, Rd.transom ? C.freeboard * 0.6 : -C.canoeDraft * 0.3, -(Rd.x + (Rd.transom ? -0.02 : Rd.chord * 0.25)));
  const blade = new THREE.Mesh(foilGeometry(Rd.chord, Rd.span + (Rd.transom ? C.freeboard * 0.6 + 0.2 : 0.1), 0.12, Rd.transom ? 0.95 : 0.75), Rd.transom ? wood : new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }));
  blade.position.set(0, 0, -Rd.chord * 0.2);
  rudderPivot.add(blade);
  const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.2, 8), wood);
  tiller.rotation.x = Math.PI / 2 + 0.12; tiller.position.set(0, (Rd.transom ? 0.35 : C.canoeDraft * 0.3 + C.freeboard + 0.25), 0.6);
  rudderPivot.add(tiller);
  inner.add(rudderPivot);
  // mast & rig
  const rig = new THREE.Group(); inner.add(rig);
  const mastH = C.mastHeight - C.freeboard;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, mastH, 10), C.id === 'blackwatch' ? new THREE.MeshStandardMaterial({ color: 0xc9a46b, roughness: 0.5 }) : C.id === 'sportboat' ? carbon : metal);
  mast.position.set(0, C.freeboard + mastH / 2, -C.mastX); mast.castShadow = true; rig.add(mast);
  const hounds = C.freeboard + mastH * (C.id === 'sportboat' ? 0.82 : 0.88);
  const head = C.mastHeight;
  const lines = [];
  if (C.id !== 'dinghy') {
    const spr = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, C.beam * 0.62, 6), metal);
    spr.rotation.z = Math.PI / 2; spr.position.set(0, C.freeboard + mastH * 0.5, -C.mastX); rig.add(spr);
    for (const s of [-1, 1]) {
      lines.push(lineBetween([s * C.beam * 0.46, C.freeboard, -(C.mastX - 0.25)], [s * C.beam * 0.31, C.freeboard + mastH * 0.5, -C.mastX], 0x888888));
      lines.push(lineBetween([s * C.beam * 0.31, C.freeboard + mastH * 0.5, -C.mastX], [0, hounds, -C.mastX], 0x888888));
    }
    const jib = boat.sailBy.jib, stay = boat.sailBy.stay;
    if (jib) lines.push(lineBetween([0, jib.tackZ, -jib.tackX], [0, jib.tackZ + jib.luff * 0.99, -(jib.tackX - jib.rake)], 0x999999));
    if (stay) lines.push(lineBetween([0, stay.tackZ, -stay.tackX], [0, stay.tackZ + stay.luff, -(stay.tackX - stay.rake)], 0x999999));
    lines.push(lineBetween([0, head, -C.mastX], [0, C.freeboard + 0.1, -(C.sternX + 0.1)], 0x999999)); // backstay
  }
  lines.forEach(l => rig.add(l));
  // booms
  const booms = {};
  for (const s of boat.sails) {
    if (s.kind !== 'boom') continue;
    const piv = new THREE.Group();
    const px = s.key === 'main' ? C.mastX : s.tackX, pz = s.key === 'main' ? C.boomZ : s.tackZ;
    piv.position.set(0, pz, -px);
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, s.foot, 8), s.key === 'main' && C.id === 'blackwatch' ? wood : metal);
    bm.rotation.x = Math.PI / 2; bm.position.set(0, -0.03, s.foot / 2);
    bm.castShadow = true; piv.add(bm);
    rig.add(piv); booms[s.key] = piv;
  }
  const mainsheet = lineBetween([0, 0, 0], [0, 1, 0], 0x333333); rig.add(mainsheet);
  // sails
  const sailMeshes = {};
  for (const s of boat.sails) {
    const tex = s.key === 'main' ? makeSailTexture(C, opts.number, s.color) : null;
    const m = sailMesh(tex, s.color);
    rig.add(m); sailMeshes[s.key] = m;
  }
  // telltales: pairs on the headsail luff (or main luff on a una-rig) + leech ribbons on the main
  const ttPos = new Float32Array(2 * 3 * 12), ttCol = new Float32Array(2 * 3 * 12);
  const ttg = new THREE.BufferGeometry();
  ttg.setAttribute('position', new THREE.BufferAttribute(ttPos, 3));
  ttg.setAttribute('color', new THREE.BufferAttribute(ttCol, 3));
  const telltales = new THREE.LineSegments(ttg, new THREE.LineBasicMaterial({ vertexColors: true }));
  telltales.frustumCulled = false; rig.add(telltales);
  // windex
  const windex = new THREE.Group(); windex.position.set(0, head + 0.12, -C.mastX);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.35, 6), black); arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.25; windex.add(arrow);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.12, 0.2), black); vane.position.z = 0.15; windex.add(vane);
  rig.add(windex);
  // crew
  const crew = [];
  const jackets = [0xff7a1a, 0x1d4e89, 0xd33f49, 0x2a9d8f];
  for (let i = 0; i < C.crewN; i++) {
    const p = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.45, 4, 8), new THREE.MeshStandardMaterial({ color: jackets[(i + (opts.crewTint || 0)) % 4], roughness: 0.8 }));
    torso.position.y = 0.45; p.add(torso);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.7 }));
    headM.position.y = 0.93; p.add(headM);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
    cap.position.y = 0.95; p.add(cap);
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x2b2f38 }));
    legs.rotation.z = Math.PI / 2; legs.position.set(0.3, 0.12, 0); p.add(legs); p.userData.legs = legs;
    p.traverse(o => { if (o.isMesh) o.castShadow = true; });
    inner.add(p); crew.push(p);
  }
  // board visual for dinghy slides up
  root.traverse(o => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  return { root, inner, hull, booms, sailMeshes, rudderPivot, keelMesh, telltales, windex, crew, mainsheet, hg };
}

function lineBetween(a, b, color) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
}

// sail surface from the physics' strip shapes
const _tmp = {};
function updateSail(mesh, boat, s, t) {
  const C = boat.cls, d = boat.diag;
  const sh = d.shape[s.key], st = d.strips[s.key];
  const pos = mesh.geometry.attributes.position.array;
  const areaF = st.areaF ?? 1;
  mesh.visible = areaF > 0.03;
  if (!mesh.visible) return;
  let px, pz, luff, rake = s.rake || 0;
  if (s.key === 'main') { px = C.mastX; pz = C.boomZ; luff = s.luff * REEF[clamp(boat.ctrl.reef | 0, 0, s.reefs || 0)].l; }
  else { px = s.tackX; pz = s.tackZ; luff = s.luff; }
  if (s.kind === 'spin' || s.kind === 'loose') luff *= Math.sqrt(areaF); // hoisting / furling
  const side = Math.sign(st.baseAngle || 1);
  const flogAmp = st.reduce ? 0 : 1;
  for (let v = 0; v <= NV; v++) {
    const fv = v / NV;
    // interpolate strip shapes along the luff
    let a, dd, ff;
    const F = STRIP_F;
    if (fv <= F[0]) { const k = fv / F[0]; a = lerp(st.baseAngle ?? 0, sh[0].ang, k); dd = sh[0].d; ff = sh[0].f; }
    else if (fv <= F[1]) { const k = (fv - F[0]) / (F[1] - F[0]); a = lerp(sh[0].ang, sh[1].ang, k); dd = lerp(sh[0].d, sh[1].d, k); ff = lerp(sh[0].f, sh[1].f, k); }
    else if (fv <= F[2]) { const k = (fv - F[1]) / (F[2] - F[1]); a = lerp(sh[1].ang, sh[2].ang, k); dd = lerp(sh[1].d, sh[2].d, k); ff = lerp(sh[1].f, sh[2].f, k); }
    else { const k = (fv - F[2]) / (1 - F[2]); a = sh[2].ang + (sh[2].ang - sh[1].ang) * k * 0.5; dd = sh[2].d; ff = sh[2].f; }
    const si = fv < 0.33 ? 0 : fv < 0.66 ? 1 : 2;
    const flog = st[si].flog || 0;
    const state = st[si].state;
    let chord = s.foot * (1 - fv) + s.head * fv;
    if (s.key === 'main') chord += s.foot * 0.12 * Math.sin(Math.PI * fv) * (s.head / s.foot > 0.2 ? 1 : 0.6); // roach
    if (s.kind === 'spin') chord *= 0.9 + 0.25 * Math.sin(Math.PI * fv);
    const lx = px - rake * fv, lz = pz + fv * luff;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cx = -ca, cy = sa;            // chord dir in (fwd, stbd)
    const nx = sa * side, ny = ca * side; // normal toward leeward
    const depth = dd * (1 - 0.8 * flog);
    for (let u = 0; u <= NU; u++) {
      const fu = u / NU;
      const camb = fu < ff ? 1 - (1 - fu / ff) ** 2 : 1 - ((fu - ff) / (1 - ff)) ** 2;
      let off = depth * chord * camb;
      if (flog > 0.05) off += flog * 0.12 * chord * Math.sin(fu * 9 - t * 22 + fv * 4) * fu * (0.5 + 0.5 * Math.sin(t * 7 + fv * 3));
      if (state === 1 && s.kind !== 'spin') off -= 0.25 * flog * depth * chord * Math.max(0, 1 - fu * 3); // luff lifting
      const xb = lx + cx * chord * fu + nx * off;
      const yb = cy * chord * fu + ny * off;
      const k = (v * (NU + 1) + u) * 3;
      pos[k] = yb; pos[k + 1] = lz; pos[k + 2] = -xb;
    }
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function updateBoat(vis, b, env, t, camera) {
  const C = b.cls;
  vis.root.position.set(b.x, b.heave, b.z);
  vis.root.rotation.set(0, -b.psi, 0);
  vis.inner.rotation.set(b.pitch, 0, -b.phi, 'YXZ');
  vis.rudderPivot.rotation.y = b.rudder;
  if (C.keel.board) vis.keelMesh.position.y = -C.canoeDraft + 0.05 + (1 - b.ctrl.board) * C.keel.span * 0.8;
  for (const k in vis.booms) vis.booms[k].rotation.y = b.booms[k].a;
  // mainsheet from boom end to traveler
  const M = b.sailBy.main;
  const ba = b.booms.main.a;
  const endX = C.mastX - M.foot * 0.92 * Math.cos(ba), endY = M.foot * 0.92 * Math.sin(ba);
  const trav = M.trav ? lerp(M.trav[0], M.trav[1], b.ctrl.trav) * Math.sign(ba || 1) : 0;
  const ms = vis.mainsheet.geometry.attributes.position;
  ms.setXYZ(0, endY, C.boomZ, -endX);
  ms.setXYZ(1, Math.sin(trav) * 0.9, C.freeboard + 0.05, -endX);
  ms.needsUpdate = true;
  for (const s of b.sails) updateSail(vis.sailMeshes[s.key], b, s, t);
  // windex follows the masthead apparent wind
  vis.windex.rotation.y = -b.diag.awa + Math.PI;
  // crew positions: spread along the cockpit, lean out when hiking
  const n = vis.crew.length;
  for (let i = 0; i < n; i++) {
    const p = vis.crew[i];
    const xFwd = C.sternX + 0.7 + (n > 1 ? i / (n - 1) : 0) * Math.min(2.4, C.lwl * 0.4) + b.crewX * 0.4;
    const yOff = b.crewY * (0.85 + 0.15 * (i % 2));
    const hike = clamp(Math.abs(yOff) / C.crewMaxOut, 0, 1);
    const sideS = Math.sign(yOff || 1);
    const deckY = C.freeboard + (C.cabin ? 0.1 : 0);
    p.position.set(yOff * (1 - 0.25 * hike) + sideS * 0.05, deckY - 0.1, -xFwd);
    p.rotation.set(0, 0, -sideS * hike * 1.0);
    p.userData.legs.position.x = -sideS * 0.3;
    if (b.capsized) p.position.y = deckY - 0.6;
  }
  // telltales
  updateTelltales(vis, b, t);
}

function updateTelltales(vis, b, t) {
  const C = b.cls;
  const pos = vis.telltales.geometry.attributes.position, col = vis.telltales.geometry.attributes.color;
  const head = b.sailBy.jib && (b.diag.strips.jib.areaF ?? 1) > 0.3 ? b.sailBy.jib : b.sailBy.main;
  const st = b.diag.strips[head.key], sh = b.diag.shape[head.key];
  let n = 0;
  const px = head.key === 'main' ? C.mastX : head.tackX, pz = head.key === 'main' ? C.boomZ : head.tackZ;
  const luff = head.key === 'main' ? head.luff : head.luff;
  const side = Math.sign(st.baseAngle || 1);
  for (let i = 0; i < 3; i++) {
    const fv = STRIP_F[i], s = st[i], a = sh[i].ang;
    const chord = head.foot * (1 - fv) + head.head * fv;
    const u = 0.12;
    const cx = -Math.cos(a), cy = Math.sin(a);
    const baseX = px - (head.rake || 0) * fv + cx * chord * u, baseY = cy * chord * u, baseZ = pz + fv * luff;
    for (const ws of [-1, 1]) { // windward (-1 = toward windward side) / leeward ribbons
      const nx = Math.sin(a) * side * ws * 0.02, ny = Math.cos(a) * side * ws * 0.02;
      let dx = cx, dy = cy, dz = 0;
      const wob = Math.sin(t * 13 + i * 2 + ws) * 0.15;
      if (s.state === 3 && ws > 0) { // leeward stalled: lifts and spins
        dx = cx * 0.2 + Math.sin(t * 9 + i) * 0.5; dy = cy * 0.2 + Math.cos(t * 7 + i) * 0.5; dz = 0.7;
      } else if (s.state === 1 && ws < 0) { // windward lifts when pinching / luffing
        dx = cx * 0.3 + Math.sin(t * 11) * 0.4; dy = cy * 0.3 - side * 0.5; dz = 0.6;
      } else { dy += wob * 0.3; }
      const L = 0.28;
      const k = n * 2;
      pos.setXYZ(k, baseY + ny, baseZ, -(baseX + nx));
      pos.setXYZ(k + 1, baseY + ny + dy * L, baseZ + dz * L, -(baseX + nx + dx * L));
      const green = ws * side > 0 ? [0.1, 0.8, 0.3] : [0.9, 0.15, 0.15];
      col.setXYZ(k, ...green); col.setXYZ(k + 1, ...green);
      n++;
    }
  }
  pos.needsUpdate = true; col.needsUpdate = true;
  vis.telltales.geometry.setDrawRange(0, n * 2);
}

// =============================================================================== wake
class Wake {
  constructor() {
    this.N = 90;
    this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 2 * 3); this.alpha = new Float32Array(this.N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = [];
    for (let i = 0; i < this.N - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float alpha; varying float vA; varying vec2 vW; void main(){ vA = alpha; vW = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying float vA; varying vec2 vW; float h(vec2 p){return fract(sin(dot(p,vec2(12.9,78.2)))*43758.5);} void main(){ float n = h(floor(vW*3.0)); gl_FragColor = vec4(0.95,0.97,1.0, vA*(0.55+0.45*n)); }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.acc = 0;
    this._s = {};
  }
  update(b, env, t, dt) {
    this.acc += dt;
    const C = b.cls;
    if (this.acc > 0.12) {
      this.acc = 0;
      const fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
      this.pts.unshift({ x: b.x + fx * C.sternX, z: b.z + fz * C.sternX, t, sp: Math.max(0, b.u), px: Math.cos(b.psi), pz: Math.sin(b.psi) });
      if (this.pts.length > this.N) this.pts.pop();
    }
    const n = this.pts.length;
    for (let i = 0; i < this.N; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) { this.alpha[2 * i] = this.alpha[2 * i + 1] = 0; continue; }
      const age = t - p.t;
      const w = C.beam * 0.35 + age * 0.35 * (0.5 + p.sp * 0.3);
      const h = env.wavesOn ? env.waves.sample(p.x, p.z, t, this._s).h : 0;
      const a = i >= n ? 0 : clamp(p.sp / 4, 0, 1) * Math.exp(-age / 6) * 0.55;
      this.pos.set([p.x + p.px * w, h + 0.04, p.z + p.pz * w, p.x - p.px * w, h + 0.04, p.z - p.pz * w], i * 6);
      this.alpha[2 * i] = a; this.alpha[2 * i + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
}
