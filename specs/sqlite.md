# Node.js Spec — `@acme/sqlite`

ESM-only, zero runtime deps, native bindings via N-API (C), vendored SQLite amalgamation. No TypeScript.

---

## 1) Goals & Non-Goals

**Goals**

* Small, safe, fast SQLite wrapper built on **N-API** (no `node-addon-api`, no NAN).
* Pure ESM JS surface (`"type": "module"`).
* Promise-based async API using libuv thread pool (`napi_async_work`), plus a carefully scoped sync subset.
* Robust parameter/type mapping, blob support, prepared statements, transactions, WAL helpers.
* Clean resource lifetimes with finalizers; cancellable operations via `AbortSignal`.
* Cross-platform (Linux/macOS/Windows) without external runtime dependencies.

**Non-Goals**

* ORM features (migrations, models, query builder).
* Bundling fulltext extensions beyond standard amalgamation (can be future work).
* Multiple connections auto-pooling (explicit connections only).

---

## 2) Package Layout

```
@acme/sqlite/
├─ package.json
├─ README.md
├─ LICENSE
├─ index.mjs                 # Public ESM API, minimal glue to native
├─ src/
│  ├─ addon.cc               # N-API entry, class/async work shims
│  ├─ db.cc                  # Database class impl (open/close/exec/pragma/etc)
│  ├─ stmt.cc                # Statement class impl (prepare/bind/step/reset/finalize)
│  ├─ util.cc                # Helpers: napi unwraps, error mapping, type marshaling
│  ├─ cancel.cc              # Interrupt/cancel plumbing
│  ├─ headers.hpp            # Shared C++ (only STL + N-API C headers)
│  └─ third_party/sqlite/
│     ├─ sqlite3.c
│     └─ sqlite3.h
├─ binding.gyp               # node-gyp build config
├─ .npmrc                    # prefer offline build, no scripts beyond node-gyp
├─ test/
│  ├─ basic.test.mjs
│  ├─ concurrency.test.mjs
│  ├─ blobs.test.mjs
│  └─ cancel.test.mjs
└─ examples/
   ├─ hello.mjs
   └─ wal.mjs
```

> We vendor the official SQLite **amalgamation** (`sqlite3.c/.h`) to avoid external runtime libs and guarantee consistent behavior.

---

## 3) Public API (ESM)

### 3.1 Top-Level Exports

```js
import {
  open,                      // async factory -> Database
  openSync,                  // sync factory -> Database
  Database,                  // class (constructors are internal; use open/openSync)
  ERRORS,                    // error codes & helpers
  sqliteVersion,             // native sqlite version string
  libVersion                 // wrapper lib version
} from '@acme/sqlite'
```

### 3.2 Database

```ts
// JSDoc shown; actual code is JS.
class Database {
  get path(): string                // file path or ':memory:'
  get openFlags(): number           // SQLITE_OPEN_* bitmask
  get isOpen(): boolean

  exec(sql: string, options?: ExecOptions): Promise<void>
  execSync(sql: string, options?: ExecOptions): void

  run(sql: string, params?: Params, options?: RunOptions): Promise<Result>
  runSync(sql: string, params?: Params, options?: RunOptions): Result
  // run: for INSERT/UPDATE/DELETE; returns { changes, lastInsertRowid }

  get(sql: string, params?: Params, options?: RunOptions): Promise<Row|undefined>
  getSync(...): Row|undefined

  all(sql: string, params?: Params, options?: RunOptions): Promise<Row[]>
  allSync(...): Row[]

  prepare(sql: string, options?: PrepareOptions): Promise<Statement>
  prepareSync(sql: string, options?: PrepareOptions): Statement

  transaction<T>(fn: () => Promise<T> | T, mode?: 'deferred'|'immediate'|'exclusive'): Promise<T>
  transactionSync<T>(fn: () => T, mode?: ...): T

  pragma(name: string, value?: string | number | boolean): Promise<any>
  pragmaSync(name: string, value?: ...): any

  enableWAL(): Promise<void>
  enableWALSync(): void

  checkpoint(mode?: 'PASSIVE'|'FULL'|'RESTART'|'TRUNCATE'): Promise<void>
  checkpointSync(mode?: ...): void

  interrupt(): void                // cooperative cancel of pending work
  close(): Promise<void>
  closeSync(): void
}
```

