import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, KIND, LAUNCH_Y, FAIL_ROW, GEMS, START_MOVES, MOVES_PER_LEVEL, levelParams } from '../../src/config.js';
import { rowLen, cellX, cellY, neighbor, forNeighbors, hexDist, inGrid } from '../../src/core/grid.js';
import { Board, makeBubble } from '../../src/core/board.js';
import { traceShot, tracePierce } from '../../src/core/shot.js';
import { applyShot } from '../../src/core/rules.js';
import { generateLevel } from '../../src/core/levelgen.js';
import { Game } from '../../src/core/game.js';
import { greedyPolicy } from '../sim-bot.js';

const UP = Math.PI / 2;
const col = (c, m = 0) => makeBubble(KIND.COLOR, c, m);
// Builds a board from rows of characters: a-e colours, A-E Comets, * Nova, # Obsidian,
// ~x a misted colour (two characters), '.' empty. Cells are separated by spaces.
function board(text) {
  const b = new Board();
  text.trim().split('\n').forEach((line, r) => {
    line.trim().split(/\s+/).forEach((ch, c) => {
      if (ch === '.') return b.set(r, c, null);
      if (ch === '*') return b.set(r, c, makeBubble(KIND.NOVA));
      if (ch === '#') return b.set(r, c, makeBubble(KIND.OBSIDIAN));
      const mist = ch[0] === '~' ? 1 : 0;
      const letter = ch[ch.length - 1];
      const comet = letter !== letter.toLowerCase();
      b.set(r, c, makeBubble(comet ? KIND.COMET : KIND.COLOR, letter.toLowerCase().charCodeAt(0) - 97, mist));
    });
  });
  return b;
}
const origin = { x: COLS / 2, y: LAUNCH_Y };
const shoot = (b, shot, angle) => applyShot(b, shot, origin.x, origin.y, angle);

test('grid: neighbours are mutual and one diameter apart', () => {
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      forNeighbors(r, c, (nr, nc) => {
        const d = Math.hypot(cellX(r, c) - cellX(nr, nc), cellY(r) - cellY(nr));
        assert.ok(Math.abs(d - 1) < 1e-9, `(${r},${c}) to (${nr},${nc}) is ${d}`);
        assert.equal(hexDist(r, c, nr, nc), 1);
        let back = false;
        forNeighbors(nr, nc, (br, bc) => (back ||= br === r && bc === c));
        assert.ok(back);
      });
    }
  }
  assert.deepEqual(neighbor(2, 3, 2), [1, 3]);
  assert.deepEqual(neighbor(1, 3, 2), [0, 4]);
  assert.equal(inGrid(1, COLS - 1), false);
  assert.equal(hexDist(0, 0, 4, 0), 4);
});

test('shot: straight up settles under the ceiling bubble', () => {
  const b = board('a a a a a a a a a a');
  const t = traceShot(b, origin.x, origin.y, UP);
  assert.equal(t.cell[0], 1);
  assert.ok(Math.abs(cellX(...t.cell) - origin.x) <= 0.5);
  assert.ok(Math.abs(t.len - (LAUNCH_Y - t.y)) < 1e-9);
});

test('shot: an empty board sends the bubble to the ceiling', () => {
  const t = traceShot(new Board(), origin.x, origin.y, UP);
  assert.equal(t.cell[0], 0);
  assert.ok(Math.abs(cellX(...t.cell) - origin.x) <= 0.5);
  assert.ok(Math.abs(t.y - 0.5) < 1e-9);
});

test('shot: a shallow angle bounces off the wall', () => {
  const t = traceShot(new Board(), origin.x, origin.y, 0.5);
  assert.ok(t.pts.length >= 6, 'has at least one bounce point');
  assert.ok(Math.abs(t.pts[2] - (COLS - 0.5)) < 1e-9, 'first bounce is on the right wall');
  for (let i = 0; i < t.pts.length; i += 2) assert.ok(t.pts[i] >= 0.5 - 1e-9 && t.pts[i] <= COLS - 0.5 + 1e-9);
  assert.equal(t.cell[0], 0);
});

test('rules: three in a row pop, two do not', () => {
  const b = board('b b b b a a b b b b');
  const res = shoot(b, { k: KIND.COLOR, c: 0 }, UP);
  assert.equal(res.pops.length, 3);
  assert.equal(b.count(), 8);
  const b2 = board('b b b b a b b b b b');
  const res2 = shoot(b2, { k: KIND.COLOR, c: 0 }, UP);
  assert.equal(res2.pops.length, 0);
  assert.equal(b2.count(), 11);
});

