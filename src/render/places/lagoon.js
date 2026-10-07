// Glow Lagoon: a warm night on a tropical lagoon under a thin crescent moon. The Milky Way
// arches overhead behind the player, low islands carry their palms, and the wavelets light up
// cyan where they break, plankton glowing in the surf.
import { Group, Mesh, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending, DoubleSide } from 'three';
import { WATER_Y } from '../layout.js';
import { OUT, seeded, add, skyDome, stars, ridges, water } from './kit.js';
import { motes, withMirror } from './parts.js';

// The Milky Way runs along a great circle through the horizon straight left and right of the
// player, tilted back so it peaks 50 degrees up behind them: it never crosses the sky behind
// the board. Along it, t is the angle from the right-hand horizon; across it, s.
const TILT = (50 * Math.PI) / 180;
const BAND_U = [0, Math.sin(TILT), Math.cos(TILT)]; // the band's highest point
const BAND_N = [0, -Math.cos(TILT), Math.sin(TILT)]; // square to the band
const CORE_T = 0.75; // the bright core, a third of the way up, behind and to the right
// A thin crescent moon low behind the player and to the left, for the glass to catch. Its dark
// side is a second disc, a little off the first.
const unit = (v) => v.map((x) => x / Math.hypot(...v));
const MOON_DIR = unit([-0.35, 0.22, 0.91]);
const SHADOW_DIR = unit([MOON_DIR[0] + 0.012, MOON_DIR[1] + 0.007, MOON_DIR[2]]);
const SKY = /* glsl */ `
const float WATER = ${WATER_Y.toFixed(3)};
const vec3 MOON_DIR = vec3(${MOON_DIR.map((v) => v.toFixed(5)).join(', ')});
const vec3 SHADOW_DIR = vec3(${SHADOW_DIR.map((v) => v.toFixed(5)).join(', ')});
float lakeFront(vec3 d) { return smoothstep(0.6, -0.9, d.z); }
vec3 skyColor(vec3 d, float glow) {
  float h = d.y;
  float front = lakeFront(d);
  // Indigo night, violet low behind, a deep teal glow on the horizon ahead.
  vec3 zenith = vec3(0.004, 0.005, 0.03);
  vec3 low = mix(vec3(0.05, 0.03, 0.13), vec3(0.02, 0.05, 0.11), front);
  vec3 col = mix(low, zenith, smoothstep(0.0, 0.4, h));
  col += vec3(0.02, 0.07, 0.09) * exp(-h * 25.0) * front;
  // The crescent in a faint halo, only worked out near it.
  float m = dot(d, MOON_DIR);
  if (m > 0.985) {
    float lit = smoothstep(0.99955, 0.99972, m) * (1.0 - smoothstep(0.99955, 0.99972, dot(d, SHADOW_DIR)));
    col += vec3(1.0, 0.95, 0.85) * lit * 7.0 + vec3(0.5, 0.5, 0.7) * exp((m - 1.0) * 300.0) * 0.12;
  }
  return col;
}`;

