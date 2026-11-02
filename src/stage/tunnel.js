// In a job the car stays a car: solid, with one sightline cut from the camera to the part in work. Whatever sits on that
// line thins to a ghost, whatever does not stays as it is, so you can see where the part lives. A voxel map of the resting
// car makes the question cheap enough to ask every frame while the view orbits. It builds on the first job step.
import * as THREE from 'three';

const VOXEL = 0.08; // metres
const REACH = 0.11, REACH_MAX = 0.3; // half-width of the sightline away from the part, wider for a big part
const TAPER = 0.3, NARROW = 0.25; // over this distance the sightline narrows to the part, so its neighbours keep their shape
const LINE_EVERY = 0.14, MAX_LINES = 5;
const NEAR_FACE = 0.35; // of the way out to the part's near face: what touches it on the camera's side thins too
const MOVERS = new Set(['body.bonnet', 'body.bonnet-liner', 'body.boot-lid']); // not where the map says
const key = (i, j, k) => (i + 512) + (j + 512) * 1024 + (k + 512) * 1048576;

function voxels(registry) {
  const map = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const mark = (x, y, z, inst) => {
    const k = key(Math.floor(x / VOXEL), Math.floor(y / VOXEL), Math.floor(z / VOXEL));
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    if (list[list.length - 1] !== inst && !list.includes(inst)) list.push(inst);
  };
  for (const part of registry.all()) {
    if (MOVERS.has(part.id)) continue;
    for (const inst of part.instances) {
      const [ox, oy, oz] = inst.cur;
      inst.rig.updateWorldMatrix(true, true);
      for (const m of inst.meshes) {
        const pos = m.geometry.attributes.position, idx = m.geometry.index;
        const n = (idx ? idx.count : pos.count) / 3;
        for (let t = 0; t < n; t++) {
          const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
          a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
          b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
          c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
          const span = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
          if (span < VOXEL) { mark(a.x - ox, a.y - oy, a.z - oz, inst); continue; } // most triangles: one corner is enough
          const steps = Math.min(8, Math.ceil(span / VOXEL));
          for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
            const w = u / steps, q = v / steps, r = 1 - w - q;
            p.set(a.x * w + b.x * q + c.x * r - ox, a.y * w + b.y * q + c.y * r - oy, a.z * w + b.z * q + c.z * r - oz);
            mark(p.x, p.y, p.z, inst);
          }
        }
      }
    }
  }
  return map;
}

export function createTunnel(registry) {
  let map = null;
  const out = new Set();
  const box = new THREE.Box3(), world = new THREE.Box3(), c = new THREE.Vector3(), d = new THREE.Vector3(), s = new THREE.Vector3(), tip = new THREE.Vector3();

  /** Instances on the line from the camera to the parts in focus. near picks which of a pair: the one the rig looks at. */
  function find(camera, focus, near) {
    if (!map) map = voxels(registry);
    out.clear();
    const free = []; // what has left its place in the map
    for (const part of registry.all()) for (const inst of part.instances) {
      if (!inst.rig.visible) continue;
      if (MOVERS.has(part.id)) {
        box.makeEmpty();
        inst.rig.updateWorldMatrix(true, true);
        for (const m of inst.meshes) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); box.union(world.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); }
        free.push({inst, box: box.clone()});
      } else if (inst.cur[0] || inst.cur[1] || inst.cur[2]) free.push({inst, box: registry.currentBox(inst)});
    }
    for (const id of focus) {
      const inst = registry.nearest(id, near);
      if (!inst) continue;
      const b = registry.currentBox(inst);
      b.getCenter(c);
      b.getSize(s);
      const size = Math.max(s.x, s.y, s.z);
      // A long part, like a bank of four plugs, gets a sightline to each stretch of it.
      const long = s.x === size ? 'x' : s.y === size ? 'y' : 'z';
      const many = Math.min(MAX_LINES, Math.max(1, Math.ceil(size / LINE_EVERY)));
      const wide = Math.min(REACH_MAX, Math.max(REACH, size / many * 0.5));
      for (let n = 0; n < many; n++) {
        tip.copy(c);
        if (many > 1) tip[long] += size * ((n + 0.5) / many - 0.5);
        d.copy(camera).sub(tip);
        const len = d.length();
        d.divideScalar(len);
        // from the part's near face. Measured along the line, so a thin part in a door starts just inside the door.
        const stopAt = NEAR_FACE * 0.5 * (Math.abs(d.x) * (many > 1 && long === 'x' ? 0 : s.x) + Math.abs(d.y) * (many > 1 && long === 'y' ? 0 : s.y) + Math.abs(d.z) * (many > 1 && long === 'z' ? 0 : s.z));
        for (let t = stopAt; t < len; t += VOXEL * 0.7) {
          const reach = wide * Math.max(NARROW, Math.min(1, (t - stopAt) / TAPER));
          const x = tip.x + d.x * t, y = tip.y + d.y * t, z = tip.z + d.z * t;
          const r = Math.max(1, Math.ceil(reach / VOXEL));
          for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
            const list = map.get(key(Math.floor((x + i * reach / r) / VOXEL), Math.floor((y + j * reach / r) / VOXEL), Math.floor((z + k * reach / r) / VOXEL)));
            if (list) for (const q of list) if (q.rig.visible && !q.cur[0] && !q.cur[1] && !q.cur[2]) out.add(q);
          }
          for (const f of free) {
            const m = f.box;
            if (x > m.min.x - reach && x < m.max.x + reach && y > m.min.y - reach && y < m.max.y + reach && z > m.min.z - reach && z < m.max.z + reach) out.add(f.inst);
          }
        }
      }
    }
    return out;
  }
  return {find};
}
