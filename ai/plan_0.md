# Plan 0: teach the specials, more places, level fly-over

Answers `ai/prompt_0.md`. Nothing here is implemented yet.

## What the code does today (the facts this plan is built on)

- **Load budget.** The critical path is 130 KB of JS (brotli) against the 250 KB budget in `tools/check-size.js`, plus 4 KB of HTML against 10 KB. `bloom.js` already shows how to lazy-load: a dynamic `import()` becomes its own chunk, and `index.html` never references it.
- **Environment.** `src/render/environment.js` builds one `Scene`: sky dome, stars, three rings of ridges, 90 instanced lanterns with halos and water streaks, and the lake. A `CubeCamera` renders that scene into a cube map. On mid and high it renders one face per frame; on low it renders all six once. Three materials sample the cube texture: bubbles, the brass launcher and the glass shards. `view.warmUp()` and the bloom pass hold on to `env.scene`, and `app.js` drives `env.glow`.
- **Camera.** The screen acts as a window onto the board plane (z = 0). The eye sits at z = 40 with an off-axis frustum, with a little sway and pointer parallax. `view.sync()` skips rows above `scrollRow - 3`, `frame()` skips bubbles above `TOP_Y + 1.5`, and the vertex shader fades anything above `uTopY`. `CAPACITY` is 360 bubbles.
- **Hint line.** `#hint` holds one line. Firing clears it, and it is only used for the controls hints on the first 3 shots.
- **Music.** `audio.js` hard-codes a single drone: D, Bm, G, A, with a chord every 9 s and an occasional bell.
- **How far runs get** (`npm run tune`, 30 runs). The casual bot reaches level 10 at the median (max 17). The greedy bot reaches 18 (max 23). Level 20 or so has about 37 rows, roughly 350 bubbles.

## Build order

Each step can ship on its own.

0. **Groundwork.** Add one level-start sequence in `app.js` and debug hooks. Everything else hangs off these.
1. **Teach the specials.** The smallest feature and independent of the rest.
2. **Level fly-over.** It becomes the place where a new environment is revealed, and where hints can point at the bubble being explained.
3. **Places engine.** Split the environment into a host, a kit and the Lantern Lake place, and generalise the music. The game should look and sound exactly the same after this step.
4. **New places**, one at a time. I'd stop after the first one so you can review the art and music before I do the rest.

---

## Step 0: groundwork

- **`startLevel({ fresh })` in `app.js`.** This replaces the three places that currently end with `view.setScroll(..., { intro: true })`: `newGame`, `levelCleared` and `again`/`restart`. It does the following in order:
  1. Sync the board and set the hand.
  2. Swap the place if the new level needs a different one (step 3).
  3. Play the fly-over, or fall back to the current slide-in.
  4. Unlock input and check for hints.

  Input stays locked until the sequence ends.
- **Debug hooks** behind `?debug`:
  - `__bubbler.level(n)` jumps to the start of level n by setting phase to `cleared` and calling `nextLevel()`.
  - `__bubbler.place(id)` switches the environment.
  - `__bubbler.flyover()` replays the fly-over.
  - `__bubbler.freeze(t)` pins the view clock so screenshots can be compared.
  - URL forms: `?debug&level=7` and `?debug&place=fjord`.
- **`tools/perf.js`.** Add `--place <id>`, which runs the frame-rate phase in that place. Report fly-over frame times separately from gameplay frame times.

## Feature 1: Teach the specials

**When a hint fires.** A kind counts as having appeared the first time it is on screen:
- in a row between `scrollRow` and `scrollRow + FAIL_ROW`, or
- in the launcher (a caught Nova or Comet).

Each kind is taught once per device. The taught kinds are stored as `bubbler:taught` through `store`, the same way `shots` is stored.

**Where the check lives.**
- A pure `Board.firstOfKinds(fromRow, toRow)` in `src/core/board.js` returns the first cell holding a Comet, a Nova, Mist and Obsidian. It has no DOM, so it can be tested.
- A small `src/ui/teach.js` holds the text, the taught set and the queue.
- `app.js` calls `teach.check(game)` in two places: at the end of `startLevel` and in `unlock()` after every shot. That covers new rows scrolling into view and specials arriving in hand.

