import { open, openSync } from '../index.mjs'
import { randomInt, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'
import { spawn } from 'node:child_process'

// Benchmark configuration (BM_* envs only)
const DURATION_MS = toInt(process.env.BM_BENCH_DURATION_MS, 2000)
const DB_PATH = resolveDbPath(process.env.BM_BENCH_DB) // default now 'tmp' for realism
const CONN = toInt(process.env.BM_BENCH_CONN, 4)
const BATCH = toInt(process.env.BM_BENCH_BATCH, 100)
const PAGE_SIZE = toInt(process.env.BM_BENCH_PAGE_SIZE, 50)
const SEED_USERS = toInt(process.env.BM_BENCH_SEED_USERS, 5000)
const SEED_LOGS = toInt(process.env.BM_BENCH_SEED_LOGS, 5000)
const SESSION_POOL = toInt(process.env.BM_BENCH_SESSION_POOL, 1000)
const FORK = toInt(process.env.BM_BENCH_FORK, 1) // use multi-process concurrency by default
const SYNC = toInt(process.env.BM_BENCH_SYNC, 1)  // default to sync API for stability

function toInt(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d }
function resolveDbPath(input) {
  if (!input) return join(tmpdir(), `bm_sqlite_bench_${process.pid}.db`)
  if (input === 'memory' || input === ':memory:') return ':memory:'
  if (input === 'tmp') return join(tmpdir(), `bm_sqlite_bench_${process.pid}.db`)
  return input
}

function hrNow() { return process.hrtime.bigint() }
function msSince(t0) { return Number(hrNow() - t0) / 1e6 }

async function measureUnits(label, fn, unitsPerIter = 1, { durationMs = DURATION_MS } = {}) {
  let ops = 0, errors = 0
  const t0 = hrNow()
  while (msSince(t0) < durationMs) {
    try { // eslint-disable-next-line no-await-in-loop
      await fn(); ops += unitsPerIter
    } catch { errors += 1 }
  }
  const elapsedMs = msSince(t0)
  return { label, ops, errors, ms: elapsedMs, opsPerSec: (ops / (elapsedMs / 1000)) || 0 }
}

async function measure(label, fn, opts) { return measureUnits(label, fn, 1, opts) }

function measureUnitsSync(label, fn, unitsPerIter = 1, { durationMs = DURATION_MS } = {}) {
  let ops = 0, errors = 0
  const t0 = hrNow()
  while (msSince(t0) < durationMs) {
    try { fn(); ops += unitsPerIter } catch { errors += 1 }
  }
  const elapsedMs = msSince(t0)
  return { label, ops, errors, ms: elapsedMs, opsPerSec: (ops / (elapsedMs / 1000)) || 0 }
}
function measureSync(label, fn, opts) { return measureUnitsSync(label, fn, 1, opts) }

async function setupDb(path) {
  const db = await open(path)
  await db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`)
  return db
}
function setupDbSync(path) {
  const db = openSync(path)
  db.execSync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;`)
  return db
}

// Helpers: prepared statements (fallback to ad-hoc if not available)
function tryPrepareSync(db, sql) {
  try { return db.prepareSync(sql) } catch { return null }
}
async function tryPrepare(db, sql) {
  try { return await db.prepare(sql) } catch { return null }
}

async function createSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      created_at INTEGER,
      last_seen INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

    CREATE TABLE IF NOT EXISTS sessions(
      sid TEXT PRIMARY KEY,
      user_id INTEGER,
      data TEXT,
      touched_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS logs(
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      level TEXT,
      msg TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

    CREATE TABLE IF NOT EXISTS counters(
      name TEXT PRIMARY KEY,
      val INTEGER NOT NULL
    );
  `)
}
function createSchemaSync(db) {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT,
      created_at INTEGER,
      last_seen INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen);

    CREATE TABLE IF NOT EXISTS sessions(
      sid TEXT PRIMARY KEY,
      user_id INTEGER,
      data TEXT,
      touched_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS logs(
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      level TEXT,
      msg TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

    CREATE TABLE IF NOT EXISTS counters(
      name TEXT PRIMARY KEY,
      val INTEGER NOT NULL
    );
  `)
}

