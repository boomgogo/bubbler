// Headless players for tuning. They drive the same rules the game uses.
import { applyShot } from '../src/core/rules.js';
import { traceShot } from '../src/core/shot.js';
import { forNeighbors } from '../src/core/grid.js';
import { KIND, AIM_MIN, FAIL_ROW } from '../src/config.js';

const SPAN = Math.PI - 2 * AIM_MIN;

// Clicks anywhere.
export function randomPolicy(game, rng) {
  return { angle: AIM_MIN + rng.next() * SPAN, swap: false };
}

// Tries every reachable landing cell with both bubbles in hand and takes the shot that
// removes the most, counting dropped bubbles double.
export function greedyPolicy(game, steps = 120) {
  const { x, y } = game.origin;
  const hand = game.hand;
  const options = game.specials.length
    ? [[game.active, false]]
    : hand[0].c === hand[1].c
      ? [[hand[0], false]]
      : [[hand[0], false], [hand[1], true]];
  let best = { angle: Math.PI / 2, swap: false, value: -Infinity };

  for (const [shot, swap] of options) {
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const angle = AIM_MIN + (SPAN * i) / steps;
      if (shot.k !== KIND.COMET) {
        // Many angles land in the same cell; resolve each cell once.
        const cell = traceShot(game.board, x, y, angle).cell;
        if (cell === null) continue;
        const key = cell[0] * 16 + cell[1];
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const board = game.board.clone();
      const res = applyShot(board, shot, x, y, angle);
      let value = res.pops.length + 2 * res.drops.length + 6 * res.caught.length;
      const lowest = board.lowestRow();
      if (lowest < 0) value += 1000;
      if (lowest - game.scrollRow >= FAIL_ROW - 1) value -= 500;
      if (value === 0 && res.placed) {
        // Nothing pops: at least park the bubble high up and next to its own colour.
        const { r, c } = res.placed;
        let friends = 0;
        forNeighbors(r, c, (nr, nc) => {
          const b = board.get(nr, nc);
          if (b && !b.m && b.c === shot.c) friends++;
        });
        value = -1 - 0.3 * (r - game.scrollRow) + 0.6 * friends;
      }
      if (value > best.value) best = { angle, swap, value };
    }
  }
  return best;
}

// A stand-in for a person: looks at a coarse fan of angles and aims a little off.
export function casualPolicy(game, rng) {
  const best = greedyPolicy(game, 26);
  const wobble = (rng.next() + rng.next() + rng.next() - 1.5) * 0.035;
  return { angle: best.angle + wobble, swap: best.swap };
}
