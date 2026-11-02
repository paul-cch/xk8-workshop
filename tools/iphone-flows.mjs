#!/usr/bin/env node
// The main path on WebKit with the iPhone 14 profile, by real taps: hero, explore, a job, diagnose, plan, run.
// Exits 1 on a failed check or a console error. WebKit on a Mac is not an iPhone: its GPU and memory limits are the Mac's.
//   node tools/iphone-flows.mjs [--out dist-shots/name]
import {devices, webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(ROOT, arg('out', 'dist-shots/iphone'));
fs.mkdirSync(OUT, {recursive: true});
const page = `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`;

const browser = await webkit.launch();
const ctx = await browser.newContext({...devices['iPhone 14'], viewport: {width: 390, height: 664}});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  [${detail}]` : ''}`); };
const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({path: path.join(OUT, `${n}.png`)}); };
const S = () => p.evaluate(() => { const s = window.__xk8.store.get(); return {mode: s.mode, job: s.job, selected: s.selected, view: s.view}; });
const mode = async (name) => {
  await p.locator('.modes button', {hasText: name}).first().tap();
  await p.waitForTimeout(500);
};

const t0 = Date.now();
await p.goto(page);
await p.waitForFunction(() => window.__xk8 || document.querySelector('#boot')?.textContent.includes('did not'), null, {timeout: 120000});
check('boots', await p.evaluate(() => !!window.__xk8), `${Date.now() - t0} ms`);
await p.waitForTimeout(1500);
check('WebGL context is live', await p.evaluate(() => !window.__xk8.noGL && !window.__xk8.stage.renderer.getContext().isContextLost()));
const stats = await p.evaluate(() => window.__xk8.stage.stats());
check('draws frames', stats.framesDrawn > 0, JSON.stringify(stats));
await shot('hero');

// Explore: views and a part picked from the car.
await p.evaluate(async () => { const x = window.__xk8; x.store.set({view: 'side'}); await x.settle(); });
const c = await p.evaluate(() => window.__xk8.stage.project([1.294, 0.33, 0.8]));
await p.touchscreen.tap(c.x, c.y);
await p.waitForTimeout(800);
const picked = (await S()).selected;
check('explore: a tap on the car selects a part', !!picked, picked);
await shot('explore-part');
await p.evaluate(() => window.__xk8.store.set({selected: null, view: 'hero'}));

// A job, from the list.
await mode('Jobs');
check('jobs: mode', (await S()).mode === 'jobs');
await shot('jobs');
await p.evaluate(() => window.__xk8.store.set({job: {id: 'oil-filter', step: null}}));
await p.waitForTimeout(700);
await shot('job-overview');
await p.evaluate(() => window.__xk8.store.set({job: {id: 'oil-filter', step: 2}}));
await p.waitForTimeout(1600);
check('job: step 3 open', (await S()).job?.step === 2);
check('job: step title shows', await p.locator('.ws-steptitle').first().isVisible(), await p.locator('.ws-steptitle').first().textContent());
await shot('job-step');
await p.evaluate(() => window.__xk8.store.set({job: null}));

await mode('Diagnose');
check('diagnose: mode', (await S()).mode === 'diagnose');
await shot('diagnose');
await mode('Plan');
check('plan: mode', (await S()).mode === 'plan');
await shot('plan');
await mode('Run');
check('run: mode', (await S()).mode === 'run');
await p.evaluate(() => window.__xk8.store.merge('sim', {running: true, rpm: 1200, gear: 1, throttle: 0.2}));
await p.waitForTimeout(1500);
await shot('run');
const frames = await p.evaluate(async () => {
  const x = window.__xk8;
  const a = x.stage.stats().framesDrawn;
  await new Promise((r) => setTimeout(r, 1500));
  return x.stage.stats().framesDrawn - a;
});
check('run: the car keeps animating', frames > 5, `${frames} frames in 1.5 s`);
await p.evaluate(() => window.__xk8.store.merge('sim', {running: false, rpm: 0, gear: 0, throttle: 0}));

check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '));
await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
