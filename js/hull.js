// Hull geometry shared by physics and rendering: the same lines produce the drawn hull and the
// hydrostatics (buoyancy, righting moment, heave/pitch, wave forces, wetted surface), so what you
// see is what floats. No three.js here — pure math, usable in workers and node.
// (Math.hypot allocates when V8 does not inline it: these do not)
const hyp = (x, y) => Math.sqrt(x * x + y * y), hyp3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function catmull(pts, n) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const HULL_PARAMS = {
  blackwatch: { tm: 0.5, tr: 0.62, be: 0.72, sheerBow: 0.25, sheerStern: -0.04, stemRake: 0.38, transomRake: 0.2, flare: 0.5, flat: 0.25, sternDepth: 0.05, crown: 0.07 },
  sportboat: { tm: 0.42, tr: 0.84, be: 0.8, sheerBow: 0.14, sheerStern: -0.18, stemRake: 0.02, transomRake: -0.02, flare: 0.25, flat: 0.8, sternDepth: 0.35, crown: 0.05 },
  dinghy: { tm: 0.45, tr: 0.72, be: 0.7, sheerBow: 0.18, sheerStern: 0.0, stemRake: 0.2, transomRake: 0.0, flare: 0.3, flat: 0.75, sternDepth: 0.35, crown: 0.06 },
  // Hobie 16: banana hulls, the keel line one long curve (rocker) from the upswept stern to the bow
  cat: { tm: 0.5, tr: 0.35, be: 0.9, sheerBow: 0.25, sheerStern: 0.14, stemRake: 0.05, transomRake: 0.0, flare: 0.1, flat: 0.15, sternDepth: 0.4, crown: 0.12, rocker: 0.55 },
};

// Lines of one hull. depthScale lets the hydrostatic calibration match the real displacement.
export function linesFor(C, depthScale = C._depthScale ?? 1) {
  // a class's hull (C.offsets): a table of offsets, or the parametric form (HULL_PARAMS' parameters: tm, tr, be, ...)
  if (C.offsets && C.offsets.tm === undefined) return offsetLines(C, depthScale);
  const H = C.offsets || HULL_PARAMS[C.id] || HULL_PARAMS.sportboat;
  const B = (C.hullBeam ?? C.beam) / 2, F = C.freeboard, D = C.canoeDraft * depthScale;
  const bDeck = (t) => B * (t < H.tm ? lerp(H.tr, 1, Math.sin(t / H.tm * Math.PI / 2) ** 0.85) : Math.pow(Math.max(0, Math.cos(Math.min(1, (t - H.tm) / (1 - H.tm)) * Math.PI / 2)), H.be));
  const sheer = (t) => F * (1 + H.sheerBow * sstep(0.45, 1, t) ** 1.6 + H.sheerStern * sstep(0.45, 0, t) ** 1.5 - 0.05 * Math.sin(Math.PI * t));
  const keelZ = H.rocker ? (t) => -D * Math.max(0, 1 - H.rocker * ((t - 0.46) / 0.54) ** 2) * (1 - sstep(0.8, 1.0, t) ** 2)
    : (t) => -D * (t < 0.12 ? lerp(H.sternDepth, 1, sstep(0, 0.12, t)) : t > 0.7 ? lerp(1, 0, sstep(0.7, 1.0, t)) : 1);
  const flareAt = (t) => H.flare * sstep(0.55, 0.95, t);
  const flatAt = (t) => lerp(0.15, H.flat, sstep(0.95, 0.35, t));
  const longKeel = C.keel && C.keel.long ? (t) => {
    if (t < 0.04 || t > 0.93) return null;
    const heel = sstep(0.04, 0.1, t), fore = 1 - sstep(0.62, 0.93, t) ** 1.4;
    return -(D + (C.draft - D) * Math.min(heel, fore));
  } : null;
  return { H, bDeck, sheer, keelZ, flareAt, flatAt, longKeel };
}

