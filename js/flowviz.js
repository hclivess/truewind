// The air over the sails (Shift+F): streamlines of the apparent wind with what the sails do to it, the velocity the
// sails' vortex lattice induces (js/sail/vlm.js velocityAt) added to the free stream the cloth meets (sailsim airAt:
// the wind gradient, the boat's own motion, roll and yaw). Seeded on a grid upwind of the rig, integrated through the
// boat's heeled frame and drawn there: they bend round the luffs, crowd and speed up over the leeward sides (red),
// slow and spread on the windward sides and in the main's lee behind a jib (blue). Streaks run downstream at the
// air's speed. A few lines are recomputed each frame (each costs a lattice evaluation per step), so the picture
// follows a trim or a tack within half a second.
import * as THREE from 'three';

const NU = 7, NV = 5, NL = NU * NV, NP = 56;          // lines across x up, points per line
const NS = NP - 1;                                     // segments per line, each a screen-space ribbon (4 vertices)

// (WebGL draws lines one pixel wide: each segment is a quad widened on the screen, a few pixels whatever the distance)
const VERT = `
attribute vec3 aOther; attribute float aSide; attribute float aS; attribute float aU;
uniform vec2 uRes; uniform float uW;
varying float vS; varying float vU; varying float vSide;
void main() {
  vS = aS; vU = aU; vSide = aSide;
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0), b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
  vec2 sa = a.xy / max(a.w, 1e-4) * uRes, sb = b.xy / max(b.w, 1e-4) * uRes;
  vec2 d = normalize(sb - sa + vec2(1e-6, 0.0)), n = vec2(-d.y, d.x);
  a.xy += n * aSide * uW / uRes * a.w;
  gl_Position = a;
}`;
const FRAG = `
uniform float uT; varying float vS; varying float vU; varying float vSide;
void main() {
  // speed against the free stream: violet slowed, cyan as it came, yellow to red sped up
  vec3 slow = vec3(0.55, 0.35, 1.0), base = vec3(0.2, 0.95, 1.0), quick = vec3(1.0, 0.9, 0.2), fast = vec3(1.0, 0.25, 0.15);
  vec3 c = vU < 1.0 ? mix(slow, base, clamp((vU - 0.7) / 0.3, 0.0, 1.0))
         : vU < 1.15 ? mix(base, quick, (vU - 1.0) / 0.15) : mix(quick, fast, clamp((vU - 1.15) / 0.2, 0.0, 1.0));
  float streak = 0.3 + 0.7 * smoothstep(0.5, 0.95, fract(vS * 0.16 - uT));
  float edge = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
  gl_FragColor = vec4(c, 0.95 * streak * edge);
}`;

