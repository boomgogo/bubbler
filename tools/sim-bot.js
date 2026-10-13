// Headless players for tuning, and the autoplayer's brain. They drive the same rules the game uses.
import { applyShot } from '../src/core/rules.js';
import { traceShot, tracePierce } from '../src/core/shot.js';
import { forNeighbors } from '../src/core/grid.js';
import { Board } from '../src/core/board.js';
import { KIND, AIM_MIN, FAIL_ROW, VISIBLE_ROWS, GEMS } from '../src/config.js';

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

// ---- The expert: the autoplayer's brain, and the strongest of the bots ----
// It plays on what the screen shows. Mist hides a colour, so it plays on a copy of the board where
// hidden colours are unknown (the rules never match a Mist bubble anyway; the copy also stops a
// look-ahead from learning a colour that a pop would reveal). It never reads the deal.
const UNKNOWN = -9;
const asSeen = (board) => new Board(board.rows.map((row) => row.map((b) => (b !== null && b.m ? { ...b, c: UNKNOWN } : b))));

const STEP = 0.004; // radians between probes of the aim sweep
const NARROW = 0.004; // a result reached only through a window narrower than this is too fine to aim for
const AHEAD = 0.6; // weight of the best follow-up with the bubble that comes next
const AHEAD_OF = 6; // first shots that get a look-ahead

// What a shot does, reduced to a key: the landing cell, or the cells a Comet ploughs through.
function outcomeKey(board, shot, x, y, angle) {
  if (shot.k === KIND.COMET) return tracePierce(board, x, y, angle).cells.map(([r, c]) => r * 16 + c).join(',');
  const cell = traceShot(board, x, y, angle).cell;
  return cell === null ? null : cell[0] * 16 + cell[1];
}

// Every distinct result a shot can have from here, each with the widest run of angles that gives
// it: [{ key, lo, hi, angle }], `angle` in the middle of the run. `fine` refines the edges.
export function sweep(board, shot, x, y, { step = STEP, fine = true } = {}) {
  const pierce = shot.k === KIND.COMET;
  if (pierce) step = Math.max(step, 0.01);
  const lo0 = AIM_MIN;
  const n = Math.ceil(SPAN / step);
  const best = new Map();
  const close = (key, lo, hi) => {
    if (key === null || key === '') return;
    const had = best.get(key);
    if (!had || hi - lo > had.hi - had.lo) best.set(key, { key, lo, hi, angle: (lo + hi) / 2 });
  };
  let prevA = lo0;
  let prevKey = outcomeKey(board, shot, x, y, lo0);
  let start = lo0;
  for (let i = 1; i <= n; i++) {
    const a = lo0 + (SPAN * i) / n;
    const key = outcomeKey(board, shot, x, y, a);
    if (key !== prevKey) {
      let l = prevA;
      let h = a;
      if (fine) {
        for (let j = 0; j < (pierce ? 7 : 11); j++) {
          const m = (l + h) / 2;
          if (outcomeKey(board, shot, x, y, m) === prevKey) l = m;
          else h = m;
        }
      }
      close(prevKey, start, l);
      start = h;
      prevKey = key;
    }
    prevA = a;
  }
  close(prevKey, start, Math.PI - AIM_MIN);
  return [...best.values()];
}

// How good a result is: bubbles removed (dropped ones count double, as in the score), specials
// caught, a cleared level; less the danger of a board close to the fail row.
function judge(game, board, res, shot) {
  const lowest = board.lowestRow();
  if (lowest < 0) return 1000;
  const scroll = Math.min(game.scrollRow, Math.max(0, lowest - (VISIBLE_ROWS - 1)));
  const depth = lowest - scroll;
  if (depth >= FAIL_ROW) return -1000;
  let value = res.pops.length + 2 * res.drops.length + 6 * res.caught.length;
  if (value === 0 && res.placed) {
    // Nothing pops: park the bubble high up and next to its own colour.
    const { r, c } = res.placed;
    let friends = 0;
    forNeighbors(r, c, (nr, nc) => {
      const b = board.get(nr, nc);
      if (b && !b.m && b.c === shot.c) friends++;
    });
    value = -1 - 0.3 * (r - scroll) + 0.6 * friends;
  }
  if (depth >= FAIL_ROW - 1) value -= 500;
  else value -= 4 * Math.max(0, depth - (FAIL_ROW - 4));
  return value;
}

