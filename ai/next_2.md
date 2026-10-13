# Next 2: what was built for prompt 2, and what comes next

Implements `ai/plan_2.md`: an autoplayer that plays fair and moves like a person, a recorder that films the
built game frame by frame, and three videos cut from one run. Nothing was uploaded; that is yours to do.

**Before you post anything, deploy this build.** Making the videos turned up a bug in the game (below): on
the live site a run never reaches Firefly Marsh or Glow Lagoon. The videos show the fixed game.

## The videos

All in `recordings/` (ignored by git). Seed 177, the best of 400 seeds: level 32, 490,092 points, 628 shots,
one Second Wind. The browser run matched the Node prediction shot for shot.

| File | What | Format |
|---|---|---|
| `youtube/bubbler-youtube.mp4` | the whole run in one take, title screen to the game-over card | 2560×1440, 60 fps, 36:25, 3.1 GB; −14.3 LUFS, −4.7 dBTP |
| `youtube/youtube.txt` | titles, description (says it's the bot), chapters per place, how to play, tags | |
| `youtube/thumb-*.jpg`, `thumbs.txt` | stills to pick a thumbnail from: the two biggest clears, fly-overs, the title | 1280×720 |
| `short/bubbler-short.mp4`, `short.txt` | hook (103 bubbles), Neon Harbour fly-over close-ups, the best shot in each place, the end | 1080×1920, 60 fps, 45.3 s; −14.2 LUFS, −4.2 dBTP |
| `x/bubbler-x.mp4`, `x.txt` | a square cut of the master: biggest shot, fly-over, three places, a change of place, the end, the title with the link | 1080×1080, 60 fps, 30.7 s, 24.5 MB; −14.0 LUFS, −6.4 dBTP; post 236 of 280 characters |

**The master's checks** (`youtube/run.json`):
- 131,146 frames, 2185.77 s, the same length as the sound to the millisecond. 119 ms a frame to render, 112 of
  them for the screenshot.
- 8,477 frames of shots in flight, none repeated. The sound clock drifted 1.3 ms over the whole run.
- 560 score tallies, none off by more than a frame. 555 pops checked: the pop sound starts within 8 ms
  (median) of the frame its shot lands on, in the first five minutes, the middle and the last five alike.
- No turn was played in the wrong place. The places go Lake, Fjord, Marsh, Lagoon, Harbour twice, then
  Lake again for levels 31–32.

Also in `recordings/`: `youtube-wrong-places/` (6.1 GB) is the first take, made before the place fix. The
same run, shot for shot, so the Short was re-recorded from its saved states; it can be deleted. `pilot/`
(102 MB) is the 90-second trial.

## What was built

- **A fair expert bot** (`tools/sim-bot.js`, `expertPolicy`):
  - it plays a copy of the board with every Mist colour hidden, and never reads the deal;
  - it sweeps the aim and bisects the edges to find each landing's window, and aims at the middle of the
    widest one;
  - it looks two shots ahead, and buys Comet or Clear boosts with gems when they pay, keeping enough for a
    Second Wind.
  - Over 10 runs: median level 23, best 27 (greedy: 20 and 23). Over 400 seeds: median 22, best 32.
- **Hands** (`tools/human.js`): think times that grow with a hard choice, Fitts's-law reaches along
  minimum-jerk curves with a small correction at the end, a glance at the runner-up, mouse clicks or touch
  drags. All seeded, so a re-render moves the same way.
- **Run search** (`tools/autoplay.js`, `npm run autoplay`): plays many seeds in worker threads and ranks
  them. Its estimate of the video's length is now calibrated on the real recording.
- **The recorder** (`tools/record.js`, `tools/record-clock.js`, `npm run record`):
  - it owns the page's clock: time, timers, animation frames, CSS animations and `Math.random` all step
    with the frames, so every frame is drawn in full whatever the machine;
  - the sound is rendered offline in step with the frames, so it cannot drift;
  - frames are captured over CDP at device scale, as JPEG q95, and encoded with x264 (CRF 16, High, BT.709,
    60 fps);
  - after each turn it checks the browser's state against the Node prediction, and corrects the aim from
    where the page saw the pointer;
  - every run saves its checks in `run.json`.
- **The cut tool** (`tools/cut.js`, `npm run cut -- youtube|short|x`): the YouTube text and stills; the
  Short, re-recorded piece by piece in a phone layout by touch from the saved states; and the X cut from the
  master. Joins use 0.25 s crossfades. Sound goes to −14 LUFS with true peak at or under −1 dBTP *after*
  the AAC encode.
- **Tests** (`tools/test/autoplay.test.js`, 7): the bot ignores Mist colours and the deal; the chosen angle
  sits well inside its window; a seed always plays the same run; hand paths start and end where they
  should; think times; chapters follow YouTube's rules.

## Bugs found on the way

- **The game skipped places** (`src/app.js`, `prefetch`). When a level is cleared, the next place is swapped
  in under the level card, before `nextLevel()`. The prefetch that follows counted from the old level, so it
  readied the place just left instead of the next one. A run went Lake → Fjord (levels 4–15) → Lake (16–27)
  → Harbour, and never saw Firefly Marsh or Glow Lagoon. With two places (before prompt 1) the mistake was
  invisible. It now counts from the level about to start. The first full recording caught it: 395 of its
  629 turns were played in the wrong place. The recorder now checks this on every run.
- **Colour tags.** ffmpeg 8 tags a stream from its frames, not from the encoder options, so the transfer
  and primaries came out "unknown". The filters now set them (`setparams`).
- **AAC overshoot.** loudnorm's dynamic mode let the AAC encode overshoot by 2.6 dB, so the master's
  true peak came out at +1.2 dBFS. Moving its targets didn't help: the result swung between −14 and −22
  LUFS. Now a gain and a limiter (starting at a −3.5 dBFS ceiling) do the work. The encode is measured, and
  redone with the gain or ceiling corrected when it misses. The master took three passes (26 minutes): gain
  +17.3 dB, ceiling −5.5 dBFS, −14.3 LUFS and −4.7 dBTP.
- **Short pieces ran long.** A piece played on into the next turns when the board settled before its tail
  ran out. `play()` now takes no turns after the last one asked for.
- **Earlier ones:**
  - `Game.load` keeps the arrays it is given, so a saved state changed under the recorder. It now gets a
    copy.
  - A device-metrics override on the recorder's CDP session sometimes halved touch coordinates.
    Screenshots now use a device-scale clip instead.
  - A random jitter on the aim moved a Comet shot to the edge of a narrow window, and the run left the
    prediction at turn 56. The hand now releases exactly at the chosen angle.
  - A flaky fly-over test (1 run in 16) is seeded now.

## Where this differs from the plan

- **The YouTube video is 36:25, not "up to 30 minutes".** The run search predicted 27:26; the estimate
  left out the pops settling after each shot. Calibrated on the first take, it now says 36:17. It is
  still one continuous take of the best run. If you'd rather have 30 minutes, the choices are another seed
  (several reach level 29–31) or skipping the short fly-overs after the first round of places.
- **Frames are JPEG q95, not PNG.** At 2560×1440 a frame took 119 ms instead of 200, so the master rendered
  in 4 h 20 min instead of about 7 h. After the conversion to YUV the difference from PNG is about 46 dB
  PSNR, below what x264 at CRF 16 keeps.
- **The Short's layout:** the game at 1080×1440 under a 170 px title band, with a 310 px band below it.
  Shorts' own buttons sit over the right edge of the board's lower half and over the boost buttons.
- **No jitter on the release angle** (see above). The hand still moves like a hand; only the final angle is
  exact.

## Not verified

- **How it sounds.** Loudness and peaks are measured, but nobody has listened. **Listen to the master
  before uploading.** The pops peak about 26 dB above the music, so to reach −14 LUFS the master's limiter
  turns their loudest instants down by up to 22 dB, and the loudness range drops from 6.3 LU to 1.7. If the
  pops sound squashed or the music too loud under them, a −16 LUFS target in `encodeAudio` keeps more punch
  (YouTube turns loud videos down but quiet ones not up), and `mux()` redoes the sound without
  re-recording.
- How the videos look after YouTube and X process them, and on a phone with Shorts' buttons on top.
- Whether the bot reads as a person to a viewer.

## What to work on next

1. Deploy the place fix, then upload: `youtube.txt`, `short.txt` and `x.txt` hold the text.
2. Watch the Short on a phone. If Shorts' buttons hide too much of the board, move the game up (`top` in
   `short()`).
3. Look at a few minutes of the master next to YouTube's processed version for banding in the night skies.
   If it bands, try `aq-mode=3` and a lower CRF.
4. A browser test that plays through a change of place would have caught the place bug before any
   recording. The recorder's check covers recordings only.
