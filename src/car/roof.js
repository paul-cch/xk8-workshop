// The convertible hood and everything that moves it. The coupe's roof panel and glass belong to the shell in body.js.
//
// One input, roof 0 (up) to 1 (stowed) through kin.js roofStroke, moves it all. The frame is a folding chain of side rails
// on a pivot behind the door. Five bows ride on the chain, and the fabric is a surface stretched through those bows, rebuilt
// from them whenever the frame moves, so it can only ever be where the frame puts it. Rail lengths, pivots and fold angles
// are estimates from the side photos roof up and roof down: no frame drawing was found.
import * as THREE from 'three';
import {bodySurface, SHAPE, smoothLine, trace} from './surface.js';
import {box, cylinder, lathe, merge, mesh, part, seg, tube, xf} from './kit.js';
import {addMaterial} from './materials.js';

const rad = (d) => (d * Math.PI) / 180;
const smooth = (t) => t * t * (3 - 2 * t);
const span = (t, a, b) => smooth(Math.min(1, Math.max(0, (t - a) / (b - a))));

// Side rail chain in the car's centre plane: pivot, joints and header with the hood up, and the fold angles.
const A = [-.98, .89], J1 = [-.72, 1.165], J2 = [-.28, 1.195], HEAD = [-.06, 1.16]; // the rails ride just under the cloth, above the top of the side glass, so they do not show through it
const TAIL_PIVOT = [-1.30, .93]; // the rear bows and the screen turn about this
const STOW = {rear: 185, mid: 3, front: 175, tail: -150}; // link angles, degrees, stowed. Up angles come from the points above
const BOWS = [ // station, link it rides on, lower edge of the fabric at that station. wide caps the half width where the cloth comes down inside the deck edge, sweep brings the last bow's ends forward so it lands in a curve
  {x: -.03, link: 'front', edge: 1.17}, {x: -.28, link: 'mid', edge: 1.185}, {x: -.72, link: 'rear', edge: 1.165},
  {x: -.965, link: 'tail', edge: .955, wide: .815}, {x: -1.27, link: 'tail', edge: .955, wide: .735}, {x: -1.50, link: 'tail', edge: .965, wide: .63, sweep: .13},
];
const RAIL_Z = .60; // side rails, inside the fabric at the cant
const ROWS_PER_BOW = 5, COLS = 15; // fabric grid: spanwise points on each side of the centreline
const TUB = [[-.74, .80], [-1.04, .76], [-1.36, .60], [-1.40, .3], [-1.40, 0]]; // convertible hood well, plan view

const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const L = {rear: dist(A, J1), mid: dist(J1, J2), front: dist(J2, HEAD)};
const UP = {rear: angle(A, J1), mid: angle(J1, J2), front: angle(J2, HEAD), tail: 0};

const links = {rear: {deg: 0, x: 0, y: 0}, mid: {deg: 0, x: 0, y: 0}, front: {deg: 0, x: 0, y: 0}, tail: {deg: 0, x: 0, y: 0}};

/** Where every link is at a frame stroke. Each link: its pivot now and how far it has turned from the hood-up position. */
function solve(frame) {
  const r = UP.rear + (rad(STOW.rear) - UP.rear) * span(frame, 0, .9);
  const m = UP.mid + (rad(STOW.mid) - UP.mid) * span(frame, .05, .95);
  const f = UP.front + (rad(STOW.front) - UP.front) * span(frame, .08, 1);
  const j1x = A[0] + L.rear * Math.cos(r), j1y = A[1] + L.rear * Math.sin(r);
  const j2x = j1x + L.mid * Math.cos(m), j2y = j1y + L.mid * Math.sin(m);
  links.rear.x = A[0]; links.rear.y = A[1]; links.rear.a = r - UP.rear; links.rear.px = A[0]; links.rear.py = A[1];
  links.mid.x = j1x; links.mid.y = j1y; links.mid.a = m - UP.mid; links.mid.px = J1[0]; links.mid.py = J1[1];
  links.front.x = j2x; links.front.y = j2y; links.front.a = f - UP.front; links.front.px = J2[0]; links.front.py = J2[1];
  links.tail.x = TAIL_PIVOT[0]; links.tail.y = TAIL_PIVOT[1]; links.tail.a = rad(STOW.tail) * span(frame, .12, .85); links.tail.px = TAIL_PIVOT[0]; links.tail.py = TAIL_PIVOT[1];
}

