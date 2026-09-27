// Three.js renderer: sky, Gerstner ocean (same spectrum as the physics), real-map terrain, piers,
// lofted hulls, live sails (twist, camber, draft, luffing), telltales, wakes, marks, cameras.
import * as THREE from 'three';
import { DEG } from './env.js';
import { STRIP_F, REEF, clamp, lerp } from './physics.js';
import { buildBoatModel, updateBoatModel } from './models.js';
import './boats/detailed.js';      // (registers the detailed models of the classes in js/classes/)
import { Rigging, tickGlow } from './rigging.js';
import { buildStructures, indexFeatures, structureMask } from './structures.js';
import { HullSplash, SeaSpray, NOISE as FOAM_NOISE } from './splash.js';
import { HullWaves, KelvinLow, HW_GLSL, KW_GLSL, HW, roosterTail } from './hullwaves.js';
import { buildEngineModel, updateEngineModel } from './engine-model.js';
import { loadLand, buildTerrain, buildScenery, setSceneryNight, tickScenery } from './scenery.js';
import { SkySystem, SKY_LUT_GLSL, CLOUD_GLSL, withCloudShadows, sunPosition, MIST_U } from './sky.js';
import { strikes, flashAt, thunderDue, thunderBearing, boltSegments, convection, heatFromSun, mist, mistTau } from './wx.js';
import { SeamarkLayer } from './seamark-render.js';

const MAXW = 20;
const FOAM_N = 512;   // persistent-foam map resolution (texels a side)

