// Climate of each venue: monthly normals that set the weather's season. Pure data and pure functions (no
// three.js, no Math.random), shared by the browser and the node tests.
// Per venue, twelve values from January:
//   hi, lo   mean daily maximum / minimum air temperature at the shore station (°C)
//   sst      sea (or lake) surface temperature (°C)
//   wet      days with precipitation >= 1 mm
//   snow     days with snow or sleet falling at sea level (0: it never snows there at the water)
//   fog      days with fog (visibility under 1 km at some hour)
//   cloud    mean cloud cover (0 clear .. 1 overcast)
//   conv     share of the precipitation that falls in convective showers and thunderstorms (afternoon cells)
// and tsd: the day-to-day spread of the temperature (K, one standard deviation of a day's anomaly), fogH(m):
// the local solar hours [from, to] fog is likely in month m (0 = January; wraps past midnight), fogTop: the
// depth of a bank (m).
// Values are rounded 1991-2020 normals (1981-2010 where that is what the service publishes) read from the
// national services' tables named on each entry; sea temperatures from NOAA OISST v2.1 monthly climatology
// (1991-2020) near the venue unless stated. Fog days and cloud are the least certain (station counts, rounded).

const M = (a) => Object.freeze(a);
export const CLIMATE = {
  // SMN (Servicio Meteorológico Nacional, Mexico) Normales Climatológicas, Progreso, Yuc. (1981-2010); fog: the
  // winter "nortes" bring morning fog banks over the cool shelf water; wet season Jun-Oct, afternoon thunderstorms
  progreso: { hi: M([28, 29, 31, 32, 33, 33, 33, 33, 32, 31, 29, 28]), lo: M([18, 18, 20, 22, 24, 25, 24, 24, 24, 23, 21, 19]),
    sst: M([24, 24, 25, 26, 28, 29, 29, 30, 29, 28, 26, 25]), wet: M([3, 2, 1, 1, 3, 7, 8, 9, 11, 7, 4, 3]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([2, 2, 2, 1, 0, 0, 0, 0, 0, 1, 1, 2]),
    cloud: M([0.4, 0.35, 0.3, 0.35, 0.4, 0.55, 0.55, 0.55, 0.6, 0.5, 0.45, 0.45]),
    conv: M([0.2, 0.2, 0.2, 0.3, 0.6, 0.85, 0.85, 0.85, 0.85, 0.7, 0.3, 0.2]), tsd: 1.5, fogTop: 60 },
  // Met Office UK climate averages 1991-2020, Southampton Mayflower Park / Wight; sea: Cefas coastal temperature
  // series (Bembridge / Weymouth), rounded
  solent: { hi: M([9, 9, 12, 15, 18, 21, 23, 23, 20, 16, 12, 9]), lo: M([3, 3, 4, 6, 9, 12, 14, 14, 12, 9, 6, 3]),
    sst: M([9, 8, 8, 10, 12, 15, 17, 18, 17, 15, 12, 10]), wet: M([12, 10, 9, 9, 8, 8, 7, 8, 9, 12, 12, 12]),
    snow: M([3, 3, 1.5, 0.3, 0, 0, 0, 0, 0, 0, 0.5, 2]), fog: M([4, 3, 3, 2, 2, 1, 1, 2, 3, 4, 4, 4]),
    cloud: M([0.75, 0.72, 0.68, 0.62, 0.6, 0.6, 0.6, 0.6, 0.62, 0.68, 0.75, 0.75]),
    conv: M([0.1, 0.1, 0.15, 0.2, 0.25, 0.3, 0.3, 0.3, 0.2, 0.15, 0.1, 0.1]), tsd: 2.5, fogH: () => [21, 11], fogTop: 80 },
  // NOAA NCEI U.S. Climate Normals 1991-2020, San Francisco (Downtown and Fort Point, blended toward the Gate's
  // cool summer); sea: NDBC 46026 / Fort Point. It has not snowed at the city's waterfront in living memory to
  // speak of (a dusting in 1976 and 2011 on the hills): never here. Fog: the summer advection fog through the
  // Golden Gate (NWS Monterey: fog in the Gate on most summer days), rolling in through the afternoon with the
  // westerly, filling the bay at night and burning back by late morning; winter fog is radiation fog at dawn
  sfbay: { hi: M([14, 15, 16, 16, 17, 18, 18, 19, 20, 19, 17, 14]), lo: M([8, 9, 9, 10, 11, 12, 13, 13, 13, 12, 10, 8]),
    sst: M([11, 11, 11, 11, 12, 13, 14, 15, 15, 14, 13, 11]), wet: M([11, 10, 9, 5, 2, 1, 0, 0, 1, 3, 7, 10]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([4, 3, 3, 4, 7, 12, 18, 19, 13, 8, 4, 4]),
    cloud: M([0.55, 0.55, 0.5, 0.45, 0.45, 0.45, 0.5, 0.5, 0.35, 0.35, 0.45, 0.55]),
    conv: M([0.05, 0.05, 0.1, 0.1, 0.1, 0.05, 0, 0, 0.1, 0.05, 0.05, 0.05]), tsd: 2,
    fogH: (m) => m >= 4 && m <= 8 ? [15, 11] : [2, 10], fogTop: 220 },
  // Meteotrentino, Riva del Garda station normals; lake: APPA Trento / ARPAV surface temperature, northern basin.
  // Snow at lake level at Riva is exceptional (the mountains around it are white, the lake's shore is not): none
  garda: { hi: M([7, 9, 14, 17, 22, 26, 29, 28, 23, 18, 12, 8]), lo: M([0, 1, 4, 8, 12, 16, 18, 18, 14, 10, 5, 1]),
    sst: M([8, 7, 8, 11, 15, 20, 23, 24, 21, 17, 13, 10]), wet: M([6, 5, 7, 10, 11, 10, 8, 8, 7, 9, 8, 6]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([2, 2, 1, 1, 0, 0, 0, 0, 1, 2, 2, 2]),
    cloud: M([0.5, 0.5, 0.55, 0.6, 0.6, 0.5, 0.4, 0.4, 0.45, 0.55, 0.6, 0.55]),
    conv: M([0.05, 0.05, 0.1, 0.25, 0.45, 0.6, 0.65, 0.6, 0.4, 0.2, 0.1, 0.05]), tsd: 2.5, fogTop: 50 },
  // Bureau of Meteorology climate statistics, Sydney (Observatory Hill) 066062; sea: IMOS Port Hacking. Never snows
  // at the harbour. Fog: autumn and winter mornings
  sydney: { hi: M([26, 25.8, 24.8, 22.6, 20, 17.6, 17, 18.3, 20.6, 22.4, 23.8, 25.3]), lo: M([19, 19.1, 17.8, 15, 12, 9.6, 8.4, 9.2, 11.6, 13.9, 16, 17.8]),
    sst: M([23, 23, 23, 22, 20, 19, 18, 17, 18, 19, 21, 22]), wet: M([8, 9, 10, 8, 8, 8, 6, 6, 6, 7, 8, 8]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([0.5, 0.5, 1, 2, 3, 3, 2, 2, 1, 0.5, 0.5, 0.5]),
    cloud: M([0.55, 0.55, 0.55, 0.5, 0.5, 0.5, 0.4, 0.4, 0.4, 0.45, 0.55, 0.55]),
    conv: M([0.45, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.15, 0.25, 0.4, 0.45]), tsd: 2.5, fogTop: 60 },
  // DWD Klimanormalwerte 1991-2020, Kiel-Holtenau; sea: BSH, Kiel lighthouse station. Snow falls on ~30 days a year,
  // Nov-Apr; sea fog in spring, warm air over the still-cold Baltic
  kiel: { hi: M([3.5, 4.3, 7.4, 12.3, 16.6, 19.7, 22, 21.9, 18.2, 13.2, 8, 4.6]), lo: M([-1, -0.9, 0.8, 3.6, 7.7, 11, 13.5, 13.4, 10.6, 7, 3.3, 0.4]),
    sst: M([3, 2.5, 3, 6, 10, 15, 18, 18, 15, 11, 7, 4]), wet: M([13, 10, 11, 9, 9, 10, 11, 11, 11, 12, 13, 13]),
    snow: M([7, 7, 4, 1, 0, 0, 0, 0, 0, 0.1, 2, 5]), fog: M([6, 5, 5, 4, 3, 2, 2, 2, 3, 5, 6, 6]),
    cloud: M([0.82, 0.78, 0.7, 0.62, 0.6, 0.62, 0.62, 0.6, 0.65, 0.72, 0.82, 0.85]),
    conv: M([0.2, 0.2, 0.2, 0.25, 0.3, 0.35, 0.35, 0.35, 0.3, 0.25, 0.2, 0.2]), tsd: 3.5,
    fogH: (m) => m >= 2 && m <= 5 ? [0, 24] : [21, 11], fogTop: 90 },
  // NOAA NCEI U.S. Climate Normals 1991-2020, Newport State Airport, RI; sea: NDBC NWPR1 (Newport). Snow
  // Dec-Mar; sea fog with the spring and summer southwesterly over the cold shelf water, at any hour
  newport: { hi: M([3, 4, 8, 13, 18, 23, 27, 26, 23, 17, 11, 6]), lo: M([-6, -5, -2, 3, 8, 13, 18, 17, 13, 7, 2, -3]),
    sst: M([4, 3, 4, 7, 11, 16, 20, 21, 19, 15, 11, 7]), wet: M([11, 10, 11, 11, 11, 10, 9, 8, 8, 9, 10, 11]),
    snow: M([4, 4, 2, 0.3, 0, 0, 0, 0, 0, 0, 0.5, 3]), fog: M([3, 3, 4, 6, 8, 8, 8, 5, 4, 3, 3, 3]),
    cloud: M([0.6, 0.6, 0.6, 0.6, 0.6, 0.55, 0.5, 0.5, 0.5, 0.5, 0.6, 0.62]),
    conv: M([0.1, 0.1, 0.1, 0.15, 0.25, 0.35, 0.4, 0.4, 0.3, 0.15, 0.1, 0.1]), tsd: 3.5,
    fogH: (m) => m >= 3 && m <= 7 ? [0, 24] : [1, 10], fogTop: 100 },
  // NIWA climate normals 1991-2020, Auckland (Mangere / Whenuapai); sea: NIWA Hauraki Gulf. Never snows at sea level
  auckland: { hi: M([23.7, 24.2, 22.9, 20.6, 18, 15.7, 14.9, 15.4, 16.8, 18.3, 20.1, 22.1]), lo: M([15.8, 16.3, 15, 12.6, 10.4, 8.3, 7.4, 7.9, 9.5, 11.1, 12.6, 14.6]),
    sst: M([21, 21, 21, 19, 17, 16, 15, 14, 15, 16, 17, 19]), wet: M([8, 7, 8, 10, 12, 15, 16, 15, 13, 12, 10, 9]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([0.5, 1, 1, 2, 3, 3, 2, 2, 1, 0.5, 0.5, 0.5]),
    cloud: M([0.55, 0.55, 0.55, 0.6, 0.62, 0.65, 0.62, 0.6, 0.62, 0.62, 0.6, 0.58]),
    conv: M([0.3, 0.3, 0.25, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.25, 0.3]), tsd: 2, fogTop: 60 },
  // Météo-France fiche climatologique 1991-2020, Marseille-Marignane (minima raised ~1.5 K toward the harbour);
  // sea: Copernicus / Planier. A day or two of snow most winters
  marseille: { hi: M([11.7, 12.9, 16.3, 19.2, 23.4, 27.8, 30.9, 30.5, 26.1, 21.1, 15.4, 12.1]), lo: M([4.5, 4.8, 7.5, 10.4, 14.3, 18.1, 20.8, 20.5, 17.1, 13.5, 8.6, 5.4]),
    sst: M([13.5, 13, 13.5, 14.5, 17, 21, 23, 23, 21, 19, 16.5, 14.5]), wet: M([5, 4, 4, 6, 5, 3, 1, 3, 4, 6, 6, 5]),
    snow: M([0.8, 0.8, 0.2, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.4]), fog: M([1, 1, 1, 1, 1, 0.5, 0, 0, 0.5, 1, 1, 1]),
    cloud: M([0.45, 0.45, 0.45, 0.5, 0.45, 0.35, 0.2, 0.25, 0.35, 0.45, 0.5, 0.45]),
    conv: M([0.15, 0.15, 0.2, 0.25, 0.35, 0.5, 0.6, 0.6, 0.55, 0.45, 0.25, 0.15]), tsd: 2.5, fogTop: 50 },
  // NOAA NCEI U.S. Climate Normals 1991-2020, Amarillo Rick Husband Intl Airport; lake: USGS / TCEQ surface
  // temperature, Lake Meredith. Snow Nov-Mar; spring and summer thunderstorms
  meredith: { hi: M([9.6, 12.4, 17.4, 22.3, 27.4, 32.3, 34.4, 33, 28.7, 22.6, 15.4, 9.9]), lo: M([-6.4, -4.5, -0.6, 4, 10, 15.4, 18.3, 17.6, 13.1, 6.1, -1.1, -5.6]),
    sst: M([6, 7, 11, 16, 21, 26, 28, 28, 24, 18, 12, 7]), wet: M([3, 3, 4, 4, 6, 7, 7, 7, 5, 4, 3, 3]),
    snow: M([3, 2.5, 1.5, 0.4, 0, 0, 0, 0, 0, 0.3, 1.5, 2.5]), fog: M([2, 2, 1, 1, 1, 0.5, 0, 0, 0.5, 1, 2, 2]),
    cloud: M([0.45, 0.45, 0.45, 0.4, 0.4, 0.35, 0.35, 0.35, 0.35, 0.35, 0.4, 0.45]),
    conv: M([0.1, 0.1, 0.3, 0.6, 0.8, 0.85, 0.85, 0.85, 0.7, 0.5, 0.2, 0.1]), tsd: 4, fogTop: 40 },
  // Namibia Meteorological Service / WMO normals, Walvis Bay (Rooikop and Pelican Point); sea: the Benguela
  // upwelling (OISST). A desert coast: ~15 mm of rain a year, never snow; the coastal fog of the Namib comes in
  // off the cold sea at night on ~100 days a year (most Mar-Jun) and clears by late morning
  walvis: { hi: M([23.3, 23.8, 23.2, 23.4, 22.6, 22.4, 20.7, 19.4, 18.6, 19.2, 20.6, 22]), lo: M([16, 17, 16, 14, 12, 10, 9, 9, 10, 12, 13, 15]),
    sst: M([17, 17, 17, 16, 16, 15, 14, 14, 14, 14, 15, 16]), wet: M([1, 1, 1, 0.5, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.5]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([8, 9, 11, 12, 12, 10, 7, 6, 6, 6, 7, 7]),
    cloud: M([0.45, 0.5, 0.5, 0.5, 0.45, 0.4, 0.4, 0.45, 0.45, 0.45, 0.45, 0.45]),
    conv: M([0.2, 0.2, 0.2, 0.1, 0, 0, 0, 0, 0, 0, 0.1, 0.2]), tsd: 1.5, fogH: () => [19, 11], fogTop: 150 },
  // the Drake Passage at 57.5° S: ERA5 1991-2020 monthly means over open water (and Islas Diego Ramírez, Dirección
  // Meteorológica de Chile, for the diurnal range). Precipitation on most days, snow or sleet possible in any month,
  // sea fog in the southern summer
  southern: { hi: M([6.5, 6.5, 6, 4.5, 3, 2, 1.5, 1.5, 2, 3, 4.5, 5.5]), lo: M([3.5, 3.5, 3, 2, 0.5, -0.5, -1, -1, -0.5, 0.5, 1.5, 2.5]),
    sst: M([5, 5.5, 5, 4.5, 3.5, 3, 2.5, 2.5, 2.5, 3, 3.5, 4.5]), wet: M([20, 19, 22, 22, 22, 21, 21, 21, 21, 21, 20, 20]),
    snow: M([4, 4, 6, 9, 12, 14, 15, 15, 13, 10, 7, 5]), fog: M([6, 6, 5, 3, 2, 1, 1, 1, 2, 3, 4, 5]),
    cloud: M([0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85]),
    conv: M([0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35]), tsd: 1.5, convDiurnal: 0,
    fogH: () => [0, 24], fogTop: 120 },
  // open water: the sky is placed in the subtropical North Atlantic (32° N, 40° W, main.js skyPlace): ERA5 /
  // ICOADS climatology there (the Azores-Bermuda belt). Never snow
  open: { hi: M([18, 17.5, 17.5, 18, 19.5, 22, 24, 25.5, 25, 23, 21, 19]), lo: M([15, 14.5, 14.5, 15, 16.5, 19, 21, 22.5, 22, 20, 18, 16]),
    sst: M([18, 17.5, 17.5, 18, 19, 21, 23, 25, 25, 23, 21, 19]), wet: M([12, 11, 10, 8, 6, 4, 3, 4, 6, 9, 11, 12]),
    snow: M([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), fog: M([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    cloud: M([0.6, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.35, 0.45, 0.5, 0.55, 0.6]),
    conv: M([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.35, 0.35, 0.35, 0.3, 0.3, 0.3]), tsd: 1.5, convDiurnal: 0.3, fogH: () => [0, 24], fogTop: 80 },
};

// A custom place (any lat/lon): a zonal climate from the latitude alone — the annual mean falls off poleward of
// the tropics, the season's swing grows with latitude (a maritime coast's, not a continent's), the coldest month
// in January north of the equator and July south of it, the sea lagging the air by a month. Snow is possible in
// the months whose mean minimum is below +1 °C.
export function zonalClimate(lat) {
  const a = Math.abs(lat), Tm = 27 - 0.55 * Math.max(0, a - 18), A = 0.22 * Math.max(0, a - 12), dr = 7;
  const hi = [], lo = [], sst = [], wet = [], snow = [], fog = [], cloud = [], conv = [];
  for (let m = 0; m < 12; m++) {
    const ph = Math.cos(2 * Math.PI * (m + (lat < 0 ? 6 : 0) - 0.5) / 12);       // 1 in (mid) January north
    const T = Tm - A * ph, Ts = Math.max(-1.8, Tm - 0.6 * A * Math.cos(2 * Math.PI * (m + (lat < 0 ? 6 : 0) - 1.5) / 12));
    hi.push(+(T + dr / 2).toFixed(1)); lo.push(+(T - dr / 2).toFixed(1)); sst.push(+Ts.toFixed(1));
    wet.push(a < 15 ? 12 : a < 35 ? 6 : 11); fog.push(a > 30 && a < 60 ? 2 : 1);
    snow.push(T - dr / 2 < 1 ? +Math.min(15, 2 + 2 * (1 - (T - dr / 2))).toFixed(1) : 0);
    cloud.push(a < 15 ? 0.55 : a < 35 ? 0.4 : 0.65); conv.push(a < 25 ? 0.7 : 0.3 - 0.15 * ph);
  }
  return { hi, lo, sst, wet, snow, fog, cloud, conv, tsd: a < 25 ? 1.5 : 3, fogTop: 70, zonal: true };
}
export function climateFor(id, lat = 32) { return CLIMATE[id] || zonalClimate(lat); }

// --------------------------------------------------------------- the season at a date
// days in each month (for turning "days of" counts into a daily chance)
const MD = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
// position in the year at UTC ms (local by longitude): the month index (0 = January) of the mid-month normals
// either side and the weight of the later one
function monthPos(ms, lon) {
  const d = ms / 864e5 + lon / 360;
  const y = ((d / 365.2425) % 1 + 1) % 1, p = y * 12 - 0.5, i = Math.floor(p);
  return [((i % 12) + 12) % 12, ((i + 1) % 12 + 12) % 12, p - i];
}
// the normals interpolated to the day (cyclic, between mid-month values): temperatures as given, counts as a
// daily chance (0..1). snowOK: snow can fall here this time of year at all.
export function seasonAt(C, ms, lon = 0, out = {}) {
  const [a, b, f] = monthPos(ms, lon), L = (k) => C[k][a] + (C[k][b] - C[k][a]) * f;
  out.hi = L('hi'); out.lo = L('lo'); out.sst = L('sst');
  out.pWet = Math.min(0.95, L('wet') / MD[f < 0.5 ? a : b]);
  out.pSnow = L('snow') / MD[f < 0.5 ? a : b]; out.snowOK = C.snow[a] > 0 || C.snow[b] > 0;
  out.pFog = Math.min(0.9, L('fog') / MD[f < 0.5 ? a : b]);
  out.cloud = L('cloud'); out.conv = L('conv');
  out.month = f < 0.5 ? a : b;
  out.fogH = C.fogH ? C.fogH(out.month) : [1, 10];
  out.fogTop = C.fogTop ?? 70; out.tsd = C.tsd ?? 2.5; out.convDiurnal = C.convDiurnal ?? 1;
  return out;
}
// the day's temperature cycle 0 (the minimum, near sunrise ~6 h) .. 1 (the maximum, ~15 h) at local solar hour h
export function diurnal(h) {
  h = ((h % 24) + 24) % 24;
  if (h >= 6 && h <= 15) return 0.5 - 0.5 * Math.cos(Math.PI * (h - 6) / 9);
  const s = h > 15 ? h - 15 : h + 9;                                 // 0..15 h after the maximum
  return 0.5 + 0.5 * Math.cos(Math.PI * s / 15);
}
// how much of the precipitation falls as snow at air temperature T (°C) near the surface: all of it below
// +1 °C, a wet mix (sleet) from +1 to +3 °C, none above — and none at all where the climate never has snow
export function snowShare(T, snowOK = true) {
  if (!snowOK) return 0;
  return T <= 1 ? 1 : T >= 3 ? 0 : (3 - T) / 2;
}
export function precipKind(rate, share) {
  if (!(rate > 0.03)) return 'none';
  const w = rate < 0.3 ? 'light ' : rate > 0.7 ? 'heavy ' : '';
  return w + (share >= 0.95 ? 'snow' : share > 0.05 ? 'sleet' : rate < 0.12 ? 'drizzle' : 'rain');
}
