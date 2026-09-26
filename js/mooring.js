// Mooring and docking lines (pure logic, no three.js): tying up alongside a pier or pontoon (OSM man_made=pier
// ways: the dock edge is the way offset by half its width) or to a mooring buoy, fenders against the dock,
// casting off.
//
//  * LINES. Bow line, stern line and two springs from the boat's cleats (bow, quarter, amidships) to cleats on the
//    dock edge, each a spring-damper that only pulls: F = k (L - L0) + c dL/dt for L > L0, k = EA / L0 with the
//    rope's axial stiffness (12 mm polyester braid: EA ~ 250 kN) softened by the knots and the cleat's give, c at
//    ~40% of critical for the boat's mass. Tied with ~0.3 m of slack so she can rise and fall and surge a little.
//  * FENDERS. Cylindrical fenders on the dock side, ~0.2 m diameter: a contact force when the hull side comes
//    within a fender's diameter of the dock edge, F = k_f d + c d', k_f ~ 30 kN/m (a fender squashed halfway
//    carries ~3 kN), so the hull itself never touches.
//  * A mooring buoy: a single bow line (a pennant) to the buoy, which rides on its own ground chain.
//  * All of it goes into the boat through js/physics.js ext (surge, sway, yaw, a little roll from the line heights).
import { clamp } from './physics.js';

const hyp = (x, y) => Math.sqrt(x * x + y * y);
// nearest point on a polyline pts [x0, z0, x1, z1, ...] to (x, z): { d, x, z, tx, tz (unit along), i }
export function nearestOnPolyline(pts, x, z, o = {}) {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const px = ax + dx * t, pz = az + dz * t, d = hyp(x - px, z - pz);
    if (d < best) { best = d; const L = Math.sqrt(L2); o.d = d; o.x = px; o.z = pz; o.tx = dx / L; o.tz = dz / L; o.i = k; }
  }
  o.d = best;
  return o;
}

