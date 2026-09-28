// Engine hardware on the boat model: an outboard on its transom bracket (cowling, tiller handle, leg, anti-cavitation
// plate, gearcase, skeg and a turning three-blade prop) that tilts up about the clamp when stopped and disappears below
// when stowed for racing; an inboard shows only its exhaust outlet on the transom (and its shaft and prop under water).
// Positions come from the class's engine spec (js/engine.js), body frame -> boat-local three.js via V.
import * as THREE from 'three';
import { V } from './models.js';

const mats = {};
const mat = (k, make) => mats[k] || (mats[k] = make());
const M = {
  cowl: (c) => mat('cowl' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.05 })),
  leg: () => mat('leg', () => new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.3 })),
  alu: () => mat('alu', () => new THREE.MeshStandardMaterial({ color: 0xb9bec3, roughness: 0.4, metalness: 0.6 })),
  prop: () => mat('prop', () => new THREE.MeshStandardMaterial({ color: 0x9ea3a8, roughness: 0.3, metalness: 0.8, side: THREE.DoubleSide })),
  bronze: () => mat('bronze', () => new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide })),
  black: () => mat('black', () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 })),
};

function propeller(D, Z, material) {
  const g = new THREE.Group(), R = D / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.16, R * 0.55, 10), material); hub.rotation.x = Math.PI / 2; g.add(hub);
  // a blade: an ellipse-ish outline, pitched about its radial axis
  const sh = new THREE.Shape();
  sh.moveTo(0, R * 0.15); sh.bezierCurveTo(R * 0.34, R * 0.3, R * 0.3, R * 0.9, 0.02 * R, R); sh.bezierCurveTo(-R * 0.24, R * 0.85, -R * 0.26, R * 0.3, 0, R * 0.15);
  const bg = new THREE.ShapeGeometry(sh, 6);
  for (let k = 0; k < Z; k++) {
    const blade = new THREE.Mesh(bg, material);
    const holder = new THREE.Group(); holder.rotation.z = k * 2 * Math.PI / Z;
    blade.rotation.y = 0.55;            // pitch: the blade face turned from the disc plane
    holder.add(blade); g.add(holder);
  }
  return g;
}

// a ray at the boat's hull (physics coords): (from, dir) -> { p: the point, n: the surface's normal there, d: the
// distance } or null
function hullHit(vis) {
  const rc = new THREE.Raycaster(), hulls = [];
  vis.inner.traverse((o) => { if (o.isMesh && o.geometry.attributes.sheerZ) hulls.push(o); });
  if (!hulls.length && vis.hull) hulls.push(vis.hull);
  vis.root.updateMatrixWorld(true);
  const Mw = vis.inner.matrixWorld, Mi = Mw.clone().invert(), nm = new THREE.Matrix3();
  return (from, dir) => {
    const o = V(from[0], from[1], from[2]).applyMatrix4(Mw), e = V(from[0] + dir[0], from[1] + dir[1], from[2] + dir[2]).applyMatrix4(Mw);
    rc.set(o, e.sub(o).normalize()); rc.far = 20;
    const h = rc.intersectObjects(hulls, false)[0];
    if (!h) return null;
    const p = h.point.clone().applyMatrix4(Mi), n = h.face.normal.clone().applyMatrix3(nm.getNormalMatrix(h.object.matrixWorld)).applyMatrix3(new THREE.Matrix3().setFromMatrix4(Mi)).normalize();
    // (the face may be wound either way: the normal faces back along the ray)
    if (n.dot(rc.ray.direction.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(Mi))) > 0) n.negate();
    return { p: [-p.z, p.x, p.y], n: [-n.z, n.x, n.y], d: h.distance };
  };
}