// A smooth curve through [t, value] rows (monotone cubic, Fritsch-Carlson: no overshoot between offsets), held
// flat past its ends
export function curveOf(tab) {
  if (typeof tab === 'number') return () => tab;
  const n = tab.length, xs = tab.map(r => r[0]), ys = tab.map(r => r[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]); for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1];
  };
}

// Lines from a table of offsets (classes that carry C.offsets, taken off the published lines and profile drawings).
// Each is a list of [t, value] rows along the hull (t: 0 at sternX .. 1 at bowX):
//   sheer  height of the sheer above the DWL (m)            deck   deck half-breadth / (beam / 2)
//   wl     half-breadth at the turn of the bilge / deck half-breadth
//   keel   the canoe body's bottom on the centreline (the rabbet line), m; above the DWL (+) in the overhangs,
//          where the section is all topsides and the bottom meets at the keel line
//   bilge  superellipse exponent of the bottom (2 round bilge, 3-5 firm or hard, 1.3 slack), dead: deadrise
//          (0 the bottom sweeps flat into the keel .. 1 a straight V), flare: topsides exponent (< 1 they stand up
//          from the bilge and round out to the sheer, 1 straight)
//   fin    bottom of a long keel / deadwood where it is deeper than the rabbet (m), finW its half thickness
//   tumble tumblehome at the sheer (fraction of the half-breadth), crown deck camber, transomRake (m, the top of
//          the transom aft of its foot), stemX (m, a clipper stem's head forward of its foot)
// The section has the same number of points at every station (fin points collapse onto the keel where there is
// no fin), so the renderer can loft it and the hydrostatics can clip it.
function offsetLines(C, ds) {
  const L = C.offsets, B = (C.hullBeam ?? C.beam) / 2;
  const sheer = curveOf(L.sheer), deck = curveOf(L.deck), wl = curveOf(L.wl ?? 0.9), keel = curveOf(L.keel);
  const bilge = curveOf(L.bilge ?? 2.2), dead = curveOf(L.dead ?? 0.3), flare = curveOf(L.flare ?? 0.7), tumble = curveOf(L.tumble ?? 0);
  const fin = L.fin ? curveOf(L.fin) : null, finW = curveOf(L.finW ?? 0.12), finT = L.fin ? [L.fin[0][0], L.fin[L.fin.length - 1][0]] : null;
  const H = { crown: L.crown ?? 0.06, stemRake: 0, transomRake: L.transomRake ?? 0, tm: 0.5 };
  const bDeck = (t) => B * Math.max(0, deck(t));
  const keelZ = (t) => { const z = keel(t); return z < 0 ? z * ds : z; };
  const finZ = (t) => (fin && t >= finT[0] && t <= finT[1] ? fin(t) : null);
  const NT = 4, NB = 8;
  const section = (t) => {
    const sh = sheer(t), b = bDeck(t), zk = keelZ(t), k = C._fullness ?? 1;
    // the turn of the bilge: at the DWL where the canoe body is under water, rising into the topsides where the
    // keel line comes up out of it (the overhangs), so that the section closes smoothly at the keel line
    const zb = lerp(zk + 0.3 * Math.max(0, sh - zk), 0, sstep(0, 0.12, -zk));
    const bw = b * clamp(wl(t), 0, 1.2) * sstep(0, 0.1, zb - zk + 0.02), fe = flare(t), tb = tumble(t);
    const pts = [];
    for (let i = 0; i < NT; i++) {                                  // topsides: sheer -> bilge
      const s = i / NT, h = 1 - s;                                   // h: 1 at the sheer .. 0 at the bilge
      const y = bw + (b - bw) * Math.pow(h, fe) - tb * b * Math.pow(h, 6);
      pts.push([y, sh + (zb - sh) * s]);
    }
    const p = Math.max(1.05, bilge(t)), dr = clamp(dead(t), 0, 1);
    let zf = finZ(t); if (zf !== null && zf > zk - 0.005) zf = null;
    const fw = zf === null ? 0 : finW(t) * sstep(0, 0.1, zk - zf);
    for (let i = 0; i <= NB; i++) {                                  // bottom: bilge -> keel (superellipse + deadrise)
      const th = i / NB * Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
      let y = bw * Math.pow(c, 2 / p), z = zb + (zk - zb) * Math.pow(s, 2 / p);
      z = lerp(z, zk + (zb - zk) * (y / Math.max(bw, 1e-6)), dr * (1 - Math.pow(c, 4)));
      if (i === NB) y = fw;
      if (z < 0) y *= k + (1 - k) * Math.max(0, 1 + z / 0.02);
      pts.push([Math.max(fw * (i / NB) ** 8, y), z]);
    }
    // the fin (long keel / deadwood) under the garboard
    const zf2 = zf ?? zk;
    for (const [fy, fz] of [[0.85, 0.35], [0.6, 0.75], [0.32, 0.97], [0, 1]]) pts.push([fw * fy, zk + (zf2 - zk) * fz]);
    return pts;
  };
  const xShift = (t, zn) => -H.transomRake * sstep(0.05, 0, t) * zn + (L.stemX ?? 0) * sstep(0.9, 1, t) * zn * zn;
  return { H, bDeck, sheer, keelZ, flareAt: () => 0, flatAt: () => 0.5, longKeel: null, section, xShift, finZ };
}

