// Static QA tools + local-manager drop data registration. Original workbooks are never executed.
import http from 'node:http';
import { createDropService } from './server/drop-service.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] || fallback : fallback;
const host = option('--host', '127.0.0.1');
const port = Number(option('--port', process.env.JSON_COMPARE_PORT || '5175'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
const allowed = new Set(['/index.html', '/src/theme.js', '/src/main.js', '/src/style.css', '/src/compare.js', '/src/worker.js', '/src/json-tool.js', '/src/json-display.js', '/src/json-source.js', '/src/source-lines.js', '/src/json-review.js', '/src/items/rules.js', '/src/items/workbook.js', '/src/items/ui.js', '/src/items/example.js', '/src/items/macro.js', '/src/items/macro-template.py', '/src/drop/display.js', '/src/drop/summary-ui.js', '/src/drop/compare-ui.js', '/src/drop/ui.js', '/src/drop/style.css', '/src/vendor/sax.js']);
const mime = { '.py': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const handleDrop = await createDropService(root);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  const requestUrl = new URL(req.url, 'http://localhost');
  if (await handleDrop(req, res, requestUrl)) return;
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Method not allowed'); return; }
  try {
    let route = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (route === '/') route = '/index.html';
    if (!allowed.has(route)) { res.writeHead(404); res.end('Not found'); return; }
    const content = await readFile(path.join(root, route));
    res.writeHead(200, { 'Content-Type': mime[path.extname(route)] });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(400); res.end('Cannot read request'); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other server, or run: node server.mjs --port ${port + 1}` : error.message);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`\nQA Tools\nLocal: http://localhost:${port}/`);
  if (host === '0.0.0.0') for (const list of Object.values(os.networkInterfaces())) for (const address of list || []) if (address.family === 'IPv4' && !address.internal) console.log(`Network: http://${address.address}:${port}/`);
  console.log('\nKeep this terminal open. Press Ctrl+C to stop.\n');
});
