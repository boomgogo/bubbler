// The HTML layer over the canvas: score, moves, gems, boosts and the cards between phases.
import { COLS, GEMS, MOVES_PER_LEVEL } from '../config.js';
import { TOP_Y } from '../render/layout.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const gemsHtml = (n) => `<i class="gem"></i>${n}`;

const HINT_MIN = 2.5; // seconds a line stays up before a waiting one may replace it
const HINT_GAP = 0.35; // the old line fades out before the next fades in

const GIFT_TEXT = {
  dry: 'A gem, to get you going again',
  moves: 'Running low on moves: gems for you',
  crowd: 'Getting crowded: a gem for you',
};

export class Hud {
  constructor(on) {
    this.shown = 0; // the score currently displayed, which chases the real one
    this.target = 0;
    this.toastTimer = 0;
    this.hints = []; // lines waiting their turn
    this.line = null; // the line on show, with its age in seconds
    this.hintGap = 0;
    const click = (id, fn) => $(id).addEventListener('click', fn);
    click('btn-pause', on.pause);
    click('btn-resume', on.resume);
    click('btn-restart', on.restart);
    click('btn-sound', on.toggleSound);
    click('btn-music', on.toggleMusic);
    click('boost-comet', on.comet);
    click('boost-clear', on.clear);
    click('btn-revive', on.revive);
    click('btn-end', on.end);
    click('btn-again', on.again);
    click('btn-play', on.play);
    click('btn-new', on.newRun);
    $('quality').addEventListener('click', (e) => e.target.dataset.q && on.quality(e.target.dataset.q));
    $('skip').textContent = matchMedia('(pointer: coarse)').matches ? 'Tap to skip' : 'Click to skip';
    $('boost-comet').querySelector('span').innerHTML = gemsHtml(GEMS.comet);
    $('boost-clear').querySelector('span').innerHTML = gemsHtml(GEMS.clear);
  }

  // Height of the score bar in pixels, including any notch.
  get topPx() {
    return parseFloat(getComputedStyle($('topbar')).height) || 56;
  }

  // Lines the HTML up with the 3D field.
  layout(frame) {
    const style = document.documentElement.style;
    style.setProperty('--u', frame.unit + 'px');
    style.setProperty('--fx', (-COLS / 2 - frame.left) * frame.unit + 'px');
    style.setProperty('--fy', (frame.top - TOP_Y) * frame.unit + 'px');
  }

  // The title screen starts life as the loading screen.
  ready(saved) {
    $('bar').hidden = true;
    $('boot-msg').hidden = true;
    const play = $('btn-play');
    play.hidden = false;
    play.textContent = saved ? `Continue · level ${saved.level}` : 'Play';
    $('btn-new').hidden = !saved;
    play.focus({ preventScroll: true });
  }

  bootError(message) {
    $('bar').hidden = true;
    $('boot-msg').textContent = message;
  }

  show(id, visible = true) {
    const el = $(id);
    if (visible) {
      el.hidden = false;
      void el.offsetWidth; // let the fade-in start from the hidden state
      el.classList.remove('out');
    } else {
      el.classList.add('out');
      setTimeout(() => el.classList.contains('out') && (el.hidden = true), 320);
    }
  }

  startGame() {
    this.show('title', false);
    $('hud').classList.remove('off');
  }

  update(game) {
    this.target = game.score;
    $('level').lastChild.textContent = game.level;
    const moves = $('moves');
    moves.firstChild.textContent = game.moves;
    moves.classList.toggle('low', game.moves <= GEMS.lowMoves);
    $('gems').lastChild.textContent = game.gems;
    const aiming = game.phase === 'aim';
    $('boost-comet').disabled = !aiming || game.gems < GEMS.comet || game.specials.length > 0;
    $('boost-clear').disabled = !aiming || game.gems < GEMS.clear || !game.hasMist();
    $('progress').firstChild.style.width = Math.round(100 * (1 - game.rowsLeft / game.levelRows)) + '%';
  }

  snapScore(score) {
    this.shown = this.target = score;
    $('score').textContent = fmt(score);
  }

  frame(dt) {
    this.#hintFrame(dt);
    if (this.shown === this.target) return;
    const gap = this.target - this.shown;
    this.shown = Math.abs(gap) < 1 ? this.target : this.shown + gap * (1 - Math.exp(-dt * 7));
    $('score').textContent = fmt(this.shown);
  }

