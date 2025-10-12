# `@acme/cookies` — ESM, zero‑dep cookie utilities for Node.js

> RFC 6265–aligned cookie parsing, serialization, signing, and an in‑memory Cookie Jar. **No external libraries**, **ESM only**, **no TypeScript**. Works with `http`/`http2`/`fetch`-like interfaces.

---

## Goals

* Parse request `Cookie` headers into a safe object representation.
* Serialize `Set-Cookie` headers with robust validation.
* Handle `Max-Age`, `Expires`, `Domain`, `Path`, `Secure`, `HttpOnly`, `SameSite` (`Strict`|`Lax`|`None`) and `Priority`.
* Support cookie name prefixes: `__Secure-` and `__Host-` with required invariants.
* Provide an in‑memory `CookieJar` with RFC‑style path/domain matching for request composition.
* Optional HMAC SHA‑256 signing + verification.
* Zero external deps; rely only on Node core (`node:crypto`).

## Non‑Goals

* Persistent storage (you can serialize the jar yourself).
* Public suffix list / eTLD+1 calculation.
* HTTP/2 HPACK details (we just return header strings/arrays).

---

## Package layout

```
./src/
  cookie.js           # Core Cookie object + helpers
  parse.js            # Parsers for Cookie / Set-Cookie headers
  serialize.js        # Serialization + validation
  sign.js             # HMAC signing/verification
  jar.js              # In-memory CookieJar with domain/path matching
  http.js             # Small helpers for Node's IncomingMessage/ServerResponse
index.js              # Public entry (ESM)
```

---

## Public API

### `Cookie` (plain object shape)

```js
{
  name: string,
  value: string,               // raw (after our decoding rules)
  expires?: Date | null,       // null = session cookie
  maxAge?: number | null,      // seconds
  domain?: string | null,
  path?: string | null,
  secure?: boolean,
  httpOnly?: boolean,
  sameSite?: 'Strict'|'Lax'|'None'|null,
  priority?: 'Low'|'Medium'|'High'|null,
  // metadata
  creation?: Date,             // set by library
  lastAccess?: Date            // set by jar
}
```

### Parse & serialize

* `parseCookieHeader(header: string): Record<string,string>` — Parse `Cookie` (request) header.
* `parseSetCookieHeader(line: string): Cookie` — Parse one `Set-Cookie` line into a Cookie object.
* `serializeSetCookie(cookie: Cookie): string` — Validate + serialize a cookie to one header line.

### Cookie signing (optional)

* `sign(value: string, secret: string | Buffer): string` — returns `value.s:<base64url(hmac)>`.
* `unsign(signed: string, secret: string | Buffer): {valid:boolean, value?:string}`.

### Cookie jar

```js
class CookieJar {
  constructor(options?: { now?: () => Date, sizeLimitBytes?: number })
  set(cookie: Cookie): void                    // add/replace
  get(name: string, urlOrCtx?: string|{domain?:string, path?:string, secure?:boolean}): Cookie|undefined
  delete(name: string, domain?: string, path?: string): boolean
  list(urlOrCtx?: string|{domain?:string, path?:string, secure?:boolean}): Cookie[]
  loadFromSetCookie(headers: string[]|string): void
  toRequestHeader(urlOrCtx?: string|{domain?:string, path?:string, secure?:boolean}): string|null
  toSetCookieHeaders(): string[]
  clearExpired(now?: Date): number
}
```

### HTTP helpers (Node friendly)

* `readCookies(req: IncomingMessage): Record<string,string>`
* `setCookie(res: ServerResponse, cookie: Cookie): void` (pushes to `Set-Cookie` without clobbering)
* `clearCookie(res: ServerResponse, name: string, opts: Partial<Cookie>): void` (sets expired cookie)

---

## Compliance & rules of note

* **Octets**: Name must be `token` (RFC6265), value is cookie-octet; we percent‑encode non‑allowed bytes when serializing; decoding reverses `%XX`.
* **Max-Age vs Expires**: `Max-Age` takes precedence when both present.
* **SameSite=None** requires `Secure`.
* **`__Host-`** requires `Secure`, no `Domain`, and `Path=/`.
* **`__Secure-`** requires `Secure`.
* **Domain match**: host-only when no Domain attribute; otherwise suffix‑match and not a public suffix (we **do not** check PSL — caller responsibility).
* **Path match** per RFC: default path is the path of the request up to the rightmost `/` (or `/`).

---

## Implementation (ESM)

### `src/serialize.js`