export class Mooring {
  constructor(boat) {
    this.b = boat; this.C = boat.cls;
    this.lines = [];            // { name, bx (fwd), by (stbd), bz (up): cleat on the boat; px, pz: cleat ashore; L0 }
    this.fenders = null;        // { side, xs: [...], r, pier }
    this.kind = null;           // 'dock' | 'buoy'
    this.events = [];
    const m = boat.mass;
    this.EA = 250e3 * (m < 400 ? 0.3 : 1);        // (a dinghy's painter is thinner)
  }
  get tied() { return this.lines.length > 0; }
  // world position of a point in the boat frame (x fwd, y stbd)
  toWorld(bx, by, o = {}) { const b = this.b, s = Math.sin(b.psi), c = Math.cos(b.psi); o.x = b.x + s * bx + c * by; o.z = b.z - c * bx + s * by; return o; }
  // a dock within reach: the hull side within ~2.5 m of the dock edge, alongside (not bows-on), slow
  findDock(piers) {
    const b = this.b, C = this.C, half = C.multihull ? C.hullSpacing / 2 + C.hullBeam : C.beam / 2;
    let best = null;
    const tmp = {};
    for (const p of piers || []) {
      if (!p.pts || p.kind === 'bridge' || p.kind === 'wastewater_plant' || p.kind === 'clarifier' || p.kind === 'storage_tank') continue;
      nearestOnPolyline(p.pts, b.x, b.z, tmp);
      const gap = tmp.d - (p.w || 4) / 2 - half;
      if (gap < 3 && (!best || gap < best.gap)) best = { gap, pier: p, x: tmp.x, z: tmp.z, tx: tmp.tx, tz: tmp.tz };
    }
    return best;
  }
  findBuoy(buoys) {
    const b = this.b, C = this.C;
    const bow = this.toWorld(C.bowX, 0);
    let best = null;
    for (const m of buoys || []) { const d = hyp(m.x - bow.x, m.z - bow.z); if (d < 4 && (!best || d < best.d)) best = { d, m }; }
    return best;
  }
  // make fast alongside: bow and stern lines led forward and aft along the dock, springs crossing amidships
  tieDock(dock) {
    const b = this.b, C = this.C;
    const half = C.multihull ? C.hullSpacing / 2 + C.hullBeam * 0.5 : C.beam / 2;
    // which side of her is the dock on (+1 starboard)
    const fx = Math.sin(b.psi), fz = -Math.cos(b.psi), sx = Math.cos(b.psi), sz = Math.sin(b.psi);
    const side = Math.sign((dock.x - b.x) * sx + (dock.z - b.z) * sz) || 1;
    const edge = (dock.pier.w || 4) / 2;
    // the dock edge along her: the normal from the pier's centreline toward her
    let nx = b.x - dock.x, nz = b.z - dock.z; const nl = hyp(nx, nz) || 1; nx /= nl; nz /= nl;
    const along = (fx * dock.tx + fz * dock.tz) >= 0 ? 1 : -1;       // pier direction that points the way her bow does
    const ex = (d) => ({ x: dock.x + nx * edge + dock.tx * along * d, z: dock.z + nz * edge + dock.tz * along * d });
    // where along the dock her bow and stern are
    const proj = (wx, wz) => (wx - dock.x) * dock.tx * along + (wz - dock.z) * dock.tz * along;
    const bw = this.toWorld(C.bowX - 0.2, side * half * 0.6), sw = this.toWorld(C.sternX + 0.25, side * half * 0.9), mw = this.toWorld(0, side * half);
    const pb = proj(bw.x, bw.z), ps = proj(sw.x, sw.z), pm = proj(mw.x, mw.z);
    const lines = [
      ['Bow line', C.bowX - 0.2, side * half * 0.6, ex(pb + 2.0)],
      ['Stern line', C.sternX + 0.25, side * half * 0.9, ex(ps - 2.0)],
      ['Fore spring', 0.3, side * half, ex(pm - 2.6)],
      ['Aft spring', -0.3, side * half, ex(pm + 2.6)],
    ];
    this.lines = lines.map(([name, bx, by, p]) => { const w = this.toWorld(bx, by); return { name, bx, by, bz: C.freeboard + 0.05, px: p.x, pz: p.z, L0: hyp(p.x - w.x, p.z - w.z) + 0.3, T: 0, Lp: null }; });
    this.fenders = { side, xs: [C.sternX * 0.55, 0, C.bowX * 0.55], r: 0.1 + 0.03 * clamp(b.mass / 1000, 0, 2), pier: dock.pier, half };
    this.kind = 'dock';
    this.events.push({ msg: `Made fast alongside — bow, stern and springs, ${this.fenders.xs.length} fenders out` });
  }
  tieBuoy(buoy) {
    const C = this.C;
    this.lines = [{ name: 'Mooring pennant', bx: C.bowX, by: 0, bz: C.freeboard + 0.05, px: buoy.m.x, pz: buoy.m.z, L0: 3, T: 0, Lp: null, buoy: buoy.m }];
    this.fenders = null; this.kind = 'buoy';
    this.events.push({ msg: 'Picked up the mooring' });
  }
  castOff() {
    if (!this.tied) return false;
    this.lines = []; this.fenders = null; this.kind = null;
    this.events.push({ msg: 'Lines cast off — fenders in' });
    return true;
  }
  pre(dt, ext) {
    const b = this.b, C = this.C;
    if (!this.tied && !this.fenders) return;
    const s = Math.sin(b.psi), c = Math.cos(b.psi);
    const m = b.mass, cz = b.heave;
    for (const L of this.lines) {
      const w = this.toWorld(L.bx, L.by, this._w || (this._w = {}));
      const dx = L.px - w.x, dz = L.pz - w.z, dy = (L.buoy ? 0 : 0.8) - (cz + L.bz);   // (the dock ~0.8 m above the water)
      const len = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const Ld = L.Lp === null ? 0 : (len - L.Lp) / dt; L.Lp = len;
      const k = this.EA / Math.max(1, L.L0) * 0.25;          // knots, the cleat and the rope's construction: softer than the bare rope
      const cc = 2 * 0.4 * Math.sqrt(k * m);
      let T = len > L.L0 ? k * (len - L.L0) + cc * Ld : 0;
      T = clamp(T, 0, 60e3); L.T = T;
      if (T <= 0) continue;
      const ux = dx / len, uz = dz / len, uy = dy / len;
      const Fb = T * (ux * s - uz * c), Fs = T * (ux * c + uz * s);  // body frame: x fwd = (sin, -cos), y stbd = (cos, sin)
      ext.X += Fb; ext.Y += Fs; ext.N += L.bx * Fs - L.by * Fb; ext.K += Fs * L.bz - T * uy * L.by * 0.5;
    }
    // fenders: the hull side against the dock edge
    const F = this.fenders;
    if (F && F.pier) {
      const kf = 30e3 * clamp(m / 1000, 0.3, 3), cf = 2 * 0.5 * Math.sqrt(kf * m / F.xs.length);
      const tmp = this._t || (this._t = {});
      F.load = 0;
      for (const fx of F.xs) {
        const w = this.toWorld(fx, F.side * F.half, this._f || (this._f = {}));
        nearestOnPolyline(F.pier.pts, w.x, w.z, tmp);
        const edge = (F.pier.w || 4) / 2;
        const pen = edge + 2 * F.r - tmp.d;                        // fender squeezed between the hull and the dock
        if (pen <= 0) continue;
        let nx = w.x - tmp.x, nz = w.z - tmp.z; const nl = hyp(nx, nz) || 1; nx /= nl; nz /= nl;
        // velocity over the ground of that point of the hull, (u - r y, v + r x) in her frame, along the normal
        const fy = F.side * F.half, vbx = -b.r * fy, vby = b.r * fx;
        const vx = (b.vgx || 0) + vbx * s + vby * c, vz = (b.vgz || 0) - vbx * c + vby * s;
        const vn = vx * nx + vz * nz;
        const Fn = clamp(kf * pen - cf * vn, 0, 40e3);
        F.load = Math.max(F.load, Fn);
        const Fb = Fn * (nx * s - nz * c), Fs = Fn * (nx * c + nz * s);
        ext.X += Fb; ext.Y += Fs; ext.N += fx * Fs - fy * Fb;
      }
    }
  }
}
