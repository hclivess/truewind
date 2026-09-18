// Sky: the sun and moon where they really are (venue latitude/longitude, date and time), a physically
// based atmosphere (Rayleigh + Mie + ozone single scattering with a multiple-scattering term, computed on
// the CPU into a sky-view table), volumetric clouds ray-marched through a 3D noise field (cumulus that
// thicken with the weather, squall towers with anvils and rain shafts, high cirrus), stars and a lit moon.
// The same table and cloud field give the sunlight colour, the ambient light, fog, the water's reflections
// (an environment cube), image-based lighting for every material, and cloud shadows on the sea and land.
import * as THREE from 'three';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ astronomy (low precision, arc-minutes)
const jd = (ms) => ms / 86400000 + 2440587.5;
function horizontal(ra, dec, d, lat, lon) {
  const lst = ((280.46061837 + 360.98564736629 * d) * DEG + lon * DEG) % (2 * Math.PI);
  const H = lst - ra, phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)); // from north, eastward
  return { el, az, lst };
}
export function sunPosition(ms, lat, lon) {
  const d = jd(ms) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  return horizontal(ra, dec, d, lat, lon);
}
export function moonPosition(ms, lat, lon) {
  const d = jd(ms) - 2451545.0;
  const L = (218.316 + 13.176396 * d) * DEG, M = (134.963 + 13.064993 * d) * DEG, F = (93.272 + 13.229350 * d) * DEG;
  const l = L + 6.289 * DEG * Math.sin(M), b = 5.128 * DEG * Math.sin(F), e = 23.4397 * DEG;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  return horizontal(ra, dec, d, lat, lon);
}
// world axes: x east, y up, z south
export const dirOf = (el, az, out = new THREE.Vector3()) => out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
// equatorial (ra, dec) unit vector -> local horizon: a pure rotation, built from three basis stars
function celestialMatrix(ms, lat, lon) {
  const d = jd(ms) - 2451545.0, m = new THREE.Matrix3(), v = new THREE.Vector3();
  const col = (ra, dec) => { const h = horizontal(ra, dec, d, lat, lon); return dirOf(h.el, h.az, v.clone()); };
  const a = col(0, 0), b = col(Math.PI / 2, 0), c = col(0, Math.PI / 2);
  m.set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z);
  return m;
}

// ------------------------------------------------------------------ atmosphere
const RE = 6360e3, RA = 6460e3;
const BR = [5.802e-6, 13.558e-6, 33.1e-6], HR = 8000;           // Rayleigh scattering (1/m), scale height
const BMS = 3.996e-6, BME = 4.44e-6, HM = 1200, GM = 0.8;        // Mie scattering / extinction, scale height, anisotropy
const BO = [0.650e-6, 1.881e-6, 0.085e-6];                        // ozone absorption
function dens(h) { return [Math.exp(-h / HR), Math.exp(-h / HM), Math.max(0, 1 - Math.abs(h - 25000) / 15000)]; }
function exitDist(r, mu, R) { const b = r * mu, c = r * r - R * R, disc = b * b - c; return disc < 0 ? 0 : -b + Math.sqrt(disc); }
function hitsGround(r, mu) { const b = r * mu, c = r * r - RE * RE; return mu < 0 && b * b - c >= 0; }
// transmittance table: altitude x cos(zenith angle)
const TW = 64, TH = 48, TRANS = new Float32Array(TW * TH * 3);
(function buildTransmittance() {
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const h = (j / (TH - 1)) ** 2 * (RA - RE), mu = -0.25 + 1.25 * i / (TW - 1);
    const r = RE + h, L = exitDist(r, mu, RA), n = 24, ds = L / n;
    let oR = 0, oM = 0, oO = 0;
    for (let k = 0; k < n; k++) {
      const s = (k + 0.5) * ds, rr = Math.sqrt(r * r + s * s + 2 * r * s * mu), dd = dens(rr - RE);
      oR += dd[0] * ds; oM += dd[1] * ds; oO += dd[2] * ds;
    }
    const q = (j * TW + i) * 3, ground = hitsGround(r, mu) ? 0 : 1;
    for (let c = 0; c < 3; c++) TRANS[q + c] = ground * Math.exp(-(BR[c] * oR + BME * oM + BO[c] * oO));
  }
})();
function trans(h, mu, out) {
  const fj = Math.sqrt(Math.max(0, Math.min(1, h / (RA - RE)))) * (TH - 1), fi = Math.max(0, Math.min(1, (mu + 0.25) / 1.25)) * (TW - 1);
  const j0 = Math.min(TH - 2, fj | 0), i0 = Math.min(TW - 2, fi | 0), tj = fj - j0, ti = fi - i0;
  for (let c = 0; c < 3; c++) {
    const a = TRANS[(j0 * TW + i0) * 3 + c], b = TRANS[(j0 * TW + i0 + 1) * 3 + c], e = TRANS[((j0 + 1) * TW + i0) * 3 + c], f = TRANS[((j0 + 1) * TW + i0 + 1) * 3 + c];
    out[c] = (a * (1 - ti) + b * ti) * (1 - tj) + (e * (1 - ti) + f * ti) * tj;
  }
  return out;
}
// the sun's colour at the ground (transmittance straight up to it), per unit irradiance above the air
export function sunTransmittance(el, out = [0, 0, 0]) { return trans(10, Math.sin(el), out); }
// sky-view table: azimuth from the light (0..pi) x elevation (-0.2 .. pi/2, finer near the horizon)
export const LUT_W = 64, LUT_H = 48;
export const lutEl = (v) => -0.2 + 1.7708 * v * v;
function skyView(lightEl, scale, data, add) {
  const ls = [Math.cos(lightEl), Math.sin(lightEl), 0];            // light in the (horizontal-toward-light, up) plane
  const r0 = RE + 10, tA = [0, 0, 0], tB = [0, 0, 0];
  const n = 20;
  for (let j = 0; j < LUT_H; j++) {
    const el = lutEl((j + 0.5) / LUT_H), ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i < LUT_W; i++) {
      const az = Math.PI * (i + 0.5) / LUT_W;
      const d = [ce * Math.cos(az), se, ce * Math.sin(az)];
      const nu = d[0] * ls[0] + d[1] * ls[1] + d[2] * ls[2];
      const pR = 3 / (16 * Math.PI) * (1 + nu * nu);
      const pM = 3 / (8 * Math.PI) * ((1 - GM * GM) * (1 + nu * nu)) / ((2 + GM * GM) * Math.pow(1 + GM * GM - 2 * GM * nu, 1.5));
      let L = hitsGround(r0, se) ? Math.sqrt(r0 * r0 - RE * RE) * 1.2 : exitDist(r0, se, RA);
      L = Math.min(L, 180e3);
      const ds = L / n;
      let oR = 0, oM = 0, oO = 0;
      const acc = [0, 0, 0];
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) * ds;
        const px = d[0] * s, py = r0 + d[1] * s, pz = d[2] * s;
        const rr = Math.sqrt(px * px + py * py + pz * pz), h = rr - RE, dd = dens(h);
        oR += dd[0] * ds; oM += dd[1] * ds; oO += dd[2] * ds;
        const muL = (px * ls[0] + py * ls[1] + pz * ls[2]) / rr;
        trans(h, muL, tA);
        for (let c = 0; c < 3; c++) {
          const tv = Math.exp(-(BR[c] * oR + BME * oM + BO[c] * oO));
          const sR = BR[c] * dd[0], sM = BMS * dd[1];
          // single scattering + an isotropic multiple-scattering term (keeps twilight and shade blue)
          const ms = 0.32 * (sR + sM) * Math.max(0, Math.min(1, muL * 1.5 + 0.35)) * (0.35 + 0.65 * tA[c]);
          acc[c] += tv * ((sR * pR + sM * pM) * tA[c] + ms / (4 * Math.PI)) * ds;
        }
      }
      const q = (j * LUT_W + i) * 4;
      for (let c = 0; c < 3; c++) data[q + c] = (add ? data[q + c] : 0) + acc[c] * scale;
      data[q + 3] = 1;
    }
  }
}

