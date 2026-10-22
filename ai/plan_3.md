# Plan 3: racing friends through p3p2, and links to Maize.Live

Answers `ai/prompt_3.md`. Two features:
1. **Race mode** through `@p3p2/client`. Everyone in a room plays the same run: the same boards and the same
   bubbles. Each player sees only their own bubbles, plus everyone's level and score. A separate screen lets
   you watch any of them play.
2. **More games on Maize.Live**: a link on the loading screen and on the pause screen.

**Built.** `ai/next_3.md` says what was built, what was measured, and where it differs from this plan.

## What I checked (the facts this plan rests on)

**The client, `@p3p2/client` 0.1.1** (MIT, no dependencies, published 16 Oct). I read its README and types,
and measured its files with brotli:
- **The entry is 1.6 KB.** It loads nothing and asks no server anything on an ordinary visit.
- **Further chunks load only when a room opens:** the room client (8.0 KB), the panel (4.6 KB) and the QR
  code (2.4 KB). Vite splits them out because the entry pulls them in with dynamic `import()`. Each one is
  under our 20 KB budget for later chunks.
- **The calls we need:**
  - `room.log`: ops kept in one order for everybody, late joiners included, with snapshots.
  - `room.presence`: one small value per member, latest only, at most 20 sends a second.
  - `room.send(…, { to: [ids] })`: messages to chosen members, in order from each sender.
  - `ui: { button: false }` plus `p3p2.open()`: our own button opens the panel. `ui.chatKey` moves the chat
    key.
  - `game.version`: keeps different builds out of each other's rooms.
  - `P3P2.isTyping`: true while the player types in the panel.
- **Defaults that matter:**
  - **The panel's chat opens on Enter**, which also fires a shot here.
  - **The server's limits:** 16 players a room, 64 KB a message, and 90 messages and 256 KB a second per
    player.
- **No list of player values.** A player value (`retain: 'player'`) can only be read with
  `room.retained(ch, { player: pid })`. The client keeps them all, but the API can't list them. So a
  late joiner can't find the results of players who left before they came.
  - **The log solves this:** a newcomer is handed every op.
  - p3p2's own docs (`sharing-state.md`) recommend it for a race: "the log for the results".
- **Two tabs of one browser are one player.** The second tab takes the first one's place in the room. So
  watching a friend in a second tab would throw your own game out of the room, and the watch screen has to
  live inside the game's one page.

**p3p2.me** is the project's page. It explains rooms, and it points to a free temporary server, **p3p2 hub**
(hub.p3p2.me):
- one room of up to 5 players;
- deleted 5 minutes after the last player leaves, or after 60 minutes.

