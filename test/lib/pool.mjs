// A pool of worker processes (test/seatrial/worker.mjs) running jobs: runPool(jobs, { n, mod, fn, timeoutMin, onDone }).
// Resolves to [{ job, res }] in completion order; a job that times out or kills its worker gets { error }.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const WORKER = fileURLToPath(new URL('../seatrial/worker.mjs', import.meta.url));

export function runPool(jobs, { n = 4, mod, fn, timeoutMin = 60, onDone } = {}) {
  const out = []; let next = 0, live = 0;
  return new Promise((resolve) => {
    if (!jobs.length) return resolve(out);
    const spawn = () => {
      const w = fork(WORKER, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      live++;
      let cur = null, timer = null;
      const finish = (res) => { clearTimeout(timer); const r = { job: cur.job, res }; cur = null; out.push(r); if (onDone) onDone(r, out.length, jobs.length); };
      const give = () => {
        if (next >= jobs.length) { w.send('exit'); return; }
        cur = { id: next, job: jobs[next++], mod, fn };
        timer = setTimeout(() => { finish({ error: `timeout after ${timeoutMin} min` }); w.kill(); }, timeoutMin * 60e3);
        w.send(cur);
      };
      w.on('message', (m) => { if (m.ready) give(); else if (cur && m.id === cur.id) { finish(m.res); give(); } });
      w.on('exit', () => { live--; if (cur) finish({ error: 'worker died' }); if (next < jobs.length) spawn(); else if (live === 0) resolve(out); });
    };
    for (let i = 0; i < Math.min(n, jobs.length); i++) spawn();
  });
}
