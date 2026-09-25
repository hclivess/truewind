// Per-class, per-sail sizes and materials for the cloth / vortex-lattice sail model. Kept out of the CLASSES
// literal in physics.js on purpose: the rig geometry lives there, the discretisation lives here.
//
// lattice: vortex rings, chordwise x spanwise, per detail level (L0 player, L1 AI / remote boats)
// cloth:   cloth nodes, chordwise x spanwise (L0; L1 uses about half)

const LATTICE = {
  main: [[6, 10], [4, 5]],
  jib: [[5, 8], [4, 5]],
  stay: [[4, 6], [3, 4]],
  gennaker: [[6, 9], [4, 5]],
};
export function latticeSize(C, s, lod) {
  const t = LATTICE[s.key] || LATTICE.jib, [nc, ns] = t[Math.min(lod, 1)];
  return { nc, ns };
}

export let CONFORMING = true;
export function setConforming(v) { CONFORMING = v; }
// cloth grids (nodes) at L0, from the plan: span rows fall on batten and reef heights where the class has them
const CLOTH = {
  dinghy: { main: [9, 12] },
  blackwatch: { main: [8, 12], jib: [6, 11], stay: [6, 9] },
  sportboat: { main: [9, 14], jib: [6, 11], gennaker: [10, 12] },
  cat: { main: [9, 13], jib: [6, 10], gennaker: [9, 11] },
};
export function clothSize(C, s, lod) {
  // the cloth's nodes are the lattice's corners: every shape the cloth takes is one the lattice sees, and every
  // panel load lands on the nodes that carry it (a finer cloth than lattice flutters in modes the air cannot damp)
  if (CONFORMING) { const { nc, ns } = latticeSize(C, s, lod); return { nu: nc + 1, nv: ns + 1 }; }
  const g = (CLOTH[C.id] && CLOTH[C.id][s.key]) || [7, 10];
  if (lod >= 1) return { nu: Math.max(4, Math.ceil(g[0] / 2) + 1), nv: Math.max(5, Math.ceil(g[1] / 2) + 1) };
  return { nu: g[0], nv: g[1] };
}

// sailcloth: stiffness per unit width along the warp, the fill and in bias (shear), N/m; areal mass kg/m^2;
// bending stiffness N m. Estimates (Dacron from sailmakers' test data order of magnitude, laminates stiffer
// along the load paths, nylon spinnaker cloth soft and light).
export const MATERIALS = {
  dacronCruise: { warp: 180e3, fill: 250e3, bias: 20e3, rho: 0.30, D: 2e-3, layout: 'crosscut' },
  dacronDinghy: { warp: 120e3, fill: 160e3, bias: 12e3, rho: 0.20, D: 1.5e-3, layout: 'crosscut' },
  laminate: { warp: 600e3, fill: 350e3, bias: 120e3, rho: 0.18, D: 4e-3, layout: 'radial' },
  nylon: { warp: 25e3, fill: 25e3, bias: 4e3, rho: 0.045, D: 5e-5, layout: 'radial' },
};
export function clothMaterial(C, s) {
  if (s.kind === 'spin') return MATERIALS.nylon;
  if (C.id === 'blackwatch') return MATERIALS.dacronCruise;
  if (C.id === 'dinghy') return MATERIALS.dacronDinghy;
  return MATERIALS.laminate;
}
// battens: bending stiffness EI (N m^2) and the heights (fraction of the luff) they sit at
export function battens(C, s) {
  if (s.key !== 'main') return { EI: 0, rows: [] };
  if (C.id === 'cat') return { EI: 15, full: true, rows: [0.14, 0.28, 0.42, 0.56, 0.7, 0.84] };
  if (C.id === 'blackwatch') return { EI: 3, full: false, rows: [0.3, 0.52, 0.74] };
  return { EI: 3, full: false, rows: [0.25, 0.5, 0.75] };
}
