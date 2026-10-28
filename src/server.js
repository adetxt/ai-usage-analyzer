import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { detectAll } from './detectors.js';
import { loadAll } from './loaders.js';

const assets = new Map([
  ['/', ['../web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../web/app.js', 'text/javascript; charset=utf-8']],
  ['/aggregate.js', ['./aggregate.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['../web/style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['../web/favicon.svg', 'image/svg+xml']],
  ['/gsap.js', [import.meta.resolve('gsap/dist/gsap.min.js'), 'text/javascript; charset=utf-8']],
  ['/fonts/manrope.woff2', ['../web/fonts/manrope.woff2', 'font/woff2']],
  ['/icons/claude.svg', ['../web/icons/claude.svg', 'image/svg+xml']],
  ['/icons/openai.svg', ['../web/icons/openai.svg', 'image/svg+xml']],
  ['/icons/opencode.svg', ['../web/icons/opencode.svg', 'image/svg+xml']],
]);

export function createDashboardServer() {
  return createServer(async (req, res) => {
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403).end('Forbidden');
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
      return;
    }
    try {
      const path = new URL(req.url, `http://${host}`).pathname;
      if (path === '/api/usage') {
        const detections = detectAll();
        const { records, errors } = await loadAll(detections);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ detections, records, errors, generatedAt: new Date().toISOString() }));
      } else if (assets.has(path)) {
        const [file, type] = assets.get(path);
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }).end(content);
      } else {
        res.writeHead(404).end('Not found');
      }
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Could not load local usage data.' }));
    }
  });
}

export async function startDashboard() {
  const server = createDashboardServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`AI Usage Analyzer is running at ${url}\nPress Ctrl+C to stop.`);
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return server;
}
