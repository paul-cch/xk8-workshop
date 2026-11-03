// Boot only: load the data, build the stage and the car, wire the frame loop, hand over to the UI.
import * as THREE from 'three';
import {applies, carDims, data, forVariant, jobSteps, loadData, setProvenanceCar, specFor, translateData} from './data.js';
import {getLang, loadFrench, t, useLanguage} from './i18n.js';
import {clearSaved, connectHash, connectStorage, parseHash, store} from './state.js';
import {buildCar, startSurfaces, updateCar} from './car/index.js';
import {setDetail} from './car/kit.js';
import {lookMaterials, materials} from './car/materials.js';
import {registry} from './car/registry.js';
import {advanceClock, newClock} from './sim/kin.js';
import {createCameraRig, namedViews} from './stage/camera.js';
import {createPicker} from './stage/pick.js';
import {applyPose, pose, preparePose} from './stage/pose.js';
import {createStage} from './stage/stage.js';
import {createTunnel} from './stage/tunnel.js';
import {mount} from './ui/shell.js';

/** The loader's cover says what it is doing, so a slow phone never looks stuck. */
const say = (text) => { const n = document.querySelector('#boot .boot-text'); if (n) n.textContent = text; };

/**
 * The one way the language changes. French loads first, so nothing renders half translated, then the data swaps in place and
 * store.lang tells everything else to repaint. If French cannot load, the page stays in English and says so.
 */
let langTurn = 0;
async function setLang(next) {
  const turn = ++langTurn;
  const ok = next !== 'fr' || await loadFrench();
  if (turn !== langTurn) return; // a later press won
  const lang = ok ? next : 'en';
  if (lang !== getLang()) { useLanguage(lang); translateData(); }
  store.set({lang, ...(ok ? null : {notice: t('French could not be loaded, so the page stays in English.')})});
}

/** A real context, not just the constructor: the constructor exists on machines that cannot create one. */
function canDraw() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

/** Stands in for the stage, camera and picker when there is no WebGL. Every list and number in the panels still works. */
function withoutGpu(ctx) {
  const noop = () => {};
  const stage = {
    renderer: {domElement: document.getElementById('stage')}, size: {w: innerWidth, h: innerHeight}, insets: {top: 0, right: 0, bottom: 0, left: 0}, tier: 'none', busy: false,
    invalidate: noop, markShadows: noop, resize: noop, warm: async () => {}, setTier: noop, project: () => ({x: 0, y: 0, front: false}), onFrame: () => noop, onFit: () => noop, stats: () => ({}),
    setInsets(next) { Object.assign(stage.insets, next); },
  };
  const rig = {views: namedViews(ctx.dims), pose: {az: 0, el: 0, dist: 1, x: 0, y: 0, z: 0}, target: {x: 0, y: 0, z: 0}, update: () => false, setView: noop, flyToPart: () => false, fly: noop, addView: noop};
  const pick = {index: noop, pickAt: async () => null, setLabels: noop, setAutoLabels: noop, update: noop};
  return {stage, rig, pick};
}

