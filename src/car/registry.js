// The part registry: every modelled part under its data/parts.json id, whatever module built it.
//
// add() wraps each object in a rig, a Group that only pose.js moves. The object itself stays free for that module's
// update(sim). So a piston can run on its rod while the whole part floats off in an explode, and neither knows.
import * as THREE from 'three';

/** Render layers. The stage's camera sees all three; AO sees SOLID; picking sees SOLID and GLASS. */
export const LAYER = {SOLID: 0, GLASS: 1, GHOST: 2};

const box = new THREE.Box3();
const v = new THREE.Vector3();

export function createRegistry() {
  const root = new THREE.Group();
  root.name = 'car';
  const parts = new Map();
  let partsData = null;
  let unknown = [];

  const makeInstance = (part, object, opts, side) => {
    const rig = new THREE.Group();
    rig.name = part.id;
    rig.add(object);
    const flip = side === 'mirror' ? -1 : 1;
    if (flip < 0) rig.scale.z = -1;
    root.add(rig);
    const meshes = [];
    object.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.partId = part.id;
      o.userData.base = o.material;
      o.userData.layer = opts.noPick ? LAYER.GHOST : o.material.transparent ? LAYER.GLASS : LAYER.SOLID;
      o.layers.set(o.userData.layer);
      o.castShadow = o.receiveShadow = true;
      meshes.push(o);
    });
    const flipZ = (a) => (a ? [a[0], a[1], a[2] * flip] : null);
    const inst = {part, rig, object, meshes, side, variant: opts.variant ?? null, follows: opts.follows ?? null, explode: flipZ(opts.explode), lift: flipZ(opts.lift), cur: [0, 0, 0], look: 'solid', rest: null};
    part.instances.push(inst);
    return inst;
  };

  /** See docs/interfaces.md. Adding the same id again adds another instance: another form of the part, say 17 and 18 inch wheels. */
  function add(id, object, opts = {}) {
    let part = parts.get(id);
    if (!part) {
      part = {id, system: id.split('.')[0], instances: [], group: opts.group ?? null, view: opts.view ?? null};
      parts.set(id, part);
      if (partsData && !partsData.byId.has(id)) unknown.push(id);
    }
    // cloned first: makeInstance puts a Material in userData, and clone() runs userData through JSON
    const mirror = opts.mirror ? object.clone(true) : null;
    makeInstance(part, object, opts, 'primary');
    if (mirror) makeInstance(part, mirror, opts, 'mirror');
    return {object, mirror};
  }

  /** Resting bounds of one instance, in car space, without any pose offset. Cached: call after the part is built. */
  function restBox(inst) {
    if (inst.rest) return inst.rest;
    const saved = inst.rig.position.clone();
    inst.rig.position.set(0, 0, 0);
    inst.rig.updateWorldMatrix(true, true);
    const out = new THREE.Box3();
    for (const m of inst.meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      out.union(box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
    }
    inst.rig.position.copy(saved);
    inst.rig.updateWorldMatrix(true, true);
    inst.rest = out;
    return out;
  }

  const partBox = (id) => {
    const p = parts.get(id);
    if (!p) return null;
    const out = new THREE.Box3();
    for (const i of p.instances) out.union(restBox(i));
    return out;
  };

  /** Where this instance is right now: rest bounds plus its pose offset. */
  const currentBox = (inst) => restBox(inst).clone().translate(v.fromArray(inst.cur));

  /** The instance nearest a world point, for paired parts: fly to the wheel on the camera's side. */
  function nearest(id, point) {
    const p = parts.get(id);
    if (!p) return null;
    let best = null, bd = Infinity;
    for (const i of p.instances) {
      if (!i.rig.visible) continue;
      const d = currentBox(i).getCenter(new THREE.Vector3()).distanceToSquared(point);
      if (d < bd) { bd = d; best = i; }
    }
    return best ?? p.instances[0];
  }

  /**
   * The nearest modelled part for an id, walking connectsTo. {id, exact}. id is null when nothing connected is
   * modelled. Use it for focus and labels only. Never lift a fallback: a bolt must not take the block with it.
   */
  function resolve(id) {
    if (parts.has(id)) return {id, exact: true};
    if (!partsData) return {id: null, exact: false};
    const seen = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
      const next = [];
      for (const f of frontier) {
        const links = [...(partsData.byId.get(f)?.connectsTo ?? [])];
        for (const c of links) {
          if (parts.has(c)) return {id: c, exact: false};
          if (!seen.has(c)) { seen.add(c); next.push(c); }
        }
      }
      frontier = next;
    }
    return {id: null, exact: false};
  }

  const triangles = (o) => {
    let n = 0;
    o.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.count ?? 1);
    });
    return n;
  };

  /** Triangles per part and per system, modelling coverage against parts.json, and ids not in parts.json. */
  function report() {
    const perPart = [...parts.values()].map((p) => ({id: p.id, tris: p.instances.reduce((n, i) => n + triangles(i.object), 0), instances: p.instances.length}));
    perPart.sort((a, b) => b.tris - a.tris);
    const perSystem = {};
    for (const p of perPart) perSystem[p.id.split('.')[0]] = (perSystem[p.id.split('.')[0]] ?? 0) + p.tris;
    const known = perPart.filter((p) => partsData?.byId.has(p.id)).length;
    return {total: perPart.reduce((n, p) => n + p.tris, 0), parts: parts.size, perSystem, perPart, coverage: partsData ? `${known} of ${partsData.items.length}` : null, unknown};
  }

  return {
    root, add, resolve, report, restBox, currentBox, partBox, nearest,
    get: (id) => parts.get(id) ?? null,
    has: (id) => parts.has(id),
    all: () => [...parts.values()],
    ids: () => [...parts.keys()],
    group: (name) => [...parts.values()].filter((p) => p.group === name).map((p) => p.id),
    setData(d) { partsData = d; unknown = []; },
  };
}

export const registry = createRegistry();
