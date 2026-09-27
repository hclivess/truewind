// The water as drawn against the water as felt: runs the game in headless Chromium at a venue with a swell, waits
// for the coastal field, then renders the real water vertex shader (its output redirected into a float target) at
// points round the coast — open water, a headland's lee, off the walls — and pushes each displaced vertex back
// through WaveField.sample(). Used by `node test/coastal.mjs --gpu`; alone: node tools/verify-coastal.mjs [venue]
// Needs Playwright (PLAYWRIGHT=/path/to/playwright/index.mjs) and a Chromium (CHROMIUM=/path/to/chrome).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
export async function gpuCheck({ venue = 'marseille', tws = '18', twd = '225', swell = '2.5', port } = {}) {
  const pw = await import(process.env.PLAYWRIGHT || 'playwright');
  port = port || await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const b = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(`http://127.0.0.1:${port}/index.html`, { timeout: 180000 });
    await p.waitForSelector(`#venue-list .card[data-v="${venue}"]`, { timeout: 120000 });
    await p.click(`#venue-list .card[data-v="${venue}"]`, { force: true });
    await p.click('[data-weather="steady"]', { force: true }).catch(() => {});
    for (const [id, v] of [['tws', tws], ['twd', twd], ['swell', swell]]) await p.$eval('#' + id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.click('#start', { force: true });
    await p.waitForFunction(() => window.game && window.game.env && window.game.env.waves.coastal && window.game.renderer.waterU.uCstOn.value === 1, null, { timeout: 900000, polling: 1000 });
    const r = await p.evaluate(async () => {
      const THREE = await import('three');
      const g = window.game, R = g.renderer, W = g.env.waves, U = R.waterU, world = g.world;
      // (the rogue groups off: the GPU draws only the two nearest the player, the physics feels every one; big-seas
      // checks the groups' formula against the shader's)
      W.rogue = false; W.rgForced.length = 0; W._rgL = new Map(); R.setRogues(W, U.uTime.value, 0, 0);
      // points on the water: a lattice over the map, kept off the beach's last metres (where the texture's 8-bit
      // chart and the world's own depth differ)
      const pts = [];
      for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) { const x = -world.R * 0.9 + i * world.R * 1.8 / 23, z = -world.R * 0.9 + j * world.R * 1.8 / 23; if (world.sdfAt(x, z) > 40 && world.depthAt(x, z) > 4) pts.push(x, z); }
      const n = pts.length / 2, pos = new Float32Array(n * 3), spc = new Float32Array(n).fill(1e-3);
      for (let q = 0; q < n; q++) { pos[3 * q] = pts[2 * q]; pos[3 * q + 2] = pts[2 * q + 1]; }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('spc', new THREE.BufferAttribute(spc, 1));
      let vs = R.water.material.vertexShader;
      const patch = (a, b) => { if (!vs.includes(a)) throw new Error('shader patch: ' + a); vs = vs.replace(a, b); };
      patch('vec2 x0 = position.xz + uOffset;', 'vec2 x0 = position.xz;');
      vs = vs.replace(/float fade = 1\.0 - smoothstep\([^;]*\);/, 'float fade = 1.0;');
      patch('gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);', `vOut = P; gl_PointSize = 1.0; gl_Position = vec4((float(gl_VertexID) + 0.5) / ${n}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);`);
      vs = 'varying vec3 vOut;\n' + vs;
      const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: vs, fragmentShader: 'varying vec3 vOut; void main(){ gl_FragColor = vec4(vOut, 1.0); }' });
      const scene = new THREE.Scene(), pts3 = new THREE.Points(geo, mat); pts3.frustumCulled = false; scene.add(pts3);
      const rt = new THREE.WebGLRenderTarget(n, 1, { type: THREE.FloatType }), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const t = U.uTime.value, prev = R.r.getRenderTarget();
      R.r.setRenderTarget(rt); R.r.render(scene, cam); R.r.setRenderTarget(prev);
      const px = new Float32Array(4 * n); R.r.readRenderTargetPixels(rt, 0, 0, n, 1, px);
      let worst = 0, worstXZ = 0, rms = 0, hs = 0, where = '';
      for (let q = 0; q < n; q++) {
        const X = px[4 * q], Y = px[4 * q + 1], Z = px[4 * q + 2];
        const s = W.sample(X, Z, t, {});
        const e = Math.abs(s.h - Y), exz = Math.hypot(s.x0 - pts[2 * q], s.z0 - pts[2 * q + 1]);
        rms += e * e; hs = Math.max(hs, Math.abs(Y));
        if (e > worst) { worst = e; where = `(${pts[2 * q].toFixed(0)}, ${pts[2 * q + 1].toFixed(0)}) depth ${world.depthAt(pts[2 * q], pts[2 * q + 1]).toFixed(1)}`; }
        worstXZ = Math.max(worstXZ, exz);
      }
      return { n, worst, worstXZ, rms: Math.sqrt(rms / n), maxEta: hs, where, t };
    });
    r.errors = errs;
    r.ok = r.worst < 0.03 && r.worstXZ < 0.05 && !errs.length;
    return r;
  } finally { await b.close(); server.kill(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await gpuCheck({ venue: process.argv[2] || 'marseille' });
  console.log(JSON.stringify(r, null, 1));
  process.exit(r.ok ? 0 : 1);
}
