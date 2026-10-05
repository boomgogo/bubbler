# Next 0: what was built for prompt 0, and what comes next

Implements `ai/plan_0.md` up to its review checkpoint: all of the plan except the three remaining
places (Firefly Marsh, Glow Lagoon, Neon Harbour).

## What was built

**Teach the specials** (`src/ui/teach.js`, `Board.firstOfKinds` and `specialName` in `src/core/board.js`)
- The first time a Comet, Nova, Mist or Obsidian bubble is on screen or in the launcher, one line
  under the board explains it. Soft rings pulse on the bubble it means; for a caught special, on the
  launcher.
- Each kind is taught once per device. The taught set is stored as `bubbler:taught`.
- The hint line is now a queue on the game clock (`Hud.hint`):
  - A waiting line replaces the current one after 2.5 s.
  - Firing clears the controls hints but never a teaching line.
  - Lines still waiting when a level ends or a new run starts are dropped, and offered again at the
    next sighting.

**Level fly-over** (`src/render/flyover.js`; the camera in `src/render/view.js`)
- The camera rises from the playing view to the top of the column, glides down through close-ups,
  and lands exactly back on the playing camera.
- How it works:
  - The playing camera is now a "pose" (eye, rotation, off-centre window), so the fly-over blends
    into and out of it instead of cutting.
  - The column is shown in full while flying, and the rows above the field shrink back to specks
    on landing.
  - Close-ups use a finely divided sphere (the "hero" batch: same material, no shader change).
  - The glowing walls and fail line fade out in flight.
  - The quality tier is held during the flight.
- Lengths:
  - **Full** (2 close-ups, or 3 on tall levels; capped at 6.5 s): when a run starts and when the
    place changes.
  - **Short** (1 close-up, capped at 3.2 s): every other level.
  - A close-up of a special not yet taught holds 1 s longer, with its teaching line showing in a
    panel.
- Skipping and pausing: any tap, click or key skips it, and that press never fires a shot. Esc
  pauses it.
- When it doesn't play:
  - With reduced motion, there is no flight; the old slide-in plays instead.
  - "Continue" on a saved mid-level run doesn't fly.
- `CAPACITY` went from 360 to 512 bubbles.

**Places** (`src/render/places/`, `src/render/environment.js`)
- `environment.js` is now a host. It keeps one permanent scene and swaps a place's group inside
  it, then reshoots the cube map. The cube texture is the same object throughout, so bubbles,
  brass and shards pick up a new place with no shader or material change.
- `kit.js` holds the parameterised parts and the art rules every place follows.
- `lake.js` is Lantern Lake rebuilt from the kit. Its environment is pixel-identical to before.
- `fjord.js` is Aurora Fjord, a lazy chunk of 3.0 KB brotli:
  - steep snow-capped walls with a V-shaped opening to the sea ahead;
  - aurora curtains overhead and behind the player, which is what the glass reflects, plus a faint
    one low ahead, and their mirror in the water;
  - slow snow;
  - a cold E-minor score.
- `config.js` has `LEVELS_PER_PLACE = 3`, `PLACES = ['lake', 'fjord']` and `placeOf(level)`. Until
  more places exist, the two alternate every 3 levels.
- Loading: places are fetched and compiled at idle time after Play (never during a fly-over): the
  current level's place and the next one.
- Changing place:
  - At a level change, the veil comes down behind the "Level cleared" card, which now says
    "On to Aurora Fjord". The place changes under it, the music crossfades, and the full fly-over
    reveals it.
  - A run continued in a later place, or a new run after a long one, changes under the veil
    straight away.
  - `<meta name="theme-color">` follows the place.

**Music** (`Band` in `src/audio/audio.js`)
- The hard-coded drone is replaced by a score player:
  - instruments: pad, bass, pluck, glass bell, a flute-like lead with delayed vibrato, and a shaker;
  - an echo built from a feedback delay (no convolver, which is costly on low-end phones);
  - an optional noise bed (water, wind);
  - notes booked 1.2 s ahead;
  - a 2.5 s crossfade when the score changes;
  - no notes booked while Music is off.
- Each place carries its score.
- **Lantern Lake's music is new, as asked** (instead of the plan's "keep the drone"):
  - D major at 76 bpm, keeping the old D–Bm–G–A identity.
  - A koto-like eighth-note pattern carries the chords.
  - A flute sings an 8-bar pentatonic tune, then bells answer it.
  - Every fourth pass is a quiet break.
  - One cycle is about 100 s.
- **Fjord:** E minor at 66 bpm. Glassy bell triplets like ice, a slow low pulse, a long flute tune,
  and wind.
- Both are in keys where the pentatonic pops stay in tune.

**Tools and debug**
- `?debug` now also accepts:
  - `&level=7` to start a run at level 7;
  - `&place=fjord` to play in a given place;
  - `&seed=123` for the same boards every time.
- The console handle `__bubbler` gains `level(n)`, `goPlace(id)`, `flyover()`, `freeze(t)`,
  `teacher` and `place`. It is `goPlace`, not the plan's `place(id)`, because `place` reads the
  current place.
