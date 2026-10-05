import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { KIND } from '../../src/config.js';
import { Flight, planFlight, pickCloseUps, poseCamera, MIN_Z } from '../../src/render/flyover.js';
import { createRng } from '../../src/core/rng.js';

// The playing camera as the view works it out: an eye 40 back and an off-centre window.
const live = () => ({
  eye: new Vector3(0.3, -4.2, 40),
  center: new Vector3(0, -1.5, 0),
  frustum: { left: -0.2, right: 0.19, top: 0.33, bottom: -0.18 },
});
const look = (k = KIND.COLOR, c = 0, m = 0) => ({ k, c, m, seed: 0.5 });

// A column of `rows` rows in board space, as the view's statics are.
function column(rows, special = {}) {
  const items = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 10 - (r & 1); c++) {
      const kind = special[`${r},${c}`];
      items.push({ x: c + 0.5 + 0.5 * (r & 1), y: r * 0.866 + 0.5, look: kind ? look(kind, -1) : look(KIND.COLOR, (r + c) % 4), nbr: [1, 2, 3, 4, 1, 2] });
    }
  }
  return items;
}

test('close-ups: at most the count asked, top to bottom, specials first, apart from each other', () => {
  const rng = createRng(3);
  const items = column(16, { '2,4': KIND.COMET, '12,6': KIND.NOVA });
  const picks = pickCloseUps(items, 3, { random: () => rng.next() });
  assert.equal(picks.length, 3);
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i].y >= picks[i - 1].y);
  assert.ok(picks.some((p) => p.look.k === KIND.COMET));
  assert.ok(picks.some((p) => p.look.k === KIND.NOVA));
  for (const a of picks) for (const b of picks) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2.5);
  assert.equal(pickCloseUps([], 3).length, 0);
  assert.equal(pickCloseUps(column(1), 3).length, 3);
});

test('close-ups: a kind the player has not met comes first', () => {
  const items = column(10, { '3,3': KIND.OBSIDIAN, '6,5': KIND.COMET });
  const picks = pickCloseUps(items, 1, { prefer: (l) => l.k === KIND.OBSIDIAN, random: () => 0 });
  assert.equal(picks[0].look.k, KIND.OBSIDIAN);
});

function flight(rows = 20, quick = false) {
  const picks = [new Vector3(-2, 12, 0), new Vector3(1.5, 6, 0), new Vector3(-0.5, -1, 0)].slice(0, quick ? 1 : 3);
  return new Flight(planFlight(picks, { top: 7 + rows * 0.4, side: 1, quick, lingers: [true, false, false] }), 10);
}

test('fly-over: starts and lands exactly on the playing camera', () => {
  for (const f of [flight(), flight(8, true)]) {
    const L = live();
    for (const t of [f.start, f.end]) {
      const p = f.sample(t, L);
      assert.equal(p.w, 1);
      assert.ok(p.eye.distanceTo(L.eye) < 1e-9, `eye at ${t}`);
    }
    assert.ok(f.end - f.start <= (f.keys.length > 5 ? 6.5 : 3.2) + 1.0 + 1e-9, `short enough to sit through: ${(f.end - f.start).toFixed(2)} s`);
    const mid = f.sample((f.start + f.end) / 2, L);
    assert.equal(mid.w, 0);
  }
});

test('fly-over: moves smoothly and never enters the board', () => {
  const f = flight();
  const L = live();
  let last = f.sample(f.start, L).eye.clone();
  let lastStep = 0;
  for (let t = f.start; t <= f.end; t += 1 / 60) {
    const p = f.sample(t, L);
    const step = p.eye.distanceTo(last);
    assert.ok(step < 1.2, `jump of ${step.toFixed(2)} at ${(t - f.start).toFixed(2)} s`);
    assert.ok(Math.abs(step - lastStep) < 0.12, `jolt at ${(t - f.start).toFixed(2)} s`);
    assert.ok(p.eye.z >= MIN_Z, `eye at z ${p.eye.z.toFixed(2)}`);
    last = p.eye.clone();
    lastStep = step;
  }
});

test('fly-over: a cut lands on the playing camera from wherever the camera is', () => {
  const f = flight();
  const L = live();
  const at = f.start + 2.3;
  const before = f.sample(at, L);
  const eye = before.eye.clone();
  const cut = f.cut(at, L, 0.45);
  assert.ok(cut.sample(at, L).eye.distanceTo(eye) < 1e-9);
  const end = cut.sample(at + 0.45, L);
  assert.equal(end.w, 1);
  assert.ok(end.eye.distanceTo(L.eye) < 1e-9);
});

test('fly-over: at rest the camera is the playing camera, matrix for matrix', () => {
  const L = live();
  const camera = new PerspectiveCamera();
  poseCamera(camera, { eye: L.eye, target: L.center, w: 1 }, L);
  const f = L.frustum;
  const expected = new PerspectiveCamera();
  expected.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, 1, 2000);
  assert.deepEqual(camera.projectionMatrix.elements, expected.projectionMatrix.elements);
  assert.deepEqual(camera.quaternion.toArray(), [0, 0, 0, 1]);
  assert.ok(camera.position.equals(L.eye));
});
