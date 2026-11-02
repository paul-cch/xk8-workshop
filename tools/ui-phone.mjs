#!/usr/bin/env node
// The phone as a person holds it: WebKit, iPhone 14, the 390x664 a page gets in Safari. Prints what fits and writes shots.
//   node tools/ui-phone.mjs [--out dist-shots/name] [--only first,step,...]
import {devices, webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(ROOT, arg('out', 'dist-shots/ui-phone'));
fs.mkdirSync(OUT, {recursive: true});
const only = arg('only')?.split(',');
const want = (n) => !only || only.includes(n);
const page = `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`;
const PHONE = {...devices['iPhone 14'], viewport: {width: 390, height: 664}};
const browser = await webkit.launch();
let bad = 0;

async function open(hash = '', seed = null, device = PHONE) {
  const ctx = await browser.newContext(device);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  if (seed) await p.addInitScript((x) => { if (!localStorage.getItem('xk8-workshop')) localStorage.setItem('xk8-workshop', x); }, JSON.stringify(seed));
  await p.goto(page + hash);
  await p.waitForFunction(() => window.__xk8 || document.querySelector('#boot')?.textContent.includes('did not'), null, {timeout: 120000});
  await p.waitForTimeout(600);
  return p;
}
const shot = (p, n) => p.screenshot({path: path.join(OUT, `${n}.png`)});
const done = async (p) => { if (p.errors.length) { bad++; console.log('ERRORS', [...new Set(p.errors)].slice(0, 4)); } await p.context().close(); };
const CAR = {variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}, chosen: true};

if (want('first')) {
  const p = await open();
  await shot(p, 'first');
  console.log('first', await p.evaluate(() => ({intro: document.querySelector('.intro')?.getBoundingClientRect().bottom, insets: window.__xk8.stage.insets, peek: document.querySelector('.ex-peek')?.getBoundingClientRect().top})));
  await p.tap('.ex-watch');
  await p.waitForTimeout(2200);
  await shot(p, 'first-watch');
  await done(p);
}
if (want('step')) {
  const p = await open('#/job/brake-pads-front/1?v=4.0-na-coupe-1999', CAR);
  const n = await p.evaluate(() => window.__xk8.jobStepsFor('brake-pads-front', window.__xk8.store.get().variant).length);
  let fullText = 0, title = 0, tq = 0, tqs = 0;
  for (let i = 0; i < n; i++) {
    await p.evaluate((st) => window.__xk8.store.set({job: {id: 'brake-pads-front', step: st}}), i);
    await p.waitForTimeout(260);
    const r = await p.evaluate(() => {
      const box = document.querySelector('.ws-scroll').getBoundingClientRect();
      const fit = (e) => e && e.getBoundingClientRect().top >= box.top - 1 && e.getBoundingClientRect().bottom <= box.bottom + 1;
      const tq = document.querySelector('.ws-scroll .tq-value, .ws-scroll .tq-stages');
      return {title: fit(document.querySelector('.ws-steptitle')), text: fit(document.querySelector('.ws-steptext')), hasTq: !!tq, tq: fit(tq), win: Math.round(box.height)};
    });
    title += r.title; fullText += r.text; if (r.hasTq) { tqs++; tq += r.tq; }
    if (i === 1 || i === 10) { await p.waitForTimeout(900); await shot(p, `step-${i + 1}`); }
    if (i === 0) console.log('step window', r.win);
  }
  console.log(`steps ${n}: title ${title}, full text ${fullText}, torque ${tq} of ${tqs}`);
  await done(p);
}
if (want('rotate')) { // turning the phone during a step: Done, Back and Next stay on the screen and take a real tap
  const p = await open('#/job/oil-filter/4?v=4.0-na-coupe-1999', CAR);
  await p.waitForTimeout(900);
  await p.setViewportSize({width: 844, height: 390});
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => { const d = document.querySelector('.dock'), f = document.querySelector('.ws-foot'), n = document.querySelector('.ws-foot .ws-big--go').getBoundingClientRect(); return {dock: d.style.transform, bottom: Math.round(f.getBoundingClientRect().bottom), next: Math.round(n.bottom), h: innerHeight}; });
  console.log('rotate', r);
  if (r.dock || r.next > r.h) { bad++; console.log('rotate: the panel left the screen'); }
  await shot(p, 'rotate-step');
  await p.locator('.ws-foot .ws-big--go').tap({timeout: 3000});
  await p.waitForTimeout(400);
  console.log('rotate tap, step now', await p.evaluate(() => window.__xk8.store.get().job.step));
  await p.setViewportSize({width: 390, height: 664});
  await p.waitForTimeout(900);
  console.log('rotate back', await p.evaluate(() => ({dock: document.querySelector('.dock').style.transform, next: Math.round(document.querySelector('.ws-foot .ws-big--go').getBoundingClientRect().bottom), h: innerHeight})));
  await done(p);
}
if (want('garage')) {
  const p = await open('#/job/brake-pads-front/10?v=4.0-na-coupe-1999', {...CAR, garage: true});
  await p.waitForTimeout(900);
  await shot(p, 'garage-step');
  await done(p);
}
if (want('scroll')) {
  const p = await open('#/plan?v=4.0-na-coupe-1999', CAR);
  await p.tap('.ws-tabs--plan button:nth-child(2)');
  await p.waitForTimeout(300);
  const out = [];
  for (const y of [700, 1965, 3307]) {
    await p.evaluate((t) => { document.querySelector('.ws-scroll').scrollTop = t; }, y);
    await p.waitForTimeout(100);
    const box = await p.evaluate(() => { const b = [...document.querySelectorAll('.ws-bad')].find((x) => { const r = x.getBoundingClientRect(); return r.top > 300 && r.bottom < 600; }); b?.scrollIntoView({block: 'nearest'}); return b ? b.dataset.fk : null; });
    await p.locator(`[data-fk="${box}"]`).tap();
    await p.waitForTimeout(250);
    out.push(await p.evaluate(() => document.querySelector('.ws-scroll').scrollTop));
  }
  console.log('inspect, scrollTop after Bad', out);
  await done(p);
}
if (want('search')) {
  const p = await open('', CAR);
  await p.evaluate(() => window.__xk8.ui.open('torque', 'wheels.wheel-nut-alloy-my1997-2002'));
  await p.waitForTimeout(1600);
  await shot(p, 'torque');
  await p.evaluate(() => window.__xk8.ui.select('electrical.battery'));
  await p.waitForTimeout(1800);
  await shot(p, 'part-battery');
  await p.evaluate(() => window.__xk8.ui.select('engine.oil-filter'));
  await p.waitForTimeout(1800);
  await shot(p, 'part-oilfilter');
  await done(p);
}
if (want('land')) {
  const p = await open('#/job/oil-filter/4?v=4.0-na-coupe-1999', CAR, {...PHONE, viewport: {width: 664, height: 390}});
  await p.waitForTimeout(900);
  await shot(p, 'landscape-step');
  console.log('landscape overflow', await p.evaluate(() => Math.max(...[...document.querySelectorAll('.top > *')].map((e) => e.getBoundingClientRect().right)) - innerWidth));
  await done(p);
}
await browser.close();
console.log(bad ? `${bad} pages with errors` : 'no console errors');
process.exit(bad ? 1 : 0);
