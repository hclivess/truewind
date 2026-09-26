// Heavy-air behaviour: spawn as the game does (beam reach, u=1.2, crew presets trim), then hand over
// with the helm centred and the sheets as preset (auto weight on, auto trim off unless 'auto').
// A real boat overpowered with the helm left alone rounds up (or is knocked down); it must not sit
// stalled sliding sideways.
import { Boat, autoTrim, makeSteadyEnv } from '../js/physics.js';
import '../js/sail/sailsim.js';   // the game's sail model (cloth by default; SAILS=strip for the strip model)
const KT = 0.514444, DEG = Math.PI / 180;
const [cls = 'blackwatch', tws = 40, mode = 'manual', secs = 60] = process.argv.slice(2);
const env = makeSteadyEnv(+tws * KT);
const b = new Boat(cls);
b.reset(0, 0, 90 * DEG); b.u = 1.2;
for (let i = 0; i < 480; i++) { autoTrim(b, 1 / 120, 0, true); b.step(1 / 120, env, 0); b.psi = 90 * DEG; b.r = 0; }
b.lines.main = b.ctrl.main; b.lines.jib = b.ctrl.jib; b.lines.stay = b.ctrl.stay; b.lines.lazy = b.ctrl.lazy = 1;
const dt = 1 / 120; let t = 0, maxHeel = 0;
for (let i = 0; i < 120 * +secs; i++) {
  if (mode === 'auto') autoTrim(b, dt);
  b.step(dt, env, t); t += dt; maxHeel = Math.max(maxHeel, Math.abs(b.phi));
  if (i % 240 === 0) {
    const d = b.diag;
    console.log(`t ${t.toFixed(0).padStart(3)} hdg ${(b.psi / DEG).toFixed(0).padStart(4)} twa ${(d.twa / DEG).toFixed(0).padStart(4)} u ${(b.u / KT).toFixed(2).padStart(5)} v ${(b.v / KT).toFixed(2).padStart(5)} lee ${(d.leeway / DEG).toFixed(0).padStart(3)} heel ${(b.phi / DEG).toFixed(0).padStart(3)} rud ${(b.rudder / DEG).toFixed(0)} r ${(b.r / DEG).toFixed(1)} | X sail ${d.sailX.toFixed(0)} keelX ${d.keelX.toFixed(0)} Rf ${d.Rf.toFixed(0)} Rr ${d.Rr.toFixed(0)} | N sail ${d.Nsail.toFixed(0)} keel ${d.Nkeel.toFixed(0)} rud ${d.Nrud.toFixed(0)} hull ${d.Nhull.toFixed(0)} | main ${b.lines.main.toFixed(2)} jib ${b.lines.jib.toFixed(2)} stay ${b.lines.stay.toFixed(2)} keelSt ${d.keelStall} vent ${d.rudderVent.toFixed(2)}`);
  }
}
console.log(`max heel ${(maxHeel / DEG).toFixed(0)}°`);
