// Where a shot goes. Positions are in board space: x across, y down from the ceiling.
import { COLS, ROW_H, CONTACT, PIERCE_LEN, PIERCE_R, KIND } from '../config.js';
import { rowLen, cellX, cellY, forNeighbors } from './grid.js';

const WALL_L = 0.5;
const WALL_R = COLS - 0.5;
const CEILING = 0.5;
const MAX_BOUNCES = 12;

// Nearest free cell to (x, y) that a bubble can hang from.
export function snapCell(board, x, y) {
  const r0 = Math.max(0, Math.round((y - 0.5) / ROW_H));
  let best = null;
  let bestD = Infinity;
  for (let r = Math.max(0, r0 - 2); r <= r0 + 2; r++) {
    for (let c = 0; c < rowLen(r); c++) {
      if (board.get(r, c) !== null) continue;
      const dx = cellX(r, c) - x;
      const dy = cellY(r) - y;
      const d = dx * dx + dy * dy;
      if (d >= bestD) continue;
      let held = r === 0;
      if (!held) forNeighbors(r, c, (nr, nc) => (held ||= board.get(nr, nc) !== null));
      if (held) {
        best = [r, c];
        bestD = d;
      }
    }
  }
  return best;
}

// Flies a bubble from (ox, oy) at `angle` (radians above horizontal, 90 degrees is straight up)
// until it touches a bubble or the ceiling. Returns the path and the cell it settles in.
export function traceShot(board, ox, oy, angle) {
  let px = ox;
  let py = oy;
  let dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const pts = [px, py];
  let len = 0;
  const R2 = CONTACT * CONTACT;

  for (let bounce = 0; bounce <= MAX_BOUNCES; bounce++) {
    const tWall = dx > 1e-9 ? (WALL_R - px) / dx : dx < -1e-9 ? (WALL_L - px) / dx : Infinity;
    const tCeil = (CEILING - py) / dy;
    let t = Math.min(tWall, tCeil);

    // Earliest bubble the segment touches.
    const yEnd = py + dy * t;
    const rTop = Math.max(0, Math.floor((yEnd - 0.5) / ROW_H) - 1);
    const rBot = Math.min(board.rows.length - 1, Math.ceil((py - 0.5) / ROW_H) + 1);
    let hit = false;
    for (let r = rTop; r <= rBot; r++) {
      const row = board.rows[r];
      const cy = cellY(r);
      for (let c = 0; c < row.length; c++) {
        if (row[c] === null) continue;
        const ocx = px - cellX(r, c);
        const ocy = py - cy;
        const b = ocx * dx + ocy * dy;
        if (b >= 0) continue;
        const disc = b * b - (ocx * ocx + ocy * ocy - R2);
        if (disc < 0) continue;
        const th = Math.max(0, -b - Math.sqrt(disc));
        if (th < t) {
          t = th;
          hit = true;
        }
      }
    }

    px += dx * t;
    py += dy * t;
    len += t;
    pts.push(px, py);
    if (hit || t === tCeil) break;
    dx = -dx;
  }

  return { pts, len, x: px, y: py, cell: snapCell(board, px, py) };
}

// A Comet shot does not stick: from its first contact it ploughs on for PIERCE_LEN,
// taking every bubble it brushes. Returns the cells in the order it reaches them.
export function tracePierce(board, ox, oy, angle) {
  const STEP = 0.08;
  let px = ox;
  let py = oy;
  let dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const pts = [px, py];
  const cells = [];
  const seen = new Set();
  let len = 0;
  let contactLen = -1;
  const R2 = PIERCE_R * PIERCE_R;

  while (py > -1 && len < 80) {
    px += dx * STEP;
    py += dy * STEP;
    len += STEP;
    if (px < WALL_L || px > WALL_R) {
      px = px < WALL_L ? 2 * WALL_L - px : 2 * WALL_R - px;
      dx = -dx;
      pts.push(px, py);
    }
    const r0 = Math.round((py - 0.5) / ROW_H);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(board.rows.length - 1, r0 + 1); r++) {
      const row = board.rows[r];
      const ddy = cellY(r) - py;
      for (let c = 0; c < row.length; c++) {
        if (row[c] === null) continue;
        const ddx = cellX(r, c) - px;
        if (ddx * ddx + ddy * ddy > R2) continue;
        const key = r * 16 + c;
        if (seen.has(key)) continue;
        seen.add(key);
        if (contactLen < 0) contactLen = len;
        cells.push([r, c, len]);
      }
    }
    if (contactLen >= 0 && len - contactLen >= PIERCE_LEN) break;
  }
  pts.push(px, py);
  return { pts, len, x: px, y: py, cells, contactLen: contactLen < 0 ? len : contactLen, cell: null };
}

export const isPiercing = (shot) => shot.k === KIND.COMET;
