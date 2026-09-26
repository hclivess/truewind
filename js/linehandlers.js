// Line handlers: the hardware that holds each line, and what it does under load. No three.js here (the
// physics runs it in node); the 3D models are in js/linegear.js, the ropes' colours are at the end.
//
// ---- Schema: a class lists what holds each of its lines (CLASSES[id].lines; missing keys are filled in by
// defaultLines(C) from the class, so a new class works with none)
//   lines: {
//     <line>: { handler, n, size, at, winch, max, rope },
//     ...
//   }
//   <line>   control key: main, jib (working headsail sheet), lazy (the other one), stay, trav, vang, cunn,
//            outhaul, backstay, jibHalyard, tackLine; gen = the gennaker sheet (the 'jib' control drives it
//            while the gennaker flies)
//   handler  a key of HANDLERS
//   n        purchase between the load and the handler (tackle parts x cascade), default 1
//   size     cam / clam size: 'micro' (Harken 468, 890 N) | 'std' (Harken 150, 1330 N) | 'big', default 'std'
//   at       where the hardware sits (the renderer's hint): 'car' 'sole' 'deck' 'coaming' 'cabin' 'mast' 'boom'
//            'winch' 'quarter'
//   winch    'cabin' = led through its clutch to the cabin-top (or mast-foot) winch, which can take it
//   max      load at the part at full setting, N (controls; default from the class's sheetPower)
//   hold     a ratchet block's holding ratio when it is not the handler's (Ratchamatic 2x grip: 20)
//   rope     key of ROPES for its colour (default: the line key)
// and ropeStyle: 'modern' (default: coloured braid) | 'classic' (cream polyester, the colour as a tracer).
//
// ---- The model. b.locks[k] is the crew's intent (cleated or not: the panel, the deck and the auto crew set
// it); b.lh[k] is what the hardware is doing: 'locked', 'locking' (being made fast: the hand holds it for
// lockT s), 'releasing' (being cast off: still held for releaseT s) or 'free'. The load at the handler is the
// line's load / purchase, / the capstan friction of the turns on a winch drum, and a ratchet block takes all
// but 1/hold of what is above its engaging load. Closed, a handler holds up to its slip load; above it the
// line slips (runs out until the load falls). Free, it 'dump's (runs out fast), 'ease's (surges round a drum
// or horn under control) or is held in the 'hand' (runs only while the load beats the hand). A one-way
// handler lets the line be hauled in while it is closed; anything else has to be cast off first.

export const HAND = 200;          // N a crew member holds on a line in one hand, sustained
const MU = 0.12;                  // rope on an alloy drum / cleat horn
export const capstan = (wraps) => Math.exp(MU * 2 * Math.PI * wraps);

