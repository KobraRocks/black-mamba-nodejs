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