Getting a room takes three steps: make a server (or use a friend's), create a room *for the game's address*
in its portal, and paste the room URL into the game. Our link has to say that the portal asks for the game's
address.

**A local server for testing** comes from `doublependu/p3p2`. I cloned it, at commit `ac08884`.
- **How it runs:** Node 24 with SQLite. Its `package.json` starts it with `node server/src/main.ts`, on port
  8080 by default. I read this but haven't run it yet. This machine has Node 24.21 and no Docker.
- **The owner password:** `P3P2_OWNER_PASSWORD` sets it, so no setup link is needed.
- **Rooms need no browser.** The portal's forms are plain HTML posts:
  1. `POST /login` with the password, and an `Origin` header that matches the server, gives a cookie.
  2. `POST /rooms` with `game`, `name` and `origins` redirects to `/room/<key>`.
- **A room can accept several sites.** `origins` takes extra addresses, so one room can serve `localhost`,
  the LAN address, the dev port and the preview port.
- **A test proxy for bad connections:** `e2e/tools/lag-proxy.ts` adds latency, jitter and dropped
  connections.

**Boards are already the same in every browser.**
- `generateLevel(level, seed)` uses mulberry32 (integer maths), `Math.round` and `floor`, a shuffle with a
  fixed number of draws, and plain arithmetic.
- These give the same bits in V8, SpiderMonkey and JavaScriptCore.
- Playwright's Firefox and WebKit are installed, and Chrome is (the tools use `channel: 'chrome'`).

**Hands are not the same.**
- `Game.deal` is one random stream for the whole run, and it picks only among the colours *now on your
  board*. So as soon as two players' boards differ, their hands drift apart, even in level 1.
- The hand also carries over from one level to the next.

**Replaying a shot isn't exact across browsers.** `traceShot` uses `Math.cos`, `Math.sin` and
`Math.hypot`, which can differ in the last bit between engines. So no page may treat its own replay of
another player's shot as the truth.

**The game has no clock.** A run ends when the bubbles overflow or the moves run out. A race needs no shared
start, and time spent watching costs nothing.

**Sizes and code facts:**
- **A saved run** (`Game.serialize()`) is 1.0 KB of JSON at level 1, 1.8 KB at level 10 and 5.5 KB at
  level 30. It holds no bubble ids, so two copies of one state compare equal as strings.
- **The loading budget has room:**
  - before Play: 136 KB of brotli JS, of 250 KB;
  - the HTML: 4.2 KB of 10 KB.
- **One controller drives one view.** `app.js` is one closure around one `View` and one `game`.
  - `newGame(g)` already resets timers, effects and the view to any `Game`.
  - `View.sync()` rebuilds the bubbles from a board each time, so jumping to another state is cheap.
- **A change of place costs a rebuild.** `View.setPlace` disposes the old place, so switching back builds
  it again.

## Feature 1: Race mode

### What the player sees

**Opening a room (player 1).**
- **The button:** on the title screen and the pause screen there is a **Play with friends** button. Under
  it, two small lines:
  - *Racing needs a room URL from a p3p2 server. Get one at [p3p2.me](https://p3p2.me).*
  - *When the portal asks for the game's address, give it `bubbler.example`.* The address is
    `location.host`, filled in at run time.
- **The panel:** the button opens p3p2's panel, where you paste the room URL and type your name. It gives
  an invite link, a QR code and chat.
- **The start card:** once the room is open, a card reads *Room open. Same bubbles for everyone. Your own
  run is saved.* Pressing **Start the race** begins the race run with the level-1 fly-over.

**Joining (friends).** Opening the invite shows p3p2's *Join?* over the loading screen. After Join, the
title button reads **Start the race** (or **Continue the race · level N** after a reload). A late
joiner plays the same run from level 1. With no clock, arriving late is no handicap.

**While racing** the screen is the usual game, with one more line in the top bar:

```
 ┌──────────────────────────────────┐
 │ ⏸        12,340        LEVEL     │
 │      2nd of 4 · Ada 14,200   7   │   ← the race line; tap it for the standings
 ├──────────────────────────────────┤
 │        (your bubbles only)       │
```

- **The race line** sits under the score. On a narrow phone it shortens to *2nd of 4*.
  - In a race the top bar grows by one line.
  - The field already makes room for it: `view.topPx` is read from the bar's height.
  - No bubble, boost or launcher is ever covered.
- **The standings sheet** opens on a tap.
  - One row per player: rank, name, level, score, and a status (playing, out of moves, finished, away,
    left).
  - Each row has a **Watch** button, and the sheet has **Friends & chat** (opens the panel) and **Close**.
  - Players who left keep their row with their last score, greyed.
  - The game simply waits while the sheet is up; there is no clock to stop.

**The watch screen.**
- **What it shows:** the view switches to the other player's board, in their place, with their bubbles in
  hand. Their shots fly and pop as they take them, and their aim line moves.
- **The HUD** shows their score, level, moves and gems. Boosts and input are off.
- **The banner** reads *Watching Ada · ◀ ▶ · Back to my game*. ◀ and ▶ step through the players, and Esc
  also goes back.
- **Your own run waits.** **Back** puts your own board, hand, place and HUD back exactly as they were. Your
  saved state is the truth, so nothing has to be paused.
- **No looking ahead.** While your own run is live, you can't watch a board on a level you haven't reached
  yet. Everyone has the same boards, so that would show you what's coming. Such a row reads *Ada is ahead
  (level 9): you can watch once you're there, or when your run ends*. Once your run is over, you can watch
  anyone.

**Game over** in a race adds the standings to the card. They update live while others play on. The card
offers three buttons:
- **Watch:** anyone still playing.
- **Rematch:** a new race with a new seed.
- **Back to my game:** leave the room and return to your solo run.

**Other rules:**
- **One attempt per race.** In a race, the pause screen's *Restart run* becomes **Leave race**. Otherwise a
  player could replay boards they already know.
- **A reload** resumes the race run where it stood, as it does for solo runs. p3p2 puts the page back in
  the room by itself.
- **When the room closes** (left, ended, lost, kicked, or opened in another tab), a card says why. **Back to
  my game** returns to the solo run. The race run stays saved, and comes back if you rejoin the same race.

### Fairness: the same bubbles for everyone (`src/core/game.js`), done

The boards already matched. This change makes the deal match too. It is built and tested (option 2 of the
two below).

- **The colour of the n-th bubble dealt in a level is set by the seed, the level and n.** It no longer
  depends on how you played.
  - At each level start, `#startLevel` opens the level's **queue**, drawn from `createRng(mixSeed(seed, 7919
    + level))`.
  - The queue runs the old rule, a random colour unless one has waited `DROUGHT` places, over every colour
    in the level, Mist-hidden ones included (`Board.allColors()`).
- **When the queued colour isn't one you can match now** (you cleared it, or it's still under Mist), a
  stand-in is dealt instead.
  - The stand-in is `colors[mixSeed(mixSeed(seed, 7919 + level), n) % colors.length]`. That is integer
    maths only, so it is the same in every browser.
  - This keeps the old promise: you're never dealt a colour you can't play.
  - `#refreshHand` picks its stand-ins the same way, numbered down from −1 so they never meet a deal's.
