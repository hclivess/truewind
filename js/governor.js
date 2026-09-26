// The sail governor: keeps the sails' physics under budget by moving boats between the cloth detail levels
// (L0 the full model, L1 the fleet's coarser one, L2 the strip model). Over budget for a while, it drops the boat
// farthest from the camera a level (the fleet first, the player last); well under budget for a while, it lifts
// them back, the player first, then the nearest boats. In time warp beyond x2 every boat sails at L2.
//
// It goes by sailing time and by the cost of sailing, not by the wall clock and the frame: a device that draws
// slowly runs up to 12 catch-up steps a frame at 4 frames a second, which is no reason to lighten the sails (it
// would not draw any faster), and three wall seconds there are a fraction of a second of sailing, too soon to
// judge anything. So:
//  - cost = physics ms per 1/60 s of sailing (the budget is 6 ms of a 60 Hz frame, whatever the frame rate);
//  - over / under budget, the session's hold and the hold after a switch count sailing seconds and frames;
//  - a long frame that the physics was not the most of (a shader compiling, a texture upload, a GPU that
//    cannot keep up, the tab away) does not count: its timings are noise and lighter sails would not shorten it;
//  - a boat is switched only once its cloth has flown (set and drawing for a second), and the new level takes
//    the sail over as it was (sailsim.js attachSails(.., warm) carries the cloth's shape and motion across).
import { attachSails } from './sail/sailsim.js';

export const GOV = { budget: 6, lift: 2.5, over: 1.5, under: 15, frames: 20, hold: 3, holdFrames: 90, after: 1, afterFrames: 30, flown: 1, longMs: 100 };

// a boat whose sails can change level now: at L2 (nothing flying), or every cloth sail set and drawing for a second
export function sailsFlown(b) {
  const S = b.sailSys;
  if (!S || b.lod >= 2 || S.lod !== b.lod) return true;
  for (const x of S.sails) if (x.rig && x.part.on && (x.rig.needPose || (x.rig.sincePose || 0) < GOV.flown)) return false;
  return true;
}

// move boat b to level lod: a new cloth takes the old one over as it flies (sailsim.js attachSails(.., warm)); to
// L2 the cloth is set aside, and back from L2 it flies on if it still fits (SailSystem.thaw)
export function setSailLevel(b, lod) {
  if (!b || b.sailModel === 'strip' || lod === b.lod) return;
  if (lod >= 2) { b.lod = 2; return; }
  if (!b.sailSys || b.sailSys.lod !== lod) attachSails(b, b.sailModel, lod, true);
  else { b.lod = lod; b.sailSys.thaw(); }
}

export class SailGovernor {
  // setLevel(b, lod): the switch; startLevel(b): the level a boat may be lifted back to; toast(b): after the
  // player's sails were dropped a level
  constructor(setLevel, startLevel, toast = null) { this.setLevel = setLevel; this.startLevel = startLevel; this.toast = toast; this.start(); }
  // a new session: hold for the first three seconds and 90 frames of sailing
  start() { this.ema = 0; this.over = 0; this.under = 0; this.nOver = 0; this.nUnder = 0; this.hold = GOV.hold; this.holdN = GOV.holdFrames; this.log = []; }
  // one frame: ms of physics over `steps` steps of dt (s) in a frame of frameMs wall ms; boats: the cloth-capable
  // boats (the player among them); dist(b): its distance from the camera; warp: the time warp. Returns the boat
  // it switched, if any.
  frame(ms, steps, dt, frameMs, boats, player, dist, warp = 1) {
    if (!steps || !player) return null;                          // paused, a menu: nothing sailed, nothing to judge
    if (warp > 2) {
      for (const b of boats) if (b.lod < 2) { b._savedLod = b.lod; this.setLevel(b, 2); }
      return null;
    }
    for (const b of boats) if (b._savedLod !== undefined) { this.setLevel(b, b._savedLod); b._savedLod = undefined; this.after(); }
    if (frameMs > GOV.longMs && ms < 0.5 * frameMs) return null;   // a long frame the drawing made long
    const sim = steps * dt, cost = ms / sim / 60;
    if (this.hold > 0 || this.holdN > 0) { this.hold -= sim; this.holdN--; this.ema = cost; this.over = this.under = this.nOver = this.nUnder = 0; return null; }
    this.ema += (cost - this.ema) * Math.min(1, sim * 4);
    if (this.ema > GOV.budget) { this.over += sim; this.nOver++; this.under = this.nUnder = 0; }
    else if (this.ema < GOV.lift) { this.under += sim; this.nUnder++; this.over = this.nOver = 0; }
    else this.over = this.under = this.nOver = this.nUnder = 0;
    const fleet = boats.filter((b) => b !== player);
    if (this.over > GOV.over && this.nOver >= GOV.frames) {
      const down = fleet.filter((b) => b.lod < 2 && sailsFlown(b)).sort((a, b) => dist(b) - dist(a))[0]
        || (player.lod < 2 && !fleet.some((b) => b.lod < 2) && sailsFlown(player) ? player : null);
      if (down) return this.switch(down, down.lod + 1, player);
    }
    if (this.under > GOV.under && this.nUnder >= GOV.frames) {
      const up = player.lod > this.startLevel(player) ? player : fleet.filter((b) => b.lod > this.startLevel(b)).sort((a, b) => dist(a) - dist(b))[0];
      if (up && sailsFlown(up)) return this.switch(up, up.lod - 1, player);
    }
    return null;
  }
  switch(b, lod, player) {
    const down = lod > b.lod;
    this.log.push(`${b.id ?? '?'}:${b.lod}>${lod}`); if (this.log.length > 20) this.log.shift();
    this.setLevel(b, lod); this.after();
    if (b === player && down && this.toast) this.toast(b);
    return b;
  }
  // after a switch: a new cloth's first steps (its matrix factorised) are no measure of what it costs
  after() { this.hold = Math.max(this.hold, GOV.after); this.holdN = Math.max(this.holdN, GOV.afterFrames); }
}
