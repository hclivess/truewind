// Rope physics for the lines you handle: a chain of point masses (position Verlet) in the boat's own frame, so the
// deck under a tail is still and a tail lying on it lies still. No three.js here (node tests run it: test/rope.mjs).
//
//  - the frame: the boat's (three.js inner-local: y up out of the deck). Gravity comes in tilted by the heel and
//    pitch, less the boat's own acceleration (heave, surge), so a tail on deck slides to leeward only when she heels
//    past what friction holds, and a hanging tail swings as she rolls.
//  - the step: frame time split into sub-steps of at most H (1/120 s), velocity carried across a change of step
//    (time-corrected Verlet), a frame longer than MAX_DT is slowed rather than integrated (a stall never explodes).
//  - damping: exp(-DAMP h) per step (the same per second at 30, 60 or 144 fps) plus quadratic air drag in the
//    apparent wind (weaker on deck: the boundary layer).
//  - contact: the deck / cabin top / cockpit sole is a height field, perfectly inelastic (no bounce: the normal
//    velocity is dropped), with Coulomb friction (static MU_S, sliding MU_K) worked on each step's displacement; a
//    wall (the side of the cabin, the coaming) stops the point where it was instead of lifting it onto the top.
//  - constraints: each segment's rest length, relaxed ITERS times a step (sweeping both ways), and a bending limit
//    (a rope does not fold back on itself in a sharp kink; it lies in loops).
export const H = 1 / 120, MAX_DT = 1 / 20, MAX_SUB = 6;
export const DAMP = 2.5, MU_S = 0.65, MU_K = 0.5, ITERS = 10, BEND = 1.55, STEP = 0.05;

export class RopeSim {
  constructor(n) {
    this.n = n;
    this.x = new Float64Array(3 * n); this.xp = new Float64Array(3 * n);
    this.pin = new Uint8Array(n);                 // 1: held where the caller puts it (an anchor, a block, a cleat)
    this.rest = new Float64Array(Math.max(1, n - 1));
    this.contact = new Uint8Array(n); this.pen = new Float64Array(n);
    this.fc = new Float64Array(3 * n).fill(NaN);  // the surface height last measured under each point, and where
    this.hPrev = H; this.t = 0; this.acc = 0; this.stepped = false;
    this.xs = new Float64Array(3 * n);           // the points before the last step (drawn between it and now)
    this._p = { x: 0, y: 0, z: 0 };
  }
  set(k, x, y, z) { const i = 3 * k; this.xs[i] = x; this.xs[i + 1] = y; this.xs[i + 2] = z; this.x[i] = this.xp[i] = x; this.x[i + 1] = this.xp[i + 1] = y; this.x[i + 2] = this.xp[i + 2] = z; }
  // a pinned point moved by the caller (its velocity is not the rope's business: it is carried, not integrated)
  place(k, x, y, z) { const i = 3 * k; this.x[i] = this.xp[i] = x; this.x[i + 1] = this.xp[i + 1] = y; this.x[i + 2] = this.xp[i + 2] = z; }
  // the kinetic energy per unit mass of the free points over the last step (m^2/s^2): the tests' measure of rest
  energy() {
    let e = 0; const h = this.hPrev;
    for (let k = 0; k < this.n; k++) {
      if (this.pin[k]) continue;
      const i = 3 * k, vx = (this.x[i] - this.xp[i]) / h, vy = (this.x[i + 1] - this.xp[i + 1]) / h, vz = (this.x[i + 2] - this.xp[i + 2]) / h;
      e += 0.5 * (vx * vx + vy * vy + vz * vz);
    }
    return e;
  }
  finite() { for (let i = 0; i < this.x.length; i++) if (!Number.isFinite(this.x[i])) return false; return true; }

