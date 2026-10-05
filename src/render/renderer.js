// WebGL setup and the quality tiers that keep the frame rate up on weak hardware.
import { WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from 'three';

export const TIERS = {
  low: { name: 'low', dpr: 1.25, cube: 128, cubeEvery: 0, neighbors: false, hdr: false, segs: [18, 12], shards: 3, sparks: 4, bloom: false },
  mid: { name: 'mid', dpr: 1.5, cube: 256, cubeEvery: 1, neighbors: true, hdr: true, segs: [28, 18], shards: 6, sparks: 8, bloom: false },
  high: { name: 'high', dpr: 2, cube: 256, cubeEvery: 1, neighbors: true, hdr: true, segs: [36, 24], shards: 8, sparks: 12, bloom: true },
};
const ORDER = ['low', 'mid', 'high'];

// A first guess from what the browser tells us; the frame timer corrects it within seconds.
export function guessTier() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (coarse && small) return cores >= 8 && memory >= 6 ? 'mid' : 'low';
  return cores <= 2 ? 'low' : 'mid';
}

export function createRenderer(canvas, tierName) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: tierName !== 'low' && devicePixelRatio < 2,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false; // a frame is several render calls; the view resets the counters
  return renderer;
}

// Watches frame times. First it trims render resolution; if that does not help, or is not
// enough, it steps down a tier. It steps up only cautiously, and never back to a tier that
// proved too heavy.
export class Quality {
  constructor(tierName, { locked = false, onTier, onScale }) {
    this.tier = TIERS[tierName];
    this.locked = locked; // the player picked a tier by hand
    this.scale = 1; // fraction of the tier's resolution
    this.onTier = onTier;
    this.onScale = onScale;
    this.ema = 16.7; // smoothed frame time, ms
    this.fps = 60;
    this.clock = 0;
    this.good = 0;
    this.slideFrom = null; // frame time when the current run of slow frames began
    this.scalable = true; // false once shrinking has been shown not to help on this tier
    this.ceiling = locked ? tierName : 'high';
    this.held = null; // what was learned before the fly-over began, while it runs
  }

  get pixelRatio() {
    return Math.min(devicePixelRatio, this.tier.dpr) * this.scale;
  }

  // During the fly-over the frame cost is the camera's, not the game's: close-ups fill the
  // screen with glass. Resolution may be trimmed to keep the flight smooth, but the tier stays
  // put, and on landing everything goes back to how it was.
  hold() {
    this.held ??= { scale: this.scale, scalable: this.scalable, slideFrom: this.slideFrom, ema: this.ema };
  }

  release() {
    const held = this.held;
    if (!held) return;
    this.held = null;
    const rescale = held.scale !== this.scale;
    Object.assign(this, held, { good: 0, clock: 0 });
    if (rescale) this.onScale();
  }

  setTier(name, locked = this.locked) {
    this.locked = locked;
    if (locked) this.ceiling = name;
    if (this.tier.name === name) return;
    this.tier = TIERS[name];
    this.scale = 1;
    this.good = 0;
    this.slideFrom = null;
    this.scalable = true;
    this.onTier(this.tier);
  }

  frame(dtMs) {
    if (dtMs > 250) return; // a stall or a tab switch, not a slow frame
    this.ema += (dtMs - this.ema) * (1 - Math.exp(-dtMs / 350));
    this.fps = 1000 / this.ema;
    this.clock += dtMs;
    if (this.clock < 700) return;
    this.clock = 0;

    // 60 fps is the goal. The low tier at its smallest size settles for 30 rather than
    // shrinking further, and only real 60 fps headroom is allowed to grow things again.
    const slowAt = (this.tier.name === 'low' && this.scale <= 0.7 ? 34 : 17.2) * 1.18;
    const fastAt = 17.2 * 1.04;
    if (this.ema > slowAt) {
      this.good = 0;
      this.slideFrom ??= this.ema;
      if (this.scalable && this.scale > 0.61) {
        this.scale = Math.max(0.6, this.scale - 0.1);
        // Half the pixels and no faster: fill rate is not the problem (a slow CPU, or a
        // browser capping the frame rate). Give the resolution back.
        if (this.scale <= 0.71 && this.ema > this.slideFrom * 0.9) {
          this.scalable = false;
          this.scale = 1;
        }
        this.onScale();
      } else if (!this.locked && !this.held && this.tier.name !== 'low') {
        const lower = ORDER[ORDER.indexOf(this.tier.name) - 1];
        this.ceiling = lower;
        this.setTier(lower);
      }
    } else if (this.ema < fastAt) {
      this.slideFrom = null;
      this.good++;
      if (this.scale < 1 && this.good >= 5) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.good = 0;
        this.onScale();
      } else if (!this.locked && !this.held && this.scale === 1 && this.good >= 8) {
        const i = ORDER.indexOf(this.tier.name);
        if (i < ORDER.indexOf(this.ceiling)) this.setTier(ORDER[i + 1]);
        this.good = 0;
      }
    } else {
      this.good = 0;
    }
  }
}
