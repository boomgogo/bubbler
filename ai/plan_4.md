# Plan 4: p3p2 0.2, its own multiplayer button, and a link to Muon.Day

Answers `ai/prompt_4.md`. Two changes:
1. **p3p2 0.2.0.** The client goes from 0.1.1 to 0.2.0.
   - The game shows p3p2's own multiplayer button in a corner, and p3p2's own panel, as they come.
   - **Play with friends** stays on the title screen and opens the same panel. The note under it goes.
2. **More games on Muon.Day** replaces the Maize.Live link.

**Not built yet.**

## Why we didn't use p3p2's button, and why we can now

This answers the question in the prompt.

- **The panel (the box) was always p3p2's own.** We open it as it comes, with `p3p2.open()`. What we replaced is
  the button that opens it: `ui: { button: false }`, our own **Play with friends** button, and a note under it.
- **Plan 3 never wrote down why.** There were two reasons:
  1. **The default corner, top-right, sits on the level number on every phone,** and top-left sits on Pause.
     The table below shows where p3p2's button would land on the last build.
  2. **0.1 needed words of our own.** Its panel asked for a room URL to paste. Our note said where to get one,
     and which game address to give the server's portal.
- **Neither reason holds now:**
  - **Bottom-left is clear of every control at every size I measured.** `ui: { corner: 'bottom-left' }` puts the
    button there.
  - **0.2 has no room URL.** Everyone joins through the room's invite link, the server's owner too.
    - Outside a room the panel explains this itself: *Share one small p3p2 relay server. Already have one? Open
      the invite link from the server. No server yet? p3p2.me says how to get one.*
    - Our note would now be wrong, and it repeats the panel.
- **p3p2's button shows two things ours can't:**
  - its mark is teal and pulses while the room's server is heard from, and gray while you're alone or
    reconnecting;
  - unread chat shows as a red count on it.

**Where p3p2's button would land, measured.** The button is a 16 px mark in a pill, about 42×34 px, 12 px from
the corner. I measured on the last build (`dist/`), in play, against Pause, the score, the level, the progress
bar, moves, gems, swap and both boosts.

| Viewport | Top-left | Top-right | Bottom-left | Bottom-right |
|---|---|---|---|---|
| 360×640, 390×844, 412×915 (phones) | **Pause** | **Level** | clear | clear (version label) |
| 640×360, 844×390 (phones on their side) | clear | clear | clear | clear (version label) |
| 768×1024 (tablet) | clear | clear | clear | clear (version label) |
| 1366×768, 1920×1080 (PC) | clear | clear | clear | clear (version label) |

On the title screen every corner is clear except bottom-right, where the version label is.

**Three small things the corner button needs from us:**
- **iPhone safe areas.** The page uses `viewport-fit=cover`, and p3p2 sets the button 12 px from the edge, with
  no safe-area inset. On an iPhone on its side, that puts it under the notch or the rounded corner.
  - **The fix,** one CSS rule:
    ```css
    p3p2-panel { left: max(12px, env(safe-area-inset-left)) !important; bottom: max(12px, env(safe-area-inset-bottom)) !important; }
    ```
  - **Why it works:**
    - `p3p2-panel` is the element p3p2's own docs name, in their advice on touch handling.
    - `!important` beats the position p3p2 sets inline.
    - The panel opens from the same element, so it moves too.
- **The pause card on a small phone.** At 360×640 the card fills the screen and scrolls. The button would sit
  over the *How to play* text. That is text, not a button, but what scrolls past runs under it.
  - **The fix:** on short screens the card gets bottom padding as tall as the button, so its last items scroll
    clear.
  - Taking *Play with friends* off the pause screen (below) also shortens the card by about 110 px.
- **The `?debug` line** sits in the bottom-left corner. It moves right by the button's width. Only `?debug`
  shows it.

**Also to check: keys after the button is clicked.**
- `P3P2.isTyping` is true whenever focus is on p3p2's element, and the game ignores keys while it is.
- p3p2 0.2 handles this itself: closing the panel (× or Esc) takes focus off whatever in it had it, and keys
  pressed inside the panel never reach the page.
- **The test:** a new check confirms Esc still pauses after the panel is opened from the button and closed.

## Feature 1: p3p2 0.2.0

### What 0.2 changes

