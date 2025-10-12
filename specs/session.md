# Goals

* Simple, fast, minimal API.
* Cookie-backed session identifier (opaque, signed, optionally encrypted) + pluggable stores.
* Safe defaults: `HttpOnly`, `Secure` (behind TLS), `SameSite=Lax`, rolling expiration.
* Zero external deps; only Node built-ins.
* Works with existing cookie util (`libs/cookies`) and `app.js` request/response abstractions.
* Explicit helpers for WebAuthn and Magic Links (temporary values & one-time tokens).

# Module layout

```
libs/
  session/
    index.js               # public API (createSession, attachSession, middleware-ish glue)
    crypto.js              # sign/verify, seal/unseal helpers using node:crypto
    cookie.js              # cookie key, serializer, and Set-Cookie helpers
    id.js                  # random id generator
    store/
      memory.js            # in-memory store (default)
      file.js              # optional: simple file store (JSONL)
    types.d.mjs            # (doc-only, no TS types; comments inside code)
```

> You already have `libs/cookies/index.js` for parsing. We’ll reuse that for incoming cookies and keep **Set-Cookie** logic local to the session lib to keep concerns tidy.

# Public API (runtime)

```js
// libs/session/index.js
export function createSession(options?) -> { attach(request, response): Promise<void> }
export function MemoryStore() -> Store
export function FileStore(dirPath) -> Store

// request.session shape (added by attach):
{
  id: string,                  // stable opaque id
  isNew: boolean,
  get(key): any,
  set(key, value): void,
  unset(key): void,
  all(): Record<string, any>,
  save(): Promise<void>,       // persists and refreshes cookie (rolling)
  regenerate(): Promise<void>, // rotates id, preserves data
  destroy(): Promise<void>,    // deletes data and cookie
  touch(): Promise<void>,      // refresh TTL without writing body
  // helpers for flows:
  flash(key, value?) -> value, // get-and-delete or set
  temp(key, value?, ttlSec?)   // ephemeral kv, auto-expire within the session
}
```

# Configuration

```js
const session = createSession({
  name: 'bm.sid',                  // cookie name
  secret: process.env.SESSION_SECRET, // required HMAC key; 32+ bytes
  ttl: 60 * 60 * 24 * 7,          // 7d TTL
  rolling: true,                  // refresh expiry on each response
  secure: true,                   // Secure cookie (enable in prod/TLS)
  sameSite: 'Lax',                // 'Lax' | 'Strict' | 'None'
  path: '/',                      // cookie path
  domain: undefined,              // optional domain
  store: MemoryStore(),           // pluggable store
  // crypto options:
  seal: false,                    // if true, encrypts session payload at rest in store
});
```

# WebAuthn & Magic Links integration (usage patterns)

* **WebAuthn**: store challenge & rpId per session.

  ```js
  request.session.set('webauthn', { challenge, rpId, createdAt: Date.now() });
  await request.session.save();
  ```
* **Verify**: consume once.

  ```js
  const { challenge } = request.session.flash('webauthn');
  ```
* **Magic Links**: store transient link state or CSRF token while initiating.

  ```js
  request.session.set('magic', { email, nonce });
  await request.session.save();
  // On callback:
  const { email, nonce } = request.session.flash('magic');
  ```
* **One-time tokens within session** (server-generated):

  ```js
  request.session.temp('otp', otp, 300); // 5 min
  const otp = request.session.temp('otp'); // read & renew TTL quietly
  ```

# Implementation

## 1) `libs/session/id.js`

```js
// ESM
import crypto from 'node:crypto';

export function newId(bytes = 18) {
  // ~24 char url-safe base64 without padding
  return crypto.randomBytes(bytes).toString('base64url');
}
```

## 2) `libs/session/crypto.js`

```js
import crypto from 'node:crypto';

export function hmacSign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function hmacVerify(value, sig, secret) {
  const expected = hmacSign(value, secret);
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Optional sealing: AES-256-GCM on JSON payload
export function seal(obj, secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function unseal(blob, secret) {
  const [ivB64, encB64, tagB64] = String(blob || '').split('.');
  if (!ivB64 || !encB64 || !tagB64) return null;
  const iv = Buffer.from(ivB64, 'base64url');
  const enc = Buffer.from(encB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}
```

## 3) `libs/session/cookie.js`

