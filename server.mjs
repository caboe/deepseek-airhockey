#!/usr/bin/env node
/**
 * Zero-dependency static server for NEON PUCK.
 *
 *   node server.mjs
 *   PORT=8080 node server.mjs
 *
 * ES modules and the import map need to be served over HTTP.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function safePathname(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  const normalized = normalize(pathname).replace(/^([/\\])+/, '');
  const absolute = resolve(join(ROOT, normalized));
  if (absolute !== ROOT && !absolute.startsWith(ROOT + sep)) return null;
  return absolute;
}

const server = createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  const filePath = safePathname(request.url || '/');
  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('404 — Datei nicht gefunden');
    return;
  }

  let targetPath = filePath;
  if (statSync(targetPath).isDirectory()) {
    targetPath = join(targetPath, 'index.html');
    if (!existsSync(targetPath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('404 — Kein Index in diesem Ordner');
      return;
    }
  }

  const extension = extname(targetPath).toLowerCase();
  const type = MIME_TYPES[extension] || 'application/octet-stream';
  const isSource = ['.html', '.css', '.js', '.mjs'].includes(extension);
  const headers = {
    'Content-Type': type,
    'Cache-Control': isSource ? 'no-cache' : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };

  if (request.method === 'HEAD') {
    response.writeHead(200, headers);
    response.end();
    return;
  }

  response.writeHead(200, headers);
  createReadStream(targetPath).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  NEON PUCK — 3D Airhockey');
  console.log(`  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('');
  console.log('  STRG+C beendet den Server.');
  console.log('');
});
