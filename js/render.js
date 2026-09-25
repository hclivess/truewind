// Three.js renderer: sky, Gerstner ocean (same spectrum as the physics), real-map terrain, piers,
// lofted hulls, live sails (twist, camber, draft, luffing), telltales, crew, wakes, marks, cameras.
import * as THREE from 'three';
import { DEG } from './env.js';
import { STRIP_F, REEF, clamp, lerp } from './physics.js';
import { buildBoatModel, updateBoatModel } from './models.js';
import { Rigging, tickGlow } from './rigging.js';
import { buildStructures, indexFeatures, structureMask } from './structures.js';
import { HullSplash, SeaSpray } from './splash.js';
import { loadLand, buildTerrain, buildScenery, setSceneryNight, tickScenery } from './scenery.js';
import { SkySystem, SKY_LUT_GLSL, CLOUD_GLSL, withCloudShadows } from './sky.js';

const MAXW = 20;

// Gerstner components (same data as the physics): Wa = (dx, dz, k_deep, omega_doppler), Wb = (A, Q, phase, omega)
// Depth from the chart texture (G channel, metres*8): finite-depth wavenumber, shoaling, breaking cap;
// the phase field texture holds the integrated (k(h) - k_deep) along each component's direction.
const WAVE_GLSL = /* glsl */`
uniform vec4 uWa[${MAXW}];
uniform vec4 uWb[${MAXW}];
uniform int uWn;
uniform float uTime;
uniform sampler2D uSdf; uniform float uWorldR; uniform float uHasMap;
uniform sampler2D uPF; uniform float uHasPF; uniform float uPFN;
// GLSL tanh/sinh overflow to NaN for large arguments on many GPUs: keep them bounded
float tanhS(float x) { x = clamp(x, -9.0, 9.0); float e = exp(2.0 * x); return (e - 1.0) / (e + 1.0); }
float kDepth(float w, float h) { float k0 = w * w / 9.81; if (h > 30.0 || k0 * h > 6.0) return k0; return k0 / sqrt(max(tanhS(k0 * h), 1e-3)); }
float shoal(float w, float h) {
  float kh = kDepth(w, h) * h;
  if (h > 30.0 || kh > 6.0) return 1.0;
  float x = max(2.0 * kh, 1e-4);
  float n = 0.5 * (1.0 + x / (0.5 * (exp(x) - exp(-x))));
  return min(2.2, 1.0 / sqrt(max(0.2, n * tanhS(kh) / 0.5)));
}
float depthAt(vec2 x) {
  if (uHasMap < 0.5) return 99.0;
  vec4 s = texture2D(uSdf, (x + uWorldR) / (2.0 * uWorldR));
  return s.r * 255.0 - 128.0 > 0.0 ? max(0.05, s.g * 255.0 / 8.0) : 0.05;
}
float phaseOff(int i, vec2 x) {
  if (uHasPF < 0.5) return 0.0;
  vec2 uv = clamp((x + uWorldR) / (2.0 * uWorldR), 0.5 / uPFN, 1.0 - 0.5 / uPFN);
  float tile = floor(float(i) / 4.0);
  vec4 v = texture2D(uPF, vec2((tile + uv.x) / 5.0, uv.y));
  int c = i - int(tile) * 4;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}
`;

export class Renderer {
  constructor(canvas) {
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // ?q=low for weak GPUs: lower resolution, no shadows, coarser sea mesh
    this.low = new URLSearchParams(location.search).get('q') === 'low';
    r.setPixelRatio(this.low ? 0.6 : Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = !this.low;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 30000); // human-like field of view
    this.overcastU = { value: 0 };
    this.skySys = new SkySystem(r, this.scene, { low: this.low, overcastU: this.overcastU });
    this.skySys.setTime(Date.UTC(2026, 8, 18, 21, 30), 21.3, -89.67);
    this.sunDir = this.skySys.sunDir;
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
    this.hemi = hemi;
    this._buildWater();
    this._buildRain();
    this.cloudMeshes = [];
    this.wakes = new Map();
  }

