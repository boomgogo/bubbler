// All sound is synthesised here with WebAudio: there are no audio files to download.
// Pops are notes on a pentatonic scale that climb through a chain, so a big clear plays a run.

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic, in semitones
const noteHz = (step, base = 293.66) => base * 2 ** ((SCALE[step % 5] + 12 * Math.floor(step / 5)) / 12);

export class Audio {
  constructor({ sound = true, music = true } = {}) {
    this.sound = sound;
    this.music = music;
    this.ctx = null;
    this.step = 0; // position in the scale within the current chain
    this.lastPop = 0;
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
    this.#startMusic();
    this.setMusic(this.music);
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
  #tone(type, hz, at, dur, gain, { to = hz, dest = this.fx, attack = 0.004 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, t);
    if (to !== hz) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(dest);
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

  // The music is a slow drone: two detuned voices per chord tone through a breathing filter,
  // stepping through four chords, with a soft bell now and then.
  #startMusic() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(this.bed);
    this.voices = [0, 1, 2].flatMap((i) =>
      [-4, 4].map((cents) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sawtooth';
        osc.detune.value = cents;
        gain.gain.value = i === 0 ? 0.11 : 0.035;
        osc.connect(gain).connect(filter);
        osc.start();
        return { osc, i };
      }),
    );
    // D, B minor, G, A: each as root, fifth and third in a low register.
    const CHORDS = [[73.42, 110, 185], [61.74, 92.5, 146.83], [49, 73.42, 123.47], [55, 82.41, 138.59]];
    let chord = 0;
    const change = () => {
      if (ctx.state !== 'running') return;
      const t = ctx.currentTime;
      for (const v of this.voices) v.osc.frequency.setTargetAtTime(CHORDS[chord][v.i], t, 1.2);
      if (this.music && Math.random() < 0.8) {
        this.#tone('sine', noteHz(5 + Math.floor(Math.random() * 8)), 1 + Math.random() * 4, 3, 0.05, { dest: this.bed, attack: 0.05 });
      }
      chord = (chord + 1) % CHORDS.length;
    };
    change();
    this.musicTimer = setInterval(change, 9000);
  }
}
