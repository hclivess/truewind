// Hull geometry shared by physics and rendering: the same lines produce the drawn hull and the
// hydrostatics (buoyancy, righting moment, heave/pitch, wave forces, wetted surface), so what you
// see is what floats. No three.js here — pure math, usable in workers and node.

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
  blackwatch: { tm: 0.5, tr: 0.62, be: 0.72, sheerBow: 0.3, sheerStern: 0.12, stemRake: 0.55, transomRake: 0.35, flare: 0.5, flat: 0.25, sternDepth: 0.05, crown: 0.07 },
  sportboat: { tm: 0.42, tr: 0.84, be: 0.8, sheerBow: 0.1, sheerStern: 0.02, stemRake: 0.02, transomRake: -0.06, flare: 0.25, flat: 0.8, sternDepth: 0.35, crown: 0.05 },
  dinghy: { tm: 0.45, tr: 0.72, be: 0.7, sheerBow: 0.18, sheerStern: 0.0, stemRake: 0.2, transomRake: 0.0, flare: 0.3, flat: 0.75, sternDepth: 0.35, crown: 0.06 },
  cat: { tm: 0.5, tr: 0.35, be: 0.9, sheerBow: 0.25, sheerStern: 0.05, stemRake: 0.05, transomRake: 0.0, flare: 0.1, flat: 0.15, sternDepth: 0.4, crown: 0.12 },
};

// Lines of one hull. depthScale lets the hydrostatic calibration match the real displacement.
export function linesFor(C, depthScale = C._depthScale ?? 1) {
  const H = HULL_PARAMS[C.id] || HULL_PARAMS.sportboat;
  const B = (C.hullBeam ?? C.beam) / 2, F = C.freeboard, D = C.canoeDraft * depthScale;
  const bDeck = (t) => B * (t < H.tm ? lerp(H.tr, 1, Math.sin(t / H.tm * Math.PI / 2) ** 0.85) : Math.pow(Math.max(0, Math.cos(Math.min(1, (t - H.tm) / (1 - H.tm)) * Math.PI / 2)), H.be));
  const sheer = (t) => F * (1 + H.sheerBow * sstep(0.45, 1, t) ** 1.6 + H.sheerStern * sstep(0.45, 0, t) ** 1.5 - 0.05 * Math.sin(Math.PI * t));
  const keelZ = (t) => -D * (t < 0.12 ? lerp(H.sternDepth, 1, sstep(0, 0.12, t)) : t > 0.7 ? lerp(1, 0, sstep(0.7, 1.0, t)) : 1);
  const flareAt = (t) => H.flare * sstep(0.55, 0.95, t);
  const flatAt = (t) => lerp(0.15, H.flat, sstep(0.95, 0.35, t));
  const longKeel = C.keel && C.keel.long ? (t) => {
    if (t < 0.04 || t > 0.93) return null;
    const heel = sstep(0.04, 0.1, t), fore = 1 - sstep(0.62, 0.93, t) ** 1.4;
    return -(D + (C.draft - D) * Math.min(heel, fore));
  } : null;
  return { H, bDeck, sheer, keelZ, flareAt, flatAt, longKeel };
}

// Half section at station t (0 stern .. 1 bow): [[y, z], ...] from the sheer down to the keel line.
export function hullSection(C, Lx, t) {
  const b = Lx.bDeck(t), sh = Lx.sheer(t), zk = Lx.keelZ(t), fl = Lx.flareAt(t), flat = Lx.flatAt(t);
  const bW = b * (0.93 - 0.3 * fl);
  const pts = [[b, sh], [b * (1 - 0.1 * fl) - 0.01, sh * 0.55], [bW, Math.max(0.02, zk * 0.05 + 0.02)]];
  pts.push([bW * lerp(0.6, 0.93, flat), zk * lerp(0.5, 0.72, flat)]);
  pts.push([bW * lerp(0.2, 0.55, flat), zk * lerp(0.9, 0.97, flat)]);
  const lk = Lx.longKeel ? Lx.longKeel(t) : null;
  if (lk !== null && lk < zk - 0.03) {
    pts.push([0.15, zk - 0.02]);
    pts.push([0.075, lk + 0.1]);
    pts.push([0.0, lk]);
  } else pts.push([0, zk]);
  return catmull(pts, 4).map(([y, z]) => [Math.max(0, y), z]);
}

// hull centre-line offsets (y) — one hull for monohulls, two for a catamaran
export function hullOffsets(C) { return C.multihull ? [-C.hullSpacing / 2, C.hullSpacing / 2] : [0]; }

// ---------------------------------------------------------------------------------------------
// Hydrostatic model: closed section polygons at stations along the length
function buildStations(C, nStations) {
  const Lx = linesFor(C);
  const stations = [];
  const L0 = C.sternX, L1 = C.bowX;
  for (let i = 0; i < nStations; i++) {
    const t = (i + 0.5) / nStations;
    const x = lerp(L0, L1, t);
    const half = hullSection(C, Lx, t);
    const polys = [];
    for (const off of hullOffsets(C)) {
      // closed polygon: starboard half from sheer to keel, then port half back up
      const p = [];
      for (const [y, z] of half) p.push(off + y, z);
      for (let k = half.length - 2; k >= 0; k--) p.push(off - half[k][0], half[k][1]);
      polys.push(p);
    }
    stations.push({ t, x, polys, dx: (L1 - L0) / nStations });
  }
  return stations;
}

