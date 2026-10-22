// The controller: takes input, asks the rules what happened, and plays the result back
// through the view, the HUD and the sound. It can also play back another player's game, as their
// page reports it, while this player's own run waits (src/net/race.js drives that).
import { Game, clampAim } from './core/game.js';
import { applyShot } from './core/rules.js';
import { specialName } from './core/board.js';
import { KIND, SHOT_SPEED, TICK_MS, FAIL_ROW, COLS, LEVELS_PER_PLACE, placeOf } from './config.js';
import { cellX, cellY } from './core/grid.js';
import { View, lookOf } from './render/view.js';
import { guessTier } from './render/renderer.js';
import { colorOf } from './render/fx.js';
import { LAUNCH_WORLD_Y } from './render/layout.js';
import { lake, loadPlace } from './render/places/index.js';
import { Hud } from './ui/hud.js';
import { Teacher, LINES } from './ui/teach.js';
import { Audio } from './audio/audio.js';
import { store } from './platform/storage.js';
import { bindInput } from './platform/input.js';

const TICK = TICK_MS / 1000;

// A short hash (FNV-1a), for comparing what different pages hold.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function start() {
  const settings = { sound: true, music: true, quality: 'auto', ...store.get('settings', {}) };
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  // Debug only: a fixed seed, a starting level, and a place that overrides the level's.
  const debugSeed = debug && params.has('seed') ? Number(params.get('seed')) : null;
  let debugPlace = debug ? params.get('place') : null;
  const canvas = document.getElementById('scene');
  const audio = new Audio(settings);
  audio.setScore(lake.music);
  const teacher = new Teacher();

  let game = null;
  let playing = false; // false while the title screen is up
  let paused = false;
  let locked = true; // input is ignored while a shot resolves
  let aiming = false;
  let angle = Math.PI / 2;
  let catching = 0; // specials still on their way back to the launcher
  let shotsSeen = store.get('shots', 0);
  let timers = []; // { at, fn } on the view's clock, so pausing freezes them too
  let raf = 0;
  let last = 0;
  let frozen = null; // debug: the view's clock pinned for screenshots
  let place = lake; // the place on screen
  const ready = new Map(); // places built and compiled, waiting to be shown: id -> { place, group }
  const preparing = new Set();
  let swapQueue = null; // while the veil is down for a change of place: what to do once it lifts
  const swapping = () => swapQueue !== null;
  let controlsShown = false;
  let warm = false; // the title screen can take a tap
  let title = null; // what the title screen's Play says while a race has its own words for it
  let save = soloSave; // where the run on screen is kept: the solo run, or a race's
  let held = false; // a sheet over the game takes input, as pausing does, while the game plays on
  // Another player's game on show: this player's own waits in `own`, exactly as it was left.
  let watching = false;
  let own = null;
  let steps = []; // what the player on show did, waiting its turn to be played back
  let playingBack = false; // one of those steps is on screen now
  let stepNo = 0;
  const hooks = {}; // the race module listens here: change, aim, over, frame, back, ...
  const emit = (name, ...args) => hooks[name]?.(...args);
  const canPlay = () => playing && !paused && !held && !watching;

  const hud = new Hud({
    play: () => begin(),
    newRun: () => {
      store.remove('run');
      newGame(null);
      begin();
    },
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    restart: () => {
      store.remove('run');
      newGame(null);
      startLevel(true, { slide: false });
      setPaused(false);
    },
    friends: () => emit('friends'),
    toggleSound: () => saveSettings({ sound: !settings.sound }),
    toggleMusic: () => saveSettings({ music: !settings.music }),
    quality: (quality) => saveSettings({ quality }),
    comet: () => {
      if (locked || !canPlay() || !game.buyComet()) return;
      audio.gem();
      showHand('special');
      afterChange();
      emit('change', 'comet');
    },
    clear: () => {
      if (locked || !canPlay()) return;
      const reveals = game.buyClear();
      if (!reveals) return;
      showClear(reveals);
      emit('change', 'clear');
    },
    revive: () => {
      if (watching || !game.revive()) return;
      hud.show('revive', false);
      audio.gem();
      locked = false;
      afterChange();
      emit('change', 'revive');
    },
    end: () => {
      if (watching) return;
      hud.show('revive', false);
      game.endRun();
      emit('change', 'end');
      gameOver();
    },
    again: () => {
      hud.show('over', false);
      newGame(null);
      startLevel(true, { slide: false });
    },
  });

  let view;
  try {
    view = new View(canvas, {
      tier: settings.quality === 'auto' ? guessTier() : settings.quality,
      locked: settings.quality !== 'auto',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      topPx: hud.topPx,
      onLayout: (frame) => hud.layout(frame),
    });
  } catch (error) {
    console.error(error);
    hud.bootError('This browser cannot start WebGL 2, which Bubbler needs.');
    return;
  }
  hud.settings(settings);

  const after = (seconds, fn) => timers.push({ at: view.time + seconds, fn });

  function saveSettings(change) {
    Object.assign(settings, change);
    store.set('settings', settings);
    audio.setSound(settings.sound);
    audio.setMusic(settings.music);
    if ('quality' in change) {
      if (settings.quality === 'auto') {
        view.quality.locked = false;
        view.quality.ceiling = 'high';
      } else view.quality.setTier(settings.quality, true);
    }
    hud.settings(settings);
    audio.click();
  }

  // The solo run is kept until it ends; one that is over starts afresh next time.
  function soloSave(g) {
    if (g.phase === 'over') store.remove('run');
    else store.set('run', g.serialize());
  }

  // What the launcher shows. A caught special appears only once it has arrived.
  function showHand(mode) {
    const ready = game.specials.slice(0, game.specials.length - catching);
    const active = ready[0] ?? game.hand[0];
    const next = ready.length ? game.hand[0] : game.hand[1];
    view.setHand(lookOf(active), lookOf(next), mode);
  }

  function showAim() {
    const on = aiming && !locked && playing && game.phase === 'aim';
    if (!watching) emit('aim', on ? clampAim(angle) : null);
    if (!on) return view.setAim(null);
    view.setAim(game.preview(angle), lookOf(game.active), clampAim(angle));
  }

  function showDanger() {
    const depth = game.board.lowestRow() - game.scrollRow;
    view.stage.setDanger(Math.min(1, Math.max(0, (depth - (FAIL_ROW - 5)) / 4)));
  }

  function showClear(reveals) {
    view.sync(game.board, game.scrollRow);
    for (const r of reveals) view.liftMist(r.id, r.delay * 0.08);
    audio.reveal();
    showHand('set');
    afterChange();
  }

  function afterChange() {
    hud.update(game);
    showAim();
    showDanger();
    if (!watching) save(game);
  }

  function newGame(saved) {
    const g = saved ?? new Game(debugSeed === null ? undefined : { seed: debugSeed });
    if (g.phase === 'cleared') g.nextLevel(); // the tab was closed on the level card
    setGame(g);
  }

  // Puts a game on screen as it stands, with nothing in flight.
  function setGame(g) {
    game = g;
    timers = [];
    catching = 0;
    swapQueue = null;
    forgetHints();
    hud.veil(false);
    hud.fly(false);
    view.stopFlight();
    view.dying.length = view.falling.length = 0;
    view.flying = null;
    view.sync(game.board, game.scrollRow);
    view.setScroll(game.scrollRow, { intro: true });
    showHand('set');
    hud.snapScore(game.score);
    afterChange();
  }

  function begin() {
    audio.unlock();
    hud.startGame();
    playing = true;
    emit('playing');
    prefetch();
    if (game.stats.shots === 0 && game.phase === 'aim') startLevel(true, { slide: false }); // a new run: fly over it
    else carryOn();
  }

  // Carries on with a run already under way: the card it is waiting on, if any, or play.
  function carryOn() {
    if (game.phase === 'nomoves') {
      locked = true;
      hud.revive(game, null);
    } else if (game.phase === 'over') {
      locked = true;
      showOver();
    } else {
      controlsHint();
      unlock();
    }
    syncPlace();
  }

  function showTitle() {
    const label = title ?? (game.stats.shots > 0 ? `Continue · level ${game.level}` : 'Play');
    hud.ready(label, !title && game.stats.shots > 0);
  }

  // How to shoot, until the player has a few shots behind them.
  function controlsHint() {
    if (controlsShown || shotsSeen >= 3) return;
    controlsShown = true;
    hud.hint(matchMedia('(pointer: coarse)').matches ? 'Drag to aim, lift to shoot' : 'Move to aim, click to shoot', 7);
  }

  // A level has begun. If the run has gone back to another place (a new run after a long one),
  // that changes first, under the veil. Then the camera flies over the level: the full tour
  // when the place is new, a short one otherwise, none where motion is reduced.
  function startLevel(full, { slide = true } = {}) {
    locked = true;
    const entry = ready.get(wantedPlace());
    if (entry && entry.place !== place) return swapPlace(entry, () => startLevel(true, { slide }));
    if (slide) {
      view.sync(game.board, game.scrollRow);
      view.setScroll(game.scrollRow, { intro: true });
    }
    const flying = view.flyover(game.board, {
      count: full ? (game.levelRows >= 14 ? 3 : 2) : 1,
      quick: !full,
      prefer: (look) => teacher.isNew(specialName(look)),
      onHold: (look) => teach(specialName(look)),
      onDone: landed,
    });
    if (flying) hud.fly(true);
    else landed();
  }

  function landed() {
    hud.fly(false);
    view.sync(game.board, game.scrollRow);
    controlsHint();
    unlock();
  }

  // ---- Teaching the specials ----

  // Explains a special on the hint line, and rings the bubble it means as the line appears.
  function teach(name) {
    if (!teacher.isNew(name)) return;
    teacher.wait(name);
    hud.hint(LINES[name], 6, {
      teach: true,
      onShow: () => {
        teacher.mark(name);
        if (view.flight) return; // a close-up is already looking at it
        const at = teacher.where(game, name);
        if (at === 'hand') view.markLauncher();
        else if (at) view.mark(cellX(at[0], at[1]), cellY(at[0]));
      },
    });
  }

  // Lines about specials that have not had their turn yet wait for the next sighting, which
  // may never come in the level or run that follows.
  function forgetHints() {
    hud.dropHints();
    teacher.waiting.clear();
  }

  function teachCheck() {
    if (playing && !watching && !view.flight) for (const name of teacher.fresh(game)) teach(name);
  }

  // ---- Places ----

  const wantedPlace = () => debugPlace ?? placeOf(game.level);

  // Fetches a place's chunk and builds its scene ahead of time.
  function prepare(id) {
    if (id === place.id || ready.has(id) || preparing.has(id)) return;
    preparing.add(id);
    loadPlace(id)
      .then((p) => view.preparePlace(p).then((group) => {
        ready.set(id, { place: p, group });
        syncPlace();
      }))
      .catch(console.error)
      .finally(() => preparing.delete(id));
  }

  // Readies the place this level wants and the one the next stretch of levels wants, when the
  // browser has a moment to spare (never in the middle of a fly-over). While the level card is up
  // the level counted from is the one about to start: the place changes under the card, before
  // nextLevel(), and counting from the old level readied the place just left instead of the next.
  function prefetch() {
    const run = () => {
      if (view.flight) return idle(run);
      const level = game.level + (game.phase === 'cleared' ? 1 : 0);
      const next = level - ((level - 1) % LEVELS_PER_PLACE) + LEVELS_PER_PLACE;
      prepare(debugPlace ?? placeOf(level));
      prepare(debugPlace ?? placeOf(next));
    };
    idle(run);
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 1500));

  function applyPlace(entry) {
    ready.delete(entry.place.id); // its scene now belongs to the view, and is freed when it leaves
    view.setPlace(entry.place, entry.group);
    place = entry.place;
    audio.setScore(place.music);
    hud.theme(place.theme);
    prefetch();
  }

  // Changes place under the veil, then carries on with `then`. A change already under way
  // takes the extra `then` along instead of starting another.
  function swapPlace(entry, then) {
    if (swapQueue) return void swapQueue.push(then);
    swapQueue = [then];
    locked = true;
    view.setAim(null);
    hud.veil(true, entry.place.theme);
    after(0.4, () => {
      if (entry.place !== place) applyPlace(entry);
      hud.veil(false);
      after(0.35, () => {
        const queue = swapQueue;
        swapQueue = null;
        for (const fn of queue) fn();
      });
    });
  }

  // Shows the place this level wants if it arrived late (a run continued in a later place, or a
  // return from watching someone elsewhere): between shots, or under a card. Level starts change
  // place during the level card instead.
  function syncPlace() {
    const entry = ready.get(wantedPlace());
    if (!entry || entry.place === place || swapping() || paused || view.flight) return;
    const busy = watching ? playingBack : locked && game.phase === 'aim';
    if (playing && (busy || game.phase === 'cleared')) return;
    swapPlace(entry, () => playing && unlock());
  }

  function setPaused(value) {
    if (!playing || paused === value) return;
    paused = value;
    hud.show('pause', value);
    if (value) {
      audio.suspend();
      cancelAnimationFrame(raf);
    } else {
      audio.resume();
      last = performance.now();
      raf = requestAnimationFrame(loop);
      syncPlace();
    }
  }

  function swap() {
    if (locked || !canPlay() || !game.swap()) return;
    audio.swap();
    showHand('swap');
    showAim();
    emit('change', 'swap');
  }

  function fire() {
    if (locked || !canPlay() || !aiming || game.phase !== 'aim') return;
    const before = game.scrollRow;
    const res = game.fire(angle);
    if (!res) return;
    store.set('shots', ++shotsSeen);
    if (shotsSeen === 3) hud.hint('Tap the launcher to swap bubbles', 6);
    else hud.hint('');
    emit('change', 'shot', clampAim(angle));
    playShot(res, before);
  }

  // The shot flies from the launcher to wherever it stops, then shows what the rules decided.
  function playShot(res, before) {
    locked = true;
    const piercing = res.shot.k === KIND.COMET;
    audio.newChain();
    piercing ? audio.comet() : audio.shoot();
    view.setAim(null);
    showHand('reload');
    hud.update({ ...snapshot(), score: hud.target }); // moves change now, the score when it lands

    // A tick for every wall the shot glances off.
    const pts = res.fly.pts;
    let travelled = 0;
    for (let i = 2; i < pts.length - 2; i += 2) {
      travelled += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      after(travelled / SHOT_SPEED, () => audio.bounce());
    }
    const land = () => resolve(res, before);
    view.fly(pts, res.fly.len / SHOT_SPEED, lookOf(res.shot), piercing, piercing ? null : land);
    if (piercing) after(res.fly.contactLen / SHOT_SPEED, land);
  }

  // The HUD reads a few fields off the game; this lets it show them with one overridden.
  const snapshot = () => ({
    score: game.score, level: game.level, moves: game.moves, gems: game.gems, phase: game.phase,
    specials: game.specials, rowsLeft: game.rowsLeft, levelRows: game.levelRows, hasMist: () => game.hasMist(),
  });

  // The shot has arrived: show what the rules decided.
  function resolve(res, scrollBefore) {
    view.sync(game.board, game.scrollRow);
    const at = res.placed
      ? { x: cellX(res.placed.r, res.placed.c), y: cellY(res.placed.r) }
      : { x: res.fly.cell ? cellX(...res.fly.cell) : res.fly.x, y: res.fly.cell ? cellY(res.fly.cell[0]) : res.fly.y };
    if (res.shot.k === KIND.COMET && res.pops.length) Object.assign(at, { x: cellX(res.pops[0].r, res.pops[0].c), y: cellY(res.pops[0].r) });
    if (res.placed) {
      view.nudge(at.x, at.y);
      audio.land();
    }

    for (const p of res.pops) {
      const stone = p.b.k === KIND.OBSIDIAN;
      view.addDying({ x: cellX(p.r, p.c), y: cellY(p.r), look: lookOf(p.b) }, p.delay * TICK, () => (stone ? audio.crack() : audio.pop()));
    }
    for (const b of res.blasts) {
      after(b.delay * TICK, () => {
        const x = view.worldX(cellX(b.r, b.c));
        const y = view.worldY(cellY(b.r));
        if (b.type === 'row') {
          const color = colorOf(-1);
          view.fx.beam(x, y, view.worldX(0), y, color, { width: 0.7, life: 0.55, travel: 0.16 });
          view.fx.beam(x, y, view.worldX(COLS), y, color, { width: 0.7, life: 0.55, travel: 0.16 });
          audio.comet();
          view.kick(0.1);
        } else {
          view.fx.ring(x, y, 0.3, colorOf(-1), { from: 0.3, to: 3.1, life: 0.5, gain: 1.6 });
          view.fx.burst(x, y, colorOf(-1), 26, 14);
          audio.nova();
          view.kick(0.22);
        }
      });
    }
    for (const r of res.reveals) view.liftMist(r.id, r.delay * TICK);
    if (res.reveals.length) after(res.reveals[0].delay * TICK, () => audio.reveal());

    // Drops start once the pops have rippled out; the lowest bubbles let go first.
    const dropAt = res.pops.length ? (res.lastDelay + 2) * TICK : 0.05;
    const lowest = Math.max(0, ...res.drops.map((d) => d.r));
    for (const d of res.drops) {
      const delay = dropAt + (lowest - d.r) * 0.035 + Math.random() * 0.05;
      const item = { x: cellX(d.r, d.c), y: cellY(d.r), look: lookOf(d.b) };
      if (d.caught) {
        catching++;
        view.addFalling(item, delay, () => {
          catching--;
          audio.gem();
          showHand('special');
          unlock();
        }, true);
      } else view.addFalling(item, delay, () => audio.splash());
    }

    if (res.points > 0) {
      const p = view.toScreen(view.worldX(at.x), view.worldY(at.y));
      const notes = [];
      if (res.dropped) notes.push(`${res.dropped} dropped ×2`);
      if (res.streak > 1) notes.push(`streak ×${res.bonus.toFixed(1)}`);
      const removed = res.popped + res.dropped;
      hud.tally(p.x, p.y, res.points, notes.join(' · '), removed > 30 ? 1.9 : removed > 12 ? 1.5 : removed > 5 ? 1.2 : 1);
      if (removed > 20) pulse = Math.min(1.6, removed / 40);
    }

    if (game.scrollRow !== scrollBefore) {
      after(dropAt + 0.2, () => {
        view.setScroll(game.scrollRow);
        audio.scroll();
        view.kick(0.1);
      });
    }
    // Gems the game hands over speak to whoever is playing, so they stay off another player's screen.
    if (!watching) {
      res.gifts.filter((g) => g.reason !== 'revive').forEach((g, i) => {
        after(0.5 + i * 0.5, () => {
          audio.gem();
          hud.gift(g);
        });
      });
    }
    afterChange();
    after(0.08, unlock);

    // Whatever comes next waits for the effects to play out.
    const settle = Math.max(res.lastDelay * TICK, res.drops.length ? dropAt + 1.0 : 0) + 0.35;
    if (res.phase !== 'aim') after(settle, () => phaseReached(res));
  }

  function phaseReached(res) {
    if (watching) return watchedPhase();
    if (res.phase === 'cleared') levelCleared();
    else if (res.phase === 'nomoves') {
      audio.outOfMoves();
      hud.revive(game, res.gifts.find((g) => g.reason === 'revive'));
    } else if (res.phase === 'over') gameOver();
  }

  function unlock() {
    if (catching > 0 || swapping() || view.flight) return;
    if (watching) {
      // A shot played back has settled: whatever the player on show did next can follow.
      if (game.phase === 'aim') stepDone();
      return;
    }
    if (game.phase !== 'aim') return;
    locked = false;
    showAim();
    teachCheck();
    syncPlace();
  }

  // The level card. When the next level is somewhere new, the veil comes down behind the card
  // and the place changes under it.
  function levelCleared() {
    const level = game.level;
    audio.levelUp();
    pulse = 1.6;
    forgetHints();
    const entry = ready.get(debugPlace ?? placeOf(level + 1));
    const moving = !!entry && entry.place !== place;
    hud.cleared(level, true, moving ? entry.place.name : null);
    if (moving) {
      swapQueue = []; // holds off any other change of place until the card is gone
      after(1.0, () => hud.veil(true, entry.place.theme));
      after(1.45, () => applyPlace(entry));
    }
    after(2.0, () => {
      hud.cleared(level, false);
      game.nextLevel();
      emit('change', 'level');
      if (moving) swapQueue = null;
      hud.veil(false);
      view.sync(game.board, game.scrollRow);
      audio.scroll();
      showHand('set');
      afterChange();
      startLevel(moving);
    });
  }

  function gameOver() {
    save(game);
    const best = store.get('best', 0);
    if (game.score > best) store.set('best', game.score);
    audio.gameOver();
    showOver(best);
  }

  function showOver(best = store.get('best', 0)) {
    hud.over(game, Math.max(best, game.score), game.score > best && best > 0);
    emit('over');
  }

  // ---- Another player's game, played back from what their page sends (src/net/race.js) ----

  // Puts `copy`, a game made from another player's state, on screen. This player's own game waits,
  // saved, exactly as it is. Called again, it jumps to a newer copy.
  function watch(copy) {
    if (!watching) {
      own = game;
      save(own);
      watching = true;
      hud.watch(true);
      for (const id of ['revive', 'over']) hud.show(id, false);
    }
    steps = [];
    playingBack = false;
    stepNo++;
    hud.show('cleared', false);
    aiming = false;
    setGame(copy);
    locked = false;
    prefetch();
    syncPlace();
  }

  // What the player on show did next. Each step is played back in turn on the copy, then checked
  // against the state their page sent with it; anything that does not match (a browser that rounds
  // differently, a message that went missing) jumps to their state instead.
  function watchStep(ev, a, s) {
    if (!watching) return;
    steps.push({ ev, a, s });
    if (steps.length > 3) {
      // Too far behind to play it all: show where they are now.
      const copy = Game.load(steps.at(-1).s, { finished: true });
      if (copy) watch(copy);
      return;
    }
    nextStep();
  }

  function nextStep() {
    if (!watching || playingBack || !steps.length) return;
    const { ev, a, s } = steps.shift();
    const before = game.scrollRow;
    let res = null;
    if (ev === 'shot') res = game.fire(a);
    else if (ev === 'swap') game.swap();
    else if (ev === 'comet') game.buyComet();
    else if (ev === 'clear') res = game.buyClear();
    else if (ev === 'revive') game.revive();
    else if (ev === 'level') game.nextLevel();
    else if (ev === 'end') game.endRun();
    if (JSON.stringify(game.serialize()) !== JSON.stringify(s)) {
      const copy = Game.load(s, { finished: true });
      if (copy) watch(copy);
      return;
    }
    playingBack = true;
    const no = ++stepNo;
    const done = (seconds) => after(seconds, () => stepDone(no));
    if (ev === 'shot') playShot(res, before); // ends in unlock() or phaseReached()
    else if (ev === 'swap') {
      audio.swap();
      showHand('swap');
      showAim();
      done(0.2);
    } else if (ev === 'comet') {
      audio.gem();
      showHand('special');
      afterChange();
      done(0.3);
    } else if (ev === 'clear') {
      showClear(res);
      done(0.5);
    } else if (ev === 'level') {
      hud.cleared(game.level - 1, false);
      audio.scroll();
      setGame(game);
      prefetch();
      done(0.6);
    } else {
      if (ev === 'revive') audio.gem();
      afterChange();
      emit('watchPhase', game.phase);
      done(0.2);
    }
  }

  function stepDone(no = stepNo) {
    if (no !== stepNo || !playingBack) return;
    playingBack = false;
    locked = false;
    showAim();
    syncPlace();
    nextStep();
  }

  // The player on show reached a card. Their page shows it; ours says so and waits for their next move.
  function watchedPhase() {
    if (game.phase === 'cleared') {
      audio.levelUp();
      hud.cleared(game.level, true);
    } else if (game.phase === 'nomoves') audio.outOfMoves();
    emit('watchPhase', game.phase);
    stepDone();
  }

  // Their aim line, as their page reports it; null while they are not aiming.
  function watchAim(a) {
    if (!watching) return;
    aiming = a !== null;
    if (aiming) angle = a;
    showAim();
  }

  // Back to this player's own game, as it was left.
  function unwatch() {
    if (!watching) return;
    endWatch();
    const g = own;
    own = null;
    newGame(g);
    carryOn();
    emit('change', 'sync');
  }

  function endWatch() {
    watching = false;
    steps = [];
    playingBack = false;
    stepNo++;
    aiming = false;
    hud.watch(false);
    hud.show('cleared', false);
  }

  // Plays another run in place of this one: the solo run, or a race's. The run on screen is saved
  // first. `keep` saves the new run; `label` is what the title screen's Play says while it waits.
  function useRun(g, { keep = soloSave, label = null } = {}) {
    if (watching) {
      endWatch();
      own = null;
    } else save(game);
    for (const id of ['revive', 'over']) hud.show(id, false);
    save = keep;
    title = label;
    newGame(g);
    if (!playing) {
      if (warm) showTitle();
    } else if (game.stats.shots === 0 && game.phase === 'aim') startLevel(true, { slide: false });
    else carryOn();
    emit('change', 'sync');
  }

  // Pointer position to an aim angle, or null when it points below the launcher.
  function aimAt(px, py) {
    const rect = canvas.getBoundingClientRect();
    const w = view.fromScreen(px - rect.left, py - rect.top);
    view.pointerX = Math.max(-1, Math.min(1, w.x / 8));
    const dy = w.y - LAUNCH_WORLD_Y;
    if (dy < 0.4) return null;
    return Math.atan2(dy, w.x);
  }
  const onLauncher = (px, py) => {
    const rect = canvas.getBoundingClientRect();
    const w = view.fromScreen(px - rect.left, py - rect.top);
    return Math.hypot(w.x + 0.9, w.y - LAUNCH_WORLD_Y) < 2.1;
  };

  bindInput(canvas, {
    // A press during the fly-over cuts it short, and goes no further.
    press() {
      if (!playing || paused || !view.flight) return false;
      view.skipFlight();
      return true;
    },
    aim(px, py) {
      if (watching) return;
      const a = aimAt(px, py);
      aiming = a !== null;
      if (aiming) angle = a;
      showAim();
    },
    release(px, py, startedAt, pointerType) {
      if (watching) return;
      if (!startedAt.moved && onLauncher(startedAt.x, startedAt.y)) swap();
      else {
        const a = aimAt(px, py);
        aiming = a !== null;
        if (aiming) angle = a;
        fire();
      }
      // A finger has left the screen; a mouse is still pointing somewhere.
      if (pointerType !== 'mouse') aiming = false;
      showAim();
    },
    cancel() {
      if (watching) return;
      aiming = false;
      showAim();
    },
    swap,
    key(e) {
      if (!playing || hooks.keysOff?.()) return;
      const pauseKey = e.key === 'Escape' || e.key === 'p' || e.key === 'P';
      if (paused) {
        if (pauseKey) setPaused(false);
        return;
      }
      // A sheet over the game, or another player's game on show, takes only its own keys.
      if (held || watching) {
        if (e.key === 'Escape') emit(held ? 'escape' : 'back');
        else if (watching && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) emit('step', e.key === 'ArrowLeft' ? -1 : 1);
        else return;
        e.preventDefault();
        return;
      }
      const step = e.shiftKey ? 0.09 : 0.025;
      if (pauseKey) setPaused(true);
      else if (view.flight) view.skipFlight();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        aiming = true;
        angle = clampAim(angle + (e.key === 'ArrowLeft' ? step : -step));
        showAim();
      } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') {
        if (document.activeElement?.tagName === 'BUTTON') return; // let the focused button have it
        aiming = true;
        fire();
        showAim();
      } else if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') swap();
      else if (e.key === '1') document.getElementById('boost-comet').click();
      else if (e.key === '2') document.getElementById('boost-clear').click();
      else return;
      e.preventDefault();
    },
  });

  // The score bar's height changed (a race adds a line to it): the field makes room.
  function relayout() {
    view.topPx = hud.topPx;
    view.resize();
    if (paused) view.frame(0);
  }
  addEventListener('resize', relayout);
  document.addEventListener('visibilitychange', () => document.hidden && setPaused(true));
  // If the GPU drops the context, start over; the run is saved after every shot.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  let pulse = 0; // a big clear makes the lanterns flare
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const real = Math.min(100, now - last);
    last = now;
    const dt = frozen === null ? real / 1000 : 0;
    if (frozen !== null) view.time = frozen;
    view.quality.frame(real);
    pulse *= Math.exp(-dt * 1.6);
    view.env.glow.value = 1 + pulse;

    // Run whatever is due by the end of this frame, in order.
    const due = view.time + dt;
    if (timers.some((t) => t.at <= due)) {
      const ready = timers.filter((t) => t.at <= due).sort((a, b) => a.at - b.at);
      timers = timers.filter((t) => t.at > due);
      for (const t of ready) t.fn();
    }
    emit('frame', dt);
    view.frame(dt);
    hud.frame(dt);
    if (debug) {
      const s = view.stats;
      hud.debug(`${s.fps.toFixed(0)} fps  ${s.tier}  x${s.scale.toFixed(1)}  dpr ${s.pixelRatio.toFixed(2)}  ${s.calls} calls`);
    }
  }

  newGame(Game.load(store.get('run', null)));
  if (debug && params.has('level')) jumpTo(Number(params.get('level')));
  if (debugPlace) prepare(debugPlace);
  view.warmUp().catch(console.error).then(() => {
    view.frame(0);
    canvas.classList.add('on');
    last = performance.now();
    raf = requestAnimationFrame(loop);
    warm = true;
    showTitle();
    performance.mark('bubbler-ready');
  });

  // Debug: a new run that starts at the beginning of `level`.
  function jumpTo(level) {
    const g = new Game(debugSeed === null ? undefined : { seed: debugSeed });
    g.level = Math.max(1, level) - 1;
    g.phase = 'cleared';
    newGame(g);
    store.remove('run');
  }

  // What the race module may do with the game.
  const app = {
    get game() { return game; },
    // This player's own game, also while another's is on show.
    get own() { return own ?? game; },
    get playing() { return playing; },
    get watching() { return watching; },
    on(name, fn) { hooks[name] = fn; },
    useRun,
    setTitle(label) {
      title = label;
      if (warm && !playing) showTitle();
    },
    watch, watchStep, watchAim, unwatch,
    hold(on) {
      held = on;
      if (on) aiming = false;
      showAim();
    },
    relayout,
    pause: (on) => setPaused(on),
    show: (id, on) => hud.show(id, on),
    toast: (text, seconds) => hud.toast(text, seconds),
  };

  if (debug) {
    // Handles for tests and for poking at the game from the console.
    window.__bubbler = {
      get game() { return game; },
      get place() { return place.id; },
      // For the autoplayer: whether a shot would be taken now, and the angle the pointer gives.
      get ready() { return playing && !paused && !held && !watching && !locked && game.phase === 'aim'; },
      get aim() { return aiming ? clampAim(angle) : null; },
      view, hud, audio, teacher, app,
      level(n) {
        jumpTo(n);
        if (playing) startLevel(true, { slide: false });
      },
      goPlace(id) {
        debugPlace = id;
        prepare(id);
        syncPlace();
      },
      flyover() { startLevel(true, { slide: false }); },
      freeze(t) { frozen = t; },
      fireAt(a) { angle = a; aiming = true; fire(); },
      // What a shot at this angle would do, without taking it.
      tryShot(a) {
        const board = game.board.clone();
        const r = applyShot(board, game.active, game.origin.x, game.origin.y, clampAim(a));
        return { pops: r.pops.length, drops: r.drops.length, caught: r.caught.length, blasts: r.blasts.length, reveals: r.reveals.length, left: board.count() };
      },
      refresh() { view.sync(game.board, game.scrollRow); view.setScroll(game.scrollRow); showHand('set'); afterChange(); },
      // What a seed deals at a level, as a hash: its board and the first 40 colours of its queue.
      // Every browser must give the same.
      fingerprint(level, seed = app.own.seed) {
        const g = new Game({ seed });
        while (g.level < level) {
          g.phase = 'cleared';
          g.nextLevel();
        }
        const rows = g.board.rows.map((row) => row.map((b) => (b ? [b.k, b.c, b.m] : 0)));
        return hash(JSON.stringify([rows, g.peekQueue(40)]));
      },
      // The game on screen as a hash, to compare one page's with another's.
      state() { return hash(JSON.stringify(game.serialize())); },
    };
  }
  return app;
}