- **The hand carries over between levels**, as before. Every player starts a level with the same board, and
  is dealt the same queue from its first bubble. Only the two bubbles carried in from the last level differ,
  and they come from how you played, like caught specials.
- **What it gives:** players are dealt the same colour on the same deal of a level unless their boards
  offer different colours at that moment. Moves, gems and score carry over as before.
  - A test with two players aiming differently: the deals matched 183 times out of 183 where the boards
    offered the same colours. Under the old rule the same check matched only 86 of 189.
- **The saved run** is now `v: 2`, which saves `palette`, `dealt` and `fixes` in place of the random
  stream's state.
  - `Game.load` still reads `v: 1`. Such a run deals from the start of its level's queue.
- **It applies to solo play too.** One rule set is simpler than two, and the race is then exactly the game
  you practise alone.
  - The cost: a given seed now plays differently. Seed 177's run from plan 2 no longer reproduces. The
    videos are made; a new recording would need a new run search.

**Why not a fresh hand at each level start?** I measured both options with the tuning bots, each on the
same seeds under the old rule and the new one.
- **A fresh hand made the game easier.** The greedy bot reached +0.44 levels further on average (95% range
  +0.14 to +0.74), with scores up about 7%. The queue alone changed nothing measurable (+0.06, −0.25 to
  +0.35).
- **The rule as built changes no bot's difficulty measurably:**

| Bot (seeds) | Average level, old → new | Difference (95% range) | Average score |
|---|---|---|---|
| Greedy (400) | 18.1 → 18.1 | 0.0 (−0.3 to +0.3) | +0.9%, within noise |
| Casual (400) | 10.1 → 10.3 | +0.2 (−0.1 to +0.4) | +5.5%, within noise |
| Expert (200) | 22.0 → 22.0 | 0.0 (−0.5 to +0.5) | −0.5%, within noise |

Second Winds, gem gifts and shots that remove nothing are unchanged too. One run to the next varies by
about 3 levels for the same bot.

### What goes where in the room

| What | How | Why |
|---|---|---|
| The race: `{t:'race', id, seed, after}` | **log op** | The current race is the last one applied. An op counts only if `after` names the current race. Two Rematch presses at once give one race on every page |
| A standing: `{t:'score', race, name, lv, sc, shots, st}` | **log op**, at the race start, every level start, when the page goes to the background, and at the run's end (`st`: playing, over or left) | Late joiners get every op, so the standings include players who left before they came |
| Live state: `{r, lv, sc, mv, st, w, a?}` | **presence** | Latest only, and gone when the page closes. `w` is the member being watched. `a` is the aim angle, set only while someone watches me |
| A watched run: `{n, ev, a?, s}` | **message** `play`, `to:` the members whose presence names me in `w` | Sent only to watchers. `s` is `serialize()`, at most ~6 KB, well under the 64 KB cap |

