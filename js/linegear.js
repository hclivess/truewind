// Line-holding hardware you can see work (the physics of each is in js/linehandlers.js), and the braided rope
// textures. Every part is built in its own frame: y up off the surface it is bolted to, the line running along z
// from the load (-z) to the tail (+z); userData.set(state) moves it (cams open, clutch lever up, ratchet pawl
// on, turns on a horn cleat as it is made fast), userData.throat(free) is where the line lies in it.
import * as THREE from 'three';

// ------------------------------------------------------------------ braided rope textures (shared, cached)
// a 16-carrier braid: two sets of strands winding opposite ways; 'fleck' puts a few carriers of the second
// colour in (short helical flecks), 'tracer' one pair (a single helix stripe), 'solid' none. One repeat is
// one turn of the braid round the rope (the tube's u) over 6 cm of its length (v).
const ropeTex = new Map();
export function ropeTexture(look) {
  const key = `${look.base}|${look.fleck}|${look.pattern}`;
  if (ropeTex.has(key)) return ropeTex.get(key);
  const W = 32, H = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = look.base; g.fillRect(0, 0, W, H);
  // a strand: a helix across the whole circumference over half the repeat, drawn wrapped round the edges
  const strand = (y0, dir, col, w, dash) => {
    g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []);
    for (const oy of [-H, 0, H]) for (const ox of [-W, 0, W]) { g.beginPath(); g.moveTo(ox, y0 + oy); g.lineTo(ox + W, y0 + oy + dir * H / 2); g.stroke(); }
    g.setLineDash([]);
  };
  for (let i = 0; i < 8; i++) { strand(i * 8, 1, 'rgba(0,0,0,0.20)', 1.6); strand(i * 8 + 4, -1, 'rgba(0,0,0,0.12)', 1.6); }
  for (let i = 0; i < 8; i++) { strand(i * 8 + 2, 1, 'rgba(255,255,255,0.10)', 1); }
  if (look.pattern === 'fleck') { for (const y of [0, 32]) strand(y + 1, 1, look.fleck, 3.2, [7, 9]); strand(20, -1, look.fleck, 3.2, [6, 12]); }
  else if (look.pattern === 'tracer') { strand(2, 1, look.fleck, 3.4); strand(6, 1, look.fleck, 3.4); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  ropeTex.set(key, t);
  return t;
}
// a CSS swatch of the same rope (the panel's line labels)
export const ropeCSS = (look) => look.pattern === 'solid' ? look.base
  : `repeating-linear-gradient(115deg, ${look.base} 0 ${look.pattern === 'tracer' ? 5 : 3}px, ${look.fleck} ${look.pattern === 'tracer' ? 5 : 3}px ${look.pattern === 'tracer' ? 7 : 5}px, ${look.base} ${look.pattern === 'tracer' ? 7 : 5}px 9px)`;

