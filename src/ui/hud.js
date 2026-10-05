// The HTML layer over the canvas: score, moves, gems, boosts and the cards between phases.
import { COLS, GEMS, MOVES_PER_LEVEL } from '../config.js';
import { TOP_Y } from '../render/layout.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const gemsHtml = (n) => `<i class="gem"></i>${n}`;

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
    this.hintTimer = 0;
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

  hint(text, seconds = 5) {
    const el = $('hint');
    el.textContent = text;
    el.classList.toggle('on', !!text);
    clearTimeout(this.hintTimer);
    if (text) this.hintTimer = setTimeout(() => el.classList.remove('on'), seconds * 1000);
  }

  gift({ amount, reason }) {
    const gems = $('gems');
    gems.classList.remove('gift');
    void gems.offsetWidth;
    gems.classList.add('gift');
    if (GIFT_TEXT[reason]) this.toast(`${gemsHtml('+' + amount)} &nbsp;${GIFT_TEXT[reason]}`, 3.2);
  }

  cleared(level, show) {
    $('cleared-level').textContent = level + 1;
    $('cleared-kicker').textContent = `Level ${level} cleared · next`;
    $('cleared-reward').textContent = `+${MOVES_PER_LEVEL} moves · points ×${level + 1}`;
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
