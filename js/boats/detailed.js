// Detailed models of the production and famous boats (the classes in js/classes/ that carry C.model): the hull
// lofted from the class's table of offsets (js/hull.js, shared with the hydrostatics), its paint, the deck with
// its cockpit well, coamings and seats, cabin trunks and houses with their windows and portlights, hatches,
// handrails, toerails or bulwarks, stanchions, pulpit and pushpit, bowsprit and bumpkin, mooring cleats and
// chainplates, the tiller or wheel(s), the keel, board and rudder at their real positions and sizes, the spars
// (masts with their spreaders and standing rigging, booms, gaff, yard, sprit, spinnaker pole) and the sails.
// No crew figures (their weight is in the physics only).
//
// C.model (all lengths in metres, x forward from the CG, heights above the DWL; t = 0 stern .. 1 bow):
//   cockpit { t0, t1, w (fraction of the deck half-breadth), sole, seat (seat height above the sole), coaming (h) }
//   deck 'nonskid' | 'teak' | 'paint', deckTint, toerail 'alu' | 'teak' | 'none' | { bulwark: h, cap }
//   cabins [{ t0, t1, h: [[t, h]], w: [[t, half width]], slope, camber, frontRake, aftRake, side, roof, trim,
//            windows: [{ kind: 'port' | 'rect' | 'slot' | 'front', t0, t1, n, r, zf, hf }], hatches, handrails, companion }]
//   lifelines { t0, t1, h, pulpit, pushpit }, steering { kind: 'tiller' | 'wheel' | 'twin', x, r, len, mat }
//   bowsprit { len, kind: 'plank' | 'pole', w, bobstay, pulpit }, bumpkin { len }, outboard { x, y }
//   hullWindows [{ t0, t1, z0, z1 }], masts: { main: { mat, r, rTop, spreaders: [{ f, len, sweep }], hounds, ratlines } }
//   keel { kind: 'fin' | 'swing' | 'centreboard' | 'dagger' | 'full', ... }, rudder { kind: 'spade' | 'skeg' | 'keel' | 'transom', ... }
//   extras [name]: the boat's own pieces (EXTRAS below)
import * as THREE from 'three';
import { MODEL_HOOKS, transomDecal, M, Kit, V, canvasTex, rnd, hullGeometry, deckGeometry, deckHeightFn, foilGeom, lathe, sailMesh, teakTex } from '../models.js';
import { linesFor, hullOffsets, calibrate, curveOf } from '../hull.js';
import { clamp, lerp, sstep } from '../physics.js';

const matCache = {};
const mat = (key, make) => matCache[key] || (matCache[key] = make());
const paint = (c, rough = 0.35, metal = 0.02) => mat(`p${c}-${rough}-${metal}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, side: THREE.DoubleSide }));
const wood = (c = 0xc89a64) => mat('wood' + c, () => new THREE.MeshStandardMaterial({ map: teakTex(), color: c, roughness: 0.4, side: THREE.DoubleSide }));
const glassT = () => mat('glassT', () => new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.06, metalness: 0.5, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
const nonskid = (tint) => mat('dns' + tint, () => new THREE.MeshStandardMaterial({ map: canvasTex('dns-' + tint, 128, 128, (g, w, h) => {
  g.fillStyle = tint; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) g.fillRect(x, y, 3, 3);
}, 1), roughness: 0.85, side: THREE.DoubleSide }));
const spar = (kind) => kind === 'wood' ? mat('spar-wood', () => new THREE.MeshStandardMaterial({ map: teakTex(), color: 0xe8c48c, roughness: 0.35 }))
  : kind === 'black' ? M.black() : kind === 'carbon' ? M.carbon() : kind === 'white' ? paint(0xf0f0ec, 0.4) : kind === 'grey' ? paint(0xb9bec2, 0.45, 0.3) : M.alu();

// a curve given as a number, a function or [[t, v]] rows
const fnOf = (v) => (typeof v === 'function' ? v : curveOf(v));
// varnished mahogany planking: plank seams along the hull, the grain running with them, a warm orange-brown
const mahoganyTex = (tone = '#a4501f') => canvasTex('mahogany' + tone, 512, 256, (g, w, h) => {
  const r = rnd(9), P = 8, ph = h / P;
  for (let p = 0; p < P; p++) {
    const c = new THREE.Color(tone).offsetHSL(0, 0, (r() - 0.5) * 0.06);
    g.fillStyle = '#' + c.getHexString(); g.fillRect(0, p * ph, w, ph);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(60,20,5,${0.05 + r() * 0.1})`; g.lineWidth = 1 + r(); g.beginPath(); const y = p * ph + r() * ph; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + r() * 6 - 3, w * 0.7, y + r() * 6 - 3, w, y + r() * 4 - 2); g.stroke(); }
    g.fillStyle = 'rgba(30,10,0,0.35)'; g.fillRect(0, p * ph, w, 1.5);
  }
}, 1);

