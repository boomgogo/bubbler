# Bubbler

a modern bubble shooter game

Glass bubbles over a lantern-lit lake, rendered in 3D with three.js. Every three levels the game moves on to
a new place, each with its own music: Lantern Lake, Aurora Fjord, Firefly Marsh, Glow Lagoon and Neon Harbour,
then round again. Race your friends on the same bubbles, and watch them play. Open source, no ads, yours to
adapt.


## Setup and run

```bash
npm install
npm run dev
```

Add `?debug` to the URL for a frame-rate and quality readout, and a `__bubbler` handle in the console.
With `?debug` you can also add `&level=7` to start a run at level 7, `&place=fjord` to play in a given place
(`lake`, `fjord`, `marsh`, `lagoon` or `harbour`),
and `&seed=123` for the same boards every time. The console handle has `level(n)`, `goPlace(id)`,
`flyover()` and `freeze(t)` (pins the clock, for screenshots).

## How to play

- Aim and release. Three of a colour pop; anything left hanging falls into the lake for double points.
- Tap the launcher (or right-click, or press S) to swap the two bubbles in hand.
- A ringed **Comet** clears its row when popped. A white **Nova** bursts when touched.
- **Mist** hides a bubble's colour until something pops beside it. Black **Obsidian** cannot be matched.
- A Comet or Nova that is cut loose flies back to the launcher as a free shot.
- **Gems** are never sold. The game hands them over when you are stuck; spend them on a Comet shot, on clearing the Mist, or on a Second Wind when the moves run out.
- Each level opens with the camera flying over the column of bubbles. Tap, click or press a key to skip it.
- The first time a special shows up, a line under the board says what it does.

Keyboard: arrows aim, space fires, S swaps, 1 and 2 use the boosts, Esc pauses.

## Racing friends

The multiplayer button in the bottom-left corner, or **Play with friends** on the title screen, opens p3p2's
panel. Everyone in the room plays the same run: the same boards, and the same colours dealt in every level.
You see your own bubbles, and everyone's level and score in a line under your score; tap it for the standings,
and **Watch** to see someone play, shot for shot. The game has no clock, so arriving late costs nothing, and
watching costs nothing either.

