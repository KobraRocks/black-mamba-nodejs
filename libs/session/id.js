import crypto from 'node:crypto';

export function newId(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

