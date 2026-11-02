// The orbit rig: drag to orbit, pinch or wheel to zoom, two fingers or right-drag to pan, arrow keys and +/- on the canvas.
// Named views frame a box, so they fit any screen and any inset. flyTo eases there. Input cancels a flight at once.
//
// az is degrees around the car from the nose: 0 front, 90 the car's right (+z), 180 rear, -90 left. el is degrees up.
import * as THREE from 'three';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const EL_MIN = -85, EL_MAX = 88.5, DIST_MIN = 0.3, DIST_MAX = 45; // a phone in portrait needs about 26 m at this lens
const FLIGHT_S = 0.9;
const EXPLODED = {az: 70, el: 8};
const CONTEXT_K = 3.2, CONTEXT_MIN = 0.36; // metres of car kept in frame around a part in a job
const FOCUS_MIN_PX = 40, FOCUS_MIN_DIST = 0.5; // a part in a job is never smaller than this on screen: a phone's strip would otherwise frame the car and lose the bolt
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // close to cubic-bezier(0.65, 0, 0.35, 1)

/** The named views for this car's size. box is [min, max] in metres. open is what pose.js opens for that view. */
export function namedViews(d) {
  const L = d.length / 2, W = d.width / 2, H = d.height, A = d.wheelbase / 2;
  const whole = [[-L, 0, -W], [L, H, W]];
  const wheel = (x, z) => {
    const r = 0.37, tz = (z * (x > 0 ? d.trackF : d.trackR)) / 2;
    return [[x - r, 0, tz - 0.2], [x + r, 2 * r, tz + 0.2]];
  };
  return {
    hero: {az: 42, el: 11, box: whole, fill: 0.98, whole: true},
    side: {az: 90, el: 1.5, box: whole, fill: 0.72, whole: true},
    front: {az: 0, el: 2, box: whole, fill: 0.7, whole: true},
    rear: {az: 180, el: 2, box: whole, fill: 0.7, whole: true},
    top: {az: 90, el: 88, box: whole, fill: 0.74, whole: true},
    underside: {az: 90, el: -80, box: [[-L, 0.1, -W], [L, 0.5, W]], fill: 0.86, whole: true},
    'engine-bay': {az: -104, el: 48, box: [[0.78, 0.44, -0.58], [1.72, 0.86, 0.58]], fill: 0.98, open: {bonnet: 1}}, // over the left wing, as a person leans in: the engine fills it and the screen is behind the camera
    boot: {az: 158, el: 34, box: [[-2.4, 0.5, -0.75], [-1.2, 1.05, 0.75]], fill: 0.72, open: {boot: 1}},
    'wheel-fr': {az: 66, el: 6, box: wheel(A, 1), fill: 0.62},
    'wheel-fl': {az: -66, el: 6, box: wheel(A, -1), fill: 0.62},
    'wheel-rr': {az: 114, el: 6, box: wheel(-A, 1), fill: 0.62},
    'wheel-rl': {az: -114, el: 6, box: wheel(-A, -1), fill: 0.62},
  };
}

