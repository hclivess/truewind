// Judging one sea trial's metrics (test/seatrial/trial.mjs runTrial) against the reference ranges (refs.mjs).
// Returns [{ k: metric, s: 'pass'|'warn'|'fail'|'info', v: 'the numbers', why }]. The ranges and their sources are in
// refs.mjs; what each metric measures is in trial.mjs.
import { R, knownAt, KNOWN } from './refs.mjs';

const f1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(1));
const f2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : x.toFixed(2));
const pct = (x) => (x === null || !Number.isFinite(x) ? '-' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`);
const worse = (a, b) => (['pass', 'info', 'warn', 'fail'].indexOf(a) >= ['pass', 'info', 'warn', 'fail'].indexOf(b) ? a : b);

// small, light boats (dinghies, skiffs, beach cats): capsizable, little directional inertia
const light = (r) => r.canCapsize || r.loa < 6.2 && r.multihull;

export function judge(r, cond) {
  const C = [];
  const add = (k, s, v, why = '') => C.push({ k, s, v, why });
  const flatSteady = !cond.sea && !cond.gusty, rough = cond.sea || cond.gusty;
  const legs = r.legs;
  if (r.error) { add('run', 'fail', r.error); return C; }
  if (r.nan) add('nan', 'fail', `NaN at t ${f1(r.nan.t)} s on ${r.nan.leg}`);
  const probe = r.mode === 'probe';

  // ---------------------------------------------------------------- structure and incidents (every mode)
  const sf = r.struct.maxR > 0 ? 1 / r.struct.maxR : Infinity, sfs = r.struct.sailR > 0 ? 1 / r.struct.sailR : Infinity;
  add('rigSF', sf >= R.sf.pass ? 'pass' : sf >= R.sf.warn ? 'warn' : 'fail', `${f2(sf)} (${r.struct.worstPart} on ${r.struct.worstLeg ?? '-'})`, 'peak rig load / strength, expect >= 2');
  add('sailSF', sfs >= R.sf.pass ? 'pass' : sfs >= R.sf.warn ? 'warn' : 'fail', `${f2(sfs)} (${r.struct.sailWorst ?? '-'} on ${r.struct.sailLeg ?? '-'})`, 'cloth load / strength');
  const bad = r.events.filter((e) => ['dismast', 'tear', 'blown', 'boom', 'holed', 'keel', 'rudder', 'sunk'].includes(e.type));
  if (r.rigDown) add('dismast', 'fail', `${r.rigWhy} (${(bad.find((e) => e.type === 'dismast') || {}).leg ?? ''})`);
  if (r.boomBroken) add('boom', 'fail', 'boom broken');
  for (const s of r.sailTorn) add('sailTear', 'fail', `${s.k} ${s.blown ? 'blown out' : 'torn ' + Math.round(s.tear * 100) + '%'}`);
  if (r.capsized) {
    const c = r.events.find((e) => e.type === 'capsize');
    const s = !r.canCapsize ? 'fail' : cond.tws >= 18 ? 'warn' : 'fail';
    add('capsize', s, `${c ? c.msg + ' on ' + c.leg : 'capsized'}`, r.canCapsize ? 'a dinghy/cat may capsize from 18-25 kn' : 'a keelboat must not');
  }
  add('maxHeel', r.capsized ? 'info' : r.maxHeel > r.targetHeel + 35 ? 'warn' : 'pass', `${f1(r.maxHeel)} deg`, 'a knockdown past target + 35');
  if (r.aground > 0) add('aground', 'warn', `${f1(r.aground)} s`);
  const unpl = r.events.filter((e) => e.type.startsWith('unplanned'));
  if (unpl.length) add('unplanned', 'warn', unpl.map((e) => `${e.type.slice(10)} on ${e.leg} @${e.t}s`).slice(0, 3).join(', '), 'crossed the wind unbidden (broach / round-up / crash gybe)');
  // smoothness
  for (const k of ['mainLoad', 'jibLoad', 'rig']) {
    const S = r.smooth[k]; if (!S || !(S.meanLoad > 0)) continue;
    // judged on the steady legs only: in a tack or a gybe a sheet goes slack and is loaded again as the sail fills (a
    // real snatch, many times its own 1 s mean), and eased right off to heave to the sail flogs; those are reported
    // (info). (A trial run before the per-leg record: its one peak, judged only when it fell on a steady leg)
    const MAN = new Set(['tack1', 'tack2', 'gybe', 'heave']);
    let sp, at;
    if (S.byLeg) { sp = 0; for (const [l, v] of Object.entries(S.byLeg)) if (!MAN.has(l) && v > sp) { sp = v; at = l; } }
    else if (!MAN.has(S.spikeLeg)) { sp = S.spike; at = S.spikeLeg; }
    if (sp !== undefined) add(`spike:${k}`, sp > R.spike.fail ? 'fail' : sp > R.spike.warn ? 'warn' : 'pass', `${f1(sp)}x 1 s mean${sp > R.spike.warn ? ' on ' + (at ?? '') : ''} (steady legs)`);
    if (S.spike > R.spike.warn && (sp === undefined || S.spike > sp)) add(`spikeManoeuvre:${k}`, 'info', `${f1(S.spike)}x 1 s mean @${S.spikeT}s ${S.spikeLeg ?? ''}`);
    if (k !== 'rig') add(`chatter:${k}`, S.extremaPerS > R.chatter.fail ? 'fail' : S.extremaPerS > R.chatter.warn ? 'warn' : 'pass', `${f1(S.extremaPerS)}/s`);
  }

  // ---------------------------------------------------------------- the directional-stability probe
  if (probe) {
    const P = legs.fixed && legs.fixed.probe;
    if (P) {
      const a10 = Math.abs(P.d10), a30 = Math.abs(P.d30);
      let s = a10 < R.probe.d10pass && a30 < R.probe.d30pass ? 'pass' : a10 < R.probe.d10warn ? 'warn' : 'fail';
      if (s === 'fail' && light(r)) s = 'warn';
      const dir = (x) => (Math.abs(x) < 2 ? 'holds' : x > 0 ? 'luffs' : 'bears away');
      add('fixedHelm', s, `${f1(P.d10)} deg in 10 s, ${f1(P.d30)} in 30 s (${dir(P.d30)}), max ${f1(P.maxRate)} deg/s, helm ${f2(P.helm)}`, '+ = luffing; diverging in seconds fails');
    }
    const st = legs.settle && legs.settle.st;
    if (st) add('settleRms', 'info', `${f1(st.herr.rms)} deg on the helm before fixing`);
    return C;
  }

  // ---------------------------------------------------------------- speed
  const beatLegs = ['beat1', 'tack1', 'tack2'].map((k) => legs[k] && legs[k].st).filter((s) => s && s.n > 20);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const vmg = mean(beatLegs.map((s) => s.vmg)), uUp = mean(beatLegs.map((s) => s.u)), twaUp = mean(beatLegs.map((s) => s.twa));
  const polUp = mean(beatLegs.map((s) => s.polar).filter((x) => x));
  const spd = (k, u, pol, extra = '') => {
    if (!(pol > 0) || !(u >= 0)) return;
    const q = u / pol;
    let s;
    if (flatSteady) s = Math.abs(q - 1) <= R.speedFlat.pass ? 'pass' : Math.abs(q - 1) <= R.speedFlat.warn ? 'warn' : 'fail';
    else s = q >= R.speedRough.pass[0] && q <= R.speedRough.pass[1] ? 'pass' : q >= R.speedRough.warn[0] && q <= R.speedRough.warn[1] ? 'warn' : 'fail';
    add(k, s, `${f2(u)} kn vs polar ${f2(pol)} (${pct(q - 1)})${extra}`);
  };
  // close-hauled: the first, steady beat; then each beat after a tack (does she get going again?)
  const b1 = legs.beat1 && legs.beat1.st;
  if (b1 && b1.n > 20) spd('upwindSpeed', b1.u, b1.polar, ` at ${f1(b1.twa)} deg`);
  for (const k of ['tack1', 'tack2']) { const s = legs[k] && legs[k].st; if (s && s.n > 20) spd(`beatAfter${k[0].toUpperCase()}${k.slice(1)}`, s.u, s.polar, ` at ${f1(s.twa)} deg, helm ${f1(s.helm.mean)}`); }
  if (vmg !== null) add('upwindVMG', 'info', `${f2(vmg)} kn (polar best ${f2(r.upVmg)} at ${f1(r.upTwa)} deg)`);
  for (const k of ['leave', 'beam', 'broad']) { const s = legs[k] && legs[k].st; if (s && s.n > 20) spd(`${k}Speed`, s.u, s.polar, ` at ${f1(s.twa)} deg${k === 'broad' && s.gen > 0.5 ? ' (kite)' : ''}`); }
  // against published data (flat steady only)
  if (flatSteady && cond.venue === 'open') {
    const K = knownAt(r.cls, cond.tws);
    const kchk = (k, v, ref, src) => { if (!(ref > 0) || !(v > 0)) return; const q = v / ref - 1; add(k, Math.abs(q) <= R.known.pass ? 'pass' : Math.abs(q) <= R.known.warn ? 'warn' : 'fail', `${f2(v)} vs ${f2(ref)} (${pct(q)}) ${src}`); };
    if (K) { kchk('knownVMG', vmg, K.vmg, K.src); const bm = legs.beam && legs.beam.st; kchk('known90', bm && bm.u, K.r90, K.src); }
    const B = KNOWN[r.cls] && KNOWN[r.cls].band;
    if (B && cond.tws >= B.tws[0] - 2 && cond.tws <= B.tws[1] + 1 && uUp) {
      const s = uUp >= B.upBsp[0] * 0.95 && uUp <= B.upBsp[1] * 1.05 ? 'pass' : uUp >= B.upBsp[0] * 0.85 ? 'warn' : 'fail';
      add('knownUpBsp', s, `${f2(uUp)} kn upwind vs ${B.upBsp[0]}-${B.upBsp[1]} (${KNOWN[r.cls].src})`);
    }
  }

  // ---------------------------------------------------------------- heel
  for (const k of ['leave', 'beat1', 'tack1', 'tack2', 'beam']) {
    const s = legs[k] && legs[k].st; if (!s || s.n < 20) continue;
    const st = s.over10 > R.heel.sustainS ? 'fail' : s.over5 > R.heel.warnS ? 'warn' : 'pass';
    if (k === 'beat1' || k === 'beam' || st !== 'pass') add(`heel:${k}`, st, `${f1(s.heel.mean)} mean, ${f1(s.heel.max)} max vs target ${f1(r.targetHeel)} (${f1(s.over10)} s over +10)`);
  }

  // ---------------------------------------------------------------- course keeping (beam reach)
  const bm = legs.beam && legs.beam.st;
  if (bm && bm.n > 50) {
    const lim = cond.sea ? R.course.seaBase + R.course.seaPerHs * r.Hs : R.course.flat * (cond.gusty ? 1.3 : 1);
    const rms = bm.herr.rms, o = bm.osc || {};
    add('courseRms', rms <= lim ? 'pass' : rms <= lim * R.course.warnF ? 'warn' : 'fail', `${f1(rms)} deg rms (limit ${f1(lim)}), mean ${f1(bm.herr.mean)}`);
    const zig = o.ac !== null && o.ac > R.zigzag.ac && o.amp > R.zigzag.amp;
    add('zigzag', zig ? (rough ? 'warn' : 'fail') : 'pass', `period ${f1(o.period)} s, amp ${f1(o.amp)} deg, autocorr ${f2(o.ac)}${o.acLag ? ' @' + f1(o.acLag) + ' s' : ''}`, 'a regular oscillation of the heading');
  }
  const br = legs.broad && legs.broad.st;
  if (br && br.n > 50) add('courseRmsBroad', 'info', `${f1(br.herr.rms)} deg rms, osc period ${f1(br.osc && br.osc.period)} s amp ${f1(br.osc && br.osc.amp)}`);

  // ---------------------------------------------------------------- helm balance
  // (on the first, steady beat: after a tack a boat still swinging back to her course carries whatever helm that takes)
  const helms = b1 && b1.n > 20 ? [b1.helm.mean] : [];
  if (helms.length) {
    const h = mean(helms);
    let s = h >= R.helm.pass[0] && h <= R.helm.pass[1] ? 'pass' : h >= R.helm.warn[0] && h <= R.helm.warn[1] ? 'warn' : 'fail';
    if (s === 'fail' && (cond.tws >= 25 || rough)) s = 'warn';
    add('weatherHelm', s, `${f1(h)} deg upwind`);
  }

  // ---------------------------------------------------------------- tacks and gybes
  for (const M of r.tacks) {
    const loss = M.uPre > 0.2 ? 1 - M.uMin / M.uPre : null;
    if (M.kind === 'tack') {
      const row = R.tack.time.find((x) => r.loa < x[0]);
      const irons = M.crossed === null || M.ironsT > R.tack.ironsS;
      let s;
      if (irons) s = cond.tws >= 6 && cond.tws <= 25 ? 'fail' : 'warn';
      else {
        const tOk = M.turnTime !== null && M.turnTime >= row[1] && M.turnTime <= row[2];
        const lim = light(r) ? R.tack.lossDinghy : R.tack.loss;
        s = tOk && loss <= lim ? 'pass' : (M.turnTime !== null && loss <= R.tack.lossWarn) ? 'warn' : 'fail';
      }
      add(`${M.leg}`, s, irons ? `IN IRONS (${M.crossed === null ? 'never crossed' : f1(M.ironsT) + ' s stopped'}${M.rescued ? ', rescued' : ''})` : `${f1(M.turnTime)} s, speed -${Math.round(loss * 100)}% (${f2(M.uPre / 0.514444)} -> ${f2(M.uMin / 0.514444)} kn), back to 90% in ${f1(M.recover)} s`);
    } else {
      const lim = R.gybe.time.find((x) => r.loa < x[0])[1];
      const done = M.turnTime !== null && M.turnTime <= lim;
      add('gybe', done ? 'pass' : 'fail', M.turnTime === null ? 'not completed' : `${f1(M.turnTime)} s, speed -${Math.round((loss ?? 0) * 100)}%`);
    }
  }

  // ---------------------------------------------------------------- motion (beam reach)
  if (bm && bm.n > 50) {
    if (cond.sea && r.Hs > 0.05) {
      const k = (r.loa < 8 ? R.motion.small : 1) * Math.sqrt(Math.max(1, r.Hs / 0.8));
      const lr = R.motion.roll * k, lp = R.motion.pitch * k;
      const s = (x, l) => (x <= l ? 'pass' : x <= l * R.motion.warnF ? 'warn' : 'fail');
      add('roll', s(bm.roll, lr), `${f1(bm.roll)} deg rms (limit ${f1(lr)}, Hs ${f1(r.Hs)} m)`);
      add('pitch', s(bm.pitch, lp), `${f1(bm.pitch)} deg rms (limit ${f1(lp)}), heave ${f2(bm.heave)} m rms`);
    } else {
      const lim = R.motion.flatRoll * (cond.gusty ? 1.5 : 1);
      add('roll', bm.roll <= lim ? 'pass' : bm.roll <= R.motion.flatRollWarn * (cond.gusty ? 1.5 : 1) ? 'warn' : 'fail', `${f1(bm.roll)} deg rms in flat water, pitch ${f1(bm.pitch)}`);
    }
  }

  // ---------------------------------------------------------------- heave to
  const hv = legs.heave && legs.heave.st;
  if (hv) {
    const u0 = legs.heave.st.uStart, u1 = hv.uEnd;
    const ok = u1 <= Math.max(R.heave.kn * 0.4, Math.min(R.heave.kn, R.heave.frac * Math.max(u0, 1)));
    add('heaveTo', ok ? 'pass' : u1 <= R.heave.kn * 1.5 ? 'warn' : 'fail', `${f2(u0)} -> ${f2(u1)} kn, heel ${f1(hv.heel.mean)}`);
  }
  // the reefs and the kite as sailed (information)
  add('sails', 'info', `reef ${r.reef0}${legs.beam && legs.beam.st ? '->' + f1(legs.beam.st.reef) : ''}${r.hasKite ? `, kite ${legs.broad && legs.broad.st && legs.broad.st.gen > 0.5 ? 'up' : 'down'}` : ''}`);
  return C;
}

export function overall(checks) { let s = 'pass'; for (const c of checks) if (c.s !== 'info') s = worse(s, c.s); return s; }
