// The application frame: top bar, mode bar, the content dock (a rail on wide screens, a three-height sheet on phones),
// camera views, the first screen, idle orbit with handback, garage mode, global keys, and app.ui, which every panel uses
// to move between records. Panels own what is inside the dock. What the dock covers is reported to the stage.
import * as THREE from 'three';
import {data, partName} from '../data.js';
import {N, STAGE_LABEL, t} from '../i18n.js';
import {MODES} from '../state.js';
import * as explore from './explore.js';
import * as run from './run.js';
import * as jobs from './jobs.js';
import * as diagnose from './diagnose.js';
import * as plan from './plan.js';
import * as feedback from './feedback.js';
import {nav} from './jobs.js';
import {openPicker} from './picker.js';
import {openSearch, recordBody} from './search.js';
import {explain} from './terms.js';
import {showBasics} from './tutorials.js';
import {badge, carName, carTag, carYear, dialog, fill, h, lessons, proneTo, seg, toast} from './widgets.js';

const PANELS = {explore, run, jobs, diagnose, plan};
const KEEP = new Set(['explore', 'run']); // these hold their own state across visits; the others mount on each visit
const TITLES = {explore: N('The car'), run: N('Run it'), jobs: N('Fix it'), diagnose: N('What\'s wrong'), plan: N('Upkeep')};
const VIEWS = [['hero', N('Whole car')], ['side', N('Side')], ['front', N('Front')], ['rear', N('Rear')], ['top', N('Top')], ['underside', N('Under')], ['engine-bay', N('Engine bay')], ['boot', N('Boot')], ['wheel-fr', N('Wheel')]];
const SNAP_WORD = {peek: N('peek'), half: N('half'), full: N('full')};
const SKINS = new Set(['body', 'roof', 'interior']);
const RAIL = '(min-width: 1000px), (orientation: landscape) and (min-width: 640px)';
const HINT_S = 12; // how long the first-visit hint stays if nobody touches it
const APART_MS = 1500; // the car coming apart, from a button: the slider follows the finger instead
const IDLE_S = 25; // quiet time before the car starts turning again: the teardown handback
const ORBIT_DEG_S = 7;
const ORBIT_MAX_S = 240; // then rest, so a forgotten phone does not cook
const HOT_SPOTS = 3, HOT_MAX_M = 1.2, HOT_MIN_Y = 0.45; // below that height a part is under the car: a pin on the door would point at nothing there
const SNAPS = ['peek', 'half', 'full'];
const SHEET_MS = 360; // the sheet's move, and a little over
const SEE_IT_M = 2.5; // far enough that the car around a buried part still reads as a car
const STRIP_SHARE = 0.25, STRIP_MIN = 120; // in a step on a phone the text comes first and the car keeps this much of the screen
const VIEW_ROW = 50; // the camera buttons above the sheet: the car is framed clear of them
const SHORT_H = 520; // a phone on its side, as in the max-height rule in style.css
const CAPTION_ROW = 40; // the first screen's weak spot line, in the same place
const HERO_FILL = {rail: 0.98, sheet: 1}; // a phone is narrow: the car takes the width, not 84 percent of it
const GEAR = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const TYPED = '.ws-search, .filter, .ws-field input'; // the keyboard covers the half sheet, so typing raises it

// ---- the bottom sheet ----------------------------------------------------------------------------

