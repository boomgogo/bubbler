// Racing friends in a p3p2 room. Everyone plays the same run (one seed: the same boards, the same
// colours dealt), sees everyone's level and score, and can watch any of them play. Loaded only once
// a room opens (src/net/friends.js).
//
// What goes where in the room:
// - the log: races ({ t: 'race' }) and standings ({ t: 'score' }), so a late joiner has them all;
// - presence: { r, lv, sc, mv, st, w, a }: the race, level, score, moves and phase of this page's
//   run, the member it is watching, and its aim while someone watches it;
// - 'play' messages, only to the members watching this page: every change, with the state after it.
// No page runs anything for the others, and none takes another's replay of a shot as the truth.
import { Smooth } from '@p3p2/client/smooth';
import { Game } from '../core/game.js';
import { store } from '../platform/storage.js';
import { Standings, table, raceOp } from './standings.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const EVENTS = new Set(['sync', 'shot', 'swap', 'comet', 'clear', 'revive', 'level', 'end']);
const PHASES = new Set(['title', 'aim', 'cleared', 'nomoves', 'over']);
const DOING = { title: 'about to start', aim: 'playing', cleared: 'playing', nomoves: 'out of moves', over: 'finished' };
const CLOSED = {
  left: 'You left the room.',
  kicked: 'Someone hosting the room took you out of it.',
  ended: 'Whoever hosts the room closed it.',
  replaced: 'The room is open in another tab of this browser now.',
  lost: 'The connection to the room could not be brought back.',
};
const HOOKS = ['change', 'playing', 'aim', 'over', 'frame', 'back', 'escape', 'step', 'watchPhase'];

// Another member's presence, if it is what this game sends; anything else counts as none.
function presenceOf(value) {
  if (!value || typeof value !== 'object' || !PHASES.has(value.st)) return null;
  if (!Number.isInteger(value.lv) || !Number.isFinite(value.sc)) return null;
  if (value.r !== null && typeof value.r !== 'string') return null;
  return value;
}

const looksLikeRun = (s) => !!s && typeof s === 'object' && s.v === 2 && Array.isArray(s.rows);

function loadRun(s) {
  if (!looksLikeRun(s)) return null;
  try {
    return Game.load(s, { finished: true });
  } catch {
    return null;
  }
}

export class Race {
  constructor(room, app, p3p2) {
    this.room = room;
    this.app = app;
    this.p3p2 = p3p2;
    this.standings = new Standings();
    this.read = false; // the log's saved ops have all been handed over
    this.mine = null; // the race this page's race run belongs to
    this.running = false; // that run is the app's run
    this.finished = false; // its final standing has gone into the log
    this.joinAsked = null; // a race this page started, to move to as soon as the log has it
    this.watchers = new Set(); // members watching this page
    this.sent = 0; // 'play' steps numbered, so a watcher notices one that went missing
    this.aim = null;
    this.watched = null; // the member this page is watching
    this.heard = 0; // the last step heard from them
    this.shown = false; // their game is on screen (not still waiting for it)
    this.lastAim = null;
    this.smooth = new Smooth({ angles: [0] });
    this.off = [];
    this.closed = false;
    this.leaving = false;

    this.#ui(true);
    this.#listen();
    this.#presence();
    room.log
      .open({
        load: (state) => this.standings.load(state),
        apply: (op, entry) => this.standings.apply(op, entry.pid) && this.#changed(),
        save: () => this.standings.save(),
      })
      .then(() => {
        if (this.closed) return;
        this.read = true;
        if (!this.standings.current) room.log.submit(raceOp(null));
        this.#changed();
      })
      .catch(console.error);
    if (window.__bubbler) window.__bubbler.race = this;
  }

  // ---- Which race this page plays ----

