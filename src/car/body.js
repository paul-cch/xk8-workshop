// The exterior and the shell under it. Shut lines are drawn in real metres in the view that shows them and cut from the
// surface in surface.js, so every panel is a real piece that lifts off. Every position in the tables below is an estimate
// read off the images in ref/images: no body drawings were found. Which forms a car gets comes from the running changes in
// data/variants.json through their appliesTo, so a car with a known VIN gets the panels of that VIN.
import * as THREE from 'three';
import {applies} from '../data.js';
import {ARCH_R, ARCH_Y, AXLE_F, AXLE_R, bodySurface, fair, fieldNormals, inset, makeField, panelGeometry, smoothLine, sweep, trace} from './surface.js';
import {box, cylinder, extrude, lathe, loft, merge, mesh, once, part, seg, tube, xf} from './kit.js';
import {addMaterial, growlerMaterial} from './materials.js';

const rad = (d) => (d * Math.PI) / 180;
const arc = (cx, cy, r, a0, a1, n = 22) => Array.from({length: n + 1}, (_, i) => { const a = rad(a0 + ((a1 - a0) * i) / n); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const ellipse = (cx, cy, a, b, n = 24) => Array.from({length: n}, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + a * Math.cos(t), cy + b * Math.sin(t)]; });
const rev = (p) => [...p].reverse();

/** The same surface seen from behind: winding and normals reversed. */
function turnOver(g) {
  const ix = g.index.array, n = g.attributes.normal.array;
  for (let k = 0; k < ix.length; k += 3) { const a = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = a; }
  for (let k = 0; k < n.length; k++) n[k] = -n[k];
  return g;
}

/** Mirrors a geometry to the other side of the car, winding corrected. */
function flipZ(g) {
  const o = g.clone();
  o.scale(1, 1, -1);
  const ix = o.index.array;
  for (let k = 0; k < ix.length; k += 3) { const a = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = a; }
  return o;
}

// ---- shut lines off the elevation photos -------------------------------------------------------

export const DOOR = {
  front: [[.451, .865], [.568, .788], [.62, .703], [.629, .553], [.625, .42], [.611, .325]],
  bottom: [[.611, .325], [.519, .322], [-.019, .325], [-.234, .322], [-.33, .328], [-.406, .34]],
  rear: [[-.406, .34], [-.514, .389], [-.568, .453], [-.611, .55], [-.637, .678], [-.643, .806], [-.60, .9025]],
  belt: [[-.60, .9025], [-.3, .889], [-.019, .875], [.175, .866], [.451, .865]],
};
export const HINGE = {x: .655, z: .835, deg: 62}; // door hinge line, estimated; the opening angle is a look choice
const BONNET_HINGE = {x: 2.0, y: .545, deg: 60}; // hinges at the front: see front-three-quarter-convertible-bonnet-open.jpg
const LID_HINGE = {x: -1.95, y: .97, deg: 58};
const STRUT = {z: .57, body: [1.6, .665], lid: [1.3, .76]}; // bonnet gas struts, bonnet closed: on the inner wing and under the bonnet's edge. Estimated
const DLO = { // side glass, side view
  top: [[.44, .872], [.323, .95], [.186, 1.04], [.046, 1.135], [-.126, 1.176], [-.342, 1.19], [-.60, 1.19], [-.825, 1.168], [-1.003, 1.131], [-1.11, 1.10], [-1.178, 1.07], [-1.22, 1.04], [-1.247, 1.003]],
  bottom: [[-1.247, 1.003], [-1.224, .977], [-1.147, .953], [-1.071, .934], [-.911, .92], [-.60, .9045], [-.019, .879], [.175, .87], [.44, .872]],
};
const GLASS_DROP = .33; // all the way into the door: the roof-down photo shows no glass above the belt
const POST = -.598; // the thin post between the door glass and the fixed quarter glass, coupe
const BONNET = {
  rear: [[.845, 0], [.83, .28], [.765, .50], [.66, .62], [.60, .655]], // plan
  side: [[.60, .655], [.85, .715], [1.05, .762], [1.24, .785], [1.47, .75], [1.6, .71]], // plan, the end point comes from the lamp
  front: [[0, .604], [.23, .604], [.42, .602], [.472, .602]], // front view
};
const LAMP = { // headlamp cover, front view: the bezel traced on a grid over the head-on photo, cast through the fitted camera on to this surface, then 31 mm down, the offset the bonnet edge and badge show between that camera and these tables. The side elevation agrees: y .55 to .68
  inner: [[.452, .558], [.438, .58], [.447, .597], [.472, .602]], // the blunt inner end, about 38 mm radius, up to where the bonnet's front edge lands
  top: [[.472, .602], [.493, .611], [.526, .625], [.559, .639], [.587, .653], [.612, .668], [.634, .684]], // on up the bonnet's side to its corner
  over: [[.634, .684], [.672, .696], [.729, .697], [.787, .684], [.826, .654], [.842, .608], [.83, .574], [.806, .562]], // along the wing, convex, and round the outer end
  low: [[.806, .562], [.77, .549], [.717, .539], [.652, .533], [.592, .531], [.53, .533], [.488, .541], [.452, .558]], // back along the bottom
  bowls: [[.668, .622, .079], [.585, .588, .056], [.752, .616, .05]], // z, y, radius: unequal and overlapping, so the fluted lens runs them into one glassy mass as in the photo. The big one is the main beam dish
  flash: [.508, .568, .04], // the indicator at the inner end, a faceted amber dish
  wedge: [[.718, .541], [.745, .583], [.785, .552]], // the small dark wedge in the lower outer corner of the lamp
};
const MOUTH = { // front view, off the head-on photo
  top: [[0, .478], [.06, .478], [.2, .476], [.32, .473], [.45, .46], [.516, .445], [.55, .405], [.575, .37]],
  bottom: [[.575, .37], [.54, .335], [.42, .31], [.25, .297], [.08, .29], [0, .29]],
};
const BUMPER_F_REAR = [[1.665, .70], [1.685, .5], [1.70, .3], [1.70, 0]]; // lower edge of the front bumper, from below
const SCREEN = {
  base: [[.735, 0], [.725, .25], [.69, .45], [.625, .62], [.545, .72]], // plan
  edge: [[.545, .72], [.44, .725], [.32, .69], [.19, .655], [.06, .60]], // plan: the A post is about 55 mm wide, inside the side glass
  head: [[.035, .42], [.01, .25], [-.01, 0]], // plan, from the top of the edge to the centre
};
const REAR_SCREEN = { // one smooth curve in plan, front centre to rear centre. Its flank follows the side elevation, its base stays just ahead of the lid
  outline: [[-1.13, 0], [-1.132, .2], [-1.14, .38], [-1.165, .50], [-1.225, .595], [-1.31, .645], [-1.42, .675], [-1.55, .70], [-1.665, .715], [-1.79, .705], [-1.875, .655], [-1.925, .555], [-1.985, .45], [-2.025, .26], [-2.036, 0]],
  corner: 3, end: 11, // indices in outline: where the roof panel stops and where the lid's corner meets it
};
const LID_C = { // the rear view numbers are off the rear photo at the plate's scale, 1310 px/m, with heights tied to the side view
  front: [[-2.05, 0], [-2.04, .25], [-2.0, .44], [-1.94, .535]], // plan
  side: [[-1.94, .535], [-2.0, .60], [-2.1, .645], [-2.2, .66], [-2.33, .63]], // plan, the end point comes from the lamp
  tail: [[.537, .845], [.523, .833], [.489, .798], [.453, .763], [.421, .725], [.403, .692], [.392, .673], [.289, .575], [.25, .559]], // rear view, down the lamp's inner edge
  bottom: [[.25, .559], [.12, .551], [.05, .55], [0, .55]], // rear view: the lid carries the plate and drops below it
};
const LID_V = {...LID_C, front: [[-1.56, 0], [-1.56, .3], [-1.60, .50], [-1.68, .60]], side: [[-1.68, .60], [-1.85, .655], [-2.05, .68], [-2.2, .665], [-2.33, .63]]};
const BUMPER_R = {
  tail: [[0, .545], [.09, .545], [.25, .55], [.45, .565], [.64, .59], [.72, .578], [.79, .555]], // rear view, carried round the corner: a side view is ill-conditioned there
  side: [[-2.249, .504], [-2.055, .449], [-1.80, .375], [-1.692, .345]],
  lower: [[-1.70, .68], [-1.74, .5], [-1.78, .3], [-1.78, 0]], // from below
};
const TAIL = { // the lamp, every year: the bezel traced on the rear photo, cast on to this surface through a pinhole set by the plate (1285 px/m, centred at 976 x 1048, eye 2.46 m back). Past the corner the rear photo runs out of surface, so that end comes from the side elevation
  low: [[.409, .674], [.419, .658], [.456, .651], [.518, .652], [.575, .66], [.62, .669]], // rear view
  wrap: [[-2.45, .669], [-2.425, .685], [-2.405, .72], [-2.398, .75], [-2.405, .79], [-2.425, .822], [-2.448, .84]], // side view, on the boat tail
  top: [[.60, .841], [.57, .841], [.545, .838]], // rear view: the top inner corner is rounded
  diag: [[.545, .838], [.522, .826], [.489, .798], [.453, .763], [.421, .725], [.406, .69], [.409, .674]], // rear view, along the boot lid
  window: [[.643, .786], [.636, .806], [.615, .822], [.585, .828], [.555, .825], [.53, .81], [.493, .769], [.498, .759], [.535, .762], [.58, .772], [.62, .778]], // the clear section, inside a red border, off the rear photo
  bowls: [[.468, .708, .048], [.55, .702, .056], [.622, .722, .05]], // z, y, radius: the deep red dishes
};
const FOG = {z: .722, y: .415}; // centre of the socket: the bumper is carved for it in surface.js
const FLAP = {x: -1.6, y: .895, r: .068, gap: .0026}; // fuel filler flap, left side only: its shut line is as wide as the door's. The side photos put it about 135 mm across
const STRIP = [[.61, .556], [.3, .566], [-.1, .572], [-.60, .578]]; // side rubbing strip on the door, side view
const STRIP_QUARTER = [[-.655, .579], [-.81, .582]]; // and its short length behind the door
const SILL_LATE = {x: [.895, -.885], top: .314, low: .216}; // the last cars lose the door strip and gain a deeper body-colour sill, its top edge a shadow step: side-coupe-xkr-facelift-long-lens.jpg and the 4.2 side photos
const HANDLE = {x: -.465, y: .80, a: .094, b: .04}; // door handle recess, side view
const QUARTER_HOOD = [[-.625, 1.165], [-.75, 1.158], [-.84, 1.09], [-.90, .94], [-.625, .90]]; // convertible quarter glass, side view, from the roof-up photo
const FRIT = [[-.055, .0012], [-.008, .0012]]; // the black band fired on to fixed glass, inside its edge
const TAIL_EPS = .018; // shading blur on the tail panels: its rolled edges are about as wide as their triangles
const COCKPIT = [[-.72, .80], [-.92, .755], [-1.15, .70], [-1.33, .60], [-1.40, .42], [-1.42, 0]]; // convertible, plan: the edge of the hood well

