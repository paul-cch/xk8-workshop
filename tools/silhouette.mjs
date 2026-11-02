#!/usr/bin/env node
// Scores the body against the reference photos: silhouette overlap (IoU) in the side, front and rear views, plus an
// overlay PNG with the outlines on the photo, so a good number with a wrong shape can be seen.
//
//   node tools/silhouette.mjs                     score the real panels, write dist-shots/silhouette/*.png
//   node tools/silhouette.mjs --lattice           score the bare surface: fast, for working on the shape tables
//   node tools/silhouette.mjs --views side        only these views
//   node tools/silhouette.mjs --log "note"        also append a row to docs/body-hillclimb.md
//
// References are outlines traced by hand on gridded crops of ref/images, in the pixels of each file. They exclude the
// exhaust tips, which are not body parts, and the photo backgrounds would defeat any colour threshold.
//
// Side view: ref/images/side-coupe-xk8-40-early-pure-elevation.jpg, the master. Wheelbase sets the scale, the 0.34 degree
// tilt is removed, overhangs are stretched to the real 4760 mm as SOURCES.md says, and height is pinned to the real 1296 mm.
// The tyres are the photo's own discs in both masks: this car wears 16 inch wheels and they are not what is being scored.
//
// Front and rear: both photos are of convertibles, roof down, shot from about two metres up and close to the car, so no
// orthographic view can match them. These views render the convertible through a pinhole camera fitted to the photo (eight
// camera numbers, nothing about the car), and print a plain orthographic width and height check beside it. The fit absorbs
// some shape error and the score is only as good as it, so the score at the unfitted camera prints beside it.
import {chromium} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import zlib from 'node:zlib';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-shots/silhouette');
fs.mkdirSync(OUT, {recursive: true});
const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);
const import_ = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// ---- reference outlines --------------------------------------------------------------------

const REF_SIDE = {
  file: 'side-coupe-xk8-40-early-pure-elevation.jpg',
  front: [4212, 1967], rear: [1382, 1950], tyreR: 355, // pixels, from SOURCES.md and the crops
  ground: 2312, roofPx: 880, // ground under the centre of the car and the top of the roof, along the tilted axis
  outline: [
    [39, 1650], [98, 1633], [102, 1605], [105, 1494], [100, 1405], [105, 1333], [102, 1311], [117, 1300], [161, 1278], [233, 1255], [333, 1244], [467, 1228], [600, 1205], [658, 1183],
    [750, 1154], [850, 1117], [950, 1087], [1100, 1046], [1250, 1004], [1383, 971], [1500, 943], [1542, 936], [1608, 925], [1750, 907], [1900, 890], [2000, 882], [2200, 880], [2400, 886],
    [2600, 900], [2800, 929], [2854, 956], [2950, 1008], [3050, 1056], [3150, 1108], [3250, 1156], [3350, 1208], [3450, 1264], [3500, 1290], [3620, 1303], [3794, 1321], [4006, 1350],
    [4241, 1388], [4476, 1430], [4547, 1445], [4712, 1494], [4829, 1559], [4947, 1635], [5023, 1700], [5070, 1776], [5079, 1835], [5070, 1906], [5029, 1965], [4970, 2012], [4853, 2068],
    [4759, 2088], [4612, 2094], [3881, 2094], [3365, 2098], [1800, 2098], [1040, 2090], [1040, 2050], [872, 2055], [806, 2055], [500, 2017], [278, 1978], [200, 1925], [100, 1828],
    [67, 1805], [33, 1739], [24, 1683],
  ],
};

