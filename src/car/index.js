// Every car module in build order. Each exports build(ctx) and, if anything in it moves, update(sim).
import * as body from './body.js';
import * as roof from './roof.js';
import * as interior from './interior.js';
import * as engine from './engine.js';
import * as chassis from './chassis.js';
import * as driveline from './driveline.js';
import * as electrical from './electrical.js';

const MODULES = [chassis, engine, driveline, electrical, body, roof, interior];
const NAMES = ['chassis', 'engine', 'driveline', 'electrical', 'body', 'roof', 'interior'];

/** Builds the car in turns, yielding between modules so the page can paint and a phone never hangs. */
export async function buildCar(ctx, onProgress, mark) {
  for (let i = 0; i < MODULES.length; i++) {
    MODULES[i].build(ctx);
    mark?.(NAMES[i]);
    onProgress?.((i + 1) / MODULES.length);
    await new Promise((r) => setTimeout(r));
  }
}

/** Returns true when a module says it moved something: shadows are stale. */
export function updateCar(sim) {
  let moved = false;
  for (const m of MODULES) if (m.update?.(sim)) moved = true;
  return moved;
}
