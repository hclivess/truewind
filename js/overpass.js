// OpenStreetMap's Overpass servers, for a custom place: the coastline, the land, the seamarks, the harbours. They are
// public and busy, and they ration each client: about two queries at a time (more are refused with 429, "too many
// requests"), and a busy server answers 504 or not at all. A custom place asked for six or more at once and gave up
// after one try at each mirror, so a slow afternoon at the servers left a lake with no land round it. Here at most two
// run at a time and the rest wait their turn; each goes round the mirrors, and after a round that failed waits
// (5, 15, 40 s, or the Retry-After the server asks for) before the next. The progress line says so meanwhile.
import { trackedFetch, newTask, endTask } from './progress.js';

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const MAX_AT_ONCE = 2, WAITS = [5, 15, 40];
let running = 0;
const queue = [];
const slot = () => new Promise((go) => { if (running < MAX_AT_ONCE) { running++; go(); } else queue.push(go); });
const free = () => { const go = queue.shift(); if (go) go(); else running--; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -> the reply's JSON. A query the servers reject as malformed (400) is not asked again.
export async function overpass(q, label = 'OpenStreetMap', { timeout = 75000 } = {}) {
  const T = newTask(label);
  T.note = 'waiting for the server';
  await slot();
  T.note = '';
  let err = null;
  try {
    for (let round = 0; round <= WAITS.length; round++) {
      let retryAfter = 0;
      for (const u of OVERPASS) {
        try {
          const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined;
          const r = await trackedFetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, signal }, T);
          if (r.status === 400) { err = new Error('Overpass 400 (bad query)'); err.fatal = true; throw err; }
          if (!r.ok) { retryAfter = Math.max(retryAfter, +(r.headers.get('retry-after') || 0)); throw new Error('Overpass ' + r.status); }
          const j = await r.json();
          // (a server out of time or memory still answers 200, with what it managed and a remark saying so)
          if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error('Overpass: ' + j.remark.slice(0, 80));
          endTask(T, false);
          return j;
        } catch (e) { if (e.fatal) throw e; err = e; }
      }
      if (round < WAITS.length) {
        const s = Math.max(WAITS[round], Math.min(120, retryAfter));
        for (let k = s; k > 0; k--) { T.note = `server busy, retrying in ${k} s`; T.touch(); await sleep(1000); }
        T.note = `try ${round + 2} of ${WAITS.length + 1}`;
      }
    }
    throw err;
  } catch (e) { endTask(T, true); throw e; }
  finally { free(); }
}
