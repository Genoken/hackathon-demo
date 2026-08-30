#!/usr/bin/env node
/* The demo's web tier. Three origins on one host:
 *
 *   :8080  the landing page — the submission URL, where a visitor picks a side
 *   :8081  the Command Centre   (what `pnpm dev:mock` serves on :5173)
 *   :8082  the Field App        (what `pnpm dev:mock` serves on :5174)
 *
 * Each app is served at the ROOT of its own port and proxies /graphql to the
 * BFF on loopback — the same shape vite dev gives them, so a deployed build
 * behaves the way the daily review build behaves.
 *
 * NOTHING HERE IS TIED TO THE MACHINE THAT BUILT IT. No absolute paths, no
 * baked hostname: the landing page's two links are filled in per request from
 * the Host header the visitor actually used, so the same folder works on
 * localhost, a LAN address, a bare VPS IP and a domain without a rebuild.
 * Behind a TLS-terminating reverse proxy, x-forwarded-proto is honoured; for
 * anything more custom, set PORTAL_URL / FIELD_URL explicitly.
 */
import { createServer, request as upstream } from 'node:http';
import { createGzip } from 'node:zlib';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const BIND = process.env.BIND_HOST ?? '0.0.0.0';
const LANDING_PORT = Number(process.env.LANDING_PORT ?? 8080);
const PORTAL_PORT = Number(process.env.PORTAL_PORT ?? 8081);
const FIELD_PORT = Number(process.env.FIELD_PORT ?? 8082);
const BFF_PORT = Number(process.env.BFF_PORT ?? 4000);
const PORTAL_URL = process.env.PORTAL_URL;
const FIELD_URL = process.env.FIELD_URL;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function proxyGraphql(req, res) {
  const out = upstream(
    { host: '127.0.0.1', port: BFF_PORT, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      // The live lane is GraphQL-SSE over this same path: nothing here may buffer.
      res.socket?.setNoDelay(true);
      up.pipe(res);
    },
  );
  out.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end('{"errors":[{"message":"The BFF is not running."}]}');
  });
  req.pipe(out);
}

function sendFile(req, res, file) {
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // The portal is 587KB of JS; gzip takes it to 167KB. Worth it on a judge's
  // first load. Only text — images and woff2 are already compressed.
  const gzip = /text|javascript|json|svg|manifest/.test(type)
    && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  res.writeHead(200, {
    'content-type': type,
    'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    ...(gzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
  });
  const body = createReadStream(file);
  if (gzip) body.pipe(createGzip()).pipe(res);
  else body.pipe(res);
}

/** Serve `root` at the root of `port`, the way vite dev serves each app. */
function appOrigin(port, root, label) {
  createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === '/graphql') return proxyGraphql(req, res);
    const file = resolve(root, '.' + path);
    // resolve() collapses `..`; anything escaping its own app's root is not served.
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return sendFile(req, res, file);
    // The portal's router is hash-based and the field app has none, so every
    // other path is the app shell itself.
    return sendFile(req, res, join(root, 'index.html'));
  }).listen(port, BIND, () => console.log(`${label} → ${BIND}:${port}`));
}

appOrigin(PORTAL_PORT, join(HERE, 'portal'), 'command centre');
appOrigin(FIELD_PORT, join(HERE, 'field'), 'field app     ');

const LANDING_ROOT = join(HERE, 'landing');

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  // Every page under landing/ gets the same treatment: extensionless URLs
  // resolve to .html, and any .html is templated (the guide links to both apps
  // too, so it needs the Host-derived URLs the landing page needs). Anything
  // else is served verbatim. Unknown paths fall back to the landing page.
  const want = path === '/' ? 'index.html' : path.replace(/^\/+/, '') + (extname(path) ? '' : '.html');
  const file = resolve(LANDING_ROOT, want);
  const found = file.startsWith(LANDING_ROOT) && existsSync(file) && statSync(file).isFile();
  if (found && !file.endsWith('.html')) return sendFile(req, res, file);
  const html = readFileSync(found ? file : join(LANDING_ROOT, 'index.html'), 'utf8');
  const proto = (req.headers['x-forwarded-proto'] ?? 'http').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host ?? `127.0.0.1:${LANDING_PORT}`)
    .toString()
    .split(',')[0]
    .trim()
    .split(':')[0];
  const body = html
    .replaceAll('__PORTAL_URL__', PORTAL_URL ?? `${proto}://${host}:${PORTAL_PORT}/`)
    .replaceAll('__FIELD_URL__', FIELD_URL ?? `${proto}://${host}:${FIELD_PORT}/`);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(body);
}).listen(LANDING_PORT, BIND, () => console.log(`landing        → ${BIND}:${LANDING_PORT}`));
