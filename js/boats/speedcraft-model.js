// The drawing of a speed machine (js/speedcraft.js): built from the same geometry the physics flies, so every surface
// is drawn where its forces act: the wing (turned by its trim about its spar), the foil and its stub, the rudder, the
// skeg, the floats on their struts, the fuselage, the beam. Vestas Sailrocket 2 as photographed (sailrocket.com
// gallery, 2011-2012): a glossy orange fuselage and beam, black sled floats, a wing of translucent film over dark ribs
// with a dark leading edge and a white panel low on the middle wing, the extension at its foot white. (Lettering is
// the craft's name as text; no logos.)
// Frames: the class's (x along her travel, y starboard, z up, about her origin: js/speedcraft.js craftOrigin) ->
// three.js boat-local (x starboard, y up, z aft), as js/models.js V; the body frame of the physics (SNAME, z down)
// likewise through B.
import * as THREE from 'three';
import { MODEL_HOOKS } from '../models.js';
import { HullSplash } from '../splash.js';
import { KT, G } from '../env.js';

const V3 = (x, y, z) => new THREE.Vector3(y, z, -x);
const B = (p) => new THREE.Vector3(p[1], -p[2], -p[0]);            // body (SNAME) point -> boat-local
const Bd = (d) => new THREE.Vector3(d[1], -d[2], -d[0]);           // body direction -> boat-local
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

const cache = {};
const mat = (k, f) => cache[k] || (cache[k] = f());
function canvas(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const M = {
  orange: (c) => mat('sr-or' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.22, metalness: 0.05 })),
  black: () => mat('sr-blk', () => new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.42, metalness: 0.1 })),
  carbon: () => mat('sr-cb', () => new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.3, metalness: 0.35 })),
  white: () => mat('sr-wh', () => new THREE.MeshStandardMaterial({ color: 0xeef0f0, roughness: 0.35, side: THREE.DoubleSide })),
  steel: () => mat('sr-st', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.2, metalness: 0.9 })),
  wire: () => mat('sr-wire', () => new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.5, metalness: 0.6 })),
  dark: () => mat('sr-dk', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.6 })),
};
// the wing's film: ribs every ~0.55 m of span, the dark leading edge (the spar's fairing), the trim flap's hinge line on
// the middle wing, the white panel low on the middle wing with the name across the chord
function wingTex(text) {
  return canvas(512, 1024, (g, w, h) => {
    g.fillStyle = '#d9dee2'; g.fillRect(0, 0, w, h);
    const v = (f) => h * (1 - f);                                    // (v up the span)
    g.fillStyle = '#eef0ef'; g.fillRect(0.12 * w, v(0.43), 0.86 * w, v(0.22) - v(0.43));    // the white panel
    g.save(); g.translate(0.55 * w, v(0.325)); g.fillStyle = '#2b2d30'; g.font = 'bold 92px Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 0); g.restore();
    g.fillStyle = 'rgba(30,32,36,0.85)'; for (let k = 0; k <= 15; k++) g.fillRect(0, v(k / 15) - 3, w, 6);           // ribs
    g.fillStyle = '#2a2c30'; g.fillRect(0, 0, 0.12 * w, h);                                                          // leading edge
    g.fillStyle = 'rgba(40,42,46,0.6)'; g.fillRect(0.78 * w, v(0.86), 4, v(0.45) - v(0.86));                        // trim flap hinge
    g.fillStyle = 'rgba(40,42,46,0.7)'; g.fillRect(0, v(0.22) - 4, w, 8); g.fillRect(0, v(0.86) - 4, w, 8);          // element joints
  });
}
function textTex(text, color, w = 1024, h = 128, font = 'bold 84px Helvetica, Arial, sans-serif') {
  return canvas(w, h, (g) => { g.clearRect(0, 0, w, h); g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2); });
}

