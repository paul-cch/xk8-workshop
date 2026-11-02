// The body surface and the panel cutter.
//
// A car's skin reads from its orthographic views, so that is how it is measured: a set of curves taken off the side,
// plan and end views (xk8Shape below) defines a solid, the solid is sampled by rays from a spine into a lattice, and
// S(s, t) is a smooth Catmull-Rom patch through that lattice. s runs nose to tail, t from the top centreline round the
// side to the bottom centreline. Rows are transverse in the middle of the car and fan round both ends, so the surface
// wraps the nose and tail the way a hull does, with the two poles hidden in the mouth and the number plate recess.
//
// Shut lines are authored in real metres in whichever view shows them and inverted to (s, t) with locate(), then the
// panels are real triangles cut from S along those lines.
import * as THREE from 'three';

// ---- curves --------------------------------------------------------------------------------

/** Monotone cubic through [[x, y], ...], any x order. Flat outside the table. Never overshoots a measurement. */
export function curve(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length, xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  // A bucket table finds the interval in one step: these run millions of times while the body surface is sampled.
  const x0 = xs[0], per = 96 / (xs[n - 1] - x0);
  const start = new Uint8Array(97);
  for (let k = 0, a = 0; k < 97; k++) {
    const at = x0 + k / per;
    while (a < n - 2 && xs[a + 1] <= at) a++;
    start[k] = a;
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let a = start[((x - x0) * per) | 0];
    while (xs[a + 1] <= x) a++;
    const b = a + 1;
    const h = xs[b] - xs[a], u = (x - xs[a]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[a] + (u3 - 2 * u2 + u) * h * m[a] + (3 * u2 - 2 * u3) * ys[b] + (u3 - u2) * h * m[b];
  };
}

export const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
/** Polynomial smooth maximum: the intersection of two solids with a rolled edge of size k. */
export const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + (h * h * k) / 4; };
/** Polynomial smooth minimum: the union of two solids with a filleted join of size k. */
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };

// ---- the sampled surface -------------------------------------------------------------------

const cr = (a, b, c, d, u) => {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
};

/** One ray from origin O along D to the surface of solid f, starting the search near guess. */
function hit(f, ox, oy, oz, dx, dy, dz, guess, far) {
  const at = (r) => f(ox + dx * r, oy + dy * r, oz + dz * r);
  let a = Math.max(0, guess - 0.04), fa = at(a);
  let step = 0.05;
  while (fa > 0 && a > 0) { a = Math.max(0, a - step); fa = at(a); step *= 1.6; }
  let b = a + 0.05, fb = at(b);
  step = 0.05;
  while (fb < 0 && b < far) { a = b; fa = fb; b += step; step *= 1.3; fb = at(b); }
  if (fb < 0) return b;
  for (let i = 0; i < 16; i++) {
    let m = a + (b - a) * (fa / (fa - fb)); // regula falsi, kept honest by bisection
    if (i % 3 === 2 || !(m > a && m < b)) m = (a + b) / 2;
    const fm = at(m);
    if (fm < 0) { a = m; fa = fm; } else { b = m; fb = fm; }
    if (b - a < 2e-5) break;
  }
  return (a + b) / 2;
}

/**
 * Samples solid f(x, y, z) (negative inside, z >= 0 only) into a surface. spine: {nose: [x, y], tail: [x, y]}: rows fan
 * round these two points at the ends of the car and run transverse between them. base is another surface on the same
 * spine and lattice, and same(x, y) says where this solid is sure to match it: those points copy, and the rays are saved.
 */
export function sampleSurface(f, {spine, rows = 340, cols = 160, sRange = null, base = null, same = null}) {
  const [nx, ny] = spine.nose, [tx, ty] = spine.tail;
  const mid = nx - tx, cap = 0.62; // cap length: about the radius of the end of the car, so cells stay square
  const capArc = cap * Math.PI / 2, total = 2 * capArc + mid;
  const rowAt = (s) => {
    const a = s * total;
    if (a < capArc) return {ox: nx, oy: ny, th: (1 - a / capArc) * Math.PI / 2, sign: 1};
    if (a > total - capArc) return {ox: tx, oy: ty, th: ((a - (total - capArc)) / capArc) * Math.PI / 2, sign: -1};
    const u = (a - capArc) / mid;
    return {ox: nx + (tx - nx) * u, oy: ny + (ty - ny) * u, th: 0, sign: 1};
  };
  const lat = new Float32Array(rows * cols * 3);
  const guess = new Float32Array(cols).fill(0.7);
  const [r0, r1] = sRange ?? [0, rows - 1];
  for (let i = r0; i <= r1; i++) {
    const {ox, oy, th, sign} = rowAt(i / (rows - 1));
    const st = Math.sin(th) * sign, ct = Math.cos(th);
    for (let j = 0; j < cols; j++) {
      const a = (j / (cols - 1)) * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      const dx = st, dy = ct * ca, dz = ct * sa;
      const k = (i * cols + j) * 3;
      if (base && same(base[k], base[k + 1])) {
        lat[k] = base[k]; lat[k + 1] = base[k + 1]; lat[k + 2] = base[k + 2];
        continue;
      }
      const r = hit(f, ox, oy, 0, dx, dy, dz, guess[j], 3.4);
      guess[j] = r;
      lat[k] = ox + dx * r; lat[k + 1] = oy + dy * r; lat[k + 2] = Math.abs(dz * r);
    }
  }
  const raw = lat.slice(); // what a variant of this solid can reuse
  // Rows fan across the rolled edges of the tail at an angle, which aliases the highlight. A light pass along s removes it.
  const tailRow = Math.floor(((total - capArc) / total) * (rows - 1)) - 6;
  for (let pass = 0; pass < 6; pass++) {
    const prev = lat.slice();
    for (let i = pass < 2 ? r0 + 1 : tailRow; i < r1; i++) for (let k = 0; k < cols * 3; k++) {
      const o = i * cols * 3 + k;
      lat[o] = (prev[o - cols * 3] + 2 * prev[o] + prev[o + cols * 3]) / 4;
    }
  }
  const out = makeSurface(lat, rows, cols, {r0, r1});
  out.raw = raw;
  return out;
}

