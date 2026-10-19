// A worker process (forked by test/seatrial.mjs and test/passages.mjs): runs the jobs it is sent, one at a time, and
// sends back each result. Kept alive between jobs so the venues and polars load once. A message names the module and
// its function (default: the sea trial's runTrial).
const mods = {};
process.on('message', async (m) => {
  if (m === 'exit') process.exit(0);
  let res;
  try {
    const mod = m.mod || './trial.mjs', fn = m.fn || 'runTrial';
    const M = mods[mod] || (mods[mod] = await import(new URL(mod, import.meta.url)));
    res = await M[fn](m.job);
  } catch (e) { res = { ...(m.job.cond ? { cls: m.job.cls, cond: m.job.cond.id, mode: m.job.mode } : { cls: m.job.cls }), error: String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') }; }
  process.send({ id: m.id, res });
});
process.send({ ready: true });
