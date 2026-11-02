// Browser side, injected by tools/job-walk.mjs and tools/lift-solve.mjs. A uniform grid over every triangle of the car as
// it sits at rest, so a part can be swept along a lift vector against everything else in milliseconds. No three.js here.
window.createRayScene = function createRayScene(x, {cell = 0.05} = {}) {
  const insts = []; // every visible instance: {id, inst}
  const posV = [];
  const tris = []; // arrays of per-mesh triangle data
  let total = 0;
  const v = new x.three.Vector3();
  for (const part of x.registry.all()) for (const inst of part.instances) {
    if (!inst.rig.visible) continue;
    const index = insts.length;
    insts.push({id: part.id, inst, index});
    inst.rig.updateWorldMatrix(true, true);
    const [ox, oy, oz] = inst.cur; // the rig may be lifted or exploded: remove its offset
    for (const m of inst.meshes) {
      const a = m.geometry.attributes.position, idx = m.geometry.index;
      const n = (idx ? idx.count : a.count) / 3;
      const data = new Float32Array(n * 9);
      for (let i = 0; i < n * 3; i++) {
        const k = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(a, k).applyMatrix4(m.matrixWorld);
        data[i * 3] = v.x - ox; data[i * 3 + 1] = v.y - oy; data[i * 3 + 2] = v.z - oz;
      }
      tris.push({data, index});
      total += n;
    }
  }
  const T = new Float32Array(total * 9), owner = new Int32Array(total);
  { let o = 0; for (const {data, index} of tris) { T.set(data, o * 9); owner.fill(index, o, o + data.length / 9); o += data.length / 9; } }
  const min = [-3.2, -0.3, -1.3], max = [3.2, 3.2, 1.3];
  const nx = Math.ceil((max[0] - min[0]) / cell), ny = Math.ceil((max[1] - min[1]) / cell), nz = Math.ceil((max[2] - min[2]) / cell);
  const cellOf = (a, b, c) => a + nx * (b + ny * c);
  const clampI = (i, n) => (i < 0 ? 0 : i >= n ? n - 1 : i);
  const count = new Int32Array(nx * ny * nz + 1);
  const each = (t, fn) => {
    const o = t * 9;
    const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
    const y0 = Math.min(T[o + 1], T[o + 4], T[o + 7]), y1 = Math.max(T[o + 1], T[o + 4], T[o + 7]);
    const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    const ax = clampI(Math.floor((x0 - min[0]) / cell), nx), bx = clampI(Math.floor((x1 - min[0]) / cell), nx);
    const ay = clampI(Math.floor((y0 - min[1]) / cell), ny), by = clampI(Math.floor((y1 - min[1]) / cell), ny);
    const az = clampI(Math.floor((z0 - min[2]) / cell), nz), bz = clampI(Math.floor((z1 - min[2]) / cell), nz);
    for (let c = az; c <= bz; c++) for (let b = ay; b <= by; b++) for (let a = ax; a <= bx; a++) fn(cellOf(a, b, c));
  };
  for (let t = 0; t < total; t++) each(t, (c) => { count[c + 1]++; });
  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  const items = new Int32Array(count[count.length - 1]);
  const fill = count.slice();
  for (let t = 0; t < total; t++) each(t, (c) => { items[fill[c]++] = t; });
  const stamp = new Int32Array(total);
  let ray = 0;

  /**
   * Casts one ray. kind is a Uint8Array over instances: 0 ignores it, anything else is a class. best[class] gets the nearest
   * distance hit in that class. perInst, if given, gets a count for every instance crossed.
   */
  function cast(ox, oy, oz, dx, dy, dz, near, far, kind, best, perInst, counts) {
    ray++;
    let i = Math.floor((ox - min[0]) / cell), j = Math.floor((oy - min[1]) / cell), k = Math.floor((oz - min[2]) / cell);
    const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1, stepK = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? cell / Math.abs(dx) : Infinity, tdy = dy !== 0 ? cell / Math.abs(dy) : Infinity, tdz = dz !== 0 ? cell / Math.abs(dz) : Infinity;
    const edge = (o, m, c, d, idx) => { if (d === 0) return Infinity; const b = m + (idx + (d > 0 ? 1 : 0)) * c; return (b - o) / d; };
    let tx = edge(ox, min[0], cell, dx, i), ty = edge(oy, min[1], cell, dy, j), tz = edge(oz, min[2], cell, dz, k);
    let t = 0;
    const seen = perInst ? new Set() : null;
    while (t <= far) {
      if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) {
        const c = cellOf(i, j, k);
        for (let e = count[c]; e < count[c + 1]; e++) {
          const q = items[e];
          if (stamp[q] === ray) continue;
          stamp[q] = ray;
          const cl = kind[owner[q]];
          if (!cl) continue;
          const o = q * 9;
          const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
          const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det;
          const sx = ox - T[o], sy = oy - T[o + 1], sz = oz - T[o + 2];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const w = (dx * qx + dy * qy + dz * qz) * inv;
          if (w < 0 || u + w > 1) continue;
          const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (d < near || d > far) continue;
          if (d < best[cl]) best[cl] = d;
          if (seen) seen.add(owner[q]);
          if (counts) counts[owner[q]]++;
        }
      }
      if (tx < ty && tx < tz) { t = tx; tx += tdx; i += stepI; }
      else if (ty < tz) { t = ty; ty += tdy; j += stepJ; }
      else { t = tz; tz += tdz; k += stepK; }
    }
    if (seen) for (const s of seen) perInst[s]++;
  }

  /** Up to n vertices of an instance at rest, in car space. */
  function points(entry, n) {
    const {inst} = entry;
    const out = [];
    const total = inst.meshes.reduce((c, m) => c + m.geometry.attributes.position.count, 0);
    const stride = Math.max(1, Math.floor(total / n));
    const [ox, oy, oz] = inst.cur;
    inst.rig.updateWorldMatrix(true, true);
    for (const m of inst.meshes) {
      const a = m.geometry.attributes.position;
      for (let i = 0; i < a.count; i += stride) {
        v.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld);
        out.push(v.x - ox, v.y - oy, v.z - oz);
      }
    }
    return out;
  }

  /** The kind array for a pose result: 0 for what is off the car, 1 solid, 2 ghost. self is excluded. live reads the looks now on screen. */
  function kinds(result, selfId, live = false) {
    const out = new Uint8Array(insts.length);
    for (const e of insts) {
      if (e.id === selfId) continue;
      const p = result.parts.get(e.id);
      if (!p || !p.visible) continue;
      const lead = e.inst.follows ? result.parts.get(e.inst.follows) : null;
      if (p.lift || lead?.lift) continue;
      const away = result.end !== 0 && x.registry.get(e.id).ends.size > 1 && e.inst.end !== result.end;
      out[e.index] = (live ? e.inst.look : p.look) === 'ghost' || away ? 2 : 1;
    }
    return out;
  }

  return {insts, total, cast, points, kinds, cells: items.length, byId(id) { return insts.filter((e) => e.id === id); }};
};