// a straight lifting surface in the boat-local frame: sections (unit chord, LE at 0) placed along the span from root,
// the chord direction cDir (LE -> TE) and the thickness direction nDir; pivot: the chordwise station of the spar
function surfaceGeom(root, sDir, len, chords, cDir, nDir, section, nSpan = 12, pivot = 0.25) {
  const ns = section.length, pos = [], uv = [], idx = [];
  for (let k = 0; k <= nSpan; k++) {
    const f = k / nSpan, c = lerp(chords[0], chords[1], f);
    for (let i = 0; i < ns; i++) {
      const [x, y] = section[i];
      const p = root.clone().addScaledVector(sDir, len * f).addScaledVector(cDir, (x - pivot) * c).addScaledVector(nDir, y * c);
      pos.push(p.x, p.y, p.z); uv.push(x, f);
    }
  }
  for (let k = 0; k < nSpan; k++) for (let i = 0; i < ns - 1; i++) { const a = k * ns + i, b = a + ns; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // the end caps
  const cap = (k) => { const c0 = pos.length / 3; const cen = new THREE.Vector3(); for (let i = 0; i < ns; i++) cen.add(new THREE.Vector3(pos[(k * ns + i) * 3], pos[(k * ns + i) * 3 + 1], pos[(k * ns + i) * 3 + 2])); cen.multiplyScalar(1 / ns); pos.push(cen.x, cen.y, cen.z); uv.push(0.5, k ? 1 : 0); for (let i = 0; i < ns - 1; i++) idx.push(c0, k * ns + i, k * ns + i + 1); };
  cap(0); cap(nSpan);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// a NACA 00xx section (closed, LE -> TE upper, TE -> LE lower), camber m at 40%
function naca(t, m = 0, n = 14) {
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < 0.4 ? m / 0.16 * (0.8 * x - x * x) : m / 0.36 * (0.2 + 0.8 * x - x * x));
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) { const x = (1 - Math.cos(Math.PI * i / n)) / 2; up.push([x, yc(x) + yt(x)]); lo.push([x, yc(x) - yt(x)]); }
  return [...up, ...lo.reverse().slice(1)];
}
// a wedge: sharp leading edge, flat faces, blunt base t_b
const wedge = (tb) => [[0, 0], [1, tb / 2], [1, -tb / 2], [0, 0]];
// a body of revolution (elliptic sections, w x h) along a line from a to b, radius profile r(t) (t 0 at a .. 1 at b)
function bodyGeom(a, b, r, w = 1, h = 1, n = 40, m = 20) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length(); d.normalize();
  const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(d, up).normalize(), u2 = new THREE.Vector3().crossVectors(side, d).normalize();
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, c = a.clone().addScaledVector(d, L * t), rr = Math.max(0.002, r(t));
    for (let j = 0; j <= m; j++) { const q = j / m * Math.PI * 2, p = c.clone().addScaledVector(side, Math.cos(q) * rr * w).addScaledVector(u2, Math.sin(q) * rr * h); pos.push(p.x, p.y, p.z); uv.push(t, j / m); }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const p = i * (m + 1) + j, q = p + m + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function rod(a, b, r, m, seg = 8) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1); g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(a.x, a.y, a.z);
  const o = new THREE.Mesh(g, m); o.castShadow = true; return o;
}
// a sled float: a V'd planing bottom (deadrise beta), its bow swept up (rocker), a rounded deck; its keel at the transom
// at the origin, x forward along the travel (boat-local: -z)
function sledGeom(P) {
  const len = P.len, hb = P.b / 2, D = P.depthMax ?? 0.3, n = 18, m = 12, pos = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = t * len;
    const plan = Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.45) / 0.55, 2))) * 0.85 + 0.15 * (t < 0.45 ? 1 : 0), w = hb * Math.min(1, plan * 1.15);
    const rk = t > 0.75 ? Math.pow((t - 0.75) / 0.25, 2) * (D * 0.75) : 0;      // rocker
    const zk = rk, zc = zk + Math.tan(P.beta || 0) * w, zt = D + 0.02 - 0.05 * Math.pow(Math.abs(t - 0.45) / 0.55, 2);
    for (let j = 0; j <= m; j++) {
      const q = j / m;                         // 0 keel, around the chine and deck back to the keel
      let y, z;
      if (q < 0.25) { const s = q / 0.25; y = w * s; z = lerp(zk, zc, s); }
      else if (q < 0.75) { const s = (q - 0.25) / 0.5, a = s * Math.PI; y = w * Math.cos(a) * 1.0; z = zc + (Math.max(zt, zc + 0.02) - zc) * Math.sin(a); if (s > 0.5) y = -w * Math.abs(Math.cos(a)); }
      else { const s = (q - 0.75) / 0.25; y = -w * (1 - s); z = lerp(zc, zk, s); }
      const p = V3(x, y, z); pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const a = i * (m + 1) + j, b = a + m + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  // transom and bow caps
  for (const i of [0, n]) { const c = pos.length / 3; let cx = 0, cy = 0, cz = 0; for (let j = 0; j <= m; j++) { cx += pos[(i * (m + 1) + j) * 3]; cy += pos[(i * (m + 1) + j) * 3 + 1]; cz += pos[(i * (m + 1) + j) * 3 + 2]; } pos.push(cx / (m + 1), cy / (m + 1), cz / (m + 1)); for (let j = 0; j < m; j++) idx.push(c, i * (m + 1) + j, i * (m + 1) + j + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildSpeedModel(b, opts = {}) {
  const C = b.cls, L = C.look, S = C.speed, o = b.origin;
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const add = (geomOrMesh, m, name) => { const mesh = geomOrMesh.isMesh ? geomOrMesh : new THREE.Mesh(geomOrMesh, m); mesh.castShadow = true; mesh.receiveShadow = true; if (name) mesh.name = name; inner.add(mesh); return mesh; };
  // the fuselage frame (turned by the crab) about her origin, z up -> boat-local
  const cc = Math.cos(L.crab), sc = Math.sin(L.crab);
  const F = (fx, fy, z) => V3(fx * cc - fy * sc - o[0], fx * sc + fy * cc - o[1], z);
  const orange = M.orange(opts.hullColor ?? L.orange);
  // ---- the fuselage: a smooth torpedo, its nose blunt and round, deepest a third back from it, tapering to the stern
  const fu = L.fus, Lf = fu.x1 - fu.x0;
  const prof = (t) => { // t 0 stern .. 1 nose
    if (t > 0.66) return fu.r * Math.sqrt(Math.max(0, 1 - ((t - 0.66) / 0.34) ** 2));
    return fu.r * (0.2 + 0.8 * Math.sin(Math.PI / 2 * Math.pow(t / 0.66, 0.7)));
  };
  const hull = add(bodyGeom(F(fu.x0, 0, fu.z), F(fu.x1, 0, fu.z), prof, 1.0, 0.92, 60, 24), orange, 'fuselage');
  // the cockpit opening, forward (the pilot sits deep in it: node/517), a dark recess in the top of the fuselage
  {
    const cx = fu.x0 + 0.78 * Lf, rr = prof(0.78);
    const g = bodyGeom(F(cx - 0.55, 0, fu.z + rr * 0.86), F(cx + 0.45, 0, fu.z + rr * 0.86), (t) => 0.24 * Math.sqrt(Math.max(0, Math.sin(Math.PI * t))), 1.0, 0.25, 16, 16);
    add(g, M.dark(), 'cockpit');
  }
  // the name along both sides of the fuselage (text)
  {
    const tex = textTex(L.name, '#1b1c1e'), m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), m), c = F(fu.x0 + 0.5 * Lf, side * (prof(0.5) + 0.005), fu.z + 0.05);
      pm.position.copy(c); pm.rotation.set(0, -Math.PI / 2 * side - L.crab * 0 + (side > 0 ? 0 : 0), 0);
      // (the plane faces outward, its text running along the fuselage)
      pm.lookAt(c.clone().add(V3(-sc * side, cc * side, 0)));
      inner.add(pm);
    }
  }
  // ---- the beam: a faired section from the fuselage's stern to the wing's foot
  const beamA = F(L.xb, 0, L.beamZ), beamB = F(L.xb, L.beamY, L.beamZ);
  add(bodyGeom(beamA, beamB, (t) => 0.13 * (1 - 0.25 * t), 1.0, 0.55, 20, 16), orange, 'beam');
  {
    const tex = textTex(L.text, '#1b1c1e', 512, 128, 'bold 90px Helvetica, Arial, sans-serif'), m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const side of [-1, 1]) {
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), m), c = F(L.xb + side * 0.095, L.beamY * 0.82, L.beamZ);
      pm.position.copy(c); pm.lookAt(c.clone().add(V3(cc * side, sc * side, 0)));
      inner.add(pm);
    }
  }
  // ---- the wing: built at zero trim about its spar, in a pivot turned each frame by the trim
  const W = b.wing, sp = W.spec, wRoot = B(sp.root), sD = Bd(W.s).normalize(), c0 = Bd(W.c0).normalize(), n0 = Bd(W.n0).normalize();
  const camber = (S.wing.sec.alpha0 ? 0.02 : 0) * (n0.dot(new THREE.Vector3().crossVectors(sD, c0)) > 0 ? 1 : -1);
  const wingPivot = new THREE.Group(); wingPivot.position.copy(wRoot); inner.add(wingPivot);
  const wingMat = mat('sr-wing', () => new THREE.MeshStandardMaterial({ map: wingTex(L.text), roughness: 0.45, transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: true }));
  const wingMesh = new THREE.Mesh(surfaceGeom(new THREE.Vector3(), sD, sp.len, sp.chord, c0, new THREE.Vector3().crossVectors(sD, c0).normalize(), naca(0.12, camber), 16, 0.25), wingMat);
  wingMesh.castShadow = true; wingMesh.name = 'wing'; wingPivot.add(wingMesh);
  // (the spar inside the leading third, carbon; its foot on the ball of the fillet)
  wingPivot.add(rod(new THREE.Vector3(), sD.clone().multiplyScalar(sp.len), 0.05, M.carbon(), 10));
  // the fillet: the fixed elbow at the beam's end, the ball joint, and the extension reaching outboard (white)
  add(bodyGeom(beamB, wRoot, () => 0.16, 1.0, 1.0, 6, 14), orange, 'fillet');
  add(new THREE.SphereGeometry(0.11, 14, 10).translate(wRoot.x, wRoot.y, wRoot.z), M.steel(), 'ball');
  if (b.extension) {
    const E = b.extension, es = E.spec;
    const g = surfaceGeom(B(es.root), Bd(E.s).normalize(), es.len, es.chord, Bd(E.ch).normalize(), new THREE.Vector3().crossVectors(Bd(E.s), Bd(E.ch)).normalize(), naca(0.1), 6, 0.25);
    add(g, M.white(), 'wing extension');
  }
  // the compression strut from the beam to the lower wing (on its windward side), and the shrouds from the tip to the
  // fuselage: forward to the nose, aft to the stub
  const tip = wRoot.clone().addScaledVector(sD, sp.len);
  const strutTop = wRoot.clone().addScaledVector(sD, 0.32 * sp.len), strutFoot = F(L.xb, L.beamY * 0.55, L.beamZ + 0.1);
  add(rod(strutFoot, strutTop, 0.03, M.carbon()), null, 'compression strut');
  add(rod(tip, F(fu.x1 - 0.35, 0, fu.z + prof(0.965) * 0.8), 0.006, M.wire(), 4), null, 'shroud fwd');
  add(rod(tip, F(L.xb + 0.6, 0.15, fu.z + prof(0.06) * 0.6 + 0.12), 0.006, M.wire(), 4), null, 'shroud aft');
  // ---- the foil: its stub off the fuselage's windward side, the inclined leg, the L's foot, the fences
  const f0 = b.foils[0], f1 = b.foils[1];
  const stubA = F(L.foilTop[0], 0.2, L.fus.z - 0.1), stubB = B(f0.spec.root);
  add(bodyGeom(stubA, stubB.clone().add(new THREE.Vector3(0, 0.05, 0)), (t) => 0.12 * (1 - 0.3 * t), 1.0, 0.6, 16, 14), orange, 'foil stub');
  for (const f of [f0, f1]) {
    if (!f) continue;
    const s = Bd(f.s).normalize(), c = Bd(f.ch).normalize(), nn = new THREE.Vector3().crossVectors(s, c).normalize();
    add(surfaceGeom(B(f.spec.root), s, f.spec.len, Array.isArray(f.spec.chord) ? f.spec.chord : [f.spec.chord, f.spec.chord], c, nn, wedge(f.spec.sec.tb ?? 0.12), 10, 0.0), M.carbon(), f.spec.name);
  }
  {
    // the fences, both faces, at the curved transition (node/595)
    const s = Bd(f0.s).normalize(), c = Bd(f0.ch).normalize(), nn = new THREE.Vector3().crossVectors(s, c).normalize();
    const at = B(f0.spec.root).addScaledVector(s, f0.spec.len * 0.62);
    const ch = Array.isArray(f0.spec.chord) ? f0.spec.chord[0] : f0.spec.chord;
    const g = new THREE.BoxGeometry(0.004, 0.09, ch * 0.9);
    const m = new THREE.Mesh(g, M.carbon());
    m.position.copy(at.clone().addScaledVector(c, ch * 0.45));
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(s, nn, c));
    m.name = 'fences'; inner.add(m);
  }
  // ---- the floats on their struts, the rudder under the front one, the skeg under the rear one
  const pods = [];
  for (const pd of b.pods) {
    const P = pd.P, g = sledGeom(P), k = B(pd.keel);
    const m = add(g, M.black(), 'float ' + P.name); m.position.copy(k);
    // (its strut up to the fuselage or the beam above it)
    const top = pd.P.name === 'leeward' ? F(L.xb, L.beamY + 0.25, L.beamZ - 0.08) : null;
    const mid = k.clone().add(V3(P.len * 0.5, 0, 0));
    const strutA = mid.clone().add(new THREE.Vector3(0, (P.depthMax ?? 0.3), 0));
    let strutB;
    if (top) strutB = top;
    else { strutB = strutA.clone(); strutB.y = L.fus.z - 0.15; }
    add(bodyGeom(strutA.clone().add(new THREE.Vector3(0, -0.05, 0)), strutB, () => 0.05, 1, 2.2, 4, 10), M.steel(), 'strut ' + P.name);
    pods.push(m);
  }
  const rudders = [];
  for (const R of b.rudders) {
    const s = Bd(R.s).normalize(), c = Bd(R.c0).normalize(), nn = new THREE.Vector3().crossVectors(s, c).normalize();
    const pv = new THREE.Group(); pv.position.copy(B(R.spec.root)); inner.add(pv);
    const g = surfaceGeom(new THREE.Vector3(0, 0.05, 0), s, R.spec.len + 0.05, Array.isArray(R.spec.chord) ? R.spec.chord : [R.spec.chord, R.spec.chord], c, nn, R.spec.sec.kind === 'wedge' ? wedge(R.spec.sec.tb ?? 0.1) : naca(R.spec.sec.tc ?? 0.1), 4, 0.2);
    const m = new THREE.Mesh(g, R.spec.fixed ? M.carbon() : M.carbon()); m.castShadow = true; m.name = R.spec.name; pv.add(m);
    rudders.push({ R, pv, s });
  }
  const vis = { root, inner, hull, deck: hull, speed: true, wingPivot, wingAxis: sD, rudders, pods, player: !!opts.player, booms: {}, sailMeshes: {}, lines: null,
    windex: new THREE.Object3D(), rudderPivot: new THREE.Object3D() };
  root.traverse((m) => { if (m.isMesh) m.frustumCulled = true; });
  return vis;
}

