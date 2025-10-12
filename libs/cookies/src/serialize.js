// ESM
const TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function encodeValue(val) {
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
  if (String(name).startsWith('__Host-')) {
    if (!secure) throw new TypeError('__Host- cookies must be Secure');
    if (domain) throw new TypeError('__Host- cookies must not have Domain');
    if (path && path !== '/') throw new TypeError('__Host- cookies must have Path=/');
  }
  if (String(name).startsWith('__Secure-')) {
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
    parts.push(`Domain=${d}`);
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

