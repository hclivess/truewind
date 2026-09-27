// Procedural sound: wind in the rig, water along the hull, flogging sails, boom slams, start horn, rain, thunder.
// Smoothness matters more than detail: seamless noise loops, slow parameter glides at a fixed
// update rate, and flog sound shaped by a smooth LFO instead of hard gating.
// the rain's voices for a rain rate r (0..1, the squall model's at the listener): silent when dry; the patter
// comes in first, the drumming and the roar only as it gets heavy; heavier rain has bigger drops, so the hiss
// on the water falls in pitch as it grows louder
export function rainLevels(r, o = {}) {
  r = Math.max(0, Math.min(1, r || 0));
  const hv = Math.max(0, Math.min(1, (r - 0.3) / 0.55));
  o.hiss = 0.2 * Math.pow(r, 0.7); o.hissF = 4200 - 1800 * hv; o.wash = 0.16 * r;
  o.pat = 0.45 * Math.min(1, 3 * r) * (1 - 0.4 * hv); o.drum = 0.5 * hv * hv * (3 - 2 * hv); o.roar = 0.22 * hv * hv;
  return o;
}
export class Audio {
  constructor() {
    this.ctx = null; this.on = true; this.acc = 0;
    // the renderer fires 'truewind:thunder' when a strike's sound reaches the camera (render.js _lightning)
    if (typeof window !== 'undefined') window.addEventListener('truewind:thunder', (e) => this.thunder(e.detail));
  }

  // pink-ish noise with the loop seam crossfaded, so there is no click every loop
  _noise(ctx, seconds, seed) {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds), fade = Math.floor(sr * 0.6);
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
    for (let i = 0; i < raw.length; i++) {
      const w = rnd();
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      raw[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i];
    for (let i = 0; i < fade; i++) { // equal-power crossfade of the tail into the head
      const t = i / fade;
      d[i] = raw[i] * Math.sin(t * Math.PI / 2) + raw[len + i] * Math.cos(t * Math.PI / 2);
    }
    return buf;
  }

