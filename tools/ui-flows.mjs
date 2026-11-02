#!/usr/bin/env node
// Real events on the real page: keyboard, mouse, touch. Each check prints PASS or FAIL. Exits 1 on any failure or console
// error. Screenshots live in tools/ui-check.mjs; this one proves behaviour.
import {chromium, devices, webkit} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (q = '') => `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}${q}`;
let fails = 0;
const PHONE_H = 664;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  [${detail}]` : ''}`); };
const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});

async function open(device, q) {
  const ctx = await browser.newContext({...device, permissions: ['clipboard-read', 'clipboard-write']});
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(url(q));
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  return p;
}
const S = (p) => p.evaluate(() => { const s = window.__xk8.store.get(); return {mode: s.mode, selected: s.selected, units: s.units, view: s.view, garage: s.garage, variant: s.variant, sim: s.sim, xray: s.xray, isolate: s.isolate, hover: s.hover}; });

// ---- desktop ---------------------------------------------------------------------------------
{
  const p = await open({viewport: {width: 1440, height: 900}});
  await p.keyboard.press('Meta+k');
  await p.waitForSelector('.dlg-search');
  check('Cmd-K opens search', true);
  await p.keyboard.type('wheel nut');
  await p.waitForTimeout(100);
  check('search lists results', await p.locator('.sr').count() > 5, await p.locator('.sr').count());
  await p.keyboard.press('ArrowDown');
  const active = await p.evaluate(() => document.querySelector('.sr[aria-selected=true]')?.dataset.i);
  check('arrow keys move the row', active === '1', active);
  await p.keyboard.press('Control+a');
  await p.keyboard.type('Wheel nut, alloy');
  await p.waitForTimeout(100);
  const to = await p.evaluate(() => [...document.querySelectorAll('.sr')].findIndex((r) => r.querySelector('.sr-kind').textContent === 'Torque'));
  for (let i = 0; i < to; i++) await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  let s = await S(p);
  check('Enter on a torque opens its part', !!s.selected, s.selected);
  check('torque block is flashed', await p.locator('.tq.flash').count() === 1);
  const nm = await p.locator('.tq-value').first().textContent();
  await p.click('.seg-units button:nth-child(2)');
  await p.waitForTimeout(80);
  const lb = await p.locator('.tq-value').first().textContent();
  check('units toggle changes the torque', nm !== lb && /lb ft/.test(lb.split(/\d\s/)[0] + lb), `${nm} -> ${lb}`);
  await p.click('.seg-units button:nth-child(1)');

  await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-rear'));
  await p.waitForTimeout(300);
  const num = await p.locator('.pn-no').first().textContent();
  await p.locator('.pn .copy').first().click();
  await p.waitForTimeout(100);
  check('copy puts the number on the clipboard', await p.evaluate(() => navigator.clipboard.readText()) === num, num);

  await p.locator('.pn .prov').first().click();
  await p.waitForSelector('.dlg-prov');
  check('badge opens source and note', await p.locator('.prov-src li').count() >= 1, await p.locator('.prov-src li').count());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  check('Escape closes it and focus returns', await p.evaluate(() => document.activeElement?.classList.contains('prov')));

  await p.click('.back');
  await p.waitForTimeout(100);
  check('back returns to the list', (await S(p)).selected === null);
  await p.locator('.tree-head').nth(4).click();
  const row = p.locator('.tree-parts .part').first();
  await row.hover();
  await p.waitForTimeout(60);
  check('list hover lights the part', !!(await S(p)).hover || !(await row.textContent()).length, (await S(p)).hover);
  await p.mouse.move(300, 300);
  await p.fill('.filter', 'tensioner');
  await p.waitForTimeout(60);
  check('filter narrows the list', await p.locator('.part-flat .part').count() >= 2, await p.locator('.part-flat .part').count());
  await p.fill('.filter', '');

  await p.locator('.view', {hasText: 'Side'}).click();
  await p.waitForTimeout(60);
  check('view button sets the view', (await S(p)).view === 'side');
  await p.locator('.seg-tri').first().locator('button').nth(2).click();
  check('hide sets the system', await p.evaluate(() => window.__xk8.store.get().systems.body) === 'hide');
  await p.evaluate(() => window.__xk8.store.set({systems: {}, view: 'hero'}));

  await p.click('.car-btn');
  await p.waitForSelector('.dlg-car');
  await p.fill('.vin-input', 'SAJJGAFF3AR040722');
  await p.waitForTimeout(100);
  check('VIN decodes to the car', (await p.textContent('.pick-name')) === 'XKR 4.0 convertible', await p.textContent('.pick-name'));
  check('prone-to list shows', await p.locator('.pick-sheet .weak').count() >= 3);
  await p.click('.go');
  await p.waitForTimeout(150);
  s = await S(p);
  check('variant set everywhere', s.variant.induction === 'sc' && s.variant.body === 'convertible' && s.variant.serial === '040722' && (await p.textContent('.car-btn')).includes('XKR'), JSON.stringify(s.variant));
  check('URL carries the car', (await p.evaluate(() => location.hash)).includes('4.0-sc-convertible'), await p.evaluate(() => location.hash));
  await p.click('.car-btn');
  await p.waitForSelector('.dlg-car');
  await p.locator('.pick-field .seg').first().locator('button').nth(1).click();
  await p.waitForTimeout(60);
  check('choosing 4.2 moves the year', (await p.inputValue('.pick-year')) === '2003', await p.inputValue('.pick-year'));
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.__xk8.store.set({variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}}));

  // Run
  await p.locator('.mode', {hasText: 'Run'}).click();
  await p.waitForTimeout(500);
  s = await S(p);
  check('entering Run starts the engine', s.sim.running && s.sim.rpm > 500, s.sim.rpm);
  check('x-ray comes on for Run', s.xray);
  await p.locator('.seg-gear button', {hasText: '3'}).click();
  await p.waitForTimeout(100);
  await p.locator('[data-name=rpm] input').focus();
  for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(200);
  const g = await p.evaluate(() => { const x = window.__xk8; return {rpm: x.sim.rpm, mph: x.sim.speedMph, mps: x.sim.meanPistonSpeed, shownRpm: document.querySelector('.dash-rpm').textContent, shownMph: document.querySelector('.dash-line .dash-val').textContent, shownP: document.querySelectorAll('.dash-line .dash-val')[1].textContent}; });
  check('gauges read the same frame as the parts', String(Math.round(g.rpm)) === g.shownRpm && Math.abs(+g.shownMph - g.mph) < 1 && Math.abs(+g.shownP - g.mps) < 0.06, JSON.stringify(g));
  check('road speed by hand: 1700 rpm, 3rd, about 30 mph on a 3.06 final', Math.abs(g.mph - (1700 / (1.51 * 3.06) / 60 * Math.PI * (17 * 0.0254 + 2 * 0.245 * 0.5) * 2.23694)) < 0.8, g.mph.toFixed(1));
  check('piston speed by hand: 2 x 86 x 1700 / 60000', Math.abs(g.mps - (2 * 86 * 1700) / 60000) < 0.02, g.mps.toFixed(2));
  const box = await p.locator('[data-name=throttle] input').boundingBox();
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(500);
  const held = (await S(p)).sim;
  await p.mouse.up();
  await p.waitForTimeout(1500);
  const after = (await S(p)).sim;
  check('throttle is a pedal: revs while held, returns', held.rpm > g.rpm + 300 && after.throttle === 0 && Math.abs(after.rpm - g.rpm) < 60, `${Math.round(g.rpm)} > ${Math.round(held.rpm)} > ${Math.round(after.rpm)}`);
  await p.locator('.seg-gear button', {hasText: '4'}).click();
  await p.waitForTimeout(120);
  const shifted = await S(p);
  check('a shift holds road speed', Math.abs(shifted.sim.speedMph - g.mph) < 1.5 && shifted.sim.rpm < after.rpm, `${shifted.sim.speedMph.toFixed(1)} mph at ${Math.round(shifted.sim.rpm)}`);
  await p.locator('.btn', {hasText: 'Timing chains only'}).click();
  await p.waitForTimeout(200);
  s = await S(p);
  check('isolate the chains: ghosts the rest, slows time', Array.isArray(s.isolate) && s.isolate.length > 0 && s.sim.timeScale === 0.05, `${s.isolate?.length} parts`);
  await p.locator('.btn', {hasText: 'Section view'}).click();
  await p.waitForTimeout(400);
  check('section cuts the engine', (await S(p)).sim.section === 'cyl1' && (await S(p)).isolate === null, (await S(p)).sim.section);
  await p.locator('.seg-rows button').nth(3).click();
  await p.waitForTimeout(120);
  await p.locator('.toggle', {hasText: 'Engine sound'}).click();
  await p.waitForTimeout(400);
  check('sound starts on request and only then', await p.evaluate(() => window.__xk8.ui.soundState()) === 'running', await p.evaluate(() => window.__xk8.ui.soundState()));
  await p.locator('.mode', {hasText: 'Explore'}).click();
  await p.waitForTimeout(300);
  s = await S(p);
  check('leaving Run stops it all', !s.sim.running && s.sim.section == null, s.sim.rpm);

  await p.click('.garage-btn');
  await p.waitForTimeout(200);
  check('garage mode sets the class', await p.evaluate(() => document.documentElement.classList.contains('garage')));
  check('garage asks for a wake lock and says what it got', /stays on|cannot keep/.test(await p.textContent('.toast')), await p.textContent('.toast'));
  await p.click('.garage-btn');

  await p.keyboard.press('Tab');
  const fv = await p.evaluate(() => { const a = document.activeElement; return {tag: a.tagName, outline: getComputedStyle(a).outlineStyle}; });
  check('keyboard focus is visible', fv.outline !== 'none', JSON.stringify(fv));
  for (const m of ['jobs', 'diagnose', 'plan', 'explore']) {
    await p.locator('.mode', {hasText: new RegExp(m, 'i')}).click();
    await p.waitForTimeout(150);
    check(`${m} panel mounts in the dock`, await p.evaluate((x) => document.querySelector(`.panel[data-mode=${x}]`).childElementCount > 0, m));
  }
  await p.evaluate(() => window.__xk8.ui.open('dtc', 'P0340'));
  await p.waitForTimeout(150);
  check('a code jumps to Diagnose', (await S(p)).mode === 'diagnose');
  await p.evaluate(() => window.__xk8.ui.open('job', 'oil-filter'));
  await p.waitForTimeout(150);
  check('a job jumps to Jobs', (await S(p)).mode === 'jobs');
  check('no console errors, desktop', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}