// ================================================================== assemble
function buildDetailed(boat, opts = {}) {
  const C = boat.cls, D = C.model, Lx = linesFor(C);
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const kit = new Kit();
  calibrate(C);
  const Chull = { ...C, hull: { ...C.hull, color: opts.hullColor ?? C.hull.color } };
  // (a pram's bow is a transom too: close the hull there)
  if (D.bowTransom) for (const off of hullOffsets(C)) inner.add(new THREE.Mesh(bowTransomGeom(C, Lx, off), M.hull(C)));
  const bx = (t) => lerp(C.sternX, C.bowX, t), tAt = (x) => clamp((x - C.sternX) / (C.bowX - C.sternX), 0, 1);
  // ---- hull
  let stations, hull;
  for (const off of hullOffsets(C)) {
    const r = hullGeometry(Chull, Lx, off);
    stations = r.stations;
    let hm = M.hull(C);
    if (C.hull.wood) {
      // a varnished wooden hull (a Dragon's mahogany): planks along the hull, the grain under the varnish; the
      // antifouling, boot top and cove line are still drawn by the hull shader over it
      const p = r.geom.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[2 * i] = -p.getZ(i) * 0.3; uv[2 * i + 1] = p.getY(i) * 1.9; }
      r.geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      if (!hm.map) { hm.map = mahoganyTex(C.hull.wood); hm.roughness = 0.18; hm.needsUpdate = true; }
    }
    hull = new THREE.Mesh(r.geom, hm); hull.castShadow = true; hull.receiveShadow = true; inner.add(hull);
  }
  // ---- deck, cockpit well
  const ckD = D.cockpit || { t0: 0.1, t1: 0.35, w: 0.55, sole: C.freeboard * 0.5 };
  const ck = { t0: ckD.t0, t1: ckD.t1, w: ckD.w, sole: ckD.sole };
  const deckH0 = deckHeightFn(C, Lx, D.cockpit ? ck : null);
  const houses = (D.cabins || []).map(h => houseShape(C, Lx, deckH0, bx, h));
  const deckH = (x, y) => {
    let z = deckH0(x, y);
    for (const h of houses) { const zr = h.topAt(x, y); if (zr !== null && zr > z) z = zr; }
    return z;
  };
  const deckMat = D.deck === 'teak' ? M.teak() : D.deck === 'paint' ? paint(D.deckColor ?? 0xe8e4d8, 0.7) : nonskid(D.deckTint || '#e9e6dc');
  const deck = new THREE.Mesh(deckGeometry(C, Lx, stations, D.cockpit ? ck : null), deckMat);
  deck.receiveShadow = true; deck.castShadow = true; inner.add(deck);
  const sheerPts = (side, dz = 0.02) => stations.map(st => { const [x, y, z] = st[0]; return V(x, side * y, z + dz); });
  // ---- toerail / bulwark
  const tr = D.toerail ?? 'alu';
  if (tr && typeof tr === 'object' && tr.bulwark) {
    for (const side of [-1, 1]) {
      const pts = stations.map(st => st[0]);
      const g = ribbon(pts.map(([x, y, z]) => [x, side * y * 0.995, z - 0.01]), pts.map(([x, y, z]) => [x, side * y * 0.985, z + tr.bulwark]));
      kit.add(paint(tr.color ?? C.hull.color, 0.4), g);
      const cap = pts.filter((p, i) => i % 2 === 0).map(([x, y, z]) => V(x, side * y * 0.985, z + tr.bulwark + 0.012));
      kit.add(tr.cap === 'teak' ? M.varnish() : paint(tr.capColor ?? 0x2a2a2a, 0.5), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cap), 80, 0.025, 5));
    }
  } else if (tr !== 'none') for (const side of [-1, 1]) {
    const pts = sheerPts(side).filter((p, i) => i % 2 === 0);
    kit.add(tr === 'teak' ? M.teak() : M.alu(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, tr === 'teak' ? 0.022 : 0.014, 5));
  }
  // rubbing strake / cove line in the hull colour scheme
  if (C.hull.rubrail) for (const side of [-1, 1]) {
    const pts = stations.filter((s, i) => i % 2 === 0).map(st => { const [x, y, z] = st[0]; return V(x, side * (y + 0.012), z - 0.03); });
    kit.add(paint(C.hull.rubrail, 0.5), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.018, 5));
  }
  // ---- hull windows (a modern cruiser's long windows in the topsides)
  for (const w of D.hullWindows || []) for (const side of [-1, 1]) {
    const N = 10, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      // (rect: square-cornered, a modern cruiser's; else a rounded slot)
      const t = lerp(w.t0, w.t1, i / N), x = bx(t), k = w.rect ? Math.min(1, 0.55 + 3 * Math.sin(Math.PI * i / N)) : Math.sin(Math.PI * i / N) ** 0.35;
      const zm = (w.z0 + w.z1) / 2, hh = (w.z1 - w.z0) / 2 * k;
      for (const z of [zm - hh, zm + hh]) { const y = hullHalfBreadth(Lx, t, z) + 0.006; pos.push(side * y, z, -x); }
    }
    for (let i = 0; i < N; i++) { const a = 2 * i; side > 0 ? idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    kit.add(glassT(), g);
  }
  // ---- the boat's name (the player's or the fleet's, js/boatid.js; the famous boats' own by default): on the
  // transom, or painted on both quarters / bows where the stern is pointed or the boat carries it there (hullName)
  const bname = opts.name || (D.hullName && D.hullName.text) || '';
  if (bname && D.nameAt !== false && !D.hullName) {
    const st = stations[0], [xt, , zt] = st[0];
    let xb = xt, zb = 0.12;
    for (let k = 1; k < st.length; k++) { const [xa, , za] = st[k - 1], [xc, , zc] = st[k]; if (za >= 0.12 && zc < 0.12) { xb = xa + (xc - xa) * (za - 0.12) / (za - zc); break; } }
    const tilt = Math.atan2(xb - xt, zt - zb), f = 0.6, xm = xb + (xt - xb) * f, zmid = zb + (zt - zb) * f, w = Math.min(1.6, Lx.bDeck(0) * 1.5);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: transomDecal(C, bname, ''), transparent: true, roughness: 0.4 }));
    dec.position.set(D.nameY ?? 0, zmid + Math.sin(tilt) * 0.012, -xm + Math.cos(tilt) * 0.012); dec.rotation.x = tilt;
    inner.add(dec);
  }
  if (D.hullName && bname) {
    const N = D.hullName, tex = canvasTex(`hullname-${C.id}-${bname}`, 512, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = N.color ?? '#1d2a44'; g.textAlign = 'center';
      let font = N.font ?? 'italic 700 78px Georgia, "Times New Roman", serif'; g.font = font;
      const wd = g.measureText(bname).width; if (wd > w * 0.94) g.font = font.replace(/(\d+)px/, (m, px) => `${Math.floor(px * w * 0.94 / wd)}px`);
      g.fillText(bname, w / 2, 92);
    });
    // (painted on: a strip that follows the topsides, which curve in toward a bow or a canoe stern within the name's
    // length — a flat board there sank its forward letters into the hull)
    const x0 = bx(N.t), len = N.len ?? 1.2, hh = len / 8, S = 16, mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 });
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= S; i++) {
        const f = i / S, x = x0 + (f - 0.5) * len, t = tAt(x);
        for (const [j, z] of [[0, N.z - hh], [1, N.z + hh]]) { pos.push(side * (hullHalfBreadth(Lx, t, z) + 0.01), z, -x); uv.push(side > 0 ? f : 1 - f, j); }
      }
      for (let i = 0; i < S; i++) { const a = 2 * i; side > 0 ? idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); inner.add(new THREE.Mesh(g, mat));
    }
  }
  // ---- portlights in the topsides (bronze, in a classic's bulwark band)
  for (const hp of D.hullPorts || []) for (let k = 0; k < hp.n; k++) {
    const t = lerp(hp.t0, hp.t1, hp.n > 1 ? k / (hp.n - 1) : 0.5), x = bx(t), r = hp.r ?? 0.06;
    for (const s of [-1, 1]) {
      const y = hullHalfBreadth(Lx, t, hp.z) + 0.004;
      const ring = new THREE.TorusGeometry(r, r * 0.22, 8, 18); ring.rotateY(Math.PI / 2); ring.translate(s * y, hp.z, -x); kit.add(hp.mat === 'steel' ? M.steel() : M.bronze(), ring);
      const gl = new THREE.CircleGeometry(r * 0.9, 16); gl.rotateY(s * Math.PI / 2); gl.translate(s * (y + 0.002), hp.z, -x); kit.add(M.glass(), gl);
    }
  }
  // ---- a band along the hull at a height (a modern hull's chine line, a painted sheer strake)
  for (const cb of D.bands || []) for (const side of [-1, 1]) {
    const N = 24, A = [], Bb = [];
    for (let i = 0; i <= N; i++) { const t = lerp(cb.t0, cb.t1, i / N), x = bx(t), e = Math.min(1, 4 * Math.sin(Math.PI * i / N)) * (cb.taper === false ? 1 : 1);
      A.push([x, side * (hullHalfBreadth(Lx, t, cb.z0) + 0.004), cb.z0]); Bb.push([x, side * (hullHalfBreadth(Lx, t, cb.z0 + (cb.z1 - cb.z0) * e) + 0.004), cb.z0 + (cb.z1 - cb.z0) * e]); }
    kit.add(paint(cb.color, cb.rough ?? 0.4), side > 0 ? ribbon(A, Bb) : ribbon(Bb, A));
  }
  // ---- cockpit
  if (D.cockpit) buildCockpit(kit, C, D, Lx, ck, ckD, deckH0, bx);
  // ---- cabins / houses
  houses.forEach((h, i) => buildHouse(kit, C, D.cabins[i], h, deckH0, bx));
  // ---- lifelines, pulpit, pushpit
  if (D.lifelines) buildLifelines(kit, C, Lx, D.lifelines, deckH, bx);
  // ---- mooring cleats, chainplates, nav lights
  const cleatM = D.bronze ? M.bronze() : M.alu();
  const cleat = (x, y) => { const z = deckH(x, y); kit.box(cleatM, 0.035, 0.03, 0.16 * (D.cleatScale ?? 1), V(x, y, z + 0.035)); kit.box(cleatM, 0.03, 0.035, 0.04, V(x, y, z + 0.015)); };
  if (D.cleats !== false) { cleat(C.bowX - (D.bowCleatX ?? 0.35), 0); for (const s of [-1, 1]) cleat(C.sternX + 0.3, s * Lx.bDeck(0.05) * 0.8); }
  // chainplates: per mast, at the shrouds' feet (each rig's spreaders set where)
  const chains = {};
  for (const mk of mastKeys(boat)) {
    const R = mastSpec(C, D, mk), cx = R.x - (R.chainAft ?? 0.1), list = [];
    chains[mk] = list;
    if (R.shrouds === false) { for (const s of [-1, 1]) list.push([cx, s * Lx.bDeck(tAt(cx)) * 0.9, deckH0(cx, 0)]); continue; }
    for (const s of [-1, 1]) {
      const y = s * Lx.bDeck(tAt(cx)) * (R.chainIn ?? 0.95), z = deckH0(cx, y);
      list.push([cx, y, z]); kit.box(M.steel(), 0.02, 0.07, 0.05, V(cx, y, z + 0.025));
    }
    chains[mk] = list;
  }
  if (D.navLights !== false) {
    const nx = C.bowX - 0.3, ny = Lx.bDeck(tAt(nx)) * 0.8;
    kit.box(M.red(), 0.05, 0.04, 0.07, V(nx, -ny, deckH(nx, -ny) + 0.05));
    kit.box(M.green(), 0.05, 0.04, 0.07, V(nx, ny, deckH(nx, ny) + 0.05));
  }
  // ---- bowsprit, bumpkin
  let sprit = null;
  if (D.bowsprit) {
    const B = D.bowsprit, z = Lx.sheer(1) + (B.dz ?? 0.06), x0 = C.bowX - (B.inboard ?? 0.7), x1 = C.bowX + B.len;
    if (B.kind === 'retract') {
      const L = C.bowsprit + 0.8, g = new THREE.CylinderGeometry(0.03, 0.04, L, 10); g.rotateX(Math.PI / 2); g.translate(0, 0, -L / 2);
      sprit = new THREE.Mesh(g, M.carbon()); sprit.castShadow = true; sprit.userData.len = L;
      sprit.position.copy(V(C.bowX + 0.05 - L, 0, Lx.sheer(1) - 0.05)); inner.add(sprit);
    } else {
      if (B.kind === 'plank') { kit.box(B.mat === 'teak' ? M.teak() : wood(), B.w ?? 0.3, 0.07, x1 - x0, V((x0 + x1) / 2, 0, z)); }
      else kit.rod(B.mat === 'wood' ? wood() : M.steel(), V(x0, 0, z), V(x1, 0, z + (B.steeve ?? 0.08)), B.r ?? 0.05, 12, (B.r ?? 0.05) * 0.8);
      const tip = V(x1 - 0.03, 0, z + (B.kind === 'plank' ? 0 : B.steeve ?? 0.08));
      if (B.bobstay !== false) kit.rod(M.steel(), tip, V(C.bowX + (B.bobX ?? 0.02), 0, B.bobZ ?? 0.1), 0.007);
      for (const s of [-1, 1]) kit.rod(M.steel(), tip, V(C.bowX - 0.3, s * Lx.bDeck(tAt(C.bowX - 0.3)) * 0.97, Lx.sheer(tAt(C.bowX - 0.3))), 0.005);
      if (B.pulpit) {
        const zb = z + 0.62, xb = x1 - 0.1;
        const hoop = [V(C.bowX - 0.4, -Lx.bDeck(tAt(C.bowX - 0.4)) * 0.85, deckH(C.bowX - 0.4, 0) + 0.62), V(xb - 0.3, -(B.w ?? 0.3) * 0.7, zb), V(xb, 0, zb + 0.02), V(xb - 0.3, (B.w ?? 0.3) * 0.7, zb), V(C.bowX - 0.4, Lx.bDeck(tAt(C.bowX - 0.4)) * 0.85, deckH(C.bowX - 0.4, 0) + 0.62)];
        kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hoop), 30, 0.014, 6));
        for (const s of [-1, 1]) kit.rod(M.steel(), V(xb - 0.3, s * (B.w ?? 0.3) * 0.7, z + 0.03), V(xb - 0.3, s * (B.w ?? 0.3) * 0.7, zb), 0.014);
        kit.rod(M.steel(), V(xb, 0, z + 0.03), V(xb, 0, zb), 0.014);
      }
      if (B.anchor) { const ax = C.bowX + 0.12, az = z + 0.05; kit.box(M.steel(), 0.03, 0.03, 0.55, V(ax, 0.07, az), 0, 0.15); kit.box(M.steel(), 0.28, 0.03, 0.12, V(ax + 0.28, 0.07, az - 0.04), 0, 0.3); }
    }
  }
  if (D.bumpkin) {
    const Bk = D.bumpkin, z = Lx.sheer(0) + (Bk.dz ?? 0.05), x0 = C.sternX + (Bk.inboard ?? 0.4), x1 = C.sternX - Bk.len;
    kit.rod(Bk.mat === 'wood' ? wood() : M.steel(), V(x0, 0, z), V(x1, 0, z - 0.02), Bk.r ?? 0.035, 10);
    for (const s of [-1, 1]) kit.rod(M.steel(), V(x1 + 0.03, 0, z - 0.02), V(C.sternX + 0.15, s * Lx.bDeck(0.04) * 0.9, Lx.sheer(0.03) - 0.02), 0.005);
    kit.rod(M.steel(), V(x1 + 0.03, 0, z - 0.03), V(C.sternX + 0.02, 0, 0.3), 0.005);
  }
  // ---- keel / board
  const K = C.keel, KD = D.keel || { kind: K.long ? 'full' : K.board ? 'dagger' : 'fin' };
  let keelMesh = null, boardPivot = null;
  if (KD.kind === 'fin') {
    // (from inside the canoe body down to the published draft, the bulb's bottom at the draft)
    const top = Lx.keelZ(tAt(K.x)) + 0.05, span = top + C.draft - (KD.bulb ? 1.6 * (KD.bulb.r ?? 0.12) : 0);
    const kg = foilGeom(KD.chord ?? K.chord, span, KD.thick ?? 0.12, KD.taper ?? 0.7, KD.sweep ?? 0.15);
    keelMesh = new THREE.Mesh(kg, KD.mat === 'lead' ? M.lead() : paint(KD.color ?? C.hull.boot, 0.8));
    keelMesh.position.copy(V(K.x + (KD.chord ?? K.chord) * 0.4, 0, top)); keelMesh.castShadow = true; inner.add(keelMesh);
    if (KD.bulb) {
      const b = KD.bulb, L = b.len, r = b.r;
      const bulb = new THREE.Mesh(lathe([[0, 0], [r * 0.5, L * 0.06], [r * 0.9, L * 0.2], [r, L * 0.42], [r * 0.9, L * 0.7], [r * 0.5, L * 0.92], [0, L]], 18), keelMesh.material);
      bulb.rotation.x = Math.PI / 2; bulb.scale.set(b.flat ?? 1, 1, 1);
      bulb.position.set(0, -span + r * 0.8, -L * (b.fwd ?? 0.25)); bulb.castShadow = true; keelMesh.add(bulb);
    }
    keelMesh = null;                                  // (a fixed fin: nothing for the game to move)
  } else if (KD.kind === 'swing' || KD.kind === 'centreboard') {
    // a plate pivoting down out of its trunk (the swing keel's cast iron plate, a centreboard): turned by the board control
    boardPivot = new THREE.Group();
    const px = KD.pivotX ?? K.x + K.chord * 0.5, pz = Lx.keelZ(tAt(px)) + 0.02;
    boardPivot.position.copy(V(px, 0, pz));
    const shp = new THREE.Shape(), L = KD.len, Wd = KD.width;
    // plate shape: the pivot at its forward top corner, the plate hanging aft and down
    shp.moveTo(0, 0); shp.lineTo(-Wd * 0.25, -L * 0.15); shp.quadraticCurveTo(-Wd * 0.55, -L * 0.95, -Wd * 0.2, -L); shp.lineTo(Wd * 0.5, -L * 0.9); shp.quadraticCurveTo(Wd * 0.85, -L * 0.3, Wd * 0.7, -0.02); shp.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(shp, { depth: KD.thick ?? 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1 });
    g.translate(0, 0, -(KD.thick ?? 0.03) / 2); g.rotateY(-Math.PI / 2);       // plate in the boat's centre plane, aft = +z
    g.translate(0, 0, Wd * 0.2);
    const plate = new THREE.Mesh(g, KD.kind === 'swing' ? paint(0x2b2b2e, 0.7, 0.3) : paint(KD.color ?? 0xf2f2ee, 0.4));
    plate.castShadow = true; boardPivot.add(plate); boardPivot.userData = { up: KD.upAngle ?? -1.35, down: KD.downAngle ?? 0 };
    inner.add(boardPivot);
    // trunk top in the cockpit / cabin (a centreboard's case)
    if (KD.trunk) kit.box(paint(KD.trunkColor ?? 0xeeeae0, 0.5), 0.1, KD.trunk.h, KD.trunk.len, V(px - KD.trunk.len * 0.45, 0, ck.sole + KD.trunk.h / 2));
  } else if (KD.kind === 'dagger') {
    const kg = foilGeom(K.chord, K.span + 0.35, 0.1, 0.95, 0);
    keelMesh = new THREE.Mesh(kg, paint(KD.color ?? 0xf2f2ee, 0.35));
    keelMesh.position.copy(V(K.x + K.chord * 0.35, 0, -C.canoeDraft + 0.41)); keelMesh.castShadow = true; inner.add(keelMesh);
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, K.chord * 0.8), M.black()); hnd.position.set(0, 0.03, K.chord * 0.4); keelMesh.add(hnd);
  }
  // ---- rudder, tiller / wheel
  const Rd = C.rudder, RD = D.rudder || { kind: Rd.transom ? 'transom' : 'spade' };
  const rudderPivot = new THREE.Group();
  let tillerEnd = new THREE.Vector3(), extension = null;
  const ST = D.steering || { kind: 'tiller' };
  let stockTop;
  if (RD.kind === 'transom') {
    // hung on the transom (or the sternpost of a double-ender) on gudgeons and pintles
    const tx = RD.x ?? C.sternX + (RD.dx ?? 0);
    const topZ = RD.top ?? Lx.sheer(0) + 0.08, botZ = RD.bottom ?? -(C.draft - 0.05);
    rudderPivot.position.copy(V(tx, 0, 0));
    const sh = new THREE.Shape(), ch = Rd.chord, ch0 = RD.chordTop ?? ch * 0.55, lean = RD.lean ?? 0;
    sh.moveTo(0, topZ); sh.lineTo(-lean, botZ + 0.12); sh.quadraticCurveTo(-lean, botZ, -lean + 0.12, botZ);
    sh.lineTo(-lean + ch * 0.9, botZ + 0.04); sh.quadraticCurveTo(-lean + ch * 1.05, botZ + 0.1, ch, botZ + (RD.heel ?? 0.35));
    sh.lineTo(ch0, topZ - 0.25); sh.lineTo(ch0 * 0.6, topZ);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: RD.thick ?? 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
    bg.translate(0, 0, -(RD.thick ?? 0.04) / 2); bg.rotateY(-Math.PI / 2);
    const blade = new THREE.Mesh(bg, RD.mat === 'wood' ? M.varnish() : RD.mat === 'hull' ? M.hull(C) : paint(RD.color ?? 0xf2f2ee, 0.4)); blade.castShadow = true; rudderPivot.add(blade);
    if (RD.mat === 'hull') blade.material = paint(C.hull.color, 0.35);
    for (const z of RD.pintles ?? [0.1, topZ - 0.3]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 8), D.bronze ? M.bronze() : M.steel()); pin.position.set(0, z, 0.005); rudderPivot.add(pin); }
    stockTop = topZ;
  } else {
    // a spade, skeg-hung or keel-hung blade under the counter, its stock up through the hull
    const x = Rd.x + Rd.chord * 0.25, top = Lx.keelZ(tAt(Rd.x)) + (RD.gap ?? 0.02);
    rudderPivot.position.copy(V(x, 0, 0));
    const span = RD.span ?? Rd.span;
    const blade = new THREE.Mesh(foilGeom(Rd.chord * (RD.rootK ?? 1), span, RD.thick ?? 0.12, RD.taper ?? 0.72, RD.sweep ?? 0.08), paint(RD.color ?? C.hull.boot, 0.7));
    blade.position.set(0, top, -Rd.chord * 0.25 * (RD.rootK ?? 1)); blade.castShadow = true; rudderPivot.add(blade);
    stockTop = (RD.stockTop ?? (ST.kind === 'tiller' ? deckH0(x, 0) + 0.12 : ck.sole));
    const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stockTop - top, 10), M.steel()); stock.position.set(0, (stockTop + top) / 2, 0); rudderPivot.add(stock);
    if (RD.kind === 'skeg') {
      // the skeg: a fixed fin ahead of the blade, carrying its lower bearing
      const sg = foilGeom(RD.skegChord ?? Rd.chord * 0.6, span * 0.95, 0.12, 0.6, 0.35);
      const skeg = new THREE.Mesh(sg, paint(C.hull.boot, 0.8)); skeg.position.copy(V(x + (RD.skegChord ?? Rd.chord * 0.6) * 1.02, 0, top + 0.05)); skeg.castShadow = true; inner.add(skeg);
    }
  }
  if (ST.kind === 'tiller') {
    const tLen = ST.len ?? 1.1, z0 = stockTop + (ST.dz ?? 0.02);
    const tpts = [new THREE.Vector3(0, z0, RD.kind === 'transom' ? 0.05 : 0), new THREE.Vector3(0, z0 + 0.08, -tLen * 0.3), new THREE.Vector3(0, z0 + (ST.rise ?? 0.14), -tLen)];
    const tiller = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tpts), 16, ST.r ?? 0.024, 8), ST.mat === 'alu' ? M.alu() : ST.mat === 'black' ? M.black() : M.varnish());
    tiller.castShadow = true; rudderPivot.add(tiller); tillerEnd.copy(tpts[2]);
    if (ST.extension) {
      const L = ST.extension, g = new THREE.CylinderGeometry(0.012, 0.012, L, 8); g.translate(0, L / 2, 0); g.rotateX(-Math.PI / 2 + 0.08);
      extension = new THREE.Mesh(g, M.black()); extension.castShadow = true; extension.position.copy(tillerEnd); rudderPivot.add(extension); extension.userData.len = L;
    }
  }
  inner.add(rudderPivot);
  const wheels = [];
  if (ST.kind === 'wheel' || ST.kind === 'twin') {
    const ys = ST.kind === 'twin' ? [-ST.y, ST.y] : [0];
    for (const y of ys) {
      const wx = ST.x, base = ck.sole, hub = base + (ST.hub ?? 0.85), r = ST.r ?? 0.45;
      if (ST.kind === 'wheel') {
        kit.add(M.steel(), lathe([[0.1, 0], [0.09, 0.05], [0.07, 0.12], [0.06, hub - base - 0.1], [0.075, hub - base], [0, hub - base + 0.02]], 14), new THREE.Matrix4().makeTranslation(0, base, -wx));
        kit.box(M.black(), 0.16, 0.12, 0.06, V(wx + 0.06, 0, hub + 0.06), 0, -0.4);     // compass / instrument binnacle
      } else kit.rod(M.steel(), V(wx + 0.05, y, deckH0(wx + 0.05, y) - 0.02), V(wx + 0.05, y, hub), 0.035, 12, 0.03);
      const w = new THREE.Group(); w.position.copy(V(wx, y, hub));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 40), M.steel()); w.add(rim);
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, r * 2, 6), M.steel()); sp.rotation.z = i * Math.PI / 6; w.add(sp); }
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12), M.steel()); hb.rotation.x = Math.PI / 2; w.add(hb);
      w.traverse(o => { if (o.isMesh) o.castShadow = true; });
      inner.add(w); wheels.push(w);
    }
    // the grab point for the helm: the top of the (first) wheel's rim, in the rudder pivot's frame
    tillerEnd = rudderPivot.worldToLocal(inner.localToWorld(V(ST.x, ys[0], ck.sole + (ST.hub ?? 0.85) + (ST.r ?? 0.45))));
  }
  // ---- outboard on its bracket
  if (D.outboard) buildOutboard(kit, inner, C, Lx, D.outboard);
  // ---- spars and standing rigging
  const rig = new THREE.Group(); inner.add(rig);
  const rigKit = new Kit();
  const S = boat.sailBy;
  const mastBase = deckH(C.mastX, 0) + 0.02;
  const stay = {};
  for (const mk of mastKeys(boat)) {
    const R = mastSpec(C, D, mk), x = R.x, base = deckH(x, 0) + 0.02, top = R.h, len = top - base;
    const mm = spar(R.mat), r0 = R.r;
    const m = new THREE.Mesh(lathe([[r0, 0], [r0, len * 0.55], [r0 * 0.92, len * 0.8], [R.rTop ?? r0 * 0.6, len], [0, len + 0.01]], 14), mm);
    m.scale.set(1, 1, R.round ? 1 : 1.25); m.position.copy(V(x, 0, base)); m.castShadow = true; rig.add(m);
    if (!R.round) rigKit.box(M.black(), 0.012, len * 0.92, 0.012, V(x - r0 * 1.2, 0, base + len * 0.48)); // luff track
    rigKit.box(mm, 0.06, 0.04, 0.14, V(x - 0.03, 0, top + 0.01));                                     // masthead
    if (R.mastCollar !== false) rigKit.add(mm, new THREE.CylinderGeometry(r0 * 1.5, r0 * 1.7, 0.06, 14), new THREE.Matrix4().makeTranslation(0, base + 0.02, -x));
    const sails = boat.sails.filter(s => s.kind === 'boom' && (mk === 'main' ? s.key === 'main' : s.key === mk));
    for (const s of sails) rigKit.box(M.black(), 0.08, 0.06, 0.08, V(x - 0.08, 0, s.key === 'main' ? C.boomZ : s.tackZ)); // gooseneck
    // spreaders, shrouds, lowers
    const ch = chains[mk];
    const hounds = R.hounds ?? top - 0.2;
    let prevTips = null;
    const sprs = R.spreaders || [];
    sprs.forEach((sp, i) => {
      const z = base + sp.f * len, sw = sp.sweep ?? 0;
      const tips = [-1, 1].map(s => V(x - sp.len * Math.sin(sw), s * sp.len * Math.cos(sw), z + 0.03));
      for (const s of [0, 1]) rigKit.rod(R.mat === 'wood' ? mm : M.alu(), V(x, (s ? 1 : -1) * 0.03, z), tips[s], 0.016, 6, 0.01);
      prevTips = prevTips || null;
      sp._tips = tips; sp._z = z;
    });
    for (let s = 0; s < 2 && R.shrouds !== false; s++) {
      const [cx, cy, cz] = ch[s], foot = V(cx, cy, cz + 0.05);
      // cap shroud over every spreader tip to the hounds; lowers from the chainplate to the lowest spreader root
      let pts = [foot, ...sprs.map(sp => sp._tips[s]), V(x, (s ? 1 : -1) * 0.02, hounds)];
      for (let k = 0; k < pts.length - 1; k++) rigKit.rod(M.wire(), pts[k], pts[k + 1], R.wire ?? 0.0035);
      if (sprs.length && R.lowers !== false) for (const dx of R.lowerX ?? [0.3, -0.3]) rigKit.rod(M.wire(), V(cx + dx, cy * 0.97, cz + 0.05), V(x, (s ? 1 : -1) * 0.03, sprs[0]._z), 0.003);
      if (sprs.length > 1) for (let k = 1; k < sprs.length; k++) rigKit.rod(M.wire(), sprs[k - 1]._tips[s], V(x, (s ? 1 : -1) * 0.03, sprs[k]._z), 0.003); // intermediates
      if (R.ratlines) for (let z = cz + 0.5; z < (sprs.length ? sprs[0]._z : hounds) - 0.4; z += 0.38) {
        const a = pts[0], b = pts[1], f = (z - a.y) / (b.y - a.y);
        const p1 = a.clone().lerp(b, f);
        const a2 = V(cx - 0.35, cy * 0.97, cz + 0.05), b2 = V(x, (s ? 1 : -1) * 0.03, sprs.length ? sprs[0]._z : hounds), f2 = (z - a2.y) / (b2.y - a2.y);
        rigKit.rod(M.black(), p1, a2.clone().lerp(b2, f2), 0.006);
      }
    }
    if (R.deadeyes) for (let s = 0; s < 2; s++) { const [cx, cy, cz] = ch[s]; for (const dx of [0, -0.35]) rigKit.add(M.black(), new THREE.SphereGeometry(0.045, 10, 8), new THREE.Matrix4().makeTranslation(cy * 0.99, cz + 0.35, -(cx + dx))); }
    if (R.crosstrees) { const z = base + R.crosstrees.f * len; rigKit.rod(mm, V(x, -R.crosstrees.len, z), V(x, R.crosstrees.len, z), 0.025); }
    if (mk === 'main') { stay.mastTop = top; }
    else rigKit.rod(M.wire(), V(x, 0, R.h - 0.1), V(R.stayTo ?? C.sternX + 0.1, 0, R.stayToZ ?? Lx.sheer(0) + 0.1), 0.003); // mizzen backstay / triatic
    if (mk !== 'main' && R.triatic) rigKit.rod(M.wire(), V(x + 0.03, 0, R.h - 0.05), V(C.mastX - 0.03, 0, R.triatic), 0.003);
  }
  // headstays: each headsail's stay (the sail's luff), from its tack to the mast
  for (const s of boat.sails) {
    if (s.kind !== 'loose' && !(s.kind === 'boom' && s.key !== 'main' && !s.mast)) continue;
    rigKit.rod(M.wire(), V(s.tackX, 0, s.tackZ - 0.03), V(s.tackX - s.rake, 0, s.tackZ + s.luff + 0.08), 0.004);
  }
  if (D.forestay) rigKit.rod(M.wire(), V(D.forestay.x, 0, D.forestay.z), V(C.mastX + 0.03, 0, D.forestay.top), 0.004);
  // backstay (split near the transom), or runners' pendants
  if ((C.hasBackstay || D.backstay) && D.backstay !== false) {
    const bs = D.backstay || {};
    stay.backstayTop = V(C.mastX - 0.05, 0, bs.top ?? C.mastHeight);
    const bsX = bs.x ?? C.sternX + 0.05, lowZ = bs.z ?? Lx.sheer(0.02);
    if (bs.split !== false) {
      stay.backstayLow = V(bsX + (bs.splitDx ?? 0.25), 0, lowZ + (bs.splitH ?? 0.9));
      rigKit.rod(M.wire(), stay.backstayTop, stay.backstayLow, 0.0035);
      for (const s of [-1, 1]) rigKit.rod(M.wire(), stay.backstayLow, V(bsX + 0.02, s * Lx.bDeck(0.02) * 0.6, lowZ), 0.003);
    } else { stay.backstayLow = V(bsX, 0, lowZ + 0.15); rigKit.rod(M.wire(), stay.backstayTop, V(bsX, 0, lowZ), 0.0035); }
  }
  if (!stay.backstayLow) stay.backstayLow = V(C.sternX + 0.3, 0, Lx.sheer(0.02) + 0.15);
  if (D.runners) for (const s of [-1, 1]) rigKit.rod(M.wire(), V(C.mastX - 0.03, s * 0.02, D.runners.z), V(D.runners.x, s * Lx.bDeck(tAt(D.runners.x)) * 0.9, Lx.sheer(tAt(D.runners.x)) + 0.05), 0.0025);
  rigKit.build(rig);
  // windex on the main masthead
  const windex = new THREE.Group(); windex.position.copy(V(C.mastX, 0, C.mastHeight + 0.14));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 6), M.black()); arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.2; windex.add(arrow);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.1, 0.16), M.red()); vane.position.z = 0.14; windex.add(vane);
  if (D.windex !== false) rig.add(windex);
  // ---- booms
  const booms = {};
  for (const s of boat.sails) {
    if (s.kind !== 'boom') continue;
    const isMain = s.key === 'main', R = s.mast ? mastSpec(C, D, s.key) : isMain ? mastSpec(C, D, 'main') : null;
    const piv = new THREE.Group();
    const px = isMain ? C.mastX - 0.06 : s.mast ? s.tackX - 0.06 : s.tackX, pz = isMain ? C.boomZ : s.tackZ + 0.02;
    piv.position.copy(V(px, 0, pz));
    const fwd = s.rig === 'lateen' ? s.tackFwd + 0.1 : 0, L = s.foot + 0.08 - (s.rig === 'lateen' ? s.tackFwd : 0);
    const br = s.boomR ?? (C.loa > 8 ? 0.055 : C.loa > 5 ? 0.045 : 0.03);
    const bgm = lathe([[br * 0.8, 0], [br, (L + fwd) * 0.4], [br * 0.9, (L + fwd) * 0.85], [br * 0.7, L + fwd], [0, L + fwd]], 10);
    bgm.rotateX(Math.PI / 2); bgm.scale(1, s.boomRound ? 1 : 1.3, 1); bgm.translate(0, 0, -fwd);
    const bm = s.boomMat ?? R?.mat ?? 'alu';
    const boomMesh = new THREE.Mesh(bgm, spar(bm)); boomMesh.position.y = -0.05; boomMesh.castShadow = true; piv.add(boomMesh);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.07), M.black()); cap.position.set(0, -0.05, L); piv.add(cap);
    if (isMain && s.reefs && !s.furling) {
      const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, L * 0.8, 4, 10), new THREE.MeshStandardMaterial({ color: (C.sailcloth || {}).cloth ?? 0xf2f0ea, roughness: 0.85 }));
      bundle.rotation.x = Math.PI / 2; bundle.position.set(0, 0.03, L * 0.48); bundle.visible = false; piv.add(bundle); piv.userData.bundle = bundle;
    }
    rig.add(piv); booms[s.key] = piv;
  }
  // gaff, yard, sprit, spinnaker pole: placed each frame from the sail
  const dyn = {};
  const rodMesh = (r, m) => { const g = new THREE.CylinderGeometry(r, r * 0.85, 1, 10); g.translate(0, 0.5, 0); const o = new THREE.Mesh(g, m); o.castShadow = true; rig.add(o); return o; };
  for (const s of boat.sails) {
    if (s.rig === 'gaff') dyn.gaff = { s, mesh: rodMesh(s.gaffR ?? 0.045, spar(s.boomMat ?? mastSpec(C, D, 'main').mat)) };
    if (s.rig === 'lateen') dyn.yard = { s, mesh: rodMesh(s.yardR ?? 0.028, spar(s.boomMat ?? 'alu')), halyard: rodMesh(0.004, paint(0xe8e2d0, 0.8)) };
    if (s.rig === 'sprit') dyn.sprit = { s, mesh: rodMesh(s.spritR ?? 0.018, spar(s.boomMat ?? 'wood')) };
    if (s.kind === 'spin' && s.pole) dyn.pole = { s, mesh: rodMesh(0.025, M.alu()) };
  }
  // ---- sails
  const sailMeshes = {};
  for (const s of boat.sails) { const m = sailMesh(C, s, s.key === 'main' && !D.noNumber ? opts.number : null); rig.add(m); sailMeshes[s.key] = m; }
  const ttg = new THREE.BufferGeometry();
  ttg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3 * 12), 3));
  ttg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2 * 3 * 12), 3));
  const telltales = new THREE.LineSegments(ttg, new THREE.LineBasicMaterial({ vertexColors: true })); telltales.frustumCulled = false; rig.add(telltales);
  // ---- the boat's own pieces
  const ctx = { C, D, Lx, kit, rigKit: null, inner, rig, deckH, deckH0, bx, tAt, ck, houses, stations, boat };
  for (const e of D.extras || []) if (EXTRAS[e]) EXTRAS[e](ctx);
  kit.build(inner);
  if (opts.label) addLabel(root, C, opts.label);
  const chainMain = chains.main;
  const vis = { root, inner, hull, deck, booms, sailMeshes, rudderPivot, rudderPivots: [], keelMesh, telltales, windex, rig, sprit, extension, tillerEnd,
    lines: Lx, deckH, ck, chain: chainMain, stay, mastBase, boardPivot, wheels, dyn, update: updateDetailed };
  return vis;
}
MODEL_HOOKS.build = buildDetailed;

