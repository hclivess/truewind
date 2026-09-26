// Seamarks in 3D: lighthouses (height and bands from the tags) and beacons merged into one static mesh; buoys by
// IALA shape, colours and topmark as one InstancedMesh per design, floating on the wave field; every light as a
// glowing point with its real characteristic, colour and sectors (seen from the camera), fading with range and
// haze; rotating beams on the major lights. Cheap: a few draw calls and one small attribute upload a frame.
import * as THREE from 'three';
import { resolveMark, lightPhases, lightAt, inSector, GLOW, PAINT, colourName } from './seamarks.js';
import { groundHeight } from './scenery.js';

const TAU = Math.PI * 2;
const col3 = (name) => new THREE.Color(PAINT[name] ?? PAINT[colourName(name)] ?? 0x8a8d90);
const glow = (c) => GLOW[colourName(c)] || GLOW.white;
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ geometry accumulator (vertex colours)
class Acc {
  constructor() { this.p = []; this.n = []; this.c = []; }
  add(geo, color, M) {
    if (M) geo.applyMatrix4(M);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { this.p.push(P[i]); this.n.push(N[i]); }
    for (let i = 0; i < P.length / 3; i++) this.c.push(color.r, color.g, color.b);
    geo.dispose(); if (g !== geo) g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return !this.p.length; }
}
// a solid of revolution r = prof(y) over [y0, y1], painted in bands (horizontal: top colour first) or stripes
function body(acc, prof, y0, y1, colours, pat, M, steps = 3) {
  const cs = colours.length ? colours : ['grey'];
  const lathe = (ya, yb, capB, capT, c, phS = 0, phL = TAU) => {
    const pts = [];
    if (capB) pts.push(new THREE.Vector2(0.0001, ya));
    for (let k = 0; k <= steps; k++) { const y = ya + (yb - ya) * k / steps; pts.push(new THREE.Vector2(Math.max(0.0001, prof(y)), y)); }
    if (capT) pts.push(new THREE.Vector2(0.0001, yb));
    const g = new THREE.LatheGeometry(pts, 14, phS, phL);
    acc.add(g, col3(c), M ? M.clone() : null);
  };
  if (pat === 'vertical' && cs.length > 1) { const n = cs.length * 4; for (let i = 0; i < n; i++) lathe(y0, y1, true, true, cs[i % cs.length], i / n * TAU, TAU / n); return; }
  const n = cs.length, h = (y1 - y0) / n;
  for (let i = 0; i < n; i++) lathe(y1 - (i + 1) * h, y1 - i * h, i === n - 1, i === 0, cs[i]);
}
const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
// IALA topmarks, standing on y0 (size s); returns the top
function topmark(acc, tm, tc, y0, s, M) {
  if (!tm) return y0;
  const c = (tc && tc.length ? tc : ['black']).map(x => x.toLowerCase());
  const at = (y) => M.clone().multiply(M4(0, y, 0));
  const pole = () => { acc.add(new THREE.CylinderGeometry(s * 0.06, s * 0.06, s * 0.35, 6), col3('black'), at(y0 + s * 0.17)); };
  pole(); y0 += s * 0.3;
  const cn = (y, dir, cc) => { const g = new THREE.ConeGeometry(s * 0.5, s * 0.8, 14); acc.add(g, col3(cc), at(y + s * 0.4).multiply(M4(0, 0, 0, dir > 0 ? 0 : Math.PI))); };
  const sph = (y, cc) => acc.add(new THREE.SphereGeometry(s * 0.42, 12, 8), col3(cc), at(y + s * 0.42));
  const t = String(tm).toLowerCase();
  if (t === '2 cones up') { cn(y0, 1, c[0]); cn(y0 + s * 0.95, 1, c[0]); return y0 + s * 1.75; }
  if (t === '2 cones down') { cn(y0, -1, c[0]); cn(y0 + s * 0.95, -1, c[0]); return y0 + s * 1.75; }
  if (t === '2 cones base together') { cn(y0, -1, c[0]); cn(y0 + s * 0.8, 1, c[0]); return y0 + s * 1.6; }
  if (t === '2 cones point together') { cn(y0, 1, c[0]); cn(y0 + s * 0.8, -1, c[0]); return y0 + s * 1.6; }
  if (/cone.*up/.test(t)) { cn(y0, 1, c[0]); return y0 + s * 0.8; }
  if (/cone.*down/.test(t)) { cn(y0, -1, c[0]); return y0 + s * 0.8; }
  if (t === '2 spheres') { sph(y0, c[0]); sph(y0 + s * 0.9, c[0]); return y0 + s * 1.75; }
  if (/sphere/.test(t)) { sph(y0, c[0]); return y0 + s * 0.84; }
  if (/cylinder|can/.test(t)) { acc.add(new THREE.CylinderGeometry(s * 0.4, s * 0.4, s * 0.8, 14), col3(c[0]), at(y0 + s * 0.4)); return y0 + s * 0.8; }
  if (/x-shape|saltire|cross/.test(t)) {
    const r = t === 'cross' ? 0 : Math.PI / 4;
    for (const a of [r, r + Math.PI / 2]) acc.add(new THREE.BoxGeometry(s * 0.95, s * 0.16, s * 0.08), col3(c[0]), at(y0 + s * 0.45).multiply(M4(0, 0, 0, 0, 0, a)));
    return y0 + s * 0.9;
  }
  if (/square|board|rhombus|cube/.test(t)) { acc.add(new THREE.BoxGeometry(s * 0.7, s * 0.7, s * 0.08), col3(c[0]), at(y0 + s * 0.35).multiply(M4(0, 0, 0, 0, 0, /rhombus/.test(t) ? Math.PI / 4 : 0))); return y0 + s * 0.7; }
  return y0;
}

