// Lets a node test import a module that pulls in three.js somewhere down its imports (js/nav.js through js/hud.js and
// js/linegear.js) without it: 'three' resolves to an empty module. Only for code paths that never touch THREE (those
// modules build their meshes lazily). Import this first, then the module under test with a dynamic import().
import { register } from 'node:module';
const hook = `export async function resolve(s, c, next) {
  if (s === 'three' || s.startsWith('three/')) return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));