// ---- reaching things only by keyboard, from a cold page -----------------------------------------
{
  const p = await open({viewport: {width: 1440, height: 900}});
  await p.keyboard.press('Tab');
  await p.keyboard.press('Tab');
  check('Tab reaches the skip link', await p.evaluate(() => document.activeElement.className.includes('skip')));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  check('skip lands in the parts list', await p.evaluate(() => !!document.activeElement.closest('#part-list')));
  await p.context().close();
}

// ---- idle orbit and handback -----------------------------------------------------------------
{
  const p = await open({viewport: {width: 1280, height: 800}}, '?orbit=1');
  await p.waitForTimeout(1200);
  const a = await p.evaluate(() => window.__xk8.rig.pose.az);
  await p.waitForTimeout(1200);
  const b = await p.evaluate(() => window.__xk8.rig.pose.az);
  check('idle orbit turns the car', b > a + 2, `${a.toFixed(1)} -> ${b.toFixed(1)}`);
  await p.mouse.click(40, 500);
  await p.waitForTimeout(300);
  const c = await p.evaluate(() => window.__xk8.rig.pose.az);
  await p.waitForTimeout(800);
  const d = await p.evaluate(() => window.__xk8.rig.pose.az);
  check('input takes over at once', Math.abs(d - c) < 0.2, `${c.toFixed(1)} -> ${d.toFixed(1)}`);
  await p.waitForTimeout(25600);
  const e = await p.evaluate(() => window.__xk8.rig.pose.az);
  check('25 s of quiet hands it back', e > d + 1, `${d.toFixed(1)} -> ${e.toFixed(1)}`);
  await p.context().close();
}
{
  const p = await open({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'}, '?orbit=1');
  await p.waitForTimeout(1500);
  const a = await p.evaluate(() => window.__xk8.rig.pose.az);
  await p.waitForTimeout(800);
  check('reduced motion: no orbit', (await p.evaluate(() => window.__xk8.rig.pose.az)) === a);
  await p.evaluate(() => window.__xk8.store.set({mode: 'run'}));
  await p.waitForTimeout(300);
  check('reduced motion: engine waits for Start', !(await S(p)).sim.running);
  await p.context().close();
}

// ---- phone: touch ----------------------------------------------------------------------------
{
  const p = await open({viewport: {width: 390, height: PHONE_H}, deviceScaleFactor: 2, hasTouch: true, isMobile: true}); // what Safari leaves on an iPhone 14
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: type === 'touchEnd' ? [] : [{x, y}]});
  const drag = async (x, y0, y1, ms = 240, hold = 110) => {
    await touch('touchStart', x, y0);
    const n = 12;
    for (let i = 1; i <= n; i++) { await touch('touchMove', x, y0 + ((y1 - y0) * i) / n); await p.waitForTimeout(ms / n); }
    await p.waitForTimeout(hold);
    await touch('touchEnd');
    await p.waitForTimeout(450);
  };
  const sheetTop = () => p.evaluate(() => document.querySelector('.dock').getBoundingClientRect().top);
  const insets = () => p.evaluate(() => window.__xk8.stage.insets.bottom);
  const t0 = await sheetTop();
  check('sheet starts low, car dominant', t0 > PHONE_H * 0.7, t0);
  await drag(195, t0 + 18, PHONE_H * 0.5);
  const t1 = await sheetTop();
  check('drag up lands on half', Math.abs(t1 - (PHONE_H - 58) / 2) < 12, t1);
  const i1 = await insets();
  await drag(195, t1 + 18, 90);
  const t2 = await sheetTop();
  check('drag up lands on full', t2 < 70, t2);
  check('full height keeps the car framed for half', Math.abs((await insets()) - i1) < 2, await insets());
  await drag(195, t2 + 18, PHONE_H * 0.55, 200);
  const t3 = await sheetTop();
  check('drag down lands on half', Math.abs(t3 - t1) < 12, t3);
  await drag(195, t3 + 18, t3 + 120, 60, 0);
  const t4 = await sheetTop();
  check('a flick down lands on peek', Math.abs(t4 - t0) < 12, t4);

  await p.evaluate(async () => { const x = window.__xk8; x.store.set({view: 'side'}); await x.settle(); });
  const c = await p.evaluate(() => window.__xk8.stage.project([1.294, 0.33, 0.8]));
  await p.touchscreen.tap(c.x, c.y);
  await p.waitForTimeout(700);
  const s = await S(p);
  check('tap on the car selects a part', !!s.selected, s.selected);
  check('sheet rises for the part', (await sheetTop()) < t0 - 100, await sheetTop());
  await p.evaluate(() => window.__xk8.ui.select('engine.chain-tensioner-secondary'));
  await p.waitForTimeout(800);

  // pull-to-lower on content
  await p.evaluate(() => document.querySelector('.panel[data-mode=explore]').scrollTo(0, 0));
  const t5 = await sheetTop();
  await drag(195, t5 + 60, t5 + 240, 200, 0);
  check('pulling down on content at its top lowers the sheet', (await sheetTop()) > t5 + 80, await sheetTop());

  const audit = () => p.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('.top button, .modes button, .dock button, .dock input, .dock select, .dock summary, .dock a, .views button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || b.closest('[hidden]') || !b.checkVisibility() || b.type === 'range' || b.tabIndex === -1) continue;
      const pad = b.classList.contains('prov') ? 24 : b.classList.contains('dock-grip') ? 22 : 0; // their hit areas run past their boxes
      if (r.height + pad < 43.5) out.push(`${b.className || b.tagName} ${r.height.toFixed(0)}`);
    }
    return [...new Set(out)];
  });
  const small = await audit();
  check('touch targets at least 44 px, Explore', small.length === 0, small.slice(0, 8).join(', '));
  await p.evaluate(() => window.__xk8.store.set({selected: null, xray: false}));
  for (const [name, patch] of [['Run', {mode: 'run'}], ['Jobs', {mode: 'jobs'}], ['a job', {mode: 'jobs', job: {id: 'brake-pads-front', step: null}}], ['a step', {mode: 'jobs', job: {id: 'brake-pads-front', step: 2}}], ['Diagnose', {mode: 'diagnose', job: null}], ['Plan', {mode: 'plan', job: null}]]) {
    await p.evaluate((x) => window.__xk8.store.set(x), patch);
    await p.waitForTimeout(250);
    const bad = await audit();
    check(`touch targets at least 44 px, ${name}`, bad.length === 0, bad.slice(0, 8).join(', '));
  }
  check('no console errors, phone', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}