// Half section at station t (0 stern .. 1 bow): [[y, z], ...] from the sheer down to the keel line.
export function hullSection(C, Lx, t) {
  if (Lx.section) return Lx.section(t);
  const b = Lx.bDeck(t), sh = Lx.sheer(t), zk = Lx.keelZ(t), fl = Lx.flareAt(t), flat = Lx.flatAt(t);
  const bW = b * ((Lx.H.wl ?? 0.93) - 0.3 * fl);               // (H.wl: waterline half-beam over the deck's, amidships)
  const pts = [[b, sh], [b * (1 - 0.1 * fl) - 0.01, sh * 0.55], [bW, Math.max(0.02, zk * 0.05 + 0.02)]];
  pts.push([bW * lerp(0.6, 0.93, flat), zk * lerp(0.5, 0.72, flat)]);
  pts.push([bW * lerp(0.2, 0.55, flat), zk * lerp(0.9, 0.97, flat)]);
  const lk = Lx.longKeel ? Lx.longKeel(t) : null;
  if (lk !== null && lk < zk - 0.03) {
    pts.push([0.15, zk - 0.02]);
    pts.push([0.075, lk + 0.1]);
    pts.push([0.0, lk]);
  } else pts.push([0, zk]);
  // underwater fullness (calibrated to the real displacement): pinch the bilge in, keep the profile
  const k = C._fullness ?? 1;
  return catmull(pts, 4).map(([y, z]) => [Math.max(0, z < 0 ? y * (k + (1 - k) * Math.max(0, 1 + z / 0.02) ) : y), z]);
}

