// Plays the game in Chrome with the autoplayer and records it, frame by frame.
//
// The recorder owns the page's clock (see record-clock.js): it advances time by exactly one frame,
// lets the game draw that frame, takes a screenshot and pipes it to ffmpeg. Every frame is perfect
// however long it takes to draw, so the video is smooth on any machine; it just renders slower than
// real time. The sound is rendered in step with the frames and written beside the video.
//
// The autoplayer reads the game's state each turn, asks the expert bot (tools/sim-bot.js) what to do,
// and carries it out the way a person does (tools/human.js): a look at the board, a hand that moves
// to the aim, a check of the aim line, a press. Mouse on the desktop profile, a finger on the phone.
//
// Usage: npm run build && node tools/record.js youtube --seed 123 [--res 1440] [--fps 60] [--pace 1]
//        node tools/record.js pilot --seed 123 [--seconds 90]
//        node tools/record.js watch --seed 123 [--phone]       (a visible window, in real time, no capture)
// Needs Google Chrome and ffmpeg. Output goes in recordings/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from './serve.js';
import { recClock } from './record-clock.js';
import { Game } from '../src/core/game.js';
import { traceShot } from '../src/core/shot.js';
import { placeOf, SHOT_SPEED, KIND } from '../src/config.js';
import { LAUNCH_WORLD_Y } from '../src/render/layout.js';
import { expertPolicy, takeTurn } from './sim-bot.js';
import { playRun } from './autoplay.js';
import * as human from './human.js';

export const ROOT = join(import.meta.dirname, '..');
export const RECORDINGS = join(ROOT, 'recordings');
export const SITE_URL = 'https://bu0.muon.day/';

