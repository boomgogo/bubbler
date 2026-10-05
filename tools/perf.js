// Measures the two things the spec asks for, on the built site in ./dist:
//   1. how long until Play can be tapped, on a throttled network and CPU
//   2. frame rate during play
// Usage: npm run build && node tools/perf.js [--runs 5] [--play 20] [--software]
// --software renders on the CPU (SwiftShader): far slower than any real GPU, which makes it a
// worst case for checking that the game steps its quality down instead of crawling.
// Needs Google Chrome installed. Note the limits: CPU throttling does not imitate a weak
// GPU, and the network model adds latency per request but no connection set-up time.
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { serve } from './serve.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const RUNS = arg('runs', 5);
const PLAY_SECONDS = arg('play', 20);
// Deliberately below typical broadband and 4G: 10 Mbit/s down, 100 ms round trip.
const NETWORK = { offline: false, downloadThroughput: (10e6 / 8), uploadThroughput: (5e6 / 8), latency: 100 };
const PROFILES = [
  { name: 'phone', viewport: { width: 360, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4 },
  { name: 'pc', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpu: 1 },
];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const server = await serve(join(import.meta.dirname, '..', 'dist'));
const url = `http://127.0.0.1:${server.address().port}/?debug`;
const SOFTWARE = process.argv.includes('--software');
const launch = () =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    args: SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist'],
  });

for (const profile of PROFILES) {
  const { name, cpu, ...contextOptions } = profile;
  const loads = [];
  let page;
  let browser;
  for (let run = 0; run < RUNS; run++) {
    // A new browser every time: empty HTTP cache and no compiled shaders, like a first visit.
    browser = await launch();
    const context = await browser.newContext(contextOptions);
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NETWORK);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => performance.getEntriesByName('bubbler-ready').length > 0, null, { timeout: 60000 });
    loads.push(await page.evaluate(() => ({
      ready: performance.getEntriesByName('bubbler-ready')[0].startTime,
      paint: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN,
      bytes: [performance.getEntriesByType('navigation')[0], ...performance.getEntriesByType('resource')].reduce((s, e) => s + e.transferSize, 0),
    })));
    if (run < RUNS - 1) await browser.close();
  }
  console.log(`\n=== ${name}: ${profile.viewport.width}x${profile.viewport.height}, CPU slowed ${cpu}x, 10 Mbit/s, 100 ms${SOFTWARE ? ', software rendering' : ''} ===`);
  console.log(`first paint      ${Math.round(median(loads.map((l) => l.paint)))} ms   (median of ${RUNS})`);
  console.log(`Play can be tapped  ${Math.round(median(loads.map((l) => l.ready)))} ms   (all runs: ${loads.map((l) => Math.round(l.ready)).join(', ')})`);
  console.log(`downloaded       ${(median(loads.map((l) => l.bytes)) / 1000).toFixed(1)} KB`);

  // Frame rate: start a run and shoot somewhere new twice a second.
  await page.click('#btn-play');
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const { width, height } = profile.viewport;
  const end = Date.now() + PLAY_SECONDS * 1000;
  for (let i = 0; Date.now() < end; i++) {
    const x = width / 2 + Math.sin(i * 1.7) * Math.min(width * 0.45, height * 0.3);
    const y = height * (0.2 + 0.25 * Math.abs(Math.cos(i * 0.9)));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    // Keep the run going whatever happens to it.
    for (const id of ['btn-revive', 'btn-again']) {
      if (await page.locator('#' + id).isVisible()) await page.click('#' + id);
    }
  }
  const result = await page.evaluate(() => {
    const f = window.__frames.slice(30).sort((a, b) => a - b);
    const mean = f.reduce((s, x) => s + x, 0) / f.length;
    return { fps: 1000 / mean, p95: f[Math.floor(f.length * 0.95)], p99: f[Math.floor(f.length * 0.99)], frames: f.length, stats: window.__bubbler.view.stats, shots: window.__bubbler.game.stats.shots };
  });
  console.log(`frame rate       ${result.fps.toFixed(1)} fps mean; 95% of frames under ${result.p95.toFixed(1)} ms, 99% under ${result.p99.toFixed(1)} ms`);
  console.log(`settled on       tier ${result.stats.tier}, resolution x${result.stats.scale.toFixed(1)}, pixel ratio ${result.stats.pixelRatio.toFixed(2)}, ${result.stats.calls} draw calls`);
  await browser.close();
}
server.close();
