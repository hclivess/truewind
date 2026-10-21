// Map downloads in progress, for the loading bars (the chart overlay and the "Anywhere on Earth" panel). Every fetch
// of map data goes through trackedFetch: it reads the reply as it streams in, counting the bytes against its
// Content-Length, and hands back an ordinary Response built from them. A reply without a length (Overpass's, which
// spends most of its time thinking before it sends anything) counts as a file of unknown size: the bar then shows
// that work is going on rather than a percentage it cannot know.
const tasks = new Set(), subs = new Set();
let queued = false;
function notify() {
  if (queued || !subs.size) return;
  queued = true;
  setTimeout(() => { queued = false; for (const f of subs) f(); }, 50);
}
export function onProgress(fn) { subs.add(fn); fn(); return () => subs.delete(fn); }
// forget the finished downloads: a new load starts its bar from empty (those still running stay on it)
export function resetProgress() { for (const T of tasks) if (T.done) tasks.delete(T); notify(); }

// { n, done, frac 0..1, bytes, unknown (a running download of unknown size), items }. With `expect`, a list of the
// files a loading screen is waiting for, by their labels: only those count, each once (its latest download since the
// screen began, after `since`), one not yet started counts as waiting. The total is then fixed from the start: counted
// as they began, the files of a custom place grew from 4 to 7 under the player's eyes as each query was set off, and
// the menu's own scenery and the streets streaming in behind it were counted with them.
export function progressState(expect = null, since = 0) {
  let n = 0, done = 0, f = 0, bytes = 0, unknown = false;
  const items = [];
  const add = (T, label) => {
    n++;
    if (!T) { items.push({ label, loaded: 0, total: 0, done: false, failed: false, note: '', waiting: true }); return; }
    bytes += T.loaded;
    if (T.done) { done++; f += 1; }
    // (a compressed reply's length is the compressed size and the bytes counted are the unpacked ones: short of 1
    // until it is in. Of unknown size it creeps toward nine tenths with what has come)
    else if (T.total) f += Math.min(0.95, T.loaded / T.total);
    else { unknown = true; f += 0.9 * (1 - Math.exp(-T.loaded / 4e5)); }
    items.push({ label: T.label, loaded: T.loaded, total: T.total, done: T.done, failed: !!T.failed, note: T.note || '' });
  };
  if (expect) for (const label of expect) { let last = null; for (const T of tasks) if (T.label === label && T.id > since) last = T; add(last, label); }
  else for (const T of tasks) add(T, T.label);
  return { n, done, frac: n ? f / n : 0, bytes, unknown, items };
}
let seq = 0;
export const progressMark = () => seq;

// a download that may take several requests (js/overpass.js: its retries round the mirrors), counted as one file
export function newTask(label) { const T = { id: ++seq, label, loaded: 0, total: 0, done: false, note: '', touch: notify }; tasks.add(T); notify(); return T; }
export function endTask(T, failed) { T.done = true; T.failed = !!failed; T.note = ''; notify(); }

// label: the file's name on the bar, or a task from newTask (whose end is then the caller's to say)
export async function trackedFetch(url, opts, label = 'Map data') {
  const own = typeof label !== 'object', T = own ? newTask(label) : label;
  T.loaded = 0; T.total = 0;
  try {
    const r = await fetch(url, opts);
    T.total = +(r.headers.get('content-length') || 0);
    if (!r.ok || !r.body || !r.body.getReader) { if (own) endTask(T, !r.ok); return r; }
    const rd = r.body.getReader(), parts = [];
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); T.loaded += value.length; notify();
    }
    const buf = new Uint8Array(T.loaded);
    let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    if (own) endTask(T, false); else notify();
    return new Response(buf, { status: r.status, statusText: r.statusText, headers: r.headers });
  } catch (e) { if (own) endTask(T, true); else { T.loaded = 0; notify(); } throw e; }
}

const mb = (b) => b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`;
// draws the progress of the files `expect` (labels; all downloads if none) into a bar (an element holding an <i>, its
// width the fraction) and a line of text under it
export function bindProgress(bar, line, expect = null) {
  const fill = bar.querySelector('i'), since = seq;
  return onProgress(() => {
    const s = progressState(expect, since);
    fill.style.width = `${Math.round(s.frac * 100)}%`;
    bar.classList.toggle('busy', s.unknown);
    if (!line) return;
    const now = s.items.filter((t) => !t.done && !t.waiting).map((t) => (t.loaded ? `${t.label} ${mb(t.loaded)}${t.total ? ' of ' + mb(t.total) : ''}` : `${t.label}…`) + (t.note ? ` (${t.note})` : ''));
    line.textContent = s.n ? `${s.done} of ${s.n} files · ${mb(s.bytes)}${now.length ? ' · ' + now.join(' · ') : ''}` : '';
  });
}
