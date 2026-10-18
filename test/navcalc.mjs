// Navigation arithmetic (js/nav.js Nav.state, js/world.js makeProjection) against closed forms and the geodesy:
//  1. BRG / DTW / VMC / time to go / XTE (sign: + right of the track) for set geometries
//  2. COG / SOG: the boat's water track plus the stream (vector sum), through the physics' own ground velocity
//  3. the steering compass: compass = true - variation - deviation (the five-coefficient curve)
//  4. the GPS error model: the fix wanders ~2.5 m rms a side with a ~60 s correlation, the Doppler velocity noise
//     0.026 m/s a side (0.05 kn), so a stopped boat's SOG reads ~0.07 kn on average
//  5. the local projection against WGS84: the scale in each direction at the venue's centre (meridional and
//     prime-vertical radii of curvature) and the distance error out to the map's edge (Vincenty's inverse)
// node test/navcalc.mjs   (exits non-zero on a failed check)
import './lib/no-three.mjs';
import { suite } from './lib/check.mjs';
const { Nav, deviation } = await import('../js/nav.js');
const { makeProjection, VENUES, MAP_RADIUS } = await import('../js/world.js');
const { Boat, CLASSES, makeSteadyEnv } = await import('../js/physics.js');
const { mulberry32 } = await import('../js/env.js');
const DEG = Math.PI / 180, KT = 1852 / 3600;
const S = suite('navcalc');
globalThis.document = globalThis.document || { querySelector: () => null, getElementById: () => null };

// a Nav without its canvases: only what state() and update() read
function makeNav(player, target = null, venue = { lat: 50.772, lon: -1.285 }) {
  const n = Object.create(Nav.prototype);
  n.g = { player, boats: [player], navTarget: () => target, race: null };
  n.proj = makeProjection(venue.lat, venue.lon); n.var = 0; n.gps = null; n.world = { depthAt: () => 20 };
  n.track = []; n.solid = []; n.hazards = []; n.chartOpen = false; n.tape = null; n.acc = 0; n.chartAcc = 0;
  return n;
}
const fake = (x, z, psi, vgx, vgz, cls = CLASSES.sportboat) => ({ x, z, psi, vgx, vgz, cls });
const wrapDeg = (a) => ((a % 360) + 540) % 360 - 180;

// ---------------------------------------------------------------- 1. BRG, DTW, VMC, TTG, XTE
{
  // waypoint 1000 m east and 1000 m north of the boat (z is south): bearing 045 T, 1414.2 m
  const b = fake(0, 0, 0, 0, -3);                          // heading and making good due north at 3 m/s
  const nav = makeNav(b, { x: 1000, z: -1000 });
  nav.origin = { x: 0, z: 0 };
  const s = nav.state();
  S.near({ quantity: 'BRG to a waypoint 1 km E, 1 km N', measured: s.brg / DEG, expected: 45, tol: 1e-6, unit: 'deg', source: 'plane bearing atan2(dE, dN)' });
  S.near({ quantity: 'DTW to it', measured: s.dtw, expected: Math.SQRT2 * 1000, tol: 1e-6, unit: 'm', source: 'Pythagoras' });
  S.near({ quantity: 'VMC making north at 3 m/s', measured: s.vmc, expected: 3 * Math.cos(45 * DEG), tol: 1e-9, unit: 'm/s', source: 'VMC = SOG cos(COG - BRG)' });
  S.near({ quantity: 'time to go at that VMC', measured: s.ttg, expected: 1000 * Math.SQRT2 / (3 * Math.SQRT1_2), tol: 1e-6, unit: 's', source: 'TTG = DTW / VMC' });
  // the boat 30 m east of a track due north from the origin: 30 m right of it
  const b2 = fake(30, -500, 0, 0, -3), n2 = makeNav(b2, { x: 0, z: -1000 }); n2.origin = { x: 0, z: 0 };
  const s2 = n2.state();
  S.near({ quantity: 'XTE 30 m east of a northbound track', measured: s2.xte, expected: 30, tol: 1e-9, unit: 'm', source: 'cross product; + = right of the track (nav.js convention)' });
  const b3 = fake(-12, -500, 0, 0, -3), n3 = makeNav(b3, { x: 0, z: -1000 }); n3.origin = { x: 0, z: 0 };
  S.near({ quantity: 'XTE 12 m west of it', measured: n3.state().xte, expected: -12, tol: 1e-9, unit: 'm', source: 'cross product' });
  // a southbound track: east is now to the left
  const b4 = fake(20, 500, 180 * DEG, 0, 3), n4 = makeNav(b4, { x: 0, z: 1000 }); n4.origin = { x: 0, z: 0 };
  S.near({ quantity: 'XTE 20 m east of a southbound track', measured: n4.state().xte, expected: -20, tol: 1e-9, unit: 'm', source: 'cross product (left of a southbound track)' });
  // sailing away from the mark: no ETA
  const b5 = fake(0, 0, 180 * DEG, 0, 3), n5 = makeNav(b5, { x: 0, z: -1000 });
  S.ok(n5.state().ttg === Infinity, 'no time to go while VMC is negative', { measured: String(n5.state().ttg), expected: 'Infinity' });
}

