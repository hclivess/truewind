// Water meeting the hull: a foam band along the true waterline (where the local wave surface cuts
// each hull section) and spray thrown from where the water hits the hull hard.
// Impact speed at a station = rise of the water surface relative to the hull there (wave vertical
// velocity minus heave/pitch/roll velocity of the hull) + forward speed against the hull's entry
// angle (how fast the flare pushes water sideways). Spray is emitted in proportion to the square of
// the excess over a threshold (~1 m/s), leaves along the flare, flies ballistically and falls back.
import * as THREE from 'three';

const POOL = 1800;
const dropMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  vertexShader: `attribute float life; attribute float size; varying float vL;
    void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vL; void main(){ vec2 c = gl_PointCoord - 0.5; float r = dot(c, c); if (r > 0.25) discard;
    gl_FragColor = vec4(0.94, 0.97, 1.0, clamp(vL, 0.0, 1.0) * (1.0 - r * 3.0) * 0.85); }`,
});
const FOAM_GLSL = `
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
`;
const foamMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `attribute float a; attribute float across; varying float vA; varying float vX; varying vec3 vW;
    void main(){ vA = a; vX = across; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uT; varying float vA; varying float vX; varying vec3 vW; ${FOAM_GLSL}
    void main(){
      float edge = smoothstep(0.0, 0.12, vX) * (1.0 - smoothstep(0.35, 1.0, vX));   // tight to the hull, feathered outward
      float f = foam(vW.xz, uT, clamp(vA * 0.9, 0.0, 0.9)) * edge;
      if (f < 0.01) discard;
      gl_FragColor = vec4(vec3(0.93, 0.96, 0.98), f * 0.9);
    }`,
  uniforms: { uT: { value: 0 } },
});

