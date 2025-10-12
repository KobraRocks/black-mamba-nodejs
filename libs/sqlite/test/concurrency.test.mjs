import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { open } from '../index.mjs'

test('parallel inserts and reads', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-sqlite-'))
  const dbPath = path.join(tmp, 'c.db')
  let db
  try {
    db = await open(dbPath)
    await db.exec('PRAGMA journal_mode=WAL')
    await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')

    const writers = Array.from({ length: 10 }, (_, i) => db.run('INSERT INTO t(v) VALUES (?)', [`v${i}`]))
    const readers = Array.from({ length: 5 }, () => db.all('SELECT * FROM t'))
    await Promise.all([...writers, ...readers])

    const rows = await db.all('SELECT * FROM t')
    assert.ok(rows.length >= 10)
  } finally {
    try { db?.closeSync?.() } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
})
