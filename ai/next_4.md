# Next 4: what was built for prompt 4, and what comes next

Implements `ai/plan_4.md`, as updated after the review: p3p2's client 0.2.0 with its own multiplayer button
and panel, and the link to Muon.Day. Nothing is committed or deployed.

## What a player gets

- **p3p2's multiplayer button** in the bottom-left corner, on every screen, as p3p2 draws it:
  - gray when you're alone;
  - teal and pulsing in a room, with the number of players;
  - a red count for unread chat.

  It opens p3p2's panel, which also opens from the bottom-left now.
- **Play with friends** stays on the title screen and opens the same panel. In a room it reads **Friends & chat**.
- **Gone:** the note under the button on the title screen, and the pause screen's **Play with friends** with its
  note. The corner button shows over the pause screen.
- **Outside a room** the panel says how to get a server, and to open the invite link from it.
- **Getting into a room:** the room's owner creates it in a p3p2 server's portal, presses **Open** on the room's
  page, and sends its invite link. Everyone joins through the invite, the owner too. Nothing is pasted into the
  game.
- **The room-closed card:** *The room's owner took you out of it* and *The room's owner ended the game*.
- **More games on Muon.Day** replaces the Maize.Live link, on the title and pause screens.
- **Racing itself is unchanged.**

## What was built

- **`package.json`:** `@p3p2/client` `^0.2.0`.
- **`src/net/friends.js`:** `ui: { corner: 'bottom-left', chatKey: 't' }`. The `.game-host` fill is gone.
- **`src/ui/hud.js`, `src/net/race.js`:** no note and no pause-screen button; the new closed texts.
- **`index.html`:**
  - the notes, the pause screen's button and the unused `.note` rules are gone;
  - **the safe-area rule** on `p3p2-panel`, so the button and panel keep clear of a notch or rounded corner;
  - **on narrow screens (460 px and under) every card stops above the button** (see below);
  - the `?debug` line moved right, out of the button's way.
- **`site.config.js`:** `MORE_GAMES_URL = 'https://muon.day'`.
- **`tools/p3p2-local.js`** (`npm run p3p2`):
  - pinned to p3p2 `v0.2.0` (`4602190`), and reinstalls when `.p3p2/src` is at another commit;
  - makes a room as the 0.2 portal does: the room, then a second post for the other sites;
  - **reads the invite from the room's page on every run**, and makes a new one when it has expired. It is
    never saved: `room.json` keeps only the room's page;
  - prints the invite for the dev server and for the preview, and through the lag proxy with `--lag`;
  - exports `createRoom` (`{ page, invite }`), `roomInvite` and `endRoom`;
  - the first run upgraded `.p3p2/data` in place, so a 0.1 server won't open it now. It is local test data.
- **`tools/check-mp.js`:** 44 checks, up from 36.
  - **Joining:** everyone opens the room's invite and answers *Join?*. The first check also confirms the invite
    keeps `?debug`.
  - **New:**
    - p3p2's button sits in the bottom-left corner and covers no control, in solo play and in a race (watching
      included), at 360×640, 390×844, 640×360 and 1366×768;
    - no button or link on the title, standings, pause or game-over screen is under it, scrolled to the end, at
      360×640 and 640×360;
    - after the panel is opened from the button and closed, Esc still pauses;
    - **Play with friends** on the title screen opens p3p2's panel, which links to p3p2.me outside a room.
  - **Rewritten:**
    - *Join? answered mid-game*: Gus opens an invite, presses Play and takes two shots while *Join?* waits,
      then joins. The start card asks first, his solo run waits, and it comes back exactly as it was after the
      race;
    - *the room ended by its owner*, through the portal: Cy reads *The room's owner ended the game.*
- **README:** racing in 0.2's terms, the temporary server as p3p2.me describes it, the corner button, and the
  tools table.

## Measured

- **Tests:** `npm test`, 56 of 56.
- **Size** (`npm run check:size`), against the last commit's build:
  - before Play: 139.1 KB of brotli JS (139.0 before); HTML 5.2 KB (5.3 before);
  - later chunks: p3p2's panel 5.1 KB (4.3 before), its room client 7.3 KB, its QR code 1.9 KB, race 5.4 KB,
    each under 20 KB.
