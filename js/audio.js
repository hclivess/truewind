// Procedural sound: wind in the rig, water along the hull, flogging sails, boom slams, start horn.
// Smoothness matters more than detail: seamless noise loops, slow parameter glides at a fixed
// update rate, and flog sound shaped by a smooth LFO instead of hard gating.
export class Audio {
  constructor() { this.ctx = null; this.on = true; this.acc = 0; }

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
    const fl = chain(nC, 1.2, 'bandpass', 700, 0.8);
    this.flog = fl;
    const mod = ctx.createGain(); mod.gain.value = 0.55;
    fl.g.disconnect(); fl.g.connect(mod); mod.connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth); lfoDepth.connect(mod.gain); lfo.start();
    this.lfo = lfo;
  }

  // called every frame; parameters glide at 10 Hz with long time constants
  update(b, dt) {
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
    glide(this.flog.g.gain, on * flog * Math.min(1, aws / 7) * 0.8, 0.25);
    glide(this.lfo.frequency, 4 + aws * 0.45, 1.0);
    if (b.slam > 1.2 && on) { this.thump(Math.min(1, b.slam / 3)); b.slam = 0; }
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
}