// ------------------------------------------------------------------ materials
const MC = {};
const mat = (k, make) => MC[k] || (MC[k] = make());
const mAlu = () => mat('alu', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.32, metalness: 0.75 }));
const mDark = () => mat('dark', () => new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 0.55, metalness: 0.25 }));
const mCarbo = () => mat('carbo', () => new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.35, metalness: 0.2 }));
const mSS = () => mat('ss', () => new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.16, metalness: 0.95 }));
const mBronze = () => mat('bz', () => new THREE.MeshStandardMaterial({ color: 0xb58a50, roughness: 0.3, metalness: 0.85 }));
const mRed = () => mat('red', () => new THREE.MeshStandardMaterial({ color: 0xd8342a, roughness: 0.4, emissive: 0x3a0806 }));
const mBand = () => new THREE.MeshStandardMaterial({ color: 0xe0413a, emissive: 0xe0413a, emissiveIntensity: 0.6 });
const add = (g, geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
// a rounded rectangle plate (x by z, t thick), sitting on y = 0
function plate(w, l, t, r) {
  const s = new THREE.Shape(), a = w / 2, b = l / 2;
  s.moveTo(-a + r, -b); s.lineTo(a - r, -b); s.quadraticCurveTo(a, -b, a, -b + r); s.lineTo(a, b - r); s.quadraticCurveTo(a, b, a - r, b);
  s.lineTo(-a + r, b); s.quadraticCurveTo(-a, b, -a, b - r); s.lineTo(-a, -b + r); s.quadraticCurveTo(-a, -b, -a + r, -b);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: t * 0.25, bevelSize: Math.min(r, t) * 0.4, bevelSegments: 2, curveSegments: 4 });
  g.rotateX(-Math.PI / 2); g.translate(0, t * 0.25, 0);   // extruded along +y, from the surface up
  return g;
}
// a toothed disc (a cam lobe, a ratchet wheel) in the xz plane, h high
function toothed(r, teeth, depth, h, off = 0) {
  const s = new THREE.Shape(), n = teeth * 2;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2, rr = i % 2 ? r - depth : r;
    const x = off + Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i) s.lineTo(x, y); else s.moveTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}
// the red band shown round a released handler (a panel/deck cue; flashes while a line slips)
function band(g, r, y) {
  const b = add(g, new THREE.TorusGeometry(r, 0.0035, 6, 20), mBand(), 0, y, 0);
  b.rotation.x = Math.PI / 2; b.visible = false; b.castShadow = false;
  return b;
}
function common(g, bandObj) {
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.band = bandObj;
  g.userData.cue = (st, t) => { const on = st.s === 'free' || st.slip; bandObj.visible = on; if (on) bandObj.material.emissiveIntensity = st.slip ? 0.4 + 0.6 * (Math.sin(t * 25) > 0) : 0.6; if (on) bandObj.material.emissive.setHex(st.slip ? 0xffa21a : 0xe0413a); };
}

// ------------------------------------------------------------------ cam cleat (Harken Cam-Matic 150 / 468)
// two sprung aluminium cams with teeth all round on pivot posts, a base, a raised fairlead on the tail side
export function makeCam(size = 'std', opts = {}) {
  const k = (size === 'micro' ? 0.68 : size === 'big' ? 1.35 : 1) * 1.25, g = new THREE.Group();
  add(g, plate(0.036 * k, 0.062 * k, 0.005 * k, 0.008 * k), opts.base || mCarbo());
  for (const z of [-0.024, 0.024]) add(g, new THREE.CylinderGeometry(0.0035 * k, 0.0035 * k, 0.0015, 10), mSS(), 0, 0.0065 * k + 0.0008, z * k);
  const cams = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.0115 * k, 0.0065 * k, 0.002 * k); g.add(piv);
    add(piv, new THREE.CylinderGeometry(0.0024 * k, 0.0024 * k, 0.016 * k, 10), mSS(), 0, 0.008 * k, 0);
    // the lobe: eccentric, toothed all round, its working face toward the line
    const lobe = add(piv, toothed(0.0088 * k, 14, 0.0011 * k, 0.0125 * k, -s * 0.0016 * k), opts.cams || mAlu(), 0, 0.001 * k, 0);
    lobe.scale.x = 1;
    cams.push({ piv, s });
  }
  // wire fairlead arching over the line on the tail side (the line is pulled down into the jaws past it)
  const fl = add(g, new THREE.TorusGeometry(0.0085 * k, 0.0014 * k, 6, 14, Math.PI), mSS(), 0, 0.012 * k, 0.027 * k);
  for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(0.0014 * k, 0.0014 * k, 0.012 * k, 6), mSS(), s * 0.0085 * k, 0.006 * k, 0.027 * k);
  void fl;
  const bd = band(g, 0.026 * k, 0.004);
  common(g, bd);
  g.userData.throat = (free) => new THREE.Vector3(0, free ? 0.03 * k : 0.011 * k, 0);
  g.userData.set = (st, t) => {
    const open = st.s === 'free' ? 1 : st.s === 'releasing' || st.s === 'locking' ? 0.5 : 0;
    for (const { piv, s } of cams) piv.rotation.y = s * (0.55 * open + (st.slip ? 0.12 * Math.sin(t * 40) : 0));
    g.userData.cue(st, t);
  };
  g.userData.kind = 'cam'; g.userData.k = k;
  return g;
}

