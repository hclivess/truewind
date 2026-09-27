// The racing rules (js/rules.js): scripted encounters between boats moving on set courses, each judged by the
// umpire, then the AI crews under the rules (a port–starboard crossing, penalty turns in every class).
// Wind from the north throughout (twd 0): starboard tack heads north-west, port tack north-east.
import { CLASSES, Boat, wrap, clamp } from '../js/physics.js';
import '../js/sail/sailsim.js';
import { Course, Race, AIHelm, resolveCollisions } from '../js/race.js';
import { RuleEngine } from '../js/rules.js';
const DEG = Math.PI / 180, KT = 0.514444;
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) bad++; };

// a boat on rails: heading, speed, a turn rate toward `want` (or a steady `turn`); the boom lies to leeward
const mk = (id, x, z, hdg, u, cls = 'sportboat') => ({ id, name: 'B' + id, cls: CLASSES[cls], x, z, psi: hdg * DEG, u, v: 0, r: 0, vgx: 0, vgz: 0,
  diag: { twd: 0 }, booms: { main: { a: 0 } }, sailBy: {}, genDeploy: 0, capsized: false, aground: 0, rate: 25 * DEG });
function move(b, dt) {
  if (b.turn) { b.r = b.turn; b.psi = wrap(b.psi + b.turn * dt); }
  else if (b.want !== undefined) { const d = clamp(wrap(b.want - b.psi), -b.rate * dt, b.rate * dt); b.r = d / dt; b.psi = wrap(b.psi + d); }
  else b.r = 0;
  b.vgx = b.u * Math.sin(b.psi); b.vgz = -b.u * Math.cos(b.psi);
  b.x += b.vgx * dt; b.z += b.vgz * dt;
  const twa = wrap(b.diag.twd - b.psi); b.booms.main.a = -Math.sign(twa) * 0.5;
}
// run an encounter: script(t, eng) steers; returns the engine (its incidents and penalties)
function run(boats, secs, script = () => {}, o = {}) {
  const eng = new RuleEngine({ race: o.race, course: o.course, world: o.world, human: o.human });
  const marks = o.course ? [...o.course.marks(), o.course.committee] : [];
  const dt = 1 / 60;
  for (let t = 0; t < secs; t += dt) {
    script(t, eng);
    for (const b of boats) move(b, dt);
    if (o.race) o.race.update(dt);
    resolveCollisions(boats, marks, [], null, (b, x) => eng.touch(b, x));
    eng.step(dt, boats);
    if (process.env.DBG && Math.abs(t * 2 - Math.round(t * 2)) < dt) {   // DBG=1: the pairs every half second
      for (const pr of eng.pairs.values()) console.log(`   t ${t.toFixed(1)} ${pr.a.name} ${(pr.a.psi / DEG).toFixed(0)}° ${pr.b.name} ${(pr.b.psi / DEG).toFixed(0)}° d ${pr.d.toFixed(1)} give ${pr.give?.name} ${pr.rule} ov ${pr.overlap} clr ${pr.clr?.toFixed(2)}@${pr.when} room ${pr.room ? pr.room.rule + '>' + pr.room.ent.name : '-'}`);
    }
  }
  return eng;
}
const incs = (eng) => eng.incidents.filter(i => i.kind !== 'ocs');
const has = (eng, rule, off) => incs(eng).some(i => i.rule === rule && i.off === off);
const desc = (eng) => incs(eng).map(i => `${i.rule}:${i.off.name}${i.vic ? '>' + i.vic.name : ''}(${i.kind},${i.status})`).join(' ') || 'none';
// place a boat so that at time T she is at (x, z) sailing heading hdg at speed u
const at = (id, x, z, hdg, u, T, cls) => mk(id, x - Math.sin(hdg * DEG) * u * T, z + Math.cos(hdg * DEG) * u * T, hdg, u, cls);

