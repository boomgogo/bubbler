# Next 1: what was built for prompt 1, and what comes next

Implements `ai/plan_1.md`: Firefly Marsh, Glow Lagoon and Neon Harbour, built in one go. Levels 1–15 now
visit five places, and level 16 starts again at Lantern Lake.

## What was built

**Shared groundwork**
- `src/render/places/parts.js` is a lazy chunk of 1.2 KB. It holds:
  - `motes`: points that drift and blink, with their reflections, in one draw call;
  - `withMirror`: a mesh and its reflection as one geometry;
  - `mirrorInstances`: the same for instanced meshes.
- Only the new places import it, so it loads on its own after Play. `kit.js`, `lake.js` and `fjord.js` are
  unchanged.
- A score can now bring instruments of its own: `Band` merges `voices(tools)` into `play`. The new sounds
  live in their places' chunks: cricket, frog, marimba, synth, kick and snare.
- `PLACES` lists all five, and `places/index.js` has three new loader lines.

**Firefly Marsh** (levels 7–9, `marsh.js`, 3.5 KB, 6 draw calls)
- **Scene:**
  - a big low amber moon behind the player and to the right, in a warm haze;
  - willows and alders round three shores, with a few poplars above them and mist at their feet. The mist
    is painted into the tree and reed shaders and has no mesh of its own;
  - about 1,100 reed blades, some with cattails, swaying, each with its reflection;
  - 1,400 fireflies blinking on their own clocks, fewer of them behind the board;
  - amber glints on the water only where the ripples would mirror the moon.
- **Music:** a G major lullaby in three at 88 bpm.
  - A kalimba rocks in eighth notes, and low plucks on beats two and three make the waltz.
  - An ocarina sings the tune, then the kalimba sings it back.
  - Crickets chirp on a very high D, so even they are in key. Now and then a frog answers.

