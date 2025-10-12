Black Mamba (Node.js, ESM)

A tiny, Rails‑inspired HTTP server and router for Node.js with zero external dependencies. Uses simple, explicit controllers, RESTful routing by convention, static file serving, and optional response compression. Ships with small, dependency‑free libs for compression, magic links, WebAuthn, and SQLite.

Quick Start
- Requirements: Node 18+ (ESM enabled via `type: module`)
- Install: no external deps required
- Run: `npm start` (starts `app.js` on port 3000)
- Static files: place assets in `public/` (serves `/` as `public/index.html`)

Project Layout
- `app.js` — boots the server, loads controllers, wires the router, compression
- `router.js` — RESTful routing with nesting, namespace, and custom routes
- `controllers/` — your controllers; export instances of `ApplicationController`
- `controllers/application.js` — base controller (actions + hooks)
- `public/` — static files served as is
- `config.json` — compression config (optional)
- `libs/` — small, dependency‑free libraries with their own tests

Boot Sequence
- `app.js:1` creates an HTTP server and response wrapper using ESM imports
- `app.js:12` loads every controller instance exported from `controllers/`
- `router.js:44` registers RESTful routes for each controller
- `router.js:62` serves files from `public/` when paths match
- `libs/compression/index.js:84` transparently compresses responses when enabled

Hello, Controller
- Controllers are instances of `ApplicationController` that define resource names and action methods
- Export instances (not classes) so the loader can register them automatically

Example: `controllers/users.js`
```js
import { ApplicationController } from './application.js';

export const Users = new class extends ApplicationController {
  namespace = '';
  resources = 'users'; // plural resource name => /users

  // Optional hooks
  constructor() {
    super();
    this.before_handlers.add((req) => { req.context = { startedAt: Date.now() }; });
    this.after_handlers.add((_req, res) => { /* metrics, audit, etc. */ });
  }

  // Actions (return a value or write via response helpers)
  async index(req, res) {
    return [{ id: 1, name: 'Ada' }]; // auto JSON when returning objects
  }

  async show(req, res) {
    return { id: Number(req.params.id), name: 'Ada' };
  }
}();
```

Routes by Convention
- A controller with `resources = 'users'` registers:
  - `GET /users` → `index`
  - `GET /users/new` → `new`
  - `POST /users` → `create`
  - `GET /users/:id` → `show`
  - `GET /users/:id/edit` → `edit`
  - `PUT /users/:id` and `PATCH /users/:id` → `update`
  - `DELETE /users/:id` → `destroy`
- File: `router.js:30`

Nested Resources
- Set `belongs_to` on a child resource to nest routes under its parent
- Example (comments under posts):
```js
export const Posts = new class extends ApplicationController { resources = 'posts'; }();
export const Comments = new class extends ApplicationController {
  resources = 'comments';
  belongs_to = 'posts'; // routes under /posts/:post_id/comments
}();
```
- URLs: `/posts/:post_id/comments`, `/posts/:post_id/comments/:id`
- Parent controllers are auto‑registered before children (see `controllers.js:4`)

Namespaces
- Prefix routes by setting `namespace`
```js
export const AdminUsers = new class extends ApplicationController {
  namespace = 'admin';
  resources = 'users'; // → /admin/users
}();
```

Custom Routes
- Add entries to `custom_routes` as `[method, action, path]`
```js
export const Reports = new class extends ApplicationController {
  resources = 'reports';
  constructor() {
    super();
    this.custom_routes.add(['GET', 'stats', 'stats']);      // /reports/stats
    this.custom_routes.add(['POST', 'publish', '/publish']); // /publish (absolute)
  }
  stats(req, res) { return { ok: true }; }
  publish(req, res) { return res.text('published'); }
}();
```
- File: `router.js:36`

Request and Response API
- Request (created in `app.js:29`)
  - `request.method` — HTTP method
  - `request.url` — WHATWG `URL`
  - `request.params` — route params (e.g., `{ id: '1' }`)
  - `await request.body()` — parsed body:
    - `application/json` → object
    - `application/x-www-form-urlencoded` → object
    - otherwise → `Buffer`
- Response (created in `app.js:46`)
  - `response.status(code)`
  - `response.header(name, value)`
  - `response.json(obj)` / `response.text(text)`
  - `response.send(body)` — string, Buffer, or object (auto‑JSON)
  - `response.error(err)` — 500 text

Static Files
- Any request that matches a file under `public/` is served directly
- `GET /` serves `public/index.html` if present
- File: `router.js:54`

Compression
- Enabled by default and negotiated from `Accept-Encoding`
- Configuration file: `config.json`
```json
{
  "compression": {
    "enabled": true,
    "threshold": 1024,
    "prefer": ["br", "gzip", "deflate"],
    "brotli": { "quality": 4 },
    "gzip": { "level": 5 },
    "deflate": { "level": 5 },
    "skip": {
      "extensions": ["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "mp4", "zip", "gz", "pdf", "woff", "woff2", "ttf"],
      "contentTypes": ["image/*", "video/*", "audio/*", "application/zip", "application/gzip", "application/octet-stream", "application/pdf"]
    }
  }
}
```
- Implementation: `libs/compression/index.js`