export const CAM_SLIP = { micro: 890, std: 1330, big: 2200 };      // Harken 468 / 150 / 280 max working loads
export const HANDLERS = {
  // cam cleat (Harken Cam-Matic / Ronstan C-Cleat): the line is pulled down into two sprung toothed cams; lifting
  // it up and out of the jaws releases it at once
  cam: { name: 'Cam cleat', icon: 'cam', slip: 'cam', lockT: 0.2, releaseT: 0.25, release: 'dump', oneWay: true, op: 'pull it down into the jaws / lift it up and out' },
  // clam cleat (Clamcleat): no moving parts, the grooved V grips harder the harder it is pulled; lifted out to release
  clam: { name: 'Clam cleat', icon: 'clam', slip: 'clam', lockT: 0.3, releaseT: 0.3, release: 'dump', oneWay: true, op: 'pull it down into the grooves / lift it out' },
  // V-jammer: a turn round the base and the line wedged into a toothed V; yanked up and out to release
  jam: { name: 'V-jammer', icon: 'jam', slip: 2600, lockT: 1.2, releaseT: 0.8, release: 'dump', oneWay: false, op: 'a turn and wedge it in the V / yank it out' },
  // horn cleat: a turn, figure-eights and a locking hitch; holds anything, takes time both ways, and the turns
  // surge off one at a time
  horn: { name: 'Horn cleat', icon: 'horn', slip: Infinity, lockT: 3.0, releaseT: 1.5, release: 'ease', oneWay: false, op: 'figure-eights and a locking hitch / throw off the hitch and surge the turns' },
  // rope clutch (Spinlock XAS, SWL 450-575 kg): lever down = closed; the line can still be pulled in through it;
  // opening it under load dumps the line (unless it is on a winch)
  clutch: { name: 'Rope clutch', icon: 'clutch', slip: 4400, lockT: 0.15, releaseT: 0.15, release: 'dump', oneWay: true, op: 'close the lever / open the lever' },
  // ratchet block alone (Harken 2135 Carbo ratchet, 10:1 holding above its engaging load): nothing to cleat, the
  // line is held in the hand, which only has to hold what the ratchet does not
  ratchet: { name: 'Ratchet block', icon: 'ratchet', slip: 'hand', hold: 10, engage: 90, lockT: 0.3, releaseT: 0.1, release: 'dump', oneWay: true, hand: true, op: 'hold it / let it go' },
  // ratchet block with a cam on its swivel base (Harken 2630 triple Ratchamatic / 150 cam; 144 swivel base):
  // cleated, the cam sees only what the ratchet leaves; out of the cam the sheet is played in the hand
  ratchetCam: { name: 'Ratchet + cam', icon: 'ratchetCam', slip: 'cam', hold: 10, engage: 90, lockT: 0.25, releaseT: 0.25, release: 'hand', oneWay: true, op: 'flick it down into the cam / flick it up and play it from the ratchet' },
  // cam-lock traveller car (Hobie SSI car): the traveller line cleats in a cam on the car
  carCam: { name: 'Cam on the car', icon: 'carCam', slip: 'cam', lockT: 0.2, releaseT: 0.25, release: 'dump', oneWay: true, op: 'pull it down into the cam on the car / lift it out' },
  // push-button traveller car: a sprung plunger drops into holes in the track; push the button to move the car,
  // it stops only at a hole
  pinStop: { name: 'Push-button car', icon: 'pinStop', slip: Infinity, lockT: 0.4, releaseT: 0.3, release: 'dump', oneWay: false, holes: 11, op: 'let the plunger drop into a hole / push the button' },
  // self-tailing winch: three turns on the drum and the jaws on top hold it; out of the jaws it is eased by hand
  // round the drum (letting it fly throws the turns off)
  selfTailer: { name: 'Self-tailing winch', icon: 'selfTailer', slip: Infinity, wraps: 3, lockT: 0.3, releaseT: 0.5, release: 'ease', oneWay: true, winch: true, op: 'flick it into the jaws / pull it out and ease round the drum' },
  // winch + cam cleat beside it (J/70: Harken B8 / SnubbAir with cam cleats): two turns on the drum, then the cam
  winchCam: { name: 'Winch + cam', icon: 'winchCam', slip: 'cam', wraps: 2, lockT: 0.3, releaseT: 0.3, release: 'ease', oneWay: true, winch: true, op: 'drop it into the cam / lift it out and ease round the drum' },
  // plain winch + horn cleat (traditional): the tail is held by hand round the drum until it is made fast
  winchHorn: { name: 'Winch + horn cleat', icon: 'winchHorn', slip: Infinity, wraps: 3, lockT: 3.0, releaseT: 1.5, release: 'ease', oneWay: false, winch: true, op: 'figure-eights on the horn / cast off and ease round the drum' },
};
// lines that are held by something, and which way each runs when it gets away
export const LOCKABLE = ['main', 'jib', 'lazy', 'stay', 'trav', 'vang', 'cunn', 'outhaul', 'backstay', 'jibHalyard', 'tackLine'];
export const RUNS_UP = new Set(['main', 'jib', 'lazy', 'stay', 'trav', 'tackLine']);
const SHEETS = new Set(['main', 'jib', 'lazy', 'stay']);

