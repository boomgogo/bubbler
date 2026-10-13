# Plan 2: an autoplayer that plays like a person, and three recordings

Answers `ai/prompt_2.md`: refine the autoplay script so it plays the real game the way a person does, then
record a YouTube video of one long run, a YouTube Short and a video for X. Nothing here is implemented yet.

**How I read "the script".** Two scripts play the game today, and neither can make a video:
- `tools/sim-bot.js` has the tuning bots. They are good players, but they only drive the rules in Node: there
  is no screen.
- `tools/perf.js` clicks the real game on a fixed pattern, twice a second, to measure frame rate.

This plan combines them: the bots' decisions, made fair and a little stronger, carried out in the real game
through real mouse and touch input, at a person's pace.

## The three videos

| | YouTube | YouTube Short | X |
|---|---|---|---|
| Frame | 2560×1440 (16:9), 60 fps | 1080×1920 (9:16), 60 fps | 1080×1080 (1:1), 60 fps |
| Length | the whole run, about 15–20 min (estimate below) | 45–55 s | 30–45 s |
| What | one continuous run, from the title screen to the game-over card, played with a mouse. No cuts. | highlights of the same run, re-rendered in a phone layout and played by touch | highlights cut from the YouTube master |
| Extras | a description with chapters per place, 3 thumbnail stills | a band under the game with the name and link | ends on the title screen with the link; text for the post |

**Length estimate.** The greedy bot with Second Wind takes about 350 shots a run. At about 2.2 s a shot, plus
about 5 s per level for the card and fly-over, that is 15–18 minutes. The real figure comes from the run search
(step 3) before anything is rendered.

## What the code does today (the facts this plan is built on)