- **The first race:** after the log has been read, a page that finds no race submits one with
  `after: null`. If two pages do it at once, the log orders the two ops and the second is dropped.
- **Snapshots:** the host's `save()` returns the current race and the standings of the last 3 races. The
  server asks the host for one as the log grows.
  - The host does nothing else. No page runs anything for the others.
- **The standings sheet** merges the two sources:
  - the log's last `score` op per player in this race;
  - live presence for players who are here;
  - the member's state (`here`, `away`, `lost`, or not in the room).
- **Ranking:** by score, with the level beside it.
- **Players in an older race** are listed under *Between races*.
- **Rematch:** anyone whose run is over can start one.
  - Players still playing see *Ada started a new race · Join now / when you finish*.
  - Joining now ends your current race run at its present score.

**Watching, step by step.**
1. **The request:** the watcher sets `w` to the player's member id.
2. **The answer:** the watched page sees it in presence and sends `play` with `ev: 'sync'` and its current
   state.
   - A page that comes back after a reload reads `room.presence.get()` for every member, and answers
     watchers it already has.
3. **Every change after that** sends `play` with `ev` (shot, swap, comet, clear, revive, level or over), the
   shot angle `a`, and the state `s` afterwards.
4. **The animation:** the watcher calls the same method on its copy (`fire(a)`, `swap()`, `buyComet()`,
   `buyClear()`, `revive()`, `nextLevel()`, `endRun()`). The result plays back through the controller's own
   shot playback.
5. **The check:** it then compares `copy.serialize()` with `s`.
   - If they differ (a last-bit difference between browsers), or a numbered `n` was missed, it jumps to
     `s` with `view.sync`.
   - At worst that is a visible jump, never a wrong board.
6. **The aim line** comes from the `a` in presence, drawn through `Smooth` from `@p3p2/client/smooth`
   (1.3 KB, lazy). Presence suits it: only the latest angle counts, and it is dated for smoothing.

**Game id and version.**
- **`game: { id: 'bubbler', version: BUILD_ID }`.** `BUILD_ID` is the commit's first 12 characters, from the
  same `commitSha()` that makes the version label, or `dev` in development.
- **Why the build:** two builds may deal differently, so a room keeps them apart, as p3p2's docs advise.

**Trust.** Every page could lie about its score. p3p2 is for friends, and no anti-cheat is planned.

### Code

**`src/net/friends.js`** (eager, about 2 KB of brotli with the p3p2 entry):
- **Setup:** `new P3P2({ game, ui: { button: false, chatKey: 't' } })`. `p3p2.start()` runs at boot,
  alongside `view.warmUp()`, so a reload into a room or an invite's *Join?* is settled before the title
  shows.
- **A room:** `p3p2.on('room')` imports `race.js`.
- **Buttons:** it exports `openFriends()` for the buttons.
- **An ordinary visit** makes no request and loads no other chunk.

**`src/net/race.js`** (lazy):
- **The log reader:** races, standings, snapshots, the first race and Rematch.
- **Presence:** setting our own, and reading everyone's.
- **The UI:** the race line, the standings sheet, the start card, the game-over standings, *Leave race*, and
  the room-closed card.
- **Switching runs:** solo `run` and race `race` (`{ id, state }`).
- **Watching:** `play` messages out to watchers, and in from the watched player. The copy, ◀ ▶, and the
  no-looking-ahead rule.

**`src/app.js`** gets a seat for the player and a small API, with no move of `resolve()`.
- **`start()` returns** `{ onChange, onPhase, useRun(game, slot), watch(copy, place), watchStep(ev, a, s),
  back(), showStandings }`.
