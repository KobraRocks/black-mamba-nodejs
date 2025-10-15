import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-user-model-'));
const DB_PATH = path.join(tmpDir, 'user.test.db');
process.env.BM_DATABASE = DB_PATH;

const { User } = await import('../user.js');

User.migrate();

test('public_id is generated automatically', () => {
  const alice = User.create({ email: 'alice@example.com' });
  assert.ok(alice.id > 0);
  assert.equal(typeof alice.public_id, 'string');
  assert.ok(alice.public_id.length > 0);
});

test('public_id values are unique and validated', () => {
  const bob = User.create({ email: 'bob@example.com' });
  const carol = User.create({ email: 'carol@example.com' });
  assert.notEqual(bob.public_id, carol.public_id);

  const duplicate = new User({ email: 'dup@example.com', public_id: bob.public_id });
  assert.equal(duplicate.save(), false);
  const errors = duplicate.errors.on('public_id');
  assert.ok(Array.isArray(errors) && errors.length > 0);
});