// ------------------------------------------------------------------ clam cleat (Clamcleat CL211): no moving parts
// a grey anodised block with a V channel whose walls carry diagonal ridges: the load pulls the line down the V
export function makeClam(size = 'std') {
  const k = (size === 'micro' ? 0.75 : 1) * 1.25, g = new THREE.Group(), m = mat('clam', () => new THREE.MeshStandardMaterial({ color: 0x8c9299, roughness: 0.45, metalness: 0.6 }));
  add(g, plate(0.03 * k, 0.058 * k, 0.004 * k, 0.006 * k), m);
  for (const s of [-1, 1]) {
    const w = add(g, new THREE.BoxGeometry(0.009 * k, 0.017 * k, 0.056 * k), m, s * 0.0085 * k, 0.012 * k, 0);
    w.rotation.z = s * 0.28;                                         // the walls lean out: a V
    for (let i = 0; i < 7; i++) {                                    // ridges sloping down toward the load
      const r = add(g, new THREE.BoxGeometry(0.0025 * k, 0.016 * k, 0.0022 * k), mDark(), s * 0.0042 * k, 0.012 * k, (-0.022 + i * 0.0072) * k);
      r.rotation.x = -0.6; r.rotation.z = s * 0.28;
    }
  }
  const bd = band(g, 0.024 * k, 0.004);
  common(g, bd);
  g.userData.throat = (free) => new THREE.Vector3(0, free ? 0.032 * k : 0.009 * k, 0);
  g.userData.set = (st, t) => g.userData.cue(st, t);
  g.userData.kind = 'clam'; g.userData.k = k;
  return g;
}

// ------------------------------------------------------------------ V-jammer: a toothed V narrowing toward the load
export function makeJam(bronze = false, ropeMat = null, ropeR = 0.006) {
  const k = 1.25, g = new THREE.Group(), m = bronze ? mBronze() : mSS();
  add(g, plate(0.05 * k, 0.085 * k, 0.005 * k, 0.01 * k), m);
  for (const s of [-1, 1]) {
    const j = add(g, new THREE.BoxGeometry(0.011 * k, 0.024 * k, 0.07 * k), m, s * 0.013 * k, 0.016 * k, 0.004 * k);
    j.rotation.y = s * 0.2;                                          // jaws converge toward -z
    for (let i = 0; i < 6; i++) { const z = (-0.024 + i * 0.009) * k, t = add(g, new THREE.BoxGeometry(0.003 * k, 0.02 * k, 0.003 * k), m, s * (0.0065 + (z / k + 0.03) * 0.2) * k, 0.016 * k, z); t.rotation.y = s * 0.2 + s * 0.7; }
  }
  // the turn taken round the base before the line is wedged
  const turn = add(g, new THREE.TorusGeometry(0.03 * k, ropeR, 6, 24), ropeMat || mDark(), 0, 0.009 * k, 0.012 * k);
  turn.rotation.x = Math.PI / 2; turn.scale.set(0.95, 1.35, 1); turn.visible = false;
  const bd = band(g, 0.034 * k, 0.004);
  common(g, bd);
  g.userData.throat = (free) => new THREE.Vector3(0, free ? 0.04 * k : 0.014 * k, -0.018 * k);
  g.userData.set = (st, t) => { turn.visible = st.s === 'locked' || (st.s === 'locking' && st.p > 0.4) || st.s === 'releasing'; g.userData.cue(st, t); };
  g.userData.ropeMat = (m2) => { turn.material = m2; };
  g.userData.kind = 'jam'; g.userData.k = k;
  return g;
}