- **`watching`** is a flag. While it is set:
  - input does nothing except Esc and the banner buttons;
  - `afterChange` saves nothing and tells the race module nothing;
  - `teach` and the controls hints stay quiet;
  - after a shot, the phase follow-ups (level card, Second Wind, game over) become a note in the banner.
    The watched page's next `play` carries the level change itself.
- **Watching needs no timers saved.** Your own `Game` already holds the truth after every method call, so:
  - **Going to watch:** save your own state, then `newGame(copy)` with `watching` set.
  - **Coming back:** `newGame(own)`. Then, as `begin()` already does, it shows the Second Wind card at
    *out of moves*, the game-over card at *over*, or unlocks.
  - **Cost:** at most a pop effect cut short.
- **Places while watching:** the view shows the watched player's place through the existing
  `prepare`/`swapPlace` veil, the same cost as a change of place between levels. No swap happens between
  players in the same place.
- **The save slot:** `afterChange` saves to the current slot (`run` or `race`). A race run counts towards
  `best` like any other.
- **Keys:** the key handler returns at once while `P3P2.isTyping`.
- **The debug handle** gets `fingerprint(level)`, a hash of `generateLevel(level, seed)` and the first 40
  items of the level's queue, and `watching`.

**`index.html`** (CSS stays inline, as everywhere else):
- **Buttons:** *Play with friends* and its two lines on the title and pause screens.
- **Race UI:** the race line, the standings sheet, the watch banner, the start card and the room-closed
  card, all `hidden` until a race.
- **Space:** about 0.5 KB of brotli.

**`vite.config.js`:**
- `optimizeDeps: { exclude: ['@p3p2/client'] }`, as p3p2's README asks;
- `define: { BUILD_ID }`.

**`package.json`:**
- `@p3p2/client` as a dependency;
- `npm run p3p2` and `npm run check:mp` (below).

**Load time:**
- **Before Play:** about 2 KB of brotli is added, and nothing is fetched from the network.
- **Later chunks:** the room client, panel, QR code, `race.js` and `Smooth` load only once a room opens.
  Each must pass `check-size`, under 20 KB.

### A local server: `tools/p3p2-local.js` (`npm run p3p2`)

1. **First run only:** clones `doublependu/p3p2` at commit `ac08884` into `.p3p2/src`. `.p3p2/` is added to
   `.gitignore`. Then it installs only the server workspace's dependencies.
2. **Starts the server** on port 8080 with:
   - `P3P2_OWNER_PASSWORD`;
   - `P3P2_DATA_DIR=.p3p2/data`;
   - higher connect and API rates, since every test player comes from 127.0.0.1.
3. **Makes the room:** logs in and creates (or reuses) a room with the two form posts above.
   - Its game URL is `http://<LAN address>:5173`.
   - Its extra origins are `localhost:5173`, and the LAN address and `localhost` on port 4173.
   - It prints the room URL and writes it to `.p3p2/room.txt`.
4. **`--lag`:** also starts p3p2's lag proxy on 8081 (150 ms, 50 ms jitter, a cut every 30 s), and prints
   the room URL through it.

**To play by hand:**
1. Run `npm run p3p2` and `npm run dev -- --host`.
2. Open the game at the LAN address and paste the room URL.
3. Open the invite in a second browser (not a tab), or on a phone on the same Wi-Fi.

### Tests

**Node** (`tools/test/race.test.js`):
- **Done, in `core.test.js`:**
  - *one seed deals everyone the same colours, however they play*: two players who aim differently, through
    16 levels;
  - *a run saved before the deal queue still loads and plays on*;
  - the existing tests that a dealt bubble is always a colour on the board, and that a run reloaded from
    `serialize()` mid-run plays on exactly as the original.
- **The watcher's replay:** method replay plus `serialize()` matches the sender's state over 500 shots from
  `sim-bot`. That covers the same-engine path; across engines, the browser test covers it.
- **The log reader:**
  - the first race and two Rematch ops at once (one wins);
  - standings for a player who left, as seen by a late joiner;
  - a snapshot and load round trip.

  Fed with made-up `LogEntry` objects, so no server is needed.

