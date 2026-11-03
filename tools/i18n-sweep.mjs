#!/usr/bin/env node
// Drives the page in French through every mode, sample jobs, faults, part panels, plans, dialogs and print views, on a phone and
// a desktop. At each stop it walks the DOM text, aria-labels, placeholders and titles and reports anything still in English,
// with where it was found. Exits 1 if it finds any.
//
//   node tools/i18n-sweep.mjs                 the real French build in dist/
//   node tools/i18n-sweep.mjs --pseudo        builds a copy with every source string marked ‹like this›, and reports anything
//                                             on the page that did not come through the language system. Works before translation.
//   node tools/i18n-sweep.mjs --phone | --desktop   one viewport only
//   node tools/i18n-sweep.mjs --shots         screenshots under dist-shots/i18n-sweep/
//   node tools/i18n-sweep.mjs --layout        also reports words that run out of their control or panel, which longer French can do
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {ENGLISH} from './i18n-words.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const PSEUDO = args.has('--pseudo');
const SHOTS = path.join(ROOT, 'dist-shots/i18n-sweep');
const DIST = PSEUDO ? path.join(ROOT, 'dist-shots/i18n-pseudo') : path.join(ROOT, 'dist');
if (PSEUDO) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs')], {env: {...process.env, I18N_PSEUDO: '1', DIST_DIR: DIST}, encoding: 'utf8'});
  if (run.status !== 0) { console.error(run.stderr); process.exit(2); }
}
if (args.has('--shots')) fs.mkdirSync(SHOTS, {recursive: true});

// What may stay as it is. Numbers and codes pass by themselves.
const ALLOWED = /\b(?:Nm|lb|ft|mm|cc|mph|km|kg|Ah|in|m|s|h|L|F|R|N|x|EN|FR|XK8|XKR|VIN|OK|Jaguar|Cmd|Ctrl|K|Brembo|Sepang|MY|X100|bhp|deg|rpm|English|janv|févr|mars|avr|mai|juin|juil|août|sept|oct|nov|déc)\b|Français/g;
const CODE = /\S*\d\S*|\S+\.(?:com|co\.uk|org|net|de|nl|it|fr|ch)\S*/g;
// French words that are also English, and names that stay: a bottle's label, and dashboard messages (rule 7).
const ALSO_FRENCH = new Set(['code', 'codes', 'miles', 'car', 'part', 'parts', 'use', 'source', 'sources', 'drive', 'test']);
const NAMED = /Jaguar Anti-freeze, Coolant and Corrosion Inhibitor|Low Brake Fluid|Incorrect Part Fitted/g;
/** Why a string reads as untranslated, or null. */
function verdict(text) {
  if (PSEUDO) {
    let rest = text;
    for (let inner = rest; ; inner = rest) { rest = rest.replace(/‹[^‹›]*›/g, ' '); if (rest === inner) break; } // a sentence can hold another
    rest = rest.replace(CODE, ' ').replace(ALLOWED, ' ');
    if (/^‹|›$/.test(rest.trim())) return null; // a marked string the page split in two, as it does a long warning
    return /[A-Za-z]{2,}/.test(rest) ? 'not through t()' : null;
  }
  const words = text.replace(NAMED, ' ').replace(CODE, ' ').toLowerCase().split(/[^a-zà-ÿœ]+/).filter(Boolean);
  const hits = [...new Set(words.filter((w) => ENGLISH.has(w) && !ALSO_FRENCH.has(w)))];
  return hits.length >= (words.length <= 3 ? 1 : 2) ? `English words: ${hits.join(' ')}` : null;
}

// Runs in the page. Everything a person reads, or hears from a screen reader, with a short path to it.
const walkPage = () => {
  const app = window.__xk8;
  const keep = new Set();
  const addKeep = (x) => { if (x) keep.add(String(x).trim()); };
  const d = app.data;
  for (const v of d.vendors.items) addKeep(v.name);
  for (const v of d.variants.items) { addKeep(v.label); addKeep(v.transmission); addKeep(v.tyresFront); addKeep(v.tyresRear); addKeep(v.engineCode); }
  for (const p of d.parts.items) for (const n of p.partNumbers ?? []) addKeep(n.no);
  const skip = 'script, style, noscript, code, kbd, .prov-src, .ws-vendor, .tut-title, .tut-meta, .pn-no, .vin-input, #boot, [hidden]'; // a hidden panel repaints when it next shows
  const pathOf = (el) => { const bits = []; for (let e = el; e && e !== document.body && bits.length < 3; e = e.parentElement) bits.unshift(e.tagName.toLowerCase() + (e.classList[0] ? `.${e.classList[0]}` : '')); return bits.join(' > '); };
  const out = new Map();
  const add = (text, el, attr) => {
    const s = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!s || !/[A-Za-z]/.test(s) || keep.has(s) || out.has(s)) return;
    out.set(s, `${pathOf(el)}${attr ? ` @${attr}` : ''}`);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement.closest(skip)) add(n.data, n.parentElement);
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.prov-src, script, style, [hidden]')) continue;
    for (const attr of ['aria-label', 'placeholder', 'title', 'alt', 'aria-valuetext', 'data-short']) if (el.hasAttribute(attr) && !el.matches('.tut-thumb')) add(el.getAttribute(attr), el, attr); // a film's title stays as published, here as on the card
  }
  add(document.title, document.documentElement, 'title');
  add(document.querySelector('meta[name="description"]')?.content, document.documentElement, 'description');
  return [...out];
};