```js
const attr = (k, v) => v === true ? k : v === false || v == null ? '' : `${k}=${v}`;

export function bakeCookie(name, value, {
  path = '/', domain, httpOnly = true, secure = true, sameSite = 'Lax',
  maxAge, expires
} = {}) {
  const parts = [`${name}=${value}`];
  if (path) parts.push(attr('Path', path));
  if (domain) parts.push(attr('Domain', domain));
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (sameSite) parts.push(attr('SameSite', sameSite));
  if (typeof maxAge === 'number') parts.push(attr('Max-Age', maxAge|0));
  if (expires instanceof Date) parts.push(attr('Expires', expires.toUTCString()));
  return parts.filter(Boolean).join('; ');
}
```

## 4) Stores

### `libs/session/store/memory.js`

```js
export function MemoryStore() {
  // key -> { data, exp, tmp: {k: {v, exp}} }
  const map = new Map();

  function now() { return Date.now(); }
  function gc() {
    const t = now();
    for (const [k, v] of map) if (v.exp && v.exp <= t) map.delete(k);
  }

  return {
    async get(id) { gc(); return map.get(id) || null; },
    async set(id, record) { map.set(id, record); },
    async destroy(id) { map.delete(id); },
    async touch(id, newExp) {
      const rec = map.get(id); if (!rec) return;
      rec.exp = newExp; map.set(id, rec);
    }
  };
}
```

### (Optional) `libs/session/store/file.js`

```js
import fs from 'node:fs';
import path from 'node:path';

export function FileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = id => path.join(dir, `${id}.json`);

  return {
    async get(id) {
      try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); }
      catch { return null; }
    },
    async set(id, rec) { fs.writeFileSync(file(id), JSON.stringify(rec)); },
    async destroy(id) { try { fs.unlinkSync(file(id)); } catch {} },
    async touch(id, exp) {
      const rec = await this.get(id); if (!rec) return;
      rec.exp = exp; await this.set(id, rec);
    }
  };
}
```

## 5) `libs/session/index.js`

```js
import { newId } from './id.js';
import { hmacSign, hmacVerify, seal, unseal } from './crypto.js';
import { bakeCookie } from './cookie.js';
import { MemoryStore } from './store/memory.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

export function createSession(opts = {}) {
  const {
    name = 'bm.sid',
    secret,
    ttl = 60 * 60 * 24 * 7, // seconds
    rolling = true,
    path = '/',
    domain,
    secure = true,
    sameSite = 'Lax',
    httpOnly = true,
    store = MemoryStore(),
    seal: doSeal = false
  } = opts;

  assert(secret && secret.length >= 16, '[session] "secret" required (>=16 chars)');

  function cookieValue(id) {
    const sig = hmacSign(id, secret);
    return `${id}.${sig}`;
  }
  function parseCookie(v) {
    if (!v) return null;
    const [id, sig] = String(v).split('.');
    if (!id || !sig) return null;
    if (!hmacVerify(id, sig, secret)) return null;
    return id;
  }

  async function attach(request, response) {
    // read incoming cookie
    const rawCookie = (request.cookies && request.cookies[name]) || null;
    let sid = parseCookie(rawCookie);
    let isNew = false;

    if (!sid) { sid = newId(); isNew = true; }

    const now = Date.now();
    const expMs = now + ttl * 1000;

    // load/create record
    let record = await store.get(sid);
    if (!record || (record.exp && record.exp <= now)) {
      record = { data: {}, exp: expMs, tmp: {} };
      await store.set(sid, record);
      isNew = true;
    }

    // compact ephemeral values
    for (const [k, v] of Object.entries(record.tmp || {})) {
      if (v && v.exp && v.exp <= now) delete record.tmp[k];
    }

    const api = {
      id: sid,
      isNew,
      get(key) { return record.data[key]; },
      set(key, val) { record.data[key] = val; },
      unset(key) { delete record.data[key]; },
      all() { return { ...record.data }; },
      flash(key, val) {
        if (arguments.length === 2) { // set
          const stash = record.data.__flash || (record.data.__flash = {});
          stash[key] = val; return val;
        }
        const stash = record.data.__flash || {};
        const v = stash[key]; delete stash[key];
        if (!Object.keys(stash).length) delete record.data.__flash;
        return v;
      },
      temp(key, val, ttlSec) {
        const tmp = record.tmp || (record.tmp = {});
        if (arguments.length >= 2) {
          tmp[key] = { v: val, exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined };
          return val;
        }
        const it = tmp[key];
        return it ? it.v : undefined;
      },
      async save() {
        record.exp = expMs;
        await store.set(sid, record);
        setCookie();
      },
      async touch() {
        await store.touch(sid, expMs);
        if (rolling) setCookie();
      },
      async regenerate() {
        const old = sid;
        sid = newId();
        record.exp = expMs;
        await store.set(sid, record);
        await store.destroy(old);
        setCookie();
        api.id = sid;
      },
      async destroy() {
        await store.destroy(sid);
        clearCookie();
      }
    };

    function setCookie() {
      const value = cookieValue(sid);
      const header = bakeCookie(name, value, {
        path, domain, secure, sameSite, httpOnly,
        maxAge: ttl, expires: new Date(expMs)
      });
      response.header('Set-Cookie', header);
    }
    function clearCookie() {
      const header = bakeCookie(name, '', {
        path, domain, secure, sameSite, httpOnly,
        maxAge: 0, expires: new Date(0)
      });
      response.header('Set-Cookie', header);
    }

    // Optional: encrypt data before storing (at-rest secrecy in store)
    if (doSeal) {
      const sealed = seal(record.data, secret);
      record.data = { __sealed: sealed };
    } else if (record.data && record.data.__sealed) {
      const un = unseal(record.data.__sealed, secret);
      record.data = un || {};
    }

    request.session = api;

    // rolling renewal (no body write)
    if (rolling) await api.touch();
  }

  return { attach, MemoryStore, FileStore: undefined };
}

export { MemoryStore } from './store/memory.js';
export { FileStore } from './store/file.js';
```

