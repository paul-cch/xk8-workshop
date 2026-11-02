#!/usr/bin/env node
// Every mode on every kind of car, desktop and phone: no console error. Coupe and convertible, 4.0 and 4.2, NA and SC.
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARS = [];
for (const body of ['coupe', 'convertible']) for (const engine of ['4.0', '4.2']) for (const induction of ['na', 'sc']) CARS.push({engine, induction, body, my: engine === '4.0' ? 2001 : 2004, market: 'uk'});
const MODES = ['explore', 'run', 'jobs', 'diagnose', 'plan'];
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
let bad = 0, visits = 0;
for (const [name, device] of [['desktop', {viewport: {width: 1440, height: 900}}], ['phone', {viewport: {width: 390, height: 664}, deviceScaleFactor: 2, hasTouch: true, isMobile: true}]]) {
  const ctx = await browser.newContext(device);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /THREE\.|WebGL/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });
  await p.goto(`file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  for (const car of CARS) for (const mode of MODES) {
    const before = errors.length;
    await p.evaluate(async ({car, mode}) => {
      const x = window.__xk8;
      x.store.set({variant: car, mode, job: mode === 'jobs' ? {id: 'oil-filter', step: 4} : null, selected: null, isolate: null, view: mode === 'jobs' ? null : 'hero'});
      await x.settle(350);
      if (mode === 'run') { x.store.merge('sim', {running: true, rpm: 2500}); await x.settle(120); x.store.merge('sim', {running: false, rpm: 0}); }
    }, {car, mode});
    visits++;
    if (errors.length > before) { bad++; console.log(`${name} ${car.engine}${car.induction} ${car.body} ${mode}: ${errors.slice(before).join(' | ')}`); }
  }
  await ctx.close();
}
await browser.close();
console.log(`${visits} visits, ${bad} with console errors`);
process.exit(bad ? 1 : 0);