// Runs in the page. Controls whose words no longer fit, by what they stick out of.
const measurePage = () => {
  const out = [];
  const name = (e) => `${e.tagName.toLowerCase()}${e.classList[0] ? `.${e.classList[0]}` : ''}`;
  const shown = (e) => e.offsetWidth > 0 && getComputedStyle(e).visibility !== 'hidden';
  for (const box of document.querySelectorAll('.dock, .top, .modes, .views, dialog[open], .banner, .toast.on, .intro')) {
    if (!shown(box)) continue;
    const scrolls = (x) => /auto|scroll/.test(getComputedStyle(x).overflowX);
    const edge = box.getBoundingClientRect().right;
    for (const e of box.querySelectorAll('button, summary, select, a, label, dt, dd, h2, h3, h4, .ws-tag, .ws-urg, .ws-count')) {
      if (!shown(e) || e.closest('.vh, .ws-vh') || !e.textContent.trim()) continue;
      let inScroller = false;
      for (let p = e.parentElement; p && p !== box.parentElement; p = p.parentElement) if (scrolls(p) && p.scrollWidth > p.clientWidth && !p.matches('.dock, .panel, .ws-scroll, .dlg-body')) inScroller = true;
      if (inScroller) continue;
      const r = e.getBoundingClientRect();
      const clipped = e.scrollWidth > e.clientWidth + 3 && e.clientWidth > 0 && getComputedStyle(e).display !== 'inline' && !e.matches('.prov') && !e.querySelector('.prov'); // a badge's tap area overhangs it on purpose
      if (r.right > edge + 1 || clipped) out.push(`${name(box)} ${name(e)} ${r.right > edge + 1 ? `past the edge by ${Math.round(r.right - edge)} px` : `clipped by ${e.scrollWidth - e.clientWidth} px`}: ${e.textContent.trim().slice(0, 50)}`);
    }
  }
  return out;
};

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const findings = new Map();
const layout = new Map();
let visited = 0;

