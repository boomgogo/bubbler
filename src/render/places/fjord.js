// Aurora Fjord: black water between steep snow-capped walls that open to the sea ahead, snow
// drifting down, and the aurora: a faint curtain low over the fjord's mouth, and bright ones
// overhead and behind the player, where the glass of the bubbles catches them.
import { Group, Mesh, Points, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending, DoubleSide } from 'three';
import { WATER_Y } from '../layout.js';
import { OUT, seeded, add, skyDome, stars, ridges, water } from './kit.js';

const MOON_DIR = [0.4472, 0.4, 0.8];
const SKY = /* glsl */ `
const float WATER = ${WATER_Y.toFixed(3)};
const vec3 MOON_DIR = normalize(vec3(${MOON_DIR.join(', ')}));
float lakeFront(vec3 d) { return smoothstep(0.6, -0.9, d.z); }
vec3 skyColor(vec3 d, float glow) {
  float h = d.y;
  float front = lakeFront(d);
  // Cold teal on the horizon, the sea's open sky brightest ahead, deep night above.
  vec3 zenith = vec3(0.002, 0.006, 0.02);
  vec3 low = mix(vec3(0.016, 0.045, 0.075), vec3(0.03, 0.1, 0.12), front);
  vec3 col = mix(low, zenith, smoothstep(0.0, 0.32, h));
  // Aurora light scattered low in the air all round.
  col += vec3(0.02, 0.1, 0.065) * exp(-h * 16.0) * (0.55 + 0.45 * glow);
  float m = dot(d, MOON_DIR);
  col += vec3(0.85, 0.92, 1.0) * (smoothstep(0.99965, 0.99982, m) * 7.0 + exp((m - 1.0) * 1200.0) * 0.4 + exp((m - 1.0) * 80.0) * 0.04);
  return col;
}`;

// Rock nearly black; snow above a ragged line catches the aurora's green and the moon.
const RIDGE_SHADE = /* glsl */ `
  float front = lakeFront(normalize(vDir));
  float depth = vLayer * 0.5;
  float hgt = abs(vHeight);
  float a = atan(vDir.z, vDir.x);
  float line = 0.4 + 0.1 * sin(a * 37.0 + vLayer * 3.0) + 0.05 * sin(a * 113.0 + vLayer);
  float snow = smoothstep(line, line + 0.05, hgt);
  vec3 lit = mix(vec3(0.16, 0.24, 0.32), vec3(0.12, 0.32, 0.25), 0.5 + 0.5 * sin(uTime * 0.07 + a * 2.0));
  col = mix(vec3(0.005, 0.008, 0.014), lit, snow * (0.5 + 0.5 * depth));
  vec3 haze = mix(vec3(0.016, 0.04, 0.065), vec3(0.03, 0.09, 0.1), front);
  col = mix(col, haze, 0.08 + 0.3 * depth);
  col = mix(col, haze, (1.0 - smoothstep(0.0, 0.25, hgt)) * 0.4);
  if (vHeight < 0.0) col *= 0.6;
  col *= 0.85 + 0.15 * uGlow;`;

// Fjord walls: sharper peaks than the lake's hills, cut down into a V where the fjord opens
// to the sea straight ahead.
function profile(ridge, a, layer) {
  const ahead = Math.abs(((a + Math.PI / 2 + Math.PI) % (Math.PI * 2)) - Math.PI);
  const t = Math.min(1, Math.max(0, (ahead - 0.03) / 0.3));
  const notch = 1 - [0.85, 0.6, 0.25][layer] * (1 - t * t * (3 - 2 * t));
  return (0.08 + 0.92 * Math.pow(ridge, 2.2)) * notch;
}

// Aurora curtains: each an arc of vertical light round the viewer. Angles are measured like
// the ridges (z = sin a), heights above the water. gain above 1 is HDR light for reflections.
const CURTAINS = [
  { a: -Math.PI / 2, span: 1.7, r: 420, base: 34, height: 58, gain: 0.26, rays: 0.2 }, // ahead, low and soft
  { a: Math.PI / 2, span: 2.5, r: 170, base: 95, height: 125, gain: 1.7, rays: 1 }, // overhead, behind
  { a: Math.PI * 0.86, span: 1.4, r: 260, base: 45, height: 95, gain: 1.3, rays: 0.9 }, // behind, left
  { a: Math.PI * 0.2, span: 1.8, r: 120, base: 140, height: 85, gain: 1.0, rays: 0.8 }, // near the zenith
];

