Here’s a clean, production-minded spec (with reference implementation stubs) for a **Node.js magic links library** that uses **ESM**, **no external libraries**, and **no TypeScript**.

# Goals

* Generate signed, tamper-evident “magic link” tokens for passwordless login and similar flows.
* Stateless by default (self-contained token), with optional stateful replay protection (one-time use).
* Key rotation and deterministic, URL-safe encoding.
* Minimal, dependency-free Node.js (built-ins only).

# Non-Goals

* Full user management, email delivery, or rate limiting.
* OAuth/OIDC semantics (can be layered on top later).

# Threat Model & Security Requirements

* **Integrity:** Token must be unforgeable (HMAC over header+payload).
* **Expiry:** Short TTLs; configurable leeway for clock skew.
* **Replay:** Optional one-time use via pluggable store (recommended for login).
* **Audience/Origin binding:** Optional `aud` and `iss` claims and/or `origin` binding.
* **Key rotation:** Support multiple active keys (kid).
* **Phishing surface:** Links should be origin-locked and short-lived.
* **Transport:** Always deliver over HTTPS and validate scheme/host when consuming.
* **Scope control:** `purpose` claim (e.g., `"login"`, `"email-verify"`) checked by verifier.

# Token Format

* Compact, URL-safe: `base64url(header).base64url(payload).base64url(signature)`
* `header` (JSON): `{ "alg": "HS256", "typ": "ML", "kid": "key-id-optional" }`
* `payload` (JSON, required fields):

  * `sub`: subject (user id/email)
  * `exp`: unix seconds expiry
  * `iat`: issued-at unix seconds
  * `jti`: nonce/unique id
  * `purpose`: narrowing intent string
  * Optional: `aud`, `iss`, `origin`, `meta` (small JSON object)
* `signature`: HMAC-SHA256 over `base64url(header) + "." + base64url(payload)`

# Public API (ESM)

```js
// src/index.js
export {
  createMagicLink,          // (claims, opts) -> { token, url }
  verifyMagicLink,          // (token, opts) -> { valid, claims, reason? }
  consumeMagicLink,         // (token, opts) -> { valid, claims, reason? } + one-time use
  rotateKeyMaterial,        // (keystore, newKey) -> void
  memoryStore,              // in-memory one-time-use store adapter
  signToken, verifyToken,   // low-level token helpers (stateless)
  buildLink, parseToken,    // helpers
};
```

### Types (informal)

* `claims`: `{ sub, purpose, ttlSec?, aud?, iss?, origin?, meta? }`
* `opts` (for creation):

  * `baseUrl` (required for createMagicLink) – e.g. `"https://app.example.com/magic"`
  * `param` (default `"token"`) – query key to hold token
  * `ttlSec` (default `600`)
  * `skewSec` (default `60`)
  * `keystore`: `{ current: { kid, key }, old?: [{ kid, key }, ...] }`
  * `store` (optional): store adapter for one-time use
  * `aud`, `iss`, `origin` (optional)
* `opts` (for verification/consumption):

  * `expected`: `{ purpose, aud?, iss?, origin? }`
  * `skewSec` (default `60`)
  * `keystore` (same as above)
  * `store` (for `consumeMagicLink`)

# File Layout

```
/magic-links/
  src/
    index.js
    token.js          // sign/verify, parse, claims validation
    crypto.js         // HMAC, constant-time compare, random bytes
    base64url.js      // URL-safe base64 (no padding)
    link.js           // buildLink, parseQuery
    store/
      memory.js       // in-memory one-time-use
  examples/
    expressless-server.mjs // tiny http server demo (no deps)
  test/
    token.test.mjs
    e2e.test.mjs
  package.json
  README.md
```

# Keystore Model (Rotation)

* `keystore.current = { kid: "v2-2025-10-01", key: <Buffer> }`
* `keystore.old = [{ kid: "v1-2025-07-01", key: <Buffer> }, ...]`
* Signing uses `current`.
* Verification tries `current` then `old` by `kid` (if present) or brute-tries all if no `kid`.

# Store Adapter Interface (One-Time Use)

```js
// Must be synchronous or Promise-based, both supported.
{
  markUsed: async (jti, exp) => boolean, // returns true if marked (and not previously used)
  isUsed: async (jti) => boolean
}
```

* `memoryStore()` provided for dev/testing; production should supply Redis/DB adapter with same shape.

# Reference Implementation (stubs you can use as-is)

```js
// src/base64url.js
export function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export function b64urlDecode(str) {
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}
```