/**
 * S(s, t) from a flat lattice of rows x cols points. Ghost points mirror across the centreline at both t ends, so the
 * surface crosses z = 0 square and the two halves of the car meet without a seam.
 */
export function makeSurface(lat, rows, cols, {r0 = 0, r1 = rows - 1} = {}) {
  const nS = rows, nT = cols;
  const pt = (i, j, k) => {
    i = Math.max(r0, Math.min(r1, i));
    if (j < 0) return k === 2 ? -lat[(i * nT - j) * 3 + 2] : lat[(i * nT - j) * 3 + k];
    if (j >= nT) { const m = 2 * nT - 2 - j; return k === 2 ? -lat[(i * nT + m) * 3 + 2] : lat[(i * nT + m) * 3 + k]; }
    return lat[(i * nT + j) * 3 + k];
  };
  const P = (s, t, out = [0, 0, 0]) => {
    const fs = Math.min(0.999999, Math.max(0, s)) * (nS - 1), is = Math.floor(fs), us = fs - is;
    const ft = Math.min(0.999999, Math.max(0, t)) * (nT - 1), it = Math.floor(ft), ut = ft - it;
    // Catmull-Rom weights once, then sixteen lookups for each of x, y, z. This is the hottest loop in the page's start-up.
    const us2 = us * us, us3 = us2 * us, ut2 = ut * ut, ut3 = ut2 * ut;
    const w0 = 0.5 * (-us + 2 * us2 - us3), w1 = 0.5 * (2 - 5 * us2 + 3 * us3), w2 = 0.5 * (us + 4 * us2 - 3 * us3), w3 = 0.5 * (us3 - us2);
    const v0 = 0.5 * (-ut + 2 * ut2 - ut3), v1 = 0.5 * (2 - 5 * ut2 + 3 * ut3), v2 = 0.5 * (ut + 4 * ut2 - 3 * ut3), v3 = 0.5 * (ut3 - ut2);
    if (is >= r0 + 1 && is + 2 <= r1 && it >= 1 && it + 2 < nT) { // inside the lattice: no clamps and no mirrored rows
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (let m = -1; m <= 2; m++) {
          const o = ((is + m) * nT + it - 1) * 3 + k;
          sum += (m === -1 ? w0 : m === 0 ? w1 : m === 1 ? w2 : w3) * (v0 * lat[o] + v1 * lat[o + 3] + v2 * lat[o + 6] + v3 * lat[o + 9]);
        }
        out[k] = sum;
      }
      return out;
    }
    for (let k = 0; k < 3; k++) {
      const a = cr(pt(is - 1, it - 1, k), pt(is - 1, it, k), pt(is - 1, it + 1, k), pt(is - 1, it + 2, k), ut);
      const b = cr(pt(is, it - 1, k), pt(is, it, k), pt(is, it + 1, k), pt(is, it + 2, k), ut);
      const c = cr(pt(is + 1, it - 1, k), pt(is + 1, it, k), pt(is + 1, it + 1, k), pt(is + 1, it + 2, k), ut);
      const d = cr(pt(is + 2, it - 1, k), pt(is + 2, it, k), pt(is + 2, it + 1, k), pt(is + 2, it + 2, k), ut);
      out[k] = cr(a, b, c, d, us);
    }
    return out;
  };
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  const es = 1.2 / (nS - 1), et = 1.2 / (nT - 1);
  /** Outward unit normal. On the centreline it has no z, which is what closes the seam between the two halves. */
  const normal = (s, t, out = new THREE.Vector3()) => {
    s = Math.min(1 - 3 * es, Math.max(3 * es, s)); // the rows close to a point at the poles: take the normal just off it
    P(Math.min(1, s + es), t, a); P(Math.max(0, s - es), t, b); P(s, Math.min(1, t + et), c); P(s, Math.max(0, t - et), d);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
    out.set(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (out.lengthSq() < 1e-16) out.set(0, 1, 0); else out.normalize();
    if (t < 1e-4 || t > 1 - 1e-4) { out.z = 0; out.normalize(); }
    return out;
  };

  const VIEW = {side: [0, 1, 2, 1], top: [0, 2, 1, 1], bottom: [0, 2, 1, -1], front: [2, 1, 0, 1], rear: [2, 1, 0, -1]}; // two kept axes, the facing axis, its sign
  const nrm = new THREE.Vector3();
  /**
   * Finds (s, t) for a point given in a view: side [x, y], top or bottom [x, z], front or rear [z, y]. Only surface facing the
   * viewer counts. seed is a nearby answer, which skips the search of the whole lattice.
   */
  const locate = (view, q, seed = null, range = null) => {
    const [ia, ib, ic, sign] = VIEW[view];
    let bs = seed?.[0], bt = seed?.[1];
    if (!seed) {
      let best = Infinity;
      const [i0, i1] = range ?? [r0, r1];
      for (let i = i0; i <= i1; i += 2) for (let j = 0; j < nT; j += 2) {
        const o = (i * nT + j) * 3, da = lat[o + ia] - q[0], db = lat[o + ib] - q[1], e = da * da + db * db;
        if (e >= best) continue;
        normal(i / (nS - 1), j / (nT - 1), nrm);
        const facing = (ic === 0 ? nrm.x : ic === 1 ? nrm.y : nrm.z) * sign;
        if (facing < 0.02) continue;
        best = e; bs = i / (nS - 1); bt = j / (nT - 1);
      }
    }
    const h = 0.5 / (nS - 1), p = [0, 0, 0], ps = [0, 0, 0], pt2 = [0, 0, 0];
    for (let it = 0; it < 16; it++) { // each step is capped, and near a pole t has far to go: too few and lines wobble there
      const hs = bs > .5 ? -h : h, ht = bt > .5 ? -h : h; // one-sided, pointing away from the end of the range
      P(bs, bt, p); P(bs + hs, bt, ps); P(bs, bt + ht, pt2);
      const j11 = (ps[ia] - p[ia]) / hs, j12 = (pt2[ia] - p[ia]) / ht, j21 = (ps[ib] - p[ib]) / hs, j22 = (pt2[ib] - p[ib]) / ht;
      const ra = q[0] - p[ia], rb = q[1] - p[ib], det = j11 * j22 - j12 * j21;
      if (Math.abs(det) < 1e-9) break;
      const ds = (j22 * ra - j12 * rb) / det, dt = (j11 * rb - j21 * ra) / det, lim = 0.012;
      bs = Math.min(1, Math.max(0, bs + Math.max(-lim, Math.min(lim, ds))));
      bt = Math.min(1, Math.max(0, bt + Math.max(-lim, Math.min(lim, dt))));
      if (Math.abs(ra) + Math.abs(rb) < 2e-4) break;
    }
    return [bs, bt];
  };
  return {P, normal, locate, rows: nS, cols: nT, lat};
}