const REF_FRONT = {
  file: 'front-convertible-xk8-40-head-on.jpg',
  size: [1920, 1715],
  camera: {eye: [4.1, 1.75, 0], at: [0.6, 0.72, 0], f: 2070, roll: 0, shift: [0, 0]}, // start from the mirror width against the nose width
  outline: [
    [974, 213], [769, 231], [667, 247], [615, 289], [564, 347], [513, 424], [506, 404], [487, 359], [423, 353], [400, 372], [408, 398], [462, 430], [494, 436], [474, 481], [385, 545], [308, 616],
    [231, 686], [179, 757], [141, 859], [122, 975], [113, 1077], [118, 1167], [135, 1257], [179, 1334], [244, 1392], [321, 1449], [410, 1488], [590, 1520], [769, 1539], [974, 1549],
    [1282, 1545], [1474, 1513], [1590, 1475], [1679, 1411], [1756, 1321], [1788, 1244], [1801, 1154], [1792, 1065], [1776, 949], [1744, 834], [1692, 718], [1603, 622], [1526, 552],
    [1436, 481], [1417, 443], [1455, 430], [1506, 411], [1528, 385], [1519, 366], [1474, 359], [1433, 372], [1410, 411], [1391, 392], [1333, 315], [1282, 263], [1218, 238], [1090, 218],
  ],
};

const REF_REAR = {
  file: 'rear-convertible-xkr-head-on.jpg',
  size: [1920, 1590],
  camera: {eye: [-5.9, 1.85, 0], at: [-0.6, 0.72, 0], f: 3270, roll: 0, shift: [0, 0]},
  outline: [
    [923, 191], [718, 199], [603, 214], [571, 246], [538, 310], [506, 374], [500, 362], [481, 323], [385, 323], [368, 342], [372, 368], [410, 383], [494, 387], [410, 400], [429, 426], [372, 458],
    [365, 477], [321, 496], [256, 535], [192, 599], [147, 688], [122, 765], [109, 868], [109, 945], [115, 1047], [135, 1163], [154, 1214], [160, 1278], [192, 1336], [269, 1387], [385, 1426],
    [577, 1458], [897, 1483], [1218, 1477], [1410, 1458], [1603, 1413], [1718, 1355], [1763, 1278], [1776, 1188], [1801, 1099], [1818, 971], [1814, 868], [1788, 753], [1744, 663], [1679, 586],
    [1603, 535], [1526, 490], [1474, 470], [1481, 438], [1449, 406], [1468, 387], [1472, 355], [1462, 323], [1378, 320], [1359, 342], [1340, 381], [1301, 349], [1263, 246], [1218, 214], [1090, 195],
  ],
};

// ---- raster --------------------------------------------------------------------------------

const newMask = (w, h) => ({w, h, d: new Uint8Array(w * h)});

function fillPoly(m, pts) {
  const {w, h, d} = m;
  for (let y = 0; y < h; y++) {
    const yy = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= yy) !== (b[1] <= yy)) xs.push(a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5)), x1 = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = x0; x <= x1; x++) d[y * w + x] = 1;
    }
  }
}

function fillTri(m, ax, ay, bx, by, cx, cy) {
  const {w, h, d} = m;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  const s = area > 0 ? 1 : -1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const e0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * s;
    const e1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * s;
    const e2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * s;
    if (e0 >= 0 && e1 >= 0 && e2 >= 0) d[y * w + x] = 1;
  }
}

const iou = (a, b) => {
  let i = 0, u = 0;
  for (let k = 0; k < a.d.length; k++) { if (a.d[k] | b.d[k]) u++; if (a.d[k] & b.d[k]) i++; }
  return i / u;
};

