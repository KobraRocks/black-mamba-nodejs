import test from 'node:test'
import assert from 'node:assert/strict'
import { open } from '../index.mjs'

test('named params : @ $', async () => {
  const db = await open(':memory:')
  await db.exec('CREATE TABLE u(id INTEGER PRIMARY KEY, name TEXT)')
  await db.run('INSERT INTO u(name) VALUES (:name)', { name: 'alice' })
  await db.run('INSERT INTO u(name) VALUES (@name)', { name: 'bob' })
  await db.run('INSERT INTO u(name) VALUES ($name)', { name: 'carol' })
  const s = await db.prepare('SELECT name FROM u WHERE name=:name OR name=@name OR name=$name')
  await s.bind({ name: 'bob' }).step()
  const row = await s.get()
  assert.ok(['alice','bob','carol'].includes(row.name))
  await s.finalize()
  db.closeSync()
})

