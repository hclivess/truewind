// Baked polars of the cloth sails. The velocity prediction (the live polar, POLAR %, laylines, the AI's upwind and
// downwind angles) needs the boat's steady speed at 15 true wind angles for the wind of the moment; running the
// cloth and the lattice for that takes minutes, so tools/bake-sail-surrogate.mjs runs it offline, per class, over a
// range of wind speeds (the same automatic crew and the same trim offsets as the game's VPP, at the game's 120 Hz
// step) and writes data/sails/<class>.json. Here those tables are read back and interpolated in wind speed: the
// polar the game uses is the cloth sails' own, and it costs nothing.
//
// Format: { class, model, lod, secs, tws: [kn...], twa: [deg...], bsp: [[kn...]...], heel, leeway, gen, bias }
// (rows per wind speed, columns per angle)
import { sailHooks } from '../physics.js';

const KT = 0.514444;
const BAKED = {};

export function setBakedPolars(id, data) { if (data && data.tws && data.bsp) BAKED[id] = data; }
export function bakedPolars(id) { return BAKED[id] || null; }

// steady speed at one true wind angle for true wind twsMS (m/s), as solvePolarAngle returns it (m/s, degrees)
export function bakedPolarAngle(id, twsMS, twaDeg) {
  const P = BAKED[id]; if (!P) return null;
  const kn = twsMS / KT, T = P.tws, A = P.twa;
  let i = 0; while (i < T.length - 2 && kn > T[i + 1]) i++;
  const ft = Math.max(0, Math.min(1, (kn - T[i]) / (T[i + 1] - T[i])));
  // below the lightest baked wind the speed goes to zero with the wind (a light-air boat speed is ~ proportional to it)
  const low = kn < T[0] ? Math.max(0, kn / T[0]) : 1;
  let j = 0; while (j < A.length - 2 && twaDeg > A[j + 1]) j++;
  const fa = Math.max(0, Math.min(1, (twaDeg - A[j]) / (A[j + 1] - A[j])));
  const at = (tab, r, c) => tab[r][c];
  const bil = (tab) => {
    const a = at(tab, i, j) + (at(tab, i, j + 1) - at(tab, i, j)) * fa;
    const b = at(tab, i + 1, j) + (at(tab, i + 1, j + 1) - at(tab, i + 1, j)) * fa;
    return a + (b - a) * ft;
  };
  const near = (tab) => tab[ft < 0.5 ? i : i + 1][fa < 0.5 ? j : j + 1];
  const bsp = bil(P.bsp) * low * KT;
  return { twa: twaDeg, bsp, vmg: bsp * Math.cos(twaDeg * Math.PI / 180), heel: bil(P.heel), leeway: bil(P.leeway), gen: !!near(P.gen), bias: near(P.bias), baked: true };
}

// load data/sails/<id>.json (browser: fetch; node: the file system)
export async function loadBakedPolars(id) {
  if (BAKED[id]) return BAKED[id];
  const url = new URL(`../../data/sails/${id}.json`, import.meta.url);
  try {
    let data;
    if (typeof process !== 'undefined' && process.versions && process.versions.node && url.protocol === 'file:') {
      const fs = await import('node:fs');
      data = JSON.parse(fs.readFileSync(url, 'utf8'));
    } else {
      const r = await fetch(url); if (!r.ok) return null;
      data = await r.json();
    }
    setBakedPolars(id, data);
    return data;
  } catch (e) { return null; }
}

// physics.js asks here first when a VPP is wanted for the cloth sails
sailHooks.polarAngle = (C, twsMS, twaDeg) => bakedPolarAngle(C.id, twsMS, twaDeg);