  resize(w, h) {
    this.r.setSize(w, h, false);
    this.skySys.resize(w, h, this.r.getPixelRatio());
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- water
  _buildWater() {
    const N = this.low ? 160 : 360, R = 6500, a = 0.035;
    const pos = new Float32Array((N + 1) * (N + 1) * 3);
    const map = (u) => R * Math.sign(u) * (a * Math.abs(u) + (1 - a) * Math.abs(u) ** 3);
    // local grid spacing (m): a wave shorter than a few cells cannot be drawn as geometry — it would alias
    // into moire bands — so the vertex shader leaves it to the per-pixel normal
    const spc = new Float32Array((N + 1) * (N + 1));
    const dmap = (u) => R * (a + 3 * (1 - a) * u * u) * 2 / N;
    let p = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      pos[p++] = map(i / N * 2 - 1); pos[p++] = 0; pos[p++] = map(j / N * 2 - 1);
      spc[j * (N + 1) + i] = Math.max(dmap(i / N * 2 - 1), dmap(j / N * 2 - 1));
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * (N + 1) + i;
      idx.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('spc', new THREE.BufferAttribute(spc, 1));
    g.setIndex(idx);
    const Wa = [], Wb = [];
    for (let i = 0; i < MAXW; i++) { Wa.push(new THREE.Vector4()); Wb.push(new THREE.Vector4()); }
    this.gustTex = new THREE.DataTexture(new Uint8Array(128 * 128 * 4).fill(128), 128, 128, THREE.RGBAFormat);
    this.gustTex.magFilter = THREE.LinearFilter; this.gustTex.minFilter = THREE.LinearFilter; this.gustTex.needsUpdate = true;
    this.sdfTex = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, THREE.RGBAFormat);
    this.sdfTex.needsUpdate = true;
    this.pfTex = new THREE.DataTexture(new Uint16Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat, THREE.HalfFloatType); this.pfTex.needsUpdate = true;
    const uniforms = {
      uWa: { value: Wa }, uWb: { value: Wb }, uWn: { value: 0 }, uTime: { value: 0 },
      uSunDir: { value: this.sunDir }, uCam: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector2() },
      uGust: { value: this.gustTex }, uGustO: { value: new THREE.Vector2() }, uGustS: { value: 2048 },
      uSdf: { value: this.sdfTex }, uWorldR: { value: 6000 }, uHasMap: { value: 0 }, uOvercast: this.overcastU,
      uPF: { value: this.pfTex }, uHasPF: { value: 0 }, uPFN: { value: 96 },
      uFlow: { value: new THREE.Vector2(0, 1) }, uWind: { value: 6 }, uFoamK: { value: 0 },
      uHs: { value: 0 }, uJSig: { value: 0.1 }, uLmin: { value: 4 },
      uHullA: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uHullB: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uHullN: { value: 0 },
      uDeep: { value: new THREE.Color(0x0a2f40) }, uShallow: { value: new THREE.Color(0x2e9c9a) },
      fogColor: { value: new THREE.Color(0xb7c8d4) }, fogDensity: { value: 0.00011 },
      uEnv: { value: this.skySys.cubeRT.texture }, uAmbF: { value: 1 }, uLightDir: { value: this.skySys.lightV }, uSkyRT: this.skySys.compU.uSkyTex, uSkyVP: this.skySys.marchDome.material.uniforms.uPrevVP,
    };
    // the sky's shared uniforms (table, clouds, sun colour) are the same objects
    for (const k of ['uSkyLUT', 'uLutDir', 'uNoise', 'uWeather', 'uWOff', 'uCover', 'uCloudBase', 'uCloudThick', 'uCloudTime', 'uCells', 'uSunCol']) uniforms[k] = this.skySys.U[k];
    this.waterU = uniforms;
    const m = new THREE.ShaderMaterial({
      uniforms, fog: false,
      vertexShader: /* glsl */`
        ${WAVE_GLSL}
        uniform vec2 uOffset; uniform vec3 uCam; attribute float spc;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore; varying float vBreak;
        void main(){
          vec2 x0 = position.xz + uOffset;
          float dist = length(x0 - uCam.xz);
          float fade = 1.0 - smoothstep(700.0, 3200.0, dist);
          float h = depthAt(x0);
          float shore = 1.0;
          if (uHasMap > 0.5) {
            float s = (texture2D(uSdf, (x0 + uWorldR) / (2.0 * uWorldR)).r * 255.0 - 128.0);
            shore = clamp(s / 60.0, 0.08, 1.0);
          }
          // depth-limited breaking cap on the local significant height
          float a2 = 0.0;
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break; float A = uWb[i].x * shoal(uWb[i].w, h); a2 += A * A; }
          float Hs = 4.0 * sqrt(a2 * 0.5);
          float cap = uHasMap > 0.5 && Hs > 0.78 * h ? 0.78 * h / Hs : 1.0;
          vBreak = clamp(Hs / (0.78 * h) - 0.7, 0.0, 1.0);
          vec3 P = vec3(x0.x, 0.0, x0.y);
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            float th = a.z * dot(a.xy, x0) + phaseOff(i, x0) - a.w * uTime + b.z;
            float A = b.x * shoal(b.w, h) * cap * fade * shore * smoothstep(3.0 * spc, 6.0 * spc, 6.2832 / a.z);
            P.x += b.y * A * a.x * cos(th); P.z += b.y * A * a.y * cos(th); P.y += A * sin(th);
          }
          vPos = P; vX0 = x0; vFade = fade; vShore = shore;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${this.low ? '#define LOWQ' : ''}
        ${WAVE_GLSL}
        ${SKY_LUT_GLSL}
        ${CLOUD_GLSL}
        uniform vec3 uSunDir; uniform vec3 uSunCol; uniform samplerCube uEnv; uniform float uAmbF; uniform vec3 uLightDir; uniform sampler2D uSkyRT; uniform mat4 uSkyVP;
        uniform vec3 uCam; uniform sampler2D uGust; uniform vec2 uGustO; uniform float uGustS;
        uniform vec4 uHullA[4]; uniform vec4 uHullB[4]; uniform int uHullN;   // A = (x, z, sinψ, cosψ), B = (halfL, halfB, xOff, n)
        uniform vec2 uFlow; uniform float uWind; uniform float uFoamK; uniform float uHs; uniform float uJSig; uniform float uLmin;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore; varying float vBreak;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float qn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
        float sfbm(vec2 p){ float a = 0.55, s = 0.0; mat2 r = mat2(0.8, -0.6, 0.6, 0.8); for (int i = 0; i < 4; i++) { s += a * qn(p); p = r * p * 2.1 + 3.7; a *= 0.5; } return s; }
        // value noise and its gradient (quintic): (v, dv/dx, dv/dy)
        vec3 qnd(vec2 p){ vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
          float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1)), e = a - b - c + d;
          return vec3(a + (b - a) * u.x + (c - a) * u.y + e * u.x * u.y, du * vec2(b - a + e * u.y, c - a + e * u.x)); }
        // the same, with octaves finer than the pixel footprint w (in p units) replaced by their mean (no shimmer)
        float sfbmA(vec2 p, float w){ float a = 0.55, s = 0.0, f = 1.0; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) { s += a * mix(0.5, qn(p), smoothstep(0.8, 0.3, w * f)); p = r * p * 2.1 + 3.7; f *= 2.1; a *= 0.5; } return s; }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        // z such that a normal variable exceeds it with probability p (p <= 0.5; Abramowitz-Stegun 26.2.23)
        float invTail(float p){ float t = sqrt(-2.0 * log(max(p, 1e-6)));
          return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t); }
        void main(){
          vec2 x0 = vX0;
          float dist = length(vPos - uCam);
          float hd = depthAt(x0);
          // the pixel's footprint on the water (long at grazing angles): waves shorter than a few footprints
          // cannot be drawn as normals — they alias into moire — so they are filtered out and their slope
          // becomes roughness (a glossier reflection and a wider sun glitter), as a real sea does at a distance
          vec3 V0 = normalize(uCam - vPos);
          float fp = dist * 0.0022 / max(abs(V0.y), 0.06);
          float lost = 0.0;
          // analytic Gerstner normal + Jacobian (crest sharpness) for whitecaps
          vec3 n = vec3(0.0, 1.0, 0.0); float J = 1.0, sJ2 = 0.0, Cs = 0.0, sS2 = 0.0;
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            float th = a.z * dot(a.xy, x0) + phaseOff(i, x0) - a.w * uTime + b.z;
            float kw = kDepth(b.w, hd);
            float WA0 = kw * b.x * shoal(b.w, hd) * vFade * vShore;
            float att = smoothstep(fp * 2.0, fp * 6.0, 6.2832 / kw);
            lost += (1.0 - att) * WA0 * WA0 * 0.5;
            float WA = WA0 * att;
            n.x -= a.x * WA * cos(th); n.z -= a.y * WA * cos(th); n.y -= b.y * WA * sin(th);
            J -= b.y * WA * sin(th); sJ2 += b.y * b.y * WA * WA * 0.5;
            float ws = smoothstep(80.0, 20.0, 6.2832 / kw);                  // the short waves break on the long crests
            Cs += ws * b.y * WA * sin(th); sS2 += ws * ws * b.y * b.y * WA * WA * 0.5;
          }
          // local wind (puffs + land shelter): the short waves answer it within seconds, so puffs read dark
          vec2 guv = (x0 - uGustO) / uGustS + 0.5;
          float gw = texture2D(uGust, guv).r * 2.0;
          float lw = uWind * gw;                                              // m/s
          // the spectrum continued below the shortest modelled wave, drawn as normals only (nothing the boat
          // would feel): equilibrium-range steepness, jittered wavelengths, fanned about the wind
          vec2 fl = uFlow, pr = vec2(-fl.y, fl.x);
          float wk = smoothstep(0.8, 6.0, lw) * sqrt(clamp(gw, 0.3, 2.0));
          float Cd = 0.0, sd2 = 0.0, wl = uLmin;
          #ifdef LOWQ
          const int ND = 5, NR = 2;
          #else
          const int ND = 10, NR = 3;
          #endif
          for (int k = 0; k < ND; k++) {
            float fk = float(k);
            wl *= 0.74;
            float wj = wl * (0.88 + 0.24 * hash(vec2(fk, 5.1)));
            if (wj < 0.35) break;
            float ang = (fract(0.37 + fk * 0.618034) - 0.5) * 2.6;
            vec2 d = fl * cos(ang) + pr * sin(ang);
            float kk = 6.2832 / wj, om = sqrt(9.81 * kk + 7.2e-5 * kk * kk * kk);
            float ph = kk * dot(d, x0) - om * uTime + fk * 2.39996 + 1.7;
            float kA = 0.038 * wk * (0.7 + 0.6 * hash(vec2(fk, 1.3))), att = smoothstep(fp * 2.0, fp * 6.0, wj);
            lost += (1.0 - att) * kA * kA * 0.5;
            kA *= att * vShore;
            float s = sin(ph), c = cos(ph);
            n.x -= d.x * kA * c; n.z -= d.y * kA * c; n.y -= 0.5 * kA * s;
            Cd += kA * s; sd2 += kA * kA * 0.5;
          }
          // below that, wind ripples: gradient noise (no periodic pattern), octaves drifting downwind at
          // their own phase speeds
          vec2 rp = vec2(dot(x0, fl), dot(x0, pr));
          float fr = 1.0 / 1.3;
          for (int k = 0; k < NR; k++) {
            float fk = float(k);
            float c = sqrt(9.81 / (6.2832 * fr) + 7.2e-5 * 6.2832 * fr);
            float ra = (fk - 1.0) * 0.45; mat2 Rk = mat2(cos(ra), sin(ra), -sin(ra), cos(ra));   // each octave turned a little: no grid
            vec2 rq = Rk * rp;
            vec2 pk = vec2(rq.x - c * uTime, rq.y * 0.6) * fr + fk * 17.3;
            vec3 g = qnd(pk);
            float sl = 0.05 * wk, att = smoothstep(fp * 2.0, fp * 6.0, 1.0 / fr);
            lost += (1.0 - att) * sl * sl;
            vec2 gr = vec2(g.y, g.z * 0.6) * Rk;                            // gradient back to (along, across)
            vec2 gg = (gr.x * fl + gr.y * pr) * sl * att * vShore;
            n.xz -= gg;
            fr *= 2.2;
          }
          n = normalize(n);
          vec3 V = V0;
          float NdV = max(dot(n, V), 1e-3);
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, n); R.y = abs(R.y);
          // roughness: slopes too small to draw — the filtered-out waves plus the capillary rest of the
          // Cox-Munk mean square slope (0.003 + 0.00512 U) — blur the reflection and widen the sun's path
          float mssSub = max(0.0015, 0.003 + 0.00512 * lw - uJSig * uJSig - sd2) * 0.7;
          float a2 = clamp(lost + mssSub, 2e-4, 0.5);
          float sig = sqrt(a2);
          float gloss = clamp(log2(1.0 + sig * 45.0), 0.0, 6.0);
          vec3 refl = texture(uEnv, R, gloss).rgb;
          // where the reflected direction is on screen, use the full-quality sky and clouds rendered this
          // frame (a sky at infinity reprojects exactly); the cube covers the rest and the rough water
          vec4 rc = uSkyVP * vec4(R, 0.0);
          if (rc.w > 0.0) {
            vec2 ruv = rc.xy / rc.w * 0.5 + 0.5, re = min(ruv, 1.0 - ruv);
            float rw = smoothstep(0.0, 0.1, min(re.x, re.y)) * (1.0 - smoothstep(1.5, 3.5, gloss));
            if (rw > 0.0) refl = mix(refl, texture2D(uSkyRT, ruv).rgb, rw);
          }
          float shadow = cloudShadow(vec3(x0.x, 0.0, x0.y), uLightDir);
          // sun: GGX microfacet reflection with the roughness above (a sharp glint on a calm sea, a long
          // broken path of glitter on a rough one)
          vec3 L = uLightDir, Hh = normalize(V + L);
          float NdL = max(dot(n, L), 0.0), NdH = max(dot(n, Hh), 0.0), VdH = max(dot(V, Hh), 0.0);
          float dd = NdH * NdH * (a2 - 1.0) + 1.0, kS = sig * 0.5;
          float Dg = a2 / (3.14159 * dd * dd);
          float Vis = 1.0 / (4.0 * (NdL * (1.0 - kS) + kS) * (NdV * (1.0 - kS) + kS));
          float spec = min(Dg * Vis * (0.02 + 0.98 * pow(1.0 - VdH, 5.0)) * NdL, 40.0) * (1.0 - 0.9 * uOvercast) * shadow * step(0.0, L.y);
          // water body colour: shallow sand shows through on real bathymetry
          float depth = 30.0;
          float sd = 999.0;
          if (uHasMap > 0.5) {
            vec4 s = texture2D(uSdf, (x0 + uWorldR) / (2.0 * uWorldR));
            sd = s.r * 255.0 - 128.0; depth = s.g * 255.0 / 8.0;
          }
          vec3 deep = mix(uShallow, uDeep, smoothstep(0.5, 9.0, depth));
          // under cloud the light is grey and diffuse: the sea turns steel grey
          deep = mix(deep, vec3(dot(deep, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.92, 1.0, 1.06), 0.6 * uOvercast);
          vec3 body = deep * (1.0 - 0.35 * uOvercast) * uAmbF * (0.75 + 0.25 * shadow);
          body *= 1.0 - 0.18 * clamp(gw - 1.0, 0.0, 1.0);                      // puffs look darker
          // subsurface scattering: light entering the back of a wave leaves through its thin upper part,
          // so crests glow green-blue when you look toward the sun (and faintly under any sky)
          float hN = clamp(vPos.y / max(0.5 * uHs, 0.08), -1.5, 1.5);          // -1 trough .. +1 crest
          float thin = clamp(0.45 + 0.45 * hN, 0.0, 1.0); thin *= thin;
          vec2 Lh = normalize(L.xz + 1e-4), Vh = normalize(-V.xz + 1e-4);
          float back = pow(max(dot(Vh, Lh), 0.0), 3.0) * (1.0 - 0.6 * max(L.y, 0.0));
          float face = clamp(0.35 + dot(n.xz, V.xz) * 2.5, 0.0, 1.0);        // the face tilted toward you is thin
          vec3 sssCol = vec3(0.07, 0.42, 0.36);
          vec3 sss = sssCol * thin * (uSunCol * back * face * 0.9 * (1.0 - 0.85 * uOvercast) * shadow * step(0.0, L.y) + uAmbF * 0.10);
          vec3 col = mix(body + sss, refl, F) + uSunCol * spec * 1.5;
          // ---- whitecaps and foam, Beaufort coverage from the wind (Monahan: W = 3.84e-6 U^3.41), placed
          // on the steepest crests: a z-score of crest compression (1 - Jacobian) against its local spread
          float Wc = clamp(3.84e-6 * pow(max(lw, 0.0), 3.41), 0.0, 0.3);
          // long waves say where (their crests), the short waves riding them say exactly which bits break
          float zc = (0.5 * (1.0 - J) / sqrt(sJ2 + 1e-5) + 0.85 * (Cs + 0.4 * Cd) / sqrt(sS2 + 0.16 * sd2 + 1e-5)) / 1.3;
          vec2 sw = vec2(dot(x0, uFlow), dot(x0, vec2(-uFlow.y, uFlow.x)));    // (downwind, across)
          float fAA = smoothstep(0.4, 3.0, fp);                                // texture detail lost to distance
          // foam texture is fixed in the water (x0 is the undisplaced, Lagrangian position): it rides the
          // orbital motion of the waves and drifts slowly downwind
          vec2 q = vec2(sw.x * 0.28, sw.y * 0.6) - vec2(uTime * 0.12, 0.0);
          float f1 = sfbmA(q, fp * 0.6), f2 = sfbmA(q * 3.1 + 7.1, fp * 1.9);
          float lace = smoothstep(0.32, 0.68, f1 * 0.6 + f2 * 0.4);
          float foam = 0.0;
          if (Wc > 2e-4) {
            float zA = invTail(0.4 * Wc);                                      // active breaking crests
            float act = smoothstep(zA - 0.15, zA + 0.4, zc + (f1 - 0.5) * 1.1) * (0.5 + 0.5 * lace);
            // residual foam: thinning lace around the crests, and patches of old foam that ride the water
            float big = sfbmA(sw * vec2(0.02, 0.05) + vec2(-uTime * 0.006, 3.3), fp * 0.05);
            float thrB = 0.5 + 0.12 * invTail(clamp(0.6 * Wc, 1e-4, 0.5));
            float resid = max(smoothstep(zA - 0.6, zA, zc) * 0.35, smoothstep(thrB - 0.03, thrB + 0.08, big) * 0.35) * lace;
            // gale: foam blown into long, narrow, meandering streaks along the wind (Beaufort 8 and up)
            float st = smoothstep(13.0, 24.0, lw);
            float ya = sw.y + 10.0 * (qn(sw * vec2(0.008, 0.015)) - 0.5) + 2.0 * (qn(sw * vec2(0.03, 0.06) + 5.0) - 0.5);
            float ridge = 1.0 - abs(2.0 * qn(vec2(sw.x * 0.015 - uTime * 0.02, ya * 0.3)) - 1.0);   // thin lines ~3 m apart
            float wd = 0.2 + fp * 0.1;                                         // widen with distance, then fade to a mean
            float line = smoothstep(1.0 - wd, 1.0 - wd * 0.15, ridge) * smoothstep(0.45, 0.75, qn(vec2(sw.x * 0.08, ya * 0.1) + 9.0));
            line = mix(line, 0.15, smoothstep(0.6, 3.0, fp));
            float streak = st * line * mix(smoothstep(0.3, 0.8, f2) * (0.4 + 0.6 * lace), 0.4, fAA);
            foam = max(act * (0.7 + 0.3 * f2), max(resid, streak * 0.5));
          }
          // up close foam is bubbles and holes, not paint
          #ifndef LOWQ
          float grain = sfbmA(x0 * 3.0 + vec2(-uTime * 0.2, 0.0), fp * 3.0);
          foam *= mix(1.0, smoothstep(0.25, 0.6, grain) * 1.15, 0.6);
          #endif
          // depth-limited breaking on real bathymetry
          foam = max(foam, smoothstep(1.0 - vBreak * 0.9, 1.25 - vBreak * 0.9, f1 * 0.7 + f2 * 0.3) * vBreak);
          vec3 foamCol = vec3(0.9, 0.94, 0.96) * (uAmbF * (0.72 + 0.2 * shadow) + uSunCol * 0.25 * NdL * shadow);
          col = mix(col, foamCol, clamp(foam, 0.0, 0.92) * vFade);
          // shoreline surf
          if (uHasMap > 0.5) {
            float band = smoothstep(9.0, 0.0, sd) * (0.55 + 0.45 * sin(sd * 1.2 - uTime * 1.6 + vnoise(x0 * 0.1) * 6.0));
            col = mix(col, vec3(0.92, 0.95, 0.96) * uAmbF, clamp(band * 0.8, 0.0, 0.85));
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
      if (i < n) { U.uWa.value[i].set(c.dx, c.dz, c.kRef ?? c.k, c.omegaEff ?? c.omega); U.uWb.value[i].set(c.A * (c.curAmp ?? 1), c.Q, c.phase, c.omega); }
      else { U.uWa.value[i].set(0, 0, 0, 0); U.uWb.value[i].set(0, 0, 0, 1); }
    }
    U.uWn.value = n;
    // sea statistics for the shader: height scale (crest light), crest-compression spread (whitecaps),
    // and the shortest modelled wave, where the drawn-only short waves take over
    let lmin = 1e9; for (let i = 0; i < n; i++) lmin = Math.min(lmin, 2 * Math.PI / (waves.comps[i].kRef ?? waves.comps[i].k));
    U.uHs.value = waves.Hs || 0; U.uJSig.value = Math.max(0.02, waves.jSigma || 0.1); U.uLmin.value = Math.min(lmin, 12);
  }
  // spindrift blown off breaking crests around the camera (gale force only)
  _updateSeaSpray(dt, t, env) {
    if (!this.seaSpray) this.seaSpray = new SeaSpray(this.scene, this.skySys, this.low);
    const d = this.camera.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3()));
    const h = Math.hypot(d.x, d.z) || 1;
    this.seaSpray.update(dt, t, env, this.camera.position, d.x / h, d.z / h);
  }
  setWavesEnabled(on, waves) {
    if (on) this.setWaves(waves); else this.waterU.uWn.value = 0;
  }
  // finite-depth phase field -> half-float texture (5 tiles of 4 components)
  setPhaseField(waves) {
    const U = this.waterU;
    if (!waves.phaseField) { U.uHasPF.value = 0; return; }
    const N = waves.pfN, F = waves.phaseField;
    const data = new Float32Array(N * 5 * N * 4);
    for (let tile = 0; tile < 5; tile++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) {
      const ci = tile * 4 + c;
      data[((j * N * 5) + tile * N + i) * 4 + c] = ci < F.length ? F[ci][j * N + i] : 0;
    }
    this.pfTex.dispose();
    this.pfTex = new THREE.DataTexture(data, N * 5, N, THREE.RGBAFormat, THREE.FloatType);
    const lin = !!this.r.extensions.get('OES_texture_float_linear');
    this.pfTex.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter; this.pfTex.minFilter = this.pfTex.magFilter; this.pfTex.needsUpdate = true;
    U.uPF.value = this.pfTex; U.uHasPF.value = 1; U.uPFN.value = N;
  }

  // ---------------------------------------------------------------- weather: overcast, rain, squall clouds
  _buildRain() {
    const n = this.low ? 1500 : 4000;
    const pos = new Float32Array(n * 6);
    this.rainSeeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.rainSeeds[i * 3] = Math.random(); this.rainSeeds[i * 3 + 1] = Math.random(); this.rainSeeds[i * 3 + 2] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d4dc, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
  }
  updateWeather(env, t, cam) {
    const W = env.weather; if (!W) return;
    const sky = W.sky(cam.x, cam.z, t, this._sky || (this._sky = {}));
    const oc = sky.overcast;
    // clouds drift with the wind aloft and thicken with the weather; squall cells tower
    const mw = env.wind.mean(t);
    // smoothed in time, not per frame (the same at 20 or 144 fps); a jump in t (joining a room, time warp) snaps
    const dtw = t - (this._wxT ?? -1e9); this._wxT = t;
    const kw = dtw < 0 || dtw > 30 ? 1 : 1 - Math.exp(-dtw / 3);
    this.overcastU.value += (oc - this.overcastU.value) * kw;
    // (the wind aloft is steady: drifting by the surface trend's speed x t swung the whole sky around
    // the origin as the trend turned, tens of m/s sideways after an hour)
    const vw = env.wind.tws * 1.3, dw = env.wind.twd;
    const drift = (this._drift || (this._drift = new THREE.Vector2())).set(Math.sin(dw) * vw * t, -Math.cos(dw) * vw * t);
    const cells = W.activeCells ? W.activeCells(t) : [];
    this.skySys.setWeather(Math.min(1, 0.22 + 0.95 * oc), cells, drift, t, mw.speed / 0.5144);
    // visibility: heavy rain closes it to ~1-2 km, and the haze turns rain-grey (applied to the fog colour in update)
    this.scene.fog.density = 0.00011 + 0.0012 * sky.rain;
    this.waterU.fogDensity.value = this.scene.fog.density;
    this._rainFog = sky.rain;
    // rain: drops fixed in the world, falling at ~7 m/s and blown along by the wind, drawn as short
    // motion-blur streaks along their velocity; heavier rain = more drops, not just brighter ones
    const rain = sky.rain;
    this.rain.visible = rain > 0.03;
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array, sd = this.rainSeeds, n = sd.length / 3;
      const w = env.wind.sample(cam.x, cam.z, t, this._rw || (this._rw = {}));
      const sp = w.speed * 0.8;                        // drops carry most of the wind
      const wx = -Math.sin(w.dir) * sp, wz = Math.cos(w.dir) * sp, fall = 7, blur = 0.045;
      const R = 40, H = 30, wrap = (v, m) => ((v % m) + m) % m;
      const m = Math.min(n, Math.round(n * Math.min(1, 0.15 + rain)));
      for (let i = 0; i < m; i++) {
        const x = cam.x - R + wrap(sd[i * 3] * 2 * R + wx * t - cam.x + R, 2 * R);
        const z = cam.z - R + wrap(sd[i * 3 + 1] * 2 * R + wz * t - cam.z + R, 2 * R);
        const y = cam.y - 12 + wrap(sd[i * 3 + 2] * H - fall * t - cam.y + 12, H);
        p.set([x, y, z, x - wx * blur, y + fall * blur, z - wz * blur], i * 6);
      }
      this.rain.geometry.setDrawRange(0, m * 2);
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = Math.min(0.6, 0.25 + 0.4 * rain);
    }
    // lightning from mature cells: deterministic in t (everyone in a room sees the same flashes); a
    // flash is a double flicker over ~0.3 s, dimmer with distance
    this._flash = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]; if (c.w < 0.6) continue;
      const slot = Math.floor(t / 0.3) + i * 7919, h = Math.abs((Math.sin(slot * 12.9898) * 43758.5453) % 1);
      if (h < 0.02 * (c.w - 0.5)) {
        const ph = (t / 0.3) % 1, d = Math.hypot(cam.x - c.x, cam.z - c.z);
        this._flash = Math.max(this._flash, (ph < 0.2 || (ph > 0.45 && ph < 0.6) ? 1 : 0.25) * (1 - ph) / (1 + d / 4000));
      }
    }
  }

  // ---------------------------------------------------------------- terrain & piers from the real map
  setWorld(world, geo, manifest = null) {
    const drop = (o) => { if (!o) return; this.scene.remove(o); o.traverse(m => { if (m.geometry) m.geometry.dispose(); }); };
    drop(this.land); drop(this.town); this.land = this.town = null;
    if (this.piersMesh) { this.scene.remove(this.piersMesh); }
    const byId = indexFeatures(geo, manifest), onStructure = structureMask(geo, byId);
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
    // terrain, buildings, streets and trees from the venue's OSM land data (built once it has loaded;
    // everything stands on the same height function, so buildings neither float nor sink)
    loadLand(world.venue.id).then(land => {
      if (this.world !== world) return;                       // the venue changed meanwhile
      const T = buildTerrain(world, land, { lat: world.venue.lat, low: this.low });
      const shadowed = new Set();
      const shade = (g, ground) => g.traverse(o => { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m && m.isMeshStandardMaterial && !shadowed.has(m)) { shadowed.add(m); withCloudShadows(m, this.skySys, { ground }); } });
      shade(T.group, true);
      drop(this.land); this.land = T.group; this.land.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); this.scene.add(this.land);
      const town = buildScenery(world, land, { lat: world.venue.lat, onStructure, low: this.low, terrain: T });
      shade(town, false);
      drop(this.town); this.town = town; this.scene.add(town);
    }).catch(e => console.error('scenery', e));
    // piers, breakwaters, viaducts, causeways and terminals (labelled ones drawn as what they are)
    const pierGroup = buildStructures(world, geo, byId);
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
    const vis = buildBoatModel(boat, opts);
    vis.rigging = new Rigging(boat, vis, { player: !!opts.player });
    vis.player = !!opts.player;
    vis.splash = new HullSplash(this.scene, vis, boat, this.skySys);
    this.scene.add(vis.root);
    this.boats.set(boat, vis);
    const wake = new Wake(); this.scene.add(wake.mesh); this.wakes.set(boat, wake);
    return vis;
  }
  removeBoat(b) {
    const v = this.boats.get(b); if (v) { this.scene.remove(v.root); v.splash.dispose(this.scene); }
    const w = this.wakes.get(b); if (w) this.scene.remove(w.mesh);
    this.boats.delete(b); this.wakes.delete(b);
  }
  removeAllBoats() {
    for (const [b, v] of this.boats) { this.scene.remove(v.root); v.splash.dispose(this.scene); }
    for (const [b, w] of this.wakes) { this.scene.remove(w.mesh); }
    this.boats.clear(); this.wakes.clear();
  }

  // ---------------------------------------------------------------- grab markers
  // a ring on screen for every control of the player's boat, the size of its grab radius
  updateGrabMarkers(list, hoverId, radiusPx) {
    if (!this.grabRingTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      g.strokeStyle = 'rgba(255,170,90,1)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(255,170,90,0.9)'; g.beginPath(); g.arc(32, 32, 4, 0, Math.PI * 2); g.fill();
      this.grabRingTex = new THREE.CanvasTexture(cv);
      this.grabRings = [];
    }
    while (this.grabRings.length < list.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.grabRingTex, depthTest: false, transparent: true, sizeAttenuation: false }));
      sp.renderOrder = 20; this.scene.add(sp); this.grabRings.push(sp);
    }
    const h = this.r.domElement.clientHeight || window.innerHeight;
    const size = 2 * radiusPx / h * Math.tan(this.camera.fov * Math.PI / 360) * 2; // screen-constant size
    this.grabRings.forEach((sp, i) => {
      const g = list[i];
      sp.visible = !!g;
      if (!g) return;
      sp.position.copy(g.pos);
      const on = g.id === hoverId;
      sp.visible = on;                     // a ring only on the control you are pointing at
      sp.material.opacity = 1;
      sp.scale.set(size * (on ? 1.1 : 1), size * (on ? 1.1 : 1), 1);
    });
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

  // where the sun and moon are: venue position and the clock
  setClock(ms, lat, lon) { this.skySys.setTime(ms, lat, lon); this.clockMs = ms; }

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
    tickGlow(performance.now() / 1000);
    // sky, sun or moon light, exposure, reflections; the shadow-casting light follows the player
    if (player) { this.skySys._px = player.x; this.skySys._pz = player.z; }
    const hz = this.skySys.update(this.camera, t, this.sun, this.hemi, this.overcastU.value);
    {
      // in rain the haze is a flat grey curtain, darker than the clear-air horizon
      const rf = Math.min(1, (this._rainFog || 0) * 1.3), gy = (0.3 * hz[0] + 0.55 * hz[1] + 0.15 * hz[2]) * (1 - 0.3 * rf);
      this.scene.fog.color.setRGB(hz[0] + (gy - hz[0]) * rf, hz[1] + (gy - hz[1]) * rf, hz[2] + (gy * 1.04 - hz[2]) * rf);
    }
    this.waterU.fogColor.value.copy(this.scene.fog.color);
    if (this._flash > 0) this.r.toneMappingExposure *= 1 + 2.5 * this._flash;   // lightning (the sky system resets exposure each frame)
    {
      const up = this.skySys.U.uAmbTop.value, sc = this.skySys.U.uSunCol.value;
      const l = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
      this.waterU.uAmbF.value = Math.max(0.004, Math.min(1.6, (l(up) + 0.5 * l(sc) * Math.max(this.skySys.lightV.y, 0)) / 0.97));
    }
    const Ld = this.skySys.lightDir || this.sunDir;
    if (this.town) {
      setSceneryNight(this.town, clamp((-this.sunDir.y + 0.02) / 0.12, 0, 1));
      const mw = env.wind.mean(t); tickScenery(this.town, t, mw.speed);
    }
    if (player) {
      this.sun.position.set(player.x + Ld.x * 60, Math.max(Ld.y, 0.05) * 60, player.z + Ld.z * 60);
      this.sun.target.position.set(player.x, 0, player.z);
    }
    // hull footprints for the water cut-out: the four boats nearest the camera
    {
      const U = this.waterU, list = [...this.boats.keys()].sort((a, c) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(c.x - cam.x, c.z - cam.z)).slice(0, 4);
      list.forEach((b, i) => {
        const C = b.cls, P = b.pose || b, cx = (C.bowX + C.sternX) / 2;
        const fx = Math.sin(P.psi), fz = -Math.cos(P.psi);
        U.uHullA.value[i].set(P.x + fx * cx, P.z + fz * cx, fx, -fz);
        U.uHullB.value[i].set((C.bowX - C.sternX) / 2 * 0.97, (C.hullBeam ?? C.beam) / 2 * 0.9 * Math.abs(Math.cos(P.phi)) + 0.02, C.multihull ? C.hullSpacing / 2 : 0, C.multihull ? 2 : 1);
      });
      U.uHullN.value = 0; // cut-out disabled
    }
    for (const [b, vis] of this.boats) {
      updateBoatModel(vis, b, t);
      // detail near the camera: ropes and crew IK only where they can be seen
      const dist = Math.hypot(b.x - cam.x, b.z - cam.z);
      const near = vis.player || dist < 150;
      vis.rigging.update(t, near, dt, env);
      const sp = vis.splash;
      sp.foam.visible = sp.sheet.visible = sp.points.visible = sp.patches.visible = near;
      if (near) sp.update(dt, t, env);
      this.wakes.get(b).update(b, env, t, dt);
    }
    this._updateSeaSpray(dt, t, env);
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
    const P = b.pose || b;
    const k = 1 - Math.exp(-dt * 8);
    // orbit the cockpit (tiller, sheets, winches), not the middle of the boat
    const C0 = b.cls, ckx = C0.sternX + C0.lwl * 0.22;
    const fx0 = Math.sin(P.psi), fz0 = -Math.cos(P.psi);
    const gx = P.x + fx0 * ckx, gz = P.z + fz0 * ckx;
    const far = Math.hypot(gx - c.tx, gz - c.tz) > 30;              // new session / teleport: snap, don't glide
    c.tx = far ? gx : lerp(c.tx, gx, k); c.tz = far ? gz : lerp(c.tz, gz, k);
    const bh = P.heave || 0;

    if (c.mode === 'chase' || c.mode === 'orbit') {
      if (c.mode === 'orbit') c.yaw += dt * 0.08;
      const yaw = c.yaw + (c.mode === 'chase' ? P.psi : 0);
      const d = c.dist;
      // a camera boat rides the swell slower than the yacht: follow the heave through a ~1.5 s low-pass so
      // the horizon does not bob with every wave, and never let the lens dip under the sea in front of it
      c.hs = c.hs === undefined || Math.abs(c.hs - bh) > 6 ? bh : c.hs + (bh - c.hs) * (1 - Math.exp(-dt / 1.5));
      const px = c.tx - Math.sin(yaw) * Math.cos(c.pitch) * d, pz = c.tz + Math.cos(yaw) * Math.cos(c.pitch) * d;
      let py = Math.max(1.2, c.hs + 2 + Math.sin(c.pitch) * d);
      if (env && env.waves && env.waves.height) {
        const floor = env.waves.height(px, pz, t) + 1.1 + 0.03 * d;   // rises at once, settles slowly
        c.floor = c.floor === undefined ? floor : Math.max(floor, c.floor + (floor - c.floor) * (1 - Math.exp(-dt * 3)));
        py = Math.max(py, c.floor);
      }
      cam.position.set(px, py, pz);
      cam.up.set(0, 1, 0);
      cam.lookAt(c.tx, lerp(c.hs, bh, 0.4) + C0.freeboard + 0.6, c.tz);
    } else if (c.mode === 'helm' || c.mode === 'bow' || c.mode === 'mast') {
      const vis = this.boats.get(b);
      const C = b.cls;
      // helmsman's eye: seated on the windward side at the aft end of the cockpit
      const sideW = Math.sign(b.crewY || 1), deckZ = vis.deckH(C.sternX + 0.9, sideW * 0.5);
      const local = c.mode === 'helm' ? new THREE.Vector3(sideW * Math.min(Math.abs(b.crewY) * 0.8 + 0.3, C.beam * 0.42), (C.id === 'blackwatch' ? vis.ck.sole + 0.47 : deckZ) + 0.75, -(C.sternX + (C.multihull ? 1.0 : 0.9)))
        : c.mode === 'bow' ? new THREE.Vector3(0, C.freeboard + 0.7, -(C.bowX - 0.3))
        : new THREE.Vector3(0.3, C.mastHeight + 0.4, -C.mastX + 0.5);
      vis.inner.updateMatrixWorld();
      const wp = local.applyMatrix4(vis.inner.matrixWorld);
      // a sailor's head and eyes steady the view: follow the boat's motion with a little lag
      const kk = 1 - Math.exp(-dt * 12);
      cam.position.lerp(wp, cam.position.distanceTo(wp) > 3 ? 1 : kk);
      const look = new THREE.Vector3(Math.sin(c.yaw - Math.PI) * Math.cos(c.pitch - 0.2) * 20, c.mode === 'mast' ? -8 : Math.sin(c.pitch - 0.25) * 20, -Math.cos(c.yaw - Math.PI) * Math.cos(c.pitch - 0.2) * 20);
      const target = look.applyMatrix4(vis.inner.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(vis.inner.getWorldQuaternion(new THREE.Quaternion()));
      cam.up.lerp(up.lerp(new THREE.Vector3(0, 1, 0), 0.5), kk).normalize(); // the inner ear keeps the horizon half-level
      this._look = this._look ? this._look.lerp(target, kk) : target.clone();
      cam.lookAt(this._look);
    } else if (c.mode === 'deck') {
      // close orbit around the cockpit for handling lines
      const vis = this.boats.get(b), C = b.cls;
      vis.inner.updateMatrixWorld();
      const focus = new THREE.Vector3(0, C.freeboard + 0.4, -(C.sternX + C.lwl * 0.35)).applyMatrix4(vis.inner.matrixWorld);
      const yaw = c.yaw + b.psi, d = Math.min(c.dist, 9);
      cam.position.set(focus.x - Math.sin(yaw) * Math.cos(c.pitch) * d, focus.y + Math.sin(c.pitch) * d + 0.5, focus.z + Math.cos(yaw) * Math.cos(c.pitch) * d);
      cam.up.set(0, 1, 0); cam.lookAt(focus);
    } else if (c.mode === 'top') {
      const fl = env.wind.flowDir();
      cam.position.set(c.tx - fl[0] * 0.01, 40 + c.dist * 3.5, c.tz - fl[1] * 0.01 + 0.01);
      cam.up.set(-fl[0], 0, -fl[1]); // wind comes from the top of the screen
      cam.lookAt(c.tx, 0, c.tz);
    }
    // depth precision: pull the near plane out as the camera backs off (a 5 cm near plane with a 30 km
    // far plane leaves decimetre depth steps at a kilometre: shore and sea z-fight and flicker)
    const camD = Math.hypot(cam.position.x - c.tx, cam.position.y - bh, cam.position.z - c.tz);
    const aboveSea = Math.max(0.3, cam.position.y - bh);          // never clip the water in front of a low camera
    const near = c.mode === 'helm' || c.mode === 'bow' || c.mode === 'mast' || c.mode === 'deck' ? 0.05 : clamp(Math.min(camD * 0.04, aboveSea * 0.3), 0.05, 25);
    if (Math.abs(near - cam.near) > 0.01 * cam.near) { cam.near = near; cam.updateProjectionMatrix(); }
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
    const across = new Float32Array(this.N * 2); for (let i = 0; i < this.N; i++) { across[2 * i] = 0; across[2 * i + 1] = 1; }
    g.setAttribute('across', new THREE.BufferAttribute(across, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uT: { value: 0 } },
      vertexShader: `attribute float alpha; attribute float across; varying float vA; varying float vX; varying vec2 vW;
        void main(){ vA = alpha; vX = across; vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT; varying float vA; varying float vX; varying vec2 vW; 
float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
// soft bubbly foam: cells of bubbles over a streaky base, sharpened by coverage
float foam(vec2 p, float t, float cover) {
  float n = fn(p * 3.0 + vec2(t * 0.3, 0.0)) * 0.5 + fn(p * 7.0 - vec2(0.0, t * 0.5)) * 0.3 + fn(p * 17.0 + t) * 0.2;
  float bub = smoothstep(0.35, 0.6, fn(p * 26.0 - t * 0.4)) * smoothstep(0.2, 0.5, fn(p * 9.0));
  float v = n * 0.75 + bub * 0.35;
  return smoothstep(1.0 - cover, 1.0 - cover + 0.35, v);
}

        void main(){
          float mid = 1.0 - abs(vX * 2.0 - 1.0);                 // denser in the middle of the wake, frayed edges
          float f = foam(vW * 0.8, uT, clamp(vA * 1.4 * (0.4 + 0.6 * mid), 0.0, 0.85));
          if (f < 0.01) discard;
          gl_FragColor = vec4(0.93, 0.96, 0.98, f * 0.8);
        }`,
    });
    this.mat = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.acc = 0;
    this._s = {};
  }
  update(b, env, t, dt) {
    this.mat.uniforms.uT.value = t;
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