// ---- rule 10: port and starboard on a collision course
{
  const S = at(1, 0, 0, -45, 3, 8), P = at(2, 0, 0, 45, 3, 8);
  const e = run([S, P], 12);
  check(has(e, '10', P) && e.incidents.find(i => i.rule === '10').status === 'penalty', `10  port holds on into starboard: port penalised (${desc(e)})`);
}
{ // port ducks: bears away early and passes astern
  const S = at(1, 0, 0, -45, 3, 8), P = at(2, 0, 0, 45, 3, 8);
  const e = run([S, P], 14, (t) => { if (t > 3) P.want = 110 * DEG; if (t > 9) P.want = 45 * DEG; });
  check(incs(e).length === 0, `10  port ducks astern of starboard: no incident (${desc(e)})`);
}
{ // port crosses clear ahead
  const S = at(1, 0, 0, -45, 3, 8), P = at(2, 0, 0, 45, 3, 3.6);    // (over the crossing 4.4 s before her: a couple of metres clear)
  const e = run([S, P], 14);
  check(incs(e).length === 0, `10  port crosses clear ahead: no incident (${desc(e)})`);
}
{ // 16.1: starboard bears away onto the port boat already ducking her
  const S = at(1, 0, 0, -45, 3, 8), P = at(2, 0, 0, 45, 3, 8);
  const e = run([S, P], 14, (t) => { if (t > 3) P.want = 85 * DEG; if (t > 5.4) { S.want = -170 * DEG; S.rate = 45 * DEG; } });
  check(has(e, '16.1', S), `16.1 starboard bears away into the ducking port boat: starboard penalised (${desc(e)})`);
}
// ---- rule 11: same tack overlapped, windward sails down onto leeward
{
  const L = mk(1, 0, 0, -45, 3), W = mk(2, 0 + Math.cos(-45 * DEG) * 6, Math.sin(-45 * DEG) * 6, -45, 3);   // 6 m to starboard (windward)
  const e = run([L, W], 12, (t) => { if (t > 1) W.want = -60 * DEG; });
  check(has(e, '11', W), `11  windward sails down onto leeward: windward penalised (${desc(e)})`);
}
{ // side by side, both hold their course: nothing to settle
  const L = mk(1, 0, 0, -45, 3), W = mk(2, Math.cos(-45 * DEG) * 5, Math.sin(-45 * DEG) * 5, -45, 3);
  const e = run([L, W], 10);
  check(incs(e).length === 0, `11  overlapped on parallel courses: no incident (${desc(e)})`);
}
// ---- rule 12: clear astern runs into the transom ahead
{
  const A = mk(1, 0, 0, -45, 2), B = mk(2, 14 * Math.sin(45 * DEG), 14 * Math.cos(45 * DEG), -45, 4);   // B 14 m astern, faster
  const e = run([A, B], 10);
  check(has(e, '12', B), `12  clear astern sails into the boat ahead: astern penalised (${desc(e)})`);
}
// ---- rule 15: overlapped to leeward from clear astern, converging at once
{
  const W = mk(1, 0, 0, -45, 2.5), L = mk(2, -Math.cos(-45 * DEG) * 2.6 + 10 * Math.sin(45 * DEG), -Math.sin(-45 * DEG) * 2.6 + 10 * Math.cos(45 * DEG), -45, 4.5);
  const e = run([W, L], 8, (t) => { if (t > 1.2) L.want = -39 * DEG; });
  check(has(e, '15', L), `15  gains a leeward overlap from astern and converges at once: leeward penalised (${desc(e)})`);
}
// ---- rule 13 / 15: tacking too close — a port boat tacks onto starboard right under a starboard boat's bow
{
  const S = at(1, 0, 0, -45, 3, 6), P = at(2, -5.5, -5.5, 45, 3, 4.6);   // (P on S's line 7 m ahead of her as she tacks)
  const e = run([S, P], 14, (t) => { if (t > 4.6) { P.want = -45 * DEG; P.rate = 45 * DEG; P.u = Math.max(1.2, P.u - 1.5 / 60); } });
  check(has(e, '13', P) || has(e, '15', P), `13  port tacks under starboard's bow: the tacking boat penalised (${desc(e)})`);
}
// ---- 17: overlapped to leeward from astern, then luffs above her proper course on the run
{
  const course = new Course(null, 0, { length: 800, laps: 2 });
  const W = mk(1, 0, -500, 180 - 20, 3), L = mk(2, 0, -500, 180 - 20, 4.2);
  // L starts clear astern and a length to leeward (running on port: wind over the port quarter, leeward is to starboard)
  L.x = W.x - Math.sin(160 * DEG) * 9 + Math.cos(160 * DEG) * 4.5; L.z = W.z + Math.cos(160 * DEG) * 9 + Math.sin(160 * DEG) * 4.5;
  const race = new Race(course, [W, L], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 2; r.started = true; });
  race.t = 60;
  const e = run([W, L], 14, (t) => { if (t > 5) { L.want = 100 * DEG; L.rate = 20 * DEG; } }, { race, course });
  check(has(e, '17', L), `17  leeward from astern luffs above her proper course into windward: leeward penalised (${desc(e)})`);
}
// ---- rule 18: mark-room
{ // leeward gate mark left to starboard: overlapped at the zone, the inside (windward) boat is owed room; the
  // outside leeward boat squeezes her at the rounding
  const course = new Course(null, 0, { length: 800, laps: 2 });
  const m = course.gateL;
  const I = mk(1, m.x + 5, m.z - 40, 185, 3.5), O = mk(2, m.x + 9.5, m.z - 40, 185, 3.5);
  const race = new Race(course, [I, O], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 2; r.started = true; }); race.t = 60;
  const e = run([I, O], 20, (t) => {
    if (I.z > m.z - 3) { I.want = -20 * DEG; I.rate = 20 * DEG; }
    if (O.z > m.z - 14) { O.want = 235 * DEG; O.rate = 20 * DEG; }        // luffs, shutting the inside boat out
  }, { race, course });
  check(has(e, '18.2', O) && !has(e, '11', I), `18.2 leeward mark, overlapped inside at the zone: outside (leeward, right of way) penalised (${desc(e)})`);
}
{ // the same, but the inside boat was clear astern when the outside one reached the zone: no mark-room for her
  const course = new Course(null, 0, { length: 800, laps: 2 });
  const m = course.gateL;
  const O = mk(2, m.x + 8, m.z - 40, 185, 3.5), I = mk(1, m.x + 4, m.z - 40 - 18, 185, 4.6);
  const race = new Race(course, [I, O], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 2; r.started = true; }); race.t = 60;
  const e = run([I, O], 20, (t) => {
    if (O.z > m.z - 4) { O.want = -20 * DEG; O.rate = 20 * DEG; }       // rounds as she is entitled to
  }, { race, course });
  const i = incs(e)[0];
  check(i && i.off === I, `18.2 overlap made inside after the zone: no mark-room, the inside boat penalised (${desc(e)})`);
}
{ // windward mark (left to port): A clear ahead at the zone; B, clear astern then, gets in to leeward (inside) and
  // holds on as A bears away round the mark: B owed A mark-room (18.2(b), (c))
  const course = new Course(null, 0, { length: 800 });
  const m = course.windward;
  const A = mk(1, m.x + 16, m.z + 22, -45, 3), B = mk(2, m.x + 16 + 5, m.z + 22 + 12, -43, 4.4);
  const race = new Race(course, [A, B], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 1; r.started = true; }); race.t = 60;
  const e = run([A, B], 16, (t) => { if (A.x < m.x + 4) { A.want = -150 * DEG; A.rate = 30 * DEG; } }, { race, course });
  check(has(e, '18.2', B), `18.2 windward mark, clear ahead at the zone: the boat that came in inside penalised (${desc(e)})`);
}
{ // 18.3: tacks from port to starboard inside the zone, making a starboard-tack boat luff above close-hauled
  const course = new Course(null, 0, { length: 800 });
  const m = course.windward;
  const S = mk(1, m.x + 17.7, m.z + 21.2, -45, 3), P = mk(2, m.x + 4, m.z + 10, 45, 2.4);
  const race = new Race(course, [S, P], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 1; r.started = true; }); race.t = 60;
  const e = run([S, P], 14, (t) => { if (t > 0.1) { P.want = -45 * DEG; P.rate = 45 * DEG; P.u = Math.max(1.8, P.u - 1 / 60); } }, { race, course });
  check(has(e, '18.3', P), `18.3 tacks in the zone under a starboard-tack boat: the tacking boat penalised (${desc(e)})`);
}
// ---- rule 19: overlapped at an obstruction (a rock), the outside boat gives the inside one room to pass it
{
  const world = { open: false, depthAt: (x, z) => (Math.hypot(x - 22, z + 66) < 3 ? 0.3 : 12) };
  const I = mk(1, 0, -64, 90, 3), O = mk(2, 0, -60, 90, 3);          // reaching east on port: I to windward, nearer the rock
  const e = run([I, O], 12, (t) => { if (I.x > 11) { I.want = 115 * DEG; I.rate = 20 * DEG; } }, { world });
  check(has(e, '19', O), `19  inside boat bears away round a rock, the outside (leeward) boat holds on: outside penalised (${desc(e)})`);
}
// ---- rule 20: hailing for room to tack at an obstruction (a shore 70 m to windward... to the north-west)
{
  const world = { open: false, depthAt: (x, z) => (-x - z > 120 ? 0.3 : 12) };
  const mkPair = () => { const L = mk(1, 0, 0, -45, 3), W = mk(2, Math.cos(-45 * DEG) * 7, Math.sin(-45 * DEG) * 7, -45, 3); return [L, W]; };
  { // the windward boat answers by tacking; the hailing boat then tacks: no incident
    const [L, W] = mkPair(); let hailed = null;
    const e = run([L, W], 30, (t, eng) => {
      if (!hailed && eng.obstructionAhead(L, L.psi, 45) < 1e9) hailed = eng.hail(L);
      if (hailed && eng.t > hailed.t + 1.5) { W.want = 45 * DEG; W.rate = 30 * DEG; }
      if (hailed && hailed.answered) { L.want = 45 * DEG; L.rate = 30 * DEG; }
    }, { world });
    check(hailed && hailed.valid && incs(e).length === 0, `20  valid hail, answered by tacking, then the hailing boat tacks: no incident (${desc(e)})`);
  }
  { // the windward boat does not answer
    const [L, W] = mkPair(); let hailed = null;
    const e = run([L, W], 26, (t, eng) => { if (!hailed && eng.obstructionAhead(L, L.psi, 45) < 1e9) hailed = eng.hail(L); }, { world });
    check(has(e, '20.2', W), `20  hail not answered: the hailed boat penalised (${desc(e)})`);
  }
  { // hailing in open water, nowhere near the shore: 20.1
    const [L, W] = mkPair(); L.x -= 300; W.x -= 300; L.z += 300; W.z += 300; let hailed = null;
    const e = run([L, W], 8, (t, eng) => { if (!hailed && t > 1) hailed = eng.hail(L); if (hailed && eng.t > hailed.t + 1.5) { W.want = 45 * DEG; } }, { world });
    check(hailed && !hailed.valid && has(e, '20.1', L), `20.1 hail with no obstruction near: the hailing boat penalised (${desc(e)})`);
  }
}
// ---- rule 31 and 44.2: touching a mark, a one-turn penalty, the turn counted
{
  const course = new Course(null, 0, { length: 800 });
  const m = course.windward;
  const A = mk(1, m.x + 0.6 + 8 * Math.sin(45 * DEG), m.z + 8 * Math.cos(45 * DEG), -45, 2.5);
  const race = new Race(course, [A], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 1; r.started = true; }); race.t = 60;
  let pen = null, done = false;
  const e = run([A], 40, (t, eng) => {
    pen = pen || eng.penaltyOf(A);
    if (pen && !done) A.turn = -24 * DEG;           // bear away, gybe, round up, tack: one full turn
    if (eng.events.some(x => x.type === 'penaltyDone')) { done = true; A.turn = 0; }
  }, { race, course });
  check(has(e, '31', A) && pen && pen.turns === 1, `31  touching the windward mark: a one-turn penalty (${desc(e)})`);
  check(done, `44.2 the turn (a tack and a gybe) is counted and the penalty cleared`);
}
{ // two turns: one turn is not enough; not finished by the deadline, DSQ
  const A = mk(1, 0, 0, -45, 2.5), B = mk(2, 0, -300, -45, 2.5);
  const course = new Course(null, 0, { length: 800 });
  const race = new Race(course, [A, B], { countdown: 0 });
  race.racers.forEach(r => { r.leg = 1; r.started = true; }); race.t = 60;
  let turned = 0;
  const e = run([A, B], 200, (t, eng) => {
    if (!turned && !eng.penaltyOf(A)) eng.penalize(A, { rule: '10', turns: 2 });
    if (turned < 360 * DEG) { A.turn = -24 * DEG; turned += 24 * DEG / 60; } else A.turn = 0;
  }, { race, course });
  const p = e.st.get(A).pen;
  check(race.racers[0].dsq === '10' && !e.events.some(x => x.type === 'penaltyDone'), `44.2 one turn of a two-turns penalty, then nothing: DSQ when time is up`);
  void p;
}
// ---- 29.1: OCS at the gun, the X flag, returning; one that never comes back is scored OCS
{
  const course = new Course(null, 0, { length: 800 });
  const c = course.origin;
  const A = mk(1, c.x, c.z - 3, -45, 0.3), B = mk(2, c.x + 20, c.z - 3, 0, 0), Cb = mk(3, c.x - 20, c.z + 10, 0, 0);
  const race = new Race(course, [A, B, Cb], { countdown: 3 });
  let xUp = false;
  const e = run([A, B, Cb], 30, (t) => {
    if (race.xFlag) xUp = true;
    if (t > 4 && t < 9) { A.psi = 180 * DEG; A.u = 1.5; }        // A dips back below the line
    if (t > 9) { A.psi = 0; A.u = 2; }
  }, { race, course });
  check(xUp && race.racers[0].ocsAtGun && race.racers[0].started, `29.1 X flag for boats over at the gun; A returned and started`);
  check(race.racers[1].ocs && !race.racers[1].started && e.incidents.some(i => i.rule === '29.1' && i.off === B), `29.1 B never returned: still OCS`);
}

