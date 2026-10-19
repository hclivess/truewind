// The validation register: a test states each quantity it checks with its expected value, tolerance and source,
// and the value it measured; check() judges it, prints it, and save() writes test/out/validation/<test>.json, which
// tools/validation-doc.mjs collects (with the catalogue of the older tests, docs/validation-catalog.json) into
// docs/VALIDATION.md.
//
//   const V = new Register('micro-waves');
//   V.check({ quantity: 'deep-water phase speed', expected: 'g/w', tol: '1%', source: 'Airy (linear) wave theory',
//             measured: c, ok: Math.abs(c / c0 - 1) < 0.01, show: `${c.toFixed(3)} m/s vs ${c0.toFixed(3)}` });
//   ...; V.save(); process.exit(V.failed ? 1 : 0);
// ok: true / false; or status: 'pass' | 'warn' | 'fail' | 'info' directly.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../out/validation/', import.meta.url));

export class Register {
  constructor(test, opts = {}) { this.test = test; this.rows = []; this.quiet = !!opts.quiet; this.t0 = Date.now(); }
  check(r) {
    const status = r.status ?? (r.ok ? 'pass' : r.warn ? 'warn' : 'fail');
    const row = { test: this.test + '.mjs', section: r.section ?? '', quantity: r.quantity, expected: String(r.expected ?? ''), tol: String(r.tol ?? ''), source: r.source ?? 'est.', measured: r.show ?? (typeof r.measured === 'number' ? +r.measured.toPrecision(4) : String(r.measured ?? '')), status };
    this.rows.push(row);
    if (!this.quiet) console.log(`  ${status === 'pass' ? 'ok  ' : status.toUpperCase().padEnd(4)} ${row.section ? row.section + ': ' : ''}${row.quantity}: ${row.measured} (expected ${row.expected}${row.tol ? ' ±' + row.tol : ''})`);
    return status === 'pass' || status === 'info';
  }
  get failed() { return this.rows.filter((r) => r.status === 'fail').length; }
  save(extra = {}) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}${this.test}.json`, JSON.stringify({ test: this.test + '.mjs', generated: new Date().toISOString(), secs: (Date.now() - this.t0) / 1000, rows: this.rows, ...extra }, null, 1));
    const n = (s) => this.rows.filter((r) => r.status === s).length;
    console.log(`${this.test}: ${n('pass')} pass, ${n('warn')} warn, ${n('fail')} fail`);
  }
}