Server Options
- By default, `app.js` starts HTTP/1.1 on port 3000 and logs requests
- To customize (port, HTTP/2), adapt the `serve` call in `app.js:117`:
```js
// serve({ port: 4000, http2: true })
```

Sessions
- `request.session` is available in all routes. It is cookie‑backed and persisted in SQLite by default.
- Example:
  ```js
  // set and persist
  request.session.set('user', { id: 1, email: 'user@example.com' });
  await request.session.save();

  // read later
  const user = request.session.get('user');
  const anonymous = request.session.is_anonymous; // true if no cookie was sent by client
  ```

Conventions (No External Deps, ESM Only)
- ESM imports everywhere: `import { X } from './path.js'`
- No Typescript; no third‑party packages
- Keep controllers small and explicit; favor clear return values over side effects

Included Libraries
- Compression — transparent response compression (Brotli/Gzip/Deflate)
  - Use: handled for you in `app.js`
  - Test: `node libs/compression/test.js`
- Cookies — RFC6265 parsing/serialization, HMAC signing, CookieJar, HTTP helpers
  - Entry: `libs/cookies/index.js`
  - Test: `node --test libs/cookies/test.mjs`
- SMTP — minimal TLS SMTP client using env config
  - Entry: `libs/smtp/index.js`
  - Env: `BM_SMTP_HOST`, `BM_SMTP_PORT`, `BM_SMTP_USERNAME`, `BM_SMTP_PASSWORD`
  - Test: `node --test libs/smtp/test.mjs`
- Sessions — cookie‑backed sessions with SQLite store
  - Entry: `libs/session/index.js`
  - Env (optional): `BM_SESSION_DB` (default `sessions.db`), `BM_SESSION_SECRET` (required in production)
  - Usage: automatically attached in `app.js` as `request.session`
  - Test: `npm run test:session`
- Magic Links — tiny, HMAC‑based, single‑use link tokens
  - Entry: `libs/magick-links/src/index.js`
  - Test: `node --test libs/magick-links/test/*.test.mjs`
  - Example:
    ```js
    import { createMagicLink, consumeMagicLink, memoryStore } from './libs/magick-links/src/index.js';
    const store = memoryStore();
    const keystore = { current: { kid: 'v1', key: crypto.randomBytes(32) } };
    const { url, token } = createMagicLink({ sub: 'user@example.com', purpose: 'login' }, { baseUrl: 'https://example.com/magic', keystore });
    const res = await consumeMagicLink(token, { expected: { purpose: 'login' }, store, keystore });
    ```
- WebAuthn — minimal helpers to generate options and verify responses
  - Entry: `libs/webauthn/index.js`
  - Demo: `node libs/webauthn/example.js`
  - Test: `node libs/webauthn/test.js`
- SQLite — native, dependency‑free SQLite driver (ESM)
  - Entry: `libs/sqlite/index.mjs`
  - Build: `cd libs/sqlite && node-gyp rebuild`
  - Test: `node --test libs/sqlite/test/*.test.mjs`
  - Do not commit build artifacts: add `libs/sqlite/build/`, `**/*.node`, and `**/*.o` to `.gitignore` (already included). These files are platform‑specific and can break pushes (large binaries) — build locally instead.

Testing Philosophy
- Each lib ships with its own focused tests in its directory
- Run them independently as shown above
- Keep project controllers and routes simple; favor small, targeted tests

Testing (npm scripts)
- Run all libs: `npm test`
- Individual suites:
  - Compression: `npm run test:compression`
  - Cookies: `npm run test:cookies`
  - SMTP: `npm run test:smtp`
  - Session: `npm run test:session`
  - WebAuthn: `npm run test:webauthn`
  - Magic Links: `npm run test:magick-links`
  - SQLite: `npm run test:sqlite`

Adding a new library with tests
- Place tests under the library directory (e.g., `libs/<name>/test/`)
- Add a script in `package.json` to run it (e.g., `test:<name>`)
- Update the aggregate `test` script to include `npm run -s test:<name>` so `npm test` runs everything
- Keep tests dependency‑free; prefer Node’s built‑in `node:test` and `assert`

Troubleshooting
- Server doesn’t start
  - Ensure Node 18+ and `package.json` has `"type": "module"`
  - Check for syntax errors in new controllers (ESM only)
- Controller not loaded
  - Export an instance (not a class)
  - Ensure the instance `instanceof ApplicationController` (`controllers/application.js`)
- Routes not matching
  - Confirm `resources` name and nesting (`belongs_to`) are set correctly
- Static file not served
  - Path must be inside `public/` and resolve to a file
- Compression unexpected
  - Inspect `config.json` and request `Accept-Encoding`; below threshold bodies aren’t compressed

File Map (for reference)
- Server bootstrap: `app.js:1`
- Router: `router.js:1`
- Controller base: `controllers/application.js:1`
- Controller registry/order: `controllers.js:1`
- Compression lib: `libs/compression/index.js:1`
- Config example: `config.json:1`

License
- This repository may include third‑party code under their respective licenses (e.g., vendored SQLite). See `libs/sqlite/LICENSE`.
