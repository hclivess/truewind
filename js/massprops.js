// Mass properties from the boat's parts: the hull shell spread over its real surface (hull.js lines), the keel fin and
// bulb, the ballast, the rudder, the mast (from the rig's structure: js/rig-structure.js), boom, sails and rigging, the
// engine where it is stowed, and the crew where they sit. Gives the centre of gravity and the moments of inertia about
// it in roll (Ixx), pitch (Iyy) and yaw (Izz), and their radii of gyration.
//
// Per class (MASS_DATA, or C.massItems): items { name, m (kg), at: [x, y, z] or a box { x0, x1, y, z0, z1 } } that are
// part of massHull; whatever of massHull the items do not account for is the hull shell and deck. The crew (crewN x
// crewEach) sits at crewZ, out at 0.7 of crewMaxOut on both rails (a static average: the physics moves them).
import { linesFor, hullSection, hullOffsets } from './hull.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// class data: 'est.' from builders' figures and photos; the rest is from class rules and builders' specifications
export const MASS_DATA = {
  // J/70: 794 kg incl. 285 kg keel (J/Boats; lead bulb ~230 kg, iron fin ~55 kg est.), the outboard stowed at the mast
  // step (class rule C.5.3), rudder ~10 kg, boom 6 kg, sails 12 kg, standing rigging 8 kg, deck gear and interior 60 kg est.
  sportboat: [
    { name: 'bulb', m: 230, at: [0.55, 0, -1.32], len: 1.3 },
    { name: 'fin', m: 55, box: { x0: 0.45, x1: 0.95, y: 0.05, z0: -1.25, z1: -0.3 } },
    { name: 'rudder', m: 10, box: { x0: -3.6, x1: -3.3, y: 0.02, z0: -0.9, z1: 0.3 } },
    { name: 'outboard', m: 17.4, at: [0.55, 0, -0.12] },
    { name: 'boom', m: 6, box: { x0: -1.9, x1: 1.0, y: 0.03, z0: 1.65, z1: 1.75 } },
    { name: 'sails', m: 12, at: [0.2, 0, 4.0] },
    { name: 'rigging', m: 8, at: [1.0, 0, 5.0] },
    { name: 'deck gear', m: 60, box: { x0: -2.5, x1: 2.5, y: 0.6, z0: 0.2, z1: 0.8 } },
  ],
  // Laser/ILCA 7: 59 kg is the class's hull weight (moulding, deck fittings); the spars (~9 kg), sail (~2 kg), board
  // (~3 kg) and rudder (~2.5 kg) come on top of it (they are not in massHull: a finding reported to the class data)
  dinghy: [
    { name: 'deck fittings', m: 6, box: { x0: -1.8, x1: 1.5, y: 0.5, z0: 0.2, z1: 0.4 } },
  ],
  // Hobie 16: 160 kg rigged (Hobie Cat Co.): two hulls ~46 kg each, beams, trampoline and frame ~22 kg, mast ~16 kg
  // (the rig's structure gives its own), boom 4, sails 8, rudders and castings 2 x 4 kg (est.)
  cat: [
    { name: 'front beam', m: 8, box: { x0: 0.55, x1: 0.65, y: 1.0, z0: 0.45, z1: 0.5 } },
    { name: 'rear beam', m: 7, box: { x0: -2.0, x1: -1.9, y: 1.0, z0: 0.45, z1: 0.5 } },
    { name: 'trampoline', m: 7, box: { x0: -2.0, x1: 0.6, y: 0.95, z0: 0.47, z1: 0.5 } },
    { name: 'boom', m: 4, box: { x0: -2.0, x1: 0.6, y: 0.02, z0: 1.2, z1: 1.3 } },
    { name: 'sails', m: 8, at: [0.0, 0, 3.5] },
    { name: 'rudders', m: 8, box: { x0: -2.6, x1: -2.4, y: 1.0, z0: -0.5, z1: 0.5 } },
  ],
  // Blackwatch 19: 1,021 kg incl. 363 kg iron ballast along the bottom of the long keel (Blue Water Boatworks), a
  // teak bowsprit ~15 kg, barn-door rudder ~20 kg, cabin joinery, tanks and gear ~120 kg (est.), boom and staysail
  // club 15 kg, sails 18 kg, standing rigging 14 kg
  blackwatch: [
    { name: 'ballast', m: 363, box: { x0: -1.6, x1: 1.9, y: 0.08, z0: -0.6, z1: -0.4 } },
    { name: 'bowsprit', m: 15, box: { x0: 2.3, x1: 4.3, y: 0.08, z0: 1.0, z1: 1.1 } },
    { name: 'rudder', m: 20, box: { x0: -2.95, x1: -2.5, y: 0.03, z0: -0.6, z1: 0.9 } },
    { name: 'joinery and gear', m: 120, box: { x0: -1.5, x1: 2.0, y: 0.7, z0: -0.2, z1: 0.9 } },
    { name: 'booms', m: 15, box: { x0: -2.3, x1: 2.5, y: 0.03, z0: 1.4, z1: 1.5 } },
    { name: 'sails', m: 18, at: [0.7, 0, 3.6] },
    { name: 'rigging', m: 14, at: [0.9, 0, 4.0] },
  ],
};