  // A number that floats up from where the points were won.
  tally(x, y, points, note, size = 1) {
    const el = document.createElement('div');
    el.className = 'tally';
    el.style.cssText = `left:${x}px;top:${y}px;font-size:${Math.round(20 * size)}px`;
    el.textContent = '+' + fmt(points);
    if (note) el.insertAdjacentHTML('beforeend', `<small>${note}</small>`);
    $('tallies').append(el);
    el.addEventListener('animationend', () => el.remove());
  }

  toast(text, seconds = 2.4) {
    const el = $('toast');
    el.innerHTML = text;
    el.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('on'), seconds * 1000);
  }

  // The line under the board. Lines wait their turn on the game's clock, so pausing holds them.
  // An empty text clears the controls hints; a line that teaches a special is never cut short.
  hint(text, seconds = 5, { teach = false, onShow } = {}) {
    if (text) {
      this.hints.push({ text, seconds, teach, onShow });
      return;
    }
    this.hints = this.hints.filter((h) => h.teach);
    if (this.line && !this.line.teach) this.line.seconds = 0;
  }

  // Forgets the lines still waiting; the one on show finishes. Returns how many were dropped.
  dropHints() {
    const n = this.hints.length;
    this.hints = [];
    return n;
  }

  #hintFrame(dt) {
    const line = this.line;
    if (line) {
      line.age += dt;
      if (line.age < line.seconds && !(this.hints.length && line.age >= HINT_MIN)) return;
      $('hint').classList.remove('on');
      this.line = null;
      this.hintGap = HINT_GAP;
      return;
    }
    if ((this.hintGap -= dt) > 0 || !this.hints.length) return;
    this.line = { ...this.hints.shift(), age: 0 };
    const el = $('hint');
    el.textContent = this.line.text;
    el.classList.add('on');
    this.line.onShow?.();
  }

  // During the level fly-over only the hint line and a skip note are on screen.
  fly(on) {
    $('hud').classList.toggle('fly', on);
  }

  // A curtain over the scene, in the colour of the place it hides, while the place changes.
  veil(on, color) {
    const el = $('veil');
    if (color) el.style.background = color;
    el.classList.toggle('on', on);
  }

  theme(color) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }

  gift({ amount, reason }) {
    const gems = $('gems');
    gems.classList.remove('gift');
    void gems.offsetWidth;
    gems.classList.add('gift');
    if (GIFT_TEXT[reason]) this.toast(`${gemsHtml('+' + amount)} &nbsp;${GIFT_TEXT[reason]}`, 3.2);
  }

  // placeName: where the next level is played, when that changes.
  cleared(level, show, placeName = null) {
    $('cleared-level').textContent = level + 1;
    $('cleared-kicker').textContent = `Level ${level} cleared · next`;
    $('cleared-reward').textContent = `+${MOVES_PER_LEVEL} moves · points ×${level + 1}`;
    if (show) {
      $('cleared-place').hidden = !placeName;
      $('cleared-place').textContent = placeName ? `On to ${placeName}` : '';
    }
    this.show('cleared', show);
  }

  revive(game, gift) {
    const note = $('revive-gift');
    note.hidden = !gift;
    if (gift) note.innerHTML = `You were short, so here ${gift.amount === 1 ? 'is' : 'are'} ${gemsHtml(gift.amount)}.`;
    const button = $('btn-revive');
    button.innerHTML = `Second Wind &nbsp;${gemsHtml(game.reviveCost)}`;
    button.disabled = game.gems < game.reviveCost;
    this.show('revive');
  }

  over(game, best, isBest) {
    $('over-kicker').textContent = isBest ? 'New best' : game.overReason === 'overflow' ? 'The bubbles reached the launcher' : 'Run over';
    $('over-score').textContent = fmt(game.score);
    $('over-best').textContent = fmt(best);
    $('over-level').textContent = game.level;
    $('over-shots').textContent = fmt(game.stats.shots);
    $('over-big').textContent = `${game.stats.best} bubbles`;
    this.show('over');
  }

  settings({ sound, music, quality }) {
    $('btn-sound').textContent = sound ? 'Sound on' : 'Sound off';
    $('btn-music').textContent = music ? 'Music on' : 'Music off';
    for (const b of $('quality').children) b.classList.toggle('on', b.dataset.q === quality);
  }

  debug(text) {
    let el = $('debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'debug';
      document.body.append(el);
    }
    el.textContent = text;
  }
}