export function updateSpeedModel(vis, b, t) {
  const P = b.pose || b;
  vis.root.position.set(P.x, P.heave + (P.seaDh || 0), P.z);
  vis.root.rotation.set(0, -P.psi, 0);
  vis.inner.rotation.set(P.pitch + (P.seaDp || 0), 0, -P.phi, 'YXZ');
  // the wing turned about its spar by its trim (the physics' chord: c0 turned toward n0 by delta)
  const W = b.wing, sgn = Math.sign(new THREE.Vector3(...W.n0).dot(new THREE.Vector3().crossVectors(new THREE.Vector3(...W.s), new THREE.Vector3(...W.c0)))) || 1;
  vis.wingPivot.quaternion.setFromAxisAngle(vis.wingAxis, sgn * (W.delta || 0));
  for (const r of vis.rudders) {
    const R = r.R;
    if (R.spec.retract) { r.pv.visible = !R.up; continue; }
    const s2 = Math.sign(new THREE.Vector3(...R.n0).dot(new THREE.Vector3().crossVectors(new THREE.Vector3(...R.s), new THREE.Vector3(...R.c0)))) || 1;
    r.pv.quaternion.setFromAxisAngle(r.s, s2 * (R.delta || 0));
  }
}

// spray off a speed machine: sheets thrown from each planing float's spray root (forward and out to both sides at
// about the speed it meets the water: a planing surface's whisker spray leaves the spray root at the planing speed,
// Savitsky, DeLorme & Datla 2007), the plume the foil and the rudder pull out where they pierce the surface, foam in
// the floats' wakes
export class SpeedSpray extends HullSplash {
  update(dt, t, env) {
    const b = this.b;
    if (dt <= 0 || !b.pods) return;
    dt = Math.min(dt, 0.05);
    const ps = Math.sin(b.psi), pc = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const R = b._rot ? b._rot() : null, wp = {};
    const bvx = b.vgx || 0, bvz = b.vgz || 0, V = Math.hypot(bvx, bvz);
    this._acc = (this._acc || 0) + dt;
    const rate = clamp(V / 3, 0, 1) * 220 * dt;                // drops a second off one float at speed
    for (const pd of b.pods) {
      const o = pd.out; if (!o || !(o.L > 30) || pd.d <= 0) continue;
      const wl = Math.max(0.05, (o.lam || 0.1) * pd.P.b), x0 = pd.keel[0] + wl;
      const n = Math.min(12, rate * clamp(o.L / 1500, 0.2, 1.5)) | 0;
      for (let k = 0; k < n; k++) {
        const side = Math.random() < 0.5 ? -1 : 1, p = b.worldOf([x0 - Math.random() * 0.2, pd.keel[1] + side * pd.P.b * 0.5, pd.keel[2] - 0.02], wp);
        const out = (0.35 + 0.25 * Math.random()) * V, up = (0.12 + 0.18 * Math.random()) * V, back = 0.45 + 0.3 * Math.random();
        this.emit(p.x, Math.max(0.02, p.y), p.z, bvx * back + sx * side * out, up, bvz * back + sz * side * out, 0.05 + 0.08 * Math.random(), 0, 0.6);
      }
      if (Math.random() < dt * 8 * clamp(V / 5, 0, 1)) { const p = b.worldOf([pd.keel[0], pd.keel[1], 0], wp); this.spawnPatch(p.x, p.z, bvx * 0.15, bvz * 0.15, 0.3 + pd.P.b, 0.8, 0.3); }
    }
    // the surface-piercing foil and rudder: a plume aft of where they cut the surface
    for (const f of [...b.foils, ...b.rudders]) {
      if (f.spec.pierce === false || f.up || !f.diag || f.diag.imm <= 0 || f.diag.imm >= 1) continue;
      const S = f.strips.find((s) => s.d > -0.05 && s.d < 0.1) || f.strips[0];
      const n = Math.min(8, rate * 0.6) | 0;
      for (let k = 0; k < n; k++) {
        const p = b.worldOf([S.p[0] - 0.1, S.p[1], S.p[2]], wp);
        this.emit(p.x, Math.max(0.02, p.y + 0.02), p.z, bvx * 0.7 + (Math.random() - 0.5) * 0.1 * V, (0.08 + 0.12 * Math.random()) * V, bvz * 0.7 + (Math.random() - 0.5) * 0.1 * V, 0.04 + 0.06 * Math.random(), 0, 0.7);
      }
    }
    this.integrate(dt, t, env);
  }
}

