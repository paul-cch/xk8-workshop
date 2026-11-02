// What the powertrain modules share: where the engine sits, millimetre wrappers round kit.js, the bank frame, the
// section view's materials and the registration helper. engine.js, engine-bay.js and driveline.js all build on these.
import * as THREE from 'three';
import {box, cylinder, extrude, hose, lathe, part, repeat, tube, xf} from './kit.js';
import {addMaterial} from './materials.js';
import {BANK_OFFSET_MM} from '../sim/kin.js';

/**
 * Crank centre at mid length, car space, metres. Estimated: the strut turrets in engine-bay-xkr-40-sc.jpg stand just ahead
 * of the middle of the cam cover and the front axle is at x = 1.294. y puts the sump pan just above the crossbeam in
 * chassis.js. Fixed by a number against the bonnet: body.js's closed bonnet clears everything here by 25 mm or more.
 */
export const ORIGIN = {x: 1.17, y: 0.4};

export const mm = (v) => v / 1000;
const m3 = (a) => [a[0] / 1000, a[1] / 1000, a[2] / 1000];

// ---- millimetre geometry. Same helpers as kit.js, numbers as they would be on a drawing. ----------
export const bx = (w, h, d, at = [0, 0, 0], bevel = 1.5) => box(w / 1000, h / 1000, d / 1000, {bevel: bevel / 1000, at: m3(at)});
export const cyl = (r, len, at = [0, 0, 0], {axis = 'x', seg: s = 20, inner = 0, chamfer = 0} = {}) => {
  if (chamfer) return cylinder(r / 1000, len / 1000, {axis, seg: s, at: m3(at), inner: inner / 1000, chamfer: chamfer / 1000});
  const h = len / 2000, R = r / 1000, i = inner ? inner / 1000 : 1e-5; // kit.cylinder less its empty chamfer rows, which over a car's worth of parts is 40 percent of the triangles
  const g = lathe(inner ? [[i, -h], [R, -h], [R, h], [i, h], [i, -h]] : [[i, -h], [R, -h], [R, h], [i, h]], {seg: s, axis});
  return g.translate(...m3(at));
};
export const lat = (profile, opts = {}) => lathe(profile.map(([r, y]) => [r / 1000, y / 1000]), opts);
const polyLen = (pts) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0);
const spans = (pts, opts = {}) => ({...opts, seg: opts.seg ?? Math.min(48, Math.max(6, Math.ceil(polyLen(pts) / 45)))}); // a bend needs rings, a straight run does not
export const tb = (pts, r, opts) => tube(pts.map(m3), typeof r === 'function' ? (u) => r(u) / 1000 : r / 1000, spans(pts, opts));
export const hs = (pts, r, opts) => hose(pts.map(m3), r / 1000, opts?.ribs ? opts : spans(pts, opts));
/** Extrusion in mm. outline [[a, b]...], depth, axis as kit.extrude, from is where it starts along that axis. */
export const ex = (outline, depth, {axis = 'x', from = 0, holes = [], bevel = 0, curve = 8} = {}) => {
  const g = extrude(outline.map(([a, b]) => [a / 1000, b / 1000]), depth / 1000, {axis, holes: holes.map((h) => h.map(([a, b]) => [a / 1000, b / 1000])), bevel: bevel / 1000, curve});
  const t = {x: [from / 1000, 0, 0], y: [0, from / 1000, 0], z: [0, 0, from / 1000]}[axis];
  return g.translate(...t);
};
export const circle = (r, cx = 0, cy = 0, n = 24) => Array.from({length: n}, (_, i) => { const a = (i / n) * Math.PI * 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
export const rx = (g, deg) => xf(g, {rot: [(deg * Math.PI) / 180, 0, 0]});
export const ry = (g, deg) => xf(g, {rot: [0, (deg * Math.PI) / 180, 0]});
export const rz = (g, deg) => xf(g, {rot: [0, 0, (deg * Math.PI) / 180]});
export const at = (g, p) => g.translate(...m3(p));
export {repeat};

/**
 * A sprocket or gear blank on the x axis, centred. pitchR in mm. Plain trapezoid teeth, true count: count them against
 * the drawing. hole is the bore radius.
 */
export function sprocket(teeth, pitchR, width, {hole = 0, tooth = 4, sharp = false} = {}) {
  const pts = [], rRoot = pitchR - tooth * 0.6, rTip = pitchR + tooth * 0.55;
  const shape = sharp ? [[rRoot, -0.3], [rTip, 0]] : [[rRoot, -0.32], [rTip, -0.14], [rTip, 0.14], [rRoot, 0.32]]; // sharp: half the points, for a starter ring's 120 teeth
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, d = (Math.PI * 2) / teeth;
    for (const [r, f] of shape) pts.push([r * Math.cos(a + d * f), r * Math.sin(a + d * f)]);
  }
  return ex(pts, width, {from: -width / 2, holes: hole ? [circle(hole)] : []});
}

/** A closed ribbon along a loopPath, a belt. u = -z, v = y, as loopPath sees the front of the engine. */
export function ribbon(path, loopAt, xMid, width, thick, {n = 120} = {}) {
  const pos = [], idx = [];
  const out = {};
  const prof = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i <= n; i++) {
    loopAt(path, (i / n) * path.length, out);
    const nu = -Math.sin(out.a), nv = Math.cos(out.a); // left of travel: the belt's back, the path being its ribbed face
    for (const [a, b] of prof) {
      const off = b * thick;
      pos.push((xMid + (a - 0.5) * width) / 1000, (out.y + nv * off) / 1000, -(out.x + nu * off) / 1000);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + ((j + 1) % 4), c = (i + 1) * 4 + j, d = (i + 1) * 4 + ((j + 1) % 4);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const f = g.toNonIndexed();
  f.computeVertexNormals();
  return f;
}

// ---- the bank frame -----------------------------------------------------------------------------
// Bank local axes: x along the crank, y up the bore from the crank axis, z across the bank. On A local +z is outboard,
// on B it is inboard, so geometry written in w (outboard positive) uses z = out * w.
export const BANK = {
  A: {name: 'A', sign: 1, out: 1, x: BANK_OFFSET_MM / 2, rot: Math.PI / 4},
  B: {name: 'B', sign: -1, out: -1, x: -BANK_OFFSET_MM / 2, rot: -Math.PI / 4},
};
/** A point in a bank's frame (x, y up the bore, w outboard), mm, to engine frame (x, y, z), mm. */
export function fromBank(b, x, y, w) {
  const zl = b.out * w, c = Math.cos(b.rot), s = Math.sin(b.rot);
  return [x + b.x, y * c - zl * s, y * s + zl * c];
}
/** A polygon in (w, y) to the (a, b) that ex(.., {axis: 'x'}) wants on this bank. */
export const wy = (b, pts) => pts.map(([w, y]) => [-b.out * w, y]);
/** A polygon in engine front view (z, y) to the same. */
export const zy = (pts) => pts.map(([z, y]) => [-z, y]);

// ---- raised lettering: cast or painted words, in thin strokes ------------------------------------
const FONT = { // polylines in a unit cell, y up. Only the letters the engine carries.
  J: [[[0.75, 1], [0.75, 0.2], [0.55, 0], [0.2, 0.02], [0.05, 0.22]]],
  A: [[[0.05, 0], [0.5, 1], [0.95, 0]], [[0.25, 0.38], [0.75, 0.38]]],
  G: [[[0.92, 0.8], [0.65, 1], [0.3, 0.98], [0.06, 0.7], [0.06, 0.3], [0.3, 0.02], [0.65, 0], [0.92, 0.2], [0.92, 0.48], [0.55, 0.48]]],
  U: [[[0.08, 1], [0.08, 0.28], [0.3, 0.02], [0.68, 0.02], [0.9, 0.28], [0.9, 1]]],
  R: [[[0.1, 0], [0.1, 1], [0.65, 1], [0.86, 0.8], [0.86, 0.6], [0.65, 0.46], [0.1, 0.46]], [[0.5, 0.46], [0.92, 0]]],
  S: [[[0.9, 0.82], [0.65, 1], [0.3, 1], [0.08, 0.8], [0.15, 0.58], [0.85, 0.42], [0.92, 0.2], [0.7, 0], [0.3, 0], [0.06, 0.18]]],
  P: [[[0.12, 0], [0.12, 1], [0.7, 1], [0.9, 0.8], [0.9, 0.62], [0.7, 0.44], [0.12, 0.44]]],
  E: [[[0.88, 1], [0.12, 1], [0.12, 0], [0.88, 0]], [[0.12, 0.52], [0.72, 0.52]]],
  C: [[[0.92, 0.8], [0.65, 1], [0.3, 0.98], [0.06, 0.7], [0.06, 0.3], [0.3, 0.02], [0.65, 0], [0.92, 0.2]]],
  H: [[[0.1, 0], [0.1, 1]], [[0.9, 0], [0.9, 1]], [[0.1, 0.52], [0.9, 0.52]]],
  D: [[[0.1, 0], [0.1, 1], [0.6, 1], [0.92, 0.7], [0.92, 0.3], [0.6, 0], [0.1, 0]]],
  V: [[[0.05, 1], [0.5, 0], [0.95, 1]]],
  8: [[[0.5, 0.52], [0.18, 0.72], [0.28, 1], [0.72, 1], [0.82, 0.72], [0.18, 0.28], [0.3, 0], [0.7, 0], [0.82, 0.28], [0.5, 0.52]]],
};
/** A word on a flat. p origin of the first letter's foot, u along the text, v up it, n out of the surface, all mm or unit vectors. */
export function strokeText(word, p, u, v, n, {h = 26, w = 20, gap = 6, stroke = 2.6, depth = 1, serif = 0} = {}) {
  const out = [];
  const point = (i, a, b) => [0, 1, 2].map((k) => p[k] + u[k] * (i * (w + gap) + a * w) + v[k] * b * h);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), e3 = new THREE.Vector3(...n).normalize();
  const m = new THREE.Matrix4();
  [...word].forEach((ch, i) => {
    for (const line of FONT[ch] ?? []) for (let k = 0; k < line.length - 1; k++) {
      const a = point(i, ...line[k]), b = point(i, ...line[k + 1]);
      e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const len = e1.length() + stroke * 0.7;
      e1.normalize();
      e2.crossVectors(e3, e1).normalize();
      const g = new THREE.BoxGeometry(len / 1000, stroke / 1000, depth / 1000);
      g.applyMatrix4(m.makeBasis(e1, e2, new THREE.Vector3().crossVectors(e1, e2)));
      g.translate((a[0] + b[0]) / 2000, (a[1] + b[1]) / 2000, (a[2] + b[2]) / 2000);
      g.deleteAttribute('uv');
      out.push(g);
    }
    // cast and painted Jaguar lettering has feet: a short bar across each stroke end on the cap line and the baseline
    if (serif) for (const line of FONT[ch] ?? []) for (const end of [line[0], line.at(-1)]) {
      if (end[1] !== 0 && end[1] !== 1) continue;
      const c = point(i, ...end);
      e1.set(...u).normalize();
      e2.crossVectors(e3, e1).normalize();
      const g = new THREE.BoxGeometry(serif / 1000, (stroke * 0.62) / 1000, depth / 1000);
      g.applyMatrix4(m.makeBasis(e1, e2, new THREE.Vector3().crossVectors(e1, e2)));
      g.translate(c[0] / 1000, c[1] / 1000, c[2] / 1000);
      g.deleteAttribute('uv');
      out.push(g);
    }
  });
  return out;
}

// ---- surface finish ------------------------------------------------------------------------------
let grainMap = null;
/** A small tiling noise map, shared by every finish. Its mips average to nothing, so a finish fades out with distance by itself. */
function grainTexture() {
  if (grainMap) return grainMap;
  const n = 128, data = new Uint8Array(n * n * 4);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let c = 0; c < 3; c++) {
    let f = Float32Array.from({length: n * n}, rand);
    for (let pass = 0; pass < (c === 2 ? 6 : 1); pass++) { // two sharp channels for the normal, one soft for the blotches
      const g = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g[y * n + x] = (f[y * n + x] * 2 + f[y * n + (x + 1) % n] + f[((y + 1) % n) * n + x] + f[y * n + (x + n - 1) % n] + f[((y + n - 1) % n) * n + x]) / 6;
      f = g;
    }
    const lo = Math.min(...f), hi = Math.max(...f);
    for (let i = 0; i < n * n; i++) data[i * 4 + c] = ((f[i] - lo) / (hi - lo)) * 255;
  }
  for (let i = 0; i < n * n; i++) data[i * 4 + 3] = 255;
  grainMap = new THREE.DataTexture(data, n, n);
  grainMap.wrapS = grainMap.wrapT = THREE.RepeatWrapping;
  grainMap.magFilter = THREE.LinearFilter; grainMap.minFilter = THREE.LinearMipmapLinearFilter; grainMap.generateMipmaps = true;
  grainMap.needsUpdate = true;
  return grainMap;
}

