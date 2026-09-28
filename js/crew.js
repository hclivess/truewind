// The automatic crew's hands (the player's boat with automatic trim on). autoTrim (js/physics.js) is what a
// competent crew wants; here the crew does it the way the player would, through the same lines and hardware: a sheet
// is eased out of its cam (the cleat opens, the line runs, it is made fast again), hauled in hand over hand or ground
// in on the winch at the rate hands and a winch manage, a shape control is set in one pull when it is far enough off
// to be worth it, and the jib sheet is let fly in a tack. So the panel's rows, the cleats' states, the winch handle,
// the ropes and the sounds all show the crew at work — and it says what it did and why (Crew.said, for the HUD's
// crew line). No three.js here: node runs it (test/crew.mjs).
import { work, letFly, handRate, handLoad, lineName, tackleOf, RUNS_UP, HAUL, HAND_SPEED } from './linehandlers.js';

const DEG = Math.PI / 180, KT = 0.514444;
// the controls the crew works, and its dead bands (control units): it starts when the line is more than on off
// where it wants it, and stops within off of it. A sheet is played continuously; a shape control set now and then.
const BAND = {
  main: [0.012, 0.003], jib: [0.012, 0.003], stay: [0.012, 0.003], mizzen: [0.015, 0.004], trav: [0.02, 0.005],
  vang: [0.06, 0.012], cunn: [0.07, 0.015], outhaul: [0.07, 0.015], backstay: [0.07, 0.015], jibHalyard: [0.08, 0.02],
  tackLine: [0.06, 0.015], jibLead: [0.06, 0.015], board: [0.1, 0.03],
};
export const CREW_KEYS = Object.keys(BAND);
const SHEET = new Set(['main', 'jib', 'stay', 'mizzen']);
const WINCH_R = 0.03;           // m: the drum's radius (a line turns it once per 19 cm)