  // advance dt seconds. env: { g: [x, y, z] (m/s^2: gravity less the frame's acceleration), air: [x, y, z] (m/s:
  // the apparent wind in the frame), cd (1/m: drag, a/|v|v), floorY(x, z) -> surface height or -Infinity,
  // contain(p) (moves a point {x, y, z} back aboard; optional), rad (the rope's radius) }
  advance(dt, env) {
    dt = Math.min(MAX_DT, Math.max(0, dt || 0));
    this.acc += dt;
    let n = 0;
    while (this.acc >= H && n < MAX_SUB) {
      if (this.acc < 2 * H || n === MAX_SUB - 1) this.xs.set(this.x);    // (the state before the last step: for drawing)
      this._step(H, env); this.acc -= H; n++;
    }
    if (n === MAX_SUB) this.acc = Math.min(this.acc, H);
    this.t += dt;
  }
  // point k as drawn: between the last two steps by the time left over (smooth at any refresh rate); a held point
  // where it is now
  drawn(k, out) {
    const i = 3 * k, a = this.pin[k] || !this.stepped ? 1 : this.acc / H, x = this.x, s = this.xs;
    out[0] = s[i] + (x[i] - s[i]) * a; out[1] = s[i + 1] + (x[i + 1] - s[i + 1]) * a; out[2] = s[i + 2] + (x[i + 2] - s[i + 2]) * a;
    return out;
  }
  _step(h, env) {
    const { n, x, xp, pin, rest, contact, pen } = this, g = env.g, air = env.air || ZERO, cd = env.cd ?? 0.03;
    const r = h / this.hPrev, damp = Math.exp(-DAMP * h), h2 = h * h, floorY = env.floorY, rad = env.rad || 0.004;
    // integrate
    for (let k = 0; k < n; k++) {
      if (pin[k]) continue;
      const i = 3 * k;
      let vx = (x[i] - xp[i]) * r * damp, vy = (x[i + 1] - xp[i + 1]) * r * damp, vz = (x[i + 2] - xp[i + 2]) * r * damp;
      // air drag in the apparent wind (a tail lying on deck is mostly out of it)
      const rx = air[0] - vx / h, ry = air[1] - vy / h, rz = air[2] - vz / h, sp = Math.sqrt(rx * rx + ry * ry + rz * rz) * cd * (contact[k] ? 0.25 : 1);
      xp[i] = x[i]; xp[i + 1] = x[i + 1]; xp[i + 2] = x[i + 2];
      x[i] += vx + (g[0] + rx * sp) * h2; x[i + 1] += vy + (g[1] + ry * sp) * h2; x[i + 2] += vz + (g[2] + rz * sp) * h2;
    }
    this.hPrev = h; this.stepped = true;
    // start of step positions of the free points (friction works on the whole step's motion)
    const x0 = this._x0 || (this._x0 = new Float64Array(3 * n));
    if (floorY) for (let k = 0; k < n; k++) {
      const i = 3 * k; x0[i] = xp[i]; x0[i + 2] = xp[i + 2];
      contact[k] = 0; pen[k] = 0;
      if (pin[k]) continue;
      const d = this._floor(k, floorY, env.contain, rad);
      if (d > 0) { contact[k] = 1; pen[k] = d; }
    }
    // constraints: segment lengths (sweeping forward then back), the bending limit, the surface
    for (let it = 0; it < ITERS; it++) {
      const fwd = (it & 1) === 0;
      for (let q = 0; q < n - 1; q++) {
        const k = fwd ? q : n - 2 - q, a = 3 * k, b = a + 3;
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        const pa = pin[k], pb = pin[k + 1];
        if (pa && pb) continue;
        const diff = (len - rest[k]) / len, wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
        x[a] += dx * diff * wa; x[a + 1] += dy * diff * wa; x[a + 2] += dz * diff * wa;
        x[b] -= dx * diff * wb; x[b + 1] -= dy * diff * wb; x[b + 2] -= dz * diff * wb;
      }
      if (it % 3 === 2) for (let k = 0; k < n - 2; k++) {
        // (k and k+2 no closer than BEND x the shorter rest: no hairpin kinks)
        const a = 3 * k, b = a + 6, pa = pin[k], pb = pin[k + 2];
        if (pa && pb) continue;
        const min = BEND * Math.min(rest[k], rest[k + 1]);
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        if (len >= min) continue;
        const diff = 0.5 * (len - min) / len, wa = pa ? 0 : pb ? 2 : 1, wb = pb ? 0 : pa ? 2 : 1;
        x[a] += dx * diff * wa * 0.5; x[a + 1] += dy * diff * wa * 0.5; x[a + 2] += dz * diff * wa * 0.5;
        x[b] -= dx * diff * wb * 0.5; x[b + 1] -= dy * diff * wb * 0.5; x[b + 2] -= dz * diff * wb * 0.5;
      }
      if (floorY && (it === ITERS - 1 || it === 4)) for (let k = 0; k < n; k++) {
        if (pin[k]) continue;
        const d = this._floor(k, floorY, it === ITERS - 1 ? env.contain : null, rad);
        if (d > 0) { contact[k] = 1; pen[k] += d; }
      }
    }
    // Coulomb friction on what the step moved each point along the surface (its own inertia and the pull of the rope
    // alike): held if it is less than MU_S x how hard the surface pushed back this step, else slowed by MU_K x that
    if (floorY) for (let k = 0; k < n; k++) {
      if (!contact[k]) continue;
      const i = 3 * k, dx = x[i] - x0[i], dz = x[i + 2] - x0[i + 2], d2 = Math.sqrt(dx * dx + dz * dz), d = Math.max(pen[k], 1e-4 * h2 / (H * H));
      if (d2 < MU_S * d) { x[i] = x0[i]; x[i + 2] = x0[i + 2]; }
      else { const f = 1 - MU_K * d / d2; x[i] = x0[i] + dx * f; x[i + 2] = x0[i + 2] + dz * f; }
    }
    // inelastic contact: whatever the surface pushed back is not carried into the next step as a bounce
    if (floorY) for (let k = 0; k < n; k++) if (contact[k] && x[3 * k + 1] > xp[3 * k + 1]) xp[3 * k + 1] = x[3 * k + 1];
  }
  // put point k back on or above the surface; returns how far it was pushed up (0: not touching)
  _floor(k, floorY, contain, rad) {
    const x = this.x, xp = this.xp, i = 3 * k, p = this._p;
    if (contain) {
      p.x = x[i]; p.y = x[i + 1]; p.z = x[i + 2]; contain(p);
      if (p.x !== x[i] || p.z !== x[i + 2]) { x[i] = p.x; x[i + 2] = p.z; xp[i] = p.x; xp[i + 2] = p.z; }   // (into the rail: stopped)
    }
    // (the surface under it, measured again only once it has moved a centimetre across: most of a tail lies still)
    let top;
    const cx = x[i] - this.fc[3 * k], cz = x[i + 2] - this.fc[3 * k + 2];
    if (cx * cx + cz * cz < 1e-4) top = this.fc[3 * k + 1];
    else { top = floorY(x[i], x[i + 2]); this.fc[3 * k] = x[i]; this.fc[3 * k + 1] = top; this.fc[3 * k + 2] = x[i + 2]; }
    if (!(top > -Infinity)) return 0;
    top += rad;
    const y = x[i + 1];
    if (y >= top) return y < top + 0.002 ? 1e-4 : 0;                 // (resting on it: still in contact)
    if (top - y > STEP) {
      // a wall (the cabin side, a coaming): back where it came from across, if the surface there is below it
      const t0 = floorY(xp[i], xp[i + 2]) + rad;
      if (!(t0 > y + 0.01)) { x[i] = xp[i]; x[i + 2] = xp[i + 2]; if (y < t0) { x[i + 1] = t0; return t0 - y; } return 1e-4; }
    }
    x[i + 1] = top;
    return top - y;
  }
}
const ZERO = [0, 0, 0];

// lay a free tail out as it would fall off a cleat: from (ax, ay, az) toward (bx, by, bz), and whatever length is
// left over in a flat coil of radius R there, turns stacked on each other. Writes points k0 .. k0 + m (k0 is the
// anchor) spaced seg apart.
export function coilTail(sim, k0, m, seg, ax, ay, az, bx, by, bz, R = 0.11) {
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const D = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6; dx /= D; dy /= D; dz /= D;
  // a horizontal direction across the lead for the coil
  let ux = -dz, uz = dx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const cx = bx + ux * R, cz = bz + uz * R;
  const a0 = Math.atan2(bz - cz, bx - cx), turn = 2 * Math.PI * R, lift = 0.012;
  for (let j = 0; j <= m; j++) {
    const s = j * seg;
    if (s <= D) sim.set(k0 + j, ax + dx * s, ay + dy * s, az + dz * s);
    else {
      const u = s - D, a = a0 + u / R, layer = Math.floor(u / turn);
      sim.set(k0 + j, cx + Math.cos(a) * R * (1 - 0.12 * layer), by + lift * layer, cz + Math.sin(a) * R * (1 - 0.12 * layer));
    }
  }
}