async function boot() {
  const marks = [['start', performance.now()]];
  const mark = (name) => marks.push([name, performance.now()]);
  setDetail(matchMedia('(pointer: coarse)').matches ? 0.6 : 1);
  // The body surface is sampled in workers from here, while the data loads and the rest of the car builds.
  const surfaces = startSurfaces(globalThis.__xk8SurfaceWorker);
  await loadData();
  mark('data');
  registry.setData(data.parts);
  connectStorage(store);
  const wanted = parseHash(location.hash).lang ?? store.get().lang;
  connectHash(store, window, setLang);
  await setLang(wanted);

  const v = store.get().variant;
  // A plain first screen builds this car's forms of each part, and the other cars' forms wait until it is on screen
  // (finishCar). A link to a part, a job or a look builds every form first: its bounds and explode vectors span them all.
  const s0 = store.get();
  if (s0.mode === 'explore' && !s0.job && !s0.selected && !s0.isolate && !s0.explode && !s0.xray && !s0.locate && !Object.keys(s0.systems ?? {}).length) registry.deferWhen((opts) => !opts.variant(v));
  const ctx = {registry, data, materials, variant: v, spec: specFor(v), dims: carDims(v), views: null};
  let gl = canDraw();
  let stage = null;
  if (gl) {
    try { stage = createStage(document.getElementById('stage'), {tier: new URLSearchParams(location.search).get('tier')}); } catch (e) { console.warn(e); gl = false; }
  }
  if (gl) { stage.scene.add(registry.root); stage.hold(true); } // no frames until the car is whole: the cover hides them anyway
  mark('stage');
  // The car is built with or without a GPU: the parts list reads what is modelled from it.
  await buildCar(ctx, (done) => say(t('Building the car, {n} percent', {n: Math.round(done * 100)})), mark, surfaces);
  mark('car');
  registry.deferWhen(null);
  // The first screen's hot spots, shown until a car is chosen, sit on the bounds of every form of this car's weak spots'
  // parts. A part already longer than HOT_MAX_M in src/ui/shell.js never gets one, and more forms only make it longer.
  if (!s0.chosen) {
    const size = new THREE.Vector3();
    const small = (id) => { const b = registry.partBox(id); return !b || b.isEmpty() || Math.max(...b.getSize(size).toArray()) < 1.2; };
    registry.fill(Infinity, new Set(forVariant(data.weakspots.items, v).flatMap((w) => w.parts ?? []).filter(small)));
  }
  mark('hot-spots');
  say(t('Starting up'));
  preparePose(registry);

  const stand = gl ? null : withoutGpu(ctx);
  stage ??= stand.stage;
  const rig = gl ? createCameraRig({stage, registry, store, dims: ctx.dims}) : stand.rig;
  ctx.views = rig.views;
  const pick = gl ? createPicker({stage, registry, store, rig}) : stand.pick;
  pick.index();

  const tunnel = gl ? createTunnel(registry) : null;
  const clock = newClock();
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const app = {store, data, stage, rig, pick, registry, ctx, clock, tunnel, sim: null, pose: null, noGL: !gl, setLang};

  const step = (dt) => {
    const s = store.get();
    const turning = advanceClock(clock, ctx.spec, s.sim, dt);
    const flying = rig.update(dt);
    const result = pose(s, clock, ctx);
    const sight = result.inJob || (s.locate && result.focus.length) ? tunnel.find(stage.camera.position, result.focus, rig.target) : null;
    const {moving, moved} = applyPose(result, registry, s, calm.matches ? 0 : dt, sight);
    stage.setBayLamp(result.sim.open.bonnet);
    const again = !!sight && moved; // the sightline was found before this move: find it once more where things ended up
    if (updateCar(result.sim) || moved) stage.markShadows();
    app.sim = result.sim;
    app.pose = result;
    pick.update();
    return turning || moving || flying || again;
  };
  if (gl) stage.onFrame(step);
  store.subscribe(() => stage.invalidate());
  setProvenanceCar(store.get().variant);
  store.subscribe((s) => { ctx.spec = specFor(s.variant); setProvenanceCar(s.variant); }, ['variant']);

  const built = finishCar(app);
  rig.setView(store.get().view ?? 'hero', {instant: true});
  mark('wired');
  await stage.warm(lookMaterials());
  mark('warm');
  // Frames are held until now, so pose the car and the camera as one would have: the interface measures both as it mounts
  if (gl) { step(1 / 60); stage.camera.updateMatrixWorld(); }
  mount(document.getElementById('ui'), app);
  mark('ui');
  if (gl) stage.hold(false); else stage.invalidate();

  const cover = document.getElementById('boot');
  cover.classList.add('gone');
  setTimeout(() => cover.remove(), 500);
  requestAnimationFrame(() => requestAnimationFrame(() => mark('frame')));
  await built;
  mark('rest');
  // The tools drive the page through window.__xk8 and read the whole car, so it appears once nothing waits.
  exposeDebug(app);
  window.__xk8.bootMarks = marks.map(([n, t], i) => [n, Math.round(t - (marks[i - 1]?.[1] ?? 0))]);
}

