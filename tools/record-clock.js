// Injected by tools/record.js into the page before any of the game's code runs. Playwright sends this
// function's source, so it must not use anything from outside its own body.
//
// With `virtual`, the page's clock belongs to the recorder: time moves only when __rec.step(ms) is
// called, so every frame of the video is drawn as if the machine were fast enough, however long it
// really takes. That covers performance.now, Date.now, requestAnimationFrame, the timers, CSS
// animations and transitions, and the sound: the AudioContext becomes an OfflineAudioContext that
// renders in step with the frames, so a pop is heard on the frame it is seen.
//
// In both modes it seeds Math.random, draws a cursor (or a fingertip) where the pointer is, adds a
// black layer for fades, and reports what the autoplayer needs through __rec.status().
export function recClock({ virtual, seed, audioSeconds, touch, font }) {
  const rec = (window.__rec = { now: 0, frames: 0, fade: 0, audio: null, audioStart: 0 });
  const pointer = { x: -100, y: -100, down: false, seen: false, ripple: -1, lift: 1 }; // as the page last saw it

  // ---- Seeded randomness: sparks, drop jitter and the fly-over's side come out the same every time.
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  if (virtual) {
    // ---- Time.
    const epoch = Date.now();
    performance.now = () => rec.now;
    Date.now = () => epoch + rec.now;
    let nextId = 1;
    const timers = new Map(); // id -> { at, every, fn, args, seq }
    const add = (fn, ms, args, every) => {
      const id = nextId++;
      const wait = Math.max(0, Number(ms) || 0);
      timers.set(id, { at: rec.now + wait, every: every ? Math.max(1, wait) : 0, fn, args, seq: id });
      return id;
    };
    window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
    window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
    window.clearTimeout = window.clearInterval = (id) => void timers.delete(id);
    window.requestIdleCallback = (fn) => add(() => fn({ didTimeout: false, timeRemaining: () => 8 }), 1, [], false);
    window.cancelIdleCallback = window.clearTimeout;
    let frameCallbacks = new Map();
    window.requestAnimationFrame = (fn) => {
      const id = nextId++;
      frameCallbacks.set(id, fn);
      return id;
    };
    window.cancelAnimationFrame = (id) => void frameCallbacks.delete(id);

    // ---- Sound, rendered offline in step with the frames.
    const RATE = 48000;
    const QUANTUM = 128;
    const Offline = window.OfflineAudioContext;
    const proto = Offline.prototype;
    let rendered = 0;
    let started = false;
    class RecordedAudioContext extends Offline {
      constructor() {
        super({ numberOfChannels: 1, length: Math.ceil((audioSeconds * RATE) / QUANTUM) * QUANTUM, sampleRate: RATE });
        rec.audio = this;
        rec.audioStart = rec.now;
      }
      get state() {
        return 'running';
      }
      resume() {
        return Promise.resolve();
      }
      suspend() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    }
    window.AudioContext = window.webkitAudioContext = RecordedAudioContext;

    // Renders the sound up to `ms` on the page's clock, to the nearest render quantum.
    const advanceAudio = async (ms) => {
      const ctx = rec.audio;
      const frame = Math.round((((ms - rec.audioStart) / 1000) * RATE) / QUANTUM) * QUANTUM;
      if (frame <= rendered || frame >= ctx.length) return;
      const reached = proto.suspend.call(ctx, frame / RATE);
      if (!started) {
        started = true;
        rec.audioDone = proto.startRendering.call(ctx);
      } else proto.resume.call(ctx);
      await reached;
      rendered = frame;
      // How far the sound's clock is from the page's: under one render quantum (2.7 ms) when in step.
      rec.drift = Math.max(rec.drift ?? 0, Math.abs(ctx.currentTime * 1000 - (ms - rec.audioStart)));
    };

    // Renders out the rest and keeps the samples for __rec.audioSlice.
    rec.finishAudio = async () => {
      if (!rec.audio || !started) return null;
      proto.resume.call(rec.audio);
      rec.samples = (await rec.audioDone).getChannelData(0);
      return { startMs: rec.audioStart, rate: RATE, rendered };
    };
    // Samples [from, from + n) as 16-bit PCM in base64.
    rec.audioSlice = (from, n) => {
      const src = rec.samples.subarray(from, from + n);
      const ints = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++) ints[i] = Math.max(-1, Math.min(1, src[i])) * 32767;
      const bytes = new Uint8Array(ints.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };

    // ---- CSS animations and transitions follow the same clock: each is paused and set by hand.
    const begun = new WeakMap(); // animation -> start on the page's clock, or null once finished
    const driveAnimations = () => {
      for (const anim of document.getAnimations()) {
        let start = begun.get(anim);
        if (start === undefined) {
          if (anim.playState === 'finished') continue;
          start = rec.now;
          begun.set(anim, start);
          anim.pause();
        }
        if (start === null) continue;
        const end = anim.effect?.getComputedTiming().endTime ?? Infinity;
        const t = rec.now - start;
        if (t >= end) {
          begun.set(anim, null);
          anim.finish(); // fires animationend, which removes the score tallies
        } else anim.currentTime = t;
      }
    };

    // One frame: sound first, so a note booked in this frame starts on it; then every timer that
    // falls due, in order, each at its own time; then the frame callbacks and the CSS.
    rec.step = async (ms, fade) => {
      if (fade != null) rec.fade = fade;
      const target = rec.now + ms;
      if (rec.audio) await advanceAudio(target);
      for (let guard = 0; guard < 2000; guard++) {
        let due = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!due || t.at < due.t.at || (t.at === due.t.at && t.seq < due.t.seq))) due = { id, t };
        }
        if (!due) break;
        rec.now = Math.max(rec.now, due.t.at);
        if (due.t.every) {
          due.t.at += due.t.every;
          due.t.seq = nextId++;
        } else timers.delete(due.id);
        try {
          if (typeof due.t.fn === 'function') due.t.fn(...due.t.args);
        } catch (error) {
          console.error(error);
        }
      }
      rec.now = target;
      const callbacks = frameCallbacks;
      frameCallbacks = new Map();
      for (const fn of callbacks.values()) {
        try {
          fn(target);
        } catch (error) {
          console.error(error);
        }
      }
      driveAnimations();
      rec.frames++;
      overlays(ms);
      return rec.status();
    };
  } else {
    rec.step = async (ms, fade) => {
      if (fade != null) rec.fade = fade;
      rec.now = performance.now();
      overlays(ms);
      return rec.status();
    };
  }

  // ---- How long each score tally stays up, on the page's clock: a check that CSS keeps time.
  rec.tallies = [];
  const born = new WeakMap();
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) if (n.classList?.contains('tally')) born.set(n, rec.now);
      for (const n of m.removedNodes) if (born.has(n)) rec.tallies.push(rec.now - born.get(n));
    }
  }).observe(document, { childList: true, subtree: true });

  // ---- What the autoplayer reads each frame.
  const shown = (id) => {
    const el = document.getElementById(id);
    return !!el && !el.hidden && !el.classList.contains('out');
  };
  rec.status = () => {
    const b = window.__bubbler;
    return {
      t: rec.now,
      booted: performance.getEntriesByName('bubbler-ready').length > 0,
      ready: b ? b.ready : false,
      aim: b ? b.aim : null,
      flight: !!b?.view.flight,
      phase: b?.game.phase ?? null,
      level: b?.game.level ?? 0,
      score: b?.game.score ?? 0,
      shots: b?.game.stats.shots ?? 0,
      place: b?.place ?? null,
      title: shown('title'),
      revive: shown('revive'),
      over: shown('over'),
      cleared: shown('cleared'),
      pointer: [pointer.x, pointer.y, pointer.down],
    };
  };

  // ---- The hand on screen, and the fade layer.
  const track = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.seen = true;
    if (e.type === 'pointerdown') {
      pointer.down = true;
      pointer.ripple = 0;
      pointer.lift = 0;
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') pointer.down = false;
  };
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) addEventListener(type, track, true);

  let els = null;
  const build = () => {
    const style = document.createElement('style');
    style.textContent = `
      #debug { display: none !important; }
      ${font ? `html body { font-family: ${font}; }` : ''}
      #rec-layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
      #rec-layer > * { position: absolute; left: 0; top: 0; will-change: transform, opacity; }
      #rec-fade { inset: 0; width: 100%; height: 100%; background: #000; }
      #rec-cursor { width: 21px; height: 30px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
      #rec-ripple { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(255,255,255,.85); }
      #rec-touch { width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.7); box-shadow: 0 0 12px rgba(0,0,0,.35); }
    `;
    document.head.append(style);
    const layer = document.createElement('div');
    layer.id = 'rec-layer';
    layer.innerHTML = touch
      ? '<div id="rec-touch"></div><div id="rec-fade"></div>'
      : '<div id="rec-ripple"></div><svg id="rec-cursor" viewBox="0 0 14 20"><path d="M1 1v15.5l3.9-3.7 2.6 6 2.6-1.1-2.6-5.9h5.4z" fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/></svg><div id="rec-fade"></div>';
    document.body.append(layer);
    els = Object.fromEntries([...layer.children].map((el) => [el.id.slice(4), el]));
  };

  function overlays(ms) {
    if (!els) {
      if (!document.body) return;
      build();
    }
    els.fade.style.opacity = rec.fade;
    const at = `translate(${pointer.x}px, ${pointer.y}px)`;
    if (touch) {
      pointer.lift = pointer.down ? 0 : Math.min(1, pointer.lift + ms / 140);
      els.touch.style.transform = `${at} scale(${1 - 0.15 * pointer.lift})`;
      els.touch.style.opacity = pointer.seen ? 1 - pointer.lift : 0;
    } else {
      els.cursor.style.transform = at;
      els.cursor.style.opacity = pointer.seen ? 1 : 0;
      if (pointer.ripple >= 0) pointer.ripple += ms / 320;
      const r = pointer.ripple;
      els.ripple.style.opacity = r >= 0 && r < 1 ? 0.8 * (1 - r) : 0;
      els.ripple.style.transform = `${at} scale(${0.4 + 0.9 * Math.max(0, r)})`;
    }
  }
}
