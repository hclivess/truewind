// The cruising yachts of the harbour traffic nearest the camera, drawn with the game's own boat models (js/models.js,
// the detailed classes: lofted hull with its bottom paint, boot top and cove stripe in the hull shader, deck,
// coachroof, hardware, standing rig, the strip model's sails with their camber and twist). A few models are built
// once per design (a modern cruiser: the Oceanis 38.1; a classic: the Catalina 30) and lent to whichever traffic
// yachts are nearest, recoloured and scaled to each; the rest stay on js/traffic-render.js's instanced models.
// No physics runs for them: the traffic (js/traffic.js) moves them, and their sails are set from its boom angle.
import * as THREE from 'three';
import { Boat, CLASSES, STRIP_F } from './physics.js';
import { buildBoatModel, updateBoatModel } from './models.js';

const DESIGNS = ['catalina30', 'oceanis381'];       // (traffic-render keyOf: yacht0 the classic, yacht1 the modern)
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class NearYachts {
  // max: how many at once; R: within how many metres of the camera (a boat leaves 20 % further out)
  constructor(scene, { max = 3, R = 70 } = {}) {
    this.scene = scene; this.max = max; this.R = R;
    this.pool = DESIGNS.map(() => []);       // per design: [{ boat, vis, cover, v }]
    this.on = new Map();                     // vessel -> slot
    this._c = new THREE.Color();
  }
  dispose() { for (const P of this.pool) for (const s of P) this.scene.remove(s.vis.root); this.pool = DESIGNS.map(() => []); this.on.clear(); }
  _slot(d) {
    const P = this.pool[d];
    const free = P.find((s) => !s.v);
    if (free) return free;
    if (P.length >= this.max) return null;
    const C = CLASSES[DESIGNS[d]];
    if (!C) return null;
    const boat = new Boat(C, { id: 900 + P.length, name: '', sailModel: 'strip', lod: 2 });
    const vis = buildBoatModel(boat, { hullColor: 0xffffff, name: '' });
    vis.root.visible = false;
    if (vis.telltales) vis.telltales.visible = false;
    // a sail cover on the main boom, in the boat's canvas colour, while the sails are down
    let cover = null;
    const main = boat.sailBy.main, piv = vis.booms && vis.booms.main;
    if (main && piv && !main.furling) {
      const L = main.foot * 0.92;
      cover = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, L - 0.32, 4, 10), new THREE.MeshStandardMaterial({ color: 0x1d3f6e, roughness: 0.85 }));
      cover.rotation.x = Math.PI / 2; cover.position.set(0, 0.12, L / 2 + 0.05); cover.scale.set(1, 1, 0.85); cover.castShadow = true;
      piv.add(cover);
    }
    // the topsides' vertex colour (the hull geometry: the meshes carrying a sheerZ attribute)
    const hulls = [];
    vis.root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.sheerZ && o.geometry.attributes.color) hulls.push(o.geometry); });
    this.scene.add(vis.root);
    const s = { boat, vis, cover, hulls, v: null, d };
    P.push(s);
    return s;
  }
  _assign(s, v) {
    s.v = v; v._proxy = s; this.on.set(v, s);
    const c = this._c.setHex(v.color);
    for (const g of s.hulls) { const a = g.attributes.color; for (let i = 0; i < a.count; i++) a.setXYZ(i, c.r, c.g, c.b); a.needsUpdate = true; }
    if (s.cover) s.cover.material.color.setHex(v.canvas ?? 0x1d3f6e);
    const k = v.L / s.boat.cls.loa;
    s.vis.root.scale.setScalar(k);
    s.vis.root.visible = true;
    v._dirty = true;
  }
  _release(s) {
    const v = s.v;
    if (v) { v._proxy = null; v._dirty = true; this.on.delete(v); }
    s.v = null; s.vis.root.visible = false;
  }
  // per frame: pick the yachts (one new model built a frame at most), pose them and their sails
  update(traffic, cam, t, keyOf) {
    if (!traffic || !this.max) return;
    const cx = cam.position.x, cz = cam.position.z;
    if (!this._n || (this._n = (this._n + 1) % 10) === 0) {
      this._n = this._n || 1;
      const want = traffic.vessels.filter((v) => v.type === 'yacht' && !v.hidden && v._d !== undefined && v._d < this.R * (v._proxy ? 1.2 : 1)).sort((a, b) => a._d - b._d);
      const keep = new Set();
      const per = [0, 0];
      for (const v of want) { const d = keyOf(v) === 'yacht1' ? 1 : 0; if (per[d] < this.max) { per[d]++; keep.add(v); } }
      for (const [v, s] of [...this.on]) if (!keep.has(v)) this._release(s);
      let built = false;
      for (const v of keep) {
        if (v._proxy) continue;
        const d = keyOf(v) === 'yacht1' ? 1 : 0, P = this.pool[d];
        if (!P.some((s) => !s.v) && built) continue;           // (a new model: one a frame)
        if (!P.some((s) => !s.v)) built = true;
        const s = this._slot(d);
        if (s) this._assign(s, v);
      }
    }
    for (const [v, s] of this.on) this._pose(s, v, t);
  }
  _pose(s, v, t) {
    const b = s.boat, C = b.cls;
    // the pose the traffic gives her (traffic-render: heave on the drawn sea, pitch, roll = heel + the sea's slope)
    b.x = v.x; b.z = v.z; b.psi = v.psi;
    b.pose = { x: v.x, z: v.z, psi: v.psi, heave: v.heave || 0, pitch: v.pitch || 0, phi: v.roll || 0, booms: null };
    b.rudder = 0;
    // the sails: under way under sail, set to leeward at the traffic's boom angle with the strip model's twist,
    // depth and draft; otherwise furled (in-mast furling on the modern design; a cover on the classic's boom)
    const up = !!v.sails, side = -Math.sign(v.twa || 1), a = side * clamp(v.boom || 0.3, 0.05, 1.4);
    b.diag.awa = up ? -side * Math.max(0.3, Math.abs(v.twa || 0) * 0.7) : 0;
    for (const sl of b.sails) {
      const st = b.diag.strips[sl.key], sh = b.diag.shape[sl.key];
      const set = up && (sl.key === 'main' || sl.key === 'jib');
      st.areaF = set ? 1 : 0;
      const base = sl.key === 'main' ? a : side * clamp(Math.abs(a) * 0.72, 0.12, 0.62);
      st.baseAngle = base;
      for (let i = 0; i < 3; i++) {
        const f = STRIP_F[i];
        sh[i].ang = base + side * (0.03 + 0.16 * f);               // (twist: the leech opens up the sail)
        sh[i].d = sl.key === 'main' ? 0.09 + 0.02 * f : 0.11 + 0.01 * f;
        sh[i].f = 0.42 + 0.04 * f;
        st[i].flog = 0; st[i].state = 0;
      }
      if (b.booms[sl.key]) b.booms[sl.key].a = set ? base : 0;
    }
    updateBoatModel(s.vis, b, t);
    if (s.vis.telltales) s.vis.telltales.visible = false;
    if (s.cover) s.cover.visible = !up;
  }
}