```js
// src/crypto.js
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function hmacSha256(keyBuf, dataBuf) {
  return createHmac('sha256', keyBuf).update(dataBuf).digest();
}
export function ctEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
export function randomId(bytes = 16) {
  return randomBytes(bytes);
}
export function unixNow() { return Math.floor(Date.now() / 1000); }
```

```js
// src/token.js
import { b64urlEncode, b64urlDecode } from './base64url.js';
import { hmacSha256, ctEqual, unixNow, randomId } from './crypto.js';

function encodePart(obj) { return b64urlEncode(Buffer.from(JSON.stringify(obj))); }
function signRaw(keyBuf, headerB64, payloadB64) {
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  return b64urlEncode(hmacSha256(keyBuf, data));
}

export function signToken(claims, { keystore, ttlSec = 600, aud, iss, origin } = {}) {
  if (!keystore?.current?.key) throw new Error('keystore.current.key required');
  const iat = unixNow();
  const exp = iat + (claims.ttlSec ?? ttlSec);
  const jti = claims.jti || b64urlEncode(randomId(16));
  const header = { alg: 'HS256', typ: 'ML', kid: keystore.current.kid };
  const payload = {
    sub: claims.sub, purpose: claims.purpose,
    iat, exp, jti,
    ...(aud ? { aud } : {}), ...(iss ? { iss } : {}), ...(origin ? { origin } : {}),
    ...(claims.aud ? { aud: claims.aud } : {}),
    ...(claims.iss ? { iss: claims.iss } : {}),
    ...(claims.origin ? { origin: claims.origin } : {}),
    ...(claims.meta ? { meta: claims.meta } : {}),
  };
  ['sub','purpose'].forEach(k => { if (!payload[k]) throw new Error(`claim ${k} required`); });
  const hB64 = encodePart(header);
  const pB64 = encodePart(payload);
  const sB64 = signRaw(keystore.current.key, hB64, pB64);
  return `${hB64}.${pB64}.${sB64}`;
}

function findKeyFor(header, keystore) {
  if (!keystore) return null;
  const candidates = [];
  if (header.kid && keystore.current?.kid === header.kid) candidates.push(keystore.current.key);
  if (header.kid && keystore.old) {
    const match = keystore.old.find(k => k.kid === header.kid);
    if (match) candidates.push(match.key);
  }
  if (!header.kid) {
    if (keystore.current?.key) candidates.push(keystore.current.key);
    if (keystore.old) candidates.push(...keystore.old.map(k => k.key));
  }
  return candidates;
}

export function parseToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token format');
  const header = JSON.parse(b64urlDecode(parts[0]));
  const payload = JSON.parse(b64urlDecode(parts[1]));
  const sig = parts[2];
  return { header, payload, sig, rawHeader: parts[0], rawPayload: parts[1] };
}

export function verifyToken(token, { keystore, expected = {}, skewSec = 60 } = {}) {
  try {
    const { header, payload, sig, rawHeader, rawPayload } = parseToken(token);
    const keys = findKeyFor(header, keystore) || [];
    let matched = false;
    for (const key of keys) {
      const want = b64urlEncode(hmacSha256(key, Buffer.from(`${rawHeader}.${rawPayload}`)));
      if (ctEqual(Buffer.from(want), Buffer.from(sig))) { matched = true; break; }
    }
    if (!matched) return { valid: false, reason: 'bad-signature' };

    const now = unixNow();
    if ((payload.iat || 0) > now + skewSec) return { valid: false, reason: 'iat-in-future' };
    if ((payload.exp || 0) < now - skewSec) return { valid: false, reason: 'expired' };

    if (expected.purpose && payload.purpose !== expected.purpose) return { valid: false, reason: 'wrong-purpose' };
    if (expected.aud && payload.aud !== expected.aud) return { valid: false, reason: 'wrong-aud' };
    if (expected.iss && payload.iss !== expected.iss) return { valid: false, reason: 'wrong-iss' };
    if (expected.origin && payload.origin !== expected.origin) return { valid: false, reason: 'wrong-origin' };

    return { valid: true, claims: payload, header };
  } catch (e) {
    return { valid: false, reason: 'malformed' };
  }
}
```

```js
// src/store/memory.js
export function memoryStore() {
  const used = new Map(); // jti -> exp
  return {
    async markUsed(jti, exp) {
      if (used.has(jti)) return false;
      used.set(jti, exp);
      // GC occasionally
      if (used.size % 100 === 0) {
        const now = Math.floor(Date.now()/1000);
        for (const [k,v] of used.entries()) if (v < now) used.delete(k);
      }
      return true;
    },
    async isUsed(jti) { return used.has(jti); }
  };
}
```

