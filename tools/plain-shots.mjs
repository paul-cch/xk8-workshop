#!/usr/bin/env node
// The page as a newcomer meets it: WebKit at 390x844 on the iPhone 14 profile and Chromium at 1440x900, on the screens the plain
// language work changed. Read the PNGs: exit 0 only means no page errors.
//   node tools/plain-shots.mjs [--out dist-shots/name] [--only first,job] [--fr] [--phone-only] [--desk-only]
import {chromium, devices, webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const OUT = path.join(ROOT, arg('out', 'dist-shots/plain'));
fs.mkdirSync(OUT, {recursive: true});
const only = arg('only')?.split(',');
const want = (n) => !only || only.includes(n);
const page = `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`;
const FR = has('fr');
const CAR = {variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}, chosen: true, ...(FR ? {lang: 'fr'} : {})};
let bad = 0;

async function shape(name, browser, device) {
  const open = async (hash = '', seed = FR ? {lang: 'fr'} : null) => {
    const ctx = await browser.newContext(device);
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message));
    if (seed) await p.addInitScript((x) => { if (!localStorage.getItem('xk8-workshop')) localStorage.setItem('xk8-workshop', x); }, JSON.stringify(seed));
    await p.goto(page + hash);
    await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
    await p.waitForTimeout(1200);
    return p;
  };
  const shot = (p, n) => p.screenshot({path: path.join(OUT, `${name}-${n}.png`)});
  const close = async (p) => { if (p.errors.length) { bad++; console.log(name, 'errors', [...new Set(p.errors)].slice(0, 3)); } await p.context().close(); };
  const go = async (p, patch, wait = 1100) => { await p.evaluate((x) => window.__xk8.store.set(x), patch); await p.waitForTimeout(wait); };

  if (want('first')) {
    const p = await open();
    await shot(p, 'first');
    await close(p);
  }
  if (want('home')) { // a returning owner
    const p = await open('', {...CAR, hinted: true});
    await shot(p, 'home');
    await p.evaluate(() => window.__xk8.ui.takeApart?.(true));
    await p.waitForTimeout(2200);
    await shot(p, 'apart');
    await close(p);
  }
  if (want('modes')) {
    const p = await open('', {...CAR, hinted: true});
    await go(p, {mode: 'jobs'});
    await shot(p, 'jobs');
    await go(p, {mode: 'diagnose'});
    await shot(p, 'diagnose');
    await go(p, {mode: 'plan'});
    await shot(p, 'plan');
    await go(p, {mode: 'run'}, 2000);
    await shot(p, 'run');
    await close(p);
  }
  if (want('job')) {
    const p = await open('#/job/brake-pads-front?v=4.0-na-coupe-1999', CAR);
    await p.waitForTimeout(800);
    await shot(p, 'job');
    await go(p, {job: {id: 'brake-pads-front', step: 3}}, 1500);
    await shot(p, 'step');
    await go(p, {job: {id: 'oil-filter', step: 0}}, 1500);
    await shot(p, 'step-warn');
    await p.locator('.ws-safety .term').first().click().catch(() => {});
    await p.waitForTimeout(500);
    await shot(p, 'term');
    await close(p);
  }
  if (want('fault')) {
    const p = await open('', {...CAR, hinted: true});
    await p.evaluate(() => window.__xk8.ui.open('fault', window.__xk8.data.faults.items[0].id));
    await p.waitForTimeout(1200);
    await shot(p, 'fault');
    await close(p);
  }
  if (want('part')) {
    const p = await open('', {...CAR, hinted: true});
    await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-front'));
    await p.waitForTimeout(1800);
    await shot(p, 'part');
    await close(p);
  }
  if (want('shared')) {
    const own = {...CAR, variant: {engine: '4.0', induction: 'sc', body: 'coupe', my: 2002, market: 'uk'}, hinted: true};
    const p = await open(`#/explore?v=4.2-na-convertible-2005${FR ? '&l=fr' : ''}`, own);
    await shot(p, 'shared-own');
    await close(p);
    const q = await open(`#/explore?v=4.2-na-coupe-2001${FR ? '&l=fr' : ''}`, {hinted: true});
    await shot(q, 'shared');
    await close(q);
  }
}

if (!has('desk-only')) {
  const wk = await webkit.launch();
  await shape('phone', wk, {...devices['iPhone 14'], viewport: {width: 390, height: 844}});
  await wk.close();
}
if (!has('phone-only')) {
  const cr = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
  await shape('desk', cr, {viewport: {width: 1440, height: 900}});
  await cr.close();
}
console.log(bad ? `${bad} pages with errors` : 'no page errors');
process.exit(bad ? 1 : 0);
