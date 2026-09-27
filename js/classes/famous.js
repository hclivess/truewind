// Production and famous boats: one file per class, registered into CLASSES by physics.js (in this order in the menu).
// Each carries `group` ('dinghy' | 'keelboat' | 'multihull' | 'cruiser' | 'classic') for the class picker, `engine`
// (inert until js/engine.js reads it), `offsets` (the hull's lines, js/hull.js), `lines` (line handlers, js/linehandlers.js) and `model` (js/boats/detailed.js).
import catalina22 from './catalina22.js';
import catalina30 from './catalina30.js';
import oceanis381 from './oceanis381.js';
import contessa32 from './contessa32.js';
import westsail32 from './westsail32.js';
import optimist from './optimist.js';
import sunfish from './sunfish.js';
import flyingscot from './flyingscot.js';
import dragon from './dragon.js';
import etchells from './etchells.js';
import melges24 from './melges24.js';
import spray from './spray.js';
import joshua from './joshua.js';
export const FAMOUS = [catalina22, catalina30, oceanis381, contessa32, westsail32, optimist, sunfish, flyingscot, dragon, etchells, melges24, spray, joshua];