async function sweep(name, device) {
  const ctx = await browser.newContext({...device, permissions: ['clipboard-read', 'clipboard-write']});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', async (dlg) => { note(`confirm dialog, ${here}`, dlg.message(), 'dialog'); await dlg.accept(); });
  let here = 'boot';
  const note = (where, text, path2) => { const why = verdict(text); if (why && !findings.has(text)) findings.set(text, {where, path: path2, why, viewport: name}); };
  const look = async (where) => {
    here = where;
    visited++;
    await p.waitForTimeout(90);
    for (const [text, at] of await p.evaluate(walkPage)) note(where, text, at);
    if (args.has('--layout')) for (const line of await p.evaluate(measurePage)) if (!layout.has(line)) layout.set(line, `${name} | ${where}`);
    if (args.has('--shots')) await p.screenshot({path: path.join(SHOTS, `${name}-${String(visited).padStart(3, '0')}-${where.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`)});
  };
  const set = (patch) => p.evaluate((x) => window.__xk8.store.set(x), patch);
  const ui = (fn, ...a) => p.evaluate(([f, x]) => window.__xk8.ui[f](...x), [fn, a]);
  const closeDialogs = () => p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  const clickAll = (sel, max = 40) => p.evaluate(([s, m]) => { let n = 0; for (const b of document.querySelectorAll(s)) { if (n++ >= m) break; b.click(); } return n; }, [sel, max]);
  const openDetails = () => p.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  const printed = async (where) => { await p.evaluate(() => dispatchEvent(new Event('beforeprint'))); await look(`${where}, print`); await p.evaluate(() => { dispatchEvent(new Event('afterprint')); document.getElementById('ws-print')?.replaceChildren(); }); };
  const copied = async (where, sel) => {
    await p.click(sel);
    await p.waitForTimeout(120);
    const text = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    for (const line of text.split('\n')) note(`${where}, copied text`, line.trim(), 'clipboard');
  };

  await p.goto(`file://${path.join(DIST, 'index.html')}#/explore?v=4.0-na-coupe-1999&l=fr`);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  await p.evaluate(() => { window.__xk8noRun = true; });
  if (await p.evaluate(() => document.documentElement.lang) !== 'fr') { console.error('The page did not come up in French.'); process.exit(2); }
  await look('first screen');

  // ---- explore ----
  await p.evaluate(() => { document.querySelector('.ex-parts').open = true; document.getElementById('part-list')?.scrollIntoView(); });
  await set({chosen: true});
  await p.evaluate(() => { for (const b of document.querySelectorAll('.tree-head')) b.click(); });
  await look('explore, tree open');
  const parts = await p.evaluate(() => { const items = window.__xk8.data.parts.items; const pick = ['engine.head-bolts', 'brakes.caliper-front', 'engine.chain-tensioner-secondary', 'wheels.wheel-nut', 'engine.block', 'electrical.battery', 'cooling.water-pump']; return [...pick.filter((id) => window.__xk8.data.parts.byId.has(id)), ...items.filter((_, i) => i % 53 === 7).map((x) => x.id)]; });
  for (const id of parts) {
    await ui('select', id);
    await p.waitForTimeout(40);
    await openDetails();
    await look(`part ${id}`);
    if (id === parts[0]) await printed(`part ${id}`);
  }
  await p.locator('.ex-part .prov').first().click().catch(() => {});
  await p.waitForTimeout(120);
  await openDetails();
  await look('provenance dialog');
  await closeDialogs();
  await set({selected: null, isolate: null, view: 'hero'});

  // ---- run ----
  await set({mode: 'run'});
  await p.waitForTimeout(200);
  await p.evaluate(() => { for (const d of document.querySelectorAll('.panel[data-mode=run] details')) d.open = true; });
  await p.waitForTimeout(200);
  await look('run, coupe');
  await p.locator('.btn-start').click();
  await p.waitForTimeout(250);
  await look('run, engine on');
  await p.locator('.run-watch .run-btns button').nth(0).click();
  await p.waitForTimeout(300);
  await look('run, chains');
  await p.locator('.run-watch .run-btns button').nth(1).click();
  await p.waitForTimeout(300);
  await look('run, section');
  await p.locator('.run-watch .run-btns button').nth(1).click();
  await set({variant: {engine: '4.2', induction: 'sc', body: 'convertible', my: 2004, market: 'us'}});
  await p.waitForTimeout(250);
  await look('run, convertible');
  await set({variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}});

  // ---- jobs ----
  await set({mode: 'jobs', job: null});
  await look('jobs list');
  const jobs = await p.evaluate(() => window.__xk8.data.jobs.items.filter((j, i) => i % 7 === 0 || j.conf === 'community' || j.conf === 'single' || j.id === 'brake-pads-front').map((j) => j.id));
  for (const id of jobs) {
    await set({job: {id, step: null}});
    await p.waitForTimeout(40);
    await openDetails();
    await look(`job ${id}`);
    await set({job: {id, step: 0}});
    await openDetails();
    await look(`job ${id} step 1`);
    const n = await p.evaluate((x) => window.__xk8.jobStepsFor(x, window.__xk8.store.get().variant).length, id);
    await set({job: {id, step: n}});
    await look(`job ${id} final check`);
    if (id === jobs[0]) await printed(`job ${id}`);
  }
  await set({variant: {engine: '4.2', induction: 'sc', body: 'convertible', my: 2005, market: 'us', serial: 'A40000'}});
  await set({job: {id: jobs[1], step: null}});
  await openDetails();
  await look('job, 2005 US car');
  await set({variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}});
  await set({job: {id: 'nonesuch', step: null}});
  await look('job that does not exist');
  await set({job: null, selected: null, isolate: null});

  // ---- diagnose ----
  await set({mode: 'diagnose'});
  await look('diagnose home');
  for (const i of [1, 2, 0]) { await p.locator('.ws-tabs button').nth(i).click(); await look(`diagnose browse ${i}`); }
  for (const q of ['rattle', 'P0340', 'P9999', 'zzzzqq', 'brake']) {
    await p.fill('.ws-search', q);
    await p.waitForTimeout(80);
    await look(`diagnose search ${q}`);
  }
  await p.fill('.ws-search', '');
  const go = (page, id) => p.evaluate(([a, b]) => { const {ui} = window.__xk8; ui.open(a, b); }, [page, id]);
  const faults = await p.evaluate(() => window.__xk8.data.faults.items.filter((f, i) => i % 9 === 0 || f.urgency === 'stop').slice(0, 14).map((f) => f.id));
  for (const id of faults) {
    await go('fault', id);
    await p.waitForTimeout(40);
    await clickAll('.ws-cause-actions .ws-btn:not(.ws-btn--quiet)', 1);
    await p.waitForTimeout(30);
    await look(`fault ${id}`);
  }
  const codes = await p.evaluate(() => [...window.__xk8.data.dtc.byCode.keys()].filter((c, i) => i % 41 === 0 || window.__xk8.data.dtc.byCode.get(c).some((r) => r.band || r.first || r.causeOrder)).slice(0, 18));
  for (const c of codes) { await go('dtc', c); await p.waitForTimeout(30); await look(`code ${c}`); }
  await p.evaluate(() => window.__xk8.ui.open('fact', 'fact.towing'));
  await look('fact dialog');
  await closeDialogs();

  // ---- plan ----
  await set({mode: 'plan'});
  const tab = (k) => p.click(`[data-fk="tab-${k}"]`);
  await tab('service');
  await look('plan service, no mileage');
  await p.fill('[data-fk="svc-miles"]', '68000');
  await p.fill('[data-fk="svc-lastMiles"]', '41000');
  await p.fill('[data-fk="svc-date"]', '2022-05-01');
  await p.waitForTimeout(60);
  await openDetails();
  await look('plan service, overdue');
  await clickAll('.ws-svc-row .ws-chip[aria-pressed]', 2);
  await look('plan service, marked done');
  await p.fill('[data-fk="svc-miles"]', '241000');
  await p.fill('[data-fk="svc-lastMiles"]', '250000');
  await p.waitForTimeout(60);
  await look('plan service, past the sheets, odd entry');
  await p.fill('[data-fk="svc-miles"]', '68000');
  await p.fill('[data-fk="svc-lastMiles"]', '');
  await tab('inspect');
  await look('plan inspect');
  await clickAll('.ws-bad', 5);
  await clickAll('.ws-ok', 3);
  await p.waitForTimeout(80);
  await openDetails();
  await look('plan inspect, marked');
  await printed('inspection report');
  await copied('inspection report', '.ws-actions .ws-btn:nth-child(2)');
  await look('plan inspect, after copy');
  for (const i of [1, 2, 3, 0]) { await p.locator('.ws-tabs--small button').nth(i).click(); await p.waitForTimeout(40); await look(`plan inspect filter ${i}`); }
  await p.selectOption('.ws-filters select', 'new');
  await p.waitForTimeout(100);
  await look('plan inspect, candidate car');
  await p.locator('.ws-filters ~ .ws-btn--quiet').first().click({timeout: 1500}).catch(() => {}); // Delete this car: the confirm is noted
  await p.locator('.ws-actions .ws-btn--quiet').first().click({timeout: 1500}).catch(() => {}); // Clear: the same
  await tab('upgrades');
  await p.waitForTimeout(40);
  await openDetails();
  await look('plan upgrades');
  await p.locator('.ws-filters select').nth(1).selectOption('50');
  await p.waitForTimeout(60);
  await look('plan upgrades, budget');
  await p.locator('.ws-filters select').nth(1).selectOption('0');
  await clickAll('.ws-up .ws-btn', 2);
  await tab('list');
  await look('plan shopping, upgrades only');
  await p.evaluate((ids) => { const {store} = window.__xk8; store.set({list: [...store.get().list, ...ids.map((id) => ({kind: 'job', id})), {kind: 'part', id: 'engine.block'}]}); }, jobs.slice(0, 3));
  await p.waitForTimeout(100);
  await openDetails();
  await look('plan shopping, jobs and parts');
  await printed('shopping list');
  await copied('shopping list', '.ws-actions .ws-btn:nth-child(1)');
  await tab('tools');
  await openDetails();
  await look('plan tools');
  await tab('fluids');
  await openDetails();
  await look('plan fluids');
  await tab('torques');
  await p.waitForTimeout(60);
  await clickAll('.ws-tqrow > summary', 30);
  await p.waitForTimeout(100);
  await look('plan torques');
  await p.fill('input[data-fk="tqq"]', 'zzzzqq');
  await p.waitForTimeout(60);
  await look('plan torques, no match');
  await p.evaluate(() => window.__xk8.store.set({list: []}));
  await tab('list');
  await look('plan shopping, empty');

  // ---- search, car, settings, banner ----
  await set({mode: 'explore'});
  await ui('openSearch');
  await p.waitForSelector('.dlg-search');
  await look('search, empty');
  for (const q of ['tensioner', 'oil', 'P9999', 'zzzzqq']) { await p.fill('.sb-input', q); await p.waitForTimeout(80); await look(`search ${q}`); }
  await closeDialogs();
  await ui('openCar');
  await p.waitForSelector('.dlg-car');
  await openDetails();
  await look('car picker');
  for (const vin of ['SAJJGAED3AR015648', 'SAJ', 'SAJJGAED3AR999999', 'ABCDEFGHJKLMNPRST', 'A00001']) { await p.fill('.vin-input', vin); await p.waitForTimeout(60); await look(`car picker, VIN ${vin}`); }
  await p.locator('.go').click();
  await p.waitForTimeout(100);
  await look('after choosing a car');
  await p.evaluate(() => { location.hash = '#/explore?v=4.2-sc-convertible-2004&l=fr'; });
  await p.waitForTimeout(250);
  await look('someone else\'s car');
  await p.evaluate(() => { const {store} = window.__xk8; store.set({garage: true}); });
  await p.waitForTimeout(150);
  await look('garage mode');
  await set({garage: false});
  if (await p.locator('.top-menu').isVisible()) { await p.locator('.top-menu').click(); await p.waitForTimeout(80); await look('settings'); await closeDialogs(); }

  // ---- the switch itself: from English, with work in hand, the page must change whole and keep its place ----
  await p.evaluate(() => { localStorage.clear(); location.hash = '#/explore?v=4.0-na-coupe-1999'; });
  await p.goto('about:blank');
  await p.goto(`file://${path.join(DIST, 'index.html')}`);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  const held = () => p.evaluate(() => { const s = window.__xk8.store.get(); return JSON.stringify({m: s.mode, j: s.job, s: s.selected, r: s.sim.running, g: s.sim.gear, t: s.sim.timeScale}); });
  const flip = async (where) => {
    const before = await held();
    await p.click('.seg-lang button:last-child');
    await p.waitForFunction(() => document.documentElement.lang === 'fr');
    await p.waitForTimeout(160);
    await look(`switched to French on ${where}`);
    const after = await held();
    if (before !== after) note(`switched to French on ${where}`, `lost its place: ${before} became ${after}`, 'state');
    await p.click('.seg-lang button:first-child');
    await p.waitForFunction(() => document.documentElement.lang === 'en');
    await p.waitForTimeout(80);
  };
  await flip('the first screen');
  await set({chosen: true});
  await ui('select', 'brakes.caliper-front');
  await flip('a part');
  await set({selected: null, isolate: null, view: 'hero'});
  await p.waitForTimeout(100);
  await p.fill('.filter', 'caliper').catch(() => {});
  await flip('a filtered parts list');
  await set({mode: 'run'});
  await p.waitForTimeout(200);
  await p.locator('.run-watch .run-btns button').nth(0).click();
  await p.waitForTimeout(250);
  await flip('the running engine, chains showing');
  await set({mode: 'jobs', job: {id: jobs[1], step: 2}});
  await p.waitForTimeout(200);
  await flip('a job step');
  await set({job: null, mode: 'diagnose'});
  await p.waitForTimeout(100);
  await go('fault', faults[0]);
  await p.waitForTimeout(100);
  await flip('a fault');
  await set({mode: 'plan'});
  await p.waitForTimeout(100);
  await tab('inspect');
  await flip('the inspection list');
  await tab('torques');
  await flip('the torque list');
  await set({mode: 'explore'});
  await p.waitForTimeout(150);
  if (errors.length) console.log(`Page errors on ${name}:\n  ${[...new Set(errors)].join('\n  ')}`);
  await ctx.close();
  return errors.length;
}

const phone = {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true};
const desktop = {viewport: {width: 1440, height: 900}};
let errs = 0;
if (!args.has('--phone')) errs += await sweep('desktop', desktop);
if (!args.has('--desktop')) errs += await sweep('phone', phone);
await browser.close();

const rows = [...findings].map(([text, f]) => ({...f, text}));
for (const r of rows) console.log(`${r.viewport} | ${r.where} | ${r.path} | ${r.why}\n    ${r.text.slice(0, 160)}`);
for (const [line, at] of layout) console.log(`layout | ${at} | ${line}`);
console.log(`${visited} stops, ${rows.length} strings still in English, ${errs} page errors${args.has('--layout') ? `, ${layout.size} layout problems` : ''}.`);
process.exit(rows.length || errs || layout.size ? 1 : 0);
