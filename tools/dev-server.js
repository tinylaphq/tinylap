// Serves an app from source under the same URL layout as production
// (see serve-map.js), and refuses to let the browser cache anything:
// Chrome happily reuses a cached ES module across reloads, which silently
// hides every edit.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { packageRoots, resolveUrl } from './serve-map.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const appDir = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8000);
const roots = packageRoots(appDir);

createServer(async (req, res) => {
  const file = resolveUrl(appDir, roots, new URL(req.url, 'http://x').pathname);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  try {
    if (!file) throw new Error('not mapped');
    const body = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${appDir} on http://localhost:${port} (no-store)`));