// ---- WebKit, the iPhone profile: what Chromium cannot show ----------------------------------------------------------
const wk = await webkit.launch();
const PHONE = {...devices['iPhone 14'], viewport: {width: 390, height: PHONE_H}};
const CAR = {variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}, chosen: true};
async function openWk(q, seed, device = PHONE, init = null) {
  const ctx = await wk.newContext(device);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  if (init) await p.addInitScript(init);
  if (seed) await p.addInitScript((x) => { if (!localStorage.getItem('xk8-workshop')) localStorage.setItem('xk8-workshop', x); }, JSON.stringify(seed));
  await p.goto(url(q));
  await p.waitForFunction(() => window.__xk8 || /did not start/.test(document.querySelector('#boot')?.textContent), null, {timeout: 120000});
  await p.waitForTimeout(500);
  return p;
}
{
  const p = await openWk('#/plan?v=4.0-na-coupe-1999', CAR);
  await p.tap('.ws-tabs--plan button:nth-child(2)');
  await p.waitForTimeout(250);
  const moved = [];
  for (const y of [700, 2000, 3300]) {
    await p.evaluate((t) => { document.querySelector('.ws-scroll').scrollTop = t; }, y);
    await p.waitForTimeout(80);
    const {fk, at} = await p.evaluate(() => {
      const box = document.querySelector('.ws-scroll'), b = [...document.querySelectorAll('.ws-bad')].find((x) => x.getBoundingClientRect().top > box.getBoundingClientRect().top + 40);
      b.scrollIntoView({block: 'center'});
      return {fk: b.dataset.fk, at: box.scrollTop};
    });
    await p.waitForTimeout(80);
    await p.locator(`[data-fk="${fk}"]`).tap();
    await p.waitForTimeout(200);
    moved.push(Math.round(await p.evaluate(() => document.querySelector('.ws-scroll').scrollTop) - at));
  }
  check('WebKit: a Bad tap keeps the list where it was', moved.every((d) => Math.abs(d) < 3), moved.join(', '));
  check('WebKit: no console errors, inspect', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}
{
  const p = await openWk('#/job/brake-pads-front/2?v=4.0-na-coupe-1999', CAR);
  const n = await p.evaluate(() => window.__xk8.jobStepsFor('brake-pads-front', window.__xk8.store.get().variant).length);
  let titles = 0;
  for (let i = 0; i < n; i++) {
    await p.evaluate((st) => window.__xk8.store.set({job: {id: 'brake-pads-front', step: st}}), i);
    await p.waitForTimeout(120);
    titles += await p.evaluate(() => { const b = document.querySelector('.ws-scroll').getBoundingClientRect(), t = document.querySelector('.ws-steptitle').getBoundingClientRect(); return t.top >= b.top - 1 && t.bottom <= b.bottom + 1 ? 1 : 0; });
  }
  check('WebKit: every step shows its title without a scroll', titles === n, `${titles} of ${n}`);
  await p.evaluate(() => window.__xk8.store.set({job: {id: 'brake-pads-front', step: 1}}));
  await p.waitForTimeout(150);
  await p.evaluate(() => window.__xk8.ui.select('brakes.guide-pin'));
  await p.waitForTimeout(250);
  check('WebKit: a lookup in a job offers the way back', await p.locator('.banner .link', {hasText: 'Back to step 2'}).count() === 1);
  await p.locator('.banner .link').tap();
  await p.waitForTimeout(200);
  const s = await S(p);
  check('WebKit: and it lands on that step', s.mode === 'jobs' && await p.evaluate(() => window.__xk8.store.get().job?.step) === 1);
  await p.context().close();
}
{
  const p = await openWk('#/job/oil-filter/4?v=4.0-na-coupe-1999&p=engine.oil-drain-plug', CAR);
  const s = await p.evaluate(() => { const x = window.__xk8.store.get(); return {mode: x.mode, step: x.job?.step}; });
  check('a part in a job link keeps you in the job', s.mode === 'jobs' && s.step === 3, JSON.stringify(s));
  await p.context().close();
}
{
  const own = {variant: {engine: '4.0', induction: 'sc', body: 'coupe', my: 2002, market: 'uk', serial: 'A29165'}, chosen: true};
  const p = await openWk('#/explore?v=4.2-na-convertible-2005', own);
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('xk8-workshop') || '{}').variant?.serial);
  await p.evaluate(() => window.__xk8.store.set({units: 'lbft'})); // forces a save
  check('a shared link does not overwrite your car', await saved() === 'A29165', await saved());
  check('and says so', /not your car/.test(await p.textContent('.banner')), await p.textContent('.banner'));
  await p.locator('.banner .link', {hasText: 'Back to my car'}).tap();
  await p.waitForTimeout(200);
  check('one tap goes back to it', (await p.evaluate(() => window.__xk8.store.get().variant.serial)) === 'A29165');
  await p.context().close();
}
for (const [name, seed, hash] of [['null car', {variant: null}, ''], ['bad ticks', {doneSteps: {'oil-filter': 5}}, '#/jobs'], ['bad list', {list: 7}, '#/plan'], ['made-up car', {variant: {engine: '9.9', body: 'van', my: 1950}}, '']]) {
  const p = await openWk(hash, seed);
  check(`saved data of the wrong shape still boots: ${name}`, await p.evaluate(() => !!window.__xk8) && p.errors.length === 0, p.errors.slice(0, 2).join(' | '));
  await p.context().close();
}
{
  const p = await openWk('', null, PHONE, () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : g.call(this, t, ...a); }; });
  check('no WebGL: the panels still come up', await p.evaluate(() => !!window.__xk8?.noGL && document.querySelector('#ui').childElementCount > 3));
  await p.evaluate(() => window.__xk8.ui.open('torque', 'wheels.wheel-nut-alloy-my1997-2002'));
  await p.waitForTimeout(600);
  check('no WebGL: a torque can be read', /88/.test(await p.textContent('.tq-value')), await p.textContent('.tq-value'));
  check('no WebGL: says the 3D view is missing', /not available/.test(await p.textContent('.banner')));
  check('no console errors, no WebGL', p.errors.length === 0, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}
