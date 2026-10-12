// The race boats (49er, 470, Star, J/24, Nordic Folkboat, J/122) and the Mariner's trimaran: one file per class,
// registered into CLASSES by physics.js (after the original four, before the famous boats). Each carries `group` for
// the class picker, `engine` (js/engine.js), `lines` (js/linehandlers.js) and its hull as `offsets` in the parametric
// form (js/hull.js); they are drawn by js/models.js from their `hull` look (C.hull), not by js/boats/detailed.js.
import folkboat from './folkboat.js';
import j24 from './j24.js';
import star from './star.js';
import j122 from './j122.js';
import i470 from './i470.js';
import skiff49er from './skiff49er.js';
import mariner from './mariner.js';
import tp52 from './tp52.js';          // (the TP52 carries its own model: drawn by js/boats/detailed.js)
export const RACE = [folkboat, j24, star, j122, tp52, i470, skiff49er, mariner];
