// A soft contact shadow baked from below, in the manner of three's contact-shadow example. The car is drawn once from
// under the floor into a small target, blurred tight and wide, and shown on a plane. One bake costs about one shadow pass
// and it only runs when something on the car has moved, so it is cheap on every tier, phones included.
import * as THREE from 'three';
import {LAYER} from '../car/registry.js';

const W = 7.6, D = 4.4, HEIGHT = 1.0; // metres covered and depth of the fade; the car is 4.76 x 1.83
const FAST_QUAD = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
const QUAD_CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const blurMaterial = () => new THREE.ShaderMaterial({
  depthTest: false,
  depthWrite: false,
  uniforms: {map: {value: null}, step: {value: new THREE.Vector2()}},
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D map; uniform vec2 step; varying vec2 vUv;
    void main() {
      float a = texture2D(map, vUv).a * 0.227;
      a += (texture2D(map, vUv + step * 1.385).a + texture2D(map, vUv - step * 1.385).a) * 0.316;
      a += (texture2D(map, vUv + step * 3.231).a + texture2D(map, vUv - step * 3.231).a) * 0.070;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    }`,
});

export function createFloor(renderer, scene) {
  const RES = 512, WIDE = 128;
  const target = () => new THREE.WebGLRenderTarget(RES, Math.round((RES * D) / W), {depthBuffer: true, format: THREE.RGBAFormat, type: THREE.UnsignedByteType});
  const small = () => new THREE.WebGLRenderTarget(WIDE, Math.round((WIDE * D) / W), {depthBuffer: false});
  const rtDepth = target(), rtTemp = target(), rtWide = small(), rtWideTemp = small();

  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 0, HEIGHT);
  cam.rotation.x = Math.PI / 2; // from the floor looking up: screen right is +x, screen up is +z
  cam.layers.set(LAYER.SOLID);
  cam.layers.enable(LAYER.GLASS);

  const depthMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n}',
    fragmentShader: 'void main() { float h = 1.0 - gl_FragCoord.z; gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(0.35 + h * 0.75, 0.0, 1.0)); }',
  });
  const blur = blurMaterial();
  FAST_QUAD.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(FAST_QUAD);
  const pass = (from, to, x, y) => {
    FAST_QUAD.material = blur;
    blur.uniforms.map.value = from.texture;
    blur.uniforms.step.value.set(x / from.width, y / from.height);
    renderer.setRenderTarget(to);
    renderer.render(quadScene, QUAD_CAM);
  };

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {tight: {value: rtDepth.texture}, wide: {value: rtWide.texture}, size: {value: new THREE.Vector2(W, D)}, ink: {value: new THREE.Color('#20262c')}, strength: {value: 1}},
      vertexShader: 'varying vec3 vP; void main() { vec4 p = modelMatrix * vec4(position, 1.0); vP = p.xyz; gl_Position = projectionMatrix * viewMatrix * p; }',
      fragmentShader: `
        uniform sampler2D tight; uniform sampler2D wide; uniform vec2 size; uniform vec3 ink; uniform float strength; varying vec3 vP;
        void main() {
          vec2 uv = vP.xz / size + 0.5;
          vec2 edge = min(uv, 1.0 - uv);
          float fade = smoothstep(0.0, 0.12, min(edge.x, edge.y));
          float a = texture2D(tight, uv).a * 0.42 + texture2D(wide, uv).a * 0.46;
          gl_FragColor = vec4(ink, clamp(a * strength, 0.0, 0.8) * fade);
          #include <colorspace_fragment>
        }`,
    }),
  );
  plane.position.y = 0.0006;
  plane.layers.set(LAYER.GHOST);
  plane.renderOrder = -1;
  scene.add(plane);

  /** Redraws the shadow. Hidden and ghosted parts cast nothing, because they are not on the camera's layers. */
  function bake() {
    const prevTarget = renderer.getRenderTarget(), prevBg = scene.background, prevOverride = scene.overrideMaterial, prevEnv = scene.environment;
    const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    plane.visible = false;
    scene.background = null;
    scene.environment = null;
    scene.overrideMaterial = depthMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtDepth);
    renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    scene.environment = prevEnv;
    // tight, about 25 mm
    pass(rtDepth, rtTemp, 1.2, 0);
    pass(rtTemp, rtDepth, 0, 1.2);
    // wide, about 150 mm, at a quarter of the resolution
    pass(rtDepth, rtWide, 1, 0);
    pass(rtWide, rtWideTemp, 1.6, 0);
    pass(rtWideTemp, rtWide, 0, 1.6);
    pass(rtWide, rtWideTemp, 2.4, 0);
    pass(rtWideTemp, rtWide, 0, 2.4);
    plane.visible = true;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(color, alpha);
    renderer.shadowMap.autoUpdate = auto;
  }

  return {plane, bake, setStrength(k) { plane.material.uniforms.strength.value = k; }};
}
