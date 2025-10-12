import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvConfig, buildMessage, MailerError, dotStuff } from './index.js';

test('loadEnvConfig reads environment and supports overrides', () => {
  const old = { ...process.env };
  try {
    process.env.BM_SMTP_HOST = 'smtp.example.com';
    process.env.BM_SMTP_PORT = '465';
    process.env.BM_SMTP_USERNAME = 'user';
    process.env.BM_SMTP_PASSWORD = 'pass';
    const cfg = loadEnvConfig();
    assert.equal(cfg.host, 'smtp.example.com');
    assert.equal(cfg.port, 465);
    assert.equal(cfg.username, 'user');
    assert.equal(cfg.password, 'pass');

    const cfg2 = loadEnvConfig({ host: 'override.local', port: 2465 });
    assert.equal(cfg2.host, 'override.local');
    assert.equal(cfg2.port, 2465);
  } finally {
    Object.assign(process.env, old);
  }
});

test('loadEnvConfig validates required variables', () => {
  const old = { ...process.env };
  try {
    delete process.env.BM_SMTP_HOST;
    delete process.env.BM_SMTP_PORT;
    assert.throws(() => loadEnvConfig(), /BM_SMTP_HOST/);
  } finally {
    Object.assign(process.env, old);
  }
});

test('buildMessage builds headers and body', () => {
  const { headers, body, content } = buildMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hello',
    text: 'Plain',
    html: '<b>Bold</b>'
  }, 'example.com');

  const hdr = headers.join('\n');
  assert.match(hdr, /From: a@example.com/);
  assert.match(hdr, /To: b@example.com/);
  assert.match(hdr, /Subject: Hello/);
  assert.match(hdr, /Message-ID: <.*@example.com>/);
  assert.match(body, /multipart\/alternative/);
  assert.match(content, /\r\n\.\r\n|\.$/);
});

test('buildMessage with attachments uses multipart/mixed and base64 encodes content', () => {
  const data = Buffer.from('hello world');
  const { headers, body, content } = buildMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hi',
    text: 'See attachment',
    attachments: [ { filename: 'hello.txt', content: data, contentType: 'text/plain' } ]
  }, 'example.com');
  const msg = [...headers, body].join('\r\n');
  assert.match(msg, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(msg, /Content-Disposition: attachment; filename="hello.txt"/);
  assert.match(msg, /Content-Transfer-Encoding: base64/);
  // base64 of 'hello world' is 'aGVsbG8gd29ybGQ='
  assert.ok(msg.includes('aGVsbG8gd29ybGQ='));
});

test('dotStuff does not alter final terminator and stuffs leading dot lines', () => {
  const content = [
    'Header: x',
    '',
    '.line starting with dot',
    'normal line',
    '.',
  ].join('\r\n');
  const stuffed = dotStuff(content);
  const lines = stuffed.split('\r\n');
  // First dot-starting line becomes '..'
  const idx = lines.indexOf('.line starting with dot');
  assert.equal(idx, -1);
  assert.ok(lines.includes('..line starting with dot'));
  // Final line remains single '.'
  assert.equal(lines[lines.length - 1], '.');
});