// Store keys that only change words or settings: everything else may need another car's forms, or every form's bounds.
const QUIET = new Set(['hover', 'notice', 'lang', 'langOffered', 'hinted', 'theme', 'garage']);

/**
 * Builds the forms of each part that registry.deferWhen() held back: in short turns after the first frame, or all at
 * once on the first change of state that could need them. That subscription comes before the interface's, so the
 * interface never sees a car with forms missing. Resolves when the car is whole, as the boot would have built it.
 */
function finishCar(app) {
  const {registry, store, stage, pick} = app;
  if (!registry.waiting) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      off();
      registry.fill();
      preparePose(registry);
      pick.index();
      stage.markShadows();
      stage.invalidate();
      resolve();
    };
    const off = store.subscribe((s, changed) => { if ([...changed].some((k) => !QUIET.has(k))) end(); });
    const turn = () => { if (!done) { if (registry.fill(12)) setTimeout(turn, 0); else end(); } };
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(turn, 0)));
  });
}

/** tools/shots.mjs drives the page through this. Small, and useful in the console too. */
function exposeDebug(app) {
  const {stage, rig, store: st} = app;
  const nextFrame = () => new Promise(requestAnimationFrame);
  // Resolves once nothing is moving, or after timeout ms: a running engine never stops, so this must not wait for it.
  const settle = async (timeout = 4000) => {
    const end = performance.now() + timeout;
    await nextFrame();
    for (let quiet = 0; quiet < 3 && performance.now() < end;) {
      await nextFrame();
      quiet = stage.busy ? 0 : quiet + 1;
    }
    await new Promise((r) => setTimeout(r, 220));
    await nextFrame();
  };
  window.__xk8 = Object.assign(app, { // the same object, so sim and pose stay live
    settle,
    /** Measures n frames of continuous orbit: {ms, p95, worst, tier}. */
    async bench(n = 90) {
      const times = [];
      await nextFrame();
      let last = performance.now();
      for (let i = 0; i < n; i++) {
        rig.fly({az: rig.pose.az + 1.2}, 0);
        await nextFrame();
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      const f = (x) => +x.toFixed(1);
      return {ms: f(times.reduce((a, b) => a + b, 0) / n), p95: f(times[Math.floor(n * 0.95)]), worst: f(times[n - 1]), tier: stage.tier, ...stage.stats()};
    },
    report: () => app.registry.report(),
    three: {Raycaster: THREE.Raycaster, Vector3: THREE.Vector3, Box3: THREE.Box3}, // tools/job-walk.mjs, tools/assemble.mjs
    poseAt: (state, raw) => pose(state, app.clock, app.ctx, raw), // pure: where everything would be, without moving anything
    applies,
    jobStepsFor: (id, v) => jobSteps(app.data.jobs.byId.get(id), v).map((s) => ({title: s.title, focus: s.focus, remove: s.remove, install: s.install})),
  });
}

boot().catch((e) => {
  console.error(e);
  const cover = document.getElementById('boot');
  if (!cover) return;
  cover.classList.remove('gone');
  cover.style.zIndex = '50'; // over anything the UI had drawn before it stopped
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'boot-reset';
  reset.textContent = t('Reset saved data and reload');
  reset.addEventListener('click', () => { clearSaved(); location.hash = ''; location.reload(); });
  const words = document.createElement('p');
  words.textContent = t('The workshop did not start: {why}', {why: e.message});
  cover.replaceChildren(words, reset);
});
