// What each place costs to draw, compared in one page so every place sees the same GPU state:
// switch place, then time the same frame drawn over and over, each time waiting on a pixel
// read. Separate browser runs (npm run perf) vary too much from run to run for this.
// Usage: npm run build && node tools/place-cost.js [--tier high] [--phone] [--software] [--rounds 4]
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { serve } from './serve.js';
import { PLACES } from '../src/config.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const TIER = arg('tier', 'high');
const ROUNDS = Number(arg('rounds', 4));
const PHONE = process.argv.includes('--phone');
const SOFTWARE = process.argv.includes('--software');
const ids = [...new Set(PLACES)];

const server = await serve(join(import.meta.dirname, '..', 'dist'));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage(PHONE ? { viewport: { width: 360, height: 800 }, deviceScaleFactor: 3 } : { viewport: { width: 1920, height: 1080 } });
await page.addInitScript((quality) => localStorage.setItem('bubbler:settings', JSON.stringify({ quality, music: false, sound: false })), TIER);
await page.goto(`http://127.0.0.1:${server.address().port}/?debug&seed=1&level=4`);
await page.waitForFunction(() => performance.getEntriesByName('bubbler-ready').length > 0, null, { timeout: 120000 });
await page.click('#btn-play');
await page.evaluate(() => window.__bubbler.view.flight && window.__bubbler.view.skipFlight());
await page.waitForTimeout(1500);

const results = Object.fromEntries(ids.map((id) => [id, { frame: [], scene: [], cube: [] }]));
for (let round = 0; round < ROUNDS; round++) {
  for (const id of ids) {
    await page.evaluate((id) => window.__bubbler.goPlace(id), id);
    await page.waitForFunction((id) => window.__bubbler.place === id, id, { timeout: 60000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate((runs) => {
      const v = window.__bubbler.view;
      const r = v.renderer;
      const gl = r.getContext();
      const pixel = new Uint8Array(4);
      window.__bubbler.freeze(12.3);
      const time = (fn, n) => {
        for (let i = 0; i < 3; i++) fn();
        const t = [];
        for (let i = 0; i < n; i++) {
          const t0 = performance.now();
          fn();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          t.push(performance.now() - t0);
        }
        return t.sort((a, b) => a - b)[n >> 1];
      };
      // A whole frame as the game draws it; the place alone; the cube map shot from scratch.
      const frame = () => {
        if (v.quality.tier.cubeEvery) v.env.captureFace(r);
        r.setRenderTarget(null);
        if (v.post) v.post.render();
        else {
          r.clear();
          r.render(v.env.scene, v.camera);
          r.render(v.scene, v.camera);
        }
      };
      const scene = () => {
        r.setRenderTarget(null);
        r.clear();
        r.render(v.env.scene, v.camera);
      };
      const out = { frame: time(frame, runs), scene: time(scene, runs), cube: time(() => v.env.capture(r), Math.ceil(runs / 3)) };
      window.__bubbler.freeze(null);
      return out;
    }, SOFTWARE ? 10 : 40);
    for (const k of Object.keys(r)) results[id][k].push(r[k]);
  }
}
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`${TIER} tier, ${PHONE ? 'phone 360x800 at 3x' : 'pc 1920x1080'}${SOFTWARE ? ', software rendering' : ''}; ms, median of ${ROUNDS} rounds`);
console.log('place      frame   place alone   cube map');
const base = results[ids[0]];
for (const id of ids) {
  const r = results[id];
  const vs = id === ids[0] ? '' : `  (${((median(r.frame) / median(base.frame) - 1) * 100).toFixed(0)}% against ${ids[0]})`;
  console.log(`${id.padEnd(9)} ${median(r.frame).toFixed(2).padStart(6)}   ${median(r.scene).toFixed(2).padStart(11)}   ${median(r.cube).toFixed(2).padStart(8)}${vs}`);
}
await browser.close();
server.close();
