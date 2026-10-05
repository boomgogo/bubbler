// The first time a special is on screen, one line under the board says what it does.
// Each is explained once per device; the pause menu keeps the full list.
import { FAIL_ROW } from '../config.js';
import { specialName } from '../core/board.js';
import { store } from '../platform/storage.js';

export const LINES = {
  comet: 'Pop the ringed Comet to clear its row',
  mist: 'Pop beside Mist to reveal its colour',
  nova: 'Touch the white Nova and it bursts',
  obsidian: "Black Obsidian can't match. Cut it loose",
};

export class Teacher {
  constructor() {
    this.taught = new Set(store.get('taught', []));
    this.waiting = new Set(); // queued on the hint line, not yet shown
  }

  isNew(name) {
    return name in LINES && !this.taught.has(name) && !this.waiting.has(name);
  }

  // Where a kind is now: [r, c] on screen, 'hand' in the launcher, or null.
  where(game, name) {
    const cell = game.board.firstOfKinds(game.scrollRow, game.scrollRow + FAIL_ROW - 1)[name];
    if (cell) return cell;
    return specialName(game.active) === name ? 'hand' : null;
  }

  // Kinds on screen or in hand that have not been explained yet.
  fresh(game) {
    return Object.keys(LINES).filter((name) => this.isNew(name) && this.where(game, name));
  }

  // Queued on the hint line: not offered again while it waits.
  wait(name) {
    this.waiting.add(name);
  }

  mark(name) {
    this.waiting.delete(name);
    this.taught.add(name);
    store.set('taught', [...this.taught]);
  }
}
