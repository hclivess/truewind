// Velocity prediction off the main thread so the frame loop never stalls.
import { CLASSES, solvePolarAngle, POLAR_TWAS } from './physics.js';

self.onmessage = (e) => {
  const { key, cls, tws } = e.data;
  const C = CLASSES[cls];
  const out = [];
  for (const a of POLAR_TWAS) out.push(solvePolarAngle(C, tws, a));
  self.postMessage({ key, polar: out });
};