// CSS size and device scale. The desktop is a common laptop window; at scale 2 the video is
// 2560x1440 (1.5 gives 1920x1080). The phones render at the high tier's full pixel ratio of 2.
export const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 540, height: 840 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  // A shorter phone for the Short: 1080x1440, which leaves room above and below for Shorts' own overlays.
  short: { viewport: { width: 540, height: 720 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const FONT = '"Ubuntu Sans", system-ui, sans-serif';
const TAUGHT = ['comet', 'nova', 'mist', 'obsidian'];

export const hashState = (state) => {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---- ffmpeg helpers, shared with tools/cut.js ----

export function ffmpeg(args, { input } = {}) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  child.done = new Promise((resolve, reject) => child.on('exit', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed (${code}): ${err}`)))));
  return child;
}

// x264 settings for every video we hand to YouTube or X: High profile, two B-frames, a keyframe every
// half second, and BT.709 throughout. Without the explicit matrix, ffmpeg converts RGB with BT.601
// and the colours shift once a player reads the file as BT.709. ffmpeg 8 tags the stream from the
// frames, not from the encoder options, so the frames carry the tags too (setparams).
export const X264 = (fps, crf = 16, preset = 'slow') => [
  '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-g', String(Math.round(fps / 2)), '-bf', '2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
];
export const TAG_709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv';
export const TO_709 = `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${TAG_709}`;

export function writeWav(path, int16, rate = 48000) {
  const pcm = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono: the game's mix has no panning
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

// The integrated loudness (LUFS) and highest true peak (dBTP) of a file's sound.
export async function loudness(path) {
  const log = await ffmpeg(['-loglevel', 'info', '-nostats', '-i', path, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']).done;
  const s = log.slice(log.lastIndexOf('Summary'));
  return { i: Number(s.match(/I:\s+(\S+)/)[1]), peak: Number(s.match(/Peak:\s+(\S+)/)[1]) };
}

// The sound of `input` (a WAV, or a video's PCM track) as stereo AAC in `out` (.m4a): -14 LUFS, what
// YouTube plays at (it turns loud videos down but never quiet ones up), with the true peak at or under
// -1 dBTP once encoded. The pops peak about 26 dB above the music, so getting there means limiting
// them. A gain and a limiter get there, corrected by what each encode measures, since AAC overshoots
// the limiter's ceiling on sharp pops (by 1-2 dB here). One pass is usually enough. (loudnorm was tried
// first: its dynamic mode let AAC overshoot by 2.6 dB, and as its targets moved it swung between -14
// and -22 LUFS.)
export async function encodeAudio(input, out, bitrate = '384k') {
  let gain = -14 - (await loudness(input)).i; // dB
  let ceiling = -3.5; // dBFS before encoding
  for (let k = 0; ; k++) {
    const limit = (10 ** (ceiling / 20)).toFixed(4);
    const af = `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=1:release=60:level=0:latency=1,aresample=48000`;
    await ffmpeg(['-i', input, '-vn', '-af', af, '-c:a', 'aac', '-b:a', bitrate, '-ac', '2', out]).done;
    const got = await loudness(out);
    const loud = Math.abs(got.i + 14) <= 0.3;
    if ((got.peak <= -1 && loud) || k === 4) return { ...got, gain, ceiling };
    if (got.peak > -1) ceiling = Math.round((ceiling - got.peak - 1.2) * 10) / 10;
    if (!loud) gain = Math.round((gain - 14 - got.i) * 10) / 10;
  }
}

// Puts the sound under the video (copied, not encoded again): loudness to -14 LUFS, AAC stereo.
export async function mux(videoPath, audioPath, outPath) {
  const audio = outPath.replace(/\.mp4$/, '.m4a');
  const sound = await encodeAudio(audioPath, audio);
  await ffmpeg(['-i', videoPath, '-i', audio, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest', '-movflags', '+faststart', outPath]).done;
  rmSync(audio);
  return sound;
}

// ---- The recorder ----

export class Recorder {
  // opts: name, profile ('desktop' | 'phone'), scale, fps, seed, pace, watch, crf, preset,
  //       audioSeconds (room for the sound), keepStates (save the state before each turn)
  constructor(opts) {
    this.opts = { profile: 'desktop', fps: 60, pace: 1, crf: 16, preset: 'slow', audioSeconds: 600, keepStates: false, ...opts };
    this.fps = this.opts.fps;
    this.seed = this.opts.seed >>> 0;
    this.watch = !!this.opts.watch;
    this.touch = PROFILES[this.opts.profile].hasTouch;
    this.dir = join(RECORDINGS, this.opts.name);
    this.status = {};
    this.prev = {};
    this.fade = 0;
    this.frameNo = 0; // frames captured so far
    this.capturing = false;
    this.turnNo = this.opts.turn ?? 0;
    this.events = [];
    this.at = { x: -100, y: -100 };
    this.down = false;
    this.timing = { step: 0, shot: 0, write: 0 };
  }

  async open({ query = '', storage = {} } = {}) {
    mkdirSync(this.dir, { recursive: true });
    this.server = await serve(join(ROOT, 'dist'));
    const profile = PROFILES[this.opts.profile];
    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: !this.watch,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
    });
    this.context = await this.browser.newContext({ ...profile, deviceScaleFactor: this.opts.scale ?? profile.deviceScaleFactor });
    await this.context.addInitScript(recClock, {
      virtual: !this.watch, seed: this.seed ^ 0x9e3779b9, audioSeconds: this.opts.audioSeconds, touch: this.touch, font: FONT,
    });
    // A fresh profile, with the quality fixed at high and anything else the recording needs saved.
    await this.context.addInitScript((items) => {
      if (sessionStorage.getItem('rec-seeded')) return;
      sessionStorage.setItem('rec-seeded', '1');
      for (const [key, value] of Object.entries(items)) localStorage.setItem('bubbler:' + key, JSON.stringify(value));
    }, { settings: { sound: true, music: true, quality: 'high' }, ...storage });
    this.page = await this.context.newPage();
    this.page.on('pageerror', (e) => console.error('page error:', e.message));
    this.page.on('console', (m) => m.type() === 'error' && console.error('page console:', m.text()));
    this.cdp = await this.context.newCDPSession(this.page);
    // Screenshots from this session come out in CSS pixels unless asked for the device scale. A clip
    // at that scale gives the same pixels as a native screenshot. (Setting the device metrics on this
    // session as well would do it too, but then Chrome sometimes scales touch input twice.)
    this.clip = { x: 0, y: 0, ...profile.viewport, scale: this.opts.scale ?? profile.deviceScaleFactor };
    const url = `http://127.0.0.1:${this.server.address().port}/?debug&seed=${this.seed}${query}`;
    await this.page.goto(url, { waitUntil: 'commit' });
    for (let i = 0; !this.status.booted; i++) {
      if (i > 3000) throw new Error('The game did not finish loading');
      await this.frame().catch(() => this.page.waitForTimeout(20));
    }
    await this.wait(0.4);
    this.layout = await this.page.evaluate(() => {
      const v = window.__bubbler.view;
      const r = v.canvas.getBoundingClientRect();
      return { left: v.frameRect.left, top: v.frameRect.top, unit: v.frameRect.unit, rx: r.left, ry: r.top, w: innerWidth, h: innerHeight };
    });
    // The launcher's centre on the screen, and pixels per world unit.
    const L = this.layout;
    Object.assign(L, { x: L.rx + (0 - L.left) * L.unit, y: L.ry + (L.top - LAUNCH_WORLD_Y) * L.unit });
  }

  // ---- Frames ----

  // Moves the page on by one frame and, while capturing, sends it to ffmpeg.
  async frame() {
    const t0 = performance.now();
    if (this.watch) {
      await new Promise((r) => setTimeout(r, 1000 / this.fps));
      this.status = await this.page.evaluate((fade) => window.__rec.step(0, fade), this.fade);
    } else this.status = await this.page.evaluate(([ms, fade]) => window.__rec.step(ms, fade), [1000 / this.fps, this.fade]);
    const t1 = performance.now();
    this.timing.step += t1 - t0;
    if (this.capturing && !this.watch) {
      // JPEG at 95 is a third faster than PNG at 1440p, and its loss sits below what the 4:2:0
      // video encode removes anyway (about 46 dB against the PNG, measured in YUV).
      const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true, clip: this.clip });
      const t2 = performance.now();
      this.timing.shot += t2 - t1;
      // A frame identical to the one before while the camera flies would be a stale screenshot.
      if (this.status.flight) {
        const hash = createHash('md5').update(data).digest('hex');
        this.flightFrames = (this.flightFrames ?? 0) + 1;
        if (hash === this.lastHash) this.repeats = (this.repeats ?? 0) + 1;
        this.lastHash = hash;
      }
      if (!this.encoder.stdin.write(Buffer.from(data, 'base64'))) await once(this.encoder.stdin, 'drain');
      this.timing.write += performance.now() - t2;
    }
    if (this.capturing) this.frameNo++;
    this.#notice();
    return this.status;
  }

  async wait(seconds) {
    const n = Math.max(1, Math.round(seconds * this.fps));
    for (let i = 0; i < n; i++) await this.frame();
  }

  async fadeTo(target, seconds) {
    const from = this.fade;
    const n = Math.max(1, Math.round(seconds * this.fps));
    for (let i = 1; i <= n; i++) {
      this.fade = from + (target - from) * (i / n);
      await this.frame();
    }
  }

  // Video time of the current frame, in seconds.
  get time() {
    return this.frameNo / this.fps;
  }

  // Notes what changed on screen, for the event log.
  #notice() {
    const s = this.status;
    const p = this.prev;
    const log = (type, extra) => this.capturing && this.events.push({ type, frame: this.frameNo, ...extra });
    if (s.level !== p.level && p.level !== undefined) log('level', { level: s.level });
    if (s.place !== p.place && p.place !== undefined) log('place', { place: s.place });
    if (s.flight !== p.flight) log(s.flight ? 'flight' : 'landed', { level: s.level });
    if (s.cleared && !p.cleared) log('cleared', { level: s.level });
    if (s.revive && !p.revive) log('revive-card', { level: s.level });
    if (s.over && !p.over) log('over', { level: s.level, score: s.score });
    this.prev = s;
  }

  startCapture(out = join(this.dir, 'video.mp4')) {
    this.videoPath = out;
    if (!this.watch) {
      this.encoder = ffmpeg([
        '-f', 'image2pipe', '-framerate', String(this.fps), '-c:v', 'mjpeg', '-i', '-',
        '-vf', TO_709, ...X264(this.fps, this.opts.crf, this.opts.preset), '-movflags', '+faststart', out,
      ], { input: true });
    }
    this.capturing = true;
    // The first frame captured is the next one drawn: the sound starts at its time.
    this.captureStartMs = this.status.t + (this.watch ? 0 : 1000 / this.fps);
    this.events.push({ type: 'start', frame: 0, level: this.status.level, place: this.status.place });
  }

  // Ends the video and writes the sound that goes with it, from its first frame to its last.
  async stopCapture() {
    this.capturing = false;
    if (this.watch) return;
    this.encoder.stdin.end();
    await this.encoder.done;
    const audio = await this.page.evaluate(() => window.__rec.finishAudio());
    const total = Math.round((this.frameNo / this.fps) * 48000);
    const pcm = new Int16Array(total);
    if (audio) {
      // Sample 0 of the sound was at audio.startMs on the page's clock; frame 0 at captureStartMs.
      const skip = Math.round(((this.captureStartMs - audio.startMs) / 1000) * audio.rate);
      const chunk = 48000 * 10;
      for (let to = Math.max(0, -skip); to < total; to += chunk) {
        const from = to + skip;
        const n = Math.min(chunk, total - to);
        const bytes = Buffer.from(await this.page.evaluate(([f, k]) => window.__rec.audioSlice(f, k), [from, n]), 'base64');
        pcm.set(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), to);
      }
    }
    this.audioPath = this.videoPath.replace(/\.mp4$/, '.wav');
    writeWav(this.audioPath, pcm);
    this.pcm = pcm;
  }

  // Checks that pictures, CSS and sound all kept the same time, saved with every run.
  async checks() {
    const page = await this.page.evaluate(() => ({ drift: window.__rec.drift ?? null, tallies: window.__rec.tallies }));
    const frame = 1000 / this.fps;
    const out = {
      msPerFrame: (this.timing.step + this.timing.shot + this.timing.write) / Math.max(1, this.frameNo),
      split: { step: this.timing.step / this.frameNo, screenshot: this.timing.shot / this.frameNo, encode: this.timing.write / this.frameNo },
      flightFrames: this.flightFrames ?? 0,
      repeatedFlightFrames: this.repeats ?? 0,
      soundClockDriftMs: page.drift,
      tallies: page.tallies.length,
      talliesOffByMoreThanAFrame: page.tallies.filter((t) => Math.abs(t - 1250) > frame + 0.01).length,
      // Shots taken somewhere other than the place the level belongs to: a place that never loaded.
      turnsInWrongPlace: this.events.filter((e) => e.type === 'turn' && e.place !== placeOf(e.level)).length,
    };
    // Sound against picture: where the first pop is heard, relative to the frame it is seen on.
    const rate = 48000;
    const env = (t) => {
      let s = 0;
      const i0 = Math.round(t * rate);
      for (let i = i0; i < i0 + 96; i++) s += (this.pcm[i] ?? 0) ** 2;
      return s;
    };
    const offsets = [];
    for (const e of this.events) {
      if (e.type !== 'turn' || e.fired == null || e.pierce || !e.flight) continue;
      // The press lands between frames `fired - 1` and `fired`; the game fires on the clock of the
      // first, the shot lands on the first frame at least `flight` seconds later, and its bubbles
      // start to pop, on screen and in the sound, on the frame after that.
      const land = (e.fired + Math.ceil(e.flight * this.fps)) / this.fps;
      if ((land + 0.2) * rate > this.pcm.length) continue;
      let best = 0;
      let bestAt = null;
      for (let t = land - 0.1; t < land + 0.1; t += 0.001) {
        const rise = env(t + 0.002) / (env(t - 0.004) + 1e3);
        if (rise > best) [best, bestAt] = [rise, t];
      }
      if (bestAt !== null) offsets.push((bestAt - land) * 1000);
    }
    offsets.sort((a, b) => a - b);
    out.popSoundOffsetMs = offsets.length ? Math.round(offsets[offsets.length >> 1]) : null;
    out.popsChecked = offsets.length;
    return out;
  }

  async close() {
    await this.browser?.close();
    this.server?.close();
  }

  // ---- The hand ----

  async #pointer(type, p) {
    if (this.touch) {
      const points = type === 'up' ? [] : [{ x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1, id: 1 }];
      const name = { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type];
      if (type === 'move' && !this.down) return; // a finger off the glass is not seen
      await this.cdp.send('Input.dispatchTouchEvent', { type: name, touchPoints: points });
    } else {
      const name = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[type];
      const held = type === 'down' || (type === 'move' && this.down);
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: name, x: p.x, y: p.y, button: type === 'move' && !this.down ? 'none' : 'left', buttons: held ? 1 : 0, clickCount: type === 'move' ? 0 : 1,
      });
    }
    if (type === 'down') this.down = true;
    if (type === 'up') this.down = false;
    this.at = { x: p.x, y: p.y };
  }

  // Moves the hand there along a human path. A finger that is up just goes there.
  async moveTo(to, rng, { width = 30 } = {}) {
    if (this.touch && !this.down) {
      this.at = { ...to };
      return;
    }
    const path = human.movement(rng, this.at, to, { width, pace: this.opts.pace });
    const n = Math.round(path.duration * this.fps);
    for (let i = 1; i <= n; i++) {
      await this.#pointer('move', path.at(i / this.fps));
      await this.frame();
    }
    if (this.at.x !== to.x || this.at.y !== to.y) {
      await this.#pointer('move', to);
      await this.frame();
    }
  }

  // Goes to a point and presses it: a click, or a tap.
  async press(p, rng, { width = 40 } = {}) {
    await this.moveTo(p, rng, { width });
    await this.#pointer('down', p);
    await this.wait(this.touch ? human.tapHold(rng) : human.clickHold(rng));
    await this.#pointer('up', p);
    await this.frame();
  }

  async rect(id) {
    return this.page.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, id);
  }

  async pressButton(id, rng) {
    const r = await this.rect(id);
    await this.press(human.pressPoint(rng, r), rng, { width: Math.min(r.width, r.height) });
  }

  // How far from the launcher a person points for this shot: at the wall for a bank shot, at the
  // landing spot otherwise, in world units. Kept on the board, and clear of the HUD's buttons.
  aimDistance(game, angle, buttons) {
    const { x, y } = game.origin;
    const tr = traceShot(game.board, x, y, angle);
    const [px, py] = tr.pts.length > 4 ? [tr.pts[2], tr.pts[3]] : [tr.x, tr.y];
    let d = clamp(Math.hypot(px - x, py - y), 5, 11);
    d = Math.min(d, 4.9 / Math.max(0.05, Math.abs(Math.cos(angle))));
    for (let i = 0; i < 4; i++) {
      const p = human.aimPoint(this.layout, angle, d);
      if (!buttons.some((r) => p.x > r.x - 12 && p.x < r.x + r.width + 12 && p.y > r.y - 12 && p.y < r.y + r.height + 12)) break;
      d += 1;
    }
    return d;
  }

  // ---- Playing ----

  // One decision: read the board, think, then a boost, or a swap and a shot.
  async turn() {
    this.resting = false;
    const state = await this.page.evaluate(() => window.__bubbler.game.serialize());
    const hash = hashState(state);
    const k = this.turnNo++;
    const rng = human.handFor(this.seed, k);
    // Game.load keeps the arrays it is given, so each copy of the game gets its own.
    const game = Game.load(structuredClone(state));
    const choice = expertPolicy(game, { boosts: hash !== this.boostedAt });
    if (this.predicted && this.predicted[k] !== hash && this.diverged === undefined) {
      this.diverged = k;
      console.warn(`\nThe run left the prediction at turn ${k}.`);
    }
    // What the shot will do, worked out ahead from the same rules, for the event log.
    const sim = Game.load(structuredClone(state));
    const res = takeTurn(sim, choice);
    const event = {
      type: 'turn', turn: k, level: game.level, place: this.status.place, score: game.score, boost: choice.boost ?? null,
      swap: !!choice.swap, points: sim.score - game.score, removed: res ? res.popped + res.dropped : 0,
      dropped: res?.dropped ?? 0, blasts: res ? res.blasts.map((b) => b.type) : [], caught: res?.caught.length ?? 0, after: sim.phase,
      flight: res ? res.fly.len / SHOT_SPEED : 0, pierce: res?.shot.k === KIND.COMET,
    };
    if (this.opts.keepStates) event.state = state;

    await this.wait(human.reaction(rng));
    if (choice.boost) {
      this.boostedAt = hash;
      event.frame = this.frameNo;
      await this.pressButton(`boost-${choice.boost}`, rng);
      event.fired = this.frameNo;
      this.events.push(event);
      await this.wait(human.between(rng, 0.25, 0.45));
      return;
    }
    if (choice.swap) {
      const L = this.layout;
      const spot = { x: L.x + (-0.3 + (rng.next() - 0.5) * 0.5) * L.unit, y: L.y + (rng.next() - 0.5) * 0.4 * L.unit };
      await this.press(spot, rng, { width: L.unit * 1.5 });
      await this.wait(human.between(rng, 0.12, 0.25));
      game.swap();
    }
    await this.wait(human.thinkTime(rng, choice, this.opts.pace));
    event.frame = this.frameNo;

    this.buttons ??= await Promise.all(['boost-comet', 'boost-clear', 'btn-pause'].map((id) => this.rect(id)));
    // The hand travels like a hand, but a player lets go only once the aim line shows the shot they
    // chose, so the release is at the chosen angle itself. (A Comet's result can change inside its
    // window, between the angles the bot sampled; the centre is the angle it judged.)
    const angle = choice.angle;
    const dist = this.aimDistance(game, angle, this.buttons);
    const target = human.aimPoint(this.layout, angle, dist);
    const width = Math.max(6, (choice.hi - choice.lo) * dist * this.layout.unit);
    if (this.touch) {
      const start = choice.alt ? { angle: choice.alt.angle, dist } : human.touchStart(rng, angle, dist);
      const p0 = human.aimPoint(this.layout, start.angle, this.aimDistance(game, start.angle, this.buttons));
      await this.moveTo(p0, rng);
      await this.#pointer('down', p0);
      await this.frame();
      if (choice.alt) await this.wait(human.glance(rng));
      await this.moveTo(target, rng, { width });
    } else {
      if (choice.alt) {
        const alt = human.aimPoint(this.layout, choice.alt.angle, this.aimDistance(game, choice.alt.angle, this.buttons));
        await this.moveTo(alt, rng, { width: 40 });
        await this.wait(human.glance(rng));
      }
      await this.moveTo(target, rng, { width });
    }
    await this.wait(human.settle(rng));

    // Look at the aim line before letting go. If it is off, correct by where the page saw the hand
    // against where it was sent, so a slip in how Chrome maps input cannot make a wrong shot.
    const margin = 0.15 * (choice.hi - choice.lo);
    const want = human.aimPoint(this.layout, choice.angle, dist);
    let send = { ...this.at };
    for (let i = 0; i < 6; i++) {
      const aim = this.status.aim;
      if (aim !== null && aim >= choice.lo + margin && aim <= choice.hi - margin) break;
      event.nudges = (event.nudges ?? 0) + 1;
      const [sx, sy] = this.status.pointer;
      (event.missed ??= []).push([aim === null ? null : +(aim - choice.angle).toFixed(4), +send.x.toFixed(1), +send.y.toFixed(1), +sx.toFixed(1), +sy.toFixed(1)]);
      send = { x: sx > 1 ? (send.x * want.x) / sx : want.x, y: sy > 1 ? (send.y * want.y) / sy : want.y };
      await this.#pointer('move', send);
      await this.wait(2 / this.fps); // the page sometimes reads input a frame late
    }
    if (!this.touch) {
      await this.#pointer('down', this.at);
      await this.wait(human.clickHold(rng));
    }
    await this.#pointer('up', this.at);
    event.fired = this.lastFired = this.frameNo;
    this.events.push(event);
    await this.frame();
  }

  // While the camera flies, the hand leaves the mouse be, off to one side of the screen.
  async rest() {
    this.resting = true;
    const rng = human.handFor(this.seed, 2_000_000 + this.turnNo);
    const L = this.layout;
    const to = { x: L.x + L.unit * human.between(rng, 6.5, 8), y: L.y - L.unit * human.between(rng, 0.5, 1.5) };
    await this.wait(human.between(rng, 0.3, 0.6));
    await this.moveTo({ x: Math.min(to.x, L.w - 30), y: to.y }, rng, { width: 80 });
  }

  async reviveCard() {
    const rng = human.handFor(this.seed, 1_000_000 + this.turnNo);
    await this.wait(human.between(rng, 0.9, 1.4));
    const can = await this.page.evaluate(() => !document.getElementById('btn-revive').disabled);
    this.events.push({ type: can ? 'revive' : 'end', frame: this.frameNo, level: this.status.level });
    const id = can ? 'btn-revive' : 'btn-end';
    await this.pressButton(id, rng);
    for (let i = 0; i < this.fps && this.status.revive; i++) await this.frame();
    if (this.status.revive) await this.page.evaluate((id) => document.getElementById(id).click(), id); // the press missed
  }

  // Plays until `until()` says stop, or the game-over card has been up for `hold` seconds.
  // Plays until `until` holds or the run is over. Turns from `upTo` on are not taken: the board is
  // left to settle, as the last shot of a piece plays out.
  async play({ until = () => false, hold = 5, upTo = Infinity } = {}) {
    let lastLog = 0;
    for (;;) {
      const s = this.status;
      if (until(this)) return;
      if (s.over) {
        await this.wait(hold);
        return;
      }
      if (s.revive) await this.reviveCard();
      else if (s.ready && s.phase === 'aim' && this.turnNo < upTo) await this.turn();
      else if (s.flight && !this.touch && !this.resting) await this.rest();
      else await this.frame();
      if (this.capturing && this.frameNo - lastLog >= this.fps * 30) {
        lastLog = this.frameNo;
        this.progress();
      }
    }
  }

  progress() {
    const f = Math.max(1, this.frameNo);
    const ms = (this.timing.step + this.timing.shot + this.timing.write) / f;
    process.stdout.write(`\r${clock(this.time)} recorded, level ${this.status.level}, score ${this.status.score.toLocaleString('en-US')}, ${ms.toFixed(0)} ms a frame (step ${(this.timing.step / f).toFixed(0)}, screenshot ${(this.timing.shot / f).toFixed(0)}, encode ${(this.timing.write / f).toFixed(0)})   `);
  }

  // The event log, for tools/cut.js.
  save(extra = {}) {
    const info = {
      seed: this.seed, fps: this.fps, profile: this.opts.profile, frames: this.frameNo, seconds: this.time,
      level: this.status.level, score: this.status.score, diverged: this.diverged ?? null, layout: this.layout, ...extra, events: this.events,
    };
    writeFileSync(join(this.dir, 'run.json'), JSON.stringify(info));
    return info;
  }
}