// ---- outlines ------------------------------------------------------------------------------

const catmull = (a, b, c, d, u) => [0, 1].map((k) => cr(a[k], b[k], c[k], d[k], u));

/**
 * A smooth polyline through control points. Repeat a point to make a corner. open: end at the last point. spacing in
 * the units of the points.
 */
export function smoothLine(pts, spacing = 0.03, closed = false) {
  const out = [], n = pts.length;
  const get = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2);
    const m = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / spacing));
    for (let k = 0; k < m; k++) out.push(catmull(a, b, c, d, k / m));
  }
  if (!closed) out.push([...pts[n - 1]]);
  return out;
}

/** A polyline in one view to (s, t), each point seeded from the one before, so a line stays on its own sheet of metal. */
export function trace(S, view, pts, {seed = null, range = null} = {}) {
  const out = [];
  let prev = seed;
  for (const p of pts) {
    prev = S.locate(view, p, prev, range);
    out.push(prev);
  }
  return out;
}

const signedArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
};

const resampleParam = (S, poly, step) => {
  const out = [], a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    S.P(p[0], p[1], a); S.P(q[0], q[1], b);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  return out;
};

/**
 * Moves a closed (s, t) outline inwards by `gap` metres along the surface, keeping corners. This is what opens a real
 * shut line between two panels cut from one shared line.
 */
export function inset(S, poly, gap) {
  const sign = signedArea(poly) > 0 ? 1 : -1, n = poly.length, out = [];
  const h = 1e-3, p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0], N = new THREE.Vector3(), T = new THREE.Vector3(), W = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], c = poly[(i + 1) % n], b = poly[i];
    S.P(b[0], b[1], p); S.P(b[0] + h, b[1], q); S.P(b[0], b[1] + h, r);
    U.set((q[0] - p[0]) / h, (q[1] - p[1]) / h, (q[2] - p[2]) / h);
    V.set((r[0] - p[0]) / h, (r[1] - p[1]) / h, (r[2] - p[2]) / h);
    T.copy(U).multiplyScalar(c[0] - a[0]).addScaledVector(V, c[1] - a[1]);
    N.crossVectors(U, V);
    W.crossVectors(N, T).multiplyScalar(sign);
    if (W.lengthSq() < 1e-16) { out.push(b); continue; }
    W.normalize();
    const uu = U.dot(U), uv = U.dot(V), vv = V.dot(V), det = uu * vv - uv * uv, wu = W.dot(U), wv = W.dot(V);
    const ns = b[0] + (gap * (vv * wu - uv * wv)) / det, nt = b[1] + (gap * (uu * wv - uv * wu)) / det;
    // the centreline is not a shut line: points on it stay on it
    out.push(b[1] < 1e-5 || b[1] > 1 - 1e-5 ? [ns, b[1]] : b[0] > 1 - 1e-5 ? [b[0], nt] : [ns, nt]);
  }
  return out;
}

// ---- the cutter ----------------------------------------------------------------------------

const clipStrip = (poly, a, b, axis) => {
  const lerp = (p, q, v) => { const u = (v - p[axis]) / (q[axis] - p[axis]); return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]; };
  const cut = (input, keep, v) => {
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i], q = input[(i + 1) % input.length], ip = keep(p[axis]), iq = keep(q[axis]);
      if (ip) out.push(p);
      if (ip !== iq) out.push(lerp(p, q, v));
    }
    return out;
  };
  const low = cut(poly, (x) => x >= a, a);
  return low.length ? cut(low, (x) => x <= b, b) : low;
};

