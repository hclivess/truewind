// Tide gauges per venue: harmonic constants from NOAA CO-OPS (US stations, the official constants behind NOAA's
// predictions) or TICON-4 (Hart-Davis, Dettmering & Seitz 2025, CC BY 4.0: fifty constituents fitted to the GESLA-4
// sea-level records; SEANOE doi:10.17882/109129). Writes the `gauges` part of data/venues/<id>.tide.json:
//   { name, lat, lon, x, z, z0 (MSL above chart datum, m), cd ('MLLW' | 'LAT'), mhw (MHW above MSL), source, cons: [[name, H (m), G (deg)]] }
// Chart datum: MLLW for US stations (NOAA's datums), LAT elsewhere (the lowest level predicted over a nodal cycle,
// 2026-2044, which is what UKHO / AHO / LINZ charts use within a few cm).
// Usage: node tools/tide-gauges.mjs [venueId...]
import { VENUES, makeProjection } from '../js/world.js';
import { TideStation } from '../js/tide.js';
import { readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// role: 'level' = drives the water level (inverse-distance blend at the boat); 'bc' = open-boundary forcing only;
// 'check' = validation of the tide model. The first 'level' gauge is the venue's reference (the tide curve).
export const GAUGES = {
  solent: [
    { ticon: 'portsmouth-ptm-gbr-bodc', name: 'Portsmouth', role: 'level' },
    { ticon: 'southampton-sou-gbr-da_idh', name: 'Southampton', role: 'level' },
    { ticon: 'lymington-lym-gbr-cco', name: 'Lymington', role: 'level' },
    { ticon: 'sandown_pier-sdp-gbr-cco', name: 'Sandown', role: 'level' },
    { ticon: 'bournemouth-bou-gbr-bodc', name: 'Bournemouth', role: 'bc' },
    { ticon: 'swanage_pier-swp-gbr-cco', name: 'Swanage', role: 'bc' },
  ],
  sfbay: [
    { noaa: '9414290', name: 'San Francisco (Presidio)', role: 'level' },
    { noaa: '9414806', name: 'Sausalito', role: 'level' },
    { noaa: '9414863', name: 'Richmond', role: 'level' },
    { noaa: '9414750', name: 'Alameda', role: 'level' },
    { noaa: '9415020', name: 'Point Reyes', role: 'bc' },
    { noaa: '9414131', name: 'Pillar Point Harbor', role: 'bc' },
    { noaa: '9415143', name: 'Crockett', role: 'check' },
    { noaa: '9415144', name: 'Port Chicago', role: 'bc' },
    { noaa: '9414523', name: 'Redwood City', role: 'check' },
  ],
  newport: [
    { noaa: '8452660', name: 'Newport', role: 'level' },
    { noaa: '8454049', name: 'Quonset Point', role: 'level' },
    { noaa: '8452944', name: 'Conimicut Light', role: 'check' },
    { noaa: '8454000', name: 'Providence', role: 'check' },
    { noaa: '8447386', name: 'Fall River', role: 'check' },
    { noaa: '8455083', name: 'Point Judith', role: 'bc' },
    { noaa: '8450768', name: 'Sakonnet', role: 'bc' },
  ],
  kiel: [{ ticon: 'kielholtenau-9610066-deu-wsv', name: 'Kiel-Holtenau', role: 'level' }, { ticon: 'ltkiel-9610050-deu-wsv', name: 'Kiel Lighthouse', role: 'level' }],
  sydney: [{ ticon: 'sydney_fort_denison-60370-aus-bom', name: 'Fort Denison', role: 'level' }, { ticon: 'sydney_port_jackson-213470-aus-bom', name: 'Port Jackson (Heads)', role: 'level' }],
  auckland: [{ ticon: 'auckland-auct-nzl-ttw', name: 'Auckland (Waitematā)', role: 'level' }],
  marseille: [{ ticon: 'marseille-524-fra-refmar', name: 'Marseille', role: 'level' }],
  progreso: [
    { ticon: 'progreso_yuc-721b-mex-uhslc_rq', name: 'Progreso', role: 'level' },
    { ticon: 'sisal_radar-10-mex-unam', name: 'Sisal', role: 'bc' },
    { ticon: 'telchac_flotador-11-mex-unam', name: 'Telchac', role: 'bc' },
  ],
};

const TICON_URL = 'https://www.seanoe.org/data/00980/109129/data/122848.csv';
const TICON_FILE = join(tmpdir(), 'truewind-ticon4.csv');
async function ticon(names) {
  if (!existsSync(TICON_FILE)) {
    console.log('downloading TICON-4 (47 MB)…');
    const r = await fetch(TICON_URL, { headers: { 'User-Agent': 'truewind tide baker' } });
    if (!r.ok) throw new Error('TICON ' + r.status);
    writeFileSync(TICON_FILE, Buffer.from(await r.arrayBuffer()));
  }
  const want = new Set(names), out = {};
  const rl = createInterface({ input: createReadStream(TICON_FILE) });
  let head = null;
  for await (const line of rl) {
    const f = line.split(',');
    if (!head) { head = f; continue; }
    const n = f[head.indexOf('tide_gauge_name')];
    if (!want.has(n)) continue;
    const g = out[n] || (out[n] = { lat: +f[0], lon: +f[1], cons: [], src: `TICON-4 (${f[head.indexOf('gesla_source')]}, ${f[head.indexOf('start_date')]}–${f[head.indexOf('end_date')]})` });
    g.cons.push([f[2], +f[3] / 100, ((+f[4] % 360) + 360) % 360]);
  }
  return out;
}
async function noaa(id) {
  const base = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/' + id;
  const [h, d, s] = await Promise.all(['/harcon.json?units=metric', '/datums.json?units=metric', '.json'].map(p => fetch(base + p).then(r => r.json())));
  const dat = Object.fromEntries(d.datums.map(x => [x.name, x.value]));
  const st = s.stations[0];
  return { lat: +st.lat, lon: +st.lng, cons: h.HarmonicConstituents.filter(c => c.amplitude > 0).map(c => [c.name, c.amplitude, c.phase_GMT]),
    z0: dat.MSL - dat.MLLW, mhw: dat.MHW - dat.MSL, navd: dat.NAVD88 !== undefined ? dat.MSL - dat.NAVD88 : undefined, src: `NOAA CO-OPS ${id} (harmonic constants, datums)` };
}
// lowest astronomical tide and mean high water over 2026-2044, relative to MSL
export function datums(cons) {
  const st = new TideStation({ cons });
  const t0 = Date.UTC(2026, 0, 1), t1 = Date.UTC(2045, 0, 1);
  let lo = Infinity;
  for (let t = t0; t < t1; t += 3600e3) { const h = st.level(t); if (h < lo) lo = h; }
  const ex = st.extremes(Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  // (a double high water counts once: the higher of two within 3 h)
  const hw = []; for (const e of ex) if (e.hw) { const p = hw[hw.length - 1]; if (p && e.t - p.t < 3 * 3600e3) { if (e.h > p.h) hw[hw.length - 1] = e; } else hw.push(e); }
  return { lat: -lo + 0.02, mhw: hw.reduce((s, e) => s + e.h, 0) / Math.max(1, hw.length) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const want = process.argv.slice(2);
  for (const v of VENUES) {
    if (!GAUGES[v.id] || (want.length && !want.includes(v.id))) continue;
    const P = makeProjection(v.lat, v.lon);
    const T = await ticon(GAUGES[v.id].filter(g => g.ticon).map(g => g.ticon));
    const gauges = [];
    for (const g of GAUGES[v.id]) {
      const d = g.noaa ? await noaa(g.noaa) : T[g.ticon];
      if (!d) { console.log(v.id, 'missing', g.ticon || g.noaa); continue; }
      const cons = d.cons.filter(c => c[1] >= 0.001).map(c => [c[0], +c[1].toFixed(4), +c[2].toFixed(2)]);
      const dm = datums(cons);
      const [x, z] = P.fwd(d.lat, d.lon);
      gauges.push({ name: g.name, role: g.role, id: g.noaa || g.ticon, lat: d.lat, lon: d.lon, x: Math.round(x), z: Math.round(z),
        cd: g.noaa ? 'MLLW' : 'LAT', z0: +(g.noaa ? d.z0 : dm.lat).toFixed(3), lat0: +dm.lat.toFixed(3), mhw: +(g.noaa ? d.mhw : dm.mhw).toFixed(3),
        ...(d.navd !== undefined ? { navd: +d.navd.toFixed(3) } : {}), source: d.src, cons });
      const M2 = cons.find(c => c[0] === 'M2');
      console.log(v.id, g.name.padEnd(26), `${cons.length} cons, M2 ${M2 ? M2[1].toFixed(3) + ' m ' + M2[2].toFixed(0) + '°' : '-'}, z0 ${gauges.at(-1).z0} (${gauges.at(-1).cd}), LAT ${dm.lat.toFixed(2)} below MSL, MHW ${gauges.at(-1).mhw} above`);
    }
    const f = `data/venues/${v.id}.tide.json`;
    const old = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
    writeFileSync(f, JSON.stringify({ ...old, id: v.id, gauges }));
  }
}
