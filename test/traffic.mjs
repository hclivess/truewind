// Harbour traffic on every venue: vessels placed and kept on the water, nobody stuck, ferries running their
// routes. Simulates the traffic for a while at the frame rate the game gives it, with a boat sitting in the way.
// Run: node test/traffic.mjs [venue|all] [minutes] [density]   (IMG=dir writes a PPM chart of each venue)
import { Environment, KT } from '../js/env.js';
import { VENUES, World } from '../js/world.js';
import { Traffic } from '../js/traffic.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [which = 'all', mins = '20', dens = 'busy'] = process.argv.slice(2);
let fail = 0;
for (const v of VENUES) {
  if (which !== 'all' && which !== v.id) continue;
  const geo = v.open ? null : JSON.parse(readFileSync(`data/venues/${v.id}.json`));
  const tf = `data/venues/${v.id}.traffic.json`, data = existsSync(tf) ? JSON.parse(readFileSync(tf)) : null;
  const world = new World(v, geo);
  const env = new Environment({ tws: v.windKt * KT, twd: v.wind, gust: 0.4, shift: 6, seed: 3, currentKt: v.current?.kt ?? 0, currentDir: v.current?.dir ?? 90 });
  const piers = (geo?.piers || []).filter(p => p.kind !== 'bridge');
  const T = new Traffic(world, data, { density: dens, seed: 5, twd: env.wind.twd, piers });
  // distance from a point to the nearest pier, breakwater or jetty (less its half width)
  const pierDist = (x, z) => { let best = 1e9; for (const p of piers) for (let i = 0; i + 3 < p.pts.length; i += 2) { const ax = p.pts[i], az = p.pts[i + 1], dx = p.pts[i + 2] - ax, dz = p.pts[i + 3] - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z) - (p.w ?? 6) / 2); } return best; };
  let pierHit = null;
  const c = T.counts();
  // a sailing boat parked in the busiest lane (a ferry route, else the middle of the harbour)
  const lane = T.ferryRails[0]?.rail, o = {};
  if (lane) lane.at(lane.L * 0.5, o); else { o.x = 0; o.z = 0; }
  const player = { id: 0, x: o.x, z: o.z, psi: 0, u: 0, v: 0, cls: { loa: 7, beam: 2.3, bowX: 3.5, sternX: -3.4 } };
  const dt = 1 / 30, steps = Math.round(+mins * 60 / dt);
  const minSdf = {}, travel = new Map(), legs = new Map(), prevHidden = new Map();
  // leaps: a vessel moved further between two looks (0.2 s) than 20 m/s takes it, or turned more than 3 rad/s
  // (a chain ferry changes ends at once) (a moored boat lay back to its buoy a quarter second in, leaping its scope; a new leg or the way back from a
  // terminal set the heading at once; a step to starboard toward the shore was taken back in one frame)
  const last = new Map(); let leap = null, nLeap = 0;
  let hits = 0, worst = null;
  const t0 = Date.now();
  for (let s = 0; s < steps; s++) {
    const t = s * dt;
    T.update(dt, t, env, [player]);
    T.collide([player], () => hits++);
    player.u = player.v = 0;
    if (s % 6) continue;
    for (const w of T.vessels) {
      if (w.ferry) { const dw = w.dwell > 0; if (dw && !prevHidden.get(w)) legs.set(w, (legs.get(w) || 0) + 1); prevHidden.set(w, dw); }
      if (w.hidden) { last.delete(w); continue; }
      const q = last.get(w);
      if (q) {
        const jump = Math.hypot(w.x - q.x, w.z - q.z), turn = Math.abs(Math.atan2(Math.sin(w.psi - q.psi), Math.cos(w.psi - q.psi)));
        if (jump > 20 * 6 * dt + 1 || (turn > 3 * 6 * dt && w.type !== 'chain')) { nLeap++; if (!leap) leap = `${w.type} ${w.mode} ${jump.toFixed(1)} m, ${(turn / Math.PI * 180).toFixed(0)} deg in 0.2 s at t ${t.toFixed(1)}`; }
      }
      last.set(w, { x: w.x, z: w.z, psi: w.psi });
      const d = world.open ? 1e4 : world.sdfAt(w.x, w.z);
      if (!(w.type in minSdf) || d < minSdf[w.type]) minSdf[w.type] = d;
      if (d <= 1 && !worst) worst = `${w.type} ${w.mode} at ${w.x.toFixed(0)},${w.z.toFixed(0)} sdf ${d.toFixed(1)}`;
      if (w.mode === 'rail' && !w.ferry && s % 60 === 0 && !pierHit && pierDist(w.x, w.z) < 0) pierHit = `${w.type} at ${w.x.toFixed(0)},${w.z.toFixed(0)}`;
      if (w.mode === 'rail') {
        const p = travel.get(w) || { d: 0, x: w.x, z: w.z }; p.d += Math.hypot(w.x - p.x, w.z - p.z); p.x = w.x; p.z = w.z; travel.set(w, p);
      }
    }
  }
  const ms = (Date.now() - t0) / steps;
  const movers = T.movers.filter(w => !w.ferry), stuck = movers.filter(w => (travel.get(w)?.d ?? 0) < 300);
  const ferries = T.movers.filter(w => w.ferry);
  // a ferry should finish a leg when the run is long enough for one
  const lazy = ferries.filter(w => (legs.get(w) || 0) < 1 && w.ferry.rail.L / (w.cruise * 0.7) + 200 < +mins * 60);
  const ok = !worst && !stuck.length && !lazy.length && !pierHit && !leap;
  if (!ok) fail++;
  console.log(`${v.id.padEnd(9)} ${ok ? 'ok  ' : 'FAIL'} berthed ${c.berthed}, moored ${c.moored}, anchored ${c.anchored}, ferries ${c.ferries} on ${T.ferryRails.length} routes, under way ${c.underway}` +
    ` | build ${T.buildMs ?? 0} ms, ${(ms * 1000).toFixed(0)} us/update | min shore distance ${Object.entries(minSdf).map(([k, d]) => `${k} ${d.toFixed(0)}`).join(' ')}` +
    ` | ferry legs ${[...legs.values()].reduce((a, b) => a + b, 0)} | bumps ${hits}` + (worst ? ` | ON LAND: ${worst}` : '') + (pierHit ? ` | THROUGH A PIER: ${pierHit}` : '') + (leap ? ` | LEAPS ${nLeap}: ${leap}` : '') +
    (stuck.length ? ` | STUCK: ${stuck.map(w => `${w.type}@${w.x.toFixed(0)},${w.z.toFixed(0)} ${(travel.get(w)?.d ?? 0).toFixed(0)}m`).join(' ')}` : '') +
    (lazy.length ? ` | FERRY NO LEG: ${lazy.map(w => w.name || w.type).join(', ')}` : ''));
  if (process.env.IMG) {
    const S = 800, img = Buffer.alloc(S * S * 3), px = (x, z, col, r = 1) => {
      const i0 = Math.floor((x + world.R) / (2 * world.R) * S), j0 = Math.floor((z + world.R) / (2 * world.R) * S);
      for (let j = j0 - r + 1; j < j0 + r; j++) for (let i = i0 - r + 1; i < i0 + r; i++) if (i >= 0 && j >= 0 && i < S && j < S) img.set(col, (j * S + i) * 3);
    };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const x = -world.R + (i + .5) * 2 * world.R / S, z = -world.R + (j + .5) * 2 * world.R / S; img.set(world.open || world.sdfAt(x, z) > 0 ? [30, 60, 90] : [200, 200, 190], (j * S + i) * 3); }
    for (const fr of T.ferryRails) for (let s = 0; s < fr.rail.L; s += 10) { fr.rail.at(s, o); px(o.x, o.z, [255, 200, 0]); }
    for (const w of T.movers) if (w.rail && !w.ferry) for (let s = 0; s < w.rail.L; s += 10) { w.rail.at(s, o); px(o.x, o.z, w.sails ? [120, 255, 120] : [255, 120, 255]); }
    const col = { berth: [255, 255, 255], mooring: [0, 255, 255], anchor: [255, 60, 60], rail: [255, 140, 0] };
    for (const w of T.vessels) px(w.x, w.z, col[w.mode] || [255, 0, 0], w.mode === 'rail' ? 3 : 2);
    writeFileSync(`${process.env.IMG}/${v.id}.ppm`, Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), img]));
  }
}
console.log(fail ? `${fail} venue(s) failed` : 'all venues ok');
process.exit(fail ? 1 : 0);
