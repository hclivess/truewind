// The background traffic's seamanship (js/traffic.js), on the open sea and in the Solent:
//  1. COLREG: a motor boat crossing a yacht under sail gives way (slows, steps to starboard) and the yacht stands on;
//  2. a ship in the channel (constrained by her draught) stands on for a small sailing boat crossing ahead, sounds
//     five short blasts at her, and acts only at the last;
//  3. light air: the cruising yachts under way motor below 6 kn of wind and sail in a breeze;
//  4. ships in transit keep to water deeper than their draught, from one edge of the chart to another;
//  5. a traffic yacht 25 m from the camera sits in the water as it is drawn: her waterline (posed as traffic-render.js
//     poses her, on WaveField.ride with the grid's filter) against the drawn sea at 28 points round it — no bias, the
//     topsides never wholly out of it nor the deck under it (hovering, or sunk).
// Run: node test/npc.mjs
import { Environment, KT, DEG, drawnSeaKeep } from '../js/env.js';
import { VENUES, World } from '../js/world.js';
import { Traffic, Rail, VESSELS, waterlineHalf } from '../js/traffic.js';
import { readFileSync } from 'node:fs';
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const hyp = Math.hypot;

// ---------------------------------------------------------------- 1 and 2: encounters on the open sea
{
  const v = VENUES.find(x => x.id === 'open'), world = new World(v, null);
  const env = new Environment({ tws: 12 * KT, twd: 0, gust: 0, shift: 0, seed: 1 });   // (wind from the north: from -z)
  const T = new Traffic(world, null, { density: 'light', seed: 2, twd: 0 });
  T.movers.length = 0; T.vessels.length = 0;
  // a mover on a straight rail from (x0, z0) heading hdg, at speed kn
  const put = (type, x0, z0, hdg, kn, o = {}) => {
    const w = T.make(type, { mode: 'rail', scale: 1, ...o });
    const fx = Math.sin(hdg), fz = -Math.cos(hdg);
    w.rail = new Rail([x0, z0, x0 + fx * 3000, z0 + fz * 3000]); w.s = 0; w.fwd = true;
    w.x = x0; w.z = z0; w.psi = hdg; w.cruise = kn * KT; w.u = kn * KT; w.need = 10; w.stuck = 0; w.lastS = 0; w.twdPlan = 0;
    T.movers.push(w);
    return w;
  };
  // a yacht reaching east on starboard tack (wind from the north on her port side? from 0 deg, heading 90: the wind
  // over her port bow: port tack — she is sail all the same) and a motor boat coming north from her starboard side
  // on a course to meet her
  const yacht = put('yacht', -185, 0, 90 * DEG, 6, { sails: true });
  const motor = put('motor', 0, 432, 0, 14);   // (heading north, -z: both at the meeting point in a minute)
  let minD = 1e9, motorSlow = 1e9, yachtMin = 1e9;
  const dt = 1 / 30;
  for (let s = 0; s < 120 / dt; s++) {
    const t = s * dt;
    T.update(dt, t, env, []);
    minD = Math.min(minD, hyp(yacht.x - motor.x, yacht.z - motor.z));
    if (hyp(yacht.x - motor.x, yacht.z - motor.z) < 250) { motorSlow = Math.min(motorSlow, motor.u / KT); yachtMin = Math.min(yachtMin, yacht.u / KT); }
  }
  check(minD > (yacht.L + motor.L) / 2 + 25 && motorSlow < 12 && yachtMin > 5, `power gives way to sail: closest ${minD.toFixed(0)} m, motor boat down to ${motorSlow.toFixed(1)} kn, the yacht stood on at ${yachtMin.toFixed(1)}+ kn`);

  // a ship in transit heading north at 11 kn; a small sailing boat (the player) crossing ahead from her port side,
  // slowly, on a collision course
  T.movers.length = 0; T.vessels.length = 0; T.events.length = 0;
  const ship = put('ship', 0, 520, 0, 11, { transit: true }); ship.need = 40;
  const player = { x: -140, z: 0, psi: 90 * DEG, u: 1.5, v: 0, cls: { loa: 8, beam: 2.6, bowX: 4, sternX: -4 } };
  let doubt = null, shipMin = 99, uAt600 = null;
  for (let s = 0; s < 120 / dt; s++) {
    const t = s * dt;
    T.update(dt, t, env, [player]);
    player.x += Math.sin(player.psi) * player.u * dt; player.z -= Math.cos(player.psi) * player.u * dt;
    const d = hyp(ship.x - player.x, ship.z - player.z);
    for (const e of T.events.splice(0)) if (e.type === 'horn' && e.kind === 'doubt' && e.v === ship && doubt === null) doubt = d;
    if (d > 500 && d < 700 && uAt600 === null) uAt600 = ship.u / KT;
    if (d > 200) shipMin = Math.min(shipMin, ship.u / KT);
  }
  check(doubt !== null && doubt > 150, `the ship sounds five short blasts at a boat standing into her way: ${doubt === null ? 'never' : 'at ' + doubt.toFixed(0) + ' m'}`);
  check(shipMin > 9, `the ship stands on (constrained by her draught) until close: ${shipMin.toFixed(1)} kn while more than 200 m off`);
}

