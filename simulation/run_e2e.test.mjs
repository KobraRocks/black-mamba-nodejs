import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const { sha256 } = await import('../libs/webauthn/crypto-utils.js');
const { base64url } = await import('../libs/webauthn/base64url.js');

function freePort() { return 4100 + Math.floor(Math.random() * 300); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseSidFromSetCookie(headerValue) {
  if (!headerValue) return null;
  const m = /bm\.sid=([^;\s]+)/.exec(headerValue);
  return m ? m[1] : null;
}

async function httpJson(url, { method = 'GET', headers = {}, body, cookie } = {}) {
  const h = { 'Accept': 'application/json', ...headers };
  if (cookie) h['Cookie'] = `bm.sid=${cookie}`;
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, setCookie, text };
}

// Minimal CBOR encoder for our needs
function cborEncodeInt(n) {
  if (n >= 0) {
    if (n < 24) return Buffer.from([0x00 | n]);
    if (n < 256) return Buffer.from([0x18, n]);
    const b = Buffer.alloc(4); b.writeUInt32BE(n); return Buffer.concat([Buffer.from([0x1a]), b]);
  } else {
    const val = -1 - n; // major type 1 encoding
    if (val < 24) return Buffer.from([0x20 | val]);
    if (val < 256) return Buffer.from([0x38, val]);
    const b = Buffer.alloc(4); b.writeUInt32BE(val); return Buffer.concat([Buffer.from([0x3a]), b]);
  }
}
function cborEncodeBytes(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 24) return Buffer.concat([Buffer.from([0x40 | b.length]), b]);
  const len = Buffer.alloc(4); len.writeUInt32BE(b.length);
  return Buffer.concat([Buffer.from([0x5a]), len, b]);
}
function cborEncodeText(str) {
  const b = Buffer.from(String(str), 'utf8');
  if (b.length < 24) return Buffer.concat([Buffer.from([0x60 | b.length]), b]);
  const len = Buffer.alloc(4); len.writeUInt32BE(b.length);
  return Buffer.concat([Buffer.from([0x7a]), len, b]);
}
function cborEncodeMap(entries) {
  const parts = [];
  parts.push(Buffer.from([0xa0 | entries.length]));
  for (const [k, v] of entries) {
    if (typeof k === 'number') parts.push(cborEncodeInt(k)); else parts.push(cborEncodeText(k));
    parts.push(v);
  }
  return Buffer.concat(parts);
}

function buildCoseKeyFromJwk(jwk) {
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return cborEncodeMap([
    [1, cborEncodeInt(2)],      // kty: EC2
    [3, cborEncodeInt(-7)],     // alg: ES256
    [-1, cborEncodeInt(1)],     // crv: P-256
    [-2, cborEncodeBytes(x)],
    [-3, cborEncodeBytes(y)],
  ]);
}

