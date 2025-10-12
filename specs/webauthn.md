## 🧩 Overview

**Goal:**
Implement a minimal **WebAuthn (FIDO2)** server-side library in **Node.js** using **only built-in modules** (`crypto`, `buffer`, `assert`, etc.).
It should handle both **registration** and **authentication** verification.

**Key Features:**

* Generate **PublicKeyCredentialCreationOptions** and **PublicKeyCredentialRequestOptions**
* Verify **registration (attestation)** responses
* Verify **authentication (assertion)** responses
* Support **COSE/CBOR parsing**
* Support **ES256** (ECDSA) and **RS256** (RSA) algorithms
* Handle **base64url** encoding/decoding
* Include a minimal **attestation “none”** and **packed** verifier
* No TypeScript, no third-party libraries

---

## 🧱 Project Structure

```
webauthn/
├── index.js
├── base64url.js
├── cbor.js
├── cose.js
├── crypto-utils.js
├── attestation-none.js
├── attestation-packed.js
├── registration.js
├── authentication.js
└── example.js
```

---

## ⚙️ Core Components

### 1. `base64url.js`

```js
// RFC 4648 base64url encode/decode helpers
const base64url = {
  encode(buf) {
    return Buffer.from(buf)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },

  decode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
  }
};

module.exports = base64url;
```

---

### 2. `cbor.js` — Minimal CBOR Decoder

WebAuthn attestation objects are CBOR encoded.
We only need to decode maps, arrays, integers, byte strings, and text.

```js
function decodeCbor(buffer) {
  const data = new Uint8Array(buffer);
  let offset = 0;

  function read(n) {
    const v = data.slice(offset, offset + n);
    offset += n;
    return v;
  }

  function readUint(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return data[offset++];
    if (ai === 25) { const v = (data[offset] << 8) | data[offset + 1]; offset += 2; return v; }
    if (ai === 26) { const v = data.readUInt32BE(offset); offset += 4; return v; }
    throw new Error('Unsupported integer length');
  }

  function decodeItem() {
    const ib = data[offset++];
    const major = ib >> 5;
    const ai = ib & 31;

    switch (major) {
      case 0: return readUint(ai); // positive int
      case 1: return -1 - readUint(ai); // negative int
      case 2: return Buffer.from(read(readUint(ai))); // byte string
      case 3: return Buffer.from(read(readUint(ai))).toString('utf8'); // text
      case 4: {
        const len = readUint(ai);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: {
        const len = readUint(ai);
        const map = {};
        for (let i = 0; i < len; i++) {
          const k = decodeItem();
          const v = decodeItem();
          map[k] = v;
        }
        return map;
      }
      default:
        throw new Error('Unsupported CBOR type: ' + major);
    }
  }

  return decodeItem();
}

module.exports = { decodeCbor };
```

---

### 3. `cose.js` — COSE to PEM Conversion

COSE keys (CBOR maps) must be converted to PEM format for Node’s crypto APIs.

