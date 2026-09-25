// Water meeting the hull.
//  * Bow wave: a translucent sheet that climbs the stem and flare and peels away with an aerated lip.
//    Its height follows the physics: the stagnation rise u^2/2g scaled by how hard the entry pushes water
//    aside, plus the rise of the sea against the hull when the bow pitches into a wave.
//  * Spray: where the water strikes the hull hard (relative vertical speed of sea vs hull + speed against
//    the entry angle) a fan of drops leaves along the flare, flies ballistically with air drag and falls
//    back; drops are drawn as motion streaks, with mist around the burst. Lit by the sky: backlit spray
//    glows, at night it is dark.
//  * Foam: patches born at the bow wave, in the quarter wave and where spray lands, riding the wave surface,
//    drifting, spreading and fading astern — not a band glued to the hull (a thin line stays at the hull).
import * as THREE from 'three';

const DROPS = 2400, PATCHES = 520, Q = 16, RWS = 7;
const NOISE = /* glsl */`
// hash without sin() (at world coordinates x 26 its precision ran out and the foam broke into blocks)
vec2 fh(vec2 p){ p = mod(p, 4096.0); vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0; }
// gradient noise with value-noise statistics (value noise's flat lattice spots made foam a mosaic of cells)
float fn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = dot(fh(i), f), b = dot(fh(i + vec2(1, 0)), f - vec2(1, 0)), c = dot(fh(i + vec2(0, 1)), f - vec2(0, 1)), d = dot(fh(i + vec2(1, 1)), f - vec2(1, 1));
  return clamp(0.5 + 1.28 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y), 0.0, 1.0); }
// the same, faded to its mean once a cell is smaller than a couple of pixels (w: pixel footprint in p units)
float fnA(vec2 p, float w){ return mix(0.5, fn(p), smoothstep(0.7, 0.3, w)); }
float foam(vec2 p, float t, float cover) {
  float w = length(fwidth(p));
  float n = fnA(p * 3.0 + vec2(t * 0.3, 0.0), w * 3.0) * 0.5 + fnA(p * 7.0 - vec2(0.0, t * 0.5), w * 7.0) * 0.3 + fnA(p * 17.0 + t, w * 17.0) * 0.2;
  float bub = smoothstep(0.35, 0.6, fnA(p * 26.0 - t * 0.4, w * 26.0)) * smoothstep(0.2, 0.5, fnA(p * 9.0, w * 9.0));
  return smoothstep(1.0 - cover, 1.0 - cover + 0.35 + min(0.3, w * 3.0), n * 0.75 + bub * 0.35);
}`;
const LIGHT = /* glsl */`
uniform vec3 uSunCol; uniform vec3 uAmbTop; uniform vec3 uLightDir;
vec3 whiteWater(vec3 n) { return uAmbTop * 0.55 + uSunCol * (0.35 + 0.65 * max(dot(n, uLightDir), 0.0)) * 2.2; }`;

