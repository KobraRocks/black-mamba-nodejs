import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const ENV_PATH = path.join(root, '.env');

function writeEnv(text) { fs.writeFileSync(ENV_PATH, text, 'utf8'); }
function rmEnv() { try { fs.unlinkSync(ENV_PATH); } catch {} }

test('env loader: .env overrides shell and filters non-BM_', () => {
  const backup = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null;
  try {
    writeEnv('BM_PORT=4999\nBM_DEV=true\nFOO=bar\n');
    const env = { ...process.env, BM_PORT: '1234' };
    delete env.BM_DEV;
    delete env.FOO;
    const proc = spawnSync(process.execPath, ['libs/env/print_env.mjs'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(proc.status, 0, proc.stderr || 'spawn failed');
    const out = JSON.parse(proc.stdout.trim());
    assert.equal(out.BM_PORT, '4999'); // .env takes precedence
    assert.equal(out.BM_DEV, 'true');  // .env sets value
    assert.equal(out.FOO, null);       // non-BM_ ignored
  } finally {
    if (backup !== null) fs.writeFileSync(ENV_PATH, backup, 'utf8'); else rmEnv();
  }
});

