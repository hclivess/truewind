// Articulated crew: a jointed skeleton per sailor, hands placed with two-bone IK on the tiller,
// sheet tails and winch handles; poses for sitting, hiking, crouching across the boat and grinding.
import * as THREE from 'three';
import { V } from './models.js';
import { clamp, lerp, sstep } from './physics.js';

const matC = {};
const mm = (k, c, r = 0.8) => matC[k] || (matC[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r }));
const DOWN = new THREE.Vector3(0, -1, 0);

function limb(len, r0, r1, mat) {
  // tapered capsule-ish limb hanging along -y from its joint
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, 1);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r0, 10, 8), mat);
  const cap2 = new THREE.Mesh(new THREE.SphereGeometry(r1, 10, 8), mat); cap2.position.y = -len;
  const grp = new THREE.Group(); grp.add(m, cap, cap2);
  grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return grp;
}

export class Sailor {
  constructor(style = {}) {
    const jacket = mm('j' + style.jacket, style.jacket ?? 0xd33f49, 0.7);
    const vest = mm('v' + style.vest, style.vest ?? 0x1d2a44, 0.6);
    const legs = mm('l' + style.legs, style.legs ?? 0x2b2f38, 0.85);
    const skin = mm('s' + style.skin, style.skin ?? 0xd9a47e, 0.65);
    const boot = mm('boot', 0x15171a, 0.6);
    const hatM = mm('h' + style.hat, style.hat ?? 0xf2f2f2, 0.6);
    this.root = new THREE.Group();
    const pelvis = this.pelvis = new THREE.Group(); this.root.add(pelvis);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.12, 4, 10), legs); hips.rotation.z = Math.PI / 2; hips.scale.set(1, 1, 0.8); pelvis.add(hips);
    // spine and chest
    const spine = this.spine = new THREE.Group(); spine.position.y = 0.05; pelvis.add(spine);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 6, 12), jacket); torso.position.y = 0.26; torso.scale.set(1.15, 1, 0.75); spine.add(torso);
    const bVest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.18, 6, 12), vest); bVest.position.y = 0.32; bVest.scale.set(1.12, 1, 0.82); spine.add(bVest);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.03, 6, 14), vest); collar.rotation.x = Math.PI / 2; collar.position.y = 0.5; spine.add(collar);
    // head
    const neck = this.neck = new THREE.Group(); neck.position.y = 0.52; spine.add(neck);
    const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin); nk.position.y = 0.04; neck.add(nk);
    const head = this.head = new THREE.Group(); head.position.y = 0.1; neck.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), skin); skull.position.y = 0.1; skull.scale.set(0.92, 1.08, 1); head.add(skull);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6), skin); nose.rotation.x = -Math.PI / 2; nose.position.set(0, 0.09, -0.105); head.add(nose);
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.03), mm('shades', 0x0c0e10, 0.2)); shades.position.set(0, 0.12, -0.09); head.add(shades);
    if (style.hatKind === 'brim') {
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.105, 0.09, 14), hatM); crown.position.y = 0.2; head.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 20), hatM); brim.position.y = 0.16; head.add(brim);
    } else {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatM); cap.position.y = 0.12; head.add(cap);
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.1), hatM); peak.position.set(0, 0.125, -0.12); head.add(peak);
    }
    // arms
    this.arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.2, 0.44, 0); spine.add(sh);
      const up = limb(0.29, 0.058, 0.048, jacket); sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      const fo = limb(0.26, 0.045, 0.036, jacket); el.add(fo);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), mm('glove', 0x2a2d33, 0.7)); hand.position.y = -0.29; hand.scale.set(0.9, 1.2, 0.6); el.add(hand);
      this.arms.push({ sh, el, hand, a: 0.29, b: 0.29 });
    }
    // legs
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.1, -0.02, 0); pelvis.add(hip);
      hip.add(limb(0.44, 0.075, 0.058, legs));
      const knee = new THREE.Group(); knee.position.y = -0.44; hip.add(knee);
      knee.add(limb(0.42, 0.055, 0.042, legs));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.27), boot); foot.position.set(0, -0.45, -0.07); foot.castShadow = true; knee.add(foot);
      this.legs.push({ hip, knee });
    }
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.state = { side: 1, turn: 1 };
  }

  // leg + torso pose: hip flexion, knee flexion (radians), torso lean (+ = backward)
  pose(hipFlex, kneeFlex, lean, spread = 0.12) {
    this.legs.forEach((l, i) => { l.hip.rotation.set(hipFlex, 0, (i ? 1 : -1) * spread); l.knee.rotation.set(-kneeFlex, 0, 0); });
    this.spine.rotation.x = lean;
    this.neck.rotation.x = -lean * 0.6;
  }

  // two-bone IK: place hand i at world target, elbow bending toward pole (world)
  reach(i, target, pole) {
    const arm = this.arms[i];
    arm.sh.parent.updateWorldMatrix(true, false);
    const S = arm.sh.getWorldPosition(new THREE.Vector3());
    const toT = new THREE.Vector3().subVectors(target, S);
    const a = arm.a, b = arm.b;
    const d = clamp(toT.length(), 0.08, a + b - 0.005);
    const dir = toT.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), A = Math.acos(cosA);
    const pv = new THREE.Vector3().subVectors(pole, S);
    const n = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    if (!isFinite(n.x)) n.set(0, 0, 1);
    const upperDir = dir.clone().multiplyScalar(Math.cos(A)).addScaledVector(n, Math.sin(A)).normalize();
    const elbow = S.clone().addScaledVector(upperDir, a);
    const lowerDir = new THREE.Vector3().subVectors(target, elbow).normalize();
    const setDir = (node, wdir) => {
      const pq = node.parent.getWorldQuaternion(new THREE.Quaternion());
      const q = new THREE.Quaternion().setFromUnitVectors(DOWN, wdir);
      node.quaternion.copy(pq.invert().multiply(q));
      node.updateWorldMatrix(false, false);
    };
    setDir(arm.sh, upperDir);
    setDir(arm.el, lowerDir);
  }
  handWorld(i, out = new THREE.Vector3()) { return this.arms[i].hand.getWorldPosition(out); }
}

