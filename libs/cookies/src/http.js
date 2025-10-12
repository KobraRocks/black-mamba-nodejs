import { parseCookieHeader } from './parse.js';
import { serializeSetCookie } from './serialize.js';

export function readCookies(req) {
  const header = req && req.headers ? (req.headers['cookie'] || req.headers['Cookie']) : '';
  return parseCookieHeader(header || '');
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

