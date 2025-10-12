import { sha256, verifySignature } from './crypto-utils.js';
import { base64url } from './base64url.js';

export async function verifyAuthenticationResponse(rpId, origin, expectedChallenge, response, storedPublicKeyPem, prevSignCount) {
  const clientDataJSON = base64url.decode(response.response.clientDataJSON);
  const client = JSON.parse(clientDataJSON.toString('utf8'));

  if (client.challenge !== expectedChallenge) throw new Error('Challenge mismatch');
  if (client.origin !== origin) throw new Error('Origin mismatch');

  const authData = base64url.decode(response.response.authenticatorData);
  const signature = base64url.decode(response.response.signature);

  const rpIdHash = authData.subarray(0, 32);
  const expectedRpHash = sha256(Buffer.from(rpId));
  if (!rpIdHash.equals(expectedRpHash)) throw new Error('rpIdHash mismatch');

  const signCount = authData.readUInt32BE(33);
  if (typeof prevSignCount === 'number' && signCount <= prevSignCount) throw new Error('Sign counter not incremented');

  const clientHash = sha256(clientDataJSON);
  const data = Buffer.concat([authData, clientHash]);
  const ok = verifySignature('ES256', storedPublicKeyPem, data, signature);
  if (!ok) throw new Error('Invalid signature');

  return { ok: true, signCount };
}