export function build(ctx) {
  const {registry, data, materials: M} = ctx;
  const Q = {rows: seg(340, 150), cols: seg(170, 90)}, cells = seg(230, 110), fine = seg(420, 110); // fine: the big rear panels, where a crisp reflection shows up any coarse triangle
  const C = bodySurface('coupe', Q), V = bodySurface('convertible', Q), H = bodySurface('hood', Q), B = bodySurface('coupe', {...Q, bumper: true});
  const CL = bodySurface('coupe', {...Q, facelift: true}), BL = bodySurface('coupe', {...Q, bumper: true, facelift: true});
  if (!M.bodyGlass) {
    addMaterial('bodyGlass', new THREE.MeshPhysicalMaterial({color: '#060908', roughness: .03, transparent: true, opacity: .74, envMapIntensity: 2.4, depthWrite: false, side: THREE.DoubleSide}));
    addMaterial('lensFluted', new THREE.MeshPhysicalMaterial({color: '#e8edf0', roughness: .16, transparent: true, opacity: .52, envMapIntensity: 1.2, depthWrite: false, normalMap: flutedNormals(), normalScale: new THREE.Vector2(1, 1)}));
    addMaterial('reflector', new THREE.MeshStandardMaterial({color: '#dfe2e5', roughness: .34, metalness: 1, envMapIntensity: 1}));
    addMaterial('lampHousing', new THREE.MeshStandardMaterial({color: '#b9bcc0', roughness: .34, metalness: .9, envMapIntensity: 1, side: THREE.DoubleSide}));
    addMaterial('lampClear', new THREE.MeshPhysicalMaterial({color: '#c9c7c2', roughness: .3, metalness: .7, envMapIntensity: .6, clearcoat: 1, clearcoatRoughness: .08}));
    addMaterial('tailLens', new THREE.MeshPhysicalMaterial({color: '#c80f18', roughness: .08, transparent: true, opacity: .42, envMapIntensity: 1.3, depthWrite: false}));
    addMaterial('tailGlow', new THREE.MeshStandardMaterial({color: '#e81a22', roughness: .22, metalness: 1, envMapIntensity: 1.9}));
    addMaterial('tailWindow', new THREE.MeshPhysicalMaterial({color: '#e2e1de', roughness: .3, metalness: 1, envMapIntensity: .55, clearcoat: 1, clearcoatRoughness: .04, normalMap: flutedNormals(), normalScale: new THREE.Vector2(.5, .5)}));
    addMaterial('brightTrim', new THREE.MeshStandardMaterial({color: '#eceef0', roughness: .2, metalness: .8, envMapIntensity: 1.5}));
    addMaterial('fritBlack', new THREE.MeshStandardMaterial({color: '#08090a', roughness: .7, envMapIntensity: .6, side: THREE.DoubleSide})); // matt: gloss here flares white from the front three-quarter
    addMaterial('shadowBlack', new THREE.MeshStandardMaterial({color: '#050607', roughness: .85, metalness: 0}));
    addMaterial('plateYellow', new THREE.MeshStandardMaterial({map: plateTexture([.98, .83, .16]), roughness: .34, envMapIntensity: .5}));
    addMaterial('plateWhite', new THREE.MeshStandardMaterial({map: plateTexture([.93, .93, .9]), roughness: .34, envMapIntensity: .5}));
    addMaterial('lampAmber', new THREE.MeshStandardMaterial({color: '#c8760f', roughness: .3, metalness: .75, envMapIntensity: 1.2, normalMap: diamondNormals(), normalScale: new THREE.Vector2(.5, .5)}));
    addMaterial('stopLens', new THREE.MeshStandardMaterial({color: '#d0161e', emissive: '#a00c14', emissiveIntensity: .8, roughness: .3})); // behind tinted glass: it has to carry
    addMaterial('mirrorGlass', new THREE.MeshStandardMaterial({color: '#dfe4e8', roughness: .04, metalness: 1, envMapIntensity: 1.3}));
    addMaterial('headlining', new THREE.MeshStandardMaterial({color: '#d2ccbd', roughness: .92, side: THREE.DoubleSide}));
    addMaterial('fogLens', new THREE.MeshPhysicalMaterial({color: '#14181b', roughness: .12, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: 1.3}));
    addMaterial('growlerGreen', growlerMaterial('#0c4a2c'));
    addMaterial('badgeGreen', new THREE.MeshStandardMaterial({color: '#0d3d24', roughness: .3, metalness: .2}));
    addMaterial('meshGrille', meshGrilleMaterial('#d6d9dc', .45));
    addMaterial('meshBlack', meshGrilleMaterial('#17181a', .3));
  }

  // Which panels for which car, from the running changes in variants.json.
  const change = (id) => data?.variants?.changes?.find((c) => c.id === id)?.appliesTo;
  const newTail = (v) => applies(change('my2001-freshening') ?? {myFrom: 2001}, v);
  const clearLens = (v) => applies(change('my2002-trim') ?? {myFrom: 2002}, v);
  const facelift = (v) => applies(change('facelift-2005') ?? {myFrom: 2005}, v) && v.my >= 2004;
  const coupe = (v) => v.body === 'coupe', conv = (v) => v.body === 'convertible', xkr = (v) => v.induction === 'sc';

  const line = (S, view, pts, spacing = .03, seed = null) => trace(S, view, smoothLine(pts, spacing), {seed});
  const panel = (S, poly, opts = {}) => panelGeometry(S, opts.gap === 0 ? poly : inset(S, poly, opts.gap ?? .0025), {cells, ...opts});
  // byMat may be a function that returns it: then a form the car on show does not have waits for registry.fill()
  const addP = (id, byMat, opts) => registry.add(id, typeof byMat === 'function' ? () => part(M, byMat()) : part(M, byMat), opts);
  const pivoted = (byMat, px, py, pz = 0) => { // a part that turns about a hinge: geometry moved so the hinge is its origin
    const o = part(M, byMat);
    for (const c of o.children) { c.geometry = c.geometry.clone(); c.geometry.translate(-px, -py, -pz); }
    o.position.set(px, py, pz);
    return o;
  };
  const movers = {bonnet: [], boot: [], doorR: [], doorL: [], glassDrop: [], struts: []};
  const onDoor = (id, byMat, opts = {}, then = null) => {
    const turn = () => pivoted(typeof byMat === 'function' ? byMat() : byMat, HINGE.x, 0, HINGE.z);
    return registry.add(id, typeof byMat === 'function' ? turn : turn(), {mirror: true, ...opts}, (r) => {
      movers.doorR.push(r.object); movers.doorL.push(r.mirror);
      then?.(r);
    });
  };

  // ---- front end ---------------------------------------------------------------------------------

  const lampIn = line(C, 'front', LAMP.inner, .02), lampTop = line(C, 'front', LAMP.top, .02), lampWing = line(C, 'front', LAMP.over, .02), lampLow = line(C, 'front', LAMP.low, .02);
  const lamp = [...lampIn, ...lampTop, ...lampWing, ...lampLow];
  const m = C.P(...lampTop[lampTop.length - 1]), o = C.P(...lampWing[lampWing.length - 1]);
  const bonnetSide = line(C, 'top', [...BONNET.side, [m[0], m[2]]]);
  const bonnetRear = line(C, 'top', BONNET.rear); bonnetRear[0][1] = 0;
  const bonnetFront = line(C, 'front', BONNET.front, .03); bonnetFront[0][1] = 0;
  const doorFront = line(C, 'side', DOOR.front), doorBottom = line(C, 'side', DOOR.bottom), doorRear = line(C, 'side', DOOR.rear), doorBelt = line(C, 'side', DOOR.belt);
  const archPt = (a) => [AXLE_F + ARCH_R.f * Math.cos(rad(a)), ARCH_Y.f + ARCH_R.f * Math.sin(rad(a))];
  const archF = (a0, a1) => line(C, 'side', arc(AXLE_F, ARCH_Y.f, ARCH_R.f, a0, a1), .02);
  const jointPts = [[o[0], o[1]], [(o[0] + archPt(38)[0]) / 2, .57], archPt(38)]; // bumper to wing, side view
  const jointF = line(C, 'side', jointPts);
  const wingTop = line(C, 'side', [[.451, .865], [.53, .872], [.585, .895]]);
  const bonnetPoly = [...bonnetRear, ...bonnetSide, ...rev(lampTop), ...rev(bonnetFront)];
  const corner = bonnetCorner(C);
  const wingPoly = [...bonnetSide, ...lampWing, ...jointF, ...archF(38, 180), ...line(C, 'side', [[.916, .33], [.611, .325]]), ...rev(doorFront), ...wingTop, ...line(C, 'side', [[.585, .895], corner])];

  const mouthTop = line(C, 'front', MOUTH.top, .025), mouthBottom = line(C, 'front', MOUTH.bottom, .025);
  mouthTop[0][1] = 0; mouthBottom[mouthBottom.length - 1][1] = 1;
  const frontBumper = (S) => {
    const li = line(S, 'front', LAMP.inner, .02), lt = line(S, 'front', LAMP.low, .02), mt = line(S, 'front', MOUTH.top, .025), mb = line(S, 'front', MOUTH.bottom, .025), bf = line(S, 'front', BONNET.front, .03);
    bf[0][1] = 0; mt[0][1] = 0; mb[mb.length - 1][1] = 1;
    const rearEdge = trace(S, 'bottom', smoothLine(BUMPER_F_REAR, .03)); rearEdge[rearEdge.length - 1][1] = 1;
    const a = line(S, 'side', arc(AXLE_F, ARCH_Y.f, ARCH_R.f, 38, -17), .02);
    const j = line(S, 'side', jointPts);
    return {poly: [...bf, ...rev(li), ...rev(lt), ...j, ...a, ...line(S, 'side', [[1.655, .225], [1.66, .212]]), ...rearEdge, ...rev(mb), ...rev(mt)], mt, mb};
  };
  const FB = frontBumper(C), FBL = once(() => frontBumper(CL));
  const solidC = makeField({body: 'coupe'}), solidCL = makeField({body: 'coupe', facelift: true}), smoothed = (g, field = solidC) => fieldNormals(g, field, .008); // lattice normals streak in a dark mirror finish

  // the mouth: a lip turning in, black behind, a chrome bar or the R's mesh in it
  const cavity = (S, mt, mb) => {
    const wall = sweep(S, [...mt, ...mb], [[0, -.002], [.005, -.016], [.01, -.075]], {step: .02, flip: true});
    return merge(wall, flipZ(wall), xf(cylinder(.66, .02, {axis: 'x', seg: 48}), {scale: [1, .2, 1], at: [2.03, .385, 0]}));
  };
  const barLine = line(C, 'front', [[.535, .426], [.47, .421], [.3, .412], [.12, .407], [0, .406]], .03); // nearly straight out from the plate, with a gentle bow. The dip in the photos is the camera looking down on a curved nose
  barLine[barLine.length - 1][1] = 1;
  const bar = sweep(C, barLine, ellipse(0, 0, .006, .007, 8).map(([a, b]) => [a, b - .016]), {step: .03});
  const slats = [merge(bar, flipZ(bar))];
  slats.push(box(.03, .012, .86, {at: [2.03, .335, 0], bevel: .003}));

  addP('body.front-bumper', () => ({paint: [smoothed(panel(C, FB.poly, {both: true}))], shadowBlack: [cavity(C, mouthTop, mouthBottom)]}), {explode: [1.15, -.02, 0], lift: [.75, .05, 0], variant: (v) => !facelift(v)});
  addP('body.front-bumper', () => ({paint: [smoothed(panel(CL, FBL().poly, {both: true}), solidCL)], shadowBlack: [cavity(CL, FBL().mt, FBL().mb)]}), {explode: [1.15, -.02, 0], lift: [.75, .05, 0], variant: facelift});
  addP('body.front-bumper', () => ({chrome: slats.slice(0, 1), plasticBlack: slats.slice(1)}), {explode: [1.15, -.02, 0], lift: [.75, .05, 0], variant: (v) => !xkr(v)});
  addP('body.grille', () => ({meshGrille: [grilleSheet()], meshBlack: [grilleSheet(.012, .5)]}), {explode: [1.5, -.02, 0], lift: [.9, .05, 0], variant: xkr}); // a dark sheet just behind, half a diamond out, gives the wire depth
  addP('body.grille', () => ({meshBlack: [grilleSheet()]}), {explode: [1.5, -.02, 0], lift: [.9, .05, 0], variant: (v) => !xkr(v)});

  // Front plate on its plinth: across the mouth on an XK8 as in the head-on photo, under the mesh on an R as in the low photo.
  const frontPlate = (y, x) => ({
    plateWhite: [new THREE.PlaneGeometry(.52, .111).rotateY(Math.PI / 2).translate(x + .0062, y, 0)],
    plasticBlack: [box(.012, .116, .526, {bevel: .003, at: [x - .001, y, 0]}), box(.09, .05, .28, {bevel: .006, at: [x - .05, y, 0]})],
  });
  addP('body.front-bumper', () => (frontPlate(.40, 2.156)), {explode: [1.15, -.02, 0], lift: [.75, .05, 0], variant: (v) => !xkr(v)});
  addP('body.front-bumper', () => (frontPlate(.305, 2.102)), {explode: [1.15, -.02, 0], lift: [.75, .05, 0], variant: xkr});

  const atB = [BONNET_HINGE.x, BONNET_HINGE.y];
  movers.bonnet.push(registry.add('body.bonnet', pivoted({paint: [smoothed(panel(C, bonnetPoly, {both: true}))]}, ...atB), {explode: [.5, 1.05, 0], lift: [.1, 1.05, 0]}).object);
  registry.add('body.bonnet', () => {
    const louvres = [];
    for (const sign of [1, -1]) for (let i = 0; i < 9; i++) { // XKR: a set each side of the raised centre, estimated from the side crop and the 3/4 photo
      const x = 1.515 + i * .034, t = line(C, 'top', [[x, .33 + i * .004], [x + .006, .60 - i * .006]], .04);
      const g = sweep(C, t, [[-.0105, -.001], [-.006, .0065], [.0075, .007], [.0105, -.001]], {step: .04});
      louvres.push(sign > 0 ? g : flipZ(g));
    }
    const louvreFrame = panelGeometry(C, trace(C, 'top', smoothLine([[1.49, .318], [1.66, .325], [1.83, .36], [1.835, .445], [1.825, .548], [1.66, .585], [1.49, .615], [1.478, .47]], .02, true)), {flange: 0, roll: 0, push: .0012, cells: 420}); // the dark recess they stand in
    return pivoted({paint: [merge(louvres)], shadowBlack: [louvreFrame, flipZ(louvreFrame)]}, ...atB);
  }, {explode: [.5, 1.05, 0], lift: [.1, 1.05, 0], variant: xkr}, (r) => movers.bonnet.push(r.object));
  movers.bonnet.push(registry.add('body.bonnet-liner', pivoted({bonnetFelt: [turnOver(panel(C, inset(C, bonnetPoly, .05), {both: true, push: -.02, flange: 0, roll: 0, gap: 0, cells: 110}))]}, ...atB), {explode: [.5, .8, 0], lift: [.1, 1.0, 0]}).object);
  // The felt's pressed lines and its push clips. Heights are the liner's underside, measured closed.
  const LINER_Y = [[.9, .862], [1, .848], [1.1, .833], [1.3, .803], [1.5, .773], [1.6, .754], [1.7, .73], [1.8, .698], [1.9, .648]];
  const linerY = (x, z) => {
    const i = Math.max(0, LINER_Y.findIndex(([a]) => a > x) - 1), [x0, y0] = LINER_Y[i], [x1, y1] = LINER_Y[i + 1] ?? LINER_Y[i];
    return y0 + (x1 > x0 ? ((x - x0) / (x1 - x0)) * (y1 - y0) : 0) + .019 * Math.max(0, 1 - Math.abs(z) / .3);
  };
  const onLiner = (x, z, drop) => [x, linerY(x, z) - drop, z];
  const pressed = [];
  for (const x of [1.42, 1.62]) pressed.push(tube([-.52, -.3, -.12, .12, .3, .52].map((z) => onLiner(x, z, .0015)), .0095, {radial: 6, seg: 10}));
  for (const z of [-.3, .3]) pressed.push(tube([1.02, 1.2, 1.4, 1.52, 1.64].map((x) => onLiner(x, z, .0015)), .0095, {radial: 6, seg: 10}));
  const clips = [];
  for (let i = 0; i < 7; i++) for (const z of [-.6, .6]) clips.push(cylinder(.012, .012, {seg: 8, axis: 'y', at: onLiner(1.02 + i * .135, z, .007)}));
  for (const x of [1.0, 1.84]) for (const z of [-.36, -.12, .12, .36]) clips.push(cylinder(.012, .012, {seg: 8, axis: 'y', at: onLiner(x, z, .007)}));
  movers.bonnet.push(registry.add('body.bonnet-liner', pivoted({bonnetFelt: pressed, plasticBlack: clips}, ...atB), {explode: [.5, .8, 0], lift: [.1, 1.0, 0]}).object);
  // XKR: the dark backs of the louvres, showing through the felt
  const louvreBack = (s) => loft([1.5, 1.6, 1.7, 1.81].map((x) => { const hi = .6 - (x - 1.5) * .22, lo = .33 + (x - 1.5) * .12; const y = linerY(x, .4) - .014; return s > 0 ? [[x, y - .001, lo], [x, y - .001, hi], [x, y, hi], [x, y, lo]] : [[x, y, -lo], [x, y, -hi], [x, y - .001, -hi], [x, y - .001, -lo]]; }), {caps: true, smooth: false});
  registry.add('body.bonnet-liner', () => pivoted({paintBlack: [louvreBack(1), louvreBack(-1)]}, ...atB), {explode: [.5, .8, 0], lift: [.1, 1.0, 0], variant: xkr}, (r) => movers.bonnet.push(r.object));

  // Two gas struts hold the open bonnet: the handbook says so, and there is no prop rod. Each runs from the inner wing to the bonnet and stretches as it opens.
  const struts = new THREE.Group();
  for (const s of [1, -1]) {
    const o = mesh(cylinder(.0085, 1, {seg: 8, axis: 'y'}), M.steelDark);
    o.userData.z = s * STRUT.z;
    struts.add(o);
    movers.struts.push(o);
  }
  registry.add('body.bonnet', struts, {explode: [.5, .8, 0], lift: [.1, 1.0, 0]});

  addP('body.wing', {paint: [smoothed(panel(C, wingPoly)), sweep(C, archF(38, 180), [[0, -.003], [.002, -.012], [.012, -.075]], {step: .03, flip: true})]}, {mirror: true, explode: [.25, .35, .75], lift: [.05, .35, .6]});

  // Headlamp: the clear cover is a piece of the body surface, the works sit behind it.
  const behind = (view, q, depth) => { const st = C.locate(view, q), p = C.P(...st), n = C.normal(...st); return [p[0] - n.x * depth, p[1] - n.y * depth, p[2] - n.z * depth]; };
  /** A chrome reflector dish behind the lens, wound to be seen from its open side, facing out between the surface and straight ahead. */
  const bowl = ([z, y, r]) => {
    const st = C.locate('front', [z, y]), p = C.P(...st), n = C.normal(...st), d = r * .95;
    const axis = new THREE.Vector3(.55, 0, 0).add(n).normalize();
    const g = lathe([[r, 0], [r * .94, -d * .2], [r * .74, -d * .55], [r * .4, -d * .86], [.001, -d]], {seg: 28, axis: 'x'}); // no rim and no bulb to see: through the lens they are only a shine
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), axis));
    return g.translate(p[0] - n.x * .02, p[1] - n.y * .02, p[2] - n.z * .02);
  };
  const lampCover = uvFromFront(panel(C, lamp, {flange: .03, roll: .002, gap: .002}), .016, .05);
  const wedge = line(C, 'front', [...LAMP.wedge, LAMP.wedge[0]], .008);
  const lampWorks = {
    plasticBlack: [panel(C, lamp, {flange: .0, roll: 0, gap: .004, push: -.062, cells: 120}), sweep(C, [...lamp], [[-.004, -.006], [.0, -.066]], {closed: true, step: .03, flip: true})], // black plastic behind the reflectors, as the bay sees it
    reflector: LAMP.bowls.map(bowl),
    lampAmber: [uvFromFront(bowl(LAMP.flash), .009, .009)],
    shadowBlack: [panelGeometry(C, wedge, {flange: 0, roll: 0, push: -.006, cells: 500})],
    chrome: [sweep(C, inset(C, lamp, .007), [[-.0045, -.002], [-.0032, .0006], [.0032, .0006], [.0045, -.002]], {closed: true, step: .014}), sweep(C, wedge, [[-.0018, -.0065], [-.0012, -.0046], [.0012, -.0046], [.0018, -.0065]], {closed: true, step: .012})],
  };
  addP('electrical.headlamp', () => ({...lampWorks, lensFluted: [lampCover]}), {mirror: true, explode: [.95, .25, .45], lift: [.5, .3, .1], variant: (v) => !clearLens(v), group: 'headlamp'});
  addP('electrical.headlamp', () => ({...lampWorks, lensClear: [lampCover]}), {mirror: true, explode: [.95, .25, .45], lift: [.5, .3, .1], variant: clearLens, group: 'headlamp'});

  const fogLamp = (S, variant) => { // a dark lens at the bottom of the body-colour socket that surface.js carves into the bumper corner
    const st = S.locate('front', [FOG.z, FOG.y]), p = S.P(...st), n = S.normal(...st);
    const lens = merge(
      lathe([[.001, -.012], [.039, -.012], [.039, .0], [.033, .005], [.016, .0085], [.001, .0095]], {seg: 24, axis: 'x'}),
    );
    const ring = lathe([[.0375, -.003], [.0415, -.003], [.0422, .0005], [.0412, .003], [.039, .003], [.0375, -.003]], {seg: 28, axis: 'x'});
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(.7, 0, 0).add(n).normalize());
    const put = (g) => g.applyQuaternion(face).translate(p[0] + n.x * .004, p[1] + n.y * .004, p[2] + n.z * .004);
    addP('electrical.fog-lamp', () => ({fogLens: [put(lens)], steelDark: [put(ring)]}), {mirror: true, explode: [1.25, 0, .35], lift: [.5, 0, .2], variant});
  };
  fogLamp(C, (v) => !facelift(v));
  fogLamp(CL, facelift);

  // ---- greenhouse --------------------------------------------------------------------------------

  const screenEdge = line(C, 'top', SCREEN.edge);
  const edgeEnd = C.P(...screenEdge[screenEdge.length - 1]);
  const screenBase = line(C, 'top', SCREEN.base); screenBase[0][1] = 0;
  const screenHead = line(C, 'top', [[edgeEnd[0], edgeEnd[2]], ...SCREEN.head]); screenHead[screenHead.length - 1][1] = 0;
  const screenPoly = [...screenBase, ...screenEdge, ...screenHead];
  const windscreen = {bodyGlass: [panel(C, screenPoly, {both: true, flange: 0, roll: 0, gap: .006})]};
  const screenFrit = sweep(C, [...screenEdge, ...screenHead], FRIT.map(([w, n]) => [w * -.75, n]).reverse(), {step: .03}); // the fired black band round the top and sides of the screen
  const screenRubber = sweep(C, [...screenBase.slice(1), ...screenEdge, ...screenHead.slice(0, -1)], [[-.012, .0], [-.01, .0035], [.006, .0035], [.01, .0]], {step: .03});

  addP('body.windscreen', {...windscreen, fritBlack: [screenFrit, flipZ(screenFrit)]}, {explode: [.35, 1.25, 0], lift: [.1, .7, 0]});
  const postFoot = line(C, 'top', [BONNET.rear[4], SCREEN.edge[0]]); // from the bonnet corner to the foot of the screen
  const rsLine = smoothLine(REAR_SCREEN.outline, .03), rsAt = (q) => rsLine.findIndex((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6);
  const rsAll = trace(C, 'top', rsLine); rsAll[0][1] = 0; rsAll[rsAll.length - 1][1] = 0;
  const rsI = rsAt(REAR_SCREEN.outline[REAR_SCREEN.corner]), rsJ = rsAt(REAR_SCREEN.outline[REAR_SCREEN.end]);
  const rsHead = rsAll.slice(0, rsI + 1), rsEdge = rsAll.slice(rsI, rsJ + 1);
  const rsCorner = C.P(...rsAll[rsI]), rsEnd = C.P(...rsAll[rsJ]);
  const rsPoly = rsAll;
  const rsTrim = sweep(C, rsAll, [[-.0095, -.001], [-.008, .0028], [.008, .0028], [.0095, -.001]], {step: .025});
  const rsFrit = sweep(C, rsAll, FRIT, {step: .03});

  const roofSide = line(C, 'top', [[edgeEnd[0], edgeEnd[2]], [-.3, .56], [-.7, .555], [-1.0, .53], [rsCorner[0], rsCorner[2]]]);
  const roofPoly = [...rev(screenHead), ...roofSide, ...rev(rsHead)];
  addP('body.roof-panel', () => ({paint: [smoothed(panel(C, roofPoly, {both: true}))]}), {explode: [0, 1.5, 0], lift: [0, .8, 0], variant: coupe});
  addP('body.roof-panel', () => ({headlining: [turnOver(panel(C, inset(C, roofPoly, .03), {both: true, push: -.024, flange: 0, roll: 0, gap: 0, cells: 110}))]}), {explode: [0, 1.25, 0], lift: [0, .72, 0], variant: coupe}); // the pale headlining
  addP('body.rear-screen', () => ({bodyGlass: [panel(C, rsPoly, {both: true, flange: 0, roll: 0, gap: .008})], chrome: [rsTrim, flipZ(rsTrim)], fritBlack: [rsFrit, flipZ(rsFrit)]}), {explode: [-.5, 1.25, 0], lift: [-.2, .7, 0], variant: coupe});

  const dloTop = line(C, 'side', DLO.top, .025);
  const topTo = (x) => DLO.top.filter((p) => p[0] > x + .01).concat([[x, curveAt(DLO.top, x)]]);
  const glassDoor = [...line(C, 'side', topTo(POST), .025), ...line(C, 'side', [[POST, curveAt(DLO.top, POST)], [POST, .908]]), ...line(C, 'side', [[POST, .908], [-.019, .879], [.175, .87], [.44, .872]], .025)];
  const glassQ = [...line(C, 'side', [[POST - .022, 1.19], [-.825, 1.168], [-1.003, 1.131], [-1.11, 1.10], [-1.178, 1.07], [-1.22, 1.04], [-1.247, 1.003]], .025), ...line(C, 'side', [[-1.247, 1.003], [-1.224, .977], [-1.147, .953], [-1.071, .934], [-.911, .92], [POST - .022, .906]], .025), ...line(C, 'side', [[POST - .022, .906], [POST - .022, 1.19]])];
  const dloChrome = sweep(C, dloTop, [[-.0075, -.001], [-.0062, .0028], [.0062, .0028], [.0075, -.001]], {step: .025});
  const dloRubber = sweep(C, dloTop, [[.006, .0], [.016, -.002]], {step: .03});
  // The wide black post between the door glass and the fixed quarter glass, fired on to the quarter glass, r-dlo on the master photo: 85 mm.
  const postRear = POST - .085, yTop = (x) => curveAt(DLO.top, x), yLow = (x) => .9045 + (.0155 * (-.60 - x)) / .311;
  const bPost = (S, top, low) => [...line(S, 'side', [[POST + .012, top(POST + .012)], [POST - .04, top(POST - .04)], [postRear, top(postRear)]], .02), ...line(S, 'side', [[postRear, top(postRear)], [postRear, low(postRear)]], .02), ...line(S, 'side', [[postRear, low(postRear)], [POST + .012, low(POST + .012)]], .02), ...line(S, 'side', [[POST + .012, low(POST + .012)], [POST + .012, top(POST + .012)]], .02)];
  const postGlass = panelGeometry(C, bPost(C, yTop, yLow), {flange: 0, roll: 0, push: .0016, cells: 500});
  const qBelt = line(C, 'side', [[POST + .012, .9045], [-.911, .92], [-1.071, .934], [-1.147, .953], [-1.224, .977], [-1.247, 1.003]], .025);
  const qBeltChrome = sweep(C, qBelt, [[-.0075, -.001], [-.0062, .0028], [.0062, .0028], [.0075, -.001]], {step: .025});

  // ---- rear --------------------------------------------------------------------------------------

  const bumperSide = (S) => { // from the end of the bumper's top edge in the rear view, on along the side view
    const st = S.locate('rear', BUMPER_R.tail[BUMPER_R.tail.length - 1]), e = S.P(...st);
    return line(S, 'side', [[e[0], e[1]], ...BUMPER_R.side.filter((p) => p[0] > e[0] + .05)], .03, st); // seeded, so it stays on this sheet
  };
  const tailLines = (S) => {
    const low = line(S, 'rear', TAIL.low, .015), a = S.P(...low[low.length - 1]);
    const wrap = line(S, 'side', [[a[0], a[1]], ...TAIL.wrap], .015, low[low.length - 1]), b = S.P(...wrap[wrap.length - 1]);
    const top = line(S, 'rear', [[b[2], b[1]], ...TAIL.top], .015, wrap[wrap.length - 1]), diag = line(S, 'rear', TAIL.diag, .015, top[top.length - 1]);
    return {low, wrap, top, diag, outline: [...low, ...wrap, ...top, ...diag]};
  };
  const rear = (S, Lid) => {
    const lidTail = line(S, 'rear', Lid.tail, .02), lidBottom = line(S, 'rear', Lid.bottom, .03), e = S.P(...lidTail[0]);
    const lidFront = line(S, 'top', Lid.front), lidSide = line(S, 'top', [...Lid.side, [e[0], e[2]]]);
    lidFront[0][1] = 0; lidBottom[lidBottom.length - 1][1] = 1;
    const archR = (a0, a1) => line(S, 'side', arc(AXLE_R, ARCH_Y.r, ARCH_R.r, a0, a1), .02);
    const lamp = tailLines(S), n = Lid.tail.findIndex((p) => p[1] < .68);
    return {lidFront, lidSide, lidTail, lidBottom, lamp, lidPoly: [...lidFront, ...lidSide, ...lidTail, ...lidBottom, [1, 1], [1, 0]], archR, joint: fair([...line(S, 'rear', [Lid.bottom[0], [.45, .57], ...BUMPER_R.tail.slice(4)], .03), ...bumperSide(S)], 10),
      roundLamp: [...line(S, 'rear', Lid.tail.slice(0, 2), .02), ...rev(lamp.top), ...rev(lamp.wrap), ...rev(lamp.low), ...line(S, 'rear', Lid.tail.slice(n), .02)]}; // the body's edge: round the lamp's opening, not the lid's
  };
  const RC = rear(C, LID_C), RV = once(() => rear(V, LID_V));

  // rear bumper: its own skin, standing proud of the tail, with a ledge back to the body
  const rearBumper = (S, field) => {
    const tail = line(S, 'rear', BUMPER_R.tail, .03); tail[0][1] = 0;
    const top = fair([...tail, ...bumperSide(S)], 10, true);
    const archEnd = line(S, 'side', arc(AXLE_R, ARCH_Y.r, ARCH_R.r, 182, 195), .02);
    const lower = trace(S, 'bottom', smoothLine(BUMPER_R.lower, .03)); lower[lower.length - 1][1] = 1;
    const poly = [...top, ...archEnd, ...line(S, 'side', [[-1.672, .23], [-1.69, .228]]), ...lower, [1, 1], [1, 0]];
    const ledge = sweep(S, [...top, ...archEnd], [[0, 0], [.0, -.095]], {step: .03, flip: true});
    return merge(fieldNormals(panelGeometry(S, inset(S, poly, .0025), {both: true, cells: fine}), field, TAIL_EPS), ledge, flipZ(ledge));
  };
  addP('body.rear-bumper', () => ({paint: [rearBumper(B, makeField({bumper: true}))]}), {explode: [-1.15, -.02, 0], lift: [-.75, .05, 0], variant: (v) => !facelift(v)});
  addP('body.rear-bumper', () => ({paint: [rearBumper(BL, makeField({bumper: true, facelift: true}))]}), {explode: [-1.15, -.02, 0], lift: [-.75, .05, 0], variant: facelift});

  const atL = [LID_HINGE.x, LID_HINGE.y];
  const lid = (S, R, field) => pivoted({paint: [fieldNormals(panel(S, R.lidPoly, {both: true, cells: fine}), field, TAIL_EPS)]}, ...atL);
  registry.add('body.boot-lid', () => lid(C, RC, solidC), {explode: [-.85, .95, 0], lift: [-.15, .95, 0], variant: coupe}, (r) => movers.boot.push(r.object));
  registry.add('body.boot-lid', () => lid(V, RV(), makeField({body: 'convertible'})), {explode: [-.85, .95, 0], lift: [-.15, .95, 0], variant: conv}, (r) => movers.boot.push(r.object));

  // High stop lamps: a long red lamp in a black housing on the convertible's lid, rear-convertible-xkr-head-on.jpg, and a slim one on the coupe's shelf, seen through the screen in the rear 3/4 photo.
  const stopY = once(() => V.P(...V.locate('top', [-1.63, 0]))[1]), stopCoupe = {plasticBlack: [box(.05, .026, .36, {bevel: .009, at: [-1.82, 1.05, 0]})], stopLens: [box(.008, .015, .30, {bevel: .002, at: [-1.848, 1.052, 0]})]};
  registry.add('body.boot-lid', () => pivoted({plasticBlack: [box(.07, .036, .335, {bevel: .014, at: [-1.63, stopY() + .012, 0]})], tailGlow: [box(.012, .022, .275, {bevel: .004, at: [-1.668, stopY() + .016, 0]})]}, ...atL), {explode: [-.85, .95, 0], lift: [-.15, .95, 0], variant: conv}, (r) => movers.boot.push(r.object));
  addP('body.rear-screen', () => (stopCoupe), {explode: [-.5, 1.1, 0], lift: [-.2, .6, 0], variant: coupe});

  // Under the lid: a trimmed liner and the gooseneck hinges, so it does not read as bare painted metal when it opens.
  const liner = (S, R) => pivoted({carpet: [turnOver(panel(S, inset(S, R.lidPoly, .06), {both: true, push: -.018, flange: 0, roll: 0, gap: 0, cells: 110}))]}, ...atL);
  registry.add('body.boot-lid', () => liner(C, RC), {explode: [-.85, .92, 0], lift: [-.15, .92, 0], variant: coupe}, (r) => movers.boot.push(r.object));
  registry.add('body.boot-lid', () => liner(V, RV()), {explode: [-.85, .92, 0], lift: [-.15, .92, 0], variant: conv}, (r) => movers.boot.push(r.object));
  const goose = (z) => tube([[-2.12, .945, z], [-2.04, .945, z], [-1.98, .915, z], [-1.95, .86, z]], .011, {radial: 8});
  movers.boot.push(registry.add('body.boot-lid', pivoted({steelDark: [goose(.38), goose(-.38)]}, ...atL), {explode: [-.85, .92, 0], lift: [-.15, .92, 0]}).object);

  // Rear face of the lid: the chrome finisher, the plate and its frame move with the lid. The recess round the plate is carved in surface.js.
  const tailX = C.P(...C.locate('rear', [0, .68]))[0];
  const barPts = line(C, 'rear', [[.322, .768], [.17, .778], [0, .782]], .012).map((q) => C.P(...q));
  barPts[barPts.length - 1][2] = 0;
  const barNose = barPts.length - 1, barSection = 10;
  const barRing = (p, i) => { // a low chrome lozenge, tapering to a soft point at each end
    const u = 1 - Math.min(1, Math.abs(p[2]) / .322), h = .0245 * Math.min(1, Math.sqrt(u / .09) * .5 + .18 + u * 1.2), t = .0115 * Math.min(1, Math.sqrt(u / .05) * .6 + .2);
    return Array.from({length: barSection}, (_, k) => { const a = (k / barSection) * Math.PI * 2 + i * 0, c = Math.cos(a), sn = Math.sin(a); return [p[0] + (c < 0 ? t * .6 * c : -t * c), p[1] + h * sn, p[2]]; });
  };
  const barHalf = loft(barPts.map(barRing));
  const barX = (z) => barPts.reduce((b, p) => (Math.abs(p[2] - z) < Math.abs(b[2] - z) ? p : b))[0] - .0122;
  const strokes = {
    J: [[[.72, 1], [.72, .28], [.55, .02], [.25, 0], [.06, .2]]],
    A: [[[0, 0], [.5, 1], [1, 0]], [[.2, .36], [.8, .36]]],
    G: [[[.95, .8], [.7, 1], [.3, 1], [.05, .7], [.05, .3], [.3, 0], [.7, 0], [.95, .25], [.95, .5], [.55, .5]]],
    U: [[[.05, 1], [.05, .3], [.3, 0], [.7, 0], [.95, .3], [.95, 1]]],
    R: [[[.1, 0], [.1, 1], [.7, 1], [.92, .78], [.7, .5], [.1, .5]], [[.5, .5], [.95, 0]]],
  };
  const lettering = [];
  for (const [ch, zc] of [['J', -.168], ['A', -.111], ['G', -.055], ['U', .057], ['A', .114], ['R', .171]]) for (const stroke of strokes[ch]) {
    lettering.push(tube(stroke.map(([a, b]) => { const z = zc + (a - .5) * .017, y = .78 - .0095 + b * .019; return [barX(z), y, z]; }), .0011, {radial: 5, seg: stroke.length * 3}));
  }
  const barGrowler = new THREE.CircleGeometry(.0145, 28).rotateY(-Math.PI / 2).translate(barX(0) - .0028, .781, 0);
  const barCup = xf(lathe([[.001, .0], [.0165, .0], [.0172, .002], [.0158, .0034], [.0148, .0024], [.001, .0024]], {seg: 28, axis: 'x'}), {rot: [0, Math.PI, 0], at: [barX(0) + .0002, .781, 0]});
  const plateBase = new THREE.PlaneGeometry(.52, .111).rotateY(-Math.PI / 2).translate(tailX - .0166, .6875, 0); // the 520 x 111 mm plate that sets the scale of the rear photo
  const plateFrame = box(.012, .117, .526, {bevel: .004, at: [tailX - .010, .6875, 0]}); // a thin holder: the soft recess round it is carved in surface.js
  movers.boot.push(registry.add('body.boot-lid', pivoted({brightTrim: [barHalf, flipZ(barHalf), barCup], shadowBlack: [lettering], plateYellow: [plateBase], plasticBlack: [plateFrame]}, ...atL), {explode: [-.85, .95, 0], lift: [-.15, .95, 0]}).object);
  registry.add('body.boot-lid', () => {
    const lipLine = line(C, 'rear', [[.56, .878], [.4, .896], [.2, .905], [0, .908]], .03); lipLine[lipLine.length - 1][1] = 0;
    const lipHalf = sweep(C, lipLine, [[-.032, -.002], [-.016, .014], [.008, .03], [.024, .018], [.03, -.002]], {step: .03}); // XKR: a thin lip nearly the width of the lid, from the 2002 rear photo
    return pivoted({paint: [lipHalf, flipZ(lipHalf)]}, ...atL);
  }, {explode: [-.85, .95, 0], lift: [-.15, .95, 0], variant: xkr}, (r) => movers.boot.push(r.object));

  // Tail lamps: chrome ring, deep faceted red dishes behind a red lens, and a clear section with a red border above them.
  const tailOutline = RC.lamp.outline;
  const windowLine = trace(C, 'rear', smoothLine(TAIL.window, .012, true));
  const tailBowl = ([z, y, r]) => {
    const st = C.locate('rear', [z, y]), p = C.P(...st), n = C.normal(...st), d = r * .62;
    const g = lathe([[r, 0], [r * .94, -d * .2], [r * .8, -d * .42], [r * .62, -d * .66], [r * .42, -d * .84], [r * .2, -d * .96], [.001, -d]], {seg: 18, axis: 'x', creaseDeg: 4});
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), n));
    return g.translate(p[0] - n.x * .004, p[1] - n.y * .004, p[2] - n.z * .004);
  };
  const tailLamp = (windowMat) => ({
    tailGlow: [panel(C, tailOutline, {flange: 0, roll: 0, gap: .002, push: -.034, cells: 200}), sweep(C, tailOutline, [[-.004, .0], [.0, -.04]], {closed: true, step: .03, flip: true}), ...TAIL.bowls.map(tailBowl)],
    tailLens: [panel(C, tailOutline, {flange: .004, roll: .0015, gap: .0015, push: .0012})],
    [windowMat]: [uvFromFront(panelGeometry(C, windowLine, {flange: .012, roll: .002, push: .0018, cells: 300}), .019, .019)],
    chrome: [sweep(C, tailOutline, [[-.0055, -.0015], [-.0042, .0032], [-.0006, .0038], [.0022, .0015], [.0028, -.002]], {closed: true, step: .012})],
  });
  addP('electrical.tail-lamp', () => (tailLamp('tailWindow')), {mirror: true, explode: [-.95, .25, .55], lift: [-.45, .25, .1], variant: newTail});
  addP('electrical.tail-lamp', () => (tailLamp('lampClear')), {mirror: true, explode: [-.95, .25, .55], lift: [-.45, .25, .1], variant: (v) => !newTail(v)});

  // ---- body side ---------------------------------------------------------------------------------

  const sillLine = (S) => line(S, 'side', [[-.406, .34], [-.90, .34]]);
  const quarterC = [
    ...doorRear, ...line(C, 'side', [[-.60, .9025], [POST - .022, .906]]),
    ...line(C, 'side', [[POST - .022, .906], [-.911, .92], [-1.071, .934], [-1.147, .953], [-1.224, .977], [-1.247, 1.003]], .025), ...rev(dloTop),
    ...line(C, 'side', [[.44, .872], [.451, .865]]), ...wingTop, ...line(C, 'side', [[.585, .895], corner]), ...postFoot, ...screenEdge, ...roofSide.slice(1), ...rsEdge,
    ...line(C, 'top', [[rsEnd[0], rsEnd[2]], LID_C.front[3]]), ...RC.lidSide, ...RC.roundLamp, ...RC.joint, ...RC.archR(182, 0), ...rev(sillLine(C)),
  ];
  const sillPoly = [...line(C, 'side', [[.916, .33], [.611, .325], ...DOOR.bottom.slice(1)]), ...line(C, 'side', [[-.406, .34], [-.90, .34]]), ...line(C, 'side', arc(AXLE_R, ARCH_Y.r, ARCH_R.r, 0, -17, 6)), ...line(C, 'bottom', [[-.93, .735], [.93, .735]], .1), ...line(C, 'side', arc(AXLE_F, ARCH_Y.f, ARCH_R.f, 197, 180, 6))];
  const stripProfile = [[-.012, -.001], [-.009, .006], [.009, .007], [.012, -.001]];
  const stripBright = [[-.0035, .0062], [-.0025, .0088], [.0025, .009], [.0035, .0066]];
  const strips = (pts) => ({rubber: [sweep(C, line(C, 'side', pts, .03), stripProfile, {step: .03})], chrome: [sweep(C, line(C, 'side', pts, .03), stripBright, {step: .03})]});
  const notFacelift = (v) => !facelift(v);
  const archLip = (S, l) => sweep(S, l, [[0, -.003], [.002, -.012], [.012, -.075]], {step: .03, flip: true});
  const flap = trace(C, 'side', smoothLine([...ellipse(FLAP.x, FLAP.y, FLAP.r, FLAP.r), [FLAP.x + FLAP.r, FLAP.y]], .012));
  const flapRing = sweep(C, flap, [[-FLAP.gap, .0003], [-FLAP.gap, -.0015], [FLAP.gap, -.0015], [FLAP.gap, .0003]], {closed: true, step: .012});

  const rails = sweep(C, dloTop, [[-.03, -.012], [-.03, -.05], [.012, -.05], [.012, -.012], [-.03, -.012]], {step: .05}); // inside the surround, so black, or it reads as a second line through the glass
  addP('body.shell', () => ({plasticBlack: [rails]}), {mirror: true, explode: [0, .75, .45], lift: [0, .5, .3], variant: coupe});
  addP('body.shell', () => (strips(STRIP_QUARTER)), {mirror: true, explode: [-.2, .55, .85], lift: [0, .7, .5], variant: notFacelift});
  const [sf, sr] = SILL_LATE.x, sillLate = [...line(C, 'side', [[sf, SILL_LATE.top], [0, SILL_LATE.top - .004], [sr, SILL_LATE.top]], .05), ...line(C, 'side', [[sr, SILL_LATE.top], [sr, SILL_LATE.low]], .02), ...line(C, 'side', [[sr, SILL_LATE.low], [sf, SILL_LATE.low]], .05), ...line(C, 'side', [[sf, SILL_LATE.low], [sf, SILL_LATE.top]], .02)];
  addP('body.shell', () => ({paint: [panelGeometry(C, sillLate, {push: .016, flange: .022, roll: .006, cells: 300})]}), {mirror: true, explode: [0, -.1, .7], lift: [0, 0, .5], variant: facelift}); // proud of the door, so its top edge is a real step and catches light
  addP('body.shell', () => ({paint: [fieldNormals(panel(C, quarterC, {cells: fine}), solidC, TAIL_EPS), archLip(C, RC.archR(182, 0))], bodyGlass: [panel(C, glassQ, {flange: 0, roll: 0, gap: .003})], fritBlack: [postGlass], chrome: [dloChrome, qBeltChrome], rubber: [dloRubber, screenRubber]}), {mirror: true, explode: [-.2, .55, .85], lift: [0, .7, .5], variant: coupe});
  addP('body.shell', {shadowBlack: [flipZ(flapRing)]}, {explode: [-.2, .55, -.85], lift: [0, .7, -.5]});
  addP('body.shell', () => {
    const rv = RV();
    const doorRearV = line(V, 'side', DOOR.rear);
    const wellEdge = line(V, 'top', COCKPIT); wellEdge[wellEdge.length - 1][1] = 0;
    const tv = (a) => { const p = V.P(a[0], a[1]); return [p[0], p[2]]; };
    const quarterV = [
      ...doorRearV, ...line(V, 'top', [tv(doorRearV[doorRearV.length - 1]), COCKPIT[0]]), ...wellEdge,
      ...rv.lidFront, ...rv.lidSide, ...rv.roundLamp, ...rv.joint, ...rv.archR(182, 0), ...rev(sillLine(V)),
    ];
    return {paint: [fieldNormals(panel(V, quarterV, {cells: fine}), makeField({body: 'convertible'}), TAIL_EPS), archLip(V, rv.archR(182, 0))], rubber: [screenRubber.clone()]};
  }, {mirror: true, explode: [-.2, .55, .85], lift: [0, .7, .5], variant: conv});
  addP('body.shell', {paint: [panel(C, sillPoly)]}, {mirror: true, explode: [0, -.1, .7], lift: [0, 0, .5]});

  // Convertible screen frame: the pillars and the header from the coupe surface.
  const frameHead = line(C, 'top', [[edgeEnd[0] - .05, edgeEnd[2] + .02], [-.06, .3], [-.08, 0]]); frameHead[frameHead.length - 1][1] = 0;
  const dloToHeader = line(C, 'side', DLO.top.slice(0, 4), .025);
  addP('body.shell', () => ({paint: [panel(C, [...dloToHeader, ...frameHead, ...rev(screenHead), ...rev(screenEdge), ...rev(postFoot), ...line(C, 'side', [corner, [.585, .895]]), ...rev(wingTop), ...line(C, 'side', [[.451, .865], [.44, .872]])], {both: true})]}), {explode: [.2, 1.2, 0], lift: [.1, .6, 0], variant: conv});

  // Plenum: the black panel between the bonnet and the screen.
  const plenumPoly = [...bonnetRear, ...postFoot, ...rev(screenBase)];
  addP('body.plenum', {plasticBlack: [panel(C, plenumPoly, {both: true, gap: 0, flange: 0, roll: 0, push: -.012, cells: 180})]}, {explode: [.25, .9, 0], lift: [.1, .4, 0]});

  // ---- door --------------------------------------------------------------------------------------

  const doorPoly = [...doorBelt, ...rev(doorRear), ...rev(doorBottom), ...rev(doorFront)];
  const doorOuter = [...doorFront, ...doorBottom, ...doorRear, ...doorBelt];
  const belt = sweep(C, doorBelt, [[-.012, -.002], [-.0105, .0035], [.005, .0045], [.007, -.002]], {step: .03});
  const beltLip = sweep(C, doorBelt, [[.0035, .002], [.0042, .0056], [.0078, .0056], [.0085, .002]], {step: .03}); // the bright lip along the glass
  const shutFace = sweep(C, doorOuter, [[-.002, -.012], [.0, -.11]], {closed: true, step: .04, flip: true});
  const innerSkin = panel(C, inset(C, doorPoly, .02), {flange: 0, roll: 0, gap: 0, push: -.11, cells: 120});
  const handleRing = trace(C, 'side', smoothLine([...ellipse(HANDLE.x, HANDLE.y, HANDLE.a, HANDLE.b, 20), [HANDLE.x + HANDLE.a, HANDLE.y]], .012));
  const dishRing = sweep(C, handleRing, [[-.0012, .0003], [-.0012, -.0015], [.0012, -.0015], [.0012, .0003]], {closed: true, step: .012}); // the recess, read as its edge
  const dish = oval(C, {...HANDLE, k: -.09}); // a shallow scallop in the paint, off the master photo
  const slot = oval(C, {x: HANDLE.x + .004, y: HANDLE.y - .004, a: .058, b: .02, push: .0013, e: .8});
  const leverRings = (() => { // the pull: a chrome lozenge 112 x 28 mm, proud in the top of the scallop
    const st = C.locate('side', [HANDLE.x + .004, HANDLE.y + .006]), c = C.P(...st), n = C.normal(...st), T = new THREE.Vector3(1, 0, 0), B = new THREE.Vector3().crossVectors(n, T).normalize();
    const ring = (u) => {
      const end = Math.max(0, 1 - Math.abs(u) ** 3.2) ** .5, h = .014 * end + .0006, t = .0085 * end + .0004;
      return Array.from({length: 14}, (_, k) => { const a = (k / 14) * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a), up = h * Math.sign(cs) * Math.abs(cs) ** .7, out = t * Math.max(0, sn) ** .7 + .0012;
        return [c[0] + T.x * u * .056 + B.x * up + n.x * out, c[1] + T.y * u * .056 + B.y * up + n.y * out, c[2] + T.z * u * .056 + B.z * up + n.z * out]; });
    };
    return Array.from({length: 13}, (_, i) => ring(Math.cos((i / 12) * Math.PI)));
  })();
  const leverG = loft(leverRings);

  onDoor('body.door', {paint: [smoothed(panel(C, doorPoly, {flange: .012})), shutFace, innerSkin]}, {explode: [0, .1, .95], lift: [0, .1, .85]});
  onDoor('body.door', () => (strips(STRIP)), {explode: [0, .1, .95], lift: [0, .1, .85], variant: notFacelift});
  const glassOpts = {explode: [0, .75, 1.25], lift: [0, .5, .3]};
  onDoor('body.door-glass', () => ({bodyGlass: [panel(C, glassDoor, {flange: 0, roll: 0, gap: .003})]}), {...glassOpts, variant: coupe});
  const drops = (r) => movers.glassDrop.push(r.object, r.mirror); // a convertible's glass drops as the hood folds
  onDoor('body.door-glass', () => ({bodyGlass: [panel(C, glassDoor, {flange: 0, roll: 0, gap: .003})]}), {...glassOpts, variant: conv}, drops);
  registry.add('body.door-glass', () => {
    const quarterHood = trace(H, 'side', smoothLine([...QUARTER_HOOD, QUARTER_HOOD[0]], .03));
    const hoodPost = [...line(H, 'side', [[-.598, 1.17], [-.628, 1.168]], .01), ...line(H, 'side', [[-.628, 1.168], [-.628, .905]], .02), ...line(H, 'side', [[-.628, .905], [-.598, .905]], .01), ...line(H, 'side', [[-.598, .905], [-.598, 1.17]], .02)]; // the black post between door glass and quarter glass
    return part(M, {bodyGlass: [panel(H, quarterHood, {flange: 0, roll: 0, gap: .003})], fritBlack: [panelGeometry(H, hoodPost, {flange: 0, roll: 0, push: .0016, cells: 500})]});
  }, {...glassOpts, mirror: true, variant: conv}, drops);
  onDoor('body.door-seal', {rubber: [belt], chrome: [beltLip]}, {explode: [0, .35, 1.1], lift: [0, .2, .3]});
  onDoor('body.door-handle-exterior', {paint: [dish], shadowBlack: [dishRing, slot], chrome: [leverG]}, {explode: [0, .05, 1.2], lift: [0, 0, .25]});
  const innerBox = (w, h, d, x, y, z) => box(w, h, d, {at: [x, y, z], bevel: .004});
  onDoor('body.door-latch', {zinc: [innerBox(.09, .11, .04, -.58, .63, .845)]}, {explode: [-.1, .05, 1.05], lift: [0, 0, .3]});
  onDoor('body.window-regulator', {steelDark: [tube([[-.2, .44, .835], [-.2, .72, .835]], .009), tube([[.3, .44, .835], [.3, .72, .835]], .009), innerBox(.55, .022, .012, .05, .73, .835)], plasticBlack: [xf(cylinder(.06, .05, {axis: 'z', seg: 18}), {at: [.05, .52, .828]})]}, {explode: [0, .3, 1.05], lift: [0, .2, .3]});
  onDoor('body.door-water-shedder', {plasticBeige: [panel(C, inset(C, doorPoly, .06), {flange: 0, roll: 0, gap: 0, push: -.112, cells: 90})]}, {explode: [0, .2, .75], lift: [0, 0, .6]});
  const studs = [];
  for (const [x, y] of [[-.45, .45], [-.1, .4], [.3, .4], [.55, .5], [-.5, .68], [.55, .7]]) studs.push(xf(cylinder(.008, .012, {axis: 'z', seg: 8}), {at: [x, y, .77]}));
  onDoor('body.door-casing-stud', {plasticGrey: studs}, {explode: [0, .15, .7], lift: [0, 0, .5]});
  const hinges = [xf(box(.06, .05, .05, {bevel: .005}), {at: [.62, .72, .83]}), xf(box(.06, .05, .05, {bevel: .005}), {at: [.62, .42, .83]}), tube([[.6, .56, .82], [.52, .56, .80]], .007)];
  addP('body.door-hinge', {steelDark: hinges}, {mirror: true, explode: [.1, .05, 1.0], lift: [0, 0, .35]});

  // Mirror: a flat-bottomed wedge, wider than tall, on a broad body-colour blade that grows out of the black sail. No tube.
  const M_ = {x: .232, y: .916, z0: .822, z1: 1.008, h: .108, d: .078}; // rear face, underside, inner and outer end, height, depth. 2015 mm across the mirrors
  const mirrorRings = [];
  const headN = 10, ringN = 22;
  for (let i = 0; i <= headN; i++) {
    const u = i / headN, end = Math.pow(Math.max(1 - Math.abs(2 * u - 1) ** 3.4, 0), .5), w = .16 + .84 * end, r = [];
    const z = M_.z0 + u * (M_.z1 - M_.z0), hgt = M_.h * (.36 + .64 * end) * (1 - .1 * u), dep = M_.d * w * (1 - .16 * u);
    for (let k = 0; k < ringN; k++) {
      const t = (k / ringN) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), sq = (v, e) => Math.sign(v) * Math.abs(v) ** e;
      const yy = s < 0 ? sq(s, .34) * .5 : sq(s, .72) * .5; // flat underneath, rounded over the top
      const xx = c > 0 ? sq(c, .85) : sq(c, .28) * .1; // domed to the front, nearly flat at the back
      r.push([M_.x + dep * xx + (u - .5) * -.02, M_.y + hgt * .5 + hgt * yy + u * .006, z]);
    }
    mirrorRings.push(r);
  }
  const mirrorHead = loft(mirrorRings.reverse());
  const faceRing = (inset, x) => { // a rounded rectangle on the head's back
    const zc = (M_.z0 + M_.z1) / 2 + .004, hw = (M_.z1 - M_.z0) / 2 - inset - .004, hh = M_.h * .5 - inset - .006, yc = M_.y + M_.h * .5, n = 28, out = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), e = .42;
      out.push([x, yc + hh * Math.sign(s) * Math.abs(s) ** e, zc + hw * Math.sign(c) * Math.abs(c) ** e]);
    }
    return out;
  };
  const faceLoft = (ins, x0, x1) => loft([faceRing(ins, x1), faceRing(ins, x0)].reverse());
  // The blade: a tapered loft from the sail out to the head, about 70 x 35 mm at its root.
  const bladeStations = [[.372, .878, .812, .17, .052], [.345, .892, .838, .13, .05], [.318, .908, .872, .09, .042], [.292, .924, .905, .072, .036], [.268, .936, .93, .078, .036]]; // broad and body colour where it grows from the door
  const blade = loft(bladeStations.map(([x, y, z, w, t]) => Array.from({length: 12}, (_, k) => { const a = (k / 12) * Math.PI * 2; return [x + (w / 2) * Math.cos(a), y + (t / 2) * Math.sin(a), z]; })).reverse());
  const sail = xf(extrude([[.44, .868], [.40, .868], [.385, .898], [.40, .905]], .012, {axis: 'z'}), {at: [0, 0, .812]}); // only the small black corner by the glass is left of the sail
  onDoor('body.door-mirror', {paint: [mirrorHead, blade], shadowBlack: [sail, faceLoft(.006, M_.x - .002, M_.x + .006)], mirrorGlass: [faceLoft(.012, M_.x - .0045, M_.x)]}, {explode: [.2, .6, 1.3], lift: [0, .1, .4]});

  // Badges and markers.
  // Nose badge: a disc lying on the surface above the mouth, turned to its normal.
  const onNose = (g, lift) => {
    const st = C.locate('front', [0, .56]), p = C.P(...st), n = C.normal(...st);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), n);
    return g.applyQuaternion(q).translate(p[0] + n.x * lift, p[1] + n.y * lift, 0);
  };
  const nose = onNose(lathe([[.001, -.005], [.0335, -.005], [.0345, -.001], [.033, .0035], [.0295, .0052], [.0282, .0035], [.001, .0035]], {seg: 36, axis: 'x', creaseDeg: 18}), .004);
  const noseIn = onNose(new THREE.CircleGeometry(.0285, 36).rotateY(Math.PI / 2), .0079);
  addP('body.badge', {chrome: [nose], growlerGreen: [noseIn]}, {explode: [1.4, .15, 0], lift: [.3, .1, 0]});
  addP('body.badge', {growlerGreen: [barGrowler]}, {explode: [-1.3, .6, 0], lift: [-.3, .1, 0]});
  const rim = (S, o, w = .0016) => sweep(S, trace(S, 'side', smoothLine(ovalLine(o), .01, true), {seed: S.locate('side', [o.x + o.a, o.y])}), [[-w, -.0004], [-w * .6, .0022], [w * .6, .0022], [w, -.0004]], {closed: true, step: .01});
  const WING_MARK = {x: .80, y: .549, a: .053, b: .0185, k: .5, push: .0028}; // the three lengths off the master photo: 105, 165 and 195 mm
  const NOSE_MARK = {x: 1.80, y: .50, a: .083, b: .012, k: .5, push: .0024, e: 1.3};
  const TAIL_MARK = {x: -2.12, y: .418, a: .098, b: .0135, tilt: -.275, k: .5, push: .0024, e: 1.3};
  addP('body.wing', () => ({lensAmber: [oval(C, WING_MARK)], chrome: [rim(C, WING_MARK)]}), {mirror: true, explode: [.25, .35, .75], lift: [.05, .35, .6], variant: newTail});
  addP('body.wing', () => ({lampClear: [oval(C, WING_MARK)], chrome: [rim(C, WING_MARK)]}), {mirror: true, explode: [.25, .35, .75], lift: [.05, .35, .6], variant: (v) => !newTail(v)}); // the early repeater is a clear oval: see the master photo
  addP('body.front-bumper', {lensAmber: [oval(C, NOSE_MARK)], plasticBlack: [rim(C, NOSE_MARK)]}, {mirror: true, explode: [1.15, -.02, 0], lift: [.75, .05, 0]});
  addP('body.rear-bumper', {lensAmber: [oval(B, TAIL_MARK)], plasticBlack: [rim(B, TAIL_MARK)]}, {mirror: true, explode: [-1.15, -.02, 0], lift: [-.75, .05, 0]});
  addP('body.door-seal', {rubber: [sweep(C, doorOuter, [[-.004, -.022], [.003, -.024]], {closed: true, step: .05})]}, {mirror: true, explode: [0, .05, .6], lift: [0, 0, .3]});

  shell(addP);
  state.movers = movers;
}

