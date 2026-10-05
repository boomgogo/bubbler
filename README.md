# Bubbler

a modern bubble shooter game

Glass bubbles over a lantern-lit lake, rendered in 3D with three.js. Open source, no ads, yours to adapt.


## Setup and run

```bash
npm install
npm run dev
```

Add `?debug` to the URL for a frame-rate and quality readout, and a `__bubbler` handle in the console.

## How to play

- Aim and release. Three of a colour pop; anything left hanging falls into the lake for double points.
- Tap the launcher (or right-click, or press S) to swap the two bubbles in hand.
- A ringed **Comet** clears its row when popped. A white **Nova** bursts when touched.
- **Mist** hides a bubble's colour until something pops beside it. Black **Obsidian** cannot be matched.
- A Comet or Nova that is cut loose flies back to the launcher as a free shot.
- **Gems** are never sold. The game hands them over when you are stuck; spend them on a Comet shot, on clearing the Mist, or on a Second Wind when the moves run out.

Keyboard: arrows aim, space fires, S swaps, 1 and 2 use the boosts, Esc pauses.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist/` |
| `npm test` | Rule tests (`tools/test`) |
| `npm run tune` | Headless bots play whole runs and print how the game pays out |
| `npm run check:size` | Fails if the files needed before Play exceed the download budget |
| `npm run perf` | Load time and frame rate on the built site, with network and CPU throttled (needs Chrome) |
| `npm run deploy` | Build, size check, `wrangler deploy` |

## Where things are

| Path | What |
|---|---|
| `src/config.js` | Every tunable: grid, scoring, gems, and what each level is made of |
| `src/core/` | The rules. No DOM, no three.js; runs in Node for tests and tuning |
| `src/render/` | three.js: the lake, the bubble shader, effects, quality tiers |
| `src/ui/`, `src/audio/`, `src/platform/` | HTML overlay, synthesised sound, input and storage |
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


