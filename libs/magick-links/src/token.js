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
  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
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
    if ((payload.exp || 0) <= now - skewSec) return { valid: false, reason: 'expired' };

    if (expected.purpose && payload.purpose !== expected.purpose) return { valid: false, reason: 'wrong-purpose' };
    if (expected.aud && payload.aud !== expected.aud) return { valid: false, reason: 'wrong-aud' };
    if (expected.iss && payload.iss !== expected.iss) return { valid: false, reason: 'wrong-iss' };
    if (expected.origin && payload.origin !== expected.origin) return { valid: false, reason: 'wrong-origin' };

    return { valid: true, claims: payload, header };
  } catch (e) {
    return { valid: false, reason: 'malformed' };
  }
}