// ------------------------------------------------------------------ per frame: the parts only this builder has
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = [0, 0, 0];
function placeRod(o, A, B, extA = 0, extB = 0) {
  const d = _b.subVectors(B, A), L = d.length(); if (L < 1e-4) { o.visible = false; return; }
  d.multiplyScalar(1 / L); o.visible = true;
  o.position.copy(A).addScaledVector(d, -extA); o.scale.set(1, L + extA + extB, 1);
  o.quaternion.setFromUnitVectors(_up, d);
}
function updateDetailed(vis, b, t) {
  const C = b.cls, dyn = vis.dyn;
  if (vis.boardPivot) { const u = vis.boardPivot.userData; vis.boardPivot.rotation.x = -lerp(u.up, u.down, clamp(b.ctrl.board, 0, 1)); }
  for (const w of vis.wheels) w.rotation.z = -b.rudder * 4;
  const act = b.sailSys && b.sailSys.active(b);
  // a sail's corner (u, v in its chart) in the rig frame: the cloth node where the cloth sails, else the strip shape
  const corner = (s, u, v, out) => {
    const rg = act && b.sailSys.cloth(s.key);
    if (rg) { rg.cloth.sample(rg.cloth.x, u, v, _q); return out.copy(V(_q[0], _q[1], _q[2])); }
    const st = b.diag.strips[s.key], sh = b.diag.shape[s.key], a0 = st.baseAngle ?? 0, a = lerp(a0, sh[2].ang, v);
    const chord = (s.foot * (1 - v) + s.head * v) * u;
    let lx = (s.key === 'main' ? C.mastX - 0.02 : s.tackX) - (s.rake || 0) * v, ly = 0;
    if (s.rig === 'lateen') { const dx = s.tackFwd - (s.rake || 0) * v; lx = C.mastX - 0.02 + dx * Math.cos(a0); ly = -dx * Math.sin(a0); }
    return out.copy(V(lx - Math.cos(a) * chord, ly + Math.sin(a) * chord, (s.key === 'main' ? C.boomZ : s.tackZ) + v * s.luff + (s.headRise || 0) * u * v));
  };
  if (dyn.gaff) { corner(dyn.gaff.s, 0, 1, _a); const B = corner(dyn.gaff.s, 1, 1, new THREE.Vector3()); placeRod(dyn.gaff.mesh, _a, B, 0.12, 0.1); }
  if (dyn.yard) {
    corner(dyn.yard.s, 0, 0, _a); const B = corner(dyn.yard.s, 0, 1, new THREE.Vector3()), H = _a.clone().lerp(B, 0.72);
    placeRod(dyn.yard.mesh, _a, B, 0.08, 0.12);
    placeRod(dyn.yard.halyard, V(C.mastX, 0, C.mastHeight - 0.03), H);           // the halyard: masthead to its ring on the yard
  }
  if (dyn.sprit) { const s = dyn.sprit.s; _a.copy(V(C.mastX + 0.01, 0, C.boomZ + s.snotterZ)); const B = corner(s, 1, 1, new THREE.Vector3()); placeRod(dyn.sprit.mesh, _a, B, 0, 0.04); }
  if (dyn.pole) {
    const s = dyn.pole.s, rg = act && b.sailSys.cloth(s.key), on = b.genDeploy > 0.3;
    dyn.pole.mesh.visible = on && !!(rg && rg.poleEnd);
    if (dyn.pole.mesh.visible) { _a.copy(V(C.mastX + 0.05, 0, rg.poleEnd[2] - 0.05)); placeRod(dyn.pole.mesh, _a, V(rg.poleEnd[0], rg.poleEnd[1], rg.poleEnd[2])); }
  }
}

