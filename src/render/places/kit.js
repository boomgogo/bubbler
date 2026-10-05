// The parts a place is built from: sky dome, stars, rings of ridges, drifting lights and the
// lake. Every place is generated in code from these and its own shaders; there are no files.
//
// Rules every place follows:
// 1. The floor at WATER_Y is water: dropped bubbles splash there.
// 2. Behind the board the sky stays smooth and unbusy, so the five bubble colours and their
//    glyphs read at a glance. Detail belongs on the horizon and out of the line of sight.
// 3. Bright, varied light sits behind the viewer (+z) and overhead: the fronts of the bubbles
//    mirror what is behind the player, so that is most of what the glass shows.
// 4. Lights go above 1.0, so the HDR cube map keeps them bright in reflections, and scale with
//    uGlow, so a big clear makes them flare.
// 5. The line of sight from the player to the board, and the air above the column where the
//    fly-over goes, stay clear: nothing within |x| < 45 and -12 < z < 52.
// 6. At most 8 draw calls, no textures, no extra passes. Full-screen shaders (dome, water) cost
//    no more than Lantern Lake's; fine detail goes on small meshes.
// 7. Fixed seeds: a place looks the same on every visit.
// 8. No NaN, ever. With multisampling, edge pixels are shaded just outside the triangle, so
//    varyings run past their range there: clamp them before pow(), sqrt() or log(). On the high
//    tier the bloom blurs a single NaN pixel into a blank screen. `npm run check:nan` looks.
//
// A place's sky shader is a GLSL chunk that defines `vec3 skyColor(vec3 d, float glow)` and
// `float lakeFront(vec3 d)` (1 down the lake ahead of the player, 0 behind), shared by the
// dome, the ridges and the water so they agree on where the light is.
import {
  Mesh, Points, SphereGeometry, CircleGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry,
  BufferAttribute, InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial, BackSide, DoubleSide,
  AdditiveBlending,
} from 'three';
import { WATER_Y } from '../layout.js';