// Immersion of the hull.
//   heave: boat origin height (m, + up); pitch: bow-up (rad); phi: heel (+ starboard down)
//   etaAt(x): water height at body station x; slopeLatAt(x): d(eta)/d(starboard); slopeAlongAt(x): d(eta)/d(forward)
// Returns immersed volume and its moments, Froude-Krylov wave forces, wetted girth-length and
// the dynamic waterline length.
function immerseStations(stations, heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt) {
  const cp = Math.cos(phi), sp = Math.sin(phi);
  let V = 0, My = 0, Mx = 0, girthLen = 0, xmin = 1e9, xmax = -1e9, FKx = 0, FKy = 0, FKn = 0;
  const Vh = out.Vh || (out.Vh = [0, 0]); Vh[0] = 0; Vh[1] = 0;
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
    const vol = A * st.dx;
    V += vol;
    const yc = Ay / A, zc = Az / A;
    My += vol * (yc * cp + zc * sp);   // lateral position of the centroid after heel
    Mx += vol * st.x;
    girthLen += girth * st.dx;
    xmin = Math.min(xmin, st.x - st.dx / 2); xmax = Math.max(xmax, st.x + st.dx / 2);
    if (slopeAlongAt) { const sa = slopeAlongAt(st.x); FKx -= vol * sa; FKy -= vol * sl; FKn -= vol * sl * st.x; }
  }
  out.V = V; out.My = My; out.Mx = Mx; out.girthLen = girthLen; out.lwl = xmax > xmin ? xmax - xmin : 0;
  out.FKx = FKx; out.FKy = FKy; out.FKn = FKn;
  return out;
}

export class HullHydro {
  constructor(C, nStations = 26) {
    this.C = C;
    calibrate(C);
    this.stations = buildStations(C, nStations);
    const r = this.immerse(0, 0, 0, () => 0, () => 0, {});
    this.restWetted = r.girthLen; this.restLwl = Math.max(0.5, r.lwl); this.restV = r.V;
  }
  immerse(heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt = null) {
    return immerseStations(this.stations, heave, pitch, phi, etaAt, slopeLatAt, out, slopeAlongAt);
  }
}

// Area, first moments and wetted girth of the part of a closed section polygon below the water line
// -y*sin(phi) + z*cos(phi) < zw + sl*(y*cos(phi) + z*sin(phi))   (heeled boat, sloping local surface)
function clipArea(p, sp, cp, zw, sl) {
  const n = p.length / 2;
  const f = (y, z) => -y * sp + z * cp - zw - sl * (y * cp + z * sp);
  let A = 0, Ay = 0, Az = 0, girth = 0;
  let px = p[2 * (n - 1)], pz = p[2 * (n - 1) + 1], pf = f(px, pz);
  const out = [];
  for (let i = 0; i < n; i++) {
    const cx = p[2 * i], cz = p[2 * i + 1], cf = f(cx, cz);
    if (cf < 0) {
      if (pf >= 0) { const t = pf / (pf - cf); out.push(px + (cx - px) * t, pz + (cz - pz) * t); }
      out.push(cx, cz);
      if (pf < 0) girth += Math.hypot(cx - px, cz - pz);
    } else if (pf < 0) { const t = pf / (pf - cf); out.push(px + (cx - px) * t, pz + (cz - pz) * t); girth += Math.hypot((cx - px) * t, (cz - pz) * t); }
    px = cx; pz = cz; pf = cf;
  }
  const m = out.length / 2;
  for (let i = 0; i < m; i++) {
    const y0 = out[2 * i], z0 = out[2 * i + 1], y1 = out[2 * ((i + 1) % m)], z1 = out[2 * ((i + 1) % m) + 1];
    const cr = y0 * z1 - y1 * z0;
    A += cr; Ay += (y0 + y1) * cr; Az += (z0 + z1) * cr;
  }
  A *= 0.5;
  if (Math.abs(A) < 1e-9) return { A: 0, Ay: 0, Az: 0, girth: 0 };
  // polygon orientation may be clockwise: centroid formula is sign-consistent
  return { A: Math.abs(A), Ay: Ay / 6 * Math.sign(A), Az: Az / 6 * Math.sign(A), girth };
}

// Scale the canoe-body depth so that the drawn hull floats at its drawn waterline with the boat's
// real mass: displacement at z=0, level, equals mass / rho.
export function calibrate(C) {
  if (C._depthScale !== undefined) return C._depthScale;
  const need = (C.massHull + C.crewN * C.crewEach) / 1025;
  let s = 1;
  for (let it = 0; it < 40; it++) {
    C._depthScale = s;
    const V = immerseStations(buildStations(C, 26), 0, 0, 0, () => 0, () => 0, {}).V;
    const ratio = need / Math.max(1e-4, V);
    if (Math.abs(ratio - 1) < 0.004) break;
    s = clamp(s * Math.pow(ratio, 0.85), 0.2, 5);
  }
  C._depthScale = s;
  return s;
}
