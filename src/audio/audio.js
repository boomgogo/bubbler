// All sound is synthesised here with WebAudio: there are no audio files to download.
// Pops are notes on a pentatonic scale that climb through a chain, so a big clear plays a run.
// The music is a score per place (see Band below), written in D-major-friendly keys so the
// pops always sit in tune with it.

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic, in semitones
const noteHz = (step, base = 293.66) => base * 2 ** ((SCALE[step % 5] + 12 * Math.floor(step / 5)) / 12);

export class Audio {
  constructor({ sound = true, music = true } = {}) {
    this.sound = sound;
    this.music = music;
    this.ctx = null;
    this.step = 0; // position in the scale within the current chain
    this.lastPop = 0;
    this.score = null; // what the music should be playing
    this.band = null; // what it is playing
  }

  // Browsers only let audio start from a tap or key press; call this from one.
  unlock() {
    if (this.ctx) return this.ctx.resume();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    // A gentle limiter keeps a 60-bubble avalanche from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);
    this.fx = ctx.createGain();
    this.fx.gain.value = this.sound ? 1 : 0;
    this.fx.connect(this.master);
    this.bed = ctx.createGain();
    this.bed.gain.value = 0;
    this.bed.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuffer = ctx.createBuffer(1, len, len);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (this.score) this.#play(this.score);
    this.setMusic(this.music);
    // Notes are booked a second ahead, so a late timer never leaves a gap.
    this.ticker = setInterval(() => {
      if (this.band && this.ctx.state === 'running') this.band.schedule(this.ctx.currentTime + 1.2, this.music);
    }, 250);
  }

  // Changes the music, crossfading from whatever is playing. Before the first tap it only
  // remembers the score.
  setScore(score) {
    if (score === this.score) return;
    this.score = score;
    if (this.ctx) this.#play(score);
  }

