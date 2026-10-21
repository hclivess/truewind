// js/overpass.js against a fake server: retries through 429 / 504 / a 200 with a runtime-error remark, two queries at a time, no retry of a bad query. node test/overpass.mjs
const realST = globalThis.setTimeout; globalThis.setTimeout = (f, ms) => realST(f, Math.min(ms, 5));   // (the waits, fast)
let inflight = 0, maxIn = 0, calls = 0;
const script = [429, 429, 504, 'remark', 200];
globalThis.fetch = async (u, o) => {
  calls++; inflight++; maxIn = Math.max(maxIn, inflight);
  await new Promise(r => realST(r, 20)); inflight--;
  const step = script.shift() ?? 200;
  const body = step === 'remark' ? { elements: [], remark: 'runtime error: Query timed out' } : { elements: [{ id: 1 }] };
  return new Response(JSON.stringify(body), { status: step === 'remark' ? 200 : step, headers: step === 429 ? { 'retry-after': '3' } : {} });
};
const { overpass } = await import('../js/overpass.js');
const { progressState } = await import('../js/progress.js');
const j = await overpass('q', 'Coastline');
console.log('first query: ok', j.elements.length, 'after', calls, 'requests');
calls = 0; maxIn = 0;
const many = await Promise.all([1, 2, 3, 4, 5, 6].map(i => overpass('q' + i, 'Q' + i)));
console.log('six at once:', many.length, 'answered,', calls, 'requests, at most', maxIn, 'in flight');
globalThis.fetch = async () => new Response('bad', { status: 400 });
try { await overpass('bad', 'Bad'); } catch (e) { console.log('bad query:', e.message); }
const s = progressState(); console.log('progress:', s.done, 'of', s.n, 'done, failed:', s.items.filter(t => t.failed).map(t => t.label));