test('E2E: static, magic link, session, WebAuthn register+login', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-e2e-'));
  const dbFile = path.join(tmpDir, 'e2e.db');
  const port = freePort();
  const base = `http://localhost:${port}`;

  const env = { ...process.env, BM_DEV: 'true', BM_MIGRATE: '1', BM_DATABASE: dbFile, BM_PORT: String(port) };
  const appPath = path.join(process.cwd(), 'app.js');
  const proc = spawn(process.execPath, [appPath], { cwd: process.cwd(), env });

  let out = '';
  proc.stdout.on('data', d => { out += d.toString('utf8'); });
  proc.stderr.on('data', d => { out += d.toString('utf8'); });
  await sleep(900);
  assert.match(out, /Server listening/);

  // 1) Static
  const r1 = await fetch(`${base}/`);
  const t1 = await r1.text();
  assert.equal(r1.status, 200);
  assert.match(t1, /It works/);

  // 2) Magic link request
  const email = 'e2e@example.com';
  const r2 = await httpJson(`${base}/auth/magic/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  assert.equal(r2.status, 200);
  let token, url;
  if (r2.json && r2.json.token && r2.json.url) {
    token = r2.json.token; url = r2.json.url;
  } else {
    const { createMagicLink } = await import('../libs/magick-links/src/index.js');
    const { token: t, url: u } = createMagicLink({ sub: email, purpose: 'login' }, { baseUrl: `${base}/auth/magic/callback`, keystore: { current: { kid: 'v1', key: crypto.createHash('sha256').update('dev-secret-change-me').digest() } } });
    token = t; url = u;
  }

  // 3) Callback consume
  const r3 = await httpJson(`${base}/auth/magic/callback?token=${encodeURIComponent(token)}`);
  assert.equal(r3.status, 200);
  const sid = parseSidFromSetCookie(r3.setCookie);
  assert.ok(sid);
  assert.equal(r3.json.user.email, email);

  // 4) Protected route
  const r4 = await httpJson(`${base}/me`, { cookie: sid });
  assert.equal(r4.status, 200);
  assert.equal(r4.json.email, email);

  // 5) WebAuthn registration
  const regOpts = await httpJson(`${base}/auth/webauthn/register/options`, { cookie: sid });
  assert.equal(regOpts.status, 200);
  const challengeReg = regOpts.json.challenge;
  const rpId = 'localhost';
  const origin = base;

  // Create EC key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = buildCoseKeyFromJwk(jwk);

  // Build authData
  const rpHash = sha256(Buffer.from(rpId));
  const flags = Buffer.from([0x41]);
  const signCount = Buffer.alloc(4); signCount.writeUInt32BE(1);
  const aaguid = Buffer.alloc(16);
  const credId = crypto.randomBytes(16);
  const credIdLen = Buffer.alloc(2); credIdLen.writeUInt16BE(credId.length);
  const authData = Buffer.concat([rpHash, flags, signCount, aaguid, credIdLen, credId, cose]);

  // Build attestationObject (CBOR map)
  const attObj = cborEncodeMap([
    ['authData', cborEncodeBytes(authData)],
    ['fmt', cborEncodeText('none')],
    ['attStmt', cborEncodeMap([])],
  ]);

  const clientReg = {
    type: 'webauthn.create',
    challenge: challengeReg,
    origin,
    crossOrigin: false,
  };
  const regResp = {
    id: base64url.encode(credId),
    rawId: base64url.encode(credId),
    type: 'public-key',
    response: {
      clientDataJSON: base64url.encode(Buffer.from(JSON.stringify(clientReg))),
      attestationObject: base64url.encode(attObj),
    },
  };
  const r5 = await httpJson(`${base}/auth/webauthn/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regResp),
    cookie: sid,
  });
  assert.equal(r5.status, 200);
  assert.equal(r5.json.ok, true);

  // 6) WebAuthn authentication
  let loginOpts;
  try {
    loginOpts = await httpJson(`${base}/auth/webauthn/login/options`, { cookie: sid });
  } catch (e) {
    console.error('SERVER OUTPUT:', out);
    throw e;
  }
  assert.equal(loginOpts.status, 200);
  const challengeAuth = loginOpts.json.challenge;

  const clientAuth = { type: 'webauthn.get', challenge: challengeAuth, origin, crossOrigin: false };
  const authData2 = (() => {
    const rpHash2 = rpHash;
    const flags2 = Buffer.from([0x01]); // UP only
    const sign2 = Buffer.alloc(4); sign2.writeUInt32BE(2);
    return Buffer.concat([rpHash2, flags2, sign2]);
  })();
  const clientHash = sha256(Buffer.from(JSON.stringify(clientAuth)));
  const dataToSign = Buffer.concat([authData2, clientHash]);
  const signature = crypto.createSign('SHA256').update(dataToSign).end().sign(privateKey);

  const authResp = {
    id: base64url.encode(credId),
    rawId: base64url.encode(credId),
    type: 'public-key',
    response: {
      clientDataJSON: base64url.encode(Buffer.from(JSON.stringify(clientAuth))),
      authenticatorData: base64url.encode(authData2),
      signature: base64url.encode(signature),
      userHandle: null,
    },
  };
  const r6 = await httpJson(`${base}/auth/webauthn/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authResp),
    cookie: sid,
  });
  assert.equal(r6.status, 200);
  assert.equal(r6.json.ok, true);

  // 7) Protected route again
  const r7 = await httpJson(`${base}/me`, { cookie: sid });
  assert.equal(r7.status, 200);
  assert.equal(r7.json.email, email);

  proc.kill('SIGTERM');
});
