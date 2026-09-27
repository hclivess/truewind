// The main boom and what holds it, shared by the strip model (physics.js) and the cloth rig (js/sail/rigsim.js):
//   - the mainsheet from the boom block to a car on a straight athwartships traveller track (or, on the dinghy, a
//     block riding a rope horse across the transom): the boom angle a given sheet length allows, and the sheet's
//     downward pull on the boom end (the leech tension it adds) come out of that geometry;
//   - the standing rigging the boom and the sail come up against (shrouds, spreaders): the boom's largest angle;
//   - the boom as a beam: bending under the vang and the sheet (the leech holds its end up), and whether it breaks;
//   - the boom end dragging in the sea when the boat rolls it under.
// Rig frame: x forward, y starboard, z up from the waterline, as physics.js.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

// the mast's x at height z (raked aft about the gooseneck by C.mastRake at the masthead)
export const mastXAt = (C, z) => C.mastX - (C.mastRake || 0) * (z - C.boomZ) / (C.mastHeight - C.boomZ);

// an unstayed mast (a Laser's, an Optimist's, a Sunfish's): no shrouds for the sail or the boom to meet (the same
// test as js/damage.js rigSpec: a class's own rigSpec, else a single-sail dinghy with no backstay)
export const stayed = (C) => (C.rigSpec ? C.rigSpec.stayed !== false : C.id !== 'dinghy' && !(!C.hasBackstay && !C.multihull && C.sails.length === 1 && C.massHull + C.crewN * C.crewEach < 250));
// The standing rigging (rig frame, as models.js draws it): the mast's front face, the stays a headsail is hanked
// to, and the shrouds (a keelboat's cap shrouds from the chainplates over the spreader tips to the hounds; a cat's
// from the hulls to the hounds; the una-rig dinghy's mast stands alone)
export function rigWires(C, sails) {
  const mastBase = C.freeboard + (C.cabin ? 0.35 : 0), mastLen = C.mastHeight - mastBase;
  const stay = (s) => (s ? [[s.tackX, 0, s.tackZ], [s.tackX - (s.rake || 0), 0, s.tackZ + s.luff]] : null);
  const w = { mast: [[mastXAt(C, mastBase) + 0.03, 0, mastBase], [mastXAt(C, C.mastHeight) + 0.03, 0, C.mastHeight]], forestay: stay(sails.jib), inner: stay(sails.stay), shrouds: [] };
  if (C.multihull) {
    const hz = C.mastHeight - mastLen * 0.25;
    for (const sd of [-1, 1]) w.shrouds.push([[C.mastX - 0.05, sd * C.hullSpacing / 2, C.freeboard + 0.1], [mastXAt(C, hz), sd * 0.02, hz]]);
  } else if (stayed(C)) {
    // (the J/70's swept carbon spreaders 4.97 m up and cap shrouds to the hounds at the jib head)
    const sb = C.id === 'sportboat', J = sails.jib;
    const sprZ = sb ? 4.97 : mastBase + mastLen * 0.5, hz = sb && J ? J.tackZ + J.luff + 0.05 : C.mastHeight - 0.25;
    const sw = sb ? 0.27 : 0.15, sl = sb ? 0.78 : C.beam * 0.36;
    for (const sd of [-1, 1]) w.shrouds.push([[C.mastX - 0.1, sd * 0.45 * C.beam, C.freeboard], [mastXAt(C, sprZ) - sw, sd * sl, sprZ + 0.06], [mastXAt(C, hz), sd * 0.02, hz]]);
  }
  return w;
}
// the starboard shroud's point at height z (null above or below it)
function shroudAt(W, z) {
  const sh = W.shrouds.find((p) => p[0][1] > 0);
  if (!sh) return null;
  for (let i = 0; i < sh.length - 1; i++) {
    const a = sh[i], b = sh[i + 1];
    if (z >= a[2] && z <= b[2]) { const t = (z - a[2]) / (b[2] - a[2]); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }
  }
  return null;
}

// the gooseneck and the boom (drawn length: the cloth scales its own)
export const goose = (C) => ({ x: C.mastX - 0.02, z: C.boomZ });
export const boomLen = (s) => s.foot * 1.04;

