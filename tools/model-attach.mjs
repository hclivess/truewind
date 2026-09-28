// Every part of every boat model attached: builds each class's model in headless Chromium (tools/model-attach.html:
// the hull, deck, cabin, fittings, spars, the running rigging's hardware and the engine, as the game builds them),
// joins the parts whose surfaces touch (within ~1 cm) and lists every part that is not joined, through others, to
// the hull and deck: a cleat in the air, a fitting off the cabin side, a chainplate short of the deck; and every part
// sunk out of sight inside the hull (its highest point below the deck or inside the topsides).
//   node tools/model-attach.mjs [class ...]           the check (exit 1 on a floating part)
//   node tools/model-attach.mjs --shots DIR [class ...]  also screenshots of each boat: 3/4, side, deck close-ups
// Needs Playwright (PLAYWRIGHT=/path/to/playwright/index.mjs) and a Chromium (CHROMIUM=/path/to/chrome).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const args = process.argv.slice(2);
const si = args.indexOf('--shots'), shots = si >= 0 ? args.splice(si, 2)[1] : null;
const classes = args;
// views for the screenshots: [name, yaw, pitch, dist (x LOA), target x (x LOA from the CG), target z]
const VIEWS = [['q34', 0.75, 0.28, 1.25, 0, 0.35], ['side', 1.5708, 0.05, 1.2, 0, 0.35], ['deckfwd', 0.5, 0.55, 0.45, 0.25, 0.1],
  ['deckaft', 2.5, 0.5, 0.45, -0.25, 0.1], ['mast', 1.1, 0.25, 0.25, 0.05, 0.6]];

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const port = await freePort();
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));
const b = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let floating = 0;
try {
  const p = await b.newPage({ viewport: { width: 960, height: 600 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${port}/tools/model-attach.html`, { timeout: 600000 });
  await p.waitForFunction(() => window.__ready || window.__done, null, { timeout: 600000 });
  const ids = classes.length ? classes : await p.evaluate(() => window.__classes);
  for (const id of ids) {
    const r = await p.evaluate((id) => { const r = window.__analyse(id); return { ...r, floating: r.floating.map(f => ({ ...f, gap: Number.isFinite(f.gap) ? f.gap : 9 })) }; }, id);
    const bad = r.floating.length + r.buried.length;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${id}: ${r.parts} parts, ${r.floating.length} floating, ${r.buried.length} buried (${r.ms} ms)`);
    for (const f of r.floating) console.log(`       gap ${f.gap >= 9 ? '> 12' : (f.gap * 100).toFixed(1)} cm at [${f.at}] (next to ${f.near}): ${f.parts.join(' | ')}`);
    for (const f of r.buried) console.log(`       buried at [${f.at}]: ${f.name}`);
    floating += bad;
  }
  if (errs.length) { console.log('page errors:\n' + errs.join('\n')); floating++; }
  if (shots) {
    mkdirSync(shots, { recursive: true });
    const loa = await p.evaluate(async (ids) => { const { CLASSES } = await import('/js/physics.js'); return Object.fromEntries(ids.map(id => [id, CLASSES[id].loa ?? (CLASSES[id].bowX - CLASSES[id].sternX)])); }, ids);
    for (const id of ids) for (const [v, yaw, pitch, dk, tx, tz] of VIEWS) {
      const L = loa[id], sp = await b.newPage({ viewport: { width: 960, height: 600 } });
      await sp.goto(`http://127.0.0.1:${port}/tools/model-attach.html?view=${id}&yaw=${yaw}&pitch=${pitch}&dist=${dk * L * 2}&tx=${tx * L}&tz=${tz * L}`, { timeout: 600000 });
      await sp.waitForFunction(() => window.__done, null, { timeout: 600000 });
      await sp.screenshot({ path: join(shots, `${id}-${v}.png`), timeout: 120000 });
      await sp.close();
    }
    console.log('screenshots in ' + shots);
  }
} finally { await b.close(); server.kill(); }
console.log(floating ? `${floating} floating or buried part groups` : 'every part attached');
process.exit(floating ? 1 : 0);
