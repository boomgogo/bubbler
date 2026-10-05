// The level-start fly-over. The camera rises from the playing view to the top of the column,
// swoops down past a few close-ups and lands back exactly on the playing view.
//
// A flight is a list of keys on the view's clock. Each key has an eye, a point it looks at, and
// `w`: how much of the playing camera it is. At w = 1 the camera is the playing camera itself
// (its eye, its straight-ahead gaze and its off-centre window, all read live every frame); at
// w = 0 it is a plain camera looking at the target. Eye and target follow cubic Hermite curves
// through the keys, so the motion has no jolts, and the first and last keys are live, so the
// handoff is exact even if the window is resized mid-flight.
import { Vector3, Quaternion, Matrix4 } from 'three';
import { COLS, KIND } from '../config.js';
import { specialName } from '../core/board.js';

const UP = new Vector3(0, 1, 0);
const TAN = Math.tan((38 / 2) * (Math.PI / 180)); // half the view across the narrower side
const CLOSE = 2.05; // eye distance from a close-up's centre, in bubble diameters
const NEAR = 0.06; // near plane at w = 0; the playing camera uses 1
export const MIN_Z = 1.2; // the paths keep the eye this far in front of the board's plane (tested)

const LINGER = 1.0; // extra seconds on a close-up that comes with a line to read
const TIMES = {
  full: { rise: 1.15, travel: 0.85, hold: 0.7, settle: 1.15, cap: 6.5 },
  quick: { rise: 0.85, travel: 0.7, hold: 0.55, settle: 0.95, cap: 3.2 },
};

// Up to `count` bubbles worth a close look, top to bottom. items: { x, y, look, nbr } in board
// space (y grows downwards). prefer(look) marks kinds the player has not been told about yet.
export function pickCloseUps(items, count, { neighbors = true, prefer = () => false, random = Math.random } = {}) {
  if (!items.length || count <= 0) return [];
  let top = Infinity;
  let bottom = -Infinity;
  for (const s of items) {
    top = Math.min(top, s.y);
    bottom = Math.max(bottom, s.y);
  }
  const jitter = new Map(items.map((s) => [s, random() * 0.3]));
  const picks = [];
  const named = new Set();
  const score = (s) => {
    const name = specialName(s.look);
    let v = jitter.get(s);
    if (name && prefer(s.look) && !named.has(name)) v += 5;
    if (name) v += named.has(name) ? 1 : 3;
    else if (neighbors && s.nbr) v += 0.5 * new Set(s.nbr.filter((n) => n && n !== s.look.c + 1)).size;
    if (s.nbr) v += 0.05 * s.nbr.filter(Boolean).length;
    if (s.x < 1 || s.x > COLS - 1) v -= 0.5; // the side walls crowd the shot
    return v;
  };
  const clear = (s) => picks.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > 2.5);
  const band = (bottom - top) / count;
  for (let i = 0; i < count; i++) {
    const lo = top + band * i - 0.01;
    const hi = i === count - 1 ? Infinity : lo + band + 0.01;
    let best = null;
    let bestValue = -Infinity;
    for (const pass of [true, false]) {
      for (const s of items) {
        if ((pass && (s.y < lo || s.y > hi)) || !clear(s)) continue;
        const v = score(s);
        if (v > bestValue) [best, bestValue] = [s, v];
      }
      if (best) break;
    }
    if (!best) break;
    picks.push(best);
    const name = specialName(best.look);
    if (name) named.add(name);
  }
  return picks.sort((a, b) => a.y - b.y);
}

// Keys for a flight over the column. picks: world positions of the close-ups, top first.
// top: world y of the top row. side: which side the camera starts on, -1 or 1.
// lingers[i]: hold close-up i long enough to read a line about it. A long column is flown
// faster, so the flight fits its length whatever the level.
export function planFlight(picks, options) {
  const T = options.quick ? TIMES.quick : TIMES.full;
  const lingering = picks.reduce((sum, _, i) => sum + (options.lingers?.[i] ? LINGER : 0), 0);
  const natural = keysFor(picks, options, 1).at(-1).t - lingering;
  return keysFor(picks, options, Math.min(1, T.cap / natural));
}

function keysFor(picks, { top, side = 1, quick = false, lingers = [] }, pace) {
  const T = quick ? TIMES.quick : TIMES.full;
  const keys = [{ t: 0, live: true, w: 1 }];
  let t = T.rise * pace;
  let eye = new Vector3(side * 2.4, top + 2.4, 9.5);
  keys.push({ t, eye, target: new Vector3(0, top - 2.4, 0), w: 0 });
  let s = -side;
  let last = null;
  for (const [i, p] of picks.entries()) {
    // A long way between close-ups: pull back so the column passes by rather than whips past.
    if (last && last.distanceTo(p) > 3.5) {
      const mid = last.clone().add(p).multiplyScalar(0.5);
      eye = new Vector3(mid.x - s * 1.4, mid.y + 0.6, 5.6);
      t += T.travel * 0.6 * pace;
      keys.push({ t, eye, target: new Vector3(mid.x * 0.5, mid.y - 0.9, 0), w: 0 });
    }
    // Arrive off to one side and a little above, then drift round the bubble while holding.
    const from = new Vector3(s * 0.45, 0.22, 1).normalize();
    const a = p.clone().addScaledVector(from, CLOSE);
    const b = p.clone().addScaledVector(from.applyAxisAngle(UP, -s * 0.2), CLOSE);
    const hold = T.hold * pace + (lingers[i] ? LINGER : 0);
    const drift = b.clone().sub(a).divideScalar(hold);
    t += (T.travel + Math.min(0.5, eye.distanceTo(a) * 0.035)) * pace;
    keys.push({ t, eye: a, target: p, w: 0, v: drift, vt: new Vector3(), hold: i });
    t += hold;
    keys.push({ t, eye: b, target: p, w: 0, v: drift, vt: new Vector3() });
    eye = b;
    last = p;
    s = -s;
  }
  t += T.settle * pace;
  keys.push({ t, live: true, w: 1 });
  return keys;
}