From the release notes, `docs/integrate.md` (*From 0.1 to 0.2*), the package's types, and the server's
`portal.ts` at the `v0.2.0` tag (commit `4602190`):

- **One way in.**
  - **The room:** the server's owner creates a room in the portal, and it has an invite link at once.
  - **Joining:** **Open** on the room's page opens the game with that link. The owner joins through it like
    everyone else.
  - **What's gone:** `p3p2.host()`, `room.isMod`, `room.kick()`, `room.end()`, and the error codes `room-url` and
    `room`.
  - **The room's page** in the portal is now where players are removed and the game is ended.
- **Front-page rooms.**
  - **What it is:** a server can list a room on its own front page, with the invite whole or with its last 2, 3,
    4 or 8 characters left out.
  - **Joining from it:** the panel's *Join?* asks for the missing characters, and for another name when the room
    already has yours.
  - **For us:** nothing to do. We use the panel's *Join?*.
- **Names.** A room refuses a name one of its members has, whatever the capitals. A name keeps letters and
  digits of any language, spaces, and `. - _ '`. The panel asks again.
- **`Smooth`** no longer carries a thing on when a report is late: `coast` is now 0 by default (it was 250).
- **The protocol is unchanged,** and a 0.2 server takes 0.1 clients. The deployed build keeps working until this
  one replaces it.
- **The button is drawn by the 1.7 KB entry.** The panel's code loads only when the button is pressed, so an
  ordinary visit still asks no server anything.

**Sizes,** brotli, measured on the two packages:

| Chunk | 0.1.1 | 0.2.0 | When it loads |
|---|---|---|---|
| Entry | 1.60 KB | 1.67 KB | Every visit, before Play |
| Room client | 7.97 KB | 7.92 KB | When a room opens |
| Panel | 4.57 KB | 5.43 KB | When the panel opens |
| QR code | 2.35 KB | 2.35 KB | With the invite |
| `Smooth` | 1.31 KB | 1.31 KB | With `race.js` |

Before Play grows by 0.07 KB. Every later chunk stays under 20 KB.

**Where 0.2 touches our code:**

| 0.2 change | Where we depend on it | What to do |
|---|---|---|
| No room-URL field, no `host()` | Not in `src/`; `check-mp.js` hosts through that field | The tests join through the invite |
| No `room.end()` | `check-mp.js` ends the room from the debug handle | End it through the portal |
| Only the server's owner removes players or ends the game | `race.js`, the `CLOSED` text, says *someone hosting the room* | New text |
| `Smooth` coasts 0 ms | The watcher's aim line | Keep the new default (below) |
| Creating a room takes no `origins` | `tools/p3p2-local.js` | A second post, to the room's settings |
| The invite comes from the portal | `tools/p3p2-local.js` prints a room URL | Print the invite link |

### What the player sees

- **The multiplayer button** sits in the bottom-left corner on every screen, from the moment the game's script
  runs. It is p3p2's mark on a dark pill:
  - gray when you're alone;
  - teal and pulsing in a room;
  - a red count for unread chat.
- **Play with friends** stays on the title screen and opens the same panel. In a room it still reads **Friends &
  chat**.
- **The note under it goes** from both screens, and so does the game's address shown in it.
- **The pause screen loses Play with friends** (my choice; see the end). The corner button shows over the pause
  screen too.
- **Outside a room,** the panel says how to get a server, and to open the invite link from it.
- **Getting into a room:**
  1. The owner creates a room in a p3p2 server's portal, giving the game's address.
  2. The owner presses **Open** on the room's page, or opens its invite link, and answers *Join?*.
  3. Friends open the same invite link.

  Nothing is pasted into the game.
- **The room-closed card:**
  - `kicked`: *The room's owner took you out of it.*
  - `ended`: *The room's owner ended the game.*
  - The other reasons are unchanged.
- **Racing itself is unchanged:** the same race, standings, watching and Rematch.

### The aim line and `Smooth`'s new default

- **Under 0.1,** when no report came, `Smooth` carried a thing on the way it was going for 250 ms. An aim line
  gets no report when the player stops moving it: presence never sends the same value twice. So a watcher saw the
  line overshoot where the player stopped, then drift back over a second.
- **0.2's default** holds the line at the last report. That suits an aim line: it never points where the player
  didn't aim. The cost: under lag the line pauses instead of guessing ahead.
- **No code change:** `new Smooth({ angles: [0] })` picks up the new default. The existing check *the aim line
  follows* must still pass.

