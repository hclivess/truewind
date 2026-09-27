// Sail levels across a big race fleet. The governor (main.js) decides how many AI boats the machine can carry at
// the cloth level L1; this decides which: the ones nearest the camera, the rest on the strip model (L2). A boat
// changes level only when it is clearly on the wrong side of the line (rank hysteresis), and only a couple per
// call, since putting a boat back into cloth builds its sails afresh.

// fleet: AI boats (b.lod 0/1/2, b.x, b.z); cam {x, z}; nCloth: how many may sail at L1 (or finer)
// returns [[boat, lod], ...] to apply
export function fleetLevels(fleet, cam, nCloth, clothLod = 1, maxChanges = 2) {
  const d = (b) => (b.x - cam.x) ** 2 + (b.z - cam.z) ** 2;
  const rank = new Map(fleet.slice().sort((a, b) => d(a) - d(b)).map((b, i) => [b, i]));
  const out = [];
  const cloth = fleet.filter((b) => b.lod < 2).sort((a, b) => rank.get(b) - rank.get(a));   // farthest first
  const strip = fleet.filter((b) => b.lod >= 2).sort((a, b) => rank.get(a) - rank.get(b)); // nearest first
  let n = cloth.length;
  // too many in cloth: the farthest go down
  while (n > nCloth && cloth.length && out.length < maxChanges) { out.push([cloth.shift(), 2]); n--; }
  // room for more: the nearest come up
  while (n < nCloth && strip.length && out.length < maxChanges) { out.push([strip.shift(), clothLod]); n++; }
  // swaps: a strip boat well inside the near set trades places with a cloth boat well outside it
  const slack = Math.max(1, Math.round(nCloth * 0.25));
  while (out.length + 2 <= maxChanges && cloth.length && strip.length && rank.get(strip[0]) < nCloth - slack && rank.get(cloth[0]) >= nCloth + slack) {
    out.push([cloth.shift(), 2], [strip.shift(), clothLod]);
  }
  return out;
}

// how many AI boats can sail in cloth (L1) within the frame budget: ms per 120 Hz step of the player (at its
// level) and of one L1 and one L2 boat, measured or guessed; two steps a frame, 6 ms budget, a margin for the rest
export function clothBudget(nAi, msPlayer, msL1, msL2, budget = 6) {
  const free = budget / 2 * 0.8 - msPlayer - nAi * msL2;
  return Math.max(0, Math.min(nAi, Math.floor(free / Math.max(1e-3, msL1 - msL2))));
}
