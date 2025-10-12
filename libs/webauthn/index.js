import crypto from 'node:crypto';
import { base64url } from './base64url.js';
export { verifyRegistrationResponse } from './registration.js';
export { verifyAuthenticationResponse } from './authentication.js';

function generateChallenge() {
  return base64url.encode(crypto.randomBytes(32));
}

export function generateRegistrationOptions(rp, user) {
  const challenge = generateChallenge();
  return {
    publicKey: {
      rp: { name: rp.name, id: rp.id },
      user: {
        id: Buffer.from(user.id),
        name: user.name,
        displayName: user.displayName
      },
      challenge: Buffer.from(challenge, 'utf8'),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      attestation: 'none',
      timeout: 60000
    },
    challenge
  };
}

export function generateAuthenticationOptions(rp, allowCredentials) {
  const challenge = generateChallenge();
  return {
    publicKey: {
      challenge: Buffer.from(challenge, 'utf8'),
      rpId: rp.id,
      allowCredentials,
      timeout: 60000
    },
    challenge
  };
}