// hull centre-line offsets (y) — one hull for monohulls, two for a catamaran
export function hullOffsets(C) { return C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0]; }
// Every hull of a boat: its centre-line offset y and, for a trimaran's floats (amas, C.amas), a copy of the main hull's
// lines scaled across (sy), in depth below (sz) and above (szTop) the waterline, lifted by dz and set over the part
// t0..t1 of the main hull's length
export function hullParts(C) {
  if (C.amas) {
    const A = C.amas;
    return [{ y: 0, sy: 1, sz: 1, szTop: 1, dz: 0, t0: 0, t1: 1 }, ...[-1, 1].map((s) => ({ y: s * A.y, sy: A.sy, sz: A.sz, szTop: A.szTop ?? A.sz, dz: A.dz, t0: A.t0, t1: A.t1, tumble: A.tumble ?? 0, tube: A.tube ?? null, len: (C.bowX - C.sternX) * (A.t1 - A.t0) }))];
  }
  return hullOffsets(C).map((y) => ({ y, sy: 1, sz: 1, szTop: 1, dz: 0, t0: 0, t1: 1 }));
}
// half section of hull part P at station t of the main hull (null where that part does not reach)
export function partSection(C, Lx, t, P) {
  if (t < P.t0 - 1e-9 || t > P.t1 + 1e-9) return null;
  const whole = P.t0 === 0 && P.t1 === 1, h = hullSection(C, Lx, whole ? t : (t - P.t0) / (P.t1 - P.t0));
  if (P.tube) {
    // a float that is a plain tube (the Waterworld trimaran's): a circle of radius tube.r about its axis tube.z above the
    // DWL, closed at both ends in round domes; as many points as the main hull's section, from the top round to the keel
    const u = (t - P.t0) / (P.t1 - P.t0), R0 = P.tube.r, e = Math.min(u, 1 - u) * P.len;
    const R = e >= R0 ? R0 : R0 * Math.sqrt(Math.max(0.0004, 1 - (1 - e / R0) ** 2));
    const n = h.length;
    return h.map((_, i) => { const th = Math.PI / 2 - Math.PI * i / (n - 1); return [Math.max(0, R * Math.cos(th)), P.tube.z + R * Math.sin(th)]; });
  }
  if (whole && P.sy === 1 && P.sz === 1 && P.szTop === 1 && !P.dz) return h;
  // (tumble: the float's topsides curve in toward its deck, so it is a round-topped tube rather than a scaled hull)
  const zt = h[0][1] > 0 ? h[0][1] : 1;
  return h.map(([y, z]) => [y * P.sy * (1 - (P.tumble || 0) * (z > 0 ? Math.pow(z / zt, 2.2) : 0)), z * (z < 0 ? P.sz : P.szTop) + P.dz]);
}

// ---------------------------------------------------------------------------------------------
// Hydrostatic model: closed section polygons at stations along the length
function buildStations(C, nStations) {
  const Lx = linesFor(C);
  const stations = [];
  const L0 = C.sternX, L1 = C.bowX;
  for (let i = 0; i < nStations; i++) {
    const t = (i + 0.5) / nStations;
    const x = lerp(L0, L1, t);
    const polys = [];
    for (const P of hullParts(C)) {
      // closed polygon: starboard half from sheer to keel, then port half back up (empty where this hull does not reach)
      const half = partSection(C, Lx, t, P), off = P.y, p = [];
      if (half) {
        for (const [y, z] of half) p.push(off + y, z);
        for (let k = half.length - 2; k >= 0; k--) p.push(off - half[k][0], half[k][1]);
      }
      polys.push(p);
    }
    let full = 0;
    for (const p of polys) { for (let i = 0, n = p.length / 2; i < n; i++) { const j = (i + 1) % n; full += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; } }
    stations.push({ t, x, polys, dx: (L1 - L0) / nStations, full: Math.abs(full) / 2 });
  }
  return stations;
}