function createSheet(dock, grip, body, {onSnap}) {
  const sheet = {h: 0, snap: 'peek', full: 400, half: 300, peek: 120};
  let drag = null;

  const place = (h2, animate) => {
    sheet.h = h2;
    dock.classList.toggle('moving', !!animate);
    dock.style.transform = `translate3d(0, ${(sheet.full - h2).toFixed(1)}px, 0)`;
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(h2)}px`);
  };
  const fitBody = () => { body.style.height = `${Math.max(60, sheet.h - grip.offsetHeight)}px`; };

  sheet.say = () => grip.setAttribute('aria-label', sheet.moved ? t('Panel height: {name}. Press to change.', {name: t(SNAP_WORD[sheet.snap])}) : t('Panel height'));
  sheet.measure = (bar, top, peek, strip = null) => {
    const avail = window.innerHeight - bar;
    sheet.full = Math.round(avail - top - 4);
    sheet.half = strip != null ? sheet.full - Math.round(strip) : Math.round(Math.min(sheet.full, avail * 0.5));
    sheet.peek = Math.min(peek, sheet.half);
    dock.style.height = `${sheet.full}px`;
    place(sheet[sheet.snap], false);
    fitBody();
  };
  sheet.to = (name) => {
    sheet.snap = name;
    sheet.moved = true;
    sheet.say();
    const next = sheet[name];
    place(next, true);
    if (next > sheet.h) fitBody();
    onSnap(name);
    setTimeout(fitBody, 340);
  };

  const release = (v, lastT) => {
    const speed = performance.now() - lastT > 90 ? 0 : v * 170; // a finger that stopped before lifting has no flick left
    const aim = sheet.h + speed;
    const best = SNAPS.reduce((a, b) => (Math.abs(sheet[b] - aim) < Math.abs(sheet[a] - aim) ? b : a));
    sheet.to(best);
  };

  const begin = (y) => { drag = {y, h: sheet.h, lastY: y, lastT: performance.now(), v: 0, moved: false}; body.style.height = `${sheet.full - grip.offsetHeight}px`; };
  const move = (y) => {
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.v = 0.7 * ((drag.lastY - y) / dt) + 0.3 * drag.v;
    drag.lastY = y;
    drag.lastT = now;
    if (Math.abs(y - drag.y) > 5) drag.moved = true;
    place(Math.max(sheet.peek * 0.8, Math.min(sheet.full, drag.h + drag.y - y)), false);
  };

  grip.addEventListener('pointerdown', (e) => { grip.setPointerCapture(e.pointerId); begin(e.clientY); });
  grip.addEventListener('pointermove', (e) => { if (drag) move(e.clientY); });
  const up = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) release(d.v, d.lastT);
    else sheet.to(SNAPS[(SNAPS.indexOf(sheet.snap) + 1) % SNAPS.length]);
  };
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
  grip.addEventListener('keydown', (e) => {
    const i = SNAPS.indexOf(sheet.snap);
    if (e.key === 'ArrowUp') { e.preventDefault(); sheet.to(SNAPS[Math.min(2, i + 1)]); }
    if (e.key === 'ArrowDown') { e.preventDefault(); sheet.to(SNAPS[Math.max(0, i - 1)]); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.to(SNAPS[(i + 1) % 3]); }
  });

  // Pulling down on a list already at its top lowers the sheet, as a greasy thumb expects. Sliders are left alone.
  let pull = null;
  body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input[type=range]') || !dock.classList.contains('is-sheet')) { pull = null; return; }
    pull = {y: e.touches[0].clientY, scroller: e.target.closest('.ws-scroll') ?? e.target.closest('.panel'), on: false};
  }, {passive: true});
  body.addEventListener('touchmove', (e) => {
    if (!pull) return;
    const y = e.touches[0].clientY, dy = y - pull.y;
    if (!pull.on) {
      if (Math.abs(dy) < 8) return;
      if (dy < 0 || (pull.scroller?.scrollTop ?? 0) > 0 || sheet.snap === 'peek') { pull = null; return; }
      pull.on = true;
      begin(y);
    }
    if (e.cancelable) e.preventDefault();
    move(y);
  }, {passive: false});
  body.addEventListener('touchend', () => {
    if (pull?.on && drag) { const d = drag; drag = null; release(d.v, d.lastT); }
    pull = null;
  });
  return sheet;
}

// ---- the first screen ----------------------------------------------------------------------------

function firstScreen(app) {
  const years = data.variants.items;
  const from = Math.min(...years.map((r) => r.myFrom)), to = Math.max(...years.map((r) => r.myTo));
  const el = h('div.intro');
  /** The words follow the language. The four choices are the first thing in the panel: explore.js draws them. */
  el.paint = () => {
    el.replaceChildren(
      h('p.intro-kick', t('Jaguar XK8 and XKR, {from} to {to}', {from, to})),
      h('p.intro-title', t('XK8 Workshop')),
      h('p.intro-lead', t('A working 3D car, with plain help for owners.')),
    );
  };
  return el;
}

export function mount(el, app) {
  const {store, stage, rig, registry} = app;
  const root = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const wide = matchMedia(RAIL);
  // Automated screenshots must hold still: every other builder's shots read a settled frame.
  const automated = navigator.webdriver && !location.search.includes('orbit');

  // ---- what panels call ------------------------------------------------------------------------
  let apartFrame = 0;
  const say = (notice) => toast(typeof notice === 'function' ? notice() : notice);
  const ui = {
    autoXray: false, focusTorque: null, focusWeak: null, lookupFrom: null,
    /** Select a part from a list: go to Explore, make it visible, fly to it. A job in hand is kept: the banner goes back to it. */
    select(id, {fly = true} = {}) {
      const s = store.get();
      const p = data.parts.byId.get(id);
      const r = registry.resolve(id);
      if (s.mode === 'jobs' && s.job) ui.lookupFrom = s.job;
      const inside = p && !SKINS.has(p.system);
      const patch = {mode: 'explore', job: null, selected: id};
      if (fly) patch.view = null;
      // Most parts live behind others. The car stays solid so you can see where the part is, with a sightline cut to it.
      if (inside && fly && r.id) Object.assign(patch, {locate: true, isolate: null, xray: false});
      ui.autoXray = false;
      zoomed = false;
      store.set(patch);
      if (fly && store.get().view) store.set({view: null}); // leaving a job hands the camera back to the whole car: this flight takes it
      if (fly && r.id) { if (inside) showWhere(r.id); else rig.flyToPart(r.id); }
    },
    /** How it works: straight to the engine cut open and slowed down, with the four strokes in words. */
    watch() {
      store.set({mode: 'run', selected: null});
      ui.showHow?.(true);
      if (!rail) sheet.to('peek');
    },
    /** The running engine, with the whole car around it. */
    startEngine() {
      store.set({mode: 'run', selected: null});
      if (!rail) sheet.to('peek');
    },
    /** The four ways in: what has gone wrong, a job to do, how it works, a car to buy. */
    begin(what) {
      if (what === 'how') { ui.watch(); return; }
      ui.lookupFrom = null;
      if (what === 'wrong') { nav.diagnoseHome = true; goto('diagnose'); }
      if (what === 'fix') store.set({mode: 'jobs', job: null, selected: null, isolate: null});
      if (what === 'buy') { nav.planTab = 'inspect'; nav.planBuy = true; goto('plan'); if (!rail) sheet.to('full'); } // a list to read: it gets the screen
    },
    /** One of the basics, opened in Fix it. */
    lesson(id) {
      showBasics(id);
      ui.lookupFrom = null;
      store.set({mode: 'jobs', job: null, selected: null, isolate: null});
      show('jobs');
      lift('full');
      requestAnimationFrame(() => panelEl.jobs.querySelector('.tut-topics')?.scrollIntoView({block: 'start'}));
    },
    /** The car coming apart or going back, with the slider following. Reduced motion jumps. */
    takeApart(on) {
      cancelAnimationFrame(apartFrame);
      const to = on ? 1 : 0, from = store.get().explode;
      if (store.get().mode !== 'explore' || store.get().selected) store.set({mode: 'explore', selected: null});
      if (on) { dismiss(); store.set({view: null}); store.set({view: 'hero'}); }
      if (calm.matches) { store.set({explode: to}); return; }
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / APART_MS);
        store.set({explode: from + (to - from) * (k * k * (3 - 2 * k))});
        if (k < 1) apartFrame = requestAnimationFrame(step);
      };
      apartFrame = requestAnimationFrame(step);
    },
    /** Brings a block to the top of the panel once the sheet has stopped moving, so nothing is cut off and no stage is above it. */
    reveal(node) {
      const panel = node.closest('.panel');
      const go = () => panel.scrollTo(0, node.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - 8);
      if (rail) { requestAnimationFrame(go); return; }
      lift('half');
      setTimeout(() => {
        if (node.offsetHeight > panel.clientHeight - 16) { lift('full'); setTimeout(go, SHEET_MS); } else go();
      }, SHEET_MS);
    },
    /** A panel changed what shows at the sheet's lowest height. */
    sheetChanged() { if (rail === false) sheetFor(); report(); },
    /** Showing a part from a full sheet would move the car behind it. */
    lower() { if (rail === false && sheet.snap === 'full' && !stepOn) sheet.to('half'); },
    /** A film goes over the car on a phone, and the sheet sits under it. False where there is no room for that. */
    filmOver(node) {
      if (rail !== false) return false;
      film = node;
      node.classList.add('tut-over');
      el.append(node);
      root.classList.add('film-over');
      sheetFor();
      sheet.to('full');
      return true;
    },
    /** Asks for more of the screen. Never lowers the sheet. */
    raise(to) { lift(to); },
    /** The film has gone. */
    film() {
      if (!film) return;
      film = null;
      root.classList.remove('film-over');
      if (rail === false) { sheetFor(); sheet.to(stepOn && !store.get().garage ? 'half' : stepOn ? 'full' : sheet.snap); }
    },
    /** Go to any record. kind is a search kind: term page part job fault dtc torque fluid weakspot upgrade inspect tool service vendor. */
    open(kind, id) {
      if (kind === 'term') return explain(data.terms.byId.get(id));
      if (kind === 'page') {
        if (id.startsWith('basics:')) return ui.lesson(id.slice('basics:'.length));
        if (id === 'apart') return ui.takeApart(true);
        if (id === 'service') { nav.planTab = 'service'; return goto('plan'); }
        return ui.begin(id);
      }
      if (kind === 'part') return ui.select(id);
      if (kind === 'job') { ui.lookupFrom = null; return store.set({mode: 'jobs', job: {id, step: null}, selected: null, isolate: null}); }
      if (kind === 'fault' || kind === 'dtc') { nav.diagnose = {page: kind === 'dtc' ? 'code' : 'fault', id}; return goto('diagnose'); }
      if (kind === 'upgrade' || kind === 'service' || kind === 'inspect') { nav.planTab = {upgrade: 'upgrades', service: 'service', inspect: 'inspect'}[kind]; nav.planItem = {kind, id}; return goto('plan'); }
      if (kind === 'torque') {
        const t = data.torques.byId.get(id);
        const part = t?.parts?.find((p) => data.parts.byId.has(p));
        if (part) { ui.focusTorque = id; return ui.select(part); }
      }
      if (kind === 'weakspot') {
        const w = data.weakspots.byId.get(id);
        const part = w?.parts?.find((p) => data.parts.byId.has(p));
        if (part) { ui.focusWeak = id; return ui.select(part); }
        nav.diagnose = {page: 'weak', id};
        return goto('diagnose');
      }
      const rec = data[{torque: 'torques', fluid: 'fluids', tool: 'tools', vendor: 'vendors', weakspot: 'weakspots', fact: 'facts'}[kind]]?.byId.get(id);
      if (rec) dialog({title: rec.title ?? rec.name ?? rec.label ?? id, body: recordBody(kind, rec, badge)});
      return undefined;
    },
    openCar: () => openPicker(app),
    openSearch: (q) => openSearch(app, q),
    toast,
  };
  app.ui = ui;
  lessons.open = ui.lesson;

  // ---- frame ----------------------------------------------------------------------------------
  const modes = h('nav.modes');
  const modeBtn = {};
  for (const m of MODES) {
    modeBtn[m] = h('button.mode', {type: 'button', dataset: {mode: m}, onclick: () => {
      const now = store.get();
      if (now.mode === m && m === 'jobs' && now.job) store.set({job: null});
      else if (m === 'jobs' && ui.lookupFrom) backToJob();
      else store.set({mode: m});
    }});
    modes.append(modeBtn[m]);
  }
  const searchMode = h('button.mode.mode-search', {type: 'button', onclick: () => ui.openSearch()});
  modes.append(searchMode);

  const brandName = h('span.brand-name');
  const brand = h('button.brand', {type: 'button', onclick: () => { store.set({mode: 'explore', selected: null, view: 'hero'}); }}, brandName);
  const searchWords = h('span');
  const searchBtn = h('button.search-btn', {type: 'button', onclick: () => ui.openSearch()}, [searchWords, h('kbd', /Mac|iP/.test(navigator.platform) ? 'Cmd K' : 'Ctrl K')]);
  const carBtn = h('button.car-btn', {type: 'button', onclick: () => ui.openCar()});
  // Each language names itself, so a reader who cannot read the page can still find their own.
  const langs = seg({options: [{value: 'en', label: 'EN', aria: 'English'}, {value: 'fr', label: 'FR', aria: 'Français'}], value: store.get().lang, onChange: async (v) => { await app.setLang(v); langs.set(store.get().lang); }, className: 'seg-lang'});
  const spacer = h('div.top-space');
  // Units and large text are set once and left: one quiet button holds them, on every screen.
  const menuBtn = h('button.toggle.top-menu', {type: 'button', onclick: () => {
    const d = dialog({title: t('Settings'), body: [
      h('h3.lab', t('Appearance')),
      seg({label: t('Appearance'), options: [{value: 'auto', label: t('Auto|appearance')}, {value: 'light', label: t('Light|appearance')}, {value: 'dark', label: t('Dark|appearance')}], value: store.get().theme, onChange: (v) => store.set({theme: v}), className: 'seg-wide'}),
      h('h3.lab', t('Tightening units')),
      seg({label: t('Tightening units'), options: [{value: 'nm', label: 'Nm'}, {value: 'lbft', label: 'lb ft'}], value: store.get().units, onChange: (v) => store.set({units: v}), className: 'seg-wide'}),
      h('h3.lab', t('Large text')),
      h('button.btn.menu-garage', {type: 'button', onclick: () => { store.set({garage: !store.get().garage}); d.close(); }}, store.get().garage ? t('Turn large text off') : t('Turn large text on')),
    ]});
  }});
  const heading = h('h1.vh');
  menuBtn.innerHTML = GEAR;
  const top = h('header.top', [heading, brand, spacer, searchBtn, carBtn, langs, menuBtn]);

  const dockTitle = h('span.dock-title');
  const grip = h('button.dock-grip', {type: 'button'}, [h('i.grip-bar'), dockTitle]);
  const dockBody = h('div.dock-body', {role: 'main'});
  const dock = h('aside.dock', [grip, dockBody]);

  const viewBar = h('div.views', {role: 'group'});
  const viewBtn = {};
  for (const [name] of VIEWS) {
    viewBtn[name] = h('button.view', {type: 'button', onclick: () => { dismiss(); store.set({view: null}); store.set({view: name}); }});
    viewBar.append(viewBtn[name]);
  }
  const orbitBtn = h('button.view.view-orbit', {type: 'button', 'aria-pressed': 'false', onclick: () => {
    if (orbiting) { userOff = true; setOrbit(false); } else { userOff = false; asleep = false; setOrbit(true); }
  }});
  viewBar.append(orbitBtn);

  const skip = h('button.skip', {type: 'button', onclick: () => { store.set({mode: 'explore', selected: null}); requestAnimationFrame(() => { const list = document.getElementById('part-list'); const fold = list?.closest('details'); if (fold) fold.open = true; list?.querySelector('button')?.focus(); }); }});
  const live = h('div.vh', {'aria-live': 'polite'});
  const picked = h('div.picked', {hidden: true});
  const banner = h('div.banner', {hidden: true, role: 'status'});
  const partBar = h('div.part-bar', {hidden: true});
  // In a step the car is a strip above the text. This hands it the screen and takes it back.
  const stripBtn = h('button.strip-btn', {type: 'button', hidden: true, onclick: () => { sheet.to(sheet.snap === 'peek' ? (store.get().garage ? 'full' : 'half') : 'peek'); paintStrip(); }});
  const paintStrip = () => { stripBtn.textContent = sheet.snap === 'peek' ? t('Back to the text') : t('See the car'); };
  let introOn = !store.get().chosen && !app.noGL;
  let introEl = firstScreen(app);
  const hots = h('div.hots');
  const hint = h('div.move-hint', {hidden: true, role: 'status'});
  viewBar.prepend(partBar);
  el.replaceChildren(skip, top, dock, viewBar, introEl, hots, hint, picked, banner, stripBtn, live);
  feedback.mount(app, {top, before: menuBtn, dock: dockBody});
  introEl.paint(store.get().variant);

  // ---- panels ---------------------------------------------------------------------------------
  const panelEl = {};
  const stops = {};
  let current = null;
  for (const m of MODES) {
    panelEl[m] = h('section.panel', {hidden: true, dataset: {mode: m}});
    dockBody.append(panelEl[m]);
  }
  /** Every fixed word in the frame. Runs once at the start and again on a change of language. */
  function paintWords() {
    modes.setAttribute('aria-label', t('Modes'));
    for (const m of MODES) { modeBtn[m].textContent = t(TITLES[m]); panelEl[m].setAttribute('aria-label', t(TITLES[m])); }
    searchMode.textContent = t('Search');
    heading.textContent = brandName.textContent = t('XK8 Workshop');
    brand.title = t('Back to the whole car');
    searchWords.textContent = t('Search everything');
    searchWords.dataset.short = t('Find'); // the narrow top bar shows this one
    carBtn.setAttribute('aria-label', t('Your car. Change it'));
    langs.setAttribute('aria-label', t('Language'));
    menuBtn.setAttribute('aria-label', t('Settings'));
    menuBtn.title = t('Settings');
    dock.setAttribute('aria-label', t('Panel'));
    viewBar.setAttribute('aria-label', t('Camera views'));
    for (const [name, label] of VIEWS) viewBtn[name].textContent = t(label);
    orbitBtn.textContent = t('Spin');
    skip.textContent = t('Skip to the parts list');
    hots.setAttribute('aria-label', t('Start with what this car is known for'));
    paintHint();
    stage.renderer.domElement.setAttribute('aria-label', t(STAGE_LABEL));
    sheet?.say();
  }
  function show(m) {
    if (current && !KEEP.has(current)) { stops[current]?.(); stops[current] = null; panelEl[current].replaceChildren(); }
    current = m;
    for (const k of MODES) panelEl[k].hidden = k !== m;
    if (KEEP.has(m)) {
      if (!stops[m]) stops[m] = PANELS[m].mount(panelEl[m], app) ?? true;
    } else stops[m] = PANELS[m].mount(panelEl[m], app) ?? null;
    panelEl[m].scrollTo?.(0, 0);
  }
  /** Change mode, or remount the current one so a nav request from search lands even if it is already open. */
  function goto(m) {
    if (store.get().mode === m) show(m);
    else store.set({mode: m, selected: null});
  }

  // ---- layout ---------------------------------------------------------------------------------
  let sheet = null;
  let rail = null;
  let stepOn = false;
  let zoomed = false;
  let film = null; // the player, while it sits over the car
  const overlay = () => el.querySelector('.chain-tag:not([hidden])')?.offsetHeight ?? 0; // the chain caption sits above the car, not on it
  const report = () => {
    const isRail = rail;
    const above = top.offsetHeight + (banner.hidden ? 0 : banner.offsetHeight);
    document.documentElement.style.setProperty('--banner-h', `${banner.hidden ? 0 : banner.offsetHeight}px`);
    if (isRail) {
      const low = introOn && introEl && window.innerHeight < SHORT_H ? introEl.offsetHeight + 8 : 0; // no room beside the car: the heading goes above it
      stage.setInsets({top: above + overlay() + low, right: dock.offsetWidth, bottom: 0, left: 0});
      return;
    }
    // On a phone the heading sits above the car, not on it, and the camera buttons sit below it.
    const intro = introOn && introEl ? introEl.offsetHeight + 12 : 0;
    const row = introOn ? (el.querySelector('.hot-cap')?.offsetHeight ? CAPTION_ROW : 0) : stepOn || store.get().garage || root.classList.contains('run-how') ? 0 : VIEW_ROW;
    stage.setInsets({top: above + intro + overlay(), right: 0, bottom: Math.min(sheet.h, sheet.half) + modes.offsetHeight + row, left: 0});
  };
  const sheetFor = () => {
    const panel = panelEl[store.get().mode];
    const node = [...panel.querySelectorAll('[data-peek]')].find((n) => n.offsetHeight > 0);
    const reach = !node ? 84 : node.closest('.ws') ? node.offsetHeight : node.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + panel.scrollTop;
    const strip = stepOn && !film ? Math.max(STRIP_MIN, window.innerHeight * STRIP_SHARE) : null;
    sheet.measure(modes.offsetHeight, top.offsetHeight + (banner.hidden ? 0 : banner.offsetHeight) + (film?.offsetHeight ?? 0), reach + grip.offsetHeight + 1, strip);
  };
  /** In a step on a phone the text comes first: no mode bar, no camera buttons, and the car a strip that opens on request. */
  function paintStep(s) {
    const open = s.mode === 'jobs' && s.job?.step != null;
    root.classList.toggle('job-step', open);
    const on = rail === false && open;
    dockTitle.textContent = on && s.garage ? t('See the car') : t(TITLES[s.mode]); // a full sheet in garage mode leaves no room for the strip's button
    if (on === stepOn) return;
    stepOn = on;
    root.classList.toggle('in-step', on);
    stripBtn.hidden = !on;
    if (rail === false) sheetFor(); // runs after layout() has cleared the sheet's transform: in rail mode it would write it back
    if (on) { sheet.to(s.garage ? 'full' : 'half'); paintStrip(); } else if (rail === false) sheet.to('half');
  }
  function layout() {
    const next = wide.matches;
    if (next !== rail) {
      rail = next;
      dock.classList.toggle('is-sheet', !rail);
      root.classList.toggle('layout-rail', rail);
      root.classList.toggle('layout-sheet', !rail);
      rig.views.hero.fill = rail ? HERO_FILL.rail : HERO_FILL.sheet;
      if (rail) { top.insertBefore(modes, spacer); dock.style.height = ''; dock.style.transform = ''; dockBody.style.height = ''; grip.tabIndex = -1; } else { el.insertBefore(modes, dock.nextSibling); grip.tabIndex = 0; }
    }
    paintStep(store.get());
    if (!rail) sheetFor();
    report();
  }
  sheet = createSheet(dock, grip, dockBody, {onSnap: (name) => {
    report();
    if (name !== 'peek') dismiss();
    if (stepOn) { paintStrip(); setTimeout(() => ui.reframe?.(), SHEET_MS); }
  }});
  paintWords();
  new ResizeObserver(() => layout()).observe(el);
  wide.addEventListener('change', layout);
  layout();
  const lift = (to = 'half') => { if (!rail && SNAPS.indexOf(sheet.snap) < SNAPS.indexOf(to)) sheet.to(to); };
  dock.addEventListener('focusin', (e) => { if (!stepOn && e.target.matches?.(TYPED)) lift('full'); });

  /** The whole car, from the side the part is on, with the sightline cut to it. A part means nothing without the car around it. */
  ui.showWhere = showWhere;
  function showWhere(id) {
    if (rail) { rig.flyToPart(id, {minDist: SEE_IT_M}); return; }
    const b = registry.partBox(id);
    const x = (b.min.x + b.max.x) / 2, y = (b.min.y + b.max.y) / 2, z = (b.min.z + b.max.z) / 2;
    const side = Math.abs(z) > 0.12 ? Math.sign(z) : 1;
    const az = (Math.atan2(side, Math.max(-1.2, Math.min(1.2, x / 1.2))) * 180) / Math.PI;
    rig.addView('locate', {az, el: y < 0.33 ? -24 : y > 0.62 ? 32 : 14, box: rig.views.hero.box, fill: 0.9, whole: true});
    rig.setView('locate');
  }

  /** Zoom and isolate, on the car area: they act on the picture, not on the facts in the panel. */
  function paintPartBar(s) {
    const id = s.mode === 'explore' && s.selected && data.parts.byId.has(s.selected) ? registry.resolve(s.selected).id : null;
    partBar.hidden = !id;
    if (!id) return;
    const iso = (s.isolate ?? []).includes(id);
    partBar.replaceChildren(
      h('button.view', {type: 'button', onclick: () => {
        zoomed = !zoomed;
        if (zoomed) rig.flyToPart(id, {minDist: rail ? 1.4 : SEE_IT_M}); else showWhere(id);
        store.set({view: null});
        paintPartBar(store.get());
      }}, zoomed ? t('Whole car') : t('Zoom in')),
      h('button.view', {type: 'button', 'aria-pressed': String(iso), onclick: () => store.set({isolate: iso ? null : [id], locate: iso})}, t('Just this part')),
    );
  }

  const backToJob = () => {
    const job = ui.lookupFrom ?? store.get().job;
    ui.lookupFrom = null;
    store.set({mode: 'jobs', job, selected: null, isolate: null, locate: false, xray: false});
  };
  /** What sits under the top bar: a car from someone else's link, and the way back to a job in hand. */
  function paintBanner(s) {
    const rows = [];
    if (app.noGL) rows.push(h('div.banner-row', h('span.banner-text', t('The 3D view is not available in this browser. Every torque, job, fault and part number still works.'))));
    if (s.linked) {
      const own = s.linked.own;
      const car = carYear(s.variant);
      rows.push(h('div.banner-row.banner-link', [
        h('span.banner-text.banner-long', t(own ? 'Viewing a {car}, not your car.' : 'Viewing a {car} from a shared link.', {car})),
        h('span.banner-text.banner-short', {'aria-hidden': 'true'}, car), // a phone has one line for this: the car and the two ways out
        own && h('button.link', {type: 'button', onclick: () => store.set({variant: own, linked: null})}, t('Back to my car')),
        h('button.link', {type: 'button', onclick: () => store.set({linked: null, chosen: true})}, t('Make this my car')),
      ]));
    }
    if (frenchOffer) rows.push(h('div.banner-row', {lang: 'fr'}, [h('span.banner-text', 'Voir ce site en français ?'), h('button.link', {type: 'button', onclick: async () => { frenchOffer = false; paintBanner(store.get()); await app.setLang('fr'); }}, 'Oui'), h('button.link', {type: 'button', onclick: () => { frenchOffer = false; paintBanner(store.get()); }}, 'Non merci')]));
    const job = s.mode === 'jobs' ? null : ui.lookupFrom ?? s.job;
    const rec = job && data.jobs.byId.get(job.id);
    if (rec) rows.push(h('div.banner-row', [h('span.banner-text', rec.title), h('button.link', {type: 'button', onclick: backToJob}, job.step == null ? t('Back to the job') : t('Back to step {n}', {n: job.step + 1}))]));
    banner.replaceChildren(...rows);
    banner.hidden = !rows.length;
    if (rail === false) sheetFor();
    report();
  }

  // A phone set to French gets the offer once, in French. The language stays a choice, and a link's own language stands.
  let frenchOffer = !store.get().langOffered && store.get().lang !== 'fr' && !location.hash.includes('l=') && /^fr\b/i.test(navigator.language ?? '');
  if (frenchOffer) store.set({langOffered: true});

  // ---- first screen, hot spots, idle orbit ------------------------------------------------------
  const spots = [];
  function buildHots() {
    hots.replaceChildren();
    spots.length = 0;
    if (!introOn) return;
    let first = null;
    const v = store.get().variant;
    const seen = new Set();
    for (const w of proneTo(v)) {
      const id = (w.parts ?? []).filter((p) => registry.has(p) && !seen.has(p)).find((p) => {
        const size = registry.partBox(p).getSize(new THREE.Vector3());
        return Math.max(size.x, size.y, size.z) < HOT_MAX_M; // a dot on the whole shell points at nothing
      });
      if (!id) continue;
      seen.add(id);
      const b = registry.partBox(id);
      const at = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
      if (at[1] < HOT_MIN_Y) continue;
      const p = stage.project(at);
      if (spots.some((o) => { const q = stage.project(o.at); return Math.abs(q.x - p.x) < 280 && Math.abs(q.y - p.y) < 44; })) continue;
      spots.push({
        at,
        node: h('button.hot', {type: 'button', 'aria-label': t('{what}: open it', {what: w.title}), onclick: () => ui.open('weakspot', w.id)}, [h('i.hot-ring'), h('span.hot-text', w.title)]),
      });
      hots.append(spots[spots.length - 1].node);
      first ??= w;
      if (spots.length >= HOT_SPOTS) break;
    }
    // A phone has no room for a label beside the dot: it would lie across the car. The words sit under the car instead.
    if (first) hots.append(h('button.hot-cap', {type: 'button', onclick: () => ui.open('weakspot', first.id)}, [h('i.hot-cap-dot'), h('span', t('Known weak spot: {what}', {what: first.title}))]));
  }
  function placeHots() {
    const {w, h: H} = stage.size, {top: above, right: r, bottom: b} = stage.insets;
    const blocked = introEl?.getBoundingClientRect();
    const taken = [];
    for (const s of spots) {
      const p = stage.project(s.at);
      s.node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      s.width ??= s.node.querySelector('.hot-text').offsetWidth + 30;
      const flip = p.x > w - r - s.width;
      s.node.classList.toggle('flip', flip);
      // A label that would land on the heading, or off the free area, stays a plain dot. No room for a dot, no spot.
      const x0 = flip ? p.x - s.width : p.x, x1 = flip ? p.x : p.x + s.width;
      const onIntro = blocked && x0 < blocked.right && x1 > blocked.left && p.y - 16 < blocked.bottom && p.y + 16 > blocked.top;
      const onLabel = taken.some((o) => x0 < o.x1 && x1 > o.x0 && Math.abs(p.y - o.y) < 32);
      const dot = onIntro || onLabel || x0 < 4 || x1 > w - r - 4;
      s.node.classList.toggle('dot-only', dot);
      if (!dot) taken.push({x0, x1, y: p.y});
      s.node.hidden = p.y < above || p.y > H - b;
    }
  }
  // The hint goes the first time the car is touched, with a tap on Got it, on any change of screen, or after a few seconds. It
  // is saved as shown when it appears, so it comes once, whatever happens next.
  let hintTimer = 0;
  function hideHint() { clearTimeout(hintTimer); hint.hidden = true; }
  function paintHint() {
    const touch = matchMedia('(pointer: coarse)').matches;
    hint.replaceChildren(h('span', touch ? t('Drag to turn the car. Pinch to zoom. Tap a part to see what it is.') : t('Drag to turn the car. Scroll to zoom. Click a part to see what it is.')), h('button.link', {type: 'button', onclick: hideHint}, t('Got it')));
  }
  function offerHint() {
    const s = store.get();
    if (s.hinted || app.noGL || s.mode !== 'explore' || s.selected) return;
    hint.hidden = false;
    if (rail === false && introOn && introEl) { hint.style.top = `${Math.round(introEl.getBoundingClientRect().bottom) + 6}px`; hint.style.bottom = 'auto'; } // between the heading and the car, not across the car
    store.set({hinted: true});
    hintTimer = setTimeout(hideHint, HINT_S * 1000);
  }
  function dismiss() {
    if (!introOn) return;
    introOn = false;
    root.classList.remove('has-intro');
    introEl.classList.add('gone');
    hots.classList.add('gone');
    report();
    setTimeout(() => { introEl?.remove(); introEl = null; hots.replaceChildren(); spots.length = 0; }, 400);
  }

  let orbiting = false, userOff = false, asleep = false, orbitFrom = 0;
  let lastInput = -1e9;
  function setOrbit(on) {
    if (orbiting === on) return;
    orbiting = on;
    orbitFrom = performance.now();
    orbitBtn.setAttribute('aria-pressed', on);
    stage.invalidate();
  }
  const mayOrbit = () => {
    const s = store.get();
    return !document.hidden && !calm.matches && !automated && !s.garage && !s.selected && !s.job && s.mode === 'explore' && !userOff && !asleep;
  };
  const touched = () => {
    lastInput = performance.now();
    asleep = false;
    if (orbiting) setOrbit(false);
  };
  for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, (e) => {
    touched();
    if (e.type !== 'keydown' || e.target === stage.renderer.domElement) {
      if (e.target === stage.renderer.domElement) { dismiss(); hideHint(); }
    }
  }, {capture: true, passive: true});
  setInterval(() => {
    const now = performance.now();
    if (orbiting) { if (!mayOrbit()) setOrbit(false); else if (now - orbitFrom > ORBIT_MAX_S * 1000) { asleep = true; setOrbit(false); } } else if (mayOrbit() && now - lastInput > IDLE_S * 1000) setOrbit(true);
  }, 500);

  stage.onFrame((dt) => {
    if (orbiting) rig.fly({az: rig.pose.az + ORBIT_DEG_S * dt}, 0);
    if (spots.length) placeHots();
    return orbiting;
  });

  // ---- garage mode ------------------------------------------------------------------------------
  let lock = null;
  async function keepAwake(on) {
    if (!on) { lock?.release().catch(() => {}); lock = null; return false; }
    if (lock || !navigator.wakeLock) return !!lock;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      return true;
    } catch { return false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.get().garage) keepAwake(true); });

  // ---- state to screen --------------------------------------------------------------------------
  const paintCar = (s) => {
    const known = s.chosen || s.linked;
    fill(carBtn, h('b', known ? carName(s.variant) : t('Choose your car')), known && h('span', carTag(s.variant)));
  };
  const paintViews = (s) => {
    const inStep = s.mode === 'jobs' && s.job?.step != null; // the camera is on the work: no named view is showing, whatever the last one was
    for (const [name, b] of Object.entries(viewBtn)) b.setAttribute('aria-pressed', !inStep && s.view === name);
  };

  const paintPicked = (s) => {
    const inOther = s.selected && s.mode !== 'explore' && s.mode !== 'jobs' && data.parts.byId.has(s.selected);
    picked.hidden = !inOther;
    if (inOther) picked.replaceChildren(h('span', partName(s.selected)), h('button.link', {type: 'button', onclick: () => ui.select(s.selected, {fly: false})}, t('See this part')));
  };

  store.subscribe((s, ch) => {
    if (ch.has('lang')) { // what the panels hold follows from their own subscriptions: this is the frame
      paintWords();
      paintCar(s);
      paintStep(s);
      paintStrip();
      paintBanner(s);
      paintPartBar(s);
      paintPicked(s);
      langs.set(s.lang);
      live.textContent = s.selected ? t('Selected {part}', {part: partName(s.selected)}) : '';
      if (introOn && introEl) { introEl.paint(s.variant); buildHots(); placeHots(); }
      requestAnimationFrame(layout); // longer words can change what the bars need
    }
    if (ch.has('mode')) {
      for (const m of MODES) modeBtn[m].setAttribute('aria-current', m === s.mode ? 'page' : 'false');
      dockTitle.textContent = t(TITLES[s.mode]);
      show(s.mode);
      if (!rail) { sheetFor(); lift(); }
      if (s.mode !== 'explore') { dismiss(); hideHint(); } else offerHint();
      if (s.mode === 'jobs') ui.lookupFrom = null;
    }
    if (ch.has('mode') || ch.has('job') || ch.has('garage')) paintStep(s);
    if (ch.has('variant')) { paintCar(s); if (introOn) { buildHots(); introEl.paint(s.variant); } }
    if (ch.has('chosen') || ch.has('linked')) paintCar(s);
    if (ch.has('chosen') && s.chosen) dismiss();
    if (ch.has('mode') || ch.has('job') || ch.has('linked') || ch.has('variant')) paintBanner(s);
    if (ch.has('notice') && s.notice) { say(s.notice); store.set({notice: null}); }
    if (ch.has('view') || ch.has('job') || ch.has('mode')) paintViews(s);
    if (ch.has('view') && s.view && s.view !== 'hero') dismiss();
    if (ch.has('garage')) applyGarage(s.garage, true);
    if (ch.has('theme') || ch.has('garage')) applyTheme();
    if (ch.has('selected') || ch.has('mode')) {
      if (s.selected) {
        dismiss();
        live.textContent = t('Selected {part}', {part: partName(s.selected)});
        if (s.mode === 'explore') lift(s.garage ? 'full' : 'half');
      } else if (ui.autoXray) {
        ui.autoXray = false;
        if (s.mode === 'explore') store.set({xray: false, isolate: null});
      }
      if (!s.selected && s.locate) store.set({locate: false});
      if (ch.has('selected') && !s.selected && s.isolate && s.mode === 'explore') store.set({isolate: null});
      paintPicked(s);
    }
    if (ch.has('selected') || ch.has('mode') || ch.has('isolate')) paintPartBar(s);
  }, ['mode', 'job', 'variant', 'chosen', 'linked', 'notice', 'units', 'view', 'garage', 'selected', 'isolate', 'lang', 'theme']);

  // ---- light and dark ----------------------------------------------------------------------------
  const deviceDark = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const s = store.get();
    const dark = s.theme === 'dark' || (s.theme === 'auto' && deviceDark.matches);
    root.classList.toggle('dark', dark);
    stage.setDark?.(dark && !s.garage); // large text is black on white whatever the setting
  }
  deviceDark.addEventListener('change', applyTheme);

  async function applyGarage(on, say) {
    root.classList.toggle('garage', on);
    if (say) {
      const awake = await keepAwake(on);
      if (on) toast(awake ? t('Large text on. The screen stays on.') : t('Large text on. This browser cannot keep the screen on: turn off auto-lock.'));
    } else if (on) keepAwake(true);
    requestAnimationFrame(layout);
  }

  // ---- keys --------------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.openSearch(); return; }
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); ui.openSearch(); return; }
    if (e.key === 'Escape' && !typing && !document.querySelector('dialog[open]') && store.get().selected) store.set({selected: null});
  });

  // ---- first paint ---------------------------------------------------------------------------------
  if (app.noGL && store.get().mode === 'run') store.set({mode: 'explore'}); // the running engine is the one thing here that needs the GPU
  const s = store.get();
  for (const m of MODES) modeBtn[m].setAttribute('aria-current', m === s.mode ? 'page' : 'false');
  dockTitle.textContent = t(TITLES[s.mode]);
  paintCar(s);
  paintViews(s);
  applyGarage(s.garage, false);
  applyTheme();
  show(s.mode);
  root.classList.toggle('has-intro', introOn);
  root.classList.toggle('no-gl', !!app.noGL);
  if (!introOn && introEl) { introEl.remove(); introEl = null; }
  buildHots();
  placeHots();
  if (s.selected || s.linked || s.mode !== 'explore' || location.hash.length > 2 && /p=|view=|sys=|x=/.test(location.hash)) dismiss();
  if (s.selected && s.mode === 'explore' && data.parts.byId.has(s.selected)) ui.select(s.selected);
  paintBanner(s);
  paintPartBar(s);
  if (s.notice) { say(s.notice); store.set({notice: null}); }
  paintStep(s);
  if (rail === false && !stepOn) sheet.to(app.noGL ? 'full' : s.selected || s.mode !== 'explore' ? 'half' : 'peek');
  offerHint();
  document.fonts?.ready?.then(layout);
}
