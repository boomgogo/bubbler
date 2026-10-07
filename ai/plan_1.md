# Plan 1: the remaining places

Answers `ai/prompt_1.md`: build Firefly Marsh, Glow Lagoon and Neon Harbour from `ai/next_0.md` in one go.
Nothing here is implemented yet.

## What the code does today (the facts this plan is built on)

- **The places engine is done.** `environment.js` is the host. `places/kit.js` holds the parts and the eight art rules. `lake.js` ships in the main chunk. `fjord.js` is a lazy chunk.
  - A place module is `{ id, name, theme, music, build(shared) → Group }`.
  - `config.js` has `PLACES = ['lake', 'fjord']`. `places/index.js` maps ids to `import()`s.
  - `app.js` already prefetches the current and next place, swaps under the veil, says "On to …" on the cleared card and crossfades the music. Adding a place takes a module, a loader line and a `PLACES` entry. No engine work is needed.
- **Budget today** (`npm run build && npm run check:size`, just run):
  - critical path: 136.0 KB brotli, against a 250 KB budget;
  - `fjord` chunk: 3.1 KB, against 20 KB per chunk.
- **What lands on the critical path.** `kit.js` is imported by `lake.js`, so all of it ships before Play. Anything added to `kit.js` grows the critical path, even if only lazy places use it.
- **What each frame costs.** The place's scene is drawn every frame at full resolution, behind the board. On mid and high, one cube face is redrawn per frame as well. On low, the cube map is shot once per place, so animation in reflections freezes there. A place doesn't know the tier.
- **Music.** `Band` plays a score: `{ bpm, beats, level, echo, air, bar(play, i, t) }`.
  - Its instruments are `pad`, `bass`, `pluck`, `bell`, `lead` and `shaker`.
  - The pops always play D major pentatonic (D E F♯ A B). So a score has to be in a key that contains those notes: D, G or A major, or their relative minors.
  - Plan 0 put Firefly Marsh in F major and Neon Harbour in A minor. Both have F♮, which clashes with every F♯ pop, so this plan moves them a tone up (open question 1).
- **Your earlier feedback:** music needs a melody and rhythm, not a drone. Each score below has a tune, a beat and a four-pass form, like the lake's.
- **Already covered for new places:**
  - `check-nan.js` loops over `PLACES`;
  - `perf.js` takes `--place`;
  - `check-size.js` lists every lazy chunk.

## Build order

The new places are built in one go, with no stop for review between them. Each is still finished and checked before the next starts, so a problem in the shared parts shows up on the first place, not on all three.

0. **Groundwork:** shared lazy parts, instruments a score can bring, the registry, tests and tools.
1. **Firefly Marsh** (levels 7–9).
2. **Glow Lagoon** (levels 10–12).
3. **Neon Harbour** (levels 13–15).
4. **Whole-run pass:**
   - play 1 → 16 to check each transition and the wrap back to Lantern Lake;
   - the full measurement table;
   - `README.md`;
   - `ai/next_1.md`.

---

## Step 0: groundwork

### `src/render/places/parts.js` (new, lazy only)

These parts are shared by the three new places. Only lazy chunks import this file, so Rollup gives it a small chunk of its own (about 1 KB). It is fetched alongside whichever new place comes first, and the critical path doesn't grow. `kit.js`, `lake.js` and `fjord.js` stay untouched.

- **`motes(shared, opts)`:** points that drift and blink, plus, optionally, their reflection in the water, all in one draw call. The reflection is a second copy of each point with an `aMirror` flag, flipped about `WATER_Y`, dimmed and wobbling. Used for fireflies and the red tower lights.
  - `opts` takes:
    - `count` and `seed`;
    - a `spot(rand)` callback that returns a position, or `null` to reject one inside the clear zone of rule 5;
    - GLSL for `motion`, `blink` and `color`;
    - a size range.
  - Blinks are built from `max(0.0, sin(...))` raised by repeated multiplication, not `pow()`, so rule 8 holds by construction.
