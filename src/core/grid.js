// Geometry of the offset hex grid. Row 0 is the ceiling; y grows downwards.
// One unit is one bubble diameter.
import { COLS, ROW_H } from '../config.js';

export const rowLen = (r) => (r & 1 ? COLS - 1 : COLS);
export const cellX = (r, c) => c + 0.5 + 0.5 * (r & 1);
export const cellY = (r) => r * ROW_H + 0.5;
export const inGrid = (r, c) => r >= 0 && c >= 0 && c < rowLen(r);
export const cellKey = (r, c) => r * 16 + c;

// Neighbour offsets in a fixed order: E, W, NE, NW, SE, SW (N is towards the ceiling).
// The renderer relies on this order for neighbour reflections.
export function neighbor(r, c, i) {
  const p = r & 1;
  switch (i) {
    case 0: return [r, c + 1];
    case 1: return [r, c - 1];
    case 2: return [r - 1, c + p];
    case 3: return [r - 1, c + p - 1];
    case 4: return [r + 1, c + p];
    default: return [r + 1, c + p - 1];
  }
}

export function forNeighbors(r, c, fn) {
  for (let i = 0; i < 6; i++) {
    const [nr, nc] = neighbor(r, c, i);
    if (inGrid(nr, nc)) fn(nr, nc, i);
  }
}

// Steps between two cells.
export function hexDist(r1, c1, r2, c2) {
  const dq = c1 - (r1 >> 1) - (c2 - (r2 >> 1));
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function forCellsWithin(r, c, radius, fn) {
  for (let rr = Math.max(0, r - radius); rr <= r + radius; rr++) {
    for (let cc = 0; cc < rowLen(rr); cc++) {
      const d = hexDist(r, c, rr, cc);
      if (d <= radius) fn(rr, cc, d);
    }
  }
}
