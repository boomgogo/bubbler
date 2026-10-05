// Lantern Lake: the 3D scene behind the board, and the cube map of it that the bubbles reflect.
// Everything is generated in code. The world surrounds the board on all sides, because the
// front of a glass ball reflects what is behind the viewer.
import {
  Scene, Mesh, Points, SphereGeometry, CircleGeometry, CylinderGeometry, PlaneGeometry, BufferGeometry,
  BufferAttribute, InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial, BackSide, DoubleSide,
  AdditiveBlending, CubeCamera, WebGLCubeRenderTarget, HalfFloatType, UnsignedByteType,
  LinearMipmapLinearFilter, LinearFilter,
} from 'three';
import { WATER_Y } from './layout.js';

const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';

// Shared by sky, mountains and water so they agree on where the afterglow is.
// The player looks down the lake along -Z; the moon hangs behind and above them.
export const MOON_DIR = [-0.4613, 0.5014, 0.732];
const SKY = /* glsl */ `
const float WATER = ${WATER_Y.toFixed(3)};
const vec3 MOON_DIR = vec3(${MOON_DIR.join(', ')});
float lakeFront(vec3 d) { return smoothstep(0.6, -0.9, d.z); }
vec3 skyColor(vec3 d, float glow) {
  float h = d.y;
  float front = lakeFront(d);
  // Only the lowest part of the sky is ever on screen, so the whole dusk gradient is packed
  // into the first few degrees: ember on the horizon, plum above it, then night.
  vec3 zenith = vec3(0.006, 0.012, 0.045);
  vec3 mid = mix(vec3(0.016, 0.04, 0.12), vec3(0.075, 0.036, 0.13), front);
  vec3 low = mix(vec3(0.04, 0.10, 0.20), vec3(0.95, 0.30, 0.09), front);
  vec3 col = mix(low, mid, smoothstep(0.0, 0.16, h));
  col = mix(col, zenith, smoothstep(0.1, 0.4, h));
  col += vec3(1.3, 0.5, 0.12) * front * front * exp(-h * 60.0) * 0.8 * glow;
  float m = dot(d, MOON_DIR);
  col += vec3(1.0, 0.96, 0.86) * (smoothstep(0.99955, 0.99975, m) * 9.0 + exp((m - 1.0) * 900.0) * 0.5 + exp((m - 1.0) * 60.0) * 0.05);
  return col;
}`;

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

export class Environment {
  constructor() {
    this.scene = new Scene();
    this.time = { value: 0 };
    this.glow = { value: 1 };
    this.pointScale = { value: 1 };
    this.face = 0;
    this.target = null;
    this.cubeCamera = null;
    this.#sky();
    this.#stars();
    this.#mountains();
    this.#lanterns();
    this.#water();
  }

