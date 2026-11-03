// Run: the machine working. Controls write to state.sim, kin.js turns that into the frame the parts move by, and every
// gauge here reads that same frame (app.sim), so a readout cannot disagree with the motion.
import {data, en, forVariant, specFor} from '../data.js';
import {N, dec, fixed, pct, t} from '../i18n.js';
import {sectionLabels} from './engine-labels.js';
import {chassisReadout, displacementCc, firingTable, gearCount, gearRatio, IDLE_RPM, roadSpeedMph, rpmAtSpeed, rpmLimit, STEER_MAX_DEG, TRAVEL_MM} from '../sim/kin.js';
import {badge, block, h, range, seg, specBadge, toggle} from './widgets.js';
import {createEngineSound} from './sound.js';

/** Estimated, for feel only: how fast the rpm follows the throttle, and how long the hood takes. Motion, not specs. */
const SHORT_SCREEN = 520; // as SHORT_H in shell.js
const REV_UP_RPM_S = 5200, REV_DOWN_RPM_S = 3400, ROOF_CYCLE_S = 14;
const CHAIN_PARTS = ['engine.chain-primary', 'engine.chain-secondary', 'engine.chain-tensioner-primary', 'engine.chain-tensioner-secondary', 'engine.tensioner-blade', 'engine.chain-guide-primary', 'engine.crank-sprocket', 'engine.exhaust-cam-sprocket', 'engine.inlet-cam-sprocket', 'engine.vvt-unit', 'engine.crank-damper', 'engine.crankshaft', 'engine.camshaft-inlet', 'engine.camshaft-exhaust', 'engine.camshaft'];
const HOW_SPEED = 0.02; // the cutaway: slow enough to read the stroke's sentence before the next one comes
// The four strokes, in the order the piston does them. kin.js names them; these are the words on the picture.
const HOW = [['inlet', N('Suck'), N('The piston goes down and pulls in air and fuel.')], ['compression', N('Squeeze'), N('The piston comes up and squeezes the mix.')], ['power', N('Bang'), N('The spark plug fires, and the burning mix pushes the piston down.')], ['exhaust', N('Blow'), N('The piston comes up and pushes the burnt gas out.')]];
const BENCH = Object.fromEntries(['body', 'roof', 'interior', 'hvac', 'electrical', 'cooling', 'exhaust', 'front-suspension', 'rear-suspension', 'steering', 'brakes', 'wheels', 'driveline'].map((k) => [k, 'hide']));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const estimate = (text) => badge({conf: 'estimated'}, {title: t('Estimated'), extra: h('p.prov-note', text)});

const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs ?? {})) n.setAttribute(k, v);
  n.append(...kids.flat().filter(Boolean));
  return n;
};

/** Crank dial: 720 degrees once round, one mark per firing, a pointer on the live crank angle. */
function crankDial(order) {
  const R = 46, C = 60;
  const names = firingTable(order);
  const marks = names.map((c) => {
    const a = (c.fireDeg / 720) * 2 * Math.PI;
    const x = C + Math.sin(a) * (R + 5), y = C - Math.cos(a) * (R + 5);
    const t = svg('text', {x, y: y + 3.4, 'text-anchor': 'middle', class: 'dial-t'});
    t.textContent = c.name;
    const tick = svg('line', {x1: C + Math.sin(a) * (R - 12), y1: C - Math.cos(a) * (R - 12), x2: C + Math.sin(a) * (R - 5), y2: C - Math.cos(a) * (R - 5), class: 'dial-tick'});
    return [tick, t];
  });
  const hand = svg('line', {x1: C, y1: C, x2: C, y2: C - (R - 4), class: 'dial-hand'});
  const root = svg('svg', {viewBox: '0 0 120 120', class: 'dial', role: 'img', 'aria-label': t('The engine turning through one 720 degree cycle, with each firing marked')}, svg('circle', {cx: C, cy: C, r: R - 4, class: 'dial-ring'}), marks.flat(), hand, svg('circle', {cx: C, cy: C, r: 3, class: 'dial-pin'}));
  root.set = (deg) => hand.setAttribute('transform', `rotate(${(deg / 2).toFixed(1)} ${C} ${C})`);
  return root;
}

/** Top view of the two front wheels at their real steer angles. */
function steerGauge() {
  const wheel = (x) => svg('rect', {x: x - 5, y: 26, width: 10, height: 28, rx: 1.5, class: 'gauge-wheel'});
  const l = wheel(22), r = wheel(98);
  const root = svg('svg', {viewBox: '0 0 120 80', class: 'gauge', role: 'img', 'aria-label': t('Front wheel steer angles, seen from above')}, svg('line', {x1: 22, y1: 40, x2: 98, y2: 40, class: 'gauge-axle'}), l, r);
  root.set = (left, right) => {
    l.setAttribute('transform', `rotate(${left.toFixed(1)} 22 40)`);
    r.setAttribute('transform', `rotate(${right.toFixed(1)} 98 40)`);
  };
  return root;
}