// what holds each line on a class without its own list (so any new class works): cams and a mainsheet
// block with a cam, self-tailers where there are winches, clutches on a cabin top, a ratchet for a gennaker
export function defaultLines(C) {
  const W = !C.noWinches;
  return {
    main: { handler: C.noWinches ? 'ratchetCam' : 'cam', n: 4, at: 'car' },
    jib: { handler: W ? 'selfTailer' : 'cam', n: W ? 1 : 2, at: W ? 'winch' : 'deck' },
    stay: { handler: 'cam', n: 2, at: 'cabin' },
    gen: { handler: 'ratchet', n: 1, at: 'quarter' },
    trav: { handler: 'cam', n: 2, at: 'deck' },
    vang: { handler: 'cam', n: 8, at: 'deck', size: 'micro' },
    cunn: { handler: 'cam', n: 4, at: 'deck', size: 'micro' },
    outhaul: { handler: 'cam', n: 4, at: 'boom', size: 'micro' },
    backstay: { handler: 'cam', n: 8, at: 'deck' },
    jibHalyard: { handler: C.cabin || C.id === 'sportboat' ? 'clutch' : 'cam', n: 4, at: C.cabin || C.id === 'sportboat' ? 'cabin' : 'mast' },
    tackLine: { handler: 'cam', n: 1, at: 'cabin' },
  };
}
// the class's own list over the defaults (cached on the class)
export function lineSpecs(C) {
  if (C._lines) return C._lines;
  const d = defaultLines(C), own = C.lines || {}, out = {};
  for (const k of new Set([...Object.keys(d), ...Object.keys(own)])) out[k] = { ...d[k], ...own[k] };
  out.lazy = { ...out.jib, ...own.lazy };
  for (const k in out) if (!HANDLERS[out[k].handler]) out[k].handler = 'cam';
  Object.defineProperty(C, '_lines', { value: out, enumerable: false, configurable: true });
  return out;
}
// the spec of line k as it is now (the jib control is the gennaker sheet while the gennaker flies)
export function specOf(b, k) {
  const L = lineSpecs(b.cls);
  if ((k === 'jib' || k === 'lazy') && b.genDeploy > 0.5 && L.gen) return L.gen;
  return L[k] || L.main;
}
export function handlerOf(b, k) { return HANDLERS[specOf(b, k).handler]; }
// the load that makes a closed handler slip, N at the handler
export function slipLoad(H, spec) {
  return H.slip === 'cam' ? CAM_SLIP[spec.size || 'std'] : H.slip === 'clam' ? (spec.size === 'micro' ? 450 : 900) : H.slip === 'hand' ? HAND : H.slip;
}

// the load on line k where it is made fast to the boat (N), before any purchase
export function lineLoad(b, k) {
  const r = b.diag.rig, c = b.ctrl, C = b.cls, sp = C.sheetPower || 800, spec = specOf(b, k);
  const max = spec.max, v = c[k] || 0;
  switch (k) {
    case 'main': case 'jib': case 'stay': return r[k + 'Load'] || 0;
    case 'lazy': return r.lazyLoad || 0;
    case 'trav': return 0.35 * (r.mainLoad || 0);                     // the boom's pull across the track
    case 'backstay': return r.backstayLoad || 0;
    case 'vang': return (max ?? 4 * sp) * v ** 1.5;
    case 'cunn': return (max ?? 2.5 * sp) * v ** 1.5;
    case 'outhaul': return (max ?? 1.2 * sp) * v ** 1.5 + 0.1 * (r.mainLoad || 0);
    case 'jibHalyard': return (max ?? 3 * sp) * v + 0.6 * (r.jibLoad || 0);
    case 'tackLine': return b.genDeploy > 0.3 ? 0.5 * (r.jibLoad || 0) : 0;
  }
  return 0;
}
// the load the handler (or the hand, for a ratchet) actually holds, N: the load over the purchase, less the
// capstan friction of the turns on a winch drum, less what a ratchet block takes above its engaging load
export function tailLoad(b, k, H = handlerOf(b, k), spec = specOf(b, k), ratchetOn = true) {
  let T = lineLoad(b, k) / (spec.n || 1);
  if (H.wraps) T /= capstan(H.wraps);
  const hold = spec.hold || H.hold;
  if (hold && ratchetOn && T > H.engage) T = H.engage + (T - H.engage) / hold;
  return T;
}
// does the ratchet click on (the sheave locks one way above its engaging load)?
export function ratchetEngaged(b, k) { const H = handlerOf(b, k); return !!H.hold && lineLoad(b, k) / (specOf(b, k).n || 1) > H.engage; }

export function initLines(b) {
  b.locks = {}; b.held = {}; b.lh = {};
  for (const k of LOCKABLE) { b.locks[k] = true; b.lh[k] = { s: 'locked', t: 0, slip: 0, fly: false, auto: false, T: 0, ev: 0 }; }
}
// the working and lazy jib sheets swap roles when the clew crosses: so do their handlers' states
export function swapJib(b) {
  if (b.locks) [b.locks.jib, b.locks.lazy] = [b.locks.lazy, b.locks.jib];
  if (b.lh) [b.lh.jib, b.lh.lazy] = [b.lh.lazy, b.lh.jib];
}
const slipRate = (x) => Math.min(1.6, 0.12 + 0.9 * (x - 1));             // control units / s while overloaded

