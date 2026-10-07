// Parts the later places share and Lantern Lake does not need. Only lazy chunks import this
// file, so it travels as a small chunk of its own and adds nothing to the first load.
import {
  Points, BufferGeometry, BufferAttribute, InstancedBufferAttribute, ShaderMaterial, AdditiveBlending,
} from 'three';
import { WATER_Y } from '../layout.js';
import { OUT, seeded } from './kit.js';

// Points of light that drift and blink (fireflies, tower lights), with their reflections in the
// water, in one draw call. spot(rand) returns [x, height above the water, z], or null to try
// again: keep the clear zone of rule 5 empty. GLSL hooks, with `vec4 aLook` (four random numbers
// per mote), uTime and uGlow in scope:
//   motion: statements that move `vec3 p` (starts at the spot, y measured up from the water);
//   blink: an expression for the brightness, 0..1;
//   color: an expression for the colour, above 1.0 for HDR.
// Reflections are dimmed by `mirror` (0 for none). Draw after the water, which would otherwise
// paint over lights that write no depth.
export function motes(shared, { count, seed, spot, motion = '', blink = '1.0', color, size = [1, 6], scale = 60, mirror = 0.4 }) {
  const copies = mirror > 0 ? 2 : 1;
  const position = new Float32Array(count * copies * 3);
  const look = new Float32Array(count * copies * 4);
  const flip = new Float32Array(count * copies);
  const rand = seeded(seed);
  for (let i = 0; i < count; ) {
    const p = spot(rand);
    if (!p) continue;
    const l = [rand(), rand(), rand(), rand()];
    for (let m = 0; m < copies; m++) {
      const j = i + m * count;
      position.set(p, j * 3);
      look.set(l, j * 4);
      flip[j] = m;
    }
    i++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('aLook', new BufferAttribute(look, 4));
  geometry.setAttribute('aMirror', new BufferAttribute(flip, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: shared.time, uGlow: shared.glow, uPx: shared.pointScale },
    vertexShader: /* glsl */ `
      const float WATER = ${WATER_Y.toFixed(3)};
      attribute vec4 aLook;
      attribute float aMirror;
      uniform float uTime;
      uniform float uGlow;
      uniform float uPx;
      varying vec3 vColor;
      void main() {
        vec3 p = position;
        ${motion}
        float k = ${blink};
        if (aMirror > 0.5) {
          // Upside down under the water, dimmer the higher it flies, trembling with the ripples.
          k *= ${mirror.toFixed(3)} / (1.0 + max(p.y, 0.0) * 0.08);
          p.x += sin(uTime * 2.3 + aLook.x * 40.0) * 0.06 * p.y;
          p.y = -p.y;
        }
        vColor = (${color}) * k * uGlow;
        vec4 mv = modelViewMatrix * vec4(p.x, WATER + p.y, p.z, 1.0);
        // Unlit motes shrink to nothing, so they cost no pixels.
        gl_PointSize = k > 0.002 ? clamp(uPx * ${scale.toFixed(1)} / -mv.z, ${size[0].toFixed(2)}, ${size[1].toFixed(2)}) : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = max(0.0, 1.0 - dot(q, q) * 4.0);
        // A hot core inside a soft halo; zero at the edge, so no square shows.
        float a = d * d * d * 0.7 + smoothstep(0.75, 1.0, d) * 0.6;
        gl_FragColor = vec4(vColor * a, 1.0);
        ${OUT}
      }`,
  });
  return new Points(geometry, material);
}

// A silhouette and its reflection as one geometry: the copy is turned upside down about the
// waterline and carries aMirror = 1, for the shader to dim and ripple.
export function withMirror(geometry) {
  const out = new BufferGeometry();
  const n = geometry.attributes.position.count;
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const a = new attr.array.constructor(attr.array.length * 2);
    a.set(attr.array);
    a.set(attr.array, attr.array.length);
    if (name === 'position') for (let i = n; i < 2 * n; i++) a[i * 3 + 1] = 2 * WATER_Y - a[i * 3 + 1];
    out.setAttribute(name, new BufferAttribute(a, attr.itemSize));
  }
  out.setAttribute('aMirror', new BufferAttribute(new Float32Array(2 * n).fill(1, n), 1));
  if (geometry.index) {
    const index = geometry.index.array;
    const both = new Uint32Array(index.length * 2);
    both.set(index);
    for (let i = 0; i < index.length; i++) both[index.length + i] = index[i] + n;
    out.setIndex(new BufferAttribute(both, 1));
  }
  return out;
}

// The same for instances: each one twice, the second time with aMirror = 1. Instances carry
// their place in attributes, so the shader does the flipping.
export function mirrorInstances(geometry) {
  const n = geometry.instanceCount;
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (!attr.isInstancedBufferAttribute) continue;
    const a = new attr.array.constructor(attr.array.length * 2);
    a.set(attr.array);
    a.set(attr.array, attr.array.length);
    geometry.setAttribute(name, new InstancedBufferAttribute(a, attr.itemSize));
  }
  geometry.setAttribute('aMirror', new InstancedBufferAttribute(new Float32Array(2 * n).fill(1, n), 1));
  geometry.instanceCount = 2 * n;
  return geometry;
}