// Immersion of the hull.
//   heave: boat origin height (m, + up); pitch: bow-up (rad); phi: heel (+ starboard down)
//   etaAt(x): water height at body station x; slopeLatAt(x): d(eta)/d(starboard); slopeAlongAt(x): d(eta)/d(forward)
// Returns immersed volume and its moments, Froude-Krylov wave forces, wetted girth-length and
// the dynamic waterline length. Strip theory for the wave loads: each section's immersed volume times the
// water's pressure gradient there, -grad p / rho = g grad eta at the surface (Froude-Krylov), and times the
// orbital acceleration (accAt(x, o): o.a along, o.l to starboard, o.v up) for the diffraction (added-mass)
// part, both decaying as e^{k z} to the section's centroid depth (k = ka, the acceleration spectrum's mean).
// (FA*: sum vol a; FAn, FAm: its moments about x = 0 (yaw, pitch); FAk: the lateral part's roll moment arm.)
// Heave and pitch in strip theory (HullHydro: each station's 2-D added mass a33, only while it is wet): M33, M35, M55
// = sum a33 (1, x, x^2); F33, F35 = sum a33 a_w (1, x), the diffraction load of the water's vertical acceleration
// (o.v); W33, W35 = sum a33 w (1, x), the water's vertical velocity (o.w) weighted the same way, what the radiation
// damping acts against. Each section feels the water at its own station, so waves shorter than the hull cancel
// along it instead of being felt at one point.
function immerseStations(stations, heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt, accAt, ka = 0) {
  const cp = Math.cos(phi), sp = Math.sin(phi), ac = ACC;
  let V = 0, My = 0, Mx = 0, girthLen = 0, xmin = 1e9, xmax = -1e9, FKx = 0, FKy = 0, FKn = 0;
  let FAx = 0, FAy = 0, FAn = 0, FAz = 0, FAm = 0, FAk = 0;
  let M33 = 0, M35 = 0, M55 = 0, F33 = 0, F35 = 0, W33 = 0, W35 = 0;   // heave added mass and its wave loads (see HullHydro)
  const Vh = out.Vh || (out.Vh = new Array(stations[0].polys.length).fill(0)); Vh.fill(0);   // volume per hull
  let deckSub = 0;
  for (const st of stations) {
    const eta = etaAt(st.x), sl = slopeLatAt(st.x);
    const zw = eta - heave - st.x * pitch;
    let A = 0, Ay = 0, Az = 0, girth = 0;
    for (let q = 0; q < st.polys.length; q++) {
      const r = clipArea(st.polys[q], sp, cp, zw, sl);
      A += r.A; Ay += r.Ay; Az += r.Az; girth += r.girth;
      Vh[q] += r.A * st.dx;
    }
    if (A <= 1e-6) continue;
    if (st.t > 0.6 && st.full > 0) deckSub += Math.max(0, A / st.full - 0.88) / 0.12 / 10;  // foredeck under water
    const vol = A * st.dx;
    V += vol;
    const yc = Ay / A, zc = Az / A;
    My += vol * (yc * cp + zc * sp);   // lateral position of the centroid after heel
    Mx += vol * st.x;
    girthLen += girth * st.dx;
    xmin = Math.min(xmin, st.x - st.dx / 2); xmax = Math.max(xmax, st.x + st.dx / 2);
    const dec = ka > 0 ? Math.exp(ka * Math.min(0, -yc * sp + zc * cp - zw)) : 1;   // e^{k z} at the centroid
    // the section's heave added mass, as much of it as is in the water (a bow out of the water carries none)
    const am = st.am ? st.am * Math.min(1, A / st.A0) : 0;
    M33 += am; M35 += am * st.x; M55 += am * st.x * st.x;
    if (slopeAlongAt) { const sa = slopeAlongAt(st.x), vd = vol * dec; FKx -= vd * sa; FKy -= vd * sl; FKn -= vd * sl * st.x; }
    if (accAt) {
      accAt(st.x, ac); const vd = vol * dec;
      FAx += vd * ac.a; FAy += vd * ac.l; FAn += vd * ac.l * st.x; FAz += vd * ac.v; FAm += vd * ac.v * st.x; FAk += vd * ac.l * zc;
      if (am) { const ad = am * dec, w = ac.w || 0; F33 += ad * ac.v; F35 += ad * ac.v * st.x; W33 += ad * w; W35 += ad * w * st.x; }
    }
  }
  out.V = V; out.My = My; out.Mx = Mx; out.girthLen = girthLen; out.lwl = xmax > xmin ? xmax - xmin : 0;
  out.FKx = FKx; out.FKy = FKy; out.FKn = FKn; out.deckSub = deckSub;
  out.FAx = FAx; out.FAy = FAy; out.FAn = FAn; out.FAz = FAz; out.FAm = FAm; out.FAk = FAk;
  out.M33 = M33; out.M35 = M35; out.M55 = M55; out.F33 = F33; out.F35 = F35; out.W33 = W33; out.W35 = W35;
  return out;
}