// Low islands: a sandbar each side of a rounded hill, nothing at all in between. Returns the
// islands and the profile for kit.ridges.
function islands(layers) {
  const rand = seeded(1717);
  const isles = layers.map((L) => {
    const list = [];
    const n = 5 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const c = ((i + 0.2 + rand() * 0.6) / n) * Math.PI * 2;
      const w = (9 + rand() * 16) / L.r;
      // Open sea straight ahead, past the board: the horizon there stays clear (rule 2).
      const ahead = Math.abs(((c - Math.PI * 1.5 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (ahead < w * 1.6 + 0.1) continue;
      list.push({ c, w, h: 0.35 + rand() * 0.4 });
    }
    return list;
  });
  // Exact, so the palms can stand on it.
  const height = (isle, a) => {
    let d = a - isle.c;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    const x = d / isle.w;
    if (Math.abs(x) >= 1.6) return 0;
    const sand = 0.07 * (1 - (x / 1.6) ** 2);
    const hill = Math.abs(x) < 1 ? isle.h * (1 - x * x) ** 0.6 * (0.92 + 0.08 * Math.sin(a * 97 + isle.c * 13)) : 0;
    return Math.max(sand, hill);
  };
  const profile = (ridge, a, layer) => Math.max(0, ...isles[layer].map((isle) => height(isle, a)));
  return { isles, height, profile };
}

const ISLE_SHADE = /* glsl */ `
  vec3 dir = normalize(vDir);
  float depth = vLayer * 0.5;
  float hgt = abs(vHeight);
  vec3 haze = skyColor(normalize(vec3(dir.x, 0.02, dir.z)), uGlow);
  col = mix(vec3(0.004, 0.005, 0.016), haze, 0.15 + 0.35 * depth);
  // Surf glowing round the shore lights the sand from below.
  col += vec3(0.0, 0.06, 0.07) * (1.0 - smoothstep(0.0, 0.12, hgt)) * (1.0 - depth * 0.6);
  if (vHeight < 0.0) col *= 0.55;
  col *= 0.85 + 0.15 * uGlow;`;

// Palms on the islands: a leaning, tapering trunk and a crown of drooping, feathery fronds.
// All of them, and their reflections, in one mesh.
function palms(shared, layers, { isles, height }) {
  const rand = seeded(4545);
  const position = [];
  const frond = []; // 1 on the fronds, which stir in the breeze
  const index = [];
  const strip = (left, right, isFrond) => {
    const base = position.length / 3;
    for (let k = 0; k < left.length; k++) {
      position.push(...left[k], ...right[k]);
      frond.push(isFrond, isFrond);
    }
    for (let k = 0; k < left.length - 1; k++) {
      const i = base + k * 2;
      index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
    }
  };
  layers.slice(0, 2).forEach((L, li) => {
    for (const isle of isles[li]) {
      const count = 2 + Math.floor(rand() * 4);
      for (let p = 0; p < count; p++) {
        const a = isle.c + (rand() - 0.5) * 1.3 * isle.w;
        const r = L.r - 1.5;
        const x0 = Math.cos(a) * r;
        const z0 = Math.sin(a) * r;
        const y0 = WATER_Y + height(isle, a) * L.h - 1;
        const tall = 6 + rand() * 4.5;
        const tx = -Math.sin(a); // across: square on to the middle of the lagoon
        const tz = Math.cos(a);
        const lean = (rand() - 0.5) * 0.7;
        // Trunk.
        const left = [];
        const right = [];
        let top = null;
        for (let s = 0; s <= 7; s++) {
          const u = s / 7;
          const off = lean * tall * u * u;
          const cx = x0 + tx * off;
          const cz = z0 + tz * off;
          const y = y0 + tall * u;
          const w = 0.24 * (1 - 0.45 * u);
          left.push([cx - tx * w, y, cz - tz * w]);
          right.push([cx + tx * w, y, cz + tz * w]);
          top = [cx, y, cz];
        }
        strip(left, right, 0);
        // Fronds: out and up, then drooping, with leaflets hanging below the stem.
        const fronds = 7 + Math.floor(rand() * 3);
        const spin = rand() * 6.28;
        for (let f = 0; f < fronds; f++) {
          const theta = spin + (f / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.4;
          const dx = Math.cos(theta);
          const dz = Math.sin(theta);
          const len = tall * (0.38 + rand() * 0.14);
          const rise = 0.2 + rand() * 0.25;
          const upper = [];
          const lower = [];
          for (let s = 0; s <= 12; s++) {
            const u = s / 12;
            const cx = top[0] + dx * len * u;
            const cz = top[2] + dz * len * u;
            const cy = top[1] + len * (rise * u - 0.85 * u * u);
            const w = len * 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.1)) * (s % 2 ? 1 : 0.6);
            upper.push([cx, cy + w * 0.12, cz]);
            lower.push([cx - dz * w * 0.3, cy - w, cz + dx * w * 0.3]);
          }
          strip(upper, lower, 1);
        }
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aFrond', new BufferAttribute(new Float32Array(frond), 1));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      attribute float aFrond;
      attribute float aMirror;
      uniform float uTime;
      varying vec3 vWorld;
      varying float vMirror;
      void main() {
        vec3 p = position;
        // Fronds stir in the breeze; the reflection trembles with the ripples.
        float h = abs(p.y - ${WATER_Y.toFixed(3)});
        p.x += aFrond * sin(uTime * 0.9 + p.x * 0.3 + p.z * 0.2) * 0.12;
        if (aMirror > 0.5) p.x += sin(uTime * 2.1 + p.y * 2.5) * 0.04 * h;
        vWorld = p;
        vMirror = aMirror;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      ${SKY}
      varying vec3 vWorld;
      varying float vMirror;
      void main() {
        vec3 haze = skyColor(normalize(vec3(vWorld.x, 0.02, vWorld.z)), uGlow);
        float hgt = abs(vWorld.y - WATER);
        vec3 col = mix(vec3(0.003, 0.004, 0.014), haze, smoothstep(120.0, 260.0, length(vWorld.xz)) * 0.4);
        col += vec3(0.0, 0.05, 0.06) * (1.0 - smoothstep(0.0, 2.0, hgt)); // the surf's glow on the trunks
        col *= mix(1.0, 0.5, vMirror);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(withMirror(geometry), material);
}

// Wavelets breaking in cyan: the lips of the waves along the island shores and in long lines
// behind the player and off to the sides, where the glass sees them. Each is a low curtain
// standing on the water with its reflection hanging below; a flash runs along it as it breaks,
// glittering, then it fades to a faint glow until the next wave.
function crests(shared, layers, { isles }) {
  const rand = seeded(2121);
  const position = [];
  const uv = [];
  const info = [];
  const index = [];
  const ribbon = (points, height, gain) => {
    const base = position.length / 3;
    let length = 0;
    for (let k = 1; k < points.length; k++) length += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
    const seed = rand();
    points.forEach(([x, z], k) => {
      const s = k / (points.length - 1);
      const h = height * (0.5 + 0.5 * Math.sin(Math.PI * s));
      position.push(x, WATER_Y - h * 0.8, z, x, WATER_Y + h, z);
      uv.push(s, 0, s, 1);
      info.push(length, seed, gain, length, seed, gain);
    });
    for (let k = 0; k < points.length - 1; k++) {
      const i = base + k * 2;
      index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
    }
  };
  // Surf along the near side of the islands.
  layers.slice(0, 2).forEach((L, li) => {
    for (const isle of isles[li]) {
      for (let line = 0; line < 2; line++) {
        const r = L.r - 3 - line * (2 + rand() * 3);
        const span = isle.w * (1.4 + rand() * 0.6);
        const points = [];
        for (let k = 0; k <= 30; k++) {
          const a = isle.c - span + (2 * span * k) / 30;
          const rr = r + Math.sin(k * 0.7 + line * 2) * 0.6;
          points.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        ribbon(points, 0.5 + rand() * 0.4, 1 - line * 0.3);
      }
    }
  });
  // Open water: gentle arcs rolling in, kept out of the line of sight (rule 5) and away from
  // the sky behind the board (rule 2).
  for (let n = 0; n < 34; ) {
    const x = (rand() * 2 - 1) * 130;
    const z = -110 + rand() * 260;
    if (Math.abs(x) < 52 && z > -20 && z < 60) continue;
    if (z < -20 && Math.abs(x) < 70) continue;
    if (Math.hypot(x, z) > 125) continue;
    n++;
    const len = 12 + rand() * 28;
    const heading = Math.atan2(z, x) + Math.PI / 2 + (rand() - 0.5) * 0.5; // across the way in
    const bend = (rand() - 0.5) * 0.04;
    const points = [];
    for (let k = 0; k <= 24; k++) {
      const u = (k / 24 - 0.5) * len;
      const along = heading + bend * u;
      points.push([x + Math.cos(along) * u, z + Math.sin(along) * u]);
    }
    ribbon(points, 0.4 + rand() * 0.6, 0.6 + rand() * 0.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aUv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.setAttribute('aInfo', new BufferAttribute(new Float32Array(info), 3));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      attribute vec2 aUv;
      attribute vec3 aInfo; // length, seed, gain
      varying vec2 vUv;
      varying vec3 vInfo;
      void main() {
        vUv = aUv;
        vInfo = aInfo;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      varying vec2 vUv;
      varying vec3 vInfo;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float s = clamp(vUv.x, 0.0, 1.0);
        float hh = clamp(vUv.y, 0.0, 1.0) * 1.8 - 0.8; // -0.8 down in the reflection, 1 at the lip
        float above = smoothstep(0.0, 0.85, hh) * (1.0 - smoothstep(0.85, 1.0, hh)) + (1.0 - smoothstep(0.0, 0.15, abs(hh))) * 0.5;
        float below = smoothstep(-0.8, 0.0, hh) * (1.0 - step(0.0, hh)) * 0.35;
        float across = max(above, below);
        // The break runs along the crest, a bright head with a fading tail.
        float phase = fract(uTime / (6.0 + vInfo.y * 6.0) + vInfo.y * 7.0);
        float head = phase * 1.7 - 0.35;
        float flash = smoothstep(head - 0.4, head, s) * (1.0 - smoothstep(head, head + 0.03, s));
        float glitter = step(0.93, hash(vec2(floor(s * vInfo.x * 3.0), floor(uTime * 7.0 + vInfo.y * 50.0)))) * 0.6;
        float ends = smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.9, s);
        float k = (0.1 + flash * (1.0 + glitter)) * across * ends * vInfo.z * uGlow;
        vec3 col = mix(vec3(0.08, 0.85, 1.0), vec3(0.25, 1.0, 0.7), s) * 1.1;
        gl_FragColor = vec4(col * k, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(geometry, material);
}

// The Milky Way: a faint band, mottled with clouds of stars and split by dark lanes of dust,
// brightening towards its core. A strip of its own just inside the sky dome, so only the
// pixels it covers pay for the detail (rule 6), with its reflection in the water.
function milkyWay(shared) {
  const ALONG = 120;
  const ACROSS = 6;
  const HALF = 0.23; // the band fades out well inside this
  const R = 880;
  const position = [];
  const band = [];
  const index = [];
  for (let i = 0; i <= ALONG; i++) {
    const t = (i / ALONG) * Math.PI;
    for (let j = 0; j <= ACROSS; j++) {
      const s = (j / ACROSS - 0.5) * 2 * HALF;
      const d = [0, 1, 2].map((k) => Math.cos(s) * (Math.cos(t) * (k === 0 ? 1 : 0) + Math.sin(t) * BAND_U[k]) + Math.sin(s) * BAND_N[k]);
      position.push(d[0] * R, WATER_Y + d[1] * R, d[2] * R);
      band.push(t, s, d[1]);
    }
  }
  for (let i = 0; i < ALONG; i++) {
    for (let j = 0; j < ACROSS; j++) {
      const a = i * (ACROSS + 1) + j;
      const b = a + ACROSS + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aBand', new BufferAttribute(new Float32Array(band), 3));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    transparent: true, // drawn after the islands and palms, and hidden behind them by depth
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uGlow: shared.glow },
    vertexShader: /* glsl */ `
      attribute vec3 aBand; // along, across, height of the unreflected point
      attribute float aMirror;
      varying vec3 vBand;
      varying float vMirror;
      void main() {
        vBand = aBand;
        vMirror = aMirror;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      varying vec3 vBand;
      varying float vMirror;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float t = vBand.x;
        float s = vBand.y;
        float n = noise(vec2(t * 18.0, s * 55.0)) * 0.6 + noise(vec2(t * 45.0, s * 120.0)) * 0.4;
        float clouds = smoothstep(0.3, 0.85, n);
        float lane = s - 0.02 * sin(t * 5.0 + 1.0);
        float dust = exp(-lane * lane * 2500.0) * smoothstep(0.25, 0.65, n + 0.15);
        float dt = t - ${CORE_T.toFixed(3)};
        float core = exp(-dt * dt * 14.0);
        float light = exp(-s * s * 90.0) * (0.12 + 0.88 * clouds) * (1.0 - 0.8 * dust) * (1.0 + 1.2 * core);
        vec3 col = mix(vec3(0.045, 0.045, 0.08), vec3(0.12, 0.09, 0.07), core) * light * (0.8 + 0.2 * uGlow);
        col += vec3(1.0, 0.75, 0.5) * exp(-dt * dt * 60.0) * exp(-s * s * 700.0) * (1.0 - 0.7 * dust) * 0.5; // the bright heart
        // Nothing below the horizon; in the water, as dim as the rest of the sky's reflection.
        col *= smoothstep(0.0, 0.015, vBand.z) * mix(1.0, 0.6, vMirror);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(withMirror(geometry), material);
}

// Stars crowding along the Milky Way, finer than the sky's own.
function bandStars(shared) {
  return motes(shared, {
    count: 900,
    seed: 777,
    spot(rand) {
      const t = rand() * Math.PI;
      const g = (rand() + rand() + rand() - 1.5) * 0.12; // bunched towards the middle of the band
      const d = [Math.cos(t), Math.sin(t) * BAND_U[1] - g * Math.cos(TILT), Math.sin(t) * BAND_U[2] + g * Math.sin(TILT)];
      if (d[1] < 0.03) return null;
      const k = 820 / Math.hypot(...d);
      return [d[0] * k, d[1] * k, d[2] * k];
    },
    blink: '0.6 + 0.4 * sin(uTime * (0.6 + aLook.y) + aLook.x * 20.0)',
    color: 'mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.7), aLook.z) * (0.5 + aLook.w)',
    size: [1, 2.2],
    scale: 1100,
    mirror: 0,
  });
}

// The music: a lagoon groove in A major, the brightest and quickest of the places. A marimba
// plays chord tones in threes and twos over a bouncing bass and a light shaker, a whistle
// sings the tune, then steel-pan bells take it; the surf breathes underneath.
// Each chord: pad voicing, bass, and the eight notes of the marimba.
const CHORDS = [
  { pad: [57, 61, 64, 68], bass: 45, mar: [69, 76, 73, 80, 76, 73, 81, 76] }, // Amaj7
  { pad: [54, 57, 61, 64], bass: 42, mar: [66, 73, 69, 76, 73, 69, 78, 73] }, // F#m7
  { pad: [50, 54, 57, 61], bass: 38, mar: [62, 69, 66, 73, 69, 66, 74, 69] }, // Dmaj7
  { pad: [52, 56, 59, 61], bass: 40, mar: [64, 71, 68, 73, 71, 68, 76, 71] }, // E6
  { pad: [57, 61, 64, 69], bass: 45, mar: [69, 76, 73, 81, 76, 73, 81, 76] }, // A
  { pad: [49, 56, 59, 64], bass: 37, mar: [68, 73, 71, 76, 73, 71, 80, 76] }, // C#m7
  { pad: [50, 57, 61, 66], bass: 38, mar: [66, 73, 69, 74, 73, 69, 78, 73] }, // Dmaj7
  { pad: [52, 57, 59, 64], bass: 40, mar: [64, 71, 69, 76, 71, 68, 76, 71] }, // Esus4, E
];
const TUNE = [
  [76, 0, 1.5], [78, 1.5, 0.5], [76, 2, 0.5], [73, 2.5, 1.5],
  [71, 4, 0.5], [73, 4.5, 1], [69, 5.5, 2.5],
  [66, 8, 0.5], [69, 8.5, 0.5], [73, 9, 1], [74, 10, 0.5], [73, 10.5, 1.5],
  [71, 12, 3], [68, 15, 0.5], [71, 15.5, 0.5],
  [73, 16, 1.5], [76, 17.5, 0.5], [81, 18, 1], [80, 19, 0.5], [78, 19.5, 0.5],
  [76, 20, 1.5], [73, 21.5, 0.5], [71, 22, 2],
  [69, 24, 0.5], [71, 24.5, 0.5], [73, 25, 1], [78, 26, 1], [76, 27, 1],
  [76, 28, 1.5], [74, 29.5, 0.5], [71, 30, 1], [68, 31, 1],
];
const ACCENT = [1, 0, 0, 1, 0, 0, 1, 0]; // three, three, two

export const music = {
  bpm: 96,
  beats: 4,
  level: 1.8,
  echo: { beats: 0.75, feedback: 0.3, mix: 0.25, tone: 2600 },
  air: { type: 'lowpass', hz: 650, q: 0.4, gain: 0.02, swell: 0.11, sweep: 250 }, // the surf
  voices({ strike, out, hz }) {
    return {
      // A marimba: a round tone, its bright second partial two octaves up dying almost at
      // once, and the knock of the mallet.
      mallet(n, at, gain = 0.05, { decay = 0.8, send = 0.2 } = {}) {
        const dest = out(send);
        const f = hz(n);
        strike('sine', f, at, gain, decay, dest);
        strike('sine', f * 4, at, gain * 0.28, 0.08, dest);
        strike('sine', f * 10, at, gain * 0.05, 0.02, dest);
      },
    };
  },
  bar(play, i, t) {
    const b = play.beat;
    const chord = CHORDS[i % 8];
    const pass = Math.floor(i / 8) % 4; // 0 sets out, 1 sings, 2 sings in bells, 3 lies back
    const bar = i % 8;
    play.pad(chord.pad, t, play.bar * 0.9, 0.016, { attack: 0.6, release: 1.2, cutoff: 1100 });
    play.bass(chord.bass, t, b * 1.2, 0.07);
    if (pass !== 3) {
      play.bass(chord.bass, t + 1.5 * b, b * 0.8, 0.05);
      play.bass(chord.bass + 7, t + 3 * b, b * 0.7, 0.04);
    }
    for (let k = 0; k < 8; k++) {
      if (pass === 3 && !ACCENT[k]) continue;
      play.mallet(chord.mar[k], t + (k * b) / 2, ACCENT[k] ? 0.055 : 0.035);
    }
    if (pass !== 0 || bar >= 4) for (let k = 0; k < 4; k++) play.shaker(t + (k + 0.5) * b, 0.009);
    if (pass === 2) for (let k = 0; k < 4; k++) play.shaker(t + (k + 0.75) * b, 0.005, 0.04);
    if (pass === 1 || pass === 2) {
      for (const [n, beat, len] of TUNE) {
        if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
        const at = t + (beat - bar * 4) * b;
        if (pass === 1) play.lead(n, at, len * b * 0.9, 0.045, { vibrato: 8 });
        else play.bell(n + 12, at, 0.035, { decay: 1.1, send: 0.35 });
      }
    }
  },
};

export default {
  id: 'lagoon',
  name: 'Glow Lagoon',
  theme: '#070a24',
  music,
  build(shared) {
    const group = new Group();
    const layers = [
      { r: 140, h: 8, seed: 1.9 },
      { r: 200, h: 12, seed: 4.4 },
      { r: 280, h: 16, seed: 8.2 },
    ];
    const land = islands(layers);
    add(group, skyDome(shared, SKY, { below: 0.6 }), -10);
    add(group, milkyWay(shared), -9);
    add(group, stars(shared, { count: 800, seed: 2468, low: 0.08, color: 'vec3(0.9, 0.9, 1.0)', gain: 1.3 }), 1);
    add(group, bandStars(shared), 1);
    add(group, ridges(shared, { sky: SKY, layers, profile: land.profile, shade: ISLE_SHADE, segments: 1600 }), 0);
    add(group, palms(shared, layers, land), 0);
    add(group, water(shared, {
      sky: SKY,
      deep: 'vec3(0.004, 0.006, 0.025)',
      // Plankton glinting cyan; silver where the ripples would mirror the moon.
      shine: 'mix(mix(vec3(0.06, 0.3, 0.38), vec3(0.08, 0.45, 0.5), front), vec3(0.8, 0.8, 0.9), exp((dot(normalize(vec3(-toEye.x, toEye.y, -toEye.z)), MOON_DIR) - 1.0) * 12.0))',
      alpha: [0.6, 0.15],
    }), 3);
    add(group, crests(shared, layers, land), 4);
    return group;
  },
};
