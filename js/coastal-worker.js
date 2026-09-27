// Builds a venue's coastal wave field (coastal.js) off the main thread: { id, inp } in, { id, out } back.
import { buildCoastal, fieldTransfer } from './coastal.js';
self.onmessage = (e) => {
  const { id, inp } = e.data;
  try { const out = buildCoastal(inp); self.postMessage({ id, out }, fieldTransfer(out)); }
  catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
};
