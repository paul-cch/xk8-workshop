// The shared material library. One instance of each, so 400 parts cost a handful of programs.
// Build rules from the teardown skill: roughness at least 0.45 and envMapIntensity about 0.5 on big metal surfaces. Paint
// is the exception and gets a clearcoat. Every look (ghost, x-ray, accent) comes from ghost(), xray() and accent() here.
import * as THREE from 'three';

/** The one accent. It means the part you are working on right now, and nothing else on screen uses it. */
export const ACCENT = '#f2570b';
export const PAINT_DEFAULT = '#14342b'; // British racing green, a look choice and not a fact about any car

const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({color, roughness, metalness, envMapIntensity: metalness > 0.5 ? 0.5 : 0.8, ...extra});

export const materials = {
  paint: new THREE.MeshPhysicalMaterial({color: PAINT_DEFAULT, roughness: 0.5, metalness: 0, specularIntensity: 0.1, clearcoat: 1, clearcoatRoughness: 0.015, envMapIntensity: 1, side: THREE.DoubleSide}), // two-sided: the inside of an open bonnet
  paintBlack: std('#0c0d0e', 0.5, 0.1),
  underseal: std('#34373a', 0.7, 0.05), // floors, rails and arches: stone-chip coat, so the underside reads under the inspection lamp

  aluminiumCast: std('#94979a', 0.68, 0.85),
  aluminiumMachined: std('#c9cccf', 0.46, 0.95),
  steel: std('#8e9296', 0.5, 0.9),
  steelDark: std('#3d4044', 0.58, 0.8),
  zinc: std('#b9b6a8', 0.55, 0.75),
  iron: std('#4a4745', 0.82, 0.55),
  chrome: std('#e4e6e8', 0.16, 1, {envMapIntensity: 1}),
  copper: std('#b5734a', 0.5, 0.9),
  brass: std('#b39a55', 0.5, 0.9),

  rubber: std('#17181a', 0.88),
  tyre: std('#1a1b1d', 0.92),
  hose: std('#25272a', 0.56), // EPDM has a sheen: it is what lets a hose read against black plastic
  plasticBlack: std('#1f2023', 0.56),
  plasticGrey: std('#5a5d62', 0.6),
  plasticBeige: std('#b9ae93', 0.6),
  castBlack: std('#26272a', 0.7, 0.3),
  wrinkleBlack: std('#17181b', 0.84, 0.1),

  leather: std('#c9b896', 0.62),
  leatherDark: std('#2a2623', 0.6),
  carpet: std('#2b2826', 0.95),
  bonnetFelt: std('#5c5d60', 0.96), // the grey felt liner under the bonnet
  wood: std('#5c3620', 0.32),
  fabric: std('#1d1f24', 0.9),

  glass: new THREE.MeshPhysicalMaterial({color: '#0f1715', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.5, envMapIntensity: 1.2, depthWrite: false}),
  lensClear: new THREE.MeshPhysicalMaterial({color: '#e8edf0', roughness: 0.08, transparent: true, opacity: 0.35, envMapIntensity: 1.2, depthWrite: false}),
  lensRed: new THREE.MeshPhysicalMaterial({color: '#a4121c', roughness: 0.14, transparent: true, opacity: 0.9, envMapIntensity: 1}),
  lensAmber: new THREE.MeshPhysicalMaterial({color: '#d9780e', roughness: 0.14, transparent: true, opacity: 0.9, envMapIntensity: 1}),

  electricalGreen: std('#2f5a3c', 0.6),
  fluidRed: std('#8a1e1a', 0.45),
};

/** A module's own material joins the library so it gets the same looks and warm-up. */
export function addMaterial(name, material) {
  materials[name] = material;
  return material;
}

// Fresnel glass drawn by the ghost and x-ray looks. Rims read and faces disappear, so form survives without blocking the view in.
const fresnel = (color, faceAlpha, rimAlpha, power) => new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.FrontSide,
  toneMapped: false,
  uniforms: {color: {value: new THREE.Color(color)}, faceAlpha: {value: faceAlpha}, rimAlpha: {value: rimAlpha}, power: {value: power}},
  vertexShader: `
    #include <common>
    varying vec3 vN; varying vec3 vV;
    void main() {
      #include <begin_vertex>
      #include <project_vertex>
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mvPosition.xyz);
    }`,
  fragmentShader: `
    uniform vec3 color; uniform float faceAlpha; uniform float rimAlpha; uniform float power;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), power);
      gl_FragColor = vec4(color, mix(faceAlpha, rimAlpha, f));
      #include <colorspace_fragment>
    }`,
});