  #follow() {
    const current = this.standings.current;
    if (!this.read || !current || this.closed) return;
    if (this.mine === null) {
      // Just in the room: carry on with a race this browser already played here, else the current one.
      const saved = store.get('race', null);
      const race = (saved && this.standings.race(saved.id)) || current;
      return this.#play(race, race.id === saved?.id ? saved.state : null, this.app.playing);
    }
    // A newer race: this page moves to it at once if it asked for it, or has nothing under way.
    if (current.id !== this.mine && (this.joinAsked === current.id || !this.app.playing)) this.#play(current, null, false);
  }

  // Makes `race` this page's race, with its saved run or a new one. `ask`: a solo game is under
  // way, so the race starts when the player says so.
  #play(race, state, ask) {
    this.mine = race.id;
    this.running = false;
    this.joinAsked = null;
    let game = loadRun(state);
    if (!game || game.seed !== race.seed) game = new Game({ seed: race.seed });
    this.finished = game.phase === 'over';
    const go = () => {
      if (this.closed || this.mine !== race.id) return;
      this.running = true; // before useRun(), whose 'sync' tells the room and any watchers
      this.app.useRun(game, {
        keep: (g) => store.set('race', { id: race.id, state: g.serialize() }),
        label: game.phase === 'over' ? 'See how the race went' : game.stats.shots ? `Continue the race · level ${game.level}` : 'Start the race',
      });
      if (!race.rows.has(this.room.self.pid)) this.#score('playing');
      this.#changed();
    };
    if (!ask) return go();
    this.app.hold(true);
    this.app.show('race-start', true);
    $('btn-race-start').onclick = () => {
      this.app.show('race-start', false);
      this.app.hold(false);
      this.app.pause(false); // the room may have been opened from the pause screen
      go();
    };
    $('btn-race-invite').onclick = () => this.p3p2.open().catch(console.error);
    this.#changed();
  }

  // Into the newest race, leaving this one where it stands.
  #joinNew() {
    const current = this.standings.current;
    if (!current || current.id === this.mine) return;
    this.#closeSheet();
    this.back();
    if (this.running && !this.finished) this.#score('left');
    this.#play(current, null, false);
  }

  #rematch() {
    if (this.standings.current?.id !== this.mine) return this.#joinNew();
    const op = raceOp(this.mine);
    this.joinAsked = op.id;
    this.room.log.submit(op);
  }

  // Out of the room, back to the solo run.
  #leaveRoom() {
    if (this.running && !this.finished) this.#score('left');
    this.leaving = true;
    this.app.pause(false);
    this.room.leave();
  }

  // The room is over for this page (src/net/friends.js hears it from p3p2).
  leave(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.off) off();
    for (const name of HOOKS) this.app.on(name, null);
    if (window.__bubbler?.race === this) window.__bubbler.race = null;
    clearTimeout(this.waiting);
    this.watched = null;
    if (this.app.watching) this.app.unwatch();
    this.app.show('standings', false);
    this.app.show('race-start', false);
    this.#ui(false);
    const solo = () => {
      this.app.hold(false);
      this.app.useRun(Game.load(store.get('run', null)));
    };
    if (reason === 'left' && this.leaving) return solo();
    this.app.hold(true);
    $('room-closed-why').textContent = CLOSED[reason] ?? 'The room closed.';
    this.app.show('room-closed', true);
    $('btn-room-back').onclick = () => {
      this.app.show('room-closed', false);
      solo();
    };
  }

  // ---- What this page tells the room ----

  #presence() {
    const g = this.app.own;
    const value = this.running
      ? { r: this.mine, lv: g.level, sc: g.score, mv: g.moves, st: this.app.playing ? g.phase : 'title' }
      : { r: this.mine, lv: 1, sc: 0, mv: 0, st: 'title' };
    if (this.watched !== null) value.w = this.watched;
    if (this.watchers.size && this.aim !== null) value.a = this.aim;
    this.room.presence.set(value);
  }

  #score(st) {
    const g = this.app.own;
    this.room.log.submit({ t: 'score', race: this.mine, name: this.room.self.name, lv: g.level, sc: g.score, shots: g.stats.shots, st });
  }

  #onChange(ev, a) {
    if (!this.running) return;
    const g = this.app.own;
    if (ev === 'level') this.#score('playing');
    if (g.phase === 'over' && !this.finished) {
      this.finished = true;
      this.#score('over');
    }
    this.#presence();
    if (this.watchers.size) this.#send(ev, a, [...this.watchers]);
    this.#changed();
  }

  // A step of this page's run, with the state after it, to the members watching.
  #send(ev, a, to) {
    const data = { n: ev === 'sync' ? this.sent : ++this.sent, ev, s: this.app.own.serialize() };
    if (a !== undefined) data.a = a;
    this.room.send('play', data, { to });
  }

  // ---- Watching ----

  // May this player watch a board at `level`? Not one ahead of their own live run: everyone has the
  // same boards, so that would show them what is coming.
  #mayWatch(level) {
    const g = this.app.own;
    return g.phase === 'over' || level <= g.level;
  }

  watch(id) {
    const member = this.room.members.find((m) => m.id === id);
    const p = member && member !== this.room.self ? presenceOf(this.room.presence.get(member)) : null;
    if (!this.running || !p || p.r !== this.mine || p.st === 'title') return;
    if (!this.#mayWatch(p.lv)) return this.app.toast(`${member.name} is ahead of you, on level ${p.lv}`);
    this.#closeSheet();
    this.watched = id;
    this.heard = 0;
    this.shown = false;
    this.smooth.clear();
    if (!this.app.watching) this.app.hold(true); // until their game arrives
    this.#presence();
    clearTimeout(this.waiting);
    this.waiting = setTimeout(() => {
      if (this.watched === id && !this.shown) this.back(`${member.name}'s game did not answer`);
    }, 8000);
    this.#changed();
  }

  back(note) {
    if (this.watched === null) return;
    this.watched = null;
    this.shown = false;
    clearTimeout(this.waiting);
    this.smooth.clear();
    this.#presence();
    if (this.app.watching) this.app.unwatch();
    else this.app.hold(false);
    if (note) this.app.toast(note, 3.5);
    this.#changed();
  }

  // ◀ ▶: the player before or after, among those this page may watch.
  #cycle(dir) {
    const others = this.#rows().filter((r) => this.#canWatch(r));
    if (!others.length) return;
    const at = others.findIndex((r) => r.id === this.watched);
    const next = others[(at + dir + others.length) % others.length];
    if (next.id !== this.watched) this.watch(next.id);
  }

  #heard(data, from) {
    if (!from || from.id !== this.watched || !data || typeof data !== 'object') return;
    if (!EVENTS.has(data.ev) || !Number.isInteger(data.n) || !looksLikeRun(data.s)) return;
    if (data.ev === 'shot' && !Number.isFinite(data.a)) return;
    if (data.ev === 'sync' || !this.shown || data.n !== this.heard + 1) {
      const copy = loadRun(data.s);
      if (!copy) return;
      this.heard = data.n;
      if (!this.#mayWatch(copy.level)) return this.back(`${from.name} has gone on ahead, to level ${copy.level}`);
      this.shown = true;
      this.app.hold(false);
      this.app.watch(copy);
      return this.#changed();
    }
    this.heard = data.n;
    if (data.ev === 'level' && !this.#mayWatch(data.s.level)) return this.back(`${from.name} has gone on ahead, to level ${data.s.level}`);
    this.app.watchStep(data.ev, data.a, data.s);
  }

  // Their aim line, drawn a little in the past so that it moves evenly.
  #frame() {
    if (!this.shown || !this.app.watching) return;
    const v = this.smooth.get(this.watched);
    const a = v ? v[0] : null;
    if (a === this.lastAim) return;
    this.lastAim = a;
    this.app.watchAim(a);
  }

  // ---- Listening ----

  #listen() {
    const { room, app } = this;
    app.on('change', (ev, a) => this.#onChange(ev, a));
    // Off the title screen: the others see this player as playing now, not about to start.
    app.on('playing', () => {
      this.#presence();
      this.#changed();
    });
    app.on('aim', (a) => {
      const v = a === null ? null : Math.round(a * 1e4) / 1e4;
      if (v === this.aim) return;
      this.aim = v;
      if (this.watchers.size) this.#presence();
    });
    app.on('over', () => this.#changed());
    app.on('frame', () => this.#frame());
    app.on('back', () => this.back());
    app.on('escape', () => this.#closeSheet());
    app.on('step', (dir) => this.#cycle(dir));
    app.on('watchPhase', () => this.#changed());

    // Members already watching this page (it came back after a reload) get its run once it is on.
    for (const m of room.members) {
      if (m !== room.self && presenceOf(room.presence.get(m))?.w === room.self.id) this.watchers.add(m.id);
    }
    this.off.push(
      room.presence.on((member, value, at) => {
        const p = presenceOf(value);
        const watching = p?.w === room.self.id;
        if (watching && !this.watchers.has(member.id)) {
          this.watchers.add(member.id);
          if (this.running) this.#send('sync', undefined, [member.id]);
          this.#presence();
        } else if (!watching && this.watchers.delete(member.id)) this.#presence();
        if (member.id === this.watched) {
          if (Number.isFinite(p?.a)) this.smooth.set(member.id, [p.a], at);
          else this.smooth.delete(member.id);
        }
        this.#changed();
      }),
      room.on('play', (data, from) => this.#heard(data, from)),
      // Back after a dropped connection: what was sent meanwhile is gone. The run this page watches
      // is sent again, and so is this page's own, to whoever watches it.
      room.on('status', (status) => {
        if (status !== 'open') return;
        if (this.watched !== null) room.send('again', 0, { to: [this.watched] });
        if (this.running && this.watchers.size) this.#send('sync', undefined, [...this.watchers]);
      }),
      room.on('again', (_, from) => {
        if (from && this.running && this.watchers.has(from.id)) this.#send('sync', undefined, [from.id]);
      }),
      room.on('member-join', () => this.#changed()),
      room.on('member-state', () => this.#changed()),
      room.on('member-leave', (member) => {
        this.watchers.delete(member.id);
        if (member.id === this.watched) this.back(`${member.name} left the room`);
        this.#changed();
      }),
    );

    const bind = (id, fn) => {
      $(id).addEventListener('click', fn);
      this.off.push(() => $(id).removeEventListener('click', fn));
    };
    bind('race-line', () => this.#openSheet());
    bind('watch-prev', () => this.#cycle(-1));
    bind('watch-next', () => this.#cycle(1));
    bind('watch-back', () => this.back());
    bind('btn-standings-close', () => this.#closeSheet());
    bind('btn-chat', () => this.p3p2.open().catch(console.error));
    bind('btn-join-new', () => this.#joinNew());
    bind('btn-rematch', () => this.#rematch());
    bind('btn-over-back', () => this.#leaveRoom());
    bind('btn-leave', () => this.#leaveRoom());
    for (const id of ['standings-rows', 'over-standings']) {
      bind(id, (e) => {
        const button = e.target.closest('button[data-watch]');
        if (button) this.watch(Number(button.dataset.watch));
      });
    }

    // A player who puts the game away leaves a standing behind, in case they do not come back.
    const hidden = () => document.hidden && this.running && !this.finished && this.#score('playing');
    document.addEventListener('visibilitychange', hidden);
    this.off.push(() => document.removeEventListener('visibilitychange', hidden));
  }

  // ---- What the player sees ----

  #ui(on) {
    document.documentElement.classList.toggle('racing', on);
    $('race').hidden = !on;
    $('btn-restart').hidden = on;
    $('btn-leave').hidden = !on;
    $('btn-again').hidden = on;
    $('over-race').hidden = !on;
    for (const id of ['btn-friends', 'btn-friends-p']) $(id).textContent = on ? 'Friends & chat' : 'Play with friends';
    this.app.relayout();
  }

  #openSheet() {
    this.app.hold(true);
    this.app.show('standings', true);
    this.#render();
  }

  #closeSheet() {
    if ($('standings').hidden) return;
    this.app.show('standings', false);
    this.app.hold(false);
  }

  // Everyone in this page's race, as the log and the room's presence have it.
  #rows() {
    const race = this.standings.race(this.mine);
    if (!race) return [];
    const live = new Map();
    for (const m of this.room.members) {
      const p = m === this.room.self ? null : presenceOf(this.room.presence.get(m));
      if (p) live.set(m.pid, { ...p, name: m.name, state: m.state, id: m.id });
    }
    if (this.running) {
      const g = this.app.own;
      const st = this.app.playing ? g.phase : 'title';
      live.set(this.room.self.pid, { r: this.mine, lv: g.level, sc: g.score, st, name: this.room.self.name, state: 'here', id: this.room.self.id });
    }
    return table(race, live);
  }

  #canWatch(row) {
    return row.here && row.id !== this.room.self.id && row.st !== 'title' && this.#mayWatch(row.lv);
  }

  #changed() {
    if (this.dirty || this.closed) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (this.closed) return;
      this.#follow();
      this.#render();
    });
  }

  #render() {
    const rows = this.#rows();
    const me = rows.findIndex((r) => r.pid === this.room.self.pid);
    const newer = !!this.mine && !!this.standings.current && this.standings.current.id !== this.mine;
    const race = this.standings.race(this.mine);

    // The race line: where this player stands. Equal scores share a place.
    const line = $('race-line');
    line.classList.toggle('new', newer);
    const mine = rows[me];
    const place = mine ? 1 + rows.filter((r) => r.sc > mine.sc).length : 0;
    const rival = rows.find((r) => r !== mine); // the best of the others
    if (newer) line.innerHTML = '<b>New race</b> · tap to join';
    else if (rows.length < 2) line.innerHTML = 'Waiting for friends · <b>invite</b>';
    else if (!mine || rows[0].sc === 0) line.innerHTML = `<b>${rows.length}</b> in the race · standings`;
    else {
      line.innerHTML = `<b>${ordinal(place)}</b> of ${rows.length} · `;
      if (place > 1) line.append(`${rows[0].name} leads ${fmt(rows[0].sc)}`);
      else if (rival.sc === mine.sc) line.append(`level with ${rival.name}`);
      else line.append(`ahead by ${fmt(mine.sc - rival.sc)}`);
    }

    const watched = rows.find((r) => r.id === this.watched);
    line.hidden = this.watched !== null;
    $('watch-bar').hidden = this.watched === null;
    if (this.watched !== null) {
      const name = watched?.name ?? 'them';
      const g = this.app.watching ? this.app.game : null;
      const doing = !this.shown ? ' · waiting' : g?.phase === 'nomoves' ? ' · out of moves' : g?.phase === 'over' ? ' · run over' : '';
      $('watch-name').textContent = `Watching ${name}${doing}`;
    }

    $('standings-title').textContent = race ? `Race ${race.n}` : 'The race';
    // Members in the room but not in this race: still in another, or not started.
    const elsewhere = this.room.members.filter((m) => m !== this.room.self && !rows.some((r) => r.id === m.id)).map((m) => m.name);
    $('standings-sub').textContent = `${this.room.name}: the same boards and colours for everyone.` + (elsewhere.length ? ` Between races: ${elsewhere.join(', ')}.` : '');
    for (const id of ['standings-rows', 'over-standings']) this.#fill($(id), rows);
    $('btn-join-new').hidden = !newer;
    $('btn-rematch').textContent = newer ? 'Join the new race' : 'Rematch';
  }

  #fill(el, rows) {
    const out = rows.map((r, i) => {
      const row = document.createElement('div');
      const self = r.pid === this.room.self.pid;
      row.className = 'srow' + (self ? ' me' : '') + (r.here ? '' : ' gone');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = 1 + rows.filter((x) => x.sc > r.sc).length;
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = self ? `${r.name} (you)` : r.name;
      const note = document.createElement('small');
      note.textContent = `level ${r.lv} · ${this.#doing(r)}`;
      who.append(note);
      const score = document.createElement('b');
      score.textContent = fmt(r.sc);
      row.append(rank, who, score);
      if (!self) {
        const watch = document.createElement('button');
        watch.textContent = 'Watch';
        watch.dataset.watch = r.id ?? '';
        const can = this.#canWatch(r);
        watch.disabled = !can;
        if (!can && r.here && !this.#mayWatch(r.lv)) watch.title = 'Ahead of you: you can watch once you get there, or when your run ends';
        row.append(watch);
      } else row.append(document.createElement('span'));
      return row;
    });
    el.replaceChildren(...out);
  }

  #doing(r) {
    if (!r.here) return r.st === 'over' ? 'finished' : 'left';
    if (r.state === 'away') return 'away';
    if (r.state === 'lost') return 'connection lost';
    if (r.w !== undefined) {
      const name = this.room.members.find((m) => m.id === r.w)?.name;
      if (name) return `watching ${name}`;
    }
    return DOING[r.st] ?? 'playing';
  }
}