// one physics step for every line: the handler's timing, slips under overload, free lines running
export function stepLines(b, dt) {
  const C = b.cls, ctrl = b.ctrl, sp = C.sheetPower || 800;
  if (!b.lh) initLines(b);
  for (const k of LOCKABLE) {
    if (ctrl[k] === undefined) continue;
    const st = b.lh[k], spec = specOf(b, k), H = HANDLERS[spec.handler], want = b.locks[k] !== false;
    // the crew's intent, carried out at the handler's speed
    if (want) {
      st.fly = false;
      if (st.s !== 'locked') {
        if (st.s !== 'locking') { st.s = 'locking'; st.t = 0; }
        st.t += dt;
        if (st.t >= H.lockT) { st.s = 'locked'; st.t = 0; if (H.holes) ctrl[k] = Math.round(ctrl[k] * (H.holes - 1)) / (H.holes - 1); }
      }
    } else if (st.s !== 'free') {
      if (st.s !== 'releasing') { st.s = 'releasing'; st.t = 0; }
      st.t += dt;
      if (st.t >= H.releaseT) { st.s = 'free'; st.t = 0; }
    }
    const T = tailLoad(b, k, H, spec); st.T = T;
    st.slip = 0;
    // a line the player is working is in the hand; let go, it is made fast again if it was taken off to work it
    if (b.held[k] > 0) {
      b.held[k] -= dt;
      if (b.held[k] <= 0 && st.auto) { b.locks[k] = true; st.auto = false; }
      continue;
    }
    let rate = 0;
    if (st.s === 'locked' || st.s === 'releasing') {
      const cap = slipLoad(H, spec);
      if (T > cap) { rate = slipRate(T / cap); st.slip = 1; }
    } else if (st.s === 'locking') {
      if (T > HAND) rate = slipRate(T / HAND);                         // held in the hand while it is made fast
    } else {
      const mode = st.fly ? 'dump' : H.release;
      const ld = SHEETS.has(k) || k === 'trav' ? lineLoad(b, k) / sp : lineLoad(b, k) / (6 * sp) + 0.1 * (ctrl[k] > 0.02);
      if (ld < 0.01) continue;
      if (mode === 'dump') rate = Math.min(2.5, 0.25 + 1.6 * ld);
      else if (mode === 'ease') rate = Math.min(0.35, 0.04 + 0.25 * ld);          // surging round the drum / horn
      else if (T > HAND) rate = slipRate(T / HAND);                                 // in the hand: runs if it beats it
    }
    if (rate <= 0) continue;
    rate *= dt;
    if (RUNS_UP.has(k)) ctrl[k] = Math.min(1, ctrl[k] + rate); else ctrl[k] = Math.max(0, ctrl[k] - rate);
    if (SHEETS.has(k) && b.lines) b.lines[k] = Math.max(b.lines[k], Math.min(ctrl[k], b.lines[k] + rate * 1.5));
    if (st.slip) st.ev += dt;                                           // seconds of slipping (the game toasts it)
  }
}

// The player works line k (hauls it in when trimming, else eases it). Returns the part of the movement that
// happens now: hauling seats a one-way handler (cam, clam, clutch, self-tailer, ratchet) and goes on; easing,
// or hauling a line on a two-way handler (horn, V-jammer, push-button car), first casts it off (0 until it is
// free), and it is made fast again once the player lets go.
export function work(b, k, trimming) {
  if (!b.locks || !(k in b.locks)) return 1;
  if (!b.lh) initLines(b);
  const H = handlerOf(b, k), st = b.lh[k];
  b.held[k] = 0.3;
  if (H.hand) { b.locks[k] = true; return 1; }                         // in the hand: nothing to open
  if (trimming && H.oneWay) { b.locks[k] = true; return 1; }
  if (b.locks[k] !== false) { b.locks[k] = false; st.auto = true; }
  return st.s === 'free' ? 1 : 0;
}
// throw the turns off: the line runs free whatever holds it
export function letFly(b, k) { if (!b.lh) initLines(b); b.locks[k] = false; b.lh[k].fly = true; b.lh[k].auto = false; }

