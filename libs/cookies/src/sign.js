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

