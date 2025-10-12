import crypto from 'node:crypto';

export function hmacSign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function hmacVerify(value, sig, secret) {
  const expected = hmacSign(value, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function seal(obj, secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function unseal(blob, secret) {
  const [ivB64, encB64, tagB64] = String(blob || '').split('.');
  if (!ivB64 || !encB64 || !tagB64) return null;
  const iv = Buffer.from(ivB64, 'base64url');
  const enc = Buffer.from(encB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

