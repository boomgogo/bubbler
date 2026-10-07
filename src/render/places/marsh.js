// Firefly Marsh: still water among reeds on a warm night, a low amber moon behind the player,
// willows on the far shore with mist lying at their feet, and fireflies everywhere.
import { Group, Mesh, BufferGeometry, BufferAttribute, ShaderMaterial, DoubleSide } from 'three';
import { WATER_Y } from '../layout.js';
import { OUT, seeded, add, skyDome, stars, ridges, water } from './kit.js';
import { motes, withMirror } from './parts.js';

// Low behind the player and to the right: the bubbles' fronts all catch it.
const MOON_DIR = [0.3, 0.155, 0.94];
const SKY = /* glsl */ `
const float WATER = ${WATER_Y.toFixed(3)};
const vec3 MOON_DIR = normalize(vec3(${MOON_DIR.join(', ')}));
float lakeFront(vec3 d) { return smoothstep(0.6, -0.9, d.z); }
vec3 skyColor(vec3 d, float glow) {
  float h = d.y;
  float front = lakeFront(d);
  float m = dot(d, MOON_DIR);
  // Deep green-black overhead; a little olive behind, where the moon warms the air.
  vec3 zenith = vec3(0.002, 0.008, 0.011);
  vec3 low = mix(vec3(0.05, 0.06, 0.04), vec3(0.012, 0.045, 0.045), front);
  vec3 col = mix(low, zenith, smoothstep(0.0, 0.3, h));
  // Mist lying on the marsh: a pale band on the horizon all round, warmer towards the moon.
  float mist = exp(-h * 30.0);
  col += vec3(0.05, 0.09, 0.07) * mist * (0.8 + 0.2 * glow);
  col += vec3(0.3, 0.18, 0.05) * mist * exp((m - 1.0) * 3.0);
  // The moon: a big low amber disc in a wide warm haze.
  col += vec3(0.45, 0.22, 0.06) * exp((m - 1.0) * 14.0) * 0.35;
  col += vec3(1.0, 0.55, 0.18) * exp((m - 1.0) * 160.0) * 0.6;
  col += vec3(1.0, 0.64, 0.32) * smoothstep(0.99925, 0.99945, m) * 5.0;
  return col;
}`;

// Willows and alders on the far shores, a few poplars standing above them, and gaps of open
// marsh between. Each crown is a cluster of round lobes, which is what reads as leaves at a
// distance. Returns the profile for kit.ridges.
function treeline(layers) {
  const rand = seeded(5150);
  const trees = layers.map(({ r, h }) => {
    const list = [];
    for (let a = 0; a < Math.PI * 2; ) {
      const poplar = rand() < 0.07;
      const R = h * (poplar ? 0.06 + rand() * 0.03 : 0.18 + rand() * 0.17); // crown radius
      const top = h * (poplar ? 0.85 + rand() * 0.15 : 0.45 + rand() * 0.5);
      const lobes = [];
      if (poplar) lobes.push({ x: 0, y: top - R * 3.5, sx: R, sy: R * 3.5 });
      else {
        // Leafy lumps along a domed top, over a skirt that slopes out below.
        const n = 5 + Math.floor(rand() * 4);
        for (let i = 0; i < n; i++) {
          const x = ((i + rand()) / n - 0.5) * 1.7 * R;
          const rho = R * (0.28 + rand() * 0.22);
          const y = top - R + Math.sqrt(Math.max(0, R * R - x * x)) - rho * (0.7 + rand() * 0.5);
          lobes.push({ x, y, sx: rho, sy: rho });
        }
        lobes.push({ x: 0, y: top - R * 1.7, sx: R * 1.2, sy: R * 0.8 });
      }
      const c = a + R / r;
      list.push({ c, reach: (R * 1.25) / r, lobes });
      // Crowns overlap into one canopy, broken now and then by open marsh.
      a = c + (R * (rand() * 0.8 - 0.4)) / r + (rand() < 0.05 ? 0.03 + rand() * 0.08 : 0);
    }
    // Copies a turn either side, so the trees round the seam are found from both ends.
    const all = [...list.map((t) => ({ ...t, c: t.c - Math.PI * 2 })), ...list, ...list.map((t) => ({ ...t, c: t.c + Math.PI * 2 }))];
    return { all, reach: Math.max(...list.map((t) => t.reach)) };
  });
  return (ridge, a, layer) => {
    const { r, h } = layers[layer];
    const { all: list, reach } = trees[layer];
    // The first tree that could reach this far round, then every one until they are past it.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].c < a - reach) lo = mid + 1;
      else hi = mid;
    }
    let y = h * (0.03 + 0.05 * ridge); // scrub between the trees
    for (let i = lo; i < list.length && list[i].c <= a + reach; i++) {
      const tree = list[i];
      const d = a - tree.c;
      if (Math.abs(d) > tree.reach) continue;
      for (const lobe of tree.lobes) {
        const x = (d * r - lobe.x) / lobe.sx;
        if (x * x < 1) y = Math.max(y, lobe.y + lobe.sy * Math.sqrt(1 - x * x));
      }
    }
    return y / h;
  };
}