**Options & Types**

```ts
type Params = readonly unknown[] | Record<string, unknown>
type Row = Record<string, unknown>

interface ExecOptions { signal?: AbortSignal }
interface RunOptions  { signal?: AbortSignal }
interface PrepareOptions {
  // If true, column metadata (names/types) cached on Statement
  columns?: boolean
}
interface Result { changes: number; lastInsertRowid: bigint }
```

### 3.3 Statement

```ts
class Statement {
  get sql(): string
  bind(params?: Params): this
  step(options?: { signal?: AbortSignal }): Promise<boolean> // true if row available
  stepSync(): boolean
  get(): Promise<Row|undefined>        // step + row extraction
  getSync(): Row|undefined
  all(limit?: number, options?: { signal?: AbortSignal }): Promise<Row[]>
  allSync(limit?: number): Row[]
  reset(): void
  finalize(): Promise<void>
  finalizeSync(): void
}
```

### 3.4 Error Model

* All native failures throw `SQLiteError extends Error` with:

  * `code`: SQLite numeric code
  * `name`: symbolic (e.g., `SQLITE_BUSY`)
  * `message`: joined native message + context
  * `errno?`: OS errno (if applicable)
* Exported map `ERRORS` contains `{ codes, names }`.

### 3.5 Type Mapping

| SQLite           | JS                                          |
| ---------------- | ------------------------------------------- |
| NULL             | `null`                                      |
| INTEGER ≤ 2^53-1 | `number`                                    |
| INTEGER > 2^53-1 | `bigint`                                    |
| REAL             | `number`                                    |
| TEXT (UTF-8)     | `string`                                    |
| BLOB             | `Uint8Array` (backed by Node `ArrayBuffer`) |

Bindings accept JS `number`/`bigint`/`string`/`null`/`Uint8Array` and map named or positional params (`?`, `?1`, `:name`, `@name`, `$name`).

---

## 4) Concurrency & Cancellation

* All blocking native calls run on libuv’s thread pool via `napi_create_async_work`.
* We add **interrupt** support using `sqlite3_interrupt(db)`:

  * Each async work checks a per-op cancel token set from JS `AbortSignal`.
  * On `abort` or `Database.interrupt()`, we atomically mark and call `sqlite3_interrupt` on the connection used by that work.
* Statements are not thread-safe; we confine each DB handle to one async operation at a time **per Statement**, but allow **different statements** to run concurrently on the same DB when `PRAGMA journal_mode=WAL` (SQLite allows readers concurrency; writers still serialize). We coordinate writes with a simple native mutex to serialize `BEGIN…COMMIT` when needed.

---

## 5) Native Addon Architecture (N-API C)

### 5.1 Initialization

* `addon.cc` registers two classes:

  * `Database` (napi_wrap with `DB*` internal)
  * `Statement` (napi_wrap with `Stmt*` internal)

* Expose functions: `open`, `openSync`, `sqliteVersion`, `interrupt`.

### 5.2 Core Structures (C++ with only N-API C interop)

```cpp
struct DB {
  sqlite3* handle{nullptr};
  std::mutex write_mutex;         // serialize transactional writers
  std::atomic<bool> closing{false};
};

struct Stmt {
  DB* db{nullptr};
  sqlite3_stmt* handle{nullptr};
  // cached column names/types
  std::vector<std::string> columns;
};
```

> We use C++ for RAII around `sqlite3_*` resources, but only include `<node_api.h>` and standard headers (no `node-addon-api`).

### 5.3 Async Pattern

* For each async method (`exec`, `get`, `all`, `step`, etc.):

  1. Copy SQL and bound params into a work struct.
  2. Create `napi_async_work` with `Execute` (runs on thread) and `Complete` (main thread).
  3. `Execute` prepares, binds, steps, marshals rows into a compact C buffer (or vector), converts to JS in `Complete`.

* Cancellation:

  * Work struct holds `std::atomic<bool> cancelled`.
  * JS `AbortSignal` emits → set flag and call `sqlite3_interrupt(db)`.

