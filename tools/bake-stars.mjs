// Bakes the night sky's stars: every star of the Yale Bright Star Catalogue, 5th revised edition (Hoffleit & Warren
// 1991, CDS V/50) down to visual magnitude 6.0 (5080 stars), into data/sky/stars.bin for js/sky.js.
//
//   node tools/bake-stars.mjs [catalog.gz]      (no argument: downloads it from CDS)
//
// stars.bin, little-endian: 'TWST', uint32 version (1), uint32 count, then per star (brightest first)
//   uint16 RA  (J2000, 0..65536 = 0..360 deg, 20" steps)
//   int16  Dec (J2000, +-32767 = +-90 deg, 10" steps)
//   int16  V magnitude x 1000
//   int16  B-V colour index x 1000 (0 where the catalogue gives none)
// Byte columns of the catalogue (V/50 ReadMe): RA 76-83 (h m s.s), Dec 84-90 (sign d m s), Vmag 103-107, B-V 110-114.
// Fourteen entries (novae and clusters later removed from the catalogue) have no position and are skipped.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const URL_BSC = 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz';
const LIM = 6.0;
const src = process.argv[2];
const gz = src ? readFileSync(src) : Buffer.from(await (await fetch(URL_BSC)).arrayBuffer());
const lines = gunzipSync(gz).toString('latin1').split('\n');
const stars = [];
for (const l of lines) {
  if (l.length < 107 || !l.slice(75, 77).trim()) continue;
  const v = parseFloat(l.slice(102, 107));
  if (!(v <= LIM)) continue;
  const ra = (+l.slice(75, 77) + +l.slice(77, 79) / 60 + +l.slice(79, 83) / 3600) * 15;
  const dec = (l[83] === '-' ? -1 : 1) * (+l.slice(84, 86) + +l.slice(86, 88) / 60 + +l.slice(88, 90) / 3600);
  const bvs = l.slice(109, 114).trim(), bv = bvs ? parseFloat(bvs) : 0;
  stars.push({ hr: +l.slice(0, 4), ra, dec, v, bv: Number.isFinite(bv) ? bv : 0 });
}
stars.sort((a, b) => a.v - b.v);
const buf = Buffer.alloc(12 + stars.length * 8);
buf.write('TWST', 0, 'latin1'); buf.writeUInt32LE(1, 4); buf.writeUInt32LE(stars.length, 8);
stars.forEach((s, i) => {
  const o = 12 + i * 8;
  buf.writeUInt16LE(Math.round(s.ra / 360 * 65536) & 0xffff, o);
  buf.writeInt16LE(Math.round(s.dec / 90 * 32767), o + 2);
  buf.writeInt16LE(Math.round(s.v * 1000), o + 4);
  buf.writeInt16LE(Math.round(Math.max(-0.5, Math.min(3, s.bv)) * 1000), o + 6);
});
mkdirSync(new URL('../data/sky/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/sky/stars.bin', import.meta.url), buf);
const by = (hr) => stars.find(s => s.hr === hr);
console.log(`${stars.length} stars to V ${LIM} -> data/sky/stars.bin (${buf.length} bytes); brightest: HR ${stars[0].hr} V ${stars[0].v}`);
for (const [n, hr] of [['Sirius', 2491], ['Polaris', 424], ['Betelgeuse', 2061], ['sigma Oct', 7228]]) { const s = by(hr); console.log(`  ${n}: RA ${s.ra.toFixed(3)} Dec ${s.dec.toFixed(3)} V ${s.v} B-V ${s.bv}`); }