const ACC = { a: 0, l: 0, v: 0, w: 0 };
// Where the local water surface cuts each station's section: [x, y1, z1, y2, z2, ...] per station
function waterlineStations(stations, heave, pitch, phi, etaAt, slopeLatAt) {
  const cp = Math.cos(phi), sp = Math.sin(phi), out = [];
  for (const st of stations) {
    const zw = etaAt(st.x) - heave - st.x * pitch, sl = slopeLatAt(st.x);
    const f = (y, z) => -y * sp + z * cp - zw - sl * (y * cp + z * sp);
    const pts = [];
    for (const p of st.polys) {
      const n = p.length / 2;
      let px = p[2 * (n - 1)], pz = p[2 * (n - 1) + 1], pf = f(px, pz);
      for (let i = 0; i < n; i++) {
        const cx = p[2 * i], cz = p[2 * i + 1], cf = f(cx, cz);
        if ((pf < 0) !== (cf < 0)) { const t = pf / (pf - cf); pts.push(px + (cx - px) * t, pz + (cz - pz) * t); }
        px = cx; pz = cz; pf = cf;
      }
    }
    out.push({ x: st.x, t: st.t, pts });
  }
  return out;
}

export class HullHydro {
  constructor(C, nStations = 26) {
    this.C = C;
    calibrate(C);
    this.stations = buildStations(C, nStations);
    heaveAddedMass(this);
    const r = this.immerse(0, 0, 0, () => 0, () => 0, {});
    this.restWetted = r.girthLen; this.restLwl = Math.max(0.5, r.lwl); this.restV = r.V;
    this.A33 = r.M33; this.A35 = r.M35; this.A55 = r.M55;          // at rest, level (kg, kg m, kg m^2)
  }
  immerse(heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt = null, accAt = null, ka = 0) {
    return immerseStations(this.stations, heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt, accAt, ka);
  }
  waterline(heave, pitch, phi, etaAt, slopeLatAt) { return waterlineStations(this.stations, heave, pitch, phi, etaAt, slopeLatAt); }
}

// Heave added mass of each station of the canoe body (strip theory). A section of waterline half-breadth b, draft T
// and area A has a33 = rho (pi / 2) b^2 C (Lewis 1929: the section mapped conformally from a circle with the
// coefficients a1, a3 fitted to H0 = b / T and sigma = A / (2 b T); Journee & Massie, "Offshore Hydromechanics"
// (2001) ch. 7). C is the high-frequency value; at a yacht's heave and pitch resonance (w^2 b / g ~ 1-2) the 2-D
// coefficient of these flat sections is ~0.8 of it (Ursell 1949; Vugts 1968), and a hull 3-4 beams long carries
// ~0.75 of what its strips add up to (the end effect: Lewis's J, Kumai 1959), hence AM3D = 0.6. A flat, wide canoe
// body carries several times its own displacement in heave (Delft series: Gerritsma, Keuning & Versluis 1993): with
// the old 0.8 of displacement a 30 ft yacht had a 1.4 s heave period and a Laser 0.5 s. The fin, the bulb and the
// rudder move edgewise in heave and add little. Multihulls: each hull's own breadth.
export const AM3D = 0.6;
function lewisC(H0, sg) {
  const r = (H0 - 1) / (H0 + 1), C1 = (3 + 4 * sg / Math.PI) + (1 - 4 * sg / Math.PI) * r * r;
  const a3 = (-C1 + 3 + Math.sqrt(Math.max(0, 9 - 2 * C1))) / C1, a1 = r * (a3 + 1);
  return ((1 + a1) ** 2 + 3 * a3 * a3) / (1 + a1 + a3) ** 2;
}
function heaveAddedMass(h) {
  const wl = h.waterline(0, 0, 0, () => 0, () => 0), cp = 1, sp = 0;
  for (let i = 0; i < h.stations.length; i++) {
    const st = h.stations[i], p = wl[i].pts;
    st.am = 0; st.A0 = 0;
    let k = 0;
    for (const poly of st.polys) {
      if (!poly.length) continue;
      const r = clipArea(poly, sp, cp, 0, 0), A = r.A;
      if (A < 1e-6) continue;
      st.A0 += A;
      // this hull's two waterline crossings (the next pair in the station's list)
      let zmin = 0; for (let q = 1; q < poly.length; q += 2) zmin = Math.min(zmin, poly[q]);
      const b = k + 3 < p.length ? Math.abs(p[k + 2] - p[k]) / 2 : 0; k += 4;
      const T = -zmin;
      if (b < 1e-3 || T < 1e-3) continue;
      const H0 = clamp(b / T, 0.2, 10), sg = clamp(A / (2 * b * T), 0.35, 0.95);
      st.am += 1025 * Math.PI / 2 * b * b * lewisC(H0, sg) * AM3D * st.dx;
    }
  }
}

