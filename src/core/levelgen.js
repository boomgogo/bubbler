// Builds a level from a seed. The same level number and seed always give the same board.
import { KIND, levelParams } from '../config.js';
import { rowLen, forNeighbors, hexDist, cellKey } from './grid.js';
import { Board, makeBubble } from './board.js';
import { createRng, mixSeed } from './rng.js';

export function generateLevel(level, seed) {
  const rng = createRng(mixSeed(seed, level));
  const P = levelParams(level);
  const u = rng.next();
  const rowCount = Math.max(7, Math.round(P.rows * (1 + P.rowSpread * (0.6 * u * u - 0.15))));

  // 1. Start full, then carve small holes. Row 0 stays whole so everything has an anchor.
  const filled = new Set();
  for (let r = 0; r < rowCount; r++) for (let c = 0; c < rowLen(r); c++) filled.add(cellKey(r, c));
  const total = filled.size;
  const at = (r, c) => filled.has(cellKey(r, c));
  let toCarve = Math.round(P.empty * total);
  for (let guard = 0; toCarve > 0 && guard < 500; guard++) {
    let r = 1 + rng.int(rowCount - 1);
    let c = rng.int(rowLen(r));
    for (let n = 1 + rng.int(4); n > 0 && toCarve > 0; n--) {
      if (r > 0 && at(r, c)) {
        filled.delete(cellKey(r, c));
        toCarve--;
      }
      const next = [];
      forNeighbors(r, c, (nr, nc) => nr > 0 && nr < rowCount && next.push([nr, nc]));
      if (!next.length) break;
      [r, c] = rng.pick(next);
    }
  }

  // 2. Paint colour patches: grow each one outwards from a seed cell to a random size.
  const color = new Map();
  const cells = [];
  for (let r = 0; r < rowCount; r++) for (let c = 0; c < rowLen(r); c++) if (at(r, c)) cells.push([r, c]);
  rng.shuffle(cells);
  for (const [sr, sc] of cells) {
    if (color.has(cellKey(sr, sc))) continue;
    // Prefer a colour no painted neighbour has, so patches stay the size we asked for.
    const taken = new Set();
    forNeighbors(sr, sc, (nr, nc) => color.has(cellKey(nr, nc)) && taken.add(color.get(cellKey(nr, nc))));
    const free = [];
    for (let k = 0; k < P.colors; k++) if (!taken.has(k)) free.push(k);
    const col = free.length ? rng.pick(free) : rng.int(P.colors);
    let size = 1;
    while (size < 9 && rng.next() > 1 / P.patch) size++;
    const patch = [[sr, sc]];
    color.set(cellKey(sr, sc), col);
    while (patch.length < size) {
      const open = [];
      for (const [pr, pc] of patch) {
        forNeighbors(pr, pc, (nr, nc) => {
          if (nr < rowCount && at(nr, nc) && !color.has(cellKey(nr, nc))) open.push([nr, nc]);
        });
      }
      if (!open.length) break;
      const [nr, nc] = rng.pick(open);
      color.set(cellKey(nr, nc), col);
      patch.push([nr, nc]);
    }
  }

  const board = new Board();
  for (const [r, c] of cells) board.set(r, c, makeBubble(KIND.COLOR, color.get(cellKey(r, c))));
  // Holes can cut bubbles off from the ceiling; those would fall at once, so drop them now.
  for (const [r, c] of board.floating()) board.rows[r][c] = null;

  const plain = () => {
    const list = [];
    board.each((r, c, b) => b.k === KIND.COLOR && !b.m && list.push([r, c]));
    return rng.shuffle(list);
  };
  const count = board.count();

  // 3. Obsidian, at most three to a row so it can never wall a level off.
  const perRow = new Map();
  let want = Math.round(P.obsidian * count);
  for (const [r, c] of plain()) {
    if (want <= 0) break;
    if (r === 0 || (perRow.get(r) ?? 0) >= 3) continue;
    board.rows[r][c] = makeBubble(KIND.OBSIDIAN);
    perRow.set(r, (perRow.get(r) ?? 0) + 1);
    want--;
  }

  // 4. Mist in drifts. The bottom row stays clear so there is always something to aim at.
  const bottom = board.lowestRow();
  want = Math.round(P.mist * count);
  for (const [sr, sc] of plain()) {
    if (want <= 0) break;
    let drift = [[sr, sc]];
    for (let n = 4 + rng.int(10); n > 0 && want > 0 && drift.length; n--) {
      const [r, c] = drift.splice(rng.int(drift.length), 1)[0];
      const b = board.get(r, c);
      if (b === null || b.k !== KIND.COLOR || b.m || r >= bottom) continue;
      board.rows[r][c] = { ...b, m: 1 };
      want--;
      forNeighbors(r, c, (nr, nc) => drift.push([nr, nc]));
    }
  }

  // 5. Specials. One Comet always sits in the top row, so a level can end on an avalanche.
  const topRow = plain().filter(([r]) => r === 0);
  const pool = topRow.length ? topRow : [[0, rng.int(rowLen(0))]];
  const [, tc] = pool[0];
  const under = board.get(0, tc);
  board.rows[0][tc] = makeBubble(KIND.COMET, under?.c >= 0 ? under.c : rng.int(P.colors));

  want = Math.round(P.comets * count);
  for (const [r, c] of plain()) {
    if (want <= 0) break;
    if (r === 0) continue;
    board.rows[r][c] = makeBubble(KIND.COMET, board.get(r, c).c);
    want--;
  }
  const novas = [];
  want = Math.round(P.novas * count);
  for (const [r, c] of plain()) {
    if (want <= 0) break;
    if (r < 2 || novas.some(([nr, nc]) => hexDist(r, c, nr, nc) < 4)) continue;
    board.rows[r][c] = makeBubble(KIND.NOVA);
    novas.push([r, c]);
    want--;
  }

  return board;
}
