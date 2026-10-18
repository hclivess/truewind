// A sea-trial worker process (forked by test/seatrial.mjs): runs the jobs it is sent, one at a time, and sends back
// each result. Kept alive between jobs so the venues and baked polars load once.
import { runTrial } from './trial.mjs';
process.on('message', async (m) => {
  if (m === 'exit') process.exit(0);
  let res;
  try { res = await runTrial(m.job); }
  catch (e) { res = { cls: m.job.cls, cond: m.job.cond.id, mode: m.job.mode, error: String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') }; }
  process.send({ id: m.id, res });
});
process.send({ ready: true });
