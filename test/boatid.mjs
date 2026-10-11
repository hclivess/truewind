// Boat names and sail numbers: what the menu accepts (RRS Appendix G numbers), and the fleet's identities.
import { validateSailNo, cleanSailNo, validateBoatName, cleanBoatName, fleetIdentities, classFleetIdentities, classTeam } from '../js/boatid.js';
import tp52 from '../js/classes/tp52.js';
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
// a class's own fleet: racing a TP52 lines you up against the 52 SUPER SERIES teams, as they are
const T = tp52.fleet.teams, tf = classFleetIdentities(tp52, 7, 10);
check(tf.length === 10 && tf.every((x) => x.team && T.includes(x.team) && x.name === x.team.name && x.number === x.team.number), `a TP52 fleet of 10: ten of the ${T.length} teams, with their own numbers (${tf.map((x) => x.name).join(', ')})`);
check(JSON.stringify(classFleetIdentities(tp52, 7, 10)) === JSON.stringify(tf), 'the same teams from the same seed');
check(new Set(tf.map((x) => x.name)).size === 10, 'no team twice');
const mine = classFleetIdentities(tp52, 7, T.length, '', 'Sled');
check(mine.length === T.length && !mine.some((x) => x.name === 'Sled') && mine.filter((x) => x.team).length === T.length - 1, 'sailing as Sled: the other teams, and one club boat to make up the number');
const big2 = classFleetIdentities(tp52, 3, 30, 'ESP');
check(big2.length === 30 && new Set(big2.map((x) => x.name)).size === 30 && new Set(big2.map((x) => x.number)).size === 30, 'a fleet bigger than the series: every team, then club boats, every name and number different');
check(T.every((t) => bn(t.name).ok && /^[A-Z]{3} \d{1,5}[A-Z]?$/.test(t.number) && Number.isFinite(t.hull) && t.bow), 'every team has a valid name, a sail number, a hull colour and a bow number');
check(classTeam(tp52, 'Platoon Aviation')?.number === 'GER 52' && classTeam(tp52, 'Sea Breeze') === null, 'a team found by name; any other name is the player\'s own');
check(classFleetIdentities({ id: 'x' }, 42, 5, 'GBR').every((x) => x.team === null), 'a class without a fleet gets the club names');
console.log(fails ? `${fails} FAILED` : 'all boat identity checks passed');
process.exit(fails ? 1 : 0);