### Code

- **`package.json` and the lock:** `"@p3p2/client": "^0.2.0"`.
- **`src/net/friends.js`:**
  - `ui: { corner: 'bottom-left', chatKey: 't' }`;
  - the `.game-host` fill goes.
  - Otherwise unchanged: `app.on('friends')` still calls `p3p2.open()`.
- **`src/ui/hud.js`:** no note to unhide, and no `btn-friends-p`.
- **`src/net/race.js`:**
  - the `CLOSED` text;
  - the list of friends buttons (line 405) loses `btn-friends-p`.
- **`index.html`:**
  - **Goes:** both notes, the pause screen's button, and the `.racing .friends-note` rule.
  - **Added:** the safe-area rule, the pause card's padding on short screens, and the move of `#debug`.
- **What stays:**
  - **Buttons that open the panel:** the start card's **Invite friends**, and the standings' **Friends & chat**.
  - **Keys:** `chatKey: 't'`, and `keysOff` with `P3P2.isTyping`.
  - **The room's version:** `game.version: BUILD_ID`.
- **The code for a room that opens mid-game** (the start card asks first) stays.
  - In 0.2 a room opens only from an invite link, and that link loads the page.
  - But *Join?* sits in a corner and doesn't block the game. A player can press **Play** and take shots before
    answering it, and the room then opens mid-game.
  - Its check is rewritten for that path (below).

### The local server: `tools/p3p2-local.js`

- **The pin:** p3p2 `v0.2.0`, commit `4602190b58148d41362fd53704bf090bff3cfeb9`.
- **Reinstall when the pin changes.**
  - **The problem:** `install()` only looks for `node_modules/hono`, so it would keep an old `.p3p2/src` at the
    0.1 commit.
  - **The fix:** it compares `git rev-parse HEAD` with the pin.
- **The data:** 0.2 upgrades `.p3p2/data` in place, and a 0.1 server won't open it afterwards. It is local test
  data only.
- **Making a room,** as the 0.2 portal does it:
  1. `POST /rooms` with `game`, `name` and `max` redirects to `/room/<key>`. This form no longer takes `origins`.
     The room has its invite at once.
  2. `POST /room/<key>/settings` with `name`, `max` and `origins` adds the other sites: the LAN address and
     `localhost`, on ports 5173 and 4173.
  3. `GET /room/<key>`: the invite link is the room page's **Open** link.
- **Invites expire.** An invite lasts 12 hours after the room empties, and the countdown restarts each time the
  room closes. So the invite is never saved:
  - every run reads the current one from `GET /room/<key>`;
  - if there is none, `POST /room/<key>/invite` makes a new one.
- **What it exports:**
  - `createRoom` returns `{ page, invite }`;
  - `roomInvite(server, page)` returns the room's current invite, making one if it has none;
  - `endRoom(server, page)` posts `/room/<key>/end`, for the tests.
- **What it prints:**
  - **The invite link,** for the dev server at the LAN address.
  - **The same invite on the preview's port.** The link is `<game URL>?room=<server>/<code>`, so the same `room=`
    value works on every site the room takes.
- **`--lag`:** the invite again, with its server moved to the proxy's port.
- **`room.json`** keeps the room's page, not its invite. A saved room from 0.1 (a room URL, no page) is made
  again.
- **Settings that stay:** `P3P2_CONNECT_RATE` and `P3P2_API_RATE` are still in 0.2's `config.ts`.

### Tests

**`tools/check-mp.js`. Joining:**
- **How:** everyone opens the room's invite link and answers *Join?*. `host()` goes.
- **The first check** becomes *the room's invite link opens the game and asks Join?*.
- **`?debug`:** the portal keeps the query of a game URL. The check confirms the invite keeps it too.

**New checks:**
- *Play with friends, on the title screen, opens p3p2's panel. Outside a room, the panel links to p3p2.me.*
- *p3p2's button sits in the bottom-left corner and covers no control.*
  - **Controls:** Pause, level, moves, gems, swap, both boosts, the race line and the watch bar.
  - **Sizes:** 360×640, 390×844, 640×360 and 1366×768.
  - **When:** in solo play and in a race.
  - **How:** measured on the real element, which is wider in a room.
- *No button or link on the title, pause, game-over or standings screen is under the button, scrolled to the
  end*, at 360×640 and 640×360.
