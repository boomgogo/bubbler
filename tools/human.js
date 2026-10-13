// The autoplayer's hands: how long a person looks before moving, and how a hand travels to aim, swap
// and press. Pure and seeded, so the same run always moves the same way. Times are in seconds,
// positions in CSS pixels.
import { createRng, mixSeed } from '../src/core/rng.js';

// A fresh random stream for each turn of a run, so a re-render from the middle moves as the first did.
export const handFor = (seed, turn) => createRng(mixSeed(seed >>> 0, 0x51ed + turn));

const gauss = (rng) => (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3); // about N(0, 1)
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const between = (rng, a, b) => a + rng.next() * (b - a);

// Seconds spent reading the board before the hand sets off.
export function thinkTime(rng, choice, pace = 1) {
  let t = 0.5 * Math.exp(0.35 * clamp(gauss(rng), -2.5, 2.5));
  if (choice.alt) t += 0.2; // two shots worth about the same
  if (choice.value <= 0) t += 0.3; // nothing scores: where to park it
  if (choice.removed >= 12 && !choice.alt) t *= 0.7; // the big one jumps out
  return clamp(t, 0.2, 2.2) * pace;
}

// Fitts's law: the time to reach a target `dist` px away and `width` px across.
export const reachTime = (dist, width, pace = 1) => (0.1 + 0.11 * Math.log2(dist / Math.max(4, width) + 1)) * pace;

const minJerk = (s) => s * s * s * (10 - 15 * s + 6 * s * s);

// A move from `from` to `to`, ending exactly on `to`: a main movement along a slight arc that lands
// a little off, then a small correction. Returns { duration, at(t) }.
export function movement(rng, from, to, { width = 30, pace = 1 } = {}) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 1) return { duration: 0, at: () => ({ ...to }) };
  const ux = (to.x - from.x) / dist;
  const uy = (to.y - from.y) / dist;
  const along = clamp(dist * 0.05 * gauss(rng), -18, 18);
  const across = clamp(dist * 0.025 * gauss(rng), -12, 12);
  const near = { x: to.x + ux * along - uy * across, y: to.y + uy * along + ux * across };
  const bend = clamp(dist * 0.07 * gauss(rng), -40, 40);
  const ctrl = { x: (from.x + near.x) / 2 - uy * bend, y: (from.y + near.y) / 2 + ux * bend };
  const t1 = reachTime(dist, width, pace);
  const off = Math.hypot(near.x - to.x, near.y - to.y);
  const t2 = off < 0.5 ? 0 : reachTime(off, width / 2, pace) * 0.8;
  return {
    duration: t1 + t2,
    at(t) {
      if (t >= t1 + t2) return { ...to };
      if (t < t1) {
        const s = minJerk(t / t1);
        const a = (1 - s) * (1 - s);
        const b = 2 * s * (1 - s);
        const c = s * s;
        return { x: a * from.x + b * ctrl.x + c * near.x, y: a * from.y + b * ctrl.y + c * near.y };
      }
      const s = minJerk((t - t1) / t2);
      return { x: near.x + (to.x - near.x) * s, y: near.y + (to.y - near.y) * s };
    },
  };
}


// A point on the screen at `dist` world units from the launcher along `angle`.
// layout: { x, y } the launcher on screen, and `unit`, pixels per world unit.
export const aimPoint = (layout, angle, dist) => ({
  x: layout.x + Math.cos(angle) * dist * layout.unit,
  y: layout.y - Math.sin(angle) * dist * layout.unit,
});

// A finger goes down a little to one side of where it means to aim, then drags onto it.
export function touchStart(rng, angle, dist) {
  const side = rng.next() < 0.5 ? -1 : 1;
  return { angle: angle + side * between(rng, 0.04, 0.1), dist: dist * between(rng, 0.85, 1.05) };
}

// A point somewhere inside a button, not dead centre.
export const pressPoint = (rng, rect) => ({
  x: rect.x + rect.width * clamp(0.5 + 0.15 * gauss(rng), 0.25, 0.75),
  y: rect.y + rect.height * clamp(0.5 + 0.15 * gauss(rng), 0.25, 0.75),
});

// How long a press is held, and the short pauses around the moves.
export const clickHold = (rng) => between(rng, 0.06, 0.11);
export const tapHold = (rng) => between(rng, 0.07, 0.14);
export const settle = (rng) => between(rng, 0.06, 0.15); // a look at the aim line before letting go
export const glance = (rng) => between(rng, 0.15, 0.3); // resting on the runner-up
export const reaction = (rng) => between(rng, 0.15, 0.28); // seeing the board settle
