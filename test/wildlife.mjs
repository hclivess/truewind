// Wildlife (js/wildlife.js): node test/wildlife.mjs
//  1. who lives where: the species of each venue by month (no gulls far offshore, no sharks or turtles in Kiel,
//     humpbacks off Sydney in the migration months, basking sharks in the Solent in summer only)
//  2. determinism: the same venue, seed and day give the same animals doing the same things; another seed others;
//     no Math.random; the boats it is shown are left as they were (it is visual only)
//  3. water and land: on a shore with a shelving bottom, nothing that swims goes where the water is shallower than
//     it needs, nothing at all on land; whales keep offshore
//  4. a humpback's surfacing: 3-5 blows a sequence, a dive of 5-15 minutes between sequences
//  5. bow-riding: a pod meeting a boat at 6 kn sometimes rides her bow wave (just ahead of the stem); at 3 kn never
//  6. sharks: the dorsal fin steady above the surface (no rolling arc) while a dolphin's back rises and falls
//  7. a sitting flock goes up when a boat comes close; a turtle dives away from her
import { Wildlife, SPECIES, ST, GM, faunaFor, VENUE_FAUNA, bearingWords } from '../js/wildlife.js';

let fail = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const flat = (x, z, psi, L, B, o) => { o.h = 0; o.al = 0; o.at = 0; return o; };
const month = (m) => Date.UTC(2026, m - 1, 15);
const has = (list, sp) => list.some((f) => f.sp === sp);
const boatOf = (x, z, psi, u) => ({ x, z, psi, u, cls: { bowX: 3.5, sternX: -3.4, lwl: 6.5, beam: 2.4 } });
function ctxFor(boat, extra = {}) {
  return { fx: boat ? boat.x : 0, fz: boat ? boat.z : 0, boats: boat ? [boat] : [], player: boat, ride: flat, wind: { x: 2, z: 4, U: 4.5 }, Hs: 0.4, active: true, ...extra };
}
function run(W, secs, ctx, boat = null, each = null, dt = 0.1) {
  let t = W.t || 0;
  for (let i = 0; i < Math.round(secs / dt); i++) {
    t += dt;
    if (boat) { boat.x += Math.sin(boat.psi) * boat.u * dt; boat.z -= Math.cos(boat.psi) * boat.u * dt; ctx.fx = boat.x; ctx.fz = boat.z; }
    W.update(dt, t, ctx);
    if (each) each(t);
  }
  return t;
}

console.log('1. species by venue and month');
{
  const sol7 = faunaFor({ id: 'solent' }, month(7)), sol1 = faunaFor({ id: 'solent' }, month(1));
  check(has(sol7, 'baskingShark') && !has(sol1, 'baskingShark'), 'Solent: basking sharks in July, not in January');
  check(has(sol7, 'northernGannet') && has(sol7, 'harbourPorpoise') && has(sol7, 'herringGull') && has(sol7, 'sandwichTern'), 'Solent: gannets, porpoises, gulls, terns');
  const kiel = faunaFor({ id: 'kiel' }, month(7));
  check(has(kiel, 'harbourPorpoise') && !kiel.some((f) => SPECIES[f.sp].cls === 'shark' || SPECIES[f.sp].cls === 'turtle' || (SPECIES[f.sp].cls === 'cet' && f.sp !== 'harbourPorpoise')), 'Kiel: porpoises, no dolphins, whales, sharks or turtles');
  const syd6 = faunaFor({ id: 'sydney' }, month(6)), syd2 = faunaFor({ id: 'sydney' }, month(2));
  const hb = (l) => (l.find((f) => f.sp === 'humpback') || { n: 0 }).n;
  check(hb(syd6) > 10 * hb(syd2), `Sydney humpbacks: June ${hb(syd6).toFixed(2)} groups about, February ${hb(syd2).toFixed(3)}`);
  const so = faunaFor({ id: 'southern' }, month(1));
  check(has(so, 'blackBrowedAlbatross') && has(so, 'southernRight') && !so.some((f) => SPECIES[f.sp].morph === 'gull'), 'Southern Ocean: albatrosses and right whales, no gulls');
  const open = faunaFor({ id: 'open' }, month(8));
  check(!open.some((f) => SPECIES[f.sp].cls === 'bird' && SPECIES[f.sp].morph === 'gull'), 'open ocean: no gulls');
  const pr = faunaFor({ id: 'progreso' }, month(7));
  check(['frigatebird', 'brownPelican', 'greenTurtle', 'hawksbill', 'loggerhead', 'bullShark', 'blacktip'].every((s) => has(pr, s)), 'Yucatán: frigatebirds, brown pelicans, green, hawksbill and loggerhead turtles, bull and blacktip sharks');
  const ak = faunaFor({ id: 'auckland' }, month(7));
  check(has(ak, 'australasianGannet') && has(ak, 'brydes') && has(ak, 'commonDolphin') && has(ak, 'humpback'), "Hauraki Gulf: gannets, Bryde's whales, common dolphins, humpbacks in July");
  check(faunaFor({ id: 'garda' }, month(7)).every((f) => SPECIES[f.sp].morph === 'gull'), 'Lake Garda: gulls only');
  let ok = true; for (const v in VENUE_FAUNA) for (const [sp] of VENUE_FAUNA[v]) if (!SPECIES[sp]) ok = false;
  check(ok, 'every listed species is defined');
  check(SPECIES.frigatebird.sit === 0 && SPECIES.commonTern.sit === 0, 'frigatebirds and terns never settle on the sea');
}

