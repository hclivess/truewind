// Real bathymetry: a regular grid of depth below mean sea level over the venue (decimetres, Int16), baked by
// tools/fetch-bathy.mjs from the best free source per venue (EMODnet DTM for European waters, NOAA NCEI CUDEM for
// US coasts, ETOPO 2022 15" elsewhere), with the survey's vertical datum (LAT, NAVD88, EGM2008) moved to MSL.
// File: 'TWB1', uint32 header length, JSON header { nx, nz, x0, z0, dx, source, datum, ... }, pad to 2, Int16 data
// (row j = z, south-going; positive = water depth below MSL, negative = height above MSL).
// For custom locations fetchBathy() reads the NCEI DEM mosaic live (it sends CORS headers).

export class Bathy {
  constructor(h, data) {
    Object.assign(this, h);
    this.h = h; this.d = data;                                  // Int16, dm
  }
  // bilinear depth below MSL (m) at world (x, z); NaN outside the grid
  at(x, z) {
    const nx = this.nx, nz = this.nz;
    let fx = (x - this.x0) / this.dx - 0.5, fz = (z - this.z0) / this.dx - 0.5;
    if (fx < -0.5 || fz < -0.5 || fx > nx - 0.5 || fz > nz - 0.5) return NaN;
    fx = Math.max(0, Math.min(nx - 1.0001, fx)); fz = Math.max(0, Math.min(nz - 1.0001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i, d = this.d;
    return ((d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + nx] * (1 - u) + d[k + nx + 1] * u) * v) * 0.1;
  }
}

export function encodeBathy(h, data) {
  const hj = new TextEncoder().encode(JSON.stringify(h));
  const pad = (8 + hj.length) % 2, n = 8 + hj.length + pad;
  const out = new Uint8Array(n + data.length * 2);
  out.set([84, 87, 66, 49]); new DataView(out.buffer).setUint32(4, hj.length, true);
  out.set(hj, 8);
  const dv = new DataView(out.buffer, n);
  for (let i = 0; i < data.length; i++) dv.setInt16(i * 2, data[i], true);
  return out;
}
export function decodeBathy(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] !== 84 || u8[1] !== 87 || u8[2] !== 66 || u8[3] !== 49) throw new Error('not a TWB1 bathymetry file');
  const L = dv.getUint32(4, true), h = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + L)));
  const n = 8 + L + ((8 + L) % 2), cnt = h.nx * h.nz, d = new Int16Array(cnt);
  for (let i = 0; i < cnt; i++) d[i] = dv.getInt16(n + i * 2, true);
  return new Bathy(h, d);
}

// NOAA NCEI DEM global mosaic (the best DEM at each place: CUDEM 1/9" on US coasts, ETOPO 2022 15" elsewhere),
// elevations (m, + up) on a lat/lon grid, north row first. bbox: [lonW, latS, lonE, latN]. Node and browser.
export async function fetchNCEI(bbox, w, h, service = 'DEM_global_mosaic') {
  const url = `https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/${service}/ImageServer/exportImage?bbox=${bbox.join(',')}` +
    `&bboxSR=4326&imageSR=4326&size=${w},${h}&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  const r = await fetch(url, typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(60000) } : undefined);
  if (!r.ok) throw new Error('NCEI DEM ' + r.status);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < w * h * 4) throw new Error('NCEI DEM: short reply');
  // (a validity bit mask follows the w·h floats)
  const a = new Float32Array(buf.slice(0, w * h * 4));
  const mask = new Uint8Array(buf, w * h * 4);
  for (let k = 0; k < w * h; k++) if (mask.length > k >> 3 && !(mask[k >> 3] & (0x80 >> (k & 7)))) a[k] = NaN;
  return a;
}

// Resample a lat/lon elevation grid (north row first, pixel-is-area over bbox) onto the venue's local grid:
// depth below MSL in dm. proj: makeProjection(lat0, lon0); toMSL(x, z): what to add to the source's elevation.
export function gridFromLatLon(src, w, h, bbox, proj, g, toMSL = () => 0) {
  const out = new Int16Array(g.nx * g.nz);
  const [lw, ls, le, ln] = bbox, rx = (le - lw) / w, ry = (ln - ls) / h;
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.x0 + (i + 0.5) * g.dx, z = g.z0 + (j + 0.5) * g.dx;
    const [lat, lon] = proj.inv(x, z);
    let fx = (lon - lw) / rx - 0.5, fy = (ln - lat) / ry - 0.5;
    fx = Math.max(0, Math.min(w - 1.001, fx)); fy = Math.max(0, Math.min(h - 1.001, fy));
    const a = Math.floor(fx), b = Math.floor(fy), u = fx - a, v = fy - b, k = b * w + a;
    const q = [[src[k], (1 - u) * (1 - v)], [src[k + 1], u * (1 - v)], [src[k + w], (1 - u) * v], [src[k + w + 1], u * v]];
    let s = 0, ws = 0; for (const [val, wt] of q) if (Number.isFinite(val)) { s += val * wt; ws += wt; }
    const elev = ws > 0 ? s / ws + toMSL(x, z) : NaN;
    out[j * g.nx + i] = Number.isFinite(elev) ? Math.max(-32000, Math.min(32000, Math.round(-elev * 10))) : -32768;
  }
  return out;
}

// Live bathymetry for a custom location (ETOPO 2022 15" via the NCEI mosaic, MSL): a Bathy over [-R, R]²
export async function fetchBathy(lat, lon, R, proj, dx = 60) {
  const pad = 1.1 * R, dLat = pad / 110540, dLon = pad / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  const n = Math.min(900, Math.ceil(2 * pad / 30));
  const src = await fetchNCEI(bbox, n, n);
  const g = { nx: Math.ceil(2 * R / dx), nz: Math.ceil(2 * R / dx), x0: -R, z0: -R, dx: 2 * R / Math.ceil(2 * R / dx) };
  const d = gridFromLatLon(src, n, n, bbox, proj, g);
  return new Bathy({ ...g, source: 'NOAA NCEI DEM global mosaic (live)', datum: 'MSL' }, d);
}