async function seedData(db) {
  // users
  await db.transaction(async () => {
    const ps = await tryPrepare(db, 'INSERT OR IGNORE INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)')
    for (let i = 0; i < SEED_USERS; i++) {
      const args = [`user${i}@example.com`, `User ${i}`, Date.now() - randomInt(1_000_000), Date.now() - randomInt(1_000_000)]
      // eslint-disable-next-line no-await-in-loop
      if (ps) { await ps.bind(args).get() } else { await db.run('INSERT OR IGNORE INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)', args) }
    }
    if (ps) await ps.finalize()
  })
  // logs
  await db.transaction(async () => {
    const ps = await tryPrepare(db, 'INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)')
    for (let i = 0; i < SEED_LOGS; i++) {
      const args = [Date.now() - randomInt(10_000_000), pick(['info','warn','error']), `log ${i}`]
      // eslint-disable-next-line no-await-in-loop
      if (ps) { await ps.bind(args).get() } else { await db.run('INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)', args) }
    }
    if (ps) await ps.finalize()
  })
  // counters
  await db.run('INSERT OR IGNORE INTO counters(name, val) VALUES(?, ?)', ['hits', 0])
}
function seedDataSync(db) {
  // users
  db.transactionSync(() => {
    const ps = tryPrepareSync(db, 'INSERT OR IGNORE INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)')
    for (let i = 0; i < SEED_USERS; i++) {
      const args = [`user${i}@example.com`, `User ${i}`, Date.now() - randomInt(1_000_000), Date.now() - randomInt(1_000_000)]
      if (ps) { ps.bind(args).getSync() } else { db.runSync('INSERT OR IGNORE INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)', args) }
    }
    if (ps) ps.finalizeSync()
  })
  // logs
  db.transactionSync(() => {
    const ps = tryPrepareSync(db, 'INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)')
    for (let i = 0; i < SEED_LOGS; i++) {
      const args = [Date.now() - randomInt(10_000_000), pick(['info','warn','error']), `log ${i}`]
      if (ps) { ps.bind(args).getSync() } else { db.runSync('INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)', args) }
    }
    if (ps) ps.finalizeSync()
  })
  // counters
  db.runSync('INSERT OR IGNORE INTO counters(name, val) VALUES(?, ?)', ['hits', 0])
}

function pick(arr) { return arr[randomInt(arr.length)] }

async function openMany(n, path) {
  const conns = []
  for (let i = 0; i < n; i++) conns.push(setupDb(path))
  return Promise.all(conns)
}

function combine(results, label, note) {
  const ops = results.reduce((s, r) => s + r.ops, 0)
  const ms = results.reduce((s, r) => s + r.ms, 0) / results.length
  const errors = results.reduce((s, r) => s + r.errors, 0)
  const row = { label, ops, errors, ms, opsPerSec: (ops / (ms / 1000)) || 0 }
  if (note) row.note = note
  return row
}