- **The rules are deterministic.** A run is fixed by its seed and its sequence of shots, swaps and boosts.
  - The deal and the level generator are seeded.
  - `Game.serialize()` and `Game.load()` round-trip a run exactly.
  - So a run can be predicted in Node, played in the browser, and re-entered at any shot.
  - Visual randomness uses `Math.random` (sparks, drop jitter, the fly-over's side). It never touches the rules.
- **How far the bots get** (`npm run tune -- --games 30`, run today):

  | | Without Second Wind | With Second Wind |
  |---|---|---|
  | Greedy: median level | 18 (max 23) | 20 (max 23) |
  | Greedy: shots a run | 312 | 350 |
  | Greedy: mean score | 79,915 | 93,416 |
  | Casual: median level | 10 | 11 |

- **The greedy bot already plays fair on Mist.** A Mist bubble never matches: `matches()` in `board.js`
  requires `m === 0`. So the colour under the Mist plays no part in the bot's choices. It also never reads the
  deal's random state. It sees what a player sees: the board, the bubble in hand and the next one.
- **Input.**
  - The game fires on pointer release, at the angle from the launcher to the pointer.
  - Chrome keeps fractional pointer coordinates sent over CDP, for both mouse and touch (checked today), so aim
    can be exact to well under a pixel.
  - A context with `hasTouch` reports `pointer: coarse`, so the game shows its touch hints ("Drag to aim, lift
    to shoot", "Tap to skip").
- **The debug handle** (`?debug`) exposes `game`, `view`, `hud` and `audio`. Its `fireAt()` skips input
  entirely, so the recorder won't use it.
- **Sound.**
  - Everything goes through one master gain and a limiter, in mono.
  - `Band` books notes 1.2 s ahead from a 250 ms `setInterval`.
  - `tools/music.js` already renders scores through an `OfflineAudioContext`.
- **The HUD's motion is CSS:**
  - score tallies (a 1.25 s animation, removed on `animationend`);
  - card and hint fades, the veil, the progress bar and the gem pulse;
  - hiding waits on a 320 ms `setTimeout`.
- **This machine.**
  - Chrome 155 headless renders on the Intel HD 630 (ANGLE, OpenGL ES 3.2) at the high tier.
  - ffmpeg 8.0.1, with libx264 and AAC.
  - 8 cores, 14 GB of RAM and 29 GB of free disk.
- **Screenshot cost** (a probe today, with the game running live at the same time):

  | Frame | PNG, fast mode | JPEG q92 |
  |---|---|---|
  | 1920×1080 | 140 ms | 129 ms |
  | 2560×1440 | 115 ms | 88 ms |
  | 1080×1920 | 74 ms | 54 ms |

- **Fonts.** Headless Chrome resolves `system-ui` to Noto Sans. Only Regular and Bold are installed, so the
  HUD's 200 and 300 weights (the score, the moves) would render heavier than designed. Ubuntu Sans is installed
  as a variable font with the light weights.

## The approach: a frame-exact recording, not a screen capture

**Real-time capture is fragile here:**
- Playwright's built-in video is VP8 at about 1 Mbit/s with no sound.
- Grabbing the Wayland screen with ffmpeg, or tab capture with `MediaRecorder`, needs the live game to hold
  60 fps at 1440p on the HD 630 while an encoder runs on the same machine. Every dropped frame stays in the video.

**Instead, the recorder owns the clock.** For each frame it advances time by exactly 1/60 s, lets the game draw
that frame, takes a screenshot and pipes it to ffmpeg.
- Every frame is perfect, however long it takes to draw, and a re-render is identical.
- It runs slower than real time. From the probe, about 8–10× real time, so a 17-minute run takes roughly 2.5–3
  hours, unattended. The pilot in step 4 measures this properly before the long render starts.
- It is the same headless, GPU-backed Chrome that `perf.js` already uses.

The game's code stays as it is. The clock is replaced from outside, by a script the recorder injects before the
page loads (`tools/record-clock.js`):

- **Time.**
  - `performance.now`, `Date.now` and `requestAnimationFrame` follow the recorder's clock.
  - So do `setTimeout`, `setInterval` and `requestIdleCallback`. That covers the HUD fades, the music's ticker,
    the band's clean-up and the place prefetch.
  - The clock moves only when the recorder steps it. Through loading and any pre-roll, the recorder steps
    without capturing.
- **CSS motion.** At each step, every animation in `document.getAnimations()` is paused and set to its time on
  the recorder's clock. One that has reached its end is finished, so `animationend` still removes the tallies.
- **Randomness.** `Math.random` is seeded, so sparks and fly-overs render the same every time.
- **Sound in step with the picture.** `AudioContext` becomes an `OfflineAudioContext` (48 kHz, mono, like the
  game's chain) that renders in lockstep: it is suspended at each frame's time.
  - A pop is heard on the same frame it is seen.
  - At the end the buffer is read out in slices to a WAV.
  - A 30-minute run holds about 350 MB in the page, which is fine on this machine.
- **On-screen extras**, added by the recorder only:
  - a mouse cursor with a small ripple on click, for the desktop videos;
  - a soft touch dot, like a phone's "show taps", for the Short. Both follow the real pointer events;
  - `#debug` hidden;
  - the HUD font set to Ubuntu Sans (see open question 6);
  - a black layer for the opening and closing fades, so the YouTube file needs no second encode.

## Build order

0. **Groundwork:** two debug getters, scripts and `.gitignore`.
1. **A stronger, fair policy** in `sim-bot.js`, measured in `tune.js`.
2. **The human layer:** timing and hand movement.
3. **Run search:** simulate many seeds in Node, pick the run to record.
4. **The recorder**, with a 90-second pilot at full settings. The pilot sets the final resolution.
5. **The YouTube video.**
6. **The Short.**
7. **The X video.**
8. **README, tests and `ai/next_2.md`.**

---

## Step 0: groundwork

- **`src/app.js`**, on the debug handle only, two read-only getters:
  - `ready`: whether input is accepted right now (playing, not paused, not locked, phase `aim`);
  - `aim`: the current aim angle, or `null`.

  The recorder needs to know when the game will take a shot, and to read back the angle the pointer gives, as a
  player reads the aim line. That is about 50 bytes on the critical path, with no other change to shipped code.
- **`.gitignore`:** `recordings/`. The videos are gigabytes, and they stay out of git.
- **`package.json`:** `autoplay`, `record` and `cut` scripts.

## Step 1: a stronger, fair policy (`tools/sim-bot.js`)

A new `expertPolicy`, next to `greedyPolicy`:

- **It sees what a player sees.** That is the board, the bubble in hand and the next one, gems and moves. It
  never reads Mist colours or the deal. A test enforces this: shuffle the Mist colours, or change the deal's
  state, and the decision must not change.
- **Two shots ahead.** The bot scores each first shot, plus 0.6 × the best follow-up with the bubble that comes
  next (both are visible). It looks ahead only for the 6 best first shots, to keep the search fast.
- **Board health.** A penalty for bubbles near the fail row, and a small bonus for keeping a streak alive.
- **Boosts as a careful player uses them:**
  - **Comet:** when a piercing shot is worth clearly more than the best normal shot, or when the board is
    crowded, and enough gems remain to keep Second Wind affordable later.
  - **Clear Skies:** when Mist covers much of the bottom of the board.
  - **Second Wind:** whenever it is offered.
- **Aim with a margin.** Many angles give the same result. The bot aims at the middle of the widest run of them
  and skips shots whose window is narrower than about 0.004 rad (half a pixel at the release point), unless
  nothing else is worth taking. A person aims for the middle, not the edge, and this also guarantees the
  browser reproduces the planned shot.
- **Measure:** `tune.js` gains an `expert` row. The target is at least greedy's median of level 20 with Second
  Wind, over 200 seeds. That is a target, not a promise: the video shows whatever the best run reaches.

## Step 2: the human layer (`tools/human.js`)

These are pure functions with a seeded random source, so the same run always moves the same way. Defaults:

- **Reading the board.**
  - About 0.2 s after the board settles, the player starts to think.
  - Thinking takes a median of 0.55 s, with a long-tailed spread.
  - It takes longer when the two best shots are close, or when no shot scores. It takes shorter when one shot is
    obviously big.
- **Looking around.** On close calls, the cursor first sweeps to the runner-up shot and rests there for
  150–300 ms, then moves to the chosen one. The aim line on screen shows the player weighing up both.
- **Moving.**
  - Each move follows a smooth, slightly curved path.
  - Its time follows Fitts's law: about 0.2–0.6 s, longer for longer moves and smaller targets.
  - A main movement lands near the target, then a small correction lands on it.
- **Checking before letting go.** The pointer holds for 60–150 ms. If the aim line's ghost bubble isn't in the
  planned cell, it nudges by a pixel and checks again, at most 5 times. The click is held 60–110 ms.
- **Where it points.**
  - For a straight shot: along the chosen angle, at about the target's distance.
  - For a bank shot: at the point where the shot first meets the wall.
- **Using the UI.**
  - **Swap:** click or tap the launcher, as the in-game hint teaches.
  - **Boosts:** click the boost buttons.
  - **Second Wind:** press it on the card.
  - **New run:** press Play on the title screen.
  - **Fly-overs:** watched, never skipped.
  - **While waiting:** hands off. The cursor drifts to a rest near the launcher.
- **Touch, for the Short.**
  - The finger goes down on the aim line, drags a short way to settle the aim, then lifts to fire.
  - Taps for the launcher and the buttons.
- **No deliberate mistakes** (`--slips 0`), and aim error always stays inside the window. `--pace` scales every
  delay, and `--slips` can add the occasional second-best choice.

## Step 3: run search (`tools/autoplay.js`, `npm run autoplay`)

- **It simulates seeds** with `expertPolicy` in Node, across 8 worker threads. The default is 400 seeds.
- **It ranks them** by level reached, then by score, and prints the top 10 with:
  - level and score;
  - shots, revives and big shots;
  - the places visited;
  - a predicted video length, from the human layer's timings plus the game's own card and fly-over times.
- **The pick** is the top run, unless its predicted length is over 30 minutes (open question 4).
- **Is this cheating?** Choosing the seed is choosing which attempt to publish, as a player would show their
  best run. Within the run, the bot plays fair.

## Step 4: the recorder (`tools/record.js`, `npm run record`)

**Setup**
- Plays the built site through `tools/serve.js`, in a fresh browser profile.
- Quality is locked at high, with `?debug&seed=<seed>`.
- Profiles:
  - **desktop:** 1280×720 CSS at device scale 2, giving 2560×1440 (or 1.5 for 1920×1080), mouse;
  - **phone:** 432×672 CSS at 2.5, giving 1080×1680, touch.

**Each shot**
1. Read the state with `game.serialize()`.
2. Rebuild it in Node and ask `expertPolicy`. This is the same decision the run search made.
3. Plan the hand's movements with `human.js`.
4. Send them as CDP mouse or touch events, frame by frame.

**Each frame**
1. Advance the sound to the frame's time.
2. Run due timers and the game's frame.
3. Take a PNG screenshot (fast mode) and pipe it to ffmpeg.

The encode settings are below.

**The encode** (libx264, written once at final quality)
- `-preset slow -crf 16 -profile:v high -pix_fmt yuv420p -g 30 -bf 2`.
- The colour is converted with an explicit BT.709 matrix and tagged BT.709. Otherwise ffmpeg converts with
  BT.601 and the colours shift on YouTube.

**Event log** (`run.json`), in frame numbers. Steps 5–7 use it to find moments without watching the video:
- each shot: its result and the state before it;
- level starts and clears, changes of place, fly-overs;
- Second Wind and game over.

**Check against the prediction.** After each shot, the board is compared with the Node prediction. The final
level and score must match the run search. Any difference is reported.

**`--watch`** plays the same bot live, in real time, in a visible Chrome window, with no capture. It is the
quick way to see the autoplayer at work.

**The pilot.** Record the first 90 s of the chosen run at final settings, then:
- **Time:** time per frame, and from it the full render time.
- **Motion:** a flying bubble moves evenly from frame to frame, with no repeated frames.
- **Sync:** pop sounds start within one frame of the pops on screen.
- **CSS timing:** a score tally lasts 1.25 s, to within a frame.
- **Looks:** stills of the cursor, fonts and HUD.

If the estimate is over about 5 hours, drop to 1920×1080. If it is still over, drop to 30 fps. The pilot's
numbers go in `next_2.md`.

## Step 5: the YouTube video

- **One render of the whole run**, about 2.5–3 hours of machine time:
  - it opens with a fade-in on the title screen, the cursor goes to Play, and the fly-over follows;
  - it closes after 5 s on the game-over card, with the final score, and a 1 s fade.
- **Sound.**
  - Two-pass `loudnorm` to −14 LUFS, true peak −1 dBTP. YouTube turns loud videos down but never turns quiet
    ones up, and the game's mix sits low (music around −28 dBFS RMS).
  - AAC at 384 kbit/s, 48 kHz, stereo from the mono mix.
  - Muxed with the video copied (no second encode), with `+faststart`.
- **`recordings/youtube/youtube.txt`:**
  - title options;
  - a description: what the game is, the link, controls, that it was played by the game's own autoplay bot in
    one take, the final level and score;
  - chapters per place, from the event log. YouTube's rules: the first at 0:00, at least 3, each at least 10 s;
  - tags.
- **Thumbnails:** three 1280×720 stills taken from logged moments: the biggest avalanche, a fly-over close-up,
  and a place panorama. They have no text, so you can add your own.

## Step 6: the Short

**Pick the moments from `run.json`:**
- **Hook (first 2–3 s):** the run's biggest avalanche.
- **A fly-over close-up** of glass bubbles, preferring a place with strong reflections (Fjord or Harbour).
- **One standout shot per place, about 6 s each.** These favour variety: a Comet row clear, a Nova burst, a
  chain drop.
- **The ending:** the last level reached, then the game-over card with the final score.

**Re-render each moment** in the phone layout, played by touch, starting from the state saved before it.
- The profile is pre-filled, so no tutorial lines appear: the taught set is complete and the shot count is at
  least 3.
- A few seconds of pre-roll let the place and music settle, then are dropped.
- A fly-over moment starts a level directly (`?debug&level=N`), since the HUD is hidden in flight anyway.

**Assemble with ffmpeg:**
- cuts with 0.25 s crossfades (`xfade`, `acrossfade`);
- the game, at 1080×1680, at the top of a 1080×1920 frame;
- a 240 px band under it with "Bubbler · free, open source, no ads" and the link.

Shorts' own buttons and caption cover the bottom of the frame, so the band takes that space rather than the
launcher.

**Finish:** loudness as above; 60 s at most.

**Check:** draw the Shorts safe-zone boxes over a still and look.

## Step 7: the X video

- **Cut from the YouTube master:** a 1440×1440 centre crop, scaled to 1080×1080.
  - The whole board and HUD fit, with scenery on both sides.
  - Only the version label in the corner is lost.
- **The cut, 30–45 s:**
  - the biggest shot first, since X plays muted and the first seconds decide;
  - then a fly-over close-up;
  - 3–4 big shots in different places;
  - one change of place (card, veil, the new place's fly-over);
  - the final score;
  - 2 s on the title screen, with the link added.
- **Encode:** H.264 High and AAC, well within X's limits (2:20, 512 MB, 60 fps). Loudness as above.
- **`x.txt`:** text for the post.

## Step 8: tests, README, next

- **`tools/test/autoplay.test.js` (new):**
  - Fairness: decisions don't change when Mist colours or the deal's state change.
  - Margin: the chosen angle ± its margin lands in the same cell.
  - Determinism: the same seed gives the same run and the same movements.
  - Movement:
    - paths start at the cursor and end exactly on the target;
    - they never leave the canvas;
    - their timings stay within bounds.
  - Chapters meet YouTube's rules.
- **README:** `npm run autoplay`, `npm run record` (with `--watch`) and `npm run cut`, plus a line on where
  recordings go.
- **`ai/next_2.md`:** what was built, the pilot's numbers, predicted against actual, and the files made.

## Done when

- `npm test` passes, and `check:size` is unchanged apart from the two getters.
- The YouTube run's final level and score match the run search, with no differences shot by shot.
- **The pilot's checks pass:** even motion, no repeated frames, sound within a frame, tallies on time.
- **`ffprobe` confirms each file's format:**
  - YouTube: 2560×1440 (or 1920×1080) at a constant 60 fps, H.264 High, AAC, longer than 5 minutes.
  - Short: 1080×1920, 60 s at most.
  - X: 1080×1080, 2:20 at most, under 512 MB.
- **Loudness:** every file at −14 ± 1 LUFS with true peak at or under −1 dBTP (ffmpeg's `ebur128`).
- **Contact sheets** of stills, every 30 s for YouTube and every 3 s for the short ones, show:
  - no banding in the night skies;
  - no HUD cut off;
  - the cursor or touch dot where it should be.

## Risks

- **A screenshot could show a stale WebGL frame.** The pilot's motion check catches this. The fallback is
  Chrome's frame-by-frame capture (`HeadlessExperimental.beginFrame` in `chrome-headless-shell`), which draws
  and grabs in one call.
- **CSS animations might not follow the recorder's clock.** The pilot's tally check catches this. The fallback
  is a CDP playback rate that matches the render speed.
- **Render time.** The probe ran with the game live, so the real figure may be better or worse. The pilot
  decides between 1440p and 1080p, and 60 or 30 fps, before the long render.
- **The stronger policy might not beat greedy.** Then greedy (fair, as shown above) records the run, with the
  same human layer.
- **YouTube's encoder and dark gradients.** Uploading at 1440p makes YouTube serve VP9 or AV1 at every size,
  which is much kinder to night skies, fireflies and snow. If the stills still band, the fix is `aq-mode=3` and
  a lower CRF.
- **Not verifiable here:**
  - how the videos look after YouTube and X process them;
  - whether the bot reads as a person to a viewer, and how the mix sounds.

  These need your eyes and ears. Uploading is yours to do: I won't publish anything.

## Files

| File | Change |
|---|---|
| `src/app.js` | debug handle: `ready` and `aim` getters |
| `tools/sim-bot.js` | `expertPolicy`: fair, two shots ahead, boosts, aim with a margin |
| `tools/tune.js` | an `expert` row |
| `tools/human.js` (new) | think times, sweeps, hand paths, release check, mouse and touch |
| `tools/autoplay.js` (new) | run search across seeds, in worker threads |
| `tools/record-clock.js` (new) | injected: recorder-owned clock, CSS animations, seeded random, lockstep offline audio, cursor and touch dot, fades |
| `tools/record.js` (new) | drives the built site, captures to ffmpeg, event log, `--watch`, pilot checks |
| `tools/cut.js` (new) | Short and X edits, loudness, chapters, thumbnails, post text |
| `tools/test/autoplay.test.js` (new) | fairness, margin, determinism, movement, chapters |
| `package.json` | `autoplay`, `record`, `cut` |
| `.gitignore` | `recordings/` |
| `README.md` | the new commands |

Outputs go in `recordings/` (not in git): `youtube/`, `short/` and `x/`, each with its video and text, plus
`run.json`.

Not changing: the rules, the rendering, the places, the music, the save format, or anything a player downloads,
apart from the two debug getters.

## Open questions (the default I'll use if you don't say otherwise)

1. **The link in the videos and descriptions.** I don't know the game's public address. Default:
   `github.com/boomgogo/bubbler`, from `site.config.js`. Give me the play URL and it goes in instead.
2. **Saying it's a bot.** Default: yes, in the description ("played by the game's own autoplay bot, one take,
   no edits"), and not on screen. The alternative is to say nothing.
3. **X's frame.** Default: 1:1 square, cut from the master. The alternatives:
   - 16:9: all the scenery, but a small board on phones;
   - the vertical Short again: no extra work, but the same video twice.
4. **Length of the YouTube video.** Default:
   - the best run, however long, up to 30 minutes;
   - every fly-over watched, since they show the rendering.

   The alternative is to skip the short fly-overs after the first round of places (about a minute shorter), or
   to cap the search at a shorter run.
5. **Resolution and frame rate.** Default: 1440p60 if the pilot says the render fits in about 5 hours, otherwise
   1080p60. 30 fps halves the render time but makes shots and fly-overs less smooth.
6. **The HUD font.** Default: Ubuntu Sans, so the light weights show as designed. The alternative is this
   machine's `system-ui` (Noto Sans, Regular only), which is closer to a Linux player's view but heavier than on
   Windows, Android or iOS.
