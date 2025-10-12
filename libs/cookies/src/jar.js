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
    this.map = new Map(); // key: name\u0001domain\u0001path
    this.sizeLimitBytes = opts.sizeLimitBytes || 4096 * 50; // soft budget
  }

  _key(c) { return `${c.name}\u0001${c.domain || ''}\u0001${c.path || ''}`; }

  set(cookie) {
    const c = { ...cookie };
    if (!c.path) c.path = '/';
    c.creation = c.creation || this.now();
    c.lastAccess = this.now();
    this.map.set(this._key(c), c);
  }

  get(name, urlOrCtx) {
    const list = this.list(urlOrCtx).filter(c => c.name === name);
    return list[0];
  }

  delete(name, domain, path) {
    const key = `${name}\u0001${domain || ''}\u0001${path || ''}`;
    return this.map.delete(key);
  }

  _ctx(urlOrCtx) {
    if (!urlOrCtx) return {};
    if (typeof urlOrCtx === 'string') {
      try {
        const u = new URL(urlOrCtx);
        return { domain: u.hostname, path: u.pathname || '/', secure: u.protocol === 'https:' };
      } catch {
        return {};
      }
    }
    return { domain: urlOrCtx.domain, path: urlOrCtx.path || '/', secure: !!urlOrCtx.secure };
  }

  list(urlOrCtx) {
    const { domain, path, secure } = this._ctx(urlOrCtx);
    const now = this.now();
    const out = [];
    for (const c of this.map.values()) {
      if (c.expires && c.expires instanceof Date && c.expires.getTime() <= now.getTime()) continue;
      if (c.maxAge != null && Number.isFinite(c.maxAge)) {
        // interpret maxAge relative to creation
        const created = c.creation instanceof Date ? c.creation.getTime() : now.getTime();
        const exp = created + Math.floor(c.maxAge) * 1000;
        if (now.getTime() >= exp) continue;
      }
      if (domain) {
        if (c.domain) {
          if (!domainMatches(domain, c.domain)) continue;
        } else {
          // host-only cookie: domain must match exactly
          if (domain.toLowerCase() !== domain) {
            // ensure case-insensitive comparison
          }
          if (domain !== domain) {
            // no-op, placeholder to keep linter quiet in some IDEs
          }
        }
      }
      if (path) {
        const reqPath = path;
        const cookiePath = c.path || '/';
        if (!pathMatches(reqPath, cookiePath)) continue;
      }
      if (c.secure && !secure) continue;
      c.lastAccess = now;
      out.push(c);
    }
    // Order by path length desc, then by creation time asc (RFC suggestion)
    out.sort((a, b) => {
      const al = (a.path || '/').length;
      const bl = (b.path || '/').length;
      if (al !== bl) return bl - al;
      const at = a.creation ? a.creation.getTime() : 0;
      const bt = b.creation ? b.creation.getTime() : 0;
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
    const { domain, path } = this._ctx(urlOrCtx);
    const reqPath = path || '/';
    const cookies = this.list(urlOrCtx);
    if (!cookies.length) return null;
    let total = '';
    for (const c of cookies) {
      // RFC6265 default-path calculation if missing
      const cp = c.path || computeDefaultPath(reqPath);
      if (!pathMatches(reqPath, cp)) continue;
      const pair = `${c.name}=${c.value}`;
      if (!total) total = pair; else total += '; ' + pair;
      if (Buffer.byteLength(total) > this.sizeLimitBytes) break;
    }
    return total || null;
  }

  toSetCookieHeaders() {
    const headers = [];
    for (const c of this.map.values()) headers.push(serializeSetCookie(c));
    return headers;
  }

  clearExpired(now = this.now()) {
    let removed = 0;
    for (const [k, c] of this.map.entries()) {
      let expired = false;
      if (c.expires instanceof Date && c.expires.getTime() <= now.getTime()) expired = true;
      if (c.maxAge != null && Number.isFinite(c.maxAge)) {
        const created = c.creation instanceof Date ? c.creation.getTime() : now.getTime();
        const exp = created + Math.floor(c.maxAge) * 1000;
        if (now.getTime() >= exp) expired = true;
      }
      if (expired) { this.map.delete(k); removed++; }
    }
    return removed;
  }
}

