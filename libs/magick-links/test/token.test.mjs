import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { signToken, verifyToken } from '../src/token.js';
import { memoryStore } from '../src/store/memory.js';
import { createMagicLink, consumeMagicLink } from '../src/index.js';

const keystore = {
  current: { kid: 'v2', key: randomBytes(32) },
  old: [{ kid: 'v1', key: randomBytes(32) }]
};

test('sign and verify with current key', () => {
  const token = signToken({ sub: 'u1', purpose: 'login' }, { keystore, ttlSec: 60 });
  const res = verifyToken(token, { keystore, expected: { purpose: 'login' } });
  assert.equal(res.valid, true);
  assert.equal(res.claims.sub, 'u1');
});

test('expired token rejected', () => {
  const token = signToken({ sub: 'u1', purpose: 'login', ttlSec: 0 }, { keystore, ttlSec: 0 });
  const res = verifyToken(token, { keystore, expected: { purpose: 'login' }, skewSec: 0 });
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'expired');
});

test('consume with memory store prevents replay', async () => {
  const store = memoryStore();
  const { token } = createMagicLink(
    { sub: 'alice@example.com', purpose: 'login' },
    { baseUrl: 'https://example.com/magic', keystore, ttlSec: 60 }
  );
  const r1 = await consumeMagicLink(token, { expected: { purpose: 'login' }, store, keystore });
  assert.equal(r1.valid, true);
  const r2 = await consumeMagicLink(token, { expected: { purpose: 'login' }, store, keystore });
  assert.equal(r2.valid, false);
  assert.equal(r2.reason, 'replay');
});

