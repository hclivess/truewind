// Seamarks from OpenStreetMap / OpenSeaMap (seamark:* tags): lighthouses, lights, buoys and beacons, turned into
// compact local records; light characters (Fl(2) W 10s, Q(6)+LFl 15s, Oc(3), Mo(A), Al.WR...) parsed into
// on/off timing; sector lights; IALA buoyage regions A / B. Pure logic (no three.js): shared by the browser, the
// venue baker (tools/fetch-venues.mjs --seamarks) and the tests (test/seamarks.mjs).

const D2R = Math.PI / 180;

// ------------------------------------------------------------------ Overpass
const KEEP = /^(lighthouse|light_major|light_minor|light_vessel|light_float|beacon_(lateral|cardinal|isolated_danger|safe_water|special_purpose)|buoy_(lateral|cardinal|isolated_danger|safe_water|special_purpose|installation)|landmark|wreck|rock|obstruction)$/;
const bbox = (lat, lon, R) => {
  const dLat = R / 110540, dLon = R / (111320 * Math.cos(lat * D2R));
  return `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
};
// every mark inside the sailing area, plus the lighthouses whose loom reaches it from farther off
export function seamarksQuery(lat, lon, R = 6600, Rfar = 28000) {
  const a = bbox(lat, lon, R), b = bbox(lat, lon, Rfar);
  return `[out:json][timeout:90];(nwr["seamark:type"~"^(buoy_|beacon_|light|landmark|wreck|rock|obstruction)"](${a});` +
    `nwr["seamark:type"~"^(lighthouse|light_major|light_vessel)$"](${b});nwr["man_made"="lighthouse"](${b}););out center tags;`;
}

// live fetch for a custom location (the browser): { region, marks }
export async function fetchSeamarks(lat, lon, R = 6600) {
  const q = seamarksQuery(lat, lon, R);
  let err;
  for (const u of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
      if (!r.ok) throw new Error('Overpass ' + r.status);
      return processSeamarks(await r.json(), lat, lon, R);
    } catch (e) { err = e; }
  }
  throw err;
}

// ------------------------------------------------------------------ colours
export const COLOURS = { white: 'W', red: 'R', green: 'G', yellow: 'Y', blue: 'Bu', violet: 'Vi', orange: 'Or', amber: 'Am', black: 'B', grey: 'Gy', brown: 'Br', magenta: 'Mg', pink: 'Pk' };
const LETTER = Object.fromEntries(Object.entries(COLOURS).map(([k, v]) => [v, k]));
// display colours: day paint (hex) and night light (linear-ish rgb)
export const PAINT = { white: 0xf2f2ee, red: 0xc8201e, green: 0x16804a, yellow: 0xf2c418, black: 0x1c1c1e, blue: 0x2050b0, orange: 0xf07a18, grey: 0x8a8d90, brown: 0x6b4a2e, violet: 0x7a3aa0, amber: 0xf0a020 };
export const GLOW = { white: [1, 0.93, 0.8], red: [1, 0.12, 0.08], green: [0.1, 1, 0.45], yellow: [1, 0.8, 0.15], blue: [0.3, 0.45, 1], violet: [0.7, 0.3, 1], orange: [1, 0.5, 0.1], amber: [1, 0.62, 0.15] };
// light colours as chart letters (white -> W)
const cols = (s) => !s ? [] : String(s).split(/[;,]/).map(c => c.trim()).filter(Boolean).map(c => COLOURS[c.toLowerCase()] || (LETTER[c] ? c : c.toLowerCase()));
export const colourName = (c) => LETTER[c] || c;

// ------------------------------------------------------------------ IALA regions
// B: the Americas (and Greenland is A), Japan, Korea, the Philippines; A everywhere else
export function ialaRegion(lat, lon) {
  if (lon > -170 && lon < -25 && lat > -60 && !(lat > 59 && lon > -75)) return 'B';
  if (lat > 24 && lat < 46 && lon > 122 && lon < 154) return 'B';     // Japan
  if (lat > 33 && lat < 43 && lon > 124 && lon < 131) return 'B';     // Korea
  if (lat > 4 && lat < 21.5 && lon > 116 && lon < 127) return 'B';    // Philippines
  return 'A';
}
// lateral colours and shapes by region when the tags leave them out
export function lateralLook(cat, region) {
  const redPort = region !== 'B';
  const port = redPort ? 'red' : 'green', stbd = redPort ? 'green' : 'red';
  switch (cat) {
    case 'port': return { col: [port], shape: 'can', top: 'cylinder', tc: [port], light: port };
    case 'starboard': return { col: [stbd], shape: 'conical', top: 'cone, point up', tc: [stbd], light: stbd };
    case 'preferred_channel_starboard': return { col: [port, stbd, port], pat: 'horizontal', shape: 'can', top: 'cylinder', tc: [port], light: port };
    case 'preferred_channel_port': return { col: [stbd, port, stbd], pat: 'horizontal', shape: 'conical', top: 'cone, point up', tc: [stbd], light: stbd };
  }
  return null;
}
const CARDINAL = {
  north: { col: ['black', 'yellow'], top: '2 cones up', ch: 'VQ' }, east: { col: ['black', 'yellow', 'black'], top: '2 cones base together', ch: 'VQ', gr: '3', per: 5 },
  south: { col: ['yellow', 'black'], top: '2 cones down', ch: 'VQ+LFl', gr: '6', per: 10 }, west: { col: ['yellow', 'black', 'yellow'], top: '2 cones point together', ch: 'VQ', gr: '9', per: 10 },
};

// ------------------------------------------------------------------ OSM -> records
// { t: type, x, z (local m), n: name, cat, col: [colours top->bottom], pat, sh: shape, tm/tc: topmark, h: height,
//   sys: 'A'|'B', far: outside the sailing area, L: [{ ch, gr, col, per, seq, rng, ht, s0, s1, ori }] }
export function processSeamarks(osm, lat0, lon0, R = 6600) {
  const kx = Math.cos(lat0 * D2R) * 111320, kz = 110540;
  const out = [], seen = new Set();
  const region = ialaRegion(lat0, lon0);
  for (const el of osm.elements || []) {
    const T = el.tags || {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (lat === undefined) continue;
    let t = T['seamark:type'];
    if (!t && T.man_made === 'lighthouse') t = 'lighthouse';
    if (t === 'light_minor' && T.man_made === 'lighthouse') t = 'lighthouse';
    if (!t || !KEEP.test(t)) continue;
    const x = Math.round((lon - lon0) * kx * 2) / 2, z = Math.round(-(lat - lat0) * kz * 2) / 2;
    const key = `${t}:${Math.round(x / 3)}:${Math.round(z / 3)}`;             // the same mark as node and way
    if (seen.has(key)) continue; seen.add(key);
    const far = Math.abs(x) > R || Math.abs(z) > R;
    const p = `seamark:${t}:`, g = (k) => T[p + k];
    const rec = { t, x, z };
    const name = T['seamark:name'] || T.name; if (name) rec.n = String(name).slice(0, 40);
    const cat = g('category'); if (cat) rec.cat = cat.split(';')[0];
    const col = g('colour') || T['seamark:landmark:colour'] || T['building:colour'] || T['tower:colour']; if (col) rec.col = col.split(';').map(s => s.trim());
    const pat = g('colour_pattern'); if (pat) rec.pat = pat;
    const sh = g('shape') || (t === 'lighthouse' ? T['tower:construction'] : null); if (sh) rec.sh = sh;
    if (T['seamark:topmark:shape']) { rec.tm = T['seamark:topmark:shape']; if (T['seamark:topmark:colour']) rec.tc = T['seamark:topmark:colour'].split(';'); }
    const sys = g('system') || T['seamark:buoy_lateral:system'] || T['seamark:beacon_lateral:system'];
    if (sys) rec.sys = /b/i.test(sys.replace('iala-', '')) ? 'B' : 'A';
    const h = parseFloat(T.height ?? g('height') ?? T['seamark:landmark:height']); if (h > 0 && h < 200) rec.h = Math.round(h * 10) / 10;
    // lights: seamark:light:* or seamark:light:1:*, :2:* ... (sectors, or several lights on one structure)
    const L = [];
    const light = (q) => {
      let ch = T[q + 'character']; if (!ch && !T[q + 'colour']) return;
      const r = { ch: ch || 'F' };
      const inl = r.ch.match(/^([^(]+)\(([^)]*)\)(.*)$/);                       // "Fl(2)" / "Q(6)+LFl" written inline
      if (inl) { r.ch = inl[1] + inl[3]; r.gr = inl[2]; }
      if (T[q + 'group']) r.gr = T[q + 'group'];
      const c = cols(T[q + 'colour']); if (c.length) r.col = c;
      const num = (k) => { const v = parseFloat(T[q + k]); return isFinite(v) ? v : undefined; };
      if (num('period') !== undefined) r.per = num('period');
      if (T[q + 'sequence']) r.seq = T[q + 'sequence'];
      if (num('range') !== undefined) r.rng = num('range');
      if (num('height') !== undefined) r.ht = num('height');
      if (num('sector_start') !== undefined && num('sector_end') !== undefined) { r.s0 = num('sector_start'); r.s1 = num('sector_end'); }
      if (num('orientation') !== undefined) r.ori = num('orientation');
      const lc = T[q + 'category']; if (lc) r.cat = lc;
      const vis = T[q + 'visibility']; if (vis) r.vis = vis;
      L.push(r);
    };
    light('seamark:light:');
    for (let i = 1; i < 40; i++) { if (!Object.keys(T).some(k => k.startsWith(`seamark:light:${i}:`))) { if (i > 3) break; continue; } light(`seamark:light:${i}:`); }
    // a lighthouse with no light tags still shows a white light (the tower is what the map knows)
    if (!L.length && (t === 'lighthouse' || t === 'light_major') && !/disused|former|historic|decommission/i.test(name || '') && !T.historic && !T.disused && !T['disused:man_made'])
      L.push({ ch: 'Fl', col: ['W'], per: 10, rng: 15, guess: 1 });
    if (L.length) rec.L = L;
    if (far) { if (!rec.L || !/^(lighthouse|light_major|light_vessel)$/.test(t)) continue; rec.far = 1; }
    out.push(rec);
  }
  // keep sizes sane: lit and major marks first, then by distance from the centre
  const score = (r) => (r.far ? 2 : 0) + (r.L ? 0 : 1) + (/^(wreck|rock|obstruction)$/.test(r.t) ? 2 : 0) + Math.hypot(r.x, r.z) / (R * 2);
  out.sort((a, b) => score(a) - score(b));
  let dangers = 0;
  const kept = out.filter(r => !/^(wreck|rock|obstruction)$/.test(r.t) || ++dangers <= 150);   // (Kiel charts hundreds of boulders)
  return { region, marks: kept.slice(0, 700) };
}

// fill in what the tags leave to convention: lateral / cardinal colours, shapes and topmarks, default lights
export function resolveMark(m, region) {
  if (m._r) return m;
  const reg = m.sys || region || 'A';
  const r = { ...m, _r: 1, reg };
  const lat = /_lateral$/.test(m.t) ? lateralLook(m.cat, reg) : null;
  if (lat) {
    // (tagged colours win: the region only fills in what the tags leave out)
    if (!r.col) { r.col = lat.col; if (lat.pat) r.pat = lat.pat; }
    if (!r.sh) r.sh = /^buoy/.test(m.t) ? lat.shape : 'stake';
    if (!r.tm && /^beacon/.test(m.t)) { r.tm = lat.top; r.tc = lat.tc; }
  }
  const card = /_cardinal$/.test(m.t) ? CARDINAL[m.cat] : null;
  if (card) {
    if (!r.col) { r.col = card.col; r.pat = 'horizontal'; }
    if (!r.tm) { r.tm = card.top; r.tc = ['black']; }
    if (!r.sh) r.sh = /^buoy/.test(m.t) ? 'pillar' : 'stake';
  }
  if (/isolated_danger$/.test(m.t)) { r.col ??= ['black', 'red', 'black']; r.pat ??= 'horizontal'; r.tm ??= '2 spheres'; r.tc ??= ['black']; r.sh ??= /^buoy/.test(m.t) ? 'pillar' : 'tower'; }
  if (/safe_water$/.test(m.t)) { r.col ??= ['red', 'white']; r.pat ??= 'vertical'; r.tm ??= 'sphere'; r.tc ??= ['red']; r.sh ??= /^buoy/.test(m.t) ? 'spherical' : 'tower'; }
  if (/special_purpose$/.test(m.t)) { r.col ??= ['yellow']; r.sh ??= /^buoy/.test(m.t) ? 'can' : 'stake'; }
  if (/^buoy/.test(m.t) || m.t === 'light_float') r.sh ??= m.t === 'light_float' ? 'super-buoy' : 'pillar';
  if (m.t === 'light_vessel') { r.col ??= ['red']; r.sh ??= 'light_vessel'; }
  if (/^beacon/.test(m.t)) r.sh ??= 'stake';
  if (m.t === 'lighthouse') r.col ??= ['white'];
  r.col = (r.col || ['grey']).map(c => String(c).toLowerCase());
  // default light colours for lit marks whose colour the tags leave out
  if (r.L) r.L = r.L.map(l => {
    if (l.col && l.col.length) return l;
    const c = lat ? COLOURS[lat.light] : card || /isolated_danger|safe_water/.test(m.t) ? 'W' : /special_purpose/.test(m.t) ? 'Y' : 'W';
    return { ...l, col: [c] };
  });
  return r;
}

// ------------------------------------------------------------------ light characters
// "Fl(2) W 10s", "VQ(6)+LFl 10s", "Oc(3) 15s", "Mo(U)", "Al.WR 4s", "Iso WRG 4s", "Fl.G.5s", "Q" -> { ch, gr, col, per }
export function parseLight(s) {
  s = String(s).trim();
  const out = {};
  const m = s.match(/^((?:Al\.)?(?:[A-Z][A-Za-z]*)(?:\([^)]*\))?(?:\+(?:[A-Z][A-Za-z]*)(?:\([^)]*\))?)*)/);
  if (!m) return null;
  let ch = m[1], rest = s.slice(ch.length);
  // Al.WR (an alternating fixed light) puts its colours straight after the dot
  const al = ch.match(/^Al\.((?:W|R|G|Y|Bu)+)$/);
  if (al && !/^(Fl|LFl|Oc|Iso|Q|VQ|UQ|Mo|F)/.test(al[1])) { ch = 'Al'; rest = al[1] + rest; }
  const g = ch.match(/\(([^)]*)\)/);
  if (g) { out.gr = g[1]; ch = ch.replace(/\([^)]*\)/, ''); }
  out.ch = ch;
  const per = rest.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?\b/); if (per) out.per = +per[1];
  const cm = rest.replace(/(\d+(?:\.\d+)?)\s*s(?:ec)?\b/, '').match(/(?:^|[\s.])((?:W|R|G|Y|Bu|Vi|Or|Am)+)(?=[\s.]|$)/);
  if (cm) out.col = cm[1].match(/Bu|Vi|Or|Am|[WRGY]/g);
  return out;
}

// standard durations (s)
const FL = 0.5, GAP = 1.0, LFL = 2.0;
const QUICK = { Q: [0.35, 0.65], VQ: [0.2, 0.3], UQ: [0.1, 0.15] };
const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
// defaults for a character tagged without a period
const DEF_PER = { Fl: 5, LFl: 10, Oc: 6, Iso: 4, Mo: 8, IQ: 10, IVQ: 10, IUQ: 10 };

// OSM seamark:light:sequence: "0.5+(1),0.5+(3)" or "1+(4)" (light, then eclipse in brackets)
function parseSeq(seq) {
  const ph = [];
  for (const part of String(seq).split(/[,;]/)) {
    for (const m of part.matchAll(/(\()?\s*(\d+(?:\.\d+)?)\s*\)?/g)) { const d = +m[2]; if (d > 0) ph.push([d, m[1] ? 0 : 1]); }
  }
  return ph.length ? ph : null;
}
const groups = (gr) => !gr ? [1] : String(gr).split('+').map(x => Math.max(1, parseInt(x) || 1));

// -> { per, ph: [[duration, intensity 0..1, colour index]] } one full period of the light as seen by an observer
export function lightPhases(L) {
  const ch = String(L.ch || 'F').replace(/\s/g, '').replace(/\.$/, '');
  const alt = /^Al\./.test(ch) || ch === 'Al';
  const code = ch.replace(/^Al\./, '');
  const ncol = alt ? Math.max(2, (L.col || []).length) : 1;
  let per = L.per;
  let ph = L.seq ? parseSeq(L.seq) : null;
  const parts = code.split('+');
  if (!ph) {
    ph = [];
    const on = (d) => ph.push([d, 1]), off = (d) => ph.push([d, 0]);
    let occult = false, fixed = false, iso = false;
    parts.forEach((p, pi) => {
      const gr = pi === 0 ? L.gr : undefined;
      if (pi > 0 && ph.length) off(ph[ph.length - 1][1] ? GAP : 0);
      if (p === 'F' || p === 'Al' || p === 'Dir' || p === '') { fixed = true; on(1); if (alt) on(1); }
      else if (p === 'Fl' || p === 'FFl') { groups(gr).forEach((n, gi) => { if (gi) off(GAP * 2); for (let i = 0; i < n; i++) { if (i) off(GAP); on(FL); } }); }
      else if (p === 'LFl') { groups(gr).forEach((n, gi) => { if (gi) off(GAP * 3); for (let i = 0; i < n; i++) { if (i) off(GAP * 1.5); on(LFL); } }); }
      else if (QUICK[p] || /^I(Q|VQ|UQ)$/.test(p)) {
        const [a, b] = QUICK[p.replace(/^I/, '')];
        if (gr && !/^I/.test(p)) { const n = groups(gr)[0]; for (let i = 0; i < n; i++) { if (i) off(b); on(a); } }
        else if (/^I/.test(p)) { const P = per ?? DEF_PER[p]; const n = Math.max(3, Math.floor(P * 0.7 / (a + b))); for (let i = 0; i < n; i++) { if (i) off(b); on(a); } }
        else if (parts.length === 1) { on(a); off(b); per = a + b; }
        else on(a);
      }
      else if (p === 'Oc') { occult = true; const gs = groups(gr); if (gs.length === 1 && gs[0] === 1) { on(0); } else gs.forEach((n, gi) => { if (gi) on(GAP * 2); for (let i = 0; i < n; i++) { if (i) on(GAP); off(GAP); } }); }
      else if (p === 'Iso') { const P = per ?? DEF_PER.Iso; on(P / 2); off(P / 2); per = P; iso = true; }
      else if (p === 'Mo') {
        const letters = String(gr || 'A').toUpperCase().replace(/[^A-Z]/g, '').split('');
        letters.forEach((c, li) => { if (li) off(1.5); (MORSE[c] || '.').split('').forEach((s, si) => { if (si) off(0.5); on(s === '-' ? 1.5 : 0.5); }); });
      }
      else { fixed = true; on(1); }
    });
    ph = ph.filter(p => p[0] > 0);
    if (fixed && parts.length === 1) return { per: alt ? (per ?? 4) : 1, ph: alt ? [[(per ?? 4) / 2, 1, 0], [(per ?? 4) / 2, 1, 1]] : [[1, 1, 0]], alt, fixed: true };
    per ??= DEF_PER[parts[0]] ?? (parts.length > 1 || L.gr ? (/^V/.test(parts[0]) ? 10 : 15) : 5);
    if (occult) {
      // Oc: light, broken by eclipses. A single occulting light is eclipsed a fifth of its period
      if (ph.length === 1 || !ph.some(p => !p[1])) { const e = Math.min(per * 0.4, Math.max(0.5, per * 0.2)); ph = [[per - e, 1], [e, 0]]; }
      else {
        const used = ph.reduce((s, p) => s + p[0], 0), room = per * 0.6;
        if (used > room) for (const p of ph) p[0] *= room / used;
        ph.push([per - Math.min(used, room), 1]);
      }
    }
    // fit the group into the period, leaving the long eclipse
    const used = ph.reduce((s, p) => s + p[0], 0);
    if (!occult && !iso && ph.length && !(parts.length === 1 && QUICK[parts[0]] && !L.gr)) {
      const room = per * (ph.length > 2 ? 0.8 : 0.6);
      if (used > room) { const k = room / used; for (const p of ph) p[0] *= k; }
      ph.push([per - Math.min(used, room), 0]);
    }
    if (code.startsWith('FFl')) ph = ph.map(p => [p[0], p[1] ? 1 : 0.35]);   // fixed light with brighter flashes
  } else {
    const used = ph.reduce((s, p) => s + p[0], 0);
    per ??= used;
    if (per > used + 0.01) { if (ph[ph.length - 1][1]) ph.push([per - used, 0]); else ph[ph.length - 1][0] += per - used; }
    else per = used;
  }
  // colour index per flash (alternating lights step through their colours; one flash a period alternates by period)
  if (alt && ph.filter(p => p[1]).length === 1) { ph = ph.concat(ph); per *= 2; }
  let k = 0;
  ph = ph.map(p => [p[0], p[1], p[1] ? (alt ? (k++) % ncol : 0) : 0]);
  return { per, ph, alt };
}

// intensity and colour index at time t (s); `off` shifts the phase (lights are not synchronised)
export function lightAt(P, t, off = 0) {
  if (P.fixed && !P.alt) return [1, 0];
  let u = ((t + off) % P.per + P.per) % P.per;
  for (const [d, i, c] of P.ph) { if (u < d) return [i, c]; u -= d; }
  const l = P.ph[P.ph.length - 1]; return [l[1], l[2]];
}
// number of separate flashes (on-phases after an off-phase) in a period; the tests' check of the timing
export function countFlashes(P) {
  let n = 0; const ph = P.ph;
  for (let i = 0; i < ph.length; i++) { const prev = ph[(i - 1 + ph.length) % ph.length]; if (ph[i][1] >= 1 && prev[1] < 1) n++; }
  return n;
}

// is a sector light seen from bearing `brgFromSea` (deg, observer -> light, true)?
export function inSector(L, brgFromSea) {
  if (L.s0 === undefined) {
    if (L.ori !== undefined) return Math.abs(((brgFromSea - L.ori + 540) % 360) - 180) < 2;   // directional light
    return true;
  }
  const b = (brgFromSea % 360 + 360) % 360, s0 = (L.s0 % 360 + 360) % 360, s1 = (L.s1 % 360 + 360) % 360;
  return s0 <= s1 ? b >= s0 && b <= s1 : b >= s0 || b <= s1;
}

// chart label: "Fl(2) G 5s", "Q(6)+LFl W 15s", "Oc WRG 10s" (sectors merged), "Iso 4s"
export function lightLabel(Ls) {
  if (!Ls || !Ls.length) return '';
  const first = Ls[0], same = Ls.filter(l => l.ch === first.ch && (l.gr || '') === (first.gr || '') && (l.per || 0) === (first.per || 0));
  const colours = [...new Set(same.flatMap(l => l.col || []))];
  const fmtOne = (l, cs) => {
    let ch = l.ch || 'F';
    if (l.gr) ch = ch.includes('+') ? ch.replace('+', `(${l.gr})+`) : `${ch}(${l.gr})`;
    const c = cs.filter(x => x).join('');
    return [ch, c, l.per ? `${+l.per.toFixed(1)}s` : ''].filter(Boolean).join(' ');
  };
  let s = fmtOne(first, colours) + (first.guess ? '?' : '');       // (a lighthouse the map gives no light for: assumed)
  const other = Ls.find(l => !same.includes(l));
  if (other) s += ' · ' + fmtOne(other, other.col || []);
  if (first.rng) s += ` ${+first.rng.toFixed(0)}M`;
  return s;
}
