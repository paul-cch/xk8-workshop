#!/usr/bin/env node
// Clipped text: on a phone (390x844) and a desktop, visits the first screen, every mode, a part, a job's overview and a step,
// and the search, car, settings and feedback dialogs, then flags any visible button, link, tab or label whose text does not
// fit its box. Exits 1 on any finding.
//   node tools/clip-check.mjs                  English and French
//   node tools/clip-check.mjs --lang en        one language
//
// Three kinds of finding:
//   clipped   an element with overflow hidden or clip is narrower than its text (scrollWidth > clientWidth + 1)
//   ellipsis  the same, cut with text-overflow: ellipsis where no one meant it (see ALLOWED)
//   spills    the text runs past the edge of its button, link, tab or label and over whatever is beside it
// Both "clipped" and "ellipsis" are confirmed against where the text is laid out, so an icon or a shadow does not count.
// Written after view buttons were cut off on a phone: a min-width rule beat flex's automatic minimum, and every test passed.
import {chromium} from 'playwright';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const LANGS = arg('lang', 'en,fr').split(',');
const page = `file://${path.join(process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist'), 'index.html')}`;
const VIEWPORTS = {
  phone: {viewport: {width: 390, height: 844}, deviceScaleFactor: 2, hasTouch: true, isMobile: true},
  desktop: {viewport: {width: 1440, height: 900}},
};
const CAR = {variant: {engine: '4.0', induction: 'na', body: 'coupe', my: 1999, market: 'uk'}, chosen: true};

// Where an ellipsis is the design. Each one only excuses a cut made with text-overflow: ellipsis, never a plain clip.
const ALLOWED = [
  '.car-btn b', '.car-btn span', // the car's name in the top bar: a long name gives way to the controls beside it
  '.sr-sub', // a search result's subtitle: one line under the title, the record itself has the rest
  '.ws-stephead .ws-back span:last-child', // the job's name in a step's back link, beside the step count
  '.hot-cap span', // the phone's caption under a part's hotspot: one line above the sheet
  '.banner-link .banner-short', // the shared-link banner keeps to one line on a phone
  '.label', // the 3D part labels, capped at 240 px so they do not cover the car
  '.search-btn span', // French: "Rechercher" gives way to the shortcut key in a narrow top bar
];

// Each state is a function run in the page. It may return a selector to click, for dialogs opened by a button.
const STATES = [
  ['explore', (x) => x.store.set({mode: 'explore', job: null, selected: null, isolate: null, view: 'hero'})],
  ['run', (x) => x.store.set({mode: 'run', job: null, selected: null, view: 'side'})],
  ['jobs', (x) => x.store.set({mode: 'jobs', job: null, selected: null, view: 'hero'})],
  ['diagnose', (x) => x.store.set({mode: 'diagnose', job: null, selected: null, view: 'hero'})],
  ['plan', (x) => x.store.set({mode: 'plan', job: null, selected: null, view: 'hero'})],
  ['part', (x) => { x.store.set({mode: 'explore', job: null, view: 'hero'}); x.ui.select('electrical.battery'); }],
  ['job-overview', (x) => x.store.set({mode: 'jobs', job: {id: 'brake-pads-front', step: null}, selected: null})],
  ['job-step', (x) => x.store.set({mode: 'jobs', job: {id: 'brake-pads-front', step: 1}, selected: null})],
  ['search', (x) => { x.store.set({mode: 'explore', job: null, selected: null, view: 'hero'}); x.ui.openSearch('oil'); }],
  ['car', (x) => x.ui.openCar()],
  ['settings', () => '.top-menu'],
  ['feedback', () => '.fb-btn'],
];