**Glow Lagoon** (levels 10–12, `lagoon.js`, 4.5 KB, 8 draw calls, the most the kit's rules allow)
- **Scene:**
  - an indigo sky;
  - the Milky Way arching behind and overhead. It is mottled, with a dark lane of dust and a warm core. It
    touches the horizon only straight left and right, so it never crosses the sky behind the board. It sits
    on a strip mesh of its own, with its reflection;
  - extra stars along the band;
  - a thin crescent moon low behind the player and to the left, with a silver path on the water;
  - low islands to the sides carrying palms with leaning trunks and drooping, feathery fronds. Straight
    ahead is open sea;
  - cyan crests breaking along the shores and in lines behind the player, each with a flash that runs along
    it.
- **Music:** A major at 96 bpm.
  - A marimba plays in threes and twos over a bouncing bass, with a light shaker and the surf.
  - A whistle sings the tune, then steel-pan bells take it.

**Neon Harbour** (levels 13–15, `harbour.js`, 4.6 KB, 7 draw calls)
- **Scene:**
  - 230 towers round the quays behind and beside the player. Their windows are lit per building and switch
    on and off now and then. Far off, they melt into an even glow so the grid never shimmers. In the water
    they become streaks broken up by ripples;
  - neon bars and strips (pink, cyan, violet, amber) on the faces that look over the water, a few of them
    stuttering, each with a long wavering reflection;
  - red lights blinking on the 15 tallest roofs;
  - a continuous distant skyline all round with tiny windows, low across the bay behind the board;
  - a pink-to-amber city haze, and a lit deck of cloud behind the player.
- **Music:** gentle synthwave in B minor at 84 bpm.
  - A pulse bass opens its filter across each phrase.
  - A square arpeggio runs in sixteenths through a dotted-eighth echo, over a soft kick and snare.
  - A synth lead carries the tune, with a bell counter-melody.
  - The last pass of each round breaks down.

**Where I departed from the plan**
- **Glow Lagoon has a moon.** The plan said none, but without one the glass had nothing bright to catch
  behind the player.
- **The Milky Way left the sky dome for its own strip mesh.** On the dome it doubled the sky's cost under
  software rendering, because the CPU renderer runs both sides of a shader branch. On a strip only the pixels
  it covers pay, as kit rule 6 asks. It looks the same.
- **No towers stand ahead in Neon Harbour.** A few low blocks across the bay looked like floating boxes
  behind the launcher. A distant skyline ring replaced them: the kit's ridge strip, in one draw call.
- **The open questions took the plan's defaults:**
  - Marsh in G major and Harbour in B minor;
  - level 16 back to Lantern Lake;
  - soft drums in the Harbour;
  - the Marsh in three.

**Tools and tests**
- **`npm run music`** (`tools/music.js`) renders each score offline through the game's own audio chain. It
  prints RMS, the loudest 10 seconds, the peak and notes a minute, and `--out dir` writes WAVs. It reproduces
  iteration 0's Lantern Lake figure of −28.5 dBFS.
- **`npm run place-cost`** (`tools/place-cost.js`) times each place's frame in one page, switching places
  between rounds, so they compare fairly. It takes `--tier`, `--phone` and `--software`.
- **`perf.js`** gains:
  - `--tier`, which locks the quality tier;
  - `--profile phone|pc`, which runs one profile only;
  - a time per frame with the GPU forced to finish.
- **`tools/test/places.test.js`** checks, for every place:
  - the module loads, with a name and a theme;
  - it stays within 8 draw calls;
  - its music is in a key that holds every note the pops play (D, E, F♯, A, B);
  - its music has a tune and a beat: one voice plays at least 16 notes over 6 or more pitches in 8 bars, and
    there are at least 40 notes a minute.

  I confirmed it rejects an F major score and a drone.
- `core.test.js` maps levels 1, 4, 7, 10, 13 and 16 to the five places and back to the first. All 40 tests
  pass.
- The README lists the places, the debug ids and the new commands.

## Measurements

All on this laptop: headless Chrome, Intel HD 630.

**Size:**
- critical path: 136.2 KB brotli, against 136.0 before (+0.2 KB for the `voices` hook);
- place chunks: Marsh 3.5 KB, Lagoon 4.5 KB, Harbour 4.6 KB, parts 1.2 KB. The budget is 20 KB each.

**Load** (`perf.js`, 6 runs):

| | Play can be tapped |
|---|---|
| Phone | 1313 ms (iteration 0: 1322 ms) |
| PC, 6-run median | 1547 ms |
| PC, A/B against the committed build, warm runs alternating | before 1647, 1486, 1376 ms; after 1400, 1356, 1377 ms |

There is no change. The first run of every invocation is a cold browser start of about 3 s, on both versions.

**What each place costs to draw** (`place-cost.js`): ms per frame with the GPU forced to finish, median of 4
rounds, with the difference from Lantern Lake in brackets.

| | Lake | Fjord | Marsh | Lagoon | Harbour |
|---|---|---|---|---|---|
| high, PC 1080p | 13.4 | 13.4 (0%) | 13.5 (+1%) | 13.1 (−2%) | 13.4 (0%) |
| low, PC 1080p | 7.3 | 7.5 (+3%) | 7.3 (0%) | 7.3 (0%) | 7.8 (+7%) |
| mid, phone | 7.8 | 7.8 (0%) | 7.7 (−1%) | 7.7 (−1%) | 7.9 (+1%) |
| low, phone | 6.7 | 6.9 (+3%) | 6.8 (+1%) | 6.3 (−6%) | 6.8 (+1%) |
| low, PC, software rendering | 80.5 | 86.1 (+7%) | 85.1 (+6%) | 74.1 (−8%) | 76.1 (−5%) |

Shooting the whole cube map costs more in the Harbour, 7.2 ms against Lake's 6.2. That is one face per frame
on mid and high, and once per change of place on low, under the veil.

**Frame rate** (`perf.js`, automatic tier):
- phone: 57.8 fps in play, 60 fps in the fly-over;
- PC: 59.3 fps in play, 57.1 fps in the fly-over.

**Music** (`npm run music`, 2 minutes each):

| | RMS dBFS | Loudest 10 s | Peak dBFS | Notes a minute |
|---|---|---|---|---|
| Lake | −28.5 | −26.6 | −15.4 | 209 |
| Fjord | −28.8 | −26.8 | −15.1 | 135 |
| Marsh | −27.7 | −26.4 | −14.3 | 313 |
| Lagoon | −28.6 | −27.0 | −15.5 | 404 |
| Harbour | −28.7 | −27.7 | −13.9 | 456 |

Every 5-second stretch of every score sits between −31 and −26 dBFS: no dead air and no runaway level.

**Checks:**
- `npm run check:nan` is clean for all five places.
- **Changes of place**, on the built site with a real level clear: levels 6→7, 9→10, 12→13 and 15→16 each
  - name the next place on the card;
  - change the place, the music (checked by tempo) and the theme-color under the veil;
  - fly the full tour.
- **Saved runs** continued at levels 7, 10 and 13 swap to their place about 0.5 s after Continue.

## Not verified

- **How the three new scores sound.** I rendered and measured them but could not listen. The WAVs are in this
  session's scratchpad, which is temporary. To hear them, run `npm run music -- --out <dir>`, or play
  `?debug&place=marsh` (or `lagoon`, `harbour`).
- **Real devices**, as in iteration 0: no entry-level Android phone, no iOS Safari, no integrated-GPU-only PC.
- **`perf.js`'s new frame time** varies by up to 2× between browser launches on this laptop. Use
  `place-cost.js` to compare places.
- **Reflections in the fly-over close-ups.** At the debug seeds most close-ups landed on Mist bubbles, which
  are opaque, so I judged the reflections from panoramas and from the few glass bubbles in view.

## What to work on next

1. **Your look and listen.** Use `?debug&place=marsh`, `lagoon` or `harbour`, or `?debug&level=6` and clear
   into the Marsh. Art and music are cheap to change now.
2. **A real low-end phone pass**, carried over from iteration 0, now across five places.
3. **Glass in the opening close-ups.** The fly-over prefers specials for its close-ups. From level 4 on, Mist
   is common, so the close-up is often an opaque Mist bubble, which shows none of the glass. Once every
   special has been taught, it could prefer coloured glass bubbles.
4. **Past level 15 the places repeat.** The casual bot's median run reaches level 10, and the greedy bot's
   reaches 18. If playtesting shows many long runs, a later round could vary each place (season, weather)
   rather than repeat it.
5. **Only if playtesting says so** (carried over): an "Intro on/off" button in the pause menu.