/**
 * Writes a cast or wrinkled finish into a shader: noise looked up in object space bends the normal and blotches the colour.
 * No uvs needed. tiles is map repeats per metre: 5 is a grain of about 5 mm, higher is finer.
 */
function applyGrain(shader, {tiles, amount, mottle = 0}) {
  shader.uniforms.uGrainMap = {value: grainTexture()};
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGrainP;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrainP = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vGrainP;
      uniform sampler2D uGrainMap;
      vec2 grainUv() { return (vGrainP.xz + vGrainP.y * vec2(0.37, 0.61)) * ${tiles.toFixed(2)}; }`) // one oblique lookup does for every face
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= 1.0 - ${mottle.toFixed(3)} * texture2D(uGrainMap, grainUv() * 0.31).b;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 a = texture2D(uGrainMap, grainUv()).rg - 0.5, b = texture2D(uGrainMap, grainUv() * 2.3 + 0.37).gr - 0.5;
        normal = normalize(normal + ${amount.toFixed(3)} * vec3(a.x + b.x, a.y, b.y - a.y));
      }`);
}

/** Gives a material that finish. Sections keep it: secMaterial reads userData.grain. */
export function grain(m, {tiles = 5, amount = 0.5, mottle = 0} = {}) {
  m.userData.grain = {tiles, amount, mottle};
  m.onBeforeCompile = (shader) => applyGrain(shader, m.userData.grain);
  m.customProgramCacheKey = () => `xk8-grain-${tiles}-${amount}-${mottle}`;
  return m;
}

