// Size the generic rigs (js/rig-structure.js genericRig) on the solver's own sailing loads, as a rig designer checks a
// rig: for each class with no rig data of its own, sail her upwind (strip sails, 22 kn, heading held, auto trim, the
// crew hiking), read the windward caps', lowers' and forestay's tension and the mast's compression and critical factor,
// scale the load each carries beyond its dock tune to the righting moment of 30 deg (rm30), and resize: wires to
// ~2.8 x that load (when outside 2.5-3.5; the forestay, sized for its sag, only where it is short of 2.2), the mast's EI to a critical load ~2.7 x its compression (when outside
// 2.3-4). Prints the GENERIC_K table to paste into js/rig-structure.js.
//   node tools/size-rigs.mjs [class,class...]
import { Boat, autoTrim, makeSteadyEnv, CLASSES, CLASS_ORDER } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { RigStructure, RIG_DATA, GENERIC_K, genericRig, rm30 } from '../js/rig-structure.js';
const KT = 0.514444, DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const max = (v) => (Array.isArray(v) ? Math.max(...v) : v || 0);

// one class's margins at RM30 on rig spec `spec` (or the class's own): { cap, low, fore, mast } = strength / load
export function rigMargins(id, spec = null, tws = 22) {
  const C = CLASSES[id];
  const b = new Boat(id, { sailModel: 'strip', lod: 2 });
  if (spec) b.rigStruct = new RigStructure(b, spec);
  // (under full sail: the loads are scaled to RM30 by the heeling moment, and a crew that reefs at 18 kn (C.autoReef)
  // carried the Oceanis's rig at 22 kn under a reefed main and a rolled genoa, a different share between the stays)
  if (b.auto) b.auto.reef = false;
  const RM30 = rm30(C);
  // the dock: no wind, upright
  const env0 = makeSteadyEnv(0.01);
  b.reset(0, 0, 45 * DEG);
  for (let i = 0; i < 240; i++) { b.step(1 / 120, env0, 0); b.psi = 45 * DEG; b.r = 0; b.phi = 0; b.p = 0; b.u = 0; }
  const L0 = b.rigLoads, dock = { cap: max(L0.capShroud), low: max(L0.lowerShrouds), fore: max(L0.forestay), comp: L0.mastComp };
  const env = makeSteadyEnv(tws * KT);
  const acc = { cap: 0, low: 0, fore: 0, comp: 0, pcr: 0, K: 0, sag: 0 }; let n = 0;
  for (let i = 0; i < 120 * 14; i++) {
    autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0); b.psi = 45 * DEG; b.r = 0; b.x = 0; b.z = 0;
    if (i >= 120 * 8) {
      const L = b.rigLoads;
      acc.cap += max(L.capShroud); acc.low += max(L.lowerShrouds); acc.fore += max(L.forestay); acc.comp += L.mastComp; acc.pcr += L.buckling; acc.K += Math.abs(b.diag.sailK); acc.sag += b.rigStruct.sagN || 0; n++;
    }
  }
  for (const k in acc) acc[k] /= n;
  const f = RM30 / Math.max(1, acc.K), at30 = (k) => dock[k] + (acc[k] - dock[k]) * f, mbl = b.rigLoads.mbl;
  const out = { heel: b.phi / DEG, RM30, sailK: acc.K, sagN: acc.sag };
  if (mbl.capShroud) out.cap = mbl.capShroud / at30('cap');
  if (mbl.lowerShrouds) out.low = mbl.lowerShrouds / at30('low');
  if (mbl.forestay) out.fore = mbl.forestay / at30('fore');
  // (the critical load is the solved rig's own, comp / (P/Pcr), at the sailing state; its compression scaled to RM30)
  out.mast = acc.comp / Math.max(1e-6, acc.pcr) / at30('comp');
  return out;
}

const isMain = process.argv[1] && process.argv[1].endsWith('size-rigs.mjs');
if (isMain) {
  const ids = process.argv[2] ? process.argv[2].split(',') : CLASS_ORDER.filter((id) => {
    const C = CLASSES[id];
    return !C.speedCraft && !C.rigStructure && !(C.rigSpec && C.rigSpec.spans) && !RIG_DATA[id] && genericRig(C, {}).wires.length;
  });
  const table = {};
  for (const id of ids) {
    // (from the table's factors where it has them: a second run refines the first)
    const C = CLASSES[id], k = { cap: 1, low: 1, ei: 1, ...(GENERIC_K[id] || {}), fore: GENERIC_K[id]?.foreSag ?? 1 };
    // (each round from the last: the parts share the load, so resizing one moves the others; the best round is kept, scored
    // by its worst margin's distance from the target. A drawn spar already at its thickest wall cannot be stiffened.)
    let best = null;
    try {
      for (let round = 0; round < 5; round++) {
        const m = rigMargins(id, genericRig(C, k));
        const score = Math.max(...['cap', 'low'].filter((p) => m[p]).map((p) => Math.abs(Math.log(m[p] / 2.8))), m.fore && m.fore < 2.2 ? Math.abs(Math.log(m.fore / 2.5)) : 0, m.mast ? Math.abs(Math.log(Math.min(m.mast, 4) / 2.7)) * 0.5 : 0);
        if (!best || score < best.score) best = { score, k: { ...k }, m };
        let ok = true;
        for (const p of ['cap', 'low']) if (m[p] && (m[p] < 2.5 || m[p] > 3.5)) { k[p] = clamp(k[p] * clamp(2.8 / m[p], 0.4, 3), 0.1, 10); ok = false; }
        // (the forestay and backstay are sized for the headsail's sag, their stiffness (genericRig), and only made stronger
        // here where short of 2.2 x their load. The sag a class's jib wants is set by hand in GENERIC_K's fore where its
        // seakeeping showed it (sagN, printed, as measured here, heading held, differs from the sag on the autopilot))
        if (m.fore && m.fore < 2.2) { k.fore = Math.max(k.fore, clamp(k.fore * 2.5 / m.fore, 1, 10)); ok = false; }
        if (m.mast && (m.mast < 2.3 || m.mast > 4)) {
          const k2 = clamp(k.ei * clamp(2.7 / m.mast, 0.4, 3), 0.2, 10);
          if (genericRig(C, { ...k, ei: k2 }).spans[0].t !== genericRig(C, k).spans[0].t || k2 < k.ei) { k.ei = k2; ok = false; }
        }
        console.error(`${id} round ${round}: ${['cap', 'low', 'fore', 'mast', 'sagN'].map((p) => m[p] ? `${p} ${m[p].toFixed(2)}` : '').join(' ')} (heel ${m.heel.toFixed(0)}) -> k ${JSON.stringify(k)}`);
        if (ok) break;
      }
    } catch (e) { console.error(`${id}: ${e.message}`); continue; }
    if (best) { table[id] = Object.fromEntries(Object.entries(best.k).map(([p, v]) => [p, +v.toFixed(2)])); if (GENERIC_K[id]?.foreSag) table[id].foreSag = GENERIC_K[id].foreSag; console.error(`${id} kept ${JSON.stringify(table[id])}: ${JSON.stringify(best.m, (q, v) => typeof v === 'number' ? +v.toFixed(2) : v)}`); }
  }
  console.log('export const GENERIC_K = {');
  for (const id in table) console.log(`  ${/^[a-z_$][\w$]*$/i.test(id) ? id : `'${id}'`}: ${JSON.stringify(table[id]).replace(/"/g, '').replace(/:/g, ': ').replace(/,/g, ', ')},`);
  console.log('};');
}