// Scenarios
async function scenWebReadHeavy(db) {
  // 80% read, 15% update last_seen, 5% create user
  const now = () => Date.now()
  const maxId = Number((await db.get('SELECT MAX(id) as m FROM users')).m || 1)
  return measure('web_read_heavy', async () => {
    const r = randomInt(1000)
    if (r < 800) {
      const id = 1 + randomInt(maxId)
      await db.get('SELECT id, email, name, last_seen FROM users WHERE id=?', [id])
    } else if (r < 950) {
      const id = 1 + randomInt(maxId)
      await db.run('UPDATE users SET last_seen=? WHERE id=?', [now(), id])
    } else {
      const i = randomInt(1e12)
      await db.run('INSERT INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)', [
        `new${i}@example.com`, `New ${i}`, now(), now()
      ])
    }
  })
}
function scenWebReadHeavySync(db) {
  const now = () => Date.now()
  const maxId = Number(db.getSync('SELECT MAX(id) as m FROM users').m || 1)
  const sel = tryPrepareSync(db, 'SELECT id, email, name, last_seen FROM users WHERE id=?')
  const upd = tryPrepareSync(db, 'UPDATE users SET last_seen=? WHERE id=?')
  const ins = tryPrepareSync(db, 'INSERT INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)')
  const res = measureSync('web_read_heavy', () => {
    const r = randomInt(1000)
    if (r < 800) {
      const id = 1 + randomInt(maxId)
      if (sel) sel.bind([id]).getSync(); else db.getSync('SELECT id, email, name, last_seen FROM users WHERE id=?', [id])
    } else if (r < 950) {
      const id = 1 + randomInt(maxId)
      const args = [now(), id]
      if (upd) upd.bind(args).getSync(); else db.runSync('UPDATE users SET last_seen=? WHERE id=?', args)
    } else {
      const i = randomInt(1e12)
      const args = [`new${i}@example.com`, `New ${i}`, now(), now()]
      if (ins) ins.bind(args).getSync(); else db.runSync('INSERT INTO users(email, name, created_at, last_seen) VALUES(?, ?, ?, ?)', args)
    }
  })
  if (sel) sel.finalizeSync(); if (upd) upd.finalizeSync(); if (ins) ins.finalizeSync()
  return res
}

async function scenLogIngestBatch(db) {
  // Rows/sec via batched transaction
  return measureUnits('log_ingest_rows', async () => {
    await db.transaction(async () => {
      for (let i = 0; i < BATCH; i++) {
        // eslint-disable-next-line no-await-in-loop
        await db.run('INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)', [Date.now(), pick(['info','warn','error']), randomUUID()])
      }
    })
  }, BATCH)
}
function scenLogIngestBatchSync(db) {
  const ps = tryPrepareSync(db, 'INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)')
  const res = measureUnitsSync('log_ingest_rows', () => {
    db.transactionSync(() => {
      for (let i = 0; i < BATCH; i++) {
        const args = [Date.now(), pick(['info','warn','error']), randomUUID()]
        if (ps) ps.bind(args).getSync(); else db.runSync('INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)', args)
      }
    })
  }, BATCH)
  if (ps) ps.finalizeSync()
  return res
}

async function scenSessionUpsert(db) {
  const pool = Array.from({ length: SESSION_POOL }, () => randomUUID())
  return measure('session_upsert', async () => {
    const sid = pool[randomInt(pool.length)]
    const userId = 1 + randomInt(SEED_USERS)
    await db.run(
      'INSERT INTO sessions(sid, user_id, data, touched_at) VALUES(?, ?, ?, ?)\n       ON CONFLICT(sid) DO UPDATE SET user_id=excluded.user_id, data=excluded.data, touched_at=excluded.touched_at',
      [sid, userId, '{}', Date.now()]
    )
  })
}
function scenSessionUpsertSync(db) {
  const pool = Array.from({ length: SESSION_POOL }, () => randomUUID())
  const ps = tryPrepareSync(db, 'INSERT INTO sessions(sid, user_id, data, touched_at) VALUES(?, ?, ?, ?)\n       ON CONFLICT(sid) DO UPDATE SET user_id=excluded.user_id, data=excluded.data, touched_at=excluded.touched_at')
  const res = measureSync('session_upsert', () => {
    const sid = pool[randomInt(pool.length)]
    const userId = 1 + randomInt(SEED_USERS)
    const args = [sid, userId, '{}', Date.now()]
    if (ps) ps.bind(args).getSync(); else db.runSync('INSERT INTO sessions(sid, user_id, data, touched_at) VALUES(?, ?, ?, ?)\n       ON CONFLICT(sid) DO UPDATE SET user_id=excluded.user_id, data=excluded.data, touched_at=excluded.touched_at', args)
  })
  if (ps) ps.finalizeSync()
  return res
}

