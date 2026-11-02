#!/usr/bin/env node
// Renders the share card: dist/og.png, 1200 x 630, a real hero frame from the page at its highest tier, with the title set
// over it. Run after tools/build.mjs. The Open Graph tags in the page point at this file; SITE_URL makes them absolute.
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const ctx = await browser.newContext({viewport: {width: 1200, height: 630}, deviceScaleFactor: 2});
const page = await ctx.newPage();
await page.goto(`file://${path.join(DIST, 'index.html')}?tier=high`);
await page.waitForFunction(() => window.__xk8, null, {timeout: 120000});
await page.evaluate(async () => {
  const x = window.__xk8;
  document.getElementById('ui').style.display = 'none';
  const cover = document.getElementById('boot');
  if (cover) cover.style.display = 'none';
  x.stage.setInsets({top: 190, right: 0, bottom: 0, left: 0});
  x.store.set({mode: 'explore', variant: {engine: '4.0', induction: 'sc', body: 'coupe', my: 2001, market: 'uk'}, selected: null, view: null});
  x.rig.fly({az: 36, el: 8, dist: 7.7, x: 0, y: 0.52, z: 0}, 0);
  await x.settle();
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;left:64px;right:64px;top:50px;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#14171a;letter-spacing:-.02em';
  t.innerHTML = '<div style="font-size:60px;font-weight:700;line-height:1">XK8 Workshop</div><div style="font-size:24px;line-height:1.3;margin-top:14px;color:#3a4148;letter-spacing:0">Take the Jaguar XK8 and XKR apart in 3D, with real torques, part numbers and jobs.</div><div style="width:64px;height:6px;background:#f2570b;margin-top:18px"></div>';
  document.body.append(t);
  x.stage.invalidate();
  await x.settle();
});
await page.waitForTimeout(400);
await page.screenshot({path: path.join(DIST, 'og.png')});
await browser.close();
console.log(path.join(DIST, 'og.png'));
