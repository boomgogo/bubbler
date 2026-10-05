// The controller: takes input, asks the rules what happened, and plays the result back
// through the view, the HUD and the sound.
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
    toggleSound: () => saveSettings({ sound: !settings.sound }),
    toggleMusic: () => saveSettings({ music: !settings.music }),
    quality: (quality) => saveSettings({ quality }),
    comet: () => {
      if (locked || !game.buyComet()) return;
      audio.gem();
      showHand('special');
      afterChange();
    },
    clear: () => {
      if (locked) return;
      const reveals = game.buyClear();
      if (!reveals) return;
      view.sync(game.board, game.scrollRow);
      for (const r of reveals) view.liftMist(r.id, r.delay * 0.08);
      audio.reveal();
      showHand('set');
      afterChange();
    },
    revive: () => {
      if (!game.revive()) return;
      hud.show('revive', false);
      audio.gem();
      locked = false;
      afterChange();
    },
    end: () => {
      hud.show('revive', false);
      game.endRun();
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

  // What the launcher shows. A caught special appears only once it has arrived.
  function showHand(mode) {
    const ready = game.specials.slice(0, game.specials.length - catching);
    const active = ready[0] ?? game.hand[0];
    const next = ready.length ? game.hand[0] : game.hand[1];
    view.setHand(lookOf(active), lookOf(next), mode);
  }

  function showAim() {
    if (!aiming || locked || !playing || game.phase !== 'aim') return view.setAim(null);
    view.setAim(game.preview(angle), lookOf(game.active), clampAim(angle));
  }

  function showDanger() {
    const depth = game.board.lowestRow() - game.scrollRow;
    view.stage.setDanger(Math.min(1, Math.max(0, (depth - (FAIL_ROW - 5)) / 4)));
  }

  function afterChange() {
    hud.update(game);
    showAim();
    showDanger();
    if (game.phase === 'over') store.remove('run');
    else store.set('run', game.serialize());
  }

  function newGame(saved) {
    game = saved ?? new Game(debugSeed === null ? undefined : { seed: debugSeed });
    if (game.phase === 'cleared') game.nextLevel(); // the tab was closed on the level card
    timers = [];
    catching = 0;
    swapQueue = null;
    forgetHints();
    hud.veil(false);
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
    prefetch();
    if (game.phase === 'nomoves') {
      locked = true;
      hud.revive(game, null);
    } else if (game.stats.shots === 0) startLevel(true, { slide: false }); // a new run: fly over it
    else {
      controlsHint();
      unlock();
    }
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
    if (playing && !view.flight) for (const name of teacher.fresh(game)) teach(name);
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
  // browser has a moment to spare (never in the middle of a fly-over).
  function prefetch() {
    const run = () => {
      if (view.flight) return idle(run);
      const next = game.level - ((game.level - 1) % LEVELS_PER_PLACE) + LEVELS_PER_PLACE;
      prepare(wantedPlace());
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

  // Shows the place this level wants if it arrived late (a run continued in a later place),
  // between shots. Level starts change place during the level card instead.
  function syncPlace() {
    const entry = ready.get(wantedPlace());
    if (!entry || entry.place === place || swapping() || paused || view.flight) return;
    if (playing && (locked || game.phase !== 'aim')) return;
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
    if (locked || paused || !playing || !game.swap()) return;
    audio.swap();
    showHand('swap');
    showAim();
  }

  function fire() {
    if (locked || paused || !playing || !aiming || game.phase !== 'aim') return;
    const before = game.scrollRow;
    const res = game.fire(angle);
    if (!res) return;
    locked = true;
    store.set('shots', ++shotsSeen);
    if (shotsSeen === 3) hud.hint('Tap the launcher to swap bubbles', 6);
    else hud.hint('');
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
    res.gifts.filter((g) => g.reason !== 'revive').forEach((g, i) => {
      after(0.5 + i * 0.5, () => {
        audio.gem();
        hud.gift(g);
      });
    });
    afterChange();
    after(0.08, unlock);

    // Whatever comes next waits for the effects to play out.
    const settle = Math.max(res.lastDelay * TICK, res.drops.length ? dropAt + 1.0 : 0) + 0.35;
    if (res.phase === 'cleared') after(settle, levelCleared);
    else if (res.phase === 'nomoves') {
      after(settle, () => {
        audio.outOfMoves();
        hud.revive(game, res.gifts.find((g) => g.reason === 'revive'));
      });
    } else if (res.phase === 'over') after(settle, gameOver);
  }

  function unlock() {
    if (game.phase !== 'aim' || catching > 0 || swapping() || view.flight) return;
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
    store.remove('run');
    const best = store.get('best', 0);
    const isBest = game.score > best;
    if (isBest) store.set('best', game.score);
    audio.gameOver();
    hud.over(game, Math.max(best, game.score), isBest && best > 0);
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
      const a = aimAt(px, py);
      aiming = a !== null;
      if (aiming) angle = a;
      showAim();
    },
    release(px, py, startedAt, pointerType) {
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
      aiming = false;
      showAim();
    },
    swap,
    key(e) {
      if (!playing) return;
      const step = e.shiftKey ? 0.09 : 0.025;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') setPaused(!paused);
      else if (paused) return;
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

  addEventListener('resize', () => {
    view.topPx = hud.topPx;
    view.resize();
    if (paused) view.frame(0);
  });
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
    hud.ready(game.stats.shots > 0 ? game : null);
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

  if (debug) {
    // Handles for tests and for poking at the game from the console.
    window.__bubbler = {
      get game() { return game; },
      get place() { return place.id; },
      view, hud, audio, teacher,
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
    };
  }
}
