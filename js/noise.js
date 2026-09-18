// Tiling cloud noise (Perlin-Worley shape, Worley detail) and a 2D weather map. Generated offline by
// tools/gen-noise.mjs into data/sky/*.bin; the page loads the files and only falls back to building them.
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
// ------------------------------------------------------------------ tiling noise for the clouds
function hash3(x, y, z, s) { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function perlin3(x, y, z, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10), u = f(xf), v = f(yf), w = f(zf);
  const g = (ix, iy, iz, dx, dy, dz) => {
    const hh = hash3(((ix % P) + P) % P, ((iy % P) + P) % P, ((iz % P) + P) % P, s) * 12 | 0;
    const G = GRAD[hh];
    return G[0] * dx + G[1] * dy + G[2] * dz;
  };
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u), l(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u), v),
           l(l(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u), l(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u), v), w);
}
function worley3(x, y, z, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let md = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const cx = xi + a, cy = yi + b, cz = zi + c, wx = ((cx % P) + P) % P, wy = ((cy % P) + P) % P, wz = ((cz % P) + P) % P;
    const dx = cx + hash3(wx, wy, wz, s) - x, dy = cy + hash3(wx, wy, wz, s + 1) - y, dz = cz + hash3(wx, wy, wz, s + 2) - z;
    const d = dx * dx + dy * dy + dz * dz; if (d < md) md = d;
  }
  return Math.min(1, Math.sqrt(md));
}
export function buildNoise3DData(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N, z = k / N;
    let p = 0, amp = 1, tot = 0;
    for (let o = 0; o < 4; o++) { const P = 4 << o; p += amp * perlin3(x * P, y * P, z * P, P, 3 + o); tot += amp; amp *= 0.5; }
    p = p / tot * 0.5 + 0.5;
    const w1 = 1 - worley3(x * 4, y * 4, z * 4, 4, 11), w2 = 1 - worley3(x * 8, y * 8, z * 8, 8, 17), w3 = 1 - worley3(x * 16, y * 16, z * 16, 16, 23);
    const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
    const pw = Math.max(0, Math.min(1, (p - (1 - wf)) / (1 - (1 - wf)) ));           // Perlin-Worley: billowy cells
    const d1 = 1 - worley3(x * 8, y * 8, z * 8, 8, 31), d2 = 1 - worley3(x * 16, y * 16, z * 16, 16, 37), d3 = 1 - worley3(x * 32, y * 32, z * 32, 32, 41);
    const q = ((k * N + j) * N + i) * 4;
    data[q] = Math.round(Math.max(0, Math.min(1, pw * 0.7 + wf * 0.3)) * 255);
    data[q + 1] = Math.round((d1 * 0.625 + d2 * 0.25 + d3 * 0.125) * 255);
    data[q + 2] = Math.round(wf * 255);
    data[q + 3] = 255;
  }
  return data;
}
export function buildWeatherData(N = 256) {
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / N, y = j / N;
    let c = 0, amp = 1, tot = 0, ty = 0;
    for (let o = 0; o < 5; o++) { const P = 3 << o; c += amp * perlin3(x * P, y * P, 0.5, P, 50 + o); ty += amp * perlin3(x * P, y * P, 2.5, P, 70 + o); tot += amp; amp *= 0.5; }
    const q = (j * N + i) * 4;
    data[q] = Math.round(Math.max(0, Math.min(1, c / tot * 0.9 + 0.5)) * 255);
    data[q + 1] = Math.round(Math.max(0, Math.min(1, ty / tot * 1.1 + 0.5)) * 255);
    data[q + 2] = 0; data[q + 3] = 255;
  }
  return data;
}