// ------------------------------------------------------------------ shaders
export const SKY_LUT_GLSL = /* glsl */`
uniform sampler2D uSkyLUT; uniform vec3 uLutDir; uniform float uOvercast;
vec3 skyColor(vec3 d) {
  d = normalize(d);
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sqrt(clamp((el + 0.2) / 1.7708, 0.0, 1.0));
  vec2 dh = d.xz; float ld = length(dh); dh = ld > 1e-5 ? dh / ld : vec2(1.0, 0.0);
  vec2 sh = uLutDir.xz; float ls = length(sh); sh = ls > 1e-5 ? sh / ls : vec2(1.0, 0.0);
  float u = acos(clamp(dot(dh, sh), -1.0, 1.0)) / 3.14159265;
  vec3 c = texture2D(uSkyLUT, vec2(u, v)).rgb;
  // under a closed cloud deck the sky is a flat grey lit from above
  float g = dot(texture2D(uSkyLUT, vec2(0.5, 0.75)).rgb, vec3(0.3, 0.45, 0.25));
  return mix(c, vec3(g * 0.92, g * 0.96, g), uOvercast * 0.7);
}`;

// cloud field shared by the sky march, the reflections and the cloud shadows
export const CLOUD_GLSL = /* glsl */`
precision highp sampler3D;
uniform sampler3D uNoise; uniform sampler2D uWeather;
uniform vec2 uWOff; uniform float uCover; uniform float uCloudBase; uniform float uCloudThick; uniform float uCloudTime;
uniform vec4 uCells[4];
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
// coverage, base and top at a point; squall cells are cumulonimbus: a broad tower to ~9.5 km with an
// anvil spreading downwind at the top (cellK = inside a tower, anvil = under the anvil's reach)
vec3 cloudLayer(vec2 xz, out float cellK, out float anvil) {
  vec4 w = texture2D(uWeather, (xz + uWOff) / 36000.0);
  float cov = clamp(w.r * 1.3 - 0.5 + uCover, 0.0, 1.0);
  float base = uCloudBase, top = base + uCloudThick * (0.55 + 0.9 * w.g);
  cellK = 0.0; anvil = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 c = uCells[i]; if (c.z <= 0.0) continue;
    float d = length(xz - c.xy) / c.z;
    float k = smoothstep(1.0, 0.45, d) * c.w;
    cellK = max(cellK, k);
    cov = max(cov, smoothstep(1.15, 0.6, d) * c.w);
    top = mix(top, 9500.0, k);
    base = mix(base, base * 0.8, k);
    anvil = max(anvil, smoothstep(1.9, 1.0, d) * c.w);
  }
  if (anvil > 0.0) top = max(top, mix(top, 9700.0, anvil));
  return vec3(cov, base, top);
}
float cloudDensity(vec3 p, float detail) {
  float cellK, anvil; vec3 L = cloudLayer(p.xz, cellK, anvil);
  if (p.y < L.y || p.y > L.z) return 0.0;
  float hf = (p.y - L.y) / (L.z - L.y);
  vec3 q = vec3(p.x + uWOff.x, p.y - uCloudTime * 0.4, p.z + uWOff.y);
  // cumulus: flat base, rounded cauliflower tops
  float prof = smoothstep(0.0, 0.07, hf) * smoothstep(1.0, 0.62, hf);
  // a cell: solid tower (stretched noise so it does not break into a stack of puffs), and the anvil sheet
  float tower = cellK * smoothstep(0.0, 0.04, hf) * smoothstep(1.0, 0.9, hf);
  float sheet = anvil * smoothstep(8300.0, 8900.0, p.y) * smoothstep(9700.0, 9300.0, p.y);
  float shape = texture(uNoise, q / vec3(4200.0, 2600.0, 4200.0)).r;
  float shapeT = texture(uNoise, q / vec3(3000.0, 9000.0, 3000.0)).r;
  float d = max(remap(shape * clamp(prof, 0.0, 1.0), 1.0 - L.x, 1.0, 0.0, 1.0) * (1.0 - cellK),
                max(remap(shapeT, 0.15, 0.7, 0.0, 1.0) * tower, remap(shape, 0.2, 0.8, 0.0, 1.0) * sheet));
  if (d <= 0.0) return 0.0;
  if (detail > 0.5) {
    float det = texture(uNoise, q / 700.0 + vec3(0.0, uCloudTime * 0.00012, 0.0)).g;
    d = remap(d, (1.0 - det) * (0.35 - 0.2 * hf) * (1.0 - 0.6 * max(cellK, anvil)), 1.0, 0.0, 1.0);
  }
  return clamp(d, 0.0, 1.0) * (1.0 + 1.5 * cellK);
}
// fraction of direct sun reaching a point on the surface under the clouds
float cloudShadow(vec3 p, vec3 sunDir) {
  float cellK, anvil; vec3 L0 = cloudLayer(p.xz, cellK, anvil);
  float h = L0.y + (L0.z - L0.y) * 0.3;
  vec2 xz = p.xz + sunDir.xz / max(sunDir.y, 0.08) * (h - p.y);
  vec3 L = cloudLayer(xz, cellK, anvil);
  vec3 q = vec3(xz.x + uWOff.x, h - uCloudTime * 0.4, xz.y + uWOff.y);
  float shape = texture(uNoise, q / vec3(4200.0, 2600.0, 4200.0)).r;
  float d = remap(shape * 0.95, 1.0 - L.x, 1.0, 0.0, 1.0);
  return clamp(1.0 - 0.8 * smoothstep(0.02, 0.35, d) - 0.7 * cellK - 0.3 * anvil, 0.1, 1.0);
}`;