  // rain as drops: a seamless loop of single drop impacts at a fixed density. Each is a damped ring (a drop
  // on the deck or taut sailcloth rings at 1.5-5 kHz for a few ms) with a click on the front; a heavy loop adds
  // the low thuds of big drops drumming on the cabin top and the sails. Seeded: the same loop every start.
  _drops(ctx, seconds, seed, perSec, heavy) {
    const sr = ctx.sampleRate, len = Math.floor(sr * seconds), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let s = seed >>> 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const n = Math.round(perSec * seconds);
    for (let k = 0; k < n; k++) {
      const i0 = Math.floor(rnd() * len), a = Math.exp(-2.2 * rnd()) * (0.35 + 0.65 * rnd());   // a few loud drops, many faint
      const low = heavy && rnd() < 0.3;
      const f = low ? 140 + 300 * rnd() : 1500 + 3500 * rnd() * rnd(), tau = (low ? 0.012 + 0.02 * rnd() : 0.0015 + 0.005 * rnd()) * sr;
      const w = 2 * Math.PI * f / sr, m = Math.min(Math.floor(tau * 6), len);
      for (let j = 0; j < m; j++) {
        const e = Math.exp(-j / tau), click = j < 12 ? (rnd() * 2 - 1) * (1 - j / 12) * 0.6 : 0;
        d[(i0 + j) % len] += a * (e * Math.sin(w * j) + click) * (low ? 0.9 : 0.5);   // (wraps: the loop has no seam)
      }
    }
    let mx = 0; for (let i = 0; i < len; i++) mx = Math.max(mx, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] *= 0.9 / mx;
    return buf;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'playback' });
    const src = (buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
    const nA = this._noise(ctx, 7.3, 1), nB = this._noise(ctx, 5.1, 7), nC = this._noise(ctx, 6.7, 13);
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp); comp.connect(ctx.destination);
    const chain = (buf, rate, type, f, q) => {
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src(buf, rate).connect(flt); flt.connect(g); g.connect(this.master);
      return { flt, g };
    };
    this.wind = chain(nA, 1, 'bandpass', 400, 0.6);
    this.whistle = chain(nB, 1, 'bandpass', 1200, 9);
    this.water = chain(nC, 1, 'lowpass', 900, 0.5);
    this.hiss = chain(nB, 1.3, 'highpass', 2500, 0.3);
    // flogging: band-limited noise amplitude-modulated by a smooth LFO (sine), no gating clicks
    const fl = chain(nC, 1.0, 'lowpass', 380, 0.5);
    this.flog = fl;
    const mod = ctx.createGain(); mod.gain.value = 0.55;
    fl.g.disconnect(); fl.g.connect(mod); mod.connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.25;
    lfo.connect(lfoDepth); lfoDepth.connect(mod.gain); lfo.start();
    this.lfo = lfo;
    // rain (level from the squall's rain at the listener, update()): hiss of drops on the water, a wash of the
    // whole downpour, the patter of single drops on deck and sails, and in heavy rain a drumming roar
    this.rainHiss = chain(nB, 1.6, 'highpass', 4200, 0.5);
    this.rainWash = chain(nA, 1.25, 'bandpass', 1300, 0.45);
    this.rainRoar = chain(nC, 0.8, 'lowpass', 450, 0.5);
    this.rainPat = chain(this._drops(ctx, 5.3, 41, 45, false), 1, 'highpass', 300, 0.5);
    this.rainDrum = chain(this._drops(ctx, 3.7, 77, 260, true), 1, 'highpass', 70, 0.5);
  }

  // called every frame; parameters glide at 10 Hz with long time constants. rain: the rain rate at the
  // listener, 0..1 (the squall model's, as the rain drawn around the camera)
  update(b, dt, rain = 0) {
    if (!this.ctx || !b) return;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const t = this.ctx.currentTime, d = b.diag;
    const aws = d.aws || 0, v = Math.abs(b.u);
    const on = this.on ? 1 : 0;
    const glide = (param, value, tc = 0.4) => param.setTargetAtTime(value, t, tc);
    glide(this.wind.flt.frequency, 280 + aws * 38);
    glide(this.wind.g.gain, on * Math.min(0.8, aws * aws / 280), 0.6);
    glide(this.whistle.flt.frequency, 900 + aws * 55, 0.8);
    glide(this.whistle.g.gain, on * Math.max(0, (aws - 9) / 45) * 0.6, 0.8);
    glide(this.water.flt.frequency, 350 + v * 110, 0.5);
    glide(this.water.g.gain, on * Math.min(0.7, v * v / 45 + (b.aground > 0 ? 0.25 : 0)), 0.5);
    glide(this.hiss.g.gain, on * Math.min(0.25, Math.max(0, v - 3) ** 2 / 200), 0.5);
    let flog = 0;
    for (const k in d.strips) for (const s of d.strips[k]) flog = Math.max(flog, (s.flog || 0) * (d.strips[k].areaF ?? 1));
    const heavy = Math.max(0, flog - 0.35) / 0.65;          // only a properly flogging sail is heard
    glide(this.flog.g.gain, on * heavy * heavy * Math.min(1, aws / 9) * 0.12, 0.6);
    glide(this.lfo.frequency, 4 + aws * 0.45, 1.0);
    // rain (rainLevels)
    const rl = rainLevels(on * rain, this._rl || (this._rl = {}));
    glide(this.rainHiss.g.gain, rl.hiss, 0.8); glide(this.rainHiss.flt.frequency, rl.hissF, 0.8);
    glide(this.rainWash.g.gain, rl.wash, 0.8); glide(this.rainPat.g.gain, rl.pat, 0.8);
    glide(this.rainDrum.g.gain, rl.drum, 0.8); glide(this.rainRoar.g.gain, rl.roar, 1.0);
    if (b.slam > 1.2 && on) { this.thump(Math.min(1, b.slam / 3)); b.slam = 0; }
  }

  // Thunder, played the moment its sound arrives (the delay, distance / 343 m/s, is kept by the caller in sim
  // time). A near strike: a sharp crack, then the rumble; a far one only a low rumble, because the air
  // absorbs the highs with distance. It rolls on while sound from farther parts of the channel keeps
  // arriving ((far - near) / 343 s), in irregular peals. Level falls with distance (spherical spreading,
  // softened: the compressor and the sim's scale). pan (-1 left .. +1 right) and front (+1 ahead .. -1 behind):
  // the strike's bearing from the camera. The crack comes from the channel itself; the rumble less so the
  // farther it is (echoes off the cloud base and the sea), and a strike behind sounds a little duller.
  thunder({ d = 3000, spread = 2000, seed = 1, cg = true, pan = 0, front = 1 } = {}) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.01, sr = ctx.sampleRate;
    if (!this._white) {
      const len = sr * 4, buf = ctx.createBuffer(1, len, sr), dd = buf.getChannelData(0);
      let s = 2463534242; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; dd[i] = s / 2147483648 - 1; }
      this._white = buf;
    }
    let s = (seed >>> 0) || 1; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const loud = Math.min(1, 650 / (d + 250)), dur = Math.min(16, 2.2 + spread / 343 + d / 4000);
    const noise = (off, len, loop) => { const n = ctx.createBufferSource(); n.buffer = this._white; n.loop = loop; n.start(t0, off); n.stop(t0 + len); return n; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const out = (p) => {
      if (!ctx.createStereoPanner) return this.master;
      const n = ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); n.connect(this.master);
      return n;
    };
    const shade = 1 + 0.35 * Math.min(0, front);
    // crack: within a couple of kilometres, the leader and return strokes tearing the air
    const near = cg ? Math.max(0, 1 - d / 2200) : 0;
    if (near > 0) {
      const g = ctx.createGain(), hp = filt('highpass', 500), lp = filt('lowpass', (2500 + 9000 * near) * shade);
      g.gain.setValueAtTime(0.0001, t0);
      let tc = t0;
      for (let k = 0, n = 2 + Math.floor(rnd() * 3); k < n; k++) {      // a ripping sequence of snaps
        const a = near * loud * (k ? 0.35 + 0.4 * rnd() : 1.1);
        g.gain.setValueAtTime(0.0001, tc); g.gain.exponentialRampToValueAtTime(a, tc + 0.004); g.gain.exponentialRampToValueAtTime(a * 0.08, tc + 0.065);
        tc += 0.07 + 0.09 * rnd();
      }
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.25);
      noise(rnd() * 3, tc - t0 + 0.3, false).connect(hp); hp.connect(lp); lp.connect(g); g.connect(out(0.9 * pan));
    }
    // rumble: noise through two low-passes whose cutoff falls with distance, under an envelope of peals
    const fc = (90 + 2600 * Math.exp(-d / 1300)) * shade;
    const l1 = filt('lowpass', fc), l2 = filt('lowpass', fc * 1.4), g = ctx.createGain();
    const N = Math.ceil(dur * 60), env = new Float32Array(N);
    const peals = 3 + Math.floor(rnd() * 5 + spread / 1500);
    for (let k = 0; k < peals; k++) {
      const tp = k === 0 ? (near > 0 ? 0.05 : 0) : rnd() * dur * 0.65, a = (k === 0 ? 1 : 0.35 + 0.65 * rnd()) * (1 - 0.5 * tp / dur);
      const ta = (near > 0 && k === 0 ? 0.03 : 0.12) + rnd() * 0.35 * Math.min(1, d / 3000), td = 0.5 + rnd() * 2.2;
      for (let i = 0; i < N; i++) {
        const x = i / 60 - tp; if (x < 0) continue;
        env[i] += a * (x < ta ? x / ta : Math.exp(-(x - ta) / td));
      }
    }
    let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, env[i]);
    for (let i = 0; i < N; i++) env[i] = Math.max(0.0001, env[i] / mx * loud * (0.55 + 0.35 * (1 - near))) * Math.min(1, (N - 1 - i) / 20);
    env[0] = 0.0001; env[N - 1] = 0;
    g.gain.setValueCurveAtTime(env, t0, dur);
    const rp = pan * (0.3 + 0.55 * Math.exp(-d / 6000));
    noise(rnd() * 3, dur + 0.05, true).connect(l1); l1.connect(l2); l2.connect(g); g.connect(out(rp));
    this.lastThunder = { d, dur, fc, at: t0, pan: rp };
  }

  thump(a) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55 * a, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }
  horn(long = false) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = long ? 1.4 : 0.5;
    for (const f of [311, 466]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.05); g.gain.setValueAtTime(0.16, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.12);
      o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.2);
    }
  }
  beep() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  }
  // winch ratchet click
  click() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 2400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.04);
  }

  // Engines: a synthesised four-stroke for each running engine (the three nearest the camera). The firing frequency
  // rpm / 60 x cylinders / 2 through a pulse-rich periodic wave (a diesel's brighter), a slightly detuned copy for the
  // cycle-to-cycle unevenness, a combustion bark (noise gated at the firing rate) that grows with load, all through a
  // low-pass that opens with rpm and load; a starter whine chopped by the compression strokes while it cranks.
  // Panned and attenuated from the camera.
  engines(boats, cam, dt) {
    if (!this.ctx || !cam) return;
    this._eAcc = (this._eAcc || 0) + dt; if (this._eAcc < 0.05) return; this._eAcc = 0;
    const ctx = this.ctx, t = ctx.currentTime, V = this._eng || (this._eng = new Map());
    const cp = cam.position, m = cam.matrixWorld.elements, rx = m[0], rz = m[2];
    const dist = (b) => Math.hypot(b.x - cp.x, b.z - cp.z);
    const live = boats.filter((b) => b.engine && (b.engine.active || b.engine.rpm > 60)).sort((a, c) => dist(a) - dist(c)).slice(0, 3);
    for (const [b, v] of V) if (!live.includes(b)) { v.out.gain.setTargetAtTime(0, t, 0.08); if (!v.end) { v.end = t + 0.5; for (const o of v.oscs) o.stop(t + 0.6); } }
    for (const [b, v] of V) if (v.end && t > v.end) V.delete(b);
    for (const b of live) {
      let v = V.get(b);
      if (!v || v.end) { if (v) V.delete(b); v = this._engineVoice(b.engine.spec); V.set(b, v); }
      const e = b.engine, S = e.spec, on = this.on ? 1 : 0;
      const f = Math.max(1, e.rpm / 60 * (S.cyl || 1) / 2), load = e.rack, x = e.rpm / S.rpmMax;
      const d = dist(b), att = 1 / (1 + (d / 6) ** 1.3);
      v.o1.frequency.setTargetAtTime(f, t, 0.03); v.o2.frequency.setTargetAtTime(f * 1.007, t, 0.03); v.am.frequency.setTargetAtTime(f, t, 0.03);
      v.lp.frequency.setTargetAtTime(300 + 45 * f + 1600 * load + (S.fuel === 'diesel' ? 900 : 0), t, 0.05);
      v.bark.gain.setTargetAtTime((0.08 + 0.5 * load) * (S.fuel === 'diesel' ? 1.3 : 1), t, 0.05);
      v.tone.gain.setTargetAtTime(e.running ? 0.35 + 0.25 * x : 0.12, t, 0.05);
      const crank = e.starting && (e.down > 0.98 || !S.tilts) ? 1 : 0;
      v.st.gain.setTargetAtTime(crank * 0.06, t, 0.03);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, ((b.x - cp.x) * rx + (b.z - cp.z) * rz) / Math.max(1, d))) * 0.85, t, 0.05);
      const level = e.active ? (0.22 + 0.45 * load) * (0.45 + 0.55 * Math.min(1, x)) : 0;
      v.out.gain.setTargetAtTime(on * att * Math.max(level, crank * 0.25), t, 0.06);
    }
  }
  _engineVoice(S) {
    const ctx = this.ctx, t = ctx.currentTime, N = 40, diesel = S.fuel === 'diesel';
    // a firing pulse: every harmonic of the firing frequency, falling off slower for the diesel's hard combustion
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = Math.pow(n, diesel ? -0.55 : -0.8) * (1 + 0.35 * Math.sin(n * 1.7));
    const wave = ctx.createPeriodicWave(re, im);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.setPeriodicWave(wave); o2.setPeriodicWave(wave);
    const tone = ctx.createGain(); tone.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.45; o1.connect(tone); o2.connect(g2); g2.connect(tone);
    // bark: band-passed noise amplitude-modulated at the firing rate
    if (!this._eNoise) this._eNoise = this._noise(ctx, 3.1, 29);
    const ns = ctx.createBufferSource(); ns.buffer = this._eNoise; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = diesel ? 2200 : 1300; bp.Q.value = 0.8;
    const gate = ctx.createGain(); gate.gain.value = 0.5;
    const am = ctx.createOscillator(); am.frequency.value = 10; const amD = ctx.createGain(); amD.gain.value = 0.5; am.connect(amD); amD.connect(gate.gain);
    const bark = ctx.createGain(); bark.gain.value = 0;
    ns.connect(bp); bp.connect(gate); gate.connect(bark);
    // starter: a whine chopped by the compression strokes
    const so = ctx.createOscillator(); so.type = 'sawtooth'; so.frequency.value = diesel ? 780 : 420;
    const sAm = ctx.createOscillator(); sAm.frequency.value = diesel ? 4.5 : 6; const sAmD = ctx.createGain(); sAmD.gain.value = 0.5;
    const sg = ctx.createGain(); sg.gain.value = 0.5; sAm.connect(sAmD); sAmD.connect(sg.gain);
    const st = ctx.createGain(); st.gain.value = 0; so.connect(sg); sg.connect(st);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 0.7;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (!pan.pan) pan.pan = { setTargetAtTime() {} };
    const out = ctx.createGain(); out.gain.value = 0;
    tone.connect(lp); bark.connect(lp); st.connect(lp); lp.connect(pan); pan.connect(out); out.connect(this.master);
    const oscs = [o1, o2, am, so, sAm, ns];
    for (const o of oscs) o.start(t);
    return { o1, o2, am, tone, bark, st, lp, pan, out, oscs, end: 0 };
  }
}
