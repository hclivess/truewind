// The sea's mirror: a planar reflection of the scene (boats, sails, land, buildings, lighthouses, lights at
// night) for the water shader, which bends it by the drawn wave normals and blurs it by the slopes too small to
// draw. The sky is not in it: the water reflects the sky from the sky's own cube and its full-resolution pass,
// and this layer goes over that where something stands between the sea and the sky.
//
// Each frame: the scene from the camera mirrored in the mean sea surface (y = 0), with an oblique near plane on
// that surface (the hulls below the waterline and the sea bed cut away), into a linear HDR target with a depth
// texture; then a copy into a mipmapped target whose alpha is the coverage (depth < 1), its colour premultiplied
// by it (the background is cleared to 0), so a blurred level is the true mean of the scene and of the sky
// showing between it. The water reads:
//  - the depth at the flat-water point: how far the reflected thing is from the water (D), for the bend
//    (a reflected ray turned by the wave normal meets the object D metres on: a hull a few metres off barely moves,
//    the hills two kilometres off break into long streaks, as on a real sea);
//  - the colour at that bent point, blurred by the reflected cone of the unresolved slopes over the path D, as
//    seen from the camera at dist + D (sharp at a hull's waterline, softer for far land; see REFL_GLSL), and never
//    finer than the pixel's own footprint in the target (no swimming).
// The quality ladder (governor.js REFL_LEVELS): the target's size as a fraction of the drawing buffer, down to
// none at all (the sky alone, as before) for a device that cannot keep its frame rate up.
import { REFL_LEVELS } from './governor.js';

const MARGIN = 1.12;