### 5.4 Build (binding.gyp)

```json
{
  "targets": [
    {
      "target_name": "sqlite",
      "sources": [
        "src/addon.cc",
        "src/db.cc",
        "src/stmt.cc",
        "src/util.cc",
        "src/cancel.cc",
        "src/third_party/sqlite/sqlite3.c"
      ],
      "include_dirs": ["<!@(node -p \"require('node:node-addon-api').include\")", "src/third_party/sqlite"],
      "defines": [
        "SQLITE_THREADSAFE=1",
        "SQLITE_DEFAULT_MEMSTATUS=0",
        "SQLITE_OMIT_LOAD_EXTENSION",
        "SQLITE_OMIT_DEPRECATED"
      ],
      "cflags_c": ["-O3"],
      "cflags_cc": ["-O3"],
      "conditions": [
        ["OS==\"win\"", { "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/O2"] } } }]
      ]
    }
  ]
}
```

> Note: We **do not** depend on `node-addon-api` at runtime; the include line above can be removed if not available. We rely only on `node_api.h` provided by Node. If removing, replace with Node headers path from `process.config.variables.nodedir`. Keep the target minimal.

---

## 6) JS ESM Layer

`package.json`

```json
{
  "name": "@acme/sqlite",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.mjs",
  "exports": {
    ".": {
      "import": "./index.mjs"
    }
  },
  "engines": { "node": ">=18.18" }
}
```

`index.mjs` (loader + thin ergonomics)

```js
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

// Resolve Release/Debug
function loadNative() {
  const name = 'sqlite.node'
  const tryPaths = [
    join(__dirname, 'build/Release', name),
    join(__dirname, 'build/Debug', name)
  ]
  for (const p of tryPaths) {
    try { return require(p) } catch {}
  }
  throw new Error('Native module not found. Did you run `npm run build`?')
}

const native = loadNative()

export const sqliteVersion = native.sqliteVersion
export const libVersion = '0.1.0'
export const ERRORS = native.ERRORS

export class Database {
  static async open(path = ':memory:', flags) { return open(path, flags) }
  // ctor is internal; created by native to attach pointer
  constructor(_handle) { Object.defineProperty(this, '_h', { value: _handle }) }

  get path()      { return native.dbPath(this._h) }
  get openFlags() { return native.dbFlags(this._h) }
  get isOpen()    { return native.dbIsOpen(this._h) }

  exec(sql, opts)       { return native.dbExec(this._h, String(sql), opts ?? {}) }
  execSync(sql, opts)   { return native.dbExecSync(this._h, String(sql), opts ?? {}) }
  run(sql, p, o)        { return native.dbRun(this._h, String(sql), p ?? null, o ?? {}) }
  runSync(sql, p, o)    { return native.dbRunSync(this._h, String(sql), p ?? null, o ?? {}) }
  get(sql, p, o)        { return native.dbGet(this._h, String(sql), p ?? null, o ?? {}) }
  getSync(sql, p, o)    { return native.dbGetSync(this._h, String(sql), p ?? null, o ?? {}) }
  all(sql, p, o)        { return native.dbAll(this._h, String(sql), p ?? null, o ?? {}) }
  allSync(sql, p, o)    { return native.dbAllSync(this._h, String(sql), p ?? null, o ?? {}) }

  async prepare(sql, o) { const s = await native.dbPrepare(this._h, String(sql), o ?? {}); return new Statement(this, s) }
  prepareSync(sql, o)   { const s = native.dbPrepareSync(this._h, String(sql), o ?? {});   return new Statement(this, s) }

  transaction(fn, mode='deferred')      { return native.dbTx(this._h, mode, fn) }
  transactionSync(fn, mode='deferred')  { return native.dbTxSync(this._h, mode, fn) }
  pragma(n, v)       { return native.dbPragma(this._h, String(n), v) }
  pragmaSync(n, v)   { return native.dbPragmaSync(this._h, String(n), v) }
  enableWAL()        { return this.exec('PRAGMA journal_mode=WAL') }
  enableWALSync()    { return this.execSync('PRAGMA journal_mode=WAL') }
  checkpoint(mode='PASSIVE') { return native.dbCheckpoint(this._h, mode) }
  checkpointSync(mode='PASSIVE') { return native.dbCheckpointSync(this._h, mode) }

  interrupt()        { return native.dbInterrupt(this._h) }
  close()            { return native.dbClose(this._h) }
  closeSync()        { return native.dbCloseSync(this._h) }
}

export async function open(path=':memory:', flags) {
  const h = await native.open(path, flags ?? 0)
  return new Database(h)
}
export function openSync(path=':memory:', flags) {
  const h = native.openSync(path, flags ?? 0)
  return new Database(h)
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

  reset() { native.stmtReset(this._s) }
  finalize() { return native.stmtFinalize(this._s) }
  finalizeSync() { return native.stmtFinalizeSync(this._s) }
}
```

