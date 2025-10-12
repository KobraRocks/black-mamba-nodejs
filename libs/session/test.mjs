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
  assert.ok(req.session.device_id);
  req.session.set('uid', 1);
  await req.session.save();
  const setc = res.getHeader('Set-Cookie');
  const hdr = String(setc);
  assert.ok(hdr.includes('bm.sid='));
  // device cookie also set
  assert.ok(hdr.includes('bm.did='));
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
  // include both sid and did cookies
  const parts = String(cookie).split(/,\s*/);
  const c1 = parts[0].split(';')[0];
  const c2 = (parts[1] || '').split(';')[0];
  const cookieHeader = c2 ? `${c1}; ${c2}` : c1;
  const req2 = { headers: { cookie: cookieHeader } };
  const res2 = mockRes();
  await mw.attach(req2, res2);
  assert.equal(req2.session.is_anonymous, false);
  assert.equal(req2.session.get('email'), 'user@example.com');
});