- **`withMirror(geometry)`:** appends a geometry's reflection, flipped about `WATER_Y` and carrying `aMirror = 1`, to the same buffer. A silhouette and its reflection then cost one draw call. Used for reeds and palms.
- **`mirrorInstances(geometry)`:** the same idea for an instanced geometry. It doubles the instances and flags the second half. Used for the skyline and the neon.

Fjord's snow stays as it is. Moving it into `parts.js` would make the fjord chunk fetch another file for no visible gain.

### Instruments a score brings (`src/audio/audio.js`)

A score may add `voices(tools) → { name: fn, ... }`. `Band` merges the result into `play`.
- `tools` is `{ ctx, out, strike, hold, noise, hz }`, the helpers `#instruments()` already has as closures. They are lifted out so a score can use them.
- This adds a few lines to the main chunk. The new instruments themselves (marimba, cricket, synth, kick, snare) live in their places' chunks.

### Registry and config

- `PLACES = ['lake', 'fjord', 'marsh', 'lagoon', 'harbour']`. Level 16 wraps back to Lantern Lake, as in plan 0.
- Three loader lines in `places/index.js`.

### Tools

- **`tools/perf.js --tier low|mid|high`** locks the tier the way the pause menu does, so places are compared at the same tier.
  - It also reports GPU time per frame: a render timed with `gl.finish()`.
  - This makes repeatable the comparison that iteration 0 did by hand ("within about 10% of Lantern Lake at a fixed tier").
- **`tools/music.js` (new)** runs Vite's dev server and headless Chrome, and renders each place's score for 2 minutes with an `OfflineAudioContext`.
  - It prints RMS, peak, and note onsets per minute.
  - `--out <dir>` also writes WAVs to listen to.
  - It needs no change to the shipped code, because `Band` already runs on any audio context.
  - Iteration 0 did this ad hoc. With five scores to match in loudness, it should be repeatable.

### Tests

- `core.test.js`: `placeOf` gives lake, fjord, marsh, lagoon, harbour, lake for levels 1, 4, 7, 10, 13 and 16.
- `tools/test/places.test.js` (new), for every place, old and new:
  - The module loads.
  - Its `id` matches its `PLACES` entry.
  - It has a `name`, a `#rrggbb` `theme` and `music`.
  - `build()`, called with stand-in uniforms, returns a `Group` of at most 8 drawables (rule 6). three.js builds geometry and materials in Node without WebGL.
  - **Music in key:** drive `bar()` for 64 bars through a recording `play`. Every pitched note must fall in one diatonic key that contains D E F♯ A B.
  - **Music moves:** each score has a tune (at least 16 notes over 8 bars on one voice) and at least 20 note onsets a minute. This is your "no monotonous hum" rule, as a test.

---

## The places

All three follow the kit's eight rules. Two of them shape every design below:
- Behind the board the sky stays dark and calm (rule 2).
- The bright, varied light goes behind the player and overhead (rule 3), because that is what the glass reflects.

Each place uses 6 of its 8 draw calls, leaving room to fix something the screenshots show.

### 1. Firefly Marsh: `marsh.js`, levels 7–9, theme `#04110e`

**Scene:** a still marsh at night. Dark teal-green, a low amber moon behind the player, willow crowns on the far shore, reeds round the water, a band of low fog, and fireflies everywhere.

| Part | How | Draws |
|---|---|---|
| Sky | Dark muted teal ahead. Behind the player, a large amber moon about 8° above the water, with a warm haze round it. A pale fog glow sits on the horizon all round. | 1 |
| Stars | About 300, faint and high (`low: 0.25`), dimmed by the haze. | 1 |
| Treeline | `ridges` with a soft, clumped profile (willow crowns rather than peaks), three low layers (h 7, 12, 20). Near-black green. The fog is painted into this shader at the waterline (`1 - smoothstep(0, 0.35, abs(vHeight))`), which gives the fog band without a mesh of its own. | 1 |
| Reeds | About 900 thin tapered blades in clumps on a ring at r 55–140, outside the clear zone. Each blade is one strip with its reflection (`withMirror`). They sway with height in the vertex shader. Silhouettes with a faint amber rim on the moon side. | 1 |
| Fireflies | About 600 `motes` from 0.3 to 9 units above the water, on slow wandering paths. Each blinks on its own 2–5 s period and is lit about 15% of the time, with a quick rise and a slower fade. Yellow-green, HDR, scaled by `uGlow`, with their reflections. About 40% are behind the player (z > 52), where the glass catches them. | 1 |
| Water | `water` with green-black depths and amber glints on the moon side. It is a little clearer than the lake's, for a stiller mirror. | 1 |

