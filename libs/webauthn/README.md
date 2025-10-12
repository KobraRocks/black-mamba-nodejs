# WebAuthn Helpers

The WebAuthn helpers in this library wrap the common server-side pieces of the
registration and authentication ceremonies. The goal is to keep the API small,
predictable, and easy to slot into an HTTP controller—much like the tidy helper
methods you would expect in a Rails-style application.

The module exposes methods to generate challenges for the browser, and to verify
the responses returned by authenticators. Everything uses ECMAScript modules and
the Node.js crypto primitives shipped with the platform.

```js
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from './index.js';
```

## Registration Flow

1. Ask the helper to create the challenge you will send to the browser.
2. Persist the generated challenge beside the user session.
3. When the browser posts the attestation response, pass it straight into the
   verifier together with the expected challenge and relying party data.

```js
// Step 1 – build options for navigator.credentials.create
const rp = { id: 'example.com', name: 'Example Inc.' };
const user = { id: '42', name: 'alice', displayName: 'Alice Example' };

const { publicKey, challenge } = generateRegistrationOptions(rp, user);
session.challenge = challenge;

// Return `publicKey` in your JSON response so the browser can call WebAuthn.

// Step 2 – later, when the browser posts the attestation result:
const result = await verifyRegistrationResponse(
  rp.id,
  'https://example.com',
  session.challenge,
  credentialResponse
);

// Persist the credential for future logins.
await saveCredential({
  userId: user.id,
  credentialId: result.credentialId,
  publicKeyPem: result.publicKeyPem,
  signCount: result.signCount,
});
```

The verifier supports the "none" and "packed" attestation formats. Any other
format will raise an error so you can decide how to handle it explicitly.

## Authentication Flow

1. When the user wants to sign in, request fresh options from the helper and
   remember the challenge you issued.
2. Provide the set of previously registered credential IDs so the browser knows
   which authenticators it may use.
3. Verify the response with the stored public key and compare the signature
   counter to defend against cloned authenticators.

```js
const allowCredentials = credentials.map((cred) => ({
  type: 'public-key',
  id: Buffer.from(cred.credentialId, 'base64url'),
}));

const { publicKey, challenge } = generateAuthenticationOptions(rp, allowCredentials);
session.challenge = challenge;

// Send `publicKey` back to the browser for navigator.credentials.get.

const verification = await verifyAuthenticationResponse(
  rp.id,
  'https://example.com',
  session.challenge,
  assertionResponse,
  storedPublicKeyPem,
  storedSignCount
);

await updateCredentialSignCount(credentialId, verification.signCount);
```

`verifyAuthenticationResponse` throws if the challenge, origin, rpId hash, or
signature fail to line up. A stale or non-incrementing signature counter also
raises an error so you can reject reuse attempts.

## Helper Utilities

The internals of the library are exported to keep advanced use-cases possible
without pulling in third-party packages:

- `base64url` conversions for WebAuthn payloads (`./base64url.js`).
- CBOR decoding utilities (`./cbor.js`).
- COSE to PEM conversion for public keys (`./cose.js`).
- ECDSA signature verification helpers (`./crypto-utils.js`).
- Attestation verifiers for "none" and "packed" flows.

You generally will not need these pieces directly when following the high-level
API, but they remain available if you need to customise your ceremony.

## Example Script

The repository ships with a small smoke test in `example.js` that demonstrates
the registration options helper in isolation.

```js
import * as webauthn from './index.js';

const rp = { name: 'Example Corp', id: 'example.com' };
const user = { id: 'user1', name: 'alice', displayName: 'Alice Example' };

const regOpts = webauthn.generateRegistrationOptions(rp, user);
console.log(regOpts.challenge); // random base64url string
```

Run it with `node libs/webauthn/example.js` to see the generated challenge.

## Testing

There is a Node.js test suite under `libs/webauthn/test.js`. Execute it with:

```bash
node --test libs/webauthn/test.js
```

Keeping the tests green before and after changes helps ensure your authenticator
flows remain trustworthy.