**The lines.** Each fits on one line at 360 px, where the hint is 9u wide (about 300 px), so ≤ 40 characters:

| Kind | Line |
|---|---|
| Comet | Pop the ringed Comet to clear its row |
| Nova | Touch the white Nova and it bursts |
| Mist | Pop beside Mist to reveal its colour |
| Obsidian | Black Obsidian can't match. Cut it loose |

**How the line behaves.**
- `#hint` becomes a small queue. A new line waits until the current one has been up for at least 2.5 s.
- Teaching lines stay up for 6 s. Firing does not clear them; it still clears the controls hints.
- Level 3 brings Nova and Obsidian together, so their lines show one after the other.
- On a first run, the controls hint ("Move to aim, click to shoot") goes first, and the Comet line follows after the first shot.

**Pointing at the bubble.**
- When a line shows, two soft white rings pulse on the bubble it describes, via `view.fx.ring`. If there are several, it marks the one lowest on screen. This adds no new draw calls.
- During a fly-over, if a close-up lands on a kind that hasn't been taught, its line shows while the camera holds there. Feature 3 prefers such bubbles as targets.

**Done when:**
- A fresh profile sees each of the four lines exactly once, at the moment the kind is first on screen.
- Clearing `bubbler:taught` brings them back.
- The pause menu text is unchanged.

## Feature 3: Level fly-over

### The shot

The fly-over is driven by `view.time`, so pausing freezes it. There are two lengths.

**Full (about 5 s; longer columns scale it up, capped at 6.5 s).** Plays when a run starts and on the first level of each new place.
1. **Rise (1 s).** From the gameplay camera, ease up and in to above row 0: the eye at about (2.5, top + 3, 10), looking down at the top rows. Tall levels show their full height here, which also tells the player how much is left.
2. **Descend (about 3 s).** Glide down the column at z ≈ 6 with a gentle S-curve, through 2–3 close-ups in top-to-bottom order. At each close-up:
   - The eye is about 2.2 diameters from the bubble, 20–30° off-axis, alternating left and right.
   - It holds for 0.6 s with a slow 10° orbit.
   - The angle is chosen so the shot shows the rim fresnel, the far shore upside down in the glass, the core glyph, the oily film and the neighbour reflections.
3. **Settle (1 s).** Pull back into the live gameplay camera while the HUD fades in.

**Short (about 2.2 s).** Rise to the top, one close-up, settle. This is used for every other level. With a 5 s fly-over on every level, the early levels (4–6 shots each) would spend nearly as long watching as playing.

### Choosing close-ups

`pickCloseUps(statics, count, tier)` is a pure function. In order of preference:
1. A kind the player hasn't been taught.
2. Any special: a Comet's orbit ring, a Nova's animated core, Mist vapour, Obsidian's mirror.
3. A coloured bubble whose neighbours have other colours, which shows off the neighbour reflections. Skip this on low, where neighbour reflections are off.

Picks are spread across the top, middle and bottom thirds of the column.

### Camera math (new `src/render/flyover.js`)

- A pose is a position, a quaternion and a frustum (left, right, top and bottom at near = 1).
  - The gameplay pose is what `#camera()` computes now: identity rotation plus the off-axis window.
  - Fly-over keyframes use `lookAt` and a symmetric 40° frustum.
- **Sampling.** Position moves along a centripetal Catmull-Rom spline. Orientation uses slerp with smootherstep easing. The frustum blends from symmetric to off-axis only in the settle segment, and the near plane eases from 0.1 back to 1.
- The last keyframe is the live gameplay pose, recomputed every frame. Sway, pointer parallax and a resize mid-flight are all handled, and the handoff is exact.
- The path keeps the eye at z ≥ 1.2 near the board, so it never enters a bubble (radius 0.485).

### View changes (`view.js`, `bubbles.js`, `stage.js`, `renderer.js`)

- **The whole column is visible during the flight.**
  - `sync(board, 0)` includes every row.
  - The `TOP_Y + 1.5` cull is skipped.
  - `uTopY` moves above row 0. In the last 0.6 s it eases back to `TOP_Y`, so the upper rows shrink into the specks they are during play.