// ------------------------------------------------------------------ horn cleat: a tapering spindle on two feet;
// made fast with a turn, figure-eights and a locking hitch, which appear as the crew puts them on
export function makeHorn(bronze = false, len = 0.15, ropeMat = null, ropeR = 0.006) {
  const g = new THREE.Group(), m = bronze ? mBronze() : mAlu(), h = 0.032, L = len;
  const prof = []; for (let i = 0; i <= 16; i++) { const y = -L / 2 + L * i / 16, u = y / (L / 2); prof.push(new THREE.Vector2(0.0045 + 0.0085 * Math.pow(Math.cos(u * Math.PI / 2), 0.6), y)); }
  prof[0].x = 0.0001; prof[16].x = 0.0001;
  const hg = new THREE.LatheGeometry(prof, 14); hg.rotateX(Math.PI / 2);
  const p = hg.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i), u = z / (L / 2); p.setY(i, p.getY(i) * (p.getY(i) < 0 ? 0.75 : 1) + 0.014 * u * u * u * u); }
  hg.computeVertexNormals();
  add(g, hg, m, 0, h, 0);
  for (const s of [-1, 1]) {
    add(g, new THREE.CylinderGeometry(0.0085, 0.012, h, 12), m, 0, h / 2, s * L * 0.2);
    const pad = add(g, new THREE.CylinderGeometry(0.016, 0.017, 0.004, 14), m, 0, 0.002, s * L * 0.2); pad.scale.x = 0.8;
  }
  // the turns: figure-eights over the middle, round each horn's end below it
  const wraps = [];
  const fig = (a, b, c, y0, lift) => {
    const pts = []; for (let i = 0; i < 40; i++) { const t = i / 40 * Math.PI * 2; pts.push(new THREE.Vector3(b * Math.sin(2 * t), y0 + c * Math.cos(2 * t) + lift, a * Math.sin(t))); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 80, ropeR, 5, true);
  };
  for (let i = 0; i < 4; i++) {
    const w = add(g, i === 0 ? new THREE.TorusGeometry(0.016, ropeR, 5, 20) : fig(L * (0.36 - i * 0.02), 0.016 + i * 0.002, 0.017, h, i * 0.004), ropeMat || mDark());
    if (i === 0) { w.rotation.x = Math.PI / 2; w.position.set(0, 0.012, L * 0.2); w.scale.set(1, 1.2, 1); }
    w.visible = false; wraps.push(w);
  }
  const hitch = add(g, new THREE.TorusGeometry(0.014, ropeR, 5, 18), ropeMat || mDark(), 0, h + 0.014, -L * 0.28); hitch.rotation.y = Math.PI / 2; hitch.rotation.x = 0.5; hitch.visible = false; wraps.push(hitch);
  const bd = band(g, 0.03, 0.004); bd.scale.set(1, 3, 1);
  common(g, bd);
  g.userData.throat = (free) => new THREE.Vector3(0, free ? h + 0.03 : 0.012, free ? -L * 0.3 : L * 0.2);
  g.userData.set = (st, t) => {
    const n = st.s === 'locked' ? 5 : st.s === 'locking' ? Math.floor(st.p * 5.2) : st.s === 'releasing' ? Math.ceil((1 - st.p) * 5) : 0;
    wraps.forEach((w, i) => { w.visible = i < n; });
    g.userData.cue(st, t);
  };
  g.userData.ropeMat = (m2) => { for (const w of wraps) w.material = m2; };
  g.userData.kind = 'horn';
  return g;
}