// what the panel shows for line k: text, a state class and a tooltip
export function lineStatus(b, k) {
  const spec = specOf(b, k), H = HANDLERS[spec.handler], st = (b.lh && b.lh[k]) || { s: 'locked', T: 0 };
  const cap = slipLoad(H, spec), T = st.T || 0, pc = (x) => Math.round(clamp01(x) * 100);
  let txt, cls;
  if (st.slip) { txt = 'SLIP'; cls = 'slip'; }
  else if (st.s === 'locking') { txt = `${H.lockT > 1 ? 'MAKE' : 'SET'} ${pc(st.t / H.lockT)}%`; cls = 'busy'; }
  else if (st.s === 'releasing') { txt = `OFF ${pc(st.t / H.releaseT)}%`; cls = 'busy'; }
  else if (st.s === 'free') { txt = st.fly ? 'FLY' : H.hand ? 'LET GO' : H.release === 'ease' ? 'EASE' : H.release === 'hand' ? 'HAND' : 'FREE'; cls = 'free'; }
  else { txt = H.hand ? 'HAND' : H.holes ? 'PIN' : 'LOCK'; cls = T > 0.7 * cap ? 'warn' : 'ok'; }
  const hold = cap === Infinity ? 'holds anything' : `${H.hand ? 'hand holds' : 'slips at'} ${Math.round(cap)} N`;
  const tip = `${H.name}${spec.n > 1 ? ` · ${spec.n}:1` : ''}${H.hold ? ` · ratchet ${spec.hold || H.hold}:1${ratchetEngaged(b, k) ? ' (on)' : ''}` : ''} · ${hold} · ${Math.round(T)} N on it — ${H.op}`;
  return { txt, cls, tip, icon: H.icon, handler: spec.handler };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------------------------------------
// Rope colours: every line its own, as boats are rigged (so a line can be found on deck by its colour).
// base: the rope; fleck: the coloured carriers; pattern: 'fleck' (a few carriers of the second colour: short
// helical flecks), 'tracer' (one pair of carriers: a single helix stripe), 'solid'.
export const ROPES = {
  main: { base: '#1d2f5e', fleck: '#f2f2ee', pattern: 'fleck', name: 'navy / white fleck' },
  jib: { base: '#c8282e', fleck: '#f4f1ea', pattern: 'fleck', name: 'red / white fleck' },
  lazy: { base: '#c8282e', fleck: '#f4f1ea', pattern: 'fleck', name: 'red / white fleck' },
  genP: { base: '#d8342a', fleck: '#2a2a2a', pattern: 'fleck', name: 'red (port)' },
  genS: { base: '#1e8f43', fleck: '#2a2a2a', pattern: 'fleck', name: 'green (starboard)' },
  gen: { base: '#d8342a', fleck: '#1e8f43', pattern: 'fleck', name: 'red port / green starboard' },
  stay: { base: '#1f8f9e', fleck: '#f4f1ea', pattern: 'fleck', name: 'teal / white fleck' },
  halMain: { base: '#f1f0ea', fleck: '#2456b8', pattern: 'tracer', name: 'white / blue tracer' },
  jibHalyard: { base: '#f1f0ea', fleck: '#cc2a2a', pattern: 'tracer', name: 'white / red tracer' },
  halGen: { base: '#f1f0ea', fleck: '#1e8f43', pattern: 'tracer', name: 'white / green tracer' },
  vang: { base: '#1b1c1f', fleck: '#8a9098', pattern: 'fleck', name: 'black' },
  cunn: { base: '#f0c419', fleck: '#1e8f43', pattern: 'fleck', name: 'yellow / green fleck' },
  outhaul: { base: '#3c9a3a', fleck: '#f4f1ea', pattern: 'fleck', name: 'green / white fleck' },
  backstay: { base: '#f07a1a', fleck: '#1b1c1f', pattern: 'fleck', name: 'orange / black fleck' },
  trav: { base: '#2b72d4', fleck: '#f4f1ea', pattern: 'fleck', name: 'blue / white fleck' },
  tackLine: { base: '#8a3fb8', fleck: '#f4f1ea', pattern: 'fleck', name: 'purple / white fleck' },
  reef1: { base: '#e0402e', fleck: '#f0c419', pattern: 'fleck', name: 'red (1st reef)' },
  reef2: { base: '#2b72d4', fleck: '#f0c419', pattern: 'fleck', name: 'blue (2nd reef)' },
};
const CLASSIC_BASE = '#e6dcbf';
// a line's look on class C: classic boats have cream polyester with the colour as a tracer (halyards stay white)
export function ropeLook(C, key) {
  const r = ROPES[key] || ROPES.main;
  if (C && C.ropeStyle === 'classic') {
    const col = r.pattern === 'tracer' ? r.fleck : r.base;
    return { base: r.pattern === 'tracer' ? '#efe9d8' : CLASSIC_BASE, fleck: col, pattern: 'tracer', name: `cream / ${r.name.split(' ')[0]} tracer`, swatch: col };
  }
  return { ...r, swatch: r.pattern === 'tracer' ? r.fleck : r.base };
}
// the rope colour key of line k on class C
export function ropeKey(C, k) { const s = lineSpecs(C)[k]; return (s && s.rope) || k; }