// a buoy at the origin (waterline y = 0); returns the light's height
function buoyGeometry(acc, m) {
  const M = new THREE.Matrix4(), sh = m.sh || 'pillar', cs = m.col, pat = m.pat;
  let top = 1;
  if (sh === 'can') { body(acc, () => 0.6, -0.5, 1.2, cs, pat, M, 1); top = 1.2; }
  else if (sh === 'conical') { body(acc, (y) => y < 0 ? 0.68 : 0.68 * (1 - y / 1.75), -0.5, 1.45, cs, pat, M, 4); top = 1.45; }
  else if (sh === 'spherical') { body(acc, (y) => Math.sqrt(Math.max(0, 0.75 ** 2 - (y - 0.3) ** 2)), -0.35, 1.05, cs, pat, M, 5); top = 1.05; }
  else if (sh === 'spar') { body(acc, () => 0.13, -0.8, 3.2, cs, pat, M, 1); top = 3.2; }
  else if (sh === 'barrel') { acc.add(new THREE.CylinderGeometry(0.5, 0.5, 1.3, 14), col3(cs[0]), M4(0, 0.2, 0, 0, 0, Math.PI / 2)); top = 0.7; }
  else if (sh === 'light_vessel') {
    acc.add(new THREE.BoxGeometry(6, 3.5, 22), col3(cs[0]), M4(0, 0.6, 0));
    body(acc, () => 0.9, 2.3, 11, cs, null, M4(), 1); acc.add(new THREE.CylinderGeometry(1.1, 1.1, 1.4, 10), col3('grey'), M4(0, 11.7, 0)); top = 12.6;
  } else {
    // pillar / super-buoy: a float, a lattice-like tapered tower, a light platform
    const big = sh === 'super-buoy' ? 1.7 : 1;
    body(acc, () => 0.95 * big, -0.5, 0.55 * big, [cs[cs.length - 1]], null, M, 1);
    body(acc, (y) => (0.42 - 0.12 * (y - 0.55 * big) / (2.6 * big)) * big, 0.55 * big, 3.15 * big, cs, pat, M, 1);
    acc.add(new THREE.CylinderGeometry(0.5 * big, 0.5 * big, 0.06, 12), col3('grey'), M4(0, 3.18 * big, 0));
    top = 3.2 * big;
  }
  const lightY = top + 0.25;
  if (m.L && sh !== 'light_vessel') { acc.add(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8), col3('grey'), M4(0, top + 0.15, 0)); top += 0.3; }
  topmark(acc, m.tm, m.tc, top, sh === 'spar' || sh === 'can' || sh === 'conical' || sh === 'spherical' ? 0.5 : 0.6, new THREE.Matrix4());
  return lightY;
}