// The largest angle the boom can swing to: where it comes up against the leeward shroud at its own height (less the
// boom's half-width). An unstayed mast has nothing there: the dinghy's boom goes on past square.
export function boomContactAngle(C, sails) {
  const s = sails.main, G = goose(C), P = shroudAt(rigWires(C, sails), C.boomZ), L = boomLen(s);
  if (!P) return 100 * DEG;
  const dx = G.x - P[0], r = Math.hypot(dx, P[1]);
  if (r > L) return 100 * DEG;                            // (the shroud stands beyond the boom's end)
  return Math.atan2(P[1], dx) - Math.atan2(0.04, r);
}
// the angle (from the centreline, at the luff) at which a section of the main at height z lies on the shroud or
// spreader there: the sail wraps round it (the strip model's upper sections go no further)
export function sectionContactAngle(C, sails, z, chord) {
  const P = shroudAt(rigWires(C, sails), z);
  if (!P) return Math.PI;
  const dx = mastXAt(C, z) - P[0];
  if (Math.hypot(dx, P[1]) > chord) return Math.PI;
  return Math.atan2(P[1], dx);
}

// ---- the mainsheet
// s.track = { x, z, half, s (boom block's distance from the gooseneck), horse (a rope bridle the block rides) }
// The car on its track: trav 0 = the windward end, 1 = the leeward end (side: the side the boom is on, +1 starboard).
// A horse has no car: the block slides to the point of the bridle under the boom.
export function sheetCar(C, s, trav, side, a, out = [0, 0, 0]) {
  const T = s.track, G = goose(C);
  out[0] = T.x; out[2] = T.z;
  out[1] = T.horse ? clamp(T.s * Math.sin(a), -T.half, T.half) : (side || 1) * lerp(-T.half, T.half, clamp(trav, 0, 1));
  void G;
  return out;
}
// boom block at boom angle a (+ to starboard) and elevation e
export function boomBlock(C, s, a, e = 0, out = [0, 0, 0]) {
  const G = goose(C), r = s.track.s, h = r * Math.cos(e);
  out[0] = G.x - h * Math.cos(a); out[1] = h * Math.sin(a); out[2] = G.z + r * Math.sin(e);
  return out;
}
const _b = [0, 0, 0], _c = [0, 0, 0];
export function sheetDist(C, s, a, car) {
  boomBlock(C, s, a, 0, _b);
  return Math.hypot(_b[0] - car[0], _b[1] - car[1], _b[2] - car[2]);
}
// sheet length for ease 0..1: hard in, the block is pulled down to the car at the middle of the track; fully eased,
// the boom reaches the shrouds with the car at the leeward end
export function sheetLenRange(C, s) {
  if (s._sheetRange) return s._sheetRange;
  const T = s.track, G = goose(C);
  const dxy = Math.abs(Math.hypot(G.x - T.x, 0) - T.s);
  const Lmin = Math.hypot(dxy, G.z - T.z);
  sheetCar(C, s, 1, 1, s.max, _c);
  const Lmax = sheetDist(C, s, s.max, _c);
  return (s._sheetRange = [Lmin, Math.max(Lmax, Lmin + 0.1)]);
}
export function sheetLen(C, s, ease) { const [a, b] = sheetLenRange(C, s); return lerp(a, b, clamp(ease, 0, 1)); }
// the boom angle (>= 0, on the car's side) at which a sheet of length L comes taut; the shrouds stop it at s.max
export function boomAngleForSheet(C, s, L, trav) {
  // (the distance grows with the angle from where the block is nearest the car: bisection)
  // (memo: the crew moves the sheet and car slowly, and this is asked every step)
  const M = s._memo || (s._memo = { L: NaN, trav: NaN, a: 0 });
  if (M.L === L && M.trav === trav) return M.a;
  let lo = 0, hi = s.max, res;
  if (sheetDist(C, s, hi, sheetCar(C, s, trav, 1, hi, _c)) <= L) res = hi;
  else {
    // start where the block is nearest the car
    let best = 0, bd = Infinity;
    for (let i = 0; i <= 12; i++) { const a = s.max * i / 12, dd = sheetDist(C, s, a, sheetCar(C, s, trav, 1, a, _c)); if (dd < bd) { bd = dd; best = a; } }
    if (bd >= L) res = best;
    else {
      lo = best;
      for (let i = 0; i < 30; i++) { const m = 0.5 * (lo + hi); if (sheetDist(C, s, m, sheetCar(C, s, trav, 1, m, _c)) < L) lo = m; else hi = m; }
      res = 0.5 * (lo + hi);
    }
  }
  M.L = L; M.trav = trav; M.a = res;
  return res;
}
// the ease that lets the boom out to angle a with the car at trav (the inverse, for the crew's trim)
export function easeForBoomAngle(C, s, a, trav) {
  const [L0, L1] = sheetLenRange(C, s), L = sheetDist(C, s, clamp(a, 0, s.max), sheetCar(C, s, trav, 1, a, _c));
  return clamp((L - L0) / (L1 - L0), 0, 1);
}
// the sheet's direction at the boom block (unit, from the block to the car) for boom angle a: its downward part is
// the leech tension it adds, its horizontal part across the boom holds the boom in
export function sheetDir(C, s, a, trav, side, out = [0, 0, 0]) {
  boomBlock(C, s, a, 0, _b); sheetCar(C, s, trav, side, a, _c);
  const dx = _c[0] - _b[0], dy = _c[1] - _b[1], dz = _c[2] - _b[2], l = Math.hypot(dx, dy, dz) || 1;
  out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
  return out;
}

