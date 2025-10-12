import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function hmacSha256(keyBuf, dataBuf) {
  return createHmac('sha256', keyBuf).update(dataBuf).digest();
}
export function ctEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
export function randomId(bytes = 16) {
  return randomBytes(bytes);
}
export function unixNow() { return Math.floor(Date.now() / 1000); }

