import test from 'node:test'
import assert from 'node:assert/strict'
import { open, isConstraintError, ERRORS } from '../index.mjs'

test('constraint detection helper', async () => {
  const db = await open(':memory:')
  await db.exec('CREATE TABLE u(id INTEGER PRIMARY KEY, email TEXT UNIQUE)')
  await db.run('INSERT INTO u(email) VALUES (?)', ['a@x'])
  let caught = null
  try { await db.run('INSERT INTO u(email) VALUES (?)', ['a@x']) } catch (e) { caught = e }
  assert.ok(caught, 'should throw on UNIQUE violation')
  assert.equal(isConstraintError(caught), true)
  assert.equal(typeof ERRORS.codes.SQLITE_CONSTRAINT, 'number')
  db.closeSync()
})

