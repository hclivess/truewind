// Boat names and sail numbers: what the menu accepts (RRS Appendix G numbers), and the fleet's identities.
import { validateSailNo, cleanSailNo, validateBoatName, cleanBoatName, fleetIdentities } from '../js/boatid.js';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const sn = (v) => validateSailNo(v);
for (const [v, want] of [['GBR 1234', 'GBR 1234'], ['gbr1234', 'GBR 1234'], ['7', '7'], ['USA 30', 'USA 30'], ['123456', '123456'], ['', ''], ['  aus 9 ', 'AUS 9']])
  check(sn(v).ok && sn(v).value === want, `sail number "${v}" -> "${sn(v).value}"`);
for (const v of ['XYZ 12', 'GBR', 'GB 12', '012', 'GBR 1 2', 'ABCD', '12 GBR'])
  check(!sn(v).ok, `sail number "${v}" refused: ${sn(v).msg}`);
check(cleanSailNo('g-b.r 1!2') === 'GBR 12', 'typing strips punctuation and upper-cases');
check(cleanSailNo('USA 1234567') === 'USA 1234', 'at most 8 characters');
const bn = (v) => validateBoatName(v);
for (const [v, want] of [['Sea Breeze', 'Sea Breeze'], ["Jester's Pride", "Jester's Pride"], ['Élan', 'Élan'], ['Blue-Moon II', 'Blue-Moon II'], ['  Wind   Dancer ', 'Wind Dancer'], ['海風', '海風'], ['', '']])
  check(bn(v).ok && bn(v).value === want, `boat name "${v}" -> "${bn(v).value}"`);
for (const v of ['!!!', '123', '-Dash', '<script>'])
  check(!bn(cleanBoatName(v)).ok || cleanBoatName(v) !== v, `boat name "${v}" refused or cleaned: "${cleanBoatName(v)}" ${bn(cleanBoatName(v)).msg}`);
check(cleanBoatName('x'.repeat(40)).length === 24, 'names at most 24 characters');
const f = fleetIdentities(42, 30, 'GBR'), g = fleetIdentities(42, 30, 'GBR');
check(JSON.stringify(f) === JSON.stringify(g), 'the fleet is the same from the same seed');
check(new Set(f.map(x => x.name)).size === 30 && new Set(f.map(x => x.number)).size === 30, 'a fleet of 30: every name and number different');
check(f.every(x => sn(x.number).ok && bn(x.name).ok), 'every fleet name and number passes the checks');
const big = fleetIdentities(1, 150);
check(new Set(big.map(x => x.name)).size === 150, 'even 150 boats get different names');
console.log(fails ? `${fails} FAILED` : 'all boat identity checks passed');
process.exit(fails ? 1 : 0);