let MATS = null;
function materials(sky) {
  if (MATS) return MATS;
  const U = sky ? { uSunCol: sky.U.uSunCol, uAmbTop: sky.U.uAmbTop, uLightDir: { value: sky.lightV } }
    : { uSunCol: { value: new THREE.Vector3(0.7, 0.65, 0.55) }, uAmbTop: { value: new THREE.Vector3(0.5, 0.6, 0.7) }, uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() } };
  const uT = { value: 0 };
  // bow-wave sheet
  const sheet = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...U, uT },
    vertexShader: `attribute vec2 uvq; attribute float hgt; varying vec2 vQ; varying float vH; varying vec3 vW; varying vec3 vN;
      void main(){ vQ = uvq; vH = hgt; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; varying vec2 vQ; varying float vH; varying vec3 vW; varying vec3 vN; ${NOISE} ${LIGHT}
      void main(){
        if (vH < 0.01) discard;
        vec3 V = normalize(cameraPosition - vW);
        vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
        float F = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        // clear green-blue water thinning to white where it breaks up at the lip and trails aft
        vec3 water = uAmbTop * vec3(0.10, 0.30, 0.32) + uSunCol * vec3(0.10, 0.28, 0.26) * max(dot(n, uLightDir), 0.0);
        vec3 refl = uAmbTop * 0.9;
        float lip = smoothstep(0.45, 0.95, vQ.y);
        float aer = foam(vW.xz * 2.2 + vec2(0.0, vQ.y * 3.0), uT * 1.6, clamp(0.25 + lip * 0.7 + vQ.x * 0.35, 0.0, 0.95));
        float streak = smoothstep(0.55, 0.9, fn(vec2(vQ.x * 9.0 - uT * 3.0, vQ.y * 40.0)));
        float white = clamp(aer * (0.35 + lip) + streak * 0.35 * lip, 0.0, 1.0);
        vec3 col = mix(mix(water, refl, F), whiteWater(n), white);
        float a = (0.18 + 0.4 * F + 0.6 * white) * smoothstep(0.0, 0.18, vQ.y) * (1.0 - smoothstep(0.75, 1.0, vQ.x)) * smoothstep(0.0, 0.06, vQ.x) * clamp(vH / 0.08, 0.0, 1.0);
        // the lip frays into drops
        a *= 1.0 - smoothstep(0.85, 1.0, vQ.y) * (1.0 - smoothstep(0.3, 0.7, fn(vW.xz * 14.0 + uT * 6.0)));
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // spray: streaked drops and mist puffs (instanced camera-facing quads)
  const spray = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...U },
    vertexShader: `attribute vec2 corner; attribute vec3 iPos; attribute vec3 iVel; attribute float iLife; attribute float iSize; attribute float iKind;
      varying vec2 vC; varying float vL; varying float vK; varying vec3 vW;
      void main(){
        vC = corner; vL = iLife; vK = iKind; vW = iPos;
        if (iLife <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 mv;
        if (iKind < 0.5) {
          // a drop: a short streak along its motion (what the eye sees of a fast drop)
          vec4 h = viewMatrix * vec4(iPos, 1.0), tl = viewMatrix * vec4(iPos - iVel * 0.03, 1.0);
          vec2 d = h.xy - tl.xy; float L = length(d); d = L > 1e-5 ? d / L : vec2(0.0, 1.0);
          mv = mix(tl, h, corner.y) + vec4(vec2(-d.y, d.x) * corner.x * iSize * 0.5, 0.0, 0.0);
        } else if (iKind < 1.5) {
          // mist: a soft puff that grows as it drifts
          mv = viewMatrix * vec4(iPos, 1.0); mv.xy += vec2(corner.x, corner.y * 2.0 - 1.0) * iSize * (1.0 + (1.0 - iLife) * 1.5);
        } else {
          // spindrift: a wisp of spray torn off a crest, smeared along its flight and spreading
          float w = iSize * (1.0 + (1.0 - iLife) * 2.0);
          vec4 h = viewMatrix * vec4(iPos, 1.0), tl = viewMatrix * vec4(iPos - iVel * 0.3, 1.0);
          vec2 d = h.xy - tl.xy; float L = length(d); d = L > 1e-5 ? d / L : vec2(0.0, 1.0);
          mv = mix(tl, h, corner.y) + vec4(vec2(-d.y, d.x) * corner.x * w * 0.5 + d * (corner.y - 0.5) * w, 0.0, 0.0);
        }
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec2 vC; varying float vL; varying float vK; varying vec3 vW; ${LIGHT}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float back = pow(max(dot(-V, uLightDir), 0.0), 6.0);                 // spray lit from behind glows
        vec3 col = uAmbTop * 0.7 + uSunCol * (0.9 + 5.0 * back);
        float a;
        if (vK < 0.5) a = (1.0 - vC.x * vC.x) * mix(0.25, 1.0, vC.y) * clamp(vL * 1.6, 0.0, 1.0) * 0.9;
        else if (vK < 1.5) { vec2 q = vec2(vC.x, vC.y * 2.0 - 1.0); a = exp(-dot(q, q) * 3.0) * vL * 0.12; }
        else { vec2 q = vec2(vC.x, vC.y * 2.0 - 1.0); a = exp(-dot(q, q) * 2.2) * min(1.0, vL * 1.5) * 0.32; }
        if (a < 0.01) discard;
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // foam patches riding the waves
  const patch = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { ...U, uT },
    vertexShader: `attribute vec2 corner; attribute vec4 iP; attribute vec4 iQ; varying vec2 vC; varying vec3 vW; varying vec4 vQ;
      void main(){
        vC = corner; vQ = iQ;
        if (iQ.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float c = cos(iQ.z), s = sin(iQ.z);
        vec2 o = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * iP.w;
        vec3 w = vec3(iP.x + o.x, iP.y + 0.09, iP.z + o.y); vW = w;          // above the choppy displaced surface
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `uniform float uT; varying vec2 vC; varying vec3 vW; varying vec4 vQ; ${NOISE} ${LIGHT}
      void main(){
        float r = length(vC);
        float edge = 1.0 - smoothstep(0.35 + 0.35 * fn(vC * 3.0 + vQ.w * 17.0), 1.0, r);
        float f = foam(vW.xz * 1.3 + vQ.w * 31.0, uT * 0.5, clamp(vQ.x * 0.9, 0.0, 0.92)) * edge;
        if (f < 0.01) discard;
        gl_FragColor = vec4(whiteWater(vec3(0.0, 1.0, 0.0)) * 0.9, f * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // thin line where the water meets the hull
  const line = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { ...U, uT },
    vertexShader: `attribute float a; attribute float across; varying float vA; varying float vX; varying vec3 vW;
      void main(){ vA = a; vX = across; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; varying float vA; varying float vX; varying vec3 vW; ${NOISE} ${LIGHT}
      void main(){
        float edge = smoothstep(0.0, 0.1, vX) * (1.0 - smoothstep(0.3, 1.0, vX));
        float f = foam(vW.xz * 1.6, uT, clamp(vA * 0.7, 0.0, 0.8)) * edge;
        if (f < 0.01) discard;
        gl_FragColor = vec4(whiteWater(vec3(0.0, 1.0, 0.0)) * 0.9, f * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  MATS = { sheet, spray, patch, line, uT };
  return MATS;
}

function quadCorners(g, kinds) {
  // 4-vertex quad; corner.x across (-1..1), corner.y along (0..1)
  g.setAttribute('corner', new THREE.Float32BufferAttribute(kinds === 'centered' ? [-1, -1, 1, -1, 1, 1, -1, 1] : [-1, 0, 1, 0, 1, 1, -1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
}

export class HullSplash {
  constructor(scene, vis, boat, sky = null) {
    this.b = boat; this.vis = vis; this.scene = scene;
    const M = materials(sky);
    // spray
    const sg = new THREE.InstancedBufferGeometry(); quadCorners(sg);
    this.dPos = new Float32Array(DROPS * 3); this.dVel = new Float32Array(DROPS * 3);
    this.dLife = new Float32Array(DROPS); this.dSize = new Float32Array(DROPS); this.dKind = new Float32Array(DROPS); this.dFade = new Float32Array(DROPS);
    this.aPos = new THREE.InstancedBufferAttribute(this.dPos, 3); this.aVel = new THREE.InstancedBufferAttribute(this.dVel, 3);
    this.aLife = new THREE.InstancedBufferAttribute(this.dLife, 1); this.aSize = new THREE.InstancedBufferAttribute(this.dSize, 1); this.aKind = new THREE.InstancedBufferAttribute(this.dKind, 1);
    for (const a of [this.aPos, this.aVel, this.aLife, this.aSize, this.aKind]) a.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('iPos', this.aPos); sg.setAttribute('iVel', this.aVel); sg.setAttribute('iLife', this.aLife); sg.setAttribute('iSize', this.aSize); sg.setAttribute('iKind', this.aKind);
    sg.instanceCount = DROPS;
    this.points = new THREE.Mesh(sg, M.spray); this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points);
    this.next = 0;
    // foam patches
    const pg = new THREE.InstancedBufferGeometry(); quadCorners(pg, 'centered');
    this.pP = new Float32Array(PATCHES * 4); this.pQ = new Float32Array(PATCHES * 4); this.pV = new Float32Array(PATCHES * 2); this.pAge = new Float32Array(PATCHES).fill(1e9); this.pA0 = new Float32Array(PATCHES); this.pGrow = new Float32Array(PATCHES);
    this.aP = new THREE.InstancedBufferAttribute(this.pP, 4); this.aQ = new THREE.InstancedBufferAttribute(this.pQ, 4);
    this.aP.setUsage(THREE.DynamicDrawUsage); this.aQ.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('iP', this.aP); pg.setAttribute('iQ', this.aQ); pg.instanceCount = PATCHES;
    this.patches = new THREE.Mesh(pg, M.patch); this.patches.frustumCulled = false; this.patches.renderOrder = 2;
    scene.add(this.patches);
    this.pNext = 0; this._ws = {};
    // bow-wave sheets: up to 4 (two sides of up to two hulls), Q stations x RWS rows each
    const nv = 4 * Q * RWS;
    const bg = new THREE.BufferGeometry();
    this.bPos = new Float32Array(nv * 3); this.bUV = new Float32Array(nv * 2); this.bH = new Float32Array(nv);
    bg.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3)); bg.setAttribute('uvq', new THREE.BufferAttribute(this.bUV, 2)); bg.setAttribute('hgt', new THREE.BufferAttribute(this.bH, 1));
    const bi = [];
    for (let s = 0; s < 4; s++) for (let q = 0; q < Q - 1; q++) for (let r = 0; r < RWS - 1; r++) {
      const a = (s * Q + q) * RWS + r, b = a + RWS; bi.push(a, b, a + 1, a + 1, b, b + 1);
    }
    bg.setIndex(bi);
    this.sheet = new THREE.Mesh(bg, M.sheet); this.sheet.frustumCulled = false; this.sheet.renderOrder = 3;
    vis.inner.add(this.sheet);
    // the thin hull line (boat frame)
    this.maxSt = 32;
    const fg = new THREE.BufferGeometry();
    this.fpos = new Float32Array(this.maxSt * 4 * 2 * 3); this.fa = new Float32Array(this.maxSt * 4 * 2);
    const across = new Float32Array(this.maxSt * 4 * 2); for (let i = 0; i < across.length; i += 2) { across[i] = 0; across[i + 1] = 1; }
    fg.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3));
    fg.setAttribute('a', new THREE.BufferAttribute(this.fa, 1));
    fg.setAttribute('across', new THREE.BufferAttribute(across, 1));
    const idx = [];
    for (let side = 0; side < 4; side++) for (let i = 0; i < this.maxSt - 1; i++) { const a = (side * this.maxSt + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    fg.setIndex(idx);
    this.foam = new THREE.Mesh(fg, M.line); this.foam.frustumCulled = false; this.foam.renderOrder = 2;
    vis.inner.add(this.foam);
  }

  emit(px, py, pz, vx, vy, vz, size, kind = 0, fade = 0.7) {
    const i = this.next; this.next = (this.next + 1) % DROPS;
    this.dPos[i * 3] = px; this.dPos[i * 3 + 1] = py; this.dPos[i * 3 + 2] = pz;
    this.dVel[i * 3] = vx; this.dVel[i * 3 + 1] = vy; this.dVel[i * 3 + 2] = vz;
    this.dLife[i] = 1; this.dSize[i] = size; this.dKind[i] = kind; this.dFade[i] = fade;
  }
  spawnPatch(x, z, vx, vz, size, strength, grow = 0.25) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % PATCHES;
    this.pP[i * 4] = x; this.pP[i * 4 + 2] = z; this.pP[i * 4 + 3] = size;
    this.pV[i * 2] = vx; this.pV[i * 2 + 1] = vz; this.pAge[i] = 0; this.pA0[i] = strength; this.pGrow[i] = grow;
    this.pQ[i * 4 + 2] = Math.random() * 6.28; this.pQ[i * 4 + 3] = Math.random();
  }

  update(dt, t, env) {
    const b = this.b, C = b.cls, vis = this.vis, hy = b.hydro;
    MATS.uT.value = t;
    if (!b._etaAt || dt <= 0) return;
    dt = Math.min(dt, this.maxDt || 0.05);
    const wl = hy.waterline(b.heave, b.pitch, b.phi, b._etaAt, b._slLat);
    vis.inner.updateMatrixWorld();
    const M = vis.inner.matrixWorld, e = M.elements;
    const toW = (lx, ly, lz, o) => { o[0] = e[0] * lx + e[4] * ly + e[8] * lz + e[12]; o[1] = e[1] * lx + e[5] * ly + e[9] * lz + e[13]; o[2] = e[2] * lx + e[6] * ly + e[10] * lz + e[14]; return o; };
    const dirW = (lx, ly, lz, o) => { o[0] = e[0] * lx + e[4] * ly + e[8] * lz; o[1] = e[1] * lx + e[5] * ly + e[9] * lz; o[2] = e[2] * lx + e[6] * ly + e[10] * lz; const L = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= L; o[1] /= L; o[2] /= L; return o; };
    const pw = [0, 0, 0], dw = [0, 0, 0];
    const bvx = b.vgx || 0, bvz = b.vgz || 0;
    const u = Math.max(0, b.u), G = 9.81;
    const nS = Math.min(wl.length, this.maxSt);
    const offs = C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0];
    const fp = this.fpos, fa = this.fa;
    fa.fill(0);
    this.bH.fill(0);
    const bowLen = C.bowX - C.sternX;
    for (let h = 0; h < offs.length; h++) for (const sideSign of [-1, 1]) {
      const sideIdx = h * 2 + (sideSign > 0 ? 1 : 0);
      // crossings on this side, stern -> bow
      const cr = [];
      for (let s = 0; s < nS; s++) {
        const st = wl[s], pts = st.pts; let best = null;
        for (let k = 0; k < pts.length; k += 2) {
          const y = pts[k] - offs[h];
          if (Math.sign(y) === sideSign && Math.abs(y) < C.beam && (!best || Math.abs(y) > Math.abs(best[0] - offs[h]))) best = [pts[k], pts[k + 1]];
        }
        if (best) cr.push({ s, x: st.x, t: st.t, y: best[0], z: best[1] });
      }
      for (let i = 0; i < cr.length; i++) {
        const c = cr[i], p = cr[Math.max(0, i - 1)];
        const dx = Math.max(1e-3, c.x - p.x);
        c.entry = Math.max(0, (Math.abs(c.y - offs[h]) - Math.abs(p.y - offs[h])) / dx);
        const hullVz = b.heaveV + c.x * b.pitchV - c.y * b.p;
        c.rise = b._etaDot(c.x) - hullVz;
        c.imp = Math.max(0, c.rise) * (c.t > 0.5 ? 1 : 0.5) + u * c.entry * (c.t > 0.5 ? 1 : 0.2);
        // hull line
        const slot = sideIdx * this.maxSt + c.s;
        const w = 0.1 + 0.03 * u;
        fp[slot * 6] = c.y; fp[slot * 6 + 1] = c.z + 0.012; fp[slot * 6 + 2] = -c.x;
        fp[slot * 6 + 3] = c.y + sideSign * w; fp[slot * 6 + 4] = c.z + 0.008; fp[slot * 6 + 5] = -c.x;
        fa[slot * 2] = fa[slot * 2 + 1] = Math.min(0.75, 0.2 + 0.07 * u + 0.2 * c.imp);
      }
      // ---- bow-wave sheet along the forward waterline
      const fwd = cr.filter(c => c.t > 0.5).sort((a, c) => c.x - a.x);   // stem first
      if (fwd.length >= 2) {
        const x0 = fwd[0].x, x1 = fwd[fwd.length - 1].x, span = Math.max(0.3, x0 - x1);
        let riseMax = 0, entryAvg = 0; for (const c of fwd) { riseMax = Math.max(riseMax, c.rise); entryAvg += c.entry; } entryAvg /= fwd.length;
        const Hmax = Math.min(0.4 * C.freeboard + 0.25, 0.8 * u * u / (2 * G) * (0.5 + 2.2 * Math.min(0.6, entryAvg)) + 0.35 * Math.max(0, riseMax) ** 2 / (2 * G) + 0.02 * u);
        for (let q = 0; q < Q; q++) {
          const f = q / (Q - 1), xq = x0 - f * span;
          let k = 0; while (k < fwd.length - 2 && fwd[k + 1].x > xq) k++;
          const A = fwd[k], B = fwd[k + 1], m = Math.max(0, Math.min(1, (A.x - xq) / Math.max(1e-4, A.x - B.x)));
          const y = A.y + (B.y - A.y) * m, z = A.z + (B.z - A.z) * m;
          // the sheet stands highest a little aft of the stem and dies out along the flank
          const H = Hmax * Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.7 + 0.08)), 0.7) * (1 - 0.6 * f);
          for (let r = 0; r < RWS; r++) {
            const v = r / (RWS - 1);
            const up = H * Math.sin(v * 2.2) / Math.sin(1.571);            // rises, crests, the lip falls
            const out = sideSign * (0.05 + H * (0.75 * v + 1.0 * v * v * v) + f * 0.08);   // clears the flare, the lip peels outward
            const vi = ((sideIdx * Q + q) * RWS + r);
            this.bPos[vi * 3] = y + out; this.bPos[vi * 3 + 1] = z + up - 0.01; this.bPos[vi * 3 + 2] = -xq;
            this.bUV[vi * 2] = f; this.bUV[vi * 2 + 1] = v; this.bH[vi] = H;
          }
          // the lip throws a little spray and leaves foam on the water as it falls
          if (H > 0.08 && q > 1 && q < Q - 3 && Math.random() < H * u * dt * 1.2) {
            toW(y + sideSign * (0.05 + H * 1.75), z + H * 0.7, -xq, pw);
            dirW(sideSign, 0.6, 0.15, dw);
            const sp = 0.5 + u * 0.35 * Math.random();
            this.emit(pw[0], pw[1], pw[2], bvx * 0.85 + dw[0] * sp, dw[1] * sp, bvz * 0.85 + dw[2] * sp, 0.03 + Math.random() * 0.04, 0, 1.2);
          }
          if (H > 0.05 && Math.random() < H * u * dt * 1.6) {
            toW(y + sideSign * (0.2 + H * 1.6 + Math.random() * 0.3), z, -xq, pw);
            dirW(sideSign, 0, 0, dw);
            this.spawnPatch(pw[0], pw[2], bvx * 0.15 + dw[0] * 0.35 * u, bvz * 0.15 + dw[2] * 0.35 * u, 0.25 + H * 1.2, Math.min(0.9, 0.4 + H * 1.5), 0.22);
          }
        }
      }
      // ---- quarter wave and friction wake: foam peeling off aft of amidships when moving
      const aft = cr.filter(c => c.t < 0.35);
      if (aft.length && u > 1.2 && Math.random() < (u - 1.2) * dt * 2.2) {
        const c = aft[Math.floor(Math.random() * aft.length)];
        toW(c.y + sideSign * (0.1 + Math.random() * 0.3), c.z, -c.x, pw);
        this.spawnPatch(pw[0], pw[2], bvx * 0.25, bvz * 0.25, 0.35 + 0.06 * u, Math.min(0.85, 0.3 + 0.08 * u), 0.3);
      }
      // ---- spray from hard impacts: a fan of drops off the bow and flare, with mist
      for (const c of cr) {
        const ex = (c.t > 0.55 ? c.imp : 0) - 1.0;
        if (ex <= 0 || Math.random() > ex * ex * dt * 10) continue;
        const n = 6 + Math.floor(ex * 14);
        toW(c.y, c.z + 0.02, -c.x, pw);
        for (let q = 0; q < n; q++) {
          // fan: outward and up along the flare, spread fore-and-aft
          const ang = (Math.random() - 0.5) * 1.1, lift = 0.35 + Math.random() * 0.7;
          dirW(sideSign * Math.cos(ang), lift, Math.sin(ang) * 0.6 + 0.2, dw);
          const sp = c.imp * (0.55 + Math.random() * 0.8);
          this.emit(pw[0], pw[1], pw[2], bvx * 0.7 + dw[0] * sp, dw[1] * sp, bvz * 0.7 + dw[2] * sp, 0.025 + Math.random() * 0.05, 0, 0.8);
        }
        for (let q = 0; q < 1 + Math.min(2, ex); q++) {
          dirW(sideSign, 0.5, 0.2, dw);
          this.emit(pw[0] + dw[0] * 0.3, pw[1] + 0.2, pw[2] + dw[2] * 0.3, bvx * 0.6 + dw[0] * ex, 0.4 + Math.random() * 0.6, bvz * 0.6 + dw[2] * ex, 0.12 + Math.random() * 0.12 * Math.min(2, ex), 1, 0.8);
        }
        this.spawnPatch(pw[0] + sideSign * 0.3, pw[2], bvx * 0.2, bvz * 0.2, 0.5 + ex * 0.4, 0.9, 0.35);
      }
    }
    // unused sheet vertices collapse (height 0 discards them)
    this.foam.geometry.attributes.position.needsUpdate = true; this.foam.geometry.attributes.a.needsUpdate = true;
    const sgA = this.sheet.geometry.attributes; sgA.position.needsUpdate = true; sgA.uvq.needsUpdate = true; sgA.hgt.needsUpdate = true;
    this.sheet.geometry.computeVertexNormals();
    // ---- drops: gravity + air drag; mist drifts and rises a little; landing drops leave foam
    const P = this.dPos, Vv = this.dVel, L = this.dLife, K = this.dKind;
    const wind = env && env.wind ? env.wind.sample(b.x, b.z, t, this._wind || (this._wind = {})) : null;
    const wx = wind ? -Math.sin(wind.dir) * wind.speed : 0, wz = wind ? Math.cos(wind.dir) * wind.speed : 0;
    for (let i = 0; i < DROPS; i++) {
      if (L[i] <= 0) continue;
      const k3 = i * 3;
      if (K[i] < 0.5) {
        Vv[k3 + 1] -= G * dt;
        const dr = Math.exp(-dt * 0.5);
        Vv[k3] = wx + (Vv[k3] - wx) * dr; Vv[k3 + 2] = wz + (Vv[k3 + 2] - wz) * dr;
      } else {
        const dr = Math.exp(-dt * 2.5);
        Vv[k3] = wx * 0.8 + (Vv[k3] - wx * 0.8) * dr; Vv[k3 + 2] = wz * 0.8 + (Vv[k3 + 2] - wz * 0.8) * dr; Vv[k3 + 1] *= dr;
      }
      P[k3] += Vv[k3] * dt; P[k3 + 1] += Vv[k3 + 1] * dt; P[k3 + 2] += Vv[k3 + 2] * dt;
      L[i] -= dt * this.dFade[i];
      if (K[i] < 0.5 && Vv[k3 + 1] < 0) {
        const sea = env && env.wavesOn ? env.waves.sample(P[k3], P[k3 + 2], t, this._ws).h : 0;
        if (P[k3 + 1] < sea) {
          L[i] = 0;
          if (this.dSize[i] > 0.05 && Math.random() < 0.12) this.spawnPatch(P[k3], P[k3 + 2], 0, 0, 0.15 + Math.random() * 0.2, 0.55, 0.15);
        }
      }
    }
    for (const a of [this.aPos, this.aVel, this.aLife, this.aSize, this.aKind]) a.needsUpdate = true;
    // ---- foam patches ride the surface, drift to a stop, spread and fade
    const PP = this.pP, PQ = this.pQ, PV = this.pV, AG = this.pAge;
    this._pf = (this._pf || 0) + 1;
    for (let i = 0; i < PATCHES; i++) {
      if (AG[i] > 60) { PQ[i * 4] = 0; continue; }
      AG[i] += dt;
      const dr = Math.exp(-dt * 0.8);
      PV[i * 2] *= dr; PV[i * 2 + 1] *= dr;
      PP[i * 4] += PV[i * 2] * dt; PP[i * 4 + 2] += PV[i * 2 + 1] * dt;
      PP[i * 4 + 3] += this.pGrow[i] * dt / (1 + AG[i] * 0.15);
      if ((i + this._pf) % 2 === 0) PP[i * 4 + 1] = env && env.wavesOn ? env.waves.sample(PP[i * 4], PP[i * 4 + 2], t, this._ws).h : 0;
      PQ[i * 4] = this.pA0[i] * Math.exp(-AG[i] / 9) * Math.min(1, AG[i] * 4 + 0.3);
    }
    this.aP.needsUpdate = true; this.aQ.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.points); scene.remove(this.patches); }
}

// Spindrift: from about Beaufort 7 the wind tears the tops off breaking crests and blows them downwind
// as sheets of spray. Breaking crests are found the way the water shader finds whitecaps — the steepest
// crest compression (Gerstner Jacobian) for the wind's whitecap coverage — on the real wave field
// around the camera, so the spray leaves the crests you see break.
const SEA_DROPS = 1200;
const invTail = (p) => { const t = Math.sqrt(-2 * Math.log(Math.max(p, 1e-6))); return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t); };
export class SeaSpray {
  constructor(scene, sky, low = false) {
    const M = materials(sky);
    this.n = low ? SEA_DROPS / 3 | 0 : SEA_DROPS;
    const n = this.n, g = new THREE.InstancedBufferGeometry(); quadCorners(g);
    this.P = new Float32Array(n * 3); this.V = new Float32Array(n * 3); this.L = new Float32Array(n); this.S = new Float32Array(n); this.K = new Float32Array(n); this.F = new Float32Array(n);
    this.attrs = [['iPos', this.P, 3], ['iVel', this.V, 3], ['iLife', this.L, 1], ['iSize', this.S, 1], ['iKind', this.K, 1]].map(([name, arr, k]) => {
      const a = new THREE.InstancedBufferAttribute(arr, k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a;
    });
    g.instanceCount = n;
    this.mesh = new THREE.Mesh(g, M.spray); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.next = 0; this.acc = 0; this._s = {}; this._w = {}; this.live = 0;
  }
  emit(x, y, z, vx, vy, vz, size, kind, fade) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.V[i * 3] = vx; this.V[i * 3 + 1] = vy; this.V[i * 3 + 2] = vz;
    this.L[i] = 1; this.S[i] = size; this.K[i] = kind; this.F[i] = fade;
  }
  // cam: camera position; fwdX, fwdZ: its horizontal view direction
  update(dt, t, env, cam, fwdX, fwdZ) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const w = env.wind.sample(cam.x, cam.z, t, this._w);
    const U = w.speed, wx = -Math.sin(w.dir) * U, wz = Math.cos(w.dir) * U;
    const gale = Math.max(0, Math.min(1, (U - 13) / 10));          // 25 kn: nothing; 45 kn: full spindrift
    const waves = env.waves;
    if (gale > 0 && env.wavesOn) {
      const Wc = Math.min(0.3, 3.84e-6 * Math.pow(U, 3.41)), zA = invTail(0.4 * Wc) + 0.2;
      const sig = Math.max(0.02, waves.jSigma || 0.1);
      this.acc += dt * 1500 * gale;
      for (; this.acc >= 1; this.acc--) {
        // a crest somewhere in view, 10-180 m out
        const r = 10 + Math.pow(Math.random(), 0.8) * 170, a = (Math.random() - 0.5) * 2.2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = cam.x + (fwdX * ca - fwdZ * sa) * r, z = cam.z + (fwdZ * ca + fwdX * sa) * r;
        const s = waves.sample(x, z, t, this._s);
        const zc = (1 - s.j) / sig;
        if (zc < zA) continue;
        const k = Math.min(1, (zc - zA) / 1.2) * gale;
        // a sheet of mist torn off the crest and a scatter of drops, all running with the wind
        for (let m = 0; m < 2 + 3 * k; m++) {
          const f = 0.45 + Math.random() * 0.4;
          this.emit(x + (Math.random() - 0.5) * 3, s.h + 0.2 + Math.random() * 0.5, z + (Math.random() - 0.5) * 3,
            wx * f + s.vx, 0.6 + Math.random() * 1.6 * k, wz * f + s.vz, 1.0 + Math.random() * 2.0 * (0.5 + k), 2, 0.3 + Math.random() * 0.25);
        }
        for (let m = 0; m < 3 * k; m++) {
          const f = 0.3 + Math.random() * 0.4;
          this.emit(x, s.h + 0.15, z, wx * f + s.vx, 1.5 + Math.random() * 3, wz * f + s.vz, 0.03 + Math.random() * 0.05, 0, 0.9);
        }
      }
    }
    const P = this.P, V = this.V, L = this.L, K = this.K;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (L[i] <= 0) continue;
      live++;
      const k3 = i * 3;
      if (K[i] < 0.5) {
        V[k3 + 1] -= 9.81 * dt;
        const dr = Math.exp(-dt * 0.8);
        V[k3] = wx + (V[k3] - wx) * dr; V[k3 + 2] = wz + (V[k3 + 2] - wz) * dr;
      } else {
        const dr = Math.exp(-dt * 1.5);
        V[k3] = wx * 0.8 + (V[k3] - wx * 0.8) * dr; V[k3 + 2] = wz * 0.8 + (V[k3 + 2] - wz * 0.8) * dr; V[k3 + 1] *= dr;
      }
      P[k3] += V[k3] * dt; P[k3 + 1] += V[k3 + 1] * dt; P[k3 + 2] += V[k3 + 2] * dt;
      L[i] -= dt * this.F[i];
      if (K[i] < 0.5 && V[k3 + 1] < 0 && P[k3 + 1] < -2 - 0.5 * (waves.Hs || 0)) L[i] = 0;   // well below any trough
    }
    this.live = live;
    this.mesh.visible = live > 0;
    if (live) for (const a of this.attrs) a.needsUpdate = true;
  }
}