const state = {cover: null, bows: null, followers: [], last: -1, rams: [], tonneau: null, nor: null};

/** Puts a Group on a link. Its geometry is authored at the hood-up position in car space. */
function place(o, l) {
  const c = Math.cos(l.a), s = Math.sin(l.a);
  o.position.set(l.x - c * l.px + s * l.py, l.y - s * l.px - c * l.py, 0);
  o.rotation.z = l.a;
}

/** One row of the fabric: the bow's section across the car, centre to edge, sampled off the hood surface at hood-up. */
function section(H, V, bow, n) {
  const a = [0, 0, 0], out = [];
  const edge = H.locate('side', [bow.x, bow.edge]);
  const zAt = (t) => H.P(edge[0], t, a)[2];
  let end = edge[1];
  if (bow.wide && zAt(end) > bow.wide) { // find the t where the section reaches that half width
    let lo = 0, hi = end;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (zAt(m) > bow.wide) hi = m; else lo = m; }
    end = lo;
  }
  for (let j = 0; j <= n; j++) {
    const u = j / n, s = bow.sweep ? H.locate('top', [bow.x + bow.sweep * u * u, 0])[0] : edge[0]; // rows run straight across the car here
    H.P(s, u * end, a);
    out.push([a[0], a[1], a[2]]);
  }
  if (bow.wide) { // tuck the edge just under the deck, so no daylight shows between cloth and paint
    const e = out[n], st = V.locate('top', [e[0], e[2]]);
    e[1] = V.P(...st, a)[1] - .012;
  }
  if (bow.sweep) for (const p of out) { // the last bow runs under the deck edge all the way across
    V.P(...V.locate('top', [p[0], p[2]]), a);
    p[1] = Math.min(p[1], a[1] - .012);
  }
  return out;
}

const TONNEAU = {ridge: .86, rise: .082}; // where its rear edge falls, along the stack, and how high it stands: side-convertible-xk8-42-roof-down.jpg

const crom = (a, b, c, d, u) => {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (3 * b - a - 3 * c + d) * u3);
};