export function createCameraRig({stage, registry, store, dims}) {
  const canvas = stage.renderer.domElement;
  const views = namedViews(dims);
  const cur = {az: 42, el: 11, dist: 12, x: 0, y: 0.6, z: 0};
  const goal = {...cur};
  let flight = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scratch = new THREE.Box3();
  const point = new THREE.Vector3(), target = new THREE.Vector3();

  const axes = (az, el) => {
    const a = rad(az), e = rad(el);
    const back = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    const up = new THREE.Vector3().crossVectors(back, right);
    return {back, right, up};
  };

  /** The distance at which a box fills `fill` of the area the UI leaves free. */
  function fitDistance(box, az, el, fill) {
    const {back, right, up} = axes(az, el);
    const h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const span = (n) => 2 * (Math.abs(n.x) * h.x + Math.abs(n.y) * h.y + Math.abs(n.z) * h.z);
    const {w, h: H} = stage.size;
    const {top, right: ir, bottom, left} = stage.insets;
    const freeW = Math.max(40, w - left - ir), freeH = Math.max(40, H - top - bottom);
    // one world unit at distance D covers H / (2 tan(fov/2) D) pixels, the same across and up
    const toDistance = H / (2 * Math.tan(rad(stage.camera.fov / 2)));
    const need = Math.max(span(right) / (freeW * fill), span(up) / (freeH * fill)) * toDistance;
    return need + span(back) * 0.25; // the box has depth: its near face is closer than its centre
  }

  function fly(to, seconds = FLIGHT_S) {
    const next = {...cur, ...to};
    next.az = cur.az + ((((next.az - cur.az) % 360) + 540) % 360) - 180; // the short way round
    if (reduced() || seconds === 0) {
      Object.assign(cur, next);
      Object.assign(goal, next);
      flight = null;
    } else {
      flight = {from: {...cur}, to: next, t: 0, seconds};
    }
    stage.invalidate();
  }

  const boxView = (box, az, el, fill) => {
    const c = box.getCenter(new THREE.Vector3());
    return {az, el, dist: clamp(fitDistance(box, az, el, fill), DIST_MIN, DIST_MAX), x: c.x, y: c.y, z: c.z};
  };

  function setView(name, {instant = false, seconds = FLIGHT_S} = {}) {
    const v = views[name];
    if (!v) return;
    const box = scratch.set(new THREE.Vector3(...v.box[0]), new THREE.Vector3(...v.box[1]));
    if (v.whole) { // the exploded car is bigger than the car: keep all of it in frame
      const e = store.get().explode;
      box.min.x -= e; box.max.x += e;
      box.max.y += 1.5 * e;
      box.min.z -= 0.9 * e; box.max.z += 0.9 * e;
    }
    // Exploded, the hero angle stacks the engine on the cabin: as it opens up the view swings round towards the side.
    const open = v.whole && name === 'hero' ? store.get().explode : 0;
    const az = v.az + (EXPLODED.az - v.az) * open, el = v.el + (EXPLODED.el - v.el) * open;
    fly(boxView(box, az, el, v.fill), instant ? 0 : seconds);
  }

  /**
   * Frames a part where it is now, lifted or not, from outside the car on the side it sits. A part registered with
   * view: {az, el, fill} uses that instead. Paired parts fly to the instance nearest the camera.
   */
  function flyToPart(id, {fill = 0.45, instant = false, minDist = 0, context = 0} = {}) {
    const part = registry.get(id);
    if (!part) return false;
    const inst = registry.nearest(id, stage.camera.position);
    const box = registry.currentBox(inst);
    const own = box.clone();
    if (context) { // frame where it came from as well as where it is, with some car around it
      const big = Math.max(...box.getSize(new THREE.Vector3()).toArray());
      const want = clamp(big * CONTEXT_K, CONTEXT_MIN, context);
      box.union(registry.restBox(inst));
      box.expandByVector(new THREE.Vector3(...['x', 'y', 'z'].map((a) => Math.max(0, want - (box.max[a] - box.min[a])) / 2)));
    }
    const c = box.getCenter(point);
    const s = box.getSize(new THREE.Vector3());
    const pv = part.view ?? {};
    const side = Math.abs(c.z) > 0.12 ? Math.sign(c.z) : Math.sign(Math.sin(rad(cur.az))) || 1;
    const onTop = c.y > 0.62, under = c.y < 0.33 && Math.abs(c.z) < dims.width * 0.42 && Math.abs(c.x) < dims.length * 0.46;
    const az = pv.az ?? deg(Math.atan2(side, clamp(c.x / 1.2, -1.2, 1.2)));
    const el = pv.el ?? (under ? -38 : onTop ? 38 : 12);
    const fit = boxView(box, az, el, context ? fill : pv.fill ?? fill);
    fit.dist = Math.max(fit.dist, minDist, Math.min(1.1, 0.9 + Math.max(s.x, s.y, s.z)));
    if (context) { // the part itself, not the box round it, has to land big enough: come in on it when the free area is a strip
      const {right, up} = axes(az, el), half = own.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const span = (n) => 2 * (Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z);
      const reach = (Math.max(span(right), span(up)) * stage.size.h) / (2 * Math.tan(rad(stage.camera.fov / 2)) * FOCUS_MIN_PX);
      if (fit.dist > reach) {
        fit.dist = Math.max(FOCUS_MIN_DIST, reach);
        own.getCenter(point);
        fit.x = point.x; fit.y = point.y; fit.z = point.z;
      }
    }
    fly(fit, instant ? 0 : FLIGHT_S);
    return true;
  }

  /** Runs every frame. True while the camera is still moving. */
  function update(dt) {
    let moving = false;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.seconds);
      const k = ease(flight.t);
      for (const key of Object.keys(goal)) cur[key] = flight.from[key] + (flight.to[key] - flight.from[key]) * k;
      Object.assign(goal, cur);
      if (flight.t >= 1) flight = null;
      moving = true;
    } else {
      const k = 1 - Math.exp(-dt * 16);
      for (const key of Object.keys(goal)) {
        const d = goal[key] - cur[key];
        if (Math.abs(d) > 1e-4) { cur[key] += d * k; moving = true; } else cur[key] = goal[key];
      }
    }
    const {back} = axes(cur.az, cur.el);
    const cam = stage.camera;
    cam.position.set(cur.x, cur.y, cur.z).addScaledVector(back, cur.dist);
    cam.lookAt(cur.x, cur.y, cur.z);
    const near = clamp(cur.dist * 0.03, 0.02, 1);
    if (Math.abs(near - cam.near) > 1e-4) { cam.near = near; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    return moving;
  }

  // ---- input --------------------------------------------------------------------------------
  const pointers = new Map();
  let pinch = null;
  const touched = () => {
    flight = null;
    if (store.get().view) store.set({view: null});
    stage.invalidate();
  };
  const pan = (dx, dy) => {
    const {right, up} = axes(cur.az, cur.el);
    const scale = (2 * Math.tan(rad(stage.camera.fov / 2)) * goal.dist) / stage.size.h;
    goal.x = clamp(goal.x - right.x * dx * scale + up.x * dy * scale, -6, 6);
    goal.y = clamp(goal.y - right.y * dx * scale + up.y * dy * scale, -2, 4);
    goal.z = clamp(goal.z - right.z * dx * scale + up.z * dy * scale, -6, 6);
  };
  const orbit = (dx, dy) => {
    goal.az += dx * 0.3;
    goal.el = clamp(goal.el + dy * 0.25, EL_MIN, EL_MAX);
  };
  const zoom = (f) => { goal.dist = clamp(goal.dist * f, DIST_MIN, DIST_MAX); };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey});
    pinch = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!dx && !dy) return;
    touched();
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch) {
        zoom(pinch.dist / Math.max(1, dist));
        pan(mx - pinch.mx, my - pinch.my);
      }
      pinch = {dist, mx, my};
    } else if (p.button === 2 || p.button === 1 || p.shift) pan(dx, dy);
    else orbit(dx, dy);
  });
  const lift = (e) => { pointers.delete(e.pointerId); pinch = null; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    touched();
    zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
  }, {passive: false});
  canvas.addEventListener('keydown', (e) => {
    const moves = {ArrowLeft: () => orbit(-30, 0), ArrowRight: () => orbit(30, 0), ArrowUp: () => orbit(0, 24), ArrowDown: () => orbit(0, -24), '+': () => zoom(0.88), '=': () => zoom(0.88), '-': () => zoom(1.14)};
    if (moves[e.key]) { e.preventDefault(); touched(); moves[e.key](); } else if (e.key === 'Home') { e.preventDefault(); store.set({view: 'hero'}); setView('hero'); }
  });

  store.subscribe((s) => { if (s.view) setView(s.view); }, ['view']);
  store.subscribe((s) => { if (s.view && views[s.view]?.whole) setView(s.view, {seconds: 0.3}); }, ['explode']);
  // A named view stays fitted when the window turns or a sheet opens. A view the user has moved away from is left alone.
  stage.onFit(() => { const v = store.get().view; if (v) setView(v, {seconds: 0.25}); });

  return {
    views, update, setView, flyToPart, fly,
    /** Adds or replaces a named view: a module's own close-up. def is {az, el, box: [min, max], fill, open}. */
    addView(name, def) { views[name] = def; },
    /** The current pose of the rig: {az, el, dist, x, y, z}. */
    get pose() { return {...cur}; },
    /** The point the rig looks at. Live: read it, do not keep it. */
    get target() { return target.set(goal.x, goal.y, goal.z); },
  };
}