const GHOST = fresnel('#7c8894', 0.05, 0.5, 2.4);
const XRAY = fresnel('#3e5560', 0.02, 0.62, 3.2);
const ACCENT_MAT = new THREE.MeshStandardMaterial({color: ACCENT, roughness: 0.55, metalness: 0, emissive: ACCENT, emissiveIntensity: 0.3, envMapIntensity: 0.5, side: THREE.DoubleSide});
const hoverCache = new WeakMap();

export const ghost = () => GHOST;
export const xray = () => XRAY;
/** The selected or in-work part. One solid colour whatever the part is made of: on metal a tint washes out. */
export const accent = () => ACCENT_MAT;
/** Under the pointer: the base material with a quiet glow. */
export function hover(base) {
  let m = hoverCache.get(base);
  if (!m) {
    m = base.clone();
    if (m.emissive) { m.emissive.set(ACCENT); m.emissiveIntensity = 0.28; }
    hoverCache.set(base, m);
  }
  return m;
}

/**
 * A badge disc: a dark ring round an enamel field with a silver growler's face, drawn in code so it needs no canvas and no
 * artwork. Read with the 0..1 uvs of a circle. Used on the nose, the boot and the wheel centres.
 */
export function growlerTexture(field) {
  const n = 96, d = new Uint8Array(n * n * 4), bg = new THREE.Color(field).convertLinearToSRGB();
  const inEllipse = (x, y, cx, cy, a, b) => ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 2 - 1, y = ((j + 0.5) / n) * 2 - 1, r = Math.hypot(x, y);
    let c = [bg.r * 255, bg.g * 255, bg.b * 255];
    if (r > 0.74) c = [16, 18, 20];
    if (r > 0.78 && r < 0.93 && Math.abs(Math.sin(Math.atan2(y, x) * 26)) > 0.5 && Math.abs(y) < 0.72) c = [168, 170, 172]; // the lettering, read as texture
    // The leaping cat's face, snarling and three-quarter wide: a long muzzle, swept brow, small ears set back, mane lines off the cheeks. No round bear ears.
    const head = Math.min(inEllipse(x, y, 0, 0.05, 0.42, 0.38), inEllipse(x, y, 0, -0.26, 0.24, 0.32), inEllipse(x, y, -0.3, 0.36, 0.09, 0.12), inEllipse(x, y, 0.3, 0.36, 0.09, 0.12));
    if (head < 1) {
      const s = 214 - 70 * Math.max(0, head - 0.45);
      c = [s, s, s * 1.01];
      const eye = Math.min(inEllipse(x - y * 0.5, y, -0.27, 0.14, 0.13, 0.04), inEllipse(x + y * 0.5, y, 0.27, 0.14, 0.13, 0.04));
      const brow = Math.abs(y - 0.25 - 0.35 * Math.abs(x)) < 0.02 && Math.abs(x) > 0.08 && Math.abs(x) < 0.34;
      const noseMark = inEllipse(x, y, 0, -0.14, 0.09, 0.05);
      const bridge = Math.abs(x) < 0.012 && y < 0.1 && y > -0.1;
      const snarl = Math.abs(y + 0.38 + 0.8 * x * x) < 0.05 && Math.abs(x) < 0.16; // the open mouth
      const fang = snarl && Math.abs(Math.abs(x) - 0.09) < 0.02;
      const mane = head > 0.55 && Math.abs(Math.sin(Math.atan2(y + 0.1, x) * 9)) < 0.16 && Math.abs(x) > 0.2;
      if (eye < 1 || brow || noseMark < 1 || bridge || (snarl && !fang) || mane) c = [30, 30, 32];
    }
    d.set([c[0], c[1], c[2], 255], (j * n + i) * 4);
  }
  const t = new THREE.DataTexture(d, n, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export const growlerMaterial = (field) => new THREE.MeshPhysicalMaterial({map: growlerTexture(field), roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1});

/** A look name from pose.js to the material for a mesh's base material. */
export function lookMaterial(look, base) {
  switch (look) {
    case 'ghost': return GHOST;
    case 'xray': return XRAY;
    case 'accent': return ACCENT_MAT;
    case 'hover': return hover(base);
    default: return base;
  }
}

/** Every look material the page can swap to, for the shader warm-up. */
export const lookMaterials = () => [GHOST, XRAY, ACCENT_MAT, hover(materials.steel), hover(materials.paint)];