- **A room takes a p3p2 server.** [p3p2.me](https://p3p2.me) explains how to get one, including a free temporary
  server: one room of up to five players, deleted 20 minutes after the last player leaves, and after 60 minutes
  in any case.
  1. In the server's portal, create a room with this game's address.
  2. Press **Open** on the room's page, and answer *Join?*.
  3. Send the room's invite link (or its QR code) to your friends. Everyone joins through it, you too.

  The room's page in the portal is also where players are removed and the game is ended.
- **One attempt per race.** In a race, *Restart run* becomes *Leave the race*. A reload carries on where you were.
- **No looking ahead.** While your own run is live you can watch only players on a level you have reached, since
  everyone has the same boards. Once your run is over, you can watch anyone.
- **Rematch** on the game-over card starts a new race, with a new seed, for the whole room. Players still playing
  are offered it and finish theirs first if they like.
- Your solo run is kept while you race, and comes back when you leave the room.
- Chat opens with T (Enter fires a shot).

To try it on one machine, `npm run p3p2` starts a p3p2 server and prints an invite link for
`npm run dev -- --host`. Open it, and open it again in another browser (not another tab of the same one: that
is the same player) or on a phone on the same Wi-Fi.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist/` |
| `npm test` | Rule tests (`tools/test`) |
| `npm run tune` | Headless bots play whole runs and print how the game pays out; `-- --only expert` for the autoplayer's bot |
| `npm run autoplay` | Plays 400 seeds with the autoplayer's bot in Node and ranks the runs, to pick one to record; `-- --seeds 100` |
| `npm run record -- youtube --seed N` | Records one whole run in Chrome, frame by frame, played by the autoplayer with a mouse: video, sound and an event log in `recordings/youtube/` (built site; needs Chrome and ffmpeg). `pilot` records the first 90 s and checks timing; `watch` plays in a visible window in real time |
| `npm run cut -- youtube\|short\|x` | From a recorded run: YouTube text with chapters and thumbnail stills; a YouTube Short (re-recorded in a phone layout, by touch); a square video for X |
| `npm run check:size` | Fails if the files needed before Play exceed the download budget, or a chunk loaded later exceeds its own |
| `npm run check:mp` | Races in real browsers against a p3p2 server of its own: Chrome, Firefox and WebKit in one room, joining through its invite link, the same boards in all three, standings, watching shot for shot, reloads, late joiners, Rematch, the room ended from the portal, phone layouts with p3p2's corner button, and an ordinary visit that asks no server anything. `-- --lag` runs it through a proxy that adds 150 ms and cuts connections (built site; needs Chrome) |
| `npm run check:nan` | Fails if any place, or the board in front of it, renders a NaN pixel, which blanks the screen on the high tier once the bloom spreads it (built site, needs Chrome) |
| `npm run perf` | Load time, fly-over and play frame rate on the built site, with network and CPU throttled (needs Chrome); `-- --place fjord` measures another place, `-- --tier mid` locks the quality tier so places compare like for like, `-- --profile phone` runs one profile |
| `npm run place-cost` | What each place costs to draw, all measured in one page so they compare fairly; `-- --tier low`, `-- --phone`, `-- --software` (built site, needs Chrome) |
| `npm run p3p2` | A p3p2 server on this machine (port 8080) with a room for the dev server and the preview, and the room's invite link, for racing without a server of your own; the first run fetches it into `.p3p2/`. `-- --lag` adds the lag proxy on 8081 |
| `npm run music` | Renders each place's music offline and prints its loudness and notes a minute; `-- --out dir` also writes WAVs to listen to (needs Chrome) |
| `npm run deploy` | Build, size check, `wrangler deploy` |

## Where things are

| Path | What |
|---|---|
| `src/config.js` | Every tunable: grid, scoring, gems, what each level is made of and where it is played |
| `src/core/` | The rules. No DOM, no three.js; runs in Node for tests and tuning |
| `src/render/` | three.js: the bubble shader, effects, quality tiers, the level fly-over (`flyover.js`) |
| `src/render/places/` | The places: Lantern Lake, which ships with the game, and the others, each loaded as its own chunk after Play. `kit.js` holds the parts they are built from, and the rules every place follows. Each place carries its music |
| `src/ui/`, `src/audio/`, `src/platform/` | HTML overlay and the hints that explain specials, synthesised sound and the score player, input and storage |
| `src/app.js` | Ties the above together, and plays back another player's game when you watch them |
| `src/net/` | Racing friends through p3p2: `friends.js` (small, on every visit; asks no server anything), `race.js` (loaded once a room opens) and `standings.js` (the races and standings, built from the room's log) |
| `index.html` | Loading screen and all CSS, inline so it paints before any script |
| `site.config.js` | `REPO_URL` for the "Fork me on GitHub" links, `MORE_GAMES_URL` for "More games on Muon.Day" |
| `tools/` | Tests, tuning bots, size check, performance harness |
| `tools/sim-bot.js`, `human.js`, `record.js` | The autoplayer: the expert bot (it sees only what a player sees), the hand that carries out its moves at a person's pace, and the frame-by-frame recorder (`record-clock.js` is the clock it injects) |

All art and sound are generated in code: there are no image, model or audio files.

## Recording gameplay

```bash
npm run build
npm run autoplay                          # pick a seed from the ranking
npm run record -- pilot --seed N          # 90 s, to try the settings first
npm run record -- youtube --seed N        # the whole run: hours of rendering, unattended
npm run cut -- youtube && npm run cut -- short && npm run cut -- x
```

The recorder owns the page's clock, so every frame is drawn in full whatever the machine, and the sound is
rendered in step with the pictures. Each recording saves its checks in `run.json`: time per frame, sound
against picture, and that every level was played in its own place. Videos go in `recordings/`, which git
ignores.

## Initial setup

```bash
npm create vite@latest . -- --template vanilla
claude --dangerously-skip-permissions
```

## Deploy

```bash
npx wrangler login
npm run deploy
```

The site is static and is served from Cloudflare by `wrangler.jsonc`, with preview URLs off.
The label in the corner of the game is `v.` plus the first four characters of the commit that was built,
so `npm run deploy` refuses to run with uncommitted changes (`ALLOW_DIRTY=1` overrides).