const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);

function hermite(out, p0, m0, p1, m1, u, d) {
  const u2 = u * u;
  const u3 = u2 * u;
  return out
    .copy(p0).multiplyScalar(2 * u3 - 3 * u2 + 1)
    .addScaledVector(m0, (u3 - 2 * u2 + u) * d)
    .addScaledVector(p1, -2 * u3 + 3 * u2)
    .addScaledVector(m1, (u3 - u2) * d);
}

const _m = new Matrix4();
const IDENTITY = new Quaternion();
export class Flight {
  // keys: from planFlight. start: the view's clock when the flight begins.
  constructor(keys, start) {
    this.keys = keys;
    this.start = start;
    this.end = start + keys[keys.length - 1].t;
    this.pose = { eye: new Vector3(), target: new Vector3(), w: 1 };
  }

  done(time) {
    return time >= this.end;
  }

  // Eye, target and w at `time`. live: { eye, center } of the playing camera this frame.
  sample(time, live) {
    const { keys, pose } = this;
    const span = keys[keys.length - 1].t;
    const t = time >= this.end ? span : Math.min(Math.max(time - this.start, 0), span);
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const k0 = keys[i];
    const k1 = keys[i + 1];
    const d = k1.t - k0.t;
    const u = d > 0 ? Math.min(1, (t - k0.t) / d) : 1;
    const eyeAt = (k) => (k.live ? live.eye : k.eye);
    const targetAt = (k) => (k.live ? live.center : k.target);
    // Velocity at a key: given, zero at the ends, otherwise from the keys on either side.
    const velocity = (j, at, given) => {
      const k = keys[j];
      if (k[given]) return k[given];
      if (j === 0 || j === keys.length - 1) return new Vector3();
      return at(keys[j + 1]).clone().sub(at(keys[j - 1])).divideScalar(keys[j + 1].t - keys[j - 1].t);
    };
    hermite(pose.eye, eyeAt(k0), velocity(i, eyeAt, 'v'), eyeAt(k1), velocity(i + 1, eyeAt, 'v'), u, d);
    hermite(pose.target, targetAt(k0), velocity(i, targetAt, 'vt'), targetAt(k1), velocity(i + 1, targetAt, 'vt'), u, d);
    pose.w = u >= 1 ? k1.w : k0.w + (k1.w - k0.w) * smoother(u);
    return pose;
  }

  // Close-ups reached between two clock readings, as indexes into the picks.
  holdsBetween(from, to) {
    const out = [];
    for (const k of this.keys) {
      if (k.hold !== undefined && k.t + this.start > from && k.t + this.start <= to) out.push(k.hold);
    }
    return out;
  }

  // A new flight from wherever this one is now straight back to the playing camera.
  cut(time, live, seconds = 0.45) {
    const p = this.sample(time, live);
    const keys = [
      { t: 0, eye: p.eye.clone(), target: p.target.clone(), w: p.w },
      { t: seconds, live: true, w: 1 },
    ];
    return new Flight(keys, time);
  }
}

// Turns a sampled pose into a camera: position, rotation and an off-centre frustum given as
// the window's edges at unit distance. live.frustum is the playing camera's window.
export function poseCamera(camera, pose, live) {
  const f = live.frustum;
  const w = pose.w;
  camera.position.copy(pose.eye);
  const look = camera.quaternion;
  if (w >= 1) look.identity();
  else {
    _m.lookAt(pose.eye, pose.target, UP);
    look.setFromRotationMatrix(_m);
    if (w > 0) look.slerp(IDENTITY, w);
  }
  // A plain lens covers TAN either side of the narrower dimension of the screen.
  const aspect = (f.right - f.left) / (f.top - f.bottom);
  const half = aspect >= 1 ? [TAN * aspect, TAN] : [TAN, TAN / aspect];
  const mix = (plain, game) => plain + (game - plain) * w;
  const near = NEAR + (1 - NEAR) * w ** 4;
  camera.updateMatrixWorld();
  camera.projectionMatrix.makePerspective(
    mix(-half[0], f.left) * near, mix(half[0], f.right) * near,
    mix(half[1], f.top) * near, mix(-half[1], f.bottom) * near,
    near, 2000,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