/** Thin triangles along a line of cells are fine, zero-area ones are not. */
const dedupe = (poly) => poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-9; });

/**
 * Cuts a panel out of S. poly is a closed [s, t] outline. The edge rolls over a small radius and turns inward as a
 * flange, so a shut line catches light like pressed steel and a lifted panel has real thickness.
 * both: build the panel across the centreline too (bonnet, boot lid, bumpers). cells: grid density along s. push: move
 * the whole skin along its normal, for trims and lenses that sit proud or below the paint.
 */
export function panelGeometry(S, poly, {cells = 230, flange = 0.016, roll = 0.0035, both = false, push = 0, edgeStep = 0.014} = {}) {
  const ds = 1 / cells, dt = 2 / cells;
  const pos = [], nor = [], idx = [], map = new Map();
  const p = [0, 0, 0], N = new THREE.Vector3();
  const vert = (s, t) => {
    const key = `${Math.round(s * 4e6)},${Math.round(t * 4e6)}`;
    const hit0 = map.get(key);
    if (hit0 !== undefined) return hit0;
    S.P(s, t, p); S.normal(s, t, N);
    pos.push(p[0] + N.x * push, p[1] + N.y * push, p[2] + N.z * push);
    nor.push(N.x, N.y, N.z);
    map.set(key, pos.length / 3 - 1);
    return pos.length / 3 - 1;
  };
  const clean = dedupe(poly);
  const orient = signedArea(clean) > 0 ? 1 : -1;
  const tri = (a, b, c) => idx.push(a, b, c);
  // Row by row: a clip against the row strip first, so each cell only meets the few edges near it.
  const sMin = Math.min(...clean.map((q) => q[0])), sMax = Math.max(...clean.map((q) => q[0]));
  for (let i = Math.floor(sMin / ds); i < Math.ceil(sMax / ds); i++) {
    const a0 = i * ds, a1 = (i + 1) * ds;
    const strip = clipStrip(clean, a0, a1, 0);
    if (strip.length < 3) continue;
    const tMin = Math.min(...strip.map((q) => q[1])), tMax = Math.max(...strip.map((q) => q[1]));
    for (let j = Math.floor(tMin / dt); j < Math.ceil(tMax / dt); j++) {
      const c = dedupe(clipStrip(strip, j * dt, (j + 1) * dt, 1));
      if (c.length < 3) continue;
      const faces = THREE.ShapeUtils.triangulateShape(c.map((q) => new THREE.Vector2(q[0], q[1])), []);
      for (const f of faces) {
        const A = c[f[0]], B = c[f[1]], C = c[f[2]];
        const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (Math.abs(area) < 1e-14) continue;
        const va = vert(A[0], A[1]), vb = vert(B[0], B[1]), vc = vert(C[0], C[1]);
        // with s along the car and t down its side, +s x +t points out of the body on the +z half
        if (area > 0) tri(va, vb, vc); else tri(va, vc, vb);
      }
    }
  }
  const skin = pos.length / 3; // the cut face, before any edge: what fieldNormals shades
  if (flange > 0 || roll > 0) {
    const edge = resampleParam(S, clean, edgeStep), n = edge.length;
    const h = 1e-3, W = new THREE.Vector3(), T = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3(), q = [0, 0, 0], r = [0, 0, 0];
    const rings = [[0, 0, 0], [0.7, 0.29, 0.7], [1, 1, 1], [1, 1 + flange / Math.max(roll, 1e-4), 1]]; // out along W, in along -N, how far the normal has turned
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const e = edge[i], a = edge[(i + n - 1) % n], b = edge[(i + 1) % n];
      S.P(e[0], e[1], p); S.normal(e[0], e[1], N);
      S.P(e[0] + h, e[1], q); S.P(e[0], e[1] + h, r);
      U.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).multiplyScalar(1 / h);
      V.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]).multiplyScalar(1 / h);
      T.copy(U).multiplyScalar(b[0] - a[0]).addScaledVector(V, b[1] - a[1]);
      W.crossVectors(T, N).multiplyScalar(orient).normalize(); // points out of the panel, in the skin
      for (const [out, down, turn] of rings) {
        const nx = N.x * (1 - turn) + W.x * turn, ny = N.y * (1 - turn) + W.y * turn, nz = N.z * (1 - turn) + W.z * turn;
        const l = Math.hypot(nx, ny, nz) || 1;
        const shift = roll * (out - 1), sink = roll * down;
        pos.push(p[0] + W.x * shift - N.x * (sink - push), p[1] + W.y * shift - N.y * (sink - push), p[2] + W.z * shift - N.z * (sink - push));
        nor.push(nx / l, ny / l, nz / l);
      }
    }
    const R = rings.length;
    const open = (e) => e[1] < 1e-5 || e[1] > 1 - 1e-5 || e[0] > 1 - 1e-5; // on the centreline or the pole: no edge there
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      if (open(edge[i]) && open(edge[i2])) continue;
      for (let k = 0; k < R - 1; k++) {
        const a = base + i * R + k, b = base + i2 * R + k, c = base + i * R + k + 1, d = base + i2 * R + k + 1;
        if (orient > 0) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); }
      }
    }
  }
  if (both) {
    const nv = pos.length / 3, ni = idx.length;
    for (let i = 0; i < nv; i++) { pos.push(pos[i * 3], pos[i * 3 + 1], -pos[i * 3 + 2]); nor.push(nor[i * 3], nor[i * 3 + 1], -nor[i * 3 + 2]); }
    for (let i = 0; i < ni; i += 3) idx.push(idx[i] + nv, idx[i + 2] + nv, idx[i + 1] + nv);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.userData.skin = {count: skin, mirror: both ? pos.length / 6 : 0};
  return g;
}

