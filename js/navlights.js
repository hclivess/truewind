// A yacht's navigation lights at night (COLREGS rule 25: a sailing vessel under way shows sidelights and a
// sternlight): red to port and green to starboard, each from dead ahead to 22.5 deg abaft the beam (112.5 deg),
// white astern over the remaining 135 deg. Each is a glowing point (a hot core and a soft halo) that keeps a few
// pixels at any distance, so a boat stays visible as her lights when the camera backs off at night, and the sea
// reflects them (reflect.js) as a broken column of glitter. They fade in at dusk with the traffic's lights.
import * as THREE from 'three';
import { V } from './models.js';

const U = { uOn: { value: 0 }, uScale: { value: 500 }, uPx: { value: 1 } };
let MAT = null;
function material() {
  if (MAT) return MAT;
  MAT = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute vec2 aSec; uniform float uOn; uniform float uScale; uniform float uPx; varying vec3 vC;
      void main() {
        // the camera's bearing from the light in the boat's frame (0 dead ahead, +90 deg to starboard)
        vec3 c = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - position;
        float th = degrees(atan(c.x, -c.z));
        float dth = abs(mod(th - aSec.x + 180.0, 360.0) - 180.0);
        float vis = 1.0 - smoothstep(aSec.y - 1.5, aSec.y + 1.5, dth);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = max(-mv.z, 0.1);
        vC = aCol * uOn * vis * exp(-d * 0.00012);
        gl_PointSize = vis * uOn > 0.0 ? clamp(0.7 * uScale / d, 2.5 * uPx, 12.0 * uPx) : 0.0;
        gl_Position = projectionMatrix * mv;
        gl_Position.z -= 0.001 * gl_Position.w;     // (in front of the housing it sits on)
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        // (broad enough that a point of the smallest size, 2.5 px, is still lit across: a light miles off)
        float core = exp(-r2 * 6.0) * 1.8, halo = (1.0 - r2) * 0.3;
        gl_FragColor = vec4(vC * (core + halo) + vec3(core * 0.25) * max(max(vC.r, vC.g), vC.b), 1.0);
      }`,
  });
  return MAT;
}

// the lights of a boat, in vis.inner (its heeled, pitched frame); C: the class
export function addNavLights(vis, C) {
  if (!vis || !vis.inner || !C) return null;
  const ny = (C.beam || 2) * 0.4, zs = (C.freeboard || 0.8) + 0.15;
  const pts = [
    [V(C.bowX - 0.3, -ny, zs), [2.2, 0.08, 0.06], [-56.25, 56.25]],      // port: red
    [V(C.bowX - 0.3, ny, zs), [0.06, 1.9, 0.5], [56.25, 56.25]],          // starboard: green
    [V(C.sternX + 0.05, 0, zs + 0.1), [1.4, 1.3, 1.15], [180, 67.5]],      // stern: white
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p[0].x, p[0].y, p[0].z]), 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(pts.flatMap((p) => p[1]), 3));
  g.setAttribute('aSec', new THREE.Float32BufferAttribute(pts.flatMap((p) => p[2]), 2));
  const m = new THREE.Points(g, material());
  m.frustumCulled = false; m.renderOrder = 5;
  vis.inner.add(m);
  return m;
}

// every frame: night 0..1, the drawing buffer's height (px), the camera's vertical field of view (deg), the pixel ratio
export function tickNavLights(night, heightPx, fovDeg, pr) {
  U.uOn.value = night;
  U.uScale.value = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
  U.uPx.value = pr;
}