function aurora(shared, mirror) {
  const SEG = 140;
  const position = [];
  const uv = [];
  const info = [];
  const index = [];
  const rand = seeded(77);
  for (const c of CURTAINS) {
    const base = position.length / 3;
    const fold = rand() * 6.28;
    const length = c.span * c.r;
    for (let k = 0; k <= SEG; k++) {
      const s = k / SEG;
      const a = c.a + (s - 0.5) * c.span;
      // Curtains fold back and forth as they run.
      const r = c.r * (1 + 0.06 * Math.sin(s * 9 + fold) + 0.03 * Math.sin(s * 23 + fold * 2));
      for (const v of [0, 1]) {
        position.push(Math.cos(a) * r, WATER_Y + c.base + v * c.height, Math.sin(a) * r);
        uv.push(s, v);
        info.push(length / 40, fold, c.gain, c.rays);
      }
    }
    for (let k = 0; k < SEG; k++) {
      const i = base + k * 2;
      index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aUv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setAttribute('aInfo', new BufferAttribute(new Float32Array(info), 4));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      const float WATER = ${WATER_Y.toFixed(3)};
      attribute vec2 aUv;
      attribute vec4 aInfo; // length in ray units, seed, gain, ray strength
      uniform float uTime;
      varying vec2 vUv;
      varying vec4 vInfo;
      void main() {
        vec3 p = position;
        // A slow sway along the curtain's length.
        float sway = sin(uTime * 0.16 + aUv.x * 7.0 + aInfo.y) * 0.035 + sin(uTime * 0.27 + aUv.x * 17.0) * 0.012;
        p.xz *= 1.0 + sway * (0.4 + aUv.y);
        ${mirror ? 'p.y = 2.0 * WATER - p.y;' : ''}
        vUv = aUv;
        vInfo = aInfo;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      varying vec2 vUv;
      varying vec4 vInfo;
      void main() {
        float s = vUv.x;
        float v = vUv.y;
        float x = s * vInfo.x * 40.0;
        // Rays: fine vertical streaks that drift along the curtain and flicker.
        float rays = 0.55 + 0.45 * sin(x * 0.9 + sin(x * 0.13 + uTime * 0.4) * 3.0 + uTime * 0.7);
        rays *= 0.6 + 0.4 * sin(x * 0.37 - uTime * 0.9 + vInfo.y);
        float folds = 0.55 + 0.45 * sin(s * 11.0 + uTime * 0.21 + vInfo.y * 3.0);
        // A sharp lower hem, fading upwards; the ends of each curtain melt away.
        float body = smoothstep(0.0, 0.07, v) * pow(1.0 - v, 1.5) * smoothstep(0.0, 0.12, s) * smoothstep(1.0, 0.88, s);
        vec3 col = mix(vec3(0.12, 1.0, 0.42), vec3(0.5, 0.18, 0.95), smoothstep(0.2, 0.85, v));
        col += vec3(0.6, 0.15, 0.3) * smoothstep(0.03, 0.0, abs(v - 0.035)) * 0.6; // a pink fringe on the hem
        float k = body * mix(1.0, rays, vInfo.w) * folds * vInfo.z * uGlow;
        ${mirror ? 'k *= 0.35;' : ''}
        gl_FragColor = vec4(col * k, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(geometry, material);
}

// Snow drifting down round the lake, outside the line of sight and the fly-over's airspace.
function snow(shared, count = 700) {
  const SPAN = 60;
  const rand = seeded(4242);
  const position = new Float32Array(count * 3);
  const look = new Float32Array(count * 2);
  for (let i = 0; i < count; ) {
    const x = (rand() * 2 - 1) * 130;
    const z = (rand() * 2 - 1) * 150;
    if (Math.abs(x) < 45 && z > -12 && z < 52) continue;
    position.set([x, rand() * SPAN, z], i * 3);
    look.set([0.6 + rand() * 0.8, rand() * 6.28], i * 2);
    i++;
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
      const float WATER = ${WATER_Y.toFixed(3)};
      attribute vec2 aLook; // fall speed, phase
      uniform float uTime;
      uniform float uPx;
      varying float vA;
      void main() {
        float y = mod(position.y - uTime * aLook.x, ${SPAN.toFixed(1)});
        vec3 p = vec3(position.x + sin(uTime * 0.5 + aLook.y) * 1.2, WATER + y, position.z + cos(uTime * 0.4 + aLook.y) * 1.2);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, 4.0, y) * smoothstep(${SPAN.toFixed(1)}, ${(SPAN - 8).toFixed(1)}, y);
        gl_PointSize = clamp(uPx * 60.0 / -mv.z, 1.0, 6.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5)) * vA;
        gl_FragColor = vec4(vec3(0.7, 0.8, 0.9) * a * 0.55, 1.0);
        ${OUT}
      }`,
  });
  return new Points(geometry, material);
}

// The music: E minor at a slow drift. Glassy bells ring triplets over the bar like ice
// crystals, a low pluck beats like a slow pulse, and a flute carries a long, cold tune.
// Each chord: pad voicing, bass, and six notes for the bells.
const CHORDS = [
  { pad: [52, 59, 66, 67], bass: 40, ice: [76, 79, 83, 86, 88, 83] }, // Em9
  { pad: [48, 55, 59, 64], bass: 36, ice: [72, 76, 79, 83, 84, 79] }, // Cmaj7
  { pad: [43, 50, 59, 62], bass: 43, ice: [74, 79, 83, 86, 91, 86] }, // G
  { pad: [50, 57, 64, 69], bass: 38, ice: [74, 76, 81, 86, 88, 81] }, // Dsus2
  { pad: [52, 59, 64, 67], bass: 40, ice: [76, 79, 83, 88, 91, 88] }, // Em
  { pad: [48, 55, 59, 64], bass: 36, ice: [72, 76, 79, 83, 88, 83] }, // Cmaj7
  { pad: [45, 52, 60, 64], bass: 45, ice: [69, 72, 76, 81, 84, 81] }, // Am7
  { pad: [47, 54, 57, 62], bass: 47, ice: [71, 74, 78, 81, 86, 81] }, // Bm7
];
const TUNE = [
  [71, 0, 2], [69, 2, 1], [67, 3, 1],
  [64, 4, 2.5], [67, 6.5, 0.5], [69, 7, 1],
  [71, 8, 1.5], [74, 9.5, 0.5], [71, 10, 1], [67, 11, 1],
  [69, 12, 4],
  [76, 16, 1.5], [74, 17.5, 0.5], [71, 18, 2],
  [74, 20, 1], [71, 21, 1], [67, 22, 2],
  [69, 24, 1.5], [71, 25.5, 0.5], [72, 26, 1], [71, 27, 1],
  [66, 28, 1], [69, 29, 1], [71, 30, 2],
];

export const music = {
  bpm: 66,
  beats: 4,
  level: 1.6,
  echo: { beats: 1.5, feedback: 0.42, mix: 0.34, tone: 3200 },
  air: { type: 'bandpass', hz: 700, q: 1.4, gain: 0.022, swell: 0.06, sweep: 350 }, // wind down the fjord
  bar(play, i, t) {
    const b = play.beat;
    const chord = CHORDS[i % 8];
    const pass = Math.floor(i / 8) % 4; // 0 sets out, 1 sings, 2 sings in bells, 3 rests
    const bar = i % 8;
    play.pad(chord.pad, t, play.bar * 0.95, 0.02, { attack: 1.8, release: 2.4, cutoff: 750 });
    if (pass !== 3 || bar % 2 === 0) play.bass(chord.bass, t, b * 3, 0.065);
    // Ice: six bell notes across the bar, three to every two beats.
    const thin = pass === 0 ? 0.45 : pass === 3 ? 0.6 : 0.15;
    chord.ice.forEach((n, k) => {
      if (Math.random() < thin) return;
      play.bell(n, t + (k * 2 * b) / 3, k === 0 ? 0.03 : 0.022, { decay: 2.2, send: 0.6 });
    });
    // A slow pulse: the root and its fifth, low, on the one and just after the two.
    if (pass === 1 || pass === 2) {
      play.pluck(chord.bass + 12, t, 0.05, { decay: 1.6, send: 0.1 });
      play.pluck(chord.bass + 19, t + 1.5 * b, 0.035, { decay: 1.4, send: 0.1 });
    }
    if (pass === 1 || pass === 2) {
      for (const [n, beat, len] of TUNE) {
        if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
        const at = t + (beat - bar * 4) * b;
        if (pass === 1) play.lead(n, at, len * b * 0.95, 0.05, { vibrato: 9 });
        else play.bell(n + 12, at, 0.035, { decay: 3, send: 0.55 });
      }
    }
  },
};

export default {
  id: 'fjord',
  name: 'Aurora Fjord',
  theme: '#03101a',
  music,
  build(shared) {
    const group = new Group();
    add(group, skyDome(shared, SKY, { below: 0.6 }), -10);
    add(group, stars(shared, { count: 950, seed: 991, low: 0.06, color: 'vec3(0.8, 0.88, 1.0)', gain: 1.5 }), 1);
    add(group, aurora(shared, false), 1);
    add(group, ridges(shared, {
      sky: SKY,
      layers: [
        { r: 130, h: 17, seed: 2.2 },
        { r: 190, h: 31, seed: 5.3 },
        { r: 270, h: 54, seed: 9.1 },
      ],
      profile,
      shade: RIDGE_SHADE,
    }), 0);
    add(group, aurora(shared, true), 2);
    add(group, snow(shared), 4);
    add(group, water(shared, {
      sky: SKY,
      deep: 'vec3(0.002, 0.007, 0.012)',
      shine: 'mix(vec3(0.08, 0.3, 0.26), vec3(0.18, 0.42, 0.4), front)',
      alpha: [0.72, 0.22],
    }), 3);
    return group;
  },
};
