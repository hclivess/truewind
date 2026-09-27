// Bathymetry sources for the bake tools (node): EMODnet Bathymetry DTM (WCS, GeoTIFF, 1/16' ≈ 115 m, depths to
// LAT) and the NOAA NCEI DEM mosaic (CUDEM 1/9" on US coasts (NAVD88), ETOPO 2022 15" elsewhere (≈ MSL)).
// sample(venue, box, dx) returns depth below MSL (dm, Int16) on a local grid (x east, z south) over box.
import { fetchNCEI, gridFromLatLon } from '../js/bathy.js';
import { makeProjection } from '../js/world.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// per venue: source and the survey datum's offset to MSL (m to ADD to the source elevation)
export const SOURCES = {
  solent: { src: 'emodnet', datum: 'LAT', note: 'EMODnet Bathymetry DTM 2024 (UKHO surveys), LAT → MSL by the gauges\' LAT' },
  kiel: { src: 'emodnet', datum: 'LAT', note: 'EMODnet Bathymetry DTM 2024 (BSH surveys); LAT ≈ MSL − 0.1 m in the tideless Baltic' },
  marseille: { src: 'emodnet', datum: 'LAT', note: 'EMODnet Bathymetry DTM 2024 (SHOM surveys); LAT ≈ MSL − 0.2 m' },
  sfbay: { src: 'ncei', datum: 'NAVD88', note: 'NOAA NCEI CUDEM 1/9" (ncei19_n38x00_w122x50_2022v1), NAVD88 → MSL by NOAA 9414290 datums' },
  newport: { src: 'ncei', datum: 'NAVD88', note: 'NOAA NCEI CUDEM 1/9" (ncei19_n41x50_w071x50_2018v1) and CRM vol. 1, NAVD88 → MSL by NOAA 8452660 datums' },
  sydney: { src: 'ncei', datum: 'MSL', note: 'ETOPO 2022 15" (NOAA NCEI; GEBCO / AusSeabed inputs), EGM2008 ≈ MSL' },
  auckland: { src: 'ncei', datum: 'MSL', note: 'ETOPO 2022 15" (NOAA NCEI; GEBCO / NIWA inputs), EGM2008 ≈ MSL' },
  progreso: { src: 'ncei', datum: 'MSL', note: 'ETOPO 2022 15" (NOAA NCEI; GEBCO inputs), EGM2008 ≈ MSL' },
};

const CACHE = join(tmpdir(), 'truewind-bathy'); try { mkdirSync(CACHE, { recursive: true }); } catch (e) {}
const cached = async (key, fn) => {
  const f = join(CACHE, key.replace(/[^a-z0-9._-]/gi, '_'));
  if (existsSync(f)) return new Uint8Array(readFileSync(f));
  const b = await fn(); writeFileSync(f, b); return b;
};

// minimal TIFF reader: uncompressed, Float32, strips or tiles, either byte order
export function readTiff(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), le = buf[0] === 0x49;
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const ifd = u32(4), n = u16(ifd), tags = {};
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + 12 * i, tag = u16(o), typ = u16(o + 2), cnt = u32(o + 4);
    const bytes = size[typ] * cnt, at = bytes <= 4 ? o + 8 : u32(o + 8);
    const vals = [];
    for (let k = 0; k < Math.min(cnt, 1 << 20); k++) vals.push(typ === 3 ? u16(at + 2 * k) : typ === 4 ? u32(at + 4 * k) : typ === 12 ? dv.getFloat64(at + 8 * k, le) : 0);
    tags[tag] = vals;
  }
  const W = tags[256][0], H = tags[257][0];
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('compressed TIFF');
  const out = new Float32Array(W * H);
  const tw = tags[322]?.[0], th = tags[323]?.[0];
  if (tw) {
    const offs = tags[324], across = Math.ceil(W / tw);
    offs.forEach((off, t) => {
      const tx = (t % across) * tw, ty = Math.floor(t / across) * th;
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
        const X = tx + x, Y = ty + y; if (X >= W || Y >= H) continue;
        out[Y * W + X] = dv.getFloat32(off + 4 * (y * tw + x), le);
      }
    });
  } else {
    const offs = tags[273], rps = tags[278]?.[0] ?? H;
    offs.forEach((off, s) => { for (let k = 0; k < rps * W && s * rps * W + k < W * H; k++) out[s * rps * W + k] = dv.getFloat32(off + 4 * k, le); });
  }
  for (let k = 0; k < out.length; k++) if (!(Math.abs(out[k]) < 1e5)) out[k] = NaN;
  return { W, H, data: out };
}