> JS stays ultra-thin; all heavy lifting is native for performance and clear error semantics.

---

## 7) Native Implementation Notes

### 7.1 Parameter Binding

* Positional array: indices 1..N → `sqlite3_bind_*`.
* Named object: detect `:name/@name/$name` in statement; for each, if present in object keys (with or without prefix), bind value.
* Types:

  * `null` → `sqlite3_bind_null`
  * `number` → `sqlite3_bind_double` unless integer safe → `sqlite3_bind_int64`
  * `bigint` → `sqlite3_bind_int64`
  * `string` → `sqlite3_bind_text` (UTF-8, transient)
  * `Uint8Array`/`ArrayBufferView` → `sqlite3_bind_blob`

### 7.2 Row Extraction

* `sqlite3_column_*` to fetch typed values; 64-bit ints → `bigint` via `napi_create_bigint_int64`.
* Text: use `sqlite3_column_text` + length.
* Blob: copy into a Node-owned `ArrayBuffer` then `Uint8Array`.

### 7.3 Transactions

* `dbTx` (async) and `dbTxSync` wrap:

  * `BEGIN <mode>` → call user fn → `COMMIT` or `ROLLBACK` on throw.
  * Writers are serialized with `DB::write_mutex` to avoid SQLITE_BUSY storms.
  * Nested transactions use SQLite `SAVEPOINT` fallback:

    * If inside tx, `SAVEPOINT acme_n; ... RELEASE acme_n` / `ROLLBACK TO acme_n`.

### 7.4 PRAGMAs, WAL & Checkpoint

* `enableWAL()` executes `PRAGMA journal_mode=WAL` and validates returned mode string.
* `checkpoint(mode)` calls `sqlite3_wal_checkpoint_v2`.

---

## 8) Error Handling & Mapping

* Convert SQLite error codes (`sqlite3_errcode`) to constants (e.g., `SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_CONSTRAINT`).
* Augment message with SQL snippet (truncated) and param info (counts only, not full data to avoid leaking secrets).
* Busy handler: set `sqlite3_busy_timeout` default 1000ms; allow override via `open(path, flags, { busyTimeoutMs })` (extend later).

---

## 9) Security & Safety

* Zero-copy where safe; otherwise copy blobs to avoid use-after-free.
* Never interpolate params into SQL in JS; **always** bind.
* Limit max string/blob size (configurable) to prevent OOM.
* Respect `AbortSignal` to avoid unkillable long queries.

---

## 10) Performance Considerations

* Prepared statement cache (LRU) left **off by default** to keep semantics obvious; can be a future opt-in.
* Column name caching per `Stmt` when `options.columns` is true to speed row shape creation.
* Map rows using property dictionary caching for repeated queries.

---

## 11) Example Usage

```js
import { open } from '@acme/sqlite'

const db = await open(':memory:')
await db.exec(`
  PRAGMA journal_mode=WAL;
  CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, avatar BLOB);
`)
await db.run('INSERT INTO users(name) VALUES (?)', ['Ada'])
const row = await db.get('SELECT * FROM users WHERE id = ?', [1])
console.log(row) // { id: 1n, name: 'Ada', avatar: null }

const insert = await db.prepare('INSERT INTO users(name, avatar) VALUES(:name, :avatar)')
await insert.bind({ name: 'Linus', avatar: new Uint8Array([1,2,3]) }).get()
await insert.finalize()

await db.transaction(async () => {
  await db.run('UPDATE users SET name=? WHERE id=?', ['A.', 1])
})
await db.close()
```