// a foiler's foils (a sailing boat with C.hydrofoils: l'Hydroptère's), drawn into its model: each surface from the
// physics (js/physics.js Boat.hfoils), carbon; the elevator's flap turned with its control; titanium arms from the
// float to each main foil's head
export function buildFoils(b, inner) {
  const parts = [];
  for (const S of b.hfoils || []) {
    const sp = S.spec, s = Bd(S.s).normalize(), c = Bd(S.c0).normalize(), nn = new THREE.Vector3().crossVectors(s, c).normalize();
    const ch = Array.isArray(sp.chord) ? sp.chord : [sp.chord, sp.chord];
    const tc = (sp.sec && sp.sec.tc) || 0.1;
    if (sp.flap) {
      const pv = new THREE.Group(); pv.position.copy(B(sp.root)); inner.add(pv);
      const m = new THREE.Mesh(surfaceGeom(new THREE.Vector3(), s, sp.len, ch, c, nn, naca(tc, 0.02), 6, 0.3), M.carbon()); m.castShadow = true; m.name = sp.name; pv.add(m);
      parts.push({ S, pv, s });
    } else {
      const m = new THREE.Mesh(surfaceGeom(B(sp.root), s, sp.len, ch, c, nn, naca(tc, 0.02), 10, 0.25), M.carbon()); m.castShadow = true; m.name = sp.name; inner.add(m);
      if (/foil$/.test(sp.name)) {
        // (its arm: from the foil's head up to the beam's end over the float)
        const head = B(sp.root), top = head.clone(); top.y += 0.55; top.x += Math.sign(head.x) * 0.25;
        const a = rod(head, top, 0.07, M.steel(), 10); a.name = sp.name + ' arm'; inner.add(a);
      }
    }
  }
  return { update: (vis, b) => { for (const p of parts) { const S = p.S; p.pv.quaternion.setFromAxisAngle(p.s, Math.sign(new THREE.Vector3(...S.n0).dot(new THREE.Vector3().crossVectors(new THREE.Vector3(...S.s), new THREE.Vector3(...S.c0)))) * (S.delta || 0)); } } };
}
// spray where a foil cuts the surface at speed (a sheet thrown up off the leading edge, a ventilated plume behind)
export function foilSpray(sp, b, dt) {
  if (!b.hfoils || dt <= 0) return;
  const V = Math.hypot(b.vgx || 0, b.vgz || 0); if (V < 3) return;
  const cp = Math.cos(b.phi), sn = Math.sin(b.phi), ps = Math.sin(b.psi), pc = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
  for (const S of b.hfoils) {
    if (!(S.diag.imm > 0.02 && S.diag.imm < 0.98) || S.spec.pierce === false) continue;
    const st = S.strips.find((q) => q.d > -0.05 && q.d < 0.15); if (!st) continue;
    const x = st.p[0], y = st.p[1], z = -st.p[2];
    const yw = y * cp - z * sn, h = Math.max(0.02, b.heave + y * sn + z * cp);
    const wx = b.x + ps * x + sx * yw, wz = b.z + pc * x + sz * yw;
    const n = Math.min(10, (V / 3) * 40 * dt) | 0;
    for (let k = 0; k < n; k++) sp.emit(wx, Math.min(h, 0.3), wz, (b.vgx || 0) * 0.65 + (Math.random() - 0.5) * 0.15 * V, (0.1 + 0.15 * Math.random()) * V, (b.vgz || 0) * 0.65 + (Math.random() - 0.5) * 0.15 * V, 0.05 + 0.08 * Math.random(), 0, 0.65);
    if (Math.random() < dt * 6) sp.spawnPatch(wx, wz, (b.vgx || 0) * 0.1, (b.vgz || 0) * 0.1, 0.5, 0.7, 0.3);
  }
}
MODEL_HOOKS.foils = buildFoils;
MODEL_HOOKS.foilSpray = foilSpray;
MODEL_HOOKS.speedBuild = buildSpeedModel;
MODEL_HOOKS.speedUpdate = updateSpeedModel;
MODEL_HOOKS.speedSpray = SpeedSpray;
