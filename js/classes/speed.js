// The speed-record machines: one file per class, registered into CLASSES by physics.js (group 'speed'). A class with
// `speed` is a rigid body of wing, foils and planing pods simulated by js/speedcraft.js; one with `hydrofoils` is a
// sailing boat (js/physics.js Boat, cloth sails) flying on foils (js/hydrofoil.js).
import sailrocket2 from './sailrocket2.js';
import hydroptere from './hydroptere.js';
export const SPEED = [sailrocket2, hydroptere];
