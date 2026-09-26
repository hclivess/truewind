// Boat identity: sail numbers and boat names, as the player types them and as the fleet is given them.
// A sail number follows the Racing Rules' Appendix G: an optional national sail letters code (World Sailing's
// three-letter codes, e.g. GBR, USA, AUS) and the number itself, digits only (G1.1), at most 8 characters
// here so it fits the sail. A class hull number alone (e.g. "7", "1234") is valid too. Names: letters of any
// alphabet, digits, spaces and the punctuation boat names use (' - . & !), 1-24 characters.
// Pure functions, no DOM; the fleet's names and numbers are seeded (online rooms and replays agree).
import { mulberry32 } from './env.js';

// World Sailing national sail letters (the member national authorities)
export const NATIONS = new Set(('ALG AND ANT ARG ARM ARU ASA AUS AUT AZE BAH BAR BEL BER BLR BRA BRN BUL CAN CAY CHI CHN CIV COK ' +
  'COL CRO CUB CYP CZE DEN DOM ECU EGY ESA ESP EST FIJ FIN FRA GBR GEO GER GRE GRN GUA GUM HKG HUN INA IND IRL ' +
  'IRI ISL ISR ISV ITA IVB JAM JPN KAZ KEN KOR KOS KUW LAT LBA LCA LIB LTU LUX MAC MAD MAR MAS MEX MKD MLT MNE ' +
  'MON MRI MYA NCA NED NOR NZL OMA PAK PAN PAR PER PHI PLE PNG POL POR PUR QAT ROU RSA RUS SAM SEN SEY SGP SLO ' +
  'SMR SRB SRI SUD SUI SVK SWE TAH TAN THA TPE TTO TUN TUR UAE UGA UKR URU USA VAN VEN VIE ZIM').split(' '));

// what the input field keeps while typing: upper case, letters/digits/one space, at most 8 characters
export function cleanSailNo(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, 8);
}
// { ok, value, msg }: empty means "automatic" (the class default)
export function validateSailNo(raw) {
  const v = cleanSailNo(raw).trim();
  if (!v) return { ok: true, value: '', msg: '' };
  const m = /^([A-Z]{3}) ?(\d{1,5})$/.exec(v) || /^()(\d{1,6})$/.exec(v);
  if (!m) return { ok: false, value: v, msg: 'Nationality letters then digits, e.g. GBR 1234, or just the number' };
  if (m[1] && !NATIONS.has(m[1])) return { ok: false, value: v, msg: `${m[1]} is not a World Sailing nation code` };
  if (/^0\d/.test(m[2])) return { ok: false, value: v, msg: 'A sail number does not start with 0' };
  return { ok: true, value: m[1] ? `${m[1]} ${m[2]}` : m[2], msg: '' };
}

const NAME_OK = /^[\p{L}\p{N}][\p{L}\p{N} '’.&!-]*$/u;
export function cleanBoatName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f<>{}\\"`]/g, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, 24);
}
export function validateBoatName(raw) {
  const v = cleanBoatName(raw).trim();
  if (!v) return { ok: true, value: '', msg: '' };
  if (!NAME_OK.test(v)) return { ok: false, value: v, msg: "Letters, digits, spaces and ' - . & ! only, starting with a letter or digit" };
  if (!/\p{L}/u.test(v)) return { ok: false, value: v, msg: 'A name needs at least one letter' };
  return { ok: true, value: v, msg: '' };
}

// the fleet: names in the manner of real club and offshore boats, never the same twice in one fleet
const NAMES = ['Tern', 'Petrel', 'Skua', 'Gannet', 'Fulmar', 'Shearwater', 'Kittiwake', 'Albatross', 'Puffin', 'Cormorant',
  'Sea Breeze', 'Wind Dancer', 'Aurora', 'Kestrel', 'Spindrift', 'Halcyon', 'Minx', 'Blue Jacket', 'Tinker', 'Whimbrel',
  'Jester', 'Moonshadow', 'Salty Dog', 'Serendipity', 'Freya', 'Zephyr', 'Mistral', 'Galatea', 'Blue Moon', 'Wanderer',
  'Dash', 'Nimbus', 'Rascal', 'Tenacious', 'Firefly', 'Kingfisher', 'Morning Star', 'Nautilus', 'Osprey', 'Quicksilver',
  'Red Admiral', 'Sirocco', 'Tempest', 'Valkyrie', 'Wild Goose', 'Xanadu', 'Yeoman', 'Arrow', 'Bonaventure', 'Calypso',
  'Dolphin', 'Eclipse', 'Fair Wind', 'Gypsy Moth', 'Harrier', 'Ibis', 'Jolly Roger', 'Kittyhawk', 'Lively Lady', 'Merlin',
  'Northern Light', 'Otter', 'Pelican', 'Quest', 'Rapid', 'Sea Otter', 'Tiger Moth', 'Unity', 'Vagabond', 'Water Rat',
  'Black Magic', 'Chance', 'Dragonfly', 'Emerald', 'Flying Fish', 'Grey Goose', 'Hot Toddy', 'Indigo', 'Jackdaw', 'Kiwi',
  'Longbow', 'Magpie', 'Nightjar', 'Olive', 'Peregrine', 'Raven', 'Sandpiper', 'Swift', 'Teal', 'Wren'];
// n unique { name, number } for a fleet, from the race seed; `nation` (e.g. the venue's) prefixes some numbers
export function fleetIdentities(seed, n, nation = '') {
  const rnd = mulberry32((seed | 0) * 7919 + 17), pool = NAMES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const used = new Set(), out = [];
  for (let i = 0; i < n; i++) {
    let name = pool[i % pool.length];
    if (i >= pool.length) name += ' ' + ['II', 'III', 'IV', 'V'][Math.floor(i / pool.length) - 1];
    let num;
    do { num = String(10 + Math.floor(rnd() * 1990)); } while (used.has(num));
    used.add(num);
    out.push({ name, number: nation && rnd() < 0.5 ? `${nation} ${num}` : num });
  }
  return out;
}
// the national letters a venue's boats mostly carry
export const VENUE_NATION = { solent: 'GBR', sfbay: 'USA', newport: 'USA', kiel: 'GER', sydney: 'AUS', auckland: 'NZL', marseille: 'FRA', garda: 'ITA', progreso: 'MEX', meredith: 'USA' };
