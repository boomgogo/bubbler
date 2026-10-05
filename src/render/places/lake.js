// Lantern Lake: dusk on a still lake, ember on the horizon ahead, paper lanterns rising all
// round and the moon behind the player. The first place, so it ships with the game instead of
// loading as a chunk of its own.
import { Group } from 'three';
import { WATER_Y } from '../layout.js';
import { add, skyDome, stars, ridges, lanterns, water } from './kit.js';

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

// Near ridges are silhouettes. Distance and the waterline pick up the colour of the sky behind.
const RIDGE_SHADE = /* glsl */ `
  float front = lakeFront(normalize(vDir));
  float depth = vLayer * 0.5;
  vec3 haze = mix(vec3(0.03, 0.07, 0.15), vec3(0.42, 0.14, 0.06), front);
  col = mix(vec3(0.010, 0.012, 0.028), haze, 0.06 + 0.26 * depth);
  col = mix(col, haze, (1.0 - smoothstep(0.0, 0.3, abs(vHeight))) * 0.45);
  if (vHeight < 0.0) col *= 0.72;
  col *= 0.85 + 0.15 * uGlow;`;

// The music: a lantern-festival air in D major at a slow walk. A koto-like pattern carries the
// chords, a flute sings the tune, bells answer it, and every fourth pass is a quiet break.
// Notes are midi numbers. Each chord: pad voicing, bass, and the eight notes of the pattern.
const CHORDS = [
  { pad: [50, 57, 64, 66], bass: 38, arp: [62, 69, 74, 76, 78, 76, 74, 69] }, // D add9
  { pad: [47, 54, 62, 66], bass: 35, arp: [59, 66, 71, 74, 76, 74, 71, 66] }, // Bm
  { pad: [43, 50, 59, 66], bass: 43, arp: [55, 62, 67, 71, 74, 71, 67, 62] }, // G maj7
  { pad: [45, 52, 59, 64], bass: 45, arp: [57, 64, 69, 71, 76, 71, 69, 64] }, // A sus2
  { pad: [50, 57, 62, 66], bass: 38, arp: [62, 69, 74, 78, 81, 78, 74, 69] }, // D
  { pad: [42, 49, 57, 61], bass: 42, arp: [54, 61, 66, 69, 73, 69, 66, 61] }, // F#m
  { pad: [43, 50, 59, 62], bass: 43, arp: [55, 62, 67, 71, 74, 71, 67, 62] }, // G
  { pad: [45, 52, 57, 61], bass: 45, arp: [57, 64, 69, 73, 76, 73, 69, 64] }, // A
];
// The tune, over the eight chords: [note, beat, length in beats].
const TUNE = [
  [78, 0, 1.5], [76, 1.5, 0.5], [74, 2, 1], [69, 3, 1],
  [71, 4, 1.5], [74, 5.5, 0.5], [78, 6, 2],
  [76, 8, 1], [74, 9, 0.5], [71, 9.5, 0.5], [74, 10, 2],
  [76, 12, 3],
  [81, 16, 1], [78, 17, 0.5], [76, 17.5, 0.5], [78, 18, 1], [81, 19, 1],
  [83, 20, 1], [81, 21, 1], [78, 22, 2],
  [76, 24, 1], [78, 25, 0.5], [76, 25.5, 0.5], [74, 26, 1], [71, 27, 1],
  [69, 28, 0.5], [71, 28.5, 0.5], [76, 29, 3],
];
const BELLS = [74, 76, 78, 81, 83, 86];

export const music = {
  bpm: 76,
  beats: 4,
  level: 1.6,
  echo: { beats: 0.75, feedback: 0.32, mix: 0.28 },
  air: { type: 'lowpass', hz: 380, q: 0.5, gain: 0.012, swell: 0.09 }, // water lapping at the shore
  bar(play, i, t) {
    const b = play.beat;
    const chord = CHORDS[i % 8];
    const pass = Math.floor(i / 8) % 4; // 0 sets out, 1 sings, 2 answers in bells, 3 rests
    const bar = i % 8;
    play.pad(chord.pad, t, play.bar * 0.92, 0.022);
    play.bass(chord.bass, t, b * 1.8, 0.07);
    if (pass !== 3 || bar % 2 === 0) play.bass(chord.bass, t + 2 * b, b * 1.6, 0.05);
    const every = pass === 0 || pass === 3 ? 2 : 1;
    for (let k = 0; k < 8; k += every) {
      if (pass === 3 && Math.random() < 0.3) continue;
      play.pluck(chord.arp[k], t + (k * b) / 2, k % 4 === 0 ? 0.055 : 0.04);
    }
    if (pass === 1 || pass === 2) {
      for (const [n, beat, len] of TUNE) {
        if (beat < bar * 4 || beat >= bar * 4 + 4) continue;
        const at = t + (beat - bar * 4) * b;
        if (pass === 1) play.lead(n, at, len * b * 0.95, 0.05);
        else play.bell(n, at, 0.04);
      }
      if (pass === 2) for (let k = 1; k < 8; k += 2) play.shaker(t + (k * b) / 2, 0.01);
    } else if (Math.random() < 0.6) {
      play.bell(BELLS[Math.floor(Math.random() * BELLS.length)], t + Math.floor(Math.random() * 4) * b, 0.03);
    }
  },
};

export default {
  id: 'lake',
  name: 'Lantern Lake',
  theme: '#060b1e',
  music,
  build(shared) {
    const group = new Group();
    add(group, skyDome(shared, SKY), -10);
    add(group, stars(shared), 1);
    add(group, ridges(shared, {
      sky: SKY,
      layers: [
        { r: 150, h: 10, seed: 1.3 },
        { r: 205, h: 21, seed: 4.1 },
        { r: 280, h: 39, seed: 8.7 },
      ],
      shade: RIDGE_SHADE,
    }), 0);
    for (const [mesh, order] of lanterns(shared)) add(group, mesh, order);
    add(group, water(shared, { sky: SKY }), 3);
    return group;
  },
};