export class FlowViz {
  constructor(scene) {
    const geo = new THREE.BufferGeometry(), nv = NL * NS * 4;
    this.pos = new Float32Array(nv * 3); this.oth = new Float32Array(nv * 3);
    this.s = new Float32Array(nv); this.u = new Float32Array(nv);
    const side = new Float32Array(nv), idx = new Uint32Array(NL * NS * 6);
    for (let q = 0; q < NL * NS; q++) {
      const v = 4 * q; side[v] = -1; side[v + 1] = 1; side[v + 2] = -1; side[v + 3] = 1;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], 6 * q);
    }
    const dyn = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', dyn(this.pos, 3)); geo.setAttribute('aOther', dyn(this.oth, 3));
    geo.setAttribute('aS', dyn(this.s, 1)); geo.setAttribute('aU', dyn(this.u, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uRes: { value: new THREE.Vector2(800, 450) }, uW: { value: 2.2 } } });
    this.lines = new THREE.Mesh(geo, this.mat);
    this.lines.frustumCulled = false; this.lines.matrixAutoUpdate = false; this.lines.renderOrder = 5;
    this.lines.visible = false;
    scene.add(this.lines);
    this.next = 0; this.t = 0; this.b = null;
    this._p = { x: 0, y: 0, z: 0 }; this._v = [0, 0, 0];
  }

  hide() { this.lines.visible = false; }

  // the air's velocity at a point of the boat's heeled frame (x forward, y to starboard, z up)
  air(b, x, y, z, out) {
    const S = b.sailSys, ax = b._ax, p = this._p;
    S.airAt(b, x, y, z, ax, null, p);
    let vx = p.x, vy = p.y, vz = p.z;
    const L = S.L;
    if (L && L.g && L.nSeg) { const v = L.velocityAt(L.g, x, y, z, this._v); vx += v[0]; vy += v[1]; vz += v[2]; }
    out[0] = vx; out[1] = vy; out[2] = vz; return out;
  }

  // one streamline, k of NL, into the buffers
  trace(b, k) {
    const C = b.cls, Lb = C.loa, mh = C.mastHeight || Lb, S = b.sailSys;
    const v = [0, 0, 0], v2 = [0, 0, 0];
    // the free stream at mid-rig: the seeds lie across it, a boat length upwind of the mast
    const zc = 0.5 * mh, xc = C.mastX ?? 0;
    S.airAt(b, xc, 0, zc, b._ax, null, this._p);
    const f0 = Math.hypot(this._p.x, this._p.y) || 1, ux = this._p.x / f0, uy = this._p.y / f0;
    const iu = k % NU, iv = (k - iu) / NU;
    const span = Math.max(0.45 * Lb, C.beam);
    const lat = (iu / (NU - 1) - 0.5) * 2 * span, h = (0.12 + 0.8 * iv / (NV - 1)) * mh;
    let x = xc - ux * 0.9 * Lb - uy * lat, y = -uy * 0.9 * Lb + ux * lat, z = h;
    const ds = 2.4 * Lb / (NP - 1);
    let s = 0, q = k * NS * 4;
    let px = x, py = y, pz = z, pu = 1;
    const put = (vi, X, Y, Z, OX, OY, OZ, S_, U) => { const o = 3 * vi; this.pos[o] = X; this.pos[o + 1] = Y; this.pos[o + 2] = Z; this.oth[o] = OX; this.oth[o + 1] = OY; this.oth[o + 2] = OZ; this.s[vi] = S_; this.u[vi] = U; };
    for (let i = 1; i < NP; i++) {
      // midpoint (RK2) along the unit direction: the step is a length, not a time
      this.air(b, x, y, z, v); let n = Math.hypot(v[0], v[1], v[2]) || 1;
      const mx = x + 0.5 * ds * v[0] / n, my = y + 0.5 * ds * v[1] / n, mz = z + 0.5 * ds * v[2] / n;
      this.air(b, mx, my, mz, v2); n = Math.hypot(v2[0], v2[1], v2[2]) || 1;
      const sp = Math.min(2, n / f0);
      x += ds * v2[0] / n; y += ds * v2[1] / n; z = Math.max(0.05, z + ds * v2[2] / n);
      // (the quad: both ends twice, each with a point further along the line, so both ends see the same direction on
      // the screen and widen to the same sides)
      put(q, px, py, pz, x, y, z, s, pu); put(q + 1, px, py, pz, x, y, z, s, pu);
      put(q + 2, x, y, z, 2 * x - px, 2 * y - py, 2 * z - pz, s + ds, sp); put(q + 3, x, y, z, 2 * x - px, 2 * y - py, 2 * z - pz, s + ds, sp);
      s += ds; q += 4; px = x; py = y; pz = z; pu = sp;
    }
  }

  update(b, dt, w = 800, h = 450) {
    this.mat.uniforms.uRes.value.set(w / 2, h / 2);
    const S = b && b.sailSys;
    if (!S || !b._ax || !b._ax.env || !S.airAt) { this.lines.visible = false; return; }
    if (this.b !== b) { this.b = b; this.next = 0; for (let k = 0; k < NL; k++) this.trace(b, k); }
    else for (let n = 0; n < 4; n++) { this.trace(b, this.next); this.next = (this.next + 1) % NL; }
    const g = this.lines.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aOther.needsUpdate = true; g.attributes.aS.needsUpdate = true; g.attributes.aU.needsUpdate = true;
    // the heeled frame in the world: forward, starboard heeled, up heeled (the hull's yaw, heel and heave)
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi), c = Math.cos(b.phi), s = Math.sin(b.phi);
    this.lines.matrix.set(
      fx, sx * c, sx * s, b.x,
      0, -s, c, b.heave || 0,
      fz, sz * c, sz * s, b.z,
      0, 0, 0, 1);
    this.lines.matrixWorldNeedsUpdate = true;
    // (the streaks run at about the air's speed past the boat)
    const aws = b.diag.aws || 5;
    this.t += dt * aws * 0.18; this.mat.uniforms.uT.value = this.t % 1000;
    this.lines.visible = true;
  }
}