- **Load** (`npm run perf`, this build against the last commit's, two rounds each): Play can be tapped at
  1.33 / 1.33 s → 1.31 / 1.35 s before on the phone profile, and 1.40 / 1.48 s → 1.42 / 1.52 s before on the PC
  profile. No change beyond noise. The download is 144.8 KB in both.
- **Where the corner button lands,** measured before writing the checks, in solo play at 360×640, 390×844,
  412×915, 640×360, 844×390, 768×1024, 1366×768 and 1920×1080: clear of every control at every size; nearest
  is 42 px away, at 360×640.
- **The browser check** (`npm run check:mp`):
  - **plain:** 44 of 44 in 4 of 5 runs. The fifth stopped while setting up Rematch: after Ada's moves were set
    to one, her shot didn't bring up the out-of-moves card. That step predates this change, and I didn't dig
    further.
  - **through the lag proxy:** 44 of 44 in 6 of 10 runs. The 4 failures:
    - **2 × a cut during Ada's reload.** If the connection is cut while a reloaded page reconnects, p3p2 forgets
      the room, and the page comes back to a solo title. This is p3p2's behaviour in 0.1.1 too: Ada reloading
      30 times through the proxy failed 3 times on the last commit's build and 2 times on this one.
    - **1 × a join cut mid-handshake.** p3p2 says it can't reach the server and offers Join again. The check now
      presses Join again, as a player would (up to three tries). It has done so twice since, and both joined.
      The same run had one frame-rate reading of 33 fps watching against 37 playing, just under the 90% bar.
    - **1 × the check's aimless shots overflowed Ada's board** on that run's seed: the helper falls back to a
      straight-up shot when none of its 40 tries looks safe. Also older than this change.

## Where this differs from the plan

- **The cards on narrow phones.** The plan gave the pause card bottom padding on short screens. Measuring
  showed the pause card wasn't the only one: in a race, the game-over and standings cards fill a 360×640 screen
  too, and a full-width last button would end a few pixels under the corner button. So on screens 460 px wide
  or less, every card stops above the button instead. Wider screens are untouched: there the cards never reach
  the corner.
- **The check presses Join again** when a join is refused because the first connection was cut. Under the lag
  proxy this happens now and then; the old check never sent Gus through the proxy.
- **Corrected in the plan before building**, from the review:
  - p3p2 0.2 does take focus off its panel when it closes, so the keys needed no fix of ours; the check stays;
  - invites expire, so `npm run p3p2` reads the invite each run instead of saving it;
  - the mid-game check covers the path that remains in 0.2: Play pressed while *Join?* waits.

## Not verified

- **A real server:** hub.p3p2.me over https, and a deployed build. Only the local http server was used.
- **The dev server by hand.** `npm run p3p2` was run and its invite checked, but the races were all played by
  `check:mp` on the built site, not in `npm run dev` in two browsers.
- **Real phones, and Safari.** WebKit still needs `sudo npx playwright install-deps webkit`; Firefox stood in.
- **iPhone safe areas.** Chromium reports none. The button and the panel move clear of the notch and the home
  bar, but on an upright iPhone a very tall panel could run about 22 px under the status bar: its height limit
  is p3p2's, inside its shadow root.
- **How the corner button feels to tap** on a phone, next to the moves count, and whether players notice it.

## What to work on next

1. **Deploy, then race for real** on hub.p3p2.me: make the room with the deployed address, press **Open**, and
   join from a phone with the invite. Look at the corner button on an iPhone held both ways.
2. **Tell p3p2 about the reload that forgets the room.** A reloaded page tries its first connection once: if
   that one is cut, `resume()` drops the session, and the player has to open the invite again. Retrying a few
   times, as it does for a dropped connection, would fix it. It is p3p2's code, in 0.1 and 0.2 alike.
3. **Steady the check's own shots:** the aimless-shot helper (overflow on some seeds) and the Rematch setup (a
   shot that doesn't use the last move). Both are older than this change, and each failed one run in about ten.
4. **Include Safari's engine:** install WebKit's libraries and run `npm run check:mp`.
5. **If people race in bigger groups,** a spectator who joins without starting a race run.
6. **A new seed for the videos,** if they are re-recorded.