const measure = (allowed) => {
  const SEL = 'button, a[href], [role=button], [role=tab], [role=link], label, summary, .label';
  // Visible, and bigger than the 1 px box that hides text for screen readers only.
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    return el.checkVisibility({opacityProperty: true, visibilityProperty: true});
  };
  const clips = (el) => /^(hidden|clip)$/.test(getComputedStyle(el).overflowX);
  // Overflow does not apply to an inline box, which wraps its own text.
  const boxed = (el) => getComputedStyle(el).display !== 'inline';
  // How far the element's text reaches past its padding box, left and right, in px. Text inside a box of its own that clips
  // is left to that box's own check.
  const past = (el) => {
    const left = el.getBoundingClientRect().left + el.clientLeft, right = left + el.clientWidth;
    let over = 0;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || !shown(n.parentElement)) continue;
      let inner = false;
      for (let e = n.parentElement; e && e !== el; e = e.parentElement) if (clips(e)) { inner = true; break; }
      if (inner) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) over = Math.max(over, r.right - right, left - r.left);
    }
    return over;
  };
  const name = (el) => {
    const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
  };
  const where = (el) => { const out = []; for (let e = el; e && e !== document.body && out.length < 4; e = e.parentElement) out.unshift(name(e)); return out.join(' > '); };
  const out = [];
  const add = (kind, n, needs) => out.push({kind, where: where(n), text: n.textContent.trim().replace(/\s+/g, ' ').slice(0, 60), box: n.clientWidth, needs});
  const seen = new Set();
  for (const el of document.querySelectorAll(SEL)) {
    if (!shown(el) || !boxed(el) || !el.textContent.trim()) continue;
    if (!clips(el) && past(el) > 1) add('spills', el, Math.round(el.clientWidth + past(el)));
    for (const n of [el, ...el.querySelectorAll('*')]) { // the control and every box inside it
      if (seen.has(n) || !shown(n) || !boxed(n) || !n.textContent.trim()) continue;
      seen.add(n);
      if (!clips(n) || n.scrollWidth <= n.clientWidth + 1 || past(n) <= 1) continue;
      const ellipsis = getComputedStyle(n).textOverflow === 'ellipsis';
      if (ellipsis && allowed.some((s) => n.matches(s))) continue;
      add(ellipsis ? 'ellipsis' : 'clipped', n, n.scrollWidth);
    }
  }
  return out;
};

const browser = await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const found = new Map(); // one line per element and kind, with every state it showed in
let visits = 0, errors = 0;
const note = (label, list) => {
  for (const f of list) {
    const key = `${f.kind} ${f.where} "${f.text}"`;
    if (!found.has(key)) found.set(key, {...f, at: []});
    found.get(key).at.push(label);
  }
};
for (const [vp, device] of Object.entries(VIEWPORTS)) for (const lang of LANGS) {
  // The first screen, before a car is chosen.
  {
    const ctx = await browser.newContext(device);
    const p = await ctx.newPage();
    await p.goto(page);
    await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
    if (lang !== 'en') await p.evaluate((l) => window.__xk8.setLang(l), lang);
    await p.evaluate(() => window.__xk8.settle(350));
    note(`${vp} ${lang} first`, await p.evaluate(measure, ALLOWED));
    visits++;
    await ctx.close();
  }
  const ctx = await browser.newContext(device);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { errors++; console.log(`${vp} ${lang} pageerror: ${e.message}`); });
  await p.addInitScript((seed) => { if (!localStorage.getItem('xk8-workshop')) localStorage.setItem('xk8-workshop', seed); }, JSON.stringify(CAR));
  await p.goto(page);
  await p.waitForFunction(() => window.__xk8, null, {timeout: 120000});
  if (lang !== 'en') await p.evaluate((l) => window.__xk8.setLang(l), lang);
  for (const [state, fn] of STATES) {
    const click = await p.evaluate(`(${fn})(window.__xk8)`);
    if (click) await p.locator(click).first().click();
    await p.evaluate(() => window.__xk8.settle(350));
    await p.waitForTimeout(250); // dialogs and the sheet animate in
    note(`${vp} ${lang} ${state}`, await p.evaluate(measure, ALLOWED));
    visits++;
    await p.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  }
  await ctx.close();
}
await browser.close();

for (const [key, f] of found) {
  const on = new Map(); // "phone en" -> its states
  for (const at of f.at) { const [vp, lang, state] = at.split(' '); on.set(`${vp} ${lang}`, [...(on.get(`${vp} ${lang}`) ?? []), state]); }
  console.log(`${key}  ${f.box}px box, text needs ${f.needs}px`);
  for (const [k, states] of on) console.log(`    ${k}: ${states.length === STATES.length + 1 ? 'every screen' : states.join(', ')}`);
}
console.log(`${visits} screens, ${found.size} clipped texts${errors ? `, ${errors} page errors` : ''}`);
process.exit(found.size || errors ? 1 : 0);
