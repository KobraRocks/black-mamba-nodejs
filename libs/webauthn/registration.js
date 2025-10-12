import { decodeCbor } from './cbor.js';
import { sha256 } from './crypto-utils.js';
import { coseToPem } from './cose.js';
import { verifyNone } from './attestation-none.js';
import { verifyPacked } from './attestation-packed.js';
import { base64url } from './base64url.js';

export async function verifyRegistrationResponse(rpId, origin, expectedChallenge, response) {
  const clientDataJSON = base64url.decode(response.response.clientDataJSON);
  const client = JSON.parse(clientDataJSON.toString('utf8'));
  if (client.challenge !== expectedChallenge) throw new Error('Challenge mismatch');
  if (client.origin !== origin) throw new Error('Origin mismatch');

  const attestationObject = base64url.decode(response.response.attestationObject);
  const att = decodeCbor(attestationObject);

  const authData = Buffer.from(att.authData);
  const fmt = att.fmt;
  const attStmt = att.attStmt || {};

  // rpIdHash (first 32 bytes)
  const expectedRpHash = sha256(Buffer.from(rpId));
  const rpIdHash = authData.subarray(0, 32);
  if (!rpIdHash.equals(expectedRpHash)) throw new Error('rpIdHash mismatch');

  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);

  // Attested credential data starts at 37
  const aaguid = authData.subarray(37, 53);
  const credIdLen = authData.readUInt16BE(53);
  const credId = authData.subarray(55, 55 + credIdLen);
  const coseKeyBytes = authData.subarray(55 + credIdLen);
  const coseKey = decodeCbor(coseKeyBytes);
  const publicKeyPem = coseToPem(coseKey);

  const clientHash = sha256(clientDataJSON);

  if (fmt === 'none') {
    await verifyNone();
  } else if (fmt === 'packed') {
    await verifyPacked(attStmt, authData, clientHash, publicKeyPem);
  } else {
    throw new Error('Unsupported attestation format: ' + fmt);
  }

  return {
    fmt,
    signCount,
    credentialId: base64url.encode(credId),
    publicKeyPem
  };
}