// ---- png -----------------------------------------------------------------------------------

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(file, w, h, rgb) {
  const chunk = (type, data) => {
    const t = Buffer.from(type), l = Buffer.alloc(4), c = Buffer.alloc(4);
    l.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** Decodes a JPEG through the browser, once: the overlays need the photo and node has no decoder. */
async function photo(browser, file, maxW) {
  const cache = path.join(OUT, `${file}.${maxW}.rgb`), meta = `${cache}.json`;
  if (fs.existsSync(cache) && fs.existsSync(meta)) return {...JSON.parse(fs.readFileSync(meta)), rgb: fs.readFileSync(cache)};
  const page = await browser.newPage();
  const b64 = fs.readFileSync(path.join(ROOT, 'ref/images', file)).toString('base64');
  const r = await page.evaluate(async ({b64, maxW}) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const k = Math.min(1, maxW / img.width), w = Math.round(img.width * k), h = Math.round(img.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, out = new Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { out[i * 3] = d[i * 4]; out[i * 3 + 1] = d[i * 4 + 1]; out[i * 3 + 2] = d[i * 4 + 2]; }
    return {w, h, k, out};
  }, {b64, maxW});
  await page.close();
  const rgb = Buffer.from(r.out);
  fs.writeFileSync(cache, rgb);
  fs.writeFileSync(meta, JSON.stringify({w: r.w, h: r.h, k: r.k}));
  return {w: r.w, h: r.h, k: r.k, rgb};
}

const edge = (m, x, y) => {
  const {w, h, d} = m, v = d[y * w + x];
  if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
  return v !== d[y * w + x - 1] || v !== d[y * w + x + 1] || v !== d[(y - 1) * w + x] || v !== d[(y + 1) * w + x];
};

/** Photo faded, ref-only red, model-only blue, overlap clear, outlines on top. photoAt(x, y) gives an index into rgb or -1. */
function overlay(file, ref, model, rgb, photoAt) {
  const {w, h} = ref, out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = (y * w + x) * 3, a = ref.d[y * w + x], b = model.d[y * w + x], p = rgb ? photoAt(x, y) : -1;
    let c = p >= 0 ? [rgb[p], rgb[p + 1], rgb[p + 2]] : [235, 235, 235];
    const mix = (t, u) => t.map((v, i) => Math.round(v * 0.45 + u[i] * 0.55));
    if (a && !b) c = mix(c, [235, 30, 30]);
    if (b && !a) c = mix(c, [30, 90, 255]);
    if (edge(ref, x, y)) c = [255, 240, 0];
    if (edge(model, x, y)) c = [0, 240, 255];
    out[k] = c[0]; out[k + 1] = c[1]; out[k + 2] = c[2];
  }
  png(file, w, h, out);
}

// ---- model ---------------------------------------------------------------------------------

function trisFrom(geoms) {
  const out = [];
  for (const {g, m} of geoms) {
    const p = g.attributes.position.array, ix = g.index ? g.index.array : null, n = ix ? ix.length : p.length / 3;
    const v = new Float32Array(n * 3);
    const e = m ? m.elements : null;
    for (let i = 0; i < n; i++) {
      const k = (ix ? ix[i] : i) * 3, x = p[k], y = p[k + 1], z = p[k + 2];
      if (e) {
        v[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        v[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        v[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      } else { v[i * 3] = x; v[i * 3 + 1] = y; v[i * 3 + 2] = z; }
    }
    out.push(v);
  }
  return out;
}

async function latticeModel(body) {
  const {bodySurface, panelGeometry} = await import_('src/car/surface.js');
  const S = bodySurface(body);
  const g = panelGeometry(S, [[0, 0], [1, 0], [1, 1], [0, 1]], {flange: 0, roll: 0, both: true, cells: 240});
  return trisFrom([{g, m: null}]);
}

/** The real panels, through the real registry, for one variant. */
async function realModel(variant) {
  const [{createRegistry}, {materials}, body, roof, {initData, data}] = await Promise.all([import_('src/car/registry.js'), import_('src/car/materials.js'), import_('src/car/body.js'), import_('src/car/roof.js'), import_('src/data.js')]);
  const raw = {};
  for (const f of ['variants', 'parts', 'torques', 'fluids', 'service', 'jobs', 'tools', 'faults', 'dtc', 'weakspots', 'inspect', 'upgrades', 'vendors']) raw[f] = JSON.parse(fs.readFileSync(path.join(ROOT, `data/${f}.json`), 'utf8'));
  if (!data.parts) initData(raw);
  const registry = createRegistry();
  registry.setData(data.parts);
  const ctx = {registry, data, materials, variant, spec: raw.variants.items[0], dims: null, views: null};
  body.build(ctx);
  roof.build(ctx);
  const k = variant.roofDown ? 1 : 0, sim = {open: {bonnet: 0, boot: 0, doorL: 0, doorR: 0}, roof: {latch: k, frame: k, cover: k}};
  body.update?.(sim);
  roof.update?.(sim);
  const geoms = [];
  const {applies} = await import_('src/data.js');
  registry.root.updateMatrixWorld(true);
  for (const part of registry.all()) {
    if (!applies(data.parts.byId.get(part.id)?.appliesTo, variant)) continue;
    for (const inst of part.instances) {
      if (inst.variant && !inst.variant(variant)) continue;
      inst.rig.traverseVisible((o) => { if (o.isMesh) geoms.push({g: o.geometry, m: o.matrixWorld}); });
    }
  }
  return trisFrom(geoms);
}

// ---- views ---------------------------------------------------------------------------------

const PX_PER_M = 200, X0 = -2.75, X1 = 2.3, Y1 = 1.45;
const SIDE_W = Math.round((X1 - X0) * PX_PER_M), SIDE_H = Math.round(Y1 * PX_PER_M);
const toSide = (x, y) => [(x - X0) * PX_PER_M, (Y1 - y) * PX_PER_M];

/** Photo pixels to car metres, for the master elevation. */
function sideMapper() {
  const {front: F, rear: R, ground, roofPx} = REF_SIDE;
  const tilt = Math.atan2(F[1] - R[1], F[0] - R[0]), c = Math.cos(tilt), s = Math.sin(tilt);
  const span = Math.hypot(F[0] - R[0], F[1] - R[1]), k = 2.588 / span;
  const xNosePx = 3697, xTailPx = -1358; // u of the nose and tail in the photo
  const kF = (2.144 - 1.294) / ((xNosePx - span) * k), kR = (2.616 - 1.294) / (-xTailPx * k);
  const kY = 1.296 / (ground - roofPx);
  const forward = (px, py) => {
    const dx = px - R[0], dy = py - R[1], u = dx * c + dy * s, v = -dx * s + dy * c;
    const xw = u * k;
    const x = xw > 2.588 ? 1.294 + (xw - 2.588) * kF : xw < 0 ? -1.294 + xw * kR : -1.294 + xw;
    const yAxle = ground - R[1];
    return [x, (yAxle - v) * kY];
  };
  // the inverse, for sampling the photo under the overlay
  const inverse = (x, y) => {
    const xw = x > 1.294 ? 2.588 + (x - 1.294) / kF : x < -1.294 ? (x + 1.294) / kR : x + 1.294;
    const u = xw / k, v = (ground - R[1]) - y / kY;
    return [R[0] + u * c - v * s, R[1] + u * s + v * c];
  };
  return {forward, inverse, tyreM: REF_SIDE.tyreR * k, axleY: (ground - R[1]) * kY};
}

let sideBare = 0;
function sideScore(tris, map, rgbImage, name) {
  const ref = newMask(SIDE_W, SIDE_H), model = newMask(SIDE_W, SIDE_H);
  fillPoly(ref, REF_SIDE.outline.map(([a, b]) => { const [x, y] = map.forward(a, b); return toSide(x, y); }));
  const disc = (m, x, y, r) => { const pts = Array.from({length: 96}, (_, i) => toSide(x + r * Math.cos((i / 96) * 6.2832), y + r * Math.sin((i / 96) * 6.2832))); fillPoly(m, pts); };
  for (const m of [ref, model]) for (const x of [-1.294, 1.294]) disc(m, x, map.axleY, map.tyreM);
  for (const v of tris) for (let i = 0; i < v.length; i += 9) {
    const a = toSide(v[i], v[i + 1]), b = toSide(v[i + 3], v[i + 4]), c = toSide(v[i + 6], v[i + 7]);
    fillTri(model, a[0], a[1], b[0], b[1], c[0], c[1]);
  }
  const score = iou(ref, model);
  // The discs are in both masks, so they can only flatter the score. This is the same overlap with the wheels left out.
  const wheels = newMask(SIDE_W, SIDE_H);
  for (const x of [-1.294, 1.294]) disc(wheels, x, map.axleY, map.tyreM);
  let inter = 0, union = 0;
  for (let k = 0; k < ref.d.length; k++) { if (wheels.d[k]) continue; if (ref.d[k] | model.d[k]) union++; if (ref.d[k] & model.d[k]) inter++; }
  sideBare = inter / union;
  if (rgbImage) {
    const {rgb, w, h, k} = rgbImage;
    overlay(path.join(OUT, `${name}.png`), ref, model, rgb, (x, y) => {
      const [mx, my] = [X0 + (x + 0.5) / PX_PER_M, Y1 - (y + 0.5) / PX_PER_M];
      const [px, py] = map.inverse(mx, my);
      const ix = Math.round(px * k), iy = Math.round(py * k);
      return ix >= 0 && iy >= 0 && ix < w && iy < h ? (iy * w + ix) * 3 : -1;
    });
  }
  return score;
}

/** Pinhole render into a downscaled copy of the photo's pixels. */
function perspectiveMask(tris, cam, w, h, scale, mirrorZ = true) {
  const m = newMask(w, h);
  const eye = new THREE.Vector3(...cam.eye), at = new THREE.Vector3(...cam.at);
  const back = eye.clone().sub(at).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const cx = w / 2 + cam.shift[0] * scale, cy = h / 2 + cam.shift[1] * scale, f = cam.f * scale;
  const pr = (x, y, z) => {
    const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
    const X = dx * right.x + dy * right.y + dz * right.z, Y = dx * up.x + dy * up.y + dz * up.z, Z = -(dx * back.x + dy * back.y + dz * back.z);
    const u = (f * X) / Z, v = (f * Y) / Z;
    return [cx + u * cr - v * sr, cy - (u * sr + v * cr)];
  };
  for (const v of tris) for (let i = 0; i < v.length; i += 9) {
    const a = pr(v[i], v[i + 1], v[i + 2]), b = pr(v[i + 3], v[i + 4], v[i + 5]), c = pr(v[i + 6], v[i + 7], v[i + 8]);
    fillTri(m, a[0], a[1], b[0], b[1], c[0], c[1]);
  }
  return m;
}

/**
 * Fits the camera, nothing about the car: eye distance and height, focal length, aim, and shift, with the eye kept near
 * the centreline because both photos were taken from about dead ahead. Several starts, or it settles on a wrong distance.
 */
function fitCamera(tris, refPts, cam0, size) {
  const scale = .1, w = Math.round(size[0] * scale), h = Math.round(size[1] * scale);
  const ref0 = newMask(w, h);
  fillPoly(ref0, refPts.map(([x, y]) => [x * scale, y * scale]));
  const score = (c) => iou(ref0, perspectiveMask(tris, c, w, h, scale));
  const descend = (start) => {
    const cam = JSON.parse(JSON.stringify(start));
    let best = score(cam);
    const knobs = [[(c, d) => { c.f += d * 900; }, .4], [(c, d) => { c.at[1] += d; }, .12], [(c, d) => { c.eye[2] = Math.max(-.12, Math.min(.12, c.eye[2] + d)); }, .08], [(c, d) => { c.roll += d * .04; }, .1], [(c, d) => { c.shift[0] += d * 120; }, .4], [(c, d) => { c.shift[1] += d * 120; }, .4], [(c, d) => { c.eye[1] += d; }, .12], [(c, d) => { c.eye[0] += d * Math.sign(c.eye[0]); }, .2]];
    for (let round = 0; round < 10; round++) {
      let improved = false;
      for (const k of knobs) for (const sign of [1, -1]) {
        const c = JSON.parse(JSON.stringify(cam));
        k[0](c, k[1] * sign);
        const s = score(c);
        if (s > best + 1e-5) { best = s; Object.assign(cam, c); improved = true; }
      }
      if (!improved) for (const k of knobs) k[1] *= .55;
    }
    return {cam, best};
  };
  let out = null;
  const sign = Math.sign(cam0.eye[0]);
  for (const ex of [3.4, 4.4, 5.8]) for (const ey of [1.5, 2.2]) {
    const start = {...cam0, eye: [sign * ex, ey, 0], f: 2200 * (ex / 4)};
    const r = descend(start);
    if (!out || r.best > out.best) out = r;
  }
  return out.cam;
}

const guessed = {};
async function endScore(tris, ref, name, image) {
  const scale = 0.2, w = Math.round(ref.size[0] * scale), h = Math.round(ref.size[1] * scale);
  const mask = newMask(w, h);
  fillPoly(mask, ref.outline.map(([x, y]) => [x * scale, y * scale]));
  const camFile = path.join(OUT, `${name}.camera.json`);
  let cam = ref.camera;
  if (fs.existsSync(camFile) && !flag('refit')) cam = JSON.parse(fs.readFileSync(camFile));
  else { cam = fitCamera(tris, ref.outline, cam, ref.size); fs.writeFileSync(camFile, JSON.stringify(cam)); }
  const model = perspectiveMask(tris, cam, w, h, scale);
  const score = iou(mask, model);
  guessed[name] = iou(mask, perspectiveMask(tris, ref.camera, w, h, scale)); // before any fitting: how much of the score is the camera
  if (image) overlay(path.join(OUT, `${name}.png`), mask, model, image.rgb, (x, y) => { const ix = Math.round((x + .5) / scale * image.k), iy = Math.round((y + .5) / scale * image.k); return ix < image.w && iy < image.h ? (iy * image.w + ix) * 3 : -1; });
  return {score, cam};
}

const orthoExtents = (tris) => {
  let w = 0, h = 0;
  for (const v of tris) for (let i = 0; i < v.length; i += 3) { if (Math.abs(v[i + 2]) > w) w = Math.abs(v[i + 2]); if (v[i + 1] > h) h = v[i + 1]; }
  return {widthMm: Math.round(w * 2000), topMm: Math.round(h * 1000)};
};

// ---- main ----------------------------------------------------------------------------------

const views = (arg('views', 'side,front,rear')).split(',');
const lattice = flag('lattice');
const browser = flag('no-photo') ? null : await chromium.launch({args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']});
const rows = [];

if (views.includes('side')) {
  const v = {engine: '4.0', induction: 'na', body: 'coupe', my: 1998, market: 'uk'};
  const tris = lattice ? await latticeModel('coupe') : await realModel(v);
  const map = sideMapper();
  const score = sideScore(tris, map, browser ? await photo(browser, REF_SIDE.file, 2600) : null, 'side-coupe');
  rows.push(['side', score]);
  console.log(`side  coupe  IoU ${score.toFixed(4)}, ${sideBare.toFixed(4)} without the wheels   ${JSON.stringify(orthoExtents(tris))} (real 1829 mm over the body, 2015+ with mirrors, 1296 mm high)`);
}
for (const [name, ref] of [['front', REF_FRONT], ['rear', REF_REAR]]) {
  if (!views.includes(name)) continue;
  const v = {engine: '4.0', induction: name === 'rear' ? 'sc' : 'na', body: 'convertible', my: name === 'rear' ? 2004 : 2000, market: 'uk', roofDown: true};
  const tris = lattice ? await latticeModel('convertible') : await realModel(v);
  const {score, cam} = await endScore(tris, ref, `${name}-convertible`, browser ? await photo(browser, ref.file, 1000) : null);
  rows.push([name, score]);
  console.log(`${name.padEnd(5)} conv   IoU ${score.toFixed(4)}, ${guessed[`${name}-convertible`].toFixed(4)} at the unfitted camera   camera ${cam.eye.map((x) => x.toFixed(2))} f ${cam.f.toFixed(0)}  ${JSON.stringify(orthoExtents(tris))}`);
}
await browser?.close();

const note = arg('log');
if (note) {
  const file = path.join(ROOT, 'docs/body-hillclimb.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# Body hillclimb\n\nSilhouette overlap against the reference photos, one row per round. See tools/silhouette.mjs for what each number means.\n\n| Round | Side IoU | Front IoU | Rear IoU | What changed |\n|---|---|---|---|---|\n');
  const n = fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\| \d+ /.test(l)).length + 1;
  const get = (k) => rows.find((r) => r[0] === k)?.[1].toFixed(4) ?? '-';
  fs.appendFileSync(file, `| ${n} | ${get('side')} | ${get('front')} | ${get('rear')} | ${note} |\n`);
}
