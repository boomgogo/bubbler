// A tiny static server for ./dist that compresses like Cloudflare does (brotli),
// so load measurements see realistic transfer sizes. Not used in production.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };

export function serve(dir, port = 0) {
  const cache = new Map();
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (path.endsWith('/')) path += 'index.html';
    try {
      if (!cache.has(path)) {
        const raw = await readFile(join(dir, path));
        cache.set(path, brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      }
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
        'Content-Encoding': 'br',
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(cache.get(path));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve(join(import.meta.dirname, '..', 'dist'), Number(process.argv[2] ?? 4173));
  console.log(`http://127.0.0.1:${server.address().port}`);
}
