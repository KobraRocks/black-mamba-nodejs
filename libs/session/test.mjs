import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, SQLiteStore } from './index.js';

function mockRes() {
  const headers = new Map();
  return {
    getHeader: (k) => headers.get(k),
    setHeader: (k, v) => headers.set(k, v),
    header: (k, v) => headers.set(k, v),
    _headers: headers
  };
}

test('session attach without cookie creates anonymous session and sets cookie on save', async () => {
  const req = { headers: {} };
  const res = mockRes();
  const sessionMw = createSession({
    name: 'bm.sid',
    secret: 'supersecret_dev_secret_12345',
    ttl: 60,
    store: SQLiteStore(':memory:')
  });
  await sessionMw.attach(req, res);
  assert.ok(req.session);
  assert.equal(req.session.is_anonymous, true);
  req.session.set('uid', 1);
  await req.session.save();
  const setc = res.getHeader('Set-Cookie');
  assert.ok(typeof setc === 'string' && setc.includes('bm.sid='));
});

test('session persists across requests via cookie and is_anonymous=false', async () => {
  // First request
  const res1 = mockRes();
  const mw = createSession({ secret: 'supersecret_dev_secret_12345', ttl: 60, store: SQLiteStore(':memory:') });
  const req1 = { headers: {} };
  await mw.attach(req1, res1);
  req1.session.set('email', 'user@example.com');
  await req1.session.save();
  const cookie = res1.getHeader('Set-Cookie');
  assert.ok(cookie);

  // Next request with cookie
  const req2 = { headers: { cookie: cookie.split(';')[0] } };
  const res2 = mockRes();
  await mw.attach(req2, res2);
  assert.equal(req2.session.is_anonymous, false);
  assert.equal(req2.session.get('email'), 'user@example.com');
});

