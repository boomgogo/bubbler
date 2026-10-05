// Particles: glass shards, sparks, rings and beams. Each kind is one instanced draw call
// fed from a ring buffer. A particle's whole life is computed in the vertex shader from its
// birth time, so the CPU only writes a few numbers when something spawns.
import {
  Mesh, Points, BufferGeometry, BufferAttribute, PlaneGeometry, InstancedBufferGeometry,
  InstancedBufferAttribute, ShaderMaterial, AdditiveBlending, DoubleSide, DynamicDrawUsage, Color,
} from 'three';
import { PALETTE } from './bubbles.js';

const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';
const COLORS = PALETTE.map((hex) => new Color(hex));
const WHITE = new Color(1, 1, 1);
export const colorOf = (index) => (index >= 0 ? COLORS[index] : WHITE);

// A fixed pool of instances with named attributes; spawn() overwrites the oldest.
class Pool {
  constructor(capacity, layout) {
    this.capacity = capacity;
    this.cursor = 0;
    this.attributes = {};
    for (const [name, size] of Object.entries(layout)) {
      const attribute = new InstancedBufferAttribute(new Float32Array(capacity * size).fill(-1e3), size);
      attribute.setUsage(DynamicDrawUsage);
      this.attributes[name] = attribute;
    }
  }

  attach(geometry, instanced = true) {
    for (const [name, attribute] of Object.entries(this.attributes)) geometry.setAttribute(name, attribute);
    if (instanced) geometry.instanceCount = this.capacity;
    return geometry;
  }

