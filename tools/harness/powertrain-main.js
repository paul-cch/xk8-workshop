// Stand-alone harness: the real stage, pose and registry with only the powertrain modules.
// Built and driven by tools/harness-powertrain.mjs. window.__h exposes the same objects as window.__xk8.
import {carDims, data, loadData, specFor} from '../../src/data.js';
import {store} from '../../src/state.js';
import * as engine from '../../src/car/engine.js';
import * as driveline from '../../src/car/driveline.js';
import {lookMaterials, materials} from '../../src/car/materials.js';
import {registry} from '../../src/car/registry.js';
import {advanceClock, newClock} from '../../src/sim/kin.js';
import {createCameraRig} from '../../src/stage/camera.js';
import {createPicker} from '../../src/stage/pick.js';
import {applyPose, pose, preparePose} from '../../src/stage/pose.js';
import {createStage} from '../../src/stage/stage.js';

const MODULES = [engine, driveline];

async function boot() {
  await loadData();
  registry.setData(data.parts);
  const stage = createStage(document.getElementById('stage'), {tier: 'high'});
  stage.scene.add(registry.root);
  const v = store.get().variant;
  const ctx = {registry, data, materials, variant: v, spec: specFor(v), dims: carDims(v), views: null};
  for (const m of MODULES) { m.build(ctx); }
  preparePose(registry);
  const rig = createCameraRig({stage, registry, store, dims: ctx.dims});
  ctx.views = rig.views;
  const pick = createPicker({stage, registry, store, rig});
  pick.index();
  const clock = newClock();
  const app = {store, data, stage, rig, pick, registry, ctx, clock, sim: null, pose: null};
  stage.onFrame((dt) => {
    const s = store.get();
    const turning = advanceClock(clock, ctx.spec, s.sim, dt);
    const result = pose(s, clock, ctx);
    const {moving, moved} = applyPose(result, registry, s, 0);
    let changed = moved;
    for (const m of MODULES) if (m.update?.(result.sim)) changed = true;
    if (changed) stage.markShadows();
    app.sim = result.sim;
    app.pose = result;
    const flying = rig.update(dt);
    pick.update();
    return turning || moving || flying;
  });
  store.subscribe(() => stage.invalidate());
  store.subscribe((s) => { ctx.spec = specFor(s.variant); }, ['variant']);
  rig.setView('hero', {instant: true});
  await stage.warm(lookMaterials());
  stage.invalidate();
  const nextFrame = () => new Promise(requestAnimationFrame);
  app.settle = async (timeout = 4000) => {
    const end = performance.now() + timeout;
    await nextFrame();
    for (let quiet = 0; quiet < 3 && performance.now() < end;) { await nextFrame(); quiet = stage.busy ? 0 : quiet + 1; }
    await new Promise((r) => setTimeout(r, 200));
    await nextFrame();
  };
  app.report = () => registry.report();
  document.getElementById('boot')?.remove();
  window.__h = app;
}

boot().catch((e) => {
  console.error(e);
  document.body.append(`harness failed: ${e.message}`);
  window.__hErr = e.stack;
});
