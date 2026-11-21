// A tiny https "front door" for the Waapo Mini App. It runs free on Render and passes the app's
// requests on to your bot (which can stay on Spaceify, plain http). No packages needed.
import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT) || 25560;                       // Render tells us which port to listen on
const UP = new URL(process.env.UPSTREAM || 'http://localhost:3000');   // your bot's API address, e.g. http://de25.spaceify.eu:25560
const KEY = process.env.PROXY_KEY || '';                              // shared secret: only this proxy may call your bot's API
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean));
const lib = UP.protocol === 'https:' ? https : http;

const corsFor = origin => origin && ORIGINS.has(origin)
  ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' } : {};
const json = (res, code, body, h = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  const origin = req.headers.origin, cors = corsFor(origin), path = String(req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (path === '/' || path === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('Waapo proxy is running'); }   // also used to keep the service awake
  if (!path.startsWith('/api/')) return json(res, 404, { error: 'Not found.' }, cors);
  if (Number(req.headers['content-length'] || 0) > 20000) return json(res, 413, { error: 'That request is too large.' }, cors);

  const headers = { 'x-proxy-key': KEY, 'x-forwarded-for': String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') };
  for (const k of ['authorization', 'content-type', 'content-length', 'origin']) if (req.headers[k]) headers[k] = req.headers[k];
  const up = lib.request({ hostname: UP.hostname, port: UP.port || (UP.protocol === 'https:' ? 443 : 80), path: req.url, method: req.method, headers, timeout: 25000 }, r => {
    const out = { ...r.headers };
    for (const k of Object.keys(out)) if (/^(access-control-|connection$|keep-alive$|transfer-encoding$)/i.test(k)) delete out[k];   // we add CORS ourselves
    res.writeHead(r.statusCode || 502, { ...out, ...cors }); r.pipe(res);
  });
  up.on('timeout', () => up.destroy(new Error('timeout')));
  up.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'The bot server is not reachable right now.' }, cors); else res.end(); });
  req.pipe(up);
}).listen(PORT, '0.0.0.0', () => console.log(`Waapo proxy listening on ${PORT} → ${UP.origin}`));