/** Up and down of the two axles, ride height in the middle. */
function travelGauge() {
  const track = (x) => [svg('line', {x1: x, y1: 8, x2: x, y2: 72, class: 'gauge-axle'}), svg('line', {x1: x - 9, y1: 40, x2: x + 9, y2: 40, class: 'gauge-tick'})];
  const mark = (x) => svg('rect', {x: x - 12, y: 37.5, width: 24, height: 5, class: 'gauge-mark'});
  const f = mark(36), r = mark(84);
  const root = svg('svg', {viewBox: '0 0 120 80', class: 'gauge', role: 'img', 'aria-label': t('Wheel movement, front and rear')}, track(36), track(84), f, r);
  const y = (mm) => -(mm / Math.max(TRAVEL_MM.bump, TRAVEL_MM.rebound)) * 30;
  root.set = (fm, rm) => {
    f.setAttribute('transform', `translate(0 ${y(fm).toFixed(1)})`);
    r.setAttribute('transform', `translate(0 ${y(rm).toFixed(1)})`);
  };
  return root;
}

export function mount(el, app) {
  const {store, stage, registry} = app;
  const get = () => store.get();
  const sim = () => get().sim;
  const spec = () => specFor(get().variant);
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  let base = IDLE_RPM; // the rpm the slider holds; the throttle revs above it
  let pedalHeld = false, active = false, roofDir = 0;
  let soundOn = false, audio = null, engineSound = null, soundFor = null;
  let lastRun = null; // what entering Run changed, to put back on the way out
  let section = null; // null, 'bank', or 'cyl1' to 'cyl4': see applySection in engine-common.js
  let lamps = [];

  // Everything with words on it. Built once here and once more on each change of language: what a control shows comes from
  // the state, so nothing is lost. The functions below reach these through the lets.
  let chainsBtn, sectionBtn, stateWord, startBtn, rpmNum, rpmBarFill, rpmRed, rpmBarEnd, mphNum, kphNum, pistonNum, gearNum, gearSub, redBadge, fireStrip, dash;
  let rpm, throttle, speed, gearSeg, steer, bumpF, bumpR, roof, roofBtn, roofRow, coupeNote, opens, steerCentre;
  let sectionRows, timeSeg, soundBtn, crankNum, camNum, steerG, steerL, steerR, travelG, travelF, travelR, instBlock, solvedRows, solved;
  const rpmText = (v) => t('{n} rpm', {n: Math.round(v)});

  function buildPanel() {
    // ---- the dash: stays on top while the controls scroll ---------------------------------------
    chainsBtn = h('button.btn', {type: 'button', 'aria-pressed': 'false', onclick: () => setChains(chainsBtn.getAttribute('aria-pressed') !== 'true')}, t('Just the timing chains'));
    sectionBtn = h('button.btn', {type: 'button', 'aria-pressed': 'false', onclick: () => setSection(section == null ? 'cyl1' : null)}, t('Cut the engine open'));
    stateWord = h('span.dash-state', t('Engine off'));
    startBtn = h('button.btn.btn-start', {type: 'button', onclick: () => (sim().running ? stop() : start())}, t('Start'));
    rpmNum = h('span.dash-rpm', '0');
    rpmBarFill = h('i.bar-fill');
    rpmRed = h('i.bar-red');
    rpmBarEnd = h('span.bar-end');
    mphNum = h('span.dash-val', '0');
    kphNum = h('span.dash-sub', '0 km/h');
    pistonNum = h('span.dash-val', fixed(0, 1));
    gearNum = h('span.dash-val', 'N');
    gearSub = h('span.dash-sub', '');
    redBadge = h('span.dash-badge');
    fireStrip = h('ol.fire', {'aria-label': t('Firing order')});

    dash = h('div.dash', [
      h('div.dash-top', [
        h('div.dash-rev', [rpmNum, h('span.dash-unit', t('rpm')), stateWord]),
        startBtn,
      ]),
      h('div.bar', {'aria-hidden': 'true'}, [rpmBarFill, rpmRed]),
      h('div.bar-scale', [h('span', '0'), redBadge, rpmBarEnd]),
      h('div.dash-row', [
        h('div.dash-cell', [h('span.dash-label', t('Road speed')), h('span.dash-line', [mphNum, h('span.dash-unit', 'mph')]), kphNum]),
        h('div.dash-cell', [h('span.dash-label', t('Gear')), gearNum, gearSub]),
      ]),
    ]);

    // ---- controls -------------------------------------------------------------------------------
    rpm = range({label: t('Engine speed'), name: 'rpm', min: IDLE_RPM, max: 7000, step: 50, value: IDLE_RPM, format: (v) => (sim().running ? rpmText(v) : t('Engine off')), onInput: (v) => {
      base = v;
      if (!sim().running) start();
      write({rpm: v});
    }});
    throttle = range({label: t('Accelerator'), name: 'throttle', min: 0, max: 1, step: 0.01, value: 0, format: (v) => pct(Math.round(v * 100)), onInput: (v) => {
      if (!sim().running) start();
      store.merge('sim', {throttle: v});
      stage.invalidate();
    }});
    throttle.input.addEventListener('pointerdown', () => { pedalHeld = true; });
    speed = range({label: t('Road speed in gear'), name: 'speed', min: 0, max: 100, step: 1, value: 0, format: (v) => (!sim().gear ? t('In neutral') : !sim().running ? t('Engine off') : t('{n} mph', {n: Math.round(v)})), onInput: (v) => {
      const g = sim().gear;
      if (!g) return;
      if (!sim().running) start();
      base = clamp(rpmAtSpeed(spec(), v, g), IDLE_RPM, rpmLimit(spec()));
      write({rpm: base});
    }});

    gearSeg = h('div');
    steer = range({label: t('Steering'), name: 'steer', min: -1, max: 1, step: 0.01, value: 0, format: (v) => (Math.abs(v) < 0.005 ? t('Straight') : t(v < 0 ? '{n} of lock left' : '{n} of lock right', {n: pct(Math.round(Math.abs(v) * 100))})), onInput: (v) => merge({steer: v})});
    bumpF = range({label: t('Front wheels'), name: 'bumpF', min: -1, max: 1, step: 0.01, value: 0, format: (v) => mmText(v), onInput: (v) => merge({bumpF: v})});
    bumpR = range({label: t('Rear wheels'), name: 'bumpR', min: -1, max: 1, step: 0.01, value: 0, format: (v) => mmText(v), onInput: (v) => merge({bumpR: v})});
    roof = range({label: t('Hood'), name: 'roof', min: 0, max: 1, step: 0.01, value: 0, format: (v) => (v <= 0 ? t('Up') : v >= 1 ? t('Down') : pct(Math.round(v * 100))), onInput: (v) => { roofDir = 0; merge({roof: v}); }});
    roofBtn = h('button.btn', {type: 'button', onclick: () => { roofDir = sim().roof > 0.5 ? -1 : 1; roofBtn.textContent = roofDir < 0 ? t('Raising') : t('Lowering'); stage.invalidate(); }}, t('Lower the hood'));
    roofRow = h('div.ctl-roof', [roof, roofBtn]);
    coupeNote = h('p.empty', t('This car is a coupe. Pick a convertible to run the hood.'));
    opens = ['bonnet', 'boot', 'doorL', 'doorR'].map((k) => toggle({label: t({bonnet: 'Bonnet', boot: 'Boot', doorL: 'Left door', doorR: 'Right door'}[k]), onChange: (on) => { store.merge('sim', {open: {...sim().open, [k]: on ? 1 : 0}}); stage.invalidate(); }}));
    steerCentre = h('button.link', {type: 'button', onclick: () => { steer.set(0); merge({steer: 0}); }}, t('Centre'));

    // ---- watching things ------------------------------------------------------------------------
    sectionRows = seg({label: t('Where to cut'), value: 'cyl1', className: 'seg-rows', options: [{value: 'bank', label: t('Along'), aria: t('Along one side of the engine')}, ...[1, 2, 3, 4].map((r) => ({value: `cyl${r}`, label: t('Slice {n}', {n: r}), aria: t('Across cylinder pair {n}', {n: r})}))], onChange: (r) => setSection(r)});
    sectionRows.hidden = true;
    timeSeg = seg({label: t('Speed'), value: 1, options: [{value: 1, label: t('Full speed')}, {value: 0.25, label: t('A quarter')}, {value: 0.05, label: t('A twentieth')}, {value: HOW_SPEED, label: t('Slowest')}], onChange: (v) => merge({timeScale: v})});

    // ---- sound ----------------------------------------------------------------------------------
    soundBtn = toggle({label: t('Engine sound'), on: false, onChange: (on) => setSound(on)});

    // ---- instruments below the controls ---------------------------------------------------------
    crankNum = h('span.inst-val', '0');
    camNum = h('span.inst-sub', '');
    steerG = steerGauge();
    steerL = h('span.inst-val', fixed(0, 1));
    steerR = h('span.inst-val', fixed(0, 1));
    travelG = travelGauge();
    travelF = h('span.inst-val', '0');
    travelR = h('span.inst-val', '0');
    instBlock = block(t('Dials'));
    // The suspension and steering solve, row by row: the numbers that pose the parts. The rows exist only while open.
    solvedRows = h('dl.facts');
    solved = h('details.run-solved', {ontoggle: () => { if (solved.open) readChassis(app.sim); }}, [
      h('summary', [`${t('How the suspension moves')} `, estimate(t('Worked out from points estimated off drawings. It shows how the arms move. These are not Jaguar settings.'))]),
      solvedRows,
    ]);
    hud.setAttribute('aria-label', t('Dials'));

    el.replaceChildren(
      dash,
      h('div.run-watch', {dataset: {peek: ''}}, [h('div.run-btns', [sectionBtn, chainsBtn]), sectionRows, h('span.rng-label', t('Speed')), timeSeg, soundBtn]),
      block(t('Drive'), [gearSeg, rpm, throttle, h('p.hint', t('The accelerator works like the pedal: hold it to rev, let go and it returns.')), speed]),
      block(t('Steering and suspension'), [steer, steerCentre, bumpF, bumpR, solved]),
      block(t('Roof, doors and bonnet'), [roofRow, coupeNote, h('div.run-btns', opens)]),
      instBlock,
      block(t('The numbers'), [
        h('dl.facts', h('div.fact', [h('dt', t('Average piston speed')), h('dd', h('span.dash-line', [pistonNum, h('span.dash-unit', 'm/s')]))])),
        h('h4.lab.run-fire', t('Firing order')), fireStrip, facts,
      ]),
    );
  }

  const release = () => {
    if (!pedalHeld) return;
    pedalHeld = false;
    throttle.set(0);
    store.merge('sim', {throttle: 0});
    stage.invalidate();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  const mmText = (v) => {
    if (Math.abs(v) < 0.005) return t('Normal height');
    const mm = (v >= 0 ? v * TRAVEL_MM.bump : -v * TRAVEL_MM.rebound);
    return t(v > 0 ? '{n} mm up' : '{n} mm down', {n: mm.toFixed(0)});
  };

  function merge(patch) { store.merge('sim', patch); stage.invalidate(); }
  function write(patch) {
    const s = sim();
    const next = {...patch};
    const r = next.rpm ?? s.rpm;
    next.speedMph = s.gear ? Math.abs(roadSpeedMph(spec(), r, next.gear ?? s.gear)) : 0;
    merge(next);
  }

  function setGear(g) {
    const s = sim();
    if (s.gear > 0 && g > 0 && s.running && s.speedMph > 0) { // a shift holds road speed: the rpm moves
      base = clamp(rpmAtSpeed(spec(), s.speedMph, g), IDLE_RPM, rpmLimit(spec()));
      write({gear: g, rpm: base});
    } else write({gear: g});
    syncRanges();
  }

  function buildGears() {
    const sp = spec();
    const n = gearCount(sp);
    const options = [
      {value: -1, label: 'R', aria: t('Reverse'), disabled: gearRatio(sp, -1) == null, title: gearRatio(sp, -1) == null ? t('No reverse ratio on record') : undefined},
      {value: 0, label: 'N', aria: t('Neutral')},
      ...Array.from({length: n}, (_, i) => ({value: i + 1, label: String(i + 1), aria: t('Gear {n}', {n: i + 1})})),
    ];
    gearSeg.replaceChildren(h('span.rng-label', t('Gear')), seg({label: t('Gear'), options, value: sim().gear, onChange: setGear, className: 'seg-gear'}));
  }

  function syncRanges() {
    const sp = spec(), s = sim();
    const limit = rpmLimit(sp);
    rpm.setRange(IDLE_RPM, limit);
    const top = s.gear ? Math.abs(roadSpeedMph(sp, limit, s.gear)) : 0;
    speed.setRange(0, Math.round(top) || 1);
    speed.input.disabled = !s.gear;
    speed.classList.toggle('off', !s.gear);
    rpmBarEnd.textContent = sp.redlineRpm != null ? '' : t('{n} slider end', {n: limit});
    rpmRed.style.left = `${(sp.redlineRpm ?? limit) / limit * 100}%`;
    rpmRed.hidden = sp.redlineRpm == null;
    redBadge.replaceChildren(...(sp.redlineRpm != null ? [h('span', `${t('{n} redline', {n: sp.redlineRpm})} `), specBadge(sp, 'redlineRpm', t('Redline'))] : [h('span', t('No sourced redline'))]));
    roofRow.hidden = get().variant.body !== 'convertible';
    coupeNote.hidden = !roofRow.hidden;
  }

  /** What changes only with the car. */
  function syncSpec() {
    lastRpm = -1; // a new car rescales the bar and the piston speed at the same rpm
    buildGears();
    fireStrip.replaceChildren(...firingTable(spec().firingOrder).map((c) => h('li', {dataset: {name: c.name}}, [h('i'), h('span', c.name)])));
    lamps = [...fireStrip.children].map((li) => ({dot: li.firstChild, li, v: 0}));
    rebuildInstruments();
    syncRanges();
    placeInstruments();
  }

  // While the chains or a section are up, only the engine stays: the part doing the work opens up, with nothing in front.
  let savedSystems = null;
  function clearTheBench(on) {
    if (on && !savedSystems) { savedSystems = get().systems; store.set({systems: {...savedSystems, ...BENCH}}); }
    if (!on && savedSystems) { store.set({systems: savedSystems}); savedSystems = null; }
  }

  // On the picture while the chains run: how slow this is, and what to look at.
  const chainTag = h('div.chain-tag', {hidden: true});
  document.getElementById('ui').append(chainTag);
  // The same strip for the cutaway: the four strokes, the one happening now, and what it does.
  let howBits = null;
  function labelHow(on) {
    chainTag.hidden = !on;
    chainTag.classList.toggle('how', on);
    document.documentElement.classList.toggle('run-how', on);
    howBits = null;
    if (!on) { app.pick.setLabels([]); app.pick.setAutoLabels(true); app.ui.sheetChanged?.(); return; }
    const pills = HOW.map(([key, word]) => h('li', {dataset: {stroke: key}}, t(word)));
    const line = h('p.how-line');
    howBits = {pills, line, stroke: null};
    chainTag.replaceChildren(h('ol.how-steps', pills), line);
    app.ui.sheetChanged?.();
    app.pick.setAutoLabels(false);
    app.pick.setLabels(section === 'bank' ? [] : sectionLabels(+section.slice(3), {piston: t('Piston'), valve: t('Valve'), plug: t('Spark plug'), crank: t('Crankshaft')}));
    if (app.sim) paintHow(app.sim);
  }
  function paintHow(f) {
    const row = section === 'bank' ? 1 : +section.slice(3);
    const stroke = f.cyl.find((c) => c.name === `${row}A`)?.stroke;
    if (!stroke || stroke === howBits.stroke) return;
    howBits.stroke = stroke;
    for (const li of howBits.pills) li.classList.toggle('on', li.dataset.stroke === stroke);
    howBits.line.textContent = t(HOW.find(([k]) => k === stroke)[2]);
  }
  const chainWeak = () => forVariant(data.weakspots.items, get().variant).find((w) => /tensioner/i.test(en(w, 'title')));
  function labelChains(on) {
    chainTag.hidden = !on;
    chainTag.classList.remove('how');
    if (!on) { app.pick.setLabels([]); app.pick.setAutoLabels(true); app.ui.sheetChanged?.(); return; }
    const weak = chainWeak();
    chainTag.replaceChildren(...[h('span', t('20 times slower')), weak && h('button.link', {type: 'button', onclick: () => app.ui.open('weakspot', weak.id)}, t('This tensioner is the known weak point'))].filter(Boolean));
    app.ui.sheetChanged?.();
    const has = (id) => registry.has(id);
    app.pick.setAutoLabels(false);
    app.pick.setLabels([
      has('engine.chain-primary') && {id: 'engine.chain-primary', text: t('Primary chain')},
      has('engine.chain-secondary') && {id: 'engine.chain-secondary', text: t('Secondary chain')},
      has('engine.chain-tensioner-secondary') && {id: 'engine.chain-tensioner-secondary', text: t('Tensioner'), accent: true},
    ].filter(Boolean));
  }
  app.ui.showChains = (on) => setChains(on);
  app.ui.showHow = (on) => setSection(on ? 'cyl1' : null);

  function setChains(on) {
    if (on && section != null) setSection(null);
    chainsBtn.setAttribute('aria-pressed', on);
    clearTheBench(on);
    labelChains(on);
    if (!on) {
      store.set({isolate: null, view: 'side'});
      timeSeg.set(1);
      merge({timeScale: 1});
      return;
    }
    const group = registry.group('timing');
    const ids = group.length ? group : [...new Set(CHAIN_PARTS.map((id) => registry.resolve(id).id).filter(Boolean))];
    if (!sim().running) start();
    timeSeg.set(0.05);
    merge({timeScale: 0.05});
    store.set({isolate: ids, view: 'engine-chains'});
  }

  // The cut itself is the engine's: engine-common.js discards past a plane and hatches the cut faces. sim.section picks it.
  function setSection(mode) {
    const was = section;
    section = mode;
    sectionBtn.setAttribute('aria-pressed', mode != null);
    sectionRows.hidden = mode == null;
    if (mode != null) {
      sectionRows.set(mode);
      if (chainsBtn.getAttribute('aria-pressed') === 'true') setChains(false);
    }
    clearTheBench(mode != null);
    // Silent at full speed it is only a blur: it opens slowed down, with the strokes in words. A slider set by hand stays set after that.
    if (mode != null && was == null) {
      if (!sim().running) start();
      timeSeg.set(HOW_SPEED);
      merge({timeScale: HOW_SPEED});
    }
    if (mode == null && was != null) { timeSeg.set(1); merge({timeScale: 1}); }
    merge({section: mode});
    store.set({view: mode == null ? 'side' : mode === 'bank' ? 'section-bank' : 'section-cylinder'});
    labelHow(mode != null);
    placeInstruments();
  }

  function ensureSound() {
    if (!audio) audio = new (window.AudioContext ?? window.webkitAudioContext)();
    const key = `${spec().firingOrder}-${spec().induction}`;
    if (!engineSound || soundFor !== key) {
      engineSound?.stop();
      engineSound = createEngineSound(audio, spec());
      soundFor = key;
    }
    audio.resume();
  }
  app.ui.soundState = () => (soundOn ? audio?.state : 'off');
  function setSound(on) {
    soundOn = on;
    if (on) {
      ensureSound();
      if (!sim().running) start();
    } else {
      engineSound?.stop();
      engineSound = null;
      soundFor = null;
    }
    stage.invalidate();
  }

  let dial = null;
  const instruments = h('div.insts');
  const facts = h('div');
  // On a wide screen the gauges sit on the stage, in the empty studio above the car. On a phone they stay in the sheet.
  const hud = h('div.run-hud', {hidden: true});
  const readChassis = (frame) => {
    if (!solved.open || !frame?.chassis) return;
    const rows = chassisReadout(frame.chassis);
    if (solvedRows.childElementCount !== rows.length) solvedRows.replaceChildren(...rows.map((r) => h('div.fact', [h('dt', t(r.label)), h('dd', h('span.num'))])));
    rows.forEach((r, i) => { solvedRows.children[i].querySelector('.num').textContent = `${dec(r.value)} ${t(r.unit)}`; });
  };
  document.getElementById('ui').append(hud);
  function placeInstruments() {
    const wide = document.documentElement.classList.contains('layout-rail') && window.innerHeight > SHORT_SCREEN; // a phone on its side has no empty studio: the gauges stay in the rail, off the car
    (wide ? hud : instBlock).append(instruments);
    hud.hidden = !wide || !active || section != null; // the strokes' words sit there
    instBlock.hidden = wide;
  }
  window.addEventListener('resize', () => { if (active) placeInstruments(); });

  function rebuildInstruments() {
    const sp = spec();
    dial = crankDial(sp.firingOrder);
    instruments.replaceChildren(
      h('div.inst', [h('h4.inst-title', t('Engine turn')), dial, h('p.inst-read', [crankNum, h('span.dash-unit', t('deg'))]), camNum]),
      h('div.inst', [h('h4.inst-title', [`${t('Steering angle')} `, estimate(t('Full lock is an estimate, {n} degrees, on the inner wheel. The outer wheel follows from the way the steering arms move. We have no Jaguar figure. It sets the motion only.', {n: STEER_MAX_DEG}))]), steerG, h('p.inst-pair', [h('span', [`${t('L|left')} `, steerL]), h('span', [`${t('R|right')} `, steerR])]), h('span.inst-sub', t('deg at the wheel'))]),
      h('div.inst', [h('h4.inst-title', [`${t('Wheel movement')} `, estimate(t('Movement is an estimate: {bump} mm up and {droop} mm down. We have no Jaguar figure. It sets the motion only.', {bump: TRAVEL_MM.bump, droop: TRAVEL_MM.rebound}))]), travelG, h('p.inst-pair', [h('span', [`${t('F|front')} `, travelF]), h('span', [`${t('R|rear')} `, travelR])]), h('span.inst-sub', t('mm from normal height'))]),
    );
    const cc = Math.round(displacementCc(sp.boreMm, sp.strokeMm));
    facts.replaceChildren(h('dl.facts', [
      h('div.fact', [h('dt', t('Bore and stroke')), h('dd', [h('span.num', `${dec(sp.boreMm)} x ${dec(sp.strokeMm)} mm`), specBadge(sp, 'strokeMm', t('Bore and stroke'))])]),
      h('div.fact', [h('dt', t('Capacity from those')), h('dd', [h('span.num', `${cc} cc`), specBadge(sp, 'displacementCc', t('Capacity'))])]),
      h('div.fact', [h('dt', t('Final drive')), h('dd', [h('span.num', `${dec(sp.finalDrive)}:1`), specBadge(sp, 'finalDrive', t('Final drive'))])]),
      h('div.fact', [h('dt', t('Gears')), h('dd', [h('span.num', sp.gearRatios.map(dec).join(', ')), specBadge(sp, 'gearRatios', t('Gear ratios'))])]),
      h('div.fact', [h('dt', t('Tyres, rear')), h('dd', [h('span.num', sp.tyresRear), specBadge(sp, 'tyresRear', t('Rear tyres'))])]),
      sp.topSpeedMph != null && h('div.fact', [h('dt', t('Top speed on record')), h('dd', [h('span.num', `${sp.topSpeedMph} mph`), specBadge(sp, 'topSpeedMph', t('Top speed'))])]),
      h('div.fact', [h('dt', t('Firing order')), h('dd', [h('span.num', sp.firingOrder), badge({conf: data.variants.firing?.conf ?? sp.conf, src: data.variants.firing?.src ?? sp.src, note: data.variants.firing?.note}, {file: 'variants', title: t('Firing order')})])]),
    ]));
  }

  buildPanel();

  /** The same panel in the new language, showing what the state says, with the engine still running if it was. */
  function changeWords() {
    const s = sim(), chains = chainsBtn.getAttribute('aria-pressed') === 'true', opened = solved.open;
    const raising = roofDir < 0, lowering = roofDir > 0;
    buildPanel();
    throttle.set(s.throttle);
    steer.set(s.steer);
    bumpF.set(s.bumpF);
    bumpR.set(s.bumpR);
    roof.set(s.roof);
    opens.forEach((b, i) => b.set(!!s.open[['bonnet', 'boot', 'doorL', 'doorR'][i]]));
    timeSeg.set(s.timeScale);
    soundBtn.set(soundOn);
    solved.open = opened;
    startBtn.textContent = s.running ? t('Stop|engine') : t('Start');
    startBtn.setAttribute('aria-pressed', String(!!s.running));
    roofBtn.textContent = raising ? t('Raising') : lowering ? t('Lowering') : s.roof > 0.5 ? t('Raise the hood') : t('Lower the hood');
    chainsBtn.setAttribute('aria-pressed', chains);
    sectionBtn.setAttribute('aria-pressed', section != null);
    sectionRows.hidden = section == null;
    if (section != null) sectionRows.set(section);
    if (chains) labelChains(true);
    if (section != null) labelHow(true);
    if (active) { lastRpm = lastMph = lastCrank = -1; syncSpec(); readouts(app.sim); }
  }

  // ---- running ---------------------------------------------------------------------------------
  function start() {
    base = Math.max(base, IDLE_RPM);
    merge({running: true, rpm: base});
    startBtn.textContent = t('Stop|engine');
    startBtn.setAttribute('aria-pressed', 'true');
  }
  function stop() {
    merge({running: false, rpm: 0, throttle: 0, speedMph: 0});
    throttle.set(0);
    speed.set(0);
    rpm.set(IDLE_RPM);
    startBtn.textContent = t('Start');
    startBtn.setAttribute('aria-pressed', 'false');
    for (const l of lamps) { l.v = 0; l.dot.style.opacity = '0.08'; } // frames stop with the engine: nothing else would dim them
  }

  let lastMph = -1, lastRpm = -1, lastCrank = -1, shownGear = 0;
  function readouts(f) {
    if (!f) return;
    const r = f.running ? Math.round(f.rpm) : 0; // a stopped engine reads zero, whatever the last frame held
    if (r !== lastRpm) {
      lastRpm = r;
      rpmNum.textContent = r;
      rpmBarFill.style.transform = `scaleX(${(r / rpmLimit(spec())).toFixed(4)})`;
      pistonNum.textContent = fixed(f.running ? f.meanPistonSpeed : 0, 1);
    }
    const mph = Math.abs(f.speedMph);
    if (Math.round(mph * 10) !== lastMph) {
      lastMph = Math.round(mph * 10);
      mphNum.textContent = mph.toFixed(0);
      kphNum.textContent = `${(mph * 1.609344).toFixed(0)} km/h`;
    }
    const idling = f.running && !f.throttle && r <= IDLE_RPM + 30;
    const word = !f.running ? t('Engine off') : idling ? t('Idling') : t('Running');
    if (stateWord.textContent !== word) stateWord.textContent = word;
    dash.classList.toggle('is-off', !f.running);
    gearNum.textContent = f.gear < 0 ? 'R' : f.gear === 0 ? 'N' : f.gear;
    gearSub.textContent = f.ratio != null ? `${dec(f.ratio)}:1` : '';
    if (f.crank !== lastCrank) {
      lastCrank = f.crank;
      crankNum.textContent = Math.round(f.crank);
      camNum.textContent = t('cam {n} deg', {n: Math.round(f.camDeg)});
      dial.set(f.crank);
    }
    steerL.textContent = fixed(Math.abs(f.steerDeg.left), 1);
    steerR.textContent = fixed(Math.abs(f.steerDeg.right), 1);
    steerG.set(f.steerDeg.left, f.steerDeg.right);
    const fm = f.bumpF * 1000, rm = f.bumpR * 1000;
    travelF.textContent = fm.toFixed(0);
    travelR.textContent = rm.toFixed(0);
    travelG.set(fm, rm);
    // Each lamp follows that cylinder's power stroke, smoothed so high rpm settles to a glow and not a strobe.
    const still = calm.matches;
    for (let i = 0; i < lamps.length; i++) {
      const c = f.cyl[i];
      const target = f.running && !still && c.phase < 180 ? 1 - c.phase / 180 : 0;
      const l = lamps[i];
      l.v += (target - l.v) * 0.45;
      // With motion turned down the strip holds still and simply reads as the firing order, lit while the engine turns.
      l.dot.style.opacity = still ? (f.running ? '0.35' : '0.08') : (0.08 + l.v * 0.92).toFixed(2);
    }
  }

  stage.onFrame((dt) => {
    if (!active) return false;
    const s = sim();
    let more = false;
    if (s.running) {
      const limit = rpmLimit(spec());
      const target = base + s.throttle * (limit - base);
      const d = target - s.rpm;
      if (Math.abs(d) > 0.5) {
        const rate = (d > 0 ? REV_UP_RPM_S : REV_DOWN_RPM_S) * (s.gear ? 0.4 : 1) * s.timeScale ** 0.5;
        write({rpm: s.rpm + clamp(d, -rate * dt, rate * dt)});
        more = true;
      }
    }
    if (roofDir) {
      const next = clamp(s.roof + (roofDir * dt) / ROOF_CYCLE_S, 0, 1);
      roof.set(next);
      merge({roof: next});
      if (next === 0 || next === 1) {
        roofDir = 0;
        roofBtn.textContent = next ? t('Raise the hood') : t('Lower the hood');
      } else more = true;
    }
    if (s.gear !== shownGear) { shownGear = s.gear; syncRanges(); gearSeg.querySelector('.seg').set(s.gear); }
    // The sliders say what the dash says: both read the live frame, and the rpm is not rounded to the slider's step.
    const live = app.sim;
    if (document.activeElement !== speed.input) speed.set(s.running ? Math.abs(live?.speedMph ?? s.speedMph) : 0);
    if (document.activeElement !== rpm.input) {
      rpm.set(s.running ? s.rpm : IDLE_RPM);
      if (s.running) rpm.querySelector('.rng-value').textContent = rpmText(live?.rpm ?? s.rpm);
    }
    readouts(app.sim);
    readChassis(app.sim);
    if (howBits && app.sim) paintHow(app.sim);
    if (soundOn && engineSound) engineSound.update(app.sim ?? {...s}, s.timeScale);
    return more;
  });

  // ---- entering and leaving --------------------------------------------------------------------
  function enter() {
    active = true;
    syncSpec();
    const s = get();
    lastRun = {xray: s.xray && !app.ui.autoXray};
    store.set({xray: true, selected: null, view: s.view && s.view !== 'hero' ? s.view : 'side'});
    if (!s.sim.running && !calm.matches && !window.__xk8noRun) start();
    readouts(app.sim);
  }
  /** given: the same change already set x-ray, as a history step does. That value stands. */
  function leave(given) {
    active = false;
    hud.hidden = true;
    stop();
    if (chainsBtn.getAttribute('aria-pressed') === 'true') setChains(false);
    if (section != null) setSection(null);
    soundBtn.set(false);
    setSound(false);
    if (lastRun && !given) store.set({xray: lastRun.xray});
    lastRun = null;
  }

  document.addEventListener('visibilitychange', () => { if (audio) { if (document.hidden) audio.suspend(); else if (soundOn) audio.resume(); } });

  store.subscribe((s, ch) => {
    if (ch.has('lang')) changeWords();
    if (ch.has('mode')) {
      if (s.mode === 'run' && !active) enter();
      else if (s.mode !== 'run' && active) leave(ch.has('xray'));
    }
    if (ch.has('variant') && active) {
      syncSpec();
      if (soundOn) ensureSound();
      if (s.sim.rpm > rpmLimit(spec())) write({rpm: rpmLimit(spec())});
      if (s.sim.gear > gearCount(spec())) setGear(gearCount(spec()));
    }
  }, ['mode', 'variant', 'lang']);
  if (get().mode === 'run') enter();
}
