// Crew fatigue (pure logic, no three.js): hiking and trapezing endurance, and the work of grinding, hauling and
// pumping. It limits what the crew (the automatic crew and the player's) can give.
//
//  * HIKING is an isometric hold of the quadriceps and the trunk. Its load, as a fraction f of maximal voluntary
//    contraction (MVC), grows with how far out the crew hangs: ~45% MVC for a Laser sailor straight-legged,
//    ~30% hiking a keelboat over the lifelines, ~12-15% on a trapeze or sitting on a cruiser's rail. Endurance
//    at a hold of f follows Rohmert's curve (1960), T = -1.5 + 2.1/f - 0.6/f^2 + 0.1/f^3 minutes: a full Laser
//    hike holds ~1 minute, a hard keelboat hike ~2.5; below ~15% MVC a hold can go on for hours. The reserve R
//    drains at 1/T while over that, and comes back while resting (half in ~1 minute). It caps how far out the
//    crew can hang: the sustainable depth + the rest in proportion to sqrt(R).
//  * WORK (grinding, tailing, pumping, hauling an anchor) follows the critical-power model: a crew member sustains
//    CP ~ 150 W (sailors' grinding tests: ~120-200 W sustained, 400-800 W for seconds), and has a reserve W' of
//    ~18 kJ above it, spent at P - CP and recovered below CP with Skiba's time constant
//    tau = 546 e^(-0.01 (CP - P)) + 316 s. With W' spent the crew can give only CP: sheets come in slower
//    (js/physics.js sheetPower x crewPower), manual pumps run slower (pumpPower).
import { clamp } from './physics.js';

export const FC = 0.15;                                   // Rohmert: holds under ~15% MVC are sustainable
export function rohmert(f) {                              // endurance (s) of a hold at f (fraction of MVC)
  if (f <= FC) return Infinity;
  const m = -1.5 + 2.1 / f - 0.6 / (f * f) + 0.1 / (f * f * f);
  return Math.max(6, 60 * m);
}
export const CP = 150, WPRIME = 18e3;
export function hikeMVC(C) { return C.hikeMVC ?? (C.trapeze ? 0.14 : C.id === 'dinghy' ? 0.45 : C.cabin || C.id === 'blackwatch' ? 0.13 : 0.3); }

export class Fatigue {
  constructor(boat) {
    this.b = boat; this.C = boat.cls;
    this.R = 1;                   // hiking reserve 0..1
    this.W = WPRIME;              // anaerobic work reserve (J), per crew member
    this.P = 0;                   // mechanical power the crew is putting out (W, per crew member)
    this.f = 0;                   // current hold (fraction of MVC)
    this._lines = null;
  }
  get fresh() { return Math.min(this.R, this.W / WPRIME); }
  post(dt, extraW = 0) {
    const b = this.b, C = this.C, d = b.diag;
    // ---- hiking: how far out, which side the wind is
    const out = clamp(Math.abs(b.crewY) / Math.max(0.1, C.crewMaxOut), 0, 1);
    const windward = Math.sign(b.crewY) === (Math.sign(d.awaMid || 0) || 1) || out < 0.05;   // (the crew hikes to the side the wind comes from)
    const fmax = hikeMVC(C);
    const f = windward ? fmax * Math.pow(out, 1.5) : 0;
    this.f = f;
    if (f > FC) this.R = Math.max(0, this.R - dt / rohmert(f));
    else this.R = Math.min(1, this.R + dt * (1 - this.R) / 60 * (1 - f / FC) * Math.LN2 * 1.2);
    const sust = fmax > FC ? Math.pow(0.85 * FC / fmax, 1 / 1.5) : 1;   // a depth a hold can keep up for ever (a little under the limit)
    b.hikeLimit = fmax > FC ? sust + (1 - sust) * Math.sqrt(this.R) : 1;
    // ---- work: sheets hauled in under load, plus the pump and the anchor (extraW), shared by the crew aboard
    const L = this._lines || (this._lines = {});
    let P = extraW;
    for (const s of C.sails) {
      const k = s.kind === 'boom' ? s.key : 'jib';
      const now = b.lines[k] ?? 0, was = L[k] ?? now; L[k] = now;
      if (now < was) {                                     // trimming in: work = load x the length hauled
        const travel = s.foot * Math.max(0.3, (s.max - s.min));
        P += (d.rig[k + 'Load'] || 0) * (was - now) * travel / dt;
      }
    }
    if (b.pumpWork) P += 90;                                // a manual bilge pump: ~90 W at the handle
    const crew = Math.max(1, Math.round(b.crewMass / C.crewEach));
    const Pe = P / Math.min(crew, 2);                       // (two at most on the winches / pump)
    this.P = Pe;
    if (Pe > CP) this.W = Math.max(0, this.W - (Pe - CP) * dt);
    else { const tau = 546 * Math.exp(-0.01 * (CP - Pe)) + 316; this.W += (WPRIME - this.W) * (1 - Math.exp(-dt / tau)); }
    // what the crew can pull with: CP alone when W' is gone, ~1.6 x more when fresh (the sheet-power spec is a fresh crew)
    const fr = this.W / WPRIME;
    b.crewPower = 0.55 + 0.45 * Math.sqrt(fr);
    b.pumpPower = 0.6 + 0.4 * Math.sqrt(fr);
  }
}