// ---- section view -------------------------------------------------------------------------------
// One bank opened up: a discard against one plane, in the material, so nothing outside these modules changes. Solid
// parts must be closed meshes with their voids modelled. A ray entering a cut solid then sees back faces, and those
// draw as a flat hatched cut face. Static castings and moving parts have separate switches, because a section along the
// bank keeps the moving parts whole in front of the cut.
const plane = {uSecN: {value: new THREE.Vector3(1, 0, 0)}, uSecD: {value: 1e3}};
const flags = {static: {value: 0}, moving: {value: 0}};
const made = new Map();

function secMaterial(base, name, group) {
  const key = `${name}.sec.${group}`;
  if (made.has(key)) return made.get(key);
  const m = base.clone();
  m.side = THREE.DoubleSide;
  const finish = base.userData.grain;
  m.onBeforeCompile = (shader) => {
    if (finish) applyGrain(shader, finish);
    Object.assign(shader.uniforms, plane, {uSecOn: flags[group]});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSecW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 secP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          secP = instanceMatrix * secP;
        #endif
        vSecW = (modelMatrix * secP).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSecW;\nuniform vec3 uSecN;\nuniform float uSecD;\nuniform float uSecOn;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uSecOn > 0.5 && dot(vSecW, uSecN) > uSecD) discard;')
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uSecOn > 0.5 && !gl_FrontFacing) {
          float hatch = step(0.86, fract((vSecW.x + vSecW.y + vSecW.z) * 110.0));
          gl_FragColor.rgb = mix(vec3(0.72, 0.70, 0.66), vec3(0.42, 0.40, 0.37), hatch);
        }`);
  };
  m.customProgramCacheKey = () => `xk8-section${finish ? `-${finish.tiles}-${finish.amount}-${finish.mottle}` : ''}`;
  addMaterial(key, m);
  made.set(key, m);
  return m;
}

// ---- registration -------------------------------------------------------------------------------
const tracked = {cut: [], whole: []};

/** Forgets earlier builds. The harness and node tests build more than once. */
export function resetTracking() { tracked.cut.length = 0; tracked.whole.length = 0; }

/**
 * Registers a part. map is {materialName: [geometries]}, or an Object3D you built. Placed at the engine origin unless
 * origin is given, in a bank's frame if bank is set. sec is 'static' or 'moving' for parts that take the section cut;
 * any other part hides when the cut would remove it. The rest of opts goes to registry.add.
 */
export function makeReg(ctx) {
  const {registry, materials} = ctx;
  return function reg(id, map, opts = {}) {
    const {bank = null, sec = null, origin = [ORIGIN.x, ORIGIN.y, 0], guard = false, ...rest} = opts;
    if (guard && registry.has(id)) return null;
    let obj;
    if (map instanceof THREE.Object3D) obj = map;
    else if (sec) {
      obj = new THREE.Group();
      for (const [name, geoms] of Object.entries(map)) {
        const single = part(materials, {[name]: geoms}).children[0];
        single.material = secMaterial(materials[name], name, sec);
        obj.add(single);
      }
    } else obj = part(materials, map);
    if (sec && map instanceof THREE.Object3D) obj.traverse((o) => { if (o.isMesh) o.material = secMaterial(o.material, nameOf(materials, o.material), sec); });
    const holder = new THREE.Group();
    holder.position.set(...origin);
    if (bank) { holder.position.x += mm(bank.x); holder.rotation.x = bank.rot; }
    holder.add(obj);
    const res = registry.add(id, holder, rest);
    (sec ? tracked.cut : tracked.whole).push({id, object: holder, mirror: res.mirror, sec, box: null});
    return {...res, inner: obj};
  };
}
const nameOf = (lib, mat) => Object.keys(lib).find((k) => lib[k] === mat);

/** An InstancedMesh on a shared matrix buffer. box is its travel, mm, so bounds, labels and fly-to work. */
export function instanced(geometry, material, attr, boxMm) {
  const m = new THREE.InstancedMesh(geometry, material, attr.count);
  m.instanceMatrix = attr;
  m.frustumCulled = false;
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...boxMm[0].map(mm)), new THREE.Vector3(...boxMm[1].map(mm)));
  return m;
}
/** Writes a rotation about x plus a translation, metres, into slot i of a matrix array. Allocates nothing. */
export function setRx(a, i, c, s, x, y, z, sx = 1, sy = 1) {
  const k = i * 16;
  a[k] = sx; a[k + 1] = 0; a[k + 2] = 0; a[k + 3] = 0;
  a[k + 4] = 0; a[k + 5] = c * sy; a[k + 6] = s * sy; a[k + 7] = 0;
  a[k + 8] = 0; a[k + 9] = -s; a[k + 10] = c; a[k + 11] = 0;
  a[k + 12] = x; a[k + 13] = y; a[k + 14] = z; a[k + 15] = 1;
}

/**
 * Puts the section on or off. mode: null, 'bank' (along A bank through the bores, moving parts whole), or 'cyl1' to
 * 'cyl4' (across the engine at that row, everything cut). Stage layers: cut parts leave the AO pass, which would
 * otherwise draw them back as a pale ghost, and stop casting a shadow from the half that is not there.
 */
export function applySection(mode, {rowX = () => 0} = {}) {
  const on = !!mode;
  const n = plane.uSecN.value;
  let keep = () => true;
  if (mode === 'bank') {
    n.set(0, -Math.SQRT1_2, Math.SQRT1_2);
    plane.uSecD.value = n.y * ORIGIN.y + 0.01;
    keep = (c) => c.x < 0.62 || n.y * c.y + n.z * c.z <= plane.uSecD.value;
  } else if (on) {
    n.set(1, 0, 0);
    plane.uSecD.value = ORIGIN.x + mm(rowX(+mode.slice(3) - 1));
    keep = (c, b) => b.max.x <= plane.uSecD.value;
  } else plane.uSecD.value = 1e3;
  flags.static.value = on ? 1 : 0;
  flags.moving.value = mode && mode !== 'bank' ? 1 : 0;
  const c = new THREE.Vector3();
  for (const t of tracked.whole) {
    if (!t.box) { t.object.updateWorldMatrix(true, true); t.box = new THREE.Box3().setFromObject(t.object); }
    t.box.getCenter(c);
    const out = t.id === 'engine.engine-cover'; // a loose cover has no business over a section
    t.object.visible = !on || (!out && keep(c, t.box));
    if (t.mirror) t.mirror.visible = !on || keep(c.setZ(-c.z), t.box);
  }
  const layer = on ? 2 : 0; // LAYER.GHOST and LAYER.SOLID, which is what these meshes rest on
  for (const t of tracked.cut) {
    const cut = t.sec === 'static' || !on || flags.moving.value > 0; // a moving part stays whole in a bank section
    t.object.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = !on; // the inside of a closed engine is otherwise black
      if (!cut) return;
      o.userData.layer = layer;
      o.layers.set(layer);
      o.castShadow = !on;
    });
  }
}
