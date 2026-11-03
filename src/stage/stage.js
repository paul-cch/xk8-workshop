// The stage: renderer, light studio, floor shadow, post and quality tiers. It renders on demand: call invalidate() when
// anything changed, and return true from an onFrame callback to keep frames coming. A still car costs nothing.
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {GTAOPass} from 'three/addons/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {LAYER} from '../car/registry.js';
import {createFloor} from './floor.js';
import {warmComposer, warmUp} from './warm.js';

/** Best first. ao: 'always', 'rest' (the frame after motion stops) or 'off'. sun is the shadow map size, 0 for none. */
export const TIERS = [
  {name: 'high', pr: 2, composer: true, samples: 4, ao: 'rest', sun: 2048},
  {name: 'med', pr: 1.5, composer: true, samples: 4, ao: 'rest', sun: 1024},
  {name: 'low', pr: 1.5, composer: false, samples: 0, ao: 'off', sun: 0},
  {name: 'min', pr: 1, composer: false, samples: 0, ao: 'off', sun: 0},
];
const BUDGET_MS = 34; // median frame interval above this, about 30 fps, drops a tier
const WINDOW = 36; // frames in the measurement
const BAY_LAMP = 1.9;
const STUDIO = {strip: 9, band: 12}; // radiance of the overhead strips and the wall's foot: paper white is 1
const ENV_SIZE = {fine: 512, phone: 256}; // the reflection map's face: paint reflections are as sharp as this, and a phone pays four times less
// Neutral tone mapping takes the darkest channel off all three, which on a dark green paint means no red at all. Keep a quarter of it.
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;', 'float offset = 0.25 * ( x < 0.08 ? x - 6.25 * x * x : 0.04 );');
export const BACKDROP = {top: '#f4f5f6', mid: '#eceef0', low: '#e2e4e7'};
const BACKDROP_DARK = {top: '#1f2124', mid: '#18191c', low: '#121315'}; // the dark page: the studio dims, the car's lights stay

const backdrop = (tone) => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, tone.top);
  gr.addColorStop(0.58, tone.mid);
  gr.addColorStop(1, tone.low);
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

// A studio built to read on paint. Clearcoat mirrors only 4 percent of what it faces, so what it mirrors has to be far brighter
// than paper white to show on dark paint: this studio is dim, with an HDR band of pale wall rising from a dark floor and thin
// HDR strips overhead. The floor's crisp edge is the horizon that falls along the door. No strip runs down the centreline: on
// a double-curved roof it pinches to an hourglass. The strips are crisp across and soft only at their ends. The hemisphere
// light and the sun carry the diffuse look, so cream leather and engines stay readable.
function softEdge(end = 0.5, across = 0.06) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const u = Math.abs(x / 63.5 - 1), v = Math.abs(y / 63.5 - 1);
    const edge = (t, w) => { const k = Math.min(1, Math.max(0, (1 - t) / w)); return k * k * (3 - 2 * k); };
    const a = edge(u, end) * edge(v, across) * 255;
    img.data.set([a, a, a, 255], (y * 128 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function environment(renderer, size = 256) {
  const env = new THREE.Scene();
  env.background = new THREE.Color('#34373b');
  const strip = softEdge();
  const geos = [], mats = [];
  const box = (w, h, pos, k) => {
    const geo = new THREE.PlaneGeometry(w, h), mat = new THREE.MeshBasicMaterial({color: new THREE.Color('#ffffff').multiplyScalar(k), map: strip, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false});
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.lookAt(0, 0.5, 0);
    env.add(m);
    geos.push(geo); mats.push(mat);
  };
  // Overhead: two long strips off the centreline, a fainter pair outboard, and one across for the bonnet.
  for (const z of [2.3, -2.3]) box(26, 0.34, [0, 9, z], STUDIO.strip);
  for (const z of [5.8, -5.8]) box(26, 0.5, [0, 8.2, z], STUDIO.strip * 0.6);
  // A band of pale wall above the floor, brightest at its foot. Its lower edge is the horizon that runs along the door.
  const rows = 28, bandGeo = new THREE.CylinderGeometry(50, 50, 16, 64, rows, true), bandPos = bandGeo.attributes.position, tint = new Float32Array(bandPos.count * 3);
  for (let i = 0; i < bandPos.count; i++) { const u = (bandPos.getY(i) + 8) / 16, k = STUDIO.band * Math.exp(-u * 13) + 0.55 * (1 - u) ** 2; tint.set([k, k, k * 1.02], i * 3); }
  bandGeo.setAttribute('color', new THREE.BufferAttribute(tint, 3));
  const bandMat = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false});
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.position.y = 8;
  env.add(band);
  geos.push(bandGeo); mats.push(bandMat);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshBasicMaterial({color: '#17181b', side: THREE.DoubleSide}));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  env.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0, 0.05, 80, {size}).texture;
  pm.dispose();
  strip.dispose();
  for (const o of [...geos, ...mats, ground.geometry, ground.material]) o.dispose();
  return tex;
}

