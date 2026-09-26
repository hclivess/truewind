// What damage, anchoring, mooring and a man overboard look like (three.js): the broken rig over the side, tears
// in a sail, the anchor rode curving into the water and the anchor light, mooring lines and fenders, and the MOB
// marker (a danbuoy with its strobe and a horseshoe life ring: no human figure is ever drawn).
// Runs once a frame from the renderer's hooks (js/render.js), after the boats are posed and before the draw.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(y, z, -x);     // boat frame (x fwd, y stbd, z up) -> three (inner group)
const mat = {};
const M = (k, c, o = {}) => mat[k] || (mat[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, ...o }));

// a tube whose centreline is rewritten every frame (n points, r radius, 6 sides)
class LiveTube {
  constructor(parent, n, r, material) {
    this.n = n; this.r = r; this.S = 6;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * this.S * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * this.S * 3), 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < this.S; s++) {
      const a = i * this.S + s, b = i * this.S + (s + 1) % this.S, c = a + this.S, d = b + this.S;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    parent.add(this.mesh);
    this._t = new THREE.Vector3(); this._n = new THREE.Vector3(); this._b = new THREE.Vector3(); this._u = new THREE.Vector3(0, 1, 0);
  }
  set(pts) {   // pts: array of THREE.Vector3 (length n, or resampled)
    const n = this.n, S = this.S, pos = this.mesh.geometry.attributes.position.array, nor = this.mesh.geometry.attributes.normal.array;
    const P = (i) => pts[Math.min(pts.length - 1, Math.round(i * (pts.length - 1) / (n - 1)))];
    for (let i = 0; i < n; i++) {
      const p = P(i), q = P(Math.min(n - 1, i + 1)), o = P(Math.max(0, i - 1));
      this._t.subVectors(q, o); if (this._t.lengthSq() < 1e-10) this._t.set(0, 1, 0); this._t.normalize();
      this._n.crossVectors(this._t, Math.abs(this._t.y) > 0.9 ? this._b.set(1, 0, 0) : this._u).normalize();
      this._b.crossVectors(this._t, this._n).normalize();
      for (let s = 0; s < S; s++) {
        const a = s / S * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), k = (i * S + s) * 3;
        const nx = this._n.x * c + this._b.x * sn, ny = this._n.y * c + this._b.y * sn, nz = this._n.z * c + this._b.z * sn;
        pos[k] = p.x + nx * this.r; pos[k + 1] = p.y + ny * this.r; pos[k + 2] = p.z + nz * this.r;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.normal.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.visible = true;
  }
}

let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,250,235,0.9)'); gr.addColorStop(0.4, 'rgba(255,240,210,0.25)'); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}
const glowSprite = (color, size) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(size, size, 1); s.renderOrder = 12; return s;
};

