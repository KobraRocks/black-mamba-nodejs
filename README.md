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

Environment & Modes
- Production is the default mode.
- Per‑project `.env` (takes precedence over shell):
  - Use `.env.template` as a starting point: copy to `.env` and edit values.
  - Add a `.env` file at repo root with BM_-prefixed vars (only keys starting with `BM_` are read).
- Values from `.env` override existing shell environment variables for this process.
- Loaded automatically on startup and by libs that read env.
- Configure `BM_SUPER_ADMIN` with the email address that should receive super admin privileges when authenticating via magic link.
- Set `BM_DEV=true` (in `.env` or shell) to enable development conveniences:
  - Session cookies are not marked `secure`.
  - Migrations run automatically at startup unless `BM_MIGRATE` is set.
  - A banner `Dev mode enabled` prints at boot.
- Migrations on startup (`app/models/bootstrap.js`):
  - Set `BM_MIGRATE=true` (or `1`) to run migrations explicitly (works in prod too).
  - In dev mode with `BM_MIGRATE` unset, migrations run by default.
  - Migrations are ordered by foreign keys: tables referenced by a model’s field `reference: "table(id)"` are created first.
  - Database file: `BM_DATABASE` (falls back to `BM_SESSION_DB`, then `:memory:`)

Examples
```bash
# Development
BM_DEV=true npm start                 # logs "Dev mode enabled" and runs migrations
BM_DEV=true BM_MIGRATE=false npm start # dev but skip migrations

# Production
npm start                              # no migrations by default
BM_MIGRATE=1 npm start                 # explicitly run migrations, then start
```

### Booking Flow (public invite)

- Organizers share `/booking/:public_id/:slug` pages. The HTML shell loads the month grid, day slots, and contact form fragments asynchronously.
- `/booking/:public_id/:slug?month=current` returns the month view. Pass `month`/`year` query params to navigate.
- `/booking/:public_id/:slug?month=MM&year=YYYY&day=DD` renders the slot picker for a day.
- `/booking/:public_id/:slug/contact?...` shows the contact form; `POST`ing to the same path confirms the booking and emails ICS invites to both organizer and invitee.

`.env` example
```
BM_DEV=true
BM_PORT=4000
BM_DATABASE=./dev.sqlite
BM_SESSION_SECRET=supersecretchangeme
```

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

Content Negotiation (JSON vs Text)
- Controllers can keep returning simple values. The base controller now detects when JSON is expected and responds accordingly without changing your actions.
- JSON is selected when either condition is true:
  - `Accept` header includes `application/json`
  - Query parameter `?format=json` is present
- Effects:
  - When JSON is expected, `result` from an action is sent via `response.json(result)`.
  - Strings are valid JSON (quoted) and are returned with `Content-Type: application/json` when JSON is requested.
  - Without these hints, strings are returned as `text/plain` and objects are auto‑JSON via `response.send(...)`.
- Implementation: `controllers/application.js` (`wants_json`) and final send path in `execute`.

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
- Booking — tiny availability and date helpers
  - Entry: `libs/booking/index.js`
  - Spec: `libs/booking/SPEC.md`
  - Test: `node --test libs/booking/test.mjs`
- SQLite — native, dependency‑free SQLite driver (ESM)
  - Entry: `libs/sqlite/index.mjs`
  - Build: `cd libs/sqlite && node-gyp rebuild`
  - Test: `node --test libs/sqlite/test/*.test.mjs`
  - Do not commit build artifacts: add `libs/sqlite/build/`, `**/*.node`, and `**/*.o` to `.gitignore` (already included). These files are platform‑specific and can break pushes (large binaries) — build locally instead.

Views
- Simple, Rails‑inspired views using plain JS modules and template literals.
- Convention: `views/<resources>/<action>.js` or `views/<singular>/<action>.js`.
- Namespaces are supported: `views/<namespace>/<resources>/<action>.js`.
- A view module must export a function (default or `render`) returning a string (HTML).
- Auto‑render: if an action returns nothing (`undefined`/`null`) and a matching view exists, it is rendered automatically with `Content-Type: text/html`.
- Library: `libs/views/index.js` (helpers: `findView`, `renderViewIfPresent`).
- Test: `npm run test:views`.

Example: `views/users/index.js`
```js
export default function ({ assigns }) {
  // Use template literals to compose HTML; "assigns" can be ignored or used.
  return `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8"><title>Users</title></head>
    <body>
      <h1>Users</h1>
      <p>Hello from a view.</p>
    </body>
  </html>`;
}
```

Usage
- In a controller action, return nothing to trigger the default view:
```js
// controllers/users.js
index(_req, _res) {
  // If views/users/index.js exists, it will be rendered automatically.
}
```

- Pass data to the view by returning an object (used as `assigns`) when JSON is not requested. If a matching view exists, it will receive that data; otherwise the object is sent as the response.
```js
show(req, _res) {
  const user = this.User.find(Number(req.params.id));
  if (!user) return { _bm_response: true, status: 404, json: { error: 'not found' } };
  // When Accept is HTML (or default) and views/users/show.js exists,
  // it will be rendered with assigns = { user }.
  return { user };
}
```

- Or explicitly request rendering from an action (helpers on controller):
```js
index(_req, _res) {
  const users = this.User.all();
  return this.render({ users });               // renders views/users/index.js
  // or: return this.render('show', { user }); // renders views/users/show.js
}
```

Versioning
- Source of truth: `VERSION` file at repo root.
- Synced automatically with `package.json:version`.
- Commands:
  - Show: `npm run version` (or `node bin/version.js --json`)
  - Bump: `npm run version:bump:patch` (or `:minor`, `:major`)
  - Set explicit: `npm run version:set -- 1.2.3`
- Library: `libs/version/index.js` exports `version`, `readVersion()`, `setVersion(v)`, `bump(kind)`.
- Tests: `npm run test:version`.

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
  - Models: `npm run test:model`
  - App bootstrap (dev banner + migrations): `npm run test:app`

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
