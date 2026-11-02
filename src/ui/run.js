// Run: the machine working. Controls write to state.sim, kin.js turns that into the frame the parts move by, and every
// gauge here reads that same frame (app.sim), so a readout cannot disagree with the motion.
import {data, forVariant, specFor} from '../data.js';
import {chassisReadout, displacementCc, firingTable, gearCount, gearRatio, IDLE_RPM, roadSpeedMph, rpmAtSpeed, rpmLimit, STEER_MAX_DEG, TRAVEL_MM} from '../sim/kin.js';
import {badge, block, h, range, seg, specBadge, toggle} from './widgets.js';
import {createEngineSound} from './sound.js';

/** Estimated, for feel only: how fast the rpm follows the throttle, and how long the hood takes. Motion, not specs. */
const SHORT_SCREEN = 520; // as SHORT_H in shell.js
const REV_UP_RPM_S = 5200, REV_DOWN_RPM_S = 3400, ROOF_CYCLE_S = 14;
const CHAIN_PARTS = ['engine.chain-primary', 'engine.chain-secondary', 'engine.chain-tensioner-primary', 'engine.chain-tensioner-secondary', 'engine.tensioner-blade', 'engine.chain-guide-primary', 'engine.crank-sprocket', 'engine.exhaust-cam-sprocket', 'engine.inlet-cam-sprocket', 'engine.vvt-unit', 'engine.crank-damper', 'engine.crankshaft', 'engine.camshaft-inlet', 'engine.camshaft-exhaust', 'engine.camshaft'];
const BENCH = Object.fromEntries(['body', 'roof', 'interior', 'hvac', 'electrical', 'cooling', 'exhaust', 'front-suspension', 'rear-suspension', 'steering', 'brakes', 'wheels', 'driveline'].map((k) => [k, 'hide']));
const ordinal = (n) => ['Neutral', '1st', '2nd', '3rd', '4th', '5th', '6th'][n] ?? `${n}th`;
const gearWord = (g) => (g < 0 ? 'Reverse' : ordinal(g));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const estimate = (text) => badge({conf: 'estimated'}, {title: 'Estimated', extra: h('p.prov-note', text)});

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
  const root = svg('svg', {viewBox: '0 0 120 120', class: 'dial', role: 'img', 'aria-label': 'Crank angle over one 720 degree cycle, with each firing marked'}, svg('circle', {cx: C, cy: C, r: R - 4, class: 'dial-ring'}), marks.flat(), hand, svg('circle', {cx: C, cy: C, r: 3, class: 'dial-pin'}));
  root.set = (deg) => hand.setAttribute('transform', `rotate(${(deg / 2).toFixed(1)} ${C} ${C})`);
  return root;
}