export function createStage(canvas, {tier = null} = {}) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance', stencil: false});
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false; // counts stay whole-frame, across every pass

  const scene = new THREE.Scene();
  scene.background = backdrop(document.documentElement.classList.contains('dark') && !document.documentElement.classList.contains('garage') ? BACKDROP_DARK : BACKDROP);
  const envSize = matchMedia('(pointer: coarse)').matches ? ENV_SIZE.phone : ENV_SIZE.fine;
  scene.environment = environment(renderer, envSize);
  scene.environmentIntensity = 0.95;

  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.05, 110);
  camera.layers.enable(LAYER.GLASS);
  camera.layers.enable(LAYER.GHOST);
  const aoCamera = camera.clone(); // sees solids only, so ghosts, glass and the floor never add occlusion

  const sun = new THREE.DirectionalLight('#fff6ea', 1.5);
  sun.position.set(2.6, 7.5, 3.4);
  Object.assign(sun.shadow.camera, {left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 2, far: 14});
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.012;
  scene.add(sun, sun.target);
  sun.target.position.set(0, 0.4, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#a9adb3', 0.75));
  for (const x of [1, -1]) { // low fill at each end: plates, lamps and bumpers face away from the sun
    const fill = new THREE.DirectionalLight('#ffffff', 0.9);
    fill.position.set(x * 7, 2.6, x * 1.5);
    scene.add(fill, fill.target);
  }
  const under = new THREE.DirectionalLight('#eef1f4', 1.1); // the inspection lamp: the underside is half of what a job looks at
  under.position.set(-1.5, -6, 1);
  scene.add(under, under.target);

  const bayFill = new THREE.PointLight('#fff6ec', 0, 3, 1.3); // a lead lamp hung under the open bonnet: the bay is otherwise black beside the photos
  bayFill.position.set(1.32, 1.42, 0);
  scene.add(bayFill);

  const floor = createFloor(renderer, scene);

  // ---- size and view ------------------------------------------------------------------------
  const size = {w: 1, h: 1};
  const insets = {top: 0, right: 0, bottom: 0, left: 0};
  const fitFns = new Set(); // run when the free area changes
  let composer = null, gtao = null, tierIndex = 0, tierLocked = false;

  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, TIERS[tierIndex].pr);
  const applyView = () => {
    const dx = (insets.left - insets.right) / 2, dy = (insets.top - insets.bottom) / 2;
    camera.aspect = size.w / size.h;
    if (dx || dy) camera.setViewOffset(size.w, size.h, -dx, -dy, size.w, size.h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  function resize() {
    const r = canvas.getBoundingClientRect();
    size.w = Math.max(1, Math.round(r.width));
    size.h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(size.w, size.h, false);
    if (composer) {
      composer.setPixelRatio(pixelRatio());
      composer.setSize(size.w, size.h);
    }
    applyView();
    for (const fn of fitFns) fn();
    invalidate();
  }

  const ensureComposer = () => {
    if (composer) return;
    const rt = new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 4});
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, aoCamera, 4, 4);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({radius: 0.09, distanceExponent: 1.4, thickness: 1, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false});
    gtao.updatePdMaterial({lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12});
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  };

  function setTier(next) {
    tierIndex = Math.max(0, Math.min(TIERS.length - 1, next));
    const t = TIERS[tierIndex];
    if (t.composer) ensureComposer();
    if (t.sun) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(t.sun, t.sun);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      renderer.shadowMap.needsUpdate = true;
    } else sun.castShadow = false;
    // Without the composer, blending and the backdrop happen in sRGB instead of linear: these keep the tiers looking alike.
    floor.setStrength(t.composer ? 1.3 : 0.72);
    scene.backgroundIntensity = t.composer ? 1 : 0.93;
    frames.length = 0;
    skip = 12;
    resize();
  }

  // ---- frame loop ---------------------------------------------------------------------------
  const frameFns = new Set();
  const frames = [];
  let raf = 0, last = 0, skip = 0, restTimer = 0, restPending = false, atRest = false, shadowDirty = true, shadowAt = 0, framesDrawn = 0;
  let held = false; // while the car is built behind the loading cover: no frame is drawn, so none is wasted on half a car

  function invalidate() {
    clearTimeout(restTimer);
    restPending = false;
    atRest = false;
    if (!raf && !held) raf = requestAnimationFrame(frame);
  }
  /** After a part moves: the floor shadow and the sun's map redraw, at most five times a second. */
  const markShadows = () => { shadowDirty = true; };

  function draw() {
    const t = TIERS[tierIndex];
    if (shadowDirty && (atRest || performance.now() - shadowAt > 200)) {
      floor.bake();
      if (t.sun) renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
      shadowAt = performance.now();
    }
    renderer.info.reset();
    if (t.composer) {
      gtao.enabled = t.ao === 'always' || (t.ao === 'rest' && atRest);
      if (gtao.enabled) {
        aoCamera.copy(camera);
        aoCamera.layers.set(LAYER.SOLID);
      }
      composer.render();
    } else renderer.render(scene, camera);
    framesDrawn++;
  }

  function measure(dtMs) {
    if (tierLocked || tierIndex >= TIERS.length - 1) return;
    if (skip > 0) { skip--; return; }
    frames.push(dtMs);
    if (frames.length < WINDOW) return;
    const median = [...frames].sort((a, b) => a - b)[WINDOW >> 1];
    frames.length = 0;
    if (median > BUDGET_MS) setTier(tierIndex + 1);
  }

  function frame(now) {
    raf = 0;
    const gap = now - last;
    const continuous = gap < 250 && last > 0;
    const dt = continuous ? gap / 1000 : 1 / 60;
    last = now;
    let more = false;
    for (const fn of frameFns) if (fn(dt, now)) more = true;
    draw();
    if (more) {
      if (continuous) measure(gap);
      invalidate();
    } else {
      restPending = true;
      restTimer = setTimeout(() => {
        restPending = false;
        const t = TIERS[tierIndex];
        if (t.ao === 'rest' || shadowDirty) { atRest = true; draw(); }
      }, 140);
    }
  }

  const v = new THREE.Vector3();
  /** World point to CSS pixels on the canvas. front is false when the point is behind the camera. */
  const project = (p) => {
    v.set(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z).project(camera);
    return {x: (v.x * 0.5 + 0.5) * size.w, y: (-v.y * 0.5 + 0.5) * size.h, front: v.z < 1};
  };

  /** Compiles every program in parallel, so the first frame does not freeze. extra: more materials, the looks. */
  async function warm(extra = []) {
    const lookJob = {materials: extra, target: null, lights: scene, override: true};
    if (TIERS[tierIndex].composer) {
      const on = gtao.enabled;
      gtao.enabled = true;
      await warmComposer(renderer, composer, scene, camera, [{...lookJob, target: composer.renderTarget1}]);
      gtao.enabled = on;
    } else await warmUp(renderer, camera, [{scene, target: null}, lookJob]);
  }

  // Phones drop the context when backgrounded. three.js restores programs and textures, but what was rendered into targets
  // is gone: the environment map, without which paint goes black, and the floor shadow.
  canvas.addEventListener('webglcontextrestored', () => {
    scene.environment?.dispose();
    scene.environment = environment(renderer, envSize);
    shadowDirty = true;
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  });

  new ResizeObserver(resize).observe(canvas);
  const initial = tier ? TIERS.findIndex((t) => t.name === tier) : matchMedia('(pointer: coarse)').matches ? 2 : 0;
  tierLocked = !!tier && initial >= 0;
  setTier(initial >= 0 ? initial : 0);

  return {
    renderer, scene, camera, sun, size, insets,
    /** How far the bonnet is open, 0 to 1. */
    setBayLamp(k) { bayFill.intensity = BAY_LAMP * k; },
    /** The backdrop behind the car, for the dark or light page. */
    setDark(on) { scene.background?.dispose?.(); scene.background = backdrop(on ? BACKDROP_DARK : BACKDROP); floor.setInk(on ? '#000000' : '#20262c'); invalidate(); },
    invalidate, markShadows, project, resize, warm, setTier,
    /**
     * Holds frames while on is true, then draws one with a fresh floor shadow. The boot holds them while it builds the car
     * under its cover: every frame drawn there would link programs one by one and bake the shadow of an unfinished car.
     */
    hold(on) {
      held = on;
      if (on) { cancelAnimationFrame(raf); raf = 0; return; }
      shadowDirty = true;
      invalidate();
    },
    /** fn(dt, now) runs before each frame. Return true to keep frames coming. Returns the unsubscribe function. */
    onFrame(fn) { frameFns.add(fn); invalidate(); return () => frameFns.delete(fn); },
    /** Pixels the UI covers on each side. The car centres in what is left. */
    setInsets(next) { Object.assign(insets, next); applyView(); for (const fn of fitFns) fn(); invalidate(); },
    /** fn runs whenever the free area changes size. The camera rig uses it to keep a named view fitted. */
    onFit(fn) { fitFns.add(fn); return () => fitFns.delete(fn); },
    /** GTAO on or off, for comparisons. The tier sets it again on the next frame unless locked off here. */
    get gtao() { return gtao; },
    get tier() { return TIERS[tierIndex].name; },
    /** True while a frame is queued or a settling frame is due. */
    get busy() { return raf !== 0 || restPending; },
    stats: () => ({tier: TIERS[tierIndex].name, framesDrawn, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length}),
  };
}