// ------------------------------------------------------------------ rope clutch (Spinlock XAS): body + lever
// lever down = closed; the lever swings up about its aft hinge to open; a label in the line's colour on the lever
export function makeClutch(labelCSS = '#ffffff') {
  const g = new THREE.Group(), k = 1.15;
  // a side profile (u along the line, v up) extruded across the clutch's width w
  const prof = (pts, w, bevel = 0.002) => {
    const s = new THREE.Shape(); pts.forEach(([u, v], i) => (i ? s.lineTo(u * k, v * k) : s.moveTo(u * k, v * k)));
    const ge = new THREE.ExtrudeGeometry(s, { depth: w * k - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
    ge.rotateY(-Math.PI / 2); ge.translate((w * k) / 2 - bevel, 0, 0);
    return ge;
  };
  add(g, plate(0.046 * k, 0.13 * k, 0.004 * k, 0.008 * k), mCarbo());
  // the body: low at the ends, humped over the cam (Spinlock XAS)
  add(g, prof([[-0.06, 0.004], [-0.06, 0.016], [-0.045, 0.026], [-0.02, 0.033], [0.01, 0.035], [0.04, 0.033], [0.058, 0.026], [0.06, 0.004]], 0.04), mDark());
  for (const z of [-0.061, 0.061]) { const hole = add(g, new THREE.CylinderGeometry(0.0075 * k, 0.0075 * k, 0.002, 12), mat('hole', () => new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 })), 0, 0.013 * k, z * k); hole.rotation.x = Math.PI / 2; }
  // the lever: hinged at the aft end, lying along the hump, its handle curling up at the front
  const hinge = new THREE.Group(); hinge.position.set(0, 0.036 * k, 0.045 * k); g.add(hinge);
  const lv = [[-0.108, 0.004], [-0.112, -0.002], [-0.1, -0.01], [-0.07, -0.006], [-0.035, 0.002], [0, 0.006], [0.012, 0.004], [0.012, -0.004], [0, -0.002], [-0.035, -0.006], [-0.07, -0.013], [-0.1, -0.018], [-0.117, -0.006], [-0.115, 0.007]];
  add(hinge, prof(lv, 0.032, 0.0015), mat('lever', () => new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.4, metalness: 0.3 })));
  const lab = add(hinge, new THREE.BoxGeometry(0.022 * k, 0.0015, 0.036 * k), new THREE.MeshStandardMaterial({ color: new THREE.Color(labelCSS), roughness: 0.5 }), 0, 0.0065 * k, -0.05 * k); void lab;
  add(g, new THREE.CylinderGeometry(0.0035 * k, 0.0035 * k, 0.044 * k, 8), mSS(), 0, 0.036 * k, 0.045 * k).rotation.z = Math.PI / 2;
  // under the lever, on the hump: a red flag that only shows with the lever up (open)
  add(g, new THREE.BoxGeometry(0.02 * k, 0.002, 0.05 * k), mRed(), 0, 0.0352 * k, -0.005 * k);
  const bd = band(g, 0.04 * k, 0.004); bd.scale.set(0.7, 1.7, 1);
  common(g, bd);
  g.userData.cue = (st, t) => { bd.visible = !!st.slip; if (st.slip) bd.material.emissiveIntensity = 0.4 + 0.6 * (Math.sin(t * 25) > 0); };
  g.userData.throat = () => new THREE.Vector3(0, 0.013 * k, 0);
  g.userData.set = (st, t) => {
    const open = st.s === 'free' ? 1 : st.s === 'locking' ? 1 - st.p : st.s === 'releasing' ? st.p : 0;
    hinge.rotation.x = 1.05 * open;                                    // the front of the lever swings up
    g.userData.cue(st, t);
  };
  g.userData.kind = 'clutch'; g.userData.k = k;
  return g;
}

