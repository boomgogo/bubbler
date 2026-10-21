# Plan 3: racing friends through p3p2, and links to Maize.Live

Answers `ai/prompt_3.md`. Two features:
1. Multiplayer through `@p3p2/client`. Everyone plays the same run, sees only their own bubbles plus the
   others' level and score, and can switch to a separate screen to watch someone else play.
2. A "More games on Maize.Live" link on the loading screen and the pause screen.

Nothing here is implemented yet.

## What I checked today (the facts this plan is built on)

- **`@p3p2/client` 0.1.1** (MIT, no dependencies, published 5 days ago). The `P3P2` entry is 1.9 KB gzip and
  asks no server anything on an ordinary visit. When a room is opened it loads the room client (~9 KB gzip)
  and the 👥 panel (~5 KB gzip). The panel gives a room URL field, the invite link, a QR code, "Join?", the
  member list and chat.
- **What p3p2 provides that we will use:**
  - `room.offer(channel, value)`: whoever comes first decides, and everyone gets the same answer.
  - `room.presence.set()`: one small value per member, the latest only, at most 20 a second.
  - `room.send(…, { retain: 'player' })`: one saved value per player that outlives the page.
  - `room.send(…, { to: [ids] })`: messages to some members only.
  - `Smooth` (1.4 KB, optional): draws a remote value smoothly.
  - `ui: { button: false }` plus `p3p2.open()`: our own button opens the panel. `ui.chatKey` moves the chat
    key off Enter.
  - `game.version` keeps different builds out of each other's rooms.
- **A local server.** The server is Node 24 plus SQLite, in `doublependu/p3p2`.
  - This machine has Node v24.21 and no Docker, so the server runs from a checkout with `npm run dev`
    (port 8080).
  - `P3P2_OWNER_PASSWORD` sets the owner password without the setup link.
  - Rooms are made in the portal: log in, then Game URL, Room name, Create room. The repo's
    `e2e/tests/helpers.ts` (`createRoom`) does this with Playwright.
  - A room accepts only the game URL it was made for, so local tests use the LAN address, not `localhost`.
- **Same seed, same levels, in every browser.**
  - `generateLevel(level, seed)` uses only the integer generator (mulberry32) and rounding. It has no
    `Math.sin`, `pow` or random-comparator `sort`, so Chrome, Firefox and WebKit build the same boards.
  - Playwright's Chromium, Firefox and WebKit are installed, so this can be tested.
- **The deal is not yet the same for everyone.** `Game.deal` is one stream for the whole run.
  - Level 1 is identical for two players who shoot identically.
  - From level 2 on, the hand depends on how many bubbles each player was dealt earlier, so two players
    start level 2 with different bubbles.
  - The hand also carries over from the previous level.
- **The game has no clock.** A run ends when you overflow or run out of moves (Second Wind aside). So a race
  needs no shared start, and watching someone costs you nothing.
- **There is one WebGL view.** `app.js` owns one `View` and one `Game`, and plays a shot back through
  `resolve()`, which is about 100 lines inside the controller.
- **Keys:** Enter fires a shot (`app.js`, keydown on `window`), and Enter also opens p3p2's chat by default.
- **Budgets** (`tools/check-size.js`):
  - before Play: 250 KB of brotli JS, 10 KB of HTML;
  - each later chunk: 20 KB.

## Feature 1: Race mode

### What the player sees