export class HullSplash {
  constructor(scene, vis, boat) {
    this.b = boat; this.vis = vis;
    // spray particles (world space)
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(POOL * 3); this.vel = new Float32Array(POOL * 3);
    this.life = new Float32Array(POOL); this.size = new Float32Array(POOL);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.points = new THREE.Points(g, dropMat); this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    // foam band along the waterline (boat frame, two sides per hull)
    this.maxSt = 32;
    const fg = new THREE.BufferGeometry();
    this.fpos = new Float32Array(this.maxSt * 4 * 2 * 3); this.fa = new Float32Array(this.maxSt * 4 * 2);
    const across = new Float32Array(this.maxSt * 4 * 2); for (let i = 0; i < across.length; i += 2) { across[i] = 0; across[i + 1] = 1; }
    fg.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3));
    fg.setAttribute('a', new THREE.BufferAttribute(this.fa, 1));
    fg.setAttribute('across', new THREE.BufferAttribute(across, 1));
    const idx = [];
    for (let side = 0; side < 4; side++) for (let i = 0; i < this.maxSt - 1; i++) {
      const a = (side * this.maxSt + i) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    fg.setIndex(idx);
    this.foam = new THREE.Mesh(fg, foamMat); this.foam.frustumCulled = false; this.foam.renderOrder = 2;
    vis.inner.add(this.foam);
    this.impact = new Float32Array(64);
  }

  emit(p, v, size) {
    const i = this.next; this.next = (this.next + 1) % POOL;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = 1; this.size[i] = size;
  }

  update(dt, t) {
    const b = this.b, C = b.cls, vis = this.vis, hy = b.hydro;
    foamMat.uniforms.uT.value = t;
    if (!b._etaAt) return;
    const wl = hy.waterline(b.heave, b.pitch, b.phi, b._etaAt, b._slLat);
    vis.inner.updateMatrixWorld();
    const M = vis.inner.matrixWorld;
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi);
    const bvx = b.vgx || 0, bvz = b.vgz || 0;
    const u = Math.max(0, b.u);
    const tmp = new THREE.Vector3(), nrm = new THREE.Vector3(), vel = new THREE.Vector3();
    const nS = Math.min(wl.length, this.maxSt);
    // collect the crossing points per side of each hull (sorted outward from each hull's centre)
    const offs = C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0];
    let fp = this.fpos, fa = this.fa;
    fa.fill(0);
    for (let s = 0; s < nS; s++) {
      const st = wl[s];
      const pts = st.pts;
      // half-breadth change along the hull: the flare/entry the water has to be pushed aside by
      const prev = wl[Math.max(0, s - 1)], dxs = Math.max(1e-3, st.x - prev.x);
      for (let h = 0; h < offs.length; h++) for (const sideSign of [-1, 1]) {
        // pick the crossing on this side of this hull
        let best = null;
        for (let k = 0; k < pts.length; k += 2) {
          const y = pts[k] - offs[h];
          if (Math.sign(y) === sideSign && Math.abs(pts[k] - offs[h]) < C.beam && (!best || Math.abs(y) > Math.abs(best[0] - offs[h]))) best = [pts[k], pts[k + 1]];
        }
        const slot = (h * 2 + (sideSign > 0 ? 1 : 0)) * this.maxSt + s;
        if (!best) continue;
        const [y, z] = best;
        let yPrev = y;
        for (let k = 0; k < prev.pts.length; k += 2) if (Math.sign(prev.pts[k] - offs[h]) === sideSign) yPrev = prev.pts[k];
        const entry = Math.max(0, (Math.abs(y - offs[h]) - Math.abs(yPrev - offs[h])) / dxs);      // bow: breadth growing aft -> water pushed out
        // relative vertical velocity of water vs hull at this point
        const hullVz = b.heaveV + st.x * b.pitchV - y * b.p;
        const rise = b._etaDot(st.x) - hullVz;
        const imp = Math.max(0, rise) * (st.t > 0.5 ? 1 : 0.5) + u * entry * (st.t > 0.5 ? 1 : 0.2);
        const w = 0.18 + 0.05 * u + 0.35 * Math.min(1, imp / 2);
        const out = sideSign * w;
        fp.set([y, z + 0.015, -st.x, y + out, z + 0.01, -st.x], slot * 6);
        const cov = Math.min(0.9, 0.25 + 0.1 * u + 0.3 * imp);
        fa[slot * 2] = cov; fa[slot * 2 + 1] = cov;
        // spray from hard impacts (squared excess over ~0.7 m/s)
        const ex = (st.t > 0.55 ? imp : 0) - 1.0;                       // spray comes off the bow and flare, not the transom
        if (ex > 0 && Math.random() < ex * ex * dt * 8) {
          const n = 1 + Math.floor(ex * 3);
          for (let q = 0; q < n; q++) {
            tmp.set(y, z + 0.03, -st.x).applyMatrix4(M);
            nrm.set(sideSign, 0.45, 0.25).transformDirection(M);          // outward, low, and slightly aft
            const sp = imp * (0.6 + Math.random() * 0.9);
            vel.set(bvx * 0.7 + nrm.x * sp + (Math.random() - 0.5) * 0.4, nrm.y * sp + Math.random() * 0.3, bvz * 0.7 + nrm.z * sp + (Math.random() - 0.5) * 0.4);
            this.emit(tmp, vel, 0.05 + Math.random() * 0.09);
          }
        }
      }
    }
    this.foam.geometry.attributes.position.needsUpdate = true;
    this.foam.geometry.attributes.a.needsUpdate = true;
    // advance droplets: gravity + air drag, gone when they fall back into the sea
    const P = this.pos, Vv = this.vel, L = this.life;
    const sea = b.heave;
    for (let i = 0; i < POOL; i++) {
      if (L[i] <= 0) continue;
      Vv[i * 3 + 1] -= 9.81 * dt;
      const drag = Math.exp(-dt * 0.6);
      Vv[i * 3] *= drag; Vv[i * 3 + 2] *= drag;
      P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      L[i] -= dt * 0.7;
      if (P[i * 3 + 1] < sea - 0.2) L[i] = 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.life.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.points); }
}
