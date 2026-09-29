// Whitecaps and the sea state against observations (js/env.js WC, whitecapCover, seaHsTp):
//  1. whitecap cover against Monahan & O'Muircheartaigh (1980), W = 3.84e-6 U10^3.41, where they measured it
//     (to ~20 m/s), saturating past it, and against the WMO Beaufort descriptions
//  2. the shaders' copy of the curve (WC_GLSL) is the same curve
//  3. the foam budget: active share and decay time within what was measured
//  4. significant height and peak period against the WMO Beaufort table's probable heights (open sea)
// Run: node test/whitecaps.mjs [--gpu]   (--gpu: also the rendered cover, tools/verify-foam.mjs)
import { WC, WC_GLSL, whitecapCover, seaHsTp, KT, Environment } from '../js/env.js';
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const monahan = (U) => 3.84e-6 * Math.pow(U, 3.41);
const pct = (x) => (100 * x).toFixed(2) + ' %';

// ---- 1. the curve
console.log('1. whitecap cover (kn: game | Monahan & O\'Muircheartaigh 1980)');
for (const kt of [10, 15, 20, 25, 30, 35, 40, 45, 50, 60]) console.log(`   ${String(kt).padStart(2)} kn: ${pct(whitecapCover(kt * KT)).padStart(8)} | ${pct(monahan(kt * KT)).padStart(8)}`);
for (const kt of [10, 15, 20, 25, 30, 35]) check(Math.abs(whitecapCover(kt * KT) / monahan(kt * KT) - 1) < 0.03, `${kt} kn follows Monahan's fit within 3 % (within their data)`);
let mono = true; for (let U = 0.5; U < 40; U += 0.25) if (whitecapCover(U + 0.25) <= whitecapCover(U)) mono = false;
check(mono, 'cover rises with the wind');
check(whitecapCover(40 * KT) < monahan(40 * KT) && whitecapCover(60 * KT) < 0.35 && whitecapCover(80 * KT) <= WC.max, 'saturates past storm force (the fit is beyond its data there)');
// WMO Beaufort: 3 (7-10 kn) "perhaps scattered white horses"; 4 (11-16) "fairly frequent"; 5 (17-21) "many";
// 6 (22-27) "white foam crests everywhere"; 9 (41-47) "dense streaks"; 10 (48-55) "the whole surface takes on
// a white appearance" (streaks and spray included, seen from a ship)
check(whitecapCover(8 * KT) < 0.001, 'Beaufort 3: a white horse here and there (< 0.1 %)');
check(whitecapCover(19 * KT) > 0.005 && whitecapCover(19 * KT) < 0.02, 'Beaufort 5: many white horses (0.5-2 %)');
check(whitecapCover(25 * KT) > 0.015 && whitecapCover(25 * KT) < 0.04, 'Beaufort 6: foam crests everywhere, most of the sea still clear (1.5-4 %)');
check(whitecapCover(44 * KT) > 0.1 && whitecapCover(44 * KT) < 0.25, 'Beaufort 9: a tenth to a quarter of the sea white on the crests');

// ---- 2. the shaders' curve: WC_GLSL translated to JS
{
  const js = WC_GLSL.replace(/float (\w+)\(float (\w+)\)/, 'return (($2) => ').replace(/float /g, 'let ').replace(/(\d)\.0\b/g, '$1').replace(/\bmax\(/g, 'Math.max(').replace(/\bpow\(/g, 'Math.pow(').replace(/\bexp\(/g, 'Math.exp(').replace(/\}\s*$/, '})');
  const f = new Function(js)();
  let worst = 0; for (let U = 0; U < 40; U += 0.1) worst = Math.max(worst, Math.abs(f(U) - whitecapCover(U)));
  check(worst < 1e-6, `shader curve = whitecapCover (worst ${worst.toExponential(1)})`);
}

// ---- 3. the budget
check(WC.A > 0.15 && WC.A < 0.5, `active crests ${(WC.A * 100).toFixed(0)} % of the cover (stage A ~1 s against stage B's ~2-10 s)`);
check(WC.tauB >= 2 && WC.tauB <= 6, `foam e-folds in ${WC.tauB} s (Monahan & Lu 1990; Callaghan et al. 2012: 2-10 s, most 3-5)`);

// ---- 4. the sea
// WMO Beaufort: probable (max) height in the open sea, m
const BF = [[10, 0.6, 1], [20, 2, 2.5], [30, 4, 5.5], [45, 7, 10], [60, 11.5, 16]];
console.log('4. open sea, a storm\'s day of wind (kn: Hs, Tp, steepness Hs/Lp | Beaufort probable (max))');
for (const [kt, prob, max] of BF) {
  const [Hs, Tp] = seaHsTp(kt * KT, 2e6), Lp = 9.81 * Tp * Tp / (2 * Math.PI);
  console.log(`   ${kt} kn: Hs ${Hs.toFixed(1)} m, Tp ${Tp.toFixed(1)} s, Hs/Lp 1/${(Lp / Hs).toFixed(0)} | ${prob} (${max}) m`);
  check(Hs > 0.7 * prob && Hs <= max * 1.05, `${kt} kn: Hs ${Hs.toFixed(1)} m against the table's ${prob} (${max}) m`);
  check(Hs / Lp < 1 / 20 && Hs / Lp > 1 / 50, `${kt} kn: steepness 1/${(Lp / Hs).toFixed(0)} a wind sea's (1/20-1/50)`);
}
// a sheltered 8 km fetch in 30 kn: short and steep, JONSWAP
{ const [Hs, Tp] = seaHsTp(30 * KT, 8000); check(Hs > 0.6 && Hs < 0.9 && Tp > 3 && Tp < 3.6, `8 km fetch, 30 kn: Hs ${Hs.toFixed(2)} m Tp ${Tp.toFixed(1)} s (fetch-limited JONSWAP: short and steep)`); }
{ const W = new Environment({ tws: 60 * KT, twd: 0, fetchKm: 2000, seed: 3, weather: 'steady' }).waves; check(Math.abs(W.Hs / seaHsTp(60 * KT, 2e6)[0] - 1) < 0.05, `the wave field's Hs ${W.Hs.toFixed(1)} m is the spectrum's`); }

if (process.argv.includes('--gpu')) {
  const { gpuFoam } = await import('../tools/verify-foam.mjs');
  const r = await gpuFoam({ winds: [20, 30, 45] });
  for (const x of r) {
    const want = whitecapCover(x.kt * KT);
    console.log(`   rendered ${x.kt} kn: ${pct(x.mean)} of the sea white (crests ${pct(x.crest)}, decaying foam ${pct(x.pers)}, streaks ${pct(x.streak)}) against ${pct(want)}`);
    check(x.mean > want / 1.6 && x.mean < want * 1.6 + 0.004, `rendered cover at ${x.kt} kn within a factor 1.6 of the curve`);
  }
}
console.log(fail ? `FAIL (${fail})` : 'ok');
process.exit(fail ? 1 : 0);