const DOME_VS = /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`;

// the atmosphere + clouds pass (rendered at half resolution, and into the reflection cube)
const MARCH_FS = /* glsl */`
varying vec3 vDir;
uniform vec3 uCamPos; uniform float uSteps; uniform float uFrame;
uniform sampler2D uHist; uniform mat4 uPrevVP; uniform float uHistOK;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbTop; uniform vec3 uAmbBot;
${SKY_LUT_GLSL}
${CLOUD_GLSL}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  vec3 rd = normalize(vDir);
  vec3 sky = skyColor(rd);
  float T = 1.0; vec3 L = vec3(0.0);
  float firstHit = -1.0;
  if (rd.y > 0.012) {
    // high cirrus: thin streaks drifting at ~9 km
    vec2 cp = (uCamPos.xz + rd.xz / rd.y * (9000.0 - uCamPos.y) + uWOff * 2.2) / 26000.0;
    float ci = texture(uNoise, vec3(cp.x * 1.0, 0.37, cp.y * 3.0)).b * texture2D(uWeather, cp * 0.7 + 0.3).g;
    ci = smoothstep(0.42, 0.85, ci) * 0.55 * smoothstep(0.012, 0.12, rd.y) * (0.4 + uCover);
    sky = mix(sky, uSunCol * hg(dot(rd, uSunDir), 0.6) * 1.8 + uAmbTop * 1.1, ci * 0.6);
    // cumulus layer
    float lo = uCloudBase * 0.72, hi = uCells[0].z > 0.0 || uCells[1].z > 0.0 ? 9600.0 : uCloudBase + uCloudThick * 1.5;
    float t0 = max(0.0, (lo - uCamPos.y) / rd.y), t1 = (hi - uCamPos.y) / rd.y;
    t1 = min(t1, t0 + 30000.0);
    if (t0 < 90000.0) {
      float n = uSteps, dt = (t1 - t0) / n;
      float t = t0 + dt * hash12(gl_FragCoord.xy + fract(uFrame * 0.618) * 97.0);
      float cth = dot(rd, uSunDir);
      float phase = mix(hg(cth, 0.78), hg(cth, -0.2), 0.35);
      for (int i = 0; i < 96; i++) {
        if (float(i) >= n || T < 0.02) break;
        vec3 p = uCamPos + rd * t;
        float d = cloudDensity(p, 0.0);
        if (d <= 0.003) { t += dt * (firstHit < 0.0 ? 1.3 : 1.0); continue; }   // empty air: stride
        d = cloudDensity(p, 1.0);
        if (d > 0.003) {
          if (firstHit < 0.0) firstHit = t;
          float sig = d * 0.045;
          // light march toward the sun
          float od = 0.0, sl = 60.0; vec3 lp = p;
          for (int k = 0; k < 4; k++) { lp += uSunDir * sl; od += cloudDensity(lp, 0.0) * sl; sl *= 2.2; }
          float Tl = exp(-od * 0.045) + 0.25 * exp(-od * 0.01);          // beer + multiple-scattering tail
          float powder = 1.0 - exp(-d * 2.5);
          float cellK, anv; vec3 Ly = cloudLayer(p.xz, cellK, anv);
          float hf = clamp((p.y - Ly.y) / (Ly.z - Ly.y), 0.0, 1.0);
          vec3 amb = mix(uAmbBot, uAmbTop, hf) * (1.0 - 0.55 * cellK);
          vec3 S = uSunCol * Tl * phase * mix(1.0, powder, 0.6) * 9.0 + amb * (0.55 + 0.45 * hf);
          float a = exp(-sig * dt);
          L += T * S * (1.0 - a);
          T *= a;
        }
        t += dt;
      }
      // aerial perspective: distant clouds sink into the haze
      float haze = firstHit > 0.0 ? exp(-firstHit / 38000.0) : 1.0;
      L = mix(sky * (1.0 - T), L, haze);
    }
  }
  vec3 col = sky * T + L;
  // rain shafts under squall cells
  for (int i = 0; i < 4; i++) {
    vec4 c = uCells[i]; if (c.z <= 0.0) continue;
    vec2 o = uCamPos.xz - c.xy; vec2 dh = normalize(rd.xz + 1e-5);
    float tc = max(0.0, -dot(o, dh)); float dist = length(o + dh * tc);
    float hgt = rd.y > 0.0 ? tc * rd.y / max(length(rd.xz), 1e-3) : 0.0;
    float shaft = smoothstep(0.45 * c.z, 0.12 * c.z, dist) * smoothstep(uCloudBase * 0.8, 0.0, hgt) * smoothstep(40000.0, 2000.0, tc) * c.w;
    col = mix(col, uAmbBot * 0.8, clamp(shaft * 0.55, 0.0, 0.8));
    T *= 1.0 - clamp(shaft * 0.6, 0.0, 0.9);
  }
  vec4 cur = vec4(col, T);
  // temporal accumulation: last frame's sky, reprojected by direction (exact for a sky at infinity)
  if (uHistOK > 0.5) {
    vec4 c = uPrevVP * vec4(rd, 0.0);
    if (c.w > 0.0) {
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (all(greaterThan(uv, vec2(0.002))) && all(lessThan(uv, vec2(0.998)))) {
        vec4 h = texture2D(uHist, uv);
        cur = mix(h, cur, 0.18 + 0.5 * clamp(abs(h.a - cur.a) * 2.0, 0.0, 1.0));
      }
    }
  }
  gl_FragColor = cur;
}`;

// full-resolution composite: the half-resolution sky, then the sun disk, moon and stars (behind the clouds)
const COMP_FS = /* glsl */`
varying vec3 vDir;
uniform sampler2D uSkyTex; uniform vec2 uRes;
uniform vec3 uSunDir; uniform vec3 uSunDisk; uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform float uStars; uniform mat3 uCel;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 rd = normalize(vDir);
  // the half-resolution sky, softened with a small tent filter (hides the march's dither)
  vec2 uv = gl_FragCoord.xy / uRes, px = 1.0 / uRes;
  vec4 s = texture2D(uSkyTex, uv) * 0.4 + (texture2D(uSkyTex, uv + px * vec2(1.5, 0.5)) + texture2D(uSkyTex, uv + px * vec2(-0.5, 1.5))
         + texture2D(uSkyTex, uv + px * vec2(-1.5, -0.5)) + texture2D(uSkyTex, uv + px * vec2(0.5, -1.5))) * 0.15;
  vec3 col = s.rgb;
  float T = s.a * smoothstep(-0.01, 0.01, rd.y);
  // sun: limb-darkened disk
  float cs = dot(rd, uSunDir), r = acos(clamp(cs, -1.0, 1.0)) / 0.0048;
  if (r < 1.0) col += uSunDisk * (0.4 + 0.6 * sqrt(1.0 - r * r)) * T;
  // moon: a sphere lit by the sun, with maria
  float cm = dot(rd, uMoonDir), rm = acos(clamp(cm, -1.0, 1.0)) / 0.0047;
  if (rm < 1.0 && uMoonCol.b > 0.0) {
    vec3 up = abs(uMoonDir.y) < 0.99 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    vec3 ax = normalize(cross(up, uMoonDir)), ay = cross(uMoonDir, ax);
    vec2 q = vec2(dot(rd - uMoonDir * cm, ax), dot(rd - uMoonDir * cm, ay)) / 0.0047;
    vec3 n = normalize(-uMoonDir * sqrt(max(0.0, 1.0 - dot(q, q))) + ax * q.x + ay * q.y);
    float lit = max(0.0, dot(n, uSunDir));
    float maria = 0.75 + 0.25 * sin(q.x * 5.0 + 1.3) * sin(q.y * 4.0 - 0.7) - 0.15 * step(0.55, fract(sin(dot(floor(q * 3.0), vec2(12.9, 78.2))) * 43758.5));
    col += uMoonCol * (lit * maria + 0.02) * T;
  }
  // stars, fixed on the celestial sphere and turning with it
  if (uStars > 0.0 && rd.y > 0.0) {
    vec3 e = transpose(uCel) * rd;
    vec3 g = e * 420.0, c = floor(g);
    float h = h13(c);
    if (h > 0.985) {
      vec3 sp = c + vec3(h13(c + 1.7), h13(c + 3.1), h13(c + 5.3));
      float d = length(g - sp);
      float mag = pow(fract(h * 71.3), 6.0);
      col += vec3(0.8 + 0.2 * fract(h * 13.0), 0.85, 1.0 - 0.2 * fract(h * 7.0)) * smoothstep(0.35, 0.0, d) * (0.3 + 6.0 * mag) * uStars * T;
    }
    col += vec3(0.02, 0.022, 0.03) * uStars * T * smoothstep(0.35, 0.0, abs(dot(e, normalize(vec3(-0.87, -0.2, -0.45))))) * 0.5; // the Milky Way's glow
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ cloud shadows (and ground detail) on standard materials
// The scene has one sun light; its intensity already carries the cloud shade over the player's boat, so a
// patched material rescales the light by (shade here / shade at the player) — land and buildings get the
// moving cloud shadows that sweep over the sea.
export function withCloudShadows(mat, sky, opts = {}) {
  const U = sky.U;
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uNoise', 'uWeather', 'uWOff', 'uCover', 'uCloudBase', 'uCloudThick', 'uCloudTime', 'uCells']) sh.uniforms[k] = U[k];
    sh.uniforms.uLightDirW = { value: sky.lightV }; sh.uniforms.uPlayerShade = sky.playerShadeU;
    sh.vertexShader = 'varying vec3 vCSWorld;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cswp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cswp = instanceMatrix * cswp;
      #endif
      vCSWorld = (modelMatrix * cswp).xyz;`);
    const lights = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );',
      'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= csShade;');
    let fs = 'varying vec3 vCSWorld; uniform vec3 uLightDirW; uniform float uPlayerShade;\n' + CLOUD_GLSL + '\n' + sh.fragmentShader;
    fs = fs.replace('#include <lights_fragment_begin>', `float csShade = clamp(cloudShadow(vCSWorld, uLightDirW) / max(uPlayerShade, 0.1), 0.0, 1.0 / max(uPlayerShade, 0.1));\n` + lights);
    if (opts.ground) {
      // ground detail: fields, scrub and bare patches at several scales, so the land is not a flat green sheet
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
        float g1 = texture(uNoise, vec3(vCSWorld.xz / 1800.0, 0.21)).r, g2 = texture(uNoise, vec3(vCSWorld.xz / 260.0, 0.63)).g, g3 = texture(uNoise, vec3(vCSWorld.xz / 38.0, 0.37)).g;
        float lum0 = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        vec3 dry = vec3(0.55, 0.5, 0.36) * lum0 * 1.6, dark = diffuseColor.rgb * vec3(0.62, 0.72, 0.6);
        float veg = smoothstep(0.2, 0.9, diffuseColor.g - diffuseColor.r + 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(dark, dry, smoothstep(0.3, 0.7, g2)), veg * (0.35 + 0.55 * g1));
        diffuseColor.rgb *= 0.78 + 0.4 * g3;`);
    }
    sh.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'cs' + (opts.ground ? 'g' : '');
  mat.needsUpdate = true;
  return mat;
}