async function scenPaginationRead(db) {
  // Pages/sec reading recent logs
  const count = Number((await db.get('SELECT COUNT(*) AS c FROM logs')).c || 0)
  const maxPage = Math.max(1, Math.floor(count / PAGE_SIZE))
  return measure('pagination_read', async () => {
    const page = 1 + randomInt(maxPage)
    const offset = (page - 1) * PAGE_SIZE
    await db.all('SELECT id, ts, level, msg FROM logs ORDER BY ts DESC LIMIT ? OFFSET ?', [PAGE_SIZE, offset])
  })
}
function scenPaginationReadSync(db) {
  const count = Number(db.getSync('SELECT COUNT(*) AS c FROM logs').c || 0)
  const maxPage = Math.max(1, Math.floor(count / PAGE_SIZE))
  const ps = tryPrepareSync(db, 'SELECT id, ts, level, msg FROM logs ORDER BY ts DESC LIMIT ? OFFSET ?')
  const res = measureSync('pagination_read', () => {
    const page = 1 + randomInt(maxPage)
    const offset = (page - 1) * PAGE_SIZE
    if (ps) ps.bind([PAGE_SIZE, offset]).allSync(0); else db.allSync('SELECT id, ts, level, msg FROM logs ORDER BY ts DESC LIMIT ? OFFSET ?', [PAGE_SIZE, offset])
  })
  if (ps) ps.finalizeSync()
  return res
}

async function scenContendedCounter(db) {
  return measure('contended_counter', async () => {
    await db.run('UPDATE counters SET val=val+1 WHERE name=?', ['hits'])
  })
}
function scenContendedCounterSync(db) {
  const ps = tryPrepareSync(db, 'UPDATE counters SET val=val+1 WHERE name=?')
  const res = measureSync('contended_counter', () => {
    if (ps) ps.bind(['hits']).getSync(); else db.runSync('UPDATE counters SET val=val+1 WHERE name=?', ['hits'])
  })
  if (ps) ps.finalizeSync()
  return res
}

async function scenMixedReadersWriters(conns) {
  // 1 writer inserts rows continuously; remaining are readers fetching recent page
  const [writer, ...readers] = conns
  const writeTask = measureUnits('mixed_writer_rows', async () => {
    await writer.transaction(async () => {
      for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await writer.run('INSERT INTO logs(ts, level, msg) VALUES(?, ?, ?)', [Date.now(), 'info', randomUUID()])
      }
    })
  }, 10)
  const readTasks = readers.map((db, i) => measure('mixed_reader_ops', async () => {
    await db.all('SELECT id, ts, level, msg FROM logs ORDER BY ts DESC LIMIT 50')
  }))
  const results = await Promise.all([writeTask, ...readTasks])
  const writerRow = results[0]
  const readerRow = combine(results.slice(1), 'mixed_reader_ops', `c=${results.length - 1}`)
  return [writerRow, readerRow]
}

function printHeader({ dbPath }) {
  console.log('== SQLite Benchmark (Realistic Scenarios) ==')
  console.log(`DB: ${dbPath}`)
  console.log(`Duration: ${DURATION_MS} ms`)
  console.log(`Connections: ${CONN}${SYNC ? ' (sync)' : ''}`)
  console.log('')
}