await wk.close();

// ---- a lost GPU context, on a real one ---------------------------------------------------------------------------------
{
  const p = await open({viewport: {width: 1024, height: 700}}, '?tier=high');
  const paint = () => p.evaluate(async () => {
    const x = window.__xk8;
    x.store.set({view: 'side', selected: null});
    await x.settle();
    const c = x.stage.project([0.2, 0.62, 0.9]);
    return new Promise((res) => { x.stage.onFrame(() => false); requestAnimationFrame(() => { const gl = x.stage.renderer.getContext(), px = new Uint8Array(4); x.stage.invalidate(); requestAnimationFrame(() => { gl.readPixels(Math.round(c.x * devicePixelRatio), Math.round((x.stage.size.h - c.y) * devicePixelRatio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); res([...px].slice(0, 3).reduce((a, b) => a + b, 0)); }); }); });
  });
  const before = await paint();
  await p.evaluate(async () => {
    const x = window.__xk8, e = x.stage.renderer.getContext().getExtension('WEBGL_lose_context');
    e.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    e.restoreContext();
    await new Promise((r) => setTimeout(r, 500));
    x.stage.invalidate();
    await x.settle();
  });
  const env = await p.evaluate(() => !!window.__xk8.stage.scene.environment);
  const after = await paint();
  check('a lost GPU context comes back with its environment', env && after >= before * 0.5, `${before} -> ${after}`);
  await p.context().close();
}

// ---- language ---------------------------------------------------------------------------------------------------------
{
  const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
  const lang = (p) => p.evaluate(() => ({html: document.documentElement.lang, store: window.__xk8.store.get().lang, hash: location.hash, saved: JSON.parse(localStorage.getItem('xk8-workshop') ?? '{}').lang}));
  const reach = (p) => p.evaluate(() => { const b = document.querySelector('.seg-lang button:last-child'), r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.height; });
  const p = await open(phone);
  check('EN/FR is on the top bar on a phone, at thumb size', await reach(p) >= 44, await reach(p));
  await p.evaluate(() => { const {store, data} = window.__xk8; store.set({mode: 'jobs', job: {id: data.jobs.items[0].id, step: 1}, selected: null}); });
  await p.waitForTimeout(250);
  const before = await p.evaluate(() => { const s = window.__xk8.store.get(); return `${s.mode} ${s.job.id} ${s.job.step}`; });
  await p.click('.seg-lang button:last-child');
  await p.waitForFunction(() => document.documentElement.lang === 'fr');
  let l = await lang(p);
  check('French changes the page without a reload, with the job step kept', before === await p.evaluate(() => { const s = window.__xk8.store.get(); return `${s.mode} ${s.job.id} ${s.job.step}`; }), before);
  check('French is in the store, the hash and localStorage', l.store === 'fr' && /[?&]l=fr\b/.test(l.hash) && l.saved === 'fr', JSON.stringify(l));
  await p.reload();
  await p.waitForFunction(() => window.__xk8);
  l = await lang(p);
  check('French survives a reload', l.html === 'fr' && l.store === 'fr', JSON.stringify(l));
  check('the button shows French on', await p.getAttribute('.seg-lang button:last-child', 'aria-pressed') === 'true');
  await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-front'));
  await p.waitForTimeout(200);
  await p.click('.seg-lang button:first-child');
  await p.waitForFunction(() => document.documentElement.lang === 'en');
  l = await lang(p);
  check('English comes back, with the selection kept', !/l=/.test(l.hash) && l.saved === 'en' && await p.evaluate(() => window.__xk8.store.get().selected) === 'brakes.caliper-front', JSON.stringify(l));
  check('no console errors, language', !p.errors.length, p.errors[0] ?? '');
  await p.context().close();

  const side = await open({viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  check('EN/FR is on the top bar on its side', await reach(side) >= 30, await reach(side));
  await side.context().close();

  // No fr.js at all: a copy of the page on its own.
  const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'xk8-no-fr-'));
  fs.copyFileSync(path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html'), path.join(alone, 'index.html'));
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}});
  const q = await ctx.newPage();
  await q.goto(`file://${path.join(alone, 'index.html')}`);
  await q.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await q.click('.seg-lang button:last-child');
  await q.waitForTimeout(400);
  l = await lang(q);
  check('French that cannot load stays in English and says so', l.html === 'en' && l.store === 'en' && /could not be loaded/.test(await q.locator('.toast').textContent()), await q.locator('.toast').textContent());
  check('the button goes back to EN', await q.getAttribute('.seg-lang button:first-child', 'aria-pressed') === 'true');
  await ctx.close();
  fs.rmSync(alone, {recursive: true});
}

await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
