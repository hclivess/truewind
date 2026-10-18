// Reference data and acceptance ranges for the sea trials (test/seatrial.mjs). Every range says where it comes from;
// 'est.' marks engineering judgement where no published figure exists. Speeds in knots, angles in degrees.

// ------------------------------------------------------------------ published speeds (flat water, steady wind)
// ORC velocity predictions are for flat water, steady wind, an optimally trimmed boat: the trial's flat & steady
// condition is the one to hold them against. Beat VMG over the water (heading-reckoned, as ORC's), 90 deg reach speed.
// Values at tws between two tabulated winds are interpolated; outside the table, not checked.
export const KNOWN = {
  // ORC International certificate CABALLO LOCO BRA-5211 (2018 Botin TP52, RefNo 03510004VO2, data.orc.org), as cited
  // in js/classes/tp52.js [ORC]
  tp52: { src: 'ORC Intl cert. Caballo Loco BRA-5211 (js/classes/tp52.js)', tws: [6, 8, 10, 12, 14, 16, 20], vmg: [5.07, 6.14, 6.70, 7.02, 7.24, 7.40, 7.60], r90: [8.53, 9.67, 10.73, 11.73, 12.61, 13.31, 14.49] },
  // ORC Club certificate GER 907 (js/classes/j24.js; numbers in README "The newer classes against published data")
  j24: { src: 'ORC Club cert. GER 907 (README)', tws: [12, 20], vmg: [4.18, 4.34], r90: [6.43, 7.37] },
  // ORC certificate J-CURVE (js/classes/j122.js; README); 20 kn beat VMG not quoted
  j122: { src: 'ORC cert. J-Curve (README)', tws: [12, 20], vmg: [5.33, null], r90: [8.30, 9.01] },
  // ORC Club certificate NED 866, non-spinnaker (js/classes/folkboat.js; README)
  folkboat: { src: 'ORC Club cert. NED 866 (README)', tws: [12, 20], vmg: [3.49, null], r90: [5.72, 6.50] },
  // the sportboat is J/70-sized: the J/70's ORC certificate (2024), README
  sportboat: { src: 'J/70 ORC cert. 2024 (README; the sportboat is J/70-sized)', tws: [12, 20], vmg: [4.52, null], r90: [6.88, 8.53] },
  // Yachting World, "At the helm of J Class yacht Endeavour" (js/classes/jclass.js): "upwind figures of 9.5 to 10.5
  // knots and up to 12 knots reaching are typical for a J" in 10-17 kn: a boat-speed band upwind, not a VMG
  shamrock5: { src: 'Yachting World, aboard Endeavour (js/classes/jclass.js)', band: { tws: [10, 17], upBsp: [9.5, 10.5], r90max: 12 } },
  velsheda: { src: 'Yachting World, aboard Endeavour (js/classes/jclass.js)', band: { tws: [10, 17], upBsp: [9.5, 10.5], r90max: 12 } },
  endeavour: { src: 'Yachting World, aboard Endeavour (js/classes/jclass.js)', band: { tws: [10, 17], upBsp: [9.5, 10.5], r90max: 12 } },
};
export function knownAt(cls, tws) {
  const K = KNOWN[cls]; if (!K || !K.tws) return null;
  const T = K.tws; if (tws < T[0] || tws > T[T.length - 1]) return null;
  let i = 0; while (i < T.length - 2 && tws > T[i + 1]) i++;
  const f = T.length === 1 ? 0 : (tws - T[i]) / (T[i + 1] - T[i]);
  const at = (a) => (a[i] === null || a[i + 1] === null ? (f === 0 ? a[i] : f === 1 ? a[i + 1] : null) : a[i] + (a[i + 1] - a[i]) * f);
  return { src: K.src + (f > 0 && f < 1 ? ' (interpolated)' : ''), vmg: at(K.vmg), r90: at(K.r90) };
}

