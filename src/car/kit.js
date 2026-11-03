// Geometry helpers. Every helper returns a BufferGeometry in metres. Build a part from these, merge() it into one
// geometry per material, wrap it with mesh(), register it. Geometry stays real: dimensions go in, nothing is scaled to fit.
//
// Conventions: profiles and rings are arrays of [a, b]. Lathes spin around +y unless axis says otherwise. A helper's
// `seg` is a count at full detail; setDetail() scales it, so phones build lighter cars from the same code.
import * as THREE from 'three';

let detail = 1;
/** 1 on desktop, about 0.6 on touch devices. Set once, before any build(). */
export const setDetail = (f) => { detail = f; };
export const seg = (n, min = 3) => Math.max(min, Math.round(n * detail));
/** A value worked out the first time it is asked for: what only a form that waits needs costs nothing until then. */
export const once = (f) => { let v, done = false; return () => { if (!done) { v = f(); done = true; } return v; }; };

const V = (a) => (a instanceof THREE.Vector3 ? a : new THREE.Vector3(a[0], a[1], a[2]));
const AXES = {x: new THREE.Euler(0, 0, -Math.PI / 2), y: new THREE.Euler(), z: new THREE.Euler(Math.PI / 2, 0, 0)};

const fromArrays = (pos, nor, idx) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
};

/** Moves a geometry in place. at [x,y,z], rot [rx,ry,rz] in radians, scale a number or [x,y,z]. Returns it. */
export function xf(g, {at = null, rot = null, scale = null} = {}) {
  if (scale != null) { if (Array.isArray(scale)) g.scale(...scale); else g.scale(scale, scale, scale); }
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  if (at) g.translate(...at);
  return g;
}

/** Copies many instances of one geometry. transforms: [{at, rot, scale}]. Returns one merged geometry. */
export const repeat = (g, transforms) => merge(transforms.map((t) => xf(g.clone(), t)));

/**
 * Concatenates geometries into one, keeping position and normal (uv is dropped unless every input has it). Nested
 * arrays and nulls are fine. A non-indexed input stays correct; inputs are not modified.
 */