// Form parameters of the drawn hull at rest, what a resistance regression needs: waterline length L and beam B,
// canoe-body draft T, displacement V, midship Cm, prismatic Cp and waterplane Cwp coefficients, waterplane area Aw,
// LCB (% of L forward of the waterline's middle) and the centres of buoyancy and flotation from the bow (fractions of
// L: lcbF, lcfF), the half angle of entrance iE and the immersed transom area AT (tools/hull-form.mjs prints them)
export function hullForm(C, h = new HullHydro(C)) {
  const Lx = linesFor(C), st = h.stations;
  const dx = st[1].x - st[0].x;
  let Ax = 0, Aw = 0, Mx = 0, Mw = 0, AT = 0, Vs = 0;
  const V = h.restV;
  const xs = [], ys = [];
  const wl = h.waterline(0, 0, 0, () => 0, () => 0);
  for (let i = 0; i < st.length; i++) {
    const xi = st[i].x;
    const r = h.immerse(0, 0, 0, (x) => (Math.abs(x - xi) < dx / 2 ? 0 : -1e3), () => 0, {});
    const A = r.V / dx; if (A > Ax) Ax = A;
    let yb = 0; const p = wl[i].pts; for (let k = 0; k < p.length; k += 2) yb = Math.max(yb, Math.abs(p[k]));
    if (A > 1e-5) { xs.push(xi); ys.push(yb); Aw += 2 * yb * dx; Mw += 2 * yb * dx * xi; Mx += A * dx * xi; Vs += A * dx; }
    if (i === 0) AT = A;
  }
  const L = Math.max(0.3, h.restLwl), B = 2 * Math.max(...ys);
  let T = 0; for (let t = 0; t <= 1; t += 0.01) T = Math.max(T, -Lx.keelZ(t));
  const xf = Math.max(...xs) + dx / 2, xa = Math.min(...xs) - dx / 2, xm = (xf + xa) / 2;
  let iE;
  { const n = xs.length, k = Math.max(1, Math.round(n * 0.1)), yk = ys[n - 1 - k], dxk = xs[n - 1] - xs[n - 1 - k] + dx / 2;
    iE = Math.atan2(Math.max(1e-3, yk - ys[n - 1] * 0.3), dxk) * 180 / Math.PI; }
  const Cm = Math.min(0.98, Ax / Math.max(1e-6, B * T)), Cp = Math.min(0.85, V / Math.max(1e-6, Ax * L));
  return { L, B, T, V, Aw, Cm, Cp, Cwp: Aw / (L * B), lcb: 100 * (Mx / Vs - xm) / L, lcbF: (xf - Mx / Vs) / L, lcfF: (xf - Mw / Aw) / L,
    iE, AT: AT * (xs[0] <= st[0].x + 1e-6 ? 1 : 0) };
}

