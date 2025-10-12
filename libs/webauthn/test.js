import assert from 'node:assert/strict';
import { base64url } from './base64url.js';
import { decodeCbor } from './cbor.js';
import * as webauthn from './index.js';

// base64url encode/decode round-trip
{
  const input = Buffer.from('hello world');
  const enc = base64url.encode(input);
  const dec = base64url.decode(enc);
  assert.ok(dec.equals(input), 'base64url round-trip failed');
}

// minimal CBOR: map {1: 'a', 2: [1,2]}
{
  const buf = Buffer.from('a201616102820102', 'hex');
  const obj = decodeCbor(buf);
  assert.strictEqual(obj[1], 'a');
  assert.deepStrictEqual(obj[2], [1,2]);
}

// registration/authentication option shapes
{
  const rp = { name: 'Test RP', id: 'example.com' };
  const user = { id: 'uid', name: 'bob', displayName: 'Bob' };
  const reg = webauthn.generateRegistrationOptions(rp, user);
  assert.ok(reg.publicKey.challenge instanceof Buffer);
  assert.strictEqual(reg.publicKey.rp.id, 'example.com');
  const auth = webauthn.generateAuthenticationOptions(rp, []);
  assert.ok(auth.publicKey.challenge instanceof Buffer);
  assert.strictEqual(auth.publicKey.rpId, 'example.com');
}

console.log('webauthn tests: OK');