export function merge(...list) {
  const gs = list.flat(Infinity).filter(Boolean);
  const keepUv = gs.every((g) => g.attributes.uv);
  let nv = 0, ni = 0;
  for (const g of gs) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = keepUv ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, i = 0;
  for (const g of gs) {
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array.subarray(0, n * 3), v * 3);
    nor.set(g.attributes.normal.array.subarray(0, n * 3), v * 3);
    if (uv) uv.set(g.attributes.uv.array.subarray(0, n * 2), v * 2);
    if (g.index) { for (let k = 0; k < g.index.count; k++) idx[i++] = g.index.array[k] + v; } else { for (let k = 0; k < n; k++) idx[i++] = v + k; }
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Surface of revolution. profile [[radius, height], ...] runs from the bottom, out, up the outside and back in over
 * the top; go the other way and the part renders inside out. Corners sharper than creaseDeg stay crisp, which is what
 * makes a machined part look machined; gentler ones shade smooth.
 * Options: seg, axis 'x'|'y'|'z' (height runs along +axis), creaseDeg, arc (radians, for part-turned shapes).
 */
export function lathe(points, {seg: count = 32, axis = 'y', creaseDeg = 28, arc = Math.PI * 2} = {}) {
  const profile = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  const n = seg(count, 6), cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const dirs = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    dirs.push([(b[0] - a[0]) / d, (b[1] - a[1]) / d]);
  }
  // Each segment gets its own two rings unless the next corner is smooth, when they share an averaged normal.
  const rows = [];
  for (let i = 0; i < dirs.length; i++) {
    const nrm = (d) => [d[1], -d[0]];
    const here = nrm(dirs[i]);
    const before = i > 0 && dirs[i][0] * dirs[i - 1][0] + dirs[i][1] * dirs[i - 1][1] > cosCrease ? nrm(dirs[i - 1]) : here;
    const after = i < dirs.length - 1 && dirs[i][0] * dirs[i + 1][0] + dirs[i][1] * dirs[i + 1][1] > cosCrease ? nrm(dirs[i + 1]) : here;
    const avg = (p, q) => { const x = p[0] + q[0], y = p[1] + q[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    rows.push({p: profile[i], n: avg(here, before), wall: true}, {p: profile[i + 1], n: avg(here, after), wall: false});
  }
  const pos = [], nor = [], idx = [];
  const cols = n + 1;
  for (const row of rows) for (let j = 0; j < cols; j++) {
    const a = (j / n) * arc, c = Math.cos(a), s = Math.sin(a);
    pos.push(row.p[0] * c, row.p[1], row.p[0] * s);
    nor.push(row.n[0] * c, row.n[1], row.n[0] * s);
  }
  for (let r = 0; r < rows.length; r += 2) for (let j = 0; j < n; j++) {
    const a = r * cols + j, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = fromArrays(pos, nor, idx);
  if (axis !== 'y') g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(AXES[axis]));
  return g;
}

/** A plain cylinder along an axis, centred on the origin and closed at both ends. inner makes it a ring. chamfer bevels the outer edges. */
export function cylinder(radius, length, {seg: count = 24, axis = 'y', chamfer = 0, at = null, inner = 0} = {}) {
  const h = length / 2, c = Math.min(chamfer, radius / 2, h), r0 = inner > 0 ? inner : 1e-5;
  const p = [[r0, -h], [radius - c, -h], [radius, -h + c], [radius, h - c], [radius - c, h], [r0, h]];
  if (inner > 0) p.push([r0, -h]);
  const g = lathe(p, {seg: count, axis});
  return at ? g.translate(...at) : g;
}

const BOX_FACES = [ // normal, then the face's u and v axes; each index is which half-size runs along that axis
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const BOX_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const boxVertex = (face, c, half, inset, out) => {
  const [n, u, v] = BOX_FACES[face];
  const du = dot3(u.map(Math.abs), half) - inset, dv = dot3(v.map(Math.abs), half) - inset, dn = dot3(n.map(Math.abs), half);
  for (let k = 0; k < 3; k++) out.push(n[k] * dn + u[k] * BOX_CORNERS[c][0] * du + v[k] * BOX_CORNERS[c][1] * dv);
};
// The stitching between faces never changes, so it is worked out once. First 36 indices are the faces, the rest the chamfers.
const BOX_INDEX = (() => {
  const half = [1, 1, 1], pos = [];
  for (let f = 0; f < 6; f++) for (let c = 0; c < 4; c++) boxVertex(f, c, half, 0.2, pos);
  const at = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const sign = (i) => at(i).map(Math.sign).join();
  const idx = [];
  for (let f = 0; f < 6; f++) idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  const wind = (a, b, c) => {
    const A = at(a), B = at(b), C = at(c);
    const e = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], g = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e[1] * g[2] - e[2] * g[1], e[2] * g[0] - e[0] * g[2], e[0] * g[1] - e[1] * g[0]];
    if (dot3(n, A) > 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const corners = new Map();
  for (let i = 0; i < 24; i++) (corners.get(sign(i)) ?? corners.set(sign(i), []).get(sign(i))).push(i);
  for (const c of corners.values()) wind(c[0], c[1], c[2]);
  for (let f = 0; f < 6; f++) for (let g = f + 1; g < 6; g++) for (let e = 0; e < 4; e++) for (let h = 0; h < 4; h++) {
    const a = f * 4 + e, b = f * 4 + (e + 1) % 4, c = g * 4 + h, d = g * 4 + (h + 1) % 4;
    if (sign(a) === sign(d) && sign(b) === sign(c)) { wind(a, b, c); wind(a, c, d); }
  }
  return idx;
})();
const BOX_NORMALS = BOX_FACES.flatMap(([n]) => [...n, ...n, ...n, ...n]);

/**
 * A box with chamfered edges, 44 triangles. w along x, h along y, d along z, centred on the origin unless at is
 * given. The chamfer shares normals with its faces, so edges catch a soft highlight instead of a hard line.
 */
export function box(w, h, d, {bevel = 0.002, at = null} = {}) {
  const half = [w / 2, h / 2, d / 2], b = Math.min(bevel, w / 2.01, h / 2.01, d / 2.01), pos = [];
  for (let f = 0; f < 6; f++) for (let c = 0; c < 4; c++) boxVertex(f, c, half, b, pos);
  const g = fromArrays(pos, BOX_NORMALS, b > 0 ? BOX_INDEX : BOX_INDEX.slice(0, 36));
  return at ? g.translate(...at) : g;
}

/** Same as box, with the corners of the plan rounded: a sump, a battery, a fuse box. Extruded along y. */
export function roundedBlock(w, h, d, {radius = 0.01, bevel = 0.002, at = null} = {}) {
  const s = new THREE.Shape();
  const x = w / 2 - radius, z = d / 2 - radius;
  s.absarc(x, z, radius, 0, Math.PI / 2, false);
  s.absarc(-x, z, radius, Math.PI / 2, Math.PI, false);
  s.absarc(-x, -z, radius, Math.PI, Math.PI * 1.5, false);
  s.absarc(x, -z, radius, Math.PI * 1.5, Math.PI * 2, false);
  const g = new THREE.ExtrudeGeometry(s, {depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: seg(6, 2)});
  g.rotateX(-Math.PI / 2).translate(0, -h / 2 + bevel, 0);
  return at ? g.translate(...at) : g;
}

/**
 * Any flat profile with thickness: a bracket, a cover, a plate. outline [[a, b], ...], holes [[[a, b], ...], ...].
 * The profile sits in the plane across `axis` and is extruded along +axis from zero: on 'z' it is (x, y), on 'y' it
 * is (x, -z), on 'x' it is (-z, y).
 */
export function extrude(outline, depth, {holes = [], bevel = 0, axis = 'y', curve = 8} = {}) {
  const s = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([a, b]) => new THREE.Vector2(a, b))));
  const g = new THREE.ExtrudeGeometry(s, {depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: seg(curve, 2)});
  if (bevel) g.translate(0, 0, bevel);
  if (axis === 'y') g.rotateX(-Math.PI / 2);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  return g;
}