**Cancellation**

```js
const ac = new AbortController()
const p = db.all('SELECT * FROM big_table', [], { signal: ac.signal })
ac.abort() // cooperatively cancels via sqlite3_interrupt
await p.catch(e => console.log('Cancelled:', e.name))
```

---

## 12) Minimal Native Snippets (Illustrative Only)

**addon.cc (entry)**

```cpp
#include <node_api.h>
#include "sqlite3.h"
#include "headers.hpp"
// declare init functions that define Database/Statement classes and functions
napi_value Init(napi_env env, napi_value exports) {
  DefineDatabase(env, exports);
  DefineStatement(env, exports);
  DefineGlobals(env, exports); // sqliteVersion, ERRORS
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

**db.cc (open/close sync)**

```cpp
napi_value OpenSync(napi_env env, napi_callback_info info) {
  // parse args: path (string), flags (uint32), options (obj?) — options optional for future
  // sqlite3_open_v2, wrap DB*, set finalizer to close handle
  // return external/opaque handle for JS Database
}
```

**Async pattern (exec)**

```cpp
struct ExecWork {
  DB* db;
  std::string sql;
  std::atomic<bool> cancelled{false};
  napi_async_work work;
  napi_deferred deferred;
};
static void ExecExecute(napi_env env, void* data) {
  auto* w = static_cast<ExecWork*>(data);
  if (w->cancelled.load()) { sqlite3_interrupt(w->db->handle); return; }
  char* err = nullptr;
  int rc = sqlite3_exec(w->db->handle, w->sql.c_str(), nullptr, nullptr, &err);
  if (rc != SQLITE_OK) { /* stash error for Complete */ }
}
static void ExecComplete(napi_env env, napi_status status, void* data) {
  // resolve or reject deferred, cleanup
}
```

---

## 13) Testing (Node built-ins only)

* Use `node:test` and `node:assert/strict`.
* Matrix:

  * Open/close memory/file
  * DDL/DML/SELECT (sync/async)
  * Params: positional/named, bigint & blob roundtrip
  * Concurrency: parallel reads under WAL; write serialization; busy timeout
  * Transaction nesting with savepoints
  * Cancellation via `AbortController`
  * Finalizer cleanup (leaked Statement auto finalized on GC)

Example `basic.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { open } from '../index.mjs'

test('insert/select', async () => {
  const db = await open(':memory:')
  await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
  const r = await db.run('INSERT INTO t(v) VALUES (?)', ['x'])
  assert.equal(typeof r.lastInsertRowid, 'bigint')
  const row = await db.get('SELECT v FROM t WHERE id = ?', [r.lastInsertRowid])
  assert.equal(row.v, 'x')
  await db.close()
})
```

---

## 14) Build & Scripts

`package.json` scripts:

```json
{
  "scripts": {
    "build": "node-gyp rebuild",
    "rebuild": "node-gyp rebuild",
    "clean": "node-gyp clean",
    "test": "node --test"
  }
}
```

**Tooling expectations**

* Requires a compiler toolchain (msvc/clang/gcc) and Python for node-gyp.
* No external runtime deps; SQLite compiled in.

---

## 15) Future Enhancements (Out of Scope Now)

* Extension loading toggle (`sqlite3_load_extension`) behind explicit opt-in.
* `iterRows()` async iterator for streaming large result sets.
* Statement cache with LRU and invalidation.
* Backup API (`sqlite3_backup_*`) for online backups.

---

## 16) Done-ness Criteria

* ✅ ESM API mirrors spec
* ✅ Native addon builds on all tier-1 platforms
* ✅ All tests pass locally
* ✅ Memory safety (ASAN clean on Linux/macOS)
* ✅ Cancellation works and is deterministic
* ✅ No external libraries used at runtime; only Node + vendored SQLite

---

If you want, I can flesh out the `binding.gyp` + a minimal `addon.cc`/`db.cc` skeleton to get a “compile-green” baseline you can iterate on.

