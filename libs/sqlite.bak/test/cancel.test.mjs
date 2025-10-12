import test from 'node:test'
import assert from 'node:assert/strict'
import { open } from '../index.mjs'

// Attempt to cancel a long-running SELECT via AbortController
test('cancel via AbortSignal + interrupt', async () => {
  const db = await open(':memory:')
  await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
  // build a recursive CTE to create many rows
  const sql = `WITH RECURSIVE cnt(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM cnt WHERE x<2000000) SELECT x FROM cnt`;
  const ac = new AbortController()
  const p = db.all(sql, null, { signal: ac.signal })
  setTimeout(() => ac.abort(), 5)
  let cancelled = false
  try { await p } catch (e) { cancelled = true }
  assert.equal(cancelled, true)
  db.closeSync()
})

