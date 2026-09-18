// Precompute the cloud noise volumes the sky loads at startup (data/sky/*.bin, RGBA8).
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildNoise3DData, buildWeatherData } from '../js/noise.js';
mkdirSync('data/sky', { recursive: true });
let t = Date.now(); writeFileSync('data/sky/noise3d-64.bin', buildNoise3DData(64)); console.log('noise3d-64', Date.now() - t, 'ms');
t = Date.now(); writeFileSync('data/sky/weather-256.bin', buildWeatherData(256)); console.log('weather-256', Date.now() - t, 'ms');
