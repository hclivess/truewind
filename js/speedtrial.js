// Speed trials as the World Sailing Speed Record Council times them: the average speed over a 500 m run and over a
// nautical mile, the distance between the course's transit lines over the time between crossing them (WSSRC rules:
// "the speed is the distance between the transits divided by the elapsed time"; https://www.sailspeedrecords.com).
// Here the course is wherever she runs: the track is sampled at 20 Hz, and the run is the last stretch whose straight
// distance from its start to now is the course length (a straight 500 m between two transit lines), timed from the
// sample where it began (interpolated to the exact distance). The best of each is kept.
export const TRIAL_RUNS = [{ key: 'm500', len: 500, label: '500 m' }, { key: 'nm', len: 1852, label: 'Nautical mile' }];

export class SpeedTrial {
  constructor() { this.reset(); }
  reset() {
    this.N = 20 * 300; this.t = new Float64Array(this.N); this.x = new Float64Array(this.N); this.z = new Float64Array(this.N);
    this.n = 0; this.head = 0; this.last = -1;
    this.cur = {}; this.best = {}; this.bestAt = {};
    for (const R of TRIAL_RUNS) { this.cur[R.key] = 0; this.best[R.key] = 0; }
  }
  // the sample i steps back from the newest
  _at(i) { const k = (this.head - 1 - i + this.N * 2) % this.N; return k; }
  update(b, t) {
    if (t - this.last < 0.05 - 1e-9) return;
    this.last = t;
    const k = this.head; this.t[k] = t; this.x[k] = b.x; this.z[k] = b.z;
    this.head = (k + 1) % this.N; this.n = Math.min(this.N, this.n + 1);
    for (const R of TRIAL_RUNS) {
      // back from now to the first sample the course length away (straight line, as between two transits)
      let prevD = 0, v = 0;
      for (let i = 1; i < this.n; i++) {
        const j = this._at(i), D = Math.hypot(b.x - this.x[j], b.z - this.z[j]);
        if (D >= R.len) {
          const jn = this._at(i - 1), f = (R.len - prevD) / Math.max(1e-6, D - prevD);
          const t0 = this.t[jn] + (this.t[j] - this.t[jn]) * f, dt = t - t0;
          if (dt > 0) v = R.len / dt;
          break;
        }
        prevD = D;
      }
      this.cur[R.key] = v;
      if (v > this.best[R.key]) { this.best[R.key] = v; this.bestAt[R.key] = t; }
    }
  }
}