export class SeamarkLayer {
  constructor(scene, opts = {}) {
    this.scene = scene; this.low = !!opts.low;
    this.group = new THREE.Group(); this.group.name = 'seamarks';
    scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05 });
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.2, metalness: 0.4, emissive: 0xffe0a0, emissiveIntensity: 0 });
    this.lights = []; this.buoys = []; this.beams = [];
  }
  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); }
    this.lights = []; this.buoys = []; this.beams = []; this.points = null; this.designs = [];
  }

  set(world, data) {
    this.clear();
    this.world = world;
    if (!data || !data.marks || !world || world.open) return;
    const region = data.region || 'A';
    this.marks = data.marks.map(m => resolveMark(m, region));
    const stat = new Acc(), lanterns = new Acc();
    const designs = new Map();
    for (const m of this.marks) {
      if (/^(wreck|rock|obstruction|landmark)$/.test(m.t) && !m.L) continue;
      const floating = /^buoy_/.test(m.t) || m.t === 'light_float' || m.t === 'light_vessel';
      const sdf = world.sdfAt(m.x, m.z);
      const ground = m.far ? 0 : groundHeight(world, m.x, m.z);
      let lightY = 3;
      if (floating) {
        if (m.far) { lightY = m.t === 'light_vessel' ? 12 : 5; }
        else {
          const key = [m.sh, m.col.join('/'), m.pat || '', m.tm || '', (m.tc || []).join('/'), m.L ? 1 : 0, m.t === 'light_vessel' ? 1 : 0].join('|');
          let d = designs.get(key);
          if (!d) { const acc = new Acc(); const ly = buoyGeometry(acc, m); d = { key, geo: acc.build(), lightY: ly, list: [] }; designs.set(key, d); }
          lightY = d.lightY;
          const b = { m, x: m.x, z: m.z, yaw: hash(m.x, m.z) * TAU, d, i: d.list.length, y: 0, lightY };
          d.list.push(b); this.buoys.push(b);
        }
      } else if (!m.far) {
        lightY = this.fixedMark(stat, lanterns, m, ground, sdf);
      } else {
        const lh = m.L && m.L[0].ht; lightY = lh || (m.h ? m.h : 20);
      }
      if (m.L) m.L.forEach((L, li) => this.addLight(m, L, li, lightY));
    }
    if (!stat.empty) { const mesh = new THREE.Mesh(stat.build(), this.mat); mesh.castShadow = false; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; this.group.add(mesh); }
    if (!lanterns.empty) { const mesh = new THREE.Mesh(lanterns.build(), this.lanternMat); mesh.matrixAutoUpdate = false; this.group.add(mesh); }
    // buoys: one instanced mesh per design
    this.designs = [...designs.values()];
    for (const d of this.designs) {
      const im = new THREE.InstancedMesh(d.geo, this.mat, d.list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      d.mesh = im; this.group.add(im);
      for (const b of d.list) this.placeBuoy(b, 0, 0, 0);
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    }
    this.buildPoints();
  }

  // lighthouse / beacon / light structure standing on the ground or the sea bed; returns the light's height
  fixedMark(acc, lanterns, m, ground, sdf) {
    const wet = sdf > 1 || ground < 0.3;
    const base = wet ? Math.max(ground, -30) - 0.5 : ground - 1;
    const cs = m.col, pat = m.pat, x = m.x, z = m.z;
    const at = (y = 0) => M4(x, y, z);
    const focal = m.L && m.L.find(l => l.ht)?.ht;
    if (m.t === 'lighthouse' || m.t === 'light_major' || (m.t === 'light_minor' && (m.h || focal > 8))) {
      const major = m.t !== 'light_minor';
      let foot = wet ? 2.8 : ground;
      // towers in the water stand on a caisson
      if (wet) body(acc, () => major ? 5.5 : 3, base, foot, ['grey'], null, at(), 1);
      let H = m.h || (focal ? focal - foot : 0);
      if (!(H > 3 && H < 90)) H = m.t === 'lighthouse' ? 18 : major ? 13 : 7;
      const r0 = Math.max(major ? 1.8 : 0.9, H * 0.085), r1 = r0 * 0.66, yT = foot + H - 2.6;
      body(acc, (y) => r0 + (r1 - r0) * (y - (foot - 1)) / (yT - foot + 1), foot - 1, yT, cs, pat || 'horizontal', at(), 2);
      // gallery, lantern room, dome
      acc.add(new THREE.CylinderGeometry(r1 + 0.45, r1 + 0.3, 0.3, 16), col3('black'), at(yT + 0.15));
      acc.add(new THREE.CylinderGeometry(r1 + 0.45, r1 + 0.45, 0.5, 16, 1, true), col3('black'), at(yT + 0.55));
      (m.L ? lanterns : acc).add(new THREE.CylinderGeometry(r1 * 0.72, r1 * 0.72, 1.6, 12), m.L ? new THREE.Color(1, 1, 1) : col3('grey'), at(yT + 1.1));   // (a dark lantern on a disused light)
      acc.add(new THREE.SphereGeometry(r1 * 0.78, 12, 6, 0, TAU, 0, Math.PI / 2), col3(cs.includes('red') ? 'red' : 'black'), at(yT + 1.9));
      return yT + 1.1;
    }
    if (m.t === 'light_minor' || m.t === 'landmark') {
      // a pier-head or harbour light: a post with a lamp
      const top = (wet ? 1.5 : ground) + 4;
      body(acc, () => 0.16, base, top, cs.length && cs[0] !== 'grey' ? cs : ['white'], pat, at(), 1);
      lanterns.add(new THREE.CylinderGeometry(0.18, 0.18, 0.35, 8), new THREE.Color(1, 1, 1), at(top + 0.18));
      return top + 0.2;
    }
    // beacons: stake / pile / post / perch / tower / lattice, with the topmark on top
    const sh = m.sh || 'stake';
    let top;
    if (/tower|lattice|cairn|buoyant/.test(sh)) {
      top = (wet ? 1.5 : ground) + 5.5;
      const r = sh === 'lattice' ? 0.9 : 0.75;
      body(acc, (y) => y < top - 5.5 ? r * 1.3 : r * (1 - 0.35 * (y - (top - 5.5)) / 5.5), base, top, cs, pat, at(), 1);
    } else {
      top = (wet ? 1.5 : ground) + (sh === 'pile' ? 3.2 : 4.2);
      const r = sh === 'pile' ? 0.28 : 0.13;
      if (base < top - 4.2) body(acc, () => r, base, top - 4.2, ['black'], null, at(), 1);
      body(acc, () => r, Math.max(base, top - 4.2), top, cs, pat, at(), 1);
    }
    let y = top;
    if (m.L) { acc.add(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 8), col3('grey'), at(top + 0.17)); y += 0.35; }
    topmark(acc, m.tm, m.tc, y, 0.8, at());
    return top + 0.25;
  }

  addLight(m, L, li, lightY) {
    const P = lightPhases(L);
    const major = /^(lighthouse|light_major|light_vessel)$/.test(m.t);
    const rng = L.rng || (major ? 15 : m.t === 'light_minor' ? 5 : /^beacon/.test(m.t) ? 4 : 3);
    const colours = (L.col && L.col.length ? L.col : ['W']).map(glow);
    const rec = { m, L, P, rng, colours, y: lightY, off: hash(m.x + li, m.z) * 97, cur: 0, major, sector: L.s0 !== undefined || L.ori !== undefined };
    this.lights.push(rec);
    // rotating optics: one beam per flash of the group, the assembly turning once a period
    const code = String(L.ch || '').replace(/^Al\./, '');
    if (major && !rec.sector && /^(Fl|LFl)/.test(code) && !this.low && this.beams.length < 12) {
      const centres = []; let u = 0;
      for (const [d, i] of P.ph) { if (i >= 1) centres.push(u + d / 2); u += d; }
      for (const c of centres) {
        const mesh = new THREE.Mesh(BEAM_GEO(), beamMaterial(colours[0]));
        mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 6;
        this.group.add(mesh);
        this.beams.push({ rec, c, mesh });
      }
    }
  }

  buildPoints() {
    const n = this.lights.length;
    if (!n) return;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(n * 3); this.pCol = new Float32Array(n * 3); this.pSize = new Float32Array(n);
    this.lights.forEach((l, i) => { this.pPos[i * 3] = l.m.x; this.pPos[i * 3 + 1] = l.y; this.pPos[i * 3 + 2] = l.m.z; });
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(g, POINT_MAT());
    pts.frustumCulled = false; pts.renderOrder = 7;
    this.points = pts; this.group.add(pts);
  }

  placeBuoy(b, h, sx, sz) {
    const q = _q.setFromEuler(_e.set(Math.atan(sz) * 0.8, b.yaw, -Math.atan(sx) * 0.8, 'YXZ'));
    _m.compose(_v.set(b.x, h - 0.1, b.z), q, _s);
    b.d.mesh && b.d.mesh.setMatrixAt(b.i, _m);
    b.y = h;
  }

  // night: 0 by day .. 1 after dusk (photocells switch the lights on around sunset)
  update(dt, t, camera, env, sunY, fogDensity = 0, pixelRatio = 1, viewH = 800) {
    if (!this.world || !this.marks) return;
    const cam = camera.position;
    // buoys near the camera ride the waves (the rest sit still: they are a pixel or two out there)
    const tmp = this._tmp || (this._tmp = {});
    this._near = (this._near ?? 0) - dt;
    if (this._near <= 0) { this._near = 1; this.nearList = this.buoys.filter(b => Math.hypot(b.x - cam.x, b.z - cam.z) < (this.low ? 400 : 800)); }
    const dirty = new Set();
    for (const b of this.nearList || []) {
      const w = env && env.wavesOn !== false && env.waves ? env.waves.sample(b.x, b.z, t, tmp) : null;
      this.placeBuoy(b, w ? w.h : 0, w ? w.sx : 0, w ? w.sz : 0); dirty.add(b.d);
    }
    for (const d of dirty) d.mesh.instanceMatrix.needsUpdate = true;
    // lights
    const on = clamp01((0.07 - sunY) / 0.07);
    this.lanternMat.emissiveIntensity = 0.8 * on;
    const thr = Math.pow(10, clamp((sunY + 0.12) * 14, 0, 5.5));        // what the eye can pick out against the sky
    const T = 0.74;                                                     // atmospheric transmissivity per nautical mile (10 nm visibility)
    const eye = Math.max(1, cam.y);
    if (this.points) {
      const k = Math.min(1, dt * 30);
      this.lights.forEach((l, i) => {
        let y = l.y;
        if (l.buoy === undefined) l.buoy = this.buoys.find(b => b.m === l.m) || null;
        if (l.buoy) { y = l.buoy.y + l.y; this.pPos[i * 3 + 1] = y; }
        const dx = l.m.x - cam.x, dz = l.m.z - cam.z, dy = y - cam.y, dm = Math.hypot(dx, dz, dy), d = Math.max(0.005, dm / 1852);
        let tgt = 0, ci = 0;
        if (on > 0 && d < l.rng * 1.6) {
          const brg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
          // below the horizon: the geometric range of the light over the curved sea (2.08 (sqrt h + sqrt eye) nm)
          const geo = 2.08 * (Math.sqrt(Math.max(1, y)) + Math.sqrt(eye));
          if (inSector(l.L, brg) && d < geo) {
            const s = (l.rng / d) ** 2 * Math.pow(T, d - l.rng) / thr * Math.exp(-((fogDensity * dm) ** 2) * 0.3);
            if (s > 1) { const [li, c] = lightAt(l.P, t, l.off); tgt = Math.min(1.25, Math.log10(s) / 3.2 + 0.08) * li * on; ci = c; }
          }
        }
        l.cur += (tgt - l.cur) * (tgt > l.cur ? Math.min(1, dt * 60) : k);   // lamp filaments and rotating optics ease off
        const c = l.colours[ci % l.colours.length], v = l.cur;
        this.pCol[i * 3] = c[0] * v; this.pCol[i * 3 + 1] = c[1] * v; this.pCol[i * 3 + 2] = c[2] * v;
        this.pSize[i] = v > 0.004 ? (8 + (l.major ? 90 : 44) * Math.min(1, v)) * pixelRatio * viewH / 800 : 0;
      });
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true; g.attributes.aCol.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    }
    // beams: sweep so each passes the camera at its flash
    for (const bm of this.beams) {
      const l = bm.rec, dx = cam.x - l.m.x, dz = cam.z - l.m.z, dist = Math.hypot(dx, dz);
      const vis = on > 0.2 && dist < 14000 && dist > 30;
      bm.mesh.visible = vis;
      if (!vis) continue;
      const u = ((t + l.off) % l.P.per + l.P.per) % l.P.per;
      const az = Math.atan2(dx, -dz) + TAU * (u - bm.c) / l.P.per;
      bm.mesh.position.set(l.m.x, l.y, l.m.z);
      bm.mesh.rotation.set(0, -az, 0, 'YXZ');
      bm.mesh.material.uniforms.uI.value = on * 0.55 * Math.exp(-((fogDensity * dist) ** 2) * 0.15);
    }
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), clamp01 = (v) => clamp(v, 0, 1);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