console.log('2. determinism, visual only');
{
  const fauna = Object.keys(SPECIES).map((sp) => ({ sp, n: 1 }));
  const mk = (seed) => new Wildlife({ venue: { id: 'open', open: true, depth: 300 }, seed, dateMs: month(7), fauna });
  const rand = Math.random; let calls = 0; Math.random = () => { calls++; return rand(); };
  const A = mk(5), B = mk(5), Cc = mk(6);
  // (the boats frozen: a write to one would throw, the modules being strict)
  const frz = (b) => { Object.freeze(b.cls); return Object.freeze(b); };
  const bA = frz(boatOf(0, 0, 0.4, 3)), bB = frz(boatOf(0, 0, 0.4, 3)), bC = frz(boatOf(0, 0, 0.4, 3));
  const cA = ctxFor(bA), cB = ctxFor(bB), cC = ctxFor(bC);
  const before = JSON.stringify(bA);
  let threw = false;
  try {
    for (let i = 0; i < 6000; i++) for (const [W, c] of [[A, cA], [B, cB], [Cc, cC]]) { c.fx = i * 0.1; W.update(0.1, (i + 1) * 0.1, c); }
  } catch (e) { threw = e; }
  Math.random = rand;
  const sig = (W) => W.animals.map((a) => a.on ? `${a.st}:${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)},${a.ph.toFixed(3)}` : '-').join('|');
  check(sig(A) === sig(B), 'the same venue, seed and day: the same animals in the same places after 10 minutes');
  check(sig(A) !== sig(Cc), 'another seed: other animals');
  check(calls === 0, 'no Math.random in the simulation');
  check(!threw && JSON.stringify(bA) === before, `the boat it was shown is unchanged${threw ? ': ' + threw.message : ''}`);
}

console.log('3. water and land');
{
  // a straight shore along x = 0 (land at x < 0), the bottom shelving 1 m in 20 m to 60 m deep
  const world = { open: false, sdfAt: (x, z) => x, depthAt: (x, z) => (x <= 0 ? x * 0.05 : Math.min(60, x / 20)) };
  const fauna = Object.keys(SPECIES).map((sp) => ({ sp, n: 2 }));
  const W = new Wildlife({ venue: { id: 'test' }, world, seed: 11, dateMs: month(7), fauna });
  const boat = boatOf(250, 0, 0, 3.2);           // sailing north along the shore, 250 m off
  const ctx = ctxFor(boat);
  let worst = { swim: 0, land: 0, whale: 1e9 }, nSwim = 0;
  run(W, 2400, ctx, boat, () => {
    for (const a of W.animals) {
      if (!a.on) continue;
      const S = a.g.S, d = world.depthAt(a.x, a.z);
      if (S.cls !== 'bird') {
        nSwim++;
        if (d < S.depth * 0.6) worst.swim++;
        if (world.sdfAt(a.x, a.z) < 0) worst.land++;
        if (S.morph === 'rorqual' || S.morph === 'right') worst.whale = Math.min(worst.whale, a.x);
      } else if (a.st === ST.SIT && world.sdfAt(a.x, a.z) < 0) worst.land++;
    }
  });
  check(nSwim > 1000 && worst.swim === 0, `nothing that swims in water shallower than it needs (${nSwim} samples)`);
  check(worst.land === 0, 'nothing on land (nor a bird sitting there)');
  check(worst.whale > 250, `whales offshore: the nearest came ${Math.round(worst.whale)} m from the shore`);
}