/** y on a side-view table at x. Tables run nose to tail. */
function curveAt(pts, x) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a[0] >= x && b[0] <= x) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return pts[pts.length - 1][1];
}

/** The rear end of the bonnet side line in side-view coordinates. */
function bonnetCorner(S) {
  const p = S.P(...S.locate('top', BONNET.side[0]));
  return [p[0], p[1]];
}

/** The part of a closed outline above or below a height, as a closed outline. */
function clipBelow(S, poly, y, above) {
  const a = [0, 0, 0], out = [];
  const yOf = (p) => S.P(p[0], p[1], a)[1];
  const inside = (p) => (yOf(p) > y) === above;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], ip = inside(p), iq = inside(q);
    if (ip) out.push(p);
    if (ip !== iq) {
      const yp = yOf(p), yq = yOf(q), u = (y - yp) / (yq - yp);
      out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]);
    }
  }
  return out;
}

/** The outline of an oval in side view, see oval(). */
function ovalLine({x, y, a, b, tilt = 0, e = 1}, n = 20) {
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  return Array.from({length: n}, (_, i) => {
    const t = (i / n) * Math.PI * 2, u = a * Math.cos(t), s2 = Math.sin(t), v = b * Math.sign(s2) * Math.abs(s2) ** e;
    return [x + u * c - v * sn, y + u * sn + v * c];
  });
}