// The mist's colour along the horizon: the sky just above it, without the parts too high or
// too sharp to matter (cheaper than skyColor, and it runs on every tree and reed).
const MIST = /* glsl */ `
vec3 mistColor(vec3 dir, float glow) {
  float m = dot(dir, MOON_DIR);
  vec3 col = mix(vec3(0.05, 0.06, 0.04), vec3(0.012, 0.045, 0.045), lakeFront(dir));
  col += vec3(0.032, 0.058, 0.045) * (0.8 + 0.2 * glow);
  return col + vec3(0.19, 0.115, 0.032) * exp((m - 1.0) * 3.0) + vec3(0.16, 0.08, 0.02) * exp((m - 1.0) * 14.0);
}`;

// Silhouettes going grey-green into the mist at their feet and with distance.
const TREE_SHADE = /* glsl */ `
  vec3 dir = normalize(vDir);
  float depth = vLayer * 0.5;
  float hgt = abs(vHeight);
  vec3 fog = mistColor(dir, uGlow);
  col = mix(vec3(0.004, 0.01, 0.007), fog, 0.1 + 0.4 * depth);
  col = mix(col, fog, (1.0 - smoothstep(0.0, 0.5, hgt)) * (0.55 + 0.3 * depth));
  if (vHeight < 0.0) col *= 0.6;
  col *= 0.85 + 0.15 * uGlow;`;

