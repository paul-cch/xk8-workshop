#!/usr/bin/env node
// Drives the real page at the four target viewports and writes screenshots of the frame, Explore and Run to
// dist-shots/ui/. Exits 1 on any console error. Use with: node tools/ui-check.mjs [--vp phone,tablet] [--only first,part]
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-shots/ui');
fs.mkdirSync(OUT, {recursive: true});
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1].split(',') : null; };
const VPS = {
  phone: {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true},
  tablet: {viewport: {width: 820, height: 1180}, deviceScaleFactor: 1, hasTouch: true, isMobile: true},
  landscape: {viewport: {width: 1180, height: 820}, deviceScaleFactor: 1, hasTouch: true, isMobile: true},
  laptop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1},
  desktop: {viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1},
};
const pickVps = arg('vp') ?? Object.keys(VPS);
const only = arg('only');
const want = (n) => !only || only.includes(n);

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
let bad = 0;
for (const name of pickVps) {
  const ctx = await browser.newContext({...VPS[name], permissions: ['clipboard-read', 'clipboard-write']});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await p.goto(`file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`);
  await p.waitForFunction(() => window.__xk8 || document.querySelector('#boot')?.textContent.startsWith('The workshop did not'), null, {timeout: 120000});
  const shot = async (n) => { await p.evaluate(() => window.__xk8.settle(1500)); await p.screenshot({path: path.join(OUT, `${name}-${n}.png`)}); console.log(`${name}-${n}`); };
  const set = (patch) => p.evaluate((x) => window.__xk8.store.set(x), patch);

  if (want('first')) await shot('first');
  if (want('part')) {
    await p.evaluate(() => { const x = window.__xk8; x.ui.select('engine.chain-tensioner-secondary'); });
    await p.waitForTimeout(1200);
    await shot('part');
    await p.evaluate(() => window.__xk8.store.set({selected: null}));
  }
  if (want('brake')) {
    await p.evaluate(() => { const x = window.__xk8; x.store.set({units: 'lbft'}); x.ui.open('torque', 'brakes.rear-caliper-bolts-my1997-1999'); });
    await p.waitForTimeout(1200);
    await shot('brake');
    await p.evaluate(() => window.__xk8.store.set({selected: null, units: 'nm'}));
  }
  if (want('tree')) {
    await set({selected: null, xray: false, view: 'hero'});
    await p.evaluate(() => { document.querySelector('[data-mode=explore]').querySelectorAll('.tree-head')[4]?.click(); document.querySelector('[data-mode=explore]').scrollTo(0, 320); });
    await shot('tree');
  }
  if (want('search')) {
    await p.evaluate(() => window.__xk8.ui.openSearch('wheel nut'));
    await p.waitForTimeout(500);
    await p.screenshot({path: path.join(OUT, `${name}-search.png`)});
    console.log(`${name}-search`);
    await p.evaluate(() => document.querySelector('dialog[open]').close());
  }
  if (want('car')) {
    await p.evaluate(() => window.__xk8.ui.openCar());
    await p.waitForTimeout(500);
    await p.fill('.vin-input', 'SAJJGAFF3AR040722');
    await p.waitForTimeout(300);
    await p.screenshot({path: path.join(OUT, `${name}-car.png`)});
    console.log(`${name}-car`);
    await p.evaluate(() => document.querySelector('dialog[open]').close());
  }
  if (want('prov')) {
    await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-rear'));
    await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelector('.tq .prov, .pn .prov')?.click());
    await p.waitForTimeout(500);
    await p.screenshot({path: path.join(OUT, `${name}-prov.png`)});
    console.log(`${name}-prov`);
    await p.evaluate(() => { document.querySelector('dialog[open]')?.close(); window.__xk8.store.set({selected: null}); });
  }
  if (want('run')) {
    await set({mode: 'run'});
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__xk8.store.merge('sim', {rpm: 2400, gear: 3}));
    await p.waitForTimeout(600);
    await p.screenshot({path: path.join(OUT, `${name}-run.png`)});
    console.log(`${name}-run`);
    await set({mode: 'explore'});
  }
  if (want('modes')) {
    for (const m of ['jobs', 'diagnose', 'plan']) { await set({mode: m}); await p.waitForTimeout(500); await p.screenshot({path: path.join(OUT, `${name}-${m}.png`)}); console.log(`${name}-${m}`); }
    await set({mode: 'explore'});
  }
  if (want('section')) {
    await set({mode: 'run'});
    await p.waitForTimeout(800);
    await p.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent === 'Section view').click());
    await p.waitForTimeout(1600);
    await p.screenshot({path: path.join(OUT, `${name}-section.png`)});
    console.log(`${name}-section`);
    await p.evaluate(() => [...document.querySelectorAll('.btn')].find((b) => b.textContent === 'Timing chains only').click());
    await p.waitForTimeout(1600);
    await p.screenshot({path: path.join(OUT, `${name}-chains.png`)});
    console.log(`${name}-chains`);
    await set({mode: 'explore'});
  }
  if (want('garage')) {
    await p.evaluate(() => { const x = window.__xk8; x.store.set({garage: true}); x.ui.open('torque', 'brakes.rear-caliper-bolts-my1997-1999'); });
    await p.waitForTimeout(1200);
    await shot('garage');
    await p.evaluate(() => window.__xk8.store.set({garage: false, selected: null}));
  }
  if (errors.length) { bad++; console.log(`${name} errors:\n  ${[...new Set(errors)].join('\n  ')}`); }
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