function fmt(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function fmt2(n) { return n.toLocaleString('en-US', { maximumFractionDigits: 2 }) }

function printReport(rows) {
  const pad = (s, w) => String(s ?? '').padEnd(w)
  const W = { name: 24, rate: 14, ops: 12, errors: 8, extra: 12 }
  console.log(pad('scenario', W.name) + pad('ops/sec', W.rate) + pad('ops', W.ops) + pad('errors', W.errors) + 'notes')
  for (const r of rows) {
    console.log(
      pad(r.label, W.name) +
      pad(fmt2(r.opsPerSec), W.rate) +
      pad(fmt(r.ops), W.ops) +
      pad(fmt(r.errors), W.errors) +
      (r.note || '')
    )
  }
}

async function main() {
  // Worker mode: run a single scenario and emit JSON
  if (process.argv[2] === '--worker') {
    const scenario = process.argv[3]
    const dbPath = process.argv[4]
    const db = await setupDb(dbPath)
    const rows = []
    try {
      switch (scenario) {
        case 'web_read_heavy': rows.push(await scenWebReadHeavy(db)); break
        case 'session_upsert': rows.push(await scenSessionUpsert(db)); break
        case 'contended_counter': rows.push(await scenContendedCounter(db)); break
        case 'pagination_read': rows.push(await scenPaginationRead(db)); break
        case 'log_ingest_rows': rows.push(await scenLogIngestBatch(db)); break
        default: throw new Error(`Unknown scenario: ${scenario}`)
      }
      // Print single JSON line
      process.stdout.write(JSON.stringify(rows[0]) + '\n')
    } finally {
      db.closeSync()
    }
    return
  }
  const dbPath = DB_PATH
  const fileDb = dbPath !== ':memory:'
  if (fileDb) try { unlinkSync(dbPath) } catch {}

  // Main connection for schema + seed (prefer sync for stability)
  const db = SYNC ? setupDbSync(dbPath) : await setupDb(dbPath)
  if (SYNC) { createSchemaSync(db); seedDataSync(db) } else { await createSchema(db); await seedData(db) }

  // Open a single connection for single-process scenarios
  const single = SYNC ? setupDbSync(dbPath) : await setupDb(dbPath)
  printHeader({ dbPath })

  const results = []
  // Per-scenario concurrency using forked workers (separate processes) if enabled
  const runForked = async (name, workers) => {
    const procs = []
    for (let i = 0; i < workers; i++) {
      procs.push(spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker', name, dbPath], {
        stdio: ['ignore', 'pipe', 'inherit'], env: process.env
      }))
    }
    const reads = procs.map(p => new Promise((resolve, reject) => {
      let buf = ''
      p.stdout.on('data', (d) => { buf += String(d) })
      p.on('error', reject)
      p.on('close', (code) => {
        if (code !== 0 && code !== null) return reject(new Error(`${name} worker exited ${code}`))
        try { resolve(JSON.parse(buf.trim())) } catch (e) { reject(e) }
      })
    }))
    const rows = await Promise.all(reads)
    return combine(rows, name, `c=${workers}`)
  }

  // Web read-heavy
  results.push(SYNC ? await scenWebReadHeavySync(single) : (FORK && CONN > 1 ? await runForked('web_read_heavy', CONN) : await scenWebReadHeavy(single)))
  // Session upserts
  results.push(SYNC ? await scenSessionUpsertSync(single) : (FORK && CONN > 1 ? await runForked('session_upsert', CONN) : await scenSessionUpsert(single)))
  // Log ingestion (batched)
  results.push(SYNC ? await scenLogIngestBatchSync(single) : (FORK && CONN > 1 ? await runForked('log_ingest_rows', Math.min(CONN, 2)) : await scenLogIngestBatch(single)))
  // Pagination reads
  results.push(SYNC ? await scenPaginationReadSync(single) : (FORK && CONN > 1 ? await runForked('pagination_read', CONN) : await scenPaginationRead(single)))
  // Contended counter increments
  results.push(SYNC ? await scenContendedCounterSync(single) : (FORK && CONN > 1 ? await runForked('contended_counter', CONN) : await scenContendedCounter(single)))

  // Mixed readers/writer (single-process, conservative to avoid native threading pitfalls)
  // Mixed readers/writer: with SYNC keep conservative single-process pattern
  if (!SYNC) {
    results.push(...(await scenMixedReadersWriters([single, single, single, single])))
  }

  printReport(results)

  // Cleanup
  single.closeSync()
  db.closeSync()
}

main().catch((e) => { console.error('Benchmark failed:', e); process.exitCode = 1 })
