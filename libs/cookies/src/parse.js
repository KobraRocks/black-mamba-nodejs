function pctDecode(str) {
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
  const pairs = String(header).split(';');
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
    const [kRaw, ...rest] = s.split('=');
    const k = kRaw.trim().toLowerCase();
    const v = rest.length === 0 ? '' : rest.join('=').trim();
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
      default: break;
    }
  }
  return cookie;
}

export { pctDecode };