  #add(mesh, order) {
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    this.scene.add(mesh);
    return mesh;
  }

  #sky() {
    const material = new ShaderMaterial({
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: { uGlow: this.glow },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY}
        varying vec3 vDir;
        uniform float uGlow;
        void main() {
          vec3 d = normalize(vDir);
          // Below the horizon the dome shows the sky's mirror image: the lake's reflection.
          float below = step(d.y, 0.0);
          d.y = abs(d.y);
          gl_FragColor = vec4(skyColor(d, uGlow) * mix(1.0, 0.7, below), 1.0);
          ${OUT}
        }`,
    });
    const dome = this.#add(new Mesh(new SphereGeometry(900, 32, 20), material), -10);
    dome.position.y = WATER_Y;
  }

  #stars() {
    const count = 650;
    const position = new Float32Array(count * 3);
    const look = new Float32Array(count * 2);
    // A fixed scatter: the sky should look the same on every visit.
    let s = 12345;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) {
      const y = 0.04 + rand() * 0.96;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      position.set([Math.cos(a) * r * 850, WATER_Y + y * 850, Math.sin(a) * r * 850], i * 3);
      look.set([1 + rand() * rand() * 2.4, rand() * 6.28], i * 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aLook', new BufferAttribute(look, 2));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: this.time, uPx: this.pointScale },
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
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a * 1.4, 1.0);
          ${OUT}
        }`,
    });
    this.#add(new Points(geometry, material), 1);
  }

  // Three rings of ridgeline around the lake. Each strip runs from a peak down through the
  // waterline to the peak's mirror image, so the reflection costs nothing extra.
  #mountains() {
    const layers = [
      { r: 150, h: 10, seed: 1.3 },
      { r: 205, h: 21, seed: 4.1 },
      { r: 280, h: 39, seed: 8.7 },
    ];
    const FREQ = [5, 9, 16, 27, 44, 71];
    const WEIGHT = [0.34, 0.24, 0.18, 0.12, 0.07, 0.05];
    const SEG = 600;
    const position = [];
    const height = [];
    const layer = [];
    const index = [];
    layers.forEach((L, li) => {
      const base = position.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        let ridge = 0;
        FREQ.forEach((f, j) => (ridge += WEIGHT[j] * (1 - Math.abs(Math.sin(f * a * 0.5 + L.seed * (j + 1) * 1.7)))));
        const frac = 0.12 + 0.88 * Math.pow(ridge, 1.6);
        const x = Math.cos(a) * L.r;
        const z = Math.sin(a) * L.r;
        position.push(x, WATER_Y + L.h * frac, z, x, WATER_Y - L.h * frac, z);
        height.push(frac, -frac);
        layer.push(li, li);
      }
      for (let k = 0; k < SEG; k++) {
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
      uniforms: { uGlow: this.glow },
      vertexShader: /* glsl */ `
        attribute float aHeight;
        attribute float aLayer;
        varying float vHeight;
        varying float vLayer;
        varying vec3 vDir;
        void main() {
          vHeight = aHeight;
          vLayer = aLayer;
          vDir = vec3(position.x, 0.0, position.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY}
        varying float vHeight;
        varying float vLayer;
        varying vec3 vDir;
        uniform float uGlow;
        void main() {
          float front = lakeFront(normalize(vDir));
          float depth = vLayer * 0.5;
          // Near ridges are silhouettes. Distance and the waterline pick up the colour of the
          // sky behind them.
          vec3 haze = mix(vec3(0.03, 0.07, 0.15), vec3(0.42, 0.14, 0.06), front);
          vec3 col = mix(vec3(0.010, 0.012, 0.028), haze, 0.06 + 0.26 * depth);
          col = mix(col, haze, (1.0 - smoothstep(0.0, 0.3, abs(vHeight))) * 0.45);
          if (vHeight < 0.0) col *= 0.72;
          gl_FragColor = vec4(col * (0.85 + 0.15 * uGlow), 1.0);
          ${OUT}
        }`,
    });
    this.#add(new Mesh(geometry, material), 0);
  }

  // Paper lanterns drifting up from the water. Their motion is computed in the vertex shader
  // from the clock, so ninety of them cost nothing on the CPU.
  #lanterns() {
    const count = 90;
    const seed = new Float32Array(count * 4);
    const tint = new Float32Array(count);
    let s = 2024;
    const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; ) {
      const a = rand() * Math.PI * 2;
      const r = 13 + 105 * Math.pow(rand(), 1.3);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Keep the line of sight between the player and the board clear.
      if (Math.abs(x) < 45 && z > -12 && z < 52) continue;
      seed.set([x, z, rand(), 0.22 + rand() * 0.42], i * 4);
      tint[i++] = rand();
    }
    const seedAttr = new InstancedBufferAttribute(seed, 4);
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
    const WARM = 'mix(vec3(1.0, 0.5, 0.12), vec3(1.0, 0.26, 0.13), vTint)';

    const body = new ShaderMaterial({
      uniforms: { uTime: this.time, uGlow: this.glow },
      vertexShader: /* glsl */ `
        const float WATER = ${WATER_Y.toFixed(3)};
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
          gl_FragColor = vec4(${WARM} * mix(2.4, 0.7, vUp) * uGlow, 1.0);
          ${OUT}
        }`,
    });
    this.#add(new Mesh(instanced(new CylinderGeometry(0.42, 0.56, 1.3, 7)), body), 0);

    // A soft halo around each lantern, and a long smeared streak where it reflects in the water.
    const halo = (mirror) =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: { uTime: this.time, uGlow: this.glow },
        vertexShader: /* glsl */ `
          const float WATER = ${WATER_Y.toFixed(3)};
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
            gl_FragColor = vec4(${WARM} * a * 0.32 * uGlow, 1.0);
            ${OUT}
          }`,
      });
    this.#add(new Mesh(instanced(new PlaneGeometry(2, 2)), halo(true)), 2);
    this.#add(new Mesh(instanced(new PlaneGeometry(2, 2)), halo(false)), 4);
  }

  // The lake surface is a thin tinted layer over the mirrored world beneath it:
  // nearly clear at a glancing angle, darker underfoot, with ripples that catch the light.
  #water() {
    const material = new ShaderMaterial({
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      uniforms: { uTime: this.time, uGlow: this.glow },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${SKY}
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uGlow;
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
          float alpha = mix(0.62, 0.16, fres) + trough * 0.18;
          vec3 shine = mix(vec3(0.10, 0.2, 0.36), vec3(0.9, 0.42, 0.2), front) * glint * (0.1 + 0.5 * fres) * uGlow;
          gl_FragColor = vec4(vec3(0.004, 0.014, 0.03) * alpha + shine, alpha);
          ${OUT}
        }`,
    });
    const lake = this.#add(new Mesh(new CircleGeometry(150, 64), material), 3);
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = WATER_Y;
  }

  // (Re)creates the cube map the bubbles reflect. HDR keeps lanterns and the moon bright in
  // reflections; where the GPU cannot render to half floats the bubble shader fakes it.
  setTier(renderer, tier) {
    const gl = renderer.getContext();
    const hdr = tier.hdr && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.target?.dispose();
    this.target = new WebGLCubeRenderTarget(tier.cube, {
      type: hdr ? HalfFloatType : UnsignedByteType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    this.hdr = hdr;
    this.cubeCamera = new CubeCamera(1, 1500, this.target);
    this.cubeCamera.position.set(0, 0.5, 0);
    this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
    this.cubeCamera.updateCoordinateSystem();
    this.cubeCamera.updateMatrixWorld();
    this.capture(renderer);
  }

  get texture() {
    return this.target.texture;
  }

  update(time) {
    this.time.value = time;
  }

  // Renders one face of the cube map; six calls make a full refresh.
  captureFace(renderer) {
    const face = this.face;
    this.face = (face + 1) % 6;
    const texture = this.target.texture;
    const previous = renderer.getRenderTarget();
    const pointScale = this.pointScale.value;
    this.pointScale.value = 1;
    texture.generateMipmaps = face === 5; // build the blurred levels once per round
    renderer.setRenderTarget(this.target, face);
    renderer.clear();
    renderer.render(this.scene, this.cubeCamera.children[face]);
    texture.generateMipmaps = true;
    this.pointScale.value = pointScale;
    renderer.setRenderTarget(previous);
  }

  capture(renderer) {
    this.face = 0;
    for (let i = 0; i < 6; i++) this.captureFace(renderer);
  }
}