// ------------------------------------------------------------------ geometry helpers
// a strip between two polylines (physics coords)
function ribbon(A, B) {
  const pos = [], idx = [];
  for (let i = 0; i < A.length; i++) { const a = V(...A[i]), b = V(...B[i]); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  for (let i = 0; i < A.length - 1; i++) { const k = 2 * i; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function bowTransomGeom(C, Lx, off) {
  const sec = Lx.section(1), pos = [], idx = [], shr = [], col = [], c = new THREE.Color(C.hull.color), x = C.bowX + Lx.xShift(1, 1) * 0;
  const zTop = sec[0][1], zBot = sec[sec.length - 1][1];
  for (const [y, z] of sec) { const zn = clamp((z - zBot) / Math.max(0.05, zTop - zBot), 0, 1), xx = C.bowX + (Lx.xShift ? Lx.xShift(1, zn) : 0); pos.push(off + y, z, -xx, off - y, z, -xx); shr.push(zTop, zTop); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  for (let k = 0; k < sec.length - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('sheerZ', new THREE.Float32BufferAttribute(shr, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// hull half-breadth at station t and height z (from the section)
function hullHalfBreadth(Lx, t, z) {
  const sec = Lx.section(t);
  for (let i = 1; i < sec.length; i++) { const [y0, z0] = sec[i - 1], [y1, z1] = sec[i]; if ((z0 - z) * (z1 - z) <= 0 && z0 !== z1) return y0 + (y1 - y0) * (z - z0) / (z1 - z0); }
  return sec[0][0];
}
const mastKeys = (boat) => ['main', ...boat.sails.filter(s => s.mast).map(s => s.key)];
function mastSpec(C, D, key) {
  const M0 = (D.masts || {})[key] || {};
  if (key === 'main') return { x: C.mastX, h: C.mastHeight, r: C.mastR ?? 0.05, mat: 'alu', ...M0 };
  const s = C.sails.find(q => q.key === key);
  return { x: s.tackX, h: s.mast.h, r: s.mast.r ?? 0.04, mat: 'alu', ...M0 };
}

// a cabin trunk / deckhouse: rows of sections along x (side face leaning in by slope, cambered roof), faired down at
// a raked front and back; topAt(x, y): the roof height there (or null off it)
function houseShape(C, Lx, deckH0, bx, h) {
  const hF = fnOf(h.h), wF = fnOf(h.w), N = h.n ?? 24;
  const x0 = bx(h.t0), x1 = bx(h.t1), fr = h.frontRake ?? 0, ar = h.aftRake ?? 0;
  const rise = (x) => Math.min(fr > 0 ? clamp((x1 - x) / fr, 0, 1) : 1, ar > 0 ? clamp((x - x0) / ar, 0, 1) : 1);
  const tOf = (x) => (x - C.sternX) / (C.bowX - C.sternX);
  const ht = (x) => hF(tOf(x)) * Math.sqrt(rise(x)) ** (h.round ? 0.5 : 1);
  const hw = (x) => wF(tOf(x));
  const topAt = (x, y) => {
    if (x < x0 || x > x1) return null;
    const w = hw(x) - (h.slope ?? 0.05); if (Math.abs(y) > w) return null;
    const u = y / w;
    return deckH0(x, 0) + ht(x) + (h.camber ?? 0.05) * (1 - u * u);
  };
  return { x0, x1, ht, hw, topAt, N };
}
function buildHouse(kit, C, h, shape, deckH0, bx) {
  const { x0, x1, ht, hw, N } = shape, slope = h.slope ?? 0.05, cam = h.camber ?? 0.05;
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const x = lerp(x0, x1, i / N), w = Math.max(0.02, hw(x)), zd = deckH0(x, w * 0.98) - 0.02, zr = deckH0(x, 0) + ht(x);
    const ring = [[w, zd], [w - slope * clamp(ht(x) / 0.4, 0, 1), Math.max(zd + 0.005, zr)]];
    const M2 = 10;
    for (let j = 1; j <= M2; j++) { const u = 1 - j / M2; ring.push([(w - slope * clamp(ht(x) / 0.4, 0, 1)) * u, Math.max(zd + 0.005, zr + cam * (1 - u * u) * clamp(ht(x) / 0.1, 0, 1))]); }
    rows.push({ x, ring });
  }
  const pos = [], idx = [], uv = [];
  const R = rows[0].ring.length;
  for (let i = 0; i <= N; i++) for (let side = 0; side < 2; side++) for (let j = 0; j < R; j++) { const [y, z] = rows[i].ring[j]; pos.push(side ? -y : y, z, -rows[i].x); uv.push(y * 1.5, rows[i].x * 1.5); }
  const vid = (i, side, j) => (i * 2 + side) * R + j;
  for (let i = 0; i < N; i++) for (let side = 0; side < 2; side++) for (let j = 0; j < R - 1; j++) {
    const a = vid(i, side, j), b = vid(i + 1, side, j), c = vid(i + 1, side, j + 1), d = vid(i, side, j + 1);
    if (side === 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  for (const [i, flip] of [[0, false], [N, true]]) {                       // end faces
    const base = pos.length / 3, ring = rows[i].ring, cx = rows[i].x;
    pos.push(0, (ring[0][1] + ring[R - 1][1]) / 2, -cx); uv.push(0, 0);
    for (const side of [1, -1]) for (const [y, z] of side > 0 ? ring : ring.slice().reverse()) { pos.push(side * y, z, -cx); uv.push(y, z); }
    const n = R * 2;
    for (let k = 0; k < n - 1; k++) flip ? idx.push(base, base + 2 + k, base + 1 + k) : idx.push(base, base + 1 + k, base + 2 + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  kit.add(h.side === 'wood' ? M.varnish() : h.side === 'teak' ? M.teak() : paint(h.color ?? 0xf2f0ea, h.rough ?? 0.35), g);
  // the roof as its own skin (non-skid / teak / paint), a hair above the side sweep's crown
  if (h.roof && h.roof !== 'same') {
    const rp = [], ri = [], ru = [], M2 = 10;
    for (let i = 0; i <= N; i++) { const ring = rows[i].ring; for (let j = 1; j <= M2; j++) { const [y, z] = ring[1 + j - 1]; for (const s of [1, -1]) { rp.push(s * y * 0.985, z + 0.004, -rows[i].x); ru.push(s * y * 1.5, rows[i].x * 1.5); } } }
    const W = 2 * M2;
    for (let i = 0; i < N; i++) for (let j = 0; j < M2 - 1; j++) for (let s = 0; s < 2; s++) {
      const a = i * W + j * 2 + s, b = (i + 1) * W + j * 2 + s, c = (i + 1) * W + (j + 1) * 2 + s, d = i * W + (j + 1) * 2 + s;
      s === 0 ? ri.push(a, b, d, b, c, d) : ri.push(a, d, b, b, d, c);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); rg.setIndex(ri); rg.computeVertexNormals();
    kit.add(h.roof === 'teak' ? M.teak() : h.roof === 'paint' ? paint(h.roofColor ?? 0xe8e4d8, 0.7) : nonskid(h.roofTint ?? '#e6e3da'), rg);
  }
  // windows / portlights on the sides and front
  const sideAt = (x, f) => { const w = hw(x), H = ht(x), zd = deckH0(x, w), zr = deckH0(x, 0) + H; return { y: w - slope * clamp(H / 0.4, 0, 1) * f, z: lerp(zd, zr, f) }; };
  const lean = Math.atan2(slope, 0.4);
  for (const wdef of h.windows || []) {
    if (wdef.kind === 'port') {
      for (let k = 0; k < wdef.n; k++) {
        const x = lerp(bx(wdef.t0), bx(wdef.t1), wdef.n > 1 ? k / (wdef.n - 1) : 0.5), p = sideAt(x, wdef.zf ?? 0.5), r = wdef.r ?? 0.07;
        for (const s of [-1, 1]) {
          const ring = new THREE.TorusGeometry(r, r * 0.2, 8, 20); ring.rotateY(Math.PI / 2); ring.rotateZ(s * lean); ring.translate(s * (p.y + 0.006), p.z, -x);
          kit.add(wdef.mat === 'bronze' ? M.bronze() : M.steel(), ring);
          const gl = new THREE.CircleGeometry(r * 0.92, 18); gl.rotateY(s * Math.PI / 2); gl.rotateZ(s * lean); gl.translate(s * (p.y + 0.008), p.z, -x);
          kit.add(M.glass(), gl);
        }
      }
    } else if (wdef.kind === 'rect' || wdef.kind === 'slot') {
      // a dark tinted window following the trunk side, rounded ends
      for (const s of [-1, 1]) {
        const NW = 12, pos2 = [], idx2 = [], xa = bx(wdef.t0), xb = bx(wdef.t1);
        for (let i = 0; i <= NW; i++) {
          const x = lerp(xa, xb, i / NW), e = Math.min(1, Math.sin(Math.PI * i / NW) * (wdef.round ?? 3));
          const fm = wdef.zf ?? 0.55, hf = (wdef.hf ?? 0.4) / 2 * e;
          const lo = sideAt(x, fm - hf + (wdef.skew ?? 0) * (i / NW - 0.5)), hi = sideAt(x, fm + hf + (wdef.skew ?? 0) * (i / NW - 0.5));
          pos2.push(s * (lo.y + 0.006), lo.z, -x, s * (hi.y + 0.006), hi.z, -x);
        }
        for (let i = 0; i < NW; i++) { const a = 2 * i; s > 0 ? idx2.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx2.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3)); g2.setIndex(idx2); g2.computeVertexNormals();
        kit.add(glassT(), g2);
      }
    } else if (wdef.kind === 'front') {
      const x = x1 - (h.frontRake ?? 0) * 0.5, H = ht(x1 - (h.frontRake ?? 0.01) * 0.999), w = hw(x) * (wdef.w ?? 0.7);
      const zb = deckH0(x, 0) + H * 0.3, ang = Math.atan2(h.frontRake ?? 0.01, H || 0.1);
      for (let k = 0; k < (wdef.n ?? 1); k++) {
        const n = wdef.n ?? 1, yw = w * 2 / n, yc = -w + yw * (k + 0.5);
        const gp = new THREE.PlaneGeometry(yw * 0.85, H * 0.45); gp.rotateX(-ang); gp.translate(yc, zb + H * 0.18, -(x + 0.01));
        kit.add(glassT(), gp);
      }
    }
  }
  const trimM = h.trim === 'teak' ? M.varnish() : h.trim === 'steel' ? M.steel() : null;
  // handrails along the roof
  if (h.handrails) {
    const xa = x0 + (x1 - x0) * 0.12, xf = x1 - (x1 - x0) * 0.18, xm = (xa + xf) / 2;
    for (const s of [-1, 1]) {
      const y = s * (hw(xm) - slope - 0.1), z = deckH0(xm, 0) + ht(xm) + cam * (1 - (y / hw(xm)) ** 2);
      kit.box(trimM || M.varnish(), 0.03, 0.03, xf - xa, V(xm, y, z + 0.05));
      for (let k = 0; k < 4; k++) kit.box(trimM || M.varnish(), 0.028, 0.05, 0.03, V(lerp(xa, xf, (k + 0.5) / 4), y, z + 0.02));
    }
  }
  // hatches on the roof: [{ t, w, l, kind: 'hatch' | 'slide' }]
  for (const hc of h.hatches || []) {
    const x = bx(hc.t), z = deckH0(x, 0) + ht(x) + cam;
    if (hc.kind === 'slide') {
      kit.box(paint(h.color ?? 0xf2f0ea, 0.4), hc.w, 0.05, hc.l, V(x, 0, z + 0.03));
      for (const s of [-1, 1]) kit.box(trimM || M.varnish(), 0.03, 0.06, hc.l + 0.3, V(x - 0.15, s * (hc.w / 2 + 0.02), z + 0.02));
    } else {
      kit.box(M.alu(), hc.w, 0.04, hc.l, V(x, 0, z + 0.015));
      kit.box(glassT(), hc.w * 0.9, 0.012, hc.l * 0.9, V(x, 0, z + 0.04));
    }
  }
  // companionway: washboards in the aft face (and the sliding hatch is a 'slide' hatch)
  if (h.companion) {
    const x = x0 + (h.aftRake ?? 0) * 0.5, H = ht(x0 + (h.aftRake ?? 0.01)), w = h.companion.w ?? 0.55;
    kit.box(h.companion.mat === 'teak' ? M.varnish() : paint(0x3a3e44, 0.4), w, H * 0.85, 0.03, V(x - 0.01, 0, deckH0(x, 0) + H * 0.45), 0, Math.atan2(h.aftRake ?? 0, H || 0.1));
  }
  // eyebrow / trim along the roof edge
  if (h.eyebrow) for (const s of [-1, 1]) {
    const pts = []; for (let i = 1; i < N; i++) { const x = lerp(x0, x1, i / N), w = hw(x) - slope, z = deckH0(x, 0) + ht(x); pts.push(V(x, s * w, z)); }
    kit.add(h.eyebrow === 'teak' ? M.varnish() : paint(h.eyebrow, 0.4), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.018, 5));
  }
  // dorade vents / mushroom vents
  for (const v of h.vents || []) {
    const x = bx(v.t), y = v.y ?? 0.25;
    for (const s of v.both === false ? [1] : [-1, 1]) {
      const z = deckH0(x, 0) + ht(x) + cam * (1 - (y / Math.max(0.1, hw(x))) ** 2);
      if (v.kind === 'dorade') {
        kit.add(M.steel(), new THREE.CylinderGeometry(0.035, 0.04, 0.2, 12), new THREE.Matrix4().makeTranslation(s * y, z + 0.1, -x));
        const cowl = new THREE.SphereGeometry(0.08, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6); cowl.rotateX(-Math.PI / 2); cowl.translate(s * y, z + 0.22, -x);
        kit.add(M.cowlIn(), cowl);
      } else kit.add(M.steel(), new THREE.CylinderGeometry(0.07, 0.08, 0.05, 16), new THREE.Matrix4().makeTranslation(s * y, z + 0.025, -x));
    }
  }
}

function buildCockpit(kit, C, D, Lx, ck, ckD, deckH0, bx) {
  const xa = bx(ck.t0), xf = bx(ck.t1), L = xf - xa, xm = (xa + xf) / 2;
  const cw = (t) => ck.w * Lx.bDeck(t);
  const cwm = cw((ck.t0 + ck.t1) / 2);
  const seatH = ckD.seat ?? 0.38, cm = ckD.coaming ?? 0.2;
  if (ckD.seats !== false) for (const s of [-1, 1]) {
    const sw = ckD.seatW ?? 0.36;
    kit.box(ckD.seatMat === 'teak' ? M.teak() : nonskid(D.deckTint || '#e9e6dc'), sw, 0.04, L * 0.9, V(xm, s * (cwm - sw / 2), ck.sole + seatH));
    kit.box(paint(ckD.color ?? 0xf0eee6, 0.4), 0.03, seatH, L * 0.9, V(xm, s * (cwm - sw), ck.sole + seatH / 2));
  }
  if (ckD.sole !== undefined && ckD.grating) {
    kit.box(M.teak(), cwm * 2 - 0.8, 0.025, L * 0.85, V(xm, 0, ck.sole + 0.012));
  }
  // coamings along the well's sides, on the deck
  if (cm > 0) for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = lerp(ck.t0, ck.t1 + (ckD.coamingFwd ?? 0), i / 12), x = bx(t), y = s * (cw(Math.min(t, ck.t1)) + 0.03); pts.push([x, y, deckH0(x, y * 1.02) - 0.01]); }
    kit.add(ckD.coamingMat === 'teak' ? M.varnish() : paint(ckD.color ?? 0xf0eee6, 0.4), ribbon(pts, pts.map(([x, y, z]) => [x, y * (1 - 0.02), z + cm])));
    kit.add(ckD.coamingMat === 'teak' ? M.varnish() : paint(ckD.color ?? 0xf0eee6, 0.4), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x, y * 0.99, z + cm))), 24, 0.015, 5));
  }
  // bridge deck / traveller thwart
  if (ckD.thwart) kit.box(paint(ckD.color ?? 0xf0eee6, 0.4), cwm * 2 - 0.1, 0.08, 0.3, V(bx(ckD.thwart), 0, ck.sole + (ckD.thwartH ?? 0.4)));
  if (ckD.table) kit.box(M.varnish(), 0.36, 0.5, 0.9, V(bx(ckD.table), 0, ck.sole + 0.3));
}

function buildLifelines(kit, C, Lx, L, deckH, bx) {
  const tA = L.t0 ?? 0.06, tB = L.t1 ?? 0.86, H = L.h ?? 0.62;
  const n = Math.max(2, Math.round((bx(tB) - bx(tA)) / (L.spacing ?? 1.0)));
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = lerp(tA, tB, i / n), x = bx(t), y = s * Lx.bDeck(t) * 0.93, z = deckH(x, y);
      const top = V(x, y * 1.02, z + H);
      kit.rod(L.mat === 'black' ? M.black() : M.steel(), V(x, y, z), top, 0.012);
      kit.box(M.steel(), 0.05, 0.012, 0.06, V(x, y, z + 0.006));
      pts.push(top);
    }
    const xs = C.sternX + (L.pushX ?? 0.2), ys = s * Lx.bDeck(0.02) * 0.85;
    const xb = C.bowX - (L.pulpX ?? 0.35), yb = s * Lx.bDeck(clamp((xb - C.sternX) / (C.bowX - C.sternX), 0, 1)) * 0.8;
    if (L.pushpit !== false) kit.rod(M.steel(), V(xs, ys, deckH(xs, ys)), V(xs, ys, deckH(xs, ys) + H + 0.03), 0.014);
    if (L.pulpit !== false) kit.rod(M.steel(), V(xb, yb, deckH(xb, yb)), V(xb, yb, deckH(xb, yb) + H), 0.014);
    for (const h of L.wires === 1 ? [0] : [0, -H * 0.48]) {
      const line = [L.pulpit !== false ? V(xb, yb, deckH(xb, yb) + H + h) : null, ...pts.slice().reverse().map(p => p.clone().setY(p.y + h)), L.pushpit !== false ? V(xs, ys, deckH(xs, ys) + H + 0.03 + h) : null].filter(Boolean);
      kit.add(M.wire(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length * 3, 0.0035, 4));
    }
  }
  if (L.pushpit !== false) {
    const xs = C.sternX + (L.pushX ?? 0.2), zs = deckH(xs, 0) + H + 0.03, yw = Lx.bDeck(0.02) * 0.85;
    kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xs, -yw, zs), V(xs - 0.05, 0, zs + 0.02), V(xs, yw, zs)]), 12, 0.014, 6));
  }
  if (L.pulpit !== false) {
    const xb = C.bowX - (L.pulpX ?? 0.35), zb = deckH(xb, 0) + H, yb = Lx.bDeck(clamp((xb - C.sternX) / (C.bowX - C.sternX), 0, 1)) * 0.8;
    kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xb, -yb, zb), V(C.bowX - 0.05, 0, zb + 0.03), V(xb, yb, zb)]), 12, 0.014, 6));
    kit.rod(M.steel(), V(C.bowX - 0.08, 0, deckH(C.bowX - 0.1, 0)), V(C.bowX - 0.06, 0, zb + 0.02), 0.014);
  }
}

