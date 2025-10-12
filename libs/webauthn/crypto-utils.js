import { createVerify, createHash } from 'node:crypto';

export function sha256(data) {
  return createHash('sha256').update(data).digest();
}

export function verifySignature(alg, publicKeyPem, data, signature) {
  // WebAuthn uses DER encoded ECDSA signatures; Node handles both RSA/ECDSA under SHA256
  const verifier = createVerify('SHA256');
  verifier.update(data);
  verifier.end();
  return verifier.verify(publicKeyPem, signature);
}