// Gerstner components (same data as the physics): Wa = (dx, dz, k_base, omega_doppler), Wb = (A, Q, phase, omega)
// The coast (coastal.js, the same arrays WaveField.sample reads): per component a layer of tangent planes of its
// local phase and its amplitude factor, (P, Gx, Gz, K): phase = P + G.x, wavevector G — refraction, shoaling,
// shelter, diffraction and fetch — and at half resolution the waves the walls reflect. Depth from the chart
// texture (G channel, metres*8) for depth-limited breaking.
const WAVE_GLSL = /* glsl */`
uniform vec4 uWa[${MAXW}];
uniform vec4 uWb[${MAXW}];
uniform int uWn;
uniform float uTime;
uniform float uK2;   // second-order (Tayfun) coefficient k_m / 2: WaveField.update
// rogue groups (WaveField.rogueUniforms): per component (rs, rc) of groups 0 and 1; per group the focus and
// horizontal factor (A), direction and group speed (B), inverse window radii and on (C)
uniform vec4 uRg[${MAXW}]; uniform vec4 uRgA[2]; uniform vec4 uRgB[2]; uniform vec4 uRgC[2];
uniform vec4 uBrk; uniform vec2 uDm;   // breaking: (k-bar, S0, S1, lean), the sea's mean direction (WaveField.brk)
// a group's window here and now: (1 - u^2)^3 along its direction, across it and in time (env.js rgWin)
float rgWin(int e, vec2 x0) {
  vec4 C = uRgC[e]; if (C.w < 0.5) return 0.0;
  vec4 A = uRgA[e], B = uRgB[e];
  float dt = uTime - A.z, ut = dt * C.z;
  if (abs(ut) >= 1.0) return 0.0;
  vec2 r = x0 - A.xy - B.xy * (B.z * dt);
  vec3 u = vec3(dot(r, B.xy) * C.x, (r.y * B.x - r.x * B.y) * C.y, ut), q = 1.0 - u * u;
  if (q.x <= 0.0 || q.y <= 0.0) return 0.0;
  q = q * q * q; return q.x * q.y * q.z;
}
// component i with the rogue groups' share (rw: their windows here, rq: times their horizontal factor), per
// unit of its amplitude factor: (elevation, Hilbert partner, horizontal displacement, compression / k) — a
// group only changes each component's complex amplitude (WaveField._disp, sample)
vec4 wcomp(int i, float C, float S, vec2 rw, vec2 rq) {
  vec4 g = uRg[i]; vec4 b = uWb[i];
  float P = b.x + rw.x * g.x + rw.y * g.z, Qc = rw.x * g.y + rw.y * g.w;
  float Ph = b.y * (b.x + rq.x * g.x + rq.y * g.z), Qh = b.y * (rq.x * g.y + rq.y * g.w);
  return vec4(P * S + Qc * C, P * C - Qc * S, Ph * C - Qh * S, Ph * S + Qh * C);
}
// the forward lean of a breaking crest (WaveField._lean): (shift along uDm, d shift / d eta, compression it
// adds, breaking intensity B). e, hc: first-order height and Hilbert partner; g: grad e; T: Gerstner
// compression tensor (xx, xz, zz); Bd: depth-limited breaking
vec4 leanB(float e, float hc, vec2 g, vec3 T, float Bd) {
  float Ea = sqrt(e * e + hc * hc), B = max(smoothstep(uBrk.y, uBrk.z, uBrk.x * Ea), Bd);
  if (B <= 0.0 || e <= 0.0) return vec4(0.0, 0.0, 0.0, B);
  float ie = 1.0 / (Ea + 1e-3);
  float jd = 1.0 - (uDm.x * uDm.x * T.x + 2.0 * uDm.x * uDm.y * T.y + uDm.y * uDm.y * T.z);
  float c0 = uBrk.w * B * 2.0 * e * ie, Dl = c0 * dot(uDm, g);
  float f = Dl < 0.0 ? clamp((jd - 0.25) / -Dl, 0.0, 1.0) : 1.0;
  return vec4(uBrk.w * B * e * e * ie * f, c0 * f, Dl * f, B);
}
// the whitecap measure shared by the water and the persistent-foam pass: a z-score of crest compression
// (1 - Jacobian, long waves) plus the short waves riding them (which bits break). Scaled by the spread of
// every wave (T) though a pixel may resolve only some of them (R): the drawn part keeps its place in the
// distribution and the rest is returned as variance. R, T = (var 1-J, var Cs + 0.16 var Cd, cov(1-J, Cs))
vec2 crestZV(float J, float Csd, vec3 R, vec3 T) {
  float a = 0.5 / sqrt(T.x + 1e-5), b = 0.85 / sqrt(T.y + 1e-5);
  return vec2((a * (1.0 - J) + b * Csd) / 1.3, max(dot(vec3(a * a, b * b, 2.0 * a * b), T - R), 0.0) / 1.69);
}
float crestZ(float J, float sJ2, float Cs, float sS2, float Cd, float sd2) {
  vec3 T = vec3(sJ2, sS2 + 0.16 * sd2, 0.0); return crestZV(J, Cs + 0.4 * Cd, T, T).x;
}
// hash without sin() (whose precision varies by GPU and blocks up at large arguments), lattice wrapped
float hash(vec2 p){ p = mod(p, 4096.0); vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash2(vec2 p){ p = mod(p, 4096.0); vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0; }
// gradient noise scaled to value-noise statistics (mean 0.5, sd 0.23): value noise's flat spot at every
// lattice point showed thresholded foam as a mosaic of cells
float qn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f), b = dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), c = dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(hash2(i + vec2(1, 1)), f - vec2(1, 1));
  return clamp(0.5 + 1.28 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0); }
// fbm with octaves finer than the footprint w (in p units) replaced by their mean (no shimmer); v: the
// variance so taken out (what varies inside the pixel: qn's sd 0.23 times 1 - kept^2)
float sfbmV(vec2 p, float w, out float v){ float a = 0.55, s = 0.0, f = 1.0; mat2 r = mat2(0.8, -0.6, 0.6, 0.8); v = 0.0;
  for (int i = 0; i < 4; i++) { float k = smoothstep(0.8, 0.3, w * f); s += a * mix(0.5, qn(p), k); v += a * a * (1.0 - k * k) * 0.053;
    p = r * p * 2.1 + 3.7; f *= 2.1; a *= 0.5; } return s; }
float sfbmA(vec2 p, float w){ float v; return sfbmV(p, w, v); }
// E[smoothstep(c - h, c + h, x + u)] for u ~ N(0, v) left unresolved in the pixel: near enough a smoothstep
// of the same centre, its spread (sd 0.447 h) widened by u's. The pixel shows the mean foam cover of what it
// spans, not a threshold of the mean (which paints sharp blobs that thin out and vanish with distance)
float ssV(float c, float h, float x, float v){ float H = sqrt(h * h + 5.0 * v); return smoothstep(c - H, c + H, x); }
// Aerated white water of cover c (1: fresh and dense; toward 0: old and thinning) at noise coordinates p
// (footprint w, in p units). Patches of a domain-warped fbm (the warp folds its cells into ragged, self-similar
// clumps and filaments) with bubbly edges (a fine grain on the threshold, not a soft grey ramp), thinning as c
// falls into lace — the ridges of a finer warped fbm, and then only their filaments — as the foam ages and its
// bubbles burst. Detail finer than the pixel goes to its mean and variance (ssV), so far foam is its mean cover.
float aerated(vec2 p, float w, float c) {
  vec2 q = p + 1.3 * (vec2(sfbmA(p * 0.4 + vec2(1.7, 9.2), w * 0.4), sfbmA(p * 0.4 + vec2(8.3, 2.8), w * 0.4)) - 0.5);
  float vn, vm, vd, n = sfbmV(q, w, vn), m = sfbmV(q * 2.3 + vec2(4.4, 1.9), w * 2.3, vm);
  // (and the same again six times finer: foam is self-similar down to the bubbles)
  float d = sfbmV(q * 6.1 + vec2(9.9, 2.2), w * 6.1, vd) - 0.5; n += 0.4 * d; m += 0.5 * d; vn += 0.16 * vd; vm += 0.25 * vd;
  float gk = smoothstep(0.8, 0.3, w * 25.0), g = mix(0.5, qn(q * 25.0 + vec2(7.7, 3.3)), gk), vg = 0.053 * (1.0 - gk * gk) * 0.02;
  float ridge = 1.0 - abs(2.0 * m - 1.03);
  float clump = ssV(0.84 - 0.6 * c, 0.035, n + 0.25 * (g - 0.5), vn + 3.2 * vg);
  // (the lace fringes the clumps, where the old foam of their edges is bursting: not contour lines everywhere)
  float lace = ssV(0.9 - 0.3 * c, 0.05, ridge + 0.21 * (g - 0.5), 4.0 * vm + 2.3 * vg) * smoothstep(0.02, 0.2, c) * ssV(0.66 - 0.5 * c, 0.08, n, vn);
  // (dense foam is not a sheet either: the water shows through its finest grooves)
  float r2 = 1.0 - abs(2.0 * d - 0.03), k2 = smoothstep(0.8, 0.3, w * 6.1);
  return max(clump * mix(0.86, 0.72 + 0.28 * smoothstep(0.25, 0.75, r2), k2), lace * 0.75);
}
// the pixel's footprint on the water, an ellipse (eR: semi-axis along the line of sight, stretched by
// 1/sin of the grazing angle; eT: across it): its extent along a direction d...
float fpAlong(vec2 d, vec2 eR, vec2 eT){ return length(vec2(dot(d, eR), dot(d, eT))); }
// ...and its long axis in noise coordinates q = s * (x.fl, x.pr) (the octaves turn: a round filter)
float fpQ(vec2 s, vec2 eR, vec2 eT, vec2 fl, vec2 pr){
  vec2 r = s * vec2(dot(eR, fl), dot(eR, pr)), t = s * vec2(dot(eT, fl), dot(eT, pr));
  float F = dot(r, r) + dot(t, t), D = r.x * t.y - r.y * t.x;
  return sqrt(0.5 * (F + sqrt(max(F * F - 4.0 * D * D, 0.0)))); }
// z such that a normal variable exceeds it with probability p (p <= 0.5; Abramowitz-Stegun 26.2.23)
float invTail(float p){ float t = sqrt(-2.0 * log(max(p, 1e-6)));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1.0 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t); }
uniform sampler2D uSdf; uniform float uWorldR; uniform float uHasMap; uniform float uTide;
uniform highp sampler2DArray uCst; uniform highp sampler2DArray uCstR; uniform sampler2D uCstM;
uniform float uCstOn; uniform float uCstNR; uniform float uCstW; uniform vec2 uCstN; uniform float uCstRL[${MAXW}];
uniform float uShoreW;   // metres of shore over which the sea fades into the beach
float depthAt(vec2 x) {
  if (uHasMap < 0.5) return 99.0;
  vec4 s = texture2D(uSdf, (x + uWorldR) / (2.0 * uWorldR));
  return s.r * 255.0 - 128.0 > 0.0 ? max(0.05, s.g * 255.0 / 8.0 - 4.0 + uTide) : 0.05;   // (the bed from 4 m above MSL, under the tide)
}
// a coastal layer at x: the tangent planes bilinearly blended (CoastalField._blend), by the float filter or,
// where the GPU cannot filter floats, by hand from the four texels (CST_TEXEL)
vec4 cstFetch(highp sampler2DArray t, vec2 x, float layer, float n) {
  vec2 uv = (x + uCstW) / (2.0 * uCstW);
#ifdef CST_TEXEL
  vec2 f = uv * n - 0.5, i0 = floor(f), w = f - i0;
  ivec2 a = ivec2(clamp(i0, 0.0, n - 1.0)), b = ivec2(clamp(i0 + 1.0, 0.0, n - 1.0));
  int l = int(layer);
  vec4 c = mix(mix(texelFetch(t, ivec3(a.x, a.y, l), 0), texelFetch(t, ivec3(b.x, a.y, l), 0), w.x),
               mix(texelFetch(t, ivec3(a.x, b.y, l), 0), texelFetch(t, ivec3(b.x, b.y, l), 0), w.x), w.y);
#else
  vec4 c = textureLod(t, vec3(uv, layer), 0.0);
#endif
  return vec4(c.x + dot(c.yz, x), c.yzw);
}
// component i's local wave at x: (phase at t = 0 less its own constant, wavevector, amplitude factor)
vec4 cstInc(int i, vec2 x) {
  if (uCstOn < 0.5) { vec4 a = uWa[i]; return vec4(a.z * dot(a.xy, x), a.z * a.xy, 1.0); }
  return cstFetch(uCst, x, float(i), uCstN.x);
}
// ...and its reflection off the walls, where there is one (the mask spares the fetches in open water)
bool cstHasRef(vec2 x) { return uCstOn > 0.5 && uCstNR > 0.5 && textureLod(uCstM, (x + uCstW) / (2.0 * uCstW), 0.0).r > 0.0; }
vec4 cstRef(int i, vec2 x) { float l = uCstRL[i]; return l < 0.0 ? vec4(0.0, 1.0, 0.0, 0.0) : cstFetch(uCstR, x, l, uCstN.y); }
// the local limits on the summed waves (WaveField._limits): depth-limited breaking, the wave's height (twice its
// envelope) held to 0.78 h by a soft cap; the trochoids' steepness sum Q k A to 0.8. Returns (cap, qs, breaking)
vec3 seaLimits(float h, float e, float eH, float sK) {
  float cap = 1.0, r = 0.0;
  if (uHasMap > 0.5) { r = 2.0 * sqrt(e * e + eH * eH) / (0.78 * h); if (r > 0.3) cap = 1.0 / pow(1.0 + pow(r, 8.0), 0.125); }
  return vec3(cap, min(1.0, 0.8 / max(1e-6, sK * cap)), r);
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
    // float textures filter linearly on nearly every GPU; where not, the coastal layers are blended by hand
    this.cstLin = !!r.extensions.get('OES_texture_float_linear');
    this.cstDef = this.cstLin ? '' : '#define CST_TEXEL\n';
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
    const arr = (n) => { const t = new THREE.DataArrayTexture(new Float32Array(4 * n), 1, 1, n); t.format = THREE.RGBAFormat; t.type = THREE.FloatType; t.needsUpdate = true; return t; };
    this.cstTex = arr(MAXW); this.cstRTex = arr(1);
    this.cstMTex = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat); this.cstMTex.needsUpdate = true;
    const uniforms = {
      uWa: { value: Wa }, uWb: { value: Wb }, uWn: { value: 0 }, uTime: { value: 0 },
      uSunDir: { value: this.sunDir }, uCam: { value: new THREE.Vector3() }, uOffset: { value: new THREE.Vector2() },
      uGust: { value: this.gustTex }, uGustO: { value: new THREE.Vector2() }, uGustS: { value: 2048 },
      uSdf: { value: this.sdfTex }, uWorldR: { value: 6000 }, uHasMap: { value: 0 }, uTide: { value: 0 }, uOvercast: this.overcastU,
      uCst: { value: this.cstTex }, uCstR: { value: this.cstRTex }, uCstM: { value: this.cstMTex }, uCstOn: { value: 0 }, uCstNR: { value: 0 },
      uCstW: { value: 6000 }, uCstN: { value: new THREE.Vector2(1, 1) }, uCstRL: { value: new Array(MAXW).fill(-1) }, uShoreW: { value: 60 },
      uFlow: { value: new THREE.Vector2(0, 1) }, uWind: { value: 6 }, uK2: { value: 0 },
      uHs: { value: 0 }, uJSig: { value: 0.1 }, uLmin: { value: 4 },
      uRg: { value: Array.from({ length: MAXW }, () => new THREE.Vector4()) }, uRgA: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uRgB: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uRgC: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uBrk: { value: new THREE.Vector4(0, 0.2, 0.34, 0) }, uDm: { value: new THREE.Vector2(0, 1) },
      uFoam: { value: null }, uFoamC: { value: new THREE.Vector2() }, uFoamS: { value: 320 }, uFoamOff: { value: new THREE.Vector2() }, uFoamOn: { value: 0 },
      uDeep: { value: new THREE.Color(0x0a2f40) }, uShallow: { value: new THREE.Color(0x2e9c9a) },
      fogColor: { value: new THREE.Color(0xb7c8d4) }, fogDensity: { value: 0.00011 },
      uEnv: { value: this.skySys.cubeRT.texture }, uAmbF: { value: 1 }, uLightDir: { value: this.skySys.lightV }, uSkyRT: this.skySys.compU.uSkyTex, uSkyVP: this.skySys.marchDome.material.uniforms.uPrevVP,
    };
    // the sky's shared uniforms (table, clouds, sun colour) are the same objects
    for (const k of ['uSkyLUT', 'uLutDir', 'uNoise', 'uWeather', 'uWOff', 'uCover', 'uCloudBase', 'uCloudThick', 'uCloudTime', 'uCells', 'uSunCol']) uniforms[k] = this.skySys.U[k];
    // the boats' own waves (hullwaves.js): simulated on a grid around the player, or (?q=low, or no float
    // render targets) the analytic Kelvin pattern along each track
    this.hullWaves = this.low ? null : new HullWaves(THREE, this.r);
    if (this.hullWaves && !this.hullWaves.ok) this.hullWaves = null;
    this.kelvinLow = this.hullWaves ? null : new KelvinLow(THREE);
    Object.assign(uniforms, (this.hullWaves || this.kelvinLow).uniforms);
    const HWDEF = this.hullWaves ? `#define HWSIM\n${HW_GLSL}` : `#define HWKELVIN\n${KW_GLSL}`;
    this.waterU = uniforms;
    const m = new THREE.ShaderMaterial({
      uniforms, fog: false,
      vertexShader: /* glsl */`
        ${this.cstDef}${WAVE_GLSL}
        ${HWDEF}
        uniform vec2 uOffset; uniform vec3 uCam; uniform float uHs; attribute float spc;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore; varying float vBreak; varying vec2 vLim;
        void main(){
          vec2 x0 = position.xz + uOffset;
          float dist = length(x0 - uCam.xz);
          // (a giant sea keeps its long waves out to where the grid still draws them: no flat far sea in a storm)
          float fade = 1.0 - smoothstep(700.0 + 60.0 * uHs, 3200.0 + 250.0 * uHs, dist);
          float h = depthAt(x0);
          float shore = 1.0;
          if (uHasMap > 0.5) {
            float s = (texture2D(uSdf, (x0 + uWorldR) / (2.0 * uWorldR)).r * 255.0 - 128.0);
            shore = clamp(s / uShoreW, 0.08, 1.0);
          }
          // every wave here — each component and, off a wall, its reflection (coastal.js), with the rogue groups'
          // share — summed as WaveField.sample does; then the local limits (depth-limited breaking, the trochoids'
          // steepness), a breaking crest's lean, the second order and last the shore's fade
          bool hr = cstHasRef(x0);
          vec2 rw = vec2(rgWin(0, x0), rgWin(1, x0)), rq = rw * vec2(uRgA[0].w, uRgA[1].w), ge = vec2(0.0), D = vec2(0.0);
          vec3 Tj = vec3(0.0);                             // grad of the height, compression tensor: the lean
          float Y = 0.0, eH = 0.0, s2 = 0.0, sK = 0.0, a2 = 0.0;   // (Hilbert partner, trochoid self terms)
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            for (int r = 0; r < 2; r++) {
              if (r == 1 && !hr) break;
              vec4 cw = r == 0 ? cstInc(i, x0) : cstRef(i, x0);
              float kl = max(length(cw.yz), 1e-4); vec2 u = cw.yz / kl;
              float f = cw.w * fade * smoothstep(3.0 * spc, 6.0 * spc, 6.2832 / kl), th = cw.x - a.w * uTime + b.z;
              vec4 w = wcomp(i, cos(th), sin(th), rw, rq) * f;
              D += u * w.z; Y += w.x; eH += w.y; s2 += b.y * (w.y * w.y - w.x * w.x);
              ge += kl * u * w.y; Tj += kl * w.w * vec3(u.x * u.x, u.x * u.y, u.y * u.y);
              float A = b.x * f; sK += b.y * kl * A; a2 += A * A;
            }
          }
          vec3 L = seaLimits(h, Y, eH, sK);
          float cap = L.x, qs = L.y, cq = cap * qs;
          // breaking: this crest spilling (its height at the depth limit), and the surf zone's share of broken water
          vBreak = uHasMap > 0.5 ? max(smoothstep(0.85, 1.05, L.z), 0.6 * clamp(4.0 * sqrt(a2 * 0.5) / (0.78 * h) - 0.7, 0.0, 1.0)) : 0.0;
          vLim = vec2(cap, qs);
          vec2 Dh = cq * D + uDm * leanB(cap * Y, cap * eH, cap * ge, cq * Tj, vBreak).x;   // a breaking crest leans forward
          float Py = cap * Y + uK2 * cap * cap * (Y * Y - eH * eH + qs * s2);                  // second order
          vec3 P = vec3(x0.x + shore * Dh.x, shore * Py, x0.y + shore * Dh.y);
          // ---- hull waves (hullwaves.js), on top of the sea: the level of the field that this vertex
          // spacing can draw (the finer waves are left to the normals)
          #ifdef HWSIM
          P.y += hwAt(P.xz, max(log2(spc / ${(HW.L / HW.N).toFixed(4)}) - 0.5, 0.0)).x;
          #endif
          #ifdef HWKELVIN
          P.y += kwAt(P.xz).x;
          #endif
          vPos = P; vX0 = x0; vFade = fade; vShore = shore;
          gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
        }`,
      fragmentShader: /* glsl */`
        ${this.low ? '#define LOWQ' : ''}
        ${this.cstDef}${WAVE_GLSL}
        ${HWDEF}
        ${SKY_LUT_GLSL}
        ${CLOUD_GLSL}
        uniform vec3 uSunDir; uniform vec3 uSunCol; uniform samplerCube uEnv; uniform float uAmbF; uniform vec3 uLightDir; uniform sampler2D uSkyRT; uniform mat4 uSkyVP;
        uniform vec3 uCam; uniform sampler2D uGust; uniform vec2 uGustO; uniform float uGustS;
        uniform vec2 uFlow; uniform float uWind; uniform float uHs; uniform float uJSig; uniform float uLmin;
        uniform sampler2D uFoam; uniform vec2 uFoamC; uniform float uFoamS; uniform vec2 uFoamOff; uniform float uFoamOn;
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vPos; varying vec2 vX0; varying float vFade; varying float vShore; varying float vBreak; varying vec2 vLim;
        // value noise and its gradient (quintic): (v, dv/dx, dv/dy)
        vec3 qnd(vec2 p){ vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0), du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
          float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1)), e = a - b - c + d;
          return vec3(a + (b - a) * u.x + (c - a) * u.y + e * u.x * u.y, du * vec2(b - a + e * u.y, c - a + e * u.x)); }
        float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 x0 = vX0;
          float dist = length(vPos - uCam);
          // the pixel's footprint on the water (long at grazing angles): waves shorter than a few footprints
          // cannot be drawn as normals — they alias into moire — so they are filtered out and their slope
          // becomes roughness (a glossier reflection and a wider sun glitter), as a real sea does at a distance
          vec3 V0 = normalize(uCam - vPos);
          float fp = dist * 0.0022 / max(abs(V0.y), 0.06);
          float lost = 0.0;
          // the foam's footprint: the ellipse itself, stretched along the line of sight right down to grazing
          // (the drawn normals keep the gentler round one above: the geometry still carries those waves)
          vec2 rH = normalize(-V0.xz + 1e-5), eT = vec2(-rH.y, rH.x) * dist * 0.0022, eRf = rH * dist * 0.0022 / max(abs(V0.y), 0.01);
          // analytic Gerstner normal + Jacobian (crest sharpness) for whitecaps: the crests this pixel resolves
          // (R), and the spread of all of them (T) for the rest, which it can only show as a mean
          vec3 n = vec3(0.0, 1.0, 0.0); float J = 1.0, sJ2 = 0.0, Cs = 0.0, sS2 = 0.0, sC = 0.0, sJ2T = 0.0, sS2T = 0.0, sCT = 0.0, lostF = 0.0;
          float e1 = 0.0, eH = 0.0; vec2 gH = vec2(0.0), g2 = vec2(0.0);    // second order: height, Hilbert partner, slopes
          bool hr = cstHasRef(x0);
          vec2 rw = vec2(rgWin(0, x0), rgWin(1, x0)), rq = rw * vec2(uRgA[0].w, uRgA[1].w);
          vec3 Tj = vec3(0.0);
          float qs = vLim.y;                                                 // (the local steepness limit)
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            for (int r = 0; r < 2; r++) {
            if (r == 1 && !hr) break;
            vec4 cw = r == 0 ? cstInc(i, x0) : cstRef(i, x0);                // the local wave (coastal.js)
            float kw = max(length(cw.yz), 1e-4); vec2 u = cw.yz / kw;
            float th = cw.x - a.w * uTime + b.z, sh = cw.w * vLim.x * vShore;
            float WAt = kw * b.x * sh, WA0 = WAt * vFade;
            float att = smoothstep(fp * 2.0, fp * 6.0, 6.2832 / kw);
            lost += (1.0 - att) * WA0 * WA0 * 0.5;
            // (with the rogue groups' share: elevation, Hilbert partner, -, compression; the statistics below
            // stay the sea's own, so a group's crest stands out of them as the rare crest it is)
            vec4 w = wcomp(i, cos(th), sin(th), rw, rq); w.w *= qs;
            float fa = sh * vFade * att, kfa = kw * fa;
            n.x -= u.x * kfa * w.y; n.z -= u.y * kfa * w.y; n.y -= kfa * w.w;
            Tj += kfa * w.w * vec3(u.x * u.x, u.x * u.y, u.y * u.y);
            // resolved along its own direction (a crest seen end-on survives foreshortening) and only where
            // the geometry still draws it: no whitecap bands on a sea gone flat
            float fw = fpAlong(u, eRf, eT), sF = smoothstep(2.0 * fw, 6.0 * fw, 6.2832 / kw), WF = WA0 * sF;
            float jR = b.y * qs * WF, jT = b.y * qs * WAt, jS = kw * sh * vFade * sF * w.w;
            J -= jS; sJ2 += jR * jR * 0.5; sJ2T += jT * jT * 0.5; lostF += (WAt * WAt - WF * WF) * 0.5;
            float ws = smoothstep(80.0, 20.0, 6.2832 / kw);                  // the short waves break on the long crests
            Cs += ws * jS; sS2 += ws * ws * jR * jR * 0.5; sS2T += ws * ws * jT * jT * 0.5; sC += ws * jR * jR * 0.5; sCT += ws * jT * jT * 0.5;
            e1 += fa * w.x; eH += fa * w.y; gH += u * kfa * w.x; g2 -= u * 4.0 * b.y * qs * kfa * fa * w.x * w.y;
            }
          }
          // a breaking crest: its lean steepens the front face (WaveField._lean); lb.w, its intensity
          vec4 lb = leanB(e1, eH, -n.xz, Tj, vBreak);
          // the breaking crest's phase from the analytic signal (pi/2 at the crest, 0 halfway down the front
          // face, < 0 ahead of it) and, along the crest, how it varies: where it breaks harder, where the roller
          // runs further down the face (so no two stretches of a breaking crest look alike)
          float phB = atan(e1, -eH), acrB = dot(x0, vec2(-uDm.y, uDm.x)) * max(uBrk.x, 1e-3);
          float alB = qn(vec2(acrB * 0.7, 3.3)), phJ = phB + 0.35 * (qn(vec2(acrB * 1.9, 8.1)) - 0.5);
          n.y = max(n.y + lb.z, 0.05);
          // slope of eta2 = K2 (eta^2 - H^2 + Q-self): n.xz here is minus the first-order slope
          n.xz -= uK2 * (-2.0 * e1 * n.xz + 2.0 * eH * gH + g2);
          // ---- hull waves (hullwaves.js): their slope at full strength, filtered only by the pixel's own
          // (anisotropic) footprint, into the normal that the reflection, Fresnel and the sun's glint all use
          // (at the drawn, Eulerian, position: the field is laid in world coordinates)
          #ifdef HWSIM
          vec4 hwv = hwAtA(vPos.xz);
          n.xz -= hwv.yz;
          #endif
          #ifdef HWKELVIN
          vec3 kwv = kwAt(vPos.xz);
          n.xz -= kwv.yz;
          #endif
          // local wind (puffs + land shelter): the short waves answer it within seconds, so puffs read dark
          vec2 guv = (x0 - uGustO) / uGustS + 0.5;
          float gw = texture2D(uGust, guv).r * 2.0;
          float lw = uWind * gw;                                              // m/s
          // the spectrum continued below the shortest modelled wave, drawn as normals only (nothing the boat
          // would feel): equilibrium-range steepness, jittered wavelengths, fanned about the wind
          vec2 fl = uFlow, pr = vec2(-fl.y, fl.x);
          float wk = smoothstep(0.8, 6.0, lw) * sqrt(clamp(gw, 0.3, 2.0));
          // ---- hull waves: the short waves ride steeper on the wake's crests and flatter in its troughs
          // (hydrodynamic modulation, a ~ 1 + M k h, M ~ 10 for the short gravity waves), and the turbulent strip behind a hull damps
          // them for a minute or more (the slick: the foam map's third channel). This is what draws a wake's
          // crest lines at a distance, and the long smooth lane down its middle
          float hwMod = 1.0;
          #ifdef HWSIM
          hwMod = 1.0 + clamp(10.0 * uHWK * hwv.x, -0.8, 1.5);
          #endif
          #ifdef HWKELVIN
          hwMod = 1.0 + clamp(10.0 * 6.2832 / uKS[0].x * kwv.x, -0.8, 1.5);
          #endif
          #ifndef LOWQ
          { vec2 suv = (x0 - uFoamC) / uFoamS + 0.5;
            hwMod *= 1.0 - 0.85 * uFoamOn * textureLod(uFoam, suv, 1.0).b * (1.0 - smoothstep(0.4, 0.49, max(abs(suv.x - 0.5), abs(suv.y - 0.5)))); }
          #endif
          wk *= hwMod;
          float Cd = 0.0, sd2 = 0.0, sdR = 0.0, sdT = 0.0, wl = uLmin;
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
            float fw = fpAlong(d, eRf, eT), kAt = kA * vShore, kAf = kAt * smoothstep(2.0 * fw, 6.0 * fw, wj);
            kA *= att * vShore;
            float s = sin(ph), c = cos(ph);
            n.x -= d.x * kA * c; n.z -= d.y * kA * c; n.y -= 0.5 * kA * s;
            Cd += kAf * s; sd2 += kA * kA * 0.5; sdR += kAf * kAf * 0.5; sdT += kAt * kAt * 0.5; lostF += (kAt * kAt - kAf * kAf) * 0.5;
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
          float mssSub = max(0.0015, 0.003 + 0.00512 * lw - uJSig * uJSig - sd2) * 0.7 * hwMod * hwMod;
          float a2 = clamp(lost + mssSub, 2e-4, 0.5);
          // ---- hull waves: the reflectance their roughness change makes. A rough patch shows the eye facets
          // tilted both ways, and Fresnel is convex, so on average it reflects more sky at a low angle than a
          // smooth one: the wake's crest lines and its slick read as bright and dark bands (the difference
          // from the same water without the wake, so the sea elsewhere is untouched)
          #if defined(HWSIM) || defined(HWKELVIN)
          {
            float a20 = clamp(lost + mssSub / max(hwMod * hwMod, 1e-3), 2e-4, 0.5), sn = sqrt(max(1.0 - NdV * NdV, 0.0));
            #define FAV(s) (0.02 + 0.49 * (pow(1.0 - clamp(NdV - (s) * sn, 1e-3, 1.0), 5.0) + pow(1.0 - clamp(NdV + (s) * sn, 1e-3, 1.0), 5.0)))
            F = clamp(F + FAV(sqrt(a2)) - FAV(sqrt(a20)), 0.0, 1.0);
            #undef FAV
          }
          #endif
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
          // the lip of a breaking crest, thrown forward and thinned to a translucent sheet: turquoise light through
          // it (from the sky, and far more with the sun behind it), between the torn foam on it
          float lip = lb.w * smoothstep(0.25, 0.7, lb.w) * smoothstep(0.65, 0.95, phJ) * (1.0 - smoothstep(1.3, 1.55, phJ));   // (only where it really breaks)
          sss += vec3(0.04, 0.30, 0.25) * lip * (uAmbF * 0.35 + uSunCol * (0.2 + 1.6 * back) * (1.0 - 0.8 * uOvercast) * shadow * step(0.0, L.y));
          // ---- the persistent foam map (read once: whitecap foam, wake foam, -, the wake's aeration)
          float pm = 0.0; vec4 PP = vec4(0.0);
          #ifndef LOWQ
          vec2 fuv = (x0 - uFoamC) / uFoamS + 0.5;
          pm = uFoamOn * (1.0 - smoothstep(0.36, 0.48, max(abs(fuv.x - 0.5), abs(fuv.y - 0.5))));
          if (pm > 0.0) {
            // cubic B-spline read (4 bilinear taps): plain bilinear leaves its texel creases in the thresholded
            // foam as straight edges and diamonds
            // foam, and once a texel is smaller than the footprint the map's mip level for it (a texel's
            // mean, not whichever texel the pixel centre hits); explicit levels, as the taps jump per texel
            float lodF = log2(max(length(eRf) * ${FOAM_N}.0 / uFoamS, 1e-3));
            if (lodF < 0.5) {
              vec2 tp = fuv * ${FOAM_N}.0 - 0.5, ti = floor(tp), tf = tp - ti, tf2 = tf * tf, tf3 = tf2 * tf;
              vec2 w0 = (1.0 - 3.0 * tf + 3.0 * tf2 - tf3) / 6.0, w1 = (4.0 - 6.0 * tf2 + 3.0 * tf3) / 6.0, w3 = tf3 / 6.0, g0 = w0 + w1, g1 = 1.0 - g0;
              vec2 h0 = (ti - 0.5 + w1 / g0) / ${FOAM_N}.0, h1 = (ti + 1.5 + w3 / g1) / ${FOAM_N}.0;
              PP = g0.y * (g0.x * textureLod(uFoam, h0, 0.0) + g1.x * textureLod(uFoam, vec2(h1.x, h0.y), 0.0))
                 + g1.y * (g0.x * textureLod(uFoam, vec2(h0.x, h1.y), 0.0) + g1.x * textureLod(uFoam, h1, 0.0));
            }
            if (lodF > -0.5) PP = mix(PP, textureLod(uFoam, fuv, max(lodF, 0.0)), clamp(lodF + 0.5, 0.0, 1.0));
            PP *= pm;
          }
          // ---- a wake's bubble cloud: aerated water under the surface, not paint on it. Bubbles backscatter,
          // so the water body turns a bright green-turquoise, whiter where the void fraction is highest,
          // translucent (the sea's reflection stays over it) and streaky with the turbulence. Fresh behind
          // a transom it is nearly white; within a boat length or two (3-5 s) it has faded to a pale green
          // lane, then to nothing
          if (PP.w > 0.02) {
            vec2 xa = x0 - uFoamOff;
            float va, na = sfbmV(xa * 0.9 + 4.1, length(eRf) * 0.9, va), vb2, nb = sfbmV(xa * 2.7 - 1.3, length(eRf) * 2.7, vb2);
            float a = PP.w * (0.6 + 0.55 * na + 0.35 * (nb - 0.5));
            vec3 lit = uAmbF * (0.62 + 0.25 * shadow) + uSunCol * (0.2 + 0.25 * NdL) * shadow;
            vec3 bub = mix(vec3(0.16, 0.46, 0.44), vec3(0.62, 0.78, 0.76), smoothstep(0.35, 1.2, a)) * lit;
            body = mix(body, bub, clamp(0.85 * smoothstep(0.08, 0.8, a), 0.0, 0.9));
            sss *= 1.0 - clamp(a, 0.0, 1.0);
            // the churned surface at the freshest part: froth, broken up
            PP.y = max(PP.y, smoothstep(0.55, 1.3, a) * 0.9);
          }
          #endif
          vec3 col = mix(body + sss, refl, F) + uSunCol * spec * 1.5;
          // ---- whitecaps and foam, Beaufort coverage from the wind (Monahan: W = 3.84e-6 U^3.41), placed
          // on the steepest crests: a z-score of crest compression (1 - Jacobian) against its local spread
          // (past storm force Monahan's fit is beyond its data; at hurricane force the sea is white: Beaufort 12)
          float Wc = clamp(3.84e-6 * pow(max(lw, 0.0), 3.41), 0.0, mix(0.3, 0.55, smoothstep(25.0, 34.0, lw)));
          // long waves say where (their crests), the short waves riding them say exactly which bits break
          vec2 zv = crestZV(J, Cs + 0.4 * Cd, vec3(sJ2, sS2 + 0.16 * sdR, sC), vec3(sJ2T, sS2T + 0.16 * sdT, sCT));
          float zc = zv.x;
          // foam texture is fixed in the water (x0 is the undisplaced, Lagrangian position): it rides the
          // orbital motion of the waves and moves with their mean (Stokes) drift, as the foam pass does
          vec2 xd = x0 - uFoamOff;
          vec2 sw = vec2(dot(xd, uFlow), dot(xd, vec2(-uFlow.y, uFlow.x)));    // (downwind, across)
          // the detail finer than the footprint goes to its mean and its variance (v*) into the thresholds:
          // far water shows the mean cover of what each pixel spans (a whitening, as the sea is seen from
          // afar), not a sharp pattern that shimmers and then fades to nothing
          vec2 q = vec2(sw.x * 0.28, sw.y * 0.6);
          float fq = fpQ(vec2(0.28, 0.6), eRf, eT, fl, pr), v1, v2;
          float f1 = sfbmV(q, fq, v1), f2 = sfbmV(q * 3.1 + 7.1, fq * 3.1, v2);
          float lace = ssV(0.5, 0.18, f1 * 0.6 + f2 * 0.4, 0.36 * v1 + 0.16 * v2);
          float foam = 0.0, foamFlat = 0.0;       // foam on the crests (whitecaps, breakers) and lying flat (streaks, old foam)
          // persistent foam around the player (the foam pass: whitecaps that linger, drift and gather into
          // windrows; a wake's lace): dense while fresh, thinning to a lace of bubbles as it decays
          float pers = 0.0;
          #ifndef LOWQ
          if (pm > 0.0) {
            // (aerated: fresh foam dense, thinning into lace and filaments as it decays)
            pers = PP.x > 0.003 ? aerated(q * 1.8 + vec2(3.3, 7.1), fq * 1.8, 0.4 * PP.x) * 0.9 * pm : 0.0;
            // a wake's surface foam: bubbles surfacing out of its cloud leave a lace — a network of thin
            // strands around clear cells (the ridges of a multi-octave noise, cells ~0.3-1 m, not stretched
            // by the wind), thickening into patches only where it is fresh, thinning and breaking up into
            // scraps as it ages
            if (PP.y > 0.01) {
              float fw1 = length(eRf), vA, nA = sfbmV(xd * 1.3 + vec2(3.7, 1.1), fw1 * 1.3, vA), vB, nB = sfbmV(xd * 3.4 - 2.2, fw1 * 3.4, vB);
              float rdg = abs(0.6 * nA + 0.4 * nB - 0.5) * 2.0, vr = 4.0 * (0.36 * vA + 0.16 * vB);
              float wl = 0.03 + 0.5 * PP.y * PP.y;
              float strand = 1.0 - ssV(wl, 0.04, rdg, vr);
              // scattered: only patches of the lane carry it, fewer as it thins (a scrap here, a streak there)
              float vp, pa = sfbmV(xd * 0.4 + vec2(9.3, 2.9), fw1 * 0.4, vp);
              float scrap = ssV(0.7 - 1.2 * PP.y, 0.12, pa, 2.0 * vp);
              pers = max(pers, strand * scrap * smoothstep(0.01, 0.15, PP.y) * (0.4 + 0.35 * ssV(0.45, 0.2, nB, vB)) * pm);
            }
          }
          #endif
          // gale streak rows: across-wind coordinate, meandering (and its change per pixel, outside any branch)
          float ya = sw.y + 14.0 * (qn(sw * vec2(0.005, 0.012)) - 0.5) + 4.0 * (qn(sw * vec2(0.025, 0.05) + 5.0) - 0.5);
          float fwY = length(vec2(dFdx(ya), dFdy(ya)));
          if (Wc > 2e-4) {
            float zA = invTail(0.4 * Wc);                                      // active breaking crests
            // (the crests a pixel cannot resolve still break: their variance zv.y widens the threshold, so a
            // far crest carries its share of the whitecaps and the flat far sea the mean of them all)
            // (their cover, and the whitecap itself aerated white water, dense where it breaks hardest and lacy at
            // its edges: a crest far past the threshold, a rogue's, is still torn foam and not paint)
            float cw = ssV(zA + 0.1, 0.35, min(zc, zA + 0.9) + (f1 - 0.5) * 1.2 + (f2 - 0.5) * 0.5, zv.y + 1.44 * v1 + 0.25 * v2);   // (in patches along a crest, not along all of it)
            float act = cw > 0.003 ? aerated(q, fq, 0.5 * cw) : 0.0;                 // (aerated's cover is ~1.2 c)
            // residual foam: thinning lace around the crests, and (beyond the foam pass) patches of old foam
            float vb, big = sfbmV(sw * vec2(0.02, 0.05) + vec2(0.0, 3.3), fpQ(vec2(0.02, 0.05), eRf, eT, fl, pr), vb);
            float thrB = 0.5 + 0.12 * invTail(clamp(0.6 * Wc, 1e-4, 0.5));
            float resid = max(ssV(zA - 0.3, 0.3, zc, zv.y), ssV(thrB + 0.025, 0.055, big, vb) * (1.0 - pm)) * 0.35 * lace;
            // gale: foam blown into streaks along the wind (Beaufort 8 and up): narrow lines, rows ~9 m apart (and
            // from Beaufort 9 a second, fainter family between them) that meander; each line wanders a little
            // along its length, varies in width (a hand's breadth to a metre), and is beaded and broken by warped
            // noise into runs, clots and gaps of 2-30 m, its edges bubbly. Filtered across the pixel (a far line
            // spreads and dims, keeping its cover) and along the wind (a far run is its mean density)
            float st = smoothstep(13.0, 24.0, lw), hur = smoothstep(25.0, 34.0, lw);
            float fx = fpAlong(fl, eRf, eT), streak = 0.0;
            #ifdef LOWQ
            const int NFAM = 1;
            #else
            const int NFAM = 2;
            #endif
            for (int fam = 0; fam < NFAM; fam++) {
              if (st <= 0.0) break;
              float sp = fam == 0 ? 9.0 : 5.3, amp = fam == 0 ? 1.0 : 0.6 * smoothstep(17.0, 24.0, lw);
              if (amp <= 0.0) break;
              float yb = ya + (fam == 0 ? 0.0 : 2.9);
              float row = floor(yb / sp), fy = yb - sp * (row + 0.3 + 0.4 * hash(vec2(row, 3.7 + float(fam))));
              float rh = hash(vec2(row, 1.9 + float(fam))) * 97.0 + 0.5;          // this line's own noise (off the lattice)
              float kw1 = smoothstep(0.8, 0.3, fx * 0.07), kw2 = smoothstep(0.8, 0.3, fx * 0.3);
              float wob = 0.9 * (mix(0.5, qn(vec2(sw.x * 0.07, rh + 1.3)), kw1) - 0.5) + 0.3 * (mix(0.5, qn(vec2(sw.x * 0.3, rh + 2.1)), kw2) - 0.5);
              float fy2 = fy - wob, wq = mix(0.5, qn(vec2(sw.x * 0.04, rh)), smoothstep(0.8, 0.3, fx * 0.04));
              float wdt = (0.06 + 0.3 * wq * wq) * (1.0 + 0.5 * hur);              // half-width, m
              float we = sqrt(wdt * wdt + 0.36 * fwY * fwY);
              float prof = exp(-fy2 * fy2 / (we * we)) * wdt / we;
              float vd, wx = sfbmA(vec2(sw.x * 0.05 + 3.1, rh * 1.7), fx * 0.05) - 0.5;
              float d = sfbmV(vec2(sw.x * 0.12 + 2.0 * wx, rh * 2.3 + fy2 * 0.4), fx * 0.12, vd);
              float kg = smoothstep(0.8, 0.3, fx * 1.1), gr = mix(0.5, qn(vec2(sw.x * 1.1 + 5.0, fy2 * 1.1 + rh)), kg);
              float vd2, d2 = sfbmV(vec2(sw.x * 0.45 + 7.0, rh * 3.1 + fy2 * 1.3), fx * 0.45, vd2);   // broken again at 1-3 m
              float dens = ssV(0.55 - 0.05 * hur, 0.05, 0.7 * d + 0.3 * d2 + 0.1 * (gr - 0.5), 0.49 * vd + 0.09 * vd2 + 0.053 * 0.01 * (1.0 - kg * kg));
              float runs = 0.6 + 0.4 * ssV(0.5, 0.2, sfbmA(vec2(sw.x * 0.02, rh + 0.5), fx * 0.02), 0.0);
              // once the footprint spans rows the neighbours' lines fall in it too: their mean cover
              float mean = 1.77 * wdt / sp * 0.5 * 0.8;
              // (the line itself bubbly, clotted and holed along its core, not a glossy ribbon: a fine grain on it)
              float vb2, bub = sfbmV(vec2(sw.x * 0.6, fy2 * 1.2 + rh * 3.7), max(fx * 0.6, fwY * 1.2), vb2);
              float cS = prof * dens * runs, sf = cS * (0.45 + 0.55 * ssV(0.47, 0.1, bub, vb2));
              streak = max(streak, amp * mix(sf, mean, smoothstep(0.5 * sp, sp, fwY)));
            }
            streak *= st * (0.55 + 0.45 * lace);
            // (a breaking crest churns the streaks it runs over into its own white water, and a steep compressed
            // face tears them up: they lie on the gentler slopes between)
            foam = max(act, resid); foamFlat = streak * (0.8 + 0.2 * hur) * (1.0 - smoothstep(0.05, 0.35, lb.w)) * smoothstep(0.35, 0.75, J);
          }
          foamFlat = max(foamFlat, pers);
          // depth-limited breaking on real bathymetry
          foam = max(foam, ssV(1.125 - vBreak * 0.9, 0.125, f1 * 0.7 + f2 * 0.3, 0.49 * v1 + 0.09 * v2) * vBreak);
          // ---- a breaking crest: white water by the wave's phase, so it rides the crest rather than the water:
          // a dense roller over the crest's top, the translucent lip ahead of it torn by foam, the plunge where
          // the jet lands a little down the face, exploding white and pouring down to there, but no further (the
          // broken water rides with the crest; nothing breaks ahead of it); behind the crest the foam it has left,
          // thinning into lace over the back of the wave. Its texture is fixed in the water (metres across the
          // crest and along it, a little stretched along it), churning with time; the
          // whole varies along the crest (alB, phJ)
          float fshade = 1.0;
          if (lb.w > 0.01) {
            float kb = max(uBrk.x, 1e-3), sc = kb * 5.0;
            float roll = 0.85 * smoothstep(1.25, 1.5, phJ) * (1.0 - smoothstep(1.9, 2.15, phJ));
            float lipc = 0.35 * smoothstep(0.6, 0.9, phJ) * (1.0 - smoothstep(1.4, 1.6, phJ));
            float plng = 0.75 * smoothstep(0.15, 0.45, phJ) * (1.0 - smoothstep(0.65, 0.95, phJ));
            float cov = max(max(roll, 0.35 * smoothstep(3.2, 2.0, phJ) * smoothstep(1.6, 1.9, phJ)), max(lipc, plng)) * (0.65 + 0.35 * alB) * lb.w;
            // (a constant stretch: a scale varying with the phase, multiplying coordinates kilometres from the origin,
            // squeezed the noise into contour lines)
            vec2 bp = vec2(acrB * 5.0, dot(x0, uDm) * sc * 0.75 + uTime * 0.05);
            float bw = max(fpAlong(vec2(-uDm.y, uDm.x), eRf, eT), fpAlong(uDm, eRf, eT)) * sc;   // (the footprint's long axis: no aliasing)
            foam = max(foam, aerated(bp, bw, cov));
            // lit and shadowed clumps: the foam is a heap, not a sheet
            fshade = mix(1.0, 0.88 + 0.12 * smoothstep(0.3, 0.7, sfbmA(bp * 0.7 + vec2(5.5, 1.1), bw * 0.7)), smoothstep(0.1, 0.5, cov));
          }
          #ifdef HWKELVIN
          foam = max(foam, smoothstep(0.07, 0.2, length(kwv.yz)) * smoothstep(0.0, 0.03, kwv.x) * 0.5 * lace);   // the steep crests of the wake, whitened
          #endif
          // up close foam is bubbles and holes, not paint (faded out before the bubbles shrink to a pixel)
          #ifndef LOWQ
          float gfp = length(eRf) * 3.0;
          float grain = sfbmA(mat2(0.8, 0.6, -0.6, 0.8) * xd * 3.0, gfp);
          float gm = mix(1.0, smoothstep(0.25, 0.6, grain) * 1.4, 0.6 * smoothstep(0.6, 0.15, gfp));   // x1.4: its mean, 1
          foam *= gm; foamFlat *= gm;
          #endif
          // at a grazing angle the waves no pixel draws hide their own troughs (Smith masking, from the slope
          // variance lostF + mssSub) but not the crests that carry the foam: a sight line skims 1/G1 = 1 + L
          // of surface for each unit it sees, and sees white where any crest it grazes is white (at most 4
          // deep: the foam lies on the crest's face, not only on its top)
          float nu = abs(V0.y) / max(length(V0.xz), 1e-4) / sqrt(lostF + mssSub + 1e-4);
          float Lam = nu < 1.6 ? (1.0 - 1.259 * nu + 0.396 * nu * nu) / (3.535 * nu + 2.181 * nu * nu) : 0.0;
          foam = 1.0 - pow(1.0 - clamp(foam, 0.0, 0.99), min(1.0 + Lam, 4.0));
          foam = max(foam, foamFlat);             // (foam lying flat is not heaped on the crests the sight line grazes)
          vec3 foamCol = vec3(0.9, 0.94, 0.96) * fshade * (uAmbF * (0.72 + 0.2 * shadow) + uSunCol * 0.25 * NdL * shadow);
          col = mix(col, foamCol, clamp(foam, 0.0, 0.92));
          // shoreline surf
          if (uHasMap > 0.5) {
            float band = smoothstep(9.0, 0.0, sd) * (0.55 + 0.45 * sin(sd * 1.2 - uTime * 1.6 + vnoise(x0 * 0.1) * 6.0));
            col = mix(col, vec3(0.92, 0.95, 0.96) * uAmbF, clamp(band * 0.8, 0.0, 0.85));
          }
          float fogF = 1.0 - exp(-pow(fogDensity * dist, 2.0));
          col = mix(col, skyColor(normalize(vec3(-V.x, 0.02, -V.z))), clamp(fogF, 0.0, 1.0));
          col = mix(uMistCol, col, exp(-mistTau(uCam, vPos)));   // mist / sea fog (sky.js MIST_GLSL)
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(g, m);
    this.water.frustumCulled = false;
    this.scene.add(this.water);
    if (!this.low) this._buildFoam();
  }

  // Persistent foam: a map of how much foam the water carries, FN^2 texels over uFoamS metres around the
  // player, in undisplaced (Lagrangian) water coordinates so the water shader's foam rides the orbital
  // motion. Each frame the old foam is carried by the waves' Stokes drift and by Langmuir cells' cross-wind
  // convergence (which gathers it into the same windrows the water draws as gale streaks), spreads a
  // little and fades over 5-15 s; new foam comes from the breaking crests (the water shader's whitecap
  // measure) and from the boats' sterns. ?q=low goes without (procedural old foam and the wake ribbon).
  _buildFoam() {
    // mipmapped: the water reads the level that matches a far pixel's footprint (this pass reads level 0)
    const mk = () => new THREE.WebGLRenderTarget(FOAM_N, FOAM_N, { type: THREE.HalfFloatType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: false });
    this.foamRT = [mk(), mk()]; this.foamI = 0; this.foamT = null;
    const U = this.waterU, v6 = () => [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4());
    const fu = { uPrev: { value: null }, uCp: { value: new THREE.Vector2() }, uDt: { value: 0 }, uDrift: { value: new THREE.Vector2() }, uLang: { value: 0 }, uKeep: { value: 0 }, uWake: { value: v6() }, uWakeW: { value: v6() } };
    for (const k of ['uWa', 'uWb', 'uWn', 'uTime', 'uK2', 'uRg', 'uRgA', 'uRgB', 'uRgC', 'uBrk', 'uDm', 'uSdf', 'uWorldR', 'uHasMap', 'uTide', 'uCst', 'uCstR', 'uCstM', 'uCstOn', 'uCstNR', 'uCstW', 'uCstN', 'uCstRL', 'uShoreW', 'uGust', 'uGustO', 'uGustS', 'uFlow', 'uWind', 'uFoamC', 'uFoamS', 'uFoamOff', 'uHW', 'uHWC']) if (U[k]) fu[k] = U[k];
    this.foamU = fu;
    const mat = new THREE.ShaderMaterial({
      uniforms: fu, depthTest: false, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        ${this.cstDef}${WAVE_GLSL}
        ${this.hullWaves ? '#define HWSIM\n' + HW_GLSL : ''}
        uniform sampler2D uPrev; uniform vec2 uCp; uniform float uDt; uniform vec2 uDrift; uniform float uLang; uniform float uKeep;
        const float uTexel = 1.0 / ${FOAM_N}.0;
        uniform vec4 uWake[6]; uniform vec4 uWakeW[6];          // stern paths this frame (x0a, z0a, x0b, z0b); (half-width, strength)
        uniform sampler2D uGust; uniform vec2 uGustO; uniform float uGustS; uniform vec2 uFlow; uniform float uWind;
        uniform vec2 uFoamC; uniform float uFoamS; uniform vec2 uFoamOff;
        varying vec2 vUv;
        void main(){
          vec2 p = uFoamC + (vUv - 0.5) * uFoamS, cell = vec2(uFoamS * uTexel);
          float hd = depthAt(p), shore = 1.0;
          if (uHasMap > 0.5) shore = clamp((texture2D(uSdf, (p + uWorldR) / (2.0 * uWorldR)).r * 255.0 - 128.0) / uShoreW, 0.08, 1.0);
          // crest compression as the water shader measures it (waves shorter than the map resolves left out),
          // with the rogue groups and under the same local limits; where the depth breaks the waves, their crests
          bool hr = cstHasRef(p);
          vec2 rw = vec2(rgWin(0, p), rgWin(1, p)), rq = rw * vec2(uRgA[0].w, uRgA[1].w);
          float J = 0.0, sJ2 = 0.0, Cs = 0.0, sS2 = 0.0, e1 = 0.0, eH = 0.0, sK = 0.0;
          for (int i = 0; i < ${MAXW}; i++) { if (i >= uWn) break;
            vec4 a = uWa[i]; vec4 b = uWb[i];
            for (int r = 0; r < 2; r++) {
              if (r == 1 && !hr) break;
              vec4 cw = r == 0 ? cstInc(i, p) : cstRef(i, p);
              float kw = max(length(cw.yz), 1e-4), th = cw.x - a.w * uTime + b.z;
              float fa = cw.w * shore * smoothstep(2.0 * cell.x, 4.0 * cell.x, 6.2832 / kw), WA = kw * b.x * fa;
              vec4 w = wcomp(i, cos(th), sin(th), rw, rq);
              J += kw * fa * w.w; sJ2 += b.y * b.y * WA * WA * 0.5;
              float ws = smoothstep(80.0, 20.0, 6.2832 / kw);
              Cs += ws * kw * fa * w.w; sS2 += ws * ws * b.y * b.y * WA * WA * 0.5;
              e1 += cw.w * w.x; eH += cw.w * w.y; sK += b.y * kw * b.x * cw.w;
            }
          }
          vec3 Lm = seaLimits(hd, e1, eH, sK);
          float cq = Lm.x * Lm.y;
          J = 1.0 - cq * J; sJ2 *= cq * cq; Cs *= cq; sS2 *= cq * cq; e1 *= Lm.x * shore; eH *= Lm.x * shore;
          // a breaking crest (WaveField._lean's B) leaves a sheet of foam on the water it has run over
          float Ea = sqrt(e1 * e1 + eH * eH), ph = atan(e1, -eH);
          float brk = smoothstep(uBrk.y, uBrk.z, uBrk.x * Ea); brk *= brk * smoothstep(0.6, 1.0, ph) * (1.0 - smoothstep(1.7, 2.1, ph));
          float lw = uWind * texture2D(uGust, (p - uGustO) / uGustS + 0.5).r * 2.0;
          // (past storm force Monahan's fit is beyond its data; at hurricane force the sea is white: Beaufort 12)
          float Wc = clamp(3.84e-6 * pow(max(lw, 0.0), 3.41), 0.0, mix(0.3, 0.55, smoothstep(25.0, 34.0, lw)));
          vec2 xd = p - uFoamOff, pr = vec2(-uFlow.y, uFlow.x);
          vec2 sw = vec2(dot(xd, uFlow), dot(xd, pr));
          float f1 = sfbmA(vec2(sw.x * 0.28, sw.y * 0.6), cell.x * 0.28);
          float act = Wc > 2e-4 ? smoothstep(invTail(0.4 * Wc) - 0.15, invTail(0.4 * Wc) + 0.4, crestZ(J, sJ2, Cs, sS2, 0.0, 0.0) + (f1 - 0.5) * 1.1) : 0.0;
          // spilling breakers in the surf zone leave their foam behind them
          act = max(act, uHasMap * smoothstep(0.85, 1.1, Lm.z) * (0.6 + 0.4 * f1));
          // Langmuir windrows: cross-wind convergence onto the water shader's streak lines (same rows)
          float ya = sw.y + 14.0 * (qn(sw * vec2(0.005, 0.012)) - 0.5) + 4.0 * (qn(sw * vec2(0.025, 0.05) + 5.0) - 0.5);
          float row = floor(ya / 9.0), fy = ya - 9.0 * (row + 0.3 + 0.4 * hash(vec2(row, 3.7)));
          // (the cells are not uniform along a row: they gather foam in runs tens of metres long, with gaps)
          float rh = hash(vec2(row, 1.9)) * 97.0 + 0.5, lz = smoothstep(0.35, 0.65, sfbmA(vec2(sw.x * 0.025, rh), 0.0));
          vec2 v = uDrift - pr * uLang * lz * clamp(fy / 3.0, -1.0, 1.0);
          float conv = abs(fy) < 3.0 ? uLang * lz / 3.0 : 0.0;
          // carried foam (semi-Lagrangian), spreading (the wake, r g, faster: its turbulence widens it);
          // nothing comes in from beyond the map
          vec2 uv = (p - v * uDt - uCp) / uFoamS + 0.5, e = vec2(uTexel, 0.0);
          // r: whitecap foam; g: the wake's surface foam (the lace the bubbles leave as they surface); b: the
          // wake's slick (the turbulent strip that smooths the short waves long after its foam is gone);
          // a: the wake's aeration (the bubble cloud's void fraction, 1 fresh behind a transom at ~6 kn)
          vec4 old = vec4(0.0);
          if (uKeep > 0.5 && all(greaterThan(uv, e.xx)) && all(lessThan(uv, 1.0 - e.xx))) {
            vec4 c = textureLod(uPrev, uv, 0.0);
            vec4 nb = textureLod(uPrev, uv + e.xy, 0.0) + textureLod(uPrev, uv - e.xy, 0.0) + textureLod(uPrev, uv + e.yx, 0.0) + textureLod(uPrev, uv - e.yx, 0.0);
            // spreading: the wake's turbulence widens its bubble cloud (D ~ 0.1 m^2/s: ~1.3 m in 8 s)
            old = c + (nb - 4.0 * c) * min(vec4(0.2), vec4(0.08, 0.1, 0.3, 0.1) * uDt / (cell.x * cell.x));
          }
          float tau = 3.0 + 6.0 * qn(xd * 0.04 + 1.3);                   // e-folding, patchy: gone in ~5-15 s
          // the bubbles rise out in 3-5 s (the cloud's void fraction e-folds: patchy), the scraps of foam they
          // leave on the surface pop in ~5 s
          float tauA = 3.0 + 2.0 * qn(xd * 0.3 + 7.7);
          old *= exp(-uDt / vec4(tau, 5.0, 70.0, tauA)) * vec4(1.0 + conv * uDt, 1.0 + conv * uDt, 1.0, 1.0);
          float src = (act * 2.0 + brk * 2.0) * uDt, slk = 0.0, aer = 0.0;   // ~0.5 s of breaking to full cover
          for (int i = 0; i < 6; i++) {
            vec4 w = uWake[i]; vec4 ww = uWakeW[i];
            if (ww.y <= 0.0) continue;
            vec2 ab = w.zw - w.xy, ap = p - w.xy;
            float d = length(ap - ab * clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0));
            // water just behind the transom is freshly churned: its aeration is set, not added (the same at
            // any frame rate), a transom wide with a ragged edge
            aer = max(aer, ww.y * smoothstep(ww.x * 1.3, ww.x * 0.3, d * (0.8 + 0.4 * f1)));
            slk += min(ww.y, 1.0) * smoothstep(ww.x * 2.5, ww.x * 0.8, d) * 3.0 * uDt;
          }
          float lace = old.w * 0.08 * uDt;                                 // bubbles surfacing leave foam
          // ---- hull waves (hullwaves.js): white water where the boats' own waves break (the bow wave, and
          // the divergent crests once the boat goes fast): aerated, and its foam
          #ifdef HWSIM
          float hb = hwAt(p, 0.0).w;
          aer = max(aer, min(old.w + hb * 3.0 * uDt, hb)); lace += hb * (0.3 + f1) * 1.5 * uDt;
          #endif
          gl_FragColor = vec4(min(old.rgb + vec3(src, lace, slk), 1.0), min(max(old.w, aer), 3.0));
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    this.foamScene = new THREE.Scene(); this.foamScene.add(quad);
    this.foamCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._sternPrev = new Map();
    U.uFoamOn.value = 1;
  }
  // one step of the foam map (and, at any quality, the drift of the foam texture)
  _updateFoam(t, env, boats, player) {
    const dt0 = this.foamT === null ? 0 : t - this.foamT;
    const jump = this.foamT === null || dt0 < 0 || dt0 > 5;
    this.foamT = t;
    // (up to a second a step: the carrying is semi-Lagrangian and the spreading clamped, so a slow frame
    // or time warp keeps the foam's lifetimes in sim time instead of stretching them)
    const dt = jump ? 0 : Math.min(dt0, 1), W = env.waves, U = this.waterU;
    const dr = env.wavesOn && W.drift ? W.drift : { x: 0, z: 0 };
    U.uFoamOff.value.x += dr.x * dt; U.uFoamOff.value.y += dr.z * dt;
    if (!this.foamRT || !player || (dt <= 0 && !jump)) return;
    const F = this.foamU, S = U.uFoamS.value, cs = S / FOAM_N, cam = this.camera;
    // centred a little ahead of the camera's view of the player, snapped to whole texels (no smearing)
    const d = cam.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3())), h = Math.hypot(d.x, d.z) || 1;
    F.uCp.value.copy(U.uFoamC.value);
    U.uFoamC.value.set(Math.round((player.x + d.x / h * 0.2 * S) / cs) * cs, Math.round((player.z + d.z / h * 0.2 * S) / cs) * cs);
    F.uDt.value = dt; F.uKeep.value = jump ? 0 : 1;
    F.uDrift.value.set(dr.x, dr.z);
    const U10 = env.wind.tws;
    F.uLang.value = 0.008 * U10 * clamp((U10 - 3) / 5, 0, 1);
    // wakes: each hull's stern path since the last step, in the same water coordinates: the turbulent
    // strip the transom and the boundary layer leave (about the transom's width, spreading as the foam map
    // diffuses it), white from ~1 m/s; an engine's propeller wash (its thrust against
    // ~6 % of the boat's weight, js/engine.js, or b.propWash 0..1 if set) adds to it
    const s = this._fs || (this._fs = {});
    let n = 0;
    for (const b of boats) {
      const P = b.pose || b, C = b.cls, fx = Math.sin(P.psi), fz = -Math.cos(P.psi), rx = Math.cos(P.psi), rz = Math.sin(P.psi);
      const offs = C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0];
      const prev = this._sternPrev.get(b) || [], cur = [];
      for (let h = 0; h < offs.length; h++) {
        const sx = P.x + fx * C.sternX * 0.97 + rx * offs[h], sz = P.z + fz * C.sternX * 0.97 + rz * offs[h];
        let x0 = sx, z0 = sz;
        if (env.wavesOn) { W.sample(sx, sz, t, s); x0 = s.x0; z0 = s.z0; }
        cur.push([x0, z0]);
        if (n >= 6 || Math.abs(sx - U.uFoamC.value.x) > S / 2 || Math.abs(sz - U.uFoamC.value.y) > S / 2) continue;
        const pv = prev[h];
        if (!pv || jump || Math.hypot(x0 - pv[0], z0 - pv[1]) >= 10) continue;
        const sp = Math.hypot(b.u || 0, b.v || 0), pw = clamp(b.propWash ?? (b.engine && b.engine.active ? Math.abs(b.engine.T || 0) / (0.06 * (b.mass || 1000) * 9.81) : 0), 0, 1);
        // half the transom's width at the waterline (at least ~a foam texel: a cat's slender hulls); aeration
        // full from ~4.5 kn, weaker slower, and a planing hull (Fn past ~0.5) churns up to 3x as much, which takes
        // its extra few seconds to rise out: white for longer
        const Fn = sp / Math.sqrt(9.81 * C.lwl), tw = 0.4 * (C.hullBeam ?? C.beam) * (C.hull && C.hull.transom || 0.7);
        F.uWake.value[n].set(pv[0], pv[1], x0, z0);
        F.uWakeW.value[n].set(Math.max(tw * (1 + 0.3 * pw), 0.25), clamp((sp - 0.3) / 2.0, 0, 1) * (1 + 2 * clamp((Fn - 0.45) / 0.55, 0, 1)) + 0.8 * pw, 0, 0);
        n++;
      }
      this._sternPrev.set(b, cur);
    }
    for (let i = n; i < 6; i++) F.uWakeW.value[i].set(0, 0, 0, 0);
    const src = this.foamRT[this.foamI], dst = this.foamRT[1 - this.foamI];
    F.uPrev.value = src.texture;
    const r = this.r, prevRT = r.getRenderTarget();
    r.setRenderTarget(dst); r.render(this.foamScene, this.foamCam); r.setRenderTarget(prevRT);
    this.foamI = 1 - this.foamI;
    U.uFoam.value = dst.texture;
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
    U.uK2.value = waves.k2 || 0;
    const br = waves.brk;
    if (br) { U.uBrk.value.set(br.kb, br.S0, br.S1, br.L); U.uDm.value.set(br.dx, br.dz); } else U.uBrk.value.set(0, 0.2, 0.34, 0);
  }
  // the rogue groups the water draws this frame: the two nearest the camera (WaveField.rogueUniforms)
  setRogues(waves, t, cx, cz) {
    const U = this.waterU, o = waves.rogueUniforms(t, cx, cz, this._rgo || (this._rgo = { sticky: true }));
    for (let i = 0; i < MAXW; i++) U.uRg.value[i].fromArray(o.rg, i * 4);
    for (let e = 0; e < 2; e++) { U.uRgA.value[e].fromArray(o.A, 4 * e); U.uRgB.value[e].fromArray(o.B, 4 * e); U.uRgC.value[e].fromArray(o.C, 4 * e); }
    this.rogues = o.list;
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
  // the coastal field (coastal.js) -> float array textures: one layer of (P, Gx, Gz, K) per component, the
  // reflected waves' layers at half resolution, and the mask of where there are any. The same arrays
  // WaveField.sample reads. Without one: plane waves at each component's base wavenumber.
  setCoastal(waves) {
    const U = this.waterU, f = waves && waves.coastal;
    U.uShoreW.value = f ? 12 : 60;                 // (with the surf modelled, the old wide fade at the shore goes)
    if (!f) { U.uCstOn.value = 0; return; }
    if (this._cstSrc === f) { U.uCstOn.value = 1; return; }
    this._cstSrc = f;
    const filt = this.cstLin ? THREE.LinearFilter : THREE.NearestFilter;
    const arr = (data, n, d) => { const t = new THREE.DataArrayTexture(data, n, n, d); t.format = THREE.RGBAFormat; t.type = THREE.FloatType; t.magFilter = t.minFilter = filt; t.needsUpdate = true; return t; };
    this.cstTex.dispose(); this.cstRTex.dispose(); this.cstMTex.dispose();
    this.cstTex = arr(f.incA, f.M, f.n);
    this.cstRTex = arr(f.refA, f.Mr, Math.max(1, f.nr));
    this.cstMTex = new THREE.DataTexture(f.rMask, f.Mr, f.Mr, THREE.RedFormat); this.cstMTex.magFilter = this.cstMTex.minFilter = THREE.LinearFilter; this.cstMTex.needsUpdate = true;
    U.uCst.value = this.cstTex; U.uCstR.value = this.cstRTex; U.uCstM.value = this.cstMTex;
    for (let i = 0; i < MAXW; i++) U.uCstRL.value[i] = i < f.n ? f.rIdx[i] : -1;
    U.uCstW.value = f.R; U.uCstN.value.set(f.M, f.Mr); U.uCstNR.value = f.nr > 0 ? 1 : 0; U.uCstOn.value = 1;
  }
  setPhaseField(waves) { this.setCoastal(waves); }

  // ---------------------------------------------------------------- weather: overcast, rain, squall clouds, lightning, mist
  _buildRain() {
    const n = this.low ? 1500 : 4000;
    const pos = new Float32Array(n * 6);
    // drop positions from a fixed sequence (golden-ratio lattice), not Math.random: the same rain everywhere
    this.rainSeeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.rainSeeds[i * 3] = (i * 0.6180339887) % 1; this.rainSeeds[i * 3 + 1] = (i * 0.7548776662 + 0.31) % 1; this.rainSeeds[i * 3 + 2] = (i * 0.5698402910 + 0.67) % 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d4dc, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
    // the water shares the sky's cell, convection and mist uniforms (its shader includes CLOUD_GLSL and the mist)
    for (const k of ['uCellsB', 'uTower', 'uStrat', 'uMist', 'uMistCol']) this.waterU[k] = this.skySys.U[k];
    // lightning bolts: camera-facing ribbons (a few pixels wide at any distance), additive, lit by nothing
    this.bolts = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
        uniforms: { uRes: { value: new THREE.Vector2(1280, 720) }, uWidth: { value: 3 }, uI: { value: 0 } },
        vertexShader: /* glsl */`
          attribute vec3 aOther; attribute float aSide; attribute float aI;
          uniform vec2 uRes; uniform float uWidth; varying float vS; varying float vI;
          void main() {
            vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0), b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
            vec2 d = (b.xy / max(b.w, 1e-3) - a.xy / max(a.w, 1e-3)) * uRes; float l = length(d); d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
            a.xy += vec2(-d.y, d.x) * aSide * uWidth * (0.45 + 0.55 * aI) / uRes * 2.0 * a.w;
            gl_Position = a; vS = aSide; vI = aI;
          }`,
        fragmentShader: /* glsl */`
          uniform float uI; varying float vS; varying float vI;
          void main() {
            float x = vS * vS;
            gl_FragColor = vec4(vec3(0.82, 0.86, 1.0) * uI * vI * (exp(-x * 10.0) + 0.3 * exp(-x * 2.5)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      m.frustumCulled = false; m.visible = false; m.renderOrder = 5; this.scene.add(m);
      return m;
    });
    this.thunderLog = [];
  }
  // a ribbon mesh for a strike's channel (wx.boltSegments): 4 vertices per segment, each end knowing the other
  _setBolt(m, s, top) {
    const sg = boltSegments(s, top), n = sg.length / 7;
    const P = new Float32Array(n * 12), O = new Float32Array(n * 12), S = new Float32Array(n * 4), I = new Float32Array(n * 4), idx = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const q = i * 7, a = [sg[q], sg[q + 1], sg[q + 2]], b = [sg[q + 3], sg[q + 4], sg[q + 5]];
      const ends = [[a, b, 1], [a, b, -1], [b, a, -1], [b, a, 1]];   // the far end sees the segment reversed: side flips
      ends.forEach(([p, o, sd], j) => { P.set(p, (i * 4 + j) * 3); O.set(o, (i * 4 + j) * 3); S[i * 4 + j] = sd; I[i * 4 + j] = sg[q + 6]; });
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aOther', new THREE.BufferAttribute(O, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(S, 1)); g.setAttribute('aI', new THREE.BufferAttribute(I, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    m.geometry.dispose(); m.geometry = g; m.userData.id = s.id;
  }
  updateWeather(env, t, cam) {
    const W = env.weather; if (!W) return;
    const sky = W.sky(cam.x, cam.z, t, this._sky || (this._sky = {}));
    const oc = sky.overcast;
    // clouds drift with the wind aloft and thicken with the weather; squall cells tower
    const mw = env.wind.mean(t), kts = mw.speed / 0.5144;
    // smoothed in time, not per frame (the same at 20 or 144 fps); a jump in t (joining a room, time warp) snaps
    const dtw = t - (this._wxT ?? -1e9); this._wxT = t;
    const kw = dtw < 0 || dtw > 30 ? 1 : 1 - Math.exp(-dtw / 3);
    this.overcastU.value += (oc - this.overcastU.value) * kw;
    // (the wind aloft is steady: drifting by the surface trend's speed x t swung the whole sky around
    // the origin as the trend turned, tens of m/s sideways after an hour)
    const vw = env.wind.tws * 1.3, dw = env.wind.twd;
    const drift = (this._drift || (this._drift = new THREE.Vector2())).set(Math.sin(dw) * vw * t, -Math.cos(dw) * vw * t);
    const cells = W.activeCells ? W.activeCells(t) : [];
    // the day (wx.js): the sun now and an hour and a half ago (the cumulus lag the sun) at the venue
    const S = this.skySys, lat = S.lat ?? 32, lon = S.lon ?? -40, ms = S.ms ?? Date.now();
    const conv = convection(W.mode, heatFromSun(sunPosition(ms - 5.4e6, lat, lon).el), kts);
    this.convState = conv;
    this.skySys.setWeather(Math.min(1, 0.95 * oc + conv.cover), cells, drift, t, kts, conv);
    // visibility: heavy rain closes it to ~1-2 km, and the haze turns rain-grey (applied to the fog colour in update)
    // (and from storm force the air fills with spray: Beaufort 12 "visibility very seriously affected")
    this.scene.fog.density = 0.00011 + 0.0012 * sky.rain + 0.0006 * clamp((kts - 48) / 22, 0, 1);
    this.waterU.fogDensity.value = this.scene.fog.density;
    this._rainFog = this.rainNow = sky.rain;     // (rainNow: what the listener hears, audio.js)
    // mist and sea fog (wx.mist): a layer at the surface, eased like the clouds
    const hour = ((ms / 3.6e6 + lon / 15) % 24 + 24) % 24;
    const mi = this.mistState = mist(W.mode, W.seed ?? 0, t, S.sunEl ?? 0.5, hour, lat, kts, sky.cold || 0, this.mistState || {});
    const mv = MIST_U.uMist.value, km = dtw < 0 || dtw > 30 ? 1 : 1 - Math.exp(-dtw / 5);
    mv.x += (mi.sigma - mv.x) * km; mv.y += (Math.max(4, mi.H) - mv.y) * km; mv.z = 0.55;
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
    this._lightning(cells, t, cam);
  }
  // lightning (wx.js): strikes are a pure function of (seed, cell, time), so everyone in a room sees the same
  // bolt at the same moment and hears its thunder when the sound gets to them. The flash lights the cloud
  // from inside (sky march), the scene by proximity (hemisphere fill, water, haze), and a cloud-to-ground
  // strike draws its branched channel from the base to the sea.
  _lightning(cells, t, cam) {
    const list = this._strikes || (this._strikes = []); list.length = 0;
    if (cells.length) strikes(cells, t, Math.max(0, t - 90), t + 1e-6, list);
    const U = this.skySys.U, base = U.uCloudBase.value * 0.72, mv = MIST_U.uMist.value;
    let best = null, bestI = 0, light = 0, nb = 0;
    for (const s of list) {
      if (t - s.ts > 1.5) continue;
      const I = flashAt(s, t); if (I <= 0) continue;
      const fy = s.cg ? base * 0.6 : s.y, d = Math.hypot(cam.x - s.x, cam.y - fy, cam.z - s.z);
      // what reaches the eye through the rain haze and any mist
      const att = Math.exp(-((this.scene.fog.density * d) ** 2)) * Math.exp(-mistTau(mv.x, mv.y, cam.x, cam.y, cam.z, s.x, fy, s.z));
      light += I * (s.cg ? 1 : 0.5) / (1 + (d / 1100) ** 2);
      if (I > bestI) { bestI = I; best = s; }
      if (s.cg && nb < this.bolts.length) {
        const m = this.bolts[nb++];
        if (m.userData.id !== s.id) this._setBolt(m, s, base + 60);
        m.visible = true;
        m.material.uniforms.uI.value = 40 * I * att;
        m.material.uniforms.uWidth.value = Math.max(1.3, Math.min(7, 2.4 * 3000 / Math.max(300, d))) * this.r.getPixelRatio();
        this.r.getDrawingBufferSize(m.material.uniforms.uRes.value);
      }
    }
    for (let i = nb; i < this.bolts.length; i++) this.bolts[i].visible = false;
    // (a flash is far brighter against a night sky; none now: the cloud goes dark, not left at the last flash)
    if (best) U.uFlash.value.set(best.x, best.cg ? base + 400 : best.y, best.z, bestI * (2 + 5 * clamp((0.05 - (this.skySys.sunEl ?? 0.5)) / 0.15, 0, 1)));
    else U.uFlash.value.w = 0;
    U.uFlashCG.value = best && best.cg ? 1 : 0;
    if (bestI > 0) this._lastFlashT = t;
    this.skySys.noHist = bestI > 0 || t - (this._lastFlashT ?? -1e9) < 0.25;
    this._flashLight = light;
    // thunder: fired in sim time when the sound front (343 m/s) from the nearest part of the channel reaches
    // the camera, so it waits through a pause and hurries with time warp; audio.js listens for the event
    const due = thunderDue(list, cam.x, cam.y, cam.z, this._thT ?? t, t, base, this._due || (this._due = []));
    this._thT = t;
    if (due.length) {
      // the strike's bearing from the camera: pan across the camera's right, and how far ahead of it
      const cd = this.camera.getWorldDirection(this._thDir || (this._thDir = new THREE.Vector3()));
      for (const e of due) {
        const { pan, front } = thunderBearing(e.s, cam.x, cam.z, cd.x, cd.z);
        this.thunderLog.push({ id: e.s.id, ts: e.s.ts, t, d: e.d, cg: e.s.cg, pan });
        if (this.thunderLog.length > 50) this.thunderLog.shift();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('truewind:thunder', { detail: { d: e.d, spread: e.far - e.d, seed: e.s.seed, cg: e.s.cg, pan, front } }));
      }
    }
    due.length = 0;
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
    const S = world.R > 10000 ? 1024 : 512;
    this.sdfTex.dispose();
    this.sdfTex = new THREE.DataTexture(world.sdfTextureData(S), S, S, THREE.RGBAFormat);
    this.sdfTex.magFilter = THREE.LinearFilter; this.sdfTex.minFilter = THREE.LinearFilter; this.sdfTex.needsUpdate = true;
    U.uSdf.value = this.sdfTex;
    (this.seamarks || (this.seamarks = new SeamarkLayer(this.scene, { low: this.low }))).set(world, geo && geo.seamarks);   // lighthouses, buoys, beacons, lights
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

  // the tide's level (m above MSL): everything that stands on the ground (terrain, town, piers, beacons and
  // lighthouses) sinks by it while the sea (y = 0) and all that floats stays put, so the bed the water covers and
  // the banks it uncovers are where the physics' depth has them; the shader's depths follow
  setTide(eta) {
    this.waterU.uTide.value = eta;
    for (const o of [this.land, this.town, this.piersMesh]) if (o && o.position.y !== -eta) { o.position.y = -eta; o.updateMatrix(); }
    if (this.seamarks) this.seamarks.setLevel(eta);
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
  }

  // ---------------------------------------------------------------- boats
  addBoat(boat, opts = {}) {
    const vis = buildBoatModel(boat, opts);
    vis.rigging = new Rigging(boat, vis, { player: !!opts.player });
    vis.player = !!opts.player;
    vis.splash = new HullSplash(this.scene, vis, boat, this.skySys);
    vis.engineVis = buildEngineModel(boat, vis);        // outboard on its bracket / inboard exhaust (js/engine-model.js)
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
    if (env.wavesOn && env.waves.rogueUniforms) this.setRogues(env.waves, t, player ? player.x : cam.x, player ? player.z : cam.z);
    tickGlow(performance.now() / 1000);
    // sky, sun or moon light, exposure, reflections; the shadow-casting light follows the player
    if (player) { this.skySys._px = player.x; this.skySys._pz = player.z; }
    const hz = this.skySys.update(this.camera, t, this.sun, this.hemi, this.overcastU.value);
    {
      // in rain the haze is a flat grey curtain, darker than the clear-air horizon
      const rf = Math.min(1, (this._rainFog || 0) * 1.3), gy = (0.3 * hz[0] + 0.55 * hz[1] + 0.15 * hz[2]) * (1 - 0.3 * rf);
      // (under a heavy cell it takes a green-grey cast: red-poor light through deep cloud)
      this.scene.fog.color.setRGB(hz[0] + (gy * 0.94 - hz[0]) * rf, hz[1] + (gy * 1.02 - hz[1]) * rf, hz[2] + (gy * 1.0 - hz[2]) * rf);
    }
    // mist: lit grey-white from the sky (brighter toward the sun, in the march), and it dims the sun under it
    {
      const mv = MIST_U.uMist.value, mc = MIST_U.uMistCol.value;
      const g = 0.3 * hz[0] + 0.55 * hz[1] + 0.15 * hz[2], sc = this.skySys.U.uSunCol.value, sy = Math.max(0, this.skySys.lightV.y);
      mc.x = (hz[0] * 0.35 + g * 0.75) * 1.12 + sc.x * 0.16 * sy; mc.y = (hz[1] * 0.35 + g * 0.75) * 1.12 + sc.y * 0.16 * sy; mc.z = (hz[2] * 0.35 + g * 0.75) * 1.15 + sc.z * 0.16 * sy;
      if (mv.x > 0) this.sun.intensity *= Math.exp(-mv.x * mv.y * Math.exp(-Math.max(0, cam.y) / mv.y) / Math.max(0.12, sy));
    }
    // lightning lights the scene by how close it is (not a global exposure bump): a hemisphere fill, the
    // water's ambient and the rain haze
    const fl = this._flashLight || 0;
    if (fl > 0) { const c = this.scene.fog.color; c.r += 0.15 * fl; c.g += 0.16 * fl; c.b += 0.2 * fl; }
    this.waterU.fogColor.value.copy(this.scene.fog.color);
    {
      const up = this.skySys.U.uAmbTop.value, sc = this.skySys.U.uSunCol.value;
      const l = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
      this.waterU.uAmbF.value = Math.max(0.004, Math.min(1.6, (l(up) + 0.5 * l(sc) * Math.max(this.skySys.lightV.y, 0)) / 0.97)) + 0.8 * fl;
      if (fl > 0) this.hemi.intensity += 3 * fl;
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
    for (const [b, vis] of this.boats) {
      updateBoatModel(vis, b, t);
      if (vis.engineVis) updateEngineModel(vis, b, t, dt);
      // detail near the camera: ropes only where they can be seen
      const dist = Math.hypot(b.x - cam.x, b.z - cam.z);
      const near = vis.player || dist < 150;
      vis.rigging.update(t, near, dt, env);
      const sp = vis.splash;
      sp.foam.visible = sp.sheet.visible = sp.points.visible = sp.patches.visible = near;
      if (near) { sp.update(dt, t, env); roosterTail(sp, b, Math.min(dt, 0.05), env, t, this._rt || (this._rt = {})); }
      // the wake ribbon only without the foam map (which lays the wake down as persistent foam)
      const wk = this.wakes.get(b); wk.mesh.visible = !this.foamRT;
      if (!this.foamRT) wk.update(b, env, t, dt);
    }
    if (this.hullWaves) this.hullWaves.update(t, boats, player);
    if (this.kelvinLow) this.kelvinLow.update(t, boats, player);
    this._updateFoam(t, env, boats, player);
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
    if (this.seamarks) this.seamarks.update(dt, t, this.camera, env, this.sunDir.y, this.scene.fog.density || 0, this.r.getPixelRatio(), this.r.domElement.clientHeight || 800);
    if (this.hooks) for (const h of this.hooks) h(dt, t, sim);      // (js/gear-render.js: wrecks, rodes, lines, MOB marker)
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
        let floor = env.waves.height(px, pz, t) + 1.1 + 0.03 * d;   // rises at once, settles slowly
        // a big sea: no crest between the lens and the boat (the line of sight clears each by a metre or two)
        if (env.wavesOn && (env.waves.Hs || 0) > 1.5) {
          const ty = lerp(c.hs, bh, 0.4) + C0.freeboard + 0.6;
          for (const f of [0.3, 0.55, 0.8]) {
            const need = env.waves.height(lerp(px, c.tx, f), lerp(pz, c.tz, f), t) + 1 + 0.05 * env.waves.Hs;
            floor = Math.max(floor, ty + (need - ty) / (1 - f));
          }
        }
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
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uT: { value: 0 } },
      vertexShader: `attribute float alpha; attribute float across; varying float vA; varying float vX; varying vec2 vW;
        void main(){ vA = alpha; vX = across; vW = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // the splash foam's gradient noise on an integer-style hash (the old sin() hash lost its precision at
      // world coordinates x 20 and broke into blocks), each octave faded to its mean below a pixel
      fragmentShader: /* glsl */`uniform float uT; varying float vA; varying float vX; varying vec2 vW;
        ${FOAM_NOISE}
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
      this.pos.set([p.x + p.px * w, h + 0.12, p.z + p.pz * w, p.x - p.px * w, h + 0.12, p.z - p.pz * w], i * 6);   // (over the Kelvin pattern's crests too)
      this.alpha[2 * i] = a; this.alpha[2 * i + 1] = a;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.alpha.needsUpdate = true;
  }
}