```js
function coseToPem(coseKey) {
  const kty = coseKey[1];
  const alg = coseKey[3];

  if (kty === 2 && alg === -7) { // EC2 / ES256
    const x = Buffer.from(coseKey[-2]);
    const y = Buffer.from(coseKey[-3]);
    const pub = Buffer.concat([Buffer.from([0x04]), x, y]);
    const header = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const spki = Buffer.concat([header, pub]);
    return `-----BEGIN PUBLIC KEY-----\n${spki.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  }

  if (kty === 3 && alg === -257) { // RSA / RS256
    const n = Buffer.from(coseKey[-1]);
    const e = Buffer.from(coseKey[-2]);
    // Basic ASN.1 encode
    function derInt(b) {
      if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
      return Buffer.concat([Buffer.from([0x02, b.length]), b]);
    }
    const seq = Buffer.concat([
      Buffer.from([0x30]),
      Buffer.from([0x0D + derInt(n).length + derInt(e).length]),
      Buffer.from('300d06092a864886f70d0101010500', 'hex'),
      Buffer.from([0x03]),
      Buffer.from([derInt(n).length + derInt(e).length + 1]),
      Buffer.from([0x00]),
      derInt(n),
      derInt(e)
    ]);
    return `-----BEGIN PUBLIC KEY-----\n${seq.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
  }

  throw new Error('Unsupported COSE key type');
}

module.exports = { coseToPem };
```

---

### 4. `crypto-utils.js`

```js
const { createVerify, createHash } = require('crypto');

function sha256(data) {
  return createHash('sha256').update(data).digest();
}

function verifySignature(alg, publicKeyPem, data, signature) {
  const verifier = createVerify('SHA256');
  verifier.update(data);
  verifier.end();
  return verifier.verify(publicKeyPem, signature);
}

module.exports = { sha256, verifySignature };
```

---

### 5. `attestation-none.js`

```js
async function verifyNone() {
  // "none" attestation has nothing to verify.
  return true;
}

module.exports = { verifyNone };
```

---

### 6. `attestation-packed.js`

```js
const { verifySignature } = require('./crypto-utils');

async function verifyPacked(attStmt, authData, clientDataHash, publicKeyPem) {
  const sig = attStmt.sig;
  const data = Buffer.concat([authData, clientDataHash]);
  return verifySignature('ES256', publicKeyPem, data, sig);
}

module.exports = { verifyPacked };
```

---

### 7. `registration.js`

Handles server-side registration verification.

```js
const { decodeCbor } = require('./cbor');
const { sha256 } = require('./crypto-utils');
const { coseToPem } = require('./cose');
const { verifyNone } = require('./attestation-none');
const { verifyPacked } = require('./attestation-packed');
const base64url = require('./base64url');

async function verifyRegistrationResponse(rpId, origin, expectedChallenge, response) {
  const clientDataJSON = base64url.decode(response.response.clientDataJSON);
  const client = JSON.parse(clientDataJSON.toString('utf8'));
  if (client.challenge !== expectedChallenge) throw new Error('Challenge mismatch');
  if (client.origin !== origin) throw new Error('Origin mismatch');

  const attestationObject = base64url.decode(response.response.attestationObject);
  const att = decodeCbor(attestationObject);

  const authData = Buffer.from(att.authData);
  const fmt = att.fmt;
  const attStmt = att.attStmt;
  const rpIdHash = sha256(Buffer.from(rpId));

  const flags = authData[32];
  const signCount = authData.readUInt32BE(33);

  const aaguid = authData.slice(37, 53);
  const credIdLen = authData.readUInt16BE(53);
  const credId = authData.slice(55, 55 + credIdLen);
  const coseKey = decodeCbor(authData.slice(55 + credIdLen));
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

module.exports = { verifyRegistrationResponse };
```

---

### 8. `authentication.js`

```js
const { sha256, verifySignature } = require('./crypto-utils');
const base64url = require('./base64url');

async function verifyAuthenticationResponse(rpId, origin, expectedChallenge, response, storedPublicKeyPem, prevSignCount) {
  const clientDataJSON = base64url.decode(response.response.clientDataJSON);
  const client = JSON.parse(clientDataJSON.toString('utf8'));

  if (client.challenge !== expectedChallenge) throw new Error('Challenge mismatch');
  if (client.origin !== origin) throw new Error('Origin mismatch');

  const authData = base64url.decode(response.response.authenticatorData);
  const signature = base64url.decode(response.response.signature);

  const rpIdHash = authData.slice(0, 32);
  const expectedRpHash = sha256(Buffer.from(rpId));
  if (!rpIdHash.equals(expectedRpHash)) throw new Error('rpIdHash mismatch');

  const signCount = authData.readUInt32BE(33);
  if (signCount <= prevSignCount) throw new Error('Sign counter not incremented');

  const clientHash = sha256(clientDataJSON);
  const data = Buffer.concat([authData, clientHash]);
  const ok = verifySignature('ES256', storedPublicKeyPem, data, signature);
  if (!ok) throw new Error('Invalid signature');

  return { ok: true, signCount };
}

module.exports = { verifyAuthenticationResponse };
```

---

### 9. `index.js` — Public API

```js
const crypto = require('crypto');
const base64url = require('./base64url');
const { verifyRegistrationResponse } = require('./registration');
const { verifyAuthenticationResponse } = require('./authentication');

function generateChallenge() {
  return base64url.encode(crypto.randomBytes(32));
}

function generateRegistrationOptions(rp, user) {
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

function generateAuthenticationOptions(rp, allowCredentials) {
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

module.exports = {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse
};
```

---

### 10. `example.js` — Simple Demo

```js
const webauthn = require('./index');

const rp = { name: 'Example Corp', id: 'example.com' };
const user = { id: 'user1', name: 'alice', displayName: 'Alice Example' };

// Generate registration options (server → browser)
const regOpts = webauthn.generateRegistrationOptions(rp, user);
console.log('Registration Options:', regOpts);

// Later, verify registration response (browser → server)
// const verified = await webauthn.verifyRegistrationResponse(rp.id, 'https://example.com', regOpts.challenge, response);
```

---

## 🧠 Security Notes

* **Challenges** must be unique and expire after a short period (store server-side).
* Always check **origin**, **rpIdHash**, and **signCount**.
* Use HTTPS in production.
* Restrict to **trusted origins**.
* Prefer `attestation: "none"` unless you need device attestation.

---

## ✅ Summary

This spec gives you a fully self-contained **Node.js WebAuthn library**, with:

* Only built-in modules
* No TypeScript
* Support for ES256 + RS256
* CBOR, COSE, and attestation parsing
* Registration & authentication verification flows