function buildOutboard(kit, inner, C, Lx, O) {
  // a small outboard on a transom bracket: the leg down through the water, the cowling above the transom
  const x = C.sternX - (O.aft ?? 0.2), y = O.y ?? -0.35, zTop = Lx.sheer(0) + (O.dz ?? -0.05);
  const cowl = paint(O.color ?? 0x2b2d31, 0.35, 0.1);
  kit.box(M.steel(), 0.2, 0.25, 0.08, V(C.sternX - 0.04, y, zTop - 0.05));                     // bracket
  kit.add(cowl, new THREE.CapsuleGeometry(0.13, 0.18, 4, 12), new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(y, zTop + 0.18, -(x - 0.05))));
  kit.box(cowl, 0.07, 0.55, 0.14, V(x, y, zTop - 0.2));                                          // leg
  kit.box(cowl, 0.1, 0.1, 0.24, V(x + 0.02, y, zTop - 0.52));                                   // lower unit
  kit.add(M.black(), new THREE.TorusGeometry(0.08, 0.02, 6, 12), new THREE.Matrix4().makeTranslation(y, zTop - 0.53, -(x - 0.13)));  // prop
  kit.rod(M.black(), V(x - 0.1, y, zTop + 0.22), V(x + 0.4, y + 0.1, zTop + 0.2), 0.015);   // tiller arm
}

