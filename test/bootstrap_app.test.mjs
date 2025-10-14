import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('app boots in dev, prints banner and runs migrations by default with DB and order banner + BM_PORT', async (t) => {
  const appPath = path.join(process.cwd(), 'app.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-app-'));
  const dbPath = path.join(tmpDir, 'boot.db');
  const env = { ...process.env, BM_DEV: 'true', BM_DATABASE: dbPath, BM_PORT: '4010' };
  delete env.BM_MIGRATE; // default in dev should migrate

  const proc = spawn(process.execPath, [appPath], { cwd: process.cwd(), env });
  let out = '';
  proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { out += d.toString('utf8'); });

  await new Promise((resolve) => setTimeout(resolve, 900));
  proc.kill('SIGTERM');

  assert.match(out, /Dev mode enabled/);
  assert.match(out, /migrated\s+users/);
  assert.match(out, new RegExp(`DB: ${dbPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(out, /Migrations:\s*users/);
  assert.match(out, /Server listening on http:\/\/localhost:4010/);
});