// ------------------------------------------------------------------ acceptance ranges
export const R = {
  // Speed against the class's own baked polar (data/sails/<class>.json: the cloth sails' VPP at the game's step, the
  // same crew; the J/24, J/122, TP52 and Folkboat tables are within 0-9% of their ORC certificates in 12 kn, README)
  // at the wind and angle actually sailed. The task's +-10-15%: pass within 12%, warn within 20%. In gusts and in a
  // seaway the steady flat-water polar is an upper bound: added resistance in waves costs a 30-40 footer 5-20% in a
  // 1-2 m sea (Gerritsma & Keuning, added resistance; Larsson & Eliasson, Principles of Yacht Design, ch. 'Added
  // resistance in waves'), so there the band is 0.70-1.12 (warn 0.55-1.25).
  speedFlat: { pass: 0.12, warn: 0.20 },
  speedRough: { pass: [0.70, 1.12], warn: [0.55, 1.25] },
  // against the published data above: pass within 15%, warn within 25%
  known: { pass: 0.15, warn: 0.25 },
  // Heel: a crew depowering properly holds about the class's targetHeel (its designers' / class's upwind heel); the
  // task: no sustained heel beyond targetHeel + 10. 'Sustained': a 5 s running mean above it for more than 5 s of a leg
  // (fail); a 5 s mean above targetHeel + 5 for more than 10 s: warn.
  heel: { sustainS: 5, warnS: 10 },
  // Course keeping on the beam reach (the heading's rms about the course): the task's +-2-3 deg for autopilot and a
  // competent helm in moderate conditions, flat water to 25 kn. In a seaway more: test/seakeeping.mjs allows 6-7 deg
  // rms yaw in a 20 kn chop (Hs ~0.8 m) after Gerritsma, Keuning & Versluis 1993 and Marchaj, Seaworthiness (1986) ch.
  // 7; scaled here as 3 + 3 Hs (m) deg, more in a big sea. Warn up to 1.7x the pass limit.
  course: { flat: 3, seaBase: 3, seaPerHs: 3, warnF: 1.7 },
  // A limit cycle: the heading error's autocorrelation has a clear second peak (> 0.4) at a lag of 1.5-30 s with an
  // amplitude over 1.5 deg: a regular zig-zag, which a real helm or autopilot on a reach does not show (est.).
  zigzag: { ac: 0.4, amp: 1.5 },
  // Directional stability, helm fixed on the beam reach after settling: a real keelboat with the helm held at its
  // trimmed angle wanders and slowly rounds up (its weather helm, gusts heel and luff her), over tens of seconds; it
  // does not diverge in seconds (Larsson & Eliasson, ch. 'Balance' / yaw stability; Marchaj, Seaworthiness ch. 7, the
  // fin keel's directional stability). Pass: under 15 deg off course in the first 10 s and under 60 deg in 30 s; warn:
  // under 30 deg in 10 s. (Light dinghies and cats, with almost no directional inertia, warn only: est.)
  probe: { d10pass: 15, d10warn: 30, d30pass: 60 },
  // Weather helm upwind, steady: designers aim at 2-4 deg (test/helm.mjs; Larsson & Eliasson ch. 'Balance': 'a few
  // degrees of weather helm'), the task 2-5. Pass 1.5-6 deg, warn -1-9 (lee helm, or a hard-mouthed boat); in 25 kn and
  // more, more helm is normal: warn only.
  helm: { pass: [1.5, 6], warn: [-1, 9] },
  // Tacks: the turn (from leaving close-hauled to settled close-hauled on the new tack) and the speed lost. The order
  // of magnitude from full-scale tacking measurements on a ~10 m yacht (Masuyama, Fukasawa & Sasagawa, 'Tacking
  // simulation of sailing yachts', 12th Chesapeake Sailing Yacht Symposium 1995: a turn of the order of 10 s, a third
  // or so of the speed lost) and racing practice (a dinghy through the wind in 2-4 s, a 30-40 footer in 5-8 s, a 40 m
  // yacht in 15-25 s); the bands themselves est. Pass: turn time 2-15 s under 6 m, 3-18 s to 15 m, 6-35 s
  // beyond; loss under 50% (dinghies 60%), warn under 70%. Stopped in irons (crossing the wind not done in 15 s, or
  // stopped (< 0.3 m/s) within 35 deg of the wind for more than 3 s) for a competent helm in 6-25 kn: fail.
  tack: { time: [[6, 2, 15], [15, 3, 18], [999, 6, 35]], loss: 0.5, lossDinghy: 0.6, lossWarn: 0.7, ironsS: 3 },
  // Gybes: done (settled on the new gybe) within 15 s (30 s for 15 m+), no capsize or knockdown.
  gybe: { time: [[15, 15], [999, 30]] },
  // Motion on the beam reach. In a seaway, against test/seakeeping.mjs section 4 (20 kn chop, Hs ~0.8 m, a 30-40 ft
  // yacht at 100 deg TWA: roll < 6.5, pitch < 3.5 deg rms; under 8 m LOA a quarter more), scaled by sqrt(Hs / 0.8) in
  // a bigger sea; warn up to 1.5x. In flat water and steady wind there is nothing to move her: roll rms under 2 deg
  // (warn 4): more is a self-excited oscillation.
  motion: { roll: 6.5, pitch: 3.5, small: 1.25, flatRoll: 2, flatRollWarn: 4, warnF: 1.5 },
  // Structure: the peak load on any rig part (wire, chainplate, spar, boom) against its breaking load. Rigs are
  // designed to a safety factor of ~2.5-3.5 on the righting-moment load (Nordic Boat Standard; Skene; test/damage.mjs
  // section 1), so in seamanlike sailing the peak should keep a factor of at least 2 (pass), 1.5 warn. The sails'
  // cloth likewise (js/damage.js: torn at ratio 1). No dismasting, broken boom, torn sail or capsize in seamanlike
  // sailing to 32 kn for a keelboat. A dinghy or beach cat may capsize in 25 kn and more (warn): realistic; at 18 kn,
  // warn; at 12 kn or less: fail.
  sf: { pass: 2, warn: 1.5 },
  // Smoothness: a load more than 3x its own 1 s mean in one step is a spike (warn), more than 6x: fail (a real rig's
  // shock loads, a gybe's slam, rise over tens of ms but are seen in the 1 s mean too: est.). Local extrema per second in
  // a sheet's load (chatter): above 8/s (an oscillation above 4 Hz, faster than anything the boat or the sail does)
  // warn, above 25/s fail. NaN anywhere: fail.
  spike: { warn: 3, fail: 6 },
  chatter: { warn: 8, fail: 25 },
  // Heaving to / rounding up: she slows to under half her speed and under 2.5 kn within the leg (seamanship: a boat
  // hove to forereaches at 1-2 kn), and stays upright.
  heave: { frac: 0.5, kn: 2.5 },
};
