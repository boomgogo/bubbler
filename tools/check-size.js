// Fails when the files needed before Play can be tapped exceed the download budget.
// Sizes are brotli-compressed, which is what Cloudflare serves.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { join } from 'node:path';

const BUDGET = { html: 10_000, js: 250_000 };
const dist = join(import.meta.dirname, '..', 'dist');
const br = (buf) =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const html = readFileSync(join(dist, 'index.html'));
// Everything index.html pulls in eagerly: module scripts, preloads and stylesheets.
const refs = [...html.toString().matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

const rows = [['index.html', html.length, br(html), BUDGET.html]];
let js = 0;
for (const ref of refs) {
  const buf = readFileSync(join(dist, ref));
  const size = br(buf);
  js += size;
  rows.push([ref, buf.length, size, null]);
}
rows.push(['scripts and styles, total', null, js, BUDGET.js]);

const kb = (n) => (n == null ? '' : (n / 1000).toFixed(1) + ' KB');
let failed = false;
for (const [name, raw, size, budget] of rows) {
  const over = budget != null && size > budget;
  failed ||= over;
  console.log(
    name.padEnd(40),
    kb(raw).padStart(10),
    kb(size).padStart(10) + ' br',
    budget == null ? '' : `(budget ${kb(budget)})${over ? '  OVER' : ''}`,
  );
}
if (failed) {
  console.error('\nCritical path is over budget.');
  process.exit(1);
}