export class GearVis {
  constructor(renderer, game) {
    this.R = renderer; this.g = game;
    this.per = new Map();          // boat -> its visuals
    this.mobG = new THREE.Group(); renderer.scene.add(this.mobG);
    this.mobs = [];
    this._v = new THREE.Vector3(); this._w = {};
    renderer.hooks = renderer.hooks || [];
    renderer.hooks.push((dt, t, sim) => this.update(dt, t, sim));
  }
  of(b, vis) {
    let o = this.per.get(b);
    if (!o || o.vis !== vis) { o = { vis, wreck: null, tears: {}, rode: null, light: null, lines: [], fenders: null }; this.per.set(b, o); }
    return o;
  }
  update(dt, t, sim) {
    const g = this.g, env = sim.env;
    const night = this.R.sunDir ? this.R.sunDir.y < 0.06 : false;
    for (const [b, vis] of this.R.boats) {
      const o = this.of(b, vis);
      const D = b.dmg;
      // ---- broken rig
      if (D && D.rig.down) {
        if (!o.wreck || o.wreckZ !== D.rig.breakZ || o.wreckCut !== D.rig.cut) this.buildWreck(b, vis, o, D);
        vis.rig.visible = false;
        if (vis.rigging) for (const r of vis.rigging.ropes) r.hide();
      } else if (o.wreck) { vis.inner.remove(o.wreck); o.wreck = null; vis.rig.visible = true; }
      // ---- torn sails: a hole cut in the sail's material (alpha map)
      if (D && !D.rig.down) for (const k in D.sails) {
        const S = D.sails[k], mesh = vis.sailMeshes[k]; if (!mesh) continue;
        const want = S.tear > 0 ? Math.round(S.tear * 40) : 0;
        const cur = o.tears[k] || 0;
        if (want !== cur) { this.tearSail(mesh, S, want ? S.tear : 0, b, k); o.tears[k] = want; }
      }
      // ---- anchor rode and light
      const A = b.anchor;
      if (A && A.state !== 'up') {
        if (!o.rode) o.rode = new LiveTube(this.R.scene, 26, A.spec.chain.w > 0.7 ? 0.012 : 0.009, M('rode', 0x6f6a5c, { roughness: 0.8 }));
        const pts = A.curve(this._cp || (this._cp = []));
        const depth = g.world ? Math.max(0.5, g.world.depthAt(A.x, A.z)) : 10;
        vis.inner.updateMatrixWorld();
        const roll = vis.inner.localToWorld(V(A.spec.x, 0, A.spec.z));
        const P = [];
        if (pts && pts.length > 2) {
          for (const p of pts) P.push(new THREE.Vector3(p[0], -depth + p[3], p[2]));
          P[P.length - 1].copy(roll);
          // (the part near the roller follows the bow as it moves between physics steps)
          const k = P.length - 2; P[k].lerp(roll, 0.3);
        } else if (pts) { P.push(new THREE.Vector3(pts[0][0], pts[0][1], pts[0][2]), roll); }
        o.rode.set(P.length ? P : [roll, roll]);
        if (!o.anchorMesh) { o.anchorMesh = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 5), M('anchor', 0x9aa0a6, { metalness: 0.7 })); this.R.scene.add(o.anchorMesh); }
        o.anchorMesh.position.set(A.x, A.state === 'falling' ? -A.y : -depth + 0.1, A.z); o.anchorMesh.visible = true;
      } else { if (o.rode) o.rode.mesh.visible = false; if (o.anchorMesh) o.anchorMesh.visible = false; }
      if (b.lights && b.lights.anchor) {
        // all-round white at the masthead (on a stump if she has lost her rig)
        if (!o.light) { o.light = glowSprite(0xfff4dc, 1.4); o.lightCore = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfffbe8 })); o.light.add(o.lightCore); o.lightCore.scale.set(1 / 1.4, 1 / 1.4, 1); this.R.scene.add(o.light); }
        const top = D && D.rig.down ? D.rig.breakZ : b.cls.mastHeight;
        vis.inner.localToWorld(o.light.position.copy(V(b.cls.mastX, 0, top + 0.12)));
        o.light.visible = night;
        const dist = o.light.position.distanceTo(this.R.camera.position);
        const s = Math.max(1.4, dist * 0.012); o.light.scale.set(s, s, 1);
      } else if (o.light) o.light.visible = false;
      // ---- mooring lines and fenders
      const Mo = b.moor;
      if (Mo && Mo.tied) {
        while (o.lines.length < Mo.lines.length) o.lines.push(new LiveTube(this.R.scene, 10, 0.008, M('dockline', 0xf2efe6, { roughness: 0.9 })));
        vis.inner.updateMatrixWorld();
        Mo.lines.forEach((L, i) => {
          const a = vis.inner.localToWorld(V(L.bx, L.by * 0.98, L.bz + 0.05));
          const e = new THREE.Vector3(L.px, L.buoy ? 0.1 : 0.85, L.pz);
          const pts = [];
          const sag = Math.max(0, 0.25 - L.T / 4000);
          for (let j = 0; j < 10; j++) { const f = j / 9; const p = a.clone().lerp(e, f); p.y -= Math.sin(Math.PI * f) * sag; pts.push(p); }
          o.lines[i].set(pts);
        });
        for (let i = Mo.lines.length; i < o.lines.length; i++) o.lines[i].mesh.visible = false;
        if (Mo.fenders && !o.fenders) {
          o.fenders = new THREE.Group();
          const F = Mo.fenders;
          for (const x of F.xs) {
            const f = new THREE.Mesh(new THREE.CapsuleGeometry(F.r, F.r * 3, 4, 10), M('fender', 0x1f3f8a, { roughness: 0.45 }));
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(F.r * 0.5, F.r * 0.5, 0.05, 8), M('fendercap', 0xe8e8e8));
            cap.position.y = F.r * 2.6; f.add(cap);
            f.position.copy(V(x, F.side * (F.half + F.r * 1.05), b.cls.freeboard * 0.35));
            const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, b.cls.freeboard * 0.65, 4), M('dockline', 0xf2efe6));
            rope.position.copy(V(x, F.side * (F.half + 0.01), b.cls.freeboard * 0.75)); o.fenders.add(rope);
            o.fenders.add(f);
          }
          vis.inner.add(o.fenders);
        }
      } else {
        for (const L of o.lines) L.mesh.visible = false;
        if (o.fenders) { vis.inner.remove(o.fenders); o.fenders = null; }
      }
    }
    // ---- MOB markers: danbuoy (pole, flag, strobe) and horseshoe ring riding the sea at the person's position
    const P = g.player, people = P && P.mob ? P.mob.people : [];
    while (this.mobs.length < people.length) this.mobs.push(this.buildMarker());
    this.mobs.forEach((m, i) => {
      const p = people[i]; m.visible = !!p; if (!p) return;
      const h = env && env.wavesOn ? env.waves.sample(p.x, p.z, t, this._w) : { h: 0, sx: 0, sz: 0 };
      m.position.set(p.x, h.h, p.z);
      m.rotation.set(Math.atan(h.sz || 0) * 0.8, 0, -Math.atan(h.sx || 0) * 0.8);
      const on = (t % 1.1) < 0.09;       // SOLAS strobe: ~50-70 flashes a minute
      m.userData.strobe.visible = on;
      const d = m.position.distanceTo(this.R.camera.position), s = Math.max(1.5, d * 0.02);
      m.userData.strobe.scale.set(s, s, 1);
    });
  }

  buildMarker() {
    const m = new THREE.Group();
    // horseshoe life ring (orange, with reflective tape)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 10, 24, Math.PI * 1.7), M('ring', 0xff6a14, { roughness: 0.55 }));
    ring.rotation.x = -Math.PI / 2; ring.rotation.z = 0.3; ring.position.set(0.55, 0.03, 0); m.add(ring);
    for (let k = 0; k < 4; k++) { const tape = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.072, 6, 4, 0.12), M('tape', 0xdfe6ea, { metalness: 0.6, roughness: 0.3 })); tape.rotation.x = -Math.PI / 2; tape.rotation.z = 0.3 + k * 1.3; tape.position.copy(ring.position); m.add(tape); }
    // danbuoy: float, weighted pole, flag, strobe on top
    const float = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.35, 12), M('dfloat', 0xff6a14)); float.position.y = 0.05; m.add(float);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6), M('dpole', 0xf2f2f2)); pole.position.y = 1.0; m.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), new THREE.MeshStandardMaterial({ color: 0xff3a1a, side: THREE.DoubleSide })); flag.position.set(0.22, 1.72, 0); m.add(flag);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); lamp.position.y = 1.99; m.add(lamp);
    // a line from the ring to the danbuoy
    const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.45, 4), M('dockline', 0xf2efe6)); tether.rotation.z = Math.PI / 2; tether.position.set(0.25, 0.04, 0); m.add(tether);
    const strobe = glowSprite(0xffffff, 1.5); strobe.position.y = 2.0; m.add(strobe); m.userData.strobe = strobe;
    this.mobG.add(m);
    return m;
  }

  // the broken rig: stump (with its spreaders if it broke above them), the top of the mast lying over the rail into
  // the sea on its wires, the sail plastered along it in the water, the boom across the deck
  buildWreck(b, vis, o, D) {
    if (o.wreck) vis.inner.remove(o.wreck);
    const C = b.cls, z = D.rig.breakZ, side = D.rig.side, mast = M('wmast', b.cls.id === 'sportboat' ? 0x1b1d20 : 0xb9bfc4, { metalness: 0.5, roughness: 0.4 });
    const G = new THREE.Group();
    const base = vis.mastBase ?? C.freeboard;
    const r0 = C.id === 'dinghy' ? 0.032 : C.id === 'sportboat' ? 0.05 : 0.055;
    const rod = (a, c, r, m) => {
      const d = new THREE.Vector3().subVectors(c, a), L = d.length();
      const g = new THREE.CylinderGeometry(r, r, L, 10); g.translate(0, L / 2, 0);
      const mesh = new THREE.Mesh(g, m); mesh.position.copy(a);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); mesh.castShadow = true; G.add(mesh); return mesh;
    };
    const wire = M('wwire', 0x8d9399, { metalness: 0.8, roughness: 0.3 });
    const zs = Math.max(base + 0.05, z);
    if (zs > base + 0.1) {
      rod(V(C.mastX, 0, base), V(C.mastX, 0, zs), r0, mast);
      // the jagged top of the stump: a torn, crushed section
      const jag = new THREE.Mesh(new THREE.ConeGeometry(r0 * 1.15, 0.16, 7, 1, true), mast); jag.position.copy(V(C.mastX, 0, zs + 0.05)); jag.rotation.set(0.5, 0.3, 0.4); G.add(jag);
      const R = D.R;
      if (R.spreader && zs > R.spreader - 0.05) {
        for (const s of [-1, 1]) {
          const tip = V(C.mastX - 0.1, s * (C.beam * 0.36), R.spreader);
          rod(V(C.mastX, 0, R.spreader), tip, 0.014, mast);
          rod(V(C.mastX - 0.1, s * (C.beam / 2 - 0.08), C.freeboard + 0.02), V(C.mastX, s * 0.02, R.spreader - 0.05), 0.0035, wire);   // lower shroud
        }
      }
    }
    // the fallen top: from the break over the rail into the water
    if (!D.rig.cut) {
      const L = C.mastHeight - zs;
      const rail = V(C.mastX - 0.4, side * (C.multihull ? C.hullSpacing / 2 + 0.3 : C.beam / 2 + 0.05), C.freeboard + 0.08);
      const inWater = V(C.mastX - 0.4 - L * 0.35, side * (C.beam / 2 + L * 0.72), -0.25);
      const top = zs > base + 0.1 ? V(C.mastX, 0, zs) : V(C.mastX, 0, base);
      rod(top, rail, r0 * 0.95, mast);
      const tip = rod(rail, inWater, r0 * 0.85, mast);
      // the wires, now slack loops from the chainplates to the spar
      for (const s of [-1, 1]) {
        const cp = V(C.mastX - 0.1, s * (C.multihull ? C.hullSpacing / 2 : C.beam / 2 - 0.05), C.freeboard + 0.03);
        const mid = new THREE.Vector3().lerpVectors(rail, inWater, 0.55);
        rod(cp, mid.clone().add(new THREE.Vector3(0, -0.2, 0)), 0.003, wire);
      }
      rod(V(C.bowX - 0.1, 0, C.freeboard + 0.05), new THREE.Vector3().lerpVectors(rail, inWater, 0.8), 0.003, wire);   // the forestay, dragged aft
      // the mainsail in the water along the spar: a crumpled sheet lying just under the surface
      const sail = this.wreckSail(b, rail, inWater, side, L);
      G.add(sail);
      // the boom off the gooseneck, lying across the deck to the fallen side
      const bm = b.sailBy.main;
      if (bm && zs > C.boomZ) rod(V(C.mastX - 0.06, 0, C.boomZ), V(C.mastX - bm.foot * 0.8, side * C.beam * 0.45, C.freeboard + 0.1), 0.04, M('wboom', 0xb9bfc4, { metalness: 0.5, roughness: 0.4 }));
      else if (bm) rod(V(C.mastX - 0.3, -side * 0.2, C.freeboard + 0.06), V(C.mastX - bm.foot * 0.85, side * C.beam * 0.4, C.freeboard + 0.12), 0.04, M('wboom', 0xb9bfc4, { metalness: 0.5, roughness: 0.4 }));
    }
    vis.inner.add(G);
    o.wreck = G; o.wreckZ = D.rig.breakZ; o.wreckCut = D.rig.cut;
  }
  wreckSail(b, a, c, side, L) {
    const s = b.sailBy.main, col = (s && s.color) || 0xf2f0ea;
    const nu = 10, nv = 5, g = new THREE.BufferGeometry(), pos = new Float32Array((nu + 1) * (nv + 1) * 3), idx = [];
    const along = new THREE.Vector3().subVectors(c, a), across = new THREE.Vector3(-along.z, 0, along.x).normalize().multiplyScalar(-1);
    let k = 0;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const f = i / nu, w = j / nv;
      const p = a.clone().addScaledVector(along, 0.15 + 0.85 * f).addScaledVector(across, w * (s ? s.foot * 0.8 : 1.5) * (1 - 0.5 * f));
      p.y = Math.min(p.y, 0) - 0.05 - 0.1 * w + 0.06 * Math.sin(i * 1.7 + j * 2.3) * (0.3 + w);   // plastered on the sea, wrinkled
      if (f < 0.12) p.y = a.y - 0.3 * f / 0.12;
      pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z;
      if (i < nu && j < nv) { const q = j * (nu + 1) + i; idx.push(q, q + 1, q + nu + 1, q + 1, q + nu + 2, q + nu + 1); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
    return m;
  }

  // a torn sail: an alpha map with a ragged tear at the failure point (the cloth's own u, v: 0 at the luff / foot)
  tearSail(mesh, S, tear, b, key) {
    const mats = [mesh.material, ...(mesh.children.filter((c) => c.isMesh).map((c) => c.material))];
    if (!tear) { for (const m of mats) { m.alphaMap = null; m.alphaTest = 0; m.needsUpdate = true; } return; }
    const W = 128, H = 256;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    // uv.x = 1 - u (u = 0 at the luff), uv.y = v (0 at the foot); canvas y runs down from the top (v = 1)
    const cx = (1 - S.u) * W, cy = (1 - S.v) * H;
    const len = Math.min(0.9, 0.12 + tear * 1.1), wid = 0.03 + tear * 0.22;
    let seed = Math.floor(S.u * 997 + S.v * 131) + 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // the tear runs along the load path (across the chord, toward the luff) with ragged edges and a few flaps
    const ang = -0.35 + (S.v > 0.7 ? 0.6 : 0);
    g.save(); g.translate(cx, cy); g.rotate(ang);
    g.fillStyle = '#000'; g.beginPath();
    const n = 18, Lp = len * W * 1.2, Wp = wid * W;
    for (let i = 0; i <= n; i++) { const f = i / n, x = -Lp / 2 + f * Lp, y = -Wp * Math.sin(Math.PI * f) * (0.6 + 0.4 * rnd()); g.lineTo(x, y); }
    for (let i = n; i >= 0; i--) { const f = i / n, x = -Lp / 2 + f * Lp, y = Wp * Math.sin(Math.PI * f) * (0.5 + 0.5 * rnd()); g.lineTo(x, y); }
    g.closePath(); g.fill();
    // frayed threads along the edges
    g.strokeStyle = '#000'; g.lineWidth = 1;
    for (let i = 0; i < 30; i++) { const x = (rnd() - 0.5) * Lp, y = (rnd() - 0.5) * Wp * 2.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y + (rnd() - 0.5) * 10); g.stroke(); }
    g.restore();
    const tex = new THREE.CanvasTexture(cv);
    for (const m of mats) { if (m.alphaMap) m.alphaMap.dispose(); m.alphaMap = tex; m.alphaTest = 0.5; m.needsUpdate = true; }
  }
}
