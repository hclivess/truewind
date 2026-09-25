import { solvePolar, vmgTargets } from '../js/physics.js';
const KT=0.514444;
const classes = process.argv[2] ? [process.argv[2]] : ['blackwatch','sportboat','dinghy','cat'];
for (const cls of classes) for (const tws of [6,12,20]) {
  const t0=Date.now();
  const p = solvePolar(cls, tws*KT);
  const v=vmgTargets(p);
  console.log(`${cls.padEnd(10)} ${String(tws).padStart(2)}kt ${Date.now()-t0}ms  up ${v.up.twa}° ${(v.up.bsp/KT).toFixed(2)}kn vmg ${(v.up.vmg/KT).toFixed(2)} | ` +
   p.filter(r=>[90,120,150,180].includes(r.twa)).map(r=>`${r.twa}:${(r.bsp/KT).toFixed(1)}${r.gen?'g':''}`).join(' ') + ` | dn ${v.dn.twa}° vmg ${(-v.dn.vmg/KT).toFixed(2)}  heelUp ${v.up.heel?.toFixed(0)} lee ${v.up.leeway?.toFixed(1)}`);
}
