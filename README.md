# Bubbler

a modern bubble shooter game

Glass bubbles over a lantern-lit lake, rendered in 3D with three.js. Every few levels the game moves on to
a new place, each with its own music. Open source, no ads, yours to adapt.


## Setup and run

```bash
npm install
npm run dev
```

Add `?debug` to the URL for a frame-rate and quality readout, and a `__bubbler` handle in the console.
With `?debug` you can also add `&level=7` to start a run at level 7, `&place=fjord` to play in a given place,
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

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist/` |
| `npm test` | Rule tests (`tools/test`) |
| `npm run tune` | Headless bots play whole runs and print how the game pays out |
| `npm run check:size` | Fails if the files needed before Play exceed the download budget, or a chunk loaded later exceeds its own |
| `npm run check:nan` | Fails if any place, or the board in front of it, renders a NaN pixel, which blanks the screen on the high tier once the bloom spreads it (built site, needs Chrome) |
| `npm run perf` | Load time, fly-over and play frame rate on the built site, with network and CPU throttled (needs Chrome); `-- --place fjord` measures another place |
| `npm run deploy` | Build, size check, `wrangler deploy` |

## Where things are

| Path | What |
|---|---|
| `src/config.js` | Every tunable: grid, scoring, gems, what each level is made of and where it is played |
| `src/core/` | The rules. No DOM, no three.js; runs in Node for tests and tuning |
| `src/render/` | three.js: the bubble shader, effects, quality tiers, the level fly-over (`flyover.js`) |
| `src/render/places/` | The places: Lantern Lake, which ships with the game, and the others, each loaded as its own chunk after Play. `kit.js` holds the parts they are built from, and the rules every place follows. Each place carries its music |
| `src/ui/`, `src/audio/`, `src/platform/` | HTML overlay and the hints that explain specials, synthesised sound and the score player, input and storage |
| `src/app.js` | Ties the above together |
| `index.html` | Loading screen and all CSS, inline so it paints before any script |
| `site.config.js` | `REPO_URL` for the "Fork me on GitHub" links |
| `tools/` | Tests, tuning bots, size check, performance harness |

All art and sound are generated in code: there are no image, model or audio files.

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


