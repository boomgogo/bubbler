// The autoplayer: it plays fair, aims where the result is safe, moves like a hand, and is repeatable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/core/game.js';
import { Board } from '../../src/core/board.js';
import { traceShot } from '../../src/core/shot.js';
import { createRng } from '../../src/core/rng.js';
import { expertPolicy, takeTurn } from '../sim-bot.js';
import * as human from '../human.js';
import { hashState } from '../record.js';
import { chapters } from '../cut.js';

// A game at level `level`, as a run reaches it.
function gameAt(level, seed = 7) {
  const game = new Game({ seed });
  while (game.level < level) {
    game.phase = 'cleared';
    game.nextLevel();
  }
  return game;
}

const decide = (game) => {
  const c = expertPolicy(game);
  return { boost: c.boost, swap: c.swap, angle: c.angle };
};

test('the expert never reads a colour hidden by Mist', () => {
  // Boards from several runs, a few turns into a misty level, each recoloured under the Mist.
  let boards = 0;
  for (const seed of [3, 11, 29, 41]) {
    const game = gameAt(6, seed);
    for (let turn = 0; turn < 8 && game.phase === 'aim'; turn++) {
      let misted = 0;
      game.board.each((r, c, b) => (misted += b.m));
      if (misted) {
        boards++;
        const before = decide(game);
        const real = game.board;
        const rng = createRng(seed * 31 + turn);
        for (let k = 0; k < 3; k++) {
          game.board = new Board(real.rows.map((row) => row.map((b) => (b && b.m ? { ...b, c: rng.int(4) } : b))));
          assert.deepEqual(decide(game), before, `seed ${seed}, turn ${turn}`);
        }
        game.board = real;
      }
      takeTurn(game, expertPolicy(game));
    }
  }
  assert.ok(boards >= 20, 'enough misty boards to mean something');
});

test('the expert never reads the deal', () => {
  const game = gameAt(4, 5);
  const before = decide(game);
  game.dealt += 3; // every bubble still to come changes; the two in hand do not
  assert.deepEqual(decide(game), before);
});

test('the chosen angle sits inside a window that gives the same landing cell', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const game = gameAt(1 + (seed % 6), seed);
    const c = expertPolicy(game, { boosts: false });
    if (game.active.k !== 0 || c.cell === null) continue;
    const { x, y } = game.origin;
    const margin = 0.3 * (c.hi - c.lo);
    for (const a of [c.angle, c.angle - margin, c.angle + margin]) {
      assert.deepEqual(traceShot(game.board, x, y, a).cell, c.cell);
    }
    assert.ok(c.hi - c.lo >= 0.004, 'not a hair-width window');
  }
});

test('the same seed plays the same run', () => {
  const play = () => {
    const game = new Game({ seed: 99 });
    const hashes = [];
    for (let i = 0; i < 30 && game.phase !== 'over'; i++) {
      if (game.phase === 'cleared') game.nextLevel();
      else if (game.phase === 'nomoves') game.revive() || game.endRun();
      else takeTurn(game, expertPolicy(game));
      hashes.push(hashState(game.serialize()));
    }
    return hashes;
  };
  assert.deepEqual(play(), play());
});

test('a hand move starts where the hand is and ends exactly on the target', () => {
  for (let seed = 1; seed < 40; seed++) {
    const rng = createRng(seed);
    const from = { x: rng.next() * 1280, y: rng.next() * 720 };
    const to = { x: rng.next() * 1280, y: rng.next() * 720 };
    const move = human.movement(createRng(seed), from, to, { width: 20 });
    const again = human.movement(createRng(seed), from, to, { width: 20 });
    assert.deepEqual(again.at(0.1), move.at(0.1), 'repeatable');
    const start = move.at(0);
    assert.ok(Math.hypot(start.x - from.x, start.y - from.y) < 0.01);
    assert.deepEqual(move.at(move.duration), to);
    assert.ok(move.duration > 0.1 && move.duration < 1.5, `took ${move.duration} s`);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    for (let t = 0; t <= move.duration; t += 1 / 60) {
      const p = move.at(t);
      // Never far off the straight line: no flailing.
      const along = ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / dist;
      const off = Math.abs((p.x - from.x) * (to.y - from.y) - (p.y - from.y) * (to.x - from.x)) / dist;
      assert.ok(off < 30 && along > -20 && along < dist + 25, `strayed at ${t}`);
    }
  }
});

test('thinking takes a person-like time', () => {
  const rng = createRng(4);
  const times = Array.from({ length: 500 }, () => human.thinkTime(rng, { value: 5, removed: 3, alt: null }));
  times.sort((a, b) => a - b);
  assert.ok(times[0] >= 0.2 && times.at(-1) <= 2.2);
  assert.ok(times[250] > 0.35 && times[250] < 0.7, `median ${times[250]}`);
});

test('chapters follow YouTube rules: from 0:00, three or more, ten seconds apart', () => {
  const run = {
    fps: 60, seconds: 900,
    events: [
      { type: 'start', frame: 0, level: 1, place: 'lake' },
      { type: 'level', frame: 600, level: 2 }, { type: 'level', frame: 1200, level: 3 },
      { type: 'place', frame: 9000, place: 'fjord' }, { type: 'level', frame: 9100, level: 4 },
      { type: 'place', frame: 9300, place: 'marsh' }, // too soon after the fjord: folded into it
      { type: 'place', frame: 20000, place: 'lagoon' }, { type: 'level', frame: 20100, level: 10 },
      { type: 'place', frame: 53800, place: 'harbour' }, // under 10 s before the end: dropped
    ],
  };
  const list = chapters(run);
  assert.equal(list[0].at, 0);
  assert.ok(list.length >= 3);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].at - list[i - 1].at >= 10);
  assert.ok(run.seconds - list.at(-1).at >= 10);
  assert.match(list[0].title, /Lantern Lake · levels 1–3/);
});