/**
 * Sweeps a small section along an (s, t) line on the surface: chrome strips, rubbers, lips. profile [[w, n], ...] in
 * metres, w across the line, n out of the surface. Open lines are left open: end them under something.
 */
export function sweep(S, line, profile, {closed = false, step = 0.02, flip = false} = {}) {
  const pts = [];
  const a = [0, 0, 0], b = [0, 0, 0];
  const count = closed ? line.length : line.length - 1;
  for (let i = 0; i < count; i++) {
    const p = line[i], q = line[(i + 1) % line.length];
    S.P(p[0], p[1], a); S.P(q[0], q[1], b);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
    for (let k = 0; k < n; k++) pts.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  if (!closed) pts.push(line[line.length - 1]);
  const m = profile.length, cols = m, pos = [], nor = [], idx = [];
  const N = new THREE.Vector3(), T = new THREE.Vector3(), W = new THREE.Vector3(), c = [0, 0, 0], d = [0, 0, 0];
  const L = pts.length;
  // section normals: turn the section's own tangent by 90 degrees
  const pn = profile.map((_, j) => {
    const e = profile[Math.min(m - 1, j + 1)], f = profile[Math.max(0, j - 1)];
    const dw = e[0] - f[0], dn = e[1] - f[1], l = Math.hypot(dw, dn) || 1;
    return [-dn / l, dw / l];
  });
  for (let i = 0; i < L; i++) {
    const e = pts[i], g = closed ? pts[(i + 1) % L] : pts[Math.min(L - 1, i + 1)], h = closed ? pts[(i + L - 1) % L] : pts[Math.max(0, i - 1)];
    S.P(g[0], g[1], c); S.P(h[0], h[1], d); S.P(e[0], e[1], a); S.normal(e[0], e[1], N);
    T.set(c[0] - d[0], c[1] - d[1], c[2] - d[2]).normalize();
    W.crossVectors(N, T).normalize();
    if (flip) W.negate();
    for (let j = 0; j < m; j++) {
      const [w, n] = profile[j], [nw, nn] = pn[j];
      pos.push(a[0] + W.x * w + N.x * n, a[1] + W.y * w + N.y * n, a[2] + W.z * w + N.z * n);
      const x = W.x * nw + N.x * nn, y = W.y * nw + N.y * nn, z = W.z * nw + N.z * nn;
      const l = Math.hypot(x, y, z) || 1;
      nor.push(x / l, y / l, z / l);
    }
  }
  const last = closed ? L : L - 1;
  for (let i = 0; i < last; i++) for (let j = 0; j < m - 1; j++) {
    const i2 = (i + 1) % L;
    const p = i * cols + j, q = i2 * cols + j, r = i * cols + j + 1, u = i2 * cols + j + 1;
    if (flip) idx.push(p, r, q, q, r, u); else idx.push(p, q, r, q, u, r);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Takes the kinks out of an open (s, t) polyline where tables join, ends held. Points should be about evenly spaced.
 * onCentre: the line starts on the centreline, so that end is free along it, as if the line ran on through its mirror image.
 */
export function fair(line, passes = 8, onCentre = false) {
  let a = line.map((p) => [...p]);
  for (let k = 0; k < passes; k++) {
    const b = a.map((p) => [...p]);
    for (let i = 1; i < a.length - 1; i++) for (const j of [0, 1]) b[i][j] = (a[i - 1][j] + 2 * a[i][j] + a[i + 1][j]) / 4;
    if (onCentre) b[0][0] = (a[0][0] + a[1][0]) / 2;
    a = b;
  }
  return a;
}

/**
 * Shades a panel from the solid and not from the lattice, where rows cross a rolled edge at an angle and alias the highlight.
 * Only the cut face is touched: the rolled edge and flange keep their own normals. Costs four field calls a vertex.
 */
export function fieldNormals(g, field, eps = 0.005) {
  const p = g.attributes.position, n = g.attributes.normal, e = eps, {count, mirror} = g.userData.skin;
  const at = (x, y, z) => field(x, y, Math.abs(z)); // the solid only runs on z >= 0, and is mirrored past the centreline
  const shade = (i) => {
    const x = p.getX(i), y = p.getY(i), z = Math.abs(p.getZ(i));
    const a = at(x + e, y - e, z - e), b = at(x - e, y - e, z + e), c = at(x - e, y + e, z - e), d = at(x + e, y + e, z + e); // tetrahedron gradient
    const nx = a - b - c + d, ny = -a - b + c + d, nz = z < e ? 0 : -a + b - c + d;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    n.setXYZ(i, nx / l, ny / l, (nz * (p.getZ(i) < 0 ? -1 : 1)) / l);
  };
  for (let i = 0; i < count; i++) shade(i);
  const all = mirror || p.count;
  for (let i = count; i + 3 < all; i += 4) { // the rolled edge, four rings a point: its first ring is skin, its second turns towards the fourth
    shade(i);
    const x = n.getX(i) * .3 + n.getX(i + 3) * .7, y = n.getY(i) * .3 + n.getY(i + 3) * .7, z = n.getZ(i) * .3 + n.getZ(i + 3) * .7, l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i + 1, x / l, y / l, z / l);
  }
  if (mirror) for (let i = 0; i < mirror; i++) n.setXYZ(mirror + i, n.getX(i), n.getY(i), -n.getZ(i));
  n.needsUpdate = true;
  return g;
}

/** Side-view outline [[x, y], ...] in metres to parameter space. */
export const fromSide = (S, pts, seed = null) => trace(S, 'side', pts, {seed});

// ---- the X100 ------------------------------------------------------------------------------
// Numbers are metres off the reference elevations in ref/images, scaled by the 2588 mm wheelbase, with the overhangs
// stretched to the real 4760 mm as ref/images/SOURCES.md says. Every table is an estimate from those images: no section
// dimensions of this car were found. tools/silhouette.mjs scores them against the photos, docs/body-hillclimb.md logs it.

export const WHEELBASE = 2.588;
export const AXLE_F = WHEELBASE / 2, AXLE_R = -WHEELBASE / 2;
export const NOSE_X = 2.144, TAIL_X = -2.616; // estimated: length 4760 mm, front overhang share .39 from the master elevation
export const ARCH_R = {f: 0.378, r: 0.392}, ARCH_Y = {f: 0.335, r: 0.33}; // arch radius and centre height, estimated from the master elevation

export const SHAPE = {
  // Deck: the top of the lower body. Centre height along the car, bonnet then the belt then the rear deck.
  crownFront: curve([[2.144, .46], [2.125, .515], [2.09, .558], [2.014, .617], [1.899, .686], [1.784, .745], [1.553, .803], [1.32, .839], [1.105, .873], [.911, .90], [.752, .916], [.4, .925], [0, .93], [-.6, .94], [-1.2, .985], [-1.6, 1.0]]),
  crownRearCoupe: curve([[-1.6, 1.0], [-1.9, 1.0], [-2.054, .999], [-2.184, .978], [-2.314, .963], [-2.411, .953], [-2.481, .932], [-2.524, .905], [-2.56, .86]]),
  crownRearConv: curve([[-1.3, 1.0], [-1.7, .995], [-2.054, .992], [-2.184, .978], [-2.314, .963], [-2.411, .953], [-2.481, .932], [-2.524, .905], [-2.56, .86]]),
  // Height of the shoulder, where the top of the body rolls into its side. This is the rising waistline.
  shoulder: curve([[2.1, .58], [1.95, .655], [1.6, .75], [1.1, .81], [.6, .855], [0, .885], [-.6, .925], [-1.0, .972], [-1.3, .995], [-1.7, .985], [-2.1, .935], [-2.4, .875], [-2.56, .80]]),
  shoulderZ: .80,
  cornerDrop: .45,
  bulge: .027, // height of the raised centre of the bonnet
  crest: .026, // and of the soft crest beside it, read off the low front photo
  // Plan half-width of the body side at its widest, and the height of that widest point.
  plan: curve([[2.1, .86], [1.6, .872], [1.3, .893], [.9, .892], [.3, .886], [-.4, .892], [-.9, .905], [-1.35, .9145], [-1.7, .905], [-1.95, .878], [-2.15, .80], [-2.25, .755], [-2.35, .70], [-2.45, .62], [-2.6, .46]]),
  waist: curve([[2.1, .55], [1.3, .60], [.3, .62], [-.6, .63], [-1.35, .66], [-2.1, .68], [-2.6, .68]]),
  sideUp: curve([[2.1, .13], [1.3, .10], [.3, .085], [-.6, .08], [-1.35, .07], [-2.1, .10], [-2.6, .12]]),
  sideDown: curve([[2.15, .36], [1.8, .27], [1.55, .13], [1.3, .09], [.3, .075], [-.6, .075], [-1.35, .08], [-1.75, .11], [-2.05, .22], [-2.35, .31], [-2.6, .36]]),
  // Nose and tail walls: how far the end of the car reaches at each height on the centreline, then a superellipse in plan.
  noseAt: curve([[.18, 1.80], [.207, 1.83], [.225, 1.922], [.275, 2.037], [.318, 2.094], [.372, 2.135], [.436, NOSE_X], [.489, 2.135], [.558, 2.10], [.65, 2.05], [.9, 2.05]]),
  nosePlan: {xc: 1.40, b: .895, n: 3.4},
  tailAt: curve([[.18, -2.2], [.40, -2.50], [.50, -2.535], [.635, -2.539], [.736, -2.53], [.80, -2.525], [.855, -2.532], [.88, -2.545], [.905, -2.53], [.93, -2.50], [1.0, -2.42]]),
  tailBumper: curve([[.18, -2.2], [.297, -2.367], [.345, -2.443], [.432, -2.54], [.453, -2.572], [.50, -2.60], [.53, TAIL_X], [.56, -2.60], [.60, -2.565], [.72, -2.54], [.95, -2.5]]),
  tailPlan: {xc: -1.72, b: .925, n: 3}, // the boat tail: 100 mm in at the lamps from the first model, fitted on the plate-scaled rear overlays
  // Underside.
  under: curve([[2.2, .34], [2.037, .275], [1.922, .225], [1.83, .207], [1.686, .20], [1.3, .195], [0, .194], [-1.3, .196], [-1.79, .229], [-1.854, .229], [-2.151, .262], [-2.367, .297], [-2.443, .345], [-2.54, .432], [-2.7, .5]]),
  // Greenhouse: roof line down the centre (windscreen, roof, rear screen), how far it falls towards the side, and the side glass.
  roof: curve([[.82, .80], [.70, .885], [.643, .926], [.597, .95], [.505, 1.0], [.414, 1.046], [.323, 1.09], [.231, 1.136], [.14, 1.18], [.052, 1.229], [.003, 1.254], [-.18, 1.279], [-.363, 1.290], [-.546, 1.295], [-.728, 1.292], [-.82, 1.285], [-.957, 1.269], [-1.087, 1.252], [-1.147, 1.242], [-1.293, 1.21], [-1.422, 1.18], [-1.568, 1.142], [-1.714, 1.105], [-1.811, 1.078], [-1.909, 1.045], [-1.998, 1.019], [-2.06, .985], [-2.2, .90]]),
  roofFall: curve([[.8, .085], [.44, .09], [.1, .075], [-.2, .08], [-.9, .085], [-1.3, .10], [-1.7, .10], [-2.0, .08], [-2.3, .05]]),
  roofPow: curve([[.8, 2.2], [-.9, 2.3], [-1.4, 2.0], [-2.3, 2.0]]),
  glassZ: curve([[.75, .85], [.4, .838], [-.2, .835], [-.7, .822], [-1.1, .79], [-1.4, .76], [-1.8, .73], [-2.2, .70]]),
  glassLean: curve([[.75, .68], [-.7, .68], [-1.4, .62], [-2.2, .55]]),
  blend: curve([[.9, .03], [-.55, .03], [-.95, .10], [-1.3, .17], [-2.0, .15], [-2.1, .06]]),
  // The hood, roof up, off side-convertible-xk8-42-roof-up.jpg: higher and shorter than the coupe roof, and it stops on the deck.
  hood: curve([[.82, .80], [.70, .885], [.643, .926], [.597, .95], [.505, 1.0], [.414, 1.046], [.323, 1.09], [.231, 1.136], [.14, 1.18], [.052, 1.229], [.01, 1.25], [-.18, 1.292], [-.40, 1.306], [-.70, 1.287], [-.90, 1.25], [-1.05, 1.18], [-1.25, 1.075], [-1.42, 1.01], [-1.55, .965], [-1.7, .90]]),
  hoodFall: curve([[.8, .085], [.44, .09], [.1, .08], [-.2, .10], [-.8, .10], [-1.1, .10], [-1.5, .06]]),
  hoodGlass: curve([[.75, .85], [.4, .838], [-.2, .835], [-.7, .822], [-1.0, .79], [-1.3, .72], [-1.6, .66]]),
};

export const planNose = (z) => { const {xc, b, n} = SHAPE.nosePlan, u = Math.min(1, z / b); return Math.pow(1 - Math.pow(u, n), 1 / n); };
export const planTail = (z) => { const {xc, b, n} = SHAPE.tailPlan, u = Math.min(1, z / b); return Math.pow(1 - Math.pow(u, n), 1 / n); };

/** Half-width of the body side at (x, y), the door skin and wings. */
export function sideZ(x, y) {
  const w = SHAPE.plan(x), m = SHAPE.waist(x), d = y > m ? (y - m) / 0.4 : (m - y) / 0.4;
  return w - (y > m ? SHAPE.sideUp(x) : SHAPE.sideDown(x)) * d * d;
}

/**
 * The solid. Negative inside. body 'coupe' adds the greenhouse. Runs on z >= 0.
 */
export function makeField({body = 'coupe', bumper = false, facelift = false} = {}) {
  const coupe = body !== 'convertible' && body !== 'hood';
  const tailAt = bumper ? SHAPE.tailBumper : SHAPE.tailAt;
  const spoiler = facelift ? FACELIFT : null;
  const crownRear = coupe ? SHAPE.crownRearCoupe : SHAPE.crownRearConv;
  const nx0 = SHAPE.nosePlan.xc, tx0 = SHAPE.tailPlan.xc;
  const lower = (x, y, z) => {
    const nose = planNose(z), tail = planTail(z);
    // near the ends, the centreline tables follow the plan outline round the corners
    const xe = x > 1.2 ? x + (NOSE_X - nx0) * (1 - nose) * smooth(1.2, 1.8, x) : x;
    // the deck falls less towards the corners than the outline: the head-on photo shows broad shoulders over the lamps
    const xc = x > 1.2 ? x + (NOSE_X - nx0) * (1 - nose) * smooth(1.2, 1.8, x) * SHAPE.cornerDrop : x;
    let crown = xc > -1.6 ? SHAPE.crownFront(xc) : crownRear(x - (TAIL_X - tx0) * (1 - tail) * smooth(-1.7, -2.3, x));
    crown -= SHAPE.bulge * smooth(.17, .275, z) * smooth(.62, .95, x) * (1 - smooth(1.85, 2.05, x)); // the raised centre of the bonnet
    const sh = SHAPE.shoulder(xc), zs = SHAPE.shoulderZ, u = z / zs;
    // Over the front wheels the bonnet falls away from its raised centre, then lifts to a soft crest before the wing rolls over.
    const crest = SHAPE.crest * Math.exp(-(((z - .63) / .13) ** 2)) * smooth(.9, 1.3, x) * (1 - smooth(1.8, 2.05, x));
    const top = y - (crown + crest + (sh - crown) * Math.pow(u, 2.8));
    const side = z - sideZ(x, y);
    const noseWall = x - (nx0 + (SHAPE.noseAt(y) + (spoiler ? spoiler.grow + spoiler.lipF * (1 - smooth(.2, .285, y)) : 0) - nx0) * nose);
    let tailWall = (tx0 + (tailAt(y) + (spoiler && bumper ? -spoiler.shelfR * (1 - smooth(.43, .455, y)) : 0) - tx0) * tail) - x;
    if (!bumper && x < -2.3 && z < .42 && y > .58 && y < .80) { // the soft recess round the rear plate
      const {cy, hw, hh, r, depth, edge} = PLATE_RECESS, qz = z - hw + r, qy = Math.abs(y - cy) - hh + r;
      tailWall += depth * (1 - smooth(-edge, edge, Math.hypot(Math.max(qz, 0), Math.max(qy, 0)) + Math.min(Math.max(qz, qy), 0) - r));
    }
    let under = SHAPE.under(xe) - y;
    if (spoiler) { // the last cars carry deeper valances and are 15 mm longer: data says so, the split is estimated
      under -= spoiler.dropF * smooth(1.68, 1.9, x) + spoiler.dropR * smooth(-1.8, -2.1, x);
    }
    let f = smax(top, side, .09);
    f = smax(f, noseWall, .035);
    f = smax(f, tailWall, .06);
    f = smax(f, under, .03);
    if (x > 1.85 && y < .52 && y > .3 && z > .55) { // the fog lamp socket, a soft scoop in the bumper corner: side-coupe-xk8-40-early-pure-elevation.jpg
      const dx = (x - FOG_SOCKET.x) / FOG_SOCKET.r, dy = (y - FOG_SOCKET.y) / FOG_SOCKET.ry, dz = (z - FOG_SOCKET.z) / FOG_SOCKET.r;
      f = smax(f, FOG_SOCKET.r * (1 - Math.sqrt(dx * dx + dy * dy + dz * dz)), .022);
    }
    return f;
  };
  if (body === 'convertible') return (x, y, z) => lower(x, y, z);
  const hood = body === 'hood';
  const line = hood ? SHAPE.hood : SHAPE.roof, fall = hood ? SHAPE.hoodFall : SHAPE.roofFall, gz = hood ? SHAPE.hoodGlass : SHAPE.glassZ;
  return (x, y, z) => {
    const a = lower(x, y, z);
    if (x > .95 || x < -2.45) return a;
    const roof = y - (line(x) - fall(x) * Math.pow(z / .6, SHAPE.roofPow(x)));
    const glass = z - (gz(x) - Math.max(0, y - .93) * SHAPE.glassLean(x));
    const g = smax(smax(roof, glass, .07), .72 - y, .02);
    return smin(a, g, SHAPE.blend(x));
  };
}

const PLATE_RECESS = {cy: .685, hw: .335, hh: .082, r: .05, depth: .016, edge: .022}; // half width, half height, corner radius, depth and shoulder, off the rear photo at the plate's scale
const FOG_SOCKET = {x: 2.05, y: .415, z: .762, r: .095, ry: .074}; // an ellipsoid standing just off the corner, estimated
const FACELIFT = {dropF: .05, dropR: .05, grow: .0075, lipF: .03, shelfR: .028}; // the deeper valances, the front's raised lip and the rear's stepped shelf: estimated from the late cars in the side photos
export const SPINE = {nose: [1.56, .40], tail: [-2.02, .66]};
const SPINE_BUMPER = {nose: [1.56, .40], tail: [-2.02, .325]}; // the bumper surface has its pole down under the bumper's lower curve: on its face the rows pinched to a V

const BUMPER_FROM = 0.72; // of the way along the surface: the rear bumper's skin is only ever cut from here back
const LOW_Y = 0.5; // below this the coupe, convertible and hood solids are the same solid, to well past their blend radius
const LATE_X = [-1.68, 1.58]; // and the last cars' valances change nothing between these

/** What each solid can take from one already sampled: rays are most of the page's start-up time. */
function reuse(body, opts) {
  if (opts.facelift) return {base: bodySurface(body, {...opts, facelift: false}), same: (x) => x > LATE_X[0] && x < LATE_X[1]};
  if (!opts.bumper && body === 'convertible') return {base: bodySurface('coupe', opts), same: (x, y) => y < LOW_Y};
  if (!opts.bumper && body === 'hood') return {base: bodySurface('coupe', opts), same: (x, y) => y < LOW_Y};
  return {};
}

const cache = new Map();
/**
 * The sampled surface, built once. opts: bumper, the rear bumper's skin, which stands proud of the tail; facelift, the
 * last cars' deeper valances.
 */
export function bodySurface(body = 'coupe', opts = {}) {
  const key = `${body}:${!!opts.bumper}:${!!opts.facelift}:${opts.rows ?? 340}`;
  if (!cache.has(key)) {
    const spine = opts.bumper ? SPINE_BUMPER : SPINE;
    const rows = opts.rows ?? 340;
    const {base, same} = reuse(body, opts);
    cache.set(key, sampleSurface(makeField({body, ...opts}), {spine, rows, cols: opts.cols ?? 170, base: base?.raw, same, sRange: opts.bumper ? [Math.floor(rows * BUMPER_FROM), rows - 1] : null}));
  }
  return cache.get(key);
}
