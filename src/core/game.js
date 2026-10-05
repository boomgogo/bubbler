// One run: levels, moves, score, gems and the bubbles in hand. Pure state and rules;
// every method that changes something returns a plain description of what changed.
import {
  COLS, ROW_H, VISIBLE_ROWS, FAIL_ROW, LAUNCH_Y, AIM_MIN, KIND, START_MOVES, MOVES_PER_LEVEL,
  POINTS_POP, POINTS_DROP, STREAK_STEP, STREAK_CAP, DROUGHT, GEMS,
} from '../config.js';
import { Board, makeBubble } from './board.js';
import { createRng, mixSeed } from './rng.js';
import { generateLevel } from './levelgen.js';
import { applyShot } from './rules.js';
import { traceShot, tracePierce } from './shot.js';

export const clampAim = (angle) => Math.min(Math.PI - AIM_MIN, Math.max(AIM_MIN, angle));

export class Game {
  constructor({ seed = (Math.random() * 2 ** 32) >>> 0 } = {}) {
    this.seed = seed >>> 0;
    this.deal = createRng(mixSeed(this.seed, 7919));
    this.level = 0;
    this.score = 0;
    this.moves = START_MOVES;
    this.gems = GEMS.start;
    this.streak = 0; // scoring shots in a row
    this.dry = 0; // shots in a row that removed nothing
    this.sinceDryGift = GEMS.dryCooldown;
    this.revives = 0;
    this.reviveGifted = false;
    this.specials = []; // caught or bought special shots, fired before the hand
    this.hand = [null, null];
    this.lastDealt = [];
    this.stats = { shots: 0, popped: 0, dropped: 0, best: 0 };
    this.phase = 'aim'; // aim | cleared | nomoves | over
    this.overReason = '';
    this.#startLevel(1);
    this.hand = [this.#dealBubble(), this.#dealBubble()];
  }

  #startLevel(level) {
    this.level = level;
    this.board = generateLevel(level, this.seed);
    this.levelRows = this.board.lowestRow() + 1;
    this.scrollRow = Math.max(0, this.levelRows - VISIBLE_ROWS);
    this.gifted = { lowMoves: false, crowd: false };
    this.phase = 'aim';
  }

