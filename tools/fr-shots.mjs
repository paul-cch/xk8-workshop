#!/usr/bin/env node
// The page in French on the three shapes that matter: iPhone portrait and landscape in WebKit, and a desktop in Chromium. One
// screenshot of each main screen, plus print views, under dist-shots/<out>/. Exit 0 proves nothing: read the PNGs.
//   node tools/fr-shots.mjs [--out final-owner/shots] [--only phone|landscape|desktop] [--states first,explore]
import {chromium, devices, webkit} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.join(ROOT, 'dist-shots', arg('out', 'fr-shots'));
fs.mkdirSync(OUT, {recursive: true});
const page = `file://${path.join(ROOT, 'dist/index.html')}#/explore?v=4.2-sc-coupe-2004&l=fr`;
const SHAPES = {
  phone: {engine: webkit, ctx: {...devices['iPhone 14'], viewport: {width: 390, height: 844}}},
  landscape: {engine: webkit, ctx: {...devices['iPhone 14'], viewport: {width: 844, height: 390}}},
  desktop: {engine: chromium, launch: {args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']}, ctx: {viewport: {width: 1440, height: 900}}},
};
const only = arg('only', null);
const wanted = arg('states', null)?.split(',');

// Runs in the page. Text cut off by its own box, a chosen option wider than its select, and anything past the window's edge.
const clipped = () => {
  const out = new Set();
  const note = (el, why) => out.add(`${why}: ${(el.tagName + (el.classList[0] ? `.${el.classList[0]}` : '')).toLowerCase()} "${(el.textContent || el.placeholder || '').trim().slice(0, 40)}"`);
  const ctx = document.createElement('canvas').getContext('2d');
  const scrollers = '.modes, .views, .ws-tabs, .ws-scroll, .sheet, .panel, .ws-table';
  for (const el of document.querySelectorAll('#ui *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.placeholder)) {
      const c = getComputedStyle(el);
      ctx.font = `${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
      const text = el.tagName === 'SELECT' ? el.selectedOptions[0]?.textContent ?? '' : el.placeholder;
      const room = el.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight) - (el.type === 'number' ? 20 : 0);
      if (ctx.measureText(text).width > room + 1) out.add(`does not fit: ${el.tagName.toLowerCase()} "${text}"`);
      continue;
    }
    if (el.closest(scrollers) && !el.matches('.sheet *, .panel *')) continue;
    if (r.right > innerWidth + 1 && !el.closest('.ws-tabs, .views')) note(el, 'past the edge');
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    if (hasText && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline' && !el.matches('.ws-back span, .vh, .ws-vh')) note(el, 'overflows');
  }
  return [...out];
};

for (const [name, shape] of Object.entries(SHAPES)) {
  if (only && only !== name) continue;
  const browser = await shape.engine.launch(shape.launch);
  const ctx = await browser.newContext(shape.ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`${name} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') console.log(`${name} console: ${m.text()}`); });
  await p.goto(page);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await p.waitForTimeout(1500);
  const set = (x) => p.evaluate((v) => window.__xk8.store.set(v), x);
  const shot = async (n, wait = 700) => {
    if (wanted && !wanted.includes(n)) return;
    await p.waitForTimeout(wait);
    await p.evaluate(() => window.__xk8.settle?.(1500));
    await p.screenshot({path: path.join(OUT, `${name}-${n}.png`)});
    for (const line of await p.evaluate(clipped)) console.log(`${name}-${n}: ${line}`);
  };
  await shot('first');
  await set({selected: 'brakes.caliper-front', view: null});
  await shot('explore-part', 1200);
  await set({selected: null, view: 'hero', mode: 'run'});
  await shot('run', 1200);
  await set({mode: 'jobs', job: null});
  await shot('jobs-list');
  await set({job: {id: 'brake-pads-front', step: null}});
  await shot('job-overview', 1000);
  await set({job: {id: 'brake-pads-front', step: 3}});
  await shot('job-step', 1200);
  await set({job: null, selected: null, mode: 'diagnose'});
  await shot('diagnose');
  await p.evaluate(() => window.__xk8.ui.open('fault', 'cold-start-rattle'));
  await shot('fault');
  await p.evaluate(() => window.__xk8.ui.open('dtc', 'P0340'));
  await shot('dtc');
  await set({mode: 'plan'});
  await p.click('[data-fk="tab-service"]').catch(() => {});
  await shot('plan-service');
  await p.click('[data-fk="tab-torques"]').catch(() => {});
  await shot('plan-torques');
  await p.click('[data-fk="tab-upgrades"]').catch(() => {});
  await shot('plan-upgrades');
  if (name === 'desktop') { // print views: what the page lays out for paper
    await set({mode: 'jobs', job: {id: 'brake-pads-front', step: null}});
    await p.waitForTimeout(500);
    await p.evaluate(() => dispatchEvent(new Event('beforeprint')));
    await p.emulateMedia({media: 'print'});
    await p.pdf({path: path.join(OUT, 'print-job.pdf'), format: 'A4'});
    await p.screenshot({path: path.join(OUT, 'print-job.png'), fullPage: true});
    await p.emulateMedia({media: 'screen'});
    await p.evaluate(() => { dispatchEvent(new Event('afterprint')); document.getElementById('ws-print')?.replaceChildren(); });
    await p.click('[data-fk="addlist"]');
    await set({mode: 'plan', job: null});
    for (const [tab, file] of [['inspect', 'print-inspection'], ['list', 'print-list']]) {
      await p.click(`[data-fk="tab-${tab}"]`).catch((e) => console.log(`no tab ${tab}: ${e.message.split('\n')[0]}`));
      await p.waitForTimeout(400);
      await p.evaluate(() => dispatchEvent(new Event('beforeprint')));
      await p.emulateMedia({media: 'print'});
      await p.pdf({path: path.join(OUT, `${file}.pdf`), format: 'A4'});
      await p.emulateMedia({media: 'screen'});
      await p.evaluate(() => { dispatchEvent(new Event('afterprint')); document.getElementById('ws-print')?.replaceChildren(); });
    }
  }
  await browser.close();
}
