import test from 'node:test'
import assert from 'node:assert/strict'
import { open } from '../index.mjs'

test('DDL/DML/select sync+async', async () => {
  const db = await open(':memory:')
  await db.exec('PRAGMA journal_mode=WAL')
  await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT, b BLOB)')

  // async run
  const r = await db.run('INSERT INTO t(v) VALUES (?)', ['Ada'])
  assert.equal(typeof r.lastInsertRowid, 'bigint')

  // get
  const row = await db.get('SELECT id, v FROM t WHERE id = ?', [r.lastInsertRowid])
  assert.equal(row.v, 'Ada')

  // prepared insert with blob
  const s = await db.prepare('INSERT INTO t(v, b) VALUES(:v, :b)')
  await s.bind({ v: 'Blob', b: new Uint8Array([1,2,3]) }).get()
  await s.finalize()

  // sync all
  const rows = db.allSync('SELECT * FROM t ORDER BY id')
  assert.ok(rows.length >= 2)
  assert.equal(rows[0].v, 'Ada')

  await db.checkpoint('PASSIVE')

  // transactionSync rollback
  try {
    db.transactionSync(() => {
      db.execSync("INSERT INTO t(v) VALUES ('Tx')")
      throw new Error('boom')
    })
  } catch {}
  const rows2 = db.allSync('SELECT v FROM t WHERE v = \"Tx\"')
  assert.equal(rows2.length, 0)

  db.closeSync()
})