// ---------------------------------------------------------------- 2. COG / SOG with the stream, through the physics
{
  const env = makeSteadyEnv(0.01);
  const cur = { x: 1.0, z: 0 };                             // 1 m/s setting east (~1.9 kn)
  env.current.at = (x, z, o) => { o.x = cur.x; o.z = cur.z; return o; };
  const b = new Boat('sportboat', { sailModel: 'strip', rigStructure: false });
  b.reset(0, 0, 0); b.u = 3; b.v = 0.2;                     // 3 m/s through the water heading north, 0.2 m/s leeway to starboard
  b.step(1e-6, env, 0);
  const n = makeNav(b), s = n.state();
  // water track: u along the bow (north), v to starboard (east); plus the stream
  const ve = 0.2 + cur.x, vn = 3;
  S.near({ quantity: 'SOG heading N at 3 m/s, 0.2 m/s leeway, 1 m/s stream to E', measured: s.sog, expected: Math.hypot(ve, vn), tol: 1e-4, unit: 'm/s', source: 'vector sum of the water track and the stream' });
  S.near({ quantity: 'COG, same', measured: s.cog / DEG, expected: Math.atan2(ve, vn) / DEG, tol: 0.01, unit: 'deg', source: 'vector sum' });
  S.near({ quantity: 'position advance over 1 s of stream (dx)', measured: (() => { const x0 = b.x; b.step(1 / 120, env, 0); return (b.x - x0) * 120; })(), expected: ve, tol: 0.02, unit: 'm/s', source: 'dead reckoning with the set' });
}

// ---------------------------------------------------------------- 3. the compass
{
  const b = fake(0, 0, 100 * DEG, 0, 0, CLASSES.blackwatch), n = makeNav(b); n.var = -2.5 * DEG;   // 2.5 deg W
  const s = n.state(), dev = deviation(b.cls, b.psi - n.var);
  S.near({ quantity: 'compass heading, 100 T, var 2.5 W', measured: s.hdgC / DEG, expected: 100 + 2.5 - dev / DEG, tol: 1e-9, unit: 'deg', source: 'C = T - V - D (V, D east positive; Admiralty Manual of Navigation)' });
  // the deviation card: a GRP boat with an engine swings a degree or two, never more than ~3
  let mx = 0; for (let h = 0; h < 360; h += 5) mx = Math.max(mx, Math.abs(deviation(CLASSES.blackwatch, h * DEG) / DEG));
  S.within({ quantity: 'largest deviation of a GRP keelboat with an engine', measured: mx, lo: 0.3, hi: 3, unit: 'deg', source: 'compass adjusting practice: a well-placed GRP yacht compass within 1-3 deg' });
  // a mean of the deviation card over all headings is its A coefficient
  let m = 0; for (let h = 0; h < 360; h++) m += deviation(CLASSES.blackwatch, h * DEG) / DEG / 360;
  S.near({ quantity: 'deviation card mean over 360 deg (coefficient A)', measured: m, expected: 0.3, tol: 1e-6, unit: 'deg', source: 'Fourier: mean of A + B sin + C cos + D sin2 + E cos2 = A' });
}

