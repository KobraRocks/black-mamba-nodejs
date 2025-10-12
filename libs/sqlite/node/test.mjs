import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import SQLITE from './index.js';
import { hasSqlite3Cli } from './util.js';

const skip = !hasSqlite3Cli();

test('create and basic operations', { skip }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-sqlite-'));
  try {
    const dbPath = path.join(tmp, 'test.sqlite');
    const sqlite = SQLITE.createDatabase(dbPath, { pragma: ['foreign_keys', 'ON'] });
    let res = sqlite.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);');
    assert.equal(res.ok, true);
    res = sqlite.execute("INSERT INTO users (name) VALUES ('alice');");
    assert.equal(res.ok, true);
    const stmt = sqlite.prepare_match_first('SELECT * FROM users ORDER BY id DESC LIMIT 1;');
    const { record } = stmt.execute();
    assert.ok(record);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});