// ------------------------------------------------------------------ the system
const E_SUN = 3.6;          // top-of-atmosphere sun irradiance in scene units (a noon sun lights at ~3)
const SKY_K = 3.2;          // sky radiance -> scene units
const SUN_DISK = 60;        // disk radiance relative to irradiance (small disk, very bright)
const MOON_E = 0.02;        // moonlight relative to sunlight — far brighter than nature (film 'day for night') so a night is sailable

export class SkySystem {
  constructor(renderer, scene, opts = {}) {
    this.r = renderer; this.scene = scene; this.low = !!opts.low;
    // cloud noise volumes: precomputed files, loaded in the background (clear sky until they arrive)
    const mk3 = (N, data) => { const t = new THREE.Data3DTexture(data, N, N, N); t.format = THREE.RGBAFormat; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
    const mk2 = (N, data) => { const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
    const noise = this.noise = { N: 2, data: new Uint8Array(2 * 2 * 2 * 4) }; noise.tex = mk3(2, noise.data);
    const wx = this.wx = { N: 2, data: new Uint8Array(2 * 2 * 4) }; wx.tex = mk2(2, wx.data);
    const load = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url); return new Uint8Array(await r.arrayBuffer()); };
    Promise.all([load('data/sky/noise3d-64.bin'), load('data/sky/weather-256.bin')]).then(([n3, w2]) => {
      noise.N = 64; noise.data = n3; noise.tex = mk3(64, n3); this.U.uNoise.value = noise.tex;
      wx.N = 256; wx.data = w2; wx.tex = mk2(256, w2); this.U.uWeather.value = wx.tex;
      this.cubeAge = 999; this.envAge = 999;
    }).catch(async (e) => {
      console.warn('cloud noise files missing, building them', e);
      const { buildNoise3DData, buildWeatherData } = await import('./noise.js');
      const n3 = buildNoise3DData(48), w2 = buildWeatherData(256);
      noise.N = 48; noise.data = n3; noise.tex = mk3(48, n3); this.U.uNoise.value = noise.tex;
      wx.N = 256; wx.data = w2; wx.tex = mk2(256, w2); this.U.uWeather.value = wx.tex;
    });
    this.lutData = new Float32Array(LUT_W * LUT_H * 4);
    this.lutTex = new THREE.DataTexture(this.lutData, LUT_W, LUT_H, THREE.RGBAFormat, THREE.FloatType);
    this.lutTex.minFilter = this.lutTex.magFilter = THREE.LinearFilter; this.lutTex.wrapS = THREE.ClampToEdgeWrapping; this.lutTex.wrapT = THREE.ClampToEdgeWrapping;
    this.lightV = new THREE.Vector3(0, 1, 0);
    this.sunDir = new THREE.Vector3(0, 1, 0); this.moonDir = new THREE.Vector3(0, -1, 0); this.lutDir = new THREE.Vector3(0, 1, 0);
    // shared uniforms: the same objects feed the sky passes, the water and the terrain
    this.U = {
      uSkyLUT: { value: this.lutTex }, uLutDir: { value: this.lutDir }, uOvercast: opts.overcastU || { value: 0 },
      uNoise: { value: noise.tex }, uWeather: { value: wx.tex }, uWOff: { value: new THREE.Vector2() },
      uCover: { value: 0.4 }, uCloudBase: { value: 1100 }, uCloudThick: { value: 1300 }, uCloudTime: { value: 0 },
      uCells: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) },
      uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Vector3(1, 1, 1) },
      uAmbTop: { value: new THREE.Vector3(0.3, 0.4, 0.6) }, uAmbBot: { value: new THREE.Vector3(0.2, 0.22, 0.25) },
      uCamPos: { value: new THREE.Vector3() }, uFrame: { value: 0 },
    };
    const marchMat = (steps) => new THREE.ShaderMaterial({
      uniforms: { ...this.U, uSteps: { value: steps }, uHist: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uHistOK: { value: 0 } }, vertexShader: DOME_VS, fragmentShader: MARCH_FS,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    // half-resolution pass
    this.rtA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = this.rtA.clone(); this.rt = this.rtA;
    this.marchScene = new THREE.Scene();
    this.marchDome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), marchMat(this.low ? 28 : 56));
    this.marchDome.frustumCulled = false; this.marchScene.add(this.marchDome);
    // reflection / lighting cube
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.low ? 64 : 128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(1, 100, this.cubeRT);
    this.cubeScene = new THREE.Scene();
    const cd = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), marchMat(this.low ? 16 : 28));
    cd.frustumCulled = false; this.cubeScene.add(cd); this.cubeScene.add(this.cubeCam);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    // composite in the main scene, behind everything
    this.compU = {
      uSkyTex: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(1, 1) },
      uSunDir: { value: this.sunDir }, uSunDisk: { value: new THREE.Vector3() }, uMoonDir: { value: this.moonDir }, uMoonCol: { value: new THREE.Vector3() },
      uStars: { value: 0 }, uCel: { value: new THREE.Matrix3() },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.compU, vertexShader: DOME_VS, fragmentShader: COMP_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    }));
    this.dome.frustumCulled = false; this.dome.renderOrder = -1000;
    scene.add(this.dome);
    this.playerShadeU = { value: 1 };
    this.frame = 0; this.lutKey = null; this.cubeAge = 99; this.envAge = 99;
    this.sunT = [1, 1, 1];
    this.exposure = 0.95;
  }
  resize(w, h, pr) {
    const f = this.low ? 0.35 : 0.5;
    for (const t of [this.rtA, this.rtB]) t.setSize(Math.max(2, Math.round(w * pr * f)), Math.max(2, Math.round(h * pr * f)));
    this.histOK = false;
    this.compU.uRes.value.set(w * pr, h * pr);
  }
  // clouds from the weather: cover 0..1, squall cells [{x,z,R}], wind drift
  setWeather(cover, cells, drift, t, windKt) {
    const U = this.U;
    U.uCover.value += (cover - U.uCover.value) * 0.02;
    U.uWOff.value.copy(drift); U.uCloudTime.value = t;
    // stronger wind: flatter, lower stratocumulus; light air: tall fair-weather cumulus
    const base = 1250 - Math.min(500, windKt * 12), thick = 1500 - Math.min(700, windKt * 16) + cover * 600;
    U.uCloudBase.value += (base - U.uCloudBase.value) * 0.02; U.uCloudThick.value += (thick - U.uCloudThick.value) * 0.02;
    for (let i = 0; i < 4; i++) { const c = cells[i]; U.uCells.value[i].set(c ? c.x : 0, c ? c.z : 0, c ? Math.max(2500, c.R * 3.5) : 0, c ? 1 : 0); }
  }
  // where are the sun and moon, and what does the sky look like
  setTime(ms, lat, lon) {
    const s = sunPosition(ms, lat, lon), m = moonPosition(ms, lat, lon);
    dirOf(s.el, s.az, this.sunDir); dirOf(m.el, m.az, this.moonDir);
    this.sunEl = s.el; this.moonEl = m.el;
    this.moonPhase = (1 - this.sunDir.dot(this.moonDir)) / 2;         // illuminated fraction
    this.compU.uCel.value.copy(celestialMatrix(ms, lat, lon));
    // recompute the sky table when the light has moved (~0.15 degrees)
    const useMoon = s.el < -10 * DEG;
    const key = useMoon ? `m${Math.round(m.el / DEG * 6)}_${Math.round(this.moonPhase * 30)}` : `s${Math.round(s.el / DEG * 6)}`;
    if (key !== this.lutKey) {
      this.lutKey = key;
      const d = this.lutData;
      if (!useMoon) skyView(s.el, E_SUN * SKY_K, d, false);
      else skyView(Math.max(m.el, -0.1), E_SUN * SKY_K * MOON_E * (0.1 + this.moonPhase), d, false);
      // night airglow and starlight floor
      for (let i = 0; i < d.length; i += 4) { d[i] += 0.0025; d[i + 1] += 0.0033; d[i + 2] += 0.0055; }
      this.lutTex.needsUpdate = true;
      // a big jump in the light (new time of day): refresh reflections and lighting at once
      if (this._lastEl === undefined || Math.abs((useMoon ? m.el : s.el) - this._lastEl) > 2 * DEG) this.envAge = 999;
      this._lastEl = useMoon ? m.el : s.el;
      this.cubeAge = 99;
    }
    this.lutDir.copy(useMoon ? this.moonDir : this.sunDir);
    sunTransmittance(s.el, this.sunT);
  }
  // the colour of the sky toward a direction, from the CPU copy of the table (for fog and ambient)
  sample(d, out = [0, 0, 0]) {
    const el = Math.asin(Math.max(-1, Math.min(1, d.y))), v = Math.sqrt(Math.max(0, Math.min(1, (el + 0.2) / 1.7708)));
    const hx = d.x, hz = d.z, hl = Math.hypot(hx, hz) || 1, sx = this.lutDir.x, sz = this.lutDir.z, sl = Math.hypot(sx, sz) || 1;
    const u = Math.acos(Math.max(-1, Math.min(1, (hx * sx + hz * sz) / hl / sl))) / Math.PI;
    const i = Math.min(LUT_W - 1, u * LUT_W | 0), j = Math.min(LUT_H - 1, v * LUT_H | 0), q = (j * LUT_W + i) * 4;
    out[0] = this.lutData[q]; out[1] = this.lutData[q + 1]; out[2] = this.lutData[q + 2];
    return out;
  }
  // cloud shadow at a point (CPU twin of the GLSL, for the sunlight on the boats)
  shadowAt(x, z) {
    const U = this.U, sd = this.sunDir; if (sd.y <= 0.02) return 1;
    const wN = this.wx.N, w = this.wx.data;
    const h = U.uCloudBase.value + U.uCloudThick.value * 0.3;
    const px = x + sd.x / Math.max(sd.y, 0.08) * h, pz = z + sd.z / Math.max(sd.y, 0.08) * h;
    const wu = (((px + U.uWOff.value.x) / 36000) % 1 + 1) % 1, wv = (((pz + U.uWOff.value.y) / 36000) % 1 + 1) % 1;
    const wq = ((wv * wN | 0) * wN + (wu * wN | 0)) * 4;
    let cov = Math.max(0, Math.min(1, w[wq] / 255 * 1.3 - 0.5 + U.uCover.value));
    let cellK = 0; for (const c of U.uCells.value) if (c.z > 0) { const dd = Math.hypot(x - c.x, z - c.y) / c.z; cellK = Math.max(cellK, Math.max(0, Math.min(1, (1.9 - dd) / 0.9))); }
    const N = this.noise.N, nd = this.noise.data;
    const f = (a, s) => (((a / s) % 1 + 1) % 1) * N | 0;
    const nq = ((f(h - U.uCloudTime.value * 0.4, 2600) * N + f(pz + U.uWOff.value.y, 4200)) * N + f(px + U.uWOff.value.x, 4200)) * 4;
    const shape = nd[nq] / 255;
    const d = (shape * 0.95 - (1 - cov)) / Math.max(1e-3, cov);
    const s = Math.max(0, Math.min(1, (d - 0.02) / 0.33));
    return Math.max(0.1, 1 - 0.8 * s * s * (3 - 2 * s) - 0.7 * cellK);
  }
  update(camera, t, light, hemi, overcast) {
    const U = this.U, cp = camera.position;
    this.frame++;
    // keep the frame rate: fewer march steps when frames run long, more when there is headroom
    const now = performance.now(), ft = this._lastT ? now - this._lastT : 16; this._lastT = now;
    this.ft = this.ft ? this.ft * 0.95 + Math.min(100, ft) * 0.05 : 16;
    if (this.autoQ !== false && this.frame % 30 === 0) {
      const st = this.marchDome.material.uniforms.uSteps;
      const max = this.low ? 32 : 64, min = 16;
      if (this.ft > 24 && st.value > min) st.value -= 4; else if (this.ft < 15 && st.value < max) st.value += 4;
    }
    U.uCamPos.value.copy(cp); U.uFrame.value = this.frame;
    this.marchDome.position.copy(cp); this.dome.position.copy(cp);
    // sunlight at the ground, ambient from the table, moonlight at night
    const sEl = this.sunEl ?? 0.5, sT = this.sunT;
    const sunUp = Math.max(0, Math.min(1, (sEl + 0.01) / 0.03));
    U.uSunCol.value.set(sT[0], sT[1], sT[2]).multiplyScalar(E_SUN * 0.2 * sunUp);
    const mUp = Math.max(0, Math.min(1, (this.moonEl + 0.01) / 0.03)) * (sEl < -0.05 ? 1 : 0);
    if (sunUp <= 0 && mUp > 0) U.uSunCol.value.set(0.55, 0.62, 0.8).multiplyScalar(E_SUN * 0.2 * MOON_E * (0.1 + this.moonPhase) * mUp);
    const up = this.sample(new THREE.Vector3(0, 1, 0)), hz = this.sample(new THREE.Vector3(1, 0.05, 0.3).normalize());
    U.uAmbTop.value.set(up[0], up[1], up[2]).multiplyScalar(2.2).lerp(new THREE.Vector3(hz[0], hz[1], hz[2]).multiplyScalar(2.2), 0.3);
    U.uAmbBot.value.copy(U.uAmbTop.value).multiplyScalar(0.55);
    this.compU.uSunDisk.value.set(sT[0], sT[1], sT[2]).multiplyScalar(E_SUN * SUN_DISK * sunUp);
    this.compU.uMoonCol.value.set(0.9, 0.9, 0.85).multiplyScalar(this.moonEl > -0.02 ? 0.05 + 1.2 * Math.max(0, -sEl) : 0);
    this.compU.uStars.value = Math.max(0, Math.min(1, (-sEl - 6 * DEG) / (8 * DEG))) * (1 - overcast);
    // the scene's lights: the sun (or moon), dimmed by cloud over the player
    const useMoon = sunUp <= 0;
    const L = useMoon ? this.moonDir : this.sunDir;
    this.lightDir = L; this.lightV.copy(L);
    const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const cs = this.shadowAt(this._px ?? 0, this._pz ?? 0);
    this.playerShadeU.value = cs;
    const shade = cs * (1 - 0.7 * overcast);
    if (!useMoon) {
      const l = lum(sT);
      light.color.setRGB(sT[0] / l, sT[1] / l, sT[2] / l);
      light.intensity = E_SUN * l * sunUp * shade;
    } else {
      light.color.setRGB(0.6, 0.7, 1.0);
      light.intensity = E_SUN * MOON_E * (0.1 + this.moonPhase) * 1.5 * mUp * shade;
    }
    // exposure follows the light like an eye does (a moonlit night reads as a dark blue night)
    const adapt = lum(up) * 3.0 + (useMoon ? light.intensity * 0.5 : light.intensity * Math.max(0.15, L.y)) * 0.35;
    const target = Math.max(0.55, Math.min(16, 0.95 * Math.pow(0.62 / Math.max(1e-5, adapt), 0.72)));
    this.exposure += (target - this.exposure) * 0.05;
    this.r.toneMappingExposure = this.exposure;
    if (hemi) { hemi.intensity = this.envRT ? 0.0 : 0.5; }
    // passes: half-resolution sky, then (every few frames) the reflection cube and the lighting environment
    const r = this.r, prevRT = r.getRenderTarget(), prevAC = r.autoClear;
    const mu = this.marchDome.material.uniforms, hist = this.rt, out = this.rt === this.rtA ? this.rtB : this.rtA;
    mu.uHist.value = hist.texture; mu.uHistOK.value = this.histOK && this.lutKey === this._histKey ? 1 : 0;
    r.setRenderTarget(out); r.render(this.marchScene, camera); r.setRenderTarget(prevRT);
    this.rt = out; this.compU.uSkyTex.value = out.texture; this.histOK = true; this._histKey = this.lutKey;
    camera.updateMatrixWorld();
    const vr = (this._vr || (this._vr = new THREE.Matrix4())).copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
    mu.uPrevVP.value.multiplyMatrices(camera.projectionMatrix, vr);
    this.cubeAge++; this.envAge++;
    if (this.cubeAge > (this.low ? 30 : 12)) {
      this.cubeAge = 0;
      this.cubeCam.position.set(cp.x, Math.max(2, cp.y), cp.z);
      this.cubeScene.children[0].position.copy(this.cubeCam.position);
      this.cubeCam.update(r, this.cubeScene);
      if (this.envAge > (this.low ? 240 : 90)) {
        this.envAge = 0;
        const next = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT || undefined);
        this.envRT = next; this.scene.environment = next.texture;
      }
    }
    r.autoClear = prevAC;
    // fog: the horizon colour
    return hz;
  }
}
