import './libs/env/index.js';
import http from 'node:http';
import http2 from 'node:http2';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { Controllers } from "./controllers.js";
import { ApplicationController } from "./controllers/application.js";
import { Router } from "./router.js";
import { migrateAll } from './models/bootstrap.js';
import { buildModelRegistry } from './models/index.js';
import { createCompression } from './libs/compression/index.js';
import { readCookies } from './libs/cookies/index.js';
import { createSession } from './libs/session/index.js';

async function load_controllers() {
  // Recursively import controllers from './controllers' excluding application.js
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const controllersDir = path.join(rootDir, 'controllers');

  if (!fs.existsSync(controllersDir)) return;

  const toVisit = [controllersDir];
  while (toVisit.length) {
    const dir = toVisit.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        toVisit.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'application.js') continue;
      if (!entry.name.endsWith('.js')) continue;

      try {
        const mod = await import(pathToFileURL(full).href);
        for (const key of Object.keys(mod)) {
          const val = mod[key];
          if (val instanceof ApplicationController) {
            const controller = val;
            if (!controller.resources) continue;
            Controllers.set(controller.resources, controller);
          }
        }
      } catch (err) {
        // Skip modules that fail to load
        console.error(`Failed to load controller from ${full}:`, err.message);
      }
    }
  }
}

function createRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return {
    method: req.method,
    headers: req.headers,
    url,
    params: {},
    raw: req,
    cookies: readCookies(req),
    async body() {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      const type = (req.headers['content-type'] || '').toLowerCase();
      if (type.includes('application/json')) {
        try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return {}; }
      }
      if (type.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(buf.toString('utf8'));
        return Object.fromEntries(params.entries());
      }
      return buf;
    }
  };
}

function createResponse(req, res) {
  let statusCode = 200;
  let headers = {};
  // Setup compression by default based on Accept-Encoding
  const { stream: outStream } = createCompression(req, res);
  const api = {
    raw: outStream,
    status(code) { statusCode = code; return api; },
    header(name, value) { headers[name] = value; if (!res.headersSent) res.setHeader(name, value); return api; },
    json(obj) { api.header('Content-Type', 'application/json; charset=utf-8'); return api.send(JSON.stringify(obj)); },
    text(txt) { api.header('Content-Type', 'text/plain; charset=utf-8'); return api.send(String(txt)); },
    error(err) { return api.status(500).text(err?.message || 'Internal Server Error'); },
    send(body) {
      if (!res.headersSent) {
        res.statusCode = statusCode;
        res.writeHead(statusCode);
      }
      if (body !== undefined && body !== null) {
        if (Buffer.isBuffer(body) || typeof body === 'string') {
          outStream.write(body);
        } else {
          // Fallback to JSON
          api.header('Content-Type', 'application/json; charset=utf-8');
          outStream.write(JSON.stringify(body));
        }
      }
      outStream.end();
    }
  };
  return api;
}

const isDev = /^(1|true|yes)$/i.test(String(process.env.BM_DEV || ''));
if (isDev) console.log('Dev mode enabled');
const defaultPort = Number.parseInt(process.env.BM_PORT, 10) || 3000;
const dbPathBanner = (process.env.BM_DATABASE || process.env.BM_SESSION_DB || ':memory:');

function serve(options = {}) {
  const {
    port = defaultPort,
    http2: useHttp2 = false,
    logger = console,
  } = options;

  const router = new Router();
  router.register_all(Controllers);

  const handler = async (req, res) => {
    const start = Date.now();
    const request = createRequest(req);
    const response = createResponse(req, res);
    // Attach session for each request (SQLite-backed by default)
    const session = createSession({
      name: 'bm.sid',
      secret: process.env.BM_SESSION_SECRET || 'dev-secret-change-me',
      ttl: 60 * 60 * 24 * 7,
      rolling: true,
      // Production by default; enable dev via BM_DEV=true
      secure: !isDev,
      sameSite: 'Lax'
    });
    await session.attach(request, response);

    try {
      router.handle(request, response);
    } catch (err) {
      if (!res.headersSent) response.error(err);
      if (isDev) {
        console.error('[DEV] Route error', req.method, request.url.pathname);
        if (err?.stack) console.error(err.stack); else console.error(String(err));
      }
    } finally {
      const duration = Date.now() - start;
      logger.log(`${req.method} ${request.url.pathname} ${res.statusCode || 200} - ${duration}ms`);
    }
  };

  const server = useHttp2 ? http2.createServer(handler) : http.createServer(handler);
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
  return server;
}

// Bootstrap
// By default run migrations only in dev (BM_DEV=true). In production, require BM_MIGRATE=true.
const migrateFlag = String(process.env.BM_MIGRATE || '').toLowerCase();
const wantMigrate = migrateFlag === '1' || migrateFlag === 'true' || (isDev && migrateFlag === '');
if (wantMigrate) {
  try {
    const order = await migrateAll(console);
    if (isDev) {
      console.log(`DB: ${dbPathBanner}`);
      console.log(`Migrations: ${order.join(', ')}`);
    }
  } catch (e) {
    console.error('Migration failed:', e?.message || e);
    process.exit(1);
  }
}
// Build model registry and load controllers, then wire models into controllers
const ModelRegistry = await buildModelRegistry();
await load_controllers();
for (const [, controller] of Controllers) {
  if (typeof controller.setModels === 'function') controller.setModels(ModelRegistry);
}
serve();
