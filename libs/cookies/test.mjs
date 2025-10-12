import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCookieHeader,
  parseSetCookieHeader,
  serializeSetCookie,
  sign,
  unsign,
  CookieJar,
  readCookies,
  setCookie,
  clearCookie,
} from './index.js';

test('parseCookieHeader basic and percent-decoding', () => {
  const h = 'a=1; b=hello%20world; c="quoted%3Bval"; a=shadow';
  const obj = parseCookieHeader(h);
  assert.equal(obj.a, '1');
  assert.equal(obj.b, 'hello world');
  assert.equal(obj.c, 'quoted;val');
  assert.equal(Object.keys(obj).length, 3);
});

test('serializeSetCookie validates invariants', () => {
  const line = serializeSetCookie({ name: 'a', value: 'b', path: '/', httpOnly: true });
  assert.match(line, /^a=b; Path=\//);

  assert.throws(() => serializeSetCookie({ name: '__Host-id', value: 'x' }), /Secure/);
  assert.throws(() => serializeSetCookie({ name: '__Host-id', value: 'x', secure: true, domain: 'x.com' }), /must not have Domain/);
  assert.throws(() => serializeSetCookie({ name: '__Host-id', value: 'x', secure: true, path: '/sub' }), /Path=\//);
  assert.throws(() => serializeSetCookie({ name: '__Secure-id', value: 'x' }), /Secure/);
  assert.throws(() => serializeSetCookie({ name: 'x', value: 'y', sameSite: 'None' }), /requires Secure/);
});

test('sign/unsign roundtrip', () => {
  const s = sign('value', 'secret');
  const r = unsign(s, 'secret');
  assert.equal(r.valid, true);
  assert.equal(r.value, 'value');
  assert.equal(unsign(s, 'bad').valid, false);
});

test('CookieJar set/get/list and request header', () => {
  const jar = new CookieJar({ now: () => new Date(1700000000000) });
  jar.set({ name: 'sid', value: '1', domain: 'example.com', path: '/', secure: true });
  jar.set({ name: 'prefs', value: 'a', domain: 'example.com', path: '/app' });
  jar.set({ name: 'host', value: 'h' }); // host-only

  // Secure only cookie should not be sent on http
  let h1 = jar.toRequestHeader('http://example.com/app/page');
  assert.ok(h1.includes('prefs=a'));
  assert.ok(!h1.includes('sid=1'));

  // HTTPS should include secure cookie and order by path length
  let h2 = jar.toRequestHeader('https://example.com/app/page');
  assert.match(h2, /prefs=a; sid=1|sid=1; prefs=a/); // both present

  // host-only cookie only matches exact host (no domain attr); domainless here so only sent if no domain filter
  const list = jar.list({ domain: 'example.com', path: '/', secure: true });
  assert.ok(list.find(c => c.name === 'sid'));

  // Max-Age expiry
  const soon = new CookieJar({ now: () => new Date(1700000000000) });
  soon.set({ name: 'temp', value: '1', maxAge: 1 });
  assert.equal(soon.list('/').length, 1);
  const later = new Date(1700000000000 + 2000);
  assert.equal(soon.clearExpired(later), 1);
});

test('CookieJar loadFromSetCookie and header size budgeting', () => {
  const jar = new CookieJar({ now: () => new Date(1700000000000), sizeLimitBytes: 20 });
  jar.loadFromSetCookie([
    'a=1; Path=/',
    'b=2; Path=/'
  ]);
  const h = jar.toRequestHeader('https://example.com/');
  assert.ok(h === 'a=1' || h === 'b=2' || h === 'a=1; b=2');
});

test('HTTP helpers read/set/clear cookie', () => {
  const req = { headers: { cookie: 'a=1; b=2' } };
  const cookies = readCookies(req);
  assert.equal(cookies.a, '1');
  assert.equal(cookies.b, '2');

  const headers = new Map();
  const res = {
    getHeader: (k) => headers.get(k),
    setHeader: (k, v) => headers.set(k, v),
  };
  setCookie(res, { name: 'sid', value: 'x', path: '/', httpOnly: true });
  setCookie(res, { name: 'u', value: 'y', path: '/' });
  const setc = res.getHeader('Set-Cookie');
  assert.ok(Array.isArray(setc) && setc.length === 2);
  clearCookie(res, 'sid', { path: '/' });
  const setc2 = res.getHeader('Set-Cookie');
  assert.ok(Array.isArray(setc2) && setc2.length === 3);
});

