// Wildlife: the birds, dolphins, whales, turtles and sharks of each venue (the simulation; js/wildlife-render.js
// draws it). Visual only: nothing here touches the boats, the wind or the sea, and nothing in the physics reads
// it, so a race or an online session goes the same with or without it. It has its own random numbers (seeded by
// the venue, the session's seed and the day, per population slot and generation), never Math.random.
//
// Who lives where and when (VENUE_FAUNA): the species of each venue, how many groups are about on average and by
// month. Each species has a few "slots"; a slot holds a group (a flock, a pod, a whale or two, a turtle, a shark)
// somewhere around the player, or waits and rolls again. Groups are placed where the species lives (deep enough
// water, far enough from or near enough to the shore, by world.depthAt and the land's signed distance) and keep
// out of shallow water and away from boats as they go. Everything rides the sea as it is drawn (ctx.ride: the
// drawn surface under the animal), so a gull on the water sits on the wave that is drawn and a fin cuts it.
//
// Behaviour, by what the animals do in life:
//  - gulls: flap-and-glide, loaf in flocks on the water and take off when a boat comes close (into the wind, away
//    from the boat), follow a boat and hang in the wind over her stern; terns: buoyant flight, hover and plunge
//    (they do not sit on the sea); gannets: search at 10-35 m and plunge-dive with the wings folded back at the
//    last moment, a splash, a few seconds under, then sit and take off; brown pelicans: lines low over the water,
//    a twisting plunge; frigatebirds: soar in circles high up and never settle on the water (their plumage is not
//    waterproof); albatrosses, giant petrels and shearwaters: dynamic soaring, banked arcs from the crests up
//    into the wind and down again, hardly a wingbeat.
//  - dolphins: pods travelling, milling or running fast (leaping clear: porpoising), each animal on its own
//    breathing cycle (a rolling surfacing, the blowhole and the fin, then under); bow-riding a boat that sails at
//    5 kn or more, sometimes. Harbour porpoises: small groups, a short roll, shy of boats, never bow-ride.
//  - whales: a surfacing sequence of a few blows (the spout by species: a humpback's bushy column, a right
//    whale's V, a fin whale's tall column), then the terminal dive (a humpback's or a right whale's flukes up;
//    Bryde's and fin whales seldom or never fluke) and minutes down; now and then a breach. Offshore, deep water.
//  - turtles: slow near the surface, alternate fore-flipper strokes when slow (synchronous power strokes when
//    they flee), the head up for a breath or two, then a dive of minutes; bask at the surface in calm water; dive
//    away from a boat.
//  - sharks: the dorsal fin cutting the surface steadily (no rolling arc: a fish does not breathe), the tail tip
//    swaying side to side behind (fish beat their tails sideways, dolphins and whales up and down); filter feeders
//    (basking and whale sharks) slow at the surface; the others mostly below; sometimes circling; away from boats.
//
// Events (blows, splashes, calls, sightings) go into a small ring the view reads every frame.

export const G = 9.81;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapA = (a) => { a = (a + Math.PI) % TAU; return (a < 0 ? a + TAU : a) - Math.PI; };
const sst = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

