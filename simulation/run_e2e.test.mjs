import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

const { sha256 } = await import('../libs/webauthn/crypto-utils.js');
const { base64url } = await import('../libs/webauthn/base64url.js');
const { hmacSign } = await import('../libs/session/crypto.js');

function freePort() { return 4100 + Math.floor(Math.random() * 300); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function logStep(msg) {
  const ts = new Date().toISOString();
  console.log(`[E2E][STEP] ${ts} ${msg}`);
}

async function withStep(name, fn, { timeoutMs = 3000, onTimeout } = {}) {
  logStep(`START: ${name}`);
  const started = Date.now();
  let timer;
  try {
    const res = await Promise.race([
      fn(),
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          try { onTimeout?.(); } catch {}
          rej(new Error(`Step timeout after ${timeoutMs}ms: ${name}`));
        }, timeoutMs);
      })
    ]);
    const took = Date.now() - started;
    clearTimeout(timer);
    logStep(`OK (${took}ms): ${name}`);
    return res;
  } catch (err) {
    clearTimeout(timer);
    const took = Date.now() - started;
    console.error(`[E2E][STEP] FAIL (${took}ms): ${name} ->`, err?.stack || err);
    throw err;
  }
}

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

async function httpText(url, { headers = {} } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: 'GET',
      headers: { Accept: 'text/html', ...headers },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, text: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
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

test('E2E: static, views, magic link, WebAuthn, and booking flow', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-e2e-'));
  const dbFile = path.join(tmpDir, 'e2e.db');
  const port = freePort();
  const base = `http://localhost:${port}`;

  const env = { ...process.env, BM_DEV: 'true', BM_MIGRATE: '1', BM_DATABASE: dbFile, BM_PORT: String(port) };
  const appPath = path.join(process.cwd(), 'app.js');
  // no fixtures needed; a Pages controller and views are included in repo
  const proc = spawn(process.execPath, [appPath], { cwd: process.cwd(), env });
  let killed = false;
  const killProc = () => { if (!killed) { try { proc.kill('SIGTERM'); } catch {} killed = true; } };
  t.after(killProc);

  let out = '';
  proc.stdout.on('data', d => { out += d.toString('utf8'); });
  proc.stderr.on('data', d => { out += d.toString('utf8'); });
  await withStep('boot server and wait for listening', async () => {
    await sleep(900);
    assert.match(out, /Server listening/);
  }, { timeoutMs: 3000, onTimeout: killProc });

  // 1) Static
  const r1 = await withStep('GET / static index', async () => fetch(`${base}/`));
  await withStep('assert home page status 200', async () => {
    assert.equal(r1.status, 200);
  });
  const t1 = await withStep('read / response text', async () => r1.text());
  await withStep('assert / index served', async () => {
    assert.match(t1, /It works/);
  });

  // 1b) Views auto-render and assigns (pages index via custom route to avoid /:id collision)
  const v1 = await withStep('GET /pages/index/view (HTML)', async () => fetch(`${base}/pages/index/view`));
  const v1Text = await withStep('read /pages/index/view body', async () => v1.text());
  await withStep('assert /pages/index/view', async () => {
    assert.equal(v1.status, 200);
    assert.match(String(v1.headers.get('content-type') || ''), /text\/html/);
    assert.match(v1Text, /<h1>Pages Index<\/h1>/);
  });

  // show route also exists but index check suffices to validate view pipeline

  // no explicit route test here; show suffices to verify assigns

  // 2) Magic link request
  const email = 'e2e@example.com';
  const r2 = await withStep('POST magic link request', () => httpJson(`${base}/auth/magic/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  }));
  await withStep('assert magic link request ok', async () => { assert.equal(r2.status, 200); });
  let token, url;
  if (r2.json && r2.json.token && r2.json.url) {
    token = r2.json.token; url = r2.json.url;
  } else {
    const { createMagicLink } = await import('../libs/magick-links/src/index.js');
    const { token: t, url: u } = createMagicLink({ sub: email, purpose: 'login' }, { baseUrl: `${base}/auth/magic/callback`, keystore: { current: { kid: 'v1', key: crypto.createHash('sha256').update('dev-secret-change-me').digest() } } });
    token = t; url = u;
  }

  // 3) Callback consume
  const r3 = await withStep('GET magic callback', () => httpJson(`${base}/auth/magic/callback?token=${encodeURIComponent(token)}`));
  const sid = await withStep('assert magic callback ok + capture sid', async () => {
    if (r3.status !== 200) {
      console.error('SERVER OUTPUT:', out);
      console.error('CALLBACK DEBUG status=%s body=%j', r3.status, r3.text);
    }
    assert.equal(r3.status, 200);
    const s = parseSidFromSetCookie(r3.setCookie);
    assert.ok(s);
    assert.equal(r3.json.user.email, email);
    return s;
  });
  const userId = r3.json.user.id;

  // 4) Protected route
  const r4 = await withStep('GET /me JSON (protected)', () => httpJson(`${base}/me`, { cookie: sid }));
  let publicId;
  await withStep('assert /me JSON user', async () => {
    assert.equal(r4.status, 200);
    assert.equal(r4.json.email, email);
    assert.ok(r4.json.public_id);
    publicId = r4.json.public_id;
  });

  // 5) WebAuthn registration
  const regOpts = await withStep('GET webauthn register options', () => httpJson(`${base}/auth/webauthn/register/options`, { cookie: sid }));
  await withStep('assert register options ok', async () => { assert.equal(regOpts.status, 200); });
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
  const r5 = await withStep('POST webauthn register verify', () => httpJson(`${base}/auth/webauthn/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regResp),
    cookie: sid,
  }));
  await withStep('assert register verify ok', async () => {
    if (r5.status !== 200) {
      console.error('SERVER OUTPUT:', out);
      console.error('REGISTER VERIFY DEBUG status=%s json=%j', r5.status, r5.json);
    }
    assert.equal(r5.status, 200);
    assert.equal(r5.json.ok, true);
  });

  // 6) WebAuthn authentication
  let loginOpts;
  try {
    loginOpts = await withStep('GET webauthn login options', () => httpJson(`${base}/auth/webauthn/login/options`, { cookie: sid }));
  } catch (e) {
    console.error('SERVER OUTPUT:', out);
    throw e;
  }
  await withStep('assert login options ok', async () => { assert.equal(loginOpts.status, 200); });
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
  const r6 = await withStep('POST webauthn login verify', () => httpJson(`${base}/auth/webauthn/login/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authResp),
    cookie: sid,
  }));
  await withStep('assert login verify ok', async () => {
    assert.equal(r6.status, 200);
    assert.equal(r6.json.ok, true);
  });

  // 7) Protected route again
  const r7 = await withStep('GET /me after login', () => httpJson(`${base}/me`, { cookie: sid }));
  await withStep('assert /me after login', async () => {
    assert.equal(r7.status, 200);
    assert.equal(r7.json.email, email);
  });

  // 8) Verify logged-in JSON endpoint still works
  const v4 = await withStep('GET /me JSON again', () => httpJson(`${base}/me`, { cookie: sid }));
  await withStep('assert /me JSON again ok', async () => { assert.equal(v4.status, 200); });

  // 9) Create an Event Type (Calendly-like)
  const tomorrow = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  })();

  const availability = (() => {
    // windows for all days 09:00-17:00 in local organizer tz
    const obj = {};
    for (let i=0;i<7;i++) obj[String(i)] = [["09:00","17:00"]];
    return obj;
  })();

  const createEventRes = await withStep('POST create event type', () => httpJson(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cookie: sid,
    body: JSON.stringify({
      name: 'Intro Call 30m',
      slug: `intro-${Math.floor(Math.random()*1e6)}`,
      duration_min: 30,
      tz_offset: '+00:00',
      availability_json: availability,
      buffer_before_min: 0,
      buffer_after_min: 0,
      min_notice_min: 0,
      max_notice_days: 30,
    })
  }));
  const eventType = await withStep('assert event created', async () => {
    if (createEventRes.status !== 201) {
      console.error('SERVER OUTPUT:', out);
      console.error('CREATE EVENT DEBUG status=%s json=%j', createEventRes.status, createEventRes.json);
    }
    assert.equal(createEventRes.status, 201);
    const et = createEventRes.json;
    assert.ok(et?.id);
    return et;
  });

  // 10) Query available slots for tomorrow
  const slotsRes = await withStep('GET slots for event type', () => httpJson(`${base}/events/${eventType.id}/slots?date=${encodeURIComponent(tomorrow)}&tz_offset=${encodeURIComponent(eventType.tz_offset || '+00:00')}`));
  const { slots, firstSlot } = await withStep('assert slots returned', async () => {
    assert.equal(slotsRes.status, 200);
    const s = Array.isArray(slotsRes.json?.slots) ? slotsRes.json.slots : [];
    assert.ok(s.length > 0, 'should return available slots');
    const fs = typeof s[0] === 'string' ? s[0] : s[0]?.utc;
    assert.ok(fs);
    return { slots: s, firstSlot: fs };
  });

  // 11) Complete booking flow via public endpoints
  const bookingBase = `${base}/booking/${encodeURIComponent(publicId)}/${encodeURIComponent(eventType.slug)}`;
  const inviteeEmail = 'guest@example.com';

  const bookingResponse = await withStep('GET booking landing page', async () => httpText(bookingBase), {
    timeoutMs: 5000,
    onTimeout: () => { console.error('SERVER OUTPUT:', out); }
  });
  await withStep('assert booking landing status', async () => {
    assert.equal(bookingResponse.status, 200);
  });
  const bookingLanding = bookingResponse.text;
  await withStep('assert booking landing markup', async () => {
    assert.match(bookingLanding, /data-bm-booking/);
  });

  const monthCurrent = await withStep('GET booking month current view', async () => {
    const res = await httpText(`${bookingBase}?month=current`);
    assert.equal(res.status, 200);
    return res.text;
  });
  await withStep('assert month current view rendered', async () => {
    assert.match(monthCurrent, /bm-month/);
  });

  const [tomYear, tomMonth, tomDay] = tomorrow.split('-');
  const specificMonth = await withStep('GET booking month target view', async () => {
    const res = await httpText(`${bookingBase}?month=${Number(tomMonth)}&year=${tomYear}`);
    assert.equal(res.status, 200);
    return res.text;
  });
  await withStep('assert month target includes day', async () => {
    assert.match(specificMonth, new RegExp(`data-day="${Number(tomDay)}"`));
  });

  const dayHtml = await withStep('GET booking day view', async () => {
    const res = await httpText(`${bookingBase}?month=${Number(tomMonth)}&year=${tomYear}&day=${Number(tomDay)}`);
    assert.equal(res.status, 200);
    return res.text;
  });
  await withStep('assert day view lists slots', async () => {
    assert.match(dayHtml, /data-bm-slot/);
  });

  const contactHtml = await withStep('GET booking contact view', async () => {
    const res = await httpText(`${bookingBase}/contact?month=${Number(tomMonth)}&year=${tomYear}&day=${Number(tomDay)}&start=${encodeURIComponent(firstSlot)}`);
    assert.equal(res.status, 200);
    return res.text;
  });
  await withStep('assert contact view renders form', async () => {
    assert.match(contactHtml, /bm-contact__form/);
  });

  const submitRes = await withStep('POST booking contact submit', async () => {
    const res = await fetch(`${bookingBase}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/html' },
      body: JSON.stringify({
        first_name: 'Guest',
        last_name: 'Example',
        email: inviteeEmail,
        notes: 'Excited to chat',
        start_iso: firstSlot,
        time_zone: 'UTC'
      })
    });
    const text = await res.text();
    return { status: res.status, text };
  });
  await withStep('assert booking flow confirmation', async () => {
    assert.equal(submitRes.status, 200);
    assert.match(submitRes.text, /You're booked!/);
  });

  let bookingId;
  let cancelToken;
  // 12) Ensure the organizer can list the booking
  const listRes = await withStep('GET organizer bookings list', () => httpJson(`${base}/event_bookings`, { cookie: sid }));
  await withStep('assert booking appears in list', async () => {
    assert.equal(listRes.status, 200);
    const listed = Array.isArray(listRes.json) ? listRes.json : [];
    const bookingRow = listed.find(b => b.invitee_email === inviteeEmail);
    assert.ok(bookingRow);
    bookingId = bookingRow.id;
  });
  const cancelSecret = process.env.BM_SESSION_SECRET || 'dev-secret-change-me';
  cancelToken = `${bookingId}.${hmacSign(String(bookingId), cancelSecret)}`;

  // 13) Prevent double-booking the same slot
  const doubleRes = await withStep('POST double-book same slot', () => httpJson(`${base}/event_bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type_id: eventType.id, invitee_name: 'Bob', invitee_email: 'bob@example.com', start_iso: firstSlot })
  }));
  await withStep('assert double-book prevented', async () => {
    assert.equal(doubleRes.status, 409);
    assert.equal(doubleRes.json?.error, 'slot-unavailable');
  });

  // 14) Cancel booking via token URL (HTML page)
  const cancelHtml = await withStep('GET cancel booking page', async () => fetch(`${base}/event_bookings/cancel?token=${encodeURIComponent(cancelToken)}`));
  const cancelText = await withStep('read cancel booking HTML', async () => cancelHtml.text());
  await withStep('assert cancel booking ok', async () => {
    assert.equal(cancelHtml.status, 200);
    assert.match(cancelText, /Booking Cancelled/);
  });

  // 15) Verify booking marked canceled in owner list
  const listRes2 = await withStep('GET bookings list after cancel', () => httpJson(`${base}/event_bookings`, { cookie: sid }));
  await withStep('assert booking is canceled', async () => {
    assert.equal(listRes2.status, 200);
    const b2 = (Array.isArray(listRes2.json) ? listRes2.json : []).find(b => b.id === bookingId);
    assert.ok(b2);
    assert.equal(b2.status, 'canceled');
  });

  killProc();
  try { fs.rmSync(path.join(process.cwd(), 'views', 'users'), { recursive: true, force: true }); } catch {}
});
