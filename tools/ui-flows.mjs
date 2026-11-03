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
/** Units and large text live in Settings. These open it, use it and leave it closed. */
const setUnits = async (p, which) => { await p.click('.top-menu'); await p.click(`dialog[open] .seg-wide button:text-is("${which}")`); await p.keyboard.press('Escape'); await p.waitForTimeout(80); };
const toggleLarge = async (p) => { await p.click('.top-menu'); await p.click('dialog[open] .menu-garage'); };
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
  const to = await p.evaluate(() => [...document.querySelectorAll('.sr')].findIndex((r) => r.querySelector('.sr-kind').textContent === 'How tight'));
  for (let i = 0; i < to; i++) await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  let s = await S(p);
  check('Enter on a torque opens its part', !!s.selected, s.selected);
  check('torque block is flashed', await p.locator('.tq.flash').count() === 1);
  const nm = await p.locator('.tq-value').first().textContent();
  await setUnits(p, 'lb ft');
  await p.waitForTimeout(80);
  const lb = await p.locator('.tq-value').first().textContent();
  check('units toggle changes the torque', nm !== lb && /lb ft/.test(lb.split(/\d\s/)[0] + lb), `${nm} -> ${lb}`);
  await setUnits(p, 'Nm');

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
  await p.locator('.ex-parts > summary').click();
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
  await p.locator('.mode[data-mode=run]').click();
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
  await p.locator('.btn', {hasText: 'Just the timing chains'}).click();
  await p.waitForTimeout(200);
  s = await S(p);
  check('isolate the chains: ghosts the rest, slows time', Array.isArray(s.isolate) && s.isolate.length > 0 && s.sim.timeScale === 0.05, `${s.isolate?.length} parts`);
  await p.locator('.btn', {hasText: 'Cut the engine open'}).click();
  await p.waitForTimeout(400);
  check('section cuts the engine', (await S(p)).sim.section === 'cyl1' && (await S(p)).isolate === null, (await S(p)).sim.section);
  await p.locator('.seg-rows button').nth(3).click();
  await p.waitForTimeout(120);
  await p.locator('.toggle', {hasText: 'Engine sound'}).click();
  await p.waitForTimeout(400);
  check('sound starts on request and only then', await p.evaluate(() => window.__xk8.ui.soundState()) === 'running', await p.evaluate(() => window.__xk8.ui.soundState()));
  await p.locator('.mode[data-mode=explore]').click();
  await p.waitForTimeout(300);
  s = await S(p);
  check('leaving Run stops it all', !s.sim.running && s.sim.section == null, s.sim.rpm);

  await toggleLarge(p);
  await p.waitForTimeout(200);
  check('garage mode sets the class', await p.evaluate(() => document.documentElement.classList.contains('garage')));
  check('garage asks for a wake lock and says what it got', /stays on|cannot keep/.test(await p.textContent('.toast')), await p.textContent('.toast'));
  await toggleLarge(p);

  await p.keyboard.press('Tab');
  const fv = await p.evaluate(() => { const a = document.activeElement; return {tag: a.tagName, outline: getComputedStyle(a).outlineStyle}; });
  check('keyboard focus is visible', fv.outline !== 'none', JSON.stringify(fv));
  for (const m of ['jobs', 'diagnose', 'plan', 'explore']) {
    await p.locator(`.mode[data-mode=${m}]`).click();
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
  const free = await p.evaluate(() => { const {h, insets} = {h: window.__xk8.stage.size.h, insets: window.__xk8.stage.insets}; return h - insets.top - insets.bottom; });
  check('the sheet starts with the four choices, and the car keeps its room', t0 > PHONE_H * 0.45 && free > 150, `${t0}, ${free} px of car`);
  await drag(195, t0 + 18, PHONE_H * 0.5);
  const t1 = await sheetTop();
  check('drag up lands on half', Math.abs(t1 - (PHONE_H - 58) / 2) < 12, t1);
  const i1 = await insets();
  await drag(195, t1 + 18, 90);
  const t2 = await sheetTop();
  check('drag up lands on full', t2 < 70, t2);
  check('full height keeps the car framed for half', Math.abs((await insets()) - i1) < 2, await insets());
  await drag(195, t2 + 18, t1 + 8, 200);
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
  check('sheet rises for the part', (await sheetTop()) < t0 - 10, await sheetTop());
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
// ---- tutorials: nothing leaves the page until it has to --------------------------------------------------------------
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AVP/Z', 'base64');
/** Stands in for YouTube, so these tests need no network and can count what the page asks for. */
async function fakeYouTube(ctx, {thumbs = true} = {}) {
  const asked = {thumbs: 0, frames: 0};
  await ctx.route(/i\.ytimg\.com/, (r) => { asked.thumbs++; return thumbs ? r.fulfill({body: JPEG, contentType: 'image/jpeg'}) : r.abort(); });
  await ctx.route(/youtube-nocookie\.com/, (r) => { asked.frames++; return r.fulfill({body: '<!doctype html><title>film</title>', contentType: 'text/html'}); });
  return asked;
}
const openJobIn = (p, id, step = null) => p.evaluate(([id, step]) => window.__xk8.store.set({mode: 'jobs', job: id ? {id, step} : null, selected: null, isolate: null}), [id, step]);
const inView = (p, selector) => p.evaluate((sel) => { const n = document.querySelector(sel); if (!n) return false; const r = n.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44 && !!top && (n === top || n.contains(top)); }, selector);
const OIL = 'yt-Gr2aMnVEZGQ';
{
  const p = await open({viewport: {width: 1280, height: 800}});
  const ctx = p.context();
  const asked = await fakeYouTube(ctx);
  await openJobIn(p, null);
  await p.waitForSelector('.tut-topics .ws-tile');
  await p.waitForTimeout(200);
  check('Jobs has a Learn the basics collection, with the topics asked for', await p.evaluate(() => { const w = [...document.querySelectorAll('.tut-topics strong')].map((x) => x.textContent); return ['Jacking up safely', 'Using a torque wrench', 'Reading fault codes'].every((x) => w.includes(x)); }));
  check('the Jobs list fetches nothing from YouTube', asked.thumbs === 0 && asked.frames === 0, JSON.stringify(asked));
  await p.locator('.tut-topics .ws-tile').first().click();
  await p.waitForSelector('.tut-topics + .tut-sec .tut');
  check('a topic opens its films, with the way to the jacking job', await p.locator('.tut-sec .ws-row').first().textContent().then((x) => /Where to jack/.test(x)));
  await p.locator('.tut-topics .ws-tile').first().click();

  await openJobIn(p, 'oil-filter');
  await p.waitForSelector('.tut-sec .tut');
  await p.waitForTimeout(300);
  const sec = await p.evaluate(() => { const n = document.querySelector('.tut-sec'), c = n.querySelector('.tut'); return {after: n.previousElementSibling?.className, head: n.querySelector('h3').textContent, text: c.textContent, img: c.querySelector('img').getAttribute('src'), lazy: c.querySelector('img').getAttribute('loading')}; });
  check('Watch it being done comes straight after the safety block', /ws-safety/.test(sec.after) && sec.head === 'Watch it being done', sec.after);
  check('a card has title, channel, length, language and fit in plain words', /Oil and Filter EP39/.test(sec.text) && /Modurol, 8 min/.test(sec.text) && /In English/.test(sec.text) && /Filmed on an XK8/.test(sec.text), sec.text.slice(0, 120));
  check('a caution is on the card', /Be careful/.test(await p.locator('.tut').first().textContent()) && await p.locator('.tut .ws-call--warn').first().isVisible());
  check('thumbnails come from i.ytimg.com, lazily', /^https:\/\/i\.ytimg\.com\/vi\/Gr2aMnVEZGQ\//.test(sec.img) && sec.lazy === 'lazy' && asked.thumbs > 0, sec.img);
  check('no film loads before a tap', asked.frames === 0 && await p.locator('iframe').count() === 0, asked.frames);
  await setUnits(p, 'lb ft');
  await p.waitForTimeout(80);
  check('a caution follows the units', /lb ft/.test(await p.locator('.tut .ws-call--warn').first().textContent()), await p.locator('.tut .ws-call--warn').first().textContent());
  await setUnits(p, 'Nm');
  await p.waitForTimeout(80);
  await p.locator('.tut-thumb').first().click();
  await p.waitForSelector('.tut-dock iframe');
  await p.waitForTimeout(150);
  const src = await p.getAttribute('.tut-dock iframe', 'src');
  check('a tap plays on the page, from youtube-nocookie, once', /^https:\/\/www\.youtube-nocookie\.com\/embed\/Gr2aMnVEZGQ\?/.test(src) && asked.frames === 1, src);
  check('the page keeps Open on YouTube beside the film', /youtube\.com\/watch\?v=Gr2aMnVEZGQ/.test(await p.getAttribute('.tut-out', 'href')));
  await p.locator('[data-fk=addlist]').click();
  await p.waitForTimeout(150);
  await p.locator('[data-fk=addlist]').click();
  await p.waitForTimeout(150);
  check('a repaint of the panel does not restart the film', asked.frames === 1 && await p.locator('.tut-dock iframe').count() === 1, asked.frames);
  asked.frames = 0;
  await p.click('.tut-close');
  check('Close takes the film away', await p.locator('iframe').count() === 0);
  await p.locator('.tut-thumb').first().focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('.tut-dock iframe');
  check('from the keyboard, focus moves to Close', await p.evaluate(() => document.activeElement?.classList.contains('tut-close')));
  await p.keyboard.press('Enter');
  await p.waitForTimeout(100);
  check('and comes back to the card', await p.locator('iframe').count() === 0 && await p.evaluate(() => document.activeElement?.classList.contains('tut-thumb')));

  const untimed = await p.evaluate(() => { const {data} = window.__xk8; const timed = new Set(data.tutorials.items.flatMap((r) => (r.steps ?? []).filter((x) => x.job === 'gearbox-service').map((x) => x.step))); return data.jobs.byId.get('gearbox-service').steps.findIndex((_, i) => !timed.has(i)); });
  await openJobIn(p, 'gearbox-service', untimed);
  await p.waitForSelector('.ws-steptitle');
  await p.waitForTimeout(150);
  check('a step with no timestamp has no Watch this step', await p.locator('.tut-go').count() === 0, untimed);
  await openJobIn(p, 'oil-filter', 3);
  await p.waitForSelector('.tut-go');
  check('a timed step says who and when', /Watch this step/.test(await p.textContent('.tut-go')) && /Modurol, from 2:53/.test(await p.textContent('.tut-go')), await p.textContent('.tut-go'));
  await p.click('.tut-go');
  await p.waitForSelector('.tut-dock iframe');
  check('Watch this step starts at the recorded second', /[?&]start=173\b/.test(await p.getAttribute('.tut-dock iframe', 'src')));
  check('Next and Back stay usable, desktop', await inView(p, '[data-fk=next]') && await inView(p, '[data-fk=prev]'));
  await p.click('[data-fk=next]');
  await p.waitForTimeout(200);
  check('moving to the next step keeps the film', await p.locator('.tut-dock iframe').count() === 1);
  await openJobIn(p, 'air-filter');
  await p.waitForTimeout(200);
  check('another job stops the film', await p.locator('iframe').count() === 0);
  const timed = await p.evaluate(() => { const {data} = window.__xk8; let bad = 0, n = 0; for (const r of data.tutorials.items) for (const s of r.steps ?? []) { n++; if (!(s.atSec >= 0 && s.atSec < r.seconds && data.jobs.byId.get(s.job).steps[s.step])) bad++; } return {bad, n}; });
  check('every timestamp sits inside its film and on a real step', timed.bad === 0 && timed.n > 150, JSON.stringify(timed));

  await p.evaluate(() => window.__xk8.store.set({variant: {engine: '4.2', induction: 'na', body: 'coupe', my: 2003, market: 'uk'}}));
  await openJobIn(p, 'chain-tensioner-42');
  await p.waitForSelector('.ws-safety');
  await p.waitForTimeout(150);
  check('a job with no tutorial shows nothing', await p.locator('.tut-sec, .tut, .tut-step').count() === 0 && !/Watch it being done/.test(await p.textContent('.ws-scroll')));
  await p.evaluate(() => window.__xk8.store.set({variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}}));

  await openJobIn(p, 'battery-drain-test');
  await p.waitForSelector('.tut--guide');
  check('a written guide is a simple card that links out', await p.getAttribute('.tut--guide a.ws-btn', 'target') === '_blank' && /^https?:/.test(await p.getAttribute('.tut--guide a.ws-btn', 'href')) && await p.locator('.tut--guide .tut-thumb').count() === 0);

  await p.evaluate((id) => { window.__xk8.data.tutorials.byId.get(id).embeddable = false; }, OIL);
  await openJobIn(p, null);
  await p.waitForTimeout(100);
  await openJobIn(p, 'oil-filter');
  await p.waitForSelector('a.tut-thumb');
  check('a film that cannot be embedded opens on YouTube', /^https:\/\/www\.youtube\.com\/watch\?v=Gr2aMnVEZGQ/.test(await p.getAttribute('a.tut-thumb', 'href')) && await p.getAttribute('a.tut-thumb', 'target') === '_blank' && /Opens on YouTube/.test(await p.textContent('a.tut-thumb')));
  await openJobIn(p, 'oil-filter', 3);
  await p.waitForSelector('a.tut-go');
  check('so does its step, at the same moment', /&t=173s$/.test(await p.getAttribute('a.tut-go', 'href')), await p.getAttribute('a.tut-go', 'href'));
  await p.evaluate((id) => { window.__xk8.data.tutorials.byId.get(id).embeddable = true; }, OIL);

  const panel = (kind, id) => p.evaluate(([kind, id]) => window.__xk8.ui.open(kind, id), [kind, id]);
  const ids = await p.evaluate(() => { const d = window.__xk8.data, v = window.__xk8.store.get().variant; const of = (k) => d.tutorials.items.find((r) => r.kind === 'video' && !r.appliesTo && r.for[k]?.length)?.for[k][0]; return {fault: of('faults'), part: of('parts'), weak: d.weakspots.items.find((w) => !d.tutorials.items.some((r) => r.for.parts?.some((x) => (w.parts ?? []).includes(x))) && d.tutorials.items.some((r) => r.for.weakspots?.includes(w.id)))?.id ?? of('weakspots')}; });
  await panel('fault', ids.fault);
  await p.waitForTimeout(250);
  check('a fault panel shows its tutorials', await p.locator('[data-mode=diagnose] .tut').count() > 0, ids.fault);
  await panel('fault', 'fuel-smell');
  await p.waitForTimeout(250);
  check('a fault with none shows nothing', await p.locator('[data-mode=diagnose] .tut, [data-mode=diagnose] .tut-fold').count() === 0 && !/Videos and guides/.test(await p.textContent('[data-mode=diagnose]')));
  await p.evaluate(() => window.__xk8.store.set({mode: 'explore'}));
  await panel('part', ids.part);
  await p.waitForTimeout(350);
  check('a part panel shows its tutorials', await p.locator('.ex-part .tut').count() > 0, ids.part);
  check('a caution in Explore is as loud as anywhere else', await p.evaluate(() => getComputedStyle(document.querySelector('.ex-part .tut .ws-call--warn')).backgroundColor) === 'rgb(251, 240, 218)');
  await p.locator('.ex-part .tut-thumb').first().click();
  await p.waitForSelector('.tut-dock iframe');
  await p.evaluate(() => window.__xk8.store.set({mode: 'run'}));
  await p.waitForTimeout(150);
  check('leaving Explore stops the film', await p.locator('iframe').count() === 0);
  await p.evaluate(() => window.__xk8.store.set({mode: 'explore'}));
  await panel('weakspot', ids.weak);
  await p.waitForTimeout(350);
  check('a weak spot offers its tutorials', await p.locator('.tut-fold, [data-mode=diagnose] .tut').count() > 0, ids.weak);
  check('no console errors, tutorials', !p.errors.length, p.errors.slice(0, 3).join(' | '));
  await ctx.close();

  const off = await open({viewport: {width: 1280, height: 800}});
  await fakeYouTube(off.context(), {thumbs: false});
  await openJobIn(off, 'oil-filter');
  await off.waitForSelector('.tut-thumb');
  await off.waitForFunction(() => !document.querySelector('.tut-img'), null, {timeout: 5000}).catch(() => {});
  const look = await off.evaluate(() => { const b = document.querySelector('.tut-thumb').getBoundingClientRect(), g = document.querySelector('.tut-play').getBoundingClientRect(); return {imgs: document.querySelectorAll('.tut-sec .tut-img').length, h: Math.round(b.height), play: g.width > 40}; });
  check('offline, a thumbnail is a tidy panel with the play button', look.imgs === 0 && look.h > 150 && look.play, JSON.stringify(look));
  await off.context().setOffline(true);
  await off.locator('.tut-thumb').first().click();
  await off.waitForTimeout(150);
  check('offline, a tap says why instead of opening a dead frame', await off.locator('iframe').count() === 0 && /connection/.test(await off.locator('.toast').last().textContent()));
  await off.context().close();

  const size = fs.statSync(path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')).size;
  check('the page stays under 1 MB raw', size < 1e6, size);
}
// The phone is where the film could cover the buttons, so this runs on WebKit and on Chromium.
for (const [name, device, opener] of [['iPhone', PHONE, (d) => openWk('', CAR, d)], ['phone', {viewport: {width: 390, height: PHONE_H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}, (d) => open(d)], ['phone on its side', {viewport: {width: 844, height: 390}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}, (d) => open(d)]]) {
  const p = await opener(device);
  const asked = await fakeYouTube(p.context());
  await openJobIn(p, 'oil-filter', 3);
  await p.waitForSelector('.tut-go');
  await p.waitForTimeout(600);
  await p.locator('.tut-go').tap();
  await p.waitForSelector('.tut-dock iframe');
  await p.waitForTimeout(700);
  const frame = await p.evaluate(() => { const r = document.querySelector('.tut-dock iframe').getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), right: Math.round(r.right)}; });
  check(`${name}: the player opens at the moment, on the page`, /[?&]start=173\b/.test(await p.getAttribute('.tut-dock iframe', 'src')) && /playsinline=1/.test(await p.getAttribute('.tut-dock iframe', 'src')) && asked.frames === 1, JSON.stringify(frame));
  check(`${name}: the player is a good size`, frame.h >= 120 && frame.top >= 0 && frame.right <= await p.evaluate(() => innerWidth), JSON.stringify(frame));
  check(`${name}: Next and Back are not hidden`, await inView(p, '[data-fk=next]') && await inView(p, '[data-fk=prev]'));
  await p.locator('[data-fk=next]').tap();
  await p.waitForTimeout(350);
  check(`${name}: Next still works with the film up`, await p.evaluate(() => window.__xk8.store.get().job.step) === 4 && await p.locator('.tut-dock iframe').count() === 1);
  await p.locator('.tut-close').tap();
  await p.waitForTimeout(200);
  await openJobIn(p, 'oil-filter');
  await p.waitForSelector('.tut-thumb');
  await p.waitForTimeout(600);
  await p.locator('.tut-thumb').first().tap();
  await p.waitForSelector('.tut-dock iframe');
  await p.waitForTimeout(900);
  check(`${name}: on the overview the film and Start stay on screen`, await inView(p, '[data-fk=start]') && (await p.locator('.tut-dock iframe').boundingBox()).height >= 120, JSON.stringify(await p.locator('.tut-dock iframe').boundingBox()));
  check(`${name}: no console errors, tutorials`, !p.errors.length, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}
{
  const p = await open({viewport: {width: 1280, height: 800}}, '#/job/brake-pads-front?l=fr');
  await fakeYouTube(p.context());
  await p.waitForFunction(() => document.documentElement.lang === 'fr');
  await openJobIn(p, 'brake-pads-front');
  await p.waitForSelector('.tut');
  const first = await p.evaluate(() => { const c = document.querySelector('.tut'), r = window.__xk8.data.tutorials.byId.get(c.dataset.tut); return {lang: r.lang, tag: c.querySelector('.tut-tags').textContent}; });
  check('in French a French video comes first, and says so', first.lang === 'fr' && /En français/.test(first.tag), JSON.stringify(first));
  check('in French an English video is labelled as English', /En anglais/.test(await p.locator('.tut').nth(1).locator('.tut-tags').textContent()), await p.locator('.tut').nth(1).locator('.tut-tags').textContent());
  check('in French the section heading is French', await p.textContent('.tut-head') !== 'Watch it being done', await p.textContent('.tut-head'));
  check('no console errors, French tutorials', !p.errors.length, p.errors.slice(0, 3).join(' | '));
  await p.context().close();
}

// ---- plain words: someone who has never held a torque wrench -------------------------------------------------------------
{
  const WORDS = ['Something\'s wrong with my car', 'I want to fix or service something', 'Show me how it works', 'I\'m thinking of buying one'];
  const carRoom = (p) => p.evaluate(() => { const x = window.__xk8.stage; return {h: x.size.h - x.insets.top - x.insets.bottom, w: x.size.w - x.insets.left - x.insets.right}; });
  const FRESH = {viewport: {width: 390, height: 844}};
  for (const [name, device, opener] of [['iPhone', {...devices['iPhone 14'], viewport: FRESH.viewport}, (d) => openWk('', null, d)], ['desktop', {viewport: {width: 1440, height: 900}}, (d) => open(d)]]) {
    const first = await opener(device);
    check(`${name}: the first screen offers the four plain choices`, (await first.locator('.choice').allTextContents()).join('|') === WORDS.join('|'), (await first.locator('.choice').allTextContents()).join('|'));
    check(`${name}: and every choice is in view`, await first.evaluate(() => [...document.querySelectorAll('.choice')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; })));
    const room = await carRoom(first);
    check(`${name}: the car stays visible beside them`, room.h > 200 && room.w > 340, JSON.stringify(room));
    check(`${name}: no second set of buttons repeats the modes`, await first.locator('.ex-watch, .ex-apart').count() === 0);
    await first.context().close();
    const press = async (what) => { const p = await opener(device); await p.locator(`.choice[data-what=${what}]`).click(); await p.waitForTimeout(700); return p; };
    const panelHas = (p, sel) => p.locator(sel).first().isVisible();
    const wrong = await press('wrong');
    check(`${name}: something wrong goes to the search for a symptom`, (await S(wrong)).mode === 'diagnose' && await panelHas(wrong, '.ws-search') && /What's wrong\?/.test(await wrong.textContent('.ws-top h2')));
    check(`${name}: and the car is still there`, (await carRoom(wrong)).h > 150, JSON.stringify(await carRoom(wrong)));
    await wrong.context().close();
    const fix = await press('fix');
    check(`${name}: fix or service goes to the jobs`, (await S(fix)).mode === 'jobs' && await panelHas(fix, '.ws-job'));
    await fix.context().close();
    const how = await press('how');
    const running = await S(how);
    check(`${name}: how it works goes to the engine running`, running.mode === 'run' && running.sim.running, running.mode);
    await how.context().close();
    const buy = await press('buy');
    const onPlan = await buy.evaluate(() => ({mode: window.__xk8.store.get().mode, tab: document.querySelector('.ws-tabs--plan [aria-selected=true]')?.textContent, cand: JSON.parse(localStorage.getItem('xk8-workshop-plan')).candidate}));
    check(`${name}: buying goes to the checklist, kept apart from your own car`, onPlan.mode === 'plan' && /Check a car/.test(onPlan.tab) && !!onPlan.cand && await panelHas(buy, '.ws-check'), JSON.stringify(onPlan));
    await buy.context().close();
  }

  const p = await open({viewport: {width: 1440, height: 900}}, '#/explore?v=4.0-na-coupe-1999');
  await p.evaluate(() => window.__xk8.store.set({linked: null, chosen: true}));
  await p.waitForTimeout(150);
  check('modes have ordinary names', (await p.locator('.top .mode:not(.mode-search)').allTextContents()).join('|') === 'The car|Run it|Fix it|What\'s wrong|Upkeep', (await p.locator('.top .mode:not(.mode-search)').allTextContents()).join('|'));
  check('Explode is Take it apart, X-ray is See through it', /Take it apart/.test(await p.textContent('[data-name=explode]')) && await p.locator('.tool-xray', {hasText: 'See through it'}).count() === 1);
  const page = await p.textContent('#ui');
  check('the jargon is gone from the home screen', !/\b(?:Explode|X-ray|Ghost|Isolate|Skin off|Chassis|Drivetrain|Prone to)\b/.test(page), page.match(/\b(?:Explode|X-ray|Ghost|Isolate|Skin off|Chassis|Drivetrain|Prone to)\b/)?.[0]);
  await p.evaluate(() => window.__xk8.ui.takeApart(true)); // what search's "Take it apart" page does
  await p.waitForFunction(() => window.__xk8.store.get().explode === 1, null, {timeout: 4000});
  check('Take it apart runs the car apart, and the slider follows', await p.locator('[data-name=explode] input').inputValue() === '1');
  await p.evaluate(() => window.__xk8.ui.takeApart(false));
  await p.waitForFunction(() => window.__xk8.store.get().explode === 0, null, {timeout: 4000});
  check('and it goes back together', await p.locator('[data-name=explode] input').inputValue() === '0');

  await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-rear'));
  await p.waitForTimeout(300);
  check('badges say where a number comes from in plain words', (await p.locator('.ex-part .prov').allTextContents()).every((x) => /^(?:From Jaguar|Several sources agree|One source|Owners say|Estimated|From Jaguar, to 2004|From Jaguar, 4\.2 manual)$/.test(x)), (await p.locator('.ex-part .prov').allTextContents()).slice(0, 4).join('|'));
  const order = await p.evaluate(() => [...document.querySelectorAll('.ex-part .part-lead, .ex-part .lab')].map((x) => (x.matches('.part-lead') ? 'What it does' : x.textContent)));
  check('a part starts with what it does, and the numbers follow', order[0] === 'What it does' && order.findIndex((x) => x.startsWith('Part numbers')) > order.indexOf('Why it matters'), order.slice(0, 5).join(', '));
  await p.evaluate(() => window.__xk8.store.set({selected: null}));

  const jobs = await p.evaluate(() => window.__xk8.data.jobs.items.map((j) => j.id));
  const short = [];
  for (const id of jobs) {
    const r = await p.evaluate((x) => { window.__xk8.store.set({mode: 'jobs', job: {id: x, step: null}, selected: null}); const b = document.querySelector('.ws-scroll'); const d = b.querySelector('.ws-diy'); if (!d) return window.__xk8.data.jobs.byId.get(x).appliesTo ? 'other car' : 'none'; const head = b.querySelector('.ws-top'); return {next: head.nextElementSibling === d || (x === 'flat-battery' && head.nextElementSibling.nextElementSibling === d), labels: [...d.querySelectorAll('dt')].map((t) => t.textContent).join('|'), answer: d.querySelector('.ws-diy-answer').textContent}; }, id);
    if (r === 'other car') continue;
    if (r === 'none' || !r.next || !r.answer || !/Who it suits/.test(r.labels) || !/When to stop/.test(r.labels) || !/How long it really takes/.test(r.labels)) short.push(id);
  }
  check('every job leads with Can I do this myself?, with who, how long and when to stop', !short.length, short.slice(0, 4).join());
  await p.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'wheel-bearing-front', step: null}}));
  await p.waitForTimeout(150);
  check('a job for a garage says so', /Best left to a garage/.test(await p.textContent('.ws-diy-answer')) && /press/.test(await p.textContent('.ws-diy')));
  await p.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'oil-filter', step: null}}));
  await p.waitForTimeout(150);
  check('a first job says yes, and what it takes', /^Yes$/.test(await p.textContent('.ws-diy-answer')) && /Axle stands/.test(await p.textContent('.ws-diy')) && /twice/.test(await p.textContent('.ws-diy')));
  check('what an expert wants is one tap behind', await p.locator('.ws-sec:not([open]) .ws-parts').count() === 1 && await p.locator('.ws-sec:not([open]) .ws-tools').count() === 1 && await p.locator('.ws-sec:not([open]) .ws-facts').count() === 1);
  await p.evaluate(() => window.__xk8.store.set({job: {id: 'oil-filter', step: 0}}));
  await p.waitForTimeout(200);
  const term = p.locator('.ws-steptext .term').first();
  const word = await term.textContent();
  await term.click();
  await p.waitForSelector('.dlg-term');
  check('a word in a step opens a short plain meaning', (await p.textContent('.dlg-term .dlg-title')).toLowerCase().includes(word.toLowerCase().replace(/s$/, '')) && (await p.textContent('.term-def')).length > 20, `${word}: ${await p.textContent('.term-def')}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(80);
  check('Escape closes it and focus returns to the word', await p.locator('.dlg-term').count() === 0 && await p.evaluate(() => document.activeElement?.classList.contains('term')));
  await p.locator('.ws-steptext .term').first().focus();
  await p.keyboard.press('Enter');
  await p.waitForSelector('.dlg-term');
  check('the keyboard opens it too', true);
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.__xk8.store.set({job: {id: 'oil-filter', step: null}}));
  await p.waitForTimeout(200);
  const warn = await p.evaluate(() => { const box = document.querySelector('.ws-safety'), n = box.querySelector('li .term'); if (!n) return null; n.scrollIntoView({block: 'center'}); const a = getComputedStyle(n), b = getComputedStyle(n.closest('li')); const r = n.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; return {same: a.color === b.color && a.fontWeight === b.fontWeight && a.backgroundColor === 'rgba(0, 0, 0, 0)', up: !!document.elementFromPoint(cx, cy - 19)?.closest('.term'), down: !!document.elementFromPoint(cx, cy + 19)?.closest('.term')}; });
  check('in a warning a word changes only by its dotted line', warn?.same, JSON.stringify(warn));
  check('and it is a 44 px target without looking like one', warn?.up && warn?.down, JSON.stringify(warn));
  check('no console errors, plain words', !p.errors.length, p.errors.slice(0, 3).join(' | '));
  await p.context().close();

  // once only
  const ctx = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2});
  const q = await ctx.newPage();
  await q.goto(url());
  await q.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await q.waitForTimeout(300);
  check('a first visit gets the hint on how to move the car', await q.locator('.move-hint').isVisible() && /Pinch/.test(await q.textContent('.move-hint')), await q.textContent('.move-hint'));
  await q.locator('.move-hint .link').tap();
  check('Got it takes it away', !(await q.locator('.move-hint').isVisible()));
  await q.reload();
  await q.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await q.waitForTimeout(300);
  check('and it does not come back', !(await q.locator('.move-hint').isVisible()));
  await ctx.close();
  const ctx2 = await browser.newContext({viewport: {width: 1280, height: 800}});
  const r = await ctx2.newPage();
  await r.goto(url());
  await r.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await r.waitForTimeout(300);
  await r.mouse.click(300, 500);
  await r.waitForTimeout(100);
  check('touching the car also takes it away', !(await r.locator('.move-hint').isVisible()));
  await ctx2.close();

  // reading it at the car
  const iph = await openWk('#/job/oil-filter/2?v=4.0-na-coupe-1999', CAR, {...devices['iPhone 14'], viewport: {width: 390, height: 844}});
  const size = await iph.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ws-steptext')).fontSize));
  check('step text is big by default', size >= 19, size);
  const tapTerm = iph.locator('.ws-steptext .term').first();
  if (await tapTerm.count()) { await tapTerm.tap(); await iph.waitForSelector('.dlg-term'); check('WebKit: a tap on a word opens its meaning', (await iph.textContent('.term-def')).length > 20); await iph.locator('.dlg-close').tap(); }
  await iph.context().close();
  const FRCAR = {variant: {engine: '4.0', induction: 'sc', body: 'coupe', my: 2002, market: 'uk'}, chosen: true};
  for (const [name, hash, seed, want] of [['English', '#/explore?v=4.2-na-coupe-2003', null, /2003 XK8 4\.2 coupe/], ['French', '#/explore?v=4.2-na-coupe-2003&l=fr', null, /XK8 4\.2 coupé de 2003/], ['two ways out', '#/explore?v=4.2-na-convertible-2005', FRCAR, /2005 XK8 4\.2/]]) {
    const b = await openWk(hash, seed, {...devices['iPhone 14'], viewport: {width: 390, height: 844}});
    await b.waitForTimeout(400);
    const box = await b.evaluate(() => { const n = document.querySelector('.banner-link'), r = n.getBoundingClientRect(); return {h: Math.round(r.height), text: n.querySelector('.banner-short').textContent, long: getComputedStyle(n.querySelector('.banner-long')).display}; });
    check(`the shared-link banner is one small line on a phone, ${name}`, box.h <= 46 && box.long === 'none', JSON.stringify(box));
    check(`and it reads properly, ${name}`, want.test(box.text), box.text);
    await b.context().close();
  }
  const frStep = await open({viewport: {width: 1280, height: 800}}, '#/job/oil-filter/1?v=4.0-na-coupe-1999&l=fr');
  await frStep.waitForFunction(() => document.documentElement.lang === 'fr');
  await frStep.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'brake-pads-front', step: null}}));
  await frStep.waitForTimeout(300);
  check('French marks French words, with a French meaning', await frStep.locator('.ws-safety .term, .ws-diy .term').count() > 0, await frStep.locator('.ws-safety .term, .ws-diy .term').first().textContent());
  await frStep.locator('.ws-safety .term, .ws-diy .term').first().click();
  await frStep.waitForSelector('.dlg-term');
  check('and opens it', /[éèàêç]| le | la | de /.test(await frStep.textContent('.term-def')), await frStep.textContent('.term-def'));
  check('French names the modes in ordinary words', /La voiture/.test(await frStep.textContent('.modes')) && /Réparer/.test(await frStep.textContent('.modes')));
  await frStep.context().close();
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

// ---- feedback, with the network mocked. tools/test-feedback.mjs tests the server ------------------------------------------
{
  const API = 'https://xk8.paulcouach.com/api/feedback';
  const SEED = {variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}, chosen: true};
  const answer = (status, body = {ok: status < 300}) => ({status, headers: {'access-control-allow-origin': 'null', 'content-type': 'application/json'}, body: JSON.stringify(body)});
  /** A page behind a mock. net.reply is what the next post gets; net.posts is what has arrived. */
  async function fbPage(engine, device, q = '') {
    const ctx = await engine.newContext(device);
    const net = {posts: [], other: 0, reply: () => answer(200)};
    await ctx.route(API, (r) => { if (r.request().method() === 'POST') net.posts.push(r.request().postDataJSON()); const x = net.reply(); return x === 'abort' ? r.abort() : r.fulfill(x); });
    await ctx.addInitScript((x) => { if (!localStorage.getItem('xk8-workshop')) localStorage.setItem('xk8-workshop', x); }, JSON.stringify(SEED));
    const p = await ctx.newPage();
    p.on('request', (r) => { if (/^https?:/.test(r.url()) && r.url() !== API) net.other++; });
    p.errors = [];
    p.on('pageerror', (e) => p.errors.push(e.message)); // a mocked 500 logs to the console by design, so only real exceptions count here
    await p.goto(url(q));
    await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
    await p.waitForTimeout(300);
    return {p, ctx, net, queue: () => p.evaluate(() => JSON.parse(localStorage.getItem('xk8-feedback-queue') ?? '[]').length)};
  }
  const STEP = {mode: 'jobs', job: {id: 'brake-pads-front', step: 2}, selected: null};
  const SCREENS = [['Explore', {mode: 'explore', job: null, selected: null}], ['Run', {mode: 'run', job: null}], ['Jobs', {mode: 'jobs', job: null}], ['a step', STEP], ['Diagnose', {mode: 'diagnose', job: null}], ['Plan', {mode: 'plan', job: null}], ['a part', {mode: 'explore', job: null, selected: 'brakes.caliper-front'}]];
  /** On top of whatever is under it, and touching no other control. */
  const clear = (p) => p.evaluate(() => {
    const b = document.querySelector('.fb-btn'), r = b.getBoundingClientRect();
    const onTop = b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    const onScreen = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.width >= 36 && r.height >= 36;
    const hit = [...document.querySelectorAll('#ui button, #ui a, #ui input, #ui select')].filter((o) => o !== b && !b.contains(o) && o.checkVisibility() && o.tabIndex !== -1).filter((o) => { const q = o.getBoundingClientRect(); return q.width && q.left < r.right - .5 && q.right > r.left + .5 && q.top < r.bottom - .5 && q.bottom > r.top + .5; });
    return {ok: onTop && onScreen && !hit.length, detail: `${onTop} ${onScreen} ${hit.map((o) => o.className).join()}`};
  });

  // every screen, both shapes
  for (const [shape, device] of [['phone', {viewport: {width: 390, height: PHONE_H}, deviceScaleFactor: 2, hasTouch: true, isMobile: true}], ['desktop', {viewport: {width: 1440, height: 900}}]]) {
    const {p, ctx, net} = await fbPage(browser, device, '#/explore?v=4.0-na-coupe-1999');
    const bad = [];
    for (const [name, patch] of SCREENS) {
      await p.evaluate((x) => window.__xk8.store.set(x), patch);
      await p.waitForTimeout(250);
      const c = await clear(p);
      if (!c.ok) bad.push(`${name}: ${c.detail}`);
    }
    check(`feedback button is clear of every control on every screen, ${shape}`, !bad.length, bad.join(' | '));
    check(`nothing is sent until someone presses Send, ${shape}`, net.posts.length === 0 && net.other === 0, `${net.posts.length} ${net.other}`);
    await ctx.close();
  }

  // the form, on a phone
  {
    const {p, ctx, net, queue} = await fbPage(browser, {viewport: {width: 390, height: PHONE_H}, deviceScaleFactor: 2, hasTouch: true, isMobile: true}, '#/plan?v=4.0-na-coupe-1999');
    await p.locator('.fb-btn').tap();
    await p.waitForSelector('.dlg-feedback');
    await p.waitForTimeout(450); // the dialog's rise
    check('the button opens the form with three big choices', await p.locator('.fb-choice').count() === 3 && (await p.locator('.fb-choice').first().boundingBox()).height >= 44);
    const shown = await p.evaluate(() => { const tall = [...document.querySelectorAll('.dlg-feedback button, .dlg-feedback input:not([tabindex="-1"]):not([type=radio]), .dlg-feedback textarea, .fb-choice')].filter((x) => x.getBoundingClientRect().height < 43.5).map((x) => x.className); const trap = document.querySelector('.dlg-feedback input[name=website]'); const r = trap.parentElement.getBoundingClientRect(); const s = document.querySelector('.fb-send').getBoundingClientRect(); return {tall, trap: trap.tabIndex === -1 && r.width <= 1 && r.height <= 1, sendOn: s.bottom <= innerHeight + 1 && s.top >= 0 && document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2)?.classList.contains('fb-send')}; });
    check('every target in the form is at least 44 px', !shown.tall.length, shown.tall.join());
    check('the honeypot cannot be seen or tabbed to', shown.trap);
    check('Send is in view without scrolling', shown.sendOn);
    check('it says what is sent', /your message, the page you were on and which car/.test(await p.textContent('.fb-note')) && /do not keep your IP address/.test(await p.textContent('.fb-note')));
    await p.click('.fb-send');
    check('Send without a choice asks for one, and sends nothing', /Choose one/.test(await p.textContent('.fb-problem')) && net.posts.length === 0);
    await p.locator('.fb-choice', {hasText: 'I have an idea'}).tap();
    await p.click('.fb-send');
    check('Send with no words asks for them', /few words/.test(await p.textContent('.fb-problem')) && net.posts.length === 0);
    await p.fill('#fb-message', '  Add the XJ8 too.  ');
    await p.fill('#fb-contact', 'owner@example.com');
    await p.click('.fb-send');
    await p.waitForSelector('.fb-done');
    const m = net.posts[0];
    check('the message goes with its page and car, and no file path', m?.kind === 'idea' && m.message === 'Add the XJ8 too.' && m.contact === 'owner@example.com' && m.page.startsWith('#/plan') && m.car === '4.0-na-coupe-1999' && m.website === '' && !JSON.stringify(m).includes('file:'), JSON.stringify(m));
    check('success is said plainly', /reached us/.test(await p.textContent('.fb-done')));
    await p.locator('.fb-done .fb-send').tap();
    await p.waitForTimeout(100);
    check('and it closes', await p.locator('.dlg-feedback').count() === 0);

    await p.locator('.fb-btn').tap();
    await p.locator('.fb-choice', {hasText: 'Thank you'}).tap();
    await p.click('.fb-send');
    await p.waitForSelector('.fb-done');
    check('a thank you can be one tap', net.posts[1]?.kind === 'thanks' && net.posts[1].message === '');
    await p.locator('.fb-done .fb-send').tap();

    // Something wrong here?
    await p.evaluate((x) => window.__xk8.store.set(x), {mode: 'jobs', job: {id: 'brake-pads-front', step: null}, selected: null});
    await p.waitForTimeout(250);
    check('no link on a job overview', await p.locator('.fb-here').count() === 0);
    await p.evaluate((x) => window.__xk8.store.set(x), STEP);
    await p.waitForTimeout(250);
    check('a job step offers the link, inside the step', await p.locator('.ws-scroll .fb-here').count() === 1);
    await p.evaluate(() => window.__xk8.store.set({units: 'lbft'}));
    await p.waitForTimeout(200);
    check('and keeps it when the step repaints', await p.locator('.ws-scroll .fb-here').count() === 1);
    await p.evaluate(() => window.__xk8.store.set({units: 'nm'}));
    await p.evaluate(() => document.querySelector('.fb-here').scrollIntoView());
    await p.waitForTimeout(100);
    check('the link is a 44 px target', (await p.locator('.fb-here').boundingBox()).height >= 44);
    await p.locator('.fb-here').click();
    await p.waitForSelector('.dlg-feedback');
    check('the form opens already about that step', /brake|step 3/i.test(await p.textContent('.fb-about')) && await p.isChecked('.fb-choice input[value=wrong]'), await p.textContent('.fb-about'));
    await p.fill('#fb-message', 'Torque looks wrong');
    await p.click('.fb-send');
    await p.waitForSelector('.fb-done');
    const stepMsg = net.posts[2];
    check('the step goes with it, in English', stepMsg?.aboutKind === 'step' && / > 3 > /.test(stepMsg.about) && stepMsg.page.includes('/job/brake-pads-front/3'), stepMsg?.about);
    await p.locator('.fb-done .fb-send').tap();
    await p.evaluate(() => window.__xk8.ui.select('brakes.caliper-front'));
    await p.waitForTimeout(350);
    check('a part panel offers the link too', await p.locator('.panel[data-mode=explore] .fb-here').count() === 1);
    await p.evaluate(() => document.querySelector('.fb-here').click());
    await p.waitForSelector('.dlg-feedback');
    await p.fill('#fb-message', 'Wrong number');
    await p.click('.fb-send');
    await p.waitForSelector('.fb-done');
    check('and the part goes with it', net.posts[3]?.aboutKind === 'part' && net.posts[3].about.includes('brakes.caliper-front'), net.posts[3]?.about);
    await p.locator('.fb-done .fb-send').tap();
    check('nothing left in the queue after good sends', await queue() === 0);

    // when it does not go
    const trySend = async (text) => {
      await p.locator('.fb-btn').tap();
      await p.locator('.fb-choice', {hasText: 'Something is wrong'}).tap();
      await p.fill('#fb-message', text);
      await p.click('.fb-send');
    };
    net.reply = () => answer(400, {ok: false, error: 'too_long'});
    await trySend('refused one');
    await p.waitForSelector('.fb-problem:not([hidden])');
    check('refused: says so and keeps the words on screen', /could not be sent/.test(await p.textContent('.fb-problem')) && await p.inputValue('#fb-message') === 'refused one' && await p.isEnabled('.fb-send') && await queue() === 0);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    if (await p.locator('.dlg-feedback').count()) await p.click('.dlg-close');

    net.reply = () => answer(500, {ok: false});
    await trySend('server down');
    await p.waitForSelector('.fb-done');
    check('server trouble: kept, and says so', /Saved for later/.test(await p.textContent('.fb-done')) && await queue() === 1, await p.textContent('.fb-done'));
    await p.locator('.fb-done .fb-send').tap();
    net.reply = () => answer(429, {ok: false, error: 'rate'});
    await trySend('too many');
    await p.waitForSelector('.fb-done');
    check('rate limited: kept, and says why', /Too many messages/.test(await p.textContent('.fb-done')) && await queue() === 2);
    await p.locator('.fb-done .fb-send').tap();
    net.reply = () => 'abort';
    await trySend('no route');
    await p.waitForSelector('.fb-done');
    check('a dropped connection: kept', /could not reach/.test(await p.textContent('.fb-done')) && await queue() === 3);
    await p.locator('.fb-done .fb-send').tap();

    const before = net.posts.length;
    await ctx.setOffline(true);
    await p.waitForFunction(() => navigator.onLine === false);
    await trySend('written offline');
    await p.waitForSelector('.fb-done');
    check('offline: kept, says offline, and tries nothing', /You are offline/.test(await p.textContent('.fb-done')) && await queue() === 4 && net.posts.length === before);
    await p.locator('.fb-done .fb-send').tap();
    net.reply = () => answer(200);
    await ctx.setOffline(false);
    await p.waitForFunction(() => !localStorage.getItem('xk8-feedback-queue'), null, {timeout: 8000});
    await p.waitForTimeout(100);
    const flushed = net.posts.slice(before).map((x) => x.message);
    check('back online, all four go, oldest first', flushed.join() === 'server down,too many,no route,written offline', flushed.join());
    check('and the person is told', /4 saved messages/.test(await p.textContent('.toast')), await p.textContent('.toast'));

    net.reply = () => answer(503);
    await trySend('wait for the next visit');
    await p.waitForSelector('.fb-done');
    net.reply = () => answer(200);
    await p.reload();
    await p.waitForFunction(() => window.__xk8);
    await p.waitForFunction(() => !localStorage.getItem('xk8-feedback-queue'), null, {timeout: 8000});
    check('a saved message goes the next time the page opens', net.posts[net.posts.length - 1].message === 'wait for the next visit');
    check('no exceptions, feedback', !p.errors.length, p.errors[0] ?? '');
    await ctx.close();
  }

  // keyboard, and French
  {
    const {p, ctx, net} = await fbPage(browser, {viewport: {width: 1280, height: 800}}, '#/plan?v=4.0-na-coupe-1999');
    check('the button has a name', await p.getAttribute('.fb-btn', 'aria-label') === 'Send feedback');
    await p.locator('.fb-btn').focus();
    await p.keyboard.press('Enter');
    await p.waitForSelector('.dlg-feedback');
    check('the keyboard lands on the first choice', await p.evaluate(() => document.activeElement.value) === 'wrong');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    check('Escape closes it and focus returns', await p.locator('.dlg-feedback').count() === 0 && await p.evaluate(() => document.activeElement.classList.contains('fb-btn')));
    await p.click('.seg-lang button:last-child');
    await p.waitForFunction(() => document.documentElement.lang === 'fr');
    check('the button follows the language', await p.getAttribute('.fb-btn', 'aria-label') === 'Envoyer un avis');
    await p.click('.fb-btn');
    await p.waitForSelector('.dlg-feedback');
    check('the form is in French', (await p.textContent('.dlg-title')) === 'Envoyer un avis' && (await p.textContent('.fb-send')) === 'Envoyer' && /adresse IP/.test(await p.textContent('.fb-note')) && await p.locator('.fb-choice', {hasText: 'Merci'}).count() === 1);
    await p.check('.fb-choice input[value=thanks]');
    await p.click('.fb-send');
    await p.waitForSelector('.fb-done');
    check('and the answer too', /bien parvenu/.test(await p.textContent('.fb-done')) && net.posts[0].kind === 'thanks');
    await ctx.close();
  }

  // the iPhone profile
  {
    const engine = await webkit.launch();
    const {p, ctx, net, queue} = await fbPage(engine, PHONE, '#/job/brake-pads-front/3?v=4.0-na-coupe-1999');
    const c = await clear(p);
    check('WebKit: the button is clear in a step', c.ok, c.detail);
    await p.evaluate(() => document.querySelector('.fb-here').scrollIntoView());
    await p.locator('.fb-here').tap();
    await p.waitForSelector('.dlg-feedback');
    check('WebKit: the form opens about the step', await p.isChecked('.fb-choice input[value=wrong]') && (await p.textContent('.fb-about')).length > 3);
    await p.fill('#fb-message', 'From WebKit');
    await p.tap('.fb-send');
    await p.waitForSelector('.fb-done');
    check('WebKit: it sends', net.posts[0]?.message === 'From WebKit' && net.posts[0].aboutKind === 'step', JSON.stringify(net.posts[0])?.slice(0, 120));
    await p.tap('.fb-done .fb-send');
    net.reply = () => 'abort';
    await p.locator('.fb-btn').tap();
    await p.locator('.fb-choice', {hasText: 'I have an idea'}).tap();
    await p.fill('#fb-message', 'Held in WebKit');
    await p.tap('.fb-send');
    await p.waitForSelector('.fb-done');
    check('WebKit: a failed send is kept', await queue() === 1);
    await ctx.close();
    await engine.close();
  }

  const sw = fs.readFileSync(path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'sw.js'), 'utf8');
  const rule = /\/(\^\\\/\(\?:api.*?)\/\.test\(u\.pathname\)/.exec(sw)?.[1];
  const leaves = new RegExp(rule);
  check('the service worker leaves /api and /inbox alone', !!rule && ['/api/feedback', '/inbox', '/inbox/', '/inbox/delete'].every((x) => leaves.test(x)) && !['/', '/fr.js', '/inboxes'].some((x) => leaves.test(x)), rule);
}

// ---- what a beginner test found ---------------------------------------------------------------
{
  const PHONE_DEV = {viewport: {width: 390, height: PHONE_H}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
  const CARQ = '?v=4.0-na-coupe-1999';
  {
    const p = await open({viewport: {width: 1280, height: 800}}, `#/explore${CARQ}`);
    await p.evaluate(() => window.__xk8.ui.openSearch());
    const row = async (q) => { await p.fill('.sb-input', q); await p.waitForTimeout(120); return p.evaluate(() => { const r = document.querySelector('.sr'); return r ? {kind: r.querySelector('.sr-kind').textContent, title: r.querySelector('.sr-title').textContent} : null; }); };
    check('asking what a word means gets the meaning first', (await row('bleed the brakes'))?.kind === 'What it means', JSON.stringify(await row('bleed the brakes')));
    check('filler words do not get in the way', (await row('what is a torque'))?.kind === 'What it means');
    await row('bleed the brakes');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.dlg-term');
    check('and it opens the plain meaning', /air/i.test(await p.textContent('.term-def')));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    await p.evaluate(() => window.__xk8.ui.openSearch());
    check('the first-screen intents can be typed', /Check a car/.test((await row('what to check when buying'))?.title) && /How the engine works/.test((await row('how engine works'))?.title), (await row('buying'))?.title);
    await row('how tight wheel nuts');
    check('how tight finds the figure', await p.evaluate(() => document.querySelector('.sr-value') !== null && /How tight/.test(document.querySelector('.sr-kind').textContent)));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    await p.evaluate(() => window.__xk8.store.set({mode: 'diagnose', selected: null}));
    await p.waitForSelector('.ws-said .ws-chip');
    check('What\'s wrong offers six plain symptoms', await p.locator('.ws-said .ws-chip').count() === 6);
    check('and the rescue job is on the first screen', /Flat battery/.test(await p.textContent('.ws-rescue')));
    const said = async (q) => { await p.fill('.ws-search', q); await p.waitForTimeout(150); return p.evaluate(() => [...document.querySelectorAll('.ws-results .ws-row strong')].slice(0, 6).map((x) => x.textContent)); };
    check('a whole sentence reaches the likely fault', /Restricted performance/.test((await said('warning light and feels slow'))[0]), (await said('warning light and feels slow')).join(' | '));
    check('sluggish and a yellow light do too', /Restricted performance/.test((await said('sluggish'))[0]) && /Restricted performance/.test((await said('yellow light on dash'))[0]));
    check('a flat battery finds the job', (await said('battery flat cant open boot')).some((x) => /Job: Flat battery/.test(x)), (await said('battery flat cant open boot')).join(' | '));
    check('nothing fitting gives the closest, not a dead end', (await said('rattle zzzzqq')).length > 0);
    await p.evaluate(() => window.__xk8.ui.open('fault', 'no-crank'));
    await p.waitForSelector('.ws-band');
    check('a car that will not start does not say Do not drive it', !/Do not drive it/.test(await p.textContent('.ws-band')) && /flat battery/i.test(await p.textContent('.ws-band')), await p.textContent('.ws-band'));
    await p.evaluate(() => window.__xk8.ui.open('fault', 'restricted-performance'));
    await p.waitForSelector('.ws-row strong:has-text("How to read the codes")');
    check('Read the codes leads to how', true);
    await p.context().close();
  }
  {
    const p = await open({viewport: {width: 1280, height: 800}}, `#/job/brake-pads-front/3${CARQ}&l=fr`);
    await p.waitForFunction(() => document.documentElement.lang === 'fr');
    await p.evaluate(() => window.__xk8.store.set({mode: 'diagnose', job: null}));
    await p.waitForSelector('.ws-said .ws-chip');
    await p.fill('.ws-search', 'manque de puissance');
    await p.waitForTimeout(150);
    check('in French the complaint reaches the fault too', /Restricted|performances limitées/i.test(await p.locator('.ws-results .ws-row strong').first().textContent()), await p.locator('.ws-results .ws-row strong').first().textContent());
    await p.evaluate(() => window.__xk8.store.set({mode: 'jobs', job: {id: 'oil-filter', step: null}}));
    await p.waitForSelector('.tut-why');
    check('a film\'s words are French on the French page', !/\b(?:the|with|and|on)\b/.test(await p.locator('.tut-why').first().textContent()), await p.locator('.tut-why').first().textContent());
    await p.context().close();
  }
  {
    const p = await open(PHONE_DEV, `#/job/brake-pads-front/1${CARQ}`);
    await p.waitForSelector('[data-fk=next]');
    await p.locator('[data-fk=next]').tap();
    await p.waitForTimeout(250);
    check('Next moves on and records nothing', await p.evaluate(() => { const s = window.__xk8.store.get(); return s.job.step === 1 && !(s.doneSteps['brake-pads-front'] ?? []).length; }));
    await p.locator('.ws-tick').tap();
    await p.waitForTimeout(150);
    check('the Done box records the step', await p.evaluate(() => (window.__xk8.store.get().doneSteps['brake-pads-front'] ?? []).length === 1));
    await p.evaluate(() => window.__xk8.store.set({job: {id: 'brake-pads-front', step: 5}}));
    await p.waitForTimeout(250);
    check('a step names its tool', /piston retract tool/i.test(await p.textContent('.ws-steptext')) && /Piston retract tool/.test(await p.textContent('.ws-step-tools')), await p.textContent('.ws-step-tools'));
    await p.evaluate(() => window.__xk8.store.set({job: {id: 'flat-battery', step: 1}}));
    await p.waitForTimeout(900);
    check('the boot stays shut until the step opens it', await p.evaluate(() => window.__xk8.sim.open.boot) < 0.05 && /badge/.test(await p.textContent('.ws-steptext')));
    await p.context().close();
  }
  {
    const p = await open(PHONE_DEV, `#/job/oil-filter/4${CARQ}`);
    await fakeYouTube(p.context());
    await p.waitForSelector('.tut-go');
    await p.waitForTimeout(500);
    await p.locator('.tut-go').tap();
    await p.waitForSelector('.tut-dock iframe');
    await p.waitForTimeout(700);
    const look = await p.evaluate(() => { const d = document.querySelector('.tut-dock').getBoundingClientRect(), s = document.querySelector('.ws-scroll').getBoundingClientRect(); return {over: document.querySelector('.tut-dock').parentElement.id, gap: Math.round(s.top - d.bottom), text: Math.round(s.height)}; });
    check('on a phone the film sits over the car, with the words under it', look.over === 'ui' && look.gap >= 0 && look.text >= 150, JSON.stringify(look));
    const was = await p.getAttribute('.tut-dock iframe', 'src');
    await p.locator('[data-fk=next]').tap();
    await p.waitForTimeout(350);
    check('Next takes the film to the new step', was !== await p.getAttribute('.tut-dock iframe', 'src'), await p.getAttribute('.tut-dock iframe', 'src'));
    await p.locator('.tut-close').tap();
    await p.waitForTimeout(500);
    check('closing gives the car back', await p.evaluate(() => !document.documentElement.classList.contains('film-over') && document.querySelector('.ws-scroll').getBoundingClientRect().top > 150));
    await p.context().close();
  }
  {
    const p = await open(PHONE_DEV);
    await p.locator('.choice[data-what=how]').tap();
    await p.waitForTimeout(1500);
    const how = await p.evaluate(() => { const s = window.__xk8.store.get(); const b = [...document.querySelectorAll('.run-watch button')].find((x) => x.textContent === 'Slowest').getBoundingClientRect(); return {section: s.sim.section, speed: s.sim.timeScale, on: document.querySelectorAll('.how-steps li.on').length, line: document.querySelector('.how-line').textContent, labels: [...document.querySelectorAll('.label')].map((x) => x.textContent).join('|'), sticky: getComputedStyle(document.querySelector('.dash')).position, reach: b.bottom <= document.querySelector('.modes').getBoundingClientRect().top}; });
    check('how it works opens on the cutaway, slowed down', how.section === 'cyl1' && how.speed === 0.02, JSON.stringify(how));
    check('with the stroke in words and the parts named', how.on === 1 && how.line.length > 20 && /Piston/.test(how.labels) && /Crankshaft/.test(how.labels), how.labels);
    check('and the speed in reach with the car still showing', how.sticky !== 'sticky' && how.reach);
    await p.context().close();
    const b = await open(PHONE_DEV);
    await b.locator('.choice[data-what=buy]').tap();
    await b.waitForTimeout(900);
    const n = await b.locator('.ws-check').count();
    check('buying opens the short list, at full height', n > 0 && n <= 11 && await b.evaluate(() => document.querySelector('.ws-tabbody').getBoundingClientRect().top < 200), n);
    await b.context().close();
  }
}