/**
 * An oval laid on the surface in side view: a shallow dish (k < 0) or a dome (k > 0), the shape faked in its normals, so it
 * needs no hole in the panel. tilt turns it, e above 1 draws its ends to points.
 */
function oval(S, {x, y, a, b, tilt = 0, k = 0, push = .0008, e = 1}) {
  const rings = 6, n = 28, pos = [], nor = [], idx = [], p = [0, 0, 0], N = new THREE.Vector3(), W = new THREE.Vector3();
  const seed = S.locate('side', [x, y]), c = Math.cos(tilt), sn = Math.sin(tilt);
  for (let i = 0; i <= rings; i++) for (let j = 0; j < n; j++) {
    const r = Math.max(.002, i / rings), t = (j / n) * Math.PI * 2, s2 = Math.sin(t), u = a * r * Math.cos(t), v = b * r * Math.sign(s2) * Math.abs(s2) ** e;
    const st = S.locate('side', [x + u * c - v * sn, y + u * sn + v * c], seed);
    S.P(...st, p); S.normal(...st, N);
    pos.push(p[0] + N.x * push, p[1] + N.y * push, p[2] + N.z * push);
    W.set(u * c - v * sn, u * sn + v * c, 0).addScaledVector(N, -(N.x * (u * c - v * sn) + N.y * (u * sn + v * c)));
    if (W.lengthSq() > 1e-12) N.addScaledVector(W.normalize(), k * r ** 2).normalize();
    nor.push(N.x, N.y, N.z);
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n, A = i * n + j, B = i * n + j2, C = (i + 1) * n + j, D = (i + 1) * n + j2;
    idx.push(A, C, B, B, C, D); // anticlockwise from outside, on the +z side of the car
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

const plateInk = new Map();

/**
 * A number plate as UK plates are laid out: black characters 79 mm tall on the plate colour, 14 mm strokes, 11 mm between
 * characters and a wider gap between the two groups. The mark is invented. Drawn as strokes, so it needs no font and no canvas.
 */
function plateTexture(field) {
  const W = 620, H = 132, mm = W / 520, d = new Uint8Array(W * H * 4), ring = (cx, cy, rx, ry, n = 20) => Array.from({length: n + 1}, (_, i) => { const t = (i / n) * Math.PI * 2; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]; });
  const GLYPH = {
    X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
    K: [[[0, 0], [0, 1]], [[1, 1], [0, .4]], [[.3, .62], [1, 0]]],
    1: [[[.2, .78], [.56, 1], [.56, 0]]],
    0: [ring(.5, .5, .5, .5)],
    8: [ring(.5, .75, .42, .25), ring(.5, .26, .5, .26)],
  };
  const chars = 'X100 XK8', cw = 50 * mm, ch = 79 * mm, gap = 11 * mm, space = 33 * mm, half = 7 * mm;
  const total = [...chars].reduce((n, c) => n + (c === ' ' ? space : cw + gap), -gap);
  const segs = [];
  let at = (W - total) / 2;
  for (const c of chars) {
    if (c === ' ') { at += space; continue; }
    for (const line of GLYPH[c]) for (let i = 0; i + 1 < line.length; i++) {
      const [a, b] = line[i], [e, f] = line[i + 1], P = (u, v) => [at + half + u * (cw - 2 * half), H / 2 + (ch / 2 - half) * (2 * v - 1)];
      segs.push([...P(a, b), ...P(e, f)]);
    }
    at += cw + gap;
  }
  // Each stroke only inks pixels within half + .5 of it, so each one visits only its own box: the same pixels as testing
  // every stroke at every pixel, in a hundredth of the time. Both plates share one ink mask.
  const key = `${W}x${H}`;
  let ink = plateInk.get(key);
  if (!ink) {
    const best = new Float64Array(W * H).fill(1e9), reach = half + 2;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + reach));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = Math.max(0, Math.min(1, ((x + .5 - ax) * dx + (y + .5 - ay) * dy) / (dx * dx + dy * dy || 1)));
        const dist = Math.hypot(x + .5 - ax - dx * t, y + .5 - ay - dy * t), o = y * W + x;
        if (dist < best[o]) best[o] = dist;
      }
    }
    ink = new Float64Array(W * H);
    for (let o = 0; o < W * H; o++) ink[o] = Math.max(0, Math.min(1, half + .5 - best[o]));
    plateInk.set(key, ink);
  }
  for (let o = 0; o < W * H; o++) {
    const i = o * 4, k0 = ink[o];
    for (let k = 0; k < 3; k++) d[i + k] = 255 * (field[k] * (1 - k0) + .03 * k0);
    d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Fine upright flutes for the early lens, as a tiling normal map. Needs uvs: see uvFromFront. */
function diamondNormals() {
  const n = 16, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n - .5, v = y / n - .5, i = (y * n + x) * 4;
    d[i] = 128 + Math.sign(u) * 70; d[i + 1] = 128 + Math.sign(v) * 70; d[i + 2] = 215; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function flutedNormals() {
  const w = 16, d = new Uint8Array(w * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < w; x++) {
    const sl = Math.cos((x / w) * Math.PI * 2), i = (y * w + x) * 4;
    d[i] = 128 + sl * 110; d[i + 1] = 128; d[i + 2] = 240; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, w, 4);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Tiles a texture across a panel as seen from the front, du and dv metres to a tile. */
function uvFromFront(g, du, dv) {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getZ(i) / du; uv[i * 2 + 1] = p.getY(i) / dv; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Expanded metal: bright wire round small diamond holes, about 30 percent open. Tiled across a sheet in the mouth. Made in code, needs no canvas. */
function meshGrilleMaterial(color, metal) {
  const n = 48, d = new Uint8Array(n * n * 4), nd = new Uint8Array(n * n * 4);
  const wire = (x, y) => Math.abs(Math.abs(x / n - .5) * 2 - .5) + Math.abs(Math.abs(y / n - .5) * 2 - .5) - .34; // distance from the diamond's edge
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4, w = wire(x, y), hole = w < 0;
    d[i] = d[i + 1] = d[i + 2] = hole ? 0 : 255; d[i + 3] = 255; // the green channel is the alpha map
    const dx = wire(x + 1, y) - wire(x - 1, y), dy = wire(x, y + 1) - wire(x, y - 1), l = Math.hypot(dx * 3.2, dy * 3.2, 1); // the wire's round shoulders
    nd[i] = 128 + (127 * dx * 3.2) / l; nd[i + 1] = 128 + (127 * dy * 3.2) / l; nd[i + 2] = 128 + 127 / l; nd[i + 3] = 255;
  }
  const normal = new THREE.DataTexture(nd, n, n);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.magFilter = THREE.LinearFilter; normal.minFilter = THREE.LinearMipmapLinearFilter; normal.generateMipmaps = true;
  normal.needsUpdate = true;
  const t = new THREE.DataTexture(d, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({color, metalness: metal, roughness: .38, alphaMap: t, alphaTest: .45, envMapIntensity: .9, side: THREE.DoubleSide, normalMap: normal, normalScale: new THREE.Vector2(.8, .8)});
}

/** A sheet in the mouth, just behind the lip, with uvs that tile the diamonds at their real size. */
function grilleSheet(back = 0, shift = 0) {
  const nz = 40, ny = 8, pos = [], nor = [], uv = [], idx = [];
  const top = (z) => .468 - .09 * (z / .58) ** 4, bot = (z) => .30 + .07 * (z / .58) ** 2.4;
  for (let i = 0; i <= nz; i++) for (let j = 0; j <= ny; j++) {
    const z = -.578 + (1.156 * i) / nz, az = Math.abs(z), y = bot(az) + ((top(az) - bot(az)) * j) / ny;
    const x = 2.105 - .05 * (az / .58) ** 3; // follows the nose, about 30 mm behind the lip
    pos.push(x - back, y, z); nor.push(.96, 0, .25 * z); uv.push(z / .022 + shift, y / .012 + shift); // the holes are about 20 x 10 mm in the low photo
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < ny; j++) {
    const a = i * (ny + 1) + j, b = a + ny + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * The structure under the panels, so a stripped car is not hollow. Sizes are estimates: rails, bulkhead and floor sit
 * where the exploded drawings and engine bay photos put them, clear of the wheels and the engine.
 */
function shell(addP) {
  const plate = (pts, depth, at, axis = 'x') => xf(extrude(pts, depth, {axis}), {at});
  const yz = (pts) => pts.map(([z, y]) => [-z, y]); // a section across the car, for an extrude along x

  // Floor with its tunnel, and the heel board up to the rear pan.
  const tunnel = [[-.74, .215], [-.20, .215], [-.15, .40], [-.09, .45], [.09, .45], [.15, .40], [.20, .215], [.74, .215], [.74, .24], [.22, .24], [.17, .42], [.10, .47], [-.10, .47], [-.17, .42], [-.22, .24], [-.74, .24]];
  const floor = plate(yz(tunnel), 1.60, [-.92, 0, 0]);
  const heel = plate(yz([[-.72, .2], [.72, .2], [.72, .46], [-.72, .46]]), .03, [-.95, 0, 0]);
  const rearPan = plate([[-.98, -.72], [-1.36, -.72], [-1.36, .72], [-.98, .72]], .02, [0, .445, 0], 'y');
  // The floor's pressed ribs and the seam along the tunnel: on the real pan they are what the underseal shows up.
  const pressing = [];
  for (const s of [1, -1]) {
    for (const x of [.42, .14, -.14, -.42]) pressing.push(box(.05, .012, .40, {bevel: .005, at: [x, .209, s * .48]}));
    pressing.push(box(1.5, .012, .022, {bevel: .004, at: [-.1, .209, s * .23]}), box(1.5, .012, .022, {bevel: .004, at: [-.1, .209, s * .70]}));
  }
  addP('body.shell', {underseal: [floor, heel, rearPan, ...pressing]}, {explode: [0, -.28, 0], lift: [0, -.2, 0]});

  // Sill box.
  addP('body.shell', {underseal: [box(1.8, .13, .12, {at: [0, .27, .725], bevel: .012}), box(.14, .014, .28, {at: [.75, .222, .60], bevel: .004})]}, {mirror: true, explode: [0, -.2, .45], lift: [0, 0, .3]}); // the second box closes the corner of the footwell, where daylight showed from below

  // Bulkhead and scuttle.
  const bulkhead = plate(yz([[-.78, .24], [.78, .24], [.80, .46], [.74, .72], [.66, .885], [-.66, .885], [-.74, .72], [-.80, .46]]), .022, [.70, 0, 0]);
  addP('body.shell', {paint: [bulkhead, box(.16, .018, 1.3, {at: [.77, .845, 0], bevel: .004})]}, {explode: [.35, .4, 0], lift: [.2, .3, 0]});

  // A and B posts, and the coupe's pillars and rails.
  const post = (pts, r = .028) => tube(pts, r, {radial: 8});
  addP('body.shell', {paint: [post([[.655, .3, .80], [.67, .6, .80], [.60, .84, .79]], .04), post([[-.66, .3, .80], [-.66, .6, .79], [-.62, .89, .77]], .04)]}, {mirror: true, explode: [.1, .35, .55], lift: [0, .3, .3]});

  // Engine bay: longitudinals, inner wings with the spring towers, radiator support.
  const railRings = [];
  for (const [x, y] of [[.72, .29], [.95, .30], [1.15, .36], [1.5, .38], [1.8, .37], [1.95, .36]]) railRings.push([[x, y - .06, .42], [x, y + .06, .42], [x, y + .06, .52], [x, y - .06, .52]]);
  addP('body.longitudinal', {underseal: [loft(railRings, {smooth: false})]}, {mirror: true, explode: [.55, -.1, .5], lift: [.5, -.2, .4]});

  const drum = (cx, r, zIn, zOut, cy, a0, a1) => xf(lathe([[r, zOut], [r, zIn]], {seg: 40, axis: 'z', arc: rad(a1 - a0)}), {rot: [0, 0, rad(a1)], at: [cx, cy, 0]}); // a lathe about z turns clockwise from +x
  const tower = xf(lathe([[.13, .36], [.12, .48], [.118, .52], [.114, .585], [.104, .612], [.088, .62], [.015, .62]], {seg: 24}), {at: [AXLE_F, .13, .50]}); // a broad pressed top, clear of the tyre below it
  const wall = xf(extrude([[.72, .36], [.72, .86], [1.0, .82], [1.5, .74], [1.86, .62], [1.86, .36], [1.67, .36], [1.62, .55], [1.45, .68], [1.29, .71], [1.13, .68], [.96, .55], [.92, .36]], .016, {axis: 'z'}), {at: [0, 0, .58]});
  const flange = [];
  const fy = (x) => (x < 1 ? .86 - (x - .72) * .14 : x < 1.5 ? .82 - (x - 1) * .16 : .74 - (x - 1.5) * .33) - .04;
  for (let i = 0; i < 12; i++) {
    const x0 = .72 + (i / 12) * 1.14, x1 = .72 + ((i + 1) / 12) * 1.14;
    const r = (x) => [[x, fy(x), .58], [x, fy(x) + .012, .58], [x, fy(x) + .012, .76], [x, fy(x), .76]];
    flange.push(loft([r(x0), r(x1)], {caps: false, smooth: false}));
  }
  addP('body.inner-wing', {paint: [wall, tower, merge(flange)]}, {mirror: true, explode: [.45, .5, .55], lift: [.2, .5, .4]});

  const support = [box(.05, .05, 1.24, {at: [1.86, .60, 0], bevel: .01}), box(.06, .06, 1.1, {at: [1.87, .27, 0], bevel: .01}), box(.05, .34, .06, {at: [1.86, .43, .56], bevel: .01}), box(.05, .34, .06, {at: [1.86, .43, -.56], bevel: .01})];
  addP('body.shell', {paint: support}, {explode: [.9, .2, 0], lift: [.7, .2, 0]});
  addP('body.radiator-cross-brace', {steelDark: [box(.03, .03, 1.1, {at: [1.82, .33, 0], bevel: .006})]}, {explode: [1.05, -.2, 0], lift: [.6, -.2, 0]});
  addP('body.cruciform-brace', {steelDark: [tube([[.92, .2, .42], [1.2, .205, 0], [1.72, .21, -.42]], .018, {radial: 8}), tube([[.92, .2, -.42], [1.2, .205, 0], [1.72, .21, .42]], .018, {radial: 8})]}, {explode: [.3, -.3, 0], lift: [.1, -.25, 0]});
  addP('body.undertray', {plasticBlack: [plate([[1.0, -.42], [1.74, -.46], [1.74, .46], [1.0, .42]], .006, [0, .197, 0], 'y')]}, {explode: [.4, -.4, 0], lift: [.1, -.3, 0]});

  // Boot: floor, spare wheel well, the battery's place on the right, side walls and rear panel.
  const r = .315, wx = -2.0; // estimated to clear the space saver spare
  const hole = Array.from({length: 40}, (_, i) => { const t = (i / 40) * Math.PI * 2; return [wx + r * Math.cos(t), r * Math.sin(t)]; });
  const bootFloor = xf(extrude([[-1.36, -.72], [-1.36, .72], [-2.02, .72], [-2.2, .60], [-2.42, .42], [-2.42, -.42], [-2.2, -.60], [-2.02, -.72]], .016, {axis: 'y', holes: [hole]}), {at: [0, .43, 0]}); // inside the boat tail in plan
  const well = xf(lathe([[r, 0], [r - .01, -.13], [r - .06, -.17], [.001, -.17]], {seg: 40}), {at: [wx, .43, 0]}); // wound to face in: it is a dish seen from above
  const tray = box(.26, .03, .18, {bevel: .006, at: [-2.15, .44, .47]});
  const seatBack = plate(yz([[-.72, .44], [.72, .44], [.74, .98], [-.74, .98]]), .02, [-1.37, 0, 0]);
  const rearPanel = plate(yz([[-.42, .43], [.42, .43], [.50, .72], [-.50, .72]]), .02, [-2.45, 0, 0]); // inside the tail's curve in plan
  addP('body.shell', {underseal: [bootFloor, well, tray, rearPanel], paint: [seatBack]}, {explode: [-.55, -.05, 0], lift: [-.3, -.1, 0]});

  // Boot trim: the carpeted floor over the spare and the battery, and the side liners. Jobs lift the floor out. Heights estimated from the handbook's boot pictures.
  const floorOutline = [[-1.40, -.70], [-1.40, .70], [-2.0, .70], [-2.18, .59], [-2.40, .41], [-2.40, -.41], [-2.18, -.59], [-2.0, -.70]];
  addP('body.boot-floor', {carpet: [xf(extrude(floorOutline, .014, {axis: 'y', bevel: .004}), {at: [0, .475, 0]})]}, {explode: [-.65, .25, 0], lift: [0, .34, 0]});
  const sideTrim = (s) => xf(extrude([[-1.42, .478], [-1.98, .478], [-1.98, .70], [-1.86, .80], [-1.42, .82]], .012, {axis: 'z', bevel: .003}), {at: [0, 0, s * .695 - .006]});
  addP('body.boot-trim', {carpet: [sideTrim(1), sideTrim(-1), box(.014, .24, .78, {bevel: .004, at: [-2.40, .60, 0]})]}, {explode: [-.65, .12, .3], lift: [0, 0, 0]});

  // The coupe's parcel shelf: without it the rear screen looks straight down into the boot.
  addP('body.shell', () => ({carpet: [xf(extrude([[-1.30, -.66], [-1.30, .66], [-1.86, .66], [-2.0, .46], [-2.05, .2], [-2.05, -.2], [-2.0, -.46], [-1.86, -.66]], .012, {axis: 'y'}), {at: [0, .955, 0]})]}), {explode: [-.55, .55, 0], lift: [-.2, .3, 0], variant: (v) => v.body === 'coupe'});

  // Rear inner arches.
  const archEnd = xf(lathe([[ARCH_R.r - .004, 0], [.20, 0]], {seg: 40, axis: 'z', arc: Math.PI}), {rot: [0, 0, Math.PI], at: [AXLE_R, ARCH_Y.r, .58]});
  addP('body.shell', {underseal: [drum(AXLE_R, ARCH_R.r - .006, .58, .84, ARCH_Y.r, 0, 180), archEnd]}, {mirror: true, explode: [-.55, .1, .35], lift: [-.2, .2, .3]});

  // Arch liners, the plastic the wheels spin in.
  const linerEnd = xf(lathe([[ARCH_R.f - .01, 0], [.16, 0]], {seg: 36, axis: 'z', arc: rad(224)}), {rot: [0, 0, rad(202)], at: [AXLE_F, ARCH_Y.f, .60]});
  addP('body.wheelarch-liner', {plasticBlack: [drum(AXLE_F, ARCH_R.f - .012, .60, .825, ARCH_Y.f, -22, 202), linerEnd]}, {mirror: true, explode: [.3, .05, .9], lift: [0, 0, .6]});
  addP('body.wheelarch-liner', {plasticBlack: [drum(AXLE_R, ARCH_R.r - .012, .60, .84, ARCH_Y.r, -18, 186)]}, {mirror: true, explode: [-.3, .05, .9], lift: [0, 0, .6]});

  // Boot latch on the rear panel.
  addP('body.boot-latch', {plasticBlack: [box(.1, .05, .07, {at: [-2.46, .71, 0], bevel: .005})], steelDark: [tube([[-2.46, .69, 0], [-2.42, .60, .1]], .004, {radial: 6})]}, {explode: [-1.0, .2, 0], lift: [-.25, .1, 0]});
}

const state = {movers: null};

export function update(sim) {
  const m = state.movers;
  if (!m) return;
  for (const o of m.bonnet) o.rotation.z = -rad(BONNET_HINGE.deg) * sim.open.bonnet;
  const a = -rad(BONNET_HINGE.deg) * sim.open.bonnet, c = Math.cos(a), sn = Math.sin(a), px = STRUT.lid[0] - BONNET_HINGE.x, py = STRUT.lid[1] - BONNET_HINGE.y;
  const bx = BONNET_HINGE.x + px * c - py * sn, by = BONNET_HINGE.y + px * sn + py * c, dx = bx - STRUT.body[0], dy = by - STRUT.body[1];
  for (const o of m.struts) {
    o.position.set(STRUT.body[0] + dx / 2, STRUT.body[1] + dy / 2, o.userData.z);
    o.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    o.scale.y = Math.hypot(dx, dy);
  }
  for (const o of m.boot) o.rotation.z = -rad(LID_HINGE.deg) * sim.open.boot;
  for (const o of m.doorR) o.rotation.y = rad(HINGE.deg) * sim.open.doorR;
  for (const o of m.doorL) o.rotation.y = rad(HINGE.deg) * sim.open.doorL;
  for (const o of m.glassDrop) o.position.y = -GLASS_DROP * Math.min(1, sim.roof.latch * 2 + sim.roof.frame); // clear of the frame first
}
