import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = process.cwd();

function runScript(script, env = {}) {
  const proc = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
  assert.equal(proc.status, 0, proc.stderr || 'spawn failed');
  return proc.stdout.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line));
}

test('super admin detection normalizes email and matches case-insensitively', () => {
  const [line] = runScript(`
    import { getSuperAdminEmail, isSuperAdmin, hasSuperAdmin } from './libs/super-admin/index.js';
    console.log(JSON.stringify({
      email: getSuperAdminEmail(),
      has: hasSuperAdmin(),
      matchExact: isSuperAdmin('boss@example.com'),
      matchCase: isSuperAdmin('Boss@Example.com'),
      miss: isSuperAdmin('other@example.com')
    }));
  `, { BM_SUPER_ADMIN: '  Boss@Example.com  ' });
  assert.equal(line.email, 'boss@example.com');
  assert.equal(line.has, true);
  assert.equal(line.matchExact, true);
  assert.equal(line.matchCase, true);
  assert.equal(line.miss, false);
});

test('super admin env is cached on first load', () => {
  const [first, second] = runScript(`
    import { getSuperAdminEmail, isSuperAdmin } from './libs/super-admin/index.js';
    console.log(JSON.stringify({ email: getSuperAdminEmail(), match: isSuperAdmin('boss@example.com') }));
    process.env.BM_SUPER_ADMIN = 'changed@example.com';
    console.log(JSON.stringify({ email: getSuperAdminEmail(), match: isSuperAdmin('changed@example.com') }));
  `, { BM_SUPER_ADMIN: 'boss@example.com' });
  assert.deepEqual(first, { email: 'boss@example.com', match: true });
  assert.deepEqual(second, { email: 'boss@example.com', match: false });
});

test('hasSuperAdmin reports false when unset or blank', () => {
  const [line] = runScript(`
    import { getSuperAdminEmail, hasSuperAdmin } from './libs/super-admin/index.js';
    console.log(JSON.stringify({ email: getSuperAdminEmail(), has: hasSuperAdmin() }));
  `, { BM_SUPER_ADMIN: '   ' });
  assert.equal(line.email, null);
  assert.equal(line.has, false);
});