// a generic keelboat's parts: ballast ~38% of massHull in a fin and bulb at the keel's depth, the rest spread
function genericItems(C) {
  const items = [];
  if (!C.multihull && C.keel && !C.keel.board) {
    const ball = 0.38 * C.massHull;
    items.push({ name: 'ballast', m: ball, at: [C.keel.x, 0, -(C.draft || 1.5) * 0.8] });
  }
  items.push({ name: 'sails', m: 0.8 * C.sails.reduce((a, s) => a + s.area, 0) * 0.35, at: [C.mastX - 0.5, 0, C.boomZ + 0.4 * C.mastHeight] });
  items.push({ name: 'interior', m: 0.12 * C.massHull, box: { x0: C.sternX * 0.7, x1: C.bowX * 0.7, y: C.beam * 0.3, z0: -0.2, z1: C.freeboard } });
  return items;
}

// point samples (x, y, z, w) of a box item, or a single point
function samples(it) {
  if (!it.box) return [[it.at[0], it.at[1], it.at[2], 1]];
  const b = it.box, out = [];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    out.push([b.x0 + (b.x1 - b.x0) * (i + 0.5) / 4, s * b.y, b.z0 + (b.z1 - b.z0) * (k + 0.5) / 2, 1 / 16]);
  }
  return out;
}

// the hull shell and deck as mass spread uniformly over their area (sections at 24 stations, the deck across the beam)
function shellSamples(C) {
  const Lx = linesFor(C), out = [];
  let A = 0;
  const n = 24, dx = (C.bowX - C.sternX) / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = C.sternX + t * (C.bowX - C.sternX), half = hullSection(C, Lx, t);
    for (const off of hullOffsets(C)) {
      for (let k = 0; k + 1 < half.length; k++) {
        const [y0, z0] = half[k], [y1, z1] = half[k + 1], l = Math.hypot(y1 - y0, z1 - z0) * dx, ym = 0.5 * (y0 + y1), zm = 0.5 * (z0 + z1);
        for (const s of [-1, 1]) { out.push([x, off + s * ym, zm, l]); A += l; }
      }
      // deck: across the half beam at the sheer, both sides
      const b = Lx.bDeck(t), zs = Lx.sheer(t);
      for (const s of [-1, 1]) { out.push([x, off + s * b / 2, zs, b * dx]); A += b * dx; }
    }
  }
  for (const p of out) p[3] /= A;
  return out;
}