export const clock = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

// ---- The whole run: title screen to game-over card, one take ----

export async function recordRun({ name = 'youtube', seed, res = 1440, fps = 60, pace = 1, seconds = Infinity, watch = false, phone = false }) {
  console.log(`Predicting the run for seed ${seed}...`);
  const predicted = [];
  const plan = playRun(seed, { onTurn: (game) => predicted.push(hashState(game.serialize())) });
  console.log(`It should reach level ${plan.level} with ${plan.score.toLocaleString('en-US')} points in ${plan.shots} shots, about ${clock(plan.seconds)} on screen.`);
  const rec = new Recorder({
    name, seed, fps, pace, watch, profile: phone ? 'phone' : 'desktop', scale: phone ? undefined : res / 720,
    audioSeconds: Math.min(seconds + 30, plan.seconds * 1.6 + 120), keepStates: true,
  });
  rec.predicted = predicted;
  try {
    await rec.open();
    // The cursor starts at rest, low and to the right, as if the hand had just reached the mouse.
    const rng = human.handFor(seed, -1);
    if (!rec.touch) await rec.moveTo({ x: rec.layout.w * 0.72, y: rec.layout.h * 0.78 }, rng);
    rec.fade = 1;
    rec.startCapture();
    await rec.fadeTo(0, 0.6);
    await rec.wait(0.9);
    await rec.pressButton('btn-play', rng);
    const end = (r) => r.time >= seconds;
    await rec.play({ until: end, hold: 5 });
    if (!end(rec)) await rec.fadeTo(1, 1);
    process.stdout.write('\n');
    await rec.stopCapture();
    const checks = watch ? undefined : await rec.checks();
    const info = rec.save({ predicted: { level: plan.level, score: plan.score }, site: SITE_URL, checks });
    if (checks) console.log('Checks:', JSON.stringify(checks, null, 2));
    if (checks?.turnsInWrongPlace) console.warn(`${checks.turnsInWrongPlace} shots were taken in the wrong place.`);
    if (!watch) {
      const out = join(rec.dir, `bubbler-${name}.mp4`);
      await mux(rec.videoPath, rec.audioPath, out);
      console.log(`Level ${info.level}, ${info.score.toLocaleString('en-US')} points, ${clock(info.seconds)}. Predicted: level ${plan.level}, ${plan.score.toLocaleString('en-US')}.`);
      console.log(rec.diverged == null ? 'The run matched the prediction shot for shot.' : `The run left the prediction at turn ${rec.diverged}.`);
      console.log(`Wrote ${out}`);
    }
    return info;
  } finally {
    await rec.close();
  }
}

