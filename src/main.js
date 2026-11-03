// Boot only: load the data, build the stage and the car, wire the frame loop, hand over to the UI.
import * as THREE from 'three';
import {applies, carDims, data, jobSteps, loadData, setProvenanceCar, specFor, translateData} from './data.js';
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

  if (gl) stage.onFrame((dt) => {
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
  });
  store.subscribe(() => stage.invalidate());
  setProvenanceCar(store.get().variant);
  store.subscribe((s) => { ctx.spec = specFor(s.variant); setProvenanceCar(s.variant); }, ['variant']);

  rig.setView(store.get().view ?? 'hero', {instant: true});
  mark('wired');
  await stage.warm(lookMaterials());
  mark('warm');
  mount(document.getElementById('ui'), app);
  mark('ui');
  if (gl) stage.hold(false); else stage.invalidate();

  const cover = document.getElementById('boot');
  cover.classList.add('gone');
  setTimeout(() => cover.remove(), 500);
  exposeDebug(app);
  const steps = () => marks.map(([n, t], i) => [n, Math.round(t - (marks[i - 1]?.[1] ?? 0))]);
  window.__xk8.bootMarks = steps();
  // and the first frame of the finished car, which tools/perf.mjs reads after it has settled
  requestAnimationFrame(() => requestAnimationFrame(() => { mark('frame'); window.__xk8.bootMarks = steps(); }));
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