export class PlanarReflection {
  constructor(THREE, renderer, level = 0) {
    this.T = THREE; this.r = renderer;
    const ext = renderer.extensions;
    // a linear HDR target where it can be drawn into (WebGL2 with EXT_color_buffer_float / _half_float); else
    // 8 bits (the reflection clips at white, the rest stands)
    this.hdr = !!(ext && (ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float')));
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: true, samples: 0 });
    this.rtScene.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtScene.depthTexture.minFilter = this.rtScene.depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    // anisotropic filtering for the streaks (REFL_GLSL); 1 where the GPU has none
    this.rt.texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    this.cam = new THREE.PerspectiveCamera();
    this.cam.matrixAutoUpdate = true;
    this.U = {
      uRefl: { value: this.rt.texture }, uReflD: { value: this.rtScene.depthTexture },
      uReflM: { value: new THREE.Matrix4() }, uReflIP: { value: new THREE.Matrix4() },
      // x: on, w: the target's height in texels (its smallest footprint)
      uReflP: { value: new THREE.Vector4(0, 0, 0, 1) },
    };
    // the copy: coverage from depth into alpha
    this.copyU = { tC: { value: this.rtScene.texture }, tD: { value: this.rtScene.depthTexture } };
    this.copyScene = new THREE.Scene();
    this.copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.copyU, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tC; uniform sampler2D tD; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tC, vUv).rgb;
          float cov = texture2D(tD, vUv).r < 1.0 ? 1.0 : 0.0;
          // (the background was cleared to 0: what is there is premultiplied already, additive lights included)
          gl_FragColor = vec4(min(c, vec3(64.0)), cov);
        }`,
    }));
    q.frustumCulled = false; this.copyScene.add(q);
    this._v = { n: new THREE.Vector3(0, 1, 0), p: new THREE.Vector3(), cp: new THREE.Vector3(), rot: new THREE.Matrix4(), look: new THREE.Vector3(),
      tgt: new THREE.Vector3(), view: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(),
      bias: new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1) };
    this.w = 1; this.h = 1;
    this.setLevel(level);
  }
  setLevel(i) {
    this.level = Math.max(0, Math.min(REFL_LEVELS.length - 1, i | 0));
    this.L = REFL_LEVELS[this.level];
    this._size();
  }
  // the drawing buffer's size (px)
  resize(w, h) { this.w = w; this.h = h; this._size(); }
  _size() {
    const s = this.L.scale;
    if (!s) { this.U.uReflP.value.x = 0; return; }
    const w = Math.max(16, Math.round(this.w * s)), h = Math.max(16, Math.round(this.h * s));
    if (this.rt.width !== w || this.rt.height !== h) { this.rtScene.setSize(w, h); this.rt.setSize(w, h); }
  }
  // draw the mirror image of `scene` seen by `camera`, without the objects in `hide` (the water, the sky dome,
  // the rain); y0: the mean surface
  render(scene, camera, hide, y0 = 0) {
    const U = this.U, P = U.uReflP.value;
    if (!this.L.scale) { P.x = 0; return; }
    const v = this._v, cam = this.cam, r = this.r;
    camera.updateMatrixWorld();
    v.cp.setFromMatrixPosition(camera.matrixWorld);
    v.p.set(v.cp.x, y0, v.cp.z);
    // a camera under the surface (a capsize, a dive of the chase camera) sees no reflection from above
    if (v.cp.y <= y0 + 0.02) { P.x = 0; return; }
    // the mirrored camera (three.js Reflector): position, target and up reflected in the plane
    v.view.subVectors(v.p, v.cp).reflect(v.n).negate().add(v.p);
    v.rot.extractRotation(camera.matrixWorld);
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.cp);
    v.tgt.subVectors(v.p, v.look).reflect(v.n).negate().add(v.p);
    cam.position.copy(v.view);
    cam.up.set(0, 1, 0).applyMatrix4(v.rot).reflect(v.n);
    cam.lookAt(v.tgt);
    cam.near = camera.near; cam.far = camera.far;
    cam.updateMatrixWorld();
    // a field of view a little wider than the camera's: the bent rays of the near water look past its edges
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrix.elements[0] /= MARGIN; cam.projectionMatrix.elements[5] /= MARGIN;
    cam.layers.mask = camera.layers.mask;
    // the texture matrix: world -> the target's uv (before the oblique clip: the depth range is the same)
    U.uReflM.value.copy(v.bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane on the surface (Lengyel): nothing below it is drawn
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.p).applyMatrix4(cam.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const e = cam.projectionMatrix.elements;
    v.q.set((Math.sign(v.clip.x) + e[8]) / e[0], (Math.sign(v.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    e[2] = v.clip.x; e[6] = v.clip.y; e[10] = v.clip.z + 1 - 0.003; e[14] = v.clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    U.uReflIP.value.copy(cam.projectionMatrixInverse);
    P.w = this.rt.height;
    // draw: no shadow-map pass of its own (the main pass makes it), the dome and the like hidden, cleared to 0
    const prevRT = r.getRenderTarget(), prevAC = r.autoClear, prevSh = r.shadowMap.autoUpdate, prevNU = r.shadowMap.needsUpdate;
    const cc = r.getClearColor(this._cc || (this._cc = new this.T.Color())), ca = r.getClearAlpha();
    const vis = []; for (const o of hide) if (o && o.visible) { o.visible = false; vis.push(o); }
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = false;
    r.autoClear = true; r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtScene); r.render(scene, cam);
    r.setRenderTarget(this.rt); r.render(this.copyScene, this.copyCam);
    r.setRenderTarget(prevRT);
    r.setClearColor(cc, ca); r.autoClear = prevAC;
    r.shadowMap.autoUpdate = prevSh; r.shadowMap.needsUpdate = prevNU;
    for (const o of vis) o.visible = true;
    P.x = 1;
  }
  dispose() { this.rt.dispose(); this.rtScene.dispose(); }
}

// the water shader's part (render.js): refl, the sky's reflection, is overlaid with the scene's, bent by R (the
// reflected direction off the drawn normal) and blurred by sig (the unresolved slopes' rms, sqrt of their mean
// square slope over both axes); P: the surface point, dist: its distance from the camera, ey: the sine of the
// sight line's angle below the horizon.
// The blur is anisotropic, as a real sea's is: a slope along the sight line turns the reflected ray up or down by
// twice the slope, a slope across it turns it sideways by only twice the slope times tan(angle of view below the
// horizon), so at a low angle a far reflection is drawn out into vertical streaks and barely widened. Three taps
// along the vertical with gradients (anisotropic filtering where the GPU has it, an isotropic mip where not).
export const REFL_GLSL = /* glsl */`
uniform sampler2D uRefl; uniform sampler2D uReflD; uniform mat4 uReflM; uniform mat4 uReflIP; uniform vec4 uReflP;
vec2 reflUV(vec3 Q) { vec4 c = uReflM * vec4(Q, 1.0); return c.xy / max(c.w, 1e-4); }
vec3 reflScene(vec3 refl, vec3 P, vec3 R, float sig, float dist, float ey) {
  if (uReflP.x < 0.5) return refl;
  // the flat-water point's reflection: how far it travels from the water to what it meets
  vec2 uv0 = reflUV(vec3(P.x, 0.0, P.z));
  float dz = texture2D(uReflD, clamp(uv0, 0.0, 1.0)).r, D = 3000.0;
  if (dz < 1.0) { vec4 vp = uReflIP * vec4(uv0 * 2.0 - 1.0, dz * 2.0 - 1.0, 1.0); D = clamp(length(vp.xyz / vp.w) - dist, 0.3, 3000.0); }
  // the bent ray, D metres on, as the mirrored camera sees it; and how the target's uv turns with it (per radian)
  vec3 Rr = normalize(vec3(R.x, max(R.y, 0.005), R.z));
  vec3 eV = normalize(vec3(0.0, 1.0, 0.0) - Rr * Rr.y), eH = normalize(cross(Rr, vec3(0.0, 1.0, 0.0)) + 1e-6);
  vec2 ruv = reflUV(P + Rr * D);
  vec2 dV = (reflUV(P + normalize(Rr + eV * 0.01) * D) - ruv) * 100.0, dH = (reflUV(P + normalize(Rr + eH * 0.01) * D) - ruv) * 100.0;
  // the reflected rays' spread (rms, rad): vertical and sideways
  float sv = 1.4142 * sig, sh = sv * clamp(ey / sqrt(max(1.0 - ey * ey, 1e-4)), 0.03, 1.0);
  // the pixel's own footprint in the target (no finer: no swimming), then the filter widths
  vec2 fx = dFdx(ruv), fy = dFdy(ruv);
  float fp2 = max(dot(fx, fx), dot(fy, fy)), t2 = 1.0 / (uReflP.w * uReflP.w);
  vec2 gV = dV * sv * 1.6, gH = dH * sh * 3.0;
  gV *= sqrt(1.0 + (fp2 + t2) / max(dot(gV, gV), 1e-12)); gH *= sqrt(1.0 + (fp2 + t2) / max(dot(gH, gH), 1e-12));
  vec2 st = dV * sv * 1.2;
  vec4 s = 0.5 * textureGrad(uRefl, ruv, gH, gV) + 0.25 * (textureGrad(uRefl, ruv - st, gH, gV) + textureGrad(uRefl, ruv + st, gH, gV));
  vec2 e = min(ruv, 1.0 - ruv);
  s *= smoothstep(0.0, 0.02, min(e.x, e.y));
  return refl * (1.0 - s.a) + s.rgb;
}
`;