- **Capacity.** `CAPACITY` goes from 360 to 512. The tallest columns in tuning are about 350 bubbles, and a level-25 column is about 420.
- **Hero mesh.** A second instanced mesh shares the bubble material (no shader change) and uses a 48×32 sphere. Bubbles within about 4 units of the eye are drawn with it. This is one extra draw call, and only during the flight. Without it, the low tier's 18-segment silhouette looks faceted in close-up.
- **Stage glows.** The walls, fail line and launcher pool fade out during the flight. They skip the depth test, so at oblique angles they would paint over bubbles.
- **Quality.** `Quality.hold = true` during the flight: resolution may still be trimmed, but the tier can't change. Otherwise the fill cost of a close-up could permanently lower the quality ceiling for the session.

### App and HUD

- **Skipping.** Any tap, click or key during the flight jumps to a 0.4 s settle. That press never fires a shot: its release is ignored. Esc still pauses.
- **HUD in flight.** `#hud.fly` hides the top bar, moves, gems and boosts, and keeps `#hint`. A small dim "Tap to skip" sits at the bottom.
- **Reduced motion.** With `prefers-reduced-motion`, there is no fly-over; the current slide-in plays instead.
- **When it plays.** A new run plays it on Play. "Continue" on a saved run does not (that level has already started), and needs no save-format change: it plays only when `stats.shots === 0`, or after `nextLevel()` during play.
- **First run.** The controls hint waits until the flight ends.

**Done when:**
- The handoff to gameplay has no visible jump at any window size.
- Skipping works from any point.
- Tall levels show their full height.
- The flight holds frame rate on the phone profile, measured with `perf.js`.

## Feature 2: More places

### Host, kit, places

- **`environment.js` becomes the host.**
  - It owns one permanent root `Scene`, so `warmUp`, bloom's `RenderPass` and the cube capture keep working unchanged.
  - It owns the shared uniforms (`time`, `glow`, `pointScale`) and the cube target and camera; `setTier`, `captureFace`, `capture` and `texture` stay as they are.
  - `setPlace(place, renderer)` swaps the place's `Group` in the root scene, disposes the old geometry and materials, and recaptures all six faces.
  - The cube texture object never changes, so bubbles, brass and shards pick up the new place with no shader or material change, which is what the prompt asks for.
- **`src/render/places/kit.js`** holds today's parts, parameterised:
  - `skyDome`
  - `stars`
  - `ridges` (rings of ridges that include their own reflection)
  - `floaters` (instanced drifting lights with halo and water streak: lanterns, fireflies, embers)
  - `water`
  - the shared GLSL helpers

  It stays in the main chunk, and place chunks import from it.
- **`places/lake.js`** is Lantern Lake rebuilt from the kit. It stays in the main chunk because it is on screen before Play. Its acceptance test: screenshots with the clock frozen match today's, at the phone and desktop sizes.
- **`places/index.js`** is the registry: `{ fjord: () => import('./fjord.js'), ... }`. `loadPlace(id)` caches the promise, builds the group and calls `renderer.compileAsync(group, camera)`. If the fetch fails, the game stays in the current place and retries at the next level.
- **`config.js`** gets `LEVELS_PER_PLACE = 3`, `PLACES = ['lake', 'fjord', 'marsh', 'lagoon', 'harbour']` and `placeOf(level)`. The list cycles after the last place.

**Place module contract:** `export default { id, name, theme, build(kit, shared) → Group, music }`.

**Art rules**, written at the top of `kit.js` so every place follows them:
1. The floor at `WATER_Y` is liquid, because falling bubbles splash there.
2. The sky directly behind the board stays dark and muted, so the five bubble colours and their glyphs stay readable. Colour goes on the horizon and behind the viewer.
3. Bright, varied light goes behind the viewer (+z) and overhead. That is most of what the glass reflects.
4. Light sources exceed 1.0 (HDR) and scale with `uGlow`, so big clears still make them flare.
5. The line of sight to the board and the airspace above the column stay clear, as the lanterns do now.
6. Each place has at most 8 draw calls, no textures and no extra passes. Full-screen shaders (dome, water) cost no more than Lantern Lake's water. Detailed effects go on small meshes (ribbons, cards), not on the dome.
7. Fixed seeds, so a place looks the same on every visit.

