// Neon Harbour: a city harbour at night. Towers crowd the quays behind and beside the player,
// their windows lit, neon signs on their faces and red lights blinking on their roofs, and
// all of it streaked across the black water. Ahead, past the harbour mouth, only a low and
// distant skyline, so the sky behind the board stays calm.
import {
  Group, Mesh, BoxGeometry, PlaneGeometry, InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial,
  AdditiveBlending, DoubleSide,
} from 'three';
import { WATER_Y } from '../layout.js';
import { OUT, seeded, add, skyDome, stars, ridges, water } from './kit.js';
import { motes, mirrorInstances } from './parts.js';

const SKY = /* glsl */ `
const float WATER = ${WATER_Y.toFixed(3)};
float lakeFront(vec3 d) { return smoothstep(0.6, -0.9, d.z); }
vec3 skyColor(vec3 d, float glow) {
  float h = d.y;
  float front = lakeFront(d);
  vec3 zenith = vec3(0.005, 0.003, 0.018);
  vec3 low = mix(vec3(0.08, 0.025, 0.09), vec3(0.025, 0.018, 0.06), front);
  vec3 col = mix(low, zenith, smoothstep(0.0, 0.35, h));
  // The city's light on the haze: pink to amber round the horizon, climbing higher behind
  // the player, and low and dim over the open water ahead.
  vec3 haze = mix(vec3(0.55, 0.1, 0.38), vec3(0.6, 0.3, 0.1), smoothstep(0.65, 0.95, 0.5 + 0.5 * d.x));
  col += haze * exp(-h * mix(8.0, 24.0, front)) * mix(0.55, 0.1, front) * (0.8 + 0.2 * glow);
  // A deck of low cloud behind, lit from underneath.
  float deck = smoothstep(0.12, 0.2, h) * smoothstep(0.42, 0.26, h) * (1.0 - front);
  col += haze * deck * (0.6 + 0.4 * sin(d.x * 13.0 + h * 25.0) * sin(d.z * 7.0 + 1.0)) * 0.12;
  return col;
}`;

// Where the towers stand: round the quays behind and beside the player, none ahead, where the
// harbour opens to the bay. Out of the line of sight and the fly-over's airspace (rule 5).
function plan() {
  const rand = seeded(9090);
  const list = [];
  for (let tries = 0; list.length < 230 && tries < 20000; tries++) {
    const a = rand() * Math.PI * 2;
    const r = 70 + Math.pow(rand(), 0.8) * 190;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const w = 5 + rand() * 9;
    const d = 5 + rand() * 9;
    if (Math.abs(x) < 45 + w && z > -12 - d && z < 52 + d) continue;
    if (z < -12 && Math.abs(x) < 130) continue;
    if (list.some((b) => Math.abs(b.x - x) < (b.w + w) * 0.5 && Math.abs(b.z - z) < (b.d + d) * 0.5)) continue;
    const tall = 10 + Math.pow(rand(), 1.8) * (r > 150 ? 75 : 50);
    list.push({ x, z, w, d, tall, seed: rand(), lit: 0.25 + rand() * 0.35, cool: rand() });
  }
  return list;
}