// ---- A piece of a run, re-rendered: for the Short ----

// From the state saved before turn `turn` of a recorded run, plays `turns` decisions and keeps
// recording `tail` seconds after the last one. Or, with `level`, records that level's opening
// fly-over in `place`. The profile is filled in so that no tutorial lines appear.
export async function recordPiece({ name, file, seed, profile = 'short', fps = 60, state, turn = 0, turns = 1, tail = 2.5, level, place, toEnd = false }) {
  const storage = { taught: TAUGHT, shots: 99 };
  if (state) storage.run = state;
  const query = level ? `&level=${level}&place=${place}` : '';
  const rec = new Recorder({ name, seed, fps, profile, turn, audioSeconds: toEnd ? 400 : 120 });
  try {
    await rec.open({ query, storage });
    const rng = human.handFor(seed, -2 - turn);
    if (level) {
      // Wait for the place to be built and swapped in on the title screen, then press Play.
      for (let i = 0; rec.status.place !== place; i++) {
        if (i > 1800) throw new Error(`${place} did not load`);
        await rec.frame();
      }
      await rec.pressButton('btn-play', rng);
      await rec.wait(0.3);
      rec.startCapture(join(rec.dir, file));
      while (!rec.status.flight) await rec.frame();
      while (rec.status.flight) await rec.frame();
      await rec.wait(0.4);
    } else {
      await rec.pressButton('btn-play', rng); // "Continue · level n"
      const want = placeOf(Game.load(state).level);
      for (let i = 0; !(rec.status.ready && rec.status.place === want); i++) {
        if (i > 1800) throw new Error(`${want} did not load`);
        await rec.frame();
      }
      await rec.wait(1.2); // the music settles in
      rec.startCapture(join(rec.dir, file));
      const last = turn + turns;
      await rec.play({
        hold: 3,
        upTo: toEnd ? Infinity : last,
        until: (r) => !toEnd && r.turnNo >= last && r.lastFired != null && r.frameNo - r.lastFired >= tail * fps,
      });
    }
    await rec.stopCapture();
    return { video: rec.videoPath, audio: rec.audioPath, frames: rec.frameNo, events: rec.events };
  } finally {
    await rec.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i < 0 ? fallback : Number(args[i + 1]);
  };
  const mode = args[0];
  const seed = arg('seed', null);
  if (!['youtube', 'pilot', 'watch'].includes(mode) || seed === null) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('// Usage') || l.startsWith('//        ')).join('\n'));
    process.exit(1);
  }
  const common = { seed, fps: arg('fps', 60), pace: arg('pace', 1), res: arg('res', 1440), phone: args.includes('--phone') };
  if (mode === 'youtube') await recordRun({ ...common, name: 'youtube' });
  else if (mode === 'pilot') await recordRun({ ...common, name: 'pilot', seconds: arg('seconds', 90) });
  else await recordRun({ ...common, name: 'watch', watch: true });
}