- *After the panel is opened from the button and closed, Esc still pauses the game.*

**Changed checks:**
- **A room opened mid-game** becomes *Join? answered during a solo run*:
  1. Gus takes two shots alone.
  2. He opens the invite in the same tab. While *Join?* waits, he presses Play and takes two more shots.
  3. He answers *Join?*. The start card asks first, and his solo run waits.
  4. He starts the race, and leaves.
  5. His solo run comes back exactly as it was.
- **The room ended by its host** becomes *the room ended by its owner*: `endRoom` through the portal. Cy reads
  *The room's owner ended the game.*
- **The lag runs** use the invite through the proxy.
- **The ordinary-visit check** keeps looking for `p3p2-(core|panel|qr)` requests. The button must not load any of
  them.

**Unchanged:** `npm test` (`race.test.js` included) uses no p3p2 client call, so it should pass as it is.

**Runs:**
- `npm test`, `npm run build` and `npm run check:size`.
- `npm run check:mp`, plain and with `-- --lag`, several runs of each, as for plan 3.
- `npm run perf` against the last commit's build. Time to Play must not change.
- **Screenshots, for a person to look at:** the title, pause and play screens at 360×640 and 640×360, with the
  button.

## Feature 2: More games on Muon.Day

- **`site.config.js`:** `MORE_GAMES_URL = 'https://muon.day'`.
- **`index.html`:** both pills read **More games on Muon.Day**.
  - **The name:** Muon.Day names itself that way, in its `<title>` and `og:site_name`.
  - **It links back:** it already lists Bubbler, at `bu0.muon.day`, with a link to this repository.
  - The icon stays.
- **README:** the `site.config.js` row.
- **Checks:** `check:size`, and the existing *title fits a 640×360 phone*. The new label is two characters
  shorter.

## README

- **Racing friends,** in 0.2's terms:
  - make a room in a p3p2 server's portal with the game's address;
  - press **Open**;
  - send the invite link to friends.
- **The temporary server,** as p3p2.me describes it today: one room of up to 5 players, deleted 20 minutes after
  the last player leaves, and after 60 minutes in any case.
- **What goes:** *the game shows it under the button*, and *paste the room URL*.
- **The two ways in:** the button in the bottom-left corner, and **Play with friends** on the title screen.
- **The tools table:** `npm run p3p2` prints an invite link, and the `check:mp` row changes.

## Order of work

1. **Muon.Day.** Small and independent.
2. **The client to 0.2.0:** `friends.js`, `hud.js`, `race.js` and `index.html`. Then `npm test`, a build, and
   `check:size`.
3. **`p3p2-local.js`,** then a room by hand: the invite on the dev server, and in a second browser.
4. **`check-mp.js`,** plain and through the lag proxy.
5. **The phone screenshots,** and `perf`.
6. **The README,** then `ai/next_4.md`.

## Choices I made that you may want to change

- **Bottom-left.**
  - **Bottom-right** is also clear in play, but the version label sits there, and it is nearer the boosts.
  - **The top corners** are clear on a PC or tablet, but not on a phone. p3p2 takes one corner for every size.
- **Play with friends goes from the pause screen.** You asked to keep it on the main menu. On the pause screen it
  would open the same panel as the corner button below it. It can stay, and then the pause card needs its padding
  all the more.
- **The button shows on every screen, solo play included.** That is p3p2's design: gray while you're alone. The
  other way is `button: false` as now, which gives up the live mark and the unread count.
- **The aim line takes `Smooth`'s new default.** `coast: 250` keeps 0.1's behaviour.
- **The link goes to muon.day's front page,** not to Bubbler's entry there.

## Not covered

- **A *Join?* of our own.** The panel's handles front-page links and taken names.
- **Removing a player or ending the room from inside the game.** 0.2 puts these on the room's page in the
  portal.
- **Front-page rooms in `check-mp`.** That flow is p3p2's, and the game uses the panel for it either way.
- **Real iPhone safe areas.** Playwright's Chromium reports no safe-area insets, so this needs a look on a
  phone.
  - The safe-area rule raises the panel, but the panel's own height limit assumes a 12 px gap. On an upright
    iPhone a very tall panel could run about 22 px under the status bar. Its inside can't be styled from the
    page.
- **WebKit** still needs `sudo npx playwright install-deps webkit`.