// ---------------------------------------------------------------- 3 and 4: the Solent
{
  const v = VENUES.find(x => x.id === 'solent'), geo = JSON.parse(readFileSync('data/venues/solent.json')), data = JSON.parse(readFileSync('data/venues/solent.traffic.json'));
  const world = new World(v, geo);
  const piers = (geo.piers || []).filter(p => p.kind !== 'bridge');
  for (const kt of [4, 14]) {
    const env = new Environment({ tws: kt * KT, twd: v.wind, gust: 0.2, shift: 3, seed: 3 });
    const T = new Traffic(world, data, { density: 'normal', seed: 5, twd: env.wind.twd, tws: kt * KT, piers });
    let n = 0, sail = 0, u = 0;
    const dt = 1 / 30;
    for (let s = 0; s < 240 / dt; s++) {
      T.update(dt, s * dt, env, []);
      if (s % 30) continue;
      for (const w of T.movers) if (w.type === 'yacht' && !w.hidden && !(w.dwell > 0)) { n++; if (w.sails) sail++; u += w.u / KT; }
    }
    const f = sail / Math.max(1, n);
    check(kt < 6 ? f < 0.05 && u / n > 4.5 : f > 0.6, `${kt} kn of wind: ${(100 * f).toFixed(0)} % of the yachts under way under sail, ${(u / n).toFixed(1)} kn on average`);
    if (kt === 14) {
      const ships = T.movers.filter(w => w.transit);
      let shallow = 1e9, ok = ships.length > 0;
      for (const w of ships) { const o = {}; for (let s = 0; s < w.rail.L; s += 25) { w.rail.at(s, o); shallow = Math.min(shallow, world.depthAt(o.x, o.z) - w.draught); } }
      check(ok && shallow > 0.5, `${ships.length} ship(s) in transit, the least water under the keel along their routes ${shallow.toFixed(1)} m`);
    }
  }
}
// ---------------------------------------------------------------- 5: the waterline on the drawn sea
{
  const GRID = { N: 360, R: 6500, a: 0.035 };
  for (const [kt, swell] of [[14, 0], [20, 1.5]]) {
    const env = new Environment({ tws: kt * KT, twd: 0, weather: 'steady', seed: 7, fetchKm: 20, swellH: swell, swellT: 9 });
    env.tick(0);
    const W = env.waves, o = {}, o2 = {}, P = {};
    const drawnAt = (x, z, t, keep) => W.sample(x, z, t, o).h - W.ride(x, z, t, 0, 0, 0, keep, o2, true).h;
    const v = { type: 'yacht', T: VESSELS.yacht, L: VESSELS.yacht.L, B: VESSELS.yacht.B, scale: 1, heel: 0, trim: 0, psi: 0.6 }, F = 1.05;
    let n = 0, s1 = 0, s2 = 0, dry = 0, wet = 0, worst = 0;
    for (let i = 0; i < 200; i++) {
      const t = 50 + i * 0.31; v.x = 300 + i * 1.7; v.z = -100 + i * 0.9; v.psi = 0.6 + 0.01 * i;
      const cx = v.x - 25, cz = v.z;
      const keep = (x, z) => drawnSeaKeep(GRID, Math.round(cx / 4) * 4, Math.round(cz / 4) * 4, cx, cz, W.Hs, x, z, {});
      // (traffic-render.js TrafficView.update)
      W.ride(v.x, v.z, t, v.psi, v.L, v.B, keep(v.x, v.z), P);
      const heave = P.h, pitch = Math.atan(P.al), roll = -Math.atan(P.at);
      const fx = Math.sin(v.psi), fz = -Math.cos(v.psi), sx = -fz, sz = fx;
      let dryAll = true, wetAny = false;
      for (let k = 0; k < 28; k++) {
        const u = k / 28, side = u < 0.5 ? 1 : -1, f = u < 0.5 ? u * 2 : 2 - u * 2, along = v.L * (0.5 - f) * 0.97, hb = waterlineHalf(v, 1 - f);
        const x = v.x + fx * along + sx * side * hb, z = v.z + fz * along + sz * side * hb;
        const hull = heave + along * Math.sin(pitch) - side * hb * Math.sin(roll), sea = drawnAt(x, z, t, keep(x, z)), dz = sea - hull;
        s1 += dz; s2 += dz * dz; n++; worst = Math.max(worst, Math.abs(dz));
        if (dz > -0.02) dryAll = false;                    // (the water up to her waterline here: not hovering)
        if (dz > F * 0.9) wetAny = true;                    // (the sea over her deck)
      }
      if (dryAll) dry++; if (wetAny) wet++;
    }
    const mean = s1 / n, rms = Math.sqrt(s2 / n);
    console.log(`     ${kt} kn${swell ? ' + ' + swell + ' m swell' : ''} (Hs ${W.Hs.toFixed(2)} m): drawn sea - waterline ${(mean * 100).toFixed(1)} cm mean, ${(rms * 100).toFixed(1)} cm rms, worst ${(worst * 100).toFixed(0)} cm; clear of the water all round ${dry}/200, deck awash ${wet}/200`);
    check(Math.abs(mean) < 0.03 && dry === 0 && wet === 0, `a traffic yacht sits in the drawn sea (${kt} kn${swell ? ', swell' : ''}): no bias, never hovering, never awash`);
  }
}
console.log(fail ? `${fail} FAILED` : 'all passed');
process.exit(fail ? 1 : 0);