// ---- the AI crews: a port–starboard crossing on the first beat, then penalty turns in every class (NOAI=1 skips)
if (!process.env.NOAI) {
  const course = new Course(null, 0, { length: 900 });
  const { makeSteadyEnv } = await import('../js/physics.js');
  const E = makeSteadyEnv(12 * KT);
  const mkB = (id, x, z, hdg) => { const b = new Boat('sportboat', { id, lod: 2 }); b.reset(x, z, hdg * DEG); b.u = 3; b.auto.hike = true; return b; };
  const T = 14, S = mkB(0, course.origin.x - 40, course.origin.z - 400, -45), P = mkB(1, 0, 0, 45);
  // put P where it meets S in T seconds (close-hauled ~3 m/s each)
  const Mx = S.x + Math.sin(-45 * DEG) * 3 * T, Mz = S.z - Math.cos(-45 * DEG) * 3 * T;
  P.x = Mx - Math.sin(45 * DEG) * 3 * T; P.z = Mz + Math.cos(45 * DEG) * 3 * T;
  const boats = [S, P];
  const race = new Race(course, boats, { countdown: 0 });
  race.racers.forEach(r => { r.leg = 1; r.started = true; }); race.t = 30;
  const rules = new RuleEngine({ race, course }); rules.upTwa = 40;
  const ais = boats.map(b => { const a = new AIHelm(b, { skill: 0.9 }); a.targetsUpBsp = 3; return a; });
  const sim = { boats, race, rules, course, env: E, world: null };
  const dt = 1 / 120; let contact = 0, minD = 1e9;
  for (let i = 0; i < 120 * 40; i++) {
    const t = i * dt;
    ais.forEach((a, k) => a.update(dt, t, sim, race.racers[k], course, { up: 40, dn: 150 }));
    boats.forEach(b => b.step(dt, E, t));
    resolveCollisions(boats, [], [], null, (a, b) => { contact++; rules.touch(a, b); });
    race.update(dt); rules.step(dt, boats);
    minD = Math.min(minD, Math.hypot(S.x - P.x, S.z - P.z));
  }
  const ducked = rules.incidents.length === 0 && contact === 0;
  check(ducked, `AI  port–starboard: the port boat keeps clear (closest ${minD.toFixed(1)} m, contact steps ${contact}, incidents ${desc(rules)})`);
}
for (const cls of process.env.NOAI ? [] : ['dinghy', 'sportboat', 'cat', 'blackwatch']) {
  const { makeSteadyEnv } = await import('../js/physics.js');
  const E = makeSteadyEnv(12 * KT);
  const course = new Course(null, 0, { length: 900 });
  const b = new Boat(cls, { id: 0, lod: 2 }); b.reset(course.origin.x, course.origin.z - 200, -42 * DEG); b.u = 2.5; b.auto.hike = true;
  const race = new Race(course, [b], { countdown: 0 });
  race.racers[0].leg = 1; race.racers[0].started = true; race.t = 30;
  const rules = new RuleEngine({ race, course }); rules.upTwa = 40;
  const ai = new AIHelm(b, { skill: 0.9 }); ai.targetsUpBsp = 2.5;
  const sim = { boats: [b], race, rules, course, env: E, world: null };
  const dt = 1 / 120; let doneT = null;
  for (let i = 0; i < 120 * 200 && doneT === null; i++) {
    const t = i * dt;
    if (i === 120 * 5) rules.penalize(b, { rule: '10', turns: 2 });
    ai.update(dt, t, sim, race.racers[0], course, { up: 40, dn: 150 });
    b.step(dt, E, t); race.update(dt); rules.step(dt, [b]);
    for (const e of rules.events.splice(0)) if (e.type === 'penaltyDone') doneT = t - 5;
  }
  check(doneT !== null && !race.racers[0].dsq, `AI  ${cls.padEnd(10)} takes a two-turns penalty: ${doneT !== null ? doneT.toFixed(0) + ' s' : 'not done'}`);
}
process.exit(bad ? 1 : 0);
