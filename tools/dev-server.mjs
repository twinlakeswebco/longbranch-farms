#!/usr/bin/env node
/**
 * Tiny static file server for previewing this site exactly the way a real
 * static host serves it: a request for /about/ serves about/index.html, and
 * any path nothing matches gets this site's own 404.html back with a real
 * 404 status code -- the same behavior as GitHub Pages, Netlify, and most
 * other static hosts. Plain Node, no dependencies, nothing to install.
 *
 * Preview the site:
 *   node tools/dev-server.mjs
 *   open http://localhost:8080
 *
 * Pick a different port:
 *   node tools/dev-server.mjs 5050
 *
 * tools/e2e-check.mjs also imports startServer() from this file, so the
 * automated checks run against the exact same routing rules as a human
 * previewing the site would see.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

async function fileAt(p) {
  try {
    const st = await stat(p);
    return st.isFile() ? p : null;
  } catch {
    return null;
  }
}

async function resolveRoute(rawUrl) {
  const clean = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
  const target = path.normalize(path.join(ROOT, clean));

  // Refuse to serve anything outside the project root.
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;

  if (clean === '/' || clean === '') {
    return fileAt(path.join(ROOT, 'index.html'));
  }

  // Exact file -- covers every asset and the legacy foo.html redirect stubs.
  const exact = await fileAt(target);
  if (exact) return exact;

  // Clean route: /about (or /about/) -> about/index.html. This is how every
  // static host we're likely to deploy to (GitHub Pages, Netlify) resolves a
  // directory request, with or without the trailing slash.
  const asDir = await fileAt(path.join(target, 'index.html'));
  if (asDir) return asDir;

  return null;
}

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const file = await resolveRoute(req.url);
      if (file) {
        const body = await readFile(file);
        const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      // Nothing matched -- this site's own 404 page, with a real 404 status,
      // the same thing a visitor would actually see on a live host.
      const body = await readFile(path.join(ROOT, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address();
      resolve({
        server,
        port: bound.port,
        url: `http://127.0.0.1:${bound.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Run directly: `node tools/dev-server.mjs [port]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 8080;
  const { url } = await startServer(port);
  console.log(`Long Branch Farms preview running at ${url}`);
  console.log('Press Ctrl+C to stop.');
}