// ---- the boom as a beam
// Pinned at the gooseneck and held up at its end by the leech, pulled down by the vang at xv and the sheet at xs
// (distances from the gooseneck, m; forces N, downward components). Returns the peak bending moment (N m), and the
// deflection below the straight line gooseneck-end at the vang and at the sheet block (m), from Euler-Bernoulli
// superposition of the two point loads on a simply supported span L of stiffness EI (N m^2).
export function boomBend(L, EI, xv, Fv, xs, Fs, out = {}) {
  const loads = [[xv, Fv], [xs, Fs]];
  // reactions: the end (leech) carries sum F x / L, the gooseneck the rest
  let Rend = 0; for (const [x, F] of loads) Rend += F * x / L;
  // moment at each load point (the peak of a point-loaded span is under a load)
  const M = (x) => { let m = Rend * (L - x); for (const [xi, F] of loads) if (xi > x) m -= F * (xi - x); return m; };
  out.M = Math.max(Math.abs(M(xv)), Math.abs(M(xs)));
  const defl = (x) => { let y = 0; for (const [c, F] of loads) { const b = L - c, xx = x <= c ? x : L - x, bb = x <= c ? b : c; y += F * bb * xx * (L * L - bb * bb - xx * xx) / (6 * EI * L); } return y; };
  out.dv = defl(xv); out.ds = defl(xs);
  return out;
}

// ---- the boom end in the sea
// Five points along the boom (angle a, elevation e, length L from the gooseneck G) in the rig frame; the boat's heel
// and heave put them in the level frame, and the sea's surface there (etaAt(level x, level y)) says how deep they are.
// Each immersed stretch drags across the water: 0.5 rho Cd (D + foot) |vn| vn per metre, with the water's velocity
// relative to it from the boat's surge, sway, yaw, roll and the boom's own swing. Returns the force on the boom (rig
// frame, N, summed) and its moment about the gooseneck's vertical axis (to swing the boom), and the loads on the hull
// (level-frame Y, X and the roll K and yaw N moments about the boat's reference point), in o.
export function boomDip(b, s, a, e, L, rate, ax, etaAt, o) {
  const C = b.cls, G = goose(C), { cphi, sphi, heaveH } = ax;
  o.X = 0; o.Y = 0; o.K = 0; o.N = 0; o.torque = 0; o.wet = 0;
  const n = 5, dl = L / n, D = 0.08 + 0.12;          // boom depth plus the sail's foot that goes under with it
  for (let i = 0; i < n; i++) {
    const r = (i + 0.5) * dl;
    const x = G.x - r * Math.cos(e) * Math.cos(a), y = r * Math.cos(e) * Math.sin(a), z = G.z + r * Math.sin(e);
    const Yl = y * cphi + z * sphi, H = z * cphi - y * sphi + heaveH;
    const depth = etaAt(x, Yl) - H;
    if (!(depth > -0.02)) continue;                 // (dry, or a non-finite state: nothing)
    const imm = clamp((depth + 0.02) / 0.15, 0, 1);
    // water velocity relative to the boom point (level frame): the boom moves with the hull and swings about G
    const vx = -(b.u - b.r * Yl) - rate * y, vy = -(b.v + b.r * x + b.p * H) - rate * (G.x - x) * cphi;
    // the boom's horizontal direction; drag acts across it
    const tx = -Math.cos(a), ty = Math.sin(a) * cphi;
    const tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl;
    const va = vx * ux + vy * uy, nx = vx - va * ux, ny = vy - va * uy, vn = Math.hypot(nx, ny);
    const q = 0.5 * 1025 * 1.1 * D * dl * imm * vn;
    const Fx = q * nx + 0.5 * 1025 * 0.05 * D * dl * imm * va * Math.abs(va) * ux, Fy = q * ny;
    o.X += Fx; o.Y += Fy; o.K += Fy * H; o.N += x * Fy - Yl * Fx;
    // about the gooseneck: the force's moment swings the boom (+ toward starboard)
    o.torque += (G.x - x) * Fy * cphi + y * Fx;
    o.wet = Math.max(o.wet, imm);
  }
  return o;
}
