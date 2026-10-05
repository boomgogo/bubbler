// Fails when any place, or the board and its effects in front of it, renders a NaN pixel.
// On the high tier the bloom blurs a single NaN pixel into a blank screen, while the other
// tiers hide it, so this renders the way the bloom pass does: half floats, 4x multisampling.
// For every place it looks from the playing camera, and in all six directions from the board,
// which is everything the fly-over and the reflections can see.
// GPUs differ on pow(), sqrt() and log() out of range: some return NaN, some a number. Here
// every shader is recompiled with versions that always return NaN, so a fault shows up on
// whatever GPU runs the check.
// Usage: npm run build && node tools/check-nan.js [--software]
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { serve } from './serve.js';
import { PLACES } from '../src/config.js';

const SOFTWARE = process.argv.includes('--software');
const server = await serve(join(import.meta.dirname, '..', 'dist'));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu', '--ignore-gpu-blocklist'],
});

// The strict versions, defined for every size of vector and swapped in by name.
const STRICT = (() => {
  const types = ['float', 'vec2', 'vec3', 'vec4'];
  const fn = (name, args, bad) => types.map((t, n) => {
    const params = args.map((a) => `${t} ${a}`).join(', ');
    if (n === 0) return `float strict_${name}(${params}) { return ${bad} ? uStrictNaN : ${name}(${args.join(', ')}); }`;
    const parts = ['x', 'y', 'z', 'w'].slice(0, n + 1).map((c) => `strict_${name}(${args.map((a) => `${a}.${c}`).join(', ')})`);
    return `${t} strict_${name}(${params}) { return ${t}(${parts.join(', ')}); }`;
  }).join('\n');
  return [
    'uniform float uStrictNaN;',
    fn('pow', ['x', 'y'], 'x < 0.0'),
    fn('sqrt', ['x'], 'x < 0.0'),
    fn('log', ['x'], 'x <= 0.0'),
    fn('log2', ['x'], 'x <= 0.0'),
    ...['pow', 'sqrt', 'log', 'log2'].map((name) => `#define ${name} strict_${name}`),
  ].join('\n') + '\n';
})();

let bad = 0;
for (const id of [...new Set(PLACES)]) {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.addInitScript(() => localStorage.setItem('bubbler:settings', JSON.stringify({ quality: 'high', music: false, sound: false })));
  await page.goto(`http://127.0.0.1:${server.address().port}/?debug&place=${id}&seed=1`);
  await page.waitForFunction(() => performance.getEntriesByName('bubbler-ready').length > 0, null, { timeout: 60000 });
  await page.click('#btn-play');
  await page.evaluate(() => window.__bubbler.view.skipFlight());
  await page.waitForFunction((place) => window.__bubbler.place === place && !window.__bubbler.view.flight, id, { timeout: 30000 });
  await page.evaluate((strict) => {
    const v = window.__bubbler.view;
    for (const scene of [v.env.scene, v.scene]) {
      scene.traverse((o) => {
        if (!o.material || o.material.onBeforeCompile.strict) return;
        const patch = (shader) => {
          shader.uniforms.uStrictNaN = { value: NaN };
          shader.vertexShader = strict + shader.vertexShader;
          shader.fragmentShader = strict + shader.fragmentShader;
        };
        patch.strict = true;
        o.material.onBeforeCompile = patch;
        o.material.needsUpdate = true;
      });
    }
    v.env.capture(v.renderer);
  }, STRICT);
  const counts = [];
  // A few moments apart: the shaders move with the clock.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const fx = window.__bubbler.view.fx;
      fx.pop(-2, 2, 1);
      fx.splash(2, -8, 3);
      window.__bubbler.view.markLauncher();
    });
    await page.waitForTimeout(250);
    counts.push(await page.evaluate(() => {
      const v = window.__bubbler.view;
      const r = v.renderer;
      const RenderTarget = Object.getPrototypeOf(v.env.target.constructor);
      const nans = (target, w, h, face) => {
        const buf = new Uint16Array(w * h * 4);
        r.readRenderTargetPixels(target, 0, 0, w, h, buf, face);
        let n = 0;
        for (const x of buf) if ((x & 0x7c00) === 0x7c00 && x & 0x3ff) n++; // half float NaN
        return n;
      };
      const draw = (target, camera, scenes) => {
        r.setRenderTarget(target);
        r.clear();
        for (const scene of scenes) r.render(scene, camera);
      };
      const { width, height } = r.domElement;
      const view = new RenderTarget(width, height, { type: 1016 /* HalfFloatType */, samples: 4 });
      draw(view, v.camera, [v.env.scene, v.scene]);
      const out = { view: nans(view, width, height) };
      const face = new RenderTarget(512, 512, { type: 1016, samples: 4 });
      v.env.cubeCamera.children.forEach((camera, i) => {
        draw(face, camera, [v.env.scene, v.scene]);
        out['face' + i] = nans(face, 512, 512);
      });
      // The cube map itself, when it is half float: a NaN there turns every bubble black.
      const cube = v.env.target;
      if (v.env.hdr) for (let i = 0; i < 6; i++) out['cube' + i] = nans(cube, cube.width, cube.width, i);
      r.setRenderTarget(null);
      view.dispose();
      face.dispose();
      return out;
    }));
  }
  // Every material that was drawn must have been drawn with the strict versions, or the check
  // would pass without checking anything.
  const unpatched = await page.evaluate(() => {
    const v = window.__bubbler.view;
    let drawn = 0;
    let missed = 0;
    for (const scene of [v.env.scene, v.scene]) {
      scene.traverseVisible((o) => {
        const program = o.material && v.renderer.properties.get(o.material).currentProgram;
        if (!program) return;
        drawn++;
        if (!program.cacheKey.includes('uStrictNaN')) missed++;
      });
    }
    return drawn === 0 ? -1 : missed;
  });
  if (unpatched !== 0) {
    console.error(`${id}: the strict pow() did not reach ${unpatched < 0 ? 'any' : unpatched} material(s); the check cannot be trusted`);
    process.exit(2);
  }
  const total = {};
  for (const c of counts) for (const [k, n] of Object.entries(c)) total[k] = (total[k] ?? 0) + n;
  const found = Object.entries(total).filter(([, n]) => n > 0);
  bad += found.length;
  console.log(`${id.padEnd(8)} ${found.length ? 'NaN in ' + found.map(([k, n]) => `${k} (${n})`).join(', ') : 'clean'}`);
  await page.close();
}
await browser.close();
server.close();
if (bad) {
  console.error('\nA NaN pixel blanks the screen on the high tier. Clamp the inputs of pow(), sqrt() and log() (see places/kit.js, rule 8).');
  process.exit(1);
}