**Browser** (`tools/check-mp.js`, `npm run check:mp`, on the built site):
- **The setup:** it starts its own local server on a free port. It serves `dist/` with `tools/serve.js` and
  makes a room for that address, `?debug` included.
- **Fairness in three engines:** Chrome, Firefox and WebKit in one room get one race.
  - `fingerprint(level)` agrees for levels 1–40 on all three.
- **The race line:** a shot by A (`__bubbler.fireAt`) updates A's score in B's race line within 2 s.
- **Watching:**
  - B watches A, and B's watched board matches A's own after each of A's next 15 shots, Firefox watching
    Chrome.
  - B goes back, and B's own fingerprint, hand, place and score are as they were.
- **No looking ahead:** B can't open A's board while A is on a later level and B's run is live.
- **Reloads:** a guest's reload, and player 1's, resume the same race run at the same shot.
- **A late joiner** gets the same race, and sees the standing of a player who already left.
- **Rematch:** one press gives one new race for everyone. A player mid-run is asked, not switched.
- **Through the lag proxy,** with one cut: the standings and the watch screen catch up, and nobody's run is
  lost.
- **A phone** (360×640, touch, and 640×360): the race line, the sheet, the banner and the panel cover none
  of the launcher, boosts or moves.
- **An ordinary visit** makes no request beyond today's files. Checked on the page's network log.
- **Frame rate:** while watching, on the phone profile with 4× CPU throttle and the low tier, it reads
  `view.stats`. It must match solo play within 10%.

`npm run check:size` must pass, and `npm run perf` must show no change in time to Play.

## Feature 2: More games on Maize.Live

- **The link:** a pill styled like the GitHub one, **More games on Maize.Live**, going to
  `https://maize.live` with `target="_blank" rel="noopener"`.
- **Where it goes:** beside the fork pill on the loading/title screen and on the pause screen. The two
  pills sit in a row that wraps on narrow screens.
- **On the loading screen** it is plain HTML in `index.html`, so it shows before any script runs, like the
  fork link.
- **The URL** goes in `site.config.js` as `MORE_GAMES_URL`, next to `REPO_URL`. The same `html-vars` plugin
  fills it in.
- **Checks:** `check:size` (the HTML stays under 10 KB), and a look at 360×640.

## Order of work

1. **The Maize.Live links.** Small and independent.
2. **The per-level deal queue** in `game.js`, with the Node fairness tests and the difficulty check. Done.
3. **The seat in `app.js`** (`watching`, the slot, the returned API).
   - Solo play must behave exactly as before. `npm run record -- pilot` on a fresh seed checks it: the
     recorder compares every turn against the Node prediction.
4. **`tools/p3p2-local.js`** and a room by hand.
5. **`friends.js` and `race.js`, part 1:** the room, the log, the first race, presence, the race line,
   standings, the start card, leaving and the room-closed card.
6. **`race.js`, part 2:** watching, ◀ ▶, no looking ahead, Rematch, the game-over standings.
7. **`check-mp.js`,** then `check-size`, perf, and the phone layouts.
8. **The README** (racing, where to get a room, `npm run p3p2`, `check:mp`), then `ai/next_3.md`.

## Choices I made that you may want to change

- **The deal rule applies to solo play too** (built). The other way keeps old seeds as they were, at the cost
  of two rule sets.
- **No looking ahead while your run is live.** The other way is to let anyone watch anyone, and trust
  friends not to study the next level.
- **Ranked by score,** with the level beside it. The other way is level first, then score.
- **One attempt per race,** with no restart.
- **No synchronized start or countdown.** The game has no clock, so a shared start adds nothing to fairness.
- **The watch screen shows the other player's place,** which costs one place build each way. The cheaper
  way is to keep your own place behind their board.
- **p3p2's own panel** for the room URL, invite, QR code and chat, opened from our buttons. The other way is a
  menu of our own on the bare API (`ui: false`).

## Not covered

- **Cheating** between friends.
- **Spectators who don't play.** Anyone in the room can watch, but joining sets up a race run for you.
- **More than one race at a time** in one room.
- **Rooms that outlast the hub's 60 minutes.** That takes a server of your own; p3p2.me says how.
