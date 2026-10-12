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
import { MODEL_HOOKS, transomDecal, transomPlate, M, Kit, onSide, nameStrip, gudgeons, transomLine, deckRay, V, canvasTex, rnd, hullGeometry, deckGeometry, deckHeightFn, foilGeom, lathe, profR, sailMesh, teakTex, clothX } from '../models.js';
import { linesFor, hullOffsets, calibrate, curveOf } from '../hull.js';
import { clamp, lerp, sstep, mastXAt } from '../physics.js';
import { mastXOf } from '../boom.js';
import { planChord, planRise, reefAt } from '../sail/plan.js';

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

// a laid teak deck at its real plank width (w m), the planks running fore and aft with black caulking and butt joints:
// the deck's uv is (y, x) x 1.6, so one texture repeat is 0.625 m across the planks
const plankTeak = (w) => mat('plank' + w, () => {
  const n = Math.max(2, Math.round(0.625 / w)), t = canvasTex('plankteak' + n, 512, 1024, (g, W, Hh) => {
    const r = rnd(11), pw = W / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 3; j++) {
        const y0 = (j / 3 + r() * 0.2) * Hh, base = 128 + r() * 24;
        g.fillStyle = `rgb(${base + 38},${base - 8},${base - 52})`; g.fillRect(i * pw, y0 - Hh, pw, Hh); g.fillRect(i * pw, y0, pw, Hh);
        g.fillStyle = '#1a130d'; g.fillRect(i * pw, y0, pw, 2);                                     // a butt joint
      }
      for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(80,45,18,${0.06 + r() * 0.1})`; g.lineWidth = 1; g.beginPath(); const x = i * pw + 2 + r() * (pw - 4); g.moveTo(x, 0); g.bezierCurveTo(x + r() * 3 - 1.5, Hh * 0.3, x + r() * 3 - 1.5, Hh * 0.7, x, Hh); g.stroke(); }
      g.fillStyle = '#16100b'; g.fillRect(i * pw + pw - 3, 0, 3, Hh);                               // the caulking seam
    }
  });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.78, side: THREE.DoubleSide });
});
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
  // (the size of the hardware against a 30-40 ft yacht's: a superyacht's stays, chainplates, mast fittings are bigger)
  const SC = D.scale ?? 1;
  calibrate(C);
  const Chull = { ...C, hull: { ...C.hull, color: opts.hullColor ?? C.hull.color } };
  // (a pram's bow is a transom too: close the hull there)
  const hullMeshes = [];
  if (D.bowTransom) for (const off of hullOffsets(C)) { const m = new THREE.Mesh(bowTransomGeom(C, Lx, off), M.hull(C)); inner.add(m); hullMeshes.push(m); }
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
    hull = new THREE.Mesh(r.geom, hm); hull.castShadow = true; hull.receiveShadow = true; inner.add(hull); hullMeshes.push(hull);
  }
  // ---- deck, cockpit well
  const ckD = D.cockpit || { t0: 0.1, t1: 0.35, w: 0.55, sole: C.freeboard * 0.5 };
  const ck = { t0: ckD.t0, t1: ckD.t1, w: ckD.w, sole: ckD.sole };
  const deckH0 = deckHeightFn(C, Lx, D.cockpit ? ck : null, C.multihull ? null : stations);
  const houses = (D.cabins || []).map(h => houseShape(C, Lx, deckH0, bx, h));
  const deckH = (x, y) => {
    let z = deckH0(x, y);
    for (const h of houses) { const zr = h.topAt(x, y); if (zr !== null && zr > z) z = zr; }
    return z;
  };
  const deckMat = D.deck === 'teak' && D.deckPlank ? plankTeak(D.deckPlank) : D.deck === 'teak' ? M.teak() : D.deck === 'paint' ? paint(D.deckColor ?? 0xe8e4d8, 0.7) : nonskid(D.deckTint || '#e9e6dc');
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
  const bname = opts.name || (D.hullName && D.hullName.text) || (D.transomName && D.transomName.text) || '';
  if (bname && D.nameAt !== false && !D.hullName) {
    // (a big yacht's transom carries her name and port of registry: D.transomName { text, port, w })
    const TN = D.transomName || {}, port = !opts.name || opts.name === TN.text ? TN.port ?? '' : '';
    const g = transomPlate(stations[0], Math.min(TN.w ?? 1.6, Lx.bDeck(0) * 1.5), D.nameY ?? 0);             // (laid onto the transom, inside its outline)
    if (g) inner.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: transomDecal(C, bname, port), transparent: true, roughness: 0.4 })));
  }
  if (D.hullName && bname) {
    const N = D.hullName, tex = canvasTex(`hullname-${C.id}-${bname}${N.board ? '-board' : ''}`, 512, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      if (N.board) { g.fillStyle = N.bg ?? '#f4f2ec'; g.fillRect(0, 0, w, h); g.strokeStyle = N.color ?? '#111'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8); }
      g.fillStyle = N.color ?? '#1d2a44'; g.textAlign = 'center';
      let font = N.font ?? 'italic 700 78px Georgia, "Times New Roman", serif'; g.font = font;
      const wd = g.measureText(bname).width; if (wd > w * 0.94) g.font = font.replace(/(\d+)px/, (m, px) => `${Math.floor(px * w * 0.94 / wd)}px`);
      g.fillText(bname, w / 2, 92);
    });
    // (N.board: a name board lashed to the rail above the deck, as Joshua carries hers at La Rochelle)
    // (against the outside of the stanchions, following the rail's curve)
    if (N.board) for (const side of [-1, 1]) {
      const len = N.len ?? 1.6, rail = (x) => Lx.bDeck(tAt(x)) * (N.inset ?? (D.lifelines ? 0.93 : 1)) + 0.02;   // (N.inset: lashed in the shrouds, on the bulwark cap)
      const g = onSide(nameStrip(len, side), bx(N.t), Lx.sheer(N.t) + (N.dz ?? 0.32), side, rail);
      inner.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
      inner.add(new THREE.Mesh(g, mat('boardback', () => new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6, side: THREE.BackSide }))));   // (its back, plain, seen from on deck)
    }
    else {
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
  }
  // ---- portlights in the topsides (bronze, in a classic's bulwark band)
  // (laid onto the topsides, following their flare and their curve in plan)
  const topsides = (x, z) => hullHalfBreadth(Lx, tAt(x), z);
  for (const hp of D.hullPorts || []) for (let k = 0; k < hp.n; k++) {
    const t = lerp(hp.t0, hp.t1, hp.n > 1 ? k / (hp.n - 1) : 0.5), x = bx(t), r = hp.r ?? 0.06;
    for (const s of [-1, 1]) {
      kit.add(hp.mat === 'steel' ? M.steel() : M.bronze(), onSide(new THREE.TorusGeometry(r, r * 0.22, 8, 18), x, hp.z, s, topsides, 0.004));
      kit.add(M.glass(), onSide(new THREE.CircleGeometry(r * 0.9, 16), x, hp.z, s, topsides, 0.006));
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
  // (on the deck mesh itself, or a house's roof where one stands)
  const onDeck = deckRay([deck, ...hullMeshes]), roofZ = (x, y) => Math.max(-9, ...houses.map(h => h.topAt(x, y) ?? -9));
  const deckAt = (x, y) => { const z = onDeck(x, y); return z === null ? deckH(x, y) : Math.max(z, roofZ(x, y)); };
  const cleat = (x, y) => { const z = deckAt(x, y); kit.box(cleatM, 0.035, 0.03, 0.16 * (D.cleatScale ?? 1), V(x, y, z + 0.035)); kit.box(cleatM, 0.03, 0.035, 0.04, V(x, y, z + 0.015)); };
  if (D.cleats !== false) { cleat(C.bowX - (D.bowCleatX ?? 0.35), 0); for (const s of [-1, 1]) cleat(C.sternX + 0.3, s * Math.min(Lx.bDeck(0.05), Lx.bDeck(tAt(C.sternX + 0.3))) * 0.8); }   // (inside the deck there, a canoe stern narrow)
  // chainplates: per mast, at the shrouds' feet (each rig's spreaders set where)
  const chains = {};
  for (const mk of mastKeys(boat)) {
    const R = mastSpec(C, D, mk), cx = R.x - (R.chainAft ?? 0.1), list = [];
    chains[mk] = list;
    if (R.shrouds === false) { for (const s of [-1, 1]) list.push([cx, s * Lx.bDeck(tAt(cx)) * 0.9, deckH0(cx, 0)]); continue; }
    for (const s of [-1, 1]) {
      const y = s * Lx.bDeck(tAt(cx)) * (R.chainIn ?? 0.95), z = deckH0(cx, y);
      list.push([cx, y, z]); kit.box(M.steel(), 0.02 * SC, 0.07 * SC, 0.05 * SC, V(cx, y, z + 0.025 * SC));
    }
    chains[mk] = list;
  }
  if (D.navLights !== false) {
    const nx = C.bowX - 0.3, ny = Lx.bDeck(tAt(nx)) * 0.8;
    kit.box(M.red(), 0.05 * SC, 0.04 * SC, 0.07 * SC, V(nx, -ny, deckH(nx, -ny) + 0.02 * SC));
    kit.box(M.green(), 0.05 * SC, 0.04 * SC, 0.07 * SC, V(nx, ny, deckH(nx, ny) + 0.02 * SC));
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
    if (KD.winglets) {
      // winglets at the tip (Australia II's): a pair of small wings swept back off the bottom of the keel, canted
      // down, their root along the tip's chord (W.x0: where along it their leading edge starts)
      const W = KD.winglets, ch = KD.chord ?? K.chord, tipC = ch * (KD.taper ?? 0.7), tipLE = ch * (KD.sweep ?? 0.15);
      for (const sd of [-1, 1]) {
        const wg = new THREE.Mesh(foilGeom(W.chord, W.span, W.tc ?? 0.1, (W.tipChord ?? W.chord * 0.6) / W.chord, W.sweep ?? 0.35), keelMesh.material);
        wg.position.set(0, -span + 0.03, tipLE + tipC * (W.x0 ?? 0.3)); wg.rotation.z = sd * (Math.PI / 2 - (W.cant ?? 20) * Math.PI / 180);
        wg.castShadow = true; keelMesh.add(wg);
      }
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
  const rudderPivot = new THREE.Group(), twinPivots = [];
  let tillerEnd = new THREE.Vector3(), extension = null;
  const ST = D.steering || { kind: 'tiller' };
  let stockTop;
  if (RD.kind === 'transom') {
    // hung on the transom (or the sternpost of a double-ender) on gudgeons and pintles, along its rake: the pivot axis
    // is the pintles' line 2.5 cm aft of it (a blade hung plumb stood off a raked transom at one end and ran into it at
    // the other); lengths up the blade are measured along that line (k), its lean kept for a plumb one
    const tx = RD.x ?? C.sternX + (RD.dx ?? 0);
    const topZ0 = RD.top ?? Lx.sheer(0) + 0.08, botZ0 = RD.bottom ?? -(C.draft - 0.05);
    const TL = transomLine(hullMeshes, tx, 0.12, Math.max(0.3, Math.min(topZ0, Lx.sheer(0)) - 0.15)), tilt = Math.atan(TL.slope), k = 1 / Math.cos(tilt);
    const px = TL.slope > 0.02 ? TL.x0 - 0.025 * k : tx, topZ = topZ0 * k, botZ = botZ0 * k;
    rudderPivot.position.copy(V(px, 0, 0)); rudderPivot.rotation.x = tilt; rudderPivot.userData.tilt = tilt;
    const sh = new THREE.Shape(), ch = Rd.chord, ch0 = RD.chordTop ?? ch * 0.55, lean = TL.slope > 0.02 ? 0 : RD.lean ?? 0;
    sh.moveTo(0, topZ); sh.lineTo(-lean, botZ + 0.12); sh.quadraticCurveTo(-lean, botZ, -lean + 0.12, botZ);
    sh.lineTo(-lean + ch * 0.9, botZ + 0.04); sh.quadraticCurveTo(-lean + ch * 1.05, botZ + 0.1, ch, botZ + (RD.heel ?? 0.35));
    sh.lineTo(ch0, topZ - 0.25); sh.lineTo(ch0 * 0.6, topZ);
    const bg = new THREE.ExtrudeGeometry(sh, { depth: RD.thick ?? 0.04, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
    bg.translate(0, 0, -(RD.thick ?? 0.04) / 2); bg.rotateY(-Math.PI / 2);
    const blade = new THREE.Mesh(bg, RD.mat === 'wood' ? M.varnish() : RD.mat === 'hull' ? M.hull(C) : paint(RD.color ?? 0xf2f2ee, 0.4)); blade.castShadow = true; rudderPivot.add(blade);
    if (RD.mat === 'hull') blade.material = paint(C.hull.color, 0.35);
    const pins = RD.pintles ?? [0.1, topZ0 - 0.3];
    for (const z of pins) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 8), D.bronze ? M.bronze() : M.steel()); pin.position.set(0, z * k, 0.005); rudderPivot.add(pin); }
    gudgeons(kit, hullMeshes, (z) => px - z * TL.slope - 0.005, pins, D.bronze ? M.bronze() : M.steel());
    stockTop = topZ0;
  } else if (RD.twin) {
    // twin spades either side of the centreline (Rd.y), each on its own stock up through the hull bottom there: the
    // blade's root a hair inside the hull's surface at its own y (the bottom rises off the centreline), turned together
    const x = Rd.x + Rd.chord * 0.25, span = RD.span ?? Rd.span;
    const bottomAt = (xx, y) => { const sec = Lx.section(tAt(xx)); for (let i = sec.length - 1; i > 0; i--) { const [y0, z0] = sec[i], [y1, z1] = sec[i - 1]; if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) return z0 + (z1 - z0) * (y - y0) / (y1 - y0); } return Lx.keelZ(tAt(xx)); };
    for (const sd of [-1, 1]) {
      const y = sd * Rd.y, top = Math.max(bottomAt(Rd.x, Rd.y), bottomAt(Rd.x + Rd.chord * 0.75, Rd.y)) + 0.03;
      const pv = new THREE.Group(); pv.position.copy(V(x, y, 0));
      const blade = new THREE.Mesh(foilGeom(Rd.chord, span + top - (Rd.z + span / 2), RD.thick ?? 0.12, RD.taper ?? 0.72, RD.sweep ?? 0.08), paint(RD.color ?? C.hull.boot, 0.7));
      blade.position.set(0, top, -Rd.chord * 0.25); blade.castShadow = true; pv.add(blade);
      const stock = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * SC / 3 + 0.03, 0.06 * SC / 3 + 0.03, 0.6, 12), M.steel()); stock.position.set(0, top + 0.25, 0); pv.add(stock);
      rudderPivot.add(pv); twinPivots.push(pv);
    }
    stockTop = top0Twin(Lx, tAt, Rd);
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
    // (as it lies; on a raked rudder, from the stock's head, taken into the tilted pivot's frame)
    const tLen = ST.len ?? 1.1, z0 = stockTop + (ST.dz ?? 0.02), tl = rudderPivot.userData.tilt || 0, hz = stockTop * Math.tan(tl);
    const un = (y, z) => new THREE.Vector3(0, y * Math.cos(tl) + z * Math.sin(tl), -y * Math.sin(tl) + z * Math.cos(tl));
    const tpts = [un(z0, hz + (RD.kind === 'transom' ? 0.05 : 0)), un(z0 + 0.08, hz - tLen * 0.3), un(z0 + (ST.rise ?? 0.14), hz - tLen)];
    const tiller = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tpts), 16, ST.r ?? 0.024, 8), ST.mat === 'alu' ? M.alu() : ST.mat === 'black' ? M.black() : M.varnish());
    tiller.castShadow = true; rudderPivot.add(tiller); tillerEnd.copy(tpts[2]);
    if (ST.extension) {
      const L = ST.extension, g = new THREE.CylinderGeometry(0.012, 0.012, L + 0.05, 8); g.translate(0, L / 2 - 0.025, 0); g.rotateX(-Math.PI / 2 + 0.08);   // (its joint 5 cm into the tiller's end)
      extension = new THREE.Mesh(g, M.black()); extension.castShadow = true; extension.position.copy(tillerEnd); extension.rotation.x = -tl; rudderPivot.add(extension); extension.userData.len = L;
    }
  }
  inner.add(rudderPivot);
  const wheels = [];
  if (ST.kind === 'wheel' || ST.kind === 'twin') {
    const ys = ST.kind === 'twin' ? [-ST.y, ST.y] : [0];
    for (const y of ys) {
      // (ST.onDeck: the wheels stand on the deck aft of the cockpit, not in its well)
      const wx = ST.x, base = ST.onDeck ? deckH0(wx, y) : ck.sole, hub = base + (ST.hub ?? 0.85), r = ST.r ?? 0.45;
      if (ST.kind === 'wheel') {
        kit.add(M.steel(), lathe([[0.1, 0], [0.09, 0.05], [0.07, 0.12], [0.06, hub - base - 0.1], [0.075, hub - base], [0, hub - base + 0.02]], 14), new THREE.Matrix4().makeTranslation(0, base, -wx));
        kit.box(M.black(), 0.16, 0.12, 0.06, V(wx + 0.06, 0, hub + 0.06), 0, -0.4);     // compass / instrument binnacle
      } else kit.rod(M.steel(), V(wx + 0.05, y, deckH0(wx + 0.05, y) - 0.02), V(wx + 0.05, y, hub), 0.035, 12, 0.03);
      const w = new THREE.Group(); w.position.copy(V(wx, y, hub));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r, ST.rimR ?? 0.018, 8, 48), ST.rim === 'wood' ? M.varnish() : M.steel()); w.add(rim);
      const nsp = ST.spokes ?? 6;
      for (let i = 0; i < nsp; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.009 * (ST.spokeK ?? 1), 0.009 * (ST.spokeK ?? 1), r * 2, 6), M.steel()); sp.rotation.z = i * Math.PI / nsp; w.add(sp); }
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * (ST.spokeK ?? 1), 0.05 * (ST.spokeK ?? 1), 0.08 * (ST.spokeK ?? 1), 12), M.steel()); hb.rotation.x = Math.PI / 2; w.add(hb);
      w.traverse(o => { if (o.isMesh) o.castShadow = true; });
      inner.add(w); wheels.push(w);
    }
    // the grab point for the helm: the top of the (first) wheel's rim, in the rudder pivot's frame
    tillerEnd = rudderPivot.worldToLocal(inner.localToWorld(V(ST.x, ys[0], (ST.onDeck ? deckH0(ST.x, ys[0]) : ck.sole) + (ST.hub ?? 0.85) + (ST.r ?? 0.45))));
  }
  // ---- outboard on its bracket
  if (D.outboard) buildOutboard(kit, inner, C, Lx, D.outboard);
  // ---- spars and standing rigging
  const rig = new THREE.Group(); inner.add(rig);
  const rigKit = new Kit();
  const S = boat.sailBy;
  const mastBase = deckH(C.mastX, 0) + 0.02;
  const stay = {};
  const xAts = {};
  for (const mk of mastKeys(boat)) {
    // (a mast with no collar stands in its tube: its foot below the deck)
    const R = mastSpec(C, D, mk), base0 = deckH(R.x, 0), base = base0 + (R.mastCollar === false ? -0.03 : 0.02), top = R.h, len = top - base;
    // (a raked mast leans aft about its gooseneck: its axis's x at height z)
    const xAt = xAts[mk] = (z) => (mk === 'main' ? mastXAt(C, z) : mastXOf(C, mk, z)), x = xAt(base), tilt = Math.atan2(xAt(base) - xAt(top), len);
    const mm = spar(R.mat), r0 = R.r;
    // a lower mast and its topmast (R.topmast { cap: the lower masthead's height, heel: the topmast's foot, r }): the
    // topmast is fidded on the lower mast's fore side, held at the doubling between the trestletrees and the cap
    // (the spar's length along its raked axis: its head at the mast's height)
    const TM = R.topmast, lowTop = TM ? TM.cap : top, lowLen = (lowTop - base) / Math.cos(tilt), sl = len / Math.cos(tilt);
    const prof = TM ? [[r0, 0], [r0, lowLen * 0.6], [r0 * 0.88, lowLen], [0, lowLen + 0.01]] : [[r0, 0], [r0, sl * 0.55], [r0 * 0.92, sl * 0.8], [R.rTop ?? r0 * 0.6, sl], [0, sl + 0.01]];
    const m = new THREE.Mesh(lathe(prof, 14), mm);
    m.scale.set(1, 1, R.round ? 1 : 1.25); m.position.copy(V(x, 0, base)); m.rotation.x = tilt; m.castShadow = true; rig.add(m);
    if (TM) {
      const rt = TM.r ?? r0 * 0.6, heel = TM.heel, fwd = r0 * 0.88 + rt + 0.01, tl = (top - heel) / Math.cos(tilt);
      const tmm = new THREE.Mesh(lathe([[rt, 0], [rt, tl * 0.5], [rt * 0.75, tl * 0.92], [rt * 0.6, tl], [0, tl + 0.01]], 12), mm);
      tmm.position.copy(V(xAt(heel) + fwd, 0, heel)); tmm.rotation.x = tilt; tmm.castShadow = true; rig.add(tmm);
      // the cap over the lower masthead, round both spars; the trestletrees and crosstrees at the doubling's foot
      rigKit.box(mm, 0.14, 0.12, fwd + r0 + rt + 0.06, V(xAt(lowTop) + fwd / 2, 0, lowTop + 0.04));
      const tz = heel + 0.12;
      rigKit.box(mm, 0.1, 0.1, fwd + r0 + rt + 0.3, V(xAt(tz) + fwd / 2, 0, tz));
      rigKit.rod(mm, V(xAt(tz), -(TM.trees ?? 0.9), tz + 0.06), V(xAt(tz), TM.trees ?? 0.9, tz + 0.06), 0.035);
      // topmast shrouds over the crosstrees' ends to the topmast's head
      if (TM.shrouds !== false) for (const s of [-1, 1]) rigKit.rod(M.wire(), V(xAt(tz), s * (TM.trees ?? 0.9), tz + 0.06), V(xAt(top - 0.6) + fwd, s * 0.02, top - 0.6), 0.004);
    }
    if (!R.round) rigKit.box(M.black(), 0.012 * SC, len * 0.92, 0.012 * SC, V(xAt(base + len * 0.48) - r0 * 1.2, 0, base + len * 0.48)); // luff track
    if (!TM) rigKit.box(mm, 0.06 * SC, 0.04 * SC, 0.14 * SC, V(xAt(top) - 0.03, 0, top + 0.01));                                     // masthead
    if (R.mastCollar !== false) rigKit.add(mm, new THREE.CylinderGeometry(r0 * 1.5, r0 * 1.7, 0.075, 14), new THREE.Matrix4().makeTranslation(0, base + 0.0125, -x));   // (from the deck up)
    const sails = boat.sails.filter(s => s.kind === 'boom' && (mk === 'main' ? s.key === 'main' : s.key === mk));
    for (const s of sails) { const gz = (s.key === 'main' ? C.boomZ : s.tackZ) - 0.035; rigKit.box(M.black(), 0.08 * SC, 0.06 * SC, 0.08 * SC, V(xAt(gz) - (R.round ? 1 : 1.25) * r0 - 0.035 * SC, 0, gz)); } // gooseneck, on the mast's aft face at the boom's height
    // spreaders, shrouds, lowers
    const ch = chains[mk];
    const hounds = R.hounds ?? (TM ? lowTop - 0.5 : top - 0.2);
    let prevTips = null;
    const sprs = R.spreaders || [];
    sprs.forEach((sp, i) => {
      const z = base + sp.f * len, sw = sp.sweep ?? 0, xz = xAt(z);
      const tips = [-1, 1].map(s => V(xz - sp.len * Math.sin(sw), s * sp.len * Math.cos(sw), z + 0.03));
      for (const s of [0, 1]) rigKit.rod(R.mat === 'wood' ? mm : R.sprMat === 'mast' ? mm : M.alu(), V(xz, (s ? 1 : -1) * 0.03, z), tips[s], (R.sprR ?? 0.016), 6, (R.sprR ?? 0.016) * 0.62);
      prevTips = prevTips || null;
      sp._tips = tips; sp._z = z;
    });
    for (let s = 0; s < 2 && R.shrouds !== false; s++) {
      const [cx, cy, cz] = ch[s], foot = V(cx, cy, cz + 0.05);
      // cap shroud over every spreader tip to the hounds; lowers from the chainplate to the lowest spreader root
      let pts = [foot, ...sprs.map(sp => sp._tips[s]), V(xAt(hounds), (s ? 1 : -1) * 0.02, hounds)];
      for (let k = 0; k < pts.length - 1; k++) rigKit.rod(M.wire(), pts[k], pts[k + 1], R.wire ?? 0.0035);
      if (sprs.length && R.lowers !== false) for (const dx of R.lowerX ?? [0.3, -0.3]) rigKit.rod(M.wire(), V(cx + dx, cy * 0.97, cz + 0.05), V(xAt(sprs[0]._z), (s ? 1 : -1) * 0.03, sprs[0]._z), R.lowerWire ?? 0.003);
      if (sprs.length > 1) for (let k = 1; k < sprs.length; k++) rigKit.rod(M.wire(), sprs[k - 1]._tips[s], V(xAt(sprs[k]._z), (s ? 1 : -1) * 0.03, sprs[k]._z), R.lowerWire ?? 0.003); // intermediates
      // (a big rig's second shroud each side, aft of the first: R.shrouds2 its chainplate's distance aft)
      if (R.shrouds2) rigKit.rod(M.wire(), V(cx - R.shrouds2, cy * 0.99, cz + 0.05), V(xAt(hounds - 0.3), (s ? 1 : -1) * 0.03, hounds - 0.3), R.wire ?? 0.0035);
      if (R.ratlines) for (let z = cz + 0.5; z < (sprs.length ? sprs[0]._z : hounds) - 0.4; z += 0.38) {
        const a = pts[0], b = pts[1], f = (z - a.y) / (b.y - a.y);
        const p1 = a.clone().lerp(b, f);
        const zt = sprs.length ? sprs[0]._z : hounds, a2 = R.shrouds2 ? V(cx - R.shrouds2, cy * 0.99, cz + 0.05) : V(cx - 0.35, cy * 0.97, cz + 0.05);
        const b2 = R.shrouds2 ? V(xAt(hounds - 0.3), (s ? 1 : -1) * 0.03, hounds - 0.3) : V(xAt(zt), (s ? 1 : -1) * 0.03, zt), f2 = (z - a2.y) / (b2.y - a2.y);
        rigKit.rod(M.black(), p1, a2.clone().lerp(b2, f2), 0.006);
      }
    }
    if (R.deadeyes) for (let s = 0; s < 2; s++) { const [cx, cy, cz] = ch[s]; for (const dx of [0, -(R.shrouds2 ?? 0.35)]) rigKit.add(M.black(), new THREE.SphereGeometry(R.deadeyeR ?? 0.045, 10, 8), new THREE.Matrix4().makeTranslation(cy * 0.99, cz + 0.35, -(cx + dx))); }
    if (R.crosstrees) { const z = base + R.crosstrees.f * len; rigKit.rod(mm, V(xAt(z), -R.crosstrees.len, z), V(xAt(z), R.crosstrees.len, z), 0.025); }
    if (mk === 'main') { stay.mastTop = top; }
    else if (R.stayTo !== false) rigKit.rod(M.wire(), V(xAt(R.h - 0.1), 0, R.h - 0.1), V(R.stayTo ?? C.sternX + 0.1, 0, R.stayToZ ?? Lx.sheer(0) + 0.1), 0.003); // mizzen backstay / triatic
    if (mk !== 'main' && R.triatic) rigKit.rod(M.wire(), V(xAt(R.h - 0.05) + 0.03, 0, R.h - 0.05), V(mastXAt(C, R.triatic) - 0.03, 0, R.triatic), 0.003);
    // (stays between the masts, R.springs [{ to: mast key, z0: height on this mast, z1: on that one }]: a schooner's
    // spring stay and topmast stay, from one masthead to the next)
    for (const sp of R.springs || []) rigKit.rod(M.wire(), V(xAt(sp.z0), 0, sp.z0), V((sp.to === 'main' ? mastXAt(C, sp.z1) : mastXOf(C, sp.to, sp.z1)), 0, sp.z1), sp.r ?? 0.006);
  }
  // headstays: each headsail's stay (the sail's luff), from its tack to the mast
  for (const s of boat.sails) {
    if (s.kind !== 'loose' && !(s.kind === 'boom' && s.key !== 'main' && !s.mast)) continue;
    rigKit.rod(M.wire(), V(s.tackX, 0, s.tackZ - 0.03), V(s.tackX - s.rake, 0, s.tackZ + s.luff + 0.08), D.stayR ?? 0.004);
  }
  if (D.forestay) rigKit.rod(M.wire(), V(D.forestay.x, 0, D.forestay.z), V(C.mastX + 0.03, 0, D.forestay.top), D.stayR ?? 0.004);
  // backstay (split near the transom), or runners' pendants
  if ((C.hasBackstay || D.backstay) && D.backstay !== false) {
    const bs = D.backstay || {};
    stay.backstayTop = V(C.mastX - 0.05, 0, bs.top ?? C.mastHeight);
    const bsX = bs.x ?? C.sternX + 0.05, lowZ = bs.z ?? Lx.sheer(0.02);
    if (bs.split !== false) {
      stay.backstayLow = V(bsX + (bs.splitDx ?? 0.25), 0, lowZ + (bs.splitH ?? 0.9));
      rigKit.rod(M.wire(), stay.backstayTop, stay.backstayLow, 0.0035);
      for (const s of [-1, 1]) rigKit.rod(M.wire(), stay.backstayLow, V(bsX + 0.02, s * Lx.bDeck(0.02) * 0.6, lowZ), 0.003);
    } else { stay.backstayLow = V(bsX, 0, lowZ + 0.15); rigKit.rod(M.wire(), stay.backstayTop, V(bsX, 0, lowZ), D.stayR ?? 0.0035); }
  }
  if (!stay.backstayLow) stay.backstayLow = V(C.sternX + 0.3, 0, Lx.sheer(0.02) + 0.15);
  if (D.runners) for (const s of [-1, 1]) rigKit.rod(M.wire(), V(C.mastX - 0.03, s * 0.02, D.runners.z), V(D.runners.x, s * Lx.bDeck(tAt(D.runners.x)) * (D.runners.in ?? 0.9), Lx.sheer(tAt(D.runners.x)) + 0.05), D.runners.r ?? 0.0025);
  rigKit.build(rig);
  // windex on the main masthead
  const windex = new THREE.Group(); windex.position.copy(V(C.mastX, 0, C.mastHeight + 0.14));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 6), M.black()); arrow.rotation.x = -Math.PI / 2; arrow.position.z = -0.2; windex.add(arrow);
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.1, 0.16), M.red()); vane.position.z = 0.14; windex.add(vane);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.16, 6), M.black()); stem.position.y = -0.07; windex.add(stem);   // its spindle, down to the masthead
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 5), M.black()); arm.rotation.x = Math.PI / 2; windex.add(arm);        // the arm from the arrow to the vane
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
    const bp = [[br * 0.8, 0], [br, (L + fwd) * 0.4], [br * 0.9, (L + fwd) * 0.85], [br * 0.7, L + fwd], [0, L + fwd]], bgm = lathe(bp, 10), ky = s.boomRound ? 1 : 1.3;
    bgm.rotateX(Math.PI / 2); bgm.scale(1, ky, 1); bgm.translate(0, 0, -fwd);
    const bm = s.boomMat ?? R?.mat ?? 'alu';
    const boomMesh = new THREE.Mesh(bgm, spar(bm)); boomMesh.position.y = -0.05; boomMesh.castShadow = true; if (!s.boomless) piv.add(boomMesh);   // (a loose-footed sail: no boom)
    piv.userData.top = (d) => -0.05 + ky * profR(bp, d + fwd);                // the boom's top and bottom, d aft of the pivot (fittings sit on it, blocks hang under it)
    piv.userData.bottom = (d) => -0.05 - ky * profR(bp, d + fwd);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06 * SC, 0.07 * SC, 0.07 * SC), M.black()); cap.position.set(0, -0.05, L); if (!s.boomless) piv.add(cap);
    if (s.inBoom) {
      // an in-boom furler: the mandrel inside, the sail rolling down into it through a slot along the boom's top
      const slot = new THREE.Mesh(new THREE.BoxGeometry(br * 0.32, 0.02, L * 0.9), M.black()); slot.position.set(0, -0.05 + ky * br - 0.006, L * 0.5); piv.add(slot);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.6, br * 0.6, 0.35, 16), M.black()); drum.rotation.x = Math.PI / 2; drum.position.set(0, -0.05, 0.25); piv.add(drum);
    }
    if (isMain && s.reefs && !s.furling) {
      const bundle = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, L * 0.8, 4, 10), new THREE.MeshStandardMaterial({ color: (C.sailcloth || {}).cloth ?? 0xf2f0ea, roughness: 0.85 }));
      bundle.rotation.x = Math.PI / 2; bundle.position.set(0, 0.03, L * 0.48); bundle.visible = false; piv.add(bundle); piv.userData.bundle = bundle;
    }
    rig.add(piv); booms[s.key] = piv;
    // a headsail's club swivels on a pedestal on the deck at its tack
    if (!isMain && !s.mast && !s.boomless) { const zd = deckH(px, 0); if (pz - 0.05 - zd > 0.005) kit.rod(M.black(), V(px, 0, zd - 0.005), V(px, 0, pz - 0.05), 0.014, 8); }
  }
  // gaff, yard, sprit, spinnaker pole: placed each frame from the sail
  const dyn = {};
  const rodMesh = (r, m) => { const g = new THREE.CylinderGeometry(r, r * 0.85, 1, 10); g.translate(0, 0.5, 0); const o = new THREE.Mesh(g, m); o.castShadow = true; rig.add(o); return o; };
  for (const s of boat.sails) {
    if (s.rig === 'gaff') {
      // the gaff, its jaws round the mast, the throat halyard to its block under the masthead and the peak halyard's
      // two spans from its block above to the bridles on the gaff (every gaff sail: a schooner has one per mast)
      const mk = s.key === 'main' ? 'main' : s.key, R = mastSpec(C, D, mk), sm = spar(s.boomMat ?? R.mat), rope = paint(0xd8ccae, 0.85);
      const gr = s.gaffR ?? 0.045, low = R.topmast ? R.topmast.cap : R.h;
      (dyn.gaffs || (dyn.gaffs = [])).push({ s, mk, R, mesh: rodMesh(gr, sm), jaws: [rodMesh(gr * 0.55, sm), rodMesh(gr * 0.55, sm)],
        throatHal: rodMesh(s.halR ?? 0.009, rope), peakHal: [rodMesh(s.halR ?? 0.009, rope), rodMesh(s.halR ?? 0.009, rope)],
        blocks: [rodMesh(gr * 1.4, M.black()), rodMesh(gr * 1.4, M.black())], low, xAt: xAts[mk] });
    }
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
  const ctx = { C, D, Lx, kit, rigKit: null, inner, rig, deckH, deckH0, deckAt, bx, tAt, ck, houses, stations, boat };
  for (const e of D.extras || []) if (EXTRAS[e]) EXTRAS[e](ctx);
  kit.build(inner);
  if (opts.label) addLabel(root, C, opts.label);
  const chainMain = chains.main, mainR = mastSpec(C, D, 'main');
  const vis = { root, inner, hull, deck, booms, sailMeshes, rudderPivot, rudderPivots: twinPivots, keelMesh, telltales, windex, rig, sprit, extension, tillerEnd,
    lines: Lx, deckH, ck, chain: chainMain, stay, mastBase, boardPivot, wheels, dyn, update: updateDetailed,
    mastXAt: (z) => mastXAt(C, z ?? C.boomZ), mastR: mainR.r, mastAft: (y) => (mainR.round ? 1 : 1.25) * mainR.r * Math.sqrt(Math.max(0, 1 - (y / mainR.r) ** 2)) };
  return vis;
}
MODEL_HOOKS.build = buildDetailed;

// ------------------------------------------------------------------ per frame: the parts only this builder has
const _ga = new THREE.Vector3(), _gb = new THREE.Vector3(), _gc = new THREE.Vector3(), _gd = new THREE.Vector3(), _ge = new THREE.Vector3(), _gf = new THREE.Vector3(), _gg = new THREE.Vector3(), _gh = new THREE.Vector3();
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
    if (rg) { rg.cloth.sample(clothX(rg), u, v, _q); return out.copy(V(_q[0], _q[1], _q[2])); }
    const st = b.diag.strips[s.key], sh = b.diag.shape[s.key], a0 = st.baseAngle ?? 0, a = lerp(a0, sh[2].ang, v);
    // (the planform as set: reefed, or a gaff sail's topsail handed, js/sail/plan.js)
    const sp = s.gaff && b.setSail ? b.setSail(s) : s, luff = s.key === 'main' || s.gaff ? s.luff * reefAt(b.reefPos, s).l : s.luff;
    const chord = planChord(sp, v) * u;
    let lx = (s.key === 'main' ? C.mastX - 0.02 : s.tackX) - (s.rake || 0) * v, ly = 0;
    if (s.rig === 'lateen') { const dx = s.tackFwd - (s.rake || 0) * v; lx = C.mastX - 0.02 + dx * Math.cos(a0); ly = -dx * Math.sin(a0); }
    return out.copy(V(lx - Math.cos(a) * chord, ly + Math.sin(a) * chord, (s.key === 'main' ? C.boomZ : s.tackZ) + v * luff + planRise(sp, v) * u));
  };
  // the gaff's row: the head, or (a topsail set over it) the row the gaff runs along
  const gaffV = (s) => { const rg = act && b.sailSys.cloth(s.key); if (rg) return rg.gaffRowV ?? 1; const sp = s.gaff && b.setSail ? b.setSail(s) : s; return sp.gaffV ?? 1; };
  for (const G of dyn.gaffs || []) {
    const gv = gaffV(G.s), T = corner(G.s, 0, gv, _ga), P = corner(G.s, 1, gv, _gb), R = G.R, xAt = G.xAt;
    placeRod(G.mesh, T, P, 0.12, 0.08);
    // (worked in the boat's frame, x forward, y to starboard, z up: V() takes them to the model's)
    const tp = [-T.z, T.x, T.y], pp = [-P.z, P.x, P.y], L = Math.hypot(pp[0] - tp[0], pp[1] - tp[1], pp[2] - tp[2]) || 1;
    const jx = tp[0] - 0.12 * (pp[0] - tp[0]) / L, jy = tp[1] - 0.12 * (pp[1] - tp[1]) / L, jz = tp[2] - 0.12 * (pp[2] - tp[2]) / L;
    _gc.copy(V(jx, jy, jz));
    const mx = xAt(jz), rr = (R.round ? 1 : 1.25) * R.r;
    // the jaws: two horns from the gaff's end round either side of the mast
    for (const k of [0, 1]) placeRod(G.jaws[k], _gc, _gd.copy(V(mx + rr * 0.3, (k ? 1 : -1) * (R.r + 0.03), jz + 0.02)));
    // the throat halyard: from the jaws up to its block under the lower masthead
    const zb = Math.max(jz + 0.4, G.low - 0.25), xb = xAt(zb) - rr - 0.06;
    _ge.copy(V(xb, 0, zb)); placeRod(G.throatHal, _gc, _ge); placeRod(G.blocks[0], _ge, _gf.copy(V(xb, 0, zb + 0.22)));
    // the peak halyard: from its block on the mast above, in two spans to the bridles on the gaff
    const zp = Math.max(zb + 0.3, G.low - 0.05), xp = xAt(zp) - rr - 0.06;
    _gf.copy(V(xp, 0, zp));
    for (const [k, f] of [[0, 0.42], [1, 0.82]]) placeRod(G.peakHal[k], _gf, _gg.copy(V(tp[0] + (pp[0] - tp[0]) * f, tp[1] + (pp[1] - tp[1]) * f, tp[2] + (pp[2] - tp[2]) * f + 0.04)));
    placeRod(G.blocks[1], _gf, _gh.copy(V(xp, 0, zp + 0.22)));
  }
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

// a lens window's upper edge, 0..1 of its height, at f (0 its aft end .. 1 its forward end): pointed aft, rounded forward
export function lensArch(w, f) {
  const pk = w.peak ?? 0.6; f = clamp(f, 0, 1);
  return f < pk ? Math.sin(Math.PI / 2 * f / pk) ** (w.pinch ?? 0.7) : Math.cos(Math.PI / 2 * (f - pk) / (1 - pk)) ** 0.35;
}
// the twin rudders' stock heads: inside the counter, a little under the deck (no tiller: the wheels steer them)
function top0Twin(Lx, tAt, Rd) { return Lx.sheer(tAt(Rd.x)) - 0.6; }

// ------------------------------------------------------------------ geometry helpers
// a disc re-cut into rings (a CircleGeometry is a fan from its centre: laid onto a curved surface its long spokes cut
// through the curve), so it can bend with the surface it is laid on
function subdivDisc(g, rings = 5) {
  const p = g.attributes.position, n = p.count - 1, pos = [], idx = [];
  pos.push(0, 0, 0);
  for (let r = 1; r <= rings; r++) for (let i = 0; i < n; i++) pos.push(p.getX(i + 1) * r / rings, p.getY(i + 1) * r / rings, 0);
  const seg = n - 1;             // (the last rim point repeats the first)
  for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + i + 1);
  for (let r = 1; r < rings; r++) for (let i = 0; i < seg; i++) {
    const a = 1 + (r - 1) * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setIndex(idx);
  return o;
}
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
  // the side's half-breadth at (x, z), as the shell above is drawn: a port is laid onto it, following its lean and,
  // where the house narrows, its angle in plan
  const sideY = (x, z) => {
    const w = Math.max(0.02, hw(x)), H = ht(x), zd = deckH0(x, w * 0.98) - 0.02, zr = Math.max(zd + 0.005, deckH0(x, 0) + H);
    return w - slope * clamp(H / 0.4, 0, 1) * clamp((z - zd) / (zr - zd), 0, 1);
  };
  for (const wdef of h.windows || []) {
    if (wdef.kind === 'port') {
      for (let k = 0; k < wdef.n; k++) {
        const x = lerp(bx(wdef.t0), bx(wdef.t1), wdef.n > 1 ? k / (wdef.n - 1) : 0.5), p = sideAt(x, wdef.zf ?? 0.5), r = wdef.r ?? 0.07;
        for (const s of [-1, 1]) {
          kit.add(wdef.mat === 'bronze' ? M.bronze() : M.steel(), onSide(new THREE.TorusGeometry(r, r * 0.2, 8, 20), x, p.z, s, sideY, 0.006));
          kit.add(M.glass(), onSide(new THREE.CircleGeometry(r * 0.92, 18), x, p.z, s, sideY, 0.008));
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
    } else if (wdef.kind === 'lens') {
      // a long smoked window shaped like a lens (a superyacht saloon's): its lower edge straight along the side at
      // zf0 of the side's height, its upper edge an arch up to zf0 + hf at peak (0 aft .. 1 forward along it), the
      // ends drawn in to a point aft (pinch) and rounded forward
      for (const s of [-1, 1]) {
        // (g0, g1: the whole window's extent when part of it runs on aft beyond the house, js/boats/detailed.js lensArch)
        const NW = 24, pos2 = [], idx2 = [], xa = bx(wdef.t0), xb = bx(wdef.t1), f0 = wdef.zf0 ?? 0.22, hf = wdef.hf ?? 0.6;
        for (let i = 0; i <= NW; i++) {
          const f = i / NW, t = lerp(wdef.t0, wdef.t1, f), x = lerp(xa, xb, f), arch = lensArch(wdef, (t - (wdef.g0 ?? wdef.t0)) / ((wdef.g1 ?? wdef.t1) - (wdef.g0 ?? wdef.t0)));
          const lo = sideAt(x, f0), hi = sideAt(x, f0 + Math.max(0.004, hf * arch));
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
  // bridge deck / traveller thwart: a solid step up from the sole, across the well into its sides
  if (ckD.thwart) { const th = (ckD.thwartH ?? 0.4) + 0.04; kit.box(paint(ckD.color ?? 0xf0eee6, 0.4), 2 * (ck.w + 0.09) * Lx.bDeck(ckD.thwart), th, 0.3, V(bx(ckD.thwart), 0, ck.sole + th / 2)); }
  if (ckD.table) kit.box(M.varnish(), 0.36, 0.5, 0.9, V(bx(ckD.table), 0, ck.sole + 0.25));    // (the table's pedestal case, on the sole)
}

function buildLifelines(kit, C, Lx, L, deckH, bx) {
  const tA = L.t0 ?? 0.06, tB = L.t1 ?? 0.86, H = L.h ?? 0.62;
  const n = Math.max(2, Math.round((bx(tB) - bx(tA)) / (L.spacing ?? 1.0)));
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = lerp(tA, tB, i / n), x = bx(t), y = s * Lx.bDeck(t) * 0.93, z = deckH(x, y);
      const top = V(x, y * 1.02, z + H);
      kit.rod(L.mat === 'black' ? M.black() : L.mat === 'bronze' ? M.bronze() : M.steel(), V(x, y, z), top, L.rail ? 0.016 : 0.012);
      kit.box(M.steel(), 0.05, 0.012, 0.06, V(x, y, z + 0.006));
      pts.push(top);
    }
    const xs = C.sternX + (L.pushX ?? 0.2), ys = s * Lx.bDeck(0.02) * 0.85;
    const xb = C.bowX - (L.pulpX ?? 0.35), yb = s * Lx.bDeck(clamp((xb - C.sternX) / (C.bowX - C.sternX), 0, 1)) * 0.8;
    if (L.pushpit !== false) kit.rod(M.steel(), V(xs, ys, deckH(xs, ys)), V(xs, ys, deckH(xs, ys) + H + 0.03), 0.014);
    if (L.pulpit !== false) kit.rod(M.steel(), V(xb, yb, deckH(xb, yb)), V(xb, yb, deckH(xb, yb) + H), 0.014);
    // (a varnished teak rail on the stanchions, a big classic's, in place of the top wire)
    if (L.rail === 'teak') { kit.add(M.varnish(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.slice().reverse()), pts.length * 3, 0.035, 6)); continue; }
    for (const h of L.wires === 1 ? [0] : [0, -H * 0.48]) {
      const line = [L.pulpit !== false ? V(xb, yb, deckH(xb, yb) + H + h) : null, ...pts.slice().reverse().map(p => p.clone().setY(p.y + h)), L.pushpit !== false ? V(xs, ys, deckH(xs, ys) + H + 0.03 + h) : null].filter(Boolean);
      kit.add(M.wire(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line), line.length * 3, 0.0035, 4));
    }
  }
  if (L.pushpit !== false) {
    // (its ends on the posts at the deck's edge: on a big crowned deck the edge is well below the centreline)
    const xs = C.sternX + (L.pushX ?? 0.2), yw = Lx.bDeck(0.02) * 0.85, ze = (s) => deckH(xs, s * yw) + H + 0.03, zs = Math.max(ze(-1), ze(1));
    kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xs, -yw, ze(-1)), V(xs - 0.05, 0, zs + 0.02), V(xs, yw, ze(1))]), 12, 0.014, 6));
  }
  if (L.pulpit !== false) {
    const xb = C.bowX - (L.pulpX ?? 0.35), yb = Lx.bDeck(clamp((xb - C.sternX) / (C.bowX - C.sternX), 0, 1)) * 0.8, zo = (s) => deckH(xb, s * yb) + H, zb = Math.max(zo(-1), zo(1));
    kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(xb, -yb, zo(-1)), V(C.bowX - 0.05, 0, zb + 0.03), V(xb, yb, zo(1))]), 12, 0.014, 6));
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
  // a wind-vane self-steering gear (Hasler's servo-pendulum type) on a frame over the stern: the vane on its staff, the
  // pendulum oar into the water, and the lines from it to the tiller
  vaneGear({ C, Lx, kit, deckAt }) {
    const x = C.sternX, z = Lx.sheer(0) + 0.05;
    // (its frame's feet on the deck of the counter)
    for (const sd of [-1, 1]) kit.rod(M.steel(), V(x + 0.35, sd * 0.25, deckAt(x + 0.35, sd * 0.25) - 0.01), V(x - 0.4, 0, z + 0.3), 0.022);
    kit.rod(M.steel(), V(x + 0.25, 0, deckAt(x + 0.25, 0) - 0.01), V(x - 0.4, 0, z + 0.3), 0.022);
    kit.rod(M.steel(), V(x - 0.4, 0, z + 0.3), V(x - 0.4, 0, z + 0.95), 0.025);
    kit.box(paint(0xe8e2d0, 0.6), 0.015, 0.75, 0.35, V(x - 0.4, 0, z + 1.3));                    // the vane
    kit.rod(M.steel(), V(x - 0.4, 0, z + 0.3), V(x - 0.55, 0, -0.9), 0.03);                     // the pendulum oar's shaft
    kit.box(paint(0xe8e2d0, 0.5), 0.04, 0.6, 0.22, V(x - 0.56, 0, -0.75));                      // its blade
  },
  // a 12 Metre's coffee grinders: two pedestals on the cockpit sole between the primaries, each with its pair of
  // crank handles (the drive runs under the deck to the winches)
  grinders({ C, Lx, kit, bx, ck }) {
    for (const t of [0.33, 0.37]) {
      const x = bx(t), z = ck.sole;
      kit.add(M.alu(), lathe([[0.12, 0], [0.1, 0.06], [0.07, 0.15], [0.065, 0.78], [0.09, 0.84], [0, 0.86]], 12), new THREE.Matrix4().makeTranslation(0, z, -x));
      kit.rod(M.black(), V(x, -0.2, z + 0.82), V(x, 0.2, z + 0.82), 0.025);
      for (const sd of [-1, 1]) { kit.rod(M.black(), V(x, sd * 0.2, z + 0.82), V(x, sd * 0.2, z + 1.05), 0.018); kit.rod(M.black(), V(x, sd * 0.2, z + 1.05), V(x, sd * 0.32, z + 1.05), 0.02); }
    }
  },
  // a big gaff rig's deck: the windlass on the foredeck, and at the foot of every mast its fife rail (a rail on two
  // posts across the mast's after side, its belaying pins through it), where the halyards are made fast
  schoonerDeck({ C, D, Lx, kit, bx, deckH0, boat }) {
    const k = clamp(C.beam / 7, 0.6, 1.3);
    const wx = C.bowX - 2.2 * k, wz = deckH0(wx, 0);
    kit.rod(wood(0x7a5a3a), V(wx, -0.6 * k, wz + 0.4 * k), V(wx, 0.6 * k, wz + 0.4 * k), 0.16 * k, 12);          // windlass barrel
    for (const sd of [-1, 1]) kit.box(wood(0x7a5a3a), 0.16 * k, 0.6 * k, 0.5 * k, V(wx, sd * 0.68 * k, wz + 0.3 * k));
    for (const mk of mastKeys(boat)) {
      const R = mastSpec(C, D, mk), x0 = mk === 'main' ? C.mastX : R.x, xr = x0 - R.r - 0.45 * k, z0 = deckH0(xr, 0), w = 0.75 * k;
      for (const sd of [-1, 1]) kit.box(wood(0x7a5a3a), 0.1, 0.66, 0.1, V(xr, sd * w, z0 + 0.32));                // posts
      kit.box(wood(0x7a5a3a), 2 * w + 0.14, 0.09, 0.12, V(xr, 0, z0 + 0.62));                                    // the rail
      for (let i = 0; i < 7; i++) kit.rod(M.bronze(), V(xr, -w + 0.1 + i * (2 * w - 0.2) / 6, z0 + 0.5), V(xr, -w + 0.1 + i * (2 * w - 0.2) / 6, z0 + 0.8), 0.016);
    }
  },
  // the Oceanis' mainsheet arch over the cockpit's forward end (the German-style mainsheet runs from its top)
  arch({ C, Lx, kit, bx, deckH0, ck, deckAt }) {
    const x = bx(ck.t1) - 0.25, y = Lx.bDeck(ck.t1) * 0.78, z0 = deckAt(x + 0.05, y) - 0.01, top = z0 + 1.35;   // (its feet on the deck mesh)
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
  sprayDetails({ C, D, Lx, kit, bx, deckH0 }) {
    const wx = C.bowX - 1.0, wz = deckH0(wx, 0);
    kit.rod(wood(0x8a6a44), V(wx, -0.45, wz + 0.25), V(wx, 0.45, wz + 0.25), 0.1, 12);          // windlass barrel
    for (const s of [-1, 1]) kit.box(wood(0x8a6a44), 0.1, 0.4, 0.3, V(wx, s * 0.5, wz + 0.2));
    // the brace: from the bulwark's cap either side, round the jigger mast's aft face
    const mx = C.sails.find(s => s.key === 'mizzen');
    if (mx) {
      const xm = mx.tackX + 0.02, t = (xm - C.sternX) / (C.bowX - C.sternX), yb = Lx.bDeck(t) * 0.985, zc = Lx.sheer(t) + (D.toerail?.bulwark ?? 0.3), Rm = mastSpec(C, D, 'mizzen').r;
      const pts = []; for (let i = 0; i <= 10; i++) { const a = Math.PI * i / 10; pts.push(V(xm - (Rm + 0.03) * Math.sin(a), yb * Math.cos(a), zc)); }
      kit.add(M.steel(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.02, 6));
    }
    // the pin rail across the mast's aft face, its belaying pins through it
    const R = mastSpec(C, D, 'main'), px = C.mastX - R.r * (R.round ? 1 : 1.25) - 0.035;
    kit.box(wood(0x8a6a44), 0.9, 0.06, 0.08, V(px, 0, deckH0(C.mastX, 0) + 0.7));
    for (let i = 0; i < 6; i++) kit.rod(wood(0x6a5030), V(px, -0.38 + i * 0.15, deckH0(C.mastX, 0) + 0.62), V(px, -0.38 + i * 0.15, deckH0(C.mastX, 0) + 0.85), 0.012);
  },
  // Joshua: the wind-vane self-steering gear on its frame over the canoe stern, the two small observation domes
  // (clear, black-framed) she steers from under, the black hawse eyes in the bows
  joshuaDetails({ C, Lx, kit, deckH0, bx, tAt }) {
    for (const t of [0.36, 0.44]) {
      const x = bx(t), z = deckH0(x, 0) + 0.42;
      const d = new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); d.translate(0, z, -x); kit.add(glassT(), d);
      kit.add(M.black(), new THREE.CylinderGeometry(0.33, 0.35, 0.1, 18), new THREE.Matrix4().makeTranslation(0, z - 0.03, -x));
    }
    // (laid onto the bow's topsides, which curve in toward the stem over the patch's length)
    const topsides = (x, z) => hullHalfBreadth(Lx, tAt(x), z);
    for (const s of [-1, 1]) {
      const t = 0.83, x = bx(t), zz = Lx.sheer(t) - 0.42;
      const el = new THREE.CircleGeometry(0.38, 24, 0, Math.PI * 2); el.scale(1, 0.62, 1); kit.add(M.black(), onSide(subdivDisc(el), x, zz, s, topsides, 0.006));
      kit.add(paint(0xf2f0ea, 0.4), onSide(new THREE.CircleGeometry(0.1, 16), x + 0.12, zz + 0.02, s, topsides, 0.009));
    }
    const x = C.sternX, z = Lx.sheer(0) + 0.05;
    kit.rod(M.steel(), V(x + 0.35, 0.35, z), V(x - 0.45, 0, z + 0.25), 0.02); kit.rod(M.steel(), V(x + 0.35, -0.35, z), V(x - 0.45, 0, z + 0.25), 0.02);
    kit.rod(M.steel(), V(x - 0.45, 0, z + 0.25), V(x - 0.45, 0, z + 1.0), 0.025);
    kit.box(paint(0xe8e2d0, 0.6), 0.02, 0.7, 0.35, V(x - 0.45, 0, z + 1.3));                    // the vane, on the staff's head
    kit.rod(M.steel(), V(x - 0.45, 0, z + 0.25), V(x - 0.1, 0, -0.9), 0.02);                  // the servo linkage to the rudder
  },
  // Swan 131 Aristarchos (photographs: the profile under sail, the aerials at anchor, the aft deck and helms): the white
  // wing coamings that sweep aft from the saloon's sides round the guest cockpit and the helms, the cockpit's U-sofas
  // and teak table, the two helm consoles and the centre console, the two big hydraulic deck winches on the aft deck,
  // the flush hatches in the foredeck, the inner forestay with its furled staysail on a Reckmann drum, the jib's
  // furler drum at the stemhead, the radar on its bracket on the mast's front, the anchor in the stemhead, the carbon
  // swim platform folded up into the transom
  swan131({ C, D, Lx, kit, bx, tAt, deckH0, deckAt, ck, stations }) {
    const white = paint(0xf3f2ee, 0.3), cushion = paint(0xe4e3de, 0.85), dark = paint(0x22262b, 0.35, 0.2);
    // a solid wall swept along a path (physics coords: { x, y (its middle), h above its foot, w its thickness, z0 its
    // foot }): outer face, rounded top, inner face, closed ends
    const wall = (mat, P) => {
      const pos = [], idx = [], ring = (p) => { const s = Math.sign(p.y) || 1, yo = p.y + s * p.w / 2, yi = p.y - s * p.w / 2, r = Math.min(p.w / 2, p.h / 2);
        return [[p.x, yo, p.z0], [p.x, yo, p.z0 + p.h - r], [p.x, (yo + p.y) / 2 + s * r * 0.15, p.z0 + p.h - r * 0.15], [p.x, p.y, p.z0 + p.h], [p.x, (yi + p.y) / 2 - s * r * 0.15, p.z0 + p.h - r * 0.15], [p.x, yi, p.z0 + p.h - r], [p.x, yi, p.z0]]; };
      const R = P.map(ring), n = R[0].length;
      for (const r of R) for (const q of r) { const v = V(...q); pos.push(v.x, v.y, v.z); }
      for (let i = 0; i < R.length - 1; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      for (const [i, fl] of [[0, false], [R.length - 1, true]]) for (let j = 1; j < n - 1; j++) { const a = i * n; fl ? idx.push(a, a + j + 1, a + j) : idx.push(a, a + j, a + j + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      kit.add(mat, g);
    };
    // ---- the wing coamings: from the saloon's aft corners (their tops at its roof) aft and down, flaring outboard of
    // the wheels, dying into the deck abreast the aft deck
    // (they carry the saloon's sides on aft round the guest cockpit at its roof's height, then sweep down past the wheels:
    // the photographs' white wings, the long window ending where they begin)
    const wing = [[0.4035, 2.66, 1.0], [0.37, 2.67, 0.98], [0.34, 2.7, 0.93], [0.315, 2.73, 0.86], [0.28, 2.83, 0.64], [0.245, 2.95, 0.43], [0.21, 3.06, 0.26], [0.175, 3.15, 0.12], [0.15, 3.2, 0.03]];
    const wingAt = (sd) => wing.map(([t, y, h]) => { const x = bx(t), yy = sd * Math.min(y, Lx.bDeck(t) - 0.5); return { x, y: yy, h: h + 0.03, w: 0.32, z0: Math.min(deckH0(x, yy - sd * 0.16), deckH0(x, yy + sd * 0.16)) - 0.03 }; });
    for (const sd of [-1, 1]) wall(white, wingAt(sd));
    // the saloon's lens window runs on aft along the wing's outer face to its point (the house's window: D.cabins[0])
    const LW = D.cabins[0].windows.find((w) => w.kind === 'lens');
    if (LW && LW.g0 < D.cabins[0].t0) for (const sd of [-1, 1]) {
      const W = wingAt(sd), NW = 14, pos = [], idx = [], ta = LW.g0, tb = D.cabins[0].t0 + 0.0015, H = W[0].h - 0.03;
      const at = (x) => { for (let i = 0; i < W.length - 1; i++) { const a = W[i], b = W[i + 1]; if ((a.x - x) * (b.x - x) <= 0) { const f = (x - a.x) / (b.x - a.x || 1); return { y: a.y + (b.y - a.y) * f }; } } return W[0]; };
      for (let i = 0; i <= NW; i++) {
        const t = lerp(ta, tb, i / NW), x = bx(t), p = at(x), yo = p.y + sd * (0.16 + 0.006), base = deckH0(x, sd * 2.7);
        const fg = (t - LW.g0) / (LW.g1 - LW.g0), lo = base + LW.zf0 * H, hi = base + (LW.zf0 + Math.max(0.004, LW.hf * lensArch(LW, fg))) * H;
        pos.push(...V(x, yo, lo).toArray(), ...V(x, yo, hi).toArray());
      }
      for (let i = 0; i < NW; i++) { const a = 2 * i; sd > 0 ? idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3) : idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); kit.add(glassT(), g);
    }
    // ---- the guest cockpit: U-sofas round the teak table (the sole ck.sole, the well's sides at ck.w of the half-breadth)
    const xa = bx(ck.t0) + 0.25, xf = bx(ck.t1) - 0.05, xm = (xa + xf) / 2, cw = ck.w * Lx.bDeck((ck.t0 + ck.t1) / 2), sz = ck.sole;
    for (const sd of [-1, 1]) {
      kit.box(white, 0.62, 0.4, xf - xa - 0.7, V(xm - 0.35, sd * (cw - 0.36), sz + 0.2));
      kit.box(cushion, 0.58, 0.1, xf - xa - 0.75, V(xm - 0.35, sd * (cw - 0.36), sz + 0.45));
      kit.box(cushion, 0.14, 0.42, xf - xa - 0.75, V(xm - 0.35, sd * (cw - 0.1), sz + 0.68));
    }
    kit.box(white, 2 * cw - 0.1, 0.4, 0.62, V(xf - 0.36, 0, sz + 0.2));
    kit.box(cushion, 2 * cw - 0.2, 0.1, 0.58, V(xf - 0.36, 0, sz + 0.45));
    const xt = bx(D.cockpit.table);
    kit.box(M.teak(), 1.1, 0.05, 2.5, V(xt, 0, sz + 0.75));                      // the table's top, on the pedestal (buildCockpit)
    kit.box(M.varnish(), 0.36, 0.25, 0.9, V(xt, 0, sz + 0.6));
    // ---- the helm consoles (white, the instruments under a sloping dark panel) ahead of each wheel, the wheel's shaft
    // into it; the centre console between them
    const ST = D.steering, wx = ST.x, hubDz = ST.hub;
    for (const sd of [-1, 1]) {
      const y = sd * ST.y, z0 = deckH0(wx + 0.75, y) - 0.02, cx = wx + 0.75;
      kit.box(white, 0.75, 1.05, 0.7, V(cx, y, z0 + 0.525));
      kit.box(dark, 0.68, 0.04, 0.5, V(cx - 0.05, y, z0 + 1.08), 0, -0.45);
      kit.rod(M.steel(), V(wx + 0.02, y, deckH0(wx, y) + hubDz), V(cx - 0.33, y, deckH0(wx, y) + hubDz), 0.04, 12);
    }
    { const cx = wx + 0.55, z0 = deckH0(cx, 0) - 0.02; kit.box(white, 0.9, 0.9, 0.8, V(cx, 0, z0 + 0.45)); kit.box(dark, 0.8, 0.04, 0.6, V(cx - 0.02, 0, z0 + 0.92), 0, -0.3); }
    // ---- the two hydraulic deck winches on the aft deck (Lewmar, [NJ]; the photographs: big chromed drums near the rail)
    for (const sd of [-1, 1]) {
      const x = C.sternX + 4.3, y = sd * Math.min(2.95, Lx.bDeck(tAt(x)) - 0.6), z = deckAt(x, y) - 0.01, r = 0.21;
      kit.add(M.steel(), lathe([[r * 1.35, 0], [r * 1.35, 0.03], [r * 1.05, 0.05], [r * 0.93, 0.14], [r * 0.97, 0.3], [r * 1.12, 0.34], [r * 1.12, 0.4], [r * 0.55, 0.43], [0, 0.43]], 28), new THREE.Matrix4().makeTranslation(y, z, -x));
    }
    // ---- flush hatches in the foredeck: a low alloy frame, smoked glass (the aerials: along the centreline and beside it)
    for (const [t, y, w, l] of [[0.6, 1.9, 0.55, 0.55], [0.64, 0, 0.95, 0.95], [0.7, 1.55, 0.6, 0.6], [0.74, 0, 0.9, 0.9], [0.8, 1.2, 0.55, 0.55], [0.84, 0, 0.8, 0.8], [0.9, 0, 0.65, 0.65]])
      for (const sd of y ? [-1, 1] : [1]) {
        const x = bx(t), yy = sd * y, z = Math.max(deckAt(x - l / 2, yy), deckAt(x + l / 2, yy), deckAt(x, yy - w / 2), deckAt(x, yy + w / 2));
        kit.box(M.alu(), w + 0.06, 0.035, l + 0.06, V(x, yy, z + 0.005));
        kit.box(glassT(), w, 0.012, l, V(x, yy, z + 0.026));
      }
    // ---- the inner forestay (its tack 4.6 m aft of the stem, its head at the runners' height on the mast), the staysail
    // furled round it on its Reckmann drum; the jib's drum at the stemhead
    const mastFront = C.mastX + (D.masts.main.r ?? C.mastR) * 1.25, ix = C.bowX - 4.6, iz = deckAt(ix, 0), topZ = D.runners.z;
    const drumR = 0.26, sx = ix, top = V(mastFront - 0.02, 0, topZ), foot = V(sx, 0, iz + 0.42);
    kit.add(M.alu(), new THREE.CylinderGeometry(drumR, drumR * 1.1, 0.42, 20), new THREE.Matrix4().makeTranslation(0, iz + 0.21, -sx));
    kit.rod(M.wire(), foot, top, 0.022, 8);
    const dir = top.clone().sub(foot).normalize(), f0 = foot.clone().addScaledVector(dir, 0.15), f1 = top.clone().addScaledVector(dir, -1.6);
    kit.rod(mat('swan-stay', () => new THREE.MeshStandardMaterial({ color: 0x1f2a3d, roughness: 0.8 })), f0, f1, 0.13, 12, 0.08);   // (rolled up under its navy UV strip)
    const J = C.sails.find((s) => s.key === 'jib'), jz = deckAt(J.tackX, 0);
    kit.add(M.alu(), new THREE.CylinderGeometry(0.24, 0.27, J.tackZ - jz + 0.02, 20), new THREE.Matrix4().makeTranslation(0, (J.tackZ + jz) / 2, -J.tackX));
    // ---- the radar on its bracket on the mast's front, a third of the way up
    { const z = deckH0(C.mastX, 0) + 15.6, x0 = mastFront - 0.05;
      kit.rod(white, V(x0, 0, z), V(x0 + 0.85, 0, z), 0.06, 10);
      kit.rod(white, V(x0, 0, z - 0.6), V(x0 + 0.75, 0, z - 0.04), 0.035, 8);
      const dome = new THREE.SphereGeometry(0.42, 20, 12); dome.scale(1, 0.75, 1); dome.translate(0, z + 0.28, -(x0 + 0.95)); kit.add(white, dome);
      kit.add(white, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), new THREE.Matrix4().makeTranslation(0, z + 0.05, -(x0 + 0.95))); }
    // ---- the anchor stowed in the stemhead: its shank up the stem's fitting, the flukes against the stem
    { const x = C.bowX - 0.15, z = Lx.sheer(1) - 0.05;
      kit.box(M.steel(), 0.32, 0.18, 1.3, V(x - 0.45, 0, deckAt(x - 0.45, 0) + 0.09));             // the stemhead fitting
      const crown = V(x + 0.32, 0, z - 0.45);
      kit.rod(M.steel(), V(x - 0.6, 0, z + 0.06), crown, 0.05, 10);
      kit.box(M.steel(), 0.7, 0.06, 0.4, crown.clone(), 0, 0.5); }      // (the flukes across the shank's crown)
    // ---- the swim platform folded up into the transom: its outline (a thin seam) on the transom's lower face
    { const st = stations[0], pts = st.filter((p) => p[2] > 0.5 && p[2] < st[0][2] - 0.2);
      if (pts.length > 1) for (const sd of [-1, 1]) kit.add(M.black(), new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x - 0.01, sd * y * 0.84, z))), 12, 0.012, 4));
      const lo = pts[pts.length - 1], hi = pts[0];
      if (lo && hi) for (const p of [lo, hi]) kit.rod(M.black(), V(p[0] - 0.01, -p[1] * 0.84, p[2]), V(p[0] - 0.01, p[1] * 0.84, p[2]), 0.012, 4); }
  },
};
