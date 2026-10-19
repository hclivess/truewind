// The passage time predicted from the polar and the tide alone (no boat simulation): a VMG router. Every 20 s the
// estimated boat takes the heading whose speed over the ground (the polar's speed through the water at that true wind
// angle, plus the tide's stream where she is and when) makes the most toward the next turn of the route, and moves
// on it. Beating, that is the classic time = distance / VMG (switching tack whenever the other one pays: tacks cost
// nothing here, so it is a slight underestimate on a beat); across a tide it crabs. The wind: its mean, sheltered by
// the land as the game shelters it (world.shelterAt), from its mean direction.
import { wrap } from '../../js/physics.js';

export function routeEstimate({ world, env, A, legs, twd, tws, polar, L, tideT, dt = 20, maxT = 12 * 3600 }) {
  let x = A.x, z = A.z, t = 0, k = 0, dist = 0, tacks = 0, side = 0, stuck = 0;
  const c = {}, near = (i) => (i === legs.length - 1 ? Math.max(2 * L, 8) : Math.max(40, 5 * L));
  while (t < maxT) {
    const G = legs[k];
    let dx = G.x - x, dz = G.z - z, d = Math.hypot(dx, dz);
    if (d < near(k)) { if (k === legs.length - 1) return { t, dist, tacks }; k++; continue; }
    dx /= d; dz /= d;
    if (tideT) tideT.setTime(t);
    env.current.at(x, z, c);
    const U = tws * (world.open ? 1 : world.shelterAt(x, z));
    let best = -Infinity, bh = 0, bvx = 0, bvz = 0;
    for (let h = 0; h < 360; h += 2) {
      const ps = h * Math.PI / 180, twa = wrap(twd - ps) * 180 / Math.PI, v = polar(U, Math.abs(twa));
      const vx = v * Math.sin(ps) + c.x, vz = -v * Math.cos(ps) + c.z, m = vx * dx + vz * dz;
      if (m > best) { best = m; bh = twa; bvx = vx; bvz = vz; }
    }
    if (best < 0.05) { stuck += dt; if (stuck > 1800) return { t: Infinity, dist, tacks, why: 'no progress (tide)' }; } else stuck = 0;
    const s = Math.sign(bh); if (side && s !== side && Math.abs(bh) < 90) tacks++; side = s;
    const step = Math.min(dt, d / Math.max(best, 0.05));
    x += bvx * step; z += bvz * step; dist += Math.hypot(bvx, bvz) * step; t += step;
  }
  return { t: Infinity, dist, tacks, why: 'over the time limit' };
}