### The places

Five places cover levels 1–15: the casual median plus a margin. After that the list cycles.

| Levels | Place | Scene | What the glass reflects | Music |
|---|---|---|---|---|
| 1–3 | Lantern Lake (now) | Ember dusk, ridges, lanterns | Moon, lanterns | The current D–Bm–G–A drone, unchanged |
| 4–6 | Aurora Fjord | Black water, steep snow-capped ridges, sparse snow | 3–4 aurora ribbons arching overhead and behind, green to violet, plus their reflection in the water | Cold sine pads (Em9, Cmaj7, G, Dsus2) with 12 s chords, glassy high arpeggios through an echo, a wind-noise bed |
| 7–9 | Firefly Marsh | Teal-green night, reed and willow silhouettes, a band of low fog | A low amber moon behind; hundreds of blinking fireflies | Warm pad (Fmaj7, Dm7, B♭maj7, C) with a soft kalimba ostinato around 70 bpm and occasional crickets |
| 10–12 | Glow Lagoon | Indigo sky, palm islands, a Milky Way band | Moon behind, cyan bioluminescent wave crests | Marimba-like two-operator plucks on an A-major pentatonic, a slow surf swell, a very light shaker |
| 13–15 | Neon Harbour | City skyline, windows lit from a hash grid, neon bars, blinking red tower lights | City lights all round; streaked reflections | Gentle synthwave: filtered pulse bass at 84 bpm, Am–F–C–G pad, a soft square-wave arpeggio |

### Loading (off the critical path)

- **Timing.** After Play, at idle time (`requestIdleCallback`, falling back to 1.5 s), load the current level's place and the next one. After each swap, prefetch the place after that.
- **Size.** A place chunk is code only, since the art is generated at load. Expect 3–6 KB brotli each.
- **Size check.** `check-size.js` also lists lazy chunks, with a 20 KB budget each. Its existing critical-path check already fails if a place chunk ends up in `index.html`.
- **Not ready yet.** If a place isn't loaded by the time its level starts, the game stays in the current place and swaps at the next level start. It never waits.
- **Resumed runs.** A saved run in a later place shows Lantern Lake on the title screen and swaps under the veil just after Play.

### Transition

