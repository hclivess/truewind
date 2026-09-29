// Whitecaps as drawn: runs the game in headless Chromium on the open sea and, at each wind, renders the water
// from straight above with the water shader's foam value (and its parts: the active crests, the foam map's
// decaying foam, the gale streaks) written out instead of its colour, the foam map stepped at a real frame
// rate's pace. Averaged over NP places and NM instants each (one place is a few crests: a single look varies
// by a factor of several). The mean foam value is the fraction of the sea that is white (whitecap cover as
// photographs measure it; c25, c50: the share of pixels whiter than 25 %, 50 %). Used to calibrate render.js
// WC_PA, WC_PB, WC_PE against env.js whitecapCover, and by `node test/whitecaps.mjs --gpu`. Alone:
//   node tools/verify-foam.mjs [10,20,30,45,60] [shots-prefix]
// Needs Playwright (PLAYWRIGHT=/path/to/playwright/index.mjs) and a Chromium (CHROMIUM=/path/to/chrome).
// Slow on a software GPU (minutes a wind).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
export async function gpuFoam({ winds = [10, 20, 30, 45, 60], NP = 3, NM = 3, WARM = 60, GAP = 10, DT = 0.2, q = '', shots = null, log = false, port } = {}) {
  const pw = await import(process.env.PLAYWRIGHT || 'playwright');
  port = port || await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const b = await pw.chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const res = [], errs = [];
  try {
    const p = await b.newPage({ viewport: { width: 480, height: 270 } });
    p.setDefaultTimeout(3600000);
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 1500)); });
    await p.goto(`http://127.0.0.1:${port}/index.html${q}`, { timeout: 600000 });
    await p.waitForSelector('#venue-list .card[data-v="open"]', { timeout: 600000 });
    await p.click('#venue-list .card[data-v="open"]', { force: true });
    await p.click('[data-weather="steady"]', { force: true });
    for (const [id, v] of [['tws', '12'], ['swell', '0']]) await p.$eval('#' + id, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.click('#start', { force: true });
    await p.waitForFunction(() => window.game && window.game.env && window.game.player && window.game.running, null, { timeout: 1800000, polling: 2000 });
    await p.evaluate(() => {
      const g = window.game, R = g.renderer, m = R.water.material;
      g.frame = () => {};
      const k = 'gl_FragColor = vec4(col, 1.0);';
      let fs = m.fragmentShader;
      const rep = (a, b) => { if (!fs.includes(a)) throw new Error('no hook ' + a); fs = fs.replace(a, b); };
      rep('float pers = 0.0;', 'float pers = 0.0, dbgA = 0.0, dbgR = 0.0;');
      rep('foam = max(act, resid);', 'foam = max(act, resid); dbgA = act; dbgR = resid;');
      rep('foamFlat = max(foamFlat, pers);', 'float dbgS = foamFlat; foamFlat = max(foamFlat, pers);');
      rep('foam = max(foam, foamFlat);', 'float dbgC = foam; foam = max(foam, foamFlat);');
      rep(k, 'if (uDbg > 1.5) { gl_FragColor = vec4(clamp(pers, 0.0, 1.0), clamp(dbgA, 0.0, 1.0), clamp(dbgR, 0.0, 1.0), 1.0); return; }\n' + k);
      rep(k, 'if (uDbg > 0.5) { gl_FragColor = vec4(clamp(foam, 0.0, 1.0), clamp(dbgC, 0.0, 1.0), clamp(dbgS, 0.0, 1.0), 1.0); return; }\n' + k);
      R.waterU.uDbg = { value: 0 };
      m.fragmentShader = 'uniform float uDbg;\n' + fs;
      m.needsUpdate = true;
      window.__cam0 = R._updateCamera.bind(R);
      if (g.trafficView && g.trafficView.group) g.trafficView.group.visible = false;
    });
    for (const kt of winds) {
      const r = await p.evaluate(async ({ kt, NP, NM, WARM, GAP, DT }) => {
        const THREE = await import('three');
        const g = window.game, R = g.renderer, pl = g.player;
        const cond = { ...g.cond, tws: kt, swell: 0 };
        g.cond = cond;
        const env = g.makeEnv(cond);
        R.setWaves(env.waves);
        const top = function () { const c = this.camera; c.position.set(pl.x, 150, pl.z); c.up.set(0, 0, -1); c.lookAt(pl.x, 0, pl.z); c.updateMatrixWorld(); };
        const S = 200, rt = new THREE.WebGLRenderTarget(S, S), px = new Uint8Array(S * S * 4);
        const step = (n) => { for (let i = 0; i < n; i++) { g.t += DT; if (env.tick(g.t)) R.setWaves(env.waves); R.waterU.uTime.value = g.t; R.setRogues(env.waves, g.t, pl.x, pl.z); R._updateFoam(g.t, env, [], pl); } };
        const acc = {}, add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
        let nm = 0;
        for (let ip = 0; ip < NP; ip++) {
          pl.x += 4000 + 1300 * ip; pl.z += 2500; pl.pose = null;
          R.foamT = null;
          R.updateGust(env, g.world, g.t, pl.x, pl.z);
          R._updateCamera = top; R.resize(48, 48); R.update(0.01, g.t, { env, boats: [], player: pl });
          step(WARM);
          for (let im = 0; im < NM; im++) {
            if (im) step(GAP);
            R._updateCamera = top; R.update(0.001, g.t, { env, boats: [], player: pl });
            const hide = [];
            R.scene.children.forEach(o => { if (o !== R.water && o.visible) hide.push(o); });
            hide.forEach(o => o.visible = false);
            const bg = R.scene.background; R.scene.background = null;
            const cc = R.r.getClearColor(new THREE.Color()), ca = R.r.getClearAlpha(); R.r.setClearColor(0x000000, 0);
            const cam = R.camera; cam.aspect = 1; cam.updateProjectionMatrix();
            for (const mode of [1, 2]) {
              R.waterU.uDbg.value = mode;
              R.r.setRenderTarget(rt); R.r.render(R.scene, cam); R.r.setRenderTarget(null);
              R.r.readRenderTargetPixels(rt, 0, 0, S, S, px);
              let n = 0, a = 0, b2 = 0, c = 0, c25 = 0, c50 = 0;
              for (let i = 0; i < px.length; i += 4) { if (px[i + 3] < 128) continue; n++; a += px[i]; b2 += px[i + 1]; c += px[i + 2]; if (mode === 1 && px[i] > 64) c25++; if (mode === 1 && px[i] > 128) c50++; }
              n *= 255;
              if (mode === 1) { add('mean', a / n); add('crest', b2 / n); add('streak', c / n); add('c25', c25 * 255 / n); add('c50', c50 * 255 / n); }
              else { add('pers', a / n); add('act', b2 / n); add('resid', c / n); }
            }
            nm++;
            R.waterU.uDbg.value = 0; R.r.setClearColor(cc, ca); hide.forEach(o => o.visible = true); R.scene.background = bg;
          }
        }
        for (const k in acc) acc[k] = +(acc[k] / nm).toFixed(4);
        // the overview as drawn: above the crests, looking downwind and 18 degrees down
        const Hs = env.waves.Hs, fl = env.wind.flowDir(), hC = Math.max(10, 1.3 * Hs + 6), tn = Math.tan(18 * Math.PI / 180);
        R._updateCamera = function () { const c = this.camera; c.up.set(0, 1, 0); c.position.set(pl.x - fl[0] * 30, hC, pl.z - fl[1] * 30); c.lookAt(pl.x - fl[0] * 30 + fl[0] * hC / tn, 0, pl.z - fl[1] * 30 + fl[1] * hC / tn); c.updateMatrixWorld(); };
        R.resize(480, 270); R.update(0.001, g.t, { env, boats: g.boats, player: pl });
        const img = R.r.domElement.toDataURL('image/png');
        return { kt, Hs: +env.waves.Hs.toFixed(2), Tp: +env.waves.Tp.toFixed(1), n: nm, ...acc, img };
      }, { kt, NP, NM, WARM, GAP, DT });
      if (shots) writeFileSync(`${shots}-${kt}.png`, Buffer.from(r.img.split(',')[1], 'base64')); delete r.img;
      if (log) console.log(JSON.stringify(r));
      res.push(r);
    }
  } finally { await b.close(); server.kill(); }
  if (errs.length) throw new Error(errs.join('\n'));
  return res;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const winds = (process.argv[2] || '10,20,30,45,60').split(',').map(Number);
  await gpuFoam({ winds, shots: process.argv[3] || null, log: true });
}