// ---------------------------------------------------------------- 4. GPS error model
{
  const b = fake(0, 0, 0, 0, 0), n = makeNav(b);
  n.gps = { ex: 0, ez: 0, ev: 0, rnd: mulberry32(12345), acc: 0 };
  const dt = 0.2, N = Math.round(6 * 3600 / dt);            // six hours of fixes at 5 Hz
  const ex = new Float64Array(N); let s2 = 0, sog = 0;
  for (let i = 0; i < N; i++) { n.update(dt); ex[i] = n.gps.ex; s2 += n.gps.ex ** 2 + n.gps.ez ** 2; sog += n.state().sog; }
  const rms = Math.sqrt(s2 / (2 * N));
  S.near({ quantity: 'GPS fix error rms per axis', measured: rms, expected: 2.5, tol: 0.2, rel: true, unit: 'm', source: 'nav.js model; 2.5 m a side is 6 m 95% horizontal, inside the FAA GPS SPS Performance Standard (2020) 8 m' });
  // lag-60 s autocorrelation of a first-order Gauss-Markov process with tau 60 s: e^-1
  const L = Math.round(60 / dt); let c0 = 0, cL = 0;
  for (let i = 0; i < N - L; i++) { c0 += ex[i] * ex[i]; cL += ex[i] * ex[i + L]; }
  S.near({ quantity: 'GPS error autocorrelation at 60 s', measured: cL / c0, expected: Math.exp(-1), tol: 0.12, unit: '', source: 'Gauss-Markov, tau 60 s: rho(tau) = e^-1' });
  // a stopped boat's SOG from Doppler noise sigma 0.026 m/s per axis: Rayleigh mean sigma sqrt(pi/2)
  S.near({ quantity: 'SOG shown on a stopped boat (mean)', measured: sog / N / KT, expected: 0.026 * Math.sqrt(Math.PI / 2) / KT, tol: 0.1, rel: true, unit: 'kn', source: 'Rayleigh mean of 2-D Gaussian velocity noise (0.026 m/s a side)' });
}

// ---------------------------------------------------------------- 5. the local projection against WGS84
{
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const Mr = (p) => a * (1 - e2) / (1 - e2 * Math.sin(p) ** 2) ** 1.5, Nr = (p) => a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  // Vincenty's inverse on the WGS84 ellipsoid (metres)
  function vincenty(la1, lo1, la2, lo2) {
    const b = a * (1 - f), L = (lo2 - lo1) * DEG, U1 = Math.atan((1 - f) * Math.tan(la1 * DEG)), U2 = Math.atan((1 - f) * Math.tan(la2 * DEG));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, it = 0, sS, cS, sig, ca2, c2m;
    do {
      const sl = Math.sin(lam), cl = Math.cos(lam);
      sS = Math.hypot(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl); if (sS === 0) return 0;
      cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
      const sa = cU1 * cU2 * sl / sS; ca2 = 1 - sa * sa; c2m = ca2 ? cS - 2 * sU1 * sU2 / ca2 : 0;
      const C = f / 16 * ca2 * (4 + f * (4 - 3 * ca2)), prev = lam;
      lam = L + (1 - C) * f * sa * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
      if (Math.abs(lam - prev) < 1e-12) break;
    } while (++it < 200);
    const u2 = ca2 * (a * a - b * b) / (b * b), A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    const dS = B * sS * (c2m + B / 4 * (cS * (-1 + 2 * c2m * c2m) - B / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
    return b * A * (sig - dS);
  }
  const venues = VENUES.filter((v) => !v.open);
  let worstN = 0, worstE = 0, wN = '', wE = '', worstEdge = 0, wEdge = '';
  for (const v of venues) {
    const P = makeProjection(v.lat, v.lon), R = v.R ?? MAP_RADIUS, p0 = v.lat * DEG;
    const [x1] = P.fwd(v.lat, v.lon + 0.01), [, z1] = P.fwd(v.lat + 0.01, v.lon);
    const eE = x1 / (Nr(p0) * Math.cos(p0) * 0.01 * DEG) - 1, eN = -z1 / (Mr(p0) * 0.01 * DEG) - 1;
    if (Math.abs(eN) > Math.abs(worstN)) { worstN = eN; wN = v.id; }
    if (Math.abs(eE) > Math.abs(worstE)) { worstE = eE; wE = v.id; }
    // the map's corner: projected distance from the centre against the geodesic one
    const [la, lo] = P.inv(R * 0.7071, -R * 0.7071), dg = vincenty(v.lat, v.lon, la, lo), dp = R;
    if (Math.abs(dp - dg) > Math.abs(worstEdge)) { worstEdge = dp - dg; wEdge = `${v.id} (R ${R / 1000} km)`; }
  }
  // chart plotting accuracy: 0.2 mm at 1:50,000 is 10 m; a scale error of 0.1% puts a point 6 m off at 6 km
  S.within({ quantity: `north-south scale error of the local projection (worst: ${wN})`, measured: worstN * 100, lo: -0.1, hi: 0.1, unit: '%', source: 'WGS84 meridional radius of curvature M(lat); kz = 110540 m/deg is the equatorial value' });
  S.within({ quantity: `east-west scale error (worst: ${wE})`, measured: worstE * 100, lo: -0.1, hi: 0.1, unit: '%', source: 'WGS84 prime-vertical radius N(lat) cos(lat)' });
  S.within({ quantity: `distance centre to map corner, projected - geodesic (worst: ${wEdge})`, measured: worstEdge, lo: -10, hi: 10, unit: 'm', source: "Vincenty's inverse on WGS84; 10 m = chart plotting accuracy at 1:50,000" });
}

S.done();