function addLabel(root, C, label) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(11,22,31,0.78)'; g.fillRect(0, 8, 256, 48);
  g.fillStyle = '#ff7a1a'; g.fillRect(0, 8, 6, 48);
  g.fillStyle = '#e9eef2'; g.font = '600 30px "Barlow Condensed", Arial Narrow, sans-serif'; g.textBaseline = 'middle';
  g.fillText(label.slice(0, 16), 16, 33);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  sp.scale.set(0.12, 0.03, 1); sp.position.set(0, C.mastHeight + 1.5, 0); sp.renderOrder = 10;
  root.add(sp);
}

// ================================================================== each boat's own pieces
export const EXTRAS = {
  // the Oceanis' mainsheet arch over the cockpit's forward end (the German-style mainsheet runs from its top)
  arch({ C, Lx, kit, bx, deckH0, ck }) {
    const x = bx(ck.t1) - 0.25, y = Lx.bDeck(ck.t1) * 0.78, z0 = deckH0(x, y), top = z0 + 1.35;
    const pts = [V(x + 0.05, -y, z0), V(x - 0.05, -y * 0.92, top - 0.35), V(x - 0.12, -y * 0.6, top), V(x - 0.12, y * 0.6, top), V(x - 0.05, y * 0.92, top - 0.35), V(x + 0.05, y, z0)];
    kit.add(paint(0xf2f3f1, 0.3), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 40, 0.05, 10));
    kit.box(M.black(), 0.2, 0.06, 0.14, V(x - 0.12, 0, top - 0.06));                                // the mainsheet block's track
  },
  // the Sunfish's deck: yellow and black stripes across the foredeck and the stern
  sunfishDeck({ C, Lx, kit, bx, deckH0 }) {
    for (const [t, c, w] of [[0.8, 0xf0c419, 0.07], [0.785, 0x1b1c1f, 0.04], [0.77, 0xf0c419, 0.07], [0.12, 0xf0c419, 0.06], [0.105, 0x1b1c1f, 0.035]]) {
      const x = bx(t), b = Lx.bDeck(t) * 0.97;
      kit.box(paint(c, 0.4), b * 2, 0.004, w, V(x, 0, deckH0(x, 0) + 0.005), 0.35);
    }
  },
  // Spray's deck, after C. D. Mower's plan in Slocum's book: the shortened Cape Ann dory bottom-up between the
  // houses, the water casks either side of it, the pump, the stovepipe from the forward house
  sprayDory({ C, Lx, kit, bx, deckH0 }) {
    const x0 = bx(0.37), x1 = bx(0.5), xm = (x0 + x1) / 2, L = x1 - x0, z = deckH0(xm, 0);
    const pos = [], idx = [], N = 10;
    for (let i = 0; i <= N; i++) {                                                // a flat-bottomed dory, bottom up
      const f = i / N, x = x0 + L * f, b = 0.55 * Math.sin(Math.PI * (0.12 + 0.76 * f)) ** 0.6 * (f > 0.7 ? 1 - (f - 0.7) * 1.8 : 1);
      pos.push(-b, z + 0.02, -x, -b * 0.75, z + 0.42, -x, b * 0.75, z + 0.42, -x, b, z + 0.02, -x);
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { const a = i * 4 + k, c = a + 4; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    kit.add(paint(0x6d8f6a, 0.6), g);
    for (const s of [-1, 1]) { const y = s * 1.05, x = xm; kit.add(wood(0x9a7a4c), lathe([[0.22, 0], [0.27, 0.3], [0.22, 0.6], [0, 0.6]], 14), new THREE.Matrix4().makeTranslation(y, deckH0(x, y), -x)); }
    kit.box(M.bronze(), 0.12, 0.35, 0.12, V(xm, 0.6, z + 0.17));                               // pump
    const fx = bx(0.56); kit.rod(M.black(), V(fx, 0.45, deckH0(fx, 0) + 0.5), V(fx, 0.45, deckH0(fx, 0) + 1.1), 0.05, 10);   // stovepipe
  },
  // a transom that folds down into a bathing platform (a modern cruiser's), with the swim ladder
  swimPlatform({ C, Lx, kit }) {
    const x = C.sternX, z = 0.28, w = Lx.bDeck(0) * 1.6;
    kit.box(nonskid('#e2e2dc'), w, 0.06, 0.62, V(x - 0.31, 0, z));
    kit.box(paint(C.hull.color, 0.3), w, 0.04, 0.62, V(x - 0.31, 0, z - 0.05));
    for (const s of [-1, 1]) kit.rod(M.steel(), V(x - 0.05, s * w * 0.48, z + 0.03), V(x + 0.1, s * w * 0.46, Lx.sheer(0) + 0.1), 0.006);   // gas struts
    for (let i = 0; i < 3; i++) kit.box(M.steel(), 0.3, 0.02, 0.05, V(x - 0.6, 0.25, z - 0.2 - i * 0.22));
    for (const s of [-1, 1]) kit.rod(M.steel(), V(x - 0.6, 0.25 + s * 0.14, z), V(x - 0.62, 0.25 + s * 0.14, z - 0.66), 0.008);
  },
  // the Optimist's buoyancy bags (bow and both sides), the mast thwart and the bailer on its lanyard
  optiBuoyancy({ C, Lx, kit, bx, deckH0 }) {
    const bag = paint(0xf2f2ee, 0.7);
    for (const s of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 8; i++) { const t = lerp(0.2, 0.7, i / 8); pts.push(V(bx(t), s * (Lx.bDeck(t) - 0.14), 0.18)); }
      kit.add(bag, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.11, 10));
    }
    kit.add(bag, new THREE.CapsuleGeometry(0.12, Lx.bDeck(0.95) * 1.2, 4, 10), new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(0, 0.2, -(C.bowX - 0.2))));
    kit.box(wood(), Lx.bDeck(0.8) * 2, 0.04, 0.16, V(C.mastX, 0, C.freeboard - 0.03));          // mast thwart
    kit.box(paint(0x2d6fb7, 0.6), 0.14, 0.1, 0.18, V(-0.4, 0.2, 0.0));                           // bailer
  },
  // Spray: the windlass on the foredeck, water casks, the jigger mast's semicircular brace, the pin rail at the mast
  sprayDetails({ C, Lx, kit, bx, deckH0 }) {
    const wx = C.bowX - 1.0, wz = deckH0(wx, 0);
    kit.rod(wood(0x8a6a44), V(wx, -0.45, wz + 0.25), V(wx, 0.45, wz + 0.25), 0.1, 12);          // windlass barrel
    for (const s of [-1, 1]) kit.box(wood(0x8a6a44), 0.1, 0.4, 0.3, V(wx, s * 0.5, wz + 0.2));
    const mx = C.sails.find(s => s.key === 'mizzen');
    if (mx) { const pts = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; pts.push(V(mx.tackX + 0.02 - 0.35 * Math.sin(a), 0.6 * Math.cos(a), Lx.sheer(0.02) + 0.35)); } kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.02, 6)); }
    kit.box(wood(0x8a6a44), 0.9, 0.06, 0.08, V(C.mastX - 0.2, 0, deckH0(C.mastX, 0) + 0.7));   // pin rail
    for (let i = 0; i < 6; i++) kit.rod(wood(0x6a5030), V(C.mastX - 0.2, -0.38 + i * 0.15, deckH0(C.mastX, 0) + 0.62), V(C.mastX - 0.2, -0.38 + i * 0.15, deckH0(C.mastX, 0) + 0.85), 0.012);
  },
  // Joshua: the wind-vane self-steering gear on its frame over the canoe stern, the two small observation domes
  // (clear, black-framed) she steers from under, the black hawse eyes in the bows
  joshuaDetails({ C, Lx, kit, deckH0, bx }) {
    for (const t of [0.36, 0.44]) {
      const x = bx(t), z = deckH0(x, 0) + 0.42;
      const d = new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); d.translate(0, z, -x); kit.add(glassT(), d);
      kit.add(M.black(), new THREE.CylinderGeometry(0.33, 0.35, 0.1, 18), new THREE.Matrix4().makeTranslation(0, z - 0.03, -x));
    }
    for (const s of [-1, 1]) {
      const t = 0.9, x = bx(t), zz = Lx.sheer(t) - 0.28, y = s * (hullHalfBreadth(Lx, t, zz) + 0.004);
      const el = new THREE.CircleGeometry(0.18, 20); el.scale(1, 0.72, 1); el.rotateY(s * Math.PI / 2); el.translate(y, zz, -x); kit.add(M.black(), el);
      const eye = new THREE.CircleGeometry(0.06, 12); eye.rotateY(s * Math.PI / 2); eye.translate(y + s * 0.002, zz + 0.01, -(x - 0.05)); kit.add(paint(0xf2f0ea, 0.4), eye);
    }
    const x = C.sternX, z = Lx.sheer(0) + 0.05;
    kit.rod(M.steel(), V(x + 0.35, 0.35, z), V(x - 0.45, 0, z + 0.25), 0.02); kit.rod(M.steel(), V(x + 0.35, -0.35, z), V(x - 0.45, 0, z + 0.25), 0.02);
    kit.rod(M.steel(), V(x - 0.45, 0, z + 0.25), V(x - 0.45, 0, z + 1.0), 0.025);
    kit.box(paint(0xe8e2d0, 0.6), 0.02, 0.7, 0.35, V(x - 0.5, 0, z + 1.45));                   // the vane
    kit.rod(M.steel(), V(x - 0.45, 0, z + 0.25), V(x - 0.1, 0, -0.9), 0.02);                  // the servo linkage to the rudder
  },
};
