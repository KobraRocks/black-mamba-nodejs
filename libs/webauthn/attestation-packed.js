import { verifySignature } from './crypto-utils.js';

export async function verifyPacked(attStmt, authData, clientDataHash, publicKeyPem) {
  const sig = attStmt.sig;
  const data = Buffer.concat([authData, clientDataHash]);
  return verifySignature('ES256', publicKeyPem, data, sig);
}