console.log('4. a humpback\'s surfacing sequence');
{
  const W = new Wildlife({ venue: { id: 'open', open: true, depth: 500 }, seed: 21, fauna: [{ sp: 'humpback', n: 1 }] });
  const ctx = ctxFor(null);
  const blows = [];
  W.update(0.2, 0.2, ctx); W.groups[0].life = 1e12;        // (kept: not let go and met again)
  // (the focus kept on the whale, which would otherwise swim out of range and be met anew)
  run(W, 3 * 3600, ctx, null, (t) => { ctx.fx = W.groups[0].x; ctx.fz = W.groups[0].z + 800; W.drain((e) => { if (e.type === 'blow' && e.m === e.g.members[0]) blows.push(t); }); }, 0.2);
  // sequences: blows closer than 2 minutes apart
  const seqs = []; let cur = [];
  for (const t of blows) { if (cur.length && t - cur[cur.length - 1] > 120) { seqs.push(cur); cur = []; } cur.push(t); }
  if (cur.length) seqs.push(cur);
  const full = seqs.slice(1, -1);
  const counts = full.map((s) => s.length), gaps = [];
  for (let i = 1; i < seqs.length; i++) gaps.push(seqs[i][0] - seqs[i - 1][seqs[i - 1].length - 1]);
  check(full.length >= 5, `${seqs.length} sequences in 3 hours`);
  check(counts.every((n) => n >= 3 && n <= 5), `3-5 blows a sequence (${counts.join(', ')})`);
  const longGaps = gaps.filter((g) => g > 150);
  check(longGaps.length >= 4 && longGaps.every((g) => g >= 300 && g <= 960), `dives of 5-15 min (+ the fluke and the rise) between them: ${longGaps.map((g) => (g / 60).toFixed(1)).join(', ')} min`);
  const inner = full.flatMap((s) => s.slice(1).map((t, i) => t - s[i]));
  check(inner.every((g) => g >= 15 && g <= 70), `blows 15-60 s apart in a sequence (${Math.min(...inner).toFixed(0)}-${Math.max(...inner).toFixed(0)} s)`);
}

console.log('5. bow-riding');
{
  const trial = (kn, seed) => {
    const W = new Wildlife({ venue: { id: 'open', open: true, depth: 200 }, seed, fauna: [{ sp: 'commonDolphin', n: 1 }] });
    const boat = boatOf(0, 0, 0, kn * 0.514444), ctx = ctxFor(boat);
    W.update(0.1, 0.1, ctx);
    const g = W.groups[0];
    if (!g.on) return { rode: false };
    // the pod placed on the boat's course, 250 m ahead, coming the other way
    g.x = 0; g.z = -250; g.psi = Math.PI; g.mode = GM.TRAVEL;
    for (const a of g.members) { a.x = g.x; a.z = g.z; }
    let rode = false, onBow = 0;
    run(W, 240, ctx, boat, () => {
      if (g.mode === GM.BOW) {
        rode = true;
        const fx = Math.sin(boat.psi), fz = -Math.cos(boat.psi);
        for (let i = 0; i < Math.min(4, g.n); i++) { const a = g.members[i]; const along = (a.x - boat.x) * fx + (a.z - boat.z) * fz; if (along > 3.5 && along < 12 && Math.hypot(a.x - boat.x, a.z - boat.z) < 13) onBow++; }
      }
    });
    return { rode, onBow };
  };
  let fast = 0, ahead = 0, slow = 0;
  for (let s = 1; s <= 20; s++) { const r = trial(6, s); if (r.rode) { fast++; if (r.onBow > 200) ahead++; } if (trial(3, s).rode) slow++; }
  check(fast >= 5 && fast <= 18, `at 6 kn the pod rode the bow in ${fast} of 20 meetings (sometimes, not always)`);
  check(ahead === fast, `and rode just ahead of the stem (${ahead} of ${fast})`);
  check(slow === 0, 'at 3 kn never');
  check(SPECIES.harbourPorpoise.bow === 0, 'harbour porpoises never bow-ride');
}