```js
// ESM
const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const OWS_RE = /^[\x20\t]*$/;

function isCtlOrSep(ch) {
  const code = ch.charCodeAt(0);
  return code <= 0x1F || code === 0x7F || ch === ';' || ch === ',';
}

function encodeValue(val) {
  // Encode non-cookie-octet and % itself
  let out = '';
  for (let i = 0; i < val.length; i++) {
    const c = val.charAt(i);
    const code = val.charCodeAt(i);
    if (
      code < 0x20 || code === 0x7F || c === ';' || c === ',' || c === '"' || c === '\\' || c === '%'
    ) {
      out += '%' + code.toString(16).toUpperCase().padStart(2, '0');
    } else {
      out += c;
    }
  }
  return out;
}

function assertValidName(name) {
  if (!name || !TOKEN_RE.test(name)) throw new TypeError('Invalid cookie name');
  if (/[=]/.test(name)) throw new TypeError('Cookie name must not contain =');
}

function validatePrefixInvariants({ name, secure, path, domain }) {
  if (name.startsWith('__Host-')) {
    if (!secure) throw new TypeError('__Host- cookies must be Secure');
    if (domain) throw new TypeError('__Host- cookies must not have Domain');
    if (path && path !== '/') throw new TypeError('__Host- cookies must have Path=/');
  }
  if (name.startsWith('__Secure-')) {
    if (!secure) throw new TypeError('__Secure- cookies must be Secure');
  }
}

export function serializeSetCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') throw new TypeError('cookie must be an object');
  const name = String(cookie.name);
  assertValidName(name);
  const value = encodeValue(String(cookie.value ?? ''));

  const parts = [`${name}=${value}`];

  let { maxAge, expires, domain, path, secure, httpOnly, sameSite, priority } = cookie;

  validatePrefixInvariants({ name, secure, path, domain });

  if (maxAge != null) {
    const n = Math.floor(Number(maxAge));
    if (!Number.isFinite(n)) throw new TypeError('Max-Age must be a number');
    parts.push(`Max-Age=${n}`);
  }
  if (expires instanceof Date) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }
  if (domain) {
    const d = String(domain).toLowerCase();
    if (d.startsWith('.')) parts.push(`Domain=${d}`); else parts.push(`Domain=${d}`);
  }
  if (path) {
    parts.push(`Path=${path}`);
  }
  if (secure) parts.push('Secure');
  if (httpOnly) parts.push('HttpOnly');
  if (sameSite) {
    const ss = String(sameSite);
    const norm = ss === 'strict' || ss === 'Strict' ? 'Strict'
      : ss === 'lax' || ss === 'Lax' ? 'Lax'
      : ss === 'none' || ss === 'None' ? 'None' : null;
    if (!norm) throw new TypeError('Invalid SameSite');
    if (norm === 'None' && !secure) throw new TypeError('SameSite=None requires Secure');
    parts.push(`SameSite=${norm}`);
  }
  if (priority) {
    const p = String(priority);
    const norm = p === 'low' || p === 'Low' ? 'Low' : p === 'high' || p === 'High' ? 'High' : p === 'medium' || p === 'Medium' ? 'Medium' : null;
    if (!norm) throw new TypeError('Invalid Priority');
    parts.push(`Priority=${norm}`);
  }
  return parts.join('; ');
}
```

### `src/parse.js`

```js
function pctDecode(str) {
  // safe percent-decoder (leaves malformed sequences as-is)
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '%' && i + 2 < str.length) {
      const hex = str.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

export function parseCookieHeader(header) {
  const out = Object.create(null);
  if (!header) return out;
  const pairs = header.split(';');
  for (let p of pairs) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    const name = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    if (!name) continue;
    if (out[name] !== undefined) continue; // first one wins
    out[name] = pctDecode(val.replace(/^"|"$/g, ''));
  }
  return out;
}

function parseDate(str) {
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function parseSetCookieHeader(line) {
  // returns Cookie object
  const parts = String(line).split(';');
  const [nameValue, ...attrs] = parts;
  const eq = nameValue.indexOf('=');
  if (eq < 1) throw new TypeError('Invalid Set-Cookie');
  const name = nameValue.slice(0, eq).trim();
  const value = pctDecode(nameValue.slice(eq + 1));

  const cookie = {
    name,
    value,
    expires: null,
    maxAge: null,
    domain: null,
    path: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    priority: null,
    creation: new Date(),
    lastAccess: new Date(),
  };

  for (let raw of attrs) {
    const s = raw.trim();
    if (!s) continue;
    const [kRaw, vRaw] = s.split('=');
    const k = kRaw.trim().toLowerCase();
    const v = vRaw === undefined ? '' : vRaw.trim();
    switch (k) {
      case 'expires': cookie.expires = parseDate(v); break;
      case 'max-age': cookie.maxAge = Number.parseInt(v, 10); break;
      case 'domain': cookie.domain = v.toLowerCase(); break;
      case 'path': cookie.path = v || '/'; break;
      case 'secure': cookie.secure = true; break;
      case 'httponly': cookie.httpOnly = true; break;
      case 'samesite': {
        const vv = v.toLowerCase();
        cookie.sameSite = vv === 'lax' ? 'Lax' : vv === 'strict' ? 'Strict' : vv === 'none' ? 'None' : null;
        break;
      }
      case 'priority': {
        const vv = v.toLowerCase();
        cookie.priority = vv === 'low' ? 'Low' : vv === 'high' ? 'High' : vv === 'medium' ? 'Medium' : null;
        break;
      }
      default: break; // ignore unknown attributes
    }
  }
  return cookie;
}
```

