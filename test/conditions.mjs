// Sailing in every kind of water the game has, not only flat water in a steady wind: each class on the autopilot
// (wind-vane mode: the player's, and the helm the AI fleet steers with) close-hauled, beam-on and broad reaching, in
// flat water, light air, wind seas from 8 to 25 kn, an ocean swell, 3 m of water, a cross stream, puffs and shifts,
// squalls. What a sailor would notice is checked against what real boats do:
//   - it holds its course: no broach or round-up (35 deg or more off the angle held) for more than a few seconds,
//     and the heading's wander (sd) within a helmsman's: 8 deg in flat water, 12 in a sea, 18 in an ocean sea (4 more
//     running)
//   - a sea slows a boat but does not stop it: at least 60% of its flat-water speed in the same 14 kn
//   - leeway through the water as real hulls make: close-hauled under 10 deg in flat water, 11 in a sea, 13 in 20 kn,
//     16 in an ocean sea (slowed, the keel needs more angle); under 7 reaching
//   - heel within reason: no knockdown past 50 deg (a keelboat) in anything short of the ocean sea; no capsize
//   - no NaN, never aground in open water
// node test/conditions.mjs [CLS=a,b] [CONDS=sea14,...] [TWAS=45,90,140] [SECS=120] [N=workers] [LOD=0]
import { runPool } from './lib/pool.mjs';
import { CONDS } from './conditions-job.mjs';
import os from 'node:os';

const CLS = (process.env.CLS || 'blackwatch,j24,contessa32,catalina30,dragon,dinghy,sportboat,tp52,cat').split(',');
const CS = (process.env.CONDS || Object.keys(CONDS).join(',')).split(',');
const TWAS = (process.env.TWAS || '45,90,140').split(',').map(Number);
const SECS = +(process.env.SECS ?? 120);
const jobs = [];
for (const cls of CLS) for (const cond of CS) for (const twa of TWAS) jobs.push({ cls, cond, twa, secs: SECS });
const t0 = Date.now();
const res = (await runPool(jobs, { n: +(process.env.N ?? Math.max(1, os.cpus().length - 1)), mod: '../conditions-job.mjs', fn: 'runCond', timeoutMin: 20 })).map(r => r.res);
const key = (r) => `${r.cls}|${r.twa}`;
const flat = new Map(res.filter(r => r.cond === 'flat' && !r.error).map(r => [key(r), r]));

let fails = 0;
const failsBy = {};
const lim = {
  // (the heading's wander: tighter on the wind, where a helm steers to the telltales, than running in a seaway)
  sd: { flat: 8, light: 12, ocean25: 18 },
  // (speed against flat water in the same 14 kn: the sea, the shallows, the stream, the puffs)
  speed: { sea14: 0.6, shallow: 0.55, current: 0.6, gusty: 0.6 },
  // (leeway close-hauled: a sea slows a boat and her keel needs more angle for the same side force, about as 1 / speed^2)
  lee: { flat: 10, sea20: 13, ocean25: 16 },
};
for (const cls of CLS) {
  console.log(`\n${cls}`);
  for (const cond of CS) {
    const row = [];
    for (const twa of TWAS) {
      const r = res.find(q => q.cls === cls && q.cond === cond && q.twa === twa);
      if (!r || r.error) { row.push(`${twa}: ERROR ${r && r.error}`); fails++; continue; }
      const bad = [];
      const f = flat.get(key(r));
      if (r.nan) bad.push('NaN');
      if (r.offMax > 4) bad.push(`off course ${r.offMax.toFixed(0)}s`);
      const sdMax = (lim.sd[cond] ?? 12) + (twa > 120 ? 4 : 0);
      const wander = twa < 60 ? r.twaSd : r.hdgSd;   // (on the wind it follows the shifts, to the telltales: there the angle to the wind is what it holds)
      if (wander > sdMax) bad.push(`wanders ±${wander.toFixed(0)}°`);
      const sp = lim.speed[cond];
      if (sp && f && r.bsp < sp * f.bsp) bad.push(`slow ${(100 * r.bsp / f.bsp).toFixed(0)}% of flat`);
      if (cond !== 'light' && r.bsp > 0.5 && r.lee > (twa < 60 ? lim.lee[cond] ?? 11 : 7)) bad.push(`leeway ${r.lee.toFixed(0)}°`);
      if (!r.dinghy && cond !== 'ocean25' && r.heelMax > 50) bad.push(`knockdown ${r.heelMax.toFixed(0)}°`);
      if (r.capsized > 0 && cond !== 'ocean25') bad.push('capsized');
      if (r.aground > 0) bad.push('aground');
      if (bad.length) { fails++; (failsBy[cond] = failsBy[cond] || []).push(`${cls} ${twa}`); }
      row.push(`${String(twa).padStart(3)}° ${r.twaMean.toFixed(0).padStart(3)}±${r.twaSd.toFixed(0).padStart(2)} ${r.bsp.toFixed(1).padStart(4)}kn lw${r.lee.toFixed(0).padStart(2)} heel ${r.heelRms.toFixed(0).padStart(2)}/${r.heelMax.toFixed(0).padStart(2)} rud${r.rudMax.toFixed(0).padStart(3)}${bad.length ? '  FAIL ' + bad.join(', ') : ''}`);
    }
    const hs = res.find(q => q.cls === cls && q.cond === cond)?.hs ?? 0;
    console.log(`  ${cond.padEnd(8)} Hs ${hs.toFixed(1)}  ${row.join(' | ')}`);
  }
}
console.log(`\n${jobs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${fails} failing`);
for (const [c, l] of Object.entries(failsBy)) console.log(`  ${c.padEnd(8)} ${l.length}: ${l.join(', ')}`);
process.exit(fails ? 1 : 0);