export class Crew {
  constructor() { this.plan = null; this.act = {}; this.said = []; this.t = 0; this.last = {}; }
  // before autoTrim runs: it plans on the crew's intentions (this.plan), not on where the lines are
  begin(b) {
    const c = b.ctrl;
    if (!this.plan || this.plan.b !== b) { this.plan = { b }; this.act = {}; for (const k of CREW_KEYS) if (c[k] !== undefined) this.plan[k] = c[k]; }
    this.real = {}; this.locks = b.locks ? { ...b.locks } : null;
    // (only the strings this boat has: the rest autoTrim leaves alone, or sets where nothing is to be seen)
    const S = b.sailBy, C = b.cls, has = { stay: !!S.stay, mizzen: !!S.mizzen, jib: !!(S.jib || S.gennaker), jibLead: !!S.jib, jibHalyard: !!S.jib, trav: !!S.main.trav, backstay: !!C.hasBackstay, tackLine: !!S.gennaker, board: !!C.hasBoard };
    for (const k of CREW_KEYS) if (c[k] !== undefined && has[k] !== false) { this.real[k] = c[k]; c[k] = this.plan[k] ?? c[k]; }
    this.crewY0 = this.crewY0 ?? b.crewY;
  }
  // after autoTrim: the plan is what it wrote; the lines go back where they are and the hands move them toward it
  end(b, dt) {
    const c = b.ctrl, d = b.diag; this.t += dt;
    if (this.locks && b.locks) for (const k in this.locks) b.locks[k] = this.locks[k];   // (autoTrim makes every line fast: the hardware decides)
    for (const k of CREW_KEYS) {
      if (this.real[k] === undefined) continue;
      const now = this.real[k], [on, off] = BAND[k];
      // (a plan that runs away from the line while the hands are busy is held within reach: no wind-up)
      let want = c[k]; if (SHEET.has(k) || k === 'trav') want = Math.min(now + 4 * on, Math.max(now - 4 * on, want));
      this.plan[k] = want; c[k] = now;
      const e = want - now, A = this.act[k] || (this.act[k] = { on: false, dir: 0, from: 0, t: 0 });
      if (!A.on) {
        if (Math.abs(e) <= on) continue;
        A.on = true; A.dir = Math.sign(e); A.from = now; A.t = 0; A.why = this.reason(b, k, A.dir);
      }
      if (Math.abs(e) < off || Math.sign(e) !== A.dir) { this.done(b, k, A); continue; }
      A.t += dt;
      const trimming = RUNS_UP.has(k) ? A.dir < 0 : A.dir > 0;
      // tacking: the old jib sheet is thrown off the winch and runs free (autoTrim lets it fly: plans it fully out)
      if (k === 'jib' && want >= 0.999 && e > 0.25 && b.sailBy.jib && b.genDeploy < 0.5) {
        if (!(b.lh && b.lh.jib && b.lh.jib.fly)) { letFly(b, 'jib'); this.say(`${lineName(b, 'jib')} let fly: tacking`, 'jib'); }
        A.on = false; continue;
      }
      const f = b.locks && k in b.locks ? work(b, k, trimming) : 1;       // (casting off first when easing a cleated line)
      const step = Math.min(Math.abs(e), this.rate(b, k, trimming) * dt) * f;
      c[k] = now + A.dir * step;
    }
    // the crew's weight: said when they move across (automatic weight is the boat's own, js/physics.js)
    if (b.auto.hike && Math.abs(b.crewY - this.crewY0) > 0.35) {
      const out = Math.abs(b.crewY) > Math.abs(this.crewY0), heel = Math.round(Math.abs(b.phi) / DEG);
      this.say(out ? `Crew out on the rail: heel ${heel}°` : Math.abs(b.crewY) < 0.2 ? 'Crew in to the middle: light air' : `Crew in a little: heel ${heel}°`, 'hike');
      this.crewY0 = b.crewY;
    }
  }
  // control units a second the crew moves line k: hand over hand through its tackle, a sheet on a winch tailed by hand
  // while it is light and ground in on the winch when not (fast gear, then slow), eased round the drum
  rate(b, k, trimming) {
    const C = b.cls;
    // the jib car slides along its track by its adjuster, slower the harder the sheet pulls on it (0.12 m/s free); a
    // board is pulled up or pushed down by hand (0.4 m/s)
    if (k === 'jibLead') { const jt = C.hw && C.hw.jibTrack, len = jt ? Math.max(0.15, Math.abs(jt[0] - jt[1])) : 0.4, ld = (b.diag.rig.jibLoad || 0) / (C.sheetPower || 800); return 0.12 / (1 + ld * ld) / len; }
    if (k === 'board') return 0.4 / Math.max(0.4, C.keel && C.keel.span ? C.keel.span : C.draft || 1);
    const hr = handRate(b, k, trimming);
    if (hr !== null) return Math.max(hr, SHEET.has(k) ? 0.05 : 0);
    const tk = tackleOf(b.cls, k === 'lazy' ? 'lazy' : b.genDeploy > 0.5 ? 'gen' : 'jib'), L = Math.max(0.3, tk.travel);
    if (!trimming) return 0.5 / L;                                        // surged out round the drum
    const T = handLoad(b, k, true);
    return (T < HAUL ? HAND_SPEED : T < 4 * HAUL ? 0.3 : 0.1) / L;       // tailing / fast gear / slow gear
  }
  // an adjustment finished: what it was and why, for the crew line (sheets only when it was worth a word)
  done(b, k, A) {
    A.on = false;
    const dv = (this.real[k] ?? 0) - A.from, cm = Math.abs(dv) * (k === 'jibLead' || k === 'board' ? 0 : tackleOf(b.cls, k).travel) * 100;
    if (SHEET.has(k) || k === 'trav') { if (cm < 4 && !(k === 'trav' && Math.abs(dv) > 0.08)) return; }
    else if (Math.abs(dv) < 0.05) return;
    const what = A.why || this.reason(b, k, A.dir);
    this.say(SHEET.has(k) && cm >= 1 ? what.replace(/^(Trimming|Easing) (the [^:]+)/, (m, v, s) => `${v === 'Trimming' ? 'Trimmed' : 'Eased'} ${s} ${Math.round(cm)} cm`) : what, k);
  }
  say(msg, key) {
    // (one message per control at a time, not twice within 8 s; the HUD merges and paces the rest)
    const t = this.last[key];
    if (t !== undefined && this.t - t < 8) return;
    this.last[key] = this.t; this.said.push({ msg, key });
    if (this.said.length > 12) this.said.shift();                     // (nobody reading: the idle demo)
  }
  // why the crew is moving line k in direction dir (+: the control up), in the words a crew would use
  reason(b, k, dir) {
    const d = b.diag, C = b.cls, tws = Math.round((d.tws ?? 0) / KT), heel = Math.round(Math.abs(b.phi) / DEG);
    const awa = Math.abs(d.awaMid ?? d.awa ?? Math.PI) / DEG, over = Math.abs(b.phi) > (C.targetHeel ?? 15 * DEG) + 3 * DEG;
    const run = awa > 120, reach = awa > 70 && !run;
    const sail = k === 'jib' ? (b.genDeploy > 0.5 ? ((b.sailBy.gennaker && b.sailBy.gennaker.label) || 'gennaker').toLowerCase() : (b.sailBy.jib && b.sailBy.jib.label ? b.sailBy.jib.label.toLowerCase() : 'jib'))
      : k === 'stay' ? ((b.sailBy.stay && b.sailBy.stay.label) || 'staysail').toLowerCase() : k;
    const st = d.strips && d.strips[k === 'jib' && b.genDeploy > 0.5 ? 'gennaker' : k];
    const count = (s) => (st ? [0, 1, 2].filter((i) => st[i] && st[i].state === s).length : 0);
    switch (k) {
      case 'main': case 'jib': case 'stay': case 'mizzen':
        if (dir > 0) {   // easing
          if (over) return `Easing the ${sail} in the puff: heel ${heel}°`;
          if (count(3) >= 2) return `Easing the ${sail}: leeward telltales stalling`;
          if (awa > 100) return `Easing the ${sail} as she bears away`;
          return `Easing the ${sail} to the telltales`;
        }
        if (count(1) >= 1) return `Trimming the ${sail}: luff lifting`;
        if (awa < 60) return `Trimming the ${sail}: telltales lifting to leeward`;
        return `Trimming the ${sail} to the telltales`;
      case 'trav': return dir > 0 ? `Traveller down to leeward${over ? `: heel ${heel}°` : ''}` : 'Traveller up to windward: more power';
      case 'vang': return dir > 0 ? (run ? 'Vang on for the run: holding the boom down' : reach ? 'Vang on: closing the leech on the reach' : `Vang on: closing the leech, ${tws} kn`)
        : run ? 'Vang eased on the run' : over ? `Vang eased: twisting the head off, heel ${heel}°` : 'Vang eased: more twist';
      case 'cunn': return dir > 0 ? `Cunningham on: ${tws} kn, flattening the main` : reach || run ? 'Cunningham off for the reach: fuller main' : 'Cunningham off: fuller main, draft aft';
      case 'outhaul': return dir > 0 ? `Outhaul on: flatter foot for ${tws} kn` : 'Outhaul eased: deeper foot for power';
      case 'backstay': return dir > 0 ? `Backstay on: bending the mast, flattening the main (${tws} kn)` : 'Backstay eased: fuller main, more forestay sag';
      case 'jibHalyard': return dir > 0 ? 'Jib halyard up: tighter luff, draft forward' : 'Jib halyard eased: rounder entry';
      case 'jibLead': return dir > 0 ? 'Jib car aft: opening the leech' : 'Jib car forward: closing the leech, deeper foot';
      case 'tackLine': return dir > 0 ? 'Tack line eased: letting the luff rotate' : 'Tack line down: straighter luff';
      case 'board': return dir > 0 ? 'Board down for upwind' : `Board up ${run ? 'on the run' : 'off the wind'}`;
    }
    return `${lineName(b, k)} ${dir > 0 ? 'up' : 'down'}`;
  }
}
