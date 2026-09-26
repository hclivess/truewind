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

export function buildEngineModel(boat, vis) {
  const e = boat.engine; if (!e) return null;
  const S = e.spec, C = boat.cls, Lx = vis.lines;
  const root = new THREE.Group();
  const [px, py, pz] = S.pos;
  const out = { root, S, pivot: null, motor: null, prop: null, spin: 0 };
  if (S.type === 'outboard') {
    const [mx, my, mz] = S.mount;
    // where the transom surface is at the clamp's height (a raked transom: the top further aft)
    const zBot = Lx.keelZ(0), zTop = Lx.sheer(0);
    const xT = C.sternX - Lx.H.transomRake * Math.max(0, Math.min(1, (mz - zBot) / Math.max(0.05, zTop - zBot)));
    // bracket: a plate on the transom and two arms out to the clamp board
    const brk = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.02), M.alu()); plate.position.copy(V(xT - 0.012, my, mz + 0.06)); brk.add(plate);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, Math.max(0.05, xT - mx)), M.alu());
      arm.position.copy(V((xT + mx) / 2, my + s * 0.1, mz + 0.02)); brk.add(arm);
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.035), M.black()); board.position.copy(V(mx + 0.02, my, mz + 0.02)); brk.add(board);
    root.add(brk);
    // the motor, pivoting about the clamp (athwartships axis)
    const pivot = new THREE.Group(); pivot.position.copy(V(mx, my, mz));
    const motor = new THREE.Group(); pivot.add(motor);
    const kw = S.kW, sc = 0.85 + 0.06 * kw, a = mx - px;           // (a: the prop sits this far aft of the clamp)                        // a bigger outboard is a bigger box
    const cowlC = /tohatsu/i.test(S.model || '') ? 0xd9dde0 : 0x3a3f46;
    const cowl = new THREE.Mesh(new THREE.CapsuleGeometry(0.11 * sc, 0.16 * sc, 4, 10), M.cowl(cowlC));
    cowl.rotation.x = Math.PI / 2; cowl.scale.set(1, 1, 1.25); cowl.position.set(0, 0.26 * sc, a - 0.02); motor.add(cowl);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.2 * sc, 0.1, 0.3 * sc), M.leg()); lower.position.set(0, 0.1, a - 0.04); motor.add(lower);
    const tiller = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 8), M.black());
    tiller.rotation.x = Math.PI / 2 - 0.15; tiller.position.set(0, 0.16, -0.22); motor.add(tiller);
    // leg down to the prop shaft
    const legLen = mz - pz;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.045, legLen - 0.05, 0.12), M.leg()); leg.position.set(0, -(legLen - 0.05) / 2 + 0.05, a - 0.05); motor.add(leg);
    const plateA = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.22), M.leg()); plateA.position.set(0, -legLen + 0.11, a - 0.04); motor.add(plateA);
    const gear = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.16, 4, 10), M.leg()); gear.rotation.x = Math.PI / 2; gear.position.set(0, -legLen, a - 0.06); motor.add(gear);
    const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.08), M.leg()); skeg.position.set(0, -legLen - 0.07, a - 0.04); motor.add(skeg);
    const prop = propeller(S.prop.D, S.prop.Z, M.prop()); prop.position.set(0, -legLen, a + 0.06); motor.add(prop);
    motor.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    root.add(pivot);
    Object.assign(out, { pivot, motor, prop, legLen });
  } else {
    // inboard / saildrive: an exhaust outlet on the transom (or topsides), the shaft and prop out of sight below
    const ex = S.exhaust || [C.sternX, 0.3, 0.2];
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 12, 1, true), M.alu());
    pipe.rotation.x = Math.PI / 2; pipe.position.copy(V(ex[0], ex[1], ex[2])); root.add(pipe);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), M.black()); hole.position.copy(V(ex[0] - 0.026, ex[1], ex[2])); root.add(hole);
    const prop = propeller(S.prop.D, S.prop.Z, M.bronze()); prop.position.copy(V(px, py, pz)); prop.rotation.x = -(S.shaftAngle || 0); root.add(prop);
    if (S.type === 'inboard') {
      const L = 0.9, a = S.shaftAngle || 0;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, L, 8), M.alu());
      shaft.rotation.x = Math.PI / 2 - a; shaft.position.copy(V(px + L / 2 * Math.cos(a), py, pz + L / 2 * Math.sin(a))); root.add(shaft);
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
    // tilted up about the clamp when stopped (the leg swings aft and up), hidden below when stowed
    m.motor.visible = !e.stowed;
    m.pivot.rotation.set(-(1 - e.down) * 1.25, S.steers ? b.rudder : 0, 0, 'YXZ');
  }
  if (m.prop) {
    // (a turning prop, slowed down to what the eye makes of it)
    const n = e.n * (S.prop.rh || 1);
    m.spin += Math.sign(n) * Math.min(Math.abs(n) * 2 * Math.PI, 9) * dt;
    m.prop.rotation.z = -m.spin;
  }
}