console.log('6. a shark\'s fin against a dolphin\'s roll');
{
  const sea = (x, z, psi, L, B, o) => { o.h = 0.25 * Math.sin(0.3 * x + 0.2 * z); o.al = 0; o.at = 0; return o; };
  const W = new Wildlife({ venue: { id: 'open', open: true, depth: 200 }, seed: 4, fauna: [{ sp: 'baskingShark', n: 1 }, { sp: 'bottlenose', n: 1 }] });
  const ctx = ctxFor(null, { ride: sea, boats: [] });
  run(W, 1, ctx);
  const sh = W.groups[0].members[0], S = SPECIES.baskingShark;
  sh.st = ST.CRUISE; sh.tt = 1e9; sh.n = 0; sh.ylp = 0; sh.y = -S.back * S.L - 0.2;
  const dol = W.groups[1].members[0];
  run(W, 30, ctx);
  let finMin = 1e9; const ys = [], yd = [], ps = [], pd = [];
  run(W, 120, ctx, null, () => {
    const top = sh.y + (S.back + S.fin) * S.L * sh.scale;
    finMin = Math.min(finMin, top - sea(sh.x, sh.z, 0, 0, 0, {}).h);
    ys.push(sh.y); yd.push(dol.y); ps.push(sh.pitch); pd.push(dol.pitch);
  });
  const range = (a) => Math.max(...a) - Math.min(...a);
  check(finMin > 0.3, `the basking shark's dorsal fin stays out of the water (at least ${finMin.toFixed(2)} m showing)`);
  check(range(ys) < range(yd) / 4 && range(ps) < 0.12 && range(pd) > 0.3, `the shark holds its depth and trim (${range(ys).toFixed(2)} m, ${range(ps).toFixed(2)} rad) while the dolphin rolls up and under (${range(yd).toFixed(2)} m, ${range(pd).toFixed(2)} rad)`);
}

console.log('7. flushing and diving away');
{
  const W = new Wildlife({ venue: { id: 'open', open: true, depth: 200 }, seed: 9, fauna: [{ sp: 'herringGull', n: 1 }] });
  const boat = boatOf(0, 400, 0, 2.5), ctx = ctxFor(boat, { active: false });
  // a flock made to sit 300 m ahead of the boat
  let g = null;
  for (let k = 0; k < 40 && !g; k++) { W.update(0.1, (k + 1) * 0.1, ctx); const c = W.groups[0]; if (c.on) { if (c.mode !== GM.FLOCK) { W._off(c); c.wait = 0; } else g = c; } }
  if (g) {
    W._spawn(g, 0, 100, ctx);
    if (g.mode !== GM.FLOCK) { g.mode = GM.FLOCK; for (let i = 0; i < g.n; i++) { const a = g.members[i]; a.st = ST.SIT; a.tt = 1e9; } }
    for (let i = 0; i < g.n; i++) g.members[i].tt = 1e9;
  }
  let upAt = null, minD = 1e9;
  run(W, 200, ctx, boat, () => {
    if (!g) return;
    const d = Math.hypot(g.cx - boat.x, g.cz - boat.z); minD = Math.min(minD, d);
    if (upAt === null && g.members.slice(0, g.n).some((a) => a.st !== ST.SIT)) upAt = d;
  });
  check(!!g && upAt !== null && upAt > 15 && upAt < 80, `the flock went up with the boat ${upAt === null ? '-' : upAt.toFixed(0)} m off`);
  const T = new Wildlife({ venue: { id: 'open', open: true, depth: 200 }, seed: 3, fauna: [{ sp: 'greenTurtle', n: 1 }] });
  const b2 = boatOf(0, 60, 0, 2), c2 = ctxFor(b2);
  let tg = null;
  for (let k = 0; k < 400 && !tg; k++) { T.update(0.1, (k + 1) * 0.1, c2); if (T.groups[0].on) tg = T.groups[0]; }
  let fled = false;
  if (tg) {
    const a = tg.members[0]; a.x = 0; a.z = 0; a.st = ST.BASK; a.tt = 1e9;
    run(T, 40, c2, b2, () => { if (a.st === ST.FLEE) fled = true; });
  }
  check(fled, 'a basking turtle dives away from an approaching boat');
  check(bearingWords(0, 0, 0, 10, -10) === 'off the starboard bow' && bearingWords(0, 0, 0, -10, 0) === 'on the port beam' && bearingWords(0, 0, 0, 0, 10) === 'astern', 'bearings for the crew\'s calls');
}

console.log(fail ? `${fail} FAILED` : 'all wildlife tests pass');
process.exit(fail ? 1 : 0);
