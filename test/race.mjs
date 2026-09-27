import { Environment, KT, DEG } from '../js/env.js';
import { Boat, solvePolar, vmgTargets, wrap } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { Course, Race, AIHelm, applyWindShadow, resolveCollisions } from '../js/race.js';
import { RuleEngine } from '../js/rules.js';
import { readFileSync } from 'node:fs';
// SEED=n: the race seed the AI personalities are drawn from (as the game's; repeatable either way)
// RULES=0: sail without the racing rules (the old swerve-only traffic avoidance), to compare collisions
const SEED = +(process.env.SEED ?? 0), RULES = process.env.RULES !== '0';
const [vid='solent', cls='sportboat', nb='6', mins='25'] = process.argv.slice(2);
const v = VENUES.find(x=>x.id===vid);
const geo = v.open ? null : JSON.parse(readFileSync(`data/venues/${vid}.json`));
const world = new World(v, geo);
const env = new Environment({ tws: v.windKt*KT, twd: v.wind, gust: 0.5, shift: 7, fetchKm: 8, currentKt: v.current?.kt ?? 0, currentDir: v.current?.dir ?? 90 });
world.updateShelter(env.wind.twd);
const base = env.wind.sample.bind(env.wind);
env.wind.sample = (x,z,t,o)=>{ base(x,z,t,o); o.speed *= world.shelterAt(x,z); return o; };
await loadBakedPolars(cls);   // (the cloth sails' polar, as the game has it)
const polar = solvePolar(cls, v.windKt*KT); const vt = vmgTargets(polar);
console.log('targets up', vt.up.twa, 'dn', vt.dn.twa);
const course = new Course(world, env.wind.twd, { length: 800, laps: 1 });
console.log('course len', course.L.toFixed(0), 'origin', course.origin.x.toFixed(0), course.origin.z.toFixed(0), 'depth at W', world.depthAt(course.windward.x, course.windward.z).toFixed(1));
const boats = [], ais = [];   // (the AI fleet sails at L1 in the game: LOD=0/1/2 to change it)
for (let i=0;i<+nb;i++){ const b=new Boat(cls,{id:i, lod: +(process.env.LOD ?? 1)}); const off=(i-(+nb)/2)*15; b.reset(course.origin.x - course.ux*150 + course.rx*off, course.origin.z - course.uz*150 + course.rz*off, env.wind.twd+Math.PI/2); boats.push(b); const a=new AIHelm(b,{seed: SEED, startFrac:i/(+nb), skill: 0.85+0.03*i}); a.targetsUpBsp=vt.up.bsp; ais.push(a);}
const race = new Race(course, boats, { countdown: 90 });
const rules = RULES ? new RuleEngine({ race, course, world, piers: geo?.piers || [] }) : null;
if (rules) rules.upTwa = vt.up.twa;
const sim = { boats, world, race, env, rules, course };   // as in the game: the AI reads the tide field
let collisions = 0, contactT = 0; const lastHit = new Map(), pairT = new Map();
const onTouch = (b, o) => {
  if (rules) rules.touch(b, o);
  if (!o.cls) return;
  contactT += dt; const k = Math.min(b.id, o.id) * 1000 + Math.max(b.id, o.id);
  if (t - (lastHit.get(k) ?? -1e9) > 3) { collisions++; if (process.env.DBG) console.log(`t=${race.clock.toFixed(0)}s contact ${b.id}-${o.id}`); }   // (one collision: contact after three seconds apart)
  pairT.set(k, (pairT.get(k) || 0) + dt);
  lastHit.set(k, t);
};
const dt=1/120; let t=0; let aground=0;   // (dt: the game's physics step)
const piers = geo?.piers||[];
for (let s=0; s< +mins*60/dt; s++) {
  race.update(dt);
  applyWindShadow(boats);
  for (let i=0;i<boats.length;i++){ ais[i].update(dt,t,sim,race.racers[i],course,{up:vt.up.twa,dn:vt.dn.twa}); boats[i].step(dt,env,t,world); if(boats[i].aground>0.05) aground++; }
  resolveCollisions(boats, [...course.marks(), course.committee], piers, null, onTouch);
  if (rules) rules.step(dt, boats);
  t+=dt;
  for (const e of race.events.splice(0)) if (e.type!=='signal') console.log(`t=${race.clock.toFixed(0)}s`, e.type, e.boat?.id ?? '', e.name ?? '', e.place ?? '');
  if (rules) for (const e of rules.events.splice(0)) {
    if (e.type === 'incident') {
      console.log(`t=${race.clock.toFixed(0)}s rule ${e.inc.rule} ${e.inc.kind}: ${e.inc.off.id}${e.inc.vic ? ' vs ' + e.inc.vic.id : ''}${e.inc.mark ? ' (' + (e.inc.mark.name || e.inc.mark.kind) + ')' : ''}`);
      if (process.env.DBG && e.inc.vic) {   // DBG=1: both boats as the umpire saw them
        const pr = rules.pairOf(e.inc.off, e.inc.vic);
        for (const b of [e.inc.off, e.inc.vic]) { const s = rules.S(b); console.log(`   ${b.id} x ${b.x.toFixed(1)} z ${b.z.toFixed(1)} hdg ${(b.psi/DEG).toFixed(0)} twa ${(wrap(b.diag.twd-b.psi)/DEG).toFixed(0)} u ${b.u.toFixed(2)} r ${(b.r/DEG).toFixed(1)} tack ${s.tack}${s.tacking?' TACKING':''} mode ${ais[b.id].mode} pen ${!!s.pen} ago ${((wrap(b.psi-rules.psiAgo(s,2.5)))/DEG).toFixed(0)}`); }
        if (pr) console.log(`   pair give ${pr.give?.id} rule ${pr.rule} overlap ${pr.overlap} astern ${pr.astern?.id} lee ${pr.leeward?.id} clr ${pr.clr?.toFixed(2)} when ${pr.when} now ${pr.now?.toFixed(2)} room ${pr.room ? pr.room.rule + ' ' + pr.room.ent.id : '-'} acq ${pr.acq ? (rules.t - pr.acq.t).toFixed(1) + ' own ' + pr.acq.own : '-'}`);
      }
    }
    else if (e.type === 'penalty') console.log(`t=${race.clock.toFixed(0)}s penalty ${e.boat.id}: ${e.pen.turns} turn(s), rule ${e.inc.rule}`);
    else if (e.type === 'penaltyDone' || e.type === 'dsq' || e.type === 'hail') console.log(`t=${race.clock.toFixed(0)}s ${e.type} ${(e.boat || e.from).id}${e.to ? ' -> ' + e.to.id : ''}${e.why ? ' (' + e.why + ')' : ''}`);
  }
  if (race.racers.every(r=>r.finished)) break;
  if (process.env.TR && s%(120*10)==0) { const b=boats[0]; console.log(`clk ${race.clock.toFixed(0)} x ${b.x.toFixed(0)} z ${b.z.toFixed(0)} hdg ${(b.psi/DEG).toFixed(0)} u ${(b.u/KT).toFixed(1)} twa ${(b.diag.twa/DEG).toFixed(0)} tws ${(b.diag.tws/KT).toFixed(1)} depth ${world.depthAt(b.x,b.z).toFixed(1)} mode ${ais[0].mode} leg ${race.racers[0].leg} shadow ${b.shadow.toFixed(2)}`); }
}
for (const r of race.standings()) console.log('boat', r.boat.id, 'leg', r.leg, r.finished ? 'finished '+r.finishTime.toFixed(0)+'s' : 'dnf', 'mode', ais[r.boat.id].mode, 'spd', (r.boat.u/KT).toFixed(1));
console.log('aground steps', aground);
const inc = rules ? rules.incidents : [];
console.log(`collisions ${collisions} (in contact ${contactT.toFixed(1)} s) · incidents ${inc.length} · penalties ${inc.filter(i => i.turns).length} · taken ${inc.filter(i => i.status === 'taken').length} · DSQ ${race.racers.filter(r => r.dsq).length} · rules ${RULES ? 'on' : 'off'}`);
if (pairT.size) { const [k, v] = [...pairT].sort((a, b) => b[1] - a[1])[0]; console.log(`longest contact: boats ${Math.floor(k / 1000)} and ${k % 1000}, ${v.toFixed(1)} s`); }
const unfinished = race.racers.filter(r => !r.finished && !r.dsq).length;   // (a boat the umpire disqualified is out of the race, as scored)
if (unfinished) console.log(`${unfinished} boat(s) did not finish`);
process.exit(unfinished ? 1 : 0);
