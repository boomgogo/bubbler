// What a shot does to the board. `applyShot` changes the board it is given and returns a
// description of everything that happened, in a form the renderer can play back.
import { KIND, NOVA_RADIUS, SHOT_SPEED, TICK_MS } from '../config.js';
import { rowLen, forNeighbors, forCellsWithin } from './grid.js';
import { makeBubble } from './board.js';
import { traceShot, tracePierce } from './shot.js';

// Delays are in ticks (TICK_MS each) counted from the moment the shot lands.
export function applyShot(board, shot, ox, oy, angle) {
  const out = {
    fly: null, // { pts, len, cell, contactLen }
    placed: null, // { r, c, b } when the shot stays on the board
    pops: [], // { r, c, b, delay, cause } removed at single value
    blasts: [], // { type: 'row' | 'nova', r, c, delay } for effects
    reveals: [], // { r, c, id, delay } Mist lifted
    drops: [], // { r, c, b } cut loose
    caught: [], // kinds of specials that fell and return to the launcher
    lastDelay: 0,
  };
  const triggers = [];

  const remove = (r, c, delay, cause) => {
    const b = board.get(r, c);
    if (b === null) return;
    board.rows[r][c] = null;
    out.pops.push({ r, c, b, delay, cause });
    out.lastDelay = Math.max(out.lastDelay, delay);
    if (b.k === KIND.COMET) triggers.push({ type: 'row', r, c, delay: delay + 1 });
    else if (b.k === KIND.NOVA) triggers.push({ type: 'nova', r, c, delay: delay + 1 });
  };

  if (shot.k === KIND.COMET) {
    const fly = tracePierce(board, ox, oy, angle);
    out.fly = fly;
    const ticksPerUnit = 1000 / SHOT_SPEED / TICK_MS;
    for (const [r, c, len] of fly.cells) remove(r, c, (len - fly.contactLen) * ticksPerUnit, 'pierce');
  } else {
    const fly = traceShot(board, ox, oy, angle);
    out.fly = fly;
    if (fly.cell === null) return out;
    const [r, c] = fly.cell;
    if (shot.k === KIND.NOVA) {
      triggers.push({ type: 'nova', r, c, delay: 0 });
    } else {
      const b = makeBubble(KIND.COLOR, shot.c);
      board.set(r, c, b);
      out.placed = { r, c, b };
      const group = board.group(r, c);
      if (group.length >= 3) for (const [gr, gc, d] of group) remove(gr, gc, d, 'match');
      // Touching a Nova sets it off.
      forNeighbors(r, c, (nr, nc) => {
        if (board.get(nr, nc)?.k === KIND.NOVA) remove(nr, nc, 1, 'nova');
      });
    }
  }

  // Chain reactions. A popped Comet clears its row; a popped Nova clears a disc.
  const rowsCleared = new Set();
  while (triggers.length) {
    const t = triggers.shift();
    if (t.type === 'row') {
      if (rowsCleared.has(t.r)) continue;
      rowsCleared.add(t.r);
      out.blasts.push(t);
      for (let c = 0; c < rowLen(t.r); c++) {
        // Obsidian shrugs off a Comet's row sweep.
        if (board.get(t.r, c)?.k !== KIND.OBSIDIAN) remove(t.r, c, t.delay + Math.abs(c - t.c) * 0.6, 'row');
      }
    } else {
      out.blasts.push(t);
      forCellsWithin(t.r, t.c, NOVA_RADIUS, (r, c, d) => remove(r, c, t.delay + d, 'nova'));
    }
  }

  // A pop next to Mist lifts it.
  const revealed = new Set();
  for (const p of out.pops) {
    forNeighbors(p.r, p.c, (nr, nc) => {
      const b = board.get(nr, nc);
      if (b === null || !b.m || revealed.has(b.id)) return;
      revealed.add(b.id);
      board.rows[nr][nc] = { ...b, m: 0 };
      out.reveals.push({ r: nr, c: nc, id: b.id, delay: p.delay + 1 });
    });
  }

  // Whatever no longer hangs from the ceiling falls. Specials are caught, not lost.
  for (const [r, c] of board.floating()) {
    const b = board.rows[r][c];
    board.rows[r][c] = null;
    const caught = b.k === KIND.COMET || b.k === KIND.NOVA;
    if (caught) out.caught.push(b.k);
    out.drops.push({ r, c, b, caught });
  }
  return out;
}