export function massProps(C, rig = null) {
  const items = (C.massItems || MASS_DATA[C.id] || genericItems(C)).map((it) => ({ ...it }));
  // the mast from the rig's structure (its real section), when there is one
  if (rig) {
    for (let i = 0; i < rig.nm; i++) if (rig.mN[i] > 0) items.push({ name: 'mast', m: rig.mN[i], at: [rig.axisX, 0, rig.z[i]] });
  } else items.push({ name: 'mast', m: 1.2 * (C.mastHeight - C.freeboard), at: [C.mastX, 0, 0.5 * (C.mastHeight + C.freeboard)] });
  // (the Laser's rig, foils and the Hobie's are not in massHull: they are added on top; a keelboat's are inside it)
  const extra = C.id === 'dinghy' ? [
    { name: 'boom', m: 3, box: { x0: -1.6, x1: 1.1, y: 0.02, z0: 0.95, z1: 1.05 } }, { name: 'sail', m: 2, at: [0, 0, 2.6] },
    { name: 'daggerboard', m: 3, at: [C.keel.x, 0, -0.35] }, { name: 'rudder', m: 2.5, at: [C.rudder.x, 0, -0.2] }] : [];
  let inHull = items.reduce((a, it) => a + it.m, 0);
  if (C.id === 'dinghy') inHull = items.filter((it) => it.name !== 'mast').reduce((a, it) => a + it.m, 0);
  const shell = Math.max(0.15 * C.massHull, C.massHull - inHull);
  const pts = [];
  for (const it of [...items, ...extra]) for (const [x, y, z, w] of samples(it)) pts.push([x, y, z, w * it.m]);
  // the mass the list does not name (the hull shell, its laminate's thickening low down, floors, tanks, fastenings):
  // spread over the hull's surface, and as much of it low in the bilge as puts the boat's centre of gravity where the
  // class's stability data has it (C.zG, the figure the righting moment is calibrated to)
  const sh = shellSamples(C), zLow = -0.8 * (C.canoeDraft || 0.2);
  let m0 = 0, z0 = 0; for (const [, , z, w] of pts) { m0 += w; z0 += w * z; }
  let zs = 0; for (const [, , z, w] of sh) zs += w * z;
  const zg1 = (z0 + shell * zs) / (m0 + shell), zg2 = (z0 + shell * zLow) / (m0 + shell);
  const low = C.zG === undefined || C.id === 'dinghy' || C.multihull ? 0 : clamp((zg1 - C.zG) / Math.max(1e-6, zg1 - zg2), 0, 0.8);
  for (const [x, y, z, w] of sh) pts.push([x, y, z, w * shell * (1 - low)]);
  if (low > 0) for (let i = 0; i < 8; i++) for (const s of [-1, 1]) pts.push([C.sternX * 0.85 + (C.bowX * 0.85 - C.sternX * 0.85) * (i + 0.5) / 8, s * 0.12 * C.beam, zLow, shell * low / 16]);
  // the crew, on both rails at 0.7 of their reach (the average of their places)
  const crew = (C.crewN || 0) * (C.crewEach || 0), yc = 0.7 * (C.crewMaxOut || 0.5);
  const crewPts = crew ? [[-(C.lwl || C.loa) * 0.15, yc, C.crewZ || 0.5, crew / 2], [-(C.lwl || C.loa) * 0.15, -yc, C.crewZ || 0.5, crew / 2]] : [];
  const all = [...pts, ...crewPts];
  let m = 0, sx = 0, sy = 0, sz = 0;
  for (const [x, y, z, w] of pts) { m += w; sx += w * x; sy += w * y; sz += w * z; }
  const boatM = m, xG = sx / m, zG = sz / m;
  let M = 0, cx = 0, cz = 0;
  for (const [x, , z, w] of all) { M += w; cx += w * x; cz += w * z; }
  cx /= M; cz /= M;
  let Ixx = 0, Iyy = 0, Izz = 0, IxxB = 0, IyyB = 0, IzzB = 0;
  for (const [x, y, z, w] of all) {
    const dx = x - cx, dz = z - cz;
    Ixx += w * (y * y + dz * dz); Iyy += w * (dx * dx + dz * dz); Izz += w * (dx * dx + y * y);
  }
  for (const [x, y, z, w] of pts) {
    const dx = x - xG, dz = z - zG;
    IxxB += w * (y * y + dz * dz); IyyB += w * (dx * dx + dz * dz); IzzB += w * (dx * dx + y * y);
  }
  // the crew's own share (about the boat's centre of gravity), for classes whose hull inertias come from their own data
  let IxxC = 0, IzzC = 0;
  for (const [x, y, z, w] of crewPts) { IxxC += w * (y * y + (z - zG) ** 2); IzzC += w * ((x - xG) ** 2 + y * y); }
  return {
    boatMass: boatM, shell, shellLow: low, xG, zG, Ixx, Iyy, Izz, IxxBoat: IxxB, IyyBoat: IyyB, IzzBoat: IzzB, IxxCrew: IxxC, IzzCrew: IzzC,
    ownData: !!(C.massItems || MASS_DATA[C.id]),
    kxx: Math.sqrt(Ixx / M), kyy: Math.sqrt(Iyy / M), kzz: Math.sqrt(Izz / M), total: M,
    items: [...items, ...extra].reduce((o, it) => { o[it.name] = (o[it.name] || 0) + it.m; return o; }, { shell }),
  };
}