```js
// src/link.js
import { URL } from 'node:url';

export function buildLink(baseUrl, token, param = 'token') {
  const u = new URL(baseUrl);
  u.searchParams.set(param, token);
  return u.toString();
}
export function extractTokenFromUrl(url, param = 'token') {
  const u = new URL(url);
  return u.searchParams.get(param);
}
```

```js
// src/index.js
import { signToken, verifyToken } from './token.js';
import { buildLink, extractTokenFromUrl } from './link.js';
import { memoryStore } from './store/memory.js';

export { signToken, verifyToken, buildLink, extractTokenFromUrl, memoryStore };

export function createMagicLink(claims, { baseUrl, param='token', ...opts } = {}) {
  if (!baseUrl) throw new Error('baseUrl required');
  const token = signToken(claims, opts);
  const url = buildLink(baseUrl, token, param);
  return { token, url };
}

export async function verifyMagicLink(token, { expected = {}, ...opts } = {}) {
  return verifyToken(token, { expected, ...opts });
}

export async function consumeMagicLink(token, { expected = {}, store, ...opts } = {}) {
  const res = verifyToken(token, { expected, ...opts });
  if (!res.valid) return res;
  if (!store) return res; // stateless accept
  const ok = await store.markUsed(res.claims.jti, res.claims.exp);
  if (!ok) return { valid: false, reason: 'replay' };
  return res;
}

export function rotateKeyMaterial(keystore, newKey) {
  if (!keystore || !newKey?.kid || !newKey?.key) throw new Error('newKey {kid,key} required');
  keystore.old = [ ...(keystore.old || []), keystore.current ].filter(Boolean);
  keystore.current = newKey;
}
```

# Example Usage (no frameworks)

```js
// examples/expressless-server.mjs
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  createMagicLink, consumeMagicLink, memoryStore
} from '../src/index.js';

const keystore = {
  current: { kid: 'v1', key: randomBytes(32) },
  old: []
};
const store = memoryStore(); // one-time use

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname === '/issue') {
    const email = url.searchParams.get('email');
    const { url: magic } = createMagicLink(
      { sub: email, purpose: 'login', meta: { ip: req.socket.remoteAddress } },
      {
        baseUrl: 'http://localhost:3000/callback',
        ttlSec: 600,
        keystore,
        iss: 'example-app',
        aud: 'example-web'
      }
    );
    // Pretend we emailed `magic`
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Magic link: ${magic}\n`);
    return;
  }
  if (url.pathname === '/callback') {
    const token = url.searchParams.get('token');
    const result = await consumeMagicLink(token, {
      expected: { purpose: 'login', iss: 'example-app', aud: 'example-web' },
      keystore,
      store
    });
    res.writeHead(result.valid ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(404).end('not found');
});
server.listen(3000, () => console.log('http://localhost:3000'));
```

# Configuration Guidance

* **TTL:** 5–10 minutes for login; shorter for high-risk contexts.
* **Skew:** 30–90 seconds.
* **Purpose:** Use distinct values per flow (`"login"`, `"link-device"`, `"verify-email"`).
* **Audience/Issuer:** Bind to your app identifiers.
* **Origin:** When opening links in the same app, add `origin` and check it on verification.
* **Single-use:** **Strongly** recommended for login (enable `store`).

# Edge Cases & Errors

* `malformed`: token not parseable or wrong segment count.
* `bad-signature`: signature mismatch.
* `iat-in-future`: defensive clock drift check.
* `expired`: TTL exceeded (with skew).
* `wrong-*`: audience/issuer/origin/purpose mismatch.
* `replay`: already used `jti` with a stateful store.

# Testing Plan (built-ins only)

* Unit tests in `test/*.mjs` using `node:test` and `node:assert`:

  * Signs/verifies with current key.
  * Verifies with old key (kid match).
  * Expiry/iat/skew boundaries.
  * Purpose/aud/iss/origin enforcement.
  * Replay detection with `memoryStore`.
* E2E: spin `examples/expressless-server.mjs`, fetch `/issue`, then call `/callback` twice (second returns `replay`).

# Performance

* HMAC-SHA256 on small payloads; negligible overhead even under heavy auth load.
* Memory store is O(1); implement LRU/TTL cleanup in production store.

# Operational Notes

* **Key storage:** Load from env/secret manager as raw 32-byte values (base64-decode if stored as text).
* **Rotation:** Call `rotateKeyMaterial(keystore, { kid, key })` deploy-side; keep at least 1–2 prior keys for overlap.
* **Delivery:** Build links with your public HTTPS origin; never include tokens in logs or analytics.
* **Observability:** Log only `kid`, `jti` hash (not full), reason codes on failure.