/** Rebuilds the fabric through the bows' current positions. Allocates nothing. */
function stretch(frame) {
  const {bows, cover, bowPos} = state;
  const nB = bows.length, cols = 2 * COLS + 1, g = cover.geometry, pos = g.attributes.position.array;
  for (let b = 0; b < nB; b++) {
    const l = links[bows[b].link], c = Math.cos(l.a), s = Math.sin(l.a), pts = bows[b].pts;
    for (let j = 0; j <= COLS; j++) {
      const p = pts[j], dx = p[0] - l.px, dy = p[1] - l.py, k = (b * (COLS + 1) + j) * 3;
      bowPos[k] = l.x + c * dx - s * dy;
      bowPos[k + 1] = l.y + s * dx + c * dy;
      // as the frame stows, the bows narrow to fit the well
      bowPos[k + 2] = p[2] * (1 - .06 * frame);
    }
  }
  const at = (b, j, k) => bowPos[(Math.max(0, Math.min(nB - 1, b)) * (COLS + 1) + j) * 3 + k];
  const rows = (nB - 1) * ROWS_PER_BOW + 1;
  for (let r = 0; r < rows; r++) {
    const fb = r / ROWS_PER_BOW, b = Math.min(nB - 2, Math.floor(fb)), u = fb - b;
    for (let j = 0; j <= COLS; j++) {
      const x = crom(at(b - 1, j, 0), at(b, j, 0), at(b + 1, j, 0), at(b + 2, j, 0), u);
      const y = crom(at(b - 1, j, 1), at(b, j, 1), at(b + 1, j, 1), at(b + 2, j, 1), u);
      const z = crom(at(b - 1, j, 2), at(b, j, 2), at(b + 1, j, 2), at(b + 2, j, 2), u);
      const kp = (r * cols + COLS + j) * 3, kn = (r * cols + COLS - j) * 3;
      pos[kp] = x; pos[kp + 1] = y; pos[kp + 2] = z;
      pos[kn] = x; pos[kn + 1] = y; pos[kn + 2] = -z;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}

/** The bonded rear window, in metres on the cloth: along the centreline from the header, then half widths. A soft-cornered trapezoid, bowed to follow the bows. */
const WINDOW = {from: -1.02, to: -1.47, topHalf: .43, lowHalf: .50, corner: .08, bow: .05, band: .03};
const MASK = 192, MASK_RANGE = .016; // texels each way, and the metres of distance one texture can hold: a distance field keeps the edge smooth at any zoom

/**
 * The window as three alpha maps over the cloth's uv grid: the cloth with a hole in it, the black bonded band round the hole,
 * and the glass. All three are distance fields, read with alphaTest, so the edge is a clean curve and the window folds with
 * the cloth without a second surface to keep in step.
 */
function windowMaps(geo, rows, cols) {
  const p = geo.attributes.position, centre = COLS, along = [0];
  for (let r = 1; r < rows; r++) {
    const a = (r - 1) * cols + centre, b = r * cols + centre;
    along.push(along[r - 1] + Math.hypot(p.getX(b) - p.getX(a), p.getY(b) - p.getY(a)));
  }
  const rowAt = (x) => { for (let r = 1; r < rows; r++) if (p.getX(r * cols + centre) <= x) { const x0 = p.getX((r - 1) * cols + centre), x1 = p.getX(r * cols + centre); return along[r - 1] + ((along[r] - along[r - 1]) * (x - x0)) / (x1 - x0); } return along[rows - 1]; };
  const a0 = rowAt(WINDOW.from), a1 = rowAt(WINDOW.to), ac = (a0 + a1) / 2, ha = (a1 - a0) / 2, wc = (WINDOW.topHalf + WINDOW.lowHalf) / 2, slope = (WINDOW.lowHalf - WINDOW.topHalf) / (a1 - a0), r = WINDOW.corner;
  /** Signed distance to the window's edge, negative inside. */
  const dist = (a, w) => {
    const q = Math.abs(a + WINDOW.bow * (w / wc) ** 2 - ac) - ha + r, e = w - wc - slope * (a - ac) + r;
    return Math.hypot(Math.max(q, 0), Math.max(e, 0)) + Math.min(Math.max(q, e), 0) - r;
  };
  const maps = [new Uint8Array(MASK * MASK * 4), new Uint8Array(MASK * MASK * 4), new Uint8Array(MASK * MASK * 4)];
  const enc = (v) => 255 * Math.max(0, Math.min(1, .5 + v / (2 * MASK_RANGE)));
  for (let v = 0; v < MASK; v++) for (let u = 0; u < MASK; u++) {
    const fr = ((v + .5) / MASK) * (rows - 1), fc = ((u + .5) / MASK) * (cols - 1), i = Math.min(rows - 2, Math.floor(fr)), j = Math.min(cols - 2, Math.floor(fc)), ar = fr - i, ac2 = fc - j;
    const a = along[i] + (along[i + 1] - along[i]) * ar;
    const z = (k) => (p.getZ(k * cols + j) * (1 - ac2) + p.getZ(k * cols + j + 1) * ac2);
    const d = dist(a, Math.abs(z(i) * (1 - ar) + z(i + 1) * ar));
    const o = (v * MASK + u) * 4, b = WINDOW.band;
    maps[0].fill(enc(d), o, o + 4); // the cloth keeps what is outside
    maps[1].fill(enc(b / 2 - Math.abs(d + b / 2)), o, o + 4); // the band lies just inside the edge
    maps[2].fill(enc(-d - b), o, o + 4); // the glass fills the rest
  }
  return maps.map((d) => {
    const t = new THREE.DataTexture(d, MASK, MASK);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  });
}

export function build(ctx) {
  const {registry, materials: M} = ctx;
  if (!M.hoodFabric) addMaterial('hoodFabric', new THREE.MeshStandardMaterial({color: '#15171b', roughness: .92, side: THREE.DoubleSide}));
  const conv = (v) => v.body === 'convertible';
  const Q = {rows: seg(340, 150), cols: seg(170, 90)}, H = bodySurface('hood', Q), V = bodySurface('convertible', Q);
  const line = (S, view, pts, sp = .03) => trace(S, view, smoothLine(pts, sp));

  // ---- the fabric ----------------------------------------------------------------------------

  const bows = BOWS.map((b) => ({...b, pts: section(H, V, b, COLS)}));
  state.bows = bows;
  state.bowPos = new Float32Array(bows.length * (COLS + 1) * 3);
  const rows = (bows.length - 1) * ROWS_PER_BOW + 1, cols = 2 * COLS + 1;
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let j = 0; j < cols - 1; j++) {
    const a = r * cols + j, b = a + cols; // wound to face out: AO and shadows cull the back of a sheet and would see straight through it
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rows * cols * 3), 3));
  geo.setIndex(idx);
  const uv = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) for (let j = 0; j < cols; j++) uv.set([j / (cols - 1), r / (rows - 1)], (r * cols + j) * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const cover = new THREE.Mesh(geo, M.hoodFabric);
  cover.frustumCulled = false;
  state.cover = cover;
  solve(0);
  stretch(0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  // The rear window is real glass bonded in a black band: see windowMaps.
  const [holeMap, bandMap, paneMap] = windowMaps(geo, rows, cols);
  if (!M.hoodCloth) {
    addMaterial('hoodCloth', new THREE.MeshStandardMaterial({color: '#15171b', roughness: .92, side: THREE.DoubleSide, alphaMap: holeMap, alphaTest: .5}));
    addMaterial('hoodBand', new THREE.MeshStandardMaterial({color: '#08090a', roughness: .5, side: THREE.DoubleSide, alphaMap: bandMap, alphaTest: .5}));
    addMaterial('hoodWindow', new THREE.MeshPhysicalMaterial({color: '#050706', roughness: .03, transparent: true, opacity: .9, envMapIntensity: 2.4, depthWrite: false, side: THREE.DoubleSide, alphaMap: paneMap, alphaTest: .5}));
    addMaterial('hoodFrame', new THREE.MeshStandardMaterial({color: '#101114', roughness: .7, metalness: .2})); // black, as the headlining hides it: seen through the side glass a bright bar reads as a fault
  }
  cover.material = M.hoodCloth;
  const band = new THREE.Mesh(geo, M.hoodBand), pane = new THREE.Mesh(geo, M.hoodWindow);
  band.frustumCulled = pane.frustumCulled = false;
  const coverGroup = new THREE.Group();
  coverGroup.add(cover, band, pane);
  registry.add('roof.cover', coverGroup, {variant: conv, explode: [0, 1.5, 0], lift: [0, .7, 0]});

  // ---- the frame -----------------------------------------------------------------------------

  const groups = {};
  const frame = new THREE.Group();
  const rail = (a, b, w = .016) => tube([[a[0], a[1], RAIL_Z], [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + .01, RAIL_Z], [b[0], b[1], RAIL_Z]], w, {radial: 8});
  const flip = (g) => { const o = g.clone(); o.scale(1, 1, -1); const ix = o.index.array; for (let k = 0; k < ix.length; k += 3) { const a = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = a; } return o; };
  const pair = (g) => merge(g, flip(g));
  const bowTube = (b) => { // a real bow under the fabric: its section, the centre to the frame rail, dropped a little under the cloth
    const n = COLS - 4, half = b.pts.slice(0, n).filter((_, i) => i % 2 === 0).map((p) => [p[0], p[1] - .016, p[2] * .97]);
    const whole = [...half.slice(1).reverse().map((p) => [p[0], p[1], -p[2]]), ...half];
    return tube(whole, .009, {radial: 7, seg: 40});
  };
  const linkParts = {
    rear: [pair(rail(A, J1)), pair(tube([[A[0] + .05, A[1] - .1, .615], [A[0], A[1], .615], [A[0] + .12, A[1] + .16, .612]], .012, {radial: 7}))],
    mid: [pair(rail(J1, J2))],
    front: [pair(rail(J2, HEAD)), pair(box(.05, .03, .1, {at: [HEAD[0] - .015, HEAD[1] - .02, .54], bevel: .006}))],
    tail: [pair(tube([[TAIL_PIVOT[0], TAIL_PIVOT[1], .55], [-1.15, .97, .55], [-1.0, 1.02, .55]], .012, {radial: 7})), pair(tube([[TAIL_PIVOT[0], TAIL_PIVOT[1], .55], [-1.45, .93, .55]], .012, {radial: 7}))],
  };
  for (const b of bows) linkParts[b.link].push(bowTube(b));
  // The cloth's lower edge is sewn to a rail: a clean seam from the quarter window along the deck and across behind the glass.
  const seamEdge = bows.filter((b) => b.link === 'tail');
  const seam = [...seamEdge.map((b) => b.pts[COLS]), ...seamEdge[seamEdge.length - 1].pts.slice(0, COLS).reverse()];
  linkParts.tail.push(pair(tube(seam, .0075, {radial: 6, seg: 60})));
  for (const [name, list] of Object.entries(linkParts)) {
    const g = mesh(merge(list), M.hoodFrame);
    groups[name] = g;
    frame.add(g);
    state.followers.push({o: g, l: name});
  }
  registry.add('roof.frame', frame, {variant: conv, explode: [0, 1.15, 0], lift: [0, .6, 0]});

  // Seals ride on the rails. Header seal on the front link, a side strip on each rail.
  const seals = new THREE.Group();
  const sealFront = mesh(merge(tube(bows[0].pts.slice(0, COLS - 1).map((p) => [p[0] + .022, p[1] - .012, p[2]]), .007, {radial: 6}), rail([J2[0] + .02, J2[1] - .05], [HEAD[0] + .02, HEAD[1] - .05], .006)), M.rubber);
  const sealMid = mesh(rail([J1[0], J1[1] - .05], [J2[0], J2[1] - .05], .006), M.rubber);
  seals.add(sealFront, sealMid);
  state.followers.push({o: sealFront, l: 'front'}, {o: sealMid, l: 'mid'});
  const sealR = registry.add('roof.seal', seals, {mirror: true, variant: conv, explode: [0, .95, .2], lift: [0, .5, .2]});
  state.followers.push({o: sealR.mirror.children[0], l: 'front'}, {o: sealR.mirror.children[1], l: 'mid'});

  // Header latch: rides on the front link.
  const latch = part(M, {steel: [xf(cylinder(.012, .13, {axis: 'z', seg: 12}), {at: [HEAD[0] - .01, HEAD[1] - .04, .22]}), xf(cylinder(.012, .13, {axis: 'z', seg: 12}), {at: [HEAD[0] - .01, HEAD[1] - .04, -.22]})], steelDark: [box(.03, .03, .1, {at: [HEAD[0] - .01, HEAD[1] - .04, 0], bevel: .004})]});
  state.followers.push({o: latch, l: 'front'});
  registry.add('roof.latch-cylinder', latch, {variant: conv, explode: [.1, 1.25, 0], lift: [.1, .6, 0]});

  // Lift rams, one each side, from the body to the arm on the rear link. Their rods reach as it turns.
  const BASE = [-1.14, .64, .57], ARM = [A[0] + .12, A[1] + .16]; // ARM is on the rear link
  const barrel = () => xf(cylinder(.024, .30, {axis: 'y', seg: 14}), {at: [0, .15, 0]});
  const rod = () => xf(cylinder(.009, .36, {axis: 'y', seg: 10}), {at: [0, .18, 0]});
  const ram = new THREE.Group();
  const bar = mesh(barrel(), M.steelDark), rodM = mesh(rod(), M.chrome);
  ram.add(bar, rodM);
  ram.position.set(...BASE);
  const rr = registry.add('roof.lift-cylinder', ram, {mirror: true, variant: conv, explode: [-.3, .7, .35], lift: [-.2, .4, .3]});
  for (const o of [rr.object, rr.mirror]) state.rams.push({o, rod: o.children[1]});
  state.ram = {BASE, ARM};

  // Pump in the boot, hoses along the body side, the O-rings at their joints.
  const pump = {zinc: [box(.15, .1, .12, {at: [-2.2, .53, .58], bevel: .008})], steelDark: [xf(cylinder(.045, .13, {axis: 'x', seg: 18}), {at: [-2.06, .53, .58]})]};
  registry.add('roof.pump', part(M, pump), {variant: conv, explode: [-.75, .35, .35], lift: [-.2, .35, 0]});
  const hosePath = [[-2.13, .56, .58], [-1.96, .6, .69], [-1.5, .6, .69], [-1.2, .6, .57]];
  registry.add('roof.hoses', mesh(tube(hosePath, .005, {radial: 6}), M.rubber), {mirror: true, variant: conv, explode: [-.3, .45, .4], lift: [0, .3, .3]});
  const oring = xf(lathe([[.0062, -.0012], [.0074, 0], [.0062, .0012], [.005, 0], [.0062, -.0012]], {seg: 10, axis: 'x'}), {at: [-1.96, .6, .69]});
  registry.add('roof.hose-oring', mesh(oring, M.rubber), {mirror: true, variant: conv, explode: [-.3, .5, .45], lift: [0, .3, .3]});
  registry.add('roof.switch', mesh(box(.03, .012, .02, {at: [.05, .56, .0], bevel: .002}), M.plasticBlack), {variant: conv, explode: [0, .7, 0], lift: [0, .3, 0]});
  registry.add('roof.brace', part(M, {steelDark: [tube([[-1.02, .42, -.57], [-1.02, .50, 0], [-1.02, .42, .57]], .014, {radial: 8}), tube([[.58, .30, .62], [.58, .24, 0], [.58, .30, -.62]], .014, {radial: 8})]}), {variant: conv, explode: [0, -.3, 0], lift: [0, -.2, 0]});

  // The well the hood folds into, and the leather tonneau that closes over it.
  const wellLine = line(V, 'top', TUB); wellLine[wellLine.length - 1][1] = 0;
  const a = [0, 0, 0];
  const tubRings = [];
  for (const y of [.74, .88]) tubRings.push(wellLine.filter((_, i) => i % 2 === 0).map((q) => { V.P(q[0], q[1], a); return [a[0], y, a[2]]; }));
  const tub = (() => {
    const pos = [], ind = [], n = tubRings[0].length;
    for (const r of tubRings) for (const p of r) pos.push(...p);
    for (let i = 0; i < n - 1; i++) ind.push(i, i + 1, i + n, i + 1, i + n + 1, i + n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  })();
  registry.add('roof.frame', mesh(merge(tub, flip(tub)), M.hoodFabric), {variant: conv, explode: [0, .4, 0], lift: [0, .3, 0]});

  // Tonneau, closing over the stack: a low soft cover over the well, swung down from its rear edge as the stroke ends.
  const deckAt = (x, z) => SHAPE.crownRearConv(Math.min(-1.31, x)) - .06 * (z / .7) ** 2.5;
  const bulge = (() => {
    const pos = [], ind = [], nx = 16, nz = 24;
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const u = i / nx, w = k / nz, z = (w * 2 - 1) * (.70 - .14 * u * u), x = -.93 - u * .55;
      const dome = (u < TONNEAU.ridge ? (u / TONNEAU.ridge) ** .8 : 1 - ((u - TONNEAU.ridge) / (1 - TONNEAU.ridge)) ** 2) * (1 - (w * 2 - 1) ** 8); // a flat wedge rising to a defined rear edge, not a beanbag
      pos.push(x, deckAt(x, Math.abs(z)) + .012 + TONNEAU.rise * dome, z);
    }
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const p = i * (nz + 1) + k, q = p + nz + 1;
      ind.push(p, q, p + 1, q, q + 1, p + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(ind);
    g.computeVertexNormals();
    return g;
  })();
  const pivot = [-1.48, .985];
  bulge.translate(-pivot[0], -pivot[1], 0);
  const tonneau = new THREE.Mesh(bulge, M.hoodFabric);
  tonneau.position.set(pivot[0], pivot[1], 0);
  state.tonneau = tonneau;
  const tg = new THREE.Group();
  tg.add(tonneau);
  registry.add('roof.cover', tg, {variant: conv, explode: [0, .9, 0], lift: [0, .5, 0]});
  applyTo(0, 0);
}

function applyTo(frame, cover) {
  solve(frame);
  stretch(frame);
  for (const f of state.followers) place(f.o, links[f.l]);
  if (state.tonneau) {
    state.tonneau.visible = cover > .002;
    state.tonneau.rotation.z = rad(105) * (1 - cover);
  }
  const {BASE, ARM} = state.ram, l = links.rear, c = Math.cos(l.a), s = Math.sin(l.a);
  const dx = ARM[0] - l.px, dy = ARM[1] - l.py;
  const tx = l.x + c * dx - s * dy - BASE[0], ty = l.y + s * dx + c * dy - BASE[1], len = Math.hypot(tx, ty);
  for (const r of state.rams) {
    r.o.rotation.z = -Math.atan2(tx, ty); // +y of the ram points at the arm
    r.rod.position.y = len - .36;
  }
}

export function update(sim) {
  if (!state.cover) return;
  const key = sim.roof.frame * 1000 + sim.roof.cover;
  if (key === state.last) return;
  state.last = key;
  applyTo(sim.roof.frame, sim.roof.cover);
}
