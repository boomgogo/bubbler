// The bubbles of one level. A bubble is { id, k, c, m }: kind, colour index (-1 for none)
// and whether Mist hides it. Bubbles are never mutated in place, so a clone can share them.
import { KIND } from '../config.js';
import { rowLen, forNeighbors, cellKey } from './grid.js';

let nextId = 1;
export const makeBubble = (k, c = -1, m = 0) => ({ id: nextId++, k, c, m });

const matches = (b, color) =>
  b !== null && b.m === 0 && b.c === color && (b.k === KIND.COLOR || b.k === KIND.COMET);

export class Board {
  constructor(rows = []) {
    this.rows = rows;
  }

  get(r, c) {
    const row = this.rows[r];
    return row === undefined ? null : (row[c] ?? null);
  }

  set(r, c, b) {
    while (this.rows.length <= r) this.rows.push(new Array(rowLen(this.rows.length)).fill(null));
    this.rows[r][c] = b;
  }

  clone() {
    return new Board(this.rows.map((row) => row.slice()));
  }

  each(fn) {
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r];
      for (let c = 0; c < row.length; c++) if (row[c] !== null) fn(r, c, row[c]);
    }
  }

  count() {
    let n = 0;
    this.each(() => n++);
    return n;
  }

  // Index of the lowest row holding a bubble, or -1 when the board is empty.
  lowestRow() {
    for (let r = this.rows.length - 1; r >= 0; r--) {
      if (this.rows[r].some((b) => b !== null)) return r;
    }
    return -1;
  }

  // Same-colour bubbles connected to (r, c), as [r, c, steps from the start].
  group(r, c) {
    const start = this.get(r, c);
    if (start === null || !matches(start, start.c)) return [];
    const seen = new Set([cellKey(r, c)]);
    const out = [[r, c, 0]];
    for (let i = 0; i < out.length; i++) {
      const [cr, cc, d] = out[i];
      forNeighbors(cr, cc, (nr, nc) => {
        const key = cellKey(nr, nc);
        if (seen.has(key) || !matches(this.get(nr, nc), start.c)) return;
        seen.add(key);
        out.push([nr, nc, d + 1]);
      });
    }
    return out;
  }

  // Bubbles no longer attached to the ceiling, as [r, c].
  floating() {
    const held = new Set();
    const stack = [];
    const top = this.rows[0] ?? [];
    for (let c = 0; c < top.length; c++) {
      if (top[c] !== null) {
        held.add(cellKey(0, c));
        stack.push([0, c]);
      }
    }
    while (stack.length) {
      const [r, c] = stack.pop();
      forNeighbors(r, c, (nr, nc) => {
        const key = cellKey(nr, nc);
        if (held.has(key) || this.get(nr, nc) === null) return;
        held.add(key);
        stack.push([nr, nc]);
      });
    }
    const out = [];
    this.each((r, c) => {
      if (!held.has(cellKey(r, c))) out.push([r, c]);
    });
    return out;
  }

  // Colours a shot could match. Hidden colours only count when nothing else is left.
  colors() {
    const seen = new Set();
    const hidden = new Set();
    this.each((r, c, b) => {
      if (b.c < 0) return;
      (b.m ? hidden : seen).add(b.c);
    });
    return [...(seen.size ? seen : hidden)].sort();
  }
}
