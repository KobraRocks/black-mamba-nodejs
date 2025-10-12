import test from 'node:test'
import assert from 'node:assert/strict'
import { open } from '../index.mjs'

test('blob roundtrip', async () => {
  const db = await open(':memory:')
  await db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, d BLOB)')
  const buf = new Uint8Array([0,1,2,3,4,5,255])
  await db.run('INSERT INTO b(d) VALUES (?)', [buf])
  const row = await db.get('SELECT d FROM b WHERE id = 1')
  assert.ok(row.d instanceof Uint8Array)
  assert.equal(row.d.length, buf.length)
  for (let i=0;i<buf.length;i++) assert.equal(row.d[i], buf[i])
  db.closeSync()
})