  #dealBubble() {
    const colors = this.board.colors();
    if (!colors.length) return { k: KIND.COLOR, c: 0 };
    // A colour that has waited too long comes next; otherwise any colour on the board.
    let c = colors.find((col) => (this.lastDealt[col] ?? 0) >= DROUGHT);
    if (c === undefined) c = this.deal.pick(colors);
    for (const col of colors) this.lastDealt[col] = (this.lastDealt[col] ?? 0) + 1;
    this.lastDealt[c] = 0;
    return { k: KIND.COLOR, c };
  }

  // A bubble in hand whose colour has left the board would be a wasted move: swap its colour.
  #refreshHand() {
    const colors = this.board.colors();
    if (!colors.length) return false;
    let changed = false;
    this.hand = this.hand.map((b) => {
      if (colors.includes(b.c)) return b;
      changed = true;
      return { k: KIND.COLOR, c: this.deal.pick(colors) };
    });
    return changed;
  }

  get origin() {
    return { x: COLS / 2, y: this.scrollRow * ROW_H + LAUNCH_Y };
  }

  // The bubble the next shot fires.
  get active() {
    return this.specials[0] ?? this.hand[0];
  }

  get multiplier() {
    return this.level;
  }

  get reviveCost() {
    return GEMS.reviveBase + GEMS.reviveStep * this.revives;
  }

  // Rows of this level not yet cleared, for the progress rail.
  get rowsLeft() {
    return this.board.lowestRow() + 1;
  }

  hasMist() {
    let found = false;
    this.board.each((r, c, b) => (found ||= b.m === 1 && r >= this.scrollRow - 1));
    return found;
  }

  preview(angle) {
    const { x, y } = this.origin;
    const trace = this.active.k === KIND.COMET ? tracePierce : traceShot;
    return trace(this.board, x, y, clampAim(angle));
  }

  swap() {
    if (this.phase !== 'aim' || this.specials.length) return false;
    this.hand = [this.hand[1], this.hand[0]];
    return true;
  }

  fire(angle) {
    if (this.phase !== 'aim') return null;
    const shot = this.active;
    const special = this.specials.length > 0;
    const { x, y } = this.origin;
    const res = applyShot(this.board, shot, x, y, clampAim(angle));
    res.shot = shot;

    if (special) this.specials.shift();
    else {
      this.moves--;
      this.hand = [this.hand[1], this.#dealBubble()];
    }
    this.specials.push(...res.caught.map((k) => ({ k, c: -1 })));

    // Score: dropped bubbles count double, and a run of scoring shots builds a bonus.
    const popped = res.pops.length;
    const dropped = res.drops.length;
    const removed = popped + dropped;
    if (removed > 0) {
      this.streak++;
      this.dry = 0;
    } else {
      this.streak = 0;
      this.dry++;
    }
    const bonus = 1 + STREAK_STEP * Math.min(STREAK_CAP, Math.max(0, this.streak - 1));
    const points = Math.round((popped * POINTS_POP + dropped * POINTS_DROP) * this.multiplier * bonus);
    this.score += points;
    this.stats.shots++;
    this.stats.popped += popped;
    this.stats.dropped += dropped;
    this.stats.best = Math.max(this.stats.best, removed);
    this.sinceDryGift++;
    Object.assign(res, { popped, dropped, points, bonus, streak: this.streak, special, gifts: [] });

    const lowest = this.board.lowestRow();
    if (lowest < 0) {
      this.phase = 'cleared';
    } else {
      // The view only ever moves up the level, never back down.
      this.scrollRow = Math.min(this.scrollRow, Math.max(0, lowest - (VISIBLE_ROWS - 1)));
      const depth = lowest - this.scrollRow;
      res.recolored = this.#refreshHand();
      if (depth >= FAIL_ROW) {
        this.phase = 'over';
        this.overReason = 'overflow';
      } else {
        this.#giveHelp(res, depth);
        if (this.moves <= 0 && !this.specials.length) this.#outOfMoves(res);
      }
    }
    res.phase = this.phase;
    res.scrollRow = this.scrollRow;
    return res;
  }

  // Gems are never sold or earned by skill: the game hands them over when play is going badly.
  #giveHelp(res, depth) {
    const give = (amount, reason) => {
      this.gems += amount;
      res.gifts.push({ amount, reason });
    };
    if (this.dry >= GEMS.dryShots && this.sinceDryGift >= GEMS.dryCooldown) {
      this.sinceDryGift = 0;
      this.dry = 0;
      give(GEMS.dryGift, 'dry');
    }
    if (!this.gifted.lowMoves && this.moves > 0 && this.moves <= GEMS.lowMoves) {
      this.gifted.lowMoves = true;
      give(GEMS.lowMovesGift, 'moves');
    }
    if (!this.gifted.crowd && depth >= FAIL_ROW - GEMS.crowdRows) {
      this.gifted.crowd = true;
      give(GEMS.crowdGift, 'crowd');
    }
  }

  #outOfMoves(res) {
    this.phase = 'nomoves';
    if (this.gems < this.reviveCost && !this.reviveGifted) {
      this.reviveGifted = true;
      const amount = this.reviveCost - this.gems;
      this.gems += amount;
      res?.gifts.push({ amount, reason: 'revive' });
    }
  }

  // Second Wind: gems for more moves once they run out.
  revive() {
    if (this.phase !== 'nomoves' || this.gems < this.reviveCost) return false;
    this.gems -= this.reviveCost;
    this.revives++;
    this.moves += GEMS.reviveMoves;
    this.phase = 'aim';
    return true;
  }

  endRun() {
    if (this.phase === 'over') return;
    this.overReason = this.phase === 'nomoves' ? 'moves' : 'quit';
    this.phase = 'over';
  }

  // Comet boost: a piercing shot that costs gems instead of a move.
  buyComet() {
    if (this.phase !== 'aim' || this.gems < GEMS.comet) return false;
    this.gems -= GEMS.comet;
    this.specials.unshift({ k: KIND.COMET, c: -1 });
    return true;
  }

  // Clear Skies boost: lifts the Mist from every bubble in view. Returns what it revealed.
  buyClear() {
    if (this.phase !== 'aim' || this.gems < GEMS.clear || !this.hasMist()) return null;
    this.gems -= GEMS.clear;
    const reveals = [];
    this.board.each((r, c, b) => {
      if (!b.m || r < this.scrollRow - 1) return;
      this.board.rows[r][c] = { ...b, m: 0 };
      reveals.push({ r, c, id: b.id, delay: (r - this.scrollRow) * 0.7 });
    });
    this.#refreshHand();
    return reveals;
  }

  nextLevel() {
    if (this.phase !== 'cleared') return false;
    this.moves += MOVES_PER_LEVEL;
    this.#startLevel(this.level + 1);
    this.lastDealt = [];
    this.#refreshHand();
    return true;
  }

  serialize() {
    return {
      v: 1,
      seed: this.seed,
      deal: this.deal.state,
      level: this.level,
      score: this.score,
      moves: this.moves,
      gems: this.gems,
      streak: this.streak,
      dry: this.dry,
      sinceDryGift: this.sinceDryGift,
      revives: this.revives,
      reviveGifted: this.reviveGifted,
      specials: this.specials,
      hand: this.hand,
      lastDealt: this.lastDealt,
      stats: this.stats,
      phase: this.phase,
      scrollRow: this.scrollRow,
      levelRows: this.levelRows,
      gifted: this.gifted,
      rows: this.board.rows.map((row) => row.map((b) => (b === null ? 0 : [b.k, b.c, b.m]))),
    };
  }

  static load(data) {
    if (!data || data.v !== 1 || data.phase === 'over') return null;
    const game = new Game({ seed: data.seed });
    game.deal.state = data.deal;
    for (const key of [
      'level', 'score', 'moves', 'gems', 'streak', 'dry', 'sinceDryGift', 'revives', 'reviveGifted',
      'specials', 'hand', 'lastDealt', 'stats', 'phase', 'scrollRow', 'levelRows', 'gifted',
    ]) {
      game[key] = data[key];
    }
    game.board = new Board(data.rows.map((row) => row.map((b) => (b === 0 ? null : makeBubble(b[0], b[1], b[2])))));
    return game;
  }
}
