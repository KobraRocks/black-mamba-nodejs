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
    deviceName = 'bm.did',
    secret,
    ttl = 60 * 60 * 24 * 7,
    deviceTtl = 60 * 60 * 24 * 365, // 1 year
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
    const rawSessionCookie = cookies && cookies[name] || null;
    const rawDeviceCookie = cookies && cookies[deviceName] || null;
    let sid = parseCookie(rawSessionCookie);
    let did = parseCookie(rawDeviceCookie);
    const isAnonymous = !rawSessionCookie; // if no session token provided by client
    let isNew = false;

    if (!sid) { sid = newId(); isNew = true; }
    let deviceNew = false;
    if (!did) { did = newId(); deviceNew = true; }

    const now = Date.now();
    const expMs = now + ttl * 1000;

    let record = await store.get(sid);
    if (!record || (record.exp && record.exp <= now)) {
      record = { data: {}, exp: expMs, tmp: {}, device_id: did };
      await store.set(sid, record);
      isNew = true;
    }

    for (const [k, v] of Object.entries(record.tmp || {})) {
      if (v && v.exp && v.exp <= now) delete record.tmp[k];
    }

    const api = {
      id: sid,
      isNew,
      device_id: did,
      is_anonymous: isAnonymous,
      get(key) { return record.data[key]; },
      set(key, val) { record.data[key] = val; },
      unset(key) { delete record.data[key]; },
      all() { return { ...record.data }; },
      setUser(userId) { record.user_id = userId; },
      getUserId() { return record.user_id ?? null; },
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
      // Accumulate multiple cookies on the response object
      const list = response._setCookies || (response._setCookies = []);
      list.push(header);
      response.header('Set-Cookie', list.join(', '));
      if (deviceNew) {
        const dval = cookieValue(did);
        const dHeader = bakeCookie(deviceName, dval, {
          path, domain, secure, sameSite, httpOnly,
          maxAge: deviceTtl, expires: new Date(now + deviceTtl * 1000)
        });
        list.push(dHeader);
        response.header('Set-Cookie', list.join(', '));
      }
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
