# Next 3: what was built for prompt 3, and what comes next

Implements `ai/plan_3.md`: racing friends through `@p3p2/client`, and links to Maize.Live. Nothing is committed
or deployed.

## What a player gets

- **More games on Maize.Live.** A pill next to "Fork me on GitHub" on the loading/title screen and on the pause
  screen. On the loading screen it is plain HTML, so it shows before any script.
- **Play with friends.** A button on the title and pause screens, with a note under it:
  - where to get a room ([p3p2.me](https://p3p2.me));
  - the game's own address, which the server's portal asks for.

  It opens p3p2's panel: paste a room URL, get an invite link and a QR code. Friends open the invite and answer
  *Join?*.
- **A race.** Everyone in the room plays the same run.
  - **The race line**, under the score, says where you stand: *2nd of 3 · Ada leads 1,240*. Tap it for the
    standings: rank, name, level, score, and what each player is doing. Players who left stay in, greyed.
    Members in another race are named.
  - **Watch** shows another player's board in their place, shot for shot, with their aim line moving.
    - The banner reads *◀ Watching Ada ▶ · Back to my game*. ◀ ▶ and the arrow keys step through players; Esc
      goes back.
    - While your own run is live you can't watch a board on a level you haven't reached. If the player you are
      watching goes on ahead, you are taken back.
  - **The game-over card** shows the standings, live, with **Rematch** (a new race and seed for the room) and
    **Back to my game** (leave the room).
  - **Players still playing** when someone starts a new race keep their race. The race line offers the new one.
  - **One attempt per race.** In a race, *Restart run* becomes *Leave the race*. A reload carries on where you
    were, as in solo play.
  - **Opening a room in the middle of a solo game** asks first (*Start the race*). The solo run is kept, and
    comes back exactly as it was when you leave.
  - **When the room closes** (ended, kicked, lost, another tab), a card says why.
  - **Chat** is on T; Enter still fires.

## What was built

- **The deal** (`src/core/game.js`): option 2 from the difficulty check.
  - Each level deals from a queue of colours made from the seed and the level alone. A colour that can't be
    matched now gets a stand-in, picked with integer maths, so every browser picks the same.
  - The hand carries over between levels, as before. Saves are `v: 2`, and `v: 1` saves still load.
  - Solo difficulty is unchanged, measured on the same seeds before and after:
    - greedy bot (400 seeds): 0.0 levels (−0.3 to +0.3);
    - casual bot (400 seeds): +0.2 (−0.1 to +0.4);
    - expert bot (200 seeds): 0.0 (−0.5 to +0.5).
- **The controller** (`src/app.js`):
  - **Watch mode:** another player's game is played back through the same shot code, step by step. After
    each step the copy is checked against the state their page sent, and it jumps to that state if they differ.
  - **Your own run is parked, not paused.** Its saved state is the truth, so coming back reloads it.
  - **Save slots:** the solo run (`run`) or a race's (`race`, kept after it ends, so it can't be played twice).
  - **A small API** for the race module.
- **`src/net/friends.js`** (eager): about 2 KB of brotli with p3p2's entry. An ordinary visit asks no server
  anything.
- **`src/net/race.js`** (lazy, 5.4 KB brotli): the room.
  - **The log:** races and standings. A race op names the race it follows, so two Rematch presses at once give
    one race.
  - **Presence:** level, score, phase, who you watch, your aim while watched.
  - **`play` messages,** only to the members watching you.
  - **After a dropped connection** both sides resend, so a watcher never sits on a stale board.
- **`src/net/standings.js`:** the standings, pure, tested in Node.
- **`tools/p3p2-local.js`** (`npm run p3p2`):
  - fetches p3p2 at a pinned commit into `.p3p2/` (ignored by git);
  - starts the server on 8080;
  - makes a room for the dev server and the preview with two form posts to the portal (no browser), and reuses
    it.

  `-- --lag` adds p3p2's lag proxy on 8081.
- **`tools/check-mp.js`** (`npm run check:mp`, `-- --lag`), against a server of its own on the built site: **36
  checks.**
  - **Joining:** host through the panel, and join from the invite.
  - **The same race:** the same race and seed for everyone, and the same boards and queues for levels 1–40 in
    each engine.
  - **Standings:** the race line, and players who left still seen by a late joiner.
  - **Watching:**
    - the aim line follows;
    - 15 shots match;
    - a Chrome player follows a Firefox player shot for shot, through a level change;
    - no looking ahead;
    - your own run untouched.
  - **Coming back:** reloads of a guest and of the host.
  - **Rematch:** one new race, and a mid-run player is offered it.
  - **A room opened mid-game,** and leaving it.
  - **The room ended by its host.**
  - **Layout:** a phone upright and on its side, the title screen at 640×360, and an ordinary visit that loads
    nothing extra.
  - **Frame rate** while watching.
- **Tests:** `tools/test/race.test.js`, 7 tests:
  - the first race, and two Rematch presses at once;
  - a late joiner seeing a player who left;
  - a snapshot round trip, and malformed ops;
  - the order of the standings;
  - the watcher's replay matching the sender over at least 500 steps.

  `core.test.js` gained 2 tests for the deal; `autoplay.test.js` was updated.

## Measured

- **Tests:** `npm test`, 56 of 56.
- **The browser check** (`npm run check:mp`):
  - **The final build:** 36 of 36 plain, and 36 of 36 through the lag proxy (connections cut every 25 s).
  - **The build before the last 7 checks were added:** 3 plain runs and 6 lag runs in a row, 29 of 29 each.
- **Size** (`npm run check:size`):
  - before Play: 138.9 KB of brotli JS, +2.7 KB (budget 250); HTML 5.3 KB (budget 10);
  - later chunks: race 5.4 KB, p3p2's room client 7.3 KB, its panel 4.3 KB, its QR code 1.9 KB, each under
    20 KB.
- **Load** (`npm run perf`, this build against the last commit's, two rounds): Play can be tapped at
  1.28–1.30 s → 1.31 s on the phone profile, and 1.42–1.49 s → 1.39–1.46 s on the PC profile. That is no change
  beyond noise. The download is 3.8 KB larger.
- **Watching costs nothing extra:** 33 fps playing and 34 fps watching, on the phone profile with the CPU 4×
  slower and the low tier.

## Bugs found on the way

- **Presence after a reload.** Back from a reload, you showed as *about to start* until your next shot, and
  couldn't be watched. The app now tells the race module when play begins.
- **A dropped connection could lose a watch step.** p3p2 drops messages to a page that is reconnecting, and the
  watcher sat on a stale board until the next shot. Both sides now resend the whole run when the connection
  comes back.
- **The title on a phone held sideways** pushed both links off screen. This was tight before; the new button
  pushed it over. Short screens now get a tighter title, which scrolls as a last resort.
- **Test assumptions, not game bugs:**
  - one good shot can clear level 1, and everyone is dealt the same, so two players' first greedy shots score
    the same;
  - random aim could overflow a board.

  The check now aims from a seeded draw that never overflows or clears.

## Where this differs from the plan

- **The deal:** the hand carries over between levels (option 2). A fresh hand each level made solo play about a
  third of a level easier.
- **Room creation for tests** uses the portal's form posts, not Playwright, and rooms list extra origins, so one
  room serves localhost, the LAN address and both ports.
- **Not in the plan:** the resend after a dropped connection, the *Between races* note, and the shorter title
  on phones held sideways.
- **WebKit was not run.** Playwright's WebKit needs system libraries this machine lacks. The check falls back to
  a second Firefox and says so in its output. To include Safari's engine, run
  `sudo npx playwright install-deps webkit`, then `npm run check:mp`.
- **Seed 177's run from plan 2 no longer reproduces,** because the deal changed. The videos are made.

## Not verified

- **A real server:**
  - **hub.p3p2.me over https, and a deployed build.** Only the local http server was used.
  - **The room's game address.** The portal must be given the deployed site's address.
- **Real phones**, and Safari.
- **How watching feels.** Tests compare states and angles, not how smooth the playback and the aim line look.
- **The keys around chat:** T opens chat, and the `P3P2.isTyping` guard keeps typed keys out of the game.
- **One lag run in the first batch stopped on an exception** whose text wasn't kept. It did not happen again in
  the next 7 lag runs.

## What to work on next

1. **Deploy, then race for real:** a computer and a phone on hub.p3p2.me, with the room made for the deployed
   address. Watch each other for a few levels and judge the playback and the aim line by eye.
2. **Include Safari's engine:** install WebKit's libraries and run `npm run check:mp`.
3. **If people race in bigger groups,** a spectator who joins without starting a race run (now everyone in the
   room gets one).
4. **A new seed for the videos,** if they are re-recorded: `npm run autoplay` ranks seeds under the new deal.