/** Top view of the two front wheels at their real steer angles. */
function steerGauge() {
  const wheel = (x) => svg('rect', {x: x - 5, y: 26, width: 10, height: 28, rx: 1.5, class: 'gauge-wheel'});
  const l = wheel(22), r = wheel(98);
  const root = svg('svg', {viewBox: '0 0 120 80', class: 'gauge', role: 'img', 'aria-label': 'Front wheel steer angles, seen from above'}, svg('line', {x1: 22, y1: 40, x2: 98, y2: 40, class: 'gauge-axle'}), l, r);
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
  const root = svg('svg', {viewBox: '0 0 120 80', class: 'gauge', role: 'img', 'aria-label': 'Wheel travel, front and rear'}, track(36), track(84), f, r);
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

  // ---- the dash: stays on top while the controls scroll ---------------------------------------
  const chainsBtn = h('button.btn', {type: 'button', 'aria-pressed': 'false', onclick: () => setChains(chainsBtn.getAttribute('aria-pressed') !== 'true')}, 'Timing chains only');
  const sectionBtn = h('button.btn', {type: 'button', 'aria-pressed': 'false', onclick: () => setSection(section == null ? 'cyl1' : null)}, 'Section view');
  const stateWord = h('span.dash-state', 'Engine off');
  const startBtn = h('button.btn.btn-start', {type: 'button', onclick: () => (sim().running ? stop() : start())}, 'Start');
  const rpmNum = h('span.dash-rpm', '0');
  const rpmBarFill = h('i.bar-fill');
  const rpmRed = h('i.bar-red');
  const rpmBarEnd = h('span.bar-end');
  const mphNum = h('span.dash-val', '0');
  const kphNum = h('span.dash-sub', '0 km/h');
  const pistonNum = h('span.dash-val', '0.0');
  const gearNum = h('span.dash-val', 'N');
  const gearSub = h('span.dash-sub', '');
  const redBadge = h('span.dash-badge');
  const fireStrip = h('ol.fire', {'aria-label': 'Firing order'});

  const dash = h('div.dash', {dataset: {peek: ''}}, [
    h('div.dash-top', [
      h('div.dash-rev', [rpmNum, h('span.dash-unit', 'rpm'), stateWord]),
      startBtn,
    ]),
    h('div.bar', {'aria-hidden': 'true'}, [rpmBarFill, rpmRed]),
    h('div.bar-scale', [h('span', '0'), redBadge, rpmBarEnd]),
    h('div.dash-row', [
      h('div.dash-cell', [h('span.dash-label', 'Road speed'), h('span.dash-line', [mphNum, h('span.dash-unit', 'mph')]), kphNum]),
      h('div.dash-cell', [h('span.dash-label', 'Gear'), gearNum, gearSub]),
      h('div.dash-cell', [h('span.dash-label', 'Piston speed, mean'), h('span.dash-line', [pistonNum, h('span.dash-unit', 'm/s')])]),
    ]),
    fireStrip,
    h('div.run-btns.dash-watch', [chainsBtn, sectionBtn]),
  ]);

  // ---- controls -------------------------------------------------------------------------------
  const rpm = range({label: 'Engine speed', name: 'rpm', min: IDLE_RPM, max: 7000, step: 50, value: IDLE_RPM, format: (v) => (sim().running ? `${Math.round(v)} rpm` : 'Engine off'), onInput: (v) => {
    base = v;
    if (!sim().running) start();
    write({rpm: v});
  }});
  const throttle = range({label: 'Throttle', name: 'throttle', min: 0, max: 1, step: 0.01, value: 0, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => {
    if (!sim().running) start();
    store.merge('sim', {throttle: v});
    stage.invalidate();
  }});
  throttle.input.addEventListener('pointerdown', () => { pedalHeld = true; });
  const release = () => {
    if (!pedalHeld) return;
    pedalHeld = false;
    throttle.set(0);
    store.merge('sim', {throttle: 0});
    stage.invalidate();
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  const speed = range({label: 'Road speed in gear', name: 'speed', min: 0, max: 100, step: 1, value: 0, format: (v) => (!sim().gear ? 'In neutral' : !sim().running ? 'Engine off' : `${Math.round(v)} mph`), onInput: (v) => {
    const g = sim().gear;
    if (!g) return;
    if (!sim().running) start();
    base = clamp(rpmAtSpeed(spec(), v, g), IDLE_RPM, rpmLimit(spec()));
    write({rpm: base});
  }});

  const mmText = (v) => {
    if (Math.abs(v) < 0.005) return 'Ride height';
    const mm = (v >= 0 ? v * TRAVEL_MM.bump : -v * TRAVEL_MM.rebound);
    return `${mm.toFixed(0)} mm ${v > 0 ? 'bump' : 'droop'}`;
  };

  const gearSeg = h('div');
  const steer = range({label: 'Steering', name: 'steer', min: -1, max: 1, step: 0.01, value: 0, format: (v) => (Math.abs(v) < 0.005 ? 'Straight' : `${Math.round(Math.abs(v) * 100)}% of lock ${v < 0 ? 'left' : 'right'}`), onInput: (v) => merge({steer: v})});
  const bumpF = range({label: 'Front wheels', name: 'bumpF', min: -1, max: 1, step: 0.01, value: 0, format: (v) => mmText(v), onInput: (v) => merge({bumpF: v})});
  const bumpR = range({label: 'Rear wheels', name: 'bumpR', min: -1, max: 1, step: 0.01, value: 0, format: (v) => mmText(v), onInput: (v) => merge({bumpR: v})});
  const roof = range({label: 'Hood', name: 'roof', min: 0, max: 1, step: 0.01, value: 0, format: (v) => (v <= 0 ? 'Up' : v >= 1 ? 'Stowed' : `${Math.round(v * 100)}%`), onInput: (v) => { roofDir = 0; merge({roof: v}); }});
  const roofBtn = h('button.btn', {type: 'button', onclick: () => { roofDir = sim().roof > 0.5 ? -1 : 1; roofBtn.textContent = roofDir < 0 ? 'Raising' : 'Lowering'; stage.invalidate(); }}, 'Lower the hood');
  const roofRow = h('div.ctl-roof', [roof, roofBtn]);
  const coupeNote = h('p.empty', 'This car is a coupe. Pick a convertible to run the hood.');
  const opens = ['bonnet', 'boot', 'doorL', 'doorR'].map((k) => toggle({label: {bonnet: 'Bonnet', boot: 'Boot', doorL: 'Left door', doorR: 'Right door'}[k], onChange: (on) => { store.merge('sim', {open: {...sim().open, [k]: on ? 1 : 0}}); stage.invalidate(); }}));
  const steerCentre = h('button.link', {type: 'button', onclick: () => { steer.set(0); merge({steer: 0}); }}, 'Centre');

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
      {value: -1, label: 'R', aria: 'Reverse', disabled: gearRatio(sp, -1) == null, title: gearRatio(sp, -1) == null ? 'No reverse ratio on record' : undefined},
      {value: 0, label: 'N', aria: 'Neutral'},
      ...Array.from({length: n}, (_, i) => ({value: i + 1, label: String(i + 1), aria: `Gear ${i + 1}`})),
    ];
    gearSeg.replaceChildren(h('span.rng-label', 'Gear'), seg({label: 'Gear', options, value: sim().gear, onChange: setGear, className: 'seg-gear'}));
  }

  function syncRanges() {
    const sp = spec(), s = sim();
    const limit = rpmLimit(sp);
    rpm.setRange(IDLE_RPM, limit);
    const top = s.gear ? Math.abs(roadSpeedMph(sp, limit, s.gear)) : 0;
    speed.setRange(0, Math.round(top) || 1);
    speed.input.disabled = !s.gear;
    speed.classList.toggle('off', !s.gear);
    rpmBarEnd.textContent = sp.redlineRpm != null ? '' : `${limit} slider end`;
    rpmRed.style.left = `${(sp.redlineRpm ?? limit) / limit * 100}%`;
    rpmRed.hidden = sp.redlineRpm == null;
    redBadge.replaceChildren(...(sp.redlineRpm != null ? [h('span', `${sp.redlineRpm} redline `), specBadge(sp, 'redlineRpm', 'Redline')] : [h('span', 'No sourced redline')]));
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

  // ---- watching things ------------------------------------------------------------------------
  const sectionRows = seg({label: 'Where to cut', value: 'cyl1', className: 'seg-rows', options: [{value: 'bank', label: 'Bank', aria: 'Along the A bank'}, ...[1, 2, 3, 4].map((r) => ({value: `cyl${r}`, label: `Row ${r}`, aria: `Across cylinder row ${r}`}))], onChange: (r) => setSection(r)});
  sectionRows.hidden = true;
  const timeSeg = seg({label: 'Time', value: 1, options: [{value: 1, label: 'Full speed'}, {value: 0.25, label: 'A quarter'}, {value: 0.05, label: 'A twentieth'}], onChange: (v) => merge({timeScale: v})});

  // While the chains or a section are up, only the engine stays: the part doing the work opens up, with nothing in front.
  let savedSystems = null;
  function clearTheBench(on) {
    if (on && !savedSystems) { savedSystems = get().systems; store.set({systems: {...savedSystems, ...BENCH}}); }
    if (!on && savedSystems) { store.set({systems: savedSystems}); savedSystems = null; }
  }

  // On the picture while the chains run: how slow this is, and what to look at.
  const chainTag = h('div.chain-tag', {hidden: true});
  document.getElementById('ui').append(chainTag);
  const chainWeak = () => forVariant(data.weakspots.items, get().variant).find((w) => /tensioner/i.test(w.title));
  function labelChains(on) {
    chainTag.hidden = !on;
    if (!on) { app.pick.setLabels([]); app.pick.setAutoLabels(true); app.ui.sheetChanged?.(); return; }
    const weak = chainWeak();
    chainTag.replaceChildren(...[h('span', 'Slowed 20x'), weak && h('button.link', {type: 'button', onclick: () => app.ui.open('weakspot', weak.id)}, 'This tensioner is the known weak point')].filter(Boolean));
    app.ui.sheetChanged?.();
    const has = (id) => registry.has(id);
    app.pick.setAutoLabels(false);
    app.pick.setLabels([
      has('engine.chain-primary') && {id: 'engine.chain-primary', text: 'Primary chain'},
      has('engine.chain-secondary') && {id: 'engine.chain-secondary', text: 'Secondary chain'},
      has('engine.chain-tensioner-secondary') && {id: 'engine.chain-tensioner-secondary', text: 'Tensioner', accent: true},
    ].filter(Boolean));
  }
  app.ui.showChains = (on) => setChains(on);

  function setChains(on) {
    chainsBtn.setAttribute('aria-pressed', on);
    clearTheBench(on);
    labelChains(on);
    if (!on) {
      store.set({isolate: null, view: 'side'});
      timeSeg.set(1);
      merge({timeScale: 1});
      return;
    }
    if (section != null) setSection(null);
    clearTheBench(true);
    const group = registry.group('timing');
    const ids = group.length ? group : [...new Set(CHAIN_PARTS.map((id) => registry.resolve(id).id).filter(Boolean))];
    if (!sim().running) start();
    timeSeg.set(0.05);
    merge({timeScale: 0.05});
    store.set({isolate: ids, view: 'engine-chains'});
  }

  // The cut itself is the engine's: engine-common.js discards past a plane and hatches the cut faces. sim.section picks it.
  function setSection(mode) {
    section = mode;
    sectionBtn.setAttribute('aria-pressed', mode != null);
    sectionRows.hidden = mode == null;
    if (mode != null) {
      sectionRows.set(mode);
      if (chainsBtn.getAttribute('aria-pressed') === 'true') setChains(false);
    }
    clearTheBench(mode != null);
    merge({section: mode});
    store.set({view: mode == null ? 'side' : mode === 'bank' ? 'section-bank' : 'section-cylinder'});
  }

  // ---- sound ----------------------------------------------------------------------------------
  const soundBtn = toggle({label: 'Engine sound', on: false, onChange: (on) => setSound(on)});
  const soundNote = h('p.hint', 'Synthesised from the firing order. Each bank fires unevenly into its own exhaust, which is the V8 burble.');

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

  // ---- instruments below the controls ---------------------------------------------------------
  let dial = null;
  const crankNum = h('span.inst-val', '0');
  const camNum = h('span.inst-sub', '');
  const steerG = steerGauge();
  const steerL = h('span.inst-val', '0.0'), steerR = h('span.inst-val', '0.0');
  const travelG = travelGauge();
  const travelF = h('span.inst-val', '0'), travelR = h('span.inst-val', '0');
  const instruments = h('div.insts');
  const facts = h('div');
  // On a wide screen the gauges sit on the stage, in the empty studio above the car. On a phone they stay in the sheet.
  const hud = h('div.run-hud', {hidden: true, 'aria-label': 'Instruments'});
  const instBlock = block('Instruments');
  // The suspension and steering solve, row by row: the numbers that pose the parts. The rows exist only while open.
  const solvedRows = h('dl.facts');
  const solved = h('details.run-solved', {ontoggle: () => { if (solved.open) readChassis(app.sim); }}, [
    h('summary', ['Geometry solve ', estimate('Solved from hard points estimated off the reference drawings. It shows how the linkage moves. These are not Jaguar settings.')]),
    solvedRows,
  ]);
  const readChassis = (sim) => {
    if (!solved.open || !sim?.chassis) return;
    const rows = chassisReadout(sim.chassis);
    if (solvedRows.childElementCount !== rows.length) solvedRows.replaceChildren(...rows.map((r) => h('div.fact', [h('dt', r.label), h('dd', h('span.num'))])));
    rows.forEach((r, i) => { solvedRows.children[i].querySelector('.num').textContent = `${r.value} ${r.unit}`; });
  };
  document.getElementById('ui').append(hud);
  function placeInstruments() {
    const wide = document.documentElement.classList.contains('layout-rail') && window.innerHeight > SHORT_SCREEN; // a phone on its side has no empty studio: the gauges stay in the rail, off the car
    (wide ? hud : instBlock).append(instruments);
    hud.hidden = !wide || !active;
    instBlock.hidden = wide;
  }
  window.addEventListener('resize', () => { if (active) placeInstruments(); });

  function rebuildInstruments() {
    const sp = spec();
    dial = crankDial(sp.firingOrder);
    instruments.replaceChildren(
      h('div.inst', [h('h4.inst-title', 'Crank angle'), dial, h('p.inst-read', [crankNum, h('span.dash-unit', 'deg')]), camNum]),
      h('div.inst', [h('h4.inst-title', ['Wheel steer ', estimate(`Lock is the estimated constant STEER_MAX_DEG, ${STEER_MAX_DEG} degrees, on the inner wheel. The outer wheel follows from the geometry solve. No figure in the data. It sets the motion only.`)]), steerG, h('p.inst-pair', [h('span', ['L ', steerL]), h('span', ['R ', steerR])]), h('span.inst-sub', 'deg at the road wheel')]),
      h('div.inst', [h('h4.inst-title', ['Wheel travel ', estimate(`Travel is the estimated constant TRAVEL_MM: ${TRAVEL_MM.bump} mm bump and ${TRAVEL_MM.rebound} mm droop. No figure in the data. It sets the motion only.`)]), travelG, h('p.inst-pair', [h('span', ['F ', travelF]), h('span', ['R ', travelR])]), h('span.inst-sub', 'mm from ride height')]),
    );
    const cc = Math.round(displacementCc(sp.boreMm, sp.strokeMm));
    facts.replaceChildren(h('dl.facts', [
      h('div.fact', [h('dt', 'Bore and stroke'), h('dd', [h('span.num', `${sp.boreMm} x ${sp.strokeMm} mm`), specBadge(sp, 'strokeMm', 'Bore and stroke')])]),
      h('div.fact', [h('dt', 'Capacity from those'), h('dd', [h('span.num', `${cc} cc`), specBadge(sp, 'displacementCc', 'Capacity')])]),
      h('div.fact', [h('dt', 'Final drive'), h('dd', [h('span.num', `${sp.finalDrive}:1`), specBadge(sp, 'finalDrive', 'Final drive')])]),
      h('div.fact', [h('dt', 'Gears'), h('dd', [h('span.num', sp.gearRatios.join(', ')), specBadge(sp, 'gearRatios', 'Gear ratios')])]),
      h('div.fact', [h('dt', 'Tyres, rear'), h('dd', [h('span.num', sp.tyresRear), specBadge(sp, 'tyresRear', 'Rear tyres')])]),
      sp.topSpeedMph != null && h('div.fact', [h('dt', 'Top speed on record'), h('dd', [h('span.num', `${sp.topSpeedMph} mph`), specBadge(sp, 'topSpeedMph', 'Top speed')])]),
      h('div.fact', [h('dt', 'Firing order'), h('dd', [h('span.num', sp.firingOrder), badge({conf: data.variants.firing?.conf ?? sp.conf, src: data.variants.firing?.src ?? sp.src, note: data.variants.firing?.note}, {file: 'variants', title: 'Firing order'})])]),
    ]));
  }

  el.append(
    dash,
    h('div.run-watch', [sectionRows, h('span.rng-label', 'Time'), timeSeg]),
    block('Drive', [gearSeg, rpm, throttle, h('p.hint', 'Throttle is a pedal: hold it to rev, let go and it returns.'), speed]),
    block('Chassis', [steer, steerCentre, bumpF, bumpR, solved]),
    block('Roof and panels', [roofRow, coupeNote, h('div.run-btns', opens)]),
    instBlock,
    block('Sound', soundBtn, soundNote),
    block('Figures behind the gauges', facts),
  );

  // ---- running ---------------------------------------------------------------------------------
  function start() {
    base = Math.max(base, IDLE_RPM);
    merge({running: true, rpm: base});
    startBtn.textContent = 'Stop';
    startBtn.setAttribute('aria-pressed', 'true');
  }
  function stop() {
    merge({running: false, rpm: 0, throttle: 0, speedMph: 0});
    throttle.set(0);
    speed.set(0);
    rpm.set(IDLE_RPM);
    startBtn.textContent = 'Start';
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
      pistonNum.textContent = (f.running ? f.meanPistonSpeed : 0).toFixed(1);
    }
    const mph = Math.abs(f.speedMph);
    if (Math.round(mph * 10) !== lastMph) {
      lastMph = Math.round(mph * 10);
      mphNum.textContent = mph.toFixed(0);
      kphNum.textContent = `${(mph * 1.609344).toFixed(0)} km/h`;
    }
    const idling = f.running && !f.throttle && r <= IDLE_RPM + 30;
    const word = !f.running ? 'Engine off' : idling ? 'Idling' : 'Running';
    if (stateWord.textContent !== word) stateWord.textContent = word;
    dash.classList.toggle('is-off', !f.running);
    gearNum.textContent = f.gear < 0 ? 'R' : f.gear === 0 ? 'N' : f.gear;
    gearSub.textContent = f.ratio != null ? `${f.ratio}:1` : '';
    if (f.crank !== lastCrank) {
      lastCrank = f.crank;
      crankNum.textContent = Math.round(f.crank);
      camNum.textContent = `cam ${Math.round(f.camDeg)} deg`;
      dial.set(f.crank);
    }
    steerL.textContent = Math.abs(f.steerDeg.left).toFixed(1);
    steerR.textContent = Math.abs(f.steerDeg.right).toFixed(1);
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
        roofBtn.textContent = next ? 'Raise the hood' : 'Lower the hood';
      } else more = true;
    }
    if (s.gear !== shownGear) { shownGear = s.gear; syncRanges(); gearSeg.querySelector('.seg').set(s.gear); }
    // The sliders say what the dash says: both read the live frame, and the rpm is not rounded to the slider's step.
    const live = app.sim;
    if (document.activeElement !== speed.input) speed.set(s.running ? Math.abs(live?.speedMph ?? s.speedMph) : 0);
    if (document.activeElement !== rpm.input) {
      rpm.set(s.running ? s.rpm : IDLE_RPM);
      if (s.running) rpm.querySelector('.rng-value').textContent = `${Math.round(live?.rpm ?? s.rpm)} rpm`;
    }
    readouts(app.sim);
    readChassis(app.sim);
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
  }, ['mode', 'variant']);
  if (get().mode === 'run') enter();
}
