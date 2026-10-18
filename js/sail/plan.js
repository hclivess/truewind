// A sail's planform: its chord and the rise of its leech at each height up the luff, and what is left of it reefed.
// Plain numbers, no imports (physics.js, the cloth rig, the renderers and the damage model all read it).
//
// Most sails are a quadrilateral: the chord runs straight from the foot to the head (a jib's head a few centimetres,
// a gaff sail's the gaff), and the leech rises above the luff's level by footRise at the clew and headRise at the
// peak. A gaff sail may carry a gaff topsail over it (s.topsail { luff, area, head }): a triangle set above the gaff,
// its luff on the topmast, its tack at the throat, its clew sheeted out to the gaff's peak, its head at the topmast's
// truck. Its foot lies along the gaff, so with the gaff sail it makes one planform of five corners (tack, clew, peak,
// truck and throat, the gaff a stiff line across it from the throat to the peak), and that is how it is sailed here:
// one cloth, one lattice, the gaff a stiff row inside it (js/sail/rigsim.js) and the topsail trimmed by the gaff, as
// it is on the real boat (its sheet is set when it is hoisted and goes where the peak goes).
//
// normaliseTopsail(s) turns such a sail's class figures (the gaff sail's luff, foot, head, headRise and area, and its
// topsail's) into the combined planform once, at load: s.luff and s.area become the whole sail's, s.head the topsail's
// head, s.gaffV the gaff's height as a fraction of the luff, s.gaff the gaff sail's own figures.
export const REEF = [{ a: 1, l: 1 }, { a: 0.76, l: 0.84 }, { a: 0.56, l: 0.69 }];
const lerp = (a, b, t) => a + (b - a) * t;

export function normaliseTopsail(s) {
  if (!s.topsail || s.gaff) return s;
  const T = s.topsail, g = { luff: s.luff, head: s.head, headRise: s.headRise || 0, area: s.area };
  s.gaff = g;
  s.luff = g.luff + T.luff; s.area = g.area + T.area; s.head = T.head ?? 0.12; s.headRise = 0;
  s.gaffV = g.luff / s.luff;
  return s;
}

// chord at height fraction fv of the luff (as drawn: before the cloth's scale to the rated area), roach left out
export function planChord(s, fv) {
  if (!s.gaff) return s.foot * (1 - fv) + s.head * fv;
  const g = s.gaffV;
  if (fv <= g) return lerp(s.foot, s.gaff.head, fv / g);
  return lerp(s.gaff.head, s.head, (fv - g) / (1 - g));
}
// the leech's rise above the luff's level at height fraction fv (the whole chord: x u for a point u along it)
export function planRise(s, fv) {
  const fr = (s.footRise || 0) * (1 - fv);
  if (!s.gaff) return fr + (s.headRise || 0) * fv;
  const g = s.gaffV;
  return fr + (fv <= g ? s.gaff.headRise * fv / g : s.gaff.headRise * (1 - (fv - g) / (1 - g)));
}

// reef factors at a continuous reef position: area and luff against the full sail's. A sail with a topsail hands the
// topsail first (the first 'reef' of a gaff rig: the topsail comes down before the mainsail is reefed), then ties in
// the gaff sail's first reef. A sail the crew does not reef (a schooner's foresail, a mizzen) only hands its topsail.
export function reefAt(pos, s = null) {
  const p = Math.max(0, Math.min(2, pos || 0));
  if (!s || !s.gaff) {
    const i = Math.max(0, Math.min(1, Math.floor(p))), f = p - i;
    return { a: lerp(REEF[i].a, REEF[Math.min(2, i + 1)].a, f), l: lerp(REEF[i].l, REEF[Math.min(2, i + 1)].l, f) };
  }
  const ga = s.gaff.area / s.area, gl = s.gaff.luff / s.luff;
  if (p <= 1) return { a: lerp(1, ga, p), l: lerp(1, gl, p) };
  const f = s.key === 'main' ? p - 1 : 0;
  return { a: ga * lerp(1, REEF[1].a, f), l: gl * lerp(1, REEF[1].l, f) };
}
// the sail as it is set at reef level `reef` (0, 0.5, 1, 1.5, 2): a smaller sail of the same cut; a gaff sail with its
// topsail handed is the gaff sail alone (and reefed from there)
export function reefedSail(s0, reef) {
  if (!(reef > 0)) return s0;
  const r = reefedPlan(s0, reef);
  // (a luff on a raked mast: the shorter luff leans by the mast's rake over its own height)
  if (s0.rake && (s0.mast || (s0.key === 'main' && s0.rig === 'gaff'))) r.rake = s0.rake * r.luff / s0.luff;
  return r;
}
function reefedPlan(s0, reef) {
  if (!s0.gaff) { const rf = reefAt(reef); return { ...s0, luff: s0.luff * rf.l, area: s0.area * rf.a }; }
  if (reef < 1) {
    // (half way: the topsail half down, its head lowered down the topmast)
    const rf = reefAt(reef, s0), luff = s0.luff * rf.l;
    return { ...s0, luff, area: s0.area * rf.a, gaffV: s0.gaff.luff / luff };
  }
  const g = s0.gaff, f = s0.key === 'main' ? Math.min(1, reef - 1) : 0;
  return { ...s0, luff: g.luff * lerp(1, REEF[1].l, f), area: g.area * lerp(1, REEF[1].a, f), head: g.head, headRise: g.headRise, gaff: null, gaffV: null, topsail: null };
}