// ------------------------------------------------------------------ ratchet block (Harken 57 mm Carbo): black cheeks,
// a sheave with a toothed ratchet wheel and a pawl that clicks on under load; optionally on a sprung swivel base,
// optionally with a cam cleat on the base (Harken 144 / triple Ratchamatic with 150 cam)
export function makeRatchet(opts = {}) {
  const g = new THREE.Group(), R = 0.034, hb = opts.swivel ? 0.085 : 0.045, blk = new THREE.Group();
  blk.position.y = hb; g.add(blk);
  add(g, new THREE.CylinderGeometry(0.03, 0.034, 0.006, 20), mCarbo(), 0, 0.003, 0);
  if (opts.swivel) {
    add(g, new THREE.CylinderGeometry(0.009, 0.011, hb - R + 0.01, 12), mSS(), 0, (hb - R) / 2, 0);
    const coil = []; for (let i = 0; i <= 60; i++) { const a = i / 60 * Math.PI * 2 * 6; coil.push(new THREE.Vector3(Math.cos(a) * 0.016, 0.008 + i / 60 * (hb - R - 0.01), Math.sin(a) * 0.016)); }
    add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 120, 0.0018, 5), mSS());
  } else add(g, new THREE.CylinderGeometry(0.006, 0.008, hb - R + 0.01, 10), mSS(), 0, (hb - R) / 2, 0);
  // cheeks (sheave axis along x: the line comes down from the purchase above and leaves along +z)
  for (const s of [-1, 1]) {
    const ch = add(blk, new THREE.CylinderGeometry(R, R, 0.004, 28), mCarbo(), s * 0.011, 0, 0); ch.rotation.z = Math.PI / 2;
    const rw = add(blk, toothed(0.013, 16, 0.002, 0.003), mSS(), s * 0.0135, 0, 0); rw.rotation.z = s * Math.PI / 2;
    add(blk, new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 10), mSS(), 0, 0, 0).rotation.z = Math.PI / 2;
  }
  const sh = add(blk, new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.014, 28), mat('sheave', () => new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.35, metalness: 0.6 })), 0, 0, 0); sh.rotation.z = Math.PI / 2;
  const top = add(blk, new THREE.TorusGeometry(0.012, 0.0028, 6, 14, Math.PI), mSS(), 0, R + 0.002, 0); top.rotation.y = Math.PI / 2;
  // the pawl and the on/off switch (red when the ratchet is on)
  const pawl = new THREE.Group(); pawl.position.set(0.0155, R * 0.55, -R * 0.35); blk.add(pawl);
  add(pawl, new THREE.BoxGeometry(0.003, 0.004, 0.014), mSS(), 0, 0, 0.006);
  const sw = add(blk, new THREE.CylinderGeometry(0.004, 0.004, 0.036, 8), mRed(), 0, -R * 0.55, -R * 0.45); sw.rotation.z = Math.PI / 2;
  let cam = null;
  if (opts.cam) { cam = makeCam('std'); cam.position.set(0, hb - R - 0.004, 0.045); cam.rotation.x = -0.25; g.add(cam); add(g, new THREE.BoxGeometry(0.02, 0.006, 0.05), mSS(), 0, hb - R - 0.012, 0.022); }
  const bd = band(g, 0.034, 0.008);
  common(g, bd);
  g.userData.inTop = () => new THREE.Vector3(0, hb + R, 0);          // where the line comes down onto the sheave
  g.userData.out = () => new THREE.Vector3(0, hb - R * 0.55, R * 0.8);  // where it leaves it
  g.userData.throat = (free) => cam ? cam.position.clone().add(cam.userData.throat(free).applyEuler(cam.rotation)) : g.userData.out();
  g.userData.set = (st, t) => {
    pawl.rotation.x = st.engaged ? 0.55 : 0;
    if (cam) cam.userData.set(st, t);
    else g.userData.cue(st, t);
    if (cam) bd.visible = false;
  };
  g.userData.kind = 'ratchet';
  return g;
}