  #play(score) {
    const old = this.band;
    this.band = new Band(this.ctx, this.bed, this.noiseBuffer, score, old ? 2.5 : 0.4);
    old?.stop(2);
  }

  suspend() {
    this.ctx?.suspend();
  }

  resume() {
    this.ctx?.resume();
  }

  setSound(on) {
    this.sound = on;
    if (this.fx) this.fx.gain.value = on ? 1 : 0;
  }

  setMusic(on) {
    this.music = on;
    if (this.bed) this.bed.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.4);
  }

  // One enveloped oscillator. `at` is seconds from now.
  #tone(type, hz, at, dur, gain, { to = hz } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, t);
    if (to !== hz) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.fx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A burst of filtered noise.
  #noise(at, dur, gain, { type = 'bandpass', hz = 1200, to = hz, q = 1 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(hz, t);
    if (to !== hz) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(this.fx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  get ok() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // Call when a new shot is fired: the next chain starts from the bottom of the scale.
  newChain() {
    this.step = 0;
  }

  pop() {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPop < 0.03) return; // a dense ripple would smear into noise
    this.lastPop = now;
    const hz = noteHz(Math.min(this.step++, 17));
    this.#tone('sine', hz, 0, 0.22, 0.22);
    this.#tone('triangle', hz * 2, 0, 0.09, 0.07);
    this.#noise(0, 0.04, 0.1, { type: 'highpass', hz: 3000 });
  }

  shoot() {
    if (!this.ok) return;
    this.#noise(0, 0.16, 0.16, { hz: 500, to: 2400, q: 0.8 });
    this.#tone('sine', 220, 0, 0.12, 0.1, { to: 440 });
  }

  bounce() {
    if (this.ok) this.#tone('triangle', 520, 0, 0.07, 0.1, { to: 380 });
  }

  land() {
    if (!this.ok) return;
    this.#tone('sine', 190, 0, 0.1, 0.22, { to: 110 });
    this.#noise(0, 0.03, 0.06, { type: 'highpass', hz: 2000 });
  }

  splash() {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPop < 0.045) return;
    this.lastPop = now;
    this.#noise(0, 0.28, 0.16, { hz: 2200, to: 500, q: 0.7 });
    this.#tone('sine', noteHz(Math.min(this.step++, 17), 146.83), 0, 0.3, 0.16);
  }

  comet() {
    if (!this.ok) return;
    this.#tone('sawtooth', 180, 0, 0.5, 0.1, { to: 1400 });
    this.#noise(0, 0.5, 0.2, { hz: 600, to: 5000, q: 0.6 });
  }

  nova() {
    if (!this.ok) return;
    this.#tone('sine', 150, 0, 0.6, 0.5, { to: 38 });
    this.#noise(0, 0.5, 0.3, { type: 'lowpass', hz: 3000, to: 200 });
  }

  reveal() {
    if (this.ok) this.#noise(0, 0.35, 0.07, { hz: 3500, to: 7000, q: 2 });
  }

  crack() {
    if (!this.ok) return;
    this.#noise(0, 0.12, 0.25, { type: 'highpass', hz: 1500 });
    this.#tone('square', 90, 0, 0.1, 0.12, { to: 50 });
  }

  swap() {
    if (!this.ok) return;
    this.#tone('sine', 520, 0, 0.07, 0.1);
    this.#tone('sine', 700, 0.06, 0.08, 0.1);
  }

  click() {
    if (this.ok) this.#tone('sine', 660, 0, 0.05, 0.08);
  }

  gem() {
    if (!this.ok) return;
    [0, 2, 4].forEach((s, i) => this.#tone('sine', noteHz(s + 10), i * 0.08, 0.5, 0.12));
    this.#tone('triangle', noteHz(14) * 2, 0.16, 0.6, 0.04);
  }

  scroll() {
    if (this.ok) this.#tone('sine', 70, 0, 0.25, 0.4, { to: 45 });
  }

  levelUp() {
    if (!this.ok) return;
    [0, 2, 4, 5, 7, 9].forEach((s, i) => this.#tone('triangle', noteHz(s + 5), i * 0.09, 0.5, 0.13));
    this.#tone('sine', noteHz(10), 0.54, 1.2, 0.14);
  }

  outOfMoves() {
    if (this.ok) [9, 7, 5].forEach((s, i) => this.#tone('sine', noteHz(s), i * 0.16, 0.5, 0.14));
  }

  gameOver() {
    if (this.ok) [7, 5, 4, 2, 0].forEach((s, i) => this.#tone('triangle', noteHz(s, 146.83), i * 0.2, 0.7, 0.14));
  }
}

const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);

// One score playing: its own bus into the music bed, an echo, an optional bed of noise (wind,
// surf), and the instruments the score plays its bars on. Works on any audio context, so a
// score can also be rendered offline.
//
// A score is { bpm, beats, level, echo, air, voices, bar(play, index, time) }. bar() books one
// bar of notes starting at audio time `time`, through `play`: midi numbers in, instruments out.
// voices(tools), if given, returns instruments of the score's own, which join `play`; tools has
// the building blocks below, so a place's chunk can carry a sound the game itself never needs.
export class Band {
  constructor(ctx, dest, noise, score, fadeIn = 0.4) {
    this.ctx = ctx;
    this.score = score;
    this.noise = noise;
    this.beat = 60 / score.bpm;
    this.barLength = this.beat * (score.beats ?? 4);
    this.index = 0;
    this.next = ctx.currentTime + 0.1;
    this.sources = []; // long-running sources to stop with the band

    const bus = (this.bus = ctx.createGain());
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.setTargetAtTime(score.level ?? 1, ctx.currentTime, fadeIn / 3);
    bus.connect(dest);

    // A tape-style echo: a delay that feeds back through a lowpass, so repeats grow darker.
    const e = { beats: 0.75, feedback: 0.3, mix: 0.3, tone: 2400, ...score.echo };
    this.send = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = Math.min(1.9, e.beats * this.beat);
    const loop = ctx.createGain();
    loop.gain.value = e.feedback;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = e.tone;
    const wet = ctx.createGain();
    wet.gain.value = e.mix;
    this.send.connect(delay).connect(tone).connect(loop).connect(delay);
    tone.connect(wet).connect(bus);
    this.nodes = [bus, this.send, delay, tone, loop, wet];

    if (score.air) this.#air(score.air);
    this.play = this.#instruments();
    if (score.voices) Object.assign(this.play, score.voices(this.tools));
  }

  // Books every bar that starts before `until`. With the music off it only keeps count.
  schedule(until, audible = true) {
    const now = this.ctx.currentTime;
    if (this.next < now - 0.05) this.next = now + 0.05; // the timer was held up: skip ahead
    while (this.next < until) {
      if (audible) this.score.bar(this.play, this.index, this.next);
      this.index++;
      this.next += this.barLength;
    }
  }

  stop(fade = 2) {
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(0, t, fade / 4);
    this.next = Infinity;
    for (const s of this.sources) s.stop(t + fade + 0.5);
    setTimeout(() => this.nodes.forEach((n) => n.disconnect()), (fade + 1) * 1000);
  }

  // A soft, slowly swelling bed of filtered noise.
  #air({ type = 'lowpass', hz = 500, q = 0.7, gain = 0.02, swell = 0.1, sweep = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    filter.Q.value = q;
    const level = ctx.createGain();
    level.gain.value = gain;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = swell;
    const depth = ctx.createGain();
    depth.gain.value = gain * 0.8;
    lfo.connect(depth).connect(level.gain);
    if (sweep) {
      const sweepDepth = ctx.createGain();
      sweepDepth.gain.value = sweep;
      lfo.connect(sweepDepth).connect(filter.frequency);
    }
    src.connect(filter).connect(level).connect(this.bus);
    src.start();
    lfo.start();
    this.sources.push(src, lfo);
  }

  #instruments() {
    const ctx = this.ctx;
    const band = this;
    // One oscillator with a percussive envelope: a sharp start, then an exponential fade.
    const strike = (type, hz, at, peak, decay, dest) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(g).connect(dest);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    };
    // Where a note goes: straight to the bus, and some of it into the echo.
    const out = (send) => {
      const g = ctx.createGain();
      g.connect(band.bus);
      if (send > 0) {
        const s = ctx.createGain();
        s.gain.value = send;
        g.connect(s).connect(band.send);
      }
      return g;
    };
    // A held envelope: linear attack, then a gentle release after `dur`.
    const hold = (g, at, dur, peak, attack, release) => {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + attack);
      g.gain.setValueAtTime(peak, at + Math.max(attack, dur));
      g.gain.setTargetAtTime(0, at + Math.max(attack, dur), release / 3);
      return at + Math.max(attack, dur) + release;
    };
    this.tools = { ctx, out, strike, hold, noise: band.noise, hz: midiHz };

    return {
      hz: midiHz,
      beat: band.beat,
      bar: band.barLength,
      // Soft chord: a sawtooth and a triangle per note, slightly apart, through one lowpass.
      pad(notes, at, dur, gain = 0.03, { attack = 1.2, release = 1.8, cutoff = 900, send = 0.15 } = {}) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        filter.Q.value = 0.3;
        const env = out(send);
        filter.connect(env);
        const end = hold(env, at, dur, 1, attack, release);
        for (const n of notes) {
          for (const [type, cents, level] of [['sawtooth', -7, 0.6], ['triangle', 7, 1]]) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = type;
            osc.frequency.value = midiHz(n);
            osc.detune.value = cents;
            g.gain.value = gain * level;
            osc.connect(g).connect(filter);
            osc.start(at);
            osc.stop(end);
          }
        }
      },
      // Round low notes with a touch of the octave above, so small speakers still carry them.
      bass(n, at, dur, gain = 0.08) {
        const env = out(0);
        const end = hold(env, at, dur, gain, 0.03, 0.35);
        for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.3]]) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = type;
          osc.frequency.value = midiHz(n) * mult;
          g.gain.value = level;
          osc.connect(g).connect(env);
          osc.start(at);
          osc.stop(end);
        }
      },
      // A plucked string, somewhere between a koto and a kalimba.
      pluck(n, at, gain = 0.05, { decay = 1.2, send = 0.25 } = {}) {
        const dest = out(send);
        const hz = midiHz(n);
        strike('sine', hz, at, gain, decay, dest);
        strike('triangle', hz * 2, at, gain * 0.22, decay * 0.35, dest);
        strike('sine', hz * 3, at, gain * 0.2, 0.16, dest);
      },
      // A glass bell: inharmonic partials that die away faster the higher they are.
      bell(n, at, gain = 0.04, { decay = 2.8, send = 0.5 } = {}) {
        const dest = out(send);
        const hz = midiHz(n);
        strike('sine', hz, at, gain, decay, dest);
        strike('sine', hz * 2.76, at, gain * 0.35, decay * 0.4, dest);
        strike('sine', hz * 5.4, at, gain * 0.12, decay * 0.18, dest);
      },
      // A breathy flute-like line that eases into a vibrato as the note is held.
      lead(n, at, dur, gain = 0.05, { send = 0.35, vibrato = 7 } = {}) {
        const env = out(send);
        const end = hold(env, at, dur, gain, 0.06, 0.3);
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.2;
        depth.gain.setValueAtTime(0, at);
        depth.gain.linearRampToValueAtTime(vibrato, at + Math.min(0.5, dur));
        lfo.connect(depth);
        for (const [type, mult, level] of [['sine', 1, 1], ['triangle', 2, 0.1]]) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = type;
          osc.frequency.value = midiHz(n) * mult;
          depth.connect(osc.detune);
          g.gain.value = level;
          osc.connect(g).connect(env);
          osc.start(at);
          osc.stop(end);
        }
        lfo.start(at);
        lfo.stop(end);
      },
      // A brush of high noise, for a light pulse.
      shaker(at, gain = 0.012, decay = 0.06) {
        const src = ctx.createBufferSource();
        src.buffer = band.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 6500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
        src.connect(filter).connect(g).connect(band.bus);
        src.start(at, Math.random() * 0.5);
        src.stop(at + decay + 0.05);
      },
    };
  }
}
