// Tap and hover picking on the GPU: the scene is drawn once into a single pixel with each mesh's id as its colour, so the
// cost does not grow with triangles, and the one-pixel frustum culls almost every part before it reaches the driver.
// Also the leader labels: part names projected to the screen, with a line back to the part.
import * as THREE from 'three';
import {LAYER} from '../car/registry.js';
import {partName} from '../data.js';

const TAP_PX = 6, TAP_MS = 400, HOVER_MS = 60;
const SVG = 'http://www.w3.org/2000/svg';

export function createPicker({stage, registry, store, rig}) {
  const {renderer, scene, camera} = stage;
  const canvas = renderer.domElement;

  const target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true});
  const cam = camera.clone();
  const ids = []; // 1-based index in the colour to part id
  const code = new WeakMap();
  const idMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {id: {value: new THREE.Vector3()}},
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader: 'uniform vec3 id; void main() { gl_FragColor = vec4(id, 1.0); }',
  });
  idMat.onBeforeRender = (r, s, c, g, object) => {
    const n = code.get(object) ?? 0;
    idMat.uniforms.id.value.set((n & 255) / 255, ((n >> 8) & 255) / 255, ((n >> 16) & 255) / 255);
    idMat.uniformsNeedUpdate = true;
  };

  /** Call once after every build(): numbers the meshes. */
  function index() {
    ids.length = 0;
    for (const part of registry.all()) {
      ids.push(part.id);
      for (const inst of part.instances) for (const m of inst.meshes) code.set(m, ids.length);
    }
  }

  /** The part id under a CSS pixel on the canvas, or null. Ghosts and x-ray skins are not on the pick layers. */
  async function pickAt(x, y) {
    const view = camera.view;
    cam.copy(camera);
    cam.layers.set(LAYER.SOLID);
    cam.layers.enable(LAYER.GLASS);
    const {w, h} = stage.size;
    cam.setViewOffset(w, h, (view?.enabled ? view.offsetX : 0) + Math.floor(x), (view?.enabled ? view.offsetY : 0) + Math.floor(y), 1, 1);
    cam.updateMatrixWorld();
    const bg = scene.background, over = scene.overrideMaterial;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    scene.background = null;
    scene.overrideMaterial = idMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    scene.background = bg;
    scene.overrideMaterial = over;
    renderer.setClearColor(color, alpha);
    const px = new Uint8Array(4);
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, px);
    const n = px[0] | (px[1] << 8) | (px[2] << 16);
    return n ? ids[n - 1] ?? null : null;
  }

  // ---- pointer ------------------------------------------------------------------------------
  let down = null, busy = false, lastHover = 0, lastTap = {id: null, t: 0};
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => { down = {x: e.clientX, y: e.clientY, t: performance.now(), button: e.button}; });
  canvas.addEventListener('pointerup', async (e) => {
    const d = down;
    down = null;
    if (!d || d.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX || performance.now() - d.t > TAP_MS) return;
    const id = await pickAt(...local(e));
    const now = performance.now();
    if (id && lastTap.id === id && now - lastTap.t < 350) rig?.flyToPart(id);
    lastTap = {id, t: now};
    store.set({selected: id});
  });
  canvas.addEventListener('pointermove', async (e) => {
    if (e.pointerType !== 'mouse' || down || busy) return;
    const now = performance.now();
    if (now - lastHover < HOVER_MS) return;
    lastHover = now;
    busy = true;
    const id = await pickAt(...local(e));
    busy = false;
    if (!down) {
      canvas.style.cursor = id ? 'pointer' : '';
      store.set({hover: id});
    }
  });
  canvas.addEventListener('pointerleave', () => store.set({hover: null}));
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Escape') store.set({selected: null}); });

  // ---- leader labels ------------------------------------------------------------------------
  const layer = document.createElement('div');
  layer.className = 'labels';
  layer.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG, 'svg');
  layer.append(svg);
  canvas.after(layer);
  let items = []; // {id or point, text, node, line, dot}
  let auto = true;

  const clear = () => {
    for (const it of items) { it.node.remove(); it.line.remove(); it.dot.remove(); }
    items = [];
  };
  const makeLabel = (spec) => {
    const node = document.createElement('div');
    node.className = `label${spec.accent ? ' accent' : ''}`;
    node.textContent = spec.text;
    layer.append(node);
    const line = document.createElementNS(SVG, 'line');
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', 3.5);
    if (spec.accent) { line.classList.add('accent'); dot.classList.add('accent'); }
    svg.append(line, dot);
    return {...spec, node, line, dot, w: 0, h: 0};
  };

  /** Replaces the labels. Each is {id, text, accent} or {point: [x,y,z], text, accent}. Text defaults to the part name. */
  function setLabels(list) {
    clear();
    items = list.map((l) => makeLabel({...l, text: l.text ?? partName(l.id)}));
    place();
    stage.invalidate();
  }

  function place() {
    if (!items.length) return;
    const {w, h} = stage.size, {top, right, bottom, left} = stage.insets;
    const midX = left + (w - left - right) / 2;
    const rows = [];
    for (const it of items) {
      let world = it.point;
      if (it.id) {
        const inst = registry.nearest(it.id, camera.position);
        if (!inst) { it.node.hidden = true; it.line.style.display = it.dot.style.display = 'none'; continue; }
        const b = registry.currentBox(inst);
        world = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
      }
      const p = stage.project(world);
      const hide = !p.front;
      it.node.hidden = hide;
      it.line.style.display = it.dot.style.display = hide ? 'none' : '';
      if (hide) continue;
      if (!it.w) { it.w = it.node.offsetWidth; it.h = it.node.offsetHeight; }
      const side = p.x <= midX ? -1 : 1;
      rows.push({it, p, side, x: side < 0 ? Math.max(left + 12, p.x - it.w - 64) : Math.min(w - right - it.w - 12, p.x + 64), y: p.y - 76 - it.h / 2});
    }
    rows.sort((a, b) => a.y - b.y);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      r.y = Math.max(top + 10, Math.min(h - bottom - r.it.h - 10, r.y));
      for (let j = 0; j < i; j++) if (rows[j].side === r.side && r.y < rows[j].y + rows[j].it.h + 6) r.y = rows[j].y + rows[j].it.h + 6;
    }
    for (const side of [-1, 1]) { // a stack that ran past the free area comes back up, so no label ends under the view bar
      let limit = h - bottom - 10;
      for (const r of rows.filter((q) => q.side === side).reverse()) { if (r.y + r.it.h > limit) r.y = limit - r.it.h; limit = r.y - 6; }
    }
    for (const {it, p, x, y, side} of rows) {
      it.node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      it.line.setAttribute('x1', p.x);
      it.line.setAttribute('y1', p.y);
      it.line.setAttribute('x2', side < 0 ? x + it.w : x);
      it.line.setAttribute('y2', y + it.h / 2);
      it.dot.setAttribute('cx', p.x);
      it.dot.setAttribute('cy', p.y);
    }
  }

  const syncAuto = (s) => {
    if (!auto) return;
    const list = [];
    if (s.selected && registry.has(registry.resolve(s.selected).id)) list.push({id: registry.resolve(s.selected).id, text: partName(s.selected), accent: true});
    if (s.hover && s.hover !== s.selected) list.push({id: s.hover});
    setLabels(list);
  };
  store.subscribe(syncAuto, ['selected', 'hover']);

  return {
    index, pickAt, setLabels,
    /** Runs every frame, after the camera. */
    update: place,
    /** false hands the labels to you: call setLabels yourself. true labels the selected and hovered parts. */
    setAutoLabels(on) { auto = on; if (on) syncAuto(store.get()); },
  };
}