// ---------------------------------------------------------------- crew of one boat
const STYLES = [
  { jacket: 0xd33f49, vest: 0x1d2a44, legs: 0x2b2f38, hat: 0xf2f2f2 },
  { jacket: 0x1d4e89, vest: 0xff7a1a, legs: 0x2b2f38, hat: 0x1d2a44, skin: 0xc68b62 },
  { jacket: 0xf2b33d, vest: 0x1d2a44, legs: 0x3a3f47, hat: 0xffffff, skin: 0xe8b996 },
  { jacket: 0x2a9d8f, vest: 0xd33f49, legs: 0x2b2f38, hat: 0xf2f2f2, skin: 0x8d5a3b },
];

export class Crew {
  constructor(boat, vis, rigging, opts = {}) {
    this.b = boat; this.vis = vis; this.rig = rigging;
    const C = boat.cls;
    this.people = [];
    const n = C.crewN;
    for (let i = 0; i < n; i++) {
      const st = { ...STYLES[(i + (opts.tint || 0)) % STYLES.length] };
      if (C.id === 'blackwatch') { st.hatKind = i === 0 ? 'brim' : 'cap'; st.jacket = i === 0 ? 0xe9e4d8 : 0x2e5e4e; st.vest = 0xc8412c; st.hat = i === 0 ? 0xd8c08a : 0xf2f2f2; }
      const s = new Sailor(st);
      vis.inner.add(s.root);
      // stations along the boat (physics x), roles
      let x, role;
      if (C.id === 'dinghy') { x = C.mastX - 1.95; role = 'helm'; }
      else if (C.multihull) { x = i === 0 ? C.sternX + 1.0 : C.sternX + 1.7; role = i === 0 ? 'helm' : 'jib'; }
      else if (C.id === 'blackwatch') { x = i === 0 ? C.sternX + 0.75 : C.sternX + 1.55; role = i === 0 ? 'helm' : 'jib'; }
      else { x = [C.sternX + 0.85, C.sternX + 1.55, C.sternX + 2.2, C.sternX + 2.85][i]; role = ['helm', 'main', 'jib', 'bow'][i]; }
      this.people.push({ s, x, role, side: 1, sideVis: 1, turn: 1, cross: 0 });
    }
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
    // trapeze wires
    if (C.trapeze) {
      this.wires = this.people.map(() => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9aa1a8 })); l.frustumCulled = false; vis.inner.add(l); return l;
      });
    }
    this.grind = 0;
    this.lastJib = boat.lines.jib;
  }

  update(dt, t) {
    const b = this.b, C = b.cls, vis = this.vis, rig = this.rig;
    const Lx = vis.lines;
    const bw = (x) => Lx.bDeck(clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1));
    vis.inner.updateWorldMatrix(true, false);
    const toW = (p) => vis.inner.localToWorld(p.clone());
    const trimming = (this.lastJib - b.lines.jib) / Math.max(dt, 1e-4) > 0.01;
    this.lastJib = b.lines.jib;
    this.grind = lerp(this.grind, trimming ? 1 : 0, clamp(dt * 4, 0, 1));
    const windSide = -Math.sign(b.diag.awaMid || 1) || 1; // leeward sign
    const hands = {};
    for (let i = 0; i < this.people.length; i++) {
      const P = this.people[i], s = P.s;
      const f = this.people.length > 1 ? 0.85 + 0.15 * ((i + 1) % 2) : 1;
      let y = b.crewY * f;
      const edge = bw(P.x) - 0.06;
      // which side are they on? (hysteresis) and how far across are they
      if (Math.abs(y) > 0.12) P.side = Math.sign(y);
      const grinding = P.role === 'jib' && this.grind > 0.3 && !!rig.winches.length;
      if (grinding) { P.side = Math.sign((b.genDeploy > 0.5 ? b.side.gennaker : b.side.jib)) || 1; }
      // visual side follows with a crossing phase (crouch walk under the boom)
      if (P.sideVis !== P.side) { P.cross = Math.min(1, P.cross + dt / 1.4); if (P.cross >= 1) { P.sideVis = P.side; P.cross = 0; } }
      const crossing = P.cross > 0 ? Math.sin(P.cross * Math.PI) : 0;
      const sideNow = P.cross > 0 ? lerp(P.sideVis, P.side, sstep(0.3, 0.7, P.cross)) : P.sideVis;
      const out = clamp(Math.abs(y) / C.crewMaxOut, 0, 1);
      const hikeLean = C.id === 'blackwatch' ? out * 0.25 : sstep(0.55, 1, Math.abs(y) / Math.max(edge, 0.3)) * (C.crewMaxOut > edge ? 1.15 : 0.5);
      // pelvis position: on the deck edge when hiking, lower in the cockpit when inboard
      const inCockpit = C.id !== 'blackwatch' && Math.abs(y) < edge * 0.55;
      let py = sideNow * Math.min(Math.max(Math.abs(y), edge * (C.id === 'blackwatch' ? 0.62 : 0.8)), edge);
      if (P.cross > 0) py = lerp(P.sideVis, P.side, P.cross) * edge * 0.5;
      let pz = vis.deckH(P.x, py) + 0.1;
      if (C.id === 'blackwatch') pz = vis.ck.sole + 0.47;                 // on the cockpit benches
      if (grinding) { py = P.side * (rig.hw.winchY - 0.28); pz = vis.ck.sole + 0.5; }
      if (crossing > 0) pz = vis.ck.sole + 0.55;
      s.root.position.copy(V(P.x + b.crewX * 0.35, py, pz));
      // catamaran: out on the trapeze, feet on the windward hull, body horizontal on the wire
      const trap = C.trapeze ? clamp((Math.abs(y) - C.hullSpacing / 2) / (C.crewMaxOut - C.hullSpacing / 2), 0, 1) : 0;
      if (C.trapeze) {
        const hullY = sideNow * (C.hullSpacing / 2 + 0.12);
        py = hullY + sideNow * 0.95 * Math.sin(trap * 1.35);
        pz = C.freeboard + 0.1 + 0.95 * Math.cos(trap * 1.35);
        if (trap < 0.05) { py = sideNow * (C.hullSpacing / 2 - 0.1); pz = C.freeboard + 0.25; }
        s.root.position.copy(V(P.x + b.crewX * 0.35, py, pz));
      }
      // face inboard (toward the other side); the helm turns partly forward
      const facing = sideNow >= 0 ? Math.PI / 2 : -Math.PI / 2;
      const fwdTurn = P.role === 'helm' ? -sideNow * 0.55 : P.role === 'bow' ? -sideNow * 0.2 : 0;
      s.root.rotation.set(trap * 1.35, facing + fwdTurn, 0, 'YXZ');
      // legs & torso
      if (C.trapeze && trap > 0.05) s.pose(0.05, 0.2, 0.0, 0.18);
      else if (crossing > 0.05) s.pose(1.9, 2.1, -0.75 * crossing, 0.2);
      else if (grinding) s.pose(1.5, 1.6, -0.35 - 0.08 * Math.sin(t * 7), 0.2);
      else if (inCockpit) s.pose(1.55, 1.7, -0.25, 0.18);
      else s.pose(1.5, lerp(1.45, 0.55, clamp(hikeLean, 0, 1)), hikeLean + 0.03 * Math.sin(t * 1.3 + i), 0.12);
      // head looks at the sails / forward
      s.head.rotation.y = -sideNow * 0.6 + 0.1 * Math.sin(t * 0.4 + i * 2);
      s.root.updateMatrixWorld(true);
      // ---- hands
      const chest = s.spine.localToWorld(this._v.set(0, 0.35, -0.3));
      const pole = (dx) => s.spine.localToWorld(new THREE.Vector3(dx, -0.4, 0.5));
      if (P.role === 'helm') {
        // aft hand on the tiller / extension; forward hand on the mainsheet (una-rig, cutter) or at rest
        const tip = vis.extension ? s.spine.localToWorld(new THREE.Vector3(-0.28, 0.2, -0.3)) : toW(vis.rudderPivot.position.clone()).add(vis.rudderPivot.localToWorld(vis.tillerEnd.clone()).sub(vis.rudderPivot.getWorldPosition(new THREE.Vector3())));
        s.reach(0, tip, pole(-0.6));
        hands.helm = s.handWorld(0);
        if (C.id === 'dinghy' || C.id === 'blackwatch') {
          const tgt = s.spine.localToWorld(new THREE.Vector3(0.22, 0.3, -0.38));
          s.reach(1, tgt, pole(0.6)); hands.main = s.handWorld(1);
        } else s.reach(1, s.spine.localToWorld(new THREE.Vector3(0.25, 0.05, -0.25)), pole(0.6));
      } else if (P.role === 'main') {
        s.reach(0, s.spine.localToWorld(new THREE.Vector3(-0.15, 0.3, -0.4)), pole(-0.6));
        s.reach(1, s.spine.localToWorld(new THREE.Vector3(0.15, 0.32, -0.42)), pole(0.6));
        hands.main = s.handWorld(1);
      } else if (P.role === 'jib') {
        if (grinding) {
          const grip = rig.handleGrip(this._w);
          if (grip) { const wg = toW(grip); s.reach(1, wg, pole(0.6)); s.reach(0, wg.clone().add(new THREE.Vector3(0, 0.05, 0)), pole(-0.6)); }
        } else {
          s.reach(0, s.spine.localToWorld(new THREE.Vector3(-0.12, 0.28, -0.42)), pole(-0.6));
          s.reach(1, s.spine.localToWorld(new THREE.Vector3(0.12, 0.3, -0.44)), pole(0.6));
        }
        hands.jib = s.handWorld(1);
        hands.stay = hands.jib;
      } else {
        s.reach(0, s.spine.localToWorld(new THREE.Vector3(-0.25, 0.0, -0.2)), pole(-0.6));
        s.reach(1, s.spine.localToWorld(new THREE.Vector3(0.25, 0.0, -0.2)), pole(0.6));
      }
      if (b.capsized) s.root.position.y -= 0.5;
      if (this.wires) {
        const w = this.wires[i], top = vis.stay.trapezeTop;
        const hook = s.spine.localToWorld(new THREE.Vector3(0, 0.1, -0.12));
        vis.inner.worldToLocal(hook);
        w.visible = trap > 0.05;
        w.geometry.attributes.position.setXYZ(0, top.x, top.y, top.z); w.geometry.attributes.position.setXYZ(1, hook.x, hook.y, hook.z);
        w.geometry.attributes.position.needsUpdate = true;
      }
    }
    // hand targets go to the rigging in the boat frame
    const inv = vis.inner.matrixWorld.clone().invert();
    rig.hands = {};
    for (const k in hands) rig.hands[k] = hands[k].clone().applyMatrix4(inv);
    // tiller extension from the tiller end to the helm's hand
    if (vis.extension && hands.helm) {
      const tEnd = vis.rudderPivot.localToWorld(vis.tillerEnd.clone()).applyMatrix4(inv);
      const hEnd = hands.helm.clone().applyMatrix4(inv);
      const dir = new THREE.Vector3().subVectors(hEnd, tEnd);
      const L = dir.length();
      vis.extension.position.copy(tEnd);
      vis.extension.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      vis.extension.scale.set(1, Math.max(0.1, L), 1);
      vis.extension.userData.tip = hands.helm.clone();
    }
  }
}