# Wire-up in `app.js`

Two minimal changes:

1. **Import the session lib**
2. **Attach session after we build `request` and `response` but before routing** so that controllers see `request.session`.

```diff
--- a/app.js
+++ b/app.js
@@
 import { readCookies } from './libs/cookies/index.js';
+import { createSession } from './libs/session/index.js';
@@
 function createRequest(req) {
   const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
   return {
     method: req.method,
     headers: req.headers,
     url,
     params: {},
     raw: req,
     cookies: readCookies(req),
+    // session will be injected in serve() before routing:
+    session: undefined,
     async body() {
       const chunks = [];
@@
 function serve(options = {}) {
@@
   const handler = async (req, res) => {
     const start = Date.now();
     const request = createRequest(req);
     const response = createResponse(req, res);
+    const session = createSession({
+      name: 'bm.sid',
+      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
+      ttl: 60 * 60 * 24 * 7,
+      rolling: true,
+      secure: process.env.NODE_ENV === 'production',
+      sameSite: 'Lax'
+    });
+    await session.attach(request, response);
 
     try {
       router.handle(request, response);
     } catch (err) {
```

This guarantees `request.session` exists for every route before the router handles it. 

# Controller usage examples

**Set & persist:**

```js
// controllers/sessions.js
export const SessionsController = new ApplicationController({
  resources: '/sessions',
  async create(req, res) {
    const { userId } = await req.body();
    req.session.set('uid', userId);
    await req.session.save();
    res.json({ ok: true });
  },
});
```

**Destroy (logout):**

```js
async destroy(req, res) {
  await req.session.destroy();
  res.status(204).send();
}
```

**WebAuthn challenge:**

```js
async beginWebAuthn(req, res) {
  const challenge = makeChallenge(); // your existing util
  req.session.set('webauthn', { challenge, rpId: 'example.com', t: Date.now() });
  await req.session.save();
  res.json({ challenge });
}

async finishWebAuthn(req, res) {
  const stash = req.session.flash('webauthn');
  // verify with libs/webauthn/... using stash.challenge
  res.json({ verified: true });
}
```

**Magic link handshake:**

```js
async sendMagic(req, res) {
  const { email } = await req.body();
  const nonce = crypto.randomUUID();
  req.session.set('magic', { email, nonce });
  await req.session.save();
  // build & email link containing nonce...
  res.json({ ok: true });
}

async magicCallback(req, res) {
  const { magic } = { magic: req.session.flash('magic') || {} };
  // compare nonce from URL vs magic.nonce, sign-in user identified by magic.email
  res.json({ ok: true });
}
```

# Security notes

* **Secret rotation**: support multiple secrets by letting `secret` accept an array `[current, ...old]`; verify against any, sign with first.
* **CSRF**: sessions don’t replace CSRF tokens; you can store a CSRF token in `session.temp('csrf', token, 3600)`.
* **Session fixation**: call `await request.session.regenerate()` right after login.
* **Cookie security**: set `secure: true` in production; if you must support cross-site (e.g., third-party auth UI), switch `sameSite: 'None'` and keep `secure: true`.

# Testing checklist

* Creates `request.session` for every request (even first visit).
* Persists values across requests; expires after TTL.
* Rolling sessions refresh `Max-Age`/`Expires` each hit.
* Regenerate rotates ID & keeps data.
* Destroy clears cookie and removes store entry.
* Flash/Temp semantics verified.
* Works under HTTP/2 path (your server supports both). 