- **The veil.** The level-cleared card shows for 2 s. At 1.0 s a new `#veil` (in the place's `theme` colour) fades in over 0.35 s. Under it:
  - `env.setPlace()` captures all six faces;
  - `audio.setScore()` starts the music crossfade;
  - the new level syncs.

  The veil fades out as the full fly-over starts. Any shader compile on first use, including the cube-map variants, happens while the screen is covered.
- **Naming the place.** The cleared card names the next place ("Next: Aurora Fjord"), and `<meta name="theme-color">` follows the place.

### Music engine (`audio.js`)

- **Score player.** The hard-coded drone becomes a small score player. `setScore(score)` crossfades the old bed into the new one over 3 s, then stops the old voices and timers. Before `unlock()`, it only remembers the score.
- **Score shape.**
  ```
  {
    chords, bar,
    pad: { voices, filter, lfo },
    air: noise bed or null,
    motif(play, chord, at)
  }
  ```
  `play` exposes `tone` and `noise` on the bed bus, plus an echo send: one `DelayNode` with feedback and a lowpass, no `ConvolverNode`, because convolution is costly on low-end phones. Motifs are scheduled ahead on `ctx.currentTime`, so timer jitter doesn't matter.
- **Lantern Lake.** Its score is today's drone moved verbatim into this shape, and it must sound the same. The other places carry their scores in their own chunks.
- **Limits.** At most 8 sustained oscillators plus short notes, and one echo. The Music button keeps working through `bed`. New scores are matched in loudness to the current one by ear.

**Done when:**
- Levels 4, 7, 10 and 13 each open in their place, with matching music, behind a clean veil.
- Reflections show the new place on every tier.
- Play-ready time is unchanged.
- Each place's frame rate is within about 10% of Lantern Lake's on both `perf.js` profiles.
- Bubbles stay readable in screenshots at 360×800 and 1920×1080.

---

## Performance and load budget

- **Critical path.** It grows only by code: teach, fly-over, kit refactor and score player, estimated at under 8 KB brotli in total. `npm run check:size` must pass. Play-ready time in `npm run perf` must not move beyond run-to-run noise. The goal stays 1–3 s; 4 s is the hard limit.
- **Frame rate.** Run `npm run perf` and `npm run perf -- --software` on Lantern Lake before starting, then again after each step, with `--place` for each new place. If a place drops the low tier below 30 fps, cut its detail by tier (fewer floaters, no wave-crest noise) rather than relying on the tier ladder.
- **Biggest risk.** Fly-over close-ups fill the screen with the most expensive shader. The tier hold and the short variant contain it, and `perf.js` measures it.

## Testing

- **`npm test`** (new cases in `tools/test/`):
  - `firstOfKinds` finds each kind and respects the row window.
  - `placeOf`: levels 1–3 give `lake`, 4 gives `fjord`, and the list wraps after 15.
  - `pickCloseUps` returns at most 3, prefers specials, runs top to bottom and stays on the board.
  - Fly-over path: the final sample equals the gameplay pose to within 1e-6; there are no jumps between 1/60 s samples; the eye keeps z ≥ 1.2 near the board.
- **By hand** (`npm run dev` with `?debug`):
  - Clear `bubbler:taught` and play levels 1–3.
  - Use `?debug&level=4`, `7`, `10` and `13` for each transition.
  - Skip the fly-over at every phase, pause it, and resize during it.
  - Try with reduced motion on.
  - Continue a saved run in each place.
- **Screenshots.** Playwright shots of each place at phone and desktop size, with the clock frozen, to judge readability and compare Lantern Lake before and after the refactor.

## Files

| File | Change |
|---|---|
| `src/app.js` | `startLevel` sequence, skip input, place loading and swap, teach checks, debug hooks |
| `src/config.js` | `LEVELS_PER_PLACE`, `PLACES`, `placeOf` |
| `src/core/board.js` | `firstOfKinds` |
| `src/ui/teach.js` (new) | hint text, taught set, queue |
| `src/ui/hud.js` | hint queue, `fly` mode, place name on the cleared card, veil |
| `src/render/flyover.js` (new) | path planning, sampling, `pickCloseUps` |
| `src/render/view.js` | pose-based camera with fly-over blend, all-rows sync, `uTopY` control, hero batch |
| `src/render/bubbles.js` | `CAPACITY` 512, hero mesh sharing the material |
| `src/render/stage.js` | fade the glow strips |
| `src/render/renderer.js` | `Quality.hold` |
| `src/render/environment.js` | becomes the host: root scene, cube map, `setPlace` |
| `src/render/places/kit.js`, `lake.js`, `index.js` (new) | shared parts, Lantern Lake, registry and loader |
| `src/render/places/fjord.js`, `marsh.js`, `lagoon.js`, `harbour.js` (new, lazy) | the new places and their scores |
| `src/audio/audio.js` | score player with crossfade; Lantern Lake score |
| `index.html` | `#veil`, `#skip` and `#hud.fly` CSS and elements |
| `tools/perf.js`, `tools/check-size.js` | `--place`, fly-over timing, lazy chunk report |
| `tools/test/*.test.js` | the cases above |
| `README.md` | places, fly-over, new debug parameters |

Not changing: the rules, the save format (`v: 1`), the bubble shader code, and the no-asset-files rule. Everything stays generated in code.

## Open questions (the default I'll use if you don't say otherwise)

1. **How many new places, and which themes?** Default: the four above, cycling after level 15. I'd build Aurora Fjord first, then stop for your review.
2. **Fly-over length?** Default: full at a run's start and on each new place, short on other levels, tap to skip, off with reduced motion. The alternative is full every level.
3. **A setting to turn the fly-over off?** Default: no, since tap-to-skip covers it. It's easy to add an "Intro on/off" button to the pause menu.
4. **Hints once per device or once per run?** Default: once per device.
