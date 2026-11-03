// Every car module in build order. Each exports build(ctx) and, if anything in it moves, update(sim).
import * as body from './body.js';
import * as roof from './roof.js';
import * as interior from './interior.js';
import * as engine from './engine.js';
import * as chassis from './chassis.js';
import * as driveline from './driveline.js';
import * as electrical from './electrical.js';
import {seg} from './kit.js';
import {prefetchSurfaces} from './surface.js';

const MODULES = [chassis, engine, driveline, electrical, body, roof, interior];
const NAMES = ['chassis', 'engine', 'driveline', 'electrical', 'body', 'roof', 'interior'];
const FIRST_SURFACE = electrical; // the first module to read the body surface: the parking sensors sit on the bumper

/**
 * Starts sampling the body surfaces in workers, at the sizes body.js asks for: the coupe and the rear bumper first, as
 * every other form is sampled on top of one of them. Call after setDetail(). Returns a promise for buildCar.
 */
export function startSurfaces(src) {
  const Q = {rows: seg(340, 150), cols: seg(170, 90)}, B = {...Q, bumper: true};
  const workers = Math.max(1, Math.min(3, (globalThis.navigator?.hardwareConcurrency || 2) - 1));
  return prefetchSurfaces([['coupe', Q], ['coupe', B], ['convertible', Q], ['hood', Q], ['coupe', {...Q, facelift: true}], ['coupe', {...B, facelift: true}]], src, workers);
}

/**
 * Builds the car in turns, yielding between modules so the page can paint and a phone never hangs. surfaces, from
 * startSurfaces(), is waited for before the first module that needs them: the modules before it build meanwhile.
 */
export async function buildCar(ctx, onProgress, mark, surfaces = null) {
  for (let i = 0; i < MODULES.length; i++) {
    if (MODULES[i] === FIRST_SURFACE && surfaces) { await surfaces; mark?.('surfaces'); }
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