test('rules: popping the group above lets the rest fall', () => {
  const b = board(`
    a a . . . . . . . .
     a . . . . . . . .
    c . . . . . . . . .
     d . . . . . . . .`);
  // Aim at the far-left column: the shot joins the three 'a's.
  let best = null;
  for (let a = 0.3; a < Math.PI - 0.3; a += 0.01) {
    const t = traceShot(b, origin.x, origin.y, a);
    if (t.cell && t.cell[0] === 1 && t.cell[1] === 1) best = a;
  }
  assert.ok(best !== null, 'cell (1,1) is reachable');
  const res = shoot(b, { k: KIND.COLOR, c: 0 }, best);
  assert.equal(res.pops.length, 4);
  assert.equal(res.drops.length, 2);
  assert.equal(b.count(), 0);
});

test('rules: a popped Comet clears its row but leaves Obsidian', () => {
  const b = board(`
    b c b # A a b c b c
     . . . . . . d . .`);
  const res = shoot(b, { k: KIND.COLOR, c: 0 }, UP);
  assert.ok(res.blasts.some((x) => x.type === 'row' && x.r === 0));
  assert.equal(b.rows[0].filter((x) => x !== null).length, 1);
  assert.equal(b.get(0, 3).k, KIND.OBSIDIAN);
});

test('rules: touching a Nova clears two cells around it, Obsidian included', () => {
  const b = board(`
    b c b c b c b c b c
     b c b # * c b c b
    b c b c b c b c b c`);
  const before = b.count();
  let angle = null;
  for (let a = 0.3; a < Math.PI - 0.3; a += 0.01) {
    const t = traceShot(b, origin.x, origin.y, a);
    if (t.cell && hexDist(t.cell[0], t.cell[1], 1, 4) === 2) angle = a;
  }
  // A shot two cells away does not touch the Nova.
  const far = shoot(b.clone(), { k: KIND.COLOR, c: 4 }, angle);
  assert.equal(far.blasts.length, 0);
  // A Nova shot goes off where it lands.
  const res = shoot(b, { k: KIND.NOVA, c: -1 }, UP);
  assert.ok(res.blasts.length >= 1);
  assert.ok(b.count() < before - 6);
  assert.equal(b.get(1, 3), null, 'the Obsidian next to the Nova is gone');
});

test('rules: a pop next to Mist lifts it without popping it', () => {
  const b = board(`
    b b b ~a a a ~a b b b`);
  const res = shoot(b, { k: KIND.COLOR, c: 0 }, UP);
  assert.equal(res.pops.length, 3, 'misted bubbles do not join the match');
  assert.equal(res.reveals.length, 2);
  assert.equal(b.get(0, 3).m, 0);
  assert.equal(b.get(0, 6).m, 0);
});

test('rules: a Comet shot ploughs through and specials that fall are caught', () => {
  const b = board(`
    a b c d a b c d a b
     a b c d a b c d a
    a b c d a * c d a b`);
  const res = shoot(b, { k: KIND.COMET, c: -1 }, UP);
  assert.ok(res.pops.length >= 3);
  assert.equal(res.placed, null);
  const b2 = board(`
    a a . . . . . . . .
     a . . . . . . . .
    * . . . . . . . . .`);
  let angle = null;
  for (let a = 0.3; a < Math.PI - 0.3; a += 0.01) {
    const t = traceShot(b2, origin.x, origin.y, a);
    if (t.cell && t.cell[0] === 1 && t.cell[1] === 1) angle = a;
  }
  const res2 = shoot(b2, { k: KIND.COLOR, c: 0 }, angle);
  assert.deepEqual(res2.caught, [KIND.NOVA]);
});

test('pierce: stops after its reach', () => {
  const rows = Array.from({ length: 14 }, (_, r) => (r & 1 ? 'a b c d a b c d a' : 'a b c d a b c d a b')).join('\n');
  const b = board(rows);
  const t = tracePierce(b, origin.x, origin.y, UP);
  assert.ok(t.cells.length >= 6 && t.cells.length <= 24, `took ${t.cells.length}`);
  assert.ok(t.len - t.contactLen <= 6.1);
});

test('levelgen: same seed, same level; everything hangs from the ceiling', () => {
  const sig = (b) => JSON.stringify(b.rows.map((row) => row.map((x) => (x ? [x.k, x.c, x.m] : 0))));
  for (const level of [1, 2, 3, 5, 9, 14]) {
    const a = generateLevel(level, 42);
    assert.equal(sig(a), sig(generateLevel(level, 42)));
    assert.notEqual(sig(a), sig(generateLevel(level, 43)));
    assert.equal(a.floating().length, 0);
    assert.ok(a.rows[0].some((x) => x?.k === KIND.COMET), 'a Comet sits in the top row');
    assert.ok(!a.rows[0].some((x) => x?.k === KIND.OBSIDIAN), 'no Obsidian in the top row');
    for (const row of a.rows) assert.ok(row.filter((x) => x?.k === KIND.OBSIDIAN).length <= 3);
    const bottom = a.lowestRow();
    assert.ok(!a.rows[bottom].some((x) => x?.m), 'the bottom row is free of Mist');
  }
  assert.equal(generateLevel(1, 7).lowestRow() + 1, levelParams(1).rows);
});

