// Procedural sound: wind in the rig, water along the hull, flogging sails, boom slams, start horn.
export class Audio {
  constructor() { this.ctx = null; this.on = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { // pink-ish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
    const src = (rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // wind
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    src(1).connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // whistle in the rigging
    this.whF = ctx.createBiquadFilter(); this.whF.type = 'bandpass'; this.whF.Q.value = 18;
    this.whG = ctx.createGain(); this.whG.gain.value = 0;
    src(1.3).connect(this.whF); this.whF.connect(this.whG); this.whG.connect(this.master);
    // water
    this.watF = ctx.createBiquadFilter(); this.watF.type = 'highpass'; this.watF.frequency.value = 600;
    this.watG = ctx.createGain(); this.watG.gain.value = 0;
    src(0.7).connect(this.watF); this.watF.connect(this.watG); this.watG.connect(this.master);
    // flogging: noise gated by a fast LFO
    this.flF = ctx.createBiquadFilter(); this.flF.type = 'lowpass'; this.flF.frequency.value = 900;
    this.flG = ctx.createGain(); this.flG.gain.value = 0;
    this.flMod = ctx.createGain(); this.flMod.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 7;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG); lfoG.connect(this.flMod.gain); lfo.start();
    this.lfo = lfo;
    src(1.1).connect(this.flF); this.flF.connect(this.flMod); this.flMod.connect(this.flG); this.flG.connect(this.master);
  }
  update(b, dt) {
    if (!this.ctx || !b) return;
    const t = this.ctx.currentTime, d = b.diag;
    const aws = d.aws || 0, v = Math.abs(b.u);
    const on = this.on ? 1 : 0;
    this.windF.frequency.setTargetAtTime(250 + aws * 45, t, 0.2);
    this.windG.gain.setTargetAtTime(on * Math.min(0.9, aws * aws / 250), t, 0.2);
    this.whF.frequency.setTargetAtTime(900 + aws * 60, t, 0.3);
    this.whG.gain.setTargetAtTime(on * Math.max(0, (aws - 8) / 40), t, 0.3);
    this.watF.frequency.setTargetAtTime(400 + v * 90, t, 0.2);
    this.watG.gain.setTargetAtTime(on * Math.min(0.8, v * v / 60 + (b.aground > 0 ? 0.3 : 0)), t, 0.2);
    let flog = 0;
    for (const k in d.strips) for (const s of d.strips[k]) flog = Math.max(flog, (s.flog || 0) * (d.strips[k].areaF ?? 1));
    this.flG.gain.setTargetAtTime(on * flog * Math.min(1, aws / 8) * 0.9, t, 0.08);
    this.lfo.frequency.setTargetAtTime(5 + aws * 0.6, t, 0.2);
    if (b.slam > 1.2 && on) { this.thump(Math.min(1, b.slam / 3)); b.slam = 0; }
  }
  thump(a) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0.6 * a, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.4);
  }
  horn(long = false) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = long ? 1.4 : 0.5;
    for (const f of [311, 466]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.04); g.gain.setValueAtTime(0.18, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
      o.connect(lp); lp.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.2);
    }
  }
  beep() {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2);
  }
}
