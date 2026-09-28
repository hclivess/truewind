// Every browser module parses as an ES module. `node --check js/x.js` parses a .js file as a classic script,
// which can accept code a module rejects (a missing brace once passed as a call plus a block and broke the whole
// page in the browser while every node test still ran): each file is copied to .mjs and checked as a module.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } };
walk('js');
const tmp = mkdtempSync(join(tmpdir(), 'tw-syntax-'));
let fails = 0;
for (const f of files) {
  const m = join(tmp, 'x.mjs');
  copyFileSync(f, m);
  try { execFileSync(process.execPath, ['--check', m], { stdio: 'pipe' }); }
  catch (e) { fails++; console.log(`FAIL ${f}: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
}
rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : `all ${files.length} modules parse`);
process.exit(fails ? 1 : 0);
