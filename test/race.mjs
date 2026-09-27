import { Environment, KT, DEG } from '../js/env.js';
import { Boat, solvePolar, vmgTargets } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
import { loadBakedPolars } from '../js/sail/surrogate.js';
import { VENUES, World } from '../js/world.js';
import { Course, Race, AIHelm, applyWindShadow, resolveCollisions } from '../js/race.js';
import { Traffic } from '../js/traffic.js';
import { readFileSync, existsSync } from 'node:fs';
// SEED=n: the race seed the AI personalities are drawn from (as the game's; repeatable either way)
const SEED = +(process.env.SEED ?? 0);
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
const course = new Course(world, env.wind.twd, { length: 800, laps: 1, lineLength: 60 + 14 * +nb });   // (the game's line: longer for a bigger fleet)
console.log('course len', course.L.toFixed(0), 'origin', course.origin.x.toFixed(0), course.origin.z.toFixed(0), 'depth at W', world.depthAt(course.windward.x, course.windward.z).toFixed(1));
const boats = [], ais = [];   // (the AI fleet sails at L1 in the game: LOD=0/1/2 to change it; a big fleet has only
// the NCLOTH nearest the camera in cloth, the rest on the strip model: NCLOTH=n puts boats n.. at L2)
for (let i=0;i<+nb;i++){ const b=new Boat(cls,{id:i, lod: i < +(process.env.NCLOTH ?? 1e9) ? +(process.env.LOD ?? 1) : 2}); const off=(i-(+nb)/2)*Math.min(16, 2*course.half/(+nb+1)); b.reset(course.origin.x - course.ux*150 + course.rx*off, course.origin.z - course.uz*150 + course.rz*off, env.wind.twd+Math.PI/2); boats.push(b); const a=new AIHelm(b,{seed: SEED, startFrac:i/(+nb), skill: 0.85+0.03*i}); a.targetsUpBsp=vt.up.bsp; ais.push(a);}
const race = new Race(course, boats, { countdown: 90 });
// TRAFFIC=light|normal|busy: the harbour traffic around the race, kept off the course as in the game
let traffic = null, bumps = 0;
if (process.env.TRAFFIC && !v.open) {
  const keepOut = [], r = Math.max(220, Math.hypot(course.committee.x - course.pin.x, course.committee.z - course.pin.z) / 2 + 120);
  for (let s = -250; s <= course.L + 150; s += 120) keepOut.push({ x: course.origin.x + course.ux * s, z: course.origin.z + course.uz * s, r });
  const tf = `data/venues/${vid}.traffic.json`;
  traffic = new Traffic(world, existsSync(tf) ? JSON.parse(readFileSync(tf)) : null, { density: process.env.TRAFFIC, seed: SEED, twd: env.wind.twd, keepOut, piers: (geo?.piers || []).filter(p => p.kind !== 'bridge'), venue: vid });
  console.log('traffic', JSON.stringify(traffic.counts()));
}
const sim = { boats, world, race, env };   // as in the game: the AI reads the tide field
const dt=1/120; let t=0; let aground=0;   // (dt: the game's physics step)
const piers = geo?.piers||[];
for (let s=0; s< +mins*60/dt; s++) {
  race.update(dt);
  applyWindShadow(boats);
  for (let i=0;i<boats.length;i++){ ais[i].update(dt,t,sim,race.racers[i],course,{up:vt.up.twa,dn:vt.dn.twa}); boats[i].step(dt,env,t,world); if(boats[i].aground>0.05) aground++; }
  resolveCollisions(boats, [...course.marks(), course.committee], piers);
  if (traffic) { if (s % 4 === 0) traffic.update(4 * dt, t, env, boats); traffic.collide(boats, () => bumps++); if (boats.some(b => !Number.isFinite(b.x + b.z + b.u))) { console.log('NaN at', t.toFixed(1)); process.exit(1); } }
  t+=dt;
  for (const e of race.events.splice(0)) if (e.type!=='signal') console.log(`t=${race.clock.toFixed(0)}s`, e.type, e.boat?.id ?? '', e.name ?? '', e.place ?? '');
  if (race.racers.every(r=>r.finished)) break;
  if (process.env.TR && s%(120*10)==0) { const b=boats[0]; console.log(`clk ${race.clock.toFixed(0)} x ${b.x.toFixed(0)} z ${b.z.toFixed(0)} hdg ${(b.psi/DEG).toFixed(0)} u ${(b.u/KT).toFixed(1)} twa ${(b.diag.twa/DEG).toFixed(0)} tws ${(b.diag.tws/KT).toFixed(1)} depth ${world.depthAt(b.x,b.z).toFixed(1)} mode ${ais[0].mode} leg ${race.racers[0].leg} shadow ${b.shadow.toFixed(2)}`); }
}
for (const r of race.standings()) console.log('boat', r.boat.id, 'leg', r.leg, r.finished ? 'finished '+r.finishTime.toFixed(0)+'s' : 'dnf', 'mode', ais[r.boat.id].mode, 'spd', (r.boat.u/KT).toFixed(1));
console.log('aground steps', aground, traffic ? `traffic bumps ${bumps}` : '');