- `npm run perf` now:
  - times the opening fly-over separately from play;
  - waits for the fly-over to land before shooting (its clicks would skip it);
  - takes `-- --place fjord`.
- `npm run check:size` also lists the chunks loaded after Play, with a 20 KB budget each.
- New tests: `tools/test/flyover.test.js`, plus cases in `core.test.js`. 25 tests in total, all
  passing. They cover:
  - kind detection and place mapping;
  - close-up picking;
  - the flight starting and ending exactly on the playing camera;
  - no jumps or jolts, and never inside the board;
  - skipping;
  - the resting camera matching the old matrices exactly.

## Measurements

Headless Chrome on this laptop with `tools/perf.js` throttling (10 Mbit/s, 100 ms; phone at 4× CPU).

| | Before | After |
|---|---|---|
| Critical path (brotli) | 130.2 KB | 135.8 KB (+5.6) |
| Play-ready, phone (A/B, 6 runs alternating) | 1301 ms | 1322 ms |
| Play-ready, desktop (A/B, 6 runs alternating) | 1401 ms | 1378 ms |
| Opening fly-over, phone / desktop | — | 60.0 / 56.8 fps |
| Play, Lantern Lake, phone / desktop | 57.9 / 58.5 fps | 58.0 / 56.9 fps |
| Play, Fjord, phone / desktop | — | 57.4 / 51.0 fps (see below) |

- **Fjord against Lantern Lake at a fixed tier.** The 51 fps desktop Fjord figure is run-to-run
  noise in `perf.js`'s shooting phase: the previous run gave 59.3. At a fixed tier the two places
  match:
  - frame rate on the desktop profile at mid: 59.6–60.1 fps for both, over two runs;
  - forced-finish GPU time per frame: high 1.35 against 1.42 ms; mid about 1.0 ms for both; low
    0.62 against 0.62 ms;
  - the same number of draw calls.
- **Opening flight length.** A brand-new player's first flight runs about 7.3 s: the 6.5 s cap, plus
  a longer hold on each close-up that explains a special.
- **Music loudness** (rendered offline):
  - old drone: −26.4 dBFS RMS;
  - new Lantern Lake: −28.5;
  - Fjord: −28.8;
  - peaks the same, at about −15.5.
  - The new scores sit slightly under the drone's RMS because a constant drone sounds louder than
    its RMS. Note onsets per minute are 53 for the lake and 23 for the fjord, against 7 for the
    drone.

Found and fixed while measuring:
- **What the auto-quality learned in flight stuck after it.** Fast flights counted towards a tier
  step-up; slow close-ups trimmed the resolution, and one slow moment after landing then dropped
  the tier for good. One desktop run ended on the low tier. Now `Quality.hold()` snapshots the
  ladder when a flight starts and `release()` restores it on landing. During the flight it may
  trim resolution, but it can't change tier.
- **Fly-over on very slow hardware.** The game clock advances at most 0.1 s per frame, so at 3 fps
  the opening flight stretched to 23 s. If frames stay above 55 ms (smoothed) for half a second,
  the flight now cuts itself short; a single hitch does not count. Under software rendering it now
  ends after 1.1 s (phone profile) and 1.9 s (desktop); a GPU still flies the whole way.
- **Restart from a later place.** "Restart run" from a later place could start two place changes
  on the same prepared scene. All mid-game changes now go through one queued `swapPlace`.

## Not verified

- **Real devices.** Everything above ran in headless Chrome with a GPU on this laptop. No
  entry-level Android phone, no iOS Safari, no integrated-GPU-only PC.
- **How the music sounds.** I could only render and measure it, not listen. WAVs of the old drone,
  the new lake score and the fjord score (2 minutes each) are in the session scratchpad as
  `music-*.wav`. That folder is temporary; otherwise listen in game with `npm run dev`, adding
  `?debug&place=fjord` for the fjord.
- **Whether a fly-over at every level gets tiresome** over a long run. The short version is
  1 close-up and at most 3.2 s, and any press skips it.

## What to work on next

1. **Your review of the checkpoint.** Aurora Fjord's look (`npm run dev`, then
   `?debug&level=4` and play into it, or `?debug&place=fjord`), and both scores. Changes to the
   art direction or the music style are cheapest now, before three more places copy them.
2. **The remaining places, one at a time**, as in the plan: Firefly Marsh (levels 7–9), Glow Lagoon
   (10–12) and Neon Harbour (13–15). Each is a new `src/render/places/<id>.js` plus a line in
   `places/index.js` and `PLACES`. Then run `npm run perf -- --place <id>` and compare it with
   Lantern Lake at a fixed tier, as above.
3. **A real low-end phone pass** on the fly-over close-ups. They are the heaviest frames in the
   game: a screen full of the glass shader.
4. **Only if playtesting says so:** an "Intro on/off" button in the pause menu, or the short flight
   only on every other level.
