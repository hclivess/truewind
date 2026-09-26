import { Environment, KT, DEG } from '../js/env.js';
import { Boat, solvePolar, vmgTargets } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { Course, Race, AIHelm, applyWindShadow, resolveCollisions } from '../js/race.js';
import { readFileSync } from 'node:fs';
// SEED=n makes the AI personalities (Math.random) repeatable
if (process.env.SEED) { let a = +process.env.SEED >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
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
for (let i=0;i<+nb;i++){ const b=new Boat(cls,{id:i, lod: +(process.env.LOD ?? 1)}); const off=(i-(+nb)/2)*15; b.reset(course.origin.x - course.ux*150 + course.rx*off, course.origin.z - course.uz*150 + course.rz*off, env.wind.twd+Math.PI/2); boats.push(b); const a=new AIHelm(b,{startFrac:i/(+nb), skill: 0.85+0.03*i}); a.targetsUpBsp=vt.up.bsp; ais.push(a);}
const race = new Race(course, boats, { countdown: 90 });
const sim = { boats, world, race, env };   // as in the game: the AI reads the tide field
const dt=1/120; let t=0; let aground=0;   // (dt: the game's physics step)
const piers = geo?.piers||[];
for (let s=0; s< +mins*60/dt; s++) {
  race.update(dt);
  applyWindShadow(boats);
  for (let i=0;i<boats.length;i++){ ais[i].update(dt,t,sim,race.racers[i],course,{up:vt.up.twa,dn:vt.dn.twa}); boats[i].step(dt,env,t,world); if(boats[i].aground>0.05) aground++; }
  resolveCollisions(boats, [...course.marks(), course.committee], piers);
  t+=dt;
  for (const e of race.events.splice(0)) if (e.type!=='signal') console.log(`t=${race.clock.toFixed(0)}s`, e.type, e.boat?.id ?? '', e.name ?? '', e.place ?? '');
  if (race.racers.every(r=>r.finished)) break;
  if (process.env.TR && s%(120*10)==0) { const b=boats[0]; console.log(`clk ${race.clock.toFixed(0)} x ${b.x.toFixed(0)} z ${b.z.toFixed(0)} hdg ${(b.psi/DEG).toFixed(0)} u ${(b.u/KT).toFixed(1)} twa ${(b.diag.twa/DEG).toFixed(0)} tws ${(b.diag.tws/KT).toFixed(1)} depth ${world.depthAt(b.x,b.z).toFixed(1)} mode ${ais[0].mode} leg ${race.racers[0].leg} shadow ${b.shadow.toFixed(2)}`); }
}
for (const r of race.standings()) console.log('boat', r.boat.id, 'leg', r.leg, r.finished ? 'finished '+r.finishTime.toFixed(0)+'s' : 'dnf', 'mode', ais[r.boat.id].mode, 'spd', (r.boat.u/KT).toFixed(1));
console.log('aground steps', aground);
