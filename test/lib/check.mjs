// Quantitative checks with a reference: what is measured, what it should be, how close is close enough, and where the
// expected value comes from. Every check prints one line,
//   ok   <suite> | <quantity>: <measured> <unit>  (expected <expected> ± <tol> <unit>; <source>)
// and the suite's checks are written to test/out/checks/<suite>.json (quantity, expected, tol, unit, source, measured,
// pass) for the validation report (docs/VALIDATION.md) to collect.
//
//   const S = suite('physics-laws');
//   S.near({ quantity: 'AWS, beam reach', measured: 7.1, expected: 7.07, tol: 0.01, unit: 'm/s', source: 'vector sum' });
//   S.near({ ..., tol: 0.05, rel: true })      tol as a fraction of the expected value (printed as ±5%)
//   S.within({ quantity, measured, lo, hi, unit, source })   a range (either end may be omitted)
//   S.ok(cond, quantity, { measured, expected, source })      a yes/no property
//   S.done()                                    summary, the JSON, the exit code
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../out/checks/', import.meta.url));
const fmt = (v) => {
  if (typeof v !== 'number') return String(v);
  if (!isFinite(v)) return String(v);
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e6) ? v.toExponential(3) : +v.toPrecision(4) + '';
};

export function suite(name) {
  const S = { name, results: [], fails: 0 };
  const put = (r) => {
    S.results.push(r);
    if (!r.pass) S.fails++;
    const u = r.unit ? ' ' + r.unit : '';
    const exp = r.expect ?? (r.lo !== undefined || r.hi !== undefined
      ? `${r.lo !== undefined ? fmt(r.lo) : '-inf'} .. ${r.hi !== undefined ? fmt(r.hi) : '+inf'}${u}`
      : `${fmt(r.expected)} ± ${r.rel ? fmt(r.tol * 100) + '%' : fmt(r.tol) + u}`);
    console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${name} | ${r.quantity}: ${fmt(r.measured)}${u}  (expected ${exp}; ${r.source})`);
    return r.pass;
  };
  S.near = ({ quantity, measured, expected, tol, rel = false, unit = '', source = '' }) => {
    const err = Math.abs(measured - expected), lim = rel ? Math.abs(expected) * tol : tol;
    return put({ quantity, measured, expected, tol, rel, unit, source, pass: Number.isFinite(measured) && err <= lim });
  };
  S.within = ({ quantity, measured, lo, hi, unit = '', source = '' }) =>
    put({ quantity, measured, lo, hi, unit, source, pass: Number.isFinite(measured) && (lo === undefined || measured >= lo) && (hi === undefined || measured <= hi) });
  S.ok = (cond, quantity, { measured = cond ? 'yes' : 'no', expected = 'yes', source = '', unit = '' } = {}) =>
    put({ quantity, measured, expect: String(expected), unit, source, pass: !!cond });
  S.done = () => {
    const n = S.results.length;
    console.log(`${name}: ${n - S.fails}/${n} checks passed${S.fails ? `, ${S.fails} FAILED` : ''}`);
    try {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(OUT + name + '.json', JSON.stringify({ suite: name, generated: new Date().toISOString(), quick: !!+(process.env.QUICK || 0), checks: S.results }, null, 1));
    } catch (e) { /* (a read-only checkout: the console has it all) */ }
    process.exitCode = S.fails ? 1 : 0;
    return S.fails;
  };
  return S;
}
