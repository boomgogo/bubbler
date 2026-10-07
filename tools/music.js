// Renders each place's music offline and prints how loud and how busy it is, so a new score can
// be matched to the others without listening on every device. With --out it also writes WAVs
// to listen to. Runs the sources through Vite, so no build is needed. Needs Google Chrome.
// Usage: node tools/music.js [--seconds 120] [--out dir] [--place marsh]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLACES } from '../src/config.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const SECONDS = Number(arg('seconds', 120));
const OUT = arg('out', null);
const ONLY = arg('place', null);
const RATE = 44100;

const vite = await createServer({ root: join(import.meta.dirname, '..'), logLevel: 'error', server: { port: 0 } });
await vite.listen();
const base = vite.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route(base + 'music', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>music</title>' }));
await page.goto(base + 'music');

if (OUT) mkdirSync(OUT, { recursive: true });
console.log('place     RMS dBFS  loudest 10 s  peak dBFS  notes/min');
for (const id of ONLY ? [ONLY] : [...new Set(PLACES)]) {
  const result = await page.evaluate(async ({ id, seconds, rate, wav }) => {
    const { Band } = await import('/src/audio/audio.js');
    const { music } = await import(`/src/render/places/${id}.js`);
    const ctx = new OfflineAudioContext(1, seconds * rate, rate);
    // The game's chain: the music bed at half level, the master, and the limiter.
    const master = ctx.createGain();
    master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 8;
    master.connect(limiter).connect(ctx.destination);
    const bed = ctx.createGain();
    bed.gain.value = 0.5;
    bed.connect(master);
    const noise = ctx.createBuffer(1, rate, rate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < rate; i++) data[i] = Math.random() * 2 - 1;
    const band = new Band(ctx, bed, noise, music, 0.4);
    let notes = 0;
    for (const [name, fn] of Object.entries(band.play)) {
      if (typeof fn === 'function' && name !== 'hz') band.play[name] = (...args) => (notes++, fn(...args));
    }
    band.schedule(seconds);
    const out = (await ctx.startRendering()).getChannelData(0);
    const db = (x) => 20 * Math.log10(x);
    let sum = 0;
    let peak = 0;
    for (const x of out) {
      sum += x * x;
      peak = Math.max(peak, Math.abs(x));
    }
    let loudest = 0;
    const win = rate * 10;
    for (let start = 0; start + win <= out.length; start += rate) {
      let s = 0;
      for (let i = start; i < start + win; i++) s += out[i] * out[i];
      loudest = Math.max(loudest, s / win);
    }
    let pcm = null;
    if (wav) {
      const ints = new Int16Array(out.length);
      for (let i = 0; i < out.length; i++) ints[i] = Math.max(-1, Math.min(1, out[i])) * 32767;
      const bytes = new Uint8Array(ints.buffer);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      pcm = btoa(s);
    }
    return { rms: db(Math.sqrt(sum / out.length)), loudest: db(Math.sqrt(loudest)), peak: db(peak), perMinute: notes / (seconds / 60), pcm };
  }, { id, seconds: SECONDS, rate: RATE, wav: !!OUT });
  console.log(`${id.padEnd(9)} ${result.rms.toFixed(1).padStart(8)}  ${result.loudest.toFixed(1).padStart(12)}  ${result.peak.toFixed(1).padStart(9)}  ${result.perMinute.toFixed(0).padStart(9)}`);
  if (OUT) {
    const pcm = Buffer.from(result.pcm, 'base64');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    writeFileSync(join(OUT, `music-${id}.wav`), Buffer.concat([header, pcm]));
  }
}
if (OUT) console.log(`\nWAVs in ${OUT}`);
await browser.close();
await vite.close();