**Music: a marsh lullaby.** G major, in 3/4 at 88 bpm. It is the only place in three, which sets it apart from the four in four.
- **Chords:** Gmaj7, Em7, Cmaj7, D6 | Bm7, Em7, Am7, Dsus4 → D.
- **Rhythm:** a kalimba (`pluck`) plays six eighth-note chord tones per bar. The bass sounds on beat 1.
- **Tune:** an ocarina (`lead`, low vibrato) sings an 8-bar tune in pass 1. The kalimba answers it an octave up in pass 2. Pass 3 thins out.
- **Night sounds** (in this chunk's `voices`):
  - crickets: 3–4 sine pulses 25 ms apart at a high D (midi 110, about 4.7 kHz, so even they are in key), scattered on off-beats and louder in the quiet pass;
  - now and then a frog: a short 180 → 120 Hz sine drop on a downbeat.
- **Echo and air:** a short, damp echo of 1 beat, and almost no noise bed (a still night).

### 2. Glow Lagoon: `lagoon.js`, levels 10–12, theme `#070a24`

**Scene:** a warm tropical night. An indigo sky with the Milky Way arching behind and overhead, low palm islands, and cyan bioluminescence breaking along the wavelets.

| Part | How | Draws |
|---|---|---|
| Sky | Indigo to violet, dark ahead. The Milky Way follows a tilted great circle: it rises behind-left, passes high behind the player and sets behind-right, so it never crosses the sky behind the board. Its glow is a Gaussian across the band times 2 octaves of cheap value noise (dust lanes and star clouds), computed only where the band's weight exceeds 0.01, so the rest of the dome costs nothing extra. The galactic core, low behind-right, is the HDR highlight the glass catches. There is no moon. | 1 |
| Stars | About 1100, a third of them crowded along the band. | 1 |
| Islands | `ridges` with a sparse profile: flat at the waterline (so invisible) except for 5–7 low humps per layer. Dark, rimmed in indigo. | 1 |
| Palms | About 24 palms on the humps (the profile function says where they are). Each is a curved, tapered trunk strip plus 7 drooping frond strips, about 100 triangles, all merged and mirrored with `withMirror`. Silhouettes with a faint cyan underlight. | 1 |
| Crests | About 40 curved ribbons lying just above the water: along the island shores, and in long lines behind the player (z 60–150), where the glass sees them. A pulse of cyan travels along each ribbon, plus a few hash sparkles. HDR, flaring with `uGlow`. | 1 |
| Water | `water` with indigo depths and cyan glints, so the glints near the crests read as plankton. | 1 |

**Music: a lagoon groove.** A major, 4/4 at 96 bpm, the brightest and quickest of the five.
- **Chords:** Amaj7, F♯m7, Dmaj7, E6 | A, C♯m7, Dmaj7, Esus4 → E.
- **Marimba** (in this chunk's `voices`: a sine plus a 4× partial that dies within 0.08 s, the classic two-operator marimba): plays chord tones in a 3-3-2 pattern across the eighths.
- **Groove:**
  - bass on 1 and on the "and" of 2;
  - a very light `shaker` on the off-beats;
  - an `air` bed of surf swelling every 9 s or so.
- **Tune:** a whistle (`lead`, quicker vibrato) in pass 1, then steel-pan-like `bell`s with a short decay in pass 2. Pass 3 is marimba and bass at half density.
- **Echo:** a dotted eighth.

### 3. Neon Harbour: `harbour.js`, levels 13–15, theme `#0b0618`

**Scene:** a city harbour at night. A skyline with lit windows, neon signs, red lights blinking on the towers, and everything streaked in the water.

| Part | How | Draws |
|---|---|---|
| Sky | City haze: the horizon glows magenta to amber all round, brightest behind the player and to the sides, lower and dimmer behind the board. | 1 |
| Stars | About 200, overhead only (`low: 0.35`): light pollution. | 1 |
| Skyline | About 220 instanced boxes, axis-aligned, on rings at r 70–260. They are tall behind the player and to the sides (up to 60–90 units), and low, sparse and far ahead, so the sky behind the board stays calm. **Windows:** a hash grid on each face in world coordinates (floors and columns of about 0.9 × 1.2 units). Each building has its own share of lit windows and a warm or cool tint, and a few windows switch on and off over minutes. **Reflection:** the same instances, mirrored (`mirrorInstances`), with the window pattern smeared down into streaks (the hash taken on floor / 6, plus a sideways ripple) and dimmed. | 1 |
| Neon | About 40 thin quads: bars along roofs and strips down façades, in pink, cyan, violet and amber, HDR at 3–6 so the glass shows them as points of colour. A few buzz and flicker. Their reflections are long wobbling streaks on the water (the mirrored copy stretched 3× in height). | 1 |
| Tower lights | `motes`: red lights on the 15 tallest roofs, blinking at 1 Hz in a few groups, with their reflections. | 1 |
| Water | `water` with purple-black depths, magenta and cyan glints, and a bit more opacity, so the haze in the mirror stays muted. | 1 |

**Music: harbour nights.** Gentle synthwave in B minor at 84 bpm. These are plan 0's Am–F–C–G a tone up, so the pops stay in key.
- **Chords:** Bm, G, D, A | Em, G, D, A.
- **Voices** (in this chunk's `voices`):
  - `synth`: two detuned saws, or a square, through a lowpass with its own filter envelope;
  - `kick`: a soft sine dropping from 120 to 45 Hz;
  - `snare`: a soft burst of band-passed noise.
- **Parts:**
  - a pulse bass of eighth notes on the root, with the filter opening across each 4-bar phrase;
  - a quiet square arpeggio in sixteenths through a dotted-eighth echo, the synthwave signature;
  - a `pad` with a slow attack;
  - kick on 1 and 3, snare on 2 and 4, kept low in the mix. It is a puzzle game, not a club.
- **Form:**
  - pass 0 builds up (pad and bass, then drums);
  - pass 1 adds a `lead` tune;
  - pass 2 hands the tune to the arpeggio with a bell counter-melody;
  - pass 3 is a breakdown: pad and arpeggio, no kick.

---

## Checks for each place, before moving on

1. `npm test`.
2. `npm run build && npm run check:size`:
   - the place's chunk is under 20 KB (expect 3–5 KB);
   - `parts` is about 1 KB;
   - the critical path stays at 136.0 KB, give or take the few bytes of the `voices` hook.
3. `npm run check:nan` comes back clean. This is rule 8, and it is what caught the level 4 bug.
4. **Screenshots** with Playwright and a frozen clock (`freeze(t)`), at 360×800 and 1920×1080:
   - the playing view;
   - a fly-over close-up;
   - the veil lifting into the place.

   They need to show that all five bubble colours and their glyphs read against the backdrop, and that the reflections show the place.
5. **Frame rate and GPU time:**
   - `npm run perf -- --place <id>` on both profiles;
   - `--tier low`, `--tier mid` and `--tier high` against Lantern Lake: GPU time within about 10% at each tier;
   - `--software` once for all.
   - If a place is heavier, its own detail comes down (fewer motes, one noise octave, fewer windows). Leaning on the tier ladder is not the fix.
6. `node tools/music.js`: RMS within ±1.5 dB of Lantern Lake (−28.5 dBFS), peaks no higher than about −14 dBFS, and onsets per minute in the lake's range. The WAVs go in the scratchpad for you.

## Whole-run pass

- **Every transition**, with `?debug&level=6`, `9`, `12` and `15`, clearing into the next place:
  - the veil;
  - "On to …";
  - the music crossfade;
  - the full fly-over;
  - `theme-color`.

  Level 15 → 16 has to land cleanly back in Lantern Lake.
- **Continue a saved run** in each new place.
- **Prefetching:**
  - by the time a level card comes up, the next place is ready under the throttled network in `perf.js`;
  - at most two prepared places are held at once, as now.
- **`README.md`:** the five places, and `&place=marsh|lagoon|harbour`.
- **`ai/next_1.md`:** what was built, the measurements, and what wasn't verified.

**Done when:**
- Levels 7, 10 and 13 each open in their place, with their music, behind a clean veil, and level 16 returns to the lake.
- Reflections show each place on every tier.
- `check:nan`, `check:size` and `npm test` pass.
- Play-ready time is unchanged.
- Each place is within about 10% of Lantern Lake's GPU time at each fixed tier, and holds frame rate on the phone profile.
- Bubbles stay readable in the screenshots.
- Every score is in key with the pops, has a tune and a beat, and matches the lake in loudness.

## Risks

- **The Milky Way is on the dome, which is a full-screen shader every frame.** Mitigation: the branch on band weight, and only 2 noise octaves. The fallback is to drop the noise and draw the band with denser stars and a plain Gaussian glow.
- **Harbour window shading in the cube map.** On mid and high one face is redrawn per frame, and behind the player the faces are mostly buildings. The window hash is a few ALU ops per pixel. The fixed-tier GPU check will show whether it costs too much.
- **Five night scenes over water could blur together.** Each has its own palette (lake: ember and plum; fjord: teal and aurora green; marsh: green and amber; lagoon: indigo and cyan; harbour: magenta and cyan) and its own kind of light (lanterns, curtains, motes, ribbons, windows). Each score has its own tempo, meter and lead instrument.
- **Not verifiable here:** how the music sounds to a listener, and real low-end phones, the same gaps as `next_0.md`. The WAVs from `tools/music.js` are for your ears.

## Files

| File | Change |
|---|---|
| `src/config.js` | `PLACES` gains `marsh`, `lagoon`, `harbour` |
| `src/render/places/index.js` | three loader lines |
| `src/render/places/parts.js` (new, lazy) | `motes`, `withMirror`, `mirrorInstances` |
| `src/render/places/marsh.js`, `lagoon.js`, `harbour.js` (new, lazy) | the places, their scores and their extra voices |
| `src/audio/audio.js` | `Band` merges a score's `voices(tools)` into `play` |
| `tools/perf.js` | `--tier`, GPU time per frame |
| `tools/music.js` (new) | offline render: loudness, onsets, optional WAVs |
| `tools/test/core.test.js` | `placeOf` for all five places and the wrap |
| `tools/test/places.test.js` (new) | module shape, draw-call budget, music in key and moving |
| `package.json` | `"music": "node tools/music.js"` |
| `README.md` | the places and the new debug values |

Not changing: `kit.js`, `lake.js`, `fjord.js`, the environment host, the fly-over, the rules, the save format, the bubble shader, or the rule that there are no asset files.

## Open questions (the default I'll use if you don't say otherwise)

1. **Keys for Marsh and Harbour.** Plan 0's F major and A minor clash with the pops' F♯. Default: the same chords a tone up, in G major and B minor. The alternative is to retune the pops for each place, which changes a sound players hear on every shot.
2. **After level 15.** Default: back to Lantern Lake, then round again. Alternatives: stay in Neon Harbour, or shuffle the order after the first round.
3. **Drums in Neon Harbour.** Default: a soft kick and snare, low in the mix. The alternative is no drums, with the pulse bass carrying the beat.
4. **Marsh in three.** Default: yes, for variety among the scores. The alternative is four in four like the others.