test('game: deals only colours on the board and charges a move per shot', () => {
  const g = new Game({ seed: 5 });
  assert.equal(g.moves, START_MOVES);
  for (let i = 0; i < 25 && g.phase === 'aim'; i++) {
    const present = g.board.colors();
    assert.ok(present.includes(g.hand[0].c) && present.includes(g.hand[1].c));
    const before = g.moves;
    const res = g.fire(0.4 + i * 0.09);
    assert.equal(g.moves, before - (res.special ? 0 : 1));
  }
});

test('game: a run replays exactly from its seed, and survives save and load', () => {
  const play = (g, n) => {
    for (let i = 0; i < n && g.phase !== 'over'; i++) {
      if (g.phase === 'cleared') g.nextLevel();
      else if (g.phase === 'nomoves') g.endRun();
      else {
        const pick = greedyPolicy(g, 40);
        if (pick.swap) g.swap();
        g.fire(pick.angle);
      }
    }
    return g;
  };
  const a = play(new Game({ seed: 99 }), 60);
  const b = play(new Game({ seed: 99 }), 60);
  assert.equal(a.score, b.score);
  assert.ok(a.level > 1, 'the greedy player clears level 1');
  assert.equal(a.moves <= START_MOVES + MOVES_PER_LEVEL * (a.level - 1), true);

  const half = play(new Game({ seed: 99 }), 30);
  const resumed = Game.load(JSON.parse(JSON.stringify(half.serialize())));
  play(resumed, 30);
  assert.equal(resumed.score, a.score);
  assert.equal(resumed.level, a.level);
});

test('game: the run ends when bubbles reach the launcher line', () => {
  const g = new Game({ seed: 3 });
  g.board = board('# # # # # # # # # #');
  // Stack three colours in turn straight up the middle: nothing ever matches.
  for (let i = 0; i < 40 && g.phase === 'aim'; i++) {
    g.hand = [{ k: KIND.COLOR, c: i % 3 }, { k: KIND.COLOR, c: (i + 1) % 3 }];
    g.fire(Math.PI / 2);
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.overReason, 'overflow');
  assert.ok(g.board.lowestRow() - g.scrollRow >= FAIL_ROW);
});

test('gems: given after a dry spell, when moves run low, and for a first Second Wind', () => {
  const g = new Game({ seed: 11 });
  g.board = board('# # # # # # # # # #');
  let gifts = [];
  for (let i = 0; i < GEMS.dryShots; i++) {
    g.hand = [{ k: KIND.COLOR, c: 0 }, { k: KIND.COLOR, c: 1 }];
    gifts = g.fire(0.5 + i * 0.5).gifts;
  }
  assert.deepEqual(gifts, [{ amount: GEMS.dryGift, reason: 'dry' }]);
  assert.equal(g.gems, GEMS.start + GEMS.dryGift);

  g.moves = GEMS.lowMoves + 1;
  g.hand = [{ k: KIND.COLOR, c: 0 }, { k: KIND.COLOR, c: 1 }];
  assert.ok(g.fire(1.2).gifts.some((x) => x.reason === 'moves'));

  g.gems = 0;
  g.moves = 1;
  g.hand = [{ k: KIND.COLOR, c: 0 }, { k: KIND.COLOR, c: 1 }];
  const last = g.fire(1.9);
  assert.equal(g.phase, 'nomoves');
  assert.ok(last.gifts.some((x) => x.reason === 'revive'));
  assert.equal(g.gems, g.reviveCost);
  assert.ok(g.revive());
  assert.equal(g.moves, GEMS.reviveMoves);
  assert.equal(g.phase, 'aim');
  assert.equal(g.reviveCost, GEMS.reviveBase + GEMS.reviveStep);
});

test('gems: buy a Comet shot or clear the Mist', () => {
  const g = new Game({ seed: 12 });
  g.board = board(`
    a ~b ~c a b c a b c a
     ~a ~b c a b c a b c`);
  g.gems = GEMS.comet + GEMS.clear;
  const moves = g.moves;
  assert.ok(g.buyComet());
  assert.equal(g.active.k, KIND.COMET);
  assert.equal(g.swap(), false, 'no swapping while a special is loaded');
  const res = g.fire(Math.PI / 2);
  assert.ok(res.special && res.pops.length > 0);
  assert.equal(g.moves, moves, 'a special shot costs no move');
  const reveals = g.buyClear();
  if (g.phase === 'aim' && reveals) {
    assert.ok(reveals.length > 0);
    assert.equal(g.hasMist(), false);
  }
  assert.equal(g.buyComet(), false, 'cannot buy without gems');
});