const curveOf = (points, closed) => new THREE.CatmullRomCurve3(points.map(V), closed, 'centripetal');

/**
 * A round section swept along a spline through points. radius is a number or r(u), u 0..1 along the length, which is
 * how a bellows or a taper is made. Open ends are capped. Options: seg (along), radial, closed.
 */
export function tube(points, radius, {seg: along = 0, radial = 10, closed = false} = {}) {
  const curve = curveOf(points, closed);
  const steps = seg(along || Math.max(8, Math.ceil(curve.getLength() / 0.02)), 2);
  const rn = seg(radial, 5);
  const frames = curve.computeFrenetFrames(steps, closed);
  const r = typeof radius === 'function' ? radius : () => radius;
  const pos = [], nor = [], idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    curve.getPointAt(u, P);
    const R = r(u), N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= rn; j++) {
      const a = (j / rn) * Math.PI * 2, c = Math.cos(a), s = -Math.sin(a);
      const nx = c * N.x + s * B.x, ny = c * N.y + s * B.y, nz = c * N.z + s * B.z;
      nor.push(nx, ny, nz);
      pos.push(P.x + R * nx, P.y + R * ny, P.z + R * nz);
    }
  }
  const cols = rn + 1;
  for (let i = 0; i < steps; i++) for (let j = 0; j < rn; j++) {
    const a = i * cols + j, b = a + cols, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  if (!closed) {
    for (const [ring, sign] of [[0, -1], [steps, 1]]) {
      const t = curve.getTangentAt(ring / steps);
      const centre = pos.length / 3;
      const q = curve.getPointAt(ring / steps);
      pos.push(q.x, q.y, q.z);
      nor.push(t.x * sign, t.y * sign, t.z * sign);
      for (let j = 0; j <= rn; j++) {
        const k = (ring * cols + j) * 3;
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        nor.push(t.x * sign, t.y * sign, t.z * sign);
      }
      for (let j = 0; j < rn; j++) {
        if (sign > 0) idx.push(centre, centre + 2 + j, centre + 1 + j); else idx.push(centre, centre + 1 + j, centre + 2 + j);
      }
    }
  }
  return fromArrays(pos, nor, idx);
}