// integer hash (the slot seeds)
export function hash32(...k) {
  let h = 0x811c9dc5;
  for (let v of k) {
    if (typeof v === 'string') { for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193); } continue; }
    v = Math.floor(v) | 0;
    h ^= v; h = Math.imul(h, 0x01000193); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  }
  return h >>> 0;
}
// a group's own random numbers (mulberry32 on a state kept in the group: no closures)
function rnd(g) {
  g.rs = (g.rs + 0x6d2b79f5) >>> 0;
  let t = g.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (g, a, b) => a + (b - a) * rnd(g);
const ri = (g, a, b) => Math.floor(a + (b - a + 1) * rnd(g));

// ------------------------------------------------------------------ species
// Common fields: cls (bird | cet | turtle | shark), morph (the model family), name, L (length, m), depth (the
// least water it goes in, m), shore [min, max] (signed distance to the shore it keeps to, m), group [min, max].
// Birds: span (m), hz (wingbeat, Hz: Pennycuick's measured flapping frequencies), amp (half the stroke, rad),
// v (cruise airspeed, m/s), alt [min, max] (m), flight (flapglide | soar | thermal | skim | buoyant),
// glide (share of the time gliding in cruise), sit (share of groups that are a flock on the water, 0 = never
// settles), flock [min, max], follow (share of birds that follow a passing boat), flush (m: a boat this close puts
// a sitting bird up), run (a pattering take-off run), dive (plunge | hover | twist | surface | null), call.
const B = (o) => ({ cls: 'bird', depth: 0.5, shore: [5, 9000], group: [1, 4], flock: [5, 18], follow: 0, sit: 0.3, flush: 40, run: false, dive: null, call: null, glide: 0.4, flight: 'flapglide', ...o });
// Cetaceans: v [travel, fast], breath [min, max] s between surfacings (dolphins) or between the blows of a
// sequence (whales), dive [min, max] s (a whale's long dive; a porpoise's), blows [min, max] per sequence,
// spout (the blow's shape), fluke (share of terminal dives that show the flukes), breach (share of sequences
// that start with one), bow (share of encounters in which a pod bow-rides a boat at 5+ kn), leap (porpoises at
// speed), shy (m: keeps this far from boats).
const C = (o) => ({ cls: 'cet', depth: 4, shore: [30, 1e9], group: [1, 1], bow: 0, leap: false, shy: 30, fluke: 0, breach: 0, ...o });
// Turtles: v (m/s), dive [min, max] s, breaths [min, max], bask (share of surfacings in calm water that are a bask).
const T = (o) => ({ cls: 'turtle', depth: 2, shore: [20, 1e9], group: [1, 1], v: 0.45, dive: [240, 900], breaths: [1, 3], bask: 0.3, shy: 25, ...o });
// Sharks: v (m/s), surf (share of the time with the fin out), back (top of the back above the body's axis, x L),
// fin (dorsal fin height, x L), filter (a filter feeder: slow, mouth open at the surface), circle (share of bouts
// spent circling).
const K = (o) => ({ cls: 'shark', depth: 3, shore: [40, 1e9], group: [1, 1], v: 1, surf: 0.1, back: 0.1, fin: 0.1, filter: false, circle: 0.15, shy: 35, ...o });

export const SPECIES = {
  // ---- gulls
  herringGull: B({ morph: 'gull', name: 'herring gull', L: 0.6, span: 1.4, hz: 3.0, amp: 0.75, v: 11, alt: [4, 30], sit: 0.45, flock: [6, 22], follow: 0.5, call: 'gull' }),
  gbbGull: B({ morph: 'gull', name: 'great black-backed gull', L: 0.71, span: 1.6, hz: 2.7, amp: 0.7, v: 12, alt: [4, 35], sit: 0.4, flock: [2, 8], follow: 0.3, call: 'gullDeep' }),
  blackHeadedGull: B({ morph: 'gull', name: 'black-headed gull', L: 0.38, span: 1.0, hz: 3.4, amp: 0.8, v: 9.5, alt: [3, 20], sit: 0.5, flock: [6, 25], follow: 0.35, flush: 35, call: 'gullSmall' }),
  laughingGull: B({ morph: 'gull', name: 'laughing gull', L: 0.41, span: 1.03, hz: 3.3, amp: 0.8, v: 10, alt: [3, 25], sit: 0.45, flock: [6, 25], follow: 0.55, call: 'laugh' }),
  silverGull: B({ morph: 'gull', name: 'silver gull', L: 0.41, span: 0.95, hz: 3.4, amp: 0.8, v: 9.5, alt: [3, 20], sit: 0.45, flock: [6, 25], follow: 0.6, call: 'gullSmall' }),
  redBilledGull: B({ morph: 'gull', name: 'red-billed gull', L: 0.37, span: 0.93, hz: 3.5, amp: 0.8, v: 9.5, alt: [3, 20], sit: 0.45, flock: [6, 25], follow: 0.55, call: 'gullSmall' }),
  kelpGull: B({ morph: 'gull', name: 'kelp gull', L: 0.6, span: 1.35, hz: 2.9, amp: 0.72, v: 11.5, alt: [4, 30], sit: 0.4, flock: [2, 10], follow: 0.35, call: 'gullDeep' }),
  yellowLeggedGull: B({ morph: 'gull', name: 'yellow-legged gull', L: 0.6, span: 1.4, hz: 3.0, amp: 0.75, v: 11, alt: [4, 30], sit: 0.45, flock: [6, 20], follow: 0.5, call: 'gull' }),
  westernGull: B({ morph: 'gull', name: 'western gull', L: 0.62, span: 1.37, hz: 3.0, amp: 0.74, v: 11, alt: [4, 30], sit: 0.45, flock: [5, 18], follow: 0.5, call: 'gull' }),
  ringBilledGull: B({ morph: 'gull', name: 'ring-billed gull', L: 0.47, span: 1.2, hz: 3.2, amp: 0.78, v: 10.5, alt: [3, 25], sit: 0.45, flock: [6, 22], follow: 0.4, call: 'gullSmall' }),
  // ---- terns: buoyant, deep wingbeats, hover and plunge; they rest ashore or on posts, not on the sea
  sandwichTern: B({ morph: 'tern', name: 'Sandwich tern', L: 0.4, span: 0.95, hz: 3.0, amp: 0.9, v: 9.5, alt: [4, 12], sit: 0, group: [1, 5], glide: 0.15, flight: 'buoyant', dive: 'hover', flush: 0, call: 'tern' }),
  commonTern: B({ morph: 'tern', name: 'common tern', L: 0.33, span: 0.82, hz: 3.4, amp: 0.9, v: 9, alt: [3, 10], sit: 0, group: [1, 5], glide: 0.12, flight: 'buoyant', dive: 'hover', flush: 0, call: 'tern' }),
  crestedTern: B({ morph: 'tern', name: 'greater crested tern', L: 0.46, span: 1.05, hz: 2.9, amp: 0.85, v: 10, alt: [4, 14], sit: 0, group: [1, 4], glide: 0.15, flight: 'buoyant', dive: 'hover', flush: 0, call: 'tern' }),
  whiteFrontedTern: B({ morph: 'tern', name: 'white-fronted tern', L: 0.4, span: 0.8, hz: 3.3, amp: 0.9, v: 9, alt: [3, 10], sit: 0, group: [2, 8], glide: 0.12, flight: 'buoyant', dive: 'hover', flush: 0, call: 'tern' }),
  royalTern: B({ morph: 'tern', name: 'royal tern', L: 0.48, span: 1.05, hz: 2.9, amp: 0.85, v: 10, alt: [4, 14], sit: 0, group: [1, 4], glide: 0.15, flight: 'buoyant', dive: 'hover', flush: 0, call: 'tern' }),
  caspianTern: B({ morph: 'tern', name: 'Caspian tern', L: 0.52, span: 1.35, hz: 2.7, amp: 0.8, v: 10.5, alt: [5, 18], sit: 0, group: [1, 3], glide: 0.2, flight: 'buoyant', dive: 'hover', flush: 0, call: 'ternDeep' }),
  // ---- gannets: search high, plunge-dive
  northernGannet: B({ morph: 'gannet', name: 'northern gannet', L: 0.94, span: 1.8, hz: 3.4, amp: 0.6, v: 14, alt: [10, 35], sit: 0.25, flock: [4, 15], group: [1, 6], glide: 0.5, dive: 'plunge', flush: 45, run: true, shore: [150, 1e9] }),
  australasianGannet: B({ morph: 'gannet', name: 'Australasian gannet', L: 0.88, span: 1.75, hz: 3.4, amp: 0.6, v: 14, alt: [10, 30], sit: 0.25, flock: [4, 15], group: [1, 8], glide: 0.5, dive: 'plunge', flush: 45, run: true, shore: [150, 1e9] }),
  // ---- tubenoses: dynamic soaring
  blackBrowedAlbatross: B({ morph: 'albatross', name: 'black-browed albatross', L: 0.85, span: 2.25, hz: 2.6, amp: 0.45, v: 13, alt: [1.5, 14], flight: 'soar', glide: 0.98, sit: 0.2, flock: [3, 10], group: [1, 3], follow: 0.4, flush: 50, run: true, shore: [500, 1e9] }),
  wanderingAlbatross: B({ morph: 'albatross', name: 'wandering albatross', L: 1.15, span: 3.1, hz: 2.2, amp: 0.4, v: 14, alt: [2, 16], flight: 'soar', glide: 0.99, sit: 0.15, flock: [1, 4], group: [1, 2], follow: 0.5, flush: 55, run: true, shore: [500, 1e9] }),
  giantPetrel: B({ morph: 'petrel', name: 'southern giant petrel', L: 0.9, span: 1.95, hz: 3.0, amp: 0.55, v: 12, alt: [1.5, 10], flight: 'soar', glide: 0.85, sit: 0.25, flock: [2, 6], group: [1, 3], follow: 0.4, flush: 40, run: true, shore: [300, 1e9] }),
  capePetrel: B({ morph: 'petrel', name: 'cape petrel', L: 0.39, span: 0.86, hz: 4.6, amp: 0.65, v: 11, alt: [1, 8], flight: 'soar', glide: 0.6, sit: 0.35, flock: [8, 30], group: [3, 12], follow: 0.5, flush: 35, run: true, shore: [300, 1e9] }),
  whiteChinnedPetrel: B({ morph: 'petrel', name: 'white-chinned petrel', L: 0.55, span: 1.4, hz: 3.8, amp: 0.6, v: 12, alt: [1, 9], flight: 'soar', glide: 0.75, sit: 0.2, flock: [3, 12], group: [1, 4], follow: 0.35, flush: 40, run: true, dive: 'surface', shore: [300, 1e9] }),
  shortTailedShearwater: B({ morph: 'shearwater', name: 'short-tailed shearwater', L: 0.42, span: 0.98, hz: 4.4, amp: 0.65, v: 11, alt: [0.8, 6], flight: 'soar', glide: 0.6, sit: 0.35, flock: [10, 40], group: [3, 15], flush: 40, run: true, dive: 'surface', shore: [300, 1e9] }),
  flutteringShearwater: B({ morph: 'shearwater', name: 'fluttering shearwater', L: 0.33, span: 0.76, hz: 5.5, amp: 0.7, v: 10, alt: [0.8, 5], flight: 'soar', glide: 0.35, sit: 0.35, flock: [10, 40], group: [3, 15], flush: 35, run: true, dive: 'surface', shore: [200, 1e9] }),
  scopolisShearwater: B({ morph: 'shearwater', name: "Scopoli's shearwater", L: 0.48, span: 1.15, hz: 3.8, amp: 0.55, v: 11.5, alt: [1, 7], flight: 'soar', glide: 0.7, sit: 0.35, flock: [6, 30], group: [2, 10], flush: 40, run: true, shore: [500, 1e9] }),
  // ---- frigatebirds and pelicans
  frigatebird: B({ morph: 'frigatebird', name: 'magnificent frigatebird', L: 1.0, span: 2.3, hz: 2.0, amp: 0.55, v: 9, alt: [25, 110], flight: 'thermal', glide: 0.97, sit: 0, group: [1, 5], flush: 0, shore: [-300, 6000] }),
  brownPelican: B({ morph: 'pelican', name: 'brown pelican', L: 1.3, span: 2.0, hz: 2.0, amp: 0.55, v: 10.5, alt: [0.8, 4], flight: 'skim', glide: 0.6, sit: 0.4, flock: [3, 12], group: [3, 9], dive: 'twist', flush: 30, run: true, shore: [10, 6000] }),

  // ---- dolphins and porpoises
  bottlenose: C({ morph: 'delphinid', name: 'bottlenose dolphin', L: 2.8, v: [2.0, 6.0], breath: [15, 35], group: [2, 8], depth: 3, shore: [40, 1e9], bow: 0.35, leap: true, shy: 15, spout: 'puff' }),
  commonDolphin: C({ morph: 'delphinid', name: 'common dolphin', L: 2.1, v: [2.5, 7.0], breath: [8, 20], group: [6, 18], depth: 10, shore: [400, 1e9], bow: 0.6, leap: true, shy: 15, spout: 'puff' }),
  hourglassDolphin: C({ morph: 'delphinid', name: 'hourglass dolphin', L: 1.7, v: [2.5, 7.0], breath: [8, 20], group: [3, 8], depth: 100, shore: [5000, 1e9], bow: 0.5, leap: true, shy: 15, spout: 'puff' }),
  stripedDolphin: C({ morph: 'delphinid', name: 'striped dolphin', L: 2.2, v: [2.5, 7.0], breath: [8, 20], group: [6, 20], depth: 100, shore: [3000, 1e9], bow: 0.3, leap: true, shy: 20, spout: 'puff' }),
  harbourPorpoise: C({ morph: 'porpoise', name: 'harbour porpoise', L: 1.5, v: [1.5, 3.5], breath: [8, 20], dive: [40, 120], blows: [2, 4], group: [1, 3], depth: 5, shore: [60, 1e9], bow: 0, leap: false, shy: 150, spout: 'puff' }),
  // ---- whales (dive and breath times: typical published ranges; a humpback's sequence of 3-5 blows 15-45 s apart, then 5-15 min down)
  humpback: C({ morph: 'rorqual', name: 'humpback whale', L: 13.5, v: [1.6, 3.0], breath: [15, 45], dive: [300, 900], blows: [3, 5], depth: 18, shore: [400, 1e9], spout: 'bushy', fluke: 0.85, breach: 0.12, shy: 100 }),
  southernRight: C({ morph: 'right', name: 'southern right whale', L: 14.5, v: [1.0, 2.0], breath: [20, 60], dive: [480, 1200], blows: [4, 7], depth: 8, shore: [200, 1e9], spout: 'V', fluke: 0.6, breach: 0.06, shy: 80 }),
  brydes: C({ morph: 'rorqual', name: "Bryde's whale", L: 13.5, v: [1.5, 3.5], breath: [10, 40], dive: [60, 360], blows: [2, 4], depth: 15, shore: [500, 1e9], spout: 'column', fluke: 0.03, breach: 0.01, shy: 100 }),
  finWhale: C({ morph: 'rorqual', name: 'fin whale', L: 19, v: [2.0, 5.0], breath: [10, 25], dive: [300, 900], blows: [2, 5], depth: 60, shore: [2000, 1e9], spout: 'tall', fluke: 0, breach: 0.005, shy: 120 }),

  // ---- sea turtles (carapace lengths of adults)
  greenTurtle: T({ morph: 'turtle', name: 'green turtle', L: 1.0, v: 0.45, dive: [240, 1200], depth: 2, shore: [20, 20000] }),
  hawksbill: T({ morph: 'turtle', name: 'hawksbill turtle', L: 0.8, v: 0.4, dive: [300, 1500], depth: 2, shore: [20, 15000] }),
  loggerhead: T({ morph: 'turtle', name: 'loggerhead turtle', L: 0.95, v: 0.45, dive: [300, 1500], depth: 4, shore: [100, 1e9] }),
  leatherback: T({ morph: 'leatherback', name: 'leatherback turtle', L: 1.6, v: 0.7, dive: [120, 600], breaths: [2, 5], depth: 30, shore: [1500, 1e9], bask: 0.1 }),

  // ---- sharks (lengths of the animals usually seen)
  baskingShark: K({ morph: 'shark', name: 'basking shark', L: 7, v: 0.9, surf: 0.7, back: 0.075, fin: 0.14, filter: true, circle: 0.05, depth: 8, shore: [150, 1e9], shy: 30 }),
  whaleShark: K({ morph: 'whaleshark', name: 'whale shark', L: 8, v: 0.8, surf: 0.6, back: 0.085, fin: 0.1, filter: true, circle: 0.05, depth: 10, shore: [500, 1e9], shy: 25 }),
  blueShark: K({ morph: 'shark', name: 'blue shark', L: 2.8, v: 0.9, surf: 0.3, back: 0.06, fin: 0.085, circle: 0.25, depth: 40, shore: [3000, 1e9] }),
  bullShark: K({ morph: 'shark', name: 'bull shark', L: 2.4, v: 1.0, surf: 0.08, back: 0.085, fin: 0.1, circle: 0.2, depth: 2, shore: [30, 1e9] }),
  blacktip: K({ morph: 'shark', name: 'blacktip shark', L: 1.6, v: 1.3, surf: 0.15, back: 0.075, fin: 0.1, circle: 0.2, depth: 2, shore: [30, 1e9], group: [1, 4] }),
  bronzeWhaler: K({ morph: 'shark', name: 'bronze whaler', L: 2.8, v: 1.1, surf: 0.1, back: 0.08, fin: 0.1, circle: 0.25, depth: 4, shore: [60, 1e9], group: [1, 3] }),
  greatWhite: K({ morph: 'shark', name: 'great white shark', L: 4.0, v: 1.1, surf: 0.05, back: 0.1, fin: 0.11, circle: 0.2, depth: 8, shore: [150, 1e9] }),
  porbeagle: K({ morph: 'shark', name: 'porbeagle', L: 2.2, v: 1.2, surf: 0.08, back: 0.1, fin: 0.11, circle: 0.15, depth: 50, shore: [2000, 1e9] }),
};
for (const k in SPECIES) SPECIES[k].id = k;

// ------------------------------------------------------------------ who lives where, by month
// a 12-month table (January first): 1 in the months from..to (wrapping round the new year), `out` otherwise
export const months = (from, to, out = 0) => { const m = []; for (let i = 1; i <= 12; i++) m.push((from <= to ? i >= from && i <= to : i >= from || i <= to) ? 1 : out); return m; };
const both = (a, b) => a.map((x, i) => Math.max(x, b[i]));
const ALL = null;
// [species, mean number of groups about the player, monthly factor (null: all year)]
export const VENUE_FAUNA = {
  solent: [['herringGull', 4], ['blackHeadedGull', 3], ['gbbGull', 0.8], ['sandwichTern', 2, months(4, 9)], ['commonTern', 1.5, months(5, 9)],
    ['northernGannet', 0.6, months(4, 10, 0.3)], ['harbourPorpoise', 0.25], ['bottlenose', 0.2], ['commonDolphin', 0.1, months(11, 3, 0.3)],
    ['baskingShark', 0.08, months(5, 9)], ['blueShark', 0.02, months(6, 10)], ['leatherback', 0.015, months(7, 10)]],
  kiel: [['herringGull', 4], ['blackHeadedGull', 4], ['commonTern', 1.5, months(5, 8)], ['harbourPorpoise', 0.45]],
  sydney: [['silverGull', 5], ['crestedTern', 2.5], ['australasianGannet', 0.7], ['shortTailedShearwater', 0.8, months(10, 4)],
    ['bottlenose', 0.4], ['commonDolphin', 0.3], ['humpback', 0.6, both(months(5, 7), months(9, 11)).map((x, i) => x || (i === 7 ? 0.4 : 0.02))],
    ['southernRight', 0.08, months(6, 9)], ['greenTurtle', 0.12], ['loggerhead', 0.05], ['leatherback', 0.015, months(12, 4)],
    ['bronzeWhaler', 0.06, months(11, 4, 0.3)], ['greatWhite', 0.015]],
  auckland: [['redBilledGull', 4], ['kelpGull', 1.5], ['whiteFrontedTern', 2.5], ['australasianGannet', 2.5], ['flutteringShearwater', 1.8],
    ['commonDolphin', 0.8], ['bottlenose', 0.2], ['brydes', 0.35], ['humpback', 0.2, both(months(6, 7), months(9, 11)).map((x) => x || 0.02)],
    ['southernRight', 0.03, months(6, 9)], ['greenTurtle', 0.06, months(12, 4, 0.3)], ['loggerhead', 0.02], ['leatherback', 0.02, months(12, 4)],
    ['bronzeWhaler', 0.12, months(11, 4, 0.2)], ['greatWhite', 0.015]],
  progreso: [['laughingGull', 5], ['royalTern', 2.5], ['sandwichTern', 1.5], ['frigatebird', 2.5], ['brownPelican', 2.5],
    ['bottlenose', 0.45], ['greenTurtle', 0.15], ['hawksbill', 0.12], ['loggerhead', 0.05], ['leatherback', 0.01],
    ['blacktip', 0.1], ['bullShark', 0.05], ['whaleShark', 0.01, months(6, 9)]],
  southern: [['blackBrowedAlbatross', 3], ['wanderingAlbatross', 0.8], ['giantPetrel', 1.5], ['capePetrel', 2], ['whiteChinnedPetrel', 1.5],
    ['hourglassDolphin', 0.25], ['humpback', 0.3, months(12, 4, 0.05)], ['southernRight', 0.12, months(12, 4, 0.05)], ['finWhale', 0.25, months(12, 4, 0.1)],
    ['porbeagle', 0.03]],
  // (lat 0, lon 0: the Gulf of Guinea, far offshore: no gulls this far out; humpbacks breed off Gabon and São
  // Tomé July-October, leatherbacks nest in Gabon)
  open: [['bottlenose', 0.15], ['humpback', 0.25, months(7, 10, 0)], ['leatherback', 0.05], ['blueShark', 0.06]],
  sfbay: [['westernGull', 5], ['caspianTern', 1.2, months(4, 9)], ['brownPelican', 2, months(6, 11, 0.2)], ['harbourPorpoise', 0.35],
    ['bottlenose', 0.12], ['humpback', 0.06, months(4, 11)], ['greatWhite', 0.008, months(9, 11)]],
  // (the Upper Bay: gulls and summer terns; porpoises and bottlenoses now and then, and since the 2010s humpbacks
  // following the menhaden in through the Narrows, May-November)
  newyork: [['herringGull', 4], ['gbbGull', 1.5], ['commonTern', 1.2, months(5, 9)], ['harbourPorpoise', 0.04, months(12, 5)], ['bottlenose', 0.04, months(6, 9)], ['humpback', 0.02, months(5, 11)]],
  newport: [['herringGull', 4], ['gbbGull', 1.5], ['commonTern', 2, months(5, 9)], ['northernGannet', 0.5, months(10, 5)],
    ['harbourPorpoise', 0.12, months(12, 5)], ['commonDolphin', 0.06], ['humpback', 0.03, months(4, 11)], ['blueShark', 0.02, months(6, 10)], ['leatherback', 0.01, months(7, 10)]],
  marseille: [['yellowLeggedGull', 5], ['scopolisShearwater', 1.5, months(3, 10)], ['sandwichTern', 0.8, months(10, 3)], ['northernGannet', 0.4, months(11, 3)],
    ['bottlenose', 0.25], ['stripedDolphin', 0.2], ['finWhale', 0.04, months(6, 9, 0.2)], ['blueShark', 0.03], ['loggerhead', 0.03, months(6, 10)]],
  garda: [['yellowLeggedGull', 3], ['blackHeadedGull', 2.5, months(10, 3, 0.4)]],
  meredith: [['ringBilledGull', 3, months(10, 4, 0.2)]],
};

// the species of a venue (custom places: by latitude) on a date, each as { sp, n }: the mean number of groups
export function faunaFor(venue, dateMs) {
  const id = venue && venue.id;
  let list = VENUE_FAUNA[id];
  const lat = (venue && venue.lat) || 0;
  if (!list) {
    if (venue && venue.lake) list = [['ringBilledGull', 2]];
    else {
      const a = Math.abs(lat), S = lat < 0;
      list = a > 40 ? [[S ? 'kelpGull' : 'herringGull', 4], [S ? 'kelpGull' : 'blackHeadedGull', 2], ['harbourPorpoise', S ? 0 : 0.2], ['bottlenose', 0.15]]
        : a > 25 ? [[S ? 'silverGull' : 'yellowLeggedGull', 4], ['sandwichTern', 1.5], ['bottlenose', 0.3], ['loggerhead', 0.03]]
          : [['laughingGull', 4], ['royalTern', 2], ['brownPelican', 1.5], ['frigatebird', 1.5], ['bottlenose', 0.3], ['greenTurtle', 0.1], ['blacktip', 0.06]];
    }
  }
  const mo = new Date(Number.isFinite(dateMs) ? dateMs : 0).getUTCMonth();
  const out = [];
  for (const [sp, n, m] of list) {
    const f = m ? m[mo] : 1, k = n * f;
    if (k > 0 && SPECIES[sp]) out.push({ sp, n: k });
  }
  return out;
}

// ------------------------------------------------------------------ states
export const ST = {
  // birds
  FLY: 0, SIT: 1, TAKEOFF: 2, FOLLOW: 3, DIVE: 4, UNDER: 5, HOVER: 6, LAND: 7, SOAR: 8, THERMAL: 9,
  // cetaceans
  SUB: 10, ROLL: 11, LEAP: 12, DEEP: 13, FLUKE: 14, BREACH: 15, BOWRIDE: 16,
  // turtles
  SWIM: 20, BREATHE: 21, BASK: 22, FLEE: 23,
  // sharks
  CRUISE: 30, LOW: 31,
};
// a group's mode
export const GM = { TRAVEL: 0, FAST: 1, MILL: 2, BOW: 3, LEAVE: 4, SURFACING: 5, DOWN: 6, FLOCK: 7, AIR: 8 };

const RANGE = {      // spawn ring and the distance a group is let go at (m)
  bird: [250, 900, 1600], cet: [300, 1400, 2600], whale: [500, 2600, 4500], turtle: [60, 450, 900], shark: [100, 700, 1300],
};
const MAXN = { bird: 30, cet: 20, turtle: 1, shark: 4 };

function newAnimal() {
  return { on: false, x: 0, y: -50, z: 0, psi: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, v: 0, st: 0, tt: 0, t2: 0, n: 0,
    ph: 0, amp: 0, a2: 0, a3: 0, hz: 1, scale: 1, ox: 0, oz: 0, tx: 0, ty: 0, tz: 0, surf: 0, al: 0, at: 0, vis: false,
    beats: 0, cyc: 0, psi0: 0, slot: 0, dly: 0, seat: -1, ylp: 0, sub: 0, i: 0, g: null, side: 1, da: 0, ripe: 0, sf: -9 };
}
function newGroup(slot, sp) {
  const S = SPECIES[sp], cls = S.cls, mx = cls === 'bird' ? Math.max(S.flock[1], S.group[1]) : cls === 'cet' ? Math.max(S.group[1], 2) : S.group[1];
  const g = { slot, sp, S, cls, on: false, gen: 0, rs: 0, wait: 0, x: 0, z: 0, psi: 0, v: 0, mode: 0, tt: 0, t2: 0, life: 0, n: 0, members: [],
    bowDone: false, bowCD: 0, seen: false, seenGen: -1, event: 0, cx: 0, cz: 0, cr: 0, cdir: 1, ty: 0, near: 1e9, nearB: null, chk: 0, ripe: 0, follow: false, da: 0, p: 0, bowCalled: false };
  for (let i = 0; i < Math.min(mx, MAXN[cls] || 30); i++) { const a = newAnimal(); a.g = g; a.i = i; g.members.push(a); }
  return g;
}

const TURNS = [0.6, -0.6, 1.2, -1.2, 2.0, -2.0, Math.PI];

// ------------------------------------------------------------------ the simulation
// opts: { venue, world (sdfAt, depthAt; null: open deep water everywhere), seed, dateMs, budget (0..1: share of the
// birds and pod sizes, by the device's quality) }
export class Wildlife {
  constructor(opts = {}) {
    this.venue = opts.venue || { id: 'open', lat: 0, lon: 0, open: true };
    this.world = opts.world || null;
    this.budget = clamp(opts.budget ?? 1, 0.1, 1);
    this.seed = hash32(this.venue.id || 'x', opts.seed ?? 0, Math.floor((opts.dateMs ?? 0) / 86400000));
    this.fauna = opts.fauna || faunaFor(this.venue, opts.dateMs ?? 0);
    this.groups = [];
    let slot = 0;
    for (const f of this.fauna) {
      const S = SPECIES[f.sp];
      let n = f.n * (S.cls === 'bird' ? this.budget : 1);
      const slots = Math.max(1, Math.ceil(n - 1e-9));
      const cap = S.cls === 'bird' ? 8 : 3;
      for (let k = 0; k < Math.min(slots, cap); k++) {
        const g = newGroup(slot++, f.sp);
        g.p = clamp(n / slots, 0, 1);
        this.groups.push(g);
      }
    }
    this.animals = [];
    for (const g of this.groups) for (const a of g.members) this.animals.push(a);
    // events for the view: blows, splashes, calls (a ring of plain objects, reused)
    this.ev = []; for (let i = 0; i < 64; i++) this.ev.push({ type: '', x: 0, y: 0, z: 0, a: 0, b: 0, sp: '', g: null, m: null, dir: 0 });
    this.evHead = 0; this.evN = 0;
    this.t = 0; this.started = false; this.nStep = 0;
    this._r = { h: 0, al: 0, at: 0 };
    this.wind = { x: 0, z: 0, U: 0, dir: 0 };
    this.calm = 1;
  }
  emit(type, x, y, z, a = 0, b = 0, g = null, m = null, dir = 0) {
    const e = this.ev[(this.evHead + this.evN) % this.ev.length];
    if (this.evN < this.ev.length) this.evN++; else this.evHead = (this.evHead + 1) % this.ev.length;
    e.type = type; e.x = x; e.y = y; e.z = z; e.a = a; e.b = b; e.sp = g ? g.sp : ''; e.g = g; e.m = m; e.dir = dir;
    return e;
  }
  // events since the last call: fn(e) for each (and cleared)
  drain(fn) { while (this.evN > 0) { const e = this.ev[this.evHead]; this.evHead = (this.evHead + 1) % this.ev.length; this.evN--; fn(e); } }

  // where the species may be: water of its depth, at its distance from the shore
  okAt(S, x, z, extraDepth = 0) {
    const W = this.world;
    if (!W || W.open) return S.shore[0] <= 5000;
    const d = W.sdfAt(x, z);
    if (d < S.shore[0] || d > S.shore[1]) return false;
    if (S.cls === 'bird') return S.sit === 0 || d > 0 || S.shore[0] < 0;
    return W.depthAt(x, z) >= S.depth + extraDepth;
  }
  // open water (for a bird to come down on, dive into)
  wet(x, z, m = 8) { const W = this.world; return !W || W.open || W.sdfAt(x, z) > m; }
  depthAt(x, z) { const W = this.world; return !W || W.open ? (this.venue.depth ?? 200) : W.depthAt(x, z); }

  // ctx: { fx, fz (the player or the camera), boats: [{ x, z, u, psi, cls }], player, ride(x, z, psi, L, B, out),
  //        wind: { x, z, U } (m/s, toward), Hs, active (sightings may be called) }
  update(dt, t, ctx) {
    if (!(dt > 0)) { this.t = t; return; }
    this.wind = ctx.wind || this.wind;
    this.calm = clamp(1 - Math.max((this.wind.U - 3) / 5, (ctx.Hs || 0) / 0.5 - 0.4), 0, 1);
    // big steps (time warp) in pieces of at most 0.1 s, at most 20 of them
    const n = Math.min(20, Math.ceil(dt / 0.1)), h = Math.min(dt / n, 0.1);
    for (let k = 0; k < n; k++) this._step(h, t - dt + (k + 1) * h, ctx, k === n - 1);
    this.t = t;
  }
  _step(dt, t, ctx, last) {
    const fx = ctx.fx, fz = ctx.fz;
    this.nStep++;
    for (const g of this.groups) {
      if (!g.on) {
        g.wait -= dt;
        if (g.wait <= 0) this._roll(g, fx, fz, ctx);
        continue;
      }
      // the nearest boat (avoidance, flushing, bow-riding)
      g.chk -= dt;
      if (g.chk <= 0) { g.chk = 0.25; this._nearest(g, ctx); }
      const R = this._range(g), d = Math.hypot(g.x - fx, g.z - fz);
      g.life -= dt;
      if (d > R[2] || (g.life <= 0 && this._quiet(g, d))) { this._off(g); continue; }
      if (g.cls === 'bird') this._birds(g, dt, t, ctx);
      else if (g.cls === 'cet') (g.S.morph === 'rorqual' || g.S.morph === 'right' ? this._whale(g, dt, t, ctx) : this._pod(g, dt, t, ctx));
      else if (g.cls === 'turtle') this._turtle(g, dt, t, ctx);
      else this._shark(g, dt, t, ctx);
    }
    this.started = true;
  }
  _range(g) { return g.cls === 'cet' && (g.S.morph === 'rorqual' || g.S.morph === 'right') ? RANGE.whale : RANGE[g.cls]; }
  // may it be let go now (out of sight: under, or far)
  _quiet(g, d) {
    if (d > 900) return true;
    for (const a of g.members) if (a.on && a.vis) return false;
    return true;
  }
  _off(g) { g.on = false; g.wait = rr(g, 60, 240); for (const a of g.members) { a.on = false; a.vis = false; } }
  _nearest(g, ctx) {
    let best = 1e9, bb = null;
    if (ctx.boats) for (const b of ctx.boats) { const d = Math.hypot(b.x - g.x, b.z - g.z); if (d < best) { best = d; bb = b; } }
    g.near = best; g.nearB = bb;
  }
  // a new generation for the slot: present (with probability p) somewhere in range, or wait and roll again
  _roll(g, fx, fz, ctx) {
    g.gen++;
    g.rs = hash32(this.seed, g.slot, g.gen);
    if (rnd(g) >= g.p) { g.wait = rr(g, 120, 400); return; }
    const S = g.S, R = this._range(g);
    const r0 = this.started ? R[0] : Math.min(R[0], g.cls === 'bird' ? 80 : g.cls === 'turtle' ? 40 : 150);
    for (let k = 0; k < 16; k++) {
      const ang = rnd(g) * TAU, r = r0 + (R[1] - r0) * Math.sqrt(rnd(g));
      const x = fx + Math.sin(ang) * r, z = fz - Math.cos(ang) * r;
      if (!this.okAt(S, x, z, g.cls === 'cet' ? 2 : 0)) continue;
      this._spawn(g, x, z, ctx);
      return;
    }
    g.wait = rr(g, 15, 40);
  }
  _spawn(g, x, z, ctx) {
    const S = g.S;
    g.on = true; g.x = x; g.z = z; g.psi = rnd(g) * TAU; g.life = rr(g, 300, 1200); g.bowDone = false; g.bowCD = 0; g.seen = false; g.follow = false;
    g.chk = 0; g.near = 1e9; g.nearB = null; g.event = 0;
    for (const a of g.members) { a.on = false; a.vis = false; a.scale = 1; a.ph = rnd(g) * TAU; a.amp = 0; a.a2 = 0; a.a3 = 0; a.roll = 0; a.pitch = 0; a.dly = 0; a.seat = -1; }
    if (g.cls === 'bird') this._spawnBirds(g, x, z, ctx);
    else if (g.cls === 'cet') {
      const whale = S.morph === 'rorqual' || S.morph === 'right';
      g.n = whale ? (rnd(g) < 0.25 ? 2 : 1) : Math.max(1, Math.round(ri(g, S.group[0], S.group[1]) * (0.5 + 0.5 * this.budget)));
      g.n = Math.min(g.n, g.members.length);
      g.mode = whale ? GM.DOWN : (rnd(g) < 0.6 ? GM.TRAVEL : GM.MILL);
      g.v = whale ? S.v[0] : g.mode === GM.TRAVEL ? S.v[0] : 0.8;
      g.tt = whale ? rr(g, 20, S.dive[1] * 0.6) : rr(g, 40, 120);
      for (let i = 0; i < g.n; i++) {
        const a = g.members[i];
        a.on = true; a.scale = whale && i === 1 ? 0.45 : rr(g, 0.9, 1.08);       // (a whale's second: a calf beside its mother)
        const c = i === 0 ? 0 : i;
        a.ox = whale ? (i ? 6 : 0) : (rnd(g) - 0.5) * (4 + 2.5 * Math.sqrt(g.n)) * 1.6;
        a.oz = whale ? (i ? -3 : 0) : (rnd(g) - 0.5) * (5 + 3 * Math.sqrt(g.n)) * 1.6 + c * 0.0;
        a.st = whale ? ST.DEEP : ST.SUB; a.tt = rr(g, 0, S.breath[1]); a.y = -30; a.sub = whale ? 30 : rr(g, 1.2, 2.5);
        a.x = g.x; a.z = g.z; a.psi = g.psi; a.v = g.v;
      }
    } else if (g.cls === 'turtle') {
      const a = g.members[0]; g.n = 1; a.on = true; a.scale = rr(g, 0.85, 1.1);
      a.x = x; a.z = z; a.psi = g.psi; a.st = ST.SWIM; a.tt = rr(g, 5, S.dive[1] * 0.5); a.sub = rr(g, 1, 3); a.y = -a.sub; a.v = S.v;
      // (some are met at the surface: a breath or a bask)
      if (rnd(g) < 0.35) { a.st = ST.BREATHE; a.n = ri(g, S.breaths[0], S.breaths[1]); a.tt = 4 + 2 * a.n + rr(g, 0, 3); a.t2 = 0; a.cyc = 0; }
    } else {
      g.n = Math.min(g.members.length, ri(g, S.group[0], S.group[1]));
      for (let i = 0; i < g.n; i++) {
        const a = g.members[i]; a.on = true; a.scale = rr(g, 0.85, 1.1);
        a.x = x + (i ? rr(g, -25, 25) : 0); a.z = z + (i ? rr(g, -25, 25) : 0); a.psi = g.psi + rr(g, -0.4, 0.4);
        a.st = rnd(g) < S.surf ? ST.CRUISE : ST.LOW; a.tt = rr(g, 30, 200); a.v = S.v * rr(g, 0.8, 1.15);
        a.sub = 0; a.ylp = 0; a.n = 0;
      }
    }
  }

  // ---------------------------------------------------------------- birds
  _spawnBirds(g, x, z, ctx) {
    const S = g.S, b = this.budget;
    const sit = S.sit > 0 && rnd(g) < S.sit;
    const n = Math.max(1, Math.min(g.members.length, Math.round((sit ? ri(g, S.flock[0], S.flock[1]) : ri(g, S.group[0], S.group[1])) * (0.4 + 0.6 * b))));
    g.n = n; g.mode = sit ? GM.FLOCK : GM.AIR;
    g.cx = x; g.cz = z; g.cr = sit ? 6 + 2.5 * Math.sqrt(n) : rr(g, 80, 220); g.cdir = rnd(g) < 0.5 ? 1 : -1;
    g.ty = rr(g, S.alt[0], S.alt[1]);
    for (let i = 0; i < n; i++) {
      const a = g.members[i];
      a.on = true; a.vis = true; a.scale = rr(g, 0.92, 1.08); a.hz = S.hz * rr(g, 0.93, 1.07);
      const ang = rnd(g) * TAU, r = g.cr * Math.sqrt(rnd(g));
      a.x = x + Math.sin(ang) * r; a.z = z - Math.cos(ang) * r;
      a.beats = 0; a.cyc = rnd(g) * TAU; a.n = 0; a.side = rnd(g) < 0.5 ? 1 : -1;
      if (sit) { a.st = ST.SIT; a.y = 0; a.v = 0; a.psi = this._intoWind() + rr(g, -0.4, 0.4); a.a2 = 1; a.tt = rr(g, 60, 600); a.vx = a.vz = a.vy = 0; }
      else this._fly(g, a, a.x, a.z, rr(g, S.alt[0], S.alt[1]), true);
    }
  }
  _intoWind() { const w = this.wind; return w.U > 0.5 ? Math.atan2(-w.x, w.z) : 0; }   // (heading the wind comes from)
  // into flight toward a new waypoint (start: already flying at cruise)
  _fly(g, a, x, z, y, start = false) {
    const S = g.S;
    a.st = S.flight === 'soar' ? ST.SOAR : S.flight === 'thermal' ? ST.THERMAL : ST.FLY;
    if (start) {
      a.y = y; a.psi = rnd(g) * TAU; a.v = S.v;
      a.vx = Math.sin(a.psi) * S.v + this.wind.x * 0.5; a.vz = -Math.cos(a.psi) * S.v + this.wind.z * 0.5; a.vy = 0;
    }
    a.a2 = 0; a.tt = rr(g, 6, 20);
    this._waypoint(g, a);
    if (a.st === ST.SOAR) { a.psi0 = this._intoWind() + (rnd(g) < 0.5 ? 1 : -1) * Math.PI / 2 + rr(g, -0.4, 0.4); a.cyc = rnd(g) * TAU; }
    if (a.st === ST.THERMAL) { a.cyc = rnd(g) * TAU; a.ty = rr(g, S.alt[0], S.alt[1]); }
  }
  _waypoint(g, a) {
    const S = g.S, ang = rnd(g) * TAU, r = g.cr * Math.sqrt(rnd(g));
    a.tx = g.cx + Math.sin(ang) * r; a.tz = g.cz - Math.cos(ang) * r; a.ty = rr(g, S.alt[0], S.alt[1]);
  }
  _birds(g, dt, t, ctx) {
    const S = g.S, W = this.wind, P = ctx.player;
    // the group's centre wanders downwind slowly; a sitting flock drifts with the wind on the water
    if (g.mode === GM.FLOCK) { g.cx += W.x * 0.03 * dt; g.cz += W.z * 0.03 * dt; }
    else { g.cx += W.x * 0.08 * dt; g.cz += W.z * 0.08 * dt; }
    g.x = g.cx; g.z = g.cz;
    let flush = false;
    for (let i = 0; i < g.n; i++) {
      const a = g.members[i];
      if (!a.on) continue;
      switch (a.st) {
        case ST.SIT: this._sit(g, a, dt, t, ctx); if (a.st === ST.TAKEOFF) flush = true; break;
        case ST.TAKEOFF: this._takeoff(g, a, dt, t, ctx); break;
        case ST.LAND: this._land(g, a, dt, t, ctx); break;
        case ST.FOLLOW: this._follow(g, a, dt, t, ctx); break;
        case ST.DIVE: this._dive(g, a, dt, t, ctx); break;
        case ST.UNDER: this._under(g, a, dt, t, ctx); break;
        case ST.HOVER: this._hover(g, a, dt, t, ctx); break;
        case ST.SOAR: this._soar(g, a, dt, t, ctx); break;
        default: this._cruise(g, a, dt, t, ctx);
      }
    }
    // one bird up puts the flock up (a chain: each a moment after its neighbour)
    if (flush) for (let i = 0; i < g.n; i++) { const a = g.members[i]; if (a.on && a.st === ST.SIT && a.dly <= 0) a.dly = 0.15 + rnd(g) * 1.4; }
    if (g.mode === GM.FLOCK) { let up = 0; for (let i = 0; i < g.n; i++) if (g.members[i].st !== ST.SIT) up++; if (up === g.n) { g.mode = GM.AIR; g.cr = rr(g, 100, 220); } }
    // a passing boat: some gulls (and albatrosses, petrels) come to follow her
    if (S.follow > 0 && P && ctx.active && g.mode === GM.AIR && !g.follow) {
      const d = Math.hypot(P.x - g.cx, P.z - g.cz);
      if (d < 320) {
        g.follow = true;
        for (let i = 0; i < g.n; i++) { const a = g.members[i]; if (a.on && (a.st === ST.FLY || a.st === ST.SOAR) && rnd(g) < S.follow) { a.st = ST.FOLLOW; a.tt = rr(g, 60, 300); a.seat = i; a.ox = rr(g, -5, 5); a.oz = rr(g, 6, 16); a.ty = rr(g, 5, 11); } }
      }
    }
    if (g.follow && P && Math.hypot(P.x - g.cx, P.z - g.cz) > 700) g.follow = false;
  }
  _sea(a, ctx, L = 0.5, B = 0.3) {
    // (far from the player only every fourth step: there only the long waves are drawn, and slowly)
    if (Math.abs(a.x - ctx.fx) + Math.abs(a.z - ctx.fz) > 350 && (this.nStep - a.sf) < 4) return a.surf;
    a.sf = this.nStep;
    const o = ctx.ride ? ctx.ride(a.x, a.z, a.psi, L, B, this._r) : null;
    a.surf = o && Number.isFinite(o.h) ? o.h : 0; a.al = o && Number.isFinite(o.al) ? o.al : 0; a.at = o && Number.isFinite(o.at) ? o.at : 0;
    return a.surf;
  }
  // a flapping oscillator: flap bouts and glides by the species, more flapping when slow or climbing
  _wings(g, a, dt, need) {
    const S = g.S;
    if (a.beats > 0) {
      const p0 = a.ph; a.ph += TAU * a.hz * dt;
      if (Math.floor(a.ph / TAU) !== Math.floor(p0 / TAU)) a.beats--;
      a.amp += (S.amp * (0.85 + 0.25 * need) - a.amp) * Math.min(1, dt * 8);
    } else {
      a.amp += (0 - a.amp) * Math.min(1, dt * 5);
      if (a.amp > 0.02) a.ph += TAU * a.hz * dt * 0.5;
      a.t2 -= dt;
      if (a.t2 <= 0) {
        const gl = clamp(S.glide - 0.5 * need, 0, 0.995);
        if (rnd(g) > gl) a.beats = Math.max(1, Math.round(rr(g, 2, 7) * (1 + need)));
        a.t2 = rr(g, 0.6, 2.5) * (0.4 + gl * 1.5);
      }
    }
    if (a.ph > 1e4) a.ph -= TAU * 1000;
  }
  // steer toward (tx, ty, tz) at the species' airspeed; heading from the air through which it flies
  _steer(g, a, dt, tx, ty, tz, V, maxBank = 0.6, gx = 0, gz = 0) {
    const W = this.wind;
    // air velocity wanted: toward the target, at V, against the wind's drift (+ a ground velocity to match)
    let dx = tx - a.x, dz = tz - a.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const want = Math.atan2(dx, -dz);
    const air0x = a.vx - W.x, air0z = a.vz - W.z;
    const hd = Math.hypot(air0x, air0z) > 0.5 ? Math.atan2(air0x, -air0z) : a.psi;
    const omMax = G * Math.tan(maxBank) / Math.max(V, 3);
    const err = wrapA(want - hd), om = clamp(err * 1.2, -omMax, omMax);
    const nh = hd + om * dt;
    a.psi = nh;
    a.roll += (Math.atan(V * om / G) - a.roll) * Math.min(1, dt * 3);
    const ax = Math.sin(nh) * V, az = -Math.cos(nh) * V;
    a.vx = ax + W.x + gx; a.vz = az + W.z + gz;
    a.vy += (clamp((ty - a.y) * 0.5, -2.5, 2.0) - a.vy) * Math.min(1, dt * 2);
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    a.pitch += (Math.atan2(a.vy, V) * 0.6 - a.pitch) * Math.min(1, dt * 3);
    a.v = V;
    return dl;
  }
  _cruise(g, a, dt, t, ctx) {
    const S = g.S;
    if (a.st === ST.THERMAL) {
      // circling on a thermal (or the updraught off the swell), drifting with the wind, slowly up and down
      a.cyc += dt * S.v / 45 * g.cdir;
      const tx = g.cx + Math.sin(a.cyc + a.i) * 45, tz = g.cz - Math.cos(a.cyc + a.i) * 45;
      if ((a.tt -= dt) <= 0) { a.ty = rr(g, S.alt[0], S.alt[1]); a.tt = rr(g, 20, 60); }
      this._steer(g, a, dt, tx, a.ty, tz, S.v, 0.45);
      a.vy = clamp(a.vy, -0.8, 0.8);
      this._wings(g, a, dt, 0);
      a.a2 = 0; a.a3 = 0.3;           // (the frigatebird's crooked wing held in the glide)
      a.vis = true;
      return;
    }
    const d = this._steer(g, a, dt, a.tx, a.ty, a.tz, S.v, 0.55);
    const sea = a.y < 8 ? this._sea(a, ctx) : 0;
    if (a.y < sea + 1 + S.span * 0.4) { a.y = sea + 1 + S.span * 0.4; a.vy = Math.max(a.vy, 0); }
    // pelicans skim: they glide a metre or two over the crests, lifted by the swell
    if (S.flight === 'skim') { a.ty = this._sea(a, ctx) + rr(g, 0.9, 1.6); }
    this._wings(g, a, dt, clamp(a.vy / 2, 0, 1));
    a.a2 += (0 - a.a2) * Math.min(1, dt * 4);
    a.vis = true;
    a.tt -= dt;
    if (d < 25 || a.tt <= 0) {
      this._waypoint(g, a); a.tt = rr(g, 8, 25);
      // foraging: a gannet or a pelican plunges, a tern hovers then plunges, a shearwater dives from the surface
      if (S.dive && rnd(g) < (S.dive === 'hover' ? 0.5 : S.dive === 'plunge' ? 0.45 : 0.25) && this.wet(a.x + a.vx * 3, a.z + a.vz * 3, 20)) {
        if (S.dive === 'hover') { a.st = ST.HOVER; a.tt = rr(g, 1.2, 3.5); a.ty = this._sea(a, ctx) + rr(g, 3, 8); }
        else if (S.dive === 'surface') { a.st = ST.DIVE; a.tt = 0; a.n = 1; }
        else { a.st = ST.DIVE; a.tt = 0; a.n = 0; if (a.y < 9) a.y = Math.max(a.y, 10); }
      } else if (S.sit > 0 && g.mode === GM.AIR && rnd(g) < 0.06 && this.wet(a.x, a.z, 30)) { a.st = ST.LAND; a.tt = 0; }
    }
  }
  _soar(g, a, dt, t, ctx) {
    // Dynamic soaring: across the wind on average, in a cycle of arcs: up into the wind to the top of the arc,
    // a turn, down with it to the crests, banked steeply with a wingtip close to the water (Sachs 2005).
    const S = g.S, W = this.wind, U = Math.max(W.U, 3);
    const big = S.span > 1.6, T = big ? 10 : 6, A = big ? 30 : 14, H = (S.alt[1] - S.alt[0]) * clamp(U / 12, 0.3, 1);
    a.cyc += TAU / T * dt;
    const P = ctx.player;
    // the course: across the wind; a follower keeps circling the boat at a distance
    let base = a.psi0;
    if (g.follow && P) { const bx = P.x - a.x, bz = P.z - a.z, d = Math.hypot(bx, bz); if (d > 140) base = Math.atan2(bx, -bz) + 0.6 * a.side; else if (d < 60) base = Math.atan2(-bx, bz); }
    else {
      const d = Math.hypot(g.cx - a.x, g.cz - a.z);
      if (d > g.cr * 2) a.psi0 = Math.atan2(g.cx - a.x, -(g.cz - a.z));
    }
    const wd = Math.atan2(-W.x, W.z);                     // (toward where the wind comes from)
    const V0 = S.v, c = Math.cos(a.cyc), s = Math.sin(a.cyc);
    // velocity: the base course, plus a swing into and out of the wind
    const swing = A * TAU / T * c;
    a.vx = Math.sin(base) * V0 + Math.sin(wd) * swing;
    a.vz = -Math.cos(base) * V0 - Math.cos(wd) * swing;
    const sea = this._sea(a, ctx);
    const yLow = sea + 0.4 + S.span * 0.35 + Math.max(0, S.alt[0] - 1);
    const y = yLow + H * (0.5 - 0.5 * Math.cos(a.cyc + 0.6));
    a.vy = (y - a.y) / Math.max(dt, 1e-3); a.y = y;
    a.x += a.vx * dt; a.z += a.vz * dt;
    // heading from the air it flies through; bank from the turn
    const ax = a.vx - W.x, az = a.vz - W.z, h = Math.atan2(ax, -az);
    const om = wrapA(h - a.psi) / Math.max(dt, 1e-3);
    a.psi = h;
    a.roll += (clamp(Math.atan(Math.hypot(ax, az) * om / G), -1.25, 1.25) - a.roll) * Math.min(1, dt * 4);
    a.pitch += (Math.atan2(a.vy, Math.hypot(ax, az)) * 0.5 - a.pitch) * Math.min(1, dt * 3);
    a.v = Math.hypot(ax, az);
    this._wings(g, a, dt, U < 5 ? 0.5 : 0);
    a.a2 += (0 - a.a2) * Math.min(1, dt * 4);
    a.vis = true;
    if ((a.tt -= dt) <= 0) {
      a.tt = rr(g, 15, 40);
      const wet = this.wet(a.x, a.z, 30);
      if (S.dive === 'surface' && wet && rnd(g) < 0.25) { a.st = ST.DIVE; a.n = 1; }
      else if (S.sit > 0 && wet && rnd(g) < 0.05 && g.mode === GM.AIR && !g.follow) { a.st = ST.LAND; }
      else if (rnd(g) < 0.3) a.psi0 = wd + (rnd(g) < 0.5 ? 1 : -1) * Math.PI / 2 + rr(g, -0.5, 0.5);
    }
  }
  _follow(g, a, dt, t, ctx) {
    // hanging in the wind over the stern: the bird keeps station on the boat, facing the air that comes past it
    const S = g.S, P = ctx.player;
    if (!P || (a.tt -= dt) <= 0 || !ctx.active) { this._fly(g, a, a.x, a.z, a.y); g.cx = a.x; g.cz = a.z; return; }
    const fx = Math.sin(P.psi), fz = -Math.cos(P.psi), sx = -fz, sz = fx;
    const st = (P.cls ? P.cls.sternX || -3 : -3);
    const tx = P.x + fx * (st - a.oz) + sx * a.ox + 2.5 * Math.sin(t * 0.21 + a.i * 2.1);
    const tz = P.z + fz * (st - a.oz) + sz * a.ox + 2.5 * Math.cos(t * 0.17 + a.i * 1.3);
    const ty = a.ty + 1.2 * Math.sin(t * 0.3 + a.i);
    const bvx = fx * (P.u || 0), bvz = fz * (P.u || 0);
    const W = this.wind;
    // ground velocity: the boat's and a correction toward the station
    const kx = clamp((tx - a.x) * 0.6, -5, 5), kz = clamp((tz - a.z) * 0.6, -5, 5);
    a.vx += (bvx + kx - a.vx) * Math.min(1, dt * 2); a.vz += (bvz + kz - a.vz) * Math.min(1, dt * 2);
    a.vy += (clamp((ty - a.y) * 0.6, -2, 2) - a.vy) * Math.min(1, dt * 2);
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    const ax = a.vx - W.x, az = a.vz - W.z, air = Math.hypot(ax, az);
    const h = air > 1 ? Math.atan2(ax, -az) : a.psi;
    const om = wrapA(h - a.psi) / Math.max(dt, 1e-3);
    a.psi += wrapA(h - a.psi) * Math.min(1, dt * 3);
    a.roll += (clamp(0.25 * om + 0.05 * Math.sin(t * 1.3 + a.i), -0.5, 0.5) - a.roll) * Math.min(1, dt * 2);
    a.pitch += (0.12 - a.pitch) * Math.min(1, dt * 2);
    a.v = air;
    // in a fresh apparent wind it hangs on still wings; in light air it must flap
    this._wings(g, a, dt, clamp((S.v * 0.7 - air) / 5, 0, 1));
    a.a2 += (0 - a.a2) * Math.min(1, dt * 4);
    a.vis = true;
  }
  _sit(g, a, dt, t, ctx) {
    const S = g.S;
    const sea = this._sea(a, ctx, S.L * 0.6, S.L * 0.3);
    a.y = sea + S.L * 0.06; a.pitch = Math.atan(a.al) * 0.8; a.roll = -Math.atan(a.at) * 0.8;
    a.x += this.wind.x * 0.03 * dt; a.z += this.wind.z * 0.03 * dt;
    a.psi += wrapA(this._intoWind() + 0.3 * Math.sin(t * 0.05 + a.i) - a.psi) * Math.min(1, dt * 0.2);
    a.a2 = 1; a.amp = 0; a.vis = true; a.v = 0; a.vx = a.vz = a.vy = 0;
    if (a.dly > 0) { a.dly -= dt; if (a.dly <= 0) this._up(g, a, ctx); return; }
    if (S.flush > 0 && g.near < S.flush * (0.8 + 0.4 * ((a.i * 37) % 10) / 10)) { this._up(g, a, ctx); return; }
    if ((a.tt -= dt) <= 0) { a.tt = rr(g, 120, 900); if (g.mode !== GM.FLOCK && rnd(g) < 0.7) this._up(g, a, ctx); }
  }
  _up(g, a, ctx) {
    const S = g.S;
    a.st = ST.TAKEOFF; a.tt = S.run ? rr(g, 1.5, 3.5) * (S.span > 2 ? 1.6 : 1) : rr(g, 0.4, 0.8);
    // into the wind, turned away from the boat if she is upwind of it
    let h = this._intoWind();
    const B = g.nearB;
    if (B) { const away = Math.atan2(a.x - B.x, -(a.z - B.z)); if (Math.abs(wrapA(away - h)) > 1.6) h = h + Math.sign(wrapA(away - h)) * 1.0; }
    a.psi = h; a.beats = 1000; a.a2 = 0; a.v = 1; a.dly = 0;
    if (S.call && rnd(g) < 0.35) this.emit('call', a.x, a.y, a.z, 1, 0, g, a);
  }
  _takeoff(g, a, dt, t, ctx) {
    const S = g.S, W = this.wind;
    a.v = Math.min(S.v, a.v + (S.run ? 3.5 : 6) * dt);
    const ax = Math.sin(a.psi) * a.v, az = -Math.cos(a.psi) * a.v;
    a.vx = ax + W.x * 0.3; a.vz = az + W.z * 0.3;
    a.x += a.vx * dt; a.z += a.vz * dt;
    const sea = this._sea(a, ctx);
    a.tt -= dt;
    if (a.tt > 0 && S.run) { a.y = sea + S.L * 0.12; a.pitch = 0.15; }       // (pattering along the surface)
    else { a.vy = Math.min(2.5, a.vy + 3 * dt); a.y = Math.max(a.y + a.vy * dt, sea + S.L * 0.12); a.pitch = 0.25; }
    a.ph += TAU * a.hz * 1.15 * dt; a.amp += (S.amp * 1.15 - a.amp) * Math.min(1, dt * 10);
    a.a2 += (0 - a.a2) * Math.min(1, dt * 6); a.roll *= 0.9;
    a.vis = true;
    if (a.y > sea + 4 || a.tt < -4) {
      a.beats = 6;
      this._fly(g, a, a.x, a.z, a.y);
      // away from the boat that put it up
      const B = g.nearB;
      if (B) { const ang = Math.atan2(a.x - B.x, -(a.z - B.z)); g.cx = a.x + Math.sin(ang) * 250; g.cz = a.z - Math.cos(ang) * 250; this._waypoint(g, a); }
    }
  }
  _land(g, a, dt, t, ctx) {
    const S = g.S, sea = this._sea(a, ctx);
    // a glide down into the wind, wings high, slowing, then a flare onto the water
    const h = this._intoWind();
    a.psi += wrapA(h - a.psi) * Math.min(1, dt * 1.2);
    a.v = Math.max(S.v * 0.45, a.v - 1.5 * dt);
    a.vx = Math.sin(a.psi) * a.v + this.wind.x; a.vz = -Math.cos(a.psi) * a.v + this.wind.z;
    a.vy = clamp((sea + 0.2 - a.y) * 0.5, -2.5, 0);
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    a.pitch += (0.25 - a.pitch) * Math.min(1, dt * 2); a.roll *= 0.95;
    a.amp += (0 - a.amp) * Math.min(1, dt * 4); a.a3 = 0.5;
    a.vis = true;
    if (a.y < sea + S.L * 0.3 || !this.okAt(S, a.x, a.z)) {
      if (!this.okAt(S, a.x, a.z)) { this._fly(g, a, a.x, a.z, a.y); return; }
      a.st = ST.SIT; a.tt = rr(g, 60, 400); a.a3 = 0;
    }
  }
  _hover(g, a, dt, t, ctx) {
    // a tern hangs facing the wind, head down, wings beating fast and deep, then plunges
    const S = g.S, sea = this._sea(a, ctx);
    a.psi += wrapA(this._intoWind() - a.psi) * Math.min(1, dt * 2);
    a.vx *= 1 - Math.min(1, dt * 2); a.vz *= 1 - Math.min(1, dt * 2);
    a.vy = clamp((a.ty - a.y) * 0.8, -1, 1);
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    a.pitch += (0.55 - a.pitch) * Math.min(1, dt * 3); a.roll *= 0.9;
    a.ph += TAU * a.hz * 1.3 * dt; a.amp += (S.amp * 1.05 - a.amp) * Math.min(1, dt * 6);
    a.vis = true;
    if ((a.tt -= dt) <= 0) { if (rnd(g) < 0.6 && this.wet(a.x, a.z, 15)) { a.st = ST.DIVE; a.n = 0; a.vy = -1; } else this._fly(g, a, a.x, a.z, a.y); }
    if (a.y < sea + 1.5) a.y = sea + 1.5;
  }
  _dive(g, a, dt, t, ctx) {
    const S = g.S;
    const sea = this._sea(a, ctx);
    if (a.n === 1) {
      // a shearwater or a petrel drops onto the sea and dives from the surface
      a.vy = Math.max(-4, a.vy - 6 * dt); a.y += a.vy * dt;
      a.x += Math.sin(a.psi) * 5 * dt; a.z -= Math.cos(a.psi) * 5 * dt;
      a.pitch += (-0.6 - a.pitch) * Math.min(1, dt * 3); a.a2 += (0.7 - a.a2) * Math.min(1, dt * 3);
      a.amp *= 0.9; a.roll *= 0.9; a.vis = true;
      if (a.y <= sea) { this.emit('splash', a.x, sea, a.z, S.L * 0.6, 0, g, a); a.st = ST.UNDER; a.tt = rr(g, 6, 25); }
      return;
    }
    // the plunge: steepening under gravity, the wings swept back, folded just before the water
    a.vy -= G * dt * (S.dive === 'hover' ? 0.8 : 1);
    const hv = Math.max(1.5, a.v * (1 - dt * 1.2));
    a.v = hv;
    a.x += Math.sin(a.psi) * hv * dt; a.z -= Math.cos(a.psi) * hv * dt; a.y += a.vy * dt;
    a.pitch = Math.atan2(a.vy, hv);
    const hgt = a.y - sea;
    a.a2 = S.dive === 'twist' ? clamp(1 - hgt / 8, 0.3, 0.6) : clamp(1.05 - hgt / 6, 0.25, 1);
    a.amp *= Math.exp(-dt * 6);
    if (S.dive === 'twist') a.roll += (2.6 * a.side - a.roll) * Math.min(1, dt * 1.5);      // (a pelican twists as it goes in)
    else a.roll *= 0.9;
    a.vis = true;
    if (hgt <= 0) {
      const sp = Math.hypot(hv, a.vy);
      this.emit('splash', a.x, sea, a.z, S.L * (S.dive === 'twist' ? 1.6 : S.dive === 'plunge' ? 1.2 : 0.5), sp, g, a);
      a.st = ST.UNDER; a.tt = S.dive === 'hover' ? rr(g, 0.3, 0.8) : S.dive === 'twist' ? rr(g, 1, 2) : rr(g, 3, 9);
      a.vy = 0; a.roll = 0;
    }
  }
  _under(g, a, dt, t, ctx) {
    const S = g.S, sea = this._sea(a, ctx);
    a.tt -= dt;
    a.x += Math.sin(a.psi) * 1.5 * dt; a.z -= Math.cos(a.psi) * 1.5 * dt;
    a.y = sea - Math.min(2.5, 1 + a.tt * 0.2); a.pitch = -0.2; a.a2 = 1; a.amp = 0; a.vis = false;
    if (a.tt <= 0) {
      if (S.dive === 'hover' || !this.wet(a.x, a.z, 3)) { a.st = ST.TAKEOFF; a.tt = 0; a.y = sea + 0.1; a.vy = 2; a.beats = 1000; a.v = S.v * 0.6; return; }
      a.st = ST.SIT; a.tt = rr(g, 4, 20); a.y = sea; a.pitch = 0; a.vis = true;
      if (g.mode !== GM.FLOCK) a.tt = rr(g, 3, 12);
    }
  }

  // ---------------------------------------------------------------- dolphins and porpoises
  _avoidTerrain(g, ahead) {
    // keep in the species' water: look ahead along the course and to each side; turn toward the better
    const S = g.S, fx = Math.sin(g.psi), fz = -Math.cos(g.psi);
    if (this.okAt(S, g.x + fx * ahead, g.z + fz * ahead, 1)) return 0;
    for (const da of TURNS) {
      const h = g.psi + da;
      if (this.okAt(S, g.x + Math.sin(h) * ahead, g.z - Math.cos(h) * ahead, 1)) return da;
    }
    return Math.PI;
  }
  _pod(g, dt, t, ctx) {
    const S = g.S, P = ctx.player, porp = S.morph === 'porpoise';
    // bow-riding: a pod meets a boat at 5 kn or more, and sometimes comes to ride her bow wave
    g.bowCD -= dt;
    if (P && S.bow > 0 && g.mode !== GM.BOW && g.bowCD <= 0) {
      const d = Math.hypot(P.x - g.x, P.z - g.z), fast = (P.u || 0) >= 5 * 0.514444;
      if (fast && d < 320 && !g.bowDone) { g.bowDone = true; if (rnd(g) < S.bow) { g.mode = GM.BOW; g.tt = rr(g, 60, 300); g.t2 = 0; } }
      if (d > 600) g.bowDone = false;
    }
    if (g.mode === GM.BOW) { this._bowride(g, dt, t, ctx); return; }
    // course: wander, keep to the water, keep from boats
    g.tt -= dt;
    if (g.tt <= 0) {
      g.tt = rr(g, 30, 150);
      const r = rnd(g);
      g.mode = porp ? (r < 0.6 ? GM.TRAVEL : GM.MILL) : r < 0.5 ? GM.TRAVEL : r < 0.75 ? GM.MILL : GM.FAST;
      if (g.mode === GM.FAST) g.tt = rr(g, 20, 60);
    }
    let turn = (Math.sin(t * 0.05 + g.slot) * 0.04 + (g.mode === GM.MILL ? Math.sin(t * 0.21 + g.slot * 3) * 0.25 : 0));
    g.ripe -= dt; if (g.ripe <= 0) { g.ripe = 1; g.da = this._avoidTerrain(g, Math.max(40, g.v * 15)); }
    if (g.da) turn += Math.sign(g.da) * 0.4;
    if (g.near < S.shy + 20 && g.nearB) {
      const away = Math.atan2(g.x - g.nearB.x, -(g.z - g.nearB.z));
      turn += clamp(wrapA(away - g.psi), -1, 1) * 0.6;
      if (porp) g.mode = GM.TRAVEL;
    }
    if (g.mode === GM.LEAVE && g.tt < 0) g.mode = GM.TRAVEL;
    g.psi += clamp(turn, -0.5, 0.5) * dt;
    const vt = g.mode === GM.FAST || g.mode === GM.LEAVE ? S.v[1] : g.mode === GM.MILL ? 0.8 : S.v[0];
    g.v += (vt - g.v) * Math.min(1, dt * 0.5);
    g.x += Math.sin(g.psi) * g.v * dt; g.z -= Math.cos(g.psi) * g.v * dt;
    const fx = Math.sin(g.psi), fz = -Math.cos(g.psi);
    for (let i = 0; i < g.n; i++) {
      const a = g.members[i];
      // its place in the pod (each weaving a little), its own breathing
      const wx = a.ox + 1.2 * Math.sin(t * 0.13 + i * 1.7), wz = a.oz + 1.5 * Math.sin(t * 0.09 + i * 2.3);
      const tx = g.x - fz * wx + fx * wz, tz = g.z + fx * wx + fz * wz;      // (wx to starboard, wz ahead)
      const k = Math.min(1, dt * 1.5);
      a.x += (tx - a.x) * k + Math.sin(g.psi) * g.v * dt * (1 - k);
      a.z += (tz - a.z) * k - Math.cos(g.psi) * g.v * dt * (1 - k);
      a.psi += wrapA(g.psi + 0.1 * Math.sin(t * 0.3 + i) - a.psi) * Math.min(1, dt * 2);
      a.v = g.v;
      this._breathe(g, a, dt, t, ctx);
    }
  }
  // a dolphin's breathing: under at its cruising depth, a rolling surfacing (blowhole and fin), or at speed a leap
  _breathe(g, a, dt, t, ctx) {
    const S = g.S, fast = a.v > 3.8 && S.leap;
    const sea = this._sea(a, ctx, S.L * 0.8, S.L * 0.2);
    const backH = S.L * 0.09 * a.scale;
    a.hz = 0.3 + 0.32 * a.v / Math.sqrt(S.L / 2.5); a.amp = 0.9;
    if (a.st === ST.SUB) {
      a.y += (sea - a.sub - a.y) * Math.min(1, dt * 2); a.pitch *= 0.9; a.vis = a.sub < 3.5;
      a.tt -= dt;
      if (a.tt <= 0) {
        if (fast && rnd(g) < 0.75) { a.st = ST.LEAP; a.vy = Math.sqrt(2 * G * rr(g, 0.6, 1.6)) + 0.3 * a.v; a.y = sea - S.L * 0.15; this.emit('splash', a.x, sea, a.z, S.L * 0.25, 2, g, a); }
        else { a.st = ST.ROLL; a.t2 = 0; a.cyc = (S.morph === 'porpoise' ? 1.0 : 1.5) * Math.sqrt(S.L / 2.5) * (1 + 1.5 / Math.max(a.v, 1)) * 0.55; }
        a.n = a.n || 0;
      }
    } else if (a.st === ST.ROLL) {
      // a roll over the surface: rising nose first, the blowhole out (a breath), the back and fin rolling over
      a.t2 += dt / a.cyc;
      const u = clamp(a.t2, 0, 1), s = Math.sin(Math.PI * u);
      a.y = sea - a.sub * (1 - s) - backH * 0.15 * s;
      a.pitch = 0.45 * Math.cos(Math.PI * u) * (a.sub + backH) / (S.L * 0.9);
      a.vis = true;
      if (a.n === 0 && u > 0.3) { a.n = 1; this.emit('blow', a.x + Math.sin(a.psi) * S.L * 0.3, sea + 0.1, a.z - Math.cos(a.psi) * S.L * 0.3, S.L, 0, g, a, a.psi); }
      if (u >= 1) { a.st = ST.SUB; a.n = 0; a.tt = rr(g, S.breath[0], S.breath[1]) * (fast ? 0.3 : 1); a.sub = rr(g, 1.2, 2.5); }
    } else if (a.st === ST.LEAP) {
      a.vy -= G * dt; a.y += a.vy * dt;
      a.pitch = Math.atan2(a.vy, Math.max(a.v, 2));
      a.vis = true;
      if (a.vy < 0 && a.y < sea - S.L * 0.1) {
        this.emit('splash', a.x, sea, a.z, S.L * 0.4, -a.vy, g, a);
        a.st = ST.SUB; a.tt = rr(g, 1.5, 5); a.sub = 1.2;
      }
    }
  }
  _bowride(g, dt, t, ctx) {
    const S = g.S, P = ctx.player;
    g.tt -= dt;
    const u = P ? P.u || 0 : 0;
    if (!P || u < 3.5 * 0.514444) g.t2 += dt; else g.t2 = 0;
    if (!P || g.tt <= 0 || g.t2 > 5) { g.mode = GM.LEAVE; g.tt = rr(g, 20, 40); g.bowCD = 300; if (P) g.psi = P.psi + (rnd(g) < 0.5 ? 0.8 : -0.8); return; }
    const C = P.cls || {}, fx = Math.sin(P.psi), fz = -Math.cos(P.psi), sx = -fz, sz = fx;
    const bowX = (C.bowX ?? 3) + 0.5;
    g.x = P.x + fx * bowX; g.z = P.z + fz * bowX; g.psi = P.psi; g.v = u;
    let k = 0;
    for (let i = 0; i < g.n; i++) {
      const a = g.members[i];
      const riding = i < 4, slot = k++;
      // in the pressure wave ahead of the stem (up to four), the rest alongside and on the quarter
      const along = riding ? 1.0 + (slot >> 1) * 1.8 + 0.6 * Math.sin(t * 0.4 + i) : -(C.lwl || 6) * (0.3 + 0.25 * (i - 4)) - 2,
        across = riding ? (slot & 1 ? 1 : -1) * (0.7 + 0.5 * (slot >> 1)) + 0.5 * Math.sin(t * 0.33 + i * 2) : (i & 1 ? 1 : -1) * ((C.beam || 2.5) * 0.5 + 3 + i);
      const tx = g.x + fx * along + sx * across, tz = g.z + fz * along + sz * across;
      const reach = Math.hypot(tx - a.x, tz - a.z);
      // swim to the bow (at up to 9 m/s, or 3 faster than the boat), then keep station on it
      const vmax = Math.max(u + 3, 9);
      if (reach < 12) { const kk = Math.min(1, dt * 2); a.x += fx * u * dt + (tx - a.x) * kk; a.z += fz * u * dt + (tz - a.z) * kk; }
      else { const st = Math.min(reach, vmax * dt); a.x += (tx - a.x) / reach * st; a.z += (tz - a.z) / reach * st; }
      a.psi += wrapA((reach > 8 ? Math.atan2(tx - a.x, -(tz - a.z)) : P.psi) - a.psi) * Math.min(1, dt * 3);
      a.v = reach > 8 ? vmax : u;
      if (reach < 6 && a.st === ST.SUB) a.sub = 0.7 + 0.3 * Math.sin(t * 0.5 + i);
      this._breathe(g, a, dt, t, ctx);
      // (riding the pressure wave they hardly beat their flukes)
      if (reach < 6) { a.amp = 0.35; a.hz = 0.8; }
    }
  }

  // ---------------------------------------------------------------- whales
  _whale(g, dt, t, ctx) {
    const S = g.S, rightW = S.morph === 'right';
    // the course: slow wandering, out of water too shallow, away from boats close by (and down sooner)
    let turn = Math.sin(t * 0.01 + g.slot * 1.3) * 0.015;
    g.ripe -= dt;
    if (g.ripe <= 0) { g.ripe = 2; g.da = this._avoidTerrain(g, Math.max(150, g.v * 60)); }
    if (g.da) turn += Math.sign(g.da) * 0.06;
    const boatNear = g.near < S.shy;
    if (boatNear && g.nearB) { const away = Math.atan2(g.x - g.nearB.x, -(g.z - g.nearB.z)); turn += clamp(wrapA(away - g.psi), -1, 1) * 0.05; }
    g.psi += clamp(turn, -0.08, 0.08) * dt;
    const vt = g.mode === GM.DOWN ? S.v[0] * 1.1 : S.v[0];
    g.v += (vt - g.v) * Math.min(1, dt * 0.2);
    g.x += Math.sin(g.psi) * g.v * dt; g.z -= Math.cos(g.psi) * g.v * dt;
    const a = g.members[0];
    a.x = g.x; a.z = g.z; a.psi += wrapA(g.psi - a.psi) * Math.min(1, dt); a.v = g.v;
    const L = S.L * a.scale, sea = this._sea(a, ctx, L * 0.6, L * 0.15);
    a.hz = 0.12 + 0.09 * a.v; if (a.st !== ST.FLUKE && a.st !== ST.BREACH) a.amp = 0.5;
    g.tt -= dt;
    switch (a.st) {
      case ST.DEEP:
        a.y += (sea - 30 - a.y) * Math.min(1, dt * 0.3); a.pitch *= 0.95; a.vis = false; a.roll = 0; a.a2 = 0;
        if (g.tt <= 0) {
          g.mode = GM.SURFACING; a.n = ri(g, S.blows[0], S.blows[1]);
          if (rnd(g) < S.breach) { a.st = ST.BREACH; a.t2 = 0; a.vy = rr(g, 7.5, 9.5); a.y = sea - L * 0.45; a.roll = 0; a.pitch = 1.1; a.cyc = (rnd(g) < 0.5 ? 1 : -1); this.emit('splash', a.x, sea, a.z, L * 0.35, 5, g, a); }
          else { a.st = ST.ROLL; a.t2 = 0; a.y = sea - 6; }
          a.tt = 0; g.tt = 1e9;
        }
        break;
      case ST.SUB:      // between blows, a few metres down
        a.y += (sea - 4 - a.y) * Math.min(1, dt * 0.5); a.pitch *= 0.95; a.vis = true;
        a.tt -= dt;
        if (a.tt <= 0 || (boatNear && a.n <= 1)) { a.st = ST.ROLL; a.t2 = 0; }
        break;
      case ST.ROLL: {
        // one breath: the head rises (the blowhole at a quarter of the length), the blow, the back rolls over
        // and (on a rorqual) the dorsal fin shows, then it slips under. About 6-8 s for a big whale
        const Tr = 3.5 + L * 0.25;
        a.t2 += dt / Tr;
        const u = clamp(a.t2, 0, 1), s = Math.sin(Math.PI * u);
        const top = L * (rightW ? 0.085 : 0.07);
        a.y = sea - 3.2 * (1 - s) - top * 0.55 * s + (u < 0.25 ? 0 : 0);
        a.pitch = 0.09 * Math.cos(Math.PI * u) - (a.n === 1 ? 0.05 * u : 0);
        a.vis = true;
        if (a.cyc !== 7 && u > 0.18) {
          a.cyc = 7;
          const fx = Math.sin(a.psi), fz = -Math.cos(a.psi);
          this.emit('blow', a.x + fx * L * 0.23, sea + 0.3, a.z + fz * L * 0.23, L, S.spout === 'V' ? 2 : S.spout === 'bushy' ? 1 : S.spout === 'tall' ? 3 : 4, g, a, a.psi);
        }
        if (u >= 1) {
          a.cyc = 0; a.n--;
          if (a.n <= 0 || boatNear) {
            a.st = ST.FLUKE; a.t2 = 0; a.a2 = rnd(g) < S.fluke ? 1 : 0;
          } else { a.st = ST.SUB; a.tt = rr(g, S.breath[0], S.breath[1]); }
        }
        break;
      }
      case ST.FLUKE: {
        // the terminal dive: the back arched high (a humpback's hump), the tail stock rolling up and, if it
        // flukes, the flukes lifted clear and slipping down vertically. The body turns about a point near its
        // flukes' base, at the surface: steep nose down, the tail out of the water
        const Td = a.a2 ? 9 : 6;
        a.t2 += dt / Td;
        const u = clamp(a.t2, 0, 1);
        const tilt = a.a2 ? 1.25 * sst(0.1, 0.65, u) : 0.45 * sst(0.1, 0.7, u);    // nose-down pitch (rad)
        // the pivot slides from the middle of the back to beyond the flukes as it goes down
        const sp = a.a2 ? 0.55 + 0.6 * sst(0.25, 1.0, u) : 0.5 + 0.6 * u;
        const off = (sp - 0.5) * L;      // pivot's distance behind the middle along the body
        a.pitch = -tilt;
        a.y = sea - Math.sin(tilt) * off - L * 0.035 - (a.a2 ? 0 : 2.5 * u);
        a.a3 = sst(0, 0.4, u) * (1 - sst(0.6, 1, u));      // (the arch)
        a.vis = true;
        if (u >= 1) { a.st = ST.DEEP; g.mode = GM.DOWN; g.tt = rr(g, S.dive[0], S.dive[1]); a.a3 = 0; a.a2 = 0; a.cyc = 0; a.pitch = -0.4; }
        break;
      }
      case ST.BREACH: {
        // out of the water at ~8 m/s, two thirds of the body clear, a twist, and down on its side or back
        a.vy -= G * dt; a.y += a.vy * dt;
        a.t2 += dt;
        const up = a.vy > 0;
        a.pitch += ((up ? 1.2 : -0.1) - a.pitch) * Math.min(1, dt * (up ? 3 : 1.4));
        a.roll += (a.cyc * 1.9 - a.roll) * Math.min(1, dt * 0.9);
        a.amp = 0.2; a.vis = true;
        if (!up && a.y < sea - L * 0.05 && a.t2 > 0.5) {
          this.emit('breach', a.x + Math.sin(a.psi) * L * 0.1, sea, a.z - Math.cos(a.psi) * L * 0.1, L, -a.vy, g, a);
          a.st = ST.SUB; a.tt = rr(g, 15, 30); a.roll = 0; a.pitch = -0.2; a.y = sea - 4;
        }
        break;
      }
    }
    // a calf beside the mother, its breaths with hers
    if (g.n > 1) {
      const c = g.members[1], fx = Math.sin(a.psi), fz = -Math.cos(a.psi), sx = -fz, sz = fx;
      c.x = a.x + sx * 6 - fx * 3; c.z = a.z + sz * 6 - fz * 3; c.psi = a.psi; c.v = a.v; c.hz = a.hz * 1.5; c.amp = 0.6;
      const cs = this._sea(c, ctx, 5, 1.5);
      if (a.st === ST.ROLL || a.st === ST.SUB) {
        c.y = a.y - sea + cs + 0.3; c.pitch = a.pitch; c.vis = true; c.roll = 0; c.st = ST.ROLL;
        if (a.st === ST.ROLL && a.cyc === 7 && c.cyc !== 7) { c.cyc = 7; this.emit('blow', c.x + fx * 1.4, cs + 0.2, c.z + fz * 1.4, S.L * c.scale, S.spout === 'V' ? 2 : 1, g, c, c.psi); }
        if (a.st === ST.SUB) c.cyc = 0;
      } else { c.y += (cs - 20 - c.y) * Math.min(1, dt * 0.5); c.vis = c.y > cs - 6; c.pitch = a.st === ST.FLUKE ? -0.5 : 0; c.roll = 0; c.st = ST.DEEP; }
    }
  }

  // ---------------------------------------------------------------- turtles
  _turtle(g, dt, t, ctx) {
    const S = g.S, a = g.members[0];
    let turn = Math.sin(t * 0.03 + g.slot) * 0.05;
    g.ripe -= dt;
    if (g.ripe <= 0) { g.ripe = 2; g.psi = a.psi; g.x = a.x; g.z = a.z; g.da = this._avoidTerrain(g, 25); }
    if (g.da) turn += Math.sign(g.da) * 0.3;
    const sea = this._sea(a, ctx, S.L * 0.8, S.L * 0.6);
    const scared = g.near < S.shy * (a.st === ST.BASK ? 1.4 : 1) && g.nearB;
    if (scared && a.st !== ST.FLEE && !(a.st === ST.SWIM && a.sub > 3)) {
      a.st = ST.FLEE; a.tt = rr(g, 15, 30); a.sub = Math.min(Math.max(4, this.depthAt(a.x, a.z) - 1), 8);
      const away = Math.atan2(a.x - g.nearB.x, -(a.z - g.nearB.z)); a.psi0 = away;
    }
    const top = S.L * 0.13 * a.scale;       // (the top of the shell above the body's axis)
    switch (a.st) {
      case ST.SWIM:
        a.y += (sea - a.sub - a.y) * Math.min(1, dt * 0.6); a.pitch += (0 - a.pitch) * Math.min(1, dt);
        a.v = S.v; a.a2 = 1; a.hz = S.morph === 'leatherback' ? 0.35 : 0.3; a.amp = 0.55; a.a3 = 0;
        if ((a.tt -= dt) <= 0) { a.st = ST.BREATHE; a.n = ri(g, S.breaths[0], S.breaths[1]); a.tt = 4 + 2 * a.n + rr(g, 0, 3); a.t2 = 0; a.cyc = 0; }
        break;
      case ST.BREATHE: {
        // rising to the surface: the head up for a breath or two, the shell just awash, then under
        a.y += (sea - top * 0.6 - a.y) * Math.min(1, dt * 0.8);
        a.pitch += (0.18 - a.pitch) * Math.min(1, dt); a.v = S.v * 0.4; a.a2 = 1; a.amp = 0.35; a.hz = 0.25;
        a.t2 += dt;
        a.a3 = clamp((a.t2 - 1.5) / 1, 0, 1) * (a.n > 0 ? 1 : clamp(1 - (a.t2 - a.tt) / 1, 0, 1));
        if (a.n > 0 && a.t2 > 2.5 + 2 * a.cyc) { a.n--; a.cyc++; this.emit('puff', a.x, sea + 0.1, a.z, S.L, 0, g, a); }
        if (a.t2 > a.tt) {
          if (this.calm > 0.6 && rnd(g) < S.bask) { a.st = ST.BASK; a.tt = rr(g, 60, 400); }
          else { a.st = ST.SWIM; a.tt = rr(g, S.dive[0], S.dive[1]); a.sub = rr(g, 1, Math.min(4, this.depthAt(a.x, a.z) - 0.5)); a.a3 = 0; }
        }
        break;
      }
      case ST.BASK:
        // floating, the shell's top dry in the sun, the flippers out and still
        a.y = sea - top * 0.35; a.pitch = Math.atan(a.al) * 0.7; a.roll = -Math.atan(a.at) * 0.7;
        a.v = 0.03; a.amp = 0.05; a.hz = 0.1; a.a3 = 0.6;
        if ((a.tt -= dt) <= 0 || this.calm < 0.3) { a.st = ST.SWIM; a.tt = rr(g, S.dive[0], S.dive[1]); a.sub = 2; a.a3 = 0; a.roll = 0; }
        break;
      case ST.FLEE:
        // a power stroke down and away: both fore-flippers together
        a.psi += wrapA(a.psi0 - a.psi) * Math.min(1, dt * 1.5);
        a.y += (sea - a.sub - a.y) * Math.min(1, dt * 0.7); a.pitch += (-0.5 * clamp((a.y - (sea - a.sub)) / 2, 0, 1) - a.pitch) * Math.min(1, dt * 2);
        a.v = S.v * 3.5; a.a2 = 0; a.amp = 0.9; a.hz = 0.7; a.a3 = 0; a.roll *= 0.9;
        if ((a.tt -= dt) <= 0) { a.st = ST.SWIM; a.tt = rr(g, S.dive[0], S.dive[1]); }
        break;
    }
    a.psi += turn * dt;
    a.x += Math.sin(a.psi) * a.v * dt; a.z -= Math.cos(a.psi) * a.v * dt;
    a.ph += TAU * a.hz * dt; if (a.ph > 1e4) a.ph -= TAU * 1000;
    a.vis = a.y > sea - 6;
    g.x = a.x; g.z = a.z; g.psi = a.psi;
  }

  // ---------------------------------------------------------------- sharks
  _shark(g, dt, t, ctx) {
    const S = g.S;
    for (let i = 0; i < g.n; i++) {
      const a = g.members[i];
      if (!a.on) continue;
      const L = S.L * a.scale;
      g.x = a.x; g.z = a.z; g.psi = a.psi;
      let turn = Math.sin(t * 0.04 + g.slot + i * 2) * 0.06;
      if (a.n === 1) turn = a.cyc * a.v / a.t2;                   // circling, radius t2
      a.ripe = (a.ripe || 0) - dt;
      if (a.ripe <= 0) { a.ripe = 1.5; a.da = this._avoidTerrain(g, Math.max(20, L * 4)); }
      if (a.da) turn = Math.sign(a.da) * 0.35;
      if (g.near < S.shy && g.nearB) {
        const away = Math.atan2(a.x - g.nearB.x, -(a.z - g.nearB.z));
        turn = clamp(wrapA(away - a.psi), -1, 1) * 0.4;
        if (a.st === ST.CRUISE && Math.hypot(a.x - g.nearB.x, a.z - g.nearB.z) < S.shy * 0.8) { a.st = ST.LOW; a.tt = rr(g, 30, 90); a.n = 0; }
      }
      a.psi += clamp(turn, -0.4, 0.4) * dt;
      a.x += Math.sin(a.psi) * a.v * dt; a.z -= Math.cos(a.psi) * a.v * dt;
      // the surface it holds a depth under: the sea's level smoothed over several seconds (a fish swims at a
      // depth, it does not ride the waves: the fin cuts through the crests and stands out in the troughs)
      const sea = this._sea(a, ctx, L, L * 0.2);
      a.ylp += (sea - a.ylp) * Math.min(1, dt * 0.35);
      const backTop = S.back * L;
      const want = a.st === ST.CRUISE ? a.ylp - backTop - 0.06 * L * (S.filter ? 0.2 : 0.4) : a.ylp - backTop - Math.max(1.5, L * 0.6) - a.sub;
      a.y += (want - a.y) * Math.min(1, dt * 0.5);
      a.pitch += (clamp((want - a.y) * 0.08, -0.25, 0.25) - a.pitch) * Math.min(1, dt);
      a.roll = -turn * 0.25;
      a.hz = (S.filter ? 0.28 : 0.55) * Math.sqrt(2.5 / L) * (0.6 + 0.6 * a.v); a.amp = 1; a.a2 = turn * 0.6;
      a.ph += TAU * a.hz * dt; if (a.ph > 1e4) a.ph -= TAU * 1000;
      a.vis = a.y > sea - 8;
      if ((a.tt -= dt) <= 0) {
        // a new bout: at the surface or below by the species' habit; now and then a few circles
        a.st = rnd(g) < S.surf ? ST.CRUISE : ST.LOW; a.sub = rr(g, 0, 3);
        a.tt = a.st === ST.CRUISE ? rr(g, 40, 240) : rr(g, 60, 300) * (1 - S.surf + 0.2);
        a.n = rnd(g) < S.circle ? 1 : 0;
        if (a.n) { a.t2 = rr(g, 12, 40); a.cyc = rnd(g) < 0.5 ? 1 : -1; a.tt = rr(g, 30, 90); }
        a.v = S.v * rr(g, 0.8, 1.15);
      }
    }
  }
}

// a crew call for a sighting: where, relative to the bow (heading psi): 'off the starboard bow' and so on
export function bearingWords(px, pz, psi, x, z) {
  const brg = Math.atan2(x - px, -(z - pz));
  const r = wrapA(brg - psi) * 180 / Math.PI, a = Math.abs(r), side = r > 0 ? 'starboard' : 'port';
  return a < 12 ? 'dead ahead' : a < 60 ? `off the ${side} bow` : a < 120 ? `on the ${side} beam` : a < 168 ? `off the ${side} quarter` : 'astern';
}