// ---- dark, the car's next service, hands-free ----------------------------------------------------------------------------------
{
  const dark = await open({viewport: {width: 1440, height: 900}, colorScheme: 'dark'}, '#/explore?v=4.0-na-coupe-1999');
  check('a device set to dark gets the dark page from the first frame', await dark.evaluate(() => document.documentElement.classList.contains('dark')));
  const ink = () => dark.evaluate(() => getComputedStyle(document.querySelector('.dock')).backgroundColor);
  const darkBg = await ink();
  await dark.click('.top-menu');
  await dark.click('dialog[open] .seg-wide button:text-is("Light")');
  await dark.keyboard.press('Escape');
  check('Light in Settings overrides the device', await dark.evaluate(() => !document.documentElement.classList.contains('dark') && window.__xk8.store.get().theme === 'light') && (await ink()) !== darkBg, `${darkBg} -> ${await ink()}`);
  await dark.evaluate(() => window.__xk8.store.set({theme: 'dark', garage: true}));
  check('large text stays black on white in dark', await dark.evaluate(() => getComputedStyle(document.querySelector('.dock')).backgroundColor === 'rgb(255, 255, 255)'));
  await dark.evaluate(() => window.__xk8.store.set({garage: false}));
  check('no page errors in dark', !dark.errors.length, dark.errors.join(' | '));
  await dark.context().close();

  const home = await open({viewport: {width: 1440, height: 900}}, '#/explore?v=4.0-na-coupe-1999');
  await home.evaluate(() => window.__xk8.store.set({linked: null, chosen: true}));
  await home.waitForTimeout(200);
  check('with no mileage the home asks for it', /Enter your mileage/.test(await home.textContent('.ex-due')));
  await home.evaluate(() => localStorage.setItem('xk8-workshop-plan', JSON.stringify({miles: 29400, lastMiles: 20100, lastDate: new Date(Date.now() - 300 * 864e5).toISOString().slice(0, 10)})));
  await home.reload();
  await home.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await home.waitForTimeout(300);
  const due = await home.textContent('.ex-due');
  check('with a mileage the home says which service and how far off', /30,000 mile service/.test(due) && /in 600 miles/.test(due) && /Due/.test(due), due);
  await home.click('.ex-due');
  await home.waitForTimeout(400);
  check('and it opens the service tab', (await S(home)).mode === 'plan' && /Service/.test(await home.textContent('.ws-tabs--plan [aria-selected=true]')));
  await home.context().close();

  const hf = await open({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2}, '#/explore?v=4.0-na-coupe-1999');
  await hf.evaluate(() => {
    window.__said = [];
    speechSynthesis.speak = (u) => { window.__said.push(u.text); u.onend?.(); };
    speechSynthesis.cancel = () => {};
    window.__xk8.store.set({linked: null, chosen: true, mode: 'jobs', job: {id: 'oil-filter', step: 3}, selected: null});
  });
  await hf.waitForTimeout(500);
  await hf.locator('.ws-handsfree').tap();
  await hf.waitForTimeout(200);
  const said = await hf.evaluate(() => window.__said);
  check('hands-free reads the step as it turns on', said.length === 1 && /^Drain\./.test(said[0]), said[0]?.slice(0, 60));
  check('and says what it can do', /Hands-free on/.test(await hf.textContent('.toast')));
  await hf.evaluate(() => window.__xk8.ui.handsFree.use && null);
  await hf.locator('.ws-big--go').tap();
  await hf.waitForTimeout(400);
  const next = await hf.evaluate(() => ({said: window.__said, step: window.__xk8.store.get().job.step, pressed: document.querySelector('.ws-handsfree').getAttribute('aria-pressed')}));
  check('the next step is read once when it opens, and hands-free stays on', next.step === 4 && next.said.length === 2 && next.pressed === 'true', JSON.stringify(next).slice(0, 160));
  check('units are spoken as words', !/\bNm\b/.test(next.said.join(' ')));
  await hf.evaluate(() => window.__xk8.store.set({job: null}));
  await hf.waitForTimeout(200);
  check('leaving the job turns hands-free off', await hf.evaluate(() => !window.__xk8.ui.handsFree.on));
  check('no page errors with hands-free', !hf.errors.length, hf.errors.join(' | '));
  await hf.context().close();
}

await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