// Each result of firing `shot` at the seen board, judged: [{ ...run, value, board, res }].
function options(game, seen, shot, sweepOpts) {
  const { x, y } = game.origin;
  return sweep(seen, shot, x, y, sweepOpts).map((run) => {
    const board = seen.clone();
    const res = applyShot(board, shot, x, y, run.angle);
    return { ...run, value: judge(game, board, res, shot), board, res };
  });
}

// The best that the bubble after this one can do on the board this one leaves.
function followUp(game, first, next) {
  if (!next || first.value >= 1000 || first.value <= -1000) return 0;
  const after = { origin: game.origin, scrollRow: game.scrollRow };
  let best = -Infinity;
  for (const o of options(after, first.board, next, { step: 0.012, fine: false })) best = Math.max(best, o.value);
  return best === -Infinity ? 0 : best;
}

// What fires after `shot`, given what it caught. Specials go first, then the hand.
function nextAfter(game, swap, res) {
  if (game.specials.length) return game.specials[1] ?? (res.caught.length ? { k: res.caught[0], c: -1 } : game.hand[0]);
  if (res.caught.length) return { k: res.caught[0], c: -1 };
  return swap ? game.hand[0] : game.hand[1];
}

// Decides the next move: a boost ({ boost: 'comet' | 'clear' }) or a shot. A shot comes with what
// the autoplayer needs to aim it like a person: the window of angles that gives the same result,
// the runner-up (to glance at first when the call is close), and how clear-cut the choice was.
// boosts: false leaves the boosts alone, for when a press on one did not take.
export function expertPolicy(game, { boosts = true } = {}) {
  const seen = asSeen(game.board);
  const shots = game.specials.length
    ? [[game.active, false]]
    : game.hand[0].c === game.hand[1].c
      ? [[game.hand[0], false]]
      : [[game.hand[0], false], [game.hand[1], true]];

  let all = [];
  for (const [shot, swap] of shots) for (const o of options(game, seen, shot)) all.push({ ...o, swap, shot });
  const wide = all.filter((o) => o.hi - o.lo >= NARROW);
  if (wide.length) all = wide;
  all.sort((a, b) => b.value - a.value);
  for (const [i, o] of all.entries()) {
    o.total = i < AHEAD_OF ? o.value + AHEAD * followUp(game, o, nextAfter(game, o.swap, o.res)) : o.value;
  }
  all.sort((a, b) => b.total - a.total);
  const pick = all[0];

  // Boosts, as a careful player uses them. Gems are kept for the next Second Wind, except before
  // the first one: the game makes up the difference then, so spending them costs nothing.
  if (boosts && !game.specials.length) {
    const reserve = game.reviveGifted ? game.reviveCost : 0;
    const lowest = game.board.lowestRow();
    const crowded = lowest - game.scrollRow >= FAIL_ROW - 3;
    if (game.gems - GEMS.comet >= reserve) {
      const comet = options(game, seen, { k: KIND.COMET, c: -1 }).reduce((a, b) => (b.value > a.value ? b : a), { value: -Infinity });
      if (comet.value >= 1000 || comet.value >= 12 || (crowded && comet.value >= 5)) return { boost: 'comet' };
    }
    if (game.gems - GEMS.clear >= reserve && pick.value < 3 && game.hasMist()) {
      let misted = 0;
      const from = Math.max(lowest - 4, game.scrollRow - 1);
      game.board.each((r, c, b) => (misted += b.m && r >= from ? 1 : 0));
      if (misted >= 5) return { boost: 'clear' };
    }
  }

  const runnerUp = all.find((o) => o !== pick && Math.abs(o.angle - pick.angle) > 0.05);
  const gap = runnerUp ? pick.total - runnerUp.total : Infinity;
  const [r, c] = pick.shot.k === KIND.COMET ? [null, null] : [Math.floor(pick.key / 16), pick.key % 16];
  return {
    boost: null,
    swap: pick.swap,
    angle: pick.angle,
    lo: pick.lo,
    hi: pick.hi,
    cell: r === null ? null : [r, c],
    value: pick.value,
    removed: pick.res.pops.length + pick.res.drops.length,
    alt: runnerUp && gap < Math.max(1.5, 0.15 * Math.abs(pick.total)) ? { angle: runnerUp.angle } : null,
    gap,
  };
}

// Carries out a decision: buys the boost, or swaps if asked and fires. Returns what fire()
// returned, or null after a boost.
export function takeTurn(game, choice) {
  if (choice.boost === 'comet') return void game.buyComet(), null;
  if (choice.boost === 'clear') return void game.buyClear(), null;
  if (choice.swap) game.swap();
  return game.fire(choice.angle);
}