// Area, first moments and wetted girth of the part of a closed section polygon below the water line
// -y*sin(phi) + z*cos(phi) < zw + sl*(y*cos(phi) + z*sin(phi))   (heeled boat, sloping local surface)
// (runs for every section of every boat every step: no allocation, the clipped polygon goes to a scratch buffer
// and the result to one reused object, read by the caller at once)
let CLIP = new Float64Array(256);
const CLIPR = { A: 0, Ay: 0, Az: 0, girth: 0 };
function clipArea(p, sp, cp, zw, sl) {
  const n = p.length / 2;
  if (CLIP.length < 4 * n + 8) CLIP = new Float64Array(4 * n + 8);
  const out = CLIP;
  let m2 = 0;
  let A = 0, Ay = 0, Az = 0, girth = 0;
  let px = p[2 * (n - 1)], pz = p[2 * (n - 1) + 1], pf = -px * sp + pz * cp - zw - sl * (px * cp + pz * sp);
  for (let i = 0; i < n; i++) {
    const cx = p[2 * i], cz = p[2 * i + 1], cf = -cx * sp + cz * cp - zw - sl * (cx * cp + cz * sp);
    if (cf < 0) {
      if (pf >= 0) { const t = pf / (pf - cf); out[m2++] = px + (cx - px) * t; out[m2++] = pz + (cz - pz) * t; }
      out[m2++] = cx; out[m2++] = cz;
      if (pf < 0) girth += hyp(cx - px, cz - pz);
    } else if (pf < 0) { const t = pf / (pf - cf); out[m2++] = px + (cx - px) * t; out[m2++] = pz + (cz - pz) * t; girth += hyp((cx - px) * t, (cz - pz) * t); }
    px = cx; pz = cz; pf = cf;
  }
  const m = m2 / 2;
  for (let i = 0; i < m; i++) {
    const y0 = out[2 * i], z0 = out[2 * i + 1], y1 = out[2 * ((i + 1) % m)], z1 = out[2 * ((i + 1) % m) + 1];
    const cr = y0 * z1 - y1 * z0;
    A += cr; Ay += (y0 + y1) * cr; Az += (z0 + z1) * cr;
  }
  A *= 0.5;
  const r = CLIPR;
  if (Math.abs(A) < 1e-9) { r.A = 0; r.Ay = 0; r.Az = 0; r.girth = 0; return r; }
  // polygon orientation may be clockwise: centroid formula is sign-consistent
  const sg = Math.sign(A);
  r.A = Math.abs(A); r.Ay = Ay / 6 * sg; r.Az = Az / 6 * sg; r.girth = girth;
  return r;
}

// Scale the canoe-body depth so that the drawn hull floats at its drawn waterline with the boat's
// real mass: displacement at z=0, level, equals mass / rho.
export function calibrate(C) {
  if (C._fullness !== undefined) return C._fullness;
  // share the correction between underwater fullness and canoe-body depth, keeping sections realistic
  const need = (C.massHull + C.crewN * C.crewEach) / 1025;
  let k = 1, d = 1;
  for (let it = 0; it < 60; it++) {
    C._fullness = k; C._depthScale = d;
    const V = immerseStations(buildStations(C, 26), 0, 0, 0, () => 0, () => 0, {}).V;
    const ratio = need / Math.max(1e-4, V);
    if (Math.abs(ratio - 1) < 0.004) break;
    const s = Math.pow(ratio, 0.5);
    k = clamp(k * s, 0.55, 1.3);
    d = clamp(d * (k === 0.55 || k === 1.3 ? ratio : s), 0.3, 3);
  }
  C._fullness = k; C._depthScale = d;
  return k;
}