export function buildEngineModel(boat, vis) {
  const e = boat.engine; if (!e) return null;
  const S = e.spec, C = boat.cls, Lx = vis.lines;
  const root = new THREE.Group();
  const [px, py, pz] = S.pos;
  const out = { root, S, pivot: null, motor: null, prop: null, spin: 0 };
  if (S.type === 'outboard') {
    const [mx, my, mz] = S.mount;
    // the transom surface along the bracket's travel (from the hull's stern station: js/engine.js transomX)
    const tr = S.transomAt || { x: mx + 0.11, dxdz: 0, zTop: mz + 0.4 }, xAt = (z) => tr.x + tr.dxdz * (z - mz);
    const lift = S.lift || 0, zA = mz - 0.12, zB = Math.min(tr.zTop - 0.03, mz + lift + 0.05), zR = mz + lift + 0.1;
    const along = (z0, z1, w, d, off, m) => {     // a part lying on the raked transom from height z0 to z1, off m aft of it
      const g = new THREE.Mesh(new THREE.BoxGeometry(w, z1 - z0, d), m), zc = (z0 + z1) / 2;
      g.position.copy(V(xAt(zc) - off, my, zc)); g.rotation.x = Math.atan(-tr.dxdz); return g;
    };
    // fixed: a backing plate on the transom and the two rails the carriage slides up
    root.add(along(zA, zB, 0.24, 0.018, 0.009, M.alu()));
    for (const s of [-1, 1]) { const r = along(zA + 0.02, zR, 0.022, 0.022, 0.04, M.alu()); r.position.x += s * 0.085; root.add(r); }
    // the carriage: slides along the rails with the motor on its clamp board
    const slide = new THREE.Group(); root.add(slide);
    const sd = Math.max(0.04, xAt(mz) - mx);
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.05), M.alu()); car.position.copy(V(xAt(mz) - 0.05, my, mz)); slide.add(car);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, sd), M.alu());
      arm.position.copy(V(xAt(mz) - sd / 2, my + s * 0.1, mz + 0.01)); slide.add(arm);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.035), M.black()); board.position.copy(V(mx + 0.02, my, mz - 0.03)); slide.add(board);
    // the motor, pivoting about its clamp (athwartships axis)
    const pivot = new THREE.Group(); pivot.position.copy(V(mx, my, mz));
    const motor = new THREE.Group(); pivot.add(motor);
    const kw = S.kW, sc = 0.85 + 0.06 * kw, a = mx - px;           // (a: the prop sits this far aft of the clamp)                        // a bigger outboard is a bigger box
    const cowlC = /tohatsu/i.test(S.model || '') ? 0xd9dde0 : 0x3a3f46;
    const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * sc, 0.16 * sc, 4, 10), M.cowl(cowlC));
    cowl.rotation.x = Math.PI / 2; cowl.scale.set(1, 1, 1.25); cowl.position.set(0, 0.26 * sc, a - 0.07); motor.add(cowl);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.2 * sc, 0.1, 0.3 * sc), M.leg()); lower.position.set(0, 0.1, a - 0.08); motor.add(lower);
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), M.black());
    tiller.rotation.x = Math.PI / 2 - 0.15; tiller.position.set(0, 0.16, -0.22); motor.add(tiller);
    // leg down to the prop shaft
    const legLen = mz - pz;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, legLen - 0.05, 0.12), M.leg()); leg.position.set(0, -(legLen - 0.05) / 2 + 0.05, a - 0.12); motor.add(leg);
    const plateA = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.22), M.leg()); plateA.position.set(0, -legLen + 0.11, a - 0.1); motor.add(plateA);
    const gear = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.16, 4, 10), M.leg()); gear.rotation.x = Math.PI / 2; gear.position.set(0, -legLen, a - 0.12); motor.add(gear);
    const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.08), M.leg()); skeg.position.set(0, -legLen - 0.07, a - 0.1); motor.add(skeg);
    const prop = propeller(S.prop.D, S.prop.Z, M.prop()); prop.position.set(0, -legLen, a); motor.add(prop);
    motor.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    slide.add(pivot);
    Object.assign(out, { pivot, motor, prop, legLen, slide, dxdz: tr.dxdz, bracket: root });
  } else {
    // inboard / saildrive: an exhaust outlet on the transom (or topsides), the shaft and prop out of sight below.
    // The outlet sits on the hull's own surface nearest the spec's point (the transom, or the quarter's topsides),
    // found by casting at the hull, and points out along the surface there; the shaft runs from the prop up into
    // the hull, and a saildrive's leg from the hull down to its pod
    const hit = hullHit(vis);
    const ex = S.exhaust || [C.sternX, 0.3, 0.2];
    const onT = hit([C.sternX - 1.5, ex[1], ex[2]], [1, 0, 0]), onS = hit([ex[0], Math.sign(ex[1] || 1) * (C.beam + 1), ex[2]], [0, -Math.sign(ex[1] || 1), 0]);
    const d = (h) => h ? Math.hypot(h.p[0] - ex[0], h.p[1] - ex[1], h.p[2] - ex[2]) : Infinity;
    const at = d(onT) <= d(onS) ? onT : onS;
    const P = at ? at.p : ex, N = at ? at.n : [-1, 0, 0], n3 = V(N[0], N[1], N[2]).normalize();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 12, 1, true), M.alu());
    pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n3); pipe.position.copy(V(P[0], P[1], P[2])).addScaledVector(n3, 0.015); root.add(pipe);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), M.black());
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n3); hole.position.copy(V(P[0], P[1], P[2])).addScaledVector(n3, 0.039); root.add(hole);
    const prop = propeller(S.prop.D, S.prop.Z, M.bronze()); prop.position.copy(V(px, py, pz)); prop.rotation.x = S.shaftAngle || 0; root.add(prop);   // (its disc square to the shaft, which rises forward)
    if (S.type === 'inboard') {
      // (up the shaft line from the prop until it enters the hull, or the keel ahead of an aperture)
      // (the rays a hair off the centreline, where the hull's two sides meet in an edge a ray can slip through)
      const a = S.shaftAngle || 0, h = hit([px, py + 0.003, pz], [Math.cos(a), 0, Math.sin(a)]), L = h ? Math.max(0.3, h.d + 0.06) : 0.9;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, L, 8), M.alu());
      shaft.rotation.x = a - Math.PI / 2; shaft.position.copy(V(px + L / 2 * Math.cos(a), py, pz + L / 2 * Math.sin(a))); root.add(shaft);
      // a long run in open water carries a P-bracket just ahead of the prop, up to the hull
      const bx = px + 0.22 * Math.cos(a), bz = pz + 0.22 * Math.sin(a), hb = L > 0.6 ? hit([bx, py + 0.003, bz], [0, 0, 1]) : null;
      if (hb && hb.d > 0.08) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.025, hb.d + 0.04, 0.09), M.bronze()); st.position.copy(V(bx, py, bz + hb.d / 2)); root.add(st);
        const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 10), M.bronze()); boss.rotation.x = a - Math.PI / 2; boss.position.copy(V(bx, py, bz)); root.add(boss);
      }
    } else if (S.type === 'saildrive') {
      // the leg: a faired strut from the hull bottom down to the pod, the prop on the pod's aft end
      const xl = px + 0.2, h = hit([xl, py + 0.003, pz], [0, 0, 1]), top = h ? h.p[2] + 0.05 : pz + 0.5, legM = M.leg();
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, top - pz, 0.3), legM); leg.position.copy(V(xl, py, (top + pz) / 2)); root.add(leg);
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 4, 10), legM); pod.rotation.x = Math.PI / 2; pod.position.copy(V(xl - 0.02, py, pz)); root.add(pod);
    }
    out.prop = prop;
  }
  vis.inner.add(root);
  return out;
}

export function updateEngineModel(vis, b, t, dt) {
  const m = vis.engineVis; if (!m) return;
  const e = b.engine, S = m.S;
  if (m.pivot) {
    // raised clear when stopped: the carriage slides up the raked transom and the motor tips back a little about its
    // clamp; hidden below when stowed (the bracket stays)
    m.motor.visible = !e.stowed;
    const up = (1 - e.down) * (S.lift || 0);
    m.slide.position.set(0, up, -m.dxdz * up);
    m.pivot.rotation.set(-(1 - e.down) * 0.14, S.steers ? b.rudder : 0, 0, 'YXZ');
  }
  if (m.prop) {
    // (a turning prop, slowed down to what the eye makes of it)
    const n = e.n * (S.prop.rh || 1);
    m.spin += Math.sign(n) * Math.min(Math.abs(n) * 2 * Math.PI, 9) * dt;
    m.prop.rotation.z = -m.spin;
  }
}
