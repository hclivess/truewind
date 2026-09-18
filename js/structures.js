// Man-made structures identified by humans in a per-venue feature manifest (OSM way IDs -> type).
// Viaducts get a deck on concrete piers, causeways and terminals get rock revetments with a concrete
// top, terminals get warehouses, cranes and containers. Nothing here is guessed from geometry alone.
import * as THREE from 'three';
import { mergeGeoms } from './models.js';

const mats = {};
const mat = (k, c, r = 0.85, m = 0) => mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m }));

export function indexFeatures(geo, manifest) {
  const byId = new Map();
  for (const f of (manifest && manifest.features) || []) for (const id of f.osm) byId.set(id, f);
  return byId;
}

// distance-based mask: true where houses/beach must not be placed (on labelled structures)
export function structureMask(geo, byId) {
  const segs = [];
  const add = (pts) => { for (let i = 0; i + 3 < pts.length; i += 2) segs.push([pts[i], pts[i + 1], pts[i + 2], pts[i + 3]]); };
  for (const c of geo?.coast || []) if (c.id && byId.has(c.id)) add(c.pts);
  for (const p of geo?.piers || []) if (p.id && byId.has(p.id)) add(p.pts);
  return (x, z, r = 90) => {
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
    }
    return false;
  };
}

export function buildStructures(world, geo, byId) {
  const group = new THREE.Group();
  if (!geo) return group;
  const parts = new Map();
  const put = (m, g) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(g); };
  const box = (m, w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(ry); g.translate(x, y, z); put(m, g); };
  const rock = mat('rock', 0x6f6a62, 0.95), concrete = mat('conc', 0xb9b4aa, 0.9), asphalt = mat('asph', 0x3a3c40, 0.95), pierC = mat('pierc', 0x9e9990, 0.9);
  // ---- revetments along labelled coastlines (causeway / terminal edges)
  for (const c of geo.coast || []) {
    const f = c.id && byId.get(c.id);
    if (!f || (f.type !== 'causeway' && f.type !== 'terminal')) continue;
    const h = f.height ?? 3;
    const pts = c.pts;
    const pos = [], idx = [], pos2 = [], idx2 = [];
    for (let i = 0; i + 1 < pts.length / 2; i++) {
      const ax = pts[2 * i], az = pts[2 * i + 1], bx = pts[2 * i + 2], bz = pts[2 * i + 3];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.5) continue;
      const nx = dz / L, nz = -dx / L; // land lies to the left of an OSM coastline
      // how wide is the land here? march inland until water again
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let wLand = 150;
      for (let s = 4; s < 150; s += 3) if (world.sdfAt(mx + nx * s, mz + nz * s) > 0) { wLand = s; break; }
      const top = f.type === 'causeway' ? Math.max(4, wLand / 2 + 1) : Math.min(40, wLand);
      const slope = 5;
      // rock slope: from below the waterline up to the crest
      const b0 = pos.length / 3;
      for (const [px, pz] of [[ax, az], [bx, bz]]) {
        pos.push(px - nx * 1.5, -1.2, pz - nz * 1.5, px + nx * slope, h, pz + nz * slope);
      }
      idx.push(b0, b0 + 2, b0 + 1, b0 + 1, b0 + 2, b0 + 3);
      // concrete top
      const b1 = pos2.length / 3;
      for (const [px, pz] of [[ax, az], [bx, bz]]) pos2.push(px + nx * slope, h, pz + nz * slope, px + nx * top, h, pz + nz * top);
      idx2.push(b1, b1 + 2, b1 + 1, b1 + 1, b1 + 2, b1 + 3);
      if (f.type === 'causeway') {
        // road and lamp posts on the crest
        const rx = nx * (top - 3.5), rz = nz * (top - 3.5);
        const g = new THREE.BoxGeometry(6, 0.05, L + 0.5); g.rotateY(Math.atan2(dx, dz)); g.translate(mx + rx, h + 0.03, mz + rz); put(asphalt, g);
        if (i % 3 === 0) { box(mat('lamp', 0x8a8f96, 0.4, 0.7), 0.15, 7, 0.15, mx + nx * (slope + 1), h + 3.5, mz + nz * (slope + 1)); box(mat('lamph', 0xfff3c8, 0.3), 0.6, 0.15, 0.3, mx + nx * (slope + 1.3), h + 7, mz + nz * (slope + 1.3)); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); put(rock, g);
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3)); g2.setIndex(idx2); g2.computeVertexNormals(); put(concrete, g2);
  }
  // ---- viaducts and piers on piles
  for (const p of geo.piers || []) {
    const f = p.id && byId.get(p.id);
    if (!f && p.kind === 'bridge') continue;            // road bridges over land: not ours to draw
    const deck = f?.deck ?? (p.kind === 'pier' ? 2.6 : 1.4), w = f?.width ?? p.w;
    const pts = p.pts, isVia = f?.type === 'viaduct';
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const ry = Math.atan2(bx - ax, bz - az);
      if (!f && p.kind === 'breakwater') { box(rock, w, 2.5, L + w * 0.5, (ax + bx) / 2, 0.9, (az + bz) / 2, ry); continue; }
      box(isVia ? concrete : mat('wood', 0x7a6650), w, isVia ? 1.2 : 0.8, L + 0.2, (ax + bx) / 2, deck, (az + bz) / 2, ry);
      if (isVia) { box(concrete, 0.3, 1.1, L, (ax + bx) / 2 + Math.cos(ry) * w / 2, deck + 1.1, (az + bz) / 2 - Math.sin(ry) * w / 2, ry); box(concrete, 0.3, 1.1, L, (ax + bx) / 2 - Math.cos(ry) * w / 2, deck + 1.1, (az + bz) / 2 + Math.sin(ry) * w / 2, ry); }
      const spacing = isVia ? 12 : 8;
      for (let t = 0; t < L; t += spacing) {
        const u = t / L, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        if (world.sdfAt(x, z) < -2) continue;
        if (isVia) box(pierC, w * 0.8, deck + 3, 1.6, x, (deck - 3) / 2, z, ry);
        else box(mat('wood', 0x7a6650), 0.4, deck + 3, 0.4, x, (deck - 3) / 2, z, ry);
      }
    }
  }
  // ---- terminal: warehouses, gantry cranes, container stacks on labelled terminal land
  const termLines = (geo.coast || []).filter(c => c.id && byId.get(c.id)?.type === 'terminal');
  if (termLines.length) {
    const h = byId.get(termLines[0].id).height ?? 3.8;
    let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    for (const c of termLines) for (let i = 0; i < c.pts.length; i += 2) { minx = Math.min(minx, c.pts[i]); maxx = Math.max(maxx, c.pts[i]); minz = Math.min(minz, c.pts[i + 1]); maxz = Math.max(maxz, c.pts[i + 1]); }
    const cols = [0xb8412c, 0x1d4e89, 0x2e7d4f, 0xd9a21b, 0x6b6f75, 0x9c2f5a];
    let n = 0;
    for (let z = minz + 30; z < maxz - 20; z += 28) for (let x = minx + 30; x < maxx - 20; x += 26) {
      if (world.sdfAt(x, z) > -18) continue;
      const k = (n++ * 7919) % 17;
      if (k < 3) box(mat('whs', 0xd8d4cc, 0.8), 22, 11, 18, x, h + 5.5, z);
      else if (k < 12) for (let s = 0; s < 1 + (k % 3); s++) box(mat('cont' + (k % 6), cols[(k + s) % 6], 0.7), 2.5, 2.6, 12, x, h + 1.3 + s * 2.6, z);
    }
    // two gantry cranes on the quay edge
    const q = termLines[0].pts;
    for (let j = 0; j < 2; j++) {
      const i = Math.floor(q.length / 2 * (0.3 + j * 0.3)) * 2;
      const x = q[i], z = q[i + 1];
      const cm = mat('crane', j ? 0x1d4e89 : 0xc8412c, 0.6, 0.3);
      for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) box(cm, 1, 30, 1, x + dx, h + 15, z + dz);
      box(cm, 2, 2, 60, x, h + 31, z); box(cm, 14, 2, 2, x, h + 31, z - 6); box(cm, 14, 2, 2, x, h + 31, z + 6);
    }
  }
  for (const [m, list] of parts) { const mesh = new THREE.Mesh(mergeGeoms(list), m); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); }
  return group;
}