**Player 1 (the one with a room):**
1. On the title or pause screen, press **Play with friends**. Under it is a line: *Needs a room URL —
   get one at [p3p2.me](https://p3p2.me)*.
2. The p3p2 panel opens. Paste the room URL and type a name. It gives back the invite link and a QR code.
3. A race starts at once with a fresh seed. Player 1's solo run is set aside, not lost.

**Friends:** they open the invite, answer *Join?*, and get the same race from level 1. A player who arrives
late still plays the same run. There is no clock, so arriving late is fair.

**While racing:**
- **The usual HUD.** The player's own board and bubbles, as now.
- **A rivals strip.**
  - It sits under the top bar, at the right edge, where nothing of the board sits.
  - Collapsed it shows your rank (`2nd of 4`) and the leader's score.
  - Tap it to open a list with one row per player: name, level, score, and a status (playing, out of
    moves, finished, away). Players who left keep their row with their final score, greyed.
  - A ▶ on each row opens the watch screen.
- **The watch screen.**
  - The view switches to the other player's board, place and bubbles in hand, and shows their shots as they
    take them, with their aim line moving.
  - The HUD shows their score, level, moves and gems.
  - A banner at the top reads *Watching Ada · ◀ ▶ · Back to my game*. ◀ and ▶ step through the players.
  - Your own run waits exactly where you left it.
- **Game over** adds the race standings to the card, updating live. It offers **Watch** (anyone still
  playing) and **Rematch**, which starts a new race with a new seed for the whole room.
- **One attempt per race.** In a race, the pause screen's *Restart run* becomes *Leave race*. Otherwise a
  player could replay a layout they already know. A reload resumes the race run where it was, as solo runs
  do now.

### Fairness: the same bubbles for everyone (`src/core/game.js`)

The boards already match. The deal is made to match per level:
- At the start of each level, reseed the deal from the seed and the level number:
  `createRng(mixSeed(seed, 7919 + level))`.
- Deal a fresh hand of two at the start of each level instead of carrying the old one over. Specials that
  were caught or bought still carry over. They were earned, and every player has the same chance at them.
- **Result:** everyone starts every level with the same board and the same first two bubbles, and anyone
  who plays the same shots gets the same deal throughout.
- Moves and gems still carry over, since they are the score of how you played.

**Apply it to solo play too.** One rule set is simpler than two. Old saved runs still load, and the reseed
just takes over at their next level.

**Cost:** existing seeds (seed 177 from plan 2) play differently afterwards. The videos are already made; a
re-render would need a new run search. `npm run tune` is re-run to confirm the difficulty curve hasn't moved.

### What goes where in the room

| What | How | Why |
|---|---|---|
| The race: `{ id, seed, by }` | room value `race`. On open: `room.offer('race', fresh)`. On Rematch: `send('race', fresh, { retain: 'room' })` | everyone builds the same run. `offer` settles two who arrive at once |
| Live standing: `{ race, lv, sc, mv, st, w }` (`st`: playing, nomoves, over or watch; `w`: the member watched) | presence, set after every change | small and latest-only; a closed page drops out by itself |
| Final result: `{ race, score, level, shots }` | player value `result` (`retain: 'player'`) | survives the player leaving, so the standings stay complete |
| Full state for watchers: `{ n, ev, a, s }` | message `play`, `to:` the members whose presence `w` is me | sent only when someone watches; one message per change |
| Aim for watchers: `{ a }` | message `aim`, volatile, `to:` watchers, at most 15 a second while aiming | the watcher sees the aim line move; dropped if late |

- **`s` is `game.serialize()`**, about 3 KB of JSON. That is well under the 64 KB message cap.
- **`ev`** says what changed: shot, swap, comet, clear, revive, level or over.
- **`a`** is the shot angle.
- **A new watcher** gets a `play` with the current state as soon as their presence names this player.
- **No page re-simulates another player's run.** Each page sends its own state, which is the truth. So
  browsers whose floating-point maths differ in the last bit can't drift apart.
- **The watcher animates a shot by replaying it on its copy.** It loads its copy from the previous `s`,
  calls `fire(a)` on it, and plays the result back.
  - Then it compares the copy to the `s` that came with the shot. If they differ, it snaps to `s`
    (`view.sync`). At worst that is a visible jump, never a wrong board.
  - If a message was missed (the `n` numbers skip), it syncs at once.

**Game id and version.**
- `game: { id: 'bubbler', version: BUILD_ID }`. `BUILD_ID` is the commit's first 12 characters, set in
  `vite.config.js` from the same `commitSha()` that sets the version label.
- Two builds may deal differently, so a room keeps them apart.

**Trust.** p3p2 is for friends: every page could lie about its score. No anti-cheat is planned.

### Code

**`src/net/friends.js`** (eager, about 2.5 KB with the p3p2 entry):
- Builds `new P3P2({ game, ui: { button: false, chatKey: 't' } })`, then `await p3p2.start()` at boot. This
  covers a reload back into the room, and *Join?* for an invite.
- `p3p2.on('room')` dynamically imports `race.js`.
- Exposes `openFriends()` for the buttons.
- An ordinary visit makes no network request.

**`src/net/race.js`** (lazy chunk):
- The race value, presence, results and standings.
- Switching between the solo run and the race run. They are stored under `run` and `race-run:<id>`.
- Rematch, leave and `p3p2.on('leave')`. When the room is over, you go back to your solo run.

**`src/net/watch.js`** (lazy):
- The watch controller. It keeps a `Game.load()` copy per watched player and drives the view and HUD from
  it.
- Input is off. The aim comes through `Smooth` from `@p3p2/client/smooth`.

**`src/play/playback.js`** (new):
- `resolve()`'s visual half moves here out of `app.js`: pops, blasts, drops, tallies, scroll and gifts.
- Both your own game and the watch screen play shots through it.
- `app.js` keeps the rules side: `afterChange`, phases and unlocking.

**`src/app.js`** gets a small surface for the race module:
- **Hooks:** `onChange(ev, game, angle)` fires after every change, and an `onPhase` hook fires.
- **Run handling:** `useRun(game)` to switch runs and `park()`/`unpark()`.
- **Places:** `showPlace(id)` reuses `prepare`/`swapPlace`.
- **Parking (`park`):**
  - It is allowed only while your game is idle: aiming, out of moves, or over.
  - A fly-over in progress is skipped first.
  - Pending timers are saved as time remaining, because the view's clock keeps running while you watch.
  - `unpark` puts back your board, hand, place, music and timers.
- **Watching stays in one view.** It never starts a second WebGL context, so it costs what playing costs.
  That matters on the low-end phones the spec names.

**`src/ui/hud.js` + `index.html`:**
- **Play with friends** on the title and pause screens, with the p3p2.me line.
- The rivals strip and list, and the watch banner.
- The standings block on the game-over card.
- *Leave race* in place of *Restart run* while racing.
- A key handler that ignores keys while `P3P2.isTyping`.
- In landscape the strip sits right of the score. In portrait it sits under the level, within `--top`. It
  is checked at 360×640.

**`vite.config.js`:**
- `optimizeDeps: { exclude: ['@p3p2/client'] }`, as p3p2's README asks.
- `define: { BUILD_ID }`.

**`package.json`:**
- `@p3p2/client` as a dependency.
- `npm run p3p2` (below).

**Load time.** About 2 KB of brotli is added before Play. Everything else loads only when a room opens.
`check-size` must pass, with every new lazy chunk under 20 KB.

### A local server for testing: `tools/p3p2-local.js` (`npm run p3p2`)

1. Clones `doublependu/p3p2` at a pinned commit into `.p3p2/` (added to `.gitignore`), runs `npm install`
   and `npm run build`. It does this only the first time.
2. Starts the server on port 8080 with `P3P2_OWNER_PASSWORD` and a data folder in `.p3p2/data`.
3. Logs in to the portal with playwright-core and creates a room whose game URL is
   `http://<LAN address>:5173`. It prints the room URL.
4. Optional, `--lag`: p3p2's `npm run lag` proxy on 8081 (150 ms latency, jitter, drops).

To play by hand:
- run `npm run p3p2` and `npm run dev -- --host`;
- open the game at the LAN address and paste the room URL;
- open the invite in another browser or on a phone on the same Wi-Fi.

### Tests

**Node** (`tools/test/race.test.js`):
- Two games with one seed, played with different shots through level 1, start level 2 with identical
  boards and hands.
- A game reloaded from `serialize()` mid-level deals what the original deals.
- An old saved run (v1) loads and reseeds at its next level.
- The watcher's replay of a shot matches the sender's state, over 200 recorded shots from `sim-bot`.

**Browser** (`tools/mp-check.js`, `npm run check:mp`, playwright-core against the local server):
- **Two players.** Chromium and Firefox join one room and get the same race seed. Their level-1 board
  fingerprints match, and so do their level-5 ones (reached by `?debug` jumps).
- **The rivals strip.** A shot by A updates A's level and score in B's strip within a second.
- **Watching.**
  - B watches A, and the board B shows matches A's after each of A's next 10 shots.
  - B goes back, and B's own board, hand and place are as they were.
- **Reloads.** A guest reload resumes the same race run at the same shot. Player 1's reload is checked the
  same way.
- **A rematch** gives everyone a new seed. A player mid-run is asked before switching.
- **Through the lag proxy:** the strip and the watch screen still converge.
- **A phone layout** (360×640, touch): the strip and banner don't cover the launcher or the boosts.
- **An ordinary visit** makes no request to any p3p2 server (checked on the page's network log).

`npm run perf` is run during a watch, on the low tier, to check frame rate against the solo baseline.

## Feature 2: More games on Maize.Live

- On the title/loading screen and on the pause screen, add a pill styled like the GitHub one:
  **More games on Maize.Live** → `https://maize.live`, with `target="_blank" rel="noopener"`.
- On the loading screen it is plain HTML in `index.html`, so it shows before any script, like the fork link.
- Put the URL in `site.config.js` next to `REPO_URL` (`MORE_GAMES_URL`), filled in by the same `html-vars`
  plugin.
- `check-size`: the HTML stays under 10 KB brotli.

## Order of work

1. The Maize.Live links (small, independent).
2. Per-level deal and Node fairness tests. Re-run `npm run tune` to confirm difficulty.
3. Extract `playback.js` from `app.js`. Your own game must play exactly as before: compare a recorded run
   from `tools/record.js` before and after, frame state at each turn.
4. `tools/p3p2-local.js` and the local room.
5. `friends.js` and `race.js`: rooms, the race, presence, results, the rivals strip, game-over standings,
   leave and rematch.
6. `watch.js`: park and unpark, play messages, aim, ◀ ▶.
7. `mp-check.js`, `check-size`, perf on the low tier, phone layout.
8. Update the README (how to race, and how to get a room) and write `ai/next_3.md`.

## Choices I made that you may want to change

- **Ranked by score**, with the level shown beside it. The alternative is level first, then score.
- **One attempt per race**, and no restart.
- **No synchronized start or countdown.** The game has no clock, so starting together adds nothing to
  fairness.
- **The per-level deal applies to solo play too**, which changes the run for any given seed.
- **The p3p2 panel is used as it comes** (paste a URL, invite, QR, chat), opened from our own button. The
  alternative is a menu of our own on the bare API (`ui: false`).

## Not covered

- Cheating between friends.
- More than one race per room at a time.
- Spectators who don't play: anyone in the room can watch, but joining a room still sets up a race run.
