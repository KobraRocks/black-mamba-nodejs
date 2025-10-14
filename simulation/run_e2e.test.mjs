// Scaffold for E2E; marked skipped until endpoints exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

function freePort() { return 4020 + Math.floor(Math.random() * 200); }

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

test.skip('E2E: static, magic link, session, WebAuthn register+login', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-e2e-'));
  const dbFile = path.join(tmpDir, 'e2e.db');
  const port = freePort();

  const env = { ...process.env, BM_DEV: 'true', BM_MIGRATE: '1', BM_DATABASE: dbFile, BM_PORT: String(port) };
  const proc = spawn(process.execPath, ['app.js'], { cwd: path.join(process.cwd()), env });

  let out = '';
  proc.stdout.on('data', d => { out += d.toString('utf8'); });
  proc.stderr.on('data', d => { out += d.toString('utf8'); });

  await sleep(800);

  // TODO: Implement HTTP requests once endpoints are available
  // 1) GET /
  // 2) POST /auth/magic/request { email }
  // 3) GET /auth/magic/callback?token=...
  // 4) GET /me with cookie
  // 5) WebAuthn register flow
  // 6) WebAuthn login flow
  // 7) GET /me

  proc.kill('SIGTERM');
  assert.ok(/Server listening/.test(out));
});

