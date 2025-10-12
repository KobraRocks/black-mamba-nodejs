import { newId } from './id.js';
import { hmacSign, hmacVerify, seal, unseal } from './crypto.js';
import { bakeCookie } from './cookie.js';
import { MemoryStore } from './store/memory.js';
import { SQLiteStore } from './store/sqlite.js';
import { readCookies } from '../cookies/index.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

export function createSession(opts = {}) {
  const {
    name = 'bm.sid',
    secret,
    ttl = 60 * 60 * 24 * 7,
    rolling = true,
    path = '/',
    domain,
    secure = true,
    sameSite = 'Lax',
    httpOnly = true,
    // default to SQLite-backed store for persistence
    store = SQLiteStore(process.env.BM_SESSION_DB || 'sessions.db'),
    seal: doSeal = false
  } = opts;

  assert(secret && String(secret).length >= 16, '[session] "secret" required (>=16 chars)');

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
    const cookies = request.cookies || readCookies({ headers: request.headers || {} });
    const rawCookie = cookies && cookies[name] || null;
    let sid = parseCookie(rawCookie);
    const isAnonymous = !sid; // required by user instruction
    let isNew = false;

    if (!sid) { sid = newId(); isNew = true; }

    const now = Date.now();
    const expMs = now + ttl * 1000;

    let record = await store.get(sid);
    if (!record || (record.exp && record.exp <= now)) {
      record = { data: {}, exp: expMs, tmp: {} };
      await store.set(sid, record);
      isNew = true;
    }

    for (const [k, v] of Object.entries(record.tmp || {})) {
      if (v && v.exp && v.exp <= now) delete record.tmp[k];
    }

    const api = {
      id: sid,
      isNew,
      is_anonymous: isAnonymous,
      get(key) { return record.data[key]; },
      set(key, val) { record.data[key] = val; },
      unset(key) { delete record.data[key]; },
      all() { return { ...record.data }; },
      flash(key, val) {
        if (arguments.length === 2) {
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
      // Leverage response.header to set Set-Cookie. If multiple cookies
      // are needed, higher-level helpers should push arrays.
      response.header('Set-Cookie', header);
    }
    function clearCookie() {
      const header = bakeCookie(name, '', {
        path, domain, secure, sameSite, httpOnly,
        maxAge: 0, expires: new Date(0)
      });
      response.header('Set-Cookie', header);
    }

    if (doSeal) {
      const sealed = seal(record.data, secret);
      record.data = { __sealed: sealed };
    } else if (record.data && record.data.__sealed) {
      const un = unseal(record.data.__sealed, secret);
      record.data = un || {};
    }

    request.session = api;
    if (rolling && !isAnonymous) {
      // Refresh cookie on each request for authenticated sessions
      setCookie();
    }
  }

  return { attach };
}

export { MemoryStore } from './store/memory.js';
export { SQLiteStore } from './store/sqlite.js';