  spawn(values) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    for (const [name, value] of Object.entries(values)) {
      const attribute = this.attributes[name];
      attribute.array.set(value, i * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor(tier, environment) {
    this.time = { value: 0 };
    this.unit = { value: 40 }; // pixels per world unit, for point sizes
    this.tier = tier;
    this.objects = [this.#shards(environment), this.#sparks(), this.#rings(), this.#beams()];
    for (const o of this.objects) o.frustumCulled = false;
  }

  setTier(tier, environment) {
    this.tier = tier;
    this.shardMaterial.uniforms.uEnv.value = environment.texture;
  }

  // Slivers of the popped bubble's shell. They tumble, fall and mirror the lake as they go.
  #shards(environment) {
    this.shards = new Pool(640, { aP0: 3, aV: 3, aSpin: 4, aTint: 4 });
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.3, 0, 0.5, -0.3, 0, 0, 0.55, 0]), 3));
    this.shards.attach(geometry);
    this.shardMaterial = new ShaderMaterial({
      side: DoubleSide,
      uniforms: { uTime: this.time, uEnv: { value: environment.texture } },
      vertexShader: /* glsl */ `
        attribute vec3 aP0;
        attribute vec3 aV;
        attribute vec4 aSpin; // axis, birth
        attribute vec4 aTint; // colour, size
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vWorld;
        varying vec3 vTint;
        vec3 spin(vec3 v, vec3 k, float a) {
          return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
        }
        void main() {
          float age = uTime - aSpin.w;
          float t = clamp(age / 0.6, 0.0, 1.0);
          float alive = step(0.0, age) * step(age, 0.6);
          vec3 axis = normalize(aSpin.xyz);
          float angle = age * 11.0 + aTint.a * 40.0;
          vec3 local = spin(position, axis, angle) * aTint.a * (1.0 - t * t) * alive;
          vec3 world = aP0 + aV * age + vec3(0.0, -13.0, 0.0) * age * age + local;
          vN = spin(vec3(0.0, 0.0, 1.0), axis, angle);
          vWorld = world;
          vTint = aTint.rgb;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube uEnv;
        varying vec3 vN;
        varying vec3 vWorld;
        varying vec3 vTint;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vN);
          N *= sign(dot(N, V));
          vec3 col = textureCube(uEnv, reflect(-V, N)).rgb * 1.6 + vTint * 0.75;
          gl_FragColor = vec4(col, 1.0);
          ${OUT}
        }`,
    });
    return new Mesh(geometry, this.shardMaterial);
  }

  #sparks() {
    this.sparks = new Pool(1400, { aP0: 3, aV: 3, aLife: 3, aColor: 3 });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(1400 * 3), 3));
    // Points are not instanced: the pool's arrays are plain per-vertex attributes here.
    for (const [name, attribute] of Object.entries(this.sparks.attributes)) {
      geometry.setAttribute(name, new BufferAttribute(attribute.array, attribute.itemSize).setUsage(DynamicDrawUsage));
      this.sparks.attributes[name] = geometry.attributes[name];
    }
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uTime: this.time, uUnit: this.unit },
      vertexShader: /* glsl */ `
        attribute vec3 aP0;
        attribute vec3 aV;
        attribute vec3 aLife; // birth, lifetime, size
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uUnit;
        varying vec3 vColor;
        void main() {
          float age = uTime - aLife.x;
          float t = clamp(age / aLife.y, 0.0, 1.0);
          float alive = step(0.0, age) * step(age, aLife.y);
          // Drag slows the burst; a little gravity pulls it down.
          vec3 world = aP0 + aV * (1.0 - exp(-age * 3.0)) / 3.0 + vec3(0.0, -4.0, 0.0) * age * age;
          vColor = aColor * (1.0 - t) * alive;
          gl_PointSize = aLife.z * uUnit * (1.0 - t * 0.6) * alive;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor * smoothstep(0.5, 0.05, d), 1.0);
          ${OUT}
        }`,
    });
    return new Points(geometry, material);
  }

  // Expanding rings: shock rings facing the camera, and ripples lying on the water.
  #rings() {
    this.rings = new Pool(120, { aCenter: 3, aLife: 4, aTint: 4 });
    const plane = new PlaneGeometry(2, 2);
    const geometry = new InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    this.rings.attach(geometry);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: { uTime: this.time },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute vec4 aLife; // birth, lifetime, start radius, end radius
        attribute vec4 aTint; // colour, 1 when the ring lies flat on the water
        uniform float uTime;
        varying vec2 vUv;
        varying vec4 vTint; // colour, fade
        void main() {
          float age = uTime - aLife.x;
          float t = clamp(age / aLife.y, 0.0, 1.0);
          float alive = step(0.0, age) * step(age, aLife.y);
          float radius = mix(aLife.z, aLife.w, 1.0 - (1.0 - t) * (1.0 - t)) * alive;
          vec2 q = position.xy * radius;
          vec3 world = aCenter + (aTint.a > 0.5 ? vec3(q.x, 0.0, q.y) : vec3(q, 0.0));
          vUv = position.xy;
          vTint = vec4(aTint.rgb, (1.0 - t) * (1.0 - t));
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec4 vTint;
        void main() {
          float d = length(vUv);
          float band = exp(-pow((d - 0.88) / 0.06, 2.0)) + (1.0 - smoothstep(0.0, 0.9, d)) * 0.12;
          gl_FragColor = vec4(vTint.rgb * band * vTint.a, 1.0);
          ${OUT}
        }`,
    });
    return new Mesh(geometry, material);
  }

  // Streaks of light between two points, for a Comet's sweep and its flight.
  #beams() {
    this.beams = new Pool(32, { aA: 3, aB: 3, aLife: 4, aColor: 3 });
    const plane = new PlaneGeometry(2, 2);
    const geometry = new InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.setAttribute('position', plane.attributes.position);
    this.beams.attach(geometry);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: { uTime: this.time },
      vertexShader: /* glsl */ `
        attribute vec3 aA;
        attribute vec3 aB;
        attribute vec4 aLife; // birth, lifetime, width, seconds for the head to reach B
        attribute vec3 aColor;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float age = uTime - aLife.x;
          float t = clamp(age / aLife.y, 0.0, 1.0);
          float alive = step(0.0, age) * step(age, aLife.y);
          float head = clamp(age / max(aLife.w, 0.001), 0.0, 1.0);
          vec3 along = aB - aA;
          vec3 side = normalize(cross(along, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
          vec3 world = mix(aA, aB, (position.x * 0.5 + 0.5) * head) + side * position.y * aLife.z * (1.0 - t) * alive;
          vUv = position.xy;
          vColor = aColor * (1.0 - t) * alive;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float core = exp(-vUv.y * vUv.y * 9.0);
          gl_FragColor = vec4((vColor + vec3(0.6) * core * core) * core, 1.0);
          ${OUT}
        }`,
    });
    return new Mesh(geometry, material);
  }

  ring(x, y, z, color, { from = 0.2, to = 1.4, life = 0.45, flat = false, delay = 0, gain = 1 } = {}) {
    this.rings.spawn({
      aCenter: [x, y, z],
      aLife: [this.time.value + delay, life, from, to],
      aTint: [color.r * gain, color.g * gain, color.b * gain, flat ? 1 : 0],
    });
  }

  beam(ax, ay, bx, by, color, { width = 0.45, life = 0.5, travel = 0.12, gain = 1.6 } = {}) {
    this.beams.spawn({
      aA: [ax, ay, 0.05],
      aB: [bx, by, 0.05],
      aLife: [this.time.value, life, width, travel],
      aColor: [color.r * gain, color.g * gain, color.b * gain],
    });
  }

  spark(x, y, z, vx, vy, vz, color, life = 0.5, size = 0.16, gain = 1.4) {
    this.sparks.spawn({
      aP0: [x, y, z],
      aV: [vx, vy, vz],
      aLife: [this.time.value, life, size],
      aColor: [color.r * gain, color.g * gain, color.b * gain],
    });
  }

  burst(x, y, color, count, speed = 7, z = 0.3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * rnd(0.35, 1);
      this.spark(x, y, z, Math.cos(a) * s, Math.sin(a) * s, rnd(-1, 2), color, rnd(0.3, 0.6), rnd(0.09, 0.2));
    }
  }

  // A bubble bursts: shards, sparks and a flash ring.
  pop(x, y, colorIndex, dark = false) {
    const color = colorOf(colorIndex);
    for (let i = 0; i < this.tier.shards; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rnd(2.2, 6);
      this.shards.spawn({
        aP0: [x + Math.cos(a) * 0.25, y + Math.sin(a) * 0.25, 0.1],
        aV: [Math.cos(a) * s, Math.sin(a) * s + 2.5, rnd(0.5, 4)],
        aSpin: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1) + 0.01, this.time.value],
        aTint: dark ? [0.02, 0.02, 0.04, rnd(0.16, 0.3)] : [color.r, color.g, color.b, rnd(0.14, 0.26)],
      });
    }
    if (!dark) this.burst(x, y, color, this.tier.sparks, 6);
    this.ring(x, y, 0.2, color, { from: 0.25, to: 0.95, life: 0.3, gain: dark ? 0.3 : 0.9 });
  }

  // A dropped bubble meets the lake.
  splash(x, y, colorIndex) {
    const color = colorOf(colorIndex);
    this.ring(x, y, 0, color, { from: 0.2, to: 2.4, life: 0.9, flat: true, gain: 0.8 });
    this.ring(x, y, 0, color, { from: 0.1, to: 1.3, life: 0.7, flat: true, delay: 0.12, gain: 0.5 });
    for (let i = 0; i < Math.ceil(this.tier.sparks / 2); i++) {
      this.spark(x, y, 0, rnd(-2.5, 2.5), rnd(5, 10), rnd(-1, 1), color, rnd(0.35, 0.6), rnd(0.08, 0.15), 1.2);
    }
  }

  update(time, unit) {
    this.time.value = time;
    this.unit.value = unit;
  }
}
