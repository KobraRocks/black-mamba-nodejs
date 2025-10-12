import { signToken, verifyToken } from './token.js';
import { buildLink, extractTokenFromUrl } from './link.js';
import { memoryStore } from './store/memory.js';

export { signToken, verifyToken, buildLink, extractTokenFromUrl, memoryStore };

export function createMagicLink(claims, { baseUrl, param='token', ...opts } = {}) {
  if (!baseUrl) throw new Error('baseUrl required');
  const token = signToken(claims, opts);
  const url = buildLink(baseUrl, token, param);
  return { token, url };
}

export async function verifyMagicLink(token, { expected = {}, ...opts } = {}) {
  return verifyToken(token, { expected, ...opts });
}

export async function consumeMagicLink(token, { expected = {}, store, ...opts } = {}) {
  const res = verifyToken(token, { expected, ...opts });
  if (!res.valid) return res;
  if (!store) return res; // stateless accept
  const ok = await store.markUsed(res.claims.jti, res.claims.exp);
  if (!ok) return { valid: false, reason: 'replay' };
  return res;
}

export function rotateKeyMaterial(keystore, newKey) {
  if (!keystore || !newKey?.kid || !newKey?.key) throw new Error('newKey {kid,key} required');
  keystore.old = [ ...(keystore.old || []), keystore.current ].filter(Boolean);
  keystore.current = newKey;
}

