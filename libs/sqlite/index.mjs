import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

function loadNative() {
  const name = 'sqlite.node'
  const paths = [
    join(__dirname, 'build/Release', name),
    join(__dirname, 'build/Debug', name)
  ]
  for (const p of paths) {
    try { return require(p) } catch { /* try next */ }
  }
  return null
}

const native = loadNative()

// Fallback to CLI-based shim if native not present (still no external deps)
let shim
if (!native) {
  shim = await import('./node-shim.js').then(m => m.default)
}

export const libVersion = '0.1.0'
export const sqliteVersion = native?.sqliteVersion ?? 'unknown'
export const ERRORS = native?.ERRORS ?? { }

// Error helpers (best-effort based on message)
export function errorMessage(err) {
  return String(err && err.message || err || '')
}
export function isConstraintError(err) {
  return /constraint/i.test(errorMessage(err))
}
export function isBusyError(err) {
  return /busy/i.test(errorMessage(err))
}
export function isLockedError(err) {
  return /locked/i.test(errorMessage(err))
}

function withAbort(db, promise, signal) {
  if (!signal) return promise
  let onAbort
  return new Promise((resolve, reject) => {
    onAbort = () => { try { db.interrupt() } catch {} }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v) },
      e => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

export class Database {
  static async open(path=':memory:', flags=0) { return open(path, flags) }
  constructor(handle) { Object.defineProperty(this, '_h', { value: handle }) }

  get path()      { return native ? native.dbPath(this._h) : this._h.path }
  get openFlags() { return native ? native.dbFlags(this._h) : this._h.flags }
  get isOpen()    { return native ? native.dbIsOpen(this._h) : this._h.isOpen }

  exec(sql, opts)       { if (!native) return this._h.exec(sql, opts); const p = native.dbExec(this._h, String(sql), opts ?? {}); return withAbort(this, p, opts?.signal) }
  execSync(sql, opts)   { return native ? native.dbExecSync(this._h, String(sql), opts ?? {}) : this._h.execSync(sql, opts) }
  run(sql, p, o)        { if (!native) return this._h.run(sql, p, o); const pr = native.dbRun(this._h, String(sql), p ?? null, o ?? {}); return withAbort(this, pr, o?.signal) }
  runSync(sql, p, o)    { return native ? native.dbRunSync(this._h, String(sql), p ?? null, o ?? {}) : this._h.runSync(sql, p, o) }
  get(sql, p, o)        { if (!native) return this._h.get(sql, p, o); const pr = native.dbGet(this._h, String(sql), p ?? null, o ?? {}); return withAbort(this, pr, o?.signal) }
  getSync(sql, p, o)    { return native ? native.dbGetSync(this._h, String(sql), p ?? null, o ?? {}) : this._h.getSync(sql, p, o) }
  all(sql, p, o)        { if (!native) return this._h.all(sql, p, o); const pr = native.dbAll(this._h, String(sql), p ?? null, o ?? {}); return withAbort(this, pr, o?.signal) }
  allSync(sql, p, o)    { return native ? native.dbAllSync(this._h, String(sql), p ?? null, o ?? {}) : this._h.allSync(sql, p, o) }

  // Minimal prepare support via shim; native provides full Statement
  async prepare(sql, o) { if (!native) throw new Error('prepare not available without native build'); const s = await native.dbPrepare(this._h, String(sql), o ?? {}); return new Statement(this, s) }
  prepareSync(sql, o)   { if (!native) throw new Error('prepare not available without native build'); const s = native.dbPrepareSync(this._h, String(sql), o ?? {}); return new Statement(this, s) }

  async transaction(fn, mode='deferred') {
    const begin = mode ? `BEGIN ${mode.toUpperCase()} TRANSACTION` : 'BEGIN'
    await this.exec(begin)
    try {
      const r = await fn()
      await this.exec('COMMIT')
      return r
    } catch (e) {
      try { await this.exec('ROLLBACK') } catch {}
      throw e
    }
  }
  transactionSync(fn, mode='deferred') {
    if (native?.dbTxSync) {
      return native.dbTxSync(this._h, String(mode ?? 'deferred'), fn)
    }
    const begin = mode ? `BEGIN ${mode.toUpperCase()} TRANSACTION` : 'BEGIN'
    this.execSync(begin)
    try { const r = fn(); this.execSync('COMMIT'); return r } catch (e) { try { this.execSync('ROLLBACK') } catch {}; throw e }
  }
  pragma(n, v)       { return native ? native.dbPragma(this._h, String(n), v) : this._h.pragma(n, v) }
  pragmaSync(n, v)   { return native ? native.dbPragmaSync(this._h, String(n), v) : this._h.pragmaSync(n, v) }
  enableWAL()        { return this.exec('PRAGMA journal_mode=WAL') }
  enableWALSync()    { return this.execSync('PRAGMA journal_mode=WAL') }
  checkpoint(mode='PASSIVE') { if (!native) return this.exec(`PRAGMA wal_checkpoint(${mode})`); return native.dbCheckpoint(this._h, mode) }
  checkpointSync(mode='PASSIVE') { if (!native) return this.execSync(`PRAGMA wal_checkpoint(${mode})`); return native.dbCheckpointSync(this._h, mode) }

  interrupt()        { return native ? native.dbInterrupt(this._h) : undefined }
  close()            { return native ? native.dbClose(this._h) : this._h.close() }
  closeSync()        { return native ? native.dbCloseSync(this._h) : this._h.closeSync() }
}

export async function open(path=':memory:', flags=0) {
  if (native) { const h = await native.open(path, flags); return new Database(h) }
  const h = await shim.open(path, flags); return new Database(h)
}
export function openSync(path=':memory:', flags=0) {
  if (native) { const h = native.openSync(path, flags); return new Database(h) }
  const h = shim.openSync(path, flags); return new Database(h)
}

export class Statement {
  constructor(db, handle) { this.db = db; this._s = handle }
  get sql() { return native.stmtSql(this._s) }
  bind(p) { native.stmtBind(this._s, p ?? null); return this }
  step(o) { return native.stmtStep(this._s, o ?? {}) }
  stepSync() { return native.stmtStepSync(this._s) }
  get() { return native.stmtGet(this._s) }
  getSync() { return native.stmtGetSync(this._s) }
  all(limit, o) { return native.stmtAll(this._s, limit ?? 0, o ?? {}) }
  allSync(limit) { return native.stmtAllSync(this._s, limit ?? 0) }
  reset() { return native.stmtReset(this._s) }
  finalize() { return native.stmtFinalize(this._s) }
  finalizeSync() { return native.stmtFinalizeSync(this._s) }
}