export const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// A small seeded random generator, so scatters come out the same every time.
export function seeded(seed) {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function add(group, mesh, order) {
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  group.add(mesh);
  return mesh;
}

// The sky all round. Below the horizon the dome shows the sky's mirror image, dimmed by `below`:
// the lake's reflection.
export function skyDome(shared, sky, { below = 0.7 } = {}) {
  const material = new ShaderMaterial({
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: { uGlow: shared.glow, uTime: shared.time },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      uniform float uTime;
      ${sky}
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float below = step(d.y, 0.0);
        d.y = abs(d.y);
        gl_FragColor = vec4(skyColor(d, uGlow) * mix(1.0, ${below.toFixed(3)}, below), 1.0);
        ${OUT}
      }`,
  });
  const dome = new Mesh(new SphereGeometry(900, 32, 20), material);
  dome.position.y = WATER_Y;
  return dome;
}

// Twinkling points on the dome. `low` is the lowest star's height, as a fraction of the dome.
export function stars(shared, { count = 650, seed = 12345, low = 0.04, color = 'vec3(0.85, 0.9, 1.0)', gain = 1.4, size = 2.4 } = {}) {
  const position = new Float32Array(count * 3);
  const look = new Float32Array(count * 2);
  const rand = seeded(seed);
  for (let i = 0; i < count; i++) {
    const y = low + rand() * (1 - low);
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    position.set([Math.cos(a) * r * 850, WATER_Y + y * 850, Math.sin(a) * r * 850], i * 3);
    look.set([1 + rand() * rand() * size, rand() * 6.28], i * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aLook', new BufferAttribute(look, 2));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: shared.time, uPx: shared.pointScale },
    vertexShader: /* glsl */ `
      attribute vec2 aLook;
      uniform float uTime;
      uniform float uPx;
      varying float vA;
      void main() {
        vA = 0.55 + 0.45 * sin(uTime * (0.6 + aLook.y * 0.25) + aLook.y * 9.0);
        gl_PointSize = aLook.x * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(p)) * vA;
        gl_FragColor = vec4(${color} * a * ${gain.toFixed(3)}, 1.0);
        ${OUT}
      }`,
  });
  return new Points(geometry, material);
}

// Rings of ridgeline round the lake. Each strip runs from a peak down through the waterline to
// the peak's mirror image, so the reflection costs nothing extra. layers: { r, h, seed }.
// profile(ridge) turns a 0..1 ridge value into a height fraction. shade: GLSL that sets
// `vec3 col` from vHeight (-1..1, negative in the reflection), vLayer, vDir and uGlow.
export function ridges(shared, { sky, layers, shade, profile = (ridge) => 0.12 + 0.88 * Math.pow(ridge, 1.6), segments = 600 }) {
  const FREQ = [5, 9, 16, 27, 44, 71];
  const WEIGHT = [0.34, 0.24, 0.18, 0.12, 0.07, 0.05];
  const position = [];
  const height = [];
  const layer = [];
  const index = [];
  layers.forEach((L, li) => {
    const base = position.length / 3;
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      let ridge = 0;
      FREQ.forEach((f, j) => (ridge += WEIGHT[j] * (1 - Math.abs(Math.sin(f * a * 0.5 + L.seed * (j + 1) * 1.7)))));
      const frac = profile(ridge, a, li);
      const x = Math.cos(a) * L.r;
      const z = Math.sin(a) * L.r;
      position.push(x, WATER_Y + L.h * frac, z, x, WATER_Y - L.h * frac, z);
      height.push(frac, -frac);
      layer.push(li, li);
    }
    for (let k = 0; k < segments; k++) {
      const i = base + k * 2;
      index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aHeight', new BufferAttribute(new Float32Array(height), 1));
  geometry.setAttribute('aLayer', new BufferAttribute(new Float32Array(layer), 1));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uGlow: shared.glow, uTime: shared.time },
    vertexShader: /* glsl */ `
      attribute float aHeight;
      attribute float aLayer;
      varying float vHeight;
      varying float vLayer;
      varying vec3 vDir;
      varying vec3 vWorld;
      void main() {
        vHeight = aHeight;
        vLayer = aLayer;
        vDir = vec3(position.x, 0.0, position.z);
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      uniform float uTime;
      ${sky}
      varying float vHeight;
      varying float vLayer;
      varying vec3 vDir;
      varying vec3 vWorld;
      void main() {
        vec3 col;
        ${shade}
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(geometry, material);
}

// Paper lanterns drifting up from the water, with a soft halo and a long smeared streak where
// each one reflects in the lake. Their motion is computed in the vertex shader from the clock,
// so ninety of them cost nothing on the CPU. Three draw calls; returns [body, streak, halo]
// with their render orders.
export function lanterns(shared, { count = 90, seed = 2024, warm = 'mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.26, 0.13), vTint)' } = {}) {
  const LANTERN = /* glsl */ `
    attribute vec4 aSeed; // x, z, phase, rise speed
    attribute float aTint;
    uniform float uTime;
    const float SPAN = 64.0;
    vec3 lanternPos(out float life) {
      float y = mod(aSeed.z * SPAN + uTime * aSeed.w, SPAN);
      life = smoothstep(0.0, 2.5, y) * smoothstep(SPAN, SPAN - 12.0, y);
      return vec3(
        aSeed.x + sin(uTime * 0.21 + aSeed.z * 40.0) * 1.3,
        WATER + 0.9 + y,
        aSeed.y + cos(uTime * 0.17 + aSeed.z * 70.0) * 1.3);
    }`;
  const WATER = `const float WATER = ${WATER_Y.toFixed(3)};`;
  const seedArray = new Float32Array(count * 4);
  const tint = new Float32Array(count);
  const rand = seeded(seed);
  for (let i = 0; i < count; ) {
    const a = rand() * Math.PI * 2;
    const r = 13 + 105 * Math.pow(rand(), 1.3);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    // Keep the line of sight between the player and the board clear.
    if (Math.abs(x) < 45 && z > -12 && z < 52) continue;
    seedArray.set([x, z, rand(), 0.22 + rand() * 0.42], i * 4);
    tint[i++] = rand();
  }
  const seedAttr = new InstancedBufferAttribute(seedArray, 4);
  const tintAttr = new InstancedBufferAttribute(tint, 1);
  const instanced = (base) => {
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('aSeed', seedAttr);
    g.setAttribute('aTint', tintAttr);
    g.instanceCount = count;
    return g;
  };

  const body = new ShaderMaterial({
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      ${WATER}
      ${LANTERN}
      varying float vUp;
      varying float vTint;
      void main() {
        float life;
        vec3 c = lanternPos(life);
        vUp = position.y / 1.3 + 0.5;
        vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * vec4(c + position * (0.6 + aTint * 0.35) * life, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vUp;
      varying float vTint;
      uniform float uGlow;
      void main() {
        gl_FragColor = vec4(${warm} * mix(2.4, 0.7, vUp) * uGlow, 1.0);
        ${OUT}
      }`,
  });

  const halo = (mirror) =>
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: shared.time, uGlow: shared.glow },
      vertexShader: /* glsl */ `
        ${WATER}
        ${LANTERN}
        varying vec2 vUv;
        varying float vTint;
        varying float vLife;
        void main() {
          float life;
          vec3 c = lanternPos(life);
          vec2 size = vec2(2.3);
          ${mirror ? `
          life *= 0.5 / (1.0 + (c.y - WATER) * 0.1);
          c.y = 2.0 * WATER - c.y;
          size = vec2(0.9, 4.2);` : ''}
          vec4 mv = viewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * size * (0.6 + aTint * 0.35);
          ${mirror ? 'mv.x += sin(uTime * 2.3 + position.y * 5.0 + aSeed.z * 30.0) * 0.12;' : ''}
          vUv = position.xy;
          vTint = aTint;
          vLife = life;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vTint;
        varying float vLife;
        uniform float uGlow;
        void main() {
          // Falls to exactly zero at the edge of the quad, so no square shows.
          float a = pow(max(0.0, 1.0 - dot(vUv, vUv)), 3.0) * vLife;
          gl_FragColor = vec4(${warm} * a * 0.32 * uGlow, 1.0);
          ${OUT}
        }`,
    });
  return [
    [new Mesh(instanced(new CylinderGeometry(0.42, 0.56, 1.3, 7)), body), 0],
    [new Mesh(instanced(new PlaneGeometry(2, 2)), halo(true)), 2],
    [new Mesh(instanced(new PlaneGeometry(2, 2)), halo(false)), 4],
  ];
}

// The lake surface: a thin tinted layer over the mirrored world beneath it, nearly clear at a
// glancing angle, darker underfoot, with ripples that catch the light.
// deep: GLSL colour of the water itself. shine: GLSL colour of the glints, may use `front`.
// alpha: [underfoot, glancing].
export function water(shared, {
  sky,
  deep = 'vec3(0.004, 0.014, 0.03)',
  shine = 'mix(vec3(0.10, 0.2, 0.36), vec3(0.9, 0.42, 0.2), front)',
  alpha = [0.62, 0.16],
  radius = 150,
} = {}) {
  const material = new ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      ${sky}
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float dist = length(toEye);
        float fres = pow(1.0 - clamp(toEye.y / dist, 0.0, 1.0), 3.0);
        vec2 p = vWorld.xz * vec2(0.35, 1.6);
        float n = noise(p + vec2(uTime * 0.25, uTime * 0.6)) * 0.6 + noise(p * 2.3 - vec2(uTime * 0.2, uTime * 0.9)) * 0.4;
        float detail = smoothstep(150.0, 15.0, dist);
        float glint = smoothstep(0.62, 0.9, n) * detail;
        float trough = smoothstep(0.55, 0.2, n) * detail;
        float front = lakeFront(normalize(vec3(vWorld.x, 0.0, vWorld.z)));
        float alpha = mix(${alpha[0].toFixed(3)}, ${alpha[1].toFixed(3)}, fres) + trough * 0.18;
        vec3 shine = ${shine} * glint * (0.1 + 0.5 * fres) * uGlow;
        gl_FragColor = vec4(${deep} * alpha + shine, alpha);
        ${OUT}
      }`,
  });
  const lake = new Mesh(new CircleGeometry(radius, 64), material);
  lake.rotation.x = -Math.PI / 2;
  lake.position.y = WATER_Y;
  return lake;
}