// a glowing point: a hot core and a soft halo (the bloom the eye sees around a light at night)
let _pm = null;
function POINT_MAT() {
  if (_pm) return _pm;
  _pm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute float aSize; varying vec3 vCol;
      void main() {
        vCol = aCol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z -= 0.002 * gl_Position.w;       // (stay in front of the lantern it sits in)
        gl_PointSize = aSize;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 160.0) * 2.6 + exp(-r2 * 40.0) * 0.7, halo = exp(-r2 * 7.0) * 0.4 + (1.0 - r2) * (1.0 - r2) * 0.08;
        vec3 c = vCol * (core + halo) + vec3(core * 0.35) * max(max(vCol.r, vCol.g), vCol.b);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return _pm;
}
// a beam: a long narrow cone from the lantern, brightest along its axis and near the light
let _bg = null;
function BEAM_GEO() {
  if (_bg) return _bg;
  const L = 2600, g = new THREE.ConeGeometry(L * 0.05, L, 16, 1, true);
  g.translate(0, -L / 2, 0); g.rotateX(Math.PI / 2 - 0.004);   // apex at the lantern, pointing north (-z), dipping a touch
  _bg = g; return g;
}
function beamMaterial(c) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Vector3(...c) }, uI: { value: 0 } },
    vertexShader: /* glsl */`
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = clamp(-position.z / 2600.0, 0.0, 1.0);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uI; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
        float fall = exp(-vAlong * 4.0) * smoothstep(0.0, 0.01, vAlong);
        gl_FragColor = vec4(uCol * uI * face * fall * 0.5, 1.0);
      }`,
  });
}