// The towers, and their reflections streaming down into the water, as one instanced mesh.
// Windows come from a grid hashed per building; far off they melt into an even glow, so the
// grid never shimmers.
function skyline(shared, towers) {
  const base = new BoxGeometry(1, 1, 1);
  base.translate(0, 0.5, 0);
  const geometry = new InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.attributes.position);
  geometry.setAttribute('normal', base.attributes.normal);
  geometry.setAttribute('aBox', new InstancedBufferAttribute(new Float32Array(towers.flatMap((b) => [b.x, b.z, b.w, b.d])), 4));
  geometry.setAttribute('aLook', new InstancedBufferAttribute(new Float32Array(towers.flatMap((b) => [b.tall, b.seed, b.lit, b.cool])), 4));
  geometry.instanceCount = towers.length;
  mirrorInstances(geometry);
  const material = new ShaderMaterial({
    side: DoubleSide, // the reflections are turned inside out
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      const float WATER = ${WATER_Y.toFixed(3)};
      attribute vec4 aBox; // x, z, width, depth
      attribute vec4 aLook; // height, seed, share of windows lit, share of cool light
      attribute float aMirror;
      varying vec3 vLocal;
      varying vec3 vN;
      varying vec4 vLook;
      varying float vMirror;
      void main() {
        vec3 local = position * vec3(aBox.z, aLook.x, aBox.w);
        vLocal = local + vec3(aBox.z, 0.0, aBox.w) * 0.5;
        vN = normal;
        vLook = aLook;
        vMirror = aMirror;
        float y = aMirror > 0.5 ? -local.y : local.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(aBox.x + local.x, WATER + y, aBox.y + local.z, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vLocal;
      varying vec3 vN;
      varying vec4 vLook;
      varying float vMirror;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 col = vec3(0.012, 0.008, 0.022);
        if (abs(vN.y) < 0.5) {
          bool side = abs(vN.x) > 0.5;
          float across = side ? vLocal.z : vLocal.x;
          float up = vLocal.y;
          vec2 face = vec2(vLook.y * 91.0, (side ? 17.0 : 0.0) + sign(vN.x + vN.z) * 5.0);
          vec2 cell = vec2(across / 1.1, up / 1.4);
          float light;
          vec2 id;
          if (vMirror < 0.5) {
            id = floor(cell);
            vec2 f = fract(cell);
            float r = hash(id + face);
            float lit = step(1.0 - vLook.z, r);
            lit = abs(lit - step(0.985, hash(id + face + floor(uTime / 30.0 + r * 9.0)))); // now and then one switches
            light = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78) * lit;
          } else {
            // In the water a column of windows smears into a streak, broken up by the ripples.
            cell.y /= 6.0;
            id = floor(cell);
            float lit = step(1.0 - vLook.z * 1.4, hash(id + face));
            float fx = fract(cell.x);
            float ripple = 0.5 + 0.5 * sin(up * 4.0 - uTime * 2.0 + across * 0.7);
            light = smoothstep(0.1, 0.35, fx) * smoothstep(0.9, 0.65, fx) * lit * ripple;
          }
          // Far away the windows melt into an even glow, so they never shimmer.
          vec2 fw = fwidth(cell);
          light = mix(light, 0.34 * vLook.z, smoothstep(0.25, 0.7, max(fw.x, fw.y)));
          vec3 tint = mix(vec3(1.0, 0.6, 0.28), vec3(0.55, 0.75, 1.0), step(hash(id.yx + face), vLook.w * 0.6));
          col += tint * light * 1.5 * (0.85 + 0.15 * uGlow);
          // Shopfronts glow along the quay.
          col += vec3(0.5, 0.2, 0.35) * (1.0 - smoothstep(0.0, 2.5, up)) * 0.25;
        }
        if (vMirror > 0.5) col *= 0.45 / (1.0 + vLocal.y * 0.03);
        gl_FragColor = vec4(col, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(geometry, material);
}

// The rest of the city, far off all round: a ring of blocky skyline with tiny lit windows, low
// across the bay ahead so the sky behind the board stays calm. Returns the profile.
function farCity() {
  const rand = seeded(6161);
  const layers = [0, 1].map(() => {
    const blocks = [];
    for (let a = 0; a < Math.PI * 2; ) {
      const w = 0.008 + rand() * 0.03;
      blocks.push({ to: a + w, h: rand() < 0.1 ? 0.75 + rand() * 0.25 : 0.15 + rand() * 0.5 });
      a += w;
    }
    return blocks;
  });
  return (ridge, a, layer) => {
    const ahead = Math.abs(((a - Math.PI * 1.5 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const block = layers[layer].find((b) => b.to > a) ?? layers[layer][0];
    return block.h * (0.2 + 0.8 * Math.min(1, Math.max(0, (ahead - 0.35) / 0.5)));
  };
}

const FAR_SHADE = /* glsl */ `
  float up = abs(vWorld.y - WATER);
  float across = atan(vDir.z, vDir.x) * length(vDir.xz);
  vec3 haze = skyColor(normalize(vec3(vDir.x, 0.03, vDir.z)), uGlow);
  col = mix(vec3(0.01, 0.006, 0.02), haze, 0.25 + 0.25 * vLayer);
  vec2 cell = vec2(across / 0.9, up / (vHeight < 0.0 ? 6.0 : 1.1));
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  float lit = step(0.8, fract(sin(dot(id + vLayer * 7.0, vec2(127.1, 311.7))) * 43758.5453));
  float light = vHeight < 0.0 ? smoothstep(0.1, 0.4, f.x) * smoothstep(0.9, 0.6, f.x) * lit * 0.5 : step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75) * lit;
  vec2 fw = fwidth(cell);
  light = mix(light, 0.07, smoothstep(0.25, 0.7, max(fw.x, fw.y)));
  col += mix(vec3(1.0, 0.6, 0.3), vec3(0.6, 0.75, 1.0), step(0.7, fract(id.x * 0.37 + id.y * 0.11))) * light * (1.0 - 0.4 * vLayer);
  if (vHeight < 0.0) col *= 0.5;`;

// Neon on the faces of the towers that look over the water: bars along their tops and strips
// down their corners, pink, cyan, violet and amber, bright enough for the glass to catch.
// Their reflections are long wavering streaks. A few buzz and stutter.
const NEON = [[3.2, 0.35, 1.7], [0.35, 2.4, 3.2], [1.7, 0.5, 3.2], [3.2, 1.4, 0.3]];
function neon(shared, towers) {
  const rand = seeded(3737);
  const signs = [];
  for (const b of towers) {
    if (b.tall < 18 || rand() < 0.65) continue;
    // The face that looks towards the middle of the harbour.
    const xFace = Math.abs(b.x) * b.d > Math.abs(b.z) * b.w;
    const nx = xFace ? -Math.sign(b.x) : 0;
    const nz = xFace ? 0 : -Math.sign(b.z);
    const span = xFace ? b.d : b.w;
    const cx = b.x + nx * (b.w / 2 + 0.2);
    const cz = b.z + nz * (b.d / 2 + 0.2);
    const color = NEON[Math.floor(rand() * NEON.length)];
    const flicker = rand() < 0.15 ? 1 : 0;
    if (rand() < 0.55) {
      // A bar near the top.
      const w = span * (0.4 + rand() * 0.4);
      signs.push([cx, b.tall * (0.82 + rand() * 0.12), cz, -nz, nx, w, 0.45, ...color, flicker, rand()]);
    } else {
      // A strip down one side of the face.
      const h = b.tall * (0.25 + rand() * 0.3);
      const off = (rand() < 0.5 ? -1 : 1) * span * 0.35;
      signs.push([cx - nz * off, b.tall * 0.55 + (rand() - 0.5) * 4, cz + nx * off, -nz, nx, 0.55, h, ...color, flicker, rand()]);
    }
  }
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  const attr = (from, size) => new InstancedBufferAttribute(new Float32Array(signs.flatMap((s) => s.slice(from, from + size))), size);
  geometry.setAttribute('aSpot', attr(0, 3)); // x, height above the water, z
  geometry.setAttribute('aAlong', attr(3, 2)); // the face's direction, x and z
  geometry.setAttribute('aSize', attr(5, 2));
  geometry.setAttribute('aColor', attr(7, 3));
  geometry.setAttribute('aBuzz', attr(10, 2)); // flickers, seed
  geometry.instanceCount = signs.length;
  mirrorInstances(geometry);
  const PAD = 1.2; // room round the tube for its glow
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: shared.time, uGlow: shared.glow },
    vertexShader: /* glsl */ `
      const float WATER = ${WATER_Y.toFixed(3)};
      attribute vec3 aSpot;
      attribute vec2 aAlong;
      attribute vec2 aSize;
      attribute vec3 aColor;
      attribute vec2 aBuzz;
      attribute float aMirror;
      uniform float uTime;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying vec3 vColor;
      varying float vMirror;
      varying float vDepth;
      void main() {
        vec2 full = aSize + ${(2 * PAD).toFixed(2)};
        vLocal = position.xy * full;
        vHalf = aSize * 0.5;
        float on = 0.92 + 0.08 * sin(uTime * 47.0 + aBuzz.y * 60.0);
        if (aBuzz.x > 0.5) on *= step(0.3, fract(sin(floor(uTime * 9.0 + aBuzz.y * 40.0)) * 437.585));
        vColor = aColor * on;
        vMirror = aMirror;
        vec3 along = vec3(aAlong.x, 0.0, aAlong.y);
        vec3 p = vec3(aSpot.x, 0.0, aSpot.z) + along * vLocal.x;
        float y = aSpot.y + vLocal.y;
        if (aMirror > 0.5) {
          // Upside down, drawn out and wavering with the swell.
          y = -(aSpot.y + vLocal.y * 1.8);
          p += along * sin(uTime * 1.9 + y * 0.9 + aBuzz.y * 9.0) * 0.35;
        }
        vDepth = max(-y, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, WATER + y, p.z, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying vec3 vColor;
      varying float vMirror;
      varying float vDepth;
      void main() {
        // Distance outside the tube's rectangle: a bright core and a soft glow round it.
        vec2 q = abs(vLocal) - vHalf;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float k = smoothstep(0.1, -0.05, d) + exp(-max(d, 0.0) * 2.8) * 0.35;
        k *= smoothstep(${PAD.toFixed(2)}, ${(PAD * 0.6).toFixed(2)}, max(q.x, q.y)); // nothing at the quad's edge
        if (vMirror > 0.5) k *= 0.45 / (1.0 + vDepth * 0.06);
        gl_FragColor = vec4(vColor * k * uGlow, 1.0);
        ${OUT}
      }`,
  });
  return new Mesh(geometry, material);
}

// Red lights on the tallest roofs, blinking together in three groups.
function towerLights(shared, towers) {
  const tops = [...towers].sort((a, b) => b.tall - a.tall).slice(0, 15);
  let next = 0;
  return motes(shared, {
    count: tops.length,
    seed: 5,
    spot: () => {
      const b = tops[next++];
      return [b.x, b.tall + 0.7, b.z];
    },
    blink: /* glsl */ `smoothstep(0.0, 0.06, fract(uTime * 0.6 + floor(aLook.x * 3.0) / 3.0))
      * (1.0 - smoothstep(0.45, 0.55, fract(uTime * 0.6 + floor(aLook.x * 3.0) / 3.0)))`,
    color: 'vec3(3.2, 0.18, 0.08)',
    size: [2, 6],
    scale: 300,
    mirror: 0.5,
  });
}

// The music: gentle synthwave in B minor. A pulsing bass under a slow pad, a soft square
// arpeggio echoing in dotted eighths, a quiet kick and snare, and a synth that sings the tune.
// Each chord: pad voicing, bass, and the eight notes of the arpeggio.
const CHORDS = [
  { pad: [47, 54, 59, 62], bass: 35, arp: [59, 66, 71, 74, 78, 74, 71, 66] }, // Bm
  { pad: [43, 50, 59, 62], bass: 31, arp: [55, 62, 67, 71, 74, 71, 67, 62] }, // G
  { pad: [50, 57, 62, 66], bass: 38, arp: [62, 69, 74, 78, 81, 78, 74, 69] }, // D
  { pad: [45, 52, 57, 61], bass: 33, arp: [57, 64, 69, 73, 76, 73, 69, 64] }, // A
  { pad: [52, 55, 59, 64], bass: 40, arp: [64, 67, 71, 76, 79, 76, 71, 67] }, // Em
  { pad: [43, 50, 59, 62], bass: 31, arp: [55, 62, 67, 71, 74, 71, 67, 62] }, // G
  { pad: [50, 57, 62, 66], bass: 38, arp: [62, 69, 74, 78, 81, 78, 74, 69] }, // D
  { pad: [45, 52, 57, 61], bass: 33, arp: [57, 64, 69, 73, 76, 73, 69, 64] }, // A
];
const TUNE = [
  [74, 0, 1.5], [73, 1.5, 0.5], [71, 2, 2],
  [67, 4, 1], [71, 5, 1], [74, 6, 1.5], [76, 7.5, 0.5],
  [78, 8, 3], [76, 11, 0.5], [74, 11.5, 0.5],
  [73, 12, 2], [69, 14, 1], [71, 15, 1],
  [71, 16, 1.5], [74, 17.5, 0.5], [76, 18, 2],
  [79, 20, 1], [78, 21, 1], [76, 22, 1], [74, 23, 1],
  [74, 24, 1.5], [76, 25.5, 0.5], [78, 26, 2],
  [76, 28, 2], [73, 30, 1], [69, 31, 1],
];

export const music = {
  bpm: 84,
  beats: 4,
  level: 1.9,
  echo: { beats: 0.75, feedback: 0.38, mix: 0.3, tone: 2200 },
  air: null,
  voices({ ctx, out, strike, hold, noise, hz }) {
    return {
      // An analogue-style voice: detuned saws or a square through a lowpass that opens on
      // each note and closes again.
      synth(n, at, dur, gain = 0.03, { type = 'sawtooth', cutoff = 900, open = 2.5, q = 2, detune = 8, send = 0.2, attack = 0.01, release = 0.15 } = {}) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = q;
        filter.frequency.setValueAtTime(cutoff * open, at);
        filter.frequency.exponentialRampToValueAtTime(cutoff, at + Math.min(dur, 0.25) + 0.01);
        const env = out(send);
        filter.connect(env);
        const end = hold(env, at, dur, gain, attack, release);
        for (const cents of detune ? [-detune, detune] : [0]) {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = hz(n);
          osc.detune.value = cents;
          osc.connect(filter);
          osc.start(at);
          osc.stop(end);
        }
      },
      // A soft kick: a sine dropping fast from a thump to a low hum.
      kick(at, gain = 0.1) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(120, at);
        osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
        osc.connect(g).connect(out(0));
        osc.start(at);
        osc.stop(at + 0.35);
      },
      // A soft snare: a burst of band-passed noise over a short tone.
      snare(at, gain = 0.03) {
        const dest = out(0.25);
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1800;
        filter.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain, at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        src.connect(filter).connect(g).connect(dest);
        src.start(at, Math.random() * 0.5);
        src.stop(at + 0.2);
        strike('sine', 190, at, gain * 0.5, 0.08, dest);
      },
    };
  },
  bar(play, i, t) {
    const b = play.beat;
    const chord = CHORDS[i % 8];
    const pass = Math.floor(i / 8) % 4; // 0 builds, 1 sings, 2 the arpeggio leads, 3 breaks down
    const bar = i % 8;
    play.pad(chord.pad, t, play.bar * 0.95, 0.018, { attack: 1.5, release: 2, cutoff: 1200 });
    // The pulse: eighth notes on the root and its octave, the filter opening over each phrase.
    const open = (bar % 4) / 3;
    for (let k = 0; k < 8; k++) {
      if (pass === 3 && k % 2) continue;
      play.synth(chord.bass + (k % 2 ? 12 : 0), t + (k * b) / 2, b * 0.4, 0.04, { cutoff: 260 + 420 * open, open: 2.2, q: 3, detune: 5, send: 0 });
    }
    const drums = pass === 1 || pass === 2 || (pass === 0 && bar >= 4);
    if (drums) {
      play.kick(t);
      play.kick(t + 2 * b);
      if (pass !== 0 || bar >= 6) {
        play.snare(t + b);
        play.snare(t + 3 * b);
      }
    }
    if (pass !== 0) {
      for (let k = 0; k < 16; k++) {
        play.synth(chord.arp[k % 8], t + (k * b) / 4, b * 0.18, pass === 2 ? 0.014 : 0.01, { type: 'square', cutoff: 2000, open: 1.6, q: 1, detune: 0, send: 0.55 });
      }
    }
    if (pass === 1 || pass === 2) {
      for (const [n, beat, len] of TUNE) {
        if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
        const at = t + (beat - bar * 4) * b;
        if (pass === 1) play.synth(n, at, len * b * 0.9, 0.026, { cutoff: 1500, open: 1.4, q: 1.5, detune: 10, send: 0.4, attack: 0.03, release: 0.3 });
        else if (len >= 1) play.bell(n + 12, at, 0.03, { decay: 2, send: 0.5 });
      }
    }
  },
};

export default {
  id: 'harbour',
  name: 'Neon Harbour',
  theme: '#0b0618',
  music,
  build(shared) {
    const group = new Group();
    const towers = plan();
    add(group, skyDome(shared, SKY, { below: 0.55 }), -10);
    add(group, stars(shared, { count: 200, seed: 1357, low: 0.35, color: 'vec3(0.9, 0.85, 1.0)', gain: 1.1 }), 1);
    add(group, skyline(shared, towers), 0);
    add(group, ridges(shared, {
      sky: SKY,
      layers: [{ r: 290, h: 22, seed: 0 }, { r: 340, h: 40, seed: 0 }],
      profile: farCity(),
      shade: FAR_SHADE,
      segments: 3000,
    }), 0);
    add(group, water(shared, {
      sky: SKY,
      deep: 'vec3(0.006, 0.003, 0.012)',
      shine: 'mix(vec3(0.5, 0.15, 0.4), vec3(0.15, 0.4, 0.55), front)',
      alpha: [0.68, 0.18],
    }), 3);
    add(group, neon(shared, towers), 4);
    add(group, towerLights(shared, towers), 4);
    return group;
  },
};
