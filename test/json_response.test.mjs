import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

function httpGet(port, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathName, method: 'GET', headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await httpGet(port, '/__up');
      if (r && typeof r.status === 'number') return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not start in time');
}

test('content negotiation: text vs json for string and object responses', async () => {
  const appPath = path.join(process.cwd(), 'app.js');
  const env = { ...process.env, BM_DEV: 'true', BM_PORT: '4012' };

  const proc = spawn(process.execPath, [appPath], { cwd: process.cwd(), env });
  await waitForServer(4012, 8000);

  let procKilled = false;
  try {
    // 1) Default (no Accept), string payload => body is plain string, content-type may be unset
    const r1 = await httpGet(4012, '/things');
    assert.equal(r1.status, 200);
    assert.equal(r1.body, 'hello');

    // 2) Accept: application/json, string payload => JSON string (quoted)
    const r2 = await httpGet(4012, '/things', { Accept: 'application/json' });
    assert.equal(r2.status, 200);
    assert.match(String(r2.headers['content-type'] || ''), /application\/json/);
    assert.equal(r2.body, JSON.stringify('hello'));

    // 3) ?format=json, string payload => JSON string (quoted)
    const r3 = await httpGet(4012, '/things?format=json');
    assert.equal(r3.status, 200);
    assert.match(String(r3.headers['content-type'] || ''), /application\/json/);
    assert.equal(r3.body, JSON.stringify('hello'));

    // 4) Object payload with Accept: application/json => JSON object
    const r4 = await httpGet(4012, '/things/7', { Accept: 'application/json' });
    assert.equal(r4.status, 200);
    assert.match(String(r4.headers['content-type'] || ''), /application\/json/);
    assert.deepEqual(JSON.parse(r4.body), { id: 7, name: 'Ada' });
  } finally {
    proc.kill('SIGTERM');
    procKilled = true;
  }
});