// ------------------------------------------------------------------ traveller cars' locks
// cam on the car (Hobie SSI): a cam cleat on a riser bolted to the side of the car
export function makeCarCam() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.03, 0.03, 0.05), mAlu(), 0, 0.015, 0);
  const c = makeCam('std'); c.position.set(0, 0.03, 0); c.rotation.x = -0.35; g.add(c);
  g.userData.throat = (free) => c.position.clone().add(c.userData.throat(free).applyEuler(c.rotation));
  g.userData.set = (st, t) => c.userData.set(st, t);
  g.userData.band = c.userData.band; g.userData.kind = 'carCam';
  return g;
}
// push-button car: a plunger housing on the car with a red button; pushed, the pin comes out of the track
export function makePinStop() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.014, 0.016, 0.03, 16), mSS(), 0, 0.015, 0);
  const ring = add(g, new THREE.TorusGeometry(0.014, 0.0025, 6, 18), mSS(), 0, 0.03, 0); ring.rotation.x = Math.PI / 2;
  const btn = add(g, new THREE.CylinderGeometry(0.0095, 0.0095, 0.014, 16), mRed(), 0, 0.034, 0);
  const bd = band(g, 0.022, 0.004);
  common(g, bd);
  g.userData.throat = () => new THREE.Vector3(0, 0.02, 0);
  g.userData.set = (st, t) => { const dn = st.s === 'free' ? 1 : st.s === 'releasing' ? st.p : st.s === 'locking' ? 1 - st.p : 0; btn.position.y = 0.034 - 0.008 * dn; g.userData.cue(st, t); };
  g.userData.kind = 'pinStop';
  return g;
}
// self-tailing jaws on top of a winch (r: the drum's radius): a black jaw ring and the stripper arm
export function makeTailer(r = 0.065) {
  const g = new THREE.Group();
  const prof = [[r * 1.18, 0], [r * 1.2, 0.006], [r * 0.98, 0.012], [r * 1.2, 0.018], [r * 1.18, 0.024], [r * 0.5, 0.03], [0, 0.03]].map(([a, b]) => new THREE.Vector2(a, b));
  add(g, new THREE.LatheGeometry(prof, 24), mCarbo());
  const arm = add(g, new THREE.BoxGeometry(0.012, 0.008, r * 0.9), mSS(), r * 0.95, 0.012, 0); void arm;
  const bd = band(g, r * 1.28, 0.012);
  common(g, bd);
  g.userData.throat = () => new THREE.Vector3(0, 0.012, 0);
  g.userData.set = (st, t) => g.userData.cue(st, t);
  g.userData.kind = 'selfTailer';
  return g;
}

// the model for a handler type (see js/linehandlers.js HANDLERS)
export function makeHandler(type, o = {}) {
  switch (type) {
    case 'cam': case 'winchCam': return o.swivel ? swivelCam(o.size) : makeCam(o.size);
    case 'clam': return makeClam(o.size);
    case 'jam': return makeJam(o.bronze, o.ropeMat, o.ropeR);
    case 'horn': case 'winchHorn': return makeHorn(o.bronze, o.len, o.ropeMat, o.ropeR);
    case 'clutch': return makeClutch(o.label);
    case 'ratchet': return makeRatchet({ swivel: o.swivel });
    case 'ratchetCam': return makeRatchet({ swivel: true, cam: true });
    case 'carCam': return makeCarCam();
    case 'pinStop': return makePinStop();
    case 'selfTailer': return makeTailer(o.r);
  }
  return makeCam(o.size);
}
// a cam cleat on a sprung swivel post (Hobie jib sheet cleat)
function swivelCam(size) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.022, 0.026, 0.006, 16), mCarbo(), 0, 0.003, 0);
  add(g, new THREE.CylinderGeometry(0.007, 0.009, 0.04, 10), mSS(), 0, 0.022, 0);
  const c = makeCam(size); c.position.set(0, 0.042, 0); c.rotation.x = -0.3; g.add(c);
  g.userData.throat = (free) => c.position.clone().add(c.userData.throat(free).applyEuler(c.rotation));
  g.userData.set = (st, t) => c.userData.set(st, t);
  g.userData.band = c.userData.band; g.userData.kind = 'cam';
  return g;
}