/** A rubber hose: a tube with a slight sag of ribs if asked, and a clip band at each end. */
export function hose(points, radius, {ribs = 0, clips = true, radial = 10, seg: along = 0, depth = 0.04} = {}) {
  const body = tube(points, ribs ? (u) => radius * (1 + depth * Math.sin(u * ribs * Math.PI * 2)) : radius, {radial, seg: along || (ribs ? ribs * 6 : 0)});
  if (!clips) return body;
  const curve = curveOf(points, false);
  const band = (u) => {
    const t = curve.getTangentAt(u), p = curve.getPointAt(u);
    const g = cylinder(radius * 1.08, radius * 0.7, {seg: radial * 1.5});
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t));
    return g.translate(p.x, p.y, p.z);
  };
  return merge(body, band(0.02), band(0.98));
}

/**
 * Skins matching closed rings of [x, y, z] points, in order: a manifold runner, a duct, a tapered housing. Each ring
 * winds counter-clockwise seen looking along the direction of travel from ring to ring, or the skin renders inside out.
 */
export function loft(rings, {caps = true, smooth = true} = {}) {
  const n = rings[0].length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(...p);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n, c = (i + 1) * n + j, d = (i + 1) * n + (j + 1) % n;
    idx.push(a, c, b, b, c, d);
  }
  const fan = (ring, flip) => {
    const c = ring.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
    const base = pos.length / 3;
    pos.push(...c);
    for (const p of ring) pos.push(...p);
    for (let j = 0; j < n; j++) {
      const a = base + 1 + j, b = base + 1 + (j + 1) % n;
      if (flip) idx.push(base, b, a); else idx.push(base, a, b);
    }
  };
  if (caps) { fan(rings[0], false); fan(rings[rings.length - 1], true); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (!smooth) { const f = g.toNonIndexed(); f.computeVertexNormals(); return f; }
  g.computeVertexNormals();
  return g;
}

/** A hex bolt head with washer face, sitting on y = 0 and rising along +y. af is across flats. */
export function hexHead(af, height) {
  const r = af / Math.sqrt(3);
  return lathe([[1e-5, 0], [r, 0], [r, height * 0.82], [r * 0.82, height], [1e-5, height]], {seg: 6, creaseDeg: 5});
}

/**
 * n copies of a geometry around a circle, for wheel studs, cover bolts, pulley faces. radius is half the PCD. The
 * geometry stands on +y; it is copied around `axis` and points along it. phase in radians.
 */
export function boltCircle(radius, n, geometry, {axis = 'y', phase = 0, at = null} = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push(geometry.clone().translate(radius * Math.cos(a), 0, radius * Math.sin(a)));
  }
  const g = merge(out);
  if (axis !== 'y') g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(AXES[axis]));
  return at ? g.translate(...at) : g;
}

/** A Mesh with sensible defaults. Accepts one geometry or a list, which it merges. */
export function mesh(geometry, material) {
  const g = Array.isArray(geometry) ? merge(geometry) : geometry;
  return new THREE.Mesh(g, material);
}

/**
 * The usual part: {materialName: [geometries]} to one merged mesh per material in a Group. Pass the library object
 * and the map: part(ctx.materials, {aluminiumCast: [a, b], steel: [c]}).
 */
export function part(lib, byMaterial) {
  const g = new THREE.Group();
  for (const [name, geoms] of Object.entries(byMaterial)) {
    if (!lib[name]) throw new Error(`unknown material ${name}`);
    g.add(mesh([geoms].flat(Infinity), lib[name]));
  }
  return g;
}

/** Triangles in an object and everything under it, instancing included. */
export function triCount(object) {
  let n = 0;
  object.traverse((m) => {
    if (m.isMesh) n += ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * (m.count ?? 1);
  });
  return n;
}