### `src/sign.js`

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

export function sign(value, secret) {
  const mac = createHmac('sha256', secret).update(String(value)).digest();
  return `${value}.s:${b64url(mac)}`;
}

export function unsign(signed, secret) {
  const idx = String(signed).lastIndexOf('.s:');
  if (idx === -1) return { valid: false };
  const value = signed.slice(0, idx);
  const sigB64 = signed.slice(idx + 3);
  const mac = createHmac('sha256', secret).update(value).digest();
  const theirs = Buffer.from(sigB64.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
  if (theirs.length !== mac.length) return { valid: false };
  const ok = timingSafeEqual(mac, theirs);
  return ok ? { valid: true, value } : { valid: false };
}
```

### `src/jar.js`

```js
import { serializeSetCookie } from './serialize.js';
import { parseSetCookieHeader } from './parse.js';

function domainMatches(requestHost, cookieDomain) {
  if (!cookieDomain) return false;
  const host = requestHost.toLowerCase();
  const cd = cookieDomain.startsWith('.') ? cookieDomain.slice(1).toLowerCase() : cookieDomain.toLowerCase();
  return host === cd || host.endsWith('.' + cd);
}

function pathMatches(requestPath, cookiePath) {
  const p = cookiePath || '/';
  if (requestPath === p) return true;
  if (requestPath.startsWith(p)) {
    if (p.endsWith('/')) return true;
    const nextChar = requestPath.charAt(p.length);
    return nextChar === '/' || nextChar === '';
  }
  return false;
}

function computeDefaultPath(reqPath) {
  if (!reqPath || reqPath[0] !== '/') return '/';
  if (reqPath === '/') return '/';
  const i = reqPath.lastIndexOf('/');
  return i <= 0 ? '/' : reqPath.slice(0, i);
}

export class CookieJar {
  constructor(opts = {}) {
    this.now = typeof opts.now === 'function' ? opts.now : () => new Date();
    this.map = new Map(); // key: name|domain|path
    this.sizeLimitBytes = opts.sizeLimitBytes || 4096 * 50; // soft budget for all cookies
  }

  _key(c) { return `${c.name}\u0001${c.domain || ''}\u0001${c.path || ''}`; }

  set(cookie) {
    // If Max-Age=0 or Expires in past, delete
    if ((cookie.maxAge != null && cookie.maxAge <= 0) || (cookie.expires && cookie.expires <= this.now())) {
      return this.delete(cookie.name, cookie.domain || undefined, cookie.path || undefined);
    }
    cookie.lastAccess = this.now();
    this.map.set(this._key(cookie), cookie);
  }

  get(name, urlOrCtx) {
    const list = this.list(urlOrCtx);
    return list.find(c => c.name === name);
  }

  delete(name, domain, path) {
    let removed = false;
    for (const [k, c] of this.map) {
      if (c.name === name && (domain == null || c.domain === domain) && (path == null || c.path === path)) {
        this.map.delete(k); removed = true;
      }
    }
    return removed;
  }

  list(urlOrCtx) {
    let host = '', path = '/', secure = false;
    if (typeof urlOrCtx === 'string') {
      const u = new URL(urlOrCtx, 'http://x');
      host = u.hostname; path = u.pathname || '/'; secure = (u.protocol === 'https:');
    } else if (urlOrCtx && typeof urlOrCtx === 'object') {
      host = urlOrCtx.domain || ''; path = urlOrCtx.path || '/'; secure = !!urlOrCtx.secure;
    }
    const now = this.now();
    const out = [];
    for (const c of this.map.values()) {
      if (c.expires && c.expires <= now) continue; // expired
      if (c.maxAge != null && c.creation instanceof Date) {
        const ageMs = (now - c.creation);
        if (ageMs / 1000 > c.maxAge) continue;
      }
      const hostOk = c.domain ? domainMatches(host, c.domain) : (host && true);
      const pathOk = pathMatches(path, c.path || '/');
      const secOk = c.secure ? secure : true;
      if (hostOk && pathOk && secOk) out.push(c);
    }
    // Sort by path length descending, then creation-time ascending per RFC
    out.sort((a,b) => {
      const al = (a.path||'/').length, bl = (b.path||'/').length;
      if (al !== bl) return bl - al;
      const at = a.creation?.getTime() || 0, bt = b.creation?.getTime() || 0;
      return at - bt;
    });
    return out;
  }

  loadFromSetCookie(headers) {
    const arr = Array.isArray(headers) ? headers : [headers];
    for (const line of arr) {
      const c = parseSetCookieHeader(line);
      this.set(c);
    }
  }

  toRequestHeader(urlOrCtx) {
    const cookies = this.list(urlOrCtx);
    if (!cookies.length) return null;
    const total = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    if (Buffer.byteLength(total) > this.sizeLimitBytes) return null; // drop if too big
    return total;
  }

  toSetCookieHeaders() {
    const out = [];
    for (const c of this.map.values()) {
      out.push(serializeSetCookie(c));
    }
    return out;
  }

  clearExpired(now = this.now()) {
    let n = 0;
    for (const [k,c] of this.map) {
      if ((c.expires && c.expires <= now) || (c.maxAge != null && c.creation instanceof Date && ((now - c.creation)/1000 > c.maxAge))) {
        this.map.delete(k); n++;
      }
    }
    return n;
  }
}
```

### `src/http.js`

```js
import { parseCookieHeader } from './parse.js';
import { serializeSetCookie } from './serialize.js';

export function readCookies(req) {
  const header = req.headers?.cookie || '';
  return parseCookieHeader(header);
}

function pushSetCookie(res, line) {
  const prev = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  if (!prev) {
    res.setHeader('Set-Cookie', line);
  } else if (Array.isArray(prev)) {
    res.setHeader('Set-Cookie', prev.concat(line));
  } else {
    res.setHeader('Set-Cookie', [prev, line]);
  }
}

export function setCookie(res, cookie) {
  const line = serializeSetCookie(cookie);
  pushSetCookie(res, line);
}

export function clearCookie(res, name, opts = {}) {
  const c = {
    name,
    value: '',
    path: opts.path || '/',
    domain: opts.domain || undefined,
    secure: !!opts.secure,
    httpOnly: !!opts.httpOnly,
    sameSite: opts.sameSite || null,
    expires: new Date(0),
    maxAge: 0,
  };
  const line = serializeSetCookie(c);
  pushSetCookie(res, line);
}
```

### `src/cookie.js`

```js
export { parseCookieHeader, parseSetCookieHeader } from './parse.js';
export { serializeSetCookie } from './serialize.js';
export { sign, unsign } from './sign.js';
export { CookieJar } from './jar.js';
export { readCookies, setCookie, clearCookie } from './http.js';
```

### `index.js`

```js
export * from './src/cookie.js';
```

---

## Usage examples

### With Node `http`

```js
import { createServer } from 'node:http';
import { readCookies, setCookie, clearCookie, sign, unsign } from '@acme/cookies';

createServer((req, res) => {
  const cookies = readCookies(req);
  const session = cookies.session;

  if (!session) {
    const val = sign('user123', process.env.COOKIE_SECRET);
    setCookie(res, { name: 'session', value: val, httpOnly: true, sameSite: 'Lax', secure: true, path: '/' });
    res.end('New session set');
    return;
  }
  const { valid, value } = unsign(session, process.env.COOKIE_SECRET);
  if (!valid) {
    clearCookie(res, 'session', { path: '/', secure: true, httpOnly: true });
    res.statusCode = 401; res.end('Invalid session'); return;
  }
  res.end('Hello ' + value);
}).listen(3000);
```

### Using the `CookieJar` for outbound requests

```js
import { CookieJar } from '@acme/cookies';
import { request } from 'node:https';

const jar = new CookieJar();

function fetchWithCookies(url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const h = jar.toRequestHeader(url);
    if (h) headers['cookie'] = h;
    const req = request(url, { headers }, (res) => {
      const setc = res.headers['set-cookie'];
      if (setc) jar.loadFromSetCookie(setc);
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.end();
  });
}
```

---

## Testing notes (manual)

* Fuzz parse `Cookie` with duplicated names; ensure first wins.
* Validate `SameSite=None` without `Secure` throws.
* Validate `__Host-`/`__Secure-` invariants.
* Confirm `Max-Age` precedence over `Expires` by setting both.
* Domain/path matching edge cases (e.g., `sub.example.com` vs `.example.com`).
* Size budgets: very long cookie sets drop from `toRequestHeader`.

---

## Security considerations

* Treat cookie values as opaque; avoid automatic JSON parsing.
* Use `HttpOnly` for session cookies; `Secure` on HTTPS; `SameSite=Lax` for default CSRF mitigation.
* Rotate `secret` for signing; signing ≠ encryption.

---

## License

MIT