async function emodnet(bbox) {
  const res = 1 / 960;
  // snap to the native grid so no resampling happens on the server
  const b = [Math.floor(bbox[0] / res) * res, Math.floor(bbox[1] / res) * res, Math.ceil(bbox[2] / res) * res, Math.ceil(bbox[3] / res) * res];
  const w = Math.round((b[2] - b[0]) / res), h = Math.round((b[3] - b[1]) / res);
  const url = `https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean&crs=EPSG:4326` +
    `&BBOX=${b.map(v => v.toFixed(7)).join(',')}&format=GeoTIFF&interpolation=nearest%20neighbor&width=${w}&height=${h}`;
  const buf = await cached('emodnet_' + b.map(v => v.toFixed(4)).join('_') + '.tif', async () => {
    const r = await fetch(url); if (!r.ok) throw new Error('EMODnet ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  });
  const t = readTiff(buf);
  return { data: t.data, w: t.W, h: t.H, bbox: b };
}
async function ncei(bbox, px) {
  const w = Math.min(4000, Math.ceil((bbox[2] - bbox[0]) * 111320 * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180) / px));
  const h = Math.min(4000, Math.ceil((bbox[3] - bbox[1]) * 110540 / px));
  const buf = await cached(`ncei_${bbox.map(v => v.toFixed(4)).join('_')}_${w}x${h}.f32`, async () => {
    // (big requests in tiles: the service caps an image at ~16 MP but is quicker with smaller ones)
    const T = 1000, out = new Float32Array(w * h);
    for (let ty = 0; ty < h; ty += T) for (let tx = 0; tx < w; tx += T) {
      const tw = Math.min(T, w - tx), th = Math.min(T, h - ty);
      const bb = [bbox[0] + (bbox[2] - bbox[0]) * tx / w, bbox[3] - (bbox[3] - bbox[1]) * (ty + th) / h, bbox[0] + (bbox[2] - bbox[0]) * (tx + tw) / w, bbox[3] - (bbox[3] - bbox[1]) * ty / h];
      let a; for (let k = 0; k < 4; k++) { try { a = await fetchNCEI(bb, tw, th); break; } catch (e) { console.log('  ncei retry', e.message); await new Promise(r => setTimeout(r, 3000)); } }
      if (!a) throw new Error('NCEI failed');
      for (let y = 0; y < th; y++) out.set(a.subarray(y * tw, y * tw + tw), (ty + y) * w + tx);
    }
    return new Uint8Array(out.buffer);
  });
  return { data: new Float32Array(buf.buffer, buf.byteOffset, w * h), w, h, bbox };
}

// depth below MSL (dm) on grid g = { nx, nz, x0, z0, dx } (or per-axis centres xs, zs) for venue v.
// z0At(x, z): MSL above LAT (m) where the source is referenced to LAT; navd: MSL − NAVD88 (m).
export async function sample(v, g, { z0At = () => 0, navd = 0, px = 30 } = {}) {
  const S = SOURCES[v.id]; if (!S) return null;
  const P = makeProjection(v.lat, v.lon);
  const xs = g.xs || Array.from({ length: g.nx }, (_, i) => g.x0 + (i + 0.5) * g.dx), zs = g.zs || Array.from({ length: g.nz }, (_, j) => g.z0 + (j + 0.5) * g.dx);
  const [la0] = P.inv(0, zs[zs.length - 1] + 400), [la1] = P.inv(0, zs[0] - 400), [, lo0] = P.inv(xs[0] - 400, 0), [, lo1] = P.inv(xs[xs.length - 1] + 400, 0);
  const bbox = [lo0, la0, lo1, la1];
  const r = S.src === 'emodnet' ? await emodnet(bbox) : await ncei(bbox, px);
  const toMSL = S.datum === 'LAT' ? (x, z) => -z0At(x, z) : S.datum === 'NAVD88' ? () => -navd : () => 0;
  const out = new Int16Array(xs.length * zs.length);
  // resample (bilinear on the source's pixel centres) onto the local grid
  const [lw, ls, le, ln] = r.bbox, rx = (le - lw) / r.w, ry = (ln - ls) / r.h;
  for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
    const [lat, lon] = P.inv(xs[i], zs[j]);
    let fx = (lon - lw) / rx - 0.5, fy = (ln - lat) / ry - 0.5;
    fx = Math.max(0, Math.min(r.w - 1.001, fx)); fy = Math.max(0, Math.min(r.h - 1.001, fy));
    const a = Math.floor(fx), b = Math.floor(fy), u = fx - a, w2 = fy - b, k = b * r.w + a, d = r.data;
    let s = 0, ws = 0;
    for (const [kk, wt] of [[k, (1 - u) * (1 - w2)], [k + 1, u * (1 - w2)], [k + r.w, (1 - u) * w2], [k + r.w + 1, u * w2]]) if (Number.isFinite(d[kk])) { s += d[kk] * wt; ws += wt; }
    const e = ws > 1e-6 ? s / ws + toMSL(xs[i], zs[j]) : NaN;
    out[j * xs.length + i] = Number.isFinite(e) ? Math.max(-32000, Math.min(32000, Math.round(-e * 10))) : -32768;
  }
  // holes (no data): nearest valid neighbour, grown outward
  for (let pass = 0; pass < 50; pass++) {
    let left = 0;
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
      const k = j * xs.length + i; if (out[k] !== -32768) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= xs.length || jj >= zs.length) continue; const q = out[jj * xs.length + ii]; if (q !== -32768) { s += q; n++; } }
      if (n) out[k] = Math.round(s / n); else left++;
    }
    if (!left) break;
  }
  return { data: out, source: S.note };
}

// gauge-based chart datum field: inverse-distance blend of the gauges' LAT below MSL
export function z0Field(gauges) {
  const G = gauges.filter(g => g.lat0 !== undefined);
  return (x, z) => { let s = 0, w = 0; for (const g of G) { const d2 = (x - g.x) ** 2 + (z - g.z) ** 2 + 1e6, q = 1 / (d2 * d2); s += q * g.lat0; w += q; } return w ? s / w : 0; };
}