// Reeds in clumps round the water, a few with cattail heads. Each blade stands on the waterline
// and is drawn together with its reflection; they lean in a slow breeze.
function reeds(shared) {
  const rand = seeded(808);
  const position = [];
  const info = [];
  const index = [];
  for (let clumps = 0; clumps < 90; ) {
    const a = rand() * Math.PI * 2;
    const r = 30 + 105 * rand();
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    // Out of the line of sight (rule 5), and few and short behind the board (rule 2).
    if (Math.abs(cx) < 50 && cz > -17 && cz < 57) continue;
    const ahead = cz < -17 && Math.abs(cx) < 80;
    if (ahead && rand() < 0.75) continue;
    clumps++;
    const blades = 7 + Math.floor(rand() * 11);
    for (let b = 0; b < blades; b++) {
      const bx = cx + (rand() - 0.5) * 4;
      const bz = cz + (rand() - 0.5) * 4;
      const len = Math.hypot(bx, bz);
      const tx = -bz / len; // across the blade: square on to the middle of the lake
      const tz = bx / len;
      const tall = ahead ? 1.2 + rand() * 1.4 : 2.2 + rand() * 4.8;
      const lean = (rand() - 0.5) * 0.7;
      const w = 0.07 + rand() * 0.08;
      const phase = rand() * 6.28;
      // [height fraction, half width]: a tapering blade, or a stem with a cattail head.
      const shape = rand() < 0.16
        ? [[0, w * 0.6], [0.55, w * 0.45], [0.6, 0.15], [0.84, 0.15], [0.87, w * 0.25], [1, 0.01]]
        : [[0, w], [0.3, w * 0.8], [0.6, w * 0.55], [0.85, w * 0.3], [1, 0.005]];
      const base = position.length / 3;
      for (const [t, half] of shape) {
        const off = lean * t * t * tall;
        const x = bx + tx * off;
        const z = bz + tz * off;
        const y = WATER_Y + t * tall;
        position.push(x - tx * half, y, z - tz * half, x + tx * half, y, z + tz * half);
        info.push(t, phase, tall, t, phase, tall);
      }
      for (let s = 0; s < shape.length - 1; s++) {
        const i = base + s * 2;
        index.push(i, i + 1, i + 2, i + 2, i + 1, i + 3);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geometry.setAttribute('aInfo', new BufferAttribute(new Float32Array(info), 3));
  geometry.setIndex(index);
  const material = new ShaderMaterial({
    side: DoubleSide,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      attribute vec3 aInfo; // height fraction, sway phase, height
      attribute float aMirror;
      uniform float uTime;
      varying vec3 vWorld;
      varying float vMirror;
      void main() {
        vec3 p = position;
        float t = aInfo.x;
        float sway = (sin(uTime * 0.8 + aInfo.y) * 0.16 + sin(uTime * 2.3 + aInfo.y * 3.0) * 0.04) * t * t * aInfo.z * 0.25;
        p.x += sway;
        p.z += sway * 0.6;
        if (aMirror > 0.5) p.x += sin(uTime * 2.3 + p.y * 3.0 + aInfo.y) * 0.06 * t;
        vWorld = p;
        vMirror = aMirror;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      ${SKY}
      ${MIST}
      varying vec3 vWorld;
      varying float vMirror;
      void main() {
        vec3 fog = mistColor(normalize(vec3(vWorld.x, 0.0, vWorld.z)), uGlow);
        float hgt = abs(vWorld.y - WATER);
        float dist = length(vWorld.xz);
        // Black blades, sinking into the mist near the water and far away.
        float k = (1.0 - smoothstep(0.0, 1.2, hgt)) * 0.3 + smoothstep(40.0, 150.0, dist) * 0.35;
        vec3 col = mix(vec3(0.003, 0.008, 0.005), fog, k);
        col *= mix(1.0, 0.6, vMirror);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(withMirror(geometry), material);
}

// Fireflies: a few hundred over the water and among the reeds, each blinking on its own clock.
// Fewer behind the board, more behind the player, where the glass catches them.
function fireflies(shared) {
  return motes(shared, {
    count: 1400,
    seed: 3141,
    spot(rand) {
      const a = rand() * Math.PI * 2;
      const r = 14 + 120 * Math.pow(rand(), 1.15);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < 48 && z > -15 && z < 55) return null; // they wander up to 2.7 either way
      if (z < -15 && rand() < 0.35) return null;
      return [x, 0.3 + 8 * rand() * rand(), z];
    },
    motion: /* glsl */ `
      float ph = aLook.x * 6.2832;
      p += vec3(
        sin(uTime * (0.11 + aLook.y * 0.12) + ph) * 2.2 + sin(uTime * 0.37 + ph * 3.0) * 0.5,
        sin(uTime * (0.19 + aLook.z * 0.1) + ph * 2.0) * 0.6,
        cos(uTime * (0.09 + aLook.w * 0.12) + ph) * 2.2 + cos(uTime * 0.29 + ph * 5.0) * 0.5);
      p.y = max(p.y, 0.15);`,
    // A quick flash and a slower fade, then dark: lit about a fifth of the time.
    blink: /* glsl */ `smoothstep(0.0, 0.025, fract(uTime / (2.2 + aLook.w * 3.0) + aLook.x))
      * (1.0 - smoothstep(0.03, 0.22, fract(uTime / (2.2 + aLook.w * 3.0) + aLook.x)))`,
    color: 'mix(vec3(1.5, 2.6, 0.45), vec3(2.6, 1.8, 0.45), step(0.85, aLook.y))',
    size: [2.5, 12],
    scale: 260,
    mirror: 0.45,
  });
}

// The music: a lullaby among the reeds, G major in three at an easy sway. A kalimba rocks
// through the chords, low plucks keep the waltz, an ocarina sings the tune and the kalimba
// sings it back; crickets fill the gaps and a frog has its say.
// Each chord: pad voicing, bass, the six eighth notes of the kalimba, and the two waltz notes.
const CHORDS = [
  { pad: [55, 59, 62, 66], bass: 43, arp: [67, 71, 74, 78, 74, 71], oom: [59, 62] }, // Gmaj7
  { pad: [52, 55, 59, 62], bass: 40, arp: [64, 71, 74, 79, 74, 71], oom: [55, 59] }, // Em7
  { pad: [48, 55, 59, 64], bass: 36, arp: [60, 67, 71, 76, 71, 67], oom: [55, 59] }, // Cmaj7
  { pad: [50, 54, 57, 59], bass: 38, arp: [62, 66, 69, 71, 69, 66], oom: [54, 57] }, // D6
  { pad: [47, 54, 57, 62], bass: 35, arp: [62, 66, 69, 74, 69, 66], oom: [54, 57] }, // Bm7
  { pad: [52, 55, 59, 62], bass: 40, arp: [64, 67, 71, 74, 71, 67], oom: [55, 59] }, // Em7
  { pad: [48, 55, 57, 64], bass: 45, arp: [60, 64, 67, 72, 67, 64], oom: [55, 60] }, // Am7
  { pad: [50, 55, 57, 62], bass: 38, arp: [62, 67, 69, 74, 66, 69], oom: [54, 57] }, // Dsus4, D
];
// The tune, over the eight bars: [note, beat, length in beats].
const TUNE = [
  [74, 0, 2], [71, 2, 1],
  [76, 3, 1.5], [74, 4.5, 0.5], [71, 5, 1],
  [71, 6, 1], [72, 7, 1], [76, 8, 1],
  [74, 9, 3],
  [78, 12, 1.5], [76, 13.5, 0.5], [74, 14, 1],
  [79, 15, 2], [76, 17, 1],
  [72, 18, 1], [71, 19, 1], [69, 20, 1],
  [69, 21, 1.5], [66, 22.5, 0.5], [67, 23, 1],
];

export const music = {
  bpm: 88,
  beats: 3,
  level: 1.6,
  echo: { beats: 1, feedback: 0.25, mix: 0.24, tone: 1800 },
  air: { type: 'lowpass', hz: 300, q: 0.5, gain: 0.006, swell: 0.05 }, // a still night
  voices({ ctx, out, strike, hz }) {
    return {
      // A cricket: a few quick pulses on a very high D.
      chirp(at, gain = 0.008) {
        const dest = out(0.3);
        const pulses = 3 + Math.floor(Math.random() * 2);
        for (let k = 0; k < pulses; k++) strike('sine', hz(110), at + k * 0.028, gain, 0.022, dest);
      },
      // A frog: two soft falling bloops from somewhere out in the reeds.
      croak(at, gain = 0.05) {
        const dest = out(0.4);
        for (const [dt, from] of [[0, 190], [0.2, 170]]) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(from, at + dt);
          osc.frequency.exponentialRampToValueAtTime(from * 0.62, at + dt + 0.13);
          g.gain.setValueAtTime(0.0001, at + dt);
          g.gain.exponentialRampToValueAtTime(gain, at + dt + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dt + 0.16);
          osc.connect(g).connect(dest);
          osc.start(at + dt);
          osc.stop(at + dt + 0.2);
        }
      },
    };
  },
  bar(play, i, t) {
    const b = play.beat;
    const chord = CHORDS[i % 8];
    const pass = Math.floor(i / 8) % 4; // 0 sets out, 1 sings, 2 answers on the kalimba, 3 rests
    const bar = i % 8;
    play.pad(chord.pad, t, play.bar * 0.95, 0.02, { attack: 0.9, release: 1.6, cutoff: 800 });
    play.bass(chord.bass, t, b * 2.4, 0.07);
    // The waltz: low plucks on two and three.
    if (pass === 1 || pass === 2 || (pass === 0 && bar >= 4)) {
      play.pluck(chord.oom[0], t + b, 0.03, { decay: 0.6, send: 0.05 });
      play.pluck(chord.oom[1], t + 2 * b, 0.026, { decay: 0.6, send: 0.05 });
    }
    // The kalimba's rocking eighths, thinner while it sets out and while it rests.
    for (let k = 0; k < 6; k++) {
      if ((pass === 0 && k % 2) || (pass === 3 && Math.random() < 0.45)) continue;
      play.pluck(chord.arp[k], t + (k * b) / 2, k === 0 ? 0.05 : 0.036, { decay: 1.4, send: 0.3 });
    }
    if (pass === 1 || pass === 2) {
      for (const [n, beat, len] of TUNE) {
        if (beat < bar * 3 || beat >= bar * 3 + 3) continue;
        const at = t + (beat - bar * 3) * b;
        if (pass === 1) play.lead(n, at, len * b * 0.95, 0.05, { vibrato: 4 });
        else play.pluck(n + 12, at, 0.045, { decay: 1.8, send: 0.4 });
      }
    }
    // Night sounds, more of them when the music thins out.
    const chirps = pass === 3 ? 3 : pass === 0 ? 2 : 1;
    for (let k = 0; k < chirps; k++) if (Math.random() < 0.7) play.chirp(t + (Math.floor(Math.random() * 6) + 0.5) * b / 2);
    if (bar === 3 && Math.random() < 0.5) play.croak(t + 2 * b);
  },
};

export default {
  id: 'marsh',
  name: 'Firefly Marsh',
  theme: '#04110e',
  music,
  build(shared) {
    const group = new Group();
    add(group, skyDome(shared, SKY, { below: 0.65 }), -10);
    add(group, stars(shared, { count: 550, seed: 6060, low: 0.15, color: 'vec3(0.8, 0.95, 0.85)', gain: 1.0 }), 1);
    const layers = [
      { r: 120, h: 7, seed: 3.3 },
      { r: 175, h: 9, seed: 6.1 },
      { r: 250, h: 12, seed: 7.7 },
    ];
    add(group, ridges(shared, { sky: SKY + MIST, layers, profile: treeline(layers), shade: TREE_SHADE, segments: 3000 }), 0);
    add(group, reeds(shared), 1);
    add(group, water(shared, {
      sky: SKY,
      deep: 'vec3(0.003, 0.011, 0.008)',
      // Amber where the ripples would mirror the moon, green-grey elsewhere.
      shine: 'mix(vec3(0.07, 0.2, 0.15), vec3(0.9, 0.5, 0.16), exp((dot(normalize(vec3(-toEye.x, toEye.y, -toEye.z)), MOON_DIR) - 1.0) * 5.0))',
      alpha: [0.55, 0.12],
    }), 3);
    add(group, fireflies(shared), 4);
    return group;
  },
};
