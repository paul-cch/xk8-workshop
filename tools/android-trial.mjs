#!/usr/bin/env node
// The installed Android app under real touches: 48 px targets, French, search, the Back button, and a pinch, a drag
// and a tap on the car. Needs the debug app open on one emulator or phone that adb can see (README, "Run it on a phone").
//   node tools/android-trial.mjs
//   ANDROID_SERIAL=emulator-5554 node tools/android-trial.mjs    when more than one device is attached
import assert from 'node:assert/strict';
import {_android} from 'playwright';

const APP = 'com.paulcouach.xk8workshop';
const WHEEL = [1.294, 0.33, 0.8]; // the front wheel centre, in car coordinates

const devices = await _android.devices({omitDriverInstall: true});
const device = process.env.ANDROID_SERIAL ? devices.find((d) => d.serial() === process.env.ANDROID_SERIAL) : devices[0];
if (!device) { console.error('No Android device. Start an emulator or plug in a phone, then check `adb devices`.'); process.exit(2); }

try {
  const p = await (await device.webView({pkg: APP}, {timeout: 30000})).page();
  p.setDefaultTimeout(60000);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 150000});
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints});
  const point = (x, y, id = 1) => ({x: Math.round(x), y: Math.round(y), id});
  const tap = async (selector) => {
    const el = p.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    const r = await el.boundingBox();
    assert(r && r.width > 0, `${selector} has no size`);
    await touch('touchStart', [point(r.x + r.width / 2, r.y + r.height / 2)]);
    await touch('touchEnd');
  };
  const sideView = () => p.evaluate(async (wheel) => {
    __xk8.store.set({selected: null, job: null, view: 'side'});
    await __xk8.settle();
    return __xk8.stage.project(wheel);
  }, WHEEL);
  const camera = () => p.evaluate(() => ({dist: __xk8.rig.pose.dist, selected: __xk8.store.get().selected}));

  const targets = await p.locator('.top button:visible, .modes button:visible')
    .evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-label') || b.innerText, b.offsetWidth, b.offsetHeight]));
  assert(targets.every(([, w, h]) => w >= 48 && h >= 48), `a target is under 48 px: ${JSON.stringify(targets)}`);
  console.log(`ok    ${targets.length} top-bar and mode targets are 48 px or more`);

  await tap('.seg-lang button:last-child');
  await p.waitForFunction(() => document.documentElement.lang === 'fr');
  await tap('.mode[data-mode=jobs]');
  await p.waitForFunction(() => __xk8.store.get().mode === 'jobs');
  await p.waitForTimeout(550);
  const gap = await p.evaluate(() => document.querySelector('.dock').getBoundingClientRect().top - document.querySelector('.top').getBoundingClientRect().bottom);
  assert(Math.abs(gap) < 6, `the job list starts ${gap} px below the top bar`);
  console.log('ok    French job list fills the screen under the top bar');

  await tap('.search-btn');
  await p.locator('.sb-input').fill('P0340');
  const hit = await p.locator('.sr').first().innerText();
  assert(/P0340/.test(hit), hit);
  await device.shell('input keyevent KEYCODE_BACK');
  if (await p.locator('.dlg-search').isVisible()) await tap('.dlg-search .dlg-close');
  await p.locator('.dlg-search').waitFor({state: 'hidden'});
  console.log('ok    search finds P0340 and Back closes it');

  await tap('.seg-lang button:first-child');
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  await tap('.mode[data-mode=explore]');

  // One finger moves while the other stays put. Lifting them must zoom, not pick a part.
  let w = await sideView();
  const before = await camera();
  const a = point(w.x - 36, w.y, 1), b = point(w.x, w.y, 2);
  await touch('touchStart', [a]);
  await touch('touchStart', [a, b]);
  for (const delta of [-10, -22, -36, -48]) await touch('touchMove', [point(a.x + delta, w.y, 1), b]);
  await touch('touchEnd');
  await p.waitForTimeout(650);
  const pinched = await camera();
  assert(!pinched.selected && Math.abs(before.dist - pinched.dist) > 0.03, JSON.stringify({before, pinched}));
  console.log('ok    a pinch zooms and selects nothing');

  w = await sideView();
  await touch('touchStart', [point(w.x, w.y)]);
  await touch('touchMove', [point(w.x + 35, w.y + 8)]);
  await touch('touchMove', [point(w.x, w.y)]);
  await touch('touchEnd');
  await p.waitForTimeout(400);
  assert(!(await camera()).selected, 'a drag that returned to its start picked a part');
  console.log('ok    a drag that returns to its start selects nothing');

  w = await sideView();
  const under = await p.evaluate(async ({x, y}) => ({part: await __xk8.pick.pickAt(x, y), el: document.elementFromPoint(x, y)?.id}), w);
  assert(under.part && under.el === 'stage', JSON.stringify(under));
  await cdp.send('Input.synthesizeTapGesture', {x: w.x, y: w.y, duration: 45, tapCount: 1, gestureSourceType: 'touch'});
  await p.waitForFunction(() => !!__xk8.store.get().selected);
  console.log(`ok    a tap selects ${(await camera()).selected}`);
} finally {
  await device.close();
}
